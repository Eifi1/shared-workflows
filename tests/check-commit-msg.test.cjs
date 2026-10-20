// Tests for actions/commit-check/check-commit-msg.cjs — run with `node --test "tests/*.test.cjs"`.
// The validator reads the calling repo's .versionrc from the git top level (the working
// directory outside a repo), so each case runs it in a temp directory holding one config flavour.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.resolve(__dirname, "..", "actions", "commit-check", "check-commit-msg.cjs");

function check(message, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commit-check-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  try {
    execFileSync("node", [SCRIPT, message], { cwd: dir, stdio: "pipe" });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ONLY_FEAT = { types: [{ type: "feat" }] };

test("standard types apply without a config", () => {
  assert.equal(check("fix(api): handle empty body"), true);
  assert.equal(check("nonsense"), false);
});

test("types come from .versionrc.json (keksdose)", () => {
  const files = { ".versionrc.json": JSON.stringify(ONLY_FEAT) };
  assert.equal(check("feat: x", files), true);
  assert.equal(check("fix: x", files), false);
});

test("types come from .versionrc.js (kastlan)", () => {
  const files = { ".versionrc.js": `module.exports = ${JSON.stringify(ONLY_FEAT)};` };
  assert.equal(check("feat: x", files), true);
  assert.equal(check("fix: x", files), false);
});

test("types come from .versionrc.cjs (ui-kit)", () => {
  const files = { ".versionrc.cjs": `module.exports = ${JSON.stringify(ONLY_FEAT)};` };
  assert.equal(check("feat: x", files), true);
  assert.equal(check("fix: x", files), false);
});

test("scope and breaking marker are optional", () => {
  assert.equal(check("feat(ui)!: drop the old prop"), true);
});

test("headers over 100 characters fail", () => {
  assert.equal(check(`feat: ${"x".repeat(95)}`), false);
});

test("git's own merge and revert messages pass", () => {
  assert.equal(check("Merge pull request #1 from x/y"), true);
  assert.equal(check('Revert "feat: x"'), true);
});

// Run from a subdirectory of a repo, the config at the repo's top level still applies
// (keksdose N5: it used to be read from the working directory only, so a hook or script
// started below the root silently fell back to the standard types).
function checkInRepo(message, files, subdir) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commit-check-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, name), body);
  const cwd = path.join(root, subdir);
  fs.mkdirSync(cwd, { recursive: true });
  try {
    execFileSync("node", [SCRIPT, message], { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the config at the git top level applies from a subdirectory", () => {
  const files = { ".versionrc.json": JSON.stringify(ONLY_FEAT) };
  assert.equal(checkInRepo("feat: x", files, "frontend/src"), true);
  assert.equal(checkInRepo("fix: x", files, "frontend/src"), false);
});

test("the top-level .versionrc.cjs applies when required as a module from a subdirectory", () => {
  const files = { ".versionrc.cjs": `module.exports = ${JSON.stringify(ONLY_FEAT)};` };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commit-check-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe" });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, name), body);
  const cwd = path.join(root, "backend");
  fs.mkdirSync(cwd);
  try {
    const out = execFileSync(
      "node",
      ["-e", `const m = require(${JSON.stringify(SCRIPT)}); console.log(JSON.stringify([m.TYPES, m.validate("fix: x") !== null, m.validate("feat: x")]))`],
      { cwd, encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(out), [["feat"], true, null]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A hook that exports a GIT_DIR and then cds into a subdirectory (git runs hooks with GIT_DIR
// set; a relative one stops resolving after the cd, and any GIT_DIR without GIT_WORK_TREE makes
// git treat the working directory as the top level). The top-level config still applies, and a
// GIT_DIR that leads nowhere warns instead of silently using the standard types (round-047 N5).
function checkWithGitDir(message, gitDir, { repo = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "commit-check-gitdir-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  if (repo) execFileSync("git", ["init", "-q"], { cwd: root, stdio: "pipe", env });
  fs.writeFileSync(path.join(root, ".versionrc.json"), JSON.stringify(ONLY_FEAT));
  const cwd = path.join(root, "frontend");
  fs.mkdirSync(cwd);
  const value = gitDir === "absolute" ? path.join(root, ".git") : gitDir;
  try {
    execFileSync("node", [SCRIPT, message], { cwd, stdio: "pipe", env: { ...env, GIT_DIR: value } });
    return { ok: true, stderr: "" };
  } catch (error) {
    return { ok: false, stderr: String(error.stderr) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a relative GIT_DIR exported before a cd into a subdirectory still finds the top-level config", () => {
  assert.equal(checkWithGitDir("feat: x", ".git").ok, true);
  assert.equal(checkWithGitDir("fix: x", ".git").ok, false);
});

test("an absolute GIT_DIR from a subdirectory still finds the top-level config", () => {
  assert.equal(checkWithGitDir("feat: x", "absolute").ok, true);
  assert.equal(checkWithGitDir("fix: x", "absolute").ok, false);
});

test("a GIT_DIR that resolves nowhere warns before falling back to the working directory", () => {
  const result = checkWithGitDir("nonsense", ".git", { repo: false });
  assert.equal(result.ok, false);
  assert.match(result.stderr, /GIT_DIR=\.git/);
});
