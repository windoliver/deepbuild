// AC8: review notes left on the PR before merge, by a person or a review agent, become open items of the claim, and
// the PR says "Closes" only after each is fixed or you accept it (design: Done means switched on, "Review notes on the
// PR … become open items"; At the claim, "Closes" or "Part of"; Open items as records: an item closes on evidence,
// your answer or a rule, never the agent's word).
//
// The real hub with deep-hook, as #322's and #323's suites start them (their helpers, reused): the session starts from
// issue 7 of the test work source, whose one criterion R1 its drafted check judges, and makes R1 and the spec's unit
// check pass. It opens PR 21 saying "Part of #7". GitHub's answers are recorded: PR 21 carries two unresolved review
// threads, one by maya, a person, and one by the Codex review agent. Then the agent tries to make the PR say Closes,
// with `gh pr edit 21 --body "Closes #7"`, three times: with both notes open it is refused, naming both; after maya
// resolves hers once the agent fixed it (a reviewer's resolution, the evidence #323 closes a thread's item on), it is
// still refused, naming the agent's note only; after your answer accepts that note through its ask, it is allowed.
// The base already makes each thread an open item (#323), and lets the first `gh pr edit` through.
import { afterAll, describe, it } from 'vitest';
import {
  FIX, FLAG, answer, asksRaised, cleanup, decision, itemTask, lastPos, listed, lockedFor, makeWorld, must, recordAnswers, replyText, req, Session, settle, shown, startHub,
  taskVerdicts, trustRepo, type Answer, type Ev,
} from '../../322/helpers.ts';
import { CRITERIA, WORK_LINK, workDraft, workIssue } from '../../322/work.ts';
import { isOpen, itemsOf, strings, testCheck } from '../../323/helpers.ts';
import { PR_URL, REVIEWER, prAnswers, type Thread } from '../../323/github.ts';
import { AC8 } from './helpers.ts';

afterAll(cleanup, 60_000);

/** The drafted check R1 names: a node:test file the hermetic runner counts, passing once FLAG is made. */
const EXPIRED = testCheck('expired-token', 'an expired token is rejected with 401', "assert.ok(require('../../src/auth.js').rejectsExpired, 'an expired token is not rejected with 401');");
/** Issue 7 with one criterion, R1, on its line 3. */
const ISSUE = { ...workIssue(7), body: `The auth middleware still accepts expired tokens.\n\n- ${CRITERIA[0]}`, criteria: [CRITERIA[0]] };
const DRAFT = workDraft(7, { requirements: [req('R1', CRITERIA[0], { source_line: 'item-7#L3', check: EXPIRED.check, asserts: EXPIRED.asserts })] });
/** The login GitHub gives the Codex review agent's comments. */
const CODEX = 'chatgpt-codex-connector';
const PERSON_NOTE: Thread = { id: 'PRRT_kwDOAcme0087a', path: 'src/auth.js', line: 3, comment: { id: 9871, author: REVIEWER, body: 'Say why a token was rejected: export the reason with the flag.' }, resolvedBy: null };
const AGENT_NOTE: Thread = { id: 'PRRT_kwDOAcme0087b', path: 'src/auth.js', line: 2, comment: { id: 9872, author: CODEX, body: 'P2: checkToken throws on a token with no exp claim; guard the property read.' }, resolvedBy: null };
const PR_BODY = 'Part of #7';
const answers = (threads: Thread[]): Answer[] => prAnswers([{ n: 21, body: PR_BODY, threads }]) as unknown as Answer[];
const CLOSES = 'gh pr edit 21 --body "Closes #7"';

const names = (texts: readonly string[], t: Thread): boolean => texts.some((x) => x.includes(t.id) || x.includes(`discussion_r${t.comment.id}`) || x.includes(t.comment.body));
const itemFor = (events: readonly Ev[], ref: string, t: Thread): Ev | undefined => itemsOf(events, ref).find((e) => names(strings(e.data), t));
const sayItems = (events: readonly Ev[], ref: string): string => listed(itemsOf(events, ref));

describe(`${AC8} review notes on the PR are open items, and the PR says Closes only once each is fixed or you accept it`, () => {
  it(`${AC8} maya's note and the Codex review agent's note on PR 21 become open items; gh pr edit to "Closes #7" is refused naming both, then naming only the agent's once maya's is fixed, and allowed once you accept the agent's`, async () => {
    const w = makeWorld({ drafts: [DRAFT], readings: [ISSUE], answers: answers([PERSON_NOTE, AGENT_NOTE]), files: EXPIRED.files });
    await trustRepo(w, true);
    const hub = await startHub(w, { holdMs: 20_000 });
    const s = new Session(w);
    await s.start();
    await s.typed(`Fix ${WORK_LINK(7)}`);
    await s.read('src/auth.js');
    let events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
    const ref = itemTask(events, s);
    must(ref !== undefined && lockedFor(events, ref).length > 0, `BLOCKED: ${AC8} the session started from ${WORK_LINK(7)} must open one task with its handed definition locked: ${ref ?? 'no task'}`);

    // The work: R1's check and the spec's unit check pass; the PR is opened as Part of #7.
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    const opened = await s.call('Bash', { command: `gh pr create --title "Reject expired tokens" --body "${PR_BODY}"`, description: 'Open the pull request' }, { response: { stdout: `${PR_URL(21)}\n`, stderr: '', interrupted: false, isImage: false } });
    must(opened.allowed, `BLOCKED: ${AC8} gh pr create saying Part of #7 must be allowed: ${shown(opened.before)}`);
    let since = await lastPos(hub);
    await s.stop('Expired tokens are rejected now, and PR 21 is open for review as Part of #7.');
    events = await settle(hub, (all) => taskVerdicts(all, ref, since).length > 0 && [PERSON_NOTE, AGENT_NOTE].every((t) => itemFor(all, ref, t)), 120_000);
    const v = taskVerdicts(events, ref, since).at(-1);
    const r1 = ((v?.data.requirements ?? []) as { req: string; outcome: string }[]).find((q) => /#?R1$/.test(String(q.req)));
    must(r1?.outcome === 'PASS', `BLOCKED: ${AC8} R1's check must pass on the claim, so only the review notes can keep the PR from Closes: R1 is ${JSON.stringify(r1 ?? v?.data ?? 'not judged')}`);

    // Both notes are open items of the claim.
    for (const t of [PERSON_NOTE, AGENT_NOTE]) must(itemFor(events, ref, t) !== undefined, `${AC8} the note by ${t.comment.author} on PR 21 (${t.id}) becomes an open item of ${ref}: the task's open items are ${sayItems(events, ref)}`);

    // Closes with both notes open: refused, naming each.
    const first = await s.bash(CLOSES);
    must(!first.allowed, `${AC8} with both review notes open, \`${CLOSES}\` must be refused: deep-hook allowed it (${shown(first.before)})`);
    const why1 = replyText(first.before);
    for (const t of [PERSON_NOTE, AGENT_NOTE]) must(names([why1], t), `${AC8} the refusal names each open review note, here ${t.id} by ${t.comment.author} (its thread, its link or its words): ${why1.slice(0, 600)}`);

    // maya's note fixed: the agent changes the line, maya resolves her thread.
    await s.edit(FLAG.file, 'rejectsExpired: true,', "rejectsExpired: true,\n  reason: 'token expired',");
    recordAnswers(w, answers([{ ...PERSON_NOTE, resolvedBy: REVIEWER }, AGENT_NOTE]));
    since = await lastPos(hub);
    await s.stop('The reason is exported now; maya resolved her note.');
    events = await settle(hub, (all) => { const i = itemFor(all, ref, PERSON_NOTE); return taskVerdicts(all, ref, since).length > 0 && i !== undefined && !isOpen(all, i); }, 120_000);
    const person = itemFor(events, ref, PERSON_NOTE)!;
    must(!isOpen(events, person), `${AC8} maya fixed and resolved her note, so its item closes: it is still open (${sayItems(events, ref)})`);
    const second = await s.bash(CLOSES);
    must(!second.allowed, `${AC8} the Codex review agent's note is still open, so \`${CLOSES}\` is still refused: deep-hook allowed it (${shown(second.before)})`);
    const why2 = replyText(second.before);
    must(names([why2], AGENT_NOTE), `${AC8} the refusal names the note still open, ${AGENT_NOTE.id}: ${why2.slice(0, 600)}`);
    must(!names([why2], PERSON_NOTE), `${AC8} the refusal no longer names maya's fixed note, ${PERSON_NOTE.id}: ${why2.slice(0, 600)}`);

    // You accept the agent's note through its ask.
    events = await settle(hub, (all) => asksRaised(all, 0).some((a) => names(strings(a.data), AGENT_NOTE)), 60_000);
    const ask = asksRaised(events, 0).find((a) => names(strings(a.data), AGENT_NOTE));
    must(ask !== undefined, `${AC8} the open review note ${AGENT_NOTE.id} reaches you through an ask you can accept it with: no ask names it; the asks are ${listed(asksRaised(events, 0))}`);
    const options = (ask.data.options ?? []) as { id?: unknown; label?: unknown }[];
    const accept = options.find((o) => /accept|waive|won.?t[ -]?fix|out[ -]of[ -]scope/i.test(`${String(o.id)} ${String(o.label ?? '')}`));
    must(accept !== undefined, `${AC8} the note's ask offers to accept it: its options are ${JSON.stringify(options)}`);
    const answered = await answer(w, ask, String(accept.id));
    must(answered.code === 0, `${AC8} your answer through deep inbox answer must count: ${shown(answered)}`);
    events = await settle(hub, (all) => { const i = itemFor(all, ref, AGENT_NOTE); return i !== undefined && !isOpen(all, i); }, 60_000);
    must(!isOpen(events, itemFor(events, ref, AGENT_NOTE)!), `${AC8} your answer accepts the agent's note, so its item closes: it is still open (${sayItems(events, ref)})`);

    const third = await s.bash(CLOSES);
    must(third.allowed, `${AC8} each note is fixed or accepted and R1 passed, so the PR may say Closes #7 (decision ${decision(third.before)}): ${replyText(third.before).slice(0, 600)}`);
  }, 600_000);
});
