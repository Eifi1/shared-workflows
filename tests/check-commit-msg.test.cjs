// Tests for actions/commit-check/check-commit-msg.cjs — run with `node --test "tests/*.test.cjs"`.
// The validator reads the calling repo's .versionrc from the working directory,
// so each case runs it in a temp directory holding one config flavour.
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
