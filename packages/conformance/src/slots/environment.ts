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
 * What the hub leases a run: a loopback port, and the run token every process of the environment carries on its
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
  health: { id: 'ready-means-healthy', rule: 'up returns only once the environment\'s health route answers on the leased port with the spec\'s token.', message: 'reported ready before its health check answered' },
  port: { id: 'binds-leased-port', rule: 'The environment binds the port the hub leased it and no other.', message: 'bound a port outside its lease' },
  down: { id: 'down-stops-process', rule: 'After down, the environment\'s process is gone, nothing listens on the leased port, and no process carries the run token.', message: 'left its process running after down' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

// ---- Processes and ports, synchronously -------------------------------------------------------------

const sleep = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/** The process table, in the C locale, so its dates and states read the same under every LANG. */
const ps = (args: string[]): SpawnSyncReturns<string> => spawnSync('ps', args, { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
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
interface Carrier { pid: number; command: string }
/**
 * Every process carrying the run token as a word of its command line (the issue's words: down leaves no process
 * carrying its run token). A process table the kit can't read is null, never an empty list. The scan finds what
 * was left; it grants no authority to stop anything (see `own`).
 */
function carrying(run: string): Carrier[] | null {
  const table = ps(['-Awwo', 'pid=,command=']);
  if (table.status !== 0 || table.error) return null;
  return table.stdout.split('\n').flatMap((line) => {
    const [pid, ...words] = line.trim().split(/\s+/);
    if (!words.includes(run) || !/^\d+$/.test(pid ?? '')) return [];
    return [{ pid: Number(pid), command: words.join(' ') }];
  });
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
/** The same start, within the second a table derives it to (Linux recomputes it from the boot time, which can move). */
const sameStart = (a: number | null, b: number | undefined): boolean => a !== null && b !== undefined && Math.abs(a - b) <= 1500;
const record = (pid: number): void => { const at = startTime(pid); if (at !== null) own.set(pid, at); };
/** Whether `pid` is one the kit started and is still that process. */
const isOwn = (pid: number): boolean => own.has(pid) && sameStart(startTime(pid), own.get(pid));
const forget = (): void => { for (const [pid, at] of own) if (!sameStart(startTime(pid), at)) own.delete(pid); };
const scanned = (run: string): Carrier[] => {
  const left = carrying(run);
  if (left === null) throw PS_DOWN();
  return left;
};
const stop = (pid: number): void => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } };

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
interface Probe { status: number | null; body: string; token?: unknown; error: string | null }
const probe = (port: number, path: string): Probe => ask<Probe>({ op: 'probe', port, path });
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
      // The early fault reports ready at once while its server still warms up, for long enough that no delay between
      // the fill's return and the kit's probe can hide it: the fill is wrong by construction, not by a close race.
      const { handle, child } = start(fault === 'early' ? { ...spec, warmup: 2000 } : spec, port, lease.token, fault !== 'early', fault === 'leaves');
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
    const answer = probe(lease.port, spec.health);
    if (answer.status !== 200) throw fail(RULES.health.message, ['ready_before_health'], `GET ${spec.health} on ${lease.port} right after up: ${answer.error ?? `status ${answer.status}`}`);
    if (answer.token !== spec.token) throw fail(RULES.health.message, ['health_mismatch'], `health answered with token ${JSON.stringify(answer.token)}, not the spec's`);
    // The handle's pid is the fill's word until the process table shows it: a running process carrying the run
    // token. Otherwise "gone after down" would hold of a pid that never was the environment.
    if (!running(pid) || !scanned(lease.token).some((p) => p.pid === pid)) throw new Finding('FAIL', `handle/pid ${pid} is no running process carrying the run token`, ['pid_not_environment']);
    downed = true;
    yield () => fill.down(handle as unknown as Handle);
    // Gone means all of: the pid the handle names is no process, nothing answers on the leased port any more, and
    // no process carries the run token (a grandchild the handle never named is caught there).
    if (!waitUntil(() => !running(pid) && !listening(lease.port) && scanned(lease.token).length === 0, 150)) {
      const left = scanned(lease.token);
      const why = running(pid) ? `pid ${pid} still runs 150 ms after down${isOwn(pid) ? '' : ' (not the kit\'s own process, so left as it is)'}`
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
    for (const p of carrying(lease.token) ?? []) if (isOwn(p.pid)) stop(p.pid);
    forget();
  }
}

export const environmentKit = (): SlotKitImpl<EnvironmentFill> => ({
  slot: ENVIRONMENT, fills: 'one', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
