// The environment@1 kit (#314): an environment comes up on the port the hub leased it, is ready only once its
// health route answers with its token, and leaves no process behind when taken down. The reference fill runs
// the kit's fixture server; the kit itself leases the port, probes health and watches the process, so no
// memorized answer can pass it. The planted fills report ready before health answers, bind a port of their own
// and leave their process running.
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail, Finding } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { object, text, word } from './shared.js';

export const ENVIRONMENT = 'environment@1';
const SERVER = fileURLToPath(new URL('../../runtime/environment/server.mjs', import.meta.url));

export interface EnvSpec { health: string; token: string; warmup: number }
/**
 * What the hub leases a run: a port on the IPv4 loopback address 127.0.0.1 (the address the kit's probes speak to;
 * a listener on ::1 alone is not on the lease), and the run token every process of the environment carries on its
 * command line, so that after down the hub can tell nothing of the run is left. The kit issues one per case.
 */
export interface Lease { port: number; token: string }
export interface Handle { id: string; port: number; pid: number }
export interface EnvironmentFill extends SlotFill {
  slot: 'environment@1';
  /** Brings the environment up on the leased port, its processes carrying the lease's run token; returns once it is ready. */
  up(spec: EnvSpec, lease: Lease): Handle;
  down(handle: Handle): void;
}

const RULES = {
  health: { id: 'ready-means-healthy', rule: 'up returns only once the environment\'s health route answers on the leased port, at 127.0.0.1, with the spec\'s token.', message: 'reported ready before its health check answered' },
  port: { id: 'binds-leased-port', rule: 'The environment binds the port the hub leased it, at 127.0.0.1, and no other.', message: 'bound a port outside its lease' },
  down: { id: 'down-stops-process', rule: 'After down, the environment\'s process is gone, nothing listens on the leased port, and no process carries the run token.', message: 'left its process running after down' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

// ---- Processes and ports, synchronously -------------------------------------------------------------

const sleep = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/** The process table, in the C locale, so its dates and states read the same under every LANG. */
/**
 * A system tool run once more when it could not be started at all (a fork refused under load, say): the second
 * attempt's answer is the answer. A tool that started and failed is not retried.
 */
function tool(command: string, args: string[]): SpawnSyncReturns<string> {
  const options = { encoding: 'utf8' as const, env: { ...process.env, LC_ALL: 'C' } };
  const first = spawnSync(command, args, options);
  if (!first.error) return first;
  sleep(20);
  return spawnSync(command, args, options);
}
const ps = (args: string[]): SpawnSyncReturns<string> => tool('ps', args);
const PS_DOWN = (): Finding => new Finding('BLOCKED', 'the process table can\'t be read (ps failed), so the state of the environment\'s processes is unknown', ['ps_unavailable']);
/**
 * Whether the process still runs; an exited child not yet reaped (a zombie) counts as gone. Null when the process
 * exists but the process table can't be read: unknown, which no caller reads as gone.
 */
export function alive(pid: number): boolean | null {
  // A signal of 0 asks without sending; a pid no process has fails it, and then `ps` has nothing to add.
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; }
  const table = ps(['-o', 'stat=', '-p', String(pid)]);
  if (table.error || table.status === null) return null;
  const state = (table.stdout ?? '').trim();
  return table.status === 0 && state.length > 0 && !state.startsWith('Z');
}
/** `alive`, for a judge: unknown is BLOCKED. */
const running = (pid: number): boolean => { const a = alive(pid); if (a === null) throw PS_DOWN(); return a; };
function waitUntil(done: () => boolean, ms: number): boolean {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (done()) return true; sleep(10); }
  return done();
}
interface Row { pid: number; ppid: number; zombie: boolean; command: string }
interface Carrier { pid: number; command: string }
/** The whole process table, one row per process; null when it can't be read, never an empty list. */
function table(): Row[] | null {
  const read = ps(['-Awwo', 'pid=,ppid=,stat=,command=']);
  if (read.status !== 0 || read.error) return null;
  return read.stdout.split('\n').flatMap((line) => {
    const [pid, ppid, stat, ...words] = line.trim().split(/\s+/);
    return /^\d+$/.test(pid ?? '') && /^\d+$/.test(ppid ?? '') ? [{ pid: Number(pid), ppid: Number(ppid), zombie: (stat ?? '').startsWith('Z'), command: words.join(' ') }] : [];
  });
}
interface Listener { address: string; port: number }
const LOOPBACK = '127.0.0.1';
const shown = (l: Listener): string => `${l.address}:${l.port}`;
/**
 * The TCP addresses the given processes listen on, read from the open files table (lsof); null when it can't be read.
 * lsof ends with 1 both when it found nothing and on a failure it reports on stderr; only the silent 1 is an answer.
 * An address is as lsof names it: `127.0.0.1`, `*` for every interface, `[::1]`.
 */
function listeners(pids: number[]): Listener[] | null {
  const read = tool('lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', pids.join(','), '-Fn']);
  if (read.error || read.status === null || (read.status !== 0 && (read.status !== 1 || read.stderr.trim() !== ''))) return null;
  const seen = new Map<string, Listener>();
  for (const line of read.stdout.split('\n')) {
    if (!line.startsWith('n')) continue;
    const colon = line.lastIndexOf(':');
    const port = Number(line.slice(colon + 1));
    if (colon > 0 && Number.isInteger(port)) seen.set(line.slice(1), { address: line.slice(1, colon), port });
  }
  return [...seen.values()].sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
}
/** Whether the command line carries the run token anywhere (as its own word or inside `--run-token=`, say): 18 random hex digits after `run-` match nothing else. */
const carries = (row: Row, run: string): boolean => row.command.includes(run);
/**
 * Every process carrying the run token as a word of its command line (the issue's words: down leaves no process
 * carrying its run token). The scan finds what was left; it grants no authority to stop anything (see `own`).
 */
const carrying = (run: string): Carrier[] | null => table()?.map((row) => (carries(row, run) ? { pid: row.pid, command: row.command } : null)).filter((c): c is Carrier => c !== null) ?? null;
/** The processes under `pid` in the table at this moment: its children, theirs, and so on (one that has left the tree is not seen). */
function descendants(rows: Row[], pid: number): Row[] {
  const found: Row[] = [];
  const queue = [pid];
  while (queue.length) { const parent = queue.shift()!; for (const row of rows) if (row.ppid === parent && !found.includes(row)) { found.push(row); queue.push(row.pid); } }
  return found;
}
/**
 * The fixture processes the kit's own reference fills started, as their ready markers reported them: each pid with
 * the start time the process table gave it then (the design's words: tracked by run token and start time, never by
 * pid alone). The kit signals only one of these, only while its start time is the recorded one and it carries the
 * run token; a command line a fill could dress up with the kit's words is no proof the kit started it, and a pid
 * the OS has given to another process since is not that process. Each case's end drops the records of what is gone.
 */
const own = new Map<number, number>();
/** The process's start time in ms since the epoch, as the process table gives it; null for no process or no table. */
const startTime = (pid: number): number | null => {
  const table = ps(['-o', 'lstart=', '-p', String(pid)]);
  const at = Date.parse((table.stdout ?? '').trim());
  return table.status === 0 && Number.isFinite(at) ? at : null;
};
/**
 * The same start, within the second a table derives it to (Linux recomputes it from the boot time, which can move).
 * The tolerance is safe because ownership is never start time alone: the kit signals a recorded pid only while it
 * carries this case's run token, a random draw only the kit's own fixture processes ever receive.
 */
const sameStart = (a: number | null, b: number | undefined): boolean => a !== null && b !== undefined && Math.abs(a - b) <= 1500;
const record = (pid: number): void => { const at = startTime(pid); if (at !== null) own.set(pid, at); };
/** Whether `pid` is one the kit started and is still that process. */
const isOwn = (pid: number): boolean => own.has(pid) && sameStart(startTime(pid), own.get(pid));
/** Drops the records of what is gone or another process; one the table can't speak for while it may still run is kept. */
const forget = (): void => { for (const [pid, at] of own) { const now = startTime(pid); if (now === null ? alive(pid) === false : !sameStart(now, at)) own.delete(pid); } };
const scanned = (run: string): Carrier[] => {
  const left = carrying(run);
  if (left === null) throw PS_DOWN();
  return left;
};
/**
 * Stops one of the kit's own processes, if it is still that process at the moment of the signal: one reading of the
 * table gives its start time and command line together, and the SIGKILL follows only when the start is the recorded
 * one and the command still carries the run token. What remains is the instant between that reading and the signal;
 * a pid the OS reuses within it would have to carry this case's random token too. 'unreadable' when the table gave
 * no answer; 'other' when the pid is gone or another process by now; else 'signalled' (a refused signal is told by the
 * process still being there afterwards, which the caller checks for every owned pid, signalled or not).
 */
function stop(pid: number, run: string): 'signalled' | 'other' | 'unreadable' {
  const at = own.get(pid);
  const read = ps(['-o', 'lstart=,command=', '-p', String(pid)]);
  if (read.error || read.status === null) return 'unreadable';
  if (at === undefined || read.status !== 0) return 'other';
  const words = read.stdout.trim().split(/\s+/);
  const start = Date.parse(words.slice(0, 5).join(' '));
  if (!sameStart(Number.isFinite(start) ? start : null, at) || !words.slice(5).join(' ').includes(run)) return 'other';
  try { process.kill(pid, 'SIGKILL'); } catch { /* told by the check that follows */ }
  return 'signalled';
}

/**
 * The network probes, answered synchronously from one worker thread (runtime/environment/probes.mjs): the judge
 * posts a request and waits on the shared buffer the thread writes its answer into. One thread serves the whole
 * process and never holds it open.
 */
const PROBES = fileURLToPath(new URL('../../runtime/environment/probes.mjs', import.meta.url));
let probes: { worker: Worker; flags: Int32Array; out: Uint8Array } | null = null;
/** A probe the kit itself couldn't make is BLOCKED: the fill did nothing the kit saw. */
function ask<T>(request: { op: 'lease' | 'probe' | 'listening'; port?: number; path?: string }, timeout = 3000): T {
  if (probes === null) {
    const shared = new SharedArrayBuffer(8 + 65_536);
    const worker = new Worker(PROBES, { workerData: shared });
    worker.unref();
    const mine = { worker, flags: new Int32Array(shared, 0, 2), out: new Uint8Array(shared, 8) };
    // A thread that died is replaced at the next probe rather than waited on.
    worker.on('error', () => { if (probes === mine) probes = null; });
    worker.on('exit', () => { if (probes === mine) probes = null; });
    probes = mine;
  }
  const { worker, flags, out } = probes;
  Atomics.store(flags, 0, 0);
  worker.postMessage(request);
  if (Atomics.wait(flags, 0, 0, timeout) === 'timed-out') { void worker.terminate(); probes = null; throw new Finding('BLOCKED', `the kit's ${request.op} probe answered nothing in ${timeout} ms`, ['probe_unanswered']); }
  try { return JSON.parse(Buffer.from(out.subarray(0, Atomics.load(flags, 1))).toString('utf8')) as T; } catch { throw new Finding('BLOCKED', `the kit's ${request.op} probe answered unreadably`, ['probe_unanswered']); }
}
/** A free port on the loopback, leased by binding it once. */
export const leasePort = (): number => {
  const { port } = ask<{ port?: number }>({ op: 'lease' });
  if (!Number.isInteger(port) || (port as number) <= 0) throw new Finding('BLOCKED', 'no free port on the loopback to lease', ['no_port']);
  return port as number;
};
/** A GET's status and body, and the `token` field of the body as JSON, read whole in the worker (the body may arrive cut). */
interface Probe { status: number | null; body: string; token?: unknown; error: string | null; timedOut?: boolean }
const PROBE_LIMIT_MS = 2500;
/**
 * One GET on the loopback port. A request the worker gave up on after the kit's own limit is no answer about the
 * environment: no rule names a deadline, so it is BLOCKED, never a failing of the fill.
 */
function probe(port: number, path: string): Probe {
  const answer = ask<Probe>({ op: 'probe', port, path });
  if (answer.timedOut) throw new Finding('BLOCKED', `GET ${path} on ${port} gave no answer within ${PROBE_LIMIT_MS} ms, the kit's probe limit, so whether the environment answers there is unknown`, ['probe_timeout']);
  return answer;
}
/** Whether something accepts connections on the loopback port: open, or refused; any other answer is unknown, BLOCKED. */
const listening = (port: number): boolean => {
  const answer = ask<{ open?: unknown; code?: unknown }>({ op: 'listening', port });
  if (answer.open === true) return true;
  if (answer.open === false && answer.code === 'ECONNREFUSED') return false;
  throw new Finding('BLOCKED', `whether ${port} still listens is unknown: the connect ended with ${JSON.stringify(answer.code ?? answer)}`, ['port_state_unknown']);
};

/** Starts the fixture server on `port` carrying `run`, waiting for its ready marker unless `wait` is false; with `helper`, its grandchild too. */
function start(spec: EnvSpec, port: number, run: string, wait: boolean, helper = false): { handle: Handle; child: ChildProcess } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-env-'));
  const ready = join(dir, 'ready');
  const child = spawn(process.execPath, [SERVER, String(port), spec.health, spec.token, String(spec.warmup), ready, run, ...(helper ? ['helper'] : [])], { stdio: 'ignore' });
  child.unref();
  const pid = child.pid ?? -1;
  record(pid);
  try {
    if (wait) {
      // The fixture itself not coming up (its port taken in the lease's open moment, say) is the kit's, not the fill's.
      if (!waitUntil(() => existsSync(ready), 5000)) { child.kill('SIGKILL'); throw new Finding('BLOCKED', `the kit's fixture environment on ${port} did not come up in 5 s`, ['fixture_down']); }
      // The marker names the server's grandchild, if any: a process the kit started through the fill and may stop.
      try { const marker = JSON.parse(readFileSync(ready, 'utf8')) as { helper?: number | null }; if (typeof marker.helper === 'number') record(marker.helper); } catch { /* an unreadable marker names nothing */ }
    }
  } finally {
    // The early fill never reads its marker; the server writes it into a folder that is gone, and nothing is kept.
    rmSync(dir, { recursive: true, force: true });
  }
  return { handle: { id: `env-${pid}`, port, pid }, child };
}
/**
 * The reference fill signals only the processes it started, through their own handles, never a pid by number.
 * The `leaves` fault is the sly one: its server starts a grandchild carrying the run token that listens on
 * nothing, and down stops the server alone, so a kit that watched the handle's pid and the leased port would
 * see both gone while the grandchild runs on.
 */
function reference(fault: 'none' | 'early' | 'own-port' | 'leaves' = 'none'): EnvironmentFill {
  const started = new Map<string, ChildProcess>();
  return {
    slot: ENVIRONMENT, revision: 1,
    up(spec, lease) {
      // The own-port fault binds a port of its own: one the lease didn't name (a lease draw can repeat it).
      let port = lease.port;
      if (fault === 'own-port') do port = leasePort(); while (port === lease.port);
      // The early fault reports ready at once while its server never comes to listen within its life (it exits on its
      // own after 60 s; down ends it sooner): wrong by construction, so no stall between the fill's return and the
      // kit's probe can make it healthy first.
      const { handle, child } = start(fault === 'early' ? { ...spec, warmup: 60_000 } : spec, port, lease.token, fault !== 'early', fault === 'leaves');
      started.set(handle.id, child);
      return handle;
    },
    down(handle) {
      const child = started.get(handle.id);
      if (!child) return;
      started.delete(handle.id);
      child.kill('SIGTERM');
      // Unknown (no process table) is not gone: a short wait, then the child is killed outright.
      const grace = alive(child.pid ?? -1) === null ? 300 : 2000;
      if (!waitUntil(() => child.exitCode !== null || child.signalCode !== null || alive(child.pid ?? -1) === false, grace)) child.kill('SIGKILL');
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: EnvironmentFill): PlantedFill<EnvironmentFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<EnvironmentFill>[] => [
  plant('ready-before-health', 'health', ['ready_before_health'], reference('early')),
  plant('unleased-port', 'port', ['unleased_port'], reference('own-port')),
  plant('leaves-grandchild', 'down', ['process_left'], reference('leaves')),
];

const toCase = (id: string, part: 'fixed' | 'seeded', spec: EnvSpec): SlotCase => ({ id, part, input: spec as unknown as JsonValue, expected: { status: 200, token: spec.token } });
const fixtures: Fixture[] = [
  toCase('health-route', 'fixed', { health: '/health', token: 'fixture-token-a', warmup: 40 }),
  toCase('status-route', 'fixed', { health: '/status/ready', token: 'fixture-token-b', warmup: 30 }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Two environments from the draw, each with its own health route, token and warm-up. */
const generate = (random: Random): SlotCase[] => [0, 1].map((i) => toCase(`seeded-${i + 1}`, 'seeded', { health: `/health-${word(random, 6)}`, token: word(random, 12), warmup: random.int(40, 80) }));

function* judge(fill: EnvironmentFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const spec = c.input as unknown as EnvSpec;
  // The lease: a port reserved by binding it once and released for the environment to bind, and a run token drawn
  // for this case alone, so a concurrent case or another kit run on the same fixture shares nothing with it. The
  // moment between the release and the environment's bind is open, as it is for the hub's own leases: the slot's
  // interface hands the environment a port number, not a bound socket, and a port taken in that moment fails the
  // reference fill's start loudly (no ready marker), never a rule.
  const lease: Lease = { port: leasePort(), token: `run-${randomBytes(9).toString('hex')}` };
  let up: Handle | null = null;
  let downed = false;
  try {
    const handle = object('the handle', yield () => fill.up(spec, lease));
    up = handle as unknown as Handle;
    text('handle/id', handle.id);
    if (!Number.isInteger(handle.port)) throw new Finding('FAIL', `handle/port ${JSON.stringify(handle.port)} is not a port`, ['type']);
    if (!Number.isInteger(handle.pid)) throw new Finding('FAIL', `handle/pid ${JSON.stringify(handle.pid)} is not a pid`, ['type']);
    const pid = handle.pid as number;
    if (handle.port !== lease.port) throw fail(RULES.port.message, ['unleased_port'], `bound ${handle.port}; the lease is ${lease.port}`);
    // The probe follows up at once, nothing between: an environment ready before its health answers is caught here.
    const asked = Date.now();
    const answer = probe(lease.port, spec.health);
    const first = Date.now() - asked;
    if (answer.status !== 200) throw fail(RULES.health.message, ['ready_before_health'], `GET ${spec.health} on ${lease.port} right after up: ${answer.error ?? `status ${answer.status}`}`);
    if (answer.token !== spec.token) throw fail(RULES.health.message, ['health_mismatch'], `health answered with token ${JSON.stringify(answer.token)}, not the spec's`);
    // An environment can take the request at once and hold its answer until it is ready: then ready was reported
    // before health answered all the same. Its next answer, from a server now surely ready, is the measure of what
    // an answer costs on this machine at this moment, so a slow machine slows both and only a held first answer stands out.
    const askedAgain = Date.now();
    const again = probe(lease.port, spec.health);
    const second = Date.now() - askedAgain;
    if (again.status !== 200 || again.token !== spec.token) throw fail(RULES.health.message, ['health_unstable'], `GET ${spec.health} answered once, then ${again.error ?? `status ${again.status} with token ${JSON.stringify(again.token)}`}`);
    if (first > second * 3 + 800) throw fail(RULES.health.message, ['ready_before_health'], `the first health answer came ${first} ms after up returned, the next in ${second} ms: the environment held the request until it was ready`);
    // The handle's pid is the fill's word until the process table shows it: a running process carrying the run
    // token. Otherwise "gone after down" would hold of a pid that never was the environment.
    const before = table();
    if (before === null) throw PS_DOWN();
    if (!running(pid) || !before.some((row) => row.pid === pid && carries(row, lease.token))) throw new Finding('FAIL', `handle/pid ${pid} is no running process carrying the run token`, ['pid_not_environment']);
    // Every process of the environment carries the run token (the lease's contract), so a descendant of the handle's
    // process without it is refused here; the tree is remembered, by pid and start time, to be gone after down.
    // One that forks between two reads of the table and is reparented before the next is beyond what a process
    // table shows; the table is read again at every step of the wait after down to leave that gap as small as it gets.
    const members = new Map<number, number>();
    const refused = (row: Row): never => { throw fail(RULES.down.message, ['untagged_process'], `pid ${row.pid} (${row.command}), a process of the environment, carries no run token, so down could leave it unseen`); };
    // A member joins with its start time, its identity from here on; one the table can't give for a process that is
    // still there is BLOCKED, never a member the wait could lose track of. A process gone meanwhile is no member.
    const START_UNKNOWN = (p: number) => new Finding('BLOCKED', `the start time of pid ${p}, a process of the environment, can't be read, so it can't be told from another process later`, ['start_unknown']);
    const join = (p: number): void => { const at = startTime(p); if (at !== null) members.set(p, at); else if (alive(p) !== false) throw START_UNKNOWN(p); };
    // The environment is every process carrying the run token, under the handle's process or beside it (a database
    // the fill started next to its server, say), and every process under the handle's, which must carry the token.
    const grow = (rows: Row[]): void => {
      for (const parent of [...members.keys()]) for (const row of descendants(rows, parent)) if (!members.has(row.pid)) { if (!carries(row, lease.token)) refused(row); join(row.pid); }
      for (const row of rows) if (carries(row, lease.token) && !members.has(row.pid)) join(row.pid);
    };
    join(pid);
    if (!members.has(pid)) throw START_UNKNOWN(pid);
    grow(before);
    // The environment's processes listen on the leased port and no other; the open files table shows which, here
    // and again at every step of the wait after down for whatever still runs then. A listener bound and closed
    // wholly between two readings is beyond what a sampled table shows, as the fork above is.
    const inventory = (pids: number[]): Listener[] => {
      const bound = listeners(pids);
      if (bound === null) throw new Finding('BLOCKED', 'the environment\'s listening ports can\'t be read (lsof failed), so whether it binds its lease alone is unknown', ['listeners_unknown']);
      return bound;
    };
    const leased = (l: Listener): boolean => l.port === lease.port && l.address === LOOPBACK;
    const bound = inventory([...members.keys()]);
    if (!bound.some(leased)) throw fail(RULES.port.message, ['unleased_port'], `no process of the environment listens on ${LOOPBACK}:${lease.port}, though health answered there (${bound.length ? `it listens on ${bound.map(shown).join(', ')}` : 'it listens on nothing'})`);
    const extra = bound.filter((l) => !leased(l));
    if (extra.length > 0) throw fail(RULES.port.message, ['unleased_port'], `listens on ${extra.map(shown).join(', ')} besides the lease ${LOOPBACK}:${lease.port}`);
    // A member is still there when the table shows its pid alive (not a zombie) with the start time it was remembered
    // with; a pid the table shows whose start time then can't be read is unknown, not gone.
    const stillThere = (rows: Row[]): { pid: number }[] => [...members].filter(([p, start]) => {
      if (!rows.some((row) => row.pid === p && !row.zombie)) return false;
      const at = startTime(p);
      if (at === null && alive(p) !== false) throw START_UNKNOWN(p);
      return sameStart(at, start);
    }).map(([p]) => ({ pid: p }));
    const read = (): Row[] => { const rows = table(); if (rows === null) throw PS_DOWN(); return rows; };
    const clear = (): boolean => {
      const rows = read();
      grow(rows);
      const there = stillThere(rows);
      if (there.length > 0) {
        const late = inventory(there.map((m) => m.pid)).filter((l) => !leased(l));
        if (late.length > 0) throw fail(RULES.port.message, ['unleased_port'], `listened on ${late.map(shown).join(', ')} besides the lease ${LOOPBACK}:${lease.port} while going down`);
      }
      return there.length === 0 && !listening(lease.port) && !rows.some((row) => carries(row, lease.token));
    };
    downed = true;
    yield () => fill.down(handle as unknown as Handle);
    // Gone means all of: the pid the handle names and every process that was under it are no process, nothing answers
    // on the leased port any more, and no process carries the run token (a grandchild that left the tree is caught there).
    if (!waitUntil(clear, 150)) {
      const left = scanned(lease.token);
      const there = stillThere(read());
      const why = there.length > 0 ? `${there.map((m) => `pid ${m.pid}`).join(', ')} still run${there.length === 1 ? 's' : ''} 150 ms after down${left.length > 0 ? ` and still carries the run token` : ''}${there.every((m) => isOwn(m.pid)) ? '' : ' (not the kit\'s own, so left as they are)'}`
        : listening(lease.port) ? `pid ${pid} is gone, but ${lease.port} still accepts connections 150 ms after down`
        : left.length > 0 ? `pid ${pid} is gone, but ${left.map((p) => `pid ${p.pid} (${p.command})`).join(', ')} still carries the run token 150 ms after down`
        : `pid ${pid}, the port and the run token were not all clear within 150 ms of down`;
      throw fail(RULES.down.message, ['process_left'], why);
    }
  } finally {
    // A case that ended before its down step still asks the fill to take its environment down, as best it can, so a
    // refusal or a block leaves nothing running that the fill knows how to stop.
    if (up !== null && !downed) { try { void Promise.resolve(fill.down(up)).catch(() => undefined); } catch { /* the fill's own failure */ } }
    // The kit stops only processes it started through the reference fill (its fixture server and helper, by pid and
    // start time as their ready marker reported them) that still carry this case's run token; any other pid is left.
    // A process table that can't be read here leaves what remains unknown, and unknown is BLOCKED, whatever the
    // case found before; so is a process of the kit's own that a SIGKILL did not end.
    const left = carrying(lease.token);
    if (left === null) throw PS_DOWN();
    const mine = left.map((p) => p.pid).filter(isOwn);
    for (const p of mine) if (stop(p, lease.token) === 'unreadable') throw PS_DOWN();
    // Every owned pid, signalled or not, must be gone or another process by now; one still the kit's and alive is BLOCKED.
    const remaining = (): number[] => mine.filter((p) => {
      if (alive(p) === false) return false;
      const at = startTime(p);
      if (at === null) throw PS_DOWN();
      return sameStart(at, own.get(p));
    });
    if (!waitUntil(() => remaining().length === 0, 500)) throw new Finding('BLOCKED', `the kit's own process ${remaining().join(', ')} did not end within 500 ms of SIGKILL`, ['kit_leftover']);
    forget();
  }
}

export const environmentKit = (): SlotKitImpl<EnvironmentFill> => ({
  slot: ENVIRONMENT, fills: 'one', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
