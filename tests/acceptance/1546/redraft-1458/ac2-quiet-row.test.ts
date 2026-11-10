// Criterion 2 of #1546 (../README.md: Criterion 2), redrafted blind for #1458's "One way to write a time" (README.md
// here): a fixture session going quiet, on the virtual clock with no input, updates its row by the next minute. The
// fixture's quiet session was last seen 90 s before the clock's now, so its sidebar row reads "last seen 1 min" at launch
// and must read "last seen 2 min", "3 min" and "4 min" from 30 s, 90 s and 150 s of the replica's clock. A length reads
// with a space and no "ago" (#1458): a row still reading "... min ago" fails, naming the string. The run sends no input:
// only clock steps and `see`, which reads the last frame the window drew and draws none. A planted app with the timer
// removed (DEEP_HUB_PLANT=no-age-timer) fails, naming the row.
import { afterAll, describe, expect, it } from 'vitest';
import { FLICKS, FRAME, PLANT, Replica, buildDrive, cleanup, minuteAt, quietRow, requireMacos, said, stepOf, type Frames } from '../helpers.ts';

afterAll(cleanup, 60_000);
const LONG = 1_900_000;

/** Two frames either side of each minute the age reaches: what the row must read there. */
const READINGS = [2, 3, 4].flatMap((m) => [
  { t: minuteAt(m) - 2 * FRAME, minutes: m - 1 },
  { t: minuteAt(m) + 2 * FRAME, minutes: m },
]);

/** `step` is the clock step that moved to `t`; the `see` that read the row is the step after it. */
interface Reading { step: number; t: number; minutes: number; row: string }

/** The journey: the clock moved to each reading's time and the drawn row read there, then one still frame. */
async function quiet(hub?: string): Promise<{ readings: Reading[]; frames: Frames }> {
  requireMacos();
  buildDrive();
  const replica = await Replica.open(hub ? { hub } : {});
  const readings: Reading[] = [];
  try {
    for (const { t, minutes } of READINGS) {
      await replica.until(t);
      const step = replica.steps;
      readings.push({ step, t, minutes, row: quietRow(await replica.see()).name ?? '' });
    }
    await replica.by(FRAME);
    return { readings, frames: await replica.close() };
  } finally {
    await replica.stop();
  }
}

/** "last seen N min", as a length is written (#1458): the number, a space and "min" as a whole word. */
const lastSeen = (minutes: number): RegExp => new RegExp(`\\blast seen ${minutes} min\\b`);
/** A length written as a time since: "ago" anywhere in the row. */
const AGO = /\bago\b/;

/** The judge, the same for the app and for the planted one: each reading the row got wrong, naming the row's string. */
const wrong = (readings: Reading[]): string[] => readings
  .filter((r) => !lastSeen(r.minutes).test(r.row) || AGO.test(r.row))
  .map((r) => `at ${(r.t / FLICKS).toFixed(3)} s of the clock the row "${r.row}" should read "last seen ${r.minutes} min"${AGO.test(r.row) ? ', with no "ago"' : ''}`);

describe('#1546 AC2 (redraft for #1458) a quiet session\'s row updates its age by the next minute, on the virtual clock, with no input, written with no "ago"', () => {
  it('the row reads "last seen 1 min", then 2, 3 and 4 min, each from its minute on, with no "ago", drawn by the window itself', async () => {
    const { readings, frames } = await quiet();
    expect(wrong(readings), 'the drawn row reads "last seen N min", with no "ago", at each minute').toEqual([]);
    for (const r of readings.filter((r) => r.t === minuteAt(r.minutes) + 2 * FRAME)) {
      expect(stepOf(frames, r.step).drawn, `the clock step to ${r.minutes} min made the window draw by itself`).toBeGreaterThanOrEqual(1);
    }
    expect(frames.findings.map(said), 'every step\'s forced frame equals the last drawn one').toEqual([]);
    expect(stepOf(frames, frames.steps.length), 'the still frame after the last minute draws nothing').toMatchObject({ frames: 1, drawn: 0 });
    expect(frames.claim).toBe('PASS');
  }, LONG);

  it('planted no-age-timer: the drawn row keeps "1 min" past the minute, and both the judge and the check fail, naming the row', async () => {
    const { readings, frames } = await quiet(PLANT.noAgeTimer);
    const problems = wrong(readings);
    expect(problems.length, `the judge fails the planted app: ${problems.join('; ')}`).toBeGreaterThan(0);
    expect(problems[0], 'naming the quiet session\'s row, at the first minute it missed').toMatch(/the row "[^"]*quiet · last seen 1 min" should read "last seen 2 min"$/);
    expect(frames.claim, 'the check fails').toBe('FAIL');
    const missed = readings.find((r) => r.minutes === 2)!;
    const at = frames.findings.find((f) => f.step === missed.step);
    expect(at, `a finding at the clock step that crossed 2 min (step ${missed.step}): ${frames.findings.map(said).join('; ')}`).toBeTruthy();
    expect(at!.view, 'in the sidebar').toMatch(/(^|\/)sidebar$/);
    expect({ forced: String(at!.node.name), drawn: String(at!.drawn?.name) }, `naming the row: ${said(at!)}`).toEqual({ forced: expect.stringMatching(lastSeen(2)), drawn: expect.stringMatching(lastSeen(1)) });
    expect(AGO.test(String(at!.node.name)) || AGO.test(String(at!.drawn?.name)), `neither frame writes the row with "ago": ${said(at!)}`).toBe(false);
    expect(String(at!.node.name), 'the same row in both').toBe(String(at!.drawn?.name).replace('1 min', '2 min'));
  }, LONG);
});
