// #2646.98036aec: on a record of 200,000 events with one live session of 20,000 events holding three undelivered asks,
// the ask check's query plan names the partial index, the check retires at most a fifth of the merge base's
// instructions, and it returns the rows the merge base returns.
//   DEEP_2646_BASE=<built merge base> node --test tests/acceptance/2646/ask-check.test.mjs
// The ask check is the read each side's own hub makes: a hub of that checkout starts on a fresh home with its reads log
// on, and the check is the raw read of `asks` in that log that names the kinds session.start and session.end. Each
// side's record is seeded and opened by that side's @deepbuild/record (probe.mjs), so the change's holds whatever index
// the change gives a new record. The plan is EXPLAIN QUERY PLAN of the check on the record's file, opened read-only.
// Instructions are the reading process's own, over 20 runs of the check through the record's raw(), in 20 pairs that
// alternate which side goes first, after one warm-up pair.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BASE, CHANGE, counter, judgeShare, probe, rawOf, readsOf, remove, sidesProblem, sqlite, startHub, stopHub, tempHome, until } from './lib.mjs';

const ROUNDS = 20, RUNS = 20;

/** The ask check as `checkout`'s hub reads it: { sql, params }. */
async function askCheck(checkout) {
  const home = tempHome(), reads = join(home, 'reads.jsonl');
  let hub;
  try {
    hub = await startHub(checkout, home, { DEEP_HUB_TEST_READS: reads });
    const found = () => readsOf(reads).filter((entry) => entry.via === 'raw').map(rawOf).find(({ sql }) => /\bfrom\s+asks\b/i.test(sql) && sql.includes("'session.start'") && sql.includes("'session.end'"));
    return await until(found, 120_000, () => `BLOCKED: the reads log of ${checkout}'s hub holds no ask check within 120 s of its start: no raw read of asks that names session.start and session.end, among ${readsOf(reads).length} reads`);
  } finally {
    if (hub) await stopHub(hub);
    remove(home);
  }
}
/** The check's plan on a seeded record, and the record's indexes on events. */
function planned(dir, { sql, params }) {
  const db = sqlite(join(dir, 'ledger.db'));
  try {
    return {
      plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => row.detail),
      indexes: db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'events' AND sql IS NOT NULL").all(),
    };
  } finally {
    db.close();
  }
}
/** An index on events (session_id, log_pos) that holds only the two session-bound kinds, whatever its name. */
function boundsOnly({ sql }) {
  const text = sql.replace(/["`[\]]/g, '').replace(/\s+/g, ' ');
  const [, where] = /\bON events ?\( ?session_id ?, ?log_pos ?\) ?WHERE (.+)$/i.exec(text) ?? [];
  const kinds = [...(where ?? '').matchAll(/'([^']*)'/g)].map(([, kind]) => kind).sort();
  return /\bkind\b/i.test(where ?? '') && kinds.join(' ') === 'session.end session.start';
}
const indexesIn = (plan) => plan.flatMap((line) => [...line.matchAll(/USING (?:COVERING )?INDEX (\S+)/g)].map(([, name]) => name));

describe('the judgement fails a wrong count and never passes a missing one', () => {
  const pairs = (share) => Array.from({ length: 20 }, (_, i) => ({ base: 3e9 + i * 1e6, change: Math.round(share * (3e9 + i * 1e6)) }));
  it('a fifth means a fifth: 21% fails, 19% passes, and a missing count or too few pairs is INCONCLUSIVE', () => {
    assert.equal(judgeShare(pairs(0.21), 0.2).status, 'FAIL');
    assert.equal(judgeShare(pairs(0.19), 0.2).status, 'PASS');
    assert.equal(judgeShare([...pairs(0.05).slice(1), { base: 3e9, change: null }], 0.2).status, 'INCONCLUSIVE');
    assert.equal(judgeShare(pairs(0.05).slice(0, 19), 0.2).status, 'INCONCLUSIVE');
    assert.equal(judgeShare([], 0.2).status, 'INCONCLUSIVE');
  });
});

describe('#2646 the ask check', { timeout: 3_600_000 }, () => {
  it('#2646.98036aec on a record of 200,000 events with one live session of 20,000 events holding three undelivered asks, the ask check\'s plan names the partial index, it returns the merge base\'s rows, and it retires at most a fifth of the merge base\'s instructions', async () => {
    const blocked = sidesProblem();
    if (blocked) assert.fail(blocked);
    const sides = {};
    try {
      for (const [side, checkout] of [['base', BASE], ['change', CHANGE]]) {
        const check = await askCheck(checkout);
        const dir = tempHome();
        sides[side] = { checkout, check, dir };
        const seeded = await probe(checkout, 'seed-asking', { dir });
        if (seeded.events !== 200_000 || seeded.liveEvents !== 20_000 || seeded.asks.length !== 3 || seeded.sessions !== 300 || seeded.ended !== 299 || seeded.open !== 1003) assert.fail(`BLOCKED: the ${side}'s record isn't the fixture: ${JSON.stringify({ ...seeded, asks: seeded.asks.length })}; it wants 200,000 events, 300 sessions, 299 of them ended, the live one with 20,000 events and 3 of 1,003 open asks`);
        Object.assign(sides[side], { seeded, ...planned(dir, check) });
      }
      const { base, change } = sides;

      // The plan. On the merge base it names events_session, and this fails, showing the plan.
      const partial = change.indexes.filter(boundsOnly).map(({ name }) => name);
      const named = indexesIn(change.plan).filter((name) => partial.includes(name));
      assert.ok(named.length > 0, `the ask check's query plan names no partial index on events (session_id, log_pos) for the kinds session.start and session.end${partial.length ? ` (the record has ${partial.join(', ')})` : ' (the record has none)'}. The plan:\n${change.plan.join('\n')}\nof the check: ${change.check.sql}`);
      assert.ok(indexesIn(base.plan).includes('events_session'), `BLOCKED: the merge base's plan doesn't name events_session, so it isn't the program the criterion compares with. Its plan:\n${base.plan.join('\n')}`);

      // The rows, each side's check on its own record: the three asks of the live session.
      const once = (side, rusage) => probe(side.checkout, 'ask-check', { dir: side.dir, sql: side.check.sql, params: side.check.params, rusage, runs: RUNS });
      const baseRows = (await once(base, null)).rows, changeRows = (await once(change, null)).rows;
      if (JSON.stringify(baseRows.map((row) => row.id).sort()) !== JSON.stringify([...base.seeded.asks].sort())) assert.fail(`BLOCKED: on the merge base the check doesn't return the live session's three asks, so the fixture isn't the criterion's: ${JSON.stringify(baseRows).slice(0, 600)}`);
      assert.deepEqual(changeRows, baseRows, 'the ask check returns other rows than the merge base\'s');

      // The instructions, judged over alternated pairs as the design judges a count.
      const count = counter();
      if (count.blocked) assert.fail(count.blocked);
      const pairs = [];
      for (let round = 0; round <= ROUNDS; round++) {
        const pair = {};
        for (const side of round % 2 ? ['change', 'base'] : ['base', 'change']) pair[side] = (await once(sides[side], count.bin)).instructions;
        if (round) pairs.push(pair);
      }
      const verdict = judgeShare(pairs, 0.2);
      assert.equal(verdict.status, 'PASS', `${verdict.status}: over ${RUNS} runs of the ask check a pair, ${verdict.reason}\n${JSON.stringify(pairs)}`);
    } finally {
      for (const side of Object.values(sides)) remove(side.dir);
    }
  });
});
