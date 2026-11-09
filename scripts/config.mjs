// Loads release-kit.json, the one file a project adds to use the kit. Node built-ins only.
// The fields are described in README.md, "The config file".
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_FILE = 'release-kit.json';

const fail = (message) => {
  throw new Error(`${CONFIG_FILE}: ${message}`);
};

const TOP_FIELDS = ['repo', 'node', 'signer', 'specs', 'ci', 'units'];
const UNIT_FIELDS = ['name', 'changelog', 'versionFiles', 'tagPrefix', 'milestone', 'signOff', 'label', 'board', 'prepareSteps'];

// A misspelt optional field would silently turn off what it controls, so every field must be one we know.
function knownFields(value, allowed, at) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${at}${key} is not a field: use ${allowed.join(', ')}`);
  }
}

const isString = (v) => typeof v === 'string' && v.length > 0;
const isStringList = (v) => Array.isArray(v) && v.every(isString);

function requireString(value, path) {
  if (!isString(value)) fail(`${path} must be a non-empty string`);
  return value;
}

function requireTemplate(value, path) {
  requireString(value, path);
  if (!value.includes('{version}')) fail(`${path} must contain {version}`);
  return value;
}

function readVersionFiles(value, path) {
  if (!Array.isArray(value) || value.length === 0) fail(`${path} must be a non-empty list`);
  return value.map((entry, i) => {
    const at = `${path}[${i}]`;
    if (isString(entry)) return entry;
    if (entry === null || typeof entry !== 'object') fail(`${at} must be a path or {file, pattern}`);
    requireString(entry.file, `${at}.file`);
    requireTemplate(entry.pattern, `${at}.pattern`);
    return { file: entry.file, pattern: entry.pattern };
  });
}

function readUnit(id, value) {
  const at = `units.${id}`;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${at} must be an object`);
  knownFields(value, UNIT_FIELDS, `${at}.`);
  const unit = {
    id,
    name: requireString(value.name, `${at}.name`),
    changelog: requireString(value.changelog, `${at}.changelog`),
    versionFiles: readVersionFiles(value.versionFiles, `${at}.versionFiles`),
    tagPrefix: requireString(value.tagPrefix, `${at}.tagPrefix`),
    milestone: requireTemplate(value.milestone, `${at}.milestone`),
    signOff: requireTemplate(value.signOff, `${at}.signOff`),
    prepareSteps: [],
  };
  if (value.label !== undefined) unit.label = requireString(value.label, `${at}.label`);
  if (value.board !== undefined) {
    if (!Number.isInteger(value.board)) fail(`${at}.board must be a number`);
    unit.board = value.board;
  }
  if (value.prepareSteps !== undefined) {
    if (!isStringList(value.prepareSteps)) fail(`${at}.prepareSteps must be a list of steps`);
    unit.prepareSteps = value.prepareSteps;
  }
  return unit;
}

export function loadConfig(root) {
  const file = join(root, CONFIG_FILE);
  if (!existsSync(file)) throw new Error(`no ${CONFIG_FILE} in ${root}: this repo isn't set up for release-kit`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`not valid JSON (${e.message})`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('must be a JSON object');
  knownFields(raw, TOP_FIELDS, '');

  const repo = requireString(raw.repo, 'repo');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) fail('repo must be owner/name, e.g. wardmanm/rollcall_derby');
  if (!Number.isInteger(raw.node)) fail('node must be a number: the Node major version CI uses');
  if (!isStringList(raw.ci)) fail('ci must be a list of commands');
  if (raw.units === null || typeof raw.units !== 'object' || Array.isArray(raw.units) || !Object.keys(raw.units).length) {
    fail('units must name at least one unit');
  }

  const config = {
    repo,
    owner: repo.split('/')[0],
    node: raw.node,
    signer: requireString(raw.signer, 'signer'),
    ci: raw.ci,
    units: Object.fromEntries(Object.entries(raw.units).map(([id, value]) => [id, readUnit(id, value)])),
  };
  if (raw.specs !== undefined) config.specs = requireString(raw.specs, 'specs');
  return config;
}

// The unit a command is for. Without an id, the repo's only unit.
export function unitOf(config, id) {
  const ids = Object.keys(config.units);
  if (id === undefined) {
    if (ids.length === 1) return config.units[ids[0]];
    throw new Error(`name a unit: ${ids.join(', ')}`);
  }
  if (!Object.hasOwn(config.units, id)) {
    throw new Error(`unknown unit ${JSON.stringify(id)}: use ${ids.join(', ')}`);
  }
  return config.units[id];
}

export const fill = (template, version) => template.replaceAll('{version}', version);
