// The Agents page's syncs (#148; design: How it installs, Editing agent settings): an MCP server or a skill added once
// and written into each agent you choose, in that agent's own format, at user level and never into a repo. Each sync is
// a proposal you approve, shown as a diff per file. Every target file is planned in memory first, and one that won't
// parse refuses the whole sync before anything is written; each entry is checked against its agent's rules in its facts
// (adapters/<agent>.facts.json, `entries`) before the plan shows, and one the agent can't express is refused for that
// agent, naming the field. Applying it records its intent first, a crash journal of each file's digest before, its
// planned digest and its staged bytes; just before each replace the file is read again and planned again on the new
// bytes if it changed; each replace is a rename followed by a flush of its folder. Recovery reads the journal at the
// hub's start and before each sync: it drops a sync that replaced nothing, finishes one that had started, and never
// writes over a file someone changed since, which goes into conflict for a new decision. Before the first write to any
// agent file its original bytes are kept once, by hash, in setup's record, so undo and `deep setup --undo` restore them.
// A server's secrets stay in the platform's secret store: the agent's entry runs `deep mcp-exec <name>`, which takes
// them by handle over the socket. A server's scope is enforced on its calls (`scopeDenial`); a skill is pinned to its
// source and audited at each install and update. Whether a running session loaded the new set is read from that
// session's own evidence: a session started before a sync gets a reading saying it runs the older set.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFacts } from '@deepbuild/adapters';
import { keychainStore, type SecretStore } from '@deepbuild/extension-host';
import { CANT_UNDO } from '@deepbuild/asks';
import { ulid } from '@deepbuild/record';
import { keepOriginal, noteWritten, saveRecord, setupRecord, strictObject, target } from './agent-files.js';
import { tomlTables } from './codex-settings.js';
import { ownHome } from './keychain.js';
import { lastingNode } from './paths.js';
import type { Plant } from './plant.js';
import { syncPath, type Durable } from './vfs.js';
import { refuse } from './wire.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const canonical = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
/** The agents a sync knows, by their facts files' names. */
const AGENT_IDS = ['claude-code', 'codex', 'pi', 'opencode', 'cursor'] as const;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** The deep command's script beside this package, whatever thread the core runs in. */
const DEEP_CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
/** How often a file that keeps changing under a replace is planned again before it goes into conflict. */
const REPLANS = 3;

// ---- Each agent's rules, from its facts.

interface Transport { type?: string; fields: string[]; names?: Record<string, string>; commandArray?: boolean }
interface AgentFacts {
  id: string; name: string; binary: string; versions: string[]; home?: string;
  mcp?: { file: string; format: 'json' | 'toml'; key: string; perProject?: string; transports: Record<'stdio' | 'http', Transport>; refused: { transport: string; field: string; reason?: string }[] };
  skills?: { write: string; readFrom: string[] };
  daemon?: { restart?: string[]; picksUp?: Record<string, Obj> };
}
let factsCache: AgentFacts[] | undefined;
function agentFacts(): AgentFacts[] {
  return (factsCache ??= AGENT_IDS.flatMap((id) => {
    let f: Obj;
    try { f = readFacts<Obj>(`${id}.facts.json`); } catch { return []; }
    const e = isObj(f.entries) ? f.entries : {};
    const out: AgentFacts = { id, name: typeof e.name === 'string' ? e.name : id, binary: String(f.agent), versions: (f.versions ?? []) as string[] };
    if (typeof e.home === 'string') out.home = e.home;
    if (isObj(e.mcp)) out.mcp = e.mcp as unknown as NonNullable<AgentFacts['mcp']>;
    if (isObj(e.skills)) out.skills = e.skills as unknown as NonNullable<AgentFacts['skills']>;
    if (isObj(f.daemon)) out.daemon = f.daemon as NonNullable<AgentFacts['daemon']>;
    return [out];
  }));
}
const factsOf = (id: string): AgentFacts | undefined => agentFacts().find((a) => a.id === id);
const expand = (p: string): string => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
/** A path as you'd read it: under your home as ~/... */
const shownPath = (p: string): string => (p.startsWith(`${homedir()}/`) ? `~/${relative(homedir(), p)}` : p);

// ---- What a sync adds.

interface ServerSpec { name: string; transport: 'stdio' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; secrets?: string[]; scope?: { repos: string[] } }
interface SkillFile { rel: string; mode: number; sha: string }
interface SkillItem { name: string; repo: string; commit: string; path: string; digest: string; files: SkillFile[]; license: string; scripts: string[]; findings: string[] }
type Item = { kind: 'server'; server: ServerSpec } | { kind: 'skill'; skill: SkillItem };
const itemName = (i: Item): string => (i.kind === 'server' ? i.server.name : i.skill.name);

/** One entry a config target holds for one agent. */
interface Entry { agent: string; name: string; value: unknown; project?: string }
interface Target {
  path: string; agents: string[]; before: string | null; after: string; diff: string;
  /** A config file: its format, the key it keeps servers under, and the entries this sync puts there. */
  config?: { format: 'json' | 'toml'; key: string; perProject?: string; entries: Entry[] };
  /** A skill's file: its bytes' digest (kept in the sync's staged folder) and mode. */
  file?: { sha: string; mode: number };
  status: string;
}
export interface Sync {
  id: string; created: number; via: string; item: Item; agents: string[]; targets: Target[];
  refused: { agent: string; field: string; reason: string }[];
  ask: string; status: 'proposed' | 'applying' | 'complete' | 'refused' | 'conflict' | 'dropped' | 'declined' | 'undone';
  reason?: string; completed?: number; created_dirs?: string[];
}

interface AgentsOptions {
  root: string;
  plant: Plant | undefined;
  durable: Durable;
  now(): number;
  /** The values the hub holds: every text it keeps is scrubbed of them. */
  held: string[];
  /** Raises an ask as the core; its handle. */
  raise(source: string, ask: Obj, plan?: { steps: { does: string; changes: string[]; undo: string | null; public: boolean; cost: number }[]; diff: string }): Promise<string>;
  /** Appends agents.synced@1 as the core. */
  synced(data: Obj): Promise<void>;
  /** The record's agents.synced@1 data, oldest first: the wanted set a restore plans again. */
  wanted(): Promise<Obj[]>;
  /** The live sessions, by agent, with their process. */
  sessions(): { id: string; agent: string; pid: number; start: string }[];
  /** Readings for the sessions a sync landed after (core.ts: older). */
  older(sync: Sync): Promise<void>;
}

// ---- Files.

const read = (path: string): Buffer | null => { try { return readFileSync(target(path)); } catch { return null; } };
const digestOf = (bytes: Buffer | null): string | null => (bytes === null ? null : sha(bytes));
function writeSyncedFile(path: string, bytes: Buffer | string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, bytes, { mode });
  syncPath(tmp);
  renameSync(tmp, path);
  syncPath(dirname(path));
}
/** A line diff of one file: what goes and what comes, between the lines both keep. */
function lineDiff(path: string, before: Buffer | null, after: Buffer): string {
  const a = before === null ? [] : before.toString('utf8').split('\n');
  const b = after.toString('utf8').split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const out = [`--- ${before === null ? '/dev/null' : shownPath(path)}`, `+++ ${shownPath(path)}`, `@@ -${s + 1} +${s + 1} @@`];
  for (const l of a.slice(s, a.length - e)) out.push(`-${l}`);
  for (const l of b.slice(s, b.length - e)) out.push(`+${l}`);
  return out.join('\n').slice(0, 20_000);
}

// ---- Rendering an agent's own format.

type Rendered = { bytes: Buffer } | { refused: string } | { conflict: string };
const tomlKey = (k: string): string => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
const tomlValue = (v: unknown): string => (Array.isArray(v) ? `[${v.map(tomlValue).join(', ')}]` : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(String(v)));
/** An entry's TOML table: its scalar keys, then each object under it as a table of its own. */
function tomlBlock(key: string, name: string, value: Obj): string {
  const head = `${key}.${tomlKey(name)}`;
  const plain = Object.entries(value).filter(([, v]) => !isObj(v));
  const tables = Object.entries(value).filter(([, v]) => isObj(v)) as [string, Obj][];
  return [`[${head}]`, ...plain.map(([k, v]) => `${tomlKey(k)} = ${tomlValue(v)}`), ...tables.flatMap(([k, t]) => ['', `[${head}.${tomlKey(k)}]`, ...Object.entries(t).map(([kk, vv]) => `${tomlKey(kk)} = ${tomlValue(vv)}`)])].join('\n');
}
/** Where an entry's table starts and ends in `text`, its sub-tables included, or undefined. */
function tomlSpan(text: string, key: string, name: string): { start: number; end: number } | undefined {
  const head = `${key}.${tomlKey(name)}`;
  const lines = text.split('\n');
  let at = 0;
  let start = -1;
  let end = text.length;
  for (const l of lines) {
    const t = l.trim();
    if (start < 0 && t === `[${head}]`) start = at;
    else if (start >= 0 && t.startsWith('[') && !t.startsWith(`[${head}.`)) { end = at; break; }
    at += l.length + 1;
  }
  return start < 0 ? undefined : { start, end: Math.min(end, text.length) };
}
const tomlEntryTables = (text: string, key: string, name: string): string | undefined => {
  const read = tomlTables(text);
  if ('refused' in read) return undefined;
  const head = `${key}.${name}`;
  const mine = [...read.tables].filter(([t]) => t === head || t.startsWith(`${head}.`)).map(([t, m]) => [t, [...m].sort()] as const).sort();
  return mine.length ? JSON.stringify(mine) : undefined;
};
/**
 * The file's bytes with each entry in place, or why not: refused when the file isn't valid in its own format, a
 * conflict when it holds an entry of yours under a name DeepBuild's takes. `ours` says whether an entry there now is
 * the one DeepBuild last wrote, which it may replace.
 */
function render(config: NonNullable<Target['config']>, current: Buffer | null, ours: (e: Entry, now: unknown) => boolean, path: string): Rendered {
  const text = current === null ? '' : current.toString('utf8');
  if (config.format === 'json') {
    const parsed = current === null || !text.trim() ? { value: {} as Obj } : strictObject(text);
    if ('refused' in parsed) return { refused: `${shownPath(path)} ${parsed.refused}` };
    const value = structuredClone(parsed.value);
    let changed = false;
    for (const e of config.entries) {
      let at: Obj = value;
      if (e.project && config.perProject) {
        const projects = isObj(at[config.perProject]) ? at[config.perProject] as Obj : (at[config.perProject] = {}) as Obj;
        at = isObj(projects[e.project]) ? projects[e.project] as Obj : (projects[e.project] = {}) as Obj;
      }
      const servers = isObj(at[config.key]) ? at[config.key] as Obj : (at[config.key] = {}) as Obj;
      const now = servers[e.name];
      if (now !== undefined && canonical(now) === canonical(e.value)) continue;
      if (now !== undefined && !ours(e, now)) return { conflict: `${shownPath(path)} holds your own ${e.name}, which DeepBuild's entry would replace` };
      servers[e.name] = e.value;
      changed = true;
    }
    if (!changed && current !== null) return { bytes: current };
    return { bytes: Buffer.from(`${JSON.stringify(value, null, 2)}${current === null || text.endsWith('\n') ? '\n' : ''}`) };
  }
  if (text.trim()) {
    const parsed = tomlTables(text);
    if ('refused' in parsed) return { refused: `${shownPath(path)} ${parsed.refused}` };
  }
  let out = text;
  for (const e of config.entries) {
    const block = tomlBlock(config.key, e.name, e.value as Obj);
    const span = tomlSpan(out, config.key, e.name);
    if (span) {
      if (tomlEntryTables(out, config.key, e.name) === tomlEntryTables(block, config.key, e.name)) continue;
      if (!ours(e, out.slice(span.start, span.end).trimEnd())) return { conflict: `${shownPath(path)} holds your own ${e.name}, which DeepBuild's entry would replace` };
      out = `${out.slice(0, span.start)}${block}\n${out.slice(span.end).replace(/^\n?/, out.slice(span.end).startsWith('\n') ? '\n' : '')}`;
    } else {
      out = `${out}${out && !out.endsWith('\n') ? '\n' : ''}${out ? '\n' : ''}${block}\n`;
    }
  }
  const check = tomlTables(out);
  if ('refused' in check) return { refused: `${shownPath(path)} would not stay valid TOML: ${check.refused}` };
  return { bytes: Buffer.from(out) };
}
/** The file's text with this sync's entries taken out, as far as they are still as written; undefined when it can't be read. */
function withoutEntries(config: NonNullable<Target['config']>, current: Buffer): Buffer | undefined {
  const text = current.toString('utf8');
  if (config.format === 'json') {
    const parsed = strictObject(text);
    if ('refused' in parsed) return undefined;
    const value = structuredClone(parsed.value);
    for (const e of config.entries) {
      let at: Obj | undefined = value;
      if (e.project && config.perProject) at = isObj(at[config.perProject]) && isObj((at[config.perProject] as Obj)[e.project]) ? (at[config.perProject] as Obj)[e.project] as Obj : undefined;
      const servers = at && isObj(at[config.key]) ? at[config.key] as Obj : undefined;
      if (servers && canonical(servers[e.name]) === canonical(e.value)) delete servers[e.name];
    }
    return Buffer.from(`${JSON.stringify(value, null, 2)}${text.endsWith('\n') ? '\n' : ''}`);
  }
  let out = text;
  for (const e of config.entries) {
    const span = tomlSpan(out, config.key, e.name);
    if (!span || tomlEntryTables(out, config.key, e.name) !== tomlEntryTables(tomlBlock(config.key, e.name, e.value as Obj), config.key, e.name)) continue;
    const head = out.slice(0, span.start).replace(/\n\n$/, '\n');
    out = `${head}${out.slice(span.end).replace(/^\n/, '')}`;
  }
  return Buffer.from(out);
}

// ---- An entry in each agent's own words.

/** The fields a spec carries, by our names. */
function fieldsOf(s: ServerSpec): string[] {
  const out: string[] = [];
  if (s.command) out.push('command');
  if (s.args?.length) out.push('args');
  if (s.env && Object.keys(s.env).length) out.push('env');
  if (s.url) out.push('url');
  if (s.headers && Object.keys(s.headers).length) out.push('headers');
  return out;
}
/** Whether `agent` can express `spec`; the field and why when it can't. */
function refusedField(agent: AgentFacts, s: ServerSpec): { field: string; reason: string } | undefined {
  const mcp = agent.mcp;
  if (!mcp) return { field: 'mcp', reason: `${agent.name}'s facts name no file it reads MCP servers from` };
  for (const field of fieldsOf(s)) {
    const r = mcp.refused.find((x) => x.transport === s.transport && x.field === field);
    if (r) return { field, reason: r.reason ?? `${agent.name} refuses ${field} on a ${s.transport} server` };
  }
  if (s.transport === 'http' && s.secrets?.length) return { field: 'secrets', reason: `an HTTP server's secret goes through a loopback proxy that adds its header, which ${agent.name}'s entry can't reach yet` };
  return undefined;
}
/** The command an agent's entry runs: the spec's own, or `deep mcp-exec <name>` when it takes secrets by handle. */
function launched(s: ServerSpec): { command: string; args: string[] } {
  if (s.secrets?.length) return { command: lastingNode(), args: [DEEP_CLI, 'mcp-exec', s.name] };
  return { command: s.command!, args: s.args ?? [] };
}
function entryFor(agent: AgentFacts, s: ServerSpec): Obj {
  const t = agent.mcp!.transports[s.transport];
  const named = (field: string): string => t.names?.[field] ?? field;
  const out: Obj = {};
  if (t.type) out.type = t.type;
  if (s.transport === 'stdio') {
    const { command, args } = launched(s);
    if (t.commandArray) out[named('command')] = [command, ...args];
    else {
      out[named('command')] = command;
      if (args.length) out[named('args')] = args;
    }
    if (s.env && Object.keys(s.env).length) out[named('env')] = { ...s.env };
  } else {
    out[named('url')] = s.url;
    if (s.headers && Object.keys(s.headers).length) out[named('headers')] = { ...s.headers };
    if (s.env && Object.keys(s.env).length) out[named('env')] = { ...s.env };
  }
  if (t.commandArray) out.enabled = true;
  return out;
}

// ---- Skills: pinned to their source and audited.

/** Lines that fetch a remote file and run it, or send a secret away: each stops an install until you approve. */
const AUDIT: { why: string; re: RegExp }[] = [
  { why: 'fetches a remote file and runs it', re: /\b(curl|wget|fetch)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/ },
  { why: 'fetches a remote file and runs it', re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(python3?|node|perl|ruby)\b/ },
  { why: 'fetches a remote file and runs it', re: /\b(ba|z)?sh\s+(-c\s+)?["']?(<\(|\$\()\s*(curl|wget)\b/ },
  { why: 'fetches a remote file and runs it', re: /\beval\s+["']?\$\(\s*(curl|wget)\b/ },
  { why: 'sends a secret away', re: /\b(curl|wget|nc)\b[^\n]*(\$\{?[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|API_KEY)\b|~\/\.ssh|\.aws\/credentials|id_rsa|id_ed25519|\.netrc)/ },
];
const gitEnv = (): NodeJS.ProcessEnv => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
/** A skill at a commit of a repository on disk: its files, pin, license, scripts and what the audit found. */
function readSkill(source: Obj, staged: string): SkillItem {
  const [repo, commit, path] = [source.repo, source.commit, source.path].map((v) => (typeof v === 'string' ? v : ''));
  if (!repo || !/^[0-9a-f]{7,64}$/.test(commit!) || !path) throw refuse('required', '/params/skill', 'Name a skill by its source: {repo, commit, path}, a repository, a commit and the skill\'s folder in it.', source);
  const name = basename(path!);
  if (!NAME.test(name)) throw refuse('pattern', '/params/skill/path', 'A skill\'s folder name is its name: letters, digits, - and _.', name);
  let listed: string;
  try {
    listed = execFileSync('git', ['-C', repo!, 'ls-tree', '-r', '--full-tree', commit!, '--', path!], { encoding: 'utf8', env: gitEnv(), maxBuffer: 64 << 20 });
  } catch (error) {
    throw refuse('not_found', '/params/skill', `${repo} has no ${path} at ${commit}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`, source);
  }
  const files: SkillFile[] = [];
  const findings: string[] = [];
  const scripts: string[] = [];
  let license = 'none found';
  for (const row of listed.split('\n').filter(Boolean)) {
    const m = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(row);
    if (!m) continue;
    const rel = relative(path!, m[3]!);
    const bytes = execFileSync('git', ['-C', repo!, 'cat-file', 'blob', m[2]!], { env: gitEnv(), maxBuffer: 64 << 20 });
    const mode = m[1] === '100755' ? 0o755 : 0o644;
    const digest = sha(bytes);
    writeSyncedFile(join(staged, digest), bytes, 0o600);
    files.push({ rel, mode, sha: digest });
    const text = bytes.toString('utf8');
    if (mode === 0o755 || /\.(sh|bash|zsh|py|js|mjs|ts|rb|pl)$/.test(rel)) scripts.push(rel);
    if (/^LICEN[CS]E/i.test(basename(rel))) license = text.split('\n').find((l) => l.trim())?.trim() ?? license;
    text.split('\n').forEach((line, i) => {
      const hit = AUDIT.find((a) => a.re.test(line));
      if (hit) findings.push(`${rel} line ${i + 1}: ${line.trim()} (${hit.why})`);
    });
  }
  if (!files.some((f) => f.rel === 'SKILL.md')) throw refuse('not_found', '/params/skill/path', `${path} at ${commit} holds no SKILL.md, so it is no skill.`, source);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { name, repo: repo!, commit: commit!, path: path!, digest: sha(canonical(files.map((f) => [f.rel, f.sha, f.mode]))), files, license, scripts, findings };
}

// ---- The secret store: the platform's, or the file a test names.

function secretStore(): SecretStore | undefined {
  const file = process.env.DEEP_HUB_TEST_SECRETS;
  if (file) {
    const all = (): Obj => { try { return JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { return {}; } };
    const save = (v: Obj) => writeFileSync(file, `${JSON.stringify(v)}\n`, { mode: 0o600 });
    return {
      get: (k) => Promise.resolve(typeof all()[k] === 'string' ? all()[k] as string : undefined),
      set: (k, v) => Promise.resolve(save({ ...all(), [k]: v })),
      delete: (k) => { const v = all(); delete v[k]; save(v); return Promise.resolve(); },
    };
  }
  // A hub under a test's temp HOME never touches your Keychain.
  return process.platform === 'darwin' && ownHome() ? keychainStore() : undefined;
}
const secretKey = (server: string, variable: string): string => `mcp.${server}.${variable}`;

// ---- The syncs.

export class Agents {
  private readonly dir: string;
  private chain: Promise<unknown> = Promise.resolve();
  /** Asks this module raised, by handle: what each one decides. */
  private readonly asks = new Map<string, { sync?: string; conflict?: { sync: string; path: string }; restart?: { agent: string } }>();
  constructor(private readonly o: AgentsOptions) {
    this.dir = join(o.root, 'agents');
    mkdirSync(join(this.dir, 'syncs'), { recursive: true, mode: 0o700 });
    for (const s of this.all()) if (s.status === 'proposed') this.asks.set(s.ask, { sync: s.id });
    const pending = this.readJson('asks.json');
    for (const [ask, about] of Object.entries(pending)) this.asks.set(ask, about as never);
  }
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // -- State on disk, each file synced: the hub may be cut at any point.
  private readJson(name: string): Obj { try { return JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as Obj; } catch { return {}; } }
  private writeJson(name: string, v: unknown): void { writeSyncedFile(join(this.dir, name), `${JSON.stringify(v, null, 2)}\n`); }
  private load(id: string): Sync | undefined { try { return JSON.parse(readFileSync(join(this.dir, 'syncs', `${id}.json`), 'utf8')) as Sync; } catch { return undefined; } }
  private save(s: Sync): void { this.writeJson(join('syncs', `${s.id}.json`), s); }
  private all(): Sync[] {
    let names: string[] = [];
    try { names = readdirSync(join(this.dir, 'syncs')).filter((n) => n.endsWith('.json')); } catch { /* none */ }
    return names.sort().flatMap((n) => { const s = this.load(n.slice(0, -5)); return s ? [s] : []; });
  }
  private stagedDir(id: string): string { return join(this.dir, 'staged', id); }
  private saveAsks(): void { this.writeJson('asks.json', Object.fromEntries([...this.asks].filter(([, a]) => !a.sync))); }
  /** The entries DeepBuild wrote last, by file and name: what it may replace and take out, and nothing else. */
  private managed(): Record<string, Record<string, string>> { return this.readJson('managed.json') as Record<string, Record<string, string>>; }
  private manage(path: string, entries: Entry[], keep: boolean): void {
    const m = this.managed();
    const file = (m[path] ??= {});
    for (const e of entries) {
      const k = `${e.project ?? ''}:${e.name}`;
      if (keep) file[k] = sha(canonical(e.value));
      else delete file[k];
    }
    if (!Object.keys(file).length) delete m[path];
    this.writeJson('managed.json', m);
  }
  private ours(path: string) {
    const m = this.managed()[path] ?? {};
    return (e: Entry, now: unknown): boolean => {
      const k = m[`${e.project ?? ''}:${e.name}`];
      if (!k) return false;
      // A TOML entry is compared by its tables, a JSON one by its value.
      return typeof now === 'string' ? true : sha(canonical(now)) === k;
    };
  }

  // -- Who is installed: the command each agent's facts name, on your login shell's PATH.
  private loginPath(): string {
    try {
      const c = JSON.parse(readFileSync(join(this.o.root, 'config.json'), 'utf8')) as Obj;
      const p = isObj(c.runner) ? c.runner.login_path : undefined;
      if (typeof p === 'string' && p) return p;
    } catch { /* none recorded */ }
    return process.env.PATH ?? '/usr/bin:/bin';
  }
  private which(binary: string): string | undefined {
    return this.loginPath().split(':').map((d) => join(d, binary)).find((f) => f.startsWith('/') && existsSync(f));
  }
  installed(): AgentFacts[] { return agentFacts().filter((a) => this.which(a.binary) !== undefined); }

  // ---- agents.propose: the plan, shown before you approve.

  propose(params: Obj): Promise<Obj> { return this.serial(() => this.proposeNow(params)); }
  private async proposeNow(params: Obj): Promise<Obj> {
    this.recover();
    const via = typeof params.via === 'string' ? params.via : 'app';
    if (!['app', 'words', 'link', 'restore'].includes(via)) throw refuse('enum', '/params/via', 'A sync comes from the app, your words, a pasted link or a restore.', via);
    const id = ulid(this.o.now());
    const staged = this.stagedDir(id);
    let items: { item: Item; agents: string[] }[];
    const chosen = (v: unknown): string[] => {
      const list = Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string') : [];
      const unknown = list.filter((a) => !factsOf(a));
      if (unknown.length) throw refuse('enum', '/params/agents', `No facts name the agent ${unknown.join(', ')}; the agents are ${AGENT_IDS.join(', ')}.`, unknown);
      if (!list.length) throw refuse('required', '/params/agents', 'Choose the agents to sync it to.', v);
      return [...new Set(list)];
    };
    if (via === 'restore') {
      // The record put back holds what you approved: each item planned again, every entry checked as for a new one.
      const wanted = await this.o.wanted();
      const last = new Map<string, { item: Item; agents: string[] }>();
      for (const w of wanted) if (isObj(w.item) && Array.isArray(w.agents)) last.set(`${String((w.item as Obj).kind)}:${itemName(w.item as unknown as Item)}`, { item: w.item as unknown as Item, agents: (w.agents as string[]).filter((a) => factsOf(a)) });
      items = [...last.values()];
      if (!items.length) throw refuse('not_found', '/params/via', 'The record holds no sync to plan again.', via);
    } else if (params.skill !== undefined) {
      items = [{ item: { kind: 'skill', skill: readSkill(isObj(params.skill) ? params.skill : {}, staged) }, agents: chosen(params.agents) }];
    } else {
      let raw: unknown = params.server;
      if (via === 'link') {
        const link = typeof params.link === 'string' ? params.link : '';
        const m = /^deepbuild:mcp\/add\?server=([A-Za-z0-9_-]+)$/.exec(link);
        if (!m) throw refuse('pattern', '/params/link', 'A link adds a server as deepbuild:mcp/add?server=<base64url of its spec>.', link);
        try { raw = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')); } catch { throw refuse('type', '/params/link', 'The link\'s server isn\'t JSON.', link); }
      }
      items = [{ item: { kind: 'server', server: await this.serverOf(raw) }, agents: chosen(params.agents) }];
    }
    const sync = this.plan(id, via, items);
    // The plan shows every file it writes, each with its diff, and each agent it can't write the entry for.
    const question = this.question(sync);
    const plan = { steps: sync.targets.map((t) => ({ does: `Write ${shownPath(t.path)} for ${t.agents.map((a) => factsOf(a)?.name ?? a).join(' and ')}`, changes: [t.path], undo: `deep undo sync:${id}`, public: false, cost: 0 })), diff: sha(sync.targets.map((t) => t.diff).join('\n')) };
    // The per-file diff itself is the Agents page's to show (agents.read); the plan binds its digest.
    sync.ask = await this.o.raise('agents.sync', {
      kind: 'authority', question, options: [{ id: 'apply', label: 'Apply it', decision: 'allow' }, { id: 'keep', label: 'Leave the agents as they are', decision: 'deny' }],
      recommended: null, deadline: this.o.now() + 7 * 86_400_000, fallback: 'you', default: 'keep', provisional: false, owner: 'you',
      key: sha(canonical({ kind: 'agents.sync', sync: id })), pinned_to: { kind: 'evidence', ref: sha(canonical({ kind: 'agents.sync', sync: id })) },
    }, plan.steps.length ? plan : undefined);
    this.save(sync);
    this.asks.set(sync.ask, { sync: id });
    return this.shown(sync);
  }
  /** A server spec from the app, your words or a link, its secrets moved into the secret store at once. */
  private async serverOf(raw: unknown): Promise<ServerSpec> {
    if (!isObj(raw)) throw refuse('required', '/params/server', 'Name the server: {name, transport, command, args, env, url, headers, secrets, scope}.', raw);
    const name = String(raw.name ?? '');
    if (!NAME.test(name)) throw refuse('pattern', '/params/server/name', 'A server\'s name is letters, digits, - and _, up to 64.', name);
    const transport = raw.transport === 'http' ? 'http' : raw.transport === 'stdio' || raw.transport === undefined ? 'stdio' : undefined;
    if (!transport) throw refuse('enum', '/params/server/transport', 'A server runs over stdio or http.', raw.transport);
    const strings = (v: unknown): Record<string, string> | undefined => (isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : undefined);
    const spec: ServerSpec = { name, transport };
    if (typeof raw.command === 'string' && raw.command) spec.command = raw.command;
    if (Array.isArray(raw.args)) spec.args = raw.args.map(String);
    const env = strings(raw.env);
    if (env && Object.keys(env).length) spec.env = env;
    if (typeof raw.url === 'string' && raw.url) spec.url = raw.url;
    const headers = strings(raw.headers);
    if (headers && Object.keys(headers).length) spec.headers = headers;
    if (isObj(raw.scope) && Array.isArray(raw.scope.repos)) spec.scope = { repos: raw.scope.repos.map((r) => { const p = String(r); try { return realpathSync(p); } catch { return p; } }) };
    if (transport === 'stdio' && !spec.command) throw refuse('required', '/params/server/command', 'A stdio server names the command it runs.', raw);
    if (transport === 'http' && !spec.url) throw refuse('required', '/params/server/url', 'An http server names its URL.', raw);
    const secrets = strings(raw.secrets);
    if (secrets && Object.keys(secrets).length) {
      const store = secretStore();
      if (!store) throw refuse('unavailable', '/params/server/secrets', 'No secret store is reachable from this hub, so the server\'s secrets can\'t be kept; no value was written anywhere.', Object.keys(secrets));
      for (const [k, v] of Object.entries(secrets)) {
        await store.set(secretKey(name, k), v);
        if (!this.o.held.includes(v)) this.o.held.push(v);
      }
      spec.secrets = Object.keys(secrets).sort();
    }
    return spec;
  }
  /** Every target file of every item for every agent chosen, planned in memory from the bytes there now. */
  private plan(id: string, via: string, items: { item: Item; agents: string[] }[]): Sync {
    const installed = this.installed();
    const targets = new Map<string, Target>();
    const refused: Sync['refused'] = [];
    const agents = new Set<string>();
    for (const { item, agents: chosen } of items) {
      for (const a of chosen) {
        const facts = factsOf(a)!;
        agents.add(a);
        if (item.kind === 'server') {
          // The planted wrong program writes every entry without checking it against the agent's facts.
          const no = this.o.plant === 'skips-entry-check' ? undefined : refusedField(facts, item.server);
          if (no) { refused.push({ agent: a, field: no.field, reason: no.reason }); continue; }
          const mcp = facts.mcp!;
          const path = expand(mcp.file);
          const t = targets.get(path) ?? { path, agents: [], before: null, after: '', diff: '', config: { format: mcp.format, key: mcp.key, ...(mcp.perProject ? { perProject: mcp.perProject } : {}), entries: [] }, status: 'planned' };
          if (!t.agents.includes(a)) t.agents.push(a);
          const value = entryFor(facts, item.server);
          // Where an agent keeps per-project entries in its own user config, a scoped server goes there, for each repo.
          if (item.server.scope?.repos.length && mcp.perProject) for (const project of item.server.scope.repos) t.config!.entries.push({ agent: a, name: item.server.name, value, project });
          else t.config!.entries.push({ agent: a, name: item.server.name, value });
          targets.set(path, t);
        } else {
          if (!facts.skills) { refused.push({ agent: a, field: 'skills', reason: `${facts.name}'s facts name no folder it reads skills from` }); continue; }
          const folder = expand(facts.skills.write);
          // A folder another installed agent reads too reaches it as well, and the plan names both.
          const readers = [a, ...installed.filter((o) => o.id !== a && o.skills?.readFrom.some((r) => expand(r) === folder)).map((o) => o.id)];
          for (const f of item.skill.files) {
            const path = join(folder, item.skill.name, f.rel);
            const t = targets.get(path) ?? { path, agents: [], before: null, after: f.sha, diff: '', file: { sha: f.sha, mode: f.mode }, status: 'planned' };
            for (const r of readers) { if (!t.agents.includes(r)) t.agents.push(r); agents.add(r); }
            targets.set(path, t);
          }
        }
      }
    }
    const planned: Target[] = [];
    for (const t of targets.values()) {
      const current = read(t.path);
      const next = this.next(id, t, current);
      if ('refused' in next) throw refuse('conflict', '/params', `Nothing was planned: ${next.refused}. Fix the file, then add it again.`, t.path);
      if ('conflict' in next) throw refuse('conflict', '/params', `Nothing was planned: ${next.conflict}. Rename one of them, then add it again.`, t.path);
      if (current !== null && next.bytes.equals(current)) continue;
      // The plan's bytes, kept as shown to you.
      writeSyncedFile(join(this.stagedDir(id), sha(next.bytes)), next.bytes);
      planned.push({ ...t, before: digestOf(current), after: sha(next.bytes), diff: lineDiff(t.path, current, next.bytes) });
    }
    const item = items.length === 1 ? items[0]!.item : items[0]!.item;
    return { id, created: this.o.now(), via, item, agents: [...agents], targets: planned, refused, ask: '', status: 'proposed', ...(items.length > 1 ? { reason: `${items.length} items planned again from the record` } : {}) };
  }
  /** A target's next bytes, from what the file holds now. */
  private next(id: string, t: Target, current: Buffer | null): Rendered {
    if (t.config) return render(t.config, current, this.ours(t.path), t.path);
    const bytes = readFileSync(join(this.stagedDir(id), t.file!.sha));
    if (current === null || current.equals(bytes)) return { bytes };
    if (t.before !== null && sha(current) === t.before) return { bytes };
    // A skill's file that is there already: an installed skill's (its update says when it differs from the pin), or yours.
    const installed = Object.values(this.skillState()).some((k) => k.files.some((f) => f.path === t.path));
    return installed ? { bytes } : { conflict: `${shownPath(t.path)} is there already and isn't DeepBuild's` };
  }
  private question(s: Sync): string {
    const names = (ids: string[]) => ids.map((a) => factsOf(a)?.name ?? a).join(' and ');
    const what = s.item.kind === 'server' ? `the MCP server ${s.item.server.name}` : `the skill ${s.item.skill.name}`;
    const lines: string[] = [];
    if (s.item.kind === 'skill') {
      const k = s.item.skill;
      lines.push(`Install ${what} from ${k.repo} at ${k.commit.slice(0, 12)}, ${k.path} (pinned to ${k.digest.slice(0, 12)}; license: ${k.license}; scripts: ${k.scripts.length ? k.scripts.join(', ') : 'none'})?`);
      if (k.findings.length) lines.push(`The audit stopped it: ${k.findings.join('; ')}. It goes in only if you apply it. The audit is a reading, never proof.`);
      const installed = this.skillState()[k.name];
      if (installed) {
        const differs = this.differs(installed);
        lines.push(differs.length ? `It updates ${k.name}, whose installed files differ from its pin (${differs.map(shownPath).join(', ')}): applying it replaces your edits.` : `It updates ${k.name} from ${String(installed.commit).slice(0, 12)}.`);
      }
    } else {
      const sv = s.item.server;
      lines.push(`Sync ${what} (${sv.transport}${sv.scope ? `, scoped to ${sv.scope.repos.join(', ')}` : ', every repo'}${sv.secrets?.length ? `, its secrets ${sv.secrets.join(', ')} by handle through deep mcp-exec` : ''})?`);
    }
    const byFolder = new Map<string, Set<string>>();
    for (const t of s.targets) {
      const where = t.file ? dirname(t.path.slice(0, t.path.indexOf(`/${itemName(s.item)}/`) + itemName(s.item).length + 1)) : t.path;
      const set = byFolder.get(where) ?? new Set();
      for (const a of t.agents) set.add(a);
      byFolder.set(where, set);
    }
    for (const [where, set] of byFolder) lines.push(`It writes ${shownPath(where)}, which ${set.size > 1 ? `${names([...set])} both read` : `${names([...set])} reads`}.`);
    for (const r of s.refused) lines.push(`Not for ${factsOf(r.agent)?.name ?? r.agent}: it refuses the field ${r.field} (${r.reason}).`);
    lines.push(`DeepBuild writes only its own entries, at user level; deep undo sync:${s.id} takes them out.`);
    return lines.join(' ').slice(0, 7900);
  }
  private shown(s: Sync): Obj {
    return { sync: `sync:${s.id}`, ask: s.ask, status: s.status, files: s.targets.map((t) => ({ path: t.path, agents: t.agents, before: t.before, after: t.after, diff: t.diff })), refused: s.refused };
  }

  // ---- Your answers.

  /** An answer to an ask this module raised; false when the ask isn't one of its own. */
  delivered(ask: string, option: string | null, decision: string): boolean {
    const about = this.asks.get(ask);
    if (!about) return false;
    this.asks.delete(ask);
    this.saveAsks();
    const fail = (error: unknown) => process.stderr.write(`deep hub: ${ask}'s answer was not carried out: ${error instanceof Error ? error.message : String(error)}\n`);
    if (about.sync) void this.serial(() => (option === 'apply' ? this.apply(about.sync!) : this.decline(about.sync!))).catch(fail);
    else if (about.conflict && option === 'apply') void this.serial(() => this.overwrite(about.conflict!.sync, about.conflict!.path)).catch(fail);
    else if (about.restart && decision === 'allow') void this.runRestart(about.restart.agent).catch(fail);
    return true;
  }
  private decline(id: string): Promise<void> {
    const s = this.load(id);
    if (s?.status === 'proposed') { s.status = 'declined'; this.save(s); }
    return Promise.resolve();
  }

  // ---- Applying a sync.

  private async apply(id: string): Promise<void> {
    this.recover();
    const s = this.load(id);
    if (!s || s.status !== 'proposed') return;
    // Every file planned again in memory first: one that won't parse, or now holds an entry of yours, refuses the
    // whole sync before anything is written. The planted wrong program writes each as soon as it has planned it.
    const planned: { t: Target; current: Buffer | null; bytes: Buffer }[] = [];
    for (const t of s.targets) {
      const current = read(t.path);
      // The planted wrong program replaces each file with the bytes of the plan you were shown, without reading it again.
      const next = this.o.plant === 'replaces-from-first-plan' ? { bytes: readFileSync(join(this.stagedDir(id), t.after)) } : this.next(id, t, current);
      if ('refused' in next || 'conflict' in next) {
        s.status = 'refused';
        s.reason = `Nothing was written: ${'refused' in next ? next.refused : next.conflict}.`;
        t.status = 'refused';
        this.save(s);
        return;
      }
      planned.push({ t, current, bytes: next.bytes });
      if (this.o.plant === 'writes-before-parsing') this.replace(t.path, next.bytes, t.file?.mode);
    }
    // The intent first: each file's digest before, its planned digest and its staged bytes.
    const staged = this.stagedDir(id);
    const journal = planned.map(({ t, current, bytes }, i) => {
      writeSyncedFile(join(staged, `after-${i}`), bytes);
      if (current !== null) writeSyncedFile(join(staged, `before-${i}`), current);
      return { path: t.path, before: digestOf(current), after: sha(bytes) };
    });
    s.status = 'applying';
    this.save(s);
    this.writeJson(join('journal', `${id}.json`), { sync: id, files: journal });
    this.o.durable.point('sync_intent');
    const record = setupRecord(this.o.root);
    for (const [i, { t }] of planned.entries()) {
      let bytes: Buffer = readFileSync(join(staged, `after-${i}`));
      let ok = true;
      // Just before the replace the file is read again; if it changed since the plan, it is planned again on the new bytes.
      for (let tries = 0; this.o.plant !== 'replaces-from-first-plan'; tries++) {
        const now = read(t.path);
        if (digestOf(now) === journal[i]!.before) break;
        const next = tries >= REPLANS ? { conflict: `${shownPath(t.path)} kept changing while DeepBuild wrote it` } : this.next(id, { ...t, before: digestOf(now) }, now);
        if (!('bytes' in next)) { t.status = 'refused' in next ? 'refused' : 'conflict'; s.reason = 'refused' in next ? next.refused : next.conflict; ok = false; break; }
        bytes = next.bytes;
        if (now !== null) writeSyncedFile(join(staged, `before-${i}`), now);
        journal[i] = { path: t.path, before: digestOf(now), after: sha(bytes) };
        writeSyncedFile(join(staged, `after-${i}`), bytes);
        this.writeJson(join('journal', `${id}.json`), { sync: id, files: journal });
      }
      if (!ok) continue;
      this.write(s, record, t, bytes);
    }
    this.finish(s, journal);
  }
  /** One target replaced, its original kept first, and what it now holds noted for undo. */
  private write(s: Sync, record: ReturnType<typeof setupRecord>, t: Target, bytes: Buffer): void {
    // The original bytes are kept once, by hash, before DeepBuild's first write; the planted wrong program keeps them again each time.
    if (this.o.plant === 'copies-original-each-write') delete record.files[t.path];
    keepOriginal(this.o.root, record, t.path);
    saveRecord(this.o.root, record);
    const made = this.replace(t.path, bytes, t.file?.mode);
    s.created_dirs = [...new Set([...(s.created_dirs ?? []), ...made])];
    noteWritten(record, t.path);
    saveRecord(this.o.root, record);
    if (t.config) this.manage(t.path, t.config.entries, true);
    t.status = 'written';
    t.after = sha(bytes);
    this.save(s);
  }
  /** A file replaced whole: a temporary file beside it, synced, renamed over it, then its folder flushed. The folders it made. */
  private replace(path: string, bytes: Buffer, mode?: number): string[] {
    const real = target(path);
    const made: string[] = [];
    for (let d = dirname(real); !existsSync(d); d = dirname(d)) made.unshift(d);
    mkdirSync(dirname(real), { recursive: true });
    const tmp = join(dirname(real), `.${basename(real)}.deepbuild-${process.pid}.tmp`);
    const keep = existsSync(real) ? statSync(real).mode & 0o777 : mode ?? 0o600;
    rmSync(tmp, { force: true });
    writeFileSync(tmp, bytes, { mode: keep });
    chmodSync(tmp, keep);
    syncPath(tmp);
    renameSync(tmp, real);
    this.o.durable.point('sync_replace', { path: real });
    // The rename survives a power cut once its folder is flushed; the planted wrong program never flushes it.
    if (this.o.plant !== 'no-folder-flush') {
      syncPath(dirname(real));
      this.o.durable.point('sync_flush', { path: dirname(real) });
    }
    return made;
  }
  /** A sync's end: complete when every target holds its planned bytes, else in conflict; the journal goes. */
  private finish(s: Sync, journal: { path: string; before: string | null; after: string }[]): void {
    const open = s.targets.filter((t) => t.status !== 'written');
    s.status = open.length ? 'conflict' : 'complete';
    if (!open.length) s.completed = this.o.now();
    this.save(s);
    if (!open.length) this.o.durable.point('sync_complete');
    rmSync(join(this.dir, 'journal', `${s.id}.json`), { force: true });
    void journal;
    if (s.status === 'complete') this.landed(s);
    for (const t of open) if (t.status === 'conflict') void this.askConflict(s, t);
  }
  /** What a complete sync leaves: the record's wanted set, the page's state, and readings for sessions started before it. */
  private landed(s: Sync): void {
    if (s.item.kind === 'server') {
      const servers = this.readJson('servers.json');
      servers[s.item.server.name] = { spec: s.item.server, agents: [...new Set([...(isObj(servers[s.item.server.name]) ? (servers[s.item.server.name] as Obj).agents as string[] : []), ...s.targets.flatMap((t) => t.agents)])], sync: s.id, digest: sha(canonical(launched(s.item.server))) };
      this.writeJson('servers.json', servers);
    } else {
      const skills = this.skillState();
      skills[s.item.skill.name] = { repo: s.item.skill.repo, commit: s.item.skill.commit, path: s.item.skill.path, digest: s.item.skill.digest, agents: [...new Set(s.targets.flatMap((t) => t.agents))], files: s.targets.map((t) => ({ path: t.path, after: t.after })), sync: s.id };
      this.writeJson('skills.json', skills);
    }
    void this.o.synced({ sync: `sync:${s.id}`, item: s.item as unknown as Obj, agents: s.agents }).catch((error: unknown) => process.stderr.write(`deep hub: sync:${s.id} wasn't recorded: ${error instanceof Error ? error.message : String(error)}\n`));
    void this.o.older(s).catch(() => undefined);
  }
  private async askConflict(s: Sync, t: Target): Promise<void> {
    const question = `${shownPath(t.path)} changed while sync:${s.id} was writing it, and the change ${s.reason ? `means: ${s.reason}` : 'changes what you approved'}. DeepBuild left it as you have it. Write DeepBuild's entry over it, or keep yours?`;
    const ask = await this.o.raise('agents.conflict', {
      kind: 'choice', question, options: [{ id: 'apply', label: 'Write DeepBuild\'s entry', decision: 'none' }, { id: 'keep', label: 'Keep mine', decision: 'none' }],
      recommended: 'keep', deadline: this.o.now() + 7 * 86_400_000, fallback: 'you', default: 'keep', provisional: false, owner: 'you',
      key: sha(canonical({ kind: 'agents.conflict', sync: s.id, path: t.path })), pinned_to: { kind: 'evidence', ref: sha(canonical({ kind: 'agents.conflict', sync: s.id, path: t.path })) },
    });
    this.asks.set(ask, { conflict: { sync: s.id, path: t.path } });
    this.saveAsks();
  }
  /** Your yes to a file in conflict: DeepBuild's entries written over what you have, yours under other names kept. */
  private async overwrite(id: string, path: string): Promise<void> {
    const s = this.load(id);
    const t = s?.targets.find((x) => x.path === path);
    if (!s || !t || t.status !== 'conflict') return;
    const current = read(path);
    const next = t.config ? render(t.config, current, () => true, path) : this.next(id, { ...t, before: digestOf(current) }, current);
    if (!('bytes' in next)) { t.status = 'refused'; this.save(s); return; }
    this.write(s, setupRecord(this.o.root), t, next.bytes);
    this.finish(s, []);
  }

  // ---- Recovery, at the hub's start and before each sync.

  recoverAtStart(): Promise<void> { return this.serial(async () => this.recover()); }

  recover(): void {
    let names: string[] = [];
    try { names = readdirSync(join(this.dir, 'journal')).filter((n) => n.endsWith('.json')); } catch { return; }
    for (const n of names) {
      const id = n.slice(0, -5);
      const journal = this.readJson(join('journal', n)) as { files?: { path: string; before: string | null; after: string }[] };
      const s = this.load(id);
      if (!s || !journal.files) { rmSync(join(this.dir, 'journal', n), { force: true }); continue; }
      const files = journal.files;
      const now = files.map((f) => digestOf(read(f.path)));
      // A sync that replaced nothing is dropped: nothing of it reached a file.
      if (files.every((f, i) => now[i] === f.before) && !files.some((f, i) => now[i] === f.after && f.after !== f.before)) {
        s.status = 'dropped';
        s.reason = 'The hub stopped before this sync wrote any file, so it was dropped; nothing of it was written.';
        for (const t of s.targets) t.status = 'unchanged';
        this.save(s);
        rmSync(join(this.dir, 'journal', n), { force: true });
        continue;
      }
      const record = setupRecord(this.o.root);
      for (const [i, f] of files.entries()) {
        const t = s.targets.find((x) => x.path === f.path);
        if (!t) continue;
        if (now[i] === f.after) { t.status = 'written'; noteWritten(record, t.path); if (t.config) this.manage(t.path, t.config.entries, true); continue; }
        if (now[i] === f.before) { this.write(s, record, t, readFileSync(join(this.stagedDir(id), `after-${i}`))); continue; }
        // Someone changed it since: never written over. Valid and already holding DeepBuild's entry, it counts as written.
        const current = read(f.path);
        const next = this.next(id, { ...t, before: now[i] ?? null }, current);
        if ('refused' in next) { t.status = 'refused'; s.reason = next.refused; }
        else if ('conflict' in next) { t.status = 'conflict'; s.reason = next.conflict; }
        else if (current !== null && next.bytes.equals(current)) { t.status = 'written'; if (t.config) this.manage(t.path, t.config.entries, true); }
        else { t.status = 'conflict'; s.reason = `${shownPath(f.path)} changed since you approved it`; }
      }
      saveRecord(this.o.root, record);
      this.save(s);
      this.finish(s, files);
    }
  }

  // ---- Undo.

  /** `deep undo sync:<id>`: each file put back to its bytes before, where you haven't edited it since; else only DeepBuild's entries taken out. */
  undo(params: Obj): Promise<Obj> {
    return this.serial(async () => {
      const handle = typeof params.sync === 'string' ? params.sync : '';
      const s = /^sync:[0-9A-Za-z]+$/.test(handle) ? this.load(handle.slice(5)) : undefined;
      if (!s) throw refuse('not_found', '/params/sync', `No sync ${handle}; name one the Agents page lists, as sync:<id>.`, handle);
      if (s.status === 'undone') throw refuse('not_found', '/params/sync', `${handle} is undone already.`, handle);
      const record = setupRecord(this.o.root);
      const notes: string[] = [];
      const staged = this.stagedDir(s.id);
      for (const [i, t] of [...s.targets.entries()].reverse()) {
        if (t.status !== 'written') continue;
        const current = read(t.path);
        const beforeFile = join(staged, `before-${i}`);
        if (digestOf(current) === t.after) {
          if (t.before === null) rmSync(target(t.path), { force: true });
          else if (existsSync(beforeFile) && sha(readFileSync(beforeFile)) === t.before) this.replace(t.path, readFileSync(beforeFile));
          else { notes.push(`${shownPath(t.path)}: its bytes before the sync are gone, so it was left as it is`); continue; }
        } else if (t.config && current !== null) {
          const out = withoutEntries(t.config, current);
          if (!out) { notes.push(`${shownPath(t.path)} isn't valid any more, so undo left it as it is; take DeepBuild's entries out by hand`); continue; }
          this.replace(t.path, out);
          notes.push(`you edited ${shownPath(t.path)} since the sync, so undo took out only DeepBuild's entries`);
        } else if (current !== null) { notes.push(`you edited ${shownPath(t.path)} since the sync, so undo left it as it is`); continue; }
        if (t.config) this.manage(t.path, t.config.entries, false);
        t.status = 'undone';
        // Back to the bytes setup's record kept: nothing of DeepBuild's is left there for setup's undo to restore.
        const kept = record.files[t.path];
        if (kept && digestOf(read(t.path)) === kept.before) delete record.files[t.path];
        else if (kept && existsSync(target(t.path))) noteWritten(record, t.path);
        else if (kept && !existsSync(target(t.path)) && kept.before === null) delete record.files[t.path];
      }
      for (const d of [...(s.created_dirs ?? [])].reverse()) { try { rmdirSync(d); } catch { /* not empty, or gone */ } }
      saveRecord(this.o.root, record);
      s.status = 'undone';
      this.save(s);
      if (s.item.kind === 'server') {
        const servers = this.readJson('servers.json');
        if (isObj(servers[s.item.server.name]) && (servers[s.item.server.name] as Obj).sync === s.id) delete servers[s.item.server.name];
        this.writeJson('servers.json', servers);
      } else {
        const skills = this.skillState();
        if (skills[s.item.skill.name]?.sync === s.id) delete skills[s.item.skill.name];
        this.writeJson('skills.json', skills);
      }
      return { sync: handle, undone: s.targets.filter((t) => t.status === 'undone').map((t) => t.path), notes };
    });
  }

  // ---- The page's model.

  private skillState(): Record<string, Obj & { files: { path: string; after: string }[] }> { return this.readJson('skills.json') as never; }
  private differs(skill: { files: { path: string; after: string }[] }): string[] { return skill.files.filter((f) => digestOf(read(f.path)) !== f.after).map((f) => f.path); }
  read(): Obj {
    const installed = new Set(this.installed().map((a) => a.id));
    const servers = this.readJson('servers.json');
    const managed = this.managed();
    const agents = agentFacts().map((a) => {
      const file = a.mcp ? expand(a.mcp.file) : undefined;
      let names: string[] = [];
      try {
        if (file && a.mcp!.format === 'json') { const v = JSON.parse(readFileSync(file, 'utf8')) as Obj; names = isObj(v[a.mcp!.key]) ? Object.keys(v[a.mcp!.key] as Obj) : []; }
        else if (file) { const t = tomlTables(readFileSync(file, 'utf8')); names = 'tables' in t ? [...t.tables.keys()].filter((k) => k.startsWith(`${a.mcp!.key}.`) && k.split('.').length === 2).map((k) => k.split('.')[1]!) : []; }
      } catch { /* none */ }
      const ours = new Set(Object.keys(file ? managed[file] ?? {} : {}).map((k) => k.slice(k.indexOf(':') + 1)));
      return { id: a.id, name: a.name, installed: installed.has(a.id), versions: a.versions, servers: names.filter((n) => ours.has(n)), yours: names.filter((n) => !ours.has(n)) };
    });
    const skills = Object.entries(this.skillState()).map(([name, k]) => ({ name, repo: k.repo, commit: k.commit, path: k.path, digest: k.digest, agents: k.agents, differs: this.differs(k).length > 0, differing: this.differs(k) }));
    const syncs = this.all().map((s) => ({ id: `sync:${s.id}`, kind: s.item.kind, name: itemName(s.item), via: s.via, status: s.status, ask: s.ask, ...(s.reason ? { reason: s.reason } : {}), refused: s.refused, files: s.targets.map((t) => ({ path: t.path, agents: t.agents, status: t.status, before: t.before, after: t.after, diff: t.diff })) }));
    return { agents, servers: Object.entries(servers).map(([name, v]) => ({ name, ...(v as Obj) })), skills, syncs };
  }

  // ---- Scope, on every call to a synced server.

  private scopes: { at: number; servers: Obj } | undefined;
  /** Why a call to `server` from a session in `cwd` is denied by the server's scope, or undefined when it may run. */
  scopeDenial(server: string, cwd: string): string | undefined {
    const file = join(this.dir, 'servers.json');
    let at = 0;
    try { at = statSync(file).mtimeMs; } catch { return undefined; }
    if (this.scopes?.at !== at) this.scopes = { at, servers: this.readJson('servers.json') };
    const spec = isObj(this.scopes.servers[server]) ? (this.scopes.servers[server] as { spec?: ServerSpec }).spec : undefined;
    const repos = spec?.scope?.repos;
    if (!repos?.length) return undefined;
    let here = cwd;
    try { here = realpathSync(cwd); } catch { /* as given */ }
    if (repos.some((r) => here === r || here.startsWith(`${r}/`))) return undefined;
    return `DeepBuild denied this call: the MCP server ${server} is scoped to ${repos.join(', ')}, and this session works in ${here}. Change its scope on the Agents page to use it here.`;
  }

  // ---- deep mcp-exec: a server's approved command with its secrets, by handle.

  async exec(params: Obj): Promise<Obj> {
    const name = typeof params.name === 'string' ? params.name : '';
    const entry = this.readJson('servers.json')[name];
    const spec = isObj(entry) ? (entry as { spec?: ServerSpec }).spec : undefined;
    if (!spec || spec.transport !== 'stdio' || !spec.command) throw refuse('not_found', '/params/name', `No synced stdio server ${name}; add it on the Agents page first.`, name);
    // Each handle is bound to the digest of the command you approved.
    if ((entry as Obj).digest !== sha(canonical(launched(spec)))) throw refuse('conflict', '/params/name', `${name}'s command isn't the one you approved; sync it again.`, name);
    const store = secretStore();
    const env: Record<string, string> = { ...(spec.env ?? {}) };
    for (const v of spec.secrets ?? []) {
      const value = store ? await store.get(secretKey(name, v)) : undefined;
      if (value === undefined) throw refuse('not_found', '/params/name', `${name}'s secret ${v} isn't in the secret store; enter it again on the Agents page.`, v);
      if (!this.o.held.includes(value)) this.o.held.push(value);
      env[v] = value;
    }
    return { command: spec.command, args: spec.args ?? [], env, token: ulid(this.o.now()) };
  }

  // ---- Codex's shared daemon: a restart is one authority ask naming the sessions it would interrupt.

  private restarting = new Map<string, string>();
  async restart(params: Obj): Promise<Obj> {
    const agent = typeof params.agent === 'string' ? params.agent : '';
    const facts = factsOf(agent);
    const command = facts?.daemon?.restart;
    if (!facts || !command) throw refuse('not_found', '/params/agent', `${agent || 'That agent'} has no shared daemon its facts can restart.`, agent);
    const open = this.restarting.get(agent);
    if (open && this.asks.has(open)) return { ask: open };
    const served = this.o.sessions().filter((s) => s.agent === agent);
    const daemons = [...new Set(served.map((s) => s.pid))];
    const question = `Restart ${facts.name}'s daemon${daemons.length ? ` (pid ${daemons.join(', ')})` : ''} with \`${facts.binary} ${command.join(' ')}\`? It interrupts ${served.length ? `the sessions it serves: ${served.map((s) => s.id).join(', ')}` : 'no session DeepBuild knows of'}, which then start with the new set of MCP servers and hooks.`;
    const ask = await this.o.raise('agents.restart', {
      kind: 'authority', question, options: [{ id: 'restart', label: 'Restart it', decision: 'allow' }, { id: 'later', label: 'Not now', decision: 'deny' }],
      recommended: null, deadline: this.o.now() + 86_400_000, fallback: 'you', default: 'later', provisional: false, owner: 'you',
      key: sha(canonical({ kind: 'agents.restart', agent, at: this.o.now() })), pinned_to: { kind: 'evidence', ref: sha(canonical({ kind: 'agents.restart', agent, sessions: served.map((s) => s.id) })) },
    }, { steps: [{ does: `Run ${facts.binary} ${command.join(' ')}`, changes: served.length ? served.map((s) => `session:${s.id}`) : [`${facts.name}'s daemon`], undo: CANT_UNDO, public: false, cost: 0 }], diff: sha(question) });
    this.asks.set(ask, { restart: { agent } });
    this.restarting.set(agent, ask);
    this.saveAsks();
    // The planted wrong program restarts it as soon as it asks.
    if (this.o.plant === 'restarts-without-answer') await this.runRestart(agent);
    return { ask, sessions: served.map((s) => s.id) };
  }
  /** The agent's own restart command, as its facts name it, never a signal. */
  private runRestart(agent: string): Promise<void> {
    const facts = factsOf(agent)!;
    const bin = this.which(facts.binary);
    if (!bin || !facts.daemon?.restart) return Promise.resolve();
    return new Promise((done) => execFile(bin, facts.daemon!.restart!, { env: { ...process.env, PATH: this.loginPath() }, timeout: 60_000 }, () => done()));
  }
}
