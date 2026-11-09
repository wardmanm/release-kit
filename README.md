# release-kit

One release process for every project: a hand sign-off of each change, a prepare step that writes the release notes and versions, and a publish that waits for your approval.

- **The `/release` skill** (Claude Code) walks you through the sign-off one check at a time, taking your notes as you test and filing them as issues. Then it prepares the release on a branch.
- **The release workflow** (GitHub Actions), which each project calls, verifies the release and then waits for your approval before it tags, publishes, closes the milestone and comments "Released in" on each issue.

Each project adds only a `release-kit.json` and one small workflow per unit. Agents prepare; only you start the workflow and approve it.

## Install

The plugin goes on each machine you release from:

```text
/plugin marketplace add wardmanm/release-kit
/plugin install release-kit@release-kit
```

Or commit this to the project's `.claude/settings.json`, so the plugin is offered when the project is opened in a trusted folder:

```json
{
  "extraKnownMarketplaces": {
    "release-kit": { "source": { "source": "github", "repo": "wardmanm/release-kit" } }
  },
  "enabledPlugins": { "release-kit@release-kit": true }
}
```

On a machine with no GitHub SSH key, such as a fresh Windows install, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` first. Update with `claude plugin update release-kit@release-kit`, between releases and never during a sign-off.

Then run `/release <unit> <version>`, or `/release <version>` in a repo with one unit.

## The config file

`release-kit.json`, at the repo root:

| Field | Type | Meaning |
|---|---|---|
| `repo` | `"owner/name"` | The GitHub repo |
| `node` | number | Node major for CI |
| `signer` | string | Name in `Signed off: … by <signer>` |
| `specs` | string, optional | Folder of feature pages Claude reads for each check's Planned |
| `ci` | string[] | Shell commands CI runs in order before approval |
| `units.<id>.name` | string | Release name prefix: `<name> v<version>` |
| `units.<id>.changelog` | path | A [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) file |
| `units.<id>.versionFiles` | array | A string is a JSON file or a one-`*` glob such as `rcl-core/*/package.json`, whose top-level `version` is set. `{file, pattern}` is a text file whose line matching `pattern` gets the version; `pattern` contains `{version}` |
| `units.<id>.tagPrefix` | string | Tag = prefix + version |
| `units.<id>.milestone` | template | Must contain `{version}` |
| `units.<id>.signOff` | template | The sign-off record's path. Must contain `{version}` |
| `units.<id>.label` | string, optional | The unit's issue label |
| `units.<id>.board` | number, optional | A Projects board with a Priority field. Without one, Priority isn't set |
| `units.<id>.prepareSteps` | string[], optional | Plain-language steps Claude works through with you during Prepare |

Rollcall's, with two units, is the fullest example: [`rollcall_derby/release-kit.json`](https://github.com/wardmanm/rollcall_derby/blob/main/release-kit.json). The kit's own is [`release-kit.json`](release-kit.json).

## The caller workflow

One per unit, named `<unit>-release.yml`:

```yaml
name: rcl-core release

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to release, without a leading v (e.g. 0.4.0)'
        required: true
        type: string

concurrency:
  group: rcl-core-release
  cancel-in-progress: false

permissions: {}

jobs:
  release:
    uses: wardmanm/release-kit/.github/workflows/release.yml@v1.0.0
    permissions:
      contents: write
      issues: write
    with:
      unit: rcl-core
      version: ${{ inputs.version }}
```

The `@v1.0.0` pins the kit version CI runs. `/release` warns when the plugin on your machine is a different version.

## The process

Every release takes the same steps, and three of them are yours:

1. **Scope.** `/release` shows what's shipping and checks the milestone. You confirm the exact version.
2. **Sign off.** One check at a time: you test it, then reply with your notes and pass or fail. Notes become issues, which you confirm before they're filed. A P0 goes in the milestone of the release it blocks; P1s and P2s go outside it. You sign off at the end.
3. **Prepare.** The changelog's Unreleased notes move under the version, the version files are bumped, and you read the notes through. This is committed on `release/<unit>-v<version>`.
4. **Merge** the release branch to main, your usual way.
5. **Run** Actions ▸ `<unit> release` on main, with the version.
6. **Verify.** The workflow checks the tag is free, the changelog, version files and sign-off are ready, the milestone has no open issues, and the project's `ci` commands pass. Its summary shows the notes.
7. **Approve** the `release` environment, or reject it to stop.
8. **Publish.** The workflow tags the verified commit, creates the GitHub Release, closes the milestone and comments "Released in" on each issue.

## What each project needs on GitHub

- **A `release` environment** with you as its required reviewer, deploying only from `main`. On a free plan, required reviewers work only on public repos.
- **A tag ruleset** that blocks updating or deleting release tags, and **immutable releases** turned on, so a published version's tag can never be reused.
- **A milestone for every release**, patches included, titled from the unit's `milestone` template.
- **A board per unit** with a **Priority** field (options P0, P1 and P2), when you want Priority set on the issues the sign-off files.
- **Labels:** `bug`, `enhancement`, `sign-off`, and each unit's `label`.

## License

MIT. See [LICENSE](LICENSE).
