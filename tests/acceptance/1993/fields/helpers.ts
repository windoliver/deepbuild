// Test-side tools for the "fields" part of the #1993 acceptance tests (criteria 5, 6 and 8): `deep-gpu` (#377's
// binary, with #378's `view3d`, #429's operator check, #483's `read` and #252's stepped operators) built once per
// file and driven by JSON lines; the fixtures written as operator data, generated here so every step is readable
// (a 64 × 64 cloth held as three carried fields, 4,096 points under softened gravity held as two, and for the
// taste call a water ring and a growing pattern in carried textures); the reply readers; the reference-Mac gate and
// the design's judge for timings; and an animated PNG built from the canvas's own PNGs. Nothing here asserts a
// criterion: each check returns its readings or its problems as sentences, and the test files assert them.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1993/fields is four levels down). */
const REPO = join(HERE, '..', '..', '..', '..');
const BIN = 'deep-gpu';

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = { 5: '#1993.9b40f0f2', 6: '#1993.7a269d05', 8: '#1993.c2ad7c76' } as const;

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

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu`, built once per file and copied out of target/debug.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  // Homebrew's rustup, where a Mac has it, reads rust-toolchain.toml's pin; elsewhere cargo is the PATH's.
  const rustup = '/opt/homebrew/opt/rustup/bin';
  if (existsSync(rustup)) env['PATH'] = `${rustup}${delimiter}${env['PATH'] ?? ''}`;
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export function useBin(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1993-fields-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1993-fields-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one scenario per line in, one line out (#377). This part adds no planted program to the binary:
// each of its criteria's wrong programs is a wrong step, written as operator data (README: Planted programs).

export function run(bin: string, out: string, calls: JsonObject[], timeoutMs = 3_000_000): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${bin} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const name = `${BIN} run`;
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

// ---------------------------------------------------------------------------------------------------
// The machine: Metal on macOS for anything the GPU runs; a reference Mac for timings.

const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs on macOS's Metal device, the reference platform; this is ${process.platform}`);
}
/** The design's reference Macs (technical design: The reference Macs). */
const REFERENCE_MACS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];
/** The reference Mac this is, or INCONCLUSIVE. Power and Low Power Mode aren't gated here, as #252's and #483's budgets aren't; load is read by the judge. */
export function requireReferenceMac(): string {
  requireGpu();
  let model = '';
  try { model = sh('sysctl', '-n', 'hw.model'); } catch { /* unread */ }
  if (!REFERENCE_MACS.includes(model)) inconclusive(`not a reference Mac (${REFERENCE_MACS.join(', ')}): hw.model is ${model || 'unread'}`);
  return model;
}
/** The one-minute load per CPU core: above 1 the machine is loaded, and a timing that misses reads INCONCLUSIVE. */
const loadPerCore = (): number => loadavg()[0]! / cpus().length;
/**
 * The design's judge for a timing limit (Every task carries its own budgets): five runs after warm-up on a reference
 * Mac; PASS when all five are within the limit, FAIL when all five are over it by more than the margin (the larger of
 * 5% and their spread) on a machine that isn't loaded, otherwise INCONCLUSIVE. Returns the verdict and its line; the
 * test asserts it.
 */
export function judge(name: string, runs: number[], limit: number): { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; line: string } {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  const line = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%, load ${loadPerCore().toFixed(2)} a core)`;
  console.log(line);
  if (runs.length !== 5 || runs.some((r) => !Number.isFinite(r))) return { verdict: 'INCONCLUSIVE', line: `not five finite runs: ${line}` };
  if (runs.every((r) => r <= limit)) return { verdict: 'PASS', line };
  if (loadPerCore() > 1) return { verdict: 'INCONCLUSIVE', line: `under load: ${line}` };
  return { verdict: runs.every((r) => r > limit * (1 + margin)) ? 'FAIL' : 'INCONCLUSIVE', line };
}

// ---------------------------------------------------------------------------------------------------
// Operators, as #429's check takes them (`steps` as `{op: name@major, args}`), with #252's stepped fields (`stepped:
// {rate}`, `carry: {every, budget}` on a storage output, an input `{storage: {op, output, step: "previous"}}`, an
// input `{time: "step"}`) and this issue's (README: The surface under test): `carry` on a `texture` output, an input
// `{texture: {op, output, step: "previous"}}` and `stepped.bound`.

const step = (op: string, args: JsonObject = {}): JsonObject => ({ op, args });
const cvt = (x: string, to: string): JsonObject => step('convert@1', { x, to });
const bits = (x: string, to: string): JsonObject => step('bitcast@1', { x, to });
const pick = (x: string, p: string): JsonObject => step('split@1', { x, pick: p });
const mul = (a: string | number, b: string | number): JsonObject => step('mul@1', { a, b });
const add = (a: string | number, b: string | number): JsonObject => step('add@1', { a, b });
const sub = (a: string | number, b: string | number): JsonObject => step('sub@1', { a, b });
const sel = (f: string | number, t: string | number, cond: string): JsonObject => step('select@1', { f, t, cond });
const read = (buf: string, i: string): JsonObject => step('read@1', { buf, i });
const write = (buf: string, i: string, v: string | number): JsonObject => step('write@1', { buf, i, v });

/** The design's checkpoint ring defaults (Checkpoint ring: `every: steps = 60`, `budget: bytes = 16 MiB`). */
const EVERY = 60;
const DEFAULT_RING = 16 * 1024 * 1024;

/** A compute operator stepped once per fixed step, `rate` steps a second, with any other `stepped` field given. */
function stepped(id: string, about: string, rate: number, inputs: JsonObject, steps: JsonObject, outputs: JsonObject, elements: number, more: JsonObject = {}): JsonObject {
  return { id, kind: 'compute', origin: 'composed', about, inputs, steps, outputs, elements, workgroup: 256, stepped: { rate, ...more }, cost: { ns_per_element: 1 } };
}
/** A compute operator run once a frame. */
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
/** A carried storage field as the previous step left it (zeros before the first step). */
const previous = (op: string, output: string, type: string, count: number): JsonObject => ({ type, count, from: { storage: { op, output, step: 'previous' } } });
/** Storage written earlier in this step or frame: a carried field reads as its latest step left it. */
const storage = (op: string, output: string, type: string, count: number): JsonObject => ({ type, count, from: { storage: { op, output } } });
/** The fixed step being computed, 0 for the first. */
const STEP_INDEX: JsonObject = { type: 'u32', from: { time: 'step' } };
/** A carried storage field with its checkpoint ring. */
const field = (type: string, count: number, carry: JsonObject): JsonObject => ({ storage: { type, count }, carry });
/** Storage a step uses and doesn't keep: it starts each step at 0. */
const scratch = (type: string, count: number): JsonObject => ({ storage: { type, count } });
/** A storage cell of a `size` × `size` grid from screen_uv, clamped into it: steps `cx`, `cy` and `cell` (row-major). */
function uvCell(size: number): JsonObject {
  return {
    uv: step('screen_uv@1'), u: pick('uv', 'x'), v: pick('uv', 'y'),
    us: mul('u', size), vs: mul('v', size), uf: step('floor@1', { x: 'us' }), vf: step('floor@1', { x: 'vs' }),
    uu: cvt('uf', 'u32'), vu: cvt('vf', 'u32'), cx: step('min@1', { a: 'uu', b: size - 1 }), cy: step('min@1', { a: 'vu', b: size - 1 }),
    crow: mul('cy', size), cell: add('crow', 'cx'),
  };
}

// The cloth (criterion 5) ---------------------------------------------------------------------------

/** 64 × 64 points, row 0 the top, each row and column one rest length from the next. */
export const SIDE = 64;
export const POINTS = SIDE * SIDE;
/** An edge's rest length, m: the cloth is 6.3 m a side. */
export const REST = 0.1;
/** Steps a second; 600 steps are 1 s, and one step's fall under gravity is g ÷ rate², 27.25 µm. */
export const CLOTH_RATE = 600;
const GRAVITY = 9.81;
const FALL = GRAVITY / (CLOTH_RATE * CLOTH_RATE);
/** The pose it is let go from: flat, swung out from the hanging plane about its top row by 0.5 rad, twisted 0.17 rad across its width. */
const LIFT = 0.5;
const TWIST = 0.17;
/** Constraint passes a step, each over one of the four edge colours, in this order twice over. */
export const PASSES = 8;
const COLOURS = ['h0', 'v0', 'h1', 'v1'] as const;
/** The cloth's three fields, as `read` names them, with their words a point. */
export const CLOTH_FIELDS = { position: 'cloth.position', previous: 'cloth.previous', pinned: 'cloth.pinned' } as const;
export const POSITION_WORDS = 3 * POINTS;
/**
 * The ring every field declares: a checkpoint every 60 steps, within six checkpoints of a 12,288-word field. Over
 * 600 steps a ring that held `position` alone would thin at step 360 and one that held `pinned` alone never would.
 */
const CLOTH_CARRY: JsonObject = { every: EVERY, budget: 6 * POSITION_WORDS * 4 };

/** Where point (row, column) starts: the closed form the step's own step 0 writes. */
export function clothStart(row: number, column: number): [number, number, number] {
  const angle = LIFT + TWIST * (column / (SIDE - 1) - 0.5);
  return [(column - (SIDE - 1) / 2) * REST, -row * REST * Math.cos(angle), row * REST * Math.sin(angle)];
}

/** Point e's row and column, and its three words' slots in a 3-word field (`i0`…`i2`) and a 4-word one (`m0`…`m3`). */
const pointSteps: JsonObject = {
  e: step('element@1'), gx: step('rem@1', { a: 'e', b: SIDE }), gy: step('div@1', { a: 'e', b: SIDE }),
  i0: mul('e', 3), i1: add('i0', 1), i2: add('i0', 2), m0: mul('e', 4), m1: add('m0', 1), m2: add('m0', 2), m3: add('m0', 3),
};
/** The neighbour a pass pairs a point with along one axis: `a ^ 1` on the even colour, the other way on the odd one; `q` is `a` itself where it has none. */
function partner(axis: string, odd: boolean, n: string): JsonObject {
  if (!odd) return { [n]: step('xor@1', { a: axis, b: 1 }) };
  return {
    [`${n}_bit`]: step('and@1', { a: axis, b: 1 }), [`${n}_odd`]: step('eq@1', { a: `${n}_bit`, b: 1 }),
    [`${n}_up0`]: add(axis, 1), [`${n}_up`]: step('min@1', { a: `${n}_up0`, b: SIDE - 1 }),
    [`${n}_dn0`]: step('max@1', { a: axis, b: 1 }), [`${n}_dn`]: sub(`${n}_dn0`, 1),
    [n]: sel(`${n}_dn`, `${n}_up`, `${n}_odd`),
  };
}
/**
 * One constraint pass over the edges of one colour: each point reads itself and the one neighbour that colour pairs
 * it with (8 fetches: two positions and two weights), and moves along their edge by its share of the edge's error,
 * a pinned point's share being none. Every edge of a colour has its own two points, so a pass is order-free.
 */
function clothPass(n: number, from: string, colour: (typeof COLOURS)[number]): JsonObject {
  const horizontal = colour.startsWith('h');
  const odd = colour.endsWith('1');
  return stepped(`cloth_pass${n}`, `Constraint pass ${n} of ${PASSES}: pulls each point and its ${horizontal ? 'row' : 'column'} neighbour of the ${odd ? 'odd' : 'even'} colour back to one rest length apart.`, CLOTH_RATE, {
    src: storage(from, from === 'cloth_move' ? 'moved' : 'out', 'f32', 4 * POINTS),
  }, {
    ...pointSteps, ...partner(horizontal ? 'gx' : 'gy', odd, 'qa'),
    has: step('ne@1', { a: 'qa', b: horizontal ? 'gx' : 'gy' }),
    qrow: mul(horizontal ? 'gy' : 'qa', SIDE), q: add('qrow', horizontal ? 'qa' : 'gx'),
    n0: mul('q', 4), n1: add('n0', 1), n2: add('n0', 2), n3: add('n0', 3),
    sx: read('src', 'm0'), sy: read('src', 'm1'), sz: read('src', 'm2'), sw: read('src', 'm3'),
    px: read('src', 'n0'), py: read('src', 'n1'), pz: read('src', 'n2'), pw: read('src', 'n3'),
    dx: sub('sx', 'px'), dy: sub('sy', 'py'), dz: sub('sz', 'pz'),
    dx2: mul('dx', 'dx'), dy2: mul('dy', 'dy'), dz2: mul('dz', 'dz'), l2a: add('dx2', 'dy2'), l2: add('l2a', 'dz2'), len: step('sqrt@1', { x: 'l2' }),
    wsum: add('sw', 'pw'), wden: step('max@1', { a: 'wsum', b: 1 }), share: step('div@1', { a: 'sw', b: 'wden' }),
    over: sub('len', REST), pull: mul('share', 'over'), lden: step('max@1', { a: 'len', b: 1e-9 }), k0: step('div@1', { a: 'pull', b: 'lden' }),
    k: sel(0, 'k0', 'has'),
    cx: mul('dx', 'k'), cy: mul('dy', 'k'), cz: mul('dz', 'k'), ox: sub('sx', 'cx'), oy: sub('sy', 'cy'), oz: sub('sz', 'cz'),
    w0: write('out', 'm0', 'ox'), w1: write('out', 'm1', 'oy'), w2: write('out', 'm2', 'oz'), w3: write('out', 'm3', 'sw'),
  }, { out: scratch('f32', 4 * POINTS) }, POINTS);
}

/**
 * The cloth: 4,096 points held as three carried fields of the stepped operator `cloth`: `position` and `previous`
 * (f32, x, y and z of each point, m) and `pinned` (u32, 1 where a point is held). A step is ten operators, in
 * dependency order: `cloth_move` moves each free point by its last step's movement and by gravity's fall (Verlet,
 * Phys. Rev. 159, 1967; the passes after it project each edge back to its rest length, as Müller et al., "Position
 * based dynamics", J. Vis. Commun. Image Represent. 18, 2007);
 * `cloth_pass1` … `cloth_pass8` are the 8 constraint passes, each over the edges of one colour (even columns, even
 * rows, odd columns, odd rows, twice over); `cloth` keeps the result: the new `position` (a pinned point's is the
 * one it had, bit for bit), the old one as `previous`, and `pinned` as it was. Step 0 writes the start: the cloth
 * flat, swung out about its top row and slightly twisted, at rest, its top row pinned.
 *
 * `ignoresPinned` is the criterion's planted step: the same operators, except that `cloth_move` and `cloth` never
 * read the `pinned` field, so every point is free, the top row's among them.
 */
export function clothOps(spec: { ignoresPinned?: boolean } = {}): JsonObject[] {
  const carry = CLOTH_CARRY;
  const held = !spec.ignoresPinned;
  const move = stepped('cloth_move', 'Moves each free point by its last step\'s movement and by gravity\'s fall in one step.', CLOTH_RATE, {
    pos: previous('cloth', 'position', 'f32', POSITION_WORDS), old: previous('cloth', 'previous', 'f32', POSITION_WORDS),
    ...(held ? { pin: previous('cloth', 'pinned', 'u32', POINTS) } : {}),
  }, {
    ...pointSteps,
    x: read('pos', 'i0'), y: read('pos', 'i1'), z: read('pos', 'i2'), bx: read('old', 'i0'), by: read('old', 'i1'), bz: read('old', 'i2'),
    free: step('const@1', { value: 1, type: 'f32' }), fixed: step('const@1', { value: 0, type: 'f32' }),
    ...(held ? { p: read('pin', 'e'), isp: step('ne@1', { a: 'p', b: 0 }), w: sel('free', 'fixed', 'isp') } : { w: add('free', 'fixed') }),
    vx: sub('x', 'bx'), vy0: sub('y', 'by'), vy: sub('vy0', FALL), vz: sub('z', 'bz'),
    sx: mul('vx', 'w'), sy: mul('vy', 'w'), sz: mul('vz', 'w'), nx: add('x', 'sx'), ny: add('y', 'sy'), nz: add('z', 'sz'),
    w0: write('moved', 'm0', 'nx'), w1: write('moved', 'm1', 'ny'), w2: write('moved', 'm2', 'nz'), w3: write('moved', 'm3', 'w'),
  }, { moved: scratch('f32', 4 * POINTS) }, POINTS);
  const passes = Array.from({ length: PASSES }, (_, i) => clothPass(i + 1, i === 0 ? 'cloth_move' : `cloth_pass${i}`, COLOURS[i % COLOURS.length]!));
  const cloth = stepped('cloth', 'Keeps the step: each point\'s new position, a pinned point\'s the one it had; its old position; and its pin.', CLOTH_RATE, {
    solved: storage(`cloth_pass${PASSES}`, 'out', 'f32', 4 * POINTS), pos: previous('cloth', 'position', 'f32', POSITION_WORDS),
    pin: previous('cloth', 'pinned', 'u32', POINTS), k: STEP_INDEX,
  }, {
    ...pointSteps, first: step('eq@1', { a: 'k', b: 0 }),
    x: read('pos', 'i0'), y: read('pos', 'i1'), z: read('pos', 'i2'), nx: read('solved', 'm0'), ny: read('solved', 'm1'), nz: read('solved', 'm2'), p: read('pin', 'e'),
    ...(held ? { isp: step('ne@1', { a: 'p', b: 0 }), hx: sel('nx', 'x', 'isp'), hy: sel('ny', 'y', 'isp'), hz: sel('nz', 'z', 'isp') } : {}),
    // The start: x from the column; y and z from the row, swung out by an angle that grows across the width.
    cf: cvt('gx', 'f32'), rf: cvt('gy', 'f32'), x0a: sub('cf', (SIDE - 1) / 2), x0: mul('x0a', REST),
    t0: mul('cf', TWIST / (SIDE - 1)), ang: add('t0', LIFT - TWIST / 2), ca: step('cos@1', { x: 'ang' }), sa: step('sin@1', { x: 'ang' }),
    down: mul('rf', -REST), out: mul('rf', REST), y0: mul('down', 'ca'), z0: mul('out', 'sa'),
    top: step('eq@1', { a: 'gy', b: 0 }), loose: step('const@1', { value: 0, type: 'u32' }), pin1: step('const@1', { value: 1, type: 'u32' }), p0: sel('loose', 'pin1', 'top'),
    ax: sel(held ? 'hx' : 'nx', 'x0', 'first'), ay: sel(held ? 'hy' : 'ny', 'y0', 'first'), az: sel(held ? 'hz' : 'nz', 'z0', 'first'),
    ox: sel('x', 'x0', 'first'), oy: sel('y', 'y0', 'first'), oz: sel('z', 'z0', 'first'), op: sel('p', 'p0', 'first'),
    wp0: write('position', 'i0', 'ax'), wp1: write('position', 'i1', 'ay'), wp2: write('position', 'i2', 'az'),
    wb0: write('previous', 'i0', 'ox'), wb1: write('previous', 'i1', 'oy'), wb2: write('previous', 'i2', 'oz'), wn: write('pinned', 'e', 'op'),
  }, { position: field('f32', POSITION_WORDS, carry), previous: field('f32', POSITION_WORDS, carry), pinned: field('u32', POINTS, carry) }, POINTS);
  return [move, ...passes, cloth];
}

/** The grid the cloth is shown through, two words a texel, and the samples each of its 63 × 63 quads adds into it. */
const SHOWN = 512;
const QUADS = (SIDE - 1) * (SIDE - 1);
const SAMPLES = 16;
/**
 * The cloth as a frame shows it: `cloth_flat` lays each point on the picture (an oblique view: x across, y down, z
 * leaning right and down), `cloth_cover` adds 256 samples of each quad into the texel each falls on (a count, and
 * the quad's tone: the cloth is woven in a check of 8 × 8 quads), and `cloth_view` shades each covered pixel by its
 * mean tone, linen and madder on a dark ground, so the check shows how the cloth hangs.
 */
export function clothViewOps(): JsonObject[] {
  const span = SIDE * REST * 1.45;
  const flat = perFrame('cloth_flat', 'Lays each point of the cloth on the picture, in an oblique view.', { pos: storage('cloth', 'position', 'f32', POSITION_WORDS) }, {
    e: step('element@1'), i0: mul('e', 3), i1: add('i0', 1), i2: add('i0', 2), o0: mul('e', 2), o1: add('o0', 1),
    x: read('pos', 'i0'), y: read('pos', 'i1'), z: read('pos', 'i2'),
    zx: mul('z', 0.6), ua: add('x', 'zx'), ub: mul('ua', 1 / span), u: add('ub', 0.42),
    zy: mul('z', 0.25), va: sub('zy', 'y'), vb: mul('va', 1 / span), v: add('vb', 0.12),
    w0: write('at', 'o0', 'u'), w1: write('at', 'o1', 'v'),
  }, { at: scratch('f32', 2 * POINTS) }, POINTS);
  const corner = (n: string, row: string, col: string): JsonObject => ({
    [`${n}r`]: mul(row, SIDE), [`${n}p`]: add(`${n}r`, col), [`${n}i`]: mul(`${n}p`, 2), [`${n}j`]: add(`${n}i`, 1),
    [`${n}u`]: read('at', `${n}i`), [`${n}v`]: read('at', `${n}j`),
  });
  const cover = perFrame('cloth_cover', 'Adds 256 samples of each quad of the cloth, with its tone in the check, into the texel each falls on.', { at: storage('cloth_flat', 'at', 'f32', 2 * POINTS) }, {
    e: step('element@1'), quad: step('div@1', { a: 'e', b: SAMPLES * SAMPLES }), s: step('rem@1', { a: 'e', b: SAMPLES * SAMPLES }),
    qr: step('div@1', { a: 'quad', b: SIDE - 1 }), qc: step('rem@1', { a: 'quad', b: SIDE - 1 }), qr1: add('qr', 1), qc1: add('qc', 1),
    sa: step('rem@1', { a: 's', b: SAMPLES }), sb: step('div@1', { a: 's', b: SAMPLES }), saf: cvt('sa', 'f32'), sbf: cvt('sb', 'f32'),
    a0: add('saf', 0.5), a: mul('a0', 1 / SAMPLES), b0: add('sbf', 0.5), b: mul('b0', 1 / SAMPLES),
    ...corner('c00', 'qr', 'qc'), ...corner('c01', 'qr', 'qc1'), ...corner('c10', 'qr1', 'qc'), ...corner('c11', 'qr1', 'qc1'),
    tu: step('mix@1', { a: 'c00u', b: 'c01u', t: 'a' }), bu: step('mix@1', { a: 'c10u', b: 'c11u', t: 'a' }), u: step('mix@1', { a: 'tu', b: 'bu', t: 'b' }),
    tv: step('mix@1', { a: 'c00v', b: 'c01v', t: 'a' }), bv: step('mix@1', { a: 'c10v', b: 'c11v', t: 'a' }), v: step('mix@1', { a: 'tv', b: 'bv', t: 'b' }),
    uc: step('clamp@1', { x: 'u', lo: 0, hi: 0.999 }), vc: step('clamp@1', { x: 'v', lo: 0, hi: 0.999 }),
    us: mul('uc', SHOWN), vs: mul('vc', SHOWN), uf: step('floor@1', { x: 'us' }), vf: step('floor@1', { x: 'vs' }), ux: cvt('uf', 'u32'), uy: cvt('vf', 'u32'),
    row: mul('uy', SHOWN), cell: add('row', 'ux'), c0: mul('cell', 2), c1: add('c0', 1), one: step('const@1', { value: 1, type: 'u32' }),
    br: step('div@1', { a: 'qr', b: 8 }), bc: step('div@1', { a: 'qc', b: 8 }), bsum: add('br', 'bc'), tone: step('and@1', { a: 'bsum', b: 1 }),
    wn: step('atomic_add@1', { buf: 'cover', i: 'c0', v: 'one' }), wt: step('atomic_add@1', { buf: 'cover', i: 'c1', v: 'tone' }),
  }, { cover: scratch('u32', 2 * SHOWN * SHOWN) }, QUADS * SAMPLES * SAMPLES);
  const display = view('cloth_view', 'Shades each pixel the cloth covers by its mean tone in the check, linen and madder, on a dark ground.', {
    cover: storage('cloth_cover', 'cover', 'u32', 2 * SHOWN * SHOWN),
  }, {
    ...uvCell(SHOWN), c0: mul('cell', 2), c1: add('c0', 1), n: read('cover', 'c0'), t: read('cover', 'c1'), nf: cvt('n', 'f32'), tf: cvt('t', 'f32'),
    nd: step('max@1', { a: 'nf', b: 1 }), tone: step('div@1', { a: 'tf', b: 'nd' }), on: step('gt@1', { a: 'n', b: 0 }),
    lr: step('mix@1', { a: 0.86, b: 0.62, t: 'tone' }), lg: step('mix@1', { a: 0.8, b: 0.16, t: 'tone' }), lb: step('mix@1', { a: 0.68, b: 0.14, t: 'tone' }),
    r: sel(0.03, 'lr', 'on'), g: sel(0.035, 'lg', 'on'), b: sel(0.05, 'lb', 'on'),
    out: step('compose@1', { x: 'r', y: 'g', z: 'b', w: 1 }),
  });
  return [flat, cover, display];
}

// ---------------------------------------------------------------------------------------------------
// Documents. `view3d` takes a whole document (#378's); operators are items of their writer's layer (#429).

const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
const WRITER = 'agent:alpha';

/** One `check_operator` reply per operator, as #429's check gives it: `outcome`, `issues` and `estimate_ns`. */
export function checks(bin: string, out: string, ops: JsonObject[]): JsonObject[] {
  return run(bin, out, ops.map((operator) => ({ call: 'check_operator', operator })));
}
/** The operators the check refuses, each as a sentence naming it and what the check said. */
export function refusals(ops: JsonObject[], replies: JsonObject[]): string[] {
  return ops.flatMap((op, i) => {
    const r = replies[i]!;
    if (r['code'] === undefined && r['outcome'] === 'accepted' && typeof r['estimate_ns'] === 'number') return [];
    return [`the check refuses ${String(op['id'])}: ${shown(r['issues'] ?? r)}`];
  });
}
/** Operators each declaring the cost the check estimates for it, so no declaration is understated. */
export function withEstimates(ops: JsonObject[], replies: JsonObject[]): JsonObject[] {
  return ops.map((op, i) => {
    const est = Number(replies[i]!['estimate_ns']);
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
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1993 acceptance fixture.`, size: [64, 64], camera: 'cam',
    transport: { span: '65s' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items: withIds,
  };
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378's, with #380's `from` and `timings`, #483's `read`, #484's `seeks` and #252's `carried`).

export const view3dCall = (spec: JsonObject): JsonObject => ({ call: 'view3d', look: LOOK, size: [64, 64], fps: 60, ...spec });

/** One output read back: storage `{type, count, file}`, `file` naming `<sha>.u32` under `out`. */
export interface Read { file: string; count: number | null }
/** A carried output's row on a frame (#252's `carried`). */
export interface Carried { step: number; ringBytes: number; budget: number; checkpoints: number[]; restored: { from: number; steps: number } | null }
export interface V3Frame { index: number; frame: number; final: string | null; read: Map<string, Read>; carried: Map<string, Carried>; passesMs: Map<string, number> | null }

/** A reply's frames, or the reason it has none (a refusal's code and message). */
export function view3dFrames(reply: JsonObject, what: string): V3Frame[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  if (!Array.isArray(reply['frames'])) return [];
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
    const passes = isObject(f['passes_ms']) ? new Map(Object.entries(f['passes_ms']).map(([k, v]) => [k, num(v, `${at}.passes_ms.${k}`)])) : null;
    return { index, frame: num(f['frame'], `${at}.frame`), final: typeof f['final'] === 'string' ? f['final'] : null, read, carried, passesMs: passes };
  });
}
/** Why a reply drew nothing, as the binary says it. */
export const refusal = (reply: JsonObject): string => (reply['code'] === undefined ? 'no frames' : `${String(reply['code'])}: ${shown(reply['message'] ?? reply['what'] ?? reply)}`);
/** The frames numbered `n`, in the order drawn (a seek draws a number again). */
export const framesNumbered = (frames: V3Frame[], n: number): V3Frame[] => frames.filter((f) => f.frame === n);

/** A storage output's words as a frame read them (#483's `read`), with the SHA-256 that names their file. */
export interface Words { hash: string; f32: Float32Array; u32: Uint32Array }
export function wordsOf(out: string, f: V3Frame, key: string, what: string): Words {
  const r = f.read.get(key);
  expect(r, `${what}: frame ${f.frame} (reply entry ${f.index}) read ${key}; it read ${[...f.read.keys()].join(', ') || 'nothing'}`).toBeDefined();
  expect(r!.file, `${what}: ${key}'s file is named by its SHA-256`).toMatch(SHA);
  const b = readFileSync(join(out, `${r!.file}.u32`));
  expect(sha256(b), `${what}: the SHA-256 of ${key}'s file is its name`).toBe(r!.file);
  const bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return { hash: r!.file, f32: new Float32Array(bytes), u32: new Uint32Array(bytes) };
}

// 4,096 points under softened gravity (criterion 6) --------------------------------------------------

/** 4,096 points of equal mass in a plane, each two f32 words a field: x and y. */
export const BODIES = 4096;
export const BODY_WORDS = 2 * BODIES;
/** Steps a second, so 1,000 steps are 16.7 s; the softening length; and G × one point's mass, so the whole disc's is 1. */
export const BODY_RATE = 60;
const SOFTENING = 0.05;
const GM = 1 / BODIES;
/** The fixed point the pulls are summed in: an acceleration of 1 is 2²² (README: Readings). */
const FIXED = 4_194_304;
/** Each pull pairs a point with 3 others (8 fetches: 4 positions), so 1,365 blocks of 3 reach all 4,095; an operator runs at most 228 blocks of 4,096 elements. */
const OTHERS = 3;
const BLOCKS = (BODIES - 1) / OTHERS;
const BLOCKS_AN_OPERATOR = 228;
const PULLS = Math.ceil(BLOCKS / BLOCKS_AN_OPERATOR);
/** The points' two fields, as `read` names them. */
export const BODY_FIELDS = { position: 'bodies.position', velocity: 'bodies.velocity' } as const;
/** Every stepped operator of the points' step, in the order a step runs them. */
export const BODY_STEP_OPS = ['bodies_move', ...Array.from({ length: PULLS }, (_, i) => `pull${i}`), 'pull_sum', 'bodies'];

/**
 * 4,096 points under softened gravity, held as two carried fields of the stepped operator `bodies`: `position` and
 * `velocity` (f32, x and y of each point). The pull of point j on point i is G m (xⱼ − xᵢ) ÷ (|xⱼ − xᵢ|² + ε²)^1.5
 * (Plummer's softening; Aarseth, "Dynamical evolution of clusters of galaxies", MNRAS 126, 1963), so with every
 * position read from one step the pull of i on j is its exact opposite and the pulls sum to no momentum. A step:
 * `bodies_move` writes each point's moved position, x + v ÷ rate; `pull0` … `pull5` each take a point and three
 * others (a compute operator's 8 fetches hold 4 positions), every point meeting each of the 4,095 others once, and
 * add the three pulls on it, in fixed point, into its two words with atomic adds; `pull_sum` adds the six sums (an
 * operator binds at most 8 storage buffers); `bodies` keeps the moved position and adds the summed pull ÷ rate to
 * the velocity. Step 0 places the points in a disc, turning about its centre.
 *
 * The pulls read a point's own position through `own` and the others' through `others`: both the `position` field as
 * the previous step left it. `othersThisStep` is the criterion's planted step: `others` reads the positions this
 * step already wrote, `bodies_move.moved`, in place of the previous step's, so the pull of j on i and of i on j are
 * taken between different pairs of places and no longer cancel.
 */
export function bodiesOps(spec: { othersThisStep?: boolean } = {}): JsonObject[] {
  const carry: JsonObject = { every: EVERY, budget: DEFAULT_RING };
  const dt = 1 / BODY_RATE;
  const move = stepped('bodies_move', 'Moves each point by its velocity for one step.', BODY_RATE, {
    pos: previous('bodies', 'position', 'f32', BODY_WORDS), vel: previous('bodies', 'velocity', 'f32', BODY_WORDS),
  }, {
    e: step('element@1'), x: read('pos', 'e'), v: read('vel', 'e'), d: mul('v', dt), nx: add('x', 'd'), w: write('moved', 'e', 'nx'),
  }, { moved: scratch('f32', BODY_WORDS) }, BODY_WORDS);
  const other = (n: number): JsonObject => ({
    [`j${n}a`]: add('off', n), [`j${n}b`]: add('i', `j${n}a`), [`j${n}`]: step('and@1', { a: `j${n}b`, b: BODIES - 1 }), [`j${n}x`]: mul(`j${n}`, 2), [`j${n}y`]: add(`j${n}x`, 1),
    [`x${n}`]: read('others', `j${n}x`), [`y${n}`]: read('others', `j${n}y`),
    [`dx${n}`]: sub(`x${n}`, 'xi'), [`dy${n}`]: sub(`y${n}`, 'yi'), [`sx${n}`]: mul(`dx${n}`, `dx${n}`), [`sy${n}`]: mul(`dy${n}`, `dy${n}`),
    [`r${n}a`]: add(`sx${n}`, `sy${n}`), [`r${n}`]: add(`r${n}a`, SOFTENING * SOFTENING), [`q${n}`]: step('inverse_sqrt@1', { x: `r${n}` }),
    [`q${n}2`]: mul(`q${n}`, `q${n}`), [`q${n}3`]: mul(`q${n}2`, `q${n}`), [`fx${n}`]: mul(`dx${n}`, `q${n}3`), [`fy${n}`]: mul(`dy${n}`, `q${n}3`),
  });
  const pulls = Array.from({ length: PULLS }, (_, k) => {
    const first = k * BLOCKS_AN_OPERATOR;
    const blocks = Math.min(BLOCKS_AN_OPERATOR, BLOCKS - first);
    return stepped(`pull${k}`, `Adds to each point the pull of the points ${3 * first + 1} to ${3 * (first + blocks)} places after it, three a fetch group.`, BODY_RATE, {
      own: previous('bodies', 'position', 'f32', BODY_WORDS),
      others: spec.othersThisStep ? storage('bodies_move', 'moved', 'f32', BODY_WORDS) : previous('bodies', 'position', 'f32', BODY_WORDS),
    }, {
      e: step('element@1'), i: step('and@1', { a: 'e', b: BODIES - 1 }), bl0: step('div@1', { a: 'e', b: BODIES }), bl: add('bl0', first),
      off0: mul('bl', OTHERS), off: add('off0', 1), ix: mul('i', 2), iy: add('ix', 1), xi: read('own', 'ix'), yi: read('own', 'iy'),
      ...other(0), ...other(1), ...other(2),
      ax0: add('fx0', 'fx1'), ax: add('ax0', 'fx2'), ay0: add('fy0', 'fy1'), ay: add('ay0', 'fy2'),
      qx: mul('ax', GM * FIXED), qy: mul('ay', GM * FIXED), rx: step('round@1', { x: 'qx' }), ry: step('round@1', { x: 'qy' }),
      nx: cvt('rx', 'i32'), ny: cvt('ry', 'i32'), ux: bits('nx', 'u32'), uy: bits('ny', 'u32'),
      wx: step('atomic_add@1', { buf: 'sum', i: 'ix', v: 'ux' }), wy: step('atomic_add@1', { buf: 'sum', i: 'iy', v: 'uy' }),
    }, { sum: scratch('u32', BODY_WORDS) }, blocks * BODIES);
  });
  // An operator binds at most 8 storage buffers, so the six sums are added in an operator of their own.
  const total: JsonObject = { e: step('element@1') };
  pulls.forEach((_, k) => {
    total[`s${k}`] = read(`sum${k}`, 'e');
    if (k > 0) total[`t${k}`] = add(k === 1 ? 's0' : `t${k - 1}`, `s${k}`);
  });
  const sum = stepped('pull_sum', 'Adds the six operators\' pulls on each point, as the integers they are.', BODY_RATE,
    Object.fromEntries(pulls.map((_, k) => [`sum${k}`, storage(`pull${k}`, 'sum', 'u32', BODY_WORDS)])),
    { ...total, w: write('total', 'e', `t${PULLS - 1}`) }, { total: scratch('u32', BODY_WORDS) }, BODY_WORDS);
  const turn = 2 * Math.PI;
  const bodies = stepped('bodies', 'Keeps the step: each point\'s moved position, and its velocity with the summed pull of every other point added.', BODY_RATE, {
    moved: storage('bodies_move', 'moved', 'f32', BODY_WORDS), vel: previous('bodies', 'velocity', 'f32', BODY_WORDS), pull: storage('pull_sum', 'total', 'u32', BODY_WORDS), k: STEP_INDEX,
  }, {
    e: step('element@1'), first: step('eq@1', { a: 'k', b: 0 }), b: step('div@1', { a: 'e', b: 2 }), c: step('and@1', { a: 'e', b: 1 }), isy: step('eq@1', { a: 'c', b: 1 }),
    x: read('moved', 'e'), v: read('vel', 'e'), au: read('pull', 'e'), ai: bits('au', 'i32'),
    af: cvt('ai', 'f32'), dv: mul('af', dt / FIXED), nv: add('v', 'dv'),
    // The start: a disc of radius 1, its points' radii and angles from hashes of their index, turning about its centre.
    h1: step('hash@1', { a: 'b', b: 1 }), h2: step('hash@1', { a: 'b', b: 2 }), u1: step('rand@1', { key: 'h1' }), u2: step('rand@1', { key: 'h2' }),
    rr: step('sqrt@1', { x: 'u1' }), r0: mul('rr', 0.9), r: add('r0', 0.1), ang: mul('u2', turn), ca: step('cos@1', { x: 'ang' }), sa: step('sin@1', { x: 'ang' }),
    px: mul('r', 'ca'), py: mul('r', 'sa'), sr: step('sqrt@1', { x: 'r' }), sp: mul('sr', 0.8), vx0: mul('sa', 'sp'), vx: step('neg@1', { x: 'vx0' }), vy: mul('ca', 'sp'),
    p0: sel('px', 'py', 'isy'), v0: sel('vx', 'vy', 'isy'), op: sel('x', 'p0', 'first'), ov: sel('nv', 'v0', 'first'),
    wp: write('position', 'e', 'op'), wv: write('velocity', 'e', 'ov'),
  }, { position: field('f32', BODY_WORDS, carry), velocity: field('f32', BODY_WORDS, carry) }, BODY_WORDS);
  return [move, ...pulls, sum, bodies];
}

/** Total momentum and the summed momentum magnitudes of a state, the points' equal mass taken as 1, summed in f64. */
export function momentum(velocity: Float32Array): { total: [number, number]; magnitudes: number } {
  let px = 0; let py = 0; let magnitudes = 0;
  for (let b = 0; b < velocity.length / 2; b++) {
    const vx = velocity[2 * b]!; const vy = velocity[2 * b + 1]!;
    px += vx; py += vy; magnitudes += Math.hypot(vx, vy);
  }
  return { total: [px, py], magnitudes };
}

// The water ring and the growing pattern (criterion 8's pictures), in carried textures -------------------
//
// These two are this part's own small documents for the taste call, written from the issue's Fields: a `texture`
// output of a stepped operator with `carry`, read back by a `texture` input with `step: previous`, and
// `stepped.bound` on the wave. The criteria that judge the ring and the pattern are other parts'.

/** A carried `r32float` grid with its checkpoint ring. */
const grid = (size: number, carry: JsonObject): JsonObject => ({ texture: { format: 'r32float', size: [size, size] }, carry });
/** A carried grid as the previous step left it (the issue's Fields: `inputs.<name>.from.texture: {op, output, step: previous}`). */
const previousGrid = (op: string, output: string): JsonObject => ({ type: 'texture', from: { texture: { op, output, step: 'previous' } } });
/** A grid an operator wrote, read later in the frame as its latest step left it (#483's form). */
const shownGrid = (op: string, output: string): JsonObject => ({ type: 'texture', from: { texture: { target: { op, output } } } });
/** Texel e of a `size` × `size` grid, row-major: `gx`, `gy`, its index `at` and its four neighbours' `at_l`, `at_r`, `at_u`, `at_d` (`edge` clamps at the rim or wraps round). */
function texelSteps(size: number, edge: 'clamp' | 'wrap'): JsonObject {
  const side = edge === 'clamp'
    ? {
      xl0: step('max@1', { a: 'gx', b: 1 }), xl: sub('xl0', 1), xr0: add('gx', 1), xr: step('min@1', { a: 'xr0', b: size - 1 }),
      yu0: step('max@1', { a: 'gy', b: 1 }), yu: sub('yu0', 1), yd0: add('gy', 1), yd: step('min@1', { a: 'yd0', b: size - 1 }),
    }
    : {
      xl0: add('gx', size - 1), xl: step('and@1', { a: 'xl0', b: size - 1 }), xr0: add('gx', 1), xr: step('and@1', { a: 'xr0', b: size - 1 }),
      yu0: add('gy', size - 1), yu: step('and@1', { a: 'yu0', b: size - 1 }), yd0: add('gy', 1), yd: step('and@1', { a: 'yd0', b: size - 1 }),
    };
  return {
    e: step('element@1'), gx: step('rem@1', { a: 'e', b: size }), gy: step('div@1', { a: 'e', b: size }), ...side,
    at: step('compose@1', { x: 'gx', y: 'gy' }), at_l: step('compose@1', { x: 'xl', y: 'gy' }), at_r: step('compose@1', { x: 'xr', y: 'gy' }),
    at_u: step('compose@1', { x: 'gx', y: 'yu' }), at_d: step('compose@1', { x: 'gx', y: 'yd' }),
  };
}
/** The value of `tex` at index `ixy`, as step `n` (one fetch; an r32float texel's value is its first lane). */
const texel = (tex: string, n: string, ixy: string): JsonObject => ({ [`${n}_t`]: step('load@1', { tex, ixy }), [n]: pick(`${n}_t`, 'x') });
/** The pixel's texel of a `size` × `size` grid, from screen_uv: steps `ix`, `iy` and the index `at`. */
function uvTexel(size: number): JsonObject {
  return {
    uv: step('screen_uv@1'), u: pick('uv', 'x'), v: pick('uv', 'y'), us: mul('u', size), vs: mul('v', size), uf: step('floor@1', { x: 'us' }), vf: step('floor@1', { x: 'vs' }),
    uu: cvt('uf', 'u32'), vu: cvt('vf', 'u32'), ix: step('min@1', { a: 'uu', b: size - 1 }), iy: step('min@1', { a: 'vu', b: size - 1 }), at: step('compose@1', { x: 'ix', y: 'iy' }),
  };
}

/** Criterion 1's grid: 128 × 128 cells of 1 cm, 60 steps a second, wave speed 0.24 m/s, so a ring grows 0.4 cells a step. */
export const WATER = { size: 128, cell: 0.01, rate: 60, speed: 0.24 } as const;
/**
 * The water ring: a height grid and its rate of change, two carried `r32float` textures of the stepped operator
 * `water`. Each step a cell's rate gains (c ÷ rate ÷ cell)² × the height's five-point Laplacian and its height gains
 * the new rate (the explicit wave equation; Courant, Friedrichs and Lewy, Math. Ann. 100, 1928); the rim reflects.
 * Step 0 is the drop: a bump of height 1 and σ 2 cells at the centre, at rest. `stepped.bound` declares the wave's
 * speed and cell, a ratio of 0.4 under the default `max` of 0.5. `water_view` shades each pixel by its cell's height.
 */
export function ringOps(): JsonObject[] {
  const { size, cell, rate, speed } = WATER;
  const courant2 = (speed / rate / cell) ** 2;
  const carry: JsonObject = { every: EVERY, budget: DEFAULT_RING };
  const water = stepped('water', 'A height grid that takes one drop at its centre and carries the ring outward.', rate, {
    h: previousGrid('water', 'height'), r: previousGrid('water', 'rate'), k: STEP_INDEX,
  }, {
    ...texelSteps(size, 'clamp'),
    ...texel('h', 'hc', 'at'), ...texel('h', 'hl', 'at_l'), ...texel('h', 'hr', 'at_r'), ...texel('h', 'hu', 'at_u'), ...texel('h', 'hd', 'at_d'), ...texel('r', 'rc', 'at'),
    n1: add('hl', 'hr'), n2: add('hu', 'hd'), n3: add('n1', 'n2'), h4: mul('hc', 4), lap: sub('n3', 'h4'), push: mul('lap', courant2),
    rn: add('rc', 'push'), hn: add('hc', 'rn'),
    xf: cvt('gx', 'f32'), yf: cvt('gy', 'f32'), ox: sub('xf', (size - 1) / 2), oy: sub('yf', (size - 1) / 2), ox2: mul('ox', 'ox'), oy2: mul('oy', 'oy'),
    d2: add('ox2', 'oy2'), dg: mul('d2', -1 / 8), drop: step('exp@1', { x: 'dg' }),
    first: step('eq@1', { a: 'k', b: 0 }), ho: sel('hn', 'drop', 'first'), ro: sel('rn', 0, 'first'),
    wh: step('store@1', { tex: 'height', ixy: 'at', v: 'ho' }), wr: step('store@1', { tex: 'rate', ixy: 'at', v: 'ro' }),
  }, { height: grid(size, carry), rate: grid(size, carry) }, size * size, { bound: { speed, cell } });
  const display = view('water_view', 'Shades each pixel by its cell\'s height: still water dark, a crest light, a trough darker.', { height: shownGrid('water', 'height') }, {
    ...uvTexel(size), ...texel('height', 'h', 'at'), lift: mul('h', 6), mid: add('lift', 0.35), f: step('clamp@1', { x: 'mid', lo: 0, hi: 1 }),
    r: mul('f', 0.55), g: mul('f', 0.8), b0: mul('f', 0.85), b: add('b0', 0.1),
    out: step('compose@1', { x: 'r', y: 'g', z: 'b', w: 1 }),
  });
  return [water, display];
}

/** Criterion 4's pattern: two 1,024 × 1,024 `r32float` textures stepped 600 times a second, so 10 s are 6,000 steps. */
export const PATTERN = { size: 1024, rate: 600, seconds: 10 } as const;
/**
 * The growing pattern: a reaction-diffusion pair (Gray and Scott's model as Pearson ran it, "Complex patterns in a
 * simple system", Science 261, 1993: feed 0.037, kill 0.06, diffusion 0.16 and 0.08 of the five-point Laplacian a
 * step) in two carried textures on a torus, `pattern_a.a` and `pattern_b.b`, each stepped by an operator of its own
 * (a compute operator's 8 fetches hold one grid's five cells and the other's one). Step 0 fills a with 1 and seeds b
 * in 6 × 6 squares, one in about every hundred 16 × 16 blocks. `pattern_view` shades each pixel by b. Each texture's
 * ring is the design's default (every 60 steps, 16 MiB); criterion 4's 160 MiB ring is another part's to judge.
 */
export function patternOps(): JsonObject[] {
  const { size, rate } = PATTERN;
  const carry: JsonObject = { every: EVERY, budget: DEFAULT_RING };
  const [feed, kill, da, db] = [0.037, 0.06, 0.16, 0.08];
  const lap = (n: string): JsonObject => ({ [`${n}1`]: add(`${n}l`, `${n}r`), [`${n}2`]: add(`${n}u`, `${n}d`), [`${n}3`]: add(`${n}1`, `${n}2`), [`${n}4`]: mul(`${n}c`, 4), [`${n}lap`]: sub(`${n}3`, `${n}4`) });
  const five = (tex: string, n: string): JsonObject => ({ ...texel(tex, `${n}c`, 'at'), ...texel(tex, `${n}l`, 'at_l'), ...texel(tex, `${n}r`, 'at_r'), ...texel(tex, `${n}u`, 'at_u'), ...texel(tex, `${n}d`, 'at_d') });
  const inputs: JsonObject = { a: previousGrid('pattern_a', 'a'), b: previousGrid('pattern_b', 'b'), k: STEP_INDEX };
  const a = stepped('pattern_a', 'The fed chemical: it diffuses, is used up where the other is, and is fed back toward 1.', rate, inputs, {
    ...texelSteps(size, 'wrap'), ...five('a', 'p'), ...texel('b', 'qc', 'at'), ...lap('p'),
    qq: mul('qc', 'qc'), use: mul('pc', 'qq'), spread: mul('plap', da), room: sub(1, 'pc'), fed: mul('room', feed),
    g1: sub('spread', 'use'), g2: add('g1', 'fed'), pn: add('pc', 'g2'),
    first: step('eq@1', { a: 'k', b: 0 }), po: sel('pn', 1, 'first'), w: step('store@1', { tex: 'a', ixy: 'at', v: 'po' }),
  }, { a: grid(size, carry) }, size * size);
  const b = stepped('pattern_b', 'The feeding chemical: it diffuses, grows where both are, and is removed at a steady rate.', rate, inputs, {
    ...texelSteps(size, 'wrap'), ...five('b', 'q'), ...texel('a', 'pc', 'at'), ...lap('q'),
    qq: mul('qc', 'qc'), use: mul('pc', 'qq'), spread: mul('qlap', db), gone: mul('qc', feed + kill),
    g1: add('spread', 'use'), g2: sub('g1', 'gone'), qn: add('qc', 'g2'),
    // The seeds: a 6 × 6 square in the middle of a 16 × 16 block, in the blocks whose hash is 0 of 100.
    bx: step('div@1', { a: 'gx', b: 16 }), by: step('div@1', { a: 'gy', b: 16 }), hb: step('hash@1', { a: 'bx', b: 'by', c: 1993 }), lot: step('rem@1', { a: 'hb', b: 100 }), chosen: step('eq@1', { a: 'lot', b: 0 }),
    lx: step('rem@1', { a: 'gx', b: 16 }), ly: step('rem@1', { a: 'gy', b: 16 }), lx5: sub('lx', 5), ly5: sub('ly', 5), inx: step('lt@1', { a: 'lx5', b: 6 }), iny: step('lt@1', { a: 'ly5', b: 6 }),
    in2: step('and@1', { a: 'inx', b: 'iny' }), seed: step('and@1', { a: 'in2', b: 'chosen' }), q0: sel(0, 1, 'seed'),
    first: step('eq@1', { a: 'k', b: 0 }), qo: sel('qn', 'q0', 'first'), w: step('store@1', { tex: 'b', ixy: 'at', v: 'qo' }),
  }, { b: grid(size, carry) }, size * size);
  const display = view('pattern_view', 'Shades each pixel by the feeding chemical: none dark, the pattern\'s lines light.', { b: shownGrid('pattern_b', 'b') }, {
    ...uvTexel(size), ...texel('b', 'q', 'at'), s: mul('q', 3), f: step('clamp@1', { x: 's', lo: 0, hi: 1 }),
    cr0: mul('f', 0.9), cr: add('cr0', 0.03), cg0: mul('f', 0.85), cg: add('cg0', 0.05), cb0: mul('f', 0.6), cb: add('cb0', 0.12),
    out: step('compose@1', { x: 'cr', y: 'cg', z: 'cb', w: 1 }),
  });
  return [a, b, display];
}

// ---------------------------------------------------------------------------------------------------
// A recording: the canvas's own PNG frames, all of one IHDR, put into an animated PNG as they are, their compressed
// image data moved into fdAT chunks unchanged, so the recording holds exactly the frames the canvas wrote.

function chunks(png: Buffer): { type: string; data: Buffer }[] | null {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  const out: { type: string; data: Buffer }[] = [];
  for (let o = 8; o + 12 <= png.length;) {
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
/** An animated PNG of the canvas's PNG frames at `fps`, looping; null when one isn't a PNG of the first one's size and format. */
export function apng(frames: Buffer[], fps: number): Buffer | null {
  const parsed = frames.map((f) => chunks(f));
  const ihdr = parsed[0]?.find((c) => c.type === 'IHDR')?.data;
  if (!ihdr || parsed.some((p) => !p || !p.find((c) => c.type === 'IHDR')?.data.equals(ihdr))) return null;
  const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4);
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const extra = parsed[0]!.filter((c) => !['IHDR', 'IDAT', 'IEND', 'acTL', 'fcTL', 'fdAT'].includes(c.type)).map((c) => chunk(c.type, c.data));
  const parts: Buffer[] = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('acTL', actl)];
  let seq = 0;
  parsed.forEach((p, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = Buffer.concat(p!.filter((c) => c.type === 'IDAT').map((c) => c.data));
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
