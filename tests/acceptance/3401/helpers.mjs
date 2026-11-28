// Helpers for #3401's acceptance tests: the generated headings of "Registries and closed lists" read structurally (the
// headings inside the section whose own text holds generated rows), an own-text oracle written from #2338's rule,
// scratch copies of the checkout under the OS temp folder (git repositories of their own, whose origin/main is their
// first commit), one run of a script there or in the checkout, the merge base read through git, the planted field list,
// the planted wrong outputs, and the judgement each criterion's test applies. The README gives the surface they read.
// Node built-ins only; nothing here imports the scripts under test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CEILINGS_SCRIPT = 'scripts/doc-ceilings.mjs';
export const CLOSURES_SCRIPT = 'scripts/canvas-closures.mjs';
export const CEILINGS = 'scripts/doc-ceilings.json';
export const TD = 'docs/technical-design.md';
export const CP = 'docs/canvas-primitives.md';
export const FILL = 'crates/deep-canvas/src/registry/fields.json';
export const CLOSURE_DATA = 'packages/contracts/canvas-closures.json';
export const SUITE_2338 = 'tests/acceptance/2338';
export const SECTION_ID = 'registries-and-closed-lists';
export const SECTION_KEY = `${CP}#${SECTION_ID}`;
/** The ceilings' limit (#2338), the issue's bound for a generated heading, and its bound for the section. */
export const LIMIT = 16_384;
export const HEADING_LIMIT = 8_192;
export const SECTION_UNDER = 20_000;
const TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------------------------------------------
// Headings, own text and the generated headings.

// GitHub's slug and a heading's rendered text, as the design links lane reads them (scripts/doc-links.mjs at the base).
const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replaceAll(' ', '-');
const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

/**
 * A doc's headings in order: slug (with the -1, -2 rule), level, the index of its line, the byte offset of its line
 * and its own text's size, the bytes from its line to the next heading's line of any level, or the end. A line in
 * fenced code is never a heading.
 */
export function outlineOf(buffer) {
  const headings = [];
  const slugs = new Set();
  let fence;
  let offset = 0;
  for (const [i, raw] of buffer.toString('utf8').split('\n').entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const at = offset;
    offset += Buffer.byteLength(raw) + 1;
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = undefined;
      continue;
    }
    if (mark) { fence = mark[1]; continue; }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    if (!heading) continue;
    const base = slug(headingText(heading[2]));
    let id = base;
    for (let n = 1; slugs.has(id); n++) id = `${base}-${n}`;
    slugs.add(id);
    headings.push({ id, level: heading[1].length, line: i, offset: at });
  }
  for (const [i, heading] of headings.entries()) heading.size = (headings[i + 1]?.offset ?? buffer.length) - heading.offset;
  return headings;
}

/** A generated row: a table line whose first cell is one code span, the list's name, as `table` writes it. */
const ROW = /^\| `([^`]+)` \|/;
const rowsIn = (text) => text.split('\n').filter((line) => ROW.test(line)).map((line) => ({ list: line.match(ROW)[1], line }));

/**
 * The section and its generated headings (README: A generated heading). `section` is the heading "Registries and
 * closed lists" with its own text and the generated rows that text holds (`rows`: all of them on the merge base, none
 * once every row sits under a generated heading); `headings` are the headings inside the section (deeper than it,
 * before the next heading of its level or higher) whose own text holds at least one generated row, in the doc's order,
 * each with its key `<doc>#<slug>`, own text, size and rows.
 */
export function generatedOf(buffer) {
  const outline = outlineOf(buffer);
  const at = outline.findIndex((heading) => heading.id === SECTION_ID);
  if (at < 0) return { section: null, headings: [] };
  let end = at + 1;
  while (end < outline.length && outline[end].level > outline[at].level) end++;
  const read = (heading) => {
    const text = buffer.subarray(heading.offset, heading.offset + heading.size).toString('utf8');
    return { ...heading, key: `${CP}#${heading.id}`, text, rows: rowsIn(text) };
  };
  return { section: read(outline[at]), headings: outline.slice(at + 1, end).map(read).filter((heading) => heading.rows.length) };
}

/** Every generated row of the section, under its own heading or a generated one, in the doc's order. */
export function sectionRows(buffer) {
  const { section, headings } = generatedOf(buffer);
  return section ? [...section.rows, ...headings.flatMap((heading) => heading.rows)] : [];
}

const byName = (a, b) => (a.list < b.list ? -1 : a.list > b.list ? 1 : 0);
const shown = (line) => (line.length > 160 ? `${line.slice(0, 160)}…` : line);

/**
 * AC3's comparison: the rows under the generated headings of `doc`, read in name order, against `baseRows` (the merge
 * base's generated rows), byte for byte. One problem per list, each starting with the list's name.
 */
export function rowProblems(doc, baseRows) {
  const held = generatedOf(doc).headings.flatMap((heading) => heading.rows).sort(byName);
  const want = new Map([...baseRows].sort(byName).map((row) => [row.list, row.line]));
  const problems = [];
  const seen = new Map();
  for (const row of held) seen.set(row.list, [...(seen.get(row.list) ?? []), row.line]);
  for (const [list, line] of want) {
    const lines = seen.get(list);
    if (!lines) problems.push(`${list}: the merge base holds its row, and no generated heading does`);
    else if (lines.length > 1) problems.push(`${list}: ${lines.length} rows under the generated headings, where the merge base holds one`);
    else if (lines[0] !== line) {
      let i = 0;
      while (lines[0][i] === line[i]) i++;
      problems.push(`${list}: its row isn't the merge base's byte for byte; from character ${i} it holds ${JSON.stringify(shown(lines[0].slice(i)))}, where the merge base holds ${JSON.stringify(shown(line.slice(i)))}`);
    }
  }
  for (const list of seen.keys()) if (!want.has(list)) problems.push(`${list}: a row under a generated heading that the merge base doesn't hold`);
  return problems;
}

/** `doc` without the line holding `row`: a `table` that drops the row. */
export function withoutRow(doc, row) {
  const lines = doc.toString('utf8').split('\n');
  const at = lines.indexOf(row.line);
  assert.ok(at >= 0, `the row of ${row.list} isn't a line of the doc, so it can't be deleted`);
  lines.splice(at, 1);
  return Buffer.from(lines.join('\n'));
}

/** `doc` with the last cell of `row` reworded: a `table` that rewords the row. */
export function withRowReworded(doc, row) {
  const lines = doc.toString('utf8').split('\n');
  const at = lines.indexOf(row.line);
  assert.ok(at >= 0, `the row of ${row.list} isn't a line of the doc, so it can't be reworded`);
  lines[at] = row.line.replace(/ \|$/, ' (reworded) |');
  return Buffer.from(lines.join('\n'));
}

/** `doc` without the lines of the headings `drop`: their text falls under the heading before them. */
export function withoutHeadingLines(doc, drop) {
  const gone = new Set(drop.map((heading) => heading.line));
  return Buffer.from(doc.toString('utf8').split('\n').filter((_, i) => !gone.has(i)).join('\n'));
}

// ---------------------------------------------------------------------------------------------------------------
// Runs, git and scratch copies.

const GIT_LOCATION = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];
/** No git variable pointing elsewhere, and none of the test runner's own settings. */
function childEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_LOCATION.includes(name)));
  for (const name of ['NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'CARGO_TARGET_DIR']) delete env[name];
  return { ...env, GIT_OPTIONAL_LOCKS: '0', ...extra };
}
const clip = (text, max = 6000) => (text.length > max ? `${text.slice(0, max - 1500)}\n… ${text.length - max} characters cut …\n${text.slice(-1500)}` : text);

/** Runs node on `args` with its working folder at `cwd`. */
export function node(cwd, args, { env = {}, timeout = TIMEOUT_MS } = {}) {
  const child = spawnSync(process.execPath, args, { cwd, env: childEnv(env), encoding: 'utf8', timeout, maxBuffer: 1 << 28 });
  const text = child.stdout ?? '';
  const stderr = child.stderr ?? '';
  const name = `node ${args.join(' ')}`;
  return { name, status: child.status, signal: child.signal, text, stderr, lines: text.split('\n').filter((line) => line.trim()), output: `${name} exited ${child.status}${child.signal ? `, stopped by ${child.signal}` : ''}\nstdout:\n${clip(text) || '(empty)'}\nstderr:\n${clip(stderr) || '(empty)'}` };
}

/** git in `cwd`, read as bytes; a failure is BLOCKED, never a verdict. */
function git(cwd, args, { input } = {}) {
  const child = spawnSync('git', args, { cwd, env: childEnv(), input, maxBuffer: 1 << 28 });
  if (child.status !== 0) throw new Error(`BLOCKED: git ${args.join(' ')} failed in ${cwd}: ${child.error?.message ?? child.stderr?.toString()}`);
  return child.stdout;
}

/** The merge base of the checkout with origin/main. */
export const mergeBase = () => git(CHECKOUT, ['merge-base', 'HEAD', 'origin/main']).toString().trim();
/** A file of the checkout's repository at a commit. */
export const show = (rev, path) => git(CHECKOUT, ['show', `${rev}:${path}`]);
/** A file of the checkout. */
export const read = (path) => readFileSync(join(CHECKOUT, path));

/**
 * The commit before the change: the merge base while its canvas reference still holds the generated rows in the one
 * table under the section's own heading (README: The merge base); once the change is in the merge base's own history,
 * the newest commit of that history whose reference still holds them so.
 */
export function beforeCommit() {
  const base = mergeBase();
  const oneTable = (rev) => generatedOf(show(rev, CP)).headings.length === 0;
  if (oneTable(base)) return base;
  for (const rev of git(CHECKOUT, ['rev-list', base, '--', CP]).toString().split('\n').filter(Boolean)) if (oneTable(rev)) return rev;
  throw new Error(`BLOCKED: no commit in the history of the merge base ${base} holds ${CP} with its generated rows in one table`);
}

/** The paths under `folder` that differ from `rev` in the checkout's work tree, untracked files among them. */
export function changedSince(rev, folder) {
  const names = (args) => git(CHECKOUT, args).toString().split('\n').filter(Boolean);
  return [...names(['diff', '--name-only', rev, '--', folder]), ...names(['ls-files', '--others', '--exclude-standard', '--', folder])];
}

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main'];
/** Makes `repo` a repository of its own whose first commit holds its docs/ and its ceilings, and is its origin/main. */
function commitBase(repo) {
  git(repo, [...GIT, 'init', '-q']);
  git(repo, [...GIT, 'add', '-f', '--', 'docs', CEILINGS]);
  git(repo, [...GIT, 'commit', '-q', '-m', 'base: the docs and their ceilings']);
  git(repo, [...GIT, 'update-ref', 'refs/remotes/origin/main', 'HEAD']);
}

function sandbox(t) {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3401-')));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (const name of ['home', 'tmp']) mkdirSync(join(folder, name));
  return { sandbox: folder, repo: join(folder, 'repo'), env: { HOME: join(folder, 'home'), TMPDIR: join(folder, 'tmp') } };
}

/**
 * A scratch copy under the OS temp folder, removed after the test (README: The scratch copies): the checkout's own root
 * files, its scripts/, the two design docs, the fill and the closure data, in a git repository of its own whose
 * origin/main is its first commit (the docs and the ceilings as copied). `files` replaces files before that commit.
 */
export function scratch(t, files = {}) {
  const copy = sandbox(t);
  mkdirSync(copy.repo);
  for (const entry of readdirSync(CHECKOUT, { withFileTypes: true })) if (entry.isFile() && entry.name !== '.git' && !entry.name.startsWith('.env')) copyFileSync(join(CHECKOUT, entry.name), join(copy.repo, entry.name));
  cpSync(join(CHECKOUT, 'scripts'), join(copy.repo, 'scripts'), { recursive: true, filter: (from) => !/\/(?:node_modules|target|\.git)(?:\/|$)/.test(from.slice(CHECKOUT.length)) });
  for (const path of [TD, CP, FILL, CLOSURE_DATA]) {
    mkdirSync(dirname(join(copy.repo, path)), { recursive: true });
    copyFileSync(join(CHECKOUT, path), join(copy.repo, path));
  }
  for (const [path, bytes] of Object.entries(files)) writeFileSync(join(copy.repo, path), bytes);
  commitBase(copy.repo);
  return copy;
}

/**
 * A scratch repository holding `paths` as commit `rev` of the checkout's repository has them, and nothing else, with
 * origin/main at its own first commit.
 */
export function scratchOf(t, rev, paths) {
  const copy = sandbox(t);
  mkdirSync(copy.repo);
  const tar = git(CHECKOUT, ['archive', '--format=tar', rev, '--', ...paths]);
  const unpack = spawnSync('tar', ['-xf', '-', '-C', copy.repo], { input: tar, maxBuffer: 1 << 28 });
  if (unpack.status !== 0) throw new Error(`BLOCKED: tar could not unpack ${rev} into the scratch copy: ${unpack.error?.message ?? unpack.stderr?.toString()}`);
  commitBase(copy.repo);
  return copy;
}

/** Runs a script of the copy there, its working folder at the copy's root. */
export const runIn = (copy, script, args = []) => node(copy.repo, [script, ...args], { env: copy.env });
/** Runs a script of the checkout with its working folder at the checkout; the scripts run this way write nothing. */
export const runInCheckout = (script, args = []) => node(CHECKOUT, [script, ...args]);
export const readIn = (copy, path) => readFileSync(join(copy.repo, path));
export const writeIn = (copy, path, bytes) => writeFileSync(join(copy.repo, path), bytes);

// ---------------------------------------------------------------------------------------------------------------
// The ceilings' verdicts.

/** A whole number as a line may print it, with or without thousands commas. */
const number = (n) => new RegExp(`(?<![\\d,])${String(n).replace(/\B(?=(\d{3})+$)/g, ',?')}(?!,?\\d)`);

/** A pass: exit 0 and exactly one line on stdout, starting `PASS doc-ceilings:`. */
export function passProblems(run) {
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0`);
  if (run.lines.length !== 1) problems.push(`${run.name} printed ${run.lines.length} lines on stdout, not one`);
  if (!run.lines.some((line) => line.startsWith('PASS doc-ceilings:'))) problems.push('no line starting `PASS doc-ceilings:`');
  return problems;
}

/** A fail: a non-zero exit and a line starting FAIL naming the heading's `<doc>#<slug>` and each number in `numbers`. */
export function failProblems(run, key, numbers) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped by ${run.signal}`);
  else if (run.status === 0) problems.push(`${run.name} exited 0`);
  const named = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
  if (!run.lines.some((line) => line.startsWith('FAIL') && named.test(line) && numbers.every((n) => number(n).test(line)))) problems.push(`no line starting FAIL names ${key}${numbers.length ? ` and ${numbers.join(' and ')}` : ''}`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// The listing `table` reads, and the planted field list.

/** The copy's fill, one closure a list. */
const fillOf = (copy) => JSON.parse(readIn(copy, FILL).toString('utf8'));
const writeFill = (copy, rows) => writeIn(copy, FILL, `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`);

/**
 * Writes the sealed listing `table` reads through `--listing` (README: The listing) beside the copy and returns its
 * path: `field_lists`, one `{list, words, closure}` for each list of the copy's fill, its closure the fill's and its
 * words those of its generated row in the copy's reference; `extra` adds lists the reference has no row for yet.
 */
export function writeListing(copy, extra = []) {
  const words = new Map(sectionRows(readIn(copy, CP)).map((row) => [row.list, [...row.line.split(/(?<!\\)\|/)[2].matchAll(/`([^`]+)`/g)].map((m) => m[1])]));
  for (const { list, words: given } of extra) words.set(list, given);
  const lists = fillOf(copy).map(({ list, ...closure }) => ({ list, words: words.get(list) ?? [], closure }));
  const missing = lists.filter((l) => !l.words.length).map((l) => l.list);
  assert.deepEqual(missing, [], `the fill holds lists the canvas reference has no generated row for, so the listing has no words for them`);
  const path = join(copy.sandbox, 'listing.json');
  writeFileSync(path, JSON.stringify({ registries: [], field_lists: lists }));
  return path;
}

/** The planted field list (README: The planted field list): its row, as `table` writes a closed list's, is 300 bytes. */
const PLANT_NAME = 'sky.planted3401@1.mode';
const plantRow = (reopens) => `| \`${PLANT_NAME}\` | \`alpha\`, \`beta\` | closed: determinism | ${reopens} | nothing |`;
const PLANT_REOPENS = `a planted list of the acceptance tests of 3401 needs ${'more '.repeat(60)}`.slice(0, 300 - Buffer.byteLength(plantRow(''))).replace(/ $/, 's');
export const PLANT = { list: PLANT_NAME, words: ['alpha', 'beta'], closure: { closed: 'determinism', reopens_if: PLANT_REOPENS, instead: 'nothing' }, row: plantRow(PLANT_REOPENS) };

/** Adds the planted list to the copy's fill. */
export function plantInFill(copy) {
  writeFill(copy, [...fillOf(copy), { list: PLANT.list, ...PLANT.closure }]);
}

/** The headings of `after` whose own text no heading of `before` has, and those of `before` that `after` lacks. */
export function headingChanges(before, after) {
  const left = new Map();
  for (const heading of before) left.set(heading.text, (left.get(heading.text) ?? 0) + 1);
  const differ = [];
  for (const heading of after) {
    if (left.get(heading.text)) left.set(heading.text, left.get(heading.text) - 1);
    else differ.push(heading);
  }
  const gone = before.filter((heading) => {
    if (!left.get(heading.text)) return false;
    left.set(heading.text, left.get(heading.text) - 1);
    return true;
  });
  return { differ, gone };
}

// ---------------------------------------------------------------------------------------------------------------
// Drift.

/** Drift passes: exit 0, a line starting `PASS drift:`, no FAIL line. */
export function driftPassProblems(run) {
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0`);
  if (!run.lines.some((line) => line.startsWith('PASS drift:'))) problems.push('no line starting `PASS drift:`');
  if (run.lines.some((line) => line.startsWith('FAIL'))) problems.push('a line starting FAIL');
  return problems;
}

/** Drift fails, naming `list`: a non-zero exit and a line starting `FAIL drift:` that names the list. */
export function driftFailProblems(run, list) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped by ${run.signal}`);
  else if (run.status === 0) problems.push(`${run.name} exited 0`);
  if (!run.lines.some((line) => line.startsWith('FAIL drift:') && line.includes(list))) problems.push(`no line starting \`FAIL drift:\` names ${list}`);
  return problems;
}

/**
 * The planted `drift` that reads only the first generated table (README: The planted programs), written into the
 * sandbox beside the copy at run time and run as the real one is: it holds each row of the first generated heading to
 * the copy's fill and reads no other heading, so a row missing elsewhere is nothing to it.
 */
export function runFirstTableDrift(copy) {
  const program = join(copy.sandbox, 'planted-drift-first-table.mjs');
  writeFileSync(program, `import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatedOf } from ${JSON.stringify(import.meta.url)};
const root = process.cwd();
const fill = new Map(JSON.parse(readFileSync(join(root, ${JSON.stringify(FILL)}), 'utf8')).map(({ list, ...closure }) => [list, closure]));
const first = generatedOf(readFileSync(join(root, ${JSON.stringify(CP)}))).headings[0];
const failed = [];
for (const { list, line } of first?.rows ?? []) {
  const cells = line.split(/(?<!\\\\)\\|/).slice(1, -1).map((cell) => cell.trim().replace(/\\\\\\|/g, '|'));
  const c = fill.get(list);
  if (!c) { failed.push(\`\${list}: the generated table has a row for it, and the fill holds no such field list\`); continue; }
  const closed = 'closed' in c;
  const want = ['registry' in c ? \`registry \${c.registry}\` : closed ? \`closed: \${c.closed}\` : \`open: \${c.open}\`, closed ? c.reopens_if : '—', closed ? c.instead : '—'];
  if (JSON.stringify(cells.slice(2)) !== JSON.stringify(want)) failed.push(\`\${list}: the generated table says \${cells.slice(2).join(' / ')}, the fill says \${want.join(' / ')}\`);
}
if (!first) failed.push('the canvas reference has no generated table');
for (const f of failed) console.log(\`FAIL drift: \${f}\`);
if (!failed.length) console.log(\`PASS drift: the first generated table's \${first.rows.length} field lists say what the fill holds\`);
process.exitCode = failed.length ? 1 : 0;
`);
  return { ...node(copy.repo, [program, 'drift'], { env: copy.env }), name: 'the planted drift that reads only the first generated table' };
}
