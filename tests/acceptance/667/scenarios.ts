// The scenarios of AC3, AC4 and AC5's deadline, shared with plants.test.ts: each runs against the real hub, or
// against the planted wrong program `plant` names (DEEP_HUB_PLANT, README: Wrong programs), and fails naming its
// criterion (and, for a deadline, the ask).

import { expect } from 'vitest';
import {
  AC, Agent, closings, confirmWith, createdOf, DAY, decisionsOf, deep, events, expectClosedByDeadline, expectFramed, expectStreamMatchesRecord, HOUR, inbox,
  inboxRead, makeHome, Proof, question, raise, restartBefore, seedAuthority, startHub, Stream, writeSettings, type Ev, type Hub,
} from './helpers.ts';

/** Nothing counted for the ask: no event closed it, and no decision was saved from it or applied to it. */
async function expectOpen(hub: Hub, handle: string, how: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));   // anything the hub appends for the answer lands before this read
  const all = await events(hub);
  const found = [...closings(all, handle), ...decisionsOf(all, handle)];
  expect(found.map((e) => `${e.kind} ${e.id}`), `${AC[3]}: ask ${handle} (${how}) counted: it must be refused and stay open, with no decision saved`).toEqual([]);
}

/**
 * AC3: the authority ask, raised for the agent's session, answered by `deep inbox answer` run inside the agent's
 * process tree (with the OS confirming, so only the peer check can refuse it), then by you with the confirmation
 * cancelled, then by you with it confirmed.
 */
export async function authorityAnswers(plant?: string): Promise<void> {
  const proof = new Proof(`${AC[3]}${plant ? ` on ${plant}` : ''}`);
  const home = makeHome();
  writeSettings(home);
  const agent = Agent.start(home);
  const ask = await seedAuthority(home, agent, 'feature/login');
  let hub: Hub | undefined;
  let stream: Stream | undefined;
  try {
    hub = await startHub(home, { confirm: 'confirmed', plant });
    await agent.establish(hub);
    stream = await Stream.open(hub, (await inboxRead(hub)).log_pos);
    const created = createdOf(await events(hub), ask)!;
    expect({ kind: created.data.kind, deadline: created.data.deadline - created.ts, default: created.data.default }, `${AC[3]}: the authority ask waits 1 day and defaults to no`)
      .toEqual({ kind: 'authority', deadline: DAY, default: 'decline' });

    // From inside the asking session's process tree, with the OS confirming you: refused, and the ask stays open.
    const inside = await agent.deep(['inbox', 'answer', ask, 'decline']);
    proof.ran('deep inbox answer, run inside the agent\'s process tree', inside);
    await expectOpen(hub, ask, `answered by deep inbox answer run inside session ${agent.session}'s process tree, the OS confirming`);
    expect(inside.code, `${AC[3]}: deep inbox answer run inside the asking session's process tree exits 3 (not decided): ${inside.stdout}${inside.stderr}`).toBe(3);
    expect((await inbox(home, proof, 'after the answer from inside the session')).map((r) => r.ask), `${AC[3]}: deep inbox still lists ${ask}`).toContain(ask);

    // By you, with the OS confirmation cancelled: no decision, and the ask stays open.
    confirmWith(hub, 'cancelled');
    const cancelled = await deep(home, ['inbox', 'answer', ask, 'decline']);
    proof.ran('deep inbox answer by you, the OS confirmation cancelled', cancelled);
    await expectOpen(hub, ask, 'answered by you with the OS confirmation cancelled');
    expect(cancelled.code, `${AC[3]}: deep inbox answer with the confirmation cancelled exits 3 (not decided): ${cancelled.stdout}${cancelled.stderr}`).toBe(3);
    expect(`${cancelled.stdout}${cancelled.stderr}`, `${AC[3]}: deep inbox answer says which ask stays open`).toContain(ask);
    expect((await inbox(home, proof, 'after the cancelled confirmation')).map((r) => r.ask), `${AC[3]}: deep inbox still lists ${ask}`).toContain(ask);

    // By you, with the OS confirming you: it counts, once.
    confirmWith(hub, 'confirmed');
    const mine = await deep(home, ['inbox', 'answer', ask, 'decline']);
    proof.ran('deep inbox answer by you, the OS confirming', mine);
    expect(mine.code, `${AC[3]}: deep inbox answer by you, the OS confirming, exits 0: ${mine.stdout}${mine.stderr}`).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    const all = await events(hub);
    expect(closings(all, ask).map((e) => [e.kind, e.data.answer, e.data.decision, e.data.via, e.data.verified]), `${AC[3]}: ${ask} is answered once, no, from deep inbox, verified`)
      .toEqual([['ask.answered', 'decline', 'deny', 'inbox', true]]);
    expect(decisionsOf(all, ask).map((e) => [e.kind, e.data.answer]), `${AC[3]}: your answer to ${ask} is saved as one decision`).toEqual([['decision.created', 'decline']]);
    expect((await inbox(home, proof, 'after your confirmed answer')).map((r) => r.ask), `${AC[3]}: ${ask} leaves deep inbox`).not.toContain(ask);
    await expectFramed(AC[3], stream, closings(all, ask)[0]!, `${ask} answered`);
    await expectStreamMatchesRecord(AC[3], stream, hub);
  } finally {
    await proof.close(hub, stream);
    stream?.close();
  }
}

/**
 * AC4: a choice ask (4 hours, defaulting to its recommended option) and the authority ask (1 day, no), neither
 * answered. The test moves the hub's clock past each deadline by starting it again just before it (README).
 */
export async function defaultsAtDeadlines(plant?: string): Promise<void> {
  const proof = new Proof(`${AC[4]}${plant ? ` on ${plant}` : ''}`);
  const home = makeHome();
  writeSettings(home);
  const agent = Agent.start(home);
  const authority = await seedAuthority(home, agent, 'feature/signup');
  let hub: Hub | undefined;
  let stream: Stream | undefined;
  try {
    hub = await startHub(home, { confirm: 'confirmed', plant });
    await agent.establish(hub);
    await agent.initialize();
    stream = await Stream.open(hub, (await inboxRead(hub)).log_pos);
    const { created } = await raise(agent, hub, question('choice', 'Keep the cart on SQLite or plain files?', [['sqlite', 'SQLite'], ['files', 'Plain files']], 'sqlite'));
    const choice = `ask:${created.id}`;
    const deadline = created.data.deadline as number;
    expect({ deadline: deadline - created.ts, default: created.data.default }, `${AC[4]}: the choice ask waits 4 hours and defaults to its recommended option`)
      .toEqual({ deadline: 4 * HOUR, default: 'sqlite' });
    const authorityDeadline = createdOf(await events(hub), authority)!.data.deadline as number;

    // The clock past the choice ask's deadline, no answer: its default, announced on the stream, recorded as defaulted.
    hub = await restartBefore(hub, deadline, { confirm: 'confirmed', plant });
    await stream.resume(hub);
    const [closed] = await expectClosedByDeadline(AC[4], hub, choice, deadline, 'the choice ask');
    let all = await events(hub);
    expect(closings(all, choice).map((e) => [e.kind, e.data.answer, e.data.decision]), `${AC[4]}: ${choice} takes its default, sqlite, once, recorded as defaulted`)
      .toEqual([['ask.defaulted', 'sqlite', 'none']]);
    expect(closed!.ts, `${AC[4]}: ${choice}'s default comes at its deadline, never before`).toBeGreaterThanOrEqual(deadline);
    await expectFramed(AC[4], stream, closed!, `the default of ${choice}, announced`);
    const row = (await inboxRead(hub)).asks.find((r) => r.ask === choice);
    expect(row && [row.status, row.outcome], `${AC[4]}: the inbox records ${choice} as defaulted`).toEqual(['closed', 'defaulted']);
    expect((await inbox(home, proof, 'after the choice ask took its default')).map((r) => r.ask), `${AC[4]}: ${choice} leaves deep inbox`).not.toContain(choice);

    // An undo opens it again: back in deep inbox, open in the inbox read, on the stream, and answerable.
    const undo = await deep(home, ['inbox', 'undo', choice]);
    proof.ran(`deep inbox undo ${choice}`, undo);
    expect(undo.code, `${AC[4]}: deep inbox undo ${choice} exits 0: ${undo.stdout}${undo.stderr}`).toBe(0);
    expect(undo.stdout, `${AC[4]}: deep inbox undo names the ask it opened again`).toContain(choice);
    const reopened = await stream.waitFor((e) => (e.subject === choice || e.data?.ask === choice) && e.log_pos > closed!.log_pos, 5000);
    expect(reopened, `${AC[4]}: the stream shows the undo of ${choice}'s default within 5 s`).toBeDefined();
    expect((await inbox(home, proof, 'after the undo')).map((r) => r.ask), `${AC[4]}: the undo puts ${choice} back in deep inbox`).toContain(choice);
    const back = (await inboxRead(hub)).asks.find((r) => r.ask === choice);
    expect(back && [back.status !== 'closed', back.outcome], `${AC[4]}: the inbox holds ${choice} open again, unanswered`).toEqual([true, 'unanswered']);
    const answered = await deep(home, ['inbox', 'answer', choice, 'files']);
    proof.ran(`deep inbox answer ${choice} files, after the undo`, answered);
    expect(answered.code, `${AC[4]}: ${choice}, opened again, takes your answer: ${answered.stdout}${answered.stderr}`).toBe(0);
    all = await events(hub);
    expect(closings(all, choice).filter((e) => e.log_pos > reopened!.log_pos).map((e) => [e.kind, e.data.answer]), `${AC[4]}: after the undo ${choice} is answered once, files`)
      .toEqual([['ask.answered', 'files']]);

    // The clock past the authority ask's deadline: it takes no, recorded as defaulted, and saves no decision.
    hub = await restartBefore(hub, authorityDeadline, { confirm: 'confirmed', plant });
    await stream.resume(hub);
    const [no] = await expectClosedByDeadline(AC[4], hub, authority, authorityDeadline, 'the authority ask');
    await expectFramed(AC[4], stream, no!, `the default of ${authority}, announced`);
    all = await events(hub);
    expect(closings(all, authority).map((e) => [e.kind, e.data.answer, e.data.decision]), `${AC[4]}: ${authority} takes no at its deadline, once, recorded as defaulted`)
      .toEqual([['ask.defaulted', 'decline', 'deny']]);
    expect(no!.ts, `${AC[4]}: ${authority}'s default comes at its deadline, never before`).toBeGreaterThanOrEqual(authorityDeadline);
    expect(decisionsOf(all, authority).map((e) => e.kind), `${AC[4]}: a default saves no decision for ${authority}`).toEqual([]);
    const authorityRow = (await inboxRead(hub)).asks.find((r) => r.ask === authority);
    expect(authorityRow && [authorityRow.status, authorityRow.outcome], `${AC[4]}: the inbox records ${authority} as defaulted`).toEqual(['closed', 'defaulted']);
    expect((await inbox(home, proof, 'after the authority ask took no')).map((r) => r.ask), `${AC[4]}: ${authority} leaves deep inbox`).not.toContain(authority);
    await expectStreamMatchesRecord(AC[4], stream, hub);
  } finally {
    await proof.close(hub, stream);
    stream?.close();
  }
}

/** Five taste calls and a choice from one session, by deep_ask: the sixth, the choice, folds into the exception. */
export async function sixAsks(agent: Agent, hub: Hub, tag: string): Promise<{ tastes: Ev[]; sixth: Ev; exception: Ev }> {
  const tastes: Ev[] = [];
  for (const screen of ['login', 'signup', 'cart', 'checkout', 'search']) {
    const { created } = await raise(agent, hub, question('taste', `Which header colour on the ${screen} page for ${tag}?`, [['blue', 'Blue header'], ['green', 'Green header']], 'green'));
    tastes.push(created);
  }
  const { created } = await raise(agent, hub, question('choice', `Keep the ${tag} store on SQLite or plain files?`, [['sqlite', 'SQLite'], ['files', 'Plain files']], 'files'));
  const exception = (await events(hub)).find((e) => e.kind === 'ask.created' && e.data?.kind === 'exception' && e.session === agent.session);
  expect(exception?.data.question, `${AC[5]}: the sixth open ask from session ${agent.session} raises one exception, "this session keeps asking"`).toMatch(/keeps asking/i);
  return { tastes, sixth: created, exception: exception! };
}

/**
 * AC5's deadline: the six asks left unanswered, the exception too, with the hub's clock moved past the sixth's
 * deadline (4 hours; the five taste calls wait 3 days). The folded ask keeps its own deadline and default.
 */
export async function foldedPastDeadline(plant?: string): Promise<void> {
  const proof = new Proof(`${AC[5]} deadline${plant ? ` on ${plant}` : ''}`);
  const home = makeHome();
  writeSettings(home);
  const agent = Agent.start(home);
  let hub: Hub | undefined;
  let stream: Stream | undefined;
  try {
    hub = await startHub(home, { confirm: 'confirmed', plant });
    await agent.establish(hub);
    await agent.initialize();
    stream = await Stream.open(hub, (await inboxRead(hub)).log_pos);
    const { tastes, sixth, exception } = await sixAsks(agent, hub, 'deadline');
    const ask = `ask:${sixth.id}`;
    const deadline = sixth.data.deadline as number;
    expect(deadline - sixth.ts, `${AC[5]}: the sixth ask, a choice, waits 4 hours`).toBe(4 * HOUR);
    await inbox(home, proof, 'the six asks open, the sixth folded');

    hub = await restartBefore(hub, deadline, { confirm: 'confirmed', plant });
    await stream.resume(hub);
    await expectClosedByDeadline(AC[5], hub, ask, deadline, 'the sixth ask, folded into the exception');
    await expectClosedByDeadline(AC[5], hub, `ask:${exception.id}`, exception.data.deadline as number, 'the exception "this session keeps asking"');
    const all = await events(hub);
    expect(closings(all, ask).map((e) => [e.kind, e.data.answer]), `${AC[5]}: ${ask}, folded, takes its own default at its own deadline, once`).toEqual([['ask.defaulted', 'files']]);
    expect(closings(all, ask)[0]!.ts, `${AC[5]}: ${ask}'s default comes at its deadline, never before`).toBeGreaterThanOrEqual(deadline);
    for (const t of tastes) expect(closings(all, `ask:${t.id}`).map((e) => e.kind), `${AC[5]}: ask:${t.id}, a taste call due in 3 days, stays open`).toEqual([]);
    const left = (await inbox(home, proof, 'past the sixth ask\'s deadline')).map((r) => r.ask);
    expect(left, `${AC[5]}: ${ask} leaves deep inbox at its deadline`).not.toContain(ask);
    for (const t of tastes) expect(left, `${AC[5]}: deep inbox still lists ask:${t.id}`).toContain(`ask:${t.id}`);
    await expectStreamMatchesRecord(AC[5], stream, hub);
  } finally {
    await proof.close(hub, stream);
    stream?.close();
  }
}
