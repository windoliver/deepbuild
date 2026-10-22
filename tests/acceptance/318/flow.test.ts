// Criteria 2, 3, 4, 5 and 7: provisional asks, pins that move, superseded and moot, and text typed in
// the session. Each runs the asks core on a real record, with a virtual clock and, for pins, a real git repo.

import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  DAY, HOUR, about, agent, ask, card, core, deliveredFor, gitRepo, isObj, openWorld, plan, planShown, shown, shownAsks, sourceOf,
  type World,
} from './helpers.ts';

let w: World;
beforeEach(async () => { w = await openWorld(); });
afterEach(async () => { await w.close(); });

test('#318.471f0611 a provisional taste call hands the agent the recommended option at once, and a different answer undoes it', async () => {
  await w.start('S1', 'T1');
  const now = w.clock.now();
  const a = await w.asks.raise(agent('S1'), sourceOf('taste'), ask('taste', now, { subject: 'header', provisional: true }));
  expect(deliveredFor(w, a).map((d) => [d.option, d.provisional]), `ask ${a}: the agent carries on with the recommended option at once`).toEqual([['blue', true]]);
  expect(await w.asks.holds('S1', { leaves_machine: false }), 'a local step waits on a provisional ask').toEqual([]);
  expect(await shownAsks(w), `ask ${a} still waits for your answer`).toContain(a);
  await w.asks.answer(card, a, { option: 'green', token: 'click-1' });
  const later = deliveredFor(w, a).slice(1);
  expect(later.map((d) => [d.option, d.undoes]), `ask ${a}: your different answer undoes the recommended option`).toEqual([['green', 'blue']]);
  expect((await w.row(a))?.outcome).toBe('answered');
  // Its twin, answered with the recommended option, undoes nothing.
  const b = await w.asks.raise(agent('S1'), sourceOf('taste'), ask('taste', now, { subject: 'footer', provisional: true }));
  await w.asks.answer(card, b, { option: 'blue', token: 'click-2' });
  expect(deliveredFor(w, b).filter((d) => d.undoes !== null), `ask ${b}: the same answer undid something`).toEqual([]);
});

test('#318.4c8ff7fb a step that leaves the machine waits for your answer under a provisional ask; a local step does not', async () => {
  await w.start('S1', 'T1');
  const now = w.clock.now();
  const taste = await w.asks.raise(agent('S1'), sourceOf('taste'), ask('taste', now, { subject: 'header', provisional: true }));
  const choice = await w.asks.raise(agent('S1'), sourceOf('choice'), ask('choice', now, { subject: 'store', provisional: true }));
  // A push, a post and a payment each leave the machine; the guard engine (#304) says which steps do.
  for (const step of ['push', 'post', 'payment']) {
    const held = await w.asks.holds('S1', { leaves_machine: true });
    expect(held, `a ${step} under the provisional taste call runs before your answer`).toContain(taste);
    expect(held, `a ${step} under the provisional choice runs before your answer`).toContain(choice);
  }
  expect(await w.asks.holds('S1', { leaves_machine: false }), 'a local step waits').toEqual([]);
  await w.asks.answer(card, taste, { option: 'blue', token: 'click-1' });
  await w.asks.answer(card, choice, { option: 'files', token: 'click-2' });
  const after = await w.asks.holds('S1', { leaves_machine: true });
  expect(after, 'a push still waits on an answered ask').not.toContain(taste);
  expect(after, 'a push still waits on an answered ask').not.toContain(choice);
});

test('#318.a4005788 an answer after the pinned commit moved shows the diff, is recorded on the old commit, and an untouched provisional choice is not asked again', async () => {
  const repo = gitRepo(w.dir);
  repo.commit('src/b.ts', 'export const store = "sqlite";');
  const shownCommit = repo.commit('src/a.ts', 'export const a = 1;');
  await w.start('S1', 'T1', repo.path);
  const now = w.clock.now();
  const pin = { kind: 'commit', ref: shownCommit };
  const a = await w.asks.raise(agent('S1'), sourceOf('taste'), ask('taste', now, { subject: 'header', pinned_to: pin }));
  const choice = await w.asks.raise(agent('S1'), sourceOf('choice'), ask('choice', now, { subject: 'store', provisional: true, pinned_to: pin, question: 'Keep the store in src/b.ts on SQLite?' }));
  const asked = (await w.events('ask.created')).length;
  const moved = repo.commit('src/a.ts', 'export const a = 2;');
  w.clock.set(now + HOUR);
  await w.asks.tick();
  const changed = (await w.asks.card(a)).changed;
  expect(changed && [changed.from, changed.to], `ask ${a}: its card shows the change since the commit it showed`).toEqual([shownCommit, moved]);
  expect(changed?.files, `ask ${a}: the files changed since`).toEqual(['src/a.ts']);
  expect(changed?.diff, `ask ${a}: the diff since`).toContain('+export const a = 2;');
  await w.asks.answer(card, a, { option: 'green', token: 'click-1' });
  const [answered] = about(await w.events('ask.answered'), a);
  expect(JSON.stringify(answered?.data ?? null), `ask ${a} is recorded as answered on the commit it showed`).toContain(shownCommit);
  expect((await w.row(a))?.outcome).toBe('answered');
  // The change didn't touch src/b.ts, so the provisional choice is not asked again.
  expect((await w.events('ask.created')).length, `ask ${choice} was asked again`).toBe(asked);
  expect(about(await w.events('ask.superseded'), choice), `ask ${choice} was replaced`).toEqual([]);
  expect((await w.row(choice))?.outcome).toBe('unanswered');
  expect((await shownAsks(w)).filter((h) => h === choice), `ask ${choice} shows once`).toEqual([choice]);
});

test('#318.4fbf5336 a second ask on the same subject supersedes the first, an ask whose check passes is moot, and neither counts', async () => {
  await w.start('S1', 'T1');
  const now = w.clock.now();
  const first = await w.asks.raise(agent('S1'), sourceOf('taste'), ask('taste', now, { subject: 'header' }));
  const second = await w.asks.raise(agent('S1'), sourceOf('taste'), ask('taste', now, { subject: 'header', question: 'Which header, after the redesign?', pinned_to: shown('header v2') }));
  const blocked = await w.asks.raise(core('S1'), sourceOf('unblock'), ask('unblock', now, { subject: 'gh-auth' }));
  // The check the unblock names (proves: auth.unit) passes: its run, then its verdict.
  const ids = { run: 'run:01K74G3A5C7E9G1J3M5P7R9T1V', verdict: 'verdict:01K74G4B6D8F0H2K4M6P8R0T2V', claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H' };
  await w.record.append(core('S1'), { v: 1, id: '01K74G3A5C7E9G1J3M5P7R9T1V', kind: 'run.finished', ts: now, data: { run: ids.run, outcome: 'passed', tests_run: 4, passed: 4, runs: 1, evidence: [], check: 'auth.unit', assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'node-24.22.0/darwin-arm64' } });
  await w.record.append(core('S1'), { v: 1, id: '01K74G4B6D8F0H2K4M6P8R0T2V', kind: 'verdict.made', subject: ids.claim, ts: now, data: {
    outcome: 'PASS', verdict: ids.verdict, claim: ids.claim, reasons: [], smallest: null, points_to: null, commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46',
    requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check: 'auth.unit', depth: 'unit', oracle: 'code', runs: { clean: 1, needed: 1, counted: [ids.run] }, smallest: null, points_to: null, evidence: [], proof: 'test_run' }],
    key: { commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46', doc_revisions: [], check_digests: [], state_digests: [], environment: 'node-24.22.0/darwin-arm64', tools: [] },
  } });
  await w.asks.tick();
  const [superseded] = about(await w.events('ask.superseded'), first);
  expect(isObj(superseded?.data) && superseded.data.by, `ask ${first} is superseded by ${second}`).toBe(second);
  expect(about(await w.events('ask.moot'), blocked), `ask ${blocked} closes as moot when its check passes`).toHaveLength(1);
  expect((await w.row(blocked))?.outcome).toBe('moot');
  expect((await w.row(first))?.outcome).toBe('superseded');
  expect(await shownAsks(w), 'Needs you counts only the newer ask').toEqual([second]);
});

test('#318.4f134efa text typed in the session answers its question only, unverified and never a decision; an authority ask stays for one tap, and nothing defaults afterwards', async () => {
  await w.start('S1', 'T1');
  await w.start('S2', 'T2');
  const now = w.clock.now();
  const question = await w.asks.raise(agent('S1'), sourceOf('taste'), ask('taste', now, { subject: 'header' }));
  const push = await w.asks.raise(core('S1'), sourceOf('authority'), ask('authority', now, { subject: 'push' }), plan('feature/login'));
  const elsewhere = await w.asks.raise(agent('S2'), sourceOf('taste'), ask('taste', now, { subject: 'header' }));
  const words = 'use the green one, and yes push it';
  await w.typed('S1', words);
  await w.asks.tick();
  const [answered] = about(await w.events('ask.answered'), question);
  expect(isObj(answered?.data) && answered.data.decision, `ask ${question} is answered by the typed text, with decision none`).toBe('none');
  const recorded = JSON.stringify(answered?.data ?? null);
  expect(recorded, `ask ${question}: recorded as answered in the session`).toMatch(/session/);
  expect(recorded, `ask ${question}: recorded as unverified`).toMatch(/unverified|"verified":false/);
  expect(await w.events('decision.created'), 'typed text was saved as a decision').toEqual([]);
  expect((await w.row(elsewhere))?.outcome, `ask ${elsewhere} in another session was answered by the typed text`).toBe('unanswered');
  // The authority ask stays open, its card shows the words beside it, and one tap answers it.
  expect((await w.row(push))?.outcome, `ask ${push}: typed text answered an authority ask`).toBe('unanswered');
  expect(await shownAsks(w)).toContain(push);
  expect((await w.asks.card(push)).words, `ask ${push}: the card shows the typed words beside it`).toContain(words);
  const hash = await planShown(w, push);
  expect(await w.asks.authorized(push, hash), `ask ${push}: typed "yes" ran the push`).toBeNull();
  await w.asks.answer(card, push, { option: 'push', plan_hash: hash, token: 'click-1' });
  expect((await w.row(push))?.outcome).toBe('answered');
  // Both actions ran: neither ask defaults to no afterwards.
  w.clock.set(now + 3 * DAY);
  await w.asks.tick();
  expect([...about(await w.events('ask.defaulted'), question), ...about(await w.events('ask.defaulted'), push)], 'an ask whose action ran defaulted afterwards').toEqual([]);
});
