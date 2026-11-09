// Checks run by both workflow jobs, and by /release before it asks for a sign-off.
// tagStatus, milestoneCheck and issueRefs are ported from Rollcall's scripts/release.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const KIT_REPO = 'wardmanm/release-kit';

// 'exists' | 'absent'. Throws when the remote can't be read: a failed lookup must never pass as "absent".
export function tagStatus(tag, { cwd, remote = 'origin' } = {}) {
  const ref = `refs/tags/${tag}`;
  const r = spawnSync('git', ['ls-remote', '--exit-code', '--tags', remote, ref], { cwd, encoding: 'utf8' });
  if (r.status === 0) return 'exists';
  if (r.status === 2) return 'absent';
  throw new Error(`could not check tags on ${remote} (git exit ${r.status}): ${(r.stderr || '').trim()}`);
}

// milestones: the GitHub API's milestone list (null when the API returned nothing). Every release has a
// milestone, and it can't be released while the milestone has an open issue.
export function milestoneCheck(milestones, title) {
  const found = (milestones ?? []).find((m) => m.title === title);
  if (!found) {
    return {
      milestone: null,
      errors: [`no milestone titled '${title}'. Create it and assign this release's issues to it.`],
    };
  }
  const milestone = { number: found.number, url: found.html_url };
  if (found.open_issues !== 0) {
    return { milestone, errors: [`milestone '${title}' still has ${found.open_issues} open issue(s): ${found.html_url}`] };
  }
  return { milestone, errors: [] };
}

// Issue numbers referenced as #N in release notes, each once, in order of appearance.
// Skips headings, URL fragments (page#12), cross-repo refs (owner/repo#12) and HTML entities (&#38;).
export function issueRefs(text) {
  const seen = new Set();
  for (const [, n] of text.matchAll(/(?<![\w/&#])#(\d+)\b/g)) seen.add(Number(n));
  return [...seen];
}

// The kit version a unit's caller workflow pins, e.g. "v1.0.0", or null when there's no caller or it
// calls a workflow in its own repo (the kit releasing itself).
export function pinnedKitRef(root, unitId) {
  const file = join(root, '.github', 'workflows', `${unitId}-release.yml`);
  if (!existsSync(file)) return null;
  const m = new RegExp(`uses: ${KIT_REPO}/\\.github/workflows/release\\.yml@(\\S+)`).exec(readFileSync(file, 'utf8'));
  return m ? m[1] : null;
}
