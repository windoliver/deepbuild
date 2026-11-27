// Shared by #3422's acceptance tests (README: Surfaces). The size ratchet is reached only through the lint lane's
// command for it, taken from scripts/lanes.mjs's exported `checks` and run as a process with cwd at the tree it checks:
// this checkout, read-only, a scratch git repository, or a mirror of this checkout that holds the merge base's ratchet.
// Scratch repositories and mirrors live under the realpathed system temporary folder and are removed in t.after.
// Nothing here writes into this checkout, and no message prints a local path.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checks } from '../../../scripts/lanes.mjs';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

/** Each criterion's ID: `#3422.` and the first 8 hex digits of the SHA-256 of its text from the issue, trimmed, with
 * white space collapsed (`criterionId` in scripts/proof-change.mjs). */
export const FIX = '#3422.df5e60b4';
export const SAME = '#3422.2c41ea06';

export const SCRIPT = 'scripts/size-ratchet.mjs';
export const CEILINGS = 'scripts/size-ceilings.json';

const lint = checks.find(({ name }) => name === 'lint');

/** The lint lane's command for the ratchet; the test fails here when the lane has none. */
export function ratchetCommand() {
  const found = lint?.commands.find((candidate) => [process.execPath, 'node'].includes(candidate[0]) && candidate[1] === SCRIPT);
  assert.ok(found, `the lint lane runs no ${SCRIPT}`);
  return found;
}

/** The environment without git's repository variables, so a scratch repository's git never reaches another one. */
const scrubbed = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));

/**
 * Runs the lane's ratchet command with cwd at `cwd` (a scratch repository or a mirror unless it is `root`). A run that
 * is stopped or can't start is INCONCLUSIVE, never a verdict.
 */
export function ratchet(cwd, env = cwd === root ? process.env : scrubbed()) {
  const [program, ...args] = ratchetCommand();
  // deadline: turns a hung ratchet into a failure of this test; nothing waits on it to pass
  const result = spawnSync(program === 'node' ? process.execPath : program, args, { cwd, env, encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 28 });
  if (result.error || result.signal) throw new Error(`INCONCLUSIVE: ${SCRIPT} didn't finish (${result.error?.code ?? result.signal})`);
  const stdout = result.stdout ?? '';
  return { status: result.status, stdout, lines: stdout.split('\n') };
}

const STATE = /^(?:PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/;
const FINDING = /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE) /;

/** The path a finding's line starts with, after `<STATE> size: `. */
export const pathOf = (line) => line.replace(/^\S+ \S+: /, '').split(/[: ]/)[0];

/**
 * A run's findings: each line in a state that fails a run, as { path, reason, fix }. The reason is that line whole.
 * The fix is what stands under it up to the next line in a state, joined with single spaces; '' when nothing does.
 */
export function findings(result) {
  const found = [];
  for (const line of result.lines) {
    if (FINDING.test(line)) found.push({ path: pathOf(line), reason: line, fix: [] });
    else if (STATE.test(line)) found.push(null);
    else if (line.trim() && found.at(-1)) found.at(-1).fix.push(line.trim());
  }
  return found.filter(Boolean).map((finding) => ({ ...finding, fix: finding.fix.join(' ') }));
}

/** A run's output for a failure message: its first `max` lines, blank ones left out. */
export function show(result, max = 40) {
  const lines = result.lines.filter(Boolean);
  return `exit ${result.status}; ${lines.length} lines${lines.length > max ? `, the first ${max}` : ''}:\n${lines.slice(0, max).join('\n')}`;
}

/** A run that gave a verdict: exit 0 with a PASS line and no finding, or exit 1 with a finding. Anything else, such as
 * a crash or a silent exit, is no reading of the tree, and nothing is compared with it. */
export function assertVerdict(result, whose) {
  const found = findings(result), passed = result.lines.some((line) => line.startsWith('PASS '));
  assert.ok((result.status === 0 && passed && !found.length) || (result.status === 1 && found.length && !passed), `${whose} gave no verdict: it neither passed with a PASS line and exit 0 nor failed with a finding and exit 1\n${show(result)}`);
}

/** A pass: exit 0, a PASS size line, and no line in a failing state (a silent exit 0 is not a pass). */
export function assertPasses(result, why) {
  assert.equal(result.status, 0, `${why}\n${show(result)}`);
  assert.ok(result.lines.some((line) => line.startsWith('PASS size')), `no PASS size line ${why}\n${show(result)}`);
  assert.deepEqual(findings(result), [], `${why}\n${show(result)}`);
}

/** A whole number as a line may print it, with or without a thousands comma: 1601 or 1,601. */
const number = (n) => new RegExp(`(?<![\\d,])${String(n).replace(/\B(?=(\d{3})+$)/g, ',?')}(?!,?\\d)`);

/** The one finding naming `path`, a FAIL whose line holds each of `numbers` after the path; the test fails without it. */
export function failOf(result, path, numbers, what) {
  assert.equal(result.status, 1, `${what}, so the ratchet exits 1\n${show(result)}`);
  const named = findings(result).filter((finding) => finding.path === path);
  assert.equal(named.length, 1, `one finding names ${path}: ${what}\n${show(result)}`);
  const after = named[0].reason.slice(named[0].reason.indexOf(path) + path.length);
  assert.ok(named[0].reason.startsWith('FAIL ') && numbers.every((n) => number(n).test(after)), `the finding naming ${path} is no FAIL line holding ${numbers.join(' and ')}: ${what}\n${show(result)}`);
  return named[0];
}

/**
 * What the criterion and Scope ask of the Fix line for a file over its limit or its ceiling (README: The wording
 * rule), each with the pattern that reads it, letter case ignored.
 */
export const ADVICE = [
  ['to move', /\bmove\b/i],
  ['one named concept', /\bone named concept\b/i],
  ['to a file of its own', /\bfile of its own\b|\bits own file\b|\bnew file\b/i],
  ['to import', /\bimport(?:s|ed|ing)?\b/i],
  ['by name', /\bby name\b/i],
];

/** The parts of the advice `fix` doesn't say. */
export const missing = (fix) => ADVICE.filter(([, pattern]) => !pattern.test(fix)).map(([part]) => part);

/** The Fix line under `finding` says how: every part of the advice. On the merge base it says only to split or shrink. */
export function assertSaysHow(finding, what) {
  assert.match(finding.fix, /^Fix: \S/, `no Fix line stands under the finding for ${what}:\n${finding.reason}`);
  assert.deepEqual(missing(finding.fix), [], `the Fix line for ${what} doesn't say how, as the issue asks: move one named concept to a file of its own, which imports what it needs by name\n${finding.reason}\n  ${finding.fix}`);
}

/** The Fix line under `finding`, which asks for no split, keeps to its own remedy: none of the advice's words. */
export function assertNoAdvice(finding, what) {
  assert.match(finding.fix, /^Fix: \S/, `no Fix line stands under the finding for ${what}:\n${finding.reason}`);
  assert.ok(!/\bconcept\b|\bby name\b|\bfile of its own\b/i.test(finding.fix), `the Fix line for ${what} holds the advice for splitting a file, which this finding doesn't ask for (Scope: "Nothing else")\n${finding.reason}\n  ${finding.fix}`);
}

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, env: cwd === root ? process.env : scrubbed(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });

/** Writes `content` at `path` in the scratch repository, as an uncommitted edit or an untracked file. */
export function put(cwd, path, content) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

const temporary = (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3422-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

/**
 * A scratch git repository, as #1432's and #3139's suites make theirs: a copy of this checkout's scripts/, which
 * .git/info/exclude hides from git's listing, and `files`, committed with origin/main at that commit, so the merge
 * base is that commit. The ceilings file is force-added, since it sits in the hidden folder.
 */
export function scratch(t, files) {
  const cwd = temporary(t);
  git(cwd, 'init', '-q');
  mkdirSync(join(cwd, '.git', 'info'), { recursive: true });
  writeFileSync(join(cwd, '.git', 'info', 'exclude'), '/scripts/\n');
  cpSync(join(root, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  for (const [path, content] of Object.entries(files)) put(cwd, path, content);
  git(cwd, 'add', '-A');
  git(cwd, 'add', '-f', CEILINGS);
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** `count` lines of Rust, each a line of code, so no counter skips one as blank or comment. */
export const rust = (count) => Array.from({ length: count }, (_, i) => `pub const C${String(i + 1).padStart(4, '0')}: u32 = ${i + 1};\n`).join('');

/**
 * The ratchet as the merge base of this checkout's HEAD with origin/main holds it: its text, read from git. With no
 * origin/main, no merge base or no ratchet there, there is no "before" to compare with: BLOCKED, never a pass.
 */
export function baseScript() {
  let at;
  try {
    at = git(root, 'merge-base', 'HEAD', 'origin/main').trim();
  } catch (error) {
    throw new Error(`BLOCKED: this checkout has no merge base of HEAD with origin/main to read the ratchet from (${String(error.stderr || error.message).trim().split('\n')[0]})`);
  }
  try {
    return { at, text: git(root, 'show', `${at}:${SCRIPT}`) };
  } catch {
    throw new Error(`BLOCKED: the merge base ${at.slice(0, 9)} holds no ${SCRIPT}`);
  }
}

/**
 * The merge base's ratchet run over this checkout's tree. The ratchet takes its root from its own place, the folder
 * above scripts/, so it runs from a mirror: a temporary folder whose entries link to this checkout's, but for a
 * scripts/ of its own, whose entries link to this checkout's but for the ratchet, which is the merge base's. Its git
 * commands read this checkout through GIT_DIR and GIT_WORK_TREE, so they list this work tree's files, and each file
 * is read through the mirror's links. Nothing is written in this checkout.
 */
export function ratchetBefore(t) {
  const mirror = temporary(t);
  for (const name of readdirSync(root)) if (name !== 'scripts' && name !== '.git') symlinkSync(join(root, name), join(mirror, name));
  mkdirSync(join(mirror, 'scripts'));
  for (const name of readdirSync(join(root, 'scripts'))) if (`scripts/${name}` !== SCRIPT) symlinkSync(join(root, 'scripts', name), join(mirror, 'scripts', name));
  writeFileSync(join(mirror, SCRIPT), baseScript().text);
  return ratchet(mirror, { ...process.env, GIT_DIR: git(root, 'rev-parse', '--absolute-git-dir').trim(), GIT_WORK_TREE: root });
}

/**
 * How the findings after differ from those before: one line per path with a finding that appears, goes or changes its
 * reason, naming the path. A reason is the finding's line; the Fix line under it is no part of it.
 */
export function differences(before, after) {
  const byPath = (result) => {
    const map = new Map();
    for (const { path, reason } of findings(result)) map.set(path, [...(map.get(path) ?? []), reason].sort());
    return map;
  };
  const was = byPath(before), is = byPath(after);
  const lines = [];
  for (const path of [...new Set([...was.keys(), ...is.keys()])].sort()) {
    if (!was.has(path)) lines.push(`${path}: a finding appears: ${is.get(path).join(' | ')}`);
    else if (!is.has(path)) lines.push(`${path}: a finding goes: ${was.get(path).join(' | ')}`);
    else if (was.get(path).join('\n') !== is.get(path).join('\n')) lines.push(`${path}: its reason changes, from: ${was.get(path).join(' | ')} to: ${is.get(path).join(' | ')}`);
  }
  return lines;
}

/** Before and after are the same paths with the same reasons, the same exit and the same PASS line. */
export function assertSameFindings(before, after, where) {
  assertVerdict(before, `the merge base's ratchet ${where}`);
  assertVerdict(after, `this checkout's ratchet ${where}`);
  const changed = differences(before, after);
  assert.deepEqual(changed, [], `${where} the ratchet's findings differ from the merge base's ratchet's, at ${changed.length} path${changed.length === 1 ? '' : 's'}:\n${changed.join('\n')}`);
  assert.equal(after.status, before.status, `${where} the ratchet's exit differs from the merge base's ratchet's, with the same findings`);
  const pass = (result) => result.lines.filter((line) => line.startsWith('PASS '));
  assert.deepEqual(pass(after), pass(before), `${where} the ratchet's PASS line differs from the merge base's ratchet's`);
}
