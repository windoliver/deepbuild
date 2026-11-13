// Test-side tools for the #226 acceptance tests (README: The surface under test). They drive the binaries as the
// sibling suites do: `deep-gpu run [--planted <name>]` (#377) with `view3d` (#378) and the fields this suite assumes
// (README: Assumed surfaces), `deep-gpu run`'s `frame_budget` (#1899), `deep-show run` (#393) with `deep_show`,
// `registry`, `registries` (#200) and `schedule` (#185), and `deep-canvas-render geometry` (#167: an axis's `ticks`).
// Copied here, since suites never import each other: the JSON-lines runners, #166's look shape and #425's PNG and APNG
// coding. Every number a test judges comes from the binaries; the only things computed here are the fixtures, the
// orbit camera's direction (crates/deep-canvas/src/camera.rs) and the vector algebra of a label's quad.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Size = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/226 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Each criterion's ID: `#226.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: '#226.c218cc0a', 2: '#226.1adcd447', 3: '#226.88f58ce5', 4: '#226.a8945cc1',
  5: '#226.58ad6172', 6: '#226.86722d38', 7: '#226.6a40f5c8', 8: '#226.6f3a3161',
} as const;
export const TIMEOUT = 3_600_000;
export const FLICKS = 705_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v, 200)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${brief(v, 200)}`).toBe('string');
  return v as string;
}
export function v3(v: JsonValue | undefined, what: string): V3 {
  const a = arr(v, what);
  expect(a.length, `${what} is [x, y, z]`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
/** Whether `value`'s JSON text holds `text` anywhere (an issue naming a module, a row or an item). */
export const mentions = (value: JsonValue | undefined, text: string): boolean => (JSON.stringify(value) ?? '').includes(text);
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** What the GPU draws is drawn on macOS's Metal device: off macOS a test fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the renderer draws on macOS's Metal device; this is ${process.platform}`);
}
/** The one-minute load average, which the perf lane's `judgeLimit` reads at each run's start and end. */
export const load = (): number => loadavg()[0]!;
interface Bench { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject; validateBudgets: (current: unknown, base: unknown) => void }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/** The perf lane's own rule (scripts/benchmark.mjs): five runs after warm-up on a reference Mac at rest. */
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const b = await bench();
  return b.judgeLimit({ limit, runs, fingerprint: b.fingerprint(), loads });
}
/** Why this machine can't judge a timing now, or '' when it can: the lane's verdict on five zero runs at this load. */
export async function timingProblem(): Promise<string> {
  const now = load();
  const v = await judgeLimit(1, [0, 0, 0, 0, 0], Array.from({ length: 5 }, () => ({ start: now, end: now })));
  return v['status'] === 'PASS' ? '' : String(v['reason'] ?? v['status']);
}
/** The lane's validator (scripts/benchmark.mjs): throws when `current` breaks a task `base` already has. */
export async function validateBudgets(current: JsonObject, base: JsonObject): Promise<void> {
  (await bench()).validateBudgets(current, base);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file, debug info and incremental builds off, copied out of the target folder.

/** `deep-show` is the full build set; `deep-show-no-data` the full set without the data module (#489's test feature). */
export type Bin = 'deep-gpu' | 'deep-show' | 'deep-show-no-data' | 'deep-canvas-render';
const CARGO: Record<Bin, { bin: string; args: string[] }> = {
  'deep-gpu': { bin: 'deep-gpu', args: [] },
  'deep-show': { bin: 'deep-show', args: ['--no-default-features', '--features', 'full'] },
  'deep-show-no-data': { bin: 'deep-show', args: ['--no-default-features', '--features', 'full,test-leave-out-data'] },
  'deep-canvas-render': { bin: 'deep-canvas-render', args: [] },
};
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const cargoArgs = (bin: Bin, release: boolean): string[] => ['build', '--locked', ...(release ? ['--release'] : []), '--bin', CARGO[bin].bin, ...CARGO[bin].args];

/** Builds `bin` (debug, or release) and copies it into `dir`: its path, or cargo's error. */
export function buildInto(bin: Bin, release: boolean, dir: string): { path: string; error: string } {
  const args = cargoArgs(bin, release);
  const env = {
    ...process.env, PATH: `${TOOLCHAIN}${delimiter}/opt/homebrew/opt/rustup/bin${delimiter}${process.env['PATH'] ?? ''}`,
    CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  };
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { path: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { path: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const path = join(dir, `${bin}${release ? '-release' : ''}`);
  copyFileSync(join(targetDir(), release ? 'release' : 'debug', CARGO[bin].bin), path);
  return { path, error: '' };
}

/** Builds the debug `bins` once, in order, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBins(bins: readonly Bin[]): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-226-bin-'));
    for (const b of bins) made.set(b, buildInto(b, false, dir));
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin: Bin): string => {
    const m = made.get(bin);
    expect(m, `${bin} was built before the tests`).toBeDefined();
    expect(m!.error, `the binary builds: cargo ${cargoArgs(bin, false).join(' ')}`).toBe('');
    return m!.path;
  };
}
/** A fresh folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-226-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function writeJson(dir: string, name: string, value: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

interface Started { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; lines: JsonValue[] }
function start(bin: string, args: string[], input: string): Started {
  const r = spawnSync(bin, args, { cwd: REPO, input, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${bin} ${args.join(' ')} did not finish within 3,000 s`);
  // A binary that refuses its arguments (an unknown --planted) exits before reading its input: its exit is judged.
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, stdout, stderr: r.stderr ?? '', lines };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario `{out, calls}` in, one line out, one reply per call (#377).

/** The wrong programs this suite plants, each reachable only through `deep-gpu run --planted` (README). */
export type Planted = 'axes_mod_applies_transform' | 'axes3d_own_tick_rule' | 'axes_mod_maps_every_frame';

export function runGpu(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-gpu ${args.join(' ')}`;
  const r = start(bin, args, `${JSON.stringify({ out, calls })}\n`);
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-3000)}`).toBe(0);
  expect(r.lines.length, `${label}: one output line`).toBe(1);
  const a = obj(r.lines[0], `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${brief(a, 3000)}`).toBe(true);
  const replies = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(replies.length, `${label}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A `view3d` reply's frames, in order from `from`; INCONCLUSIVE where the binary says the platform can't draw. */
export function framesOf(reply: JsonObject, count: number, what: string, from = 0): JsonObject[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what}: view3d answered unsupported_platform`);
  expect(reply['code'], `${what}: view3d is answered, not refused: ${brief(reply)}`).toBeUndefined();
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  expect(frames.map((f) => f['frame']), `${what}: frames ${from} … ${from + count - 1}, in order`).toEqual(Array.from({ length: count }, (_, k) => from + k));
  return frames;
}
/** A file the binary wrote under `out`, named by its SHA-256 (#378). */
export function readNamed(out: string, hash: JsonValue | undefined, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${String(hash)}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}

// ---------------------------------------------------------------------------------------------------
// Reading a frame (README: Assumed surfaces 2 and 3)

export type Axis = 'x' | 'y' | 'z';
export interface Tick { axis: Axis; value: number; opacity: number; at: V3; label: { text: string; quad: [V3, V3, V3, V3] } | null }
/** The frame's `axes` row for the `axes3d@1` item `id`: its ticks as the frame draws them (Assumed surfaces 2). */
export function ticksOf(frame: JsonObject, id: string, what: string): Tick[] {
  const rows = arr(frame['axes'], `${what}: the frame's \`axes\` (README: Assumed surfaces 2)`).filter(isObject);
  const row = rows.find((r) => r['item'] === id);
  expect(row, `${what}: the frame's \`axes\` has a row for the axes ${id} (README: Assumed surfaces 2)`).toBeDefined();
  return arr(row!['ticks'], `${what}: ${id}'s ticks`).map((v, k) => {
    const at = `${what}: ${id}'s ticks[${k}]`;
    const o = obj(v, at);
    const axis = str(o['axis'], `${at}.axis`);
    expect(['x', 'y', 'z'], `${at}.axis is x, y or z`).toContain(axis);
    let label: Tick['label'] = null;
    if (o['label'] !== null && o['label'] !== undefined) {
      const l = obj(o['label'], `${at}.label`);
      const quad = arr(l['quad'], `${at}.label.quad`).map((c, i) => v3(c, `${at}.label.quad[${i}]`));
      expect(quad.length, `${at}.label.quad holds four corners`).toBe(4);
      label = { text: str(l['text'], `${at}.label.text`), quad: quad as [V3, V3, V3, V3] };
    }
    return { axis: axis as Axis, value: num(o['value'], `${at}.value`), opacity: num(o['opacity'], `${at}.opacity`), at: v3(o['at'], `${at}.at`), label };
  });
}
/** The frame's `world` positions of `id`, every vertex in world space (Assumed surfaces 3). */
export function worldOf(frame: JsonObject, id: string, what: string): V3[] {
  const w = obj(frame['world'], `${what}: the frame's \`world\` (README: Assumed surfaces 3)`);
  return arr(w[id], `${what}: world["${id}"]`).map((p, i) => v3(p, `${what}: world["${id}"][${i}]`));
}

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const l = length(a); return [a[0] / l, a[1] / l, a[2] / l]; };
export const fmt = (a: V3, d = 6): string => `(${a.map((x) => x.toFixed(d)).join(', ')})`;
/** The unit vector from an orbit camera's target toward its eye (crates/deep-canvas/src/camera.rs:
 * target + distance · (cos el · sin az, sin el, cos el · cos az)). */
export function towardEye(azimuthDeg: number, elevationDeg: number): V3 {
  const [az, el] = [(azimuthDeg * Math.PI) / 180, (elevationDeg * Math.PI) / 180];
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out (#393).

export const SESSION = 'sess-alpha';
export const docId = (n: number): string => `01JB0226D${String(n).padStart(17, '0')}`;
/** One `deep-show run` process: the documents on the panel, the calls; its replies, one per call. */
export function runShow(bin: string, evidence: string, docs: readonly string[], calls: JsonObject[]): JsonObject[] {
  const scenario: JsonObject = {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: axes', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    calls,
  };
  const r = start(bin, ['run'], `${JSON.stringify(scenario)}\n`);
  expect(r.status, `deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-3000)}`).toBe(0);
  expect(r.lines.length, 'deep-show run: one output line').toBe(1);
  const out = obj(r.lines[0], 'deep-show run: the answer');
  expect(out['ok'], `deep-show run accepted the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies').map((v, i) => obj(v, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(calls.length);
  return replies;
}
/** One startup with a `registry` call: whether the seal took the build's module set (exit 0, its modules listed). */
export function sealed(bin: string, what: string): string[] {
  const r = start(bin, ['run'], `${JSON.stringify({ evidence: tmpdir(), calls: [{ call: 'registry' }] })}\n`);
  expect(r.status, `${what}: deep-show starts and its seal takes the module set (exit 0); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  const a = obj(r.lines[0], `${what}: the answer`);
  const reply = obj(arr(a['replies'], `${what}: replies`)[0], `${what}: the registry reply`);
  return arr(reply['modules'], `${what}: registry modules`).map((m) => str(m, `${what}: a module`));
}
/** The working agent's deep_show of a whole revision (#393's agent form). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });

export interface Issue { code: string; severity: string; raw: JsonObject }
export function issues(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: String(o['severity'] ?? ''), raw: o };
  });
}
export const errors = (reply: JsonObject, what: string): Issue[] => issues(reply, what).filter((i) => i.severity === 'error');
/** The show was presented, with no error issue and no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject, what: string): void {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const bad = [
    ...[...notices, ...issues(reply, what).map((i) => i.raw)].filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped: ${brief(n, 600)}`),
    ...errors(reply, what).map((i) => `the check raises an error: ${brief(i.raw, 600)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`the outcome is ${brief(reply['outcome'])}: ${brief(reply, 1500)}`]),
  ];
  expect(bad, `${what} is presented: ${bad.join('; ')}`).toEqual([]);
}
/** A revision refused (`deep_show` outcome `refused`), with its error issues. */
export function refusedWith(reply: JsonObject, what: string): Issue[] {
  expect(reply['outcome'], `${what}: refused, got ${brief(reply)}`).toBe('refused');
  const errs = errors(reply, what);
  expect(errs.length, `${what}: the refusal carries an error issue: ${brief(reply)}`).toBeGreaterThan(0);
  return errs;
}

// ---------------------------------------------------------------------------------------------------
// `deep-canvas-render geometry` (#167): a 2D document's axis ticks at t, one answer line per input line.

export function geometry2d(bin: string, inputs: JsonObject[]): JsonObject[] {
  const r = start(bin, ['geometry'], `${inputs.map((v) => JSON.stringify(v)).join('\n')}\n`);
  expect(r.status, `deep-canvas-render geometry exits 0: ${r.stderr.slice(0, 2000)}`).toBe(0);
  expect(r.lines.length, 'deep-canvas-render geometry: one answer per input').toBe(inputs.length);
  return r.lines.map((l, i) => obj(l, `deep-canvas-render geometry: answer ${i}`));
}
/** A palette look as deep-canvas-render reads one (#167's). */
export const LOOK_2D: JsonObject = { light: { ground: [255, 255, 255], ink: [20, 20, 20], muted: [90, 90, 90] } };

// ---------------------------------------------------------------------------------------------------
// Looks, lights and items (#166's look shape; metres, +Y up)

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1`: tone map none at the exposure whose scale is 1, no finish, deband, bloom, ao or 3D ground. */
export function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #226 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', paper: '#f3f1ea', white: '#ffffff' },
    roles: { ground: 'paper', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
export const PLAIN = look3d('plain-226');
/** The look the screenshots and the recordings draw in, as a figure would. */
export const FILMIC = look3d('filmic-226', { tone_map: 'filmic', exposure: 0 });
export const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.35, 0.35, 0.35], ambient_low: [0.15, 0.15, 0.15] } };
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
export const material = (base: [number, number, number], roughness = 0.8): JsonObject => ({ kind: 'material@1', params: { base_color: [...base, 1], roughness, metallic: 0 } });
/** An orbit camera about the origin (camera@1's orbit). */
export const orbitCamera = (projection: 'orthographic' | 'perspective', azimuth: number, elevation: number, distance: number): JsonObject => ({
  kind: 'camera@1',
  params: { projection, target: [0, 0, 0], orbit: { azimuth, elevation, distance }, ...(projection === 'orthographic' ? { view_width: 14 } : { fov: 45 }), near: 0.1, far: 200 },
});
/** A channel keyed linearly from `from` at 0 s to `to` at `span` s. */
export const ramp = (target: string, from: number, to: number, span: number): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: `${span}s`, value: to, interp: 'linear' } } });

/** A scene document as a `view3d` session holds it (#378): every item in the one writer layer `main`, camera `cam`. */
export function sessionDoc(id: string, size: Size, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #226 acceptance fixture.`, size: [...size], camera: 'cam', seed: 226,
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'figure' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The same document in the agent's form for deep_show and frame_budget (#393): no `id`, no `layers`, no item's `layer`. */
export function agentDoc(session: JsonObject): JsonObject {
  const { id: _id, layers: _layers, items, ...rest } = session;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(obj(items, 'items'))) {
    const { layer: _layer, ...it } = obj(item, `items.${key}`);
    out[key] = it;
  }
  return { ...rest, items: out };
}
/** A patch op that sets an item's field (#389's `set`). */
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${path}`, value });
export const WRITER = 'agent:alpha';

// ---------------------------------------------------------------------------------------------------
// The axes (README: Fixtures). The issue's numbers: domains [−4, 4] on each axis, lengths [8, 8, 8] m, `up: z`.

export const AXES = 'axes';
export const LENGTHS: V3 = [8, 8, 8];
export const DOMAIN: [number, number] = [-4, 4];
export interface ScaleSpec { type: 'linear' | 'log'; domain: [number, number] }
const LINEAR: ScaleSpec = { type: 'linear', domain: DOMAIN };
/** The three scales `xs`, `ys` and `zs`, each with its domain as written (`nice: false`) and its range the axes' own. */
export function scales(x: ScaleSpec = LINEAR, y: ScaleSpec = LINEAR, z: ScaleSpec = LINEAR): Record<string, JsonObject> {
  const scale = (s: ScaleSpec, range: Axis): JsonObject => ({ kind: 'scale@1', params: { type: s.type, domain: [...s.domain], range, nice: false } });
  return { xs: scale(x, 'x'), ys: scale(y, 'y'), zs: scale(z, 'z') };
}
/** The `axes3d@1` item on `xs`, `ys` and `zs`, at `pos`. */
export const axesItem = (params: JsonObject = {}, pos: V3 = [0, 0, 0]): JsonObject =>
  ({ kind: 'axes3d@1', params: { x: 'xs', y: 'ys', z: 'zs', lengths: [...LENGTHS], up: 'z', ...params }, at: { pos: [...pos] } });
/** `mod.axes@1` on the axes. */
export const MOD_AXES: JsonObject = { kind: 'mod.axes@1', params: { axes: AXES } };
/** A point mark parented to the axes and carrying `mod.axes@1`, its own position (x, y, z) in the axes' numbers. */
export const pointOnAxes = (coords: V3): JsonObject =>
  ({ kind: 'mark.point@1', parent: AXES, at: { pos: [...coords] }, params: { size: 10, paint: { fill: { role: 'ink' } } }, modifiers: [{ ...MOD_AXES }] });
/** The surface: a `plate@1` of 4 × 4 cells, 4 × 4 in its own units, parented to the axes and carrying `mod.axes@1`. */
export const surfaceOnAxes = (cells = 4, size = 4): JsonObject =>
  ({ kind: 'plate@1', parent: AXES, params: { grid: [cells, cells], size: [size, size] }, material: 'clay', modifiers: [{ ...MOD_AXES }] });
const MATS = (): Record<string, JsonObject> => ({ clay: material([0.85, 0.45, 0.25], 0.6) });

/** The axes with a point at (2, 3, 1) and the surface, under a still orthographic camera (criteria 1, 4 and 7). */
export function axesDoc(id: string, size: Size, more: Record<string, JsonObject> = {}, extra: JsonObject = {}, axes: JsonObject = {}): JsonObject {
  return sessionDoc(id, size, {
    cam: orbitCamera('orthographic', 35, 25, 30), sky: DAY_SKY, sun: sun(3, [-40, 30, 0]), ...MATS(),
    ...scales(), [AXES]: axesItem(axes), ...more,
  }, extra);
}

/** Criterion 2's orbit: an orthographic camera at 20° elevation turning 360° in 1 s, 36 frames at 36 fps (10° each). */
export const ORBIT = { elevation: 20, frames: 36, fps: 36 } as const;
export function orbitDoc(id: string, size: Size, projection: 'orthographic' | 'perspective' = 'orthographic', more: Record<string, JsonObject> = {}, look: 'plain' | 'filmic' = 'plain'): JsonObject {
  return sessionDoc(id, size, {
    cam: orbitCamera(projection, 0, ORBIT.elevation, projection === 'orthographic' ? 30 : 24), sky: DAY_SKY, sun: sun(look === 'filmic' ? 4 : 3, [-40, 30, 0]), ...MATS(),
    ...scales(), [AXES]: axesItem(look === 'filmic' ? { titles: { x: 'x', y: 'y', z: 'z' }, planes: ['xy'] } : {}), ...more,
  }, { transport: { span: '1s' }, channels: { spin: ramp('items/cam/params/orbit/azimuth', 0, 360, 1) } });
}

/** Criterion 6's key: the x scale's domain from [−4, 4] at 0 s to [−6, 6] at 1 s, each end keyed linearly. */
export const DOMAIN_KEYS: JsonObject = {
  lo: ramp('items/xs/params/domain/0', -4, -6, 1),
  hi: ramp('items/xs/params/domain/1', 4, 6, 1),
};
/** Criterion 6's 20 sampled times: k ÷ 20 s for k = 1 … 20, so the last is the key's end. */
export const SAMPLES = Array.from({ length: 20 }, (_, i) => i + 1);
export const SAMPLE_FPS = 20;
export const sampleFlicks = (k: number): number => (k * FLICKS) / SAMPLE_FPS;
/** The 3D axes with the x domain keyed (criterion 6), under a still camera. */
export const keyedAxesDoc = (size: Size): JsonObject =>
  axesDoc('keyed-226', size, {}, { transport: { span: '1s' }, channels: DOMAIN_KEYS });
/** The 2D figure with an `axis@1` on the same x scale and the same keys (criterion 6), for deep-canvas-render. */
export function keyedAxis2d(): JsonObject {
  const item = (id: string, kind: string, order: string, params: JsonObject): JsonObject => ({ id, kind, layer: 'main', name: id, order, params });
  return {
    format: 1, id: 'axis2d-226', profile: 'figure', title: 'A 2D axis on the keyed x scale', description: 'The 2D axis criterion 6 holds the 3D axes to.',
    size: [480, 160], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } }, transport: { span: '1s' },
    items: {
      xs: item('xs', 'scale@1', 'a0', { type: 'linear', domain: [...DOMAIN], range: [40, 440], nice: false }),
      xaxis: item('xaxis', 'axis@1', 'a1', { scale: 'xs', side: 'bottom', at: 80 }),
    },
    channels: DOMAIN_KEYS,
  };
}

/** Criterion 3's rows: a point set on the axes, its z through a log z scale [1, 1000]; row `r3` has z = `z3`. */
export const ROW_KEYS = ['r0', 'r1', 'r2', 'r3', 'r4'];
export function logRowsDoc(z3: number): JsonObject {
  const f32 = (values: number[]): JsonObject => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => b.writeFloatLE(v, i * 4));
    return { dtype: 'f32', len: values.length, data: b.toString('base64') };
  };
  return agentDoc(sessionDoc(`log-rows-226-${z3}`, [640, 360], {
    cam: orbitCamera('orthographic', 35, 25, 30), sky: DAY_SKY, sun: sun(3, [-40, 30, 0]),
    ...scales(LINEAR, LINEAR, { type: 'log', domain: [1, 1000] }), [AXES]: axesItem(),
    pts: {
      kind: 'marks@1', parent: AXES,
      params: {
        mark: 'point', n: 5, key: 'key',
        columns: { key: { dtype: 'str', len: 5, data: [...ROW_KEYS] }, x: f32([-3, -1, 0, 2, 3]), y: f32([1, 2, -2, 3, 0]), z: f32([10, 100, 1000, z3, 1]) },
        encode: { x: { column: 'x', scale: 'xs' }, y: { column: 'y', scale: 'ys' }, z: { column: 'z', scale: 'zs' }, size: 6 },
        paint: { fill: { role: 'ink' } },
      },
    },
  }));
}

/** Criterion 7's twin: the same ticks, labels, axis lines with tips and xy grid plane as the axes draw, written as marks
 * in 3D from the issue's numbers (ticks on 1 × 10^0 from −4 to 4, `ticks.size` 0.05 m, `up: z`: math x → +X,
 * math y → −Z, math z → +Y). */
export function marksTwinItems(): Record<string, JsonObject> {
  const place = (axis: Axis, v: number): V3 => (axis === 'x' ? [v, 0, 0] : axis === 'y' ? [0, 0, -v] : [0, v, 0]);
  const out: Record<string, JsonObject> = {};
  const ink = { stroke: { role: 'ink' } };
  for (const axis of ['x', 'y', 'z'] as const) {
    out[`line-${axis}`] = { kind: 'mark.line@1', params: { points: [place(axis, -4), place(axis, 4)], width: 1.5, ends: { end: 'arrow' }, paint: ink } };
    const ticks: V3[] = [];
    for (let v = -4; v <= 4; v++) {
      const p = place(axis, v);
      const off: V3 = axis === 'z' ? [-0.05, 0, 0] : [0, -0.05, 0];
      ticks.push(p, [p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
      out[`label-${axis}${v}`] = {
        kind: 'mark.text@1', at: { pos: [p[0] + 3 * off[0], p[1] + 3 * off[1], p[2] + 3 * off[2]] },
        params: { text: String(v), font: 'body', size: 0.25, size_space: 'world', facing: 'camera', paint: { fill: { role: 'ink' } } },
      };
    }
    out[`ticks-${axis}`] = { kind: 'mark.line@1', params: { points: ticks, mode: 'segments', width: 1, paint: ink } };
  }
  const grid: V3[] = [];
  for (let v = -4; v <= 4; v++) grid.push([v, 0, 4], [v, 0, -4], [-4, 0, -v], [4, 0, -v]);
  out['plane-xy'] = { kind: 'mark.line@1', params: { points: grid, mode: 'segments', width: 1, paint: { stroke: { role: 'muted' } } } };
  return out;
}

// ---------------------------------------------------------------------------------------------------
// PNG reading and writing (#425's): 8-bit RGB or RGBA, no interlace; written with no filter at zlib level 9, so the
// same pixels give the same SHA-256.

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const len = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      const v = filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : filter === 4 ? x + paeth(a, b, c) : NaN;
      if (Number.isNaN(v)) throw Error(`PNG filter ${filter}`);
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
function rows(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  return deflateSync(raw, { level: 9 });
}
function ihdr(width: number, height: number): Buffer {
  const h = Buffer.alloc(13); h.writeUInt32BE(width, 0); h.writeUInt32BE(height, 4); h[8] = 8; h[9] = 2;
  return h;
}
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export function encodePng(image: Image): Buffer {
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr(image.width, image.height)), chunk('IDAT', rows(image)), chunk('IEND', new Uint8Array(0))]);
}
/** An animated PNG of equal-sized frames at `fps`, looping. */
export function encodeApng(frames: Image[], fps: number): Buffer {
  const { width, height } = frames[0]!;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(0, 4);
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr(width, height)), chunk('acTL', actl)];
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt32BE(0, 12); fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22); fctl[24] = 0; fctl[25] = 0;
    parts.push(chunk('fcTL', fctl));
    const data = rows(f);
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}
