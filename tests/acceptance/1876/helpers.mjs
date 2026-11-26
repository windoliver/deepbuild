// Helpers for #1876's acceptance tests: each place of docs/technical-design.md the criteria name, found by what it is
// and never by a line number; each file on main a criterion compares it with, read as text or JSON; a scratch copy of
// what the design links lane reads; one run of that lane through its own entry in scripts/lanes.mjs; and how an output
// line names a command, a method, a slot, a flag, a bullet, an object, a line or a column. The markdown reading (lines
// outside fenced code, headings, rendered text) is copied from scripts/doc-links.mjs and tests/acceptance/2339/, never
// imported; the lane is reached only through its entry in scripts/lanes.mjs (README: The surface). Node built-ins only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
/** The design, and the files on main the criteria compare it with. */
export const DESIGN = 'docs/technical-design.md';
export const MAIN = 'packages/cli/src/main.ts';
export const API = 'packages/contracts/extension-api.json';
export const SLOTS = 'packages/contracts/hub-slots.json';
export const FACTS = 'adapters/codex.facts.json';
export const SCHEMAS = 'packages/contracts/schemas';
export const RECORD = 'packages/record/src/index.ts';
const PLANNED = 'scripts/planned-names.txt';

export const read = (root, file) => {
  assert.ok(existsSync(join(root, file)), `${file} does not exist, so nothing can be read from it`);
  return readFileSync(join(root, file), 'utf8');
};
// Each file a test wrote in the scratch copy, to its text before (null: the test made the file), so the copy can be put
// back as it was once the test ends.
const written = new Map();
/** Writes `text` over `file` in the scratch copy, keeping what the file held before the test's first write to it. */
export function write(root, file, text) {
  const path = join(root, file);
  if (!written.has(path)) written.set(path, existsSync(path) ? readFileSync(path, 'utf8') : null);
  writeFileSync(path, text);
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A text's lines, without a carriage return at the end of any. */
const linesOf = (text) => text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

// ---- Markdown, as scripts/doc-links.mjs reads it (copied) ----

// Every line with its 0-based index and its kind: prose (outside fenced code), fence (a fence's own line) or code (inside
// one, with the number of its block).
function scan(text) {
  const out = [];
  let fence;
  let block = -1;
  for (const [index, line] of linesOf(text).entries()) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) {
        fence = undefined;
        out.push({ index, line, kind: 'fence' });
      } else out.push({ index, line, kind: 'code', block });
    } else if (mark) {
      fence = mark[1];
      block += 1;
      out.push({ index, line, kind: 'fence' });
    } else out.push({ index, line, kind: 'prose' });
  }
  return out;
}

/** Lines outside fenced code: { index (0-based), line }. */
const prose = (text) => scan(text).filter(({ kind }) => kind === 'prose');

const headingText = (raw) => raw.replace(/\s+#+\s*$/, '').trim()
  .replace(/(`+)(.+?)\1|!?\[([^\]]*)\]\([^)]*\)|<[^>]*>|&#?\w+;|\*+|__+/g, (_, tick, code, label) => code ?? label ?? '');

/** Headings outside fenced code: { index, level, text }. */
function headings(text) {
  return prose(text).flatMap(({ index, line }) => {
    const found = line.match(/^ {0,3}(#{1,6})\s+(.*)$/);
    return found ? [{ index, level: found[1].length, text: headingText(found[2]) }] : [];
  });
}

/** The one heading whose text `is` accepts, with the line range of its section: to the next heading of its level or higher. */
function section(text, is, what) {
  const all = headings(text);
  const found = all.filter((heading) => is(heading.text));
  assert.equal(found.length, 1, `${DESIGN} has ${found.length} headings ${what}, not one, so the place under it can't be found`);
  const [heading] = found;
  const to = all.find((other) => other.index > heading.index && other.level <= heading.level)?.index ?? linesOf(text).length;
  return { heading, from: heading.index, to };
}

// The fenced blocks whose lines sit between two line indexes, each a list of { number (1-based), line }.
function blocks(text, from = -1, to = Infinity) {
  const found = new Map();
  for (const { index, line, kind, block } of scan(text)) {
    if (kind !== 'code' || index <= from || index >= to) continue;
    if (!found.has(block)) found.set(block, []);
    found.get(block).push({ number: index + 1, line });
  }
  return [...found.values()];
}

/** A line's code spans, by their content. */
const codeSpans = (line) => [...line.matchAll(/(`+)(.+?)\1/g)].map((found) => found[2]);
/** A table row's cells, split at each pipe a backslash doesn't escape. */
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());
/** `name` as a whole word: no letter, digit, underscore or hyphen on either side. */
export const word = (name, flags = '') => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`, flags);
/** A dotted name as a whole name: not the start or the end of a longer one. */
export const dotted = (name) => new RegExp(`(?<![\\w.])${escape(name)}(?!\\w|\\.\\w)`);

/**
 * A line's text as it reads rendered: links and images by their label, code spans by their content, tags and bold
 * markers dropped, white space collapsed (as tests/acceptance/2339 reads it).
 */
const render = (s) => s
  .replace(/(`+)(.+?)\1/g, (_, tick, code) => code.trim())
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/\*\*|__/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// ---- The places of the design, each found by what it is ----

const MARKER = /^ {0,3}(?:[-*+]|\d{1,3}[.)])\s+/;
const one = (found, what) => {
  assert.equal(found.length, 1, `${DESIGN} has ${found.length} ${what}, not one, so the place can't be found`);
  return { number: found[0].index + 1, line: found[0].line, content: found[0].line.replace(MARKER, '') };
};

/** The one line outside fenced code that starts with `start`: { number (1-based), line, content (after a list marker) }. */
export const item = (text, start) => one(prose(text).filter(({ line }) => line.startsWith(start)), `lines that start "${start}"`);

/** The CLI row: the one table row that starts `| CLI |`. */
export const cliRow = (text) => one(prose(text).filter(({ line }) => /^\|\s*CLI\s*\|/.test(line)), 'table rows that start "| CLI |"');
/** Whether a row names a command: one of its code spans holds the word. */
export const rowNames = (line, command) => codeSpans(line).some((span) => word(command).test(span));

/** The Extension API block: the first fenced block under the heading that starts "Extension API". */
export function apiBlock(text) {
  const { heading, from, to } = section(text, (title) => title.startsWith('Extension API'), 'that start "Extension API"');
  const [block] = blocks(text, from, to);
  assert.ok(block, `${DESIGN}:${heading.index + 1} "${heading.text}" has no fenced block under it`);
  return { from: block[0].number, to: block.at(-1).number, text: block.map(({ line }) => line).join('\n') };
}

/** The Hub slots table: the rows of the table under the paragraph that starts `**Hub slots.**`, each with its first cell. */
export function slotsTable(text) {
  const all = prose(text);
  const lead = one(all.filter(({ line }) => line.startsWith('**Hub slots.**')), 'paragraphs that start "**Hub slots.**"');
  const after = all.filter(({ index }) => index >= lead.number);
  const start = after.findIndex(({ line }) => line.trim());
  const table = [];
  for (const entry of start === -1 ? [] : after.slice(start)) {
    if (!entry.line.trimStart().startsWith('|') || (table.length && entry.index !== table.at(-1).index + 1)) break;
    table.push(entry);
  }
  assert.ok(table.length > 2 && /^\|\s*:?-+/.test(table[1].line), `${DESIGN}:${lead.number} "**Hub slots.**" has no table under it`);
  return { number: table[0].index + 1, rows: table.slice(2).map(({ index, line }) => ({ number: index + 1, line, first: cells(line)[0] })) };
}
/** The table's row for a method and its variant: its first cell holds the method's name and, for a variant, the variant as a word in any case. */
export const slotRow = (rows, method, variant) => rows.find(({ first }) => dotted(method).test(first) && (variant == null || word(variant, 'i').test(first)));

/** The `-s <value>` flags a line holds in code, each value once. */
export const flagsIn = (line) => [...new Set(codeSpans(line).flatMap((span) => span.trim().match(/^-s\s+(\S+)$/)?.[1] ?? []))];

const ANCHOR = /^\s*<a\s[^>]*>(?:\s*<\/a>)?\s*$/i;
/** How an object is compared: lowercase, with each run of spaces, underscores and hyphens read as one space. */
export const objectKey = (name) => name.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
/** The Lifecycles list: the first list in parentheses of the first paragraph under the heading "Lifecycles". */
export function lifecycles(text) {
  const { heading, from, to } = section(text, (title) => title === 'Lifecycles', 'that read "Lifecycles"');
  const first = prose(text).find(({ index, line }) => index > from && index < to && line.trim() && !ANCHOR.test(line));
  assert.ok(first, `${DESIGN}:${heading.index + 1} "Lifecycles" has no paragraph under it`);
  const list = first.line.match(/\(([^()]*,[^()]*)\)/);
  assert.ok(list, `the first paragraph under "Lifecycles" (${DESIGN}:${first.index + 1}) holds no list in parentheses`);
  return { number: first.index + 1, line: first.line, names: list[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((name) => name.trim()).filter(Boolean) };
}

/** The events table: the columns of the one fenced `CREATE TABLE events (` in the design, each with its line. */
export function eventsTable(text) {
  const found = blocks(text).filter((block) => block.some(({ line }) => /^\s*CREATE TABLE events \(/.test(line)));
  assert.equal(found.length, 1, `${DESIGN} has ${found.length} fenced blocks with a line "CREATE TABLE events (", not one`);
  const [block] = found;
  const from = block.findIndex(({ line }) => /^\s*CREATE TABLE events \(/.test(line));
  const end = block.findIndex(({ line }, i) => i > from && /^\s*\)/.test(line));
  assert.ok(end > from, `the events table at ${DESIGN}:${block[from].number} has no closing line`);
  const columns = block.slice(from + 1, end).flatMap(({ number, line }) => {
    const name = line.match(/^\s*([A-Za-z_]\w*)\s/)?.[1];
    return name ? [{ number, name }] : [];
  });
  return { number: block[from].number, columns };
}

/** The hook protocol's ack and reply: the JSON lines with an "ack" key and with an "exit" key in the first fenced block under the heading that starts "Hook protocol". */
export function hookLines(text) {
  const { heading, from, to } = section(text, (title) => title.startsWith('Hook protocol'), 'that start "Hook protocol"');
  const [block] = blocks(text, from, to);
  assert.ok(block, `${DESIGN}:${heading.index + 1} "${heading.text}" has no fenced block under it`);
  const keyed = (key, name) => {
    const found = block.filter(({ line }) => new RegExp(`^\\s*\\{.*"${key}"\\s*:`).test(line));
    assert.equal(found.length, 1, `the fenced block at ${DESIGN}:${block[0].number} has ${found.length} JSON lines with an "${key}" key, not one, so the ${name} can't be found`);
    return found[0];
  };
  return { ack: keyed('ack', 'ack'), reply: keyed('exit', 'reply') };
}
/** Whether a JSON line carries a "v" key. */
export const carriesV = (line) => /"v"\s*:/.test(line);

/**
 * The words the issue's four lines used on November 9 to say a complete game takes the engine project route as its only
 * route: "A complete game goes through an engine project instead", "Complete games take the engine project route" (three
 * lines). A line that offers the canvas first ("takes the canvas route …, or the engine project route … as one optional
 * route") doesn't match.
 */
export const ONLY_ROUTE = /\bcomplete games? (?:takes? the engine project route|go(?:es)? through an engine project instead)/i;
/** Every line of a text that says it, with its number. */
export const onlyRouteLines = (text) => linesOf(text).flatMap((line, i) => (ONLY_ROUTE.test(line) ? [{ number: i + 1, line }] : []));

/** The Decided row for bounded games: the one row under the heading "Decided" that starts `| Bounded games on the canvas |`. */
export function decidedRow(text) {
  const { from, to } = section(text, (title) => title === 'Decided', 'that read "Decided"');
  return one(prose(text).filter(({ index, line }) => index > from && index < to && /^\|\s*Bounded games on the canvas\s*\|/.test(line)), 'rows under "Decided" that start "| Bounded games on the canvas |"');
}

// ---- The files on main, read as they are when the test runs ----

/** The commands `deep --help` lists: the words each line of `const usage = [ … ]` leads with, as commandsOf reads them. */
export function helpCommands(root) {
  const lines = linesOf(read(root, MAIN));
  const from = lines.findIndex((line) => /^const usage = \[\s*$/.test(line));
  assert.ok(from >= 0, `${MAIN} has no line \`const usage = [\`, so the commands \`deep --help\` lists can't be read`);
  const to = lines.findIndex((line, i) => i > from && /^\];/.test(line));
  assert.ok(to > from, `${MAIN}:${from + 1} \`const usage = [\` has no closing \`];\``);
  const commands = [];
  for (let i = from + 1; i < to; i++) {
    if (!lines[i].trim() || lines[i].trim().startsWith('//')) continue;
    const led = lines[i].match(/^\s*['"`]deep ([a-z-]+(?: \| [a-z-]+)*)/);
    assert.ok(led, `${MAIN}:${i + 1} is in \`const usage\` and isn't a usage line that starts \`deep <command>\``);
    commands.push(...led[1].split(' | '));
  }
  assert.ok(commands.length, `${MAIN}'s \`const usage\` lists no command`);
  return { from, commands: [...new Set(commands)] };
}

/** A JSON file's array. */
export function rows(root, file) {
  const found = JSON.parse(read(root, file));
  assert.ok(Array.isArray(found) && found.length, `${file} isn't a list with entries`);
  return found;
}

/** The `-s` value of launch.readOnlyJob.args in adapters/codex.facts.json: the string after `-s`. */
export function codexFlag(root) {
  const args = JSON.parse(read(root, FACTS))?.launch?.readOnlyJob?.args;
  assert.ok(Array.isArray(args), `${FACTS} has no launch.readOnlyJob.args`);
  const at = args.indexOf('-s');
  assert.ok(at >= 0 && typeof args[at + 1] === 'string', `${FACTS}'s launch.readOnlyJob.args holds no -s with a value`);
  return args[at + 1];
}

/** The objects with a `*.machine@*.json` table in packages/contracts/schemas. */
export function machineObjects(root) {
  assert.ok(existsSync(join(root, SCHEMAS)), `${SCHEMAS}/ does not exist`);
  const tables = readdirSync(join(root, SCHEMAS)).filter((file) => /^.+\.machine@.+\.json$/.test(file));
  assert.ok(tables.length, `${SCHEMAS}/ holds no *.machine@*.json`);
  return { tables, objects: [...new Set(tables.map((file) => file.replace(/\.machine@.*$/, '')))].sort() };
}

/** The columns the record creates in its events table: the lines of its `CREATE TABLE … events (`, and each `ALTER TABLE events ADD COLUMN`. */
export function recordColumns(root) {
  const text = read(root, RECORD);
  const lines = linesOf(text);
  const from = lines.findIndex((line) => /^\s*CREATE TABLE (?:IF NOT EXISTS )?events \(\s*$/.test(line));
  assert.ok(from >= 0, `${RECORD} has no line \`CREATE TABLE IF NOT EXISTS events (\`, so the columns it creates can't be read`);
  const to = lines.findIndex((line, i) => i > from && /^\s*\)/.test(line));
  assert.ok(to > from, `${RECORD}:${from + 1} \`CREATE TABLE … events (\` has no closing line`);
  const created = lines.slice(from + 1, to).flatMap((line) => line.match(/^\s*([A-Za-z_]\w*)\s/)?.[1] ?? []);
  const added = [...text.matchAll(/ALTER TABLE events ADD COLUMN ([A-Za-z_]\w*)/g)].map((found) => found[1]);
  assert.ok(created.length, `${RECORD}:${from + 1} \`CREATE TABLE … events (\` lists no column`);
  return { from, columns: [...new Set([...created, ...added])] };
}

// ---- The scratch copy and the lane ----

const SKIPPED = new Set(['node_modules', 'dist', 'target', '.git']);
const FOLDERS = ['scripts', 'packages/cli/src', 'packages/contracts', 'packages/record/src', 'packages/proof/src'];
const BY_NAME = [['docs', /\.md$/], ['adapters', /\.json$/]];
const SINGLE = ['crates/deep-replica/src/kit.rs', 'crates/deep-gpu/src/meter.rs'];
const NAMED = [DESIGN, MAIN, API, SLOTS, FACTS, RECORD, SCHEMAS, 'scripts/design-links.mjs', 'scripts/lanes.mjs'];

const copyFile = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to, constants.COPYFILE_FICLONE);
};

/**
 * A scratch copy under the OS temp folder, removed when the test file's process ends, holding what the lane can read
 * (README: The scratch copy): the checkout's top-level files; scripts/, packages/cli/src/, packages/contracts/,
 * packages/record/src/ and packages/proof/src/ whole, without any node_modules, dist, target or .git; docs/*.md;
 * adapters/*.json; and the two crate files the issue's Scope names, when the checkout has them. The lane gets no open
 * issues (an empty list handed over in DEEP_OPEN_ISSUES, as scripts/open-issues.mjs reads it) and so an empty
 * scripts/planned-names.txt, whose entries name real open issues the empty list doesn't hold. A file a criterion names
 * that the copy lacks fails here, naming it.
 */
function scratch() {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1876-')));
  process.once('exit', () => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  mkdirSync(repo);
  for (const entry of readdirSync(CHECKOUT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== '.git' && !entry.name.startsWith('.env')) copyFile(join(CHECKOUT, entry.name), join(repo, entry.name));
  }
  for (const folder of FOLDERS) {
    assert.ok(existsSync(join(CHECKOUT, folder)), `${folder}/ is not in the checkout, so the scratch copy would lack it`);
    cpSync(join(CHECKOUT, folder), join(repo, folder), { recursive: true, mode: constants.COPYFILE_FICLONE, filter: (from) => !relative(CHECKOUT, from).split(sep).some((part) => SKIPPED.has(part)) });
  }
  for (const [folder, name] of BY_NAME) {
    assert.ok(existsSync(join(CHECKOUT, folder)), `${folder}/ is not in the checkout, so the scratch copy would lack it`);
    for (const entry of readdirSync(join(CHECKOUT, folder), { withFileTypes: true })) if (entry.isFile() && name.test(entry.name)) copyFile(join(CHECKOUT, folder, entry.name), join(repo, folder, entry.name));
  }
  for (const file of SINGLE) if (existsSync(join(CHECKOUT, file)) && statSync(join(CHECKOUT, file)).isFile()) copyFile(join(CHECKOUT, file), join(repo, file));
  for (const file of NAMED) assert.ok(existsSync(join(repo, file)), `the scratch copy lacks ${file}, which the lane or a criterion reads: it is not in the checkout`);
  writeFileSync(join(repo, PLANNED), '');
  const issues = join(sandbox, 'open-issues.json');
  writeFileSync(issues, '[]');
  return { sandbox, repo, issues };
}

const entries = new Map();
/** The design links lane's entry: the one in `checks` whose name says link(s) and isn't the catalogue drift lane. */
function laneEntry(root) {
  if (!entries.has(root)) {
    const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(root, 'scripts', 'lanes.mjs')).href)});
const found = checks.filter((l) => /\\blinks?\\b/i.test(l.name) && !/catalogue|drift/i.test(l.name));
console.log(JSON.stringify(found.map((l) => ({ name: l.name, commands: l.commands }))));`;
    // deadline: bounds one read of the lane list, so a hang is a failure.
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: root, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, `scripts/lanes.mjs could not be read, so the lane didn't run: ${r.error?.message ?? r.stderr}`);
    const found = JSON.parse(r.stdout.trim().split('\n').at(-1));
    assert.equal(found.length, 1, `scripts/lanes.mjs checks has ${found.length} lanes named for links (not catalogue drift), not one, so the lane didn't run`);
    entries.set(root, found[0]);
  }
  return entries.get(root);
}

/**
 * Runs the design links lane's own commands in order with cwd at `root`, stopping at the first that fails, with the
 * open issues read from `issues` (DEEP_OPEN_ISSUES). Returns the exit status (0 when every command passed), the output
 * and its lines.
 */
export function runLane(root, issues) {
  const entry = laneEntry(root);
  const env = { ...process.env, DEEP_OPEN_ISSUES: issues };
  delete env.DEEP_PREFLIGHT;
  let output = '';
  let status = 0;
  for (const [command, ...args] of entry.commands) {
    // deadline: bounds one run of the lane, so a hang is a failure.
    const r = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28 });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${command} ${args.join(' ')} did not run: ${r.error.message}` : ''}`;
    status = r.status ?? 1;
    if (status !== 0) break;
  }
  return { name: entry.name, status, output, lines: output.split('\n') };
}

const clip = (text, max = 6000) => (text.length > max ? `${text.slice(0, max - 1500)}\n… ${text.length - max} characters cut …\n${text.slice(-1500)}` : text);
/** The run as text for an assertion message. */
export const shown = (run) => `exit ${run.status}, output:\n${clip(run.output.trim()) || '(none)'}`;

let kept;
/**
 * This test file's scratch copy after the control: the lane run on the unplanted copy must exit 0, so a failure after
 * a plant is the plant's (README: The control). A file's tests share one copy; whatever a test writes in it is put
 * back when the test ends, and the next test runs its own control on it.
 */
export function clean(t) {
  kept ??= scratch();
  t.after(() => {
    for (const [path, text] of written) {
      if (text === null) rmSync(path, { force: true });
      else writeFileSync(path, text);
    }
    written.clear();
  });
  const control = runLane(kept.repo, kept.issues);
  if (control.status !== 0) assert.fail(`the unplanted scratch copy already fails the ${control.name} lane, so a planted failure would prove nothing: ${shown(control)}`);
  return kept;
}

// ---- The judges ----

/**
 * What is wrong with a run on a planted copy, as a list: the lane fails a plant when its commands exit non-zero and its
 * output holds a line that starts `FAIL`, as the lane prints its findings. An exit 0, a crash or an INCONCLUSIVE run
 * is not a failure of the plant.
 */
export function unfailed(run, planted) {
  if (run.status === 0) return [`the lane passed ${planted}: ${shown(run)}`];
  if (!run.lines.some((line) => /^FAIL\b/.test(line))) return [`the lane exited ${run.status} on ${planted} with no line that starts FAIL, so it judged nothing: ${shown(run)}`];
  return [];
}

/**
 * The output lines a finding can be on: every line but a `Fix:` line, which the lane prints the same whatever it
 * found, so a word in it names nothing.
 */
const findings = (run) => run.lines.filter((line) => line.trim() && !/^\s*Fix:/.test(line));

/** A finding's line that names a word: a command, an object, a column, a flag or one of its values. */
export const namesWord = (run, name) => findings(run).find((line) => word(name).test(line));
/** A finding's line that names a method or a slot by its dotted name. */
export const namesDotted = (run, name) => findings(run).find((line) => dotted(name).test(line));

/**
 * A finding's line that names a line of the design (README: Naming): the doc's file name with the line's number
 * (`technical-design.md:12`, `technical-design.md:3,12`, `technical-design.md line 12`, `technical-design.md#L12`), or
 * the first 30 characters of the line's text after its list marker, raw or rendered, or one of `also`: a text the
 * finding may hold instead, or a pattern.
 */
export function namesLine(run, { number, content }, also = []) {
  const at = new RegExp(`${escape(posix.basename(DESIGN))}(?::|,? lines? |#L)(?:\\d+,\\s?)*${number}(?!\\d)`);
  const texts = [content.trim().slice(0, 30), render(content).slice(0, 30)].filter((text) => text.length >= 12);
  return findings(run).find((line) => at.test(line) || texts.some((text) => line.includes(text)) || also.some((other) => (typeof other === 'string' ? line.includes(other) : other.test(line))));
}

// ---- Planting ----

/** Replaces line `number` (1-based) of `file` in the scratch copy with `to`, so no other line moves. */
export function replaceLine(root, file, number, to) {
  const lines = read(root, file).split('\n');
  lines[number - 1] = to;
  write(root, file, lines.join('\n'));
}

/** Inserts `line` after line `number` (1-based) of `file` in the scratch copy. */
export function insertAfter(root, file, number, line) {
  const lines = read(root, file).split('\n');
  lines.splice(number, 0, line);
  write(root, file, lines.join('\n'));
}
