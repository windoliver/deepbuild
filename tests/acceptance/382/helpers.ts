// Test-side tools for the #382 acceptance tests: `deep-gpu` (#377's binary, with #378's `view3d` and #380's
// effects) built once per file and driven by JSON lines; the calls this suite adds (README: The surface under
// test) and their replies; the documents these tests draw, generated here so every item is readable; PNG and f32
// target reading (copied from #380's helpers, since suites don't import each other); and this suite's own color
// math: Björn Ottosson's OKLab both ways, the status guard's expected result in f64, and a seeded sampler. Each
// check a criterion's wrong program must fail returns its failures as sentences naming what failed. Nothing here
// stands in for the status guard, the hosts or the look under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/382 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

/** The look's status distance, the issue's and the design's default (Look `look@1`: `min_distance`). */
export const DISTANCE = 0.1;
/** The states of the status map, in the legend's order (Status binding). */
export const STATES = ['pass', 'fail', 'invalid', 'blocked', 'inconclusive', 'running', 'needs_you', 'stale', 'idle'] as const;
export type State = (typeof STATES)[number];
export type Rgb = [number, number, number];
export type Box = [number, number, number, number];

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)}`).toBe('boolean');
  return value as boolean;
}
export function rgb(value: JsonValue | undefined, what: string): Rgb {
  const a = arr(value, what);
  expect(a.length, `${what} is [r, g, b]`).toBe(3);
  return a.map((v, i) => num(v, `${what}[${i}]`)) as Rgb;
}
export function box(value: JsonValue | undefined, what: string): Box {
  const a = arr(value, what);
  expect(a.length, `${what} is [x, y, w, h]`).toBe(4);
  return a.map((v, i) => num(v, `${what}[${i}]`)) as Box;
}
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-gpu`, once per file, copied out of target/debug.

function cargoBuild(): string {
  const args = ['build', '--locked', '--bin', BIN];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Bins { bin: () => string }
/** Builds the binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBin(): Bins {
  let dir = '';
  let made: { bin: string; error: string } | null = null;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-382-bins-'));
    const error = cargoBuild();
    const bin = join(dir, exe(BIN));
    if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(BIN)), bin);
    made = { bin, error };
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(): string {
      expect(made, 'the file built the binary').not.toBeNull();
      expect(made!.error, `the binary builds: cargo build --locked --bin ${BIN}`).toBe('');
      return made!.bin;
    },
  };
}

/** A fresh output folder per test (targets, documents, f32 inputs), deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-382-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one scenario per line in, one line out (#377).

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'guard_to_grey' | 'guard_half_distance' | 'guard_everywhere' | 'host_keeps_document_look' | 'host_cache_by_doc_id' | 'host_check_once';
export interface Startup { planted?: Planted }
export const startArgs = (s: Startup = {}): string[] => ['run', ...(s.planted ? ['--planted', s.planted] : [])];

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: (JsonValue | string)[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** One scenario, accepted, with one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], startup: Startup = {}, timeoutMs?: number): JsonObject[] {
  const args = startArgs(startup);
  const s = start(bin, args, [{ out, calls }], timeoutMs);
  const name = `${BIN} ${args.join(' ')}`;
  expect(s.timedOut, `${name} finished within its timeout`).toBe(false);
  expect(s.status, `${name} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(calls.length);
  return replies;
}
export const run1 = (bin: string, out: string, call: JsonObject, startup: Startup = {}, timeoutMs?: number): JsonObject =>
  run(bin, out, [call], startup, timeoutMs)[0]!;

/** Fails with an INCONCLUSIVE message off macOS: these pixels come from the GPU layer on the reference platform's Metal device. */
export function requireGpu(): void {
  expect(process.platform, 'INCONCLUSIVE: the GPU layer draws these pixels on macOS\'s Metal device, the reference platform; this is not a pass').toBe('darwin');
}
/** A reply the binary answered, not refused (any `code`); INCONCLUSIVE when it says the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}
/** A `status_distance` refusal (the look's existing vocabulary) naming the data role and the status color, or the reasons it isn't one. */
export function distanceRefusal(reply: JsonObject, role: string, state: State, what: string): string[] {
  const problems: string[] = [];
  if (reply['code'] === 'unsupported_platform') expect.fail(`INCONCLUSIVE: ${what} reports unsupported_platform; this is not a pass`);
  if (reply['code'] !== 'status_distance') problems.push(`${what}: not refused with status_distance: ${shown(reply)}`);
  if (reply['role'] !== role) problems.push(`${what}: the refusal names role ${shown(reply['role'])}, not ${role}`);
  if (reply['state'] !== state) problems.push(`${what}: the refusal names the status color ${shown(reply['state'])}, not ${state}`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------
// Color: the sRGB curve, Ottosson's OKLab both ways (his published matrices), gamut clipping, hex.

export const clamp01 = (x: number): number => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));
export const srgbEncode = (x: number): number => { const v = clamp01(x); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
export const srgbDecode = (v: number): number => { const c = clamp01(v); return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export type Lab = [number, number, number];
export type Lin = [number, number, number];

export function linearToOklab([r, g, b]: Lin): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklabToLinear([L, a, b]: Lab): Lin {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
/** OKLab of an sRGB-encoded color given in [0, 1] per channel. */
export const encodedToOklab = (c: Lin): Lab => linearToOklab([srgbDecode(c[0]), srgbDecode(c[1]), srgbDecode(c[2])]);
export const oklab8 = (c: Rgb): Lab => encodedToOklab([c[0] / 255, c[1] / 255, c[2] / 255]);
export const deltaE = (p: Lab, q: Lab): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
export const deltaEOk = (a: Rgb, b: Rgb): number => deltaE(oklab8(a), oklab8(b));
/** A linear color is in the sRGB gamut when every channel lies in [0, 1] (with a hair of room for f64). */
export const inGamut = (c: Lin, slack = 1e-9): boolean => c.every((v) => v >= -slack && v <= 1 + slack);
/** Gamut clipping as this suite reads it: each linear channel clamped to [0, 1] (README: Readings). */
export const clipGamut = (c: Lin): Lin => [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
/** OKLab to an sRGB-encoded color in [0, 1], gamut-clipped. */
export const oklabToEncoded = (lab: Lab): Lin => clipGamut(oklabToLinear(lab)).map(srgbEncode) as Lin;
export const to8 = (c: Lin): Rgb => c.map((v) => Math.round(clamp01(v) * 255)) as Rgb;
export const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
export function fromHex(h: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) throw Error(`${h} is not #rrggbb`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
/** The 8-bit color nearest `lab`, found by rounding its gamut-clipped sRGB encoding. */
export const nearest8 = (lab: Lab): Rgb => to8(oklabToEncoded(lab));
/** An 8-bit color at about |`d`| OKLab from `from` along the OKLab direction `dir` (normalized here), within 0.0025 of |d| after 8-bit rounding, or an error. */
export function toward(from: Rgb, d: number, dir: Lab): Rgb {
  const n = Math.hypot(...dir); const u: Lab = [dir[0] / n, dir[1] / n, dir[2] / n];
  const base = oklab8(from);
  let best: Rgb | null = null;
  for (let k = -3; k <= 3; k++) {
    const t = d + Math.sign(d) * k * 0.0005;
    const c = nearest8([base[0] + u[0] * t, base[1] + u[1] * t, base[2] + u[2] * t]);
    if (Math.abs(deltaEOk(c, from) - Math.abs(d)) <= 0.0025 && (best === null || Math.abs(deltaEOk(c, from) - Math.abs(d)) < Math.abs(deltaEOk(best, from) - Math.abs(d)))) best = c;
  }
  if (best === null) throw Error(`no 8-bit color ${d} from ${hex(from)} along ${JSON.stringify(u)}`);
  return best;
}
/** `toward` along L: lighter for d > 0, darker for d < 0. */
export const alongL = (from: Rgb, d: number): Rgb => toward(from, d, [1, 0, 0]);
/** `toward` the grey axis: chroma lowered by |d| (the hue and lightness kept), a direction that stays in gamut for saturated colors. */
export function greyer(from: Rgb, d: number): Rgb {
  const [, a, b] = oklab8(from);
  return toward(from, d, [0, -a, -b]);
}

/** The status guard's expected result for one display-referred pixel, in f64 (the issue's rule): the nearest status
 *  color, the OKLab line from it through the pixel to the distance, gamut-clipped. `clipped` says the line's point left
 *  the gamut, and `clear` that the projection keeps the distance from every other status color, so only then is the
 *  exact landing point this suite's to predict (README: Readings). */
export interface Guarded { moved: boolean; nearest: State; before: number; expected: Lin; clipped: boolean; clear: boolean }
export function guardExpected(pixel: Lin, colors: Record<State, Rgb>, distance: number): Guarded {
  const lab = encodedToOklab(pixel);
  let nearest: State = 'pass'; let before = Infinity;
  for (const s of STATES) { const d = deltaE(lab, oklab8(colors[s])); if (d < before) { before = d; nearest = s; } }
  if (before >= distance) return { moved: false, nearest, before, expected: pixel, clipped: false, clear: true };
  const from = oklab8(colors[nearest]);
  // A pixel on the status color itself has no direction; the line then goes along +L.
  const dir: Lab = before > 1e-9 ? [(lab[0] - from[0]) / before, (lab[1] - from[1]) / before, (lab[2] - from[2]) / before] : [1, 0, 0];
  const target: Lab = [from[0] + dir[0] * distance, from[1] + dir[1] * distance, from[2] + dir[2] * distance];
  const lin = oklabToLinear(target);
  const clipped = !inGamut(lin, 1e-6);
  const expected = clipGamut(lin).map(srgbEncode) as Lin;
  const clear = STATES.every((s) => s === nearest || deltaE(target, oklab8(colors[s])) >= distance + 1e-6);
  return { moved: true, nearest, before, expected, clipped, clear };
}

/** A 32-bit linear congruential generator (Numerical Recipes' constants), uniform in [0, 1) from a stated seed. */
export class Lcg {
  private x: number;
  constructor(seed: number) { this.x = seed >>> 0; }
  next(): number { this.x = (Math.imul(1664525, this.x) + 1013904223) >>> 0; return this.x / 4294967296; }
}
/** The suite's seed for criterion 5's pixels: the issue's number. */
export const SEED = 382;
/** `count` pixels within `distance` of `color` in OKLab before gamut clipping: a direction uniform over the sphere
 *  (three uniforms in [−1, 1), rejected outside the unit ball or inside 0.001, normalized) and a distance uniform in
 *  [0, `distance`), clipped to the gamut, as sRGB-encoded [0, 1]. */
export function seededNear(rng: Lcg, color: Rgb, count: number, distance: number): Lin[] {
  const from = oklab8(color);
  const out: Lin[] = [];
  while (out.length < count) {
    const v: Lab = [rng.next() * 2 - 1, rng.next() * 2 - 1, rng.next() * 2 - 1];
    const n = Math.hypot(...v);
    if (n > 1 || n < 0.001) continue;
    const d = rng.next() * distance;
    out.push(oklabToEncoded([from[0] + (v[0] / n) * d, from[1] + (v[1] / n) * d, from[2] + (v[2] / n) * d]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Looks and documents

/** The clean look's status map (crates/deep-canvas-marks/looks/clean.json at the base; #380's look repeats it). */
export const STATUS: Record<State, string> = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
export const GLYPHS: Record<State, string> = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
export const statusColors = (status: Record<string, string> = STATUS): Record<State, Rgb> =>
  Object.fromEntries(STATES.map((s) => [s, fromHex(status[s]!)])) as Record<State, Rgb>;

const FONTS: JsonObject = {
  body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
};
/**
 * A `look@1` for a 3D writer layer as #380's fixture look is (physical basis, tone map none at the exposure whose scale
 * is 1, the finish at identity, bloom and the ground grid off), with the status fields the issue names: the status map,
 * one glyph per state, `min_distance` 0.10 and an automatic legend. `roles` maps each data role to its 8-bit color;
 * the ground is `night`. `status` replaces entries of the clean map (a host's or a document's own red).
 */
export function look3(id: string, roles: Record<string, Rgb>, change: { status?: Partial<Record<State, string>>; bloom?: JsonObject } = {}): JsonObject {
  const palette: JsonObject = { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97' };
  const roleMap: JsonObject = { ground: 'night', ink: 'graphite', muted: 'slate' };
  for (const [role, c] of Object.entries(roles)) { palette[`c-${role}`] = hex(c); roleMap[role] = `c-${role}`; }
  return {
    id, format: 1, basis: 'physical', license: 'Apache-2.0', description: `The #382 acceptance look ${id}.`,
    palette, roles: roleMap, themes: { light: {}, dark: {} },
    status: { ...STATUS, ...(change.status ?? {}) }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: DISTANCE,
    attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto', fonts: FONTS,
    tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: change.bloom ?? 'none', ground_3d: { kind: 'none' },
  };
}

/** The verdict handle every status binding of these documents reads. */
export const VERDICT = 'verdict:01JB3820000000000000000382';
export const WRITER = 'agent-a';
const boxItem = (id: string, order: string, size: [number, number, number], pos: [number, number, number], role: string, name: string): JsonObject =>
  ({ id, kind: 'mark.box@1', name, order, layer: 'main', params: { size, paint: { fill: { role } } }, at: { pos } });

/**
 * The film: three boxes on a floor slab, lit by a sun that shines straight along −Z (its `toward` is +Z), seen by a
 * perspective camera on the +Z axis (azimuth 0, elevation 0), so each box's +Z face faces both the sun and the camera
 * and, under `tone_map: none` at unit exposure, draws its role's color exactly (the shading is 0.25 + 0.75 × facing;
 * facing 1 gives 1); the other visible faces are darker. Roles: `lamp`, `block`, `crate`, `floor`. With `binding`,
 * the lamp's badge slot is bound to the verdict, so status can show (Status binding: a 3D object's status binding
 * takes its stroke or badge slot). One writer layer, so a host's revisions can patch it.
 */
export function film(id: string, opts: { binding?: boolean; size?: [number, number]; title?: string } = {}): JsonObject {
  const size = opts.size ?? [480, 360];
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', target: [0, 0.6, 0], orbit: { azimuth: 0, elevation: 0, distance: 7 }, fov: 40, near: 0.1 } },
    floor: boxItem('floor', 'a1', [12, 0.1, 12], [0, -0.05, 0], 'floor', 'Floor'),
    lamp: boxItem('lamp', 'a2', [1.2, 1.2, 1.2], [0, 0.6, 0], 'lamp', 'Lamp'),
    block: boxItem('block', 'a3', [0.8, 0.8, 0.8], [-1.8, 0.4, 0.4], 'block', 'Block'),
    crate: boxItem('crate', 'a4', [0.8, 0.8, 0.8], [1.8, 0.4, -0.4], 'crate', 'Crate'),
    sun: { id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'a9', layer: 'main', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot: [0, 0, 0] } },
  };
  const doc: JsonObject = {
    format: 1, id, profile: 'scene', title: opts.title ?? `Film ${id}`, description: 'Three boxes on a floor under a sun, seen from the front.',
    size, camera: 'cam', transport: { span: '2s' }, requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: WRITER, title: 'Main', order: 'a0' } }, items,
  };
  if (opts.binding) doc['status_bindings'] = { 'b-lamp': { target: 'items/lamp/params/paint/badge', source: VERDICT } };
  return doc;
}
/** A patch op on an item (#378's form). */
export const set = (id: string, path: string, value: JsonValue): JsonObject => ({ op: 'set', id, path: `items/${id}/${path}`, value });

/** Writes a JSON file under the test's output folder and returns its path. */
export function writeJson(out: string, name: string, value: JsonValue): string {
  const path = join(out, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The status report a `view3d` or `host` reply carries (README: The surface under test)

export interface Mark { item: string; binding: string; state: State; slot: string; color: Rgb; bounds: Box; glyph: string | null; label: Box }
export interface Entry { state: State; glyph: string; word: string; color: Rgb; swatch: Box; label: Box }
export interface Status { shows: boolean; look: string; distance: number | null; guard: { ran: boolean; pixels_moved: number } | null; marks: Mark[]; legend: Entry[] }
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
export function statusOf(reply: JsonObject, what: string): Status {
  const s = obj(reply['status'], `${what}: status`);
  const guard = s['guard'] === null || s['guard'] === undefined ? null : obj(s['guard'], `${what}: status.guard`);
  return {
    shows: bool(s['shows'], `${what}: status.shows`), look: str(s['look'], `${what}: status.look`),
    distance: s['distance'] === null || s['distance'] === undefined ? null : num(s['distance'], `${what}: status.distance`),
    guard: guard ? { ran: bool(guard['ran'], `${what}: status.guard.ran`), pixels_moved: num(guard['pixels_moved'], `${what}: status.guard.pixels_moved`) } : null,
    marks: arr(s['marks'], `${what}: status.marks`).map((v, i): Mark => {
      const m = obj(v, `${what}: status.marks[${i}]`); const at = `${what}: status.marks[${i}]`;
      return { item: str(m['item'], `${at}.item`), binding: str(m['binding'], `${at}.binding`), state: str(m['state'], `${at}.state`) as State, slot: str(m['slot'], `${at}.slot`), color: rgb(m['color'], `${at}.color`), bounds: box(m['bounds'], `${at}.bounds`), glyph: optStr(m['glyph'], `${at}.glyph`), label: box(m['label'], `${at}.label`) };
    }),
    legend: arr(s['legend'], `${what}: status.legend`).map((v, i): Entry => {
      const e = obj(v, `${what}: status.legend[${i}]`); const at = `${what}: status.legend[${i}]`;
      return { state: str(e['state'], `${at}.state`) as State, glyph: str(e['glyph'], `${at}.glyph`), word: str(e['word'], `${at}.word`), color: rgb(e['color'], `${at}.color`), swatch: box(e['swatch'], `${at}.swatch`), label: box(e['label'], `${at}.label`) };
    }),
  };
}

/** The pixels of the frame that status colors own (each mark's and legend entry's boxes, grown by `grow` px), as a mask. */
export function statusMask(status: Status, width: number, height: number, grow = 2): Uint8Array {
  const mask = new Uint8Array(width * height);
  const fill = ([x, y, w, h]: Box): void => {
    for (let j = Math.max(0, Math.floor(y - grow)); j < Math.min(height, Math.ceil(y + h + grow)); j++)
      for (let i = Math.max(0, Math.floor(x - grow)); i < Math.min(width, Math.ceil(x + w + grow)); i++) mask[j * width + i] = 1;
  };
  for (const m of status.marks) { fill(m.bounds); fill(m.label); }
  for (const e of status.legend) { fill(e.swatch); fill(e.label); }
  return mask;
}

// ---------------------------------------------------------------------------------------------------
// view3d and host frames

export interface Frame { frame: number; pixel_hash: string | null; final: string | null; ids: string | null; picks: Map<number, string> | null; raw: JsonObject }
export function framesOf(reply: JsonObject, what: string): Frame[] {
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`); const at = `${what}: frames[${i}]`;
    const pixel = optStr(f['pixel_hash'], `${at}.pixel_hash`);
    if (pixel !== null) expect(pixel, `${at}.pixel_hash is a SHA-256`).toMatch(SHA);
    let picks: Map<number, string> | null = null;
    if (isObject(f['picks'])) picks = new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${at}.picks[${k}]`)]));
    return { frame: num(f['frame'], `${at}.frame`), pixel_hash: pixel, final: optStr(f['final'], `${at}.final`), ids: optStr(f['ids'], `${at}.ids`), picks, raw: f };
  });
}
export function frameAt(frames: Frame[], n: number, what: string): Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).join(', ')})`).toBeDefined();
  return f!;
}

// ---------------------------------------------------------------------------------------------------
// PNG, f32 targets and the ID target (#380's readers)

export interface Image { width: number; height: number; /** RGBA, row-major. */ rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image & { channels: number } {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let at = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at); const type = file.toString('latin1', at + 4, at + 8); const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}; the reader takes 8-bit RGB/RGBA, no interlace`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      let v: number;
      switch (filter) { case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break; case 4: v = x + paeth(a, b, c); break; default: throw Error(`PNG filter ${filter}`); }
      line[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = line[x * channels]!; rgba[o + 1] = line[x * channels + 1]!; rgba[o + 2] = line[x * channels + 2]!; rgba[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba, channels };
}
function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written`).not.toBeNull();
  expect(hash, `${what} is named by a SHA-256`).toMatch(SHA);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
export const readPng = (out: string, hash: string | null, what: string): Image => decodePng(readNamed(out, hash, 'png', what));
export function pixel(image: Image, x: number, y: number): Rgb {
  const o = (y * image.width + x) * 4;
  return [image.rgba[o]!, image.rgba[o + 1]!, image.rgba[o + 2]!];
}
/** The slot's bytes as `pixel_hash` hashes them: BGRA8, rows top-down, no padding. */
export function slotHashOf(image: Image): string {
  const bgra = Buffer.alloc(image.rgba.length);
  for (let i = 0; i < image.rgba.length; i += 4) { bgra[i] = image.rgba[i + 2]!; bgra[i + 1] = image.rgba[i + 1]!; bgra[i + 2] = image.rgba[i]!; bgra[i + 3] = image.rgba[i + 3]!; }
  return sha256(bgra);
}
export interface F32 { width: number; height: number; rgba: Float32Array }
/** A target as read back: little-endian f32 RGBA, rows top-down, `w × h × 16` bytes. */
export function readF32(out: string, hash: string | null, size: [number, number], what: string): F32 {
  const file = readNamed(out, hash, 'f32', what);
  expect(file.length, `${what} holds ${size[0]} × ${size[1]} f32 RGBA pixels`).toBe(size[0] * size[1] * 16);
  const rgba = new Float32Array(size[0] * size[1] * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = file.readFloatLE(i * 4);
  return { width: size[0], height: size[1], rgba };
}
export function writeF32(dir: string, name: string, image: F32): string {
  const buf = Buffer.alloc(image.rgba.length * 4);
  for (let i = 0; i < image.rgba.length; i++) buf.writeFloatLE(image.rgba[i]!, i * 4);
  const path = join(dir, `${name}.f32`);
  writeFileSync(path, buf);
  return path;
}
/** The object-ID target: an 8-bit RGBA PNG whose pixel holds pick ID r + 2^8 g + 2^16 b + 2^24 a (0: nothing drawn). */
export interface Ids { width: number; height: number; at: (x: number, y: number) => string | null; count: Map<string, number> }
export function readIds(out: string, f: Frame, what: string): Ids {
  const png = decodePng(readNamed(out, f.ids, 'png', what));
  expect(png.channels, `${what} is an RGBA PNG`).toBe(4);
  expect(f.picks, `${what}: the frame names the item each pick ID stands for`).not.toBeNull();
  const items: (string | null)[] = new Array(png.width * png.height);
  const count = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const o = i * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    const id = pick === 0 ? null : f.picks!.get(pick) ?? null;
    items[i] = id;
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  }
  return { width: png.width, height: png.height, count, at: (x, y) => (x < 0 || y < 0 || x >= png.width || y >= png.height ? null : items[Math.floor(y) * png.width + Math.floor(x)]!) };
}

/** The most common color among the pixels where `keep` holds (ties: the first seen), with its count. */
export function mode(image: Image, keep: (x: number, y: number) => boolean): { color: Rgb; count: number; total: number } {
  const counts = new Map<number, number>();
  let best = -1; let bestKey = 0; let total = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (!keep(x, y)) continue;
    total++;
    const c = pixel(image, x, y); const key = (c[0] << 16) | (c[1] << 8) | c[2];
    const n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
    if (n > best) { best = n; bestKey = key; }
  }
  if (best < 0) throw Error('mode of no pixels');
  return { color: [(bestKey >> 16) & 255, (bestKey >> 8) & 255, bestKey & 255], count: best, total };
}

/** Every pixel of `image` outside `mask` within `distance` of a status color: `(x, y) color: ΔE to state`, at most `limit` listed, and the count. */
export function clashes(image: Image, colors: Record<State, Rgb>, distance: number, mask: Uint8Array | null, limit = 5): { count: number; listed: string[] } {
  const labs = STATES.map((s) => [s, oklab8(colors[s])] as const);
  let count = 0; const listed: string[] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (mask && mask[y * image.width + x]) continue;
    const c = pixel(image, x, y); const lab = oklab8(c);
    for (const [s, l] of labs) {
      const d = deltaE(lab, l);
      if (d < distance) { count++; if (listed.length < limit) listed.push(`(${x}, ${y}) ${hex(c)}: ${d.toFixed(4)} from ${s}`); break; }
    }
  }
  return { count, listed };
}
