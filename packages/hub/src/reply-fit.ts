// What a client keeps of one tool result (#2896), from the agents' facts (`toolResult`), and a deep_* reply held a fifth
// under it: Claude Code files a result past 50,000 characters or 25,000 tokens and Codex cuts one past 10,000 tokens, so a
// reply past either never reaches the agent whole. `deep mcp` names its client from its initialize; a known agent takes
// its version's entry (or, at a version its facts don't list, the smallest of its entries), and any other client the
// smallest figure any facts file holds. A paged reply is asked again for a smaller page until it fits; the rest comes by
// `next`, as before. A refusal over its client's error limit keeps its first failing path whole and drops the rest of
// the schema, which tools/list gives. DeepBuild never raises a client's limit: a reply is paged, never made larger.
import { factsFiles, readFacts } from '@deepbuild/adapters';
import type { Refusal } from './wire.js';

type Obj = Record<string, unknown>;
/** A limit in each unit a client counts; a unit it doesn't count is left out. */
export interface Figures { chars?: number; tokens?: number; bytes?: number }
interface Entry { versions: string[]; result: Figures; error: Figures }
/** The limit a client is held to, as mcp.tools_listed@2 records it. */
export interface Limit { client: string | null; client_version: string | null; from: string; result: Figures; error: Figures; cap: Figures; error_cap: Figures }

const UNITS = ['chars', 'tokens', 'bytes'] as const;
/** Which facts file a client's name belongs to: the names the agents give in their initialize. */
const AGENTS: [RegExp, string, string][] = [[/codex/i, 'codex', 'codex.facts.json'], [/^claude/i, 'claude-code', 'claude-code.facts.json']];

const read = new Map<string, Entry[]>();
/** A facts file's toolResult entries, read once. */
function entriesOf(file: string): Entry[] {
  let entries = read.get(file);
  if (!entries) {
    const tr = readFacts<Obj>(file).toolResult as { entries?: Entry[] } | undefined;
    entries = Array.isArray(tr?.entries) ? tr.entries : [];
    read.set(file, entries);
  }
  return entries;
}
/** The smallest figure in each unit across `list`. */
function smallest(list: Figures[]): Figures {
  const out: Figures = {};
  for (const f of list) for (const u of UNITS) if (typeof f[u] === 'number') out[u] = Math.min(out[u] ?? Infinity, f[u]);
  return out;
}
/** A fifth under each figure. */
const fifthUnder = (f: Figures): Figures => Object.fromEntries(UNITS.filter((u) => f[u] !== undefined).map((u) => [u, Math.floor(f[u]! * 0.8)])) as Figures;

/** Every toolResult entry of every shipped facts file. */
const allEntries = (): Entry[] => factsFiles().flatMap(entriesOf);

/** Where an unknown client's limit comes from. */
export const UNKNOWN = 'the smallest figure in each unit any facts file holds, since the facts know no such client';

/** The limit a client is held to, by the name and version its initialize gives. */
export function limitOf(client: unknown): Limit {
  const info = (typeof client === 'object' && client !== null ? client : {}) as Obj;
  const name = typeof info.name === 'string' ? info.name : null;
  const version = typeof info.version === 'string' ? info.version : null;
  const agent = name === null ? undefined : AGENTS.find(([re]) => re.test(name));
  const all = allEntries();
  let from = UNKNOWN;
  let result = smallest(all.map((e) => e.result));
  let error = smallest(all.map((e) => e.error));
  if (agent) {
    const mine = entriesOf(agent[2]);
    const exact = version === null ? undefined : mine.find((e) => e.versions.includes(version));
    const chosen = exact ? [exact] : mine;
    if (chosen.length) {
      from = exact ? `${agent[1]} ${version} (adapters/${agent[2]} toolResult)` : `the smallest of ${agent[1]}'s entries (adapters/${agent[2]} toolResult), since it lists no version ${version ?? '(none given)'}`;
      result = smallest(chosen.map((e) => e.result));
      // An agent whose facts give an error no character figure is held to the smallest any facts file holds.
      const own = smallest(chosen.map((e) => e.error));
      error = own.chars === undefined && error.chars !== undefined ? { ...own, chars: error.chars } : own;
    }
  }
  return { client: name, client_version: version, from, result, error, cap: fifthUnder(result), error_cap: fifthUnder(error) };
}

let counter: ((text: string) => number) | undefined;
/** Tokens of `text` in the tokenizer both facts files pin (o200k_base, gpt-tokenizer 4.0.0). */
async function tokensOf(text: string): Promise<number> {
  counter ??= (await import('gpt-tokenizer/encoding/o200k_base')).countTokens;
  return counter(text);
}
/** How far `text` passes each figure of `cap`: the largest ratio of size to figure, at most 1 when it fits. */
async function over(text: string, cap: Figures): Promise<number> {
  let worst = 0;
  if (cap.chars) worst = Math.max(worst, text.length / cap.chars);
  if (cap.bytes) worst = Math.max(worst, Buffer.byteLength(text) / cap.bytes);
  if (cap.tokens) worst = Math.max(worst, (await tokensOf(text)) / cap.tokens);
  return worst;
}

/** The bytes the canvas core is given for a reply first: JSON rows run about two characters a token, rarely fewer. */
export const roomOf = (cap: Figures): number => Math.min(cap.chars ?? Infinity, cap.bytes ?? Infinity, (cap.tokens ?? Infinity) * 2);

/**
 * A reply that fits `cap` as its client receives it (the value's JSON, the text deep mcp sends): asked with the room
 * `roomOf` gives, then again with less while it is over and pages (it carries `next`), each time in proportion to how far
 * it passed. A reply that doesn't page, or a call that may change something (`retry` false), is asked once.
 */
export async function fitted(cap: Figures, retry: boolean, ask: (room: number) => Promise<Obj>): Promise<Obj> {
  let room = Math.floor(roomOf(cap));
  for (let tries = 0; ; tries++) {
    const reply = await ask(room);
    const by = await over(JSON.stringify(reply), cap);
    if (by <= 1 || !retry || reply.next === undefined || tries >= 6 || room <= 1024) return reply;
    room = Math.max(1024, Math.floor((room / by) * 0.95));
  }
}

/**
 * A refusal under its client's error cap: one that would pass it keeps its first failing path's schema whole and says
 * the rest reads in tools/list, then its value at the path is cut to what fits.
 */
export async function refusalFits(refusal: Partial<Refusal> & Obj, cap: Figures): Promise<Partial<Refusal> & Obj> {
  if ((await over(JSON.stringify(refusal), cap)) <= 1) return refusal;
  const out: Obj = { ...refusal };
  const schema = out.schema as { properties?: Obj } | undefined;
  if (schema && typeof schema === 'object') {
    const field = String(out.path ?? '').split('/').filter(Boolean).at(-1) ?? '';
    const first = schema.properties?.[field];
    out.schema = first === undefined ? { type: 'object' } : { type: 'object', properties: { [field]: first }, required: [field] };
    out.remediation = `${String(out.remediation ?? '')} schema holds only ${field || 'the failing path'}: the tool's whole input schema is its inputSchema in tools/list.`;
  }
  for (let by = await over(JSON.stringify(out), cap); by > 1 && typeof out.actual === 'string' && out.actual.length; by = await over(JSON.stringify(out), cap)) {
    out.actual = out.actual.slice(0, Math.floor((out.actual.length / by) * 0.9));
  }
  return out as Partial<Refusal> & Obj;
}
