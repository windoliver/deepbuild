// Test-side tools for the #3023 acceptance tests: `deep-gpu` built as the issue says (`cargo build --locked --bin
// deep-gpu --features test-meter`), driven by one JSON line (`deep-gpu run`), and the documents its `live` calls open.
// Copied from #425's and #379's helpers (suites don't import each other); nothing here stands in for the seal.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3023 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

// ---------------------------------------------------------------------------------------------------
// JSON

export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(typeof value === 'object' && value !== null && !Array.isArray(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Writes `value` as JSON under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, `${name}.json`);
  writeFileSync(path, JSON.stringify(value));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The machine

/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A live session on Metal draws on macOS's Metal device, the reference platform. */
export function requireMetal(): void {
  if (process.platform !== 'darwin') inconclusive(`a live session draws on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-gpu --features test-meter`, once per file, copied out of the target.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
export const CARGO_ARGS = ['build', '--locked', '--bin', 'deep-gpu', '--features', 'test-meter'];
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds the test-meter `deep-gpu` before the file's tests; a test that uses it fails with cargo's error if it failed. */
export function useTestMeterBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-3023-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', exe('deep-gpu')), join(dir, exe('deep-gpu-test-meter')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, exe('deep-gpu-test-meter'));
  };
}
/** A fresh temporary folder per test (documents, outputs), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-3023-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run [--backend noop]`: one JSON line in (`{out, calls}`), one JSON line out (#377).

export interface Startup { backend?: 'noop' }

/** One process: the calls in order, a reply per call. The process neither panics at the seal nor exits non-zero. */
export function runGpu(bin: string, out: string, calls: JsonObject[], startup: Startup = {}): JsonObject[] {
  const args = ['run', ...(startup.backend ? ['--backend', startup.backend] : [])];
  const name = `deep-gpu ${args.join(' ')}`;
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, args, { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const panic = stderr.split('\n').filter((l) => /panicked|list_unclosed|SealError/.test(l)).join('\n').slice(0, 3000);
  expect(/list_unclosed/.test(stderr), `${name} panics at the seal with list_unclosed:\n${panic}`).toBe(false);
  expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${stderr.slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}
/** A reply that holds no refusal `code`; INCONCLUSIVE when the platform can't draw it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  return reply;
}

// ---------------------------------------------------------------------------------------------------
// The live call (#379) and the documents its sessions open

/** A physical-basis `look@1` (#421's shape, as #425's suite sends it), filmic at exposure 0. */
export const LOOK: JsonObject = {
  id: 'look-3023', format: 1, basis: 'physical', license: 'Apache-2.0', description: 'The #3023 acceptance look.',
  palette: { night: '#101114', graphite: '#1b1d22', slate: '#8b8f97', stone: '#d9dde3', sand: '#e6d3a3' },
  roles: { ground: 'night', ink: 'graphite', muted: 'slate', stone: 'stone', sand: 'sand' },
  themes: { light: {}, dark: {} },
  fonts: {
    body: { family: 'Inter', file: 'Inter-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
    mono: { family: 'JetBrains Mono', file: 'JetBrainsMono-Regular.ttf', license: 'OFL-1.1', embed: true, single_line: false },
  },
  tone_map: 'filmic', exposure: 0, finish: [], deband: 'none', bloom: 'none', ground_3d: { kind: 'none' },
  status: { pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600', running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464' },
  status_treatment: { core_min_px: 4, glyph: { pass: '✓', fail: '✗', invalid: '⊘', blocked: '■', inconclusive: '?', running: '↻', needs_you: '!', stale: '◇', idle: '○' } },
  min_distance: 0.1, attention_treatment: { line: 'dashed', role: 'ink', glyph: '⚠' }, legend: 'auto',
};

export const ALPHA = 'agent:alpha';
export const LIVE_SIZE: [number, number] = [480, 320];

/** A scene as its writer sends it (#393's payload: no `id`, no `layers`): boxes on a ground under a casting sun, and
 * `extra` items. `orbiting` turns its camera by a channel, else a channel slides one box and the view stays still.
 * With no extra items it is #425's showpiece, item for item. */
export function scene(orbiting: boolean, budgetClass: string, extra: Record<string, JsonObject> = {}): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 30, distance: 12 }, fov: 40 } },
    stone: { id: 'stone', kind: 'material@1', name: 'Stone', order: 'a1', params: { base_color: [0.6, 0.6, 0.6, 1], roughness: 0.8 } },
    ground: { id: 'ground', kind: 'mark.box@1', name: 'Ground', order: 'a2', params: { size: [20, 0.2, 20] }, at: { pos: [0, -0.1, 0] }, material: 'stone' },
    sun: { id: 'sun', kind: 'light.sun@1', name: 'Sun', order: 'a3', params: { illuminance: 3, shadow: true }, at: { rot: [-55, 30, 0] } },
  };
  for (let i = 0; i < 6; i++) {
    items[`box-${i}`] = { id: `box-${i}`, kind: 'mark.box@1', name: `Box ${i}`, order: `b${i}`, params: { size: [1, 1 + (i % 3), 1] }, at: { pos: [(i % 3) * 2.5 - 2.5, (1 + (i % 3)) / 2, Math.floor(i / 3) * 2.5 - 1.25] }, material: 'stone' };
  }
  Object.assign(items, extra);
  const testKinds = Object.values(extra).some((it) => typeof it['kind'] === 'string' && it['kind'].startsWith('test.'));
  const channels = orbiting
    ? { orbit: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 30, interp: 'linear' }, k1: { t: '60s', value: 390, interp: 'linear' } } } }
    : { slide: { target: 'items/box-0/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -2.5, interp: 'linear' }, k1: { t: '60s', value: 2.5, interp: 'linear' } } } };
  return {
    format: 1, profile: 'scene', title: 'A #3023 scene', description: 'A #3023 acceptance fixture.', size: LIVE_SIZE, camera: 'cam',
    requires: { modules: { scene3d: '^1', ...(testKinds ? { 'test.gpu': '^1' } : {}) } }, budget: { class: budgetClass }, transport: { span: '60s' }, items, channels,
  };
}
/** The test module's texture (`test.gpu`'s `test.texture@1`, in `test-meter` builds only) with all its mips, as #379's
 * suite places it. */
export const texture = (id: string, size: [number, number], pattern: string): JsonObject => ({
  id, kind: 'test.texture@1', name: `Texture ${id}`, order: 'c0', params: { size, format: 'rgba8', mips: 'all', pattern }, at: { pos: [0, 2, 0] },
});

/** A stub meter's charge for a writer over frames `from` … `to` (to the end when `to` is absent). */
export interface Charge { from: number; to?: number; gpu_ms: number }
export interface LiveSpec { doc: string; frames: number; charges: Charge[] }
/** One session, `s`, of ALPHA's document at LIVE_SIZE, its writer charged by the stub meter (#425's live call). */
export const liveCall = (l: LiveSpec): JsonObject => ({
  call: 'live', look: LOOK, frames: l.frames, fps: 60, sessions: [{ session: 's', writer: ALPHA, doc: l.doc, size: LIVE_SIZE }],
  events: [], stub_meter: { writers: { [ALPHA]: l.charges as unknown as JsonValue } },
});
/** A fresh process's canonical render of `doc`'s frame 10, with no live session (#379's `canonical` call). */
export const canonicalCall = (doc: string, purpose: 'render_back' | 'export'): JsonObject =>
  ({ call: 'canonical', look: LOOK, writer: ALPHA, doc, size: LIVE_SIZE, frame: 10, purpose });

/** What the tests read of a live reply: the session `s`'s state and first revision, and each frame's view of it. */
export interface Opened { state: string; outcome: string; issues: JsonValue; frames: number[]; withView: number[] }
export function openedOf(reply: JsonObject, what: string): Opened {
  answered(reply, what);
  const row = arr(reply['sessions'], `${what}: sessions`).map((r, i) => obj(r, `${what}: sessions[${i}]`)).find((r) => r['session'] === 's');
  const s = obj(row, `${what}: the session s's row`);
  const first = obj(arr(s['revisions'], `${what}: s's revisions`)[0], `${what}: s's first revision`);
  const frames = arr(reply['frames'], `${what}: frames`).map((f, i) => obj(f, `${what}: frames[${i}]`));
  return {
    state: String(s['state']), outcome: String(first['outcome']), issues: first['issues'] ?? null,
    frames: frames.map((f) => Number(f['frame'])),
    withView: frames.filter((f) => arr(f['views'], `${what}: frame ${String(f['frame'])}: views`).some((v) => obj(v, 'a view')['session'] === 's')).map((f) => Number(f['frame'])),
  };
}
