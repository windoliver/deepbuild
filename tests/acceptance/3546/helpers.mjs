// Helpers for #3546's acceptance tests: scratch copies of the checkout under the OS temp folder (its root files and
// scripts/, with a fixture doc, or with the checkout's own docs and folders linked beside a fixture doc), the cached
// open issues and a failing, recording `gh` stand-in first on PATH; one run of a script, of the merge base's copy of
// it or of a planted wrong program there; a fixture doc whose headings hold exact token counts; an oracle for what an
// issue's first read holds, read with the merge base's own link code; and the judgement each criterion's test applies
// to the script and to its planted program. The README gives the surface they read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, constants, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { outline, prose, resolve, targets } from './merge-base/doc-links.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SUITE = join(CHECKOUT, 'tests/acceptance/3546');
/** The script #3546 changes, the merge base's copy of it in a scratch copy, and the text check #2338 added. */
export const SECTION = 'scripts/design-section.mjs';
export const BASE_SECTION = 'merge-base/design-section.mjs';
export const RULE = 'scripts/reading-rule.mjs';
/** The fixture doc's place where the script runs alone, and beside the checkout's own docs where the lane runs. */
export const TD = 'docs/technical-design.md';
export const LANE_DOC = 'docs/first-read.md';
/** The limit, in tokens: a total past it prints outlines (the issue's 25,000, drafted). */
export const LIMIT = 25_000;
const BLOB = 'https://github.com/windoliver/deepbuild/blob/main/';
// deadline: only bounds a child that hangs; every run here ends within a second or two
const TIMEOUT_MS = 120_000;

// The pinned tokenizer, counted as scripts/tool-load.mjs counts. Without it nothing here can be counted.
let countTokens;
try {
  ({ countTokens } = await import('gpt-tokenizer/encoding/o200k_base'));
} catch (error) {
  throw new Error(`BLOCKED: the pinned tokenizer, gpt-tokenizer's o200k_base (a root dev dependency), can't be loaded from the checkout's node_modules, so no test of #3546 can count: ${error.code ?? 'no such module'}`);
}
/** The tokens of some bytes, by the pinned tokenizer. */
const tokens = (bytes) => countTokens(Buffer.from(bytes).toString('utf8'));
/** A whole number as the messages write it. */
export const n = (value) => (typeof value === 'number' ? value.toLocaleString('en-US') : String(value));
/** Fails with `message` when a judgement found problems; the message holds them, so the report shows no second copy. */
export const none = (problems, message) => assert.ok(problems.length === 0, message);

// ---------------------------------------------------------------------------------------------------------------
// Scratch copies and runs.

const GIT_LOCATION = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];
const sh = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * A sandbox under the OS temp folder, removed after the test. `repo/` holds the checkout's own root files (never .git or
 * a .env*), its scripts/ (without node_modules, target or .git), the suite's merge-base/ beside them, node_modules
 * linked to the checkout's, and `docs` written into its docs/. With `real`, docs/ also links every entry of the
 * checkout's docs/, every other folder of the checkout is linked (never .git or target), and the planned names, which
 * name real open issues, are emptied: the tree the design links lane reads, with nothing of it copied. `bin/gh` is a
 * stand-in that records its arguments and fails as gh does with no sign-in, so nothing reaches GitHub.
 */
export function scratch(t, { docs = {}, real = false } = {}) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3546-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  for (const name of readdirSync(CHECKOUT)) {
    if (name === '.git' || name.startsWith('.env') || ['docs', 'scripts', 'target', 'node_modules'].includes(name)) continue;
    const kind = statSync(join(CHECKOUT, name), { throwIfNoEntry: false });
    if (kind?.isFile()) copyFileSync(join(CHECKOUT, name), join(repo, name));
    else if (real && kind?.isDirectory()) symlinkSync(join(CHECKOUT, name), join(repo, name));
  }
  cpSync(join(CHECKOUT, 'scripts'), join(repo, 'scripts'), { recursive: true, mode: constants.COPYFILE_FICLONE, filter: (from) => !/\/(?:node_modules|target|\.git)(?:\/|$)/.test(from.slice(CHECKOUT.length)) });
  cpSync(join(SUITE, 'merge-base'), join(repo, 'merge-base'), { recursive: true });
  if (existsSync(join(CHECKOUT, 'node_modules'))) symlinkSync(join(CHECKOUT, 'node_modules'), join(repo, 'node_modules'));
  if (real) {
    // A doc the test writes is never a link, so nothing is written through one into the checkout.
    for (const name of readdirSync(join(CHECKOUT, 'docs'))) if (!(`docs/${name}` in docs)) symlinkSync(join(CHECKOUT, 'docs', name), join(repo, 'docs', name));
    if (existsSync(join(repo, 'scripts/planned-names.txt'))) writeFileSync(join(repo, 'scripts/planned-names.txt'), '');
  }
  for (const [path, text] of Object.entries(docs)) writeFileSync(join(repo, path), text);
  for (const folder of ['home', 'tmp', 'cache', 'config', 'bin']) mkdirSync(join(sandbox, folder));
  const log = join(sandbox, 'gh-calls.log');
  writeFileSync(log, '');
  writeFileSync(join(sandbox, 'bin', 'gh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${sh(log)}\necho 'To get started with GitHub CLI, please run:  gh auth login (the offline stand-in of #3546 tests)' >&2\nexit 4\n`);
  chmodSync(join(sandbox, 'bin', 'gh'), 0o755);
  return { sandbox, repo, log };
}

/** No GitHub token, host or repo, no git variable pointing elsewhere, the sandbox's own home, the stand-in first on PATH. */
function sandboxEnv(sandbox, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_LOCATION.includes(name)));
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_HOST', 'GH_REPO', 'DEEP_OPEN_ISSUES', 'DEEP_PREFLIGHT', 'NODE_OPTIONS', 'NODE_TEST_CONTEXT']) delete env[name];
  return {
    ...env,
    PATH: [join(sandbox, 'bin'), dirname(process.execPath), env.PATH].join(delimiter),
    HOME: join(sandbox, 'home'),
    TMPDIR: join(sandbox, 'tmp'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    GH_CONFIG_DIR: join(sandbox, 'config', 'gh'),
    ...extra,
  };
}

/** Writes the open issues the lanes read into the sandbox and returns the DEEP_OPEN_ISSUES setting for it. */
export function cachedIssues(copy, issues) {
  const file = join(copy.sandbox, 'open-issues.json');
  writeFileSync(file, JSON.stringify(issues.map(({ number, body }) => ({ number, body }))));
  return { DEEP_OPEN_ISSUES: file };
}

const clip = (text, max = 1200) => (text.length > max ? `${text.slice(0, max - 300)}\n… ${n(text.length - max)} characters cut …\n${text.slice(-300)}` : text);
// A message never holds this machine's folders: the copy, the checkout and the home folder go by a name.
const tidy = (text, sandbox) => (sandbox ? text.replaceAll(sandbox, '<scratch>') : text).replaceAll(CHECKOUT, '<checkout>').replaceAll(homedir(), '~');

function ran(copy, name, child) {
  const stdout = child.stdout ?? Buffer.alloc(0);
  const text = stdout.toString('utf8');
  const stderr = (child.stderr ?? Buffer.alloc(0)).toString('utf8');
  const calls = copy.log && existsSync(copy.log) ? readFileSync(copy.log, 'utf8').split('\n').filter(Boolean).map((line) => `gh ${line}`) : [];
  const output = tidy([
    `${name} exited ${child.status}${child.signal ? `, stopped by ${child.signal}` : ''}${child.error ? ` (${child.error.code ?? child.error.message})` : ''}`,
    `stdout, ${n(stdout.length)} bytes:\n${clip(text) || '(empty)'}`,
    `stderr:\n${clip(stderr) || '(empty)'}`,
    `recorded gh calls: ${calls.join(' | ') || '(none)'}`,
  ].join('\n'), copy.sandbox);
  const lines = (from) => from.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
  return { name, status: child.status, signal: child.signal, stdout, text, stderr, output, lines: lines(text), errLines: lines(stderr), allLines: lines(`${text}\n${stderr}`) };
}

/**
 * Runs `script` of the copy (or, with `planted`, this suite's planted/<planted>.mjs) once with `args`, its working
 * folder at the copy's root. The script must exist. stdout is kept as bytes.
 */
export function runIn(copy, script, args, { planted = null, env = {} } = {}) {
  if (!planted) assert.ok(existsSync(join(copy.repo, script)), `${script} does not exist in this checkout`);
  const program = planted ? join(SUITE, 'planted', `${planted}.mjs`) : script;
  const name = `${planted ? `the planted ${planted}.mjs` : script}${args.length ? ` ${args.join(' ')}` : ''}`;
  return ran(copy, name, spawnSync(process.execPath, [program, ...args], { cwd: copy.repo, env: sandboxEnv(copy.sandbox, env), timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 28 }));
}

/**
 * The commands of two lanes, as this checkout's scripts/lanes.mjs lists them in `checks`, read in a child so nothing of
 * it loads here: `links`, the one lane named for links that isn't the catalogue drift lane, and `rule`, the lint lane's
 * command that runs the text check #2338 added. A lanes file that can't be read stops the test, never passes it.
 */
export function laneCommands() {
  const program = `const { checks } = await import(${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)});
console.log(JSON.stringify(checks.map(({ name, commands }) => ({ name, commands }))));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd: CHECKOUT, env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !GIT_LOCATION.includes(name) && name !== 'NODE_TEST_CONTEXT')), encoding: 'utf8', timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
  if (child.status !== 0) throw new Error(`BLOCKED: scripts/lanes.mjs can't be read (exit ${child.status ?? child.signal}), so no lane's command is known: ${tidy((child.stderr ?? '').trim().split('\n').slice(0, 4).join(' | '), null)}`);
  const checks = JSON.parse(child.stdout.trim().split('\n').at(-1));
  const node = (command) => [process.execPath, 'node'].includes(command[0]) || /(?:^|\/)node$/.test(command[0]);
  const links = checks.filter(({ name }) => /\blinks?\b/i.test(name) && !/catalogue|drift/i.test(name));
  const rule = checks.find(({ name }) => name === 'lint')?.commands.find((command) => node(command) && command[1] === RULE);
  return { links, rule };
}

/** Runs a lane's commands in order, each with its working folder at the copy's root, to the first that fails. */
export function runCommands(copy, name, commands, env = {}) {
  let status = 0;
  let signal = null;
  const out = [];
  const err = [];
  for (const [program, ...args] of commands) {
    const child = spawnSync(program, args, { cwd: copy.repo, env: sandboxEnv(copy.sandbox, env), timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
    out.push(child.stdout ?? Buffer.alloc(0));
    err.push(child.stderr ?? Buffer.alloc(0));
    ({ status, signal } = child);
    if (status !== 0) break;
  }
  return ran(copy, name, { status, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
}

/** Runs one command with its working folder at the checkout itself: it reads the checkout and writes nothing. */
export function runInCheckout(name, [program, ...args]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_LOCATION.includes(key) && key !== 'NODE_TEST_CONTEXT'));
  return ran({ sandbox: null, log: null }, name, spawnSync(program, args, { cwd: CHECKOUT, env, timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 28 }));
}

// ---------------------------------------------------------------------------------------------------------------
// The fixture doc: nine headings at three levels, each heading's own text an exact number of tokens.

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'north', 'south', 'river', 'stone', 'paper', 'light', 'green', 'table', 'water', 'house', 'plant', 'cloud', 'field', 'glass', 'bread', 'chair', 'sound', 'point', 'world', 'story', 'music', 'night', 'money', 'value', 'order', 'group'];
// `words` filler words in lines of `per`, then a blank line; no line starts with `#`.
const fill = (words, per, seed) => {
  const lines = [];
  for (let at = 0; at < words; at += per) lines.push(Array.from({ length: Math.min(per, words - at) }, (_, i) => WORDS[(seed + (at + i) * 7) % WORDS.length]).join(' '));
  return `${lines.join('\n')}\n\n`;
};
// A heading and its own text, `want` tokens in all: the heading, `lead`, filler, then `tail`.
function part({ level, title, tokens: want, lead = '', tail = '' }, seed) {
  const head = `${'#'.repeat(level)} ${title}\n\n${lead}`;
  for (const per of [16, 17, 15, 18, 14]) {
    let words = want;
    for (let tries = 0; tries < 8 && words > 0; tries++) {
      const text = head + fill(words, per, seed) + tail;
      const got = tokens(text);
      if (got === want) return text;
      words += want - got;
    }
  }
  throw new Error(`INVALID fixture: no filler gives "${title}" an own text of exactly ${want} tokens`);
}

/** The fixture's headings in order: anchor, level, title and own tokens (README: The fixture). */
const PARTS = [
  { id: 'first-read-fixture', level: 1, title: 'First read fixture', tokens: 60, tail: '<a id="the-other"></a>\n\n' },
  { id: 'other', level: 2, title: 'Other', tokens: 150 },
  { id: 'outer', level: 2, title: 'Outer', tokens: 120 },
  { id: 'inner', level: 3, title: 'Inner', tokens: 80, lead: 'A café — naïve ✓ line, so this text has more bytes than characters.\n' },
  { id: 'inner-two', level: 3, title: 'Inner two', tokens: 100, lead: '```sh\n# not a heading\necho done\n```\n\n' },
  { id: 'bulk', level: 2, title: 'Bulk', tokens: 20_000 },
  { id: 'bulk-part', level: 3, title: 'Bulk part', tokens: 4_300 },
  { id: 'tail', level: 2, title: 'Tail', tokens: 400 },
  { id: 'tail-and-one', level: 2, title: 'Tail and one', tokens: 401 },
];
let built;
/** The fixture doc's text, built once: about 150 KB, so it isn't checked in. */
export const fixtureDoc = () => (built ??= PARTS.map((entry, i) => part(entry, i * 11)).join(''));
/** The docs of a copy where the script runs alone: the fixture as the technical design, a one-heading canvas doc beside it. */
export const sectionDocs = () => ({ [TD]: fixtureDoc(), 'docs/canvas-primitives.md': '# Canvas primitives (fixture)\n\nA planted canvas doc for the acceptance tests of #3546.\n' });

const design = (doc, anchors) => `**Design:** ${anchors.map((anchor) => `[${anchor}](${BLOB}${doc}#${anchor})`).join(' · ')}`;
const issue = (number, doc, anchors, scope = []) => ({
  number,
  body: ['A planted issue for the acceptance tests of #3546, not a real one.', '', ...(anchors.length ? [design(doc, anchors), ''] : []), ...(scope.length ? ['### Scope', ...scope, ''] : [])].join('\n'),
});
const again = (doc, anchor) => `- Once more, as [its section](${doc}#${anchor}) says`;

/** The issues the script is run on, each with the sections it prints and their tokens (README: The fixture). */
export const NESTED = { ...issue(9546, TD, ['outer', 'the-other'], [again(TD, 'inner')]), prints: ['outer', 'the-other'] };
export const INNER_FIRST = { ...issue(9547, TD, ['inner', 'outer', 'tail']), prints: ['inner', 'outer', 'tail'] };
export const OVER = { ...issue(9548, TD, ['outer', 'bulk', 'inner', 'tail-and-one'], [again(TD, 'bulk')]), prints: ['outer', 'bulk', 'tail-and-one'], total: LIMIT + 1 };
export const AT = { ...issue(9549, TD, ['outer', 'bulk', 'inner', 'tail'], [again(TD, 'bulk')]), prints: ['outer', 'bulk', 'tail'], total: LIMIT };
export const SECTION_ISSUES = [AT, OVER, INNER_FIRST, NESTED];

/** The open issues the lane reads: eleven that print a section, and two that print none (README: The fixture). */
export const TWICE = 9555;
export const LARGEST = 9560;
export const LANE_ISSUES = [
  { ...issue(9562, LANE_DOC, [], [`- The whole [fixture doc](${BLOB}${LANE_DOC}), by no section of it`]), total: 0 },
  { ...issue(9561, LANE_DOC, [], [`- A change in [scripts/checks.mjs](${BLOB}scripts/checks.mjs), with no link into the docs`]), total: 0 },
  { ...issue(LARGEST, LANE_DOC, ['bulk', 'outer', 'other', 'tail', 'tail-and-one']), total: 25_551 },
  { ...issue(9559, LANE_DOC, ['tail', 'outer', 'other', 'bulk']), total: 25_150 },
  { ...issue(9558, LANE_DOC, ['bulk', 'other', 'outer', 'tail']), total: 25_150 },
  { ...issue(9557, LANE_DOC, ['outer', 'bulk', 'tail-and-one']), total: LIMIT + 1 },
  { ...issue(9556, LANE_DOC, ['outer', 'bulk', 'tail']), total: LIMIT },
  { ...issue(TWICE, LANE_DOC, ['bulk'], [again(LANE_DOC, 'bulk')]), total: 24_300 },
  { ...issue(9554, LANE_DOC, ['bulk-part']), total: 4_300 },
  { ...issue(9553, LANE_DOC, ['tail']), total: 400 },
  { ...issue(9552, LANE_DOC, ['outer', 'inner']), total: 300 },
  { ...issue(9551, LANE_DOC, ['other']), total: 150 },
  { ...issue(9550, LANE_DOC, ['inner']), total: 80 },
];
/** What the lane's line gives for those issues. */
const LANE = { read: 11, median: 24_300, p90: 25_150, largest: 25_551, over: 4 };

// ---------------------------------------------------------------------------------------------------------------
// The oracle: what an issue's first read holds, read from a copy's docs with the merge base's link code.

/** One section of a copy's doc, as the merge base's script reads it, with its headings and each one's own text. */
function sectionOf(copy, file, id) {
  const path = join(copy.repo, file);
  if (!/^docs\/[^/]+\.md$/.test(file) || !existsSync(path)) return { problem: `${file} is not a doc under docs/` };
  const { anchors, headings, lines } = outline(path);
  if (!anchors.has(id)) return { problem: `no heading or <a id> in ${file} is #${id}` };
  const heading = anchors.get(id);
  const bytes = readFileSync(path);
  const at = headings.findIndex((candidate) => candidate.id === heading);
  if (at === -1) return { file, id, heading, bytes: bytes.subarray(lines.get(id)), start: lines.get(id), end: bytes.length, parts: [] };
  const { level, offset } = headings[at];
  const start = id === heading ? offset : Math.min(offset, lines.get(id) ?? offset);
  const after = headings.slice(at + 1).findIndex((next) => next.level <= level);
  const last = after === -1 ? headings.length : at + 1 + after;
  const end = headings[last]?.offset ?? bytes.length;
  // A heading's own text: from its line to the next heading's line of any level (#2338).
  const parts = headings.slice(at, last).map((entry, i) => {
    const own = bytes.subarray(entry.offset, headings[at + i + 1]?.offset ?? bytes.length);
    return { id: entry.id, line: own.toString('utf8').split('\n')[0], own, tokens: tokens(own) };
  });
  return { file, id, heading, bytes: bytes.subarray(start, end), start, end, parts };
}

/**
 * The sections a body prints, in the order it first links them, as the merge base's loop prints them: a link to a
 * heading already printed, or to a section inside one already printed, prints nothing more. With `perLink`, every link's
 * section, which is what the wrong lane counts.
 */
function linked(copy, body, { perLink = false } = {}) {
  const printed = new Set();
  const ranges = [];
  const sections = [];
  for (const { line } of prose(body ?? '')) {
    for (const target of targets(line)) {
      const link = resolve(target, null);
      if (!link?.id) continue;
      const found = sectionOf(copy, link.file, link.id);
      if (found.problem) throw new Error(`INVALID fixture: an issue links ${link.file}#${link.id}, and ${found.problem}`);
      const key = `${link.file}#${found.heading}`;
      if (!perLink && (printed.has(key) || ranges.some((r) => r.file === link.file && r.start <= found.start && found.end <= r.end))) continue;
      printed.add(key);
      ranges.push({ file: link.file, start: found.start, end: found.end });
      sections.push(found);
    }
  }
  return sections;
}

/**
 * What an issue's first read holds in a copy: its sections, their bytes and tokens, and every heading of theirs in
 * order with its own tokens. The count has to be one number however it is taken: over the text whole, a section at a
 * time, or a heading's own text at a time (README: What a count is taken over); a fixture where they differ, or one
 * that doesn't hold the tokens it was built for, is INVALID and shows nothing.
 */
export function firstRead(copy, { number, body, prints, total }) {
  const sections = linked(copy, body);
  const bytes = sections.reduce((sum, section) => sum + section.bytes.length, 0);
  const bySection = sections.reduce((sum, section) => sum + tokens(section.bytes), 0);
  const whole = tokens(Buffer.concat(sections.map((section) => section.bytes)));
  const headings = sections.flatMap((section) => section.parts.map((entry) => ({ file: section.file, ...entry })));
  const byHeading = headings.reduce((sum, heading) => sum + heading.tokens, 0);
  if (prints && sections.map((section) => section.id).join() !== prints.join()) throw new Error(`INVALID fixture: #${number} prints ${sections.map((section) => section.id).join(', ')}, not ${prints.join(', ')}`);
  if (whole !== bySection) throw new Error(`INVALID fixture: #${number}'s text is ${whole} tokens counted whole and ${bySection} a section at a time`);
  if (total !== undefined && (bySection !== total || byHeading !== total)) throw new Error(`INVALID fixture: #${number}'s sections hold ${bySection} tokens, ${byHeading} by their headings' own text, not the ${total} it was built for`);
  return { number, sections, bytes, tokens: bySection, headings, byHeading };
}

/** The fixture doc holds the tokens it was built for, heading by heading. */
export function fixtureHolds(copy, file) {
  const whole = sectionOf(copy, file, PARTS[0].id);
  const got = whole.parts.map(({ id, tokens: count }) => `${id} ${count}`).join(', ');
  const want = PARTS.map(({ id, tokens: count }) => `${id} ${count}`).join(', ');
  if (got !== want) throw new Error(`INVALID fixture: ${file}'s headings hold ${got}, not ${want}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a run.

const HEADER = /^==> (docs\/[^\s#]+\.md)#(\S+) <==\n/gm;
/** The sections a run printed: each `==> <doc>#<anchor> <==` line and the bytes after it, to the next one. */
export function readSections(stdout) {
  // latin1 keeps one character a byte, so the offsets are byte offsets.
  const text = stdout.toString('latin1');
  const found = [...text.matchAll(HEADER)];
  return found.map((match, i) => ({ file: match[1], anchor: match[2], bytes: stdout.subarray(match.index + match[0].length, found[i + 1]?.index ?? stdout.length) }));
}

/** Every whole number of a line that the word `unit`, or its plural, follows: `<n> tokens`. */
const counts = (line, unit) => [...line.matchAll(new RegExp(`(?<![\\d,.])(\\d{1,3}(?:,\\d{3})+|\\d+)\\s+${unit}s?\\b`, 'gi'))].map((found) => Number(found[1].replaceAll(',', '')));
const first = (line, unit) => counts(line, unit)[0];
/** The closing line: the last line of standard error, and the first `<n> sections`, `<n> bytes` and `<n> tokens` in it. */
export function closing(run) {
  const text = run.errLines.at(-1);
  return text === undefined ? null : { text, sections: first(text, 'section'), bytes: first(text, 'byte'), tokens: first(text, 'token') };
}

const firstDifference = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** The merge base's script printed these sections' text and exited 0; otherwise there is nothing to compare with. */
export function baseHolds(base, read) {
  const printed = readSections(base.stdout);
  const same = printed.length === read.sections.length && printed.every((section, i) => section.bytes.equals(read.sections[i].bytes));
  if (base.status !== 0 || !read.sections.length || !same) throw new Error(`BLOCKED: the merge base's script didn't print #${read.number}'s ${read.sections.length} sections, so there is nothing to compare with:\n${base.output}`);
}

/** The run's standard output is the merge base's, byte for byte, and it exited 0. */
export function sameProblems(run, base) {
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0`);
  if (!run.stdout.equals(base.stdout)) {
    const at = firstDifference(run.stdout, base.stdout);
    problems.push(`${run.name} printed ${n(run.stdout.length)} bytes, not the ${n(base.stdout.length)} bytes the merge base prints; they differ from byte ${n(at)}: printed ${JSON.stringify(run.stdout.subarray(at, at + 80).toString())}, the merge base ${JSON.stringify(base.stdout.subarray(at, at + 80).toString())}`);
  }
  return problems;
}

/** Criterion 1: the closing line's sections, bytes and tokens are those of the text the run printed. */
export function closingProblems(run) {
  const printed = readSections(run.stdout);
  const text = { sections: printed.length, bytes: printed.reduce((sum, section) => sum + section.bytes.length, 0), tokens: printed.reduce((sum, section) => sum + tokens(section.bytes), 0) };
  const line = closing(run);
  if (!line) return [`${run.name} ends with no line on standard error, so nothing counts the ${n(text.sections)} sections, ${n(text.bytes)} bytes and ${n(text.tokens)} tokens it printed`];
  const problems = ['sections', 'bytes', 'tokens'].filter((unit) => line[unit] === undefined).map((unit) => `the closing line gives no \`<n> ${unit}\`: ${line.text}`);
  if (!problems.length && ['sections', 'bytes', 'tokens'].some((unit) => line[unit] !== text[unit])) problems.push(`the closing line says ${n(line.sections)} sections, ${n(line.bytes)} bytes and ${n(line.tokens)} tokens; the text printed is ${n(text.sections)} sections, ${n(text.bytes)} bytes and ${n(text.tokens)} tokens`);
  return problems;
}

// The lines of the sections' text that aren't a heading's own line: what an outline never prints.
const bodyLines = (read) => new Set(read.sections.flatMap((section) => {
  const headings = new Set(section.parts.map((entry) => entry.line));
  return section.bytes.toString('utf8').split('\n').map((line) => line.trim()).filter((line) => line && !headings.has(line));
}));
/** The lines of a run's standard output that are a line of the sections' text, or hold one of 80 characters or more. */
function textPrinted(run, read) {
  const body = bodyLines(read);
  const whole = run.lines.filter((line) => body.has(line.trim()));
  if (whole.length) return whole;
  const long = [...body].filter((line) => line.length >= 80);
  return run.lines.filter((line) => long.some((text) => line.includes(text)));
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const holdsAnchor = (line, id) => new RegExp(`#${escape(id)}(?![\\w-])`).test(line);

/**
 * Criterion 2 (and 4): past the limit the run prints only headings: one line a heading of the issue's sections, in
 * their order, each with its `#<anchor>` and its own `<n> tokens`; those add up to the total; the closing line gives
 * that total; and the output names the command that prints one section.
 */
export function outlineProblems(run, read, { titles = true } = {}) {
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0`);
  const text = textPrinted(run, read);
  if (text.length) {
    const printed = readSections(run.stdout);
    const total = printed.reduce((sum, section) => sum + tokens(section.bytes), 0);
    problems.push(`${run.name} printed the sections' text (${n(text.length)} of its lines), ${n(printed.length)} sections and ${n(total)} tokens by the pinned tokenizer, ${n(total - LIMIT)} past the limit of ${n(LIMIT)}, where only headings were due`);
  }
  const known = new Set(read.headings.map((heading) => heading.id));
  const lines = run.lines.filter((line) => !line.startsWith('==>') && first(line, 'token') !== undefined && [...known].some((id) => holdsAnchor(line, id)));
  if (lines.length !== read.headings.length) problems.push(`standard output holds ${n(lines.length)} heading lines (a line with a heading's \`#<anchor>\` and its own \`<n> tokens\`), not one for each of the ${n(read.headings.length)} headings of #${read.number}'s sections`);
  const wrong = [];
  // A line's own tokens: the `<n> tokens` that is its heading's, where the heading's own words hold another; else its first.
  let sum = 0;
  for (const [i, line] of lines.entries()) {
    const heading = read.headings[i];
    const own = counts(line, 'token');
    sum += heading && own.includes(heading.tokens) ? heading.tokens : own[0];
    if (!heading) continue;
    if (!holdsAnchor(line, heading.id)) wrong.push(`line ${i + 1} is ${JSON.stringify(line)}, not the line of ${heading.file}#${heading.id}`);
    else if (!own.includes(heading.tokens)) wrong.push(`${heading.file}#${heading.id}'s line gives ${n(own[0])} tokens, not the ${n(heading.tokens)} of its own text: ${JSON.stringify(line)}`);
    else if (titles && !line.includes(heading.line.replace(/^ {0,3}#+\s+/, ''))) wrong.push(`${heading.file}#${heading.id}'s line doesn't hold its heading, ${JSON.stringify(heading.line)}: ${JSON.stringify(line)}`);
  }
  if (wrong.length) problems.push(`${n(wrong.length)} heading lines are wrong: ${wrong.slice(0, 6).join('; ')}${wrong.length > 6 ? `; and ${n(wrong.length - 6)} more` : ''}`);
  if (lines.length && sum !== read.tokens) problems.push(`the lines' own tokens add up to ${n(sum)}, not the total, ${n(read.tokens)} tokens`);
  const line = closing(run);
  if (line?.tokens !== read.tokens) problems.push(`the closing line on standard error doesn't give the total, ${n(read.tokens)} tokens: ${line ? line.text : '(standard error holds no line)'}`);
  if (!/node scripts\/design-section\.mjs\s+\S*#\S+/.test(`${run.text}\n${run.stderr}`)) problems.push('the output names no command that prints one section, `node scripts/design-section.mjs <doc>#<anchor>`');
  return problems;
}

/** Criterion 2: each heading's anchor prints with `node scripts/design-section.mjs <doc>#<anchor>`: that section, exit 0. */
export function anchorProblems(copy, read) {
  const problems = [];
  for (const heading of read.headings) {
    const run = runIn(copy, SECTION, [`${heading.file}#${heading.id}`]);
    const want = sectionOf(copy, heading.file, heading.id).bytes;
    if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0`);
    else if (!run.stdout.equals(want)) problems.push(`${run.name} printed ${n(run.stdout.length)} bytes, not the ${n(want.length)} bytes of that heading's section; they differ from byte ${n(firstDifference(run.stdout, want))}`);
  }
  return problems;
}

/** Criterion 3: a run that printed no text of the sections where their text was due, naming the count. */
export function textProblems(run, base, read) {
  const problems = sameProblems(run, base);
  if (problems.length && !textPrinted(run, read).length) problems.push(`${run.name} printed none of the sections' text, where the text was due: #${read.number}'s sections total ${n(read.tokens)} tokens, which is the limit of ${n(LIMIT)} and not past it`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Criterion 5: the lane's line.

/** What the lane's line gives for a copy's open issues, from the oracle; `rows` holds each issue both ways. */
export function laneReads(copy, issues) {
  const rows = issues.map(({ number, body, total }) => {
    const once = linked(copy, body).reduce((sum, section) => sum + tokens(section.bytes), 0);
    if (once !== total) throw new Error(`INVALID fixture: #${number}'s sections hold ${once} tokens, not the ${total} it was built for`);
    return { number, once, perLink: linked(copy, body, { perLink: true }).reduce((sum, section) => sum + tokens(section.bytes), 0) };
  });
  const read = rows.filter((row) => row.once > 0).sort((a, b) => a.once - b.once);
  const want = { read: read.length, median: read[Math.ceil(read.length / 2) - 1].once, p90: read[Math.ceil(0.9 * read.length) - 1].once, largest: read.at(-1).once, over: read.filter((row) => row.once > LIMIT).length };
  if (JSON.stringify(want) !== JSON.stringify(LANE) || read.at(-1).number !== LARGEST) throw new Error(`INVALID fixture: the lane's issues read ${JSON.stringify(want)}, the largest #${read.at(-1).number}, not ${JSON.stringify(LANE)} and #${LARGEST}`);
  return { ...want, issue: LARGEST, rows };
}

const WHOLE = /(?<![#\w.,])(\d{1,3}(?:,\d{3})+|\d+)(?![\w]|[.,]\d)/g;
/** The lane's reading: the one line of its output that holds the word `median`. */
export const readingLines = (run) => run.allLines.filter((line) => /\bmedian\b/i.test(line));

/**
 * Criterion 5: the lane's one line gives the issues read, the median, the 90th percentile, the largest with its issue
 * and how many pass the limit: each number is in the line as a whole number, and the largest's issue as `#<n>`.
 */
export function laneProblems(run, want) {
  const lines = readingLines(run);
  if (lines.length !== 1) return [`the lane's output holds ${lines.length} lines with the word "median", not the one line of its reading`];
  const [line] = lines;
  const numbers = new Set([...line.matchAll(WHOLE)].map((found) => Number(found[1].replaceAll(',', ''))));
  const named = [...line.matchAll(/#(\d+)\b/g)].map((found) => Number(found[1]));
  const problems = [];
  for (const [what, value] of [['issues read', want.read], ['median', want.median], ['90th percentile', want.p90], ['largest', want.largest], [`count past the limit of ${n(LIMIT)} tokens`, want.over]]) if (!numbers.has(value)) problems.push(`the line doesn't give the ${what}, ${n(value)}`);
  if (!named.includes(want.issue)) problems.push(`the line doesn't name the largest's issue, #${want.issue}, whose sections total ${n(want.largest)} tokens`);
  for (const row of want.rows.filter((entry) => entry.number !== want.issue && named.includes(entry.number))) problems.push(`the line names #${row.number}, whose sections total ${n(row.once)} tokens counted once each${row.perLink === row.once ? '' : ` and ${n(row.perLink)} with a section counted for each link to it`}; the largest is #${want.issue} with ${n(want.largest)}`);
  return problems.length ? [...problems, `the line: ${line}`] : [];
}

// ---------------------------------------------------------------------------------------------------------------
// Criterion 6: the words the two files share, and the text check.

export const PHRASE = 'Read the design sections your issue links before edits';
export const PHRASE_EDITED = 'Read the design sections your issue links before any edit';
const NAMES_LIMIT = /25,?000/;
/** A file of a tree, as text. */
export const read = (root, file) => readFileSync(join(root, file), 'utf8');

// Every sentence of a text that names the limit, 25,000, with its 1-based line: a sentence ends at a `.` followed by
// white space or at the line's end; a list marker and an HTML comment aren't part of it.
const limitSentences = (text) => text.split('\n').flatMap((line, i) => line.replace(/<!--.*?-->/g, '').trim().replace(/^[-*]\s+/, '').split(/(?<=\.)\s+/)
  .filter((sentence) => NAMES_LIMIT.test(sentence)).map((sentence) => ({ line: i + 1, sentence })));

/**
 * The sentence on the limit in AGENTS.md's text and in CONTRIBUTING.md's: the first pair that is one sentence, `same`
 * true; or each file's first such sentence, null where it has none, `same` false.
 */
export function limitSentence(agentsText, contributingText) {
  const [inAgents, inContributing] = [limitSentences(agentsText), limitSentences(contributingText)];
  for (const agents of inAgents) {
    const contributing = inContributing.find((candidate) => candidate.sentence === agents.sentence);
    if (contributing) return { agents, contributing, same: true };
  }
  return { agents: inAgents[0] ?? null, contributing: inContributing[0] ?? null, same: false };
}

/** Plants an edit in one file of a copy: on line `at`, `to` replaces the first `from`. The line keeps its place. */
export function editLine(copy, file, at, from, to) {
  const lines = read(copy.repo, file).split('\n');
  assert.ok(lines[at - 1]?.includes(from), `${file}:${at} doesn't hold ${JSON.stringify(from)}, so the edit can't be planted`);
  lines[at - 1] = lines[at - 1].replace(from, to);
  writeFileSync(join(copy.repo, file), lines.join('\n'));
}

/** The check fails, naming both lines as <file>:<line>. */
export function namesBothProblems(run, agentsLine, contributingLine) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped by ${run.signal}`);
  else if (run.status === 0) problems.push(`${run.name} exited 0 though the two files' words differ`);
  if (!run.lines.some((line) => line.startsWith('FAIL'))) problems.push(`${run.name} printed no line starting FAIL`);
  for (const where of [`AGENTS.md:${agentsLine}`, `CONTRIBUTING.md:${contributingLine}`]) if (!new RegExp(`${escape(where)}(?!\\d)`).test(`${run.text}\n${run.stderr}`)) problems.push(`its output doesn't name ${where}`);
  return problems;
}

/** The check passes: exit 0, a PASS line, no FAIL, INVALID, BLOCKED or INCONCLUSIVE line. */
export function rulePassProblems(run) {
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0`);
  if (!run.lines.some((line) => line.startsWith('PASS'))) problems.push(`${run.name} printed no line starting PASS`);
  if (run.lines.some((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line))) problems.push(`${run.name} printed a FAIL, INVALID, BLOCKED or INCONCLUSIVE line`);
  return problems;
}
