# shared-workflows

Reusable GitHub Actions workflows shared by the Eifi1 apps (kastlan, keksdose,
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

## Releasing

Tag a release (`v1.0.1`, …) after a change; callers move to it through their
Dependabot github-actions updates. A breaking input change is a new major.
