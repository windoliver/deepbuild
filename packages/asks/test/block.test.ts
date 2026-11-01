// A block's task answered "I did it" (#85): until the done gate re-runs a task's check on that answer (#323), the
// answer closes the task and every session it covers resumes, so the next turn is the check: a block that still
// holds stops them again with the same signature and raises a fresh task. "Leave it blocked" resumes nothing.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord, type Connection, type RecordStore } from '@deepbuild/record';
import { openAsks, type Asks } from '../src/index.js';

type Obj = { [key: string]: JsonValue };
const T0 = Date.UTC(2026, 9, 29, 12, 0, 0);
const who = { actor: 'you', scope: 'you' };
const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });
const card: Connection = { writer: 'app', ...who };
const S1 = '0b1dba30-7d4e-4c66-83df-ce84df27db32';
const S2 = '1c2eeb41-8e5f-4d77-94e0-df95e038ec43';

let n = 0;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = (ms: number): string => {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let k = ++n, i = 0; i < 16; i++, k = Math.floor(k / 32)) tail = CROCKFORD[k % 32] + tail;
  return time + tail;
};
const USAGE: Obj = { covers: 'turn', model: 'claude-haiku-5-5', input: { value: 2156, exact: true }, cached: { value: 0, exact: true }, output: { value: 118, exact: true }, context_fill: 0.08, cost: { usd: 0.01, basis: 'reported' } };

let dir: string;
let now: number;
let record: RecordStore;
let asks: Asks;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-asks-block-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ asks: {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
    fallback: ['change-owner'], fold: 5,
  } }));
  now = T0;
  record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
  asks = await openAsks({ record, now: () => now, deliver: () => undefined, home: dir });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A session stopped on a revoked sign-in, as deep-hook records it (agent.stop@4: cause, owner you, one signature). */
async function stopped(session: string): Promise<void> {
  await record.append(hook(session), { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: String(BigInt(now) * 1_000_000n + BigInt(++n)), data: { agent: 'claude-code', worktree: join(dir, 'w'), branch: 'main', thread: session } });
  now += 1000;
  await record.append(hook(session), { v: 4, id: ulid(now), kind: 'agent.stop', subject: `session:${session.replace(/[^0-9A-Za-z]/g, "")}`, ts: now, seq: String(BigInt(now) * 1_000_000n + BigInt(++n)), data: {
    turn: 1, did_work: false, claim: false, cause: 'sign_in_required', usage: USAGE, outcome: 'failed', signature: 'sig:00a1b2c3d4e5f607', owner: 'you',
  } });
  now += 1000;
  await asks.tick();
}
/** The inbox's open rows: the list holds every ask, closed ones with status closed. */
const open = async () => (await asks.inbox()).filter((r) => r.status !== 'closed');
const continued = async () => (await record.read({ after: 0, limit: 1000 })).filter((e) => e.kind === 'session.continued').map((e) => ({ session: e.session, because: (e.data as Obj).because, task: (e.data as Obj).task }));

describe('a block task you answer', () => {
  it('"I did it" closes it and resumes every session it covers, once', async () => {
    await stopped(S1);
    await stopped(S2);
    const [task] = await open();
    expect(task?.kind, 'one task for both stops').toBe('unblock');
    expect(await open()).toHaveLength(1);
    expect(await continued(), 'nothing resumed while the task is open').toEqual([]);
    await asks.answer(card, task!.ask, { option: 'done' });
    now += 1000;
    await asks.tick();
    expect(await open()).toEqual([]);
    expect((await continued()).sort((a, b) => String(a.session).localeCompare(String(b.session)))).toEqual([
      { session: S1, because: 'task_closed', task: task!.ask },
      { session: S2, because: 'task_closed', task: task!.ask },
    ]);
    now += 60_000;
    await asks.tick();
    expect(await continued(), 'once').toHaveLength(2);
  });

  it('"Leave it blocked" resumes nothing', async () => {
    await stopped(S1);
    const [task] = await open();
    await asks.answer(card, task!.ask, { option: 'wait' });
    now += 60_000;
    await asks.tick();
    expect(await open()).toEqual([]);
    expect(await continued()).toEqual([]);
  });
});

describe('a task\'s outside check', () => {
  const SOURCE = 'deep_ask.unblock';
  const network = { result: null as { host: string; reached: boolean; at: number } | null, read() { const r = this.result; this.result = null; return r; } };
  const stoppedOnNetwork = async (): Promise<void> => {
    await record.append(hook(S1), { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: String(BigInt(now) * 1_000_000n + BigInt(++n)), data: { agent: 'claude-code', worktree: '/tmp', branch: 'main', thread: S1 } });
    now += 1000;
    await record.append(hook(S1), { v: 4, id: ulid(now), kind: 'agent.stop', subject: `session:${S1.replace(/[^0-9A-Za-z]/g, '')}`, ts: now, seq: String(BigInt(now) * 1_000_000n + BigInt(++n)), data: {
      turn: 1, did_work: false, claim: false, cause: 'timed_out', usage: USAGE, outcome: 'failed', signature: 'sig:00a1b2c3d4e5f608', owner: 'you',
    } });
    now += 1000;
  };
  it('a try from before the task never closes it', async () => {
    await record.close();
    record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
    asks = await openAsks({ record, now: () => now, deliver: () => undefined, home: dir, network });
    await stoppedOnNetwork();
    await asks.tick();
    network.result = { host: 'h:443', reached: true, at: T0 - 3_600_000 };
    await asks.tick();
    expect((await open()).length, 'an hour-old success leaves it open').toBe(1);
    network.result = { host: 'h:443', reached: true, at: now };
    await asks.tick();
    expect((await open()).length, 'a try since the task closes it').toBe(0);
  });
  it('a thread task counts only your post since it was raised, and a good read clears a failed one', async () => {
    const link = 'https://acme.slack.com/archives/C0TEST/p1700000000000100';
    const replies: { from: string; text: string; at: number }[] = [{ from: 'you', text: 'ping', at: T0 - 86_400_000 }, { from: 'bot', text: 'pong', at: T0 - 86_400_000 + 1 }];
    let failing = true;
    await record.close();
    record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
    asks = await openAsks({ record, now: () => now, deliver: () => undefined, home: dir, threads: { read: async () => { if (failing) throw new Error('down'); return replies; } } });
    await record.append(hook(S1), { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: String(BigInt(now) * 1_000_000n + BigInt(++n)), data: { agent: 'claude-code', worktree: join(dir, 'w'), branch: 'main', thread: S1 } });
    const handle = await asks.raise(hook(S1), SOURCE, { kind: 'unblock', question: 'Post the test question?', options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done', provisional: false, owner: 'you', fallback: 'you', key: 'b'.repeat(64), pinned_to: { kind: 'evidence', ref: 'a'.repeat(64) }, steps: ['Post it'], where: 'Slack', why: 'It proves the bot', unblocks: [`session:${S1.replace(/[^0-9A-Za-z]/g, '')}`], proves: 'qa.bot', thread: { link, expect: 'pong' }, deadline: now + 86_400_000 } as JsonValue);
    now += 1000;
    await asks.tick();
    expect((await asks.card(handle)).missing?.reasons.join(), 'a failed read shows').toContain('down');
    failing = false;
    now += 1000;
    await asks.tick();
    expect((await open()).map((r) => r.ask), 'yesterday\'s exchange never closes it').toContain(handle);
    expect((await asks.card(handle)).missing, 'the good read cleared the failure').toBeNull();
    replies.push({ from: 'you', text: 'ping', at: now }, { from: 'bot', text: 'pong', at: now + 1 });
    now += 1000;
    await asks.tick();
    expect((await open()).map((r) => r.ask), 'your new post and its reply close it').not.toContain(handle);
  });
});
