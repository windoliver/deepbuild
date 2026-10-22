// The ledger's rules beyond #86's acceptance suite: each yes holds room for the run it was asked for, a yes
// to re-run failed inputs covers one run, every ledger on a record decides in one queue, a run that didn't
// pass counts as failed, and no agent approves, charges or answers for you.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { openAsks, type Asks } from '@deepbuild/asks';
import { openRecord, type Connection, type RecordStore } from '@deepbuild/record';
import { BudgetRefused, openLedger, type Ledger, type Outcome, type RunRequest } from '../src/index.js';

const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 86_400_000;
const who = { actor: 'you', scope: 'you' };
const core: Connection = { writer: 'core', ...who };
const card: Connection = { writer: 'app', ...who };
const agent: Connection = { writer: 'mcp:s1', ...who, session: 's1' };
const ISSUE = 'windoliver/deepbuild#41';
const CHECK = 'live.checkout-call';

let n = 0;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const runId = (): string => {
  let tail = '';
  for (let k = ++n, i = 0; i < 16; i++, k = Math.floor(k / 32)) tail = CROCKFORD[k % 32] + tail;
  return `run:01K74G0000${tail}`;
};
const inputs = (text: string): string => createHash('sha256').update(text).digest('hex');
const run = (text: string, issue = ISSUE): RunRequest => ({ run: runId(), check: CHECK, inputs: inputs(text), issue });

let dir: string;
let record: RecordStore;
let asks: Asks;
let ledger: Ledger;
let clock = T0;
const now = (): number => clock;
const price = async (): Promise<number> => 3;

beforeEach(async () => {
  clock = T0;
  dir = mkdtempSync(join(tmpdir(), 'deep-budget-'));
  record = await openRecord({ path: join(dir, 'record.db'), now });
  asks = await openAsks({ record, now, deliver: () => undefined });
  ledger = await openLedger({ record, asks, now, price });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The same record behind another object: a ledger on it folds the log afresh. */
const wrap = (store: RecordStore): RecordStore => ({
  append: (connection, event) => store.append(connection, event),
  read: (query) => store.read(query),
  table: (name) => store.table(name),
  session: (id) => store.session(id),
  rebuild: () => store.rebuild(),
  raw: (sql) => store.raw(sql),
  sync: () => store.sync(),
  startSlice: (id) => store.startSlice(id),
  rollBack: (connection, what) => store.rollBack(connection, what),
  close: () => store.close(),
});
const approve = (cap: number): Promise<string> => ledger.approve(card, { scope: { kind: 'issue', ref: ISSUE }, cap_usd: cap, ends: T0 + 30 * DAY });
const askOf = (o: Outcome): string => (o as { ask: string }).ask;
const yes = (ask: string): Promise<void> => asks.answer(card, ask, { option: 'approve', token: `click-${ask}` });
const finished = async (r: RunRequest, outcome: string): Promise<void> => {
  await record.append(core, {
    v: 1, id: runId().slice(4), kind: 'run.finished', subject: r.run, ts: T0,
    data: { run: r.run, outcome, tests_run: 1, passed: 0, runs: 1, evidence: [], check: CHECK, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'local' },
  });
};

it('your yes to each of two runs no budget covers starts each, and covers no other run', async () => {
  const [a, b] = [run('a', 'windoliver/deepbuild#77'), run('b', 'windoliver/deepbuild#77')];
  const [oa, ob] = [await ledger.request(core, a), await ledger.request(core, b)];
  await yes(askOf(oa));
  await yes(askOf(ob));
  expect((await ledger.request(core, a)).status).toBe('started');
  expect((await ledger.request(core, b)).status).toBe('started');
  expect((await ledger.request(core, run('c', 'windoliver/deepbuild#77'))).status, 'a run you never said yes to').toBe('asked');
});

it('your yes to two raises on one budget starts both runs', async () => {
  const budget = await approve(5);
  expect((await ledger.request(core, run('a'))).status).toBe('started');
  const [b, c] = [run('b'), run('c')];
  const [ob, oc] = [await ledger.request(core, b), await ledger.request(core, c)];
  expect([ob.status, oc.status]).toEqual(['BLOCKED', 'BLOCKED']);
  await yes(askOf(ob));
  await yes(askOf(oc));
  expect((await ledger.request(core, b)).status).toBe('started');
  expect((await ledger.request(core, c)).status).toBe('started');
  const view = await ledger.budget(budget);
  expect(view.reserved_usd).toBeLessThanOrEqual(view.cap_usd);
});

it('the room your yes to a raise adds is held for its run: another run that asks first is BLOCKED', async () => {
  const budget = await approve(5);
  expect((await ledger.request(core, run('a'))).status).toBe('started');
  const b = run('b');
  const blocked = await ledger.request(core, b);
  await yes(askOf(blocked));
  expect(await ledger.request(agent, run('c')), 'a run you never said yes to').toMatchObject({ status: 'BLOCKED', cause: 'budget', budget });
  expect(await ledger.request(core, b)).toMatchObject({ status: 'started', reserved: [{ budget, usd: 3 }] });
  expect(await ledger.budget(budget)).toMatchObject({ cap_usd: 8, reserved_usd: 6, left_usd: 2 });
});

it('one raise asks for every covering budget without room, and your yes starts the run', async () => {
  const issue = await approve(2);
  const gpu = await ledger.approve(card, { scope: { kind: 'resource', ref: 'local/gpu/0' }, cap_usd: 1, ends: T0 + 30 * DAY });
  const r = { ...run('a'), resource: 'local/gpu/0' };
  const blocked = await ledger.request(core, r);
  expect(blocked).toMatchObject({ status: 'BLOCKED', cause: 'budget' });
  await yes(askOf(blocked));
  expect(await ledger.request(core, r)).toMatchObject({ status: 'started' });
  expect([(await ledger.budget(issue)).left_usd, (await ledger.budget(gpu)).left_usd]).toEqual([2, 1]);
});

it('a yes to re-run failed inputs covers one run, and a run that overran counts as failed', async () => {
  await approve(100);
  for (const outcome of ['failed', 'overran', 'stopped']) {
    const first = run(outcome);
    expect((await ledger.request(core, first)).status).toBe('started');
    await finished(first, outcome);
    const asked = await ledger.request(core, run(outcome));
    expect(asked.status, `after a paid run that ${outcome}`).toBe('asked');
    await yes(askOf(asked));
    expect((await ledger.request(agent, run(outcome))).status).toBe('started');
    expect((await ledger.request(agent, run(outcome))).status, 'a second re-run on the one yes').toBe('asked');
  }
});

it('a yes to re-run failed inputs is for its issue and resource: the same inputs elsewhere still ask, and use no yes', async () => {
  await approve(100);
  const other = 'windoliver/deepbuild#77';
  await ledger.approve(card, { scope: { kind: 'issue', ref: other }, cap_usd: 100, ends: T0 + 30 * DAY });
  const first = run('a');
  expect((await ledger.request(core, first)).status).toBe('started');
  await finished(first, 'failed');
  await yes(askOf(await ledger.request(core, run('a'))));
  expect((await ledger.request(agent, run('a', other))).status, 'on another issue').toBe('asked');
  expect((await ledger.request(agent, { ...run('a'), resource: 'local/gpu/0' })).status, 'on a resource').toBe('asked');
  expect((await ledger.request(agent, run('a'))).status, 'where you said yes').toBe('started');
});

it('two ledgers on one record never reserve past its cap', async () => {
  const budget = await approve(3);
  const other = await openLedger({ record, asks, now, price });
  const outcomes = await Promise.all([ledger.request(core, run('a')), other.request(core, run('b'))]);
  expect(outcomes.map((o) => o.status).sort()).toEqual(['BLOCKED', 'started']);
  expect((await other.budget(budget)).left_usd).toBe(0);
});

it('a cost reading past the reservation is spent in full, and the next run that no longer fits is BLOCKED', async () => {
  const budget = await approve(10);
  const first = run('a');
  await ledger.request(core, first);
  await ledger.charge(core, first.run, 9);
  expect(await ledger.budget(budget)).toMatchObject({ spent_usd: 9, reserved_usd: 0, left_usd: 1 });
  expect(await ledger.request(core, run('b'))).toMatchObject({ status: 'BLOCKED', cause: 'budget', budget });
});

it("a resolver's answer whose reservation failed to append strands no money, and its retry, past the ask's deadline and in a reopened ledger, starts the run", async () => {
  let failOnce = true;
  const flaky: RecordStore = {
    ...wrap(record),
    append: async (connection, event) => {
      if (event.kind === 'spend.reserved' && failOnce) {
        failOnce = false;
        throw new Error('storage refused the write');
      }
      return record.append(connection, event);
    },
  };
  const resolving = await openLedger({ record: flaky, asks, now, price });
  const work = await resolving.approve(card, { scope: { kind: 'work', ref: 'paid-checks' }, cap_usd: 10, ends: T0 + 3 * DAY });
  const asked = await resolving.request(core, run('a', 'windoliver/deepbuild#77'));
  const answer = { decision: 'decision:01K74G0000000000000000000Z', budget: work };
  await expect(resolving.resolve({ writer: 'ext:resolver-decisions', ...who }, askOf(asked), answer)).rejects.toThrow('storage refused');
  expect((await resolving.budget(work)).reserved_usd, 'nothing held for a run that never heard it may start').toBe(0);
  clock = T0 + 2 * DAY;
  await asks.tick();
  const reopened = await openLedger({ record: wrap(record), asks, now, price });
  for (const decision of ['decision:01K74G0000000000000000001Z', 'not a decision']) {
    await expect(reopened.resolve({ writer: 'ext:resolver-decisions', ...who }, askOf(asked), { ...answer, decision }), `a retry naming ${decision}`).rejects.toBeInstanceOf(BudgetRefused);
  }
  expect(await reopened.resolve({ writer: 'ext:resolver-decisions', ...who }, askOf(asked), answer)).toMatchObject({ status: 'started', reserved: [{ budget: work, usd: 3 }] });
  expect(await reopened.resolve({ writer: 'ext:resolver-decisions', ...who }, askOf(asked), answer), 'sent once more').toMatchObject({ status: 'started' });
  expect((await reopened.budget(work)).reserved_usd).toBe(3);
  expect((await record.read({ after: 0, limit: 1000 })).filter((e) => e.kind === 'decision.applied' || e.kind === 'ask.defaulted').map((e) => e.kind)).toEqual(['decision.applied']);
  expect((await record.table('asks')).rows.find((r) => `ask:${String(r.id)}` === askOf(asked))?.outcome).toBe('decided_for_you');
});

it("a resolver's committed answer, sent again to a reopened ledger, reports its start and appends nothing", async () => {
  const resolver: Connection = { writer: 'ext:resolver-decisions', ...who };
  const work = await ledger.approve(card, { scope: { kind: 'work', ref: 'paid-checks' }, cap_usd: 10, ends: T0 + DAY });
  const asked = await ledger.request(core, run('a', 'windoliver/deepbuild#77'));
  const answer = { decision: 'decision:01K74G0000000000000000000Z', budget: work };
  const first = await ledger.resolve(resolver, askOf(asked), answer);
  const logged = (await record.read({ after: 0, limit: 1000 })).length;
  const reopened = await openLedger({ record: wrap(record), asks, now, price });
  expect(await reopened.resolve(resolver, askOf(asked), answer)).toEqual(first);
  expect((await record.read({ after: 0, limit: 1000 })).length).toBe(logged);
  await expect(reopened.resolve(resolver, askOf(asked), { ...answer, decision: 'decision:01K74G0000000000000000001Z' })).rejects.toBeInstanceOf(BudgetRefused);
});

it('your yes, landing before the ledger records what the ask means, still starts the run, here and in a reopened ledger', async () => {
  // You answer the ask the moment it shows, before the ledger appends its spend.asked.
  const quick: Asks = {
    raise: async (connection, source, ask, plan) => {
      const handle = await asks.raise(connection, source, ask, plan);
      await yes(handle);
      return handle;
    },
    answer: (connection, ask, input) => asks.answer(connection, ask, input),
    tick: () => asks.tick(),
    card: (ask) => asks.card(ask),
    needsYou: () => asks.needsYou(),
    holds: (session, step) => asks.holds(session, step),
    authorized: (ask, hash) => asks.authorized(ask, hash),
  };
  const answering = await openLedger({ record, asks: quick, now, price });
  const r = run('a', 'windoliver/deepbuild#77');
  expect((await answering.request(core, r)).status).toBe('asked');
  expect((await answering.request(core, r)).status).toBe('started');
  const later = run('b', 'windoliver/deepbuild#77');
  expect((await answering.request(core, later)).status).toBe('asked');
  const reopened = await openLedger({ record: wrap(record), asks, now, price });
  expect((await reopened.request(core, later)).status).toBe('started');
});

it('a price too small for a micro-dollar still needs room, and a price in cents fits a cap of the same cents', async () => {
  // 4.03 and 2.01 scale to just above and just below their micro-dollars in floating point.
  const prices: Record<string, number> = { tiny: 0.0000004, above: 4.03, below: 2.01 };
  const exact = await openLedger({ record: wrap(record), asks, now, price: async (r) => prices[r.check]! });
  const none = await exact.approve(card, { scope: { kind: 'issue', ref: 'windoliver/deepbuild#50' }, cap_usd: 0, ends: T0 + DAY });
  expect(await exact.request(core, { ...run('t', 'windoliver/deepbuild#50'), check: 'tiny' })).toMatchObject({ status: 'BLOCKED', cause: 'budget', budget: none });
  for (const [check, issue] of [['above', 'windoliver/deepbuild#51'], ['below', 'windoliver/deepbuild#52']] as const) {
    const budget = await exact.approve(card, { scope: { kind: 'issue', ref: issue }, cap_usd: prices[check]!, ends: T0 + DAY });
    expect((await exact.request(core, { ...run(check, issue), check })).status, `a $${prices[check]} run against a $${prices[check]} cap`).toBe('started');
    expect((await exact.budget(budget)).left_usd).toBe(0);
  }
});

it("no agent approves a budget, only the core lands a cost reading, and only resolver-decisions answers for you", async () => {
  const budget = await approve(10);
  await expect(ledger.approve(agent, { scope: { kind: 'issue', ref: ISSUE }, cap_usd: 99, ends: T0 + DAY })).rejects.toBeInstanceOf(BudgetRefused);
  const started = run('a');
  await ledger.request(core, started);
  for (const writer of ['mcp:s1', 'hook', 'app', 'ext:planted-charges']) {
    await expect(ledger.charge({ writer, ...who }, started.run, 0), writer).rejects.toMatchObject({ run: started.run });
  }
  expect((await ledger.budget(budget)).reservations, 'the reservation holds until the core lands its cost reading').toEqual([{ run: started.run, usd: 3 }]);
  const asked = await ledger.request(core, run('b', 'windoliver/deepbuild#77'));
  const work = await ledger.approve(card, { scope: { kind: 'work', ref: 'paid-checks' }, cap_usd: 10, ends: T0 + DAY });
  for (const writer of ['mcp:s1', 'hook', 'app', 'cli', 'core', 'ext:planted-charges']) {
    await expect(ledger.resolve({ writer, ...who }, askOf(asked), { decision: 'decision:01K74G0000000000000000000Z', budget: work }), writer).rejects.toBeInstanceOf(BudgetRefused);
  }
  expect((await ledger.budget(work)).reserved_usd, 'only resolver-decisions answers for you').toBe(0);
});
