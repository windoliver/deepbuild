// Test-side tools for the #380 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`) built
// once per file and driven by JSON lines; the calls this suite adds (README: The surface under test) and
// their replies; the scenes these tests draw, generated here so every item is readable; PNG and f32
// target reading; 10-bit code comparisons with a share, a ceiling and a window; the pinhole projection;
// cargo metadata; and #377's reference-Mac gate with the design's judge for timing results. Each check a
// criterion's wrong program must fail returns its failures as sentences that name what failed. Nothing
// here stands in for the GPU layer, the effects module, the operator check, the golden store or the
// plug-in host under test.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/380 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** The criteria's numbers (the issue's text). */
export const FRAME_GPU_MS = 2;
export const CODE10_SHARE = 0.999;
export const BLANK_LUMA = 0.06;
export const BLANK_COVERAGE = 0.98;

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)}`).toBe('boolean');
  return value as boolean;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-gpu`, once per file, copied out of target/debug.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Bins { bin: () => string }
/** Builds the binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBin(): Bins {
  let dir = '';
  let made: { bin: string; error: string } | null = null;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-380-bins-'));
    const error = cargoBuild();
    const bin = join(dir, exe(BIN));
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(BIN)), bin);
    made = { bin, error };
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(): string {
      expect(made, 'the file built the binary').not.toBeNull();
      expect(made!.error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
      return made!.bin;
    },
  };
}

/** A fresh output folder per test (targets, captures, records, stores, generated documents), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-380-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop] [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted =
  | 'host_unclipped' | 'slow_glow' | 'compares_any_environment' | 'fails_missing_snapshot' | 'skips_operator_check'
  | 'noise_from_frame_counter' | 'noise_from_clock' | 'pass_off_by_two' | 'bloom_without_karis' | 'passes_one_gpu';
export interface Startup { backend?: 'noop'; planted?: Planted }
export const startArgs = (s: Startup = {}): string[] =>
  ['run', ...(s.backend ? ['--backend', s.backend] : []), ...(s.planted ? ['--planted', s.planted] : [])];

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** One scenario, accepted, with one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], startup: Startup = {}, timeoutMs?: number): JsonObject[] {
  const args = startArgs(startup);
  const s = start(bin, args, [{ out, calls }], timeoutMs);
  const name = `${BIN} ${args.join(' ')}`;
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
export const run1 = (bin: string, out: string, call: JsonObject, startup: Startup = {}, timeoutMs?: number): JsonObject =>
  run(bin, out, [call], startup, timeoutMs)[0]!;

/** Fails with an INCONCLUSIVE message off macOS: these pixels come from the GPU layer on the reference platform's Metal device. */
export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: the GPU layer draws these pixels on macOS\'s Metal device, the reference platform; this is not a pass').toBe('darwin');
}
/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Fixtures, looks and documents

export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);
export function fixture(...parts: string[]): JsonObject {
  const value = JSON.parse(readFileSync(fixturePath(...parts), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${parts.join('/')} is not a JSON object`);
  return value;
}
/** The suite's look (fixtures/look.json) with the fields a test changes. */
export const look = (change: JsonObject = {}): JsonObject => ({ ...fixture('look.json'), ...change });
/** The look's bloom as the glow fixtures set it (Look `look@1`: bloom). */
export const BLOOM: JsonObject = { intensity: 0.3, radius: 0.85 };
/** The look's ground grid as the fixtures set it (Look `look@1`: ground grid in 3D), 1 mm over the floor's top. */
export const GRID: JsonObject = { kind: 'grid', height: 0.001, spacing: 1, major_every: 5, width: 1, fade: 'auto', roles: { minor: 'grid-minor', major: 'grid-major', axis: 'grid-axis' } };

/** Writes a JSON file under the test's output folder and returns its path. */
export function writeJson(out: string, name: string, value: JsonValue): string {
  const path = join(out, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

const box = (id: string, order: string, size: [number, number, number], pos: [number, number, number], role: string, name: string): JsonObject =>
  ({ id, kind: 'mark.box@1', name, order, params: { size, paint: { fill: { role } } }, at: { pos } });
const sun = (shadow: boolean): JsonObject =>
  ({ id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'a9', params: { illuminance: Math.PI, shadow, angle: 0.53 }, at: { rot: [-55, -40, 0] } });
const sparks = (): JsonObject => ({
  id: 'sparks', kind: 'particles@1', name: 'Sparks', order: 'b0',
  params: {
    count: 2048, emit: { anchor: 'lamp', shape: 'point', rate: 1200, span: 10 }, life: [0.8, 1.6],
    motion: { ballistic: { v0: [2, 4], gravity: [0, -9.8, 0], drag: 0.2 } },
    size: 3, opacity: 1, color: [{ at: 0, role: 'spark-a' }, { at: 1, role: 'spark-b' }], draw: 'dot',
  },
  at: { pos: [0, 1.05, 0] },
});

/** The shipped effects these tests require, by the `effect` name the operators call gives each. */
export const EFFECTS = ['glow', 'shadow', 'outline', 'grid', 'particles'] as const;
export type Effect = (typeof EFFECTS)[number] | 'all';

export interface Scene { doc: JsonObject; look: JsonObject; selection: string[] }
/**
 * A box on a floor under a sun, at 480 × 360 (or `size`), seen by a perspective camera that orbits it at
 * 60° a second (a channel on `items/cam/params/orbit/azimuth`), with one shipped effect on: `glow` (the
 * look's bloom), `shadow` (the sun casts), `outline` (the lamp selected), `grid` (the look's ground grid),
 * `particles` (sparks from the lamp's top), a list of them, or `all`. Every other effect is off. One writer layer.
 */
export function effectScene(effects: Effect | Effect[], opts: { size?: [number, number]; seed?: number; boxes?: number; span?: number; rate?: number } = {}): Scene {
  const size = opts.size ?? [480, 360];
  const list = Array.isArray(effects) ? effects : [effects];
  const on = (e: Exclude<Effect, 'all'>): boolean => list.includes(e) || list.includes('all');
  const effect = list.join('-');
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0.4, 0], orbit: { azimuth: 30, elevation: 25, distance: 7 }, fov: 40, near: 0.1 } },
    floor: box('floor', 'a1', [12, 0.1, 12], [0, -0.05, 0], 'floor', 'Floor'),
    lamp: box('lamp', 'a2', [1, 1, 1], [0, 0.5, 0], 'lamp', 'Lamp'),
    block: box('block', 'a3', [0.6, 0.6, 0.6], [-1.6, 0.3, 0.8], 'block', 'Block'),
    crate: box('crate', 'a4', [0.7, 0.7, 0.7], [1.4, 0.35, -0.6], 'crate', 'Crate'),
    sun: sun(on('shadow')),
  };
  const extra = Math.max(0, (opts.boxes ?? 0));
  for (let i = 0; i < extra; i++) {
    const x = (i % 4) * 2.2 - 3.3; const z = -2.5 - Math.floor(i / 4) * 2.2;
    items[`post${i}`] = box(`post${i}`, `c${String(i).padStart(2, '0')}`, [0.5, 1.2, 0.5], [x, 0.6, z], i % 2 ? 'post' : 'block', `Post ${i}`);
  }
  if (on('particles')) items['sparks'] = sparks();
  for (const v of Object.values(items)) if (isObject(v)) v['layer'] = 'main';
  const span = opts.span ?? 2;
  const rate = opts.rate ?? 60;
  const doc: JsonObject = {
    format: 1, id: `effects-380-${effect}`, profile: 'scene', title: `Shipped effect: ${effect}`,
    description: `A lamp box on a floor under a sun, orbited by the camera, with the shipped ${list.includes('all') ? 'glow, shadows, outlines, ground grid and particles' : list.join(', ')} on.`,
    size, camera: 'cam', transport: { span: `${span}s` },
    requires: { modules: { scene3d: '^1', effects: '^1' } },
    ...(opts.seed === undefined ? {} : { seed: opts.seed }),
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items,
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: `${span}s`, value: 30 + rate * span, interp: 'linear' } } } },
  };
  const lookChange: JsonObject = {};
  if (on('glow')) lookChange['bloom'] = BLOOM;
  if (on('grid')) lookChange['ground_3d'] = GRID;
  return { doc, look: look(lookChange), selection: on('outline') ? ['lamp'] : [] };
}

/** A document a plug-in hands the canvas (no layers), as a session holds it: one layer, the writer's, and every item in it. */
export function asSession(doc: JsonObject, writer: string): JsonObject {
  const d = clone(doc);
  d['layers'] = { main: { writer, title: 'Main', order: 'a0' } };
  for (const v of Object.values(obj(d['items'], 'the document\'s items'))) if (isObject(v)) v['layer'] = 'main';
  return d;
}

// ---------------------------------------------------------------------------------------------------
// The view3d call (#378's, with this suite's fields: selection, from, timings)

export interface View3Call {
  doc: string; look: JsonObject; size: [number, number];
  frames?: number; fps?: number; from?: number; selection?: string[];
  targets?: ('final' | 'linear' | 'ids')[]; capture?: 'every' | number[]; timings?: boolean;
}
export const view3d = (c: View3Call): JsonObject => ({ call: 'view3d', ...(c as unknown as JsonObject) });

export interface Frame3 {
  frame: number; pixel_hash: string | null; final: string | null; linear: string | null; ids: string | null;
  picks: Map<number, string> | null; gpu_ms: number | null; passes_ms: Map<string, number> | null;
}
export interface Pass { name: string; reads: string[]; writes: string[]; operator: string | null }
export interface View3 { frames: Frame3[]; passes: Pass[]; profiler: { name: string; version: string } | null; raw: JsonObject }

const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));

export function view3Reply(reply: JsonObject, what = 'the view3d call'): View3 {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): Frame3 => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}]`;
    const pixel = optStr(f['pixel_hash'], `${at}.pixel_hash`);
    if (pixel !== null) expect(pixel, `${at}.pixel_hash is a SHA-256 in lowercase hex`).toMatch(SHA);
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    let passesMs: Map<string, number> | null = null;
    if (isObject(f['passes_ms'])) passesMs = new Map(Object.entries(f['passes_ms']).map(([k, ms]) => [k, num(ms, `${at}.passes_ms[${k}]`)]));
    return {
      frame: num(f['frame'], `${at}.frame`), pixel_hash: pixel, final: optStr(f['final'], `${at}.final`), linear: optStr(f['linear'], `${at}.linear`),
      ids: optStr(f['ids'], `${at}.ids`), picks, gpu_ms: optNum(f['gpu_ms'], `${at}.gpu_ms`), passes_ms: passesMs,
    };
  });
  const passes = arr(reply['passes'] ?? [], `${what}: passes`).map((v, i): Pass => {
    const p = obj(v, `${what}: passes[${i}]`);
    return { name: str(p['name'], `${what}: passes[${i}].name`), reads: strs(p['reads'], `${what}: passes[${i}].reads`), writes: strs(p['writes'], `${what}: passes[${i}].writes`), operator: optStr(p['operator'], `${what}: passes[${i}].operator`) };
  });
  const prof = isObject(reply['profiler']) ? reply['profiler'] : null;
  const profiler = prof ? { name: str(prof['name'], `${what}: profiler.name`), version: str(prof['version'], `${what}: profiler.version`) } : null;
  return { frames, passes, profiler, raw: reply };
}
export function frameAt(v: View3, n: number, what: string): Frame3 {
  const f = v.frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${v.frames.map((x) => x.frame).slice(0, 8).join(', ')}…)`).toBeDefined();
  return f!;
}

/** Draws a scene's frame 0 and returns its final frame (and linear and ID targets when asked). */
export function drawScene(bin: string, out: string, scene: Scene, name: string, opts: { targets?: ('final' | 'linear' | 'ids')[]; startup?: Startup } = {}): { view: View3; frame: Frame3; final: Image; ids: Ids | null } {
  const doc = writeJson(out, `${name}.json`, scene.doc);
  const size = scene.doc['size'] as [number, number];
  const targets = opts.targets ?? ['final', 'ids'];
  const reply = run1(bin, out, view3d({ doc, look: scene.look, size, selection: scene.selection, targets, capture: [0] }), opts.startup);
  const view = view3Reply(reply, name);
  const frame = frameAt(view, 0, name);
  const final = readPng(out, frame.final, `${name}: frame 0's final frame`);
  expect(slotHashOf(final), `${name}: the final frame is the slot frame 0's pixel_hash names`).toBe(frame.pixel_hash);
  return { view, frame, final, ids: targets.includes('ids') ? readIds(out, frame, `${name}: frame 0's ID target`) : null };
}

// ---------------------------------------------------------------------------------------------------
// The operators call (README: operators)

export interface Ported { files: string[]; from: string; license: string; notice: string }
export interface Operator { name: string; kind: string; origin: string; effect: string | null; determinism: string; noise: boolean; ported: Ported[]; fixture: string | null }
export function operatorsReply(reply: JsonObject, what = 'the operators call'): Operator[] {
  answered(reply, what);
  return arr(reply['operators'], `${what}: operators`).map((v, i) => {
    const o = obj(v, `${what}: operators[${i}]`);
    const at = `${what}: operators[${i}]`;
    return {
      name: str(o['name'], `${at}.name`), kind: str(o['kind'], `${at}.kind`), origin: str(o['origin'], `${at}.origin`),
      effect: optStr(o['effect'], `${at}.effect`), determinism: str(o['determinism'], `${at}.determinism`), noise: bool(o['noise'], `${at}.noise`),
      fixture: optStr(o['fixture'], `${at}.fixture`),
      ported: arr(o['ported'], `${at}.ported`).map((p, j) => {
        const q = obj(p, `${at}.ported[${j}]`);
        return { files: strs(q['files'], `${at}.ported[${j}].files`), from: str(q['from'], `${at}.ported[${j}].from`), license: str(q['license'], `${at}.ported[${j}].license`), notice: str(q['notice'], `${at}.ported[${j}].notice`) };
      }),
    };
  });
}
export const OPERATORS: JsonObject = { call: 'operators' };
/** The shipped operators, with each required effect present exactly once, by its `effect` name. */
export function shippedEffects(ops: Operator[], what: string): Map<string, Operator> {
  const shipped = ops.filter((o) => o.origin === 'shipped');
  const byEffect = new Map<string, Operator>();
  for (const o of shipped) if (o.effect) byEffect.set(o.effect, o);
  for (const e of EFFECTS) expect(byEffect.has(e), `${what}: the shipped library holds the ${e} effect as a GPU operator (effects listed: ${[...byEffect.keys()].join(', ') || 'none'})`).toBe(true);
  for (const o of shipped) expect(['material', 'pass', 'compute'], `${what}: ${o.name} is one of the three operator kinds`).toContain(o.kind);
  for (const o of shipped) expect(['exact', 'same_machine', 'live_only'], `${what}: ${o.name} names its determinism class`).toContain(o.determinism);
  return byEffect;
}

// ---------------------------------------------------------------------------------------------------
// PNG, f32 targets and the ID target

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes: Buffer): number { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4); head.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(typed));
  return Buffer.concat([head, typed, tail]);
}
/** An 8-bit RGBA PNG of an image. */
export function encodePng(image: Image): Buffer {
  const { width, height, rgba } = image;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (1 + width * 4) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace; `channels` is the file's own. */
export function decodePng(file: Buffer): Image & { channels: number } {
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
  return { width, height, rgba, channels };
}
function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written`).not.toBeNull();
  expect(hash, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));
export const pngPath = (out: string, hash: string): string => join(out, `${hash}.png`);
/** Writes an image as an RGBA PNG under dir; returns its path. */
export function writePng(dir: string, name: string, image: Image): string {
  const path = join(dir, `${name}.png`);
  writeFileSync(path, encodePng(image));
  return path;
}
/** The slot's bytes as `pixel_hash` hashes them: BGRA8, rows top-down, no padding. */
export function slotHashOf(image: Image): string {
  const bgra = Buffer.alloc(image.rgba.length);
  for (let i = 0; i < image.rgba.length; i += 4) { bgra[i] = image.rgba[i + 2]!; bgra[i + 1] = image.rgba[i + 1]!; bgra[i + 2] = image.rgba[i]!; bgra[i + 3] = image.rgba[i + 3]!; }
  return sha256(bgra);
}
export interface F32 { width: number; height: number; rgba: Float32Array }
/** A target as read back: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export function readF32(out: string, hash: string | null, size: [number, number], what: string): F32 {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const rgba = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = file.readFloatLE(i * 4);
  return { width: size[0], height: size[1], rgba };
}
export function writeF32(dir: string, name: string, image: F32): string {
  const buf = Buffer.alloc(image.rgba.length * 4);
  for (let i = 0; i < image.rgba.length; i++) buf.writeFloatLE(image.rgba[i]!, i * 4);
  const path = join(dir, `${name}.f32`);
  writeFileSync(path, buf);
  return path;
}

/** The object-ID target: an 8-bit RGBA PNG whose pixel holds pick ID r + 2^8 g + 2^16 b + 2^24 a (0: nothing drawn). */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: Frame3, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(png.channels, `${what} is an RGBA PNG`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  const count = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    const id = pick === 0 ? null : f.picks!.get(pick) ?? null;
    items[i] = id;
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  }
  return { width: png.width, height: png.height, count, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}

/** Pixels of `image` within the rect [x, y, w, h], as a new image. */
export function crop(image: Image, [x0, y0, w, h]: [number, number, number, number]): Image {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(image.rgba.subarray(((y0 + y) * image.width + x0) * 4, ((y0 + y) * image.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, rgba };
}
/** Rec. 709 luma of an 8-bit pixel over 255. */
export const luma = (image: Image, x: number, y: number): number => {
  const o = (y * image.width + x) * 4;
  return (0.2126 * image.rgba[o]! + 0.7152 * image.rgba[o + 1]! + 0.0722 * image.rgba[o + 2]!) / 255;
};
/** The share of an image's pixels at luma ≤ 0.06: at least 98% is blank or black (the blank guard's measure). */
export function blankShare(image: Image): number {
  let dark = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (luma(image, x, y) <= BLANK_LUMA) dark++;
  return dark / (image.width * image.height);
}
export function expectNotBlank(image: Image, what: string): void {
  const share = blankShare(image);
  expect(share < BLANK_COVERAGE, `BLOCKED: ${what} is blank or black (${(share * 100).toFixed(2)}% of its pixels at luma ≤ ${BLANK_LUMA}), so it can't be compared`).toBe(true);
}
/** Largest per-channel difference per pixel between two images of one size. */
export function diffs8(a: Image, b: Image): Uint8Array {
  expect([a.width, a.height], 'the two images are one size').toEqual([b.width, b.height]);
  const d = new Uint8Array(a.width * a.height);
  for (let i = 0; i < d.length; i++) d[i] = Math.max(Math.abs(a.rgba[i * 4]! - b.rgba[i * 4]!), Math.abs(a.rgba[i * 4 + 1]! - b.rgba[i * 4 + 1]!), Math.abs(a.rgba[i * 4 + 2]! - b.rgba[i * 4 + 2]!));
  return d;
}

// ---------------------------------------------------------------------------------------------------
// 10-bit code values (criterion 8) and the comparison with its share, ceiling and window

export const clamp01 = (x: number): number => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));
export const srgbEncode = (x: number): number => { const v = clamp01(x); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
/** A channel's 10-bit code: a linear value is sRGB-encoded first, a display-referred one is taken as it is. */
export const code10 = (v: number, encoding: 'linear' | 'display'): number => Math.round(1023 * (encoding === 'linear' ? srgbEncode(v) : clamp01(v)));

/** The tolerance criterion 8 states, with the ceiling and the window bound every share sets (README: Readings). */
export const TOLERANCE10 = {
  within: 1, share: CODE10_SHARE, ceiling: 4, window: { size: 16, off: 8 },
  reason: 'one 10-bit code per channel on 99.9% of pixels (the issue); no pixel past one 8-bit code (4 codes), and no 16 × 16 window with more than 8 pixels off, so a wrong small feature can\'t hide inside the 0.1%',
} as const;
/** GPU against CPU in 10-bit codes per channel; each problem names the operator. */
export function code10Problems(gpu: F32, cpu: F32, encoding: 'linear' | 'display', operator: string): { problems: string[]; off: number; worst: number } {
  const { width: w, height: h } = gpu;
  const off = new Uint8Array(w * h);
  let count = 0; let worst = 0; let first = ''; let firstPast = '';
  for (let i = 0; i < w * h; i++) {
    let d = 0;
    for (let c = 0; c < 4; c++) {
      const g = code10(gpu.rgba[i * 4 + c]!, c === 3 ? 'display' : encoding); const r = code10(cpu.rgba[i * 4 + c]!, c === 3 ? 'display' : encoding);
      d = Math.max(d, Math.abs(g - r));
    }
    worst = Math.max(worst, d);
    if (d > TOLERANCE10.within) { off[i] = 1; count++; if (!first) first = `(${i % w}, ${Math.floor(i / w)}) by ${d} codes`; }
    if (d > TOLERANCE10.ceiling && !firstPast) firstPast = `(${i % w}, ${Math.floor(i / w)}) by ${d} codes`;
  }
  const problems: string[] = [];
  const allowed = Math.floor((1 - TOLERANCE10.share) * w * h);
  if (count > allowed) problems.push(`operator ${operator}: ${count} of ${w * h} pixels are more than ${TOLERANCE10.within} 10-bit code from its CPU reference (allowed ${allowed}; first ${first})`);
  if (firstPast) problems.push(`operator ${operator}: a pixel is past the ceiling of ${TOLERANCE10.ceiling} codes, at ${firstPast}`);
  const s = TOLERANCE10.window.size;
  outer: for (let y0 = 0; y0 + s <= h; y0 += s / 2) for (let x0 = 0; x0 + s <= w; x0 += s / 2) {
    let n = 0;
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) n += off[y * w + x]!;
    if (n > TOLERANCE10.window.off) { problems.push(`operator ${operator}: the ${s} × ${s} window at (${x0}, ${y0}) holds ${n} pixels off (at most ${TOLERANCE10.window.off})`); break outer; }
  }
  return { problems, off: count, worst };
}

// ---------------------------------------------------------------------------------------------------
// A pinhole camera, as #372's and #378's suites project: position, target, +Y up, fov across the frame's
// wider side, pixel centres at +0.5, y down.

export type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
export function project(cam: { position: V3; target: V3; fov: number; size: [number, number] }, p: V3): [number, number, number] {
  const f = norm(sub(cam.target, cam.position)); const r = norm(cross(f, [0, 1, 0])); const u = cross(r, f);
  const d = sub(p, cam.position); const z = dot(d, f);
  const focal = Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z, z];
}

// ---------------------------------------------------------------------------------------------------
// The golden store and decisions (README: golden, decide)

export interface Fingerprint { os: string; gpu: string; driver: string; wgpu: string }
export interface Golden { verdict: string; reason: string | null; fingerprint: Fingerprint; golden: { fingerprint: Fingerprint } | null; numbers: JsonObject | null; ask: JsonObject | null; raw: JsonObject }
function fingerprint(v: JsonValue | undefined, what: string): Fingerprint {
  const f = obj(v, what);
  return { os: str(f['os'], `${what}.os`), gpu: str(f['gpu'], `${what}.gpu`), driver: str(f['driver'], `${what}.driver`), wgpu: str(f['wgpu'], `${what}.wgpu`) };
}
export function goldenReply(reply: JsonObject, what: string): Golden {
  answered(reply, what);
  const verdict = str(reply['verdict'], `${what}: verdict`);
  expect(['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE'], `${what}: the verdict is one of the four`).toContain(verdict);
  const g = reply['golden'];
  return {
    verdict, reason: optStr(reply['reason'], `${what}: reason`), fingerprint: fingerprint(reply['fingerprint'], `${what}: fingerprint`),
    golden: isObject(g) ? { fingerprint: fingerprint(g['fingerprint'], `${what}: golden.fingerprint`) } : null,
    numbers: isObject(reply['numbers']) ? reply['numbers'] : null, ask: isObject(reply['ask']) ? reply['ask'] : null, raw: reply,
  };
}
export const goldenCall = (store: string, fixtureName: string, snapshot: { png: string } | { view3d: JsonObject }, environment?: Partial<Fingerprint>): JsonObject =>
  ({ call: 'golden', store, fixture: fixtureName, ...snapshot, ...(environment ? { environment } : {}) } as JsonObject);
export const blessCall = (store: string, fixtureName: string, png: string, via: 'you' | 'agent'): JsonObject =>
  ({ call: 'decide', store, via, decision: { bless: { fixture: fixtureName, png } } });

// ---------------------------------------------------------------------------------------------------
// cargo metadata and Cargo.lock

export interface Package { name: string; version: string; id: string; manifest: string; deps: { name: string; kind: string | null }[] }
export interface Metadata { packages: Package[]; members: Set<string>; nodes: Map<string, { deps: { pkg: string; kinds: (string | null)[] }[] }> }
export function cargoMetadata(): Metadata {
  const text = execFileSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const m = JSON.parse(text) as { packages: { name: string; version: string; id: string; manifest_path: string; dependencies: { name: string; kind: string | null }[] }[]; workspace_members: string[]; resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] } };
  return {
    packages: m.packages.map((p) => ({ name: p.name, version: p.version, id: p.id, manifest: p.manifest_path, deps: p.dependencies.map((d) => ({ name: d.name, kind: d.kind })) })),
    members: new Set(m.workspace_members),
    nodes: new Map(m.resolve.nodes.map((n) => [n.id, { deps: n.deps.map((d) => ({ pkg: d.pkg, kinds: d.dep_kinds.map((k) => k.kind) })) }])),
  };
}
/** Every package in the normal dependency closure of `rootId` (any target), by id. */
export function normalClosure(meta: Metadata, rootId: string): Set<string> {
  const seen = new Set<string>([rootId]);
  const todo = [rootId];
  while (todo.length) {
    const id = todo.pop()!;
    for (const d of meta.nodes.get(id)?.deps ?? []) if (d.kinds.includes(null) && !seen.has(d.pkg)) { seen.add(d.pkg); todo.push(d.pkg); }
  }
  return seen;
}
/** The workspace member whose crate holds the `deep-gpu` binary. */
export function binaryPackage(meta: Metadata): Package | undefined {
  return meta.packages.filter((p) => meta.members.has(p.id)).find((p) => {
    try { return /\[\[bin\]\][^[]*name\s*=\s*"deep-gpu"/s.test(readFileSync(p.manifest, 'utf8')); } catch { return false; }
  });
}

// ---------------------------------------------------------------------------------------------------
// Timing: #377's reference-Mac gate (with the owner's change: battery or mains alike) and the design's judge.

const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** This machine's GPU as `sysctl` names its chip (Apple silicon's GPU is the chip's). */
export const chipName = (): string => sh('sysctl', '-n', 'machdep.cpu.brand_string');
export const osVersion = (): string => sh('sw_vers', '-productVersion');
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model'); chip = chipName();
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g'); therm = sh('pmset', '-g', 'therm');
  } catch (e) { return `cannot read the machine: ${(e as Error).message}`; }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
const marginOf = (runs: number[]): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE (a skip). */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const margin = marginOf(runs);
  const line = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(line);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${line}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${line}`);
}
export function expectJudgedFail(name: string, runs: number[], limit: number): void {
  const margin = marginOf(runs);
  const line = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(line);
  expect(runs.every((r) => r > limit * (1 + margin)), `the planted program is judged FAIL: ${line}`).toBe(true);
}
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
