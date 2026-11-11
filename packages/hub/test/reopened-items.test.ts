// #1633's review rounds: a review note you accepted while its thread stood resolved stays closed when the thread is
// unresolved again, and a reopened note reaches you through an ask only when none was ever raised for it (design: Open
// items as records; AGENTS.md invariant 4). The real hub with deep-hook, through #322's world and #323's recorded GitHub
// answers, as tests/acceptance/1633 drives it: one review thread T on PR 21, its answers changed between three stops.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FIX, FLAG, answer, cleanup, itemTask, lastPos, listed, lockedFor, makeWorld, recordAnswers, req, Session, settle, startHub, taskVerdicts, trustRepo,
  type Answer, type Ev, type Hub, type World,
} from '../../../tests/acceptance/322/helpers.ts';
import { CRITERIA, WORK_LINK, workDraft, workIssue } from '../../../tests/acceptance/322/work.ts';
import { isOpen, itemId, itemsOf, strings, testCheck } from '../../../tests/acceptance/323/helpers.ts';
import { PR_URL, REVIEWER, YOU_GH, prAnswers, type Thread } from '../../../tests/acceptance/323/github.ts';

afterAll(cleanup, 60_000);

const EXPIRED = testCheck('expired-token', 'an expired token is rejected with 401', "assert.ok(require('../../src/auth.js').rejectsExpired, 'an expired token is not rejected with 401');");
const ISSUE = { ...workIssue(7), body: `The auth middleware still accepts expired tokens.\n\n- ${CRITERIA[0]}`, criteria: [CRITERIA[0]] };
const DRAFT = workDraft(7, { requirements: [req('R1', CRITERIA[0], { source_line: 'item-7#L3', check: EXPIRED.check, asserts: EXPIRED.asserts })] });
const T: Thread = { id: 'PRRT_kwDOAcme1633r', path: 'src/auth.js', line: 3, comment: { id: 16339, author: REVIEWER, body: 'Name the reason a token was rejected in the 401 body.' }, resolvedBy: null };
const PR_BODY = 'Part of #7, R1 to prove';
const answers = (resolvedBy: string | null): Answer[] => prAnswers([{ n: 21, body: PR_BODY, threads: [{ ...T, resolvedBy }] }]) as unknown as Answer[];
const namesT = (e: Ev): boolean => strings(e.data).some((x) => x.includes(T.id));
const asksForT = (events: readonly Ev[], since = 0): Ev[] => events.filter((e) => e.kind === 'ask.created' && e.log_pos > since && namesT(e));

/**
 * Opens PR 21, then makes one stop per entry of `resolved` (who resolved T at it, null: unresolved), calling `between`
 * after each. `deadline`: the exception asks' deadline in your settings, in place of the world's.
 */
async function play(resolved: (string | null)[], between?: (n: number, events: Ev[], w: World, hub: Hub) => Promise<void>, deadline?: string): Promise<{ ref: string; hub: Hub; stops: { since: number; events: Ev[] }[] }> {
  const w = makeWorld({ drafts: [DRAFT], readings: [ISSUE], answers: answers(resolved[0]!), files: EXPIRED.files });
  if (deadline) {
    const config = JSON.parse(readFileSync(join(w.root, 'config.json'), 'utf8')) as { asks: { deadline: Record<string, string> } };
    config.asks.deadline.exception = deadline;
    writeFileSync(join(w.root, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  await trustRepo(w, true);
  const hub = await startHub(w, { holdMs: 20_000 });
  const s = new Session(w);
  await s.start();
  await s.typed(`Fix ${WORK_LINK(7)} and open a pull request`);
  await s.read('src/auth.js');
  const locked = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
  const ref = itemTask(locked, s)!;
  expect(ref, 'the session opens one task with its definition locked').toBeDefined();
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const opened = await s.call('Bash', { command: `gh pr create --title "Reject expired tokens" --body "${PR_BODY}"`, description: 'Open the pull request' }, { response: { stdout: `${PR_URL(21)}\n`, stderr: '', interrupted: false, isImage: false } });
  expect(opened.allowed, 'gh pr create saying Part of #7 is allowed').toBe(true);
  const stops: { since: number; events: Ev[] }[] = [];
  for (const [n, by] of resolved.entries()) {
    if (n > 0) {
      await s.edit(FLAG.file, 'rejectsExpired: true,', `rejectsExpired: true,\n  // stop ${n + 1}`);
      recordAnswers(w, answers(by));
    }
    const since = await lastPos(hub);
    await s.stop(`Claim ${n + 1}: expired tokens are rejected, and PR 21 is open for review as Part of #7.`);
    await settle(hub, (all) => taskVerdicts(all, ref, since).length > 0, 120_000);
    const events = await settle(hub, () => false, 3000);
    stops.push({ since, events });
    await between?.(n, events, w, hub);
  }
  return { ref, hub, stops };
}

describe('#1633 review rounds: a reopened review note and its ask', () => {
  it('a note you accepted after a reviewer resolved its thread stays closed when the thread is unresolved again, and no ask is raised for it again', async () => {
    let accepted = 0;
    const { ref, stops } = await play([null, REVIEWER, null], async (n, events, w, hub) => {
      if (n !== 1) return;
      // T's item is closed by maya's resolution; its accept ask from the first stop still stands, and you accept it now.
      const [ask] = asksForT(events);
      expect(ask, `the first stop raised an accept ask for ${T.id}`).toBeDefined();
      const r = await answer(w, ask!, 'accept');
      expect(r.code, 'deep inbox answer … accept counts').toBe(0);
      await settle(hub, (all) => all.some((e) => e.kind === 'ask.answered' && e.subject === `ask:${ask!.id}`), 60_000);
      accepted = await lastPos(hub);
    });
    const last = stops.at(-1)!.events;
    const item = itemsOf(last, ref).find(namesT)!;
    expect(isOpen(last, item), `you accepted ${T.id}'s note, so the third stop leaves its item ${itemId(item)} closed: ${listed(itemsOf(last, ref).filter(namesT))}`).toBe(false);
    expect(asksForT(last, accepted), 'no new ask names T after your answer').toEqual([]);
  }, 900_000);

  it('a note first seen resolved by the session\'s own account, then closed by a reviewer, reaches you through one accept ask when it opens again', async () => {
    const { ref, stops } = await play([YOU_GH, REVIEWER, null]);
    const [first, second, third] = stops;
    const item = itemsOf(first!.events, ref).find(namesT)!;
    expect(item, `the first stop opens ${T.id}'s item, naming who resolved it`).toBeDefined();
    expect(asksForT(first!.events), 'the agent\'s own resolution raises no accept ask').toEqual([]);
    expect(isOpen(second!.events, item), 'maya\'s resolution closes it').toBe(false);
    expect(isOpen(third!.events, item), 'unresolved again, it opens again').toBe(true);
    expect(asksForT(third!.events, third!.since).length, 'no ask was ever raised for it, so one is raised now').toBe(1);
  }, 900_000);

  it('a reopened note whose ask passed its deadline unanswered reaches you through a new accept ask', async () => {
    let defaulted = 0;
    const { stops } = await play([null, REVIEWER, null], async (n, events, _w, hub) => {
      if (n !== 0) return;
      // The first stop's accept ask takes its default, keep, at its one-minute deadline: you never answered it.
      const [ask] = asksForT(events);
      expect(ask, `the first stop raised an accept ask for ${T.id}`).toBeDefined();
      const all = await settle(hub, (e) => e.some((x) => x.kind === 'ask.defaulted' && x.subject === `ask:${ask!.id}`), 150_000);
      expect(all.some((x) => x.kind === 'ask.defaulted' && x.subject === `ask:${ask!.id}`), 'the ask defaults at its deadline').toBe(true);
      defaulted = await lastPos(hub);
    }, '1m');
    const third = stops.at(-1)!;
    const raised = asksForT(third.events, defaulted);
    const open = raised.filter((a) => !third.events.some((e) => e.subject === `ask:${a.id}` && /^ask\.(answered|defaulted|cancelled|moot|superseded|escalated)$/.test(e.kind)));
    expect(open.length, `none is open for T and you never answered one, so its reopened note gets one new accept ask: ${listed(raised)}`).toBe(1);
  }, 900_000);

  it('a note open since the session\'s own account resolved its thread gets its accept ask once the thread is unresolved', async () => {
    const { ref, stops } = await play([YOU_GH, null]);
    const [first, second] = stops;
    const item = itemsOf(first!.events, ref).find(namesT)!;
    expect(item, `the first stop opens ${T.id}'s item, naming who resolved it`).toBeDefined();
    expect(asksForT(first!.events), 'the agent\'s own resolution raises no accept ask').toEqual([]);
    expect(isOpen(second!.events, item), 'unresolved, it is still open').toBe(true);
    expect(asksForT(second!.events, second!.since).length, 'none is open for it and you never answered one, so its accept ask is raised now').toBe(1);
  }, 900_000);

  it('that note\'s accept ask, once it passed its deadline unanswered, is not raised again while the note stays open', async () => {
    let defaulted = 0;
    const { hub } = await play([YOU_GH, null, null], async (n, events, _w, hub) => {
      if (n !== 1) return;
      const [ask] = asksForT(events);
      expect(ask, `the second stop raised an accept ask for ${T.id}`).toBeDefined();
      const all = await settle(hub, (e) => e.some((x) => x.kind === 'ask.defaulted' && x.subject === `ask:${ask!.id}`), 150_000);
      expect(all.some((x) => x.kind === 'ask.defaulted' && x.subject === `ask:${ask!.id}`), 'the ask defaults at its deadline').toBe(true);
      defaulted = await lastPos(hub);
    }, '1m');
    // An ask is raised apart from the claim: give one the time it would take to land.
    const last = await settle(hub, () => false, 5000);
    expect(asksForT(last, defaulted), 'nothing changed about the open note, so the same question never reaches you twice').toEqual([]);
  }, 900_000);

  it('a note that opens again while the session\'s own account holds its thread resolved gets its new accept ask once the thread is unresolved, and only once', async () => {
    let defaulted = 0;
    let owed = 0;
    const { ref, hub, stops } = await play([null, REVIEWER, YOU_GH, null, null], async (n, events, _w, hub) => {
      // The first stop's accept ask, then the one the fourth raises, each take their default, keep, at the deadline.
      if (n !== 0 && n !== 3) return;
      const [ask] = asksForT(events, n === 0 ? 0 : defaulted);
      expect(ask, `stop ${n + 1} raised an accept ask for ${T.id}`).toBeDefined();
      const all = await settle(hub, (e) => e.some((x) => x.kind === 'ask.defaulted' && x.subject === `ask:${ask!.id}`), 150_000);
      expect(all.some((x) => x.kind === 'ask.defaulted' && x.subject === `ask:${ask!.id}`), 'the ask defaults at its deadline').toBe(true);
      if (n === 0) defaulted = await lastPos(hub);
      else owed = await lastPos(hub);
    }, '1m');
    const [, , third, fourth] = stops;
    const item = itemsOf(third!.events, ref).find(namesT)!;
    expect(isOpen(third!.events, item), 'a reviewer closed it, so seen again it opens again, resolved by the session\'s own account').toBe(true);
    expect(asksForT(third!.events, third!.since), 'the agent\'s own resolution raises no accept ask').toEqual([]);
    expect(asksForT(fourth!.events, fourth!.since).length, 'unresolved, none is open for T and you never answered one, so its reopened note gets one new accept ask').toBe(1);
    // An ask is raised apart from the claim: give one the time it would take to land.
    const last = await settle(hub, () => false, 5000);
    expect(asksForT(last, owed), 'that ask passed its deadline too, so the same question never reaches you a third time').toEqual([]);
  }, 1_200_000);

  it('a note whose ask you answered "keep it open" opens again when its thread is unresolved after a reviewer resolved it, with no new ask', async () => {
    let kept = 0;
    const { ref, stops } = await play([null, REVIEWER, null], async (n, events, w, hub) => {
      if (n !== 0) return;
      const [ask] = asksForT(events);
      expect(ask, `the first stop raised an accept ask for ${T.id}`).toBeDefined();
      expect((await answer(w, ask!, 'keep')).code, 'deep inbox answer … keep counts').toBe(0);
      await settle(hub, (all) => all.some((e) => e.kind === 'ask.answered' && e.subject === `ask:${ask!.id}`), 60_000);
      kept = await lastPos(hub);
    });
    const third = stops.at(-1)!;
    const item = itemsOf(third.events, ref).find(namesT)!;
    expect(isOpen(third.events, item), 'a reviewer closed it, so unresolved again it opens again').toBe(true);
    expect(asksForT(third.events, kept), 'you answered its ask, so the same question never reaches you twice').toEqual([]);
  }, 900_000);
});
