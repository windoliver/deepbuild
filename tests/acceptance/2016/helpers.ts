// Test-side tools for the #2016 acceptance tests: `deep-gpu` (#377's binary, the shipped build) built once per file
// and driven by JSON lines on the Metal device through `view3d` (#378's call, with #380's `from` seek), with the one
// field this suite adds to it (README: The surface under test): `sway`, which reads back, per frame, each named
// tree's vertex positions and gust term as the GPU computed them. Also the issue's field as a session document (its
// sway on, or switched off for the trees' rest positions), the field's layout and its pairs, and vector arithmetic.
// Nothing here stands in for the sway, its noise or the renderer: every number a test judges comes from the GPU.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2016 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const BIN = 'deep-gpu';
/** The shipped build: `view3d` and its `sway` report need no test feature (README: Run them). */
const BUILD = ['build', '--locked', '--bin', BIN];
/** cargo isn't on PATH on this Mac: the pinned toolchain's folder goes first. */
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));

// ---------------------------------------------------------------------------------------------------
// The criterion's numbers, and this suite's (README: Readings).

/** "a 5 m/s wind". */
export const WIND_SPEED = 5;
/** "gusts at 20 m scale". */
export const GUST_SCALE = 20;
/** "a tree 20 m downwind". */
export const DOWNWIND_M = 20;
/** "… equals the upwind tree's 4 s earlier". */
export const EARLIER_S = 4;
/** "… within 1e-4". */
export const GUST_TOLERANCE = 1e-4;
/** "trees 2 m apart". */
export const NEIGHBOUR_M = 2;
/** "lean within 10% of each other". */
export const LEAN_SHARE = 0.1;
/** The trees' `amount` (this suite's: 0.3 m, so a sway shows in a 320 × 240 frame). */
export const AMOUNT = 0.3;
/** Frames are drawn at 8 fps (a valid rate): frame n is at n ÷ 8 s, so 4 s is 32 frames, exactly. */
export const FPS = 8;
/** The run is frames 0 … 96: 0 to 12 s. */
export const LAST = 96;
/** 4 s in frames. */
export const EARLIER_FRAMES = EARLIER_S * FPS;
/** Every render is 320 × 240. */
const SIZE: [number, number] = [320, 240];

// ---------------------------------------------------------------------------------------------------
// JSON

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
function v3(value: JsonValue | undefined, what: string): V3 {
  const a = arr(value, what);
  expect(a.length, `${what} is [x, y, z]`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}

/** A test that can't be judged here fails with this, never passes. */
function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

/** The criterion reads what the GPU computes and draws on macOS's Metal device: off macOS a test fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the criterion reads the GPU sway on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: the shipped `deep-gpu`, built once per file with incremental builds and debug info off.

/** Builds once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2016-bin-'));
    const env = { ...process.env, PATH: `${TOOLCHAIN}${delimiter}${process.env['PATH'] ?? ''}`, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
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

/** One output folder for the file (the documents it writes), deleted after its tests. */
export function useOut(): () => string {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2016-')); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running: `deep-gpu run` on the Metal device, one scenario `{out, calls}` per process, one reply per call.

function run(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const shown = `${BIN} run`;
  const s = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
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

// ---------------------------------------------------------------------------------------------------
// The field (README: Fixtures): a session document of 36 identical trees, each with the same mod.sway@1.

const LOOK = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
const FIELD = JSON.parse(readFileSync(join(HERE, 'fixtures', 'field.json'), 'utf8')) as JsonObject;

export interface Tree { id: string; pos: V3 }

/** The field's trees, by their `at.pos`, after checking the fixture holds what the README says. */
export function trees(): Tree[] {
  const items = obj(FIELD['items'], 'the field: items');
  const out: Tree[] = [];
  let first = '';
  for (const [id, item] of Object.entries(items)) {
    const it = obj(item, `the field: items.${id}`);
    if (it['kind'] !== 'lathe@1') continue;
    const same = JSON.stringify({ params: it['params'], material: it['material'], modifiers: it['modifiers'] });
    if (!first) first = same;
    expect(same, `the field's trees are identical: ${id} has the first tree's params, material and modifiers`).toBe(first);
    out.push({ id, pos: v3(obj(it['at'], `the field: items.${id}.at`)['pos'], `the field: items.${id}.at.pos`) });
  }
  expect(out.length, 'the field holds 36 trees').toBe(36);
  const sway = obj(arr(obj(items[out[0]!.id], 'a tree')['modifiers'], 'a tree: modifiers')[0], 'a tree: its sway');
  expect(sway['kind'], 'each tree has one mod.sway@1').toBe('mod.sway@1');
  const params = obj(sway['params'], 'the sway: params');
  expect(params['amount'], 'the sway: amount').toBe(AMOUNT);
  expect(obj(params['wind'], 'the sway: wind')['speed'], 'the sway: a 5 m/s wind').toBe(WIND_SPEED);
  expect(obj(params['wind'], 'the sway: wind')['direction'], 'the sway: the wind blows toward +x (0°)').toBe(0);
  expect(obj(obj(params['wind'], 'the sway: wind')['gust'], 'the sway: gust')['scale'], 'the sway: gusts at 20 m scale').toBe(GUST_SCALE);
  return out;
}

/** The pairs of trees `apart` metres apart: along the wind (+x) only, or along either axis of the grid. */
export function pairs(field: Tree[], apart: number, alongWindOnly: boolean): [Tree, Tree][] {
  const out: [Tree, Tree][] = [];
  for (const a of field) {
    for (const b of field) {
      const dx = b.pos[0] - a.pos[0]; const dz = b.pos[2] - a.pos[2];
      if (dx === apart && dz === 0) out.push([a, b]);
      else if (!alongWindOnly && dx === 0 && dz === apart) out.push([a, b]);
    }
  }
  return out;
}

/** The field as a session document, written under `dir`; with `swaying: false` every tree's sway is `enabled: false`. */
export function writeField(dir: string, swaying: boolean): string {
  const doc = JSON.parse(JSON.stringify(FIELD)) as JsonObject;
  if (!swaying) {
    for (const item of Object.values(obj(doc['items'], 'the field: items'))) {
      const it = obj(item, 'an item');
      if (it['kind'] === 'lathe@1') for (const m of arr(it['modifiers'], 'a tree: modifiers')) obj(m, 'a modifier')['enabled'] = false;
    }
  }
  const path = join(dir, swaying ? 'field.json' : 'field-still.json');
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `view3d` with `sway` (README: The surface under test).

export interface SwayRow { gust: number | null; positions: V3[] }
export interface Frame { frame: number; pixelHash: string | null; sway: Map<string, SwayRow> | null }

/** `view3d` on `doc` from frame `from` for `frames` frames at 8 fps, reporting `sway` for `ids`. */
export function view3d(bin: string, out: string, doc: string, from: number, frames: number, ids: string[], what: string): Frame[] {
  const call: JsonObject = { call: 'view3d', doc, look: LOOK, size: SIZE, fps: FPS, from, frames, sway: ids };
  const [reply] = run(bin, out, [call]);
  if (reply!['code'] === 'unsupported_platform') inconclusive(`${what}: view3d answered unsupported_platform`);
  expect(reply!['code'], `${what}: view3d is answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  const list = arr(reply!['frames'], `${what}: frames`).map((f, i): Frame => {
    const at = `${what}: frames[${i}]`;
    const fr = obj(f, at);
    const hash = fr['pixel_hash'];
    let sway: Map<string, SwayRow> | null = null;
    if (fr['sway'] !== undefined && fr['sway'] !== null) {
      sway = new Map(Object.entries(obj(fr['sway'], `${at}.sway`)).map(([id, row]) => {
        const r = obj(row, `${at}.sway.${id}`);
        const gust = r['gust'] === null ? null : num(r['gust'], `${at}.sway.${id}.gust`);
        const positions = arr(r['positions'], `${at}.sway.${id}.positions`).map((p, k) => v3(p, `${at}.sway.${id}.positions[${k}]`));
        return [id, { gust, positions }];
      }));
    }
    return { frame: num(fr['frame'], `${at}.frame`), pixelHash: typeof hash === 'string' ? hash : null, sway };
  });
  const want = Array.from({ length: frames }, (_, i) => from + i);
  expect(list.map((f) => f.frame), `${what}: frames ${from} … ${from + frames - 1}, in order`).toEqual(want);
  return list;
}

/**
 * The row `sway` reports for tree `id` in frame `f`. Fails, naming the frame, when the frame has no `sway` (the base
 * has none), when the tree is missing from it, or when it reports no vertex.
 */
export function rowOf(f: Frame, id: string, what: string): SwayRow {
  expect(f.sway, `${what}: frame ${f.frame} reports \`sway\`, the vertex positions and gust term the GPU computed (README: The surface under test)`).not.toBeNull();
  const row = f.sway!.get(id);
  expect(row, `${what}: frame ${f.frame}'s \`sway\` has tree ${id}`).toBeDefined();
  expect(row!.positions.length, `${what}: frame ${f.frame}: tree ${id} reports its vertices`).toBeGreaterThan(0);
  return row!;
}

/** The gust term of tree `id` in frame `f`, which must be reported (the tree's sway is on). */
export function gustOf(f: Frame, id: string, what: string): number {
  const row = rowOf(f, id, what);
  expect(row.gust, `${what}: frame ${f.frame}: tree ${id}, whose sway is on, reports its gust term`).not.toBeNull();
  return row.gust!;
}

// ---------------------------------------------------------------------------------------------------
// Vectors

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const fmt = (a: V3): string => `[${a.map((x) => x.toFixed(4)).join(', ')}]`;
