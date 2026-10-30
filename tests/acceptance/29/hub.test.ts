// #29 AC1, hub side: through the real hub and deep-hook, a stop whose turn did work makes exactly one claim for each open ask-task
// it touched; a typed question that opens no task, and a stop with no work since the turn began, make none. The claim is read from
// the record's `claim.made` events (`task_ref`) through `events.read`. Needs `npm run build` and `cargo build -p deep-hook`; a hub
// that cannot start is BLOCKED (the test throws), never a pass. The sessions play Claude Code as #303's do.
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, askNamed, BEHAVIOR, cleanup, CLI, DEEP_HOOK, lockedFor, makeWorld, MALFORMED, QUESTION, Session, settle, sleep, startHub, stopHub, taskOf,
  type Ev, type Hub, type World,
} from './h-d.ts';

afterEach(cleanup);

async function withHub(run: (w: World, hub: Hub) => Promise<void>): Promise<void> {
  for (const [what, path] of [['the deep CLI (npm run build)', CLI], ['deep-hook (cargo build -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
  }
  const w = makeWorld();
  const hub = await startHub(w);
  try {
    await run(w, hub);
  } finally {
    await stopHub(hub);
  }
}
const claimsFor = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.data.task_ref === ref);
/** The task a typed prompt opened, once its definition is locked. */
async function opened(hub: Hub, s: Session, text: string): Promise<string> {
  const events = await settle(hub, (e) => {
    const ref = taskOf(askNamed(e, s, text));
    return ref !== undefined && lockedFor(e, ref).length > 0;
  });
  const ref = taskOf(askNamed(events, s, text));
  if (!ref) throw Error(`the prompt "${text}" opened no task`);
  return ref;
}

describe('AC1 a stop makes exactly one claim per open ask it touched', () => {
  it('AC1 a stop after a turn that edited a file makes exactly one claim.made for the one open ask', async () => {
    await withHub(async (w, hub) => {
      const s = new Session(w);
      await s.start();
      await s.typed(BEHAVIOR);
      const ref = await opened(hub, s, BEHAVIOR);
      await s.read('src/auth.ts');
      await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
      await s.stop('Done.');
      await settle(hub, (e) => claimsFor(e, ref).length >= 1);
      await sleep(2500);
      const claims = claimsFor(await allEvents(hub), ref);
      expect(claims.length, `exactly one claim for ${ref}, never none and never two: ${JSON.stringify(claims.map((c) => c.data))}`).toBe(1);
    });
  }, 240_000);

  it('AC1 with two open asks and a turn that did work, a stop makes one claim for each, never two for one', async () => {
    await withHub(async (w, hub) => {
      const s = new Session(w);
      await s.start();
      await s.typed(BEHAVIOR);
      const first = await opened(hub, s, BEHAVIOR);
      await s.typed(MALFORMED);
      const second = await opened(hub, s, MALFORMED);
      expect(second).not.toBe(first);
      await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
      await s.stop('Done.');
      await settle(hub, (e) => claimsFor(e, first).length >= 1 && claimsFor(e, second).length >= 1);
      await sleep(2500);
      const events = await allEvents(hub);
      expect(claimsFor(events, first).length, `one claim for ${first}`).toBe(1);
      expect(claimsFor(events, second).length, `one claim for ${second}`).toBe(1);
      expect(events.filter((e) => e.kind === 'claim.made').length, 'and no claim for any other task').toBe(2);
    });
  }, 240_000);

  it('AC1 a typed question that opens no task, with no edit, makes no claim at its stop', async () => {
    await withHub(async (w, hub) => {
      const s = new Session(w);
      await s.start();
      await s.typed(QUESTION);
      await s.stop('The middleware compares exp with the clock. Done.');
      await sleep(3000);
      const events = await allEvents(hub);
      expect(askNamed(events, s, QUESTION), 'the question was recorded').toBeDefined();
      expect(events.filter((e) => e.kind === 'claim.made').map((e) => e.data), 'an answer is never a claim').toEqual([]);
    });
  }, 240_000);

  it('AC1 a stop with no work since the turn began makes no claim, whatever its last message says', async () => {
    await withHub(async (w, hub) => {
      const s = new Session(w);
      await s.start();
      await s.typed(BEHAVIOR);
      const ref = await opened(hub, s, BEHAVIOR);
      await s.stop('Done. Everything is finished and verified.');
      await sleep(3000);
      expect(claimsFor(await allEvents(hub), ref).length, 'words alone never trigger a claim').toBe(0);
    });
  }, 240_000);
});
