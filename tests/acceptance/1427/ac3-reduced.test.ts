// Criterion 3 (README: Criterion 3): under reduced motion, any element that changes place over more than one step gives
// moved_under_reduced_motion, naming it, the time and the number of steps it moved over. An element that changes place
// in one step does not, and the same move with reduced motion off does not either (it is only motion). On data, and on a
// real replica launched with `reduced_motion: true`, where the lab's drifter ignores it (a timer moves it) and its
// declared transition honors it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Drive, FLICKS, REDUCED, STEP, cleanup, checked, el, expectFindings, journey, recording, requireMacos, still } from './helpers.ts';

let drive: Drive;
beforeAll(async () => {
  requireMacos();
  drive = await Drive.start();
}, 600_000);
afterAll(cleanup, 60_000);

describe('#1427 AC3 an element that changes place over more than one step under reduced motion gives moved_under_reduced_motion', () => {
  it('data: a card moves 10 a step for 20 steps under reduced motion: one finding, 20 steps', async () => {
    // It changes place at steps 31 to 50.
    expectFindings(await checked(drive, { recording: REDUCED(20) }), [
      { finding: 'moved_under_reduced_motion', element: 'card:1', between: [31 * STEP, 50 * STEP], value: 20 },
    ]);
  });
  it('data: it moves over exactly two steps: more than one, so a finding, 2 steps', async () => {
    expectFindings(await checked(drive, { recording: REDUCED(2) }), [
      { finding: 'moved_under_reduced_motion', element: 'card:1', between: [31 * STEP, 32 * STEP], value: 2 },
    ]);
  });
  it('data twin: it moves in one step, 10 at once: nothing', async () => {
    expectFindings(await checked(drive, { recording: REDUCED(1) }), []);
  });
  it('data twin: it moves 20% of the window in one step: nothing, since reduced motion allows a move that takes one step', async () => {
    const jump = recording({ reduced: true, at: (k) => [...still(), el('card:1', 100 + (k >= 30 ? 200 : 0), 200)] });
    expectFindings(await checked(drive, { recording: jump }), []);
  });
  it('data twin: the 20-step move with reduced motion off: nothing (it is motion, which is allowed)', async () => {
    expectFindings(await checked(drive, { recording: REDUCED(20, false) }), []);
  });
  it('data: only a change of place counts: a card that fades over 20 steps under reduced motion gives nothing', async () => {
    const fade = recording({ reduced: true, at: (k) => [...still(), el('card:1', 100, 200, Math.min(1, 0.5 + Math.max(0, k - 30) * 0.025))] });
    expectFindings(await checked(drive, { recording: fade }), []);
  });

  it('a real replica launched with reduced_motion: "Drift short" still moves drifter over 30 ticks: moved_under_reduced_motion', async () => {
    const reply = await checked(drive, { journey: journey('Drift short', { reduced_motion: true }) });
    expect(reply.recording.reduced_motion, 'the recording says the replica ran under reduced motion').toBe(true);
    const click = reply.recording.inputs[0].t as number;
    expectFindings(reply, [
      { finding: 'moved_under_reduced_motion', element: 'drifter', partial: true, between: [click, click + 1.5 * FLICKS], atLeast: 2 },
    ]);
  });
  it('a real replica launched with reduced_motion: "Fly" goes where it goes under the declared transition, which reduced motion makes one step: nothing', async () => {
    const reply = await checked(drive, { journey: journey('Fly', { reduced_motion: true }) });
    expectFindings(reply, []);
  });
  it('the same "Drift short" with reduced motion off: nothing', async () => {
    expectFindings(await checked(drive, { journey: journey('Drift short') }), []);
  });
});
