// Criterion 10: "A scale key from 0 to 1 at 0.28 s with spring {decay: 6.5, omega: 15} and velocity 6.5 reads
// 1 − e^(−6.5t)·cos(15t) within 1e-12 at 1,000 seeded times t after its key, peaks at 1.2808 at 0.1822 s after it,
// and a hard range of [0, 1.25] is refused naming the key and that peak; with velocity 0 it reads 0.7374 at 0.1 s,
// where the velocity form reads 0.9631; a key from 1 to 1 with {decay: 7, omega: 17} and velocity 2.21 reads
// 1 + 0.13·e^(−7t)·sin(17t) within 1e-12; each matches an RK4 integration of the spring's equation at 1 µs steps
// within 1e-6 relative in all three damping regimes, seeking equals playing, and a planted spring that drops
// velocity reads 0.7374 at 0.1 s and fails, naming the key"
//
// Through `deep-motion eval` (README: The surface under test). A spring key is `{t, value, interp: {spring:
// {decay, omega} | {freq_hz, damping_ratio}}, velocity}`; its segment runs to the next key, which here sits 2 s
// later, so every sampled time lies inside the spring's segment. Expected values are the issue's formulas and an
// RK4 of x'' = −2ζω0·x' − ω0²·(x − b) from (a, velocity), computed here. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, at, chan, chanOr, evalAll, evalOk, evalPlanted, failsNaming, film, fl, keyed, mentions, none, numbersIn, rect, refusal,
  rk4Spring, seekPlayFailures, seededTimes, show, springOfDecay, springOfHz, useMotion, withinRel, type Accepted, type JsonObject, type Spring,
} from './helpers.ts';

const motion = useMotion();

const KEY_T = 0.28;
/**
 * The next key, 2 s after the spring key: written as the literal 2.28, not KEY_T + 2 (2.2800000000000002 in f64,
 * whose text the time grammar refuses: at most five fraction digits). Redraft of Nov 2 (README: Redrafts).
 */
const END_T = 2.28;
/** The scale channel's document: key `grow` at 0.28 s from `a` with the spring, then `rest` at 2.28 s at `b`. */
function scaleDoc(id: string, a: number, b: number, spring: JsonObject, velocity: number, range?: [number, number]): JsonObject {
  const extra: JsonObject = range ? { range } : {};
  return film(id, [rect('pop', [100, 100])], {
    channels: {
      sc: keyed('items/pop/at/scale/0', {
        grow: { t: at(KEY_T), value: a, interp: { spring }, velocity },
        rest: { t: at(END_T), value: b, interp: 'linear' },
      }, extra),
    },
  }, { span: '3s' });
}
const POP = scaleDoc('pop-velocity', 0, 1, { decay: 6.5, omega: 15 }, 6.5);
const POP_REST = scaleDoc('pop-rest', 0, 1, { decay: 6.5, omega: 15 }, 0);
const WOBBLE = scaleDoc('wobble', 1, 1, { decay: 7, omega: 17 }, 2.21);

const K = fl(KEY_T);
/** 1,000 seeded times after the key, from 1 ms after it to before the next key. */
const TIMES = seededTimes(489_10, 1000, K + fl(0.001), fl(END_T));
const after = (T: number): number => (T - K) / FLICKS;

const popForm = (t: number): number => 1 - Math.exp(-6.5 * t) * Math.cos(15 * t);
const restForm = (t: number): number => 1 - Math.exp(-6.5 * t) * (Math.cos(15 * t) + (6.5 / 15) * Math.sin(15 * t));
const wobbleForm = (t: number): number => 1 + 0.13 * Math.exp(-7 * t) * Math.sin(17 * t);

/** The peak of 1 − e^(−6.5t)·cos(15t): where tan(15t) = −6.5 ÷ 15, the first maximum. */
const PEAK_AFTER = (Math.PI - Math.atan(6.5 / 15)) / 15;
const PEAK = popForm(PEAK_AFTER);

/** The check every program must pass on POP: each sampled time within 1e-12 of the issue's formula; failures name the key. */
function velocityFailures(a: Accepted | null, form: (t: number) => number, what: string): string[] {
  if (!a) return [`${what}: no frames for the channel sc, key grow`];
  const failures: string[] = [];
  for (const f of a.frames) {
    const got = chanOr(f, 'sc');
    const want = form(after(f.t));
    if (!(Math.abs(got - want) <= 1e-12)) failures.push(`${what}: channel sc, key grow, at ${f.t} flicks (${after(f.t).toFixed(6)} s after the key) reads ${got}, not ${want}`);
  }
  return failures;
}

describe('criterion 10: a spring key with velocity, in closed form, its peak checked against the hard range', () => {
  it('criterion 10: the 0 → 1 key with {decay: 6.5, omega: 15} and velocity 6.5 reads 1 − e^(−6.5t)·cos(15t) within 1e-12 at 1,000 seeded times after its key, and seeking equals playing', () => {
    const bin = motion.bin();
    const a = evalOk(bin, { doc: POP, times: TIMES }, 'the velocity key, played');
    none(velocityFailures(a, popForm, 'the velocity key'), 'the velocity form at 1,000 seeded times');
    none(seekPlayFailures(bin, POP, TIMES, 'the velocity key'), 'seeking to each of the 1,000 times equals playing');
  }, TIMEOUT);

  it('criterion 10: it peaks at 1.2808 at 0.1822 s after its key; a hard range of [0, 1.25] is refused naming the key and that peak, while [0, 1.3] is accepted', () => {
    expect(PEAK.toFixed(4), 'the issue\'s peak, computed').toBe('1.2808');
    expect(PEAK_AFTER.toFixed(4), 'the issue\'s peak time, computed').toBe('0.1822');
    const bin = motion.bin();
    const peakT = K + fl(PEAK_AFTER);
    const grid = Array.from({ length: 1000 }, (_, i) => K + fl(0.001 * (i + 1)));
    const a = evalOk(bin, { doc: POP, times: [peakT, ...grid] }, 'the velocity key around its peak');
    expect(Math.abs(chan(a.frames[0]!, 'sc') - popForm(after(peakT))), `at its peak time (${after(peakT)} s after the key) it reads the formula`).toBeLessThanOrEqual(1e-12);
    expect(chan(a.frames[0]!, 'sc').toFixed(4), 'its value at the peak').toBe('1.2808');
    const highest = Math.max(...a.frames.slice(1).map((f) => chan(f, 'sc')));
    expect(highest, 'no time in its first second reads above the closed-form peak').toBeLessThanOrEqual(PEAK + 1e-12);

    const [narrow, wide] = evalAll(bin, [
      { doc: scaleDoc('pop-narrow', 0, 1, { decay: 6.5, omega: 15 }, 6.5, [0, 1.25]), times: [K] },
      { doc: scaleDoc('pop-wide', 0, 1, { decay: 6.5, omega: 15 }, 6.5, [0, 1.3]), times: [K] },
    ]) as [JsonObject, JsonObject];
    const r = refusal(narrow, 'the key under a hard range of [0, 1.25]');
    expect(mentions(r.raw, 'grow'), `the refusal names the key grow: ${show(r.raw)}`).toBe(true);
    expect(numbersIn(r.raw).some((n) => Math.abs(n - PEAK) < 5e-5), `the refusal names the peak ${PEAK.toFixed(4)}: ${show(r.raw)}`).toBe(true);
    expect(wide['ok'], `the same key under [0, 1.3], which holds its peak, is accepted: ${show(wide)}`).toBe(true);
  }, TIMEOUT);

  it('criterion 10: with velocity 0 it reads 0.7374 at 0.1 s (the from-rest form within 1e-12), where the velocity form reads 0.9631', () => {
    const bin = motion.bin();
    const t01 = K + fl(0.1);
    const [rest, moving] = [evalOk(bin, { doc: POP_REST, times: [t01, ...TIMES] }, 'the key with velocity 0'), evalOk(bin, { doc: POP, times: [t01] }, 'the velocity key at 0.1 s')];
    expect(chan(rest.frames[0]!, 'sc').toFixed(4), 'velocity 0 at 0.1 s after the key').toBe('0.7374');
    expect(chan(moving.frames[0]!, 'sc').toFixed(4), 'velocity 6.5 at 0.1 s after the key').toBe('0.9631');
    none(velocityFailures({ ...rest, frames: rest.frames.slice(1) }, restForm, 'the key with velocity 0'), 'velocity 0 reads 1 − e^(−6.5t)·(cos 15t + (6.5 ÷ 15)·sin 15t) at 1,000 seeded times');
  }, TIMEOUT);

  it('criterion 10: the 1 → 1 key with {decay: 7, omega: 17} and velocity 2.21 reads 1 + 0.13·e^(−7t)·sin(17t) within 1e-12 at 1,000 seeded times, and seeking equals playing', () => {
    const bin = motion.bin();
    const a = evalOk(bin, { doc: WOBBLE, times: TIMES }, 'the 1 → 1 key');
    none(velocityFailures(a, wobbleForm, 'the 1 → 1 key'), 'the 1 → 1 form at 1,000 seeded times');
    none(seekPlayFailures(bin, WOBBLE, TIMES, 'the 1 → 1 key'), 'seeking equals playing');
  }, TIMEOUT);

  it('criterion 10: spring keys with velocity match an RK4 integration at 1 µs steps within 1e-6 relative at 1,000 seeded times in all three damping regimes, and seeking equals playing', () => {
    const bin = motion.bin();
    const cases: { name: string; doc: JsonObject; spring: Spring; a: number; b: number; v: number }[] = [
      { name: 'under-damped {decay: 6.5, omega: 15}, 0 → 1, velocity 6.5', doc: POP, spring: springOfDecay(6.5, 15), a: 0, b: 1, v: 6.5 },
      { name: 'under-damped {decay: 7, omega: 17}, 1 → 1, velocity 2.21', doc: WOBBLE, spring: springOfDecay(7, 17), a: 1, b: 1, v: 2.21 },
      { name: 'critically damped {freq_hz: 1.5, damping_ratio: 1}, 10 → 20, velocity 40', doc: scaleDoc('crit-v', 10, 20, { freq_hz: 1.5, damping_ratio: 1 }, 40), spring: springOfHz(1.5, 1), a: 10, b: 20, v: 40 },
      { name: 'over-damped {freq_hz: 1.5, damping_ratio: 2.5}, 10 → 20, velocity −30', doc: scaleDoc('over-v', 10, 20, { freq_hz: 1.5, damping_ratio: 2.5 }, -30), spring: springOfHz(1.5, 2.5), a: 10, b: 20, v: -30 },
    ];
    const failures: string[] = [];
    for (const c of cases) {
      const a = evalOk(bin, { doc: c.doc, times: TIMES }, c.name);
      const ref = rk4Spring(c.spring, c.a, c.v, [[0, c.b]], TIMES.map(after));
      a.frames.forEach((f, i) => {
        const got = chan(f, 'sc');
        if (!withinRel(got, ref[i]!, 1e-6)) failures.push(`${c.name}: at ${after(f.t).toFixed(6)} s after the key it reads ${got}, RK4 ${ref[i]}`);
      });
      failures.push(...seekPlayFailures(bin, c.doc, TIMES.filter((_, i) => i % 5 === 0), c.name));
    }
    none(failures, 'RK4 at 1 µs within 1e-6 relative, and seek equals play');
  }, TIMEOUT);

  it('criterion 10: a planted spring that drops velocity reads 0.7374 at 0.1 s and fails the velocity check, naming the key', () => {
    const bin = motion.bin();
    const t01 = K + fl(0.1);
    const a = evalPlanted(bin, { doc: POP, times: [t01, ...TIMES], planted: 'spring_drops_velocity' });
    expect(a, 'the planted program answers the document').not.toBeNull();
    expect(chanOr(a!.frames[0]!, 'sc').toFixed(4), 'the planted spring at 0.1 s after the key reads the from-rest value').toBe('0.7374');
    failsNaming(velocityFailures(a, popForm, 'the planted spring'), ['grow'], 'the velocity check on the planted spring');
  }, TIMEOUT);
});
