// #1723.8ec20125: "A claim whose spec names `geometry.audit` on a deliverable document gets a run in the record whose
// outcome is the canvas core's for that revision. A planted twin with an item floating 0.2 m above the floor makes the
// run fail and the verdict FAIL, naming the item. On the merge base the spec entry has no `run` line and is dropped,
// and the test fails, naming the check."
//
// The repo's spec names one check, scene-audit: geometry.audit on doc DOC1, the floor allowed to float. A Claude Code
// session types the ask, its handed definition locks (R1: the scene saved as scene/release.json, a drafted node:test
// check), it draws the scene through its own deep mcp's deep_show, saves it and stops, which makes the claim.
//
// asserts:
//   - the control, the crate resting on the floor: the claim has a run of scene-audit, finished, outcome passed (the
//     canvas core's geometry audit of that revision raises nothing);
//   - the planted twin, the crate 0.2 m above the floor: the run of scene-audit failed, its evidence names `crate`
//     with `geometry.floating`, and the claim's verdict is FAIL and names `crate`.
// Every failure starts with the criterion's ID and names the check, scene-audit.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, AUDIT, CLEAN, DOC1, FLOATING_ITEM, Session, TEST_MS, TWIN, cleanup, drawAndStop, evidenceText, judged, judgedBy, must, namesFloating, openTask, openWorld,
  outcomeOf, prerequisites, runsOfCheck, sayRuns, sayVerdicts, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** One world: the spec naming scene-audit, the scene drawn as `document`, the claim judged. */
async function claimOn(document: Line, who: string) {
  prerequisites(who);
  const { w, hub } = await openWorld([AUDIT]);
  const s = new Session(w);
  const ref = await openTask(hub, s, who);
  const c = await drawAndStop(hub, s, ref, DOC1, document, who);
  const events = await judged(hub, c.claim, AUDIT.name);
  const runs = runsOfCheck(events, c.claim, AUDIT.name);
  must(runs.length > 0, `${who} ${c.claim}: the spec's document check ${AUDIT.name} (geometry.audit on doc ${DOC1}, revision ${String(c.shown.rev)}) has no run in the record; the claim's runs: ${sayRuns(events, c.claim)}; its verdicts: ${sayVerdicts(judgedBy(events, c.claim))}`);
  const run = runs.at(-1)!;
  must(run.finished !== undefined, `${who} ${c.claim}: the run ${run.run} of ${AUDIT.name} never finished`);
  return { w, hub, c, events, run, outcome: String(run.finished.data.outcome) };
}

describe(`${AC1} a claim whose spec names geometry.audit on a deliverable document gets a run whose outcome is the canvas core's for that revision`, () => {
  it(`${AC1} control: with the crate resting on the floor, the claim's run of ${AUDIT.name} on that revision passes`, async () => {
    const { c, run, outcome } = await claimOn(CLEAN, AC1);
    must(outcome === 'passed', `${AC1} ${c.claim}: the canvas core's geometry audit of the scene with the crate resting on the floor raises nothing, so the run ${run.run} of ${AUDIT.name} passes; it ${outcome}: ${JSON.stringify(run.finished!.data).slice(0, 900)}`);
  }, TEST_MS);

  it(`${AC1} the planted twin, its crate 0.2 m above the floor: the run of ${AUDIT.name} fails naming ${FLOATING_ITEM}, and the claim's verdict is FAIL naming ${FLOATING_ITEM}`, async () => {
    const { w, c, events, run, outcome } = await claimOn(TWIN, AC1);
    must(outcome === 'failed', `${AC1} ${c.claim}: in the twin the crate floats 0.2 m above the floor, so the canvas core's geometry audit fails and the run ${run.run} of ${AUDIT.name} fails; it ${outcome}: ${JSON.stringify(run.finished!.data).slice(0, 900)}`);
    const evidence = await evidenceText(w, run.finished);
    must(namesFloating(evidence), `${AC1} ${c.claim}: the run ${run.run} of ${AUDIT.name} keeps the audit's issues as evidence, naming ${FLOATING_ITEM} with geometry.floating; its evidence: ${evidence.slice(0, 1200) || 'none'}`);
    const verdicts = judgedBy(events, c.claim);
    const last = verdicts.at(-1);
    must(outcomeOf(last) === 'FAIL', `${AC1} ${c.claim}: the run of ${AUDIT.name} failed on every real run, so the claim's verdict is FAIL: ${sayVerdicts(verdicts)}`);
    must(new RegExp(`\\b${FLOATING_ITEM}\\b`).test(JSON.stringify(last!.data)), `${AC1} ${c.claim}: the FAIL from ${AUDIT.name} names the floating item ${FLOATING_ITEM}: ${sayVerdicts([last!])}`);
  }, TEST_MS);
});
