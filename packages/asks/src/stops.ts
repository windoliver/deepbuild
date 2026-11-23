// Stops (#85) and sign-in tasks (#1349): the stop causes the asks core continues from or raises one shared task for,
// and the words on a block's or a sign-in's task.
import { ADAPTERS, readFacts, shipped } from '@deepbuild/adapters';
import type { AdapterRegistry } from '@deepbuild/adapters';
import { sha256Hex } from '@deepbuild/contracts';
import { isObj } from './model.js';
import type { Ask, Obj } from './model.js';

/** How old a stop may be, by deep-hook's stamp, when the core sees it, for an automatic continue (design: 10 minutes). */
export const CONTINUE_WINDOW = 10 * 60_000;
/** The causes that pass by themselves when the service owns the block: a dropped connection, an overloaded service. */
export const TRANSIENT = new Set(['timed_out', 'rate_limited']);
/** The ask.moot reasons ask.moot@2 added. */
export const MOOT_V2 = new Set(['window_reset', 'thread_replied', 'network_reached', 'signed_in']);
/** The stop causes a sign-in clears (#1349): one task per agent, closed only by the agent's sign-in probe. */
export const SIGN_IN = new Set(['sign_in_required', 'token_refresh_failed']);
/** A sign-in's block signature: the same for every session, job and folder of one agent (#1349). */
export const signInSignature = (agent: string): string => `sig:${sha256Hex(new TextEncoder().encode(`sign-in:${agent}`)).slice(0, 16)}`;
/** What proves a sign-in task: the agent's own sign-in probe, never a claim. */
export const signInProbe = (agent: string): string => `${agent} sign-in probe`;
/** The agent a sign-in task's data names by its probe, or undefined for any other ask (#1349). */
export const signInAgentOf = (data: unknown): string | undefined => {
  const proves = isObj(data) && data.kind === 'unblock' && typeof data.proves === 'string' ? data.proves : '';
  const agent = proves.endsWith(' sign-in probe') ? proves.slice(0, -' sign-in probe'.length) : '';
  return /^[a-z0-9-]+$/.test(agent) ? agent : undefined;
};
/** One stop of a session's own turn, as agent.stop@4 and @5 record it (#85): the structure the core raises a task or a continue from. */
export interface Stop { id: string; session: string; ts: number; pos: number; cause: string; owner: string; signature: string; resets: number | null; finished: boolean; who: Ask['who'] }
/** Whether a stop is newer than another: by deep-hook's stamp, then by log order. */
export const newer = (a: Stop, b: Stop): boolean => a.ts > b.ts || (a.ts === b.ts && a.pos > b.pos);
/** An automatic continue the core recorded: the stop it continued from, why, and when; and that stop's stamp, read as the continue was (#2653). */
export interface Continued { stop: string; because: string; ts: number; at?: number }
/** A block someone else owns: an unblock task whose owner isn't the person it was raised for. */
export const isTheirs = (data: Obj, actor: string): boolean => data.kind === 'unblock' && data.owner !== actor;

/** The thread a chat-app task's check reads, when the task names one. */
export const chatThread = (data: Obj): { link: string; expect: string } | undefined => {
  const thread = data.thread;
  return isObj(thread) && typeof thread.link === 'string' && typeof thread.expect === 'string' ? { link: thread.link, expect: thread.expect } : undefined;
};
let adapters: AdapterRegistry | undefined;
/** The shipped adapters' `errorTurnHook` cap, when the caller passes no registry of its own; an agent no adapter knows has none. */
export function shippedErrorTurnHook(agent: string): boolean {
  try {
    return (adapters ??= shipped()).get(ADAPTERS[agent] ?? agent).caps.errorTurnHook === true;
  } catch {
    return false;
  }
}
/** What a block's task says, by its cause: the words on the card. The task's identity is the block's structure, never these words. */
export function blockText(stop: Stop, agent?: string): { question: string; steps: string[]; where: string; why: string } {
  // A lapsed sign-in is one plain line, the same task as a first sign-in (#1349).
  if (agent !== undefined && SIGN_IN.has(stop.cause)) return signInText(agent, true);
  const WORDS: Readonly<Record<string, [question: string, step: string, where: string]>> = {
    sign_in_required: ['Sign in again? Your sign-in lapsed. The work waits, and nothing is lost.', "Sign in again in the agent's own window or browser page", "the agent's own window or browser page"],
    token_refresh_failed: ['Sign in again? Your sign-in lapsed. The work waits, and nothing is lost.', "Sign in again in the agent's own window or browser page", "the agent's own window or browser page"],
    rate_limited: ['Raise the spend limit the sessions ran into?', 'Raise the limit, or wait it out, at the service', 'the service account'],
    timed_out: ['Reconnect the network the sessions reach the service through?', 'Reconnect the network (a VPN, a proxy) the sessions need', 'your machine'],
    plan_window_spent: [`Your plan's limit is reached. The work waits for it to reset${stop.resets === null ? '' : ` at ${new Date(stop.resets).toISOString()}`}, and nothing is lost.`, 'Nothing: the task closes by itself at the reset', 'nowhere'],
  };
  const [question, step, where] = WORDS[stop.cause] ?? [`Clear the block that stopped session ${stop.session} (${stop.cause})?`, `Clear the block (${stop.cause})`, 'outside DeepBuild'];
  const why = stop.cause === 'plan_window_spent'
    ? `session ${stop.session} stopped: its plan window is spent; the reset time is the check`
    : `session ${stop.session} stopped: ${stop.cause}, block ${stop.signature}, which only you can clear`;
  return { question, steps: [step, 'Its check passes, the task closes by itself, and every session it unblocks resumes'], where, why };
}

/**
 * A sign-in task's words (#1349): one plain line, the steps (Sign in opens the agent's own window or browser page, and
 * the plan line), where you do it and why. The agent's name comes from its facts, and the plan line from install.json,
 * a price only with the date it was read and the maker's page as a plain host.
 */
export function signInText(agent: string, lapsed: boolean): { question: string; steps: string[]; where: string; why: string } {
  let name = agent;
  try {
    const entries = readFacts<Obj>(`${agent}.facts.json`).entries;
    if (isObj(entries) && typeof entries.name === 'string') name = entries.name;
  } catch { /* no facts: its id */ }
  let plan: Obj | undefined;
  try {
    const of = readFacts<Obj>('install.json').agents;
    const entry = isObj(of) ? of[agent] : undefined;
    if (isObj(entry) && isObj(entry.plan)) plan = entry.plan;
  } catch { /* none */ }
  const steps = [`Press Sign in: ${name} opens its own window or browser page, and you sign in there. DeepBuild never sees your password and never picks a plan for you.`];
  if (plan?.paid === true) {
    const price = typeof plan.price === 'string' && typeof plan.read === 'string' ? ` ${plan.price}, as read on ${plan.read}.` : '';
    let page = '';
    try { if (typeof plan.page === 'string') { const url = new URL(plan.page); page = ` Its plans: ${url.host}${url.pathname.replace(/\/$/, '')}`; } } catch { /* not a URL: none */ }
    steps.push(`${name} needs a paid plan.${price}${page}`);
  }
  steps.push(`Once ${name} reads signed in, this closes by itself and the work goes on`);
  return {
    question: lapsed ? `Sign in to ${name} again? Your sign-in lapsed. The work waits, and nothing is lost.` : `Sign in to ${name}? Your words wait for it, and nothing is lost.`,
    steps, where: `${name}'s own window or browser page`, why: lapsed ? `${name} stopped: its sign-in lapsed` : `Your first request needs ${name}, which reads not signed in`,
  };
}
