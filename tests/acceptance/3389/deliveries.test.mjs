// #3389.c1bfb4a2: the first pass of a hub's start reads delivery.outcome as often on a record of 80 sessions that each
// hold an answer whose delivery timed out as on one of 20, each read through the index on the delivery it names, and each
// session's row says its words didn't reach it, from the newest outcome of its delivery. A record with no such index, as
// the merge base makes one, has it after its next open.
//   node --test tests/acceptance/3389/deliveries.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CHANGE, endedSession, HOUR, ledgerOf, listed, quiet, rawOf, readsOf, remove, seed, sessionId, sqlite, startHub, stopHub, tempHome, unbuilt } from './lib.mjs';

/** The indexes the merge base's record makes on `events` (packages/record/src/index.ts at 1f6fd2dcd), but SQLite's own. */
const BASE_INDEXES = ['events_session', 'events_session_bounds', 'events_kind', 'events_session_gone', 'events_run_key', 'events_run_stem', 'events_reading'];
const indexes = (db) => db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").all();
/** The index on the delivery an outcome names, by its data's field or its subject: one the merge base doesn't make. */
const onDelivery = (db) => indexes(db).filter((i) => !BASE_INDEXES.includes(i.name) && /\$\.delivery\b|\bsubject\b/.test(i.sql ?? ''));

/** A choice one session raised, answered by you, whose delivery stalled and then timed out: its ask, and when each outcome came. */
async function undelivered(add, session, at) {
  const key = createHash('sha256').update(`header for ${session}`).digest('hex');
  const on = { kind: 'evidence', ref: key };
  const ask = await add('ask.created', 1, at, {
    kind: 'choice', question: `Which header for ${session.slice(0, 8)}?`, options: [{ id: 'a', label: 'A', decision: 'none' }, { id: 'b', label: 'B', decision: 'none' }], recommended: 'a',
    deadline: at + 48 * HOUR, fallback: 'you', default: 'a', provisional: false, owner: 'you', key, pinned_to: on,
  }, { writer: `mcp:${session}`, session });
  const subject = `ask:${ask}`;
  await add('ask.answered', 6, at + 10, { answer: 'b', plan_hash: null, decision: 'none', via: 'inbox', verified: true, on, token: null, words: null, image: null, option: 'b' }, { subject });
  await add('delivery.outcome', 1, at + 20, { delivery: subject, via: 'next_prompt', outcome: 'stalled' }, { subject });
  await add('delivery.outcome', 1, at + 30, { delivery: subject, via: 'next_prompt', outcome: 'timed_out' }, { subject });
  return at + 30;
}

/**
 * A hub's start on a record of `count` such sessions: the reads of its first pass that name delivery.outcome, each with
 * its query plan, the rows, and the indexes before and after. `bare` takes every index the merge base doesn't make off
 * the record first, so it is as one the merge base made.
 */
async function firstPass(count, { bare = false } = {}) {
  const home = tempHome(), reads = join(home, 'reads.jsonl');
  const newest = new Map();
  let hub, db;
  try {
    const at = Date.now() - 2 * HOUR;
    await seed(home, async (add) => {
      for (let n = 0; n < count; n++) await endedSession(add, sessionId(n), at + n * 10_000, async (then) => { newest.set(sessionId(n), await undelivered(add, sessionId(n), then)); });
    });
    if (bare) {
      const Database = createRequire(import.meta.url)('better-sqlite3');
      const file = new Database(ledgerOf(home));
      for (const i of indexes(file)) if (i.sql && !BASE_INDEXES.includes(i.name)) file.exec(`DROP INDEX "${i.name}"`);
      file.close();
    }
    db = sqlite(ledgerOf(home));
    const before = onDelivery(db).map((i) => i.name);
    hub = await startHub(CHANGE, home, { DEEP_HUB_TEST_READS: reads });
    await quiet(db, hub);
    // A pass reads, then appends: the first one's reads are those before the first row or state it set.
    const set = db.prepare("SELECT min(ts) AS ts FROM events WHERE kind IN ('row.set', 'session.state')").get().ts;
    assert.ok(set, `BLOCKED: the hub's start on ${count} sessions set no row and no state`);
    const named = readsOf(reads).filter((e) => e.via === 'raw' && e.at <= set && String(e.query).includes('delivery.outcome'));
    const plans = named.map((entry) => {
      const { sql, params } = rawOf(entry);
      return { sql, plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((step) => step.detail) };
    });
    return { count, reads: named.length, plans, newest, before, after: onDelivery(db).map((i) => i.name), all: indexes(db).map((i) => i.name), rows: listed(db).rows };
  } finally {
    db?.close();
    if (hub) await stopHub(hub);
    remove(home);
  }
}

describe('#3389 the reads of delivery.outcome', { timeout: 1_200_000 }, () => {
  it('#3389.c1bfb4a2 the first pass of a start reads delivery.outcome as often on 80 sessions whose answer timed out as on 20, through the index on its delivery alone, and each row says its words didn\'t reach it from the newest outcome; a record of the merge base has the index after its next open', async () => {
    const blocked = unbuilt(CHANGE);
    if (blocked) assert.fail(blocked);
    const twenty = await firstPass(20);
    const eighty = await firstPass(80, { bare: true });

    // Each row, from the newest outcome: what it says, and since when.
    for (const { count, newest, rows } of [twenty, eighty]) {
      for (const [session, ts] of newest) {
        const row = rows[`session:${session}`];
        assert.deepEqual(row && [row.word, row.why, row.waits_on, row.since], ['needs you', "your words didn't reach it: their delivery timed out", 'you', ts], `on ${count} sessions, the row of session ${session}, whose answer's delivery stalled and then timed out at ${ts}`);
      }
    }
    assert.ok(twenty.reads > 0, 'INCONCLUSIVE: the read log shows no read of delivery.outcome in the first pass, though each row says what its newest outcome was');
    assert.equal(eighty.reads, twenty.reads, `the first pass of a start read delivery.outcome ${twenty.reads} times on 20 sessions with an answer that timed out, and ${eighty.reads} times on 80`);
    assert.equal(twenty.reads, 1, `the reads of delivery.outcome in a pass are one; the first pass made ${twenty.reads}`);

    // The index, and the plan of each read.
    assert.notDeepEqual(twenty.before, [], `a new record has an index on events by the delivery an outcome names; it has ${twenty.all.join(', ')}`);
    assert.deepEqual(eighty.before, [], 'BLOCKED: the record of 80 sessions has no such index before it is opened, as the merge base makes none');
    assert.deepEqual(eighty.after, twenty.before, `a record the merge base made has the index after its next open; it has ${eighty.all.join(', ')}`);
    const by = (step) => /\bUSING (?:COVERING )?INDEX (\S+)/.exec(step)?.[1];
    for (const { plans, all, after } of [twenty, eighty]) {
      for (const { sql, plan } of plans) {
        const shown = `its plan:\n${plan.join('\n')}\nof ${sql.slice(0, 600)}`;
        assert.ok(plan.some((step) => after.includes(by(step))), `the read of delivery.outcome goes through the new index, ${after.join(' or ')}; ${shown}`);
        // Every way into `events` by another index, or by none: a plan names the table by its alias where it has one.
        const aliases = new Set(['events', ...[...sql.matchAll(/\bevents(?:\s+INDEXED\s+BY\s+\w+)?\s+(?:AS\s+)?(?!INDEXED\b|WHERE\b|JOIN\b|LEFT\b|INNER\b|CROSS\b|ON\b|ORDER\b|GROUP\b|LIMIT\b|NATURAL\b|UNION\b)([A-Za-z_]\w*)/gi)].map((m) => m[1])]);
        const other = plan.filter((step) => (by(step) ? !after.includes(by(step)) && all.includes(by(step)) : new RegExp(`^SCAN (${[...aliases].join('|')})\\b`).test(step)));
        assert.deepEqual(other, [], `the read of delivery.outcome steps events through no index but the new one; ${shown}`);
      }
    }
  });
});
