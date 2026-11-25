// Helpers for #3510's acceptance tests. Written blind from issue #3510, AGENTS.md (Proof) and docs/parallel-proof.md
// sections 5 ("Binaries for tests") and 6, at base b48a47db7. The surface is the issue's: `buildBinaries(cwd, bin,
// names, run, options)` as this checkout's scripts/proof-binaries.mjs exports it, called by a process of its own in a
// fixture repository with a one-crate Cargo workspace, on a throttle table of the test's own (DEEP_THROTTLE_TABLE) and
// under a HOME of the test's own. cargo and rustc are real. Nothing here imports the code under test: the caller is a
// child that imports it, so a missing export or a wait that never ends reads as a failed assertion (README).
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, gitIn, write } from '../1115/helpers.mjs';
import { prints, sandbox as sandbox2820, workspace } from '../2820/helpers.mjs';
import { lines, start, tableLog, THROTTLE, within } from '../3334/helpers.mjs';

export { lines, movingLine, showLog, SLOTS, start, tableLog, THROTTLE, within } from '../3334/helpers.mjs';

/** The code under test, by the path the issue names. A planted twin replaces this file in its own checkout. */
export const PROOF_BINARIES = join(CHECKOUT, 'scripts/proof-binaries.mjs');
/** The fixture workspace's one binary. */
export const BIN = 'fixture-3510';
/** One test's bound: every wait inside it is bounded well below this, so a hang reads as a failed assertion. */
export const LONG = { timeout: 20 * 60_000 };
const ENV_OUT = ['DEEP_TEST_GRANT_STALL', 'DEEP_THROTTLE', 'DEEP_THROTTLE_READINGS', 'DEEP_THROTTLE_RUN', 'DEEP_PERF_LOCK', 'DEEP_LEASE_WAIT', 'DEEP_HUB_PLANT', 'NODE_TEST_CONTEXT', 'DEEP_PROOF_VITEST_REPORT'];

/**
 * #2820's sandbox (a HOME of its own, removed after the test, every process it started stopped by its group's PID,
 * real cargo with a CARGO_HOME of the sandbox's), with DEEP_TEST_GRANT_STALL unset and no grant named, and its
 * throttle table's folder made: `box.table`, which DEEP_THROTTLE_TABLE names. Never the machine's table.
 */
export function sandbox(t) {
  const box = sandbox2820(t);
  for (const name of ENV_OUT) delete box.env[name];
  mkdirSync(box.table, { recursive: true });
  return box;
}

/**
 * The fixture repository: a git repository of the sandbox's holding a Cargo workspace of one bin crate with no
 * dependencies and its Cargo.lock, committed. The binary prints a token only this fixture's source holds, so a binary
 * that prints it was built from this repository by this call.
 */
export function fixture(box) {
  const token = `${BIN} ${randomBytes(6).toString('hex')}`;
  const cwd = join(box.dir, 'repo');
  mkdirSync(cwd);
  write(cwd, { '.gitignore': '/target\n', ...workspace(box, { [BIN]: prints(token) }) });
  const git = gitIn(cwd);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'the fixture workspace');
  return { cwd, token, bin: join(box.dir, 'run', 'bin'), marker: join(box.dir, 'build-started') };
}

// The caller: a process of its own that imports buildBinaries and calls it once, with the fixture repository as its
// working folder. `run` is the surface's fourth argument: node's spawnSync, noting first that the build was started.
// Its lines are written whole before the call blocks: CALLING <pid>, then RETURNED <bin> or THREW <message>.
const CALLER = `import { spawnSync } from 'node:child_process';
import { writeFileSync, writeSync } from 'node:fs';
const [module, cwd, bin, name, marker] = process.argv.slice(2);
const { buildBinaries } = await import(module);
const run = (command, args, options) => {
  writeFileSync(marker, JSON.stringify([command, ...args]));
  return spawnSync(command, args, options);
};
writeSync(1, 'CALLING ' + process.pid + '\\n');
let line;
try {
  line = 'RETURNED ' + JSON.stringify(buildBinaries(cwd, bin, [name], run));
} catch (error) {
  line = 'THREW ' + JSON.stringify(String(error?.message ?? error));
}
writeSync(1, line + '\\n');
`;

/**
 * Starts the call under test: `buildBinaries(<fixture>, <bin>, ['fixture-3510'], run)` in a process of its own, in its
 * own process group, with `env` over the sandbox's. With `under`, the caller is the command of that argv (as
 * `node scripts/throttle.mjs build --`). `callerPid()` resolves with the calling process's pid once it is about to call;
 * `ended(minutes)` with `{ returned, threw, status, text }` once it exits, or null when it still runs after `minutes`.
 */
export function call(box, fx, { env = {}, under = [] } = {}) {
  const script = join(box.dir, 'caller.mjs');
  writeFileSync(script, CALLER);
  const child = start(box, [...under, process.execPath, script, pathToFileURL(PROOF_BINARIES).href, fx.cwd, fx.bin, BIN, fx.marker], { env: { ...box.env, ...env }, cwd: fx.cwd });
  const calling = child.line(/^CALLING \d+$/).then((line) => (line ? Number(line.slice('CALLING '.length)) : null));
  child.callerPid = () => within(calling, 3);
  child.ended = async (minutes) => {
    const run = await within(child.done, minutes);
    if (!run) return null;
    const last = (head) => lines(run.stdout).filter((line) => line.startsWith(head)).at(-1)?.slice(head.length);
    const parsed = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
    return { status: run.status, returned: parsed(last('RETURNED ')), threw: parsed(last('THREW ')), text: `exit ${run.status ?? run.signal}\n${child.output()}` };
  };
  return child;
}

/**
 * Resolves true once the table holds a request of the process `pid` (it has joined the line), false once `child` ends
 * without one, null after two minutes. An event wait: each change of the table's folder is a look at its table.json.
 */
export function joined(box, child, pid) {
  let watcher;
  const seen = new Promise((resolve) => {
    const look = () => {
      try {
        if (JSON.parse(readFileSync(join(box.table, 'table.json'), 'utf8')).requests.some((request) => request.pid === pid)) resolve(true);
      } catch {}
    };
    watcher = watch(box.table, look);
    look();
  });
  return within(Promise.race([seen, child.done.then(() => false)]), 2).finally(() => watcher.close());
}

/**
 * Other sessions' build grants: `count` holders on the sandbox's table, each `throttle.mjs build --wait 10` running a
 * command named `hold-3510-<k>` that prints `GRANTED <token>` and then holds as `hold` says (shell, `$1` the file
 * `box.go`). Resolves once all hold, each `{ pid, id, name, child }`, or null for one that got no grant in 2 minutes.
 */
export function holders(box, count, hold = 'exec /bin/sleep 600') {
  box.go = join(box.dir, 'go-3510');
  return Promise.all(Array.from({ length: count }, async (_, k) => {
    const name = `hold-3510-${k + 1}`;
    const child = start(box, [process.execPath, THROTTLE, 'build', '--wait', '10', '--', '/bin/sh', '-c', `echo "GRANTED $DEEP_THROTTLE"; ${hold}`, name, box.go]);
    const line = await within(child.line(/^GRANTED build:\S+$/), 2);
    return line ? { pid: child.pid, id: line.slice('GRANTED build:'.length), name, child } : null;
  }));
}
/** A holder's command that keeps its grant until the file `box.go` exists and for 8 s after, as the criterion gives. */
export const EIGHT_SECONDS = 'while [ ! -e "$1" ]; do /bin/sleep 0.1; done; exec /bin/sleep 8';

/** The log's entries of class `build` for the process `pid`. */
export const entriesOf = (box, pid) => tableLog(box.table).filter((entry) => entry.class === 'build' && entry.pid === pid);

/** What `bin` holds: its entries' names, none when it doesn't exist. */
export const binHolds = (fx) => (existsSync(fx.bin) ? readdirSync(fx.bin) : []);

/** Runs the binary the call put in `bin`: `{ exists, status, stdout }`. */
export function ranBinary(fx) {
  const path = join(fx.bin, BIN);
  if (!existsSync(path)) return { exists: false, status: null, stdout: null };
  const result = spawnSync(path, [], { encoding: 'utf8' });
  return { exists: true, status: result.status, stdout: result.stdout?.trim() ?? null };
}

/** Asserts material: the call returned its `bin`, and `bin` holds the binary built from the fixture. */
export function builtIn(assert, fx, ended, all) {
  assert.equal(ended.threw, undefined, `buildBinaries threw: ${ended.threw}\n${all()}`);
  assert.equal(ended.returned, fx.bin, `buildBinaries returns its bin\n${all()}`);
  const binary = ranBinary(fx);
  assert.ok(binary.exists, `bin holds ${BIN}\n${all()}`);
  assert.equal(binary.stdout, fx.token, `the binary in bin was built from the fixture repository by this call\n${all()}`);
  assert.ok(existsSync(fx.marker), `the call started its build through its run argument\n${all()}`);
}
