// The ask data the #318 tests build and the schema checks on it: a clock, ULIDs, asks as ask.created@1
// data, plans, and the refusal check against a published schema. It loads only the contracts package, so
// contract.test.ts runs without the asks core.

import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import type { AskKind } from '../../../packages/asks/src/index.ts';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** 2026-10-20 12:00 UTC: every world's clock starts here, so a 1-day deadline falls at 2026-10-21 12:00 UTC. */
export const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
export const KINDS: readonly AskKind[] = ['authority', 'unblock', 'taste', 'exception', 'choice', 'definition'];

export type Obj = { [key: string]: JsonValue };
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const bare = (handle: string): string => handle.replace(/^ask:/, '');

// ---- ULIDs minted from the virtual clock, in minting order.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}

export interface Clock { now(): number; set(ms: number): void }
export const makeClock = (start = T0): Clock => {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; } };
};

// ---- Asks, as ask.created@1 data.
const OPTIONS: Record<AskKind, Obj[]> = {
  authority: [{ id: 'push', label: 'Push it', decision: 'allow' }, { id: 'hold', label: 'Hold it', decision: 'deny' }],
  taste: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }],
  choice: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
  unblock: [{ id: 'done', label: 'I did it', decision: 'none' }],
  exception: [{ id: 'keep', label: 'Keep the check', decision: 'none' }, { id: 'waive', label: 'Waive it once', decision: 'none' }],
  definition: [{ id: 'keep', label: 'Keep the requirement', decision: 'none' }, { id: 'drop', label: 'Leave it out', decision: 'none' }],
};
const DEFAULTS: Record<AskKind, string> = { authority: 'hold', taste: 'blue', choice: 'sqlite', unblock: 'done', exception: 'keep', definition: 'drop' };
/** Pinned to an evidence hash unless a test pins it to a commit. */
export const shown = (what: string): Obj => ({ kind: 'evidence', ref: sha256(what) });

export function ask(kind: AskKind, now: number, over: Obj = {}): Obj {
  const subject = typeof over.subject === 'string' ? over.subject : `${kind}-subject`;
  const { subject: _subject, ...rest } = over;
  return {
    kind,
    question: kind === 'authority' ? 'Push feature/login to origin?' : `Which way for ${subject}?`,
    options: structuredClone(OPTIONS[kind]),
    recommended: kind === 'authority' ? 'push' : DEFAULTS[kind],
    deadline: now + (kind === 'authority' ? DAY : 2 * DAY),
    fallback: 'you',
    default: DEFAULTS[kind],
    provisional: false,
    owner: 'you',
    key: sha256(`${kind}:${subject}`),
    pinned_to: shown(subject),
    ...(kind === 'unblock' ? { steps: ['Run gh auth login in your own terminal'], where: 'your terminal', why: 'the push needs a GitHub token', unblocks: ['task:01K74FX2B4D6F8H0K2M4P6R8T0'], proves: 'auth.unit' } : {}),
    ...rest,
  };
}
/** An authority ask's plan: one step, what it changes, its undo and its cost. */
export const plan = (target: string) => ({
  steps: [{ does: `git push origin ${target}`, changes: [`origin/${target}`], undo: `git push origin --force-with-lease ${target}@{1}:${target}`, public: true, cost: 0 }],
  diff: sha256(`diff for ${target}`),
});

/** An ask.created event around the given data, for the schema checks. */
export const created = (data: JsonValue): Obj => ({ v: 1, id: ulid(T0), kind: 'ask.created', writer: 'core', actor: 'you', scope: 'you', ts: T0, data });

/** The schema refuses the event, with an issue at the pointer. */
export function refusedAt(name: string, event: unknown, pointer: string): void {
  const result = validate(name, event);
  expect(result.ok, `${name} accepted an event it must refuse at ${pointer}`).toBe(false);
  if (!result.ok) expect(result.issues.map((i) => i.path), `${name}'s refusal names ${pointer}`).toContain(pointer);
}


// ---- Values the schema refuses.
export const NOT_KINDS = ['bug', 'question', 'notice', 'task', 'decision', 'permission', 'proceed', 'Authority', 'TASTE', 'taste ', ' choice', 'choices', 'unblocked', 'definitions', 'exceptions', ''];
export const NOT_DECISIONS: JsonValue[] = ['yes', 'approve', 'approved', 'Allow', 'ALLOW', 'allowed', 'accept', 'proceed', 'no', 'Deny', '', null, 1, true];
/** What an ask states: what it decides, its options, the recommendation and the default. */
export const STATES = ['question', 'options', 'recommended', 'default'] as const;
/** What every ask.created carries so it ends after a replay. */
export const ENDS = ['fallback', 'owner', 'key', 'pinned_to'] as const;
