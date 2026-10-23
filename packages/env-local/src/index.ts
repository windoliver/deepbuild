// @deepbuild/env-local (#331): the first-party environment. It starts the repo's own dev script, as the
// `environment:` block of `.deepbuild/done.yaml` in the folder it is given names it, through host@1 alone, on
// ports the supervisor leases per worktree, and reports it ready only once its health route answers 200. It never
// spawns, signals or waits for a process itself: the supervisor (#236) tracks every one by its run token and
// start time and stops only those. Compose stacks are not run yet: their block is refused as BLOCKED.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { join } from 'node:path';
import type { SlotFill } from '@deepbuild/conformance';
import type { Grant, Host, ResourceKind, Supervisor } from '@deepbuild/supervisor';
import { parse } from 'yaml';

/** The `environment:` block of done.yaml. */
interface Environment {
  /** The repo's own dev script, run by /bin/sh in the folder the stack starts from. */
  up?: string;
  /** A compose file in that folder (#331 AC11, not run yet). */
  compose?: string;
  /** Each name a port leased per worktree, passed to the stack as the variable of that name. */
  ports: string[];
  /** Ready only once GET on this URL, its `${name}`s filled with the leased ports, answers 200, within `within` seconds. */
  ready: { http: string; within: number };
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// The health route is on this machine's loopback, on a leased port when the stack has any: an answer from anywhere
// else can't say the stack is ready.
const ROUTE = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:\$\{(\w+)\}|(\d+))(?:[/?#]|$)/;
/** The environment block of the folder's .deepbuild/done.yaml; throws naming what is wrong with it. */
function readEnvironment(folder: string): Environment {
  const file = join(folder, '.deepbuild', 'done.yaml');
  if (!existsSync(file)) throw Error(`${file} doesn't exist, so there is no environment to start`);
  const doc = parse(readFileSync(file, 'utf8')) as { environment?: unknown } | null;
  const env = doc?.environment as Record<string, unknown> | undefined;
  if (typeof env !== 'object' || env === null) throw Error(`${file} has no environment: block`);
  const { up, compose, ports = [], ready } = env as { up?: unknown; compose?: unknown; ports?: unknown; ready?: unknown };
  if ((typeof up === 'string') === (typeof compose === 'string')) throw Error(`${file}: environment names exactly one of up (a command) or compose (a file)`);
  if (!Array.isArray(ports) || ports.some((p) => typeof p !== 'string' || !NAME.test(p))) throw Error(`${file}: environment.ports is a list of variable names`);
  const r = ready as { http?: unknown; within?: unknown } | undefined;
  if (typeof r?.http !== 'string') throw Error(`${file}: environment.ready.http names the health route's URL`);
  const route = ROUTE.exec(r.http);
  const named = [...r.http.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]!);
  if (!route || named.some((name) => !(ports as string[]).includes(name)) || ((ports as string[]).length > 0 && route[1] === undefined)) {
    throw Error(`${file}: environment.ready.http is http:// on 127.0.0.1, localhost or [::1], at \${name} of a leased port when there are ports, and names no other variable`);
  }
  const within = r.within ?? 60;
  if (typeof within !== 'number' || !(within > 0) || !Number.isFinite(within)) throw Error(`${file}: environment.ready.within is a finite number of seconds`);
  return { ...(typeof up === 'string' ? { up } : { compose: compose as string }), ports: ports as string[], ready: { http: r.http, within } };
}

/** The port kind as `lease.kind@1` data: ports match by exact key. */
const PORT_KIND = { name: 'port', match: 'exact', cap: 1000, cooldown: 0, cost: 0 } as const;
const HOSTS = ['127.0.0.1', '0.0.0.0', '::'];
/** Whether lsof shows no listener on the port, on any address; a failed lsof is not proof, so not free. */
const unlisted = (port: number): Promise<boolean> => new Promise((resolve) => {
  execFile('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
    // lsof exits 1 with no output when nothing matches.
    resolve(stdout.trim() === '' && (!error || ((error as { code?: unknown }).code === 1 && stderr.trim() === '')));
  });
});
/** Answers whether a connection to the port on the host is refused. */
const refused = (port: number, host: string): Promise<boolean> => new Promise((resolve) => {
  const s = net.connect({ port, host });
  const done = (free: boolean) => { s.destroy(); resolve(free); };
  s.once('connect', () => done(false));
  s.once('error', (error: NodeJS.ErrnoException) => done(error.code !== 'ETIMEDOUT'));
  s.setTimeout(1000, () => done(false));
});
/**
 * Whether nothing on this machine listens on the port: it binds on every address, nothing answers on 127.0.0.1 or
 * ::1, and lsof shows no listener (one on a single address, ::1 or the LAN's, lets a wildcard bind succeed beside it).
 */
async function portFree(port: number): Promise<boolean> {
  for (const host of HOSTS) {
    const bound = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL'));
      s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
    });
    if (!bound) return false;
  }
  return (await refused(port, '127.0.0.1')) && (await refused(port, '::1')) && unlisted(port);
}
/** The supervisor's port kind: from 3000 up, each port checked free before it is leased; `free: false` only for a planted wrong program. */
export function portKind(options: { free?: boolean } = {}): ResourceKind {
  return {
    kind: PORT_KIND.name, port: true, keys: Array.from({ length: PORT_KIND.cap }, (_, i) => String(3000 + i)),
    ...(options.free === false ? {} : { free: (key: string) => portFree(Number(key)) }),
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A fresh run handle, run:<ULID>. */
export function newRun(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  return `run:${time}${Array.from(randomBytes(16), (b) => CROCKFORD[b % 32]).join('')}`;
}

/** One GET of the health URL: its status, or why it got none. */
function get(url: string): Promise<{ status: number | null; error?: string }> {
  return new Promise((resolve) => {
    let req: http.ClientRequest;
    try {
      req = http.get(url, { timeout: 1000 }, (res) => { res.resume(); resolve({ status: res.statusCode ?? null }); });
    } catch (error) {
      resolve({ status: null, error: (error as Error).message });
      return;
    }
    req.on('timeout', () => { req.destroy(); resolve({ status: null, error: 'no answer within 1 s' }); });
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ status: null, error: e.code ?? e.message }));
  });
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Stack { run: string; pid: number; ports: Record<string, number>; /** Its health route, its ports filled in. */ url: string }
/** Whether the stack's health route answers 200 now. */
export const answers = async (stack: Stack): Promise<boolean> => (await get(stack.url)).status === 200;
export type Up = { status: 'ready'; stack: Stack } | { status: 'BLOCKED'; run: string; cause: string };
interface UpOptions {
  run: string;
  /** The folder the stack starts from and reads its environment block in: a worktree, or a check's checkout. */
  folder: string;
  /** Ports already leased, by name (the kit's); otherwise each is leased through the host. */
  ports?: Record<string, number>;
  /** Added to the stack's environment; DEEP_RUN_TOKEN here is the run token the host gives it. */
  env?: Record<string, string>;
}

/**
 * Brings the folder's stack up through the host and waits for its health route. A stack that never answers 200 in
 * time, or whose command ends first, is signalled down and BLOCKED, the cause naming the route and its last answer.
 */
export async function upStack(host: Host, o: UpOptions): Promise<Up> {
  let env: Environment;
  try {
    env = readEnvironment(o.folder);
  } catch (error) {
    return { status: 'BLOCKED', run: o.run, cause: (error as Error).message };
  }
  if (env.compose !== undefined) return { status: 'BLOCKED', run: o.run, cause: `compose stacks (${env.compose}) aren't run yet (#331 AC11)` };
  const given = o.ports ?? {};
  const missing = env.ports.filter((name) => given[name] === undefined);
  if (o.ports && missing.length) return { status: 'BLOCKED', run: o.run, cause: `no port given for ${missing.join(', ')}` };
  const listen = Object.values(given).map((p) => `127.0.0.1:${p}`);
  // Your files and programs, as you, and the leased ports to listen on (the supervisor adds the ones it leases).
  const grant: Grant = { run_as_you: true, ...(listen.length ? { listen, hosts: listen } : {}) };
  const started = await host.start({
    // The shell's $0 names the run on its command line: the kit's run token where one is given, else the run.
    run: o.run, argv: ['/bin/sh', '-c', env.up!, o.env?.DEEP_RUN_TOKEN ?? o.run], cwd: o.folder, grant,
    env: { ...o.env, ...Object.fromEntries(Object.entries(given).map(([k, v]) => [k, String(v)])) },
    ...(o.ports ? {} : { leases: env.ports.map((name) => ({ kind: PORT_KIND.name, env: name })) }),
  });
  if (started.status === 'BLOCKED') return { status: 'BLOCKED', run: o.run, cause: `no ${started.kind} is free to lease` };
  const ports = { ...given, ...Object.fromEntries(started.leases.filter((l) => l.kind === PORT_KIND.name).map((l, i) => [env.ports[i]!, Number(l.key)])) };
  try {
    return await ready(host, o, env, started.pid, ports);
  } catch (error) {
    // Whatever goes wrong once it started, the stack is signalled down, never left running unrecorded.
    await downStack(host, o.run);
    return { status: 'BLOCKED', run: o.run, cause: `the stack started, then its health couldn't be checked: ${(error as Error).message}` };
  }
}

/** Polls the started stack's health route until it answers 200; one that doesn't in time, or ends first, is signalled down and BLOCKED. */
async function ready(host: Host, o: UpOptions, env: Environment, pid: number, ports: Record<string, number>): Promise<Up> {
  const url = env.ready.http.replace(/\$\{(\w+)\}/g, (all, name: string) => (ports[name] !== undefined ? String(ports[name]) : all));
  const route = (() => { try { const u = new URL(url); return `GET ${u.pathname} on ${u.host}`; } catch { return `GET ${url}`; } })();
  let ended: string | undefined;
  void host.wait(o.run).then((exit) => { ended = exit.signal ?? `code ${exit.code}`; }, () => undefined);
  const deadline = Date.now() + env.ready.within * 1000;
  let last = 'nothing';
  for (;;) {
    const answer = await get(url);
    if (answer.status === 200) return { status: 'ready', stack: { run: o.run, pid, ports, url } };
    last = answer.status !== null ? `answered ${answer.status}` : `gave no answer (${answer.error})`;
    if (ended !== undefined || Date.now() > deadline) break;
    await sleep(50);
  }
  await downStack(host, o.run);
  const why = ended !== undefined ? `the stack's command ended (${ended}) before ${route} answered 200; it last ${last}` : `${route} ${last}, not 200, within ${env.ready.within} s`;
  return { status: 'BLOCKED', run: o.run, cause: why };
}

/** Signals the stack's run down through the host, SIGKILL after a grace, until the host says its process ended. */
export async function downStack(host: Host, run: string): Promise<void> {
  const exited = host.wait(run).then(() => true, () => true);
  await host.signal(run, 'SIGTERM').catch(() => undefined);
  if (!(await Promise.race([exited, sleep(2000).then(() => false)]))) {
    await host.signal(run, 'SIGKILL').catch(() => undefined);
    await Promise.race([exited, sleep(2000)]);
  }
}

// ---- env-local as an environment@1 fill (#314's kit): up(spec, lease, checkout), down(handle).

interface Handle { id: string; port: number; pid: number }
/** env-local as an environment@1 fill, starting every process through `host`; the kit's lease gives the port and run token. */
export function envLocal(options: { host: Host }): SlotFill {
  const { host } = options;
  return {
    slot: 'environment@1', revision: 1,
    async up(_spec: unknown, lease: { port: number; token: string }, checkout: string): Promise<Handle> {
      const env = readEnvironment(checkout);
      if (env.ports.length !== 1) throw Error(`the kit leases one port, and ${checkout}'s environment names ${env.ports.length}`);
      const run = newRun();
      const up = await upStack(host, { run, folder: checkout, ports: { [env.ports[0]!]: lease.port }, env: { DEEP_RUN_TOKEN: lease.token } })
        .catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }));
      if (up.status === 'BLOCKED') {
        // A stack refused before it started is no run of the host's; its cause is what the kit hears.
        await (host as Partial<Supervisor>).cleanup?.(run)?.catch(() => undefined);
        throw Error(up.cause);
      }
      return { id: run, port: lease.port, pid: up.stack.pid };
    },
    async down(handle: Handle): Promise<void> {
      await downStack(host, handle.id);
      // A supervisor as the host closes the run's records too; host@1 alone has no cleanup.
      await (host as Partial<Supervisor>).cleanup?.(handle.id);
    },
  };
}
