// #323 AC12, AC13, AC14: review threads on the claim's PR (design: Done means switched on, "Review notes on the PR …
// become open items"; Open items as records, "It closes only when qualifying evidence arrives, or by your answer or a
// rule … no agent can withdraw it"; Questions at the stop, "a call whose effect … is a push, a merge, a dispatch, a send
// or a delete … is held with an authority ask naming it"; the github row of the first-party extensions).
//
// GitHub's answers are recorded (DEEP_HUB_TEST_GITHUB, README): the PR the session opens with `gh pr create`, whose
// output names it, and its review threads over GraphQL with `isResolved` and `resolvedBy`. The account `gh` is
// signed in as, `/user`, is you-gh: the session's own account. Each scenario has its own world and hub, so a planted
// hub replays it from the start.
import { afterAll, describe, it } from 'vitest';
import {
  AC12, AC13, AC14, FIX, FLAG, asksRaised, begin, cleanup, decision, draft, failureOf, isOpen, itemsOf, judgedAfter, lastPos, listed, makeWorld, must,
  once, recordAnswers, replyText, settle, shown, startHub, strings, taskVerdicts, type Ev, type Ran,
} from './helpers.ts';
import { PR_URL, REVIEWER, YOU_GH, prAnswers, type Thread } from './github.ts';

afterAll(cleanup, 60_000);

const thread = (id: string, path: string, line: number, comment: number, body: string, resolvedBy: string | null = null): Thread => ({ id, path, line, comment: { id: comment, author: REVIEWER, body }, resolvedBy });
/** The open items of a task that name a review thread: by its node ID or its first comment's link. */
const itemsForThread = (events: readonly Ev[], ref: string, t: Thread, since = 0): Ev[] => itemsOf(events, ref, since).filter((e) => strings(e.data).some((s) => s.includes(t.id) || s.includes(`discussion_r${t.comment.id}`)));
const PR_BODY = 'Rejects expired tokens at the middleware.';

// ---- AC12: two unresolved threads on PR 21.
const PROMPT_12 = 'make the auth middleware reject expired tokens';
const T1 = thread('PRRT_kwDOAcme0021a', 'src/auth.js', 2, 9001, 'A token whose exp is exactly now still passes; compare with >= here.');
const T2 = thread('PRRT_kwDOAcme0021b', 'tests/unit.test.js', 5, 9002, 'Please add a test for a token with no exp claim.');

async function twoThreads(plant?: string): Promise<void> {
  const w = await makeWorld({ drafts: [draft(PROMPT_12)], answers: prAnswers([{ n: 21, body: PR_BODY, threads: [T1, T2] }]) });
  const hub = await startHub(w, plant);
  const { s, ref } = await begin(w, hub, w.repos.repo!, PROMPT_12, AC12);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  await s.bash(`gh pr create --title "Reject expired tokens" --body "${PR_BODY}"`, { stdout: `${PR_URL(21)}\n` });
  const since = await lastPos(hub);
  const stop = await s.stop('Expired tokens are rejected now, and PR 21 is open for review.');
  await judgedAfter(hub, ref, since);
  const events = await settle(hub, () => false, 3000);
  for (const t of [T1, T2]) {
    const items = itemsForThread(events, ref, t);
    must(items.length === 1 || new Set(items.map((i) => String(i.data.item ?? i.data.id ?? i.id))).size === 1, `${AC12} the unresolved review thread ${t.id} on PR 21 must become one open item of ${ref}, naming the thread: ${items.length} name it; the task's open items are ${listed(itemsOf(events, ref))}`);
    must(strings(items[0]!.data).some((x) => x.includes(t.comment.body)), `${AC12} the open item for ${t.id} quotes its first comment, "${t.comment.body}": ${listed(items)}`);
  }
  const v = taskVerdicts(events, ref, since).at(-1);
  must(v?.data.outcome !== 'PASS' && !/^\s*PASS\b/.test(replyText(stop)), `${AC12} the claim can't pass while ${T1.id} and ${T2.id} are open: verdict ${JSON.stringify(v?.data.outcome)}, the stop's reply ${JSON.stringify(replyText(stop).slice(0, 300))}`);
}

describe(`${AC12} each unresolved review thread on the claim's PR is an open item, and the claim can't pass while one is open`, () => {
  it(`${AC12} PR 21 has two unresolved threads: the stop's claim gets one open item for each, naming the thread and quoting its first comment, and doesn't pass`, async () => {
    await twoThreads();
  }, 600_000);

  it(`${AC12} (wrong program) a gate that reads only the PR body (DEEP_HUB_PLANT=pr-body-only) misses both threads and fails this test, naming ${T1.id}`, async () => {
    const failure = await failureOf(() => twoThreads('pr-body-only'));
    must(failure !== null, `${AC12} the planted gate must fail this test: it passed`);
    must(failure.includes(T1.id), `${AC12} the failure names the thread the gate missed, ${T1.id}; it said: ${failure}`);
  }, 600_000);
});

// ---- AC13 and AC14: PR 23, two threads; the session resolves one with its own account, the reviewer the other.
const PROMPT_13 = 'make the auth middleware refuse expired tokens';
const T3 = thread('PRRT_kwDOAcme0023a', 'src/auth.js', 2, 9101, 'Reject a token whose exp claim is missing, too.');
const T4 = thread('PRRT_kwDOAcme0023b', 'src/auth.js', 3, 9102, 'Name the reason for the 401 in the response.');
const REPLY = `gh api --method POST repos/acme/shop/pulls/23/comments/${T3.comment.id}/replies -f body='Fixed: a token with no exp claim is rejected now.'`;
const RESOLVE = `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "${T3.id}"}) { thread { isResolved } } }'`;

interface Played { ref: string; session: string; first: Ev[]; second: Ev[]; since2: number; replies?: { before: number; tries: { allowed: boolean; before: Ran }[]; events: Ev[] } }
async function resolvedThreads(plant?: string, tryReply = false): Promise<Played> {
  const w = await makeWorld({ drafts: [draft(PROMPT_13)], answers: prAnswers([{ n: 23, body: PR_BODY, threads: [T3, T4] }]) });
  const hub = await startHub(w, plant);
  const { s, ref } = await begin(w, hub, w.repos.repo!, PROMPT_13, AC13);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  await s.bash(`gh pr create --title "Refuse expired tokens" --body "${PR_BODY}"`, { stdout: `${PR_URL(23)}\n` });
  let replies: Played['replies'];
  if (tryReply) {
    // AC14: the agent replies to T3 under your account, then tries the same reply again.
    const before = await lastPos(hub);
    const tries = [await s.bash(REPLY, { stdout: '{"id": 9201}' }), await s.bash(REPLY, { stdout: '{"id": 9202}' })];
    replies = { before, tries, events: await settle(hub, () => false, 3000) };
  }
  const since1 = await lastPos(hub);
  await s.stop('I flagged expired tokens; PR 23 is open for review.');
  await judgedAfter(hub, ref, since1);
  const first = await settle(hub, () => false, 3000);
  // The session resolves T3 through gh with your account; the reviewer resolves T4.
  await s.bash(RESOLVE, { stdout: '{"data":{"resolveReviewThread":{"thread":{"isResolved":true}}}}' });
  recordAnswers(w, prAnswers([{ n: 23, body: PR_BODY, threads: [{ ...T3, resolvedBy: YOU_GH }, { ...T4, resolvedBy: REVIEWER }] }]));
  await s.edit(FIX.file, FIX.from, FIX.to);
  const since2 = await lastPos(hub);
  await s.stop('Expired tokens are refused now, and both review threads are resolved.');
  await judgedAfter(hub, ref, since2);
  const second = await settle(hub, () => false, 3000);
  return { ref, session: s.id, first, second, since2, ...(replies ? { replies } : {}) };
}
function judge13(p: Played): void {
  const [t3] = itemsForThread(p.first, p.ref, T3);
  const [t4] = itemsForThread(p.first, p.ref, T4);
  must(t3 !== undefined && t4 !== undefined, `${AC13} at the first stop both threads are unresolved, so each is an open item of ${p.ref}: ${T3.id} ${t3 ? 'has one' : 'has none'}, ${T4.id} ${t4 ? 'has one' : 'has none'}; the task's open items are ${listed(itemsOf(p.first, p.ref))}`);
  must(isOpen(p.second, t3!), `${AC13} ${T3.id} was resolved by ${YOU_GH}, the session's own account, through gh: that is the agent's word, so its open item stays open: ${listed(p.second.filter((e) => e.kind === 'open_item.closed' && e.data.task_ref === p.ref))}`);
  const naming = p.second.filter((e) => e.log_pos > p.since2 && strings(e.data).some((x) => x.includes(T3.id)) && strings(e.data).some((x) => x.includes(YOU_GH) || x.includes(p.session)));
  must(naming.length > 0, `${AC13} the open item for ${T3.id} names the session as the one that resolved it (${YOU_GH}, or the session ${p.session}): nothing after the second stop does; the task's open items are ${listed(itemsOf(p.second, p.ref, p.since2))}`);
  must(!isOpen(p.second, t4!), `${AC13} ${T4.id} was resolved by the reviewer, ${REVIEWER}, so its open item closes: it is still open`);
}

const played13 = once(() => resolvedThreads(undefined, true));
describe(`${AC13} a thread the session resolves stays open, naming the session; one a reviewer resolves closes`, () => {
  it(`${AC13} ${T3.id}, resolved by the session's account ${YOU_GH}, keeps its open item open naming the session; ${T4.id}, resolved by ${REVIEWER}, closes its item`, async () => {
    judge13(await played13());
  }, 600_000);

  it(`${AC13} (wrong program) a gate that counts every resolved thread as closed (DEEP_HUB_PLANT=resolved-counts-closed) fails this test, naming ${T3.id}`, async () => {
    const failure = await failureOf(async () => judge13(await resolvedThreads('resolved-counts-closed')));
    must(failure !== null, `${AC13} the planted gate must fail this test: it passed`);
    must(failure.includes(T3.id), `${AC13} the failure names the thread the session resolved, ${T3.id}; it said: ${failure}`);
  }, 600_000);
});

describe(`${AC14} a reply the session tries to post under your name to a review thread is held as one ask`, () => {
  it(`${AC14} the session's \`gh api … /comments/${T3.comment.id}/replies\`, tried twice, is held at PreToolUse both times, before anything is posted, as one ask`, async () => {
    const { replies } = await played13();
    must(replies !== undefined, `BLOCKED: ${AC14} the scenario didn't try the reply`);
    replies!.tries.forEach((t, i) => must(!t.allowed, `${AC14} try ${i + 1} of the reply to ${T3.id} is a send in your name, so it is held before it runs; deep-hook allowed it: ${shown(t.before)}`));
    const asks = asksRaised(replies!.events, replies!.before).filter((e) => strings(e.data).some((x) => x.includes(`${T3.comment.id}`) || x.includes('replies') || x.includes('no exp claim is rejected now')));
    must(asks.length === 1, `${AC14} the held reply is one ask for you, however many times the agent tries it: ${asks.length} asks name it: ${listed(asks)}; denial: ${replyText(replies!.tries[0]!.before).slice(0, 300)}; decision ${decision(replies!.tries[0]!.before)}`);
  }, 600_000);
});
