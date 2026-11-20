// Test-side tools for #2898's acceptance tests (README): each of DeepBuild's MCP servers spoken to over its stdio by
// raw JSON-RPC lines against a real hub (`deep hub run`) in a temp home; agent stand-ins (#806's, whose MCP servers and
// hooks are their children, so a call binds to its session) for the calls a session makes; the record read through
// `events.read`; the planted servers (fixtures/plant.mjs, loaded into a real `deep mcp` with `node --import`); and the
// issue's drafted table, which the issue states is the final one. Nothing here stands in for a server or the hub.
//
// Imported, not copied: #26's hub socket, record reader and seed; #806's hub with its world file, its agent stand-ins
// and its cleanup; #393's documents; #1725's red box; #1922's job world; #1731's library world; #1879's hello plug-in.
// Processes are stopped by PID only (#806's and #26's cleanup), never by name or port.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { Stand, World, cleanup, makeHome, startHub, t26, t393, tempDir, uuidOf, type Line } from '../806/helpers.ts';
import { DOC, redBox } from '../1725/helpers.ts';

export { cleanup, t26, type Line };

// ---- The criteria: `#2898.` and the first 8 hex digits of SHA-256 of each checkbox's text (scripts/proof-change.mjs).
export const AC = {
  listed: '#2898.a28b2035',
  table: '#2898.195c199f',
  reads: '#2898.dee08b24',
  repeats: '#2898.4e085daf',
  together: '#2898.f7f325a2',
  ownKind: '#2898.927923eb',
  bytes: '#2898.c0392358',
  budgets: '#2898.cc2bc99a',
} as const;

export const TEST_MS = 900_000;
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const CLI = t26.CLI;
export const PLANT = fileURLToPath(new URL('./fixtures/plant.mjs', import.meta.url));
/** The reading tools as a reading job runs them: packages/reading/src/tools.mts built beside the package's entry. */
export const READING_TOOLS = join(REPO, 'packages/reading/dist/tools.mjs');
const parse = (text: string): Line | undefined => { try { return JSON.parse(text) as Line; } catch { return undefined; } };
export const brief = (v: unknown, n = 600): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

// ---- The issue's table ("Drafted, with T for true"), which the issue states is the final one: a blank is false.
export const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;
export type Hint = typeof HINTS[number];
export type Hints = Record<Hint, boolean>;
const row = (readOnlyHint: boolean, destructiveHint: boolean, idempotentHint: boolean, openWorldHint: boolean): Hints => ({ readOnlyHint, destructiveHint, idempotentHint, openWorldHint });
const T = true;
const F = false;
export const TABLE: Readonly<Record<string, Hints>> = {
  ...Object.fromEntries(['deep_status', 'deep_search', 'deep_query', 'deep_wait', 'find_actions', 'read', 'find'].map((t) => [t, row(T, F, T, F)])),
  ...Object.fromEntries(['deep_ask', 'deep_open_item', 'deep_claim', 'deep_evidence', 'deep_show', 'deep_drive', 'deep_env', 'deep_root_plan', 'deep_propose'].map((t) => [t, row(F, F, F, F)])),
  deep_run: row(F, F, F, T),
  deep_kinds: row(F, F, F, T),
  deep_job: row(F, F, T, T),
  call_action: row(F, T, T, T),
};
export const tableSays = (hint: Hint): string[] => Object.keys(TABLE).filter((t) => TABLE[t]![hint]).sort();

// ---- The four servers, each started by hand: newline-delimited JSON-RPC on its stdin and stdout.

/** deep-hook as built: the newer of target/release and target/debug's (cargo build -p deep-hook). */
export function deepHook(): string {
  const built = ['release', 'debug'].map((p) => join(REPO, 'target', p, 'deep-hook')).filter((p) => existsSync(p));
  expect(built.length, 'BLOCKED: deep-hook is built: cargo build -p deep-hook (deep mcp actions\' second form is `deep-hook mcp actions`)').toBeGreaterThan(0);
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}
export interface ServerSpec { name: string; argv(socket: string): string[] }
export const SERVERS: readonly ServerSpec[] = [
  { name: 'deep mcp', argv: () => [NODE, CLI, 'mcp'] },
  { name: 'deep mcp actions', argv: () => [NODE, CLI, 'mcp', 'actions'] },
  { name: 'deep-hook mcp actions', argv: () => [deepHook(), 'mcp', 'actions'] },
  { name: 'the reading tools', argv: (socket) => [NODE, READING_TOOLS, socket] },
];

/** One server started by hand from this test process, every line it writes kept as it wrote it. */
export class Raw {
  readonly lines: string[] = [];
  private readonly wakers = new Set<() => void>();
  private err = '';
  private constructor(readonly name: string, readonly child: ChildProcess) {
    createInterface({ input: child.stdout! }).on('line', (l) => { this.lines.push(l); for (const w of [...this.wakers]) w(); });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('close', () => { for (const w of [...this.wakers]) w(); });
    child.stdin!.on('error', () => undefined);
  }
  static start(name: string, argv: string[], home: string, cwd: string, env: Record<string, string> = {}): Raw {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: t26.childEnv(home, env), stdio: ['pipe', 'pipe', 'pipe'] });
    t26.own(child.pid);
    return new Raw(name, child);
  }
  /** Writes these requests in one write, and resolves with each one's reply line, raw and parsed, by id. */
  async send(requests: { id: string; method: string; params?: Line }[], timeoutMs = 120_000): Promise<{ id: string; raw: string; reply: Line }[]> {
    const from = this.lines.length;
    this.child.stdin!.write(requests.map((r) => `${JSON.stringify({ jsonrpc: '2.0', id: r.id, method: r.method, params: r.params ?? {} })}\n`).join(''));
    return Promise.all(requests.map((r) => new Promise<{ id: string; raw: string; reply: Line }>((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.wakers.delete(check); };
      const timer = setTimeout(() => { done(); reject(Error(`${this.name} gave no reply to ${r.method} (${r.id}) in ${timeoutMs} ms; stderr: ${this.err}`)); }, timeoutMs);
      const check = () => {
        for (const raw of this.lines.slice(from)) {
          const reply = parse(raw);
          if (reply && reply.id === r.id && ('result' in reply || 'error' in reply)) { done(); resolve({ id: r.id, raw, reply }); return; }
        }
        if (this.child.exitCode !== null) { done(); reject(Error(`${this.name} exited ${this.child.exitCode}: ${this.err}`)); }
      };
      this.wakers.add(check);
      check();
    })));
  }
  async request(method: string, params: Line = {}, timeoutMs?: number): Promise<{ id: string; raw: string; reply: Line }> {
    return (await this.send([{ id: t26.nextId(method), method, params }], timeoutMs))[0]!;
  }
  async initialize(): Promise<void> {
    const { reply } = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-2898', version: '0' } });
    expect(reply.result, `BLOCKED: ${this.name} answers initialize: ${brief(reply)}`).toBeDefined();
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  }
  async tools(): Promise<Line[]> {
    const { reply } = await this.request('tools/list', {});
    expect(Array.isArray(reply.result?.tools), `BLOCKED: ${this.name} answers tools/list with a tools list: ${brief(reply)}`).toBe(true);
    return reply.result.tools as Line[];
  }
  async call(tool: string, args: Line): Promise<t26.Outcome> {
    const t0 = performance.now();
    const { reply } = await this.request('tools/call', { name: tool, arguments: args });
    return t26.outcomeOf(reply, performance.now() - t0);
  }
}

// ---- The reading job's socket: the reading tools reach it with POST /call {name, arguments}. A reading job serves it
// from packages/reading (its `serve`, not exported); here it is served the same way from the package's public entry,
// `openSlicer` on the hub's root, read only, with every handle delivered.
export async function readingSocket(home: string): Promise<{ socket: string; close(): Promise<void> }> {
  const { openSlicer, NotFound } = await import('../../../packages/reading/src/index.ts');
  const slicer = await openSlicer(t26.rootOf(home));
  const dir = tempDir();
  const socket = join(dir, 'r');
  const server: Server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8').on('data', (c: string) => { body += c; });
    req.on('end', () => {
      const reply = (status: number, text: string) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(text); };
      void (async () => {
        const call = parse(body);
        const args = (call?.arguments ?? {}) as Line;
        const slice = typeof args.slice === 'string' ? args.slice : undefined;
        try {
          if (call?.name === 'read' && typeof args.handle === 'string') return reply(200, JSON.stringify(await slicer.read(args.handle, slice)));
          if (call?.name === 'find' && typeof args.query === 'string') return reply(200, JSON.stringify(await slicer.find(args.query, slice)));
          return reply(400, 'the reading tools are read {handle, slice?} and find {query, slice?}');
        } catch (error) {
          return reply(error instanceof NotFound ? 404 : 500, error instanceof Error ? error.message : String(error));
        }
      })();
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
  return { socket, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); slicer.close(); }) };
}

// ---- A plain hub world for the listings: a home, a worktree, the hub, each server started by hand.
export interface Listing { server: string; tools: Line[]; raw: string }
export interface Plain { tmp: string; home: string; cwd: string; hub: t26.Hub; socket: string; close(): Promise<void> }
export async function plainHub(): Promise<Plain> {
  const { tmp, home } = makeHome();
  const work = t26.makeWorktree(join(tmp, 'work'));
  const hub = await startHub(home);
  const reading = await readingSocket(home);
  return { tmp, home, cwd: work.path, hub, socket: reading.socket, close: reading.close };
}
/** Each server's tools/list, by hand, with the request line the same for every server. */
export async function listings(p: Plain, env: Record<string, string> = {}): Promise<Listing[]> {
  const out: Listing[] = [];
  for (const spec of SERVERS) {
    const server = Raw.start(spec.name, spec.argv(p.socket), p.home, p.cwd, env);
    await server.initialize();
    const { raw, reply } = (await server.send([{ id: 'tools-list-2898', method: 'tools/list' }]))[0]!;
    expect(Array.isArray(reply.result?.tools), `BLOCKED: ${spec.name} answers tools/list with a tools list: ${brief(reply)}`).toBe(true);
    out.push({ server: spec.name, tools: reply.result.tools as Line[], raw });
    server.child.kill('SIGTERM');
  }
  return out;
}

/** What a listing's annotations miss: the issue's shape (a title of at most 40 characters, the four hints as booleans). */
export function annotationProblems(tool: Line): string[] {
  const a = tool.annotations as Line | undefined;
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return ['no annotations'];
  const problems: string[] = [];
  if (typeof a.title !== 'string' || a.title.trim() === '') problems.push(`no title (${brief(a.title, 80)})`);
  else if ([...a.title].length > 40) problems.push(`a title of ${[...a.title].length} characters, over 40 (${a.title})`);
  for (const hint of HINTS) if (typeof a[hint] !== 'boolean') problems.push(`${hint} ${a[hint] === undefined ? 'left to its default' : `not a boolean (${brief(a[hint], 40)})`}`);
  return problems;
}
/** Where listed hints differ from the table: one line per tool and hint, naming both. */
export function drift(server: string, tools: readonly Line[]): string[] {
  const out: string[] = [];
  for (const tool of tools) {
    const want = TABLE[String(tool.name)];
    if (!want) { out.push(`${server}: ${String(tool.name)} is in no row of the table`); continue; }
    for (const hint of HINTS) {
      const got = (tool.annotations as Line | undefined)?.[hint];
      if (got !== want[hint]) out.push(`${server}: ${String(tool.name)} ${hint} lists ${got === undefined ? 'nothing' : JSON.stringify(got)}, the table ${want[hint]}`);
    }
  }
  return out;
}
/** The tools a listing states a hint true for. */
export const listedAs = (tools: readonly Line[], hint: Hint): string[] => tools.filter((t) => (t.annotations as Line | undefined)?.[hint] === true).map((t) => String(t.name)).sort();

// ---- The world the calls are made in: #806's hub and world file (a document on the main panel), the sessions bound
// by their hooks (#806's stand-ins), each with an open ask seeded before the hub starts (#26's seed); the document
// drawn and a claim made before any call is judged; the reading socket on the hub's root.

/** A session's stand-in and the MCP server that is its child, started with `argv` on first use. */
export class Bound implements t26.Mcp {
  constructor(readonly stand: Stand, readonly argv: string[]) {}
  private send(command: Line, timeoutMs: number): Promise<Line> {
    return (this.stand as unknown as { send(c: Line, t: number): Promise<Line> }).send(command, timeoutMs);
  }
  async request(method: string, params: Line = {}, timeoutMs = 120_000, id = t26.nextId(method)): Promise<t26.Exchange> {
    const r = await this.send({ op: 'mcp', argv: this.argv, line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    t26.own(r.pid as number);
    return { reply: r.reply as Line, ms: r.ms as number, pid: r.pid as number };
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', argv: this.argv, line: { jsonrpc: '2.0', method, params } }, 120_000);
  }
  async tools(): Promise<Line[]> { return (await t26.listTools(this)) as unknown as Line[]; }
  async call(tool: string, args: Line, id?: string): Promise<t26.Outcome> {
    const { reply, ms } = await this.request('tools/call', { name: tool, arguments: args }, 120_000, id);
    return t26.outcomeOf(reply, ms);
  }
}

export interface Session { id: string; stand: Stand; ask: string; server: Bound }
export interface Calls {
  tmp: string; home: string; cwd: string; hub: t26.Hub;
  /** The fixture's document, drawn by the first session, and the hash of its revision's canonical document. */
  doc: string; revision: string;
  sessions: Map<string, Session>;
  reading: Raw; actions: Raw; actionsHook: Raw;
  close(): Promise<void>;
}
/** Each session this world can hold: its label, and the plant its `deep mcp` carries, if any. */
export interface Planned { label: string; plant?: Line; argv?: 'deep' | 'actions' | 'actions-hook' }
const argvOf = (p: Planned): string[] => p.argv === 'actions' ? [NODE, CLI, 'mcp', 'actions'] : p.argv === 'actions-hook' ? [deepHook(), 'mcp', 'actions'] : p.plant ? [NODE, '--import', PLANT, CLI, 'mcp'] : [NODE, CLI, 'mcp'];

export async function callsWorld(planned: Planned[] = [{ label: 'agent' }]): Promise<Calls> {
  const { tmp, home } = makeHome();
  const ids = planned.map((p) => uuidOf(`2898:${p.label}`));
  const world = new World(join(tmp, 'world.json'), { names: Object.fromEntries(planned.map((p, i) => [ids[i], `Claude Code: ${p.label}`])), panels: t393.PANELS, docs: { [DOC.a]: { panel: 'main' } } });
  const work = t26.makeWorktree(join(tmp, 'work'));
  const asks: string[] = [];
  await t26.seed(home, async (s) => {
    for (const id of ids) {
      await s.start(id, work.path);
      asks.push(await s.raise(id, 'taste', 'Which border for the gate?'));
    }
  });
  const hub = await startHub(home, { world: world.path });
  const sessions = new Map<string, Session>();
  for (const [i, p] of planned.entries()) {
    const stand = Stand.start(home, work.path, 'claude-code', ids[i]!, p.plant ? { PLANT_2898: JSON.stringify(p.plant) } : {});
    await stand.establish(hub);
    const server = new Bound(stand, argvOf(p));
    await t26.initialize(server);
    sessions.set(p.label, { id: ids[i]!, stand, ask: asks[i]!, server });
  }
  const first = sessions.get(planned[0]!.label)!;
  const drawn = await first.server.call('deep_show', { doc: DOC.a, document: JSON.stringify(redBox()), include: ['issues'] });
  expect(drawn.isError === false && drawn.value?.outcome === 'presented', `BLOCKED: the fixture's document is drawn (deep_show of ${DOC.a}): ${brief(drawn.reply, 1200)}`).toBe(true);
  const claimed = await first.server.call('deep_claim', t26.claimArgs());
  expect(claimed.isError, `BLOCKED: the fixture's claim is made (deep_claim): ${brief(claimed.reply, 1200)}`).toBe(false);
  const all = await t26.events(hub);
  const patched = all.filter((e) => e.kind === 'doc.patched').at(-1);
  expect(patched && all.some((e) => e.kind === 'claim.made') && all.some((e) => e.kind === 'ask.created'), `BLOCKED: the record holds a revision, a claim and an ask before the calls: ${all.map((e) => e.kind).join(', ')}`).toBeTruthy();
  const socket = await readingSocket(home);
  const reading = Raw.start('the reading tools', [NODE, READING_TOOLS, socket.socket], home, work.path);
  const actions = Raw.start('deep mcp actions', [NODE, CLI, 'mcp', 'actions'], home, work.path);
  const actionsHook = Raw.start('deep-hook mcp actions', [deepHook(), 'mcp', 'actions'], home, work.path);
  for (const r of [reading, actions, actionsHook]) await r.initialize();
  return { tmp, home, cwd: work.path, hub, doc: DOC.a, revision: String(patched!.data.hash), sessions, reading, actions, actionsHook, close: socket.close };
}

// ---- What the record gained: the events the criteria name, each by the word the criterion uses for it.
export const NAMED: Readonly<Record<string, string>> = {
  'ask.created': 'ask', 'claim.made': 'claim', 'open_item.opened': 'open item', 'doc.patched': 'revision',
  'job.recorded': 'job', 'job.ended': 'job', 'job.event': 'job', 'run.started': 'job',
  'evidence.stored': 'evidence', 'evidence.put': 'evidence',
  'learn.proposed': 'proposal', 'plan.proposed': 'proposal', 'suggestion.filed': 'proposal',
  'process.starting': 'process started', 'process.tracked': 'process started',
  'action.entered': 'action', 'action.reported': 'action',
};
export interface Ev { id: string; kind: string; data: Line; log_pos: number }
export type Reader = () => Promise<Ev[]>;
/** The events of the named kinds the record gained after `since` (a log position). */
export async function gained(read: Reader, since: number): Promise<Ev[]> {
  return (await read()).filter((e) => e.log_pos > since && NAMED[e.kind] !== undefined);
}
export const lastPos = async (read: Reader): Promise<number> => (await read()).reduce((m, e) => Math.max(m, e.log_pos), 0);
export const said = (events: readonly Ev[]): string => events.map((e) => `${e.kind} ${e.id} (${NAMED[e.kind]}): ${brief(e.data, 200)}`).join('; ');
/** Counts of the named kinds. */
export const counts = (events: readonly Ev[]): Record<string, number> => events.reduce<Record<string, number>>((m, e) => ({ ...m, [e.kind]: (m[e.kind] ?? 0) + 1 }), {});

// ---- Every form each read-only tool's schema takes (README: Forms): the field that picks a form, and one call per
// value it lists (null, where it means the default form, is its own call). A form its schema lists and this table
// doesn't is a failure, named.
export interface FormCtx { doc: string; ask: string; revision: string }
export const SELECTORS: Readonly<Record<string, string>> = { deep_query: 'what', deep_kinds: 'op' };
export function forms(tool: string, c: FormCtx, extra: Line = {}): { label: string; args: Line }[] {
  const nulls = (args: Line, keys: string[]): Line => ({ ...Object.fromEntries(keys.map((k) => [k, null])), ...args });
  const Q = ['rev', 'items', 'paths', 'at', 'cap', 'cursor', 'expect', 'path', 't', 'target', 'by'];
  const K = ['registry', 'cursor', 'word', 'query', 'kind', 'size_m', 'license', 'limit', 'library', 'id', 'pack', 'asset', 'example', 'guide', 'offset', 'path', 'list', 'doc', 'item', 'language'];
  switch (tool) {
    case 'deep_status': return [{ label: '{}', args: {} }];
    case 'deep_search': return [
      { label: 'by words', args: { query: 'border', file: null, cursor: null } },
      { label: 'by a file', args: { query: 'border', file: 'README.md', cursor: null } },
    ];
    case 'deep_wait': return [{ label: 'on the open ask', args: { ask: c.ask } }];
    case 'deep_query': return [
      { label: 'what: null', args: nulls({ doc: c.doc, what: null }, Q) },
      { label: 'what: rows', args: nulls({ doc: c.doc, what: 'rows', paths: ['items/red-box/at/pos'] }, Q) },
      { label: 'what: summary', args: nulls({ doc: c.doc, what: 'summary' }, Q) },
      { label: 'what: why', args: nulls({ doc: c.doc, what: 'why', path: 'items/red-box/at/pos' }, Q) },
      { label: 'what: refs_to', args: nulls({ doc: c.doc, what: 'refs_to', target: 'red' }, Q) },
      { label: 'what: cost', args: nulls({ doc: c.doc, what: 'cost', by: 'gpu_ms' }, Q) },
    ];
    case 'find_actions': return [
      { label: 'query: null', args: { query: null } },
      { label: 'by words', args: { query: 'hello' } },
    ];
    case 'read': return [
      { label: 'a handle', args: { handle: `ev:${c.revision}` } },
      { label: 'a handle and a slice', args: { handle: `ev:${c.revision}`, slice: '1' } },
    ];
    case 'find': return [
      { label: 'a query', args: { query: 'red' } },
      { label: 'a query and a slice', args: { query: 'red', slice: '1' } },
    ];
    case 'deep_kinds': {
      const op = (o: string, args: Line = {}) => ({ label: `op: ${o}`, args: nulls({ op: o, ...args }, K) });
      return [
        op('list'), op('word', { word: 'box' }), op('search', { query: 'box' }), op('read', { guide: 'start' }), op('gallery'), op('sheet'),
        op('step_ceilings'), op('field', { path: 'mark.box@1' }), op('closure', { list: 'camera@1.projection' }), op('bindings', { doc: c.doc, item: 'red-box', language: 'rust' }),
        op('assets', { query: 'chair' }), op('fetch', { library: extra.library ?? null, id: extra.id ?? null }),
      ];
    }
    default: return [];
  }
}
/** The values a tool's form selector lists that the forms table misses. */
export function formsMissed(tool: string, schema: Line | undefined, listed: readonly { args: Line }[]): string[] {
  const field = SELECTORS[tool];
  if (!field) return [];
  const values = ((schema?.properties as Line | undefined)?.[field]?.enum ?? []) as unknown[];
  return values.filter((v) => !listed.some((f) => f.args[field] === v)).map((v) => `${tool}'s ${field}: ${JSON.stringify(v)}`);
}

/** A tool's calls and the record they read: how a test reaches the tool, whichever server it is on. */
export interface Rig { call(tool: string, args: Line): Promise<t26.Outcome>; events: Reader; schema(tool: string): Line | undefined }
/**
 * Each tool of `tools` called in every form: the named events the record gained after each call (the calls are made
 * one at a time, so each event is the call's), one line per call that gained any, naming the tool, the form and each
 * event's kind; and one line per form the schema lists and the table misses.
 */
export async function readOnlyFailures(rig: Rig, tools: readonly string[], c: FormCtx, extra: Line = {}): Promise<{ failures: string[]; calls: string[] }> {
  const failures: string[] = [];
  const calls: string[] = [];
  for (const tool of tools) {
    const list = forms(tool, c, extra);
    if (!list.length) failures.push(`${tool} is listed read-only and this suite knows no form of it to call`);
    failures.push(...formsMissed(tool, rig.schema(tool), list).map((m) => `${m} is a form this suite doesn't call`));
    for (const form of list) {
      const since = await lastPos(rig.events);
      const o = await rig.call(tool, form.args);
      await t26.sleep(500);
      const got = await gained(rig.events, since);
      calls.push(`${tool} ${form.label}: ${o.isError ? 'refused' : 'answered'} ${brief(o.value, 160)}`);
      if (got.length) failures.push(`${tool} (${form.label}, ${brief(form.args, 240)}) changed the record: ${said(got)}`);
    }
  }
  return { failures, calls };
}

// ---- The hello plug-in (#1879's fixture, one read action ext.hello.greet), stamped with its digest and installed.
export async function installHello(home: string): Promise<void> {
  const dir = join(tempDir(), 'hello');
  cpSync(fileURLToPath(new URL('../1879-redraft-ac2/fixtures/hello', import.meta.url)), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  const { packageDigest } = await import('../../../packages/extension-host/src/index.ts');
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const ran = await t26.deep(home, ['install', dir]);
  expect(ran.code, `BLOCKED: deep install of the hello plug-in (test/hello, one read action) loads it: ${ran.stdout.slice(-800)} ${ran.stderr.slice(-800)}`).toBe(0);
}

// ---- A typed prompt (Claude Code's transcript entry for a prompt a person typed, then its UserPromptSubmit), one tool
// call of the session's deep mcp between its PreToolUse and PostToolUse, then Stop: the turn, and its agent.stop.
export async function turn(hub: t26.Hub, s: Session, text: string, tool: string, args: Line): Promise<{ call: string; outcome: t26.Outcome; stop: Ev | undefined }> {
  const transcript = join(s.stand.home, '.claude/projects', s.stand.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${s.id}.jsonl`);
  const prompt = randomUUID();
  appendFileSync(transcript, `${JSON.stringify({ promptId: prompt, type: 'user', sessionId: s.id, cwd: s.stand.cwd, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' })}\n`);
  const since = await lastPos(() => t26.events(hub));
  await s.stand.hook(hub, 'UserPromptSubmit', { prompt: text, prompt_id: prompt });
  const call = `toolu_${randomBytes(10).toString('hex')}`;
  const name = `mcp__deep__${tool}`;
  await s.stand.hook(hub, 'PreToolUse', { tool_name: name, tool_input: args, tool_use_id: call, prompt_id: prompt });
  const outcome = await s.server.call(tool, args);
  await s.stand.hook(hub, 'PostToolUse', { tool_name: name, tool_input: args, tool_use_id: call, tool_response: outcome.reply.result ?? outcome.reply.error, prompt_id: prompt });
  appendFileSync(transcript, `${JSON.stringify({ type: 'assistant', sessionId: s.id, message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn' } })}\n`);
  await s.stand.hook(hub, 'Stop', { stop_hook_active: false, last_assistant_message: 'Done.', prompt_id: prompt }).catch(() => undefined);
  let stop: Ev | undefined;
  for (const deadline = Date.now() + 20_000; !stop && Date.now() < deadline; await t26.sleep(200)) {
    stop = ((await t26.events(hub)) as unknown as (Ev & { session?: string })[]).find((e) => e.kind === 'agent.stop' && e.log_pos > since && e.session === s.id);
  }
  return { call, outcome, stop };
}

// ---- The merge base's bytes (fixtures/base.json, README: The merge base's bytes).
export const BASE_FILE = fileURLToPath(new URL('./fixtures/base.json', import.meta.url));
export interface Base { tools: Record<string, { name: string; description: string; inputSchema: Line }[]>; kinds: Record<string, string> }
export const base = (): Base => JSON.parse(readFileSync(BASE_FILE, 'utf8')) as Base;
/** The tool names the hub sees for its own tools, as Claude Code names a server's tools: mcp__<server>__<tool>. */
export const OWN_TOOLS = (b: Base): string[] => [
  ...b.tools['deep mcp']!.map((t) => `mcp__deep__${t.name}`),
  ...b.tools['deep mcp actions']!.map((t) => `mcp__deep-actions__${t.name}`),
];
/** The kind the hub gives each tool name: the tool.before of a PreToolUse from the session, one at a time. */
export async function kindsOf(hub: t26.Hub, s: Session, names: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const call = `toolu_${randomBytes(10).toString('hex')}`;
    await s.stand.hook(hub, 'PreToolUse', { tool_name: name, tool_input: {}, tool_use_id: call });
    let before: t26.Ev | undefined;
    for (const deadline = Date.now() + 10_000; !before && Date.now() < deadline; await t26.sleep(100)) {
      before = (await t26.events(hub)).find((e) => e.kind === 'tool.before' && JSON.stringify(e.data).includes(call));
    }
    out[name] = before ? String(before.data.kind) : 'no tool.before recorded';
  }
  return out;
}

// ---- scripts/skill.mjs run in a scratch copy of this checkout's scripts/, docs/, packages/hub (its own files),
// crates/deep-canvas/src/craft.json and skills/, node_modules linked: the files it writes beside tools.json.
export function generatedBesideTools(): { written: string[]; problems: string[]; out: string } {
  const dir = tempDir();
  for (const part of ['scripts', 'docs', 'skills', 'crates/deep-canvas/src/craft.json']) cpSync(join(REPO, part), join(dir, part), { recursive: true });
  cpSync(join(REPO, 'packages/hub'), join(dir, 'packages/hub'), { recursive: true, filter: (src) => !src.includes('/node_modules') });
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
  const hub = join(dir, 'packages/hub');
  // Every file of its own beside tools.json, but its package.json, removed: what the generator writes comes back.
  for (const f of readdirSync(hub)) if (f !== 'package.json' && statSync(join(hub, f)).isFile()) rmSync(join(hub, f));
  const before = new Set(readdirSync(hub));
  const ran = spawnSyncNode(['scripts/skill.mjs'], dir);
  const written = readdirSync(hub).filter((f) => !before.has(f) && statSync(join(hub, f)).isFile()).sort();
  const problems = written.filter((f) => !existsSync(join(REPO, 'packages/hub', f)) || !readFileSync(join(REPO, 'packages/hub', f)).equals(readFileSync(join(hub, f))))
    .map((f) => `packages/hub/${f}, as scripts/skill.mjs generates it, differs from this checkout's`);
  return { written, problems, out: ran };
}
function spawnSyncNode(args: string[], cwd: string): string {
  const r = spawnSync(NODE, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  return `exit ${r.status}: ${(r.stdout ?? '').slice(-600)} ${(r.stderr ?? '').slice(-1200)}`;
}
