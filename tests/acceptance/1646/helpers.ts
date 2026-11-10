// Test-side tools for the #1646 acceptance tests: three binaries built once per file (`deep-gpu` for the dither fill's
// pixels, `deep-canvas-render` for the document check and the text animator's units, `deep-motion` for drivers) and
// driven by JSON lines; the documents and looks the tests send, generated here so every value is readable; the PNG
// reader; the Bayer matrix; the two-GPU record. Suites don't import each other, so what this file shares with #464's,
// #149's, #490's and #496's helpers is repeated here. Each check a planted twin must fail returns its failures as
// sentences naming what failed.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rgb = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1646 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = { 1: '#1646.23206300', 2: '#1646.7fba4dd6', 3: '#1646.5b6cd97b' } as const;

/** Flicks per second (canvas primitives: Time and the flick). */
export const FLICKS = 705_600_000;
export const fl = (seconds: number): number => Math.round(seconds * FLICKS);

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
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
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test that needs what this machine lacks fails with this and its one unblock ask, never passes. */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
/** No failures. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join('; ')}`).toEqual([]);
}
/** A planted twin's check: it found failures, and they name what the criterion says they name. */
export function failsNaming(failures: readonly string[], names: (string | RegExp)[], what: string): void {
  expect(failures.length, `${what} fails`).toBeGreaterThan(0);
  const text = failures.join('\n');
  for (const n of names) {
    if (typeof n === 'string') expect(text, `${what}'s failure names ${n}`).toContain(n);
    else expect(text, `${what}'s failure names ${String(n)}`).toMatch(n);
  }
}

// ---------------------------------------------------------------------------------------------------
// The machine: Metal on macOS for the GPU's pixels; the GPU family for the two-GPU record.

export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these pixels on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
function chipName(): string {
  try { return execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
/** This Mac's Metal GPU family, from its chip (M1 apple7, M2 apple8, M3 and M4 apple9, then apple(n + 5)), as #464's suite reads it. */
export function thisFamily(): string {
  const m = /\bM(\d+)\b/.exec(chipName());
  const n = m ? Number(m[1]) : 0;
  return n === 1 ? 'apple7' : n === 2 ? 'apple8' : n === 3 || n === 4 ? 'apple9' : `apple${n + 5}`;
}
/** Where the run keeps what a second machine reads: DEEPBUILD_EVIDENCE_DIR, else a folder under $TMPDIR. */
export function evidenceDir(): string {
  const dir = process.env['DEEPBUILD_EVIDENCE_DIR'] ?? join(tmpdir(), 'deep-1646-evidence');
  mkdirSync(dir, { recursive: true });
  return dir;
}
/**
 * The two-GPU half of a criterion. Writes this GPU's record of the hashes (`coverage-record-<name>-<family>.json` in the
 * evidence folder) and compares it with the record a GPU of another family made from the same suite, named by
 * DEEPBUILD_SECOND_GPU_1646. Without one, it fails BLOCKED with its one unblock ask, never passing.
 */
export function sameOnTwoGpus(name: string, hashes: Record<string, string>, what: string): void {
  const family = thisFamily();
  const record = { issue: 1646, gpu: { family, chip: chipName() }, hashes };
  const path = join(evidenceDir(), `coverage-record-${name}-${family}.json`);
  writeFileSync(path, `${JSON.stringify(record, null, 1)}\n`);
  console.log(`${what}: this GPU's record: ${path}`);
  const other = process.env['DEEPBUILD_SECOND_GPU_1646'];
  const ask = `one unblock ask: run \`npx vitest run --root tests/acceptance/1646 --no-file-parallelism dither.test.ts\` on a Mac whose GPU is another family than ${family} and name its ${name} record (coverage-record-${name}-<family>.json in its DEEPBUILD_EVIDENCE_DIR) in DEEPBUILD_SECOND_GPU_1646`;
  if (!other || !existsSync(other)) blocked(`${what} needs a second GPU and this machine has one (${family}); ${ask}`);
  const second = JSON.parse(readFileSync(other, 'utf8')) as { gpu?: { family?: string }; hashes?: Record<string, string> };
  if (second.gpu?.family === undefined || second.gpu.family === family) blocked(`${what}: the record in DEEPBUILD_SECOND_GPU_1646 is from ${second.gpu?.family ?? 'no named GPU'}, not another family than ${family}; ${ask}`);
  for (const [k, h] of Object.entries(hashes)) {
    expect(second.hashes?.[k], `${what}: ${k} on ${family} and on ${second.gpu.family} is the same coverage`).toBe(h);
  }
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file and copied out of the target folder.

export type Build = 'deep-gpu' | 'deep-canvas-render' | 'deep-motion';
/** cargo on PATH, or the pinned toolchain's when PATH has none. */
function cargoEnv(): NodeJS.ProcessEnv {
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  return { ...process.env, PATH: path, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
}
const buildArgs = (b: Build): string[] => ['build', '--locked', '--bin', b];
function cargoBuild(b: Build): string {
  const args = buildArgs(b);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cargoEnv() });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => {
  const t = process.env['CARGO_TARGET_DIR'];
  return t ? resolve(REPO, t) : join(REPO, 'target');
};
export interface Bins { bin: (b: Build) => string }
/** Builds each named binary once before the file's tests; a test that uses a failed build fails with cargo's error. */
export function useBins(builds: Build[]): Bins {
  let dir = '';
  const made = new Map<Build, string>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1646-bin-'));
    for (const b of builds) {
      const error = cargoBuild(b);
      if (error === '') copyFileSync(join(targetDir(), 'debug', b), join(dir, b));
      made.set(b, error);
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build): string {
      expect(made.has(b), `the file built ${b}`).toBe(true);
      expect(made.get(b), `${b} builds: cargo ${buildArgs(b).join(' ')}`).toBe('');
      return join(dir, b);
    },
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1646-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// JSON lines: one object per line in, one per line out, in order, exit 0. One call is one process.

export function lines(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 3_000_000): JsonObject[] {
  const label = `${bin.split(/[\\/]/).at(-1)} ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within ${timeoutMs} ms`);
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${label}: one output line per input line`).toBe(inputs.length);
  return out.map((l, i) => {
    try { return obj(JSON.parse(l) as JsonValue, `${label}: line ${i + 1}`); } catch { return expect.fail(`${label}: line ${i + 1} is JSON: ${l.slice(0, 1500)}`); }
  });
}

/** One `deep-gpu run` scenario (#377), accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const [answer] = lines(bin, ['run'], [{ out, calls }]);
  expect(answer!['ok'], `deep-gpu run accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer!['replies'], 'deep-gpu: replies').map((r, i) => obj(r, `deep-gpu: replies[${i}]`));
  expect(replies.length, 'deep-gpu: one reply per call').toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// film2d frames and their final PNGs

export interface Frame { frame: number; pixel_hash: string; raw: JsonObject }
export function frameAt(reply: JsonObject, n: number, what: string): Frame {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i) => {
    const o = obj(f, `${what}: frames[${i}]`);
    return { frame: num(o['frame'], `${what}: frames[${i}].frame`), pixel_hash: String(o['pixel_hash']), raw: o };
  });
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).join(', ')})`).toBeDefined();
  return f!;
}
export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#418's reader). */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      let v: number;
      switch (filter) { case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break; case 4: v = x + paeth(a, b, c); break; default: throw Error(`PNG filter ${filter}`); }
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
/** A frame's `final` target: the 8-bit sRGB PNG the frame shows, named by its SHA-256 in the call's `out`. */
export function readFinal(out: string, f: Frame, what: string): Image {
  const h = String(f.raw['final']);
  expect(h, `${what}: final is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${h}.png`));
  expect(sha256(file), `${what}: final's file hashes to its name`).toBe(h);
  return decodePng(file);
}
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
export const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** The standard 4 × 4 recursive ordered (Bayer) matrix, read as BAYER4[y mod 4][x mod 4]: entries 0 to 15. */
export const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]] as const;

// ---------------------------------------------------------------------------------------------------
// Looks and documents

const BASE_LOOK = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
/**
 * A 2D `look@1` on a drawing basis: fixtures/look.json (white ground, graphite ink, the clean status map), with each of
 * `colors` added as a palette entry and a role of that name, then `change` replacing or adding top-level fields.
 */
export function look2d(id: string, colors: Record<string, string>, change: JsonObject = {}): JsonObject {
  const palette = { ...obj(BASE_LOOK['palette'], 'palette') };
  const roles = { ...obj(BASE_LOOK['roles'], 'roles') };
  for (const [role, c] of Object.entries(colors)) { palette[`c-${role}`] = c; roles[role] = `c-${role}`; }
  return { ...BASE_LOOK, id, description: `The #1646 acceptance look ${id}.`, palette, roles, ...change };
}
const LAYERS: JsonObject = { main: { writer: 'agent-a', title: 'Main', order: 'a1' } };
/** A 2D figure (#464's envelope): one writer layer `main`, items keyed by ID. */
export function doc2d(id: string, size: readonly [number, number], items: JsonObject[]): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `Fixture ${id}`, description: `The #1646 acceptance fixture ${id}.`, size: [...size], seed: 1646,
    transport: { span: '8s' }, requires: { modules: { effects: '^1' } }, budget: { class: 'showpiece' }, layers: LAYERS,
    items: Object.fromEntries(items.map((i) => [i['id'] as string, i])),
  };
}
/** A film (#490's and #496's envelope) at `fps` over `span`, with `extra` sections (channels, drivers, …). */
export function film(id: string, items: JsonObject[], extra: JsonObject, span: string, fps: number): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#1646 ${id}`, description: `The #1646 acceptance tests' document ${id}.`, size: [640, 360], layers: LAYERS,
    transport: { span, frame_rate: `${fps}/1` }, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject =>
  ({ id, kind, layer: 'main', name: id, order, params, ...extra });
/** `film2d` (#417, #149, #464). */
export const film2d = (doc: JsonObject, look: JsonObject, extra: JsonObject): JsonObject => ({ call: 'film2d', doc, look, hash: true, ...extra });
