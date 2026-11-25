// Helpers for #3297's acceptance tests (README). Each scene is a fixture repository of its own in a temp folder, holding
// a copy of this checkout's scripts/ and a few probe test files at places the lane lists name, and `scripts/preflight` is
// run there as a person runs it. Nothing of the machine's is read or written: HOME, TMPDIR and the throttle's table are
// the scene's, and a run is started only inside node --test, which is what lets a request keep a table of its own
// (docs/parallel-proof.md, section 6). Every process is stopped by its PID and start time, never by name or port.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const lists = await import(join(CHECKOUT, 'scripts/lanes.mjs'));
const { alone, byHand, exclusive, listed, ownLane, slow, timed } = lists;

// The probes' places, by the lists a fixture's own copy of scripts/ holds. A folder a suite's lane.json adds isn't alone
// in a fixture, which has no lane.json, so only the lists' own folders are taken.
const own = (file) => !existsSync(join(CHECKOUT, dirname(file), 'lane.json'));
const elsewhere = (file) => [slow, byHand, ownLane, exclusive].some((list) => listed(list, file)) || /\.(?:live|long)\.test\./.test(file);
const FOLDERS = alone.filter((entry) => /^tests\/acceptance\/\d+\/$/.test(entry) && own(`${entry}a.test.ts`) && !elsewhere(`${entry}a.test.ts`) && !listed(timed, `${entry}a.test.ts`)).slice(0, 8);
const plain = timed.filter((file) => /^tests\/acceptance\/\d+\/[\w-]+\.test\.ts$/.test(file) && own(file) && !elsewhere(file) && !FOLDERS.includes(`${dirname(file)}/`));
const inAlone = plain.filter((file) => listed(alone, file));
const TIMED_ALONE = inAlone.filter((file, at) => inAlone.findIndex((other) => dirname(other) === dirname(file)) === at);
const TIMED_PARALLEL = plain.filter((file) => !listed(alone, file));
const TIMED_NODE = timed.filter((file) => /^tests\/[\w-]+\.test\.mjs$/.test(file));
const place = (found, at, what) => {
  assert.ok(found[at], `lanes.mjs's lists name ${found.length} ${what}, so a probe has no place ${at}`);
  return found[at];
};
/** Group `k`'s file `name`: in the k-th folder the unit lane runs alone, so each k is a group (one turn's files) of its own. */
export const aloneFile = (k, name) => `${place(FOLDERS, k, 'folders that are alone')}${name}.test.ts`;
export const parallelFile = (name) => `tests/${name}.test.ts`;
export const nodeFile = (name) => `tests/${name}.test.mjs`;
// The lane's timed files, which `timed` names, by the command of the lane that lists them.
/** The k-th timed file of the alone block, each in a folder of its own. */
export const timedAloneFile = (k) => place(TIMED_ALONE, k, 'timed files of the alone block');
/** The k-th timed file the parallel block lists. */
export const timedParallelFile = (k) => place(TIMED_PARALLEL, k, 'timed files of the parallel block');
/** The k-th timed file `node --test` lists. */
export const timedNodeFile = (k) => place(TIMED_NODE, k, 'timed files of node --test');

// What a probe does, read at its start from the scene's state folder, never from the tree: so a probe can fail once and
// pass after, on one tree. `one` always passes; `two` does what the flags say. It notes its start when its file is
// loaded, which is once a run, and its end after its last test, each with the time and the grants the throttle's table
// holds then.
const prelude = (name) => `import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const NAME = ${JSON.stringify(name)};
const EVENTS = process.env.T3297_EVENTS ?? '', STATE = process.env.T3297_STATE ?? '', TABLE = process.env.T3297_TABLE ?? '', REPORT = process.env.DEEP_PROOF_VITEST_REPORT ?? '';
const grants = () => { try { return JSON.parse(readFileSync(join(TABLE, 'table.json'), 'utf8')).grants.map(({ class: cls, id, pid }) => ({ class: cls, id, pid })); } catch { return null; } };
const note = (event) => appendFileSync(EVENTS, JSON.stringify({ at: Date.now(), name: NAME, event, cwd: process.cwd(), grants: grants() }) + '\\n');
const flag = (what) => existsSync(join(STATE, NAME + '.' + what));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
// A job is killed only once the row of the test before is in its report, so there is a row to miscount.
const reported = async () => { for (let k = 0; k < 100 && !(existsSync(REPORT) && readFileSync(REPORT, 'utf8').includes('"name":"one"')); k++) await pause(50); };
const killRunner = () => { process.kill(process.ppid, 'SIGKILL'); process.kill(process.pid, 'SIGKILL'); };
const act = async () => {
  while (flag('hold')) await pause(100);
  if (flag('slow')) await pause(Number(readFileSync(join(STATE, NAME + '.slow'), 'utf8')));
  if (flag('kill')) { await reported(); killRunner(); await pause(600_000); }
  if (flag('fail')) throw new Error('a planted failure');
  if (flag('INCONCLUSIVE')) throw new Error('INCONCLUSIVE: a planted reading');
};
note('start');
`;
const vitestProbe = (name) => `${prelude(name)}
import { afterAll, expect, test } from 'vitest';
afterAll(() => note('end'));
test('one', () => { expect(NAME).toBe(${JSON.stringify(name)}); });
test('two', { timeout: 3_600_000 }, act);
`;
const nodeProbe = (name) => `${prelude(name)}
import test, { after } from 'node:test';
after(() => note('end'));
test('one', () => {});
test('two', { timeout: 3_600_000 }, act);
`;
const probe = (file, name) => (file.endsWith('.mjs') ? nodeProbe(name) : vitestProbe(name));

// A lane that isn't the unit lane: one command, which notes each run of it.
const OTHER = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.T3297_EVENTS, JSON.stringify({ at: Date.now(), name: 'other', event: 'start', cwd: process.cwd() }) + '\\n');
`;
// perf's stand-in: it notes that it started, and passes.
const PERF = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.T3297_EVENTS, JSON.stringify({ at: Date.now(), name: 'perf', event: 'start', cwd: process.cwd() }) + '\\n');
`;

// The stand-ins below note the time by node, since a shell has no milliseconds of its own on every machine.
const NOTE = `note() { node -e 'require("node:fs").appendFileSync(process.env.T3297_EVENTS, JSON.stringify({ at: Date.now(), name: process.argv[1], event: process.argv[2], cwd: process.cwd() }) + "\\n")' "$1" "$2"; }`;
// The one library test target the cargo stand-in reports, as cargo prints it.
const CARGO_ROWS = ['cargo -p tiny --lib › tests::one', 'cargo -p tiny --lib › tests::two'];
const CARGO = `#!/bin/sh
# cargo's stand-in: a workspace of one package, whose two tests pass. It notes each run of them.
${NOTE}
case "$1" in
  --version|-V) echo 'cargo 1.99.1 (0000000000 2026-10-01)'; exit 0 ;;
  metadata) cat "$T3297_DIR/metadata.json"; exit 0 ;;
  test) ;;
  *) exit 0 ;;
esac
for arg in "$@"; do
  if [ "$arg" = --no-run ]; then exit 0; fi
  if [ "$arg" = --list ]; then printf '     Running unittests src/lib.rs (target/debug/deps/tiny-0123456789abcdef)\\ntests::one: test\\ntests::two: test\\n\\n2 tests, 0 benchmarks\\n'; exit 0; fi
done
note 'cargo test' start
while [ -e "$T3297_STATE/cargo test.hold" ]; do sleep 0.2; done
printf '     Running unittests src/lib.rs (target/debug/deps/tiny-0123456789abcdef)\\n\\nrunning 2 tests\\ntest tests::one ... ok\\ntest tests::two ... ok\\n\\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\\n'
note 'cargo test' end
`;
const RUSTC = `#!/bin/sh
case "$*" in
  *-vV*|*-Vv*|*--verbose*) printf 'rustc 1.99.1 (0123456789 2026-10-01)\\nbinary: rustc\\nhost: stand-in\\nrelease: 1.99.1\\n' ;;
  *) echo 'rustc 1.99.1 (0123456789 2026-10-01)' ;;
esac
`;
// npm's stand-in: a warm-up build takes as long as the scene's state says, and an install links the checkout's modules.
const NPM = `#!/bin/sh
${NOTE}
case "$1 $2" in
  'run build') note warm start; if [ -e "$T3297_STATE/warm" ]; then sleep "$(cat "$T3297_STATE/warm")"; fi; note warm end ;;
  ci*) if [ ! -e node_modules ]; then ln -s "$T3297_MODULES" node_modules; fi ;;
esac
exit 0
`;
const DEEP = `#!/bin/sh
# deep lease's stand-in: the command runs as it is.
if [ "$1" = lease ]; then shift; if [ "$1" = -- ]; then shift; fi; exec "$@"; fi
exit 0
`;

// The fixture's lanes are a lane of one command and the unit lane, whole; everything else of scripts/ is the checkout's.
const NARROW = `
import * as fixture3297 from './lanes.mjs';
fixture3297.checks.splice(0, fixture3297.checks.length, { name: 'other', commands: [[process.execPath, 'other.mjs']], fix: 'Repair the fixture.' }, fixture3297.checks.find(({ name }) => name === 'unit'));
`;

/** Every process but the dead a parent hasn't read, by pid: its parent, its start, its command line. */
function processes() {
  const listing = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,stat=,lstart=,command='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  if (listing.status !== 0) throw Error(`ps failed: ${listing.stderr}`);
  const table = new Map();
  for (const line of listing.stdout.split('\n')) {
    const [, pid, ppid, stat, start, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/) ?? [];
    if (pid && !stat.startsWith('Z')) table.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), start, command });
  }
  return table;
}
/** Every process under `root`. */
function under(table, root) {
  const found = [];
  for (const proc of table.values()) {
    const seen = new Set();
    for (let at = proc.ppid; table.has(at) && !seen.has(at); at = table.get(at).ppid) {
      seen.add(at);
      if (at === root) { found.push(proc); break; }
    }
  }
  return found;
}

// deadline: the step of `until`'s polls, which each end at their event or at their caller's bound.
const step = () => new Promise((done) => setTimeout(done, 100));
/**
 * Waits for `predicate`, at most `seconds` of this process's own steps: a machine asleep or too busy to run this process
 * runs none of them down.
 */
export async function until(predicate, seconds) {
  for (let left = seconds * 10; ; left--) {
    if (predicate()) return true;
    if (left <= 0) return false;
    await step();
  }
}
// Every scene of the file, ended and removed after its last test; a test run ended by a signal ends what they started too.
const scenes = [];
const stopAll = () => { for (const box of scenes) for (const child of box.children) child.stop(); };
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { stopAll(); process.exit(1); });
after(() => {
  stopAll();
  for (const { dir } of scenes) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

/** The scene's budget, a day: no run here comes near it, and the times the tests plant are past it. */
export const LIMIT = 86_400_000;
// deadline: how long a run may take on a machine at many times its cores' load, after which it is stopped.
const RUN = 900;

const jsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
const parsed = (file) => jsonl(file).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });

/**
 * A fixture repository ready for `scripts/preflight`: `files` maps each test file to its probe's name. With `perf`, the
 * checkout's own perf.mjs runs; without, its stand-in.
 */
export function scene({ files, perf = false, env: more = {} }) {
  // A run outside node --test would ask the machine's own table for timed, and hold every other session's work.
  assert.ok(process.env.NODE_TEST_CONTEXT, 'run this suite under node --test');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3297-')));
  const box = { dir, home: join(dir, 'home'), tree: join(dir, 'tree'), table: join(dir, 'table'), state: join(dir, 'state'), events: join(dir, 'events.jsonl'), files, children: [] };
  scenes.push(box);
  for (const folder of [box.home, box.tree, box.table, box.state, join(dir, 'bin'), join(dir, 'tmp')]) mkdirSync(folder);
  cpSync(join(CHECKOUT, 'scripts'), join(box.tree, 'scripts'), { recursive: true });
  const lanes = join(box.tree, 'scripts/lanes.mjs');
  writeFileSync(lanes, `${readFileSync(lanes, 'utf8')}${NARROW}`);
  box.put = (path, text) => {
    mkdirSync(dirname(join(box.tree, path)), { recursive: true });
    writeFileSync(join(box.tree, path), text);
  };
  box.add = (path, text) => appendFileSync(join(box.tree, path), text);
  if (!perf) box.put('scripts/perf.mjs', PERF);
  box.put('other.mjs', OTHER);
  box.put('scripts/known-failures.json', `${JSON.stringify({ failures: {}, lint: {}, timing: [], skips: [] })}\n`);
  // A margin no machine's load can cross: the workload's times aren't what any of these tests judge.
  box.put('benchmarks/budgets.json', `${JSON.stringify({ preflight: { margin: 1000, limits: { elapsedMs: LIMIT }, initialReason: 'Fixture.' }, tasks: [] })}\n`);
  box.put('package.json', `${JSON.stringify({ name: 'fixture', private: true, type: 'module' })}\n`);
  box.put('package-lock.json', `${JSON.stringify({ name: 'fixture', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture' } } })}\n`);
  // As the repository's own: target/ matches a folder and no link, and some tracked files are under an ignored folder.
  box.put('.gitignore', 'node_modules\ntarget/\ndist/\n');
  box.put('dist/tracked.txt', 'a tracked file an ignore pattern covers, as the repository has\n');
  box.put('vitest.config.ts', `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ${JSON.stringify(lists.testGlobs('ts'))}, maxWorkers: 2 } });
`);
  box.put('Cargo.toml', '[package]\nname = "tiny"\nversion = "0.0.0"\nedition = "2024"\n');
  box.put('src/lib.rs', '');
  for (const [file, name] of Object.entries(files)) box.put(file, probe(file, name));
  symlinkSync(join(CHECKOUT, 'node_modules'), join(box.tree, 'node_modules'));
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({
    packages: [{ name: 'tiny', version: '0.0.0', manifest_path: join(box.tree, 'Cargo.toml'), dependencies: [], targets: [{ name: 'tiny', kind: ['lib'], src_path: join(box.tree, 'src/lib.rs') }] }], workspace_members: [], version: 1,
  }));
  for (const [name, text] of Object.entries({ cargo: CARGO, rustc: RUSTC, npm: NPM, deep: DEEP })) {
    writeFileSync(join(dir, 'bin', name), text);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:DEEP_|DEEPBUILD_|GIT_|CARGO|RUST|VITEST|MAKEFLAGS$|MFLAGS$|NODE_TEST_CONTEXT$|NODE_OPTIONS$|NODE_V8_COVERAGE$)/.test(name)) delete env[name];
  box.env = {
    ...env, HOME: box.home, XDG_CACHE_HOME: join(box.home, '.cache'), TMPDIR: join(dir, 'tmp'), PATH: [join(dir, 'bin'), dirname(process.execPath), process.env.PATH].join(delimiter),
    NODE_OPTIONS: `--import=${new URL('./machine.mjs', import.meta.url).href}`,
    T3297_DIR: dir, T3297_STATE: box.state, T3297_EVENTS: box.events, T3297_TABLE: box.table, T3297_MODULES: join(CHECKOUT, 'node_modules'),
    DEEP_THROTTLE_TABLE: box.table, DEEP_SHARDS: '1', DEEP_TEST_SHARD_FLOOR: '0', ...more,
  };
  box.git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: box.tree, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  box.git('init', '-q', '-b', 'main');
  box.git('add', '-A');
  box.git('add', '-f', 'dist/tracked.txt');
  box.git('commit', '-qm', 'fixture');
  box.git('update-ref', 'refs/remotes/origin/main', 'HEAD');

  /** HEAD's tree. */
  box.hash = () => box.git('rev-parse', 'HEAD^{tree}');
  box.flag = (name, what, text = '') => writeFileSync(join(box.state, `${name}.${what}`), text);
  box.unflag = (name, what) => rmSync(join(box.state, `${name}.${what}`), { force: true });
  /** How long a warm-up build takes from now on, in seconds. */
  box.warmFor = (seconds) => writeFileSync(join(box.state, 'warm'), String(seconds));
  box.notes = () => parsed(box.events);
  box.names = () => [...Object.values(files), 'cargo test'];
  box.fileOf = (name) => Object.keys(files).find((file) => files[file] === name) ?? name;
  /**
   * Every run of a probe's file, of cargo test, of the other lane or of perf, in the scene's checkout and the shards made
   * of it, oldest first: from its start to its end, or to null when it was cut. `where` takes those of other folders.
   */
  box.spans = (name, where = (cwd) => !cwd.startsWith(join(box.home, '.cache'))) => {
    const spans = [];
    for (const note of box.notes().filter((other) => other.name === name && where(other.cwd))) {
      if (note.event === 'start') spans.push({ name, from: note.at, to: null, cwd: note.cwd, grants: note.grants });
      else if (spans.length) spans.at(-1).to = note.at;
    }
    return spans;
  };
  box.counts = () => Object.fromEntries([...box.names(), 'other', 'perf'].map((name) => [name, box.spans(name).length]));
  /** Every test's ID the lane's record should hold, once each. */
  box.ids = () => [...Object.keys(files).flatMap((file) => [`${file} › one`, `${file} › two`]), ...CARGO_ROWS].sort();
  /** The unit lane's record of HEAD's tree. */
  box.record = () => {
    const file = join(box.home, '.deepbuild/lanes', `${box.hash()}-unit.json`);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };
  /** The unit lane's records of every tree, and their removal, so a record read later is a later run's. */
  const records = () => {
    const folder = join(box.home, '.deepbuild/lanes');
    return (existsSync(folder) ? readdirSync(folder) : []).filter((name) => name.endsWith('-unit.json')).map((name) => join(folder, name));
  };
  box.records = () => records().map((file) => JSON.parse(readFileSync(file, 'utf8')));
  box.forget = () => { for (const file of records()) rmSync(file); };
  box.keptFile = (tree = box.hash()) => join(box.home, '.deepbuild/preflight', `${tree}.jsonl`);
  /** The kept lines of a tree, those that parse. */
  box.kept = (tree) => parsed(box.keptFile(tree));
  /** Keeps these lines instead, each a line a run wrote or one the test changed. */
  box.keep = (lines, tree) => writeFileSync(box.keptFile(tree), lines.map((line) => `${JSON.stringify(line)}\n`).join(''), { mode: 0o600 });
  /** The throttle's log, of the scene's table. */
  box.log = () => parsed(join(box.table, 'log')).map((entry) => ({ ...entry, at: Date.parse(entry.at) }));
  /** The timed grants the log names, oldest first, each from its grant to its release. Passed-through requests hold none. */
  box.timed = () => {
    const log = box.log();
    return log.filter(({ event, class: cls }) => event === 'granted' && cls === 'timed').map(({ id, pid, at }) => ({ id, pid, from: at, to: log.find((entry) => entry.event === 'released' && entry.id === id)?.at ?? null }));
  };
  /** The throttle's table as it stands: its grants and the requests in line. */
  box.held = () => { try { return JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8')); } catch { return { grants: [], requests: [] }; } };
  box.preflight = () => preflight(box);
  box.session = () => session(box);
  return box;
}

/** A process and every one it has been seen to start, each known by PID and start time, for telling and for stopping. */
function watched(child) {
  const seen = new Map();
  const key = ({ pid, start }) => `${pid} ${start}`;
  const look = () => {
    const table = processes();
    const self = table.get(child.pid);
    if (self && child.exitCode === null && child.signalCode === null) seen.set(key(self), self);
    const roots = [...seen.values()].filter(({ pid, start }) => table.get(pid)?.start === start).map(({ pid }) => pid);
    for (const root of roots) for (const proc of under(table, root)) seen.set(key(proc), proc);
    return table;
  };
  const stop = () => {
    // Each round stops what is left and what it started meanwhile.
    for (let round = 0; round < 30; round++) {
      const table = look();
      const left = [...seen.values()].filter(({ pid, start }) => table.get(pid)?.start === start);
      if (!left.length) return;
      for (const { pid } of left) try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  };
  return { look, stop };
}
/** Starts `command` in the scene, its output in a log of its own; `exited` resolves to its exit and when it came. */
function start(box, command, args, options) {
  const log = join(box.dir, `out-${box.children.length + 1}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(command, args, { env: box.env, detached: true, stdio: ['ignore', fd, fd], ...options });
  closeSync(fd);
  const run = { child, ...watched(child), out: () => readFileSync(log, 'utf8') };
  // deadline: a look at the run's processes, so one left by a dead parent is known by its PID; it ends with the run.
  const timer = setInterval(() => { try { run.look(); } catch {} }, 5_000);
  run.exited = new Promise((done) => {
    const end = (exit) => { clearInterval(timer); done({ ...exit, at: Date.now() }); };
    child.on('error', (error) => end({ error: String(error) }));
    child.on('exit', (code, signal) => end({ code, signal }));
  });
  run.running = () => child.exitCode === null && child.signalCode === null;
  /** Its exit, within its bound, or the stop that came at the bound. */
  run.end = async () => {
    const ended = await until(() => !run.running(), RUN);
    if (!ended) {
      if (run.running()) process.kill(child.pid, 'SIGTERM');
      // deadline: twice section 7b's 30 s for a stop.
      await until(() => !run.running(), 60);
      run.stop();
    }
    return { ...await run.exited, ...!ended && { stopped: true } };
  };
  box.children.push(run);
  return run;
}
/**
 * Runs `scripts/preflight` in the scene. The process started is the one the script becomes, since it execs node, so a
 * signal to it is a stop, as section 7b says one is sent.
 */
function preflight(box) {
  const began = Date.now();
  return Object.assign(start(box, join(box.tree, 'scripts/preflight'), [], { cwd: box.tree }), { began });
}
/** A run to its end: its exit, its output and what it added to the scene. The unit records of runs before it go first. */
export async function toEnd(box) {
  const before = box.counts(), timedBefore = box.timed().length;
  box.forget();
  const run = box.preflight();
  const exit = await run.end();
  const counts = box.counts(), out = run.out();
  return {
    ...exit, out, began: run.began, counts, timed: box.timed().slice(timedBefore), record: box.record(), kept: box.kept(),
    started: Object.keys(counts).filter((name) => counts[name] > before[name]), times: (name) => counts[name] - before[name],
    spans: (name) => box.spans(name).slice(before[name], counts[name]),
    shown: `${exit.stopped ? `the preflight had not ended after ${RUN} s and was stopped\n` : ''}${dump(box, out)}`,
  };
}
/** Another session's build: a build request of the scene's table, from a process of no run's, whose command ends at once. */
function session(box) {
  const asked = Date.now();
  const run = start(box, process.execPath, [join(box.tree, 'scripts/throttle.mjs'), 'build', '--wait', '600', '--', process.execPath, '-e', '0'], { cwd: box.dir });
  run.asked = asked;
  run.granted = () => box.log().find((entry) => entry.event === 'granted' && entry.class === 'build' && entry.pid === run.child.pid)?.at ?? null;
  run.pending = () => box.held().requests.some((request) => request.pid === run.child.pid);
  return run;
}

/** Those of `spans` any part of which is inside [from, to]; one that was cut is known by its start alone. */
export const inside = (spans, { from, to }) => spans.filter((span) => span.from < (to ?? Infinity) && (span.to ?? span.from) > from);
/** Seconds, for a message. */
export const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** What a run printed of its time: the two lines the finishing run prints, each null when it printed none. */
export function printed(out) {
  const lines = out.split('\n');
  const at = (pattern) => {
    const found = lines.findIndex((line) => pattern.test(line));
    return found < 0 ? null : { at: found, groups: lines[found].match(pattern).groups };
  };
  const checks = at(/^Checks elapsed: (?<elapsed>\d+(?:\.\d+)?) s \(budget: <(?<budget>\d+(?:\.\d+)?) s\)/);
  const kept = at(/^Kept: (?<jobs>\d+) jobs?, (?<seconds>\d+(?:\.\d+)?) s of machine time, from (?<runs>\d+) runs?$/);
  return {
    checks: checks && { at: checks.at, elapsed: Number(checks.groups.elapsed), budget: Number(checks.groups.budget) },
    kept: kept && { at: kept.at, jobs: Number(kept.groups.jobs), seconds: Number(kept.groups.seconds), runs: Number(kept.groups.runs) },
  };
}

/** What a scene and its run left, for a failure's message. */
export function dump(box, out) {
  const tail = (lines, count) => (lines.length > count ? ['…', ...lines.slice(-count)] : lines).join('\n');
  const clock = (at) => new Date(at).toISOString().slice(11, 23);
  const kept = box.kept();
  // A line's key names the machine, so it is left out.
  return [
    `kept lines (${box.keptFile()}): ${kept.length ? '' : 'none'}\n${tail(kept.map(({ job, files, tests, run, ms }) => `${job} [${files?.join(', ')}] ${tests?.map(({ state }) => state).join(' ')} run ${run} ms ${ms}`), 20)}`,
    `throttle log, timed and build:\n${tail(box.log().filter(({ class: cls, event }) => (cls === 'timed' || cls === 'build') && event !== 'passed').map(({ at, event, class: cls, id, pid }) => `${clock(at)} ${event} ${cls} ${id ?? ''} ${pid}`), 30)}`,
    `notes:\n${tail(box.notes().map(({ at, name, event, cwd }) => `${clock(at)} ${name} ${event} ${cwd}`), 40)}`,
    `output:\n${tail(out.split('\n').filter((line) => !line.startsWith('SKIP ')).map((line) => (line.length > 400 ? `${line.slice(0, 400)}…` : line)), 60)}`,
  ].join('\n').replaceAll(box.home, '~').replaceAll(box.dir, '<tmp>').replaceAll(hostname().split('.')[0], '<host>');
}
