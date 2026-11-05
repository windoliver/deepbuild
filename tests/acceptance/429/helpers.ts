// Test-side tools for the #429 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d`, #379's
// `live` and `canonical`, #380's `check_operator`, `op`, `exact` and `cross_gpu`) built once per file per
// feature set and driven by JSON lines; the composed operators and documents these tests use, generated here
// so every step is readable; the reference-Mac gate and the design's judge for timings. Each check a planted
// twin must fail returns its failures as sentences that name what failed. Nothing here stands in for the
// operator check, the emitter, the GPU layer, the meter or render-back under test.

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
/** The checkout root (tests/acceptance/429 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';

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

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-gpu` per feature set, built once per file and copied out of target/debug.

/** `default` is the shipped build; `test-meter` (#379) adds the stub meter and the test hooks (README: Builds). */
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
    dir = mkdtempSync(join(tmpdir(), 'deep-429-bins-'));
    for (const b of builds) {
      const error = cargoBuild(b);
      const bin = join(dir, `${BIN}-${b}`);
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', BIN), bin);
      made.set(b, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(b: Build = 'default'): string {
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-429-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted =
  | 'render_back_draws_live_only' | 'takes_declared_class' | 'attribute_stride_16' | 'partial_update_2_bytes'
  | 'recopies_whole_column' | 'f32_compare_floor_exact' | 'trusts_write_index' | 'drops_swizzle_last'
  | 'noise_weight_halved' | 'settles_with_fallback';

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
// The machine: Metal on macOS for anything the GPU draws; a reference Mac for timings.

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
export function thisFamily(): string {
  const m = /\bM(\d+)\b/.exec(chipName());
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
  const line = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%, load ${loadPerCore().toFixed(2)} a core)`;
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

// ---------------------------------------------------------------------------------------------------
// Operators, as #380's `check_operator` takes them: `kind` is material, pass or compute; `steps` as
// `{op: name@major, args}`; `outputs` map an output to its step. In a document the same fields sit in the
// `params` of an item whose kind is `gpu.material@1`, `gpu.pass@1` or `gpu.compute@1` (README).

export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);
export const LOOK: JsonObject = JSON.parse(readFileSync(fixturePath('look.json'), 'utf8')) as JsonObject;

/** A composed compute operator over `count` elements writing u32 storage `out`, with the steps given. */
export function compute(id: string, steps: JsonObject, extra: JsonObject = {}, count = 64): JsonObject {
  return {
    id, kind: 'compute', origin: 'composed', about: `The #429 fixture ${id}.`, inputs: {}, steps,
    outputs: { out: { storage: { type: 'u32', count } } }, elements: count, workgroup: 64, cost: { ns_per_element: 1000 }, ...extra,
  };
}
/** The frame's color as a pass operator's input. */
export const FRAME_COLOR: JsonObject = { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } };
/** A composed pass operator over the frame's color, in the effects chain at full resolution, with the steps given. */
export function pass(id: string, steps: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    id, kind: 'pass', origin: 'composed', about: `The #429 fixture ${id}.`, inputs: { src: FRAME_COLOR }, steps,
    outputs: { color: 'out' }, chain: 'effects', order: 'a0', resolution: 'full', cost: { ns_per_px: 50 }, fallback: 'look', ...extra,
  };
}
/** A pass that adds 0.6 to the frame's red: the tint. */
export const tint = (id = 'tint', extra: JsonObject = {}): JsonObject => pass(id, {
  uv: { op: 'screen_uv@1', args: {} },
  c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } },
  red: { op: 'const@1', args: { value: [0.6, 0, 0, 0], type: 'vec4' } },
  out: { op: 'add@1', args: { a: 'c', b: 'red' } },
}, extra);
/** An operator as an item of its writer's layer: its kind `gpu.<kind>@1`, its fields in `params`. */
export function asItem(op: JsonObject, order = 'z0'): JsonObject {
  const params = clone(op);
  delete params['id'];
  delete params['kind'];
  return { id: op['id'] as string, kind: `gpu.${op['kind'] as string}@1`, name: `Operator ${op['id'] as string}`, order, params };
}

export interface Checked { outcome: string; issues: JsonObject[]; cls: string | null; estimate: number | null; raw: JsonObject }
/** `check_operator`'s reply (#380's, with `class` and `estimate_ns`: README). */
export function checked(reply: JsonObject, what: string): Checked {
  answered(reply, what);
  const cls = reply['class'];
  const est = reply['estimate_ns'];
  return {
    outcome: str(reply['outcome'], `${what}: outcome`), issues: objs(reply['issues'] ?? [], `${what}: issues`),
    cls: typeof cls === 'string' ? cls : null, estimate: typeof est === 'number' ? est : null, raw: reply,
  };
}
export const checkCall = (operator: JsonObject): JsonObject => ({ call: 'check_operator', operator });
export const errors = (c: Checked, code?: string): JsonObject[] => c.issues.filter((i) => i['severity'] === 'error' && (code === undefined || i['code'] === code));

// ---------------------------------------------------------------------------------------------------
// Documents. `view3d` and `canonical` take a whole document (#378's: an ID, one writer layer, items in it);
// `live` sessions take the writer's payload (#393's: no `id`, no `layers`, no item `layer`).

export const WRITER = 'agent:alpha';
export const BRAVO = 'agent:bravo';
export function sceneDoc(id: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let n = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(n++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #429 acceptance fixture.`, size: [128, 64], camera: 'cam',
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
export const box = (pos: [number, number, number], extra: JsonObject = {}): JsonObject =>
  ({ kind: 'mark.box@1', params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos }, ...extra });
/** A figure of three boxes; `moving` slides the first for the whole span, so every frame draws. */
export function figure(id: string, more: Record<string, JsonObject> = {}, opts: { moving?: boolean; cls?: string; size?: [number, number] } = {}): JsonObject {
  const doc = sceneDoc(id, { cam: camera([0, 2, 7]), b0: box([-2, 0, 0]), b1: box([0, 0, 0], { params: { size: [1, 1, 1], paint: { fill: { role: 'block' } } } }), b2: box([2, 0, 0]), ...more },
    { budget: { class: opts.cls ?? 'figure' }, ...(opts.size ? { size: opts.size } : {}) });
  if (opts.moving) doc['channels'] = { slide: { target: 'items/b0/at/pos/1', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 1, interp: 'linear' } } } };
  return doc;
}
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
}

// ---------------------------------------------------------------------------------------------------
// `live` (#379's call, with this suite's fields: README) and `canonical`.

export interface OpRow { operator: string; item: string | null; resolution: number; drew: string }
export interface View { session: string; writer: string; drawn: boolean; settled: boolean | null; pixel_hash: string | null; operators: OpRow[] }
export interface Pass { name: string; session: string | null; operator: string | null; start_ns: number; end_ns: number; charged_ms: number }
export interface Frame { frame: number; views: View[]; passes: Pass[] }
export interface Canonical { frame: number; session: string; purpose: string; pixel_hash: string | null; presented: boolean | null; reason: string | null; verdict: string | null; raw: JsonObject }
export interface Live { frames: Frame[]; told: JsonObject[]; sessions: JsonObject[]; canonicals: Canonical[]; raw: JsonObject }

const optStr = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
function opRows(v: JsonValue | undefined, at: string): OpRow[] {
  return objs(v ?? [], `${at}.operators`).map((o, i) => ({
    operator: str(o['operator'], `${at}.operators[${i}].operator`), item: optStr(o['item']),
    resolution: num(o['resolution'], `${at}.operators[${i}].resolution`), drew: str(o['drew'], `${at}.operators[${i}].drew`),
  }));
}
export function canonicalOf(c: JsonObject, at: string): Canonical {
  answered(c, at);
  return {
    frame: typeof c['frame'] === 'number' ? c['frame'] : -1, session: optStr(c['session']) ?? '', purpose: str(c['purpose'], `${at}.purpose`),
    pixel_hash: optStr(c['pixel_hash']), presented: typeof c['presented'] === 'boolean' ? c['presented'] : null,
    reason: optStr(c['reason']), verdict: optStr(c['verdict']), raw: c,
  };
}
export function liveReply(reply: JsonObject, what = 'the live call'): Live {
  answered(reply, what);
  const frames = objs(reply['frames'], `${what}: frames`).map((f, i): Frame => {
    const at = `${what}: frames[${i}]`;
    return {
      frame: num(f['frame'], `${at}.frame`),
      views: objs(f['views'], `${at}.views`).map((v, j) => ({
        session: str(v['session'], `${at}.views[${j}].session`), writer: str(v['writer'], `${at}.views[${j}].writer`),
        drawn: v['drawn'] === true, settled: typeof v['settled'] === 'boolean' ? v['settled'] : null, pixel_hash: optStr(v['pixel_hash']),
        operators: opRows(v['operators'], `${at}.views[${j}]`),
      })),
      passes: objs(f['passes'] ?? [], `${at}.passes`).map((p) => ({
        name: String(p['name']), session: optStr(p['session']), operator: optStr(p['operator']),
        start_ns: Number(p['start_ns']), end_ns: Number(p['end_ns']), charged_ms: Number(p['charged_ms']),
      })),
    };
  });
  return {
    frames, told: objs(reply['told'] ?? [], `${what}: told`), sessions: objs(reply['sessions'], `${what}: sessions`),
    canonicals: objs(reply['canonicals'] ?? [], `${what}: canonicals`).map((c, i) => canonicalOf(c, `${what}: canonicals[${i}]`)), raw: reply,
  };
}
export function viewAt(live: Live, frame: number, session: string): View {
  const f = live.frames.find((x) => x.frame === frame);
  expect(f, `frame ${frame} is in the live reply`).toBeDefined();
  const v = f!.views.find((x) => x.session === session);
  expect(v, `frame ${frame} has a view of ${session}`).toBeDefined();
  return v!;
}
export function sessionRow(live: Live, session: string): JsonObject {
  const s = live.sessions.find((x) => x['session'] === session);
  expect(s, `the live reply has a row for ${session}: ${shown(live.sessions)}`).toBeDefined();
  return s!;
}
export const liveCall = (spec: JsonObject): JsonObject => ({ call: 'live', look: LOOK, fps: 60, ...spec });
export const canonicalCall = (doc: string, frame: number, purpose: string, size: [number, number] = [128, 64]): JsonObject =>
  ({ call: 'canonical', look: LOOK, writer: WRITER, doc, size, frame, purpose });

// ---------------------------------------------------------------------------------------------------
// `view3d` (#378's call with #380's `from`; this suite adds `packs` and `evaluate`: README).

export interface V3Frame { frame: number; pixel_hash: string | null; final: string | null; linear: string | null; values: JsonObject }
export function view3dFrames(reply: JsonObject, what: string): V3Frame[] {
  answered(reply, what);
  return objs(reply['frames'], `${what}: frames`).map((f, i) => ({
    frame: num(f['frame'], `${what}: frames[${i}].frame`), pixel_hash: optStr(f['pixel_hash']), final: optStr(f['final']),
    linear: optStr(f['linear']), values: isObject(f['values']) ? f['values'] : {},
  }));
}
export function frameOf(frames: V3Frame[], n: number, what: string): V3Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply`).toBeDefined();
  return f!;
}
/** A linear target (#378): little-endian f32 RGBA, rows top-down, named by its SHA-256. */
export function linearAt(out: string, hash: string | null, size: [number, number], x: number, y: number, what: string): [number, number, number] {
  expect(hash, `${what}: the linear target is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.f32`));
  expect(file.length, `${what}: ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const o = (y * size[0] + x) * 16;
  return [file.readFloatLE(o), file.readFloatLE(o + 4), file.readFloatLE(o + 8)];
}
