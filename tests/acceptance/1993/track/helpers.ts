// Test-side tools for the "track" part of #1993's acceptance tests (criteria 3 and 4): `deep-gpu` (#377's binary,
// with #378's `view3d`, #429's operator check, #483's `read`, #484's `seeks`, #508's `track` and #252's stepped
// operators and `carried` rows) built once per file and driven by JSON lines; the two fixtures, written here as
// operator data so every step is readable: a 512 × 512 pond that takes drops from an input track, and a
// reaction-diffusion pattern in two carried 1,024 × 1,024 r32float textures; and the readers of what a run answered.
//
// Nothing here asserts what a criterion asks: each reader returns what it found and the problems it met as
// sentences, and the test files assert on them, so a missing behaviour fails at an assertion in the test's own file.

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
/** The checkout root (tests/acceptance/1993/track is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
export const BIN = 'deep-gpu';

/**
 * The two criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed,
 * `- [ ] ` dropped (scripts/proof-change.mjs: criterionId), computed from the issue's body. 3 and 4 are their places
 * under "Acceptance criteria".
 */
export const AC = { 3: '#1993.cef70375', 4: '#1993.82266148' } as const;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1200) ?? 'undefined';
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Anything the GPU runs runs on Metal: elsewhere a test reads INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs on macOS's Metal device, the reference platform; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu`, built once per file and copied out of target/debug.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  // Homebrew's rustup, where a Mac has it, reads rust-toolchain.toml's pin; elsewhere cargo is the PATH's.
  const rustup = '/opt/homebrew/opt/rustup/bin';
  if (existsSync(rustup)) env['PATH'] = `${rustup}${delimiter}${env['PATH'] ?? ''}`;
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env });
  if (r.error) return `BLOCKED: cargo could not run (${r.error.message}); install the toolchain rust-toolchain.toml pins. This is not a pass`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** Builds `deep-gpu` before the file's tests; a test whose build failed fails with cargo's error. */
export function useBin(): () => string {
  let dir = '';
  let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1993-track-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    if (error.startsWith('BLOCKED:')) expect.fail(error);
    expect(error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
    return join(dir, BIN);
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1993-track-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong programs this part adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'step_reads_live_pointer' | 'ring_checkpoints_textures_on_alternate_steps';

/** What a run answered: one reply per call, or why it answered none (`refusal`, empty when it answered). */
export interface Session { replies: JsonObject[]; refusal: string }

export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted, timeoutMs = 1_500_000): Session {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${BIN} ${args.join(' ')}`;
  const none = (why: string): Session => ({ replies: [], refusal: `${name} ${why}` });
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  const said = `stdout: ${stdout.slice(0, 600) || '(none)'}; stderr: ${(r.stderr ?? '').slice(-1200) || '(none)'}`;
  if (r.error) return none((r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? `did not finish within ${timeoutMs / 1000} s; ${said}` : `could not run (${r.error.message})`);
  if (r.status !== 0) return none(`exited ${r.status ?? r.signal}, so the scenario did not run; ${said}`);
  const lines = stdout.split('\n').filter((l) => l !== '');
  let answer: JsonValue = null;
  try { answer = JSON.parse(lines[0] ?? '') as JsonValue; } catch { return none(`answered no JSON line; ${said}`); }
  if (!isObject(answer) || answer['ok'] !== true || !Array.isArray(answer['replies'])) return none(`refused the scenario: ${shown(answer)}`);
  const replies = answer['replies'].filter(isObject);
  if (replies.length !== calls.length) return none(`answered ${replies.length} replies to ${calls.length} calls`);
  for (const reply of replies) if (reply['code'] === 'unsupported_platform') inconclusive(`${name} reports unsupported_platform`);
  return { replies, refusal: '' };
}

// ---------------------------------------------------------------------------------------------------
// Operators, as #429's check takes them (`steps` as `{op: name@major, args}`), with #252's `stepped: {rate}`, its
// `{time: "step"}` input and its `carry: {every, budget}`, here on `texture` outputs, and this issue's texture input
// `{texture: {op, output, step: "previous"}}` (README: The surface under test).

export const step = (op: string, args: JsonObject = {}): JsonObject => ({ op, args });
const cvt = (x: string, to: string): JsonObject => step('convert@1', { x, to });
const pick = (x: string, p: string): JsonObject => step('split@1', { x, pick: p });

export const MIB = 1024 * 1024;
/** An r32float texel's bytes. */
const TEXEL = 4;

/** A carried r32float texture output: kept between steps and frames, a checkpoint every `every` steps within `budget` bytes. */
const carriedTexture = (size: number, every: number, budget: number): JsonObject => ({ texture: { format: 'r32float', size: [size, size] }, carry: { every, budget } });
/** A carried texture as the previous step left it (zeros before the first step). */
const previousTexture = (op: string, output: string): JsonObject => ({ type: 'texture', from: { texture: { op, output, step: 'previous' } } });
/** The fixed step being computed, 0 for the first (#252). */
const STEP_INDEX: JsonObject = { type: 'u32', from: { time: 'step' } };
/** An f32 the document's channels give a path, 0 where they give none (#483). */
const channel = (path: string): JsonObject => ({ type: 'f32', default: 0, from: { channel: path } });

/**
 * Element e of a `size` × `size` grid, row-major: its column `gx` and row `gy`, its texel `p`, and its four
 * neighbours' texels `pl`, `pr`, `pu`, `pd`, each clamped into the grid, so a wall cell's missing neighbour is itself.
 */
function gridSteps(size: number): JsonObject {
  return {
    e: step('element@1'), gx: step('rem@1', { a: 'e', b: size }), gy: step('div@1', { a: 'e', b: size }),
    xl0: step('max@1', { a: 'gx', b: 1 }), xl: step('sub@1', { a: 'xl0', b: 1 }), xr0: step('add@1', { a: 'gx', b: 1 }), xr: step('min@1', { a: 'xr0', b: size - 1 }),
    yu0: step('max@1', { a: 'gy', b: 1 }), yu: step('sub@1', { a: 'yu0', b: 1 }), yd0: step('add@1', { a: 'gy', b: 1 }), yd: step('min@1', { a: 'yd0', b: size - 1 }),
    p: step('compose@1', { x: 'gx', y: 'gy' }), pl: step('compose@1', { x: 'xl', y: 'gy' }), pr: step('compose@1', { x: 'xr', y: 'gy' }),
    pu: step('compose@1', { x: 'gx', y: 'yu' }), pd: step('compose@1', { x: 'gx', y: 'yd' }),
  };
}
/** The texel of texture input `tex` at `at`, as step `n` (one fetch): an r32float's one value. */
const texel = (n: string, tex: string, at: string): JsonObject => ({ [`${n}_t`]: step('load@1', { tex, ixy: at }), [n]: pick(`${n}_t`, 'x') });
/** `n`: the sum of field `f`'s four neighbours less four times its own value, from steps `<f>l`, `<f>r`, `<f>u`, `<f>d`, `<f>c`. */
const laplacian = (n: string, f: string): JsonObject => ({
  [`${n}_a`]: step('add@1', { a: `${f}l`, b: `${f}r` }), [`${n}_b`]: step('add@1', { a: `${f}u`, b: `${f}d` }), [`${n}_s`]: step('add@1', { a: `${n}_a`, b: `${n}_b` }),
  [`${n}_c`]: step('mul@1', { a: `${f}c`, b: 4 }), [n]: step('sub@1', { a: `${n}_s`, b: `${n}_c` }),
});

// The pond (criterion 3) ------------------------------------------------------------------------------

/** A 512 × 512 grid. */
export const POND = 512;
/** Its fixed step, and its cells and wave speed, as criterion 1's grid has them: 60 steps a second, 1 cm cells, 0.24 m/s. */
export const POND_RATE = 60;
const CELL_M = 0.01;
const WAVE_M_S = 0.24;
/** (speed × (1 ÷ rate) ÷ cell)²: 0.4² = 0.16, under the bound's 0.5. */
const COURANT2 = (WAVE_M_S / POND_RATE / CELL_M) ** 2;
/** A drop: a bump of height 1 cm at its centre, falling off as a Gaussian of σ = 3 cells. */
const DROP_M = 0.01;
const DROP_SIGMA = 3;
/** The pond's ring: a checkpoint every 60 steps (the design's default, one a second), within 32 MiB a texture, which holds all 21 of a 20 s run. */
export const POND_EVERY = 60;
export const POND_RING = 32 * MIB;
export const POND_HEIGHT = 'pond.height';
export const POND_VELOCITY = 'pond.velocity';
/** The run: 20 s, 1,200 steps, a checkpoint at each whole second. */
export const POND_SECONDS = 20;
export const POND_STEPS = POND_SECONDS * POND_RATE;
export const POND_CHECKPOINTS: number[] = Array.from({ length: POND_SECONDS + 1 }, (_, k) => k * POND_EVERY);

/**
 * The pond: a height grid and its velocity, two carried r32float textures of one stepped operator. Each step a cell's
 * velocity gains 0.16 of its height's Laplacian (its four neighbours, a wall cell's missing one being itself) and its
 * height gains that velocity: the wave equation at 0.24 m/s on 1 cm cells, 60 steps a second, undamped. While the
 * pointer is down (`down` above 0.5) the step adds a drop under it, at cell (`px`, `py`). The three are channels of
 * the document: the pointer item's position, which the document's drivers write from its three controls (pondDoc), so
 * the pointer reaches the step only through the controls' entries on the input track.
 *
 * Both walls reflect and nothing damps, so the summed height changes only by the drops added: after k drops it is k
 * drops' volume (dropVolume), which is how a test counts the drops the pond took.
 */
export function pondOps(): JsonObject[] {
  return [{
    id: 'pond', kind: 'compute', origin: 'composed', about: 'A pond: a height grid whose waves spread from each drop the pointer leaves.',
    inputs: {
      h_prev: previousTexture('pond', 'height'), v_prev: previousTexture('pond', 'velocity'),
      px: channel('items/pointer/at/pos/0'), py: channel('items/pointer/at/pos/1'), down: channel('items/pointer/at/pos/2'),
    },
    steps: {
      ...gridSteps(POND), gxf: cvt('gx', 'f32'), gyf: cvt('gy', 'f32'),
      ...texel('hc', 'h_prev', 'p'), ...texel('hl', 'h_prev', 'pl'), ...texel('hr', 'h_prev', 'pr'), ...texel('hu', 'h_prev', 'pu'), ...texel('hd', 'h_prev', 'pd'),
      ...texel('vc', 'v_prev', 'p'), ...laplacian('lap', 'h'),
      acc: step('mul@1', { a: 'lap', b: COURANT2 }), vn: step('add@1', { a: 'vc', b: 'acc' }), moved: step('add@1', { a: 'hc', b: 'vn' }),
      dx: step('sub@1', { a: 'gxf', b: 'px' }), dy: step('sub@1', { a: 'gyf', b: 'py' }), dx2: step('mul@1', { a: 'dx', b: 'dx' }), dy2: step('mul@1', { a: 'dy', b: 'dy' }),
      d2: step('add@1', { a: 'dx2', b: 'dy2' }), fall: step('mul@1', { a: 'd2', b: -1 / (2 * DROP_SIGMA * DROP_SIGMA) }), bump: step('exp@1', { x: 'fall' }),
      drop: step('mul@1', { a: 'bump', b: DROP_M }), dropped: step('add@1', { a: 'moved', b: 'drop' }),
      pressed: step('gt@1', { a: 'down', b: 0.5 }), hn: step('select@1', { f: 'moved', t: 'dropped', cond: 'pressed' }),
      wh: step('store@1', { tex: 'height', ixy: 'p', v: 'hn' }), wv: step('store@1', { tex: 'velocity', ixy: 'p', v: 'vn' }),
    },
    outputs: { height: carriedTexture(POND, POND_EVERY, POND_RING), velocity: carriedTexture(POND, POND_EVERY, POND_RING) },
    elements: POND * POND, workgroup: 256, stepped: { rate: POND_RATE }, cost: { ns_per_element: 1 },
  }];
}

/** The 20 drops: drop k lands at step 60k + 15 (k + 0.25 s), at a cell at least 96 cells from every wall. */
export const DROPS = 20;
export interface Drop { step: number; x: number; y: number }
export const dropAt = (k: number): Drop => ({ step: POND_RATE * k + 15, x: 96 + 80 * (k % 5), y: 96 + 100 * Math.floor(k / 5) });
/** A drop's volume: the sum of its bump over the grid, in m (cells counted as 1). */
export function dropVolume(d: Drop): number {
  let sum = 0;
  for (let y = 0; y < POND; y++) for (let x = 0; x < POND; x++) sum += DROP_M * Math.exp(-((x - d.x) ** 2 + (y - d.y) ** 2) / (2 * DROP_SIGMA * DROP_SIGMA));
  return sum;
}
/** The drops that have landed once step `s` is computed. */
export const dropsBy = (s: number): number => Array.from({ length: DROPS }, (_, k) => dropAt(k)).filter((d) => d.step <= s).length;

/** Flicks a second (Input track: `t: flick`), and in one of the pond's steps. */
const FLICKS = 705_600_000;
const STEP_FLICKS = FLICKS / POND_RATE;
/**
 * The recorded input track of the 20 drops, as #508's suite writes one for `view3d` (`{t: flick, seq, control, value,
 * writer, player}`): for each drop the pointer moves to its cell and goes down half a step before the drop's step,
 * and comes up half a step after it, so the pointer is down at exactly that step's flick, with half a step to spare
 * either side. 80 entries.
 */
export function dropTrack(): JsonObject[] {
  const entries: JsonObject[] = [];
  const entry = (t: number, control: string, value: number): void => { entries.push({ t, seq: entries.length, control, value, writer: 'you', player: 1 }); };
  for (let k = 0; k < DROPS; k++) {
    const d = dropAt(k);
    const down = (d.step - 0.5) * STEP_FLICKS;
    entry(down, 'pointer_x', d.x); entry(down, 'pointer_y', d.y); entry(down, 'pointer_down', 1);
    entry((d.step + 0.5) * STEP_FLICKS, 'pointer_down', 0);
  }
  return entries;
}

// The pattern (criterion 4) ---------------------------------------------------------------------------

/** Two 1,024 × 1,024 r32float textures, 4 MiB each, so a checkpoint of the pair is 8 MiB. */
export const PATTERN = 1024;
export const PATTERN_TEXTURE_BYTES = PATTERN * PATTERN * TEXEL;
export const PATTERN_CHECKPOINT_BYTES = 2 * PATTERN_TEXTURE_BYTES;
/** 600 steps a second for 10 s. */
export const PATTERN_RATE = 600;
export const PATTERN_STEPS = 10 * PATTERN_RATE;
/** The ring's budget, 160 MiB, which is 20 checkpoints of 8 MiB: each texture's `carry.budget` is its half, 80 MiB. */
export const PATTERN_RING = 160 * MIB;
export const PATTERN_TEXTURE_RING = PATTERN_RING / 2;
export const PATTERN_EVERY = 60;
export const PATTERN_U = 'pattern.u';
export const PATTERN_V = 'pattern.v';

/**
 * The pattern: Barkley's reaction-diffusion model of an excitable medium (D. Barkley, "A model for fast computer
 * simulation of waves in excitable media", Physica D 49, 1991), a = 0.75, b = 0.06, ε = 0.02, stepped explicitly with
 * Δt = 0.01 on cells of 0.25. Each step u gains (Δt ÷ ε) u (1 − u) (u − (v + b) ÷ a) and 0.16 of its own Laplacian,
 * and v gains Δt (u − v); only u diffuses, so a cell reads 6 texels, within a compute operator's 8 fetches. Step 0
 * lays the two fields across each other (u = 1 on the right half, v = a ÷ 2 on the lower half), which breaks the
 * first wave at the centre into a spiral that turns for as long as it is stepped. u and v are the two carried
 * r32float textures of one stepped operator.
 */
export function patternOps(): JsonObject[] {
  const [A, B, EPS, DT, CELL] = [0.75, 0.06, 0.02, 0.01, 0.25];
  return [{
    id: 'pattern', kind: 'compute', origin: 'composed', about: 'A reaction-diffusion pattern: a spiral wave in an excitable medium, in two fields.',
    inputs: { u_prev: previousTexture('pattern', 'u'), v_prev: previousTexture('pattern', 'v'), k: STEP_INDEX },
    steps: {
      ...gridSteps(PATTERN),
      ...texel('uc', 'u_prev', 'p'), ...texel('ul', 'u_prev', 'pl'), ...texel('ur', 'u_prev', 'pr'), ...texel('uu', 'u_prev', 'pu'), ...texel('ud', 'u_prev', 'pd'),
      ...texel('vc', 'v_prev', 'p'), ...laplacian('lap', 'u'),
      lift: step('add@1', { a: 'vc', b: B }), edge: step('div@1', { a: 'lift', b: A }), rest: step('sub@1', { a: 1, b: 'uc' }), grow: step('mul@1', { a: 'uc', b: 'rest' }),
      over: step('sub@1', { a: 'uc', b: 'edge' }), react: step('mul@1', { a: 'grow', b: 'over' }), fast: step('mul@1', { a: 'react', b: DT / EPS }),
      spread: step('mul@1', { a: 'lap', b: DT / (CELL * CELL) }), un0: step('add@1', { a: 'uc', b: 'fast' }), un: step('add@1', { a: 'un0', b: 'spread' }),
      gap: step('sub@1', { a: 'uc', b: 'vc' }), slow: step('mul@1', { a: 'gap', b: DT }), vn: step('add@1', { a: 'vc', b: 'slow' }),
      right: step('ge@1', { a: 'gx', b: PATTERN / 2 }), lower: step('ge@1', { a: 'gy', b: PATTERN / 2 }),
      u0: step('select@1', { f: 0, t: 1, cond: 'right' }), v0: step('select@1', { f: 0, t: A / 2, cond: 'lower' }),
      first: step('eq@1', { a: 'k', b: 0 }), uo: step('select@1', { f: 'un', t: 'u0', cond: 'first' }), vo: step('select@1', { f: 'vn', t: 'v0', cond: 'first' }),
      wu: step('store@1', { tex: 'u', ixy: 'p', v: 'uo' }), wv: step('store@1', { tex: 'v', ixy: 'p', v: 'vo' }),
    },
    outputs: { u: carriedTexture(PATTERN, PATTERN_EVERY, PATTERN_TEXTURE_RING), v: carriedTexture(PATTERN, PATTERN_EVERY, PATTERN_TEXTURE_RING) },
    elements: PATTERN * PATTERN, workgroup: 256, stepped: { rate: PATTERN_RATE }, cost: { ns_per_element: 1 },
  }];
}

// ---------------------------------------------------------------------------------------------------
// Documents. `view3d` takes a whole document (#378's); operators are items of their writer's layer (#429).

const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
const WRITER = 'agent:alpha';

/** A document written under `out`, or why it couldn't be (`refusal`, empty when it was written). */
export interface Doc { path: string; refusal: string }

/**
 * The operators, each declaring the cost the check estimates for it (`estimate_ns`, from #429's check_operator), so
 * the class holds them and no declaration is understated; or the check's refusal of one.
 */
function withEstimates(bin: string, out: string, ops: JsonObject[]): { ops: JsonObject[]; refusal: string } {
  const checked = run(bin, out, ops.map((operator) => ({ call: 'check_operator', operator })));
  if (checked.refusal !== '') return { ops: [], refusal: checked.refusal };
  const priced: JsonObject[] = [];
  for (const [i, op] of ops.entries()) {
    const r = checked.replies[i]!;
    const est = r['estimate_ns'];
    if (r['outcome'] !== 'accepted' || typeof est !== 'number') return { ops: [], refusal: `the check refused operator ${String(op['id'])}: ${shown(r['issues'] ?? r)}` };
    priced.push({ ...op, cost: { ns_per_element: est } });
  }
  return { ops: priced, refusal: '' };
}
/** A showpiece scene 30 s long: a camera, a box (`pointer`) and the operators given, with `extra` top-level fields. */
function sceneDoc(bin: string, out: string, id: string, ops: JsonObject[], extra: JsonObject): Doc {
  const priced = withEstimates(bin, out, ops);
  if (priced.refusal !== '') return { path: '', refusal: priced.refusal };
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 7], target: [0, 0, 0], fov: 40 } },
    pointer: { kind: 'mark.box@1', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0, 0] } },
  };
  for (const op of priced.ops) {
    const params = JSON.parse(JSON.stringify(op)) as JsonObject;
    delete params['id'];
    delete params['kind'];
    items[String(op['id'])] = { kind: `gpu.${String(op['kind'])}@1`, params };
  }
  const withIds: JsonObject = {};
  let n = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(n++).padStart(3, '0')}`, layer: 'main', ...item };
  const doc: JsonObject = {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a fixture of #1993's track acceptance tests.`, size: [64, 64], camera: 'cam',
    transport: { span: '30s' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'showpiece' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items: withIds, ...extra,
  };
  const path = join(out, `${id}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return { path, refusal: '' };
}
/**
 * The pond's document: the operator, and the pointer as three document-class sliders (its cell's column and row,
 * 0 to 511, and whether it is down, 0 or 1), each written by a driver into one component of the `pointer` item's
 * position, where the operator's channel inputs read it.
 */
export function pondDoc(bin: string, out: string): Doc {
  const slider = (label: string, top: number): JsonObject => ({ kind: 'slider', class: 'document', label, role: 'slider', range: [0, top], default: 0, increment: 1 });
  const follows = (control: string, axis: number): JsonObject => ({ target: `items/pointer/at/pos/${axis}`, expr: 'value', vars: { value: `controls/${control}/value` } });
  return sceneDoc(bin, out, 'pond-1993', pondOps(), {
    controls: { pointer_x: slider('Pointer column', POND - 1), pointer_y: slider('Pointer row', POND - 1), pointer_down: slider('Pointer down', 1) },
    drivers: { pointer_x: follows('pointer_x', 0), pointer_y: follows('pointer_y', 1), pointer_down: follows('pointer_down', 2) },
  });
}
export const patternDoc = (bin: string, out: string): Doc => sceneDoc(bin, out, 'pattern-1993', patternOps(), {});

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378's, with #483's `read`, #484's `seeks` and #508's `track`) and #252's reply field `carried`.

export const view3dCall = (spec: JsonObject): JsonObject => ({ call: 'view3d', look: LOOK, size: [64, 64], ...spec });

/** A carried output's row on a frame (#252: `carried`): the step its state holds, its ring, and a seek's restore. */
export interface Carried { step: number | null; ringBytes: number; budget: number; checkpoints: number[]; restored: { from: number; steps: number } | null }
/** One frame drawn: its number, the files `read` wrote for it by `<op>.<output>`, and its carried rows. */
export interface Frame { index: number; frame: number; read: Map<string, string>; carried: Map<string, Carried> }
/** What a `view3d` call drew, or why it drew nothing (`refusal`, empty when it drew). */
export interface View { frames: Frame[]; refusal: string }

const numberOr = (v: JsonValue | undefined, or: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : or);

export function viewOf(reply: JsonObject | undefined, what: string): View {
  if (reply === undefined) return { frames: [], refusal: `${what} was not answered` };
  if (reply['code'] !== undefined || !Array.isArray(reply['frames'])) return { frames: [], refusal: `${what} was refused: ${shown(reply)}` };
  const frames = reply['frames'].filter(isObject).map((f, index): Frame => {
    const read = new Map<string, string>();
    for (const [k, v] of Object.entries(isObject(f['read']) ? f['read'] : {})) if (isObject(v) && typeof v['file'] === 'string') read.set(k, v['file']);
    const carried = new Map<string, Carried>();
    for (const [k, v] of Object.entries(isObject(f['carried']) ? f['carried'] : {})) {
      if (!isObject(v)) continue;
      const ring = isObject(v['ring']) ? v['ring'] : {};
      const restored = isObject(v['restored']) ? v['restored'] : null;
      carried.set(k, {
        step: typeof v['step'] === 'number' ? v['step'] : null, ringBytes: numberOr(ring['bytes'], NaN), budget: numberOr(ring['budget'], NaN),
        checkpoints: (Array.isArray(ring['checkpoints']) ? ring['checkpoints'] : []).map((s) => numberOr(s, NaN)),
        restored: restored ? { from: numberOr(restored['from'], NaN), steps: numberOr(restored['steps'], NaN) } : null,
      });
    }
    return { index, frame: numberOr(f['frame'], NaN), read, carried };
  });
  return { frames, refusal: '' };
}
/** The frames numbered `n`, in the order drawn (a seek draws a number again). */
export const framesNumbered = (v: View, n: number): Frame[] => v.frames.filter((f) => f.frame === n);

/**
 * What is wrong with the carried rows a view's frames report for `keys`: each frame drawn must report every key's row,
 * a whole step and a ring of whole bytes, budget and checkpoint steps. One sentence for the first frame that fails.
 */
export function carriedProblems(v: View, keys: string[], what: string): string[] {
  if (v.frames.length === 0) return [`${what} drew no frame`];
  for (const f of v.frames) for (const key of keys) {
    const c = f.carried.get(key);
    const at = `${what}: frame ${f.frame} (reply entry ${f.index})`;
    if (c === undefined) return [`${at} reports no carried row for ${key}; it reports ${[...f.carried.keys()].join(', ') || 'none'}`];
    if (c.step === null || ![c.step, c.ringBytes, c.budget, ...c.checkpoints].every((n) => Number.isInteger(n) && n >= 0)) return [`${at} reports carried.${key} as ${JSON.stringify(c)}, not {step, ring: {bytes, budget, checkpoints: [step]}} in whole numbers`];
  }
  return [];
}

/** A texture as a frame read it: the SHA-256 that names its file, and each texel's value (an r32float's one channel). */
export interface Grid { hash: string; cells: Float32Array }
/**
 * The square r32float texture `key` of side `size` as frame `f` read it (#483's `read`: `<sha>.f32` under `out`,
 * little-endian f32, rows top-down, one value a texel or four as RGBA), or why it can't be read.
 */
export function gridOf(out: string, f: Frame | undefined, key: string, size: number, what: string): { grid: Grid | null; problem: string } {
  const no = (problem: string): { grid: null; problem: string } => ({ grid: null, problem: `${what}: ${problem}` });
  if (f === undefined) return no('the frame was not drawn');
  const file = f.read.get(key);
  if (file === undefined) return no(`frame ${f.frame} (reply entry ${f.index}) read no ${key}; it read ${[...f.read.keys()].join(', ') || 'nothing'}`);
  if (!SHA.test(file)) return no(`${key}'s file ${file} is not named by a SHA-256`);
  const path = join(out, `${file}.f32`);
  if (!existsSync(path)) return no(`${key}'s file ${file}.f32 is not under the run's out folder`);
  const b = readFileSync(path);
  if (sha256(b) !== file) return no(`${key}'s file ${file}.f32 does not hash to its name`);
  const channels = b.byteLength / (TEXEL * size * size);
  if (channels !== 1 && channels !== 4) return no(`${key}'s file holds ${b.byteLength} bytes, not ${size} × ${size} texels of one f32 or of four`);
  const all = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const cells = channels === 1 ? all : Float32Array.from({ length: size * size }, (_, i) => all[4 * i]!);
  return { grid: { hash: file, cells }, problem: '' };
}
/** A state of two textures as one frame read them: its hash (the two files' names, which are their SHA-256s) and the two grids. */
export interface State { hash: string; first: Grid; second: Grid }
export function stateOf(out: string, f: Frame | undefined, keys: [string, string], size: number, what: string): { state: State | null; problem: string } {
  const a = gridOf(out, f, keys[0], size, what);
  if (a.grid === null) return { state: null, problem: a.problem };
  const b = gridOf(out, f, keys[1], size, what);
  if (b.grid === null) return { state: null, problem: b.problem };
  return { state: { hash: `${keys[0]} ${a.grid.hash} ${keys[1]} ${b.grid.hash}`, first: a.grid, second: b.grid }, problem: '' };
}
/** A grid's sum, in f64. */
export const total = (g: Grid): number => g.cells.reduce((sum, v) => sum + v, 0);
