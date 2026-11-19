// Helpers for #2340's acceptance tests: a scratch copy of the checkout with two fixture design docs, the recording
// stand-in for `gh` first on PATH, one run of the script (or of a planted wrong program) in that copy, the readers of
// its table, summary line, BLOCKED line and JSON, and the judges each criterion's test applies to the script and to its
// planted program. The README gives the surface they read, the fixture and the stand-in. Node built-ins only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SUITE = join(CHECKOUT, 'tests/acceptance/2340');
/** The script #2340 asks for, beside scripts/design-links.mjs (README: The surface). */
export const SCRIPT = 'scripts/design-issues.mjs';
export const TD = 'docs/technical-design.md';
export const CP = 'docs/canvas-primitives.md';
const BLOB = 'https://github.com/windoliver/deepbuild/blob/main/';
export const TIMEOUT_MS = 300_000;
const WORDS = ['closed', 'mixed', 'open', 'unlinked'];

// The fixture's two docs, in place of the real design docs. Their headings' slugs, worked by hand by GitHub's rules
// (README: The fixture): technical-design-fixture, alpha-section, beta-section, six-weeks-to-version-0 (with the
// explicit <a id="plan"> before it) and week-one; canvas-primitives-fixture, gamma-section, delta-section,
// foxtrot-section and golf-section.
const DOCS = {
  [TD]: [
    '# Technical design (fixture)',
    '',
    "A planted design doc for #2340's acceptance tests, in place of the real one.",
    '',
    '## Alpha section',
    '',
    'The alpha part.',
    '',
    '## Beta section',
    '',
    'The beta part.',
    '',
    '<a id="plan"></a>',
    '',
    '## Six weeks to version 0',
    '',
    'The plan. Its explicit anchor and its own slug name this one heading.',
    '',
    '### Week one',
    '',
    'The first week.',
    '',
  ].join('\n'),
  [CP]: [
    '# Canvas primitives (fixture)',
    '',
    "A planted design doc for #2340's acceptance tests, in place of the real one.",
    '',
    '## Gamma section',
    '',
    'The gamma part.',
    '',
    '## Delta section',
    '',
    'The delta part.',
    '',
    '## Foxtrot section',
    '',
    'The foxtrot part.',
    '',
    '## Golf section',
    '',
    'The golf part.',
    '',
  ].join('\n'),
};

const body = (number, lines) => [`A planted issue for #2340's acceptance tests (${number}), not a real one.`, '', ...lines].join('\n');
const issue = (number, state, reason, lines) => ({ number, title: `Fixture issue ${number}`, state, reason, body: body(number, lines) });

/**
 * The fixture's eight issues, newest first as the tracker lists them: five closed as completed (#9801 to #9805), two
 * open (#9806, #9807) and one closed as not planned (#9808). Each links headings of the two docs by a full link on
 * main, a relative docs/ link or a bare link, as issues do.
 */
export const ISSUES = [
  issue(9808, 'closed', 'not_planned', [`**Design:** [Delta section](${BLOB}${CP}#delta-section)`]),
  issue(9807, 'open', null, [`**Design:** [Gamma section](${BLOB}${CP}#gamma-section) · [Six weeks to version 0](${BLOB}${TD}#six-weeks-to-version-0)`]),
  issue(9806, 'open', null, [`**Design:** [Beta section](${BLOB}${TD}#beta-section) · [Foxtrot section](${BLOB}${CP}#foxtrot-section)`, '', `- The rest, as the [golf part](${CP}#golf-section) says.`]),
  issue(9805, 'closed', 'completed', [
    `**Design:** [Foxtrot section](${BLOB}${CP}#foxtrot-section)`,
    '',
    `- Its first part, as [the foxtrot part](${CP}#foxtrot-section) says.`,
    `- Its second part: ${BLOB}${CP}#foxtrot-section.`,
  ]),
  issue(9804, 'closed', 'completed', [`**Design:** [The plan](${BLOB}${TD}#plan)`]),
  issue(9803, 'closed', 'completed', [`**Design:** [Beta section](${TD}#beta-section)`]),
  issue(9802, 'closed', 'completed', [`Design: ${BLOB}${TD}#alpha-section`]),
  issue(9801, 'closed', 'completed', [`**Design:** [Alpha section](${BLOB}${TD}#alpha-section)`]),
];

/** The rows the fixture must give, by the issue's rules (README: The fixture). */
export const ROW = {
  alpha: { file: TD, anchor: 'alpha-section', closed: [9801, 9802], open: [], reads: 'closed' },
  beta: { file: TD, anchor: 'beta-section', closed: [9803], open: [9806], reads: 'mixed' },
  plan: { file: TD, anchor: 'six-weeks-to-version-0', closed: [9804], open: [9807], reads: 'mixed' },
  gamma: { file: CP, anchor: 'gamma-section', closed: [], open: [9807], reads: 'open' },
  delta: { file: CP, anchor: 'delta-section', closed: [], open: [], reads: 'unlinked', why: 'only #9808, closed as not planned, links it, and such an issue is not read' },
  foxtrot: { file: CP, anchor: 'foxtrot-section', closed: [9805], open: [9806], reads: 'mixed' },
};

/** AC4's 250 closed issues, #9250 down to #9001, each closed as completed and linking the alpha section. */
export const PAGED = Array.from({ length: 250 }, (_, i) => issue(9250 - i, 'closed', 'completed', [`**Design:** [Alpha section](${BLOB}${TD}#alpha-section)`]));

// The variables that point git at a repository other than the one its working folder holds. None reaches git in a
// scratch copy, or the script run there.
const GIT_LOCATION = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];
const withoutGitLocation = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => !GIT_LOCATION.includes(name)));

/**
 * A sandbox under the OS temp folder, removed after the test. `repo/` holds the checkout's own root files and
 * scripts/, the fixture's two docs as its only docs/, node_modules linked to the checkout's, and a fresh git
 * repository of its own whose origin is the project's. HOME, TMPDIR and the XDG folders are the sandbox's own.
 */
function scratch(t) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2340-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  // The root's own files, but never .git, which in a worktree is a file pointing at the shared repository, and never
  // a local .env, which may hold secrets.
  for (const entry of readdirSync(CHECKOUT, { withFileTypes: true })) if (entry.isFile() && entry.name !== '.git' && !entry.name.startsWith('.env')) copyFileSync(join(CHECKOUT, entry.name), join(repo, entry.name));
  cpSync(join(CHECKOUT, 'scripts'), join(repo, 'scripts'), { recursive: true, filter: (from) => !/\/(?:node_modules|target|\.git)(?:\/|$)/.test(from.slice(CHECKOUT.length)) });
  for (const [path, text] of Object.entries(DOCS)) writeFileSync(join(repo, path), text);
  if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  const git = (args) => {
    const run = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, env: withoutGitLocation(process.env), encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`BLOCKED: git ${args.join(' ')} failed in the scratch copy: ${run.error?.message ?? run.stderr}`);
  };
  git(['init', '-q']);
  // remote add writes the repository's config, so only into the copy's own new repository.
  if (!lstatSync(join(repo, '.git'), { throwIfNoEntry: false })?.isDirectory()) throw new Error(`BLOCKED: git init made no repository of the scratch copy's own at ${join(repo, '.git')}`);
  git(['remote', 'add', 'origin', 'https://github.com/windoliver/deepbuild.git']);
  for (const folder of ['home', 'tmp', 'cache', 'config', 'bin', 'out']) mkdirSync(join(sandbox, folder));
  return { sandbox, repo };
}

const sh = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/** Puts the recording stand-in first on PATH over `issues` (README: The stand-in); returns its call log. */
function standIn(sandbox, issues, failFromPage) {
  const tracker = join(sandbox, 'tracker.json');
  writeFileSync(tracker, JSON.stringify({ issues, failFromPage }));
  const log = join(sandbox, 'gh-calls.log');
  writeFileSync(log, '');
  const gh = join(sandbox, 'bin', 'gh');
  writeFileSync(gh, `#!/bin/sh\nexec ${sh(process.execPath)} ${sh(join(SUITE, 'gh-standin.mjs'))} ${sh(tracker)} ${sh(log)} "$@"\n`);
  chmodSync(gh, 0o755);
  return log;
}

/**
 * No GitHub token, host or repo, no git variable pointing at another repository, no cached open issues, the sandbox's
 * own home and the stand-in first on PATH.
 */
function sandboxEnv(sandbox) {
  const env = withoutGitLocation(process.env);
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_OPEN_ISSUES', 'DEEP_PREFLIGHT', 'NODE_OPTIONS', 'NODE_TEST_CONTEXT']) delete env[name];
  return {
    ...env,
    PATH: [join(sandbox, 'bin'), dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
  };
}

const clip = (text, max = 8000) => (text.length > max ? `${text.slice(0, max - 2000)}\n… ${text.length - max} characters cut …\n${text.slice(-2000)}` : text);
const numbers = (cell = '') => [...cell.matchAll(/#(\d+)/g)].map(([, number]) => Number(number));

/**
 * The table on stdout: every line that starts with `|` is a table line; a row is one whose first cell is
 * `docs/<file>.md#<anchor>`, read as `| <file>#<anchor> | <closed> | <open> | <word> |` with issues as `#<n>`.
 */
export function readTable(stdout) {
  const tableLines = stdout.split(/\r?\n/).filter((line) => line.trim().startsWith('|'));
  const rows = [];
  const malformed = [];
  for (const line of tableLines) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim().replace(/^`([^`]*)`$/, '$1'));
    const heading = cells[0].match(/^(docs\/[^\s#|]+\.md)#(\S+)$/);
    if (!heading) continue;
    if (cells.length !== 4) malformed.push(line.trim());
    else rows.push({ file: heading[1], anchor: heading[2], closed: numbers(cells[1]), open: numbers(cells[2]), reads: cells[3] });
  }
  return { tableLines, rows, malformed };
}

const SUMMARY = /(\d[\d,]*) headings? linked: (\d[\d,]*) closed, (\d[\d,]*) mixed, (\d[\d,]*) open; (\d[\d,]*) unlinked; (\d[\d,]*) issues? read: (\d[\d,]*) closed, (\d[\d,]*) open\.?$/;
/** The summary line, read only as the last line of stdout; `anywhere` says whether any line of stdout is one. */
export function readSummary(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const anywhere = lines.some((line) => SUMMARY.test(line));
  const match = lines.at(-1)?.match(SUMMARY);
  if (!match) return { summary: null, summaryAnywhere: anywhere };
  const [linked, closed, mixed, open, unlinked, read, readClosed, readOpen] = match.slice(1).map((value) => Number(value.replaceAll(',', '')));
  return { summary: { line: lines.at(-1), linked, closed, mixed, open, unlinked, issues: { read, closed: readClosed, open: readOpen } }, summaryAnywhere: anywhere };
}

const blockedLines = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^BLOCKED\b/.test(line));

/**
 * Runs the script (or, with `planted`, the planted wrong program of that name in planted/) once in a fresh scratch
 * copy, over the stand-in serving `issues`, failing every page of the closed issues from `failFromPage` on when it is
 * set; with `json`, as `--json <file>`. The script must exist: on the base this assertion is where each test fails.
 */
export function run(t, { issues, failFromPage = null, json = false, planted = null }) {
  const { sandbox, repo } = scratch(t);
  const log = standIn(sandbox, issues, failFromPage);
  if (!planted) assert.ok(existsSync(join(repo, SCRIPT)), `${SCRIPT} does not exist: the script #2340 asks for, beside scripts/design-links.mjs, isn't in this checkout`);
  const program = planted ? join(SUITE, 'planted', `${planted}.mjs`) : SCRIPT;
  const name = planted ? `the planted ${planted}.mjs` : SCRIPT;
  const jsonFile = join(sandbox, 'out', 'design-issues.json');
  const child = spawnSync(process.execPath, [program, ...(json ? ['--json', jsonFile] : [])], { cwd: repo, env: sandboxEnv(sandbox), encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 28 });
  const stdout = child.stdout ?? '';
  const stderr = child.stderr ?? '';
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => `gh ${JSON.parse(line).join(' ')}`);
  const result = { name, status: child.status, signal: child.signal, stdout, stderr, calls, ...readTable(stdout), ...readSummary(stdout), blocked: blockedLines(`${stdout}\n${stderr}`) };
  result.output = [
    `${name}${json ? ' --json <file>' : ''} exited ${child.status}${child.signal ? `, stopped by ${child.signal} after ${TIMEOUT_MS / 1000} s` : ''}`,
    `stdout:\n${clip(stdout) || '(empty)'}`,
    `stderr:\n${clip(stderr) || '(empty)'}`,
    `recorded gh calls:\n${calls.join('\n') || '(none)'}`,
  ].join('\n');
  if (json) {
    try {
      result.json = JSON.parse(readFileSync(jsonFile, 'utf8'));
    } catch (error) {
      result.jsonError = existsSync(jsonFile) ? `the file --json named isn't JSON: ${error.message}` : 'the file --json named was not written';
    }
  }
  return result;
}

export const key = ({ file, anchor }) => `${file}#${anchor}`;
const list = (values) => (values.length ? values.map((number) => `#${number}`).join(' ') : 'none');
const sorted = (values) => [...values].sort((a, b) => a - b);
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** A run over a stand-in that served every issue: exit 0, no BLOCKED, and a table of well-formed rows. */
export function fullRead(run) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped after ${TIMEOUT_MS / 1000} s`);
  else if (run.status !== 0) problems.push(`${run.name} exited ${run.status}, not 0, though the stand-in served every issue in full`);
  for (const line of run.blocked) problems.push(`${run.name} printed BLOCKED though the stand-in served every issue in full: ${line}`);
  for (const line of run.malformed) problems.push(`a table row hasn't the four cells Heading | Closed | Open | Reads: ${line}`);
  if (!run.rows.length) problems.push(`${run.name} printed no table row, \`| docs/<file>.md#<anchor> | <closed issues> | <open issues> | <word> |\``);
  return problems;
}

/** Each expected row is on exactly one row of the table, with its closed and open issues and its word. */
export function rowProblems(run, expected) {
  const problems = [];
  for (const want of expected) {
    const rows = run.rows.filter((row) => row.file === want.file && row.anchor === want.anchor);
    if (rows.length !== 1) {
      problems.push(`${key(want)} is on ${rows.length} rows of the table, not one`);
      continue;
    }
    const [row] = rows;
    if (row.reads !== want.reads) problems.push(`${key(want)} reads ${row.reads || 'nothing'} (closed: ${list(row.closed)}; open: ${list(row.open)}), not ${want.reads}${want.why ? `: ${want.why}` : ''}`);
    if (!same(row.closed, want.closed)) problems.push(`${key(want)} lists the closed issues ${list(row.closed)}, not ${list(want.closed)}`);
    if (!same(row.open, want.open)) problems.push(`${key(want)} lists the open issues ${list(row.open)}, not ${list(want.open)}`);
  }
  return problems;
}

/** AC2: the heading "Six weeks to version 0" is one row, by its slug, however an issue links it. */
export function oneRowProblems(run) {
  const anchors = ['plan', ROW.plan.anchor];
  const rows = run.rows.filter((row) => row.file === TD && anchors.includes(row.anchor));
  if (rows.length !== 1) return [`the heading "Six weeks to version 0" is on ${rows.length} rows (${rows.map(key).join(', ') || 'none'}), not one: #9804 links its <a id="plan"> and #9807 its slug ${ROW.plan.anchor}, and an <a id> and the slug of the heading that follows it are one row`];
  return rowProblems(run, [ROW.plan]);
}

/** AC3: #9805 links the foxtrot section three times and is on its row once. */
export function countsOnceProblems(run) {
  const rows = run.rows.filter((row) => row.file === CP && row.anchor === ROW.foxtrot.anchor);
  if (rows.length !== 1) return [`${key(ROW.foxtrot)} is on ${rows.length} rows of the table, not one`];
  const times = rows[0].closed.filter((number) => number === 9805).length;
  const problems = times === 1 ? [] : [`${key(ROW.foxtrot)} counts #9805 ${times} times (closed: ${list(rows[0].closed)}), not once: #9805 links it three times, and an issue that links a heading more than once counts once`];
  return [...problems, ...rowProblems(run, [ROW.foxtrot])];
}

/** AC4: the summary line counts every closed issue the stand-in served as read. */
export function readCountProblems(run, served) {
  if (!run.summary) return [`${run.name} doesn't end with the summary line, \`<n> headings linked: <n> closed, <n> mixed, <n> open; <n> unlinked; <n> issues read: <n> closed, <n> open\``];
  const { read, closed } = run.summary.issues;
  return read === served && closed === served ? [] : [`the summary counts ${read} issues read, ${closed} of them closed, not the ${served} closed issues the stand-in served in pages of 100: ${run.summary.line}`];
}

/** AC4: with a page of the closed issues failing, BLOCKED names the fetch, no table or summary is printed, and the run fails. */
export function partialReadProblems(run) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped after ${TIMEOUT_MS / 1000} s`);
  else if (run.status === 0) problems.push(`${run.name} exited 0 though the stand-in failed on the second page of the closed issues`);
  if (!run.blocked.some((line) => /\bclosed\b/i.test(line) && /\bpage[ =]2\b/.test(line))) problems.push(`no BLOCKED line names the fetch that failed, page 2 of the closed issues (BLOCKED lines: ${run.blocked.join(' | ') || 'none'})`);
  if (run.tableLines.length) problems.push(`${run.name} printed a table from a partial read: ${run.tableLines.length} table lines, ${run.rows.length} of them rows`);
  if (run.summaryAnywhere) problems.push(`${run.name} printed a summary line from a partial read`);
  return problems;
}

/** AC5: the JSON of one run holds the rows and the summary its table holds. */
export function jsonProblems(run) {
  if (run.jsonError) return [`no JSON from --json <file>: ${run.jsonError}`];
  const { json } = run;
  if (!Array.isArray(json?.rows)) return [`the JSON has no list of rows: ${clip(JSON.stringify(json), 2000)}`];
  const problems = [];
  // A table that shows nothing can't be compared: the fixture has headings of each reading.
  for (const word of WORDS) if (!run.rows.some((row) => row.reads === word)) problems.push(`the table lists no heading that reads ${word}`);
  const jsonRows = json.rows.map((row) => ({
    file: row?.file,
    anchor: row?.anchor,
    closed: Array.isArray(row?.closed) ? row.closed.map(Number) : [],
    open: Array.isArray(row?.open) ? row.open.map(Number) : [],
    reads: row?.reads,
  }));
  for (const word of WORDS) {
    const inTable = run.rows.filter((row) => row.reads === word).length;
    const inJson = jsonRows.filter((row) => row.reads === word).length;
    if (inTable !== inJson) problems.push(`the table lists ${inTable} ${word} headings and the JSON ${inJson}`);
  }
  const shown = (row) => `${key(row)} | closed ${list(sorted(row.closed))} | open ${list(sorted(row.open))} | ${row.reads}`;
  const inJson = new Set(jsonRows.map(shown));
  const inTable = new Set(run.rows.map(shown));
  for (const row of inTable) if (!inJson.has(row)) problems.push(`a row of the table isn't in the JSON: ${row}`);
  for (const row of inJson) if (!inTable.has(row)) problems.push(`a row of the JSON isn't in the table: ${row}`);
  if (jsonRows.length !== run.rows.length) problems.push(`the table has ${run.rows.length} rows and the JSON ${jsonRows.length}`);
  if (!run.summary) problems.push(`${run.name} doesn't end with the summary line`);
  else {
    const fields = [['linked', (s) => s?.linked], ['closed', (s) => s?.closed], ['mixed', (s) => s?.mixed], ['open', (s) => s?.open], ['unlinked', (s) => s?.unlinked],
      ['issues.read', (s) => s?.issues?.read], ['issues.closed', (s) => s?.issues?.closed], ['issues.open', (s) => s?.issues?.open]];
    for (const [field, value] of fields) if (value(json.summary) !== value(run.summary)) problems.push(`the summary line's ${field} is ${value(run.summary)} and the JSON summary's ${JSON.stringify(value(json.summary))}`);
  }
  return problems;
}
