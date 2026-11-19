// Test-side tools for the #1634 acceptance tests: the base's `deep-gpu` binary (#377's GPU layer with #378's `view3d`,
// #379's `live`, #421's light policy, #446's receivers, #485's light responses, #1903's `envelope_counts`), built once
// per file and driven by JSON lines, on macOS's Metal device or on wgpu's noop backend (`--backend noop`, the noop
// lane); the fields, reports and planted programs this suite adds (README: Assumed surfaces); the fixtures the criteria
// name (the street, the 100 lamps in one cluster, the lamps switched on, the hall, the room, the glow, the night city);
// PNG reading and animated PNG writing; and the perf lane's own five-run judge, run from scripts/benchmark.mjs in a
// child process. Copied in part from #485's, #486's, #468's and #968's helpers, since suites don't import each other.
// Nothing here stands in for the renderer, the light policy or the cluster pass: every value a test compares comes from
// a binary, every expected value from `reference.ts`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { EV_TODAY, orbitEye, type Lamp, type Pinhole, type V3 } from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Size = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1634 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #1634.d5f3a907', 2: 'AC2 #1634.1412aa03', 3: 'AC3 #1634.b847690e', 4: 'AC4 #1634.919ee285', 5: 'AC5 #1634.59464d5c',
  6: 'AC6 #1634.41f7525a', 7: 'AC7 #1634.e8a4deec', 8: 'AC8 #1634.5a35384c', 9: 'AC9 #1634.d613f0e8', 10: 'AC10 #1634.186fabe5',
} as const;

/** Generous: each file builds its binary in its first hook, and several draw 1920 × 1080 frames with a debug build. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value)}`).toBe(true);
  return value as JsonValue[];
}
export const objs = (v: JsonValue | undefined, what: string): JsonObject[] => arr(v, what).map((x, i) => obj(x, `${what}[${i}]`));
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${shown(value)}`).toBe('string');
  return value as string;
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${shown(value)}`).toBe(true);
  return value as number;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** No failures; the message lists the first 40. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that matches each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly (string | RegExp)[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    const hit = failures.some((f) => (typeof name === 'string' ? f.includes(name) : name.test(f)));
    expect(hit, `${what}: a failure names ${String(name)}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}
/** Writes `value` as JSON under `dir` and returns its absolute path. */
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
/** The GPU layer draws these pixels on macOS's Metal device; anywhere else the test is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}
/** Where the run keeps what a person reads: DEEPBUILD_EVIDENCE_DIR, else a folder under the temporary folder. */
export function evidenceDir(): string {
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-1634-evidence');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Runs the perf lane's own scripts/benchmark.mjs in a child process (its `fingerprint`, `judgeLimit` and
 * `validateBudgets`), so a budget is judged exactly as the lane judges it without importing the lane. */
export function lane(code: string, input: JsonValue = null): JsonValue {
  const script = `import * as b from ${JSON.stringify(join(REPO, 'scripts', 'benchmark.mjs'))};\nconst input = JSON.parse(process.argv[1]);\nconst out = await (async () => { ${code} })();\nprocess.stdout.write(JSON.stringify(out ?? null));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input)], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/benchmark.mjs ran: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as JsonValue;
}
/** The files scripts/lanes.mjs runs in `timed`, the local preflight's perf step, read in a child process. */
export function timedFiles(): string[] {
  const script = `import { timed } from ${JSON.stringify(join(REPO, 'scripts', 'lanes.mjs'))};\nprocess.stdout.write(JSON.stringify(timed));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
  expect(r.status, `scripts/lanes.mjs loaded: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as string[];
}
/** The one-minute load average, read at a timed run's start and end. */
export const load = (): number => loadavg()[0]!;
export interface Load { start: number; end: number }
/** The lane's verdict on five readings of `limit` taken under `loads` on this machine: PASS, FAIL or INCONCLUSIVE, by
 * its list of reference Macs, Low Power Mode, the thermal state, the macOS build and each run's load. Mains power is
 * reported in the fingerprint and never gates (README: Readings). */
export function judgeLimit(limit: number, runs: number[], loads: Load[]): JsonObject {
  return obj(lane('return b.judgeLimit({ limit: input.limit, runs: input.runs, fingerprint: { ...b.fingerprint(), power: "ac" }, loads: input.loads });', { limit, runs, loads: loads as unknown as JsonValue }), 'judgeLimit');
}
/** Why a timing can't count on this machine now (off the reference Macs, Low Power Mode, the thermal state, or loaded
 * past its cores, as the lane's `judgeLimit` reads them), or '' when it can. Nothing waits for it to change. */
export function timingProblem(): string {
  const l = load();
  const v = judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: l, end: l })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
/** Why this machine is no reference Mac (its model, chip and memory against the lane's list), or '' when it is one. A
 * count read on its device is the reference Mac's whatever its power, heat or load. */
export function offReferenceMac(): string {
  const v = obj(lane('return b.judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: { ...b.fingerprint(), power: "ac", lowPowerMode: false, thermalState: "nominal" }, loads: [0, 0, 0, 0, 0].map(() => ({ start: 0, end: 0 })) });'), 'judgeLimit on this machine');
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
/** The nearest-rank p95. */
export function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(0.95 * s.length) - 1)]!;
}
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ---------------------------------------------------------------------------------------------------
// Builds: cargo in this checkout, the pinned toolchain added to PATH (as #486's suite does, for a shell that has
// rustup's toolchains but no cargo on its PATH), no incremental cache and no debug info unless the caller says.

const targetDir = (): string => { const t = process.env['CARGO_TARGET_DIR']; return t ? resolve(REPO, t) : join(REPO, 'target'); };
/** Builds deep-gpu (the dev profile, or `--release`) and copies it into `dir`; returns the copy's path, or cargo's error. */
export function buildGpu(dir: string, release = false): { bin: string; error: string } {
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', 'deep-gpu'];
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  const env = { ...process.env, PATH: path, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  const bin = join(dir, release ? 'deep-gpu-release' : 'deep-gpu');
  if (run.error) return { bin, error: `cargo could not run: ${run.error.message}` };
  if (run.status !== 0) return { bin, error: `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}` };
  copyFileSync(join(targetDir(), release ? 'release' : 'debug', 'deep-gpu'), bin);
  return { bin, error: '' };
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = ''; let built = { bin: '', error: 'the build did not run' };
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1634-bin-')); built = buildGpu(dir); }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => { expect(built.error, 'the binary builds: cargo build --locked --bin deep-gpu').toBe(''); return built.bin; };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1634-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]`: one JSON line in, one JSON line out (#377).

/** The wrong programs this suite plants, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'fill_top_32' | 'cluster_arrival_order' | 'cluster_cap_by_list_order' | 'auto_range_fixed_cut';
/** Where a run draws: macOS's Metal device, or wgpu's noop backend (the noop lane: no GPU, the same documents, checks
 * and counts). */
export interface RunOptions { lane?: 'metal' | 'noop'; planted?: Planted; /** How long the process may run, ms (55 minutes unless given). */ timeoutMs?: number }

export function runGpu(bin: string, out: string, calls: JsonObject[], o: RunOptions = {}): JsonObject[] {
  const args = ['run', ...(o.lane === 'noop' ? ['--backend', 'noop'] : []), ...(o.planted ? ['--planted', o.planted] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: o.timeoutMs ?? 3_300_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = objs(answer['replies'], `${name}: replies`);
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
// view3d (#378) as at the base: targets `final` (the frame's 8-bit PNG, the pixels `pixel_hash` hashes), `linear` (the
// 3D writer layers' linear target, before exposure and the tone map) and `ids` (the object-ID target, with `picks`);
// `from` and `seeks` (#484); `light_cut` (#425); `timings` (#380); `patches`. Frame n is drawn at t = n ÷ fps. Added
// by this suite (README: Assumed surfaces): `clusters`, `light_cut.fill`, and the timed frame's `lights` and `estimate`.

export type Target = 'final' | 'linear' | 'ids';
export interface View3d {
  doc: string; look: JsonObject; size: Size; targets?: Target[]; frames?: number; fps?: number; from?: number; capture?: number[] | 'every';
  seeks?: { after: number; to: number }[]; light_cut?: boolean; clusters?: boolean; timings?: boolean;
}
export function view3dCall(v: View3d): JsonObject {
  const frames = v.frames ?? 1; const from = v.from ?? 0;
  return { call: 'view3d', frames, capture: Array.from({ length: frames }, (_, i) => from + i), ...(v as unknown as JsonObject) };
}
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash as string}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
/** The linear target (#378): little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export interface Linear { width: number; height: number; at: (x: number, y: number) => [number, number, number] }
function readLinear(out: string, hash: JsonValue | undefined, size: Size, what: string): Linear {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  return { width: size[0], height: size[1], at: (x, y) => { const o = (y * size[0] + x) * 16; return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)]; } };
}

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
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
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
function rows(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  return deflateSync(raw, { level: 9 });
}
/** An animated PNG of equal-sized frames at `fps`, looping (#968's encoder): a recording, from the canvas's own frames. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt32BE(0, 12); fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22); fctl[24] = 0; fctl[25] = 0;
    parts.push(chunk('fcTL', fctl));
    const data = rows(f);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws, named through `picks`. A
 * pixel takes the item any of its four samples covers (#1173). */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null }
function readIds(out: string, frame: JsonObject, what: string): Ids {
  const png = decodePng(readNamed(out, frame['ids'], 'png', `${what}: ids`));
  const picks = new Map(Object.entries(obj(frame['picks'], `${what}: picks, the item each pick ID stands for`)).map(([k, id]) => [Number(k), str(id, `${what}.picks[${k}]`)]));
  const items: (string | null)[] = new Array(png.width * png.height);
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items[i] = pick === 0 ? null : picks.get(pick) ?? `unknown:${pick}`;
  }
  return { width: png.width, height: png.height, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}
/** Whether every pixel within `r` px of (x, y) (a (2r + 1)² block) shows `id`: with r = 1 on a flat strip, pixel
 * (x, y) lies wholly on it, so its one shading sample is its centre's. */
export function within(ids: Ids, id: string, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ids.at(x + dx, y + dy) !== id) return false;
  return true;
}

/** One cluster's list as its pixels walk it (README: Assumed surfaces 5). */
export interface Cluster { cluster: [number, number, number]; name: string; lights: { light: string; weight: number }[] }
export const clusterName = (c: readonly number[]): string => `cluster [${c.join(', ')}]`;
function readClusters(v: JsonValue | undefined, what: string): Cluster[] {
  return objs(v, `${what}.clusters`).map((c, i) => {
    const at = arr(c['cluster'], `${what}.clusters[${i}].cluster`).map((n) => num(n, `${what}.clusters[${i}].cluster[]`));
    expect(at.length, `${what}.clusters[${i}].cluster is [tile column, tile row, slice]`).toBe(3);
    return {
      cluster: at as [number, number, number], name: clusterName(at),
      lights: objs(c['lights'], `${what}.clusters[${i}].lights`).map((l, k) => ({ light: str(l['light'], `${what}.clusters[${i}].lights[${k}].light`), weight: num(l['weight'], `${what}.clusters[${i}].lights[${k}].weight`) })),
    };
  });
}
/** The frame's fill lights as `light_cut` reports them (README: Assumed surfaces 4): each with its range in m. */
export function fillOf(f: Frame, what: string): { light: string; range: number }[] {
  expect(f.lightCut, `${what}: the frame reports its light_cut`).not.toBeNull();
  const fill = f.lightCut!['fill'];
  expect(fill, `${what}: light_cut.fill lists the fill lights the view shades: ${shown(f.lightCut)}`).toBeDefined();
  return objs(fill, `${what}: light_cut.fill`).map((l, i) => ({ light: str(l['light'], `${what}: light_cut.fill[${i}].light`), range: num(l['range'], `${what}: light_cut.fill[${i}].range`) }));
}

/** One drawn frame: what the call asked for, read and checked against its name. */
export interface Frame {
  frame: number; pixelHash: string | null; final: Buffer | null; linear: Linear | null; ids: Ids | null; notices: JsonObject[]; lightCut: JsonObject | null;
  clusters: Cluster[] | null; raw: JsonObject;
}
export function framesOf(out: string, reply: JsonObject, size: Size, what: string): Frame[] {
  answered(reply, what);
  return objs(reply['frames'], `${what}: frames`).map((f, i) => {
    const at = `${what}: frame ${String(f['frame'] ?? i)}`;
    return {
      frame: num(f['frame'], `${at}.frame`),
      pixelHash: typeof f['pixel_hash'] === 'string' ? f['pixel_hash'] : null,
      final: f['final'] === undefined ? null : readNamed(out, f['final'], 'png', `${at}: final`),
      linear: f['linear'] === undefined ? null : readLinear(out, f['linear'], size, `${at}: linear`),
      ids: f['ids'] === undefined ? null : readIds(out, f, at),
      notices: f['notices'] === undefined ? [] : objs(f['notices'], `${at}.notices`),
      lightCut: f['light_cut'] === undefined ? null : obj(f['light_cut'], `${at}.light_cut`),
      clusters: f['clusters'] === undefined ? null : readClusters(f['clusters'], at),
      raw: f,
    };
  });
}
export function frameAt(frames: Frame[], n: number, what: string): Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.slice(0, 12).map((x) => x.frame).join(', ')}…)`).toBeDefined();
  return f!;
}
/** A frame's notices of one code. */
export const noticesOf = (f: Frame, code: string): JsonObject[] => f.notices.filter((n) => n['code'] === code);

// ---------------------------------------------------------------------------------------------------
// `live` (#379) and `envelope_counts` (#1903) take a document as its writer sends it (#393's payload).

/** The document as a `live` session takes it: no `id`, no `layers`, no item `layer`. */
export function payload(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

const STATUS: JsonObject = { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' };
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1` (#421's shape) with the tone map and exposure (EV100) given and the look's ao off. */
export function look(tone: 'none' | 'filmic', exposure: number): JsonObject {
  return {
    id: `look-1634-${tone}-${exposure.toFixed(4)}`, format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #1634 acceptance look.',
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
    roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' }, themes: { light: {}, dark: {} },
    fonts: {
      body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
      mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    },
    tone_map: tone, exposure, finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
  };
}
/** Tone map none at the exposure whose scale 1 ÷ (1.2 × 2^EV100) is 1 (#378's and #421's acceptance look). */
export const PLAIN_LOOK = look('none', -Math.log2(1.2));

export const WRITER = 'agent:sess-1634';
export type BudgetClass = 'figure' | 'work_product' | 'showpiece' | 'export';
/** A scene document as a session holds it (#378): one writer layer, every item in it, created in the order given (each
 * takes the next order key). It names its budget class in `budget.class`, and requires effects when it holds a
 * material operator. */
export function sessionDoc(id: string, size: Size, cls: BudgetClass, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(5, '0')}`, layer: 'main', ...item };
  const operators = Object.values(items).some((i) => i['kind'] === 'gpu.material@1');
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1634 acceptance fixture.`, size, camera: 'cam', transport: { span: '30s' },
    requires: { modules: operators ? { scene3d: '^1', effects: '^1' } : { scene3d: '^1' } }, budget: { class: cls },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** #378's pinhole `camera@1`: fov across the wider side, +Y up. A perspective view has no far plane. */
export const cameraOf = (cam: Pinhole): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position: cam.position, target: cam.target, fov: cam.fov, near: cam.near } });
export const material = (params: JsonObject, op?: string): JsonObject => ({ kind: 'material@1', params: op ? { ...params, op } : params });
/** A matte of linear albedo `rho`: no specular lobe, so its radiance under an illuminance E is ρ E ÷ π. */
export const matte = (rho: number): JsonObject => material({ base_color: [rho, rho, rho, 1], roughness: 1, specular_level: 0 });
export const box = (size: V3, pos: V3, mat: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos }, material: mat });
/** A white `light.point@1`; `params` holds its `range`, `fill`, `receivers` and the rest. */
export const point = (power: number, pos: V3, params: JsonObject = {}): JsonObject => ({ kind: 'light.point@1', params: { power, color: [1, 1, 1], shadow: false, ...params }, at: { pos } });
/** A white `light.spot@1`, shining along its own −Z, aimed by `at.rot` (R = Rz·Ry·Rx, degrees). */
export const spot = (power: number, pos: V3, rot: V3, params: JsonObject = {}): JsonObject => ({ kind: 'light.spot@1', params: { power, color: [1, 1, 1], shadow: false, ...params }, at: { pos, rot } });
/** A fill light's fields (issue #1634: Scope): `fill: true`, never a shadow. */
export const FILL: JsonObject = { fill: true, shadow: false };
/** A black sky with no ambient and no environment: the document's lights are the only light. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A linear f32 channel through `keys` ([seconds, value]). */
export const linear = (target: string, keys: [number, number][]): JsonObject =>
  ({ target, type: 'f32', keys: Object.fromEntries(keys.map(([t, value], i) => [`k${i}`, { t: `${t}s`, value, interp: 'linear' }])) });
/** A seeded shuffle (a 32-bit linear congruential generator, Fisher–Yates): the same order every run. */
export function shuffled<T>(values: readonly T[], seed: number): T[] {
  const out = [...values]; let x = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    const j = Math.floor((x / 4294967296) * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The street (AC1, AC2, AC9, AC10): 512 point lamps `lamp_000` … `lamp_511`, 3 m above the middle of a straight road
// and 10 m apart, from x = −2,555 m to x = 2,555 m; a matte road of albedo 0.8, 20 m wide, its top at y = 0; a black
// sky. Each lamp is a fill light of 800 lm with a 6 m range, unless a test says otherwise. The document is in the
// work-product class at 1920 × 1080, in a look with no tone map at the exposure where an automatic range's cut is
// 0.05 lx (`EV_TODAY`), so a road point under 0.05 lx on a white surface sits under one 8-bit code value.

export const STREET = {
  size: [1920, 1080] as Size, lamps: 512, spacing: 10, height: 3, power: 800, range: 6, rho: 0.8, roadWidth: 20,
  /** The illuminance (lx) a road pixel counts as lit from: the cut at the fixture's exposure. */
  lit: 0.05, ev: EV_TODAY,
  /** The orbit (AC2, AC10): around a point of the road by the middle lamps, one turn in 10 s. */
  orbit: { target: [0, 1, 0] as V3, elevation: 12, distance: 40, fov: 60, near: 0.5, seconds: 10, turn: 360 },
};
export const lampId = (k: number): string => `lamp_${String(k).padStart(3, '0')}`;
/** The street's lamps as the CPU references read them; an automatic range is the one given. */
export function streetLamps(o: { power?: number; range?: number } = {}): Lamp[] {
  return Array.from({ length: STREET.lamps }, (_, k) => ({ id: lampId(k), pos: [STREET.spacing * k - 2555, STREET.height, 0] as V3, power: o.power ?? STREET.power, range: o.range ?? STREET.range }));
}
/** The street's measuring view: from 831 m off and 60° up, looking across the street, 2 px to the metre, so the 96
 * lamps about the middle are in the frame, the whole street lies at one view depth and the near plane sits before it.
 * (The whole street in one frame is 0.37 px to the metre, too coarse to hold a pixel to 1%: README, Not tested.) */
export const STREET_VIEW: Pinhole = { position: [0.37, 831.4 * Math.sin(Math.PI / 3), 831.4 * Math.cos(Math.PI / 3)], target: [0.37, 0, 0], fov: 60, size: STREET.size, near: 500 };
/** The orbit's eye at frame `n` of `fps`, as a pinhole. */
export function orbitView(n: number, fps: number, size: Size = STREET.size): Pinhole {
  const o = STREET.orbit;
  return { position: orbitEye(o.target, (o.turn * n) / fps / o.seconds, o.elevation, o.distance), target: o.target, fov: o.fov, size, near: o.near };
}
export interface StreetOptions {
  /** A fixed view, or the orbit. */
  camera: Pinhole | 'orbit';
  /** Each lamp's lumens (800) and range in m (6); `auto` leaves the range out, so it is automatic. */
  power?: number; range?: number | 'auto';
  /** `false` leaves `fill` off every lamp: key lights, under the policy's 32 (AC10's second street). */
  fill?: boolean;
  /** The order the lamps are created in: their indices, each once (AC2's shuffled street). */
  created?: number[];
  size?: Size;
}
export function streetDoc(name: string, o: StreetOptions): JsonObject {
  const orbit = STREET.orbit;
  const cam: JsonObject = o.camera === 'orbit'
    ? { kind: 'camera@1', params: { projection: 'perspective', target: orbit.target, orbit: { azimuth: 0, elevation: orbit.elevation, distance: orbit.distance }, fov: orbit.fov, near: orbit.near } }
    : cameraOf(o.camera);
  const items: Record<string, JsonObject> = { cam, sky: DARK_SKY, road_mat: matte(STREET.rho), road: box([5200, 0.2, STREET.roadWidth], [0, -0.1, 0], 'road_mat') };
  const lamps = streetLamps();
  const params: JsonObject = { ...(o.range === 'auto' ? {} : { range: o.range ?? STREET.range }), ...(o.fill === false ? { shadow: false } : FILL) };
  for (const k of o.created ?? lamps.map((_, i) => i)) items[lamps[k]!.id] = point(o.power ?? STREET.power, lamps[k]!.pos, params);
  const extra: JsonObject = o.camera === 'orbit' ? { channels: { spin: linear('items/cam/params/orbit/azimuth', [[0, 0], [orbit.seconds, orbit.turn]]) } } : {};
  return sessionDoc(name, o.size ?? STREET.size, 'work_product', items, extra);
}
/** The street's look: no tone map, at `ev` (the fixture's exposure unless given). */
export const streetLook = (ev: number = STREET.ev): JsonObject => look('none', ev);

// ---------------------------------------------------------------------------------------------------
// AC3: 100 fill lamps `c00` … `c99` whose ranges all reach one cluster and no other. The view looks down −Z from
// (0, 1.5, 10) with a 90° fov at 640 × 360 and its near plane at 0.5 m, so a tile is depth ÷ 8 square. The lamps sit on
// a 5 × 5 × 4 lattice 0.05 m apart about (0.5675, 1.5, 0.1), 9.9 m ahead, each with a 0.25 m range: every range lies
// inside cluster [8, 4, 23] (the tile right of the axis in the middle row, the last slice) and at least 0.15 m from
// each neighbour's bounds. Lamp n's power is 400 × 2^(((37 n + 11) mod 100) ÷ 50) lm, two stops over sixteen
// buckets, so neither the IDs' order nor the order the lamps are created in (shuffled) is the scores'.

export const CROWD = {
  size: [640, 360] as Size, cam: { position: [0, 1.5, 10], target: [0, 1.5, 0], fov: 90, size: [640, 360], near: 0.5 } as Pinhole,
  centre: [0.5675, 1.5, 0.1] as V3, step: 0.05, range: 0.25, cluster: [8, 4, 23] as [number, number, number],
};
export function crowdLamps(): Lamp[] {
  return Array.from({ length: 100 }, (_, n) => {
    const [i, j, k] = [n % 5, Math.floor(n / 5) % 5, Math.floor(n / 25)];
    const pos: V3 = [CROWD.centre[0] + (i - 2) * CROWD.step, CROWD.centre[1] + (j - 2) * CROWD.step, CROWD.centre[2] + (k - 1.5) * CROWD.step];
    return { id: `c${String(n).padStart(2, '0')}`, pos, power: 400 * 2 ** (((37 * n + 11) % 100) / 50), range: CROWD.range };
  });
}
export function crowdDoc(): JsonObject {
  const items: Record<string, JsonObject> = { cam: cameraOf(CROWD.cam), sky: DARK_SKY, card_mat: matte(0.8), card: box([0.6, 0.6, 0.02], [CROWD.centre[0], CROWD.centre[1], CROWD.centre[2] - 0.2], 'card_mat') };
  for (const l of shuffled(crowdLamps(), 1634)) items[l.id] = point(l.power, l.pos, { ...FILL, range: l.range });
  return sessionDoc('crowd-100', CROWD.size, 'work_product', items);
}

// ---------------------------------------------------------------------------------------------------
// AC4: 2,048 fill lamps `sw_0000` … `sw_2047` over a ground slab, 64 × 32 of them 1.2 m apart and 0.5 m up, each of
// 100 lm with a 0.8 m range, every one hidden at first (`visible: false`); a showpiece. Lamp k switches on at
// (k + 1) × 10 ÷ 2,048 s and off again at 20 s − k × 10 ÷ 2,048 s (the last on is the first off), so at 60 frames a
// second frame n shows floor(n × 2,048 ÷ 600) lamps on its way up (2,048 at frame 600) and frame 600 + m shows
// 2,048 − floor(m × 2,048 ÷ 600) on its way back (none at frame 1,200).

export const SWITCH = { size: [320, 180] as Size, lamps: 2048, fps: 60, frames: 1201, peak: 600, cam: { position: [0, 75, 55], target: [0, 0, 0], fov: 60, size: [320, 180], near: 50 } as Pinhole };
export const switchId = (k: number): string => `sw_${String(k).padStart(4, '0')}`;
export function switchLamps(): Lamp[] {
  return Array.from({ length: SWITCH.lamps }, (_, k) => ({ id: switchId(k), pos: [(k % 64) * 1.2 - 37.8, 0.5, Math.floor(k / 64) * 1.2 - 18.6] as V3, power: 100, range: 0.8 }));
}
/** The document with every lamp hidden (`on: false`) or lit. */
export function switchDoc(on: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: cameraOf(SWITCH.cam), sky: DARK_SKY, ground_mat: matte(0.5), ground: box([90, 0.2, 50], [0, -0.1, 0], 'ground_mat') };
  for (const l of switchLamps()) items[l.id] = { ...point(l.power, l.pos, { ...FILL, range: l.range }), visible: on };
  return sessionDoc(`switch-${on ? 'on' : 'off'}`, SWITCH.size, 'showpiece', items);
}
/** How many lamps frame `n` shows. */
export const lampsOnAt = (n: number): number => (n <= SWITCH.peak ? Math.floor((n * SWITCH.lamps) / SWITCH.peak) : SWITCH.lamps - Math.floor(((n - SWITCH.peak) * SWITCH.lamps) / SWITCH.peak));
/** The patches that switch the lamps: before frame n, one `set` of `visible` for each lamp whose state changes, in
 * the order they switch. */
export function switchPatches(): JsonObject[] {
  const patches: JsonObject[] = [];
  const set = (k: number, value: boolean): JsonObject => ({ op: 'set', id: switchId(k), path: `items/${switchId(k)}/visible`, value });
  for (let n = 1; n < SWITCH.frames; n++) {
    const [was, now] = [lampsOnAt(n - 1), lampsOnAt(n)];
    const ops: JsonObject[] = [];
    for (let k = was; k < now; k++) ops.push(set(k, true));
    for (let k = was - 1; k >= now; k--) ops.push(set(k, false));
    if (ops.length) patches.push({ frame: n, ops });
  }
  return patches;
}

// ---------------------------------------------------------------------------------------------------
// AC5: a hall 78 m × 39.2 m on open ground, walled 3 m high, holding 2,048 fill lamps: 2,047 lanterns `h_0000` …
// `h_2046` on a 64 × 32 lattice 1.2 m apart and 0.4 m up, each of 60 lm with a 0.7 m range, and `keeper`, 3,000 lm
// with a 4 m range, 1.5 m up and 0.4 m inside the south wall, whose receivers are the collection `hall` (its floor
// and walls). The keeper's range reaches the ground up to 3.3 m south of the wall's outer face; no lantern's reaches
// any of it. Seen from the south, high up, at 960 × 540, about 10 px to the metre.

export const HALL = {
  size: [960, 540] as Size, rho: 0.5, floorTop: 0.05, cam: { position: [0, 72, 60], target: [0, 0, 6], fov: 60, size: [960, 540], near: 55 } as Pinhole,
  keeper: { id: 'keeper', pos: [0, 1.5, 19.2] as V3, power: 3000, range: 4 } as Lamp,
  /** 20 ground points beyond the south wall (its outer face at z = 19.8), all inside the keeper's range. */
  outside: [20.5, 21, 21.5, 22].flatMap((z) => [-1.6, -0.8, 0, 0.8, 1.6].map((x): V3 => [x, 0, z])),
  /** A point of the hall's floor inside the keeper's range and outside every lantern's. */
  inside: [0, 0.05, 16.5] as V3,
  /** 20 lanterns across the hall, whose pools the frame must show: every 101st from h_0037. */
  sampled: Array.from({ length: 20 }, (_, m) => 101 * m + 37),
};
export function hallLamps(): Lamp[] {
  const lanterns = Array.from({ length: 2047 }, (_, k): Lamp => ({ id: `h_${String(k).padStart(4, '0')}`, pos: [(k % 64) * 1.2 - 37.8, 0.4, Math.floor(k / 64) * 1.2 - 18.6], power: 60, range: 0.7 }));
  return [...lanterns, HALL.keeper];
}
/** The hall; `kept: false` leaves the keeper's `receivers` out, so it lights everything in its range. */
export function hallDoc(kept: boolean): JsonObject {
  const wall = 'hall_mat';
  const items: Record<string, JsonObject> = {
    cam: cameraOf(HALL.cam), sky: DARK_SKY, hall_mat: matte(HALL.rho), ground_mat: matte(HALL.rho),
    ground: box([200, 0.2, 140], [0, -0.1, 0], 'ground_mat'), hall_floor: box([78, HALL.floorTop, 39.2], [0, HALL.floorTop / 2, 0], wall),
    wall_s: box([78.4, 3, 0.2], [0, 1.5, 19.7], wall), wall_n: box([78.4, 3, 0.2], [0, 1.5, -19.7], wall),
    wall_w: box([0.2, 3, 39.2], [-39.1, 1.5, 0], wall), wall_e: box([0.2, 3, 39.2], [39.1, 1.5, 0], wall),
  };
  for (const l of hallLamps()) items[l.id] = point(l.power, l.pos, { ...FILL, range: l.range, ...(l.id === 'keeper' && kept ? { receivers: 'hall' } : {}) });
  return sessionDoc(`hall-${kept ? 'kept' : 'open'}`, HALL.size, 'showpiece', items, { collections: { hall: { members: ['hall_floor', 'wall_s', 'wall_n', 'wall_w', 'wall_e'] } } });
}

// ---------------------------------------------------------------------------------------------------
// AC6: #485's room (five plaster boxes seen from inside at (0, 1.5, 4.5) toward the back wall) with its 40 key point
// lights `key_00` … `key_39` on a grid of 8 × 5 at 2.6 m, each with a 40 m range: 32 at 800 lm and the 8 whose index
// ≡ 3 (mod 5) at 2 lm, far below the cut. Beside them, when asked, 1,024 fill lamps `fill_0000` … `fill_1023` on a
// 16 × 8 × 8 lattice in the air before the back wall, each of 5 lm with a 0.2 m range, every range inside the frustum.

export const ROOM = { size: [480, 320] as Size, cam: { position: [0, 1.5, 4.5], target: [0, 1.5, -5], fov: 70, size: [480, 320], near: 0.1 } as Pinhole };
export const KEYS = Array.from({ length: 40 }, (_, n) => ({ id: `key_${String(n).padStart(2, '0')}`, pos: [-3.5 + (n % 8), 2.6, -4 + 1.5 * Math.floor(n / 8)] as V3, power: n % 5 === 3 ? 2 : 800, range: 40 }));
export function roomFill(): Lamp[] {
  return Array.from({ length: 1024 }, (_, n) => ({ id: `fill_${String(n).padStart(4, '0')}`, pos: [-3 + 0.4 * (n % 16), 0.2 + (2.6 / 7) * (Math.floor(n / 16) % 8), -4.6 + (4 / 7) * Math.floor(n / 128)] as V3, power: 5, range: 0.2 }));
}
export function roomDoc(withFill: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: cameraOf(ROOM.cam), sky: DARK_SKY, plaster: material({ base_color: [0.7, 0.7, 0.7, 1], roughness: 0.8 }),
    back: box([12, 4.2, 0.2], [0, 1.5, -5.1], 'plaster'), floor: box([12, 0.2, 10.4], [0, -0.6, 0.1], 'plaster'),
    ceiling: box([12, 0.2, 10.4], [0, 3.6, 0.1], 'plaster'), wall_l: box([0.2, 4.2, 10.4], [-6.1, 1.5, 0.1], 'plaster'),
    wall_r: box([0.2, 4.2, 10.4], [6.1, 1.5, 0.1], 'plaster'),
  };
  for (const l of KEYS) items[l.id] = point(l.power, l.pos, { range: l.range });
  if (withFill) for (const l of roomFill()) items[l.id] = point(l.power, l.pos, { ...FILL, range: l.range });
  return sessionDoc(`room-${withFill ? 'with-fill' : 'keys'}`, ROOM.size, 'showpiece', items);
}
/** `n` fill lamps over a ground slab, 0.5 m up and 1.2 m apart, each with a 0.8 m range, in class `cls`: the
 * documents the check admits at a class's `fill_shaded` and refuses past it. */
export function capDoc(cls: BudgetClass, n: number): JsonObject {
  const items: Record<string, JsonObject> = { cam: cameraOf(SWITCH.cam), sky: DARK_SKY, ground_mat: matte(0.5), ground: box([90, 0.2, 60], [0, -0.1, 0], 'ground_mat') };
  for (let k = 0; k < n; k++) items[`cap_${String(k).padStart(4, '0')}`] = point(100, [(k % 64) * 1.2 - 37.8, 0.5, Math.floor(k / 64) * 1.2 - 19.8], { ...FILL, range: 0.8 });
  return sessionDoc(`cap-${cls}-${n}`, SWITCH.size, cls, items);
}
/** The classes' `fill_shaded` (issue #1634: Scope). */
export const FILL_SHADED: Record<BudgetClass, number> = { figure: 32, work_product: 512, showpiece: 2048, export: 2048 };

// ---------------------------------------------------------------------------------------------------
// AC7: 200 fill lamps `g_000` … `g_199` 2 m over a floor, on a 20 × 10 lattice 0.12 m × 0.2 m apart about the axis,
// each of 100 lm with a 5 m range; the floor's material answers each light through a three-band response whose top
// band is 0.01: 0.005 × min(floor(3 × max(dot(n, l), 0) × shadow), 2) in every channel, with an ambient of 0. At the
// floor under the lattice's middle every lamp is within 2.5 m (inside its range) and stands at dot(n, l) ≥ 0.8, in
// the top band, so each call returns 0.01. The policy's `per_cluster` is 200, so the cluster shades them all.

export const GLOW = { size: [480, 320] as Size, cam: { position: [0, 3, 6], target: [0, 0, 0], fov: 40, size: [480, 320], near: 0.5 } as Pinhole, pixel: [240, 160] as [number, number], lamps: 200, each: 0.01 };
export function glowLamps(): Lamp[] {
  return Array.from({ length: GLOW.lamps }, (_, n) => ({ id: `g_${String(n).padStart(3, '0')}`, pos: [-1.14 + 0.12 * (n % 20), 2, -0.9 + 0.2 * Math.floor(n / 20)] as V3, power: 100, range: 5 }));
}
const step = (op: string, args: JsonObject): JsonObject => ({ op, args });
/** The three-band light response (#485's cel bands), its top band 0.01. */
export const THREE_BANDS: JsonObject = {
  steps: {
    ndl: step('dot@1', { a: 'n', b: 'l' }), facing: step('max@1', { a: 'ndl', b: 0 }), shaded: step('mul@1', { a: 'facing', b: 'shadow' }),
    thrice: step('mul@1', { a: 'shaded', b: 3 }), floored: step('floor@1', { x: 'thrice' }), band: step('min@1', { a: 'floored', b: 2 }),
    level: step('mul@1', { a: 'band', b: GLOW.each / 2 }), out: step('compose@1', { x: 'level', y: 'level', z: 'level' }),
  },
  outputs: { radiance: 'out' },
};
export function glowDoc(): JsonObject {
  const zero: JsonObject = { steps: { c: step('const@1', { value: [0, 0, 0], type: 'vec3' }) }, outputs: { radiance: 'c' } };
  const items: Record<string, JsonObject> = {
    cam: cameraOf(GLOW.cam), sky: DARK_SKY,
    bands: { kind: 'gpu.material@1', params: { origin: 'composed', about: '#1634: three bands, the top one 0.01 a light.', inputs: {}, steps: {}, outputs: {}, cost: { ns_per_px: 50 }, light: THREE_BANDS, ambient: zero } },
    floor_mat: material({ base_color: [0.7, 0.7, 0.7, 1], roughness: 0.8 }, 'bands'), floor: box([12, 0.2, 12], [0, -0.1, 0], 'floor_mat'),
  };
  for (const l of glowLamps()) items[l.id] = point(l.power, l.pos, { ...FILL, range: l.range });
  return sessionDoc('glow-200', GLOW.size, 'showpiece', items, { light_policy: { per_cluster: GLOW.lamps } });
}

// ---------------------------------------------------------------------------------------------------
// AC8: the night city. 2,048 lamp posts on a 64 × 32 lattice 12 m apart, 4 m up, over a ground slab with 128 dark
// blocks between them: post (i, j) holds a fill point lamp where i + j is even and a fill spot lamp (shining down,
// half angles 30° and 50°) where it is odd, 1,024 of each, 1,200 lm, its range 6 + 6 × ((7 i + 13 j) mod 8) ÷ 7 m (6 to
// 12 m). A showpiece at 1920 × 1080 whose camera orbits the city once in 10 s, 620 m off and 55° up, near plane 350 m.

export const CITY = {
  size: [1920, 1080] as Size, fps: 30, frames: 300, orbit: { target: [0, 0, 0] as V3, elevation: 55, distance: 620, fov: 60, near: 350, seconds: 10 },
  /** The 10 sampled times: 0.5 s, 1.5 s, … 9.5 s. */
  sampled: Array.from({ length: 10 }, (_, k) => 15 + 30 * k),
};
export function cityLamps(): (Lamp & { spot: boolean })[] {
  return Array.from({ length: 2048 }, (_, n) => {
    const [i, j] = [n % 64, Math.floor(n / 64)];
    return { id: `post_${String(i).padStart(2, '0')}_${String(j).padStart(2, '0')}`, pos: [12 * i - 378, 4, 12 * j - 186] as V3, power: 1200, range: 6 + (6 * ((7 * i + 13 * j) % 8)) / 7, spot: (i + j) % 2 === 1 };
  });
}
export function cityView(n: number): Pinhole {
  const o = CITY.orbit;
  return { position: orbitEye(o.target, (360 * n) / CITY.fps / o.seconds, o.elevation, o.distance), target: o.target, fov: o.fov, size: CITY.size, near: o.near };
}
export function cityDoc(): JsonObject {
  const o = CITY.orbit;
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: o.target, orbit: { azimuth: 0, elevation: o.elevation, distance: o.distance }, fov: o.fov, near: o.near } },
    sky: DARK_SKY, ground_mat: matte(0.4), block_mat: material({ base_color: [0.3, 0.32, 0.36, 1], roughness: 0.7 }), ground: box([820, 0.2, 440], [0, -0.1, 0], 'ground_mat'),
  };
  for (let b = 0; b < 128; b++) {
    const [i, j] = [b % 16, Math.floor(b / 16)];
    const h = 6 + 2 * ((5 * i + 3 * j) % 8);
    items[`block_${String(b).padStart(3, '0')}`] = box([8, h, 8], [48 * i - 360 - 6, h / 2, 48 * j - 168 - 6], 'block_mat');
  }
  for (const l of cityLamps()) items[l.id] = l.spot ? spot(l.power, l.pos, [-90, 0, 0], { ...FILL, range: l.range, inner: 30, outer: 50 }) : point(l.power, l.pos, { ...FILL, range: l.range });
  return sessionDoc('night-city', CITY.size, 'showpiece', items, { channels: { spin: linear('items/cam/params/orbit/azimuth', [[0, 0], [o.seconds, 360]]) } });
}
