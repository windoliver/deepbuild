// Helpers for #3296's acceptance tests (README). Each scene is a fixture repository of its own in a temp folder, holding
// a copy of this checkout's scripts/ and a few probe test files at places the lane lists name, and `scripts/preflight` is
// run there as a person runs it. Nothing of the machine's is read or written: HOME, TMPDIR and the throttle's table are
// the scene's, and a run is started only inside node --test, which is what lets a request keep a table of its own
// (docs/parallel-proof.md, section 6). Every process is stopped by its PID and start time, never by name or port.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const lists = await import(join(CHECKOUT, 'scripts/lanes.mjs'));
const { alone, byHand, exclusive, listed, ownLane, slow, timed } = lists;

// The probes' places, by the lists a fixture's own copy of scripts/ holds. A folder a suite's lane.json adds isn't alone
// in a fixture, which has no lane.json, so only the lists' own folders are taken.
const PROBES = 16;
const free = (file) => ![timed, slow, byHand, ownLane, exclusive].some((list) => listed(list, file)) && !/\.live\.test\./.test(file);
const FOLDERS = alone.filter((entry) => /^tests\/acceptance\/\d+\/$/.test(entry) && free(`${entry}a.test.ts`) && free(`${entry}b.test.ts`) && !existsSync(join(CHECKOUT, entry, 'lane.json'))).slice(0, PROBES);
const TIMED = timed.find((file) => /^tests\/acceptance\/\d+\/[\w-]+\.test\.ts$/.test(file) && listed(alone, file) && ![slow, byHand, ownLane, exclusive].some((list) => listed(list, file))
  && !existsSync(join(CHECKOUT, dirname(file), 'lane.json')) && !FOLDERS.includes(`${dirname(file)}/`));
/** Group `k`'s file `name`: in the k-th folder the unit lane runs alone, so each k is a group (one turn's files) of its own. */
export const aloneFile = (k, name) => {
  assert.ok(FOLDERS.length === PROBES, `lanes.mjs's alone list holds ${FOLDERS.length} folders a probe can stand in`);
  return `${FOLDERS[k]}${name}.test.ts`;
};
/** A file of the unit lane's timed block. */
export const timedFile = () => {
  assert.ok(TIMED, 'lanes.mjs names no timed file a probe can stand in for');
  return TIMED;
};
export const parallelFile = (name) => `tests/${name}.test.ts`;
export const nodeFile = (name) => `tests/${name}.test.mjs`;

// What a probe does, read at its start from the scene's state folder, never from the tree: so a probe can fail once and
// pass after, on one tree. `one` always passes; `two` does what the flags say. It notes its start when its file is
// loaded, which is once a run.
const prelude = (name) => `import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const NAME = ${JSON.stringify(name)};
const EVENTS = process.env.T3296_EVENTS ?? '', STATE = process.env.T3296_STATE ?? '', REPORT = process.env.DEEP_PROOF_VITEST_REPORT ?? '', BIN = join(process.env.T3296_DIR ?? '', 'bin');
const note = (event, more = {}) => appendFileSync(EVENTS, JSON.stringify({ name: NAME, event, pid: process.pid, cwd: process.cwd(), throttle: process.env.DEEP_THROTTLE ?? null, ...more }) + '\\n');
const flag = (what) => existsSync(join(STATE, NAME + '.' + what));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
// A job is killed, or its report cut, only once the row of the test before is in it, so there is a row to miscount.
const reported = async () => { for (let k = 0; k < 100 && !(existsSync(REPORT) && readFileSync(REPORT, 'utf8').includes('"name":"one"')); k++) await pause(50); };
const killRunner = () => { process.kill(process.ppid, 'SIGKILL'); process.kill(process.pid, 'SIGKILL'); };
// A hold starts a build, as tests do, and waits for it in a call that blocks the worker; and a child of its own in a
// process group apart, which heeds no signal it can ignore. Both run until they are stopped.
const hold = () => {
  spawn('sh', [join(BIN, 'apart'), NAME], { detached: true, stdio: 'ignore' }).unref();
  spawnSync('sh', [join(BIN, 'build'), NAME], { stdio: 'ignore' });
};
note('start');
`;
const vitestProbe = (name) => `${prelude(name)}
import { expect, test } from 'vitest';
test('one', () => { expect(NAME).toBe(${JSON.stringify(name)}); });
test('two', { timeout: 3_600_000 }, async (ctx) => {
  if (flag('hold')) hold();
  if (flag('kill')) { await reported(); killRunner(); await pause(600_000); }
  if (flag('tear')) { await reported(); appendFileSync(REPORT, '{"type":"pass","file":"'); }
  if (flag('full')) { await reported(); chmodSync(REPORT, 0o444); }
  if (flag('unhandled')) { void Promise.reject(new Error('a planted error no test caught')); await pause(200); }
  if (flag('fail')) expect('broken', 'a planted failure').toBe('whole');
  for (const state of ['BLOCKED', 'INVALID', 'INCONCLUSIVE']) if (flag(state)) throw new Error(state + ': a planted reading');
  if (flag('skip')) ctx.skip('not now');
  if (flag('listed')) ctx.skip('a listed skip');
});
`;
const nodeProbe = (name) => `${prelude(name)}
import test from 'node:test';
test('one', () => {});
test('two', { timeout: 3_600_000 }, async () => {
  if (flag('hold')) hold();
  if (flag('kill')) { await pause(1_000); killRunner(); await pause(600_000); }
  if (flag('fail')) throw new Error('a planted failure');
  if (flag('INCONCLUSIVE')) throw new Error('INCONCLUSIVE: a planted reading');
});
`;
const probe = (file, name) => (file.endsWith('.mjs') ? nodeProbe(name) : vitestProbe(name));

// The one library test target the cargo stand-in reports, as cargo prints it.
const CARGO_ROWS = ['cargo -p tiny --lib › tests::one', 'cargo -p tiny --lib › tests::two'];
const CARGO = `#!/bin/sh
# cargo's stand-in: a workspace of one package, whose two tests pass. It notes each run of them, and is killed part way
# while the scene's state says so.
case "$1" in
  --version|-V) echo 'cargo 1.99.1 (0000000000 2026-10-01)'; exit 0 ;;
  metadata) cat "$T3296_DIR/metadata.json"; exit 0 ;;
  test) ;;
  *) exit 0 ;;
esac
for arg in "$@"; do
  if [ "$arg" = --no-run ]; then exit 0; fi
  if [ "$arg" = --list ]; then printf '     Running unittests src/lib.rs (target/debug/deps/tiny-0123456789abcdef)\\ntests::one: test\\ntests::two: test\\n\\n2 tests, 0 benchmarks\\n'; exit 0; fi
done
printf '{"name":"cargo test","event":"start","pid":%s}\\n' $$ >> "$T3296_EVENTS"
printf '     Running unittests src/lib.rs (target/debug/deps/tiny-0123456789abcdef)\\n\\nrunning 2 tests\\ntest tests::one ... ok\\n'
if [ -e "$T3296_STATE/cargo.kill" ]; then kill -9 $$; fi
if [ -e "$T3296_STATE/cargo.fail" ]; then
  printf 'test tests::two ... FAILED\\n\\nfailures:\\n\\n---- tests::two stdout ----\\n\\nthread '"'"'tests::two'"'"' panicked at src/lib.rs:1:1:\\na planted failure\\n\\nfailures:\\n    tests::two\\n\\ntest result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out\\n\\nerror: test failed, to rerun pass \`-p tiny --lib\`\\n'
  exit 101
fi
printf 'test tests::two ... ok\\n\\ntest result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\\n'
`;
const RUSTC = `#!/bin/sh
line=$(cat "$T3296_STATE/rustc")
case "$*" in
  *-vV*|*-Vv*|*--verbose*) printf '%s\\nbinary: rustc\\nhost: stand-in\\nrelease: 1.99.1\\n' "$line" ;;
  *) printf '%s\\n' "$line" ;;
esac
`;
// A build a held probe starts and waits for: it notes itself and runs, with a compiler of its own, until it is stopped,
// or for an hour when nothing is left to stop it.
const BUILD = `#!/bin/sh
sleep 3600 &
printf '{"name":"%s","event":"build","pid":%s,"compiler":%s}\\n' "$1" $$ $! >> "$T3296_EVENTS"
wait
`;
const APART = `#!/bin/sh
trap '' TERM INT HUP
printf '{"name":"%s","event":"apart","pid":%s}\\n' "$1" $$ >> "$T3296_EVENTS"
k=0
while [ -d "$T3296_STATE" ] && [ $k -lt 3600 ]; do sleep 1; k=$((k + 1)); done
`;
const DEEP = `#!/bin/sh
# deep lease's stand-in: the command runs as it is.
if [ "$1" = lease ]; then shift; if [ "$1" = -- ]; then shift; fi; exec "$@"; fi
exit 0
`;

// The fixture's lanes are the unit lane alone, with the commands the scene names; everything else of scripts/ is the
// checkout's.
const NARROW = (kinds) => `
import * as fixture3296 from './lanes.mjs';
{
  const kind = (command) => (command === fixture3296.aloneCommand ? 'alone' : command[0] === 'cargo' ? 'cargo' : command[1] === '--test' ? 'node' : 'parallel');
  const all = fixture3296.checks, unit = all.find(({ name }) => name === 'unit');
  unit.commands.splice(0, unit.commands.length, ...unit.commands.filter((command) => ${JSON.stringify(kinds)}.includes(kind(command))));
  all.splice(0, all.length, unit);
}
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
export async function until(predicate, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > end) return false;
    await step();
  }
}
// Every scene of the file, ended and removed after its last test; a test run ended by a signal ends what they started too.
const scenes = [];
const stopAll = () => { for (const box of scenes) for (const run of [...box.runs, ...box.children]) run.stop(); };
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { stopAll(); process.exit(1); });
after(() => {
  stopAll();
  for (const { dir } of scenes) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

const jsonl = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

/**
 * A fixture repository ready for `scripts/preflight`: `files` maps each test file to its probe's name, and `commands`
 * names the unit lane's commands it keeps (parallel, alone, cargo, node). `skips` are known-failures.json's, `extra`
 * files of the tree, `bin` programs first on the PATH.
 */
export function scene({ files, commands = ['parallel', 'alone', 'cargo', 'node'], skips = [], extra = {}, bin = {}, env: more = {} }) {
  // A run outside node --test would ask the machine's own table for timed, and hold every other session's work.
  assert.ok(process.env.NODE_TEST_CONTEXT, 'run this suite under node --test');
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3296-')));
  const box = { dir, home: join(dir, 'home'), tree: join(dir, 'tree'), table: join(dir, 'table'), state: join(dir, 'state'), events: join(dir, 'events.jsonl'), busy: join(dir, 'busy'), files, commands, runs: [], children: [] };
  scenes.push(box);
  for (const folder of [box.home, box.tree, box.table, box.busy, box.state, join(dir, 'bin'), join(dir, 'tmp')]) mkdirSync(folder);
  cpSync(join(CHECKOUT, 'scripts'), join(box.tree, 'scripts'), { recursive: true });
  const lanes = join(box.tree, 'scripts/lanes.mjs');
  writeFileSync(lanes, `${readFileSync(lanes, 'utf8')}${NARROW(commands)}`);
  box.put = (path, text) => {
    mkdirSync(dirname(join(box.tree, path)), { recursive: true });
    writeFileSync(join(box.tree, path), text);
  };
  box.put('scripts/perf.mjs', '');
  box.put('scripts/known-failures.json', `${JSON.stringify({ failures: {}, lint: {}, timing: [], skips })}\n`);
  box.put('benchmarks/budgets.json', `${JSON.stringify({ preflight: { margin: 0.5, limits: { elapsedMs: 86_400_000 }, initialReason: 'Fixture.' }, tasks: [] })}\n`);
  box.put('package.json', `${JSON.stringify({ name: 'fixture', private: true, type: 'module' })}\n`);
  box.put('.gitignore', 'node_modules\ntarget\n');
  box.put('vitest.config.ts', `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ${JSON.stringify(lists.testGlobs('ts'))}, maxWorkers: 2 } });
`);
  box.put('Cargo.toml', '[package]\nname = "tiny"\nversion = "0.0.0"\nedition = "2024"\n');
  box.put('src/lib.rs', '');
  for (const [file, name] of Object.entries(files)) box.put(file, probe(file, name));
  for (const [path, text] of Object.entries(extra)) box.put(path, text);
  symlinkSync(join(CHECKOUT, 'node_modules'), join(box.tree, 'node_modules'));
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({
    packages: [{ name: 'tiny', version: '0.0.0', manifest_path: join(box.tree, 'Cargo.toml'), dependencies: [], targets: [{ name: 'tiny', kind: ['lib'], src_path: join(box.tree, 'src/lib.rs') }] }], workspace_members: [], version: 1,
  }));
  box.rustc = (line) => writeFileSync(join(box.state, 'rustc'), `${line}\n`);
  box.rustc('rustc 1.99.1 (0123456789 2026-10-01)');
  for (const [name, text] of Object.entries({ cargo: CARGO, rustc: RUSTC, npm: '#!/bin/sh\nexit 0\n', deep: DEEP, build: BUILD, apart: APART, ...bin })) {
    writeFileSync(join(dir, 'bin', name), text);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:DEEP_|DEEPBUILD_|GIT_|CARGO|RUST|VITEST|MAKEFLAGS$|MFLAGS$|NODE_TEST_CONTEXT$|NODE_OPTIONS$|NODE_V8_COVERAGE$)/.test(name)) delete env[name];
  box.env = {
    ...env, HOME: box.home, XDG_CACHE_HOME: join(box.home, '.cache'), TMPDIR: join(dir, 'tmp'), PATH: [join(dir, 'bin'), dirname(process.execPath), process.env.PATH].join(delimiter),
    NODE_OPTIONS: `--import=${new URL('./machine.mjs', import.meta.url).href}`,
    T3296_DIR: dir, T3296_STATE: box.state, T3296_EVENTS: box.events, T3296_BUSY: box.busy,
    DEEP_THROTTLE_TABLE: box.table, DEEP_SHARDS: '1', DEEP_TEST_SHARD_FLOOR: '0', ...more,
  };
  box.git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: box.tree, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  box.commit = () => {
    box.git('add', '-A');
    box.git('commit', '-qm', 'fixture');
    box.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  };
  box.git('init', '-q', '-b', 'main');
  box.commit();

  box.hash = () => box.git('rev-parse', 'HEAD^{tree}');
  box.flag = (name, what) => writeFileSync(join(box.state, `${name}.${what}`), '');
  box.unflag = (name, what) => rmSync(join(box.state, `${name}.${what}`), { force: true });
  box.notes = () => jsonl(box.events).map((line) => JSON.parse(line));
  /** How many times a probe's file was started, since the scene began. */
  box.starts = (name) => box.notes().filter((note) => note.name === name && note.event === 'start').length;
  box.names = () => [...Object.values(files), ...commands.includes('cargo') ? ['cargo test'] : []];
  box.counts = () => Object.fromEntries(box.names().map((name) => [name, box.starts(name)]));
  /** Every test's ID the lane's record should hold, once each. */
  box.ids = () => [...Object.keys(files).flatMap((file) => [`${file} › one`, `${file} › two`]), ...commands.includes('cargo') ? CARGO_ROWS : []].sort();
  box.record = () => {
    const file = join(box.home, '.deepbuild/lanes', `${box.hash()}-unit.json`);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };
  box.keptFile = () => join(box.home, '.deepbuild/preflight', `${box.hash()}.jsonl`);
  /** The kept lines of the scene's tree, those that parse. */
  box.kept = () => jsonl(box.keptFile()).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  /** The kept rows of a probe's file, or of cargo test, over all the lines, oldest first. */
  box.rowsOf = (name) => box.kept().flatMap((line) => (line.tests ?? []).filter(({ id }) => nameOf(box, id) === name));
  /** Keeps these lines instead, each a line the run wrote or one the test changed. */
  box.keep = (lines) => writeFileSync(box.keptFile(), lines.map((line) => `${JSON.stringify(line)}\n`).join(''), { mode: 0o600 });
  /** The throttle's grants with a live holder, in the scene's table. */
  box.grants = () => {
    const file = join(box.table, 'table.json');
    const live = processes();
    return (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).grants : []).filter(({ pid, start }) => live.get(pid)?.start === start);
  };
  box.preflight = (options) => preflight(box, options);
  return box;
}

/** The probe a test's ID is of, by its file, or cargo test. */
export const nameOf = (box, id) => (id.startsWith('cargo ') ? 'cargo test' : box.files[id.split(' › ')[0]]);

/** A process and every one it has been seen to start, each known by PID and start time, for telling and for stopping. */
function watched(child) {
  const seen = new Map();
  const key = ({ pid, start }) => `${pid} ${start}`;
  const look = () => {
    const table = processes();
    const own = table.get(child.pid);
    if (own && child.exitCode === null && child.signalCode === null) seen.set(key(own), own);
    const roots = [...seen.values()].filter(({ pid, start }) => table.get(pid)?.start === start).map(({ pid }) => pid);
    for (const root of roots) for (const proc of under(table, root)) seen.set(key(proc), proc);
    return table;
  };
  const alive = () => {
    const table = look();
    return [...seen.values()].filter(({ pid, start }) => table.get(pid)?.start === start);
  };
  const stop = () => {
    // Each round stops what is left and what it started meanwhile.
    for (let round = 0; round < 30; round++) {
      const left = alive();
      if (!left.length) return;
      for (const { pid } of left) try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  };
  return { look, alive, stop };
}

/**
 * Runs `scripts/preflight` in the scene. The process started is the one the script becomes, since it execs node. `out()`
 * is what it printed so far; `exited` resolves to its exit; `alive()` lists the processes it started that run.
 */
function preflight(box, { env = {} } = {}) {
  const log = join(box.dir, `run-${box.runs.length + 1}.log`);
  const fd = openSync(log, 'w');
  const child = spawn(join(box.tree, 'scripts/preflight'), [], { cwd: box.tree, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const run = { child, ...watched(child), out: () => readFileSync(log, 'utf8') };
  // deadline: a look at the run's processes, so one left by a dead parent is known by its PID; it ends with the run.
  const timer = setInterval(() => { try { run.look(); } catch {} }, 5_000);
  run.exited = new Promise((done) => {
    child.on('error', (error) => { clearInterval(timer); done({ error: String(error) }); });
    child.on('exit', (code, signal) => { clearInterval(timer); done({ code, signal }); });
  });
  run.running = () => child.exitCode === null && child.signalCode === null;
  box.runs.push(run);
  return run;
}

/** A run to its end. */
export async function toEnd(box, options) {
  const run = box.preflight(options);
  const exit = await run.exited;
  return { ...exit, out: run.out(), run };
}

/** A holder of timed on the scene's other table, where a refused job's request gets no grant. */
export async function busyTable(box) {
  const child = spawn(process.execPath, [join(box.tree, 'scripts/throttle.mjs'), 'timed', '--wait', '5', '--', process.execPath, '-e', 'setInterval(() => {}, 1e6)'], { cwd: box.dir, env: { ...box.env, DEEP_THROTTLE_TABLE: box.busy }, detached: true, stdio: 'ignore' });
  box.children.push(watched(child));
  const held = () => { try { return JSON.parse(readFileSync(join(box.busy, 'table.json'), 'utf8')).grants.length > 0; } catch { return false; } };
  assert.ok(await until(held, 120_000), 'the scene\'s other table has no holder');
}
/** The jobs whose command names one of `words` are refused their grant from now on (machine.mjs). */
export const refuse = (box, ...words) => writeFileSync(join(box.state, 'refuse'), words.map((word) => `${word}\n`).join(''));
/** How many requests the throttle refused so far, by the log of the table they asked. */
export const refusals = (box) => jsonl(join(box.busy, 'log')).filter((line) => JSON.parse(line).event === 'timeout').length;

/** What a scene and its run left, for a failure's message. */
export function dump(box, run) {
  const tail = (text, size) => (text.length > size ? `…${text.slice(-size)}` : text);
  return [
    `kept lines (${box.keptFile()}): ${existsSync(box.keptFile()) ? `\n${tail(readFileSync(box.keptFile(), 'utf8'), 4_000)}` : 'none, the file is missing'}`,
    `notes:\n${tail(box.notes().map((note) => JSON.stringify(note)).join('\n'), 3_000)}`,
    ...run ? [`output:\n${tail(typeof run.out === 'function' ? run.out() : run.out, 5_000)}`] : [],
  ].join('\n').replaceAll(box.home, '~').replaceAll(box.dir, '<tmp>');
}
