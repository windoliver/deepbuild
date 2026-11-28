// Test-side tools for the #3460 acceptance tests (README). The hub (`deep hub run`), `deep mcp`, the agent stand-in
// and the built CLI are those of tests/acceptance/26, and the wiki's writer and the world those of
// tests/acceptance/355 (imported, never copied, as #884's and #1515's suites import them): temp homes under
// /tmp/dh355-*, HOME a temp folder for this process and every child, no network, processes stopped by PID only.
// Nothing here stands in for the hub, its index, `deep_search` or `deep find`.

import { expect } from 'vitest';
import { childEnv, CLI, NODE, run, type Ran } from '../26/helpers.ts';
import {
  callTool, handle, openWiki, seedDecision, valueOf, type Candidate, type Line, type Mcp, type Opened, type World,
} from '../355/helpers.ts';

/** Each tested criterion's ID: `#3460.` and the first 8 hex of SHA-256 of its text, as scripts/proof-change.mjs reads it; the tenth has no test (README). */
export const AC = {
  1: '#3460.67d53f5f', 2: '#3460.74f4978c', 3: '#3460.8dffa8bf', 4: '#3460.fd277010', 5: '#3460.c0d74b68',
  6: '#3460.deebb776', 7: '#3460.7cd4a1ff', 8: '#3460.6ad8cdef', 9: '#3460.e44187b3',
} as const;

// ---- The notes, word for word (README: What the implementer builds).
/** Today's note for a query with no word (packages/hub/src/search.ts at the base). */
export const NO_WORDS = 'The query had no words to search for: a word is a run of letters or digits.';
/** How many of a query's words an empty reply's note reads. */
export const READ = 16;
/** What a note ends with when the query had more than 16 words. */
export const leftUnread = (n: number): string => ` The search read the query's first ${READ} words and left ${n} unread.`;
/** The note naming each word, of those read, that no source the call may read holds, in the query's order. */
export const noSourceHolds = (words: readonly string[], unread = 0): string => `No source this call may read holds these words: ${words.join(', ')}.${unread ? leftUnread(unread) : ''}`;
/** The note when every word read is held somewhere the call may read. */
export const NO_ONE_SOURCE = 'Each word is held by a source this call may read, but no one source holds them all.';
/** The words a note names as held by nothing: those of its list, none for any other note. */
export const namedIn = (note: unknown): string[] => /^No source this call may read holds these words: ([^.]*)\./.exec(String(note))?.[1]?.split(', ') ?? [];
/** `deep find`'s sentence for a query of two or more words that finds nothing; `--json` carries it as `note`. */
export const lookedForAsOneRun = (query: string): string => `Nothing in the record holds ${JSON.stringify(query)} as one run of characters.`;
/** `deep find`'s sentence today for a query that finds nothing (packages/reading/src/index.ts at the base). */
export const nothingHolds = (query: string): string => `Nothing in the record holds ${JSON.stringify(query)}.`;

// ---- The fixture wiki of the first six criteria (README: The fixture).
export interface Fact { page: string; id: string; text: string }
/** The one claim about ports. */
export const API: Fact = { page: 'repos/api', id: 'port', text: '`api` starts on port 3000' };
/** The claim that holds `redis` and not `port`. */
export const CACHE: Fact = { page: 'setup', id: 'cache', text: 'The cache is redis 7' };

/**
 * Has the shipped wiki learn each claim at scope `all`, in the order given, each resting on a decision of yours that
 * holds its text, as #884's suite learns its claims; returns each source decision's handle by its claim's.
 */
export async function learn(w: World, o: Opened, facts: readonly Fact[]): Promise<Map<string, string>> {
  const candidates: Candidate[] = [];
  const sources = new Map<string, string>();
  for (const f of facts) {
    const source = await seedDecision(w, o, f.text, 'all');
    sources.set(handle(f), source);
    candidates.push({ ...f, scope: 'all', sources: [{ at: source, quote: f.text }] });
  }
  const wiki = await openWiki({ record: o.record, folder: w.wiki, now: w.clock.now });
  const learned = await wiki.learn(candidates);
  const lost = candidates.map(handle).filter((h) => !learned.written.includes(h));
  if (lost.length) throw Error(`BLOCKED: the wiki didn't write the fixture claims ${lost.join(', ')}: ${JSON.stringify(learned).slice(0, 1500)}`);
  return sources;
}

// ---- deep_search, as an MCP client calls it.
export interface Reply { hits: Line[]; more?: number; next?: string; note?: unknown; [key: string]: unknown }
/** One deep_search reply: a tool result, never an error, whose value holds `hits`. */
export async function search(m: Mcp, query: string, cursor?: string): Promise<{ value: Reply; result: Line }> {
  const out = await callTool(m, 'deep_search', { query, ...(cursor !== undefined ? { cursor } : {}) });
  const value = valueOf(out, `deep_search ${JSON.stringify(query)}`) as Reply;
  expect(Array.isArray(value?.hits), `deep_search ${JSON.stringify(query)} answers with hits: ${JSON.stringify(out.reply).slice(0, 1500)}`).toBe(true);
  return { value, result: (out.reply.result ?? {}) as Line };
}
/** Every hit's source for a query, in order, following `next` to the last page. */
export async function everySource(m: Mcp, query: string): Promise<string[]> {
  const out: string[] = [];
  for (let cursor: string | undefined, page = 0; ; page++) {
    const { value } = await search(m, query, cursor);
    out.push(...value.hits.map((h) => String(h.source)));
    cursor = typeof value.next === 'string' ? value.next : undefined;
    if (cursor === undefined) return out;
    if (page > 200) throw Error(`BLOCKED: deep_search ${JSON.stringify(query)} never reaches its last page`);
  }
}

// ---- `deep find`, as the built CLI run by you over the world's root.
export const find = (w: World, args: readonly string[]): Promise<Ran> => run(NODE, [CLI, 'find', ...args, '--root', w.root], { env: childEnv(w.home), cwd: w.elsewhere, timeoutMs: 120_000 });

/** What changed between two sets, for a failure's message: the hits gained and the hits lost. */
export function delta(got: readonly string[], want: readonly string[]): string {
  const gained = got.filter((s) => !want.includes(s));
  const lost = want.filter((s) => !got.includes(s));
  return `gained ${JSON.stringify(gained)}, lost ${JSON.stringify(lost)}`;
}
