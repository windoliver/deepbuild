// An agent's sign-in task (#1349): the one the hub raises for a first Send and the ones two sessions in two folders
// stop on are one task, keyed on the agent; "I did it" leaves it open while the probe reads not signed in; a reading
// from before the task closes nothing; the first signed-in reading after it closes it as signed_in, naming the account,
// and the sessions it holds resume.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { openRecord, type Connection, type RecordStore } from '@deepbuild/record';
import { askSources, openAsks, signInSignature, type Asks } from '../src/index.js';

type Obj = { [key: string]: JsonValue };
type Reading = { signedIn: boolean | null; account: string | null; at: number };
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const who = { actor: 'you', scope: 'you' };
const hook = (session: string): Connection => ({ writer: 'hook', ...who, session, agent: 'claude-code' });
const card: Connection = { writer: 'app', ...who };
const core: Connection = { writer: 'core', ...who };
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
const seq = (ms: number): string => String(BigInt(ms) * 1_000_000n + BigInt(++n));

let dir: string;
let now: number;
let record: RecordStore;
let asks: Asks;
/** The probe: the next reading per agent, handed over once. */
const readings = new Map<string, Reading>();
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-asks-sign-in-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ asks: {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
    fallback: ['change-owner'], fold: 5,
  } }));
  now = T0;
  readings.clear();
  record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
  const signIn = { read: (agent: string) => { const r = readings.get(agent) ?? null; readings.delete(agent); return r; } };
  asks = await openAsks({ record, now: () => now, deliver: () => undefined, home: dir, signIn });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A Claude Code session in its own folder stopped on a lapsed sign-in, as the hub records it: the agent's signature. */
async function stopped(session: string, folder: string): Promise<void> {
  await record.append(hook(session), { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: seq(now), data: { agent: 'claude-code', worktree: join(dir, folder), branch: 'main', thread: session } });
  now += 1000;
  await record.append(hook(session), { v: 4, id: ulid(now), kind: 'agent.stop', subject: `session:${session.replace(/[^0-9A-Za-z]/g, '')}`, ts: now, seq: seq(now), data: {
    turn: 1, did_work: false, claim: false, cause: 'sign_in_required', outcome: 'failed', signature: signInSignature('claude-code'), owner: 'you',
    usage: { covers: 'turn', model: 'claude-haiku-5-5', input: { value: 10, exact: true }, cached: { value: 0, exact: true }, output: { value: 1, exact: true }, context_fill: 0.01, cost: { usd: 0, basis: 'reported' } },
  } });
  now += 1000;
  await asks.tick();
}
const open = async () => (await asks.inbox()).filter((r) => r.status !== 'closed');
const events = async (kind: string) => (await record.read({ after: 0, limit: 1000 })).filter((e) => e.kind === kind);

it('one sign-in task per agent across a Send and two folders, closed only by a signed-in probe reading after it', async () => {
  const task = await asks.signIn(core, 'claude-code', 'req:0123456789abcdef');
  await stopped(S1, 'a');
  await stopped(S2, 'b');
  expect((await open()).map((r) => r.ask), 'the Send and both folders share the one task').toEqual([task]);

  readings.set('claude-code', { signedIn: false, account: null, at: now });
  await asks.tick();
  await asks.answer(card, task, { option: 'done' });
  now += 1000;
  await asks.tick();
  const [row] = await open();
  expect(row?.ask, '"I did it" leaves it open while the probe reads not signed in').toBe(task);
  expect(row?.missing?.check, 'its card names the probe as what is missing').toBe('claude-code sign-in probe');
  expect(await events('ask.answered'), 'no answer is recorded').toEqual([]);

  readings.set('claude-code', { signedIn: true, account: 'acct-1', at: T0 - 60_000 });
  await asks.tick();
  expect((await open()).map((r) => r.ask), 'a reading from before the task closes nothing').toEqual([task]);

  readings.set('claude-code', { signedIn: true, account: 'acct-1', at: now });
  await asks.tick();
  now += 1000;
  await asks.tick();
  expect(await open(), 'the signed-in reading closes it').toEqual([]);
  expect((await events('ask.moot')).map((e) => [e.subject, e.v, e.data]), 'closed as signed_in, naming the agent and its account').toEqual([[task, 2, { because: 'signed_in', agent: 'claude-code', account: 'acct-1' }]]);
  expect((await events('session.continued')).map((e) => [e.session, (e.data as Obj).because, (e.data as Obj).task]).sort(), 'both stopped sessions resume').toEqual([[S1, 'task_closed', task], [S2, 'task_closed', task]]);
});

it('under setup\'s 8-hour batches a sign-in task shows at once, from a Send or a lapsed sign-in, while another block waits for its batch (#22)', async () => {
  const config = join(dir, 'config.json');
  const settings = JSON.parse(readFileSync(config, 'utf8'));
  settings.asks.batch = { every: '8h', cap: 20 };
  writeFileSync(config, JSON.stringify(settings));
  // A minute past a batch time: the next is almost 8 hours away, past no deadline here.
  now = T0 + 4 * 3_600_000 + 60_000;
  const status = async (ask: string) => (await asks.inbox()).find((r) => r.ask === ask)?.status;

  // Another block you own, a crashed agent, waits for the batch as any ask does.
  await record.append(hook(S2), { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: seq(now), data: { agent: 'claude-code', worktree: join(dir, 'b'), branch: 'main', thread: S2 } });
  now += 1000;
  await record.append(hook(S2), { v: 4, id: ulid(now), kind: 'agent.stop', subject: `session:${S2.replace(/[^0-9A-Za-z]/g, '')}`, ts: now, seq: seq(now), data: {
    turn: 1, did_work: false, claim: false, cause: 'agent_crashed', outcome: 'failed', signature: 'sig:0123456789abcdef', owner: 'you',
    usage: { covers: 'turn', model: 'claude-haiku-5-5', input: { value: 10, exact: true }, cached: { value: 0, exact: true }, output: { value: 1, exact: true }, context_fill: 0.01, cost: { usd: 0, basis: 'reported' } },
  } });
  now += 1000;
  await asks.tick();
  const crashed = (await open())[0]?.ask;
  expect(crashed, 'the crashed agent\'s block raised its task').toBeDefined();
  expect(await status(crashed!), 'a block that is no sign-in waits for its batch').toBe('queued');

  // A lapsed sign-in shows at once: the work it stopped waits on you, and nothing else will show it for hours.
  await stopped(S1, 'a');
  const lapsed = (await open()).find((r) => r.ask !== crashed)?.ask;
  expect(lapsed, 'the lapsed sign-in raised its task').toBeDefined();
  expect(await status(lapsed!), 'a lapsed sign-in shows at once').toBe('shown');
  expect(await status(crashed!), 'and the crashed agent\'s block still waits').toBe('queued');

  // The task a Send raises before any stop is the same one, so close it and raise the next from a Send.
  readings.set('claude-code', { signedIn: true, account: 'acct-1', at: now });
  await asks.tick();
  now += 1000;
  await asks.tick();
  expect(await status(lapsed!), 'the signed-in reading closes it').toBe('closed');
  const sent = await asks.signIn(core, 'claude-code', 'req:0123456789abcdef');
  expect(sent).not.toBe(lapsed);
  expect(await status(sent), 'a Send\'s sign-in task shows at once').toBe('shown');
  expect(await status(crashed!), 'and the crashed agent\'s block still waits for its batch').toBe('queued');
});

/** A session started in its own folder, as the hook records it. */
async function started(session: string, folder: string): Promise<void> {
  await record.append(hook(session), { v: 1, id: ulid(now), kind: 'session.start', ts: now, seq: seq(now), data: { agent: 'claude-code', worktree: join(dir, folder), branch: 'main', thread: session } });
  now += 1000;
}
/** That session's turn ends on a lapsed sign-in, then a tick. */
async function lapses(session: string): Promise<void> {
  await record.append(hook(session), { v: 4, id: ulid(now), kind: 'agent.stop', subject: `session:${session.replace(/[^0-9A-Za-z]/g, '')}`, ts: now, seq: seq(now), data: {
    turn: 1, did_work: false, claim: false, cause: 'sign_in_required', outcome: 'failed', signature: signInSignature('claude-code'), owner: 'you',
    usage: { covers: 'turn', model: 'claude-haiku-5-5', input: { value: 10, exact: true }, cached: { value: 0, exact: true }, output: { value: 1, exact: true }, context_fill: 0.01, cost: { usd: 0, basis: 'reported' } },
  } });
  now += 1000;
  await asks.tick();
}
const signInStatus = async () => (await asks.inbox()).find((r) => r.status !== 'closed' && r.kind === 'unblock')?.status;

it('with no batches, a lapsed sign-in after the message you typed shows at once: the stopped agent takes no step that reads it (#22)', async () => {
  await started(S1, 'a');
  await record.append(hook(S1), { v: 1, id: ulid(now), kind: 'user.ask', ts: now, seq: seq(now), data: { msg: 1, text: 'Add a README line, then stop.', tasks: [], from: 'person' } });
  now += 1000;
  await lapses(S1);
  expect(await signInStatus(), 'the sign-in task is shown, not held for a step the stopped agent won\'t take').toBe('shown');
});

it('under setup\'s 8-hour batches a lapsed sign-in in a session that keeps asking shows at once, not folded into its exception (#22)', async () => {
  const config = join(dir, 'config.json');
  const settings = JSON.parse(readFileSync(config, 'utf8'));
  settings.asks.batch = { every: '8h', cap: 20 };
  writeFileSync(config, JSON.stringify(settings));
  now = T0 + 4 * 3_600_000 + 60_000;
  await started(S1, 'a');
  const taste = askSources().find((r) => r.kind === 'taste')!.source;
  for (const k of [1, 2, 3, 4, 5, 6]) {
    await asks.raise({ ...core, session: S1 }, taste, {
      kind: 'taste', question: `Which header for screen ${k}?`, options: [{ id: 'blue', label: 'Blue', decision: 'none' }, { id: 'green', label: 'Green', decision: 'none' }], recommended: 'green',
      fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(new TextEncoder().encode(`taste:screen-${k}`)), pinned_to: { kind: 'evidence', ref: sha256Hex(new TextEncoder().encode(`screen-${k}`)) },
    });
    now += 1000;
  }
  const rows = await asks.inbox();
  expect(rows.some((r) => r.kind === 'exception'), 'the sixth taste call raised the session\'s exception').toBe(true);
  await lapses(S1);
  expect(await signInStatus(), 'the sign-in task is shown at once, not folded to wait for the exception\'s batch').toBe('shown');
  expect((await asks.inbox()).filter((r) => r.kind === 'taste' && r.status !== 'closed').map((r) => r.status), 'the taste calls still wait for their batch').not.toContain('shown');
});

it('under setup\'s 8-hour batches an agent\'s ask that names a sign-in probe waits for its batch: only the core files a sign-in task (#22)', async () => {
  const config = join(dir, 'config.json');
  const settings = JSON.parse(readFileSync(config, 'utf8'));
  settings.asks.batch = { every: '8h', cap: 20 };
  writeFileSync(config, JSON.stringify(settings));
  now = T0 + 4 * 3_600_000 + 60_000;
  await started(S1, 'a');
  const fixture = askSources().find((r) => r.source === 'deep_ask.unblock')!.fixture.ask as Obj;
  const agent: Connection = { writer: `mcp:${S1}`, ...who, session: S1 };
  const handle = await asks.raise(agent, 'deep_ask.unblock', { ...structuredClone(fixture), deadline: now + 2 * 86_400_000, proves: 'claude-code sign-in probe' });
  expect((await asks.inbox()).find((r) => r.ask === handle)?.status, 'an agent\'s word that its ask is a sign-in skips no batch').toBe('queued');
});

it('under setup\'s 8-hour batches a lapsed sign-in in a session whose agent the record never named shows at once, by its sign-in signature (#22)', async () => {
  const config = join(dir, 'config.json');
  const settings = JSON.parse(readFileSync(config, 'utf8'));
  settings.asks.batch = { every: '8h', cap: 20 };
  writeFileSync(config, JSON.stringify(settings));
  now = T0 + 4 * 3_600_000 + 60_000;
  await lapses(S1);
  expect(await signInStatus(), 'the task the sign-in probe closes shows at once').toBe('shown');
});
