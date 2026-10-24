// The values the #319 tests build: the virtual clock, ULIDs, the settings drafted at setup, asks as
// ask.created@1 data without the deadline and default your settings supply, and the batch arithmetic.
// It loads no package code.

import { createHash } from 'node:crypto';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import type { AskKind } from '../../../packages/asks/src/index.ts';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** 2026-10-20 12:00 UTC. With batches every 8 hours, the batches around it fall at 08:00, 16:00 and 00:00 UTC. */
export const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);

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

// ---- Settings: the asks block of ~/.deepbuild/config.json, in done.yaml's shape.
/** What setup drafts (design: the done.yaml asks block and Decided: Ask deadlines and defaults). */
export const DRAFTED_DEADLINES = { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' } as const;
export const DRAFTED_DEFAULTS = { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' } as const;
export const DRAFTED_FOLD = 5;
/** The drafted deadlines in ms, as the tests expect them on each ask.created. */
export const DEADLINE_MS: Record<AskKind, number> = { taste: 3 * DAY, authority: DAY, unblock: 2 * DAY, exception: 2 * DAY, choice: 2 * DAY, definition: 4 * HOUR };

export interface Batch { every: string; cap: number }
/** Your own settings as config.json holds them, with the drafted values unless a test changes one. */
export function settings(over: { batch?: Batch; deadline?: Record<string, string> } = {}): Obj {
  return {
    asks: {
      deadline: { ...DRAFTED_DEADLINES, ...over.deadline },
      default: { ...DRAFTED_DEFAULTS },
      fallback: ['change-owner'],
      fold: DRAFTED_FOLD,
      ...(over.batch ? { batch: { ...over.batch } } : {}),
    },
  };
}

/** Batches fall at whole multiples of `every` since the Unix epoch (UTC). The first batch after t, strictly. */
export const nextBatch = (t: number, every: number): number => Math.floor(t / every) * every + every;

// ---- Asks, as ask.created@1 data, with no deadline and, where setup drafts it, no default.
const OPTIONS: Record<AskKind, Obj[]> = {
  authority: [{ id: 'push', label: 'Push it', decision: 'allow' }, { id: 'hold', label: 'Hold it', decision: 'deny' }],
  taste: [{ id: 'blue', label: 'Blue header', decision: 'none' }, { id: 'green', label: 'Green header', decision: 'none' }],
  choice: [{ id: 'sqlite', label: 'SQLite', decision: 'none' }, { id: 'files', label: 'Plain files', decision: 'none' }],
  unblock: [{ id: 'done', label: 'I did it', decision: 'none' }, { id: 'wait', label: 'Leave it blocked', decision: 'none' }],
  exception: [{ id: 'keep', label: 'Keep the check', decision: 'none' }, { id: 'waive', label: 'Waive it once', decision: 'none' }],
  definition: [{ id: 'keep', label: 'Keep the requirement', decision: 'none' }, { id: 'drop', label: 'Leave it out', decision: 'none' }],
};
/** The recommended option, never the first one, so taking the first option is told apart from taking the recommended one. */
const RECOMMENDED: Record<AskKind, string> = { authority: 'push', taste: 'green', choice: 'files', unblock: 'done', exception: 'keep', definition: 'keep' };
/** For the kinds whose default is a particular option only the raiser can name: staying blocked, no change, leaving it out. */
const NAMED_DEFAULT: Partial<Record<AskKind, string>> = { unblock: 'wait', exception: 'keep', definition: 'drop' };
/** What each kind takes at its deadline under the drafted settings: no, the recommended option, or the named option. */
export const AT_DEADLINE: Record<AskKind, { answer: string; decision: 'allow' | 'deny' | 'none' }> = {
  authority: { answer: 'hold', decision: 'deny' },
  taste: { answer: 'green', decision: 'none' },
  choice: { answer: 'files', decision: 'none' },
  unblock: { answer: 'wait', decision: 'none' },
  exception: { answer: 'keep', decision: 'none' },
  definition: { answer: 'drop', decision: 'none' },
};
export const KINDS: readonly AskKind[] = ['authority', 'unblock', 'taste', 'exception', 'choice', 'definition'];

/** An ask the way a place raises it under settings drafted at setup: its deadline left to your settings. */
export function ask(kind: AskKind, subject: string, over: Obj = {}): Obj {
  const named = NAMED_DEFAULT[kind];
  return {
    kind,
    question: kind === 'authority' ? `Push ${subject} to origin?` : `Which way for ${subject}?`,
    options: structuredClone(OPTIONS[kind]),
    recommended: RECOMMENDED[kind],
    fallback: 'you',
    ...(named ? { default: named } : {}),
    provisional: false,
    owner: 'you',
    key: sha256(`${kind}:${subject}`),
    pinned_to: { kind: 'evidence', ref: sha256(subject) },
    ...(kind === 'unblock' ? { steps: ['Run gh auth login in your own terminal'], where: 'your terminal', why: 'the push needs a GitHub token', unblocks: ['task:01K74FX2B4D6F8H0K2M4P6R8T0'], proves: 'auth.unit' } : {}),
    ...over,
  };
}
