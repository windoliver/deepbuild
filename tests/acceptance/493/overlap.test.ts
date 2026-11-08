// AC4 #493.07d4fcd4: Two shots that overlap outside a transition joining them are refused at check naming both,
// whether they share a camera or not.
//
// Through `deep-motion eval`: `shot-early` [0, 2 s) and `shot-late` [1.5 s, 3 s), on one camera and on two; each is
// refused, naming both IDs (no code is pinned). The twins that must stay accepted: the same two shots made adjacent
// (2 s) and joined by a 1 s cross-fade, whose window runs each side past its own end; and adjacent ones on two
// cameras joined by a cut. So a check that refuses every transition window, or none, fails.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, box3d, camera3d, evalOne, film, fl, mentions, refused, shot, show, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();
const doc = (late: JsonObject, transitions?: JsonObject): JsonObject => film('overlap', [camera3d(), camera3d({ orbit: { azimuth: -30, elevation: 20, distance: 12 } }, 'cam-2'), box3d('box', [0, 0, 0], 1)], {
  shots: { 'shot-early': shot(0, 2, { target: [0, 0, 0] }), 'shot-late': late },
  ...(transitions ? { transitions } : {}),
});
const TIMES = [0, fl(1), fl(1.75), fl(2.5)];

describe(`${AC[4]} overlapping shots are refused at check, naming both`, () => {
  it(`${AC[4]} two overlapping shots on one camera are refused naming both, and on two cameras too`, () => {
    for (const [what, late] of [
      ['one camera', shot(1.5, 3, { target: [1, 0, 0] })],
      ['two cameras', shot(1.5, 3, { camera: 'cam-2', target: [1, 0, 0] })],
    ] as [string, JsonObject][]) {
      const answer = refused(evalOne(motion.bin(), { doc: doc(late), times: TIMES }), `shots overlapping on ${what}`);
      expect(mentions(answer, 'shot-early') && mentions(answer, 'shot-late'), `the refusal on ${what} names both shots: ${show(answer)}`).toBe(true);
    }
  }, TIMEOUT);

  it(`${AC[4]} adjacent shots joined by a cross-fade, and adjacent shots on two cameras joined by a cut, are accepted`, () => {
    const xfade = evalOne(motion.bin(), { doc: doc(shot(2, 3.5, { target: [1, 0, 0] }), { xf: { from: 'shot-early', to: 'shot-late', kind: 'cross_fade', span: '1s' } }), times: TIMES });
    expect(xfade['ok'], `adjacent shots joined by a 1 s cross-fade are accepted: ${show(xfade)}`).toBe(true);
    const cut = evalOne(motion.bin(), { doc: doc(shot(2, 3.5, { camera: 'cam-2', target: [1, 0, 0] }), { k: { from: 'shot-early', to: 'shot-late', kind: 'cut' } }), times: TIMES });
    expect(cut['ok'], `adjacent shots on two cameras joined by a cut are accepted: ${show(cut)}`).toBe(true);
  }, TIMEOUT);
});
