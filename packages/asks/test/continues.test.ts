// Continues are counted per session since its last turn that ended normally (#85): a second transient stop right after
// a continue gets none, and a turn that ends normally (a Stop, outcome finished) starts the count again, so the next
// transient stop gets one. A rule keyed per stop would continue the second drop.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord, type Connection, type RecordStore } from '@deepbuild/record';
import { openAsks, type Asks } from '../src/index.js';

type Obj = { [key: string]: JsonValue };
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);
const who = { actor: 'you', scope: 'you' };
const S1 = '2d3ffc52-9f60-4e88-a5f1-e0a6f149fd54';
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
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-asks-continues-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ asks: {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
    fallback: ['change-owner'], fold: 5,
  } }));
  now = T0;
  turn = 0;
  record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
  asks = await openAsks({ record, now: () => now, deliver: () => undefined, home: dir });
  await record.append(hook, { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: seq(now), data: { agent: 'claude-code', worktree: join(dir, 'w'), branch: 'main', thread: S1 } });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A stop as deep-hook records it: a dropped connection (StopFailure, the service's), or a turn that ended normally (Stop). */
async function stop(how: 'dropped' | 'finished'): Promise<string> {
  now += 60_000;
  const id = ulid(now);
  const data: Obj = how === 'dropped'
    ? { turn: ++turn, did_work: true, claim: false, cause: 'timed_out', usage: USAGE, outcome: 'failed', signature: 'sig:1d20a3b4c5d6e7f8', owner: 'service' }
    : { turn: ++turn, did_work: true, claim: true, cause: 'unknown', usage: USAGE, outcome: 'finished' };
  await record.append(hook, { v: 4, id, kind: 'agent.stop', subject: `session:${S1.replace(/[^0-9A-Za-z]/g, '')}`, ts: now, seq: seq(now), data });
  now += 5_000;
  await asks.tick();
  return id;
}
const continued = async () => (await record.read({ after: 0, limit: 1000 })).filter((e) => e.kind === 'session.continued').map((e) => (e.data as Obj).stop);

describe('the one automatic continue, counted per session since its last normal turn end', () => {
  it('continues the first drop, not a second right after it, and the next drop after a turn that ended normally', async () => {
    const first = await stop('dropped');
    expect(await continued(), 'the first drop gets the one continue').toEqual([first]);
    // The continued turn drops again, with no turn ending normally between: none.
    await stop('dropped');
    expect(await continued(), 'a second transient stop right after a continue gets none').toEqual([first]);
    // A turn ends normally (a Stop), and the next drop gets one again.
    await stop('finished');
    const next = await stop('dropped');
    expect(await continued(), 'a turn that ends normally resets the count').toEqual([first, next]);
    // And again only once.
    await stop('dropped');
    expect(await continued()).toEqual([first, next]);
  });
});

const S2 = '3e4aad63-a071-4f99-b6a2-f1b7a25aae65';
const hook2: Connection = { writer: 'hook', ...who, session: S2, agent: 'claude-code' };
describe('a resume on a shared task', () => {
  it('skips a session you stopped after its stop, and records why', async () => {
    await record.append(hook2, { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: seq(now), data: { agent: 'claude-code', worktree: join(dir, 'w2'), branch: 'main', thread: S2 } });
    for (const [conn, s] of [[hook, S1], [hook2, S2]] as const) {
      now += 1000;
      await record.append(conn, { v: 4, id: ulid(now), kind: 'agent.stop', subject: `session:${s.replace(/[^0-9A-Za-z]/g, '')}`, ts: now, seq: seq(now), data: { turn: 1, did_work: false, claim: false, cause: 'sign_in_required', usage: USAGE, outcome: 'failed', signature: 'sig:00a1b2c3d4e5f607', owner: 'you' } });
    }
    now += 1000;
    await asks.tick();
    const [task] = (await asks.inbox()).filter((r) => r.status !== 'closed');
    expect(task?.kind, 'one task for both stops').toBe('unblock');
    const created = (await record.read({ after: 0, limit: 1000 })).find((e) => e.kind === 'ask.created' && (e.data as Obj).kind === 'unblock');
    const proves = (created!.data as Obj).proves as string;
    // You stop S2 while the task is open.
    now += 1000;
    await record.append(hook2, { v: 1, id: ulid(now), kind: 'session.end', subject: `session:${S2.replace(/[^0-9A-Za-z]/g, '')}`, ts: now, seq: seq(now), data: { reason: 'prompt_input_exit' } });
    // The task's check passes: S1 resumes; S2, which ended, is skipped, and the record says why.
    now += 1000;
    const claim = `claim:${ulid(now)}`;
    const vid = ulid(now);
    await record.append({ writer: 'core', ...who }, { v: 1, id: vid, kind: 'verdict.made', subject: claim, ts: now, data: {
      outcome: 'PASS', verdict: `verdict:${vid}`, claim, reasons: [], smallest: null, points_to: null, commit: '0'.repeat(40),
      requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check: proves, depth: 'unit', oracle: 'code', runs: { clean: 1, needed: 1, counted: [] }, smallest: null, points_to: null, evidence: [], proof: 'test_run' }],
      key: { commit: '0'.repeat(40), doc_revisions: [], check_digests: [], state_digests: [], environment: 'test', tools: [] },
    } });
    now += 5000;
    await asks.tick();
    const events = await record.read({ after: 0, limit: 1000 });
    expect(events.filter((e) => e.kind === 'session.continued').map((e) => e.session), 'only the session still there resumes').toEqual([S1]);
    const why = events.filter((e) => e.kind === 'session.reading' && e.session === S2).map((e) => (e.data as Obj).reading);
    expect(why).toEqual([`DeepBuild didn't resume this session when ${task!.ask} closed: you stopped it after the stop.`]);
  });
});
