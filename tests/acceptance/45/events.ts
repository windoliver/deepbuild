// Hand-built record events for the #45 tests, plain data in the shapes of the published schemas (stop.held@1, user.ask@1,
// run.started@2, run.finished@1, turn.usage@1, session.start@3, reading.recorded@1) and of the three kinds the README
// defines (run.stale@1, check.held@1, check.held_start@1). Nothing here computes a reading.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RecordEvent } from '../../../packages/readings/src/index.ts';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
/** A ULID for `ms`: the time, then a counter, so ids made in order sort in order. */
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/claude/projects/-work-shop/', import.meta.url));
/** The committed Claude Code fixture's files (README, The fixture). */
export const FIXTURE = ['11111111-1111-4111-8111-111111111111.jsonl', '11111111-1111-4111-8111-111111111111/subagents/agent-a1.jsonl', '22222222-2222-4222-8222-222222222222.jsonl'].map((f) => join(FIXTURE_DIR, f));

export const T0 = Date.UTC(2026, 8, 14, 12, 0, 0);
export const SECOND = 1000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

const event = (kind: string, v: number, session: string | null, ts: number, data: Record<string, unknown>): RecordEvent => ({ id: ulid(ts), kind, v, ts, session, data });

/** A prompt: the start of a turn, with its origin. */
export const ask = (session: string, ts: number, from = 'person', tasks: string[] = [], msg = 1): RecordEvent =>
  event('user.ask', 1, session, ts, { msg, text: 'go on', tasks, from });

export interface HeldParts { fast?: number; snapshot_start?: number; queue_wait?: number; slow?: number; question?: number; code_changing?: boolean; budget_cost?: string[]; claim?: string | null }
/** stop.held at its reply: `ts` is when the reply went out, so the hold began at ts - total. Its parts sum to its total. */
export function held(session: string, ts: number, parts: HeldParts): RecordEvent {
  const { fast = 0, snapshot_start = 0, queue_wait = 0, slow = 0, question = 0, code_changing = true, budget_cost = [], claim = null } = parts;
  return event('stop.held', 1, session, ts, {
    session: `session:${session}`, stop: ulid(ts), claim, total: fast + snapshot_start + queue_wait + slow + question,
    question, slow, fast, snapshot_start, queue_wait, code_changing, budget_cost,
  });
}

export const started = (session: string, ts: number, run: string, check: string, claim: string, lane: 'fast' | 'slow' = 'slow'): RecordEvent =>
  event('run.started', 2, session, ts, { run, check, claim, commit: 'a'.repeat(40), host: 'local', needs: { cores: 1, memory_mb: 512, stack_slot: false, gpus: 0, expected_ms: 1000 }, lane });

export const finished = (session: string, ts: number, run: string, check: string, outcome: 'passed' | 'failed'): RecordEvent =>
  event('run.finished', 1, session, ts, { run, outcome, tests_run: 1, passed: outcome === 'passed' ? 1 : 0, runs: 1, evidence: [], check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'local' });

/** run.stale@1 (README): a slow-lane run ended, and a newer claim had changed its check's inputs. */
export const stale = (session: string, ts: number, run: string, check: string, claim: string, newer: string): RecordEvent =>
  event('run.stale', 1, session, ts, { session: `session:${session}`, run, check, claim, newer_claim: newer });

/** check.held@1 (README): at a looping session's stop a slow check took its held place; `replaced` is the claim whose place it took. */
export const heldPlace = (session: string, ts: number, check: string, claim: string, replaced: string | null): RecordEvent =>
  event('check.held', 1, session, ts, { session: `session:${session}`, check, claim, replaced });

/** check.held_start@1 (README): a held check started, and what started it. */
export const heldStart = (session: string, ts: number, check: string, claim: string, by: 'pause' | 'due_later' | 'grace_window' | 'claim' | 'words'): RecordEvent =>
  event('check.held_start', 1, session, ts, { session: `session:${session}`, check, claim, by });

export type Cost = { basis: 'reported'; usd: number } | { basis: 'estimated'; usd: number; rate_card: string } | { basis: 'unpriced' };
export const usage = (session: string, ts: number, turn: string, tokens: { input: number; output: number; cached?: number }, cost: Cost): RecordEvent =>
  event('turn.usage', 1, session, ts, { turn, model: 'claude-haiku-5-5', covers: 'turn', tokens: { cached: 0, ...tokens, exact: true }, cost });

export const sessionStart = (session: string, ts: number, billing: Record<string, boolean>): RecordEvent =>
  event('session.start', 3, session, ts, { agent: 'claude-code', worktree: '/work/shop', branch: 'main', thread: session, billing, loads: [] });

export const recorded = (ts: number, reading: string, value: number, unit: string, source: string, as_of: number): RecordEvent =>
  event('reading.recorded', 1, null, ts, { reading, value, unit, as_of, source, n: 1, outside: false });

export const claimOf = (name: string): string => `claim:${name}`;
export const runOf = (name: string): string => `run:${name}`;
