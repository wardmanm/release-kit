# release-kit v1, and Rollcall onto it: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build release-kit v1, one shared release process packaged as a Claude Code plugin plus a reusable GitHub workflow, and move Rollcall onto it, ending with rcl-core 0.4.0 released through it.

**Architecture:** A public repo, `wardmanm/release-kit`, is both a plugin marketplace and its only plugin. Its `release` skill runs the sign-off and the prepare step locally, calling zero-dependency Node scripts bundled in the plugin. Its reusable workflow runs the same scripts in CI to verify a release and, after approval, publish it. Each project keeps only a `release-kit.json` and one small caller workflow per unit.

**Tech Stack:** Node ≥ 24 built-ins only (`node:test`, `node:fs`, `node:child_process`), GitHub Actions, the `gh` CLI, and Claude Code plugin skills.

**Spec:** The Claude Doc "One release process for Fieldbook, Mythos and Rollcall" (https://claude.ai/artifact/QaKYuqaNUDTf7kDR2HdMta). The relevant sections are The shared release process, What stays project-specific, How to share it, Adding a project, What a mock release showed, and Migration plan. Decisions 1, 2, 5 and 6 are Option A (Mike, 2026-11-09). The kit is grown from Rollcall's current process, so read these too:
- in `rollcall_derby`: `scripts/release.mjs`, `scripts/release.test.mjs`, `scripts/release-workflows.test.mjs`, `.github/workflows/release.yml`, `.claude/skills/release/SKILL.md`, `docs/guides/releasing.md`, ADR-0021 and ADR-0025;
- `.claude/skills/sign-off-notes/SKILL.md`, on branch `feat/sign-off-notes`.

## Scope

**In:**
- the kit: its scripts, the `release` skill, the reusable workflow, and its own first release;
- Rollcall's move onto it;
- the rcl-core 0.4.0 release.

**Out,** each in its own plan once this one ships:
- the `issue`, `status` and `release-kit init` skills, and the shared CLAUDE.md rules;
- per-platform result columns (Mythos);
- plain-text notes, data and private releases, and the pre-drive (Fieldbook).

A setting joins the config only when a project needs it.

## Global Constraints

- Scripts use Node built-ins only, with no dependencies. They are ES modules (`.mjs`) and need Node ≥ 24.
- Agents never create or push a release tag, create a GitHub Release, start a release workflow, or approve one.
- Names, for unit `u` and version `v`:
  - tag: `<tagPrefix><v>`;
  - milestone: the unit's `milestone` template, with `{version}` filled in;
  - release name: `<name> v<v>`;
  - branch: `release/<u>-v<v>`;
  - commit: `chore(<u>): prepare v<v>`.
- **Every release has a milestone**, including patches, and there are no version labels. A release is blocked while its milestone has any open issue.
- **Priorities:**
  - P0 blocks the release, and goes in the milestone of the release it blocks.
  - P1 is high but ships, and P2 is deferred. Both go outside the milestone.
- **The sign-off record keeps ADR-0025's format,** so the existing `rcl-core/sign-off/0.4.0.md` still reads:
  - title `# Sign-off: <release name>`, then `` Tested: `<sha>` on YYYY-MM-DD `` and `Signed off: YYYY-MM-DD by <signer>`;
  - one table, `| # | Feature | Planned | Try | Expect | Result |`, then `## Found while testing`;
  - a result is `pending`, `pass`, `skip`, or `fail: <what happened> (#N, P0|P1|P2)`, and a skip still blocks the release.
- **The walk-through:**
  - Each check is given as plain text: Feature, Planned, Try and Expect.
  - Claude then waits for the user's notes and their pass or fail. There are no multiple-choice prompts for a result.
  - Notes are sorted and filed before the next check, and there's no second window.
- **The release workflow runs once per release.** It verifies, then publish waits for approval in the caller repo's `release` environment. There's no dry-run input.
- **The kit repo is public,** which cross-repo reusable workflows and required reviewers on this GitHub plan both need.

## Review Focus

1. **A typo in `release-kit.json`,** such as a missing field, a wrong type, or a template without `{version}`. Expect an error naming the file, the unit and the field, not a crash later. Test: Task 1.
2. **A filed issue whose card never reaches the board,** because the label isn't wired to a board or the board adds cards slowly. Expect the script to add the card itself, carry on past "Content already exists", and if Priority still can't be set, report the issue as filed with Priority not set, without failing. Test: Task 6.
3. **`gh` failing in the middle of a sign-off,** for example offline or with an expired login. Expect nothing half-filed, and the note kept in the record as not filed so it isn't lost. Test: Task 6; the skill rule: Task 8.
4. **The machine's plugin is a different kit version from the one the unit's caller workflow pins,** so `check` passes locally but CI's fails. Expect a warning when `/release` starts. Test: Task 4, `pinnedKitRef`; the warning: Task 8.
5. **`${CLAUDE_PLUGIN_ROOT}` expanding to a path with spaces or Windows separators.** Expect every command still to run. Test: Task 8 (every script path in SKILL.md is quoted).

## File structure

The kit lives in `/Users/mwardman/Documents/Repos/release-kit`, which is local until Task 9:

```
.claude-plugin/plugin.json        manifest: name release-kit, version (the one place the version lives)
.claude-plugin/marketplace.json   this repo as its own marketplace: one plugin, source "./"
skills/release/SKILL.md           /release: scope, sign-off walk-through, prepare, hand-off
scripts/config.mjs                load and validate release-kit.json
scripts/version.mjs               semver parse, compare and validate
scripts/changelog.mjs             Keep a Changelog parse and format; moving Unreleased under a version
scripts/signoff.mjs               the sign-off record: parse it, and what keeps it from letting a release through
scripts/guards.mjs                tag absent, milestone ready, issue refs, the kit version a caller pins
scripts/release.mjs               prepare, check, notes, and the CLI
scripts/file-issue.mjs            create an issue, put it on the unit's board, set Priority
scripts/<module>.test.mjs         one test file per module
scripts/workflows.test.mjs        keeps the workflows in step with the scripts
scripts/skill.test.mjs            keeps SKILL.md in step with the scripts
.github/workflows/release.yml     reusable: verify, then publish after approval
.github/workflows/release-kit-release.yml   the kit's own caller
.github/workflows/test.yml        node --test on every push and PR
.github/dependabot.yml            weekly github-actions updates
release-kit.json                  the kit's own config (unit release-kit)
CHANGELOG.md, sign-off/           the kit's own release notes and sign-off records
README.md                         install, config reference, caller example, GitHub settings
```

Rollcall's changes are listed in Tasks 11 and 12.

## The config file: `release-kit.json` at the repo root

| Field | Type | Meaning |
|---|---|---|
| `repo` | `"owner/name"` | GitHub repo. `owner` is derived from it |
| `node` | number | Node major for CI |
| `signer` | string | Name in `Signed off: … by <signer>` |
| `specs` | string, optional | Folder of feature pages Claude reads for each check's Planned |
| `ci` | string[] | Shell commands CI runs in order before approval |
| `units.<id>.name` | string | Release name prefix: `<name> v<version>` |
| `units.<id>.changelog` | path | Keep a Changelog file |
| `units.<id>.versionFiles` | array | A string is a JSON file or a one-`*` glob such as `rcl-core/*/package.json`, whose top-level `version` is set. `{file, pattern}` is a text file whose line matching `pattern` gets the version: `pattern` contains `{version}`, which matches any semver |
| `units.<id>.tagPrefix` | string | Tag = prefix + version |
| `units.<id>.milestone` | template | Must contain `{version}` |
| `units.<id>.signOff` | template | Record path. Must contain `{version}` |
| `units.<id>.label` | string, optional | The unit's issue label |
| `units.<id>.board` | number, optional | The Projects board with a Priority field. Without one, Priority isn't set |
| `units.<id>.prepareSteps` | string[], optional | Plain-language steps Claude does with the user during Prepare |

Rollcall's config (Task 11):

```json
{
  "repo": "wardmanm/rollcall_derby",
  "node": 24,
  "signer": "Mike",
  "specs": "docs/features",
  "ci": [
    "corepack enable",
    "yarn install --immutable",
    "yarn check",
    "yarn build",
    "yarn workspace @rollcall/e2e playwright install --with-deps chromium",
    "yarn test:stories",
    "yarn test:e2e"
  ],
  "units": {
    "rcl-core": {
      "name": "Rollcall Core",
      "changelog": "rcl-core/CHANGELOG.md",
      "versionFiles": ["rcl-core/*/package.json"],
      "tagPrefix": "rcl-core-v",
      "milestone": "rcl-core v{version}",
      "signOff": "rcl-core/sign-off/{version}.md",
      "label": "rcl-core",
      "board": 6,
      "prepareSteps": [
        "Check each other app's rollcall.requiresCore range in rcl-*/server/package.json. If the new version is outside it, ask the user whether that app works with it, and change the range only if they confirm (ADR-0019). yarn check fails until the range covers the new version."
      ]
    },
    "rcl-producer": {
      "name": "Rollcall Producer",
      "changelog": "rcl-producer/CHANGELOG.md",
      "versionFiles": ["rcl-producer/*/package.json"],
      "tagPrefix": "rcl-producer-v",
      "milestone": "rcl-producer v{version}",
      "signOff": "rcl-producer/sign-off/{version}.md",
      "label": "rcl-producer",
      "board": 8
    }
  }
}
```

The kit's own config (Task 1):

```json
{
  "repo": "wardmanm/release-kit",
  "node": 24,
  "signer": "Mike",
  "ci": ["node --test \"scripts/*.test.mjs\""],
  "units": {
    "release-kit": {
      "name": "release-kit",
      "changelog": "CHANGELOG.md",
      "versionFiles": [
        ".claude-plugin/plugin.json",
        { "file": ".github/workflows/release.yml", "pattern": "KIT_REF: v{version}" }
      ],
      "tagPrefix": "v",
      "milestone": "v{version}",
      "signOff": "sign-off/{version}.md"
    }
  }
}
```

---

### Task 1: Scaffold the kit, and load its config

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `release-kit.json` (above), `CHANGELOG.md`, `README.md` (headings only), `.gitignore`, `.github/workflows/test.yml`, `.github/dependabot.yml`
- Create: `scripts/config.mjs`
- Test: `scripts/config.test.mjs`

**Interfaces:**
- Produces:
  - `loadConfig(root: string): Config`. It throws an `Error` whose message starts with `release-kit.json:` and names the unit and field.
  - `unitOf(config: Config, id?: string): Unit`. With `id` omitted it picks the only unit. For an unknown id it throws, listing the valid ids and showing the input JSON-escaped.
  - `fill(template: string, version: string): string`, which replaces every `{version}`.
  - `Config = {repo, owner, node, signer, specs?, ci: string[], units: Record<string, Unit>}`.
  - `Unit = {id, name, changelog, versionFiles, tagPrefix, milestone, signOff, label?, board?, prepareSteps: string[]}`.

- [ ] **Step 1: Write the failing tests**
  - `loadConfig reads a valid config and derives owner from repo`: the kit's own `release-kit.json` gives `owner === 'wardmanm'`, unit `release-kit` with `prepareSteps` defaulting to `[]`.
  - `loadConfig names the file, unit and field for each bad field`: table of cases, each asserting `assert.throws(..., /^Error: release-kit\.json: /)` and the field path:
    - no `units` → `units`;
    - a unit missing `changelog` → `units.x.changelog`;
    - `board: "6"` → `units.x.board must be a number`;
    - `milestone: "v1"` → `units.x.milestone must contain {version}`;
    - `signOff` without `{version}`;
    - `repo: "rollcall"` → `repo must be owner/name`;
    - a `versionFiles` object without `pattern`;
    - a `pattern` without `{version}`.
  - `loadConfig fails clearly when release-kit.json is missing`, with a message containing `no release-kit.json in`.
  - `unitOf picks the only unit, or the named one, and lists valid ids for an unknown one without echoing it raw`, where `unitOf(cfg, 'a\nb')` throws with a message containing `"a\\nb"` and `rcl-core, rcl-producer`.
  - `unitOf requires an id when there are several units`.
- [ ] **Step 2: Run them and see them fail.** Run `node --test scripts/config.test.mjs`. Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement `scripts/config.mjs`.** Write the validation as plain checks, with no schema library.
- [ ] **Step 4: Write the scaffold files.**
  - `plugin.json`: `{"name":"release-kit","version":"1.0.0","description":"One release process: a hand sign-off, prepare, and a publish you approve","author":{"name":"wardmanm"}}`. Set the version only here, never in `marketplace.json`, as the docs say.
  - `marketplace.json`: `{"name":"release-kit","owner":{"name":"wardmanm"},"plugins":[{"name":"release-kit","source":"./","description":"One release process: a hand sign-off, prepare, and a publish you approve"}]}`.
  - `CHANGELOG.md`: a Keep a Changelog preamble and `## [Unreleased]` with `### Added` and one line, "The release skill, release script, issue filing script and reusable release workflow".
  - `test.yml`: on `push` and `pull_request`, `ubuntu-latest`, `actions/checkout@v7`, `actions/setup-node@v7` with Node 24, then `node --test "scripts/*.test.mjs"`.
  - `dependabot.yml`: the `github-actions` ecosystem, weekly, with commit prefix `ci`.
- [ ] **Step 5: Run the tests and see them pass.** Run `node --test "scripts/*.test.mjs"`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: plugin scaffold and config loader`.

### Task 2: Versions and the changelog (ported)

**Files:**
- Create: `scripts/version.mjs`, `scripts/changelog.mjs`
- Test: `scripts/version.test.mjs`, `scripts/changelog.test.mjs`

**Interfaces:**
- Produces:
  - from `version.mjs`: `parseVersion`, `versionError`, `compareVersions`, ported unchanged from Rollcall `release.mjs` lines 41–74;
  - from `changelog.mjs`: `parseChangelog`, `formatChangelog`, `isUnreleased`, `hasEntries`, `releasedVersions`, `latestVersion` and `DATE`, ported unchanged from lines 76–129;
  - `moveUnreleased(text: string, {version, date, repoUrl, tagPrefix}): string`, extracted from Rollcall's `prepare` lines 147–166. It throws for: no Unreleased section, a version that already has a section, no entries, or a version not greater than the latest.

- [ ] **Step 1: Port the tests.** Take Rollcall `release.test.mjs` tests 54–237 and 239–340 (the ones that exercise the changelog, not package files), with `prepare(...)` calls replaced by `moveUnreleased(...)` on the text. Add `moveUnreleased links the new section and Unreleased to this repo's tags`, which asserts that the footer starts with `[Unreleased]: https://github.com/o/r/compare/x-v1.0.0...HEAD` and `[1.0.0]: https://github.com/o/r/releases/tag/x-v1.0.0`.
- [ ] **Step 2: Run them and see them fail.** Run `node --test scripts/version.test.mjs scripts/changelog.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Port the code.** Rename nothing except what moves into `moveUnreleased`.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat: versions and changelog, from Rollcall's release.mjs`.

### Task 3: The sign-off record (ported)

**Files:**
- Create: `scripts/signoff.mjs`
- Test: `scripts/signoff.test.mjs`

**Interfaces:**
- Produces:
  - `parseSignOff(text): {title, tested, signedOff, rows: {number, feature, planned, try, expect, result}[]}`, ported from Rollcall lines 226–253;
  - `signOffErrors(text: string, {file: string, releaseName: string}): string[]`, ported from lines 255–284. It takes the file and release name instead of an app.

- [ ] **Step 1: Port the tests.** Take Rollcall tests 398–481: the parse with escaped pipes, the Found-while-testing list ignored, the pass and fail rules, and the unsigned record, the wrong title, and the record with no checks or no Tested line. Add `parseSignOff reads a record with CRLF line endings`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Port the code.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat: sign-off record checks, from Rollcall's release.mjs`.

### Task 4: Guards

**Files:**
- Create: `scripts/guards.mjs`
- Test: `scripts/guards.test.mjs`

**Interfaces:**
- Produces:
  - `tagStatus(tag: string, {cwd, remote = 'origin'}): 'exists' | 'absent'`, which throws when the remote can't be read. Ported from lines 297–303, taking the full tag.
  - `milestoneCheck(milestones: object[] | null, title: string): {milestone: {number, url} | null, errors: string[]}`. A milestone is always required.
  - `issueRefs(text): number[]`, ported from lines 334–338.
  - `KIT_REPO = 'wardmanm/release-kit'`.
  - `pinnedKitRef(root: string, unitId: string): string | null`. It reads `.github/workflows/<unitId>-release.yml` and returns the ref after `wardmanm/release-kit/.github/workflows/release.yml@`. It returns `null` when the file is missing or calls a local workflow.

- [ ] **Step 1: Write the tests.**
  - Port Rollcall tests 584–663: the `gitRepoWithRemote` fixture, the existing and absent tag, and the unreadable remote.
  - Port the milestone tests, then change `milestoneCheck lets patch and pre-releases go without a milestone` into `a patch or pre-release needs its milestone too`. That test expects the error `no milestone titled 'x v0.1.1'. Create it and assign this release's issues to it.`
  - Add `pinnedKitRef reads the kit version a unit's caller pins` (fixture `uses: wardmanm/release-kit/.github/workflows/release.yml@v1.0.0` gives `'v1.0.0'`).
  - Add `pinnedKitRef is null when the caller is missing or calls a local workflow`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat: tag, milestone and kit-version guards`.

### Task 5: `release.mjs`: prepare, check, notes, and the CLI

**Files:**
- Create: `scripts/release.mjs`
- Test: `scripts/release.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `prepare(root, unit: Unit, version, {date?}): {files: string[]}`;
  - `check(root, unit: Unit, version): string[]`;
  - `notes(root, unit, version): string`;
  - `COMMANDS = ['prepare','check','notes','name','meta','tag-absent','milestone','issues','pinned','ci']`;
  - `main(args: string[], {cwd = process.cwd()}): number`.
- CLI: `node release.mjs <command> <version> [--unit <id>] [--root <dir>] [--date YYYY-MM-DD]`. `--root` defaults to the current directory, because the script lives in the plugin, not in the project. `pinned` and `ci` take no version.
  - `prepare` moves Unreleased under the version and sets the version in every `versionFiles` target. It prints each file and `review the diff, then commit: chore(<id>): prepare v<version>`.
  - `check` reports every problem:
    - the changelog: a dated section with entries, Unreleased empty, and a version greater than the previous one;
    - every version file at this version: the JSON `version` field, or the line matching `pattern`;
    - the sign-off record at `fill(unit.signOff)`, through `signOffErrors`. A missing record says `run /release <id> <version> and finish the sign-off`.
  - `meta` prints `TAG=…`, `MILESTONE=…`, `RELEASE_NAME=…` and `BRANCH=…`, one per line, for `$GITHUB_ENV`.
  - `tag-absent`, `milestone` (the API JSON on stdin) and `issues` behave as in Rollcall.
  - `pinned` prints the ref, or `none`.
  - `ci` runs `config.ci` in order, through `spawnSync` with `shell: true` and inherited stdio. It wraps each in `::group::<command>` and `::endgroup::`, and stops at the first failure with that command's exit code.

- [ ] **Step 1: Write the tests.**
  - Port Rollcall's prepare, check and CLI tests (239–400 and 512–595, 654–760) onto a temp-dir fixture that has a two-unit `release-kit.json`, replacing `--app` with `--unit`.
  - Add these:
    - `prepare bumps every file a versionFiles glob matches, and nothing else`;
    - `prepare refuses a versionFiles glob that matches no file`;
    - `prepare and check handle a pattern versionFiles entry` (a `KIT_REF: v0.9.0` line becomes `KIT_REF: v1.0.0`, and `check` flags a stale one);
    - `meta prints the names the workflow uses` (exactly the four lines, for unit `rcl-core` at `0.4.0`: `TAG=rcl-core-v0.4.0`, `MILESTONE=rcl-core v0.4.0`, `RELEASE_NAME=Rollcall Core v0.4.0`, `BRANCH=release/rcl-core-v0.4.0`);
    - `ci runs each command in order and stops at the first failure` (commands `node -e "require('fs').writeFileSync('a','')"`, `node -e "process.exit(3)"` and `node -e "require('fs').writeFileSync('c','')"`, expecting exit 3, `a` existing and `c` not);
    - `--root defaults to the current directory`;
    - `a command without --unit in a two-unit repo prints usage and exits 2, changing nothing`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** The glob is one `*` per path segment, matched with `readdirSync`. Don't add a glob library.
- [ ] **Step 4: Run them and see them pass.** Run `node --test "scripts/*.test.mjs"`.
- [ ] **Step 5: Commit** `feat: release.mjs CLI driven by release-kit.json`.

### Task 6: `file-issue.mjs`

**Files:**
- Create: `scripts/file-issue.mjs`
- Test: `scripts/file-issue.test.mjs`

**Interfaces:**
- Consumes: `loadConfig` and `unitOf`.
- Produces:
  - `fileIssue({config, unit, kind: 'bug'|'change'|'feat', priority: 'P0'|'P1'|'P2', title, body, milestone?, labels?: string[]}, {gh, sleep}): Promise<{number, url, priority: 'P0'|'P1'|'P2'|'not set', note?: string}>`;
  - `gh(args: string[]): {status, stdout, stderr}`;
  - CLI: `node file-issue.mjs --unit <id> --kind <k> --priority <p> --title <t> [--milestone <title>] [--label <l>]... --body-file <path|-> [--root <dir>]`, which prints the result as JSON and exits 0, or 1 when the issue couldn't be created.
- Behaviour:
  - **Labels:** `bug` for a bug, `enhancement` for a change or feat, then the unit's label, then any `--label`.
  - **Milestones:** a P0 must have `--milestone`, and a P1 or P2 must not.
  - **Creating it:** `gh issue create --repo <repo> --title … --label … [--milestone …] --body-file -`. The number comes from the URL it prints.
  - **The board,** only when `unit.board` is set:
    1. Find the card with `gh project item-list <board> --owner <owner> --format json --limit 1000`. Try up to 5 times, 3 s apart.
    2. If it's still missing, run `gh project item-add <board> --owner <owner> --url <url>`. Treat "Content already exists" as success, then list again.
    3. Get the field and option ids from `gh project field-list`, and the project id from `gh project view --format json --jq .id`.
    4. Set it with `gh project item-edit`.
  - **When a board step fails:** report `priority: 'not set'`, with a note naming the board.
  - **When `issue create` fails:** throw with gh's stderr, and call nothing else.

- [ ] **Step 1: Write the tests,** with a fake `gh` that records its calls and returns scripted replies, and a `sleep` that does nothing:
  - `files a P2 bug with its labels and no milestone, then sets Priority on the unit's board`: assert the exact `issue create` args, and an `item-edit` with the P2 option id;
  - `a P0 needs a milestone, and a P1 or P2 refuses one`;
  - `adds the card itself when the board hasn't, and carries on past "Content already exists"`;
  - `asks for up to 1000 cards when looking for the card` (every `item-list` call includes `--limit 1000`);
  - `reports Priority not set, without failing, when the board can't be updated`;
  - `skips the board for a unit without one, and says so`;
  - `stops with gh's message when the issue can't be created, and calls nothing else`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat: file an issue onto the unit's board with its Priority`.

### Task 7: The reusable workflow, and the kit's own caller

**Files:**
- Create: `.github/workflows/release.yml`, `.github/workflows/release-kit-release.yml`
- Test: `scripts/workflows.test.mjs`

**Interfaces:**
- Consumes: the CLI from Task 5.
- Produces, for Task 11: callers use `uses: wardmanm/release-kit/.github/workflows/release.yml@v<version>` with inputs `unit` and `version`, and permissions `contents: write` and `issues: write`.

`release.yml`:
- `on: workflow_call` with the inputs `unit` and `version`, both required strings.
- `permissions: {}`, and `env: KIT_REF: v1.0.0`.
- **The verify job** has `contents: read` and `issues: read`, and outputs `sha`. Its steps:
  1. Check the run is on main.
  2. Check out the caller repo with `fetch-depth: 0`.
  3. Get the kit:
     - When `github.repository == 'wardmanm/release-kit'`, set `KIT=.`.
     - Otherwise, check out `wardmanm/release-kit` at `${{ env.KIT_REF }}` into `.release-kit`, and set `KIT=.release-kit`.
  4. Set up Node with the version from `jq -r .node release-kit.json`.
  5. Run `node "$KIT/scripts/release.mjs" meta "$VERSION" --unit "$UNIT" >> "$GITHUB_ENV"`.
  6. Record the sha.
  7. Run `tag-absent`, then `check`.
  8. Run the milestone check: `gh api --paginate …/milestones?state=all&per_page=100 | jq -s add | node … milestone`.
  9. Run `ci`.
  10. Write the notes to the step summary, ending "Checks passed. **Publish** is waiting for approval in the `release` environment."
- **The publish job** needs verify, has `environment: release`, and `contents: write` and `issues: write`. Its steps:
  1. Check out the verified sha, get the kit, set up Node, and run `meta`.
  2. Check the tag and milestone again, and set `MILESTONE_NUMBER` and `MILESTONE_URL`.
  3. Build the notes: the changelog notes, the milestone link, and its closed issues.
  4. Run `gh release create "$TAG" --target "$SHA" --title "$RELEASE_NAME" --notes-file …`, adding `--prerelease` when the version contains `-`.
  5. Close the milestone.
  6. Comment `Released in $RELEASE_NAME: <url>` on the issues in the notes and the milestone's closed issues, each once.

`release-kit-release.yml`:
- `name: release-kit release`.
- `on: workflow_dispatch` with the input `version` only.
- `concurrency: release-kit-release`, with `cancel-in-progress: false`.
- `permissions: {}`.
- One job: `uses: ./.github/workflows/release.yml` with `unit: release-kit`, and permissions `contents: write` and `issues: write`.

- [ ] **Step 1: Write the tests.** The workflows are read as text, as in Rollcall's `release-workflows.test.mjs`. There's no YAML parser.
  - `the shared workflow can only be called, never started on its own`;
  - `it takes a unit and a version, and no dry run` (no `dry_run` anywhere in either file);
  - `publishing waits for approval in the release environment, after verify`;
  - `every release.mjs call runs from the kit's folder and names the unit`. Each call matches `node "\$KIT/scripts/release\.mjs" [a-z-]+( "\$VERSION")? --unit "\$UNIT"`, and there are at least 9 calls;
  - `KIT_REF is the version in plugin.json`: `release.yml` contains `KIT_REF: v${plugin.version}`;
  - `the kit's own caller starts by hand only, with a version, and calls the local workflow`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Write the two workflows.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat: reusable release workflow`.

### Task 8: The `release` skill

**Files:**
- Create: `skills/release/SKILL.md`
- Test: `scripts/skill.test.mjs`

**Interfaces:**
- Consumes: the CLI from Task 5, and `file-issue.mjs` from Task 6. The scripts are run as `node "${CLAUDE_PLUGIN_ROOT}/scripts/<name>.mjs"`.

The frontmatter:
- `name: release`, which makes the bare `/release` work when no project skill has that name;
- `description: Release one unit of this repo: a hand sign-off walk-through, prepare, then hand off to the release workflow. Run only when the user types /release.`;
- `disable-model-invocation: true`;
- `argument-hint: "[<unit>] <version>"`.

The body has these sections. Each is a short list of rules, and it should come to about 200 lines at most.
1. **Rules.**
   - Claude prepares and the user publishes. Never push, tag, start the workflow or approve it.
   - The user confirms every issue and the sign-off.
   - Claude's own testing stays out of the record. Its failures reach the user as probable bugs, to keep or dismiss.
2. **Load.**
   - Read `release-kit.json`. Without it, stop: the repo isn't set up for release-kit.
   - Get the unit and version from `$ARGUMENTS`.
   - Run `pinned`. If its ref isn't `v` plus the plugin's version (from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`), warn, and say which one CI will use.
3. **Scope (gate 1).**
   - Show the Unreleased notes, and stop if there are none.
   - Run the milestone check through `gh api`, and report any open issues.
   - Ask in plain text: "Release `<unit>` `<version>`?"
4. **Branch.** Use `meta`'s `BRANCH`. If it exists, resume and rebase it onto main; if not, create it from main.
5. **Sign-off.**
   - **Draft the checks:** one to three per changelog entry, drawn from the entry, its issue (`gh issue view`), and that issue's page in `specs`. Show them as a table, and agree the list in plain text.
   - **Create the record** with every result `pending`, and commit it: `chore(<unit>): sign-off checks for v<version>`.
   - **Each check:**
     - Give the Feature, Planned, Try and Expect as plain text, then wait.
     - If the reply has notes but no result, ask only for the result.
     - Write the result, and commit after each check: `chore(<unit>): sign-off progress for v<version>`.
   - **Sorting notes,** as in Rollcall's `sign-off-notes` skill, steps 2 to 6, adapted:
     - Decide whether the note fails this check, fails another check, or is a separate bug, change or feat.
     - Name the note's unit, and ask if it's unclear. A note's unit can differ from the one being released.
     - Suggest a Priority. A P0 goes in the milestone of the release it blocks: this one when it's the same unit, otherwise that unit's next milestone, which the user names. A P0 for another unit never blocks this release.
     - Draft the issues as one table, with title, kind, unit, Priority and milestone, and get the user's confirmation in their reply.
     - Write the issue body with the headings of the repo's matching form in `.github/ISSUE_TEMPLATE/` when there is one, ending with `### Found during`.
     - File each with `file-issue.mjs`, then add `- #N <Kind>, <P>, while on check <n>: <title>` under `## Found while testing`.
     - If filing fails, write `- not filed: <Kind>, <P>, while on check <n>: <title>` instead, tell the user, and offer to try again.
     - If Priority wasn't set, say so.
   - **A P0 in this release** doesn't stop the walk-through. The release stays blocked until it's fixed.
   - **When main moves:**
     - List the commits and files since `Tested:`, suggest which checks to try again, and let the user choose.
     - Set those back to `pending`, move `Tested:`, and remove any `Signed off:` line.
     - Add a check for each P0 change from `## Found while testing` that has now landed.
   - **Sign it off (gate 2):**
     - Run the milestone check first. With an open issue, say which ones and stop.
     - Ask "Sign off `<unit>` `<version>`?"
     - Add `Signed off: <date> by <signer>`, run `check`, and commit.
6. **Prepare.**
   - Run `prepare`, then work through each of the unit's `prepareSteps` with the user.
   - Run `check`, and show the diff.
   - Read the notes through with the user, flagging jargon and anything that isn't a change someone would notice.
   - Commit `chore(<unit>): prepare v<version>`.
7. **Hand off, then stop.**
   1. The user gets the branch onto main their usual way. Push or open a PR only if they ask.
   2. Actions ▸ **`<unit>` release** ▸ Run workflow on main, with the version.
   3. Read the notes in the run summary, then approve the `release` environment.

- [ ] **Step 1: Write the tests** (text only):
  - `the skill runs only when the user types it` (`name: release` and `disable-model-invocation: true`);
  - `every script path is quoted`: no `${CLAUDE_PLUGIN_ROOT}` that isn't inside a `"…"` path;
  - `it never offers a multiple-choice prompt for a result`: no `AskUserQuestion`;
  - `every release.mjs command it names exists`: each `release.mjs <word>` is in `COMMANDS`;
  - `every file-issue.mjs flag it uses exists`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Write SKILL.md.**
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** `feat: the release skill`.

### Task 9: Publish the kit repo, and try the plugin (outward: with Mike)

- [ ] **Step 1: Write the README.**
  - **Install:** `/plugin marketplace add wardmanm/release-kit`, then `/plugin install release-kit@release-kit`, or the project settings below.
  - **The config reference:** the table above.
  - **A caller workflow example:** Rollcall's, from Task 11.
  - **What each project needs on GitHub:**
    - a `release` environment with a required reviewer, deploying only from main;
    - a tag ruleset that blocks updating or deleting release tags;
    - immutable releases;
    - each unit's board with a Priority field (P0, P1, P2);
    - the labels `bug`, `enhancement`, `sign-off` and the unit labels.
  - **The project settings snippet:**

    ```json
    {"extraKnownMarketplaces":{"release-kit":{"source":{"source":"github","repo":"wardmanm/release-kit"}}},"enabledPlugins":{"release-kit@release-kit":true}}
    ```

    Add a note that the Windows machine needs `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` when it has no GitHub SSH key.
  - Commit `docs: README`.
- [ ] **Step 2: Mike confirms, then create the repo.** Run `gh repo create wardmanm/release-kit --public --source . --push`.
- [ ] **Step 3: Set up the repo**, then read each setting back:
  - **The `release` environment:** `gh api -X PUT repos/wardmanm/release-kit/environments/release`, with reviewer `{type: "User", id: 5400857}` and `deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}`. Then add the branch policy `main`.
  - **The tag ruleset** "Release tags are permanent": target tag, include `refs/tags/v*`, with the rules `update` and `deletion`.
  - **Immutable releases:** in the repository settings. Mike turns it on in the UI if the API can't.
  - **Milestone `v1.0.0`.**
  - Expected: `gh api repos/wardmanm/release-kit/environments --jq '.environments[].protection_rules[].type'` prints `required_reviewers` and `branch_policy`.
- [ ] **Step 4: The test workflow passes on main.** Run `gh run list -R wardmanm/release-kit --workflow test.yml --limit 1`. Expected: `completed success`.
- [ ] **Step 5: Try the plugin from the local folder.**
  1. Run `/plugin marketplace add /Users/mwardman/Documents/Repos/release-kit`, then `/plugin install release-kit@release-kit`, then `/reload-plugins`.
  2. In a scratch copy of Rollcall, with Task 11's `release-kit.json` added and its own `release` skill deleted, run `/release rcl-core 0.4.0`.
  3. Expected: it shows the scope, waits at gate 1, and then gives check 1 as plain text and waits.
  4. Note whether the bare `/release` worked, or only `/release-kit:release`, and put the answer in the README.
  5. Fix anything found before Task 10.

### Task 10: Release kit v1.0.0 (Mike's gates)

- [ ] **Step 1: Run `/release 1.0.0` in the kit repo.** The checks are drafted from `CHANGELOG.md`, for example:
  - the Task 9 trial;
  - `file-issue.mjs` filing one throwaway issue in the kit repo, which is then closed. Mike decides whether to run this one.
  - Mike signs off.
- [ ] **Step 2: Merge the release branch to main.** Mike does this his usual way.
- [ ] **Step 3: Mike runs the release.** Actions ▸ **release-kit release** ▸ Run workflow, with `1.0.0`. He reads the notes in the summary, then approves.
- [ ] **Step 4: Check it published.** Run `gh release view v1.0.0 -R wardmanm/release-kit`. Expected: release "release-kit v1.0.0" exists, and milestone `v1.0.0` is closed.

### Task 11: Rollcall's config, scripts and workflows

Work in a worktree on branch `feat/release-kit`, made from `main`. Don't use `feat/sign-off-notes`: its skill is replaced by this work.

**Files:**
- Create: `release-kit.json` (the config above)
- Create: `scripts/apps.mjs`, which exports `APPS: Record<string, string>` (unit id → name), read from `release-kit.json` beside the script's parent folder
- Modify: `scripts/check-docs.mjs:14`, `scripts/check-docs.test.mjs:10` and `scripts/issue-forms.test.mjs:8`, to import `APPS` from `./apps.mjs`. Rename the two test titles at `check-docs.test.mjs:163` and `:187` from "release.mjs's APPS" to "release-kit.json's units".
- Modify: `.github/workflows/rcl-core-release.yml` and `rcl-producer-release.yml`:
  - the inputs are `version` only;
  - the job is `uses: wardmanm/release-kit/.github/workflows/release.yml@v1.0.0`, with `unit: <app>` and `version: ${{ inputs.version }}`;
  - keep the permissions, the concurrency group and the header comment, with its dry-run line removed.
- Create: `.claude/settings.json`, with the project settings snippet from Task 9.
- Create: `scripts/release-callers.test.mjs`, which replaces `release-workflows.test.mjs`. It checks:
  - every unit in `release-kit.json` has `<unit>-release.yml`, named `<unit> release`;
  - each starts by `workflow_dispatch` only, with the input `version` and no `dry_run`;
  - each has the concurrency group `<unit>-release`;
  - each calls the kit at `@v1.0.0` with `unit: <unit>`;
  - there's no other `*-release.yml`, and `release.yml` is gone.
- Delete: `.github/workflows/release.yml`, `scripts/release.mjs`, `scripts/release.test.mjs`, `scripts/release-workflows.test.mjs`, and `.claude/skills/release/`.

- [ ] **Step 1: Write `release-callers.test.mjs`. Run it and see it fail.** Run `node --test scripts/release-callers.test.mjs`. Expected: FAIL, because `release.yml` still exists and the callers still have `dry_run`.
- [ ] **Step 2: Make the changes listed above.**
- [ ] **Step 3: Run `yarn test:scripts` and `yarn check`.** Expected: both pass.
- [ ] **Step 4: Commit** `feat(repo): releases run on release-kit`.

### Task 12: Rollcall's docs, and ADR-0026

**Files:**
- Create: `docs/decisions/0026-releases-run-on-release-kit.md`, from `docs/templates/adr.md`. It reads `Supersedes ADR-0021 and ADR-0025`, and it restates:
  - from ADR-0021: per-app names, Keep a Changelog notes, "Released in" comments, permanent tags, and SemVer `0.x`;
  - from ADR-0025: the sign-off and its record format.
  - Its new decisions:
    - the tooling lives in `wardmanm/release-kit`, pinned by each caller;
    - every release has a milestone, and the `patch` label goes;
    - one run per release, with no dry run;
    - the walk-through gives each check as text, and notes are filed per check in the same window;
    - the record is committed after each check;
    - a P0 goes in the milestone of the unit it blocks;
    - a P0 change gets its own check when it lands.
  - Hard rule 7's wording is copied unchanged.
- Modify: `docs/decisions/0021-per-app-releases.md` and `docs/decisions/0025-release-sign-off.md`. Change only these: `status: superseded`, `superseded_by: "0026"`, and one line under the title.
- Modify: `AGENTS.md`:
  - hard rule 7's citation becomes ADR-0026, with the wording unchanged;
  - the Layout line for `scripts/`;
  - the Commands row for `release.mjs` becomes `/release <unit> <version>` (the release-kit plugin).
- Modify: `CLAUDE.md`:
  - the Releases bullet: `/release` comes from the release-kit plugin, and there's no `/sign-off-notes`;
  - the session status log: commit it on main only, like the other two projects (migration plan step 3).
- Modify: `rcl-core/AGENTS.md:15` and `rcl-producer/AGENTS.md:15`, to "written by /release (ADR-0026)".
- Modify: `docs/wiki-guide.md:110`, to "the units in `release-kit.json`".
- Modify: `docs/guides/releasing.md`:
  - **Issues:** drop the `patch` bullet.
  - **Milestones:** every release has one.
  - **Cutting a release:** three steps: `/release`, merge, then run and approve.
  - **Notes while you test:** they're given in line.
  - Remove the Dry run section.
  - **Repository settings:** the workflows call the kit, and the labels list no longer has `patch`.

- [ ] **Step 1: Make the changes listed above.**
- [ ] **Step 2: Run `node scripts/check-docs.mjs --fix`, then `yarn check`.** Expected: PASS.
- [ ] **Step 3: Update `.claude/status.md`.**
- [ ] **Step 4: Commit** `docs(repo): ADR-0026, releases run on release-kit`.
- [ ] **Step 5: Mike pushes, opens the PR and merges it,** his usual way.

### Task 13: Release rcl-core 0.4.0 through the kit (Mike's gates)

- [ ] **Step 1: Tidy up, each with Mike's OK.** Delete the `patch` label (no open issue has it). Delete branch `feat/sign-off-notes`, whose skill is replaced, locally and on GitHub if it was pushed.
- [ ] **Step 2: Run `/release rcl-core 0.4.0` on main.**
  - It resumes `release/rcl-core-v0.4.0` (the record is at `89633fd`) and rebases it onto main.
  - Only tooling has changed since `Tested:`, so Mike chooses which checks to redo, likely none: they're all `pending` anyway. `Tested:` moves.
  - Walk the 12 checks, with notes filed along the way. Mike signs off.
- [ ] **Step 3: Prepare.** Its `prepareSteps` include the `requiresCore` question. Setting it to `^0.4.0` is Mike's call: Producer's unreleased skater intros need core 0.4.0's teams service. Then run `check`, show the diff, and commit.
- [ ] **Step 4: Publish.** Mike merges, then runs Actions ▸ **rcl-core release** with `0.4.0`, reads the summary and approves.
- [ ] **Step 5: Check it published.** Run `gh release view rcl-core-v0.4.0 -R wardmanm/rollcall_derby`. Expected:
  - the release exists;
  - milestone 7 is closed;
  - #12, #13, #14, #24 and #25 each have a "Released in Rollcall Core v0.4.0" comment.
- [ ] **Step 6: Wrap up.** File anything awkward as kit issues. Tick the migration plan's step 3 in the Claude Doc. rcl-producer's release comes next, in its own session.
