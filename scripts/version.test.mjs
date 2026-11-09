// Ported from Rollcall's scripts/release.test.mjs. Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, versionError, compareVersions } from './version.mjs';

test('parseVersion accepts plain and pre-release semver', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] });
  assert.deepEqual(parseVersion('0.3.0-beta.1'), { major: 0, minor: 3, patch: 0, prerelease: ['beta', '1'] });
});

test('parseVersion rejects malformed versions', () => {
  for (const bad of ['1.2', '01.2.3', '1.2.3+build.5', '1.2.3-', '1.2.3-beta..1', '', ' 1.2.3', '1.2.3-01']) {
    assert.equal(parseVersion(bad), null, JSON.stringify(bad));
  }
});

test('versionError rejects shell metacharacters and newlines without echoing them raw', () => {
  for (const bad of ['0.2.0; rm -rf /', '0.2.0$(id)', '0.2.0\n::error::x', '0.2.0 && true']) {
    const error = versionError(bad);
    assert.match(error, /^invalid version /, JSON.stringify(bad));
    assert.ok(!error.includes('\n'), `raw newline echoed for ${JSON.stringify(bad)}`);
  }
});

test('versionError explains a leading v', () => {
  assert.match(versionError('v0.2.0'), /leave off the leading "v"/);
});

test('versionError accepts valid versions', () => {
  assert.equal(versionError('0.2.0'), null);
  assert.equal(versionError('0.3.0-rc.2'), null);
});

test('versionError rejects a missing version', () => {
  assert.match(versionError(undefined), /^invalid version /);
});

test('compareVersions follows semver precedence', () => {
  const ascending = [
    '0.1.9',
    '0.2.0',
    '0.3.0-1',
    '0.3.0-alpha',
    '0.3.0-beta',
    '0.3.0-beta.1',
    '0.3.0-beta.2',
    '0.3.0-beta.10',
    '0.3.0-rc.1',
    '0.3.0',
    '1.0.0',
  ];
  for (let i = 0; i < ascending.length - 1; i++) {
    assert.equal(compareVersions(ascending[i], ascending[i + 1]), -1, `${ascending[i]} < ${ascending[i + 1]}`);
    assert.equal(compareVersions(ascending[i + 1], ascending[i]), 1, `${ascending[i + 1]} > ${ascending[i]}`);
  }
  assert.equal(compareVersions('0.3.0-beta.1', '0.3.0-beta.1'), 0);
});
