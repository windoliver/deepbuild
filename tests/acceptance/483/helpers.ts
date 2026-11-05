// Test-side tools for the #483 acceptance tests: `deep-gpu` (#377's binary, with #380's and #429's
// `check_operator`, #378's `view3d` and #379's `live`) built once per file and driven by JSON lines; the
// fixtures, operator graphs and documents these tests use, generated here so every step is readable; the CPU
// references every criterion compares with (an exact Euclidean distance transform in f64, the jump flood the
// graph spells out, a stable sort, a wrapping exclusive prefix sum, compaction, a median of nine, a 2 × 2 box
// mip chain in f64 and trilinear lookups), computed here and never by the binary under test; the reference-Mac
// gate and the design's judge for timings. Each check a planted twin must fail returns its failures as
// sentences that name what failed.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/483 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';

/** Each criterion's ID: the first 8 hex digits of SHA-256 of its text (README). */
export const AC = {
  1: '#483.d1623c31', 2: '#483.c4423040', 3: '#483.2a6f04d8', 4: '#483.c7526ca0', 5: '#483.67c08cd2',
  6: '#483.c832ba9c', 7: '#483.aae924bf', 8: '#483.dadc80dd', 9: '#483.a5f56c33', 10: '#483.06a48810',
} as const;

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
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test whose input is missing fails with this, never passes (invariant 2). */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
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
// Builds: `deep-gpu` per feature set, built once per file and copied out of target/debug.

/** `default` is the shipped build; `test-meter` (#379) adds the test hooks, here `pool_marker` (README). */
export type Build = 'default' | 'test-meter';
function cargoBuild(build: Build): string {
  const args = ['build', '--locked', '--bin', BIN, ...(build === 'default' ? [] : ['--features', build])];
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status !== 0) return `cargo ${args.join(' ')} failed:\n${r.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
export interface Bins { bin: (build?: Build) => string }
export function useBins(builds: readonly Build[] = ['default']): Bins {
  let dir = '';
  const made = new Map<Build, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-483-bins-'));
    for (const b of builds) {
      const error = cargoBuild(b);
      const bin = join(dir, `${BIN}-${b}`);
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', BIN), bin);
      made.set(b, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build = builds[0] ?? 'default'): string {
      const m = made.get(b);
      if (!m) throw Error(`the file didn't list the build ${b}`);
      expect(m.error, `the binary builds: cargo build --locked --bin ${BIN}${b === 'default' ? '' : ` --features ${b}`}`).toBe('');
      return m.bin;
    },
  };
}
/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-483-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted =
  | 'iterate_feeds_first' | 'sort_ties_decreasing' | 'compact_by_atomic' | 'index_wraps'
  | 'mips_level0_only' | 'mips_kept_under_old_key' | 'pool_without_clear';

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 3_000_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const r = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}
/** One scenario, accepted, with one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted, timeoutMs?: number): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ out, calls }], timeoutMs);
  const name = `${BIN} ${args.join(' ')}`;
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = objs(answer['replies'], 'run: replies');
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
export const run1 = (bin: string, out: string, call: JsonObject, planted?: Planted, timeoutMs?: number): JsonObject =>
  run(bin, out, [call], planted, timeoutMs)[0]!;
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
export const chipName = (): string => sh('sysctl', '-n', 'machdep.cpu.brand_string');
/** The Metal GPU family of this chip, as #380's `exact` record names it. */
export function familyOf(chip: string): string {
  const m = /\bM(\d+)\b/.exec(chip);
  const n = m ? Number(m[1]) : 0;
  return n === 1 ? 'apple7' : n === 2 ? 'apple8' : n === 3 || n === 4 ? 'apple9' : `apple${n + 5}`;
}
/** The one-minute load per CPU core: above 1 the machine is loaded, and a timing that misses reads INCONCLUSIVE. */
export const loadPerCore = (): number => loadavg()[0]! / cpus().length;

const marginOf = (runs: number[], limit: number): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
/**
 * The design's judge for a timing limit (Every task carries its own budgets): five runs after warm-up on a reference
 * Mac; PASS when all five are within the limit, FAIL when all five are over it by more than the margin (the larger of
 * 5% and their spread) on a machine that isn't loaded, otherwise INCONCLUSIVE, which fails here with that word.
 */
export function judge(name: string, runs: number[], limit: number): void {
  requireReferenceMac();
  expect(runs.length, `${name}: five runs`).toBe(5);
  const margin = marginOf(runs, limit);
  const line = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%, load ${loadPerCore().toFixed(2)} a core)`;
  console.log(line);
  if (runs.every((r) => r <= limit)) return;
  if (loadPerCore() > 1) inconclusive(`under load: ${line}`);
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${line}`).toBe(false);
  inconclusive(line);
}
export function p95(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// ---------------------------------------------------------------------------------------------------
// Data in and out (README: check_operator's data and read). Storage is little-endian 32-bit words; a texture
// is little-endian f32 RGBA, rows top-down (a 3D texture's slices in z order); files the binary writes under
// `out` are named by their SHA-256 with the extension of their kind.

export function writeU32(dir: string, name: string, words: Uint32Array): string {
  const p = join(dir, `${name}.u32`);
  writeFileSync(p, Buffer.from(words.buffer, words.byteOffset, words.byteLength));
  return p;
}
export function writeRgba(dir: string, name: string, rgba: Float32Array): string {
  const p = join(dir, `${name}.f32`);
  writeFileSync(p, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
  return p;
}
/** A gray image as RGBA f32 (alpha 1). */
export function grayRgba(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length * 4);
  for (let i = 0; i < v.length; i++) { out[i * 4] = v[i]!; out[i * 4 + 1] = v[i]!; out[i * 4 + 2] = v[i]!; out[i * 4 + 3] = 1; }
  return out;
}
function named(out: string, hash: string, ext: string, what: string): Buffer {
  expect(hash, `${what}: a file named by its SHA-256`).toMatch(SHA);
  const b = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(b), `${what}: the file's SHA-256 is its name`).toBe(hash);
  return b;
}
export function u32File(out: string, hash: string, what: string): Uint32Array {
  const b = named(out, hash, 'u32', what);
  return new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
export function f32File(out: string, hash: string, what: string): Float32Array {
  const b = named(out, hash, 'f32', what);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

/** One output read back (README): storage `{type, count, file}`, a texture or a pass's color `{format, size, file, png?, levels?}`. */
export interface Read { file: string; count: number | null; size: number[]; png: string | null; levels: { size: number[]; file: string }[]; raw: JsonObject }
export function readOf(v: JsonValue | undefined, what: string): Read {
  const r = obj(v, what);
  return {
    file: str(r['file'], `${what}.file`), count: typeof r['count'] === 'number' ? r['count'] : null,
    size: Array.isArray(r['size']) ? (r['size'] as number[]) : [], png: typeof r['png'] === 'string' ? r['png'] : null,
    levels: objs(r['levels'] ?? [], `${what}.levels`).map((l, i) => ({ size: (l['size'] as number[] | undefined) ?? [], file: str(l['file'], `${what}.levels[${i}].file`) })),
    raw: r,
  };
}

// ---------------------------------------------------------------------------------------------------
// `check_operator` (#380's, #429's reply), with this suite's fields (README): `operators` (one frame of them),
// `data`, `size`, `repeat`, `read`, `pool_marker`; the reply's `dispatches` and `timing.gpu_ns`.

export interface FrameSpec { operators: JsonObject[]; data?: Record<string, string>; size?: [number, number]; repeat?: number; read?: string[]; pool_marker?: number[] }
export function frameCall(s: FrameSpec): JsonObject {
  const call: JsonObject = { call: 'check_operator' };
  if (s.operators.length === 1) call['operator'] = s.operators[0]!; else call['operators'] = s.operators;
  if (s.data) call['data'] = s.data;
  if (s.size) call['size'] = s.size;
  if (s.repeat !== undefined) call['repeat'] = s.repeat;
  if (s.read) call['read'] = s.read;
  if (s.pool_marker) call['pool_marker'] = s.pool_marker;
  return call;
}
export const checkCall = (operator: JsonObject): JsonObject => ({ call: 'check_operator', operator });

export interface Checked { outcome: string; issues: JsonObject[]; estimate: number | null; raw: JsonObject }
export function checked(reply: JsonObject, what: string): Checked {
  answered(reply, what);
  const est = reply['estimate_ns'];
  return { outcome: str(reply['outcome'], `${what}: outcome`), issues: objs(reply['issues'] ?? [], `${what}: issues`), estimate: typeof est === 'number' ? est : null, raw: reply };
}
export const errors = (c: Checked, code?: string): JsonObject[] => c.issues.filter((i) => i['severity'] === 'error' && (code === undefined || i['code'] === code));

export interface Ran { checked: Checked; dispatches: Map<string, Read>[]; gpuNs: Map<string, number[]> }
/** A frame that checked and ran: each dispatch's reads by `<op>.<output>`, and each operator's GPU time per dispatch. */
export function ran(reply: JsonObject, what: string): Ran {
  const c = checked(reply, what);
  expect(c.outcome, `${what} passes the check and runs: ${shown(c.issues)}`).toBe('accepted');
  const dispatches = objs(reply['dispatches'], `${what}: dispatches`).map((d, i) => {
    const reads = obj(d['read'], `${what}: dispatches[${i}].read`);
    return new Map(Object.entries(reads).map(([k, v]) => [k, readOf(v, `${what}: dispatches[${i}].read.${k}`)]));
  });
  const timing = isObject(reply['timing']) ? reply['timing'] : {};
  const g = isObject(timing['gpu_ns']) ? timing['gpu_ns'] : {};
  const gpuNs = new Map(Object.entries(g).map(([k, v]) => [k, (Array.isArray(v) ? v : []).map((x) => Number(x))]));
  return { checked: c, dispatches, gpuNs };
}
export function readAt(r: Ran, dispatch: number, key: string, what: string): Read {
  const d = r.dispatches[dispatch];
  expect(d, `${what}: dispatch ${dispatch} is in the reply (${r.dispatches.length} dispatches)`).toBeDefined();
  const x = d!.get(key);
  expect(x, `${what}: dispatch ${dispatch} read ${key}; it read ${[...d!.keys()].join(', ')}`).toBeDefined();
  return x!;
}

// ---------------------------------------------------------------------------------------------------
// Operators. `steps` as `{op: name@major, args}` (#380); in a document the same fields sit in the `params` of an
// item whose kind is `gpu.pass@1` or `gpu.compute@1` (#429).

export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);
export const LOOK: JsonObject = JSON.parse(readFileSync(fixturePath('look.json'), 'utf8')) as JsonObject;

/** The frame's color as a pass operator's input; check_operator's `data.color` gives it (README). */
export const FRAME_COLOR: JsonObject = { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } };
/** Storage the core gives an operator: check_operator's `data[name]`. */
export const coreStorage = (type: string, count: number, name: string): JsonObject => ({ type, count, from: { storage: { op: 'core', output: name } } });

export const step = (op: string, args: JsonObject = {}): JsonObject => ({ op, args });
/** A composed pass over the frame's color, replacing it, in the effects chain at full resolution. */
export function pass(id: string, steps: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    id, kind: 'pass', origin: 'composed', about: `The #483 fixture ${id}.`, inputs: { src: FRAME_COLOR }, steps,
    outputs: { color: 'out', blend: 'replace' }, chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 100_000 }, fallback: 'look', ...extra,
  };
}
/** A composed compute operator over `elements` elements. */
export function compute(id: string, steps: JsonObject, outputs: JsonObject, extra: JsonObject = {}, elements = 64): JsonObject {
  return {
    id, kind: 'compute', origin: 'composed', about: `The #483 fixture ${id}.`, inputs: {}, steps, outputs, elements, workgroup: 256,
    cost: { ns_per_element: 100_000 }, ...extra,
  };
}
/**
 * Operators for a document, each declaring the cost the check estimates for it (`estimate_ns`, from #429's
 * check_operator), so a document's budget class holds them and no declaration is understated.
 */
export function withEstimates(bin: string, out: string, ops: JsonObject[]): JsonObject[] {
  const replies = run(bin, out, ops.map(checkCall));
  return ops.map((op, i) => {
    const id = String(op['id']);
    const c = checked(replies[i]!, `the check of ${id}`);
    expect(c.outcome, `${id} checks on its own: ${shown(c.issues)}`).toBe('accepted');
    expect(c.estimate, `${id}: the check's estimate_ns`).not.toBeNull();
    return { ...op, cost: op['kind'] === 'compute' ? { ns_per_element: c.estimate! } : { ns_per_px: c.estimate! } };
  });
}
/** An operator as an item of its writer's layer: its kind `gpu.<kind>@1`, its fields in `params`. */
export function asItem(op: JsonObject, order = 'z0'): JsonObject {
  const params = clone(op);
  delete params['id'];
  delete params['kind'];
  return { id: op['id'] as string, kind: `gpu.${op['kind'] as string}@1`, name: `Operator ${op['id'] as string}`, order, params };
}

/**
 * The jump flood (Step and the closed step list: structural steps, `iterate`): a pass whose `flood` step iterates
 * `count` runs over two rgba16float ping-pong targets at full resolution. Run k (the iterate's index) looks at the
 * 9 pixels at offsets {−s, 0, s}² with s = start >> k, clamped into the frame, and keeps the nearest seed: a mask
 * pixel there (the frame's color, red over 0.5), or the seed `prev` holds there (z over 0.5). Each run writes its
 * best seed as (x, y, found, 1); run 0's `prev` reads the ping-pong target's clear value, 0, so nothing is found
 * there. Ties keep the first offset in order (strict less-than), as `jfaCpu` does. The pass's color is (d, 0, 0, 1),
 * d the distance from the pixel to its seed, or 4,096 where none was found; with `outline`, a white band where
 * 0 < d < 4 px fading out by 5 px, the mask at 0.35, black elsewhere.
 */
export function jumpFlood(id: string, o: { count: number; start: number; max: number; outline?: boolean; extra?: JsonObject }): JsonObject {
  const scan: JsonObject = {
    r_ox: step('rem@1', { a: 'j', b: 3 }), r_oxi: { op: 'convert@1', args: { x: 'r_ox', to: 'i32' } }, r_oxs: step('sub@1', { a: 'r_oxi', b: 1 }),
    r_oy: step('div@1', { a: 'j', b: 3 }), r_oyi: { op: 'convert@1', args: { x: 'r_oy', to: 'i32' } }, r_oys: step('sub@1', { a: 'r_oyi', b: 1 }),
    r_dx: step('mul@1', { a: 'r_oxs', b: 'b_si' }), r_dy: step('mul@1', { a: 'r_oys', b: 'b_si' }),
    r_off: step('compose@1', { x: 'r_dx', y: 'r_dy' }), r_q0: step('add@1', { a: 'b_pi', b: 'r_off' }),
    r_q: step('clamp@1', { x: 'r_q0', lo: 0, hi: o.max }),
    r_m: step('load@1', { tex: 'src', ixy: 'r_q' }), r_mr: { op: 'split@1', args: { x: 'r_m', pick: 'x' } }, r_ism: step('gt@1', { a: 'r_mr', b: 0.5 }),
    r_pv: step('load@1', { tex: 'prev', ixy: 'r_q' }), r_pz: { op: 'split@1', args: { x: 'r_pv', pick: 'z' } }, r_has: step('gt@1', { a: 'r_pz', b: 0.5 }),
    r_pxy: { op: 'split@1', args: { x: 'r_pv', pick: 'xy' } }, r_qf: { op: 'convert@1', args: { x: 'r_q', to: 'vec2<f32>' } },
    r_c: step('select@1', { f: 'r_pxy', t: 'r_qf', cond: 'r_ism' }), r_any: step('or@1', { a: 'r_ism', b: 'r_has' }),
    r_dv: step('sub@1', { a: 'r_c', b: 'b_pf' }), r_d2r: step('dot@1', { a: 'r_dv', b: 'r_dv' }), r_d2: step('select@1', { f: 1e30, t: 'r_d2r', cond: 'r_any' }),
    r_bd: { op: 'split@1', args: { x: 'best', pick: 'z' } }, r_better: step('lt@1', { a: 'r_d2', b: 'r_bd' }),
    r_cx: { op: 'split@1', args: { x: 'r_c', pick: 'x' } }, r_cy: { op: 'split@1', args: { x: 'r_c', pick: 'y' } },
    r_cand: step('compose@1', { x: 'r_cx', y: 'r_cy', z: 'r_d2' }),
    best: step('select@1', { f: 'best', t: 'r_cand', cond: 'r_better' }),
  };
  const body: JsonObject = {
    b_px: step('pixel@1'), b_pi: { op: 'convert@1', args: { x: 'b_px', to: 'vec2<i32>' } }, b_pf: { op: 'convert@1', args: { x: 'b_px', to: 'vec2<f32>' } },
    b_s: step('shr@1', { a: o.start, b: 'k' }), b_si: { op: 'convert@1', args: { x: 'b_s', to: 'i32' } },
    b_scan: { op: 'repeat@1', args: { count: 9, index: 'j', accumulate: { best: { type: 'vec3', init: [0, 0, 1e30] } }, body: scan } },
    b_bxy: { op: 'split@1', args: { x: 'b_scan.best', pick: 'xy' } }, b_bx: { op: 'split@1', args: { x: 'b_bxy', pick: 'x' } }, b_by: { op: 'split@1', args: { x: 'b_bxy', pick: 'y' } },
    b_bz: { op: 'split@1', args: { x: 'b_scan.best', pick: 'z' } }, b_found: step('lt@1', { a: 'b_bz', b: 1e29 }), b_h: step('select@1', { f: 0, t: 1, cond: 'b_found' }),
    b_res: step('compose@1', { x: 'b_bx', y: 'b_by', z: 'b_h', w: 1 }),
  };
  const steps: JsonObject = {
    px: step('pixel@1'), pf: { op: 'convert@1', args: { x: 'px', to: 'vec2<f32>' } },
    flood: { op: 'iterate@1', args: { count: o.count, index: 'k', ping_pong: { format: 'rgba16float', resolution: 'full' }, body: { steps: body, outputs: { color: 'b_res' } } } },
    v: step('load@1', { tex: 'flood', ixy: 'px' }), sxy: { op: 'split@1', args: { x: 'v', pick: 'xy' } }, sz: { op: 'split@1', args: { x: 'v', pick: 'z' } },
    found: step('gt@1', { a: 'sz', b: 0.5 }), dr: step('distance@1', { a: 'pf', b: 'sxy' }), d: step('select@1', { f: 4096, t: 'dr', cond: 'found' }),
  };
  if (o.outline) {
    Object.assign(steps, {
      m: step('load@1', { tex: 'src', ixy: 'px' }), mr: { op: 'split@1', args: { x: 'm', pick: 'x' } }, ism: step('gt@1', { a: 'mr', b: 0.5 }),
      fade: step('smoothstep@1', { lo: 4, hi: 5, x: 'd' }), band: step('sub@1', { a: 1, b: 'fade' }), g: step('select@1', { f: 'band', t: 0.35, cond: 'ism' }),
      out: step('compose@1', { x: 'g', y: 'g', z: 'g', w: 1 }),
    });
  } else {
    steps['out'] = step('compose@1', { x: 'd', y: 0, z: 0, w: 1 });
  }
  return pass(id, steps, o.extra ?? {});
}

/** Devillard's opt_med9: 19 compare-exchanges leave the median of nine at index 4. */
export const MEDIAN_NETWORK: [number, number][] = [[1, 2], [4, 5], [7, 8], [0, 1], [3, 4], [6, 7], [1, 2], [4, 5], [7, 8], [0, 3], [5, 8], [4, 7], [3, 6], [1, 4], [2, 5], [4, 7], [4, 2], [6, 4], [4, 2]];
/**
 * The median-of-nine pass (structural steps: `array<f32, 9>`, `index`, `with`): the red of the 3 × 3 pixels about
 * each pixel, clamped into the frame, put into an array<f32, 9> by `with`, sorted by MEDIAN_NETWORK, each
 * compare-exchange two `index` reads, a min, a max and two `with` copies; its color (m, m, m, 1).
 */
export function medianPass(id: string, max: number): JsonObject {
  const s: JsonObject = { px: step('pixel@1'), pi: { op: 'convert@1', args: { x: 'px', to: 'vec2<i32>' } }, a0: { op: 'const@1', args: { value: [0, 0, 0, 0, 0, 0, 0, 0, 0], type: 'array<f32, 9>' } } };
  let a = 'a0';
  for (let n = 0; n < 9; n++) {
    const off = [(n % 3) - 1, Math.floor(n / 3) - 1];
    s[`o${n}`] = { op: 'const@1', args: { value: off, type: 'vec2<i32>' } };
    s[`q${n}`] = step('add@1', { a: 'pi', b: `o${n}` });
    s[`c${n}`] = step('clamp@1', { x: `q${n}`, lo: 0, hi: max });
    s[`l${n}`] = step('load@1', { tex: 'src', ixy: `c${n}` });
    s[`v${n}`] = { op: 'split@1', args: { x: `l${n}`, pick: 'x' } };
    s[`w${n}`] = step('with@1', { a, i: n, v: `v${n}` });
    a = `w${n}`;
  }
  MEDIAN_NETWORK.forEach(([i, j], t) => {
    s[`x${t}`] = step('index@1', { a, i }); s[`y${t}`] = step('index@1', { a, i: j });
    s[`lo${t}`] = step('min@1', { a: `x${t}`, b: `y${t}` }); s[`hi${t}`] = step('max@1', { a: `x${t}`, b: `y${t}` });
    s[`s${t}a`] = step('with@1', { a, i, v: `lo${t}` }); s[`s${t}`] = step('with@1', { a: `s${t}a`, i: j, v: `hi${t}` });
    a = `s${t}`;
  });
  s['m'] = step('index@1', { a, i: 4 });
  s['out'] = step('compose@1', { x: 'm', y: 'm', z: 'm', w: 1 });
  return pass(id, s);
}

// ---------------------------------------------------------------------------------------------------
// Fixtures and CPU references.

/** mulberry32: a fixed-seed generator of u32 words. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
export const unit = (r: () => number): number => r() / 4294967296;

/** The 512 × 512 mask: a disc, a ring, a rectangle's outline, a thick diagonal stroke and 24 seeded single pixels (1 = mask). */
export function maskFixture(): Uint8Array {
  const n = 512;
  const m = new Uint8Array(n * n);
  const r = rng(4831);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const disc = (x - 140) ** 2 + (y - 150) ** 2 <= 55 ** 2;
      const rr = Math.hypot(x - 370, y - 130);
      const ring = rr >= 38 && rr <= 46;
      const rect = x >= 300 && x <= 460 && y >= 300 && y <= 420 && (x <= 303 || x >= 457 || y <= 303 || y >= 417);
      const stroke = Math.abs((y - 280) - 0.6 * (x - 40)) <= 3 && x >= 40 && x <= 250;
      if (disc || ring || rect || stroke) m[y * n + x] = 1;
    }
  }
  for (let k = 0; k < 24; k++) m[(r() % n) * n + (r() % n)] = 1;
  return m;
}
/** A mask as the frame's color: (1, 1, 1, 1) on the mask, (0, 0, 0, 1) off it. */
export const maskRgba = (m: Uint8Array): Float32Array => grayRgba(Array.from(m));
/** The 512 × 512 noisy gray image the median runs on: a soft ramp and a disc, with 8% of its pixels salt or pepper (f32 values). */
export function noisyFixture(): Float32Array {
  const n = 512;
  const v = new Float32Array(n * n);
  const r = rng(4835);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const base = 0.2 + 0.5 * (x / (n - 1)) * (0.5 + 0.5 * (y / (n - 1))) + ((x - 300) ** 2 + (y - 220) ** 2 <= 90 ** 2 ? 0.25 : 0);
    const k = unit(r);
    v[y * n + x] = Math.fround(k < 0.04 ? 0 : k < 0.08 ? 1 : base);
  }
  return v;
}

/** The exact Euclidean distance from each pixel to the nearest mask pixel, in f64 (Felzenszwalb and Huttenlocher's lower envelope, squared, then a root). */
export function edt(mask: Uint8Array, w: number, h: number): Float64Array {
  // One dimension: the lower envelope of the parabolas rooted at the sites with a finite value (squared distances).
  const pass1 = (f: Float64Array, n: number): Float64Array => {
    const d = new Float64Array(n).fill(Infinity);
    const v = new Int32Array(n); const z = new Float64Array(n + 1);
    let k = -1;
    for (let q = 0; q < n; q++) {
      if (!Number.isFinite(f[q]!)) continue;
      if (k < 0) { k = 0; v[0] = q; z[0] = -Infinity; z[1] = Infinity; continue; }
      const cut = (p: number): number => (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
      let s = cut(v[k]!);
      while (s <= z[k]!) { k--; s = cut(v[k]!); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    if (k < 0) return d;
    let j = 0;
    for (let q = 0; q < n; q++) { while (z[j + 1]! < q) j++; const p = v[j]!; d[q] = (q - p) ** 2 + f[p]!; }
    return d;
  };
  const g = new Float64Array(w * h);
  const col = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = mask[y * w + x] ? 0 : Infinity;
    const d = pass1(col, h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]!;
  }
  const out = new Float64Array(w * h);
  const row = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = g[y * w + x]!;
    const d = pass1(row, w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]!);
  }
  return out;
}
/** SciPy's distance_transform_bf, Euclidean: brute force over every mask pixel. */
export function bruteEdt(mask: Uint8Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h).fill(Infinity);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    if (mask[v * w + u]) out[y * w + x] = Math.min(out[y * w + x]!, Math.hypot(x - u, y - v));
  }
  return out;
}
/** The jump flood `jumpFlood` spells out, after `runs` runs, on the CPU: each pixel's distance to its seed, or 4,096 where none. */
export function jfaCpu(mask: Uint8Array, w: number, h: number, runs: number, start: number): Float64Array {
  let sx = new Float64Array(w * h); let sy = new Float64Array(w * h); let has = new Uint8Array(w * h);
  const clampI = (v: number, hi: number): number => Math.min(hi, Math.max(0, v));
  for (let k = 0; k < runs; k++) {
    const s = start >> k;
    const nx = new Float64Array(w * h); const ny = new Float64Array(w * h); const nh = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let bx = 0; let by = 0; let bd = 1e30;
      for (let j = 0; j < 9; j++) {
        const qx = clampI(x + ((j % 3) - 1) * s, w - 1); const qy = clampI(y + (Math.floor(j / 3) - 1) * s, h - 1);
        const q = qy * w + qx;
        let cx = 0; let cy = 0; let ok = false;
        if (mask[q]) { cx = qx; cy = qy; ok = true; } else if (has[q]) { cx = sx[q]!; cy = sy[q]!; ok = true; }
        const d2 = ok ? (cx - x) ** 2 + (cy - y) ** 2 : 1e30;
        if (d2 < bd) { bx = cx; by = cy; bd = d2; }
      }
      const p = y * w + x;
      nx[p] = bx; ny[p] = by; nh[p] = bd < 1e29 ? 1 : 0;
    }
    sx = nx; sy = ny; has = nh;
  }
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = y * w + x; out[p] = has[p] ? Math.hypot(sx[p]! - x, sy[p]! - y) : 4096; }
  return out;
}
/** The red channel of an RGBA f32 image. */
export function reds(rgba: Float32Array): Float64Array {
  const out = new Float64Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4]!;
  return out;
}
/**
 * GPU values against a reference: the share of pixels within `tol`, and the first pixel outside it, by (x, y).
 */
export function within(got: ArrayLike<number>, want: ArrayLike<number>, w: number, tol: number): { share: number; first: string | null; off: number } {
  let off = 0; let first: string | null = null;
  for (let i = 0; i < want.length; i++) {
    const ok = Math.abs(got[i]! - want[i]!) <= tol;
    if (!ok) { off++; if (first === null) first = `pixel (${i % w}, ${Math.floor(i / w)}) reads ${got[i]!.toFixed(3)}, the reference ${want[i]!.toFixed(3)}`; }
  }
  return { share: 1 - off / want.length, first, off };
}

/** The values a CPU stable sort of (key, index) pairs gives: the indices in key order, equal keys in increasing index. */
export function stableOrder(keys: Uint32Array): Uint32Array {
  const packed = new Float64Array(keys.length);
  for (let i = 0; i < keys.length; i++) packed[i] = keys[i]! * 1048576 + i; // keys < 2^32, indices < 2^20: exact in f64
  packed.sort();
  const out = new Uint32Array(keys.length);
  for (let i = 0; i < keys.length; i++) out[i] = packed[i]! % 1048576;
  return out;
}
/** The exclusive prefix sum of u32 words, wrapping at 2^32. */
export function exclusiveScan(xs: Uint32Array): Uint32Array {
  const out = new Uint32Array(xs.length);
  let acc = 0;
  for (let i = 0; i < xs.length; i++) { out[i] = acc; acc = (acc + xs[i]!) >>> 0; }
  return out;
}
/** The first index where two word arrays differ, or −1. */
export function firstDiff(a: Uint32Array, b: Uint32Array, n = Math.max(a.length, b.length)): number {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}
/** The median of the 3 × 3 reds about each pixel, clamped into the frame, of f32 values. */
export function median9(v: Float32Array, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  const nine = new Float64Array(9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    for (let n = 0; n < 9; n++) {
      const qx = Math.min(w - 1, Math.max(0, x + (n % 3) - 1)); const qy = Math.min(h - 1, Math.max(0, y + Math.floor(n / 3) - 1));
      nine[n] = v[qy * w + qx]!;
    }
    nine.sort();
    out[y * w + x] = nine[4]!;
  }
  return out;
}
/** A CPU mip chain in f64: each level a 2 × 2 box of the one above, RGB per texel, in code values (0 to 255). */
export function mipChain(level0: Float64Array, size: number): { size: number; rgb: Float64Array }[] {
  const out = [{ size, rgb: level0 }];
  while (out[out.length - 1]!.size > 1) {
    const up = out[out.length - 1]!; const n = up.size / 2; const rgb = new Float64Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) {
      const at = (xx: number, yy: number): number => up.rgb[(yy * up.size + xx) * 3 + c]!;
      rgb[(y * n + x) * 3 + c] = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
    }
    out.push({ size: n, rgb });
  }
  return out;
}
/** A trilinear lookup of a chain at (u, v) and level `lod` (clamped into the chain), bilinear in each level with its edges clamped. */
export function trilinear(chain: { size: number; rgb: Float64Array }[], u: number, v: number, lod: number): [number, number, number] {
  const top = chain.length - 1;
  const l = Math.min(top, Math.max(0, lod));
  const l0 = Math.floor(l); const l1 = Math.min(top, l0 + 1); const f = l - l0;
  const bil = (lv: { size: number; rgb: Float64Array }): [number, number, number] => {
    const s = lv.size; const tx = u * s - 0.5; const ty = v * s - 0.5;
    const x0 = Math.floor(tx); const y0 = Math.floor(ty); const fx = tx - x0; const fy = ty - y0;
    const at = (x: number, y: number, c: number): number => lv.rgb[(Math.min(s - 1, Math.max(0, y)) * s + Math.min(s - 1, Math.max(0, x))) * 3 + c]!;
    return [0, 1, 2].map((c) => (at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx) * (1 - fy) + (at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx) * fy) as [number, number, number];
  };
  const a = bil(chain[l0]!); const b = bil(chain[l1]!);
  return [0, 1, 2].map((c) => a[c]! * (1 - f) + b[c]! * f) as [number, number, number];
}

// ---------------------------------------------------------------------------------------------------
// Documents. `view3d` and `canonical` take a whole document (#378's); `live` sessions take the writer's payload.

export const WRITER = 'agent:alpha';
export function sceneDoc(id: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let n = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(n++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #483 acceptance fixture.`, size: [128, 64], camera: 'cam',
    transport: { span: '4s' }, requires: { modules: { scene3d: '^1', effects: '^1' } }, budget: { class: 'figure' },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
export function payload(doc: JsonObject): JsonObject {
  const out = clone(doc);
  delete out['id'];
  delete out['layers'];
  for (const item of Object.values(obj(out['items'], 'items'))) delete (item as JsonObject)['layer'];
  return out;
}
export const camera = (position: [number, number, number], target: [number, number, number] = [0, 0, 0]): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 40 } });
export const box = (pos: [number, number, number]): JsonObject =>
  ({ kind: 'mark.box@1', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos } });
/** A still figure of two boxes and the items given, in budget class `cls`. */
export function figure(id: string, more: Record<string, JsonObject>, opts: { cls?: string; size?: [number, number]; extra?: JsonObject } = {}): JsonObject {
  return sceneDoc(id, { cam: camera([0, 2, 7]), b0: box([-1, 0, 0]), b1: box([1, 0, 0]), ...more },
    { budget: { class: opts.cls ?? 'figure' }, ...(opts.size ? { size: opts.size } : {}), ...(opts.extra ?? {}) });
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

// `live` (#379's, #429's fields): each frame's passes name their operator; a session's row has its state and issues.
export interface Pass { name: string; operator: string | null }
export interface Live { frames: { frame: number; passes: Pass[] }[]; sessions: JsonObject[]; raw: JsonObject }
export function liveReply(reply: JsonObject, what = 'the live call'): Live {
  answered(reply, what);
  return {
    frames: objs(reply['frames'], `${what}: frames`).map((f, i) => ({
      frame: num(f['frame'], `${what}: frames[${i}].frame`),
      passes: objs(f['passes'] ?? [], `${what}: frames[${i}].passes`).map((p) => ({ name: String(p['name']), operator: typeof p['operator'] === 'string' ? p['operator'] : null })),
    })),
    sessions: objs(reply['sessions'], `${what}: sessions`), raw: reply,
  };
}
export function sessionRow(live: Live, session: string): JsonObject {
  const s = live.sessions.find((x) => x['session'] === session);
  expect(s, `the live reply has a row for ${session}: ${shown(live.sessions)}`).toBeDefined();
  return s!;
}
export const liveCall = (spec: JsonObject): JsonObject => ({ call: 'live', look: LOOK, fps: 60, ...spec });

// `view3d` (#378's, with #429's fields; this suite adds `read`: README).
export interface V3Frame { frame: number; pre_tone: string | null; final: string | null; read: Map<string, Read> }
export function view3dFrames(reply: JsonObject, what: string): V3Frame[] {
  answered(reply, what);
  return objs(reply['frames'], `${what}: frames`).map((f, i) => ({
    frame: num(f['frame'], `${what}: frames[${i}].frame`), pre_tone: typeof f['pre_tone'] === 'string' ? f['pre_tone'] : null,
    final: typeof f['final'] === 'string' ? f['final'] : null,
    read: new Map(Object.entries(isObject(f['read']) ? f['read'] : {}).map(([k, v]) => [k, readOf(v, `${what}: frames[${i}].read.${k}`)])),
  }));
}
export function frameOf(frames: V3Frame[], n: number, what: string): V3Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
