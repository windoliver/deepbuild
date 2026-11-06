// Test-side tools for #994's real-process tests (README): the app as a process (`deep-app`, a copy of the built binary)
// with its log on stderr, a hub whose clock steps forward, an app connection to the hub, and the judges. The homes, the
// hub, `deep setup`, the Claude Code stand-in and asks raised through a session's own `deep mcp` are #27's
// (tests/acceptance/27/helpers.ts): nothing there stands in for DeepBuild.
//
// Safety: every folder is a temp folder #27's helpers make and remove, and HOME is one for every process a test starts,
// so nothing reads or writes the real ~/.deepbuild. Processes are stopped by PID only.
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import {
  allEvents, beginAsk, childEnv, deep, editConfig, jsonLines, makeHome, makeRepo, NODE, own, parseObject, REPO, rootOf, run, setup, shown, sleep,
  startHub, tempDir, type Hub, type Line, type Ran,
} from '../27/helpers.ts';

export { allEvents, cleanup, control, inboxRows, makeHome, rootOf, setup, shown, sleep, startHub, stopHub, tempDir, within } from '../27/helpers.ts';
export type { Hub, Line } from '../27/helpers.ts';

// The criteria (README: Criteria, tests and wrong programs): the first 8 hex of the SHA-256 of each criterion's text.
export const AC1 = 'AC1 #994.1399c6a7';
export const AC2 = 'AC2 #994.428580db';
export const AC3 = 'AC3 #994.649376f0';
export const AC5 = 'AC5 #994.f8ef6a91';

/** NOTIFY_AFTER, a 250 ms tick, and the stream and the log's pipe: what "within the notification delay" allows a real process. */
export const NOTIFIED_WITHIN_MS = 2000;
/** Long enough after an ask opens for a notifier that would post it to have posted it. */
export const SETTLE_MS = 4000;
/** Long enough after the first frame for an app that connects off the window's path to have connected. */
export const CONNECTED_MS = 3000;

export type Setting = 'allowed' | 'denied' | 'alerts_none';

export function onMac(): void {
  if (platform() !== 'darwin') throw Error('BLOCKED: the app and the replica run on macOS only, so this test did not run');
}

// ---- The binaries: each build's binary is copied, so the plain and the planted one sit side by side.
const binaries = new Map<string, Promise<string>>();
let building: Promise<unknown> = Promise.resolve();
/** Builds one package's binary, one build at a time; a failed build is BLOCKED, with cargo's last words. */
function built(args: string[], key: string, binary: string): Promise<string> {
  let made = binaries.get(key);
  if (!made) {
    made = building.then(async () => {
      const r = await run('cargo', ['build', '--locked', '-q', ...args], { env: process.env, cwd: REPO, timeoutMs: 1_800_000 });
      if (r.code !== 0) throw Error(`BLOCKED: cargo build ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
      const copy = join(tempDir(), binary);
      copyFileSync(join(REPO, 'target/debug', binary), copy);
      return copy;
    });
    building = made.catch(() => undefined);
    binaries.set(key, made);
  }
  return made;
}
/** deep-app; with `plant`, built with that cargo feature (README: The wrong programs). */
export const appBinary = (plant?: string): Promise<string> => built(['-p', 'deep-app', '--bin', 'deep-app', ...(plant ? ['--features', plant] : [])], plant ?? 'deep-app', 'deep-app');
export const replicaBinary = (): Promise<string> => built(['-p', 'deep-replica', '--bin', 'deep-replica'], 'deep-replica', 'deep-replica');

// ---- The app as a process.
export interface LogLine { at: number; text: string }
export interface App { pid: number; home: string; child: ChildProcess; lines: LogLine[]; exit: Promise<number | null>; exited(): boolean; log(): string }
/**
 * The real app in its window mode, HOME `home`. `setting` is what it reads in place of the OS's answer
 * (DEEP_APP_NOTIFICATION_SETTING, README: The surface); none reads the OS, as the bundle's run in taste.test.ts does.
 */
export async function startApp(home: string, setting: Setting | undefined, o: { plant?: string; binary?: string } = {}): Promise<App> {
  onMac();
  const binary = o.binary ?? await appBinary(o.plant);
  const child = spawn(binary, [], { cwd: dirname(home), env: childEnv(home, { DEEP_APP_NOTIFICATION_SETTING: setting }), stdio: ['ignore', 'pipe', 'pipe'] });
  own(child.pid);
  const lines: LogLine[] = [];
  let partial = '';
  const take = (chunk: string) => {
    partial += chunk;
    const parts = partial.split('\n');
    partial = parts.pop()!;
    for (const text of parts) lines.push({ at: Date.now(), text });
  };
  child.stdout!.setEncoding('utf8').on('data', take);
  child.stderr!.setEncoding('utf8').on('data', take);
  let gone = false;
  const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => { gone = true; resolve(code); }));
  return { pid: child.pid!, home, child, lines, exit, exited: () => gone, log: () => lines.map((l) => l.text).join('\n') };
}
/** Waits for the window's first frame, the line the app has printed since #337, and for it to reach the hub if there is one. */
export async function windowUp(app: App, ms = 120_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!app.lines.some((l) => l.text.startsWith('first-frame-ms'))) {
    if (app.exited() || Date.now() > deadline) throw Error(`BLOCKED: the app drew no first frame${app.exited() ? ' and exited' : ` in ${ms} ms`}: ${app.log().slice(-1500)}`);
    await sleep(50);
  }
}
const notified = (app: App, ask: string) => app.lines.filter((l) => l.text.startsWith('deep-app: notified ') && l.text.endsWith(` ${ask}`));
const notNotified = (app: App, ask: string) => app.lines.filter((l) => l.text.startsWith('deep-app: not notified ') && l.text.includes(` ${ask}`));

// ---- Asks, raised by a session of its own Claude Code through deep_ask.
export interface Opened { handle: string; session: string; ts: number }
/** A session in `repo` asks through deep_ask; resolves once the hub has filed the ask. The tool call stays open, as for an unanswered ask. */
export async function openAsk(hub: Hub, repo: string): Promise<Opened> {
  const begun = await beginAsk(hub, hub.home, { cwd: repo });
  void begun.finish().catch(() => undefined);
  const created = (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === begun.s.id);
  if (!created) throw Error(`BLOCKED: no ask.created for session ${begun.s.id}`);
  return { handle: `ask:${created.id}`, session: begun.s.id, ts: created.ts > 1e14 ? Math.round(created.ts / 1e6) : created.ts };
}

export interface World { home: string; repo: string; hub: Hub }
/** A home DeepBuild is set up in, with a repo for its sessions and the hub answering. `edit` changes your settings first. */
export async function setUpWorld(start: (home: string) => Promise<Hub> = (home) => startHub(home), edit?: (config: Line) => void): Promise<World> {
  const { home } = makeHome();
  const repo = makeRepo(home).dir;
  if (edit) editConfig(home, edit);
  const hub = await start(home);
  await setup(home);
  return { home, repo, hub };
}

// ---- The judges: each returns the failure, naming the ask, or undefined.
/** AC1: `ask` was notified within the delay of opening. A notification that came late on a loaded machine is a reading, not a failure. */
export async function notifiedInTime(app: App, ask: Opened): Promise<string | undefined> {
  const deadline = ask.ts + NOTIFIED_WITHIN_MS;
  while (Date.now() < deadline + SETTLE_MS && !notified(app, ask.handle).length) await sleep(50);
  const line = notified(app, ask.handle)[0];
  if (!line) return `${ask.handle} was never notified: the app's log has no "deep-app: notified ... ${ask.handle}"; the log ends ${JSON.stringify(app.log().slice(-600))}`;
  const took = line.at - ask.ts;
  if (took <= NOTIFIED_WITHIN_MS) return undefined;
  const load = loadavg()[0]!;
  if (load > availableParallelism() / 2) throw Error(`INCONCLUSIVE: ${ask.handle} was notified ${took} ms after it opened, past ${NOTIFIED_WITHIN_MS} ms, at a load of ${load}`);
  return `${ask.handle} was notified ${took} ms after it opened, past the ${NOTIFIED_WITHIN_MS} ms the notification delay allows`;
}
/** AC2: across every app that ran, one post of `ask`. */
export function notifiedOnce(apps: App[], ask: string): string | undefined {
  const posts = apps.flatMap((app) => notified(app, ask).map((l) => `${app.pid}: ${l.text}`));
  if (posts.length === 1) return undefined;
  return `${ask} should be notified once; it was notified ${posts.length} times: ${JSON.stringify(posts)}`;
}
/** AC3: the log never says `ask` notified, and says it wasn't. */
export function neverNotified(app: App, ask: string): string | undefined {
  const posts = notified(app, ask);
  if (posts.length) return `notifications are off, yet the log says ${ask} was notified: ${JSON.stringify(posts.map((l) => l.text))}`;
  if (!notNotified(app, ask).length) return `the log should say ${ask} was not notified ("deep-app: not notified <session> ${ask}: ..."); it ends ${JSON.stringify(app.log().slice(-600))}`;
  return undefined;
}
export function holds(failure: string | undefined): void {
  if (failure) expect.fail(`#994 ${failure}`);
}
/** A wrong program must fail through the same judge, saying why, and name `ask`. */
export function failsNaming(failure: string | undefined, ask: string, why: RegExp): void {
  if (!failure) expect.fail(`#994 the wrong program should fail, yet the judge passed it: ${ask}`);
  expect(failure, 'the failure names the ask').toContain(ask);
  expect(failure, 'the failure says why').toMatch(why);
}

/** A second person's home, whose app reads the same hub: one app per home, so this app really runs, a second notifier on one hub. */
export function anotherHomeOn(hub: Hub): string {
  const { home } = makeHome();
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  writeFileSync(join(rootOf(home), 'config.json'), `${JSON.stringify({ hub: { address: `unix:${hub.socket}` } })}\n`);
  copyFileSync(join(hub.root, 'control.token'), join(rootOf(home), 'control.token'));
  return home;
}

// ---- A socket that takes each attempt and hangs up: a hub that isn't answering, and when the app tried it.
export interface Listener { attempts: number[]; close(): void }
export function hangingUp(home: string): Promise<Listener> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  // The app reads the hub's token before it connects, and a hub that ran has left one.
  writeFileSync(join(rootOf(home), 'control.token'), 'left by an earlier hub\n');
  const attempts: number[] = [];
  const server = net.createServer((sock) => { attempts.push(Date.now()); sock.destroy(); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(join(rootOf(home), 'hub.sock'), () => resolve({ attempts, close: () => server.close() }));
  });
}
/** Connections within 400 ms of each other are one attempt: the app's other readers may each try. */
export function attemptTimes(times: readonly number[]): number[] {
  const out: number[] = [];
  for (const t of times) if (!out.length || t - out[out.length - 1]! > 400) out.push(t);
  return out;
}

// ---- A hub on the test clock, and a connection that says hello as the app.
/** `deep hub run` with its clock stepped by test.clock (#965). */
export async function startSteppingHub(home: string): Promise<Hub> {
  const child = spawn(NODE, [join(REPO, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: REPO, env: childEnv(home, { DEEP_HUB_TEST_CLOCK_STEPS: '1' }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), root: rootOf(home), child, output: () => out };
}
export interface AppConnection { report(setting: Setting): Promise<void>; close(): void }
/** The app's side of the hub's socket, kept open: `report` is the pinned `notifications.report`. */
export async function connectAsApp(hub: Hub): Promise<AppConnection> {
  const sock = net.connect(hub.socket);
  sock.setEncoding('utf8');
  const waiting: ((line: Line) => void)[] = [];
  let buffer = '';
  sock.on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = parseObject(buffer.slice(0, i)) ?? {};
      buffer = buffer.slice(i + 1);
      waiting.shift()?.(line);
    }
  });
  const next = () => new Promise<Line>((resolve) => waiting.push(resolve));
  await next(); // The hub's hello.
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  sock.write(`${JSON.stringify({ v: 1, hello: 'app', token })}\n`);
  const role = await next();
  if (role.role !== 'app') throw Error(`BLOCKED: the hub refused the app's hello: ${JSON.stringify(role)}`);
  let ids = 0;
  return {
    report: async (setting) => {
      const id = `report#${++ids}`;
      sock.write(`${JSON.stringify({ v: 1, id, method: 'notifications.report', params: { setting } })}\n`);
      const reply = await next();
      if ('error' in reply) expect.fail(`#994 the hub should take notifications.report from the app: ${JSON.stringify(reply.error).slice(0, 400)}`);
    },
    close: () => sock.destroy(),
  };
}

// ---- `deep doctor`.
export interface DoctorItem { item: string; code: string; level: string; evidence: string; fix: string }
export interface Doctor { items: DoctorItem[]; ran: Ran }
export async function doctor(home: string): Promise<Doctor> {
  const ran = await deep(home, ['doctor', '--json'], { timeoutMs: 300_000 });
  return { items: jsonLines(ran.stdout) as unknown as DoctorItem[], ran };
}
export const notificationsItem = (d: Doctor): DoctorItem | undefined => d.items.find((i) => i.item === 'app.notifications');
/** The item fails, and its text names the setting and where to change it; `deep doctor` exits 1. */
export function failsNamingSetting(d: Doctor, setting: RegExp): void {
  const item = notificationsItem(d);
  if (!item) expect.fail(`#994 deep doctor should list app.notifications: ${shown(d.ran)}`);
  if (item.level !== 'fail') expect.fail(`#994 app.notifications should fail: ${JSON.stringify(item)}`);
  if (!setting.test(`${item.evidence} ${item.fix}`)) expect.fail(`#994 app.notifications should name the setting (${setting}): ${JSON.stringify(item)}`);
  if (!/System Settings/.test(item.fix)) expect.fail(`#994 app.notifications's fix should name System Settings: ${JSON.stringify(item)}`);
  if (d.ran.code !== 1) expect.fail(`#994 deep doctor should exit 1 with an item failed: ${shown(d.ran)}`);
}

// ---- The first screen: `deep-replica --first-screen`, #1002's surface, for this home.
export interface Screen { names: string[]; png: string; size: [number, number]; ran: Ran }
export async function firstScreen(home: string, out: string): Promise<Screen> {
  onMac();
  const replica = await replicaBinary();
  const ran = await run(replica, ['--first-screen', '--out', out, '--appearance', 'light'], { env: childEnv(home), cwd: dirname(home), timeoutMs: 300_000 });
  const file = join(out, 'snapshots', 'first-screen.json');
  const png = join(out, 'screens', 'first-screen.png');
  if (ran.code !== 0 || !existsSync(file) || !existsSync(png)) throw Error(`BLOCKED: deep-replica --first-screen must draw this home's first screen: ${shown(ran)}`);
  const names: string[] = [];
  const walk = (n: Line) => {
    for (const v of [n.name, n.value]) if (typeof v === 'string') names.push(v);
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c as Line);
  };
  walk((parseObject(readFileSync(file, 'utf8')) ?? {}).tree as Line ?? {});
  return { names, png, size: pngSize(png), ran };
}
export function pngSize(path: string): [number, number] {
  const bytes = readFileSync(path);
  return bytes.subarray(1, 4).toString('latin1') === 'PNG' ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : [0, 0];
}
export const HUB_NOT_ANSWERING = /\bhub\b.*(isn['’]t|not) answering/i;
