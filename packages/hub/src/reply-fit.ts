// What a client keeps of one tool result (#2896), from the agents' facts (`toolResult`), and a deep_* reply held a fifth
// under it: Claude Code files a result past 50,000 characters or 25,000 tokens and Codex cuts one past 10,000 tokens, so a
// reply past either never reaches the agent whole. `deep mcp` names its client from its initialize; a known agent takes
// its version's entry (or, at a version its facts don't list, the smallest of its entries), and any other client the
// smallest figure any facts file holds. What is held: the paging canvas replies (deep_show, deep_query, deep_kinds),
// each given a room to page into, a read asked again for a smaller page until it fits, the rest by `next` as before; and
// every refusal, which over its client's error limit keeps the top-level argument its path fails under and drops the
// rest of the schema, which tools/list gives. Other deep_* replies are not sized. DeepBuild never raises a client's
// limit: a reply is paged, never made larger.
import { factsFiles, readFacts } from '@deepbuild/adapters';
import type { Refusal } from './wire.js';

type Obj = Record<string, unknown>;
/** A limit in each unit a client counts; a unit it doesn't count is left out. */
export interface Figures { chars?: number; tokens?: number; bytes?: number }
interface Entry { versions: string[]; result: Figures; error: Figures }
/** The limit a client is held to, as mcp.tools_listed@2 records it. */
export interface Limit { client: string | null; client_version: string | null; from: string; result: Figures; error: Figures; cap: Figures; error_cap: Figures }

const UNITS = ['chars', 'tokens', 'bytes'] as const;
/** Which facts file a client's name belongs to: the exact names the agents give in their initialize; any other is unknown. */
const AGENTS: [string, string, string][] = [['codex-mcp-client', 'codex', 'codex.facts.json'], ['claude-code', 'claude-code', 'claude-code.facts.json']];

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
/**
 * An error's cap: a fifth under its characters (the 9,000 drafted from the 11,000 an error keeps) and its tokens, whose count
 * a cut can miss by a token or two, but its bytes whole: they are counted exactly as deep mcp sends them, and an error is
 * never paged, so a spare would only cut a refusal every client keeps whole (#806's replay of #393 AC9: 8,471 bytes under
 * Codex 0.144.0's 10,000).
 */
const errorCapOf = (f: Figures): Figures => ({ ...fifthUnder(f), ...(f.bytes === undefined ? {} : { bytes: f.bytes }) });

/** Every toolResult entry of every shipped facts file. */
const allEntries = (): Entry[] => factsFiles().flatMap(entriesOf);

/** Where an unknown client's limit comes from. */
export const UNKNOWN = 'the smallest figure in each unit any facts file holds, since the facts know no such client';

/** The limit a client is held to, by the name and version its initialize gives. */
export function limitOf(client: unknown): Limit {
  const info = (typeof client === 'object' && client !== null ? client : {}) as Obj;
  const name = typeof info.name === 'string' ? info.name : null;
  const version = typeof info.version === 'string' ? info.version : null;
  const agent = name === null ? undefined : AGENTS.find(([n]) => n === name);
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
      // An agent whose facts give an error no character figure is held to the smallest any facts file holds, and says whose.
      const own = smallest(chosen.map((e) => e.error));
      if (own.chars === undefined && error.chars !== undefined) {
        const file = factsFiles().find((f) => entriesOf(f).some((e) => e.error.chars === error.chars));
        from += `; its error's chars, which ${agent[2]} doesn't give, the smallest any facts file holds (adapters/${file} toolResult)`;
        error = { ...own, chars: error.chars };
      } else error = own;
    }
  }
  // With no figure at all a reply would go uncapped: refused, never sent as if every client kept everything.
  if (!UNITS.some((u) => result[u] !== undefined) || !UNITS.some((u) => error[u] !== undefined)) throw Error('no facts file holds a toolResult limit');
  return { client: name, client_version: version, from, result, error, cap: fifthUnder(result), error_cap: errorCapOf(error) };
}

let counter: ((text: string) => number) | undefined;
/**
 * Tokens of `text` in the tokenizer both facts files pin (o200k_base, gpt-tokenizer 4.0.0), counted in pieces of 2,048
 * characters: a long run of letters costs the counter time in the square of its length (17 s at 100,000). A cut can
 * count a token or two fewer than the whole text does (two is the most random searches found, not a bound the
 * tokenizer gives), so each cut adds two; the fifth spare under each figure holds anything past that.
 */
async function tokensOf(text: string): Promise<number> {
  counter ??= (await import('gpt-tokenizer/encoding/o200k_base')).countTokens;
  let n = 0;
  for (let at = 0; at < text.length; at += 2_048) n += counter(text.slice(at, at + 2_048)) + (at > 0 ? 2 : 0);
  return n;
}
/** How far `text` passes each figure of `cap`: the largest ratio of size to figure, at most 1 when it fits. */
async function over(text: string, cap: Figures): Promise<number> {
  let worst = 0;
  if (cap.chars) worst = Math.max(worst, text.length / cap.chars);
  if (cap.bytes) worst = Math.max(worst, Buffer.byteLength(text) / cap.bytes);
  // A token holds at least one byte, so text of no more bytes than the token figure is under it uncounted.
  if (cap.tokens && Buffer.byteLength(text) > cap.tokens) worst = Math.max(worst, (await tokensOf(text)) / cap.tokens);
  return worst;
}

/**
 * The bytes the canvas core is given for a reply first: JSON rows run about two characters a token, rarely fewer, so a
 * read, which can be asked again, starts there; a call asked once starts at one and a half, where dense numeric rows
 * still fit.
 */
const roomOf = (cap: Figures, retry: boolean): number => Math.min(cap.chars ?? Infinity, cap.bytes ?? Infinity, (cap.tokens ?? Infinity) * (retry ? 2 : 1.5));

/**
 * A reply that fits its cap as its client receives it (the value's JSON, the text deep mcp sends): `capOf` names the cap
 * the reply is held to (a reply sent as a refusal is held to the error cap). Asked with the room `roomOf` gives the
 * result cap, then, while it is over, again with less in proportion to how far it passed. A call that isn't a pure read
 * (`retry` false) is asked once, and the asking stops once a reply stops getting shorter: it doesn't page.
 */
export async function fitted(cap: Figures, capOf: (reply: Obj) => Figures, retry: boolean, ask: (room: number) => Promise<Obj>): Promise<Obj> {
  let room = Math.floor(roomOf(cap, retry));
  let last = Infinity;
  for (let tries = 0; ; tries++) {
    const reply = await ask(room);
    const text = JSON.stringify(reply);
    const by = await over(text, capOf(reply));
    if (by <= 1 || !retry || tries >= 6 || room <= 1024 || text.length >= last) return reply;
    last = text.length;
    room = Math.max(1024, Math.floor((Math.min(room, Buffer.byteLength(text)) / by) * 0.95));
  }
}

/** The sentence a missing_field remediation ends with when its schema is the tool's whole input schema (tools.ts). */
const WHOLE = " schema is the tool's input schema.";
/**
 * A refusal under its client's error cap: one that would pass it keeps the schema of the top-level argument its path
 * fails under and says the rest reads in tools/list; a canvas refusal's issues are cut from the end, its `truncated`
 * saying how many it shows; then its value at the path is cut to what fits.
 */
export async function refusalFits(refusal: Partial<Refusal> & Obj, cap: Figures): Promise<Partial<Refusal> & Obj> {
  if ((await over(JSON.stringify(refusal), cap)) <= 1) return refusal;
  const out: Obj = { ...refusal };
  const schema = out.schema as { properties?: Obj } | undefined;
  if (schema && typeof schema === 'object') {
    const field = String(out.path ?? '').replace(/^\/params\/arguments/, '').split('/').filter(Boolean)[0] ?? '';
    const first = schema.properties?.[field];
    out.schema = first === undefined ? { type: 'object' } : { type: 'object', properties: { [field]: first }, required: [field] };
    const held = first === undefined ? 'schema holds none of the input schema' : `schema holds only ${field}'s part of the input schema`;
    out.remediation = `${String(out.remediation ?? '').replace(WHOLE, '')} ${held}: the tool's whole input schema is its inputSchema in tools/list.`;
  }
  if (Array.isArray(out.issues)) {
    const all = out.issues as unknown[];
    const was = (typeof out.truncated === 'object' && out.truncated !== null ? out.truncated : {}) as Obj;
    const total = typeof was.total === 'number' ? was.total : all.length;
    // A list the canvas core cut none of has no `truncated`: its codes are counted here as the core counts them (show.rs).
    const byCode = was.by_code ?? all.reduce<Record<string, number>>((n, i) => {
      const code = typeof (i as Obj)?.code === 'string' ? ((i as Obj).code as string) : '';
      n[code] = (n[code] ?? 0) + 1;
      return n;
    }, {});
    let shown = all.length;
    for (let by = await over(JSON.stringify(out), cap); by > 1 && shown > 0; by = await over(JSON.stringify(out), cap)) {
      shown = Math.min(shown - 1, Math.floor((shown / by) * 0.95));
      out.issues = all.slice(0, shown);
      out.truncated = { ...was, shown, total, by_code: byCode };
    }
  }
  for (let by = await over(JSON.stringify(out), cap); by > 1 && typeof out.actual === 'string' && out.actual.length; by = await over(JSON.stringify(out), cap)) {
    out.actual = out.actual.slice(0, Math.floor((out.actual.length / by) * 0.9));
  }
  return out as Partial<Refusal> & Obj;
}
