// Criterion 11: "noise's and fbm's (6 octaves, gain 0.5) interval forms over 10,000 seeded ranges hold every value
// their point forms give at 1,000 seeded points in each, and a hard-range check of a driver whose value is 10 × fbm(t)
// takes its bound from fbm's interval form; a planted form that samples 8 points of the range and returns their least
// and greatest misses a value between them and fails, naming the range and the point"
//
// The search through `deep-show run`'s `fn` call in the `core` build, as criterion 3's (README: `fn`): `noise(x, 7)`
// and `fbm(x, 7, 6, 0.5)` (README: Choices: fbm's signature), ranges in [−100, 100], the five recomputed ranges read
// through `at`. The driver through `deep-motion eval`: `d` writes `10 * fbm(t, 7, 6, 0.5)` with `t` the time over a
// 6 s span; its bound (`bounds.drivers.d`, README: `bounds`) equals 10 × fbm's interval form over [0, 6] from the
// `fn` call within 1e-9 relative; the driver's hard range set to that bound passes, and the same with its upper end
// moved 1% of the width inward is refused naming the driver, whatever the samples read. The planted form is
// `planted: "noise_form_samples_8"` on the `fn` call, for noise and fbm alike. No upstream test.
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, boundsOf, evalAll, failsNaming, film, fnReplies, mentions, none, rangesFor, rect, scalars, searchFailures, searchOf, searchPoints, show,
  useEvidence, useMotion, useShow, type Fn, type JsonObject, type SearchRow,
} from './helpers.ts';

const CORE = 'core';
const shows = useShow([CORE]);
const motion = useMotion();
const evidence = useEvidence();
const NOISE: Fn = { expr: 'noise(x, 7)', domain: [-100, 100], special: [[0, 1], [-0.5, 0.5], [3.2, 3.8]] };
const FBM: Fn = { expr: 'fbm(x, 7, 6, 0.5)', domain: [-100, 100], special: [[0, 1], [-0.5, 0.5], [3.2, 3.8]] };

/** The search on `f` and five of its ranges recomputed through `at`, whose extremes must be the search's. */
function noiseFailures(bin: string, f: Fn, seed: number, planted?: string): { failures: string[]; rows: SearchRow[] } {
  const ranges = rangesFor(f, seed);
  const [r] = fnReplies(bin, evidence(), [{ expr: f.expr, search: { ranges, points: 1000, seed }, ...(planted ? { planted } : {}) }]);
  const rows = searchOf(r!, ranges, f.expr);
  const failures = searchFailures(f, rows);
  if (!planted) {
    const picks = [0, 2500, 5000, 7500, 9999];
    const pts = picks.map((i) => searchPoints(ranges[i]![0], ranges[i]![1], i, seed, 1000));
    const at = fnReplies(bin, evidence(), pts.map((xs) => ({ expr: f.expr, at: xs })));
    picks.forEach((i, k) => {
      const ys = scalars(at[k]!, 1000, `${f.expr} at range ${i}'s points`).filter((y): y is number => y !== null);
      const [lo, hi] = [Math.min(...ys), Math.max(...ys)];
      if (rows[i]!.min?.y !== lo || rows[i]!.max?.y !== hi) failures.push(`${f.expr}: range ${i}: the search reports [${rows[i]!.min?.y}, ${rows[i]!.max?.y}], its seeded points read [${lo}, ${hi}]`);
      if (hi === lo) failures.push(`${f.expr}: range ${i}: every seeded point reads ${lo}; the noise doesn't vary`);
    });
  }
  return { failures, rows };
}

const driverDoc = (id: string, range?: [number, number]): JsonObject => film(id, [rect('a')], {
  drivers: { d: { target: 'items/a/at/pos/1', expr: '10 * fbm(t, 7, 6, 0.5)', vars: { t: 'time' }, ...(range ? { range } : {}) } },
}, { span: '6s' });

describe('criterion 11: the seeded noise functions\' interval forms hold every point value', () => {
  it('criterion 11: noise\'s interval form holds every value its point form gives at 1,000 seeded points in each of 10,000 seeded ranges', () => {
    none(noiseFailures(shows.bin(CORE), NOISE, 490_110).failures, 'the counterexample search over noise');
  }, TIMEOUT);

  it('criterion 11: fbm\'s (6 octaves, gain 0.5) interval form holds every value its point form gives at 1,000 seeded points in each of 10,000 seeded ranges', () => {
    none(noiseFailures(shows.bin(CORE), FBM, 490_111).failures, 'the counterexample search over fbm');
  }, TIMEOUT);

  it('criterion 11: a hard-range check of a driver whose value is 10 × fbm(t) takes its bound from fbm\'s interval form', () => {
    const [form] = fnReplies(shows.bin(CORE), evidence(), [{ expr: '10 * fbm(x, 7, 6, 0.5)', over: [[0, 6]] }]);
    const [want] = boundsOf(form!, 1, '10 × fbm over [0, 6]');
    expect(want!.lo !== null && want!.hi !== null && want!.hi > want!.lo, `fbm's form bounds [0, 6]: ${show(form)}`).toBe(true);
    const [lo, hi] = [want!.lo!, want!.hi!];
    const bin = motion.bin();
    const [bounded] = evalAll(bin, [{ doc: driverDoc('fbm-driver'), times: [0], bounds: true }]);
    expect(bounded!['ok'], `the driver is accepted: ${show(bounded)}`).toBe(true);
    const b = ((bounded!['bounds'] as JsonObject)?.['drivers'] as JsonObject)?.['d'] as JsonObject | undefined;
    const close = (got: unknown, w: number): boolean => typeof got === 'number' && Math.abs(got - w) <= 1e-9 * Math.max(1, Math.abs(w));
    expect(close(b?.['lo'], lo) && close(b?.['hi'], hi), `the driver's bound ${show(b)} is 10 × fbm's form [${lo}, ${hi}]`).toBe(true);
    const [held, cut] = evalAll(bin, [
      { doc: driverDoc('fbm-held', [lo, hi]), times: [0] },
      { doc: driverDoc('fbm-cut', [lo, hi - 0.01 * (hi - lo)]), times: [0] },
    ]) as [JsonObject, JsonObject];
    expect(held['ok'], `the driver under its own bound passes: ${show(held)}`).toBe(true);
    expect(cut['ok'], `the driver under a range 1% inside its bound is refused: ${show(cut)}`).toBe(false);
    expect(mentions(cut, 'drivers/d') || mentions(cut, '"d"'), `the refusal names the driver d: ${show(cut)}`).toBe(true);
  }, TIMEOUT);

  it('criterion 11: a planted form that samples 8 points of the range misses a value between them and fails, naming the range and the point', () => {
    const bin = shows.bin(CORE);
    for (const [f, seed] of [[NOISE, 490_112], [FBM, 490_113]] as const) {
      failsNaming(noiseFailures(bin, f, seed, 'noise_form_samples_8').failures, [`${f.expr}: range [`, 'the point x = '], `the search on the planted ${f.expr} form`);
    }
  }, TIMEOUT);
});
