// Helpers for #2338's acceptance tests: scratch copies of the checkout under the OS temp folder (with the fixture doc,
// the cached open issues and a failing, recording `gh` stand-in first on PATH, or with planted docs and ceilings in a
// git repository of their own whose origin/main is its first commit), one run of a script or of a planted wrong
// program there, an oracle for the docs' own text written from the issue, and the judgement each criterion's test
// applies to the script and to its planted program. The README gives the surface they read. Node built-ins only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headings } from './planted/doc-links-copy.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SUITE = join(CHECKOUT, 'tests/acceptance/2338');
/** The scripts #2338 asks for (README: The surface). */
export const SECTION = 'scripts/design-section.mjs';
export const CEILINGS_SCRIPT = 'scripts/doc-ceilings.mjs';
export const CEILINGS = 'scripts/doc-ceilings.json';
export const RULE = 'scripts/reading-rule.mjs';
export const TD = 'docs/technical-design.md';
export const CP = 'docs/canvas-primitives.md';
export const LIMIT = 16_384;
const TIMEOUT_MS = 120_000;
const BLOB = 'https://github.com/windoliver/deepbuild/blob/main/';

// ---------------------------------------------------------------------------------------------------------------
// Scratch copies and runs.

const GIT_LOCATION = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE'];
const withoutGitLocation = (env) => Object.fromEntries(Object.entries(env).filter(([name]) => !GIT_LOCATION.includes(name)));
const sh = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/**
 * A sandbox under the OS temp folder, removed after the test. `repo/` holds the checkout's own root files (never .git or
 * a .env*), its scripts/ (without node_modules, target or .git) and `docs` as its only docs/. `bin/gh` is a stand-in that
 * records its arguments and fails as gh does with no sign-in, so nothing reaches GitHub.
 */
export function scratch(t, docs) {
  const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2338-')));
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  for (const entry of readdirSync(CHECKOUT, { withFileTypes: true })) if (entry.isFile() && entry.name !== '.git' && !entry.name.startsWith('.env')) copyFileSync(join(CHECKOUT, entry.name), join(repo, entry.name));
  cpSync(join(CHECKOUT, 'scripts'), join(repo, 'scripts'), { recursive: true, filter: (from) => !/\/(?:node_modules|target|\.git)(?:\/|$)/.test(from.slice(CHECKOUT.length)) });
  for (const [path, text] of Object.entries(docs)) writeFileSync(join(repo, path), text);
  for (const folder of ['home', 'tmp', 'cache', 'config', 'bin']) mkdirSync(join(sandbox, folder));
  const log = join(sandbox, 'gh-calls.log');
  writeFileSync(log, '');
  writeFileSync(join(sandbox, 'bin', 'gh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${sh(log)}\necho 'To get started with GitHub CLI, please run:  gh auth login (the offline stand-in of #2338 tests)' >&2\nexit 4\n`);
  chmodSync(join(sandbox, 'bin', 'gh'), 0o755);
  return { sandbox, repo, log };
}

/** No GitHub token, host or repo, no git variable pointing elsewhere, the sandbox's own home, the stand-in first on PATH. */
function sandboxEnv(sandbox, extra = {}) {
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
    ...extra,
  };
}

const clip = (text, max = 6000) => (text.length > max ? `${text.slice(0, max - 1500)}\n… ${text.length - max} characters cut …\n${text.slice(-1500)}` : text);

/**
 * Runs `script` (or, with `planted`, planted/<planted>.mjs) once with `args`, its working folder at the copy's root.
 * The script must exist: on the base this assertion is where each test fails. stdout is kept as bytes.
 */
export function runIn(copy, script, args, { planted = null, env = {} } = {}) {
  if (!planted) assert.ok(existsSync(join(copy.repo, script)), `${script} does not exist: the script #2338 asks for isn't in this checkout`);
  const program = planted ? join(SUITE, 'planted', `${planted}.mjs`) : script;
  const name = planted ? `the planted ${planted}.mjs` : script;
  const child = spawnSync(process.execPath, [program, ...args], { cwd: copy.repo, env: sandboxEnv(copy.sandbox, env), timeout: TIMEOUT_MS, maxBuffer: 1 << 28 });
  const stdout = child.stdout ?? Buffer.alloc(0);
  const text = stdout.toString('utf8');
  const stderr = (child.stderr ?? Buffer.alloc(0)).toString('utf8');
  const calls = existsSync(copy.log) ? readFileSync(copy.log, 'utf8').split('\n').filter(Boolean).map((line) => `gh ${line}`) : [];
  const output = [
    `${name} ${args.join(' ')} exited ${child.status}${child.signal ? `, stopped by ${child.signal}` : ''}`,
    `stdout:\n${clip(text) || '(empty)'}`,
    `stderr:\n${clip(stderr) || '(empty)'}`,
    `recorded gh calls:\n${calls.join('\n') || '(none)'}`,
  ].join('\n');
  return { name, status: child.status, signal: child.signal, stdout, text, stderr, calls, output, lines: text.split('\n').filter((line) => line.trim()) };
}

// ---------------------------------------------------------------------------------------------------------------
// AC1 to AC3: the section printer on the fixture doc.

const fixture = (name) => readFileSync(join(SUITE, 'fixture', name));
/** The fixture doc (fixture/design.md), at docs/technical-design.md in the copy; a one-heading canvas doc beside it. */
export const DESIGN = fixture('design.md');
export const SECTION_DOCS = { [TD]: DESIGN, [CP]: '# Canvas primitives (fixture)\n\nA planted canvas doc for the acceptance tests of #2338.\n' };
/** Each tested anchor and the bytes its section must print (README: The fixture). */
export const EXPECTED = {
  alpha: fixture('alpha.md'),
  'the-plan': fixture('the-plan.md'),
  'notes-1': fixture('notes-1.md'),
};
/** The heading each tested anchor belongs to, for the issue's header line. */
const HEADING = { alpha: 'alpha', 'the-plan': 'plan', 'notes-1': 'notes-1' };

const firstDifference = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};

/** AC1: the script printed exactly the anchor's expected section, and exited 0. */
export function sectionProblems(run, anchor) {
  const want = EXPECTED[anchor];
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${TD}#${anchor}: ${run.name} exited ${run.status ?? run.signal}, not 0`);
  if (!run.stdout.equals(want)) {
    const at = firstDifference(run.stdout, want);
    problems.push(`${TD}#${anchor}: printed ${run.stdout.length} bytes, not the ${want.length} bytes of fixture/${anchor}.md; they differ from byte ${at}: printed ${JSON.stringify(run.stdout.subarray(at, at + 60).toString())}, expected ${JSON.stringify(want.subarray(at, at + 60).toString())}`);
  }
  return problems;
}

/** AC2: an unknown anchor exits non-zero, names the file and the anchor, and prints no section. */
export function unknownProblems(run, anchor) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped by ${run.signal}`);
  else if (run.status === 0) problems.push(`${run.name} exited 0 for ${TD}#${anchor}, which no heading or <a id> of the file has`);
  const said = `${run.text}\n${run.stderr}`;
  if (!said.includes(TD) || !said.includes(anchor)) problems.push(`its output doesn't name both the file ${TD} and the anchor ${anchor}`);
  const docLines = new Set(DESIGN.toString('utf8').split('\n').filter((line) => line.trim()));
  const printed = run.text.split('\n').filter((line) => docLines.has(line));
  if (printed.length) problems.push(`it printed ${printed.length} lines of the doc on stdout, a section where there should be none: ${printed.slice(0, 3).join(' | ')}`);
  return problems;
}

/** The fixture's open issues: #9338 links three sections in four links; #9339 links another. */
export const ISSUE = 9338;
export const ISSUES = [
  {
    number: 9339,
    body: `A planted issue for the acceptance tests of #2338, not a real one.\n\n**Design:** [Omega](${BLOB}${TD}#omega)\n`,
  },
  {
    number: ISSUE,
    body: [
      'A planted issue for the acceptance tests of #2338, not a real one.',
      '',
      `**Design:** [Alpha](${BLOB}${TD}#alpha) · [The plan](${BLOB}${TD}#the-plan)`,
      '',
      '### Scope',
      `- Alpha again, as [its section](${TD}#alpha) says`,
      `- The second notes: ${BLOB}${TD}#notes-1.`,
      '',
    ].join('\n'),
  },
];
/** The sections #9338 links, in the order it first links them. */
export const LINKED = ['alpha', 'the-plan', 'notes-1'];

/** Writes the open issues the lanes read into the sandbox and returns the DEEP_OPEN_ISSUES setting for it. */
export function cachedIssues(copy) {
  const file = join(copy.sandbox, 'open-issues.json');
  writeFileSync(file, JSON.stringify(ISSUES));
  return { DEEP_OPEN_ISSUES: file };
}

const HEADER = /^==> (docs\/[^\s#]+\.md)#(\S+) <==\n/gm;
/** The sections an issue run printed: each `==> <file>#<anchor> <==` line and the bytes after it, to the next one. */
export function readSections(run) {
  const text = run.text;
  const found = [...text.matchAll(HEADER)];
  const sections = found.map((match, i) => ({ file: match[1], anchor: match[2], text: text.slice(match.index + match[0].length, found[i + 1]?.index ?? text.length) }));
  return { before: found.length ? text.slice(0, found[0].index) : text, sections };
}

/** AC3: the three linked sections once each, in first-linked order, each byte-equal to its expected file. */
export function issueProblems(run) {
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0, though #${ISSUE} was among the open issues read`);
  const { before, sections } = readSections(run);
  if (sections.length !== LINKED.length) problems.push(`printed ${sections.length} sections, not ${LINKED.length}: #${ISSUE} links ${LINKED.length} sections in 4 links, and each prints once (${sections.map((s) => `${s.file}#${s.anchor}`).join(', ') || 'none'})`);
  if (before.length) problems.push(`stdout holds ${before.length} bytes before the first \`==> <file>#<anchor> <==\` line: ${JSON.stringify(before.slice(0, 120))}`);
  for (const [i, anchor] of LINKED.entries()) {
    const got = sections[i];
    if (!got) continue;
    if (got.file !== TD || ![anchor, HEADING[anchor]].includes(got.anchor)) problems.push(`section ${i + 1} is ${got.file}#${got.anchor}, not ${TD}#${anchor}: the sections print in the order the issue first links them`);
    else if (got.text !== EXPECTED[anchor].toString('utf8')) problems.push(`section ${i + 1}, ${TD}#${anchor}, isn't byte-equal to fixture/${anchor}.md: ${JSON.stringify(got.text.slice(0, 160))}`);
  }
  return problems;
}

/** AC3: without the open issues, BLOCKED naming what is missing, a non-zero exit and no section. */
export function blockedProblems(run) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped by ${run.signal}`);
  else if (run.status === 0) problems.push(`${run.name} exited 0 though no open issues were fetched`);
  const blocked = `${run.text}\n${run.stderr}`.split('\n').map((line) => line.trim()).filter((line) => /^BLOCKED\b/.test(line));
  if (!blocked.some((line) => line.includes(`#${ISSUE}`) && /open issues/i.test(line))) problems.push(`no line starting BLOCKED names what is missing, #${ISSUE} and the open issues (BLOCKED lines: ${blocked.join(' | ') || 'none'})`);
  const { sections } = readSections(run);
  const docLines = new Set(DESIGN.toString('utf8').split('\n').filter((line) => line.trim()));
  const printed = run.text.split('\n').filter((line) => docLines.has(line));
  if (sections.length || printed.length) problems.push(`it printed ${sections.length} section headers and ${printed.length} lines of the doc without the issues`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// AC4: own text and the doc ceilings.

/** Each heading of a doc with its own text in bytes: from its line to the next heading's line of any level, or the end. */
export function ownTexts(buffer) {
  const { headings: all, size } = headings(buffer);
  return all.map((heading, i) => ({ id: heading.id, size: (all[i + 1]?.offset ?? size) - heading.offset }));
}

/** The oracle over two docs: the headings read, those over the limit as `{ "<file>#<slug>": bytes }`, and the largest. */
export function oracle(docs) {
  let read = 0;
  const over = {};
  let largest = { key: '', size: -1 };
  for (const [file, buffer] of Object.entries(docs)) {
    for (const { id, size } of ownTexts(Buffer.from(buffer))) {
      read++;
      const key = `${file}#${id}`;
      if (size > LIMIT) over[key] = size;
      if (size > largest.size) largest = { key, size };
    }
  }
  return { read, over, largest };
}

// `count` bytes of filler prose, ending in a newline, no line starting with `#`.
const fill = (count) => {
  assert.ok(count >= 1);
  const line = `${'planted filler '.repeat(4).trimEnd()}\n`;
  const whole = Math.floor((count - 1) / line.length);
  return line.repeat(whole) + 'f'.repeat(count - 1 - whole * line.length) + '\n';
};
const part = (level, title, size) => {
  const head = `${'#'.repeat(level)} ${title}\n`;
  return head + fill(size - Buffer.byteLength(head));
};

/**
 * AC4's planted docs (README: The doc ceilings fixture). Own text in bytes: big-section 17,000 (+ `bigExtra`),
 * shrinking-section 18,000 (− `shrinkBy`), edge-section 16,384 exactly, new-big-section 17,000 when `newBig`, and the
 * canvas doc's wide-section 16,500; every other heading well under the limit.
 */
export function ceilingDocs({ bigExtra = 0, shrinkBy = 0, newBig = false } = {}) {
  return {
    [TD]: [
      part(1, 'Ceilings fixture', 200),
      part(2, 'Big section', 17_000 + bigExtra),
      part(3, 'Small part', 300),
      part(2, 'Shrinking section', 18_000 - shrinkBy),
      part(2, 'Edge section', 16_384),
      newBig ? part(2, 'New big section', 17_000) : '',
      part(2, 'Tail', 100),
    ].join(''),
    [CP]: [part(1, 'Canvas fixture', 200), part(2, 'Wide section', 16_500), part(2, 'Narrow section', 500)].join(''),
  };
}
export const BASE_CEILINGS = { [`${TD}#big-section`]: 17_000, [`${TD}#shrinking-section`]: 18_000, [`${CP}#wide-section`]: 16_500 };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

/**
 * A scratch copy whose docs/ and scripts/doc-ceilings.json are the base fixture, committed in a fresh repository of
 * its own, with refs/remotes/origin/main at that commit, so the merge base with origin/main is that commit; then the
 * work tree gets `docs` and `ceilings` (the change), uncommitted.
 */
export function ceilingsRepo(t, { docs, ceilings }) {
  const copy = scratch(t, ceilingDocs());
  writeFileSync(join(copy.repo, CEILINGS), json(BASE_CEILINGS));
  const git = (...args) => {
    const run = spawnSync('git', [...GIT, ...args], { cwd: copy.repo, env: withoutGitLocation(process.env), encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`BLOCKED: git ${args.join(' ')} failed in the scratch copy: ${run.error?.message ?? run.stderr}`);
  };
  git('init', '-q');
  if (!existsSync(join(copy.repo, '.git', 'HEAD'))) throw new Error(`BLOCKED: git init made no repository of the scratch copy's own at ${join(copy.repo, '.git')}`);
  git('add', '-f', '--', 'docs', CEILINGS);
  git('commit', '-q', '-m', 'base: the planted docs and their ceilings');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const [path, text] of Object.entries(docs)) writeFileSync(join(copy.repo, path), text);
  writeFileSync(join(copy.repo, CEILINGS), json(ceilings));
  return copy;
}

/** A whole number as a line may print it, with or without thousands commas. */
export const number = (n) => new RegExp(`(?<![\\d,])${String(n).replace(/\B(?=(\d{3})+$)/g, ',?')}(?!,?\\d)`);
const PASS_LINE = /^PASS doc-ceilings: (\d[\d,]*) headings read, (\d[\d,]*) over the limit of 16,?384 bytes; the largest is (docs\/[^\s#]+\.md#\S+), (\d[\d,]*) bytes\.?$/;
const toNumber = (text) => Number(text.replaceAll(',', ''));

/** A pass: exit 0 and exactly one line on stdout, the PASS line, naming what the oracle reads in `docs`. */
export function passProblems(run, docs) {
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0`);
  if (run.lines.length !== 1) problems.push(`${run.name} printed ${run.lines.length} lines on stdout, not one`);
  const line = run.lines.find((candidate) => candidate.startsWith('PASS'));
  const match = line?.match(PASS_LINE);
  if (!match) return [...problems, `no line \`PASS doc-ceilings: <n> headings read, <n> over the limit of 16,384 bytes; the largest is docs/<file>.md#<anchor>, <n> bytes\``];
  const want = oracle(docs);
  const [read, over, largest, size] = [toNumber(match[1]), toNumber(match[2]), match[3], toNumber(match[4])];
  if (read !== want.read) problems.push(`the line says ${read} headings read, not the docs' ${want.read}`);
  if (over !== Object.keys(want.over).length) problems.push(`the line says ${over} over the limit, not ${Object.keys(want.over).length}`);
  if (largest !== want.largest.key || size !== want.largest.size) problems.push(`the line names the largest as ${largest}, ${size} bytes, not ${want.largest.key}, ${want.largest.size} bytes`);
  return problems;
}

/** A fail: a non-zero exit and a line starting FAIL naming the heading's file#anchor and each number in `numbers`. */
export function failProblems(run, key, numbers) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped by ${run.signal}`);
  else if (run.status === 0) problems.push(`${run.name} exited 0`);
  if (!run.lines.some((line) => line.startsWith('FAIL') && line.includes(key) && numbers.every((n) => number(n).test(line)))) problems.push(`no line starting FAIL names ${key} and ${numbers.join(' and ')}`);
  return problems;
}

/** Reads the checkout's two docs. */
export const checkoutDocs = () => ({ [TD]: readFileSync(join(CHECKOUT, TD)), [CP]: readFileSync(join(CHECKOUT, CP)) });

/** Runs a lint-lane command with its working folder at the checkout (no copy: the checkout's own docs and git). */
export function runInCheckout(command) {
  const [program, ...args] = command;
  const child = spawnSync(program === 'node' ? process.execPath : program, args, { cwd: CHECKOUT, env: withoutGitLocation(process.env), encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 28 });
  const text = child.stdout ?? '';
  return { name: args.join(' '), status: child.status, signal: child.signal, text, stderr: child.stderr ?? '', lines: text.split('\n').filter((line) => line.trim()), output: `${args.join(' ')} exited ${child.status}\nstdout:\n${clip(text) || '(empty)'}\nstderr:\n${clip(child.stderr ?? '') || '(empty)'}` };
}

/** The lint lane's node command that runs `script`, from scripts/lanes.mjs's `checks`; the test fails here when there is none. */
export async function lintCommand(script) {
  const { checks } = await import('../../../scripts/lanes.mjs');
  const lint = checks.find(({ name }) => name === 'lint');
  const command = lint?.commands.find((candidate) => [process.execPath, 'node'].includes(candidate[0]) && candidate[1] === script);
  assert.ok(command, `the lint lane runs no ${script}; its node commands are ${JSON.stringify(lint?.commands.filter((c) => [process.execPath, 'node'].includes(c[0])).map((c) => c.slice(1).join(' ')))}`);
  return command;
}

// ---------------------------------------------------------------------------------------------------------------
// AC5: the reading rule.

export const PHRASE = 'Read the design sections your issue links before edits';
export const EDITED = 'Read the design sections your issue links before any edit';
/** A line's sentence from `start`: to the first `.` followed by white space or the end of the line. */
export const sentenceFrom = (line, start) => line.slice(line.indexOf(start)).match(/^.*?(?:\.(?=\s|$)|$)/)[0];
/** The 1-based number of the first line of `text` holding `words`, or 0. */
export const lineOf = (text, words) => text.split('\n').findIndex((line) => line.includes(words)) + 1;

/** Plants the edit: in each of `files` of the copy, EDITED replaces PHRASE's first use; the other file is left alone. */
export function editRule(copy, files) {
  for (const file of files) {
    const path = join(copy.repo, file);
    const text = readFileSync(path, 'utf8');
    assert.ok(text.includes(PHRASE), `${file} doesn't hold the reading rule's words "${PHRASE}", so the edit can't be planted`);
    writeFileSync(path, text.replace(PHRASE, EDITED));
  }
}

/** AC5: the check fails when one file is edited alone, naming both lines as <file>:<line>. */
export function namesBothProblems(run, agentsLine, contributingLine) {
  const problems = [];
  if (run.signal) problems.push(`${run.name} was stopped by ${run.signal}`);
  else if (run.status === 0) problems.push(`${run.name} exited 0 though the reading rule's words differ between the two files`);
  const said = `${run.text}\n${run.stderr}`;
  if (!run.lines.some((line) => line.startsWith('FAIL'))) problems.push(`${run.name} printed no line starting FAIL`);
  for (const where of [`AGENTS.md:${agentsLine}`, `CONTRIBUTING.md:${contributingLine}`]) if (!new RegExp(`${where.replace('.', '\\.')}(?!\\d)`).test(said)) problems.push(`its output doesn't name ${where}`);
  return problems;
}

/** AC5: the check passes: exit 0, a PASS line, no FAIL line. */
export function rulePassProblems(run) {
  const problems = [];
  if (run.signal || run.status !== 0) problems.push(`${run.name} exited ${run.status ?? run.signal}, not 0`);
  if (!run.lines.some((line) => line.startsWith('PASS'))) problems.push(`${run.name} printed no line starting PASS`);
  if (run.lines.some((line) => /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.test(line))) problems.push(`${run.name} printed a FAIL, INVALID, BLOCKED or INCONCLUSIVE line`);
  return problems;
}
