// Criterion 5: "Springs and follow channels match an RK4 integration of the spring's ODE at 1 µs steps within 1e-6
// relative at 1,000 seeded times in each damping regime, and a critically damped spring never overshoots its target"
//
// Through `deep-motion eval`. Two kinds of spring: a follow channel with `model: {spring: {freq_hz, damping_ratio}}`
// on a keyed source that steps four times (it starts at rest on the source's first value, and each segment starts
// from the state the last one left), and a spring key `{interp: {spring: {freq_hz, damping_ratio}}}` released from
// rest toward the next key's value. The velocity form of a spring key is criterion 10's. The reference is RK4 on
// x'' = −2ζω0·x' − ω0²·(x − target(t)), ω0 = 2π·freq_hz, at 1 µs steps, computed here; values stay above 9, so the
// relative tolerance is never taken near zero. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, chan, evalOk, film, fl, follow, keyed, none, rect, rk4Spring, seededTimes, springOfHz, useMotion, withinRel, type JsonObject,
} from './helpers.ts';

const motion = useMotion();

const REGIMES: [string, number][] = [['under-damped (ζ 0.3)', 0.3], ['critically damped (ζ 1)', 1], ['over-damped (ζ 2.5)', 2.5]];
const HZ = 1.5;
const SOURCE: [number, number][] = [[0, 10], [0.7, 20], [1.6, 14], [2.2, 25]];
function followDoc(zeta: number, source = SOURCE): JsonObject {
  return film(`follow-${zeta}`, [rect('dot', [100, 100])], { channels: { trail: follow('items/dot/at/pos/0', source, { spring: { freq_hz: HZ, damping_ratio: zeta } }) } }, { span: '4s' });
}
function keyDoc(zeta: number): JsonObject {
  return film(`key-${zeta}`, [rect('dot', [100, 100])], {
    channels: { hop: keyed('items/dot/at/pos/1', { k0: { t: '0s', value: 10, interp: { spring: { freq_hz: HZ, damping_ratio: zeta } } }, k1: { t: '3s', value: 20, interp: 'linear' } }) },
  }, { span: '4s' });
}
const FOLLOW_TIMES = seededTimes(489_05, 1000, fl(0.001), fl(4));
const KEY_TIMES = seededTimes(489_55, 1000, fl(0.001), fl(3));

describe('criterion 5: springs and follow channels in closed form match RK4 at 1 µs in each damping regime', () => {
  it('criterion 5: a follow spring on a stepping source matches RK4 at 1 µs steps within 1e-6 relative at 1,000 seeded times, under-, critically and over-damped', () => {
    const failures: string[] = [];
    for (const [name, zeta] of REGIMES) {
      const a = evalOk(motion.bin(), { doc: followDoc(zeta), times: FOLLOW_TIMES }, `the follow spring, ${name}`);
      const ref = rk4Spring(springOfHz(HZ, zeta), 10, 0, SOURCE, FOLLOW_TIMES.map((t) => t / FLICKS));
      a.frames.forEach((f, i) => {
        const got = chan(f, 'trail');
        if (!withinRel(got, ref[i]!, 1e-6)) failures.push(`the follow spring, ${name}, at ${(f.t / FLICKS).toFixed(6)} s reads ${got}, RK4 ${ref[i]}`);
      });
    }
    none(failures, 'follow springs against RK4');
  }, TIMEOUT);

  it('criterion 5: a spring key from rest matches RK4 at 1 µs steps within 1e-6 relative at 1,000 seeded times, under-, critically and over-damped', () => {
    const failures: string[] = [];
    for (const [name, zeta] of REGIMES) {
      const a = evalOk(motion.bin(), { doc: keyDoc(zeta), times: KEY_TIMES }, `the spring key, ${name}`);
      const ref = rk4Spring(springOfHz(HZ, zeta), 10, 0, [[0, 20]], KEY_TIMES.map((t) => t / FLICKS));
      a.frames.forEach((f, i) => {
        const got = chan(f, 'hop');
        if (!withinRel(got, ref[i]!, 1e-6)) failures.push(`the spring key, ${name}, at ${(f.t / FLICKS).toFixed(6)} s reads ${got}, RK4 ${ref[i]}`);
      });
    }
    none(failures, 'spring keys against RK4');
  }, TIMEOUT);

  it('criterion 5: a critically damped spring never overshoots its target: a follow spring from 10 to 20 and a spring key from 10 to 20, at 1,000 seeded times and every 1/600 s', () => {
    const grid = Array.from({ length: 1800 }, (_, i) => Math.round((i * FLICKS) / 600));
    const times = [...new Set([...KEY_TIMES, ...grid])].sort((a, b) => a - b);
    const step = evalOk(motion.bin(), { doc: followDoc(1, [[0, 10], [0.5, 20]]), times }, 'the critically damped follow spring');
    const key = evalOk(motion.bin(), { doc: keyDoc(1), times }, 'the critically damped spring key');
    const failures: string[] = [];
    for (const f of step.frames) if (chan(f, 'trail') > 20) failures.push(`the follow spring at ${f.t} flicks reads ${chan(f, 'trail')}, past its target 20`);
    for (const f of key.frames) if (chan(f, 'hop') > 20) failures.push(`the spring key at ${f.t} flicks reads ${chan(f, 'hop')}, past its target 20`);
    none(failures, 'no critically damped spring passes its target');
    expect(chan(step.frames[step.frames.length - 1]!, 'trail'), 'the follow spring has nearly reached its target by 3 s').toBeGreaterThan(19.9);
    expect(chan(key.frames[key.frames.length - 1]!, 'hop'), 'the spring key has nearly reached its target by 3 s').toBeGreaterThan(19.9);
  }, TIMEOUT);
});
