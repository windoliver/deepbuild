// Test-side tools for #1592 (README). The replica is the real `deep-drive`, built from the checkout with `env-plants`
// (through which DEEP_HUB_PLANT selects a planted app) and plain, each copied out of the target folder under its own
// name. The real app (AC4) is the real `deep-app`, built with its `contact-sheet` feature, read from outside its process
// with #1454's and #1459's probes (shown.test.ts). Every judge a criterion's failure message comes from is here, and none
// is the implementation's own verdict. Nothing here stands in for the app or the replica.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild, ~/.claude or ~/Library; no network, no model.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const RECORD = join(SUITE, 'fixtures', 'marks.events.jsonl');
export const MINUTES = 60_000;

/** The criteria, by `#1592.<first 8 hex of SHA-256(text, whitespace collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const AC = {
  icons: 'AC1 #1592.9baca743',
  marks: 'AC2 #1592.7a78eb3d',
  fallback: 'AC3 #1592.edcecbf6',
  shown: 'AC4 #1592.15a3cc5f',
} as const;

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (path: string): string => sha256(readFileSync(path));
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- The issue's numbers and names.

/** The icon sizes the issue allows, in points: 14 in rows, 16 in page chrome. */
export const ICON_SIZES = [14, 16] as const;
/** The status map's entries, in the look's legend order (crates/deep-canvas-marks/src/look.rs, STATES): one mark each. */
export const ENTRIES = ['pass', 'fail', 'invalid', 'blocked', 'inconclusive', 'running', 'needs_you', 'stale', 'idle'] as const;
export type Entry = (typeof ENTRIES)[number];
/** Two marks are told apart with color off when their shapes differ in at least this share of the pixels either inks. */
export const APART = 0.1;
/** The reference window, in points; the replica draws at 2×. */
export const REFERENCE = { width: 1512, height: 982 } as const;

/**
 * The fixture (README, The fixture): one session in project `shop` per status-map entry, each listed by the hub's own
 * `row.set` in its state's word, the first session (so a session's page shows it) INVALID, and one open choice ask on
 * the needs-you session.
 */
export const ROW_OF: Record<Entry, string> = {
  invalid: 'session:01QMSESS000000000000000001',
  pass: 'session:01QMSESS000000000000000002',
  fail: 'session:01QMSESS000000000000000003',
  blocked: 'session:01QMSESS000000000000000004',
  inconclusive: 'session:01QMSESS000000000000000005',
  running: 'session:01QMSESS000000000000000006',
  needs_you: 'session:01QMSESS000000000000000007',
  stale: 'session:01QMSESS000000000000000008',
  idle: 'session:01QMSESS000000000000000009',
};
export const CHOICE = { handle: 'ask:01QMASK0000000000000000010', question: 'Keep the old logo in the header?' } as const;

export const NEEDS_YOU = 'deepbuild/needs-you';
export const SESSION_PAGE = 'deepbuild/session';
/** The pseudo-page this suite names the question card by: Needs you with the choice ask's row clicked. */
export const CARD = 'question card';

/** The wrong programs (README, Pinned 3), each selected by DEEP_HUB_PLANT in a build with `env-plants`. */
export const PLANT = {
  icon18: 'icon-18-on-page',
  sharedShape: 'stale-mark-as-idle',
  fontGlyph: 'mark-as-font-glyph',
} as const;

// ---- Temp folders and processes. Short paths under /tmp; only what this file started is stopped, by PID.

const made: string[] = [];
export function tempDir(prefix = 'da1592-'): string {
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

export interface Ran { code: number | null; stdout: string; stderr: string }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    owned.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 10 * MINUTES);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); owned.delete(child); resolve({ code, stdout, stderr }); });
  });
}

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

// ---- Builds (README, How to run). Each binary is copied out of the target folder under its own name, into a folder of
// this checkout's own, so another worktree's build never stands in for this one; the plain build of each binary runs
// last, so the checkout's target/debug never holds a plant or the contact sheet.

const BIN = join(tmpdir(), `da1592-bin-${userInfo().uid}-${sha256(REPO).slice(0, 8)}`);
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const builds = new Map<string, Promise<void>>();
function cargo(args: string[]): Promise<void> {
  const key = args.join(' ');
  let build = builds.get(key);
  if (!build) {
    build = run('cargo', ['build', '--locked', '-q', ...args], { env: CARGO_ENV, timeoutMs: 120 * MINUTES }).then((r) => {
      if (r.code === 0) return;
      // A feature this suite pins that the crate doesn't have is the missing surface, named; anything else stops the run.
      const missing = /does not (?:contain|have) (?:this|these|the) features?:? *`?([\w/-]+)/.exec(r.stderr);
      if (missing) throw Error(`cargo build ${key}: the feature ${missing[1]} doesn't exist (README, Pinned 3 and 4), so this build can't be made`);
      blocked(`cargo build ${key} failed: ${r.stderr.split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('\n') || r.stderr.slice(-1500)}`);
    });
    builds.set(key, build);
  }
  return build;
}
let drives: Promise<{ plain: string; plants: string }> | undefined;
/** `deep-drive`, built with `env-plants` (README, Pinned 3) and plain. A clean run uses the plain build; a plant, the other. */
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
let sheet: Promise<string> | undefined;
/** The real app with its `contact-sheet` feature (README, Pinned 4), copied out; then the plain app, so target/debug holds it. */
export function contactSheetApp(): Promise<string> {
  if (process.platform !== 'darwin') return Promise.resolve(blocked(`the app draws on macOS only; this is ${process.platform}`));
  sheet ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    await cargo(['-p', 'deep-app', '--bin', 'deep-app', '--features', 'contact-sheet']);
    const out = join(BIN, 'deep-app-contact-sheet');
    copyFileSync(target('deep-app'), out);
    await cargo(['-p', 'deep-app', '--bin', 'deep-app']);
    return out;
  })();
  return sheet;
}

// ---- The replica, driven: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

/** The replica's clock ticks in flicks, 705,600,000 a second (crates/deep-replica/src/drive/mod.rs). */
const FLICKS = 705_600_000;
export interface SNode { role: string; name: string | null; value: unknown; id?: string | null; bounds: number[]; children: SNode[] }
/** One drawn string, as the snapshot lists it (#1458): `face` is the family its font was asked for by, empty for none. */
export interface Run { text: string; bounds: number[]; size: number; face: string }
export interface View { name: string; bounds: number[] }
/** One icon the frame drew (README, Pinned 1). */
export interface Icon { icon: string; bounds: number[]; size: number }
export interface Snapshot { window: { size: number[]; scale: number }; tree: SNode; runs?: unknown; views?: unknown; icons?: unknown }
export const flat = (n: SNode, into: SNode[] = []): SNode[] => { into.push(n); for (const c of n.children ?? []) flat(c, into); return into; };

export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Record<string, any>) => void)[] = [];
  private exited = false;
  private err = '';
  t = 0;
  private constructor(readonly child: ChildProcess) {
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
    const home = join(dir, 'h');
    mkdirSync(home, { recursive: true });
    const child = spawn(bin, ['--out', join(dir, 'out')], { cwd: REPO, env: childEnv(home, { TZ: 'UTC', DEEP_HUB_PLANT: plant }), stdio: ['pipe', 'pipe', 'pipe'] });
    owned.add(child);
    const drive = new Drive(child);
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
  /** The window's pixels as the replica draws them, a PNG at 2×; its path. */
  async screenshot(): Promise<string> { return String((await this.must({ call: 'screenshot', target: 'window' })).path); }
  /** Runs the replica's clock `ms` on. */
  async wait(ms: number): Promise<void> { await this.must({ call: 'wait_for', wait_for: { t: this.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 5000 }); }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) this.child.kill('SIGKILL');
  }
}

/**
 * The shipped pages (README, Pinned 5): the values `deep-drive`'s `launch.center` accepts, which its refusal of an
 * unknown center lists (at the base `deepbuild/needs-you`, `home`, `session`, `welcome` and `agents`), and the card.
 */
export async function shippedPages(bin: string): Promise<string[]> {
  const drive = await Drive.start(bin);
  try {
    const reply = await drive.call({ call: 'launch', launch: { from: 'fixture', fixture: RECORD, center: 'deepbuild/no-such-page-1592' } });
    const listed = /one of (\[[^\]]*\])/.exec(String(reply.error?.message ?? ''));
    if (reply.ok || !listed) blocked(`deep-drive's refusal of an unknown center lists no pages: ${JSON.stringify(reply).slice(0, 400)}`);
    const pages = JSON.parse(listed![1]!) as string[];
    expect(pages, 'the shipped pages deep-drive opens').toContain(NEEDS_YOU);
    return [...pages, CARD];
  } finally {
    await drive.stop();
  }
}

/** One state of a page the replica drew: the page, what the pointer was over, the snapshot, and a picture when asked. */
export interface Seen { page: string; how: string; snapshot: Snapshot; picture?: string }
export interface Explore { plant?: string; only?: readonly string[]; hover?: boolean; picture?: boolean }
/**
 * Each shipped page and the card over the fixture at the reference window in light, each in a replica of its own: the
 * page at rest (with a picture of the window when `picture`), then, when `hover`, once with the pointer over each node
 * that has an id, which shows what the page draws on hover. A second launch in one deep-drive process can panic once a
 * card was shown (seen with #1458's suite), so every page gets its own process.
 */
export async function explore(o: Explore = {}): Promise<Seen[]> {
  const bins = await driveBinaries();
  const pages = (await shippedPages(bins.plain)).filter((p) => !o.only || o.only.includes(p));
  const out: Seen[] = [];
  for (const page of pages) {
    const drive = await Drive.start(o.plant ? bins.plants : bins.plain, o.plant);
    try {
      await drive.must({ call: 'launch', launch: { from: 'fixture', fixture: RECORD, center: page === CARD ? NEEDS_YOU : page, size: [REFERENCE.width, REFERENCE.height], theme: 'light' } });
      if (page === CARD) {
        await drive.must({ call: 'act', locator: { id: CHOICE.handle }, act: { kind: 'click' } });
        await drive.wait(500);
      }
      const rest = await drive.see();
      out.push({ page, how: 'at rest', snapshot: rest, ...(o.picture ? { picture: await drive.screenshot() } : {}) });
      if (!o.hover) continue;
      const ids = [...new Set(flat(rest.tree).map((n) => n.id).filter((id): id is string => typeof id === 'string' && id !== ''))];
      for (const id of ids) {
        const moved = await drive.call({ call: 'act', locator: { id }, act: { kind: 'hover' } });
        if (moved.ok) out.push({ page, how: `with the pointer over ${id}`, snapshot: await drive.see() });
      }
    } finally {
      await drive.stop();
    }
  }
  return out;
}

// ---- Reading a snapshot.

/** The snapshot's shipped views (#1458), or why they can't be read. */
export function viewsOf(s: Snapshot): View[] | string {
  if (!Array.isArray(s.views)) return 'the snapshot has no `views` list, each shipped view drawn with its bounds (#1458)';
  return s.views as View[];
}
/** The snapshot's drawn strings (#1458), or why they can't be read. */
export function runsOf(s: Snapshot): Run[] | string {
  if (!Array.isArray(s.runs)) return 'the snapshot has no `runs` list, each string drawn with its face (#1458)';
  for (const r of s.runs as Record<string, unknown>[]) {
    if (typeof r.text !== 'string' || !Array.isArray(r.bounds) || typeof r.face !== 'string') return `a run in the snapshot lacks text, bounds or face: ${JSON.stringify(r).slice(0, 200)}`;
  }
  return s.runs as Run[];
}
/** The icons the frame drew (README, Pinned 1), or why they can't be read. */
export function iconsOf(s: Snapshot): Icon[] | string {
  if (!Array.isArray(s.icons)) return 'the snapshot has no `icons` list, each icon the frame drew with its name, bounds and size in points (README, Pinned 1)';
  for (const i of s.icons as Record<string, unknown>[]) {
    const ok = typeof i.icon === 'string' && Array.isArray(i.bounds) && i.bounds.length === 4 && typeof i.size === 'number';
    if (!ok) return `an icon in the snapshot lacks its icon, bounds or size: ${JSON.stringify(i).slice(0, 200)} (README, Pinned 1)`;
  }
  return s.icons as Icon[];
}
const inside = (outer: number[], [x, y]: [number, number]): boolean => x >= outer[0]! && y >= outer[1]! && x < outer[0]! + outer[2]! && y < outer[1]! + outer[3]!;
const area = (b: number[]): number => b[2]! * b[3]!;
const middle = (b: number[]): [number, number] => [b[0]! + b[2]! / 2, b[1]! + b[3]! / 2];
/** The smallest view holding a point: what a failure names. */
export const viewAt = (views: readonly View[], at: [number, number]): View | undefined =>
  views.filter((v) => inside(v.bounds, at)).sort((a, b) => area(a.bounds) - area(b.bounds))[0];
const isEntry = (v: unknown): v is Entry => typeof v === 'string' && (ENTRIES as readonly string[]).includes(v);

// ---- Judges.

/**
 * AC1: every icon each state of each page drew is 14 or 16 pt; each failure names the view, the icon and its size, once
 * per page, with the first state it was seen in. `names` is every icon drawn, by name: an app that draws none has
 * nothing measured, which the test fails.
 */
export function iconFailures(seen: readonly Seen[]): { failures: string[]; names: string[] } {
  const failures = new Map<string, string>();
  const names = new Set<string>();
  for (const s of seen) {
    const icons = iconsOf(s.snapshot);
    const views = viewsOf(s.snapshot);
    if (typeof icons === 'string' || typeof views === 'string') { failures.set(s.page, `${s.page}: ${typeof icons === 'string' ? icons : views}`); continue; }
    for (const i of icons) {
      names.add(i.icon);
      if (ICON_SIZES.some((size) => Math.abs(i.size - size) < 0.01)) continue;
      const view = viewAt(views, middle(i.bounds))?.name ?? `${s.page} (outside every view)`;
      const key = [s.page, view, i.icon, i.size].join('|');
      if (!failures.has(key)) failures.set(key, `${view}: the icon ${JSON.stringify(i.icon)} is drawn at ${i.size} pt, not ${ICON_SIZES.join(' or ')} pt (${s.page}, ${s.how})`);
    }
  }
  return { failures: [...failures.values()], names: [...names].sort() };
}

/** A PNG's pixels: 8-bit RGB or RGBA, not interlaced, as the replica writes them. */
export interface Pixels { width: number; height: number; rgba: Uint8Array }
export function readPng(path: string): Pixels {
  const file = readFileSync(path);
  let at = 8;
  const idat: Buffer[] = [];
  let [width, height, depth, type, interlace] = [0, 0, 0, 0, 0];
  while (at < file.length) {
    const size = file.readUInt32BE(at);
    const name = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + size);
    if (name === 'IHDR') [width, height, depth, type, interlace] = [body.readUInt32BE(0), body.readUInt32BE(4), body[8]!, body[9]!, body[12]!];
    if (name === 'IDAT') idat.push(body);
    at += 12 + size;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) blocked(`${path} is a PNG of depth ${depth}, color type ${type}, interlace ${interlace}, which this reader doesn't read`);
  const channels = type === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const line = new Uint8Array(stride);
  let previous = new Uint8Array(stride);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = previous[x]!;
      const c = x >= channels ? previous[x - channels]! : 0;
      const v = raw[y * (stride + 1) + 1 + x]!;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      line[x] = (filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : v + paeth) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * channels + k]!;
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = Uint8Array.from(line);
  }
  return { width, height, rgba };
}

/** A mark's shape with color off: which pixels of its box differ in lightness from its ground. */
interface Shape { width: number; height: number; ink: Uint8Array; inked: number; box: [number, number, number, number] }
const linear = (v: number): number => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/**
 * The pixels inside `b` (device pixels) of `picture`, color off: each pixel's relative luminance against the box's most
 * common color, its ground; a pixel is ink when it differs from the ground by at least half the most any pixel of the mark
 * does, so the same shape in two colors gives one shape. A box nothing in differs by 0.1 or more holds no shape.
 */
function shapeIn(picture: Pixels, b: number[]): Shape | undefined {
  const [x0, y0, w, h] = b.map(Math.round) as [number, number, number, number];
  const lum = new Float64Array(w * h);
  const counts = new Map<number, number>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = ((y0 + y) * picture.width + (x0 + x)) * 4;
    const [r, g, bl] = [picture.rgba[o] ?? 0, picture.rgba[o + 1] ?? 0, picture.rgba[o + 2] ?? 0];
    lum[y * w + x] = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(bl);
    const key = (r << 16) | (g << 8) | bl;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ground = [...counts].sort((p, q) => q[1] - p[1])[0]![0];
  const groundLum = 0.2126 * linear(ground >> 16) + 0.7152 * linear((ground >> 8) & 255) + 0.0722 * linear(ground & 255);
  const most = lum.reduce((m, v) => Math.max(m, Math.abs(v - groundLum)), 0);
  if (most < 0.1) return undefined;
  const ink = new Uint8Array(w * h);
  let inked = 0;
  let [left, top, right, bottom] = [w, h, -1, -1];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (Math.abs(lum[y * w + x]! - groundLum) < most / 2) continue;
    ink[y * w + x] = 1;
    inked += 1;
    [left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)];
  }
  return { width: w, height: h, ink, inked, box: [left, top, right, bottom] };
}
/** The share of the pixels either shape inks that only one inks, the two laid over each other centre on centre. */
export function shapeDistance(a: Shape, b: Shape): number {
  const centre = (s: Shape): [number, number] => [(s.box[0] + s.box[2]) / 2, (s.box[1] + s.box[3]) / 2];
  const [ca, cb] = [centre(a), centre(b)];
  const [dx, dy] = [Math.round(cb[0] - ca[0]), Math.round(cb[1] - ca[1])];
  const at = (s: Shape, x: number, y: number): number => (x >= 0 && y >= 0 && x < s.width && y < s.height ? s.ink[y * s.width + x]! : 0);
  let [both, either] = [0, 0];
  const [x0, x1] = [Math.min(0, -dx), Math.max(a.width, b.width - dx)];
  const [y0, y1] = [Math.min(0, -dy), Math.max(a.height, b.height - dy)];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [p, q] = [at(a, x, y), at(b, x + dx, y + dy)];
    if (p || q) either += 1;
    if (p && q) both += 1;
  }
  return either ? 1 - both / either : 0;
}

/**
 * AC2: on the list, each status-map entry's mark (the node `<row id>:mark` of the fixture's row in that entry, #1461's
 * mark slot) has a shape of its own with color off: every two entries' shapes differ in at least `APART` of the pixels
 * either inks. Each failure names the entries. Words that share an entry share its mark, so marks are compared by entry.
 */
export function shapeFailures(seen: Seen): string[] {
  if (!seen.picture) return ['no picture of the list was taken'];
  const picture = readPng(seen.picture);
  const nodes = flat(seen.snapshot.tree);
  const failures: string[] = [];
  const shapes = new Map<Entry, Shape>();
  for (const entry of ENTRIES) {
    const id = `${ROW_OF[entry]}:mark`;
    const node = nodes.find((n) => n.id === id);
    if (!node) { failures.push(`the list draws no mark for ${entry}: no node ${id}, the mark slot of the fixture's ${entry} row`); continue; }
    if (node.value !== entry) failures.push(`the mark ${id} is valued ${JSON.stringify(node.value)}, not its entry ${entry}`);
    const shape = shapeIn(picture, node.bounds);
    if (!shape) failures.push(`${entry}'s mark (${id}) draws nothing that shows with color off`);
    else shapes.set(entry, shape);
  }
  const drawn = [...shapes];
  for (let i = 0; i < drawn.length; i++) for (let j = i + 1; j < drawn.length; j++) {
    const [[a, sa], [b, sb]] = [drawn[i]!, drawn[j]!];
    const apart = shapeDistance(sa, sb);
    if (apart < APART) failures.push(`${a} and ${b} draw the same shape with color off: their marks differ in ${(apart * 100).toFixed(1)}% of the pixels either inks, under ${APART * 100}%`);
  }
  return failures;
}

/**
 * AC3: no status mark draws with font fallback. A status mark is a node valued with a status-map entry (#1459: a
 * node's value carries a state's entry): a row's mark slot, a row, a page's status line. Every string drawn inside one
 * must come from a font its text asked for: a run whose `face` is empty was shaped from a font no text asked for, the
 * platform's stand-in for a character the asked-for font lacks. Each failure names the page's view, the entry and the
 * glyph; `entries` is every entry some mark was drawn for.
 */
export function fallbackFailures(seen: readonly Seen[]): { failures: string[]; entries: Entry[] } {
  const failures = new Set<string>();
  const entries = new Set<Entry>();
  for (const s of seen) {
    const runs = runsOf(s.snapshot);
    const views = viewsOf(s.snapshot);
    if (typeof runs === 'string' || typeof views === 'string') { failures.add(`${s.page}: ${typeof runs === 'string' ? runs : views}`); continue; }
    const marks = flat(s.snapshot.tree).filter((n) => isEntry(n.value));
    for (const m of marks) entries.add(m.value as Entry);
    for (const r of runs) {
      const holder = marks.filter((m) => inside(m.bounds, middle(r.bounds))).sort((a, b) => area(a.bounds) - area(b.bounds))[0];
      if (!holder || r.face !== '') continue;
      const view = viewAt(views, middle(r.bounds))?.name ?? `${s.page} (outside every view)`;
      failures.add(`${view}: the ${String(holder.value)} mark ${JSON.stringify(holder.id ?? holder.name)} draws ${JSON.stringify(r.text)} from a font no text asked for: font fallback (${s.page})`);
    }
  }
  return { failures: [...failures], entries: [...entries] };
}

// ---- The taste call (AC4), in #1461's shape.

export interface Taste { issue?: number; criterion?: string; verdict?: string | null; who?: string | null; when?: string | null; files?: Record<string, string>; note?: string }
export const sorted = (files: Record<string, string>): string => JSON.stringify(Object.fromEntries(Object.entries(files).sort()));
