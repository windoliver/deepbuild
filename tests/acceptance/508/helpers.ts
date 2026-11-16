// Test-side tools for the #508 acceptance tests (README: The surface under test). They build `deep-gpu` (the GPU layer
// that draws 3D frames with the effects chain through `view3d`) and `deep-show` (the canvas core's document checks,
// evaluation and export), drive both by JSON lines, read the fixture figures the issue asks for from
// tests/fixtures/figures/, and hold the one scene this suite writes itself: a plume with haze in front of a
// checkerboard. Pure tools are reused from #424's, #449's, #157's, #380's and #468's suites. Nothing here stands in for
// an effect, a fixture, the renderer, a check or an export.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, expect } from 'vitest';
import { decode8, decodePng, type Image } from '../424/helpers.ts';
import { FLICKS, apng, sha256 } from '../449/helpers.ts';
import { readMovie, trackOf } from '../157/helpers.ts';
import { effectScene } from '../380/helpers.ts';
import { PLAIN_LOOK, judgeLimit, lane, load, median, timingProblem, type Load } from '../468/helpers.ts';

export { FLICKS, PLAIN_LOOK, apng, decodePng, effectScene, judgeLimit, lane, load, median, readMovie, sha256, timingProblem, trackOf, type Image, type Load };

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];
export type Box4 = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/508 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
export const CRITERIA = {
  1: '#508.9e5770bb', 2: '#508.4f6ed3e6', 3: '#508.c1610aa6', 4: '#508.822d5a2c', 5: '#508.745c64c0', 6: '#508.86fb5cf5',
} as const;
/** A test title's prefix: `AC<n> #508.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

/** The `deep-gpu run --planted` names this suite adds (README: Planted programs; twins.json). */
export type Planted = 'haze_feeds_check_readback' | 'effect_reads_wall_clock';

/** Every test passes this timeout: a cold build of deep-gpu or deep-show takes many minutes. */
export const TIMEOUT = 3_600_000;
const MIB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const SHA = /^[0-9a-f]{64}$/;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}${failures.length > 40 ? `\n  … and ${failures.length - 40} more` : ''}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(true);
  }
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test whose surface or input isn't there fails with this, never passes. */
export function blocked(reason: string): never {
  return expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** The pixels are drawn on macOS's Metal device: INCONCLUSIVE anywhere else. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`these pixels are drawn on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built the first time a test asks for it, once per file, and copied out of the target folder.

export type BinName = 'deep-gpu' | 'deep-gpu --release' | 'deep-show';
const BUILD: Record<BinName, { args: string[]; profile: 'debug' | 'release'; file: string }> = {
  'deep-gpu': { args: ['build', '--locked', '--bin', 'deep-gpu'], profile: 'debug', file: 'deep-gpu' },
  'deep-gpu --release': { args: ['build', '--locked', '--release', '--bin', 'deep-gpu'], profile: 'release', file: 'deep-gpu' },
  'deep-show': { args: ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'], profile: 'debug', file: 'deep-show' },
};
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const target = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
function cargo(args: string[]): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
    CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
    NO_COLOR: '1',
    PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}`,
  };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') return `BLOCKED: cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`;
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** `bin(name)` builds `name` the first time a test of the file asks, then hands back the copy; a failed build fails the test. */
export function useBins(): (name: BinName) => string {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (name: BinName): string => {
    let entry = made.get(name);
    if (!entry) {
      if (!dir) dir = mkdtempSync(join(tmpdir(), 'deep-508-bins-'));
      const b = BUILD[name];
      const error = cargo(b.args);
      const bin = join(dir, `${b.file}-${b.profile}`);
      if (error === '') copyFileSync(join(target(), b.profile, b.file), bin);
      entry = { bin, error };
      made.set(name, entry);
    }
    if (entry.error.startsWith('BLOCKED:')) expect.fail(`${entry.error}; this is not a pass`);
    expect(entry.error, `${name} builds: cargo ${BUILD[name].args.join(' ')}`).toBe('');
    return entry.bin;
  };
}
/** A fresh temporary folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-508-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** Writes JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The fixture figures (README: Surfaces this job invents, 1): documents kept as fixtures, as #239's films are.

export const FIGURES = join(REPO, 'tests', 'fixtures', 'figures');
export type FixtureName = 'turbofan' | 'image-layers' | 'effect-wave-field' | 'effect-plume' | 'effect-arc' | 'effect-airflow';
/** The four explainer effects criterion 6 names, each with its fixture. */
export const EXPLAINERS = ['wave_field', 'plume', 'arc', 'airflow'] as const;
export type Explainer = (typeof EXPLAINERS)[number];
export const EFFECT_FIXTURE: Record<Explainer, FixtureName> = {
  wave_field: 'effect-wave-field', plume: 'effect-plume', arc: 'effect-arc', airflow: 'effect-airflow',
};
/** The two explainer fixtures' controls (README: Surfaces this job invents, 2). */
export const THROTTLE = 'throttle';
export const SPREAD = 'spread';
/** The image-layer explainer's five keyed shots, in the issue's order. */
export const LAYER_SHOTS = ['split', 'parallax', 'swap_subject', 'recolour', 'move_title'] as const;

export interface Fixture {
  name: FixtureName; rel: string; document: JsonObject; size: [number, number];
  /** Each file of the fixture's `assets/` folder by its SHA-256: its path and bytes. */
  assets: Map<string, { path: string; bytes: Buffer }>;
}
export function fixture(name: FixtureName): Fixture {
  const dir = join(FIGURES, name);
  const path = join(dir, 'figure.json');
  const rel = relative(REPO, path);
  if (!existsSync(path)) blocked(`the fixture ${rel} isn't delivered (README: Surfaces this job invents)`);
  let parsed: JsonValue;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`${rel} is not JSON: ${(e as Error).message}`); }
  const document = obj(parsed, rel);
  const assets = new Map<string, { path: string; bytes: Buffer }>();
  const adir = join(dir, 'assets');
  if (existsSync(adir)) for (const f of readdirSync(adir)) { const p = join(adir, f); const bytes = readFileSync(p); assets.set(sha256(bytes), { path: p, bytes }); }
  const size = arr(document['size'], `${rel}: size`).map((v, i) => num(v, `${rel}: size[${i}]`)) as [number, number];
  return { name, rel, document, size, assets };
}
/** The fixture's assets as `view3d`'s `assets` field: SHA-256 to path. */
export const assetPaths = (f: Fixture): Record<string, string> => Object.fromEntries([...f.assets].map(([h, a]) => [h, a.path]));
/** The look a fixture names (`look.asset`, an asset of its own), or the plain look when it names none. */
export function lookOf(f: Fixture): JsonObject {
  const ref = isObject(f.document['look']) ? f.document['look']['asset'] : undefined;
  const named = isObject(f.document['assets']) ? f.document['assets'] : {};
  if (typeof ref !== 'string') return PLAIN_LOOK;
  const entry = named[ref.replace(/@\d+$/, '')];
  const hash = isObject(entry) ? entry['sha256'] : undefined;
  const asset = typeof hash === 'string' ? f.assets.get(hash) : undefined;
  if (!asset) return PLAIN_LOOK;
  try { return obj(JSON.parse(asset.bytes.toString('utf8')) as JsonValue, `${f.rel}: its look`); } catch { return PLAIN_LOOK; }
}
/** The document's span in seconds (`transport.span`, written `<s>s`). */
export function spanOf(document: JsonObject, what: string): number {
  const span = isObject(document['transport']) ? document['transport']['span'] : undefined;
  const m = typeof span === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(span) : null;
  expect(m, `${what}: transport.span is written in seconds, got ${show(span)}`).not.toBeNull();
  return Number(m![1]);
}
/** The items of `document` that are `effect@1` of `kind`. */
export function effectItems(document: JsonObject, kind: string): [string, JsonObject][] {
  const items = isObject(document['items']) ? document['items'] : {};
  return Object.entries(items).filter((e): e is [string, JsonObject] => isObject(e[1]) && e[1]['kind'] === 'effect@1' && isObject(e[1]['params']) && e[1]['params']['kind'] === kind);
}
/** The document with the items `drop` names taken out. */
export function without(document: JsonObject, drop: readonly string[]): JsonObject {
  const out = clone(document);
  const items = obj(out['items'], 'items');
  for (const id of drop) delete items[id];
  return out;
}
/** A document as a session holds it for `view3d` (#378): one writer layer `main` holding every item. */
export function asSession(document: JsonObject): JsonObject {
  const d = clone(document);
  d['layers'] = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
  for (const v of Object.values(obj(d['items'], 'items'))) if (isObject(v)) v['layer'] = 'main';
  return d;
}
/** A document as a writer sends it to deep-show: no `layers` and no item `layer`, which the hub stamps. */
export function strip(document: JsonObject): JsonObject {
  const out = clone(document);
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) if (isObject(item)) delete item['layer'];
  return out;
}
/** Seconds to whole flicks. */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** An input track entry (Input track: `{t: flick, seq, control, value, writer}`, #417's form). */
export const entry = (seconds: number, control: string, value: JsonValue): JsonObject => ({ t: fl(seconds), seq: 0, control, value, writer: 'you', player: 1 });
/** A control's top value: the end of its `range`, or 1. */
export function topOf(document: JsonObject, control: string, what: string): number {
  const controls = obj(document['controls'], `${what}: controls`);
  const c = obj(controls[control], `${what}: controls.${control}`);
  const range = c['range'];
  return Array.isArray(range) && typeof range[1] === 'number' ? range[1] : 1;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario line `{out, calls}` in, one answer line out (#377).

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const what = `deep-gpu ${args.join(' ')}`;
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  expect(timedOut, `${what} finished within its timeout`).toBe(false);
  if (run.error) throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what} refused the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return replies;
}

/** A `view3d` call (#378) with the fields this suite reads (README: The surface under test). */
export interface View3 {
  doc: string; look: JsonObject; size: [number, number]; fps?: number; from?: number; frames?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'ids' | 'checks')[]; assets?: Record<string, string>;
  timings?: boolean; footprints?: boolean; track?: JsonObject[];
}
export const view3d = (c: View3): JsonObject => ({ call: 'view3d', frames: 1, fps: 30, ...(c as unknown as JsonObject) });

export interface Frame {
  frame: number; pixelHash: string | null; final: string | null; ids: string | null;
  /** Each check readback target's file (Surfaces this job invents, 6). */
  checks: Record<string, string> | null;
  /** Each effect item's screen footprint, [x0, y0, x1, y1] px (Surfaces this job invents, 5). */
  footprints: Record<string, Box4> | null;
  raw: JsonObject;
}
export interface Drawn { frames: Frame[]; passes: { name: string; operator: string | null }[]; raw: JsonObject }
/** A reply that drew frames: INCONCLUSIVE where the platform can't draw, a failure naming the refusal otherwise. */
export function drawnOf(reply: JsonObject, what: string): Drawn {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was drawn, not refused: ${show(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    const s = (x: JsonValue | undefined): string | null => (typeof x === 'string' ? x : null);
    let checks: Record<string, string> | null = null;
    if (f['checks'] !== undefined) checks = Object.fromEntries(Object.entries(obj(f['checks'], `${at}.checks`)).map(([k, h]) => [k, str(h, `${at}.checks.${k}`)]));
    let footprints: Record<string, Box4> | null = null;
    if (f['footprints'] !== undefined) {
      footprints = Object.fromEntries(Object.entries(obj(f['footprints'], `${at}.footprints`)).map(([k, b]) => {
        const box = arr(obj(b, `${at}.footprints.${k}`)['box'], `${at}.footprints.${k}.box`).map((x) => num(x, `${at}.footprints.${k}.box`));
        expect(box.length, `${at}.footprints.${k}.box is [x0, y0, x1, y1]`).toBe(4);
        return [k, box as Box4];
      }));
    }
    return { frame: num(f['frame'], `${at}.frame`), pixelHash: s(f['pixel_hash']), final: s(f['final']), ids: s(f['ids']), checks, footprints, raw: f };
  });
  const passes = (Array.isArray(reply['passes']) ? reply['passes'] : []).filter(isObject).map((p) => ({ name: String(p['name']), operator: typeof p['operator'] === 'string' ? p['operator'] : null }));
  return { frames, passes, raw: reply };
}
export function frameAt(d: Drawn, n: number, what: string): Frame {
  const f = d.frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${d.frames.map((x) => x.frame).slice(0, 12).join(', ')}…)`).toBeDefined();
  return f!;
}
/** A file the binary wrote, named by its SHA-256. */
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
export const px = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
export const codeOff = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
/** A per-frame timing keyed by a pass (`passes_ms` or `declared_ms`), or null where the frame has none. */
export function keyedMs(f: Frame, field: 'passes_ms' | 'declared_ms', key: string): number | null {
  const m = f.raw[field];
  if (!isObject(m)) return null;
  const v = m[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
export const msOf = (frames: Frame[], field: 'gpu_ms' | 'wall_ms', what: string): number[] => frames.map((f) => num(f.raw[field], `${what}: frame ${f.frame}'s ${field}`));

// ---------------------------------------------------------------------------------------------------
// The plume with haze in front of a checkerboard (criterion 3 and the taste call)

/**
 * 640 × 360, an orthographic camera at (0, 0, 10) looking down −Z, 6.4 m across (100 px a metre). The board: 16 × 9
 * unlit tiles 0.4 m square at z = 0, so every tile is 40 px square on whole pixels, in `A` and `B`. A small dark nozzle
 * at (−2, 0, 0.6) in front of it; the plume rides from it along +X: `effect@1` kind plume, its params as the issue's
 * Fields name them, with `haze {strength: 4, scale: 0.5}` (px, m). Variants: with the haze, without it (the plume
 * drawn without haze), and the board with no plume at all.
 */
export const HAZE = {
  size: [640, 360] as [number, number], viewWidth: 6.4, tile: 0.4, cols: 16, rows: 9, fps: 30, last: 90, still: 45,
  A: [40, 60, 160] as Rgb, B: [230, 225, 210] as Rgb, nozzle: [-2, 0, 0.6] as [number, number, number], nozzlePx: [120, 180] as [number, number],
  strength: 4, scale: 0.5, reach: 5,
} as const;
const linearOf = (c: Rgb): number[] => c.map(decode8);
export function hazeDoc(variant: 'haze' | 'no_haze' | 'board'): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 0, 10], target: [0, 0, 0], view_width: HAZE.viewWidth, near: 0.05, far: 100 } },
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    'tile-a': { kind: 'material@1', params: { base_color: [...linearOf(HAZE.A), 1], unlit: true, double_sided: true } },
    'tile-b': { kind: 'material@1', params: { base_color: [...linearOf(HAZE.B), 1], unlit: true, double_sided: true } },
    'nozzle-mat': { kind: 'material@1', params: { base_color: [0.02, 0.02, 0.02, 1], unlit: true, double_sided: true } },
    nozzle: { kind: 'mark.box@1', params: { size: [0.16, 0.16, 0.16] }, at: { pos: [...HAZE.nozzle] }, material: 'nozzle-mat' },
  };
  for (let i = 0; i < HAZE.cols; i++) {
    for (let j = 0; j < HAZE.rows; j++) {
      const x = -HAZE.viewWidth / 2 + HAZE.tile * (i + 0.5);
      const y = -1.8 + HAZE.tile * (j + 0.5);
      items[`tile-${i}-${j}`] = { kind: 'mark.box@1', params: { size: [HAZE.tile, HAZE.tile, 0.02] }, at: { pos: [x, y, 0] }, material: (i + j) % 2 ? 'tile-b' : 'tile-a' };
    }
  }
  if (variant !== 'board') {
    const plume: JsonObject = { radius: 0.35, reach: 2.8, heat: 0.7, shock_cells: 4, turbulence: 0.4, seed: 7 };
    if (variant === 'haze') plume['haze'] = { strength: HAZE.strength, scale: HAZE.scale };
    items['plume'] = { kind: 'effect@1', params: { kind: 'plume', anchor: 'nozzle', axis: [1, 0, 0], plume } };
  }
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `plume-haze-${variant}`, profile: 'scene', title: 'A plume with haze in front of a checkerboard',
    description: 'A plume with haze in front of a checkerboard: an acceptance fixture for explainer effects.',
    size: [...HAZE.size], camera: 'cam', seed: 508, transport: { span: '4s' },
    requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, items: withIds,
  };
}
/** The calls of one haze run: the plume with haze played, without haze, the board alone, and two cold seeks. */
export function hazeCalls(out: string): JsonObject[] {
  const doc = (v: 'haze' | 'no_haze' | 'board'): string => writeJson(out, `plume-${v}`, hazeDoc(v));
  const played = (v: 'haze' | 'no_haze' | 'board'): JsonObject => view3d({
    doc: doc(v), look: PLAIN_LOOK, size: HAZE.size, fps: HAZE.fps, frames: HAZE.last + 1, capture: [0, HAZE.still, HAZE.last],
    targets: ['final', 'ids', 'checks'], footprints: true,
  });
  const seek = (n: number): JsonObject => view3d({ doc: doc('haze'), look: PLAIN_LOOK, size: HAZE.size, fps: HAZE.fps, from: n, frames: 1 });
  return [played('haze'), played('no_haze'), played('board'), seek(HAZE.still), seek(HAZE.last)];
}
const inBox = (b: Box4, x: number, y: number): boolean => x + 0.5 >= b[0] && x + 0.5 <= b[2] && y + 0.5 >= b[1] && y + 0.5 <= b[3];
/**
 * Every way the haze run misses criterion 3, one sentence each; a failure about a check's readback names the effect
 * whose footprint holds the pixels that differ.
 */
export function hazeFailures(out: string, replies: JsonObject[]): string[] {
  const [hazed, plain, board, seekStill, seekLast] = [
    drawnOf(replies[0]!, 'the plume with haze'), drawnOf(replies[1]!, 'the plume without haze'), drawnOf(replies[2]!, 'the board alone'),
    drawnOf(replies[3]!, `a cold seek to frame ${HAZE.still}`), drawnOf(replies[4]!, `a cold seek to frame ${HAZE.last}`),
  ];
  const failures: string[] = [];
  const [w, h] = HAZE.size;
  const isBoard = (c: Rgb): Rgb | null => (codeOff(c, HAZE.A) <= 1 ? HAZE.A : codeOff(c, HAZE.B) <= 1 ? HAZE.B : null);
  for (const n of [0, HAZE.still, HAZE.last]) {
    const at = `frame ${n} (${(n / HAZE.fps).toFixed(1)} s)`;
    const fh = frameAt(hazed, n, 'the plume with haze'); const fp = frameAt(plain, n, 'the plume without haze'); const fb = frameAt(board, n, 'the board alone');
    const H = decodePng(readNamed(out, fh.final, 'png', `${at}: the final target with haze`));
    const P = decodePng(readNamed(out, fp.final, 'png', `${at}: the final target without haze`));
    const B = decodePng(readNamed(out, fb.final, 'png', `${at}: the board alone`));
    const box = fh.footprints?.['plume'];
    if (!box) { failures.push(`${at}: the frame reports no footprint for the effect plume: ${show(fh.raw['footprints'] ?? null)}`); continue; }
    const area = Math.max(0, Math.min(box[2], w) - Math.max(box[0], 0)) * Math.max(0, Math.min(box[3], h) - Math.max(box[1], 0));
    if (!inBox(box, HAZE.nozzlePx[0], HAZE.nozzlePx[1])) failures.push(`${at}: the plume's footprint ${show(box)} doesn't hold its nozzle at ${show(HAZE.nozzlePx)} px`);
    if (area >= 0.5 * w * h) failures.push(`${at}: the plume's footprint ${show(box)} covers ${((100 * area) / (w * h)).toFixed(0)}% of the frame, not the plume's own part of it`);
    let outside = 0; let first = '';
    let bent = 0;
    const moved: string[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = px(H, x, y); const cp = px(P, x, y);
        if (!inBox(box, x, y)) {
          if (codeOff(ch, cp) !== 0) { outside++; if (!first) first = `(${x}, ${y}) reads ${show(ch)} with haze, ${show(cp)} without`; }
          continue;
        }
        const tile = isBoard(ch);
        if (tile && isBoard(cp) && codeOff(ch, cp) > 1) bent++;
        if (!tile) continue;
        let near = false;
        for (let dy = -5; dy <= 5 && !near; dy++) {
          for (let dx = -5; dx <= 5 && !near; dx++) {
            const xx = x + dx; const yy = y + dy;
            if (dx * dx + dy * dy > 25 || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            if (codeOff(px(B, xx, yy), tile) <= 1) near = true;
          }
        }
        if (!near) moved.push(`(${x}, ${y})`);
      }
    }
    if (outside) failures.push(`${at}: ${outside} pixels outside the plume's footprint ${show(box)} differ from the frame drawn without haze; first ${first}`);
    if (moved.length) failures.push(`${at}: ${moved.length} board pixels inside the footprint show a tile's color with none of that color within 5 px in the board drawn alone, so the haze moved them more than 4 px; first ${moved.slice(0, 5).join(', ')}`);
    if (bent === 0) failures.push(`${at}: the haze bends nothing: inside the footprint every board pixel reads as it does without haze`);
    if (fh.ids === null || fh.ids !== fp.ids) failures.push(`${at}: the object-ID target with haze (${String(fh.ids)}) is not the one without it (${String(fp.ids)})`);
    failures.push(...readbackFailures(out, fh, fp, at));
  }
  const sought: [number, Drawn][] = [[HAZE.still, seekStill], [HAZE.last, seekLast]];
  for (const [n, d] of sought) {
    const played = frameAt(hazed, n, 'the plume with haze').pixelHash;
    const cold = frameAt(d, n, `the seek to frame ${n}`).pixelHash;
    if (!played || played !== cold) failures.push(`plume: seeking to frame ${n} (${(n / HAZE.fps).toFixed(1)} s) draws ${String(cold)}, playing to it ${String(played)}`);
  }
  if (frameAt(hazed, HAZE.still, 'the plume with haze').pixelHash === frameAt(hazed, HAZE.last, 'the plume with haze').pixelHash) {
    failures.push(`plume: frames ${HAZE.still} and ${HAZE.last} are the same, so the plume doesn't move and a seek can't be told from a play`);
  }
  return failures;
}
/** The check readbacks of a frame with haze against those without it; a difference names the effect whose footprint holds it. */
function readbackFailures(out: string, fh: Frame, fp: Frame, at: string): string[] {
  if (!fh.checks || !fp.checks || Object.keys(fh.checks).length === 0) return [`${at}: the frame reports no check readbacks (targets: checks): ${show(fh.raw['checks'] ?? null)}`];
  const failures: string[] = [];
  const names = [...new Set([...Object.keys(fh.checks), ...Object.keys(fp.checks)])].sort();
  for (const name of names) {
    const a = fh.checks[name]; const b = fp.checks[name];
    if (a === b) continue;
    if (!a || !b) { failures.push(`${at}: the check readback ${name} is read ${a ? 'with haze only' : 'without haze only'}`); continue; }
    const A = readNamed(out, a, 'bin', `${at}: the check readback ${name} with haze`);
    const B = readNamed(out, b, 'bin', `${at}: the check readback ${name} without haze`);
    const per = A.length / (HAZE.size[0] * HAZE.size[1]);
    const differing: number[] = [];
    for (let k = 0; k < Math.min(A.length, B.length); k++) if (A[k] !== B[k]) differing.push(Math.floor(k / per));
    const pixels = [...new Set(differing)];
    const holders = Object.entries(fh.footprints ?? {}).filter(([, box]) => pixels.some((p) => inBox(box, p % HAZE.size[0], Math.floor(p / HAZE.size[0])))).map(([id]) => id);
    const first = pixels[0] === undefined ? 'its size' : `(${pixels[0] % HAZE.size[0]}, ${Math.floor(pixels[0] / HAZE.size[0])})`;
    failures.push(`${holders.length ? holders.map((id) => `effect ${id}`).join(', ') : 'no effect\'s footprint'}: ${at}: the check readback ${name} differs from the frame without haze at ${pixels.length || 'every'} pixels; first ${first}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: one scenario line in, one answer line out (#393), as an agent session shows a document.

export function runShow(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  if (r.error) throw Error(`${what}: deep-show run: ${r.error.message}`);
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: deep-show run takes the scenario: ${show(answer, 3000)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: figures', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
export const DOC = '01JB508D000000000000000001';
/** A scenario: an evidence store, the agent's session and process tree, the document's panel, the calls. */
export function scenarioOf(evidence: string, size: [number, number], calls: JsonObject[]): JsonObject {
  return {
    evidence, sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } }, processes: PROCESSES,
    panels: { main: { rect: [0, 0, size[0], size[1]] } }, docs: { [DOC]: { panel: 'main' } }, calls,
  };
}
/** The agent's `deep_show` of a whole document (#393), with its issues. */
export const showDoc = (document: JsonObject): JsonObject => ({ call: 'deep_show', session: ALPHA.id, doc: DOC, document: strip(document), include: ['issues'] });
/** Keeps `bytes` in the evidence store at `<first 2 hex>/<other 62 hex>` (deep-show's layout). */
export function putEvidence(root: string, bytes: Uint8Array): string {
  const hash = sha256(bytes);
  mkdirSync(join(root, hash.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, hash.slice(0, 2), hash.slice(2)), bytes);
  return hash;
}
/**
 * "Passes the document checks" (as #166 and #421 read it): `deep_show` presents the document, skips no item as a kind
 * the build doesn't know, and raises no error. Every way it doesn't, one sentence each.
 */
export function checkFailures(reply: JsonObject, what: string): string[] {
  const failures: string[] = [];
  if (reply['outcome'] !== 'presented') failures.push(`${what} is not presented: ${show(reply, 2000)}`);
  const notes = [...(Array.isArray(reply['notices']) ? reply['notices'] : []), ...(Array.isArray(reply['issues']) ? reply['issues'] : [])].filter(isObject);
  for (const n of notes.filter((x) => x['code'] === 'unknown_kind')) failures.push(`${what}: an item is skipped as a kind the build doesn't know: ${show(n, 400)}`);
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  for (const i of issues.filter((x) => x['severity'] === undefined || x['severity'] === 'error')) failures.push(`${what}: the document checks raise ${show(i, 600)}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The generated skill and the agents' recorded runs (criterion 1)

export const SKILL = join(REPO, 'skills', 'deepbuild-canvas', 'SKILL.md');
export const AGENT_RUNS = join(REPO, 'docs', 'evidence', '508', 'agents');
export const AGENTS = ['claude-code', 'codex'] as const;
export type Agent = (typeof AGENTS)[number];
/** The live sessions' brief: a fixture figure, the issue's test rig, from the skill alone. */
export const FIGURE_PROMPT = [
  'This session is scripted: no one will answer a question, and you have no tool that checks a document.',
  'The only documentation you have is the DeepBuild skill in ./SKILL.md. Read it, then write one DeepBuild figure document',
  'to ./figure.json: a test rig, an engine on a stand with a throttle slider that drives its exhaust plume.',
  'Write the file once. Reply DONE when it is written.',
].join('\n');
/** One agent's recorded run (README: Surfaces this job invents, 9). */
export interface AgentRun { format: string; agent: { name: string; version: string }; skill_sha256: string; context: string[]; prompt: string; document: JsonObject }
export function writeAgentRun(run: AgentRun): string {
  mkdirSync(AGENT_RUNS, { recursive: true });
  const path = join(AGENT_RUNS, `${run.agent.name}.run.json`);
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`);
  return path;
}
