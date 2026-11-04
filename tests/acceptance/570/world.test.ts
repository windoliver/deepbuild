// #570 AC3, AC4 and AC5: the enumerator over the small world, `node scripts/lifecycle.mjs world [--tables <dir>]`.
// AC3: "The enumerator reports how many states it reached, and a planted lease table with no move out of held once
// its holder has ended leaves that lease short of a final state, so the enumerator fails, naming the state and the
// path that reached it".
// AC4: "A planted ask table in which an answer and the deadline end in different states by arrival order, with no
// conflict named, fails the enumerator, naming both orders".
// AC5: "A crash at each reachable state, replayed from the log, recovers every object to the same state; a planted
// claim state kept only in memory recovers as pending and fails, naming the claim".
// Each planted table is the real one with one change, in a folder of copies of every table (README: Wrong programs).
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, crashesReplayed, ID, lifecycle, linesOf, OBJECTS, plantTables, problems, publishedKinds, readTable, show, statesReached, type Ran } from './helpers.ts';

afterAll(cleanup);

/** The run over the real tables, once for the file. */
let real: Ran | undefined;
const realRun = (): Ran => (real ??= lifecycle(['world']));

describe(`${ID.enumerator} the enumerator reports how many states it reached; a lease left in held fails it, naming the state and the path`, () => {
  it(`${ID.enumerator} over the real tables, every object of the small world reaches a final state: it reports its state count, walks all eight tables and passes`, () => {
    for (const object of OBJECTS) readTable(object);
    const r = realRun();
    const reached = statesReached(r);
    expect(problems(r, 'world'), `no problem over the real tables\n${show(r)}`).toEqual([]);
    expect(r.status, `exit 0\n${show(r)}`).toBe(0);
    const largest = Math.max(...OBJECTS.map((o) => readTable(o).states.length));
    expect(reached, `the small world has more states than any one table (${largest})\n${show(r)}`).toBeGreaterThan(largest);
    const passes = linesOf(r, ['PASS'], 'world');
    for (const object of OBJECTS) {
      expect(passes.some((l) => l.includes(`${object}.machine@1`)), `a PASS line names ${object}.machine@1: the world walked its objects\n${show(r)}`).toBe(true);
    }
  });

  it(`${ID.enumerator} a planted lease table with no move out of held leaves the lease short of a final state: FAIL names held and the path that reached it`, () => {
    const lease = readTable('lease');
    const into = [...new Set(lease.moves.filter((m) => m.to === 'held').map((m) => m.event))];
    expect(into.length, 'lease.machine@1 has a move into held').toBeGreaterThan(0);
    const dir = plantTables((tables) => {
      const t = tables.get('lease.machine@1.json')!;
      t.moves = t.moves.filter((m) => m.from !== 'held');
    });
    const r = lifecycle(['world', '--tables', dir]);
    expect(r.status, `exit 1\n${show(r)}`).toBe(1);
    statesReached(r);
    const fails = linesOf(r, ['FAIL'], 'world').filter((l) => l.includes('lease.machine@1') && /\bheld\b/.test(l));
    expect(fails.length, `a FAIL line names lease.machine@1 and the state held\n${show(r)}`).toBeGreaterThan(0);
    expect(fails.some((l) => into.some((event) => l.includes(event))), `the FAIL line names the path that reached held: the event that moved the lease there (${into.join(' or ')})\n${show(r)}`).toBe(true);
  });
});

describe(`${ID.orders} an ask table whose answer and deadline end apart by arrival order, with no conflict named, fails the enumerator, naming both orders`, () => {
  it(`${ID.orders} the real ask table names the answer and the deadline's conflict, and the enumerator passes it`, () => {
    const ask = readTable('ask');
    const named = (ask.conflicts ?? []).filter((c) => typeof c.name === 'string' && c.name.length > 0 && Array.isArray(c.events)
      && c.events.includes('ask.answered') && c.events.includes('ask.defaulted'));
    expect(named.length, `ask.machine@1 names the conflict of ask.answered and ask.defaulted: ${JSON.stringify(ask.conflicts)}`).toBe(1);
    const r = realRun();
    expect(problems(r, 'world').filter((l) => l.includes('ask.machine@1')), `no problem names ask.machine@1\n${show(r)}`).toEqual([]);
  });

  it(`${ID.orders} a planted ask table with the conflict taken away fails the enumerator, naming both orders`, () => {
    readTable('ask');
    const dir = plantTables((tables) => { delete tables.get('ask.machine@1.json')!.conflicts; });
    const r = lifecycle(['world', '--tables', dir]);
    expect(r.status, `exit 1\n${show(r)}`).toBe(1);
    const fails = linesOf(r, ['FAIL'], 'world').filter((l) => l.includes('ask.machine@1'));
    expect(fails.length, `a FAIL line names ask.machine@1\n${show(r)}`).toBeGreaterThan(0);
    const both = fails.filter((l) => /ask\.answered.*ask\.defaulted/.test(l) && /ask\.defaulted.*ask\.answered/.test(l));
    expect(both.length, `one FAIL line names both orders: ask.answered then ask.defaulted, and ask.defaulted then ask.answered\n${show(r)}`).toBeGreaterThan(0);
  });
});

describe(`${ID.crash} a crash at each reachable state recovers every object from the log; a claim state kept only in memory recovers as pending and fails`, () => {
  it(`${ID.crash} over the real tables, a crash at each reachable state replays from the log to the same state`, () => {
    for (const object of OBJECTS) readTable(object);
    const r = realRun();
    const reached = statesReached(r);
    const crashes = crashesReplayed(r);
    expect(crashes, `a crash at each reachable state: at least ${reached}\n${show(r)}`).toBeGreaterThanOrEqual(reached);
    expect(problems(r, 'world'), `every crash recovers\n${show(r)}`).toEqual([]);
    expect(r.status, show(r)).toBe(0);
  });

  it(`${ID.crash} a planted claim whose move out of pending is kept only in memory recovers as pending, and the enumerator fails, naming the claim`, () => {
    const claim = readTable('claim');
    expect(claim.moves.some((m) => m.from === 'pending'), 'claim.machine@1 has a move out of pending').toBe(true);
    const memory = 'claim.kept_in_memory';
    expect(publishedKinds().has(memory), `${memory} is no published event kind, so the log never holds it`).toBe(false);
    const dir = plantTables((tables) => {
      for (const m of tables.get('claim.machine@1.json')!.moves) if (m.from === 'pending') m.event = memory;
    });
    const r = lifecycle(['world', '--tables', dir]);
    expect(r.status, `exit 1\n${show(r)}`).toBe(1);
    const fails = linesOf(r, ['FAIL'], 'world').filter((l) => l.includes('claim.machine@1') && /\bpending\b/.test(l));
    expect(fails.length, `a FAIL line names the claim (claim.machine@1) and pending, the state it recovered as\n${show(r)}`).toBeGreaterThan(0);
  });
});
