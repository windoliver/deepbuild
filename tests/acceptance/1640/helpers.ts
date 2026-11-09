// Test-side tools for the #1640 acceptance tests: the binary the base already has for drawn mesh edges, `deep-gpu`
// (#377's GPU layer with #378's `view3d` and #420's mesh-edge `segments`), built once per file and driven by JSON
// lines; the fields and planted names this suite adds (README: The surface under test) and their replies; the
// documents the tests draw; the object-ID target; and the checks each criterion's wrong program must fail, which
// return their failures as sentences naming what failed. The CPU references are in reference.ts. Nothing here
// stands in for a builder, the mesh-edge reader, the GPU layer or its cache.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { weldKey, type V3 } from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1640 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #1640.b30fa4ba',
  2: 'AC2 #1640.1f4212e3',
  3: 'AC3 #1640.e3cdf8ce',
  4: 'AC4 #1640.4ab59ee2',
} as const;

/** The criteria's numbers (the issue's text). */
export const ANGLE = 30;
export const CUBE_SEGMENTS = 12;
export const CYLINDER_SEGMENTS = 64;
export const CYLINDER_SIDES = 32;
export const BALL_SEGMENTS = 0;
export const PLANE_BORDER = 4;
export const ASSET_TRIANGLES = 100_000;
/** "A 10 s orbit": 600 frames at 60 fps. */
export const ORBIT = { seconds: 10, fps: 60, frames: 600 } as const;

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

export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);
export function fixture(...parts: string[]): JsonObject {
  const value = JSON.parse(readFileSync(fixturePath(...parts), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${parts.join('/')} is not a JSON object`);
  return value;
}
/** The look the tests draw with (fixtures/look.json, a copy of #420's acceptance look). */
export const look = (): JsonObject => fixture('look.json');

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-gpu`, built once per file and copied out of the target folder under its own name.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
const BUILD = ['build', '--locked', '--bin', 'deep-gpu'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${BUILD.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** Builds `deep-gpu` before the file's tests; a test that uses it after a failed build fails with cargo's error. */
export function useGpuBin(): () => string {
  let dir = '';
  let bin = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1640-bin-'));
    error = cargoBuild();
    bin = join(dir, exe('deep-gpu'));
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), bin);
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${BUILD.join(' ')}`).toBe('');
    return bin;
  };
}

/** A fresh temporary folder per test (generated documents, assets, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1640-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Writes a file under `dir` and returns its absolute path. */
export function writeFile(dir: string, name: string, value: JsonValue | Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.isBuffer(value) ? value : JSON.stringify(value));
  return path;
}

/** Fails with an INCONCLUSIVE message off macOS: these pixels come from the GPU layer on Metal, the reference Mac. */
export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: the GPU layer draws this on macOS\'s Metal device, the reference Mac; this is not a pass').toBe('darwin');
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]` (#377): one JSON line in, one JSON line out.

/** `deep-gpu --planted` names: this suite's three and #420's `edges_skip_depth` (README: Planted programs). */
export type Planted = 'crease_below_angle' | 'edges_derive_every_frame' | 'edges_dash_other_space' | 'edges_skip_depth';
export interface Startup { backend?: 'noop'; planted?: Planted }
const startArgs = (s: Startup): string[] => ['run', ...(s.backend ? ['--backend', s.backend] : []), ...(s.planted ? ['--planted', s.planted] : [])];
export const startName = (s: Startup): string => `deep-gpu ${startArgs(s).join(' ')}`;

/** One scenario `{out, calls}`, accepted, with one reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] {
  const args = startArgs(startup);
  const name = startName(startup);
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const answer = obj(parsed, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}

/** A whole scene document as a session holds it (#378): one writer layer, every item in it. */
export function sessionDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `doc-1640-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, profile: 'scene', title,
    description: `${title}: a #1640 acceptance fixture.`, size: [640, 480], camera: 'cam', requires: { modules: { scene3d: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}

/** `edges` on `mark.line@1` (README: Documents): `kind: {crease: {angle}}`, with `border` beside it when given. */
export function creaseEdges(of: string, angle = ANGLE, border?: boolean): JsonObject {
  return { of, kind: { crease: { angle } }, ...(border === undefined ? {} : { border }) };
}
export interface LineSpec { edges: JsonObject; width?: number; size_space?: 'screen' | 'world'; dash?: number[] }
export function edgeLine(s: LineSpec): JsonObject {
  return {
    kind: 'mark.line@1',
    params: { edges: s.edges, width: s.width ?? 3, size_space: s.size_space ?? 'screen', ...(s.dash ? { dash: s.dash } : {}), paint: { fill: { role: 'accent' } } },
  };
}

export interface View3Call {
  doc: string; look: JsonObject; size: [number, number];
  frames?: number; fps?: number;
  targets?: ('final' | 'ids')[]; capture?: 'every' | number[]; counts?: boolean;
  assets?: Record<string, string>;
}
export const view3d = (c: View3Call): JsonObject => ({ call: 'view3d', ...(c as unknown as JsonObject) });

export interface Frame3 {
  frame: number; pixel_hash: string | null; ids: string | null; picks: Map<number, string> | null;
  /** #420: each mesh-edge line's drawn segments, in world metres (with `counts`). */
  segments: Map<string, [V3, V3][]> | null;
  /** This suite: each mesh-edge line, how many times this frame derived its edge set (with `counts`). */
  derived: Map<string, number> | null;
}
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
};
export function view3Reply(reply: JsonObject, what: string, frames: number): Frame3[] {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const list = arr(reply['frames'], `${what}: frames`).map((v, i): Frame3 => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    const pixel = f['pixel_hash'] === null || f['pixel_hash'] === undefined ? null : str(f['pixel_hash'], `${at}.pixel_hash`);
    let picks: Map<number, string> | null = null;
    if (f['picks'] !== undefined && f['picks'] !== null) {
      picks = new Map(Object.entries(obj(f['picks'], `${at}.picks`)).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    }
    let segments: Map<string, [V3, V3][]> | null = null;
    if (f['segments'] !== undefined && f['segments'] !== null) {
      segments = new Map(Object.entries(obj(f['segments'], `${at}.segments`)).map(([id, list]) => [id, arr(list, `${at}.segments[${id}]`).map((s, k): [V3, V3] => {
        const pair = arr(s, `${at}.segments[${id}][${k}]`);
        expect(pair.length, `${at}.segments[${id}][${k}] is [a, b]`).toBe(2);
        return [v3(pair[0], `${at}.segments[${id}][${k}][0]`), v3(pair[1], `${at}.segments[${id}][${k}][1]`)];
      })]));
    }
    let derived: Map<string, number> | null = null;
    if (f['edge_sets_derived'] !== undefined && f['edge_sets_derived'] !== null) {
      derived = new Map(Object.entries(obj(f['edge_sets_derived'], `${at}.edge_sets_derived`)).map(([id, n]) => [id, num(n, `${at}.edge_sets_derived[${id}]`)]));
    }
    return { frame: num(f['frame'], `${at}.frame`), pixel_hash: pixel, ids: f['ids'] === undefined || f['ids'] === null ? null : str(f['ids'], `${at}.ids`), picks, segments, derived };
  });
  expect(list.map((f) => f.frame), `${what}: frames 0 to ${frames - 1}, each once, in order`).toEqual(Array.from({ length: frames }, (_, i) => i));
  return list;
}

/** The segments a line drew in a frame, failing when the frame doesn't list them. */
export function segmentsOf(f: Frame3, id: string, what: string): [V3, V3][] {
  expect(f.segments, `${what}: frame ${f.frame} lists the segments each mesh-edge line drew (counts: true)`).not.toBeNull();
  const s = f.segments!.get(id);
  expect(s, `${what}: frame ${f.frame} lists ${id}'s segments (an empty list when it draws none); it lists ${JSON.stringify([...f.segments!.keys()])}`).toBeDefined();
  return s!;
}

/** A segment by its welded ends, in either order. */
export const segKey = (a: V3, b: V3): string => [weldKey(a), weldKey(b)].sort().join('|');

// ---------------------------------------------------------------------------------------------------
// PNG and the object-ID target (#378).

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
/** The object-ID target: pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws (#378). */
export function readIds(out: string, f: Frame3, what: string): Ids {
  expect(f.ids, `${what}: the ID target is written`).toMatch(SHA);
  const file = readFileSync(join(out, `${f.ids}.png`));
  expect(sha256(file), `${what}: the ID target's file hashes to its name`).toBe(f.ids);
  const png = decodePng(file);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const picks = f.picks!;
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : picks.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}
