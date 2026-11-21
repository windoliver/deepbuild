// AC3 #265.4bf8a6ac: "A wake behind a swimmer a logic array moves gives one pixel hash at 20 s, seeked and played; a
// planted wake that keeps the last frame's samples draws a different wake after the seek and fails, naming the material"
//
// The swimmer (helpers.ts: swimmerDoc): the lake's material `lake-water` wakes behind `swimmer` over the last 8 s; the
// logic item `swim` steps at 60 Hz and its `hold` arrays `x` and `z` place the swimmer through two drivers on a U across
// the lake. `view3d` at 30 fps, 320 × 180:
// - played from frame 0 to frame 600 (20 s) in one process, and frame 600 opened by a seek in a fresh process (#380's
//   `from`): one pixel hash.
// - Guards at 20 s, each a seek in that fresh process: the twin whose swimmer hold channels move through the same values
//   at the same steps draws the same pixels (the wake reads the logic bake's values at its samples, as it reads a
//   channel's), and the same lake without its wake draws other pixels (the wake is in what's compared).
// The planted `wake_keeps_last_frame` (README: Planted programs) under the same seek-against-play judge fails, a failure
// naming the material `lake-water` and 20 s.
// Wrong programs: the base (a wake behind an item a logic array moves is refused at check); a wake from earlier frames;
// a wake read from the stored steps of another time; one that isn't drawn.

import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, ac, failsNaming, framesOf, none, putPrograms, requireGpu, run, swimmerDoc, useBins, useDir, view3d, writeJson,
  type Fixture, type JsonObject, type Planted,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const SIZE: [number, number] = [320, 180];
const FPS = 30;
const AT = 600;

function placed(name: string, f: Fixture): { doc: string; assets: Record<string, string> } {
  return { doc: writeJson(dir(), `${name}.json`, f.doc), assets: putPrograms(dir(), f.programs) };
}
const hashAt = (reply: JsonObject | undefined, what: string): string => {
  const f = framesOf(reply!, what).find((x) => x.frame === AT);
  expect(f?.pixelHash, `${what}: frame ${AT} has a pixel hash`).toMatch(/^[0-9a-f]{64}$/);
  return f!.pixelHash!;
};

/** Seek against play at 20 s; a difference is a failure naming the water's material. */
function seekProblems(planted?: Planted): { failures: string[]; played: string; sought: string } {
  const swim = placed('swimmer', swimmerDoc('logic'));
  const tag = planted ? `, planted ${planted}` : '';
  const [p] = run(bins.bin('deep-gpu'), dir(), [view3d({ ...swim, size: SIZE, fps: FPS, from: 0, frames: AT + 1 })], planted ? { planted } : {});
  const [s] = run(bins.bin('deep-gpu'), dir(), [view3d({ ...swim, size: SIZE, fps: FPS, from: AT, frames: 1 })], planted ? { planted } : {});
  const played = hashAt(p, `the swimmer played to 20 s${tag}`);
  const sought = hashAt(s, `the swimmer sought to 20 s${tag}`);
  return { failures: played === sought ? [] : [`material lake-water at 20 s: the frame seeked to 20 s (${sought.slice(0, 12)}) differs from the one played to 20 s (${played.slice(0, 12)})`], played, sought };
}

describe(`${ac(3)} a wake behind a swimmer a logic array moves, read from the logic bake`, () => {
  it(`${ac(3)} the wake gives one pixel hash at 20 s seeked and played, the one a channel holding the same steps gives, and it shows`, () => {
    requireGpu();
    const { failures, played } = seekProblems();
    none(failures, 'seek against play at 20 s');
    const twin = placed('twin', swimmerDoc('channels'));
    const calm = placed('calm', swimmerDoc('logic', false));
    const [t, c] = run(bins.bin('deep-gpu'), dir(), [twin, calm].map((x) => view3d({ ...x, size: SIZE, fps: FPS, from: AT, frames: 1 })));
    expect(hashAt(t, 'the twin whose swimmer hold channels move'), 'the wake behind the logic-moved swimmer is the one behind a swimmer channels hold through the same steps').toBe(played);
    expect(hashAt(c, 'the same lake without its wake'), 'the wake shows: without it the frame at 20 s differs').not.toBe(played);
  }, TIMEOUT);

  it(`${ac(3)} (planted) a wake that keeps the last frame's samples draws a different wake after the seek and fails, naming the material`, () => {
    requireGpu();
    failsNaming(seekProblems('wake_keeps_last_frame').failures, ['material lake-water', '20 s'], 'the planted wake_keeps_last_frame');
  }, TIMEOUT);
});
