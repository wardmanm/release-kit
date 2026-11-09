// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, unitOf, fill } from './config.mjs';

const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const unit = (over = {}) => ({
  name: 'Rollcall Core',
  changelog: 'rcl-core/CHANGELOG.md',
  versionFiles: ['rcl-core/*/package.json'],
  tagPrefix: 'rcl-core-v',
  milestone: 'rcl-core v{version}',
  signOff: 'rcl-core/sign-off/{version}.md',
  ...over,
});

const config = (over = {}) => ({
  repo: 'wardmanm/rollcall_derby',
  node: 24,
  signer: 'Mike',
  ci: ['yarn check'],
  units: { 'rcl-core': unit(), 'rcl-producer': unit({ name: 'Rollcall Producer' }) },
  ...over,
});

function rootWith(value) {
  const root = mkdtempSync(join(tmpdir(), 'kit-config-'));
  writeFileSync(join(root, 'release-kit.json'), typeof value === 'string' ? value : JSON.stringify(value));
  return root;
}

test('loadConfig reads a valid config and derives owner from repo', () => {
  const cfg = loadConfig(KIT_ROOT);
  assert.equal(cfg.owner, 'wardmanm');
  assert.equal(cfg.repo, 'wardmanm/release-kit');
  const kit = cfg.units['release-kit'];
  assert.equal(kit.id, 'release-kit');
  assert.deepEqual(kit.prepareSteps, []);
});

test('loadConfig names the file, unit and field for each bad field', () => {
  const cases = [
    [config({ units: undefined }), /units/],
    [config({ units: { x: unit({ changelog: undefined }) } }), /units\.x\.changelog/],
    [config({ units: { x: unit({ board: '6' }) } }), /units\.x\.board must be a number/],
    [config({ units: { x: unit({ milestone: 'v1' }) } }), /units\.x\.milestone must contain \{version\}/],
    [config({ units: { x: unit({ signOff: 'sign-off/record.md' }) } }), /units\.x\.signOff must contain \{version\}/],
    [config({ repo: 'rollcall' }), /repo must be owner\/name/],
    [config({ units: { x: unit({ versionFiles: [{ file: 'a.yml' }] }) } }), /units\.x\.versionFiles\[0\]\.pattern/],
    [
      config({ units: { x: unit({ versionFiles: [{ file: 'a.yml', pattern: 'KIT_REF: v1' }] }) } }),
      /units\.x\.versionFiles\[0\]\.pattern must contain \{version\}/,
    ],
    [config({ ci: 'yarn check' }), /ci must be a list of commands/],
    [config({ node: '24' }), /node must be a number/],
  ];
  for (const [value, field] of cases) {
    assert.throws(() => loadConfig(rootWith(value)), (e) => {
      assert.match(e.message, /^release-kit\.json: /);
      assert.match(e.message, field);
      return true;
    });
  }
});

test('loadConfig reports a file that is not JSON', () => {
  assert.throws(() => loadConfig(rootWith('{ not json')), /^Error: release-kit\.json: not valid JSON/);
});

test('loadConfig fails clearly when release-kit.json is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'kit-config-'));
  assert.throws(() => loadConfig(root), /no release-kit\.json in /);
});

test('unitOf picks the only unit, or the named one, and lists valid ids for an unknown one without echoing it raw', () => {
  const one = loadConfig(rootWith(config({ units: { 'rcl-core': unit() } })));
  assert.equal(unitOf(one).id, 'rcl-core');
  const two = loadConfig(rootWith(config()));
  assert.equal(unitOf(two, 'rcl-producer').name, 'Rollcall Producer');
  assert.throws(
    () => unitOf(two, 'a\nb'),
    (e) => {
      assert.ok(e.message.includes('"a\\nb"'), e.message);
      assert.ok(e.message.includes('rcl-core, rcl-producer'), e.message);
      assert.ok(!e.message.includes('a\nb'), 'raw input echoed');
      return true;
    },
  );
});

test('unitOf requires an id when there are several units', () => {
  const two = loadConfig(rootWith(config()));
  assert.throws(() => unitOf(two), /name a unit: rcl-core, rcl-producer/);
});

test('fill replaces every {version}', () => {
  assert.equal(fill('rcl-core v{version} ({version})', '0.4.0'), 'rcl-core v0.4.0 (0.4.0)');
});

test("loadConfig rejects a field it doesn't know, at the top level or in a unit, listing the ones it does", () => {
  assert.throws(
    () => loadConfig(rootWith(config({ units: { x: unit({ bord: 6 }) } }))),
    /^Error: release-kit\.json: units\.x\.bord is not a field: use name, changelog, versionFiles, tagPrefix, milestone, signOff, label, board, prepareSteps$/,
  );
  assert.throws(
    () => loadConfig(rootWith(config({ spec: 'docs' }))),
    /^Error: release-kit\.json: spec is not a field: use repo, node, signer, specs, ci, units$/,
  );
});
