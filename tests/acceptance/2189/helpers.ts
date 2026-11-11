// Test-side tools for the #2189 acceptance tests: `deep-gpu` (#377's binary) built for release and driven by JSON
// lines on this Mac's own Metal GPU, with #1903's `envelope` call (no stub meter, no `--backend noop`); the documents
// it plays (#1903's every-pass scene, copied from its evidence, and #1903's `separate-items` with its instanced twin);
// and the reply's parsers. Nothing here stands in for the envelope, the check, its estimate, the renderer or the device.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import {
  LOOK, WRITER, arr, instancedTwinDoc, isObject, obj, separateItemsDoc, writeDoc, type JsonObject, type JsonValue,
} from '../1903/helpers.ts';

export type { JsonObject };
export { isObject, obj };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2189 is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const BIN = 'deep-gpu';
/** Release: full-screen frames in a debug build are slow, and no stub is wanted. */
const BUILD = ['build', '--locked', '--release', '--bin', BIN];

// ---------------------------------------------------------------------------------------------------
// The criteria's numbers.

/** Full screen on the reference display, as #1903's evidence ran it: 3456 × 2234. */
export const FULL_SCREEN: [number, number] = [3456, 2234];
/** Criterion 2's size. */
export const SMALL: [number, number] = [1280, 800];
/** The showpiece class's GPU memory per window (the budget class table): 256 MB, as `cap_bytes` names it. */
export const CAP_BYTES = 256_000_000;
/** The device's allocated size at its peak for the every-pass scene at full screen on the Mac17,10: the scene row's
 * `gpu_memory.peak_bytes` in `docs/evidence/1903/envelope.json` at the base (the issue's "659 MB"). */
export const DEVICE_PEAK_BYTES = 659_161_088;
/** "Within 10%". */
export const WITHIN = 0.1;
/** A short run: each fixture's five timed runs are 1 s each, 60 frames at noop's or the device's 60 Hz clock. */
const SECONDS = 1;
export const SCENE = 'scene';
export const SEPARATE_ITEMS = 'separate-items';

/** |value − of| ≤ 10% of `of`. */
export const within = (value: number, of: number): boolean => Math.abs(value - of) <= WITHIN * of;

// ---------------------------------------------------------------------------------------------------
// The documents.

/** #1903's every-pass scene, exactly as its evidence played it (`docs/evidence/1903/envelope.json`'s `scene`, made by
 * `docs/evidence/1903/run.mts`), copied at the base: a showpiece whose camera orbits over 60 s, with a sky, a shadowed
 * sun and lamp, a mirror floor, a patterned material, a 400-element instancer and a lens flare. */
const everyPassScene = (): JsonObject => JSON.parse(readFileSync(join(HERE, 'fixtures', 'every-pass.json'), 'utf8')) as JsonObject;

/** An `envelope` call (#1903) of the every-pass scene, with `separate-items` and its instanced twin when `separate`,
 * each a document written under `dir`, played on the device at `pixels`, no first frame wait. */
export function envelopeCall(dir: string, pixels: [number, number], separate: boolean): JsonObject {
  return {
    call: 'envelope', look: LOOK, writer: WRITER, store: join(dir, 'store'), scene: writeDoc(dir, 'every-pass', everyPassScene()),
    ...(separate ? { separate_items: { doc: writeDoc(dir, 'separate-items', separateItemsDoc()), instanced: writeDoc(dir, 'separate-items-instanced', instancedTwinDoc()) } } : {}),
    render: { seconds: SECONDS, pixels }, first_frame_wait: false,
  };
}

// ---------------------------------------------------------------------------------------------------
// The build: release `deep-gpu`, built once per file, on macOS only.

/** Builds `deep-gpu` for release once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useRelease(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    if (process.platform !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-2189-bin-'));
    const run = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const target = process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${BUILD.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(target, 'release', BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${BUILD.join(' ')}`).toBe('');
    return join(dir, BIN);
  };
}

/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2189-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running on Metal: `deep-gpu run` (no `--backend`, so this Mac's GPU), one scenario, one reply per call.

/** The replies, or why nothing was measured: off macOS, or with no Metal device, a test is INCONCLUSIVE, never passed. */
export type OnMetal = { skip: string } | { replies: JsonObject[] };

export function onMetal(bin: () => string, out: string, calls: JsonObject[]): OnMetal {
  if (process.platform !== 'darwin') return { skip: `INCONCLUSIVE (not measured: the criteria are on Metal, and this is ${process.platform})` };
  const path = bin();
  const shown = `${BIN} run`;
  const s = spawnSync(path, ['run'], {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  const timedOut = s.error !== undefined && (s.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${shown} finished within its timeout`).toBe(false);
  if (s.error) throw Error(`${shown}: ${s.error.message}`);
  const lines = (s.stdout ?? '').split('\n').filter((l) => l !== '');
  let first: JsonValue = null;
  try { first = JSON.parse(lines[0] ?? 'null') as JsonValue; } catch { first = lines[0] ?? null; }
  // #377: a binary that finds no device answers one line {"ok": false, "code": "no_device", "reason"} and exits 1.
  if (s.status === 1 && isObject(first) && first['ok'] === false && first['code'] === 'no_device') {
    return { skip: `INCONCLUSIVE (not measured: no Metal device: ${JSON.stringify(first['reason'])})` };
  }
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${(s.stdout ?? '').slice(0, 1500)}; stderr: ${(s.stderr ?? '').slice(-3000)}`).toBe(0);
  expect(lines.length, `${shown}: one output line per input line`).toBe(1);
  const a = obj(first, `${shown}: the answer`);
  expect(a['ok'], `${shown} accepted the scenario: ${JSON.stringify(a).slice(0, 2000)}`).toBe(true);
  const replies = arr(a['replies'], `${shown}: replies`).map((r, i) => obj(r, `${shown}: replies[${i}]`));
  expect(replies.length, `${shown}: one reply per call`).toBe(calls.length);
  const lost = replies.find((r) => r['code'] === 'no_device');
  if (lost !== undefined) return { skip: `INCONCLUSIVE (not measured: the device could not be had: ${JSON.stringify(lost).slice(0, 600)})` };
  return { replies };
}

// ---------------------------------------------------------------------------------------------------
// The reply's parts the criteria read.

const sameSize = (v: JsonValue | undefined, size: [number, number]): boolean => Array.isArray(v) && v.length === 2 && v[0] === size[0] && v[1] === size[1];

/** A refusal's `over_budget` issues whose `actual.size` names `size`. */
export function overBudget(reply: JsonObject, size: [number, number]): JsonObject[] {
  return arr(reply['issues'], 'the refusal\'s issues')
    .filter((i): i is JsonObject => isObject(i) && i['code'] === 'over_budget' && isObject(i['actual']) && sameSize(i['actual']['size'], size));
}

/** The fixture rows the call played: every row but one marked `why: "not_run"`. */
export function playedRows(reply: JsonObject): JsonObject[] {
  return arr(reply['fixtures'], 'the envelope\'s fixtures').map((f, i) => obj(f, `fixtures[${i}]`)).filter((f) => f['why'] !== 'not_run');
}

/** A number, or a line naming what it is instead. */
export function bytesOf(v: JsonValue | undefined, what: string, problems: string[]): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  problems.push(`${what} is a number of bytes, got ${JSON.stringify(v)}`);
  return null;
}
