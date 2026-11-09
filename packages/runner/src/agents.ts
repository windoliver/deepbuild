// Agent launch policies for the runner: sign-in, confinement, model hosts, versions and plan readings.
// Job lifecycle, budgets and process ownership stay in runner.ts; this module starts no process.
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Agent, McpServer, Subagent } from './types.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const readJson = (path: string): unknown => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
};
/** A Codex window this long or longer is its weekly one (adapters/loops.facts.json: windows.weeklyMinutes). */
const WEEKLY_MINUTES = 10_080;

/** What isn't data in an agent's facts: the flags that confine its job, and where it records its account. */
export interface AgentParts {
  /** Its facts file's name in the repo's adapters/ folder, read through @deepbuild/adapters. */
  facts: string;
  /**
   * Added to the facts' read-only launch: the job's own MCP servers and nothing else, their tools allowed, read tools
   * only, and the sub-agents it may hand work to.
   */
  confine(mcp: Record<string, McpServer>, subagents: Record<string, Subagent>, writes?: string): string[];
  /** Its job can write one folder. */
  writing?: true;
  /** The account the agent records beside your sign-in, or null. */
  account(home: string, env: Record<string, string | undefined>): string | null;
  /** Your sign-in files the agent reads in place, never copied into a job's folder. */
  signIn(home: string, env: Record<string, string | undefined>): string[];
  /** Its window snapshot as named windows: used percent and reset time in ms, each it names. */
  windows(rateLimits: unknown): Map<string, { used: number; resets: number | null }>;
  /** The only hosts (host:port) its job reaches, through the forwarder: its own model API. */
  hosts: string[];
  /** What a real agent needs in its job's environment: its own temp folder, the forwarder, and your sign-in token if the hub read one. */
  reach(o: { temp: string; proxy: string; token?: string; home: string; env: Record<string, string | undefined> }): Record<string, string>;
  /** Whether what it left in its job's temp folder shows its read-only mode refusing, where its output doesn't say. */
  refusedIn?(temp: string): boolean;
  /** Its facts cover exactly the versions they list, not the range between them. */
  exactVersions?: true;
  /** Whether an account has no plan window for a job to wait on: with no plan account signed in, a budget is its only gate. */
  planless?(account: string | null): boolean;
  /** It installs by npm, so it reads its dependencies around its own folder, and its version check reads what its job's grant names. */
  packaged?: boolean;
  /** It reports no plan window: its job waits for no reading of one. */
  windowless?: boolean;
  /** Your sign-in token from the Keychain, unexpired, when its own sign-in files don't hold it. */
  token(home: string, keychain: (service: string) => Promise<string | undefined>): Promise<string | undefined>;
  /** When that token expires, in ms, if the Keychain says (#19: a run that would outlive it never starts). */
  expires(home: string, keychain: (service: string) => Promise<string | undefined>): Promise<number | undefined>;
}
/** What a program reads to run: the package holding it, since a launcher in bin loads the rest from there, or its own folder. */
export function programRoot(real: string): string {
  const own = dirname(real);
  const up = dirname(own);
  const pkg = readJson(join(up, 'package.json'));
  const bin = isObj(pkg) ? pkg.bin : undefined;
  const named = typeof bin === 'string' ? [bin] : isObj(bin) ? Object.values(bin) : [];
  return named.some((b) => typeof b === 'string' && resolve(up, b) === real) ? up : own;
}
/** The version a binary shows: its suffix kept where the facts list exact builds, so a stable build is never its alpha. */
export const shownVersion = (text: string, exact: boolean): string | undefined => (exact ? /(\d+\.\d+\.\d+(?:-[\w.]+)?)/ : /(\d+\.\d+\.\d+)/).exec(text)?.[1];
/** Codex's plan windows, each named by its length as the hub's row reads it, or by its slot where a snapshot gives none. Only the plan's own snapshot: another limit's, such as image_gen's, is no reading of its windows. */
export function codexWindows(limits: unknown): Map<string, { used: number; resets: number | null }> {
  const out = new Map<string, { used: number; resets: number | null }>();
  if (!isObj(limits) || (limits.limit_id !== undefined && limits.limit_id !== 'codex')) return out;
  for (const [slot, name] of [['primary', 'five_hour'], ['secondary', 'seven_day']] as const) {
    const w = limits[slot];
    if (!isObj(w) || typeof w.used_percent !== 'number') continue;
    const named = typeof w.window_minutes === 'number' ? (w.window_minutes >= WEEKLY_MINUTES ? 'seven_day' : 'five_hour') : name;
    out.set(named, { used: w.used_percent, resets: typeof w.resets_at === 'number' ? w.resets_at * 1000 : null });
  }
  return out;
}

export const AGENTS: Partial<Record<Agent, AgentParts>> = {
  'claude-code': {
    facts: 'claude-code.facts.json',
    writing: true,
    confine: (mcp, subagents, writes) => [
      '--mcp-config', JSON.stringify({ mcpServers: mcp }),
      ...(Object.keys(mcp).length || writes ? ['--allowedTools', [...Object.keys(mcp).map((name) => `mcp__${name}`), ...(writes ? [`Edit(${writes}/**)`, `Write(${writes}/**)`] : [])].join(',')] : []),
      '--tools', `Read,Grep,Glob${writes ? ',Write,Edit' : ''}${Object.keys(subagents).length ? ',Task' : ''}`,
      ...(Object.keys(subagents).length ? ['--agents', JSON.stringify(subagents)] : []),
    ],
    account: (home) => {
      const v = readJson(join(home, '.claude.json'));
      const id = isObj(v) && isObj(v.oauthAccount) ? v.oauthAccount.accountUuid : undefined;
      return typeof id === 'string' && id ? id : null;
    },
    signIn: (home) => [join(home, '.claude.json'), join(home, '.claude', 'settings.json'), join(home, '.claude', '.credentials.json')],
    windows: (limits) => {
      const out = new Map<string, { used: number; resets: number | null }>();
      for (const name of ['five_hour', 'seven_day']) {
        const w = isObj(limits) ? limits[name] : undefined;
        if (!isObj(w) || typeof w.used_percentage !== 'number') continue;
        out.set(name, { used: w.used_percentage, resets: typeof w.resets_at === 'number' ? w.resets_at * 1000 : null });
      }
      return out;
    },
    hosts: ['api.anthropic.com:443'],
    reach: ({ temp, proxy, token }) => ({
      TMPDIR: temp, CLAUDE_CODE_TMPDIR: temp, HTTPS_PROXY: proxy, https_proxy: proxy, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}),
    }),
    // Only the access token, never the refresh token; an expired one isn't handed on, so the job reads as signed out.
    token: async (home, keychain) => {
      if (existsSync(join(home, '.claude', '.credentials.json'))) return undefined;
      let v: unknown;
      try { v = JSON.parse((await keychain('Claude Code-credentials')) ?? ''); } catch { return undefined; }
      const o = isObj(v) && isObj(v.claudeAiOauth) ? v.claudeAiOauth : undefined;
      return o && typeof o.accessToken === 'string' && o.accessToken && !(typeof o.expiresAt === 'number' && o.expiresAt <= Date.now()) ? o.accessToken : undefined;
    },
    expires: async (home, keychain) => {
      if (existsSync(join(home, '.claude', '.credentials.json'))) return undefined;
      let v: unknown;
      try { v = JSON.parse((await keychain('Claude Code-credentials')) ?? ''); } catch { return undefined; }
      const o = isObj(v) && isObj(v.claudeAiOauth) ? v.claudeAiOauth : undefined;
      return o && typeof o.expiresAt === 'number' ? o.expiresAt : undefined;
    },
  },
  codex: {
    facts: 'codex.facts.json',
    // The MCP servers go on the command line, since the facts' launch ignores your config. Codex has no sub-agents to name.
    confine: (mcp, subagents) => {
      if (Object.keys(subagents).length) throw Error('a Codex job takes no sub-agents');
      return Object.entries(mcp).flatMap(([name, server]) => ['-c', `mcp_servers.${JSON.stringify(name)}=${inlineToml(server)}`]);
    },
    account: (home, env) => {
      const v = readJson(join(codexHome(home, env), 'auth.json'));
      const id = isObj(v) && isObj(v.tokens) ? v.tokens.account_id : undefined;
      return typeof id === 'string' && id ? id : null;
    },
    signIn: codexSignIn,
    // Only the plan's own snapshot: another limit's, such as image_gen's, is no reading of its windows.
    windows: codexWindows,
    hosts: ['api.openai.com:443', 'chatgpt.com:443'],
    reach: codexReach,
    refusedIn: (temp) => codexLogs(temp).some(codexLogRefused),
    token: async () => undefined,
    expires: async () => undefined,
    exactVersions: true,
    planless: (account) => account === null,
  },
};
/** The system's root certificates as a file: a Codex job's HTTP client can't load them from the keychain in its sandbox. macOS keeps them at /etc/ssl/cert.pem; Debian and Fedora under /etc/ssl/certs and /etc/pki. */
const CODEX_ROOTS = ['/etc/ssl/cert.pem', '/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt'].find((f) => existsSync(f)) ?? '/etc/ssl/cert.pem';
export function codexSignIn(home: string, env: Record<string, string | undefined>): string[] {
  return [join(codexHome(home, env), 'auth.json'), CODEX_ROOTS];
}
// A home of its own in its temp folder, so it writes no rollout or state into yours and your history never counts
// it as a session of yours, with your sign-in linked in place. The sandbox refuses every write under a folder named
// .codex, so that home goes by another name, with a link at the place Codex looks by default.
export function codexReach({ temp, proxy, home, env }: { temp: string; proxy: string; home: string; env: Record<string, string | undefined> }): Record<string, string> {
  const own = join(temp, 'home');
  const codex = join(temp, 'codex-home');
  mkdirSync(own);
  mkdirSync(codex);
  symlinkSync(codex, join(own, '.codex'));
  if (home) symlinkSync(join(codexHome(home, env), 'auth.json'), join(codex, 'auth.json'));
  return { TMPDIR: temp, HOME: own, CODEX_HOME: codex, HTTPS_PROXY: proxy, https_proxy: proxy, SSL_CERT_FILE: CODEX_ROOTS };
}
/** Your Codex home, as its facts name it. */
const codexHome = (home: string, env: Record<string, string | undefined>): string => env.CODEX_HOME || join(home, '.codex');
/** An MCP server as the inline TOML table `-c` takes: JSON's strings and arrays read the same there. */
const inlineToml = (value: unknown): string => (isObj(value)
  ? `{${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `${JSON.stringify(k)}=${inlineToml(v)}`).join(',')}}`
  : Array.isArray(value) ? `[${value.map(inlineToml).join(',')}]` : JSON.stringify(value));
/** A sandbox's refusal in a failed command's output: the operating system's words, never the agent's. */
const SANDBOX_REFUSED = /Operation not permitted|Read-only file system/;
/** A command that writes: output redirected to a file, or a tool whose job is changing files. A read failing the same way is no refusal. */
const WRITES = />>?\s*(?!\/dev\/)[^\s&]|\b(?:tee|touch|mkdir|rmdir|rm|mv|cp|ln|chmod|chown|truncate|dd|patch)\s|\bsed\s+-i|\bgit\s+(?:add|commit|apply|checkout|reset|merge|rebase|push)\b/;
/** Its read-only mode refusing a write: a patch it declined, or a write the sandbox stopped. */
export const codexRefused = (item: { type?: unknown; status?: unknown; command?: unknown; aggregated_output?: unknown }): boolean =>
  (item.status === 'failed' || item.status === 'declined') && (item.type === 'file_change' || (item.type === 'command_execution' && WRITES.test(String(item.command)) && SANDBOX_REFUSED.test(String(item.aggregated_output))));

/** Each session log a Codex job left in its own home. */
function codexLogs(temp: string): string[] {
  const sessions = join(temp, 'codex-home', 'sessions');
  if (!existsSync(sessions)) return [];
  return readdirSync(sessions, { recursive: true, encoding: 'utf8' }).filter((f) => /rollout-.*\.jsonl$/.test(f)).map((f) => readFileSync(join(sessions, f), 'utf8'));
}
/** A write the sandbox stopped, from a session log: Codex's --json carries no item for a command run through its exec tool. */
export function codexLogRefused(log: string): boolean {
  const commands = new Map<string, string[]>();
  for (const line of log.split('\n')) {
    let e: unknown;
    try { e = JSON.parse(line); } catch { continue; }
    const p = isObj(e) && isObj(e.payload) ? e.payload : undefined;
    if (!p || typeof p.call_id !== 'string') continue;
    if (p.type === 'custom_tool_call' && p.name === 'exec') {
      // Each command the script names as a literal, its quoted words dropped: `grep "a -> b"` writes nothing.
      commands.set(p.call_id, [...String(p.input).matchAll(/\bcmd"?\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g)]
        .map((m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c)).replace(/"[^"]*"|'[^']*'/g, '""')));
    }
    if (p.type !== 'custom_tool_call_output') continue;
    const asked = commands.get(p.call_id);
    const result = JSON.stringify(p.output);
    // A command it can't read counts as a write: only one it can read is known to be just a read.
    if (asked && (!asked.length || asked.some((c) => WRITES.test(c))) && /exit_code\\*"\s*:\s*[1-9]/.test(result) && SANDBOX_REFUSED.test(result)) return true;
  }
  return false;
}

AGENTS.pi = {
  facts: 'pi.facts.json',
  // pi has no MCP and no sub-agents: a job that names them is refused, never run without them.
  confine: (mcp, subagents) => {
    if (Object.keys(mcp).length || Object.keys(subagents).length) throw Error('a pi job takes no MCP server and no sub-agent');
    return [];
  },
  account: () => null,
  // pi locks and writes its agent folder even to read it, and a read-only job gets no write to your sign-in or settings:
  // its agent folder is its own, so it signs in by the API key its facts bill, never by a login pi stored.
  signIn: () => [],
  windows: () => new Map(),
  windowless: true,
  packaged: true,
  hosts: ['api.anthropic.com:443'],
  reach: ({ temp, proxy }) => ({ TMPDIR: temp, PI_CODING_AGENT_DIR: temp, HTTPS_PROXY: proxy, https_proxy: proxy, PI_OFFLINE: '1', PI_TELEMETRY: '0' }),
  token: async () => undefined,
  expires: async () => undefined,
};
