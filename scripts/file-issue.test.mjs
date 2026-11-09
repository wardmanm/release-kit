// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fileIssue } from './file-issue.mjs';
import { loadConfig, unitOf } from './config.mjs';
import { makeTree, TWO_UNITS } from './test-helpers.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'file-issue.mjs');
const URL31 = 'https://github.com/o/r/issues/31';
const ITEMS = (n = 31) => JSON.stringify({ items: [{ id: 'PVTI_x', content: { number: n, url: `https://github.com/o/r/issues/${n}` } }] });
const FIELDS = JSON.stringify({
  fields: [
    { id: 'F_status', name: 'Status', options: [{ id: 's1', name: 'Todo' }] },
    { id: 'F_prio', name: 'Priority', options: [{ id: 'p0', name: 'P0' }, { id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }] },
  ],
});
const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const err = (stderr) => ({ status: 1, stdout: '', stderr });

// A fake gh: `replies` maps "issue create", "project item-list", … to a reply, or to a list of replies used in turn.
function fakeGh(replies) {
  const calls = [];
  const gh = (args, input) => {
    calls.push({ args, input });
    const key = args.slice(0, 2).join(' ');
    const reply = replies[key];
    if (reply === undefined) throw new Error(`unexpected gh ${args.join(' ')}`);
    return Array.isArray(reply) ? (reply.length > 1 ? reply.shift() : reply[0]) : reply;
  };
  return { gh, calls, of: (key) => calls.filter((c) => c.args.slice(0, 2).join(' ') === key) };
}

const happy = () => ({
  'issue create': ok(`${URL31}\n`),
  'project item-list': ok(ITEMS()),
  'project field-list': ok(FIELDS),
  'project view': ok('PVT_proj\n'),
  'project item-edit': ok(),
});

const config = loadConfig(makeTree({ 'release-kit.json': TWO_UNITS }));
const core = unitOf(config, 'rcl-core');
const deps = (fake) => ({ gh: fake.gh, sleep: async () => {} });
const issue = (over = {}) => ({ config, unit: core, kind: 'bug', priority: 'P2', title: 'Margins are off', body: '### App\n\nrcl-core', ...over });

test("files a P2 bug with its labels and no milestone, then sets Priority on the unit's board", async () => {
  const fake = fakeGh(happy());
  const result = await fileIssue(issue({ labels: ['sign-off'] }), deps(fake));
  assert.deepEqual(result, { number: 31, url: URL31, priority: 'P2' });
  const [create] = fake.of('issue create');
  assert.deepEqual(create.args, [
    'issue', 'create', '--repo', 'o/r', '--title', 'Margins are off',
    '--label', 'bug', '--label', 'rcl-core', '--label', 'sign-off', '--body-file', '-',
  ]);
  assert.equal(create.input, '### App\n\nrcl-core');
  const [edit] = fake.of('project item-edit');
  assert.deepEqual(edit.args, [
    'project', 'item-edit', '--id', 'PVTI_x', '--project-id', 'PVT_proj', '--field-id', 'F_prio',
    '--single-select-option-id', 'p2',
  ]);
});

test('a change or feat is labelled enhancement, and a P0 goes in its milestone', async () => {
  const fake = fakeGh(happy());
  const result = await fileIssue(issue({ kind: 'change', priority: 'P0', milestone: 'rcl-core v0.4.0' }), deps(fake));
  assert.equal(result.priority, 'P0');
  const args = fake.of('issue create')[0].args;
  assert.ok(args.join(' ').includes('--label enhancement --label rcl-core --milestone rcl-core v0.4.0'), args.join(' '));
  assert.equal(fake.of('project item-edit')[0].args.at(-1), 'p0');
});

test('a P0 needs a milestone, and a P1 or P2 refuses one', async () => {
  const fake = fakeGh(happy());
  await assert.rejects(fileIssue(issue({ priority: 'P0' }), deps(fake)), /a P0 goes in the milestone of the release it blocks/);
  await assert.rejects(fileIssue(issue({ priority: 'P1', milestone: 'rcl-core v0.4.0' }), deps(fake)), /only a P0 goes in a milestone/);
  await assert.rejects(fileIssue(issue({ kind: 'idea' }), deps(fake)), /kind must be bug, change or feat/);
  await assert.rejects(fileIssue(issue({ priority: 'P3' }), deps(fake)), /priority must be P0, P1 or P2/);
  assert.equal(fake.calls.length, 0);
});

test("adds the card itself when the board hasn't, and carries on past \"Content already exists\"", async () => {
  const empty = ok(JSON.stringify({ items: [] }));
  const fake = fakeGh({
    ...happy(),
    'project item-list': [empty, empty, empty, empty, empty, ok(ITEMS())],
    'project item-add': err('GraphQL: Content already exists in this project (addProjectV2ItemById)'),
  });
  const result = await fileIssue(issue(), deps(fake));
  assert.equal(result.priority, 'P2');
  assert.deepEqual(fake.of('project item-add')[0].args, ['project', 'item-add', '6', '--owner', 'o', '--url', URL31]);
  assert.equal(fake.of('project item-list').length, 6);
});

test('asks for up to 1000 cards when looking for the card', async () => {
  const fake = fakeGh(happy());
  await fileIssue(issue(), deps(fake));
  for (const { args } of fake.of('project item-list')) {
    assert.deepEqual(args, ['project', 'item-list', '6', '--owner', 'o', '--format', 'json', '--limit', '1000']);
  }
});

test("reports Priority not set, without failing, when the board can't be updated", async () => {
  const fake = fakeGh({ ...happy(), 'project item-edit': err('HTTP 403: Resource not accessible') });
  const result = await fileIssue(issue(), deps(fake));
  assert.equal(result.number, 31);
  assert.equal(result.priority, 'not set');
  assert.match(result.note, /couldn't set Priority on board #6: .*HTTP 403.*set it by hand/);
});

test('reports Priority not set when the board has no Priority field', async () => {
  const fake = fakeGh({ ...happy(), 'project field-list': ok(JSON.stringify({ fields: [] })) });
  const result = await fileIssue(issue(), deps(fake));
  assert.equal(result.priority, 'not set');
  assert.match(result.note, /board #6 has no Priority field with a P2 option/);
});

test('skips the board for a unit without one, and says so', async () => {
  const unit = { ...core, board: undefined };
  const fake = fakeGh({ 'issue create': ok(`${URL31}\n`) });
  const result = await fileIssue(issue({ unit }), deps(fake));
  assert.deepEqual(result, { number: 31, url: URL31, priority: 'not set', note: 'rcl-core has no board, so Priority isn’t set' });
  assert.equal(fake.calls.length, 1);
});

test("stops with gh's message when the issue can't be created, and calls nothing else", async () => {
  const fake = fakeGh({ ...happy(), 'issue create': err('error connecting to api.github.com') });
  await assert.rejects(fileIssue(issue(), deps(fake)), /could not create the issue: error connecting to api\.github\.com/);
  assert.equal(fake.calls.length, 1);
});

test('CLI without its required flags prints usage and exits 2', () => {
  const root = makeTree({ 'release-kit.json': TWO_UNITS });
  const out = spawnSync(process.execPath, [SCRIPT, '--unit', 'rcl-core', '--root', root], { encoding: 'utf8' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /^usage: file-issue\.mjs --unit <id> --kind <bug\|change\|feat> --priority <P0\|P1\|P2>/);
});
