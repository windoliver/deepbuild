// The values the #320 tests build: the virtual clock, ULIDs, your settings, and unblock tasks as
// ask.created data. It loads no package code.

import { createHash } from 'node:crypto';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** 2026-10-24 12:00 UTC. */
export const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);

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

/**
 * Your own settings as ~/.deepbuild/config.json holds them (#319's shape): the deadlines and defaults setup
 * drafts, and no batch, so every ask shows when it's raised and nothing here waits for a visit.
 */
export const SETTINGS: Obj = {
  asks: {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
    fallback: ['change-owner'],
    fold: 5,
  },
};
/** The unblock deadline those settings draft. */
export const UNBLOCK_WAIT = 2 * DAY;

/** You, as the hub's socket proves every connection here: the person behind it and who may see it. */
export const YOU = 'you';
/** A teammate: someone else, who owns a block. */
export const SAM = 'sam';

/**
 * An unblock task as a place raises it (ask.created data, kind unblock): what to do and where, why, what it
 * unblocks and the check that proves it. Its deadline is left to your settings; its default is the option that
 * leaves the claim BLOCKED, which only the raiser can name. `over` replaces or adds fields.
 */
export function task(subject: string, over: Obj = {}): Obj {
  return {
    kind: 'unblock',
    question: `Clear the block on ${subject}?`,
    options: [
      { id: 'done', label: 'I did it', decision: 'none' },
      { id: 'wait', label: 'Leave it blocked', decision: 'none' },
    ],
    recommended: 'done',
    fallback: 'you',
    default: 'wait',
    provisional: false,
    owner: YOU,
    key: sha256(`unblock:${subject}`),
    pinned_to: { kind: 'evidence', ref: sha256(subject) },
    steps: [`Clear the block on ${subject} where it is held`, 'Answer "I did it": its check runs again'],
    where: 'your terminal',
    why: `the release waits on ${subject}`,
    unblocks: ['task:01K74FX2B4D6F8H0K2M4P6R8T0'],
    proves: `${subject}.check`,
    ...over,
  };
}

/** The four parts a task can't go without (the criterion's words: its steps, where to take them, what it unblocks, the check that proves it). */
export const TASK_PARTS = ['steps', 'where', 'unblocks', 'proves'] as const;
