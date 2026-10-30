// The asks core's rules that #318's scope and "Done when" add beyond its acceptance suite: a provisional
// choice offered again when a change touches what it decided, an ask whose attempt was replaced closing as
// moot, a repeated question joining its open record, and no agent's event closing an ask.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord, RecordError, type Connection, type Event, type RecordStore } from '@deepbuild/record';
import { openAsks, type Asks, type Delivery } from '../src/index.js';

type Obj = { [key: string]: JsonValue };
const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const HOUR = 3_600_000;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const who = { actor: 'you', scope: 'you' };
const hook = (session: string): Connection => ({ writer: 'hook', ...who, session });
const agent = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session });
const card: Connection = { writer: 'app', ...who };

let n = 0;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const id = (ms: number): string => {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let k = ++n, i = 0; i < 16; i++, k = Math.floor(k / 32)) tail = CROCKFORD[k % 32] + tail;
  return time + tail;
};

const taste = (subject: string, over: Obj = {}): Obj => ({
  kind: 'taste', question: `Which ${subject}?`,
  options: [{ id: 'blue', label: 'Blue', decision: 'none' }, { id: 'green', label: 'Green', decision: 'none' }],
  recommended: 'blue', deadline: T0 + 72 * HOUR, fallback: 'you', default: 'blue', provisional: false, owner: 'you',
  key: sha(`taste:${subject}`), pinned_to: { kind: 'evidence', ref: sha(subject) }, ...over,
});
const choice = (subject: string, over: Obj = {}): Obj => ({
  ...taste(subject), kind: 'choice', question: `Keep ${subject} on SQLite?`,
  options: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
  recommended: 'sqlite', default: 'sqlite', key: sha(`choice:${subject}`), ...over,
});

let dir: string;
let now: number;
let record: RecordStore;
let asks: Asks;
let deliveries: Delivery[];
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-asks-'));
  now = T0;
  record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
  deliveries = [];
  asks = await openAsks({ record, now: () => now, deliver: (d) => { deliveries.push(d); } });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

const append = (connection: Connection, kind: string, data: JsonValue, subject?: string) =>
  record.append(connection, { v: 1, id: id(now), kind, ts: now, data, ...(subject ? { subject } : {}) });
const start = (session: string, thread: string, worktree = join(dir, 'none')) =>
  append(hook(session), 'session.start', { agent: 'claude-code', worktree, branch: 'main', thread });
const events = async (kind: string): Promise<Event[]> => (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === kind);
const outcome = async (handle: string): Promise<unknown> => (await record.table('asks')).rows.find((r) => r.id === handle.slice(4))?.outcome;
const shown = async (): Promise<string[]> => (await asks.needsYou()).map((c) => c.ask);

function repo(): { path: string; commit(file: string, text: string): string } {
  const path = join(dir, 'repo');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: path, encoding: 'utf8' }).trim();
  execFileSync('git', ['init', '-q', '-b', 'main', path]);
  return {
    path,
    commit(file, text) {
      mkdirSync(dirname(join(path, file)), { recursive: true });
      writeFileSync(join(path, file), `${text}\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `change ${file}`);
      return git('rev-parse', 'HEAD');
    },
  };
}

describe('a provisional choice whose decided files a change touches', () => {
  for (const touched of [true, false]) {
    it(touched ? 'is offered again, pinned to the new commit' : 'is not offered again when the change leaves its files alone', async () => {
      const git = repo();
      git.commit('src/a.ts', 'export const a = 1;');
      const pin = git.commit('src/store.ts', 'export const store = "sqlite";');
      await start('S1', 'T1', git.path);
      const first = await asks.raise(agent('S1'), 'deep_ask.choice', choice('store', { provisional: true, pinned_to: { kind: 'commit', ref: pin } }));
      // The agent goes on with SQLite: what it edits under the provisional choice is what the choice decided.
      await append(hook('S1'), 'tool.after', { kind: 'edit', paths: [join(git.path, 'src/store.ts')], command: null });
      const moved = git.commit(touched ? 'src/store.ts' : 'src/a.ts', 'export const changed = true;');
      now += HOUR;
      await asks.tick();
      const created = await events('ask.created');
      const superseded = (await events('ask.superseded')).filter((e) => e.subject === first);
      if (!touched) {
        expect([created.length, superseded.length, await outcome(first)]).toEqual([1, 0, 'unanswered']);
        return;
      }
      expect(created, 'the choice is offered again').toHaveLength(2);
      const again = created[1]!;
      expect((again.data as Obj).pinned_to).toEqual({ kind: 'commit', ref: moved });
      expect((again.data as Obj).provisional).toBe(true);
      expect(superseded.map((e) => (e.data as Obj).by)).toEqual([`ask:${again.id}`]);
      expect(await shown()).toEqual([`ask:${again.id}`]);
    });
  }
});

describe('an ask whose attempt was replaced', () => {
  for (const replaced of [true, false]) {
    it(replaced ? 'closes as moot, naming the attempt that replaced it' : 'stays open when another task gets a new attempt', async () => {
      const task = 'task:01K74FX2B4D6F8H0K2M4P6R8T0';
      const commit = '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46';
      await start('S1', 'T1');
      await start('S2', 'T2');
      await append(hook('S1'), 'claim.made', { task_ref: task, attempt: 1, commit, scope: 'task' });
      const handle = await asks.raise(agent('S1'), 'deep_ask.taste', taste('header'));
      await append(hook('S2'), 'claim.made', { task_ref: replaced ? task : 'task:01K74FX2B4D6F8H0K2M4P6R8T1', attempt: 2, commit, scope: 'task' });
      await asks.tick();
      const moot = (await events('ask.moot')).filter((e) => e.subject === handle).map((e) => e.data);
      expect(moot).toEqual(replaced ? [{ because: 'attempt_replaced', session: 'session:S2' }] : []);
      expect(await outcome(handle)).toBe(replaced ? 'moot' : 'unanswered');
    });
  }
});

describe('a repeated question', () => {
  it('joins the open ask with its kind, normalized question and pin in its thread: one record', async () => {
    await start('S1', 'T1');
    await start('S2', 'T1'); // the same thread under a rotated ID
    const first = await asks.raise(agent('S1'), 'deep_ask.taste', taste('header'));
    const again = await asks.raise(agent('S2'), 'deep_ask.taste', taste('header', { question: '  which   HEADER?? ' }));
    expect(again).toBe(first);
    expect(await events('ask.created')).toHaveLength(1);
    expect(await shown()).toEqual([first]);
  });
  it('is a new record, superseding the old, once what it shows changed', async () => {
    await start('S1', 'T1');
    const first = await asks.raise(agent('S1'), 'deep_ask.taste', taste('header'));
    const changed = await asks.raise(agent('S1'), 'deep_ask.taste', taste('header', { pinned_to: { kind: 'evidence', ref: sha('header v2') } }));
    expect(changed).not.toBe(first);
    expect(await outcome(first)).toBe('superseded');
  });
});

describe('no agent closes an ask', () => {
  for (const kind of ['ask.cancelled', 'ask.escalated', 'ask.superseded', 'ask.moot']) {
    for (const writer of [hook, agent]) {
      it(`${kind} from ${writer('S1').writer} leaves it open in Needs you and in the asks table`, async () => {
        await start('S1', 'T1');
        const handle = await asks.raise(agent('S1'), 'deep_ask.taste', taste('header'));
        const data: Record<string, Obj> = {
          'ask.cancelled': { answer: 'never mind', plan_hash: null, decision: 'none' },
          'ask.escalated': { answer: 'up', plan_hash: null, decision: 'none' },
          'ask.superseded': { by: handle },
          'ask.moot': { because: 'attempt_replaced', session: 'session:S1' },
        };
        // The record may refuse the agent's event outright; if it takes it, the ask stays open.
        await append(writer('S1'), kind, data[kind]!, handle).catch((error: unknown) => expect(error).toBeInstanceOf(RecordError));
        await asks.tick();
        expect(await shown()).toEqual([handle]);
        expect(await outcome(handle)).toBe('unanswered');
        // Your answer still closes it.
        await asks.answer(card, handle, { option: 'green' });
        expect(await outcome(handle)).toBe('answered');
      });
    }
  }
});

describe('a taste call that dropped near copies (#394)', () => {
  it('names each dropped copy only beside an option it still offers', async () => {
    await start('S1', 'T1');
    const copy = { option: 'teal', same_as: 'blue' };
    const handle = await asks.raise(agent('S1'), 'deep_ask.taste', taste('header', { dropped: [copy] }));
    expect((await events('ask.created')).find((e) => e.id === handle.slice(4))?.data).toMatchObject({ dropped: [copy] });
    for (const wrong of [{ option: 'green', same_as: 'blue' }, { option: 'teal', same_as: 'red' }]) {
      await expect(asks.raise(agent('S1'), 'deep_ask.taste', taste('footer', { dropped: [wrong] }))).rejects.toMatchObject({ option: wrong.option });
    }
    expect((await events('ask.created')).length).toBe(1);
  });
});

describe('a block someone else owns (#320)', () => {
  const block = (subject: string, over: Obj = {}): Obj => ({
    kind: 'unblock', question: `Renew ${subject}?`,
    options: [{ id: 'done', label: 'I did it', decision: 'none' }, { id: 'wait', label: 'Leave it blocked', decision: 'none' }],
    recommended: 'done', deadline: T0 + 48 * HOUR, fallback: 'you', default: 'wait', provisional: false, owner: 'sam',
    key: sha(`unblock:${subject}`), pinned_to: { kind: 'evidence', ref: sha(subject) },
    steps: [`Renew ${subject}`], where: 'the staging console', why: 'the release job needs it', unblocks: ['task:01K74FX2B4D6F8H0K2M4P6R8T0'], proves: `${subject}.check`,
    ...over,
  });
  const requestOf = async (handle: string) => (await asks.inbox()).find((r) => r.request?.block === handle);

  it('stays BLOCKED at its deadline, by the default its raiser named, though it never showed to you', async () => {
    await start('S1', 'T1');
    const handle = await asks.raise(agent('S1'), 'deep_ask.unblock', block('db-credentials'));
    now = T0 + 48 * HOUR;
    await asks.tick();
    expect((await events('ask.defaulted')).filter((e) => e.subject === handle).map((e) => (e.data as Obj).answer)).toEqual(['wait']);
    expect(deliveries.filter((d) => d.ask === handle)).toMatchObject([{ option: 'wait', decision: 'none' }]);
  });

  it('takes its request with it when its check passes', async () => {
    await start('S1', 'T1');
    const handle = await asks.raise(agent('S1'), 'deep_ask.unblock', block('db-credentials'));
    const request = (await requestOf(handle))!.ask;
    const claim = 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H';
    await record.append({ writer: 'core', ...who, session: 'S1' }, { v: 1, id: id(now), kind: 'verdict.made', subject: claim, ts: now, data: {
      outcome: 'PASS', verdict: 'verdict:01K74G4B6D8F0H2K4M6P8R0T2V', claim, reasons: [], smallest: null, points_to: null, commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46',
      requirements: [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome: 'PASS', check: 'db-credentials.check', depth: 'unit', oracle: 'code', runs: { clean: 1, needed: 1, counted: ['run:01K74G3A5C7E9G1J3M5P7R9T1V'] }, smallest: null, points_to: null, evidence: [], proof: 'test_run' }],
      key: { commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46', doc_revisions: [], check_digests: [], state_digests: [], environment: 'node-24.22.0/darwin-arm64', tools: [] },
    } });
    await asks.tick();
    expect(await outcome(handle)).toBe('moot');
    expect(await outcome(request)).toBe('moot');
    expect(await shown()).toEqual([]);
  });

  it('asked again on the same subject: the newer request supersedes the older, so you see one', async () => {
    await start('S1', 'T1');
    const older = await asks.raise(agent('S1'), 'deep_ask.unblock', block('db-credentials'));
    const first = (await requestOf(older))!.ask;
    now += HOUR;
    const newer = await asks.raise(agent('S1'), 'deep_ask.unblock', block('db-credentials', { question: 'Renew the staging credentials, again?', pinned_to: { kind: 'evidence', ref: sha('v2') } }));
    const second = (await requestOf(newer))!.ask;
    expect(await outcome(first)).toBe('superseded');
    expect(await shown()).toEqual([second]);
  });

  it("isn't one of your asks, so raising it folds nothing into an exception", async () => {
    await start('S1', 'T1');
    for (const subject of ['a', 'b', 'c', 'd']) await asks.raise(agent('S1'), 'deep_ask.taste', taste(subject));
    await asks.raise(agent('S1'), 'deep_ask.unblock', block('db-credentials'));
    await asks.raise(agent('S1'), 'deep_ask.unblock', block('fixtures-bucket'));
    // Four of yours and two drafted requests: no exception yet, and all six show.
    expect((await asks.inbox()).filter((r) => r.kind === 'exception')).toEqual([]);
    expect(await shown()).toHaveLength(6);
  });
});

describe('#349 resolvers are consulted outside the core\'s lock', () => {
  it('a resolver that reads the core while it answers doesn\'t deadlock raise: the ask is raised, and its refusals read empty', async () => {
    let read: unknown;
    asks.registerResolver('reader', async (a) => { read = await asks.refusals(a.ask); return undefined; });
    const raised = asks.raise(agent('S1'), 'deep_ask.taste', taste('header'));
    const timer = new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 3_000));
    const handle = await Promise.race([raised, timer]);
    expect(handle, 'raise returned while the resolver read the core').toMatch(/^ask:/);
    expect(read).toEqual([]);
    expect(await asks.refusals(handle as string)).toEqual([]);
  });
});

// The resolver gate (#349) against what main writes beside it: #667's overrule, and the decisions the hub saves from
// your inbox answer, whose scope names the ask's project and strips the session ID to letters and digits.
describe('the resolver gate reads every decision the record holds, however it was written', () => {
  const core: Connection = { writer: 'core', ...who };
  const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');
  const appendAs = (connection: Connection, eventId: string, kind: string, data: JsonValue, subject?: string) =>
    record.append(connection, { v: 1, id: eventId, kind, ts: now, data, ...(subject ? { subject } : {}) });

  it('a decision you overruled covers nothing: a resolver naming it is refused naming it, nothing is applied, and it can\'t be revoked again', async () => {
    await start('S1', 'T1');
    await start('S2', 'T2');
    const first = await asks.raise(agent('S1'), 'deep_ask.taste', taste('header'));
    await asks.answer(card, first, { option: 'green' });
    const decision = await asks.saveDecision(card, first, 'all');
    await append(core, 'decision.overruled', { decision }, decision);
    const off = asks.registerResolver('test/resolver', () => ({ answer: 'green', because: decision }));
    try {
      const again = await asks.raise(agent('S2'), 'deep_ask.taste', taste('header'));
      expect((await events('decision.applied')).map((e) => e.data)).toEqual([]);
      expect(await asks.refusals(again)).toMatchObject([{ ask: again, resolver: 'test/resolver', decision, reason: expect.stringContaining(decision) }]);
      expect(await outcome(again)).toBe('unanswered');
      await expect(asks.revokeDecision(card, decision)).rejects.toThrow(/already revoked/);
    } finally {
      off();
    }
  });

  it('a decision the hub saved as repo:<the ask\'s project> covers an ask of a session in that project', async () => {
    const session = 'claude-0001-abcd';
    await append({ ...hook(session), project: 'shop' }, 'session.start', { agent: 'claude-code', worktree: join(dir, 'shop'), branch: 'main', thread: 'T1' });
    const decisionId = id(now);
    await appendAs({ ...core, session, project: 'shop' }, decisionId, 'decision.created', { key: sha('taste:header'), scope: 'repo:shop', answer: 'green', ask: `ask:${id(now)}` });
    const decision = `decision:${decisionId}`;
    const off = asks.registerResolver('test/resolver', () => ({ answer: 'green', because: decision }));
    try {
      const handle = await asks.raise({ ...agent(session), project: 'shop' }, 'deep_ask.taste', taste('header'));
      expect(await asks.refusals(handle)).toEqual([]);
      expect((await events('decision.applied')).map((e) => e.data)).toEqual([{ decision, ask: handle }]);
      expect(await outcome(handle)).toBe('decided_for_you');
    } finally {
      off();
    }
  });

  it('a decision the hub saved as session:<the session\'s letters and digits> covers that session\'s asks', async () => {
    const session = 'claude-0002-abcd';
    await start(session, 'T1');
    const decisionId = id(now);
    await appendAs({ ...core, session }, decisionId, 'decision.created', { key: sha('choice:store'), scope: `session:${letters(session)}`, answer: 'files', ask: `ask:${id(now)}` });
    const decision = `decision:${decisionId}`;
    const off = asks.registerResolver('test/resolver', () => ({ answer: 'files', because: decision }));
    try {
      const handle = await asks.raise(agent(session), 'deep_ask.choice', choice('store'));
      expect(await asks.refusals(handle)).toEqual([]);
      expect((await events('decision.applied')).map((e) => e.data)).toEqual([{ decision, ask: handle }]);
      const other = await asks.raise(agent('S9'), 'deep_ask.choice', choice('store'));
      expect(await asks.refusals(other)).toMatchObject([{ decision, reason: expect.stringContaining('cover') }]);
    } finally {
      off();
    }
  });

  it('forgets an ended session once 64 newer ones ended, but never one with an ask open (#824)', async () => {
    await start('SOPEN', 'TOPEN');
    await start('SDONE', 'TDONE');
    const open = await asks.raise(agent('SOPEN'), 'deep_ask.taste', taste('open'));
    const done = await asks.raise(agent('SDONE'), 'deep_ask.taste', taste('done'));
    await asks.answer(card, done, { option: 'green' });
    await append(hook('SOPEN'), 'session.end', { reason: 'other' });
    await append(hook('SDONE'), 'session.end', { reason: 'other' });
    const rows = async (): Promise<string[]> => (await asks.inbox()).map((row) => row.ask);
    expect(await rows()).toEqual([open, done]);
    await start('SLIVE', 'TLIVE');
    const live = await asks.raise(agent('SLIVE'), 'deep_ask.taste', taste('live'));
    await asks.answer(card, live, { option: 'green' });
    await append({ ...hook('SLIVE'), verified: false }, 'session.end', { reason: 'other' });
    for (let i = 0; i < 64; i++) {
      await start(`E${i}`, `E${i}`);
      await append(hook(`E${i}`), 'session.end', { reason: 'other' });
    }
    expect(await rows(), 'an unverified end ends nothing').toEqual([open, live]);
    await expect(asks.card(done)).rejects.toThrow('is no ask');
    expect(await outcome(done)).toBe('answered');
    await asks.answer(card, open, { option: 'blue' });
    expect(await outcome(open)).toBe('answered');
  });
});
