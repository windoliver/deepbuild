// #1723.ee7e66b6: "A patch that makes a new revision after a PASS makes that verdict stale, and `deep_run` runs the
// check again on the new revision."
//
// The world of AC1's control: the spec names scene-audit (geometry.audit on DOC1), the session draws the scene with the
// crate resting on the floor, saves it and stops, and its claim is judged PASS. Then the same session's deep_show writes
// the next revision of that document with the crate 0.2 m higher: revision 2, the planted twin, which the record holds
// as `doc.patched`. (The canvas core takes #96's patch ops only on a shared document; on the agent's own it refuses
// them, `ref_unresolved`, so the agent's change is its whole next revision: README, Disputes.) The run tells the
// revisions apart: the audit passes on revision 1 and fails on revision 2.
//
// asserts:
//   - after the patch makes the new revision, the record holds `verdict.stale` naming the PASS verdict;
//   - `deep_run {check: scene-audit}` through the session's deep mcp starts a run of scene-audit for the claim, recorded
//     in the record, and it fails, its evidence naming `crate` with `geometry.floating`: the canvas core's audit of
//     revision 2, not of revision 1, which passed.
import { afterEach, describe, it } from 'vitest';
import {
  AC2, AUDIT, CLEAN, DOC1, FLOATING_ITEM, Session, TEST_MS, TWIN, cleanup, drawAndStop, evidenceText, finishOf, judged, judgedBy, lastPos, must, namesFloating,
  openTask, openWorld, outcomeOf, prerequisites, sayVerdicts, settle, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC2} a patch that makes a new revision after a PASS makes that verdict stale, and deep_run runs the check again on the new revision`, () => {
  it(`${AC2} the agent's change raising the crate 0.2 m makes revision 2: the scene's PASS goes stale, and deep_run ${AUDIT.name} runs on revision 2 and fails naming ${FLOATING_ITEM}`, async () => {
    prerequisites(AC2);
    const { w, hub } = await openWorld([AUDIT]);
    const s = new Session(w);
    const ref = await openTask(hub, s, AC2);
    const c = await drawAndStop(hub, s, ref, DOC1, CLEAN, AC2);
    const events = await judged(hub, c.claim, AUDIT.name);
    const pass = judgedBy(events, c.claim).at(-1);
    must(outcomeOf(pass) === 'PASS', `BLOCKED: ${AC2} ${c.claim}, the scene with the crate resting on the floor, must be judged PASS first: ${sayVerdicts(judgedBy(events, c.claim))}`);
    const handle = String(pass!.data.verdict ?? `verdict:${pass!.id}`);
    const rev = Number(c.shown.rev);

    const before = await lastPos(hub);
    const patched = await s.show(DOC1, TWIN, AC2);
    const revised = await settle(hub, (all) => all.some((e) => e.kind === 'doc.patched' && e.log_pos > before && String(e.data.doc).endsWith(DOC1) && Number(e.data.rev) > rev), 60_000);
    const made = revised.find((e) => e.kind === 'doc.patched' && e.log_pos > before && String(e.data.doc).endsWith(DOC1) && Number(e.data.rev) > rev);
    must(made !== undefined, `BLOCKED: ${AC2} the change must make a new revision of ${DOC1} in the record (doc.patched after revision ${rev}): ${JSON.stringify(patched).slice(0, 600)}`);

    const bare = (v: unknown): string => String(v).replace(/^verdict:/, '');
    const names = (e: Ev): boolean => e.kind === 'verdict.stale' && e.log_pos > before && (bare(e.data.verdict) === bare(handle) || bare(e.subject) === bare(handle));
    const staled = await settle(hub, (all) => all.some(names), 60_000);
    must(staled.some(names),
      `${AC2} the patch made revision ${String(made.data.rev)} of ${DOC1} after ${handle}, the PASS on ${c.claim} judged on revision ${rev} by ${AUDIT.name}, so that verdict must go stale: the record holds no verdict.stale naming it after the patch (${staled.filter((e) => e.kind === 'verdict.stale' && e.log_pos > before).map((e) => JSON.stringify(e.data)).join('; ') || 'none at all'})`);

    const ran = await s.mcp('deep_run', { check: AUDIT.name, claim: null });
    must(!ran.isError && typeof ran.value?.run === 'string', `${AC2} deep_run ${AUDIT.name}, the spec's document check, must run it for the newest claim: ${JSON.stringify(ran.value ?? ran.reply).slice(0, 1200)}`);
    const run = String(ran.value.run);
    const all = await settle(hub, (es) => es.some((e) => e.kind === 'run.started' && e.data.run === run), 30_000);
    const started = all.find((e) => e.kind === 'run.started' && e.data.run === run);
    must(started !== undefined && String(started.data.check).includes(AUDIT.name) && started.data.claim === c.claim,
      `${AC2} deep_run's run ${run} is in the record as a run of ${AUDIT.name} for ${c.claim}, the newest claim: ${JSON.stringify(started?.data ?? 'no run.started').slice(0, 600)}`);
    const finished = await finishOf(hub, run);
    const outcome = String(finished?.data.outcome ?? ran.value.outcome);
    must(outcome === 'failed', `${AC2} deep_run's run ${run} of ${AUDIT.name} runs on revision ${String(made.data.rev)}, where the crate floats 0.2 m above the floor, so it fails as the canvas core's audit of that revision does; it ${outcome}, as the audit of revision ${rev} would: ${JSON.stringify(finished?.data ?? ran.value).slice(0, 900)}`);
    const evidence = await evidenceText(w, finished);
    must(namesFloating(evidence), `${AC2} deep_run's run ${run} of ${AUDIT.name} on revision ${String(made.data.rev)} keeps the audit's issues as evidence, naming ${FLOATING_ITEM} with geometry.floating: ${evidence.slice(0, 1200) || 'none'}`);
  }, TEST_MS);
});
