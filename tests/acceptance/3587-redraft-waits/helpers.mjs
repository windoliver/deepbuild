// Helpers for #3587's blind suite (REDRAFT.md). Each run is a scratch entry in a temp folder: a copy of this checkout's
// scripts/, with stub scripts/checks.mjs and scripts/perf.mjs, a benchmarks/budgets.json with a budget of seconds and a
// package.json, and `scripts/preflight` run there as a person runs it. Where a run needs the harness lane to be one
// preflight could start (the SIGKILL run), budgets.json declares a harness budget and scripts/agent-harness.mjs is a
// stub too, so the lane's start is seen and no agent session is ever started.
//
// Nothing of the machine's is read or written: the file's throttle table is a temp folder of its own, named by
// DEEP_THROTTLE_TABLE, which throttle.mjs reads only inside a test run (node --test), as this suite is. A process that
// leaves the test's tree (a supervisor's orphan) is refused that variable, so it can't reach the machine's table.
// A top-level timed request waits for the load to fall below the cores (throttle.mjs, grantable), which a busy
// machine may not do for an hour. So the test process holds a build grant in that table, and each preflight runs under
// it (DEEP_THROTTLE): its timed request is then a nested one, granted to the preflight's own PID and released by it,
// with no load wait. The tests run one at a time, so the table holds one preflight at most.
// PATH holds only node's folder and the system's, so no `deep` or cargo of the machine's runs.
//
// The stubs write `<role> <pid>` lines to the entry's state folder; a test stops only those PIDs (checked against the
// start ps gave them), the process group it created for preflight, and processes whose command line names its own
// temp folder. Never by name or port.
//
// Waits are for events: an output line, the preflight's exit, the close of its output. A timer only bounds such a wait
// (`within`), and at its bound the wait reads as not come.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const TABLE = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3587w-throttle-')));
process.env.DEEP_THROTTLE_TABLE = TABLE;
const throttle = await import(join(CHECKOUT, 'scripts/throttle.mjs'));
let holder;
/** The test process's build grant, which every preflight here runs under. */
const held = () => {
  holder ??= throttle.acquire('build', { wait: 1 });
  if (!holder) throw Error('no build grant came in a minute in the suite\'s own throttle table');
  return holder;
};
export const TIMEOUT = Symbol('timeout');

/** `promise`, or TIMEOUT once `ms` passed first. */
export function within(promise, ms) {
  let timer;
  const bound = new Promise((done) => {
    timer = setTimeout(done, ms, TIMEOUT); // deadline: bounds a wait for an event; at the bound the wait reads as not come
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}

// The stubs. Each notes its PID in the entry's state folder before it prints its first line.
const NOTE = `import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const STATE = process.env.T3587_STATE;
const note = (role) => appendFileSync(join(STATE, 'pids'), role + ' ' + process.pid + '\\n');
`;

/** A child that never ends: it ignores the stop signals it can, notes itself, then tells its parent it is ready. */
const CHILD = `${NOTE}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => {});
note('child');
setInterval(() => {}, 60000);
process.send('ready', () => process.disconnect());
`;

/** checks.mjs that never ends, with a child that never ends. */
export const HANG = `${NOTE}
import { spawn } from 'node:child_process';
note('check');
const child = spawn(process.execPath, [join(STATE, 'child.mjs')], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
child.once('message', () => {
  console.log('stub check started');
  setInterval(() => {}, 60000);
});
`;

/** checks.mjs that passes after `ms`, printing a first and a last line. */
export const SLOW = (ms) => `${NOTE}
note('check');
console.log('stub check first line');
setTimeout(() => { console.log('stub check last line'); process.exitCode = 0; }, ${JSON.stringify(ms)});
`;

/** checks.mjs that passes once the state folder holds `go`, or fails after a minute with none. */
export const GATED = `${NOTE}
note('check');
console.log('stub check started');
const began = Date.now();
const look = setInterval(() => {
  if (existsSync(join(STATE, 'go'))) { clearInterval(look); console.log('stub check ended'); process.exitCode = 0; }
  else if (Date.now() - began > 60000) { clearInterval(look); console.log('stub check gave up'); process.exitCode = 1; }
}, 50);
`;

/** checks.mjs that passes at once. */
export const PASS = `${NOTE}
note('check');
console.log('stub check passed');
`;

const PERF = `${NOTE}
note('perf');
console.log('stub perf ran');
`;
const HARNESS = `${NOTE}
note('harness');
console.log('stub harness ran');
`;

const entries = [];
const stopAll = () => { for (const box of entries) box.stop(); };
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { stopAll(); process.exit(1); });
after(() => {
  stopAll();
  if (holder) throttle.release(holder);
  for (const { dir } of entries) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  rmSync(TABLE, { recursive: true, force: true, maxRetries: 5 });
});

/** ps's start time of a PID, or null once no process holds it. */
export function startOf(pid) {
  const listing = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' } });
  const start = listing.stdout.trim();
  return listing.status === 0 && start ? start : null;
}
/** Whether `{ pid, start }` is alive: kill(pid, 0) reaches it, it is no zombie, and its start is the one first seen. */
export function alive({ pid, start }) {
  if (!(pid > 1)) return false;
  try { process.kill(pid, 0); } catch { return false; }
  const listing = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  const stat = listing.stdout.trim();
  return Boolean(stat) && !stat.startsWith('Z') && startOf(pid) === start;
}

/**
 * A scratch entry: `checks` is scripts/checks.mjs, the budget is `budgetMs` with `margin`, and `harness` declares a
 * harness budget (with a stub scripts/agent-harness.mjs).
 */
export function entry({ checks, budgetMs, margin, harness = false }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3587w-')));
  const box = { dir, state: join(dir, 'state'), throttle: TABLE, procs: [], runs: [] };
  entries.push(box);
  cpSync(join(CHECKOUT, 'scripts'), join(dir, 'scripts'), { recursive: true });
  for (const folder of ['benchmarks', 'state', 'npm-cache']) mkdirSync(join(dir, folder));
  writeFileSync(join(dir, 'scripts/checks.mjs'), checks);
  writeFileSync(join(dir, 'scripts/perf.mjs'), PERF);
  if (harness) writeFileSync(join(dir, 'scripts/agent-harness.mjs'), HARNESS);
  writeFileSync(join(box.state, 'child.mjs'), CHILD);
  const budgets = { preflight: { margin, limits: { elapsedMs: budgetMs }, initialReason: 'Fixture: a budget of seconds.' }, tasks: [] };
  if (harness) budgets.harness = { initialReason: 'Fixture: a declared harness budget, so the harness lane is one preflight runs.' };
  writeFileSync(join(dir, 'benchmarks/budgets.json'), JSON.stringify(budgets, null, 2));
  writeFileSync(join(dir, 'package.json'), '{ "private": true }\n');
  box.recorded = () => readRecorded(box);
  box.log = () => (existsSync(join(box.throttle, 'log')) ? readFileSync(join(box.throttle, 'log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  // Read as the file stands, less the test process's own build grant: through throttle.mjs a read would sweep a dead
  // holder's grant out first.
  box.table = () => {
    const table = existsSync(join(box.throttle, 'table.json')) ? JSON.parse(readFileSync(join(box.throttle, 'table.json'), 'utf8')) : { grants: [], requests: [] };
    return { grants: table.grants.filter((grant) => grant.id !== holder?.id), requests: table.requests };
  };
  box.start = () => start(box);
  box.stop = () => stop(box);
  return box;
}

function readRecorded(box) {
  const file = join(box.state, 'pids');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const line of text.split('\n')) {
    const [, role, number] = line.match(/^(\S+) (\d+)$/) ?? [];
    const pid = Number(number);
    if (!role || !(pid > 1) || box.procs.some((proc) => proc.pid === pid && proc.role === role)) continue;
    box.procs.push({ role, pid, start: startOf(pid) });
  }
  return box.procs;
}

/** `scripts/preflight` in the entry, leading a process group of its own, as a terminal's foreground job does. */
function start(box) {
  const env = { ...process.env, PATH: [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), DEEP_THROTTLE_TABLE: box.throttle, DEEP_THROTTLE: held().token, T3587_STATE: box.state, npm_config_cache: join(box.dir, 'npm-cache') };
  for (const name of ['DEEP_PREFLIGHT', 'DEEP_PERF_LOCK', 'CARGO_TARGET_DIR']) delete env[name];
  const child = spawn('/bin/sh', [join(box.dir, 'scripts/preflight')], { cwd: box.dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const run = { child, pid: child.pid, out: '' };
  box.runs.push(run);
  const waiters = new Set();
  const feed = (chunk) => {
    run.out += chunk;
    for (const waiter of [...waiters]) if (waiter.pattern.test(run.out)) { waiters.delete(waiter); waiter.done(true); }
  };
  child.stdout.setEncoding('utf8').on('data', feed);
  child.stderr.setEncoding('utf8').on('data', feed);
  run.exited = new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })));
  run.closed = new Promise((done) => child.once('close', (code, signal) => done({ code, signal })));
  /** Resolves true once the output matches `pattern`, or false at `ms`. */
  run.line = async (pattern, ms) => {
    if (pattern.test(run.out)) return true;
    return (await within(new Promise((done) => waiters.add({ pattern, done })), ms)) === true;
  };
  return run;
}

/** SIGKILL to what this entry started and is left: preflight's group, the recorded PIDs, and any process naming its folder. */
function stop(box) {
  for (const run of box.runs) try { process.kill(-run.pid, 'SIGKILL'); } catch {}
  for (const proc of readRecorded(box)) if (alive(proc)) try { process.kill(proc.pid, 'SIGKILL'); } catch {}
  const listing = spawnSync('ps', ['-A', '-ww', '-o', 'pid=,args='], { encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, LC_ALL: 'C' } });
  for (const line of listing.stdout.split('\n')) {
    const [, pid, args] = line.match(/^\s*(\d+)\s+(.*)$/) ?? [];
    if (pid && Number(pid) > 1 && Number(pid) !== process.pid && args.includes(box.dir)) try { process.kill(Number(pid), 'SIGKILL'); } catch {}
  }
}

/** The run's output, for failure messages. */
export const shown = (run) => `\n--- preflight output ---\n${run.out}--- end ---`;
/** The roles of the recorded processes still alive. */
export const left = (box) => box.recorded().filter(alive).map(({ role, pid }) => `${role} (pid ${pid})`);
