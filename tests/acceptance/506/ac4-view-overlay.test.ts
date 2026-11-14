// AC4: "A 3D film with an overlay.view in the bottom-right quarter of the safe frame draws inside its rect pixels equal,
// within one code value on one machine, to the same document rendered at t from that camera at the rect's size; a view
// overlay asked inside another view is refused naming it; and camera.framing finds the main shot's kept items clear of
// the rect at every sampled time"
//
// The fixture (helpers.ts: filmDoc): a 4 s film, 640 × 360 with a 24 px safe area, its main shot `main` holding the
// camera's pose; a kept box `hero` up and left, a box turning and a ball rolling. The view overlay `pip` shows the
// collection `stage` (every drawn item and the lights) from `pip-cam` at size [0.5, 0.5] of the safe frame, anchored
// by default: the bottom-right quarter, the rect x 320 to 616 px and y 180 to 336 px.
//
// asserts:
//   - through `view3d`, frames 1, 3, 5 and 7 at 2 fps (0.5 s to 3.5 s): every pixel of the rect at least 2 px inside its
//     edges (its border may take the outer 2 px) equals, within one code value, the pixel at the same place in the
//     same document without `pip`, seen through `pip-cam` at 296 × 156 px at that frame, all in one run on this machine;
//     guard: that render changes between 0.5 s and 3.5 s;
//   - through `view3d`: the film with a second view overlay `pip2` inside `pip`'s collection is refused at check, and
//     the refusal names `pip2`;
//   - through `deep-show run`'s `verdict` (#1938's `camera.framing` check as a claim's requirement, keep `hero`): the
//     film PASSes with nothing raised; its twin, whose channel carries `hero` into the rect from 2 s to 3 s, FAILs with
//     a camera.framing issue naming `hero`.
// Wrong programs: the base (no overlay.view); a view drawn at another time, through another look or scaled from a
// render of another size; a view that nests; a framing check that ignores the overlay.
import { describe, expect, it } from 'vitest';
import {
  FILM, TIMEOUT, ac, claimId, claimOf, codeOff, docId, filmDoc, finalOf, frameAt, framesOf, look, none, px, refusedNaming, reqId, requireGpu, rgbText,
  rowOf, runGpu, runShow, scenarioOf, stored, through, useBins, useDir, view3d, writeJson, type JsonObject,
} from './helpers.ts';

const bin = useBins(['deep-gpu', 'deep-show']);
const dir = useDir();
const [RX, RY, RW, RH] = FILM.rect;

describe(`${ac(4)} a view overlay: its pixels, its nesting, and framing clear of it`, () => {
  it(`${ac(4)} the overlay in the bottom-right quarter of the safe frame equals the document rendered at t from its camera at the rect's size, and a view inside a view is refused naming it`, () => {
    requireGpu();
    const out = dir();
    const frames = { fps: FILM.fps, from: 0, frames: 8, capture: [...FILM.sampled] };
    const calls = [
      view3d({ doc: writeJson(out, 'film', filmDoc()), look: look(), size: FILM.size, ...frames }),
      view3d({ doc: writeJson(out, 'film-from-pip', through(filmDoc({ pip: false }), 'pip-cam')), look: look(), size: [RW, RH], ...frames }),
      view3d({ doc: writeJson(out, 'film-nested', filmDoc({ nested: true })), look: look(), size: FILM.size }),
    ];
    const [main, alone, nested] = runGpu(bin('deep-gpu'), out, calls);
    refusedNaming(nested!, ['pip2'], 'a view overlay asked inside another view');
    const mainFrames = framesOf(main!, 'the film');
    const aloneFrames = framesOf(alone!, 'the film from pip-cam');
    const failures: string[] = [];
    const first = finalOf(out, frameAt(aloneFrames, FILM.sampled[0]!, 'from pip-cam'), 'from pip-cam, first');
    const last = finalOf(out, frameAt(aloneFrames, FILM.sampled[FILM.sampled.length - 1]!, 'from pip-cam'), 'from pip-cam, last');
    let moved = 0;
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) if (codeOff(px(first, x, y), px(last, x, y)) > 3) moved++;
    expect(moved, 'the guard: the film seen from pip-cam changes between 0.5 s and 3.5 s').toBeGreaterThanOrEqual(200);
    for (const n of FILM.sampled) {
      const im = finalOf(out, frameAt(mainFrames, n, 'the film'), `the film at frame ${n}`);
      const ref = finalOf(out, frameAt(aloneFrames, n, 'from pip-cam'), `from pip-cam at frame ${n}`);
      expect([im.width, im.height, ref.width, ref.height], 'the frames have the sizes asked').toEqual([...FILM.size, RW, RH]);
      let bad = 0; let at = ''; let judged = 0;
      for (let y = RY + 2; y < RY + RH - 2; y++) for (let x = RX + 2; x < RX + RW - 2; x++) {
        judged++;
        const got = px(im, x, y); const want = px(ref, x - RX, y - RY);
        if (codeOff(got, want) > 1) { bad++; if (!at) at = `(${x}, ${y}) reads ${rgbText(got)}, the render from pip-cam ${rgbText(want)}`; }
      }
      if (bad) failures.push(`frame ${n} (t = ${n / FILM.fps} s): ${bad} of ${judged} pixels of pip's rect are off the document rendered from pip-cam at ${RW} × ${RH} by more than one code value; first ${at}`);
    }
    none(failures, "the view overlay's rect equals its camera's own render");
  }, TIMEOUT);

  it(`${ac(4)} camera.framing finds the main shot's kept item clear of the overlay's rect at every sampled time, and fails a film that carries it under the rect, naming it`, () => {
    const out = dir();
    const docs: Record<string, JsonObject> = {
      [docId(41)]: { panel: 'main', document: stored(filmDoc()) },
      [docId(42)]: { panel: 'main', document: stored(filmDoc({ wander: true })) },
    };
    const check: JsonObject = { kind: 'camera.framing', keep: ['hero'] };
    const claims: JsonObject = { [claimId(41)]: claimOf(docId(41), reqId(41), check), [claimId(42)]: claimOf(docId(42), reqId(42), check) };
    const [clean, wander] = runShow(bin('deep-show'), scenarioOf({
      evidence: out, panels: { main: [0, 0, ...FILM.size] }, docs, claims,
      calls: [{ call: 'verdict', claim: claimId(41) }, { call: 'verdict', claim: claimId(42) }],
    }), 'camera.framing on the film');
    const a = rowOf(clean!, reqId(41), 'the film');
    const b = rowOf(wander!, reqId(42), 'the film whose hero wanders under the rect');
    const failures: string[] = [];
    if (a.result !== 'PASS') failures.push(`the film: camera.framing is ${a.result}, not PASS: ${JSON.stringify(a.raw).slice(0, 1200)}`);
    for (const i of a.issues) failures.push(`the film: camera.framing raises ${i.code} (${i.severity}) on ${i.ids.join(', ')}`);
    if (b.result !== 'FAIL') failures.push(`the film whose hero wanders under the rect: camera.framing is ${b.result}, not FAIL: ${JSON.stringify(b.raw).slice(0, 1200)}`);
    if (!b.issues.some((i) => i.check === 'camera.framing' && i.ids.includes('hero'))) failures.push(`the film whose hero wanders under the rect: no camera.framing issue names hero; raised: ${JSON.stringify(b.issues).slice(0, 800)}`);
    none(failures, "camera.framing keeps the main shot's kept items clear of the view overlay");
  }, TIMEOUT);
});
