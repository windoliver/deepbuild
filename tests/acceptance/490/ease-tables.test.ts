// Criterion 6: "An ease table over x 0, 0.3, 1 with y 0, −0.1, 1 and overshoot [−0.1, 1] keys a channel from 0 to
// 100 whose hard range is [−20, 100] and passes the range check with its bound −10; with a hard range of [−5, 100]
// it's refused, naming the key and the bound −10; the same table declared monotone is refused, naming knot 1; and a
// table whose last value is 0.98 is refused, naming the endpoint"
//
// Through `deep-motion eval`: the eval line's pack `epack` fills ease@1 with the table `epack.dip` (README: tables;
// the same entry shape `fixtures/packs/epack-1.0.0` installs in deep-show), and the key `lead` names it with
// `interp: {ease: {table: "epack.dip"}}`. "Its bound" is the answer's `bounds.channels.ch` (README: `bounds`), which
// encloses −10 and lies within 1e-9 of it; "declared monotone" is `overshoot: "none"`; "naming knot 1" is a member
// `knot: 1`, "naming the endpoint" a member `endpoint: 1` (the end x = 1 the table misses). No upstream test.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, chan, evalAll, accepted, fieldIn, film, keyed, mentions, numbersIn, rect, refusal, show, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();

const DIP = { name: 'epack.dip', x: [0, 0.3, 1], y: [0, -0.1, 1], mode: 'linear', overshoot: [-0.1, 1] };
const packs = (entry: JsonObject): JsonObject[] => [{ name: 'epack', entries: { 'ease@1': [entry] } }];
const doc = (id: string, range: [number, number]): JsonObject => film(id, [rect('a')], {
  channels: { ch: keyed('items/a/at/pos/0', { lead: { t: '0s', value: 0, interp: { ease: { table: 'epack.dip' } } }, end: { t: '1s', value: 100, interp: 'linear' } }, { range }) },
});
const T03 = Math.round(0.3 * 705_600_000);

describe('criterion 6: an ease table keys a channel, bounded by its knots, and a table that breaks its declaration is refused', () => {
  it('criterion 6: the table with overshoot [−0.1, 1] keys a channel 0 → 100 under a hard range of [−20, 100], passing with its bound −10', () => {
    const [a] = evalAll(motion.bin(), [{ doc: doc('dip-wide', [-20, 100]), times: [0, T03, 705_600_000], packs: packs(DIP), bounds: true }]);
    const ok = accepted(a!, [0, T03, 705_600_000], 'the eased channel under [−20, 100]');
    expect(chan(ok.frames[1]!, 'ch'), 'the channel reads −10 at 0.3 s, the table\'s knot').toBeCloseTo(-10, 9);
    const b = ok.bounds?.channels['ch'];
    expect(b, `the answer bounds the channel: ${show(a!['bounds'])}`).toBeDefined();
    expect(b!.lo, 'the bound\'s lower end').not.toBeNull();
    expect(b!.lo!, 'the bound holds −10').toBeLessThanOrEqual(-10);
    expect(b!.lo!, 'the bound is −10 within 1e-9').toBeGreaterThanOrEqual(-10 - 1e-9);
    expect(b!.hi!, 'the bound\'s upper end is the key value 100 within 1e-9').toBeGreaterThanOrEqual(100);
    expect(b!.hi! - 100, 'the bound\'s upper end is 100 within 1e-9').toBeLessThanOrEqual(1e-9);
  }, TIMEOUT);

  it('criterion 6: under a hard range of [−5, 100] it is refused, naming the key and the bound −10', () => {
    const [r] = evalAll(motion.bin(), [{ doc: doc('dip-narrow', [-5, 100]), times: [0], packs: packs(DIP) }]);
    refusal(r!, 'the eased channel under [−5, 100]');
    expect(mentions(r!, 'lead'), `the refusal names the key lead: ${show(r)}`).toBe(true);
    expect(numbersIn(r!).some((n) => Math.abs(n + 10) <= 1e-6), `the refusal names the bound −10: ${show(r)}`).toBe(true);
  }, TIMEOUT);

  it('criterion 6: the same table declared monotone is refused naming knot 1, and one whose last value is 0.98 is refused naming the endpoint', () => {
    const [mono, short] = evalAll(motion.bin(), [
      { doc: doc('dip-mono', [-20, 100]), times: [0], packs: packs({ ...DIP, overshoot: 'none' }) },
      { doc: doc('dip-short', [-20, 100]), times: [0], packs: packs({ ...DIP, y: [0, -0.1, 0.98] }) },
    ]) as [JsonObject, JsonObject];
    refusal(mono, 'the table declared monotone');
    expect(fieldIn(mono, 'knot'), `the refusal names knot 1: ${show(mono)}`).toBe(1);
    expect(mentions(mono, 'epack.dip'), `the refusal names the table: ${show(mono)}`).toBe(true);
    refusal(short, 'the table ending at 0.98');
    expect(fieldIn(short, 'endpoint'), `the refusal names the endpoint x = 1: ${show(short)}`).toBe(1);
    expect(mentions(short, 'epack.dip'), `the refusal names the table: ${show(short)}`).toBe(true);
  }, TIMEOUT);
});
