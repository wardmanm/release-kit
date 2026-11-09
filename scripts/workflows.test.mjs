// Keeps the workflows in step with the scripts. The workflows are read as text: the kit has no dependencies,
// so there's no YAML parser. Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from './release.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const SHARED = read('.github/workflows/release.yml');
const OWN = read('.github/workflows/release-kit-release.yml');

// The text of a top-level block such as `on:` or `env:`, up to the next top-level key.
const block = (text, key) => new RegExp(`^${key}:\\n((?:[ #].*\\n|\\n)*)`, 'm').exec(text)?.[1] ?? '';
// The text of a job, up to the next job.
const job = (text, name) => new RegExp(`^ {2}${name}:\\n((?: {4}.*\\n|\\n)*)`, 'm').exec(text)?.[1] ?? '';

test('the shared workflow can only be called, never started on its own', () => {
  const on = block(SHARED, 'on');
  assert.match(on, /^ {2}workflow_call:$/m);
  assert.doesNotMatch(on, /^ {2}(?!workflow_call:)\S/m);
});

test('it takes a unit and a version, and no dry run', () => {
  const on = block(SHARED, 'on');
  assert.match(on, /^ {6}unit:\n(?: {8}.*\n)*? {8}required: true\n/m);
  assert.match(on, /^ {6}version:\n(?: {8}.*\n)*? {8}required: true\n/m);
  for (const text of [SHARED, OWN]) assert.doesNotMatch(text, /dry.?run/i);
});

test('every job asks for its own permissions, and the workflow grants none by default', () => {
  assert.match(SHARED, /^permissions: \{\}$/m);
  for (const name of ['verify', 'publish']) assert.match(job(SHARED, name), /^ {4}permissions:\n/m, name);
  assert.match(job(SHARED, 'verify'), /^ {6}contents: read\n {6}issues: read\n/m);
});

test('publishing waits for approval in the release environment, after verify', () => {
  const publish = job(SHARED, 'publish');
  assert.match(publish, /^ {4}needs: verify$/m);
  assert.match(publish, /^ {4}environment: release$/m);
  assert.doesNotMatch(job(SHARED, 'verify'), /environment:/);
});

test("every release.mjs call runs from the kit's folder and names the unit", () => {
  const calls = SHARED.match(/node "\$KIT\/scripts\/release\.mjs"[^\n)]*/g) ?? [];
  assert.ok(calls.length >= 9, `found only ${calls.length} calls`);
  for (const call of calls) {
    assert.match(call, /^node "\$KIT\/scripts\/release\.mjs" ([a-z-]+)( "\$VERSION")? --unit "\$UNIT"/, call);
    assert.ok(COMMANDS.includes(call.split(' ')[2]), call);
  }
  assert.doesNotMatch(SHARED, /node scripts\/release\.mjs/, 'a call that would run the project’s own script');
});

test("the kit is moved out of the project's folder, so the project's own checks never see it", () => {
  for (const name of ['verify', 'publish']) {
    const text = job(SHARED, name);
    assert.match(text, /path: \.release-kit\n/, name);
    assert.match(text, /mv \.release-kit "\$RUNNER_TEMP\/release-kit"/, name);
  }
});

test('KIT_REF is the version in plugin.json', () => {
  const { version } = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.ok(block(SHARED, 'env').includes(`  KIT_REF: v${version}\n`), block(SHARED, 'env'));
});

test("the kit's own caller starts by hand only, with a version, and calls the local workflow", () => {
  assert.match(OWN, /^name: release-kit release$/m);
  const on = block(OWN, 'on');
  assert.match(on, /^ {2}workflow_dispatch:$/m);
  assert.doesNotMatch(on, /^ {2}(?!workflow_dispatch:)\S/m);
  assert.match(on, /^ {6}version:$/m);
  assert.match(OWN, /^ {4}uses: \.\/\.github\/workflows\/release\.yml$/m);
  assert.match(OWN, /^ {6}unit: release-kit$/m);
  assert.match(OWN, /^ {2}group: release-kit-release$/m);
});
