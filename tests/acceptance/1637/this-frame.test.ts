// #1637.27a6396a: "Only this frame is read: a seek from 10 s back to 2 s draws what playing draws. A planted culler that
// reads the previous frame's pyramid drops an element a camera cut reveals and fails, naming the element and the frame"
//
// The seek: the walk of `walk.test.ts` (`helpers.ts: cityDoc({camera: 'walk'})`), sampled at 6 frames a second. One
// session plays frames 0 to 60 and then, right after frame 60 (10 s), seeks to frame 12 (2 s) (#484's `seeks`), and
// captures frame 12 both times (every frame drawn is listed, as #484's seek reads them). The same process draws frame 12 once more with `occlusion: 'off'` and its object-ID
// target. Both drawings of frame 12 hash as the unculled frame does, and each kept set holds every element and item
// with a pixel in that target.
//
// The cut: the same city with `helpers.ts: cityDoc({camera: 'cut'})`, the camera still at (1,296, 1.7, 1,921) on the
// street at z = 1,920. Until 0.9 s it faces the facade 7 m away (by a scratch CPU ray cast, no view depth in that frame
// is past 7.0 m); from 0.9 s, by a hold key, it looks along the street, where lamp street#77777 stands 25 m ahead and
// 3.5 m right, with nothing between. At 6 frames a second frame 5 is the last before the cut and frame 6 the first
// after. Frames 0 to 7, the shipped path against `occlusion: 'off'` in one process: every frame hashes the same and
// every kept set holds the unculled object-ID target's elements; street#77777 has no pixel at frame 5 and has pixels at
// frame 6, so the cut reveals it.
//
// `--planted pyramid_from_previous_frame` culls each frame against the pyramid built from the frame before. At frame 6
// that pyramid holds the facade at 7 m where the lamp now stands at 25 m, so it drops the lamp and fails, naming
// street#77777 and frame 6. Its run is the shipped path's call, so only the plant differs; occlusion: 'off' is drawn by
// the shipped program in its own process.
import { describe, expect, it } from 'vitest';
import {
  AC, CUT, PLAY, REVEALED_NAME, SIZE, cityDoc, failsNaming, frameAt, framesOf, keptBy, none, readIds, requireGpu, run, unkept, useGpu, useOut, view3dCall, writeJson,
  type Drawn, type Planted,
} from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const TEN_S = 60;
const TWO_S = 12;

/** Each shipped frame against the unculled frame of the same number: the hash, and the kept set against the ID target. */
function against(out: string, shipped: Drawn[], unculled: Drawn[], what: string): string[] {
  const problems: string[] = [];
  for (const a of shipped) {
    const b = unculled.find((f) => f.frame === a.frame);
    expect(b, `${what}: occlusion: 'off' drew frame ${a.frame}`).toBeDefined();
    if (!a.hash || a.hash !== b!.hash) problems.push(`frame ${a.frame}: ${what} hashes ${String(a.hash)}, occlusion: 'off' ${String(b!.hash)}`);
    problems.push(...unkept(keptBy(out, a, 'view', what), readIds(out, b!, `frame ${b!.frame}, occlusion: 'off'`), a.frame, what));
  }
  return problems;
}

function seekProblems(): string[] {
  const out = dir();
  const doc = writeJson(out, 'city', cityDoc({ camera: 'walk', shadows: false }));
  const [played, unculled] = run(bin(), out, [
    view3dCall({ doc, size: SIZE, fps: PLAY.fps, frames: PLAY.frames + 1, seeks: [{ after: TEN_S, to: TWO_S }], capture: [TWO_S], cull_report: true }),
    view3dCall({ doc, size: SIZE, fps: PLAY.fps, from: TWO_S, frames: 1, capture: [TWO_S], cull_report: true, occlusion: 'off', targets: ['ids'] }),
  ]);
  const drawn = framesOf(played!, 'the shipped path');
  expect(drawn.map((f) => f.frame), 'frames 0 to 60 draw, then frame 12 after the seek').toEqual([...Array.from({ length: PLAY.frames }, (_, n) => n), TWO_S]);
  const twice = drawn.filter((f) => f.frame === TWO_S);
  const problems = against(out, twice, framesOf(unculled!, "occlusion: 'off'"), 'the shipped path');
  if (twice[0]!.hash !== twice[1]!.hash) problems.push(`frame ${TWO_S} (2 s) after the seek from frame ${TEN_S} (10 s) hashes ${String(twice[1]!.hash)}, playing's ${String(twice[0]!.hash)}`);
  return problems;
}

/** The cut, frames 0 to 7; the fixture's own facts are checked only on the shipped program. */
function cutProblems(planted?: Planted): string[] {
  const out = dir();
  const doc = writeJson(out, 'cut', cityDoc({ camera: 'cut', shadows: false }));
  const call = { doc, size: SIZE, fps: PLAY.fps, frames: CUT.frames, capture: 'every' as const, cull_report: true };
  const [shippedReply] = run(bin(), out, [view3dCall(call)], planted);
  const [unculledReply] = run(bin(), out, [view3dCall({ ...call, occlusion: 'off', targets: ['ids'] })]);
  const shipped = framesOf(shippedReply!, planted ? `--planted ${planted}` : 'the shipped path');
  const unculled = framesOf(unculledReply!, "occlusion: 'off'");
  expect(shipped.map((f) => f.frame), `frames 0 to ${CUT.frames - 1}`).toEqual(Array.from({ length: CUT.frames }, (_, n) => n));
  const problems = against(out, shipped, unculled, planted ? `--planted ${planted}` : 'the shipped path');
  if (!planted) {
    const before = readIds(out, frameAt(unculled, CUT.frame - 1, "occlusion: 'off'"), `frame ${CUT.frame - 1}, occlusion: 'off'`).count.get(REVEALED_NAME) ?? 0;
    const after = readIds(out, frameAt(unculled, CUT.frame, "occlusion: 'off'"), `frame ${CUT.frame}, occlusion: 'off'`).count.get(REVEALED_NAME) ?? 0;
    if (before !== 0 || after === 0) problems.push(`${REVEALED_NAME} has ${before} px at frame ${CUT.frame - 1} and ${after} at frame ${CUT.frame}, so the cut doesn't reveal it: the fixture is wrong`);
  }
  return problems;
}

describe(`${AC[2]} only this frame is read`, () => {
  it(`${AC[2]} a seek from 10 s back to 2 s draws what playing draws, and across a camera cut every frame equals occlusion: 'off''s and keeps what the unculled frame shows`, () => {
    requireGpu();
    none([...seekProblems(), ...cutProblems()], 'the seek and the cut');
  }, 3_600_000);

  it(`${AC[2]} a planted culler that reads the previous frame's pyramid (--planted pyramid_from_previous_frame) drops the lamp the cut reveals, and fails naming the element and the frame`, () => {
    requireGpu();
    none(cutProblems(), 'the shipped program across the cut');
    failsNaming(cutProblems('pyramid_from_previous_frame'), [`frame ${CUT.frame}: element ${REVEALED_NAME} `], '--planted pyramid_from_previous_frame');
  }, 3_600_000);
});
