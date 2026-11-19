// Test-side tools for the #1619 acceptance tests: `deep-gpu` (#377's binary, with #417's and #464's `film2d`) built
// once per file and driven by JSON lines, on Metal or on the noop backend; the 2D documents and looks the tests draw,
// generated here so every value is readable; the reply readers (frames, their `final` PNG); a channel's peak; the
// merge base's frame (fixtures/base-frame.json and .png) and the GPU it was drawn on. Suites don't import each other,
// so what this file shares with #464's, #1646's and #1640's helpers is repeated here. Each check a planted twin must
// fail returns its failures as sentences naming what failed.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
/** The checkout root (tests/acceptance/1619 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = { 1: '#1619.a63cb7a9', 2: '#1619.94959aa8', 3: '#1619.244eda5f', 4: '#1619.f0d0fbcf' } as const;

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
/** A SHA-256 a reply names something by. */
export function sha(v: JsonValue | undefined, what: string): string {
  expect(typeof v === 'string' && /^[0-9a-f]{64}$/.test(v), `${what} is a SHA-256, got ${shown(v)}`).toBe(true);
  return v as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
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
// The machine: Metal on macOS for anything the finish pass draws; the GPU family for the merge base's frame.

export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the finish pass draws these pixels on macOS's Metal device, the reference Mac; this is ${process.platform}`);
}
export function chipName(): string {
  try { return execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
/** This Mac's Metal GPU family, from its chip (M1 apple7, M2 apple8, M3 and M4 apple9, then apple(n + 5)), as #464's suite reads it. */
export function thisFamily(): string {
  const m = /\bM(\d+)\b/.exec(chipName());
  const n = m ? Number(m[1]) : 0;
  return n === 1 ? 'apple7' : n === 2 ? 'apple8' : n === 3 || n === 4 ? 'apple9' : `apple${n + 5}`;
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu`, built once per file and copied out of the target folder.

const BUILD = ['build', '--locked', '--bin', 'deep-gpu'];
/** cargo on PATH, or the pinned toolchain's when PATH has none. */
function cargoEnv(): NodeJS.ProcessEnv {
  const pinned = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
  const path = existsSync(pinned) ? `${process.env['PATH'] ?? ''}${delimiter}${pinned}` : process.env['PATH'];
  return { ...process.env, PATH: path, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
}
function cargoBuild(): string {
  const r = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: cargoEnv() });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${BUILD.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
const targetDir = (): string => {
  const t = process.env['CARGO_TARGET_DIR'];
  return t ? resolve(REPO, t) : join(REPO, 'target');
};
/** Builds `deep-gpu` once before the file's tests; a test that uses a failed build fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = 'the file did not build deep-gpu';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1619-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `deep-gpu builds: cargo ${BUILD.join(' ')}`).toBe('');
    return join(dir, 'deep-gpu');
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1619-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]` (#377): one scenario line in, one line out.

/** The wrong programs this suite adds to `deep-gpu run`, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'convergence_angle_ignored' | 'tracking_wall_time';
/** How a run starts: on Metal by default, or on the noop backend, which draws no pixel and runs anywhere. */
export interface Startup { backend?: 'noop' | undefined; planted?: Planted | undefined }

/** One `deep-gpu` scenario, accepted, with one reply per call, in one process. */
export function runGpu(bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] {
  const args = ['run', ...(startup.backend ? ['--backend', startup.backend] : []), ...(startup.planted ? ['--planted', startup.planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${label} did not finish within 3,000 s`);
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const out1 = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out1.length, `${label}: one output line for the scenario`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(out1[0]!) as JsonValue; } catch { return expect.fail(`${label}: the answer is JSON: ${out1[0]!.slice(0, 1500)}`); }
  const answer = obj(parsed, `${label}: the answer`);
  expect(answer['ok'], `${label} accepted the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// film2d's frames and their `final` PNG

/** A frame row of `film2d`: its absolute index and the row itself (`pixel_hash`, `final`, `finish_hash`). */
export interface Frame { frame: number; raw: JsonObject }
/** A reply's frames; INCONCLUSIVE when it says the platform can't draw them, a failure when it is a refusal. */
export function framesOf(reply: JsonObject, what: string): Frame[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((f, i): Frame => {
    const raw = obj(f, `${what}: frames[${i}]`);
    return { frame: num(raw['frame'], `${what}: frames[${i}].frame`), raw };
  });
}
export function frameAt(reply: JsonObject, n: number, what: string): Frame {
  const frames = framesOf(reply, what);
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).join(', ')})`).toBeDefined();
  return f!;
}
/** A frame's `pixel_hash` (`hash: true`): the SHA-256 of the pixels its surface holds. */
export const pixelHash = (f: Frame, what: string): string => sha(f.raw['pixel_hash'], `${what}: frame ${f.frame}'s pixel_hash`);
/** A frame's `finish_hash` (README: The surface under test): the SHA-256 of what the finish pass is given for the frame. */
export const finishHash = (f: Frame, what: string): string => sha(f.raw['finish_hash'], `${what}: frame ${f.frame}'s finish_hash`);

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
/** A captured frame's `final` target: the 8-bit sRGB PNG the frame shows, named by its SHA-256 in the call's `out`. */
export function readFinal(out: string, f: Frame, what: string): Image {
  const h = sha(f.raw['final'], `${what}: frame ${f.frame}'s final`);
  const file = readFileSync(join(out, `${h}.png`));
  expect(sha256(file), `${what}: final's file hashes to its name`).toBe(h);
  return decodePng(file);
}
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** The first pixel where two pictures differ, as a sentence, or '' when they hold the same bytes. */
export function firstDifference(a: Image, b: Image, aName: string, bName: string): string {
  if (a.width !== b.width || a.height !== b.height) return `${aName} is ${a.width} × ${a.height} and ${bName} is ${b.width} × ${b.height}`;
  for (let i = 0; i < a.rgba.length; i++) {
    if (a.rgba[i] === b.rgba[i]) continue;
    const p = Math.floor(i / 4); const x = p % a.width; const y = Math.floor(p / a.width);
    let n = 0; for (let j = 0; j < a.rgba.length; j += 4) if (a.rgba[j] !== b.rgba[j] || a.rgba[j + 1] !== b.rgba[j + 1] || a.rgba[j + 2] !== b.rgba[j + 2] || a.rgba[j + 3] !== b.rgba[j + 3]) n++;
    return `${n} pixels differ; first: pixel (${x}, ${y}) is ${pixel(a, x, y).join(', ')} in ${aName} and ${pixel(b, x, y).join(', ')} in ${bName}`;
  }
  return '';
}

/** A channel's peak: where it is brightest, as a point. */
export interface Peak { x: number; y: number; max: number }
/**
 * A channel's peak in a picture: the centroid, at pixel centres, of the pixels at or above half the channel's
 * brightest value, weighted by value. A line one pixel wide that a resample split over two rows peaks between them.
 */
export function peak(image: Image, channel: 0 | 1 | 2): Peak {
  let max = 0;
  for (let i = channel; i < image.rgba.length; i += 4) max = Math.max(max, image.rgba[i]!);
  let sw = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const v = image.rgba[(y * image.width + x) * 4 + channel]!;
    if (max === 0 || v * 2 < max) continue;
    sw += v; sx += v * (x + 0.5); sy += v * (y + 0.5);
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw, max } : { x: NaN, y: NaN, max };
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents (README: The surface under test)

const BASE_LOOK = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
/**
 * A 2D `look@1` on a drawing basis: fixtures/look.json (white ground, graphite ink, the clean status map), with each of
 * `colors` added as a palette entry and a role of that name, then `change` replacing or adding top-level fields.
 */
export function look2d(id: string, colors: Record<string, string>, change: JsonObject = {}): JsonObject {
  const palette = { ...obj(BASE_LOOK['palette'], 'palette') };
  const roles = { ...obj(BASE_LOOK['roles'], 'roles') };
  for (const [role, c] of Object.entries(colors)) { palette[`c-${role}`] = c; roles[role] = `c-${role}`; }
  return { ...BASE_LOOK, id, description: `The #1619 acceptance look ${id}.`, palette, roles, ...change };
}
/** A look whose finish is one `screen` with these fields (#464: a field left out is off), or no finish for `null`. */
export const screenLook = (id: string, colors: Record<string, string>, screen: JsonObject | null, change: JsonObject = {}): JsonObject =>
  look2d(id, colors, { finish: screen ? [{ screen }] : [], ...change });
/** A 2D figure (#464's envelope): one writer layer `main`, items keyed by ID. */
export function doc2d(id: string, size: readonly [number, number], items: JsonObject[]): JsonObject {
  return {
    format: 1, id, profile: 'figure', title: `Fixture ${id}`, description: `The #1619 acceptance fixture ${id}.`, size: [...size], seed: 1619,
    transport: { span: '8s' }, requires: { modules: { effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a1' } },
    items: Object.fromEntries(items.map((i) => [i['id'] as string, i])),
  };
}
export const rect = (id: string, order: string, box: [number, number, number, number], role: string): JsonObject =>
  ({ id, kind: 'rect@1', layer: 'main', name: id, order, params: { box, paint: { fill: { role } } } });
/** `film2d` (#417, #149, #464): a 2D film under a look, each frame's `pixel_hash` with `hash`, its `final` PNG with `capture`. */
export const film2d = (doc: JsonObject, look: JsonObject, extra: JsonObject): JsonObject => ({ call: 'film2d', doc, look, ...extra });

// ---------------------------------------------------------------------------------------------------
// The line fixture (criterion 1), shared by line.test.ts and the recording of the merge base's frame.

export const LINE_SIZE: [number, number] = [320, 180];
/** Black and white as the line fixture's two roles. */
export const LINE_COLORS = { dark: '#000000', bright: '#ffffff' };
/** A 1 px white vertical line over black: column 160, rows 30 to 149. */
export const VERTICAL = doc2d('line-vertical-1619', LINE_SIZE, [rect('black', 'a0', [0, 0, 320, 180], 'dark'), rect('line', 'a1', [160, 30, 1, 120], 'bright')]);
/** A 1 px white horizontal line over black: row 90, columns 100 to 219. */
export const HORIZONTAL = doc2d('line-horizontal-1619', LINE_SIZE, [rect('black', 'a0', [0, 0, 320, 180], 'dark'), rect('line', 'a1', [100, 90, 120, 1], 'bright')]);
/** The line fixture's look: a CRT screen with these fields and nothing else. */
export const lineLook = (screen: JsonObject): JsonObject => screenLook('line-1619', LINE_COLORS, { kind: 'crt', ...screen });
/** The line fixture's call: one frame, hashed and captured. */
export const lineCall = (doc: JsonObject, screen: JsonObject): JsonObject => film2d(doc, lineLook(screen), { frames: 1, hash: true, capture: [0] });

// ---------------------------------------------------------------------------------------------------
// The tape fixture (criteria 2 and 3): a still figure played for 2 s under a screen with a tracking band and a roll.

export const TAPE_SIZE: [number, number] = [320, 180];
export const TAPE_COLORS = { cyan: '#28aae6', rose: '#e65a96' };
/**
 * Ten 32 × 18 blocks stepping down the frame's diagonal on white, in two colors: every row holds an edge a band's
 * shift moves, and every column one a roll moves.
 */
export const STAIRS = doc2d('stairs-1619', TAPE_SIZE, Array.from({ length: 10 }, (_, k) => rect(`step-${k}`, `a${k}`, [k * 32, k * 18, 32, 18], k % 2 ? 'rose' : 'cyan')));
/** The issue's `tracking: {band: px, rate: Hz, shift: px, seed}` and `roll: {period: s, amount: 0..1}`, off their identity. */
export const TRACKING: JsonObject = { band: 12, rate: 12, shift: 6, seed: 7 };
export const ROLL: JsonObject = { period: '1s', amount: 0.25 };
/** The film: 48 frames at 24 fps, so 24 steps of the band's 12 Hz and two of the roll's periods. */
export const FPS = 24;
export const FRAMES = 48;
/** The tape fixture's look: a VHS screen with these fields, or no finish for `null`. */
export const tapeLook = (id: string, screen: JsonObject | null): JsonObject => screenLook(id, TAPE_COLORS, screen && { kind: 'vhs', ...screen });

/** The merge base's frame (README: The merge base's frame): the record of how it was drawn and its pixels. */
export interface BaseFrame { base: string; gpu: { family: string; chip: string }; call: JsonObject; image: Image }
export function baseFrame(): BaseFrame {
  const record = obj(JSON.parse(readFileSync(join(HERE, 'fixtures', 'base-frame.json'), 'utf8')) as JsonValue, 'fixtures/base-frame.json');
  const file = readFileSync(join(HERE, 'fixtures', 'base-frame.png'));
  expect(sha256(file), 'fixtures/base-frame.png is the file the record names').toBe(record['final']);
  const gpu = obj(record['gpu'], 'base-frame.json: gpu');
  return { base: String(record['base']), gpu: { family: String(gpu['family']), chip: String(gpu['chip']) }, call: obj(record['call'], 'base-frame.json: call'), image: decodePng(file) };
}
