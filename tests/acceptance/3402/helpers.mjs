// Helpers for #3402's acceptance tests: suite files run as children with `node --test` in this checkout, files hashed,
// the lanes' lists read through scripts/lanes.mjs, and the stand-ins the criteria call "a planted finder" and "a
// planted reading". What a criterion says of "main's design" and of the record "as main holds it" is read from the base
// commit these tests were drafted on, through git, so a later approved edit of the design can't change it. Only
// firstDraftsOnBase writes, in a temporary folder outside the checkout that it removes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { headings, sectionOf } from '../1352-redraft-3402/helpers.mjs';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const ORIGINAL = 'tests/acceptance/1352/';
export const REDRAFT = 'tests/acceptance/1352-redraft-3402/';
/** The base commit #1352's first draft reads with `git show` and `git grep`. */
export const OLD_BASE = '6aa228ce';
/** The base commit these tests were drafted on: main as the issue describes it, "main's design" and "as main holds it". */
export const BASE = 'c602159529308760c78feecb629bbdd542a4e795';
export const DESIGN = 'docs/technical-design.md';
export const RECORD = 'docs/evidence/1352/taste-call.json';

const git = (args, options = {}) => spawnSync('git', args, { cwd: CHECKOUT, maxBuffer: 1 << 28, ...options });
/** A file's bytes at the base commit, by its repo path; null when git can't read it here. */
export function baseBytes(path) {
  const r = git(['show', `${BASE}:${path}`]);
  return r.status === 0 && r.stdout.length > 0 ? r.stdout : null;
}
/** Why the base commit can't be read here, or null: a test that needs it then skips, never passes. */
export function baseMissing() {
  return baseBytes(DESIGN) && baseBytes(RECORD) ? null : `INCONCLUSIVE: this checkout can't read the base commit ${BASE.slice(0, 9)} with git, where these tests read main's design and record`;
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const REPORTER = pathToFileURL(fileURLToPath(new URL('./reporter.mjs', import.meta.url))).href;
// A child's own `node --test` must not report to this runner.
const childEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
};

/**
 * Runs test files (repo paths) with `node --test`, as they are, in this checkout or in the tree at `cwd`. Returns the exit status, each test's
 * result (reporter.mjs) and the stderr. A file that can't be loaded is reported by node as a failed test named by it.
 */
export function runFiles(files, { cwd = CHECKOUT, env = {} } = {}) {
  const r = spawnSync(process.execPath, ['--test', `--test-reporter=${REPORTER}`, '--test-reporter-destination=stdout', ...files],
    { cwd, env: { ...childEnv(), ...env }, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600_000 });
  const tests = (r.stdout ?? '').split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
  return { status: r.status, tests, stderr: `${r.stderr ?? ''}${r.error ? r.error.message : ''}` };
}
/** A run's tests as lines a failure message can show: how each ended, its name, and why it failed. */
export const shown = (tests) => tests.map((t) => `${t.skipped ? 'skipped' : t.passed ? 'passed' : 'FAILED'}: ${t.name}${t.passed ? '' : `\n    ${t.message}${t.actual ? `\n    ${t.actual.join('\n    ')}` : ''}`}`).join('\n');

/**
 * Why #1352's first-draft files can't be judged here, or null: they read the old base with `git show` and `git grep`
 * from this checkout, so it must be a git checkout that holds that commit.
 */
export function oldBaseMissing() {
  const r = spawnSync('git', ['show', `${OLD_BASE}:docs/technical-design.md`], { cwd: CHECKOUT, encoding: 'utf8', maxBuffer: 1 << 28 });
  return r.status === 0 && r.stdout.length > 0 ? null : `INCONCLUSIVE: this checkout can't read #1352's base commit ${OLD_BASE} with git, which #1352's first-draft tests need: ${`${r.error?.message ?? ''}${r.stderr ?? ''}`.trim().split('\n')[0]}`;
}

/**
 * #1352's first-draft files `names`, as this checkout holds them, run on the design and the record as the base commit
 * holds them: in a temporary tree outside the checkout that holds only those files, their helpers, the base's design
 * and the base's record, with git pointed at this checkout's objects for the first draft's own `git show`. The tree
 * is removed. Returns runFiles' result.
 */
export function firstDraftsOnBase(names) {
  const tree = mkdtempSync(join(tmpdir(), 'deep-3402-first-drafts-'));
  try {
    const put = (path, bytes) => { mkdirSync(dirname(join(tree, path)), { recursive: true }); writeFileSync(join(tree, path), bytes); };
    for (const path of [DESIGN, RECORD]) put(path, baseBytes(path));
    for (const name of ['helpers.mjs', ...names]) { mkdirSync(join(tree, ORIGINAL), { recursive: true }); cpSync(join(CHECKOUT, ORIGINAL, name), join(tree, ORIGINAL, name)); }
    const gitDir = git(['rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).stdout.trim();
    return runFiles(names.map((name) => `${ORIGINAL}${name}`), { cwd: tree, env: { GIT_DIR: gitDir } });
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

/** A file's SHA-256, by its repo path; null when it isn't there. */
export const sha256Of = (path) => (existsSync(join(CHECKOUT, path)) ? createHash('sha256').update(readFileSync(join(CHECKOUT, path))).digest('hex') : null);

/** The lanes' lists, read through the public entry, scripts/lanes.mjs, in a child: each list by its name, or { error }. */
export function laneLists() {
  const code = `const { byHand, redrafted, ownLane, timed, slow, alone, exclusive } = await import(${JSON.stringify(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href)}); console.log(JSON.stringify({ byHand, redrafted, ownLane, timed, slow, alone, exclusive }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: CHECKOUT, env: childEnv(), encoding: 'utf8', maxBuffer: 1 << 28 });
  try {
    return JSON.parse(r.stdout.trim().split('\n').at(-1));
  } catch {
    return { error: `scripts/lanes.mjs gave no lists: ${`${r.stderr ?? ''}${r.error ? r.error.message : ''}`.trim().split('\n')[0]}` };
  }
}
/** Whether a lanes list names a file: by its path, or by a folder ending in / that holds it (scripts/lanes.mjs, `listed`). */
export const listed = (list, file) => list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

// The planted finder (criterion 2): #1352's first-draft rule, the one heading whose text holds the word "hub" and the
// word "cloud" or "hosted". Where the first draft throws on several, this gives the same sentence as its problem.
export const holdsTheWords = (text) => /\bhub\b/i.test(text) && /\b(?:cloud|hosted)\b/i.test(text);
export function findByWords(text) {
  const { lines, found } = headings(text);
  const matches = found.filter((h) => holdsTheWords(h.text));
  if (matches.length > 1) return { problem: `more than one heading holds "hub" and "cloud" or "hosted": ${matches.map((h) => `"${h.text}"`).join(', ')}` };
  if (!matches.length) return { problem: 'docs/technical-design.md has no heading holding the words "hub" and "cloud" or "hosted", so it has no section for a hub of your own in the cloud' };
  return { section: sectionOf(lines, found, matches[0]) };
}

// The planted reading (criterion 3): #1352's first-draft reading, the rows under the heading slugged `decided`
// (`### Decided`) alone, up to the next heading of its level or higher.
export function readDecidedAlone(text) {
  const { lines, found } = headings(text);
  const h = found.find((o) => o.slug === 'decided');
  if (!h) return { problem: 'the design has no heading slugged "decided"' };
  const rule = /^\|[\s:|-]+\|?\s*$/, body = sectionOf(lines, found, h).body.split('\n'), rows = [];
  for (let i = 0; i < body.length; i++) {
    if (!body[i].trim().startsWith('|') || rule.test(body[i].trim())) continue;
    if (body[i + 1] && rule.test(body[i + 1].trim())) continue; // a header
    rows.push({ heading: h.text, row: body[i] });
  }
  return { rows };
}
