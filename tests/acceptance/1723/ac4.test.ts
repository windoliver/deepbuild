// #1723.bfd5e63a: "`deep show --check` reads its result from the recorded runs; a presented document with no run never
// reads PASS."
//
// The world of AC1: the spec names scene-audit (geometry.audit on DOC1). Each `deep show --check` runs in the session's
// own process tree (agent -> shell -> deep show), as the agent runs it, so it acts as that session.
//
// asserts:
//   - before any claim, `deep show --check --doc DOC2` of the scene with the crate resting on the floor, a document no
//     spec names and no run covers, is presented and its `result` is not PASS;
//   - after the twin's claim (the crate 0.2 m above the floor), whose recorded run of scene-audit failed, `deep show
//     --check --claim <claim> --doc DOC1` of that same scene reads `result: FAIL`: the run's outcome, since nothing in
//     the show itself flags the floating crate (the geometry audit runs on request, not before a show).
import { afterEach, describe, it } from 'vitest';
import {
  AC4, AUDIT, CLEAN, DOC1, DOC2, Session, TEST_MS, TWIN, cleanup, drawAndStop, judged, judgedBy, must, openTask, openWorld, prerequisites, runsOfCheck, sayRuns,
  sayVerdicts,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC4} deep show --check reads its result from the recorded runs; a presented document with no run never reads PASS`, () => {
  it(`${AC4} deep show --check of a scene no run covers is presented and doesn't read PASS; with the twin's claim, whose run of ${AUDIT.name} failed, it reads FAIL`, async () => {
    prerequisites(AC4);
    const { w, hub } = await openWorld([AUDIT]);
    const s = new Session(w);
    const ref = await openTask(hub, s, AC4);

    const free = await s.showCli({ doc: DOC2, document: CLEAN, check: true });
    must(free.reply.outcome === 'presented', `BLOCKED: ${AC4} deep show --check of doc ${DOC2} must present the scene: ${JSON.stringify(free.reply).slice(0, 900)} ${free.stderr.slice(-400)}`);
    must(typeof free.reply.result === 'string' && free.reply.result !== 'PASS',
      `${AC4} deep show --check of doc ${DOC2}, presented at revision ${String(free.reply.rev)} with no run in the record, must not read PASS: its result is ${JSON.stringify(free.reply.result)} (${JSON.stringify(free.reply).slice(0, 600)})`);

    const c = await drawAndStop(hub, s, ref, DOC1, TWIN, AC4);
    const events = await judged(hub, c.claim, AUDIT.name);
    const run = runsOfCheck(events, c.claim, AUDIT.name).at(-1);
    must(run?.finished?.data.outcome === 'failed', `BLOCKED: ${AC4} ${c.claim}, the twin's claim, must have a failed run of ${AUDIT.name} in the record: its runs are ${sayRuns(events, c.claim)}; its verdicts ${sayVerdicts(judgedBy(events, c.claim))}`);
    const read = await s.showCli({ doc: DOC1, document: TWIN, check: true, claim: c.claim });
    must(read.reply.result === 'FAIL',
      `${AC4} deep show --check --claim ${c.claim} of doc ${DOC1}, the twin whose recorded run ${run.run} of ${AUDIT.name} failed, must read FAIL from that run: its result is ${JSON.stringify(read.reply.result)} (${JSON.stringify(read.reply).slice(0, 600)})`);
  }, TEST_MS);
});
