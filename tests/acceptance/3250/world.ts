// Test-side tools for the #3250 tests: a real hub (`deep hub run`) in a temporary home, a Claude Code session the hub
// verified through its own hooks (the #26 agent stand-in, tests/acceptance/26/helpers.ts), a transcript under the fake
// home's ~/.claude/projects written as Claude Code 2.1.299 and later write it, and the hub's surfaces read from outside:
// `events.read`, `numbers.read` and `deep numbers`. No hub, readings or CLI module is imported.
import { randomUUID } from 'node:crypto';
import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { Agent, cleanup, control, deep, eventMatching, events, makeHome, makeWorktree, startHub, stopHub, type Ev, type Hub, type Line, type Session } from '../26/helpers.ts';

/** On the shipped rate card at the base: input 5 USD a million, so the cost is an estimate. */
export const MODEL = 'claude-opus-4-5';
/** A hub test's own limit: a hub and an agent stand-in on a loaded Mac. */
export const TIMEOUT = 240_000;
/** How long a stop's turn.usage may take to land: the hub writes it off the hook's path. */
// deadline: bounds the wait for the hub's turn.usage, so a hub that never writes it fails instead of hanging.
const LANDS_MS = 60_000;

/** What one assistant message wrote: the write total alone (no split), or its split (the total is the parts' sum). */
export type Wrote = { input?: number; output?: number; read?: number } & ({ total: number } | { oneHour?: number; fiveMinute?: number });
let made = 0;
/** One assistant line, as Claude Code writes it: the write total in cache_creation_input_tokens, its split under cache_creation. */
export function assistant(w: Wrote): string {
  const n = ++made;
  const base = { input_tokens: w.input ?? 0, output_tokens: w.output ?? 0, cache_read_input_tokens: w.read ?? 0 };
  const usage = 'total' in w
    ? { ...base, cache_creation_input_tokens: w.total }
    : { ...base, cache_creation_input_tokens: (w.oneHour ?? 0) + (w.fiveMinute ?? 0), cache_creation: { ephemeral_1h_input_tokens: w.oneHour ?? 0, ephemeral_5m_input_tokens: w.fiveMinute ?? 0 } };
  return JSON.stringify({ type: 'assistant', uuid: `a-3250-${n}-${randomUUID()}`, isSidechain: false, message: { id: `msg_3250_${n}_${randomUUID().slice(0, 8)}`, type: 'message', role: 'assistant', model: MODEL, content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage } });
}
/** A typed prompt's line, beginning a turn. */
const prompt = (text: string): string => JSON.stringify({ type: 'user', uuid: `u-3250-${randomUUID()}`, isSidechain: false, message: { role: 'user', content: text } });

export interface World { hub: Hub; agent: Agent; session: Session; home: string }
/** A home, a worktree, an agent stand-in there, the hub, and one Claude Code session established through its hooks. */
export async function world(): Promise<World> {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  const agent = Agent.start(home, wt.path);
  const session = agent.session(wt.path, 'start');
  const hub = await startHub(home);
  await agent.hook(hub, session, 'SessionStart');
  return { hub, agent, session, home };
}
/**
 * #26's cleanup, then the temp folder it couldn't remove: a process the hub started can still be writing there as it
 * stops, so the folder is removed again with node's own retries.
 */
export async function tidy(): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    const dir = /'(\/[^']*dh26-[^'/]+)'/.exec(String(error))?.[1];
    if (!dir) throw error;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}
export const close = (w: World | undefined): Promise<void> => (w ? stopHub(w.hub) : Promise.resolve());

/**
 * One turn of the session: its prompt through UserPromptSubmit and a tool call, the transcript's prompt and assistant
 * lines, then its Stop. Resolves with the turn.usage the hub wrote for this stop, the first of the session's not in `had`.
 */
export async function turn(w: World, messages: Wrote[], had: readonly Ev[] = []): Promise<Ev | undefined> {
  await w.agent.hook(w.hub, w.session, 'UserPromptSubmit', { prompt: 'fix the login page' });
  await w.agent.hook(w.hub, w.session, 'PreToolUse');
  appendFileSync(w.session.transcript, [prompt('fix the login page'), ...messages.map(assistant)].join('\n') + '\n');
  await w.agent.hook(w.hub, w.session, 'Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
  const seen = new Set(had.map((e) => e.id));
  return eventMatching(w.hub, (e) => e.kind === 'turn.usage' && e.session === w.session.id && !seen.has(e.id), LANDS_MS);
}
/** The session's turn.usage events, in log order. */
export const usages = async (hub: Hub, session: string): Promise<Ev[]> => (await events(hub)).filter((e) => e.kind === 'turn.usage' && e.session === session);
/** An event's schema version, as events.read gives it. */
export const versionOf = (e: Ev | undefined): unknown => (e as (Ev & { v?: unknown }) | undefined)?.v;

/** numbers.read's rows. */
export async function rows(hub: Hub): Promise<Line[]> {
  const conn = await control(hub);
  try {
    const reply = await conn.call('numbers.read', {});
    expect(reply.error, `numbers.read: ${JSON.stringify(reply.error)}`).toBeUndefined();
    expect(Array.isArray(reply.result?.rows), 'numbers.read returns rows').toBe(true);
    return reply.result.rows as Line[];
  } finally {
    conn.close();
  }
}
/** `deep numbers`, run by you. */
export async function numbersText(home: string): Promise<string> {
  const shown = await deep(home, ['numbers']);
  expect(shown.code, `deep numbers: ${shown.stderr}`).toBe(0);
  return shown.stdout;
}
/**
 * The subjects that name a session: `session:<id>`, its id as given or with what isn't a letter or digit taken out (the
 * record's subject pattern is `^session:[0-9A-Za-z]+$`, so a hyphenated UUID is named without its hyphens).
 */
const subjectsOf = (session: string): string[] => [...new Set([session, session.replace(/[^0-9A-Za-z]/g, '')])].map((s) => `session:${s}`);
/** A reading of the session's own, by its id. */
export const sessionRow = (all: readonly Line[], id: string, session: string): Line | undefined => all.find((r) => r.id === id && subjectsOf(session).includes(String(r.subject ?? '')));
/** The `deep numbers` line of a reading of the session's: `<id> <subject>: …`. */
export const sessionLine = (text: string, id: string, session: string): string | undefined => text.split('\n').find((l) => subjectsOf(session).some((s) => l.startsWith(`${id} ${s}:`)));

export const AT_LEAST = /at[ _-]?least/i;
/** Whether a value reads "at least": a field named so and set true, or a text in it that says so, at any depth. */
export function saysAtLeast(value: unknown, key = ''): boolean {
  if (typeof value === 'string') return AT_LEAST.test(value);
  if (value === true) return AT_LEAST.test(key);
  if (Array.isArray(value)) return value.some((v) => saysAtLeast(v, key));
  if (typeof value === 'object' && value !== null) return Object.entries(value).some(([k, v]) => saysAtLeast(v, k));
  return false;
}
/** Every number in `value` with the dotted path of keys that leads to it. */
export function numbersIn(value: unknown, path = ''): { path: string; n: number }[] {
  if (typeof value === 'number') return [{ path, n: value }];
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => numbersIn(v, path ? `${path}.${k}` : k));
  return [];
}
export const ONE_HOUR = /1h|one[ _-]?hour|hour/i;
export const FIVE_MINUTE = /5m|five[ _-]?min|minute/i;
