// The sign-off record: the user's hand check of each feature in a release, written as /release walks
// them through it. Ported from Rollcall's scripts/release.mjs (ADR-0025 there).

const TABLE_SEPARATOR = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;
const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll('\\|', '|'));

// The record's title, tested commit, sign-off date and checks: the rows of its one table, below the header.
export function parseSignOff(text) {
  const normal = text.replace(/\r\n/g, '\n');
  const rows = [];
  let inTable = false;
  for (const line of normal.split('\n')) {
    if (TABLE_SEPARATOR.test(line.trim())) inTable = true;
    else if (inTable && line.trim().startsWith('|')) {
      const [number = '', feature = '', planned = '', steps = '', expect = '', result = ''] = cellsOf(line);
      rows.push({ number, feature, planned, try: steps, expect, result });
    } else if (inTable) break;
  }
  return {
    title: /^# (.+)$/m.exec(normal)?.[1].trim() ?? null,
    tested: /^Tested: `?([0-9a-f]{7,40})`? on \d{4}-\d{2}-\d{2}/m.exec(normal)?.[1] ?? null,
    signedOff: /^Signed off: (\d{4}-\d{2}-\d{2})\b/m.exec(normal)?.[1] ?? null,
    rows,
  };
}

const FAILED = /^fail: .+ \(#(\d+), (P[012])\)$/;

// The notes listed under "## Found while testing" that couldn't be filed, e.g. because gh was offline.
export function unfiledNotes(text) {
  const normal = text.replace(/\r\n/g, '\n');
  const start = normal.search(/^## Found while testing\s*$/m);
  if (start === -1) return [];
  const section = normal.slice(start).split('\n').slice(1);
  const end = section.findIndex((line) => /^#{1,2} /.test(line));
  return (end === -1 ? section : section.slice(0, end))
    .map((line) => /^- not filed: (.+)$/.exec(line.trim())?.[1])
    .filter(Boolean);
}

// What keeps the record from letting the release through: every check must have passed, or failed with only a P1
// or P2 bug, and the signer must have signed it off. Each problem names its check.
export function signOffErrors(text, { file, releaseName, signer = 'the signer' }) {
  const { title, tested, signedOff, rows } = parseSignOff(text);
  const errors = [];
  const expected = `Sign-off: ${releaseName}`;
  if (title !== expected) errors.push(`${file} should start "# ${expected}"`);
  if (!tested) errors.push(`${file} needs the commit that was tested: Tested: \`<sha>\` on YYYY-MM-DD`);
  if (!rows.length) errors.push(`${file} has no checks`);
  for (const [index, { number, feature, result }] of rows.entries()) {
    const which = `${file}: check ${number || index + 1} ${JSON.stringify(feature)}`;
    const bug = FAILED.exec(result);
    if (result === '' || result === 'pending') errors.push(`${which} hasn’t been tried yet`);
    else if (result === 'pass' || (bug && bug[2] !== 'P0')) continue;
    else if (result === 'skip') errors.push(`${which} was skipped, and a skipped check still blocks the release`);
    else if (bug) errors.push(`${which} failed with P0 bug #${bug[1]}: fix it, then try the check again`);
    else if (result.startsWith('fail:')) {
      errors.push(`${which} failed with no bug filed: end its result with (#<issue>, P0|P1|P2)`);
    } else {
      errors.push(
        `${which} has an unreadable result ${JSON.stringify(result)}: use pass, skip, pending or fail: <what happened> (#<issue>, P1)`,
      );
    }
  }
  for (const note of unfiledNotes(text)) {
    errors.push(`${file} has a note that was never filed, ${JSON.stringify(note)}: file it, then put its issue in place of "not filed"`);
  }
  if (!signedOff) {
    errors.push(`${file} isn’t signed off: add "Signed off: YYYY-MM-DD by ${signer}" once ${signer} signs it off`);
  }
  return errors;
}
