// Criterion 1 again, on a real replica's own recording (README: Fixtures): the planted motions of fixtures/panels/motion-lab,
// each a journey that presses one button and waits to 6 s of the replica's clock. `motion_check` replays the journey in a
// fresh replica, records every 1/120 s step and reads that recording; the finding, its element's stable id and its time
// come from the real app's own frames. Each plant has a twin that moves the same way but passes: a fade for the pop-in, a
// declared flight for the jump, a declared spring for the overshoot, two reversals for the flicker and a drift that stops
// within the 2 s. A check that reads a different recording than the app made, or one that ignores a declaration, fails them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Drive, FLICKS, STEP, cleanup, checked, expectFindings, journey, requireMacos, type Obj } from './helpers.ts';

let drive: Drive;
beforeAll(async () => {
  requireMacos();
  drive = await Drive.start();
}, 600_000);
afterAll(cleanup, 60_000);

/** The journey's reply, and the time of its one input (the press): the recording's own list of inputs. */
async function ran(button: string, extra: Obj = {}): Promise<{ reply: Obj; click: number }> {
  const reply = await checked(drive, { journey: journey(button, extra) });
  const inputs = reply.recording?.inputs as { t: number }[] | undefined;
  expect(inputs?.length, `the recording lists the press as an input: ${JSON.stringify(reply.recording).slice(0, 300)}`).toBe(1);
  expect(reply.recording.step, 'it is sampled each 1/120 s').toBe(STEP);
  expect(reply.recording.frames, 'from the launch to 6 s of the clock, a frame each step').toBeGreaterThanOrEqual(6 * 120 - 2);
  return { reply, click: inputs![0]!.t };
}
const soon = (click: number, seconds: number): [number, number] => [click - 0.1 * FLICKS, click + seconds * FLICKS];

describe('#1427 AC1 on a real replica: each planted motion gives exactly one finding, named by its element\'s stable id', () => {
  it('pop_in: "Pop in" shows pop-row at full opacity in one step', async () => {
    const { reply, click } = await ran('Pop in');
    expectFindings(reply, [{ finding: 'pop_in', element: 'pop-row', partial: true, between: soon(click, 0.25), value: 1 }]);
    expect(reply.claim).toBe('FAIL');
  });
  it('jump: "Jump" moves jumper 180 pt of a 640 pt window, 28%, in one step, with no transition', async () => {
    const { reply, click } = await ran('Jump');
    expectFindings(reply, [{ finding: 'jump', element: 'jumper', partial: true, between: soon(click, 0.25), value: 360 / 1280 }]);
  });
  it('overshoot: "Overshoot" walks overshooter 10 to 100 pt, on to 190 and back, with no spring declared', async () => {
    const { reply, click } = await ran('Overshoot');
    // 90 pt past a move of 90 pt: 100% of the move (14% of the window's width).
    expectFindings(reply, [{ finding: 'overshoot', element: 'overshooter', partial: true, between: soon(click, 1.5), value: 1 }]);
  });
  it('flicker: "Flicker 3" swings badge\'s opacity up, down, up, down, three reversals in about 100 ms', async () => {
    const { reply, click } = await ran('Flicker 3');
    expectFindings(reply, [{ finding: 'flicker', element: 'badge', partial: true, between: soon(click, 0.5), atLeast: 3 }]);
  });
  it('no_settle: "Drift long" keeps drifter moving 3.6 s after the press, past the 2 s', async () => {
    const { reply, click } = await ran('Drift long');
    expectFindings(reply, [{ finding: 'no_settle', element: 'drifter', partial: true, between: [click + 2 * FLICKS, 6 * FLICKS], atLeast: 1e-6 }]);
  });
});

describe('#1427 AC1 on a real replica: the twins that move the same way but pass give nothing', () => {
  const twins: [string, string][] = [
    ['Fade in', 'fade-row appears at 10% and gains 10% a tick: no pop_in'],
    ['Fly', 'flyer moves as far as jumper does, under a declared transition("left"): no jump'],
    ['Spring', 'springer goes past its target under a declared under-damped spring: no overshoot'],
    ['Flicker 2', 'badge swings up, down, up: two reversals, no flicker'],
    ['Drift short', 'drifter moves for 0.7 s, then settles: no no_settle'],
  ];
  for (const [button, why] of twins) {
    it(`${button}: ${why}`, async () => {
      const { reply } = await ran(button);
      expectFindings(reply, []);
      expect(reply.claim, 'and the claim does not fail').not.toBe('FAIL');
    });
  }
});
