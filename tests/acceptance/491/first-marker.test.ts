// Criterion 6, first part: "With x = −4 + 3t, a marker at `first {expr: x − 3}` resolves to 7/3 s within one flick,
// and a condition never true before `before` is refused, naming the marker"
//
// Through `deep-motion eval`. x is the item `dot`'s `at/pos/0`, written by a linear channel from −4 at 0 s to 8 at
// 4 s, so x = −4 + 3t (the frames at 0 and 7/3 s read −4 and 3). The marker `soon` at `{first: {expr: "x - 3",
// vars: {x: "items/dot/at/pos/0"}, after: "0s", before: "4s"}}` must resolve (the answer's `markers.soon.t`) within
// one flick of 7/3 s = 1,646,400,000 flicks. The same marker with `before: "2s"` (x ≤ 2 there, so x − 3 ≥ 0 never
// holds) must be refused naming it, while `before: "2.5s"` resolves to 7/3 s, so the refusal is the condition's.
// No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, evalOk, evalOne, film, markerT, mentions, posAt, rect, refused, show, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();
const SEVEN_THIRDS = 1_646_400_000;

function firstDoc(id: string, before: string): JsonObject {
  return film(`first-${id}`, [rect('dot', [0, 40])], {
    channels: {
      xc: { target: 'items/dot/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -4, interp: 'linear' }, k1: { t: '4s', value: 8, interp: 'linear' } } },
    },
    markers: { [id]: { kind: 'cue', t: { first: { expr: 'x - 3', vars: { x: 'items/dot/at/pos/0' }, after: '0s', before } } } },
  });
}

describe('criterion 6: a marker at the first time a condition holds', () => {
  it('criterion 6: with x = −4 + 3t, the marker at first {expr: x − 3} resolves to 7/3 s within one flick', () => {
    expect(SEVEN_THIRDS * 3, 'fixture: 7/3 s is a whole number of flicks').toBe(7 * 705_600_000);
    const a = evalOk(motion.bin(), { doc: firstDoc('soon', '4s'), times: [0, SEVEN_THIRDS] }, 'the first marker');
    expect(Math.abs(posAt(a.frames[0]!, 'dot', 0) + 4), 'x reads −4 at 0 s').toBeLessThanOrEqual(1e-9);
    expect(Math.abs(posAt(a.frames[1]!, 'dot', 0) - 3), 'x reads 3 at 7/3 s').toBeLessThanOrEqual(1e-9);
    const t = markerT(a, 'soon', 'the first marker');
    expect(Math.abs(t - SEVEN_THIRDS), `the marker resolves to ${t} flicks, against 7/3 s = ${SEVEN_THIRDS}: within one flick`).toBeLessThanOrEqual(1);
  }, TIMEOUT);

  it('criterion 6: a condition never true before `before` is refused, naming the marker', () => {
    const inTime = evalOk(motion.bin(), { doc: firstDoc('late', '2.5s'), times: [0] }, 'the condition true before 2.5 s');
    const t = markerT(inTime, 'late', 'the condition true before 2.5 s');
    expect(Math.abs(t - SEVEN_THIRDS), `with before 2.5 s the marker resolves to ${t} flicks, against ${SEVEN_THIRDS}`).toBeLessThanOrEqual(1);
    const r = refused(evalOne(motion.bin(), { doc: firstDoc('late', '2s'), times: [0] }), 'the condition never true before 2 s');
    expect(mentions(r, 'late'), `the refusal names the marker late: ${show(r)}`).toBe(true);
  }, TIMEOUT);
});
