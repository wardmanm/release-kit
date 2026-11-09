// CHANGELOG.md in the Keep a Changelog format. Ported from Rollcall's scripts/release.mjs.
// A changelog is a preamble, "## [name] - date" sections (newest first), and a footer of
// link reference definitions. formatChangelog(parseChangelog(x)) === x for normalized files.
import { parseVersion, versionError, compareVersions } from './version.mjs';

const SECTION = /^## \[([^\]]+)\](?: - (\S+))?\s*$/;
const LINK_REF = /^\[[^\]]+\]: \S+/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isUnreleased = (section) => section.name.toLowerCase() === 'unreleased';
export const hasEntries = (body) => /^\s*[-*]\s+\S/m.test(body);
const linkLabel = (line) => line.slice(1, line.indexOf(']')).toLowerCase();

export function parseChangelog(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let end = lines.length;
  while (end > 0 && (lines[end - 1].trim() === '' || LINK_REF.test(lines[end - 1]))) end--;
  const footer = lines.slice(end).filter((l) => LINK_REF.test(l));
  const preamble = [];
  const sections = [];
  for (const line of lines.slice(0, end)) {
    const m = SECTION.exec(line);
    if (m) sections.push({ name: m[1], date: m[2] ?? null, body: [] });
    else (sections.length ? sections.at(-1).body : preamble).push(line);
  }
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map(({ name, date, body }) => ({ name, date, body: body.join('\n').trim() })),
    footer,
  };
}

export function formatChangelog({ preamble, sections, footer }) {
  const parts = [preamble];
  for (const s of sections) {
    parts.push(`## [${s.name}]${s.date ? ` - ${s.date}` : ''}`);
    if (s.body) parts.push(s.body);
  }
  if (footer.length) parts.push(footer.join('\n'));
  return parts.join('\n\n') + '\n';
}

export function releasedVersions(sections, except) {
  return sections.filter((s) => !isUnreleased(s) && s.name !== except && parseVersion(s.name)).map((s) => s.name);
}

export function latestVersion(versions) {
  return versions.reduce((best, v) => (best === null || compareVersions(v, best) > 0 ? v : best), null);
}

// The changelog with its Unreleased entries moved under `version`, dated, and the footer's links
// pointing at this repo's tags. Throws, changing nothing, when there's nothing to release.
export function moveUnreleased(text, { version, date, repoUrl, tagPrefix }) {
  const bad = versionError(version);
  if (bad) throw new Error(bad);
  if (!DATE.test(date ?? '')) throw new Error(`invalid date ${JSON.stringify(date)}: use YYYY-MM-DD`);
  const log = parseChangelog(text);
  const unreleased = log.sections.find(isUnreleased);
  if (!unreleased) throw new Error('the changelog has no "## [Unreleased]" section');
  if (log.sections.some((s) => s.name === version)) throw new Error(`the changelog already has a section for ${version}`);
  if (!hasEntries(unreleased.body)) throw new Error('the Unreleased section has no entries to release');
  const previous = latestVersion(releasedVersions(log.sections));
  if (previous && compareVersions(version, previous) <= 0) {
    throw new Error(`${version} is not greater than the latest release ${previous}`);
  }

  log.sections.splice(log.sections.indexOf(unreleased) + 1, 0, { name: version, date, body: unreleased.body });
  unreleased.body = '';
  const tag = `${tagPrefix}${version}`;
  log.footer = [
    `[${unreleased.name}]: ${repoUrl}/compare/${tag}...HEAD`,
    `[${version}]: ${repoUrl}/releases/tag/${tag}`,
    ...log.footer.filter((l) => !['unreleased', version.toLowerCase()].includes(linkLabel(l))),
  ];
  return formatChangelog(log);
}
