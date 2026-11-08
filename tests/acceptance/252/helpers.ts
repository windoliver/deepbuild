// Test-side tools for the #252 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`, #380's `golden` and
// `decide`, #429's operator check and #483's `read`) built once per file and driven by JSON lines; the three stepped
// fixtures (a flock of 262,144 boids, live fire and a soft blob) written as compute operators with declared carried
// storage, and the passes that show them, generated here so every step is readable; the reply readers; the
// reference-Mac gate and the design's judge for timings; and an animated PNG built from the canvas's own PNGs. Each
// check a planted twin must fail returns its failures as sentences that name what failed.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/252 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = { 1: '#252.e326cc65', 2: '#252.1d7d5564', 3: '#252.3f867a9b', 4: '#252.b3fac129' } as const;

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
export const objs = (v: JsonValue | undefined, what: string): JsonObject[] => arr(v, what).map((x, i) => obj(x, `${what}[${i}]`));
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${shown(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${shown(v)}`).toBe('string');
  return v as string;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A planted twin's check: it found problems, and they name what the criterion says they name. */
export function failsNaming(problems: string[], names: (string | RegExp)[], what: string): void {
  expect(problems.length, `${what} fails`).toBeGreaterThan(0);
  const text = problems.join('\n');
  for (const n of names) {
    if (typeof n === 'string') expect(text, `${what}'s failure names ${n}`).toContain(n);
    else expect(text, `${what}'s failure names ${String(n)}`).toMatch(n);
  }
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu`, built once per file and copied out of target/debug.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export function useBin(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-252-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
    return join(dir, BIN);
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-252-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'steps_per_frame' | 'ring_keeps_every_checkpoint' | 'carried_class_exact';

export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted, timeoutMs = 3_000_000): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const name = `${BIN} ${args.join(' ')}`;
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  expect(r.status, `${name} exited 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return expect.fail(`${name}: the answer is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const a = obj(answer, `${name}: the answer`);
  expect(a['ok'], `${name} refused the scenario: ${shown(a)}`).toBe(true);
  const replies = objs(a['replies'], 'run: replies');
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
/** A reply the binary answered, not refused; INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// The machine: Metal on macOS for anything the GPU runs; a reference Mac for timings.

const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
const REFERENCE_MACS = ['Mac15,7', 'Mac15,12'];
/** The reference Mac this is, or INCONCLUSIVE. Power and Low Power Mode aren't gated (the owner's rule); load is read by the judge. */
export function requireReferenceMac(): string {
  requireGpu();
  let model = '';
  try { model = sh('sysctl', '-n', 'hw.model'); } catch { /* unread */ }
  if (!REFERENCE_MACS.includes(model)) inconclusive(`not a reference Mac (Mac15,7 or Mac15,12): hw.model is ${model || 'unread'}`);
  return model;
}
/** The one-minute load per CPU core: above 1 the machine is loaded, and a timing that misses reads INCONCLUSIVE. */
export const loadPerCore = (): number => loadavg()[0]! / cpus().length;
/**
 * The design's judge for a timing limit (Every task carries its own budgets): five runs after warm-up on a reference
 * Mac; PASS when all five are within the limit, FAIL when all five are over it by more than the margin (the larger of
 * 5% and their spread) on a machine that isn't loaded, otherwise INCONCLUSIVE, which fails here with that word.
 */
export function judge(name: string, runs: number[], limit: number): void {
  requireReferenceMac();
  expect(runs.length, `${name}: five runs`).toBe(5);
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const line = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%, load ${loadPerCore().toFixed(2)} a core)`;
  console.log(line);
  if (runs.every((r) => r <= limit)) return;
  if (loadPerCore() > 1) inconclusive(`under load: ${line}`);
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${line}`).toBe(false);
  inconclusive(line);
}

// ---------------------------------------------------------------------------------------------------
// Operators, as #429's check takes them (`steps` as `{op: name@major, args}`), with this suite's fields (README:
// The surface under test): `stepped: {rate}` on a compute operator, `carry: {every, budget}` on a storage output, an
// input `{storage: {op, output, step: "previous"}}` and an input `{time: "step"}`.

export const step = (op: string, args: JsonObject = {}): JsonObject => ({ op, args });
const cvt = (x: string, to: string): JsonObject => step('convert@1', { x, to });
const bits = (x: string, to: string): JsonObject => step('bitcast@1', { x, to });
const pick = (x: string, p: string): JsonObject => step('split@1', { x, pick: p });

/** The fixed step rate, steps a second of document time; and the checkpoint spacing, the design's `every` default. */
export const RATE = 60;
export const EVERY = 60;
/** The design's checkpoint ring budget default (Checkpoint ring: `budget: bytes = 16 MiB`). */
export const DEFAULT_RING = 16 * 1024 * 1024;

/** A compute operator stepped once per fixed step at RATE. */
function stepped(id: string, about: string, inputs: JsonObject, steps: JsonObject, outputs: JsonObject, elements: number): JsonObject {
  return { id, kind: 'compute', origin: 'composed', about, inputs, steps, outputs, elements, workgroup: 256, stepped: { rate: RATE }, cost: { ns_per_element: 1 } };
}
/** A compute operator run once a frame, as every operator is today. */
function perFrame(id: string, about: string, inputs: JsonObject, steps: JsonObject, outputs: JsonObject, elements: number): JsonObject {
  return { id, kind: 'compute', origin: 'composed', about, inputs, steps, outputs, elements, workgroup: 256, cost: { ns_per_element: 1 } };
}
/** A full-resolution pass in the effects chain that replaces the frame's color with `out`. */
function view(id: string, about: string, inputs: JsonObject, steps: JsonObject): JsonObject {
  return {
    id, kind: 'pass', origin: 'composed', about, inputs, steps, outputs: { color: 'out', blend: 'replace' },
    chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 1 }, fallback: 'look',
  };
}
/** Carried storage as the previous step left it (zeros before the first step). */
const previous = (op: string, output: string, type: string, count: number): JsonObject => ({ type, count, from: { storage: { op, output, step: 'previous' } } });
/** Storage written earlier in this step or frame: a carried output reads as its latest step left it. */
const storage = (op: string, output: string, type: string, count: number): JsonObject => ({ type, count, from: { storage: { op, output } } });
/** The fixed step being computed, 0 for the first. */
const STEP_INDEX: JsonObject = { type: 'u32', from: { time: 'step' } };
/** A carried f32 storage output with its checkpoint ring. */
const carried = (count: number, budget: number): JsonObject => ({ storage: { type: 'f32', count }, carry: { every: EVERY, budget } });
/** A storage cell of a `size` × `size` grid from screen_uv, clamped into it: steps `cx`, `cy` and `cell` (row-major). */
function uvCell(size: number): JsonObject {
  return {
    uv: step('screen_uv@1'), u: pick('uv', 'x'), v: pick('uv', 'y'),
    us: step('mul@1', { a: 'u', b: size }), vs: step('mul@1', { a: 'v', b: size }), uf: step('floor@1', { x: 'us' }), vf: step('floor@1', { x: 'vs' }),
    uu: cvt('uf', 'u32'), vu: cvt('vf', 'u32'), cx: step('min@1', { a: 'uu', b: size - 1 }), cy: step('min@1', { a: 'vu', b: size - 1 }),
    crow: step('mul@1', { a: 'cy', b: size }), cell: step('add@1', { a: 'crow', b: 'cx' }),
  };
}
/** Element e of a `size` × `size` grid, row-major: `gx`, `gy` and its clamped neighbours' columns and rows. */
function gridSteps(size: number): JsonObject {
  return {
    e: step('element@1'), gx: step('rem@1', { a: 'e', b: size }), gy: step('div@1', { a: 'e', b: size }),
    xl0: step('max@1', { a: 'gx', b: 1 }), xl: step('sub@1', { a: 'xl0', b: 1 }), xr0: step('add@1', { a: 'gx', b: 1 }), xr: step('min@1', { a: 'xr0', b: size - 1 }),
    yu0: step('max@1', { a: 'gy', b: 1 }), yu: step('sub@1', { a: 'yu0', b: 1 }), yd0: step('add@1', { a: 'gy', b: 1 }), yd: step('min@1', { a: 'yd0', b: size - 1 }),
    gxf: cvt('gx', 'f32'), gyf: cvt('gy', 'f32'),
  };
}

// The flock ------------------------------------------------------------------------------------------

/** 262,144 boids, each three f32 words: x and y in [0, 1) on a torus, and a heading in radians. */
export const BOIDS = 262_144;
export const STATE_WORDS = 3 * BOIDS;
/** One checkpoint of the flock: its carried storage's bytes (README: a checkpoint's bytes). */
export const CHECKPOINT_BYTES = STATE_WORDS * 4;
/** Criterion 2's forced budget: 20 checkpoints' bytes. */
export const FORCED_RING = 20 * CHECKPOINT_BYTES;
/** The neighbourhood: a 128 × 128 grid of cells over the torus, 16 boids a cell on average. */
const CELLS = 128;
/** Distance a step (a cell is 1/128), the heading noise as a share of a full turn, and the fixed point of a cell's sums. */
const SPEED = 0.0015;
const NOISE = 0.3;
const FIXED = 1024;
/** The density grid the flock is shown through, one word a texel. */
const DENSITY = 512;
const TURN = 2 * Math.PI;
/** The flock's carried state, as `read` names it. */
export const FLOCK_STATE = 'flock.state';

/** e's three state words read from `buf` (3 fetches): `bx`, `by`, `bt`, and their slots `i0`, `i1`, `i2`. */
const boidReads = (buf: string): JsonObject => ({
  e: step('element@1'), i0: step('mul@1', { a: 'e', b: 3 }), i1: step('add@1', { a: 'i0', b: 1 }), i2: step('add@1', { a: 'i0', b: 2 }),
  bx: step('read@1', { buf, i: 'i0' }), by: step('read@1', { buf, i: 'i1' }), bt: step('read@1', { buf, i: 'i2' }),
});
/** The boid's neighbourhood cell and its two words in the cell grid: `g0` (Σ cos) and `g1` (Σ sin). */
const cellOf: JsonObject = {
  sx: step('mul@1', { a: 'bx', b: CELLS }), sy: step('mul@1', { a: 'by', b: CELLS }), fx: step('floor@1', { x: 'sx' }), fy: step('floor@1', { x: 'sy' }),
  ux: cvt('fx', 'u32'), uy: cvt('fy', 'u32'), cx: step('min@1', { a: 'ux', b: CELLS - 1 }), cy: step('min@1', { a: 'uy', b: CELLS - 1 }),
  crow: step('mul@1', { a: 'cy', b: CELLS }), cell: step('add@1', { a: 'crow', b: 'cx' }), g0: step('mul@1', { a: 'cell', b: 2 }), g1: step('add@1', { a: 'g0', b: 1 }),
};

/**
 * The flock: Vicsek's model (Vicsek et al., "Novel type of phase transition in a system of self-driven particles",
 * Phys. Rev. Lett. 75, 1995) on a cell grid. Each fixed step, `flock_grid` adds every boid's heading as a unit
 * vector, in fixed point, into its cell (two atomic adds into a grid that starts each step at 0); then `flock` turns
 * each boid to its cell's mean heading (atan2 of the sums, itself included), adds noise seeded by (boid, step), and
 * moves it SPEED along that heading, wrapping on the unit torus. Step 0 places each boid and its heading from hashes of
 * its index. Neighbours are the boids sharing a cell, so a boid reads 5 words (3 of its own, 2 of its cell), within a
 * compute operator's 8 fetches; no sort is needed, since the cell's sums are order-free integer atomics. `flock_density`
 * and `flock_view` show it each frame: every boid adds 1 to its texel of a 512 × 512 grid, and the pass shades each
 * pixel by its texel's count.
 */
export function flockOps(budget: number): JsonObject[] {
  const grid = stepped('flock_grid', 'Adds each boid\'s heading, as a fixed-point unit vector, into its neighbourhood cell.', {
    prev: previous('flock', 'state', 'f32', STATE_WORDS),
  }, {
    ...boidReads('prev'), ...cellOf,
    c: step('cos@1', { x: 'bt' }), s: step('sin@1', { x: 'bt' }), qc: step('mul@1', { a: 'c', b: FIXED }), qs: step('mul@1', { a: 's', b: FIXED }),
    rc: step('round@1', { x: 'qc' }), rs: step('round@1', { x: 'qs' }), ic: cvt('rc', 'i32'), is: cvt('rs', 'i32'), wc: bits('ic', 'u32'), ws: bits('is', 'u32'),
    ac: step('atomic_add@1', { buf: 'grid', i: 'g0', v: 'wc' }), as: step('atomic_add@1', { buf: 'grid', i: 'g1', v: 'ws' }),
  }, { grid: { storage: { type: 'u32', count: 2 * CELLS * CELLS } } }, BOIDS);
  const flock = stepped('flock', 'Turns each boid to its cell\'s mean heading with seeded noise and moves it one step on the torus.', {
    prev: previous('flock', 'state', 'f32', STATE_WORDS), grid: storage('flock_grid', 'grid', 'u32', 2 * CELLS * CELLS), k: STEP_INDEX,
  }, {
    ...boidReads('prev'), ...cellOf,
    sc: step('read@1', { buf: 'grid', i: 'g0' }), ss: step('read@1', { buf: 'grid', i: 'g1' }), sci: bits('sc', 'i32'), ssi: bits('ss', 'i32'),
    fc: cvt('sci', 'f32'), fs: cvt('ssi', 'f32'), mean: step('atan2@1', { y: 'fs', x: 'fc' }),
    hn: step('hash@1', { a: 'e', b: 'k', c: 7 }), rn: step('rand@1', { key: 'hn' }), rj: step('sub@1', { a: 'rn', b: 0.5 }), jit: step('mul@1', { a: 'rj', b: NOISE * TURN }),
    heading: step('add@1', { a: 'mean', b: 'jit' }), vx: step('cos@1', { x: 'heading' }), vy: step('sin@1', { x: 'heading' }),
    dx: step('mul@1', { a: 'vx', b: SPEED }), dy: step('mul@1', { a: 'vy', b: SPEED }), mx: step('add@1', { a: 'bx', b: 'dx' }), my: step('add@1', { a: 'by', b: 'dy' }),
    mx1: step('add@1', { a: 'mx', b: 1 }), my1: step('add@1', { a: 'my', b: 1 }), wx: step('fract@1', { x: 'mx1' }), wy: step('fract@1', { x: 'my1' }),
    h1: step('hash@1', { a: 'e', b: 1 }), h2: step('hash@1', { a: 'e', b: 2 }), h3: step('hash@1', { a: 'e', b: 3 }),
    ix: step('rand@1', { key: 'h1' }), iy: step('rand@1', { key: 'h2' }), it: step('rand@1', { key: 'h3' }), ith: step('mul@1', { a: 'it', b: TURN }),
    first: step('eq@1', { a: 'k', b: 0 }),
    ox: step('select@1', { f: 'wx', t: 'ix', cond: 'first' }), oy: step('select@1', { f: 'wy', t: 'iy', cond: 'first' }), ot: step('select@1', { f: 'heading', t: 'ith', cond: 'first' }),
    w0: step('write@1', { buf: 'state', i: 'i0', v: 'ox' }), w1: step('write@1', { buf: 'state', i: 'i1', v: 'oy' }), w2: step('write@1', { buf: 'state', i: 'i2', v: 'ot' }),
  }, { state: carried(STATE_WORDS, budget) }, BOIDS);
  const density = perFrame('flock_density', 'Counts the boids in each texel of the 512 × 512 grid the flock is shown through.', {
    cur: storage('flock', 'state', 'f32', STATE_WORDS),
  }, {
    e: step('element@1'), i0: step('mul@1', { a: 'e', b: 3 }), i1: step('add@1', { a: 'i0', b: 1 }),
    bx: step('read@1', { buf: 'cur', i: 'i0' }), by: step('read@1', { buf: 'cur', i: 'i1' }),
    sx: step('mul@1', { a: 'bx', b: DENSITY }), sy: step('mul@1', { a: 'by', b: DENSITY }), fx: step('floor@1', { x: 'sx' }), fy: step('floor@1', { x: 'sy' }),
    ux: cvt('fx', 'u32'), uy: cvt('fy', 'u32'), cx: step('min@1', { a: 'ux', b: DENSITY - 1 }), cy: step('min@1', { a: 'uy', b: DENSITY - 1 }),
    crow: step('mul@1', { a: 'cy', b: DENSITY }), cell: step('add@1', { a: 'crow', b: 'cx' }), one: step('const@1', { value: 1, type: 'u32' }),
    a: step('atomic_add@1', { buf: 'density', i: 'cell', v: 'one' }),
  }, { density: { storage: { type: 'u32', count: DENSITY * DENSITY } } }, BOIDS);
  const display = view('flock_view', 'Shades each pixel by how many boids its texel holds: night where none, warm white where many.', {
    density: storage('flock_density', 'density', 'u32', DENSITY * DENSITY),
  }, {
    ...uvCell(DENSITY), d: step('read@1', { buf: 'density', i: 'cell' }), df: cvt('d', 'f32'), dn: step('mul@1', { a: 'df', b: -0.45 }), ex: step('exp@1', { x: 'dn' }),
    f: step('sub@1', { a: 1, b: 'ex' }), rf: step('mul@1', { a: 'f', b: 0.93 }), gf: step('mul@1', { a: 'f', b: 0.87 }), bf: step('mul@1', { a: 'f', b: 0.74 }),
    r: step('add@1', { a: 'rf', b: 0.02 }), g: step('add@1', { a: 'gf', b: 0.03 }), b: step('add@1', { a: 'bf', b: 0.06 }),
    out: step('compose@1', { x: 'r', y: 'g', z: 'b', w: 1 }),
  });
  return [grid, flock, density, display];
}

// Live fire ------------------------------------------------------------------------------------------

const FIRE = 256;
/**
 * Fire that spreads: a 256 × 256 heat grid, one carried f32 a cell. Each step a cell takes the heat of the row below
 * (weights 1, 2, 1) blended with its own, less a cooling of 0.004 to 0.014 seeded by (cell, step), never below 0, so
 * flames rise about 75 cells and flicker; on the bottom row a burning floor spreads from the middle a quarter cell a step, each burning cell fed
 * 0.75 to 1.05 of heat. `fire_view` maps heat to black, red, yellow and white.
 */
export function fireOps(): JsonObject[] {
  const fire = stepped('fire', 'A heat grid whose flames rise from a burning floor that spreads from the middle.', {
    prev: previous('fire', 'heat', 'f32', FIRE * FIRE), k: STEP_INDEX,
  }, {
    ...gridSteps(FIRE),
    rb: step('mul@1', { a: 'yd', b: FIRE }), ib: step('add@1', { a: 'rb', b: 'gx' }), il: step('add@1', { a: 'rb', b: 'xl' }), ir: step('add@1', { a: 'rb', b: 'xr' }),
    hb: step('read@1', { buf: 'prev', i: 'ib' }), hl: step('read@1', { buf: 'prev', i: 'il' }), hr: step('read@1', { buf: 'prev', i: 'ir' }), hs: step('read@1', { buf: 'prev', i: 'e' }),
    hb2: step('mul@1', { a: 'hb', b: 2 }), s1: step('add@1', { a: 'hl', b: 'hr' }), s2: step('add@1', { a: 's1', b: 'hb2' }), rise: step('mul@1', { a: 's2', b: 0.25 }),
    r1: step('mul@1', { a: 'rise', b: 0.82 }), r2: step('mul@1', { a: 'hs', b: 0.18 }), blend: step('add@1', { a: 'r1', b: 'r2' }),
    hc: step('hash@1', { a: 'e', b: 'k', c: 3 }), rc: step('rand@1', { key: 'hc' }), cl: step('mul@1', { a: 'rc', b: 0.01 }), cool: step('add@1', { a: 'cl', b: 0.004 }),
    cooled: step('sub@1', { a: 'blend', b: 'cool' }), hot: step('max@1', { a: 'cooled', b: 0 }),
    off: step('sub@1', { a: 'gxf', b: (FIRE - 1) / 2 }), dist: step('abs@1', { x: 'off' }), kf: cvt('k', 'f32'), wf0: step('mul@1', { a: 'kf', b: 0.25 }), wf: step('min@1', { a: 'wf0', b: FIRE / 2 + 1 }),
    lit: step('lt@1', { a: 'dist', b: 'wf' }), bottom: step('eq@1', { a: 'gy', b: FIRE - 1 }), burn: step('and@1', { a: 'bottom', b: 'lit' }),
    hf: step('hash@1', { a: 'e', b: 'k', c: 5 }), rf: step('rand@1', { key: 'hf' }), fuel0: step('mul@1', { a: 'rf', b: 0.3 }), fuel: step('add@1', { a: 'fuel0', b: 0.75 }),
    out: step('select@1', { f: 'hot', t: 'fuel', cond: 'burn' }), w: step('write@1', { buf: 'heat', i: 'e', v: 'out' }),
  }, { heat: carried(FIRE * FIRE, DEFAULT_RING) }, FIRE * FIRE);
  const display = view('fire_view', 'Maps each pixel\'s heat to black, red, yellow and white.', { heat: storage('fire', 'heat', 'f32', FIRE * FIRE) }, {
    ...uvCell(FIRE), h: step('read@1', { buf: 'heat', i: 'cell' }), h3: step('mul@1', { a: 'h', b: 3.75 }),
    gr: step('sub@1', { a: 'h3', b: 1 }), bl: step('sub@1', { a: 'h3', b: 2 }),
    r: step('clamp@1', { x: 'h3', lo: 0, hi: 1 }), g: step('clamp@1', { x: 'gr', lo: 0, hi: 1 }), b: step('clamp@1', { x: 'bl', lo: 0, hi: 1 }),
    out: step('compose@1', { x: 'r', y: 'g', z: 'b', w: 1 }),
  });
  return [fire, display];
}

// A soft blob ----------------------------------------------------------------------------------------

const BLOB = 256;
const BLOB_RADIUS = 100;
/**
 * A soft blob: a 256 × 256 membrane, two carried f32 a cell (height and velocity), held at 0 outside a disc of radius
 * 100 cells. Each step a cell accelerates by a quarter of its height's Laplacian (its four neighbours), less a small
 * pull back to rest, its velocity damped by 0.996. Step 0 pushes it: a Gaussian dent of height 4 and σ 10 cells,
 * off centre at (165, 100), so it wobbles from where it was pushed and the ripples reflect off its rim. `blob_view`
 * shades the disc from its height's slope, pink on a dark ground.
 */
export function blobOps(): JsonObject[] {
  /** The height at row `iy`, column `ix` of the membrane in `buf`, as step `n` (one fetch). */
  const at = (buf: string, n: string, iy: string, ix: string): JsonObject => ({
    [`${n}_row`]: step('mul@1', { a: iy, b: BLOB }), [`${n}_cell`]: step('add@1', { a: `${n}_row`, b: ix }), [`${n}_i`]: step('mul@1', { a: `${n}_cell`, b: 2 }),
    [n]: step('read@1', { buf, i: `${n}_i` }),
  });
  const blob = stepped('blob', 'A damped membrane in a disc, pushed once off centre, so it wobbles from where it was pushed.', {
    prev: previous('blob', 'state', 'f32', 2 * BLOB * BLOB), k: STEP_INDEX,
  }, {
    ...gridSteps(BLOB), i: step('mul@1', { a: 'e', b: 2 }), iv: step('add@1', { a: 'i', b: 1 }),
    h: step('read@1', { buf: 'prev', i: 'i' }), v: step('read@1', { buf: 'prev', i: 'iv' }),
    ...at('prev', 'hl', 'gy', 'xl'), ...at('prev', 'hr', 'gy', 'xr'), ...at('prev', 'hu', 'yu', 'gx'), ...at('prev', 'hd', 'yd', 'gx'),
    n1: step('add@1', { a: 'hl', b: 'hr' }), n2: step('add@1', { a: 'hu', b: 'hd' }), n3: step('add@1', { a: 'n1', b: 'n2' }), h4: step('mul@1', { a: 'h', b: 4 }),
    lap: step('sub@1', { a: 'n3', b: 'h4' }), push: step('mul@1', { a: 'lap', b: 0.25 }), pull: step('mul@1', { a: 'h', b: 0.004 }), acc: step('sub@1', { a: 'push', b: 'pull' }),
    v1: step('add@1', { a: 'v', b: 'acc' }), vn: step('mul@1', { a: 'v1', b: 0.996 }), hn: step('add@1', { a: 'h', b: 'vn' }),
    ox: step('sub@1', { a: 'gxf', b: (BLOB - 1) / 2 }), oy: step('sub@1', { a: 'gyf', b: (BLOB - 1) / 2 }), ox2: step('mul@1', { a: 'ox', b: 'ox' }), oy2: step('mul@1', { a: 'oy', b: 'oy' }),
    r2: step('add@1', { a: 'ox2', b: 'oy2' }), inside: step('lt@1', { a: 'r2', b: BLOB_RADIUS * BLOB_RADIUS }),
    px: step('sub@1', { a: 'gxf', b: 165 }), py: step('sub@1', { a: 'gyf', b: 100 }), px2: step('mul@1', { a: 'px', b: 'px' }), py2: step('mul@1', { a: 'py', b: 'py' }),
    p2: step('add@1', { a: 'px2', b: 'py2' }), pg: step('mul@1', { a: 'p2', b: -1 / 200 }), bump: step('exp@1', { x: 'pg' }), h0: step('mul@1', { a: 'bump', b: 4 }),
    first: step('eq@1', { a: 'k', b: 0 }), hs: step('select@1', { f: 'hn', t: 'h0', cond: 'first' }), vs: step('select@1', { f: 'vn', t: 0, cond: 'first' }),
    ho: step('select@1', { f: 0, t: 'hs', cond: 'inside' }), vo: step('select@1', { f: 0, t: 'vs', cond: 'inside' }),
    w0: step('write@1', { buf: 'state', i: 'i', v: 'ho' }), w1: step('write@1', { buf: 'state', i: 'iv', v: 'vo' }),
  }, { state: carried(2 * BLOB * BLOB, DEFAULT_RING) }, BLOB * BLOB);
  const rim = BLOB_RADIUS / BLOB;
  const display = view('blob_view', 'Shades the blob from its height\'s slope, pink on a dark ground.', { state: storage('blob', 'state', 'f32', 2 * BLOB * BLOB) }, {
    ...uvCell(BLOB), cxr0: step('add@1', { a: 'cx', b: 1 }), cxr: step('min@1', { a: 'cxr0', b: BLOB - 1 }), cyd0: step('add@1', { a: 'cy', b: 1 }), cyd: step('min@1', { a: 'cyd0', b: BLOB - 1 }),
    ...at('state', 'h', 'cy', 'cx'), ...at('state', 'hr', 'cy', 'cxr'), ...at('state', 'hd', 'cyd', 'cx'),
    sx: step('sub@1', { a: 'h', b: 'hr' }), sy: step('sub@1', { a: 'h', b: 'hd' }), sl: step('add@1', { a: 'sx', b: 'sy' }), sl2: step('mul@1', { a: 'sl', b: 1.5 }),
    lit0: step('add@1', { a: 'sl2', b: 0.55 }), lit: step('clamp@1', { x: 'lit0', lo: 0, hi: 1 }), k0: step('mul@1', { a: 'lit', b: 0.75 }), kk: step('add@1', { a: 'k0', b: 0.25 }),
    pr: step('mul@1', { a: 'kk', b: 0.95 }), pgn: step('mul@1', { a: 'kk', b: 0.38 }), pb: step('mul@1', { a: 'kk', b: 0.6 }),
    du: step('sub@1', { a: 'u', b: 0.5 }), dv: step('sub@1', { a: 'v', b: 0.5 }), du2: step('mul@1', { a: 'du', b: 'du' }), dv2: step('mul@1', { a: 'dv', b: 'dv' }),
    rr: step('add@1', { a: 'du2', b: 'dv2' }), inside: step('lt@1', { a: 'rr', b: rim * rim }),
    r: step('select@1', { f: 0.04, t: 'pr', cond: 'inside' }), g: step('select@1', { f: 0.04, t: 'pgn', cond: 'inside' }), b: step('select@1', { f: 0.06, t: 'pb', cond: 'inside' }),
    out: step('compose@1', { x: 'r', y: 'g', z: 'b', w: 1 }),
  });
  return [blob, display];
}

// ---------------------------------------------------------------------------------------------------
// Documents. `view3d` takes a whole document (#378's); operators are items of their writer's layer (#429).

export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);
export const LOOK: JsonObject = JSON.parse(readFileSync(fixturePath('look.json'), 'utf8')) as JsonObject;
export const WRITER = 'agent:alpha';

/**
 * Operators for a document, each declaring the cost the check estimates for it (`estimate_ns`, from #429's
 * check_operator), so the class holds them and no declaration is understated.
 */
export function withEstimates(bin: string, out: string, ops: JsonObject[]): JsonObject[] {
  const replies = run(bin, out, ops.map((operator) => ({ call: 'check_operator', operator })));
  return ops.map((op, i) => {
    const id = String(op['id']);
    const r = answered(replies[i]!, `the check of ${id}`);
    expect(r['outcome'], `${id} checks on its own: ${shown(r['issues'])}`).toBe('accepted');
    const est = num(r['estimate_ns'], `${id}: the check's estimate_ns`);
    return { ...op, cost: op['kind'] === 'compute' ? { ns_per_element: est } : { ns_per_px: est } };
  });
}
/** An operator as an item of its writer's layer: its kind `gpu.<kind>@1`, its fields in `params`. */
function asItem(op: JsonObject): JsonObject {
  const params = JSON.parse(JSON.stringify(op)) as JsonObject;
  delete params['id'];
  delete params['kind'];
  return { kind: `gpu.${op['kind'] as string}@1`, params };
}
/** A showpiece scene of a camera, a box under the passes and the operators given, 65 s long. */
export function sceneDoc(id: string, ops: JsonObject[]): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 7], target: [0, 0, 0], fov: 40 } },
    b0: { kind: 'mark.box@1', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0, 0] } },
  };
  for (const op of ops) items[String(op['id'])] = asItem(op);
  const withIds: JsonObject = {};
  let n = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(n++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #252 acceptance fixture.`, size: [64, 64], camera: 'cam',
    transport: { span: '65s' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items: withIds,
  };
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}
/** The flock's document under `out`, its ring at `budget`. */
export const flockDoc = (bin: string, out: string, budget: number): string =>
  writeJson(out, `flock-${budget}.json`, sceneDoc('flock-252', withEstimates(bin, out, flockOps(budget))));

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378's, with #380's `from` and `timings`, #483's `read`, #484's `seeks`), with this suite's reply fields
// (README): each frame's `carried` and, with `timings`, its `wall_ms`.

export const view3dCall = (spec: JsonObject): JsonObject => ({ call: 'view3d', look: LOOK, size: [64, 64], fps: 60, ...spec });

/** One output read back: storage `{type, count, file}`, `file` naming `<sha>.u32` under `out`. */
export interface Read { file: string; count: number | null }
/** A carried output's row on a frame (README: `carried`). */
export interface Carried { step: number; ringBytes: number; budget: number; checkpoints: number[]; restored: { from: number; steps: number } | null }
export interface V3Frame { index: number; frame: number; final: string | null; wallMs: number | null; read: Map<string, Read>; carried: Map<string, Carried> }

export function view3dFrames(reply: JsonObject, what: string): V3Frame[] {
  answered(reply, what);
  return objs(reply['frames'], `${what}: frames`).map((f, index) => {
    const at = `${what}: frames[${index}]`;
    const read = new Map(Object.entries(isObject(f['read']) ? f['read'] : {}).map(([k, v]) => {
      const r = obj(v, `${at}.read.${k}`);
      return [k, { file: str(r['file'], `${at}.read.${k}.file`), count: typeof r['count'] === 'number' ? r['count'] : null }];
    }));
    const carried = new Map(Object.entries(isObject(f['carried']) ? f['carried'] : {}).map(([k, v]) => {
      const c = obj(v, `${at}.carried.${k}`);
      const ring = obj(c['ring'], `${at}.carried.${k}.ring`);
      const restored = isObject(c['restored']) ? c['restored'] : null;
      return [k, {
        step: num(c['step'], `${at}.carried.${k}.step`), ringBytes: num(ring['bytes'], `${at}.carried.${k}.ring.bytes`), budget: num(ring['budget'], `${at}.carried.${k}.ring.budget`),
        checkpoints: arr(ring['checkpoints'], `${at}.carried.${k}.ring.checkpoints`).map((s, j) => num(s, `${at}.carried.${k}.ring.checkpoints[${j}]`)),
        restored: restored ? { from: num(restored['from'], `${at}.carried.${k}.restored.from`), steps: num(restored['steps'], `${at}.carried.${k}.restored.steps`) } : null,
      }];
    }));
    return {
      index, frame: num(f['frame'], `${at}.frame`), final: typeof f['final'] === 'string' ? f['final'] : null,
      wallMs: typeof f['wall_ms'] === 'number' ? f['wall_ms'] : null, read, carried,
    };
  });
}
/** The frames numbered `n`, in the order drawn (a seek draws a number again). */
export const framesNumbered = (frames: V3Frame[], n: number): V3Frame[] => frames.filter((f) => f.frame === n);
/** The carried row `key` on a frame, or a failure naming the frame. */
export function carriedOn(f: V3Frame, key: string, what: string): Carried {
  const c = f.carried.get(key);
  expect(c, `${what}: frame ${f.frame} (reply entry ${f.index}) reports carried.${key}; it reports ${[...f.carried.keys()].join(', ') || 'none'}`).toBeDefined();
  return c!;
}
/** The flock's state as a frame read it: its words as f32 and the SHA-256 that names them. */
export interface State { hash: string; words: Float32Array }
export function stateOf(out: string, f: V3Frame, what: string): State {
  const r = f.read.get(FLOCK_STATE);
  expect(r, `${what}: frame ${f.frame} (reply entry ${f.index}) read ${FLOCK_STATE}`).toBeDefined();
  expect(r!.file, `${what}: the state file is named by its SHA-256`).toMatch(SHA);
  const b = readFileSync(join(out, `${r!.file}.u32`));
  expect(sha256(b), `${what}: the state file's SHA-256 is its name`).toBe(r!.file);
  return { hash: r!.file, words: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) };
}
/**
 * Whether a state is a flock and not a stand-in: 786,432 words, every x and y in [0, 1) and every heading finite, the
 * boids spread out (at least 900 distinct x among the first 1,000) and moved since the step before.
 */
export function flockProblems(s: State, before: State, what: string): string[] {
  const p: string[] = [];
  if (s.words.length !== STATE_WORDS) return [`${what}: the flock holds ${s.words.length} words, not ${STATE_WORDS} (262,144 boids × 3)`];
  for (let b = 0; b < BOIDS; b++) {
    const x = s.words[3 * b]!; const y = s.words[3 * b + 1]!; const t = s.words[3 * b + 2]!;
    if (!(x >= 0 && x < 1 && y >= 0 && y < 1 && Number.isFinite(t))) { p.push(`${what}: boid ${b} reads (${x}, ${y}, ${t}), outside the unit torus or not finite`); break; }
  }
  const xs = new Set<number>();
  for (let b = 0; b < 1000; b++) xs.add(s.words[3 * b]!);
  if (xs.size < 900) p.push(`${what}: only ${xs.size} distinct x among the first 1,000 boids`);
  if (s.hash === before.hash) p.push(`${what}: the flock didn't move from the step before (both hash ${s.hash})`);
  return p;
}

// ---------------------------------------------------------------------------------------------------
// `golden` and `decide` (#380's), with this suite's fields (README): a snapshot that is an operator output read by a
// view3d frame, blessed from a state file, and the class the golden compared it under.

export interface Fingerprint { os: string; gpu: string; driver: string; wgpu: string }
export interface Golden { verdict: string; reason: string | null; cls: string | null; fingerprint: Fingerprint; recorded: Fingerprint | null; numbers: JsonObject | null; raw: JsonObject }
export const blessState = (store: string, fixture: string, state: string): JsonObject =>
  ({ call: 'decide', via: 'you', store, decision: { bless: { fixture, state } } });
export const goldenState = (store: string, fixture: string, view3d: JsonObject, environment?: Partial<Fingerprint>): JsonObject =>
  ({ call: 'golden', store, fixture, oracle: 'hash', view3d, read: FLOCK_STATE, ...(environment ? { environment } : {}) });
export function goldenReply(reply: JsonObject, what: string): Golden {
  answered(reply, what);
  const fp = (v: JsonValue | undefined, w: string): Fingerprint => {
    const o = obj(v, w);
    return { os: str(o['os'], `${w}.os`), gpu: str(o['gpu'], `${w}.gpu`), driver: str(o['driver'], `${w}.driver`), wgpu: str(o['wgpu'], `${w}.wgpu`) };
  };
  const g = isObject(reply['golden']) ? reply['golden'] : null;
  return {
    verdict: str(reply['verdict'], `${what}: verdict`), reason: typeof reply['reason'] === 'string' ? reply['reason'] : null,
    cls: typeof reply['class'] === 'string' ? reply['class'] : null, fingerprint: fp(reply['fingerprint'], `${what}: fingerprint`),
    recorded: g && isObject(g['fingerprint']) ? fp(g['fingerprint'], `${what}: golden.fingerprint`) : null,
    numbers: isObject(reply['numbers']) ? reply['numbers'] : null, raw: reply,
  };
}

// ---------------------------------------------------------------------------------------------------
// A recording: the canvas's own PNG frames, all of one IHDR, put into an animated PNG as they are, their compressed
// image data moved into fdAT chunks unchanged, so the recording holds exactly the frames the canvas wrote.

function chunks(png: Buffer, what: string): { type: string; data: Buffer }[] {
  expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${what} is a PNG`).toBe(true);
  const out: { type: string; data: Buffer }[] = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    out.push({ type: png.toString('latin1', o + 4, o + 8), data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An animated PNG of the canvas's PNG frames at `fps`, looping. */
export function apng(frames: Buffer[], fps: number, what: string): Buffer {
  const parsed = frames.map((f, i) => chunks(f, `${what}: frame ${i}`));
  const ihdr = parsed[0]!.find((c) => c.type === 'IHDR')!.data;
  parsed.forEach((p, i) => expect(p.find((c) => c.type === 'IHDR')?.data.equals(ihdr), `${what}: frame ${i} has the first frame's size and format`).toBe(true));
  const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4);
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const extra = parsed[0]!.filter((c) => !['IHDR', 'IDAT', 'IEND', 'acTL', 'fcTL', 'fdAT'].includes(c.type)).map((c) => chunk(c.type, c.data));
  const parts: Buffer[] = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('acTL', actl)];
  let seq = 0;
  parsed.forEach((p, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = Buffer.concat(p.filter((c) => c.type === 'IDAT').map((c) => c.data));
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
