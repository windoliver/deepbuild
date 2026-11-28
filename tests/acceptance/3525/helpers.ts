// Test-side tools for #3525's acceptance tests (README): `deep mcp` spoken to over its stdio by raw JSON-RPC lines
// (#2898's `Raw`), a real hub in a temp home, #1731's fixture library (over HTTPS on 127.0.0.1, its test fill installed
// and turned on), the record read through `events.read`, the evidence store read from the hub's folder, the planted
// servers (fixtures/plant.mjs, loaded into a real `deep mcp` with `node --import`), and the merge base's bytes
// (fixtures/base.json, written by capture.test.ts on the base). Nothing here stands in for a server or the hub.
//
// Imported read-only, not copied: #26's hub helpers, #806's hub, home and agent stand-ins, #1731's library world and
// its helpers, #2898's `Raw`, `Bound`, record kinds and generated-table check. Processes are stopped by PID only (their
// cleanups), never by name or port.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { LIB, events as libraryEvents, must, type World as LibraryWorld } from '../1731/helpers.ts';
import { Stand, makeHome, startHub, uuidOf } from '../806/helpers.ts';
import { Bound, CLI, NAMED, NODE, Raw, brief, t26, type Line } from '../2898/helpers.ts';

export { Bound, CLI, NODE, Raw, brief, t26, type Line };

// ---- The criteria: `#3525.` and the first 8 hex digits of SHA-256 of each checkbox's text (scripts/proof-change.mjs).
export const AC = {
  listed: '#3525.2c40eb3b',
  lookups: '#3525.aacef461',
  fetch: '#3525.743a5489',
  refused: '#3525.f70e088e',
  plan: '#3525.db140e2e',
  together: '#3525.92738dfb',
  tokens: '#3525.c47e9430',
  budgets: '#3525.cc2bc99a',
} as const;

export const TEST_MS = 900_000;
export const PLANT = fileURLToPath(new URL('./fixtures/plant.mjs', import.meta.url));
export { LIB };

/** The one model the tests fetch: #1731's CC-BY oak chair. */
export const MODEL = 'oak-chair';
/** The fetch, in the fields the base's deep_kinds fetch takes: a library and a row's id. */
export const FETCH_FIELDS = { library: LIB, id: MODEL } as const;
/** The fetch's new form (README: The new form): deep_job with op fetch, the same fields as the base's deep_kinds fetch. */
export const NEW_FETCH = { tool: 'deep_job', args: { op: 'fetch', ...FETCH_FIELDS } } as const;

// ---- The merge base's bytes (fixtures/base.json): deep mcp's tools/list and the hash the base's fetch gave the model.
export const BASE_FILE = fileURLToPath(new URL('./fixtures/base.json', import.meta.url));
export interface Base { commit: string; tools: Line[]; fetched: Record<string, string> }
export const base = (): Base => JSON.parse(readFileSync(BASE_FILE, 'utf8')) as Base;
/** The fields only the base's fetch takes, as its deep_kinds schema lists them. */
export const FETCH_ONLY = ['library', 'id', 'pack', 'asset'] as const;
export function baseFetchFields(): Line {
  const props = (base().tools.find((t) => t.name === 'deep_kinds')!.inputSchema as Line).properties as Line;
  return Object.fromEntries(FETCH_ONLY.map((k) => [k, props[k]]));
}

// ---- Tokens: the pinned tokenizer (gpt-tokenizer 4.0.0's o200k_base), a value counted as its JSON, as #2688 counts
// a tool list: each listed tool whole, summed.
export const tokens = (value: unknown): number => countTokens(typeof value === 'string' ? value : JSON.stringify(value));
export const wholeList = (tools: readonly Line[]): number => tools.reduce((n, t) => n + tokens(t), 0);

// ---- Listings.
export const listed = (tools: readonly Line[], name: string): Line | undefined => tools.find((t) => t.name === name);
export const hint = (tool: Line | undefined, h: string): unknown => (tool?.annotations as Line | undefined)?.[h];
/** The op values a tool's listed schema takes. */
export const ops = (tool: Line | undefined): string[] => (((tool?.inputSchema as Line | undefined)?.properties as Line | undefined)?.op?.enum ?? []).filter((v: unknown) => typeof v === 'string');

/** A deep mcp started by hand in a home, initialized, with a plant when given. */
export async function deepMcp(name: string, home: string, cwd: string, plant?: Line): Promise<Raw> {
  const argv = plant ? [NODE, '--import', PLANT, CLI, 'mcp'] : [NODE, CLI, 'mcp'];
  const server = Raw.start(name, argv, home, cwd, plant ? { PLANT_3525: JSON.stringify(plant) } : {});
  await server.initialize();
  return server;
}

/** A plain hub world for listings and lookups: a temp home, a worktree and a real hub. */
export async function plainHub(): Promise<{ home: string; cwd: string; hub: t26.Hub }> {
  const { tmp, home } = makeHome();
  const work = t26.makeWorktree(join(tmp, 'work'));
  const hub = await startHub(home);
  return { home, cwd: work.path, hub };
}

// ---- The forms of deep_kinds (README: Forms): one call per value its listed op takes, each with only the fields its
// listed schema holds. A value this table doesn't know is a failure, named.
export const DOC = '01JB1731D00000000000000001';
const FORMS: Readonly<Record<string, Line>> = {
  list: {},
  word: { word: 'box' },
  search: { query: 'box' },
  read: { guide: 'start' },
  gallery: {},
  sheet: {},
  step_ceilings: {},
  field: { path: 'mark.box@1' },
  closure: { list: 'camera@1.projection' },
  bindings: { doc: DOC, item: 'red-box', language: 'rust' },
  assets: { query: 'chair' },
  fetch: { ...FETCH_FIELDS },
};
export function formArgs(tool: Line | undefined, op: string): Line | undefined {
  const known = FORMS[op];
  if (!known) return undefined;
  const props = Object.keys(((tool?.inputSchema as Line | undefined)?.properties as Line | undefined) ?? {});
  return { op, ...Object.fromEntries(Object.entries(known).filter(([k]) => props.includes(k))) };
}

// ---- The record, the store and the hub's own asset list, before and after (README: The record and the store).
/** The kinds the criteria name, by the word they use: #2898's kinds, and any event of an asset or a library fetch. */
export const named = (kind: string): string | undefined => NAMED[kind] ?? (/^(asset|library)\./.test(kind) ? 'asset' : undefined);
export interface Snapshot { pos: number; files: Set<string>; assets: Set<string> }
function filesUnder(dir: string, at = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => statSync(join(dir, e)).isDirectory() ? filesUnder(join(dir, e), `${at}${e}/`) : [`${at}${e}`]);
}
const evidenceDir = (w: LibraryWorld): string => join(w.hub.root, 'evidence');
function hubAssets(w: LibraryWorld): Set<string> {
  const file = join(w.hub.root, 'libraries.json');
  if (!existsSync(file)) return new Set();
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Line;
  return new Set(Object.keys((saved.assets ?? {}) as Line));
}
export async function snapshot(w: LibraryWorld): Promise<Snapshot> {
  const all = await libraryEvents(w);
  return { pos: all.reduce((m, e) => Math.max(m, Number(e.log_pos)), 0), files: new Set(filesUnder(evidenceDir(w))), assets: hubAssets(w) };
}
/** What changed since a snapshot, one line each: a named event, a new file in the store, a new asset the hub keeps. */
export async function changes(w: LibraryWorld, since: Snapshot): Promise<string[]> {
  const out: string[] = [];
  for (const e of await libraryEvents(w)) {
    if (Number(e.log_pos) <= since.pos) continue;
    const word = named(String(e.kind));
    if (word) out.push(`the record gained ${String(e.kind)} (${word}) ${String(e.id)}: ${brief(e.data, 240)}`);
  }
  for (const f of filesUnder(evidenceDir(w))) if (!since.files.has(f)) out.push(`the store gained the file ${f.replace(/\//g, '')}`);
  for (const a of hubAssets(w)) if (!since.assets.has(a)) out.push(`the hub keeps a new asset ${a}`);
  return out;
}

/** A world of #1731's library under your standing rule for its CC0 and CC-BY rows: a fetch there brings a model in. */
export async function ruled(w: LibraryWorld): Promise<void> {
  await must(w, 'library.rule', { library: LIB, licenses: ['CC0-1.0', 'CC-BY-4.0'] });
}

// ---- A session with an open ask, bound to a real hub by its hooks (#806's stand-in, whose deep mcp is its child),
// for a deep_wait that is held: #2898's world without its document, claim or reading socket.
export interface Waiting { hub: t26.Hub; sessions: Map<string, { ask: string; server: Bound }> }
export async function waitWorld(planned: { label: string; plant?: Line }[]): Promise<Waiting> {
  const { tmp, home } = makeHome();
  const ids = planned.map((p) => uuidOf(`3525:${p.label}`));
  const work = t26.makeWorktree(join(tmp, 'work'));
  const asks: string[] = [];
  await t26.seed(home, async (s) => {
    for (const id of ids) {
      await s.start(id, work.path);
      asks.push(await s.raise(id, 'taste', 'Which border for the gate?'));
    }
  });
  const hub = await startHub(home);
  const sessions = new Map<string, { ask: string; server: Bound }>();
  for (const [i, p] of planned.entries()) {
    const stand = Stand.start(home, work.path, 'claude-code', ids[i]!, p.plant ? { PLANT_3525: JSON.stringify(p.plant) } : {});
    await stand.establish(hub);
    const server = new Bound(stand, p.plant ? [NODE, '--import', PLANT, CLI, 'mcp'] : [NODE, CLI, 'mcp']);
    await t26.initialize(server);
    sessions.set(p.label, { ask: asks[i]!, server });
  }
  return { hub, sessions };
}
