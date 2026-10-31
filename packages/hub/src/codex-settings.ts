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
export function withEntries(text: string, hook: string): string {
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
  return changed ? `${JSON.stringify({ ...parsed.value, hooks }, null, 2)}\n` : text;
}
/** Keeps what setup wrote, and in which home: the hub and doctor read this home whatever their own environment says. */
export function recordEntries(root: string, hook: string, server: { node: string; cli: string }): void {
  writeThrough(recordFile(root), `${JSON.stringify({ hooks: ourGroups(hook), home: home(), server }, null, 2)}\n`);
}
/** What setup kept for Codex, gone at undo. */
export function forgetEntries(root: string): void {
  for (const file of [recordFile(root), trustFile(root), join(root, 'bin', 'deep-hook')]) rmSync(file, { force: true });
}
/** Where a session's rollouts may sit: the default home, and the one setup wrote in. */
export function sessionHomes(root: string): string[] {
  const set = readJson(recordFile(root))?.home;
  return [...new Set([join(homedir(), '.codex'), ...(typeof set === 'string' && set ? [set] : [])])].map((h) => join(h, 'sessions'));
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

// ---- config.toml: read as far as DeepBuild needs it, by table; what TOML itself refuses refuses the file.

export type Tables = Map<string, Map<string, string>>;
/** Where the string starting at `i` ends, one past its closing quote; -1 if it never closes. */
function stringEnd(s: string, i: number): number {
  const quote = s[i]!;
  const triple = quote.repeat(3);
  const long = s.startsWith(triple, i);
  for (let at = i + (long ? 3 : 1); at < s.length; at++) {
    if (quote === '"' && s[at] === '\\') { at++; continue; }
    if (!long && s[at] === '\n') return -1;
    if (long ? s.startsWith(triple, at) : s[at] === quote) {
      if (!long) return at + 1;
      // A closing run may hold up to two more quotes of the string's own.
      let end = at + 3;
      while (s[end] === quote && end < at + 5) end++;
      return end;
    }
  }
  return -1;
}
/** Where the value starting at `i` ends: a line's end or comment at the top; a comma or closing brace inside an inline table. -1 if a string or bracket never closes. */
function valueEnd(s: string, i: number, inline: boolean): number {
  let depth = 0;
  for (let at = i; at < s.length; at++) {
    const c = s[at]!;
    if (c === '"' || c === "'") { at = stringEnd(s, at) - 1; if (at < 0) return -1; continue; }
    if (c === '#') {
      if (depth === 0) return at;
      while (at < s.length && s[at] !== '\n') at++;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { if (depth === 0) return at; depth--; }
    else if (depth === 0 && (c === '\n' || (inline && c === ','))) return at;
  }
  return depth === 0 ? s.length : -1;
}
const blanks = (s: string, i: number): number => { while (s[i] === ' ' || s[i] === '\t' || s[i] === '\r') i++; return i; };
/** A dotted key at `i`, its parts unquoted, and where it ends. */
function keyAt(s: string, i: number): { parts: string[]; end: number } | undefined {
  const parts: string[] = [];
  for (let at = blanks(s, i); ; at = blanks(s, at + 1)) {
    let end: number;
    if (s[at] === '"' || s[at] === "'") {
      if (s.startsWith(s[at]!.repeat(3), at)) return undefined;
      end = stringEnd(s, at);
      if (end < 0) return undefined;
      const raw = s.slice(at, end);
      try { parts.push(raw[0] === '"' ? JSON.parse(raw) as string : raw.slice(1, -1)); } catch { parts.push(raw.slice(1, -1)); }
    } else {
      end = at;
      while (end < s.length && /[\w-]/.test(s[end]!)) end++;
      if (end === at) return undefined;
      parts.push(s.slice(at, end));
    }
    at = blanks(s, end);
    if (s[at] !== '.') return { parts, end: at };
  }
}
/** The tables of a TOML text, each key's raw value, or why it won't do. Tables under an array of tables aren't kept: DeepBuild reads none. */
export function tomlTables(text: string): { tables: Tables } | { refused: string } {
  const tables: Tables = new Map([['', new Map()]]);
  const declared = new Set<string>();
  const arrays = new Set<string>();
  const lineAt = (i: number): number => text.slice(0, i).split('\n').length;
  const notToml = (i: number) => ({ refused: `has a line that isn't TOML, line ${lineAt(i)}` });
  const inside = (name: string): boolean => [...arrays].some((a) => name === a || name.startsWith(`${a}.`));
  const tableOf = (name: string): Map<string, string> => { let t = tables.get(name); if (!t) tables.set(name, t = new Map()); return t; };
  /** Puts `parts = raw` under `prefix`; an inline table's keys go under its own name. */
  const put = (prefix: string[], parts: string[], raw: string, scratch: Map<string, string> | undefined, i: number): { refused: string } | undefined => {
    const key = parts.at(-1)!;
    const name = [...prefix, ...parts.slice(0, -1)].join('.');
    const into = scratch ?? tableOf(name);
    const shown = scratch ? parts.join('.') : key;
    if (into.has(shown)) return { refused: `repeats the key ${shown} on line ${lineAt(i)}` };
    into.set(shown, raw);
    if (scratch || !raw.startsWith('{')) return undefined;
    const body = raw.slice(1, -1);
    const under = [...prefix, ...parts];
    tableOf(under.join('.'));
    for (let at = blanks(body, 0); at < body.length; at = blanks(body, at + 1)) {
      if (body[at] === '\n') continue;
      const inner = keyAt(body, at);
      if (!inner || body[inner.end] !== '=') return notToml(i);
      const from = blanks(body, inner.end + 1);
      const end = valueEnd(body, from, true);
      if (end < 0) return notToml(i);
      const bad = put(under, inner.parts, body.slice(from, end).trim(), undefined, i);
      if (bad) return bad;
      at = blanks(body, end);
      if (at < body.length && body[at] !== ',') return notToml(i);
    }
    return undefined;
  };
  let prefix: string[] = [];
  let scratch: Map<string, string> | undefined;
  for (let i = 0; i < text.length;) {
    i = blanks(text, i);
    if (i >= text.length) break;
    if (text[i] === '\n') { i++; continue; }
    if (text[i] === '#') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl + 1; continue; }
    let end: number;
    if (text[i] === '[') {
      const many = text[i + 1] === '[';
      const head = keyAt(text, i + (many ? 2 : 1));
      if (!head || !text.startsWith(many ? ']]' : ']', head.end)) return notToml(i);
      const name = head.parts.join('.');
      end = head.end + (many ? 2 : 1);
      if (many) {
        if (declared.has(name)) return { refused: `repeats the table [${name}] on line ${lineAt(i)}` };
        arrays.add(name);
        scratch = new Map();
      } else if (inside(name)) scratch = new Map();
      else {
        if (declared.has(name)) return { refused: `repeats the table [${name}] on line ${lineAt(i)}` };
        declared.add(name);
        tableOf(name);
        scratch = undefined;
      }
      prefix = head.parts;
    } else {
      const key = keyAt(text, i);
      if (!key || text[key.end] !== '=') return notToml(i);
      const from = blanks(text, key.end + 1);
      end = valueEnd(text, from, false);
      if (end < 0) return notToml(i);
      const raw = text.slice(from, end).trim();
      if (!raw) return notToml(i);
      const bad = put(prefix, key.parts, raw, scratch, i);
      if (bad) return bad;
    }
    i = blanks(text, end);
    if (i < text.length && text[i] !== '\n' && text[i] !== '#') return notToml(i);
    if (text[i] === '#') { const nl = text.indexOf('\n', i); i = nl < 0 ? text.length : nl; }
  }
  return { tables };
}
const configTables = (file = codexConfig()): Tables | undefined => {
  try {
    const read = tomlTables(readFileSync(target(file), 'utf8'));
    return 'tables' in read ? read.tables : undefined;
  } catch { return undefined; }
};
/** `text` with our MCP server added at its end, or the same bytes once a server of that name is there. */
export function withServer(text: string, node: string, cli: string): string {
  const read = tomlTables(text);
  if ('refused' in read) throw Error(`${codexConfig()} ${read.refused}`);
  if (read.tables.has(`mcp_servers.${MCP_SERVER}`)) return text;
  const lead = text && !text.endsWith('\n') ? '\n' : '';
  return `${text}${lead}${text ? '\n' : ''}[mcp_servers.${MCP_SERVER}]\ncommand = ${JSON.stringify(node)}\nargs = ${JSON.stringify([cli, 'mcp'])}\ndefault_tools_approval_mode = "approve"\n`;
}
/** `text` with the server's table taken out, from its header to the next not under it, your additions too, when its command and args are what setup wrote. */
export function withoutServer(text: string, node: string, cli: string): string {
  const header = `[mcp_servers.${MCP_SERVER}]\n`;
  const start = text.startsWith(header) ? 0 : text.indexOf(`\n${header}`) + 1;
  if (start === 0 && !text.startsWith(header)) return text;
  const after = start + header.length;
  const rest = new RegExp(`^[ \\t]*\\[(?!mcp_servers\\.${MCP_SERVER}\\.)`, 'm').exec(text.slice(after));
  const table = text.slice(after, rest ? after + rest.index : undefined).split('\n');
  if (!table.includes(`command = ${JSON.stringify(node)}`) || !table.includes(`args = ${JSON.stringify([cli, 'mcp'])}`)) return text;
  return text.slice(0, start) + (rest ? text.slice(after + rest.index) : '');
}
/** The server setup recorded, for undo; undefined where it recorded none. */
export function recordedServer(root: string): { node: string; cli: string } | undefined {
  const set = readJson(recordFile(root))?.server;
  return isObj(set) && typeof set.node === 'string' && typeof set.cli === 'string' ? { node: set.node, cli: set.cli } : undefined;
}
/** Your `hooks = false` under [features], which setup never flips. */
export const hooksDisabled = (root: string): boolean => configTables(join(recordedHome(root), 'config.toml'))?.get('features')?.get('hooks') === 'false';
/** The `tool_timeout_sec` Codex gives DeepBuild's MCP server, in seconds. */
export function toolTimeoutS(file = codexConfig()): number {
  const set = configTables(file)?.get(`mcp_servers.${MCP_SERVER}`)?.get('tool_timeout_sec');
  return set !== undefined && /^\d+(\.\d+)?$/.test(set) ? Number(set) : TOOL_TIMEOUT_S;
}

// ---- Health: what the file holds against what setup wrote, and the timing relations (design: Numbers, timing relations).

/** The home setup wrote in, whatever this process's environment says; before setup, this environment's. */
export const recordedHome = (root: string): string => { const set = readJson(recordFile(root))?.home; return typeof set === 'string' && set ? set : home(); };
const entriesFor = (root: string, event: string): Obj[] => {
  const file = join(recordedHome(root), 'hooks.json');
  const hooks = existsSync(file) ? readJson(file)?.hooks : undefined;
  const groups = isObj(hooks) && Array.isArray(hooks[event]) ? hooks[event] as unknown[] : [];
  return groups.flatMap((g) => (isObj(g) && Array.isArray(g.hooks) ? g.hooks.filter(isObj) : []));
};
/** Whether setup has written Codex's entries in this root. */
export const installedCodex = (root: string): boolean => recorded(root).length > 0;
/** Each entry of ours the file no longer holds as setup wrote it: named, with `removed` or `modified`. */
export function modified(root: string): string[] {
  return recorded(root).flatMap(({ event, command, entry }) => {
    const found = entriesFor(root, event).find((h) => h.command === command);
    if (!found) return [`Codex's ${event} entry was removed from ${codexHooks()}, so that hook doesn't reach the hub`];
    return JSON.stringify(found) === JSON.stringify(entry) ? [] : [`Codex's ${event} entry was modified in ${codexHooks()}: it isn't what setup wrote, so Codex asks for trust again and holds may not fit`];
  });
}
/** The Stop entry's timeout as the file holds it, in seconds; undefined before setup. */
export function stopTimeoutS(root: string): number | undefined {
  const stop = recorded(root).find((e) => e.event === 'Stop');
  if (!stop) return undefined;
  const found = entriesFor(root, 'Stop').find((h) => h.command === stop.command);
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
  const toolS = toolTimeoutS(join(recordedHome(root), 'config.toml'));
  const waitMs = toolS * 1000 - HOLD_MARGIN_MS;
  // Under 10 s leaves too little to wait in: deep_ask returns at once, and the agent waits with deep_wait.
  out.push(toolS >= 10
    ? { name: 'deep_ask', holds: true, waitMs, text: `deep_ask holds: it says still waiting at ${waitMs / 1000} s, 5 s before the tool_timeout_sec Codex gives DeepBuild's MCP server, ${toolS} s` }
    : { name: 'deep_ask', holds: false, waitMs: 0, text: `deep_ask broken: the tool_timeout_sec Codex gives DeepBuild's MCP server is ${toolS} s, too short to wait in, so deep_ask returns at once with the ask's ID, deadline and default and the agent waits with deep_wait; set it to at least 10 under [mcp_servers.${MCP_SERVER}] in ${codexConfig()}` });
  return out;
}

export interface Listed { command: string; eventName: string; trustStatus: string; enabled: boolean }
/** Where the hub keeps DeepBuild's entries as Codex's hook list last reported them. */
const trustFile = (root: string): string => join(root, 'codex-trust.json');
/** Reads Codex's hook list and keeps DeepBuild's entries of it, for health and doctor; a list it can't get changes nothing. */
export async function saveTrust(root: string, codex: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const listed = await hookList(codex, cwd, env);
  if (listed) writeThrough(trustFile(root), `${JSON.stringify(listed.filter((h) => /deep-hook'? codex /.test(String(h.command))))}\n`);
}
export const readTrust = (root: string): Listed[] | undefined => {
  let kept: unknown;
  try { kept = JSON.parse(readFileSync(trustFile(root), 'utf8')); } catch { return undefined; }
  return Array.isArray(kept) ? (kept as Listed[]) : undefined;
};
/** Each of DeepBuild's entries Codex's hook list doesn't report as running: untrusted, disabled, or not on the list. Empty when the list was never read. */
export function trustProblems(root: string): string[] {
  const listed = readTrust(root);
  if (!listed) return [];
  const missing = recorded(root).filter((e) => !listed.some((h) => h.command === e.command)).map((e) => `${e.event} missing from the list`);
  return [...listed.flatMap((h) => [...(h.trustStatus === 'trusted' ? [] : [`${h.eventName} ${h.trustStatus}`]), ...(h.enabled === false ? [`${h.eventName} disabled`] : [])]), ...missing];
}
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
