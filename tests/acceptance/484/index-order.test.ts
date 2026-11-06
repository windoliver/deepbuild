// #484.7e241cd4: "Survivors keep index order wherever picks or ties read it: in an instancer whose ids run 5,000 to
// 5,999, coplanar twins 5,010 and 5,011 show 5,011, drawn later, at every frame of a 10 s orbit, and with every element
// below 5,500 culled a click on element 5,742 names trees#5742; a planted compaction in reverse index order shows
// 5,010, and a planted object-ID pass that writes each row's place in the compacted list names another element, each
// failing, naming the pixel"
//
// Both fixtures: an `instance@1` `trees` of 1,000 unlit 1 m boxes, above the 256 elements that go to the GPU, row i
// holding ID 5,000 + i, in one batch; its prototype is not drawn itself.
//
// The twins: rows 10 and 11 stand at the origin, the same box in the same place, so every pixel of it is a depth tie.
// The other rows spiral out from 3 m to 253 m on the ground plane, so the frustum cuts a different set from pose to
// pose and none covers the origin (from 35° up, a ray to the origin is 2.1 m high 3 m out; the boxes are 1 m). The
// camera orbits the origin once in 10 s, looking at it, so the twins hold the frame's centre. Sampled at 6 frames a
// second, frames 0 to 60 (README: Readings); each frame has one click at pixel (160, 90), and each must name
// trees#5011, with one indirect draw for the view, so the compacted draw is what's judged.
//
// The cull: an orthographic view, 60 m across 640 × 360. Rows 0 to 499 (IDs below 5,500) stand 2 km away, outside it;
// rows 500 to 999 stand in a 50 × 10 grid on a 1 m pitch in the frame, so element 5,742 is at place 242 in the
// compacted list and at row 742 of the instancer. `cull_report` holds what the view kept to exactly 5,500 to 5,999, in
// order, and the click at 5,742's pixel must name trees#5742.
//
// `--planted compact_in_reverse` shows 5,010 at the twins' pixel; `--planted ids_by_compacted_row` names another
// element at 5,742's: each fails naming that pixel.
import { describe, it } from 'vitest';
import {
  AC, DARK_SKY, ORBIT, box, camera, failsNaming, framesOf, frameAt, keptIn, none, ortho, orbitChannels, orbitPosition, orthoProject, requireGpu, run, sceneDoc, unlit, useGpu, useOut, view3dCall, writeJson,
  type JsonObject, type Planted, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const N = 1000;
const FIRST_ID = 5000;
const ids = Array.from({ length: N }, (_, i) => FIRST_ID + i);
const prototype = (extra: JsonObject = {}): Record<string, JsonObject> => ({
  sky: DARK_SKY, tree_mat: unlit([0.6, 0.3, 0.1]),
  tree: box([1, 1, 1], [0, 0, 0], { material: 'tree_mat', visible: false, ...extra }),
});

const TWIN_SIZE: [number, number] = [320, 180];
const TWIN_PIXEL: [number, number] = [TWIN_SIZE[0] / 2, TWIN_SIZE[1] / 2];
function twinDoc(): JsonObject {
  const pos: V3[] = ids.map((_, i) => {
    if (i === 10 || i === 11) return [0, 0, 0];
    const r = 3 + 0.25 * i; const a = i * 2.399963;
    return [r * Math.cos(a), 0, r * Math.sin(a)];
  });
  return sceneDoc('twins-484', TWIN_SIZE, {
    cam: camera(orbitPosition(20, 0, 35), [0, 0, 0], 50), ...prototype(),
    trees: { kind: 'instance@1', params: { of: ['tree'], ids, pos } },
  }, { channels: orbitChannels(20, 35) });
}
function twinProblems(planted?: Planted): string[] {
  const out = dir();
  const [x, y] = TWIN_PIXEL;
  const doc = writeJson(out, 'twins', twinDoc());
  const clicks = Array.from({ length: ORBIT.frames }, (_, frame) => ({ frame, at: [x + 0.5, y + 0.5] as [number, number] }));
  const [reply] = run(bin(), out, [view3dCall({ doc, size: TWIN_SIZE, ...ORBIT, capture: 'every', counts: true, clicks })], planted);
  const frames = framesOf(reply!, 'the twins');
  const problems: string[] = [];
  for (let n = 0; n < ORBIT.frames; n++) {
    const f = frameAt(frames, n, 'the twins');
    if (f.clicks[0] !== 'trees#5011') problems.push(`frame ${n}, pixel (${x}, ${y}): the twins show ${f.clicks[0] ?? 'nothing'}, not trees#5011, drawn later`);
    const draws = (f.indirect ?? []).filter((d) => d.item === 'trees' && d.view === 'view');
    if (draws.length !== 1) problems.push(`frame ${n}: ${draws.length} indirect draws of trees in the view, not one`);
  }
  return problems;
}

const CULL_SIZE: [number, number] = [640, 360];
const CULL_VIEW = 60;
const inGrid = (i: number): [number, number] => { const j = i - 500; return [-24.5 + (j % 50), -4.5 + Math.floor(j / 50)]; };
function cullDoc(): JsonObject {
  const pos = ids.map((_, i) => (i < 500 ? [-2000 - i, 0, 0] : [...inGrid(i), 0]));
  return sceneDoc('culled-484', CULL_SIZE, { cam: ortho(CULL_VIEW), ...prototype(), trees: { kind: 'instance@1', params: { of: ['tree'], ids, pos } } });
}
function pixelOf(id: number): [number, number] {
  const [sx, sy] = orthoProject(CULL_VIEW, CULL_SIZE, ...inGrid(id - FIRST_ID));
  return [Math.floor(sx), Math.floor(sy)];
}
function pickProblems(planted?: Planted): string[] {
  const out = dir();
  const doc = writeJson(out, 'culled', cullDoc());
  const [x, y] = pixelOf(5742);
  const [reply] = run(bin(), out, [view3dCall({ doc, size: CULL_SIZE, cull_report: true, clicks: [{ frame: 0, at: [x + 0.5, y + 0.5] }] })], planted);
  const f = frameAt(framesOf(reply!, 'the culled instancer'), 0, 'the culled instancer');
  const problems: string[] = [];
  const kept = keptIn(out, f, 'trees', 'view', 'the culled instancer');
  const want = ids.slice(500);
  if (kept.length !== want.length) problems.push(`the view kept ${kept.length} elements, not the ${want.length} from 5,500 to 5,999`);
  const at = want.findIndex((id, r) => kept[r] !== id);
  if (at >= 0) problems.push(`the compacted list's place ${at} holds ${String(kept[at])}, not ${want[at]}`);
  if (f.clicks[0] !== 'trees#5742') problems.push(`pixel (${x}, ${y}), element 5,742: the click names ${f.clicks[0] ?? 'nothing'}, not trees#5742`);
  return problems;
}

describe(`${AC[2]} survivors keep index order wherever picks or ties read it`, () => {
  it(`${AC[2]} coplanar twins 5,010 and 5,011 show 5,011 at every frame of a 10 s orbit, and with every element below 5,500 culled a click on element 5,742 names trees#5742`, () => {
    requireGpu();
    none(twinProblems(), 'the twins over the orbit');
    none(pickProblems(), 'the pick after the cull');
  }, 3_600_000);

  it(`${AC[2]} a planted compaction in reverse index order (--planted compact_in_reverse) shows 5,010 and fails, naming the pixel`, () => {
    requireGpu();
    const [x, y] = TWIN_PIXEL;
    failsNaming(twinProblems('compact_in_reverse'), [`pixel (${x}, ${y}): the twins show trees#5010`], '--planted compact_in_reverse');
  }, 3_600_000);

  it(`${AC[2]} a planted object-ID pass that writes each row's place in the compacted list (--planted ids_by_compacted_row) names another element and fails, naming the pixel`, () => {
    requireGpu();
    const [x, y] = pixelOf(5742);
    failsNaming(pickProblems('ids_by_compacted_row'), [new RegExp(`pixel \\(${x}, ${y}\\), element 5,742: the click names trees#(?!5742\\b)\\d+`)], '--planted ids_by_compacted_row');
  }, 3_600_000);
});
