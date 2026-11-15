// #1633: a review thread a reviewer resolved, then unresolved, opens its item again; an item your answer closed stays
// closed (design: How runs become one of five verdicts, "Open items as records": an item "closes only when qualifying
// evidence arrives, or by your answer or a rule", the same item raised twice is one record, and it reaches you only
// through an ask; "Known failures are waivers"; What done means, "Done means switched on": review notes on the PR keep
// it from Closes until each is fixed or you accept it).
//
// The real hub with deep-hook, as #87's gate suite drives it (#322's world and helpers, #323's open-item readers and
// recorded GitHub answers, all reused, none edited): a session starts from issue 7 of the test work source, makes R1
// and the spec's unit check pass, and opens PR 21 as "Part of #7". PR 21 carries one review thread T by maya, the
// reviewer. Three claims (stops) follow, GitHub's recorded answers changed between them: claim 1 sees T unresolved,
// claim 2 sees it resolved by maya, claim 3 sees it unresolved again. After claim 3 the agent tries
// `gh pr edit 21 --body "Closes #7"`, which is how "the PR can't say Closes" is seen.
import { afterAll, describe, it } from 'vitest';
import {
  FIX, FLAG, answer, cleanup, itemTask, lastPos, listed, lockedFor, makeWorld, must, recordAnswers, replyText, req, Session, settle, shown, startHub,
  taskVerdicts, trustRepo, type Answer, type Ev, type Ran,
} from '../322/helpers.ts';
import { CRITERIA, WORK_LINK, workDraft, workIssue } from '../322/work.ts';
import { closingsOf, failureOf, itemId, itemsOf, isOpen, strings, testCheck } from '../323/helpers.ts';
import { PR_URL, REVIEWER, prAnswers, type Thread } from '../323/github.ts';

afterAll(cleanup, 60_000);

// ---- The criteria: `#1633.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`.
const AC1 = 'AC1 #1633.4b7df9d5';
const AC2 = 'AC2 #1633.216b72d6';
const AC3 = 'AC3 #1633.54f387d7';
/** The plant criterion 3 names: a hub that reopens any item raised again, whatever closed it. The implementer adds it. */
const PLANT = 'reopens-every-item';

/** R1's drafted check: a node:test file the hermetic runner counts, passing once FLAG is made. */
const EXPIRED = testCheck('expired-token', 'an expired token is rejected with 401', "assert.ok(require('../../src/auth.js').rejectsExpired, 'an expired token is not rejected with 401');");
/** Issue 7 with one criterion, R1, on its line 3 (#87's gate suite). */
const ISSUE = { ...workIssue(7), body: `The auth middleware still accepts expired tokens.\n\n- ${CRITERIA[0]}`, criteria: [CRITERIA[0]] };
const DRAFT = workDraft(7, { requirements: [req('R1', CRITERIA[0], { source_line: 'item-7#L3', check: EXPIRED.check, asserts: EXPIRED.asserts })] });
/** T: maya's review thread on PR 21. */
const T: Thread = { id: 'PRRT_kwDOAcme1633a', path: 'src/auth.js', line: 3, comment: { id: 16331, author: REVIEWER, body: 'Name the reason a token was rejected in the 401 body.' }, resolvedBy: null };
/** The PR's body lists R1 under its Part of line, as the hub asks of a PR whose requirement isn't proven yet when it opens (#82). */
const PR_BODY = 'Part of #7, R1 to prove';
const answers = (t: Thread): Answer[] => prAnswers([{ n: 21, body: PR_BODY, threads: [t] }]) as unknown as Answer[];
const CLOSES = 'gh pr edit 21 --body "Closes #7"';
/** Criterion 3's final-message item: an item of the "Not verified" section, which reaches you through an ask that waives it. */
const UNVERIFIED = 'The refresh flow with an expired token in Safari';
const WORDS = (n: number, unverified: boolean) => `Claim ${n}: expired tokens are rejected, and PR 21 is open for review as Part of #7.${unverified ? `\n\nNot verified:\n- ${UNVERIFIED}` : ''}`;

const namesT = (texts: readonly string[]): boolean => texts.some((x) => x.includes(T.id) || x.includes(`discussion_r${T.comment.id}`) || x.includes(T.comment.body));
const namesU = (texts: readonly string[]): boolean => texts.some((x) => x.includes('Safari'));
const itemsFor = (events: readonly Ev[], ref: string, names: (t: readonly string[]) => boolean, since = 0): Ev[] => itemsOf(events, ref, since).filter((e) => names(strings(e.data)));
const asksFor = (events: readonly Ev[], names: (t: readonly string[]) => boolean, since = 0): Ev[] => events.filter((e) => e.kind === 'ask.created' && e.log_pos > since && names(strings(e.data)));
/** The events that end an ask: your answer, or the ask cancelled, moot, superseded or defaulted. */
const ENDS = new Set(['ask.answered', 'ask.cancelled', 'ask.moot', 'ask.superseded', 'ask.defaulted']);
const endsOf = (events: readonly Ev[], ask: Ev): Ev[] => events.filter((e) => ENDS.has(e.kind) && e.subject === `ask:${ask.id}`);
const option = (ask: Ev, pattern: RegExp): string | undefined => ((ask.data.options ?? []) as { id?: unknown; label?: unknown }[]).find((o) => pattern.test(`${String(o.id)} ${String(o.label ?? '')}`))?.id as string | undefined;
const once = <V>(make: () => Promise<V>): (() => Promise<V>) => { let p: Promise<V> | undefined; return () => (p ??= make()); };

interface Played {
  ref: string;
  /** T's item as claim 1 opened it. */
  item: Ev | undefined;
  since1: number; since2: number; since3: number;
  /** The record after claim 1, after your answer (when given), after claim 2, and after claim 3. */
  at1: Ev[]; at2: Ev[]; at3: Ev[];
  /** The log position of your answer to T's accept ask (AC2), or to the unverified item's waive ask (AC3). */
  answeredAt: number | undefined;
  /** The unverified item as claim 1 opened it (AC3). */
  unverified: Ev | undefined;
  closes: { allowed: boolean; before: Ran };
}

/** The three claims. `accept`: you accept T's note through its ask after claim 1. `waive`: each final message leaves UNVERIFIED, which you waive after claim 1. */
async function play(o: { accept?: boolean; waive?: boolean; plant?: string } = {}): Promise<Played> {
  const who = o.waive ? AC3 : o.accept ? AC2 : AC1;
  const w = makeWorld({ drafts: [DRAFT], readings: [ISSUE], answers: answers(T), files: EXPIRED.files });
  await trustRepo(w, true);
  const hub = await startHub(w, { holdMs: 20_000, plant: o.plant });
  const s = new Session(w);
  await s.start();
  // The prompt names the pull request, so the PR default (#84's pr-needs-ask) lets `gh pr create` through.
  await s.typed(`Fix ${WORK_LINK(7)} and open a pull request`);
  await s.read('src/auth.js');
  let events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
  const ref = itemTask(events, s);
  must(ref !== undefined && lockedFor(events, ref).length > 0, `BLOCKED: ${who} the session started from ${WORK_LINK(7)} must open one task with its handed definition locked: ${ref ?? 'no task'}`);

  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const opened = await s.call('Bash', { command: `gh pr create --title "Reject expired tokens" --body "${PR_BODY}"`, description: 'Open the pull request' }, { response: { stdout: `${PR_URL(21)}\n`, stderr: '', interrupted: false, isImage: false } });
  must(opened.allowed, `BLOCKED: ${who} gh pr create saying Part of #7 must be allowed: ${shown(opened.before)}`);

  // Claim 1: T unresolved.
  const since1 = await lastPos(hub);
  await s.stop(WORDS(1, !!o.waive));
  events = await settle(hub, (all) => taskVerdicts(all, ref, since1).length > 0 && itemsFor(all, ref, namesT, since1).length > 0 && asksFor(all, namesT, since1).length > 0
    && (!o.waive || asksFor(all, namesU, since1).length > 0), 120_000);
  const at1 = await settle(hub, () => false, 2000);
  const item = itemsFor(at1, ref, namesT, since1)[0];
  const unverified = itemsFor(at1, ref, namesU, since1)[0];

  // Your answer, between claim 1 and claim 2.
  let answeredAt: number | undefined;
  if (o.accept || o.waive) {
    const names = o.accept ? namesT : namesU;
    const target = o.accept ? item : unverified;
    const what = o.accept ? `T's review note (${T.id})` : `the "Not verified" item "${UNVERIFIED}"`;
    must(target !== undefined, `${who} claim 1 must open an item for ${what}: the task's open items are ${listed(itemsOf(at1, ref))}`);
    const ask = asksFor(at1, names, since1)[0];
    must(ask !== undefined, `${who} ${what} reaches you through an ask: no ask names it; the asks are ${listed(at1.filter((e) => e.kind === 'ask.created' && e.log_pos > since1))}`);
    const chosen = option(ask, o.accept ? /accept/i : /waive|won.?t[ -]?fix|out[ -]of[ -]scope/i);
    must(chosen !== undefined, `${who} the ask for ${what} offers to ${o.accept ? 'accept it' : 'waive it'}: its options are ${JSON.stringify(ask.data.options)}`);
    const r = await answer(w, ask, chosen);
    must(r.code === 0, `${who} your answer through deep inbox answer must count, exit 0: ${shown(r)}`);
    events = await settle(hub, (all) => !isOpen(all, target), 60_000);
    must(!isOpen(events, target), `${who} your answer closes ${what}: it is still open (${listed(itemsOf(events, ref))})`);
    answeredAt = await lastPos(hub);
  }

  // Claim 2: maya resolved T.
  await s.edit(FLAG.file, 'rejectsExpired: true,', "rejectsExpired: true,\n  reason: 'token expired',");
  recordAnswers(w, answers({ ...T, resolvedBy: REVIEWER }));
  const since2 = await lastPos(hub);
  await s.stop(WORDS(2, !!o.waive));
  await settle(hub, (all) => taskVerdicts(all, ref, since2).length > 0 && (item === undefined || !isOpen(all, item)), 120_000);
  const at2 = await settle(hub, () => false, 2000);

  // Claim 3: T unresolved again.
  await s.edit(FLAG.file, "reason: 'token expired',", "reason: 'token expired',\n  status: 401,");
  recordAnswers(w, answers(T));
  const since3 = await lastPos(hub);
  await s.stop(WORDS(3, !!o.waive));
  await settle(hub, (all) => taskVerdicts(all, ref, since3).length > 0 && (item === undefined || isOpen(all, item)), 60_000);
  const at3 = await settle(hub, () => false, 4000);
  const closes = await s.bash(CLOSES);
  return { ref, item, since1, since2, since3, at1, at2, at3, answeredAt, unverified, closes };
}

/** Claim 1 opened T's item, and maya's resolution closed it at claim 2: the precondition every criterion shares. */
function sequence(p: Played, who: string): Ev {
  must(p.item !== undefined, `${who} claim 1 sees ${T.id} unresolved, so it opens an item of ${p.ref} naming the thread: the task's open items are ${listed(itemsOf(p.at1, p.ref))}`);
  must(itemId(p.item) !== undefined, `${who} T's item carries its ID (\`item\`): ${JSON.stringify(p.item.data)}`);
  must(!isOpen(p.at2, p.item), `${who} claim 2 sees ${T.id} resolved by ${REVIEWER}, the reviewer, so its item is closed after claim 2: it is still open (${listed(itemsFor(p.at2, p.ref, namesT))})`);
  return p.item;
}

function judge1(p: Played): void {
  const item = sequence(p, AC1);
  const id = itemId(item)!;
  const closing = closingsOf(p.at3, item).filter((e) => e.log_pos <= p.since3).at(-1);
  must(isOpen(p.at3, item), `${AC1} claim 3 sees ${T.id} unresolved again, so its item ${id} is open after claim 3: it stays closed, by ${JSON.stringify(closing?.data.by ?? 'no closing')} (${listed(closingsOf(p.at3, item))}); T's items after claim 3: ${listed(itemsFor(p.at3, p.ref, namesT, p.since3))}`);
  const reopened = itemsOf(p.at3, p.ref, p.since3).filter((e) => itemId(e) === id);
  must(reopened.length === 1, `${AC1} T's item opens again under the same ID, ${id}, once: ${reopened.length} openings with it after claim 3; T's items after claim 3: ${listed(itemsFor(p.at3, p.ref, namesT, p.since3))}`);
  must(closing !== undefined, `${AC1} the closing T's reopening replaces is on the record: ${listed(closingsOf(p.at3, item))}`);
  const cited = strings(reopened[0]!.data).some((x) => x.includes(closing!.id) || (typeof closing!.data.by === 'string' && x.includes(closing!.data.by)))
    || Object.values(reopened[0]!.data).some((v) => v === closing!.log_pos);
  must(cited, `${AC1} the new open_item.opened cites the closing it replaces (its ID ${closing!.id}, its log position ${closing!.log_pos} or its "${String(closing!.data.by)}"): ${JSON.stringify(reopened[0]!.data)}`);
  must(!p.closes.allowed, `${AC1} with T's note open again, \`${CLOSES}\` must be refused: deep-hook allowed it (${shown(p.closes.before)})`);
  const why = replyText(p.closes.before);
  must(namesT([why]), `${AC1} the refusal names the open review note, ${T.id} (its thread, its link or its words): ${why.slice(0, 600)}`);
  // Its accept ask: you never answered one, so one is open for T after claim 3 (claim 1's still standing, or raised again), and only one.
  const asks = asksFor(p.at3, namesT);
  const answered = asks.filter((a) => endsOf(p.at3, a).some((e) => e.kind === 'ask.answered'));
  must(answered.length === 0, `BLOCKED: ${AC1} nobody answers T's ask in this sequence: ${listed(answered)}`);
  const open = asks.filter((a) => endsOf(p.at3, a).length === 0);
  must(open.length === 1, `${AC1} T's note reopened, you never answered its ask, so exactly one accept ask for it is open after claim 3: ${open.length} are; asks naming T: ${asks.map((a) => `${a.id} ended by ${endsOf(p.at3, a).map((e) => e.kind).join(', ') || 'nothing'}`).join('; ') || 'none'}`);
}

function judge2(p: Played): void {
  const item = sequence(p, AC2);
  must(!isOpen(p.at3, item), `${AC2} you accepted T's note before claim 3, so claim 3 seeing ${T.id} unresolved again leaves its item ${itemId(item)} closed: it is open again (${listed(itemsFor(p.at3, p.ref, namesT, p.since3))})`);
  const again = asksFor(p.at3, namesT, p.answeredAt);
  must(again.length === 0, `${AC2} you answered T's ask, so no new ask is raised for it: ${listed(again)}`);
}

function judge3(p: Played): void {
  sequence(p, AC3);
  const u = p.unverified;
  must(u !== undefined, `${AC3} claim 1's "Not verified" item "${UNVERIFIED}" is an open item of ${p.ref}: its open items are ${listed(itemsOf(p.at1, p.ref))}`);
  const waiver = closingsOf(p.at3, u).filter((e) => e.log_pos <= p.answeredAt!).at(-1);
  must(waiver !== undefined, `${AC3} your waiver closed "${UNVERIFIED}": no closing of it before ${p.answeredAt}`);
  must(!isOpen(p.at3, u), `${AC3} "${UNVERIFIED}", raised again at claims 2 and 3, stays closed by your waiver: it is open again (${listed(itemsFor(p.at3, p.ref, namesU))})`);
  const later = closingsOf(p.at3, u).filter((e) => e.log_pos > waiver.log_pos);
  const reopened = itemsOf(p.at3, p.ref, waiver.log_pos).filter((e) => itemId(e) === itemId(u));
  must(reopened.length === 0 && later.length === 0, `${AC3} "${UNVERIFIED}" stays closed by your waiver, not opened again and closed by something else: openings after it ${listed(reopened)}; closings after it ${listed(later)}`);
  const again = asksFor(p.at3, namesU, p.answeredAt);
  must(again.length === 0, `${AC3} you waived "${UNVERIFIED}", so it never reaches you twice: ${listed(again)}`);
}

const reopenedThread = once(() => play({ waive: true }));

describe(`${AC1} a review thread a reviewer resolved, then unresolved, opens its item again, and the PR can't say Closes`, () => {
  it(`${AC1} claim 1 sees ${T.id} unresolved and its item opens; claim 2 sees it resolved by ${REVIEWER} and the item closes; claim 3 sees it unresolved: the item is open again under its ID, citing the closing it replaces, \`${CLOSES}\` is refused naming it, and one accept ask stands`, async () => {
    judge1(await reopenedThread());
  }, 900_000);
});

describe(`${AC2} a review note you accepted stays closed when its thread is unresolved again`, () => {
  it(`${AC2} the same sequence, with T's note accepted through its ask after claim 1: after claim 3 its item is closed and no new ask names it`, async () => {
    judge2(await play({ accept: true }));
  }, 900_000);
});

describe(`${AC3} a final-message item your waiver closed stays closed when it is raised again`, () => {
  it(`${AC3} the same sequence, each final message leaving "Not verified: ${UNVERIFIED}", waived after claim 1: after claim 3 it is closed by that waiver, and no new ask names it`, async () => {
    judge3(await reopenedThread());
  }, 900_000);

  it(`${AC3} (wrong program) a hub that reopens every item raised again, whatever closed it (DEEP_HUB_PLANT=${PLANT}), fails this test, naming "${UNVERIFIED}"`, async () => {
    const failure = await failureOf(async () => judge3(await play({ waive: true, plant: PLANT })));
    must(failure !== null, `${AC3} the planted hub must fail this test: it passed`);
    must(failure.includes(UNVERIFIED), `${AC3} the failure names the waived item the plant reopened, "${UNVERIFIED}"; it said: ${failure}`);
  }, 900_000);
});
