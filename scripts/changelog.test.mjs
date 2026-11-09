// Ported from Rollcall's scripts/release.test.mjs (its prepare tests, on the text). Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChangelog, formatChangelog, moveUnreleased } from './changelog.mjs';

const REPO_URL = 'https://github.com/o/r';
const OPTS = { repoUrl: REPO_URL, tagPrefix: 'rcl-core-v' };
const move = (text, version, date) => moveUnreleased(text, { ...OPTS, version, date });

const HEADER = '# Changelog\n\nAll notable changes are documented here.';

const FIRST = `${HEADER}

## [Unreleased]

### Added

- Team Builder (#12)

[Unreleased]: ${REPO_URL}/commits/main
`;

const FIRST_PREPARED = `${HEADER}

## [Unreleased]

## [0.1.0] - 2026-10-14

### Added

- Team Builder (#12)

[Unreleased]: ${REPO_URL}/compare/rcl-core-v0.1.0...HEAD
[0.1.0]: ${REPO_URL}/releases/tag/rcl-core-v0.1.0
`;

const SECOND = `${HEADER}

## [Unreleased]

### Fixed

- Roster paging (#20)

## [0.1.0] - 2026-10-14

### Added

- Team Builder (#12)

[Unreleased]: ${REPO_URL}/compare/rcl-core-v0.1.0...HEAD
[0.1.0]: ${REPO_URL}/releases/tag/rcl-core-v0.1.0
`;

const SECOND_PREPARED = `${HEADER}

## [Unreleased]

## [0.2.0] - 2026-11-01

### Fixed

- Roster paging (#20)

## [0.1.0] - 2026-10-14

### Added

- Team Builder (#12)

[Unreleased]: ${REPO_URL}/compare/rcl-core-v0.2.0...HEAD
[0.2.0]: ${REPO_URL}/releases/tag/rcl-core-v0.2.0
[0.1.0]: ${REPO_URL}/releases/tag/rcl-core-v0.1.0
`;

const EMPTY_HEADINGS = FIRST.replace('- Team Builder (#12)\n\n', '');

test('parseChangelog and formatChangelog round-trip a changelog unchanged', () => {
  for (const text of [FIRST, FIRST_PREPARED, SECOND, SECOND_PREPARED]) {
    assert.equal(formatChangelog(parseChangelog(text)), text);
  }
});

test('parseChangelog reads CRLF line endings and formatChangelog writes LF', () => {
  assert.equal(formatChangelog(parseChangelog(FIRST.replace(/\n/g, '\r\n'))), FIRST);
});

test('parseChangelog keeps link references out of the last section', () => {
  const log = parseChangelog(FIRST_PREPARED);
  assert.equal(log.sections.at(-1).body, '### Added\n\n- Team Builder (#12)');
  assert.equal(log.footer.length, 2);
});

test('moveUnreleased moves Unreleased entries into a dated section on the first release', () => {
  assert.equal(move(FIRST, '0.1.0', '2026-10-14'), FIRST_PREPARED);
});

test('moveUnreleased adds the new section above earlier releases', () => {
  assert.equal(move(SECOND, '0.2.0', '2026-11-01'), SECOND_PREPARED);
});

test("moveUnreleased links the new section and Unreleased to this repo's tags", () => {
  const text = moveUnreleased(FIRST, { repoUrl: REPO_URL, tagPrefix: 'x-v', version: '1.0.0', date: '2026-11-09' });
  const footer = text.trimEnd().split('\n').slice(-2);
  assert.deepEqual(footer, [
    '[Unreleased]: https://github.com/o/r/compare/x-v1.0.0...HEAD',
    '[1.0.0]: https://github.com/o/r/releases/tag/x-v1.0.0',
  ]);
});

test('moveUnreleased refuses when Unreleased has no entries, even with empty headings', () => {
  assert.throws(() => move(EMPTY_HEADINGS, '0.1.0', '2026-10-14'), /no entries to release/);
});

test('moveUnreleased refuses a changelog with no Unreleased section', () => {
  assert.throws(() => move(HEADER + '\n', '0.1.0', '2026-10-14'), /no "## \[Unreleased\]" section/);
});

test('moveUnreleased refuses a version that is not greater than the latest release', () => {
  assert.throws(() => move(SECOND, '0.0.9', '2026-11-01'), /0\.0\.9 is not greater than the latest release 0\.1\.0/);
  assert.throws(() => move(SECOND, '0.1.0-beta.1', '2026-11-01'), /not greater than the latest release 0\.1\.0/);
});

test('moveUnreleased refuses a version that already has a section', () => {
  assert.throws(() => move(SECOND, '0.1.0', '2026-11-01'), /already has a section for 0\.1\.0/);
});

test('moveUnreleased refuses invalid versions and dates', () => {
  assert.throws(() => move(FIRST, 'v0.1.0', '2026-10-14'), /leave off the leading "v"/);
  assert.throws(() => move(FIRST, '0.1', '2026-10-14'), /invalid version/);
  assert.throws(() => move(FIRST, '0.1.0', 'tomorrow'), /invalid date "tomorrow"/);
});

test('moveUnreleased accepts a lowercase [unreleased] heading without duplicating its link', () => {
  const text = move(FIRST.replace('## [Unreleased]', '## [unreleased]'), '0.1.0', '2026-10-14');
  assert.match(text, /^## \[0\.1\.0\] - 2026-10-14$/m);
  assert.equal(text.split('\n').filter((l) => /^\[unreleased\]:/i.test(l)).length, 1);
});
