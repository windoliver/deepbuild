// What an MCP call counts as (#18; design: Before each command): read, change, send or destructive, and its effect
// class where it has one, from the facts file of well-known servers (adapters/mcp-servers.facts.json). A server is
// matched by its name and the source Claude Code loads it from: your local config, the repo's .mcp.json (when you
// approved it there) or your user config, in that order. A server or tool the file doesn't list counts as change.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/** The call's count class and effect class; `unknownAs` is what a server or tool the facts don't list counts as. */
export function countMcp(server: string, tool: string, cwd: string, unknownAs: Counted['counts'] = 'change'): Counted {
  const known = servers()[server];
  const source = isObj(known) ? sourceOf(server, cwd) : undefined;
  const matches = isObj(known) && source && Array.isArray(known.scopes) && known.scopes.includes(source.scope)
    && Object.entries(isObj(known.match) ? known.match : {}).every(([field, value]) => source.config[field] === value);
  const entry = matches && isObj(known.tools) ? known.tools[tool] : undefined;
  if (!isObj(entry) || typeof entry.counts !== 'string') return { counts: unknownAs };
  return { counts: entry.counts as Counted['counts'], ...(typeof entry.effect === 'string' ? { effect: entry.effect } : {}) };
}
