// Test-side tools for the #495 acceptance tests: the two binaries the base already has, built once per file and driven by
// JSON lines (`deep-motion eval` for drivers, `deep-gpu run` for pixels); the documents the tests send; PNG reading; and
// the reference math the expected values come from. Nothing here stands in for the program under test: every value a test
// compares comes from a binary, every expected value from the issue's text computed here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/495 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Every `it` passes this timeout: a first build can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #495.2cde4005',
  2: 'AC2 #495.268c5ad9',
  3: 'AC3 #495.a46e8949',
  4: 'AC4 #495.ece8b00e',
  5: 'AC5 #495.984de463',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time, JSON, judging

export const FLICKS = 705_600_000;
export const fl = (s: number): number => Math.round(s * FLICKS);
/** A seeded generator (mulberry32), so a failing run replays. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** The GPU layer draws on macOS's Metal device; anywhere else a pixel test is INCONCLUSIVE, never a pass. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The builds: each file builds its binary once, in beforeAll, copied out of the target folder.

function useBinary(name: string): () => string {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), `deep-495-${name}-`));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    error = run.error ? `cargo could not run: ${run.error.message}` : run.status === 0 ? '' : `cargo build --locked --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    if (error === '') { bin = join(dir, name); copyFileSync(join(TARGET, 'debug', name), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => { expect(error, `the binary builds: cargo build --locked --bin ${name}`).toBe(''); return bin; };
}
export const useMotion = (): (() => string) => useBinary('deep-motion');
export const useGpu = (): (() => string) => useBinary('deep-gpu');
/** A fresh temporary folder per test, deleted after it (the GPU layer writes its files here, named by SHA-256). */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-495-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-motion eval`: one JSON line in {doc, times}, one out {ok, frames: [{t, items, …}]} or {ok: false, code, path, …}.

export function evalAll(bin: string, lines: { doc: JsonObject; times: number[] }[]): JsonObject[] {
  const run = spawnSync(bin, ['eval'], { cwd: REPO, input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(run.error?.message ?? '', 'deep-motion eval ran').toBe('');
  expect(run.status, `deep-motion eval exits 0; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, 'deep-motion eval: one output line per input line').toBe(lines.length);
  return out.map((l, i) => obj(JSON.parse(l) as JsonValue, `answer ${i}`));
}
export const evalOne = (bin: string, doc: JsonObject, times: number[]): JsonObject => evalAll(bin, [{ doc, times }])[0]!;
/** An accepted answer's frames' `items.<id>.at.pos[0]`, one per time, in order. */
export function posX(answer: JsonObject, id: string, times: readonly number[], what: string): number[] {
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`);
  expect(frames.length, `${what}: one frame per time`).toBe(times.length);
  return frames.map((f, i) => {
    const t = obj(f, `${what}: frames[${i}]`)['t'];
    expect(t, `${what}: frames[${i}].t`).toBe(times[i]);
    const at = obj(obj(obj(f, 'frame')['items'], 'items')[id], `item ${id}`)['at'];
    const pos = obj(at, `item ${id}: at`)['pos'];
    const x = arr(pos, `item ${id}: at.pos`)[0];
    expect(typeof x === 'number', `${what}: item ${id} at.pos[0] is a number at frame ${i}, got ${show(x)}`).toBe(true);
    return x as number;
  });
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line {out, calls} in, {ok, replies} out (#377); each call is `layers` (a writer layer's PNG at
// t) or `film2d` (frames with `pixel_hash`, #417 and #430; `from` opens the film at that frame with nothing drawn before).

export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  requireMetal();
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  expect(run.error?.message ?? '', 'deep-gpu run ran').toBe('');
  const stdout = run.stdout ?? '';
  expect(run.status, `deep-gpu run exits 0; stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-2500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-gpu run: one output line per input line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-gpu run: the answer');
  expect(answer['ok'], `deep-gpu run accepted the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'replies').map((r, i) => obj(r, `replies[${i}]`));
  expect(replies.length, 'one reply per call').toBe(calls.length);
  return replies;
}
const answered = (reply: JsonObject, what: string): JsonObject => {
  expect(reply['code'], `${what} was answered, not refused: ${show(reply)}`).toBeUndefined();
  return reply;
};
export const LOOK: JsonObject = { light: { ground: [255, 255, 255], accent: [26, 163, 200], white: [255, 255, 255], grey: [128, 128, 128], rust: [200, 100, 50] } };
export const layersCall = (doc: JsonObject, t: number): JsonObject => ({ call: 'layers', doc, look: LOOK, t, by: ['gpu_layer'] });
export const filmCall = (doc: JsonObject, from: number, frames: number): JsonObject => ({ call: 'film2d', doc, look: 'clean', from, frames, hash: true });

export interface Image { width: number; height: number; rgba: Uint8Array }
/** The first layer's GPU-layer PNG of a `layers` reply, decoded (8-bit, straight alpha). */
export function layerImage(out: string, reply: JsonObject, what: string): Image {
  answered(reply, what);
  const l = obj(arr(reply['layers'], `${what}: layers`)[0], `${what}: layers[0]`);
  const side = answered(obj(obj(l['drawn'], `${what}: drawn`)['gpu_layer'], `${what}: drawn.gpu_layer`), `${what}: the GPU layer's side`);
  const name = str(side['png'], `${what}: png`);
  const bytes = readFileSync(join(out, `${name}.png`));
  expect(sha256(bytes), `${what}: the file is named by its SHA-256`).toBe(name);
  return decodePng(bytes);
}
export const pixel = (im: Image, x: number, y: number): [number, number, number, number] => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!]; };
/** Frame `n`'s `pixel_hash` in a `film2d` reply. */
export function hashAt(reply: JsonObject, n: number, what: string): string {
  answered(reply, what);
  const f = arr(reply['frames'], `${what}: frames`).map((v) => obj(v, 'frame')).find((v) => v['frame'] === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return str(f!['pixel_hash'], `${what}: frame ${n}'s pixel_hash`);
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const paeth = (a: number, b: number, c: number): number => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let color = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); color = body[9]!; } else if (type === 'IDAT') data.push(body); else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (color !== 2 && color !== 6) throw Error(`PNG color type ${color}; the reader takes 8-bit RGB/RGBA`);
  const ch = color === 6 ? 4 : 3; const stride = width * ch; const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4); let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!; const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch]! : 0; const b = prev[i]!; const c = i >= ch ? prev[i - ch]! : 0;
      line[i] = (line[i]! + [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]!) & 255;
    }
    for (let x = 0; x < width; x++) { const o = (y * width + x) * 4; rgba[o] = line[x * ch]!; rgba[o + 1] = line[x * ch + 1]!; rgba[o + 2] = line[x * ch + 2]!; rgba[o + 3] = ch === 4 ? line[x * ch + 3]! : 255; }
    prev = line;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Documents). Flicks as time text; 60 fps unless a test says otherwise.

const LAYERS: JsonObject = { main: { writer: 'agent-a', title: 'Main', order: 'a0' } };
export const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
export const rect = (id: string, order: string, box: number[], role: string, extra: JsonObject = {}): JsonObject => item(id, 'rect@1', order, { box, paint: { fill: { role } } }, extra);
export function film(id: string, size: number[], items: JsonObject[], extra: JsonObject = {}, span = '4s'): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#495 ${id}`, description: `The #495 acceptance tests' document ${id}.`, size, layers: LAYERS,
    transport: { span, frame_rate: [60, 1] }, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A linear channel on `target`: keys [seconds, value]. */
export const linear = (target: string, list: [number, number][]): JsonObject => ({
  target, type: 'f32', keys: Object.fromEntries(list.map(([t, value], i) => [`k${String(i).padStart(2, '0')}`, { t: `${t}s`, value, interp: 'linear' }])),
});
/** Linear interpolation of `list` at `s` seconds, held past either end: the reference for a channel's value. */
export function linearAt(list: [number, number][], s: number): number {
  if (s <= list[0]![0]) return list[0]![1];
  for (let i = 0; i + 1 < list.length; i++) {
    const [t0, v0] = list[i]!; const [t1, v1] = list[i + 1]!;
    if (s < t1) return v0 + ((v1 - v0) * (s - t0)) / (t1 - t0);
  }
  return list[list.length - 1]![1];
}
