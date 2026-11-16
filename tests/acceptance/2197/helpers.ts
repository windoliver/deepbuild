// Test-side tools for the #2197 acceptance tests. The worlds are #26's: a real hub (`deep hub run`) in a temporary
// home, its record seeded beforehand through the real record and asks core, and agent stand-ins whose hooks and
// `deep mcp` are their children, so the hub binds each `deep mcp` to its session. Every observation is a
// `deep_status` reply read through MCP, checked against the hub's log read through `events.read`; no hub, CLI or
// `deep mcp` module is imported.
//
// The issue fixes what a reply says and leaves its field names and its shape open. So the readers below take any
// reply that states the fact, in an object, a list or a sentence, and each says in its own comment what it takes
// (README: The surface; Pinned here).

import { join } from 'node:path';
import { expect } from 'vitest';
import { askSources } from '../../../packages/asks/src/index.ts';
import {
  Agent, agentWorld, callTool, DAY, events, HOUR, initialize, makeHome, makeWorktree, MINUTE, PROJECT, seed, sha256, startHub, valueOf,
  type Ev, type Hub, type Line, type Seeding, type Session, type World,
} from '../26/helpers.ts';

/** A reply, cut for a message. */
export const shown = (value: unknown): string => (JSON.stringify(value) ?? String(value)).slice(0, 2000);
const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `token` standing as a word of its own: nothing a name is written with (a letter, a digit, `_` or `-`) on either side. */
const asWord = (token: string, flags = ''): RegExp => new RegExp(`(?<![A-Za-z0-9_-])${esc(token)}(?![A-Za-z0-9_-])`, flags);

// ---- The repo's spec: the checks unit and e2e (criterion 1), named by its done claim and in its checks block, so
// either reading of "the checks the spec names" gives these two; the asks block as #26's worlds declare it.
export const CHECKS = ['unit', 'e2e'] as const;
export const SPEC = [
  'claims:',
  '  done:',
  '    checks: [unit, e2e]',
  'checks:',
  '  unit: { type: command, run: "false" }',
  '  e2e: { type: command, run: "false" }',
  'asks:',
  '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
  '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
  '  fallback: [change-owner]',
  '',
].join('\n');
const FILES = { '.deepbuild/done.yaml': SPEC };

// ---- An open taste ask, raised for a session through the asks core before the hub starts.
export interface Option { id: string; label: string }
export interface OpenAsk {
  handle: string;
  session: string;
  question: string;
  /** The option it takes at its deadline, and the one it doesn't. */
  takes: Option;
  other: Option;
  /** When it takes it, in ms. */
  deadline: number;
}
const SLATE: Option = { id: 'slate', label: 'Slate accent' };
const AMBER: Option = { id: 'amber', label: 'Amber accent' };
const tasteSource = (): string => askSources().find((row) => row.kind === 'taste' && !/^(asks|request)\./.test(row.source))!.source;
/**
 * A taste ask with no recommendation, as an agent's question without one is filed, whose default is its second
 * option, so a reply that says the default says what the record holds and not the first option or a recommendation.
 * Its deadline is a whole minute, 2 days 3 h 17 min on, so a reply that says it to the minute says it exactly.
 */
export async function raiseTaste(s: Seeding, session: string, question: string): Promise<OpenAsk> {
  const deadline = Math.ceil(s.now() / MINUTE) * MINUTE + 2 * DAY + 3 * HOUR + 17 * MINUTE;
  const data = {
    kind: 'taste', question, options: [SLATE, AMBER].map((o) => ({ ...o, decision: 'none' })), recommended: null, deadline,
    fallback: 'you', default: AMBER.id, provisional: false, owner: 'you', key: sha256(`taste:${question}`),
    pinned_to: { kind: 'evidence', ref: sha256(question) },
  };
  const handle = await s.asks.raise({ writer: 'core', actor: 'you', scope: 'you', session, project: PROJECT }, tasteSource(), data);
  return { handle, session, question, takes: AMBER, other: SLATE, deadline };
}
/**
 * The ask as the running hub's log holds it: still open, a taste ask, filed under its session, with its default and
 * the deadline it has now (a deadline.moved or default.undone after it is the newer one). Anything else is BLOCKED:
 * the world isn't the criterion's Given.
 */
export async function recorded(hub: Hub, ask: OpenAsk): Promise<OpenAsk> {
  const all = await events(hub);
  const created = all.find((e) => e.kind === 'ask.created' && `ask:${e.id}` === ask.handle);
  if (!created) throw Error(`BLOCKED: the hub's log holds no ask.created for ${ask.handle}`);
  const about = (e: Ev) => e.subject === ask.handle || e.data?.ask === ask.handle;
  const closed = all.filter((e) => about(e) && /^(ask\.(answered|defaulted|cancelled|moot|superseded|escalated)|decision\.applied)$/.test(e.kind));
  if (created.session !== ask.session || created.data.kind !== 'taste' || created.data.default !== ask.takes.id || closed.length) {
    throw Error(`BLOCKED: ${ask.handle} isn't an open taste ask of session ${ask.session} that takes ${ask.takes.id}: ${shown({ created, closed: closed.map((e) => e.kind) })}`);
  }
  let deadline = created.data.deadline as number;
  for (const e of all) if (about(e) && (e.kind === 'deadline.moved' || e.kind === 'default.undone') && typeof e.data.deadline === 'number') deadline = e.data.deadline;
  return { ...ask, deadline };
}

// ---- Worlds.
export interface One extends World { ask?: OpenAsk }
/**
 * One session of an agent in a repo whose spec names unit and e2e, known to the hub from its hooks alone. With
 * `ask`, the record holds the session and that one open taste ask of its before the hub starts, after whatever
 * `before` seeds.
 */
export async function oneSession(o: { ask?: string; before?: (s: Seeding, worktree: string) => Promise<void> } = {}): Promise<One> {
  const question = o.ask;
  if (question === undefined) return agentWorld({ files: FILES });
  let ask: OpenAsk | undefined;
  const w = await agentWorld({
    files: FILES,
    seeded: async (s, session, worktree) => {
      if (o.before) await o.before(s, worktree);
      await s.start(session.id, worktree);
      ask = await raiseTaste(s, session.id, question);
    },
  });
  return { ...w, ask: await recorded(w.hub, ask!) };
}
export interface Party { agent: Agent; session: Session; ask: OpenAsk }
export interface Two { hub: Hub; a: Party; b: Party }
/**
 * Two sessions with an open taste ask each (criterion 4): two agent processes working in one worktree of one repo,
 * each with its own session, hooks and `deep mcp`, so a status that reads by repo, by worktree or by nothing at all
 * holds the other's ask. `plant` goes to the hub and into both agents' environments, so their `deep mcp` has it too.
 */
export async function twoSessions(plant?: string): Promise<Two> {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'), { files: FILES });
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const agents = [Agent.start(home, wt.path, env), Agent.start(home, wt.path, env)] as const;
  const sessions = [agents[0].session(), agents[1].session()] as const;
  const questions = ['Which accent for the login header?', 'Which corner radius for the cart button?'] as const;
  const asks: OpenAsk[] = [];
  await seed(home, async (s) => {
    for (const i of [0, 1] as const) {
      await s.start(sessions[i].id, wt.path);
      asks.push(await raiseTaste(s, sessions[i].id, questions[i]));
    }
  });
  const hub = await startHub(home, { plant });
  const parties: Party[] = [];
  for (const i of [0, 1] as const) {
    await agents[i].establish(hub, sessions[i]);
    await initialize(agents[i]);
    parties.push({ agent: agents[i], session: sessions[i], ask: await recorded(hub, asks[i]!) });
  }
  return { hub, a: parties[0]!, b: parties[1]! };
}

// ---- The calls.
/** The agent's `deep_status`, called as the skill says to, with no argument: its value, a JSON object. */
export async function status(agent: Agent): Promise<Line> {
  const value: unknown = valueOf(await callTool(agent, 'deep_status', {}), 'deep_status');
  expect(isObj(value), `deep_status answers with a JSON object: ${shown(value)}`).toBe(true);
  return value as Line;
}
/**
 * The agent records an open item with `deep_open_item`, and the hub's log holds it under the agent's session with
 * that text; otherwise BLOCKED, since the world isn't the criterion's Given.
 */
export async function openItem(hub: Hub, party: { agent: Agent; session: Session }, text: string): Promise<void> {
  valueOf(await callTool(party.agent, 'deep_open_item', { text }), 'deep_open_item');
  const held = (await events(hub)).filter((e) => e.kind === 'open_item.opened' && e.session === party.session.id);
  if (!held.some((e) => e.data?.text === text)) throw Error(`BLOCKED: the hub's log holds no open_item.opened "${text}" under session ${party.session.id}: ${shown(held.map((e) => e.data))}`);
}

// ---- Reading a reply.
/** Every string in a value: its keys, and its string values. */
function strings(value: unknown, into = { keys: [] as string[], values: [] as string[] }): { keys: string[]; values: string[] } {
  if (typeof value === 'string') into.values.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, into);
  else if (isObj(value)) for (const [key, inner] of Object.entries(value)) { into.keys.push(key); strings(inner, into); }
  return into;
}
/**
 * The names the reply doesn't list. A name is listed when it stands in the reply as a string of its own, as a key, or
 * as a word of its own in a longer string, so a list of names, a list or a map of checks and a sentence all count.
 */
export function notListed(reply: unknown, names: readonly string[]): string[] {
  const { keys, values } = strings(reply);
  return names.filter((name) => !keys.includes(name) && !values.some((v) => v === name || asWord(name).test(v)));
}
/** Whether some string of the reply holds `text` whole. */
export const holdsText = (reply: unknown, text: string): boolean => { const { keys, values } = strings(reply); return [...keys, ...values].some((s) => s.includes(text)); };
/** The forms among `forms` that the reply holds anywhere, letter case aside. */
export function held(reply: unknown, forms: readonly string[]): string[] {
  const text = (JSON.stringify(reply) ?? '').toLowerCase();
  return forms.filter((form) => text.includes(form.toLowerCase()));
}
/** What would put an ask in a reply: its handle, its bare ID, and its question. */
export const formsOf = (ask: OpenAsk): string[] => [ask.handle, ask.handle.slice(4), ask.question];
/** A session's ID as it may be written: whole, and with only its letters and digits. */
export const idForms = (session: string): string[] => [session, session.replace(/[^0-9A-Za-z]/g, '')];

/**
 * An ask's entries in a reply: each part of the reply that is about the ask whose handle it holds. For a handle that
 * is a string in the reply (or part of one), the item of the nearest list around it; with no list around it, the
 * innermost object below the reply itself; with neither, the string. For a handle that is a key, the key with its
 * value.
 */
export function entriesOf(reply: unknown, handle: string): unknown[] {
  const out: unknown[] = [];
  const visit = (node: unknown, chain: unknown[]): void => {
    if (typeof node === 'string') {
      if (!node.includes(handle)) return;
      let list = -1;
      for (let i = chain.length - 1; i >= 0 && list < 0; i--) if (Array.isArray(chain[i])) list = i;
      out.push(list >= 0 ? chain[list + 1] ?? node : chain.length > 1 ? chain[chain.length - 1] : node);
    } else if (Array.isArray(node)) {
      for (const item of node) visit(item, [...chain, node]);
    } else if (isObj(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (key.includes(handle)) out.push({ [key]: value });
        visit(value, [...chain, node]);
      }
    }
  };
  visit(reply, []);
  return out;
}
/**
 * The words the base and the design already have for the state of an ask that is open, not put off and not folded
 * into another: ask.machine@1's state; what deep_ask and deep_wait answer for one; the asks core's outcome and its
 * inbox statuses for one, not yet shown (queued, or held while its session's message is unread) or shown; and the
 * word and the status-map entry States people see gives it.
 */
export const OPEN_WORDS = ['open', 'waiting', 'unanswered', 'queued', 'held', 'shown', 'needs you', 'needs_you'] as const;
const saysOpen = (text: string): boolean => OPEN_WORDS.some((w) => asWord(w, 'i').test(text));
const count = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length;
/** How often a text names an option: its ID as a word of its own, or its label. */
const names = (text: string, option: Option): number => count(text, asWord(option.id, 'g')) + count(text, new RegExp(esc(option.label), 'g'));
/**
 * Whether a text says the instant `at`: as ms or as seconds since the Unix epoch (a number of 13 or of 10 digits,
 * within a second), or as an ISO 8601 date and time to the minute or finer, with a zone or, without one, in UTC or
 * this machine's zone (within a minute).
 */
export function saysWhen(text: string, at: number): boolean {
  for (const [digits] of text.matchAll(/(?<![0-9A-Za-z.])(?:\d{13}|\d{10})(?![0-9A-Za-z])/g)) {
    if (Math.abs((digits.length === 13 ? Number(digits) : Number(digits) * 1000) - at) < 1000) return true;
  }
  for (const [found] of text.matchAll(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g)) {
    const stamp = found.replace(' ', 'T');
    const readings = /(?:Z|[+-]\d{2}:?\d{2})$/.test(stamp) ? [Date.parse(stamp)] : [Date.parse(stamp), Date.parse(`${stamp}Z`)];
    if (readings.some((t) => Math.abs(t - at) < MINUTE)) return true;
  }
  return false;
}
/**
 * What a reply leaves out of criterion 2 for an open ask, one line each: its handle; and, in one entry of the ask,
 * its state (one of OPEN_WORDS, as a word of its own), its default (the option it takes named, by ID or label, more
 * often than the other option, so a list of both options alone doesn't count) and when it takes it (saysWhen).
 */
export function askProblems(reply: unknown, ask: OpenAsk): string[] {
  const at = `${ask.deadline} ms, ${new Date(ask.deadline).toISOString()}`;
  const entries = entriesOf(reply, ask.handle);
  if (!entries.length) return [`the reply doesn't hold the ask's handle ${ask.handle}, so neither its state, its default (${ask.takes.id}) nor when it takes it (${at})`];
  const problems = entries.map((entry) => {
    const text = typeof entry === 'string' ? entry : JSON.stringify(entry) ?? '';
    return [
      ...(saysOpen(text) ? [] : [`${ask.handle}'s entry doesn't say its state, open (as one of: ${OPEN_WORDS.join(', ')})`]),
      ...(names(text, ask.takes) > names(text, ask.other) ? [] : [`${ask.handle}'s entry doesn't say its default, ${ask.takes.id} ("${ask.takes.label}"), apart from its other option`]),
      ...(saysWhen(text, ask.deadline) ? [] : [`${ask.handle}'s entry doesn't say when it takes its default: ${at} (as ms, seconds or an ISO 8601 date and time)`]),
    ].map((line) => `${line}: ${text.slice(0, 600)}`);
  });
  return problems.sort((x, y) => x.length - y.length)[0]!;
}
