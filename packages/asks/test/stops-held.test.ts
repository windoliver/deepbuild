// The core holds a session's newest stop and the ones a task still reads, and lets the rest go (#2653); what it
// decides is what it decided when it held them all. Two paths read a stop after a newer one of its session arrived: a
// continue the core recorded from a view that hadn't read that newer stop yet, and a task closed by its default that
// an undo opens again.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord, type Connection, type RecordStore } from '@deepbuild/record';
import { openAsks, type Asks } from '../src/index.js';

type Obj = { [key: string]: JsonValue };
const T0 = Date.UTC(2026, 10, 17, 12, 0, 0);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const who = { actor: 'you', scope: 'you' };
const S1 = 'c41f0d2e-5b7a-4e63-9a18-2f6d3b9e7a51';
const SUBJECT = `session:${S1.replace(/[^0-9A-Za-z]/g, '')}`;
const hook: Connection = { writer: 'hook', ...who, session: S1, agent: 'claude-code' };

let n = 0;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ulid = (ms: number): string => {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let k = ++n, i = 0; i < 16; i++, k = Math.floor(k / 32)) tail = CROCKFORD[k % 32] + tail;
  return time + tail;
};
const seq = (ms: number) => String(BigInt(ms) * 1_000_000n + BigInt(++n));
const USAGE: Obj = { covers: 'turn', model: 'claude-haiku-5-5', input: { value: 2156, exact: true }, cached: { value: 0, exact: true }, output: { value: 118, exact: true }, context_fill: 0.08, cost: { usd: 0.01, basis: 'reported' } };

let dir: string;
let now: number;
let turn = 0;
let record: RecordStore;
let asks: Asks;
const open = async () => {
  record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
  asks = await openAsks({ record, now: () => now, deliver: () => undefined, home: dir });
};
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-asks-stops-held-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ asks: {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
    fallback: ['change-owner'], fold: 5,
  } }));
  now = T0;
  turn = 0;
  await open();
  await record.append(hook, { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: seq(now), data: { agent: 'claude-code', worktree: join(dir, 'w'), branch: 'main', thread: S1 } });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A stop as deep-hook records it, stamped now: a dropped connection, a turn that ended normally, or a spent plan window. */
async function stop(how: 'dropped' | 'finished' | { resets: number }): Promise<string> {
  now += MINUTE;
  const id = ulid(now);
  const data: Obj = how === 'dropped' ? { turn: ++turn, did_work: true, claim: false, cause: 'timed_out', usage: USAGE, outcome: 'failed', signature: 'sig:1d20a3b4c5d6e7f8', owner: 'service' }
    : how === 'finished' ? { turn: ++turn, did_work: true, claim: true, cause: 'unknown', usage: USAGE, outcome: 'finished' }
    : { turn: ++turn, did_work: false, claim: false, cause: 'plan_window_spent', usage: USAGE, outcome: 'failed', signature: 'sig:5a0e1b2c3d4e5f60', owner: 'service', plan_resets: how.resets };
  await record.append(hook, { v: 4, id, kind: 'agent.stop', subject: SUBJECT, ts: now, seq: seq(now), data });
  return id;
}
const events = (kind: string) => record.read({ after: 0, limit: 1000 }).then((all) => all.filter((e) => e.kind === kind));
const continued = async () => (await events('session.continued')).map((e) => (e.data as Obj).stop);

it('a continue recorded after a newer stop of its session still counts: the second drop gets none, live and after a restart', async () => {
  // The core continues from a drop while the drop after it is already logged and not yet read, as when a hook lands
  // during the core's tick: the newer drop is applied first and lets the first go before the continue names it.
  const first = await stop('dropped');
  await stop('dropped');
  await record.append({ writer: 'core', ...who, session: S1 }, { v: 1, id: ulid(now), kind: 'session.continued', subject: SUBJECT, ts: now, data: { stop: first, because: 'transient', task: null } });
  now += 5_000;
  await asks.tick();
  expect(await continued(), 'a second drop right after a continue gets none').toEqual([first]);
  // The next start folds the same log the same way.
  await record.close();
  await open();
  await stop('dropped');
  now += 5_000;
  await asks.tick();
  expect(await continued(), 'nor does a third, after the hub started again').toEqual([first]);
});

it("an undone default's task still reads the spent window's reset from the stop it covers, many stops later", async () => {
  // A plan window whose reset comes after the task's 2-day deadline: the task takes its default first.
  const resets = T0 + 3 * DAY;
  await stop({ resets });
  now += 5_000;
  await asks.tick();
  const task = (await asks.inbox()).find((r) => r.kind === 'unblock');
  expect(task?.status, 'the spent window raises its task').not.toBe('closed');
  now = T0 + 2 * DAY + 10 * MINUTE;
  await asks.tick();
  expect((await asks.inbox()).find((r) => r.ask === task!.ask)?.outcome, 'its deadline passed').toBe('defaulted');
  // The session works on: its newest stop moves past the one the task covers.
  for (let i = 0; i < 5; i++) await stop('finished');
  await asks.tick();
  await asks.undo({ writer: 'cli', ...who }, task!.ask);
  now = resets + MINUTE;
  await asks.tick();
  const moot = (await events('ask.moot')).find((e) => e.subject === task!.ask);
  expect(moot?.data, `${task!.ask} closes at the window's reset once its default is undone`).toEqual({ because: 'window_reset', at: resets });
});
