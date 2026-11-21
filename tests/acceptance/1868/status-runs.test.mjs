// #1868.bf84aa8b: with 200,000 run events in the record, one deep_status call for a session with 10 claims answers
// within 20% of its time with 1,000 run events, on the reference Mac. The merge base reads every run event for each
// claim and fails this, naming both times.
//   node --test tests/acceptance/1868/status-runs.test.mjs
// Two hubs of this checkout, each on a home and a record of its own (probe.mjs, seed-runs): one holds 1,000 run events
// and one 200,000. In both, the session made the same 10 claims with the same 10 finished runs each, the newest claims
// in the record; every other run event is a run of an older, ended session's claim. The session starts through its
// hooks from an agent stand-in, and deep_status is called through that agent's own `deep mcp`, which the hub binds to
// the session. Both hubs must answer with the session's 10 claims and each claim's 10 runs before any time counts.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Agent, judgeWithin, makeWorktree, probe, remove, startHub, stopHub, tempHome, timeSides, unbuilt } from './lib.mjs';

const SESSION = '18680003-0000-4000-8000-000000001868';
/** A run is the median of this many consecutive deep_status calls. */
const CALLS = 5;

/** A hub on a record of `runEvents` run events, with the session live and its `deep mcp` ready. */
async function side(runEvents, opened) {
  const home = tempHome();
  const own = { home };
  opened.push(own);
  const worktree = makeWorktree(home);
  const seeded = await probe('seed-runs', { ledger: join(home, '.deepbuild', 'ledger.db'), now: Date.now(), session: SESSION, worktree, runEvents });
  if (seeded.runEvents !== runEvents || seeded.own !== 200 || seeded.claims.length !== 10) throw Error(`BLOCKED: the record was not seeded as asked: ${JSON.stringify({ ...seeded, claims: seeded.claims.length })}, for ${runEvents} run events, 200 of them the session's`);
  const hub = await startHub(home);
  own.hub = hub;
  const agent = new Agent(hub, worktree, SESSION);
  own.agent = agent;
  await agent.establish();
  const status = async () => {
    const reply = await agent.tool('deep_status');
    if (reply.isError) throw Error(`BLOCKED: deep_status was refused: ${JSON.stringify(reply.value).slice(0, 600)}`);
    return reply;
  };
  return { seeded, status };
}

/** What a deep_status reply must hold of the seeded session, or why it doesn't: its 10 claims, newest first, each with its 10 runs. */
function misread(value, seeded) {
  if (value?.session !== SESSION) return `it answers for session ${JSON.stringify(value?.session)}, not ${SESSION}`;
  const claims = Array.isArray(value.claims) ? value.claims : [];
  const expected = [...seeded.claims].reverse();
  if (JSON.stringify(claims.map((claim) => claim.claim)) !== JSON.stringify(expected)) return `its claims are ${JSON.stringify(claims.map((claim) => claim.claim))}, not the session's 10, newest first: ${JSON.stringify(expected)}`;
  for (const claim of claims) {
    const runs = Array.isArray(claim.runs) ? claim.runs : [];
    const outcomes = runs.map((run) => `${run.check}:${run.outcome}`).sort().join(' ');
    const seededOutcomes = ['lint:failed', 'lint:passed', 'lint:passed', 'lint:passed', 'lint:passed', 'unit:failed', 'unit:passed', 'unit:passed', 'unit:passed', 'unit:passed'].join(' ');
    if (outcomes !== seededOutcomes) return `${claim.claim} lists the runs ${outcomes || 'none'}, not its 10 seeded runs (${seededOutcomes})`;
  }
  return null;
}

describe('#1868 deep_status on a long record', { timeout: 3_600_000 }, () => {
  it('#1868.bf84aa8b with 200,000 run events in the record, one deep_status call for a session with 10 claims answers within 20% of its time with 1,000 run events', async () => {
    const blocked = unbuilt();
    if (blocked) throw Error(blocked);
    const opened = [];
    try {
      const [small, large] = await Promise.all([side(1000, opened), side(200_000, opened)]);
      for (const [name, one] of [['1,000', small], ['200,000', large]]) {
        const wrong = misread((await one.status()).value, one.seeded);
        if (wrong) assert.fail(`deep_status on the record of ${name} run events doesn't answer with the session's claims and runs: ${wrong}`);
      }
      const times = await timeSides(async () => (await small.status()).ms, async () => (await large.status()).ms, CALLS);
      const verdict = await judgeWithin(times, 'one deep_status call for the session with 10 claims', 'with 200,000 run events in the record', 'with 1,000');
      assert.equal(verdict.status, 'PASS', verdict.message);
    } finally {
      for (const { agent, hub, home } of opened.reverse()) {
        await agent?.stop();
        if (hub) await stopHub(hub);
        remove(home);
      }
    }
  });
});
