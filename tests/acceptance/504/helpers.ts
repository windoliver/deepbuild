// Test-side tools for the #504 acceptance tests: `deep-show` (built `--no-default-features --features full`) driven
// by #393's `deep-show run` scenarios, and `deep-motion` driven by #391's `eval` JSON lines, each built once per file;
// the documents the criteria describe, written here so every file judges the same figures; and the readers of what
// the binaries answer (frames, poses, projections, PNGs from the evidence store). Nothing here stands in for a
// figure, a stage, a pick, a variant, the audit or the framer: every value a test compares comes from a binary, and
// every expected value from the issue's text and the design, computed here in closed form. Parts are copied from
// #405's, #493's and #501's helpers, since suites don't import each other's generators (criterion 2 imports #806's
// hub world, as #806 imports #26's and #393's).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/504 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light (no incremental cache, no debug info; the caller's settings win), with the pinned toolchain first. */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  PATH: `/opt/homebrew/opt/rustup/bin:${process.env['PATH'] ?? ''}`,
};
/** Every `it` passes this timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${brief(v)}`).toBe('string');
  return v as string;
}
/** Whether a value's JSON text holds `needle` (an ID, a hash). */
export const mentions = (v: JsonValue | undefined, needle: string): boolean => (JSON.stringify(v) ?? '').includes(needle);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A test whose surface can't start here fails with this, never passes. */
export function blocked(reason: string): never {
  expect.fail(`BLOCKED: ${reason}; this is not a pass`);
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick)

export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** The frames k ÷ hz s with from ≤ k ÷ hz < to, in flicks (hz divides the second in whole flicks). */
export function grid(hz: number, from: number, to: number): number[] {
  const step = FLICKS / hz;
  const out: number[] = [];
  for (let k = Math.ceil(fl(from) / step); k * step < fl(to); k++) out.push(k * step);
  return out;
}
/** A time field as the time grammar's text. */
export const at = (s: number): string => `${s}s`;

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it uses once, in beforeAll, copied out of target/ under its own name. A test that
// uses a build that failed fails with cargo's error.

export type Bin = 'show' | 'motion';
const ARGS: Record<Bin, string[]> = {
  show: ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'],
  motion: ['build', '--locked', '--bin', 'deep-motion'],
};
const NAMES: Record<Bin, string> = { show: 'deep-show', motion: 'deep-motion' };

function cargo(args: string[]): string {
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return `cargo could not run: ${r.error.message}`;
  if (r.status === 0) return '';
  const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
  return `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}`;
}

export function useBins(names: readonly Bin[]): (name: Bin) => string {
  let dir = '';
  const made = new Map<Bin, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-504-bins-'));
    for (const name of names) {
      const error = cargo(ARGS[name]);
      const bin = join(dir, NAMES[name]);
      if (error === '') copyFileSync(join(TARGET, 'debug', NAMES[name]), bin);
      made.set(name, { bin, error });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (name: Bin): string => {
    const entry = made.get(name);
    if (!entry) throw Error(`the file didn't list ${NAMES[name]} in useBins`);
    expect(entry.error, `the binary builds: cargo ${ARGS[name].join(' ')}`).toBe('');
    return entry.bin;
  };
}

/** Fresh folders for a test (evidence stores, export outputs), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-504-')); made.push(d); return d; };
}

interface Ran { timedOut: boolean; error: string; status: number | null; stdout: string; stderr: string; lines: JsonValue[] }
function start(bin: string, args: string[], text: string): Ran {
  const r = spawnSync(bin, args, { cwd: REPO, input: text, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l): JsonValue => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { timedOut, error: timedOut ? '' : r.error?.message ?? '', status: r.status, stdout, stderr: (r.stderr ?? '').slice(-3000), lines };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run`: the scenario accepted (`ok: true`), with one reply per call. */
export function runShow(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const r = start(bin, ['run'], `${JSON.stringify(scenario)}\n`);
  expect(r.timedOut, `${what}: deep-show run finished within its timeout`).toBe(false);
  expect(r.error, `${what}: deep-show run ran`).toBe('');
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr}`).toBe(0);
  expect(r.lines.length, `${what}: deep-show run writes one answer line`).toBe(1);
  const out = obj(r.lines[0], `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run takes the scenario${scenario['planted'] ? ` (planted ${String(scenario['planted'])})` : ''}: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${what}: replies`).map((v, i) => obj(v, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}

/** The working agent alpha, the process table (your shell is pid 3002), and the scenario's world. */
export const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: figures', process: { pid: 4100, start: 1_000 } } as const;
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 },
  { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 },
];
/** `deep show` from your shell: it acts as you. */
export const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB504D', n);
export const claimId = (n: number): string => `claim:${ulid('01JB504C', n)}`;
export const reqId = (n: number): string => `req:${ulid('01JB504Q', n)}`;

export interface World {
  evidence: string;
  panels: Record<string, [number, number, number, number]>;
  /** Each document the hub minted: its panel, and `for`, the claim or ask it was minted for (README: The surface). */
  docs: Record<string, { panel: string; for?: string }>;
  claims?: JsonObject;
  /** #383's virtual clock: with it, every call carries `at` (flicks). */
  clock?: JsonObject;
  planted?: string;
  calls: JsonObject[];
}
export function scenarioOf(w: World): JsonObject {
  const panels: JsonObject = {};
  for (const [p, rect] of Object.entries(w.panels)) panels[p] = { rect };
  const docs: JsonObject = {};
  for (const [d, spec] of Object.entries(w.docs)) docs[d] = spec.for === undefined ? { panel: spec.panel } : { panel: spec.panel, for: spec.for };
  return {
    evidence: w.evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs, ...(w.clock ? { clock: w.clock } : {}),
    ...(w.claims ? { claims: w.claims } : {}), ...(w.planted ? { planted: w.planted } : {}), calls: w.calls,
  };
}

/** A document as a writer sends it: no `layers` and no item `layer`, which the hub stamps from the connection. */
export function strip(document: JsonObject): JsonObject {
  const out = clone(document);
  delete out['layers'];
  if (isObject(out['items'])) for (const item of Object.values(out['items'])) if (isObject(item)) delete item['layer'];
  return out;
}
/** `deep show` of a whole revision from your shell. */
export const present = (doc: string, document: JsonObject, at?: number): JsonObject =>
  ({ call: 'deep show', peer: YOU_PEER, doc, document: strip(document), include: ['issues'], ...(at === undefined ? {} : { at }) });
/** The working agent alpha's deep_show of a whole revision (#393's agent form). */
export const agentShow = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, document: strip(document), include: ['issues'] });
/** The revision is presented, with no item skipped as a kind the build doesn't know. */
export function presented(reply: JsonObject, what: string): void {
  const notes = [...(Array.isArray(reply['notices']) ? reply['notices'] : []), ...(Array.isArray(reply['issues']) ? reply['issues'] : [])].filter(isObject);
  expect(notes.filter((n) => n['code'] === 'unknown_kind').map((n) => brief(n)), `${what}: no item skipped as a kind the build doesn't know`).toEqual([]);
  expect(reply['outcome'], `${what} is presented: ${brief(reply, 3000)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// `deep-motion eval` (#391's JSON lines; #417's `track`, #493's `cameras` poses and `project`)

/** An input track entry (Input track: `{t: flick, seq, control, value, writer}`; #417's and #544's form). */
export const entry = (seconds: number, control: string, value: JsonValue, seq = 0): JsonObject =>
  ({ t: fl(seconds), seq, control, value, writer: 'you', player: 1 });

export interface EvalLine { doc: JsonObject; times: number[]; track?: JsonObject[]; planted?: string; project?: string[] }
/** `deep-motion eval`, one answer per line, in order; the run exits 0 with one line out per line in. */
export function evalLines(bin: string, lines: EvalLine[]): JsonObject[] {
  const r = start(bin, ['eval'], `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  expect(r.timedOut, 'deep-motion eval finished within its timeout').toBe(false);
  expect(r.error, 'deep-motion eval ran').toBe('');
  expect(r.status, `deep-motion eval exits 0; stderr: ${r.stderr}`).toBe(0);
  expect(r.lines.length, 'deep-motion eval: one output line per input line').toBe(lines.length);
  return r.lines.map((l, i) => obj(l, `deep-motion eval: answer ${i}`));
}

export interface Frame { t: number; items: JsonObject; cameras: JsonObject; projected: JsonObject; readouts: JsonObject; raw: JsonObject }
/** An answer that accepted its document, with one frame per time, in the times' order. */
export function framesOf(answer: JsonObject, times: readonly number[], what: string): Frame[] {
  expect(answer['ok'], `${what} is accepted: ${brief(answer, 2000)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const o = (k: string): JsonObject => (isObject(f[k]) ? (f[k] as JsonObject) : {});
    return { t: num(f['t'], `${what}: frames[${i}].t`), items: o('items'), cameras: o('cameras'), projected: o('projected'), readouts: o('readouts'), raw: f };
  });
  expect(frames.map((f) => f.t), `${what}: one frame per time, in the times' order`).toEqual([...times]);
  return frames;
}
/** One line evaluated: its frames. */
export const evalFrames = (bin: string, line: EvalLine, what: string): Frame[] => framesOf(evalLines(bin, [line])[0]!, line.times, what);

export type V3 = [number, number, number];
export function v3(v: JsonValue | undefined, what: string): V3 {
  const a = arr(v, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
/** An item's evaluated position in the frame, `items.<id>.at.pos`: in world space, its parents' and assemblies' transforms composed. */
export const itemPos = (f: Frame, id: string, what: string): V3 =>
  v3(obj(obj(f.items[id], `${what}: items.${id} at ${f.t} flicks`)['at'], `${what}: items.${id}.at`)['pos'], `${what}: items.${id}.at.pos at ${f.t} flicks`);

/** #493's Pose: `{position, target, azimuth, elevation, distance, fov, view_width, zoom, roll, shot}`. */
export interface Pose { position: V3; target: V3; view_width: number; shot: string | null; raw: JsonObject }
export function poseFrom(v: JsonValue | undefined, what: string): Pose {
  const p = obj(v, what);
  return {
    position: v3(p['position'], `${what}.position`), target: v3(p['target'], `${what}.target`),
    view_width: num(p['view_width'], `${what}.view_width`), shot: typeof p['shot'] === 'string' ? p['shot'] : null, raw: p,
  };
}
export const poseOf = (f: Frame, camera: string, what: string): Pose => poseFrom(f.cameras[camera], `${what}: cameras.${camera} at ${f.t} flicks`);

/** An item's projection (#493's `project`): the box of its bounds' corners in px, [x0, y0, x1, y1]. */
export function boxOf(f: Frame, id: string, what: string): [number, number, number, number] {
  const b = arr(obj(f.projected[id], `${what}: projected.${id} at ${f.t} flicks`)['box'], `${what}: projected.${id}.box`);
  expect(b.length, `${what}: projected.${id}.box has four numbers`).toBe(4);
  return [num(b[0], 'x0'), num(b[1], 'y0'), num(b[2], 'x1'), num(b[3], 'y1')];
}
/** The safe frame of a document in px (Document envelope: `safe: u = 24`; 1 u is 1 px at the document's size). */
export function safeFrame(doc: JsonObject): [number, number, number, number] {
  const size = doc['size'] as number[];
  const safe = typeof doc['safe'] === 'number' ? doc['safe'] : 24;
  return [safe, safe, size[0]! - safe, size[1]! - safe];
}
/** The numbers a readout's text shows, in order (a readout shows each value at its own precision). */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
}

// ---------------------------------------------------------------------------------------------------
// Vectors

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / norm(a));
export const dist = (a: V3, b: V3): number => norm(sub(a, b));
export const rad = (d: number): number => (d * Math.PI) / 180;
/** The eye of an orbit pose (Camera camera@1: azimuth 0 puts the eye on +Z of the target; +Y up). */
export function orbitEye(target: V3, azimuth: number, elevation: number, distance: number): V3 {
  const [a, e] = [rad(azimuth), rad(elevation)];
  return [target[0] + distance * Math.cos(e) * Math.sin(a), target[1] + distance * Math.sin(e), target[2] + distance * Math.cos(e) * Math.cos(a)];
}

// ---------------------------------------------------------------------------------------------------
// The evidence store (`<2 hex>/<62 hex>`, each file named by its SHA-256) and PNG (8-bit RGB or RGBA, no interlace)

export function getEvidence(evidence: string, h: string, what: string): Buffer {
  const path = join(evidence, h.slice(0, 2), h.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${h}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(h);
  return bytes;
}
export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; } else if (type === 'IDAT') data.push(body); else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const ch = color === 6 ? 4 : 3; const stride = width * ch;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? line[i - ch]! : 0; const b = prev[i]!; const c = i >= ch ? prev[i - ch]! : 0; const x = line[i]!;
      line[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * ch + k]!;
      rgba[(y * width + x) * 4 + 3] = ch === 4 ? line[x * ch + 3]! : 255;
    }
    prev = line;
  }
  return { width, height, rgba };
}
export type Rgb = [number, number, number];
export function pixel(img: Image, x: number, y: number): Rgb {
  const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
  return [img.rgba[i]!, img.rgba[i + 1]!, img.rgba[i + 2]!];
}
/** Two colors equal within `tol` code values on each channel. */
export const sameColor = (a: Rgb, b: Rgb, tol = 3): boolean => a.every((v, k) => Math.abs(v - b[k]!) <= tol);

// ---------------------------------------------------------------------------------------------------
// Documents (#391's envelope; `layers` and item `layer` for `deep-motion`, stripped for `deep-show`)

export const LAYER = 'main';
const LAYERS: JsonObject = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } };
/** A document: its items keyed by ID in the order given, each in the one layer, with the envelope's other maps. */
export function envelope(id: string, profile: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}): JsonObject {
  const camera = items.some((i) => i['id'] === 'cam') ? { camera: 'cam' } : {};
  return {
    format: 1, id, profile, title: `#504 ${id}`, description: `The #504 acceptance tests' ${profile} ${id}.`, size, ...camera, layers: LAYERS,
    items: Object.fromEntries(items.map((i, k) => [String(i['id']), { layer: LAYER, name: String(i['id']), order: `a${String(k).padStart(3, '0')}`, ...i }])),
    ...extra,
  };
}
/** The modules a 3D figure with controls and motion requires. */
export const FIGURE_MODULES: JsonObject = { modules: { scene3d: '^1', motion: '^1', input: '^1' } };
/** A 2D (orthographic) camera@1 over a page of `size` u, y down. */
export const cam2d = (size: [number, number]): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } });
/** A 3D camera@1 orbiting its target. */
export const cam3d = (params: JsonObject): JsonObject => ({ id: 'cam', kind: 'camera@1', params });
/** A 3D box (`mark.box@1 {size: m}`), centred on its position. */
export const box = (id: string, pos: V3, size: V3, role = 'accent', extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'mark.box@1', params: { size, paint: { fill: { role } } }, at: { pos }, ...extra });
/** A 2D rectangle: `box` [x, y, w, h] in u from its position. */
export const rect = (id: string, b: [number, number, number, number], role = 'ink', extra: JsonObject = {}): JsonObject =>
  ({ id, kind: 'rect@1', params: { box: b, paint: { fill: { role } } }, at: { pos: [0, 0, 0] }, ...extra });
/** A text item whose words fill from a template (Text `text@1`: `template`). */
export const readout = (id: string, pos: [number, number], template: string): JsonObject =>
  ({ id, kind: 'text@1', role: 'status', params: { template, font: 'body', size: 14, box: { w: 280, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });

// ---------------------------------------------------------------------------------------------------
// The box figure (criteria 3 and 8): four assemblies, each part in one, a take-apart timed by a follow's stagger,
// a slider that slides the body, and the card. Metres, +Y up.

/** Each part: its assembly, its rest position (world = assembly space, every assembly at the origin) and its size. */
export const PARTS: Record<string, { assembly: string; pos: V3; size: V3 }> = {
  plate: { assembly: 'base', pos: [0, 0.025, 0], size: [0.6, 0.05, 0.4] },
  shell: { assembly: 'body', pos: [0, 0.15, 0], size: [0.4, 0.2, 0.3] },
  cover: { assembly: 'lid', pos: [0, 0.27, 0], size: [0.42, 0.04, 0.32] },
  cap: { assembly: 'knob', pos: [0, 0.31, 0], size: [0.06, 0.04, 0.06] },
};
/** Each assembly: its parent, its apart vector and its place in the take-apart (Assembly). */
export const ASSEMBLIES: Record<string, { parent: string | null; apart: V3; order: number }> = {
  base: { parent: null, apart: [0, 0, 0], order: 0 },
  body: { parent: 'base', apart: [0, 0.3, 0], order: 1 },
  lid: { parent: 'body', apart: [0, 0.3, 0], order: 2 },
  knob: { parent: 'lid', apart: [0.25, 0, 0], order: 3 },
};
/** The take-apart: the figure comes apart at 1 s and back at 4 s, each assembly over 0.5 s, 0.25 s after the one before. */
export const TAKE_APART = { apart: 1, back: 4, span: 0.5, lag: 0.25, order: ['body', 'lid', 'knob'] } as const;
/** The card's readout: the number that slides the body (README: Readings). */
export const CARD_READOUT = 'Lift {assemblies/body/value} m';

/** The box figure; `extra` adds envelope fields (a shot, a camera). */
export function boxFigure(extra: JsonObject = {}): JsonObject {
  const assemblies: JsonObject = {};
  for (const [id, a] of Object.entries(ASSEMBLIES)) {
    assemblies[id] = {
      parent: a.parent, at: { pos: [0, 0, 0] }, apart: a.apart, order: a.order, value: 0,
      ...(id === 'body' ? { motion: { kind: 'slide', axis: [0, 1, 0], range: [0, 0.2] } } : {}),
    };
  }
  const roles: Record<string, string> = { plate: 'muted', shell: 'accent', cover: 'ink', cap: 'session_readout' };
  const parts = Object.entries(PARTS).map(([id, p]) => box(id, p.pos, p.size, roles[id], { parent: p.assembly }));
  const keys = { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: at(TAKE_APART.apart), value: 1, interp: 'hold' }, k2: { t: at(TAKE_APART.back), value: 0, interp: 'hold' } };
  return envelope('box-figure', 'figure', [1920, 1080], [
    cam3d({ projection: 'perspective', target: [0, 0.2, 0], orbit: { azimuth: 30, elevation: 20, distance: 3 }, fov: 40 }),
    ...parts,
  ], {
    requires: FIGURE_MODULES,
    transport: { span: '6s', frame_rate: [60, 1] },
    assemblies,
    controls: { lift: { kind: 'slider', class: 'document', label: 'Lift', role: 'slider', range: [0, 0.2], default: 0, increment: 0.005 } },
    drivers: { raise: { target: 'assemblies/body/value', expr: 's', vars: { s: 'controls/lift/value' } } },
    channels: {
      take: {
        target: 'assemblies/apart', type: 'f32', mode: 'follow',
        follow: {
          source: { keys }, model: { transition: { span: at(TAKE_APART.span), interp: 'linear' } },
          stagger: { targets: [...TAKE_APART.order], lag: at(TAKE_APART.lag), order: 'index' },
        },
      },
    },
    card: { fig: 'Fig. 1', title: 'A box that opens', hint: 'Drag Lift, then watch it come apart', readout: CARD_READOUT },
    ...extra,
  });
}
/** A part's chain of assemblies, its own first. */
export function chainOf(part: string): string[] {
  const out: string[] = [];
  for (let a: string | null = PARTS[part]!.assembly; a !== null; a = ASSEMBLIES[a]!.parent) out.push(a);
  return out;
}
