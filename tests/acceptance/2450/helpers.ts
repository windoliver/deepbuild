// Test-side tools for the #2450 acceptance tests (README: The surface under test). They drive the binaries as the
// #226 suite does: `deep-gpu run` (#377) with `view3d` (#378: `size`, `fps`, `frames`, `capture`, `targets`, #443's
// `store`, #226's `axes: true`) and the one field this suite assumes (README: Assumed surfaces), and `deep-show run`
// (#393) with `deep_show`, `registry`, `schedule` (#185) and the scenario's `planted`, on the full build and on
// `full,test-leave-out-vector` (#443's). Copied here, since suites never import each other: the JSON-lines runners,
// #166's look shape and #425's PNG coding. Every number a test judges comes from the binaries; the only things
// computed here are the fixtures, the title's SVG and where its ink is, the orbit camera's axes and projection
// (crates/deep-canvas/src/camera.rs) and the vector algebra of a title's box.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];
export type Size = [number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2450 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Each criterion's ID: `#2450.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = { 1: '#2450.308e31fa', 2: '#2450.880b408d', 3: '#2450.9a0cac61' } as const;
export const TIMEOUT = 3_600_000;

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
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[0-9a-f]{64}$/;

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** What the GPU draws is drawn on macOS's Metal device: off macOS a test fails INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the renderer draws on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file, debug info and incremental builds off, copied out of the target folder.

/** `deep-show` is the full build set; `deep-show-no-vector` the full set without the vector module (#443's test feature). */
export type Bin = 'deep-gpu' | 'deep-show' | 'deep-show-no-vector';
const CARGO: Record<Bin, { bin: string; args: string[] }> = {
  'deep-gpu': { bin: 'deep-gpu', args: [] },
  'deep-show': { bin: 'deep-show', args: ['--no-default-features', '--features', 'full'] },
  'deep-show-no-vector': { bin: 'deep-show', args: ['--no-default-features', '--features', 'full,test-leave-out-vector'] },
};
const TOOLCHAIN = join(homedir(), '.rustup', 'toolchains', '1.99.1-aarch64-apple-darwin', 'bin');
const targetDir = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
const cargoArgs = (bin: Bin): string[] => ['build', '--locked', '--bin', CARGO[bin].bin, ...CARGO[bin].args];

/** Builds `bin` (debug) and copies it into `dir`: its path, or cargo's error. */
function buildInto(bin: Bin, dir: string): { path: string; error: string } {
  const args = cargoArgs(bin);
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
  const path = join(dir, bin);
  copyFileSync(join(targetDir(), 'debug', CARGO[bin].bin), path);
  return { path, error: '' };
}

/** Builds the debug `bins` once, in order, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBins(bins: readonly Bin[]): (bin: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { path: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2450-bin-'));
    for (const b of bins) made.set(b, buildInto(b, dir));
  }, 2 * TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (bin: Bin): string => {
    const m = made.get(bin);
    expect(m, `${bin} was built before the tests`).toBeDefined();
    expect(m!.error, `the binary builds: cargo ${cargoArgs(bin).join(' ')}`).toBe('');
    return m!.path;
  };
}
/** A fresh folder per test (documents, the SVG store, the renderer's files), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2450-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
export function writeJson(dir: string, name: string, value: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
/** Puts `bytes` in the store at their SHA-256, as the hub keeps bytes (`<2 hex>/<62 hex>`; #443), and returns it. */
export function putBytes(store: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(store, sha.slice(0, 2)), { recursive: true });
  writeFileSync(join(store, sha.slice(0, 2), sha.slice(2)), bytes);
  return sha;
}

interface Started { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; lines: JsonValue[] }
function start(bin: string, args: string[], input: string): Started {
  const r = spawnSync(bin, args, { cwd: REPO, input, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 3_000_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${bin} ${args.join(' ')} did not finish within 3,000 s`);
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`${bin} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, stdout, stderr: r.stderr ?? '', lines };
}
/** One scenario line in, one answer line out, accepted, with one reply per call. */
function replies(r: Started, label: string, calls: number): JsonObject[] {
  expect(r.status, `${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-3000)}`).toBe(0);
  expect(r.lines.length, `${label}: one output line`).toBe(1);
  const a = obj(r.lines[0], `${label}: the answer`);
  expect(a['ok'], `${label} accepted the scenario: ${brief(a, 3000)}`).toBe(true);
  const out = arr(a['replies'], `${label}: replies`).map((x, i) => obj(x, `${label}: replies[${i}]`));
  expect(out.length, `${label}: one reply per call`).toBe(calls);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one scenario `{out, calls}` in, one line out, one reply per call (#377).

export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  return replies(start(bin, ['run'], `${JSON.stringify({ out, calls })}\n`), 'deep-gpu run', calls.length);
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
// Reading a frame's titles (README: Assumed surfaces 1)

export type Axis = 'x' | 'y' | 'z';
/** A box's corners in world metres, in reading order: bottom-left, bottom-right, top-right, top-left. */
export type Quad = [V3, V3, V3, V3];
/** One title an `axes3d@1` item draws in a frame: text, or the `vector@1` item it names, and its box in the world. */
export interface Title { axis: Axis; text: string | null; vector: string | null; quad: Quad }
/** The frame's `axes` row for the `axes3d@1` item `id`: the titles it draws (Assumed surfaces 1). */
export function titlesOf(frame: JsonObject, id: string, what: string): Title[] {
  const rows = arr(frame['axes'], `${what}: the frame's \`axes\` (#226's report)`).filter(isObject);
  const row = rows.find((r) => r['item'] === id);
  expect(row, `${what}: the frame's \`axes\` has a row for the axes ${id}`).toBeDefined();
  return arr(row!['titles'], `${what}: ${id}'s \`titles\` (README: Assumed surfaces 1)`).map((v, k) => {
    const at = `${what}: ${id}'s titles[${k}]`;
    const o = obj(v, at);
    const axis = str(o['axis'], `${at}.axis`);
    expect(['x', 'y', 'z'], `${at}.axis is x, y or z`).toContain(axis);
    const [text, vector] = [o['text'] ?? null, o['vector'] ?? null];
    expect([typeof text === 'string', typeof vector === 'string'].filter(Boolean).length, `${at} has exactly one of \`text\` and \`vector\`, a string: ${brief(o, 400)}`).toBe(1);
    const quad = arr(o['quad'], `${at}.quad`).map((c, i) => v3(c, `${at}.quad[${i}]`));
    expect(quad.length, `${at}.quad holds four corners`).toBe(4);
    return { axis: axis as Axis, text: typeof text === 'string' ? text : null, vector: typeof vector === 'string' ? vector : null, quad: quad as Quad };
  });
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / length(a));
export const fmt = (a: readonly number[], d = 6): string => `(${a.map((x) => x.toFixed(d)).join(', ')})`;
/** The angle between two directions, in degrees. */
export const angle = (a: V3, b: V3): number => (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;
/** A box's centre. */
export const centre = (q: Quad): V3 => scale(add(add(q[0], q[1]), add(q[2], q[3])), 0.25);
/** An orbit camera's axes in the world (crates/deep-canvas/src/camera.rs): `toward`, the unit vector from its target
 * toward its eye, (cos el · sin az, sin el, cos el · cos az); screen right, forward × +Y at unit length with forward
 * = −toward; and screen up, right × forward. */
export function cameraAxes(azimuthDeg: number, elevationDeg: number): { right: V3; up: V3; toward: V3 } {
  const [az, el] = [(azimuthDeg * Math.PI) / 180, (elevationDeg * Math.PI) / 180];
  const toward: V3 = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  const forward = scale(toward, -1);
  const right = unit(cross(forward, [0, 1, 0]));
  return { right, up: cross(right, forward), toward };
}
/** The pixel (x right, y down, from the frame's top left) where an orthographic orbit camera about `target`, its view
 * `viewWidth` m across a frame `size` px, puts the world point `p` (camera.rs: frame width ÷ view width px per m
 * about the frame's centre). */
export function pixelOf(p: V3, camera: { target: V3; viewWidth: number; azimuth: number; elevation: number }, size: Size): [number, number] {
  const { right, up } = cameraAxes(camera.azimuth, camera.elevation);
  const [d, perMetre] = [sub(p, camera.target), size[0] / camera.viewWidth];
  return [size[0] / 2 + dot(d, right) * perMetre, size[1] / 2 - dot(d, up) * perMetre];
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out (#393).

export const SESSION = 'sess-alpha';
export const docId = (n: number): string => `01JB2450D${String(n).padStart(17, '0')}`;
/** The wrong program this suite plants, reachable only as the scenario's `planted` (README: The planted program). */
export type Planted = 'axes_title_takes_any_kind';
/** One `deep-show run` process: the SVG store, the documents (each on its own panel), the calls; one reply per call. */
export function runShow(bin: string, evidence: string, docs: readonly string[], calls: JsonObject[], planted?: Planted): JsonObject[] {
  const scenario: JsonObject = {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'agent alpha: axis titles', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: Object.fromEntries(docs.map((_, i) => [`p${i + 1}`, { rect: [0, 0, 1280, 720] }])),
    docs: Object.fromEntries(docs.map((d, i) => [d, { panel: `p${i + 1}` }])),
    calls,
    ...(planted ? { planted } : {}),
  };
  return replies(start(bin, ['run'], `${JSON.stringify(scenario)}\n`), `deep-show run${planted ? ` (planted: ${planted})` : ''}`, calls.length);
}
/** One startup with a `registry` call: the seal took the build's module set (exit 0), which it lists. */
export function sealed(bin: string, what: string): string[] {
  const r = start(bin, ['run'], `${JSON.stringify({ evidence: tmpdir(), calls: [{ call: 'registry' }] })}\n`);
  expect(r.status, `${what}: deep-show starts and its seal takes the module set (exit 0); stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  const a = obj(r.lines[0], `${what}: the answer`);
  const reply = obj(arr(a['replies'], `${what}: replies`)[0], `${what}: the registry reply`);
  return arr(reply['modules'], `${what}: registry modules`).map((m) => str(m, `${what}: a module`));
}
/** `schedule`'s `interfaces[name@major].digest` (deep://schedule, #185). */
export const digestOf = (reply: JsonObject, iface: string, what: string): string =>
  str(obj(obj(reply['interfaces'], `${what}: deep://schedule interfaces`)[iface], `${what}: interfaces["${iface}"]`)['digest'], `${what}: ${iface}'s digest`);
/** The working agent's deep_show of a whole revision (#393's agent form). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });

export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export function issues(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return {
      code: str(o['code'], `${what}: issues[${i}].code`), severity: String(o['severity'] ?? ''),
      ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], path: typeof o['path'] === 'string' ? o['path'] : '', raw: o,
    };
  });
}
export const errors = (reply: JsonObject, what: string): Issue[] => issues(reply, what).filter((i) => i.severity === 'error');
/** What keeps a revision from being presented clean: an error issue, an item skipped as an unknown kind, another outcome. */
export function notPresented(reply: JsonObject, what: string): string[] {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  return [
    ...[...notices, ...issues(reply, what).map((i) => i.raw)].filter((n) => n['code'] === 'unknown_kind').map((n) => `${what}: an item is skipped: ${brief(n, 600)}`),
    ...errors(reply, what).map((i) => `${what}: the check raises an error: ${brief(i.raw, 600)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`${what}: the outcome is ${brief(reply['outcome'])}`]),
  ];
}

// ---------------------------------------------------------------------------------------------------
// Looks, lights and items (#166's look shape; metres, +Y up), as the #226 suite writes them

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** A physical-basis `look@1`: tone map none at the exposure whose scale is 1, no finish, deband, bloom, ao or 3D ground. */
function look3d(id: string, change: JsonObject = {}): JsonObject {
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #2450 acceptance look ${id}.`,
    palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', paper: '#f3f1ea', white: '#ffffff' },
    roles: { ground: 'paper', ink: 'graphite', muted: 'slate' },
    themes: { light: {}, dark: {} }, fonts: FONTS,
    status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ao: 'none', ground_3d: { kind: 'none' },
    ...change,
  };
}
export const PLAIN = look3d('plain-2450');
/** The look the taste pictures draw in, as a figure would. */
export const FILMIC = look3d('filmic-2450', { tone_map: 'filmic', exposure: 0 });
const DAY_SKY: JsonObject = { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.6, 0.7, 0.85, 1], ambient_top: [0.35, 0.35, 0.35], ambient_low: [0.15, 0.15, 0.15] } };
const sun = (illuminance: number): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot: [-40, 30, 0] } });
/** A channel keyed linearly from `from` at 0 s to `to` at `span` s. */
const ramp = (target: string, from: number, to: number, span: number): JsonObject =>
  ({ target, type: 'f32', keys: { k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: `${span}s`, value: to, interp: 'linear' } } });

/** A scene document as a `view3d` session holds it (#378): every item in the one writer layer `main`, camera `cam`;
 * it holds a vector item, so it names the vector module beside scene3d (#443's documents). */
export function sessionDoc(id: string, size: Size, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) withIds[key] = { id: key, name: key, order: `a${String(order++).padStart(4, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #2450 acceptance fixture.`, size: [...size], camera: 'cam', seed: 2450,
    requires: { modules: { scene3d: '^1', vector: '^1' } }, budget: { class: 'figure' },
    layers: { main: { writer: 'agent:alpha', title: 'Main', order: 'a0' } }, ...extra, items: withIds,
  };
}
/** The same document in the agent's form for deep_show (#393): no `id`, no `layers`, no item's `layer`. */
export function agentDoc(session: JsonObject): JsonObject {
  const { id: _id, layers: _layers, items, ...rest } = session;
  const out: JsonObject = {};
  for (const [key, item] of Object.entries(obj(items, 'items'))) {
    const { layer: _layer, ...it } = obj(item, `items.${key}`);
    out[key] = it;
  }
  return { ...rest, items: out };
}

// ---------------------------------------------------------------------------------------------------
// The title's graphic (README: Fixtures): "x′" as three filled polygons in a 200 × 100 box, y down, no text element.
// Mirrored left to right, upside down or turned half round, its prime lands on one of the three ground samples.

export const GLYPH = {
  box: [200, 100] as Size,
  parts: {
    'bar-down': [[10, 10], [30, 10], [90, 90], [70, 90]],
    'bar-up': [[70, 10], [90, 10], [30, 90], [10, 90]],
    prime: [[140, 10], [175, 10], [160, 45], [125, 45]],
  } as Record<string, [number, number][]>,
} as const;
/** The SVG of [`GLYPH`]: one filled path per part, black, which the vector item maps to the ink role. */
export const titleSvg = (): Buffer => Buffer.from([
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GLYPH.box[0]} ${GLYPH.box[1]}" width="${GLYPH.box[0]}" height="${GLYPH.box[1]}">`,
  ...Object.entries(GLYPH.parts).map(([id, pts]) => `  <path id="${id}" d="M ${pts.map((p) => p.join(' ')).join(' L ')} Z" fill="#000000"/>`),
  '</svg>', '',
].join('\n'));
/** Whether the SVG fills the point `at` (in its own units): inside any part, by crossings of a ray to the right. */
export function inked(at: [number, number]): boolean {
  return Object.values(GLYPH.parts).some((pts) => {
    let inside = false;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]!;
      if ((a[1] > at[1]) !== (b[1] > at[1]) && at[0] < a[0] + ((at[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) inside = !inside;
    });
    return inside;
  });
}
/** How far `at` is from the nearest edge of any part, in the SVG's units. */
export function clearance(at: [number, number]): number {
  let least = Infinity;
  for (const pts of Object.values(GLYPH.parts)) {
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]!;
      const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * ex + (at[1] - a[1]) * ey) / (ex * ex + ey * ey)));
      least = Math.min(least, Math.hypot(at[0] - (a[0] + t * ex), at[1] - (a[1] + t * ey)));
    });
  }
  return least;
}

// ---------------------------------------------------------------------------------------------------
// The axes (README: Fixtures): #226's, with titles. Domains [−4, 4] on each axis, lengths [8, 8, 8] m, `up: z`.

export const AXES = 'axes';
/** The `vector@1` item a title names. */
export const VECTOR = 'xt';
/** `ticks.size`, the design's default, written out. */
export const TICK = 0.05;
/** The size the axes draw a title at: a text title's `size`, its em (the base: 5 tick lengths), which for a vector is
 * the height of its box (Builder `extrude`: outlines from text, paths and SVG: "size is the height of its box"). */
export const titleSize = (tick: number): number => 5 * tick;
/** Where each axis's line ends, at its domain's high end, in the world: `up: z` maps math x → +X, y → −Z, z → +Y, and
 * 4 on [−4, 4] over 8 m is 4 m from the axes' origin. `along` is the axis's own direction there. */
export const ENDS: Record<Axis, { end: V3; along: V3 }> = {
  x: { end: [4, 0, 0], along: [1, 0, 0] },
  y: { end: [0, 0, -4], along: [0, 0, -1] },
  z: { end: [0, 4, 0], along: [0, 1, 0] },
};
const scales = (): Record<string, JsonObject> => {
  const one = (range: Axis): JsonObject => ({ kind: 'scale@1', params: { type: 'linear', domain: [-4, 4], range, nice: false } });
  return { xs: one('x'), ys: one('y'), zs: one('z') };
};
/** The `vector@1` item over the SVG whose SHA-256 is `src`, its black mapped to the ink role (#398, #443). */
export const vectorItem = (src: string): JsonObject =>
  ({ kind: 'vector@1', params: { src, size: [...GLYPH.box], colors: { '#000000': 'ink' }, alt: 'x prime' } });
/** The `axes3d@1` item on `xs`, `ys` and `zs` at the world origin, with `titles`. */
export const axesItem = (titles: JsonObject, params: JsonObject = {}): JsonObject =>
  ({ kind: 'axes3d@1', params: { x: 'xs', y: 'ys', z: 'zs', lengths: [8, 8, 8], up: 'z', ticks: { size: TICK }, titles, ...params }, at: { pos: [0, 0, 0] } });
/** An orbit camera (camera@1's orbit) about `target`: orthographic `width` m across, or in perspective. */
export const orbitCamera = (projection: 'orthographic' | 'perspective', distance: number, target: V3 = [0, 0, 0], width = 14, elevation = 20): JsonObject => ({
  kind: 'camera@1',
  params: { projection, target: [...target], orbit: { azimuth: 0, elevation, distance }, ...(projection === 'orthographic' ? { view_width: width } : { fov: 45 }), near: 0.1, far: 200 },
});
/** The scene every test draws: the camera, a day sky and a sun, the three scales, the vector item and the axes. */
export const sceneItems = (src: string, camera: JsonObject, titles: JsonObject, axes: JsonObject = {}, more: Record<string, JsonObject> = {}): Record<string, JsonObject> =>
  ({ cam: camera, sky: DAY_SKY, sun: sun(3), ...scales(), [VECTOR]: vectorItem(src), ...more, [AXES]: axesItem(titles, axes) });
/** The orbit: the camera's azimuth keyed linearly from 0° at 0 s to 360° at 1 s; at 36 fps frame k sees 10k°. */
export const ORBIT = { elevation: 20, frames: 36, fps: 36 } as const;
export const SPIN: JsonObject = { transport: { span: '1s' }, channels: { spin: ramp('items/cam/params/orbit/azimuth', 0, 360, 1) } };

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
export function encodePng(image: Image): Buffer {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const o = (y * image.width + x) * 4; const r = y * (image.width * 3 + 1) + 1 + x * 3;
    raw[r] = image.rgba[o]!; raw[r + 1] = image.rgba[o + 1]!; raw[r + 2] = image.rgba[o + 2]!;
  }
  const head = Buffer.alloc(13); head.writeUInt32BE(image.width, 0); head.writeUInt32BE(image.height, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
/** The mean colour of the 3 × 3 pixels about (x, y), or null where they leave the picture. */
export function colourAt(image: Image, at: [number, number]): [number, number, number] | null {
  const [cx, cy] = [Math.floor(at[0]), Math.floor(at[1])];
  if (cx < 1 || cy < 1 || cx > image.width - 2 || cy > image.height - 2) return null;
  const sum = [0, 0, 0];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = ((cy + dy) * image.width + cx + dx) * 4;
    for (let c = 0; c < 3; c++) sum[c]! += image.rgba[o + c]!;
  }
  return [sum[0]! / 9, sum[1]! / 9, sum[2]! / 9];
}
