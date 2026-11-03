// Criterion 7: "Item A's driver reads item B's evaluated position, and B's look_at targets A's transform: this is
// accepted and evaluates as A.channels, B.transform, B.constraints, A.driver, A.transform, the same seeked and
// played; the same pair with A's driver reading B's constrained world pose while B's constraint reads A's world pose
// is refused with `cycle`, naming both; a planted scheduler that schedules whole items refuses the first pair and
// fails"
//
// Through `deep-motion eval`. A is `knob`, B is `gauge`. A's channel keys its x (`items/knob/at/pos/0`); A's driver
// writes its rotation (`items/knob/at/rot/2`) from B's evaluated world position (`items/gauge/world/pos/0`); B's
// look_at aims its +x axis. In the first pair B's look_at `target` is A's transform as its channels write it, the
// path `items/knob/at/pos`; in the second it is the item `knob`: its evaluated world pose, after its driver and
// constraints. The answer's `order` lists the components as evaluated, each `<item>.<component>` (README: Choices
// where the issue is open). No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, accepted, arr, evalAll, film, fl, itemAt, keyed, mentions, none, rect, refusal, seekPlayFailures, seededTimes, show, str, useMotion,
  type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();

const A = 'knob'; const B = 'gauge';
function pairDoc(id: string, lookAtTarget: string): JsonObject {
  return film(id, [rect(A, [0, 150]), rect(B, [100, 50])], {
    channels: { slide: keyed(`items/${A}/at/pos/0`, { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 200, interp: 'linear' } }) },
    drivers: { turn: { target: `items/${A}/at/rot/2`, expr: 'gx * 0.5', vars: { gx: `items/${B}/world/pos/0` } } },
    constraints: { aim: { owner: B, kind: 'look_at', target: lookAtTarget, axis: [1, 0, 0] } },
  }, { span: '2s' });
}
const FIRST = pairDoc('order-accepted', `items/${A}/at/pos`);
const SECOND = pairDoc('order-cycle', A);
const ORDER = [`${A}.channels`, `${B}.transform`, `${B}.constraints`, `${A}.driver`, `${A}.transform`];
const TIMES = seededTimes(489_07, 50, 0, fl(2));

/** The answer's evaluation order of the two items' components, filtered to those the criterion names. */
function orderOf(a: Accepted): string[] {
  const all = arr(a.order, 'the answer\'s order').map((v, i) => str(v, `order[${i}]`));
  const named = new Set(['channels', 'driver', 'transform', 'constraints']);
  return all.filter((x) => { const [item, part] = x.split('.'); return (item === A || item === B) && named.has(part ?? ''); });
}

/** The check every scheduler must pass on the first pair: accepted, in the criterion's order, with the values that order gives. */
function firstPairFailures(answer: JsonObject, times: number[], what: string): string[] {
  if (answer['ok'] !== true) return [`${what}: the first pair is refused (${show(answer)}), though no component reads its own output`];
  let a: Accepted;
  try { a = accepted(answer, times, what); } catch (e) { return [`${what}: ${(e as Error).message.split('\n')[0]}`]; }
  const failures: string[] = [];
  const order = orderOf(a);
  if (JSON.stringify(order) !== JSON.stringify(ORDER)) failures.push(`${what}: evaluates as ${order.join(', ')}, not ${ORDER.join(', ')}`);
  for (const f of a.frames) {
    const ax = 100 * (f.t / FLICKS);
    const rot = itemAt(f, A, 'rot')[2];
    if (Math.abs(rot - 50) > 1e-9) failures.push(`${what}: at ${f.t} flicks A's driver wrote ${rot}, not 0.5 × B's x (50)`);
    const aim = Math.abs(itemAt(f, B, 'rot')[2]);
    const want = Math.abs((Math.atan2(150 - 50, ax - 100) * 180) / Math.PI);
    if (Math.abs(aim - want) > 1e-9) failures.push(`${what}: at ${f.t} flicks B is turned ${aim}°, not the ${want}° toward A at x ${ax}`);
    if (Math.abs(itemAt(f, A, 'pos')[0] - ax) > 1e-9) failures.push(`${what}: at ${f.t} flicks A's x is ${itemAt(f, A, 'pos')[0]}, its channel's ${ax}`);
  }
  return failures;
}

describe('criterion 7: drivers and constraints scheduled per component, cycles refused naming both items', () => {
  it('criterion 7: the first pair is accepted and evaluates as A.channels, B.transform, B.constraints, A.driver, A.transform', () => {
    const [answer] = evalAll(motion.bin(), [{ doc: FIRST, times: TIMES }]) as [JsonObject];
    accepted(answer, TIMES, 'the first pair');
    none(firstPairFailures(answer, TIMES, 'the first pair'), 'the per-component schedule');
  }, TIMEOUT);

  it('criterion 7: the first pair reads the same seeked and played at 50 random times', () => {
    none(seekPlayFailures(motion.bin(), FIRST, TIMES, 'the first pair'), 'seek equals play');
    // Not vacuous: B's look_at turns it as A moves, so the compared poses change across the 50 times.
    const [answer] = evalAll(motion.bin(), [{ doc: FIRST, times: TIMES }]) as [JsonObject];
    const turns = new Set(accepted(answer, TIMES, 'the first pair').frames.map((f) => itemAt(f, B, 'rot')[2]));
    expect(turns.size, `B's look_at turns it as A moves: ${turns.size} distinct rotations over 50 times`).toBeGreaterThan(40);
  }, TIMEOUT);

  it('criterion 7: with A\'s driver reading B\'s constrained world pose and B\'s look_at reading A\'s world pose the pair is refused with cycle, naming both', () => {
    const [answer] = evalAll(motion.bin(), [{ doc: SECOND, times: [0] }]) as [JsonObject];
    const r = refusal(answer, 'the second pair');
    expect(r.code, `the refusal's code: ${show(r.raw)}`).toBe('cycle');
    expect(mentions(r.raw, A) && mentions(r.raw, B), `the refusal names both ${A} and ${B}: ${show(r.raw)}`).toBe(true);
  }, TIMEOUT);

  it('criterion 7: a planted scheduler that schedules whole items refuses the first pair and fails', () => {
    const [answer] = evalAll(motion.bin(), [{ doc: FIRST, times: TIMES, planted: 'schedules_whole_items' }]) as [JsonObject];
    // An item-level scheduler sees A → B (A's driver reads B) and B → A (B's look_at reads A): a cycle.
    expect(answer['ok'] === false && answer['code'] === 'cycle', `the whole-item scheduler refuses the first pair as a cycle: ${show(answer)}`).toBe(true);
    expect(firstPairFailures(answer, TIMES, 'the whole-item scheduler').length, 'the whole-item scheduler fails the first pair\'s check').toBeGreaterThan(0);
  }, TIMEOUT);
});
