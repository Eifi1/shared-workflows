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
