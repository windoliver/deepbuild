// AC7: "A 3D figure with a mirror, a transmissive part that reads backdrop and 40 lights over the light cut, viewed
// through an orthographic main camera with a perspective overlay.view at a quarter of its size from another side, draws
// in the overlay's rect pixels equal, within one code value on one machine, to the same document rendered alone from
// the overlay's camera at the rect's size, and the main view equal to its render alone; a planted core that keeps one
// backdrop, mirror or light cut per frame fails, naming the view and the state"
//
// The fixture (helpers.ts: figureDoc): a mirror floor, a glass block (transmission 1: it reads the backdrop) before
// three opaque blocks, and 40 point lights, 20 on the main camera's side and 20 on the overlay camera's, 640 × 360. The
// main camera is orthographic from the front; `pip`, a perspective `overlay.view@1` from the +X side at size [0.5, 0.5]
// of the safe frame (a quarter of it: the rect x 320 to 616 px, y 180 to 336 px), includes the whole figure.
//
// asserts, through `view3d` in one run on this machine:
//   - guards: the document without `pip`, rendered alone through `pip-cam` at 296 × 156 and through `cam` at 640 × 360,
//     reports (`light_cut: true`) 32 shaded lights each and two different cuts;
//   - every pixel of the rect at least 2 px inside its edges equals, within one code value, the same place in the render
//     alone from `pip-cam`; every pixel of the main view at least 2 px outside the rect equals the render alone from
//     `cam` within one code value;
//   - under each of `--planted one_backdrop_per_frame`, `one_mirror_per_frame` and `one_light_cut_per_frame` (the
//     overlay's view reads the main view's backdrop, mirror or light cut from the same frame), the same comparison
//     fails, and a failure names the view `pip` and the state: the rect's mismatching pixels are told apart by what
//     the render alone shows there (object-ID target): the mirror floor's pixels name `mirror`, the glass's name
//     `backdrop`, every other pixel names `light cut`.
// Wrong programs: the base (no overlay.view); each planted core above.
import { describe, expect, it } from 'vitest';
import {
  FIGURE, FIGURE_PIP, STATE_OF, TIMEOUT, ac, codeOff, failsNaming, figureDoc, finalOf, frameAt, framesOf, idsOf, look, none, px, requireGpu, rgbText,
  runGpu, through, useBins, useDir, view3d, writeJson, type Ids, type Image, type Planted,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const dir = useDir();
const [RX, RY, RW, RH] = FIGURE.rect;

/** The failures of a main frame against the two renders alone, the rect's grouped by the state its pixels read most. */
function viewFailures(main: Image, pipAlone: Image, mainAlone: Image, ids: Ids, what: string): string[] {
  const failures: string[] = [];
  const byState = new Map<string, { n: number; first: string }>();
  let judged = 0;
  for (let y = RY + 2; y < RY + RH - 2; y++) for (let x = RX + 2; x < RX + RW - 2; x++) {
    judged++;
    const got = px(main, x, y); const want = px(pipAlone, x - RX, y - RY);
    if (codeOff(got, want) <= 1) continue;
    const state = STATE_OF[ids.at(x - RX, y - RY) ?? ''] ?? 'light cut';
    const s = byState.get(state) ?? { n: 0, first: `(${x}, ${y}) reads ${rgbText(got)}, alone ${rgbText(want)}` };
    s.n++; byState.set(state, s);
  }
  for (const [state, s] of byState) failures.push(`${what}: view pip: ${s.n} of ${judged} pixels where its ${state} shows are off its render alone by more than one code value; first ${s.first}`);
  let outside = 0; let bad = 0; let first = '';
  for (let y = 0; y < main.height; y++) for (let x = 0; x < main.width; x++) {
    if (x >= RX - 2 && x < RX + RW + 2 && y >= RY - 2 && y < RY + RH + 2) continue;
    outside++;
    if (codeOff(px(main, x, y), px(mainAlone, x, y)) > 1) { bad++; if (!first) first = `(${x}, ${y}) reads ${rgbText(px(main, x, y))}, alone ${rgbText(px(mainAlone, x, y))}`; }
  }
  if (bad) failures.push(`${what}: the main view: ${bad} of ${outside} pixels outside pip's rect are off its render alone by more than one code value; first ${first}`);
  return failures;
}

describe(`${ac(7)} each view keeps its own backdrop, mirror and light cut`, () => {
  it(`${ac(7)} the overlay's rect equals the figure rendered alone from its camera, the main view equals its own render alone, and each planted core that keeps one state per frame fails naming the view and the state`, () => {
    requireGpu();
    const out = dir();
    const withPip = writeJson(out, 'figure-pip', figureDoc(true));
    const alone = figureDoc(false);
    const [mainR, pipAloneR, mainAloneR] = runGpu(bin('deep-gpu'), out, [
      view3d({ doc: withPip, look: look(), size: FIGURE.size }),
      view3d({ doc: writeJson(out, 'figure-from-pip', through(alone, 'pip-cam')), look: look(), size: FIGURE_PIP.size, targets: ['final', 'ids'], light_cut: true }),
      view3d({ doc: writeJson(out, 'figure-alone', alone), look: look(), size: FIGURE.size, light_cut: true }),
    ]);
    const one = (r: typeof mainR, what: string) => frameAt(framesOf(r!, what), 0, what);
    const pipFrame = one(pipAloneR, 'the figure alone from pip-cam');
    const mainFrame = one(mainAloneR, 'the figure alone from cam');
    expect(pipFrame.lightCut?.length, 'the fixture: the render alone from pip-cam shades 32 of the 40 lights').toBe(32);
    expect(mainFrame.lightCut?.length, 'the fixture: the render alone from cam shades 32 of the 40 lights').toBe(32);
    expect(pipFrame.lightCut, 'the fixture: the two views cut different lights').not.toEqual(mainFrame.lightCut);
    const pipAlone = finalOf(out, pipFrame, 'from pip-cam');
    const mainAlone = finalOf(out, mainFrame, 'from cam');
    const ids = idsOf(out, pipFrame, 'from pip-cam');
    none(viewFailures(finalOf(out, one(mainR, 'the figure with pip'), 'the figure with pip'), pipAlone, mainAlone, ids, 'the figure with pip'), 'each view of the figure keeps its own state');

    const plants: [Planted, string][] = [['one_backdrop_per_frame', 'backdrop'], ['one_mirror_per_frame', 'mirror'], ['one_light_cut_per_frame', 'light cut']];
    for (const [planted, state] of plants) {
      const [r] = runGpu(bin('deep-gpu'), out, [view3d({ doc: withPip, look: look(), size: FIGURE.size })], planted);
      const failures = viewFailures(finalOf(out, one(r, `planted ${planted}`), `planted ${planted}`), pipAlone, mainAlone, ids, `planted ${planted}`);
      failsNaming(failures, ['view pip', `its ${state} shows`], `the planted core ${planted}`);
    }
  }, TIMEOUT);
});
