// AC3 #269.93b14936: A step that changes 10 cells uploads only their rows, and 20 sampled times give one pixel hash
// seeked and played; a planted mark that keeps the previous step's grid fails, naming the step
//
// The grid fixture drawn smooth alone (fixtures.ts `gridDoc(…, ['smooth'])`): from step 1 every step k moves the 10 cells
// programs.ts `movedAt(k)` names (step 30 also sets the value past the roles at (8, 6)), so the rows each step changes are
// known here (`rowsChangedAt`). On the GPU layer, `deep-gpu run`'s `film2d` with `counts` (README: The surface under
// test) plays frames 0 to 73, one step a frame: frame 0 uploads all 64 rows, and every later frame uploads exactly the
// rows its step changed; then it opens the film at each of 20 sampled frames with nothing drawn before (a seek): that
// frame uploads all 64 rows and hashes as the played frame. On the canonical render, `deep-show run`'s `determinism`
// plays and seeks the same 20 times, each on a fresh session: one pixel hash for each. On both paths the 20 played
// hashes differ from one another, so a frame that draws nothing (or the same grid every step) can't pass. A failure
// about a frame names its step.
import { describe, expect, it } from 'vitest';
import { teamsProgram, rowsChangedAt, SIDE } from './programs.ts';
import { gridDoc, mapId, sessionForm } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, arr, at, binOf, blocked, determinismCall, failsNaming, film2dCall, filmFrames, none, obj, prebuild, presented, putAsset,
  putEvidence, requireMetal, rowUploads, runGpu, runShow, scenario, show, showCall, str, useTemp, type GpuPlant, type JsonObject,
} from './helpers.ts';

prebuild(['full', 'gpu']);
const temp = useTemp();
const D = { grid: DOC(3) };
const ITEM = mapId('smooth');
/** 20 sampled steps, each changing 10 cells (step 30, which also sets the bad cell, is not among them). */
const SAMPLED = [3, 7, 11, 14, 18, 22, 25, 29, 33, 36, 40, 44, 47, 51, 55, 58, 62, 66, 69, 73];
const PLAYED = 74;
const WHOLE = Array.from({ length: SIDE }, (_, y) => y);
const list = (rows: number[]): string => `[${rows.join(', ')}]`;

/** Played hashes at the sampled steps that two steps share, though every step's grid differs. */
function repeated(hashes: Map<number, string>, path: string): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const k of SAMPLED) {
    const h = hashes.get(k);
    if (h === undefined) continue;
    const before = seen.get(h);
    if (before !== undefined) out.push(`${path}: step ${k} plays the same picture as step ${before} (${h}), though the grid changed between them`);
    else seen.set(h, k);
  }
  return out;
}

/** The GPU layer's side: uploads by rows, whole after a seek, and the seeked frames' hashes. */
function gpuFailures(planted?: GpuPlant): string[] {
  requireMetal();
  const out = temp();
  const program = teamsProgram();
  const assets = putAsset(out, program.bytes, 'wasm');
  const doc = sessionForm(gridDoc(program, ['smooth']));
  const calls: JsonObject[] = [
    film2dCall(doc, assets, { from: 0, frames: PLAYED, counts: true }),
    ...SAMPLED.map((k) => film2dCall(doc, assets, { from: k, frames: 1, counts: true })),
  ];
  const replies = runGpu(binOf('gpu'), out, calls, 'AC3 the grid fixture on the GPU layer', planted);
  const failures: string[] = [];
  const played = filmFrames(replies[0]!, 'the film played from frame 0');
  const hashes = new Map<number, string>();
  for (let n = 0; n < PLAYED; n++) {
    const f = played.get(n);
    expect(f, `the played film has frame ${n}`).toBeDefined();
    hashes.set(n, str(f!['pixel_hash'], `played frame ${n}: pixel_hash`));
    const want = n === 0 ? WHOLE : rowsChangedAt(n);
    const got = rowUploads(f!, ITEM, `played frame ${n}`);
    if (list(got) !== list(want)) failures.push(`step ${n}, played: ${ITEM} uploads rows ${list(got)}, not ${n === 0 ? 'all 64 (a new reader)' : `only the rows its step changed, ${list(want)}`}`);
  }
  failures.push(...repeated(hashes, 'the GPU layer'));
  SAMPLED.forEach((k, i) => {
    const f = filmFrames(replies[i + 1]!, `the film opened at frame ${k}`).get(k);
    expect(f, `the film opened at frame ${k} draws frame ${k}`).toBeDefined();
    const got = rowUploads(f!, ITEM, `frame ${k} after a seek`);
    if (list(got) !== list(WHOLE)) failures.push(`step ${k}, seeked: ${ITEM} uploads rows ${list(got)}, not all 64 (whole after a seek)`);
    const seeked = str(f!['pixel_hash'], `frame ${k} after a seek: pixel_hash`);
    if (seeked !== hashes.get(k)) failures.push(`step ${k}: seeked, the GPU layer's frame hashes ${seeked}; played, ${hashes.get(k)}`);
  });
  return failures;
}

/** The canonical render's side: `determinism` at the 20 sampled times. */
function canonicalFailures(): string[] {
  const ev = temp();
  const program = teamsProgram();
  putEvidence(ev, program.bytes);
  const replies = runShow(binOf(), scenario(ev, [D.grid], [showCall(D.grid, gridDoc(program, ['smooth'])), determinismCall(D.grid, SAMPLED.map(at))]), 'AC3 the grid fixture, played and seeked');
  presented(replies[0]!, 'the grid fixture drawn smooth');
  const compared = replies[1]!;
  if (compared['outcome'] === 'refused' && /gpu|adapter/.test(String(compared['code']))) blocked(`no GPU for determinism's pixel hash here: ${show(compared)}`);
  expect(compared['outcome'], `determinism compares the 20 sampled times: ${show(compared, 2000)}`).toBe('compared');
  const frames = arr(compared['frames'], 'determinism: frames').map((f, i) => obj(f, `determinism: frames[${i}]`));
  expect(frames.length, 'determinism answers each sampled time').toBe(SAMPLED.length);
  const failures: string[] = [];
  const hashes = new Map<number, string>();
  frames.forEach((f, i) => {
    const k = SAMPLED[i]!;
    expect(f['t'], `determinism's frame ${i} is step ${k}'s time`).toBe(at(k));
    const play = str(obj(f['play'], `step ${k}: play`)['pixel_hash'], `step ${k}: play.pixel_hash`);
    const seek = str(obj(f['seek'], `step ${k}: seek`)['pixel_hash'], `step ${k}: seek.pixel_hash`);
    hashes.set(k, play);
    if (play !== seek) failures.push(`step ${k}: seeked, the canonical render hashes ${seek}; played, ${play}`);
  });
  failures.push(...repeated(hashes, 'the canonical render'));
  return failures;
}

describe(`${AC[3]} uploads by the rows a step changed, and seeking equals playing`, () => {
  it(`${AC[3]} a step that changes 10 cells uploads only their rows, whole after a seek, and 20 sampled times give one pixel hash seeked and played`, () => {
    none([...gpuFailures(), ...canonicalFailures()], 'the grid fixture\'s uploads and its frames seeked and played');
  }, 2 * TIMEOUT);

  it(`${AC[3]} planted grid_keeps_previous_step fails, naming the step`, () => {
    const failures = gpuFailures('grid_keeps_previous_step');
    expect(failures.some((f) => /^step \d+: seeked, the GPU layer's frame hashes/.test(f)), `under the planted mark a played frame differs from the same step seeked: ${failures.slice(0, 6).join('; ')}`).toBe(true);
    failsNaming(failures, [new RegExp(`^step (${SAMPLED.join('|')}):`)], 'the grid fixture under grid_keeps_previous_step');
  }, TIMEOUT);
});
