// Criterion 11: "On a 4.7 s document with loop: wrap, four waves with per_loop 23, 31, 43 and 59 and amplitudes
// 0.085, 0.065, 0.05 and 0.035 equal their sum of sines of 2π × n × t ÷ 4.7 within 1e-12 at 1,000 seeded times, and
// noise {amplitude: 10, per_loop: 23, seed: 3} reads at 4.7 s, before the wrap, the value and central-difference
// slope it reads at 0 within 1e-9; a planted per_loop that rounds the period to a whole flick first is 7.4e-9 off
// the first wave at 4.7 s and fails, and per_loop on a document with loop: none is refused, naming the channel"
//
// Through `deep-motion eval`. Each channel holds one hold key at 0 with value 0 and its modifiers
// (`modifiers: [{wave: {amplitude, per_loop}} | {noise: {amplitude, per_loop, seed}}]`), so it reads its
// modifiers' sum. "At 4.7 s, before the wrap" is read with the eval line's `unwrap: true` (README: Choices where
// the issue is open): its times are timeline positions, the loop not applied, so the channel is read at the span's
// end and past it. The central-difference slope is (v(x + h) − v(x − h)) ÷ 2h with h = 1 ms, at x = 4.7 s and at
// x = 0. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import {
  FLICKS, TIMEOUT, chan, chanOr, evalAll, evalOk, evalPlanted, failsNaming, film, fl, keyed, mentions, none, rect, refusal, seededTimes, show, useMotion,
  type Accepted, type JsonObject,
} from './helpers.ts';

const motion = useMotion();

const SPAN = fl(4.7);
const WAVES: [number, number][] = [[23, 0.085], [31, 0.065], [43, 0.05], [59, 0.035]];
const flat = (target: string, modifiers: JsonObject[]): JsonObject => keyed(target, { k0: { t: '0s', value: 0, interp: 'hold' } }, { modifiers });
const wave = (n: number, amplitude: number): JsonObject => ({ wave: { amplitude, per_loop: n } });
const NOISE = { noise: { amplitude: 10, per_loop: 23, seed: 3 } };
function loopDoc(id: string, loop: 'wrap' | 'none'): JsonObject {
  return film(id, [rect('dot', [100, 100])], {
    channels: {
      waves: flat('items/dot/at/pos/1', WAVES.map(([n, a]) => wave(n, a))),
      first: flat('items/dot/at/rot/2', [wave(23, 0.085)]),
      grain: flat('items/dot/at/pos/0', [NOISE]),
    },
  }, { span: '4.7s', loop });
}
const WRAP = loopDoc('loop-wrap', 'wrap');

/** Σ a·sin(2π·n·t ÷ 4.7) at `flicks`, the phase as flicks over the span's flicks. */
const sumOfSines = (flicks: number, waves: [number, number][]): number => waves.reduce((acc, [n, a]) => acc + a * Math.sin((2 * Math.PI * n * flicks) / SPAN), 0);
const TIMES = seededTimes(489_11, 1000, 0, SPAN);

/** The check on the first wave at the span's end, read unwrapped: within 1e-12 of 0.085·sin(2π·23); failures name the channel. */
function firstWaveFailures(a: Accepted | null, what: string): string[] {
  if (!a) return [`${what}: no frames for the channel first`];
  const failures: string[] = [];
  for (const f of a.frames) {
    const got = chanOr(f, 'first');
    const want = sumOfSines(f.t, [[23, 0.085]]);
    if (!(Math.abs(got - want) <= 1e-12)) failures.push(`${what}: channel first (wave per_loop 23) at ${f.t} flicks reads ${got}, ${Math.abs(got - want).toExponential(2)} off ${want}`);
  }
  return failures;
}

describe('criterion 11: waves and noise with per_loop end where they start on a looping document', () => {
  it('criterion 11: four waves with per_loop 23, 31, 43 and 59 equal their sum of sines of 2π × n × t ÷ 4.7 within 1e-12 at 1,000 seeded times', () => {
    const a = evalOk(motion.bin(), { doc: WRAP, times: TIMES }, 'the four waves');
    const failures: string[] = [];
    for (const f of a.frames) {
      const got = chan(f, 'waves');
      const want = sumOfSines(f.t, WAVES);
      if (!(Math.abs(got - want) <= 1e-12)) failures.push(`at ${f.t} flicks the waves read ${got}, the sum of sines ${want}`);
    }
    none(failures, 'the four waves at 1,000 seeded times');
    // A wrap returns to the start: the clock past the span reads what the same position read.
    const wrapped = evalOk(motion.bin(), { doc: WRAP, times: TIMES.slice(0, 50).map((t) => t + SPAN) }, 'the waves one loop later');
    wrapped.frames.forEach((f, i) => expect(chan(f, 'waves'), `one loop later at ${f.t} flicks`).toBe(chan(a.frames[i]!, 'waves')));
  }, TIMEOUT);

  it('criterion 11: noise {amplitude: 10, per_loop: 23, seed: 3} reads at 4.7 s, before the wrap, the value and central-difference slope it reads at 0, within 1e-9', () => {
    const h = fl(0.001);
    const times = [0, -h, h, SPAN, SPAN - h, SPAN + h];
    const a = evalOk(motion.bin(), { doc: WRAP, times, unwrap: true }, 'the noise read unwrapped');
    const [v0, v0m, v0p, vT, vTm, vTp] = a.frames.map((f) => chan(f, 'grain')) as [number, number, number, number, number, number];
    const hs = h / FLICKS;
    const slope0 = (v0p - v0m) / (2 * hs);
    const slopeT = (vTp - vTm) / (2 * hs);
    expect(Math.abs(v0) > 1e-6 || Math.abs(slope0) > 1e-6, `the noise moves near 0 (value ${v0}, slope ${slope0}); a noise that reads 0 proves nothing`).toBe(true);
    expect(Math.abs(vT - v0), `the value at 4.7 s (${vT}) is the value at 0 (${v0})`).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(slopeT - slope0), `the central-difference slope at 4.7 s (${slopeT}) is the slope at 0 (${slope0})`).toBeLessThanOrEqual(1e-9);
    // Unwrapped, the waves too end where they start.
    expect(Math.abs(chan(a.frames[3]!, 'waves') - chan(a.frames[0]!, 'waves')), 'the four waves at 4.7 s read what they read at 0').toBeLessThanOrEqual(1e-12);
  }, TIMEOUT);

  it('criterion 11: a planted per_loop that rounds the period to a whole flick first is 7.4e-9 off the first wave at 4.7 s and fails', () => {
    const bin = motion.bin();
    const good = evalOk(bin, { doc: WRAP, times: [SPAN], unwrap: true }, 'the first wave at 4.7 s');
    none(firstWaveFailures(good, 'the first wave'), 'the first wave at 4.7 s, read unwrapped');
    const a = evalPlanted(bin, { doc: WRAP, times: [SPAN, ...TIMES.slice(0, 200)], unwrap: true, planted: 'per_loop_rounds_period_to_flick' });
    expect(a, 'the planted program answers the document').not.toBeNull();
    const off = Math.abs(chanOr(a!.frames[0]!, 'first') - sumOfSines(SPAN, [[23, 0.085]]));
    // The period 4.7 s ÷ 23 is 144,187,826.087 flicks; rounded to 144,187,826, 4.7 s is 23 periods and 2 flicks.
    const predicted = 0.085 * Math.sin((2 * Math.PI * 2) / Math.round(SPAN / 23));
    expect(off.toExponential(1), `the planted first wave at 4.7 s is ${off.toExponential(3)} off (predicted ${predicted.toExponential(3)})`).toBe('7.4e-9');
    failsNaming(firstWaveFailures(a, 'the planted per_loop'), ['first'], 'the first-wave check on the planted per_loop');
  }, TIMEOUT);

  it('criterion 11: per_loop on a document with loop: none is refused, naming the channel', () => {
    const [waves, noise] = evalAll(motion.bin(), [
      { doc: film('waves-none', [rect('dot', [100, 100])], { channels: { tide: flat('items/dot/at/pos/1', [wave(23, 0.085)]) } }, { span: '4.7s', loop: 'none' }), times: [0] },
      { doc: film('noise-none', [rect('dot', [100, 100])], { channels: { grit: flat('items/dot/at/pos/0', [NOISE]) } }, { span: '4.7s', loop: 'none' }), times: [0] },
    ]) as [JsonObject, JsonObject];
    const w = refusal(waves, 'a wave with per_loop on a document that doesn\'t loop');
    expect(mentions(w.raw, 'tide'), `the refusal names the channel tide: ${show(w.raw)}`).toBe(true);
    const n = refusal(noise, 'noise with per_loop on a document that doesn\'t loop');
    expect(mentions(n.raw, 'grit'), `the refusal names the channel grit: ${show(n.raw)}`).toBe(true);
  }, TIMEOUT);
});
