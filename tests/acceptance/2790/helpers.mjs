// Test-side tools for the #2790 acceptance tests. Nothing here stands in for the guide, its generator or its drift
// test: they are reached only as `node scripts/guide.mjs [--check] [--api <file>]`, docs/extension-guide.md and #351's
// guide.test.ts.
//
// `node scripts/guide.mjs` without `--check` writes docs/extension-guide.md and the two examples' deepbuild.json, so no
// test runs it in the repo. `generate()` runs a copy of the script in a scratch tree instead: the script finds
// everything from its own place (`../`), so a tree holding scripts/guide.mjs and docs/extension-guide/ as copies, and
// packages/, crates/ and node_modules/ as links (read only), gets the guide exactly as the repo would. Scratch trees
// are under the system's temp folder and removed when the process ends. No network; nothing is stopped by name or port.
//
// deep.source.ask (#2745) is the one other method the base's script has no description for, and the script writes
// nothing while any description is missing. Where the script still lacks that one, and only then, `generate()` runs it
// again with `--api` on a copy of the contract less deep.source.ask, and the guide is compared less that entry (README,
// "Beside #2745"). Nothing is ever supplied for deep.registerPort.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const METHOD = 'deep.registerPort';
/** #2745's method: not this issue's, and missing from the script and the guide until PR #2766 lands. */
export const OTHER = 'deep.source.ask';
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir(), NO_COLOR: '1' };

const made = [];
process.on('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
export function tempDir(tag) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-2790-${tag}-`)));
  made.push(dir);
  return dir;
}

const run = (cwd, args) => {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 600_000, env: ENV });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ?? null };
};
const show = (r) => `exit ${r.status}${r.error ? `, ${r.error.message}` : ''}\n${r.stdout}${r.stderr}`;

/** The lines of some output that name a method: the name whole, not as the start of a longer one. */
export const naming = (output, method = METHOD) => output.split('\n').filter((line) => new RegExp(`(^|[^\\w.])${method.replaceAll('.', '\\.')}(?![\\w]|\\.\\w)`).test(line));
const failLines = (output) => output.split('\n').filter((line) => line.includes('FAIL guide'));

/** The guide's drift test in a tree: its exit status, its output and its `FAIL guide` lines. It writes nothing. */
export function guideCheck(root = REPO) {
  const r = run(root, [join(root, 'scripts/guide.mjs'), '--check']);
  return { ...r, fails: failLines(r.stdout) };
}

/** The contract's entries, from packages/contracts/extension-api.json, and one method's. */
const contract = () => JSON.parse(readFileSync(join(REPO, 'packages/contracts/extension-api.json'), 'utf8'));
export const published = (method = METHOD) => contract().find((e) => e.method === method);

/**
 * A scratch tree with a copy of a tree's guide script (or the script text given, for a planted twin). `guide: true`
 * also copies the tree's docs/extension-guide.md, so the scratch tree's drift test reads it.
 */
export function scratch({ from = REPO, script = readFileSync(join(from, 'scripts/guide.mjs'), 'utf8'), guide = false } = {}) {
  const root = tempDir('tree');
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts/guide.mjs'), script);
  mkdirSync(join(root, 'docs'));
  cpSync(join(REPO, 'docs/extension-guide'), join(root, 'docs/extension-guide'), { recursive: true });
  if (guide) cpSync(join(from, 'docs/extension-guide.md'), join(root, 'docs/extension-guide.md'));
  for (const name of ['packages', 'crates', 'node_modules']) symlinkSync(join(REPO, name), join(root, name));
  return root;
}

/**
 * What a tree's scripts/guide.mjs writes as the guide, generated in a scratch tree: `text` is null when it wrote none.
 * `less` is deep.source.ask when the script wrote nothing only for want of that method's description and so was run on
 * the contract less it; null when it wrote the guide of the whole contract. A run that names deep.registerPort is never
 * run again.
 */
export function generate(options) {
  const root = scratch(options);
  const file = join(root, 'docs/extension-guide.md');
  const script = join(root, 'scripts/guide.mjs');
  const whole = run(root, [script]);
  if (whole.status === 0) return { ...whole, root, less: null, text: existsSync(file) ? readFileSync(file, 'utf8') : null };
  const output = `${whole.stdout}${whole.stderr}`;
  const fails = failLines(output);
  const onlyOther = fails.length > 0 && naming(output).length === 0 && fails.every((line) => naming(line, OTHER).length === 1 && /^FAIL guide: deep\.source\.ask: /.test(line));
  if (!onlyOther || existsSync(file)) return { ...whole, root, less: null, text: null };
  const api = join(root, 'extension-api.less-source-ask.json');
  writeFileSync(api, JSON.stringify(contract().filter((e) => e.method !== OTHER)));
  const part = run(root, [script, '--api', api]);
  return { ...part, root, less: OTHER, text: part.status === 0 && existsSync(file) ? readFileSync(file, 'utf8') : null };
}

/** A method's entry in a guide's text, from its `### \`method\`` heading to the next heading; null when there is none. */
export function entryOf(text, method = METHOD) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.includes(`\`${method}\``));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6} /.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n');
}
/** A guide's text less a method's entry, heading to next heading; the text itself when it has none. */
export function withoutEntry(text, method) {
  const entry = entryOf(text, method);
  return entry === null ? text : text.replace(entry, '');
}

/**
 * What an entry says the method is for: its prose. The heading, the line the contract gives (release, stability and
 * digest) and the parameter table's rows are the contract's, not the script's words, so they don't count: the method's
 * own name and its parameters' can't stand in for what it is for.
 */
export function proseOf(entry, digest = published().digest) {
  return entry.split('\n').slice(1).filter((line) => !line.startsWith('|') && !line.includes(digest)).join(' ').replace(/\s+/g, ' ').trim();
}

const DENIAL = '(\\b(never|not|no|nor|without)\\b|n\'t\\b)';
/** Some one clause of the prose (between `.`, `;` and `:`) holds every term. */
const oneClause = (s, ...terms) => s.split(/[.;:]/).some((clause) => terms.every((term) => term.test(clause)));
/**
 * What the issue's first criterion says the description must say, clause by clause, each as the least a sentence that
 * says it holds: the terms the issue, the design's Extension API line and host.ts use, in any order and wording, tested
 * on the prose in lower case.
 */
export const MUST_SAY = [
  ['a plug-in\'s side of a piece\'s port', (s) => oneClause(s, /\bplug-?ins?\b/, /\bpieces?\b/, /\bports?\b/)],
  ['it lists the entries it takes', (s) => /\bentries\b/.test(s)],
  ['and the occurrence rows it takes', (s) => /\boccurrences?\b|\brows?\b/.test(s)],
  ['and the sources it gives for readings in', (s) => /\bsources?\b/.test(s) && /\breadings?\b/.test(s)],
  ['it says whether its gear makes sound', (s) => /\bsounds?\b/.test(s)],
  ['which makes the plug-in a device gate owner', (s) => /\bdevice gates?\b/.test(s) && /\bowners?\b/.test(s)],
  ['whatever the document says', (s) => /\bdocuments?\b/.test(s)],
  ['registering opens nothing', (s) => new RegExp(`\\bopens? (nothing|none)\\b|${DENIAL}[^.;,:]{0,30}\\bopen`).test(s)],
  ['a port opens only after a person clicks Connect', (s) => /\bconnect\b/.test(s) && /\b(person|people|you|your)\b/.test(s) && /\bopen(s|ed)?\b/.test(s)],
  ['and sends only while the piece plays live', (s) => /\blive\b/.test(s) && /\bplay(s|ed|ing)?\b/.test(s)],
];
/** The clauses of the issue a description doesn't say; empty when it says them all. */
export const unsaid = (prose) => MUST_SAY.filter(([, says]) => !says(prose.toLowerCase())).map(([clause]) => clause);

/** AC1 on a tree: its scripts/guide.mjs writes a guide whose deep.registerPort entry says what the issue says. */
export function scriptSays(assert, root = REPO) {
  const made = generate({ from: root });
  assert.deepEqual(naming(`${made.stdout}${made.stderr}`), [], `node scripts/guide.mjs has no complaint of ${METHOD}; it gave:\n${show(made)}`);
  assert.notEqual(made.text, null, `node scripts/guide.mjs writes the guide${made.less ? ` (on the contract less ${made.less}, which it has no description for)` : ''}; it gave:\n${show(made)}`);
  const entry = entryOf(made.text);
  assert.notEqual(entry, null, `the guide scripts/guide.mjs writes has an entry for ${METHOD}`);
  const prose = proseOf(entry);
  assert.deepEqual(unsaid(prose), [], `what scripts/guide.mjs says ${METHOD} is for leaves out part of what the issue says it must say; it says: ${JSON.stringify(prose)}`);
  return made;
}

/** AC2 on a tree, the drift test: `node scripts/guide.mjs --check` runs and prints no line naming deep.registerPort. */
export function checkIsQuiet(assert, root = REPO) {
  const r = guideCheck(root);
  assert.deepEqual(naming(`${r.stdout}${r.stderr}`), [], `node scripts/guide.mjs --check prints no line that names ${METHOD}; it gave:\n${show(r)}`);
  // It ran as the drift test, to its end: a PASS line and exit 0, or FAIL lines (another method's) and exit 1.
  const ran = (r.status === 0 && /^PASS guide/m.test(r.stdout) && r.fails.length === 0) || (r.status === 1 && r.fails.length > 0);
  assert.equal(ran, true, `node scripts/guide.mjs --check ran to its verdict, PASS guide and exit 0 or FAIL guide lines and exit 1; it gave:\n${show(r)}`);
  return r;
}

/** AC2 on a tree, the guide: docs/extension-guide.md has the entry, and is what the tree's scripts/guide.mjs writes. */
export function regenerated(assert, root = REPO) {
  const guide = readFileSync(join(root, 'docs/extension-guide.md'), 'utf8');
  const entry = entryOf(guide);
  assert.notEqual(entry, null, `docs/extension-guide.md has an entry for ${METHOD}, which the contract publishes`);
  assert.ok(entry.includes(`\`${published().digest}\``), `the guide's entry for ${METHOD} carries the digest the contract publishes it under, ${published().digest}; it is:\n${entry}`);
  const made = generate({ from: root });
  assert.deepEqual(naming(`${made.stdout}${made.stderr}`), [], `node scripts/guide.mjs has no complaint of ${METHOD}; it gave:\n${show(made)}`);
  assert.notEqual(made.text, null, `node scripts/guide.mjs writes the guide${made.less ? ` (on the contract less ${made.less})` : ''}; it gave:\n${show(made)}`);
  // Where the script has no description for deep.source.ask, it wrote the guide less that entry: compare less it.
  const committed = made.less ? withoutEntry(guide, made.less) : guide;
  assert.equal(committed === made.text, true, `docs/extension-guide.md is what node scripts/guide.mjs writes now, byte for byte${made.less ? ` (both less ${made.less}'s entry)` : ''}: run it and commit the guide. The entry it writes for ${METHOD}:\n${entryOf(made.text)}\nthe guide's:\n${entry}\nfirst difference at byte ${[...committed].findIndex((c, i) => c !== made.text[i])} of ${committed.length} (it writes ${made.text.length})`);
  return made;
}

/** The four of #351's guide.test.ts cases that run the drift test (the other two build and run the examples; README). */
export const DRIFT_CASES = 'AC1 (the guide is generated|a method the contract|a slot the contract|a guide entry for)';
/** Runs #351's guide.test.ts cases whose full name matches, as its README runs them; each case with its state. */
export function run351(pattern = DRIFT_CASES) {
  const report = join(tempDir('report'), 'report.json');
  const r = run(REPO, ['node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/351', '--no-file-parallelism', 'guide.test.ts', '-t', pattern, '--reporter=json', `--outputFile=${report}`]);
  const files = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')).testResults : [];
  const cases = files.flatMap((f) => f.assertionResults.map((a) => ({ name: a.title, state: a.status, why: (a.failureMessages ?? []).join('\n') })));
  return { ...r, cases, loadErrors: files.filter((f) => f.status === 'failed' && f.message).map((f) => f.message) };
}

/**
 * AC3's verdict on the cases that ran and didn't pass: for each, what is wrong with how it failed, by the issue's rule.
 * A case may fail only on `FAIL guide` lines, each of deep.source.ask alone (#2745); a line naming deep.registerPort, a
 * line of any other name, or a failure with no such line at all is this criterion's failure.
 */
export function wrongFailures(failed) {
  return failed.flatMap((c) => {
    const lines = failLines(c.why).map((line) => line.slice(line.indexOf('FAIL guide')).trim());
    const ours = naming(c.why);
    if (ours.length) return [`${c.name}: it fails on a line that names ${METHOD}:\n${[...new Set(ours.map((l) => l.trim()))].join('\n')}`];
    const others = lines.filter((line) => !/^FAIL guide: deep\.source\.ask: /.test(line));
    if (!lines.length || others.length) return [`${c.name}: it fails on more than ${OTHER}'s lines:\n${c.why.split('\n    at ')[0]}`];
    return [];
  });
}
