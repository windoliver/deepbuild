// Criterion 3: "A follow channel is exact at random times, however the playhead got there"
//
// Through `deep-motion eval`. Three follow channels on one stepping source (Follow: "The source must hold constant
// between input entries … Each segment between source changes is solved in closed form … from the state at its
// start"): first_order {tau_up: 0.25, tau_down: 0.6} with outputs value, rate and integral; rate_limit {max: 40} and
// spring {freq_hz: 2, damping_ratio: 0.35}, each with value and rate. Each starts at rest on the source's first
// value at 0, its integral 0 there (README: Choices where the issue is open). "Exact" is held two ways: at 200
// random times every playhead path (a straight play, a play backwards, a shuffled order, a scrub forward, back and
// forward again, and a cold seek to each time alone) reads the same numbers bit for bit; and they are the closed
// forms computed here (first order, rate limit) or RK4 at 1 µs (the spring), within 1e-9 relative. No upstream
// test (oracle page).
import { describe, it } from 'vitest';
import {
  FLICKS, TIMEOUT, chan, evalAll, accepted, film, fl, follow, none, rect, rk4Spring, seededTimes, shuffled, springOfHz, useMotion, withinRel,
  type Frame, type JsonObject,
} from './helpers.ts';

const motion = useMotion();

const SOURCE: [number, number][] = [[0, 10], [0.6, 30], [1.1, 22], [1.9, 40], [2.6, 12]];
const TAU_UP = 0.25; const TAU_DOWN = 0.6; const MAX = 40; const HZ = 2; const ZETA = 0.35;
const DOC: JsonObject = film('follow-exact', [rect('a', [10, 10]), rect('b', [10, 60]), rect('c', [10, 110])], {
  channels: {
    lag: follow('items/a/at/pos/0', SOURCE, { first_order: { tau_up: TAU_UP, tau_down: TAU_DOWN } }, {}, ['value', 'rate', 'integral']),
    ramp: follow('items/b/at/pos/0', SOURCE, { rate_limit: { max: MAX } }, {}, ['value', 'rate']),
    bounce: follow('items/c/at/pos/0', SOURCE, { spring: { freq_hz: HZ, damping_ratio: ZETA } }, {}, ['value', 'rate']),
  },
}, { span: '3.5s' });
const TIMES = seededTimes(489_03, 200, fl(0.001), fl(3.5));

/** First order: per segment x = b + (x0 − b)·e^(−Δ/τ), τ = tau_up rising and tau_down falling; rate and integral in closed form. */
function firstOrder(s: number): { value: number; rate: number; integral: number } {
  let x = SOURCE[0]![1]; let integral = 0;
  for (let i = 0; i < SOURCE.length; i++) {
    const [t0, b] = SOURCE[i]!;
    const t1 = i + 1 < SOURCE.length ? SOURCE[i + 1]![0] : Infinity;
    const tau = b > x ? TAU_UP : TAU_DOWN;
    const d = Math.min(s, t1) - t0;
    const e = Math.exp(-d / tau);
    if (s < t1) return { value: b + (x - b) * e, rate: (-(x - b) / tau) * e, integral: integral + b * d + (x - b) * tau * (1 - e) };
    integral += b * d + (x - b) * tau * (1 - e);
    x = b + (x - b) * e;
  }
  throw Error('unreachable');
}
/** Rate limit: toward each target at MAX per second, then holding it. */
function rateLimit(s: number): { value: number; rate: number } {
  let x = SOURCE[0]![1];
  for (let i = 0; i < SOURCE.length; i++) {
    const [t0, b] = SOURCE[i]!;
    const t1 = i + 1 < SOURCE.length ? SOURCE[i + 1]![0] : Infinity;
    const d = Math.min(s, t1) - t0;
    const sign = Math.sign(b - x);
    const travelled = Math.min(MAX * d, Math.abs(b - x));
    if (s < t1) return { value: x + sign * travelled, rate: travelled < Math.abs(b - x) ? sign * MAX : 0 };
    x += sign * travelled;
  }
  throw Error('unreachable');
}

describe('criterion 3: a follow channel is exact at random times, however the playhead got there', () => {
  it('criterion 3: every playhead path to 200 random times reads the same value, rate and integral, bit for bit', () => {
    const bin = motion.bin();
    const half = Math.floor(TIMES.length / 2);
    const paths: [string, number[]][] = [
      ['a straight play', TIMES],
      ['a play backwards', [...TIMES].reverse()],
      ['a shuffled order', shuffled(TIMES, 489_33)],
      ['a scrub forward, back and forward again', [...TIMES.slice(0, half), ...TIMES.slice(0, half).reverse(), ...TIMES]],
    ];
    const answers = evalAll(bin, [...paths.map(([, times]) => ({ doc: DOC, times })), ...TIMES.map((t) => ({ doc: DOC, times: [t] }))]);
    const read = new Map<number, string>();
    const straight = accepted(answers[0]!, TIMES, 'the straight play');
    straight.frames.forEach((f) => read.set(f.t, JSON.stringify(f.channels)));
    const failures: string[] = [];
    paths.slice(1).forEach(([name, times], p) => {
      for (const f of accepted(answers[p + 1]!, times, name).frames) {
        if (JSON.stringify(f.channels) !== read.get(f.t)) failures.push(`${name}: at ${f.t} flicks it reads ${JSON.stringify(f.channels)}, the straight play ${read.get(f.t)}`);
      }
    });
    TIMES.forEach((t, i) => {
      const f = accepted(answers[paths.length + i]!, [t], `the seek to ${t}`).frames[0]!;
      if (JSON.stringify(f.channels) !== read.get(t)) failures.push(`a cold seek to ${t} flicks reads ${JSON.stringify(f.channels)}, the straight play ${read.get(t)}`);
    });
    none(failures, 'the follow channels read the same however the playhead got there');
  }, TIMEOUT);

  it('criterion 3: at those times they are the closed form: first order and rate limit as computed here, the spring as RK4 at 1 µs, within 1e-9 relative', () => {
    const answers = evalAll(motion.bin(), [{ doc: DOC, times: shuffled(TIMES, 489_34) }]);
    const frames: Frame[] = accepted(answers[0]!, shuffled(TIMES, 489_34), 'a shuffled play').frames;
    const springRef = rk4Spring(springOfHz(HZ, ZETA), 10, 0, SOURCE, frames.map((f) => f.t / FLICKS));
    const failures: string[] = [];
    const check = (what: string, got: number, want: number, abs = 0): void => {
      if (!(withinRel(got, want, 1e-9) || Math.abs(got - want) <= abs)) failures.push(`${what}: reads ${got}, the closed form ${want}`);
    };
    frames.forEach((f, i) => {
      const s = f.t / FLICKS;
      const fo = firstOrder(s); const rl = rateLimit(s);
      check(`lag value at ${f.t}`, chan(f, 'lag'), fo.value);
      check(`lag rate at ${f.t}`, chan(f, 'lag', 'rate'), fo.rate, 1e-9);
      check(`lag integral at ${f.t}`, chan(f, 'lag', 'integral'), fo.integral);
      check(`ramp value at ${f.t}`, chan(f, 'ramp'), rl.value);
      check(`ramp rate at ${f.t}`, chan(f, 'ramp', 'rate'), rl.rate, 1e-9);
      check(`bounce value at ${f.t}`, chan(f, 'bounce'), springRef[i]!);
    });
    // The spring's rate is the derivative of its value: a central difference at ±1 µs from RK4 agrees within 1e-6 relative.
    const probe = TIMES.filter((_, i) => i % 20 === 0);
    const near = probe.flatMap((t) => [t / FLICKS - 1e-6, t / FLICKS + 1e-6]);
    const nearRef = rk4Spring(springOfHz(HZ, ZETA), 10, 0, SOURCE, near);
    const rates = accepted(evalAll(motion.bin(), [{ doc: DOC, times: probe }])[0]!, probe, 'the spring\'s rate').frames;
    rates.forEach((f, i) => {
      const want = (nearRef[2 * i + 1]! - nearRef[2 * i]!) / 2e-6;
      if (!(withinRel(chan(f, 'bounce', 'rate'), want, 1e-6) || Math.abs(chan(f, 'bounce', 'rate') - want) <= 1e-6)) failures.push(`bounce rate at ${f.t}: reads ${chan(f, 'bounce', 'rate')}, the derivative ${want}`);
    });
    none(failures, 'the follow channels are their closed forms');
  }, TIMEOUT);
});
