#!/usr/bin/env node
// Files one issue the user has confirmed: creates it, puts it on the unit's board and sets its Priority.
// Node built-ins and the gh CLI only. Used by the release skill for notes taken during a sign-off.
//
//   node file-issue.mjs --unit <id> --kind <bug|change|feat> --priority <P0|P1|P2> --title <title>
//     [--milestone <title>] [--label <label>]... --body-file <path|-> [--root <dir>]
//
// Prints {"number", "url", "priority", "note"?} as JSON. Priority is "not set" (with a note saying why) when the
// board can't be updated: the issue is still filed, and the user sets Priority by hand. Exits 1 only when the
// issue itself couldn't be created, in which case nothing was filed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, unitOf } from './config.mjs';
import { isMain } from './release.mjs';

const KIND_LABEL = { bug: 'bug', change: 'enhancement', feat: 'enhancement' };
const PRIORITIES = ['P0', 'P1', 'P2'];
const CARD_TRIES = 5;
const CARD_WAIT_MS = 3000;

export function realGh(args, input) {
  const r = spawnSync('gh', args, { input, encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr || (r.error ? String(r.error.message) : '') };
}

const realSleep = (ms) => new Promise((done) => setTimeout(done, ms));

function validate({ kind, priority, title, milestone }) {
  if (!Object.hasOwn(KIND_LABEL, kind)) throw new Error('kind must be bug, change or feat');
  if (!PRIORITIES.includes(priority)) throw new Error('priority must be P0, P1 or P2');
  if (!title || !title.trim()) throw new Error('the issue needs a title');
  if (priority === 'P0' && !milestone) {
    throw new Error('a P0 goes in the milestone of the release it blocks: give its milestone');
  }
  if (priority !== 'P0' && milestone) {
    throw new Error('only a P0 goes in a milestone: a P1 or P2 must not hold a release back');
  }
}

// The board card for the issue, or null.
function findCard(gh, board, owner, url, number) {
  const r = gh(['project', 'item-list', String(board), '--owner', owner, '--format', 'json', '--limit', '1000']);
  if (r.status !== 0) throw new Error(r.stderr.trim());
  const items = JSON.parse(r.stdout || '{}').items ?? [];
  return items.find((item) => item.content?.url === url || (!item.content?.url && item.content?.number === number)) ?? null;
}

async function waitForCard(gh, sleep, board, owner, url, number) {
  for (let i = 0; i < CARD_TRIES; i++) {
    const card = findCard(gh, board, owner, url, number);
    if (card) return card;
    if (i < CARD_TRIES - 1) await sleep(CARD_WAIT_MS);
  }
  return null;
}

async function setPriority(gh, sleep, { board, owner, url, number, priority }) {
  // The board usually adds the card itself, from the unit's label, within a few seconds.
  let card = await waitForCard(gh, sleep, board, owner, url, number);
  if (!card) {
    const added = gh(['project', 'item-add', String(board), '--owner', owner, '--url', url]);
    if (added.status !== 0 && !/Content already exists/i.test(added.stderr)) throw new Error(added.stderr.trim());
    card = await waitForCard(gh, sleep, board, owner, url, number);
    if (!card) throw new Error(`the card for #${number} isn't on the board`);
  }
  const fields = gh(['project', 'field-list', String(board), '--owner', owner, '--format', 'json']);
  if (fields.status !== 0) throw new Error(fields.stderr.trim());
  const field = (JSON.parse(fields.stdout || '{}').fields ?? []).find((f) => f.name === 'Priority');
  const option = field?.options?.find((o) => o.name === priority);
  if (!option) return { note: `board #${board} has no Priority field with a ${priority} option; set it by hand` };
  const project = gh(['project', 'view', String(board), '--owner', owner, '--format', 'json', '--jq', '.id']);
  if (project.status !== 0) throw new Error(project.stderr.trim());
  const edit = gh([
    'project', 'item-edit', '--id', card.id, '--project-id', project.stdout.trim(), '--field-id', field.id,
    '--single-select-option-id', option.id,
  ]);
  if (edit.status !== 0) throw new Error(edit.stderr.trim());
  return {};
}

export async function fileIssue(
  { config, unit, kind, priority, title, body = '', milestone, labels = [] },
  { gh = realGh, sleep = realSleep } = {},
) {
  validate({ kind, priority, title, milestone });
  const labelArgs = [KIND_LABEL[kind], ...(unit.label ? [unit.label] : []), ...labels].flatMap((l) => ['--label', l]);
  const created = gh(
    [
      'issue', 'create', '--repo', config.repo, '--title', title, ...labelArgs,
      ...(milestone ? ['--milestone', milestone] : []), '--body-file', '-',
    ],
    body,
  );
  if (created.status !== 0) throw new Error(`could not create the issue: ${created.stderr.trim()}`);
  const url = created.stdout.trim().split('\n').at(-1).trim();
  const number = Number(/\/issues\/(\d+)$/.exec(url)?.[1]);
  if (!number) throw new Error(`gh created an issue but printed no issue URL: ${JSON.stringify(created.stdout)}`);

  if (unit.board === undefined) {
    return { number, url, priority: 'not set', note: `${unit.id} has no board, so Priority isn’t set` };
  }
  try {
    const { note } = await setPriority(gh, sleep, { board: unit.board, owner: config.owner, url, number, priority });
    return note ? { number, url, priority: 'not set', note } : { number, url, priority };
  } catch (e) {
    return {
      number,
      url,
      priority: 'not set',
      note: `couldn't set Priority on board #${unit.board}: ${e.message}; set it by hand`,
    };
  }
}

// ---------- CLI ----------

const USAGE =
  'usage: file-issue.mjs --unit <id> --kind <bug|change|feat> --priority <P0|P1|P2> --title <title> [--milestone <title>] [--label <label>]... --body-file <path|-> [--root <dir>]';

async function main(args) {
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const labels = args.flatMap((a, i) => (a === '--label' && args[i + 1] !== undefined ? [args[i + 1]] : []));
  const [kind, priority, title, bodyFile] = ['--kind', '--priority', '--title', '--body-file'].map(option);
  if (!kind || !priority || !title || !bodyFile) {
    console.error(USAGE);
    return 2;
  }
  try {
    const config = loadConfig(option('--root') ? resolve(option('--root')) : process.cwd());
    const unit = unitOf(config, option('--unit'));
    const body = readFileSync(bodyFile === '-' ? 0 : bodyFile, 'utf8');
    const result = await fileIssue({ config, unit, kind, priority, title, body, milestone: option('--milestone'), labels });
    console.log(JSON.stringify(result));
    return 0;
  } catch (e) {
    console.error(`file-issue failed: ${e.message}`);
    return 1;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
