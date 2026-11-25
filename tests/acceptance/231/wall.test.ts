// AC3 #231.84a45611: "The receipt's `wall` is within 5% of the time from the command to the file, measured outside the
// export, and no phase's busy time is above it; a planted receipt that takes `wall` as the sum of the phases reads
// above the measured time on the city fixture, where the phases overlap, and fails, naming `wall`"
//
// Through `deep-show run`'s `export` (README: `export`, The time from the command to the file). The city (helpers.ts
// `speedFilm`) is exported as a draft by a fresh headless process that the suite starts and times itself: from the
// moment it starts the process with the scenario on its stdin to the moment the file is first seen under its name.
// The receipt's `timing` must hold every phase and `wall`, in seconds, and no phase may read above `wall`: a relation
// inside one receipt, judged on any machine. `wall` within 5% of the measured time is a clock reading: it is judged on
// a quiet reference Mac and reads INCONCLUSIVE with its reading anywhere else, never a pass. The planted receipt's
// `wall`, the sum of its phases, must read above the measured time by more than that 5% wherever the city's phases
// overlap, so its leg is judged on any machine. Wrong programs: the merge base (its receipt's `timing` holds `open`
// alone); `receipt_wall_sums_phases`.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, PHASES, SET, failsNaming, inconclusive, loadProblem, none, phaseFailures, receiptOf, referenceMacProblem, speedRun, timingOf, useShow, useTemp, wallFailures,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const sec = (x: number): string => `${x.toFixed(3)} s`;

describe(`${AC[3]} the receipt's wall is the time from the command to the file, and no phase's busy time is above it`, () => {
  it(`${AC[3]} the city's draft: every phase and wall are in the receipt, no phase reads above wall, and wall is within 5% of the time measured from the command to the file`, async () => {
    const what = 'the city\'s draft';
    const run = await speedRun(show(FULL), temp(), 'city', 'draft');
    const r = receiptOf(run.reply, what);
    expect(r.frames, `${what}: the city's 3,600 frames`).toBe(SET.city.frames);
    const t = timingOf(r, what);
    expect(t.wall, `${what}: wall is a time`).toBeGreaterThan(0);
    expect(PHASES.filter((p) => t[p] > 0).length, `${what}: the phases that drew, hashed and encoded 3,600 frames took time: ${JSON.stringify(t)}`).toBeGreaterThanOrEqual(4);
    none(phaseFailures(what, t), `${what}: no phase's busy time is above wall`);
    expect(run.measured !== null && existsSync(run.out), `${what}: the file came under its name at ${run.out}`).toBe(true);
    const reading = `${what}: wall ${sec(t.wall)} in the receipt, ${sec(run.measured!)} measured from the command to the file`;
    console.log(`${AC[3]} ${reading}`);
    const off = (await referenceMacProblem()) ?? loadProblem([run.loads]);
    if (off) inconclusive(`${reading}; no phase reads above wall, and the 5% counts only on a quiet reference Mac: ${off}`);
    none(wallFailures(what, t.wall, run.measured!), reading);
  });

  it(`${AC[3]} a planted receipt that takes wall as the sum of the phases reads above the measured time on the city, where the phases overlap, and fails, naming wall`, async () => {
    const what = 'the city\'s draft (planted receipt_wall_sums_phases)';
    const run = await speedRun(show(FULL), temp(), 'city', 'draft', 'receipt_wall_sums_phases');
    const t = timingOf(receiptOf(run.reply, what), what);
    expect(run.measured, `${what}: the file came under its name`).not.toBeNull();
    failsNaming(wallFailures(what, t.wall, run.measured!), /`wall` reads [\d.]+ s, above the [\d.]+ s measured/, 'a wall taken as the sum of the phases');
  });
});
