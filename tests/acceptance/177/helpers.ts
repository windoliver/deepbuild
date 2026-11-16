// #177's helpers (README: The surface under test): the two builds, `deep-gpu run`'s calls with the stub display, the
// live app's `--hdr` scenario, the documents and the look these tests draw, the read-backs (the HDR surface's linear
// values, the window as composited, the ID target), this suite's f64 reference of the roll-off (README: The roll-off,
// after the Oracle page's formula) and the reference-Mac judge. #424's documents and PNG reader and #1903's envelope
// parser, seeded times and reference-Mac check are reused by import.
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import {
  DARK_SKY, PLAIN_LOOK, box, camera, decodePng, material, ortho, readNamed, sessionDoc, sun, unlit,
  type Image, type JsonObject, type JsonValue, type Rgb,
} from '../424/helpers.ts';

export type { Image, JsonObject, JsonValue, Rgb };
export { DARK_SKY, decodePng, encodeRgbaPng, ortho, sessionDoc } from '../424/helpers.ts';
export { LOOK as ENVELOPE_LOOK, envelopeOf, fixtureRow, offReference, p95, seededTimes } from '../1903/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const TIMEOUT = 3_600_000;

/** The criteria's IDs (scripts/proof-change.mjs `criterionId`, computed again from the issue's text). */
export const AC = {
  1: 'AC1 #177.b891d426',
  2: 'AC2 #177.d09c9a85',
  3: 'AC3 #177.ab6f72b4',
  4: 'AC4 #177.7ae0f098',
  5: 'AC5 #177.3a1b9bb2',
  6: 'AC6 #177.707c9022',
  7: 'AC7 #177.c861c4c9',
} as const;

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the views draw on macOS's Metal device; this is ${process.platform}`);
}
export const LIVE = 'DEEP_177_LIVE';
/** The live files open the app's window on this Mac's screen; without DEEP_177_LIVE=1 they read INCONCLUSIVE. */
export function requireLive(what: string): void {
  if (process.env[LIVE] !== '1') inconclusive(`${what} opens the app's window on this Mac's XDR display; run with ${LIVE}=1 (README: Run them)`);
  requireMetal();
}
/** The reference Macs with an XDR display, and its size in device px (technical design: The reference Macs). */
export const XDR_MACS: Record<string, [number, number]> = { 'Mac15,7': [3456, 2234], 'Mac17,10': [3472, 2266] };
export function hwModel(): string | null {
  try { return execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once, copies the binary out of target/, and fails the tests that use a build
// that failed with cargo's error.

export const GPU_BUILD = ['build', '--locked', '--bin', 'deep-gpu', '--features', 'test-meter'];
export const APP_BUILD = ['build', '--locked', '--release', '-p', 'deep-app', '--bin', 'deep-app', '--features', 'hdr-fixture'];

function cargo(args: string[]): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** `gpu` (deep-gpu, debug, test-meter) or `app` (deep-app, release, hdr-fixture). A live file's builds (the app's
 *  always) are made only with DEEP_177_LIVE=1, since its tests read INCONCLUSIVE without it. */
export function useBuild(which: 'gpu' | 'app', live = which === 'app'): () => string {
  let dir = '';
  let error = 'not built';
  const args = which === 'gpu' ? GPU_BUILD : APP_BUILD;
  const name = which === 'gpu' ? 'deep-gpu' : 'deep-app';
  beforeAll(() => {
    if (process.platform !== 'darwin' || (live && process.env[LIVE] !== '1')) return;
    dir = mkdtempSync(join(tmpdir(), `deep-177-${which}-`));
    error = cargo(args);
    const target = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
    if (error === '') copyFileSync(join(target, which === 'gpu' ? 'debug' : 'release', name), join(dir, name));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    requireMetal();
    expect(error, `it builds: cargo ${args.join(' ')}`).toBe('');
    return join(dir, name);
  };
}

/** A fresh folder per test, deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-177-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${shown(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${shown(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` in, one line out (#377).

/** The wrong programs `deep-gpu run --planted` reaches (README: Planted programs). */
export type GpuPlant =
  | 'clips_at_one' | 'clips_at_headroom' | 'moves_toe' | 'status_over_paper_white' | 'reads_headroom_once'
  | 'export_reads_hdr_surface' | 'hdr_layer_above_chrome' | 'catcher_view_goes_hdr';

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlant): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${name}: ${r.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(r.status, `${name} exited 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const answer = obj(parsed, `${name}: the answer`);
  expect(answer['ok'], `${name} accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((x, i) => obj(x, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// The issue's numbers, the look and the documents (README: Fixtures)

export const HEADROOM = 4;
export const LAMP = 8;
export const HIGHLIGHT = 2;
export const GREY = 0.18;
/** The look's agx: the design's default contrast, its white set to the lamp, so the lamp reaches the headroom exactly. */
export const CONTRAST = 1.25;
export const WHITE = 8;
export const LOOK: JsonObject = { ...PLAIN_LOOK, id: 'look-177-agx', tone_map: { agx: { white: WHITE, contrast: CONTRAST } } };
export const VERDICT = 'verdict:01JB4177000000000000000177';
export const FAILED: Record<string, string> = { [VERDICT]: 'fail' };
/** The clean look's fail color (#382), as PLAIN_LOOK's status map has it. */
export const FAIL: Rgb = [0xbf, 0x23, 0x2b];

/** The view, the window it sits in at scale 1, the view's origin in it, and the window's page (chrome). */
export const SIZE: [number, number] = [480, 240];
export const ORIGIN: [number, number] = [20, 20];
export const WINDOW: [number, number] = [520, 280];
export const PAGE: Rgb = [200, 200, 200];

const glow = (strength: number): JsonObject => material({ base_color: [0, 0, 0, 1], emission: [1, 1, 1], emission_strength: strength });
const slab = (size: number, x: number, y: number, mat: string): JsonObject => box([size, size, 0.1], [x, y, 0], { material: mat });

/**
 * The lamps (480 × 240, orthographic, 40 px per m, a black opaque sky, no light): the lamp, a 2.4 m square of emission
 * 8 (8 times paper white) at x −4 m; the highlight, emission 2, at the centre; mid-grey, unlit 0.18, at x 4 m; and the
 * tag, a small box under mid-grey whose badge is bound to the verdict, so the fail mark draws on the same view.
 */
export function lampsDoc(id = 'lamps-177'): JsonObject {
  const doc = sessionDoc(id, SIZE, {
    cam: ortho([0, 0, 0], 12), sky: DARK_SKY,
    lamp_mat: glow(LAMP), hi_mat: glow(HIGHLIGHT), grey_mat: unlit([GREY, GREY, GREY]),
    lamp: slab(2.4, -4, 0, 'lamp_mat'), highlight: slab(2.4, 0, 0, 'hi_mat'), grey: slab(2.4, 4, 0, 'grey_mat'),
    tag: { kind: 'mark.box@1', params: { size: [0.6, 0.6, 0.1], paint: { fill: { role: 'stone' } } }, at: { pos: [4, -2.2, 0] } },
  });
  doc['status_bindings'] = { b_badge: { target: 'items/tag/params/paint/badge', source: VERDICT } };
  return doc;
}
/** The card's view: one lamp (emission 8), a 4 m square at the centre (160 px), under the black sky. */
export function bigLampDoc(): JsonObject {
  return sessionDoc('big-lamp-177', SIZE, { cam: ortho([0, 0, 0], 12), sky: DARK_SKY, lamp_mat: glow(LAMP), lamp: slab(4, 0, 0, 'lamp_mat') });
}
/** The lamp's rect in view px (bigLampDoc), and the card's slot over its middle in window points (scale 1). */
export const BIG_LAMP: [number, number, number, number] = [160, 40, 160, 160];
export const CARD_RECT: [number, number, number, number] = [ORIGIN[0] + 190, ORIGIN[1] + 70, 100, 100];
export const CARD: JsonObject = { question: 'Keep the lamp this bright?', options: [{ label: 'Keep' }, { label: 'Dim' }], rect: CARD_RECT };

/**
 * 3D over a 2D page (#424's catcher): no sky, so the page shows where nothing draws; a floor that catches shadows, a
 * 1 m box on it under a casting sun, and a 0.6 m lamp of emission 8 beside it, seen from above at an angle.
 */
export function catcherDoc(): JsonObject {
  return sessionDoc('catcher-177', SIZE, {
    cam: camera([0, 6, -6], [0, 0, -0.8], 50),
    catch_mat: material({ base_color: [0.8, 0.8, 0.8, 1], roughness: 1, catch: 'shadow' }),
    caster_mat: material({ base_color: [0.6, 0.2, 0.2, 1], roughness: 0.8 }),
    lamp_mat: glow(LAMP),
    floor: box([8, 0.1, 8], [0, -0.05, 0], { material: 'catch_mat' }),
    caster: box([1, 1, 1], [0, 0.5, 0], { material: 'caster_mat' }),
    lamp: box([0.6, 0.6, 0.6], [1.6, 0.3, -0.4], { material: 'lamp_mat' }),
    key: sun(Math.PI * Math.SQRT2, [-45, 0, 0], true),
  });
}

// ---------------------------------------------------------------------------------------------------
// The view3d call with this issue's fields (README: deep-gpu: the stub display and the view's HDR output)

export interface Post { frame: number; headroom: number }
export interface StubDisplay { potential: number; headroom: number; posts?: Post[] }
export interface View {
  doc: string; look?: JsonObject; size?: [number, number]; frames?: number; capture?: number[]; targets?: string[];
  hdr?: 'auto' | 'off'; stub_display?: StubDisplay; class?: 'live' | 'export' | 'render_back'; states?: Record<string, string>;
  window?: { size: [number, number]; view: [number, number]; page: Rgb; card?: JsonObject };
}
export const view3d = (v: View): JsonObject => ({ call: 'view3d', look: LOOK, size: SIZE, frames: 1, capture: [0], states: FAILED, ...(v as unknown as JsonObject) });
/** The stub display the issue names: potential headroom 4, current headroom 4. */
export const STUB: StubDisplay = { potential: HEADROOM, headroom: HEADROOM };
export const IN_WINDOW = { size: WINDOW, view: ORIGIN, page: PAGE } as const;

export interface Hdr { state: 'on' | 'off'; headroom: number }
export interface Surface { format: 'rgba16float' | 'bgra8unorm'; color_space: string; edr: boolean; file: string }
export interface Frame {
  frame: number; pixel_hash: string | null; final: string | null; hdr: Hdr; surface: Surface | null;
  window_linear: string | null; linear: string | null; ids: string | null; picks: Map<number, string>; raw: JsonObject;
}
export function framesOf(reply: JsonObject, what: string): Frame[] {
  answered(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    const h = obj(f['hdr'], `${at}.hdr`);
    const state = str(h['state'], `${at}.hdr.state`);
    expect(['on', 'off'], `${at}.hdr.state is on or off`).toContain(state);
    let surface: Surface | null = null;
    if (f['surface'] !== undefined && f['surface'] !== null) {
      const s = obj(f['surface'], `${at}.surface`);
      const format = str(s['format'], `${at}.surface.format`);
      expect(['rgba16float', 'bgra8unorm'], `${at}.surface.format`).toContain(format);
      expect(typeof s['edr'], `${at}.surface.edr is a boolean`).toBe('boolean');
      surface = { format: format as Surface['format'], color_space: str(s['color_space'], `${at}.surface.color_space`), edr: s['edr'] as boolean, file: str(s['file'], `${at}.surface.file`) };
    }
    const picks = new Map<number, string>();
    if (isObject(f['picks'])) for (const [k, id] of Object.entries(f['picks'])) picks.set(Number(k), str(id, `${at}.picks[${k}]`));
    return {
      frame: num(f['frame'], `${at}.frame`), pixel_hash: optStr(f['pixel_hash'], `${at}.pixel_hash`), final: optStr(f['final'], `${at}.final`),
      hdr: { state: state as Hdr['state'], headroom: num(h['headroom'], `${at}.hdr.headroom`) }, surface,
      window_linear: optStr(f['window_linear'], `${at}.window_linear`), linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks, raw: f,
    };
  });
}
export function frameAt(reply: JsonObject, n: number, what: string): Frame {
  const frames = framesOf(reply, what);
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).join(', ')})`).toBeDefined();
  return f!;
}

/** The fail mark #382's status report names on a view3d reply: its color and bounds in the view's px. */
export function failMark(reply: JsonObject, what: string): { color: Rgb; bounds: [number, number, number, number] } | null {
  const s = obj(reply['status'], `${what}: status`);
  for (const [i, m] of arr(s['marks'], `${what}: status.marks`).entries()) {
    const o = obj(m, `${what}: status.marks[${i}]`);
    if (o['state'] !== 'fail') continue;
    const c = arr(o['color'], `${what}: status.marks[${i}].color`).map((x) => num(x, 'a color channel')) as Rgb;
    const b = arr(o['bounds'], `${what}: status.marks[${i}].bounds`).map((x) => num(x, 'a bound')) as [number, number, number, number];
    return { color: c, bounds: b };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------
// Read-backs: values in linear light, and the 8-bit sRGB code each one encodes to

export const encode = (v: number): number => { const c = Math.min(Math.max(v, 0), 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
export const code8 = (v: number): number => Math.round(255 * encode(v));
export const decode8 = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export function half(bits: number): number {
  const s = bits & 0x8000 ? -1 : 1; const e = (bits >> 10) & 0x1f; const m = bits & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? Number.NaN : s * Number.POSITIVE_INFINITY;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

export type Px = [number, number, number];
/** A read-back: each pixel's linear RGB, and the 8-bit sRGB codes it holds (an 8-bit surface's own bytes). */
export interface Pixels { width: number; height: number; at: (x: number, y: number) => Px; code: (x: number, y: number) => Px }

/** The view's surface as the frame presented it (README: `surface`): f16 RGBA extended linear, or 8-bit BGRA sRGB. */
export function readSurface(out: string, s: Surface, size: [number, number], what: string): Pixels {
  const file = readNamed(out, s.file, 'bin', `${what}: surface`);
  const [w, h] = size;
  if (s.format === 'rgba16float') {
    expect(file.length, `${what}: the rgba16float surface holds ${w} × ${h} × 8 bytes`).toBe(w * h * 8);
    const at = (x: number, y: number): Px => { const o = (y * w + x) * 8; return [half(file.readUInt16LE(o)), half(file.readUInt16LE(o + 2)), half(file.readUInt16LE(o + 4))]; };
    return { width: w, height: h, at, code: (x, y) => at(x, y).map(code8) as Px };
  }
  expect(file.length, `${what}: the bgra8unorm surface holds ${w} × ${h} × 4 bytes`).toBe(w * h * 4);
  const code = (x: number, y: number): Px => { const o = (y * w + x) * 4; return [file[o + 2]!, file[o + 1]!, file[o]!]; };
  return { width: w, height: h, code, at: (x, y) => code(x, y).map(decode8) as Px };
}
/** An f32 RGBA file (`linear`, `window_linear`): little-endian, rows top-down, w × h × 16 bytes. */
export function readF32(out: string, hash: string | null, size: [number, number], what: string): Pixels {
  const file = readNamed(out, hash, 'f32', what);
  const [w, h] = size;
  expect(file.length, `${what} holds ${w} × ${h} f32 RGBA pixels`).toBe(w * h * 16);
  const at = (x: number, y: number): Px => { const o = (y * w + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; };
  return { width: w, height: h, at, code: (x, y) => at(x, y).map(code8) as Px };
}
/** The ID target (#378): an 8-bit RGBA PNG whose pixel holds pick r + 2^8 g + 2^16 b + 2^24 a, named by `picks`. */
export function readIds(out: string, f: Frame, what: string): (x: number, y: number) => string | null {
  const png = decodePng(readNamed(out, f.ids, 'png', `${what}: ids`));
  return (x, y) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return null;
    const o = (y * png.width + x) * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    return pick === 0 ? null : f.picks.get(pick) ?? null;
  };
}
/** The pixels of `id` whose every neighbour within `r` px is `id` too: its interior, away from edges. */
export function interior(ids: (x: number, y: number) => string | null, size: [number, number], id: string, r = 3): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    let all = true;
    for (let dy = -r; dy <= r && all; dy++) for (let dx = -r; dx <= r && all; dx++) if (ids(x + dx, y + dy) !== id) all = false;
    if (all) out.push([x, y]);
  }
  return out;
}
/** The most common 8-bit code among `pixels` of `img`. */
export function modeCode(img: Pixels, pixels: Iterable<[number, number]>): Px | null {
  const counts = new Map<string, number>(); let best: string | null = null; let n = 0;
  for (const [x, y] of pixels) {
    const k = img.code(x, y).join(','); const c = (counts.get(k) ?? 0) + 1; counts.set(k, c);
    if (c > n) { n = c; best = k; }
  }
  return best === null ? null : (best.split(',').map(Number) as Px);
}
export function* rect(x0: number, y0: number, w: number, h: number): Generator<[number, number]> {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) yield [x, y];
}
export const fmt = (p: readonly number[]): string => `[${p.map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(4))).join(', ')}]`;

// ---------------------------------------------------------------------------------------------------
// The roll-off (README: The roll-off): the look's agx curve per channel, its shoulder ending at the headroom M (never
// below 1) instead of at 1, as the Oracle page's formula has it; the toe below 0.18 unchanged; M = 1 is the SDR curve.

export function agxTo(x: number, headroom: number, contrast = CONTRAST, white = WHITE): number {
  const m = Math.max(headroom, 1);
  if (!(x > 0)) return 0;
  const c = contrast;
  const a = (1 / 0.18 - 1) * 0.18 ** c;
  if (x <= 0.18) { const xc = x ** c; return xc / (xc + a); }
  if (x >= white) return m;
  const s = 0.18 ** c + a;
  const k = (c * 0.18 ** (c - 1) * a) / (s * s); // the toe's slope at 0.18
  const shoulder = m - 0.18;
  const w = (k * (white - 0.18) ** 2) / shoulder;
  const d = x - 0.18;
  return 0.18 + (k * d * (1 + d / w)) / (1 + (k * d) / shoulder);
}

// ---------------------------------------------------------------------------------------------------
// The live app: `deep-app --hdr <scenario>` (hdr-fixture build) opens the app's real window on the main display, plays
// the scenario and prints one report line `{"hdr": 177, …}` (README: deep-app --hdr).

export type AppPlant = 'auto_waits_for_headroom' | 'reads_headroom_every_frame' | 'keeps_hdr_layer' | 'surface_resizes_late';
export interface Layer { owner: string; format: string; colorspace: string | null; edr: boolean; opaque: boolean }
export interface LiveFrame {
  frame: number; ms: number; state: 'on' | 'off'; headroom: number; peak: number | null; cpu_ms: number | null; gpu_ms: number | null;
  size: [number, number] | null; capture: string | null;
}
export interface LiveReport { scale: number; potential: number; frames: LiveFrame[]; layers: Layer[]; headroom_reads: number; display_posts: number; raw: JsonObject }

/** Plays `scenario` in `dir` (a folder the caller deletes; captures are written there). */
export function liveHdr(bin: string, dir: string, scenario: JsonObject, plant?: AppPlant): LiveReport {
  {
    const file = join(dir, 'scenario.json');
    writeFileSync(file, JSON.stringify({ format: 'hdr-fixture@1', out: dir, ...scenario }));
    const env = { ...process.env };
    delete env['DEEP_HDR_PLANT'];
    if (plant) env['DEEP_HDR_PLANT'] = plant;
    const r = spawnSync(bin, ['--hdr', file], { cwd: REPO, encoding: 'utf8', env, timeout: 900_000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 });
    const what = `deep-app --hdr${plant ? ` (DEEP_HDR_PLANT=${plant})` : ''}`;
    expect(r.status, `${what} exits 0 (${r.signal ?? 'no signal'}): ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
    const line = (r.stdout ?? '').split('\n').reverse().map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return null; } })
      .find((v): v is JsonObject => isObject(v ?? undefined) && (v as JsonObject)['hdr'] === 177);
    expect(line, `${what} prints its report line {"hdr": 177, …}: ${(r.stdout ?? '').slice(-800)}`).toBeDefined();
    const rep = line!;
    const display = obj(rep['display'], `${what}: display`);
    const frames = arr(rep['frames'], `${what}: frames`).map((v, i): LiveFrame => {
      const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
      const state = str(f['state'], `${at}.state`);
      expect(['on', 'off'], `${at}.state`).toContain(state);
      const opt = (k: string): number | null => (f[k] === undefined || f[k] === null ? null : num(f[k], `${at}.${k}`));
      const size = f['size'] === undefined ? null : (arr(f['size'], `${at}.size`).map((x) => num(x, `${at}.size[]`)) as [number, number]);
      const capture = optStr(f['capture'], `${at}.capture`);
      return {
        frame: num(f['frame'], `${at}.frame`), ms: num(f['ms'], `${at}.ms`), state: state as LiveFrame['state'], headroom: num(f['headroom'], `${at}.headroom`),
        peak: opt('peak'), cpu_ms: opt('cpu_ms'), gpu_ms: opt('gpu_ms'), size, capture,
      };
    });
    const layers = arr(rep['layers'], `${what}: layers`).map((v, i): Layer => {
      const l = obj(v, `${what}: layers[${i}]`);
      return { owner: str(l['owner'], `layers[${i}].owner`), format: str(l['format'], `layers[${i}].format`), colorspace: optStr(l['colorspace'], `layers[${i}].colorspace`), edr: l['edr'] === true, opaque: l['opaque'] === true };
    });
    return { scale: num(rep['scale'], `${what}: scale`), potential: num(display['potential_headroom'], `${what}: display.potential_headroom`), frames, layers, headroom_reads: num(rep['headroom_reads'], `${what}: headroom_reads`), display_posts: num(rep['display_posts'], `${what}: display_posts`), raw: rep };
  }
}
/** INCONCLUSIVE unless the window is on an XDR display (potential EDR headroom above 1). */
export function requireXdr(r: LiveReport): void {
  if (!(r.potential > 1)) inconclusive(`the window's display reports a potential EDR headroom of ${r.potential}, not above 1: no XDR display is attached`);
}

// ---------------------------------------------------------------------------------------------------
// Budgets: five runs after warm-up, judged by scripts/benchmark.mjs's judgeLimit (the reference Macs, mains power,
// Low Power Mode off, thermal state nominal, the load at each run's start and end); anywhere else INCONCLUSIVE.

export const load = (): number => loadavg()[0]!;
export async function judge(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href)) as { fingerprint: () => JsonObject; judgeLimit: (o: JsonObject) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads } as unknown as JsonObject);
}
