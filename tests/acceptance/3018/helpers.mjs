// Helpers for #3018's acceptance tests. Written blind from issue #3018, AGENTS.md (Proof) and docs/parallel-proof.md
// sections 6 and 6a, at base b8056599c. Nothing here imports the code under test: this checkout's real scripts/ run in
// a scratch git repository made by #1115's tree(), whose `origin` is a bare repository of the sandbox's holding
// refs/heads/main and each planted PR's refs/pull/<n>/head, with a HOME, a TMPDIR and a throttle table of the test's
// own (README: The setup).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHECKOUT, dump, gitIn, idOf, nodeFile, sandbox as sandbox1115, timedPath, tree, write } from '../1115/helpers.mjs';

export { dump, idOf, nodeFile, timedPath };

/** How long one train or affected.mjs run is given: the fixture's tests take seconds, but the machine may be loaded. */
export const RUN_MS = 10 * 60_000;
/** A test's own limit: up to two runs and a few readings. */
export const TEST = { timeout: 2 * RUN_MS + 10 * 60_000 };

export const ALPHA = { lib: 'packages/alpha/lib/index.mjs', test: 'packages/alpha/test/alpha.test.mjs' };
export const BETA = { lib: 'packages/beta/lib/index.mjs', test: 'packages/beta/test/beta.test.mjs' };
/** A package's one source file: sound, or not, with a line naming who wrote it. */
export const lib = (sound, by = 'main') => `// written by ${by}\nexport const sound = () => ${sound};\n`;

/**
 * A planted node --test file: it imports `from` (its package's lib), notes that it started and the tree of the
 * checkout it ran in, and passes while the lib is sound.
 */
export const planted = (file, from = '../lib/index.mjs') => `import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sound } from '${from}';

const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: dirname(fileURLToPath(import.meta.url)), encoding: 'utf8' }).stdout.trim();
if (process.env.T3018_NOTES) appendFileSync(process.env.T3018_NOTES, JSON.stringify({ file: ${JSON.stringify(file)}, tree, sound: sound(), pid: process.pid }) + '\\n');

test('the planted package is sound', () => { assert.equal(sound(), true); });
`;

// scripts/affected.mjs behind a recording shim, as #2574 puts throttle.mjs behind one: each `node scripts/affected.mjs`
// command line is noted with the checkout's branch, commit and tree, then the real script runs with the same
// arguments. The real one starts itself again under its test grant by its own path, so only command lines from
// outside are noted. Its exports pass through, for a caller that imports the selection.
const AFFECTED_SHIM = `import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export * from './affected-real.mjs';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const git = (...rest) => spawnSync('git', rest, { encoding: 'utf8' }).stdout.trim();
  if (process.env.T3018_CALLS) appendFileSync(process.env.T3018_CALLS, JSON.stringify({ args, branch: git('rev-parse', '--abbrev-ref', 'HEAD'), head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), pid: process.pid }) + '\\n');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./affected-real.mjs', import.meta.url)), ...args], { stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  process.on('SIGINT', () => {});
  process.exitCode = await new Promise((done) => child.on('close', (code, signal) => done(code ?? (signal ? 128 : 1))));
}
`;

/**
 * #1115's sandbox (a HOME of its own, removed after the test, every process it started stopped by its group's PID),
 * with a throttle table of its own under DEEP_THROTTLE_TABLE, read only under this `node --test` run, and none of the
 * variables that would change how an affected.mjs run queues or shards.
 */
export function sandbox(t) {
  const box = sandbox1115(t);
  for (const name of Object.keys(box.env)) if (/^(?:DEEP_(?:SHARDS|TEST_GRANT_WAIT|TEST_SHARD_FLOOR|BIN_DIR|AFFECTED_HELD|THROTTLE_READINGS|JOB_IDLE_MIN)|GIT_.*)$/.test(name)) delete box.env[name];
  box.table = join(box.dir, 'throttle');
  box.env.DEEP_THROTTLE_TABLE = box.table;
  return box;
}

/**
 * The scratch checkout and its origin. main holds #1115's tree (this checkout's scripts/ with the lint lane's own
 * scripts stubbed, affected.mjs behind the recording shim, links to node_modules, a cargo stub on PATH that reports no
 * crate), two tiny packages, alpha and beta, each one lib file and one planted test that imports it, and `files`.
 * The checkout is on `main` at origin's refs/heads/main, clean, with a fixture identity in its own config.
 *
 * pr(n, files) commits `files` on top of `onto` (main by default) in another clone and pushes the commit as origin's
 * refs/pull/<n>/head; moveMain(files) pushes a new commit to origin's refs/heads/main. Both return the commit.
 */
export function fixture(box, { files = {}, failures = {} } = {}) {
  const fx = tree(box, {
    'scripts/affected-real.mjs': readFileSync(join(CHECKOUT, 'scripts/affected.mjs'), 'utf8'),
    'scripts/affected.mjs': AFFECTED_SHIM,
    [ALPHA.lib]: lib(true),
    [ALPHA.test]: planted(ALPHA.test),
    [BETA.lib]: lib(true),
    [BETA.test]: planted(BETA.test),
    ...files,
  }, { failures });
  const git = gitIn(fx.cwd);
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  const origin = join(box.dir, 'origin.git');
  gitIn(box.dir)('init', '-q', '--bare', '-b', 'main', origin);
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main:refs/heads/main');
  git('fetch', '-q', 'origin');
  const main = git('rev-parse', 'HEAD').trim();
  const author = join(box.dir, 'author');
  gitIn(box.dir)('clone', '-q', origin, author);
  const write1 = gitIn(author);
  const commit = (onto, changes, message) => {
    write1('checkout', '-q', '--detach', onto);
    write(author, changes);
    write1('add', '-A');
    write1('commit', '-qm', message);
    return write1('rev-parse', 'HEAD').trim();
  };
  const tmp = join(box.dir, 'tmp');
  mkdirSync(tmp);
  const env = {
    ...fx.env, TMPDIR: tmp, T3018_NOTES: join(box.dir, 'notes.jsonl'), T3018_CALLS: join(box.dir, 'calls.jsonl'),
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  return {
    cwd: fx.cwd, env, git, origin, main,
    pr(number, changes, onto = main) {
      const head = commit(onto, changes, `A planted change for PR ${number}`);
      write1('push', '-q', '-f', 'origin', `${head}:refs/pull/${number}/head`);
      return head;
    },
    moveMain(changes) {
      const head = commit(main, changes, 'main moves');
      write1('push', '-q', 'origin', `${head}:refs/heads/main`);
      return head;
    },
    /** The tree of `heads` merged in that order onto main, made in the other clone. */
    merged(...heads) {
      write1('checkout', '-q', '--detach', main);
      for (const head of heads) write1('merge', '-q', '--no-ff', '-m', 'the train', head);
      return write1('rev-parse', 'HEAD^{tree}').trim();
    },
    /** Where the checkout is: its branch, commit, uncommitted changes and train branches. */
    where: () => ({ branch: git('rev-parse', '--abbrev-ref', 'HEAD').trim(), head: git('rev-parse', 'HEAD').trim(), changes: git('status', '--porcelain').trim(), trains: git('branch', '--list', 'train/*').trim() }),
  };
}

/** `node ...argv` in the checkout, in its own process group; resolves with its result, or fails at RUN_MS. */
export async function node(box, fx, argv) {
  const child = spawn(process.execPath, argv, { cwd: fx.cwd, env: { ...box.env, ...fx.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '', timer;
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
  const result = await Promise.race([done, new Promise((resolve) => { timer = setTimeout(() => resolve(null), RUN_MS); })]);
  clearTimeout(timer);
  assert.ok(result, `node ${argv.join(' ')} did not end within ${RUN_MS / 60_000} min\nstdout so far:\n${stdout.slice(-3_000)}`);
  return result;
}
/** `node scripts/train.mjs <args>` in the checkout (docs/parallel-proof.md, section 6a). */
export const train = (box, fx, ...args) => node(box, fx, ['scripts/train.mjs', ...args]);

const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
}) : []);
/** The planted tests' notes: one for each time a planted file started. */
export const notes = (fx) => lines(fx.env.T3018_NOTES);
/** Each `node scripts/affected.mjs` command line that ran something: those with --list only print a selection. */
export const affectedRuns = (fx) => lines(fx.env.T3018_CALLS).filter(({ args }) => !args.includes('--list'));
/** The sandbox table's `log`, in order. */
export const throttleLog = (box) => lines(join(box.table, 'log'));
export const granted = (box) => throttleLog(box).filter((e) => e.event === 'granted');

/** Every file under the sandbox's ~/.deepbuild/trains/. */
export function recordFiles(box) {
  const folder = join(box.home, '.deepbuild', 'trains');
  return existsSync(folder) ? readdirSync(folder).map((name) => join(folder, name)) : [];
}

// The TIMED line lists the real timed files, so it is left out to keep the run's own lines in a message.
const brief = (run) => ({ ...run, stdout: run.stdout.split('\n').filter((line) => !line.startsWith('TIMED ')).join('\n') });
/** Everything a failure message shows: the runs, the table's log, the affected.mjs command lines and the notes. */
export const evidence = (box, fx, ...runs) => `${dump(...runs.map(brief))}\nrecords under ~/.deepbuild/trains: ${recordFiles(box).join(' ') || 'none'}\nthrottle log:\n${throttleLog(box).map((e) => JSON.stringify(e)).join('\n')}\naffected.mjs command lines:\n${lines(fx.env.T3018_CALLS).map((e) => JSON.stringify(e)).join('\n')}\nplanted tests' notes:\n${notes(fx).map((e) => JSON.stringify(e)).join('\n')}`;

/**
 * The train's record, found by the run's RECORD line: the path it names, which must be the sandbox's
 * ~/.deepbuild/trains/<tree>.json, and the JSON it holds.
 */
export function recordOf(box, run, all) {
  const line = run.stdout.split('\n').find((text) => /^RECORD\b/.test(text));
  assert.ok(line, `the train printed no RECORD line, so it left no record\n${all}`);
  const named = line.match(/(?:~|\/)\S*\.json/)?.[0];
  assert.ok(named, `the RECORD line names no .json file: ${line}\n${all}`);
  const path = named.startsWith('~') ? join(box.home, named.slice(1)) : named;
  assert.ok(existsSync(path), `the RECORD line names ${path}, which doesn't exist\n${all}`);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(realpathSync(dirname(path)), join(box.home, '.deepbuild', 'trains'), `the record is not under ~/.deepbuild/trains/\n${all}`);
  assert.equal(path.split('/').at(-1), `${record.tree}.json`, `the record is not named by its train tree\n${all}`);
  return { path, record };
}

/** A record's PRs as { number, head } with the number a number, in the record's order. */
export const prsOf = (record) => (record.prs ?? []).map(({ number, head }) => ({ number: Number(number), head }));
/** A record's or a results file's files as { file, state }, sorted by file. */
export const statesOf = (files) => (files ?? []).map(({ file, state }) => ({ file, state })).sort((a, b) => a.file.localeCompare(b.file));
/** The PRs a record's file names, as sorted numbers; null when the record has no such file. */
export function namedBy(record, file) {
  const entry = (record.files ?? []).find((each) => each.file === file);
  return entry ? (entry.prs ?? []).map(Number).sort((a, b) => a - b) : null;
}

/**
 * The per-PR lines of an output, `<STATE> #<n> <head>[: <why>]`, the last one for each PR, by number. A head may be
 * printed short: it must be the start of a commit, which the tests check with startsWith.
 */
export function prLines(stdout) {
  const found = new Map();
  for (const line of stdout.split('\n')) {
    const [, state, number, head, why] = line.match(/^(PASS|NO NEW FAILURES|FAIL|INCONCLUSIVE|BLOCKED|INVALID) #(\d+) ([0-9a-f]{7,40})(?:: (.*))?$/) ?? [];
    if (state) found.set(Number(number), { state, head, why: why ?? '', line });
  }
  return found;
}
/** Asserts PR `number`'s line reads `state` for the pinned `head`, and returns what follows the colon. */
export function reads(stdout, number, state, head, all) {
  const line = prLines(stdout).get(number);
  assert.ok(line, `no line reads "<STATE> #${number} <head>"\n${all}`);
  assert.equal(line.state, state, `#${number} reads "${line.line}", not ${state}\n${all}`);
  assert.ok(head.startsWith(line.head), `#${number}'s line names the head ${line.head}, not the pinned ${head}\n${all}`);
  return line.why;
}
/** Asserts `why` reads `<label> moved from <from> to <to>`, each commit whole or short. */
export function moved(why, label, from, to, all) {
  const [, a, b] = why.match(RegExp(`^${label} moved from ([0-9a-f]{7,40}) to ([0-9a-f]{7,40})$`)) ?? [];
  assert.ok(a && from.startsWith(a) && to.startsWith(b), `the line's reason is "${why}", not "${label} moved from ${from} to ${to}"\n${all}`);
}
