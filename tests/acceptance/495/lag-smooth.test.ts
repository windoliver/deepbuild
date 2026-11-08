// AC2 #495.268c5ad9: lag(x, "0.5s") equals x at t - 0.5 s within 1e-9 at 1,000 random times, smooth with 5 samples equals the
// mean of those five lags, and a dt computed at run time, a dt past +-10 s, or a look-ahead through a control is refused with
// its reason.
//
// Through `deep-motion eval`. Item `src`'s x is a keyed channel with kinks (x), item `dst`'s x a driver. At 1,000 seeded
// times, in random order, over [0, 11 s) (so t - 0.5 s runs before the first key too), `lag(x, "0.5s")` must read the channel
// at t - 0.5 s, held past its ends, within 1e-9. `smooth(x, "0.4s", 5)` reads the mean of x at t + 0.2, 0.1, 0, -0.1 and
// -0.2 s (README: Choices 2), and equals a driver that writes those five lags by hand within 1e-9. Refusals read the whole
// answer for the driver's ID and the offender, each beside an accepted twin.
// Wrong programs: lag that reads x(t) or x(t + 0.5) or turns t into f32 seconds (1e-9); a smooth that is one-sided, takes
// 4 or 6 samples, or divides by the wrong count; a lag that takes dt from a var, or passes 10 s, or looks ahead at a control,
// without refusing (the twins accept; the refusals must come).
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, evalAll, evalOne, film, fl, linearAt, linear, mentions, none, posX, rect, seeded, show, useMotion, type JsonObject } from './helpers.ts';

const motion = useMotion();
const X: [number, number][] = [[0, 10], [1, 40], [2.5, -20], [4, 5], [5.5, 100], [7, 60], [9, -35], [10, 0]];
const KNOB = { knob: { kind: 'slider', class: 'document', label: 'Knob', range: [0, 1], default: 0.5 } };
const doc = (exprs: Record<string, string>, vars: JsonObject = { x: 'items/src/at/pos/0' }, extra: JsonObject = {}): JsonObject => film('lag', [200, 100],
  [rect('src', 'a0', [0, 0, 10, 10], 'accent'), ...Object.keys(exprs).map((id, i) => rect(id, `a${i + 1}`, [0, 20, 10, 10], 'accent'))],
  { channels: { cx: linear('items/src/at/pos/0', X) }, drivers: Object.fromEntries(Object.entries(exprs).map(([id, expr]) => [`d_${id}`, { target: `items/${id}/at/pos/0`, expr, vars }])), ...extra }, '12s');
const randomTimes = (): number[] => { const r = seeded(495); return Array.from({ length: 1000 }, () => Math.floor(r() * fl(11))); };

describe(`${AC[2]} lag and smooth read the chain at other times`, () => {
  it(`${AC[2]} lag(x, "0.5s") equals x at t - 0.5 s within 1e-9 at 1,000 random times`, () => {
    const times = randomTimes();
    const a = evalOne(motion(), doc({ lagged: 'lag(x, "0.5s")', ahead: 'lag(x, "-0.5s")' }), times);
    const got = posX(a, 'lagged', times, 'the lag');
    const ahead = posX(a, 'ahead', times, 'the look-ahead');
    none(times.flatMap((t, i) => {
      const s = t / 705_600_000; const out: string[] = [];
      if (Math.abs(got[i]! - linearAt(X, s - 0.5)) > 1e-9) out.push(`at ${s} s lag reads ${got[i]}, x(t - 0.5) is ${linearAt(X, s - 0.5)}`);
      if (Math.abs(ahead[i]! - linearAt(X, s + 0.5)) > 1e-9) out.push(`at ${s} s lag(x, "-0.5s") reads ${ahead[i]}, x(t + 0.5) is ${linearAt(X, s + 0.5)}`);
      return out;
    }), 'lag against the channel');
  }, TIMEOUT);

  it(`${AC[2]} smooth with 5 samples equals the mean of those five lags, by hand and by the closed form`, () => {
    const times = randomTimes();
    const by = 'lag(x, "-0.2s") + lag(x, "-0.1s") + x + lag(x, "0.1s") + lag(x, "0.2s")';
    const a = evalOne(motion(), doc({ smoothed: 'smooth(x, "0.4s", 5)', by_hand: `(${by}) / 5` }), times);
    const smoothed = posX(a, 'smoothed', times, 'smooth'); const byHand = posX(a, 'by_hand', times, 'the five lags');
    none(times.flatMap((t, i) => {
      const s = t / 705_600_000; const out: string[] = [];
      const mean = [0.2, 0.1, 0, -0.1, -0.2].reduce((sum, d) => sum + linearAt(X, s + d), 0) / 5;
      if (Math.abs(smoothed[i]! - mean) > 1e-9) out.push(`at ${s} s smooth reads ${smoothed[i]}, the mean of x at t +- 0.2 s is ${mean}`);
      if (Math.abs(smoothed[i]! - byHand[i]!) > 1e-9) out.push(`at ${s} s smooth reads ${smoothed[i]}, the five lags by hand ${byHand[i]}`);
      return out;
    }), 'smooth against its five lags');
  }, TIMEOUT);

  it(`${AC[2]} a dt computed at run time, a dt past +-10 s and a look-ahead through a control are each refused with their reason; the neighbouring forms are accepted`, () => {
    const [runtime, past, pastBack, ahead, edge, edgeBack, behind, wide] = evalAll(motion(), [
      { doc: doc({ r: 'lag(x, k)' }, { x: 'items/src/at/pos/0', k: 'items/src/at/pos/1' }), times: [0] },
      { doc: doc({ p: 'lag(x, "10.5s")' }), times: [0] },
      { doc: doc({ q: 'lag(x, "-10.5s")' }), times: [0] },
      { doc: doc({ a: 'lag(c, "-0.5s")' }, { c: 'controls/knob/value' }, { controls: KNOB }), times: [0] },
      { doc: doc({ e: 'lag(x, "10s")' }), times: [0] },
      { doc: doc({ f: 'lag(x, "-10s")' }), times: [0] },
      { doc: doc({ b: 'lag(c, "0.5s")' }, { c: 'controls/knob/value' }, { controls: KNOB }), times: [0] },
      { doc: doc({ w: 'smooth(x, "0.4s", 17)' }), times: [0] },
    ]);
    const refusal = (a: JsonObject | undefined, what: string, ...names: string[]): void => {
      expect(a!['ok'], `${what} is refused: ${show(a)}`).toBe(false);
      for (const n of names) expect(mentions(a, n), `the refusal for ${what} names ${n}: ${show(a)}`).toBe(true);
    };
    refusal(runtime, 'a dt read from a var', 'd_r', 'lag');
    refusal(past, 'dt = 10.5 s', 'd_p', '10.5');
    refusal(pastBack, 'dt = -10.5 s', 'd_q', '10.5');
    refusal(ahead, 'a look-ahead of a control', 'd_a', 'knob');
    refusal(wide, 'smooth with 17 samples', 'd_w');
    for (const [a, what] of [[edge, 'dt = 10 s'], [edgeBack, 'dt = -10 s'], [behind, 'a look-back of a control']] as const) expect(a!['ok'], `${what} is accepted: ${show(a)}`).toBe(true);
  }, TIMEOUT);
});
