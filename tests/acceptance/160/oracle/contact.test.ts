// The contact oracle (the oracle map's kurbo bezpath.rs row, criterion AC12): where an end attached `at: outline`
// stops, against kurbo's test_intersect_qad.
//
// kurbo's case: the quadratic (0, −10) (10, 20) (20, −10) meets the vertical line through (10, −10) and (10, 10)
// once, at segment_t 0.5 and line_t 0.75, the point (10, 5). Here that quadratic is a filled path@1 (closed by its
// chord, no stroke, so its true shape is the region the quadratic bounds), and a path from (10, 60), on kurbo's line
// below the curve, is attached at its end to it `at: outline` with `gap: 0`, so its end is the contact itself (with a
// gap the end would sit off the curve by a distance this case's curvature, radius 3.3 u at the apex, makes
// ambiguous). The whole case is turned 45° about the origin and moved by (150, 150), a rigid motion that keeps the
// contact and its line: turned, the shape's axis-aligned bounds no longer touch the curve where the line meets it,
// so the box an `edge` attachment stops at lies 1.67 u from the contact and the case tells the true outline from the
// box. The line toward the target's centre runs along kurbo's line whatever the centre is taken to be (its bounds'
// centre, its control points' or its centroid), since the shape is symmetric about that line.
//
// No planted value reaches an attachment, so the wrong program shown failing is the twin that reads the box: the
// same document `at: edge`, which must not land on the contact.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, dist, figure, pathAt, pathItem, useRenderBinary, vertices, type JsonObject, type Pt } from '../helpers.ts';

useRenderBinary();
const C = Math.SQRT1_2;
/** Turn 45° about the origin, then move by (150, 150). */
const place = (p: Pt): Pt => [p[0] * C - p[1] * C + 150, p[0] * C + p[1] * C + 150];
const QUAD: Pt[] = [[0, -10], [10, 20], [20, -10]].map((p) => place(p as Pt));
const CONTACT = place([10, 5]); // kurbo: segment_t 0.5, line_t 0.75 on (10, −10)..(10, 10)
const START = place([10, 60]);
const AWAY = place([10, -10]);
const f = (p: Pt): string => `${p[0]} ${p[1]}`;

function contactDoc(at: 'outline' | 'edge'): JsonObject {
  return figure('oracle-contact', [300, 300], [
    pathItem('quad', 'a0', `M ${f(QUAD[0]!)} Q ${f(QUAD[1]!)} ${f(QUAD[2]!)} Z`, { paint: { fill: { role: 'body' } } }),
    pathItem('probe', 'a1', `M ${f(START)} L ${f(AWAY)}`, { attach: { end: 'quad', at, gap: 0 }, paint: { stroke: { role: 'ink', width: 2 } } }),
  ]);
}
const endOf = (at: 'outline' | 'edge'): Pt => {
  const fr = pathAt(contactDoc(at), 'probe', `the probe attached at ${at}`);
  const v = vertices(fr.subpaths[0]!);
  return v[v.length - 1]!;
};
const show = (p: Pt): string => `(${p[0].toFixed(4)}, ${p[1].toFixed(4)})`;

describe('AC12 kurbo\'s line meeting a quadratic, as an end attached at outline', () => {
  it('AC12 an end attached at outline with gap 0 stops where kurbo\'s line meets its quadratic, (10, 5) turned and moved, within 0.5 u', () => {
    const end = endOf('outline');
    expect(dist(end, CONTACT), `the end at ${show(end)}, kurbo's contact at ${show(CONTACT)}`).toBeLessThanOrEqual(0.5);
  }, TIMEOUT);

  it('AC12 the twin that reads the box (at: edge) does not land on the contact, so the case tells the outline from the bounds', () => {
    const end = endOf('edge');
    expect(dist(end, CONTACT), `the edge end at ${show(end)} is off kurbo's contact ${show(CONTACT)}`).toBeGreaterThan(0.5);
  }, TIMEOUT);
});
