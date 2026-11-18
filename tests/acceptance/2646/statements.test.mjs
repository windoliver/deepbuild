// #2646.44dd0631: over 200 state passes whose touched sets all differ, across eight live sessions, the core thread
// compiles at most 16 statements for the pass, and a statement another read compiled before the passes is still
// compiled after them.
//   node --test tests/acceptance/2646/statements.test.mjs
// One hub of this checkout, its reads log on. Eight sessions start through their SessionStart hooks; then, for one set
// of two or more of them after another, each session of the set sends a PreToolUse at once, and the state pass that
// follows reads that set. The reads log holds every raw read the core's record served, with its SQL and bound values,
// and the record keeps its 256 most recently used raw statements compiled, by their SQL text. So the log replayed
// through that rule gives each statement the core compiled and each it dropped. A pass's statements are those of the
// raw reads that name two or more of the eight sessions, in their SQL or their bound values.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CHANGE, follow, hook, rawOf, remove, settled, sleep, startHub, stopHub, tempHome, unbuilt } from './lib.mjs';

const PASSES = 200, LIMIT = 16;
/** How many raw statements the record keeps compiled, the most recently used (the issue: "the record's 256 kept ones"). */
const KEPT = 256;
const SESSIONS = Array.from({ length: 8 }, (_, i) => `2646000${i + 1}-0000-4000-8000-0000000026${String(i + 1).padStart(2, '0')}`);
/** Every set of two or more of the eight sessions: 247 of them, in a fixed order. */
const SETS = Array.from({ length: 255 }, (_, i) => SESSIONS.filter((_, bit) => (i + 1) & (1 << bit))).filter((set) => set.length >= 2);
const named = (entry) => SESSIONS.filter((id) => String(entry.query).includes(id));
const key = (set) => set.join(' ');

/** The raw reads replayed through the record's rule: how often each statement was compiled, and those still kept at the end. */
function replay(raws, left = () => false) {
  const kept = new Map(), compiled = new Map();
  for (const read of raws) {
    if (left(read)) continue;
    if (kept.has(read.sql)) kept.delete(read.sql);
    else {
      compiled.set(read.sql, (compiled.get(read.sql) ?? 0) + 1);
      if (kept.size >= KEPT) kept.delete(kept.keys().next().value);
    }
    kept.set(read.sql, true);
  }
  return { kept, compiled };
}

describe('#2646 the state pass', { timeout: 3_600_000 }, () => {
  it('#2646.44dd0631 over 200 state passes whose touched sets all differ, across eight live sessions, the core compiles at most 16 statements for the pass, and a statement another read compiled before them is still compiled after', async () => {
    const blocked = unbuilt(CHANGE);
    if (blocked) assert.fail(blocked);
    const home = tempHome(), reads = join(home, 'reads.jsonl'), log = [];
    let hub;
    try {
      hub = await startHub(CHANGE, home, { DEEP_HUB_TEST_READS: reads });
      const more = follow(reads);
      const take = () => { const lines = more(); log.push(...lines); return lines; };
      for (const session of SESSIONS) await hook(hub, session, 'SessionStart', { source: 'startup' });
      await settled(hub);
      take();
      const seen = new Set();
      let missed = 0, calls = 0;
      for (const set of SETS) {
        if (seen.size >= PASSES) break;
        await Promise.all(set.map((session) => hook(hub, session, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: `call_2646_${++calls}` })));
        // The pass that reads exactly this set has begun once a raw read names it; inbox.read then answers behind it.
        let found = false;
        for (const end = Date.now() + 10_000; !found && Date.now() < end; await sleep(20)) {
          for (const entry of take()) {
            const sessions = entry.via === 'raw' ? named(entry) : [];
            if (sessions.length >= 2) seen.add(key(sessions));
            found ||= key(sessions) === key(set);
          }
        }
        await settled(hub);
        missed = found ? 0 : missed + 1;
        if (missed >= 3) break;
      }
      await settled(hub);
      take();
    } finally {
      if (hub) await stopHub(hub);
      remove(home);
    }

    const raws = log.filter((entry) => entry.via === 'raw').map((entry) => ({ ...rawOf(entry), sessions: named(entry) }));
    const passes = raws.filter((read) => read.sessions.length >= 2);
    const sets = new Set(passes.map((read) => key(read.sessions)));
    if (sets.size < PASSES) assert.fail(`INCONCLUSIVE: the reads log shows ${sets.size} state passes whose touched sets differ, not ${PASSES}: ${passes.length} raw reads name two or more of the eight sessions, among ${raws.length} raw reads. Either the passes' reads no longer name their sessions in their SQL or bound values, or the hooks of one set were split between passes on a loaded machine`);

    const statements = new Set(passes.map((read) => read.sql));
    const all = replay(raws);
    const compiles = [...statements].reduce((sum, sql) => sum + all.compiled.get(sql), 0);
    assert.ok(compiles <= LIMIT, `the core compiled ${compiles} statements for ${sets.size} state passes whose touched sets all differ (${(compiles / sets.size).toFixed(1)} a pass); at most ${LIMIT} are allowed. One of them: ${[...statements].at(-1).slice(0, 400)}`);

    // A statement another read compiled before the passes, and no read used again: the newest such one.
    const first = raws.indexOf(passes[0]);
    const later = new Set(raws.slice(first).map((read) => read.sql));
    const before = raws.slice(0, first).findLast((read) => !statements.has(read.sql) && !later.has(read.sql));
    if (!before) assert.fail(`INCONCLUSIVE: no read before the passes compiled a statement the passes' time left unused, among ${first} raw reads`);
    if (!all.kept.has(before.sql)) {
      const without = replay(raws, (read) => statements.has(read.sql));
      if (!without.kept.has(before.sql)) assert.fail(`INCONCLUSIVE: other reads than the passes' pushed the statement out of the ${KEPT} kept, so the passes can't be told apart: ${before.sql.slice(0, 300)}`);
      assert.fail(`a statement another read compiled before the passes is no longer compiled after them: the passes' ${compiles} statements pushed it out of the record's ${KEPT} kept ones. The statement: ${before.sql.slice(0, 400)}`);
    }
  });
});
