// AC3: a definition of done naming a document check, with a fixture document that breaks it, is not PASS through the
// real hub (issue Scope: "A work check runs when a claim's definition of done names one, as #68 states"; #68: "A
// document with one number that doesn't match its source fails, naming the number and the source").
//
// A repo with no spec of its own. The task's definition (handed as the drafting job's, DEEP_HUB_TEST_DRAFTS) has one
// requirement, R1, whose drafted check `.deepbuild/checks/q3-report.json` is a document check: check@1's fields with
// the document kind's own (`document: report.md`). The source `sources/q3.json` says west revenue was 1240; the
// session writes report.md saying 1,250 (fixtures/q3-sales.md) and stops. The claim is never PASS, and, as #68
// states, what it is judged on names the number: the verdict (or the reply the session gets) says 1,250. That last
// part is what tells the document check's run from any other failure, such as the base running the JSON file as a
// shell script.
import { afterAll, describe, it } from 'vitest';
import {
  AC3, FIXTURE, HOUR, addToBase, cleanup, claimAfter, judged, lastPos, must, openTask, outcomeOf, reportWindow, reviewWorld, sayVerdicts, startHub, taskVerdicts,
  told, trustRepo,
} from './helpers.ts';
import { req, type Draft } from '../322/helpers.ts';

afterAll(cleanup, 60_000);

const ASK = 'write the third-quarter sales report from sources/q3.json';
const CHECK = '.deepbuild/checks/q3-report.json';
const DRAFT: Draft = {
  ask: ASK,
  requirements: [req('R1', 'Every figure in the report matches its cited source', { check: CHECK, asserts: [], depth: 'unit', oracle: 'code', refuted_by: 'a figure in report.md that differs from its cited source' })],
  deliverables: ['report.md'],
  budget: null,
};
const WRONG = /1,250|\b1250\b/;

describe(`${AC3} a definition naming a document check, with a document that breaks it, is not PASS`, () => {
  it(`${AC3} R1's document check over report.md, which says 1,250 where sources/q3.json says 1240, keeps the claim from PASS and names 1,250`, async () => {
    let w = reviewWorld({ drafts: [DRAFT], spec: null });
    w = addToBase(w, { [CHECK]: FIXTURE('q3-report.check.json'), 'sources/q3.json': FIXTURE('q3.json') });
    await trustRepo(w, true);
    const hub = await startHub(w);
    await reportWindow(hub, 5, Date.now() + 3 * HOUR);
    const { s, ref } = await openTask(hub, w, ASK, AC3);
    await s.read('sources/q3.json');
    const since = await lastPos(hub);
    const wrote = await s.writeCall('report.md', FIXTURE('q3-sales.md'));
    must(wrote.allowed, `BLOCKED: ${AC3} the Write of report.md must be allowed: ${told(wrote.before).slice(0, 400)}`);
    const stop = await s.stop('The third-quarter sales report is written, every figure cited to sources/q3.json.');

    const events = await judged(hub, ref, since);
    const claim = claimAfter(events, ref, since);
    must(claim !== undefined, `BLOCKED: ${AC3} the stop after writing report.md must make a claim for ${ref}: none was recorded`);
    const verdicts = taskVerdicts(events, ref, since);
    must(verdicts.length > 0, `${AC3} ${claim} must be judged: no verdict was recorded`);
    must(!verdicts.some((v) => outcomeOf(v) === 'PASS'), `${AC3} ${claim}'s definition names a document check that report.md breaks (1,250 where its source says 1240), so it is never PASS: ${sayVerdicts(verdicts)}`);
    must(WRONG.test(JSON.stringify(verdicts.at(-1)!.data)) || WRONG.test(told(stop)), `${AC3} the document check ran on ${claim}: its verdict or the stop's reply names the number 1,250 that doesn't match sources/q3.json (as #68 states). Verdicts: ${sayVerdicts(verdicts)}; the stop's reply: ${told(stop).slice(0, 400)}`);
  }, 600_000);
});
