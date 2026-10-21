// The environment@1 kit (#314): an environment comes up on the port the hub leased it, is ready only once its
// health route answers with its token, and leaves no process behind when taken down. The reference fill runs
// the kit's fixture server; the kit itself leases the port, probes health and watches the process, so no
// memorized answer can pass it. The planted fills report ready before health answers, bind a port of their own
// and leave their process running.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { fail, Finding } from '../slot-types.js';
import type { Fixture, PlantedFill, SlotCase, SlotFill, SlotKitImpl, SlotRule } from '../slot-types.js';
import { object, text, word } from './shared.js';

export const ENVIRONMENT = 'environment@1';
const SERVER = fileURLToPath(new URL('../../runtime/environment/server.mjs', import.meta.url));

export interface EnvSpec { health: string; token: string; warmup: number }
export interface Lease { port: number }
export interface Handle { id: string; port: number; pid: number }
export interface EnvironmentFill extends SlotFill {
  slot: 'environment@1';
  /** Brings the environment up on the leased port; returns once it is ready. */
  up(spec: EnvSpec, lease: Lease): Handle;
  down(handle: Handle): void;
}

const RULES = {
  health: { id: 'ready-means-healthy', rule: 'up returns only once the environment\'s health route answers on the leased port with the spec\'s token.', message: 'reported ready before its health check answered' },
  port: { id: 'binds-leased-port', rule: 'The environment binds the port the hub leased it and no other.', message: 'bound a port outside its lease' },
  down: { id: 'down-stops-process', rule: 'After down, the environment\'s process is gone and nothing listens on the leased port.', message: 'left its process running after down' },
};
const rules: SlotRule[] = Object.values(RULES).map(({ id, rule }) => ({ id, rule }));

// ---- Processes and ports, synchronously -------------------------------------------------------------

const sleep = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
/** Whether the process still runs; an exited child not yet reaped (a zombie) counts as gone. */
export function alive(pid: number): boolean {
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
function isThisServer(pid: number, port: number, token: string): boolean {
  const ps = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  const words = (ps.stdout ?? '').trim().split(/\s+/);
  return ps.status === 0 && words.includes(SERVER) && words.includes(String(port)) && words.includes(token);
}
const stop = (pid: number): void => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } };

const node = (script: string, timeout = 3000): string => spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout }).stdout.trim();
/** A free port on the loopback, leased by binding it once. */
export const leasePort = (): number => {
  const port = Number(node("const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"));
  if (!Number.isInteger(port) || port <= 0) throw Error('no free port on the loopback');
  return port;
};
interface Probe { status: number | null; body: string; error: string | null }
const probe = (port: number, path: string): Probe => {
  const out = node(`fetch('http://127.0.0.1:${port}${path}').then((r)=>r.text().then((t)=>console.log(JSON.stringify({status:r.status,body:t,error:null})))).catch((e)=>console.log(JSON.stringify({status:null,body:'',error:String(e)})))`);
  try { return JSON.parse(out) as Probe; } catch { return { status: null, body: '', error: out || 'no answer' }; }
};
/** Whether something accepts connections on the loopback port. */
const listening = (port: number): boolean => node(`require('node:net').connect(${port},'127.0.0.1').on('connect',function(){console.log('open');this.destroy()}).on('error',()=>console.log('closed'))`) === 'open';

/** Starts the fixture server on `port`, waiting for its ready marker unless `wait` is false. */
function start(spec: EnvSpec, port: number, wait: boolean): { handle: Handle; child: ChildProcess } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-env-'));
  const ready = join(dir, 'ready');
  const child = spawn(process.execPath, [SERVER, String(port), spec.health, spec.token, String(spec.warmup), ready], { stdio: 'ignore' });
  child.unref();
  const pid = child.pid ?? -1;
  if (wait && !waitUntil(() => existsSync(ready), 5000)) { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); throw Error(`the environment on ${port} did not come up in 5 s`); }
  if (wait) rmSync(dir, { recursive: true, force: true });
  return { handle: { id: `env-${pid}`, port, pid }, child };
}
/** A pid no process has: a child that has already run and been reaped. */
const deadPid = (): number => spawnSync(process.execPath, ['-e', '0']).pid ?? 0;
/**
 * The reference fill signals only the processes it started, through their own handles, never a pid by number.
 * The `leaves` fault is the sly one: its handle names a pid already dead, so a kit that trusted the pid alone would
 * see the process gone, while its server keeps listening on the leased port after down.
 */
function reference(fault: 'none' | 'early' | 'own-port' | 'leaves' = 'none'): EnvironmentFill {
  const started = new Map<string, ChildProcess>();
  return {
    slot: ENVIRONMENT, revision: 1,
    up(spec, lease) {
      const { handle, child } = start(spec, fault === 'own-port' ? leasePort() : lease.port, fault !== 'early');
      started.set(handle.id, child);
      return fault === 'leaves' ? { ...handle, pid: deadPid() } : handle;
    },
    down(handle) {
      const child = started.get(handle.id);
      if (!child) return;
      started.delete(handle.id);
      // The planted fill leaves its server up past the kit's wait, then stops it, so the kit's own check leaks nothing.
      if (fault === 'leaves') { setTimeout(() => child.kill('SIGKILL'), 300); return; }
      child.kill('SIGTERM');
      if (!waitUntil(() => child.exitCode !== null || child.signalCode !== null || !alive(child.pid ?? -1), 2000)) child.kill('SIGKILL');
    },
  };
}

const plant = (name: string, breaks: keyof typeof RULES, codes: string[], fill: EnvironmentFill): PlantedFill<EnvironmentFill> => ({ name, message: RULES[breaks].message, codes, breaks: RULES[breaks].id, fill });
const plantedFills = (): PlantedFill<EnvironmentFill>[] => [
  plant('ready-before-health', 'health', ['ready_before_health'], reference('early')),
  plant('unleased-port', 'port', ['unleased_port'], reference('own-port')),
  plant('leaves-process', 'down', ['process_left'], reference('leaves')),
];

const toCase = (id: string, part: 'fixed' | 'seeded', spec: EnvSpec): SlotCase => ({ id, part, input: spec as unknown as JsonValue, expected: { status: 200, token: spec.token } });
const fixtures: Fixture[] = [
  toCase('health-route', 'fixed', { health: '/health', token: 'fixture-token-a', warmup: 100 }),
  toCase('status-route', 'fixed', { health: '/status/ready', token: 'fixture-token-b', warmup: 70 }),
].map(({ id, input, expected }) => ({ id, input, expected }));

/** Two environments from the draw, each with its own health route, token and warm-up. */
const generate = (random: Random): SlotCase[] => [0, 1].map((i) => toCase(`seeded-${i + 1}`, 'seeded', { health: `/health-${word(random, 6)}`, token: word(random, 12), warmup: random.int(100, 200) }));

function* judge(fill: EnvironmentFill, c: SlotCase): Generator<() => unknown, void, unknown> {
  const spec = c.input as unknown as EnvSpec;
  const lease: Lease = { port: leasePort() };
  const handle = object('the handle', yield () => fill.up(spec, lease));
  text('handle/id', handle.id);
  if (!Number.isInteger(handle.port)) throw new Finding('FAIL', `handle/port ${JSON.stringify(handle.port)} is not a port`, ['type']);
  if (!Number.isInteger(handle.pid)) throw new Finding('FAIL', `handle/pid ${JSON.stringify(handle.pid)} is not a pid`, ['type']);
  const pid = handle.pid as number;
  // Only a process the kit can identify as this case's server is ever signalled; another pid is the fill's claim alone.
  const owned = isThisServer(pid, handle.port as number, spec.token);
  try {
    if (handle.port !== lease.port) throw fail(RULES.port.message, ['unleased_port'], `bound ${handle.port}; the lease is ${lease.port}`);
    const answer = probe(lease.port, spec.health);
    if (answer.status !== 200) throw fail(RULES.health.message, ['ready_before_health'], `GET ${spec.health} on ${lease.port} right after up: ${answer.error ?? `status ${answer.status}`}`);
    let token: unknown;
    try { token = (JSON.parse(answer.body) as { token?: unknown }).token; } catch { token = undefined; }
    if (token !== spec.token) throw fail(RULES.health.message, ['health_mismatch'], `health answered with token ${JSON.stringify(token)}, not the spec's`);
    yield () => fill.down(handle as unknown as Handle);
    // Gone means both: the pid the handle names is no process, and nothing answers on the leased port any more; a
    // handle naming a dead pid while the server listens on is caught at the port.
    if (!waitUntil(() => !alive(pid) && !listening(lease.port), 150)) {
      throw fail(RULES.down.message, ['process_left'], alive(pid) ? `pid ${pid} still runs 150 ms after down${owned ? '' : ' (not the kit\'s server, so left as it is)'}` : `pid ${pid} is gone, but ${lease.port} still accepts connections 150 ms after down`);
    }
  } finally {
    // The kit stops only a process it started through the reference fill and can still identify; any other pid is left.
    if (owned && alive(pid) && isThisServer(pid, handle.port as number, spec.token)) stop(pid);
  }
}

export const environmentKit = (): SlotKitImpl<EnvironmentFill> => ({
  slot: ENVIRONMENT, fills: 'one', revision: 1, rules, fixtures, planted: plantedFills(),
  clean: () => [reference()], generate, judge,
});
