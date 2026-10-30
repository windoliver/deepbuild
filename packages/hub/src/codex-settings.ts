// Codex's own files (#39): `deep setup` adds DeepBuild's entries to ~/.codex/hooks.json after yours, and its MCP server
// to config.toml. Codex keeps trust per entry, by its place in the file and a hash of its command, timeout and matcher,
// so an entry of ours that is there is never written again: its command names a fixed path updates keep, and its
// timeout, set once, is never changed, or Codex asks for trust again. Health compares the file with what setup recorded
// in <root>/codex-hooks.json, and reads trust from Codex's own hook list. Identity is always the payload's, never this
// process's environment: the shared daemon keeps the environment of the terminal that started it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { strictObject, target, writeThrough } from './agent-files.js';
import { HOLD_MARGIN_MS, readJson, words } from './claude-settings.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Codex's Stop hook timeout, set once at setup: its default is 600 s, with no ceiling. */
export const STOP_TIMEOUT_S = 45 * 60;
/** What Codex gives an MCP server's tool call unless `tool_timeout_sec` says otherwise. */
const TOOL_TIMEOUT_S = 60;
/** The slow lane's expected time unless `lanes.slow.expected_ms` in config.json says otherwise. */
const SLOW_LANE_MS = 20 * 60_000;
/** The MCP server's name in config.toml: its tools reach PreToolUse as `mcp__deep__<tool>`. */
export const MCP_SERVER = 'deep';
export const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd'];

const home = (): string => process.env.CODEX_HOME || join(homedir(), '.codex');
/** Whether Codex has a home here: setup leaves a machine without one alone. */
export const hasCodex = (): boolean => existsSync(home());
export const codexHooks = (): string => join(home(), 'hooks.json');
export const codexConfig = (): string => join(home(), 'config.toml');
const recordFile = (root: string): string => join(root, 'codex-hooks.json');
const q = (path: string): string => `'${path.replaceAll("'", `'\\''`)}'`;

/** The path our entries name, which every update keeps: a link in the root that setup points at the built deep-hook. */
export function fixedHook(root: string, built: string): string {
  const link = join(root, 'bin', 'deep-hook');
  mkdirSync(dirname(link), { recursive: true });
  const next = `${link}.${process.pid}.tmp`;
  rmSync(next, { force: true });
  symlinkSync(built, next);
  renameSync(next, link);
  return link;
}

type Group = { hooks: Obj[] };
function ourGroups(hook: string): Record<string, Group> {
  return Object.fromEntries(HOOKS.map((event) => [event, { hooks: [{ type: 'command', command: `${q(hook)} codex ${event}`, ...(event === 'Stop' ? { timeout: STOP_TIMEOUT_S } : {}) }] }]));
}
const present = (groups: unknown, command: string): boolean => Array.isArray(groups) && groups.some((g) => isObj(g) && Array.isArray(g.hooks) && g.hooks.some((h) => isObj(h) && h.command === command));

/**
 * `file`'s bytes with our entries added after yours, or the same bytes when each is there already: an entry that is
 * there, timeout and all, stays as it is, so a second setup or an update leaves the file and Codex's trust alone.
 */
export function withEntries(root: string, text: string, hook: string): string {
  const parsed = text.trim() ? strictObject(text) : { value: {} };
  if ('refused' in parsed) throw Error(`${codexHooks()} ${parsed.refused}`);
  const groups = ourGroups(hook);
  const hooks: Obj = isObj(parsed.value.hooks) ? { ...parsed.value.hooks } : {};
  let changed = false;
  for (const [event, group] of Object.entries(groups)) {
    if (present(hooks[event], String(group.hooks[0]!.command))) continue;
    hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] as unknown[] : []), group];
    changed = true;
  }
  writeThrough(recordFile(root), `${JSON.stringify({ hooks: groups }, null, 2)}\n`);
  return changed ? `${JSON.stringify({ ...parsed.value, hooks }, null, 2)}\n` : text;
}
/** `text` with our entries taken out, for undo after you edited the file. */
export function withoutEntries(root: string, text: string): string {
  const parsed = strictObject(text);
  if ('refused' in parsed) throw Error(`${codexHooks()} ${parsed.refused}`);
  const ours = new Set(recorded(root).map((e) => e.command));
  const hooks: Obj = {};
  for (const [event, groups] of Object.entries(isObj(parsed.value.hooks) ? parsed.value.hooks : {})) {
    const kept = (Array.isArray(groups) ? groups : []).flatMap((g) => {
      if (!isObj(g) || !Array.isArray(g.hooks)) return [g];
      const left = g.hooks.filter((h) => !(isObj(h) && ours.has(String(h.command))));
      return left.length ? [{ ...g, hooks: left }] : [];
    });
    if (kept.length) hooks[event] = kept;
  }
  return `${JSON.stringify({ ...parsed.value, hooks }, null, 2)}\n`;
}
interface Ours { event: string; command: string; entry: Obj }
function recorded(root: string): Ours[] {
  const record = readJson(recordFile(root));
  if (!record || !isObj(record.hooks)) return [];
  return Object.entries(record.hooks).flatMap(([event, g]) => ((g as Group).hooks ?? []).map((entry) => ({ event, command: String(entry.command), entry })));
}

// ---- config.toml: read as far as DeepBuild needs it, by table; a repeated key or table refuses the file.

export type Tables = Map<string, Map<string, string>>;
/** The tables of a TOML text, each key's raw value, or why it won't do. A multi-line value's lines are skipped. */
export function tomlTables(text: string): { tables: Tables } | { refused: string } {
  const tables: Tables = new Map([['', new Map()]]);
  let table = tables.get('')!;
  let open = 0;
  let quote: string | undefined;
  for (const [n, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (quote) { if (line.includes(quote)) quote = undefined; continue; }
    if (open > 0) { open += (line.match(/\[/g)?.length ?? 0) - (line.match(/\]/g)?.length ?? 0); continue; }
    if (!line || line.startsWith('#')) continue;
    const head = /^\[([^[\]]+)\]\s*(#.*)?$/.exec(line);
    if (head) {
      const name = head[1]!.trim();
      if (tables.has(name)) return { refused: `repeats the table [${name}] on line ${n + 1}` };
      tables.set(name, table = new Map());
      continue;
    }
    if (/^\[\[.*\]\]/.test(line)) { table = new Map(); continue; }
    const pair = /^("[^"]*"|'[^']*'|[\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!pair) return { refused: `has a line that isn't TOML, line ${n + 1}` };
    if (table.has(pair[1]!)) return { refused: `repeats the key ${pair[1]} on line ${n + 1}` };
    const value = pair[2]!.replace(/\s+#.*$/, '').trim();
    table.set(pair[1]!, value);
    const triple = /^("""|''')/.exec(value)?.[1];
    if (triple && !value.slice(3).includes(triple)) quote = triple;
    else if (value.startsWith('[') || value.startsWith('{')) open = Math.max(0, (value.match(/[[{]/g)?.length ?? 0) - (value.match(/[\]}]/g)?.length ?? 0));
  }
  return { tables };
}
const configTables = (): Tables | undefined => {
  try {
    const read = tomlTables(readFileSync(target(codexConfig()), 'utf8'));
    return 'tables' in read ? read.tables : undefined;
  } catch { return undefined; }
};
/** `text` with our MCP server added at its end, or the same bytes once a server of that name is there. */
export function withServer(text: string, node: string, cli: string): string {
  const read = tomlTables(text);
  if ('refused' in read) throw Error(`${codexConfig()} ${read.refused}`);
  if (read.tables.has(`mcp_servers.${MCP_SERVER}`)) return text;
  const lead = text && !text.endsWith('\n') ? '\n' : '';
  return `${text}${lead}${text ? '\n' : ''}[mcp_servers.${MCP_SERVER}]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify([cli, 'mcp'])}\n`;
}
/** `text` with the server block setup added taken out. */
export const withoutServer = (text: string, node: string, cli: string): string => text.replace(`[mcp_servers.${MCP_SERVER}]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify([cli, 'mcp'])}\n`, '');
/** Your `hooks = false` under [features], which setup never flips. */
export const hooksDisabled = (): boolean => configTables()?.get('features')?.get('hooks') === 'false';
/** The `tool_timeout_sec` Codex gives DeepBuild's MCP server, in seconds. */
export function toolTimeoutS(): number {
  const set = configTables()?.get(`mcp_servers.${MCP_SERVER}`)?.get('tool_timeout_sec');
  return set !== undefined && /^\d+(\.\d+)?$/.test(set) ? Number(set) : TOOL_TIMEOUT_S;
}

// ---- Health: what the file holds against what setup wrote, and the timing relations (design: Numbers, timing relations).

const entriesFor = (event: string): Obj[] => {
  const hooks = existsSync(codexHooks()) ? readJson(codexHooks())?.hooks : undefined;
  const groups = isObj(hooks) && Array.isArray(hooks[event]) ? hooks[event] as unknown[] : [];
  return groups.flatMap((g) => (isObj(g) && Array.isArray(g.hooks) ? g.hooks.filter(isObj) : []));
};
/** Whether setup has written Codex's entries in this root. */
export const installedCodex = (root: string): boolean => recorded(root).length > 0;
/** Each entry of ours the file no longer holds as setup wrote it: named, with `removed` or `modified`. */
export function modified(root: string): string[] {
  return recorded(root).flatMap(({ event, command, entry }) => {
    const found = entriesFor(event).find((h) => h.command === command);
    if (!found) return [`Codex's ${event} entry was removed from ${codexHooks()}, so that hook doesn't reach the hub`];
    return JSON.stringify(found) === JSON.stringify(entry) ? [] : [`Codex's ${event} entry was modified in ${codexHooks()}: it isn't what setup wrote, so Codex asks for trust again and holds may not fit`];
  });
}
/** The Stop entry's timeout as the file holds it, in seconds; undefined before setup. */
export function stopTimeoutS(root: string): number | undefined {
  const stop = recorded(root).find((e) => e.event === 'Stop');
  if (!stop) return undefined;
  const found = entriesFor('Stop').find((h) => h.command === stop.command);
  if (!found) return undefined;
  // Codex's own default where an entry sets none.
  return typeof found.timeout === 'number' ? found.timeout : 600;
}
const slowLaneMs = (root: string): number => {
  const lanes = readJson(join(root, 'config.json'))?.lanes;
  const slow = isObj(lanes) && isObj(lanes.slow) ? lanes.slow.expected_ms : undefined;
  return typeof slow === 'number' && slow > 0 ? slow : SLOW_LANE_MS;
};
/** Whether a stop can be held for a check whose deadline is `deadlineMs`: it must end at least 5 s before the timeout. */
export const holdsFor = (deadlineMs: number, timeoutS: number): boolean => deadlineMs + HOLD_MARGIN_MS <= timeoutS * 1000;

export interface CodexRelation { name: 'slow lane' | 'deep_ask'; holds: boolean; text: string; waitMs: number }
export function codexRelations(root: string): CodexRelation[] {
  if (!installedCodex(root)) return [];
  const out: CodexRelation[] = [];
  const timeoutS = stopTimeoutS(root);
  if (timeoutS !== undefined) {
    const slow = slowLaneMs(root);
    const set = words(STOP_TIMEOUT_S * 1000);
    out.push(holdsFor(slow, timeoutS)
      ? { name: 'slow lane', holds: true, waitMs: 0, text: `slow lane holds: its expected ${words(slow)} ends at least 5 s before Codex's Stop hook timeout, ${words(timeoutS * 1000)}` }
      : { name: 'slow lane', holds: false, waitMs: 0, text: `slow lane broken: its expected ${words(slow)} must end at least 5 s before Codex's Stop hook timeout, which is ${timeoutS} s where setup set ${set}, so a stop with a slow check isn't held and its verdict comes with your next message; put the Stop entry's timeout back in ${codexHooks()}` });
  }
  const toolS = toolTimeoutS();
  const waitMs = toolS * 1000 - HOLD_MARGIN_MS;
  // Under 10 s leaves too little to wait in: deep_ask returns at once, and the agent waits with deep_wait.
  out.push(toolS >= 10
    ? { name: 'deep_ask', holds: true, waitMs, text: `deep_ask holds: it says still waiting at ${waitMs / 1000} s, 5 s before the tool_timeout_sec Codex gives DeepBuild's MCP server, ${toolS} s` }
    : { name: 'deep_ask', holds: false, waitMs: 0, text: `deep_ask broken: the tool_timeout_sec Codex gives DeepBuild's MCP server is ${toolS} s, too short to wait in, so deep_ask returns at once with the ask's ID, deadline and default and the agent waits with deep_wait; set it to at least 10 under [mcp_servers.${MCP_SERVER}] in ${codexConfig()}` });
  return out;
}

export interface Listed { command: string; eventName: string; trustStatus: string; enabled: boolean }
/** Codex's own hook list, from `codex app-server`'s hooks/list; undefined when it gives none in time. */
export function hookList(codex: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 10_000): Promise<Listed[] | undefined> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(codex, ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return resolve(undefined); }
    const done = (value: Listed[] | undefined) => { clearTimeout(timer); child.kill(); resolve(value); };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    let buffer = '';
    child.on('error', () => done(undefined));
    child.stdin!.on('error', () => undefined);
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        let reply: Obj;
        try { reply = JSON.parse(line) as Obj; } catch { continue; }
        if (reply.id === 1) child.stdin!.write(`${JSON.stringify({ method: 'initialized' })}\n${JSON.stringify({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } })}\n`);
        else if (reply.id === 2) {
          const data = isObj(reply.result) && Array.isArray(reply.result.data) ? reply.result.data as Obj[] : undefined;
          done(data?.flatMap((d) => (Array.isArray(d.hooks) ? d.hooks as Listed[] : [])));
        }
      }
    });
    child.stdin!.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'deepbuild', version: '0' }, capabilities: { experimentalApi: true } } })}\n`);
  });
}
