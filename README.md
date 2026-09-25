# shared-workflows

Reusable GitHub Actions workflows and composite actions shared by the Eifi1 apps (kastlan, keksdose,
lenkbank, …). One copy of each job lives here; every app calls it from a
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

This repo is private. Its workflows are callable by the other Eifi1 repos
because Settings → Actions → General → **Access** is set to "Accessible from
repositories owned by the user 'Eifi1'".

That covers **private** repos only. GitHub never lets a **public** repository
use actions or reusable workflows from a private one, whatever the access
setting says (the run fails with "Unable to resolve action … not found").
ui-kit is public and therefore keeps local copies. Making this repo public
(it holds only generic scripts, no secrets) would lift that.

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
