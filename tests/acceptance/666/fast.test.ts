// #666's fast tests: no Claude Code session and no spend. A made-up session in the checkout-web fixture (a Read and an
// Edit of its README) fires its hooks through the temporary home's settings, the timed hook command and the real
// deep-hook into the real hub, and each criterion's check runs on what the record holds, exactly as the live tests run
// it on a real session. Each check is shown to hold on the merged hub and, where the issue names a wrong program, to
// fail on it naming the criterion: the planted hub that drops a PostToolUse (AC1) and the planted replay that appends
// an event twice (AC2), each selected with DEEP_HUB_PLANT. A plant that doesn't exist or doesn't start fails its test.
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, AC5, buildDeepHook, checkout, cleanup, eventsOf, eventsOfSpooled, forwarder, hookProof, installHooks, killProblems, pollEvents,
  projectionProblems, proof, readHooks, readSpool, recordProblems, recordProof, replayProblems, runHooks, setAddress, settleEvents, shared, startHub,
  stopHub, syntheticSession, wallMs, type Ev, type HookRun, type Spooled,
} from './helpers.ts';
import { PROJECTIONS } from '../../../packages/record/src/index.ts';

afterAll(cleanup, 60_000);

const allIn = (hooks: readonly HookRun[]) => (events: Ev[]) => [...eventsOf(hooks, events).values()].every((evs) => evs.length > 0);
const spooledIn = (spooled: readonly Spooled[]) => (events: Ev[]) => spooled.every((r) => eventsOfSpooled(r, events).length > 0);

/** The made-up session with the hub up throughout, on the merged hub or a planted one. */
async function hubUp(plant?: string) {
  const s = installHooks(await buildDeepHook());
  const work = checkout(s);
  const session = syntheticSession(s, work);
  const hub = await startHub({ home: s.home, plant });
  await runHooks(s, session.inputs, work);
  const hooks = readHooks(s);
  const events = await settleEvents(hub, allIn(hooks), { quietMs: 3000, timeoutMs: 30_000 });
  await stopHub(hub);
  const folder = `fast-hub-up${plant ? `-${plant}` : ''}`;
  proof(folder, 'record.json', recordProof(events));
  proof(folder, 'hooks.json', hookProof(hooks));
  return { s, session, hooks, events };
}

/** The made-up session with the hub stopped before it starts, then the hub (merged or planted) started on its spool. */
async function hubStopped(plant?: string) {
  const s = installHooks(await buildDeepHook());
  const work = checkout(s);
  const session = syntheticSession(s, work);
  await stopHub(await startHub({ home: s.home }));
  await runHooks(s, session.inputs, work);
  const before = readSpool(s.root);
  const hub = await startHub({ home: s.home, plant });
  const events = await settleEvents(hub, spooledIn(before.requests), { quietMs: 3000, timeoutMs: 30_000 });
  await stopHub(hub);
  const folder = `fast-hub-stopped${plant ? `-${plant}` : ''}`;
  proof(folder, 'spool-before.json', before);
  proof(folder, 'spool-after.json', readSpool(s.root));
  proof(folder, 'record.json', recordProof(events));
  proof(folder, 'hooks.json', hookProof(readHooks(s)));
  return { s, session, before, events };
}

const merged = shared(() => hubUp());

describe(`AC1 ${AC1} every hook in the record once, under the session's ID, in stamp order; a hub that drops a PostToolUse fails, naming the call`, () => {
  it('AC1 (control) on the merged hub, the made-up session\'s hooks pass the check', async () => {
    const { session, hooks, events } = await merged();
    expect(hooks.map((h) => h.event), 'every hook of the made-up session ran').toEqual(session.inputs.map((i) => i.event));
    expect(recordProblems({ hooks, events, transcript: session.transcript, sessionId: session.sessionId })).toEqual([]);
  }, 300_000);

  it('AC1 (wrong program) the planted hub drops-post-tool-use fails the same check, naming the dropped call', async () => {
    const { session, hooks, events } = await hubUp('drops-post-tool-use');
    const problems = recordProblems({ hooks, events, transcript: session.transcript, sessionId: session.sessionId });
    const calls = session.inputs.filter((i) => i.event === 'PostToolUse').map((i) => `${i.input.tool_name} (${i.input.tool_use_id})`);
    const named = problems.filter((p) => p.startsWith(`${AC1}: the PostToolUse of call `) && p.endsWith('is not in the record') && calls.some((c) => p.includes(c)));
    expect(named.length, `the check names a dropped PostToolUse call (${calls.join(', ')}); it said: ${JSON.stringify(problems)}`).toBeGreaterThan(0);
    proof('fast-hub-up-drops-post-tool-use', 'problems.json', problems);
  }, 300_000);
});

describe(`AC2 ${AC2} with the hub stopped, every spooled event is in the record once in stamp order; a replay that appends one twice fails, naming its ID`, () => {
  it('AC2 (control) on the merged hub, the made-up session\'s spool replays into the record once each, in stamp order', async () => {
    const { session, before, events } = await hubStopped();
    expect(before.requests.length, 'every hook of the made-up session was spooled').toBe(session.inputs.length);
    expect(replayProblems(before.requests, events)).toEqual([]);
  }, 300_000);

  it('AC2 (wrong program) the planted replay replay-appends-twice fails the same check, naming the event\'s ID', async () => {
    const { before, events } = await hubStopped('replay-appends-twice');
    const problems = replayProblems(before.requests, events);
    const ids = before.requests.map((r) => String(r.json.id));
    const named = problems.filter((p) => p.startsWith(`${AC2}: spooled event `) && / is in the record [2-9]\d* times/.test(p) && ids.some((id) => p.startsWith(`${AC2}: spooled event ${id} `)));
    expect(named.length, `the check names a spooled event's ID that is in the record twice; it said: ${JSON.stringify(problems)}`).toBeGreaterThan(0);
    proof('fast-hub-stopped-replay-appends-twice', 'problems.json', problems);
  }, 300_000);
});

describe(`AC3 ${AC3} across a SIGKILL between two tool calls and a restart`, () => {
  it('AC3 (control) on the merged hub: what it acknowledged before the kill is in the record, log positions only increase, and the hooks run while it was down arrive from the spool', async () => {
    const s = installHooks(await buildDeepHook());
    const work = checkout(s);
    const session = syntheticSession(s, work);
    const hub = await startHub({ home: s.home });
    const fwd = await forwarder(s.dir, hub.socket);
    setAddress(s.root, fwd.path);
    const poller = pollEvents(hub);
    await runHooks(s, session.inputs.slice(0, 4), work); // SessionStart, UserPromptSubmit, the Read's PreToolUse and PostToolUse
    const killAtMs = wallMs();
    process.kill(hub.pid, 'SIGKILL');
    await hub.proc.exit;
    await poller.stop();
    await runHooks(s, session.inputs.slice(4), work); // the Edit's PreToolUse and PostToolUse, and Stop
    await fwd.close();
    const spool = readSpool(s.root);
    const restartAtMs = wallMs();
    const again = await startHub({ home: s.home });
    const events = await settleEvents(again, spooledIn(spool.requests), { quietMs: 3000, timeoutMs: 30_000 });
    await stopHub(again);
    proof('fast-kill', 'record.json', recordProof(events));
    proof('fast-kill', 'spool-before.json', spool);
    proof('fast-kill', 'hooks.json', hookProof(readHooks(s)));
    expect(killProblems({ hooks: readHooks(s), killAtMs, restartAtMs, acked: fwd.acked(), spooled: spool.requests, served: poller.served(), events, transcript: session.transcript })).toEqual([]);
  }, 300_000);
});

describe(`AC5 ${AC5} after the run, the record's projections rebuilt from its log equal the live ones`, () => {
  it('AC5 (control) the merged hub\'s projections after the made-up session equal their rebuild', async () => {
    const { s } = await merged();
    const { problems, rows } = await projectionProblems(s.root, join(s.dir, 'copy'));
    expect(problems).toEqual([]);
    expect(rows).toBeGreaterThan(0);
  }, 300_000);

  it('AC5 (mutant) a copy whose live projection lost a row is found, naming its table', async () => {
    const { s } = await merged();
    let table = '';
    const { problems } = await projectionProblems(s.root, join(s.dir, 'mutant'), (ledger) => {
      const db = new Database(ledger);
      try {
        table = PROJECTIONS.find((name) => (db.prepare(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n > 0)!;
        db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} LIMIT 1)`).run();
      } finally {
        db.close();
      }
    });
    expect(problems.some((p) => p.startsWith(`${AC5}: ${table}: `)), `the comparison names ${table}: ${JSON.stringify(problems)}`).toBe(true);
  }, 300_000);
});

