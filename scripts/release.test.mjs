// Tests for release.mjs, much of it ported from Rollcall's scripts/release.test.mjs. Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepare, check, notes, COMMANDS } from './release.mjs';
import { loadConfig, unitOf } from './config.mjs';
import {
  makeTree,
  gitRepoWithRemote,
  TWO_UNITS,
  HEADER,
  FIRST,
  FIRST_PREPARED,
  SECOND,
  SECOND_PREPARED,
  signOffRecord,
  pkg,
  REPO_URL,
} from './test-helpers.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'release.mjs');
const LOG = 'rcl-core/CHANGELOG.md';
const SIGN_OFF = 'rcl-core/sign-off/0.1.0.md';
const SIGNED = { [SIGN_OFF]: signOffRecord() };
const DATE = { date: '2026-10-14', repoUrl: REPO_URL };

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
// A repo with Rollcall's two units and these files.
const repo = (files = {}, config = TWO_UNITS) => makeTree({ 'release-kit.json': config, ...files });
const unitIn = (root, id = 'rcl-core') => unitOf(loadConfig(root), id);
const checkIn = (root, version = '0.1.0') => check(root, unitIn(root), version, { signer: 'Mike' });

const cli = (args, { cwd, input, env } = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd, input, env, encoding: 'utf8' });

// --- prepare ---

test('prepare moves Unreleased entries into a dated section, and bumps every file a versionFiles glob matches, and nothing else', () => {
  const root = repo({
    [LOG]: FIRST,
    'package.json': pkg('0.0.0'),
    'rcl-core/web/package.json': pkg('0.0.0'),
    'rcl-core/server/package.json': pkg('0.0.0'),
    'rcl-core/contract/package.json': pkg('0.0.0'),
    'rcl-core/README.md': 'not a package dir',
    'rcl-core/notes/todo.md': 'a folder with no package.json',
    'rcl-producer/web/package.json': pkg('0.0.0'),
    'packages/app-sdk/package.json': pkg('0.0.0'),
  });
  const { files } = prepare(root, unitIn(root), '0.1.0', DATE);
  assert.deepEqual(files, [
    'rcl-core/CHANGELOG.md',
    'rcl-core/contract/package.json',
    'rcl-core/server/package.json',
    'rcl-core/web/package.json',
  ]);
  assert.equal(read(root, LOG), FIRST_PREPARED);
  for (const file of files.slice(1)) assert.equal(read(root, file), pkg('0.1.0'), file);
  for (const file of ['package.json', 'rcl-producer/web/package.json', 'packages/app-sdk/package.json']) {
    assert.equal(read(root, file), pkg('0.0.0'), file);
  }
});

test("prepare reads and writes only the unit's own changelog", () => {
  const producer = (text) => text.replaceAll('rcl-core-v', 'rcl-producer-v');
  const root = repo({ [LOG]: FIRST, 'rcl-producer/CHANGELOG.md': producer(SECOND), 'rcl-producer/web/package.json': pkg('0.1.0') });
  prepare(root, unitIn(root, 'rcl-producer'), '0.2.0', { date: '2026-11-01', repoUrl: REPO_URL });
  assert.equal(read(root, 'rcl-producer/CHANGELOG.md'), producer(SECOND_PREPARED));
  assert.equal(read(root, LOG), FIRST);
});

test('prepare refuses a versionFiles glob that matches no file, changing nothing', () => {
  const root = repo({ [LOG]: FIRST });
  assert.throws(() => prepare(root, unitIn(root), '0.1.0', DATE), /versionFiles "rcl-core\/\*\/package\.json" matches no file/);
  assert.equal(read(root, LOG), FIRST);
});

test('prepare and check accept a first release when its packages already have that version', () => {
  const root = repo({ [LOG]: FIRST, 'rcl-core/server/package.json': pkg('0.1.0'), ...SIGNED });
  const { files } = prepare(root, unitIn(root), '0.1.0', DATE);
  assert.deepEqual(files, ['rcl-core/CHANGELOG.md', 'rcl-core/server/package.json']);
  assert.deepEqual(checkIn(root), []);
});

test('prepare and check handle a pattern versionFiles entry', () => {
  const config = structuredClone(TWO_UNITS);
  config.units['rcl-core'].versionFiles = [
    'plugin.json',
    { file: '.github/workflows/release.yml', pattern: 'KIT_REF: v{version}' },
  ];
  const workflow = (v) => `env:\n  KIT_REF: v${v}\njobs: {}\n`;
  const root = repo({ [LOG]: FIRST, 'plugin.json': pkg('0.0.9'), '.github/workflows/release.yml': workflow('0.0.9'), ...SIGNED }, config);
  assert.ok(checkIn(root).includes('.github/workflows/release.yml has version 0.0.9, expected 0.1.0'));
  prepare(root, unitIn(root), '0.1.0', DATE);
  assert.equal(read(root, '.github/workflows/release.yml'), workflow('0.1.0'));
  assert.equal(read(root, 'plugin.json'), pkg('0.1.0'));
  assert.deepEqual(checkIn(root), []);
});

test('prepare refuses a pattern that matches no line', () => {
  const config = structuredClone(TWO_UNITS);
  config.units['rcl-core'].versionFiles = [{ file: 'a.yml', pattern: 'KIT_REF: v{version}' }];
  const root = repo({ [LOG]: FIRST, 'a.yml': 'nothing here\n' }, config);
  assert.throws(() => prepare(root, unitIn(root), '0.1.0', DATE), /a\.yml has no line matching "KIT_REF: v\{version\}"/);
});

test('prepare fails clearly when the unit has no changelog', () => {
  const root = repo({ 'rcl-core/web/package.json': pkg('0.0.0') });
  assert.throws(() => prepare(root, unitIn(root), '0.1.0', DATE), /rcl-core\/CHANGELOG\.md not found/);
});

// --- check ---

test('check passes for a prepared changelog with a signed-off record', () => {
  const root = repo({ [LOG]: FIRST, 'rcl-core/web/package.json': pkg('0.0.0'), ...SIGNED });
  prepare(root, unitIn(root), '0.1.0', DATE);
  assert.deepEqual(checkIn(root), []);
});

test('check reports Unreleased entries that were never prepared', () => {
  const root = repo({ [LOG]: FIRST, 'rcl-core/web/package.json': pkg('0.1.0'), ...SIGNED });
  assert.deepEqual(checkIn(root), [
    'the Unreleased section of rcl-core/CHANGELOG.md still has entries; run: release.mjs prepare 0.1.0 --unit rcl-core',
    'rcl-core/CHANGELOG.md has no section for 0.1.0; run: release.mjs prepare 0.1.0 --unit rcl-core',
  ]);
});

test('check ignores empty subsection headings under Unreleased', () => {
  const text = FIRST_PREPARED.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Added\n');
  assert.deepEqual(checkIn(repo({ [LOG]: text, 'rcl-core/web/package.json': pkg('0.1.0'), ...SIGNED })), []);
});

test('check requires a dated section with entries', () => {
  const undated = FIRST_PREPARED.replace(' - 2026-10-14', '');
  assert.ok(checkIn(repo({ [LOG]: undated, 'rcl-core/web/package.json': pkg('0.1.0') })).some((e) => /needs a date/.test(e)));
  const empty = FIRST_PREPARED.replace('- Team Builder (#12)', '');
  assert.ok(
    checkIn(repo({ [LOG]: empty, 'rcl-core/web/package.json': pkg('0.1.0') })).some((e) =>
      /0\.1\.0 section has no entries/.test(e),
    ),
  );
});

test('check requires the version to be newer than every other release', () => {
  const text = `${HEADER}\n\n## [Unreleased]\n\n## [0.1.5] - 2026-12-01\n\n- Late fix\n\n## [0.2.0] - 2026-11-01\n\n- Feature\n`;
  const errors = checkIn(repo({ [LOG]: text, 'rcl-core/web/package.json': pkg('0.1.5') }), '0.1.5');
  assert.ok(errors.includes('0.1.5 is not greater than the previous release 0.2.0'), errors.join('\n'));
});

test("check requires the unit's version files to match, and ignores everyone else's", () => {
  const root = repo({
    [LOG]: FIRST_PREPARED,
    'package.json': pkg('0.0.0'),
    'rcl-core/server/package.json': pkg('0.1.0'),
    'rcl-core/web/package.json': pkg('0.0.0'),
    'rcl-producer/web/package.json': pkg('0.0.0'),
    ...SIGNED,
  });
  assert.deepEqual(checkIn(root), ['rcl-core/web/package.json has version 0.0.0, expected 0.1.0']);
});

test('check requires a sign-off record for the version', () => {
  assert.deepEqual(checkIn(repo({ [LOG]: FIRST_PREPARED, 'rcl-core/web/package.json': pkg('0.1.0') })), [
    'rcl-core/sign-off/0.1.0.md is missing: run /release rcl-core 0.1.0 and finish the sign-off',
  ]);
});

// --- notes ---

test('notes returns the section body without link references', () => {
  const root = repo({ [LOG]: FIRST_PREPARED });
  assert.equal(notes(root, unitIn(root), '0.1.0'), '### Added\n\n- Team Builder (#12)');
});

test('notes fails for a version with no section', () => {
  const root = repo({ [LOG]: FIRST_PREPARED });
  assert.throws(() => notes(root, unitIn(root), '9.9.9'), /rcl-core\/CHANGELOG\.md has no section for 9\.9\.9/);
});

// --- CLI ---

test('CLI prepare writes the changelog, exits 0 and names the commit to make', () => {
  const root = repo({ [LOG]: FIRST, 'rcl-core/web/package.json': pkg('0.0.0') });
  const out = cli(['prepare', '0.1.0', '--unit', 'rcl-core', '--date', '2026-10-14', '--root', root]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /prepared rcl-core 0\.1\.0: rcl-core\/CHANGELOG\.md, rcl-core\/web\/package\.json/);
  assert.match(out.stdout, /commit: chore\(rcl-core\): prepare v0\.1\.0/);
  assert.equal(read(root, LOG), FIRST_PREPARED);
});

test('CLI check exits 1 and lists problems', () => {
  const out = cli(['check', '0.1.0', '--unit', 'rcl-core', '--root', repo({ [LOG]: FIRST })]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /release check failed for rcl-core "0\.1\.0"/);
});

test('CLI check lists what keeps the sign-off from letting the release through', () => {
  const root = repo({
    [LOG]: FIRST_PREPARED,
    'rcl-core/web/package.json': pkg('0.1.0'),
    [SIGN_OFF]: signOffRecord(['pending'], { signedOff: null }),
  });
  const out = cli(['check', '0.1.0', '--unit', 'rcl-core', '--root', root]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /- rcl-core\/sign-off\/0\.1\.0\.md: check 1 "Team Builder \(#12\)" hasn’t been tried yet/);
  assert.match(out.stderr, /- rcl-core\/sign-off\/0\.1\.0\.md isn’t signed off: add "Signed off: YYYY-MM-DD by Mike"/);
});

test('CLI check passes and says so', () => {
  const root = repo({ [LOG]: FIRST_PREPARED, 'rcl-core/web/package.json': pkg('0.1.0'), ...SIGNED });
  const out = cli(['check', '0.1.0', '--unit', 'rcl-core', '--root', root]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, 'release check OK for rcl-core 0.1.0\n');
});

test('CLI notes prints the section body', () => {
  const out = cli(['notes', '0.1.0', '--unit', 'rcl-core', '--root', repo({ [LOG]: FIRST_PREPARED })]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, '### Added\n\n- Team Builder (#12)\n');
});

test("CLI name prints the release's name", () => {
  const out = cli(['name', '0.2.0', '--unit', 'rcl-producer', '--root', repo()]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, 'Rollcall Producer v0.2.0\n');
});

test('meta prints the names the workflow uses', () => {
  const out = cli(['meta', '0.4.0', '--unit', 'rcl-core', '--root', repo()]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(
    out.stdout,
    'TAG=rcl-core-v0.4.0\nMILESTONE=rcl-core v0.4.0\nRELEASE_NAME=Rollcall Core v0.4.0\nBRANCH=release/rcl-core-v0.4.0\n',
  );
});

test('CLI without a command prints usage and exits 2', () => {
  const out = cli(['--root', repo()]);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /^usage: release\.mjs </);
});

test('a command without --unit in a two-unit repo prints usage and exits 2, changing nothing', () => {
  const root = repo({ [LOG]: FIRST, 'rcl-core/web/package.json': pkg('0.0.0') });
  const out = cli(['prepare', '0.1.0', '--date', '2026-10-14', '--root', root]);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /--unit <rcl-core\|rcl-producer>/);
  assert.equal(read(root, LOG), FIRST);
});

test('a one-unit repo needs no --unit', () => {
  const config = structuredClone(TWO_UNITS);
  delete config.units['rcl-producer'];
  const out = cli(['name', '0.2.0', '--root', repo({}, config)]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, 'Rollcall Core v0.2.0\n');
});

test('CLI refuses an unknown unit or an unsafe version for every command, without echoing it raw', () => {
  const root = repo();
  for (const command of COMMANDS) {
    const unit = cli([command, '0.1.0', '--unit', 'obs-producer', '--root', root]);
    assert.equal(unit.status, 1, command);
    assert.match(unit.stderr, /unknown unit "obs-producer": use rcl-core, rcl-producer/, command);
    if (['pinned', 'ci'].includes(command)) continue;
    const version = cli([command, '0.1.0\n::error::x', '--unit', 'rcl-core', '--root', root]);
    assert.equal(version.status, 1, command);
    assert.match(version.stderr, /invalid version "0\.1\.0\\n::error::x"/, command);
  }
});

test('CLI fails clearly outside a repo set up for release-kit', () => {
  const out = cli(['name', '0.1.0', '--root', makeTree({})]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /no release-kit\.json in /);
});

test('--root defaults to the current directory', () => {
  const out = cli(['name', '0.3.0', '--unit', 'rcl-core'], { cwd: repo() });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, 'Rollcall Core v0.3.0\n');
});

test('CLI tag-absent exits 1 when the tag already exists', () => {
  const root = gitRepoWithRemote(['rcl-core-v0.1.0'], { 'release-kit.json': TWO_UNITS });
  const out = cli(['tag-absent', '0.1.0', '--unit', 'rcl-core', '--root', root]);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /tag rcl-core-v0\.1\.0 already exists/);
  assert.equal(cli(['tag-absent', '0.2.0', '--unit', 'rcl-core', '--root', root]).status, 0);
  assert.equal(cli(['tag-absent', '0.1.0', '--unit', 'rcl-producer', '--root', root]).status, 0);
});

const MILESTONES = [
  { title: 'rcl-core v0.1.0', number: 1, open_issues: 0, html_url: 'https://example.com/m/1' },
  { title: 'rcl-core v0.2.0', number: 2, open_issues: 3, html_url: 'https://example.com/m/2' },
];

test('CLI milestone reads the API response on stdin and prints number and url', () => {
  const root = repo();
  const ok = cli(['milestone', '0.1.0', '--unit', 'rcl-core', '--root', root], { input: JSON.stringify(MILESTONES) });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { number: 1, url: 'https://example.com/m/1' });
  const open = cli(['milestone', '0.2.0', '--unit', 'rcl-core', '--root', root], { input: JSON.stringify(MILESTONES) });
  assert.equal(open.status, 1);
  assert.match(open.stderr, /still has 3 open issue\(s\)/);
  const patch = cli(['milestone', '0.1.1', '--unit', 'rcl-core', '--root', root], { input: JSON.stringify(MILESTONES) });
  assert.equal(patch.status, 1);
  assert.match(patch.stderr, /no milestone titled 'rcl-core v0\.1\.1'/);
});

test("CLI issues prints the issue numbers in a version's notes", () => {
  const text = FIRST_PREPARED.replace('- Team Builder (#12)', '- Team Builder (#12)\n- Member photos (#15)');
  const out = cli(['issues', '0.1.0', '--unit', 'rcl-core', '--root', repo({ [LOG]: text })]);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, '12\n15\n');
});

test('CLI issues prints plain numbers even when FORCE_COLOR is set', () => {
  // The release workflow pipes this output into `gh issue comment`; colour codes would break every comment.
  const out = cli(['issues', '0.1.0', '--unit', 'rcl-core', '--root', repo({ [LOG]: FIRST_PREPARED })], {
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, '12\n');
});

test("CLI pinned prints the kit version the unit's caller pins, or none", () => {
  const caller = 'jobs:\n  release:\n    uses: wardmanm/release-kit/.github/workflows/release.yml@v1.2.0\n';
  const root = repo({ '.github/workflows/rcl-core-release.yml': caller });
  assert.equal(cli(['pinned', '--unit', 'rcl-core', '--root', root]).stdout, 'v1.2.0\n');
  assert.equal(cli(['pinned', '--unit', 'rcl-producer', '--root', root]).stdout, 'none\n');
});

test('ci runs each command in order and stops at the first failure', () => {
  const config = structuredClone(TWO_UNITS);
  config.ci = [
    `node -e "require('fs').writeFileSync('a','')"`,
    `node -e "process.exit(3)"`,
    `node -e "require('fs').writeFileSync('c','')"`,
  ];
  const root = repo({}, config);
  const out = cli(['ci', '--unit', 'rcl-core', '--root', root]);
  assert.equal(out.status, 3);
  assert.ok(existsSync(join(root, 'a')));
  assert.ok(!existsSync(join(root, 'c')));
  assert.match(out.stdout, /::group::node -e "require\('fs'\)\.writeFileSync\('a',''\)"\n/);
  assert.match(out.stdout, /::endgroup::/);
});

test('ci passes when every command does', () => {
  const out = cli(['ci', '--unit', 'rcl-core', '--root', repo()]);
  assert.equal(out.status, 0, out.stderr);
});
