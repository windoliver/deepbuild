// Criterion 9: "rush_in(10) equals 2·sigmoid10(x ÷ 2) within 1e-12 at 1,001 points; running_start(−0.5) dips to
// −0.1848 ± 1e-4 near x = 0.29, and the hard-range check takes that bound from its interval form; exp_decay(0.1) reads
// 0.6321 ± 1e-4 at 0.1; and a there_and_back pulse of 0.2 on a scale of 1 over 1 s reads 1.2 at 0.5 s and exactly 1 at
// both ends, while a planted pulse that leaves 1e-6 at its end fails"
//
// Through `deep-motion eval`: a channel from 0 to 1 over 1 s keyed with `{ease: {name, params}}` reads the ease at
// x = t ÷ 1 s, at the 1,001 times t = i ms. sigmoid10 is sigmoid(10) renormalized to 0 at 0 and 1 at 1, as the
// design's sigmoid(k) and the base's motion write it. "Near x = 0.29" is the least of the 1,001 samples within 0.01
// of it. The hard range: running_start keys a channel 0 → 100; [−18, 100] is refused naming the key and its bound
// −18.476 (within 1e-3), [−18.5, 100] passes, and `bounds` (README) encloses the dip −18.4761522 within 1e-6. The
// pulse: modifier `{pulse: {at: "0s", span: "1s", amount: 0.2, shape: "there_and_back"}}` on a scale channel held at
// 1; the planted pulse is `planted: "pulse_leaves_residue"`. No upstream test.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, chan, chanOr, evalAll, evalOk, evalPlanted, failsNaming, film, key, keyed, mentions, none, numbersIn, rect, refusal, runningStart, show,
  sigmoid, thousandths, useMotion, type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();
const TIMES = thousandths();
const XS = TIMES.map((_, i) => i / 1000);

const eased = (id: string, name: string, params: number, to = 1, range?: [number, number]): JsonObject => film(id, [rect('a')], {
  channels: { e: keyed('items/a/at/pos/0', { pull: key(0, 0, { ease: { name, params } }), end: key(1, to) }, range ? { range } : {}) },
});
/** running_start(−0.5)'s least value, on a grid of 10⁶ steps: −0.18476152… */
const DIP = ((): number => { let m = 0; for (let i = 0; i <= 1_000_000; i++) m = Math.min(m, runningStart(-0.5, i / 1e6)); return m; })();

const PULSE = film('pulse', [rect('a')], {
  channels: { sc: keyed('items/a/at/scale/0', { rest: key(0, 1, 'hold') }, { modifiers: [{ pulse: { at: '0s', span: '1s', amount: 0.2, shape: 'there_and_back' } }] }) },
});
const PULSE_TIMES = [0, Math.round(0.5 * 705_600_000), 705_600_000];
/** The pulse reads 1.2 at 0.5 s within 1e-12 and exactly 1 at 0 and 1 s; failures name the channel. */
function pulseFailures(a: Accepted | null): string[] {
  if (!a) return ['channel sc: no frames'];
  const [start, mid, end] = a.frames.map((f) => chanOr(f, 'sc'));
  const out: string[] = [];
  if (start !== 1) out.push(`channel sc reads ${start} at 0 s, not exactly 1`);
  if (!(Math.abs(mid! - 1.2) <= 1e-12)) out.push(`channel sc reads ${mid} at 0.5 s, not 1.2`);
  if (end !== 1) out.push(`channel sc reads ${end} at 1 s, not exactly 1`);
  return out;
}

describe('criterion 9: the new eases of ease@1 and the pulse modifier', () => {
  it('criterion 9: rush_in(10) equals 2·sigmoid10(x ÷ 2) within 1e-12 at 1,001 points', () => {
    const a = evalOk(motion.bin(), { doc: eased('rush', 'rush_in', 10), times: TIMES }, 'rush_in(10)');
    none(a.frames.flatMap((f, i) => { const want = 2 * sigmoid(10, XS[i]! / 2); const got = chan(f, 'e'); return Math.abs(got - want) <= 1e-12 ? [] : [`at x = ${XS[i]} rush_in(10) reads ${got}, 2·sigmoid10(x ÷ 2) = ${want}`]; }), 'rush_in(10) against 2·sigmoid10(x ÷ 2)');
  }, TIMEOUT);

  it('criterion 9: running_start(−0.5) dips to −0.1848 ± 1e-4 near x = 0.29, and the hard-range check takes that bound from its interval form', () => {
    const bin = motion.bin();
    const a = evalOk(bin, { doc: eased('start', 'running_start', -0.5), times: TIMES }, 'running_start(−0.5)');
    const v = a.frames.map((f) => chan(f, 'e'));
    const least = Math.min(...v);
    const where = XS[v.indexOf(least)]!;
    expect(Math.abs(least + 0.1848), `the dip ${least} is −0.1848 within 1e-4`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(where - 0.29), `the dip lies near 0.29 (at ${where})`).toBeLessThanOrEqual(0.01);
    const [narrow, wide] = evalAll(bin, [
      { doc: eased('start-narrow', 'running_start', -0.5, 100, [-18, 100]), times: [0] },
      { doc: eased('start-wide', 'running_start', -0.5, 100, [-18.5, 100]), times: [0], bounds: true },
    ]) as [JsonObject, JsonObject];
    refusal(narrow, 'running_start under [−18, 100]');
    expect(mentions(narrow, 'pull'), `the refusal names the key pull: ${show(narrow)}`).toBe(true);
    expect(numbersIn(narrow).some((n) => Math.abs(n - 100 * DIP) <= 1e-3), `the refusal names the bound ${100 * DIP}: ${show(narrow)}`).toBe(true);
    expect(wide['ok'], `running_start under [−18.5, 100] passes: ${show(wide)}`).toBe(true);
    const b = ((wide['bounds'] as JsonObject)?.['channels'] as JsonObject)?.['e'] as JsonObject | undefined;
    const lo = b?.['lo'];
    expect(typeof lo === 'number' && lo <= 100 * DIP + 1e-9 && lo >= 100 * DIP - 1e-6, `the channel's bound encloses the dip ${100 * DIP} within 1e-6: ${show(b)}`).toBe(true);
  }, TIMEOUT);

  it('criterion 9: exp_decay(0.1) reads 0.6321 ± 1e-4 at 0.1', () => {
    const a = evalOk(motion.bin(), { doc: eased('decay', 'exp_decay', 0.1), times: [Math.round(0.1 * 705_600_000)] }, 'exp_decay(0.1)');
    expect(Math.abs(chan(a.frames[0]!, 'e') - 0.6321), 'exp_decay(0.1) at 0.1').toBeLessThanOrEqual(1e-4);
  }, TIMEOUT);

  it('criterion 9: a there_and_back pulse of 0.2 on a scale of 1 over 1 s reads 1.2 at 0.5 s and exactly 1 at both ends', () => {
    none(pulseFailures(evalOk(motion.bin(), { doc: PULSE, times: PULSE_TIMES }, 'the pulse')), 'the pulse');
  }, TIMEOUT);

  it('criterion 9: a planted pulse that leaves 1e-6 at its end fails', () => {
    const a = evalPlanted(motion.bin(), { doc: PULSE, times: PULSE_TIMES, planted: 'pulse_leaves_residue' });
    expect(a, 'the planted program answers the document').not.toBeNull();
    expect(Math.abs(chanOr(a!.frames[2]!, 'sc') - (1 + 1e-6)), 'the planted pulse leaves 1e-6 at 1 s').toBeLessThanOrEqual(1e-12);
    failsNaming(pulseFailures(a), ['channel sc'], 'the pulse check on the planted pulse');
  }, TIMEOUT);
});
