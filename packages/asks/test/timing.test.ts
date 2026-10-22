// When asks show and close (#319), in the cases its acceptance suite doesn't reach: settings files that don't
// parse, Later on the fold's exception, what the exception leaves behind once it closes, an ask first seen after
// its deadline passed while the hub was down, and showings recorded under each ask's own identity.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord, type Connection, type Event, type RecordStore } from '@deepbuild/record';
import { AskRefused, askSources, draftAskSettings, openAsks, type AskKind, type Asks, type Delivery } from '../src/index.js';

type Obj = { [key: string]: JsonValue };
const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const you = { actor: 'you', scope: 'you' };
const core = (session: string, who = you): Connection => ({ writer: 'core', ...who, session });
const card: Connection = { writer: 'app', ...you };

const OPTIONS: Record<string, Obj[]> = {
  taste: [{ id: 'blue', label: 'Blue', decision: 'none' }, { id: 'green', label: 'Green', decision: 'none' }],
  authority: [{ id: 'push', label: 'Push it', decision: 'allow' }, { id: 'hold', label: 'Hold it', decision: 'deny' }],
  unblock: [{ id: 'done', label: 'I did it', decision: 'none' }, { id: 'wait', label: 'Leave it blocked', decision: 'none' }],
};
const RECOMMENDED: Record<string, string> = { taste: 'green', authority: 'push', unblock: 'done' };
/** An ask with its deadline and, where your settings name it, its default left to your settings. */
const ask = (kind: AskKind, subject: string, over: Obj = {}): Obj => ({
  kind, question: `Which way for ${subject}?`, options: structuredClone(OPTIONS[kind]!), recommended: RECOMMENDED[kind]!,
  fallback: 'you', provisional: false, owner: 'you', key: sha(`${kind}:${subject}`), pinned_to: { kind: 'evidence', ref: sha(subject) },
  ...(kind === 'unblock' ? { default: 'wait', steps: ['Run gh auth login'], where: 'your terminal', why: 'the push needs a token', unblocks: ['task:01K74FX2B4D6F8H0K2M4P6R8T0'], proves: 'auth.unit' } : {}),
  ...over,
});
const sourceOf = (kind: AskKind): string => askSources().find((r) => r.kind === kind)!.source;

let n = 0;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const id = (ms: number): string => {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let k = ++n, i = 0; i < 16; i++, k = Math.floor(k / 32)) tail = CROCKFORD[k % 32] + tail;
  return time + tail;
};

let dir: string;
let home: string;
let now: number;
let record: RecordStore;
let asks: Asks;
let deliveries: Delivery[];
const open = async (): Promise<void> => {
  record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
  asks = await openAsks({ record, now: () => now, deliver: (d) => { deliveries.push(d); }, home });
};
/** Your settings: drafted at setup, with batches every 8 hours unless a test says otherwise. */
const settings = (batch: Obj = { every: '8h', cap: 10 }): void => {
  const config = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as Obj;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ ...config, asks: { ...(config.asks as Obj), batch } }));
};
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-asks-timing-'));
  home = join(dir, 'home');
  now = T0;
  deliveries = [];
  await draftAskSettings(home);
  settings();
  await open();
});
afterEach(async () => {
  await record.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

const start = (session: string, thread = session) =>
  record.append({ writer: 'hook', ...you, session }, { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: join(dir, 'none'), branch: 'main', thread } });
const events = async (kind: string): Promise<Event[]> => (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === kind);
const about = async (handle: string, kind: string): Promise<Event[]> => (await events(kind)).filter((e) => e.subject === handle);
const shown = async (): Promise<string[]> => (await asks.needsYou()).map((c) => c.ask);
const at = async (ms: number): Promise<void> => { now = ms; await asks.tick(); };
/** Five taste asks in one session, then a sixth ask that folds; returns the folded one and its exception. */
async function fold(session: string, sixth: Obj): Promise<{ folded: string; exception: string }> {
  for (const k of [1, 2, 3, 4, 5]) await asks.raise(core(session), sourceOf('taste'), ask('taste', `${session} screen ${k}`));
  const folded = await asks.raise(core(session), sourceOf(sixth.kind as AskKind), sixth);
  const exception = (await asks.needsYou()).find((c) => c.folded.includes(folded))?.ask;
  expect(exception, `ask ${folded} folds into an exception that shows`).toBeDefined();
  return { folded, exception: exception! };
}

describe('settings files', () => {
  it('a config.json that does not parse declares nothing: raise is refused naming the value, and setup leaves the file as it is', async () => {
    const broken = '{ "asks": { "deadline": ';
    writeFileSync(join(home, 'config.json'), broken);
    await start('S1');
    const refusal = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header')).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(AskRefused);
    expect((refusal as AskRefused).message).toMatch(/asks\.deadline\.taste/);
    await expect(asks.tick()).resolves.toBeUndefined();
    await expect(draftAskSettings(home)).rejects.toThrow(/isn't valid JSON/);
    expect(readFileSync(join(home, 'config.json'), 'utf8')).toBe(broken);
  });

  it('a repo done.yaml asks block written as block maps, with comments, overrides your deadline for that kind only', async () => {
    const repo = join(dir, 'repo');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(repo, '.deepbuild'), { recursive: true });
    writeFileSync(join(repo, '.deepbuild', 'done.yaml'), [
      'checks:', '  unit: { type: command, run: "npm test" }', 'asks:   # values the rules leave open',
      '  deadline:', '    taste: 5d   # a slower repo', '  fallback:', '    - change-owner', '    - queue:shop-team', '',
    ].join('\n'));
    await record.append({ writer: 'hook', ...you, session: 'S1' }, { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: repo, branch: 'main', thread: 'S1' } });
    const taste = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
    const authority = await asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'main'));
    const created = await events('ask.created');
    expect(created.find((e) => `ask:${e.id}` === taste)?.data).toMatchObject({ deadline: T0 + 5 * DAY });
    expect(created.find((e) => `ask:${e.id}` === authority)?.data).toMatchObject({ deadline: T0 + DAY });
  });

  it('a done.yaml asks block the reader cannot follow leaves the repo\'s asks BLOCKED, naming the line, not your settings in its place', async () => {
    const repo = join(dir, 'repo');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(repo, '.deepbuild'), { recursive: true });
    await record.append({ writer: 'hook', ...you, session: 'S1' }, { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: repo, branch: 'main', thread: 'S1' } });
    const unread = [
      ['asks: { deadline: { authority: 12h } }'],
      ['asks:', '  deadline: { authority: 12h, taste: { soon: 1h } }'],
      ['asks:', '  deadline:', '    authority:', '      soon: 1h'],
      ['asks:', '  deadline authority 12h'],
      ['asks:', '  - change-owner'],
      ['asks:', '  deadline:', '    taste: 5d', '    - change-owner'],
      ['asks:', '    deadline:', '      taste: 5d', '  fold: 3'],
      ['asks:', '  deadline: { authority }'],
      ['asks:', '  deadline: { taste: [5d, x: 6d] }'],
    ];
    for (const lines of unread) {
      writeFileSync(join(repo, '.deepbuild', 'done.yaml'), [...lines, ''].join('\n'));
      const refusal = await asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'main')).catch((e: unknown) => e);
      expect(refusal, lines.join(' / ')).toBeInstanceOf(AskRefused);
      expect((refusal as AskRefused).message, lines.join(' / ')).toMatch(/^BLOCKED: .*done\.yaml line \d+/);
    }
    expect(await events('ask.created')).toEqual([]);
  });
});

describe('the fold', () => {
  it('Later on the exception never passes the earliest deadline among the asks it holds', async () => {
    settings({}); // no batches: every ask shows when it's raised
    await start('S1');
    // The exception takes the 2-day deadline of the ask it was raised for; a 1-day approval joins it later.
    const { exception } = await fold('S1', ask('taste', 'S1 footer', { deadline: T0 + 2 * DAY }));
    const approval = await asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'main'));
    expect((await asks.card(exception)).folded).toContain(approval);
    const refusal = await asks.later(card, exception, T0 + DAY + HOUR).catch((e: unknown) => e);
    expect((refusal as AskRefused).field).toBe('until');
    expect(await about(exception, 'ask.later')).toEqual([]);
    // Nor does such a Later hide it when it reaches the log some other way.
    await record.append(core('S1'), { v: 1, id: id(now), kind: 'ask.later', ts: now, subject: exception, data: { until: T0 + DAY + HOUR } });
    expect(await shown()).toContain(exception);
  });

  it('left to its defaults, the exception is not raised again for the asks it held, which close at their own deadlines', async () => {
    settings({ every: '2d', cap: 10 });
    await start('S1');
    // Due in a day, before the next batch: the exception shows at once.
    const { folded, exception } = await fold('S1', ask('taste', 'S1 footer', { deadline: T0 + DAY }));
    await asks.answer(card, exception, { option: 'defaults' });
    const exceptions = async () => (await events('ask.created')).filter((e) => (e.data as Obj).kind === 'exception');
    expect(await exceptions()).toHaveLength(1);
    expect(await shown()).not.toContain(folded);
    expect((await asks.inbox()).find((r) => r.ask === folded)?.status).toBe('folded');
    // A new ask from the session is a new question: its own exception holds it, not the ones you left.
    const seventh = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'S1 sidebar'));
    const second = (await exceptions()).at(-1)!;
    expect((await asks.card(`ask:${second.id}`)).folded).toEqual([seventh]);
    expect(await exceptions()).toHaveLength(2);
    await at(T0 + DAY);
    expect((await about(folded, 'ask.defaulted')).map((e) => (e.data as Obj).answer)).toEqual(['green']);
  });

  it('answered together, an approval and an unblock it held get their own cards and keep their own defaults', async () => {
    settings({ every: '2d', cap: 10 });
    await start('S1');
    const { folded: approval, exception } = await fold('S1', ask('authority', 'main'));
    const unblock = await asks.raise(core('S1'), sourceOf('unblock'), ask('unblock', 'gh sign-in'));
    await asks.answer(card, exception, { option: 'together' });
    expect(await about(approval, 'ask.answered')).toEqual([]);
    expect(await about(unblock, 'ask.answered')).toEqual([]);
    const left = await shown();
    expect(left).toContain(approval);
    expect(left).toContain(unblock);
    await at(T0 + DAY);
    expect((await about(approval, 'ask.defaulted')).map((e) => (e.data as Obj).decision)).toEqual(['deny']);
  });

  it('an ask that joins an exception already shown, from a turn that has not read your message, waits there for the agent\'s next step', async () => {
    await start('S1');
    for (const k of [1, 2, 3, 4, 5, 6]) await asks.raise(core('S1'), sourceOf('taste'), ask('taste', `screen ${k}`));
    // The 16:00 batch shows the exception.
    await at(T0 + 4 * HOUR);
    const exception = (await asks.needsYou()).find((c) => c.folded.length > 0)!.ask;
    const hook = { writer: 'hook', ...you, session: 'S1' };
    await record.append(hook, { v: 1, id: id(now), kind: 'user.ask', ts: now, data: { msg: 1, text: 'use the brand blue', tasks: [], from: 'person' } });
    const held = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'footer'));
    expect((await asks.card(exception)).folded).not.toContain(held);
    expect((await events('ask.batched')).flatMap((e) => ((e.data as Obj).asks as Obj[]).map((a) => a.ask))).not.toContain(held);
    await asks.answer(card, exception, { option: 'together' });
    expect(await about(held, 'ask.answered')).toEqual([]);
    await record.append(hook, { v: 1, id: id(now), kind: 'tool.before', ts: now, data: { kind: 'read', paths: ['src/a.ts'], command: null } });
    // Freed by the answer together, it waits on its own card for the next batch, at midnight.
    await at(T0 + 12 * HOUR);
    expect(await shown()).toContain(held);
  });

  it.each([
    ['due before the next batch', { every: '8h', cap: 10 }, { deadline: T0 + 6 * HOUR }],
    ['with no batches to wait for', {}, {}],
  ])('an ask held for your message that joins an exception already shown still shows there when %s', async (_, batch, over) => {
    settings(batch);
    await start('S1');
    for (const k of [1, 2, 3, 4, 5, 6]) await asks.raise(core('S1'), sourceOf('taste'), ask('taste', `screen ${k}`));
    await at(T0 + 4 * HOUR);
    const exception = (await asks.needsYou()).find((c) => c.folded.length > 0)!.ask;
    await record.append({ writer: 'hook', ...you, session: 'S1' }, { v: 1, id: id(now), kind: 'user.ask', ts: now, data: { msg: 1, text: 'use the brand blue', tasks: [], from: 'person' } });
    const held = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'footer', over));
    expect((await asks.card(exception)).folded).toContain(held);
    expect((await events('ask.batched')).flatMap((e) => ((e.data as Obj).asks as Obj[]).map((a) => a.ask))).toContain(held);
  });

  it('an ask held for your message when you leave the exception to its defaults gets its own card, not a default unseen', async () => {
    await start('S1');
    for (const k of [1, 2, 3, 4, 5, 6]) await asks.raise(core('S1'), sourceOf('taste'), ask('taste', `screen ${k}`));
    await at(T0 + 4 * HOUR);
    const exception = (await asks.needsYou()).find((c) => c.folded.length > 0)!.ask;
    const hook = { writer: 'hook', ...you, session: 'S1' };
    await record.append(hook, { v: 1, id: id(now), kind: 'user.ask', ts: now, data: { msg: 1, text: 'use the brand blue', tasks: [], from: 'person' } });
    const held = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'footer'));
    await asks.answer(card, exception, { option: 'defaults' });
    await record.append(hook, { v: 1, id: id(now), kind: 'tool.before', ts: now, data: { kind: 'read', paths: ['src/a.ts'], command: null } });
    await asks.tick();
    expect((await asks.inbox()).find((r) => r.ask === held)?.status).toBe('queued');
    await at(T0 + 12 * HOUR);
    expect(await shown()).toContain(held);
  });

  it('a provisional ask held for your message that joins an exception shows there at once when its session is held on it', async () => {
    await start('S1');
    for (const k of [1, 2, 3, 4, 5, 6]) await asks.raise(core('S1'), sourceOf('taste'), ask('taste', `screen ${k}`));
    await at(T0 + 4 * HOUR);
    const exception = (await asks.needsYou()).find((c) => c.folded.length > 0)!.ask;
    await record.append({ writer: 'hook', ...you, session: 'S1' }, { v: 1, id: id(now), kind: 'user.ask', ts: now, data: { msg: 1, text: 'use the brand blue', tasks: [], from: 'person' } });
    const held = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'footer', { provisional: true }));
    expect((await asks.card(exception)).folded).not.toContain(held);
    expect(await asks.holds('S1', { leaves_machine: true })).toEqual([held]);
    expect((await asks.card(exception)).folded).toContain(held);
  });

  it('an ask that folds into an exception already shown is recorded as shown before it can default', async () => {
    settings({ every: '2d', cap: 10 });
    await start('S1');
    const { exception } = await fold('S1', ask('authority', 'main'));
    now = T0 + HOUR;
    const late = await asks.raise(core('S1'), sourceOf('authority'), ask('authority', 'release'));
    expect((await asks.card(exception)).folded).toContain(late);
    const showing = (await events('ask.batched')).filter((e) => ((e.data as Obj).asks as Obj[]).some((a) => a.ask === late));
    expect(showing.map((e) => e.ts)).toEqual([T0 + HOUR]);
    await at(T0 + HOUR + DAY);
    expect(await about(late, 'ask.defaulted')).toHaveLength(1);
  });
});

describe('the hub stopped and started', () => {
  it('an ask whose deadline passed unseen while the hub was down shows at the start and defaults only on a later call', async () => {
    await start('S1');
    // Filed while the hub is down: nothing has shown it.
    const raised = id(now);
    await record.append(core('S1'), { v: 1, id: raised, kind: 'ask.created', ts: now, data: ask('taste', 'header', { deadline: T0 + 6 * HOUR, default: 'green' }) });
    const h = `ask:${raised}`;
    await record.close();
    // The hub starts a day later on a clock that moves between reads.
    now = T0 + DAY;
    const clock = { t: now };
    record = await openRecord({ path: join(dir, 'record.db'), now: () => clock.t++ });
    asks = await openAsks({ record, now: () => clock.t++, deliver: (d) => { deliveries.push(d); }, home });
    expect(await about(h, 'ask.defaulted')).toEqual([]);
    expect(await shown()).toContain(h);
    await asks.tick();
    expect(await about(h, 'ask.defaulted')).toHaveLength(1);
  });
});

describe('an ask past its deadline', () => {
  it('while hidden by Later, when the hub was down, shows again and defaults only on a later call', async () => {
    settings({});
    await start('S1');
    const h = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
    await asks.later(card, h, T0 + DAY);
    now = T0 + 4 * DAY;
    await asks.tick();
    expect(await about(h, 'ask.defaulted')).toEqual([]);
    expect(await shown()).toContain(h);
    await asks.tick();
    expect(await about(h, 'ask.defaulted')).toHaveLength(1);
  });

  it('that joined an exception hidden by Later, when the hub was down, shows with it and defaults only on a later call', async () => {
    settings({});
    await start('S1');
    const { exception } = await fold('S1', ask('taste', 'S1 footer'));
    await asks.later(card, exception, T0 + DAY);
    const joined = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'S1 term', { deadline: T0 + 2 * DAY }));
    now = T0 + 4 * DAY;
    await asks.tick();
    expect(await about(joined, 'ask.defaulted')).toEqual([]);
    expect((await asks.card(exception)).folded).toContain(joined);
    await asks.tick();
    expect(await about(joined, 'ask.defaulted')).toHaveLength(1);
  });

  it('first shown by one call defaults on the next, even on a clock that has not moved', async () => {
    await start('S1');
    const raised = id(now);
    await record.append(core('S1'), { v: 1, id: raised, kind: 'ask.created', ts: now, data: ask('taste', 'header', { deadline: T0 + HOUR, default: 'green' }) });
    const h = `ask:${raised}`;
    now = T0 + 2 * HOUR;
    await asks.tick();
    expect(await about(h, 'ask.defaulted')).toEqual([]);
    await asks.tick();
    expect(await about(h, 'ask.defaulted')).toHaveLength(1);
  });
});

describe('Later', () => {
  it('ends with a recorded showing, so the inbox and the asks table read the same before and after a rebuild', async () => {
    settings({});
    await start('S1');
    const h = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
    await asks.later(card, h, T0 + HOUR);
    const later = await asks.later(card, h, T0 + 3 * DAY).catch((e: unknown) => e);
    expect((later as AskRefused).field, 'a Later at the deadline itself is refused').toBe('until');
    now = T0 + 2 * HOUR;
    expect((await asks.inbox()).find((r) => r.ask === h)?.status, 'reading never ends a Later').toBe('later');
    await asks.tick();
    const back = (await events('ask.batched')).filter((e) => e.ts === T0 + 2 * HOUR && ((e.data as Obj).asks as Obj[]).some((a) => a.ask === h));
    expect(back).toHaveLength(1);
    expect((await asks.inbox()).find((r) => r.ask === h)?.status).toBe('shown');
    const row = async () => (await record.table('asks')).rows.find((r) => `ask:${String(r.id)}` === h)?.status;
    expect(await row()).toBe('open');
    await record.rebuild();
    expect(await row()).toBe('open');
  });

  it('on the exception ends early when an ask joins it due before the Later ends', async () => {
    settings({});
    await start('S1');
    const { exception } = await fold('S1', ask('taste', 'S1 footer'));
    await asks.later(card, exception, T0 + 2 * DAY);
    expect(await shown()).not.toContain(exception);
    const soon = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'S1 term', { deadline: T0 + 4 * HOUR }));
    expect((await asks.card(exception)).folded).toContain(soon);
    expect(await shown(), 'the exception is back in Needs you before the new ask can default').toContain(exception);
  });

  it('on a held ask ends when its session is held on it', async () => {
    settings({});
    await start('S1');
    const h = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header', { provisional: true }));
    await asks.later(card, h, T0 + DAY);
    expect(await asks.holds('S1', { leaves_machine: true })).toEqual([h]);
    expect(await shown()).toContain(h);
  });

  it('on a queued ask keeps it out of the next batch until the Later ends', async () => {
    await start('S1');
    const h = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
    // Batches fall every 8 hours from the epoch: 16:00 UTC comes before the Later ends at 18:00.
    await asks.later(card, h, T0 + 6 * HOUR);
    await at(T0 + 4 * HOUR);
    expect(await shown()).not.toContain(h);
    expect((await asks.inbox()).find((r) => r.ask === h)?.status).toBe('later');
    await at(T0 + 6 * HOUR);
    expect(await shown()).toContain(h);
  });

  it('keeps an ask out of the fold\'s answer together', async () => {
    settings({});
    await start('S1');
    const raised = [];
    for (const k of [1, 2, 3, 4, 5]) raised.push(await asks.raise(core('S1'), sourceOf('taste'), ask('taste', `screen ${k}`)));
    await asks.later(card, raised[0]!, T0 + HOUR);
    await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'footer'));
    const exception = (await asks.needsYou()).find((c) => c.folded.length > 0)!.ask;
    await asks.answer(card, exception, { option: 'together' });
    expect(await about(raised[0]!, 'ask.answered')).toEqual([]);
    expect(await about(raised[1]!, 'ask.answered')).toHaveLength(1);
  });

  it('goes on the exception, not an ask it holds, and a Later the core recorded on one keeps it out of the answer together', async () => {
    settings({});
    await start('S1');
    const { folded, exception } = await fold('S1', ask('taste', 'S1 footer'));
    const refusal = await asks.later(card, folded, T0 + HOUR).catch((e: unknown) => e);
    expect((refusal as AskRefused).field).toBe('ask');
    expect(await about(folded, 'ask.later')).toEqual([]);
    await record.append(core('S1'), { v: 1, id: id(now), kind: 'ask.later', ts: now, subject: folded, data: { until: T0 + HOUR } });
    await asks.answer(card, exception, { option: 'together' });
    expect(await about(folded, 'ask.answered')).toEqual([]);
  });
});

describe('the inbox and the asks table', () => {
  it('take Later and showings by the same rules: Later only as the core records it, before the deadline, and a showing only from the core under the ask\'s identity', async () => {
    const team = { actor: 'ana', scope: 'team:web' };
    await start('S1');
    const queued = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
    const hidden = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'footer'));
    const late = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'sidebar'));
    const deadline = T0 + 3 * DAY;
    const later = (connection: Connection, h: string, until: number) => record.append(connection, { v: 1, id: id(now), kind: 'ask.later', ts: now, subject: h, data: { until } });
    const batched = (connection: Connection, h: string) => record.append(connection, { v: 1, id: id(now), kind: 'ask.batched', ts: now, data: { batch: 'now:x', asks: [{ ask: h, plan_hash: null }] } });
    await asks.later(card, hidden, T0 + HOUR);
    // An app's own event, even before the deadline, and the core's at the deadline change nothing.
    await later(card, late, T0 + HOUR);
    await later(core('S1'), late, deadline);
    // Neither a hook's showing nor one under another identity brings the hidden ask back.
    await batched({ writer: 'hook', ...you, session: 'S1' }, hidden);
    await batched({ writer: 'core', ...team }, hidden);
    const inbox = new Map((await asks.inbox()).map((r) => [r.ask, r.status]));
    const table = new Map((await record.table('asks')).rows.map((r) => [`ask:${String(r.id)}`, r.status]));
    expect([inbox.get(queued), inbox.get(hidden), inbox.get(late)]).toEqual(['queued', 'later', 'queued']);
    expect([table.get(queued), table.get(hidden), table.get(late)]).toEqual(['open', 'later', 'open']);
  });
});

describe('showings', () => {
  it('a fold is one person\'s: another scope\'s ask on the same thread neither folds into it nor is answered by it', async () => {
    settings({});
    const team = { actor: 'ana', scope: 'team:web' };
    await start('S1', 'T');
    await record.append({ writer: 'hook', ...team, session: 'S2' }, { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: join(dir, 'none'), branch: 'main', thread: 'T' } });
    const { exception } = await fold('S1', ask('taste', 'S1 footer'));
    const theirs = await asks.raise(core('S2', team), sourceOf('taste'), ask('taste', 'their header'));
    expect((await asks.card(exception)).folded).not.toContain(theirs);
    await asks.answer(card, exception, { option: 'together' });
    expect(await about(theirs, 'ask.answered')).toEqual([]);
  });

  it('one batch shows asks of two scopes as one ask.batched for each, under that scope', async () => {
    const team = { actor: 'ana', scope: 'team:web' };
    await start('S1');
    await record.append({ writer: 'hook', ...team, session: 'S2' }, { v: 1, id: id(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: join(dir, 'none'), branch: 'main', thread: 'S2' } });
    const mine = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
    const theirs = await asks.raise(core('S2', team), sourceOf('taste'), ask('taste', 'footer'));
    await at(T0 + 4 * HOUR);
    const batched = (await events('ask.batched')).map((e) => [e.actor, e.scope, ((e.data as Obj).asks as Obj[]).map((a) => a.ask)]);
    expect(batched).toEqual([['you', 'you', [mine]], ['ana', 'team:web', [theirs]]]);
    expect(await shown()).toEqual([mine, theirs]);
  });

  it('Later from another scope neither is taken nor, recorded, hides the ask in the inbox or the asks table', async () => {
    settings({});
    const team = { actor: 'ana', scope: 'team:web' };
    await start('S1');
    const mine = await asks.raise(core('S1'), sourceOf('taste'), ask('taste', 'header'));
    const refusal = await asks.later({ writer: 'app', ...team }, mine, T0 + HOUR).catch((e: unknown) => e);
    expect((refusal as AskRefused).field).toBe('ask');
    expect(await about(mine, 'ask.later')).toEqual([]);
    await record.append({ writer: 'core', ...team }, { v: 1, id: id(now), kind: 'ask.later', ts: now, subject: mine, data: { until: T0 + HOUR } });
    expect((await asks.inbox()).find((r) => r.ask === mine)?.status).toBe('shown');
    expect((await record.table('asks')).rows.find((r) => `ask:${String(r.id)}` === mine)?.status).toBe('open');
  });
});
