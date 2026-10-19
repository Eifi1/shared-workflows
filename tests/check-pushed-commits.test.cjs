// Tests for actions/commit-check/check-pushed-commits.cjs — run with `node --test "tests/*.test.cjs"`.
// Each case builds a throwaway repo with a bare "origin", makes commits, and feeds the
// script the stdin line git's pre-push hook would get.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const SCRIPT = path.resolve(__dirname, "..", "actions", "commit-check", "check-pushed-commits.cjs");
const ZERO = "0".repeat(40);

function repo({ defaultBranch = "main" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pushed-commits-"));
  const dir = path.join(root, "work");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
        GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
      },
    }).trim();
  execFileSync("git", ["init", "-q", "--bare", "-b", defaultBranch, path.join(root, "origin.git")]);
  fs.mkdirSync(dir);
  git("init", "-q", "-b", defaultBranch);
  git("remote", "add", "origin", path.join(root, "origin.git"));
  const commit = (message) => {
    git("commit", "-q", "--allow-empty", "--no-verify", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const run = (stdin, ...args) =>
    spawnSync("node", [SCRIPT, ...args], { cwd: dir, input: stdin, encoding: "utf8" });
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { dir, git, commit, run, cleanup };
}

const line = (local, remote, branch = "main") =>
  `refs/heads/${branch} ${local} refs/heads/${branch} ${remote}\n`;

test("an existing branch: only commits after the remote sha are checked", () => {
  const r = repo();
  try {
    const bad = r.commit("this one is not conventional");
    r.git("push", "-q", "origin", "main");
    const tip = r.commit("feat: a good one");
    const res = r.run(line(tip, bad));
    assert.equal(res.status, 0, res.stderr);
  } finally {
    r.cleanup();
  }
});

test("a bad message in the pushed range fails and is listed", () => {
  const r = repo();
  try {
    const base = r.commit("chore: init");
    r.git("push", "-q", "origin", "main");
    const bad = r.commit("wip stuff");
    const tip = r.commit("fix: fine");
    const res = r.run(line(tip, base));
    assert.equal(res.status, 1);
    assert.match(res.stderr, new RegExp(bad.slice(0, 8)));
    assert.match(res.stderr, /wip stuff/);
    assert.match(res.stderr, /1 commit message\(s\)/);
  } finally {
    r.cleanup();
  }
});

test("headers over 100 characters fail", () => {
  const r = repo();
  try {
    const base = r.commit("chore: init");
    r.git("push", "-q", "origin", "main");
    const tip = r.commit(`feat: ${"x".repeat(95)}`);
    assert.equal(r.run(line(tip, base)).status, 1);
  } finally {
    r.cleanup();
  }
});

test("a new branch is checked against origin/main, not from the root", () => {
  const r = repo();
  try {
    r.commit("old history, not conventional");
    r.git("push", "-q", "origin", "main");
    r.git("fetch", "-q", "origin");
    r.git("switch", "-q", "-c", "feat/x");
    const tip = r.commit("feat: new work");
    assert.equal(r.run(line(tip, ZERO, "feat/x")).status, 0);
    r.commit("new work, not conventional");
    // The bad commit is below the tip: only a range from origin/main reaches it.
    const res = r.run(line(r.commit("fix: on top"), ZERO, "feat/x"));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /new work, not conventional/);
    assert.doesNotMatch(res.stderr, /old history/);
  } finally {
    r.cleanup();
  }
});

test("a new branch uses origin/HEAD when the default branch is not main", () => {
  const r = repo({ defaultBranch: "trunk" });
  try {
    r.commit("old history, not conventional");
    r.git("push", "-q", "origin", "trunk");
    r.git("fetch", "-q", "origin");
    r.git("remote", "set-head", "origin", "trunk");
    r.git("switch", "-q", "-c", "feat/x");
    const tip = r.commit("feat: new work");
    assert.equal(r.run(line(tip, ZERO, "feat/x")).status, 0);
    r.commit("new work, not conventional");
    assert.equal(r.run(line(r.commit("fix: on top"), ZERO, "feat/x")).status, 1);
  } finally {
    r.cleanup();
  }
});

test("the remote name argument picks that remote's default branch", () => {
  const r = repo();
  try {
    r.commit("old history, not conventional");
    r.git("remote", "rename", "origin", "upstream");
    r.git("push", "-q", "upstream", "main");
    r.git("fetch", "-q", "upstream");
    r.git("switch", "-q", "-c", "feat/x");
    const tip = r.commit("feat: new work");
    assert.equal(r.run(line(tip, ZERO, "feat/x"), "upstream").status, 0);
  } finally {
    r.cleanup();
  }
});

test("no remote branch known at all: only the tip is checked, even a root commit", () => {
  const r = repo();
  try {
    const root = r.commit("feat: first");
    assert.equal(r.run(line(root, ZERO)).status, 0);
    r.commit("not conventional");
    const tip = r.commit("fix: last");
    assert.equal(r.run(line(tip, ZERO)).status, 0);
  } finally {
    r.cleanup();
  }
});

test("a deletion and empty input check nothing", () => {
  const r = repo();
  try {
    const sha = r.commit("not conventional");
    assert.equal(r.run(`(delete) ${ZERO} refs/heads/main ${sha}\n`).status, 0);
    assert.equal(r.run("").status, 0);
  } finally {
    r.cleanup();
  }
});

test("merge commits are skipped; the repo's .versionrc types apply", () => {
  const r = repo();
  try {
    fs.writeFileSync(path.join(r.dir, ".versionrc.json"), JSON.stringify({ types: [{ type: "feat" }] }));
    const base = r.commit("feat: init");
    r.git("push", "-q", "origin", "main");
    r.git("switch", "-q", "-c", "side");
    r.commit("feat: side");
    r.git("switch", "-q", "main");
    r.commit("feat: main");
    r.git("merge", "-q", "--no-ff", "--no-verify", "side", "-m", "a merge, never checked");
    assert.equal(r.run(line(r.git("rev-parse", "HEAD"), base)).status, 0);
    const tip = r.commit("fix: not an allowed type here");
    assert.equal(r.run(line(tip, base)).status, 1);
  } finally {
    r.cleanup();
  }
});

test("a remote sha this clone doesn't have: everything not on the default branch is checked", () => {
  const r = repo();
  try {
    r.commit("old history, not conventional");
    r.git("push", "-q", "origin", "main");
    r.git("fetch", "-q", "origin");
    const good = r.commit("feat: new work");
    assert.equal(r.run(line(good, "1".repeat(40))).status, 0);
    r.commit("an earlier bad one, unfetched range");
    const tip = r.commit("feat: tip");
    const res = r.run(line(tip, "1".repeat(40)));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /an earlier bad one/);
    assert.doesNotMatch(res.stderr, /old history/);
  } finally {
    r.cleanup();
  }
});

test("a remote sha this clone doesn't have and no default branch known: fails closed, asks for a fetch", () => {
  const r = repo();
  try {
    const tip = r.commit("feat: tip");
    const res = r.run(line(tip, "1".repeat(40)));
    assert.equal(res.status, 1);
    assert.match(res.stderr, /git fetch/);
  } finally {
    r.cleanup();
  }
});
