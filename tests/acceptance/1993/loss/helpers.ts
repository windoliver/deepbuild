// Test-side tools for the "loss" part of the #1993 acceptance tests (criterion 7: a device loss forced at step 900 of
// the 128 × 128 run): `deep-gpu` (#377's binary, with #378's `view3d`, #429's operator check, #483's `read` and
// #252's stepped operators and `carried`) built once per file and driven by JSON lines; criterion 1's water grid
// written as operator data, generated here so every step is readable; the reply readers; and the criterion's lines,
// each returning its problems as sentences. Nothing here asserts a criterion: every reader returns what it read or
// why it couldn't, and the test file asserts it, so a failure is a line of the test (but INCONCLUSIVE, raised here).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1993/loss is four levels down). */
const REPO = join(HERE, '..', '..', '..', '..');
const BIN = 'deep-gpu';

/** Criterion 7's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = '#1993.e693a7be';

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
const isCount = (v: JsonValue | undefined): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Anything the GPU runs runs on Metal: off macOS the test is INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs on macOS's Metal device, the reference platform; this is ${process.platform}`);
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
/** The binary's path, and why it didn't build ('' when it did); the test asserts the latter. */
export function useBin(): () => { path: string; error: string } {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1993-loss-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => ({ path: join(dir, BIN), error });
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1993-loss-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong program this part adds, reachable only through `--planted` (README: Planted program). */
export type Planted = 'restore_starts_from_clear_value';

/** A scenario's replies, one per call, or why there are none (`refused`, '' when it ran). */
export interface Ran { replies: JsonObject[]; refused: string }
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted, timeoutMs = 3_000_000): Ran {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${BIN} ${args.join(' ')}`;
  const none = (refused: string): Ran => ({ replies: [], refused: `${name}: ${refused}` });
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  if (r.error) return none((r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'did not finish within its timeout' : r.error.message);
  const stdout = r.stdout ?? '';
  if (r.status !== 0) return none(`exited ${String(r.status)} (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`);
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== 1) return none(`answered ${lines.length} lines to one scenario`);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return none(`its answer isn't JSON: ${lines[0]!.slice(0, 1500)}`); }
  if (!isObject(answer) || answer['ok'] !== true) return none(`refused the scenario: ${shown(answer)}`);
  const replies = answer['replies'];
  if (!Array.isArray(replies) || replies.length !== calls.length || !replies.every(isObject)) return none(`didn't answer one reply per call: ${shown(replies)}`);
  return { replies: replies as JsonObject[], refused: '' };
}

// ---------------------------------------------------------------------------------------------------
// Operators, as #429's check takes them (`steps` as `{op: name@major, args}`), with #252's stepped fields (`stepped:
// {rate}`, an input `{time: "step"}`) and this issue's (README: The surface under test): `carry` on a `texture`
// output, an input `{texture: {op, output, step: "previous"}}` and `stepped.bound`.

const step = (op: string, args: JsonObject = {}): JsonObject => ({ op, args });
const cvt = (x: string, to: string): JsonObject => step('convert@1', { x, to });
const pick = (x: string, p: string): JsonObject => step('split@1', { x, pick: p });
const mul = (a: string | number, b: string | number): JsonObject => step('mul@1', { a, b });
const add = (a: string | number, b: string | number): JsonObject => step('add@1', { a, b });
const sub = (a: string | number, b: string | number): JsonObject => step('sub@1', { a, b });
const sel = (f: string | number, t: string | number, cond: string): JsonObject => step('select@1', { f, t, cond });

/** The design's checkpoint ring defaults (Checkpoint ring: `every: steps = 60`, `budget: bytes = 16 MiB`). */
const CARRY: JsonObject = { every: 60, budget: 16 * 1024 * 1024 };
/** The fixed step being computed, 0 for the first. */
const STEP_INDEX: JsonObject = { type: 'u32', from: { time: 'step' } };
/** A carried `r32float` grid with its checkpoint ring (the issue's Fields: `outputs.<name>.carry` on a `texture` output). */
const grid = (size: number): JsonObject => ({ texture: { format: 'r32float', size: [size, size] }, carry: CARRY });
/** A carried grid as the previous step left it (the issue's Fields: `inputs.<name>.from.texture: {op, output, step: previous}`). */
const previousGrid = (op: string, output: string): JsonObject => ({ type: 'texture', from: { texture: { op, output, step: 'previous' } } });
/** A grid an operator wrote, read later in the frame as its latest step left it (#483's form). */
const shownGrid = (op: string, output: string): JsonObject => ({ type: 'texture', from: { texture: { target: { op, output } } } });
/** The value of `tex` at index `ixy`, as step `n` (one fetch; an r32float texel's value is its first lane). */
const texel = (tex: string, n: string, ixy: string): JsonObject => ({ [`${n}_t`]: step('load@1', { tex, ixy }), [n]: pick(`${n}_t`, 'x') });

/** Criterion 1's grid: 128 × 128 cells of 1 cm, 60 steps a second, wave speed 0.24 m/s. */
export const WATER = { size: 128, cell: 0.01, rate: 60, speed: 0.24 } as const;
/** The grid's two carried textures, as `read` and a frame's `carried` name them: the state a step keeps. */
export const STATE = ['water.height', 'water.rate'] as const;

/**
 * The 128 × 128 run: a height grid and its rate of change, two carried `r32float` textures of the stepped operator
 * `water`. Each step a cell's rate gains (c ÷ rate ÷ cell)² × the height's five-point Laplacian and its height gains
 * the new rate (the explicit wave equation; Courant, Friedrichs and Lewy, Math. Ann. 100, 1928); the rim reflects, and
 * nothing damps it. Step 0 is the one drop at the centre: a bump of height 1 and σ 2 cells, at rest; no later step
 * adds one. `stepped.bound` declares the wave's speed and cell, a ratio of 0.4 under the default `max` of 0.5. Both
 * textures' clear value is the default, 0: a grid of zeros stays zeros at every later step. `water_view` shades each
 * pixel by its cell's height.
 */
export function waterOps(): JsonObject[] {
  const { size, cell, rate, speed } = WATER;
  const courant2 = (speed / rate / cell) ** 2;
  const edge = size - 1;
  const water: JsonObject = {
    id: 'water', kind: 'compute', origin: 'composed', about: 'A height grid that takes one drop at its centre and carries the ring outward.',
    inputs: { h: previousGrid('water', 'height'), r: previousGrid('water', 'rate'), k: STEP_INDEX },
    steps: {
      // Texel e, row-major, and its four neighbours, clamped at the rim.
      e: step('element@1'), gx: step('rem@1', { a: 'e', b: size }), gy: step('div@1', { a: 'e', b: size }),
      xl0: step('max@1', { a: 'gx', b: 1 }), xl: sub('xl0', 1), xr0: add('gx', 1), xr: step('min@1', { a: 'xr0', b: edge }),
      yu0: step('max@1', { a: 'gy', b: 1 }), yu: sub('yu0', 1), yd0: add('gy', 1), yd: step('min@1', { a: 'yd0', b: edge }),
      at: step('compose@1', { x: 'gx', y: 'gy' }), at_l: step('compose@1', { x: 'xl', y: 'gy' }), at_r: step('compose@1', { x: 'xr', y: 'gy' }),
      at_u: step('compose@1', { x: 'gx', y: 'yu' }), at_d: step('compose@1', { x: 'gx', y: 'yd' }),
      ...texel('h', 'hc', 'at'), ...texel('h', 'hl', 'at_l'), ...texel('h', 'hr', 'at_r'), ...texel('h', 'hu', 'at_u'), ...texel('h', 'hd', 'at_d'), ...texel('r', 'rc', 'at'),
      n1: add('hl', 'hr'), n2: add('hu', 'hd'), n3: add('n1', 'n2'), h4: mul('hc', 4), lap: sub('n3', 'h4'), push: mul('lap', courant2),
      rn: add('rc', 'push'), hn: add('hc', 'rn'),
      // The drop, written at step 0 only: exp(−d² ÷ 8), d the cell's distance from the centre in cells.
      xf: cvt('gx', 'f32'), yf: cvt('gy', 'f32'), ox: sub('xf', edge / 2), oy: sub('yf', edge / 2), ox2: mul('ox', 'ox'), oy2: mul('oy', 'oy'),
      d2: add('ox2', 'oy2'), dg: mul('d2', -1 / 8), drop: step('exp@1', { x: 'dg' }),
      first: step('eq@1', { a: 'k', b: 0 }), ho: sel('hn', 'drop', 'first'), ro: sel('rn', 0, 'first'),
      wh: step('store@1', { tex: 'height', ixy: 'at', v: 'ho' }), wr: step('store@1', { tex: 'rate', ixy: 'at', v: 'ro' }),
    },
    outputs: { height: grid(size), rate: grid(size) },
    elements: size * size, workgroup: 256, stepped: { rate, bound: { speed, cell } }, cost: { ns_per_element: 1 },
  };
  const view: JsonObject = {
    id: 'water_view', kind: 'pass', origin: 'composed', about: 'Shades each pixel by its cell\'s height: still water dark, a crest light, a trough darker.',
    inputs: { height: shownGrid('water', 'height') },
    steps: {
      uv: step('screen_uv@1'), u: pick('uv', 'x'), v: pick('uv', 'y'), us: mul('u', size), vs: mul('v', size), uf: step('floor@1', { x: 'us' }), vf: step('floor@1', { x: 'vs' }),
      uu: cvt('uf', 'u32'), vu: cvt('vf', 'u32'), ix: step('min@1', { a: 'uu', b: edge }), iy: step('min@1', { a: 'vu', b: edge }), at: step('compose@1', { x: 'ix', y: 'iy' }),
      ...texel('height', 'h', 'at'), lift: mul('h', 6), mid: add('lift', 0.35), f: step('clamp@1', { x: 'mid', lo: 0, hi: 1 }),
      r: mul('f', 0.55), g: mul('f', 0.8), b0: mul('f', 0.85), b: add('b0', 0.1),
      out: step('compose@1', { x: 'r', y: 'g', z: 'b', w: 1 }),
    },
    outputs: { color: 'out', blend: 'replace' }, chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 1 }, fallback: 'look',
  };
  return [water, view];
}

// ---------------------------------------------------------------------------------------------------
// Documents. `view3d` takes a whole document (#378's); operators are items of their writer's layer (#429).

const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;

/** The operators the check refuses, each as a sentence naming it and what the check said; none when all are accepted. */
export function refusals(ops: JsonObject[], replies: JsonObject[]): string[] {
  return ops.flatMap((op, i) => {
    const r = replies[i];
    if (r && r['code'] === undefined && r['outcome'] === 'accepted' && typeof r['estimate_ns'] === 'number') return [];
    return [`the check refuses ${String(op['id'])}: ${shown(r?.['issues'] ?? r)}`];
  });
}
/** An operator as an item of its writer's layer: its kind `gpu.<kind>@1`, its fields in `params`, declaring the cost the check estimates. */
function asItem(op: JsonObject, estimate: JsonValue | undefined): JsonObject {
  const params = JSON.parse(JSON.stringify(op)) as JsonObject;
  delete params['id'];
  delete params['kind'];
  params['cost'] = op['kind'] === 'compute' ? { ns_per_element: estimate ?? 1 } : { ns_per_px: estimate ?? 1 };
  return { kind: `gpu.${String(op['kind'])}@1`, params };
}
/** A showpiece scene of a camera, a box under the pass and the operators given, 65 s long, written to `dir`. */
export function writeWaterDoc(dir: string, ops: JsonObject[], checked: JsonObject[]): string {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 7], target: [0, 0, 0], fov: 40 } },
    b0: { kind: 'mark.box@1', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0, 0] } },
  };
  ops.forEach((op, i) => { items[String(op['id'])] = asItem(op, checked[i]?.['estimate_ns']); });
  const withIds: JsonObject = {};
  let n = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(n++).padStart(3, '0')}`, layer: 'main', ...item };
  const id = 'water-1993-loss';
  const doc: JsonObject = {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #1993 acceptance fixture.`, size: [64, 64], camera: 'cam',
    transport: { span: '65s' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, items: withIds,
  };
  const path = join(dir, `${id}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378's, with #483's `read` and #252's `carried`), and the forced loss on it (README: The surface under
// test): `lose_device_at`, the reply's `device_losses` and a frame's `settling`, each spelled as #377's `frames`
// call spells it.

/** The run's last step, and the step the device is lost at (the criterion's 1,800 and 900). */
export const LAST = 1800;
export const LOST_AT = 900;
/** A step as the criterion writes it: 1,800. */
export const nth = (n: number): string => n.toLocaleString('en-US');

/**
 * One play of the 128 × 128 run from step 0 to step 1,800 at one frame a step (60 frames a second, 60 steps a
 * second, so frame n shows step n), whose last frame reads the state back. `loseAt` forces the device lost while
 * that frame draws.
 */
export function playCall(doc: string, loseAt?: number): JsonObject {
  return {
    call: 'view3d', doc, look: LOOK, size: [64, 64], fps: WATER.rate, frames: LAST + 1, capture: [LAST], read: [...STATE],
    ...(loseAt === undefined ? {} : { lose_device_at: loseAt }),
  };
}

/** A frame of a play: its number, whether it reports settling, the step each carried output holds and each output's read file. */
export interface Frame { index: number; frame: number; settling: boolean; steps: Map<string, number>; read: Map<string, string> }
/** A play's reply: its frames in the order drawn, how many times it says the device was lost, or why it drew nothing. */
export interface Play { refused: string; losses: JsonValue | undefined; frames: Frame[] }

export function playOf(reply: JsonObject | undefined): Play {
  if (reply?.['code'] === 'unsupported_platform') inconclusive('view3d reports unsupported_platform');
  if (!reply || reply['code'] !== undefined || !Array.isArray(reply['frames'])) {
    return { refused: reply ? `${String(reply['code'] ?? 'no frames')}: ${shown(reply['message'] ?? reply)}` : 'no reply', losses: undefined, frames: [] };
  }
  const frames = reply['frames'].map((f, index): Frame => {
    const o = isObject(f) ? f : {};
    const steps = new Map<string, number>();
    for (const [k, v] of Object.entries(isObject(o['carried']) ? o['carried'] : {})) if (isObject(v) && isCount(v['step'])) steps.set(k, v['step']);
    const read = new Map<string, string>();
    for (const [k, v] of Object.entries(isObject(o['read']) ? o['read'] : {})) if (isObject(v) && typeof v['file'] === 'string') read.set(k, v['file']);
    return { index, frame: isCount(o['frame']) ? o['frame'] : -1, settling: o['settling'] === true, steps, read };
  });
  return { refused: '', losses: reply['device_losses'], frames };
}

// ---------------------------------------------------------------------------------------------------
// The criterion's lines. Each returns its problems as sentences, none when the line holds.

/** What a frame says its state holds: each carried texture's step, or that it reports none. */
const stateText = (f: Frame): string => STATE.map((k) => (f.steps.has(k) ? `${k} at step ${nth(f.steps.get(k)!)}` : `no carried ${k}`)).join(', ');
/** Whether a frame's state is at the frame's own step: both carried textures report it (#252's `carried.<key>.step`). */
export const atItsStep = (f: Frame): boolean => STATE.every((k) => f.steps.get(k) === f.frame);
/** The frames drawn before their state reached their step: before the state is rebuilt, after a loss. */
export const behind = (frames: Frame[]): Frame[] => frames.filter((f) => !atItsStep(f));
/** Frames named for a message: the first few, and how many. */
export const named = (frames: Frame[]): string => (frames.length === 0 ? 'none' : `${frames.slice(0, 4).map((f) => `frame ${nth(f.frame)} (${stateText(f)})`).join('; ')}${frames.length > 4 ? `; … ${frames.length} in all` : ''}`);

/** A play draws frames 0 to `last` once each, in order; the frame the device was lost under (`lostAt`) may be missing. */
export function orderProblems(frames: Frame[], last: number, lostAt?: number): string[] {
  const got = frames.map((f) => f.frame);
  const want = Array.from({ length: last + 1 }, (_, i) => i).filter((n) => n !== lostAt || got.includes(n));
  const first = want.findIndex((n, i) => got[i] !== n);
  if (first < 0 && got.length === want.length) return [];
  const where = first < 0 ? `it holds ${got.length - want.length} more after frame ${nth(last)}` : `reply entry ${first} is ${got[first] === undefined ? 'missing' : `frame ${nth(got[first])}`}, not frame ${nth(want[first]!)}`;
  return [`the play drew ${got.length} frames, not 0 to ${nth(last)} once each in order${lostAt === undefined ? '' : ` (frame ${nth(lostAt)} may be missing)`}: ${where}`];
}

/**
 * The settling line: "every frame before the state is rebuilt reports settling", and (Scope) "the frame reports
 * settling until it reaches t". A frame whose state isn't at its own step reports settling; one whose state is,
 * doesn't. Each problem names the frame and what its state holds.
 */
export function settlingProblems(frames: Frame[]): string[] {
  const silent = behind(frames).filter((f) => !f.settling);
  const loud = frames.filter((f) => atItsStep(f) && f.settling);
  return [
    ...(silent.length ? [`before the state is rebuilt, ${silent.length} frame${silent.length === 1 ? '' : 's'} didn't report settling: ${named(silent)}`] : []),
    ...(loud.length ? [`${loud.length} frame${loud.length === 1 ? '' : 's'} reported settling with the state at the frame's own step: ${named(loud)}`] : []),
  ];
}

/**
 * The state a frame read back: each carried texture's hash (the SHA-256 naming its file under `out`: #483's `read`
 * of a texture, little-endian f32 rows top-down, RGBA at the base) and each cell's height, the first lane of its texel.
 */
export interface State { hashes: Map<string, string>; height: number[] | null; problems: string[] }
export function stateAt(out: string, frames: Frame[], n: number, what: string): State {
  const s: State = { hashes: new Map(), height: null, problems: [] };
  const f = frames.filter((x) => x.frame === n).pop();
  if (!f) return { ...s, problems: [`${what} drew no frame ${nth(n)}, so its state at step ${nth(n)} has no hash`] };
  if (!atItsStep(f)) s.problems.push(`${what}'s frame ${nth(n)} doesn't hold the state at step ${nth(n)}: ${stateText(f)}`);
  for (const key of STATE) {
    const file = f.read.get(key);
    const path = join(out, `${file ?? ''}.f32`);
    if (file === undefined || !SHA.test(file) || !existsSync(path)) { s.problems.push(`${what}'s frame ${nth(n)} read no ${key} (a file named by its SHA-256), so its state at step ${nth(n)} has no hash`); continue; }
    const bytes = readFileSync(path);
    if (sha256(bytes) !== file) { s.problems.push(`${what}: the SHA-256 of ${key}'s file isn't its name ${file}`); continue; }
    s.hashes.set(key, file);
    const cells = WATER.size * WATER.size;
    const lanes = bytes.byteLength / 4 / cells;
    if (key !== STATE[0] || !Number.isInteger(lanes) || lanes < 1) continue;
    const words = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    s.height = Array.from({ length: cells }, (_, i) => words[i * lanes]!);
  }
  return s;
}

/**
 * The hash line: the state hash at step `n` of a run that lost its device equals an unbroken run's. A state with no
 * hash is a problem too: nothing unread passes. A difference names the step and the output.
 */
export function hashProblems(unbroken: State, lost: State, n: number): string[] {
  const p = [...unbroken.problems, ...lost.problems];
  for (const key of STATE) {
    const [a, b] = [unbroken.hashes.get(key), lost.hashes.get(key)];
    if (a !== undefined && b !== undefined && a !== b) p.push(`the state hash at step ${nth(n)} differs from the unbroken run's: ${key} is ${b} after the loss, ${a} unbroken`);
  }
  return p;
}
