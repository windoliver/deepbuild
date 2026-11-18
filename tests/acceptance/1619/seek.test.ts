// #1619.94959aa8: "The same frame is byte-identical played straight and after a seek. A planted tracking band seeded
// from wall time differs after the seek and fails, naming the frame"
//
// The tape fixture: a still figure (ten blocks down the frame's diagonal, 320 × 180) under a VHS screen with
// `tracking: {band: 12, rate: 12, shift: 6, seed: 7}` and `roll: {period: "1s", amount: 0.25}`, played 48 frames at
// 24 fps from frame 0 in one process, then frames 7, 23 and 41 each opened cold (`from`) in a second. Every value the
// screen draws comes from hash(the frame index at the finish's rate, the document seed), so frame n is the same bytes
// however it was reached; a failure names the frame.
// The comparison runs twice, as the issue's `Runs on:` line splits it (README: Run them):
// - on the noop backend, which draws no pixel and runs anywhere, the Spark included: each frame's `finish_hash`, the
//   SHA-256 of what the finish pass is given for the frame (README: The surface under test);
// - on Metal, the Mac's: each frame's `pixel_hash`, the SHA-256 of the pixels it drew.
// So that equal bytes aren't a screen that reads neither field: the band and the roll show (on Metal some played frame
// differs from the frame with no finish; on noop every frame has a finish hash) and move (the played frames hold more
// than one hash).
// Planted: `tracking_wall_time`, the tracking band seeded from the wall clock; a seeked frame differs from the same
// frame played, on both backends.
import { describe, expect, it } from 'vitest';
import {
  AC, FPS, FRAMES, type Frame, type Planted, ROLL, STAIRS, TRACKING, failsNaming, film2d, finishHash, frameAt, framesOf, none, pixelHash, requireGpu, runGpu, tapeLook,
  useGpu, useOut,
} from './helpers.ts';

const gpu = useGpu();
const out = useOut();
const TAPE = tapeLook('tape-1619', { tracking: TRACKING, roll: ROLL });
const PLAIN = tapeLook('tape-plain-1619', null);
const SEEKS = [7, 23, 41];

interface Seeked {
  /** Each seeked frame that differs from the same frame played, as a sentence naming the frame. */
  problems: string[];
  /** The played frames' hashes, in order. */
  played: string[];
  /** The hash of the frame with no finish (Metal only). */
  plain: string | null;
}
/**
 * The film played straight in one process and three frames each opened cold in a second, compared by the backend's
 * hash of a frame's bytes.
 */
function seek(backend: 'noop' | undefined, planted?: Planted): Seeked {
  const noop = backend === 'noop';
  if (!noop) requireGpu();
  const how = noop ? {} : { hash: true };
  const hashOf = (f: Frame, what: string): string => (noop ? finishHash(f, what) : pixelHash(f, what));
  const [film, bare] = runGpu(gpu(), out(), [
    film2d(STAIRS, TAPE, { fps: FPS, frames: FRAMES, ...how }),
    ...(noop ? [] : [film2d(STAIRS, PLAIN, { fps: FPS, frames: 1, hash: true })]),
  ], { backend, planted });
  const seeks = runGpu(gpu(), out(), SEEKS.map((from) => film2d(STAIRS, TAPE, { fps: FPS, from, frames: 1, ...how })), { backend, planted });
  const frames = framesOf(film!, 'the film played straight');
  expect(frames.map((f) => f.frame), 'the film played straight answers frames 0 to 47').toEqual([...Array(FRAMES).keys()]);
  const played = frames.map((f) => hashOf(f, 'played straight'));
  const problems: string[] = [];
  SEEKS.forEach((n, k) => {
    const seeked = hashOf(frameAt(seeks[k]!, n, `frame ${n} after a seek`), 'after a seek');
    if (seeked !== played[n]) problems.push(`frame ${n} after a seek differs from frame ${n} played straight: its ${noop ? 'finish_hash' : 'pixel_hash'} is ${seeked.slice(0, 12)}…, not ${played[n]!.slice(0, 12)}…`);
  });
  return { problems, played, plain: bare ? pixelHash(frameAt(bare, 0, 'the frame with no finish'), 'no finish') : null };
}

describe(`${AC[2]} the screen's tracking band and roll come from the frame, never from playback`, () => {
  it(`${AC[2]} on the noop backend (anywhere, the Spark included), what the finish pass is given for a frame is byte-identical played straight and after a seek`, () => {
    const { problems, played } = seek('noop');
    none(problems, `${AC[2]} seeking on the noop backend`);
    expect(new Set(played).size, 'the band and the roll move: the 48 played frames hold more than one finish_hash').toBeGreaterThan(1);
  });

  it(`${AC[2]} on the noop backend, a planted tracking band seeded from wall time (planted tracking_wall_time) differs after the seek and fails, naming the frame`, () => {
    failsNaming(seek('noop', 'tracking_wall_time').problems, [/frame (7|23|41) after a seek/], `${AC[2]} the planted tracking_wall_time on the noop backend`);
  });

  it(`${AC[2]} on Metal, the same frame is byte-identical played straight and after a seek`, () => {
    const { problems, played, plain } = seek(undefined);
    none(problems, `${AC[2]} seeking on Metal`);
    expect(played.some((h) => h !== plain), 'the band and the roll show: some played frame differs from the frame with no finish').toBe(true);
    expect(new Set(played).size, 'the band and the roll move: the 48 played frames hold more than one pixel_hash').toBeGreaterThan(1);
  });

  it(`${AC[2]} on Metal, a planted tracking band seeded from wall time (planted tracking_wall_time) differs after the seek and fails, naming the frame`, () => {
    failsNaming(seek(undefined, 'tracking_wall_time').problems, [/frame (7|23|41) after a seek/], `${AC[2]} the planted tracking_wall_time on Metal`);
  });
});
