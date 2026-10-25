// #34's stream on the hub's socket, as a test consumer sees it (design: the App API row of Five ways in; One
// event log, with tables built from it). The hub's halves of AC5 and AC11, AC7 and AC12 run here against a
// real hub; the app's halves of AC5, AC6, AC10 and AC11 are the record reader's (app.test.ts).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asApp, asCli, cleanup, Confirmer, confirmEnv, Conn, fillTo, framesOf, hook, installedRoot, judgeResume, judgeSeq, logEnd, makeHome,
  newSession, result, seedAsks, silentDropper, sleep, startHub, stopHub, tempDir, waitFor, type Hub, type HubOptions, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** Subscribes after `after`; resolves with the subscription's id and its reply, the stream's first frame. */
async function subscribe(conn: Conn, after: number): Promise<{ sub: string; first: Line; from: number }> {
  const from = conn.received.length;
  const first = await conn.call('stream.subscribe', { after }, 20_000);
  return { sub: first.id as string, first, from };
}

describe('AC5 #34.ed028526 cold start, the hub\'s half: every read returns the log_pos it reflects, and a subscription after it misses nothing', () => {
  it('AC5 with the log at 800, each read carries the hub\'s start ID and log_pos 800; an event appended at 801 before the subscription opens is its first event frame', async () => {
    const home = makeHome();
    const [ask] = await seedAsks(installedRoot(home), [{ source: 'deep_ask.taste', question: 'Which header colour?' }]);
    const hub = await startHub({ home, env: confirmEnv(new Confirmer()) });
    const app = await asApp(hub);
    await fillTo(hub, app, 800);
    const reads: [string, Line][] = [['inbox.read', {}], ['sessions.read', {}], ['numbers.read', {}], ['events.read', { after: 0, limit: 1000 }]];
    for (const [method, params] of reads) {
      const got = result(await app.call(method, params));
      expect({ method, start: got.start, log_pos: got.log_pos }, `${method} says which start and log_pos it reflects`).toEqual({ method, start: hub.start, log_pos: 800 });
    }
    const inbox = result(await app.call('inbox.read', {}));
    expect((inbox.asks as Line[]).map((r) => r.ask), 'the inbox read shows the open ask').toContain(ask!.handle);
    await hook(hub.socket, newSession(home, 'claude-code'));
    await waitFor(async () => (await logEnd(app)) === 801, 10_000, 'the event at 801');
    const { sub, first, from } = await subscribe(app, 800);
    expect(first.result?.start, 'the stream\'s first frame carries the hub\'s start ID').toBe(hub.start);
    await waitFor(() => framesOf(app, sub, from).frames.length > 0, 5000, 'a frame');
    expect(framesOf(app, sub, from).frames, 'subscribed after 800, the first event frame is 801\'s, and nothing at or before 800').toEqual([801]);
  }, 120_000);
});

/** A transcript of `n` prompts: test.load's backfill appends one user.ask for each (#16, test.load). */
function transcript(n: number): string {
  const file = join(tempDir(), 'big.jsonl');
  const lines: string[] = [];
  for (let i = 0; i < n; i++) lines.push(JSON.stringify({ type: 'user', uuid: `u-${i}`, timestamp: new Date(Date.UTC(2026, 9, 21) + i).toISOString(), message: { role: 'user', content: `prompt ${i}` } }));
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

interface Behind { expected: number[]; before: number[]; cut: boolean; after: number[] }
/**
 * A test consumer that stops reading while `n` events are appended, then reads what it was sent, then one more
 * event is appended; if it was cut off with fell_behind it reconnects and subscribes after its last log_pos.
 * `via` is the socket it reads through: the hub's, or a planted hub's in front of it.
 */
async function fallBehind(hub: Hub, n: number, via = hub.socket): Promise<Behind> {
  const cli = await asCli(hub);
  const start = await logEnd(cli);
  const consumer = await asApp({ socket: via, root: hub.root });
  const { sub, from } = await subscribe(consumer, start);
  consumer.sock.pause();
  const loaded = result(await cli.call('test.load', { backfill: { transcript: transcript(n), session: 'c0ffee00-1111-2222-3333-444455556666', agent: 'claude-code' } }, 600_000));
  expect(loaded.backfilled, `BLOCKED: setup: test.load appended ${n} events`).toBe(n);
  await sleep(500);
  consumer.sock.resume();
  // Reads until the cut-off line, or until nothing has come for 3 s.
  let seen = -1;
  while (framesOf(consumer, sub, from).frames.length !== seen && !framesOf(consumer, sub, from).cut) {
    seen = framesOf(consumer, sub, from).frames.length;
    await sleep(3000);
  }
  await hook(hub.socket, newSession(hub.home, 'claude-code'));
  const end = start + n + 1;
  await waitFor(async () => (await logEnd(cli)) === end, 10_000, `the log at ${end}`);
  await sleep(1000);
  const { frames: before, cut } = framesOf(consumer, sub, from);
  let after: number[] = [];
  if (cut) {
    const again = await asApp({ socket: via, root: hub.root });
    const last = before.length ? before[before.length - 1]! : start;
    const resumed = await subscribe(again, last);
    await waitFor(() => framesOf(again, resumed.sub, resumed.from).frames.includes(end), 60_000, `the resumed stream reaching ${end}`).catch(() => undefined);
    after = framesOf(again, resumed.sub, resumed.from).frames;
  }
  return { expected: Array.from({ length: n + 1 }, (_, i) => start + 1 + i), before, cut: cut !== undefined, after };
}
const vfsHub = (o: Partial<HubOptions> = {}) => startHub({ home: makeHome(), vfs: {}, env: confirmEnv(new Confirmer()), ...o });

describe('AC7 #34.adea68b1 a consumer more than 10,000 frames behind is cut off with fell_behind, never dropped silently, and resumes from its last log_pos', () => {
  it('AC7 stopped while 20,000 events are appended, it is cut off with fell_behind, and resuming after its last log_pos it gets every event it missed, in order, none twice', async () => {
    const hub = await vfsHub();
    const r = await fallBehind(hub, 20_000);
    expect(judgeResume(r.expected, r.before, r.cut, r.after)).toBeNull();
    expect(r.before.length, 'the cut came before the consumer was sent all 20,000').toBeLessThan(20_000);
  }, 900_000);

  it('AC7 stopped while 8,000 events are appended, never more than 10,000 behind, it is not cut off and gets them all', async () => {
    const hub = await vfsHub();
    const r = await fallBehind(hub, 8000);
    expect(r.cut, 'no fell_behind at 8,000 behind').toBe(false);
    expect(judgeResume(r.expected, r.before, true, r.after)).toBeNull();
  }, 900_000);

  it('AC7 (wrong program) a hub that drops its frames silently fails this test, naming the first log_pos lost', async () => {
    const hub = await vfsHub();
    const plant = await silentDropper(tempDir(), hub.socket);
    const r = await fallBehind(hub, 20_000, plant.path);
    const failure = judgeResume(r.expected, r.before, r.cut, r.after);
    const firstLost = r.expected.find((p) => !r.before.includes(p) && !r.after.includes(p));
    expect(firstLost, 'the planted hub dropped frames').toBeDefined();
    expect(failure).toBe(`log_pos ${firstLost} was lost with no fell_behind: the consumer never got it`);
    await plant.close();
  }, 900_000);
});

describe('AC11 #34.6ce4b9ff a power cut drops 900 to 905, the hub\'s half: the restarted hub\'s first frame carries a new start ID, and the lost positions stay empty', () => {
  it('AC11 with the test VFS, events streamed at 900 to 905 and lost to a cut are gone after the restart, its stream opens with a new start ID, and no log_pos is handed out again', async () => {
    const home = makeHome();
    const options: HubOptions = { home, vfs: { cutAfter: 1_000_000_000 }, env: confirmEnv(new Confirmer()) };
    let hub = await startHub(options);
    let app = await asApp(hub);
    await fillTo(hub, app, 898);
    result(await app.call('test.load', { verdicts: 1 }, 60_000));
    expect(await logEnd(app), 'BLOCKED: setup: the verdict, committed FULL, at 899').toBe(899);
    const { sub, first, from } = await subscribe(app, 899);
    const before = first.result?.start;
    expect(before, 'the stream\'s first frame carries the start ID').toBe(hub.start);
    const s = newSession(home, 'claude-code');
    for (let i = 0; i < 6; i++) await hook(hub.socket, s);
    await waitFor(() => framesOf(app, sub, from).frames.length >= 6, 10_000, 'the frames at 900 to 905');
    expect(framesOf(app, sub, from).frames, 'each went out once its append committed').toEqual([900, 901, 902, 903, 904, 905]);
    await stopHub(hub, 'SIGKILL');
    hub = await startHub(options);
    app = await asApp(hub);
    expect(hub.start, 'a new start ID at each start').not.toBe(before);
    const reopened = await subscribe(app, 905);
    expect(reopened.first.result?.start, 'the restarted hub\'s first frame carries its new start ID').toBe(hub.start);
    const page = result(await app.call('events.read', { after: 899, limit: 1000 }));
    expect(page.start, 'the read carries the new start ID').toBe(hub.start);
    expect((page.events as Line[]).map((e) => e.log_pos as number).filter((p) => p >= 900 && p <= 905), 'the cut dropped 900 to 905').toEqual([]);
    await hook(hub.socket, s);
    await waitFor(async () => (await logEnd(app)) > 905, 10_000, 'an event after the restart');
    const next = (result(await app.call('events.read', { after: 899, limit: 1000 })).events as Line[]).map((e) => e.log_pos as number);
    expect(Math.min(...next), 'no log_pos at or before 905 is handed out again').toBeGreaterThan(905);
  }, 180_000);
});

const STAMPS = ['1760013451123456789', '1760013451123456790'];
/** Two hooks stamped with the issue's seq values; what the app's subscription carried, as raw text. */
async function stamped(o: Partial<HubOptions> = {}): Promise<{ raw: string; events: Line[] }> {
  const hub = await startHub({ home: makeHome(), env: confirmEnv(new Confirmer()), ...o });
  const app = await asApp(hub);
  const { sub, from } = await subscribe(app, await logEnd(app));
  const s = newSession(hub.home, 'claude-code');
  for (const seq of STAMPS) await hook(hub.socket, s, seq);
  await waitFor(() => framesOf(app, sub, from).frames.length >= 2, 10_000, 'two frames');
  const lines = app.received.slice(from).filter((r) => r.json?.id === sub && r.json.event);
  return { raw: lines.map((r) => r.raw).join('\n'), events: lines.map((r) => r.json!.event as Line) };
}

describe('AC12 #34.a891cda8 hook requests stamped "1760013451123456789" and "1760013451123456790" come back on the stream as two events with those exact strings', () => {
  it('AC12 the two stamps come back on the app\'s stream as two events, each seq the same decimal string', async () => {
    const { raw, events } = await stamped();
    expect(judgeSeq(raw, STAMPS)).toBeNull();
    expect(events.map((e) => e.seq), 'two events, in order, with the exact strings').toEqual(STAMPS);
    expect(new Set(events.map((e) => e.id)).size, 'two events, not one').toBe(2);
  }, 60_000);

  it('AC12 (wrong program) a hub that writes seq as a JSON number fails this test', async () => {
    const { raw } = await stamped({ preload: join(FIXTURES, 'seq-as-number.mjs') });
    expect(judgeSeq(raw, STAMPS)).toBe(`no event on the stream carries seq "${STAMPS[0]}" as that exact string; it came back as a JSON number`);
  }, 60_000);
});
