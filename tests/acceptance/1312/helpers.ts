// Test-side tools for #1312's criterion 3 (README.md). JSON reading, the scene document's shape, the look, `view3d`'s
// reply, the SHA-named target files and PNG reading come from #422's suite helpers (imported, not copied, as #1285's
// suite does). This file adds what #422's don't: a `deep-gpu` build that draws on Linux (wgpu's `vulkan` feature, which
// the base's manifests leave off there), the target the issue names per platform, and the footprint measure.
// Nothing here stands in for the renderer or the operator under test.

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect } from 'vitest';
import {
  REPO, arr, decodePng, inconclusive, isObject, obj, readLinear, readNamed, shown,
  type JsonObject, type JsonValue, type ViewFrame,
} from '../422/helpers.ts';

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
 * (`scripts/proof-change.mjs`, `criterionId`), from issue #1312's body. */
export const AC = { 3: 'AC3 #1312.1cc5895b' } as const;

/** "On Linux read the linear target; elsewhere the final." macOS draws on Metal; Linux on Vulkan; no other platform
 * draws here. */
export const PLATFORM = process.platform;
export const TARGET: 'linear' | 'final' = PLATFORM === 'linux' ? 'linear' : 'final';
/** A test that can't draw here is INCONCLUSIVE, never a pass. */
export function requireDrawingPlatform(): void {
  if (PLATFORM !== 'linux' && PLATFORM !== 'darwin') inconclusive(`deep-gpu draws on macOS (Metal) or Linux (Vulkan); this is ${PLATFORM}`);
}

// ---------------------------------------------------------------------------------------------------
// The build: deep-gpu, once per file, copied out of the target folder. On Linux with wgpu's `vulkan` feature (the
// issue's repro: "wgpu on Vulkan"), which `deep-gpu-layer`'s direct wgpu dependency takes from the command line; the
// lock file is unchanged (`--locked`).

const CARGO_ARGS = PLATFORM === 'linux'
  ? ['build', '--locked', '-p', 'deep-gpu-layer', '--bin', 'deep-gpu', '--features', 'wgpu/vulkan']
  : ['build', '--locked', '--bin', 'deep-gpu'];
const targetDir = (): string => process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target');
function cargoBuild(): string {
  const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  const run = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${CARGO_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}
/** Builds deep-gpu before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useGpu(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    if (PLATFORM !== 'linux' && PLATFORM !== 'darwin') return;
    dir = mkdtempSync(join(tmpdir(), 'deep-1312-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(targetDir(), 'debug', 'deep-gpu'), join(dir, 'deep-gpu'));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return join(dir, 'deep-gpu');
  };
}

// ---------------------------------------------------------------------------------------------------
// `deep-gpu run`: one JSON line in, one out (#377). A machine with no GPU adapter answers `no_device` and exits 1:
// INCONCLUSIVE, since nothing was drawn.

export function runGpu(bin: string, out: string, calls: JsonObject[]): JsonObject[] {
  const name = 'deep-gpu run';
  const run = spawnSync(bin, ['run'], {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${name}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  expect(timedOut, `${name} finished within its timeout`).toBe(false);
  const lines = stdout.split('\n').filter((l) => l !== '');
  let first: JsonValue | undefined;
  try { first = lines[0] === undefined ? undefined : (JSON.parse(lines[0]) as JsonValue); } catch { first = lines[0]; }
  if (isObject(first) && first['code'] === 'no_device') inconclusive(`${name} found no GPU device here: ${shown(first['reason'])}`);
  // At the base on Linux with Vulkan (NVIDIA), the process can die by a signal at exit after its whole answer line is
  // written (README: How each criterion is read). That crash is no part of #1312's criteria, so an answer written in full before it
  // is judged, and the crash is logged; a process that dies before answering in full fails here.
  const whole = stdout.endsWith('\n') && isObject(first) && lines.length === 1;
  if (run.signal !== null && whole) console.warn(`${name} died by ${run.signal} after writing its whole answer; the answer is judged. stderr: ${stderr.slice(-600)}`);
  else expect(run.status, `${name} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${stderr.slice(-3000)}`).toBe(0);
  expect(lines.length, `${name}: one output line per input line`).toBe(1);
  const answer = obj(first, `${name}: the answer`);
  expect(answer['ok'], `${name} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${name}: replies`).map((r, i) => obj(r, `${name}: replies[${i}]`));
  expect(replies.length, `${name}: one reply per call`).toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The footprint: pixels that differ from the frame with no emitter, in the platform's target.

/** A frame's pixels as RGB triples, from the platform's target (linear f32, or the final PNG's 8-bit codes). */
export function pixelsOf(out: string, f: ViewFrame, size: [number, number], what: string): Float64Array {
  const [w, h] = size;
  const px = new Float64Array(w * h * 3);
  if (TARGET === 'linear') {
    const lin = readLinear(out, f.linear, size, `${what}: the linear target`);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(lin.at(x, y), (y * w + x) * 3);
  } else {
    const im = decodePng(readNamed(out, f.final, 'png', `${what}: the final target`));
    expect([im.width, im.height], `${what}: the final target is ${w} × ${h}`).toEqual([w, h]);
    for (let i = 0; i < w * h; i++) px.set([im.rgba[i * 4]!, im.rgba[i * 4 + 1]!, im.rgba[i * 4 + 2]!], i * 3);
  }
  return px;
}
/** How many pixels differ, in any of R, G and B, between two frames of the same size. */
export function footprint(a: Float64Array, b: Float64Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 3) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  return n;
}
