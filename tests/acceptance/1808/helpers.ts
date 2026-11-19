// Test-side tools for #1808 (README). Every world is a record a real hub made: sessions, titles, states and asks are
// seeded through the record and asks core with the hub stopped (#26's `seed`), and `deep hub run` then builds the
// list's rows (`row.set`) as its first backfill, as #1461's suite does. The window is read two ways: the real
// `deep-drive` (#124) launched with `launch.from: "record_copy"` in the world's HOME, on its virtual clock, which draws
// the real app's tree (design: Replica); and, for the kept frame (AC3) and the pictures (AC9), the real `deep-app` read
// and driven from outside its process (probe.swift), keys and pointer events posted to its PID alone.
//
// Reused by import: #16's homes, hub, temp folders and PID cleanup; #26's seeding; #1463's `quiet` and `deep status
// --json`; #1461's readers of the window (the list, its rows and slots, the page, the strings drawn) and its `row.set`.
//
// Safety: HOME is a temp folder for every process started; a process is stopped only by the PID it was started with;
// nothing touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { askSources } from '../../../packages/asks/src/index.ts';
import { childEnv, DAY, makeHome, newSession, own, REPO, sha256, sleep, startHub, tempDir, type Hub } from '../16/helpers.ts';
import { askData, seed, ulid } from '../26/helpers.ts';
import { jsonRows, quiet } from '../1463/helpers.ts';
import {
  byId, cleanup, flat, FLICKS, flicks, listOf, listRows, MIN, needBuilds, pageOf, rowSet, runsIn, SECOND, slot,
  type Row, type Run, type SNode, type Snapshot,
} from '../1461/helpers.ts';

export { byId, cleanup, flat, jsonRows, listOf, listRows, MIN, pageOf, REPO, runsIn, SECOND, sleep, slot, tempDir };
export type { Row, Run, SNode, Snapshot };
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
const said = (v: unknown, n = 300): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
type Line = Record<string, any>;

/** The criteria, by `#1808.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  list: '#1808.ba86d5b6',
  page: '#1808.86c051bf',
  kept: '#1808.f340f4c7',
  narrow: '#1808.ad9b29cb',
  card: '#1808.952d3557',
  titles: '#1808.445ec374',
  twelve: '#1808.98ed0a32',
  fold: '#1808.d7b1f43e',
  shown: '#1808.d5e52086',
} as const;

/** The planted wrong programs (README, Surface choices), each read through `plain::planted` in an env-plants build only. */
export const PLANT = {
  /** AC1: the list draws its rows from the top and cuts them at its foot: neither the wheel nor Down moves what it draws. */
  listClips: 'list-clips',
  /** AC2: a page cuts what's past its lane's foot, as the base's does, and the wheel over it moves nothing. */
  pageClips: 'page-clips',
  /** AC3: the app opens centred at the opening size, 960×640, at every launch, whatever it kept. */
  openingSize: 'opens-at-opening-size',
  /** AC4: under 848 wide the page's title row draws no count, and the count is nowhere else on the page. */
  noCount: 'narrow-no-count',
  /** AC5: an ask's card grows with its rows past its slot, as the base's does, and never arms. */
  cardGrows: 'card-grows-past-slot',
  /** AC6: a row's title draws whole on one line, uncut, over the state word and time slots to its right. */
  titleUnder: 'title-under-word',
  /** AC7: a row's title shows its first 8 characters and an ellipsis, whatever room its slot has. */
  titleEight: 'title-shows-8',
  /** AC8: a card with options folded behind a count arms once its interval ran, its fold opened or not. */
  armsFolded: 'card-arms-folded',
} as const;

/** The window the app opens at (`clean.json` shell sizes), and the narrow one AC4 names, in points. */
export const OPENING = { width: 960, height: 640 } as const;
export const NARROW = { width: 700, height: 640 } as const;

// ---- Builds (README, How to run): this checkout's binaries, each copied out of the target folder into a folder named
// for the checkout, so another worktree's build never stands in for this one, and a plant's build never for the plain.

const BIN = join(tmpdir(), `dd1808-bin-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
function cargo(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('cargo', ['build', '--locked', '-q', ...args], { cwd: REPO, env: CARGO_ENV, maxBuffer: 64 * 1024 * 1024 }, (error, _out, stderr) => {
      if (!error) return resolve();
      reject(Error(`BLOCKED: cargo build ${args.join(' ')} failed: ${String(stderr).split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || String(stderr).slice(-600)}`));
    });
  });
}
/** Copied beside and renamed into place: a binary rewritten where it lies can be killed at its next start on macOS. */
function keep(name: string, as: string): string {
  mkdirSync(BIN, { recursive: true });
  const out = join(BIN, as);
  const next = `${out}.${process.pid}.new`;
  copyFileSync(target(name), next);
  renameSync(next, out);
  return out;
}
let drives: Promise<{ plain: string; plants: string }> | undefined;
/** `deep-drive` with deep-app's `test-confirm` (a file stands in for the OS confirming you), and with `env-plants` too. */
export function driveBins(): Promise<{ plain: string; plants: string }> {
  drives ??= (async () => {
    if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`);
    await cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants,deep-app/test-confirm']);
    const plants = keep('deep-drive', 'deep-drive-plants');
    await cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'deep-app/test-confirm']);
    return { plain: keep('deep-drive', 'deep-drive-plain'), plants };
  })();
  return drives;
}
let apps: Promise<{ plain: string; plants: string }> | undefined;
/** The real `deep-app` as shipped, and with `env-plants` (AC3's plant). */
export function appBins(): Promise<{ plain: string; plants: string }> {
  apps ??= (async () => {
    if (process.platform !== 'darwin') blocked(`the app draws on macOS only; this is ${process.platform}`);
    await cargo(['-p', 'deep-app', '--bin', 'deep-app', '--features', 'env-plants']);
    const plants = keep('deep-app', 'deep-app-plants');
    await cargo(['-p', 'deep-app', '--bin', 'deep-app']);
    return { plain: keep('deep-app', 'deep-app-plain'), plants };
  })();
  return apps;
}

// ---- The worlds (README, The fixtures): sessions seeded in git folders named for their projects, then a real hub.

export interface Option { id: string; label: string; decision: 'allow' | 'deny' | 'none' }
/** An ask raised by the core: the kind's own two options (#26's), or `options` with its recommended and default; a plan of `steps`. */
export interface AskSpec { kind: 'authority' | 'taste' | 'choice'; question: string; options?: Option[]; recommended?: string | null; default?: string; steps?: string[] }
export interface SessionSpec { key: string; project: string; title: string; state?: 'working' | 'finished' | 'failed'; asks?: AskSpec[] }
export interface WorldSession { key: string; id: string; project: string; title: string }
export interface WorldAsk { handle: string; question: string; key: string; session: string; options: Option[] }
export interface World { home: string; hub: Hub; sessions: WorldSession[]; asks: WorldAsk[] }
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
const sourceOf = (kind: string): string => askSources().find((r) => r.kind === kind && !/^(asks|request)\./.test(r.source))?.source ?? blocked(`ask.sources@1 has no row for ${kind}`);

/**
 * Seeds `specs` in order, a minute apart, the last a minute before now: each session's start in `<base>/<project>` (a git
 * folder, so the hub names its project by the folder), its task's title, its state (`session.attention`), and its asks
 * raised by the asks core, an authority ask with its plan. Then setup finished and a real hub, whose first build of the
 * list is the backfill of every row.
 */
export async function makeWorld(specs: readonly SessionSpec[]): Promise<World> {
  needBuilds();
  const home = makeHome();
  const base = tempDir();
  const dirs = new Map<string, string>();
  for (const project of new Set(specs.map((s) => s.project))) {
    const dir = join(base, project);
    mkdirSync(dir, { recursive: true });
    await new Promise<void>((resolve, reject) => execFile('git', ['init', '-q'], { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: dir } }, (e) => (e ? reject(e) : resolve())));
    dirs.set(project, dir);
  }
  const sessions: WorldSession[] = specs.map((spec) => ({ key: spec.key, id: newSession(home, 'claude-code', dirs.get(spec.project)!).id, project: spec.project, title: spec.title }));
  const asks: WorldAsk[] = [];
  const first = Date.now() - (specs.length + 1) * MIN;
  await seed(home, async (s) => {
    for (const [i, spec] of specs.entries()) {
      const at = first + i * MIN;
      const { id } = sessions[i]!;
      s.at(at);
      await s.start(id, dirs.get(spec.project)!);
      const who = { actor: 'you', scope: 'you', session: id, project: spec.project };
      await s.record.append({ writer: 'app', ...who }, { v: 1, id: ulid(at), kind: 'task.created', ts: at, data: { task_ref: `task:${ulid(at)}`, thread: id, owner: 'you', title: spec.title } });
      if (spec.state && spec.state !== 'working') {
        s.at(at + 1000);
        await s.record.append({ writer: 'core', ...who }, { v: 2, id: ulid(at + 1000), kind: 'session.attention', ts: at + 1000, subject: `session:${letters(id)}`, data: { state: spec.state } });
      }
      for (const [k, a] of (spec.asks ?? []).entries()) {
        s.at(at + 2000 + k * 1000);
        const data = {
          ...askData(a.kind, a.question, s.now(), s.now() + 2 * DAY),
          ...(a.options ? { options: a.options } : {}),
          ...(a.recommended !== undefined ? { recommended: a.recommended } : {}),
          ...(a.default ? { default: a.default } : {}),
        };
        const plan = a.steps
          ? { steps: a.steps.map((does) => ({ does, changes: [does], undo: 'git revert the commit', public: true, cost: 0 })), diff: sha256(a.question) }
          : undefined;
        const handle = await s.asks.raise({ writer: 'core', ...who }, sourceOf(a.kind), data, plan);
        asks.push({ handle, question: a.question, key: spec.key, session: id, options: data.options as Option[] });
      }
    }
  }, first);
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version }));
  const confirm = join(base, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const hub = await startHub({ home, env: { DEEP_HUB_TEST_CONFIRM: confirm } });
  await quiet(hub);
  return { home, hub, sessions, asks };
}
export const sessionOf = (w: World, key: string): WorldSession => w.sessions.find((s) => s.key === key) ?? blocked(`the world has no session ${key}`);
export const askOf = (w: World, key: string): WorldAsk => w.asks.find((a) => a.key === key) ?? blocked(`the world has no ask on ${key}`);
export const askAt = (handle: string): string => `ask/${handle.slice('ask:'.length)}`;

/** The titles AC6 and AC9 name: 200 characters, Han and Arabic; and AC7's, which reads INCONCLUSIVE. */
export const TITLE = {
  long: 'Rework how the checkout works out the cart total, the tax lines and the shipping estimate so each is computed once on the server, kept with the session and shown the same on the cart page and receipts',
  han: '修复购物车在叠加多个折扣后总价四舍五入出错的问题并补充覆盖所有边界情况的单元测试',
  arabic: 'إصلاح خطأ التقريب في مجموع سلة التسوق بعد تطبيق عدة خصومات متتالية على الطلب نفسه',
  twelve: 'Reconciliation of ledger exports across regions',
} as const;

/** AC5's approval: a push whose plan is 30 steps, each a row of its card. */
export const THIRTY: AskSpec = {
  kind: 'authority',
  question: 'Push the 30 release commits to origin/main?',
  steps: Array.from({ length: 30 }, (_, i) => `Push commit ${String(i + 1).padStart(2, '0')} of 30 to origin/main`),
};
/** AC8's choice: twelve options, the first recommended and the default. */
export const TWELVE: AskSpec = {
  kind: 'choice',
  question: 'Which accent does the new theme use?',
  options: ['Teal', 'Indigo', 'Amber', 'Crimson', 'Olive', 'Slate', 'Coral', 'Plum', 'Sand', 'Mint', 'Rust', 'Ivory']
    .map((name, i): Option => ({ id: `accent-${i + 1}`, label: `${name} accent`, decision: 'none' })),
  recommended: 'accent-1',
  default: 'accent-1',
};

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export interface Seen { snapshot: Snapshot; rows: Row[]; address: string | null; hub: { method: string; params?: Line }[] }
export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  /** The replica's clock at its last reply, in flicks since launch. */
  t = 0;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Line;
        try { parsed = JSON.parse(line) as Line; } catch { parsed = { unparsed: line }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** A replica in `home` (the world's, so `record_copy` reads its hub); `plant` its DEEP_HUB_PLANT, in the planted build. */
  static async start(home: string, plant?: string): Promise<Replica> {
    const bins = await driveBins();
    const dir = tempDir();
    const out = join(dir, 'out');
    mkdirSync(out, { recursive: true });
    const confirm = join(dir, 'confirm');
    writeFileSync(confirm, 'confirmed\n');
    const child = spawn(plant ? bins.plants : bins.plain, ['--out', out], { cwd: REPO, env: childEnv(home, { DEEP_HUB_PLANT: plant, DEEP_APP_TEST_CONFIRM: confirm }), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const r = new Replica(child);
    const ready = await r.next(300_000);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${r.err.slice(-600)}`);
    return r;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Line): Promise<Line> {
    const reply = this.next(600_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${said(got)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  /** One call that must answer ok; else a failure naming `what` and the replica's own error. */
  async must(what: string, args: Line): Promise<Line> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply, 400)}`);
    return reply;
  }
  launch(launch: Line): Promise<Line> { return this.must(`launching the replica with ${said(launch)}`, { call: 'launch', launch }); }
  async see(): Promise<Seen> {
    const r = await this.must('see', { call: 'see' });
    return { snapshot: r.snapshot as Snapshot, rows: (r.rows ?? []) as Row[], address: (r.address ?? null) as string | null, hub: (r.hub ?? []) as Seen['hub'] };
  }
  /** Lets `ms` of the replica's clock pass with no input. */
  async wait(ms: number): Promise<void> {
    const t = this.t + flicks(ms);
    await this.must(`waiting ${ms} ms`, { call: 'wait_for', wait_for: { t }, timeout: ms + 2000 });
  }
  /** The replica's clock, in ms since launch. */
  ms(): number { return Math.round((this.t * 1000) / FLICKS); }
  click(locator: Line, what = `a click on ${said(locator)}`): Promise<Line> { return this.must(what, { call: 'act', locator, act: { kind: 'click' } }); }
  press(keys: string): Promise<Line> { return this.must(`pressing ${keys}`, { call: 'act', act: { kind: 'press', keys } }); }
  /** The wheel over `locator`'s middle, `dy` points toward the end of what scrolls there (#124's `act scroll`). */
  scroll(locator: Line, dy: number): Promise<Line> { return this.must(`the wheel over ${said(locator)}`, { call: 'act', locator, act: { kind: 'scroll', dx: 0, dy } }); }
  open(address: string): Promise<Line> { return this.must(`deep_drive's open of ${address}`, { call: 'open', open: { address } }); }
  feed(session: string, event: Line): Promise<Line> { return this.must(`feeding ${String(event.kind)}`, { call: 'feed', feed: { session, event } }); }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}
/** A replica of the world's record at `size`, opened where the app opens; with `plant`, the planted build. */
export async function replicaOf(w: World, size: { width: number; height: number }, plant?: string): Promise<Replica> {
  const r = await Replica.start(w.home, plant);
  await r.launch({ from: 'record_copy', size: [size.width, size.height] });
  await r.wait(1000);
  return r;
}

// ---- Reading the window (README, Surface choices). Bounds are [x, y, w, h] in device pixels.

export type Box = number[];
export const windowBox = (s: Snapshot): Box => [0, 0, s.window.size[0]! * s.window.scale, s.window.size[1]! * s.window.scale];
export function cross(a: Box, b: Box): Box {
  const x = Math.max(a[0]!, b[0]!);
  const y = Math.max(a[1]!, b[1]!);
  return [x, y, Math.max(0, Math.min(a[0]! + a[2]!, b[0]! + b[2]!) - x), Math.max(0, Math.min(a[1]! + a[3]!, b[1]! + b[3]!) - y)];
}
export const inside = (b: Box, box: Box, slack = 1): boolean => b[0]! >= box[0]! - slack && b[1]! >= box[1]! - slack && b[0]! + b[2]! <= box[0]! + box[2]! + slack && b[1]! + b[3]! <= box[1]! + box[3]! + slack;
export const overlap = (a: Box, b: Box): boolean => a[0]! < b[0]! + b[2]! && b[0]! < a[0]! + a[2]! && a[1]! < b[1]! + b[3]! && b[1]! < a[1]! + a[3]!;
/** Shown to a person: the node wholly inside `view`, with a string drawn inside it. */
export const showing = (s: Snapshot, n: SNode | undefined, view: Box): boolean =>
  !!n && n.bounds[2]! > 0 && n.bounds[3]! > 0 && inside(n.bounds, view) && runsIn(s, n.bounds).length > 0;
/** What of the list is on screen: its node's bounds inside the window. */
export const listView = (s: Snapshot): Box | undefined => { const l = listOf(s); return l ? cross(l.bounds, windowBox(s)) : undefined; };
/** What of the page is on screen: its node's (the one whose id is an address) bounds inside the window. */
export const pageView = (s: Snapshot): Box | undefined => { const p = pageOf(s); return p ? cross(p.bounds, windowBox(s)) : undefined; };
/** Every name, string value and drawn string in the window that holds `text`. */
export function saying(s: Snapshot, text: string): string[] {
  const out: string[] = [];
  for (const n of flat(s.tree)) {
    for (const t of [n.name, typeof n.value === 'string' ? n.value : null]) if (t && t.includes(text)) out.push(`${n.role} ${said(n.id ?? null, 60)} "${t.slice(0, 80)}"`);
  }
  for (const r of s.runs ?? []) if (r.text.includes(text)) out.push(`the string drawn "${r.text.slice(0, 80)}"`);
  return out;
}
export const HOLD_STILL = 'Hold still';
/** A row named as a failure names it: its id and its title. */
export const named = (rows: readonly Row[], id: string): string => `${id} ("${String(rows.find((r) => r.id === id)?.title ?? '?').slice(0, 60)}")`;
/**
 * The list's rows in the order the list draws them (#1461): the open asks, then each project by its name, its session
 * rows in the hub's order. A project's quiet sessions fold into one row, which this order leaves out.
 */
export function listOrder(rows: readonly Row[]): string[] {
  const asks = rows.filter((r) => r.id.startsWith('ask:')).map((r) => r.id);
  const sessions = rows.filter((r) => r.id.startsWith('session:') && r.word !== 'quiet');
  const project = (r: Row): string => (typeof r.project === 'string' ? r.project.toLowerCase() : '￿');
  const projects = [...new Set(sessions.map(project))].sort();
  return [...asks, ...projects.flatMap((p) => sessions.filter((r) => project(r) === p).map((r) => r.id))];
}
/** A row's state as the hub writes it when it changes (#1461's `rowSet`): fed to a running replica. */
export async function feedRow(r: Replica, row: Row, change: Partial<Row>): Promise<void> {
  const session = String(row.session ?? row.id.replace(/^session:/, ''));
  await r.feed(session, await rowSet({ ...row, ...change, since: Date.now(), unread: true } as Row));
}

// ---- The real app (AC3, AC9): read and driven from outside its process (probe.swift).

let compiled: Promise<string> | undefined;
function probeBinary(): Promise<string> {
  if (process.platform !== 'darwin') return Promise.resolve(blocked(`the app draws on macOS only; this is ${process.platform}`));
  compiled ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const source = join(SUITE, 'probe.swift');
    const out = join(BIN, `probe-${sha256(readFileSync(source)).slice(0, 12)}`);
    if (!existsSync(out)) await run('swiftc', ['-O', '-module-cache-path', join(BIN, 'swift-cache'), source, '-o', out]);
    return out;
  })();
  return compiled;
}
function run(cmd: string, args: string[], ms = 120_000): Promise<string> {
  return new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024, timeout: ms }, (error, out, err) => (error ? reject(Error(`${cmd} ${args.slice(0, 3).join(' ')}: ${error.message}; ${String(err).slice(-400)}`)) : resolve(out))));
}
const probe = async <T>(...args: string[]): Promise<T> => JSON.parse(await run(await probeBinary(), args)) as T;
/** BLOCKED unless this process can read and drive the real window: Accessibility, an unlocked screen, and Screen Recording for pictures. */
export async function realAppAccess(o: { pictures?: boolean } = {}): Promise<void> {
  const a = await probe<{ ax: boolean; screen: boolean; locked: boolean }>('access');
  if (!a.ax) blocked('this process has no Accessibility permission, so nothing can read the real window\'s tree or post its keys; grant it to the app the tests run under');
  if (a.locked) blocked('the screen is locked, so the real window draws nothing a person could see and takes no key; run with the screen awake and unlocked (caffeinate -di)');
  if (o.pictures && !a.screen) blocked('this process has no Screen Recording permission, so nothing can take the real window\'s pictures; grant it to the app the tests run under');
}
export const screens = (): Promise<number[][]> => probe<number[][]>('screens');

export interface AxNode { role: string | null; title: string | null; description: string | null; value: string | null; identifier: string | null; frame: number[]; children: AxNode[] }
export const axFlat = (n: AxNode, into: AxNode[] = []): AxNode[] => { into.push(n); for (const c of n.children ?? []) axFlat(c, into); return into; };
export const ADDRESS = /^(ask|session|project|page)\/\S+$/;
/** macOS's virtual key codes on a US keyboard (kVK_*). */
export const KEY = { q: 12, enter: 36, escape: 53, f6: 97, down: 125, up: 126 } as const;

export class RealApp {
  private err = '';
  private constructor(readonly child: ChildProcess) {
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-8000); });
  }
  get pid(): number { return this.child.pid!; }
  get exited(): boolean { return this.child.exitCode !== null || this.child.signalCode !== null; }
  stderr(): string { return this.err; }
  /**
   * Starts `bin` in `home` with `env` and waits for its window and its tree. The app builds its tree on a frame drawn
   * after an assistive client asks, and a still window draws none, so one that stays empty is nudged a point wider and
   * back: the window ends where it opened, at its own size.
   */
  static async launch(home: string, bin: string, env: Record<string, string> = {}): Promise<RealApp> {
    await realAppAccess();
    const child = spawn(bin, [], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'ignore', 'pipe'] });
    own(child.pid);
    const app = new RealApp(child);
    const deadline = Date.now() + 180_000;
    let asked = 0;
    for (;;) {
      if (app.exited) blocked(`deep-app exited (${child.exitCode ?? child.signalCode}) before its window: ${app.err.slice(-600)}`);
      if ((await app.windows()).length) {
        if (await app.node('list')) return app;
        if (++asked % 20 === 0) {
          const [x, y, w, h] = (await app.frame()) as [number, number, number, number];
          await app.place(x, y, w + 1, h);
          await app.place(x, y, w, h);
        } else await app.front();
      }
      if (Date.now() > deadline) blocked(`deep-app showed no window with a list in 180 s: ${app.err.slice(-600)}`);
      await sleep(300);
    }
  }
  windows(): Promise<{ id: number; frame: number[] }[]> { return probe('windows', String(this.pid)); }
  /** The main window's frame in points, top-left origin: [x, y, w, h]. */
  async frame(): Promise<number[]> {
    const wins = await this.windows();
    return [...wins].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0]?.frame ?? [];
  }
  /** Moves and sizes the window as a person dragging it would, through the Accessibility API; its frame then. */
  async place(x: number, y: number, w: number, h: number): Promise<number[]> {
    let got: number[] = [];
    for (let tries = 0; tries < 40; tries++) {
      await probe('frame', String(this.pid), String(x), String(y), String(w), String(h)).catch(() => undefined);
      got = await this.frame();
      if (Math.abs(got[2]! - w) < 1 && Math.abs(got[3]! - h) < 1) return got;
      await sleep(250);
    }
    return blocked(`the real window couldn't be set to ${w} × ${h} at ${x}, ${y}: it reads ${said(got)}`);
  }
  async nodes(): Promise<AxNode[]> { return (await probe<{ tree: AxNode }[]>('tree', String(this.pid))).flatMap((w) => axFlat(w.tree)); }
  async node(id: string): Promise<AxNode | undefined> { return (await this.nodes()).find((n) => n.identifier === id); }
  /** The address the window shows: its page node's identifier (#1460). */
  async address(): Promise<string | null> {
    const pages = (await this.nodes()).map((n) => n.identifier).filter((id): id is string => !!id && ADDRESS.test(id));
    return pages.length === 1 ? pages[0]! : null;
  }
  front(): Promise<void> { return probe<boolean>('front', String(this.pid)).then(() => undefined, () => undefined); }
  /** A key, `times` times, posted to this process alone, the app brought forward first. */
  async key(code: number, o: { mods?: string[]; times?: number } = {}): Promise<void> {
    await this.front();
    await probe('key', String(this.pid), String(code), String(o.times ?? 1), ...(o.mods ?? []));
    await sleep(200);
  }
  focused(): Promise<AxNode | null> { return probe('focused', String(this.pid)); }
  pressId(id: string): Promise<{ found: boolean; pressed?: boolean }> { return probe('pressid', String(this.pid), id); }
  /** The left button down at one point of the screen, moved to another and let go, posted to this process alone. */
  async drag(from: number[], to: number[]): Promise<void> {
    await this.front();
    await probe('drag', String(this.pid), ...[...from, ...to].map((v) => String(Math.round(v))));
    await sleep(400);
  }
  /** The wheel at a point of the screen, `dy` points toward the end, posted to this process alone. */
  async scroll(at: number[], dy: number): Promise<void> {
    await this.front();
    await probe('scroll', String(this.pid), String(Math.round(at[0]!)), String(Math.round(at[1]!)), String(Math.round(dy)));
    await sleep(400);
  }
  /** ⌘Q, as a person quits; whether the process ended within `ms`. */
  async quit(ms = 30_000): Promise<boolean> {
    await this.key(KEY.q, { mods: ['cmd'] });
    const deadline = Date.now() + ms;
    while (!this.exited && Date.now() < deadline) await sleep(100);
    return this.exited;
  }
  /** The main window's pixels, captured by its window ID, never the display. */
  async capture(path: string): Promise<void> {
    const wins = await this.windows();
    const win = [...wins].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0] ?? blocked('deep-app has no window to capture');
    await run('/usr/sbin/screencapture', ['-x', '-o', `-l${win.id}`, path]);
    if (!existsSync(path)) blocked(`screencapture of window ${win.id} wrote nothing`);
  }
  async stop(): Promise<void> {
    if (this.exited) return;
    this.child.kill('SIGTERM');
    const deadline = Date.now() + 3000;
    while (!this.exited && Date.now() < deadline) await sleep(50);
    if (!this.exited) this.child.kill('SIGKILL');
  }
}
/** Repeats `judge` until it finds nothing wrong or `ms` pass. */
export async function settled(judge: () => Promise<string[]>, ms = 15_000): Promise<string[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const failures = await judge();
    if (!failures.length || Date.now() > deadline) return failures;
    await sleep(400);
  }
}
/** The SHA-256 of a file. */
export const sha256File = (path: string): string => sha256(readFileSync(path));
