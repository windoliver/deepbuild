// AC13: "`#at:0.5` of a path made of a 100 u line then a 300 u line lies 100 u into the second line within 0.1 u, and
// `#length` reads 400 ± 0.01 u"
//
// Through `path` with `anchors`: a frame's `anchors["#at:<f>"]` is `{point: [x, y], angle}` (the tangent as
// atan2(dy, dx) in degrees, y down) and `anchors["#length"]` a number in u. Every path-like item reads them out, so
// the test also reads `#length` of a rect@1 (its perimeter) and of a star@1 (ten equal edges, in closed form), and an
// attachment that names `two#at:0.5` lands on that point (Path: an end that names an anchor lands on it).
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, arr, dist, figure, item, num, obj, pathAt, pathItem, useRenderBinary, vertices, type PathFrame, type Pt,
} from './helpers.ts';

useRenderBinary();
const doc = figure('anchors', [520, 400], [
  pathItem('two', 'a0', 'M 20 50 L 120 50 L 120 350'),
  item('card', 'rect@1', 'a1', { box: [200, 40, 100, 50], paint: { fill: { role: 'body' } } }),
  item('star', 'star@1', 'a2', { center: [400, 250], points: 5, outer_r: 100, inner_r: 40, paint: { fill: { role: 'body' } } }),
  pathItem('pointer', 'a3', 'M 300 150 L 200 150', { attach: { end: 'two#at:0.5' } }),
]);
const anchors = ['#at:0.5', '#length'];
const lengthOf = (f: PathFrame, what: string): number => num(obj(f.anchors, `${what}: anchors`)['#length'], `${what}: #length`);

describe('AC13 read-only anchors by arc length', () => {
  it('AC13 #at:0.5 of a 100 u line then a 300 u line lies 100 u into the second line within 0.1 u, along it, and #length reads 400 ± 0.01 u', () => {
    const f = pathAt(doc, 'two', 'the two-line path', 0, { anchors });
    const at = obj(obj(f.anchors, 'anchors')['#at:0.5'], '#at:0.5');
    const p = arr(at['point'], '#at:0.5.point').map((v) => num(v, 'point')) as Pt;
    expect(dist(p, [120, 150]), `#at:0.5 is 100 u into the second line, (120, 150); got (${p.join(', ')})`).toBeLessThanOrEqual(0.1);
    expect(Math.abs(num(at['angle'], '#at:0.5.angle') - 90), 'its tangent runs down the second line, 90°').toBeLessThanOrEqual(1);
    expect(Math.abs(lengthOf(f, 'the two-line path') - 400), '#length').toBeLessThanOrEqual(0.01);
  }, TIMEOUT);

  it('AC13 every path-like item reads out #length: a rect\'s perimeter and a star\'s ten edges', () => {
    expect(Math.abs(lengthOf(pathAt(doc, 'card', 'the rect', 0, { anchors }), 'the rect') - 300), 'the 100 × 50 rect\'s #length is 300 u').toBeLessThanOrEqual(0.01);
    const edge = Math.sqrt(100 ** 2 + 40 ** 2 - 2 * 100 * 40 * Math.cos(Math.PI / 5)); // outer to inner vertex, 36° apart
    expect(Math.abs(lengthOf(pathAt(doc, 'star', 'the star', 0, { anchors }), 'the star') - 10 * edge), `the star's #length is 10 × ${edge.toFixed(4)} u`).toBeLessThanOrEqual(0.01);
  }, TIMEOUT);

  it('AC13 an attachment that names two#at:0.5 lands on it', () => {
    const f = pathAt(doc, 'pointer', 'the pointer');
    const v = vertices(f.subpaths[0]!);
    expect(dist(v[v.length - 1]!, [120, 150]), `the pointer ends at two#at:0.5, (120, 150); got (${v[v.length - 1]!.join(', ')})`).toBeLessThanOrEqual(0.1);
  }, TIMEOUT);
});
