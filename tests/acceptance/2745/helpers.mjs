// Test-side tools for the #2745 acceptance tests. Nothing here stands in for the guide, its generator or its drift
// test: they are reached only as `node scripts/guide.mjs [--check]`, docs/extension-guide.md and #351's guide.test.ts.
//
// `node scripts/guide.mjs` without `--check` writes docs/extension-guide.md and the two examples' deepbuild.json, so no
// test runs it in the repo. `generate()` runs a copy of the script in a scratch tree instead: the script finds
// everything from its own place (`../`), so a tree holding scripts/guide.mjs and docs/extension-guide/ as copies, and
// packages/, crates/ and node_modules/ as links (read only), gets the guide exactly as the repo would. Scratch trees
// are under the system's temp folder and removed when the process ends. No network; nothing is stopped by name or port.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const METHOD = 'deep.source.ask';
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? tmpdir(), NO_COLOR: '1' };

const made = [];
process.on('exit', () => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });
export function tempDir(tag) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `deep-2745-${tag}-`)));
  made.push(dir);
  return dir;
}

const run = (cwd, args) => {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 300_000, env: ENV });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ?? null };
};

/** The guide's drift test in a tree: its exit status, its output and its `FAIL guide` lines. */
export function guideCheck(root = REPO) {
  const r = run(root, [join(root, 'scripts/guide.mjs'), '--check']);
  return { ...r, fails: r.stdout.split('\n').filter((line) => line.startsWith('FAIL guide')) };
}

/**
 * A scratch tree with a copy of a tree's guide script (or the script text given, for a planted twin). `guide: true`
 * also copies the tree's docs/extension-guide.md, so the scratch tree's drift test reads it.
 */
export function scratch({ from = REPO, script = readFileSync(join(from, 'scripts/guide.mjs'), 'utf8'), guide = false } = {}) {
  const root = tempDir('tree');
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts/guide.mjs'), script);
  mkdirSync(join(root, 'docs'));
  cpSync(join(from, 'docs/extension-guide'), join(root, 'docs/extension-guide'), { recursive: true });
  if (guide) cpSync(join(from, 'docs/extension-guide.md'), join(root, 'docs/extension-guide.md'));
  for (const name of ['packages', 'crates', 'node_modules']) symlinkSync(join(REPO, name), join(root, name));
  return root;
}

/** What a tree's scripts/guide.mjs writes as the guide, generated in a scratch tree: `text` is null when it wrote none. */
export function generate(options) {
  const root = scratch(options);
  const r = run(root, [join(root, 'scripts/guide.mjs')]);
  const file = join(root, 'docs/extension-guide.md');
  return { ...r, root, text: r.status === 0 && existsSync(file) ? readFileSync(file, 'utf8') : null };
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

/** The contract's entry for a method, from packages/contracts/extension-api.json. */
export const published = (method = METHOD) => JSON.parse(readFileSync(join(REPO, 'packages/contracts/extension-api.json'), 'utf8')).find((e) => e.method === method);

/**
 * What an entry says the method is for: its prose. The heading, the line the contract gives (release, stability and
 * digest) and the parameter table's rows are the contract's, not the script's words, so they don't count: a parameter's
 * own description can't stand in for what the method is for.
 */
export function proseOf(entry, digest = published().digest) {
  return entry.split('\n').slice(1).filter((line) => !line.startsWith('|') && !line.includes(digest)).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * What the issue says the entry must say, clause by clause, each as the least a sentence that says it holds: the terms
 * the issue and sources.ts's `ask()` use, in any order and wording. `never the network` needs a denial just before the
 * word, in the same clause, so "it calls the network" doesn't count.
 */
export const MUST_SAY = [
  ['a plug-in asks a model source', (s) => /\bmodel\b/.test(s) && /\bsources?\b/.test(s)],
  ['one its manifest lists', (s) => /\bmanifest\b/.test(s)],
  ['the hub makes the call', (s) => /\bhub\b/.test(s)],
  ['from a recording when replaying', (s) => /\brecord(ing|ed)s?\b/.test(s) && /\breplay(s|ed|ing)?\b/.test(s)],
  ['the plug-in gets the answer\'s status and body', (s) => /\bstatus\b/.test(s) && /\bbody\b/.test(s)],
  ['or no answer', (s) => /\bno (answer|reply)\b|\bwithout an? (answer|reply)\b|\b(none|nothing)\b/.test(s)],
  ['never the network', (s) => /(\b(never|not|no|without|nor)\b|n't\b)[^.;,:]{0,30}\bnetwork\b/.test(s)],
];
/** The clauses of the issue a description doesn't say; empty when it says them all. */
export const unsaid = (prose) => MUST_SAY.filter(([, says]) => !says(prose.toLowerCase())).map(([clause]) => clause);

const show = (r) => `exit ${r.status}${r.error ? `, ${r.error.message}` : ''}\n${r.stdout}${r.stderr}`;

/** AC1 on a tree: its scripts/guide.mjs writes a guide whose deep.source.ask entry says what the issue says. */
export function scriptSays(assert, root = REPO) {
  const made = generate({ from: root });
  assert.equal(made.status, 0, `node scripts/guide.mjs writes the guide; it gave:\n${show(made)}`);
  assert.notEqual(made.text, null, 'node scripts/guide.mjs wrote docs/extension-guide.md');
  const entry = entryOf(made.text);
  assert.notEqual(entry, null, `the guide scripts/guide.mjs writes has an entry for ${METHOD}`);
  const prose = proseOf(entry);
  assert.deepEqual(unsaid(prose), [], `what scripts/guide.mjs says ${METHOD} is for leaves out part of what the issue says it must say; it says: ${JSON.stringify(prose)}`);
  return made.text;
}

/** AC2 on a tree, the drift test: `node scripts/guide.mjs --check` passes. */
export function checkPasses(assert, root = REPO) {
  const r = guideCheck(root);
  assert.deepEqual(r.fails, [], `node scripts/guide.mjs --check has no finding; it gave:\n${show(r)}`);
  assert.equal(r.status, 0, `node scripts/guide.mjs --check exits 0; it gave:\n${show(r)}`);
  assert.match(r.stdout, /^PASS guide/m, 'the drift test says PASS guide');
}

/** AC2 on a tree, the guide: docs/extension-guide.md has the entry, and is what the tree's scripts/guide.mjs writes. */
export function regenerated(assert, root = REPO) {
  const guide = readFileSync(join(root, 'docs/extension-guide.md'), 'utf8');
  const entry = entryOf(guide);
  assert.notEqual(entry, null, `docs/extension-guide.md has an entry for ${METHOD}, which the contract publishes`);
  assert.ok(entry.includes(published().digest), `the guide's entry for ${METHOD} carries the digest the contract publishes it under, ${published().digest}`);
  const made = generate({ from: root });
  assert.equal(made.status, 0, `node scripts/guide.mjs writes the guide; it gave:\n${show(made)}`);
  assert.equal(guide === made.text, true, `docs/extension-guide.md is what node scripts/guide.mjs writes now, byte for byte (run it and commit the guide); the entry it writes for ${METHOD}:\n${entryOf(made.text ?? '')}\nthe guide's:\n${entry}`);
}

/** The four of #351's guide.test.ts cases that run the drift test (the other two build and run the examples; README). */
export const DRIFT_CASES = 'AC1 (the guide is generated|a method the contract|a slot the contract|a guide entry for)';
/** Runs #351's guide.test.ts cases whose full name matches, as its README runs them; each case with its state. */
export function run351(pattern = DRIFT_CASES) {
  const report = join(tempDir('report'), 'report.json');
  const r = run(REPO, ['node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/351', 'guide.test.ts', '-t', pattern, '--reporter=json', `--outputFile=${report}`]);
  const files = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')).testResults : [];
  const cases = files.flatMap((f) => f.assertionResults.map((a) => ({ name: a.title, state: a.status, why: (a.failureMessages ?? []).join('\n') })));
  return { ...r, cases, loadErrors: files.filter((f) => f.status === 'failed' && f.message).map((f) => f.message) };
}
