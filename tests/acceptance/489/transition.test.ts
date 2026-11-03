// Criterion 12: "A follow channel with transition {span: 0.2 s, interp: ease out_cubic} on a toggle knob's x, whose
// source goes from 17 to 47 at 1.0 s, reads 17 at 1.0 s, 43.25 at 1.1 s and 47 from 1.2 s; with a second entry back
// to 17 at 1.1 s it starts from 43.25 and reads 20.28125 at 1.2 s and 17 from 1.3 s; 1,000 seeded times read the
// same seeked and played; under reduced_motion: hold the knob reads 47 from 1.0 s while an opacity channel on the
// same source reads 0.875 at 1.1 s; and a planted transition that restarts from the old target jumps from 43.25 to
// 47 at 1.1 s and fails, naming the channel and the flick"
//
// Through `deep-motion eval`. The follow channel's source is keyed (each source key holds until the next: "the
// source must hold constant between input entries"); `model: {transition: {span: 0.2, interp: {ease: {name:
// "out_cubic"}}}}`. Reduced motion is the eval line's `view: {reduced_motion: true}` over the document's
// `transport.reduced_motion: "hold"`. The opacity channel follows the same toggle: its source changes from 0 to 1
// at the same flick (README: Choices where the issue is open). Expected values: v0 + (v1 − v0)·out_cubic(u),
// computed here. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, chan, chanOr, evalOk, evalPlanted, failsNaming, film, fl, follow, none, outCubic, rect, seekPlayFailures, seededTimes, useMotion,
  type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();

const TRANSITION = { transition: { span: 0.2, interp: { ease: { name: 'out_cubic' } } } };
const SPAN = 3;
function knobDoc(id: string, source: [number, number][], opacity?: [number, number][]): JsonObject {
  const channels: JsonObject = { kx: follow('items/knob/at/pos/0', source, TRANSITION) };
  if (opacity) channels['ko'] = follow('items/knob/adjust/opacity', opacity, TRANSITION);
  return film(id, [rect('knob', [17, 80])], { channels }, { span: `${SPAN}s`, reduced_motion: 'hold' });
}
const ONE = knobDoc('toggle-once', [[0, 17], [1.0, 47]]);
const TWO = knobDoc('toggle-twice', [[0, 17], [1.0, 47], [1.1, 17]]);
const HOLD = knobDoc('toggle-reduced', [[0, 17], [1.0, 47]], [[0, 0], [1.0, 1]]);

/** The issue's reading of ONE and TWO at time s (seconds), in f64. */
function expectedOne(s: number): number {
  if (s < 1.0) return 17;
  if (s >= 1.2) return 47;
  return 17 + 30 * outCubic((s - 1.0) / 0.2);
}
function expectedTwo(s: number): number {
  if (s < 1.0) return 17;
  if (s < 1.1) return 17 + 30 * outCubic((s - 1.0) / 0.2);
  const from = 17 + 30 * outCubic(0.5);
  if (s >= 1.3) return 17;
  return from + (17 - from) * outCubic((s - 1.1) / 0.2);
}
const SEEDED = seededTimes(489_12, 1000, 0, fl(SPAN));

/** The check: at every frame, the channel kx reads the expected value (within 1e-9); failures name the channel and the flick. */
function readFailures(a: Accepted | null, expected: (s: number) => number, what: string): string[] {
  if (!a) return [`${what}: no frames for the channel kx`];
  const failures: string[] = [];
  for (const f of a.frames) {
    const got = chanOr(f, 'kx');
    const want = expected(f.t / FLICKS);
    if (!(Math.abs(got - want) <= 1e-9)) failures.push(`${what}: channel kx at ${f.t} flicks reads ${got}, not ${want}`);
  }
  return failures;
}

describe('criterion 12: a follow channel with a transition moves from the value it holds to each new target over a fixed span', () => {
  it('criterion 12: the knob reads 17 at 1.0 s, 43.25 at 1.1 s and 47 from 1.2 s', () => {
    const times = [fl(0.5), fl(1.0), fl(1.1), fl(1.2), fl(1.25), fl(2), fl(2.999)];
    const a = evalOk(motion.bin(), { doc: ONE, times }, 'the toggle once');
    const [, at10, at11, ...rest] = a.frames;
    expect(chan(at10!, 'kx'), 'at 1.0 s').toBe(17);
    expect(Math.abs(chan(at11!, 'kx') - 43.25), `at 1.1 s it reads 43.25, got ${chan(at11!, 'kx')}`).toBeLessThanOrEqual(1e-9);
    for (const f of rest) expect(chan(f, 'kx'), `at ${f.t / FLICKS} s, from 1.2 s on`).toBe(47);
    none(readFailures(evalOk(motion.bin(), { doc: ONE, times: SEEDED }, 'the toggle once at 1,000 seeded times'), expectedOne, 'the toggle once'), 'the transition along out_cubic at 1,000 seeded times');
  }, TIMEOUT);

  it('criterion 12: with a second entry back to 17 at 1.1 s it starts from 43.25 and reads 20.28125 at 1.2 s and 17 from 1.3 s', () => {
    const times = [fl(1.1), fl(1.2), fl(1.3), fl(1.5), fl(2.5)];
    const a = evalOk(motion.bin(), { doc: TWO, times }, 'the toggle twice');
    expect(Math.abs(chan(a.frames[0]!, 'kx') - 43.25), `at 1.1 s it starts from 43.25, got ${chan(a.frames[0]!, 'kx')}`).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(chan(a.frames[1]!, 'kx') - 20.28125), `at 1.2 s it reads 20.28125, got ${chan(a.frames[1]!, 'kx')}`).toBeLessThanOrEqual(1e-9);
    for (const f of a.frames.slice(2)) expect(chan(f, 'kx'), `at ${f.t / FLICKS} s, from 1.3 s on`).toBe(17);
    none(readFailures(evalOk(motion.bin(), { doc: TWO, times: SEEDED }, 'the toggle twice at 1,000 seeded times'), expectedTwo, 'the toggle twice'), 'the second transition from where the value was, at 1,000 seeded times');
  }, TIMEOUT);

  it('criterion 12: 1,000 seeded times read the same seeked and played', () => {
    const bin = motion.bin();
    none([...seekPlayFailures(bin, ONE, SEEDED, 'the toggle once'), ...seekPlayFailures(bin, TWO, SEEDED, 'the toggle twice')], 'seek equals play');
  }, TIMEOUT);

  it('criterion 12: under reduced_motion: hold the knob reads 47 from 1.0 s while an opacity channel on the same source reads 0.875 at 1.1 s', () => {
    const times = [fl(0.9), fl(1.0), fl(1.05), fl(1.1), fl(1.15), fl(1.2), fl(2)];
    const view = { reduced_motion: true };
    const a = evalOk(motion.bin(), { doc: HOLD, times, view }, 'the toggle under reduced motion');
    expect(chan(a.frames[0]!, 'kx'), 'before the change the knob is at 17').toBe(17);
    for (const f of a.frames.slice(1)) expect(chan(f, 'kx'), `the position lands on its target at the change's flick: at ${f.t / FLICKS} s`).toBe(47);
    expect(Math.abs(chan(a.frames[3]!, 'ko') - 0.875), `the opacity plays as written: 0.875 at 1.1 s, got ${chan(a.frames[3]!, 'ko')}`).toBeLessThanOrEqual(1e-9);
    expect(chan(a.frames[1]!, 'ko'), 'the opacity at 1.0 s is where it was').toBe(0);
    // Without reduced motion the same document plays the knob's transition too.
    const b = evalOk(motion.bin(), { doc: HOLD, times: [fl(1.1)] }, 'the same document without reduced motion');
    expect(Math.abs(chan(b.frames[0]!, 'kx') - 43.25), 'without reduced motion the knob reads 43.25 at 1.1 s').toBeLessThanOrEqual(1e-9);
  }, TIMEOUT);

  it('criterion 12: a planted transition that restarts from the old target jumps from 43.25 to 47 at 1.1 s and fails, naming the channel and the flick', () => {
    const times = [fl(1.1) - 1, fl(1.1), fl(1.2), fl(1.3)];
    const a = evalPlanted(motion.bin(), { doc: TWO, times, planted: 'transition_restarts_from_old_target' });
    expect(a, 'the planted program answers the document').not.toBeNull();
    expect(Math.abs(chanOr(a!.frames[0]!, 'kx') - 43.25), 'just before 1.1 s the planted transition is at 43.25').toBeLessThanOrEqual(1e-6);
    expect(chanOr(a!.frames[1]!, 'kx'), 'at 1.1 s the planted transition jumps to the old target').toBe(47);
    failsNaming(readFailures(a, expectedTwo, 'the planted transition'), ['kx', String(fl(1.1))], 'the reading check on the planted transition');
  }, TIMEOUT);
});
