// Test-side tools for the #2896 acceptance tests (README): a real hub (`deep hub run`) in a temporary home with #806's world file,
// agent stand-ins whose own `deep mcp` names its client in `initialize` as Claude Code, as Codex or as neither, and two stand-in
// clients that keep and cut one tool result as the issue says each agent does. Nothing here stands in for the hub, `deep mcp` or
// the canvas core. Tokens are counted with gpt-tokenizer 4.0.0's o200k_base, the counter the issue's audit used and the one
// adapters/codex.facts.json names at the base. Processes are stopped by PID (#806's cleanup).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countTokens, decode, encode } from 'gpt-tokenizer/encoding/o200k_base';
import { REPO, Stand, World, cleanup, makeHome, startHub, t26, t393, type AgentKind, type Line } from '../806/helpers.ts';
import { uuidOf } from '../806/helpers.ts';

export { cleanup, REPO, t26 };
export type { Line };

// ---------------------------------------------------------------------------------------------------
// The figures the issue states (README: Figures)

/** Claude Code files a text result longer than this many characters, or over CLAUDE_FILE_TOKENS tokens (its MCP page). */
export const CLAUDE_FILE_CHARS = 50_000;
export const CLAUDE_FILE_TOKENS = 25_000;
/** Claude Code cuts an error result longer than about this many characters, keeping its first and last CLAUDE_ERROR_KEEP. */
export const CLAUDE_ERROR_CHARS = 11_000;
export const CLAUDE_ERROR_KEEP = 5_000;
/** Codex cuts a tool's output past this many tokens in the middle, keeping both ends (`truncation_policy {mode: tokens, limit: 10000}`). */
export const CODEX_TOKENS = 10_000;

/** AC2's drafted page caps: Codex a fifth under 10,000 tokens; Claude Code 40,000 characters and 20,000 tokens. */
export const CODEX_PAGE_TOKENS = 8_000;
export const CLAUDE_PAGE_CHARS = 40_000;
export const CLAUDE_PAGE_TOKENS = 20_000;
/** AC5's drafted refusal cap, from the 11,000 characters an error keeps. */
export const REFUSAL_CHARS = 9_000;
/** The base's cap: no reply passes 64 KB without a cursor (#412, #2688). */
export const BASE_CAP_BYTES = 65_536;

/** The planted wrong programs this suite selects by DEEP_HUB_PLANT (README: Planted programs). */
export const PLANT = {
  /** AC3: every client's reply cap stays 64 KB. */
  cap64: 'reply-cap-64kb',
  /** AC4: a pager that drops the row at a page's edge. */
  dropsEdgeRow: 'pager-drops-edge-row',
  /** AC5: a refusal that carries a 12,000-character schema. */
  schema12k: 'refusal-schema-12000',
  /** AC6: a `deep mcp` that gives an unknown client 64 KB. */
  unknown64: 'unknown-client-64kb',
} as const;

// ---------------------------------------------------------------------------------------------------
// Counting

export const tokens = (text: string): number => countTokens(text);
export const chars = (text: string): number => text.length;
export interface Size { chars: number; tokens: number }
export const sizeOf = (text: string): Size => ({ chars: chars(text), tokens: tokens(text) });
export const fmt = (n: number): string => n.toLocaleString('en-US');

// ---------------------------------------------------------------------------------------------------
// What a client receives, and what each stand-in keeps of it

/** One tool result as `deep mcp` sends it over stdio. */
export interface Received {
  tool: string;
  isError: boolean;
  /** The result's text blocks, joined: the text the client receives. */
  text: string;
  /** structuredContent, serialized, when the result carries it (a client may hand the agent that instead). */
  structured: string | null;
  /** The text block's JSON, parsed, or structuredContent. */
  value: any;
  reply: Line;
  protocolError: boolean;
}
export function received(tool: string, reply: Line): Received {
  if (reply.error) return { tool, isError: true, text: JSON.stringify(reply.error), structured: null, value: reply.error, reply, protocolError: true };
  const result = (reply.result ?? {}) as Line;
  const blocks = Array.isArray(result.content) ? (result.content as Line[]).filter((c) => c?.type === 'text').map((c) => String(c.text)) : [];
  const text = blocks.join('\n');
  let value: any = result.structuredContent;
  if (value === undefined) try { value = JSON.parse(text); } catch { value = text; }
  return { tool, isError: result.isError === true, text, structured: result.structuredContent === undefined ? null : JSON.stringify(result.structuredContent), value, reply, protocolError: false };
}
/** The larger of the text and the structured content: what the stand-ins count, whichever of the two a client hands its agent. */
export function sizeReceived(r: Received): Size {
  const a = sizeOf(r.text);
  if (r.structured === null) return a;
  const b = sizeOf(r.structured);
  return { chars: Math.max(a.chars, b.chars), tokens: Math.max(a.tokens, b.tokens) };
}

/** What an agent holds of one tool result: the result whole, a path line in its place, or the result cut with a marker. */
export interface Kept { how: 'whole' | 'file' | 'cut'; text: string }
export const FILE_LINE = (path: string, n: number): string => `Output too large (${fmt(n)} characters). Full output saved to: ${path}`;
export const CUT_MARKER = /…\d+ (tokens|characters) truncated…/;

/** The Claude Code stand-in: a text result over 50,000 characters or 25,000 tokens is filed and a path line takes its place; an error over 11,000 characters keeps its first and last 5,000. */
export function claudeKeeps(r: Received): Kept {
  const s = sizeOf(r.text);
  if (!r.isError) {
    if (s.chars > CLAUDE_FILE_CHARS || s.tokens > CLAUDE_FILE_TOKENS) return { how: 'file', text: FILE_LINE(`/tmp/claude/tool-results/${r.tool}-${s.chars}.txt`, s.chars) };
    return { how: 'whole', text: r.text };
  }
  if (s.chars > CLAUDE_ERROR_CHARS) {
    const cut = s.chars - 2 * CLAUDE_ERROR_KEEP;
    return { how: 'cut', text: `${r.text.slice(0, CLAUDE_ERROR_KEEP)}\n…${cut} characters truncated…\n${r.text.slice(-CLAUDE_ERROR_KEEP)}` };
  }
  return { how: 'whole', text: r.text };
}
/** The Codex stand-in: output past 10,000 tokens is cut in the middle, its two ends kept, with a marker where the cut is. */
export function codexKeeps(r: Received): Kept {
  const text = r.structured ?? r.text;
  const ids = encode(text);
  if (ids.length <= CODEX_TOKENS) return { how: 'whole', text };
  const half = CODEX_TOKENS / 2;
  return { how: 'cut', text: `${decode(ids.slice(0, half))}…${ids.length - CODEX_TOKENS} tokens truncated…${decode(ids.slice(-half))}` };
}

// ---------------------------------------------------------------------------------------------------
// The facts files

export type Agent = 'claude-code' | 'codex';
export const FACTS: Record<Agent, string> = { 'claude-code': 'adapters/claude-code.facts.json', codex: 'adapters/codex.facts.json' };
export const readFacts = (agent: Agent, root = REPO): Line => JSON.parse(readFileSync(join(root, FACTS[agent]), 'utf8')) as Line;

// ---------------------------------------------------------------------------------------------------
// The hub world: three sessions, each with its own deep mcp naming its client

export interface ClientSpec { label: string; kind: AgentKind; name: string; version: string }
/** Claude Code names itself `claude-code` in initialize; Codex `codex-mcp-client`; the third names neither agent. */
export const CLAUDE: ClientSpec = { label: 'claude', kind: 'claude-code', name: 'claude-code', version: '2.1.308' };
export const CODEX: ClientSpec = { label: 'codex', kind: 'codex', name: 'codex-mcp-client', version: '0.166.0-alpha.5.1' };
export const OTHER: ClientSpec = { label: 'other', kind: 'claude-code', name: 'acceptance-2896-client', version: '1.0.0' };

export interface Client { spec: ClientSpec; stand: Stand; session: string }
export interface HubWorld { tmp: string; home: string; hub: t26.Hub; world: World; clients: Map<string, Client>; plant: string | undefined }

const ulid = (n: number): string => `01JB2896D${String(n).padStart(17, '0')}`;
/** The documents the hub minted on the main panel: the walk's (10,000 rows), and the page fixtures'. */
export const DOC = { walk: ulid(1), page: ulid(2), bounds: ulid(3) } as const;

/** One session's `deep mcp`: initialize with the client's own name, then initialized. */
async function initializeAs(stand: Stand, spec: ClientSpec): Promise<void> {
  const { reply } = await stand.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: spec.name, version: spec.version } });
  if (!reply.result) throw Error(`BLOCKED: deep mcp refused ${spec.name}'s initialize: ${JSON.stringify(reply)}`);
  await stand.notify('notifications/initialized');
}

/** A hub with the world file, and one established session per client spec, each with its own deep mcp. */
export async function openWorld(specs: readonly ClientSpec[], plant?: string): Promise<HubWorld> {
  const { tmp, home } = makeHome();
  const names: Record<string, string> = {};
  for (const s of specs) names[uuidOf(`2896-${s.label}`)] = `${s.kind === 'codex' ? 'Codex' : 'Claude Code'}: ${s.label}`;
  const world = new World(join(tmp, 'world.json'), { names, panels: t393.PANELS, docs: { [DOC.walk]: { panel: 'main' }, [DOC.page]: { panel: 'main' }, [DOC.bounds]: { panel: 'main' } } });
  const work = t26.makeWorktree(join(tmp, 'work'));
  const hub = await startHub(home, { world: world.path, plant });
  const clients = new Map<string, Client>();
  for (const spec of specs) {
    const session = uuidOf(`2896-${spec.label}`);
    const stand = Stand.start(home, work.path, spec.kind, session, plant ? { DEEP_HUB_PLANT: plant } : {});
    await stand.establish(hub);
    await initializeAs(stand, spec);
    clients.set(spec.label, { spec, stand, session });
  }
  return { tmp, home, hub, world, clients, plant };
}
export const client = (w: HubWorld, spec: ClientSpec): Client => {
  const c = w.clients.get(spec.label);
  if (!c) throw Error(`the world has no ${spec.label} client`);
  return c;
};

/** One deep_* call from a client's session, stamped as its agent stamps it (Codex binds a call by its PreToolUse, #39). */
export async function call(w: HubWorld, c: Client, tool: string, args: Line, timeoutMs = 300_000): Promise<Received> {
  await c.stand.stamp(w.hub, tool, args);
  const { reply } = await c.stand.request('tools/call', { name: tool, arguments: args }, timeoutMs);
  return received(tool, reply);
}
export async function listTools(c: Client): Promise<t26.Tool[]> { return t26.listTools(c.stand); }

// ---------------------------------------------------------------------------------------------------
// The fixtures

/** A plain rect, as #393's helpers write one, with a parent when it has one. */
const rect = (id: string, order: string, box: number[], parent?: string): Line => ({ ...t393.rect(id, id, box, order), ...(parent ? { parent } : {}) });
const pad = (n: number, w: number): string => String(n).padStart(w, '0');

/** A document of rows: `groups` groups, each with `children` children under it, every ID a sortable name. */
export function rowsDocument(title: string, groups: number, children: number): Line {
  const items: Line[] = [];
  for (let g = 0; g < groups; g++) {
    const gid = `g${pad(g, 3)}`;
    items.push(rect(gid, `a${pad(g, 3)}`, [g % 10 * 70, Math.floor(g / 10) * 50, 60, 40]));
    for (let c = 0; c < children; c++) items.push(rect(`${gid}.c${pad(c, 3)}`, `b${pad(c, 3)}`, [g % 10 * 70 + (c % 20) * 3, Math.floor(g / 10) * 50 + Math.floor(c / 20) * 3, 2, 2], gid));
  }
  return t393.board(title, [800, 600], items);
}
/** The walk's document: 100 groups of 99 children, 10,000 rows. */
export const GROUPS = 100;
export const CHILDREN = 99;
export const WALK_ROWS = GROUPS * (CHILDREN + 1);
export const walkDocument = (): Line => rowsDocument('Release rows', GROUPS, CHILDREN);
/** The page fixtures' document: one group of 999 children, 1,000 rows, so rows and refs_to the group each fill a page. */
export const PAGE_ROWS = 1_000;
export const pageDocument = (): Line => rowsDocument('Release page', 1, PAGE_ROWS - 1);
/** The group refs_to reads: every other row of the page document names it as its parent. */
export const REFS_TARGET = 'g000';
/** The rows the walk's document gives, as the base's deep_query orders them (depth first, each after its parent, siblings by ID): the model AC4's base record was checked against (README: The walk's rows). */
export function walkModel(): string[] {
  const out: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    const gid = `g${pad(g, 3)}`;
    out.push(JSON.stringify([gid, null, 'rect@1', CHILDREN]));
    for (let c = 0; c < CHILDREN; c++) out.push(JSON.stringify([`${gid}.c${pad(c, 3)}`, gid, 'rect@1', 0]));
  }
  return out;
}

/** The bounds mode's document: enough plain rects that their readings fill a page. */
export const BOUNDS_ITEMS = 1_200;
export function boundsDocument(): Line {
  const items: Line[] = [];
  for (let i = 0; i < BOUNDS_ITEMS; i++) items.push(rect(`r${pad(i, 4)}`, `a${pad(i, 4)}`, [i % 40 * 20, Math.floor(i / 40) * 20, 16, 16]));
  return t393.board('Release bounds', [800, 600], items);
}

/** Draws a document on `doc` from a client's session as a whole revision; BLOCKED unless it is presented. */
export async function draw(w: HubWorld, c: Client, doc: string, document: Line): Promise<number> {
  const r = await call(w, c, 'deep_show', { doc, document: JSON.stringify(document), include: ['issues'] }, 600_000);
  const v = r.value as Line;
  if (r.isError || v?.outcome !== 'presented') throw Error(`BLOCKED: ${c.spec.label}'s deep_show of a ${Object.keys(document.items ?? {}).length}-item document on ${doc} wasn't presented: ${r.text.slice(0, 1500)}`);
  return Number(v.rev);
}

// ---------------------------------------------------------------------------------------------------
// The walk

export interface Page { n: number; r: Received; size: Size; rows: Line[]; next: string | null }
export interface Walk { pages: Page[]; rows: Line[]; problems: string[] }
/** deep_query's rows of `doc`, every row asked for, page by page by `next` until none. */
export async function walk(w: HubWorld, c: Client, doc: string, stop?: (p: Page, rows: Line[]) => boolean, maxPages = 2_000): Promise<Walk> {
  const pages: Page[] = [];
  const rows: Line[] = [];
  const problems: string[] = [];
  let cursor: string | null = null;
  for (let n = 1; n <= maxPages; n++) {
    const r = await call(w, c, 'deep_query', { doc, what: 'rows', cap: WALK_ROWS, cursor });
    const v = r.value as Line;
    if (r.isError || !Array.isArray(v?.rows)) { problems.push(`page ${n} of the walk was refused or gave no rows: ${r.text.slice(0, 800)}`); break; }
    const next = typeof v.next === 'string' ? v.next : v.next === undefined || v.next === null ? null : String(v.next);
    pages.push({ n, r, size: sizeReceived(r), rows: v.rows as Line[], next });
    rows.push(...(v.rows as Line[]));
    if (next === null || stop?.(pages.at(-1)!, rows)) return { pages, rows, problems };
    cursor = next;
  }
  if (!problems.length) problems.push(`the walk didn't end within ${maxPages} pages`);
  return { pages, rows, problems };
}

/** What AC4 compares of a row: the row as its ID, parent, kind and child count name it (README: The walk's rows). */
export const rowKey = (r: Line): string => JSON.stringify([r.id, r.parent ?? null, r.kind, r.children_total ?? null]);

// ---------------------------------------------------------------------------------------------------
// The judges

/** Why a page, as a client receives it, passes that client's drafted cap (AC2, AC6), or null. The third client is held to the smallest: Codex's tokens and Claude Code's characters. */
export function overCap(spec: ClientSpec, what: string, s: Size): string | null {
  const said = `${what}, as ${spec.name} receives it, is ${fmt(s.chars)} characters and ${fmt(s.tokens)} tokens`;
  if (spec === CODEX) return s.tokens > CODEX_PAGE_TOKENS ? `${said}: over ${fmt(CODEX_PAGE_TOKENS)} tokens` : null;
  if (spec === CLAUDE) return s.chars > CLAUDE_PAGE_CHARS || s.tokens > CLAUDE_PAGE_TOKENS ? `${said}: over ${fmt(CLAUDE_PAGE_CHARS)} characters or ${fmt(CLAUDE_PAGE_TOKENS)} tokens` : null;
  return s.tokens > CODEX_PAGE_TOKENS || s.chars > CLAUDE_PAGE_CHARS ? `${said}: over the smallest limit any facts file holds (${fmt(CODEX_PAGE_TOKENS)} tokens, ${fmt(CLAUDE_PAGE_CHARS)} characters)` : null;
}
/** What a client's stand-in keeps of a result. */
export const keeps = (spec: ClientSpec, r: Received): Kept => (spec === CODEX ? codexKeeps(r) : claudeKeeps(r));
/** Why a page didn't reach the stand-in whole (AC3), or null: it was cut, or a path took its place. */
export function notWhole(spec: ClientSpec, p: Page): string | null {
  const k = keeps(spec, p.r);
  if (k.how === 'whole' && !CUT_MARKER.test(k.text)) return null;
  return `page ${p.n} of the walk reached the ${spec.label === 'codex' ? 'Codex' : 'Claude Code'} stand-in ${k.how === 'file' ? 'as a path to a file' : 'cut, with a marker in its middle'} (${fmt(p.size.chars)} characters, ${fmt(p.size.tokens)} tokens): ${k.text.slice(0, 160)}`;
}

/** A world under a plant, or why it couldn't open (at the base the hub refuses a plant it doesn't know). */
export async function tryWorld(specs: readonly ClientSpec[], plant?: string): Promise<{ w: HubWorld | undefined; error: string }> {
  try {
    return { w: await openWorld(specs, plant), error: '' };
  } catch (e) {
    return { w: undefined, error: e instanceof Error ? e.message : String(e) };
  }
}
