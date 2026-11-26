// Test-side tools for the #3467 acceptance tests: the binaries the suite drives (`deep-canvas-render`, the live view,
// through its `idle` and `session` calls; `deep-show run`, for the canonical decode), fixtures made at test time by
// the recipes in fixtures.ts, the documents, one run of a call, and the gate on a timing. Nothing here stands in for
// the player, the decode worker or the live view: each is read from what a binary answers, and judges.ts decides.
//
// Reused by import, unchanged, as #503's, #1488's and #172's suites reuse them: #499's video documents, its store,
// its ffmpeg finder and runner, its five players' recordings and its BLOCKED and INCONCLUSIVE verdicts
// (tests/acceptance/499/video/helpers.ts). The reference Macs and the machine's state are read from
// scripts/benchmark.mjs, as #3300's suite reads them.

import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, homedir, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import { LOOK, asset, blocked, documentOf, ffmpeg, ffmpegTools, inconclusive, putStore, videoItem } from '../499/video/helpers.ts';
import { fixtureProblems, probeOf, recipeArgs, type Recipe } from './fixtures.ts';
import { isObject, judgeFive, unknownPlant, type JsonObject, type JsonValue } from './judges.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3467 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
/** Every `it` passes this: a first cargo build can take over an hour. */
export const TIMEOUT = 3_600_000;
/** A path with the home folder written as `~`, for a message. */
const tilde = (path: string): string => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path);

// ---------------------------------------------------------------------------------------------------
// The binaries: from DEEP_BIN_DIR when the proof run supplies it, else this checkout's debug build, built once per
// file as #499's suite builds it (docs/parallel-proof.md: Binaries for tests). A binary that isn't there is BLOCKED.

const supplied = process.env['DEEP_BIN_DIR'];
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };

export function useBinary(name: 'deep-canvas-render' | 'deep-show'): () => string {
  const path = join(supplied === undefined ? join(REPO, 'target', 'debug') : resolve(supplied), name);
  let error = 'its file was never looked for';
  beforeAll(() => {
    error = '';
    if (supplied === undefined) {
      const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
      if (run.error) error = `cargo could not run: ${run.error.message}`;
      else if (run.status !== 0) error = `cargo build --locked --bin ${name} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(-4000)}`;
    } else if (supplied.trim() === '') error = 'DEEP_BIN_DIR is empty';
    if (error === '') {
      try {
        accessSync(path, constants.X_OK);
      } catch {
        error = `${tilde(path)} is missing or not executable`;
      }
    }
  }, TIMEOUT);
  return () => {
    if (error !== '') blocked(`the binary ${name} isn't there (${supplied === undefined ? 'cargo build --locked --bin' : 'DEEP_BIN_DIR'}): ${error}`);
    return path;
  };
}

/** A fresh folder per call, removed after the file's tests. */
export function useTemp(tag: string): () => string {
  const made: string[] = [];
  afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => {
    const d = mkdtempSync(join(tmpdir(), `deep-3467-${tag}-`));
    made.push(d);
    return d;
  };
}

// ---------------------------------------------------------------------------------------------------
// Fixtures (README: Fixtures): encoded by ffmpeg and checked from ffprobe's reading. ffmpeg makes fixtures only.

/** The recipe's recording, at `dir/<name>.mp4`. Without ffmpeg, or when it comes out another way, BLOCKED. */
export function makeFixture(r: Recipe, dir: string): string {
  const path = join(dir, `${r.name}.mp4`);
  try {
    ffmpeg(recipeArgs(r, path));
  } catch (e) {
    const why = (e as Error).message;
    if (why.startsWith('BLOCKED')) throw e;
    blocked(`ffmpeg couldn't make the fixture ${r.name} (README: Fixtures): ${why.slice(0, 1500)}`);
  }
  const probe = (...entries: string[]): JsonValue =>
    JSON.parse(execFileSync(ffmpegTools().ffprobe, ['-v', 'error', '-of', 'json', '-select_streams', 'v:0', ...entries, path], { encoding: 'utf8', maxBuffer: 1 << 28 })) as JsonValue;
  const problems = fixtureProblems(r, probeOf(probe('-show_entries', 'stream=time_base,width,height'), probe('-show_entries', 'packet=pts,flags'), probe('-show_entries', 'frame=pts,pict_type,key_frame')));
  if (problems.length) blocked(`the fixture ${r.name} didn't come out as its recipe says (README: Fixtures), so nothing can be judged on it: ${problems.join('; ')}`);
  return path;
}

/** The store folder of `dir` holding the file, and the file's SHA-256, its name there. */
export function stored(dir: string, path: string): { store: string; sha: string } {
  const store = join(dir, 'store');
  return { store, sha: putStore(store, readFileSync(path)) };
}

// ---------------------------------------------------------------------------------------------------
// Documents and request lines (README: The surface under test)

/** The one video item's ID in this suite's own documents. */
export const ITEM = 'rec';
const VIEW: JsonObject = { zoom: 1, theme: 'light' };

/**
 * A 640 × 360 board whose one item is the recording `sha`, an image@1 playing from 0 at rate 1 in a box of `box`
 * u at the board's origin. At zoom 1 the player decodes at the box's size.
 */
export function board(name: string, sha: string, box: [number, number], spanSeconds: number): JsonObject {
  return documentOf(`3467-${name}`, 'board', [640, 360], [videoItem(ITEM, sha, [0, 0, box[0], box[1]])], { [ITEM]: asset(sha) }, {}, { span: `${spanSeconds}s` });
}

/** An `idle` line: the document held on screen for `seconds` of the real clock. */
export const idleLine = (doc: JsonObject, store: string, seconds: number): JsonObject => ({ doc, look: LOOK, view: VIEW, seconds, store });

/**
 * A `session` line whose steps present one frame each at the document times `times` (flicks), in order: the first
 * opens the session, and each later one moves the clock to its time, forward or back. `planted` names a planted
 * worker (README: Planted workers).
 */
export function sessionLine(doc: JsonObject, store: string, times: readonly number[], planted?: string): JsonObject {
  const steps = times.map((t, i): JsonObject => (i === 0 ? { doc, t, view: VIEW, frames: 1 } : { t, frames: 1 }));
  return { look: LOOK, store, steps, ...(planted === undefined ? {} : { planted }) };
}

// ---------------------------------------------------------------------------------------------------
// Runs

/** Why the live view can't run here, when it can't: it draws with the offscreen Metal renderer and decodes with the platform's decoder. */
function mac(): void {
  if (process.platform !== 'darwin') blocked(`the live view draws with the offscreen Metal renderer and its worker decodes with the platform's decoder, macOS only; this is ${process.platform}`);
}

/**
 * One process of `deep-canvas-render <sub>` given `lines`, one answer per line, in order. The answers are returned
 * as they are, a refusal too: judges.ts reads them. A process that doesn't end, exits non-zero or answers another
 * number of lines fails here.
 */
export function render(bin: string, sub: 'idle' | 'session', lines: readonly JsonObject[], what: string): JsonValue[] {
  mac();
  // deadline: bounds a run that hangs; spawnSync signals only this child, and the decode workers it started end when their stdin closes
  const run = spawnSync(bin, [sub], { cwd: REPO, input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  if (run.error) expect.fail(`${what}: deep-canvas-render ${sub} didn't finish: ${run.error.message}`);
  expect(run.status, `${what}: deep-canvas-render ${sub} exits 0 (signal ${run.signal ?? 'none'}); stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: deep-canvas-render ${sub} answers one line per input line`).toBe(lines.length);
  const answers = out.map((l) => JSON.parse(l) as JsonValue);
  if (answers.some((a) => isObject(a) && a['ok'] === false && a['code'] === 'unsupported_platform')) blocked(`${what}: deep-canvas-render ${sub} answers unsupported_platform`);
  return answers;
}

/** A planted worker's run must be that worker's: a binary that doesn't know the name answers `bad_input`, and proves nothing. */
export function plantedRan(answer: JsonValue | undefined, name: string): void {
  if (unknownPlant(answer)) expect.fail(`the planted worker \`${name}\` isn't in this binary: session answered ${JSON.stringify(answer)} to a line with \`planted: "${name}"\` (README: Planted workers)`);
}

/**
 * The SHA-256 of the planes the canonical decode gives for each of the file's first `count` frames, in presentation
 * order: `deep-show run`'s `media_decode` with `frames: [k, …]`, which decodes each frame asked for in the decode
 * worker from the key frame before it and names its planes by their hash (crates/deep-codecs/src/lib.rs, `decode`).
 * The oracle of criterion 2: when it can't be read, the criterion can't be judged, BLOCKED.
 */
export function canonicalHashes(showBin: string, path: string, count: number, dir: string): string[] {
  const evidence = join(dir, 'evidence');
  mkdirSync(evidence, { recursive: true });
  const scenario: JsonObject = { evidence, calls: [{ call: 'media_decode', path, out: join(dir, 'canonical'), frames: Array.from({ length: count }, (_, k) => k) }] };
  // deadline: bounds a run that hangs; spawnSync signals only this child
  const run = spawnSync(showBin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL' });
  const what = 'the canonical decode (deep-show run, media_decode with frames)';
  if (run.error || run.status !== 0) blocked(`${what} didn't run: ${run.error?.message ?? `exit ${run.status}`}; stderr: ${(run.stderr ?? '').slice(-1500)}`);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  const answer = lines.length === 1 ? (JSON.parse(lines[0]!) as JsonValue) : null;
  const reply = isObject(answer) && answer['ok'] === true && Array.isArray(answer['replies']) ? answer['replies'][0] : undefined;
  const decoded = isObject(reply) ? reply['decoded'] : undefined;
  const streams = isObject(decoded) && Array.isArray(decoded['streams']) ? decoded['streams'] : [];
  const video = streams.find((s) => isObject(s) && s['type'] === 'video');
  const frames = isObject(video) && Array.isArray(video['frames']) ? video['frames'] : [];
  const hashes = frames.flatMap((f) => (isObject(f) && typeof f['planes'] === 'string' && /^[0-9a-f]{64}$/.test(f['planes']) ? [f['planes']] : []));
  if (hashes.length !== count || frames.length !== count) blocked(`${what} named the planes of ${hashes.length} of the ${count} frames asked for: ${(run.stdout ?? '').slice(0, 600)}`);
  if (new Set(hashes).size !== count) blocked(`${what} gives the same planes for two frames of the fixture, so a hash can't name a frame`);
  return hashes;
}

// ---------------------------------------------------------------------------------------------------
// A timing counts only on a fit reference Mac (technical design: The reference Macs): one of the design's machines,
// on mains power, with Low Power Mode off and the thermal state nominal. Elsewhere it is a reading.

interface Benchmark { fingerprint(): Record<string, unknown>; references: Record<string, unknown>[] }

/** What keeps a timing taken on this machine now from counting, or an empty list. */
export async function unfit(): Promise<string[]> {
  if (process.platform !== 'darwin') return [`platform ${process.platform}`];
  const { fingerprint, references } = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Benchmark;
  const machine = fingerprint();
  const hardware = ['model', 'chip', 'memoryBytes'];
  const off: string[] = [];
  if (!references.some((reference) => hardware.every((key) => machine[key] === reference[key]))) off.push(`not a reference Mac: ${hardware.map((key) => `${key} ${JSON.stringify(machine[key] ?? null)}`).join(', ')}`);
  if (machine['power'] !== 'ac') off.push(`power is ${JSON.stringify(machine['power'] ?? null)}, not mains`);
  if (machine['lowPowerMode'] !== false) off.push(`Low Power Mode is ${JSON.stringify(machine['lowPowerMode'] ?? null)}, not off`);
  if (machine['thermalState'] !== 'nominal') off.push(`thermal state is ${JSON.stringify(machine['thermalState'] ?? null)}, not nominal`);
  return off;
}

/** The 1-minute load average over the core count: above 1, a timing that failed may be the machine's, not the code's. */
export const loadShare = (): number => loadavg()[0]! / availableParallelism();

/** Five runs of a timing, judged by judges.ts's rule on this machine as it is now: PASS returns, FAIL fails, anything else fails INCONCLUSIVE. */
export async function timingOverFive(failures: readonly (string | null)[], reading: string): Promise<void> {
  const load = `load ${loadavg().map((l) => l.toFixed(2)).join(' ')} on ${availableParallelism()} cores`;
  const verdict = judgeFive(failures, await unfit(), loadShare());
  if (verdict.verdict === 'PASS') return;
  if (verdict.verdict === 'FAIL') expect.fail(`FAIL: ${verdict.why}; ${load}`);
  inconclusive(`${verdict.why}; ${reading}; ${load}`);
}
