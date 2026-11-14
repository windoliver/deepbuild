// AC7 and AC8: a `material@1`'s `maps.base_color` is read from the evidence store and drawn on render-back (AC7); a
// map whose image the store lacks is answered `asset_missing` at `items/paper/params/maps/base_color`, on render-back
// and from view3d (AC8).
//
// Fixture: a 2 × 1.5 m panel (`slab@1` with planar uv0 about z, facing the camera) under the white, unlit material
// `paper`, whose `maps.base_color` is the red 64 px PNG (helpers: RED_PNG, 64 × 64 texels of 255, 0, 0) put into the
// store and listed in the document's `assets`. The panel's colour is the mean over the middle half of its `visible`
// box in the snapshot, each channel 0 to 1. Render-back is the agent's deep_show with pixels and, for AC7, the
// `render_back` call of the revision it made; view3d draws the same items as a session document with `assets`.
// Wrong programs: the base (render-back never sets the scene's texels, so the map draws as the flat white material;
// view3d skips a map whose image it isn't given, with no issue); one that decodes the map but skips a missing one.
import { describe, it } from 'vitest';
import {
  ABSENT, AC, DOC, GREY_SKY, RED_PNG, assetEntry, camera, decodePng, errorIssues, material, meanRgb, none, payload, proof, refusalFailures,
  renderBackCall, requireMetal, rowsOf, runGpu, runShow, scenario, seed, sessionDoc, showCall, snapshotOf, sub, union, useBins, useDir,
  view3dCall, visibleRows, writeJson, type JsonObject, type Scene,
} from './helpers.ts';

const bins = useBins();
const dir = useDir();
const MAP = 'items/paper/params/maps/base_color';

/** The panel under white `paper`, whose base colour map is the image `map` names. The document requires material@1.1,
 * the lowest minor that can define `maps`: the base's material@1 is at minor 0 and lacks it (README: Readings). */
const panelScene = (title: string, map: string): Scene => ({
  title,
  kinds: ['material@1.1'],
  items: {
    cam: camera([0, 0.75, 3], [0, 0.75, 0]), sky: GREY_SKY,
    paper: material({ base_color: [1, 1, 1, 1], unlit: true, maps: { base_color: map } }),
    panel: { kind: 'slab@1', params: { size: [2, 1.5, 0.02], uv0: { planar: { axis: 'z' } }, uv_scale: 1 }, at: { pos: [0, 0, 0] }, material: 'paper' },
  },
  assets: { map: assetEntry(map, 'image') },
});

/** The panel's mean colour in a presented reply's snapshot: over the middle half of its `visible` box. */
function panelColour(reply: JsonObject, store: string, boxFrom: JsonObject, what: string): [number, number, number] {
  const im = decodePng(snapshotOf(reply, store, what).png);
  const rows = rowsOf(visibleRows(boxFrom, `${what}: the deep_show reply`), 'panel');
  if (rows.length === 0) throw Error(`${what}: visible lists no panel, so the panel's pixels can't be found`);
  const [x0, y0, x1, y1] = union(rows.map((r) => r.box));
  const clamp = (v: number, hi: number): number => Math.min(Math.max(Math.round(v), 0), hi);
  const [w, h] = [x1 - x0, y1 - y0];
  return meanRgb(im, [clamp(x0 + w / 4, im.width), clamp(y0 + h / 4, im.height), clamp(x1 - w / 4, im.width), clamp(y1 - h / 4, im.height)]);
}

describe(`${AC[7]} a material's base colour map is read from the store and drawn on render-back`, () => {
  it(`${AC[7]} the panel under white paper with the red PNG as maps.base_color has mean red at least 0.3 above its green`, () => {
    requireMetal();
    const store = sub(dir(), 'store');
    const red = seed(store, RED_PNG());
    const [shown, back] = runShow(bins.show(), scenario(store, [DOC(1)], [showCall(DOC(1), payload(panelScene('A mapped panel', red))), renderBackCall(DOC(1), 1)]), 'the mapped panel');
    none(errorIssues(shown!).map((x) => JSON.stringify(x)), 'the mapped panel is checked with no error issue');
    const failures: string[] = [];
    for (const [surface, reply] of [['deep_show', shown!], ['render_back', back!]] as const) {
      const [r, g, b] = panelColour(reply, store, shown!, `the mapped panel's ${surface}`);
      proof(`${surface}: the panel's mean colour (red, green, blue)`, [r, g, b].map((v) => Number(v.toFixed(4))));
      if (!(r - g >= 0.3)) failures.push(`${surface}: the panel's mean red ${r.toFixed(3)} is ${(r - g).toFixed(3)} above its green ${g.toFixed(3)}, not at least 0.3: the map at ${MAP} (${red.slice(0, 12)}…) isn't drawn`);
    }
    none(failures, 'the base colour map is drawn on render-back');
  }, 1_800_000);
});

describe(`${AC[8]} a map whose image the store lacks is asset_missing at its path, on render-back and from view3d`, () => {
  it(`${AC[8]} asset_missing at ${MAP} from deep_show and from view3d`, () => {
    requireMetal();
    const store = sub(dir(), 'store');
    const out = sub(dir(), 'out');
    const scene = panelScene('A panel whose map is missing', ABSENT);
    const [shown] = runShow(bins.show(), scenario(store, [DOC(1)], [showCall(DOC(1), payload(scene))]), 'the panel whose map the store lacks');
    const [viewed] = runGpu(bins.gpu(), out, [view3dCall(writeJson(out, 'panel', sessionDoc('panel-doc', scene)), {}, ['final'])], 'view3d of the panel whose map it lacks');
    proof('the missing map: deep_show and view3d replies', [shown!, viewed!]);
    none([
      ...refusalFailures(shown!, 'asset_missing', MAP, 'the map', 'deep_show of the panel whose map the store lacks'),
      ...refusalFailures(viewed!, 'asset_missing', MAP, 'the map', 'view3d of the panel whose map it isn\'t given'),
    ], 'a missing map is refused at its path');
  }, 1_800_000);
});
