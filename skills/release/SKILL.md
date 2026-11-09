---
name: release
description: Release one unit of this repo with release-kit. Walk the user through a hand sign-off of each change, taking their notes as they test, then prepare the release and hand off to the release workflow. Run only when the user types /release.
disable-model-invocation: true
argument-hint: "[<unit>] <version>, e.g. rcl-core 0.4.0"
---

# Release one unit

The user ran `/release $ARGUMENTS`. **You prepare; the user publishes.**

## Rules

- Never create or push a release tag, create a GitHub Release, or start or approve a release workflow. The workflow creates the tag and the release; only the user starts it and approves it.
- Push or open a PR only when the user asks.
- The user decides. You propose; they confirm the list of checks, each issue (title, kind, unit, Priority, milestone) and the sign-off. Nothing goes to GitHub before they confirm it.
- Your own testing stays out of the record. If something you try yourself fails, tell the user it's a probable bug, for them to keep or dismiss.
- Here, `release.mjs <command>` means `node "${CLAUDE_PLUGIN_ROOT}/scripts/release.mjs" <command>`, run from the repo root. Keep the quotes: the plugin's folder may have spaces in it.

## 1. Load

1. Read `release-kit.json` at the repo root. Without it, stop: the repo isn't set up for release-kit.
2. The unit and version come from `$ARGUMENTS`: `<unit> <version>`, or just `<version>` when the config has one unit. Ask for what's missing. The version is semver without a leading `v`.
3. Run `release.mjs meta <version> --unit <unit>` for the release's names: `TAG`, `MILESTONE`, `RELEASE_NAME` and `BRANCH`.
4. Run `release.mjs pinned --unit <unit>`. If it prints a ref other than `v` plus the `version` in `"${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"`, warn the user: CI will run the kit at that ref, which may check the record differently from this one. `none` means the unit releases through a workflow in its own repo, such as the kit itself: no warning.

## 2. Scope (gate 1)

1. Show the `## [Unreleased]` section of the unit's changelog. If it has no entries, stop: there's nothing to release.
2. Check the milestone: `gh api --paginate "repos/<repo>/milestones?state=all&per_page=100" | jq -s add | release.mjs milestone <version> --unit <unit>`. Report a missing milestone or its open issues: the workflow refuses until they're fixed. Preparing can go on meanwhile.
3. Ask in plain text: "Release <unit> <version>?" Wait for yes.

## 3. Branch

- If `BRANCH` exists, switch to it: this is a resumed release. If main has moved since, see "When main moves".
- Otherwise, create it from an up-to-date main.

## 4. Sign-off

The user's own check that each change does what was planned, the way someone using it would try it.

### Draft the checks

- **Sources:** each Unreleased entry, the issue it ends with (`gh issue view <N>`), and that issue's feature page in the config's `specs` folder: its requirements and behavior.
- **One to three checks per entry,** at a high level, in the words of someone using the software. A fix's check is that it's fixed.
- **Each check has** a Feature (its name and issue, e.g. `Import / export (#22)`), Planned (`<page> R<n>`, or a bug's issue), Try (what to do) and Expect (what should happen).
- Show them as a table, then ask in plain text whether to start with them or what to change. Only the user can drop or reword a check.

### The record

Once the list is agreed, create the unit's `signOff` file, with `{version}` filled in:

```markdown
# Sign-off: <RELEASE_NAME>

Tested: `<short sha>` on <today>

| # | Feature | Planned | Try | Expect | Result |
|---|---|---|---|---|---|
| 1 | Import / export (#22) | import-export R5 | … | … | pending |
```

- `Tested:` is `git rev-parse --short HEAD` on the release branch. Ask the user to run that build.
- Each cell is one line. Write a `|` inside a cell as `\|`.
- A result is `pending`, `pass`, `skip`, or `fail: <what happened> (#<issue>, P0|P1|P2)`. `release.mjs check` reads exactly these.
- Commit the record: `chore(<unit>): sign-off checks for v<version>`. Commit it again after each check, `chore(<unit>): sign-off progress for v<version>`, so a pause of days loses nothing.

### Walk through it

- **One check at a time, in plain text:** its number, Feature, Planned, Try and Expect. Then stop and wait. Never offer a multiple-choice prompt for a result.
- **The user replies** with their testing notes, in their own words, and a result: pass or fail, or skip. If there are notes but no result, ask only for the result.
- **Sort the notes and file what they confirm** (below) before you write the result and move on.
- On a resumed release, start at the first `pending` check. A skip still blocks the release: offer skipped checks again at the end.
- When the user asks to try a check again, set it back to `pending` and ask it next. When they raise a blocker no check covers, offer to add a check for it.

### Sorting notes

For each note:

1. **Does it fail a check?** If it means this check's Expect didn't happen, the result is `fail: <what happened>`, with the note as its bug. If it means another check's Expect won't hold, say which. That check gets its result when you reach it, or when it's tried again.
2. **Which unit?** Where the user saw it, which may not be the unit being released. Ask if it's unclear.
3. **Which kind?** A Bug doesn't work as it should. A Change alters something that exists. A Feat is something new. Ask when the kind looks wrong: a Change may be a Bug when the feature page already promises it.
4. **Suggest a Priority.**
   - **P0** blocks a release, and goes in the milestone of the release it blocks. That's this release's milestone when it's this unit. For another unit, it's that unit's next milestone, which the user names. A P0 for another unit never blocks this release.
   - **P1** is wanted soon; **P2** is deferred. Neither goes in a milestone.
5. **Draft this check's issues as one table:** title, kind, unit, Priority and milestone. Write what the user saw, in their words, not a guess at the cause, and don't look into the code. Ask follow-up questions only for what an issue can't do without (a bug's steps, a change's why), one at a time.
6. **The body:** if `.github/ISSUE_TEMPLATE/` has a form for that kind, use its headings, in order. End every body with:

   ```markdown
   ### Found during

   The sign-off of <RELEASE_NAME>, testing `<sha>`, while on check <n> (<its Feature, without the issue number>).
   ```

7. **Wait for the user** to confirm or change the drafts. Then file each one:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/file-issue.mjs" --unit <its unit> --kind <bug|change|feat> --priority <P0|P1|P2> --title '<title>' --label sign-off [--milestone '<milestone>'] --body-file - <<'EOF'` … `EOF`
   Single quotes keep backticks and `$` in a title as typed. Write a `'` inside one as `'\''`.
   It prints the issue's number, and whether Priority was set on the board. If it wasn't, pass on its note so the user can set it by hand.
8. **List it in the record,** under `## Found while testing` below the table (add the heading after a blank line if it isn't there): `- #<N> <Kind>, <P>, while on check <n>: <title>`.
9. **If filing fails,** nothing was filed. Write `- not filed: <Kind>, <P>, while on check <n>: <title>` instead, tell the user what gh said, and offer to try again.

A failed check's result ends with its bug: `fail: <what happened> (#<N>, <P>)`.

### A P0 in this release

It doesn't stop the walk-through: go on with the other checks. The release stays blocked until the P0 is fixed through the normal branch flow, merged to main, and its milestone has no open issues.

### When main moves

If main has moved past `Tested:` (a P0 fix, or other work):

1. Rebase the release branch onto main.
2. List the commits and changed files since `Tested:`. Suggest which checks to try again from what changed, and let the user choose.
3. Set those back to `pending`, move `Tested:` to the new commit, and remove any `Signed off:` line.
4. For each P0 change or feat in `## Found while testing` that has now landed, add a check for it.

### Sign it off (gate 2)

1. When every check has a result, look for what still blocks the release: a check that's `pending` or `skip`, one that failed with a P0, a `not filed:` note, or an open issue in the milestone (run the milestone check again). If there's any, list it and stop: the release can't be signed off yet. Offer to try those checks again, or to file the note. Never change a result without the user.
2. Show the table, and the Found while testing list, then ask: "Sign off <unit> <version>?"
3. On yes, add `Signed off: <today> by <signer>` below `Tested:`, run `release.mjs check <version> --unit <unit>`, and commit. Until prepare runs, it also reports the changelog and version files. If it reports a sign-off problem, the record doesn't say what the user decided: show them the problem, and change only what they confirm.
4. Changing a result afterwards removes the `Signed off:` line until the user is asked again.

## 5. Prepare

1. Run `release.mjs prepare <version> --unit <unit>`.
2. Work through each of the unit's `prepareSteps` with the user.
3. Run `release.mjs check <version> --unit <unit>`. It should pass: show the user anything it reports, and fix the changelog or version files with them. A sign-off problem goes back to "Sign it off".
4. Show `git diff`, and read the notes through with the user: one bullet per change someone would notice, written for them. Flag jargon, and anything that isn't such a change. Edit only what they ask.
5. Commit once they confirm: `chore(<unit>): prepare v<version>`.

## 6. Hand off, then stop

Tell the user the remaining steps, all theirs:

1. Get the release branch onto main their usual way.
2. In GitHub, go to Actions ▸ **<unit> release** ▸ Run workflow, on main, with version `<version>`.
3. When Verify has passed, read the notes in its summary, then approve the `release` environment. Rejecting it ends the run, and nothing is published.
