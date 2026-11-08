// Test-side tools for #1172 (README). The real `deep-app` against a real hub on a temp home with a fixture record,
// read from outside its process (probe.swift, screencapture, sips), and the judges each criterion's failure message
// comes from. The hub as a process and its line protocol are #16's (tests/acceptance/16/helpers.ts), used as they are.
// Nothing here stands in for the app or the hub; the plants are builds of the app.
//
// Safety: HOME is a temp folder under /tmp for every process started; a process is stopped only by the PID it was
// started with; no test touches the real ~/.deepbuild, ~/.claude or ~/Library/LaunchAgents; no network, no model.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, expect } from 'vitest';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { cleanup, childEnv, CLI, hookRequest, installedRoot, makeHome, newSession, NODE, openAs, own, REPO, result, sendHook, sleep, startHub, tempDir, tokenOf, ulid, type Conn, type Hub, type Session } from '../16/helpers.ts';

export { sleep, tempDir, type Hub };
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
/** The reference window, in points, at 2× (design: Decided). */
export const REFERENCE = { width: 1512, height: 982, scale: 2 } as const;
/** What each criterion allows a slow first launch of a debug build: on a machine under load it can take a minute. */
const LAUNCH_MS = 180_000;
const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> => new Promise((resolve, reject) => {
  execFile(cmd, args, { env: env ?? process.env, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(Error(`${cmd} ${args.join(' ')}: ${error.message}; ${stderr.slice(0, 800)}`));
    else resolve(stdout);
  });
});

export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
/** The 1-minute load average is above half the cores: a late reading says nothing about the app (#1141's rule). */
export const loaded = (): boolean => loadavg()[0]! > cpus().length / 2;

/** Stops what the file started and removes its folders, once its tests are done. */
export const useCleanup = (): void => { afterAll(() => cleanup(), 60_000); };

// ---- Builds. Each binary is copied out of the target folder under its own name, as #1162's suite does, so a plant's
// build never stands in for the app; a plant's build is followed by the plain one, so the checkout's target/debug
// holds the plain app afterwards.

export type Plant = 'plant-spike-window' | 'plant-handle-rows' | 'plant-tab-text';
const BIN = join(tmpdir(), `da1172-bin-${userInfo().uid}`);
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const built = new Map<string, Promise<string>>();
function cargo(args: string[]): Promise<string> { return run('cargo', ['build', '--locked', '-q', ...args], CARGO_ENV); }
/** The plain app, or a plant's, copied out of the target folder. */
export function appBinary(plant?: Plant): Promise<string> {
  const key = plant ?? 'plain';
  let build = built.get(key);
  if (!build) {
    build = (async () => {
      mkdirSync(BIN, { recursive: true });
      const out = join(BIN, `deep-app-${key}`);
      if (plant) await appBinary();
      await cargo(['-p', 'deep-app', '--bin', 'deep-app', ...(plant ? ['--features', plant] : [])]);
      copyFileSync(target('deep-app'), out);
      if (plant) await cargo(['-p', 'deep-app', '--bin', 'deep-app']);
      return out;
    })();
    built.set(key, build);
  }
  return build;
}
/** What the hub's canvas side runs and the replica: built in the checkout, where the hub looks for them. */
export function supportBinaries(): Promise<void> {
  let build = built.get('support');
  if (!build) {
    build = cargo(['-p', 'deep-show', '--bin', 'deep-show', '-p', 'deep-replica', '--bin', 'deep-replica', '-p', 'deep-hook', '--bin', 'deep-hook']).then(() => '');
    built.set('support', build);
  }
  return build.then(() => undefined);
}
export const replicaBinary = (): string => target('deep-replica');
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const sha256File = (path: string): string => sha256(readFileSync(path));

// ---- The probe: compiled once a run, from probe.swift.

let compiled: Promise<string> | undefined;
export function probeBinary(): Promise<string> {
  if (process.platform !== 'darwin') return Promise.resolve(blocked(`the app draws on macOS only; this is ${process.platform}`));
  compiled ??= (async () => {
    mkdirSync(BIN, { recursive: true });
    const out = join(BIN, `probe-${sha256File(join(SUITE, 'probe.swift')).slice(0, 12)}`);
    if (!existsSync(out)) await run('swiftc', ['-O', '-module-cache-path', join(BIN, 'swift-cache'), join(SUITE, 'probe.swift'), '-o', out]);
    const access = JSON.parse(await run(out, ['access'])) as { ax: boolean; screen: boolean; screens: number[][] };
    if (!access.ax) blocked('this process has no Accessibility permission, so nothing can read the real window\'s nodes or the menu bar; grant it to the app the tests run under');
    if (!access.screen) blocked('this process has no Screen Recording permission, so nothing can read the real window\'s pixels; grant it to the app the tests run under');
    return out;
  })();
  return compiled;
}
const probe = async <T>(...args: string[]): Promise<T> => JSON.parse(await run(await probeBinary(), args)) as T;

// ---- The real app, from outside.

export interface Node { role: string; name: string; frame: number[]; children: Node[] }
export interface Win { id: number; frame: number[] }
export interface Tree { t0: number; t1: number; windows: { frame: number[]; tree: Node }[]; menu: string[]; menuFrames: number[][] }
export interface Line { text: string; box: number[] }
export const nodes = (root: Node): Node[] => [root, ...root.children.flatMap(nodes)];
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** The pixels read as text hold `text`, whatever spacing or punctuation the reading gives it. */
export const reads = (lines: readonly Line[], text: string): boolean => lines.some((l) => squash(l.text).includes(squash(text)));
export const sees = (lines: readonly Line[]): string => JSON.stringify(lines.map((l) => l.text)).slice(0, 1500);

export interface Launch { home: string; binary: string; args?: string[]; env?: Record<string, string> }
export class App {
  readonly err: () => string;
  private constructor(readonly child: ChildProcess, readonly pid: number, private readonly dir: string, err: () => string) { this.err = err; }

  /** Starts the app, waits for its window, and sets that window to the reference window. */
  static async launch(o: Launch): Promise<App> {
    await probeBinary();
    const child = spawn(o.binary, o.args ?? [], { cwd: REPO, env: childEnv(o.home, { ...o.env }), stdio: ['ignore', 'ignore', 'pipe'] });
    own(child.pid);
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const app = new App(child, child.pid!, tempDir(), () => err);
    const deadline = Date.now() + LAUNCH_MS;
    while (!(await app.windows()).length) {
      if (child.exitCode !== null || child.signalCode !== null) blocked(`deep-app exited (${child.exitCode ?? child.signalCode}) before its window: ${err.slice(-800)}`);
      if (Date.now() > deadline) blocked(`deep-app showed no window in ${LAUNCH_MS} ms: ${err.slice(-800)}`);
      await sleep(250);
    }
    await app.place();
    return app;
  }

  windows(): Promise<Win[]> { return probe(`windows`, String(this.pid)); }
  tree(): Promise<Tree> { return probe('tree', String(this.pid)); }
  /** The press a screen reader sends: to the first node whose name holds `text`, of `role` when one is named. */
  press(text: string, role?: string): Promise<{ found: boolean; pressed?: boolean; code?: number; role?: string }> { return probe('press', String(this.pid), text, ...(role ? [role] : [])); }

  /** Asks for the tree, which starts the app's accessibility, then resizes the window, which draws a frame of it. */
  async place(): Promise<void> {
    await this.tree();
    let frame: number[] = [];
    for (let tries = 0; tries < 40; tries++) {
      frame = await probe<number[]>('place', String(this.pid), String(REFERENCE.width), String(REFERENCE.height)).catch(() => []);
      if (Math.abs((frame[2] ?? 0) - REFERENCE.width) < 1 && Math.abs((frame[3] ?? 0) - REFERENCE.height) < 1) break;
      await sleep(250);
    }
    await probe('front', String(this.pid)).catch(() => undefined);
    await sleep(500);
  }

  /** The window's pixels as the window server holds them, in sRGB, whatever covers it. */
  async capture(name: string, window?: Win): Promise<Picture> {
    const win = window ?? (await this.mainWindow());
    return captureWindow(win.id, join(this.dir, `${name}.png`));
  }
  /** The largest window: the main one until a test says which holds what. */
  async mainWindow(): Promise<Win> {
    const list = await this.windows();
    const win = [...list].sort((a, b) => b.frame[2]! * b.frame[3]! - a.frame[2]! * a.frame[3]!)[0];
    return win ?? blocked(`deep-app has no window: ${this.err().slice(-500)}`);
  }
  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    const deadline = Date.now() + 3000;
    while (this.child.exitCode === null && this.child.signalCode === null && Date.now() < deadline) await sleep(50);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
  }
}

export async function captureWindow(id: number, path: string): Promise<Picture> {
  const raw = `${path}.raw.png`;
  await run('/usr/sbin/screencapture', ['-x', '-o', `-l${id}`, raw]);
  await run('/usr/bin/sips', ['-m', '/System/Library/ColorSync/Profiles/sRGB Profile.icc', raw, '--out', path]);
  return readPng(path);
}
export const ocr = async (picture: Picture): Promise<Line[]> => probe('ocr', picture.path);

// ---- Pictures.

export interface Picture { path: string; width: number; height: number; at(x: number, y: number): [number, number, number] }
/** Decodes an 8- or 16-bit RGB or RGBA PNG, not interlaced, as sips writes one. */
export function readPng(path: string): Picture {
  const file = readFileSync(path);
  let at = 8;
  const idat: Buffer[] = [];
  let width = 0; let height = 0; let depth = 0; let type = 0;
  while (at < file.length) {
    const size = file.readUInt32BE(at);
    const name = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + size);
    if (name === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; type = body[9]!; }
    if (name === 'IDAT') idat.push(body);
    at += 12 + size;
  }
  const channels = type === 6 ? 4 : type === 2 ? 3 : blocked(`${path} is PNG color type ${type}`);
  const bytes = channels * (depth / 8);
  const stride = width * bytes;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const from = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bytes ? pixels[y * stride + x - bytes]! : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const c = x >= bytes && y > 0 ? pixels[(y - 1) * stride + x - bytes]! : 0;
      let value = raw[from + x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + x] = value & 255;
    }
  }
  const step = depth === 16 ? 2 : 1;
  return {
    path, width, height,
    at: (x, y) => {
      const i = Math.round(y) * stride + Math.round(x) * bytes;
      return [pixels[i]!, pixels[i + step]!, pixels[i + 2 * step]!];
    },
  };
}
export type Rgb = readonly [number, number, number];
export const hex = (c: Rgb): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const parseHex = (h: string): [number, number, number, number] => {
  const v = h.replace('#', '');
  const byte = (i: number) => Number.parseInt(v.slice(i, i + 2), 16);
  return [byte(0), byte(2), byte(4), v.length > 6 ? byte(6) : 255];
};
export const near = (a: Rgb, b: Rgb, tolerance: number): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);
export const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The look: the app's clean look, a role in light or dark, an alpha role as it shows over the ground. */
const LOOK = JSON.parse(readFileSync(join(REPO, 'crates/deep-canvas-marks/looks/clean.json'), 'utf8')) as {
  palette: Record<string, string>; roles: Record<string, string>; themes: { dark: { roles: Record<string, string> } };
};
export function role(name: string, dark: boolean): Rgb {
  const of = (n: string): [number, number, number, number] => parseHex(LOOK.palette[(dark ? LOOK.themes.dark.roles[n] : undefined) ?? LOOK.roles[n]!]!);
  const [r, g, b, a] = of(name);
  const [gr, gg, gb] = of('ground');
  const over = (v: number, under: number) => (v * a + under * (255 - a)) / 255;
  return [over(r, gr), over(g, gg), over(b, gb)];
}

/** The most common color in a rectangle of device pixels, and the color furthest from it: a text's ground and its ink. */
export function groundAndInk(p: Picture, box: readonly number[]): { ground: Rgb; ink: Rgb } {
  const [x0, y0, w, h] = box as [number, number, number, number];
  const counts = new Map<number, number>();
  const all: Rgb[] = [];
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(p.height, y0 + h); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(p.width, x0 + w); x++) {
      const c = p.at(x, y);
      all.push(c);
      const key = (c[0] << 16) | (c[1] << 8) | c[2];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const ground: Rgb = [top >> 16, (top >> 8) & 255, top & 255];
  const inked = all.map((c) => ({ c, d: distance(c, ground) })).sort((a, b) => b.d - a.d);
  // The core of the strokes: 1 pixel in 200 of the box, so one stray pixel doesn't decide it.
  const core = inked.slice(0, Math.max(1, Math.floor(all.length / 200)));
  const ink = [0, 1, 2].map((i) => core.reduce((sum, { c }) => sum + c[i]!, 0) / core.length) as unknown as Rgb;
  return { ground, ink };
}

/** The bounding box of every pixel of a color in a device-pixel rectangle, and how much of that box it fills. */
export function blockOf(p: Picture, color: Rgb, tolerance = 6): { x: number; y: number; w: number; h: number; fill: number } | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  let count = 0;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      if (!near(p.at(x, y), color, tolerance)) continue;
      count++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (!count) return null;
  const [w, h] = [x1 - x0 + 1, y1 - y0 + 1];
  return { x: x0, y: y0, w, h, fill: count / (w * h) };
}

const TAB = 'the terminal tab';
/**
 * Where a grid of equal cells puts the fixture terminal's fills (FEED), by the pixels alone: `five` is 5 cells from
 * column 0, `one` the cell at column 7 of that row, and `bar` the two cells at column 10 of the next two rows. Nothing
 * assumes a cell's size: one cell's own block gives it.
 */
export function gridLaw(p: Picture, five: Rgb, one: Rgb, bar: Rgb): string[] {
  const [a, b, c] = [blockOf(p, five), blockOf(p, one), blockOf(p, bar)];
  if (!a || !b || !c) return [`${TAB} wrote its text outside the cell grid: the window's pixels have no fill of the cells it asked for (5 cells ${a ? 'found' : 'missing'}, 1 cell ${b ? 'found' : 'missing'}, the cells after the glyphs ${c ? 'found' : 'missing'})`];
  const out: string[] = [];
  const cell = { w: b.w, h: b.h };
  const close = (x: number, y: number): boolean => Math.abs(x - y) <= 4;
  for (const [name, block] of [['the 5 cells', a], ['the 1 cell', b], ['the cells after the glyphs', c]] as const) {
    if (block.fill < 0.97) out.push(`${TAB}: ${name} aren't a solid block on the window's pixels (${Math.round(block.fill * 100)}% filled)`);
  }
  if (!close(a.w, 5 * cell.w) || !close(a.h, cell.h)) out.push(`${TAB}: 5 cells draw ${a.w} × ${a.h} px and one ${cell.w} × ${cell.h}: its rows aren't on a grid of equal cells`);
  if (!close(b.x - a.x, 7 * cell.w)) out.push(`${TAB}: the cell at column 7 starts ${b.x - a.x} px after column 0, not 7 cells of ${cell.w} px`);
  if (!close(b.y, a.y)) out.push(`${TAB}: two cells of one row start at ${a.y} and ${b.y} px down`);
  // One block spanning two rows: after ten thin glyphs and after ten wide ones, the same x.
  if (!close(c.w, cell.w) || !close(c.h, 2 * cell.h)) out.push(`${TAB}: the cell after ten "i"s and the cell after ten "W"s should stack one cell wide and two tall; they cover ${c.w} × ${c.h} px, with a cell ${cell.w} × ${cell.h}: the text isn't on the grid's columns`);
  if (!close(c.x - a.x, 10 * cell.w)) out.push(`${TAB}: the cells after ten glyphs start ${c.x - a.x} px in, not 10 cells of ${cell.w} px`);
  return out;
}

// ---- The fixture record: two sessions, three open asks, two readings (README, The fixture).

export interface Ask { handle: string; question: string; option: { id: string; label: string }; other: string; session: string; task: string }
export type FixtureSession = Session & { task: string };
export interface World { home: string; root: string; hub: Hub; app: Conn; asks: Ask[]; sessions: FixtureSession[]; staleAsOf: number }

const SESSIONS = [{ task: 'Cart totals' }, { task: 'Release notes' }] as const;
const QUESTIONS = [
  { at: 0, question: 'Which header colour on the login page?', options: ['Blue header', 'Green header'] },
  { at: 0, question: 'Which font for the printed receipt?', options: ['Serif receipt', 'Sans receipt'] },
  { at: 1, question: 'Which layout for the changelog?', options: ['Keep a list', 'Write prose'] },
] as const;
/** Repeats `judge` until it finds nothing wrong or `ms` pass: the app draws what its reader reads a moment after it opens. */
export async function settled(judge: () => Promise<string[]>, ms = 12_000): Promise<string[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const failures = await judge();
    if (!failures.length || Date.now() > deadline) return failures;
    await sleep(300);
  }
}
export const STALE_VALUE = '182.40';
export const FRESH_VALUE = '96.10';
export const STALE_AGE_MS = 120_000;
/**
 * What the terminal's program printed (README, The terminal): a line of words; five cells of one background, a gap of
 * two, one cell of another; and ten thin and ten wide glyphs, each followed by a cell of a third background, so those
 * two cells line up only on a grid of equal cells.
 */
export const FEED = [
  'grid says hello\r\n',
  '\x1b[48;2;216;27;154m     \x1b[0m  \x1b[48;2;19;196;163m \x1b[0m\r\n',
  '\x1b[38;2;255;122;0miiiiiiiiii\x1b[0m\x1b[48;2;96;64;208m \x1b[0m\r\n',
  '\x1b[38;2;255;122;0mWWWWWWWWWW\x1b[0m\x1b[48;2;96;64;208m \x1b[0m\r\n',
].join('');
export const TERMINAL = { id: 'term1', cols: 40, rows: 6 } as const;

/** Puts two sessions with their tasks, three open asks and two readings in the record, as the core would, before any hub runs there. */
async function seed(home: string, root: string): Promise<{ asks: Ask[]; sessions: FixtureSession[]; staleAsOf: number }> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const now = (): number => Date.now();
  const record = await openRecord({ path: join(root, 'ledger.db'), now });
  const sessions = SESSIONS.map((s) => ({ ...newSession(home, 'claude-code'), task: s.task }));
  for (const s of sessions) {
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session: s.id, agent: 'claude-code', verified: true }, {
      v: 4, id: ulid(), kind: 'session.start', ts: now(), data: { agent: 'claude-code', worktree: root, branch: 'main', thread: s.id, billing: {}, loads: [] },
    });
    await record.append({ writer: 'app', actor: 'you', scope: 'you', session: s.id }, {
      v: 1, id: ulid(), kind: 'task.created', ts: now(), data: { task_ref: `task:${ulid()}`, thread: s.id, owner: 'you', title: s.task },
    });
  }
  const core = await openAsks({ record, now, deliver: () => undefined });
  const row = askSources().find((r) => r.source === 'deep_ask.taste') ?? blocked('ask.sources@1 has no row deep_ask.taste');
  const asks: Ask[] = [];
  for (const { at, question, options } of QUESTIONS) {
    const session = sessions[at]!;
    const template = row.fixture.ask as Record<string, unknown>;
    const handle = await core.raise({ writer: 'core', actor: 'you', scope: 'you', session: session.id }, 'deep_ask.taste', {
      ...template, question, key: sha256(`#1172 ${question}`), deadline: now() + 86_400_000, recommended: 'one', default: 'one',
      options: [{ id: 'one', label: options[0], decision: 'none' }, { id: 'two', label: options[1], decision: 'none' }],
      pinned_to: { ...(template.pinned_to as object), ref: sha256(question) },
    });
    asks.push({ handle, question, option: { id: 'one', label: options[0] }, other: options[1], session: session.id, task: session.task });
  }
  const staleAsOf = now() - STALE_AGE_MS;
  for (const [reading, value, asOf] of [['quotes', 182.4, staleAsOf], ['rates', 96.1, now()]] as const) {
    await record.append({ writer: 'core', actor: 'you', scope: 'you' }, {
      v: 1, id: ulid(), kind: 'reading.recorded', ts: now(), data: { reading: `reading:${reading}`, value, unit: 'USD', as_of: asOf, source: reading, n: 1, outside: false },
    });
  }
  await record.close();
  return { asks, sessions, staleAsOf };
}

/** A temp home with the fixture record, a real hub on it and the hub's canvas side holding a terminal for the first session. */
export async function makeWorld(): Promise<World> {
  await Promise.all([supportBinaries(), probeBinary()]);
  const home = makeHome();
  const root = installedRoot(home);
  const seeded = await seed(home, root);
  // Setup finished in this home, so no `deep` command here offers it, and the first screen is the shell's.
  const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
  writeFileSync(join(root, 'setup-finished.json'), JSON.stringify({ version }));
  const dir = tempDir();
  const confirm = join(dir, 'confirm.sh');
  writeFileSync(confirm, '#!/bin/sh\nexit 0\n');
  chmodSync(confirm, 0o700);
  const file = join(dir, 'world.json');
  writeFileSync(file, JSON.stringify({ window: [REFERENCE.width, REFERENCE.height], panels: { 'session-page': { rect: [260, 0, 1252, 862] } } }));
  const hub = await startHub({ home, env: { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_SHOW: file } });
  const app = await openAs(hub.socket, 'app', tokenOf(root));
  // The canvas core knows a session once the hub has it live: its SessionStart hook, as the agent's would send it.
  // Its process is a stand-in of its own, so no `deep` command a test runs counts as inside an agent's process tree.
  for (const s of seeded.sessions) {
    const agent = spawn('/bin/sleep', ['3600'], { stdio: 'ignore' });
    own(agent.pid);
    await sendHook(hub.socket, { ...hookRequest(s, 'SessionStart'), pid: agent.pid!, ppid: agent.pid! });
  }
  const world = { home, root, hub, app, ...seeded };
  const opened = await canvasUser(world, { call: 'terminal_open', terminal: TERMINAL.id, session: seeded.sessions[0]!.id, cols: TERMINAL.cols, rows: TERMINAL.rows, feed: [{ at: 0, text: FEED }] });
  if ('code' in opened) blocked(`the hub's canvas core didn't open the fixture's terminal: ${JSON.stringify(opened)}`);
  return world;
}

/** The fixture panel, copied to a temp folder: gpui-shell writes its type files beside a panel it loads. */
export function panelDir(): string {
  const dir = join(tempDir(), 'panel');
  cpSync(join(FIXTURES, 'panel'), dir, { recursive: true });
  return dir;
}
/** A home with nothing of DeepBuild: no record, no hub. */
export const freshHome = (): string => makeHome();
export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
/** A program run to its end with HOME the world's. */
export const childProcess = (command: string, args: string[], home: string): Promise<string> => run(command, args, childEnv(home, {}));
export function deep(world: World, args: string[]): Promise<string> {
  return run(NODE, [CLI, ...args], childEnv(world.home, {}));
}
/** Your answer in the record: `deep inbox answer`, the CLI's, once the OS confirms you. */
export const answer = (world: World, ask: Ask): Promise<string> => deep(world, ['inbox', 'answer', ask.handle, ask.option.id]);
/** The call the app plays on the hub's canvas core (`canvas.user`). */
export const canvasUser = async (world: World, call: Record<string, unknown>): Promise<Record<string, unknown>> => result(await world.app.call('canvas.user', { call })) as Record<string, unknown>;

// ---- What the real window shows.

/** The nodes whose name holds `text`, without the ones inside such a node: a row and the label within it are one row. */
const outermost = (node: Node, text: string): Node[] => (node.name.includes(text) ? [node] : node.children.flatMap((c) => outermost(c, text)));

/** Each failure of "the registered shell over the fixture record", or none; the spike window is named as such. */
export async function shellFailures(world: World, app: App, want: { rows: readonly Ask[]; count: number }): Promise<string[]> {
  const out: string[] = [];
  const tree = await app.tree();
  const main = tree.windows.flatMap((w) => nodes(w.tree));
  const named = main.filter((n) => n.name);
  const lines = await ocr(await app.capture(`shell-${want.count}`));
  const spike = [...named.map((n) => n.name), ...lines.map((l) => l.text)].find((text) => /\bSession \d{4}\b|waiting on you/.test(text));
  if (spike) out.push(`the window is the spike window: it draws "${spike}"`);
  if (!named.some((n) => n.name === 'Tasks')) out.push(`the window has no registered sidebar: no node is named "Tasks"; its names are ${JSON.stringify(named.map((n) => n.name).slice(0, 20))}`);
  for (const s of world.sessions) {
    const rows = named.filter((n) => n.role === 'AXButton' && n.name.includes(s.task));
    if (rows.length !== 1) out.push(`the sidebar should show session "${s.task}" once, as a row; it has ${rows.length}`);
  }
  if (!named.some((n) => n.name === 'Needs you')) out.push('the window has no Needs you view: no node is named "Needs you"');
  for (const ask of world.asks) {
    const rows = tree.windows.flatMap((w) => outermost(w.tree, ask.question));
    const wanted = want.rows.includes(ask) ? 1 : 0;
    if (rows.length !== wanted) out.push(`Needs you should show ${wanted} row for ${ask.handle} ("${ask.question}"); it has ${rows.length}`);
    if (reads(lines, ask.question) !== (wanted === 1)) out.push(`the window's pixels ${wanted ? 'lack' : 'still draw'} ${ask.handle}'s question: they read ${sees(lines)}`);
  }
  const counted = lines.flatMap((l) => [...l.text.matchAll(/\b(\d+)\s+asks?\s+needs?\s+you\b/gi)]).map((m) => Number(m[1]));
  for (const n of counted) if (n !== want.count) out.push(`the window's count reads ${n}, not ${want.count}`);
  const menu = menuCount(tree);
  if (menu !== want.count) out.push(`the menu bar reads ${JSON.stringify(tree.menu)}, not ${want.count}`);
  return out;
}
/** The number the menu-bar item's title holds, or null when it holds none or more than one. */
export function menuCount(tree: Tree): number | null {
  const numbers = tree.menu.flatMap((t) => [...t.matchAll(/\d+/g)].map((m) => Number(m[0])));
  return numbers.length === 1 ? numbers[0]! : null;
}
/** What a row's name holds where it should hold its question: a handle, named. */
export function handleRows(world: World, tree: Tree): string[] {
  const names = tree.windows.flatMap((w) => nodes(w.tree)).map((n) => n.name);
  return world.asks.filter((a) => names.some((n) => n.includes(a.handle))).map((a) => `Needs you shows ${a.handle} by its handle, not its question`);
}

/** The menu-bar item's pixels, the screen's own: AppKit's status item is no window of the app's that a capture can name. */
export async function captureMenu(tree: Tree, path: string): Promise<void> {
  const box = tree.menuFrames[0] ?? blocked('the app has no menu-bar item to capture');
  await run('/usr/sbin/screencapture', ['-x', `-R${box.map(Math.round).join(',')}`, path]);
}
