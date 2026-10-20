# shared-workflows

Reusable GitHub Actions workflows and composite actions shared by the Eifi1 apps (kastlan, keksdose,
kurvenschmiede, …). One copy of each job lives here; every app calls it from a
small workflow of its own, which carries only what is genuinely per-app: the
schedule, the folder, and the permissions.

## `browserslist.yml` — monthly browser-data refresh

Updates `caniuse-lite` and `baseline-browser-mapping` within the lockfile's
ranges and opens a PR (`chore/browserslist-db`) with only the lockfile.

### Calling it

Add `.github/workflows/browserslist.yml` to the app:

```yaml
name: Browserslist data

on:
  schedule:
    # The 15th, not the 1st: monthly Dependabot runs on the 1st and also
    # rewrites package-lock.json, so the two PRs would conflict every month.
    - cron: "0 5 15 * *"
  workflow_dispatch:

jobs:
  update:
    permissions:
      contents: write
      pull-requests: write
    uses: Eifi1/shared-workflows/.github/workflows/browserslist.yml@<sha> # v1.0.0
    with:
      directory: frontend   # omit (".") when package-lock.json is at the root
    secrets:
      pr_token: ${{ secrets.BROWSERSLIST_PR_TOKEN }}
```

Pin `@<sha>` of a release tag (see Releases); the app's own github-actions
Dependabot entry bumps it.

### Inputs

| Input | Default | Meaning |
|---|---|---|
| `directory` | `.` | Folder with `package.json` + `package-lock.json` |
| `node-version-file` | `.nvmrc` | Node version file, relative to the repo root |

Secret `pr_token` (optional): a fine-grained PAT with contents + pull-requests
write. Without it the PR is opened with `GITHUB_TOKEN`, which does not trigger
CI — run CI by hand (`workflow_dispatch` on the app's CI) or close and reopen.

### Per-app prerequisites

- Settings → Actions → General → **Allow GitHub Actions to create and approve
  pull requests** must be on.

### Repository setting (this repo)

This repo is **public** (since 2026-09-29). It holds only generic scripts and
workflows, no secrets, and being public is what lets every Eifi1 repo use it
without further setup:

- any repository, private or public, can call its reusable workflows and
  composite actions — ui-kit, which is public, could not while this was private;
- Dependabot's github-actions updater in each app can read it to move the
  pinned SHA. While it was private it failed with "Repository not found", since
  a personal account has no setting that grants Dependabot access to another
  private repository. No `registries:` block or token is needed.

## `release.yml` — semver release (reusable workflow)

commit-and-tag-version release with keksdose's hardening: stray tags from a
half-pushed release are deleted first, the push is `--atomic`, and a release
that loses the race against a moving main is re-cut on the new main.

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      release-as:
        description: "Version bump"
        type: choice
        default: auto
        options: [auto, patch, minor, major]
      dry-run:
        description: "Preview only — no commit, tag, or push"
        type: boolean
        default: false

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    permissions:
      contents: write
    uses: Eifi1/shared-workflows/.github/workflows/release.yml@<sha> # v1.2.0
    with:
      release-as: ${{ inputs.release-as || 'auto' }}
      dry-run: ${{ inputs.dry-run || false }}
      # Only where commit-and-tag-version is not a root devDependency:
      # install-directory: frontend
      # cli: ./frontend/node_modules/.bin/commit-and-tag-version
      # version-file: frontend/package.json
```

| Input | Default | Meaning |
|---|---|---|
| `release-as` | `auto` | Forced bump, or `auto` from the commits |
| `dry-run` | `false` | Preview only |
| `install-directory` | `.` | Where `npm ci` installs the release tool |
| `cli` | `npx commit-and-tag-version` | How to run it from the repo root |
| `version-file` | `package.json` | Where the released version is read |
| `pre-release-check` | `node scripts/check-version-sync.cjs` | Run before cutting; empty to skip |
| `node-version-file` | `.nvmrc` | |

## Composite actions (steps inside an app's own job)

These run in the job the app already has, so they reuse its checkout and
setup: no extra runner, no extra minutes.

### `actions/commit-check` — Conventional Commits

```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: Eifi1/shared-workflows/actions/commit-check@<sha> # v1.2.0
```

Checks every non-merge commit in the push/PR range. The allowed types come
from the repo's `.versionrc.js`, `.versionrc.cjs` or `.versionrc.json`, so they
match the release tool; a repo without one gets the standard types. The
local commit-msg hook keeps using the repo's own `scripts/check-commit-msg.cjs`.

#### Locally, before the push: `check-pushed-commits.cjs` (v1.3.0)

The commit-msg hook is skipped by `git commit --no-verify` and by every rewrite
that doesn't re-run hooks, so a bad header can still reach CI. The pre-push
check catches it on the machine: every non-merge commit the push would send
must pass `check-commit-msg.cjs`. Generalised from keksdose's copy.

Vendor both files into the app's `scripts/` (byte for byte, pinned to a tag
like ui-kit's `scripts/shared-commit-rules.json`; `check-pushed-commits.cjs`
requires `./check-commit-msg.cjs` beside it, nothing else), then pipe git's
pre-push stdin to it:

```sh
#!/bin/sh
# .githooks/pre-push or .husky/pre-push. Read stdin once if the hook has other checks too.
input=$(cat)
printf '%s\n' "$input" | node scripts/check-pushed-commits.cjs "${1:-origin}" || exit 1
```

Each stdin line is `<local ref> <local sha> <remote ref> <remote sha>`. The
range is `<remote sha>..<local sha>`; for a branch the remote doesn't have yet,
everything not on the remote's default branch: `<remote>/HEAD`, else
`<remote>/main`, else `<remote>/master`, else only the tip. A deletion checks
nothing; a remote sha this clone hasn't fetched checks everything not on the
default branch, and fails closed (asking for a `git fetch`) when no default
branch is known. The argument is
the remote (git's `$1`), default `origin`. Exit 1 lists the offending commits.
The `.versionrc` is found at the git top level (v1.3.1), so the repo's types
apply from any directory; outside a repo the working directory is used.

#### Hook it once: commit-msg, pre-push or CI

Each place catches what the one before it lets through, so run each check in
one place only:

- **commit-msg** (`check-commit-msg.cjs "$1"`): the message as it is written.
  Skipped by `--no-verify` and by rewrites that don't re-run hooks.
- **pre-push** (`check-pushed-commits.cjs`): exactly the commits this push
  sends, on any branch, rewritten ones included. The last local moment.
- **CI** (this action, `check-commit-range.cjs`): the whole PR range; the gate
  nobody can skip.

A repo script that already runs `check-commit-range.cjs` against `main` (e.g. a
`check:versioning` step called from the pre-push hook) overlaps with
`check-pushed-commits.cjs`: both read the same rules, so a bad header fails
twice. That is harmless, not wrong. To keep one, keep `check-pushed-commits.cjs`
in the hook (it also covers pushes of other branches and rewritten commits, and
needs no `main` locally) and leave the range check to CI. If both stay, read
git's stdin once, first, and pipe it to the pushed-commits check.

### `actions/python-scans` — pip-audit + vulture

```yaml
      - uses: Eifi1/shared-workflows/actions/python-scans@<sha> # v1.2.0
        with:
          working-directory: backend   # omit when pyproject.toml is at the root
          package: myapp               # what vulture scans
```

### `actions/node-scans` — npm audit + ts-prune

```yaml
      - uses: Eifi1/shared-workflows/actions/node-scans@<sha> # v1.2.0
        with:
          working-directory: frontend
```

Both scans are advisory (`continue-on-error`) by default; pass
`advisory: "false"` once a repo's findings are triaged.

### `actions/tests-ran` — a suite must run, not skip

```yaml
      - name: Tests
        run: uv run pytest -q --junitxml=junit.xml
      - uses: Eifi1/shared-workflows/actions/tests-ran@<sha> # v1.2.0
        with:
          prefix: tests.integration.   # JUnit classname prefix
```

Fails when no test under the prefix ran, or when any skipped. For suites that
skip themselves without their database (RLS, tenant isolation, migrations):
"12 passed, 40 skipped" is green to pytest and red here. From keksdose's
`check-integration-ran.py`.

## Releasing

Tag a release (`v1.0.1`, …) after a change; callers move to it through their
Dependabot github-actions updates. A breaking input change is a new major.

### v1.3.1 (not tagged yet)

- `actions/commit-check/check-commit-msg.cjs`: the `.versionrc.{js,cjs,json}`
  is looked up at `git rev-parse --show-toplevel`, falling back to the working
  directory outside a repo (was: the working directory only, so a run from a
  subdirectory silently used the default types; keksdose N5). Still
  dependency-free; `validate()` and `TYPES` unchanged. Tests in
  `tests/check-commit-msg.test.cjs`. README: where to hook the commit checks.

### v1.3.0

- `actions/commit-check/check-pushed-commits.cjs`: the pre-push check of the
  commit messages a push sends (from keksdose's copy; the default branch from
  `<remote>/HEAD` instead of a hard-coded `origin/main`; the remote as an
  argument; a root commit and an unfetched remote sha no longer throw). Tests in
  `tests/check-pushed-commits.test.cjs`. The action itself is unchanged.
