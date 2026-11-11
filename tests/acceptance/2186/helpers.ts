// Test-side tools for the #2186 acceptance tests: `deep-gpu` (#377's binary, the shipped build) built once per file
// and driven by JSON lines on the Metal device through three calls that exist at the base, `canonical` and `live`
// (#379's) and `view3d` (#378's); the issue's scene, as a writer's payload and as a session document, with one
// light's shadow turned off on request; PNG reading; and the one comparison every criterion makes. Nothing here
// stands in for the live view, its warm-up, its shadow caches or view3d's renderer.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2186 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const BIN = 'deep-gpu';
/** The shipped build: `canonical`, `live` with `capture`, and `view3d` need no test feature (README: Run them). */
const BUILD = ['build', '--locked', '--bin', BIN];
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

// ---------------------------------------------------------------------------------------------------
// The criteria's numbers.

/** Every render here is 320 × 240 (the issue's scene and its first criterion). */
const SIZE: [number, number] = [320, 240];
/** The subject's centre in the frame, where the issue reads its values. */
const CENTRE: [number, number] = [160, 130];
/** "Within 2 levels … in every 8-bit channel of every pixel." */
const LEVELS = 2;
/** view3d's subject centre is lit: each of its colour channels reads at least this. The issue measures 106 to 168 there
 * and 16 on the background; a frame with nothing drawn, or the subject fully shadowed (0), reads below it. */
const LIT = 64;
/** The writer whose payload `canonical` and `live` take. */
const WRITER = 'agent:alpha';
/** The three lights, each with `shadow: true` in the scene. */
export const LIGHTS = ['key', 'fill-a', 'fill-b'] as const;
export type Light = (typeof LIGHTS)[number];

// ---------------------------------------------------------------------------------------------------
// JSON

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

/** The criteria compare pixels the Metal device draws: off macOS a test fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the criteria compare pixels drawn on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: the shipped `deep-gpu`, built once per file with incremental builds and debug info off.

/** Builds once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2186-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
    const run = spawnSync('cargo', BUILD, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${BUILD.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
    else copyFileSync(join(targetDir(), 'debug', BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${BUILD.join(' ')}`).toBe('');
    return join(dir, BIN);
  };
}

/** A fresh output folder per test (documents and the PNG finals), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2186-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running: `deep-gpu run` on the Metal device, one scenario `{out, calls}` per process, one reply per call.

export function run(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const shown = `${BIN} run`;
  const s = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL',
  });
  const timedOut = s.error !== undefined && (s.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${shown} finished within its timeout`).toBe(false);
  if (s.error) throw Error(`${shown}: ${s.error.message}`);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${(s.stdout ?? '').slice(0, 1500)}; stderr: ${(s.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (s.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${shown}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
  const a = obj(answer, `${shown}: the answer`);
  expect(a['ok'], `${shown} accepted the scenario: ${JSON.stringify(a).slice(0, 2000)}`).toBe(true);
  const replies = arr(a['replies'], `${shown}: replies`).map((r, i) => obj(r, `${shown}: replies[${i}]`));
  expect(replies.length, `${shown}: one reply per call`).toBe(calls.length);
  return replies;
}

/** A reply that is no refusal; `unsupported_platform` fails INCONCLUSIVE. */
function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} answered unsupported_platform`);
  expect(reply['code'], `${what} is answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// The scene (README: Fixtures): the issue's, as a writer's payload (#393's deep_show payload: the envelope and ID
// maps, no `id`, no `layers`, no item `layer`) for `canonical` and `live`, and as a session document with one writer
// layer for `view3d`.

const LOOK = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
const SCENE = JSON.parse(readFileSync(join(HERE, 'fixtures', 'scene.json'), 'utf8')) as JsonObject;

/** The writer's payload, with `off`'s shadow set to false when given. */
export function payload(off?: Light): JsonObject {
  const doc = JSON.parse(JSON.stringify(SCENE)) as JsonObject;
  if (off) {
    const light = obj(obj(doc['items'], 'the scene: items')[off], `the scene: items.${off}`);
    obj(light['params'], `the scene: items.${off}.params`)['shadow'] = false;
  }
  return doc;
}

/** The same document as a session holds it: an `id`, one writer layer `main` of `WRITER`, every item in it. */
export function sessionDoc(off?: Light): JsonObject {
  const doc = payload(off);
  const items = obj(doc['items'], 'the scene: items');
  for (const item of Object.values(items)) obj(item, 'an item')['layer'] = 'main';
  return { ...doc, id: 'scene-2186', layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } } };
}

/** Writes `doc` under `dir` and returns its absolute path. */
export function writeDoc(dir: string, name: string, doc: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The calls.

/** `canonical` (#379, with #1173's `targets`): render-back of frame 1 at 320 × 240, its final written as a PNG. */
export const canonicalCall = (doc: string): JsonObject =>
  ({ call: 'canonical', look: LOOK, writer: WRITER, doc, size: SIZE, frame: 1, purpose: 'render_back', targets: ['final'] });

/** `live` (#379): one session on the payload, frame 1 presented and captured (#425's `capture`). */
export const liveCall = (doc: string): JsonObject =>
  ({ call: 'live', look: LOOK, frames: 1, sessions: [{ session: 'scene', writer: WRITER, doc, size: SIZE }], capture: [1] });

/** `view3d` (#378): frame 0 of the session document, captured, its final written as a PNG. */
export const view3dCall = (doc: string): JsonObject =>
  ({ call: 'view3d', doc, look: LOOK, size: SIZE, frames: 1, capture: [0], targets: ['final'] });

/** The `final` a `canonical` reply names. */
export function canonicalFinal(reply: JsonObject): string | null {
  answered(reply, 'the canonical call');
  return typeof reply['final'] === 'string' ? reply['final'] : null;
}

/** The `final` of the session's view on frame 1 of a `live` reply. */
export function liveFinal(reply: JsonObject): string | null {
  answered(reply, 'the live call');
  const frames = arr(reply['frames'], 'the live call: frames').map((f, i) => obj(f, `the live call: frames[${i}]`));
  const frame = frames.find((f) => f['frame'] === 1);
  expect(frame, `the live call presented frame 1: ${JSON.stringify(reply).slice(0, 1500)}`).toBeDefined();
  const views = arr(frame!['views'], 'the live call: frame 1 views').map((v, i) => obj(v, `the live call: frame 1 views[${i}]`));
  const view = views.find((v) => v['session'] === 'scene');
  expect(view, `the live call: frame 1 has the session's view: ${JSON.stringify(frame).slice(0, 1500)}`).toBeDefined();
  return typeof view!['final'] === 'string' ? view!['final'] : null;
}

/** The `final` of frame 0 of a `view3d` reply. */
export function view3dFinal(reply: JsonObject): string | null {
  answered(reply, 'the view3d call');
  const frames = arr(reply['frames'], 'the view3d call: frames').map((f, i) => obj(f, `the view3d call: frames[${i}]`));
  const frame = frames.find((f) => f['frame'] === 0);
  expect(frame, `the view3d call presented frame 0: ${JSON.stringify(reply).slice(0, 1500)}`).toBeDefined();
  return typeof frame!['final'] === 'string' ? frame!['final'] : null;
}

// ---------------------------------------------------------------------------------------------------
// PNGs: each final is an 8-bit RGBA PNG under the scenario's `out`, named by the SHA-256 of its bytes.

interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8;
  let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('latin1', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = previous[i]!;
      const c = i >= channels ? previous[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw Error(`PNG filter ${filter}`);
      }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!;
      rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}

/** The final a reply named: written, named by its SHA-256, 320 × 240. */
export function readFinal(out: string, name: string | null, what: string): Image {
  expect(name, `${what} is written (its reply names a final)`).not.toBeNull();
  expect(name, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${name}.png`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(name);
  const image = decodePng(file);
  expect([image.width, image.height], `${what} is ${SIZE[0]} × ${SIZE[1]}`).toEqual(SIZE);
  return image;
}

const at = (image: Image, [x, y]: [number, number]): number[] => Array.from(image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

// ---------------------------------------------------------------------------------------------------
// The comparison every criterion makes.

/**
 * `ours` (the `canonical` or `live` final) against `view3d`'s frame 0 of the same document: every 8-bit channel of
 * every pixel within 2 levels. Fails, naming the criterion, with the count of pixels over 2, the worst difference and
 * the subject centre's values on both sides. Before comparing, view3d's subject centre must be lit, so two empty or
 * fully shadowed frames never pass.
 */
export function expectWithin(criterion: string, label: string, ours: Image, view3d: Image): void {
  const centreTheirs = at(view3d, CENTRE);
  expect(
    centreTheirs.slice(0, 3).every((v) => v >= LIT),
    `${criterion}: view3d's frame 0 lights the subject: its centre (${CENTRE.join(', ')}) reads ${JSON.stringify(centreTheirs)}, each colour channel at least ${LIT}`,
  ).toBe(true);
  let over = 0;
  let worst = 0;
  let worstAt = [0, 0, 0];
  const n = SIZE[0] * SIZE[1];
  for (let p = 0; p < n; p++) {
    let pixel = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(ours.rgba[p * 4 + c]! - view3d.rgba[p * 4 + c]!);
      if (d > pixel) pixel = d;
      if (d > worst) { worst = d; worstAt = [p % SIZE[0], Math.floor(p / SIZE[0]), c]; }
    }
    if (pixel > LEVELS) over++;
  }
  const centreOurs = at(ours, CENTRE);
  expect(
    over,
    `${criterion}: ${label}'s final is within ${LEVELS} levels of view3d's frame 0 in every 8-bit channel of every pixel; `
      + `${over} of ${n} pixels differ by more than ${LEVELS}, the worst by ${worst} levels (at (${worstAt[0]}, ${worstAt[1]}), channel ${'RGBA'[worstAt[2]!]}); `
      + `at the subject's centre (${CENTRE.join(', ')}) ${label} reads ${JSON.stringify(centreOurs)} and view3d reads ${JSON.stringify(centreTheirs)}`,
  ).toBe(0);
}
