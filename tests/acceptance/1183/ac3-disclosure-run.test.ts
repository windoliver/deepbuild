// #1183.2a50d207 (AC3): "Over a recorded run where the exaggerated dot leaves the frame and comes back, its disclosure
// is readable on every frame where the dot is on screen. A planted disclosure with `show` false for 10 frames while the
// dot is on screen fails, naming the overlay and the first frame."
//
// Fixtures (helpers.ts, electronFigure). The electron figure's run: 6 s at 60 frames a second (360 frames), its logic
// stepped at 60 Hz on its input track. The drift is 8.8146e-9 m (the dot drawn 1.76 mm along the wire, near the frame's
// centre) except over steps 180 to 239, where it is 1 mm, so the dot is drawn 200 m along x, far off the frame: it
// leaves at frame 180 (3 s) and comes back at frame 240 (4 s). The disclosure `disclosure` (overlay.text@1 in a corner)
// is shown by the bool channel `blink` on its `show`, false only over frames 195 to 224, inside the dot's time off the
// frame. The planted twin `hidden` has `blink` false over frames 90 to 99 as well, while the dot is on screen.
//
// asserts:
//   - the figure's honest-numbers row PASSes with nothing raised: on each of the 300 frames the dot is on screen its
//     disclosure reads, and the 30 frames it hides with the dot off the frame are allowed;
//   - the twin's row FAILs with a length.disclosure_hidden error naming disclosure at its first frame, frame 90: `t`
//     1.5 s within half a frame (or `frame: 90`).
// Wrong programs it fails: the base; a check that asks the disclosure on every frame, the dot's or not (fails the
// figure on frames 195 to 224); one that reads `show` once, or only on the first frame (passes the twin); one that names
// a later frame (195, the first hidden frame with the dot off) or the dot instead of the overlay.
import { describe, it } from 'vitest';
import { AC, DISCLOSURE_HIDDEN, FPS, HIDE_ON, TIMEOUT, brief, docId, electronFigure, failsWith, field, judge, mentions, none, passFailures, secondsOf, useFolders, useShow } from './helpers.ts';

const bin = useShow();
const folder = useFolders();
const FIRST = HIDE_ON[0];

describe(`${AC[3]} a disclosure readable whenever its item is on screen`, () => {
  it(`${AC[3]} over a run where the dot leaves the frame and comes back its disclosure reads on every frame the dot is on screen; hidden 10 frames while it is, it fails naming the overlay and frame 90`, () => {
    const figs = [electronFigure(docId(1), 'none'), electronFigure(docId(2), 'hidden')];
    const { judged } = judge(bin(), folder(), figs);
    const run = judged[figs[0]!.name]?.row;
    const hidden = judged[figs[1]!.name]?.row;
    none([
      ...passFailures(run, 'the run where the dot leaves the frame and comes back'),
      ...failsWith(hidden, DISCLOSURE_HIDDEN, {
        subject: 'the overlay disclosure', match: (i) => mentions(i, 'disclosure'),
        also: (i) => {
          const t = secondsOf(field(i, 't'));
          const atFirst = (t !== null && Math.abs(t - FIRST / FPS) <= 0.5 / FPS) || field(i, 'frame') === FIRST;
          return atFirst ? null : `it names t = ${brief(field(i, 't'))}, frame ${brief(field(i, 'frame'))}, not the first hidden frame ${FIRST} (${FIRST / FPS} s)`;
        },
      }, 'the disclosure hidden for 10 frames while the dot is on screen'),
    ], 'the disclosure over the run');
  }, TIMEOUT);
});
