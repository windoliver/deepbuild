// Test-side tools for #1843 (README). Two windows. The replica: the real `deep-drive` on its virtual clock, launched on
// #1462's fixture record in the mode that draws only the frames a real window would (#1546), its presses answered for by
// `test-confirm`'s file. The real app: `deep-app` on a real hub's record in a temp home, read, moved, resized and pressed
// from outside its process by probe.swift, its answers read from the hub's record alone.
//
// Reused by import: #1462's `deep-drive` client, its fixture record and snapshot readers; #1101's build of `deep-drive`
// with `env-plants` and `test-confirm`; #16's homes, hub, socket and PID cleanup; #26's seeding; #1461's builds check;
// #1463's `quiet`.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was started
// with; nothing touches the real ~/.deepbuild, ~/.claude, ~/Library/LaunchAgents or Keychain; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askSources } from '../../../packages/asks/src/index.ts';
import { allEvents, childEnv, control, makeHome, newSession, NODE, own, REPO, run, sha256, startHub, tempDir, waitFor, type Ev, type Hub } from '../16/helpers.ts';
import { askData, seed, ulid } from '../26/helpers.ts';
import { cleanup, needBuilds } from '../1461/helpers.ts';
import { ASKS, askAt, byId, Drive, FLICKS, RECORD, type HubCall, type SNode, type Snapshot } from '../1462/helpers.ts';
import { quiet } from '../1463/helpers.ts';
import { driveBin } from '../1101/helpers.ts';

export { cleanup, waitFor };
export const MIN = 60_000;
const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
type Line = Record<string, any>;

/** The criteria, by `#1843.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = { clock: '#1843.5a8eb94d', resized: '#1843.3a7ab2f8', raised: '#1843.0a3b77c9' } as const;

/** The design's `rearm_on` triggers this issue's table takes (Question card; `content` is #327's). */
export const TRIGGERS = ['move', 'resize', 'occluded', 'display', 'activation'] as const;
export type Trigger = (typeof TRIGGERS)[number];
/**
 * The planted wrong programs (README, Plants), one a trigger: `DEEP_HUB_PLANT=card-ignores-<trigger>`, read through
 * `plain::planted` in an `env-plants` build only. The card takes no notice of that trigger: what it was, it stays.
 */
export const plantOf = (trigger: Trigger): string => `card-ignores-${trigger}`;

/** A file the `test-confirm` stand-in reads in place of the OS's prompt: `confirmed` is you (#1454). */
function confirmFile(): string {
  const file = join(tempDir(), 'confirm');
  writeFileSync(file, 'confirmed\n');
  return file;
}

// ---- The replica, on its virtual clock.

/** One frame of the replica's clock, a 60th of a second, and `ms` of it, in flicks: 300, 500, 600 and 800 ms are whole frames. */
export const FRAME = FLICKS / 60;
export const flicks = (ms: number): number => (ms * FLICKS) / 1000;
/** The ask whose card is presented: the record's choice, opened while another ask's card shows. */
export const ASK = ASKS.choice;
/** The option pressed: neither the recommended nor the default. */
export const OPTION = ASK.options[1]!;
/** The reference window, in points (design: Decided), and the size `resize` gives it, which the card still fits. */
const SMALLER = [1400, 900] as const;

/**
 * What the platform says of the window for each trigger, one call after another, each a frame of the clock (README,
 * Surface 1): the window elsewhere on its display; its content another size (the base's own call); covered, then
 * uncovered; on another display; another window key, then this one.
 */
export const SAYS: Record<Trigger, Line[]> = {
  move: [{ call: 'window', window: { origin: [120, 80] } }],
  resize: [{ call: 'resize', resize: { size: SMALLER } }],
  occluded: [{ call: 'window', window: { visible: false } }, { call: 'window', window: { visible: true } }],
  display: [{ call: 'window', window: { display: 2 } }],
  activation: [{ call: 'window', window: { active: false } }, { call: 'window', window: { active: true } }],
};

export class Replica {
  /** The replica's clock at its last reply, in flicks since its launch. */
  t = 0;
  private constructor(private readonly drive: Drive) {}
  static async start(plant?: string): Promise<Replica> {
    if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
    const drive = await Drive.start(await driveBin(true), { DEEP_APP_TEST_CONFIRM: confirmFile(), ...(plant ? { DEEP_HUB_PLANT: plant } : {}) });
    const r = new Replica(drive);
    await r.must('the replica launches on the fixture record', { call: 'launch', launch: { from: 'fixture', fixture: RECORD, center: 'deepbuild/needs-you', frames: 'dirty', read_back: 'off' } });
    return r;
  }
  async call(args: Line): Promise<Line> {
    const reply = await this.drive.call(args);
    if (typeof reply.t === 'number') this.t = reply.t;
    return reply;
  }
  async must(what: string, args: Line): Promise<Line> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply, 400)}`);
    return reply;
  }
  /** Lets the clock run, a frame at a time, until it reads `t`. */
  async until(t: number): Promise<void> { await this.must('waiting on the replica\'s clock', { call: 'wait_for', wait_for: { t }, timeout: 60_000 }); }
  async see(): Promise<{ snapshot: Snapshot; hub: HubCall[] }> {
    const reply = await this.must('see', { call: 'see' });
    return { snapshot: reply.snapshot as Snapshot, hub: (reply.hub ?? []) as HubCall[] };
  }
  /** The card's value: `presented`, `armed` or `answered` (#1459), or `no card`. */
  async card(): Promise<string> { return String(byId((await this.see()).snapshot, 'question-card')?.value ?? 'no card'); }
  /** The answers the app sent its hub for the ask. */
  async answers(): Promise<Line[]> { return (await this.see()).hub.filter((c) => c.method === 'ask.answer' && c.params?.ask === ASK.handle).map((c) => c.params as Line); }
  /** A press on the option now, down and up, at the middle of where it is drawn: no wait for it to be still. */
  async press(): Promise<void> {
    const node: SNode = byId((await this.see()).snapshot, `card-option:${OPTION.id}`) ?? blocked(`the replica's window shows no card-option:${OPTION.id}`);
    const [x, y, w, h] = node.bounds as [number, number, number, number];
    await this.must(`a press on "${OPTION.label}"`, { call: 'act', act: { kind: 'click', point: [Math.round(x + w / 2), Math.round(y + h / 2)] } });
  }
  open(address: string): Promise<Line> { return this.must(`opening ${address}`, { call: 'open', open: { address } }); }
  stop(): Promise<void> { return this.drive.stop(); }
}
export { askAt };

// ---- The real app's build (README, How to run): one, with the stand-ins and the plants, copied out of the target folder.

const BIN = join(tmpdir(), `dd1843-bin-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`);
const TARGET = process.env.CARGO_TARGET_DIR ?? join(REPO, 'target');
const quoted = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
let built: Promise<string> | undefined;
/**
 * `deep-app` with `env-plants` (DEEP_HUB_PLANT names a plant; none is none), `test-confirm` (a file is the OS confirming
 * you) and `test-secrets` (a file is the Keychain). In one grant of the build throttle, which a run inside a grant passes
 * through; the plain build follows, so the target folder never keeps a plant.
 */
export function appBin(): Promise<string> {
  built ??= (async () => {
    const copy = join(BIN, 'deep-app-plants');
    const cargo = 'cargo build --locked -q -p deep-app --bin deep-app';
    const script = [`mkdir -p ${quoted(BIN)}`, `${cargo} --features env-plants,test-confirm,test-secrets`, `cp ${quoted(join(TARGET, 'debug', 'deep-app'))} ${quoted(copy)}`, cargo].join(' && ');
    const r = await run(NODE, ['scripts/throttle.mjs', 'build', '--wait', '240', '--', '/bin/sh', '-c', script], { env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' }, timeoutMs: 480 * MIN });
    return r.code === 0 ? copy : blocked(`the build of deep-app failed (exit ${r.code}): ${(r.stderr || r.stdout).slice(-1500)}`);
  })();
  return built;
}
let compiled: Promise<string> | undefined;
function probeBin(): Promise<string> {
  compiled ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const source = join(SUITE, 'probe.swift');
    const out = join(BIN, `probe-${sha256(readFileSync(source)).slice(0, 12)}`);
    const r = await run('swiftc', ['-O', '-module-cache-path', join(BIN, 'swift-cache'), source, '-o', out], { timeoutMs: 10 * MIN });
    return r.code === 0 ? out : blocked(`probe.swift didn't compile: ${r.stderr.slice(-600)}`);
  })();
  return compiled;
}
/** One command of probe.swift; a screen no one can read, before it or behind it, is BLOCKED. */
async function probe<T>(...args: (string | number)[]): Promise<T> {
  const bin = await probeBin();
  const out = await new Promise<string>((resolve, reject) => execFile(bin, args.map(String), { maxBuffer: 64 * 1024 * 1024, timeout: 15 * MIN }, (error, stdout, stderr) => (error ? reject(Error(`probe ${args[0]}: ${error.message} ${String(stderr).slice(-300)}`)) : resolve(stdout))));
  const reply = JSON.parse(out) as T | { refused: string };
  if (reply && typeof reply === 'object' && 'refused' in reply) return blocked(reply.refused);
  return reply as T;
}
/** BLOCKED unless an assistive client can read and move a real window now: macOS, Accessibility, an awake and unlocked screen. */
export async function realWindowAccess(): Promise<void> {
  if (process.platform !== 'darwin') blocked(`the app draws on macOS only; this is ${process.platform}`);
  const gates = await probe<{ ax: boolean; unreadable: string | null; idle: number }>('gates');
  if (!gates.ax) blocked('this process has no Accessibility permission, so nothing can read or move the real window; grant it to the app the tests run under');
  if (gates.unreadable) blocked(gates.unreadable);
}

// ---- The real hub's world.

export interface Option { id: string; label: string; decision: 'none' }
export interface AskSpec { title: string; question: string; options: Option[] }
export interface Ask { handle: string; question: string; options: Option[] }
export interface World { home: string; hub: Hub; asks: Ask[] }

/**
 * One session an ask, each a choice raised by the asks core into the record with the hub stopped (#26's `seed`), its first
 * option recommended and the default; setup finished; then a real hub on it, the OS confirming you.
 */
export async function makeWorld(specs: readonly AskSpec[]): Promise<World> {
  needBuilds();
  const home = makeHome();
  const base = tempDir();
  const dir = join(base, 'shop');
  mkdirSync(dir);
  // A git folder names the project; none of this process's GIT_* variables reach git.
  const git = await run('/usr/bin/git', ['init', '-q'], { cwd: dir, env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' } });
  if (git.code !== 0) blocked(`git init of the fixture's folder failed: ${git.stderr.slice(-200)}`);
  const source = askSources().find((r) => r.kind === 'choice' && !/^(asks|request)\./.test(r.source))?.source ?? blocked('ask.sources@1 has no row for choice');
  const first = Date.now() - (specs.length + 2) * MIN;
  const asks: Ask[] = [];
  await seed(home, async (s) => {
    for (const [i, spec] of specs.entries()) {
      const at = first + i * MIN;
      const { id } = newSession(home, 'claude-code', dir);
      s.at(at);
      await s.start(id, dir);
      const who = { actor: 'you', scope: 'you', session: id, project: 'shop' };
      await s.record.append({ writer: 'app', ...who } as never, { v: 1, id: ulid(at), kind: 'task.created', ts: at, data: { task_ref: `task:${ulid(at)}`, thread: id, owner: 'you', title: spec.title } } as never);
      s.at(at + 2000);
      const data = { ...askData('choice', spec.question, s.now(), s.now() + 48 * 60 * MIN), options: spec.options, recommended: spec.options[0]!.id, default: spec.options[0]!.id };
      asks.push({ handle: await s.asks.raise({ writer: 'core', ...who } as never, source, data), question: spec.question, options: spec.options });
    }
  }, first);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version }));
  const hub = await startHub({ home, env: { DEEP_HUB_TEST_CONFIRM: confirmFile() } }, 10 * MIN);
  await quiet(hub);
  return { home, hub, asks };
}
/** The first `ask.answered` the hub recorded for the ask within `ms`, or null. */
export async function answered(w: World, ask: Ask, ms: number): Promise<Ev | null> {
  const conn = await control(w.hub);
  try {
    return await waitFor(async () => (await allEvents(conn)).find((e) => e.kind === 'ask.answered' && e.subject === ask.handle), ms, `an answer to ${ask.handle}`);
  } catch (error) {
    if (/^timed out/.test((error as Error).message)) return null;
    throw error;
  } finally {
    conn.close();
  }
}
export const answerNamed = (ask: Ask, e: Ev): string => `${ask.handle} ("${ask.question}") with ${said(e.data?.answer)}`;

// ---- The real app.

export type Box = [number, number, number, number];
export interface Card { value: string | null; address: string | null; window: Box; options: { id: string; frame: Box }[]; front: boolean }
export interface Resized { window: Box; reads: { ms: number; value: string | null }[]; clicks: { ms: number; option: string; at: [number, number] }[] }
export interface Raised { pressed: string; took_ms: number; front: boolean; was: string | null; cursor_back: boolean }
export const middle = (f: Box): [number, number] => [f[0] + f[2] / 2, f[1] + f[3] / 2];
export const fmt = (f: readonly number[]): string => `[${f.map((v) => Math.round(v)).join(', ')}]`;
/** Whether `inner` lies wholly in `outer`, to the half point a layout rounds by. */
export const inside = (inner: Box, outer: Box): boolean => inner[2] > 0 && inner[3] > 0 && inner[0] >= outer[0] - 0.5 && inner[1] >= outer[1] - 0.5
  && inner[0] + inner[2] <= outer[0] + outer[2] + 0.5 && inner[1] + inner[3] <= outer[1] + outer[3] + 0.5;
/** The part two boxes share, or null. */
export function shared(a: Box, b: Box): Box | null {
  const [x, y] = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  const [w, h] = [Math.min(a[0] + a[2], b[0] + b[2]) - x, Math.min(a[1] + a[3], b[1] + b[3]) - y];
  return w > 4 && h > 4 ? [x, y, w, h] : null;
}

/** Where the app's window is put: the top left of the main display, clear of the menu bar. */
export const AT = [40, 60] as const;
export const OPENING = [960, 640] as const;
export const SMALL = [700, 400] as const;

export class App {
  private err = '';
  private constructor(readonly child: ChildProcess, private readonly forward: number) {
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-8000); });
  }
  get pid(): number { return this.child.pid!; }
  get exited(): boolean { return this.child.exitCode !== null || this.child.signalCode !== null; }
  stderr(): string { return this.err.slice(-800); }
  /** Starts the app in the world's home, `plant` its DEEP_HUB_PLANT, its window at 960×640, forward, with a card drawn. */
  static async launch(w: World, plant?: string): Promise<App> {
    await realWindowAccess();
    const bin = await appBin();
    await realWindowAccess();
    const [, , width, height] = await probe<Box>('screen');
    if (width < OPENING[0] + 320 || height < OPENING[1] + 120) blocked(`the main display, ${width} × ${height}, can't hold a ${OPENING[0]} × ${OPENING[1]} window and a second one beside it`);
    const forward = await probe<number>('forward');
    const env = { DEEP_APP_TEST_CONFIRM: confirmFile(), DEEP_APP_TEST_SECRETS: join(tempDir(), 'secrets.json'), DEEP_HUB_PLANT: plant };
    const child = spawn(bin, [], { cwd: REPO, env: childEnv(w.home, env), stdio: ['ignore', 'ignore', 'pipe'] });
    own(child.pid);
    const app = new App(child, forward);
    try {
      const drawn = await app.card('any', 'any', 180);
      if (app.exited) blocked(`deep-app exited (${child.exitCode ?? child.signalCode}) before its window: ${app.stderr()}`);
      if (drawn.value === null) blocked(`deep-app drew no question card in 180 s: its window is ${fmt(drawn.window)}, its page ${said(drawn.address)}; ${app.stderr()}`);
      await app.place(...OPENING);
      await app.front();
      return app;
    } catch (error) {
      await app.stop();
      throw error;
    }
  }
  /** The window at its place, `w` × `h`. */
  async place(w: number, h: number): Promise<Box> {
    const got = await probe<Box>('place', this.pid, ...AT, w, h);
    if (Math.abs((got[2] ?? 0) - w) > 1 || Math.abs((got[3] ?? 0) - h) > 1) blocked(`the real window couldn't be set to ${w} × ${h}: it reads ${fmt(got)}`);
    return got;
  }
  async front(): Promise<void> {
    if (!(await probe<{ front: boolean }>('front', this.pid)).front) blocked('macOS didn\'t bring the app forward when asked, so its window is never the active one');
  }
  card(want: string, address: string, seconds: number): Promise<Card> { return probe('card', this.pid, want, address, seconds); }
  /** The card once it reads `armed` on the ask's page; a failure when it doesn't within 60 s. */
  async armed(ask: Ask, when: string): Promise<Card> {
    const card = await this.card('armed', askAt(ask.handle), 60);
    if (card.value !== 'armed' || card.address !== askAt(ask.handle)) throw Error(`${when}, the card for ${ask.handle} never armed in 60 s: it reads ${said(card.value)} on ${said(card.address)}`);
    return card;
  }
  async click(at: readonly [number, number]): Promise<void> {
    if (!(await probe<{ clicked: boolean }>('click', this.pid, ...at)).clicked) blocked(`the app has no window on screen at ${fmt(at)} to click`);
  }
  resized(w: number, h: number, at: readonly [number, number], marks: readonly number[]): Promise<Resized> { return probe('resized', this.pid, w, h, ...at, ...marks); }
  /** The window server's own click, the one step that takes the real cursor (README, The cursor). */
  raise(at: readonly [number, number], option: string): Promise<Raised> { return probe('raise', this.pid, ...at, option, 120); }
  /** Whether the app is the one macOS has forward. */
  async forwardNow(): Promise<boolean> { return (await probe<number>('forward')) === this.pid; }
  async stop(): Promise<void> {
    if (!this.exited) {
      this.child.kill('SIGTERM');
      await waitFor(() => this.exited, 5000, 'deep-app to end').catch(() => this.child.kill('SIGKILL'));
    }
    // What was forward before this suite's window is forward again, when it can be.
    if (this.forward > 0) await probe('front', this.forward, 'keep').catch(() => undefined);
  }
}

/** A small window of another app's, forward, until `stop`; BLOCKED when macOS doesn't bring it forward. */
export async function otherAppForward(app: App): Promise<{ stop: () => Promise<void> }> {
  const [, , width, height] = await probe<Box>('screen');
  const child = spawn(await probeBin(), ['behind', String(width - 260), String(height - 200)], { stdio: ['pipe', 'pipe', 'ignore'] });
  own(child.pid);
  let out = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
  const stop = async (): Promise<void> => {
    child.stdin.end();
    await waitFor(() => child.exitCode !== null || child.signalCode !== null, 5000, 'the other app to end').catch(() => child.kill('SIGKILL'));
  };
  try {
    await waitFor(() => out.includes('"ready"'), 20_000, 'the other app\'s window').catch(() => blocked(`the other app's window didn't open: ${said(out)}`));
    const { front } = await probe<{ front: boolean }>('front', child.pid!);
    if (!front || (await app.forwardNow())) blocked('macOS didn\'t bring another app forward, so the app\'s window never went inactive');
    return { stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
