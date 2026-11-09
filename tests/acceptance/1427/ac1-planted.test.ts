// Criterion 1, on recordings given as data (README: Criterion 1): each planted fixture gives exactly ONE finding, named
// with its element, its time and its measured value; each near-miss twin, the same fixture a hair under the issue's
// threshold or with the motion declared, gives nothing. A check that reads no threshold fails the plants; one with a
// threshold in the wrong place fails the twin on the other side of it; one that ignores a declaration fails the
// declared twin. The same plants run through a real replica's own recording in ac1-journeys.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Drive, DRIFT, FLICKER, JUMP, OVERSHOOT, POP, SLIDE, STEP, cleanup, checked, expectFindings, requireMacos, type Obj, type Recording,
} from './helpers.ts';

let drive: Drive;
beforeAll(async () => {
  requireMacos();
  drive = await Drive.start();
}, 600_000);
afterAll(cleanup, 60_000);

const check = (recording: Recording, extra: Obj = {}): Promise<Obj> => checked(drive, { recording, ...extra });

describe('#1427 AC1 planted fixtures each give exactly one finding, naming the element, the time and the measured value', () => {
  it('pop_in: a row that was not there appears at full opacity in one step', async () => {
    expectFindings(await check(POP(1)), [{ finding: 'pop_in', element: 'row:new', t: 30 * STEP, value: 1 }]);
  });
  it('pop_in: a row that appears at 55%, over the 50% line, in one step', async () => {
    expectFindings(await check(POP(0.55)), [{ finding: 'pop_in', element: 'row:new', t: 30 * STEP, value: 0.55 }]);
  });
  it('pop_in: a row that sat there invisible and is at 80% a step later', async () => {
    expectFindings(await check(POP(0.8, 'zero')), [{ finding: 'pop_in', element: 'row:new', t: 30 * STEP, value: 0.8 }]);
  });
  it('jump: an element moves 26% of the window width in one 1/120 s step, with no flight declared', async () => {
    expectFindings(await check(JUMP(260)), [{ finding: 'jump', element: 'card:1', t: 30 * STEP, value: 0.26 }]);
  });
  it('jump: 26% of the window height in one step', async () => {
    expectFindings(await check(JUMP(0, 208)), [{ finding: 'jump', element: 'card:1', t: 30 * STEP, value: 0.26 }]);
  });
  it('overshoot: an element goes more than 12% past its target, with no spring declared', async () => {
    // 0 to 720, on to 830 and back to 720: 110 past a move of 720 is 15.3% (13.8% of the 800-high window).
    expectFindings(await check(OVERSHOOT(830)), [{ finding: 'overshoot', element: 'panel:1', t: 58 * STEP, value: 110 / 720 }]);
  });
  it('flicker: opacity reverses direction three times within 200 ms', async () => {
    // Peaks and troughs at steps 33, 36 and 39 (25 ms apart): three reversals in 58 ms.
    expectFindings(await check(FLICKER(4)), [{ finding: 'flicker', element: 'badge:1', between: [33 * STEP, 42 * STEP], value: 3 }]);
  });
  it('no_settle: an element is still moving 2 s after the journey\'s last input', async () => {
    // Input at step 0; it moves a pixel a step until step 480, 4 s in, and the recording runs to 5 s.
    expectFindings(await check(DRIFT(480)), [{ finding: 'no_settle', element: 'badge:1', between: [240 * STEP, 599 * STEP], atLeast: 1e-6 }]);
  });
});

describe('#1427 AC1 near-miss twins give nothing', () => {
  const none: [string, Recording][] = [
    ['pop_in twin: a row appears at 49%, then rises a hundredth a step', POP(0.49)],
    ['pop_in twin: a row appears at exactly 50%, which is not above it', POP(0.5)],
    ['pop_in twin: a row sat invisible and is at 30% a step later', POP(0.3, 'zero')],
    ['jump twin: 24% of the window width in one step', JUMP(240)],
    ['jump twin: exactly 25% of the width, which is not over it', JUMP(250)],
    ['jump twin: 24% of the window height in one step', JUMP(0, 192)],
    ['jump twin: 26% in one step with a flight declared for the element', JUMP(260, 0, [{ element: 'card:1', kind: 'flight' }])],
    ['jump twin: a slide of 50% of the window over 100 steps, half a percent a step', SLIDE()],
    ['jump twin: the same slide with a flight declared', SLIDE([{ element: 'card:1', kind: 'flight' }])],
    ['overshoot twin: 80 past a move of 720, 11.1% of it and 10% of the window', OVERSHOOT(800)],
    ['overshoot twin: 110 past, but a spring is declared for the element', OVERSHOOT(830, [{ element: 'panel:1', kind: 'spring' }])],
    ['overshoot twin: it arrives and stops', OVERSHOOT(720)],
    ['flicker twin: two reversals in 25 ms', FLICKER(3)],
    ['flicker twin: four reversals, each 125 ms after the last, so never three in 200 ms', FLICKER(5, 15, 0.01)],
    ['no_settle twin: it stops 1.7 s after the input, before the 2 s mark', DRIFT(200)],
    ['no_settle twin: it is still moving 2.7 s after the first input, but 1.75 s after the last', DRIFT(330, [0, 120])],
  ];
  for (const [name, recording] of none) {
    it(name, async () => {
      const reply = await check(recording);
      expectFindings(reply, []);
      expect(['FAIL', 'INVALID', 'BLOCKED'], `a recording with no finding doesn't fail: ${JSON.stringify(reply).slice(0, 300)}`).not.toContain(reply.claim);
    });
  }

  it('a planted recording fails its claim, and a twin of it does not', async () => {
    const planted = await check(JUMP(260));
    const twin = await check(JUMP(240));
    expect(planted.claim, 'a finding fails the claim').toBe('FAIL');
    expect(twin.claim, 'and none does not').not.toBe('FAIL');
  });
});
