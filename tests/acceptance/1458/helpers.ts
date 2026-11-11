// Test-side tools for #1458 (README). The replica is the real `deep-drive`, built from the checkout plain and with
// `env-plants` (through which DEEP_HUB_PLANT selects a planted app), each copied out of the target folder under its own
// name; the look's guard is the real `deep-canvas-render look`; the source guard is the real
// `scripts/color-literal-guard.mjs`. Every judge a criterion's failure message comes from is here, and none is the
// implementation's own verdict. Nothing here stands in for the app, the replica or the guard.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild, ~/.claude or ~/Library; no network, no model.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const FIXTURES = join(SUITE, 'fixtures');
export const MINUTES = 60_000;

/** The criteria, by `#1458.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const AC = {
  sizes: 'AC1 #1458.dd02bb24',
  px: 'AC2 #1458.6aab01b3',
  contrast: 'AC3 #1458.50054406',
  fits: 'AC4 #1458.a98be9c0',
  main: 'AC5 #1458.c735b2b1',
  utilities: 'AC6 #1458.3326ddd5',
  face: 'AC7 #1458.0c2959d0',
  tick: 'AC8 #1458.52c35293',
  tooltip: 'AC9 #1458.a3834e1a',
  still: 'AC10 #1458.889098b6',
  time: 'AC11 #1458.5350b8ad',
  switch: 'AC12 #1458.be1a2dad',
  shown: 'AC13 #1458.f1c33792',
} as const;

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (path: string): string => sha256(readFileSync(path));
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- The issue's numbers.

/** The three text sizes, in points: small 11, body 13, title 15 (the issue's Scope). */
export const SIZES = [11, 13, 15] as const;
/** The windows the issue names: the one the app opens at, and the reference window. */
export const OPENING = { width: 960, height: 640 } as const;
export const REFERENCE = { width: 1512, height: 982 } as const;
/** The floor every ink role but `ink_disabled` clears on every fill (the issue's Scope). */
export const INK_FLOOR = 4.5;
/** Every fill a row can be drawn on, as #1003's suite names them, in its order. */
export const SURFACES = ['ground', 'raised', 'hover over ground', 'hover over raised', 'selected over ground', 'selected over raised'] as const;
/** The code face the issue names; the canvas keeps Inter. */
export const CODE_FACE = 'JetBrains Mono';
export const CANVAS_FACE = 'Inter';
/** Names a platform's system face goes by in a font request (README, Pinned 5). */
export const SYSTEM_FACES = ['.SystemUIFont', 'system-ui', '-apple-system', '.AppleSystemUIFont', 'SF Pro', 'SF Pro Text'];

// ---- Temp folders and processes. Short paths under /tmp; only what this file started is stopped, by PID.

const made: string[] = [];
export function tempDir(prefix = 'da1458-'): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', prefix)));
  made.push(dir);
  return dir;
}
const owned = new Set<ChildProcess>();
const alive = (c: ChildProcess): boolean => c.exitCode === null && c.signalCode === null;
export async function cleanup(): Promise<void> {
  for (const child of owned) if (alive(child)) child.kill('SIGTERM');
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const child of owned) if (alive(child)) child.kill('SIGKILL');
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    owned.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // A child that exits before reading its input closes the pipe; that is its answer, not an error here.
    child.stdin!.on('error', () => undefined);
    child.stdin!.end(o.input ?? '');
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 10 * MINUTES);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code, signal) => { clearTimeout(timer); owned.delete(child); resolve({ code, signal, stdout, stderr }); });
  });
}
export const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

/** A child's environment: HOME the test's home, none of this process's DEEP_, XDG_, CLAUDE* or CODEX* variables, plus `extra`. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|OTEL_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), LC_ALL: 'C', NO_COLOR: '1' });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// ---- Builds (README, How to run). Each binary is copied out of the target folder under its own name; the plain build
// runs last, so the checkout's target/debug never holds a plant.

const BIN = join(tmpdir(), `da1458-bin-${userInfo().uid}`);
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const builds = new Map<string, Promise<void>>();
function cargo(args: string[]): Promise<void> {
  const key = args.join(' ');
  let build = builds.get(key);
  if (!build) {
    build = run('cargo', ['build', '--locked', '-q', ...args], { env: CARGO_ENV, timeoutMs: 120 * MINUTES }).then((r) => {
      if (r.code !== 0) blocked(`cargo build ${key} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, build);
  }
  return build;
}
let drives: Promise<{ plain: string; plants: string }> | undefined;
/** `deep-drive`, built with `env-plants` (README, Pinned 8) and plain. A clean run uses the plain build; a plant, the other. */
export function driveBinaries(): Promise<{ plain: string; plants: string }> {
  if (process.platform !== 'darwin') return Promise.resolve(blocked(`the replica draws on macOS only; this is ${process.platform}`));
  drives ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    await cargo(['-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants']);
    const plants = join(BIN, 'deep-drive-plants');
    copyFileSync(target('deep-drive'), plants);
    await cargo(['-p', 'deep-replica', '--bin', 'deep-drive']);
    const plain = join(BIN, 'deep-drive-plain');
    copyFileSync(target('deep-drive'), plain);
    return { plain, plants };
  })();
  return drives;
}
let render: Promise<string> | undefined;
/** `deep-canvas-render`, whose `look` mode is the look's guard (as #1003's suite asks it). */
export function renderBinary(): Promise<string> {
  render ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    await cargo(['-p', 'deep-marks-render', '--bin', 'deep-canvas-render']);
    const out = join(BIN, 'deep-canvas-render');
    copyFileSync(target('deep-canvas-render'), out);
    return out;
  })();
  return render;
}
/** The look's guard: one JSON line in per input, one line out. */
export async function lookGuard(inputs: readonly unknown[]): Promise<Record<string, any>[]> {
  const r = await run(await renderBinary(), ['look'], { input: `${inputs.map((i) => JSON.stringify(i)).join('\n')}\n`, timeoutMs: 5 * MINUTES });
  const lines = r.stdout.split('\n').filter(Boolean);
  if (lines.length !== inputs.length) blocked(`deep-canvas-render look answered ${lines.length} lines for ${inputs.length}: ${shown(r)}`);
  return lines.map((l) => JSON.parse(l) as Record<string, any>);
}

// ---- The fixture record (README, The fixture), on the replica's clock.

/** The replica's clock for a fixture launch, ms since the epoch (crates/deep-replica, `NOW`): 2027-01-15 08:00 UTC. */
export const NOW = 1_800_000_000_000;
/** Flicks a second, the replica's `t` (crates/deep-replica/src/drive, `FLICKS`). */
export const FLICKS = 705_600_000;
export const RECORD = join(FIXTURES, 'pages.events.jsonl');
/** `Header layout`, the record's first session, with the choice ask. */
export const HEADER = '01QAHEAD000000000000000001';
/** `Checkout page`, quiet, last seen 9 s before the replica's clock starts. */
export const CHECKOUT = '01QACHEK000000000000000002';
/** The choice ask: its default applies 4 h after the clock starts, at 12:00 in UTC, the replica's time zone here. */
export const CHOICE = { handle: 'ask:01QAASK0000000000000000006', question: 'Keep the old logo in the header?', moment: '12:00' } as const;
/** The first of #327's batched authority asks, whose card shows the batch's four steps. */
export const BATCH = { handle: 'ask:01MD327E000000000000000013', question: 'Push feat/cart to origin?' } as const;
export const STEPS = ['git push origin feat/cart', 'gh pr merge 42 --squash', 'git push origin --delete old/spike', 'mail team@shop.example the notes'] as const;

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export interface SNode { role: string; name: string | null; value: unknown; id?: string | null; bounds: number[]; children: SNode[] }
/** One drawn string, as the snapshot lists it (README, Pinned 1). */
export interface Run { text: string; bounds: number[]; size: number; face: string; cut: boolean }
export interface View { name: string; bounds: number[] }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; items: { id: string; value: any }[]; runs?: unknown; views?: unknown }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };

export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Record<string, any>) => void)[] = [];
  private exited = false;
  private err = '';
  t = 0;
  private constructor(readonly child: ChildProcess, readonly out: string) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Record<string, any>;
        try { parsed = JSON.parse(line) as Record<string, any>; } catch { parsed = { unparsed: line }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** `bin` in a temp home, the replica's time zone UTC, with `plant` as DEEP_HUB_PLANT; once it says `{"ready": true}`. */
  static async start(bin: string, plant?: string): Promise<Drive> {
    const dir = tempDir();
    const out = join(dir, 'out');
    const home = join(dir, 'h');
    mkdirSync(out, { recursive: true });
    mkdirSync(home, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: childEnv(home, { TZ: 'UTC', DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    owned.add(child);
    const drive = new Drive(child, out);
    const ready = await drive.next(10 * MINUTES);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${JSON.stringify(ready).slice(0, 300)} ${drive.err.slice(-600)}`);
    return drive;
  }
  private next(ms: number): Promise<Record<string, any>> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  /** One call and its reply; BLOCKED when the binary gives none. */
  async call(args: Record<string, any>): Promise<Record<string, any>> {
    const reply = this.next(10 * MINUTES);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${JSON.stringify(got).slice(0, 300)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  async must(args: Record<string, any>): Promise<Record<string, any>> {
    const reply = await this.call(args);
    expect(reply.ok, `deep-drive ${String(args.call)}: ${JSON.stringify(reply).slice(0, 600)}`).toBe(true);
    return reply;
  }
  async see(): Promise<Snapshot> { return (await this.must({ call: 'see', see: { scope: 'window' } })).snapshot as Snapshot; }
  /** Runs the replica's clock `ms` on. */
  async wait(ms: number): Promise<void> { await this.must({ call: 'wait_for', wait_for: { t: this.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 5000 }); }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) this.child.kill('SIGKILL');
  }
}

export const NEEDS_YOU = 'deepbuild/needs-you';
export const SESSION_PAGE = 'deepbuild/session';
export const SIDEBAR = 'deepbuild/sidebar';
/** The pseudo-page this suite names the question card by: Needs you with the choice ask's row clicked. */
export const CARD = 'question card';

/**
 * The shipped pages (README, Pinned 3): the values `deep-drive`'s `launch.center` accepts, which its refusal of an
 * unknown center lists, as at the base.
 */
export async function shippedPages(bin: string): Promise<string[]> {
  const drive = await Drive.start(bin);
  try {
    const reply = await drive.call({ call: 'launch', launch: { from: 'fixture', fixture: RECORD, center: 'deepbuild/no-such-page-1458' } });
    const listed = /one of (\[[^\]]*\])/.exec(String(reply.error?.message ?? ''));
    if (reply.ok || !listed) blocked(`deep-drive's refusal of an unknown center lists no pages: ${JSON.stringify(reply).slice(0, 400)}`);
    const pages = JSON.parse(listed![1]!) as string[];
    expect(pages, 'the shipped pages deep-drive opens').toContain(NEEDS_YOU);
    return pages;
  } finally {
    await drive.stop();
  }
}

export interface Page { page: string; snapshot: Snapshot }
export interface Render { size?: { width: number; height: number }; theme?: 'light' | 'dark'; plant?: string | undefined; only?: readonly string[] }
/**
 * A replica of `bin` launched on `center` over the fixture, in a process of its own: a second launch in one deep-drive
 * process can panic once a card was shown in the first (seen at the base), so every launch here gets its own.
 */
export async function launched(o: Render & { center: string }): Promise<Drive> {
  const bins = await driveBinaries();
  const drive = await Drive.start(o.plant ? bins.plants : bins.plain, o.plant);
  const size = o.size ?? REFERENCE;
  await drive.must({ call: 'launch', launch: { from: 'fixture', fixture: RECORD, center: o.center, size: [size.width, size.height], theme: o.theme ?? 'light' } });
  return drive;
}
/** Each shipped page over the fixture, and the question card, each in a fresh replica. */
export async function renderPages(o: Render = {}): Promise<Page[]> {
  const pages = [...await shippedPages((await driveBinaries()).plain), CARD].filter((p) => !o.only || o.only.includes(p));
  const out: Page[] = [];
  for (const page of pages) {
    const drive = await launched({ ...o, center: page === CARD ? NEEDS_YOU : page });
    try {
      if (page === CARD) {
        await drive.must({ call: 'act', locator: { id: CHOICE.handle }, act: { kind: 'click' } });
        await drive.wait(500);
      }
      out.push({ page, snapshot: await drive.see() });
    } finally {
      await drive.stop();
    }
  }
  return out;
}

// ---- Reading a snapshot (README, Pinned 1 and 2).

/** The snapshot's drawn strings, or why they can't be read. */
export function runsOf(s: Snapshot): Run[] | string {
  if (!Array.isArray(s.runs)) return 'the snapshot has no `runs` list, each string drawn with its size, face and whether its clip cut it (README, Pinned 1)';
  for (const r of s.runs as Record<string, unknown>[]) {
    const ok = typeof r.text === 'string' && Array.isArray(r.bounds) && r.bounds.length === 4 && typeof r.size === 'number' && typeof r.face === 'string' && typeof r.cut === 'boolean';
    if (!ok) return `a run in the snapshot lacks text, bounds, size, face or cut: ${JSON.stringify(r).slice(0, 200)} (README, Pinned 1)`;
  }
  return s.runs as Run[];
}
/** The shipped views the frame drew, or why they can't be read. */
export function viewsOf(s: Snapshot): View[] | string {
  if (!Array.isArray(s.views)) return 'the snapshot has no `views` list, each shipped view drawn with its bounds (README, Pinned 2)';
  for (const v of s.views as Record<string, unknown>[]) {
    if (typeof v.name !== 'string' || !Array.isArray(v.bounds) || v.bounds.length !== 4) return `a view in the snapshot lacks a name or bounds: ${JSON.stringify(v).slice(0, 200)} (README, Pinned 2)`;
  }
  return s.views as View[];
}
const inside = (outer: number[], [x, y]: [number, number]): boolean => x >= outer[0]! && y >= outer[1]! && x < outer[0]! + outer[2]! && y < outer[1]! + outer[3]!;
const area = (b: number[]): number => b[2]! * b[3]!;
const middle = (b: number[]): [number, number] => [b[0]! + b[2]! / 2, b[1]! + b[3]! / 2];
const start = (b: number[]): [number, number] => [b[0]! + 1, b[1]! + b[3]! / 2];
/** The smallest view holding a point. */
export const viewAt = (views: readonly View[], at: [number, number]): View | undefined =>
  views.filter((v) => inside(v.bounds, at)).sort((a, b) => area(a.bounds) - area(b.bounds))[0];
export const runsIn = (runs: readonly Run[], box: number[]): Run[] => runs.filter((r) => inside(box, middle(r.bounds)));
const pt = (s: Snapshot, px: number): number => Math.round((px / (s.window.scale || 2)) * 10) / 10;
const said = (text: string): string => JSON.stringify(text.length > 60 ? `${text.slice(0, 59)}…` : text);

// ---- Judges.

/** AC1, AC9: every run in one of the three sizes, each failure naming the view and the size. */
export function sizeFailures(pages: readonly Page[], only?: (page: Page, runs: Run[]) => Run[]): string[] {
  const failures: string[] = [];
  for (const p of pages) {
    const runs = runsOf(p.snapshot);
    const views = viewsOf(p.snapshot);
    if (typeof runs === 'string' || typeof views === 'string') { failures.push(`${p.page}: ${typeof runs === 'string' ? runs : views}`); continue; }
    if (!runs.length) { failures.push(`${p.page}: the snapshot lists no drawn string`); continue; }
    for (const r of only ? only(p, runs) : runs) {
      if (SIZES.some((s) => Math.abs(r.size - s) < 0.01)) continue;
      failures.push(`${viewAt(views, middle(r.bounds))?.name ?? `${p.page} (outside every view)`}: ${said(r.text)} is drawn at ${r.size} pt, not ${SIZES.join(', ')} pt`);
    }
  }
  return failures;
}

/** AC7: every run in one of the chrome's two faces, never the canvas's, each failure naming the view. */
export function faceFailures(pages: readonly Page[], faces: readonly string[]): string[] {
  const failures: string[] = [];
  for (const p of pages) {
    const runs = runsOf(p.snapshot);
    const views = viewsOf(p.snapshot);
    if (typeof runs === 'string' || typeof views === 'string') { failures.push(`${p.page}: ${typeof runs === 'string' ? runs : views}`); continue; }
    for (const r of runs) {
      if (faces.includes(r.face)) continue;
      failures.push(`${viewAt(views, middle(r.bounds))?.name ?? `${p.page} (outside every view)`}: ${said(r.text)} is drawn in ${JSON.stringify(r.face)}, not the chrome's ${faces.map((f) => JSON.stringify(f)).join(' or ')}`);
    }
  }
  return failures;
}

/**
 * AC4: at a window, nothing on a page is clipped or wider than its pane. A run is clipped when its clip cut glyphs off
 * it, or it ends past its view's right edge or the window's; a node (any role) is too wide when it starts in a view and
 * ends past that view's right edge, which is what puts a scroll bar across a page. Each failure names the element and the
 * window.
 */
export function fitFailures(pages: readonly Page[]): string[] {
  const failures: string[] = [];
  const slack = 2;
  for (const p of pages) {
    const s = p.snapshot;
    const win = `the ${s.window.size[0]}×${s.window.size[1]} window`;
    const right = s.window.size[0]! * (s.window.scale || 2);
    const runs = runsOf(s);
    const views = viewsOf(s);
    if (typeof runs === 'string' || typeof views === 'string') { failures.push(`${p.page}: ${typeof runs === 'string' ? runs : views}`); continue; }
    for (const r of runs) {
      const v = viewAt(views, start(r.bounds));
      const edge = Math.min(right, v ? v.bounds[0]! + v.bounds[2]! : right);
      const end = r.bounds[0]! + r.bounds[2]!;
      if (r.cut) failures.push(`${v?.name ?? p.page}: text ${said(r.text)} is cut off by its clip in ${win}`);
      else if (end > edge + slack) failures.push(`${v?.name ?? p.page}: text ${said(r.text)} ends ${pt(s, end - edge)} pt past ${v ? `its pane's` : `the window's`} right edge in ${win}`);
    }
    for (const n of flat(s.tree).slice(1)) {
      if (n.role === 'text_run' || n.bounds[2]! <= 0 || n.bounds[3]! <= 0) continue;
      const v = viewAt(views, start(n.bounds));
      const edge = Math.min(right, v ? v.bounds[0]! + v.bounds[2]! : right);
      const end = n.bounds[0]! + n.bounds[2]!;
      if (end > edge + slack) {
        failures.push(`${v?.name ?? p.page}: ${n.role} ${JSON.stringify(n.id ?? n.name ?? null)} is ${pt(s, n.bounds[2]!)} pt wide and ends ${pt(s, end - edge)} pt past ${v ? `its pane's` : `the window's`} right edge in ${win}`);
      }
    }
  }
  return failures;
}

/** The strings a snapshot shows: drawn runs (or, without them, text runs), names, text values and canvas texts. */
export function stringsOf(s: Snapshot): string[] {
  const runs = runsOf(s);
  const out = typeof runs === 'string' ? [] : runs.map((r) => r.text);
  for (const n of flat(s.tree)) {
    if (n.name) out.push(n.name);
    if (typeof n.value === 'string') out.push(n.value);
  }
  for (const item of s.items ?? []) {
    const text = item.value?.text ?? item.value?.value?.text;
    if (typeof text === 'string') out.push(text);
  }
  return out;
}

/** AC11: a length is never read as "ago" nor counted down as "in …"; each failure names the string and where. */
const LENGTH = String.raw`\d+(?:[.,]\d+)?\s*(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)`;
const AGO = new RegExp(String.raw`\b${LENGTH}\s+ago\b`, 'i');
const IN = new RegExp(String.raw`\bin\s+${LENGTH}\b`, 'i');
export function timeWordFailures(where: string, strings: readonly string[]): string[] {
  return [...new Set(strings)].filter((t) => AGO.test(t) || IN.test(t)).map((t) => `${where}: ${said(t)} reads a time as ${AGO.test(t) ? '"… ago"' : '"in …"'}`);
}
/** The moments a text names: "16:40", "tomorrow 16:40" or "Mon 16:40" (an "at" before the clock time is read past). */
export function moments(text: string): string[] {
  return [...text.matchAll(/\b(?:(today|tomorrow|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+)?(?:at\s+)?(\d{1,2}:\d{2})\b/g)].map((m) => `${m[1] ? `${m[1]} ` : ''}${m[2]}`);
}

/** AC8: in a row, every string but the time reads and sits the same at 9 s and at 10 s. */
export function tickFailures(before: Snapshot, after: Snapshot, rowId: string): string[] {
  const failures: string[] = [];
  const rowOf = (s: Snapshot) => flat(s.tree).find((n) => n.id === rowId);
  const [a, b] = [rowOf(before), rowOf(after)];
  if (!a || !b) return [`the list has no row with the id ${rowId} (the session "Checkout page")`];
  const [ra, rb] = [runsOf(before), runsOf(after)];
  if (typeof ra === 'string' || typeof rb === 'string') return [typeof ra === 'string' ? ra : rb as string];
  const [ia, ib] = [runsIn(ra, a.bounds), runsIn(rb, b.bounds)];
  const ta = ia.filter((r) => r.text.trim() === '9 s');
  const tb = ib.filter((r) => r.text.trim() === '10 s');
  if (ta.length !== 1) failures.push(`at 9 s the row draws its time as ${ta.length} strings reading "9 s", not one of its own; it draws ${JSON.stringify(ia.map((r) => r.text))}`);
  if (tb.length !== 1) failures.push(`at 10 s the row draws its time as ${tb.length} strings reading "10 s", not one of its own; it draws ${JSON.stringify(ib.map((r) => r.text))}`);
  if (failures.length) return failures;
  const others = (rs: Run[], time: Run) => rs.filter((r) => r !== time).sort((x, y) => x.bounds[0]! - y.bounds[0]! || x.bounds[1]! - y.bounds[1]!);
  const [oa, ob] = [others(ia, ta[0]!), others(ib, tb[0]!)];
  if (oa.length !== ob.length) return [`the row's other strings changed when its time ticked: ${JSON.stringify(oa.map((r) => r.text))} became ${JSON.stringify(ob.map((r) => r.text))}`];
  oa.forEach((r, i) => {
    const q = ob[i]!;
    if (r.text !== q.text || r.bounds.some((v, k) => v !== q.bounds[k])) failures.push(`${said(r.text)} at ${JSON.stringify(r.bounds)} moved to ${said(q.text)} at ${JSON.stringify(q.bounds)} when the time ticked from 9 s to 10 s`);
  });
  return failures;
}

/**
 * AC10: after a page change, nothing animates. Over the recording from the click on, an element whose bounds or opacity
 * change on more than `MOVES` steps moved or faded over time instead of snapping; each failure names its view.
 */
const MOVES = 4;
export function stillFailures(recording: Record<string, any>): string[] {
  const inputs = (recording?.inputs ?? []) as { t: number }[];
  const frames = (recording?.frames ?? []) as { t: number; elements: { id: string; bounds: number[]; opacity: number }[] }[];
  if (!inputs.length || frames.length < 2) return [`the motion recording holds ${inputs.length} inputs and ${frames.length} frames: no page change was recorded`];
  const from = inputs[0]!.t;
  const after = frames.filter((f) => f.t >= from);
  // Said without the page's id, so a run that never changed page can't read as a plant caught on that page.
  if (!after.some((f) => f.elements.some((e) => e.id.includes(SESSION_PAGE)))) return ['the click on "Header layout"\'s row opened no session\'s page: nothing under that view was painted after it'];
  const seq = new Map<string, string[]>();
  after.forEach((f, i) => {
    for (const e of f.elements) {
      const list = seq.get(e.id) ?? Array(i).fill('absent');
      list.push(JSON.stringify([e.bounds, e.opacity]));
      seq.set(e.id, list);
    }
    for (const list of seq.values()) if (list.length === i) list.push('absent');
  });
  const step = Number(recording.step ?? FLICKS / 120);
  const failures: string[] = [];
  for (const [id, list] of seq) {
    const changes = list.filter((v, i) => i > 0 && v !== list[i - 1]).length;
    if (changes <= MOVES) continue;
    const view = /view:(deepbuild\/[\w-]+)/.exec(id)?.[1] ?? id;
    failures.push(`${view}: ${id} changes its bounds or opacity on ${changes} steps (about ${Math.round((changes * step * 1000) / FLICKS)} ms) after the page change, instead of snapping`);
  }
  return failures;
}

/** AC12: each step's control on the card is a switch, carries its state as its value, and has no state word in its label. */
const STATE_WORD = /\b(on|off|switched on|switched off|enabled|disabled|checked|unchecked|yes|no)\b/i;
export function switchFailures(card: Snapshot): string[] {
  const failures: string[] = [];
  const nodes = flat(card.tree);
  const holding = STEPS.map((does) => ({ does, holders: nodes.filter((n) => n.role !== 'text_run' && n.role !== 'window' && (n.name ?? '').includes(does)) }));
  const controlsOf = (holders: SNode[]) => holders.filter((n) => n.role !== 'label' && n.role !== 'static_text' && n.role !== 'heading');
  // The card may show only the steps that fit; it must show one, and each it shows is judged.
  if (!holding.some((h) => controlsOf(h.holders).length)) return [`the batched authority card shows no step control for any of ${JSON.stringify(STEPS)}; nodes naming one: ${JSON.stringify(holding.flatMap((h) => h.holders.map((n) => `${n.role} ${n.name}`)))}`];
  for (const { does, holders } of holding) {
    const controls = controlsOf(holders);
    for (const n of controls) {
      if (n.role !== 'switch') failures.push(`the step "${does}"'s control ${JSON.stringify(n.name)} has the role ${n.role}, not switch`);
      if (n.value === null || n.value === undefined) failures.push(`the step "${does}"'s switch ${JSON.stringify(n.name)} carries no state as its value`);
      if (STATE_WORD.test((n.name ?? '').replace(does, ''))) failures.push(`the step "${does}"'s switch ${JSON.stringify(n.name)} says its state as a word in its label`);
    }
  }
  return failures;
}

// ---- The source guard (README, Pinned 7).

export const GUARD = join(REPO, 'scripts/color-literal-guard.mjs');
/** A copy of what the guard reads, under /tmp: crates (no build output), scripts and contracts. */
export function sourceCopy(from = REPO): string {
  const root = join(tempDir(), 'root');
  for (const part of ['crates', 'scripts', 'contracts']) {
    if (!existsSync(join(from, part))) continue;
    cpSync(join(from, part), join(root, part), { recursive: true, filter: (src) => !/\/(target|node_modules|\.git)(\/|$)/.test(src) });
  }
  return root;
}
/** Appends `lines` to `file` under `root`; answers the line number of the first. */
export function plant(root: string, file: string, lines: readonly string[]): number {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  const body = text.endsWith('\n') ? text : `${text}\n`;
  writeFileSync(path, `${body}${lines.join('\n')}\n`);
  return body.split('\n').length;
}
export const guard = (root?: string): Promise<Ran> => run(process.execPath, [GUARD, ...(root ? ['--root', root] : [])], { timeoutMs: 5 * MINUTES });
export const findings = (r: Ran): string[] => r.stdout.split('\n').filter((l) => l.startsWith('FAIL'));
/** The guard's finding naming `file:line`, as its own lines name a place. */
export const names = (r: Ran, file: string, line: number): boolean => findings(r).some((l) => new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:${line}(?!\\d)`).test(l));

export function mergeBase(): string {
  for (const ref of ['origin/main', 'main']) {
    try { return execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: REPO, encoding: 'utf8' }).trim(); } catch { /* the next */ }
  }
  return blocked('no merge base with origin/main or main');
}
/** The merge base's crates, scripts and contracts, extracted with `git archive` (no worktree is added). */
export function baseTree(sha = mergeBase()): string {
  const dir = join(tempDir(), 'base');
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git archive --format=tar ${sha} crates scripts contracts | tar -x -C '${dir}'`], { cwd: REPO, maxBuffer: 1 << 30 });
  return dir;
}

// ---- Contrast, as #1003's suite and the base's guard compute it.

export interface Color { rgb: number[]; a: number }
export function parseColor(text: unknown): Color | null {
  const m = typeof text === 'string' && /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(text);
  if (!m) return null;
  return { rgb: [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)), a: m[2] === undefined ? 1 : parseInt(m[2], 16) / 255 };
}
const decode = (v: number): number => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (rgb: number[]): number => 0.2126 * decode(rgb[0]!) + 0.7152 * decode(rgb[1]!) + 0.0722 * decode(rgb[2]!);
export function contrast(p: number[], q: number[]): number {
  const [x, y] = [luminance(p), luminance(q)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const over = (c: Color, base: number[]): number[] => c.rgb.map((v, i) => Math.round(v * c.a + base[i]! * (1 - c.a)));
/** A theme's six surfaces from its resolved roles; raised falls back to the ground. */
export function surfaces(roles: Record<string, string>): [string, number[]][] {
  const ground = parseColor(roles.ground)?.rgb;
  if (!ground) return [];
  const raised = parseColor(roles.raised)?.rgb ?? ground;
  const out: [string, number[]][] = [['ground', ground], ['raised', raised]];
  for (const fill of ['hover', 'selected']) {
    const c = parseColor(roles[fill]);
    if (c) out.push([`${fill} over ground`, over(c, ground)], [`${fill} over raised`, over(c, raised)]);
  }
  return out;
}
export const onSurface = (c: Color, surface: number[]): number[] => (c.a === 1 ? c.rgb : over(c, surface));

// ---- The taste call (AC13), in #1454's shape.

export interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
/** What a run reads of TASTE.json: `null` only when a person called exactly this run's files `looks_right`. */
export function tasteFailure(taste: Taste, got: Record<string, string>): { inconclusive?: string; fails?: string } | null {
  if (taste.verdict === null || taste.verdict === undefined) return { inconclusive: 'AC13: no taste call is recorded for these screenshots (TASTE.json holds none)' };
  if (!taste.who || !taste.when) return { inconclusive: 'AC13: the taste call names no one or no time' };
  if (sorted(taste.files ?? {}) !== sorted(got)) return { inconclusive: 'AC13: the recorded taste call was made on other pictures than this run\'s' };
  if (taste.verdict !== 'looks_right') return { fails: `the recorded taste call says they don't look right: ${taste.note ?? ''}` };
  return null;
}
export { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync };
