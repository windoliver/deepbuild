// #2646.9ca53003: at a hub's start on #16's 30-day record, the asks core decodes no event whose kind it does not
// apply, counted by the test, and its asks, tasks and stops equal the merge base's.
//   DEEP_2646_BASE=<built merge base> node --test tests/acceptance/2646/asks-kinds.test.mjs
// Each side's hub starts on the same record (probe.mjs, seed-sixteen: #16's seedHistory, and one ask its newest session
// raised after its last tool call, since #16's history holds none for a core to miss), and stops once its start has
// landed. What its asks core made of the record is then read from the record's file: every ask, task and continue.
// The count is the asks core's own: the side's @deepbuild/asks is opened on a copy of that record through a record
// that counts each event a read hands it, as the hub's start opens it, from the log's first position. The record then
// holds #16's events, all of kinds the core applies, and what the hub's start appended, mostly of kinds it doesn't.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { BASE, CHANGE, probe, remove, settled, sidesProblem, sleep, sqlite, startHub, stopHub, tempHome } from './lib.mjs';

/** The hub's clock at its start: a minute after #16's history ends. */
const START = 1_793_000_000_000;
/** The kinds the asks core's apply reads at base 9ae04c6cd: its 27 cases. The issue changes no ask outcome, so none joins or leaves. */
const APPLIED = new Set(['session.start', 'agent.stop', 'session.continued', 'session.end', 'task.closed', 'ask.created', 'plan.proposed', 'decision.created', 'decision.revoked', 'decision.overruled',
  'decision.judged', 'decision.applied', 'ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot', 'default.undone', 'deadline.moved', 'ask.batched', 'ask.later',
  'tool.before', 'user.ask', 'verdict.made', 'claim.made', 'tool.after']);

/** What the asks core made of the record, by name: each ask (the fixture's by its ID), each task, each session's continues. */
function outcomes(db, fixture) {
  const out = new Map();
  for (const a of db.prepare('SELECT id, kind, session_id, key, status, outcome, batch_id IS NOT NULL AS shown, answer FROM asks ORDER BY kind, session_id, key, id').all()) {
    const name = a.id === fixture ? `ask:${a.id}` : `a ${a.kind} ask of session ${a.session_id} (key ${a.key})`;
    out.set(out.has(name) ? `${name} again` : name, `${a.status}, ${a.outcome}, ${a.shown ? 'shown' : 'not shown'}${a.answer === null ? '' : `, answered ${a.answer}`}`);
  }
  for (const t of db.prepare('SELECT task_ref, state, owner FROM tasks ORDER BY task_ref').all()) out.set(`task ${t.task_ref}`, `${t.state}, owned by ${t.owner}`);
  for (const s of db.prepare("SELECT session_id, count(*) AS n FROM events WHERE kind = 'session.continued' GROUP BY session_id").all()) out.set(`the stops of session ${s.session_id}`, `${s.n} continued`);
  return out;
}
const differences = (now, then) => [...new Set([...now.keys(), ...then.keys()])].filter((name) => now.get(name) !== then.get(name))
  .map((name) => `${name} reads ${now.get(name) ?? 'nothing'}, and ${then.get(name) ?? 'nothing'} on the merge base`);

/** One side's hub start on the record: what its asks core made of it, and the events that core decodes at a start. */
async function started(checkout, like) {
  const home = tempHome(), ledger = join(home, '.deepbuild', 'ledger.db'), copy = tempHome();
  let hub, db;
  try {
    mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
    const seeded = await probe(checkout, 'seed-sixteen', { ledger, clock: START });
    hub = await startHub(checkout, home, { DEEP_HUB_TEST_CLOCK: String(START) });
    db = sqlite(ledger);
    // The start has landed once the first state pass has (inbox.read answers behind it) and the outcomes read as the
    // merge base's do, or, on the merge base, once the fixture's ask has shown. A side that never gets there is read as it stands.
    let made;
    for (const end = Date.now() + 120_000; ;) {
      await settled(hub);
      made = outcomes(db, seeded.ask);
      if ((like ? differences(made, like).length === 0 : /, shown/.test(made.get(`ask:${seeded.ask}`) ?? '')) || Date.now() > end) break;
      await sleep(250);
    }
    await stopHub(hub);
    hub = undefined;
    db.close();
    db = undefined;
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(ledger + suffix)) copyFileSync(ledger + suffix, join(copy, `ledger.db${suffix}`));
    const { decoded } = await probe(checkout, 'asks-open', { ledger: join(copy, 'ledger.db'), now: START + 600_000 });
    return { seeded, made, decoded };
  } finally {
    db?.close();
    if (hub) await stopHub(hub);
    remove(home);
    remove(copy);
  }
}

describe('#2646 the asks core at a hub\'s start', { timeout: 3_600_000 }, () => {
  it('#2646.9ca53003 at a hub\'s start on #16\'s 30-day record, the asks core decodes no event whose kind it does not apply, and its asks, tasks and stops equal the merge base\'s', async () => {
    const blocked = sidesProblem();
    if (blocked) assert.fail(blocked);
    const base = await started(BASE);
    const fixture = `ask:${base.seeded.ask}`;
    if (!/, shown/.test(base.made.get(fixture) ?? '')) assert.fail(`BLOCKED: on the merge base the fixture's ask never showed within 120 s of the hub's start (${fixture} reads ${base.made.get(fixture) ?? 'nothing'}), so there is no ask for a core to miss`);
    const change = await started(CHANGE, base.made);
    assert.deepEqual(change.seeded, base.seeded, 'BLOCKED: the two sides seeded different records');

    // Its asks, tasks and stops. A core that misses an ask fails here, naming it.
    const differ = differences(change.made, base.made);
    assert.equal(differ.length, 0, `the asks core's asks, tasks and stops differ from the merge base's after the hub's start:\n${differ.slice(0, 12).join('\n')}${differ.some((line) => line.startsWith(fixture)) ? `\nIt missed ${fixture}, raised after its session's last tool call: a core that reads no tool.before still holds it for a step it never sees.` : ''}`);

    // The events it decodes at a start, counted by kind.
    const total = Object.values(change.decoded).reduce((a, b) => a + b, 0);
    if (!(change.decoded['ask.created'] >= 1 && change.decoded['tool.before'] >= 42_000)) assert.fail(`INCONCLUSIVE: the asks core's reads handed it ${total} events, without the record's ask or its 42,000 tool.before events (${JSON.stringify(change.decoded)}), so what it decodes can't be counted through its record's read`);
    const unapplied = (decoded) => Object.entries(decoded).filter(([kind]) => !APPLIED.has(kind)).sort(([, a], [, b]) => b - a);
    const count = (decoded) => unapplied(decoded).reduce((sum, [, n]) => sum + n, 0);
    assert.equal(count(change.decoded), 0, `at a hub's start the asks core decoded ${count(change.decoded)} events of kinds it does not apply, among ${total}: ${unapplied(change.decoded).map(([kind, n]) => `${kind} ×${n}`).join(', ')} (the merge base's decoded ${count(base.decoded)})`);
  });
});
