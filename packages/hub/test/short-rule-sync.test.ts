// #2539 regression: a short prompt typing a rule while another session's FULL commit syncs its evidence. A reply that
// waits for its rule's save holds the hub's queue behind that sync (the save commits as no session's does), and so every
// session's replies; the rule is still saved, once the sync is done (#2066).
import { watch } from 'node:fs';
import { afterAll, afterEach, expect, it } from 'vitest';
import { BOUND_MS, cleanup, during, endedSession, load, longText, recordUntil, Sess, settledSyncs, spans, startWorld, stopWorld, type World } from '../../../tests/acceptance/2539/helpers.ts';

let w: World | undefined;
afterEach(async () => { await stopWorld(w); w = undefined; }, 120_000);
afterAll(cleanup, 60_000);
/** The hub's evidence folder is being written: what is stored there is synced at once, slowed. */
const evidenceWritten = (world: World): Promise<void> => new Promise((resolve) => { const watcher = watch(world.evidence, { recursive: true }, () => { watcher.close(); resolve(); }); });

it('a short prompt typing a rule during another session\'s evidence sync replies within 1 s, and so does a third session\'s tool call (#2539)', async () => {
  w = await startWorld();
  const a = await endedSession(w);
  const b = new Sess(w);
  await b.start();
  await b.prompt('Is the build file in this folder?');
  const c = new Sess(w);
  await c.start();
  await c.prompt('Is the test folder here?');
  // A's next prompt, over 8,192 characters, resumes it: a FULL commit that waits on its evidence's slowed sync.
  const written = evidenceWritten(w);
  const resumed = a.prompt(longText('Before you go on, read this through.'));
  resumed.catch(() => undefined);
  await written;
  const line = 'Name every branch after its issue number';
  const typed = b.prompt(`rule: ${line}.\nSound good?`);
  // The call's second hook is sent once its first is answered, after B's prompt reached the hub.
  const calls = await c.tool('ran');
  const rule = await typed;
  const syncs = await settledSyncs(w);
  if (!during(rule.sent, syncs)) throw Error(`INCONCLUSIVE: B's prompt was sent at ${rule.sent}, outside every slowed sync ${spans(syncs)}; ${load()}`);
  expect(rule.ms, `B's short rule prompt replies within ${BOUND_MS} ms while A's commit syncs (${load()})`).toBeLessThan(BOUND_MS);
  expect(Math.max(...calls.map((call) => call.ms)), `C's tool call, queued behind B's prompt, replies within ${BOUND_MS} ms (${load()})`).toBeLessThan(BOUND_MS);
  const saved = (await recordUntil(w, 'B\'s rule', (events) => events.some((e) => e.kind === 'learn.applied' && e.data?.diff === `+ ${line}`))).filter((e) => e.kind === 'learn.applied' && e.data?.diff === `+ ${line}`);
  expect(saved.length, 'the rule is saved once').toBe(1);
}, 240_000);
