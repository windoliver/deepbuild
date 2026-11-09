// AC3 #494.32c3ee38: A position key from (−2, 0) to (2, 0) with `travel: arc {angle: 180}` passes (0, 2) at u = 0.5
// within 1e-9, and −180° passes (0, −2); two items swapped with ±180° never overlap at 200 sampled times; a spiral of
// 90° from (0, 0) to (100, 0) u is at 0.5 × R(−45°)(100, 0) u at u = 0.5 within 1e-9, R a counterclockwise turn as seen
// on screen; and an arc of 0.5° gives values bit-identical to straight.
//
// Through `deep-motion eval`: a vec3 channel on an item's position (`items/<id>/at/pos`), keys at 0 s and 1 s, linear,
// so u is the segment's time share; the first key carries `travel` (README: Key travel), read back as
// `items.<id>.at.pos`. The canvas is y down (README: Coordinates), so a turn counterclockwise on screen takes (x, y) by
// R(θ) = [[cos θ, sin θ], [−sin θ, cos θ]], and the arc from (−2, 0) to (2, 0) at +180° passes below, through (0, 2).
// A program that ignores `travel` goes straight through (0, 0) and fails; the swap's straight twin overlaps, so the
// overlap check can't pass a program that never moves the items apart.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, accepted, channel, channelValue, evalAll, evenly, film, fl, fmt, key, none, posOf, rect, useMotion, type JsonObject, type JsonValue, type V2 } from './helpers.ts';

const motion = useMotion();
const HALF = fl(0.5);
const SAMPLES = evenly(200, 0, 1);
/** A unit square centred on its position. */
const square = (id: string): JsonObject => rect(id, [-0.5, -0.5, 1, 1]);
const v3 = (p: V2): JsonValue => [p[0], p[1], 0];
/** A position channel from a to b over 1 s, its first key with `travel` when given. */
const move = (id: string, a: V2, b: V2, travel?: JsonValue): JsonObject =>
  channel(`items/${id}/at/pos`, 'vec3', [key(0, v3(a), travel === undefined ? {} : { travel }), key(1, v3(b))]);
const one = (name: string, travel?: JsonValue, a: V2 = [-2, 0], b: V2 = [2, 0]): JsonObject => film(name, [square('dot')], { channels: { go: move('dot', a, b, travel) } });
const swap = (name: string, travel?: JsonValue): JsonObject => film(name, [square('left'), square('right')], {
  channels: { l: move('left', [-2, 0], [2, 0], travel), r: move('right', [2, 0], [-2, 0], travel) },
});
/** R(θ), counterclockwise on screen with y down. */
const turn = (deg: number, p: V2): V2 => { const a = (deg * Math.PI) / 180; return [p[0] * Math.cos(a) + p[1] * Math.sin(a), -p[0] * Math.sin(a) + p[1] * Math.cos(a)]; };
const within = (got: V2, want: V2, tol: number): boolean => Math.abs(got[0] - want[0]) <= tol && Math.abs(got[1] - want[1]) <= tol;
/** Times at which two unit squares centred on the items' positions overlap. */
function overlaps(doc: JsonObject, what: string): string[] {
  const [answer] = evalAll(motion(), [{ doc, times: SAMPLES }]);
  return accepted(answer!, SAMPLES, what).flatMap((f) => {
    const a = posOf(f, 'left', what); const b = posOf(f, 'right', what);
    return Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1 ? [`at ${f.t} flicks the squares overlap: left ${fmt(a)}, right ${fmt(b)}`] : [];
  });
}

describe(`${AC[3]} keys travel on arcs and spirals`, () => {
  it(`${AC[3]} from (−2, 0) to (2, 0) an arc of 180° passes (0, 2) and one of −180° passes (0, −2) at u = 0.5, within 1e-9`, () => {
    const answers = evalAll(motion(), [
      { doc: one('arc-plus', { arc: { angle: 180 } }), times: [0, HALF, fl(1)] },
      { doc: one('arc-minus', { arc: { angle: -180 } }), times: [0, HALF, fl(1)] },
    ]);
    for (const [i, want, name] of [[0, [0, 2], '180°'], [1, [0, -2], '−180°']] as [number, V2, string][]) {
      const frames = accepted(answers[i]!, [0, HALF, fl(1)], `the arc of ${name}`);
      const [start, mid, end] = frames.map((f) => posOf(f, 'dot', `the arc of ${name}`));
      expect(within(start!, [-2, 0], 1e-9) && within(end!, [2, 0], 1e-9), `the arc of ${name} starts at (−2, 0) and ends at (2, 0): ${fmt(start!)}, ${fmt(end!)}`).toBe(true);
      expect(within(mid!, want, 1e-9), `the arc of ${name} is at ${fmt(want)} at u = 0.5 within 1e-9, got ${fmt(mid!)}`).toBe(true);
    }
  }, TIMEOUT);

  it(`${AC[3]} two items swapped on arcs of 180°, and of −180°, never overlap at 200 sampled times, though swapped straight they do`, () => {
    none(overlaps(swap('swap-plus', { arc: { angle: 180 } }), 'the swap at 180°'), 'the swap at 180°');
    none(overlaps(swap('swap-minus', { arc: { angle: -180 } }), 'the swap at −180°'), 'the swap at −180°');
    expect(overlaps(swap('swap-straight'), 'the straight swap').length, 'the fixture discriminates: swapped straight, the squares overlap').toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[3]} a spiral of 90° from (0, 0) to (100, 0) u is at 0.5 × R(−45°)(100, 0) u at u = 0.5 within 1e-9, R counterclockwise on screen`, () => {
    const want = turn(-45, [100, 0]).map((v) => 0.5 * v) as V2;
    const [answer] = evalAll(motion(), [{ doc: one('spiral', { spiral: { angle: 90 } }, [0, 0], [100, 0]), times: [0, HALF, fl(1)] }]);
    const [start, mid, end] = accepted(answer!, [0, HALF, fl(1)], 'the spiral').map((f) => posOf(f, 'dot', 'the spiral'));
    expect(within(start!, [0, 0], 1e-9) && within(end!, [100, 0], 1e-9), `the spiral starts at (0, 0) and ends at (100, 0): ${fmt(start!)}, ${fmt(end!)}`).toBe(true);
    expect(within(mid!, want, 1e-9), `the spiral is at ${fmt(want)} at u = 0.5 within 1e-9, got ${fmt(mid!)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[3]} an arc of 0.5° gives positions bit-identical to straight at 200 sampled times`, () => {
    const [arc, straight] = evalAll(motion(), [{ doc: one('arc-half-degree', { arc: { angle: 0.5 } }), times: SAMPLES }, { doc: one('straight'), times: SAMPLES }]);
    const a = accepted(arc!, SAMPLES, 'the arc of 0.5°'); const s = accepted(straight!, SAMPLES, 'the straight key');
    const differ = SAMPLES.flatMap((t, i) => {
      const x = JSON.stringify([channelValue(a[i]!, 'go', 'arc'), posOf(a[i]!, 'dot', 'arc')]); const y = JSON.stringify([channelValue(s[i]!, 'go', 'straight'), posOf(s[i]!, 'dot', 'straight')]);
      return x === y ? [] : [`at ${t} flicks the arc reads ${x}, straight ${y}`];
    });
    none(differ, 'the arc of 0.5° equals straight bit for bit, channel value and position');
  }, TIMEOUT);
});
