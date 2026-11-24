// AC5 #231.0c28c755: "The fixture set is exported twice from one fresh process: the first receipt reads start cold, and
// its prepare holds every pipeline compile and asset decode the compile thread and decode worker report, within 5%;
// the second reads start warm with nothing under prepare. The stated speeds hold for the mean of 3 cold runs, and a
// warm run is never averaged in; a planted receipt that books compiles under draw still matches the wall time and
// fails, naming prepare"
//
// This file: the two starts and the planted receipt; the speeds are speed.test.ts's. Through `deep-show run`'s
// `export` (README: `export`, `reports`). One fresh process is shown the three speed fixtures (helpers.ts `speedFilm`)
// and exports them as drafts, the explainer, the orbit and the city, then the three again. The process's first export
// must read `start: cold`, with something compiled or decoded, and its `timing.prepare` within 5% of the seconds the
// reply's `reports` list (the compile thread's pipeline compiles and the decode worker's asset decodes). Each export
// of the second pass must read `start: warm`, `timing.prepare` 0, and report nothing. The first pass's other two are
// cold when they compiled or decoded anything, and are held to whichever they read. Both sides of the 5% are the
// product's own readings of one run, so it is judged on any machine. Planted: `receipt_books_compiles_under_draw`, on
// the orbit, in a fresh process timed from outside: prepare no longer holds the compiles; that its `wall` still
// matches the measured time is a clock reading, asserted on a quiet reference Mac. Wrong program: the merge base (no
// `start`, no `reports`, `timing` holds `open` alone).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, DRAFT, FIXTURES, FULL, SET, coldFailures, exportCall, failsNaming, loadProblem, none, present, presented, receiptOf, referenceMacProblem, reportsOf,
  runShow, scenario, speedFilm, speedRun, startOf, timingOf, useShow, useTemp, wallFailures, warmFailures, type JsonObject,
} from './helpers.ts';

const show = useShow();
const temp = useTemp();
const DOCS = [DOC.a, DOC.b, DOC.c] as const;

/** One export's start, held to what it reads: cold with its prepare, or warm with none. */
function startFailures(what: string, reply: JsonObject | undefined, must: 'cold' | 'warm' | 'either'): string[] {
  const r = receiptOf(reply, what);
  const start = startOf(r, what);
  const t = timingOf(r, what); const reports = reportsOf(reply, what);
  const as = must === 'either' ? start : must;
  return as === 'cold' ? coldFailures(what, start, t, reports) : warmFailures(what, start, t, reports);
}

describe(`${AC[5]} a cold start's prepare holds every compile and decode, and a second export of the same process starts warm`, () => {
  it(`${AC[5]} the fixture set exported twice from one fresh process: the first receipt reads start cold with its prepare within 5% of what the compile thread and decode worker report, and the second pass reads start warm with nothing under prepare`, () => {
    const evidence = temp(); const dir = temp();
    mkdirSync(join(dir, 'first')); mkdirSync(join(dir, 'second'));
    const shows = FIXTURES.map((x, i) => present(DOCS[i]!, speedFilm(evidence, x).document));
    const pass = (name: string): JsonObject[] => FIXTURES.map((x, i) => exportCall(DOCS[i]!, join(dir, name, `${x}.mp4`), DRAFT));
    const replies = runShow(show(FULL), scenario(evidence, [...shows, ...pass('first'), ...pass('second')]), 'the fixture set exported twice from one fresh process');
    FIXTURES.forEach((x, i) => presented(replies[i], `the ${x}`));
    const failures: string[] = [];
    FIXTURES.forEach((x, i) => {
      const first = replies[3 + i]; const second = replies[6 + i];
      for (const [what, reply] of [[`the ${x}'s first export`, first], [`the ${x}'s second export`, second]] as const) {
        const frames = receiptOf(reply, what).frames;
        if (frames !== SET[x].frames) failures.push(`${what}: ${frames} frames, not the ${x}'s ${SET[x].frames}`);
      }
      failures.push(...startFailures(`the ${x}'s first export${i === 0 ? ', the process\'s first' : ''}`, first, i === 0 ? 'cold' : 'either'));
      failures.push(...startFailures(`the ${x}'s second export`, second, 'warm'));
    });
    none(failures, 'the fixture set exported twice from one fresh process');
  });

  it(`${AC[5]} a planted receipt that books compiles under draw fails, naming prepare, while its wall still matches the time measured from the command to the file`, async () => {
    const what = 'the orbit\'s draft (planted receipt_books_compiles_under_draw)';
    const run = await speedRun(show(FULL), temp(), 'orbit', 'draft', 'receipt_books_compiles_under_draw');
    const r = receiptOf(run.reply, what);
    const t = timingOf(r, what);
    failsNaming(coldFailures(what, startOf(r, what), t, reportsOf(run.reply, what)), /timing\.prepare reads/, 'compiles booked under draw');
    expect(run.measured, `${what}: the file came under its name`).not.toBeNull();
    const reading = `${what}: wall ${t.wall.toFixed(3)} s in the receipt, ${run.measured!.toFixed(3)} s measured from the command to the file`;
    console.log(`${AC[5]} ${reading}`);
    // "Still matches the wall time": a clock reading, held where a clock reading counts.
    if (!((await referenceMacProblem()) ?? loadProblem([run.loads]))) none(wallFailures(what, t.wall, run.measured!), reading);
  });
});
