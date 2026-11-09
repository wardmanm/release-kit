// Ported from Rollcall's scripts/release.test.mjs, plus pinnedKitRef. Run: node --test "scripts/*.test.mjs"
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tagStatus, milestoneCheck, issueRefs, pinnedKitRef } from './guards.mjs';

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function git(cwd, ...args) {
  const r = spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

function gitRepoWithRemote(tags) {
  const root = mkdtempSync(join(tmpdir(), 'kit-git-'));
  roots.push(root);
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  git(root, 'init', '-q', '--bare', remote);
  git(root, 'init', '-q', work);
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'x');
  git(work, 'remote', 'add', 'origin', remote);
  for (const tag of tags) git(work, 'tag', tag);
  git(work, 'push', '-q', '--tags', 'origin', 'HEAD:refs/heads/main');
  return work;
}

test('tagStatus reports an existing release tag', () => {
  assert.equal(tagStatus('rcl-core-v0.1.0', { cwd: gitRepoWithRemote(['rcl-core-v0.1.0']) }), 'exists');
});

test('tagStatus reports a release tag that does not exist yet', () => {
  assert.equal(tagStatus('rcl-core-v0.2.0', { cwd: gitRepoWithRemote(['rcl-core-v0.1.0']) }), 'absent');
});

test("tagStatus matches the whole tag, not another unit's", () => {
  const cwd = gitRepoWithRemote(['rcl-core-v0.1.0', 'v0.2.0']);
  assert.equal(tagStatus('rcl-producer-v0.1.0', { cwd }), 'absent');
  assert.equal(tagStatus('rcl-producer-v0.2.0', { cwd }), 'absent');
});

test('tagStatus fails loudly when the remote cannot be read, instead of assuming absent', () => {
  assert.throws(
    () => tagStatus('rcl-core-v0.1.0', { cwd: gitRepoWithRemote([]), remote: 'no-such-remote' }),
    /could not check tags on no-such-remote/,
  );
});

const MILESTONES = [
  { title: 'rcl-core v0.1.0', number: 1, open_issues: 0, html_url: 'https://example.com/m/1' },
  { title: 'rcl-core v0.2.0', number: 2, open_issues: 3, html_url: 'https://example.com/m/2' },
  { title: 'rcl-producer v0.1.0', number: 3, open_issues: 4, html_url: 'https://example.com/m/3' },
];

test('milestoneCheck returns the milestone when it exists with no open issues', () => {
  assert.deepEqual(milestoneCheck(MILESTONES, 'rcl-core v0.1.0'), {
    milestone: { number: 1, url: 'https://example.com/m/1' },
    errors: [],
  });
});

test('milestoneCheck matches the whole title', () => {
  assert.deepEqual(milestoneCheck(MILESTONES, 'rcl-producer v0.1.0').errors, [
    "milestone 'rcl-producer v0.1.0' still has 4 open issue(s): https://example.com/m/3",
  ]);
  assert.deepEqual(milestoneCheck(MILESTONES, 'rcl-producer v0.2.0').errors, [
    "no milestone titled 'rcl-producer v0.2.0'. Create it and assign this release's issues to it.",
  ]);
});

test('milestoneCheck reports open issues', () => {
  assert.deepEqual(milestoneCheck(MILESTONES, 'rcl-core v0.2.0').errors, [
    "milestone 'rcl-core v0.2.0' still has 3 open issue(s): https://example.com/m/2",
  ]);
});

test('milestoneCheck reports a missing milestone, including when the API returned nothing', () => {
  for (const list of [MILESTONES, [], null]) {
    assert.deepEqual(milestoneCheck(list, 'rcl-core v0.3.0').errors, [
      "no milestone titled 'rcl-core v0.3.0'. Create it and assign this release's issues to it.",
    ]);
  }
});

test('a patch or pre-release needs its milestone too', () => {
  for (const title of ['rcl-core v0.1.1', 'rcl-core v0.3.0-beta.1']) {
    assert.deepEqual(milestoneCheck(MILESTONES, title), {
      milestone: null,
      errors: [`no milestone titled '${title}'. Create it and assign this release's issues to it.`],
    });
  }
});

test('issueRefs lists each referenced issue once, in order, ignoring headings, URLs and cross-repo refs', () => {
  const text =
    '### Fixed\n\n- Roster paging (#20)\n- Photo crop (#7, #20)\n- See owner/repo#99, https://example.com/page#12 and &#38;';
  assert.deepEqual(issueRefs(text), [20, 7]);
});

function repoWithCaller(unit, text) {
  const root = mkdtempSync(join(tmpdir(), 'kit-caller-'));
  roots.push(root);
  if (text !== undefined) {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', `${unit}-release.yml`), text);
  }
  return root;
}

test("pinnedKitRef reads the kit version a unit's caller pins", () => {
  const caller = [
    'jobs:',
    '  release:',
    '    uses: wardmanm/release-kit/.github/workflows/release.yml@v1.0.0',
    '    with:',
    '      unit: rcl-core',
    '',
  ].join('\n');
  assert.equal(pinnedKitRef(repoWithCaller('rcl-core', caller), 'rcl-core'), 'v1.0.0');
});

test('pinnedKitRef is null when the caller is missing or calls a local workflow', () => {
  assert.equal(pinnedKitRef(repoWithCaller('rcl-core'), 'rcl-core'), null);
  const local = 'jobs:\n  release:\n    uses: ./.github/workflows/release.yml\n';
  assert.equal(pinnedKitRef(repoWithCaller('release-kit', local), 'release-kit'), null);
});
