// Ported from Rollcall's scripts/release.test.mjs. Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignOff, signOffErrors } from './signoff.mjs';
import { signOffRecord } from './test-helpers.mjs';

const FILE = 'rcl-core/sign-off/0.1.0.md';
const errorsFor = (text) => signOffErrors(text, { file: FILE, releaseName: 'Rollcall Core v0.1.0', signer: 'Mike' });

test('parseSignOff reads the title, the tested commit, the sign-off date and each check, unescaping pipes', () => {
  const text = signOffRecord(['pass', 'fail: shows A \\| B (#40, P1)']);
  assert.deepEqual(parseSignOff(text), {
    title: 'Sign-off: Rollcall Core v0.1.0',
    tested: 'abc1234',
    signedOff: '2026-10-14',
    rows: [
      {
        number: '1',
        feature: 'Team Builder (#12)',
        planned: 'team-builder R1',
        try: 'Add a team',
        expect: "It's listed",
        result: 'pass',
      },
      {
        number: '2',
        feature: 'Team Builder (#12)',
        planned: 'team-builder R2',
        try: 'Add a team',
        expect: "It's listed",
        result: 'fail: shows A | B (#40, P1)',
      },
    ],
  });
  assert.deepEqual(parseSignOff(signOffRecord([], { signedOff: null })), {
    title: 'Sign-off: Rollcall Core v0.1.0',
    tested: 'abc1234',
    signedOff: null,
    rows: [],
  });
});

test('parseSignOff reads a record with CRLF line endings', () => {
  const parsed = parseSignOff(signOffRecord(['pass', 'skip']).replace(/\n/g, '\r\n'));
  assert.equal(parsed.tested, 'abc1234');
  assert.equal(parsed.signedOff, '2026-10-14');
  assert.deepEqual(
    parsed.rows.map((r) => r.result),
    ['pass', 'skip'],
  );
});

test('parseSignOff and signOffErrors ignore the Found while testing list below the table', () => {
  const record = [
    signOffRecord(['pass', 'fail: names cut off at 720p (#40, P1)']),
    '## Found while testing',
    '',
    '- #45 Bug, P2, while on check 1: Logo picker | jumps when a team has no league',
    '- not filed: Feat, P1, while on check 2: Sort teams by league',
    '',
  ].join('\n');
  assert.deepEqual(
    parseSignOff(record).rows.map(({ number }) => number),
    ['1', '2'],
  );
  assert.deepEqual(errorsFor(record), []);
});

test('signOffErrors lets through checks that passed, or failed with only a P1 or P2 bug', () => {
  const record = signOffRecord(['pass', 'fail: names cut off at 720p (#40, P1)', 'fail: slow to open (#41, P2)']);
  assert.deepEqual(errorsFor(record), []);
});

test('signOffErrors refuses a check not yet tried, skipped, failed with no bug or a P0, or unreadable, naming each', () => {
  const record = signOffRecord(['pending', '', 'skip', 'fail: it broke', 'fail: it broke (#40, P0)', 'maybe']);
  assert.deepEqual(errorsFor(record), [
    'rcl-core/sign-off/0.1.0.md: check 1 "Team Builder (#12)" hasn’t been tried yet',
    'rcl-core/sign-off/0.1.0.md: check 2 "Team Builder (#12)" hasn’t been tried yet',
    'rcl-core/sign-off/0.1.0.md: check 3 "Team Builder (#12)" was skipped, and a skipped check still blocks the release',
    'rcl-core/sign-off/0.1.0.md: check 4 "Team Builder (#12)" failed with no bug filed: end its result with (#<issue>, P0|P1|P2)',
    'rcl-core/sign-off/0.1.0.md: check 5 "Team Builder (#12)" failed with P0 bug #40: fix it, then try the check again',
    'rcl-core/sign-off/0.1.0.md: check 6 "Team Builder (#12)" has an unreadable result "maybe": use pass, skip, pending or fail: <what happened> (#<issue>, P1)',
  ]);
});

test('signOffErrors refuses a record that isn’t signed off, names another release, has no checks or no tested commit', () => {
  assert.deepEqual(errorsFor(signOffRecord(['pass'], { signedOff: null })), [
    'rcl-core/sign-off/0.1.0.md isn’t signed off: add "Signed off: YYYY-MM-DD by Mike" once Mike signs it off',
  ]);
  assert.deepEqual(errorsFor(signOffRecord(['pass'], { title: 'Sign-off: Rollcall Core v0.0.9' })), [
    'rcl-core/sign-off/0.1.0.md should start "# Sign-off: Rollcall Core v0.1.0"',
  ]);
  assert.deepEqual(errorsFor(signOffRecord([])), ['rcl-core/sign-off/0.1.0.md has no checks']);
  assert.deepEqual(errorsFor(signOffRecord(['pass']).replace(/^Tested: .*\n/m, '')), [
    'rcl-core/sign-off/0.1.0.md needs the commit that was tested: Tested: `<sha>` on YYYY-MM-DD',
  ]);
});
