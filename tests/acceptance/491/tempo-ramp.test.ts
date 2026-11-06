// Criterion 3: "A 16-beat ramp from 90 to 150 BPM, linear in beats, ends 8.1732 s after it starts, within one flick
// of its closed form, and a segment whose explicit time is 2 flicks off its chained start is refused naming both
// times"
//
// Through `deep-motion eval`. The ramp is a tempo map's first segment at 2 s, `{bpm: 90, meter: 4/4, span: 16, ramp:
// {to_bpm: 150, shape: linear_in_beats}}`, followed by a 150 BPM segment at `5:1b`; markers at `1:1b` (where it
// starts) and `5:1b` (where it ends) read the flicks. Its length must be within one flick of the closed form
// 60·N ÷ (b1 − b0) · ln(b1 ÷ b0) = 8.17321 s (computed here in f64), and 8.1732 s to the issue's four places.
//
// The refusal: a 2-beat ramp from 80 to 144 BPM at 0 s ends at its closed form, 777,641,757.67 flicks, so its chained
// end is 777,641,758; a second segment given the explicit time `1.1021s` (777,641,760 flicks, a literal the time
// grammar writes exactly) is 2 flicks off it and must be refused, the refusal naming both times. The same chain with
// a constant 80 BPM first segment, whose end is exactly 1.5 s, and the explicit time `1.5s` is accepted (README:
// Choices), so the refusal is the 2 flicks, not the explicit time. No upstream test (oracle page).
import { describe, expect, it } from 'vitest';
import { FLICKS, TIMEOUT, evalOk, evalOne, film, fl, markerT, mentions, numbersIn, rampSeconds, refused, segment, show, tempoMap, useMotion } from './helpers.ts';

const motion = useMotion();

describe('criterion 3: tempo ramps linear in beats, and segments chained to the flick', () => {
  it('criterion 3: a 16-beat ramp from 90 to 150 BPM ends 8.1732 s after it starts, within one flick of its closed form', () => {
    const doc = film('ramp', [], {
      tempo_map: tempoMap([segment('2s', 90, [4, 4], 16, { to_bpm: 150 }), segment('5:1b', 150, [4, 4], 4)]),
      markers: { start: { kind: 'cue', t: '1:1b' }, end: { kind: 'cue', t: '5:1b' } },
    }, { span: '12s' });
    const a = evalOk(motion.bin(), { doc, times: [0] }, 'the ramp');
    const length = markerT(a, 'end', 'the ramp') - markerT(a, 'start', 'the ramp');
    const closed = rampSeconds(16, 90, 150) * FLICKS;
    expect(Math.abs(length - closed), `the ramp lasts ${length} flicks; its closed form is ${closed}: within one flick`).toBeLessThanOrEqual(1);
    expect(Math.abs(length / FLICKS - 8.1732), `the ramp lasts ${length / FLICKS} s: 8.1732 s to four places`).toBeLessThanOrEqual(0.00005);
  }, TIMEOUT);

  it('criterion 3: a segment whose explicit time is 2 flicks off its chained start is refused, naming both times', () => {
    const chained = Math.round(rampSeconds(2, 80, 144) * FLICKS);
    const explicit = fl(1.1021);
    expect([chained, explicit], 'fixture: the explicit time 1.1021s is 2 flicks after the ramp\'s chained end').toEqual([777_641_758, chained + 2]);

    const exact = film('chain-exact', [], {
      tempo_map: tempoMap([segment('0s', 80, [2, 4], 2), segment('1.5s', 144, [2, 4], 2)]),
      markers: { second: { kind: 'cue', t: '2:1b' } },
    }, { span: '3s' });
    const ok = evalOk(motion.bin(), { doc: exact, times: [0] }, 'an explicit time on its chained start');
    expect(markerT(ok, 'second', 'an explicit time on its chained start'), 'the second segment starts at its explicit time 1.5 s').toBe(fl(1.5));

    const off = film('chain-off', [], {
      tempo_map: tempoMap([segment('0s', 80, [2, 4], 2, { to_bpm: 144 }), segment('1.1021s', 144, [2, 4], 2)]),
      markers: { second: { kind: 'cue', t: '2:1b' } },
    }, { span: '3s' });
    const r = refused(evalOne(motion.bin(), { doc: off, times: [0] }), 'an explicit time 2 flicks off its chained start');
    const ns = numbersIn(r);
    const namesChained = ns.some((n) => n === chained || (n > 0 && n < 100 && Math.round(n * FLICKS) === chained));
    const namesExplicit = ns.some((n) => n === explicit || n === 1.1021) || mentions(r, '1.1021s');
    expect(namesChained, `the refusal names the chained start, ${chained} flicks: ${show(r)}`).toBe(true);
    expect(namesExplicit, `the refusal names the explicit time, 1.1021s (${explicit} flicks): ${show(r)}`).toBe(true);
  }, TIMEOUT);
});
