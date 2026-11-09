#!/usr/bin/env node
// The release helper: run by the release skill on your machine, and by the release workflow in CI.
// Node built-ins only. Grown from Rollcall's scripts/release.mjs; everything a project differs in is in
// its release-kit.json (README.md, "The config file").
//
//   node release.mjs prepare <version> [--unit <id>] [--date YYYY-MM-DD]  move Unreleased under <version>, bump its version files
//   node release.mjs check <version> [--unit <id>]       the changelog, version files and sign-off are ready
//   node release.mjs notes <version> [--unit <id>]       print the release notes
//   node release.mjs name <version> [--unit <id>]        print the release's name, e.g. "Rollcall Core v0.4.0"
//   node release.mjs meta <version> [--unit <id>]        print TAG=, MILESTONE=, RELEASE_NAME= and BRANCH= lines
//   node release.mjs tag-absent <version> [--unit <id>]  exit 1 unless the release tag is absent on origin
//   node release.mjs milestone <version> [--unit <id>] < milestones.json   exit 1 unless the milestone is ready
//   node release.mjs issues <version> [--unit <id>]      print the issue numbers referenced in the notes
//   node release.mjs pinned [--unit <id>]                print the kit version the unit's caller workflow pins
//   node release.mjs ci [--unit <id>]                    run the config's ci commands in order
//   --unit is needed when the repo has more than one unit. --root <dir> is the project (default: the current folder).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, unitOf, fill } from './config.mjs';
import { versionError, compareVersions } from './version.mjs';
import {
  parseChangelog,
  moveUnreleased,
  isUnreleased,
  hasEntries,
  releasedVersions,
  latestVersion,
  DATE,
} from './changelog.mjs';
import { signOffErrors } from './signoff.mjs';
import { tagStatus, milestoneCheck, issueRefs, pinnedKitRef } from './guards.mjs';

export const COMMANDS = ['prepare', 'check', 'notes', 'name', 'meta', 'tag-absent', 'milestone', 'issues', 'pinned', 'ci'];
const VERSIONLESS = new Set(['pinned', 'ci']);

export const releaseName = (unit, version) => `${unit.name} v${version}`;

export function names(unit, version) {
  return {
    tag: `${unit.tagPrefix}${version}`,
    milestone: fill(unit.milestone, version),
    releaseName: releaseName(unit, version),
    branch: `release/${unit.id}-v${version}`,
  };
}

function readChangelog(root, unit) {
  const file = join(root, unit.changelog);
  if (!existsSync(file)) throw new Error(`${unit.changelog} not found in ${root}`);
  return readFileSync(file, 'utf8');
}

// ---------- version files ----------

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEMVER_TEXT = '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?';

// The files a glob names, relative to root. A `*` matches within one path segment.
function expand(root, glob) {
  const parts = glob.split('/');
  let paths = [''];
  for (const [i, part] of parts.entries()) {
    const last = i === parts.length - 1;
    const next = [];
    for (const base of paths) {
      const at = (name) => (base ? `${base}/${name}` : name);
      if (!part.includes('*')) {
        if (existsSync(join(root, at(part)))) next.push(at(part));
        continue;
      }
      const dir = join(root, base);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      const re = new RegExp(`^${part.split('*').map(escapeRegExp).join('[^/]*')}$`);
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (re.test(entry.name) && (last || entry.isDirectory())) next.push(at(entry.name));
      }
    }
    paths = next;
  }
  return paths.filter((p) => statSync(join(root, p)).isFile()).toSorted((a, b) => a.localeCompare(b));
}

const patternRegExp = (pattern) =>
  new RegExp(escapeRegExp(pattern).replace(escapeRegExp('{version}'), `(${SEMVER_TEXT})`), 'gm');

// Each version file as {file, read(): version | null, write(version)}. Throws for an entry that names nothing.
function versionTargets(root, unit) {
  const targets = [];
  for (const entry of unit.versionFiles) {
    if (typeof entry === 'string') {
      const files = expand(root, entry);
      if (!files.length) throw new Error(`versionFiles "${entry}" matches no file`);
      for (const file of files) {
        const path = join(root, file);
        targets.push({
          file,
          read: () => JSON.parse(readFileSync(path, 'utf8')).version ?? null,
          write: (version) => {
            const data = JSON.parse(readFileSync(path, 'utf8'));
            data.version = version;
            writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
          },
        });
      }
    } else {
      const path = join(root, entry.file);
      if (!existsSync(path)) throw new Error(`versionFiles "${entry.file}" matches no file`);
      const text = readFileSync(path, 'utf8');
      const found = [...text.matchAll(patternRegExp(entry.pattern))];
      if (!found.length) throw new Error(`${entry.file} has no line matching ${JSON.stringify(entry.pattern)}`);
      targets.push({
        file: entry.file,
        read: () => found.map((m) => m[1]).find((v) => v !== found[0][1]) ?? found[0][1],
        write: (version) => writeFileSync(path, text.replace(patternRegExp(entry.pattern), fill(entry.pattern, version))),
      });
    }
  }
  return targets;
}

// ---------- prepare / check / notes ----------

export function prepare(root, unit, version, { date = new Date().toISOString().slice(0, 10), repoUrl } = {}) {
  const bad = versionError(version);
  if (bad) throw new Error(bad);
  // Work everything out before writing anything, so a refusal changes nothing.
  const changelog = moveUnreleased(readChangelog(root, unit), {
    version,
    date,
    repoUrl,
    tagPrefix: unit.tagPrefix,
  });
  const targets = versionTargets(root, unit);
  writeFileSync(join(root, unit.changelog), changelog);
  for (const target of targets) target.write(version);
  return { files: [unit.changelog, ...new Set(targets.map((t) => t.file))] };
}

export function check(root, unit, version, { signer } = {}) {
  const bad = versionError(version);
  if (bad) return [bad];
  let log;
  try {
    log = parseChangelog(readChangelog(root, unit));
  } catch (e) {
    return [e.message];
  }
  const file = unit.changelog;
  const prepareCommand = `release.mjs prepare ${version} --unit ${unit.id}`;
  const errors = [];
  const unreleased = log.sections.find(isUnreleased);
  if (!unreleased) errors.push(`${file} has no "## [Unreleased]" section`);
  else if (hasEntries(unreleased.body)) {
    errors.push(`the Unreleased section of ${file} still has entries; run: ${prepareCommand}`);
  }
  const section = log.sections.find((s) => s.name === version);
  if (!section) {
    errors.push(`${file} has no section for ${version}; run: ${prepareCommand}`);
  } else {
    if (!hasEntries(section.body)) errors.push(`the ${version} section has no entries`);
    if (!section.date || !DATE.test(section.date)) errors.push(`the ${version} section needs a date: ## [${version}] - YYYY-MM-DD`);
  }
  const previous = latestVersion(releasedVersions(log.sections, version));
  if (previous && compareVersions(version, previous) <= 0) {
    errors.push(`${version} is not greater than the previous release ${previous}`);
  }
  try {
    for (const target of versionTargets(root, unit)) {
      const actual = target.read();
      if (actual !== version) errors.push(`${target.file} has version ${actual ?? '(none)'}, expected ${version}`);
    }
  } catch (e) {
    errors.push(e.message);
  }
  const record = fill(unit.signOff, version);
  if (!existsSync(join(root, record))) {
    errors.push(`${record} is missing: run /release ${unit.id} ${version} and finish the sign-off`);
  } else {
    const text = readFileSync(join(root, record), 'utf8');
    errors.push(...signOffErrors(text, { file: record, releaseName: releaseName(unit, version), signer }));
  }
  return errors;
}

export function notes(root, unit, version) {
  const section = parseChangelog(readChangelog(root, unit)).sections.find((s) => s.name === version);
  if (!section) throw new Error(`${unit.changelog} has no section for ${version}`);
  return section.body;
}

// ---------- CLI ----------

const OPTIONS = ['--unit', '--root', '--date'];
const usage = (ids = ['id']) =>
  `usage: release.mjs <${COMMANDS.join('|')}> [<version>] [--unit <${ids.join('|')}>] [--root <dir>] [--date YYYY-MM-DD]`;

function runCi(root, commands) {
  for (const command of commands) {
    console.log(`::group::${command}`);
    const r = spawnSync(command, { shell: true, stdio: 'inherit', cwd: root });
    console.log('::endgroup::');
    if (r.status !== 0) {
      console.error(`ci: ${JSON.stringify(command)} failed (exit ${r.status ?? r.signal})`);
      return r.status || 1;
    }
  }
  return 0;
}

export function main(args, { cwd = process.cwd() } = {}) {
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const [command, version] = args.filter((a, i) => !OPTIONS.includes(a) && !OPTIONS.includes(args[i - 1]));
  if (!COMMANDS.includes(command)) {
    console.error(usage());
    return 2;
  }
  const root = option('--root') ? resolve(option('--root')) : cwd;
  let config;
  try {
    config = loadConfig(root);
  } catch (e) {
    console.error(`release ${command} failed: ${e.message}`);
    return 1;
  }
  const ids = Object.keys(config.units);
  const unitId = option('--unit');
  if ((unitId === undefined && ids.length > 1) || (!VERSIONLESS.has(command) && version === undefined)) {
    console.error(usage(ids));
    return 2;
  }
  try {
    const unit = unitOf(config, unitId);
    if (command === 'pinned') {
      console.log(pinnedKitRef(root, unit.id) ?? 'none');
      return 0;
    }
    if (command === 'ci') return runCi(root, config.ci);

    const bad = versionError(version);
    if (bad) throw new Error(bad);
    const n = names(unit, version);
    if (command === 'prepare') {
      const date = option('--date');
      const { files } = prepare(root, unit, version, {
        repoUrl: `https://github.com/${config.repo}`,
        ...(date ? { date } : {}),
      });
      console.log(`prepared ${unit.id} ${version}: ${files.join(', ')}`);
      console.log(`review the diff, then commit: chore(${unit.id}): prepare v${version}`);
      return 0;
    }
    if (command === 'name') {
      console.log(n.releaseName);
      return 0;
    }
    if (command === 'meta') {
      console.log(`TAG=${n.tag}\nMILESTONE=${n.milestone}\nRELEASE_NAME=${n.releaseName}\nBRANCH=${n.branch}`);
      return 0;
    }
    if (command === 'notes') {
      console.log(notes(root, unit, version));
      return 0;
    }
    if (command === 'issues') {
      // Print strings: console.log colours numbers when FORCE_COLOR is set, even into a pipe.
      for (const issue of issueRefs(notes(root, unit, version))) console.log(String(issue));
      return 0;
    }
    if (command === 'tag-absent') {
      if (tagStatus(n.tag, { cwd: root }) === 'exists') {
        console.error(`tag ${n.tag} already exists; that version is already released. Pick the next one.`);
        return 1;
      }
      console.log(`tag ${n.tag} does not exist yet`);
      return 0;
    }
    if (command === 'milestone') {
      const { milestone, errors } = milestoneCheck(JSON.parse(readFileSync(0, 'utf8') || 'null'), n.milestone);
      if (errors.length) {
        console.error(errors.join('\n'));
        return 1;
      }
      console.log(JSON.stringify(milestone));
      return 0;
    }
    const errors = check(root, unit, version, { signer: config.signer });
    if (errors.length) {
      console.error(
        `release check failed for ${unit.id} ${JSON.stringify(version)}:\n${errors.map((e) => `  - ${e}`).join('\n')}`,
      );
      return 1;
    }
    console.log(`release check OK for ${unit.id} ${version}`);
    return 0;
  } catch (e) {
    console.error(`release ${command} failed: ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
