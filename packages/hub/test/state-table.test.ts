// The one ordered state table (#2018), over a record: a session's state is the first row that matches, a claim's
// verdict is a state, each fact its why names is the event at that log_pos, and a session has one name.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { fixtures, type JsonValue } from '@deepbuild/contracts';
import { openRecord } from '@deepbuild/record';
import { expect, it } from 'vitest';
import { buildRows, distinctTitles, settle, whyOf, type Placed } from '../src/rows.js';
import { decide, sessionStates, type SessionFacts } from '../src/status.js';
import { ulid } from '../src/wire.js';

const S = '7c4d5e60-2018-4222-8333-444455552018';
type Data = Record<string, JsonValue>;
const data = (kind: string): Data => (fixtures(kind)[0] as { data: Data }).data;

/** A record in a folder of its own, with a session's hook and the core writing to it on one clock. */
async function world(run: (w: { query: (sql: string) => Promise<unknown[]>; hook: (kind: string, v: number, d: Data, session?: string) => Promise<string>; core: (kind: string, v: number, d: Data, subject?: string, session?: string) => Promise<string>; now: () => number; read: (session?: string) => Promise<Awaited<ReturnType<typeof sessionStates>>[number]> }) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-table-'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  let at = Date.now();
  const who = (writer: string, session: string) => ({ writer, actor: 'you', scope: 'you', session });
  const query = (sql: string) => record.raw(sql);
  // An event's subject as its kind's fixture has one: the session, by its letters and digits, where it names a session.
  const about = (kind: string, v: number, session: string, subject?: string): { subject?: string } => {
    const given = subject ?? (fixtures(`${kind}@${v}`)[0] as { subject?: string }).subject;
    return given ? { subject: given.startsWith('session:') && !subject ? `session:${session.replace(/[^0-9A-Za-z]/g, '')}` : given } : {};
  };
  try {
    await run({
      query, now: () => at,
      hook: async (kind, v, d, session = S) => { const id = ulid(++at); await record.append(who('hook', session), { v, id, kind, ts: at, seq: `${BigInt(at) * 1_000_000n}`, ...about(kind, v, session), data: d }); return id; },
      core: async (kind, v, d, subject, session = S) => { const id = ulid(++at); await record.append(who('core', session), { v, id, kind, ts: at, ...about(kind, v, session, subject), data: d }); return id; },
      read: async (session = S) => (await sessionStates(query, at + 1)).find((r) => r.id === session)!,
    });
  } finally {
    await record.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const prompt = (text: string): Data => ({ msg: 1, text, tasks: [], from: 'person' });
const stop = (): Data => ({ ...data('agent.stop@1') });
const verdict = (claim: string, outcome: string, handle: string): Data => ({ ...data('verdict.made@1'), claim: `claim:${claim}`, outcome, verdict: `verdict:${handle}`, ...(outcome === 'PASS' ? { reasons: [], requirements: [], smallest: null, points_to: null } : {}) });

it('a claim is a state: says done until its verdict, PASS under new work, sent back over it, and each fact is the event at its log_pos', async () => {
  await world(async (w) => {
    await w.hook('session.start', 1, data('session.start@1'));
    await w.hook('user.ask', 1, prompt('fix the flaky checkout test'));
    await w.hook('agent.stop', 1, stop());
    expect((await w.read()).state, 'a stop with no claim').toBe('finished');
    const claim = await w.core('claim.made', 3, data('claim.made@3'));
    const said = await w.read();
    expect([said.state, said.rule, said.waits_on]).toEqual(['says done', 'says_done', 'its checks']);
    expect(said.facts.map((f) => f.kind)).toEqual(['claim.made']);
    // Each higher row is named with what it lacked, the first of them an open ask.
    expect(said.lacked[0]).toEqual({ rule: 'ask', state: 'needs you', fact: 'no open ask' });
    expect(said.lacked.map((l) => l.state)).toContain('stale');
    await w.core('verdict.made', 1, verdict(claim, 'PASS', '01K74G4B6D8F0H2K4M6P8R0T2V'));
    const passed = await w.read();
    expect([passed.state, passed.waits_on]).toEqual(['PASS', null]);
    for (const f of passed.facts) expect(await w.query(`SELECT kind, ts FROM events WHERE log_pos = ${f.log_pos}`), `the fact ${f.kind}`).toEqual([{ kind: f.kind, ts: f.ts }]);
    expect(passed.facts.map((f) => f.kind)).toEqual(['claim.made', 'verdict.made']);
    // Work after a PASS reads working; a send-back holds while the agent works on it.
    await w.hook('user.ask', 1, prompt('and the cart test'));
    expect((await w.read()).state).toBe('working');
    await w.hook('agent.stop', 1, stop());
    const second = await w.core('claim.made', 3, data('claim.made@3'));
    await w.core('verdict.made', 1, verdict(second, 'FAIL', '01K74G4B6D8F0H2K4M6P8R0T3V'));
    await w.hook('user.ask', 1, prompt('DeepBuild sent this back'));
    const back = await w.read();
    expect([back.state, back.waits_on, back.plain]).toEqual(['sent back', 'agent', 'its checks sent its claim back, round 1 of 3']);
  });
});

it('an open ask outranks a stale verdict, and a verdict that is not PASS or FAIL names who it waits for and the evidence', async () => {
  await world(async (w) => {
    await w.hook('session.start', 1, data('session.start@1'));
    await w.hook('user.ask', 1, prompt('ship it'));
    await w.hook('agent.stop', 1, stop());
    const claim = await w.core('claim.made', 3, data('claim.made@3'));
    await w.core('verdict.made', 1, { ...verdict(claim, 'BLOCKED', '01K74G4B6D8F0H2K4M6P8R0T2V'), reasons: ['the staging key is missing'], smallest: 'the staging key is missing' });
    const blocked = await w.read();
    expect([blocked.state, blocked.plain, blocked.waits_on]).toEqual(['BLOCKED', 'waits for you: the staging key is missing', 'you']);
    await w.core('verdict.stale', 1, { verdict: 'verdict:01K74G4B6D8F0H2K4M6P8R0T2V', because: 'commit moved' });
    const stale = await w.read();
    expect(stale.state).toBe('stale');
    expect(stale.facts.map((f) => f.kind)).toEqual(['claim.made', 'verdict.made', 'verdict.stale']);
    await w.core('ask.created', 1, data('ask.created@1'));
    const asked = await w.read();
    expect([asked.state, asked.rule, asked.lacked]).toEqual(['needs you', 'ask', []]);
    expect(asked.facts.map((f) => f.kind)).toEqual(['ask.created']);
  });
});

it('every session reads exactly one state, with every row above the one that matched named', () => {
  const at = fc.record({ kind: fc.constant('x'), ts: fc.nat(), log_pos: fc.nat() });
  const claim = fc.record({ made: at, outcome: fc.constantFrom(null, 'PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'), judged: at, stale: fc.option(at, { nil: undefined }), round: fc.option(fc.nat(5), { nil: null }), owner: fc.constant(null), evidence: fc.constant(null) });
  const facts = fc.record({
    id: fc.constant(S), project_id: fc.constant(null), agent: fc.constant(null), worktree: fc.constant(null), stopCause: fc.constant(null),
    status: fc.constantFrom('running', 'working', 'waiting', 'finished', 'failed', 'stuck', 'unknown', 'new-word'), last_seen: fc.option(fc.nat(200 * 3_600_000), { nil: null }),
    asks: fc.option(fc.record({ n: fc.integer({ min: 1, max: 3 }), since: fc.nat(), facts: fc.array(at, { maxLength: 2 }) }), { nil: undefined }),
    gone: fc.option(at, { nil: undefined }), words: fc.option(fc.record({ outcome: fc.constantFrom('stalled', 'timed_out') }), { nil: undefined }),
    promised: fc.option(fc.record({ due: fc.nat(), quote: fc.constant('q') }), { nil: undefined }), interrupted: fc.option(at, { nil: undefined }),
    claim: fc.option(claim, { nil: undefined }), queued: fc.option(at, { nil: undefined }),
  }, { requiredKeys: ['id', 'project_id', 'agent', 'worktree', 'stopCause', 'status', 'last_seen'] });
  const WORDS = ['needs you', 'stuck', 'flagged', 'sent back', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'stale', 'says done', 'working', 'queued', 'PASS', 'finished', 'quiet'];
  fc.assert(fc.property(facts, fc.nat(200 * 3_600_000), (f, now) => {
    const read = decide(f as unknown as SessionFacts, now);
    expect(WORDS).toContain(read.state);
    // The same facts read the same again, and an open ask is never outranked.
    expect(decide(f as unknown as SessionFacts, now)).toEqual(read);
    if (f.asks) expect(read.state).toBe('needs you');
    expect(new Set(read.lacked.map((l) => l.rule)).size).toBe(read.lacked.length);
    expect(read.lacked.map((l) => l.rule)).not.toContain(read.rule);
  }), { seed: 2018, numRuns: 500 });
});

it('a session has one name: yours, else its task, else its agent\'s title, else its first prompt cut to 60, with a short ID only between twins', async () => {
  await world(async (w) => {
    const T = '8d5e6f70-2018-4222-8333-444455552018';
    const long = 'rewrite the checkout page so that the total and the pay button stay in view on a phone';
    for (const [session, text] of [[S, 'fix the flaky checkout test\nand tell me why'], [T, long]] as const) {
      await w.hook('session.start', 1, data('session.start@1'), session);
      await w.hook('user.ask', 1, prompt(text), session);
    }
    const titles = async () => Object.fromEntries((await buildRows(w.query, await sessionStates(w.query, w.now() + 1))).filter((r) => r.id.startsWith('session:')).map((r) => [r.session, r.title]));
    expect(await titles()).toEqual({ [S]: 'fix the flaky checkout test', [T]: long.slice(0, 60) });
    await w.core('session.named', 1, { name: 'Checkout on a phone', by: 'agent' }, undefined, T);
    expect((await titles())[T]).toBe('Checkout on a phone');
    await w.core('task.created', 1, { ...data('task.created@1'), thread: T, title: 'Phone checkout' }, undefined, T);
    expect((await titles())[T]).toBe('Phone checkout');
    // Your name is first, and naming a session is no sign of it: its row keeps its time in its state.
    const before = new Map<string, Placed>(settle(new Map(), await buildRows(w.query, await sessionStates(w.query, w.now() + 1)), true).map((p) => [p.row.id, p]));
    await w.core('session.named', 1, { name: 'Pay button', by: 'you' }, undefined, T);
    const [renamed] = settle(before, await buildRows(w.query, await sessionStates(w.query, w.now() + 1)), false);
    expect([renamed?.row.title, renamed?.row.since, renamed?.row.unread]).toEqual(['Pay button', before.get(`session:${T}`)!.row.since, false]);
  });
  expect([...distinctTitles(new Map([['session:1a2b3c4d-1', 'fix it'], ['session:5e6f7a8b-2', 'fix it'], ['session:9c0d1e2f-3', 'other']]))]).toEqual([
    ['session:1a2b3c4d-1', 'fix it · 1a2b3c4d'], ['session:5e6f7a8b-2', 'fix it · 5e6f7a8b'], ['session:9c0d1e2f-3', 'other'],
  ]);
});

it('why is the same reading: a session by the start of its ID, its row\'s word and why, and no answer for an ID no session has', async () => {
  await world(async (w) => {
    await w.hook('session.start', 1, data('session.start@1'));
    await w.hook('user.ask', 1, prompt('fix the flaky checkout test'));
    const rows = await buildRows(w.query, await sessionStates(w.query, w.now() + 1));
    const why = await whyOf(w.query, w.now() + 1, '7c4d5e60', rows);
    const read = await w.read();
    // Its word and why are the row's, and each word above its own in the table is named once with what it lacked.
    expect(why).toMatchObject({ id: `session:${S}`, rule: read.rule, word: 'working', why: read.plain, facts: read.facts });
    expect((why as { lacked: { row: string; fact: string }[] }).lacked.map((l) => l.row)).toEqual(['needs you', 'stuck', 'flagged', 'sent back', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'stale', 'says done']);
    expect((why as { lacked: { row: string; fact: string }[] }).lacked.every((l) => l.fact.length > 0)).toBe(true);
    expect(await whyOf(w.query, w.now() + 1, 'ffff', rows)).toHaveProperty('refused');
  });
});
