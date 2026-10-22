// The environment@1 kit (#314): an environment comes up on the port the hub leased it, is ready only once its
// health route answers with its token, and leaves no process behind when taken down. The reference fill runs
// the kit's fixture server; the kit itself leases the port, probes health and watches the process, so no
// memorized answer can pass it. The planted fills report ready before health answers, bind a port of their own
// and leave their process running.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
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
/** Whether the process still runs; an exited child not yet reaped (a zombie) counts as gone. */
export function alive(pid: number): boolean {
  // A signal of 0 asks without sending; a pid no process has fails it, and then `ps` has nothing to add.
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; }
  const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  const state = (ps.stdout ?? '').trim();
  return ps.status === 0 && state.length > 0 && !state.startsWith('Z');
}
function waitUntil(done: () => boolean, ms: number): boolean {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (done()) return true; sleep(10); }
  return done();
}
/**
 * Whether `pid` is the kit's own fixture server for this case (the server script on the leased port with the
 * spec's token, read from the process's command line). This decides only what the kit may signal in cleanup: a
 * fill's handle is never kill authority, and a pid that isn't provably the kit's own is never signalled. A fill
 * serving the slot with a server of its own is judged on the lease, the health answer and the process state alone.
 */
function isThisServer(pid: number, port: number, run: string): boolean {
  const ps = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  const words = (ps.stdout ?? '').trim().split(/\s+/);
  return ps.status === 0 && words.includes(SERVER) && words.includes(String(port)) && words.includes(run);
}
interface Carrier { pid: number; command: string }
/**
 * Every process carrying the run token as a word of its command line (the issue's words: down leaves no process
 * carrying its run token). A process table the kit can't read is null, never an empty list. The scan finds what
 * was left; it grants no authority to stop anything (see `started`).
 */
function carrying(run: string): Carrier[] | null {
  const ps = spawnSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8' });
  if (ps.status !== 0 || ps.error) return null;
  return ps.stdout.split('\n').flatMap((line) => {
    const [pid, ...words] = line.trim().split(/\s+/);
    if (!words.includes(run) || !/^\d+$/.test(pid ?? '')) return [];
    return [{ pid: Number(pid), command: words.join(' ') }];
  });
}
/**
 * The pids of the fixture processes the kit's own reference fills started, as their ready markers reported them.
 * The kit signals only these, and only while they still carry the run token: a command line a fill could dress up
 * with the kit's words is no proof the kit started it.
 */
const started = new Set<number>();
const scanned = (run: string): Carrier[] => {
  const left = carrying(run);
  if (left === null) throw new Finding('BLOCKED', 'the process table can\'t be read (ps failed), so whether down left a process is unknown', ['ps_unavailable']);
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
function ask<T>(request: { op: 'lease' | 'probe' | 'listening'; port?: number; path?: string }, timeout = 3000): T {
  if (probes === null) {
    const shared = new SharedArrayBuffer(8 + 65_536);
    const worker = new Worker(PROBES, { workerData: shared });
    worker.unref();
    probes = { worker, flags: new Int32Array(shared, 0, 2), out: new Uint8Array(shared, 8) };
  }
  Atomics.store(probes.flags, 0, 0);
  probes.worker.postMessage(request);
  if (Atomics.wait(probes.flags, 0, 0, timeout) === 'timed-out') { probes.worker.terminate(); probes = null; throw Error(`the ${request.op} probe answered nothing in ${timeout} ms`); }
  return JSON.parse(Buffer.from(probes.out.subarray(0, Atomics.load(probes.flags, 1))).toString('utf8')) as T;
}
/** A free port on the loopback, leased by binding it once. */
export const leasePort = (): number => {
  const { port } = ask<{ port?: number }>({ op: 'lease' });
  if (!Number.isInteger(port) || (port as number) <= 0) throw Error('no free port on the loopback');
  return port as number;
};
interface Probe { status: number | null; body: string; error: string | null }
const probe = (port: number, path: string): Probe => ask<Probe>({ op: 'probe', port, path });
/** Whether something accepts connections on the loopback port. */
const listening = (port: number): boolean => ask<{ open: boolean }>({ op: 'listening', port }).open;

/** Starts the fixture server on `port` carrying `run`, waiting for its ready marker unless `wait` is false; with `helper`, its grandchild too. */
function start(spec: EnvSpec, port: number, run: string, wait: boolean, helper = false): { handle: Handle; child: ChildProcess } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-env-'));
  const ready = join(dir, 'ready');
  const child = spawn(process.execPath, [SERVER, String(port), spec.health, spec.token, String(spec.warmup), ready, run, ...(helper ? ['helper'] : [])], { stdio: 'ignore' });
  child.unref();
  const pid = child.pid ?? -1;
  started.add(pid);
  if (wait && !waitUntil(() => existsSync(ready), 5000)) { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); throw Error(`the environment on ${port} did not come up in 5 s`); }
  if (wait) {
    // The marker names the server's grandchild, if any: a process the kit started through the fill and may stop.
    try { const marker = JSON.parse(readFileSync(ready, 'utf8')) as { helper?: number | null }; if (typeof marker.helper === 'number') started.add(marker.helper); } catch { /* an unreadable marker names nothing */ }
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
      const { handle, child } = start(spec, fault === 'own-port' ? leasePort() : lease.port, lease.token, fault !== 'early', fault === 'leaves');
      started.set(handle.id, child);
      return handle;
    },
    down(handle) {
      const child = started.get(handle.id);
      if (!child) return;
      started.delete(handle.id);
      child.kill('SIGTERM');
      if (!waitUntil(() => child.exitCode !== null || child.signalCode !== null || !alive(child.pid ?? -1), 2000)) child.kill('SIGKILL');
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

/** Two environments from the draw, each with its own health route, token and warm-up (long enough that ready before it is caught). */
const generate = (random: Random): SlotCase[] => [0, 1].map((i) => toCase(`seeded-${i + 1}`, 'seeded', { health: `/health-${word(random, 6)}`, token: word(random, 12), warmup: random.int(40, 80) }));

function* judge(fill: EnvironmentFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const spec = c.input as unknown as EnvSpec;
  // The lease: a port reserved by binding it once and released for the environment to bind, and a run token drawn
  // for this case alone, so a concurrent case or another kit run on the same fixture shares nothing with it. The
  // moment between the release and the environment's bind is open, as it is for the hub's own leases: the slot's
  // interface hands the environment a port number, not a bound socket, and a port taken in that moment fails the
  // reference fill's start loudly (no ready marker), never a rule.
  const lease: Lease = { port: leasePort(), token: `run-${randomBytes(9).toString('hex')}` };
  const handle = object('the handle', yield () => fill.up(spec, lease));
  text('handle/id', handle.id);
  if (!Number.isInteger(handle.port)) throw new Finding('FAIL', `handle/port ${JSON.stringify(handle.port)} is not a port`, ['type']);
  if (!Number.isInteger(handle.pid)) throw new Finding('FAIL', `handle/pid ${JSON.stringify(handle.pid)} is not a pid`, ['type']);
  const pid = handle.pid as number;
  // Only a process the kit started itself and can identify as this case's server is ever signalled; another pid is the fill's claim alone.
  const owned = started.has(pid) && isThisServer(pid, handle.port as number, lease.token);
  try {
    if (handle.port !== lease.port) throw fail(RULES.port.message, ['unleased_port'], `bound ${handle.port}; the lease is ${lease.port}`);
    const answer = probe(lease.port, spec.health);
    if (answer.status !== 200) throw fail(RULES.health.message, ['ready_before_health'], `GET ${spec.health} on ${lease.port} right after up: ${answer.error ?? `status ${answer.status}`}`);
    let token: unknown;
    try { token = (JSON.parse(answer.body) as { token?: unknown }).token; } catch { token = undefined; }
    if (token !== spec.token) throw fail(RULES.health.message, ['health_mismatch'], `health answered with token ${JSON.stringify(token)}, not the spec's`);
    yield () => fill.down(handle as unknown as Handle);
    // Gone means all of: the pid the handle names is no process, nothing answers on the leased port any more, and
    // no process carries the run token (a grandchild the handle never named is caught there).
    if (!waitUntil(() => !alive(pid) && !listening(lease.port) && scanned(lease.token).length === 0, 150)) {
      const left = scanned(lease.token);
      const why = alive(pid) ? `pid ${pid} still runs 150 ms after down${owned ? '' : ' (not the kit\'s server, so left as it is)'}`
        : listening(lease.port) ? `pid ${pid} is gone, but ${lease.port} still accepts connections 150 ms after down`
        : left.length > 0 ? `pid ${pid} is gone, but ${left.map((p) => `pid ${p.pid} (${p.command})`).join(', ')} still carries the run token 150 ms after down`
        : `pid ${pid}, the port and the run token were not all clear within 150 ms of down`;
      throw fail(RULES.down.message, ['process_left'], why);
    }
  } finally {
    // The kit stops only processes it started through the reference fill (its fixture server and helper, by the pids
    // their ready marker reported) that still carry this case's run token; any other pid is left as it is.
    if (owned && alive(pid) && isThisServer(pid, handle.port as number, lease.token)) stop(pid);
    for (const p of carrying(lease.token) ?? []) if (started.has(p.pid)) stop(p.pid);
  }
}

export const environmentKit = (): SlotKitImpl<EnvironmentFill> => ({
  slot: ENVIRONMENT, fills: 'one', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
