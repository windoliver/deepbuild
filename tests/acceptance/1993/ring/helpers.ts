// Test-side tools for the "ring" part of the #1993 acceptance tests (criteria 1 and 2): `deep-gpu` (#377's binary,
// with #429's operator check, #378's `view3d` with #380's `timings`, #483's `read` and #252's stepped operators)
// built once per file and driven by JSON lines; the one fixture, a 128 × 128 height grid that takes a drop at its
// centre, written as operator data so every step is readable; the reply readers; the measures the criteria name (the
// ring's radius, the peak's place, the largest height, the check's refusal); and the reference-Mac gate and the
// design's judge for the step's GPU time. Nothing here asserts a criterion: each measure returns its readings, or
// its problems as sentences that name what failed, and the test files assert them.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1993/ring is four levels down). */
const REPO = join(HERE, '..', '..', '..', '..');
const BIN = 'deep-gpu';

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text, trimmed, white space collapsed (README). */
export const AC = { 1: '#1993.c7c8c280', 2: '#1993.1cdd279a' } as const;

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
/** The binary's path and why it didn't build ('' when it did); the test asserts the second. */
export function useBin(): () => { bin: string; unbuilt: string } {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1993-ring-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => ({ bin: join(dir, BIN), unbuilt: error });
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1993-ring-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong program this part adds to the binary, reachable only through `--planted` (README: Planted programs). */
export type Planted = 'check_skips_bound';

/** A scenario's replies, one per call, or why the binary gave none (`failed`, '' when it answered). */
export interface Ran { replies: JsonObject[]; failed: string }
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted, timeoutMs = 900_000): Ran {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const name = `${BIN} ${args.join(' ')}`;
  const none = (failed: string): Ran => ({ replies: [], failed });
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') return none(`${name} didn't finish within ${timeoutMs} ms`);
  if (r.error) return none(`${name} could not start: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  if (r.status !== 0) return none(`${name} exited ${String(r.status)} (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`);
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== 1) return none(`${name} wrote ${lines.length} lines for one scenario`);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { return none(`${name}'s answer isn't JSON: ${lines[0]!.slice(0, 1500)}`); }
  if (!isObject(answer) || answer['ok'] !== true || !Array.isArray(answer['replies'])) return none(`${name} refused the scenario: ${shown(answer)}`);
  const replies = answer['replies'].filter(isObject);
  if (replies.length !== calls.length) return none(`${name} gave ${replies.length} replies to ${calls.length} calls`);
  return { replies, failed: '' };
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
// The fixture: one stepped compute operator, as #429's check takes it (`steps` as `{op: name@major, args}`), with
// #252's stepped fields (`stepped: {rate}`, an input `{time: "step"}`) and this issue's (README: The surface under
// test): `carry` on a `texture` output, an input `{texture: {op, output, step: "previous"}}` and `stepped.bound`.

const step = (op: string, args: JsonObject = {}): JsonObject => ({ op, args });
const cvt = (x: string, to: string): JsonObject => step('convert@1', { x, to });
const pick = (x: string, p: string): JsonObject => step('split@1', { x, pick: p });
const mul = (a: string | number, b: string | number): JsonObject => step('mul@1', { a, b });
const add = (a: string | number, b: string | number): JsonObject => step('add@1', { a, b });
const sub = (a: string | number, b: string | number): JsonObject => step('sub@1', { a, b });
const sel = (f: string | number, t: string | number, cond: string): JsonObject => step('select@1', { f, t, cond });

/** The design's checkpoint ring defaults (Checkpoint ring: `every: steps = 60`, `budget: bytes = 16 MiB`). */
const CARRY: JsonObject = { every: 60, budget: 16 * 1024 * 1024 };
/** A carried `r32float` grid with its checkpoint ring (the issue's Fields: `outputs.<name>.carry` on a `texture` output). */
const grid = (size: number): JsonObject => ({ texture: { format: 'r32float', size: [size, size] }, carry: CARRY });
/** A carried grid as the previous step left it (the issue's Fields: `inputs.<name>.from.texture: {op, output, step: previous}`), zeros before step 0. */
const previousGrid = (op: string, output: string): JsonObject => ({ type: 'texture', from: { texture: { op, output, step: 'previous' } } });
/** The fixed step being computed, 0 for the first (#252's). */
const STEP_INDEX: JsonObject = { type: 'u32', from: { time: 'step' } };
/** The value of `tex` at index `ixy`, as step `n` (one fetch; an r32float texel's value is its first lane). */
const texel = (tex: string, n: string, ixy: string): JsonObject => ({ [`${n}_t`]: step('load@1', { tex, ixy }), [n]: pick(`${n}_t`, 'x') });

/** Criterion 1's grid: 128 × 128 cells of 1 cm, 60 steps a second; at 0.24 m/s a ring grows 0.4 cells a step. */
export const GRID = { size: 128, cell: 0.01, rate: 60 } as const;
export const CELLS = GRID.size * GRID.size;
/** The two wave speeds the criteria name, m/s: the one that runs and the one the check refuses. */
export const SPEED = 0.24;
export const REFUSED_SPEED = 2;
/** The grid's centre in cell indices, where four cells meet: (63.5, 63.5). */
export const CENTRE = (GRID.size - 1) / 2;
/** The drop: a bump of height 1 at the four centre cells, falling off as a Gaussian of σ 1 cell: exp(−(d² − 0.5) ÷ 2), d cells from the centre. */
export const DROP_HEIGHT = 1;
export const dropAt = (x: number, y: number): number => Math.exp(-((x - CENTRE) ** 2 + (y - CENTRE) ** 2 - 0.5) / 2);
/** The stepped operator and its carried height grid, as `read` and a frame's `carried` name it. */
export const WATER = 'water';
export const HEIGHT = 'water.height';

/** The ratio the check computes for a stepped operator's bound: speed × (1 ÷ rate) ÷ cell (the issue's Scope). */
export const ratio = (speed: number): number => speed * (1 / GRID.rate) / GRID.cell;

/**
 * The water: a height grid and its rate of change, two carried `r32float` textures of the one stepped operator
 * `water`, each read as the previous step left it. Each step a cell's rate gains (speed ÷ rate ÷ cell)² × the
 * height's five-point Laplacian and its height gains the new rate (the explicit wave equation; Courant, Friedrichs
 * and Lewy, Math. Ann. 100, 1928); the rim reflects. Step 0 is the drop, at rest. `stepped.bound` declares the wave's
 * speed and the cell, with `max` left at its default 0.5: a ratio of 0.4 at 0.24 m/s, 3.33 at 2 m/s.
 *
 * `onlyDiffuses` is criterion 1's planted step: the same operator, except that the push is added straight to the
 * height and no rate of change is kept, so the drop only spreads where it is (the heat equation) and no ring leaves.
 */
export function waterOp(spec: { speed?: number; onlyDiffuses?: boolean } = {}): JsonObject {
  const { size, cell, rate } = GRID;
  const speed = spec.speed ?? SPEED;
  const courant2 = ratio(speed) ** 2;
  const steps: JsonObject = {
    // Texel e, row-major, and its four neighbours, clamped at the rim.
    e: step('element@1'), gx: step('rem@1', { a: 'e', b: size }), gy: step('div@1', { a: 'e', b: size }),
    xl0: step('max@1', { a: 'gx', b: 1 }), xl: sub('xl0', 1), xr0: add('gx', 1), xr: step('min@1', { a: 'xr0', b: size - 1 }),
    yu0: step('max@1', { a: 'gy', b: 1 }), yu: sub('yu0', 1), yd0: add('gy', 1), yd: step('min@1', { a: 'yd0', b: size - 1 }),
    at: step('compose@1', { x: 'gx', y: 'gy' }), at_l: step('compose@1', { x: 'xl', y: 'gy' }), at_r: step('compose@1', { x: 'xr', y: 'gy' }),
    at_u: step('compose@1', { x: 'gx', y: 'yu' }), at_d: step('compose@1', { x: 'gx', y: 'yd' }),
    ...texel('h', 'hc', 'at'), ...texel('h', 'hl', 'at_l'), ...texel('h', 'hr', 'at_r'), ...texel('h', 'hu', 'at_u'), ...texel('h', 'hd', 'at_d'), ...texel('r', 'rc', 'at'),
    n1: add('hl', 'hr'), n2: add('hu', 'hd'), n3: add('n1', 'n2'), h4: mul('hc', 4), lap: sub('n3', 'h4'), push: mul('lap', courant2),
    // The right step keeps the rate of change and moves the height by it; the planted one moves the height by the push alone.
    ...(spec.onlyDiffuses ? { rn: add('rc', 0), hn: add('hc', 'push') } : { rn: add('rc', 'push'), hn: add('hc', 'rn') }),
    // Step 0: the drop, at rest.
    xf: cvt('gx', 'f32'), yf: cvt('gy', 'f32'), ox: sub('xf', CENTRE), oy: sub('yf', CENTRE), ox2: mul('ox', 'ox'), oy2: mul('oy', 'oy'),
    d2: add('ox2', 'oy2'), dh: sub('d2', 0.5), dg: mul('dh', -0.5), drop: step('exp@1', { x: 'dg' }),
    first: step('eq@1', { a: 'k', b: 0 }), ho: sel('hn', 'drop', 'first'), ro: sel('rn', 0, 'first'),
    wh: step('store@1', { tex: 'height', ixy: 'at', v: 'ho' }), wr: step('store@1', { tex: 'rate', ixy: 'at', v: 'ro' }),
  };
  return {
    id: WATER, kind: 'compute', origin: 'composed',
    about: spec.onlyDiffuses ? 'A height grid that takes one drop at its centre and only spreads it where it is.' : 'A height grid that takes one drop at its centre and carries the ring outward.',
    inputs: { h: previousGrid(WATER, 'height'), r: previousGrid(WATER, 'rate'), k: STEP_INDEX }, steps,
    outputs: { height: grid(size), rate: grid(size) }, elements: CELLS, workgroup: 256,
    stepped: { rate, bound: { speed, cell } }, cost: { ns_per_element: 1 },
  };
}

// ---------------------------------------------------------------------------------------------------
// The check (#429's `check_operator`) and the document. `view3d` takes a whole document (#378's); an operator is an
// item of its writer's layer (#429).

const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
const WRITER = 'agent:alpha';

export const checkCall = (operator: JsonObject): JsonObject => ({ call: 'check_operator', operator });
/** What the check said of one operator: its `outcome`, its issues' messages, what it reached and its estimate. */
export interface Checked { outcome: string; accepted: boolean; messages: string[]; reached: string[]; estimate: number | null; said: string }
export function checked(reply: JsonObject): Checked {
  const outcome = typeof reply['outcome'] === 'string' ? reply['outcome'] : `no outcome (${shown(reply)})`;
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const reached = isObject(reply['reached']) ? Object.entries(reply['reached']).filter(([, v]) => v === true).map(([k]) => k) : [];
  const estimate = typeof reply['estimate_ns'] === 'number' ? reply['estimate_ns'] : null;
  return {
    outcome, accepted: outcome === 'accepted' && issues.length === 0 && estimate !== null, reached, estimate,
    messages: issues.map((i) => (typeof i['message'] === 'string' ? i['message'] : shown(i))),
    said: `${outcome}: ${shown(reply['issues'] ?? reply)}`,
  };
}
/**
 * The refusal line (criterion 2): the check refuses the operator before anything runs, and one of its issues names
 * the operator and the ratio, to two decimal places. Each problem is a sentence naming the operator and the ratio.
 */
export function refusalProblems(reply: JsonObject, operator: string, speed: number): string[] {
  const c = checked(reply);
  const r = ratio(speed).toFixed(2);
  const of = `${operator} at a ratio of ${r} (${speed} m/s × (1 ÷ ${GRID.rate}) s ÷ ${GRID.cell} m)`;
  if (c.outcome !== 'refused') return [`the check didn't refuse ${of}: its outcome is ${c.outcome}`];
  const problems: string[] = [];
  if (!c.messages.some((m) => m.includes(operator) && m.includes(r))) problems.push(`the check refused ${of}, and no issue names both ${operator} and ${r}: ${c.said}`);
  if (c.reached.length > 0) problems.push(`the check refused ${of} only after it reached ${c.reached.join(', ')}, not before anything ran`);
  return problems;
}

/** A showpiece scene of a camera, a box and the operator given (declaring the cost the check estimated for it), 65 s long. */
export function sceneDoc(id: string, operator: JsonObject, estimate: number): JsonObject {
  const params = JSON.parse(JSON.stringify({ ...operator, cost: { ns_per_element: estimate } })) as JsonObject;
  delete params['id'];
  delete params['kind'];
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 7], target: [0, 0, 0], fov: 40 } },
    b0: { kind: 'mark.box@1', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [0, 0, 0] } },
    [String(operator['id'])]: { kind: `gpu.${String(operator['kind'])}@1`, params },
  };
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
// `view3d` (#378's, with #380's `timings`, #483's `read` and #252's `carried`), at one frame a step unless told.

export const view3dCall = (spec: JsonObject): JsonObject => ({ call: 'view3d', look: LOOK, size: [64, 64], fps: GRID.rate, ...spec });

/**
 * A frame as the criteria read it: its number; the step its carried height holds (`carried["water.height"].step`,
 * #252's row, for a carried texture); the height's read (#483's, for a texture: `{format, size, file}`); and with
 * `timings` the step's GPU time (`passes_ms["op.water"]`). Each is null where the frame doesn't report it.
 */
export interface V3Frame { index: number; frame: number; step: number | null; read: { file: string; size: number[] } | null; stepMs: number | null }
export function view3dFrames(reply: JsonObject): V3Frame[] {
  if (reply['code'] === 'unsupported_platform') inconclusive('view3d reports unsupported_platform');
  if (!Array.isArray(reply['frames'])) return [];
  return reply['frames'].filter(isObject).map((f, index) => {
    const carried = isObject(f['carried']) && isObject(f['carried'][HEIGHT]) ? f['carried'][HEIGHT] : null;
    const r = isObject(f['read']) && isObject(f['read'][HEIGHT]) ? f['read'][HEIGHT] : null;
    const ms = isObject(f['passes_ms']) ? f['passes_ms'][`op.${WATER}`] : undefined;
    return {
      index, frame: typeof f['frame'] === 'number' ? f['frame'] : -1,
      step: carried && typeof carried['step'] === 'number' ? carried['step'] : null,
      read: r && typeof r['file'] === 'string' && Array.isArray(r['size']) ? { file: r['file'], size: r['size'].filter((n): n is number => typeof n === 'number') } : null,
      stepMs: typeof ms === 'number' && Number.isFinite(ms) ? ms : null,
    };
  });
}
/** The water's document under `dir`, its operator checked first and declaring the cost the check estimated: its path, or why there is none. */
export function waterDoc(exe: { bin: string; unbuilt: string }, dir: string, name: string, operator: JsonObject): { problem: string; doc: string } {
  if (exe.unbuilt !== '') return { problem: `the binary didn't build: ${exe.unbuilt}`, doc: '' };
  const ran = run(exe.bin, dir, [checkCall(operator)]);
  if (ran.failed !== '') return { problem: ran.failed, doc: '' };
  const c = checked(ran.replies[0]!);
  if (!c.accepted) return { problem: `the check doesn't accept ${name}'s operator ${String(operator['id'])}: ${c.said}`, doc: '' };
  return { problem: '', doc: writeJson(dir, `${name}.json`, sceneDoc(`${name}-1993`, operator, c.estimate!)) };
}
/** The water's document played through one `view3d` call: its frames, or why it drew none. */
export function play(exe: { bin: string; unbuilt: string }, dir: string, name: string, operator: JsonObject, spec: JsonObject): { problem: string; frames: V3Frame[] } {
  const { problem, doc } = waterDoc(exe, dir, name, operator);
  if (problem !== '') return { problem, frames: [] };
  const ran = run(exe.bin, dir, [view3dCall({ doc, ...spec })]);
  if (ran.failed !== '') return { problem: ran.failed, frames: [] };
  const frames = view3dFrames(ran.replies[0]!);
  return { problem: frames.length > 0 ? '' : `view3d drew no frame of ${name}: ${refusal(ran.replies[0]!)}`, frames };
}
/** Why a reply drew nothing, as the binary says it ('' when it holds frames). */
export const refusal = (reply: JsonObject): string => (Array.isArray(reply['frames']) && reply['frames'].length > 0 ? '' : reply['code'] === undefined ? `no frames: ${shown(reply)}` : `${String(reply['code'])}: ${shown(reply['message'] ?? reply['what'] ?? reply)}`);

/**
 * The height grid a frame read: 128 × 128 f32, row-major, each texel's first lane of the read's file (`<sha>.f32`
 * under `out`: f32 RGBA rows). A string says why the frame holds none.
 */
export function heights(out: string, f: V3Frame | undefined, what: string): Float32Array | string {
  if (!f) return `${what}: no such frame was drawn`;
  if (f.step === null) return `${what}: frame ${f.frame} reports no carried ${HEIGHT}`;
  if (!f.read) return `${what}: frame ${f.frame} read no ${HEIGHT}`;
  if (f.read.size.length !== 2 || f.read.size[0] !== GRID.size || f.read.size[1] !== GRID.size) return `${what}: ${HEIGHT} reads as ${f.read.size.join(' × ')}, not ${GRID.size} × ${GRID.size}`;
  const path = join(out, `${f.read.file}.f32`);
  if (!SHA.test(f.read.file) || !existsSync(path)) return `${what}: ${HEIGHT}'s file ${f.read.file}.f32 isn't under the output folder`;
  const b = readFileSync(path);
  if (sha256(b) !== f.read.file) return `${what}: the SHA-256 of ${HEIGHT}'s file isn't its name`;
  if (b.byteLength !== CELLS * 16) return `${what}: ${HEIGHT}'s file holds ${b.byteLength} bytes, not ${CELLS} texels of four f32`;
  const lanes = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const h = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++) h[i] = lanes[4 * i]!;
  return h;
}

// ---------------------------------------------------------------------------------------------------
// The measures the criteria name, each read off a height grid.

/** How far cell i's centre is from the grid's centre, cells. */
const fromCentre = (i: number): number => Math.hypot((i % GRID.size) - CENTRE, Math.floor(i / GRID.size) - CENTRE);

/**
 * The ring's radius, cells: the whole number r whose annulus has the largest mean height, an annulus being the cells
 * whose centres are within half a cell of r cells from the grid's centre. The four centre cells are annulus 1; an
 * annulus the rim cuts (past 63 cells) isn't counted. −1 when a height isn't finite.
 */
export function ringRadius(h: Float32Array): number {
  const whole = Math.floor(CENTRE);
  const sum = new Float64Array(whole + 1);
  const count = new Float64Array(whole + 1);
  for (let i = 0; i < h.length; i++) {
    if (!Number.isFinite(h[i]!)) return -1;
    const r = Math.round(fromCentre(i));
    if (r <= whole) { sum[r]! += h[i]!; count[r]! += 1; }
  }
  let radius = -1;
  let best = -Infinity;
  for (let r = 0; r <= whole; r++) {
    if (count[r]! > 0 && sum[r]! / count[r]! > best) { best = sum[r]! / count[r]!; radius = r; }
  }
  return radius;
}

/** The peak: the largest height, and how far the cell that holds it is from the grid's centre, cells (the nearest, when cells tie). */
export function peak(h: Float32Array): { height: number; distance: number } {
  let height = -Infinity;
  let distance = Infinity;
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!;
    if (v > height || (v === height && fromCentre(i) < distance)) { height = v; distance = fromCentre(i); }
  }
  return { height, distance };
}
/** The four centre cells are √0.5 cells from the centre: a peak nearer than one cell is at the centre. */
export const AT_CENTRE = 1;

/** The largest height on a grid, above or below the still surface: the largest |height|, NaN when one isn't finite. */
export function largest(h: Float32Array): number {
  let m = 0;
  for (const v of h) {
    if (!Number.isFinite(v)) return Number.NaN;
    if (Math.abs(v) > m) m = Math.abs(v);
  }
  return m;
}

/** Step 0 is the drop: each cell within 1e-5 of exp(−(d² − 0.5) ÷ 2), so the four centre cells hold its height, 1. Each problem as a sentence. */
export function dropProblems(h: Float32Array): string[] {
  let worst = 0;
  let at = -1;
  for (let i = 0; i < h.length; i++) {
    const off = Math.abs(h[i]! - dropAt(i % GRID.size, Math.floor(i / GRID.size)));
    if (!(off <= worst)) { worst = off; at = i; }
  }
  return worst <= 1e-5 ? [] : [`at step 0 cell (${at % GRID.size}, ${Math.floor(at / GRID.size)}) holds ${h[at]!}, not the drop's ${dropAt(at % GRID.size, Math.floor(at / GRID.size))}`];
}

/** Criterion 1's ring: [step, radius in cells], 0.24 m/s × (step ÷ 60) s ÷ 0.01 m. */
export const RING: readonly (readonly [number, number])[] = [[50, 20], [100, 40], [150, 60]];
/**
 * The radius line (criterion 1): at steps 50, 100 and 150 the ring's radius is 20, 40 and 60 cells, each within one
 * cell. `grids` holds the height at each step, or why it has none. Each problem names the step and the radius found.
 */
export function radiusProblems(grids: Map<number, Float32Array | string>): string[] {
  return RING.flatMap(([at, cells]) => {
    const h = grids.get(at);
    if (h === undefined || typeof h === 'string') return [`at step ${at} the ring has no radius: ${h ?? 'the height was not read'}`];
    const r = ringRadius(h);
    if (r < 0) return [`at step ${at} the ring has no radius: a height isn't finite`];
    return Math.abs(r - cells) <= 1 ? [] : [`at step ${at} the ring's radius is ${r} cells, not within one cell of ${cells}`];
  });
}

/** The 95th percentile of a run's values. */
export const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.95) - 1)]!;
