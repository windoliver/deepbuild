#!/usr/bin/env node
// #3539: when does the hub's `turnEnded` return at a green stop whose slow checks find no slot free? stop-reply.ts
// awaits it before it returns the stop's reply, so that is when the reply can go.
//
//   node docs/spikes/3539/reply-hold.mjs --runs <n> --out <file>
//
// Main's own parts, loaded from source: the hub's gate runner (`GateRunner`), the record and the lease table opened
// at 4 cores (a `cpu.slot` pool of 2, of which slow runs hold at most 1), and the gate package's `admit`, the wait
// for a slot that runs.ts's `launch` makes before a run starts. What stands in is the run itself: it starts when
// `admit` grants its slot and ends when this script says, so no time is read from a clock; the order of what
// happened is the reading. Each of the <n> runs, on a record and a table of its own:
//
//   1. `other`, a session nobody types in, stops green with two slow checks. One starts; one waits for the slot.
//   2. `person`, a session a person is at, stops green with two slow checks. Both wait.
//   3. The running check is ended, and then each one that starts, until all four have run.
//
// After 1 and after 2 the script waits until the lease table has refused each waiting run three times, then reads
// whether that stop's `turnEnded` has returned. --out gets each run's events in order and those readings. Which
// waiting run the table grants a freed slot is decided by when each one's poll lands, so the order the four start in
// can differ from run to run; `started_as_asked` counts the runs in which it was the order they asked in.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kept, source } from './load.mjs';

const runs = Number(process.argv[3]);
if (process.argv.length !== 6 || process.argv[2] !== '--runs' || !Number.isInteger(runs) || runs < 1 || process.argv[4] !== '--out') { console.error('Usage: node docs/spikes/3539/reply-hold.mjs --runs <n> --out <file>'); process.exit(2); }
const { GateRunner } = await source('packages/hub/src/gate-runner.ts');
const { openRecord, ulid } = await source('packages/record/src/index.ts');
const { openLeases } = await source('packages/leases/src/index.ts');
const { admit } = await source('packages/gate/src/index.ts');

const CHECKS = { other: ['other:first', 'other:second'], person: ['person:first', 'person:second'] };
const all = [...CHECKS.other, ...CHECKS.person];

async function once() {
  const dir = realpathSync(mkdtempSync('/tmp/dh3539-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const table = await openLeases({ record, now: Date.now, cores: 4 });
  const events = [];
  const note = (what, more = {}) => { events.push({ n: events.length + 1, what, ...more }); };

  // Every refusal the lease table gives a run that asks for a slot, counted: a run refused three times is waiting.
  const refused = new Map();
  const watchers = new Set();
  const ask = table.ask.bind(table);
  table.ask = async (caller, asks) => {
    const got = await ask(caller, asks);
    if (got.status !== 'granted') {
      refused.set(caller.run, (refused.get(caller.run) ?? 0) + 1);
      for (const watch of [...watchers]) watch();
    }
    return got;
  };
  const refusedThrice = (checks) => new Promise((done) => {
    const from = new Map(checks.map((check) => [check, refused.get(runOf.get(check)) ?? 0]));
    const watch = () => { if (checks.every((check) => (refused.get(runOf.get(check)) ?? 0) >= from.get(check) + 3)) { watchers.delete(watch); done(); } };
    watchers.add(watch);
  });

  const live = new Map();
  const runOf = new Map();
  const holders = new Map();
  const asked = new Map();
  const started = new Map();
  let n = 0;
  const name = (cwd) => cwd.split('/').at(-1);
  const checkouts = {
    budget: () => ({ since: 0 }),
    snapshot: async (cwd) => ({ commit: `${name(cwd)}-1`, tree: `tree:${name(cwd)}-1`, wrote: true }),
    checkout: async ({ commit }) => ({ dir: `/nonexistent-3539/checkouts/${commit}`, commit }),
    ended: async () => undefined,
  };
  const gate = new GateRunner({
    raw: async () => [], now: Date.now, append: async () => undefined, core: { writer: 'core', actor: 'you', scope: 'you' },
    // As runs.ts's launch: the run's slot first, from the lease table, as its claim's session and in its lane.
    start: async (r) => {
      const run = `run:${ulid(Date.now())}${(++n).toString(36).toUpperCase()}`;
      runOf.set(r.check, run);
      note('asks for a slot', { check: r.check });
      asked.get(r.check)?.();
      const leases = await admit(table, holders.get(r.claim), run, r.lane);
      let end;
      const done = new Promise((resolve) => { end = resolve; });
      live.set(r.check, { done, end: async () => { for (const lease of leases) await table.release(lease.id, []); live.delete(r.check); note('ends', { check: r.check }); end('passed'); } });
      note('starts', { check: r.check });
      started.get(r.check)?.();
      return run;
    },
    ended: (run) => [...live.entries()].find(([check]) => runOf.get(check) === run)?.[1].done ?? Promise.resolve('missing'),
    // As core.ts: the pool less the runs that hold a slot.
    slots: () => ({ free: Math.max(0, 2 - live.size) }),
    budget_ms: 10_000, hold_ms: 60_000, checkouts: () => checkouts, invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
  });
  const check = (id) => ({ check: id, approved: null, command: `sh ${id}`, covers: ['R1'], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 60_000 });
  const returned = new Set();
  async function stop(session, origin, checks) {
    const claim = `claim:${ulid(Date.now())}`;
    holders.set(claim, `session:${ulid(Date.now())}`);
    await gate.stop({ session, claim, task: `task:${session}`, cwd: `/nonexistent-3539/worktrees/${session}`, base: 'base', requirements: [], checks: checks.map(check), stopAt: Date.now() });
    note('green stop: its fast lane has ended, turnEnded is called', { session });
    return gate.turnEnded(claim, [], Date.now(), { session, origin, due: null, starter: null }).then(() => { returned.add(session); note('turnEnded returned', { session }); });
  }

  const starts = Object.fromEntries(all.map((id) => [id, new Promise((done) => { started.set(id, done); })]));
  const asks = Object.fromEntries(all.map((id) => [id, new Promise((done) => { asked.set(id, done); })]));
  const readings = {};
  try {
    const other = stop('other', 'scheduled', CHECKS.other);
    await starts['other:first'];
    await asks['other:second'];
    await refusedThrice(['other:second']);
    readings.other_turn_end_returned_while_its_second_check_waited = returned.has('other');
    note("the lease table has refused other:second three times; other's turnEnded has returned", { is: returned.has('other') });
    const person = stop('person', 'person', CHECKS.person);
    await Promise.all([asks['person:first'], asks['person:second']]);
    await refusedThrice(['other:second', 'person:first', 'person:second']);
    readings.person_turn_end_returned_while_its_checks_waited = returned.has('person');
    note("the lease table has refused each of the three waiting runs three times more; the person's turnEnded has returned", { is: returned.has('person') });
    // Each run that holds the slot is ended once it has started; the next to start is whichever the table grants.
    const pending = new Set(all);
    for (let running = 'other:first'; pending.size;) {
      pending.delete(running);
      const next = pending.size ? Promise.race([...pending].map((id) => starts[id].then(() => id))) : null;
      await live.get(running).end();
      if (!next) break;
      running = await next;
    }
    await Promise.all([other, person]);
    const at = (what, key, value) => events.find((e) => e.what === what && e[key] === value).n;
    readings.asked_in_order = events.filter((e) => e.what === 'asks for a slot').map((e) => e.check);
    readings.started_in_order = events.filter((e) => e.what === 'starts').map((e) => e.check);
    readings.other_turn_end_returned_once_its_second_check_started = at('turnEnded returned', 'session', 'other') > at('starts', 'check', 'other:second');
    readings.person_turn_end_returned_once_its_second_check_started = at('turnEnded returned', 'session', 'person') > at('starts', 'check', 'person:second');
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
  return { readings, events };
}

const taken = [];
for (let k = 0; k < runs; k++) taken.push(await once());
const count = (of) => taken.filter((run) => of(run.readings)).length;
writeFileSync(process.argv[5], `${kept({
  date: new Date().toISOString(), node: process.version, pool: 2, slow_runs_at_once: 1, runs,
  other_turn_end_returned_while_its_second_check_waited: count((r) => r.other_turn_end_returned_while_its_second_check_waited),
  person_turn_end_returned_while_its_checks_waited: count((r) => r.person_turn_end_returned_while_its_checks_waited),
  other_turn_end_returned_once_its_second_check_started: count((r) => r.other_turn_end_returned_once_its_second_check_started),
  person_turn_end_returned_once_its_second_check_started: count((r) => r.person_turn_end_returned_once_its_second_check_started),
  started_as_asked: count((r) => r.started_in_order.join() === r.asked_in_order.join()),
  started_orders: [...new Set(taken.map((run) => run.readings.started_in_order.join(', ')))].map((order) => ({ order, runs: taken.filter((run) => run.readings.started_in_order.join(', ') === order).length })),
  taken,
})}\n`);
