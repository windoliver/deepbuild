// #2123.68e68bf4 Every review thread of a pull request is read, past the first hundred. Given a forge fixture that
// answers a first page of 100 resolved threads with hasNextPage true and a second page with one unresolved thread,
// when the claim's open items are read, then that thread is an open item.
//
// The world is #1633's (tests/acceptance/1633, which drives #322's world with #323's open-item readers and recorded
// GitHub answers; all imported, none edited): a real hub with deep-hook, a session that starts from issue 7 of the test
// work source, makes its requirement pass, opens its pull request with `gh pr create` as "Part of #7" and stops, and
// the gate reading that claim's open items into the record. Only the forge stands in, as the recorded GitHub answers
// (DEEP_HUB_TEST_GITHUB): the pull request over REST and its review threads over GraphQL, here in two pages as
// GitHub's `reviewThreads` connection gives them. The first page holds 100 threads the reviewer resolved and says
// `hasNextPage: true` with an `endCursor`; the second, which the fixture gives only to a request that carries that
// cursor, holds the one unresolved thread.
import { afterAll, describe, expect, it } from 'vitest';
import {
  FIX, FLAG, cleanup, itemTask, lastPos, listed, lockedFor, makeWorld, req, Session, settle, startHub, taskVerdicts, trustRepo, type Answer as WorldAnswer, type Ev,
} from '../322/helpers.ts';
import { CRITERIA, WORK_LINK, workDraft, workIssue } from '../322/work.ts';
import { itemsOf, strings, testCheck, type Answer } from '../323/helpers.ts';
import { PR_URL, REVIEWER, prAnswers, type Thread } from '../323/github.ts';
import { AC } from './helpers.ts';

afterAll(cleanup, 60_000);

const EXPIRED = testCheck('expired-token', 'an expired token is rejected with 401', "assert.ok(require('../../src/auth.js').rejectsExpired, 'an expired token is not rejected with 401');");
const ISSUE = { ...workIssue(7), body: `The auth middleware still accepts expired tokens.\n\n- ${CRITERIA[0]}`, criteria: [CRITERIA[0]] };
const DRAFT = workDraft(7, { requirements: [req('R1', CRITERIA[0], { source_line: 'item-7#L3', check: EXPIRED.check, asserts: EXPIRED.asserts })] });
const PR = 31;
const PR_BODY = 'Part of #7, R1 to prove';
/** The cursor the first page ends on, as GitHub's `pageInfo.endCursor` gives one. */
const CURSOR = 'Y3Vyc29yOnYyOpHOAcme0100';
const RESOLVED: Thread[] = Array.from({ length: 100 }, (_, i) => ({
  id: `PRRT_kwDOAcme31r${String(i + 1).padStart(3, '0')}`, path: 'src/auth.js', line: 1 + (i % 3),
  comment: { id: 31_000 + i, author: REVIEWER, body: `Resolved note ${i + 1}: tidy this line.` }, resolvedBy: REVIEWER,
}));
const LAST: Thread = {
  id: 'PRRT_kwDOAcme31u101', path: 'src/auth.js', line: 2,
  comment: { id: 31_101, author: REVIEWER, body: 'A token whose exp is exactly now still passes; compare with >= here.' }, resolvedBy: null,
};

/** The recorded answers: the repo, the account and the pull request as #323 records them, and its threads in two pages. */
function pagedAnswers(): Answer[] {
  type Page = { data: { repository: { pullRequest: { reviewThreads: { totalCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } } } };
  const isThreads = (a: Answer): boolean => a.method === 'POST' && a.path === '/graphql';
  const first = prAnswers([{ n: PR, body: PR_BODY, threads: RESOLVED }]);
  const pageOne = first.find(isThreads)!;
  const one = (pageOne.body as Page).data.repository.pullRequest.reviewThreads;
  one.totalCount = RESOLVED.length + 1;
  one.pageInfo = { hasNextPage: true, endCursor: CURSOR };
  const pageTwo = prAnswers([{ n: PR, body: PR_BODY, threads: [LAST] }]).find(isThreads)!;
  (pageTwo.body as Page).data.repository.pullRequest.reviewThreads.totalCount = RESOLVED.length + 1;
  // A recorded GraphQL answer matches when each variable it records equals the request's, and the first match answers:
  // the second page, for a request whose cursor variable is the first page's endCursor, comes before the first page.
  const after = ['after', 'cursor'].map((name): Answer => ({ ...pageTwo, variables: { ...pageTwo.variables, [name]: CURSOR } }));
  return [...first.filter((a) => !isThreads(a)), ...after, pageOne];
}
/** The open items of a task that name a review thread: by its node ID or its first comment's link. */
const itemsForThread = (events: readonly Ev[], ref: string, t: Thread): Ev[] => itemsOf(events, ref).filter((e) => strings(e.data).some((s) => s.includes(t.id) || s.includes(`discussion_r${t.comment.id}`)));

describe(`${AC.threads} Every review thread of a pull request is read, past the first hundred`, () => {
  it(`${AC.threads} PR ${PR} has 100 resolved threads on its first page and one unresolved thread on its second: the stop's claim gets an open item for that thread`, async () => {
    const w = makeWorld({ drafts: [DRAFT], readings: [ISSUE], answers: pagedAnswers() as unknown as WorldAnswer[], files: EXPIRED.files });
    await trustRepo(w, true);
    const hub = await startHub(w, { holdMs: 20_000 });
    const s = new Session(w);
    await s.start();
    await s.typed(`Fix ${WORK_LINK(7)} and open a pull request`);
    await s.read('src/auth.js');
    const locked = await settle(hub, (all) => { const task = itemTask(all, s); return task !== undefined && lockedFor(all, task).length > 0; }, 300_000);
    const ref = itemTask(locked, s)!;
    expect(ref, 'the session opens one task with its definition locked').toBeDefined();
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    const opened = await s.call('Bash', { command: `gh pr create --title "Reject expired tokens" --body "${PR_BODY}"`, description: 'Open the pull request' }, { response: { stdout: `${PR_URL(PR)}\n`, stderr: '', interrupted: false, isImage: false } });
    expect(opened.allowed, 'gh pr create saying Part of #7 is allowed').toBe(true);
    const since = await lastPos(hub);
    await s.stop(`Expired tokens are rejected, and PR ${PR} is open for review as Part of #7.`);
    const judged = await settle(hub, (all) => taskVerdicts(all, ref, since).length > 0, 600_000);
    expect(taskVerdicts(judged, ref, since).length, `the stop's claim on ${ref} was judged, so its open items were read`).toBeGreaterThan(0);
    const events = await settle(hub, (all) => itemsForThread(all, ref, LAST).length > 0, 60_000);
    const items = itemsForThread(events, ref, LAST);
    expect(new Set(items.map((i) => String(i.data.item ?? i.data.id ?? i.id))).size, `the unresolved review thread ${LAST.id}, the 101st of PR ${PR}, is one open item of ${ref}; the task's open items are ${listed(itemsOf(events, ref)).slice(0, 2000)}`).toBe(1);
  }, 900_000);
});
