// AC15 #16.ffcc7e73, one clause, redrafted blind: "a hook request whose payload sets `writer: app` is stored with
// writer `hook`. A hub that takes `writer` from the payload fails, naming the event" (AC15-WRITER-REDRAFT.md).
//
// The observation is the log as the hub serves it (`events.read` on a CLI connection), looked up by each request's
// ID, which is the event's ID (Hook protocol). At this base every kind a hook appends has `writer` const `hook` in
// its schema, so a hub that stamps the payload's `app` has its append refused by the record and stores nothing:
// "stored with writer `hook`" then fails because the event isn't there, and the message names its ID either way.
// If the hub is gone by then, the same lookup is made in its ledger through @deepbuild/record.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import { Agent, allEvents, alive, cleanup, control, hookRequest, makeHome, newSession, sleep, startHub, stopHub, type AgentHook, type Hub } from './helpers.ts';

afterAll(cleanup);

interface Sent { event: string; id: string; hook: AgentHook }
interface Stored { id: string; kind: string; writer: string }
interface Seen { from: 'events.read' | 'ledger.db'; events: Map<string, Stored> }

/** Two hook requests from a Claude Code session's own children, each payload carrying `writer: "app"`. */
async function scenario(plant?: string): Promise<{ hub: Hub; sent: Sent[]; seen: Seen }> {
  const home = makeHome();
  const hub = await startHub({ home, ...(plant !== undefined && { plant }) });
  const session = newSession(home, 'claude-code');
  const agent = Agent.start(home, session.cwd);
  const sent: Sent[] = [];
  for (const event of ['SessionStart', 'PreToolUse']) {
    const request = hookRequest(session, event, { writer: 'app' });
    sent.push({ event, id: request.id, hook: await agent.hook(hub.socket, request) });
  }
  await agent.stop();
  return { hub, sent, seen: await stored(hub, sent.map((s) => s.id)) };
}

/** The events with these IDs, as the hub serves its log; waits up to 5 s for all of them to be readable. */
async function stored(hub: Hub, ids: readonly string[]): Promise<Seen> {
  const deadline = Date.now() + 5000;
  try {
    const conn = await control(hub);
    for (;;) {
      const events = new Map((await allEvents(conn)).filter((e) => ids.includes(e.id)).map((e) => [e.id, { id: e.id, kind: e.kind, writer: e.writer }]));
      if (events.size === ids.length || Date.now() > deadline) {
        conn.close();
        return { from: 'events.read', events };
      }
      await sleep(100);
    }
  } catch (error) {
    // No hub to ask: what it stored is in its ledger. Read it only once the hub's process is gone.
    if (alive(hub.pid)) await stopHub(hub);
    const record = await openRecord({ path: join(hub.root, 'ledger.db'), now: () => Date.now() });
    try {
      const events = new Map<string, Stored>();
      for (let after = 0; ;) {
        const page = await record.read({ after, limit: 1000 });
        if (!page.length) break;
        for (const e of page) if (ids.includes(e.id)) events.set(e.id, { id: e.id, kind: e.kind, writer: e.writer });
        after = page[page.length - 1]!.log_pos;
      }
      console.log(`the hub couldn't be read (${(error as Error).message}); read its ledger instead`);
      return { from: 'ledger.db', events };
    } finally {
      await record.close();
    }
  }
}

/** The clause's assertion: each request is in the log under its ID with writer `hook`; a failure names the event. */
function storedAsHook(sent: readonly Sent[], seen: Seen): void {
  for (const s of sent) {
    const e = seen.events.get(s.id);
    const what = e
      ? `stored as ${e.kind} with writer ${JSON.stringify(e.writer)}`
      : `not in the log (${seen.from}); the hook ended ${s.hook.end}${s.hook.error ? `, refused ${JSON.stringify(s.hook.error)}` : s.hook.ack ? ', acknowledged' : ', with no acknowledgement'}`;
    expect(e?.writer, `event ${s.id} (${s.event}, payload writer "app"): ${what}`).toBe('hook');
  }
}

describe('AC15 #16.ffcc7e73 a hook request whose payload sets writer: app is stored with writer hook (redraft)', () => {
  it('AC15 each hook request carrying writer "app" in its payload is in the log under its ID with writer hook', async () => {
    const { sent, seen } = await scenario();
    storedAsHook(sent, seen);
  }, 60_000);

  it('AC15 (wrong program) a hub that takes writer from the payload fails, naming the event', async () => {
    const { sent, seen } = await scenario('writer-from-payload');
    let failure: Error | undefined;
    try {
      storedAsHook(sent, seen);
    } catch (error) {
      failure = error as Error;
    }
    expect(failure, `the planted hub passed: ${JSON.stringify([...seen.events.values()])}`).toBeDefined();
    expect(failure!.message).toContain(`event ${sent[0]!.id}`);
  }, 60_000);
});
