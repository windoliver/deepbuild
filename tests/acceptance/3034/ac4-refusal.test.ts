// #3034.311508f3: "With the first change alone, a camera keyed through the surface is refused, naming the first time
// its eye is below. On the merge base it draws with no issue, and the test fails"
//
// The fixture (helpers.ts `lakeDoc`, 320 × 180): the lake, and the camera `diver` whose height a channel keys through
// the water part `lake`'s surface at rest, 1 m a second (`items/diver/params/position/1`: 2.0078125 m above it at 0 s,
// 1.9921875 m below it at 4 s). Its eye is at the surface at 2.0078125 s and below it from then on, so the first time
// its eye is below is 2.0078125 s, 1,416,712,500 flicks. `view3d` is asked for the whole span, 241 frames at the
// document's 60 a second, so the call reaches every time the document holds, however a check walks them.
//
// The issue's scope lets the work land as two changes, "First the refusal … Then the view, which lifts it", and this
// file isn't edited between them. So the test reads what `view3d` answers (README: The two changes):
//
// - The check's refusal, `{code: "refused", issues}` (the first change alone): an error issue names the camera
//   `diver` and the water part `lake`, each as a whole word, and its `actual.t` is the first time the eye is below, in
//   whole flicks: no earlier than the crossing (less 1 ms, for a solver's tolerance) and no later than one frame
//   interval of the document after it, so a check that solves the crossing and one that walks the document's frames
//   both name it.
// - Frames (no refusal): the camera keyed through the surface is drawn. That is right only where the view has lifted
//   the refusal, and the view is what reads `ior`: the frame at 3.5 s, 1.49 m under the surface, with both cones'
//   edges in it, must differ between the default `ior` and 1.5. On the merge base no code reads `ior`, the two frames
//   are one picture, and the test fails there: it draws with no issue and by no rule.
//
// Wrong programs: the merge base; a refusal that names no time, a later time than the first (the last key, the end of
// the span, the frame the call asked for), a time before the eye is below, or no camera or part; a program that
// neither refuses nor decides the view.
import { describe, expect, it } from 'vitest';
import {
  AC, DIVER, DIVE_CROSSES, DIVE_FRAME, DIVE_SPAN, FLICKS, LAKE, OTHER_IOR, belowFrame, diveHeight, errorIssues, frameAt, framesOf, hashAt, int, isObject,
  lakeDoc, look3d, namesWord, obj, refusedAtCheck, requireMachine, runGpu, shown, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [320, 180];
const LOOK = look3d('refusal-3034');
/** The document's own frame rate, and the whole of its span at it. */
const FPS = 60;
const FRAMES = DIVE_SPAN * FPS + 1;
/** A solver's tolerance before the crossing: 1 ms. */
const SLACK = FLICKS / 1000;

describe(`${AC[4]} a camera keyed through the surface is refused at check until the view decides its frames`, () => {
  it(`${AC[4]} a camera keyed through the surface is refused, naming the first time its eye is below; where the view has lifted the refusal its frames below the surface read ior; on the merge base it draws with no issue and by no rule, and this fails`, () => {
    requireMachine();
    const dir = out();
    const below = belowFrame(FPS);
    expect(DIVE_CROSSES, 'the eye is at the surface at 2.0078125 s, a whole number of flicks').toBe(1_416_712_500);
    expect(diveHeight(below / FPS), 'the frame the view is read at is over 1 m under the surface').toBeLessThan(-1);
    const [shot, other] = runGpu(bin(), dir, [
      view3d({ doc: writeJson(dir, 'dive', lakeDoc('dive', SIZE)), look: LOOK, size: SIZE, frames: FRAMES, fps: FPS }),
      view3d({ doc: writeJson(dir, 'dive-ior', lakeDoc('dive-ior', SIZE, OTHER_IOR)), look: LOOK, size: SIZE, from: below, frames: 1, fps: FPS }),
    ]);

    if (refusedAtCheck(shot!, 'the camera keyed through the surface')) {
      // The first change alone: refused, naming the camera, the part and the first time the eye is below.
      const issues = errorIssues(shot!, 'the camera keyed through the surface');
      const named = issues.filter((i) => namesWord(JSON.stringify(i), DIVER) && namesWord(JSON.stringify(i), LAKE));
      expect(named.length, `an error issue names the camera ${DIVER} and the water part ${LAKE}: ${shown(issues)}`).toBeGreaterThan(0);
      const hit = named.find((i) => isObject(i['actual']) && typeof i['actual']['t'] === 'number');
      expect(hit, `that issue's actual holds t, the first time the eye is below, in flicks: ${shown(named)}`).toBeDefined();
      const t = int(obj(hit!['actual'], 'the issue\'s actual')['t'], 'the issue\'s actual.t, the time in whole flicks');
      console.log(`${AC[4]}: refused at check (the first change alone): ${String(hit!['code'])} names ${DIVER}, ${LAKE} and t = ${t} flicks (${t / FLICKS} s); the eye is at the surface at ${DIVE_CROSSES} flicks`);
      expect(t >= DIVE_CROSSES - SLACK && t <= DIVE_CROSSES + DIVE_FRAME, `the time named, ${t} flicks (${t / FLICKS} s), is the first at which the eye is below: from ${DIVE_CROSSES} flicks (2.0078125 s; 1 ms of slack before it) to one frame of the document after it (${DIVE_CROSSES + DIVE_FRAME})`).toBe(true);
      return;
    }

    // Not refused: drawn. Right only where the view has lifted the refusal, and the view reads ior.
    const frames = framesOf(shot!, 'the camera keyed through the surface');
    expect(frames.length, 'the shot draws every frame of its span').toBe(FRAMES);
    const played = frameAt(frames, below, 'the shot').pixel_hash;
    expect(frameAt(frames, 0, 'the shot').pixel_hash, 'the shot moves: its first frame, above the surface, differs from its frame at 3.5 s, below').not.toBe(played);
    const withOther = hashAt(other!, below, `the shot with ior ${OTHER_IOR}`);
    console.log(`${AC[4]}: not refused: the shot draws; at 3.5 s the default ior draws ${played.slice(0, 12)}, ior ${OTHER_IOR} draws ${withOther.slice(0, 12)}`);
    expect(withOther, `the camera keyed through the surface draws with no issue, so the view must have lifted the refusal, and the view's cone follows ior: but 1.49 m under the surface ior ${OTHER_IOR} draws the default's very frame, so no rule decides it (the merge base draws so)`).not.toBe(played);
  });
});
