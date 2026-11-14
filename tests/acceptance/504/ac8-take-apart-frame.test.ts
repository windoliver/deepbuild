// #504.a17a1463: "A take-apart shot that keeps every part has every part's bounds inside the safe frame at all 30
// samples a second"
//
// The box figure (helpers.ts `boxFigure`) taken apart at 1 s and back at 4 s, with one timeline shot `apart-shot` over
// its whole 6 s span that keeps every part (`frame.keep: [plate, shell, cover, cap]`, fill 0.6) on its perspective
// camera. At rest the parts stand 0.33 m tall; taken apart, 0.93 m, the cap 0.25 m to the side. The document is
// 1920 × 1080 px with the envelope's default safe area, 24 px in from each edge.
//
// asserts, through `deep-motion eval` with `project` (#493: each item's projected bounds, `projected.<id>.box`, in px
// through the pose the frame reports): at every one of the 180 samples k ÷ 30 s of the shot, each part's box lies
// inside the safe frame. The planted `framer_ignores_apart` (eval `planted`: the shot's framing bounds its kept parts
// at rest, ignoring the apart offsets the take-apart moves them by) fails it, naming the cap and a sample.
import { describe, expect, it } from 'vitest';
import { PARTS, TIMEOUT, boxFigure, boxOf, brief, evalFrames, failsNaming, grid, none, safeFrame, useBins, type Frame } from './helpers.ts';

/** The criterion's ID: `#504.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#504.a17a1463';

const bin = useBins(['motion']);

const KEEP = Object.keys(PARTS);
const DOC = boxFigure({ shots: { 'apart-shot': { start: '0s', end: '6s', camera: 'cam', move: 'hold', frame: { keep: KEEP, fill: 0.6 } } } });
const SAFE = safeFrame(DOC);
const SAMPLES = grid(30, 0, 6);

function safeFailures(frames: Frame[], what: string): string[] {
  return frames.flatMap((f, k) => KEEP.flatMap((id) => {
    const b = boxOf(f, id, what);
    const inside = b[0] >= SAFE[0] && b[1] >= SAFE[1] && b[2] <= SAFE[2] && b[3] <= SAFE[3];
    return inside ? [] : [`${what}: ${id} leaves the safe frame at sample ${k} (${k}/30 s): its box ${brief(b)} against ${brief(SAFE)}`];
  }));
}

describe(`${ID} a take-apart shot keeps every part in the safe frame`, () => {
  it(`${ID} every part's projected bounds lie inside the safe frame at all 180 samples, 30 a second, as the figure comes apart and back; a planted framer that ignores the apart offsets fails, naming the cap`, () => {
    expect(SAMPLES.length, 'the 6 s shot has 180 samples at 30 a second').toBe(180);
    const frames = evalFrames(bin('motion'), { doc: DOC, times: SAMPLES, project: KEEP }, 'the take-apart shot');
    none(safeFailures(frames, 'the take-apart shot'), 'every part inside the safe frame at every sample');
    const planted = evalFrames(bin('motion'), { doc: DOC, times: SAMPLES, project: KEEP, planted: 'framer_ignores_apart' }, 'the planted framer');
    failsNaming(safeFailures(planted, 'the planted framer'), ['cap leaves the safe frame'], 'the planted framer that ignores the apart offsets');
  }, TIMEOUT);
});
