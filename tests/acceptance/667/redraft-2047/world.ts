// #667 AC3, AC4 and AC5, redrafted blind at 531da1ef0 from issue #667, the design and the base (README.md). The world
// is the earlier #667 suite's (../helpers.ts: temp homes under /tmp/dh667-*, the agent stand-in, the socket, the
// stream consumer, the proof), with one change: each hub runs with DEEP_HUB_TEST_CLOCK_STEPS=1, so the test moves the
// hub's clock with the socket's test.clock while the hub keeps running. Each scenario runs against the real hub, or
// against the planted wrong program `plant` names (DEEP_HUB_PLANT), and every failure it throws starts with its
// criterion's tag.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import {
  Agent, childEnv, CLI, closings, confirmWith, control, createdOf, DAY, decisionsOf, deep, events, HOUR, inboxRead, load, makeHome, NODE, own,
  pending, Proof, question, REPO, rootOf, seedAuthority, sleep, Stream, writeSettings, type Ev, type Hub, type Line, type Outcome,
} from '../helpers.ts';

// The criteria, by the IDs scripts/proof-change.mjs computes from the issue's text (README: Criterion IDs).
export const AC3 = 'AC3 #667.a91c9ea1';
export const AC4 = 'AC4 #667.47e397e9';
export const AC5 = 'AC5 #667.b9deefc5';

/** How long, in real time, an ask may stay open once the hub's clock is past its deadline (README: Readings). */
const GRACE = 60_000;
/** A read of the record slower than this while the test waits on a deadline means the hub was too loaded to judge. */
const STALL = 10_000;
/** How long the stream has to frame an event the record holds. */
const FRAMED = 30_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const bare = (handle: string): string => handle.replace(/^ask:/, '');

/** A reading only load could have spoiled: the test is skipped with it, never passed (AGENTS.md, Proof). */
export class Inconclusive extends Error {}

/** Runs `body`, so that every failure it throws starts with `tag`: a BLOCKED world included. */
async function tagged(tag: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    if (error instanceof Inconclusive) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(tag)) throw error;
    throw new Error(`${tag}: ${message}`);
  }
}

// ---- The hub, its clock stepped by the test.

/**
 * `deep hub run` with HOME at the test's home, the OS confirmation stubbed (DEEP_HUB_TEST_CONFIRM, a file holding
 * `confirmed`, so no real Touch ID prompt can appear) and its clock stepped only by test.clock (DEEP_HUB_TEST_CLOCK_STEPS=1).
 */
async function startHub(home: string, plant: string | undefined): Promise<Hub> {
  const confirm = join(dirname(home), 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_CLOCK_STEPS: '1', DEEP_HUB_PLANT: plant });
  const spawnedAt = Date.now();
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<Line | undefined>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(undefined), 180_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (!first.includes('\n')) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(first.split('\n')[0]!) as Line); } catch { resolve(undefined); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, home, socket: join(rootOf(home), 'hub.sock'), confirm, start: String(ready.start), child, clock: undefined, spawnedAt, readyAt: Date.now(), output: () => out };
}

/** test.clock: the hub's clock stepped forward by `ms`; resolves with the hub's clock after the step. */
async function step(hub: Hub, ms: number): Promise<number> {
  const conn = await control(hub);
  try {
    const reply = await conn.call('test.clock', { advance_ms: Math.max(0, Math.round(ms)) });
    if (typeof reply.result?.now !== 'number') throw Error(`BLOCKED: test.clock refused: ${JSON.stringify(reply.error ?? reply)}`);
    return reply.result.now as number;
  } finally {
    conn.close();
  }
}
/** The hub's clock moved to `at`; resolves with where it is then. */
const stepTo = async (hub: Hub, at: number): Promise<number> => {
  const now = await step(hub, 0);
  return now >= at ? now : step(hub, at - now);
};

/**
 * The hub's clock moved 1 s past `deadline`, then the record read (no inbox read and no answer, which could close an
 * overdue ask on the way) until the ask closes or GRACE of real time ends. Resolves with its first closing event;
 * throws, naming the criterion and the ask, when it is still open then. Still open on a hub too loaded to answer a
 * read within STALL is INCONCLUSIVE.
 */
async function closedPast(tag: string, hub: Hub, handle: string, deadline: number, label: string): Promise<Ev> {
  const stepped = await stepTo(hub, deadline + 1000);
  const t0 = Date.now();
  let slowest = 0;
  for (;;) {
    const t = Date.now();
    const all = await events(hub);
    slowest = Math.max(slowest, Date.now() - t);
    const closed = closings(all, handle);
    if (closed.length) return closed[0]!;
    if (Date.now() - t0 >= GRACE) break;
    await sleep(500);
  }
  const past = Math.round((stepped - deadline + Date.now() - t0) / 1000);
  if (slowest > STALL) throw new Inconclusive(`INCONCLUSIVE ${tag}: ask ${handle} (${label}) was still open ${past} s past its deadline, but a read of the record took up to ${slowest} ms meanwhile (load ${load()}): the hub was too loaded to judge`);
  throw Error(`${tag}: ask ${handle} (${label}) is still open ${past} s past its deadline ${iso(deadline)} on the hub's clock, though the hub answered every read within ${slowest} ms (load ${load()}): past its deadline an ask takes its default`);
}

// ---- `deep inbox`, read for what a person sees, not its exact words.

/** `deep inbox` run by you; it must exit 0. Its text. */
async function inbox(tag: string, home: string, proof: Proof, step: string): Promise<string> {
  const r = await deep(home, ['inbox']);
  proof.ran(`deep inbox: ${step}`, r);
  expect(r.code, `${tag}: deep inbox exits 0 (${step}): ${r.stdout}${r.stderr}`).toBe(0);
  return r.stdout;
}
/** Whether `line` names the ask: its ULID as a whole token, as its handle `ask:<ULID>` or its link `deepbuild://ask/<ULID>` hold it. */
const names = (line: string, handle: string): boolean => new RegExp(`(^|[^0-9A-Za-z])${bare(handle)}([^0-9A-Za-z]|$)`).test(line);
/** Whether `deep inbox` lists the ask as one waiting on you: a line names it that isn't a "decided for you" line. */
const lists = (text: string, handle: string): boolean => text.split('\n').some((l) => names(l, handle) && !/^\s*decided for you\b/i.test(l));
/** `deep inbox`'s items: each line that starts at the margin, with the indented lines under it. */
function items(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) && out.length) out.at(-1)!.push(line);
    else out.push([line]);
  }
  return out;
}

/** Nothing counted for the ask: no event closed it and no decision was saved from it. */
async function expectOpen(tag: string, hub: Hub, handle: string, how: string): Promise<void> {
  await sleep(500);   // anything the hub appends for the answer lands before this read
  const all = await events(hub);
  const counted = [...closings(all, handle), ...decisionsOf(all, handle)].map((e) => `${e.kind} ${JSON.stringify(e.data)}`);
  expect(counted, `${tag}: ask ${handle} (the authority ask), ${how}, counted: it must be refused, save no decision and stay open`).toEqual([]);
}

/**
 * deep_ask from the agent's own deep mcp; resolves with the ask.created the hub filed for it, read from the record.
 * The call may return at once (a taste call or a choice goes on with its recommended option, provisionally) or wait
 * for an answer; either way the record must hold the ask within 30 s. BLOCKED if the call fails or it never does.
 */
async function ask(agent: Agent, hub: Hub, args: Line): Promise<Ev> {
  let ended: { returned?: Outcome; failed?: string } | undefined;
  void pending(agent.tool('deep_ask', args, 150_000)).then((r) => (ended = r));
  for (const until = Date.now() + 30_000; Date.now() < until; await sleep(200)) {
    const created = (await events(hub)).find((e) => e.kind === 'ask.created' && e.data?.question === args.question);
    if (created) return created;
    if (ended && (ended.failed !== undefined || ended.returned?.isError)) throw Error(`BLOCKED: deep_ask "${String(args.question)}" failed before the hub filed its ask: ${ended.failed ?? JSON.stringify(ended.returned?.reply).slice(0, 1500)}`);
  }
  throw Error(`BLOCKED: the hub filed no ask.created for deep_ask "${String(args.question)}" within 30 s: ${JSON.stringify(ended?.returned?.reply ?? ended?.failed ?? 'still waiting').slice(0, 1500)}`);
}

/** The world every scenario starts from: your settings (#319's drafts with the issue's deadlines), the agent stand-in, an authority ask. */
async function world(plant: string | undefined, authority: boolean): Promise<{ home: string; agent: Agent; ask: string | undefined; hub: Hub }> {
  const home = makeHome();
  writeSettings(home);
  const agent = Agent.start(home);
  // The authority ask, raised for the agent's session through the asks core with the hub stopped (../helpers.ts).
  const ask = authority ? await seedAuthority(home, agent, 'feature/login') : undefined;
  const hub = await startHub(home, plant);
  await agent.establish(hub);
  return { home, agent, ask, hub };
}

// ---- AC3: the authority ask's three answers.

/**
 * The authority ask answered first by `deep inbox answer` run inside the asking session's process tree, with the OS
 * confirming, so only that it comes from inside the tree can refuse it; then by you with the OS confirmation
 * cancelled; then by you with the OS confirming you.
 */
export const ac3 = (plant?: string): Promise<void> => tagged(AC3, async () => {
  const proof = new Proof(`${AC3}${plant ? ` on ${plant}` : ''} (redraft-2047)`);
  let hub: Hub | undefined;
  let stream: Stream | undefined;
  try {
    const w = await world(plant, true);
    hub = w.hub;
    const ask = w.ask!;
    stream = await Stream.open(hub, (await inboxRead(hub)).log_pos);
    const created = createdOf(await events(hub), ask);
    expect(created && [created.data.kind, created.data.deadline - created.ts, created.data.default], `${AC3}: ask ${ask} is an authority ask with a 1-day deadline and the default no`)
      .toEqual(['authority', DAY, 'decline']);
    expect(lists(await inbox(AC3, w.home, proof, 'the authority ask open'), ask), `${AC3}: deep inbox lists ${ask}`).toBe(true);

    // From inside the asking session's process tree, the OS confirming: refused, and it stays open.
    const inside = await w.agent.deep(['inbox', 'answer', ask, 'decline']);
    proof.ran(`deep inbox answer ${ask} decline, run in session ${w.agent.session}'s process tree, the OS confirming`, inside);
    await expectOpen(AC3, hub, ask, `answered from inside session ${w.agent.session}'s process tree with the OS confirming`);
    expect(inside.code, `${AC3}: ask ${ask}: deep inbox answer run inside session ${w.agent.session}'s process tree is refused (a non-zero exit): ${inside.stdout}${inside.stderr}`).not.toBe(0);
    expect(lists(await inbox(AC3, w.home, proof, 'after the answer from inside the session'), ask), `${AC3}: ask ${ask} stays open in deep inbox after the answer from inside the session`).toBe(true);

    // By you, the OS confirmation cancelled: no decision, and it stays open.
    confirmWith(hub, 'cancelled');
    const cancelled = await deep(w.home, ['inbox', 'answer', ask, 'decline']);
    proof.ran(`deep inbox answer ${ask} decline by you, the OS confirmation cancelled`, cancelled);
    await expectOpen(AC3, hub, ask, 'answered by you with the OS confirmation cancelled');
    expect(cancelled.code, `${AC3}: ask ${ask}: deep inbox answer with the OS confirmation cancelled doesn't count (a non-zero exit): ${cancelled.stdout}${cancelled.stderr}`).not.toBe(0);
    expect(lists(await inbox(AC3, w.home, proof, 'after the cancelled confirmation'), ask), `${AC3}: ask ${ask} stays open in deep inbox after the cancelled confirmation`).toBe(true);

    // By you, the OS confirming you: it counts, once, and is saved as a decision.
    confirmWith(hub, 'confirmed');
    const mine = await deep(w.home, ['inbox', 'answer', ask, 'decline']);
    proof.ran(`deep inbox answer ${ask} decline by you, the OS confirming`, mine);
    expect(mine.code, `${AC3}: ask ${ask}: deep inbox answer by you with the OS confirming counts (exit 0): ${mine.stdout}${mine.stderr}`).toBe(0);
    await sleep(500);
    const all = await events(hub);
    expect(closings(all, ask).map((e) => [e.kind, e.data.answer]), `${AC3}: ask ${ask}, answered by you with the OS confirming, is answered once, decline`).toEqual([['ask.answered', 'decline']]);
    expect(decisionsOf(all, ask).map((e) => [e.kind, e.data.answer]), `${AC3}: your confirmed answer to ${ask} is saved as one decision`).toEqual([['decision.created', 'decline']]);
    expect(lists(await inbox(AC3, w.home, proof, 'after your confirmed answer'), ask), `${AC3}: ask ${ask}, answered, leaves deep inbox`).toBe(false);
  } finally {
    await proof.close(hub, stream);
    stream?.close();
  }
});

// ---- AC4: nobody answers; the clock moves past each deadline.

/** The record's closing of the ask, as the hub's inbox read holds it: [status, outcome]. */
async function inboxRow(hub: Hub, handle: string): Promise<[unknown, unknown] | undefined> {
  const row = (await inboxRead(hub)).asks.find((r) => r.ask === handle);
  return row && [row.status, row.outcome];
}

/**
 * A choice ask (4 hours, defaulting to its recommended option) raised by the agent's deep_ask and an authority ask
 * (1 day, no), neither answered; the hub's clock moved past each deadline in turn, the choice's default undone between.
 */
export const ac4 = (plant?: string): Promise<void> => tagged(AC4, async () => {
  const proof = new Proof(`${AC4}${plant ? ` on ${plant}` : ''} (redraft-2047)`);
  let hub: Hub | undefined;
  let stream: Stream | undefined;
  try {
    const w = await world(plant, true);
    hub = w.hub;
    const authority = w.ask!;
    await w.agent.initialize();
    stream = await Stream.open(hub, (await inboxRead(hub)).log_pos);
    const created = await ask(w.agent, hub, question('choice', 'Keep the cart on SQLite or plain files?', [['sqlite', 'SQLite'], ['files', 'Plain files']], 'sqlite'));
    const choice = `ask:${created.id}`;
    const deadline = created.data.deadline as number;
    expect([created.data.kind, deadline - created.ts, created.data.default], `${AC4}: ask ${choice} is a choice with a 4-hour deadline and its recommended option, sqlite, as its default`).toEqual(['choice', 4 * HOUR, 'sqlite']);
    const seeded = createdOf(await events(hub), authority)!;
    const authorityDeadline = seeded.data.deadline as number;
    expect([seeded.data.kind, authorityDeadline - seeded.ts, seeded.data.default], `${AC4}: ask ${authority} is an authority ask with a 1-day deadline and the default no`).toEqual(['authority', DAY, 'decline']);
    await inbox(AC4, w.home, proof, 'both asks open');

    // Past the choice ask's deadline with no answer: its default, recorded as defaulted and announced on the stream.
    const closed = await closedPast(AC4, hub, choice, deadline, 'the choice ask');
    let all = await events(hub);
    expect(closings(all, choice).map((e) => [e.kind, e.data.answer]), `${AC4}: ask ${choice} takes its default, sqlite, once, recorded as defaulted`).toEqual([['ask.defaulted', 'sqlite']]);
    expect(closed.ts, `${AC4}: ask ${choice}'s default comes at its deadline ${iso(deadline)}, never before`).toBeGreaterThanOrEqual(deadline);
    expect(await inboxRow(hub, choice), `${AC4}: the inbox holds ask ${choice} closed as defaulted`).toEqual(['closed', 'defaulted']);
    const framed = await stream.waitFor((e) => e.log_pos === closed.log_pos, FRAMED);
    expect(framed && [framed.event.id, framed.event.kind], `${AC4}: the stream announces ask ${choice}'s default at log_pos ${closed.log_pos}, where the record holds it`).toEqual([closed.id, closed.kind]);
    await inbox(AC4, w.home, proof, 'after the choice ask took its default');

    // An undo opens it again: in deep inbox, open in the inbox read, and your answer counts.
    const undo = await deep(w.home, ['inbox', 'undo', choice]);
    proof.ran(`deep inbox undo ${choice}`, undo);
    expect(undo.code, `${AC4}: ask ${choice}: deep inbox undo exits 0: ${undo.stdout}${undo.stderr}`).toBe(0);
    expect(lists(await inbox(AC4, w.home, proof, 'after the undo'), choice), `${AC4}: the undo puts ask ${choice} back in deep inbox`).toBe(true);
    const back = await inboxRow(hub, choice);
    expect(back && [back[0] !== 'closed', back[1]], `${AC4}: the undo opens ask ${choice} again, unanswered, in the inbox read (${JSON.stringify(back)})`).toEqual([true, 'unanswered']);
    const answered = await deep(w.home, ['inbox', 'answer', choice, 'files']);
    proof.ran(`deep inbox answer ${choice} files, after the undo`, answered);
    expect(answered.code, `${AC4}: ask ${choice}, opened again, takes your answer (exit 0): ${answered.stdout}${answered.stderr}`).toBe(0);
    all = await events(hub);
    expect(closings(all, choice).filter((e) => e.log_pos > closed.log_pos).map((e) => [e.kind, e.data.answer]), `${AC4}: after the undo, ask ${choice} is answered once, files`).toEqual([['ask.answered', 'files']]);

    // Past the authority ask's deadline with no answer: it takes no, recorded as defaulted.
    const no = await closedPast(AC4, hub, authority, authorityDeadline, 'the authority ask');
    all = await events(hub);
    expect(closings(all, authority).map((e) => [e.kind, e.data.answer, e.data.decision]), `${AC4}: ask ${authority} takes no at its deadline, once, recorded as defaulted`).toEqual([['ask.defaulted', 'decline', 'deny']]);
    expect(no.ts, `${AC4}: ask ${authority}'s default comes at its deadline ${iso(authorityDeadline)}, never before`).toBeGreaterThanOrEqual(authorityDeadline);
    expect(await inboxRow(hub, authority), `${AC4}: the inbox holds ask ${authority} closed as defaulted`).toEqual(['closed', 'defaulted']);
    await inbox(AC4, w.home, proof, 'after the authority ask took no');
  } finally {
    await proof.close(hub, stream);
    stream?.close();
  }
});

// ---- AC5: six open asks from one session.

interface Six { tastes: string[]; sixth: Ev; exception: Ev }
/** Five taste calls (3 days, recommended green) and then a choice (4 hours, recommended files), by deep_ask from one session. */
async function sixAsks(agent: Agent, hub: Hub, round: string): Promise<Six> {
  const tastes: Ev[] = [];
  for (const screen of ['login', 'signup', 'cart', 'checkout', 'search']) {
    tastes.push(await ask(agent, hub, question('taste', `Which header colour on the ${screen} page (${round})?`, [['blue', 'Blue header'], ['green', 'Green header']], 'green')));
  }
  const sixth = await ask(agent, hub, question('choice', `Keep the ${round} store on SQLite or plain files?`, [['sqlite', 'SQLite'], ['files', 'Plain files']], 'files'));
  // The exception the sixth raised: an exception ask.created in the session since the fifth ask.
  const fifth = tastes.at(-1)!.log_pos;
  let exception: Ev | undefined;
  for (const until = Date.now() + 10_000; !exception && Date.now() < until; await sleep(200)) {
    exception = (await events(hub)).find((e) => e.kind === 'ask.created' && e.data?.kind === 'exception' && e.session === agent.session && e.log_pos > fifth);
  }
  if (!exception) throw Error(`${AC5}: the sixth open ask from session ${agent.session}, ask:${sixth.id}, raised no exception: the record holds no exception ask.created in the session since the fifth`);
  expect(exception.data.question, `${AC5}: the exception ask:${exception.id} the sixth ask raised says "this session keeps asking"`).toMatch(/keeps asking/i);
  return { tastes: tastes.map((e) => `ask:${e.id}`), sixth, exception };
}

/**
 * Round one: six asks, the sixth inside one exception in `deep inbox`, answered in bulk. Round two: six more, left
 * unanswered with the hub's clock moved past the sixth's own deadline. Every failure is collected, so the base's
 * outcome shows each part, and thrown together at the end; a reading load spoiled is INCONCLUSIVE only when nothing
 * else failed.
 */
export const ac5 = (plant?: string): Promise<void> => tagged(AC5, async () => {
  const proof = new Proof(`${AC5}${plant ? ` on ${plant}` : ''} (redraft-2047)`);
  const failures: string[] = [];
  let spoiled: Inconclusive | undefined;
  const take = (error: unknown): void => {
    if (error instanceof Inconclusive) spoiled = error;
    else failures.push(error instanceof Error ? error.message : String(error));
  };
  const soft = async (check: () => unknown): Promise<void> => {
    try { await check(); } catch (error) { take(error); }
  };
  try {
    await rounds(plant, proof, soft);
  } catch (error) {
    take(error);
  }
  if (failures.length) throw new Error([...failures, ...(spoiled ? [spoiled.message] : [])].map((m) => (m.startsWith(AC5) || m.startsWith(`INCONCLUSIVE ${AC5}`) ? m : `${AC5}: ${m}`)).join('\n'));
  if (spoiled) throw spoiled;
});

/** AC5's two rounds on one hub, each check through `soft` unless what follows needs it. */
async function rounds(plant: string | undefined, proof: Proof, soft: (check: () => unknown) => Promise<void>): Promise<void> {
  let hub: Hub | undefined;
  let stream: Stream | undefined;
  try {
    const w = await world(plant, false);
    hub = w.hub;
    const h = hub;
    await w.agent.initialize();
    stream = await Stream.open(hub, (await inboxRead(hub)).log_pos);

    // Round one: the sixth open ask lands inside one "this session keeps asking" exception in deep inbox.
    const one = await sixAsks(w.agent, hub, 'bulk');
    const sixth = `ask:${one.sixth.id}`;
    const exception = `ask:${one.exception.id}`;
    const text = await inbox(AC5, w.home, proof, 'six open asks from one session');
    const listed = items(text);
    const keeps = listed.filter((item) => /keeps asking/i.test(item[0]!));
    await soft(() => expect(keeps.map((item) => item[0]), `${AC5}: deep inbox shows one exception "this session keeps asking"`).toHaveLength(1));
    await soft(() => expect(keeps.some((item) => item.some((l) => names(l, exception))), `${AC5}: the exception deep inbox shows is ${exception}`).toBe(true));
    const outside = listed.filter((item) => !keeps.includes(item) && names(item[0]!, sixth) && !names(item[0]!, exception) && !/\bfolded\b/i.test(item[0]!));
    await soft(() => expect(outside.map((item) => item[0]), `${AC5}: deep inbox shows the sixth ask ${sixth} inside the exception ${exception}, not as an item of its own: ${JSON.stringify(outside.map((item) => item[0]))}`).toEqual([]));
    for (const taste of one.tastes) {
      await soft(() => expect(listed.some((item) => !keeps.includes(item) && names(item[0]!, taste)), `${AC5}: deep inbox lists ${taste}, one of the first five open asks, as an item of its own`).toBe(true));
    }
    const read = await inboxRead(hub);
    const status = (handle: string): unknown => read.asks.find((r) => r.ask === handle)?.status;
    await soft(() => expect([...one.tastes, sixth].map((handle) => [handle, status(handle) === 'folded']), `${AC5}: the inbox read holds the sixth ask ${sixth} folded, and none of the first five`)
      .toEqual([...one.tastes, sixth].map((handle) => [handle, handle === sixth])));

    // Answering that exception in bulk closes all six.
    const together = (one.exception.data.options as { id: string; label: string }[]).find((o) => /together|bulk|all/i.test(`${o.id} ${o.label}`))?.id;
    if (!together) throw Error(`${AC5}: the exception ${exception} offers no option that answers its asks in bulk: ${JSON.stringify(one.exception.data.options)}`);
    const bulk = await deep(w.home, ['inbox', 'answer', exception, together]);
    proof.ran(`deep inbox answer ${exception} ${together}`, bulk);
    await soft(() => expect(bulk.code, `${AC5}: deep inbox answer ${exception} ${together} exits 0: ${bulk.stdout}${bulk.stderr}`).toBe(0));
    await sleep(500);
    const all = await events(hub);
    for (const [i, handle] of [...one.tastes, sixth].entries()) {
      await soft(() => expect(closings(all, handle).map((e) => [e.kind, e.data.answer]), `${AC5}: answering the exception ${exception} in bulk closes ${handle} once, with its recommended option`)
        .toEqual([['ask.answered', i === 5 ? 'files' : 'green']]));
    }
    const after = await inbox(AC5, w.home, proof, 'after the bulk answer');
    await soft(() => expect([...one.tastes, sixth].filter((handle) => lists(after, handle)), `${AC5}: none of the six asks is left in deep inbox after the bulk answer`).toEqual([]));

    // Round two: six more, nobody answers, and the hub's clock moves past the sixth's own 4-hour deadline.
    const two = await sixAsks(w.agent, hub, 'deadline');
    const folded = `ask:${two.sixth.id}`;
    const deadline = two.sixth.data.deadline as number;
    await soft(() => expect(deadline - two.sixth.ts, `${AC5}: the sixth ask ${folded}, a choice, waits 4 hours`).toBe(4 * HOUR));
    const held = (await inboxRead(hub)).asks.find((r) => r.ask === folded)?.status;
    await soft(() => expect(held, `${AC5}: the inbox read holds the sixth ask ${folded} folded into the exception ask:${two.exception.id}`).toBe('folded'));
    await inbox(AC5, w.home, proof, 'round two: six open asks, left unanswered');
    await soft(async () => {
      const closed = await closedPast(AC5, h, folded, deadline, 'the sixth ask, folded into the exception');
      expect([closed.kind, closed.data.answer], `${AC5}: ask ${folded}, folded, takes its own default, files, at its deadline`).toEqual(['ask.defaulted', 'files']);
      expect(closed.ts, `${AC5}: ask ${folded}'s default comes at its deadline ${iso(deadline)}, never before`).toBeGreaterThanOrEqual(deadline);
    });
    await inbox(AC5, w.home, proof, 'past the sixth ask\'s deadline');
  } finally {
    await proof.close(hub, stream);
    stream?.close();
  }
}
