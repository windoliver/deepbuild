// #1436's helpers (README: The surface under test): the two builds, the pack check, the gallery, the replica's and the
// live app's `chrome@1` runs, the fixtures the criteria draw, and the contrast the text criterion measures. The PNG
// reader is #391's and the pixel, load and judge helpers are #1434's, reused by import.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import { decodePng, type Image } from '../391/helpers.ts';
import { at, judge, load, p95, type Obj, type Rect, type Rgba } from '../1434/helpers.ts';

export { at, judge, load, p95 };
export type { Image, Obj, Rect, Rgba };

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
/** The shipped pack, chrome-fx@1, as a pack folder like `packs/fx-1.0.0`. */
export const PACK = join(REPO, 'packs', 'chrome-fx-1.0.0');

/** The 24 operators, by the issue's names, in its order. */
export const OPERATORS = [
  'halo.soft', 'halo.neon', 'halo.aura', 'pulse.breathe', 'pulse.ripple', 'pulse.radar', 'shimmer', 'sparkle',
  'edge.electric', 'edge.plasma', 'edge.flame',
  'fill.mesh', 'fill.grain', 'fill.liquid_metal', 'fill.plastic', 'fill.dither',
  'glass.frost', 'glass.fluted', 'glass.lens', 'warp.haze', 'warp.shock', 'warp.chroma', 'warp.crt',
  'text.glow',
] as const;
/** The three operators whose budget is 2 ms; every other one's is 1 ms. */
export const SLOW = ['edge.flame', 'fill.liquid_metal', 'warp.haze'];

/** Each criterion's ID (scripts/proof-change.mjs: the first 8 hex of the SHA-256 of its text, from the live issue). */
export const AC = {
  1: '#1436.5c03c03a', 2: '#1436.31e7ab56', 3: '#1436.3fbd4701', 4: '#1436.e115c07f', 5: '#1436.9efc2e16',
  6: '#1436.c015619d', 7: '#1436.46fdbc09', 8: '#1436.d68d7e2e', 9: '#1436.0791f1fa', 10: '#1436.2ff55cf0',
} as const;

export type Appearance = 'light' | 'dark';
export const APPEARANCES: Appearance[] = ['light', 'dark'];

const LIVE = (): boolean => process.env['DEEP_1436_LIVE'] === '1';
export function requireMacos(): void {
  if (process.platform !== 'darwin') expect.fail('INCONCLUSIVE: chrome-fx@1 runs on macOS only (the issue: Runs on Mac only)');
}
export function requireLive(what: string): void {
  if (!LIVE()) expect.fail(`INCONCLUSIVE: ${what} opens the app's window on this Mac's screen; run with DEEP_1436_LIVE=1 (README: Run them)`);
  requireMacos();
}
export function requirePack(): void {
  expect(existsSync(join(PACK, 'pack.json')), `the shipped pack chrome-fx@1 is at ${PACK}/pack.json`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once, copies the binary out of target/, and fails the tests that use a build
// that failed with cargo's error. Nothing builds before the shipped pack exists, since every test reads it first.

function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export const REPLICA_BUILD = ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-replica', '--features', 'chrome-fixture'];
export const APP_BUILD = ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'chrome-fixture'];

/** The build is made once before the file's tests; `bin()` fails the test with cargo's error if it didn't build. A live
 *  file's builds (the app's always) are made only with DEEP_1436_LIVE=1. */
export function useBuild(which: 'replica' | 'app', live = which === 'app'): () => string {
  let dir = '';
  let error = 'not built';
  const args = which === 'replica' ? REPLICA_BUILD : APP_BUILD;
  const name = which === 'replica' ? 'deep-replica' : 'deep-app';
  beforeAll(() => {
    if (process.platform !== 'darwin' || (live && !LIVE()) || !existsSync(join(PACK, 'pack.json'))) return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1436-bin-'));
    error = cargo(args);
    if (error === '') copyFileSync(join(REPO, 'target', which === 'replica' ? 'debug' : 'release', name), join(dir, name));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    requireMacos();
    requirePack();
    expect(error, `it builds: cargo ${args.join(' ')}`).toBe('');
    return join(dir, name);
  };
}

/** The wrong programs, each selected by `DEEP_CHROME_PLANT` in a `chrome-fixture` build only (README: Planted programs). */
export type Plant = `twin:${string}` | 'flashes_4hz' | 'drops_secondary_ink';

function run(bin: string, args: string[], plant?: Plant): ReturnType<typeof spawnSync> & { stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env['DEEP_CHROME_PLANT'];
  if (plant) env['DEEP_CHROME_PLANT'] = plant;
  return spawnSync(bin, args, { cwd: REPO, encoding: 'utf8', env, timeout: 900_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 }) as ReturnType<typeof spawnSync> & { stdout: string; stderr: string };
}
const said = (r: { status: number | null; signal: NodeJS.Signals | null; stderr: string }): string => `exit ${String(r.status)} (${r.signal ?? 'no signal'}): ${r.stderr.slice(-2000)}`;
const readJson = (path: string, what: string): Obj => {
  expect(existsSync(path), `${what} is written at ${path}`).toBe(true);
  return JSON.parse(readFileSync(path, 'utf8')) as Obj;
};

// ---------------------------------------------------------------------------------------------------
// The pack check: `deep-replica --chrome-fx-check <pack dir> --out <dir>` writes `<dir>/check.json` and exits 0 only when
// the pack passes.

export interface Param { name: string; range: [number, number]; default: number }
export interface Checked { operator: string; class: string; params: Param[]; cost_ms: number; still: boolean; fixture: string }
export interface Check { status: number | null; report: Obj; operators: Checked[]; refusals: Obj[] }

export function packCheck(bin: string, pack = PACK, plant?: Plant): Check {
  const out = mkdtempSync(join(tmpdir(), 'deep-1436-check-'));
  try {
    const r = run(bin, ['--chrome-fx-check', pack, '--out', out], plant);
    expect(r.status === 0 || r.status === 1, `deep-replica --chrome-fx-check ${pack}${plant ? ` (DEEP_CHROME_PLANT=${plant})` : ''} exits 0 or 1: ${said(r)}`).toBe(true);
    const report = readJson(join(out, 'check.json'), 'check.json');
    expect(Array.isArray(report['operators']) && Array.isArray(report['refusals']), `check.json lists operators and refusals: ${JSON.stringify(report).slice(0, 600)}`).toBe(true);
    expect(report['pass'], 'check.json\'s pass agrees with the exit status').toBe(r.status === 0);
    return { status: r.status, report, operators: report['operators'] as Checked[], refusals: report['refusals'] as Obj[] };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** The shipped pack's check, run once per file. */
export function useShipped(bin: () => string): () => Check {
  let done: Check | undefined;
  return () => {
    done ??= packCheck(bin());
    expect(done.status, `the shipped pack passes its check: ${JSON.stringify(done.refusals).slice(0, 800)}`).toBe(0);
    return done;
  };
}
export function operatorOf(check: Check, name: string): Checked {
  const found = check.operators.find((o) => o.operator === name);
  expect(found, `check.json lists ${name}`).toBeDefined();
  return found!;
}
/** The first of the issue's operators the pack puts in `cls`. */
export function firstOfClass(check: Check, cls: 'quiet' | 'expressive'): string {
  const name = OPERATORS.find((op) => check.operators.find((o) => o.operator === op)?.class === cls);
  expect(name, `the pack has a ${cls} operator: ${JSON.stringify(check.operators.map((o) => [o.operator, o.class]))}`).toBeDefined();
  return name!;
}

// ---------------------------------------------------------------------------------------------------
// The gallery: `deep-replica --chrome-fx-gallery --appearance <light|dark> --out <dir>` draws the gallery panel and writes
// `screens/gallery.png` and `gallery.json`.

export interface Tile { operator: string; class: string; cost_ms: number; still: boolean; rect: Rect }
export function gallery(bin: string, appearance: Appearance): { png: Image; bytes: Buffer; report: Obj; tiles: Tile[] } {
  const out = mkdtempSync(join(tmpdir(), 'deep-1436-gallery-'));
  try {
    const r = run(bin, ['--chrome-fx-gallery', '--appearance', appearance, '--out', out]);
    expect(r.status, `deep-replica --chrome-fx-gallery --appearance ${appearance} exits 0: ${said(r)}`).toBe(0);
    const report = readJson(join(out, 'gallery.json'), 'gallery.json');
    const bytes = readFileSync(join(out, 'screens', 'gallery.png'));
    expect(Array.isArray(report['operators']), `gallery.json lists its operators: ${JSON.stringify(report).slice(0, 600)}`).toBe(true);
    return { png: decodePng(bytes), bytes, report, tiles: report['operators'] as Tile[] };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The replica: `deep-replica --chrome <fixture> --out <dir> [--appearance a] [--reduce-motion] [--at <s>]…
// [--omit-effect <id>]… [--omit-text <id>]…` draws the fixture headless and writes its screens and `chrome.json`.

export interface DrawOpts { appearance?: Appearance; at?: number[]; reduceMotion?: boolean; omitEffect?: string[]; omitText?: string[]; plant?: Plant }
export interface Drawn { pngs: Image[]; report: Obj; refusals: Obj[] }

export function replica(bin: string, fx: Obj, opts: DrawOpts = {}): Drawn {
  const out = mkdtempSync(join(tmpdir(), 'deep-1436-replica-'));
  try {
    const file = join(out, 'fixture.json');
    writeFileSync(file, JSON.stringify(fx));
    const times = opts.at ?? [];
    const args = [
      '--chrome', file, '--out', out,
      ...(opts.appearance ? ['--appearance', opts.appearance] : []),
      ...(opts.reduceMotion ? ['--reduce-motion'] : []),
      ...times.flatMap((t) => ['--at', String(t)]),
      ...(opts.omitEffect ?? []).flatMap((id) => ['--omit-effect', id]),
      ...(opts.omitText ?? []).flatMap((id) => ['--omit-text', id]),
    ];
    const r = run(bin, args, opts.plant);
    expect(r.status, `deep-replica ${args.slice(0, 8).join(' ')}${args.length > 8 ? ' …' : ''}${opts.plant ? ` (DEEP_CHROME_PLANT=${opts.plant})` : ''} exits 0: ${said(r)}`).toBe(0);
    const report = readJson(join(out, 'chrome.json'), 'chrome.json');
    const names = times.length === 0 ? ['chrome.png'] : times.map((_, i) => `chrome-${i}.png`);
    const [w, h] = fx['window'] as [number, number];
    const scale = fx['scale'] as number;
    const pngs = names.map((n) => {
      const png = decodePng(readFileSync(join(out, 'screens', n)));
      expect([png.width, png.height], `screens/${n} is the fixture's window in device px`).toEqual([w * scale, h * scale]);
      return png;
    });
    expect(Array.isArray(report['refusals']), `chrome.json lists its refusals: ${JSON.stringify(report).slice(0, 500)}`).toBe(true);
    return { pngs, report, refusals: report['refusals'] as Obj[] };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The live app: `deep-app --chrome <fixture> [--appearance a] [--reduce-motion] (--after-first <s> | --frames <n> | …)`
// opens the app's real window on this Mac's screen and prints one report line `{"chrome": <n>, "mode", "scale", …}`.

export function live(bin: string, fx: Obj, mode: string[], opts: { reduceMotion?: boolean } = {}): Obj {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1436-live-'));
  try {
    const file = join(dir, 'fixture.json');
    writeFileSync(file, JSON.stringify(fx));
    const args = ['--chrome', file, ...(opts.reduceMotion ? ['--reduce-motion'] : []), ...mode];
    const r = run(bin, args);
    expect(r.status, `deep-app ${args.join(' ')} exits 0: ${said(r)}`).toBe(0);
    const report = r.stdout.split('\n').reverse().map((l) => { try { return JSON.parse(l) as unknown; } catch { return null; } })
      .find((v): v is Obj => typeof v === 'object' && v !== null && typeof (v as Obj)['chrome'] === 'number' && typeof (v as Obj)['mode'] === 'string');
    expect(report, `deep-app prints its report line: ${r.stdout.slice(-800)}`).toBeDefined();
    return report!;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// Fixtures (README: The fixtures). Points, window coordinates; colors may name a chrome role of the window's look.

export const SEED = 1436;
const COLS = 6;
const TILE: [number, number] = [150, 140];
const GAP = 10;
export const tileRect = (i: number): Rect => [GAP + (i % COLS) * (TILE[0] + GAP), GAP + Math.floor(i / COLS) * (TILE[1] + GAP), TILE[0], TILE[1]];
/** The text line inside tile i, near its foot. */
export const textRect = (i: number): Rect => { const [x, y, w, h] = tileRect(i); return [x + 12, y + h - 34, w - 24, 18]; };
export const tileId = (op: string): string => `fx-${op}`;
export const textId = (op: string): string => `text-${op}`;

/** Every operator at once: a 6 × 4 grid of tiles on the ground, each its operator's effect under a line of secondary ink. */
export function grid(): Obj {
  return {
    format: 'chrome@1',
    window: [COLS * (TILE[0] + GAP) + GAP, 4 * (TILE[1] + GAP) + GAP],
    scale: 1,
    background: 'ground',
    nodes: OPERATORS.map((op, i) => ({
      id: tileId(op),
      rect: tileRect(i),
      radius: 12,
      backdrop: { scale: 1 },
      effect: { operator: op, params: {}, place: 'under', seed: SEED },
      children: [{ id: textId(op), rect: textRect(i), text: { content: 'Sixty sampled frames', size: 13, color: 'ink_secondary' } }],
    })),
  };
}

/** One operator over 960,000 px at scale 2 (600 × 400 pt), at its defaults. */
export function budget(op: string): Obj {
  return {
    format: 'chrome@1',
    window: [640, 440],
    scale: 2,
    background: 'ground',
    nodes: [{ id: 'measured', rect: [20, 20, 600, 400], backdrop: { scale: 1 }, effect: { operator: op, params: {}, place: 'under', seed: SEED } }],
  };
}

/** The fixture with every effect, and the backdrop each read, taken out: the frame the merge base draws. */
export function withoutEffects(fx: Obj): Obj {
  const copy = structuredClone(fx);
  const walk = (nodes: Obj[]): void => { for (const n of nodes) { delete n['effect']; delete n['backdrop']; walk((n['children'] as Obj[] | undefined) ?? []); } };
  walk(copy['nodes'] as Obj[]);
  return copy;
}

export interface Card { id: string; rect: Rect }
export const FLAME: Rect = [380, 280, 200, 80];
export const CARDS: Card[] = [{ id: 'card-above', rect: [280, 200, 400, 40] }, { id: 'card-below', rect: [280, 400, 400, 40] }];
/** `edge.flame` with its embers on a node in the middle, and the cards given above and below it. */
export function embers(cards: Card[]): Obj {
  return {
    format: 'chrome@1',
    window: [960, 640],
    scale: 1,
    background: 'ground',
    nodes: [
      { id: 'flame', rect: FLAME, radius: 12, fill: 'raised', effect: { operator: 'edge.flame', params: {}, place: 'over', seed: SEED } },
      ...cards.map((c) => ({ id: c.id, rect: c.rect, radius: 12, fill: 'raised' })),
    ],
  };
}

export const READING = 'reading:tokens#s-1436';
export const AS_OF = 1_793_000_000_000;
export const HALO: Rect = [100, 80, 280, 160];
/** `halo.soft` around a raised card, its params bound by `bind`, over a record holding one token-rate reading. */
export function halo(bind: Obj, value?: number): Obj {
  return {
    format: 'chrome@1',
    window: [480, 320],
    scale: 1,
    background: 'ground',
    now: AS_OF + 1_000,
    record: value === undefined ? [] : [{ id: 'ev-1436-1', kind: 'reading.recorded', data: { reading: READING, value, as_of: AS_OF } }],
    nodes: [{
      id: 'halo', rect: HALO, effect: { operator: 'halo.soft', params: {}, place: 'under', seed: SEED, bind },
      children: [{ id: 'card', rect: [140, 120, 200, 80], radius: 12, fill: 'raised' }],
    }],
  };
}

const row = (i: number): Rect => [20 + i * 220, 20, 200, 160];
/** A working view (the session page) with an expressive effect nobody asked for, one a look asked for, one a panel asked
 *  for, and a quiet one. */
export function inView(expressive: string, quiet: string): Obj {
  const effect = (operator: string, asked?: Obj): Obj => ({ operator, params: {}, place: 'under', seed: SEED, ...(asked ? { asked } : {}) });
  return {
    format: 'chrome@1', window: [900, 200], scale: 1, background: 'ground', view: 'session',
    nodes: [
      { id: 'unasked', rect: row(0), radius: 12, effect: effect(expressive) },
      { id: 'by-look', rect: row(1), radius: 12, effect: effect(expressive, { by: 'look', name: 'neon-1436' }) },
      { id: 'by-panel', rect: row(2), radius: 12, effect: effect(expressive, { by: 'panel', name: 'chrome-fx-gallery' }) },
      { id: 'quiet', rect: row(3), radius: 12, effect: effect(quiet) },
    ],
  };
}
export const FIXED_ROLES = ['status_mark', 'card', 'prompt'] as const;
/** A quiet effect set on each fixed role, and one on the raised ground. */
export function onRoles(quiet: string): Obj {
  return {
    format: 'chrome@1', window: [900, 200], scale: 1, background: 'ground',
    nodes: [...FIXED_ROLES, 'raised'].map((role, i) => ({ id: `on-${role}`, rect: row(i), radius: 12, effect: { operator: quiet, params: {}, place: 'under', seed: SEED, on: role } })),
  };
}

// ---------------------------------------------------------------------------------------------------
// Pixels and contrast

/** Device-px rect of a point rect. */
export const device = ([x, y, w, h]: Rect, scale: number): Rect => [x * scale, y * scale, w * scale, h * scale];
export function region(img: Image, [x0, y0, w, h]: Rect): Buffer {
  const rows: Buffer[] = [];
  for (let y = y0; y < y0 + h; y++) rows.push(Buffer.from(img.rgba.subarray((y * img.width + x0) * 4, (y * img.width + x0 + w) * 4)));
  return Buffer.concat(rows);
}
export function flat(img: Image, rect: Rect): boolean {
  const px = region(img, rect);
  for (let i = 4; i < px.length; i += 4) if (px[i] !== px[0] || px[i + 1] !== px[1] || px[i + 2] !== px[2]) return false;
  return true;
}

/** A chrome role of the clean look, the look the app's chrome draws from (#882), as 8-bit RGBA. */
export function role(name: string, appearance: Appearance): Rgba {
  const look = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as {
    palette: Record<string, string>; roles: Record<string, string>; themes: Record<string, { roles?: Record<string, string> }>;
  };
  const named = (appearance === 'dark' ? look.themes['dark']?.roles?.[name] : undefined) ?? look.roles[name];
  const hex = named === undefined ? undefined : (look.palette[named] ?? named);
  expect(hex, `the clean look gives ${name} in ${appearance}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
  const v = (i: number): number => parseInt(hex!.slice(1 + 2 * i, 3 + 2 * i), 16);
  return [v(0), v(1), v(2), hex!.length === 9 ? v(3) : 255];
}
/** Each ink tier's contrast floor (#882, `deep-canvas-marks/src/look.rs`'s INK_TIERS). */
export const FLOOR = { ink_secondary: 4.5 } as const;

const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (c: number[]): number => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
/** WCAG 2.x contrast of the ink, composited over the pixel as look.rs's guard does (rounded to 8 bits), against it. */
export function inkContrast(ink: Rgba, under: Rgba): number {
  const a = ink[3] / 255;
  const over = [0, 1, 2].map((i) => Math.round(ink[i]! * a + under[i]! * (1 - a)));
  const x = luminance(over); const y = luminance(under);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** The lowest contrast of the ink over any pixel of `rect` (device px). */
export function lowest(img: Image, rect: Rect, ink: Rgba): number {
  let min = Infinity;
  for (let y = rect[1]; y < rect[1] + rect[3]; y++) for (let x = rect[0]; x < rect[0] + rect[2]; x++) min = Math.min(min, inkContrast(ink, at(img, x, y)));
  return min;
}
