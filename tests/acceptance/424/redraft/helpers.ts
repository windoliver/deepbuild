// Test-side tools for the blind redraft of #424's AC9: the base's `deep-gpu` binary (#377's GPU layer with #378's
// `view3d`), built once per file and driven by one JSON line; the suite's assumed surfaces (README); the closed box,
// its cutaway and its camera; and the reviewed CPU references the criterion is held to: #378's pinhole, a ray cast
// through the box as the cut leaves it, the cut edge's projection along the sun measured in the shadow map's plane,
// and a Lambertian (matte) surface's linear value. Copied from #421's and #422's helpers where they agree, since
// suites don't import each other. Nothing here stands in for the renderer, the cutaway or the shadow pass.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/424/redraft is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');

/** AC9's ID: the first 8 hex digits of SHA-256 of its trimmed, whitespace-collapsed text. */
export const AC9 = 'AC9 #424.d0c14cb2';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws these pixels on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-424r-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu'));
  };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-424r-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line `{out, calls}` in, one JSON line out (#377).

/** The planted wrong program this criterion names: the cutaway's planes clip the color (geometry) pass only. */
export type GpuPlanted = 'cut_color_only';

/** One process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: GpuPlanted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${name}: its answer is JSON: ${lines[0]!.slice(0, 600)}`); }
  const answer = obj(parsed, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
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
// The look and the document

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** The cap's role and its palette color (sRGB hex, decoded by the sRGB transfer function as the base decodes roles). */
export const CAP_ROLE = 'cap';
export const CAP_HEX = '#bcbcbc';
/** A physical-basis `look@1` (#421's shape) with tone map none at the exposure whose scale is 1 (#378's acceptance
 * look), so the final target is the sRGB encoding of the linear one; physical, so `cap_light: auto` is lit. */
export const PLAIN_LOOK: JsonObject = {
  id: 'look-424-redraft', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #424 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', grey: CAP_HEX },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', [CAP_ROLE]: 'grey' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};
export function srgbDecode(code: number): number {
  const c = code / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** The cap role's linear reflectance (its grey's one channel). */
export const CAP_ALBEDO = srgbDecode(parseInt(CAP_HEX.slice(1, 3), 16));

export const AGENT = 'agent:sess-alpha';
/** A scene document as a session holds it (#378): every item in one writer layer. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #424 acceptance fixture.`, size, camera: 'cam', transport: { span: '10s' },
    requires: { modules: { scene3d: '^1' } }, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, items: withIds,
  };
}

export type V3 = [number, number, number];
export type Rgb = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const rad = (d: number): number => (d * Math.PI) / 180;
/** R = Rz·Ry·Rx (degrees) applied to `v` (Units and axes). */
export function rotate(rot: V3, v: V3): V3 {
  const [cx, sx] = [Math.cos(rad(rot[0])), Math.sin(rad(rot[0]))];
  const [cy, sy] = [Math.cos(rad(rot[1])), Math.sin(rad(rot[1]))];
  const [cz, sz] = [Math.cos(rad(rot[2])), Math.sin(rad(rot[2]))];
  const x1: V3 = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
  const y1: V3 = [cy * x1[0] + sy * x1[2], x1[1], -sy * x1[0] + cy * x1[2]];
  return [cz * y1[0] - sz * y1[1], sz * y1[0] + cz * y1[1], y1[2]];
}

// ---------------------------------------------------------------------------------------------------
// The fixture: a closed box of six slabs (`mark.box@1`, centred on `at.pos`) around a cavity 5 m wide (x), 4 m deep
// (z) and 1.2 m tall (y), walls 0.3 m thick, the cavity's floor at y = 0; a key sun at 45° elevation from the
// (+x, +z) quarter (azimuth 45°), the only light under a black sky with no ambient; one cascade out to 12 m.

export const WI = 2.5; export const DI = 2.0; export const H = 1.2; export const T = 0.3;
export const LUX = 100;
export const ELEVATION = 45;
/** The sun's `at.rot`: it shines along its own −Z, so Rx(−45°) then Ry(45°) points it down at 45° toward (−x, −z). */
export const SUN_ROT: V3 = [-ELEVATION, 45, 0];
/** The unit direction toward the sun: (0.5, 0.7071, 0.5). */
export const TOWARD_SUN: V3 = scale(rotate(SUN_ROT, [0, 0, -1]), -1);

export interface Slab { id: string; min: V3; max: V3 }
/** The six slabs, none overlapping: floor and roof span the whole plan, the side walls the whole depth between them,
 * the front (+z) and back walls the width between the side walls. */
export const SLABS: Slab[] = [
  { id: 'floor', min: [-WI - T, -T, -DI - T], max: [WI + T, 0, DI + T] },
  { id: 'roof', min: [-WI - T, H, -DI - T], max: [WI + T, H + T, DI + T] },
  { id: 'wall_east', min: [WI, 0, -DI - T], max: [WI + T, H, DI + T] },
  { id: 'wall_west', min: [-WI - T, 0, -DI - T], max: [-WI, H, DI + T] },
  { id: 'wall_front', min: [-WI, 0, DI], max: [WI, H, DI + T] },
  { id: 'wall_back', min: [-WI, 0, -DI - T], max: [WI, H, -DI] },
];

export const SIZE: [number, number] = [480, 360];
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
export const CAM: Pinhole = { position: [-1, 2, 4.5], target: [-0.8, 0.1, -1], fov: 50, size: SIZE };

/** The cutaway as `view3d` takes it (a cutaway@1's params as a view input): one plane removing z > offset, a half
 * section through the box, capped in the look's `cap` role, lit by auto in this physical look, shadows cut. */
export const cutaway = (offset: number): JsonObject => ({
  planes: [{ normal: [0, 0, 1], offset }], mode: 'union', applies_to: 'all', cap: CAP_ROLE, class: 'view', shadows: 'cut', cap_light: 'auto',
});
/** The two plane positions: through the box's middle, and moved 0.4 m back. */
export const OFFSETS = [0, -0.4] as const;

export function boxDoc(): JsonObject {
  const white = 'white';
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: CAM.position, target: CAM.target, fov: CAM.fov, near: 0.1, far: 100 } },
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    // A white Lambertian (#421's photometry floor): its linear value is E × (n·l) ÷ π.
    [white]: { kind: 'material@1', params: { base_color: [1, 1, 1, 1], metallic: 0, roughness: 1, specular_level: 0 } },
    sun: { kind: 'light.sun@1', params: { illuminance: LUX, color: [1, 1, 1], shadow: true, cascades: 1, shadow_far: 12 }, at: { rot: SUN_ROT } },
  };
  for (const s of SLABS) {
    items[s.id] = { kind: 'mark.box@1', params: { size: sub(s.max, s.min) }, at: { pos: scale(add(s.min, s.max), 0.5) }, material: white };
  }
  return sessionDoc('cutaway-box', SIZE, items);
}

export interface View3d {
  doc: string; look: JsonObject; size: [number, number]; frames: number; capture: number[];
  targets: ('final' | 'linear' | 'ids')[]; cascades: boolean; cutaway: JsonObject;
}
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', ...(v as unknown as JsonObject) });

// ---------------------------------------------------------------------------------------------------
// The reply: frames, targets, the cascades' maps and the passes

export interface ShadowMap { key: string; texel_m: number }
export interface ViewFrame { frame: number; linear: string | null; ids: string | null; picks: Map<number, string> | null; maps: ShadowMap[] | null }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function frame0(reply: JsonObject, what: string): ViewFrame {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i) => obj(v, `${what}: frames[${i}]`));
  const found = frames.find((x) => x['frame'] === 0);
  expect(found, `${what}: frame 0 is in the reply`).toBeDefined();
  const f = found!;
  const at = `${what}: frame 0`;
  const pk = f['picks'];
  let picks: Map<number, string> | null = null;
  if (isObject(pk)) picks = new Map(Object.entries(pk).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
  let maps: ShadowMap[] | null = null;
  if (f['cascades'] !== undefined) {
    maps = arr(obj(f['cascades'], `${at}.cascades`)['maps'], `${at}.cascades.maps`).map((m, j) => {
      const o = obj(m, `${at}.cascades.maps[${j}]`);
      return { key: str(o['key'], `${at}.cascades.maps[${j}].key`), texel_m: num(o['texel_m'], `${at}.cascades.maps[${j}].texel_m`) };
    });
  }
  return { frame: 0, linear: optStr(f['linear'], `${at}.linear`), ids: optStr(f['ids'], `${at}.ids`), picks, maps };
}
/** The reply's pass that writes `target`, by name (the base names `scene3d.shadow` and `scene3d.geometry`). */
export function passWriting(reply: JsonObject, target: string, what: string): string | null {
  const passes = arr(reply['passes'], `${what}: passes`).map((p, i) => obj(p, `${what}: passes[${i}]`));
  const p = passes.find((x) => { const w = x['writes']; return Array.isArray(w) && w.includes(target); });
  return p ? str(p['name'], `${what}: the pass writing ${target}`) : null;
}

function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target (#378): little-endian f32 RGBA, rows top-down, scene-referred, before exposure. */
export interface Linear { at: (x: number, y: number) => Rgb }
export function readLinear(out: string, hash: string | null, what: string): Linear {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${SIZE[0]} × ${SIZE[1]} f32 RGBA pixels`).toBe(SIZE[0] * SIZE[1] * 16);
  return { at: (x, y) => { const o = (y * SIZE[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGBA PNG with no interlace. */
function decodeRgbaPng(file: Buffer, what: string): { width: number; height: number; rgba: Uint8Array } {
  expect(file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${what} is a PNG`).toBe(true);
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  expect([depth, color, interlace], `${what} is an 8-bit RGBA PNG with no interlace`).toEqual([8, 6, 0]);
  const stride = width * 4;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? line[i - 4]! : 0; const b = previous[i]!; const c = i >= 4 ? previous[i - 4]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      expect(Number.isNaN(v), `${what}: PNG filter ${filter} is one of 0–4`).toBe(false);
      line[i] = v & 255;
    }
    rgba.set(line, y * stride);
    previous = line;
  }
  return { width, height, rgba };
}
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws, named through `picks`. */
export function readIds(out: string, f: ViewFrame, what: string): (x: number, y: number) => string | null {
  const png = decodeRgbaPng(readNamed(out, f.ids, 'png', what), what);
  expect([png.width, png.height], `${what} is ${SIZE[0]} × ${SIZE[1]}`).toEqual(SIZE);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  return (x, y) => {
    const o = (y * png.width + x) * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    return pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
  };
}

// ---------------------------------------------------------------------------------------------------
// The CPU reference: #378's pinhole (position, target, +Y up, fov across the wider side) and a ray cast through the box
// as the cut leaves it (each slab clipped to z ≤ offset; a hit on the clipped face at z = offset is the cap).

export function pixelRay(cam: Pinhole, px: number, py: number): V3 {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const focal = Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2);
  return unit(add(add(f, scale(r, (px + 0.5 - cam.size[0] / 2) / focal)), scale(u, -(py + 0.5 - cam.size[1] / 2) / focal)));
}
/** What the pixel's ray first meets: the slab, the face (`top` for +y, `cap` for the cut face) and the point. */
export interface Hit { id: string; face: 'top' | 'cap' | 'other'; p: V3 }
export function castRay(o: V3, d: V3, offset: number): Hit | null {
  let best: { t: number; id: string; axis: number; side: number } | null = null;
  for (const s of SLABS) {
    const max: V3 = [s.max[0], s.max[1], Math.min(s.max[2], offset)];
    if (max[2] <= s.min[2]) continue;
    let t0 = -Infinity; let t1 = Infinity; let axis = -1; let side = 0;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]!) < 1e-12) { if (o[k]! < s.min[k]! || o[k]! > max[k]!) { t0 = Infinity; break; } continue; }
      const a = (s.min[k]! - o[k]!) / d[k]!; const b = (max[k]! - o[k]!) / d[k]!;
      const near = Math.min(a, b);
      if (near > t0) { t0 = near; axis = k; side = a < b ? -1 : 1; }
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (t0 <= t1 && t0 > 0 && (!best || t0 < best.t)) best = { t: t0, id: s.id, axis, side };
  }
  if (!best) return null;
  const slab = SLABS.find((s) => s.id === best!.id)!;
  const face = best.axis === 1 && best.side === 1 ? 'top' : best.axis === 2 && best.side === 1 && slab.max[2] > offset ? 'cap' : 'other';
  return { id: best.id, face, p: add(o, scale(d, best.t)) };
}

/** The cut edge that bounds the light on the inner floor: where the plane z = offset meets the roof's underside, a line
 * along x. Its projection along the sun onto the floor is z = offset − H × l_z ÷ l_y; this is the floor point's
 * distance to that projection measured across the light (in the shadow map's plane, so in metres of texels), signed
 * + on the sunlit side (toward the opening). */
export function acrossLight(p: V3, offset: number): number {
  const l = TOWARD_SUN; const u: V3 = [1, 0, 0];
  const w = sub(p, [0, H, offset]);
  const wp = sub(w, scale(l, dot(w, l))); const up = unit(sub(u, scale(l, dot(u, l))));
  const d = Math.hypot(...sub(wp, scale(up, dot(wp, up))));
  return p[2] > shadowLine(offset) ? d : -d;
}
export const shadowLine = (offset: number): number => offset - (H * TOWARD_SUN[2]) / TOWARD_SUN[1];

/** The floor's sunlit linear value (a white Lambertian, n = +y) and the cap's (the cap role's grey, matte, n = the
 * plane's normal +z): E × ρ × max(n·l, 0) ÷ π. */
export const FLOOR_LIT = (LUX * TOWARD_SUN[1]) / Math.PI;
export const CAP_LIT = (LUX * CAP_ALBEDO * Math.max(TOWARD_SUN[2], 0)) / Math.PI;

/** The pixels the criterion is judged on at one plane position, for a band of `band` m across the light: the inner
 * floor's top, 2 px clear of any other surface, in x ∈ [−2.3, 0.2] (where the side wall's shadow is over 1.4 m away,
 * so the cut edge's projection is the only shadow line) and z ∈ [−1.9, offset − 0.1]; split into those more than
 * `band` on the sunlit side and on the shadowed side; and the cap's pixels, 2 px clear of its edges. */
export interface Judged { lit: [number, number, V3][]; dark: [number, number, V3][]; cap: [number, number, string][] }
export function judged(offset: number, band: number): Judged {
  const hits: (Hit | null)[] = [];
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) hits.push(castRay(CAM.position, pixelRay(CAM, x, y), offset));
  const at = (x: number, y: number): Hit | null => (x < 0 || y < 0 || x >= SIZE[0] || y >= SIZE[1] ? null : hits[y * SIZE[0] + x]!);
  const clear = (x: number, y: number, h: Hit): boolean => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const n = at(x + dx, y + dy); if (!n || n.id !== h.id || n.face !== h.face) return false; }
    return true;
  };
  const out: Judged = { lit: [], dark: [], cap: [] };
  for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
    const h = at(x, y);
    if (!h || h.face === 'other' || !clear(x, y, h)) continue;
    if (h.face === 'cap') { out.cap.push([x, y, h.id]); continue; }
    if (h.id !== 'floor' || h.p[0] < -2.3 || h.p[0] > 0.2 || h.p[2] < -1.9 || h.p[2] > offset - 0.1) continue;
    const s = acrossLight(h.p, offset);
    if (s > band) out.lit.push([x, y, h.p]); else if (s < -band) out.dark.push([x, y, h.p]);
  }
  return out;
}
/** The fewest pixels each set must hold for the criterion to be judged (each checked against the fixture at a band of
 * 0.08 m, two texels of 4 cm, before this suite was committed: README, Fixture). */
export const MIN_LIT = 2000; export const MIN_DARK = 2000; export const MIN_CAP = 500;
