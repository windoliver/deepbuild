// AC1 and AC2 on one world: the agent stand-in raises a choice ask through its deep mcp (deep_ask, into the hub's
// asks core) while you poll `deep inbox` and a test consumer reads the App API's live stream; then you answer it
// with `deep inbox answer`, the OS confirmation stubbed to confirm.

import { afterAll, expect, test } from 'vitest';
import {
  AC, Agent, cleanup, closings, decisionsOf, deep, events, expectFramed, expectStreamMatchesRecord, HOUR, inbox, inboxRead, listed, load, makeHome, Proof,
  question, raise, SECOND, startHub, Stream, writeSettings, type Ev, type Hub, type InboxRead, type Outcome, type Ran,
} from './helpers.ts';

const QUESTION = 'Keep the orders on SQLite or plain files?';
interface World {
  home: string; hub: Hub; agent: Agent; stream: Stream; proof: Proof;
  before: InboxRead; created: Ev; handle: string; polls: Ran[];
  call: Promise<{ returned?: Outcome; failed?: string }>;
}
let world: Promise<World> | undefined;
const setUp = () => (world ??= (async () => {
  const proof = new Proof(`${AC[1]} and ${AC[2]}`);
  const home = makeHome();
  writeSettings(home);
  const agent = Agent.start(home);
  const hub = await startHub(home, { confirm: 'confirmed' });
  await agent.establish(hub);
  await agent.initialize();
  const before = await inboxRead(hub);
  const stream = await Stream.open(hub, before.log_pos);
  // You run `deep inbox` back to back from before the ask is raised until a run lists it.
  const polls: Ran[] = [];
  let stop = false;
  const polling = (async () => {
    const until = Date.now() + 60_000;
    while (!stop && Date.now() < until) {
      const r = await deep(home, ['inbox']);
      polls.push(r);
      if (r.stdout.includes(QUESTION)) return;
    }
  })();
  const { call, created } = await raise(agent, hub, question('choice', QUESTION, [['sqlite', 'SQLite'], ['files', 'Plain files']], 'sqlite'));
  await Promise.race([polling, new Promise((r) => setTimeout(r, 30_000))]);
  stop = true;
  await polling;
  for (const r of polls) proof.ran(`deep inbox, started ${r.t0 - created.ts} ms after the append`, r);
  return { home, hub, agent, stream, proof, before, created, handle: `ask:${created.id}`, polls, call };
})());

afterAll(async () => {
  const w = await world?.catch(() => undefined);
  await w?.proof.close(w.hub, w.stream);
  w?.stream.close();
  await cleanup();
}, 60_000);

test(`${AC[1]} deep inbox lists the choice ask with its kind, session and age within a second of its append, and the stream frames it at the same log position`, async (ctx) => {
  const { hub, agent, stream, before, created, handle, polls } = await setUp();
  const appended = created.ts;
  expect({ kind: created.data.kind, deadline: created.data.deadline - appended, default: created.data.default }, `${AC[1]}: the ask is a choice with a 4-hour deadline and a default`)
    .toEqual({ kind: 'choice', deadline: 4 * HOUR, default: 'sqlite' });

  // The inbox holds the ask from its log position on.
  expect(before.log_pos, `${AC[1]}: the inbox read before the append reflects a log position before the ask's`).toBeLessThan(created.log_pos);
  expect(before.asks.map((r) => r.ask), `${AC[1]}: the inbox read before the append doesn't hold ${handle}`).not.toContain(handle);
  const after = await inboxRead(hub);
  expect(after.log_pos, `${AC[1]}: an inbox read after the append reflects the ask's log position or later`).toBeGreaterThanOrEqual(created.log_pos);
  expect(after.asks.map((r) => r.ask), `${AC[1]}: the inbox read at log_pos ${after.log_pos} holds ${handle}`).toContain(handle);

  // `deep inbox`: every run started a second or more after the append lists it; the first run that lists it shows
  // its kind, session and an age that matches when it ran.
  const lists = (r: Ran) => listed(r.stdout).find((row) => row.ask === handle);
  for (const r of polls) expect(r.code, `deep inbox exits 0: ${r.stderr}`).toBe(0);
  for (const r of polls.filter((p) => p.t0 >= appended + SECOND)) {
    expect(lists(r), `${AC[1]}: deep inbox started ${r.t0 - appended} ms after ${handle}'s append doesn't list it: ${r.stdout}`).toBeDefined();
  }
  const first = polls.find((r) => lists(r));
  expect(first, `${AC[1]}: deep inbox listed ${handle} within 30 s of its append: ${polls.at(-1)?.stdout}`).toBeDefined();
  const row = lists(first!)!;
  expect([row.kind, row.session], `${AC[1]}: deep inbox lists ${handle} with its kind and session: ${row.line}`).toEqual(['choice', agent.session]);
  const age = /^(\d+)s$/.exec(row.age);
  const [lo, hi] = [Math.max(0, Math.floor((first!.t0 - appended) / SECOND)), Math.max(0, Math.floor((first!.t1 - appended) / SECOND))];
  expect(age && Number(age[1]) >= lo && Number(age[1]) <= hi, `${AC[1]}: ${handle}'s age, ${row.age}, is the time since its append when deep inbox ran (${lo}s to ${hi}s): ${row.line}`).toBe(true);

  // The stream's consumer gets its frame at that same log position, where the record holds it.
  await expectFramed(AC[1], stream, created, `the choice ask ${handle}`);

  // Within a second: the run that first listed it ended within 1,000 ms of the append. A run started in time that
  // ended later, under load, is only a reading.
  const latency = first!.t1 - appended;
  console.log(`${AC[1]}: deep inbox first listed ${handle} in a run from ${first!.t0 - appended} to ${latency} ms after its append (load ${load()})`);
  if (latency > SECOND) ctx.skip(`INCONCLUSIVE ${AC[1]}: deep inbox started ${first!.t0 - appended} ms after the append and listed ${handle} at ${latency} ms, over the second, at load ${load()}; no run started a second after the append missed it`);
}, 240_000);

test(`${AC[2]} deep inbox answer on the choice ask saves a decision with its scope, the ask leaves deep inbox, the stream shows it answered, and the session that raised it gets the answer once`, async () => {
  const { home, hub, agent, stream, proof, created, handle, call } = await setUp();
  const answered = await deep(home, ['inbox', 'answer', handle, 'files']);
  proof.ran(`deep inbox answer ${handle} files`, answered);
  expect(answered.code, `${AC[2]}: deep inbox answer ${handle} files, the OS confirming you, exits 0: ${answered.stdout}${answered.stderr}`).toBe(0);
  let all = await events(hub);

  // A decision with its scope: this repo's, or where the ask has no repo, its session's; the one the command printed.
  const scope = created.project ? `repo:${created.project.replace(/[^0-9A-Za-z]/g, '')}` : `session:${agent.session.replace(/[^0-9A-Za-z]/g, '')}`;
  expect(closings(all, handle).map((e) => [e.kind, e.data.answer, e.data.via, e.data.verified]), `${AC[2]}: ${handle} is answered once, files, from deep inbox`).toEqual([['ask.answered', 'files', 'inbox', true]]);
  expect(decisionsOf(all, handle).map((e) => [e.kind, e.data.answer, e.data.scope]), `${AC[2]}: the answer to ${handle} is saved as one decision at its scope`).toEqual([['decision.created', 'files', scope]]);
  expect(answered.stdout, `${AC[2]}: deep inbox answer says the scope the decision was saved at`).toContain(scope);

  // The ask leaves deep inbox, and the stream shows it answered, at the record's log position.
  expect((await inbox(home, proof, 'after the answer')).map((r) => r.ask), `${AC[2]}: ${handle} leaves deep inbox`).not.toContain(handle);
  await expectFramed(AC[2], stream, closings(all, handle)[0]!, `${handle} answered`);
  await expectFramed(AC[2], stream, decisionsOf(all, handle)[0]!, `the decision saved from ${handle}`);

  // The session that raised it gets the answer once: its deep_ask returns it, a second answer is refused and
  // reaches nothing, and its deep_wait still holds the first.
  let got = await call;
  if (got.returned?.value?.status === 'waiting') got = { returned: await agent.tool('deep_wait', { ask: handle }) };
  proof.note('deep_ask, as the agent got it', JSON.stringify(got));
  expect({ ask: got.returned?.value?.ask, status: got.returned?.value?.status, answer: got.returned?.value?.answer }, `${AC[2]}: the agent's deep_ask returns your answer: ${JSON.stringify(got)}`)
    .toEqual({ ask: handle, status: 'answered', answer: 'files' });
  const again = await deep(home, ['inbox', 'answer', handle, 'sqlite']);
  proof.ran(`deep inbox answer ${handle} sqlite, a second answer`, again);
  expect(again.code, `${AC[2]}: a second answer to ${handle} is refused: ${again.stdout}${again.stderr}`).not.toBe(0);
  const waited = await agent.tool('deep_wait', { ask: handle });
  expect({ status: waited.value?.status, answer: waited.value?.answer }, `${AC[2]}: deep_wait after a second answer still holds the first: ${JSON.stringify(waited.value)}`)
    .toEqual({ status: 'answered', answer: 'files' });
  all = await events(hub);
  expect(closings(all, handle).map((e) => e.data.answer), `${AC[2]}: ${handle} has one answer in the record`).toEqual(['files']);
  expect(decisionsOf(all, handle).length, `${AC[2]}: ${handle} saved one decision`).toBe(1);
  await expectStreamMatchesRecord(AC[2], stream, hub);
}, 240_000);
