// Shared by #2897's acceptance tests. They reach the change only through what the issue and the design name (README:
// Surfaces): each of the four MCP servers over stdio (initialize, tools/list, tools/call), `scripts/skill.mjs`'s
// generate(), the adapters' facts files, the corpus under adapters/corpus, the record (events.read) and
// benchmarks/budgets.json. Token counts use the pinned tokenizer, gpt-tokenizer 4.0.0's o200k_base
// (adapters/codex.facts.json `tokenizer`). Every check here returns its failures as lines, so a planted input run
// through the same check shows what it names.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { onTestFinished } from 'vitest';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const suite = join(root, 'tests/acceptance/2897');

/** Each criterion's tag: `#2897.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs criterionId). */
export const AC = {
  instructions: 'AC1 #2897.a00d5d1a',
  marks: 'AC2 #2897.ece39ddf',
  startTokens: 'AC3 #2897.95956be1',
  recordCount: 'AC4 #2897.1171f907',
  corpus: 'AC5 #2897.a24a3c11',
  fullSchema: 'AC6 #2897.8fdcb433',
  sameBytes: 'AC7 #2897.ec26a425',
  budgets: 'AC8 #2897.cc2bc99a',
} as const;

// ---------------------------------------------------------------------------------------------------
// Values the issue states.

/** "in at most 1,000 characters". */
export const INSTRUCTIONS_MAX = 1000;
/** "at most 800 tokens". */
export const START_MAX = 800;
/** The mark the issue reads on Claude Code's MCP page: `anthropic/alwaysLoad` in a tool's `_meta`. */
export const MARK = 'anthropic/alwaysLoad';
/** The cut the issue reads on that page: `instructions` cut at 4,096 characters. */
export const CUT = 4096;
/** The load-mark set as the issue drafts it (README: Open questions 1). */
export const MARKED = ['deep_status'] as const;
/** The canvas's five tools (the issue: "the canvas's five tools are 5,455 of the list's tokens"). */
export const CANVAS = ['deep_show', 'deep_drive', 'deep_kinds', 'deep_query', 'deep_job'] as const;
/** The call a task begins with. */
export const FIRST = 'deep_status';

// ---------------------------------------------------------------------------------------------------
// Tokens.

/** Tokens of a text, or of a value as its JSON, by the pinned tokenizer. */
export const tokens = (value: unknown): number => countTokens(typeof value === 'string' ? value : JSON.stringify(value));

// ---------------------------------------------------------------------------------------------------
// Scratch folders.

export function scratch(prefix = 'deep-2897-'): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// ---------------------------------------------------------------------------------------------------
// The four servers (README: The four servers).

export type Obj = Record<string, unknown>;
export interface Tool { name: string; description?: string; inputSchema?: Obj; _meta?: Obj; [key: string]: unknown }

/** deep-hook as cargo builds it: the newer of target/debug and target/release. */
export function deepHook(): string | undefined {
  const built = ['target/debug/deep-hook', 'target/release/deep-hook'].map((p) => join(root, p)).filter((p) => existsSync(p));
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export interface Server {
  /** The name the server gives itself, and how it is started. */
  label: string;
  /** The name `deep setup` gives it in Claude Code's config, which prefixes its tools there (mcp__<config>__<tool>). */
  config: string;
  argv: (home: string) => string[] | undefined;
  /** What to build when argv is undefined. */
  build: string;
}

const CLI = join(root, 'packages/cli/dist/main.js');
const READING = join(root, 'packages/reading/dist/tools.mjs');

export const SERVERS: readonly Server[] = [
  { label: 'deep (deep mcp)', config: 'deepbuild', argv: () => (existsSync(CLI) ? [process.execPath, CLI, 'mcp'] : undefined), build: 'npm run build --workspaces' },
  { label: 'deep-actions (deep mcp actions)', config: 'deep-actions', argv: () => (existsSync(CLI) ? [process.execPath, CLI, 'mcp', 'actions'] : undefined), build: 'npm run build --workspaces' },
  { label: 'deep-actions (deep-hook mcp actions)', config: 'deep-actions', argv: () => { const hook = deepHook(); return hook ? [hook, 'mcp', 'actions'] : undefined; }, build: 'cargo build -p deep-hook' },
  { label: 'deepbuild-reading (packages/reading tools.mjs)', config: 'deepbuild-reading', argv: (home) => (existsSync(READING) ? [process.execPath, READING, join(home, 'no-reading-job.sock')] : undefined), build: 'npm run build --workspaces' },
];
export const DEEP = SERVERS[0]!;
export const ACTIONS_HOOK = SERVERS[2]!;

/** The client a session's server sees, as Claude Code names itself in initialize, at the newest version its facts list. */
export function claudeClient(): { name: string; version: string } {
  const versions = facts('claude-code').versions as string[];
  return { name: 'claude-code', version: versions.at(-1)! };
}

export interface Session {
  initialize: Obj | undefined;
  tools: Tool[] | undefined;
  /** The raw lines of each reply, for byte comparison. */
  raw: { initialize: string; tools: string };
  output: string;
}

/** One newline-delimited JSON-RPC conversation with a server started fresh in a home of its own (no hub is reachable there). */
export class Mcp {
  private readonly replies = new Map<string, { raw: string; message: Obj }>();
  private readonly wakers = new Set<() => void>();
  private err = '';
  private ids = 0;
  private constructor(readonly child: ChildProcess, readonly label: string) {
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      try {
        const message = JSON.parse(raw) as Obj;
        if (message.id !== undefined) this.replies.set(JSON.stringify(message.id), { raw, message });
      } catch { /* not JSON-RPC */ }
      for (const wake of [...this.wakers]) wake();
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
  }
  static start(server: Server, home: string, env: Record<string, string> = {}): Mcp {
    const argv = server.argv(home);
    if (!argv) throw Error(`BLOCKED: ${server.label} isn't built: ${server.build}`);
    const child = spawn(argv[0]!, argv.slice(1), { cwd: home, env: { ...process.env, HOME: home, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const mcp = new Mcp(child, server.label);
    onTestFinished(() => mcp.stop());
    return mcp;
  }
  /** A planted server: a Node script started the same way. */
  static script(file: string, label: string, home: string): Mcp {
    const child = spawn(process.execPath, [file], { cwd: home, env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    const mcp = new Mcp(child, label);
    onTestFinished(() => mcp.stop());
    return mcp;
  }
  notify(method: string, params: Obj = {}): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
  async request(method: string, params: Obj = {}, timeoutMs = 30_000): Promise<{ raw: string; message: Obj }> {
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

/** A session's start as a client that loads by search sees it: initialize as Claude Code, then tools/list. */
export async function startSession(server: Server, home = scratch()): Promise<Session> {
  const mcp = Mcp.start(server, home);
  return converse(mcp);
}
export async function converse(mcp: Mcp): Promise<Session> {
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: claudeClient() });
  mcp.notify('notifications/initialized');
  const list = await mcp.request('tools/list', {});
  const tools = (list.message.result as Obj | undefined)?.tools;
  return {
    initialize: init.message.result as Obj | undefined,
    tools: Array.isArray(tools) ? (tools as Tool[]) : undefined,
    raw: { initialize: init.raw, tools: list.raw },
    output: `initialize: ${init.raw.slice(0, 1500)}\nstderr: ${mcp.stderr}`,
  };
}

/** A server's `instructions`, when its initialize result holds a string there. */
export const instructionsOf = (session: Session): string | undefined =>
  typeof session.initialize?.instructions === 'string' ? session.initialize.instructions : undefined;

// ---------------------------------------------------------------------------------------------------
// The generated text (AC1): every string scripts/skill.mjs's generate() returns.

export async function generatedStrings(): Promise<Set<string>> {
  const { generate } = (await import(pathToFileURL(join(root, 'scripts/skill.mjs')).href)) as { generate: () => unknown };
  const out = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(generate());
  return out;
}

/** Whether `text` names deep_status as the call a task begins with: one sentence holding both. */
export const namesFirst = (text: string): boolean =>
  text.split(/(?<=[.;:!?])\s+/).some((sentence) => sentence.includes(FIRST) && /\b(begin|begins|beginning|first|start|starts|starting)\b/i.test(sentence));

/** AC1's check on one server's start: its failures, each naming the server. */
export function instructionFailures(label: string, session: Session, generated: Set<string>, deep: boolean): string[] {
  const text = instructionsOf(session);
  if (text === undefined) return [`${label}: initialize holds no instructions (${JSON.stringify(session.initialize ?? null).slice(0, 400)})`];
  const failures: string[] = [];
  if (!text.length) failures.push(`${label}: its instructions are empty`);
  if (text.length > INSTRUCTIONS_MAX) failures.push(`${label}: its instructions are ${text.length} characters, over ${INSTRUCTIONS_MAX}`);
  if (!generated.has(text)) failures.push(`${label}: its instructions are not a text scripts/skill.mjs generates: ${JSON.stringify(text.slice(0, 300))}`);
  if (deep && !namesFirst(text)) failures.push(`${label}: its instructions don't name ${FIRST} as the call a task begins with: ${JSON.stringify(text.slice(0, 300))}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The load mark (AC2, AC3).

export const marked = (tool: Tool): boolean => (tool._meta as Obj | undefined)?.[MARK] === true;
/** What a client that reads the mark loads up front: each marked tool whole. */
export const markedTokens = (tools: readonly Tool[]): number => tools.filter(marked).reduce((sum, tool) => sum + tokens(tool), 0);

/** AC2's check on deep's list: its failures; a list that marks more than the set names the tokens it would load. */
export function markFailures(tools: readonly Tool[]): string[] {
  const failures: string[] = [];
  const set = tools.filter(marked).map((t) => t.name).sort();
  const want = [...MARKED].sort();
  if (JSON.stringify(set) !== JSON.stringify(want)) {
    failures.push(`the tools marked ${MARK} are [${set.join(', ')}], not [${want.join(', ')}]: a client that reads the mark would load ${markedTokens(tools)} tokens of them at the start`);
  }
  const canvas = tools.filter((t) => marked(t) && (CANVAS as readonly string[]).includes(t.name)).map((t) => t.name);
  if (canvas.length) failures.push(`canvas tools carry the mark: ${canvas.join(', ')}`);
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// What a client that loads by search holds at a session's start (AC3).

/** The skill's description, from its front matter. */
export function skillDescription(): string {
  const skill = readFileSync(join(root, 'skills/deepbuild/SKILL.md'), 'utf8');
  return /^description: (.*)$/m.exec(skill)?.[1] ?? '';
}

export interface Start { names: number; instructions: number; marked: number; skill: number; total: number; parts: string[] }

/** The four parts the issue counts, for the servers a session holds: tool names, instructions, marked tools, the skill's description. */
export function startCount(sessions: ReadonlyArray<{ server: Server; session: Session }>): Start {
  const names = sessions.flatMap(({ server, session }) => (session.tools ?? []).map((t) => `mcp__${server.config}__${t.name}`)).join('\n');
  const texts = sessions.map(({ session }) => instructionsOf(session) ?? '');
  const n = tokens(names), i = texts.reduce((s, t) => s + (t ? tokens(t) : 0), 0);
  const m = sessions.reduce((s, { session }) => s + markedTokens(session.tools ?? []), 0), k = tokens(skillDescription());
  const parts = sessions.map(({ server, session }) => `${server.label}: ${instructionsOf(session)?.length ?? 0} characters of instructions, ${tokens(instructionsOf(session) ?? '')} tokens; marked [${(session.tools ?? []).filter(marked).map((t) => t.name).join(', ')}]`);
  return { names: n, instructions: i, marked: m, skill: k, total: n + i + m + k, parts };
}

export function startFailures(start: Start): string[] {
  return start.total <= START_MAX ? [] : [`a client that loads by search holds ${start.total} tokens of DeepBuild at the start, over ${START_MAX} (names ${start.names}, instructions ${start.instructions}, marked tools ${start.marked}, skill description ${start.skill}); ${start.parts.join('; ')}`];
}

// ---------------------------------------------------------------------------------------------------
// Adapters' facts (AC4, AC6): the entry that says how a client loads an MCP server's tools.

export function facts(agent: string): Obj {
  return JSON.parse(readFileSync(join(root, 'adapters', `${agent}.facts.json`), 'utf8')) as Obj;
}

/** "by search": the way, as a value. */
const BY_SEARCH = /^(by[ _-]?)?search$/i;

/** Every object in `value` (itself included), with its path. */
function objects(value: unknown, path = ''): Array<{ path: string; obj: Obj }> {
  if (Array.isArray(value)) return value.flatMap((v, i) => objects(v, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  const obj = value as Obj;
  return [{ path, obj }, ...Object.entries(obj).flatMap(([k, v]) => objects(v, `${path}.${k}`))];
}
const holds = (value: unknown, test: (leaf: unknown) => boolean): boolean =>
  Array.isArray(value) ? value.some((v) => holds(v, test)) : value && typeof value === 'object' ? Object.values(value).some((v) => holds(v, test)) : test(value);

/**
 * The facts entry that says `version` of the agent's client loads an MCP server's tools by search (README: Open
 * questions 3): an object with a `versions` list holding the version and a `source` string, holding "search" as a value,
 * the cut (4096) and the mark (anthropic/alwaysLoad).
 */
export function searchEntry(agent: string, version: string): { path: string; obj: Obj } | undefined {
  return objects(facts(agent)).find(({ obj }) => Array.isArray(obj.versions) && (obj.versions as unknown[]).includes(version) && typeof obj.source === 'string'
    && holds(obj, (leaf) => typeof leaf === 'string' && BY_SEARCH.test(leaf)));
}

// ---------------------------------------------------------------------------------------------------
// The corpus (AC5).

export interface HookLine { payload: Obj }
const corpusDir = join(root, 'adapters/corpus/claude-code');

/** DeepBuild's servers' tool names as Claude Code calls them: mcp__<server>__<tool>, for deep's config names. */
export const DEEP_TOOL = /^mcp__(deepbuild|deep|deep-actions)__(.+)$/;
const isDeepStatus = (name: unknown): boolean => typeof name === 'string' && DEEP_TOOL.exec(name)?.[2] === FIRST;

/** The scenarios of a version whose recorded hooks call DeepBuild's deep_status. */
export function deepScenarios(version: string): Array<{ name: string; lines: HookLine[] }> {
  const dir = join(corpusDir, version);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().flatMap((name) => {
    const file = join(dir, name, 'events.jsonl');
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as HookLine);
    return lines.some((l) => l.payload.hook_event_name === 'PreToolUse' && isDeepStatus(l.payload.tool_name)) ? [{ name, lines }] : [];
  });
}

/** The tool names a ToolSearch call names: its `select:` query's names and its result's matches. */
function searched(payload: Obj): string[] {
  const query = String((payload.tool_input as Obj | undefined)?.query ?? '');
  const selected = query.startsWith('select:') ? query.slice('select:'.length).split(',').map((s) => s.trim()) : [];
  const matches = ((payload.tool_response as Obj | undefined)?.matches ?? []) as unknown[];
  return [...selected, ...matches.map(String)];
}
const REFUSED_FOR_SCHEMA = /schema_needed|InputValidationError|missing_field/;

/** AC5's check on one recorded session: its failures, each naming the call. */
export function scenarioFailures(lines: readonly HookLine[]): string[] {
  const failures: string[] = [];
  const payloads = lines.map((l) => l.payload);
  const firstStatus = payloads.findIndex((p) => p.hook_event_name === 'PreToolUse' && isDeepStatus(p.tool_name));
  if (firstStatus < 0) return ['no call of deep_status is recorded'];
  const searches = (before: number) => payloads.slice(0, before).filter((p) => p.tool_name === 'ToolSearch' && /^(PreToolUse|PostToolUse)$/.test(String(p.hook_event_name)));
  const named = new Set<unknown>();
  for (const p of searches(firstStatus)) {
    if (named.has(p.tool_use_id) || !searches(firstStatus).filter((s) => s.tool_use_id === p.tool_use_id).some((s) => searched(s).some(isDeepStatus))) continue;
    named.add(p.tool_use_id);
    failures.push(`a search before the first deep_status: ToolSearch ${JSON.stringify((p.tool_input as Obj | undefined)?.query)} (${String(p.tool_use_id)})`);
  }
  const seen = new Set<string>();
  payloads.forEach((p, i) => {
    if (p.hook_event_name !== 'PreToolUse' || typeof p.tool_name !== 'string' || !DEEP_TOOL.test(p.tool_name) || isDeepStatus(p.tool_name) || seen.has(p.tool_name)) return;
    seen.add(p.tool_name);
    if (!searches(i).some((s) => s.hook_event_name === 'PostToolUse' && searched(s).includes(p.tool_name as string))) failures.push(`${p.tool_name} (${String(p.tool_use_id)}) is called with no search that loaded it before its first call`);
  });
  for (const p of payloads) {
    if (typeof p.tool_name !== 'string' || !DEEP_TOOL.test(p.tool_name) || !/^PostToolUse/.test(String(p.hook_event_name))) continue;
    const said = JSON.stringify([p.tool_response ?? null, p.error ?? null]);
    const code = REFUSED_FOR_SCHEMA.exec(said)?.[0];
    if (code) failures.push(`${p.tool_name} (${String(p.tool_use_id)}) was refused for a schema the agent didn't have: ${code}`);
  }
  return failures;
}

/** The planted server's recording (README: How the plants work): a search that loads deep_status, before its first call. */
export function searchedFirst(lines: readonly HookLine[]): HookLine[] {
  const at = lines.findIndex((l) => l.payload.hook_event_name === 'PreToolUse' && isDeepStatus(l.payload.tool_name));
  const status = lines[at]!.payload;
  const name = String(status.tool_name);
  const common = { ...status, tool_name: 'ToolSearch', tool_input: { query: `select:${name}`, max_results: 1 }, tool_use_id: 'toolu_planted_search' };
  const pre = { payload: { ...common, hook_event_name: 'PreToolUse' } };
  const post = { payload: { ...common, hook_event_name: 'PostToolUse', tool_response: { matches: [name], query: `select:${name}`, total_deferred_tools: 19 } } };
  return [...lines.slice(0, at), pre, post, ...lines.slice(at)];
}

// ---------------------------------------------------------------------------------------------------
// The full schema to a client that loads by search (AC6).

const emptySchema = (schema: unknown): boolean => {
  if (!schema || typeof schema !== 'object') return true;
  const props = (schema as Obj).properties;
  return !props || typeof props !== 'object' || Object.keys(props as Obj).length === 0;
};

/** AC6's check: tools listed with an empty schema, and a first deep_show that didn't run, naming its code. */
export function schemaFailures(tools: readonly Tool[], firstShow: { isError: boolean; value: unknown; raw: string }): string[] {
  const failures: string[] = [];
  const empty = tools.filter((t) => emptySchema(t.inputSchema)).map((t) => t.name);
  if (empty.length) failures.push(`listed with an empty schema: ${empty.join(', ')}`);
  if (firstShow.isError) {
    const code = (firstShow.value as Obj | null)?.code;
    failures.push(`the first deep_show with valid arguments was refused${typeof code === 'string' ? ` with ${code}` : ''}: ${firstShow.raw.slice(0, 600)}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// The merge base's tools (AC2, AC7): base-tools.json, each server's tools/list at base 6a2b68d44 (README: The base).

export interface Base { base: string; servers: Record<string, Array<{ name: string; description: string; inputSchema: Obj }>> }
export const base = (): Base => JSON.parse(readFileSync(join(suite, 'base-tools.json'), 'utf8')) as Base;
/** The key of base-tools.json a server's list is held under: the name it gives itself. */
export const baseKey = (server: Server): string => server.label.split(' ')[0]!;

/** AC7's check on one server: tools whose name, description or input schema isn't the merge base's bytes. */
export function baseFailures(label: string, tools: readonly Tool[], was: Base['servers'][string]): string[] {
  const failures: string[] = [];
  const names = tools.map((t) => t.name);
  if (JSON.stringify(names) !== JSON.stringify(was.map((t) => t.name))) failures.push(`${label}: lists [${names.join(', ')}], not the merge base's [${was.map((t) => t.name).join(', ')}]`);
  for (const old of was) {
    const now = tools.find((t) => t.name === old.name);
    if (!now) continue;
    if (now.description !== old.description) failures.push(`${label}: ${old.name}'s description isn't the merge base's bytes`);
    if (JSON.stringify(now.inputSchema) !== JSON.stringify(old.inputSchema)) failures.push(`${label}: ${old.name}'s input schema isn't the merge base's bytes`);
  }
  return failures;
}

/** AC7's check on two starts of one server: what differs between them, naming the differing text. */
export function sameFailures(label: string, a: Session, b: Session): string[] {
  const failures: string[] = [];
  const ia = instructionsOf(a), ib = instructionsOf(b);
  if (ia === undefined || ib === undefined || !ia.length) failures.push(`${label}: a start received no instructions (${JSON.stringify(a.initialize ?? null).slice(0, 300)})`);
  else if (ia !== ib) {
    let at = 0;
    while (at < ia.length && ia[at] === ib[at]) at++;
    failures.push(`${label}: the instructions differ a minute apart, from character ${at}: ${JSON.stringify(ia.slice(at, at + 60))} then ${JSON.stringify(ib.slice(at, at + 60))}`);
  }
  const ta = JSON.stringify(a.tools ?? null), tb = JSON.stringify(b.tools ?? null);
  if (ta !== tb) failures.push(`${label}: the tool lists differ a minute apart`);
  return failures;
}
