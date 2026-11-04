// #322 AC3: a task whose `work.item@1` reading comes from a test source that isn't GitHub gets that reading's
// acceptance criteria in its definition, as an issue read from GitHub does; a gate that reads criteria from the GitHub
// API itself (DEEP_HUB_PLANT=criteria-from-github-api) leaves the test source's out and fails this test.
//
// The test work source (DEEP_HUB_TEST_WORK) gives one reading, item-9 at work.test, with two criteria; no definition is
// handed for it (DEEP_HUB_TEST_DRAFTS), so the criteria are all the gate has. You start a session from the item (a
// link in the prompt). Its definition must lock with one requirement per criterion, each quoting its criterion in full
// (design, Who drafts it) and marked with the item's author, maya, role owner.
import { afterEach, describe, it } from 'vitest';
import { AC3, authorOf, cleanup, failureOf, itemTask, lockedFor, makeWorld, must, requirementsOf, said, Session, settle, startHub, type Ev } from './helpers.ts';
import { CRITERIA, OWNER, WORK_LINK, workIssue } from './work.ts';

afterEach(cleanup, 60_000);

async function lockedFromCriteria(plant?: string): Promise<{ lock: Ev | undefined; ref: string }> {
  const w = makeWorld({ readings: [workIssue(9)] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(`Fix ${WORK_LINK(9)}`);
  await s.read('src/auth.js');
  const events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; }, 45_000);
  const ref = itemTask(events, s);
  must(ref !== undefined, `${AC3} the session started from ${WORK_LINK(9)} must open one task under its thread, keyed by the item`);
  return { lock: lockedFor(events, ref!)[0], ref: ref! };
}

/** The definition carries each criterion of the reading, quoted in full, with the item's author. */
function carriesCriteria(t: { lock: Ev | undefined; ref: string }): void {
  must(t.lock !== undefined, `${AC3} the task ${t.ref} of the test source's item-9, whose reading carries ${CRITERIA.length} acceptance criteria, must get a locked definition from them: no definition.locked was recorded`);
  const reqs = requirementsOf(t.lock);
  for (const criterion of CRITERIA) {
    const r = reqs.find((q) => typeof q.text === 'string' && q.text.includes(criterion));
    must(r !== undefined, `${AC3} the definition of ${t.ref} must hold a requirement quoting the test source's criterion "${criterion}" in full: ${said(t.lock)}`);
    must(authorOf(r) === JSON.stringify(OWNER), `${AC3} the requirement for "${criterion}" keeps the item's author, maya, with the role the test source's reading gives, owner: ${JSON.stringify(r)}`);
  }
}

describe(`${AC3} a test source's acceptance criteria reach the definition`, () => {
  it(`${AC3} the test source's item-9 criteria lock as requirements quoting each in full, authored by maya (owner)`, async () => {
    carriesCriteria(await lockedFromCriteria());
  }, 180_000);

  it(`${AC3} (wrong program) a gate that reads criteria from the GitHub API itself (DEEP_HUB_PLANT=criteria-from-github-api) leaves the test source's out and fails this test`, async () => {
    const failure = await failureOf(async () => carriesCriteria(await lockedFromCriteria('criteria-from-github-api')));
    must(failure !== null, `${AC3} the planted gate must fail this test: it passed`);
    must(CRITERIA.some((c) => failure.includes(c)) || failure.includes('definition'), `${AC3} the failure names a criterion the planted gate left out, or the missing definition; it said: ${failure}`);
  }, 180_000);
});
