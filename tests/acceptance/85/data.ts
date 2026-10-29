// The values the #85 tests build: the virtual clock, ULIDs and seq stamps, your settings, the stop causes and the
// shapes of the stops each criterion names (as agent.stop@4 data), and a chat-app task. It loads no package code.

import { createHash } from 'node:crypto';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** 2026-10-28 12:00 UTC. */
export const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
/** The window an automatic continue may start in: the stop is under 10 minutes old by deep-hook's stamp. */
export const CONTINUE_WINDOW = 10 * MINUTE;

export type Obj = { [key: string]: JsonValue };
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const bare = (handle: string): string => handle.replace(/^ask:/, '');

// ---- ULIDs minted from a time, in minting order, and seq stamps (ns since the epoch, as deep-hook stamps them).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}
/** deep-hook's stamp for a hook that started at `ms`: wall-clock ns, unique in minting order. */
export const seqAt = (ms: number): string => String(BigInt(ms) * 1_000_000n + BigInt(++minted));

export interface Clock { now(): number; set(ms: number): void }
export const makeClock = (start = T0): Clock => {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; } };
};

/** Your own settings as ~/.deepbuild/config.json holds them (#319's shape), with no batch: every ask shows when raised. */
export const SETTINGS: Obj = {
  asks: {
    deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
    default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
    fallback: ['change-owner'],
    fold: 5,
  },
};

/** You: the person behind every connection here. */
export const YOU = 'you';
/** The bot in your chat app, which answers the test question. */
export const BOT = 'qa-bot';

/** The closed set of stop causes (agent.stop@4, design: One event log). */
export type Cause = 'sign_in_required' | 'token_refresh_failed' | 'plan_window_spent' | 'rate_limited' | 'refusal' | 'max_turns' | 'context_overflow' | 'tool_schema_rejected' | 'agent_crashed' | 'timed_out' | 'unknown';
export type Owner = 'agent' | 'you' | 'service';

/** A stop as the hook records it: its cause and what the adapter's facts say about the block. `at` is deep-hook's stamp (ms). */
export interface StopInput {
  cause: Cause;
  owner?: Owner;
  signature?: string;
  outcome?: 'finished' | 'failed';
  did_work?: boolean;
  claim?: boolean;
  plan_resets?: number;
  at?: number;
}

/** The stops the criteria name, each in the adapter's structure (README: Readings, which cause is which). */
export const STOPS = {
  /** A revoked sign-in: one block, the same signature in every session it stopped; only you can sign in. */
  signIn: (): StopInput => ({ cause: 'sign_in_required', owner: 'you', signature: 'sig:00a1b2c3d4e5f607', outcome: 'failed' }),
  /** A dropped connection: a transient the service owns. */
  dropped: (): StopInput => ({ cause: 'timed_out', owner: 'service', signature: 'sig:1d20c0e1f2a3b4c5', outcome: 'failed' }),
  /** An overloaded service: a transient too. */
  overloaded: (): StopInput => ({ cause: 'rate_limited', owner: 'service', signature: 'sig:2b0e10ad3c4d5e6f', outcome: 'failed' }),
  /** A network you must reconnect, such as a VPN: the same signature in every session, and only you can reconnect it. */
  vpn: (): StopInput => ({ cause: 'timed_out', owner: 'you', signature: 'sig:3e7a0b1c2d3e4f50', outcome: 'failed' }),
  /** A spend limit: the same signature in every session, and only you can raise it. */
  spend: (): StopInput => ({ cause: 'rate_limited', owner: 'you', signature: 'sig:4c05e2d1f0a9b8c7', outcome: 'failed' }),
  /** A plan window spent, with its reset time. */
  planWindow: (resets: number): StopInput => ({ cause: 'plan_window_spent', owner: 'service', signature: 'sig:5a0e1b2c3d4e5f60', outcome: 'failed', plan_resets: resets }),
  /** A refusal: the model declined; the turn did work before it. */
  refusal: (): StopInput => ({ cause: 'refusal', owner: 'agent', outcome: 'finished', did_work: true, claim: true }),
  /** A context overflow. */
  overflow: (): StopInput => ({ cause: 'context_overflow', owner: 'agent', outcome: 'failed' }),
} as const;

/** The usage block of a stop, as the adapter reports a turn's (agent.stop@4 fixture 04). */
export const USAGE: Obj = {
  covers: 'turn', model: 'claude-haiku-5-5',
  input: { value: 21569, exact: true }, cached: { value: 0, exact: true }, output: { value: 118, exact: true },
  context_fill: 0.0839, cost: { usd: 0.04, basis: 'reported' },
};

/**
 * A step you take in a chat app, as the agent raises it with deep_ask (ask.created data, kind unblock): post the
 * test question to your bot in the thread; its check reads that thread through the read-only connector and holds
 * the bot's reply to what the task expects. `over` replaces or adds fields.
 */
export const THREAD_LINK = 'https://chat.example.invalid/channels/qa/threads/1729';
export const QUESTION = "What's the weather in Oslo?";
export const EXPECTED_REPLY = 'Oslo: 4°C, light rain';
export function chatTask(over: Obj = {}): Obj {
  return {
    kind: 'unblock',
    question: `Post the test question to ${BOT} in #qa?`,
    options: [
      { id: 'done', label: 'I did it', decision: 'none' },
      { id: 'wait', label: 'Leave it blocked', decision: 'none' },
    ],
    recommended: 'done',
    fallback: 'you',
    default: 'wait',
    provisional: false,
    owner: YOU,
    key: sha256(`unblock:chat:${THREAD_LINK}`),
    pinned_to: { kind: 'evidence', ref: sha256(THREAD_LINK) },
    steps: [`In #qa, post "${QUESTION}" to ${BOT}`],
    where: 'your chat app',
    why: "the weather skill's release needs one live answer from the deployed bot",
    unblocks: ['session:S1'],
    proves: 'qa.bot_reply',
    thread: { link: THREAD_LINK, expect: EXPECTED_REPLY },
    ...over,
  };
}
