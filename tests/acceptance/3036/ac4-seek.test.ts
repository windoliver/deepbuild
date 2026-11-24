// AC4 #3036.e57d7497: "20 sampled times hash the same seeked and played. A planted plate that keeps the surface from
// the frame before fails at the first seek"
//
// Fixture (helpers.ts `laneFilm`): criterion 1's lane, tracks and rolling ball as a `view3d` session holds them, seen
// whole from (0, 6, 12) m, 480 × 270, the document at 2 frames a second and the film drawn at 10. One process plays the
// film from frame 0 to frame 100 (10 s). Another opens 20 sampled frames each alone by a seek (`from`, one frame): ten
// between the document's frames (0.4 s, 1.4 s … 9.4 s) and ten on them (1 s, 2 s … 10 s), from the last back to the
// first, so the first seek opens at 10 s with the whole groove behind the ball.
//
// asserts (on a Mac of a reference model; with no GPU the test is BLOCKED, never a pass):
//   - each of the 20 frames opened by a seek has the pixel hash of the frame the film played to;
//   - not vacuous: the 20 played frames all differ (the ball moves and its groove grows), and at 10 s the same lane
//     without tracks draws another frame (the groove is in what is compared);
//   - planted `tracks_keep_last_frame` (`deep-gpu run --planted`): the same judge fails, and its first failure is the
//     first seek's.
//
// Wrong programs this fails on (the first planted, the rest not): a plate that keeps the surface the frame before drew;
// one that reads the ball's place from an earlier frame, or from the frames drawn so far; the base (it draws no
// tracks); a renderer that draws nothing.
import { describe, expect, it } from 'vitest';
import {
  AC, FILM_FPS, FILM_LAST, FILM_SIZE, PLAIN, PLANTED, SAMPLED, SEEK_ORDER, TIMEOUT, TRACKS, hashAt, hashesOf, laneFilm, none, requireReferenceMac, runGpu, seekFailures,
  seekJudgeFailsItsPlants, useBins, useFolders, view3d, writeJson,
  type GpuPlanted,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const folder = useFolders();

/** The film played to 10 s in one process, and in another the 20 seeks in their order and then the lane without tracks at 10 s. */
function film(planted?: GpuPlanted): { failures: string[]; played: Map<number, string>; bare: string } {
  const dir = folder();
  const doc = writeJson(dir, 'lane', laneFilm('lane-tracks', TRACKS));
  const untracked = writeJson(dir, 'bare', laneFilm('lane-bare', null));
  const [play] = runGpu(bin('deep-gpu'), dir, [view3d({ doc, look: PLAIN, size: FILM_SIZE, fps: FILM_FPS, frames: FILM_LAST + 1 })], planted);
  const seeks = runGpu(bin('deep-gpu'), dir, [
    ...SEEK_ORDER.map((n) => view3d({ doc, look: PLAIN, size: FILM_SIZE, fps: FILM_FPS, from: n, frames: 1 })),
    view3d({ doc: untracked, look: PLAIN, size: FILM_SIZE, fps: FILM_FPS, from: FILM_LAST, frames: 1 }),
  ], planted);
  const played = hashesOf(play!, 'the film played from 0 s to 10 s');
  const sought = new Map(SEEK_ORDER.map((n, i) => [n, hashAt(seeks[i]!, n, `the seek to frame ${n}`)]));
  return { failures: seekFailures(SEEK_ORDER, FILM_FPS, played, sought), played, bare: hashAt(seeks[SEEK_ORDER.length]!, FILM_LAST, 'the lane without tracks at 10 s') };
}

describe(`${AC[4]} tracks are a closed form of t: seeking equals playing`, () => {
  it(`${AC[4]} 20 sampled times hash the same seeked and played`, () => {
    seekJudgeFailsItsPlants();
    requireReferenceMac();
    const { failures, played, bare } = film();
    expect(new Set(SAMPLED.map((n) => played.get(n))).size, 'the 20 played frames all differ: the ball moves and its groove grows').toBe(SAMPLED.length);
    expect(bare, 'the groove is drawn at 10 s: the same lane without tracks has another frame 100').not.toBe(played.get(FILM_LAST));
    none(failures, 'each of the 20 sampled frames opened by a seek is the frame the film played to');
  }, TIMEOUT);

  it(`${AC[4]} a planted plate that keeps the surface from the frame before (--planted ${PLANTED.keepsFrame}) fails at the first seek`, () => {
    seekJudgeFailsItsPlants();
    requireReferenceMac();
    const { failures } = film(PLANTED.keepsFrame);
    expect(failures.length, `under ${PLANTED.keepsFrame} a frame opened by a seek isn't the frame the film played to`).toBeGreaterThan(0);
    expect(failures[0], 'the first failure is the first seek\'s').toContain('seek 1 of 20 (the first seek)');
  }, TIMEOUT);
});
