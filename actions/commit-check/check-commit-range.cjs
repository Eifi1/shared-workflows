#!/usr/bin/env node
/**
 * Validate every commit message in a range against Conventional Commits.
 *
 * Reads BASE_SHA / HEAD_SHA from the environment (set by CI from the pull
 * request or push event) and checks each non-merge commit in between. Falls
 * back to just the tip commit when no usable base is available (e.g. the very
 * first push, where `before` is all zeros).
 */
const { execSync } = require("child_process");
const { validate } = require("./check-commit-msg.cjs");

const ZERO = "0".repeat(40);
const git = (cmd) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim();

let base = process.env.BASE_SHA || "";
const head = process.env.HEAD_SHA || "HEAD";
if (base === ZERO) base = "";

let shas;
try {
  const range = base ? `${base}..${head}` : `${head}~1..${head}`;
  shas = git(`rev-list --no-merges ${range}`).split("\n").filter(Boolean);
} catch {
  // Shallow checkout or unknown base: check the tip commit only.
  shas = [git(`rev-parse ${head}`)];
}

let failed = 0;
for (const sha of shas) {
  const message = git(`log -1 --format=%B ${sha}`);
  const subject = message.split("\n")[0];
  const error = validate(message);
  if (error) {
    failed++;
    console.error(`✖ ${sha.slice(0, 8)} ${subject}\n  ${error.replace(/\n/g, "\n  ")}\n`);
  } else {
    console.log(`✓ ${sha.slice(0, 8)} ${subject}`);
  }
}

if (failed) {
  console.error(`\n${failed} commit message(s) violate Conventional Commits.`);
  process.exit(1);
}
console.log(`\nAll ${shas.length} commit message(s) OK.`);
