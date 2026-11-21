// #2573's helpers: a real dev hub (`deep hub run --root <folder>`) in a sandbox of its own, told to stop with the
// `hub.stop` call on its socket, then its process's exit code and its logs/hub.log.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const HOLD = fileURLToPath(new URL('./hold.mjs', import.meta.url));
/** What the log of a hub whose timers read the closed record holds. */
export const CLOSED = 'The database connection is not open';

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export interface World { box: string; home: string; root: string; log: string; mark: string }
interface Started { child: ChildProcess; exit: Promise<{ code: number | null; signal: string | null }>; ended: boolean }
const worlds: World[] = [];
const hubs: Started[] = [];

/** A sandbox under /tmp (the socket's path must stay short) with a HOME of its own. */
export function world(): World {
  const box = mkdtempSync('/tmp/d2573-');
  const w = { box, home: join(box, 'home'), root: join(box, 'r'), log: join(box, 'r', 'logs', 'hub.log'), mark: join(box, 'mark') };
  mkdirSync(w.home);
  mkdirSync(join(w.root, 'logs'), { recursive: true, mode: 0o700 });
  worlds.push(w);
  return w;
}

/** `deep hub run --root <root>`, started as `deep hub start --root` starts it: its own session, both outputs in hub.log. */
export function runHub(w: World, holdMs?: number): Started {
  const log = openSync(w.log, 'a', 0o600);
  const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: w.home };
  if (holdMs) Object.assign(env, { NODE_OPTIONS: `--import=${HOLD}`, D2573_HOLD_MS: String(holdMs), D2573_MARK: w.mark });
  const child = spawn(process.execPath, [CLI, 'hub', 'run', '--root', w.root], { cwd: w.box, env, stdio: ['ignore', log, log], detached: true });
  closeSync(log);
  const started: Started = { child, ended: false, exit: new Promise((done) => child.once('exit', (code, signal) => { started.ended = true; done({ code, signal }); })) };
  hubs.push(started);
  return started;
}

interface Talk { hello: Record<string, unknown>; call(o: Record<string, unknown>): Promise<Record<string, unknown>>; close(): void }
const connect = (path: string) => new Promise<Talk>((done, fail) => {
  const sock = net.connect(path);
  const lines: Record<string, unknown>[] = [];
  let buffer = '', wake: (() => void) | undefined, failed: Error | undefined;
  const stop = (error: Error) => { failed ??= error; wake?.(); fail(error); };
  sock.setEncoding('utf8');
  sock.on('error', stop);
  sock.on('close', () => stop(Error('the hub closed the connection')));
  sock.on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { lines.push(JSON.parse(buffer.slice(0, i)) as Record<string, unknown>); buffer = buffer.slice(i + 1); }
    wake?.();
  });
  const next = async () => {
    while (!lines.length) { if (failed) throw failed; await new Promise<void>((r) => { wake = r; }); }
    return lines.shift()!;
  };
  next().then((hello) => done({ hello, call: (o) => { sock.write(`${JSON.stringify({ v: 1, ...o })}\n`); return next(); }, close: () => sock.destroy() }), () => undefined);
});

/** Waits for the hub's hello on its socket: the moment the hub first answers after its start. */
export async function answered(w: World, hub: Started, withinMs = 120_000): Promise<Talk> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    try { return await connect(join(w.root, 'hub.sock')); } catch { /* not listening yet */ }
    if (hub.ended) throw Error(`BLOCKED: the hub ended before it answered:\n${readFileSync(w.log, 'utf8')}`);
    if (Date.now() > deadline) throw Error(`BLOCKED: no hub answered on ${w.root}/hub.sock within ${withinMs} ms`);
    await sleep(10);
  }
}

/** The `hub.stop` call, as the CLI makes it: the root's control token, then the method. */
export async function stopCall(w: World, talk: Talk): Promise<void> {
  const role = await talk.call({ hello: 'cli', token: readFileSync(join(w.root, 'control.token'), 'utf8').trim() });
  if (role.error) throw Error(`BLOCKED: the hub refused the control token: ${JSON.stringify(role.error)}`);
  const reply = await talk.call({ id: 'stop', method: 'hub.stop', params: {} });
  if (!(reply.result as { stopping?: boolean } | undefined)?.stopping) throw Error(`BLOCKED: hub.stop was not taken: ${JSON.stringify(reply)}`);
  talk.close();
}

type Mark = { pid: number; at: number; mark: 'held' | 'released'; ms?: number };
const marks = (w: World): Mark[] => (existsSync(w.mark) ? readFileSync(w.mark, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Mark) : []);
/** Waits for a line the held hub writes to its marker file. */
export async function marked(w: World, mark: Mark['mark'], hub: Started, withinMs: number): Promise<Mark> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const found = marks(w).find((m) => m.mark === mark);
    if (found) return found;
    if (hub.ended || Date.now() > deadline) throw Error(`BLOCKED: the hold wrote no "${mark}" line (${hub.ended ? 'the hub ended' : `within ${withinMs} ms`}); marks: ${JSON.stringify(marks(w))}`);
    await sleep(20);
  }
}

/** Waits for hub.log to hold `text`. */
export async function logged(w: World, text: string, hub: Started, withinMs: number): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!readFileSync(w.log, 'utf8').includes(text)) {
    if (hub.ended || Date.now() > deadline) throw Error(`BLOCKED: hub.log never held ${text}:\n${readFileSync(w.log, 'utf8')}`);
    await sleep(50);
  }
}

/** The hub's exit, or undefined if it still runs after `withinMs`; the timer goes with the exit, so nothing waits on it. */
export async function ended(hub: Started, withinMs: number): Promise<{ code: number | null; signal: string | null } | undefined> {
  let stop = () => undefined as void;
  const timeout = new Promise<undefined>((done) => {
    const timer = setTimeout(done, withinMs);
    stop = () => clearTimeout(timer);
  });
  try {
    return await Promise.race([hub.exit, timeout]);
  } finally {
    stop();
  }
}

export interface Ended { code: number | null; signal: string | null; log: string; heldMs: number }
/**
 * One play of the scene: a hub started, told to stop `when` it should be, its exit held `holdMs`, then what it
 * ended with. `early` stops it on the connection that first got its hello; `late` waits until the hub wrote its
 * ready line and `lateMs` passed since it first answered.
 */
export async function play(when: 'early' | 'late', holdMs: number, lateMs = 0): Promise<Ended> {
  const w = world();
  const hub = runHub(w, holdMs);
  const talk = await answered(w, hub);
  if (when === 'late') {
    await Promise.all([logged(w, '"ready":true', hub, 180_000), sleep(lateMs)]);
  }
  await stopCall(w, talk);
  const held = await marked(w, 'held', hub, 30_000);
  const end = await ended(hub, holdMs + 60_000);
  if (!end) throw Error(`BLOCKED: the hub was still running ${holdMs + 60_000} ms after its stop was held:\n${readFileSync(w.log, 'utf8')}`);
  const released = marks(w).find((m) => m.mark === 'released');
  if (!released) throw Error(`BLOCKED: the hub ended before the hold let go; marks: ${JSON.stringify(marks(w))}`);
  return { ...end, log: readFileSync(w.log, 'utf8'), heldMs: released.at - held.at };
}

/** After each test: every hub this file started and that still runs is stopped by its PID, every sandbox removed. */
export async function cleanup(): Promise<void> {
  for (const hub of hubs.splice(0)) {
    if (hub.ended || hub.child.pid === undefined) continue;
    hub.child.kill('SIGTERM');
    if (!(await ended(hub, 40_000))) hub.child.kill('SIGKILL');
    await hub.exit;
  }
  for (const w of worlds.splice(0)) rmSync(w.box, { recursive: true, force: true });
}
