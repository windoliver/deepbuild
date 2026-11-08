// AC4 #496.2552ca08: On a circle path of radius 100 u, a monospaced run whose advance is 20 u with offset 50 u puts
// grapheme 2's centre at arc length 100 u, at (100·cos 1, 100·sin 1) in the path's space within 0.1 u, turned to the
// tangent there within 0.1°; with repeat and offset keyed from 0 to the run's advance over 4.7 s with cycle
// extrapolation, the frame at 4.7 s places every grapheme where the frame at 0 does; a planted layout that puts each
// grapheme's left edge on its arc-length point lands grapheme 2 10 u further along and fails, naming the grapheme.
//
// The circle is a path@1 item, `ring`, eight cubics about the origin starting at (100, 0) with the angle increasing,
// and neither item has an `at`, so the path's space is the document's. ABCDE in the mono role at 100/3 u advances 20 u
// a grapheme (JetBrains Mono's 600 of 1,000), which the test reads before it judges anything. A grapheme's centre is
// its advance midpoint on its baseline, mapped through the glyph's `transform`; its turn is the transform's x axis.
// The tangent at arc length s is the angle s ÷ 100 rad plus 90°. The repeat film also has a guard: the frame at
// 2.35 s, half a run along, doesn't match frame 0, so an offset that never moves can't pass.
import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, angleGap, angleOf, centreOf, channel, circleD, drawn, failsNaming, film, fl, none, raster, textItem, textOf, useRender,
  type Glyph, type JsonObject, type Text,
} from './helpers.ts';

const render = useRender();

const R = 100;
const ring: JsonObject = { id: 'ring', kind: 'path@1', layer: 'main', name: 'ring', order: 'a0', params: { d: circleD(R), paint: { stroke: { width: 1, role: 'muted' } } } };
const arc = (onCurve: JsonObject): JsonObject => textItem('arc', { text: 'ABCDE', font: 'mono', size: 100 / 3, on_curve: { path: 'ring', ...onCurve } }, null);
const PLACED = film('text-on-circle', [ring, arc({ offset: 50 })], {}, '6s', [480, 320]);
const REPEATED = film('text-on-circle-repeat', [ring, arc({ offset: 0, repeat: true })], {
  channels: { slide: channel('items/arc/params/on_curve/offset', [[0, 0], [4.7, 100]], { extrapolate: { before: 'hold', after: 'cycle' } }) },
}, '6s', [480, 320]);

const deg = (rad: number): number => (rad * 180) / Math.PI;
/** Arc length along the circle to a point near it, from (R, 0), the angle increasing. */
const arcLength = ([x, y]: [number, number]): number => R * (((Math.atan2(y, x) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));

/** Where grapheme 2 isn't at arc length 100 u, at (100·cos 1, 100·sin 1), turned to the tangent, naming the grapheme. */
function placeFailures(text: Text): string[] {
  const g = text.glyphs.find((x) => x.grapheme === 2);
  if (!g) return ['grapheme 2 is not drawn'];
  const [x, y] = centreOf(g);
  const want: [number, number] = [R * Math.cos(1), R * Math.sin(1)];
  const out: string[] = [];
  const off = Math.hypot(x - want[0], y - want[1]);
  if (!(off <= 0.1)) out.push(`grapheme 2's centre is at (${x}, ${y}), arc length ${arcLength([x, y])} u, ${off} u from (${want[0]}, ${want[1]})`);
  const turn = angleGap(angleOf(g), deg(1) + 90);
  if (!(turn <= 0.1)) out.push(`grapheme 2 is turned to ${angleOf(g)}°, ${turn}° off the tangent ${deg(1) + 90}°`);
  return out;
}

/** Glyphs of `a` with no glyph of `b` drawing the same glyph at the same centre (0.1 u) and turn (0.1°). */
function unmatched(a: Glyph[], b: Glyph[]): Glyph[] {
  const left = [...b];
  return a.filter((g) => {
    const [x, y] = centreOf(g);
    const j = left.findIndex((h) => h.id === g.id && Math.hypot(centreOf(h)[0] - x, centreOf(h)[1] - y) <= 0.1 && angleGap(angleOf(h), angleOf(g)) <= 0.1);
    if (j < 0) return true;
    left.splice(j, 1);
    return false;
  });
}

describe(`${AC[4]} text on a circle: each grapheme's centre on the path by arc length, turned to the tangent`, () => {
  it(`${AC[4]} with offset 50 u, grapheme 2 of a 20 u monospaced run is centred at arc length 100 u, at (100·cos 1, 100·sin 1) within 0.1 u, turned to the tangent within 0.1°`, () => {
    const text = textOf(drawn(raster(render, PLACED, [{ t: 0 }]), 'the text on the circle')[0]!, 'arc', 'the text on the circle');
    expect(text.glyphs.length, 'ABCDE draws five glyphs').toBe(5);
    for (const g of text.glyphs) expect(Math.abs(g.advance - 20), `grapheme ${g.grapheme} of the mono run advances 20 u (the premise), got ${g.advance}`).toBeLessThanOrEqual(1e-3);
    none(placeFailures(text), 'grapheme 2 sits on the circle where its advance midpoint\'s arc length puts it');
  }, TIMEOUT);

  it(`${AC[4]} repeated, with offset keyed 0 → 100 u over 4.7 s and cycled, the frame at 4.7 s places every grapheme where the frame at 0 does`, () => {
    const [zero, half, end] = drawn(raster(render, REPEATED, [{ t: 0 }, { t: fl(2.35) }, { t: fl(4.7) }]), 'the repeated text').map((a, k) => textOf(a, 'arc', `repeat frame ${k}`).glyphs);
    expect(zero!.length, 'repeat copies the run along the circle: more glyphs than the run\'s five').toBeGreaterThan(5);
    expect(end!.length, 'the frame at 4.7 s draws as many glyphs as the frame at 0').toBe(zero!.length);
    none(unmatched(zero!, end!).map((g) => `grapheme ${g.grapheme} (glyph ${g.id}) at (${centreOf(g).join(', ')}), ${angleOf(g)}°, has no match at 4.7 s`), 'every grapheme of frame 0 is placed alike at 4.7 s');
    expect(unmatched(zero!, half!).length, 'the frame at 2.35 s, half a run along, places the graphemes elsewhere (the offset moves)').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[4]} a planted layout that puts each grapheme's left edge on its arc-length point lands grapheme 2 10 u further along and fails, naming the grapheme`, () => {
    const text = textOf(drawn(raster(render, PLACED, [{ t: 0, planted: 'on_curve_left_edge' }]), 'the planted layout')[0]!, 'arc', 'the planted layout');
    const g = text.glyphs.find((x) => x.grapheme === 2);
    expect(g, 'the planted layout draws grapheme 2').toBeDefined();
    expect(Math.abs(arcLength(centreOf(g!)) - 110), `the planted layout centres grapheme 2 at arc length 110 u, got ${arcLength(centreOf(g!))}`).toBeLessThanOrEqual(0.1);
    failsNaming(placeFailures(text), ['grapheme 2'], 'on_curve_left_edge');
  }, TIMEOUT);
});
