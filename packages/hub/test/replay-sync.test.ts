// #2539 regression: a spooled line whose hook the hub already recorded live waits only for that live copy, not for
// another session's commit in its evidence sync. deep-hook spools a hook whose acknowledgement misses its deadline (a
// loaded machine), and the hub replays the spool at the next hook: a replay that waits for every append in flight holds
// the hub's queue, and so every session's replies, through another session's slowed sync.
import { mkdirSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it } from 'vitest';
import { Conn, ulid } from '../../../tests/acceptance/1410/helpers.ts';
import { BOUND_MS, cleanup, during, endedSession, load, longText, recordUntil, Sess, settledSyncs, spans, startWorld, stopWorld, type World } from '../../../tests/acceptance/2539/helpers.ts';

let w: World | undefined;
afterEach(async () => { await stopWorld(w); w = undefined; }, 120_000);
afterAll(cleanup, 60_000);
/** The hub's evidence folder is being written: what is stored there is synced at once, slowed. */
const evidenceWritten = (world: World): Promise<void> => new Promise((resolve) => { const watcher = watch(world.evidence, { recursive: true }, () => { watcher.close(); resolve(); }); });
let seq = 0n;
const nextSeq = (): string => (BigInt(Date.now()) * 1_000_000n + (++seq % 1_000_000n)).toString();

it('a replayed line already recorded live leaves another session\'s replies free while a FULL commit syncs (#2539)', async () => {
  w = await startWorld();
  const a = await endedSession(w);
  const b = new Sess(w);
  await b.start();
  await b.prompt('Is the build file in this folder?');
  // A's next prompt, over 8,192 characters, resumes it: a FULL commit that waits on its evidence's slowed sync.
  const written = evidenceWritten(w);
  const resumed = a.prompt(longText('Before you go on, read this through.'));
  resumed.catch(() => undefined);
  await written;
  // B's tool call reaches the hub live and is recorded; deep-hook, its acknowledgement late, spooled the same line too.
  const line = { v: 1, agent: 'claude-code', event: 'PreToolUse', seq: nextSeq(), id: ulid(), pid: process.pid, ppid: w.agent, matched: [],
    payload: { session_id: b.id, transcript_path: b.transcript, cwd: b.cwd, hook_event_name: 'PreToolUse', permission_mode: 'default', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_2539_spooled' } };
  const conn = await Conn.open(w.hub.socket, 30_000);
  try {
    conn.send(line);
    expect(await conn.seek((l) => 'exit' in l || 'error' in l, 0, 30_000), 'the live copy gets its reply').toBeDefined();
  } finally {
    conn.close();
  }
  // A call that ran: the turn did work, so its Stop is a claim, whose reply the hub writes once the claim is made.
  await b.tool('ran');
  mkdirSync(join(w.h.root, 'spool'), { recursive: true });
  writeFileSync(join(w.h.root, 'spool', 'spool.jsonl'), `${JSON.stringify(line)}\n`);
  // B's next hook starts the replay, and its Stop's reply, the hub's own, comes after it.
  const next = await b.stop();
  const syncs = await settledSyncs(w);
  if (!during(next.sent, syncs)) throw Error(`INCONCLUSIVE: B's next hook was sent at ${next.sent}, outside every slowed sync ${spans(syncs)}; ${load()}`);
  expect(next.ms, `B's Stop after the replay replies within ${BOUND_MS} ms while A's commit syncs (${load()})`).toBeLessThan(BOUND_MS);
  const copies = (await recordUntil(w, 'B\'s Stop', (events) => events.some((e) => e.session === b.id && e.kind === 'agent.stop'))).filter((e) => e.id === line.id);
  expect(copies.length, 'the replayed line is recorded once').toBe(1);
}, 240_000);
