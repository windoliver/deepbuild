// What the resolver keeps across churn (#824): a session's decisions leave memory with it past the window of ended
// sessions and come back from the record when it starts again, held once even on a replay, so a session resumed under
// its ID is never asked again what it answered (invariant 4); and a decision saved from an ask the resolver never held
// in memory still takes its bound from that ask, read from the record.
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openAsks, type Asks, type ResolverAsk } from '@deepbuild/asks';
import { openRecord, ulid, type Connection, type RecordStore } from '@deepbuild/record';
import { resolverDecisions } from '../src/index.js';

type Obj = { [key: string]: JsonValue };
const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const who = { actor: 'you', scope: 'you' };
const hook = (session: string): Connection => ({ writer: 'hook', ...who, session });
const agent = (session: string): Connection => ({ writer: `mcp:${session}`, ...who, session });
const core = (session: string): Connection => ({ writer: 'core', ...who, session });
const card: Connection = { writer: 'app', ...who };
const taste = (subject: string): Obj => ({
  kind: 'taste', question: `Which ${subject}?`,
  options: [{ id: 'blue', label: 'Blue', decision: 'none' }, { id: 'green', label: 'Green', decision: 'none' }],
  recommended: 'blue', deadline: T0 + 72 * 3_600_000, fallback: 'you', default: 'blue', provisional: false, owner: 'you',
  key: sha(`taste:${subject}`), pinned_to: { kind: 'evidence', ref: sha(subject) },
});

let dir: string;
let now: number;
let record: RecordStore;
let asks: Asks;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-resolver-'));
  now = T0;
  record = await openRecord({ path: join(dir, 'record.db'), now: () => now });
  asks = await openAsks({ record, now: () => now, deliver: () => undefined });
});
afterEach(async () => {
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

const append = (connection: Connection, kind: string, data: JsonValue, subject?: string): Promise<unknown> =>
  record.append(connection, { v: 1, id: ulid(now += 1), kind, ts: now, data, ...(subject ? { subject } : {}) });
const start = (session: string): Promise<unknown> => append(hook(session), 'session.start', { agent: 'claude-code', worktree: join(dir, 'none'), branch: 'main', thread: session });
const end = (session: string): Promise<unknown> => append(hook(session), 'session.end', { reason: 'other' });
const outcome = async (handle: string): Promise<unknown> => (await record.table('asks')).rows.find((r) => r.id === handle.slice(4))?.outcome;
async function churn(sessions: number): Promise<void> {
  for (let i = 0; i < sessions; i++) {
    await start(`E${i}`);
    await end(`E${i}`);
  }
}

it('answers a resumed session from the decision it saved before 64 other sessions ended, so the same question never reaches you (#824)', async () => {
  const off = asks.registerResolver('resolver-decisions', resolverDecisions({ record }));
  try {
    await start('SRES');
    const first = await asks.raise(agent('SRES'), 'deep_ask.taste', taste('header'));
    await asks.answer(card, first, { option: 'green' });
    await end('SRES');
    await churn(64);
    await start('SRES');
    const again = await asks.raise(agent('SRES'), 'deep_ask.taste', taste('header'));
    expect(await asks.refusals(again)).toEqual([]);
    expect(await outcome(again)).toBe('decided_for_you');
  } finally {
    off();
  }
});

it('holds a read-back decision once on a replay, so revoking it later revokes it, and nothing names it again (#824)', async () => {
  const off = asks.registerResolver('resolver-decisions', resolverDecisions({ record }));
  await start('SRES');
  const first = await asks.raise(agent('SRES'), 'deep_ask.taste', taste('header'));
  await asks.answer(card, first, { option: 'green' });
  const decision = `decision:${(await record.read({ after: 0, limit: 10_000 })).find((e) => e.kind === 'decision.created')!.id}`;
  await end('SRES');
  await churn(64);
  off();
  // A hub started again replays the log: the session's start reads its decision back, and the log then brings the same decision.
  const replayed = await openAsks({ record, now: () => now, deliver: () => undefined });
  const offReplayed = replayed.registerResolver('resolver-decisions', resolverDecisions({ record }));
  try {
    await start('SRES');
    // Another question consults the resolver, which replays the log, before the decision is revoked.
    await replayed.raise(agent('SRES'), 'deep_ask.taste', taste('footer'));
    await replayed.revokeDecision(card, decision);
    const again = await replayed.raise(agent('SRES'), 'deep_ask.taste', taste('header'));
    expect(await replayed.refusals(again), 'a stale copy of the decision would be named, and refused as revoked').toEqual([]);
    expect(await outcome(again)).toBe('unanswered');
  } finally {
    offReplayed();
  }
});

it('an overrule at a scope lands on a decision that left memory, and holds when its session resumes (#824)', async () => {
  const resolve = resolverDecisions({ record });
  const key = sha('taste:header');
  await start('SRES');
  const decisionId = ulid(now += 1);
  await record.append(core('SRES'), { v: 1, id: decisionId, kind: 'decision.created', ts: now, subject: `ask:${ulid(now)}`, data: { key, scope: 'session:SRES', answer: 'green', ask: `ask:${ulid(now)}` } });
  await end('SRES');
  await churn(64);
  // Overruled at its own scope once it left memory, as your contrary answer from the inbox does (#667).
  await record.append({ writer: 'core', ...who }, { v: 2, id: ulid(now += 1), kind: 'decision.overruled', ts: now, subject: `decision:${decisionId}`, data: { decision: `decision:${decisionId}`, at: 'session:SRES' } });
  await start('SRES');
  const asking: ResolverAsk = { ask: `ask:${ulid(now += 1)}`, kind: 'taste', key, session: 'SRES', repo: null, needs_person: [], subject: null, options: taste('header').options } as unknown as ResolverAsk;
  expect(await resolve(asking), 'a decision overruled at this scope answers nothing here').toBeUndefined();
});

it('bounds a decision saved from an ask the resolver never held, read from the record (#824)', async () => {
  const resolve = resolverDecisions({ record });
  const key = sha('authority:deploy');
  await start('SOPEN');
  const askId = ulid(now += 1);
  const change = (lines: number): Obj => ({ kind: 'fix', lines, paths: ['src/deploy.ts'] });
  await record.append(core('SOPEN'), {
    v: 4, id: askId, kind: 'ask.created', ts: now,
    data: {
      kind: 'authority', question: 'Deploy?', options: [{ id: 'allow', label: 'Deploy', decision: 'allow' }, { id: 'deny', label: 'Hold', decision: 'deny' }],
      recommended: null, deadline: now + 86_400_000, fallback: 'you', default: 'deny', provisional: false, owner: 'you', key,
      subject: { effect: 'deploy', target: { kind: 'env', ref: 'env:staging', owner: 'you' }, change: change(10) }, pinned_to: { kind: 'evidence', ref: sha('deploy 10') },
    },
  });
  await end('SOPEN');
  // Open, its ask keeps its session in memory through any number of ended sessions.
  await churn(64);
  // Answered from the inbox long after, and another session's end lands between the answer and the decision saved
  // from it: the ask leaves memory, and the decision still covers changes up to 50 lines, the floor of twice its 10.
  await append({ writer: 'core', ...who }, 'ask.answered', { answer: 'allow', plan_hash: null, decision: 'allow' }, `ask:${askId}`);
  await start('ELAST');
  await end('ELAST');
  await append(core('SOPEN'), 'decision.created', { key, scope: 'all', answer: 'allow', ask: `ask:${askId}` }, `ask:${askId}`);
  const asking = (lines: number): ResolverAsk => ({
    ask: `ask:${ulid(now += 1)}`, kind: 'authority', key, session: 'SLATER', repo: null, needs_person: [],
    subject: { effect: 'deploy', target: { kind: 'env', ref: 'env:staging', owner: 'you' }, change: change(lines) }, options: [{ id: 'allow', label: 'Allow', decision: 'allow' }, { id: 'deny', label: 'Deny', decision: 'deny' }],
  } as unknown as ResolverAsk);
  expect(await resolve(asking(40)), 'within the bound').toMatchObject({ answer: 'allow' });
  expect(await resolve(asking(400)), 'past the bound: a decision with no bound would cover it').toBeUndefined();
});
