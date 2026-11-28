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
import { withDeclared } from '../declared.ts';

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
  const core = withDeclared(await openAsks({ record, now, deliver: () => undefined }));
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

// ---- A list row on the pixels (REDRAFT.md, Third redraft). Added beside the judges above, which stay as they were:
// other issues' tests read this file, so a changed reading lands only as a new one.

/** Letters and digits of a question's start that a list row cut short must still draw, and whose drawing counts as the row drawn. */
export const ROW_START = 10;
/**
 * A list row draws its ask's question: one pixel line holds the whole question, or its start, at least ROW_START letters
 * and digits, cut there by an ellipsis. The design's row is one line of fixed slots (mark, title, then state word and time
 * at the right edge), and "text cut from the screen stays in the accessible name", so a title past the row's width ends in
 * an ellipsis and only the tree holds it whole.
 */
export function drawsRow(lines: readonly Line[], question: string): boolean {
  if (reads(lines, question)) return true;
  const q = squash(question);
  return lines.some((l) => [...l.text.matchAll(/…|\.{2,}/g)].some((m) => {
    const before = squash(l.text.slice(0, m.index));
    for (let k = q.length - 1; k >= ROW_START; k--) if (before.endsWith(q.slice(0, k))) return true;
    return false;
  }));
}

/**
 * `shellFailures`, with each Needs you row judged on the pixels by `drawsRow` instead of its whole question on one line:
 * a wanted row is drawn whole or cut by an ellipsis, an unwanted one neither. Everything else is `shellFailures`' own.
 */
export async function shellFailuresCut(world: World, app: App, want: { rows: readonly Ask[]; count: number }): Promise<string[]> {
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
    if (drawsRow(lines, ask.question) !== (wanted === 1)) out.push(`the window's pixels ${wanted ? 'lack' : 'still draw'} ${ask.handle}'s row with its question, whole or cut by an ellipsis after its first ${ROW_START} letters and digits: they read ${sees(lines)}`);
  }
  const counted = lines.flatMap((l) => [...l.text.matchAll(/\b(\d+)\s+asks?\s+needs?\s+you\b/gi)]).map((m) => Number(m[1]));
  for (const n of counted) if (n !== want.count) out.push(`the window's count reads ${n}, not ${want.count}`);
  const menu = menuCount(tree);
  if (menu !== want.count) out.push(`the menu bar reads ${JSON.stringify(tree.menu)}, not ${want.count}`);
  return out;
}

// ---- A Needs you row told apart from an open card (REDRAFT.md, Fourth redraft). Added beside the judges above, which
// stay as they were: other issues' tests read this file, so a changed reading lands only as a new one.

const holdsText = (node: Node, text: string): boolean => nodes(node).some((n) => n.name.includes(text));
/** Both the ask's options are `AXButton`s at or under `node`: a presented card, as AC3's judge and popout.test.ts read one. */
const holdsOptions = (node: Node, ask: Ask): boolean => [ask.option.label, ask.other].every((label) => nodes(node).some((n) => n.role === 'AXButton' && n.name.includes(label)));

/**
 * The outermost nodes holding the ask's question, split into its card's and its rows. A node is the card's when the
 * nearest node at or above it that holds both the ask's options as `AXButton`s holds no other ask's question: the card,
 * apart from the list. Every other such node is a row.
 */
export function askNodes(root: Node, ask: Ask, asks: readonly Ask[]): { rows: Node[]; card: Node[] } {
  const out = { rows: [] as Node[], card: [] as Node[] };
  const walk = (node: Node, up: readonly Node[]): void => {
    if (node.name.includes(ask.question)) {
      const box = [...up, node].reverse().find((a) => holdsOptions(a, ask));
      const card = box !== undefined && !asks.some((o) => o !== ask && holdsText(box, o.question));
      (card ? out.card : out.rows).push(node);
      return;
    }
    for (const c of node.children) walk(c, [...up, node]);
  };
  walk(root, []);
  return out;
}

/**
 * Each failure of Needs you's rows on the tree, over every window's root: a wanted ask has exactly one row outside its
 * card, and while its options are on the tree a node holding its question sits in that card, so the two are told
 * apart; an unwanted ask (AC2's answered one) has no row and no card.
 */
export function askRowFailures(windows: readonly Node[], asks: readonly Ask[], wanted: readonly Ask[]): string[] {
  const out: string[] = [];
  for (const ask of asks) {
    const split = windows.map((w) => askNodes(w, ask, asks));
    const rows = split.flatMap((s) => s.rows).length;
    const card = split.flatMap((s) => s.card).length;
    if (wanted.includes(ask)) {
      if (rows !== 1) out.push(`Needs you should show 1 row for ${ask.handle} ("${ask.question}") outside its card; it has ${rows}`);
      else if (!card && windows.some((w) => holdsOptions(w, ask))) out.push(`${ask.handle}'s options are on the tree, but no node holding its question sits in a card apart from the list, so its row can't be told from its card`);
    } else {
      if (rows) out.push(`Needs you should show 0 rows for ${ask.handle} ("${ask.question}"); it has ${rows}`);
      if (card) out.push(`the window still shows ${ask.handle}'s card ("${ask.question}") after it left Needs you`);
    }
  }
  return out;
}

/**
 * `shellFailuresCut`, with each ask's rows on the tree judged by `askRowFailures` instead of every outermost node
 * holding its question: an open card's question isn't a row. Everything else is `shellFailuresCut`'s own.
 */
export async function shellFailuresCard(world: World, app: App, want: { rows: readonly Ask[]; count: number }): Promise<string[]> {
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
  out.push(...askRowFailures(tree.windows.map((w) => w.tree), world.asks, want.rows));
  for (const ask of world.asks) {
    const wanted = want.rows.includes(ask);
    if (drawsRow(lines, ask.question) !== wanted) out.push(`the window's pixels ${wanted ? 'lack' : 'still draw'} ${ask.handle}'s row with its question, whole or cut by an ellipsis after its first ${ROW_START} letters and digits: they read ${sees(lines)}`);
  }
  const counted = lines.flatMap((l) => [...l.text.matchAll(/\b(\d+)\s+asks?\s+needs?\s+you\b/gi)]).map((m) => Number(m[1]));
  for (const n of counted) if (n !== want.count) out.push(`the window's count reads ${n}, not ${want.count}`);
  const menu = menuCount(tree);
  if (menu !== want.count) out.push(`the menu bar reads ${JSON.stringify(tree.menu)}, not ${want.count}`);
  return out;
}

// ---- An answered ask: its list row kept drawn answered, and its page saying what became of it (REDRAFT.md, Seventh
// redraft). Added beside the judges above, which stay as they were.

/** The word "answered" in any case (#1461 "drawn answered" gives none), not negated: "Not answered", "not yet answered", "isn't answered", "unanswered" don't read. */
const ANSWERED_WORD = /(?<!(?:\b(?:not|yet|be|never)|n't)\s+)\banswered\b/i;
const center = (n: Node): number => (n.frame[0] ?? 0) + (n.frame[2] ?? 0) / 2;

/**
 * The list's right edge on the tree, in screen points: the right edge of the session rows (README item 2: each an `AXButton`
 * whose name holds its task's title). The design's window has two regions, the list and the page, and #1461 puts the list
 * on the left and the page on the right, so a node whose centre is left of this edge is the list's. `null` if no session row.
 */
export function listEdge(windows: readonly Node[], tasks: readonly string[]): number | null {
  const rows = windows.flatMap(nodes).filter((n) => n.role === 'AXButton' && tasks.some((t) => n.name.includes(t)) && n.frame.length === 4);
  return rows.length ? Math.max(...rows.map((n) => n.frame[0]! + n.frame[2]!)) : null;
}

/**
 * Each failure of an answered ask on the tree. #1461: its list row "keeps its slot", "drawn answered". The design's
 * Address: "an address that no longer resolves says what it was and what became of it", so the page that showed its card
 * may keep showing the ask, answered. So: at most one node holding its question in the list and at most one on the page,
 * each reading "Answered" in it or in the nearest nodes above it that hold no other ask's question; no card, and its two
 * options nowhere on the tree as `AXButton`s (invariant 4).
 */
export function answeredFailures(windows: readonly Node[], ask: Ask, asks: readonly Ask[], tasks: readonly string[]): string[] {
  const edge = listEdge(windows, tasks);
  if (edge === null) return [`can't tell the list from the page: no session row ${JSON.stringify(tasks)} is on the tree`];
  const out: string[] = [];
  const found: { node: Node; answered: boolean }[] = [];
  const walk = (node: Node, up: readonly Node[]): void => {
    if (node.name.includes(ask.question)) {
      const near = [node, ...[...up].reverse()];
      const stop = near.findIndex((a) => asks.some((o) => o !== ask && holdsText(a, o.question)));
      found.push({ node, answered: near.slice(0, stop < 0 ? near.length : stop).some((a) => nodes(a).some((n) => ANSWERED_WORD.test(n.name))) });
      return;
    }
    for (const c of node.children) walk(c, [...up, node]);
  };
  for (const w of windows) walk(w, []);
  for (const [where, inList] of [['list', true], ['page', false]] as const) {
    const here = found.filter((f) => (center(f.node) < edge) === inList);
    if (here.length > 1) out.push(`answered ${ask.handle} ("${ask.question}") may keep at most 1 node in the ${where}, drawn answered; it has ${here.length}`);
    for (const f of here) if (!f.answered) out.push(`answered ${ask.handle} ("${ask.question}") still reads as open in the ${where}: nothing at it reads "Answered"; it holds ${JSON.stringify(nodes(f.node).map((n) => n.name).filter(Boolean))}`);
  }
  if (windows.some((w) => holdsOptions(w, ask))) out.push(`the window still offers answered ${ask.handle}'s options ("${ask.question}")`);
  return out;
}

/** `askRowFailures` for the wanted asks; every other ask (AC2's answered one) is judged by `answeredFailures`. */
export function askRowFailuresKept(windows: readonly Node[], asks: readonly Ask[], wanted: readonly Ask[], tasks: readonly string[]): string[] {
  const out: string[] = [];
  for (const ask of asks) {
    if (!wanted.includes(ask)) { out.push(...answeredFailures(windows, ask, asks, tasks)); continue; }
    const split = windows.map((w) => askNodes(w, ask, asks));
    const rows = split.flatMap((s) => s.rows).length;
    const card = split.flatMap((s) => s.card).length;
    if (rows !== 1) out.push(`Needs you should show 1 row for ${ask.handle} ("${ask.question}") outside its card; it has ${rows}`);
    else if (!card && windows.some((w) => holdsOptions(w, ask))) out.push(`${ask.handle}'s options are on the tree, but no node holding its question sits in a card apart from the list, so its row can't be told from its card`);
  }
  return out;
}

// ---- A Needs you row on the pixels once its time is kept (REDRAFT.md, Ninth redraft). Added beside the judges above,
// which stay as they were.

/**
 * One OCR line draws an ask row: it holds a fixture ask's whole question, or an ellipsis that ends a question's start
 * (any length, none at all included; a mark before it is not a letter or digit) and is followed by the row's right slots
 * (some letter or digit after it). #1808: "A title that doesn't fit its slot ends in an ellipsis at a whole character";
 * #3282 (owner, 2026-11-19): "An ask row's time beats #1808's 12-character title floor", leaving "about 50 px at 260",
 * so a right row may draw no title character at all. Which ask a row is, the tree says (README item 2).
 */
export function askRowLine(text: string, asks: readonly Ask[]): boolean {
  if (asks.some((a) => squash(text).includes(squash(a.question)))) return true;
  return [...text.matchAll(/…|\.{2,}/g)].some((m) => {
    // The row's mark may come through OCR as one character ("o", "e", "0", "·", "°"), a token of its own before the title.
    const before = squash(text.slice(0, m.index).replace(/^\s*\S\s+/, ''));
    return squash(text.slice(m.index! + m[0].length)).length > 0 && asks.some((a) => squash(a.question).startsWith(before));
  });
}

/** The list's right edge in a capture's pixels, from `listEdge` and the window's frame; `null` with no session row. */
export function listEdgePx(roots: readonly Node[], tasks: readonly string[], frame: readonly number[], pictureWidth: number): number | null {
  const edge = listEdge(roots, tasks);
  return edge === null || !frame[2] ? null : (edge - frame[0]!) * pictureWidth / frame[2];
}

/** The lines left of `edgePx` (every line when `null`: a window that is all list) that draw an ask row (`askRowLine`). */
export const askRowLines = (lines: readonly Line[], asks: readonly Ask[], edgePx: number | null): Line[] =>
  lines.filter((l) => (edgePx === null || (l.box[0] ?? 0) + (l.box[2] ?? 0) / 2 < edgePx) && askRowLine(l.text, asks));

/**
 * The list's ask rows on the pixels, counted: exactly `open` rows that don't read answered (one per wanted ask; none seen
 * fails), and at most `kept` that read answered (#1461's kept row, one per answered ask).
 */
export function rowLineFailures(lines: readonly Line[], asks: readonly Ask[], edgePx: number | null, want: { open: number; kept: number }): string[] {
  const rows = askRowLines(lines, asks, edgePx);
  const kept = rows.filter((l) => ANSWERED_WORD.test(l.text));
  const open = rows.filter((l) => !ANSWERED_WORD.test(l.text));
  const out: string[] = [];
  if (open.length !== want.open) out.push(`the list's pixels draw ${open.length} open ask row(s), not ${want.open}: of its lines, these draw a row ${sees(open)}; all read ${sees(lines)}`);
  if (kept.length > want.kept) out.push(`the list's pixels draw ${kept.length} answered ask row(s), more than ${want.kept}: ${sees(kept)}`);
  return out;
}

/**
 * `shellFailuresCard`, with the tree judged by `askRowFailuresKept` (an answered ask may keep a list row and a page,
 * each drawn answered) and the rows on the pixels counted by `rowLineFailures` in the list's region instead of each ask's
 * title read by `drawsRow`. The count and the menu bar are judged as there.
 */
export async function shellFailuresDrawn(world: World, app: App, want: { rows: readonly Ask[]; count: number }): Promise<string[]> {
  const out: string[] = [];
  const tree = await app.tree();
  const main = tree.windows.flatMap((w) => nodes(w.tree));
  const named = main.filter((n) => n.name);
  const win = await app.mainWindow();
  const picture = await app.capture(`shell-${want.count}`, win);
  const lines = await ocr(picture);
  const spike = [...named.map((n) => n.name), ...lines.map((l) => l.text)].find((text) => /\bSession \d{4}\b|waiting on you/.test(text));
  if (spike) out.push(`the window is the spike window: it draws "${spike}"`);
  if (!named.some((n) => n.name === 'Tasks')) out.push(`the window has no registered sidebar: no node is named "Tasks"; its names are ${JSON.stringify(named.map((n) => n.name).slice(0, 20))}`);
  for (const s of world.sessions) {
    const rows = named.filter((n) => n.role === 'AXButton' && n.name.includes(s.task));
    if (rows.length !== 1) out.push(`the sidebar should show session "${s.task}" once, as a row; it has ${rows.length}`);
  }
  if (!named.some((n) => n.name === 'Needs you')) out.push('the window has no Needs you view: no node is named "Needs you"');
  const roots = tree.windows.map((w) => w.tree);
  const tasks = world.sessions.map((s) => s.task);
  out.push(...askRowFailuresKept(roots, world.asks, want.rows, tasks));
  const px = listEdgePx(roots, tasks, win.frame, picture.width);
  if (px === null) out.push(`can't find the list on the pixels: no session row ${JSON.stringify(tasks)} is on the tree`);
  else out.push(...rowLineFailures(lines, world.asks, px, { open: want.rows.length, kept: world.asks.length - want.rows.length }));
  const counted = lines.flatMap((l) => [...l.text.matchAll(/\b(\d+)\s+asks?\s+needs?\s+you\b/gi)]).map((m) => Number(m[1]));
  for (const n of counted) if (n !== want.count) out.push(`the window's count reads ${n}, not ${want.count}`);
  const menu = menuCount(tree);
  if (menu !== want.count) out.push(`the menu bar reads ${JSON.stringify(tree.menu)}, not ${want.count}`);
  return out;
}

// ---- A capture OCR reads nothing from is unreadable, never a reading of 0 (REDRAFT.md, Tenth redraft). Added beside the
// judges above, which stay as they were.

/** The prefix of a failure that says a capture couldn't be read: the run is INCONCLUSIVE on it, never PASS, never 0 rows. */
export const UNREADABLE = 'UNREADABLE: ';
/** OCR of one rectangle of the picture alone (`probe ocr-in`), boxes in the whole picture's pixels. */
export const ocrIn = async (picture: Picture, level: 'accurate' | 'fast', rect: readonly number[]): Promise<Line[]> =>
  probe('ocr-in', picture.path, level, ...rect.map((v) => String(Math.round(v))));

/** Every other pixel of the rectangle, both ways (dense enough to land on a 2 px stroke), is within 12 of the first: one fill. */
export function blankIn(picture: Picture, rect: readonly number[]): boolean {
  const [x0, y0, w, h] = rect.map(Math.floor) as [number, number, number, number];
  const first = picture.at(x0, y0);
  for (let y = y0; y < y0 + h; y += 2) for (let x = x0; x < x0 + w; x += 2) if (distance(picture.at(x, y), first) > 12) return false;
  return true;
}

/**
 * Whether a reading is missing evidence: OCR returned no line from a region that isn't one blank fill. Invariant 2: an
 * empty reading is never a reading of nothing drawn, so it can't count 0 rows; a blank fill can.
 */
export const unreadable = (lines: readonly Line[], blank: boolean, where: string): string | null =>
  lines.length || blank ? null : `${UNREADABLE}OCR read no line from ${where}, which isn't blank, so its pixels can't be judged`;

/**
 * `shellFailuresDrawn`, with the pixels read two ways. The list's rows are counted from OCR of the list's region alone
 * (`ocrIn`, `.accurate`): R5e showed Vision drop a whole correct frame when a long line spans the page beside the list,
 * and read the left 520 px of the same frame whole. The window's own text (the spike, the count) is read from the whole
 * capture, `.accurate` and then `.fast` when that reads nothing. A region read as nothing that isn't blank is `UNREADABLE`,
 * never 0 rows. Everything else is `shellFailuresDrawn`'s own.
 */
export async function shellFailuresRead(world: World, app: App, want: { rows: readonly Ask[]; count: number }): Promise<string[]> {
  const out: string[] = [];
  const tree = await app.tree();
  const main = tree.windows.flatMap((w) => nodes(w.tree));
  const named = main.filter((n) => n.name);
  const win = await app.mainWindow();
  const picture = await app.capture(`shell-${want.count}`, win);
  const whole = [0, 0, picture.width, picture.height];
  let lines = await ocr(picture);
  if (!lines.length) lines = await ocrIn(picture, 'fast', whole);
  const lost = unreadable(lines, blankIn(picture, whole), 'the whole window');
  if (lost) out.push(lost);
  const spike = [...named.map((n) => n.name), ...lines.map((l) => l.text)].find((text) => /\bSession \d{4}\b|waiting on you/.test(text));
  if (spike) out.push(`the window is the spike window: it draws "${spike}"`);
  if (!named.some((n) => n.name === 'Tasks')) out.push(`the window has no registered sidebar: no node is named "Tasks"; its names are ${JSON.stringify(named.map((n) => n.name).slice(0, 20))}`);
  for (const s of world.sessions) {
    const rows = named.filter((n) => n.role === 'AXButton' && n.name.includes(s.task));
    if (rows.length !== 1) out.push(`the sidebar should show session "${s.task}" once, as a row; it has ${rows.length}`);
  }
  if (!named.some((n) => n.name === 'Needs you')) out.push('the window has no Needs you view: no node is named "Needs you"');
  const roots = tree.windows.map((w) => w.tree);
  const tasks = world.sessions.map((s) => s.task);
  out.push(...askRowFailuresKept(roots, world.asks, want.rows, tasks));
  const px = listEdgePx(roots, tasks, win.frame, picture.width);
  if (px === null) out.push(`can't find the list on the pixels: no session row ${JSON.stringify(tasks)} is on the tree`);
  else {
    const region = [0, 0, Math.min(Math.ceil(px), picture.width), picture.height];
    const listed = await ocrIn(picture, 'accurate', region);
    const gone = unreadable(listed, blankIn(picture, region), `the list's region (${JSON.stringify(region)})`);
    if (gone) out.push(gone);
    else out.push(...rowLineFailures(listed, world.asks, px, { open: want.rows.length, kept: world.asks.length - want.rows.length }));
  }
  const counted = lines.flatMap((l) => [...l.text.matchAll(/\b(\d+)\s+asks?\s+needs?\s+you\b/gi)]).map((m) => Number(m[1]));
  for (const n of counted) if (n !== want.count) out.push(`the window's count reads ${n}, not ${want.count}`);
  const menu = menuCount(tree);
  if (menu !== want.count) out.push(`the menu bar reads ${JSON.stringify(tree.menu)}, not ${want.count}`);
  return out;
}

/** The failures, unless every one is `UNREADABLE`: then the run is INCONCLUSIVE with their reasons, never PASS. */
export function unlessUnreadable(failures: readonly string[]): readonly string[] {
  if (failures.length && failures.every((f) => f.startsWith(UNREADABLE))) inconclusive(failures.join('; '));
  return failures;
}

// ---- A row whose ellipsis OCR dropped, and builds before the timed checks (REDRAFT.md, Eleventh redraft). Added beside
// the judges above, which stay as they were.

const leftOf = (l: Line, edgePx: number | null): boolean => edgePx === null || (l.box[0] ?? 0) + (l.box[2] ?? 0) / 2 < edgePx;
const slotsAfterEllipsis = (text: string): string | null => {
  const m = [...text.matchAll(/…|\.{2,}/g)].at(-1);
  return m ? squash(text.slice(m.index! + m[0].length)) || null : null;
};

/** The lines whose box ends left of `edgePx`: a whole-window reading's list lines, never a list line OCR merged with the page's. */
export const listLines = (lines: readonly Line[], edgePx: number): Line[] => lines.filter((l) => (l.box[0] ?? 0) + (l.box[2] ?? 0) <= edgePx);

/**
 * One OCR reading of the list: its open rows (`askRowLine`, not reading answered), its rows reading answered, and its bare
 * lines, which read exactly an open row's right slots (kind and time) with no ellipsis before them: the row a right program
 * drew whose small ellipsis glyph OCR dropped (R7t ac1-3), or a row drawn with no title and no ellipsis. A bare line alone
 * never counts as a row; it only says a count short by it can't be decided.
 */
export function rowReading(lines: readonly Line[], asks: readonly Ask[], edgePx: number | null): { open: Line[]; kept: Line[]; bare: Line[] } {
  const rows = askRowLines(lines, asks, edgePx);
  const open = rows.filter((l) => !ANSWERED_WORD.test(l.text));
  const slots = new Set(open.map((l) => slotsAfterEllipsis(l.text)).filter((s) => s !== null));
  const bare = lines.filter((l) => leftOf(l, edgePx) && !rows.includes(l) && slots.has(squash(l.text.replace(/^\s*\S\s+/, ''))));
  return { open, kept: rows.filter((l) => ANSWERED_WORD.test(l.text)), bare };
}

/**
 * `rowLineFailures` over several readings of the same capture (`.accurate` of the list's region and of the whole window).
 * A row OCR read with its ellipsis is drawn, so the count is the greatest number of open rows any reading holds. More
 * than `open` in any reading, or more rows and bare lines together, fails; so does more than `kept` answered rows. Fewer
 * fails, unless some reading's bare lines make up the shortfall exactly: then whether those lines lost their ellipsis to
 * OCR or were drawn without one can't be told, and the result is `UNREADABLE` (INCONCLUSIVE), never a pass.
 */
export function rowReadingsFailures(readings: readonly (readonly Line[])[], asks: readonly Ask[], edgePx: number | null, want: { open: number; kept: number }): string[] {
  const read = (readings.length ? readings : [[]]).map((lines) => ({ lines, ...rowReading(lines, asks, edgePx) }));
  const best = read.reduce((a, b) => (b.open.length > a.open.length ? b : a));
  const most = read.reduce((a, b) => (b.open.length + b.bare.length > a.open.length + a.bare.length ? b : a));
  const kept = read.reduce((a, b) => (b.kept.length > a.kept.length ? b : a));
  const out: string[] = [];
  if (best.open.length > want.open) out.push(`the list's pixels draw ${best.open.length} open ask row(s), not ${want.open}: of its lines, these draw a row ${sees(best.open)}; all read ${sees(best.lines)}`);
  else if (most.open.length + most.bare.length > want.open) out.push(`the list's pixels draw ${most.open.length + most.bare.length} open ask row(s), not ${want.open}, ${most.bare.length} of them with no ellipsis: ${sees([...most.open, ...most.bare])}; all read ${sees(most.lines)}`);
  else if (best.open.length < want.open) {
    const short = read.find((r) => r.open.length + r.bare.length === want.open);
    if (short) out.push(`${UNREADABLE}the list's pixels draw at most ${best.open.length} open ask row(s) with their ellipsis, not ${want.open}; one reading adds ${short.bare.length} line(s) reading only a row's kind and time ${sees(short.bare)}, and whether OCR dropped their ellipsis or the row was drawn without one can't be told; all read ${sees(short.lines)}`);
    else out.push(`the list's pixels draw ${best.open.length} open ask row(s), not ${want.open}: of its lines, these draw a row ${sees(best.open)}; all read ${sees(best.lines)}`);
  }
  if (kept.kept.length > want.kept) out.push(`the list's pixels draw ${kept.kept.length} answered ask row(s), more than ${want.kept}: ${sees(kept.kept)}`);
  return out;
}

/**
 * `shellFailuresRead`, with the list's rows counted by `rowReadingsFailures` over the list region's `.accurate` reading and
 * the whole window's `.accurate` reading (only its lines ending left of the list's edge, `listLines`), each where it read
 * a line left of the list's edge. R7t ac1-3: the region read
 * dropped one row's ellipsis that the whole read kept. No such reading of a region that isn't blank is `UNREADABLE`.
 * Everything else is `shellFailuresRead`'s own.
 */
export async function shellFailuresBest(world: World, app: App, want: { rows: readonly Ask[]; count: number }): Promise<string[]> {
  const out: string[] = [];
  const tree = await app.tree();
  const main = tree.windows.flatMap((w) => nodes(w.tree));
  const named = main.filter((n) => n.name);
  const win = await app.mainWindow();
  const picture = await app.capture(`shell-${want.count}`, win);
  const whole = [0, 0, picture.width, picture.height];
  const accurate = await ocr(picture);
  const lines = accurate.length ? accurate : await ocrIn(picture, 'fast', whole);
  const lost = unreadable(lines, blankIn(picture, whole), 'the whole window');
  if (lost) out.push(lost);
  const spike = [...named.map((n) => n.name), ...lines.map((l) => l.text)].find((text) => /\bSession \d{4}\b|waiting on you/.test(text));
  if (spike) out.push(`the window is the spike window: it draws "${spike}"`);
  if (!named.some((n) => n.name === 'Tasks')) out.push(`the window has no registered sidebar: no node is named "Tasks"; its names are ${JSON.stringify(named.map((n) => n.name).slice(0, 20))}`);
  for (const s of world.sessions) {
    const rows = named.filter((n) => n.role === 'AXButton' && n.name.includes(s.task));
    if (rows.length !== 1) out.push(`the sidebar should show session "${s.task}" once, as a row; it has ${rows.length}`);
  }
  if (!named.some((n) => n.name === 'Needs you')) out.push('the window has no Needs you view: no node is named "Needs you"');
  const roots = tree.windows.map((w) => w.tree);
  const tasks = world.sessions.map((s) => s.task);
  out.push(...askRowFailuresKept(roots, world.asks, want.rows, tasks));
  const px = listEdgePx(roots, tasks, win.frame, picture.width);
  if (px === null) out.push(`can't find the list on the pixels: no session row ${JSON.stringify(tasks)} is on the tree`);
  else {
    const region = [0, 0, Math.min(Math.ceil(px), picture.width), picture.height];
    const readings = [await ocrIn(picture, 'accurate', region), listLines(accurate, px)].filter((r) => r.some((l) => leftOf(l, px)));
    const gone = readings.length ? null : unreadable([], blankIn(picture, region), `the list's region (${JSON.stringify(region)}), by either reading`);
    if (gone) out.push(gone);
    else out.push(...rowReadingsFailures(readings, world.asks, px, { open: want.rows.length, kept: world.asks.length - want.rows.length }));
  }
  const counted = lines.flatMap((l) => [...l.text.matchAll(/\b(\d+)\s+asks?\s+needs?\s+you\b/gi)]).map((m) => Number(m[1]));
  for (const n of counted) if (n !== want.count) out.push(`the window's count reads ${n}, not ${want.count}`);
  const menu = menuCount(tree);
  if (menu !== want.count) out.push(`the menu bar reads ${JSON.stringify(tree.menu)}, not ${want.count}`);
  return out;
}

/** How long a fresh checkout's builds may take before any timed check: R7 and R7t's first builds took 12 to 18 min at load 60. */
export const BUILD_MS = 45 * 60_000;

/** `work`, or `BLOCKED` when it fails or isn't done within `ms`: nothing was judged, so it is never a FAIL or a PASS. */
export async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // deadline: only turns a build that never finishes into BLOCKED, naming it; nothing waits on it to pass
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`BLOCKED: ${what} didn't finish within ${Math.round(ms / 60_000)} min`)), ms); });
  try {
    return await Promise.race([work, late]);
  } catch (e) {
    const why = (e as Error).message;
    return blocked(`${why.startsWith('BLOCKED: ') ? why.slice('BLOCKED: '.length) : `${what} failed: ${why.slice(0, 800)}`}; it ran before any check, so nothing was judged`);
  } finally {
    clearTimeout(timer);
  }
}

/** Every binary a file's checks launch, built by `within`: the probe first, and only once it is built and permitted the app, `plants` and the hub's support binaries. */
export const prebuilt = (plants: readonly Plant[], ms = BUILD_MS): Promise<unknown> =>
  within((async () => {
    await probeBinary();
    await Promise.all([appBinary(), ...plants.map((p) => appBinary(p)), supportBinaries()]);
  })(), ms, 'building the probe, then the app, its plants and the support binaries');
