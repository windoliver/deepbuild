// Test-side tools for the #537 acceptance tests (README: The surface under test). They build `deep-show` and `deep-gpu`
// (each once per file) and #544's assembler (../544/wat, read only), keep evidence stores and output folders, drive
// `deep-show run` (one scenario line in, one answer line out: #393) and `deep-gpu run [--planted <name>]` (one
// `{out, calls}` line in, one answer line out: #377's `view3d`), and read their replies and the files they write. PNG
// reading and writing come from ../467/helpers.ts by import, as #535's suite takes them. Nothing here stands in for the
// logic module, the column view, scene3d, the renderer or the selection: every element, pixel, count, issue and pose
// read here is the implementation's own; every expected value comes from the issue's text and this suite's programs.

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { decodePng, encodeApng, encodeRgbaPng, type Image } from '../467/helpers.ts';

export { decodePng, encodeApng, encodeRgbaPng, type Image };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/537 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** The builds' timeout (a first build takes many minutes on a loaded machine); each test passes its own. */
export const BUILD_TIMEOUT = 7_200_000;
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #537.fdb98a26',
  2: 'AC2 #537.f46857ff',
  3: 'AC3 #537.04600c21',
  4: 'AC4 #537.3f91633c',
  5: 'AC5 #537.7f9c9403',
} as const;

/** A machine or tool that can't run a reading fails with this, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
/** The GPU layer draws on macOS's Metal device, the reference platform: elsewhere a drawn reading is INCONCLUSIVE. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws these frames on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Time: 705,600,000 flicks a second; a 60 Hz step and a 60 fps frame are 11,760,000. Frame n of a `view3d` call at
// 60 fps is at n ÷ 60 s, the time of logic step n, so frame n shows the arrays as step n left them.

export const FLICKS = 705_600_000;
export const STEP = FLICKS / 60;
export const at = (k: number): number => k * STEP;
export const FPS = 60;

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v, 600)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v, 600)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v, 600)}`).toBe('string');
  return v as string;
}
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted program's run: this suite's own judgement must fail it, and some failure must match every one of `named`. */
export function failsNaming(failures: readonly string[], named: RegExp[], what: string): void {
  expect(failures.length, `${what}: the criterion's check fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => named.every((n) => n.test(f))), `${what}: a failure names ${named.join(' and ')}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}
/** Writes `value` as JSON under `dir`; its path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked --bin deep-show` and `--bin deep-gpu` (the default sets), once per file, copied out.

export type Bin = 'deep-show' | 'deep-gpu';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
function cargo(args: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
let binsDir = '';
const built = new Map<Bin, { bin: string; error: string }>();
function build(b: Bin): { bin: string; error: string } {
  const known = built.get(b);
  if (known) return known;
  if (!binsDir) binsDir = mkdtempSync(join(tmpdir(), 'deep-537-bins-'));
  const bin = join(binsDir, exe(b));
  const error = cargo(['build', '--locked', '--bin', b], REPO, {});
  if (error === '') copyFileSync(join(TARGET, 'debug', exe(b)), bin);
  const out = { bin, error };
  built.set(b, out);
  return out;
}
/** Builds before a file's tests (the slow part), so each test's own time is its own. */
export function prebuild(list: Bin[]): void {
  beforeAll(() => { for (const b of list) build(b); }, BUILD_TIMEOUT);
}
/** The built binary; a test that uses a build that failed fails, naming cargo's error. */
export function binOf(b: Bin): string {
  const out = build(b);
  expect(out.error, `${b} builds on this host: cargo build --locked --bin ${b}`).toBe('');
  return out.bin;
}
afterAll(() => { if (binsDir) rmSync(binsDir, { recursive: true, force: true }); binsDir = ''; built.clear(); });

// ---------------------------------------------------------------------------------------------------
// Programs: WebAssembly text assembled by #544's assembler (../544/wat, outside the workspace), in its own target.

export interface Program { name: string; bytes: Buffer; sha: string }
const WAT_DIR = join(REPO, 'tests', 'acceptance', '544', 'wat');
const WAT_TARGET = join(TARGET, 'acceptance-537-wat');
let watBin = '';
function assembler(): string {
  if (watBin) return watBin;
  const error = cargo(['build', '--locked', '--manifest-path', join(WAT_DIR, 'Cargo.toml')], WAT_DIR, { CARGO_TARGET_DIR: WAT_TARGET });
  if (error) blocked(`#544's assembler (tests/acceptance/544/wat) didn't build: ${error}`);
  watBin = join(WAT_TARGET, 'debug', exe('acceptance-544-wat'));
  return watBin;
}
const assembled = new Map<string, Program>();
/** Assembles WebAssembly text into a Program. */
export function assemble(name: string, text: string): Program {
  const known = assembled.get(`${name}\n${text}`);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), 'deep-537-wat-'));
  try {
    const file = join(dir, `${name}.wat`);
    writeFileSync(file, text);
    const run = spawnSync(assembler(), [dir, file], { encoding: 'utf8', maxBuffer: 64 * MIB });
    if (run.status !== 0) throw Error(`the assembler refused ${name}: ${run.stderr.slice(-2000)}`);
    const bytes = readFileSync(join(dir, `${name}.wasm`));
    const p = { name, bytes, sha: sha256(bytes) };
    assembled.set(`${name}\n${text}`, p);
    return p;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// Folders: a fresh one per call, deleted after the test. An evidence store (#15's layout: `<2 hex>/<62 hex>`) for
// `deep-show`; a plain folder of named files for `deep-gpu`.

export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-537-')); made.push(d); return d; };
}
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
/** A file `view3d` reads by SHA-256 (a program or a glTF), written under `dir`; its `assets` entry. */
export function putAsset(dir: string, bytes: Uint8Array, ext: string): Record<string, string> {
  const h = sha256(bytes);
  const path = join(dir, `${h}.${ext}`);
  writeFileSync(path, bytes);
  return { [h]: path };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line on stdin, one answer `{ok, replies}` (#393). Used for what the document check
// says (refusals at check), for `eval`'s issues (#535's `column.out_of_range`) and for `geometry` rows (#420).

export const SESSION = 'sess-537';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-537', name: 'Claude Code: live game state in 3D', process: { pid: 4100, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4100, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB537D${String(n).padStart(18, '0')}`;

/** A scenario: the agent's session, the process table, each document in a visible panel of its own, and the calls. */
export function scenario(evidence: string, docs: string[], calls: JsonObject[]): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; docMap[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, calls };
}
/** `deep-show run` on one scenario: exit 0, one answer line, ok, one reply per call, in call order. */
export function runShow(bin: string, sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  let parsed: JsonValue;
  try { parsed = JSON.parse(lines[0]!) as JsonValue; } catch { parsed = lines[0]!; }
  const out = obj(parsed, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok; got ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(list.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}
/** The agent's `deep_show` of a whole document (#393), with its issues. */
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** `eval` at `t` flicks on the document's live session (#387), its issues (#535's) read; no pixels. */
export const evalCall = (doc: string, t: number): JsonObject => ({ call: 'eval', doc, t, pixels: false });
/** `geometry` (#420) of the named items in a clean evaluation at `t` flicks: each one's built mesh and its key. */
export const geometryCall = (doc: string, items: string[], t: number): JsonObject => ({ call: 'geometry', doc, items, t });
/** A `deep_show` reply that presented its document: the message lists the issues when it didn't. */
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply['issues'] ?? reply, 2500)}`).toBe('presented');
  const errors = issuesOf(reply).filter((i) => i['severity'] === 'error');
  expect(errors, `${what} is presented with no error`).toEqual([]);
}
export function issuesOf(reply: JsonObject): JsonObject[] {
  const list = reply['issues'];
  return Array.isArray(list) ? list.filter(isObject) : [];
}
/** An issue's own fields as text, without its prose (`what`, `fix`) or its close names: what it names. */
export const namedIn = (issue: JsonObject): string => { const { what: _w, fix: _f, close: _c, ...rest } = issue; return JSON.stringify(rest); };
/** `word` stands as a whole name in `text` (a dot or a slash may join it to others). */
export const names = (text: string, word: string): boolean => new RegExp(`(^|[^A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(text);
/** The issue names item `id`: its `ids` hold it, or its `path` is `items/<id>` or under it. */
export function namesItem(issue: JsonObject, id: string): boolean {
  const ids = Array.isArray(issue['ids']) ? issue['ids'].map(String) : [];
  const path = typeof issue['path'] === 'string' ? issue['path'] : '';
  return ids.includes(id) || path === `items/${id}` || path.startsWith(`items/${id}/`);
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one `{out, calls}` line in, one answer line out (#377), each `view3d` reply's
// frames (README: The surface under test).

/** The `--planted` names this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type Planted = 'instancer_addresses_by_slot' | 'overlay_keeps_grid_on_seek' | 'line_reads_previous_step' | 'part_pose_in_world_space';

/** One `deep-gpu run` process: the calls in order, a reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], what: string, planted?: Planted): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const tag = `${what}: deep-gpu ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 4 * 1024 * MIB, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${tag} did not finish within its timeout`);
  if (r.error) throw r.error;
  const stdout = r.stdout ?? '';
  expect(r.status, `${tag} exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${tag}: one answer line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${tag}: the answer`);
  expect(answer['ok'], `${tag} answers the scenario ok: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${tag}: replies`).map((x, i) => obj(x, `${tag}: replies[${i}]`));
  expect(replies.length, `${tag}: one reply per call`).toBe(calls.length);
  return replies;
}

export interface View3d {
  doc: string; size: [number, number]; look?: JsonObject; frames?: number; fps?: number; from?: number;
  seeks?: { after: number; to: number }[]; capture?: 'every' | number[]; targets?: ('final' | 'ids')[];
  counts?: boolean; timings?: boolean; evaluate?: string[]; clicks?: { frame: number; at: [number, number] }[];
  viewer?: { frame: number; selection: string[] }[]; assets?: Record<string, string>;
}
/** A `view3d` call (#378) at 60 frames a second in this suite's look. */
export const view3dCall = (v: View3d): JsonObject => ({ call: 'view3d', look: LOOK, fps: FPS, frames: 1, ...(v as unknown as JsonObject) });

/** One frame of a `view3d` reply, the fields this suite reads (README: The surface under test). */
export interface Frame {
  frame: number; raw: JsonObject; hash: string | null; final: string | null; ids: string | null; picks: Map<number, string> | null;
  clicks: (string | null)[]; values: JsonObject | null; gpuMs: number | null; meshesBuilt: number | null;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));
/** A `view3d` reply's frames, in the order drawn; INCONCLUSIVE where the platform can't draw. */
export function framesOf(reply: JsonObject, what: string): Frame[] {
  if (reply['code'] === 'unsupported_platform' || reply['code'] === 'gpu_unavailable') inconclusive(`${what}: view3d reports ${String(reply['code'])}`);
  expect(reply['code'], `${what}: view3d answers, not refuses: ${show(reply, 2500)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const w = `${what}: frames[${i}]`;
    const picks = isObject(f['picks']) ? new Map(Object.entries(f['picks']).map(([k, id]) => [Number(k), str(id, `${w}.picks[${k}]`)])) : null;
    return {
      frame: num(f['frame'], `${w}.frame`), raw: f, hash: optStr(f['pixel_hash'], `${w}.pixel_hash`), final: optStr(f['final'], `${w}.final`),
      ids: optStr(f['ids'], `${w}.ids`), picks,
      clicks: arr(f['clicks'] ?? [], `${w}.clicks`).map((c, j) => { const o = obj(c, `${w}.clicks[${j}]`); return o['pick'] === null || o['pick'] === undefined ? null : str(o['pick'], `${w}.clicks[${j}].pick`); }),
      values: isObject(f['values']) ? f['values'] : null, gpuMs: optNum(f['gpu_ms'], `${w}.gpu_ms`), meshesBuilt: optNum(f['meshes_built'], `${w}.meshes_built`),
    };
  });
}
export function frameAt(frames: Frame[], n: number, what: string): Frame {
  const f = frames.find((x) => x.frame === n);
  expect(f, `${what}: frame ${n} is in the reply (frames ${frames.map((x) => x.frame).slice(0, 40).join(', ')})`).toBeDefined();
  return f!;
}
/** The value `evaluate` reported at `path` on a frame. */
export function valueAt(f: Frame, path: string, what: string): JsonValue {
  expect(f.values, `${what}: frame ${f.frame} reports the evaluated paths (values)`).not.toBeNull();
  expect(path in f.values!, `${what}: frame ${f.frame}'s values hold ${path}: ${show(f.values, 400)}`).toBe(true);
  return f.values![path]!;
}
/** A per-item map a frame reports with `counts` (`element_uploads`, `row_uploads`, `segments`): the item's entry. */
export function countsEntry(f: Frame, field: string, item: string, what: string): JsonValue | undefined {
  expect(f.raw[field], `${what}: frame ${f.frame} reports ${field} (counts): ${show(f.raw, 600)}`).toBeDefined();
  return obj(f.raw[field], `${what}: frame ${f.frame}.${field}`)[item];
}
/** A file the binary wrote under `out`, named by its SHA-256 with `ext` (#378). */
export function readNamed(out: string, hash: string | null, ext: string, what: string): Buffer {
  expect(hash, `${what} is written, named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const file = readFileSync(join(out, `${hash}.${ext}`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(hash);
  return file;
}
export const finalOf = (out: string, f: Frame, what: string): Image => decodePng(readNamed(out, f.final, 'png', `${what}: frame ${f.frame}'s final target`));
/** The object-ID target (#378): pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws, named by the frame's `picks`. */
export function idsOf(out: string, f: Frame, what: string): (x: number, y: number) => string | null {
  const png = decodePng(readNamed(out, f.ids, 'png', `${what}: frame ${f.frame}'s object-ID target`));
  expect(f.picks, `${what}: frame ${f.frame} names the item each pick ID stands for (picks)`).not.toBeNull();
  return (x, y) => {
    const o = (Math.floor(y) * png.width + Math.floor(x)) * 4;
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    return pick === 0 ? null : f.picks!.get(pick) ?? `unknown pick ${pick}`;
  };
}

// ---------------------------------------------------------------------------------------------------
// Pixels

export type Rgb = [number, number, number];
export const pixel = (im: Image, x: number, y: number): Rgb => {
  const o = (Math.floor(y) * im.width + Math.floor(x)) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!];
};
/** The largest per-channel difference in code values. */
export const codeOff = (a: Rgb, b: Rgb): number => Math.max(...[0, 1, 2].map((k) => Math.abs(a[k]! - b[k]!)));
/** Re-encodes a decoded picture so the same pixels always give the same bytes (AC5's files). */
export const pngBytes = (im: Image): Buffer => encodeRgbaPng(im.width, im.height, (x, y) => {
  const o = (y * im.width + x) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!];
});

// ---------------------------------------------------------------------------------------------------
// The look and the documents' envelopes

const STATUS: JsonObject = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};
const GLYPHS: JsonObject = { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' };
/** The `fog` and `dim` roles the overlay's `roles` name, and `sand`, the lines' paint (none is a status color). */
export const FOG_HEX = '#c9ced8';
export const DIM_HEX = '#3d4b6e';
/**
 * A physical-basis `look@1` with tone map none at the exposure whose scale is 1 (#424's acceptance look), no bloom, no
 * deband, no finish, with this suite's roles `fog`, `dim` and `sand` beside the ground and ink.
 */
export const LOOK: JsonObject = {
  id: 'look-537-plain', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'A #537 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', fogcloud: FOG_HEX, dusk: DIM_HEX, sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', fog: 'fogcloud', dim: 'dusk', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'none', exposure: -Math.log2(1.2), finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { ...STATUS }, status_treatment: { core_min_px: 4, glyph: { ...GLYPHS } }, min_distance: 0.1,
  attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

export const AGENT = 'agent:sess-537';
export const SEED = 537;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #537 acceptance tests.' };
const REQUIRES: JsonObject = { modules: { scene3d: '^1', logic: '^1' } };
function ordered(items: Record<string, JsonObject>, layer: boolean): JsonObject {
  const out: JsonObject = {};
  let order = 0;
  for (const [key, item] of Object.entries(items)) out[key] = { id: key, name: key, order: `a${String(order++).padStart(3, '0')}`, ...(layer ? { layer: 'main' } : {}), ...item };
  return out;
}
/** A scene as a session holds it, for `view3d` (#378): an `id`, one writer layer, its seed, the camera `cam`. */
export function sessionDoc(id: string, size: [number, number], items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id, profile: 'scene', title: id, description: `${id}: a #537 acceptance fixture.`, size, seed: SEED, camera: 'cam', transport: { span: '12s', frame_rate: [60, 1] },
    requires: REQUIRES, layers: { main: { writer: AGENT, title: 'main', order: 'a0' } }, ...extra, items: ordered(items, true),
  };
}
/** The same scene in the agent's form, for `deep_show` (#393): no `id`, no layers; each program listed in `assets`. */
export function agentDoc(title: string, size: [number, number], items: Record<string, JsonObject>, programs: Program[], extra: JsonObject = {}): JsonObject {
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #537 acceptance fixture.`, size, seed: SEED, camera: 'cam', transport: { span: '12s', frame_rate: [60, 1] },
    requires: REQUIRES, ...extra, items: ordered(items, false),
    assets: Object.fromEntries(programs.map((p) => [`${p.name}_program`, { sha256: p.sha, license: LICENSE }])),
  };
}

export type V3 = [number, number, number];
/** An orthographic `camera@1` straight above `target`, `width` m across the frame. Looking straight down, the core's
 * screen basis keeps +X to the right, so screen down is +Z (deep_canvas::camera::screen_basis). */
export const topDown = (target: V3, width: number): JsonObject =>
  ({ kind: 'camera@1', params: { projection: 'orthographic', position: [target[0], target[1] + 50, target[2]], target, view_width: width, near: 1, far: 200 } });
/** The pixel (fractional) of world point (x, z) under `topDown([tx, 0, tz], width)` at `size`. */
export const topDownPx = (size: [number, number], target: V3, width: number, x: number, z: number): [number, number] =>
  [size[0] / 2 + (x - target[0]) * (size[0] / width), size[1] / 2 + (z - target[2]) * (size[0] / width)];
export const material = (params: JsonObject): JsonObject => ({ kind: 'material@1', params });
/** A black sky with no ambient: the suns are the only light, the background reads 0. */
export const DARK_SKY: JsonObject = { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } };
/** A sun (`light.sun@1`), shining along its own −Z, aimed by `at.rot` (R = Rz·Ry·Rx, degrees), casting no shadow. */
export const sun = (illuminance: number, rot: V3): JsonObject => ({ kind: 'light.sun@1', params: { illuminance, color: [1, 1, 1], shadow: false }, at: { rot } });
/** A logic item (Logic `logic@1`): its program by SHA-256 at 60 steps a second, writing `writes` in declaration order. */
export function logicItem(program: Program, writes: [string, string, number][]): JsonObject {
  return { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: [], writes: Object.fromEntries(writes.map(([n, type, count]) => [n, { type, count }])) } };
}
/** A logic column (Instance `instance@1`: logic columns): `{array: <logic>.<name>, as}`. */
export const column = (path: string, as: string): JsonObject => ({ array: path, as });

// ---------------------------------------------------------------------------------------------------
// Timing: the perf lane's rule, scripts/benchmark.mjs's judgeLimit and fingerprint imported, never copied (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end under the cores).

export const load = (): number => loadavg()[0]!;
export async function judgeLimit(limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
export const median = (values: number[]): number => { const s = [...values].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
/** This Mac's model, for messages. */
export function hwModel(): string {
  try { return execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'unknown'; }
}
