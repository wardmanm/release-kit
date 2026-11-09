// Fixtures shared by the *.test.mjs files. Not a test file itself: node --test "scripts/*.test.mjs" skips it.
import { after } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [];
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

export function tempDir(prefix = 'kit-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

// A temp folder holding `files` ({relative path: content}); objects are written as JSON.
export function makeTree(files) {
  const root = tempDir('kit-tree-');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
  return root;
}

function git(cwd, ...args) {
  const r = spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

// A git work tree whose origin (a local bare repo) has these tags. Extra files are written first.
export function gitRepoWithRemote(tags, files = {}) {
  const root = tempDir('kit-git-');
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  git(root, 'init', '-q', '--bare', remote);
  git(root, 'init', '-q', work);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(work, rel)), { recursive: true });
    writeFileSync(join(work, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'x');
  git(work, 'remote', 'add', 'origin', remote);
  for (const tag of tags) git(work, 'tag', tag);
  git(work, 'push', '-q', '--tags', 'origin', 'HEAD:refs/heads/main');
  return work;
}

export const REPO = 'o/r';
export const REPO_URL = `https://github.com/${REPO}`;

export const HEADER = '# Changelog\n\nAll notable changes are documented here.';

export const FIRST = `${HEADER}

## [Unreleased]

### Added

- Team Builder (#12)

[Unreleased]: ${REPO_URL}/commits/main
`;

export const FIRST_PREPARED = `${HEADER}

## [Unreleased]

## [0.1.0] - 2026-10-14

### Added

- Team Builder (#12)

[Unreleased]: ${REPO_URL}/compare/rcl-core-v0.1.0...HEAD
[0.1.0]: ${REPO_URL}/releases/tag/rcl-core-v0.1.0
`;

export const SECOND = `${HEADER}

## [Unreleased]

### Fixed

- Roster paging (#20)

## [0.1.0] - 2026-10-14

### Added

- Team Builder (#12)

[Unreleased]: ${REPO_URL}/compare/rcl-core-v0.1.0...HEAD
[0.1.0]: ${REPO_URL}/releases/tag/rcl-core-v0.1.0
`;

export const SECOND_PREPARED = `${HEADER}

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

// A sign-off record for Rollcall Core 0.1.0 with one check per result, signed off unless `signedOff` is null.
export function signOffRecord(
  results = ['pass'],
  { title = 'Sign-off: Rollcall Core v0.1.0', signedOff = 'Signed off: 2026-10-14 by Mike' } = {},
) {
  return [
    `# ${title}`,
    '',
    'Tested: `abc1234` on 2026-10-14',
    ...(signedOff ? [signedOff] : []),
    '',
    '| # | Feature | Planned | Try | Expect | Result |',
    '|---|---|---|---|---|---|',
    ...results.map(
      (result, n) =>
        `| ${n + 1} | Team Builder (#12) | team-builder R${n + 1} | Add a team | It's listed | ${result} |`,
    ),
    '',
  ].join('\n');
}

const unit = (id, name) => ({
  name,
  changelog: `${id}/CHANGELOG.md`,
  versionFiles: [`${id}/*/package.json`],
  tagPrefix: `${id}-v`,
  milestone: `${id} v{version}`,
  signOff: `${id}/sign-off/{version}.md`,
  label: id,
  board: id === 'rcl-core' ? 6 : 8,
});

// A two-unit release-kit.json, like Rollcall's.
export const TWO_UNITS = {
  repo: REPO,
  node: 24,
  signer: 'Mike',
  ci: ['true'],
  units: { 'rcl-core': unit('rcl-core', 'Rollcall Core'), 'rcl-producer': unit('rcl-producer', 'Rollcall Producer') },
};

export const pkg = (version) => JSON.stringify({ name: 'x', version, private: true }, null, 2) + '\n';
