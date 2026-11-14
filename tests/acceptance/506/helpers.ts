// Test-side tools for the #506 acceptance tests (README: The surface under test). They build `deep-gpu` (the GPU layer
// that draws 3D views through `view3d`) and `deep-show` (the canvas core's checks and interaction scope), drive both by
// JSON lines, and hold the fixtures the criteria name, so the criterion files and the taste call draw the same scenes:
// the screen in a display's face, the second-camera inset, the glTF terrain under its heatmap, the draped lid, the film
// with a view overlay, the lamp's card, the eye inset in a wall, the figure with a mirror, glass and forty lights, and
// the soft disc. The references the readings are held to are written here from the issue and the design: projections
// through a pinhole and an orthographic view, rays against the terrain's own triangles, a box, a sphere, and the sRGB
// coding of the disc's own texels. Pure tools are reused from #424's and #449's suites. Nothing here stands in for an
// inset, an overlay, the renderer or a check.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import {
  PLAIN_LOOK, code8, decode8, decodePng, encodeRgbaPng, gltf, hitBox, hitSphere, hitTriangle, orbitPosition, rotate,
  type Image, type Mesh,
} from '../424/helpers.ts';
import { FLICKS, apng, sha256 } from '../449/helpers.ts';

export { FLICKS, apng, code8, decode8, decodePng, encodeRgbaPng, hitBox, hitSphere, orbitPosition, rotate, sha256, type Image };

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Rgb = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/506 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
export const CRITERIA = {
  1: '#506.ed43cc07', 2: '#506.9d6f96ee', 3: '#506.fad8bc6e', 4: '#506.2393e811', 5: '#506.f7b7c9cf',
  6: '#506.0c1bce3a', 7: '#506.1bab76b5', 8: '#506.2b4f3d4f', 9: '#506.58529d4d',
} as const;
/** A test title's prefix: `AC<n> #506.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

/** The `deep-gpu run --planted` names this suite adds (README: Planted programs; twins.json). */
export type Planted =
  | 'eye_inset_centred_frustum' | 'one_backdrop_per_frame' | 'one_mirror_per_frame' | 'one_light_cut_per_frame'
  | 'inset_premultiplied_as_straight';

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
/** Whether a value's JSON text holds `needle` (an item ID). */
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
export const SHA = /^[0-9a-f]{64}$/;
export const fmt = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : String(x));

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
/** The pixels are drawn on macOS's Metal device: INCONCLUSIVE anywhere else. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`these pixels are drawn on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder. No cargo is BLOCKED.

export type BinName = 'deep-gpu' | 'deep-show';
const BUILD_ARGS: Record<BinName, string[]> = {
  'deep-gpu': ['build', '--locked', '--bin', 'deep-gpu'],
  'deep-show': ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'],
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
/** Builds every listed binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(names: readonly BinName[]): (name: BinName) => string {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-506-bins-'));
    for (const name of names) {
      const error = cargo(BUILD_ARGS[name]);
      const bin = join(dir, name);
      if (error === '') copyFileSync(join(target(), 'debug', name), bin);
      made.set(name, { bin, error });
    }
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (name: BinName): string => {
    const entry = made.get(name);
    if (!entry) throw Error(`the file didn't list ${name} in useBins`);
    if (entry.error.startsWith('BLOCKED:')) throw Error(entry.error);
    expect(entry.error, `${name} builds: cargo ${BUILD_ARGS[name].join(' ')}`).toBe('');
    return entry.bin;
  };
}
/** A fresh temporary folder per test (documents, assets, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-506-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** Writes bytes under `dir` as `name` and returns its absolute path. */
export function writeBytes(dir: string, name: string, bytes: Uint8Array): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}
/** Writes JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
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

/** A `view3d` call (#378) with this suite's fields (README: The surface under test). */
export interface View3 {
  doc: string; look: JsonObject; size: [number, number]; fps?: number; from?: number; frames?: number;
  capture?: 'every' | number[]; targets?: ('final' | 'ids')[]; assets?: Record<string, string>;
  light_cut?: boolean; overlays?: boolean;
}
export const view3d = (c: View3): JsonObject => ({ call: 'view3d', frames: 1, fps: 30, capture: [0], targets: ['final'], ...(c as unknown as JsonObject) });

/** A reply that drew frames: INCONCLUSIVE where the platform can't draw, a failure naming the refusal otherwise. */
export function drawn(reply: JsonObject, what: string): void {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was drawn, not refused: ${show(reply)}`).toBeUndefined();
  arr(reply['frames'], `${what}: frames`);
}
/** A reply that refused the document before drawing: a `code`, no `frames`, and every one of `ids` named in it. */
export function refusedNaming(reply: JsonObject, ids: readonly string[], what: string): void {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(typeof reply['code'], `${what} is refused at check with a code: ${show(reply)}`).toBe('string');
  expect(reply['frames'], `${what}: a refused document draws no frames`).toBeUndefined();
  for (const id of ids) expect(mentions(reply, id), `${what}: the refusal names ${id}: ${show(reply)}`).toBe(true);
}

export interface Overlaid { id: string; at: [number, number] | null }
export interface Frame {
  frame: number; final: string | null; ids: string | null; picks: Map<number, string> | null;
  lightCut: string[] | null; overlays: Overlaid[] | null; raw: JsonObject;
}
export function framesOf(reply: JsonObject, what: string): Frame[] {
  drawn(reply, what);
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    let lightCut: string[] | null = null;
    if (f['light_cut'] !== undefined) {
      lightCut = arr(obj(f['light_cut'], `${at}.light_cut`)['shaded'], `${at}.light_cut.shaded`)
        .map((s, j) => str(obj(s, `${at}.light_cut.shaded[${j}]`)['light'], `${at}.light_cut.shaded[${j}].light`)).sort();
    }
    let overlays: Overlaid[] | null = null;
    if (f['overlays'] !== undefined) {
      overlays = arr(f['overlays'], `${at}.overlays`).map((o, j) => {
        const q = obj(o, `${at}.overlays[${j}]`);
        const p = q['at'];
        const pos = p === null ? null : (arr(p, `${at}.overlays[${j}].at`).map((x) => num(x, `${at}.overlays[${j}].at`)) as [number, number]);
        return { id: str(q['id'], `${at}.overlays[${j}].id`), at: pos };
      });
    }
    return {
      frame: num(f['frame'], `${at}.frame`), final: typeof f['final'] === 'string' ? f['final'] : null, ids: typeof f['ids'] === 'string' ? f['ids'] : null,
      picks, lightCut, overlays, raw: f,
    };
  });
}
export function frameAt(frames: readonly Frame[], n: number, what: string): Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).join(', ')})`).toBeDefined();
  return f!;
}
/** A file the binary wrote, named by its SHA-256. */
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** A frame's final target (8-bit sRGB after tone mapping, status and overlays). */
export function finalOf(out: string, f: Frame, what: string): Image {
  const im = decodePng(readNamed(out, f.final, 'png', `${what}: the final target`));
  return im;
}
export const px = (im: Image, x: number, y: number): Rgb => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!]; };
export const codeOff = (a: Rgb, b: Rgb): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
export const rgbText = (c: Rgb): string => `(${c.join(', ')})`;
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws, read through the frame's `picks`. */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
export function idsOf(out: string, f: Frame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', `${what}: the object-ID target`));
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : f.picks!.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[y * png.width + x]!) };
}
/** Whether every pixel within `r` of (x, y) shows `id` (away from its silhouette). */
export const idAround = (ids: Ids, x: number, y: number, id: string, r = 1): boolean => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
};

// ---------------------------------------------------------------------------------------------------
// Time, vectors and cameras (Units and axes: metres, +Y up, degrees; R = Rz·Ry·Rx; frame px from the top left corner)

/** Frame n's time at `fps`, seconds: ⌊n × flicks ÷ fps⌋ flicks (#449's frameFlicks). */
export const frameSeconds = (n: number, fps: number): number => Math.floor((n * FLICKS) / fps) / FLICKS;
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
export const rad = (d: number): number => (d * Math.PI) / 180;
export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** A pinhole (fov across the wider side, #378) or an orthographic view (`view_width` across the frame's width). */
export type Cam =
  | { kind: 'perspective'; position: V3; target: V3; fov: number; size: [number, number] }
  | { kind: 'orthographic'; position: V3; target: V3; viewWidth: number; size: [number, number] };
function basis(c: Cam): { f: V3; r: V3; u: V3 } {
  const f = unit(sub(c.target, c.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f) };
}
/** Where world point `p` lands in the frame, px, and its depth along the view (≤ 0: behind the eye). */
export function toScreen(c: Cam, p: V3): { x: number; y: number; depth: number } {
  const { f, r, u } = basis(c);
  const d = sub(p, c.position);
  const z = dot(d, f);
  const [w, h] = c.size;
  if (c.kind === 'orthographic') { const k = w / c.viewWidth; return { x: w / 2 + dot(d, r) * k, y: h / 2 - dot(d, u) * k, depth: z }; }
  const focal = Math.max(w, h) / 2 / Math.tan(rad(c.fov) / 2);
  return { x: w / 2 + (focal * dot(d, r)) / z, y: h / 2 - (focal * dot(d, u)) / z, depth: z };
}
/** The ray through frame point (sx, sy) px: its origin and unit direction. */
export function rayOf(c: Cam, sx: number, sy: number): { o: V3; d: V3 } {
  const { f, r, u } = basis(c);
  const [w, h] = c.size;
  if (c.kind === 'orthographic') {
    const k = c.viewWidth / w;
    return { o: add(c.position, add(scale(r, (sx - w / 2) * k), scale(u, -(sy - h / 2) * k))), d: f };
  }
  const focal = Math.max(w, h) / 2 / Math.tan(rad(c.fov) / 2);
  return { o: c.position, d: unit(add(f, add(scale(r, (sx - w / 2) / focal), scale(u, -(sy - h / 2) / focal)))) };
}
/** A `camera@1` item for `c`. */
export const cameraItem = (c: Cam): JsonObject => ({
  kind: 'camera@1',
  params: c.kind === 'perspective'
    ? { projection: 'perspective', position: c.position, target: c.target, fov: c.fov, near: 0.05, far: 500 }
    : { projection: 'orthographic', position: c.position, target: c.target, view_width: c.viewWidth, near: 0.05, far: 500 },
});
/** Whether (x, y) lies inside the convex quad `q` (corners in order), and its distance to the quad's edges (px). */
export function quadInside(q: readonly [number, number][], x: number, y: number): { inside: boolean; edge: number } {
  let sign = 0; let inside = true; let edge = Infinity;
  for (let k = 0; k < q.length; k++) {
    const [ax, ay] = q[k]!; const [bx, by] = q[(k + 1) % q.length]!;
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (c !== 0) { if (sign === 0) sign = Math.sign(c); else if (Math.sign(c) !== sign) inside = false; }
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = clamp01(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2);
    edge = Math.min(edge, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
  }
  return { inside, edge };
}

// ---------------------------------------------------------------------------------------------------
// The look and documents

/**
 * The look every view draws with: #424's plain physical look (tone map none at the exposure whose scale is 1, so the
 * final target is the sRGB encoding of the linear target; no bloom, no deband; the clean status colors), with this
 * suite's roles added and its exposure moved by `ev` stops (a positive `ev` brightens).
 */
export const ROLES: Record<string, string> = {
  glow: '#28c85a', beacon: '#2c8fd6', tint: '#f59a3c', card: '#f4ecd8', paper: '#ffffff',
  'heat-0': '#2b1b5e', 'heat-1': '#2c8fd6', 'heat-2': '#33c3b0', 'heat-3': '#8fd64a',
  'heat-4': '#f2e34c', 'heat-5': '#f59a3c', 'heat-6': '#ff3cc8', 'heat-7': '#9fe8ff',
};
export const HEAT = Array.from({ length: 8 }, (_, k) => `heat-${k}`);
export const hexRgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
export function look(ev = 0): JsonObject {
  const palette: JsonObject = { ...(PLAIN_LOOK['palette'] as JsonObject) };
  const roles: JsonObject = { ...(PLAIN_LOOK['roles'] as JsonObject) };
  for (const [role, h] of Object.entries(ROLES)) { palette[`c-${role}`] = h; roles[role] = `c-${role}`; }
  return { ...(PLAIN_LOOK as JsonObject), id: ev === 0 ? 'look-inset-plain' : 'look-inset-bright', description: 'The plain physical look for the inset fixtures.', palette, roles, exposure: -Math.log2(1.2) - ev };
}

export const WRITER = 'agent-a';
/** A whole scene document as a session holds it (#378): one writer layer `main`, every item in it, in the order given. */
export function doc3(id: string, title: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: an acceptance fixture for insets and overlays.`, size, camera: 'cam', seed: 506,
    transport: { span: '4s' }, requires: { modules: { scene3d: '^1', marks2d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The document with the items `drop` names taken out (and out of every collection). */
export function without(doc: JsonObject, drop: readonly string[]): JsonObject {
  const out = clone(doc);
  const items = obj(out['items'], 'items');
  for (const id of drop) delete items[id];
  if (isObject(out['collections'])) for (const c of Object.values(out['collections'])) if (isObject(c) && Array.isArray(c['members'])) c['members'] = c['members'].filter((m) => typeof m !== 'string' || !drop.includes(m));
  return out;
}
/** The document seen through another of its cameras. */
export const through = (doc: JsonObject, camera: string): JsonObject => ({ ...clone(doc), camera });

export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** An unlit, opaque, double-sided material of linear `color` (Material: `unlit`). */
export const unlit = (color: Rgb, extra: JsonObject = {}): JsonObject => material({ base_color: [...color, 1], unlit: true, double_sided: true, ...extra });
/** A lit material of linear `color`. */
export const lit = (color: Rgb, extra: JsonObject = {}): JsonObject => material({ base_color: [...color, 1], roughness: 0.7, ...extra });
/** A role's color as a linear base color, so a material draws what the role paints. */
export const linearOf = (role: string): Rgb => hexRgb(ROLES[role]!).map(decode8) as Rgb;
export const box = (size: V3, pos: V3, mat: string, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat, ...extra });
export const ballItem = (radius: number, pos: V3, mat: string, extra: JsonObject = {}): JsonObject => ({ kind: 'ball@1', params: { radius, segments: 128 }, at: { pos }, material: mat, ...extra });
/** A sun (`light.sun@1`) at `elevation` degrees above the horizon from `azimuth`, shining along its own −Z, no shadow. */
export const sunItem = (illuminance: number, elevation: number, azimuth = 30): JsonObject =>
  ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot: [-elevation, azimuth, 0] } });
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } };
export function linear(target: string, keys: readonly (readonly [number, number])[], interp: 'linear' | 'hold' = 'linear'): JsonObject {
  return { target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: `${t}s`, value, interp }])) };
}
export function linear3(target: string, keys: readonly (readonly [number, V3])[]): JsonObject {
  return { target, type: 'vec3', keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: `${t}s`, value: [...value], interp: 'linear' }])) };
}
/** A keyed value at t (linear between keys, held outside them). */
export function keyed(keys: readonly (readonly [number, number])[], t: number): number {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 0; i + 1 < keys.length; i++) {
    const [t0, v0] = keys[i]!; const [t1, v1] = keys[i + 1]!;
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return keys[keys.length - 1]![1];
}
/** A 2D content entry of an inset (README: Document fields): its kind, order key, params and optional role. */
export const entry = (kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ kind, order, params, ...extra });
export const rect2 = (order: string, b: [number, number, number, number], role: string, extra: JsonObject = {}): JsonObject =>
  entry('rect@1', order, { box: b, paint: { fill: { role } } }, extra);
/** An `inset@1` item (README: Document fields). */
export const inset = (params: JsonObject, extra: JsonObject = {}): JsonObject => ({ kind: 'inset@1', params, ...extra });

// ---------------------------------------------------------------------------------------------------
// Criterion 1: a screen set into a display's face, moved and taken apart; a second-camera inset

/**
 * The display (`display@1`, size 0.8 × 0.5 m, bezel 0.02 m): its `screen` part is the window, 0.76 × 0.46 m, centred on
 * the item's origin in the plane z = 0.0201 m of its own space (the base's display builder: half its 0.04 m depth plus
 * 0.1 mm), facing +Z. The inset fills it at 400 px a metre (304 × 184 texels).
 */
export const SCREEN = { size: [0.8, 0.5] as [number, number], bezel: 0.02, window: [0.76, 0.46] as [number, number], z: 0.0201, ppu: 400, tex: [304, 184] as [number, number] } as const;
/**
 * The masked screen (`screenDoc`): a stand (assembly `base`) and the display `monitor` (assembly `stage`, parent
 * `base`, apart (0, 0.5, 0.4) m) at (0, 1.2, 0), turned about +Y from −20° at 0 s to 20° at 4 s; the take-apart moves
 * `stage` apart from 1 s to 1.5 s and back from 3 s to 3.5 s (a follow with a 0.5 s linear transition, #504's form).
 * Its inset's content overflows the window on every side: a `glow` ground from (−200, −200) to (504, 384) texels and a
 * `beacon` bar across the left edge. Unlit materials, so the window shows the content's colors exactly.
 */
export const MASKED = { monitor: [0, 1.2, 0] as V3, apart: [0, 0.5, 0.4] as V3, turn: [[0, -20], [4, 20]] as [number, number][], fps: 10, frames: 40 } as const;
export const MASKED_CAM: Cam = { kind: 'perspective', position: [0.6, 1.6, 3.4], target: [0, 1.4, 0.1], fov: 40, size: [480, 360] };
/** The take-apart's share of `stage`'s apart vector at t s. */
export function apartShare(t: number): number {
  if (t < 1) return 0;
  if (t < 1.5) return (t - 1) / 0.5;
  if (t < 3) return 1;
  if (t < 3.5) return 1 - (t - 3) / 0.5;
  return 0;
}
export function screenDoc(): JsonObject {
  const [tw, th] = SCREEN.tex;
  return doc3('inset-masked', 'A screen in a display face', MASKED_CAM.size, {
    cam: cameraItem(MASKED_CAM), sky: DARK_SKY,
    'white-mat': unlit([1, 1, 1]), 'stand-mat': unlit([0.3, 0.3, 0.3]),
    stand: box([0.3, 0.9, 0.3], [0, 0.45, 0], 'stand-mat', { parent: 'base' }),
    monitor: { kind: 'display@1', params: { size: [...SCREEN.size], bezel: SCREEN.bezel }, at: { pos: [...MASKED.monitor], rot: [0, -20, 0] }, material: 'white-mat', parent: 'stage' },
    'monitor-inset': inset({
      face: 'monitor#screen', size: [...SCREEN.window], px_per_unit: SCREEN.ppu, overflow: 'mask',
      content: { ground: rect2('a0', [-200, -200, tw + 400, th + 400], 'glow'), bar: rect2('a1', [-60, 60, 160, 50], 'beacon') },
    }),
  }, {
    assemblies: {
      base: { parent: null, at: { pos: [0, 0, 0] }, apart: [0, 0, 0], order: 0, value: 0 },
      stage: { parent: 'base', at: { pos: [0, 0, 0] }, apart: [...MASKED.apart], order: 1, value: 0 },
    },
    channels: {
      turn: linear('items/monitor/at/rot/1', MASKED.turn),
      take: {
        target: 'assemblies/apart', type: 'f32', mode: 'follow',
        follow: {
          source: { keys: { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: '1s', value: 1, interp: 'hold' }, k2: { t: '3s', value: 0, interp: 'hold' } } },
          model: { transition: { span: '0.5s', interp: 'linear' } }, stagger: { targets: ['stage'], lag: '0.25s', order: 'index' },
        },
      },
    },
  });
}
/** The window's four corners in the frame at t s (world: the take-apart's offset, then the display's own pose). */
export function windowQuad(t: number): [number, number][] {
  const [w, h] = SCREEN.window;
  const yaw = keyed(MASKED.turn, t);
  const origin = add(scale(MASKED.apart, apartShare(t)), MASKED.monitor);
  return ([[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2]] as const).map(([x, y]) => {
    const p = toScreen(MASKED_CAM, add(origin, rotate([0, yaw, 0], [x, y, SCREEN.z])));
    return [p.x, p.y] as [number, number];
  });
}
/** Whether a pixel shows the screen's content: the `glow` ground or the `beacon` bar, or a blend of either with the body or the sky. */
export const contentPixel = ([r, g, b]: Rgb): boolean => (g >= 140 && g - r >= 70 && g - b >= 50) || (b >= 170 && b - r >= 100 && b - g >= 30);

/**
 * The second-camera inset (`feedDoc`): the display `feed` at the origin facing +Z, seen straight on by an orthographic
 * main camera 1 m across 480 px; its inset shows the collection `shown` from the camera `side` (perspective at
 * (50, 1, 8) aimed at (50, 1, 0), fov 40°): a red ball 0.3 m in radius rolling along x from 48 to 52 m over 4 s before a
 * grey wall, all unlit. The main camera never sees the ball itself.
 */
export const FEED = { side: { kind: 'perspective', position: [50, 1, 8], target: [50, 1, 0], fov: 40, size: [...SCREEN.tex] } as Cam, ball: [[0, 48], [4, 52]] as [number, number][], radius: 0.3, fps: 10, frames: 40 } as const;
export const FEED_CAM: Cam = { kind: 'orthographic', position: [0, 0, 20], target: [0, 0, 0], viewWidth: 1, size: [480, 360] };
export function feedDoc(): JsonObject {
  return doc3('inset-second-camera', 'A screen showing a second camera', FEED_CAM.size, {
    cam: cameraItem(FEED_CAM), side: cameraItem(FEED.side), sky: DARK_SKY,
    'white-mat': unlit([1, 1, 1]), 'red-mat': unlit([0.8, 0.05, 0.05]), 'grey-mat': unlit([0.2, 0.2, 0.2]),
    feed: { kind: 'display@1', params: { size: [...SCREEN.size], bezel: SCREEN.bezel }, at: { pos: [0, 0, 0] }, material: 'white-mat' },
    'feed-inset': inset({ face: 'feed#screen', size: [...SCREEN.window], px_per_unit: SCREEN.ppu, view: { camera: 'side', include: ['shown'] } }),
    ball: ballItem(FEED.radius, [48, 1, 0], 'red-mat'),
    backwall: box([20, 10, 0.2], [50, 1, -2], 'grey-mat'),
  }, { collections: { shown: { members: ['ball', 'backwall'] } }, channels: { roll: linear('items/ball/at/pos/0', FEED.ball) } });
}
/** The window's rect in the main frame, [x0, y0, x1, y1] px (an orthographic view: the face's plane doesn't move it). */
export function feedWindow(): [number, number, number, number] {
  const [w, h] = SCREEN.window;
  const a = toScreen(FEED_CAM, [-w / 2, h / 2, SCREEN.z]); const b = toScreen(FEED_CAM, [w / 2, -h / 2, SCREEN.z]);
  return [a.x, a.y, b.x, b.y];
}
/** Where the ball's centre shows in the main frame at t s: the side camera's projection in the inset's texels, mapped onto the window. */
export function feedBall(t: number): [number, number] {
  const p = toScreen(FEED.side, [keyed(FEED.ball, t), 1, 0]);
  const [x0, y0, x1, y1] = feedWindow();
  return [x0 + (p.x * (x1 - x0)) / SCREEN.tex[0], y0 + (p.y * (y1 - y0)) / SCREEN.tex[1]];
}
/** The redness of a pixel against the grey wall: 0 for grey, 1 for the ball's red, between for a blend. */
export const redness = ([r, g]: Rgb): number => clamp01((r - g) / (code8(0.8) - code8(0.05)));
/** The redness-weighted centroid of the pixels a test keeps, px (pixel centres at + 0.5), and its weight. */
export function redCentroid(im: Image, keep: (x: number, y: number) => boolean): { x: number; y: number; weight: number } {
  let sx = 0; let sy = 0; let sw = 0;
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    if (!keep(x, y)) continue;
    const w = redness(px(im, x, y));
    if (w <= 0.02) continue;
    sx += w * (x + 0.5); sy += w * (y + 0.5); sw += w;
  }
  return { x: sx / sw, y: sy / sw, weight: sw };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: a heatmap projected down onto a glTF terrain

/**
 * The terrain: a heightfield written as a JSON glTF, 128 × 128 m on a 1 m grid centred on the origin (129 × 129
 * vertices, two triangles a cell, positions as f32), y = 20 sin(kx) sin(kz) with k = tan 60° ÷ 20, so its relief is
 * 40 m and its slopes reach 60°. The heatmap's box: 64 × 64 m centred on the origin, 64 × 64 cells of 1 m, at
 * 4 px a metre (256 × 256 texels; a texel is 0.25 m); cell (i, j) spans x from −32 + i, z from −32 + j, texels
 * (4i, 4j) to (4i + 4, 4j + 4) (u along +x, v along +z), painted `heat-((i + 3j) mod 8)`, every cell an item of role
 * `data`. The tree: a 0.5 × 8 × 0.5 m box standing on the cell corner (10, h(10, 10) + 4, 10), inside the box and outside
 * `onto`, thin enough that each cell around it keeps its middle in view.
 */
export const TERRAIN = { half: 64, cells: 128, k: Math.tan(rad(60)) / 20, amp: 20, box: 64, n: 64, ppu: 4, texel: 0.25 } as const;
export const terrainHeight = (x: number, z: number): number => TERRAIN.amp * Math.sin(TERRAIN.k * x) * Math.sin(TERRAIN.k * z);
export const TREE = { size: [0.5, 8, 0.5] as V3, pos: [10, terrainHeight(10, 10) + 4, 10] as V3 };
export interface Terrain { mesh: Mesh; heights: Float32Array }
export function terrainMesh(): Terrain {
  const n = TERRAIN.cells;
  const heights = new Float32Array((n + 1) * (n + 1));
  const positions: V3[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -TERRAIN.half + i; const z = -TERRAIN.half + j;
    const y = Math.fround(terrainHeight(x, z));
    heights[j * (n + 1) + i] = y;
    positions.push([x, y, z]);
  }
  const triangles: [number, number, number][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i; const b = a + 1; const c = a + n + 1; const d = c + 1;
    triangles.push([a, d, b], [a, c, d]);
  }
  return { mesh: { positions, triangles }, heights };
}
/** The mesh's relief (m) and its steepest triangle (degrees from level). */
export function terrainShape(t: Terrain): { relief: number; steepest: number } {
  const ys = t.mesh.positions.map((p) => p[1]);
  let steepest = 0;
  for (const [a, b, c] of t.mesh.triangles) {
    const pa = t.mesh.positions[a]!; const pb = t.mesh.positions[b]!; const pc = t.mesh.positions[c]!;
    const nrm = unit(cross(sub(pb, pa), sub(pc, pa)));
    steepest = Math.max(steepest, (Math.acos(Math.abs(nrm[1])) * 180) / Math.PI);
  }
  return { relief: Math.max(...ys) - Math.min(...ys), steepest };
}
/** The first point where a ray meets the terrain's triangles (walking its cells in order along the ray), or null. */
export function terrainHit(t: Terrain, o: V3, d: V3): { dist: number; p: V3 } | null {
  const n = TERRAIN.cells; const H = TERRAIN.half;
  const lo = -TERRAIN.amp - 0.5; const hi = TERRAIN.amp + 0.5;
  let t0 = 0; let t1 = Infinity;
  for (const [k, a, b] of [[0, -H, H], [1, lo, hi], [2, -H, H]] as const) {
    if (Math.abs(d[k]) < 1e-15) { if (o[k] < a || o[k] > b) return null; continue; }
    let u = (a - o[k]) / d[k]; let v = (b - o[k]) / d[k];
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
  }
  if (t0 > t1) return null;
  const start = add(o, scale(d, t0 + 1e-9));
  let i = Math.min(n - 1, Math.max(0, Math.floor(start[0] + H)));
  let j = Math.min(n - 1, Math.max(0, Math.floor(start[2] + H)));
  const sx = Math.sign(d[0]); const sz = Math.sign(d[2]);
  let nextX = sx === 0 ? Infinity : (i + (sx > 0 ? 1 : 0) - H - o[0]) / d[0];
  let nextZ = sz === 0 ? Infinity : (j + (sz > 0 ? 1 : 0) - H - o[2]) / d[2];
  const stepX = sx === 0 ? Infinity : Math.abs(1 / d[0]); const stepZ = sz === 0 ? Infinity : Math.abs(1 / d[2]);
  const P = (ii: number, jj: number): V3 => [ii - H, t.heights[jj * (n + 1) + ii]!, jj - H];
  for (let guard = 0; guard < 4 * n; guard++) {
    if (i < 0 || j < 0 || i >= n || j >= n) return null;
    const a = P(i, j); const b = P(i + 1, j); const c = P(i, j + 1); const e = P(i + 1, j + 1);
    const hits = [hitTriangle(o, d, a, e, b), hitTriangle(o, d, a, c, e)].filter((x): x is number => x !== null);
    if (hits.length) { const dist = Math.min(...hits); return { dist, p: add(o, scale(d, dist)) }; }
    if (Math.min(nextX, nextZ) > t1) return null;
    if (nextX < nextZ) { i += sx; nextX += stepX; } else { j += sz; nextZ += stepZ; }
  }
  return null;
}
/** The terrain glTF written into `dir`: its hash and path (view3d's `assets`). */
export function writeTerrain(dir: string, t: Terrain): { sha: string; path: string } {
  const g = gltf(t.mesh);
  const path = join(dir, `${g.sha}.gltf`);
  writeFileSync(path, g.bytes);
  return { sha: g.sha, path };
}
export const cellRole = (i: number, j: number): string => HEAT[(i + 3 * j) % 8]!;
/** The two views of the terrain: perspective, 65° above the horizon, 120 m from the origin, from +Z (A) and from −Z (B). */
export const TERRAIN_SIZE: [number, number] = [800, 600];
export const terrainCam = (azimuth: 0 | 180): Cam => ({ kind: 'perspective', position: orbitPosition([0, 0, 0], 120, azimuth, 65), target: [0, 0, 0], fov: 40, size: TERRAIN_SIZE });
/** The terrain under a sun at `sun` degrees (3 lx, from azimuth 30°) and a day sky; with `heatmap`, the projected inset. */
export function terrainDoc(sha: string, opts: { view: 0 | 180; sun: number; heatmap: boolean }): JsonObject {
  const content: JsonObject = {};
  for (let j = 0; j < TERRAIN.n; j++) for (let i = 0; i < TERRAIN.n; i++) {
    content[`cell-${i}-${j}`] = rect2(`a${String(j * TERRAIN.n + i).padStart(4, '0')}`, [4 * i, 4 * j, 4, 4], cellRole(i, j), { role: 'data' });
  }
  const items: Record<string, JsonObject> = {
    cam: cameraItem(terrainCam(opts.view)), sky: DAY_SKY, sun: sunItem(3, opts.sun),
    'ground-mat': lit([0.32, 0.36, 0.24], { roughness: 0.9, double_sided: true }), 'bark-mat': lit([0.3, 0.18, 0.08]),
    terrain: { kind: 'mesh.asset@1', params: { sha256: sha, node: 0 }, at: { pos: [0, 0, 0] }, material: 'ground-mat' },
    tree: box(TREE.size, TREE.pos, 'bark-mat'),
  };
  if (opts.heatmap) {
    items['heatmap'] = inset({
      size: [TERRAIN.box, TERRAIN.box], px_per_unit: TERRAIN.ppu, content,
      project: { onto: 'terrain', from: 'down', depth: 'auto', fade: { edge: 0, angle: 75 } },
    }, { at: { pos: [0, 0, 0] } });
  }
  return doc3(`terrain-${opts.heatmap ? 'heatmap' : 'bare'}`, opts.heatmap ? 'A heatmap draped on terrain' : 'Bare terrain', TERRAIN_SIZE, items);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: a projected inset given only its content and size, draped onto its parent

/**
 * A ball 0.8 m in radius resting on a 6 × 6 m floor (top at y = 0), lit by a 3 lx sun 50° up and a day sky, seen from
 * 4.5 m at 45° (480 × 360). The inset `drape` is the ball's child with only `size: [4, 4]`, `content` (one `tint` rect
 * far larger than any texture) and `project: {}`; with `data`, its rect carries role `data`.
 */
export const LID = { centre: [0, 0.8, 0] as V3, radius: 0.8 } as const;
export const LID_CAM: Cam = { kind: 'perspective', position: orbitPosition([0, 0.6, 0], 4.5, 30, 45), target: [0, 0.6, 0], fov: 40, size: [480, 360] };
export function lidDoc(variant: 'lit' | 'data' | 'bare' | 'painted'): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: cameraItem(LID_CAM), sky: DAY_SKY, sun: sunItem(3, 50),
    'floor-mat': lit([0.25, 0.27, 0.3]), 'lid-mat': lit(variant === 'painted' ? linearOf('tint') : [0.55, 0.55, 0.6], { roughness: 0.5 }),
    floor: box([6, 0.1, 6], [0, -0.05, 0], 'floor-mat'),
    lid: ballItem(LID.radius, [...LID.centre], 'lid-mat'),
  };
  if (variant === 'lit' || variant === 'data') {
    items['drape'] = inset({ size: [4, 4], content: { fill: rect2('a0', [-100_000, -100_000, 200_000, 200_000], 'tint', variant === 'data' ? { role: 'data' } : {}) }, project: {} }, { parent: 'lid' });
  }
  return doc3(`lid-${variant}`, 'A lid under a draped layer', LID_CAM.size, items);
}
/** A floor with `count` projected insets on it, each its own 0.5 m box on the floor, all in one view. */
export function crowdDoc(count: number): JsonObject {
  const items: Record<string, JsonObject> = { cam: cameraItem(LID_CAM), sky: DAY_SKY, sun: sunItem(3, 50), 'floor-mat': lit([0.25, 0.27, 0.3]), floor: box([6, 0.1, 6], [0, -0.05, 0], 'floor-mat') };
  for (let k = 0; k < count; k++) {
    items[`patch-${k + 1}`] = inset({ size: [0.5, 0.5], content: { fill: rect2('a0', [-100_000, -100_000, 200_000, 200_000], 'tint') }, project: { onto: 'floor' } }, { at: { pos: [-1.2 + 0.8 * (k % 4), 0, -1.2 + 0.8 * Math.floor(k / 4)] } });
  }
  return doc3(`crowd-${count}`, 'Projected patches on a floor', LID_CAM.size, items);
}
export const PATCHES = (count: number): string[] => Array.from({ length: count }, (_, k) => `patch-${k + 1}`);

// ---------------------------------------------------------------------------------------------------
// Criterion 4: a film with a view overlay in the bottom-right quarter of the safe frame

/**
 * The film (640 × 360, safe 24 px, 4 s): a floor, the kept box `hero` standing up and left of centre, a box turning
 * about +Y and a ball sliding along x, under a 3 lx sun and a day sky; the main shot `main` holds the camera's own
 * pose (perspective, 8 m from (0, 1, 0), 4.3° up, fov 40°). The view overlay `pip` (`overlay.view@1`) shows the
 * collection `stage` (every drawn item and the lights) from `pip-cam` (9 m from (0, 0.8, 0), azimuth 70°, 25° up, fov
 * 45°) at size [0.5, 0.5] of the safe frame, anchored by default: the bottom-right quarter of the safe frame,
 * x 320 to 616 px, y 180 to 336 px. With `wander`, a channel carries `hero` into that quarter from 2 s to 3 s.
 */
export const FILM = { size: [640, 360] as [number, number], safe: 24, rect: [320, 180, 296, 156] as [number, number, number, number], fps: 2, sampled: [1, 3, 5, 7] } as const;
const MAIN_ORBIT = { target: [0, 1, 0] as V3, azimuth: 0, elevation: 4.3, distance: 8 };
const PIP_ORBIT = { target: [0, 0.8, 0] as V3, azimuth: 70, elevation: 25, distance: 9 };
const orbitCamItem = (o: typeof MAIN_ORBIT, fov: number): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', target: [...o.target], orbit: { azimuth: o.azimuth, elevation: o.elevation, distance: o.distance }, fov, near: 0.05, far: 500 } });
export function filmDoc(opts: { pip?: boolean; wander?: boolean; nested?: boolean } = {}): JsonObject {
  const pip = opts.pip ?? true;
  const items: Record<string, JsonObject> = {
    cam: orbitCamItem(MAIN_ORBIT, 40), 'pip-cam': orbitCamItem(PIP_ORBIT, 45), sky: DAY_SKY, sun: sunItem(3, 40),
    'floor-mat': lit([0.3, 0.32, 0.35]), 'hero-mat': lit([0.75, 0.2, 0.15]), 'spin-mat': lit([0.2, 0.45, 0.7]), 'ball-mat': lit([0.85, 0.75, 0.2]),
    floor: box([12, 0.1, 12], [0, -0.05, 0], 'floor-mat'),
    hero: box([0.6, 1, 0.6], [-1.7, 1.5, 0], 'hero-mat'),
    spinner: { ...box([0.8, 0.8, 0.8], [0.6, 0.4, -0.8], 'spin-mat'), at: { pos: [0.6, 0.4, -0.8], rot: [0, 0, 0] } },
    roller: ballItem(0.3, [-1, 0.3, 1], 'ball-mat'),
  };
  const members = ['sky', 'sun', 'floor', 'hero', 'spinner', 'roller'];
  if (pip) items['pip'] = { kind: 'overlay.view@1', params: { camera: 'pip-cam', include: ['stage'], size: [0.5, 0.5], border: 'ink' } };
  if (opts.nested) {
    items['pip2'] = { kind: 'overlay.view@1', params: { camera: 'cam', include: ['stage'], size: [0.3, 0.3] } };
    members.push('pip2');
  }
  const channels: JsonObject = { spin: linear('items/spinner/at/rot/1', [[0, 0], [4, 180]]), roll: linear('items/roller/at/pos/0', [[0, -1], [4, 1.2]]) };
  if (opts.wander) channels['wander'] = linear3('items/hero/at/pos', [[0, [-1.7, 1.5, 0]], [2, [-1.7, 1.5, 0]], [3, [1.9, 0.6, 0]], [4, [1.9, 0.6, 0]]]);
  return doc3(`film-${pip ? 'pip' : 'plain'}${opts.wander ? '-wander' : ''}${opts.nested ? '-nested' : ''}`, 'A film with a picture in picture', FILM.size, items, {
    safe: FILM.safe, collections: { stage: { members } }, channels,
    shots: { main: { start: '0s', end: '4s', camera: 'cam', move: 'hold', target: [...MAIN_ORBIT.target], orbit: { azimuth: MAIN_ORBIT.azimuth, elevation: MAIN_ORBIT.elevation, distance: MAIN_ORBIT.distance } } },
  });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: a card anchored to a lamp, over a sofa, through an orbit and a fly-through

/**
 * The room (640 × 360): a floor, the lamp (0.3 × 1.4 × 0.3 m at (0, 0.7, 0)) and the sofa (2.4 × 1 × 0.9 m at
 * (0, 0.5, 2)), lit by a 3 lx sun and a day sky. The card is `overlay.frame@1` `card` holding the 2D frame
 * `card-frame` (160 × 100 px): its background `card-bg` (role `card`), its title `card-title` ("Reading lamp"), its
 * image `card-image` (a 64 × 48 PNG made here) and its close button `card-close`, anchored to the lamp's point (0, 0, 0)
 * (world (0, 0.7, 0)) at offset (0, 0): the frame's top left corner sits on the point's projection. The close button
 * is the view-class toggle control `close-card` (role button, label Close), bound to `items/card/visible`, default on,
 * drawn by `card-close` (its `handle.item`).
 */
export const ROOM = { anchor: [0, 0.7, 0] as V3, sofa: { size: [2.4, 1, 0.9] as V3, pos: [0, 0.5, 2] as V3 }, card: [160, 100] as [number, number], size: [640, 360] as [number, number] } as const;
/** The orbit: the camera circles (0.8, 0.7, 0.3) at 6 m, 5° up, its azimuth from 0° to 360° over 12 s; 120 frames at 10 fps. */
export const ORBIT = { target: [0.8, 0.7, 0.3] as V3, distance: 6, elevation: 5, fov: 50, span: 12, fps: 10, frames: 120 } as const;
export const orbitCam = (n: number): Cam => {
  const s = frameSeconds(n, ORBIT.fps);
  return { kind: 'perspective', position: orbitPosition(ORBIT.target, ORBIT.distance, (360 * s) / ORBIT.span, ORBIT.elevation), target: ORBIT.target, fov: ORBIT.fov, size: ROOM.size };
};
/** The fly-through: the camera flies along z from 6 m to −6 m at x 0.4, y 1.2 over 4 s, aimed 4 m ahead and 0.2 m down; 60 frames at 15 fps. */
export const FLY = { from: [0.4, 1.2, 6] as V3, to: [0.4, 1.2, -6] as V3, ahead: [0, -0.2, -4] as V3, span: 4, fps: 15, frames: 60 } as const;
export const flyCam = (n: number): Cam => {
  const s = clamp01(frameSeconds(n, FLY.fps) / FLY.span);
  const position = add(FLY.from, scale(sub(FLY.to, FLY.from), s));
  return { kind: 'perspective', position, target: add(position, FLY.ahead), fov: ORBIT.fov, size: ROOM.size };
};
/** The card's image: a 64 × 48 PNG of a lamp shade's colors, opaque. */
export const cardImage = (): Buffer => encodeRgbaPng(64, 48, Uint8Array.from({ length: 64 * 48 * 4 }, (_, i) => [200, 160, 90, 255][i % 4]!));
export function roomDoc(imageSha: string, motion: 'orbit' | 'fly' | 'still', card = true): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: motion === 'fly'
      ? { kind: 'camera@1', params: { projection: 'perspective', position: [...FLY.from], target: add(FLY.from, FLY.ahead), fov: ORBIT.fov, near: 0.05, far: 500 } }
      : { kind: 'camera@1', params: { projection: 'perspective', target: [...ORBIT.target], orbit: { azimuth: 0, elevation: ORBIT.elevation, distance: ORBIT.distance }, fov: ORBIT.fov, near: 0.05, far: 500 } },
    sky: DAY_SKY, sun: sunItem(3, 40, 150),
    'floor-mat': lit([0.22, 0.24, 0.3]), 'lamp-mat': lit([0.15, 0.12, 0.1]), 'sofa-mat': lit([0.1, 0.35, 0.33]),
    floor: box([14, 0.1, 14], [0, -0.05, 0], 'floor-mat'),
    lamp: box([0.3, 1.4, 0.3], [...ROOM.anchor], 'lamp-mat'),
    sofa: box(ROOM.sofa.size, ROOM.sofa.pos, 'sofa-mat'),
  };
  if (card) {
    items['card-frame'] = { kind: 'frame@1', params: { box: [0, 0, ...ROOM.card] } };
    items['card-bg'] = { kind: 'rect@1', parent: 'card-frame', params: { box: [0, 0, ...ROOM.card], paint: { fill: { role: 'card' } } } };
    items['card-title'] = { kind: 'text@1', parent: 'card-frame', params: { text: 'Reading lamp', font: 'body', size: 14, box: { w: 112, h: 20 }, paint: { fill: { role: 'ink' } } }, at: { pos: [12, 10, 0] } };
    items['card-image'] = { kind: 'image@1', parent: 'card-frame', params: { asset: imageSha, box: [12, 36, 64, 48], fit: 'fill', alt: 'The lamp shade' } };
    items['card-close'] = { kind: 'rect@1', parent: 'card-frame', params: { box: [136, 8, 16, 16], paint: { fill: { role: 'ink' } } } };
    items['card'] = { kind: 'overlay.frame@1', params: { frame: 'card-frame', anchor: { item: 'lamp', point: [0, 0, 0] }, offset: [0, 0] } };
  }
  const extra: JsonObject = {};
  if (card) extra['controls'] = { 'close-card': { kind: 'toggle', class: 'view', label: 'Close', role: 'button', binds: ['items/card/visible'], default: true, handle: { item: 'card-close' } } };
  if (motion === 'orbit') { extra['transport'] = { span: `${ORBIT.span}s` }; extra['channels'] = { orbit: linear('items/cam/params/orbit/azimuth', [[0, 0], [ORBIT.span, 360]]) }; }
  if (motion === 'fly') {
    extra['transport'] = { span: `${FLY.span}s` };
    extra['channels'] = { fly: linear3('items/cam/params/position', [[0, FLY.from], [FLY.span, FLY.to]]), aim: linear3('items/cam/params/target', [[0, add(FLY.from, FLY.ahead)], [FLY.span, add(FLY.to, FLY.ahead)]]) };
  }
  return doc3(`room-${motion}${card ? '' : '-bare'}`, 'A card anchored to a lamp', ROOM.size, items, extra);
}
/** A spot on the card's background clear of its title, image and close button, px from the frame's top left. */
export const CARD_SPOT: [number, number] = [120, 70];

// ---------------------------------------------------------------------------------------------------
// Criterion 6: an eye inset in a wall, against a hole cut in it

/**
 * The wall: a 20 × 20 m slab 2 mm thick whose front face is the plane z = 0, facing +Z, unlit white; its anchor
 * `window` at (0, 0, 0) on the face. Behind it, `beyond` holds a red ball 0.1 m in radius at (0, 0, −3) and a grey
 * backdrop 12 × 12 m at z = −6, all unlit, under a black sky. The eye inset `portal` is 1 × 1 m on `wall#window` with
 * `view: {include: ["beyond"], map: "eye"}` at 1,024 px a metre. The hole's twin cuts a 1 × 1 m hole in the wall
 * (four slabs around it) and has no inset. With `through`, the inset looks out through `exit#out`, an anchor at
 * (10, 0, 0) turned 90° about +Y, and `beyond` is the ball at (7, 0, 0) and the backdrop at x = 4, turned with it: the
 * same relation to that anchor.
 */
export const EYE = { size: [1280, 960] as [number, number], ball: [0, 0, -3] as V3, radius: 0.1 } as const;
export const EYE_CAMERAS: V3[] = [[0, 0, 4], [1, 0.5, 4], [-0.8, -0.4, 3]];
export const eyeCam = (position: V3): Cam => ({ kind: 'perspective', position, target: [0, 0, 0], fov: 40, size: EYE.size });
export function eyeDoc(position: V3, variant: 'inset' | 'hole' | 'through' | 'named'): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: cameraItem(eyeCam(position)), sky: DARK_SKY,
    'white-mat': unlit([1, 1, 1]), 'red-mat': unlit([0.8, 0.05, 0.05]), 'grey-mat': unlit([0.25, 0.25, 0.25]),
  };
  const T = 0.002;
  if (variant === 'hole') {
    items['wall-left'] = box([9.5, 20, T], [-5.25, 0, -T / 2], 'white-mat');
    items['wall-right'] = box([9.5, 20, T], [5.25, 0, -T / 2], 'white-mat');
    items['wall-top'] = box([1, 9.5, T], [0, 5.25, -T / 2], 'white-mat');
    items['wall-bottom'] = box([1, 9.5, T], [0, -5.25, -T / 2], 'white-mat');
  } else {
    items['wall'] = box([20, 20, T], [0, 0, -T / 2], 'white-mat', { anchors: { window: { pos: [0, 0, T / 2], rot: [0, 0, 0] } } });
    const view: JsonObject = { include: ['beyond'], map: 'eye', depth: 1 };
    if (variant === 'through') view['through'] = 'exit#out';
    if (variant === 'named') view['camera'] = 'cam';
    items['portal'] = inset({ face: 'wall#window', size: [1, 1], px_per_unit: 1024, view });
  }
  if (variant === 'through') {
    items['exit'] = { kind: 'mark.box@1', params: { size: [0.1, 0.1, 0.1] }, at: { pos: [10, 0, 0], rot: [0, 90, 0] }, material: 'grey-mat', visible: false, anchors: { out: { pos: [0, 0, 0], rot: [0, 0, 0] } } };
    items['ball'] = ballItem(EYE.radius, [7, 0, 0], 'red-mat');
    items['backdrop'] = { ...box([12, 12, 0.1], [4, 0, 0], 'grey-mat'), at: { pos: [4, 0, 0], rot: [0, 90, 0] } };
  } else {
    items['ball'] = ballItem(EYE.radius, [...EYE.ball], 'red-mat');
    items['backdrop'] = box([12, 12, 0.1], [0, 0, -6], 'grey-mat');
  }
  return doc3(`eye-${variant}`, 'A window in a wall', EYE.size, items, { collections: { beyond: { members: ['ball', 'backdrop'] } } });
}
/** The window's four corners in the frame from `cam`. */
export const eyeWindow = (cam: Cam): [number, number][] =>
  ([[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]] as const).map(([x, y]) => { const p = toScreen(cam, [x, y, 0]); return [p.x, p.y] as [number, number]; });

// ---------------------------------------------------------------------------------------------------
// Criterion 7: a figure with a mirror, glass that reads the backdrop and forty lights, through two views

/**
 * The figure (640 × 360): a mirror floor (`plate@1` 8 × 8 m, metallic, roughness 0, `mirror` on its own plane), a glass
 * block (transmission 1, so it reads the backdrop) and three opaque blocks behind it, lit by 40 point lights of 120 lm
 * (no shadows) under a black sky: 20 in a row at z = 3 m on the main camera's side and 20 in a row at x = 3.2 m on
 * the overlay camera's side, warm and cool by turns. The main camera is orthographic (7 m across, from (0, 3.5, 10)
 * aimed at (0, 0.8, 0)); the view overlay `pip` is perspective from (9, 2.6, 1) aimed at (0, 0.8, 0), fov 40°, at
 * size [0.5, 0.5] of the safe frame: the bottom-right quarter, x 320 to 616 px, y 180 to 336 px. Each view keeps 32 of
 * the 40 lights, and their cuts differ.
 */
export const FIGURE = { size: [640, 360] as [number, number], rect: [320, 180, 296, 156] as [number, number, number, number] } as const;
export const FIGURE_MAIN: Cam = { kind: 'orthographic', position: [0, 3.5, 10], target: [0, 0.8, 0], viewWidth: 7, size: FIGURE.size };
export const FIGURE_PIP: Cam = { kind: 'perspective', position: [9, 2.6, 1], target: [0, 0.8, 0], fov: 40, size: [296, 156] };
/** Which state a pixel of the overlay's own render reads most: the mirror's floor, the glass's backdrop, else the light cut. */
export const STATE_OF: Record<string, string> = { floor: 'mirror', glass: 'backdrop' };
export function figureDoc(pip: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: cameraItem(FIGURE_MAIN), 'pip-cam': cameraItem(FIGURE_PIP), sky: DARK_SKY,
    'mirror-mat': material({ base_color: [0.9, 0.9, 0.92, 1], metallic: 1, roughness: 0, mirror: { strength: 1, blur: 0, plane: 'floor' } }),
    'glass-mat': material({ base_color: [1, 1, 1, 1], roughness: 0.02, transmission: 1, ior: 1.5 }),
    'red-mat': lit([0.7, 0.15, 0.1]), 'green-mat': lit([0.2, 0.6, 0.25]), 'blue-mat': lit([0.15, 0.3, 0.75]),
    floor: { kind: 'plate@1', params: { grid: [1, 1], size: [8, 8] }, at: { pos: [0, 0, 0], rot: [0, 0, 0] }, material: 'mirror-mat' },
    glass: box([0.9, 1.4, 0.9], [0.9, 0.7, 0.6], 'glass-mat'),
    'block-a': box([0.8, 1, 0.8], [-1.2, 0.5, -0.6], 'red-mat'),
    'block-b': box([0.8, 0.8, 0.8], [0.2, 0.4, -1.5], 'green-mat'),
    'block-c': box([0.6, 0.6, 0.6], [1.6, 0.3, -1.2], 'blue-mat'),
  };
  const members = ['sky', 'floor', 'glass', 'block-a', 'block-b', 'block-c'];
  for (let k = 0; k < 20; k++) {
    const color = k % 2 === 0 ? [1, 0.75, 0.5] : [0.55, 0.7, 1];
    items[`front-${k}`] = { kind: 'light.point@1', params: { power: 120, color, shadow: false }, at: { pos: [-2.85 + 0.3 * k, 1.8, 3] } };
    items[`side-${k}`] = { kind: 'light.point@1', params: { power: 120, color, shadow: false }, at: { pos: [3.2, 1.6, -2.85 + 0.3 * k] } };
    members.push(`front-${k}`, `side-${k}`);
  }
  if (pip) items['pip'] = { kind: 'overlay.view@1', params: { camera: 'pip-cam', include: ['figure'], size: [0.5, 0.5], border: 'ink' } };
  return doc3(`figure-${pip ? 'pip' : 'alone'}`, 'A figure seen from two sides', FIGURE.size, items, { safe: 24, collections: { figure: { members } } });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 8: a white disc at alpha 0.5 on a transparent ground, set into a black face

/**
 * A 1 × 1 × 0.1 m panel, unlit black, whose front face is the plane z = 0 (its anchor `front`), seen straight on by an
 * orthographic camera 1.25 m across 320 px: 256 px a metre, the face from px 32 to 288 on each axis, its edges on pixel
 * edges. The inset `disc-inset` fills the face at 256 px a metre, so texel (i, j) lies on pixel (32 + i, 32 + j); its
 * content is one `image@1` of the disc's PNG, made here: white, alpha 0.5 × the share of the texel inside a circle of
 * radius 80 texels about (128, 128) (16 × 16 samples a texel), straight alpha, 0 outside.
 */
export const DISC = { size: [320, 320] as [number, number], tex: 256, offset: 32, radius: 80 } as const;
export const DISC_CAM: Cam = { kind: 'orthographic', position: [0, 0, 10], target: [0, 0, 0], viewWidth: 1.25, size: DISC.size };
/** The disc's alpha, 0 to 255, at each texel (straight alpha; its color is white). */
export function discAlpha(): Uint8Array {
  const n = DISC.tex; const a = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let inside = 0;
    for (let sy = 0; sy < 16; sy++) for (let sx = 0; sx < 16; sx++) {
      const x = i + (sx + 0.5) / 16 - 128; const y = j + (sy + 0.5) / 16 - 128;
      if (x * x + y * y <= DISC.radius * DISC.radius) inside++;
    }
    a[j * n + i] = Math.round((0.5 * 255 * inside) / 256);
  }
  return a;
}
export const discPng = (alpha: Uint8Array): Buffer => encodeRgbaPng(DISC.tex, DISC.tex, Uint8Array.from({ length: alpha.length * 4 }, (_, k) => (k % 4 === 3 ? alpha[k >> 2]! : 255)));
/** The disc drawn directly on the black face: straight-alpha white over black in linear light, then sRGB, per texel. */
export const discDirect = (a8: number): number => code8(a8 / 255);
export function discDoc(sha: string): JsonObject {
  return doc3('disc-inset', 'A soft disc in a black face', DISC.size, {
    cam: cameraItem(DISC_CAM), sky: DARK_SKY, 'black-mat': unlit([0, 0, 0]),
    panel: box([1, 1, 0.1], [0, 0, -0.05], 'black-mat', { anchors: { front: { pos: [0, 0, 0.05], rot: [0, 0, 0] } } }),
    'disc-inset': inset({
      face: 'panel#front', size: [1, 1], px_per_unit: DISC.tex,
      content: { disc: entry('image@1', 'a0', { asset: sha, box: [0, 0, DISC.tex, DISC.tex], fit: 'fill', alt: 'A soft white disc' }) },
    }),
  });
}

// ---------------------------------------------------------------------------------------------------
// deep-show run: one scenario line in, one answer line out (#393), with stored documents (#96), claims and `verdict`
// (#403), and the interaction scope on #383's virtual clock (#504's Tab stops).

export function runShow(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  expect(timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  if (r.error) throw Error(`${what}: deep-show run: ${r.error.message}`);
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run takes the scenario: ${show(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}
const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: insets', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell (pid 3002): it acts as you. */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB506D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB506C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB506Q', n)}`;
/** A document as the hub stores it: alpha's writer layer `alpha-main`, every item in it. */
export function stored(doc: JsonObject): JsonObject {
  const out = clone(doc);
  out['layers'] = { 'alpha-main': { writer: `agent:${ALPHA.thread}`, title: ALPHA.name, order: 'a0' } };
  for (const item of Object.values(obj(out['items'], 'items'))) if (isObject(item)) item['layer'] = 'alpha-main';
  return out;
}
/** A document as a writer sends it: no `layers` and no item `layer`, which the hub stamps from the connection. */
export function strip(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) if (isObject(item)) delete item['layer'];
  return out;
}
export interface Scenario { evidence: string; panels: Record<string, [number, number, number, number]>; docs: Record<string, JsonObject>; claims?: JsonObject; clock?: JsonObject; calls: JsonObject[] }
export function scenarioOf(s: Scenario): JsonObject {
  const panels: JsonObject = {};
  for (const [p, rect] of Object.entries(s.panels)) panels[p] = { rect };
  return {
    evidence: s.evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: s.docs,
    ...(s.claims ? { claims: s.claims } : {}), ...(s.clock ? { clock: s.clock } : {}), calls: s.calls,
  };
}
/** Alpha's claim on one deliverable, its locked definition one requirement holding `check`. */
export const claimOf = (doc: string, req: string, check: JsonObject): JsonObject => ({ session: ALPHA.id, deliverables: [doc], requirements: [{ id: req, check }] });
/** Keeps `bytes` in the evidence store at `<first 2 hex>/<other 62 hex>` (deep-show's layout); its SHA-256. */
export function putEvidence(root: string, bytes: Uint8Array): string {
  const sha = sha256(bytes);
  mkdirSync(join(root, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}
export function getEvidence(root: string, sha: string, what: string): Buffer {
  expect(sha, `${what}: a SHA-256`).toMatch(SHA);
  const bytes = readFileSync(join(root, sha.slice(0, 2), sha.slice(2)));
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(sha);
  return bytes;
}
/** One requirement's row of a verdict: its result and the issues raised (errors and warnings), `ids` with sub-addresses read as their item. */
export interface Row { result: string; issues: { check: string; code: string; severity: string; ids: string[] }[]; raw: JsonObject }
export function rowOf(v: JsonObject, req: string, what: string): Row {
  const rows = Array.isArray(v['requirements']) ? v['requirements'].filter(isObject) : [];
  const raw = rows.find((r) => r['id'] === req);
  expect(raw, `${what}: the verdict has a row for its requirement: ${show(v)}`).toBeDefined();
  const issues = (Array.isArray(raw!['issues']) ? raw!['issues'] : []).filter(isObject).map((o) => ({
    check: typeof o['check'] === 'string' ? o['check'] : '', code: typeof o['code'] === 'string' ? o['code'] : '', severity: String(o['severity']),
    ids: (Array.isArray(o['ids']) ? o['ids'] : []).filter((x): x is string => typeof x === 'string').map((s) => s.split('#')[0]!),
  })).filter((i) => i.severity === 'error' || i.severity === 'warning');
  return { result: String(raw!['result']), issues, raw: raw! };
}
