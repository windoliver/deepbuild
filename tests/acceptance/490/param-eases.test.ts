// Criterion 12: "back_out {overshoot: 2.6} equals the cubic Bézier (1/3, 28/15, 2/3, 1) within 1e-12 at 1,001 points
// and peaks at 1.2009 at x = 0.5185, where a planted back_out that ignores the parameter peaks at 1.1000 and fails,
// naming the key; bounce_out with its defaults equals the fixed four-arc bounce within 1e-12 at 1,001 points; and a
// key dropping a ball 190 u to its floor from 0.1 s to 1.6229 s with bounce_out {restitution: 0.56, bounces: 5}
// touches the floor at 0.5472, 1.0481, 1.3286, 1.4857 and 1.5736 s within 0.1 ms and stands 59.584 u above it at
// 0.7977 s within 0.01 u, where the default bounce stands 36.54 u, and its interval form keeps the segment between
// its keys' values"
//
// Through `deep-motion eval`. The issue's back_out and bounce_out are ease@1's `out_back` and `out_bounce` (the
// base's names, which the opening keeps; README: Choices), keyed as `{ease: {name, params: {overshoot: 2.6}}}` and
// `{…, params: {restitution: 0.56, bounces: 5}}`. The Bézier (1/3, 28/15, 2/3, 1) has x(s) = s, so its value at x is
// y(x), computed here. The peak is read on a grid of 10,001 points. The ball's channel writes its height above the
// floor, 190 at its key and 0 at the next; "touches the floor at τ within 0.1 ms" is: sampled every 706 flicks
// (about 1 µs) across τ ± 0.15 ms, the lowest height lies within 0.1 ms of τ and under 0.01 u. The interval form is
// the answer's `bounds.channels.fall` (README: `bounds`), within [0, 190] (1e-9), with the hard range [0, 190]
// accepted. The planted back is `planted: "back_ignores_params"`. No upstream test.
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, accepted, bounceOut, chan, chanOr, evalAll, evalOk, evalPlanted, failsNaming, film, key, keyed, none, rect, show, thousandths,
  useMotion, type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();
const TIMES = thousandths();
const XS = TIMES.map((_, i) => i / 1000);
const GRID = Array.from({ length: 10_001 }, (_, i) => Math.round((i * FLICKS) / 10_000));

const eased = (id: string, ease: JsonObject): JsonObject => film(id, [rect('a')], {
  channels: { y: keyed('items/a/at/pos/1', { rise: key(0, 0, { ease }), end: key(1, 1) }) },
});
const BACK = eased('back', { name: 'out_back', params: { overshoot: 2.6 } });
/** The cubic Bézier (1/3, 28/15, 2/3, 1): x(s) = s, so y at x. */
const bezier = (x: number): number => 3 * (1 - x) ** 2 * x * (28 / 15) + 3 * (1 - x) * x * x + x ** 3;
/** The check every program must pass on BACK: each of the 1,001 points within 1e-12 of the Bézier; failures name the key. */
function backFailures(a: Accepted | null): string[] {
  if (!a) return ['key rise: no frames'];
  return a.frames.flatMap((f, i) => { const got = chanOr(f, 'y'); const want = bezier(XS[i]!); return Math.abs(got - want) <= 1e-12 ? [] : [`key rise: at x = ${XS[i]} out_back {overshoot: 2.6} reads ${got}, the Bézier ${want}`]; });
}
const peakOf = (a: Accepted): { peak: number; at: number } => {
  const v = a.frames.map((f) => chanOr(f, 'y'));
  const peak = Math.max(...v);
  return { peak, at: v.indexOf(peak) / 10_000 };
};

const T0 = 0.1; const T1 = 1.6229;
const ball = (id: string, params?: JsonObject, range?: [number, number]): JsonObject => film(id, [rect('ball')], {
  channels: { fall: keyed('items/ball/at/pos/1', { drop: key(T0, 190, { ease: params ? { name: 'out_bounce', params } : { name: 'out_bounce' } }), floor: key(T1, 0) }, range ? { range } : {}) },
}, { span: '2s' });
const TOUCHES = [0.5472, 1.0481, 1.3286, 1.4857, 1.5736];

describe('criterion 12: the back, elastic and bounce families take their parameters', () => {
  it('criterion 12: out_back {overshoot: 2.6} equals the cubic Bézier (1/3, 28/15, 2/3, 1) within 1e-12 at 1,001 points and peaks at 1.2009 at x = 0.5185', () => {
    const bin = motion.bin();
    none(backFailures(evalOk(bin, { doc: BACK, times: TIMES }, 'out_back {overshoot: 2.6}')), 'out_back {overshoot: 2.6} against the Bézier');
    const { peak, at } = peakOf(evalOk(bin, { doc: BACK, times: GRID }, 'out_back on a grid of 10,001'));
    expect(peak.toFixed(4), 'its peak').toBe('1.2009');
    expect(Math.abs(at - 0.5185), `it peaks at x = 0.5185 (at ${at})`).toBeLessThanOrEqual(1e-4);
  }, TIMEOUT);

  it('criterion 12: a planted out_back that ignores the parameter peaks at 1.1000 and fails, naming the key', () => {
    const bin = motion.bin();
    const grid = evalPlanted(bin, { doc: BACK, times: GRID, planted: 'back_ignores_params' });
    expect(grid, 'the planted program answers the document').not.toBeNull();
    expect(peakOf(grid!).peak.toFixed(4), 'the planted back\'s peak').toBe('1.1000');
    failsNaming(backFailures(evalPlanted(bin, { doc: BACK, times: TIMES, planted: 'back_ignores_params' })), ['key rise'], 'the Bézier check on the planted back');
  }, TIMEOUT);

  it('criterion 12: out_bounce with its defaults equals the fixed four-arc bounce within 1e-12 at 1,001 points', () => {
    const a = evalOk(motion.bin(), { doc: eased('bounce', { name: 'out_bounce' }), times: TIMES }, 'out_bounce');
    none(a.frames.flatMap((f, i) => { const got = chan(f, 'y'); const want = bounceOut(XS[i]!); return Math.abs(got - want) <= 1e-12 ? [] : [`at x = ${XS[i]} out_bounce reads ${got}, the four-arc bounce ${want}`]; }), 'out_bounce against the fixed bounce');
  }, TIMEOUT);

  it('criterion 12: the ball dropped 190 u with {restitution: 0.56, bounces: 5} touches the floor at the five times within 0.1 ms and stands 59.584 u at 0.7977 s, where the default bounce stands 36.54 u', () => {
    const bin = motion.bin();
    const step = 706; const half = Math.round(0.00015 * FLICKS);
    const windows = TOUCHES.map((tau) => { const c = Math.round(tau * FLICKS); const out: number[] = []; for (let t = c - half; t <= c + half; t += step) out.push(t); return out; });
    const at7977 = Math.round(0.7977 * FLICKS);
    const [touches, mid, dflt] = evalAll(bin, [
      { doc: ball('ball', { restitution: 0.56, bounces: 5 }), times: windows.flat() },
      { doc: ball('ball-mid', { restitution: 0.56, bounces: 5 }), times: [at7977] },
      { doc: ball('ball-default'), times: [at7977] },
    ]);
    const a = accepted(touches!, windows.flat(), 'the ball with restitution 0.56 and 5 bounces');
    const failures: string[] = [];
    let k = 0;
    TOUCHES.forEach((tau, n) => {
      const frames = a.frames.slice(k, k + windows[n]!.length); k += windows[n]!.length;
      const h = frames.map((f) => chan(f, 'fall'));
      const lowest = Math.min(...h);
      const when = frames[h.indexOf(lowest)]!.t / FLICKS;
      if (Math.abs(when - tau) > 0.0001 || lowest > 0.01) failures.push(`touch ${n + 1}: the lowest height ${lowest} near ${tau} s is at ${when} s`);
    });
    none(failures, 'the five touches within 0.1 ms');
    expect(Math.abs(chan(accepted(mid!, [at7977], 'the ball at 0.7977 s').frames[0]!, 'fall') - 59.584), 'the ball at 0.7977 s stands 59.584 u within 0.01 u').toBeLessThanOrEqual(0.01);
    expect(Math.abs(chan(accepted(dflt!, [at7977], 'the default ball at 0.7977 s').frames[0]!, 'fall') - 36.54), 'the default bounce stands 36.54 u within 0.01 u').toBeLessThanOrEqual(0.01);
  }, TIMEOUT);

  it('criterion 12: the bounce\'s interval form keeps the segment between its keys\' values, so a hard range of [0, 190] passes', () => {
    const [a] = evalAll(motion.bin(), [{ doc: ball('ball-range', { restitution: 0.56, bounces: 5 }, [0, 190]), times: [0], bounds: true }]);
    const ok = accepted(a!, [0], 'the ball under [0, 190]');
    const b = ok.bounds?.channels['fall'];
    expect(b, `the answer bounds the channel: ${show(a!['bounds'])}`).toBeDefined();
    expect(b!.lo !== null && b!.lo >= -1e-9 && b!.hi !== null && b!.hi <= 190 + 1e-9, `the bound [${b!.lo}, ${b!.hi}] lies within the keys' values [0, 190]`).toBe(true);
  }, TIMEOUT);
});
