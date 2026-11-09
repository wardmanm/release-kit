// Keeps skills/release/SKILL.md in step with the scripts it runs. Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from './release.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(ROOT, 'skills', 'release', 'SKILL.md'), 'utf8');
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/.exec(SKILL)?.[1] ?? '';
const FILE_ISSUE_FLAGS = ['--unit', '--kind', '--priority', '--title', '--milestone', '--label', '--body-file', '--root'];

test('the skill runs only when the user types it, as /release', () => {
  assert.match(FRONTMATTER, /^name: release$/m);
  assert.match(FRONTMATTER, /^disable-model-invocation: true$/m);
  assert.match(FRONTMATTER, /^argument-hint: /m);
});

test('every script path is quoted, so a plugin folder with spaces still works', () => {
  const uses = [...SKILL.matchAll(/(.)\$\{CLAUDE_PLUGIN_ROOT\}/g)];
  assert.ok(uses.length >= 2, 'the skill should run the kit’s scripts from the plugin');
  for (const [, before] of uses) assert.equal(before, '"');
});

test('it never offers a multiple-choice prompt for a result', () => {
  assert.doesNotMatch(SKILL, /AskUserQuestion/);
});

test('every release.mjs command it names exists', () => {
  const named = [...SKILL.matchAll(/release\.mjs"? ([a-z][a-z-]*)/g)].map((m) => m[1]);
  assert.ok(named.length >= 5, `found only ${named.length}`);
  for (const command of named) assert.ok(COMMANDS.includes(command), command);
});

test('every file-issue.mjs flag it uses exists', () => {
  const lines = SKILL.split('\n').filter((line) => line.includes('file-issue.mjs'));
  const flags = lines.flatMap((line) => line.match(/--[a-z][a-z-]*/g) ?? []);
  assert.ok(flags.includes('--priority'), 'the skill should file issues with file-issue.mjs');
  for (const flag of flags) assert.ok(FILE_ISSUE_FLAGS.includes(flag), flag);
});

test('the skill makes no exception for tagging, publishing, or starting or approving the workflow', () => {
  const rule = SKILL.split('\n').find((line) => /^- Never .*tag/.test(line));
  assert.ok(rule, 'the never-tag rule');
  assert.match(rule, /approve/);
  assert.doesNotMatch(rule, /unless/i);
});

test('a blocked release is never "fixed" by changing a result', () => {
  assert.match(SKILL, /Never change a result without the user/);
  assert.doesNotMatch(SKILL, /so fix it/);
  assert.doesNotMatch(SKILL, /fix what it reports/);
});

test("issue titles are single-quoted, so backticks and $ in them stay as typed", () => {
  const line = SKILL.split('\n').find((l) => l.includes('file-issue.mjs" --unit'));
  assert.match(line, /--title '<title>'/);
  assert.doesNotMatch(SKILL, /--title "/);
});
