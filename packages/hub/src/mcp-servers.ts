// What an MCP call counts as (#18; design: Before each command): read, change, send or destructive, and its effect
// class where it has one, from the facts file of well-known servers (adapters/mcp-servers.facts.json). A server is
// matched by its name and the source Claude Code loads it from: your local config, the repo's .mcp.json (when you
// approved it there) or your user config, in that order. A server or tool the file doesn't list counts as change,
// unless you decided what it counts as. A server's hints and a tool's name only raise its class, never lower it
// (#304): a `destructiveHint` or a name that starts with `delete_` counts it as destructive, while a `readOnlyHint` or
// a read-like name counts for nothing.
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { toolList } from './children.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export interface Counted { counts: 'read' | 'change' | 'send' | 'destructive'; effect?: string }

const FACTS = new URL('../../../adapters/mcp-servers.facts.json', import.meta.url);
let facts: Obj | undefined;
const servers = (): Obj => {
  facts ??= JSON.parse(readFileSync(FACTS, 'utf8')) as Obj;
  return isObj(facts.servers) ? facts.servers : {};
};

/** A JSON file, read again only when it changes. */
const cache = new Map<string, { key: string; value: Obj | undefined }>();
function json(file: string): Obj | undefined {
  let key = 'none';
  try {
    const s = statSync(file);
    key = `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch { /* none */ }
  const seen = cache.get(file);
  if (seen?.key === key) return seen.value;
  let value: Obj | undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    value = isObj(parsed) ? parsed : undefined;
  } catch { /* none, or not JSON: no server from it */ }
  cache.set(file, { key, value });
  return value;
}

/** The config Claude Code loads `server` from in `cwd`, and its scope; undefined when no config names it. */
export function sourceOf(server: string, cwd: string): { scope: 'local' | 'project' | 'user'; config: Obj } | undefined {
  const user = json(join(homedir(), '.claude.json'));
  const project = user && isObj(user.projects) && isObj(user.projects[cwd]) ? user.projects[cwd] : {};
  const local = isObj(project.mcpServers) ? project.mcpServers[server] : undefined;
  if (isObj(local)) return { scope: 'local', config: local };
  const shared = json(join(cwd, '.mcp.json'));
  const repo = shared && isObj(shared.mcpServers) ? shared.mcpServers[server] : undefined;
  const approved = project.enableAllProjectMcpServers === true || (Array.isArray(project.enabledMcpjsonServers) && project.enabledMcpjsonServers.includes(server));
  if (isObj(repo) && approved) return { scope: 'project', config: repo };
  const mine = user && isObj(user.mcpServers) ? user.mcpServers[server] : undefined;
  if (isObj(mine)) return { scope: 'user', config: mine };
  return undefined;
}

const CLASSES: readonly Counted['counts'][] = ['read', 'change', 'send', 'destructive'];
/**
 * The tool lists sessions recorded for each server, each tool with its hints, and the classes you decided for a
 * tool: `{"lists": {<server>: [{name, annotations}]}, "decisions": {<server>: {<tool>: <class>}}}`. Neither is in
 * the record yet (#18 records loads without tool lists; #22 saves tool decisions), so only DEEP_HUB_TEST_MCP_TOOLS,
 * a file only tests name, gives them.
 */
const recorded = (): Obj => (process.env.DEEP_HUB_TEST_MCP_TOOLS ? json(process.env.DEEP_HUB_TEST_MCP_TOOLS) ?? {} : {});

/**
 * The call's count class and effect class; `unknownAs` is what a server or tool the facts don't list, and you
 * decided nothing for, counts as. `trustsHints` is the planted wrong program for #304's AC6.
 */
export function countMcp(server: string, tool: string, cwd: string, unknownAs: Counted['counts'] = 'change', trustsHints = false): Counted {
  const { lists, decisions } = recorded();
  const listed = isObj(lists) && Array.isArray(lists[server]) ? (lists[server] as unknown[]).find((t) => isObj(t) && t.name === tool) : undefined;
  const hints = isObj(listed) && isObj(listed.annotations) ? listed.annotations : {};
  if (trustsHints && (hints.readOnlyHint === true || /^(get|list)_/.test(tool))) return { counts: 'read' };
  const known = servers()[server];
  const source = isObj(known) ? sourceOf(server, cwd) : undefined;
  const matches = isObj(known) && source && Array.isArray(known.scopes) && known.scopes.includes(source.scope)
    && Object.entries(isObj(known.match) ? known.match : {}).every(([field, value]) => source.config[field] === value);
  const entry = matches && isObj(known.tools) ? known.tools[tool] : undefined;
  const decided = isObj(decisions) && isObj(decisions[server]) ? decisions[server][tool] : undefined;
  const counted: Counted = isObj(entry) && typeof entry.counts === 'string'
    ? { counts: entry.counts as Counted['counts'], ...(typeof entry.effect === 'string' ? { effect: entry.effect } : {}) }
    : { counts: typeof decided === 'string' && CLASSES.includes(decided as Counted['counts']) ? decided as Counted['counts'] : unknownAs };
  if (hints.destructiveHint === true || tool.startsWith('delete_')) counted.counts = 'destructive';
  return counted;
}

/** One server's tool list at a session's start (#321): each tool with its input schema's digest and its hints. */
export interface Listed { server: string; scope: 'local' | 'project' | 'user'; version: string | null; tools: { name: string; digest: string; hints: Obj }[] }
const LIST_MS = 10_000;

/**
 * The tool list of every stdio server Claude Code loads in `cwd`, synced by DeepBuild or added by you, asked of
 * each server over MCP as the agent asks it (initialize, then tools/list, page by page), in the order its configs
 * win. A server that doesn't answer within 10 s, or that isn't a command (a remote one), gives no list.
 */
export async function toolLists(cwd: string): Promise<Listed[]> {
  const user = json(join(homedir(), '.claude.json'));
  const project = user && isObj(user.projects) && isObj(user.projects[cwd]) ? user.projects[cwd] : {};
  const names = new Set([project.mcpServers, json(join(cwd, '.mcp.json'))?.mcpServers, user?.mcpServers].flatMap((s) => (isObj(s) ? Object.keys(s) : [])));
  // Our own server's tools (deep_ask and the rest) are DeepBuild's, and the gate never holds them.
  names.delete('deep');
  const out = await Promise.all([...names].map(async (server) => {
    const source = sourceOf(server, cwd);
    if (!source || typeof source.config.command !== 'string' || (source.config.type !== undefined && source.config.type !== 'stdio')) return undefined;
    // Started from the children's thread: the core's would wait on each server's exec.
    const listed = await toolList(source.config, cwd).catch(() => undefined);
    return listed && { server, scope: source.scope, ...listed };
  }));
  return out.filter((l): l is Listed => l !== undefined);
}

/** Starts one stdio server from its config and reads its version and tools; stops it, by its own PID, once read. */
export function listOf(config: Obj, cwd: string): Promise<Omit<Listed, 'server' | 'scope'>> {
  return new Promise((done, fail) => {
    const env = { ...process.env, ...(isObj(config.env) ? Object.fromEntries(Object.entries(config.env).map(([k, v]) => [k, String(v)])) : {}) };
    const child = spawn(String(config.command), Array.isArray(config.args) ? config.args.map(String) : [], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
    const tools: Listed['tools'] = [];
    let version: string | null = null;
    let buffer = '';
    const end = (error?: Error) => {
      clearTimeout(timer);
      child.kill();
      if (error) fail(error);
      else done({ version, tools });
    };
    const timer = setTimeout(() => end(Error('no tool list within 10 s')), LIST_MS);
    const send = (m: Obj) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    child.on('error', end);
    child.stdin.on('error', () => undefined);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        let m: unknown;
        try { m = JSON.parse(buffer.slice(0, at)); } catch { /* not a message */ }
        buffer = buffer.slice(at + 1);
        if (!isObj(m) || !isObj(m.result)) {
          if (isObj(m) && m.error !== undefined) end(Error(`the server refused ${m.id === 1 ? 'initialize' : 'tools/list'}`));
          continue;
        }
        if (m.id === 1) {
          const info = isObj(m.result.serverInfo) ? m.result.serverInfo : {};
          version = typeof info.version === 'string' && info.version ? info.version : null;
          send({ method: 'notifications/initialized' });
          send({ id: 2, method: 'tools/list', params: {} });
        } else if (typeof m.id === 'number' && m.id >= 2) {
          for (const t of Array.isArray(m.result.tools) ? m.result.tools : []) {
            if (!isObj(t) || typeof t.name !== 'string' || !t.name) continue;
            tools.push({ name: t.name, digest: sha256Hex(canonicalize((t.inputSchema ?? null) as JsonValue)), hints: isObj(t.annotations) ? t.annotations : {} });
          }
          if (typeof m.result.nextCursor === 'string' && m.id < 50) send({ id: m.id + 1, method: 'tools/list', params: { cursor: m.result.nextCursor } });
          else end();
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'deepbuild', version: '0' } } });
  });
}
