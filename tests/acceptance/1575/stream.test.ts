// #1575's stream on the hub's socket, as a slow reader sees it (design: Socket roles and contract versions, Reads
// and writes a slow link can afford). AC2 to AC5 run here against a real hub, and AC2's and AC3's wrong programs
// against that hub behind a planted socket (README, Wrong programs).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asApp, asCli, BYTE_CAP_AT_MOST, cleanup, Confirmer, confirmEnv, eventsAfter, FRAME_CAP, got, hooks, judgeAfterSnapshot, judgeHeld, judgePhases, judgeScope,
  judgeSnapshot, makeHome, newSession, of, quiet, replays, REPLAY_CAP, result, scopedTo, sendsAll, settled, sleep, startHub, subscribe,
  tempDir, type Hub, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const hubHere = (vfs?: Record<string, unknown>): Promise<Hub> => startHub({ home: makeHome(), ...(vfs && { vfs }), env: confirmEnv(new Confirmer()) });

/**
 * Two sessions take turns appending; a reader scoped to the first reads through `via` (the hub's socket, or a
 * planted hub's). Gives AC2's judgement and the other session's ID and events, for the plant's message.
 */
async function twoSessions(hub: Hub, via = hub.socket): Promise<{ failure: string | null; mine: string; other: string; others: number[] }> {
  const app = await asApp(hub);
  const [mine, other] = [newSession(hub.home, 'claude-code'), newSession(hub.home, 'claude-code')];
  const start = await settled(app);
  const reader = await asApp({ socket: via, root: hub.root });
  const s = await subscribe(reader, { after: start, ...scopedTo(mine.id) });
  for (let i = 0; i < 3; i++) {
    await hooks(hub.socket, mine, 1);
    await hooks(hub.socket, other, 1);
  }
  await settled(app);
  const g = await quiet(reader, s);
  const appended = await eventsAfter(app, start);
  expect(of(appended, mine.id).length, 'BLOCKED: setup: the scoped session appended 3 events or more').toBeGreaterThanOrEqual(3);
  expect(of(appended, other.id).length, 'BLOCKED: setup: the other session appended 3 events or more').toBeGreaterThanOrEqual(3);
  return { failure: judgeScope(mine.id, s.reply, g.events, of(appended, mine.id)), mine: mine.id, other: other.id, others: of(appended, other.id) };
}

describe('AC2 #1575.d79bb92a a reader scoped to one session gets no frame for another', () => {
  it('AC2 #1575.d79bb92a with two sessions appending in turn, a reader scoped to the first gets each of its events and no frame for the second', async () => {
    const r = await twoSessions(await hubHere());
    expect(r.failure).toBeNull();
  }, 120_000);

  it('AC2 #1575.d79bb92a (wrong program) a planted hub that sends all fails this test, naming the session', async () => {
    const hub = await hubHere();
    const plant = await sendsAll(tempDir(), hub.socket);
    const r = await twoSessions(hub, plant.path);
    expect(r.failure).toBe(`a reader scoped to session ${r.mine} got ${r.others.length} frames for session ${r.other}, the first at log_pos ${r.others[0]}`);
    await plant.close();
  }, 120_000);
});

/** A session with `n` events or more in the log, the log settled: the session, every event, and the log's head. */
async function history(hub: Hub, n: number): Promise<{ session: string; events: Line[]; head: number; hook: (count: number) => Promise<void> }> {
  const app = await asApp(hub);
  const s = newSession(hub.home, 'claude-code');
  await hooks(hub.socket, s, n);
  const head = await settled(app);
  const events = await eventsAfter(app, 0);
  expect(of(events, s.id).length, `BLOCKED: setup: the session has ${n} events or more`).toBeGreaterThanOrEqual(n);
  return { session: s.id, events, head, hook: (count) => hooks(hub.socket, s, count) };
}

const BEHIND = 200;
/**
 * A reader of one session subscribes 200 of its events behind, through `via`. Told to read a snapshot, it reads
 * one (sessions.read, after two more events landed), subscribes after the log_pos that read reflects, and three
 * more events are appended. Gives AC3's judgement.
 */
async function farBehind(hub: Hub, via = hub.socket): Promise<string | null> {
  const h = await history(hub, BEHIND);
  const mine = of(h.events, h.session);
  const after = mine[mine.length - BEHIND]! - 1;
  const reader = await asApp({ socket: via, root: hub.root });
  const first = await subscribe(reader, { after, ...scopedTo(h.session) });
  const replayed = (await quiet(reader, first)).frames;
  const told = judgeSnapshot(BEHIND, first.reply, replayed);
  if (told) return told;
  await h.hook(2);
  const snapshot = result(await reader.call('sessions.read', {}));
  const at = snapshot.log_pos as number;
  expect(at, 'the snapshot is fresh: it reflects the head the reply named, or later').toBeGreaterThanOrEqual(h.head);
  const again = await subscribe(reader, { after: at, ...scopedTo(h.session) });
  await h.hook(3);
  const app = await asApp(hub);
  await settled(app);
  const g = await quiet(reader, again);
  expect(got(reader, first).frames, 'nothing came on the subscription that was told to read a snapshot').toBe(0);
  return judgeAfterSnapshot(at, again.reply, g.events.map((e) => e.log_pos as number), of(await eventsAfter(app, at), h.session));
}

describe('AC3 #1575.1c19e28a a reader 200 events behind gets a snapshot reply and misses nothing after reading it', () => {
  it('AC3 #1575.1c19e28a 200 events behind, past the cap of 128, the reply says to read a snapshot and replays nothing; after the read, every later event arrives once, in order', async () => {
    expect(BEHIND, 'BLOCKED: setup: 200 is past the replay cap').toBeGreaterThan(REPLAY_CAP);
    expect(await farBehind(await hubHere())).toBeNull();
  }, 180_000);

  it('AC3 #1575.1c19e28a (wrong program) a planted hub that replays fails this test, naming the count', async () => {
    const hub = await hubHere();
    const plant = await replays(tempDir(), hub.socket);
    expect(await farBehind(hub, plant.path)).toBe('a reader 200 events behind got no snapshot reply: the hub replayed 200 events');
    await plant.close();
  }, 180_000);
});

describe('AC4 #1575.ec9543ba a client sees replaying, then caught up, then live, and its first live frame follows the caught-up frame with no gap', () => {
  it('AC4 #1575.ec9543ba 50 events behind, the reply names the head, the 50 arrive, one frame marks the head, and the next event appended is the first frame after it', async () => {
    const hub = await hubHere();
    const h = await history(hub, 60);
    const mine = of(h.events, h.session);
    const after = mine[mine.length - 50]! - 1;
    expect(h.head - after, 'BLOCKED: setup: the reader is within the replay cap').toBeLessThanOrEqual(REPLAY_CAP);
    const reader = await asApp(hub);
    const s = await subscribe(reader, { after, ...scopedTo(h.session) });
    await quiet(reader, s);
    await h.hook(3);
    const app = await asApp(hub);
    await settled(app);
    const g = await quiet(reader, s);
    const replay = mine.filter((p) => p > after && p <= h.head);
    const live = of(await eventsAfter(app, h.head), h.session);
    expect(live.length, 'BLOCKED: setup: three events or more were appended after the head').toBeGreaterThanOrEqual(3);
    expect(judgePhases(s.reply, g, h.head, replay, live)).toBeNull();
  }, 180_000);
});

const PROMPTS = 4000;
const PROMPT = 'run the tests and fix what fails. '.repeat(241);   // 8 KiB, the most of a prompt the hub keeps in one event
const LOADED = 'c0ffee00-1111-2222-3333-444455556666';
/** A transcript of 4,000 prompts of 8 KiB each: test.load's backfill appends one user.ask for each (#16). */
function transcript(): string {
  const file = join(tempDir(), 'big.jsonl');
  const lines: string[] = [];
  for (let i = 0; i < PROMPTS; i++) lines.push(JSON.stringify({ type: 'user', uuid: `u-${i}`, timestamp: new Date(Date.UTC(2026, 9, 21) + i).toISOString(), message: { role: 'user', content: `${i} ${PROMPT}` } }));
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

describe('AC5 #1575.d0ddf63c a reader that stops reading is held at a byte cap, with the frame and byte counts in its report', () => {
  it('AC5 #1575.d0ddf63c stopped while 4,000 prompts of 8 KiB are appended, 32 MiB or more in fewer frames than the frame cap, it is cut off within the byte cap and its fell_behind report counts the frames and bytes', async () => {
    const hub = await hubHere({});
    const cli = await asCli(hub);
    const start = await settled(cli);
    const reader = await asApp(hub);
    const s = await subscribe(reader, { after: start, ...scopedTo(LOADED) });
    expect(s.reply.result?.subscribed, `the reader is subscribed: ${JSON.stringify(s.reply)}`).toBe(true);
    reader.sock.pause();
    const loaded = result(await cli.call('test.load', { backfill: { transcript: transcript(), session: LOADED, agent: 'claude-code' } }, 600_000));
    expect(loaded.backfilled, 'BLOCKED: setup: test.load appended 4,000 events').toBe(PROMPTS);
    // Each of the session's events as a frame's bytes: the 4,000 prompts and what the hub appends beside them.
    const sizes = (await eventsAfter(cli, start)).filter((e) => e.session === LOADED).map((e) => Buffer.byteLength(JSON.stringify({ v: 1, id: s.sub, event: e })) + 1);
    expect(sizes.length, 'BLOCKED: setup: the session\'s frames are fewer than the frame cap').toBeLessThan(FRAME_CAP);
    expect(sizes.reduce((sum, n) => sum + n, 0), 'BLOCKED: setup: they are twice the largest byte cap this suite allows, or more').toBeGreaterThanOrEqual(2 * BYTE_CAP_AT_MOST);
    await sleep(500);
    reader.sock.resume();
    expect(judgeHeld(sizes, await quiet(reader, s, 3000))).toBeNull();
  }, 600_000);
});
