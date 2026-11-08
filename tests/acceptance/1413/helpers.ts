// Test-side tools for the #1413 acceptance tests: `deep-gpu` (#377's binary) built once with the
// `test-faults` feature and driven by JSON lines; the documents the `live` sessions open, generated here; the
// readers of the replies this suite's criteria look at; PNG reading and #157's blank guard; and the checks the
// criteria's planted programs must fail, each returning its failures as sentences that name what failed.
// Nothing here stands in for the device, the error reporter, the reopen path or the slots under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1413 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BIN = 'deep-gpu';
const UPLIFTED = join(REPO, 'target', 'debug', BIN);
/** The one feature set every file builds (README: Builds). */
export const FEATURES = 'test-faults';

// ---------------------------------------------------------------------------------------------------
// The criteria's numbers.

/** "1,000 identical device errors in a second". */
export const ERRORS = 1000;
export const ERRORS_WITHIN_MS = 1000;
/** This job's ceiling on the reported burst: a limit that lets most of 1,000 lines through limits nothing (README). */
export const BURST_CEILING = 100;
/** "three reopen attempts", "At most 3 reopens happen in 10 s". */
export const REOPENS = 3;
export const REOPEN_WINDOW_MS = 10_000;
/** "a non-blank placeholder within 2 s". */
export const PLACEHOLDER_WITHIN_S = 2;
/** "Ten failures in a row". */
export const RESIZE_FAILURES = 10;
/** "then 50 validation errors that use it". */
export const LATER_ERRORS = 50;
/** #157's film.blank: luma ≤ 0.06 over ≥ 98% of the frame; and flat: ≥ 98% of pixels in one luma window 3 codes wide. */
export const BLANK_LUMA = 0.06;
export const BLANK_COVERAGE = 0.98;
export const FLAT_WINDOW = 3;

/** The live call's clock in these tests. */
export const FPS = 60;
/** A buffer over the device's memory: twice the Mac's unified memory, which the GPU shares (README: test.alloc@1). */
export const OVER_MEMORY_BYTES = 2 * totalmem();
export const MIB = 2 ** 20;

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe('boolean');
  return value as boolean;
}
const optStr = (v: JsonValue | undefined, what: string): string | null => (v === undefined || v === null ? null : str(v, what));
const optNum = (v: JsonValue | undefined, what: string): number | null => (v === undefined || v === null ? null : num(v, what));
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Every test here reads a real device: macOS's Metal device. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`these criteria need a real device (macOS's Metal); this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu --features test-faults`, once per file, copied out under its own name.

export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    const args = ['build', '--locked', '--bin', BIN, '--features', FEATURES];
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    dir = mkdtempSync(join(tmpdir(), 'deep-1413-bin-'));
    if (error === '') copyFileSync(UPLIFTED, join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo build --locked --bin ${BIN} --features ${FEATURES}`).toBe('');
    return join(dir, BIN);
  };
}

/** A folder for the file's runs (documents in, captures out), deleted after the file. */
export function useDir(): () => string {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1413-')); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: `deep-gpu run [--fail-reopen <n | always>] [--planted <name>]`, one scenario in, one line out.

/** The wrong programs, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'keeps_latest_error' | 'reopens_tight_loop' | 'resize_leaves_rendering';
export interface Startup { failReopen?: number | 'always'; planted?: Planted }
export const startArgs = (s: Startup = {}): string[] => [
  'run',
  ...(s.failReopen !== undefined ? ['--fail-reopen', String(s.failReopen)] : []),
  ...(s.planted ? ['--planted', s.planted] : []),
];

export interface Started { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string; replies: JsonObject[] | null; answer: JsonValue | null }

/** One scenario `{out, calls}` in a fresh process; the answer's replies when it was `{ok: true, replies}`. */
export function start(bin: string, out: string, calls: JsonObject[], startup: Startup = {}, timeoutMs = 1_800_000): Started {
  const run = spawnSync(bin, startArgs(startup), { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${BIN} ${startArgs(startup).join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '');
  let answer: JsonValue | null = null;
  try { answer = lines.length ? (JSON.parse(lines[0]!) as JsonValue) : null; } catch { answer = lines[0] ?? null; }
  const replies = isObject(answer ?? undefined) && (answer as JsonObject)['ok'] === true && Array.isArray((answer as JsonObject)['replies'])
    ? ((answer as JsonObject)['replies'] as JsonValue[]).filter(isObject) : null;
  return { status: run.status, signal: run.signal, timedOut, stdout, stderr: run.stderr ?? '', replies, answer };
}

/** One scenario, accepted and exited 0, with one reply per call. */
export function run(bin: string, out: string, calls: JsonObject[], startup: Startup = {}, timeoutMs?: number): { replies: JsonObject[]; stderr: string } {
  requireMetal();
  const s = start(bin, out, calls, startup, timeoutMs);
  const shown = `${BIN} ${startArgs(startup).join(' ')}`;
  expect(s.timedOut, `${shown} finished within its timeout`).toBe(false);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.replies, `${shown} answered {ok: true, replies}: ${s.stdout.slice(0, 2000)}`).not.toBeNull();
  expect(s.replies!.length, `${shown}: one reply per call`).toBe(calls.length);
  return { replies: s.replies!, stderr: s.stderr };
}

/** A reply that is answered, not refused; `unsupported_platform` is INCONCLUSIVE. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} answered unsupported_platform`);
  expect(reply['code'], `${what} is answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// Documents for the `live` call (#379's: #393's deep_show payload), written under the file's folder.

export const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;
export const W = { alpha: 'agent:alpha', bravo: 'agent:bravo' } as const;
/** Each view's size in the live window: small, so a frame's read-back and a PNG are cheap. */
export const VIEW: [number, number] = [320, 240];

/** `test.alloc@1` (README: The test kinds): one GPU buffer labeled `label` of `bytes`, built as its revision latches, then used `uses` times. */
export const alloc = (id: string, label: string, bytes: number, uses = 0): JsonObject => ({
  id, kind: 'test.alloc@1', name: `Alloc ${id}`, order: 'c0', params: { label, bytes, uses },
});
/** `test.pipeline@1`: one render pipeline labeled `label`, built as its revision latches. */
export const pipeline = (id: string, label: string): JsonObject => ({
  id, kind: 'test.pipeline@1', name: `Pipeline ${id}`, order: 'c1', params: { label },
});

/** A 3D document: a camera and four boxes, one sliding over the 60 s span so every frame differs; plus `items`. */
export function sceneDoc(title: string, items: Record<string, JsonObject> = {}): JsonObject {
  const all: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 14 }, fov: 40 } },
  };
  for (let i = 0; i < 4; i++) {
    all[`box-${i}`] = {
      id: `box-${i}`, kind: 'mark.box@1', name: `Box ${i}`, order: `b${String(i).padStart(3, '0')}`,
      params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [i * 2.5 - 3.75, 0.5, 0] },
    };
  }
  Object.assign(all, items);
  const test = Object.keys(items).length > 0;
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1413 acceptance fixture.`, size: VIEW, camera: 'cam',
    requires: { modules: { scene3d: '^1', ...(test ? { 'test.gpu': '^1' } : {}) } },
    budget: { class: 'figure' },
    transport: { span: '60s' },
    channels: { slide: { target: 'items/box-0/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -3.75, interp: 'linear' }, k1: { t: '60s', value: 3.75, interp: 'linear' } } } },
    items: all,
  };
}

export function writeDoc(dir: string, name: string, doc: JsonObject): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

export interface Open { session: string; writer: string; doc: string }
export type LiveEvent =
  | { frame: number; revise: { session: string; doc: string } }
  | { frame: number; lose_device: { during?: string } }
  | { frame: number; gpu_change: Record<string, never> };
export interface LiveSpec { frames: number; sessions: Open[]; events?: LiveEvent[]; report?: ('hashes' | 'errors')[]; capture?: number[] }

/**
 * The `live` call. Every writer is charged a steady 0.75 ms GPU and 3 ms CPU by #379's stub meter, under its
 * figure class's limits and without headroom, so no rung moves for frame health or climbs: the only rung
 * changes are the ones under test, and a view draws the same pixels whatever the machine's load.
 */
export function liveCall(spec: LiveSpec): JsonObject {
  const writers: JsonObject = {};
  for (const s of spec.sessions) writers[s.writer] = [{ from: 1, gpu_ms: 0.75, cpu_ms: 3 }];
  return {
    call: 'live', look: LOOK, fps: FPS, frames: spec.frames, sessions: spec.sessions as unknown as JsonValue,
    events: (spec.events ?? []) as unknown as JsonValue, report: spec.report ?? [], stub_meter: { writers },
    ...(spec.capture ? { capture: spec.capture } : {}),
  };
}

export interface View { session: string; writer: string; rung: string; drawn: boolean; settled: boolean; pixel_hash: string | null; final: string | null }
export interface Frame { frame: number; views: View[]; error_scopes: number | null }
export interface Change { frame: number; session: string; writer: string; from: string | null; to: string; reason: string }
export interface Told { frame: number; session: string; writer: string; rung: string; reason: string }
export interface Revision { rev: number; outcome: string; issues: JsonObject[] }
export interface SessionRow { session: string; writer: string; state: string; issues: JsonObject[]; revisions: Revision[] }
export interface WriterError { frame: number; session: string; writer: string; code: string; label: string | null; bytes: number | null; later_validation: number; appended: JsonObject[] }
export interface Reopen { frame: number; ms: number; ok: boolean; thread: string }
export interface Live { frames: Frame[]; changes: Change[]; told: Told[]; sessions: SessionRow[]; writer_errors: WriterError[]; reopens: Reopen[]; device_losses: number }

/** Parses a `live` reply, failing at the first missing or mistyped field this suite reads. */
export function liveReply(reply: JsonObject, what = 'the live call'): Live {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i): Frame => {
    const o = obj(f, `${what}: frames[${i}]`);
    const at = `${what}: frame ${o['frame']}`;
    return {
      frame: num(o['frame'], `${what}: frames[${i}].frame`),
      error_scopes: o['error_scopes'] === undefined ? null : num(o['error_scopes'], `${at}: error_scopes`),
      views: arr(o['views'], `${at}: views`).map((v, j): View => {
        const w = obj(v, `${at}: views[${j}]`);
        return {
          session: str(w['session'], `${at}: views[${j}].session`), writer: str(w['writer'], `${at}: views[${j}].writer`),
          rung: str(w['rung'], `${at}: views[${j}].rung`), drawn: w['drawn'] === true, settled: w['settled'] !== false,
          pixel_hash: optStr(w['pixel_hash'], `${at}: views[${j}].pixel_hash`), final: optStr(w['final'], `${at}: views[${j}].final`),
        };
      }),
    };
  });
  const changes = arr(reply['changes'], `${what}: changes`).map((c, i): Change => {
    const o = obj(c, `${what}: changes[${i}]`);
    return { frame: num(o['frame'], `changes[${i}].frame`), session: str(o['session'], `changes[${i}].session`), writer: str(o['writer'], `changes[${i}].writer`), from: optStr(o['from'], `changes[${i}].from`), to: str(o['to'], `changes[${i}].to`), reason: str(o['reason'], `changes[${i}].reason`) };
  });
  const told = arr(reply['told'], `${what}: told`).map((c, i): Told => {
    const o = obj(c, `${what}: told[${i}]`);
    return { frame: num(o['frame'], `told[${i}].frame`), session: str(o['session'], `told[${i}].session`), writer: str(o['writer'], `told[${i}].writer`), rung: String(o['rung'] ?? ''), reason: String(o['reason'] ?? '') };
  });
  const sessions = arr(reply['sessions'], `${what}: sessions`).map((s, i): SessionRow => {
    const o = obj(s, `${what}: sessions[${i}]`);
    return {
      session: str(o['session'], `sessions[${i}].session`), writer: str(o['writer'], `sessions[${i}].writer`), state: str(o['state'], `sessions[${i}].state`),
      issues: arr(o['issues'], `sessions[${i}].issues`).map((x, j) => obj(x, `sessions[${i}].issues[${j}]`)),
      revisions: arr(o['revisions'], `sessions[${i}].revisions`).map((r, j) => {
        const q = obj(r, `sessions[${i}].revisions[${j}]`);
        return { rev: num(q['rev'], `revisions[${j}].rev`), outcome: str(q['outcome'], `revisions[${j}].outcome`), issues: arr(q['issues'] ?? [], `revisions[${j}].issues`).map((x) => obj(x, 'an issue')) };
      }),
    };
  });
  const writer_errors = arr(reply['writer_errors'], `${what}: writer_errors`).map((e, i): WriterError => {
    const o = obj(e, `${what}: writer_errors[${i}]`);
    const at = `${what}: writer_errors[${i}]`;
    return {
      frame: num(o['frame'], `${at}.frame`), session: str(o['session'], `${at}.session`), writer: str(o['writer'], `${at}.writer`), code: str(o['code'], `${at}.code`),
      label: optStr(o['label'], `${at}.label`), bytes: optNum(o['bytes'], `${at}.bytes`), later_validation: num(o['later_validation'], `${at}.later_validation`),
      appended: arr(o['appended'], `${at}.appended`).map((x, j) => obj(x, `${at}.appended[${j}]`)),
    };
  });
  const reopens = arr(reply['reopens'], `${what}: reopens`).map((r, i): Reopen => {
    const o = obj(r, `${what}: reopens[${i}]`);
    return { frame: num(o['frame'], `reopens[${i}].frame`), ms: num(o['ms'], `reopens[${i}].ms`), ok: bool(o['ok'], `reopens[${i}].ok`), thread: str(o['thread'], `reopens[${i}].thread`) };
  });
  return { frames, changes, told, sessions, writer_errors, reopens, device_losses: num(reply['device_losses'], `${what}: device_losses`) };
}

/** The view a frame shows for a session, or a failure naming the frame. */
export function viewOf(frame: Frame, session: string): View {
  const v = frame.views.find((x) => x.session === session);
  expect(v, `frame ${frame.frame} has a view of ${session}`).toBeDefined();
  return v!;
}
export const sessionOf = (live: Live, session: string): SessionRow => {
  const s = live.sessions.find((x) => x.session === session);
  expect(s, `the reply has a session row for ${session}`).toBeDefined();
  return s!;
};

/** The UI thread's name in the live reply (#379's `ui_thread`). */
export const UI_THREAD = 'main';

/**
 * The reopen bound (criterion 6): at most 3 reopen attempts within 10 s of the loss, each off the UI thread.
 * Failures name the count.
 */
export function reopenProblems(reopens: Reopen[]): string[] {
  const out: string[] = [];
  const within = reopens.filter((r) => r.ms <= REOPEN_WINDOW_MS);
  if (within.length > REOPENS) out.push(`${within.length} reopens happened in ${REOPEN_WINDOW_MS / 1000} s, more than ${REOPENS}`);
  for (const r of reopens.filter((x) => x.thread === UI_THREAD)) out.push(`the reopen at ${r.ms.toFixed(0)} ms ran on the UI thread`);
  return out;
}

/**
 * The cause a writer must be told (criterion 12): `out_of_memory` naming the label and the requested bytes, with the
 * later validation errors counted, not reported. Failures name what the writer was told instead.
 */
export function causeProblems(e: WriterError | undefined, label: string, bytes: number, later: number): string[] {
  if (!e) return ['the writer was told no error'];
  const out: string[] = [];
  if (e.code !== 'out_of_memory') out.push(`the writer's error is ${e.code}, not out_of_memory`);
  if (e.label !== label) out.push(`the writer's error names ${JSON.stringify(e.label)}, not the buffer ${label}`);
  if (e.bytes !== bytes) out.push(`the writer's error names ${e.bytes} bytes, not the ${bytes} requested`);
  if (e.later_validation !== later) out.push(`the writer's error counts ${e.later_validation} later validation errors, not ${later}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The `frames`, `surface` and `raise_errors` calls (#377's, with this suite's fields).

export const SCENE = join(HERE, 'fixtures', 'surface-handoff.scene');
interface SceneFile { size: [number, number]; window: [number, number]; resize: { every: number; sizes: [number, number][] } }
export const SCENE_FILE = JSON.parse(readFileSync(SCENE, 'utf8')) as SceneFile;
/** The size the scene's schedule gives frame n with `resize` on. */
export const sizeAt = (n: number): [number, number] => SCENE_FILE.resize.sizes[Math.floor(n / SCENE_FILE.resize.every) % SCENE_FILE.resize.sizes.length]!;

export interface FramesSpec { from?: number; count: number; layer?: boolean; resize?: boolean; card?: JsonObject; capture?: 'every'; window_hash?: boolean; fail_resize?: number }
export const framesCall = (c: FramesSpec): JsonObject => ({ call: 'frames', scene: SCENE, ...(c as unknown as JsonObject) });
export const SURFACE: JsonObject = { call: 'surface' };

export interface SceneFrame { frame: number; size: [number, number]; drawn: boolean; shown_frame: number | null; pixel_hash: string | null; window: string | null; window_hash: string | null }
export function framesReply(reply: JsonObject, what = 'the frames call'): { frames: SceneFrame[]; device_losses: number } {
  answered(reply, what);
  const frames = arr(reply['frames'], `${what}: frames`).map((v, i): SceneFrame => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frame ${f['frame']}`;
    return {
      frame: num(f['frame'], `${what}: frames[${i}].frame`),
      size: arr(f['size'], `${at}: size`).map((s) => num(s, `${at}: size`)) as [number, number],
      drawn: bool(f['drawn'], `${at}: drawn`), shown_frame: optNum(f['shown_frame'], `${at}: shown_frame`),
      pixel_hash: optStr(f['pixel_hash'], `${at}: pixel_hash`), window: optStr(f['window'], `${at}: window`), window_hash: optStr(f['window_hash'], `${at}: window_hash`),
    };
  });
  return { frames, device_losses: num(reply['device_losses'], `${what}: device_losses`) };
}
export function surfaceReply(reply: JsonObject, what = 'the surface call'): { slots: string[]; rebuilds: number } {
  answered(reply, what);
  return {
    slots: arr(reply['slots'], `${what}: slots`).map((s, i) => str(obj(s, `${what}: slots[${i}]`)['state'], `${what}: slots[${i}].state`)),
    rebuilds: num(reply['rebuilds'], `${what}: rebuilds`),
  };
}

/** The slot check (criterion 9): after a failed resize no slot is left `rendering`, and nothing counts as a rebuild. */
export function slotProblems(surface: { slots: string[]; rebuilds: number }): string[] {
  const out = surface.slots.flatMap((s, i) => (s === 'rendering' ? [`slot ${i} is left rendering`] : []));
  if (surface.rebuilds !== 0) out.push(`the view reads rebuilds ${surface.rebuilds}, not 0`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// PNG reading and #157's blank guard.

export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace. */
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

/** A PNG the binary wrote under `out`, named by its SHA-256 (`<name>.png`). */
export function readNamed(out: string, name: string | null, what: string): Image {
  expect(name, `${what} is written, named by a SHA-256`).toMatch(/^[0-9a-f]{64}$/);
  const file = readFileSync(join(out, `${name}.png`));
  expect(sha256(file), `${what}'s file hashes to its name`).toBe(name);
  return decodePng(file);
}

/**
 * #157's blank guard over a region: blank (luma ≤ 0.06 over at least 98% of its pixels) or flat (at least 98% of its
 * pixels in one luma window 3 code values wide). Luma: Rec. 709 weights on the 8-bit encoded values. Returns the
 * reasons the picture fails it, empty when it passes.
 */
export function blankGuard(image: Image, region?: [number, number, number, number]): string[] {
  const [x0, y0, w, h] = region ?? [0, 0, image.width, image.height];
  const hist = new Array<number>(256).fill(0);
  let dark = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const o = (y * image.width + x) * 4;
    const code = 0.2126 * image.rgba[o]! + 0.7152 * image.rgba[o + 1]! + 0.0722 * image.rgba[o + 2]!;
    if (code / 255 <= BLANK_LUMA) dark++;
    hist[Math.min(255, Math.round(code))]!++;
  }
  const n = w * h;
  const out: string[] = [];
  if (dark / n >= BLANK_COVERAGE) out.push(`blank: ${((dark / n) * 100).toFixed(2)}% of its pixels at luma ≤ ${BLANK_LUMA}`);
  let best = 0; let at = 0;
  for (let lo = 0; lo + FLAT_WINDOW <= 256; lo++) {
    let s = 0;
    for (let k = lo; k < lo + FLAT_WINDOW; k++) s += hist[k]!;
    if (s > best) { best = s; at = lo; }
  }
  if (best / n >= BLANK_COVERAGE) out.push(`flat: ${((best / n) * 100).toFixed(2)}% of its pixels in luma codes ${at}–${at + FLAT_WINDOW - 1}`);
  return out;
}
