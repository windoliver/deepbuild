// Shared by #2854's acceptance tests. They reach the change only through what the issue names (README: Surfaces):
// each of the four MCP servers DeepBuild ships, driven over its stdio by raw JSON-RPC lines (initialize, tools/list,
// tools/call), the contract entry mcp.handshake@1 and its generated TypeScript and Rust types, the reading tools' file,
// the adapters' facts files with the recorded requests they name, `node scripts/corpus.mjs check`, and
// benchmarks/budgets.json. No test imports the code under test.
// Every check returns its failures as lines, so a planted input run through the same check shows what it names.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { onTestFinished } from 'vitest';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

/** Each criterion's tag: `#2854.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs criterionId). */
export const AC = {
  answers: '#2854.714225f2',
  sameTools: '#2854.411577d9',
  keywords: '#2854.aaad023c',
  oneEntry: '#2854.58c9395c',
  facts: '#2854.9225ef55',
  budgets: '#2854.1891d3ad',
} as const;

// ---------------------------------------------------------------------------------------------------
// Values the issue states.

/** "The list starts as `2025-06-18` and gains `2025-11-25` in this task": the held revisions, oldest first. */
export const HELD = ['2025-06-18', '2025-11-25'] as const;
/** The newest held revision, which any other string, or none, is answered with. */
export const NEWEST = '2025-11-25';
/** The handshakes the first criterion names, and the revision each must be answered with. `undefined` is no protocolVersion. */
export const HANDSHAKES: ReadonlyArray<{ sent: string | undefined; answered: string }> = [
  { sent: '2025-06-18', answered: '2025-06-18' },
  { sent: '2025-11-25', answered: '2025-11-25' },
  { sent: '1900-01-01', answered: NEWEST },
  { sent: '2026-07-28', answered: NEWEST },
  { sent: undefined, answered: NEWEST },
];
/** A revision no server holds, to tell a server that holds a list from one that sends back what it was sent. */
export const UNKNOWN = '1900-01-01';
/** A handshake revision's form. */
export const REVISION = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------------------------------
// Scratch folders.

export function scratch(prefix = 'deep-2854-'): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// ---------------------------------------------------------------------------------------------------
// The four servers (the issue's Scope: `deep mcp`, `deep mcp actions`, deep-hook's `mcp actions` and the reading tools).

export type Obj = Record<string, unknown>;
export interface Tool { name: string; inputSchema?: unknown; [key: string]: unknown }

/** deep-hook as cargo builds it: the newer of target/debug and target/release. */
export function deepHook(): string | undefined {
  const built = ['target/debug/deep-hook', 'target/release/deep-hook'].map((p) => join(root, p)).filter((p) => existsSync(p));
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export interface Server {
  label: string;
  /** How it is started in `home`, or undefined when it isn't built. */
  argv: (home: string) => string[] | undefined;
  build: string;
}

const CLI = join(root, 'packages/cli/dist/main.js');
const READING = join(root, 'packages/reading/dist/tools.mjs');

export const SERVERS: readonly Server[] = [
  { label: 'deep mcp', argv: () => (existsSync(CLI) ? [process.execPath, CLI, 'mcp'] : undefined), build: 'npm run build --workspaces' },
  { label: 'deep mcp actions', argv: () => (existsSync(CLI) ? [process.execPath, CLI, 'mcp', 'actions'] : undefined), build: 'npm run build --workspaces' },
  { label: "deep-hook's mcp actions", argv: () => { const hook = deepHook(); return hook ? [hook, 'mcp', 'actions'] : undefined; }, build: 'cargo build -p deep-hook' },
  // The reading tools take the reading job's socket as their argument; none is listening there, so a call is answered
  // that the socket can't be reached, the same text in every session of one home.
  { label: 'the reading tools', argv: (home) => (existsSync(READING) ? [process.execPath, READING, join(home, 'no-reading-job.sock')] : undefined), build: 'npm run build --workspaces' },
];

/** One newline-delimited JSON-RPC conversation with a server started in a home of its own, where no hub is reachable. */
export class Mcp {
  private readonly replies = new Map<string, Obj>();
  private readonly wakers = new Set<() => void>();
  private err = '';
  private ids = 0;
  private constructor(readonly child: ChildProcess, readonly label: string) {
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      try {
        const message = JSON.parse(raw) as Obj;
        if (message.id !== undefined) this.replies.set(JSON.stringify(message.id), message);
      } catch { /* not JSON-RPC */ }
      for (const wake of [...this.wakers]) wake();
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
  }
  static start(server: Server, home: string): Mcp {
    const argv = server.argv(home);
    if (!argv) throw Error(`BLOCKED: ${server.label} isn't built: ${server.build}`);
    const child = spawn(argv[0]!, argv.slice(1), { cwd: home, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    const mcp = new Mcp(child, server.label);
    onTestFinished(() => mcp.stop());
    return mcp;
  }
  notify(method: string, params: Obj = {}): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
  async request(method: string, params: Obj = {}, timeoutMs = 60_000): Promise<Obj> {
    const id = ++this.ids;
    const key = JSON.stringify(id);
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const due = Date.now() + timeoutMs;
    while (!this.replies.has(key)) {
      if (Date.now() > due || this.child.exitCode !== null) throw Error(`BLOCKED: ${this.label} gave no reply to ${method} in ${timeoutMs} ms (exit ${this.child.exitCode}); stderr: ${this.err}`);
      await new Promise<void>((resolve) => {
        const done = (): void => { clearTimeout(timer); this.wakers.delete(done); resolve(); };
        const timer = setTimeout(done, 200);
        this.wakers.add(done);
      });
    }
    return this.replies.get(key)!;
  }
  /** Ends the conversation by closing stdin; a server that hasn't exited a second later is stopped by its PID. */
  stop(): void {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin!.end();
    const pid = this.child.pid;
    setTimeout(() => { if (this.child.exitCode === null && this.child.signalCode === null && pid) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }, 1000).unref();
  }
  get stderr(): string { return this.err; }
}

/** initialize's params as a client sends them; `revision` undefined leaves protocolVersion out. */
export const initParams = (revision: string | undefined): Obj => ({
  ...(revision === undefined ? {} : { protocolVersion: revision }),
  capabilities: {},
  clientInfo: { name: 'acceptance-2854', version: '0' },
});

/** A fresh server process's answer to one initialize: the revision it names, and the raw reply. */
export async function handshake(server: Server, revision: string | undefined, home = scratch()): Promise<{ answered: unknown; reply: Obj; mcp: Mcp }> {
  const mcp = Mcp.start(server, home);
  const reply = await mcp.request('initialize', initParams(revision));
  mcp.notify('notifications/initialized');
  return { answered: (reply.result as Obj | undefined)?.protocolVersion, reply, mcp };
}

/** How a sent revision reads in a failure line. */
export const named = (revision: string | undefined): string => (revision === undefined ? 'no protocolVersion' : revision);

/**
 * The precondition for "a handshake at a held revision": the server holds a list, shown by an initialize naming a
 * revision nobody holds being answered with the newest held one rather than sent back. A failure line, or undefined.
 */
export async function holdsAList(server: Server, home = scratch()): Promise<string | undefined> {
  const { answered, mcp } = await handshake(server, UNKNOWN, home);
  mcp.stop();
  if (answered === NEWEST) return undefined;
  return `${server.label}: holds no list of handshake revisions: initialize naming ${UNKNOWN} is answered ${JSON.stringify(answered)}, not ${NEWEST}, so no handshake with it is at a held revision`;
}

/** A session at `revision`: its initialize answer, its tools/list, and the answer to one call of its first tool. */
export async function session(server: Server, revision: string, home: string): Promise<{ answered: unknown; tools: Tool[] | undefined; call: Obj | undefined; callOf: string | undefined }> {
  const { answered, mcp } = await handshake(server, revision, home);
  const list = await mcp.request('tools/list', {});
  const raw = (list.result as Obj | undefined)?.tools;
  const tools = Array.isArray(raw) ? (raw as Tool[]) : undefined;
  const callOf = tools?.[0]?.name;
  const call = callOf === undefined ? undefined : await mcp.request('tools/call', { name: callOf, arguments: {} });
  mcp.stop();
  return { answered, tools, call, callOf };
}

/** A server's tools/list after a handshake naming `revision`. */
export async function toolsAt(server: Server, revision: string, home = scratch()): Promise<{ answered: unknown; tools: Tool[] | undefined }> {
  const { answered, mcp } = await handshake(server, revision, home);
  const list = await mcp.request('tools/list', {});
  mcp.stop();
  const raw = (list.result as Obj | undefined)?.tools;
  return { answered, tools: Array.isArray(raw) ? (raw as Tool[]) : undefined };
}

// ---------------------------------------------------------------------------------------------------
// JSON Schema keywords that mean the same in draft-07 and 2020-12 (AC3).

/**
 * Keywords whose meaning draft-07 and 2020-12 share, as their validation and core specs define them. Left out on
 * purpose: `items` as a list and `additionalItems` (2020-12 moved tuples to `prefixItems`, and `items` as a list is
 * no longer a tuple), `prefixItems`, `dependencies` (split into `dependentRequired` and `dependentSchemas`), those two,
 * `$ref` (draft-07 ignores every keyword beside it, 2020-12 applies them), `definitions` and `$defs` (each dialect
 * names only one), `$id` (a fragment `$id` became `$anchor`), `$anchor`, `$schema` (it changes the dialect itself),
 * `$recursiveRef`, `$recursiveAnchor`, `$dynamicRef`, `$dynamicAnchor`, `$vocabulary`, `unevaluatedProperties`,
 * `unevaluatedItems`, `minContains`, `maxContains` and `contentSchema` (2019-09 and later only).
 */
export const SAME_KEYWORDS = new Set([
  'type', 'enum', 'const',
  'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum',
  'maxLength', 'minLength', 'pattern', 'format',
  'items', 'maxItems', 'minItems', 'uniqueItems', 'contains',
  'maxProperties', 'minProperties', 'required', 'properties', 'patternProperties', 'additionalProperties', 'propertyNames',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
  'title', 'description', 'default', 'examples', 'readOnly', 'writeOnly', '$comment',
  'contentMediaType', 'contentEncoding',
]);
/** Keywords whose value is one subschema. */
const ONE = new Set(['additionalProperties', 'propertyNames', 'contains', 'not', 'if', 'then', 'else']);
/** Keywords whose value is a list of subschemas. */
const LIST = new Set(['allOf', 'anyOf', 'oneOf']);
/** Keywords whose value maps names to subschemas. */
const MAP = new Set(['properties', 'patternProperties']);

/** Every keyword in one tool's inputSchema that doesn't mean the same in both dialects, as `<tool>: <keyword> at <path>`. */
export function schemaFailures(tool: Tool): string[] {
  const failures: string[] = [];
  const walk = (schema: unknown, path: string): void => {
    if (typeof schema === 'boolean') return;
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) { failures.push(`${tool.name}: the schema at ${path || '/'} is ${JSON.stringify(schema)}, not a schema`); return; }
    for (const [keyword, value] of Object.entries(schema as Obj)) {
      const at = `${path}/${keyword}`;
      if (!SAME_KEYWORDS.has(keyword)) { failures.push(`${tool.name}: ${keyword} at ${at}`); continue; }
      if (keyword === 'items') {
        if (Array.isArray(value)) failures.push(`${tool.name}: items at ${at} is a list of schemas`);
        else walk(value, at);
      } else if (ONE.has(keyword)) walk(value, at);
      else if (LIST.has(keyword) && Array.isArray(value)) value.forEach((sub, i) => walk(sub, `${at}/${i}`));
      else if (MAP.has(keyword) && value && typeof value === 'object') for (const [name, sub] of Object.entries(value as Obj)) walk(sub, `${at}/${name}`);
    }
  };
  if (tool.inputSchema === undefined) failures.push(`${tool.name}: has no inputSchema`);
  else walk(tool.inputSchema, '');
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The contract entry (AC4), as the issue's "Where the list, the facts and the check live" names it:
// packages/contracts/schemas/mcp.handshake@1.json, an object whose `protocolVersion` is a string with an `enum` of the
// held revisions, oldest first; generated as the `McpHandshake` type in packages/contracts/src/generated/types.ts and
// the `McpHandshakeProtocolVersion` enum in crates/deep-contracts/src/generated.rs.

const SCHEMAS = join(root, 'packages/contracts/schemas');
export const ENTRY = 'packages/contracts/schemas/mcp.handshake@1.json';
export const GENERATED_TS = join(root, 'packages/contracts/src/generated/types.ts');
export const GENERATED_RS = join(root, 'crates/deep-contracts/src/generated.rs');
/** The file the issue names for the reading tools' copy. */
export const READING_SOURCE = 'packages/reading/src/tools.mts';

/**
 * The entry in the checkout at `dir`: its `protocolVersion` enum, or a failure line saying what is missing. Never
 * throws, so a test on a checkout without the entry fails at its assertion.
 */
export function heldList(dir = root): { revisions?: string[]; failure?: string } {
  const path = join(dir, ENTRY);
  if (!existsSync(path)) return { failure: `${ENTRY} does not exist` };
  let schema: Obj;
  try { schema = JSON.parse(readFileSync(path, 'utf8')) as Obj; } catch (error) { return { failure: `${ENTRY} is not JSON: ${String(error)}` }; }
  if (schema.type !== 'object') return { failure: `${ENTRY} is not an object schema (type ${JSON.stringify(schema.type)})` };
  const pv = (schema.properties as Obj | undefined)?.protocolVersion as Obj | undefined;
  if (!pv || pv.type !== 'string') return { failure: `${ENTRY}'s protocolVersion is not a string schema: ${JSON.stringify(pv)}` };
  if (!Array.isArray(pv.enum) || !pv.enum.every((v) => typeof v === 'string')) return { failure: `${ENTRY}'s protocolVersion has no enum of strings: ${JSON.stringify(pv.enum)}` };
  return { revisions: pv.enum as string[] };
}

/**
 * The issue's cut-back plant: writes the entry in the copy at `dir` with its enum this checkout's enum less `revision`
 * (so each cut starts from the whole list).
 */
export function cutBack(dir: string, revision: string): void {
  const path = join(dir, ENTRY);
  const schema = JSON.parse(readFileSync(path, 'utf8')) as Obj;
  const pv = (schema.properties as Obj).protocolVersion as Obj;
  pv.enum = heldList().revisions!.filter((r) => r !== revision);
  writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
}

/** The revision strings a source file holds as quoted literals ('…', "…" or `…`). */
export function quotedRevisions(text: string): string[] {
  return [...new Set([...text.matchAll(/['"`](\d{4}-\d{2}-\d{2})['"`]/g)].map((m) => m[1]!))].sort();
}

/**
 * The reading tools' copy against the entry's list: a failure line naming the file, or undefined. `file` is the path
 * the line names, `text` the file's text.
 */
export function copyFailure(file: string, text: string, entry: readonly string[]): string | undefined {
  const copy = quotedRevisions(text);
  const want = [...entry].sort();
  if (JSON.stringify(copy) === JSON.stringify(want)) return undefined;
  const missing = want.filter((r) => !copy.includes(r));
  const extra = copy.filter((r) => !want.includes(r));
  return `${file}: its copy of the held list is ${JSON.stringify(copy)}, not the contract entry's ${JSON.stringify(want)}${missing.length ? `; it lacks ${missing.join(', ')}` : ''}${extra.length ? `; it adds ${extra.join(', ')}` : ''}`;
}

/** The files the issue names for `deep mcp`'s and deep-hook's `initialize` (mcp.ts:157, actions.rs:382). */
export const SERVER_SOURCES = ['packages/hub/src/mcp.ts', 'crates/deep-hook/src/actions.rs'] as const;

// ---------------------------------------------------------------------------------------------------
// Facts (AC5), as the issue names them: `adapter.facts@9`, a section `mcpHandshake` of
// `{readBy, conformance, entries: [{versions, revision, request}]}`, one entry per covered version, `request` the path
// from the checkout's root of `adapters/corpus/<agent>/<version>/mcp-initialize.json`, the initialize line that
// version's client sent, kept byte for byte as JSON.

export type FactsFile = 'claude-code' | 'codex';
export const FACTS_FILES: readonly FactsFile[] = ['claude-code', 'codex'];
export const facts = (file: FactsFile, dir = root): Obj => JSON.parse(readFileSync(join(dir, `adapters/${file}.facts.json`), 'utf8')) as Obj;

export interface HandshakeEntry { versions: string[]; revision: string; request: string }

/** The `mcpHandshake.entries` of a facts file, as far as they have the named shape; [] when there is no such section. */
export function handshakeEntries(f: Obj): HandshakeEntry[] {
  const entries = (f.mcpHandshake as Obj | undefined)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter((e): e is HandshakeEntry => !!e && typeof e === 'object'
    && Array.isArray((e as Obj).versions) && typeof (e as Obj).revision === 'string' && typeof (e as Obj).request === 'string');
}

/**
 * For each covered version of a facts file: the `mcpHandshake` entry naming it, the revision a held one, and the
 * recorded request at the named path naming that revision as `params.protocolVersion`. Failure lines, each naming the
 * file and the version.
 */
export function handshakeFactsFailures(file: FactsFile, f: Obj = facts(file)): string[] {
  const where = `adapters/${file}.facts.json`;
  const failures: string[] = [];
  if (f.schema !== 'adapter.facts@9') failures.push(`${where}: its schema is ${JSON.stringify(f.schema)}, not adapter.facts@9`);
  if (!existsSync(join(SCHEMAS, 'adapter.facts@9.json'))) failures.push('packages/contracts/schemas/adapter.facts@9.json does not exist');
  const section = f.mcpHandshake as Obj | undefined;
  if (!section || typeof section !== 'object') failures.push(`${where}: has no mcpHandshake section`);
  else {
    for (const key of ['readBy', 'conformance'] as const) if (typeof section[key] !== 'string' || !section[key]) failures.push(`${where}: mcpHandshake.${key} is not a non-empty string`);
    if (!Array.isArray(section.entries)) failures.push(`${where}: mcpHandshake.entries is not a list`);
  }
  const entries = handshakeEntries(f);
  const versions = Array.isArray(f.versions) ? (f.versions as string[]) : [];
  if (!versions.length) failures.push(`${where}: lists no covered versions`);
  for (const version of versions) {
    const mine = entries.filter((e) => e.versions.includes(version));
    if (mine.length !== 1) { failures.push(`${file} ${version}: ${mine.length} mcpHandshake entries name this version, not 1`); continue; }
    const { revision, request } = mine[0]!;
    if (!(HELD as readonly string[]).includes(revision)) failures.push(`${file} ${version}: mcpHandshake names ${JSON.stringify(revision)}, not a held revision (${HELD.join(', ')})`);
    const want = `adapters/corpus/${file}/${version}/mcp-initialize.json`;
    if (request !== want) failures.push(`${file} ${version}: mcpHandshake's request is ${JSON.stringify(request)}, not ${want}`);
    const path = join(root, request);
    if (!path.startsWith(`${root}/`) || !existsSync(path)) { failures.push(`${file} ${version}: the recorded request ${request} does not exist`); continue; }
    let recorded: Obj | undefined;
    try { recorded = JSON.parse(readFileSync(path, 'utf8')) as Obj; } catch { failures.push(`${file} ${version}: ${request} is not one JSON document`); continue; }
    if (recorded?.method !== 'initialize') failures.push(`${file} ${version}: ${request} is not an initialize request (method ${JSON.stringify(recorded?.method)})`);
    const sent = (recorded?.params as Obj | undefined)?.protocolVersion;
    if (sent !== revision) failures.push(`${file} ${version}: ${request} names protocolVersion ${JSON.stringify(sent)}, not the facts' ${revision}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The conformance check (AC5's second sentence): `node scripts/corpus.mjs check`, run from a checkout's root.


/**
 * A copy of this checkout outside it, under the OS temp folder: every top-level entry but `.git` and cargo's `target/`
 * (neither is read by the check), cloned copy-on-write (`cp -cR` on macOS, `cp -R --reflink=auto` elsewhere), so
 * node_modules' relative workspace links point into the copy. Removed when the test ends.
 */
export function copyCheckout(): string {
  const dir = scratch('deep-2854-copy-');
  for (const name of readdirSync(root)) {
    if (name === '.git' || name === 'target') continue;
    const args = process.platform === 'darwin' ? ['-cR', join(root, name), dir] : ['-R', '--reflink=auto', join(root, name), dir];
    const done = spawnSync('cp', args, { encoding: 'utf8', timeout: 300_000 });
    if (done.status !== 0) throw Error(`BLOCKED: copying ${name} for the plant failed: ${done.stderr || done.error}`);
  }
  return dir;
}

/** `node scripts/corpus.mjs check` run from the checkout at `dir`: its exit code and its output lines (stdout and stderr). */
export function corpusCheck(dir: string): { status: number | null; lines: string[] } {
  const done = spawnSync(process.execPath, ['scripts/corpus.mjs', 'check'], { cwd: dir, encoding: 'utf8', timeout: 300_000, maxBuffer: 256 * 1024 * 1024 });
  if (done.error) throw Error(`BLOCKED: node scripts/corpus.mjs check did not run in ${dir}: ${done.error}`);
  return { status: done.status, lines: `${done.stdout}\n${done.stderr}`.split('\n').filter((l) => l.trim()) };
}

/** Whether a line names `word` as a whole name: not inside a longer name of letters, digits, `_` or `-`. */
export const namesWord = (line: string, word: string): boolean =>
  new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(line);

// ---------------------------------------------------------------------------------------------------
// Budgets (AC6).

export interface BudgetTask { id: string; command?: unknown; margin?: unknown; limits?: Record<string, unknown> }
export const budgets = (): { tasks: BudgetTask[] } => JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8')) as { tasks: BudgetTask[] };
