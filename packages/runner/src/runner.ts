// The runner (#159): DeepBuild's own headless jobs on your agent, apart from your sessions. Each job is recorded
// before anything of it starts, gets a folder of its own under <root>/jobs/ (the base commit's checkout when it
// needs code), and runs from its agent's facts: read-only, with only the MCP servers its spec names, none of the
// checkout's settings, an allowlisted environment and your own sign-in home. Every process of it, the checkout's
// git and the binary's version check included, starts through the supervisor's host@1, in the platform sandbox,
// granted only what it reads. Before it starts it waits for its account's plan window, for a budget when a key
// would bill an API account, and for your standing approval when it is a smoke test of a version its facts don't
// cover; it launches only the bytes it verified. Its record is a function of the event log, so a hub that
// crashes finds every job it recorded and never runs one twice.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, type Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Outcome } from '@deepbuild/budget';
import type { JsonValue } from '@deepbuild/contracts';
import { ulid, type Connection, type Event, type EventInput } from '@deepbuild/record';
import type { Grant } from '@deepbuild/supervisor';
import { openForwarder, type Forwarder } from './egress.js';
import type { Agent, Blocked, JobRecord, JobSpec, McpServer, Runner, RunnerOptions, StopCause, Subagent, WindowReport } from './types.js';

const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
/** The kinds `fold` reads: its switch is on this type, so a case for a kind left out of the list fails to compile. */
const FOLDED = ['job.recorded', 'job.ended', 'process.starting', 'run.cleaned', 'ask.created', 'ask.answered', 'ask.defaulted'] as const;
type Folded = (typeof FOLDED)[number];
const MINUTE = 60_000;
/** A Codex window this long or longer is its weekly one (adapters/loops.facts.json: windows.weeklyMinutes). */
const WEEKLY_MINUTES = 10_080;
const DAY = 86_400_000;
/** How long a CLI may keep running after its final result, or after its process ends without one. */
const GRACE_MS = 5000;
/** With no window reading for an account this long while a job waits, one unblock ask. */
const NO_READING_ASK_MS = 30 * MINUTE;
/** What "run without a reading" allows per account per day. */
const NO_READING_PER_DAY = 10;
const POLL_MS = 100;
/** A result's own subtype that names its stop. */
const RESULT_CAUSES: Record<string, StopCause> = { error_max_turns: 'max_turns' };
const KINDS = new Set(['draft', 'review', 'read', 'smoke']);
/** What a job's environment may carry from the hub's: never the variables that mark a nested session. */
// A job's way out is the runner's forwarder, never a proxy of yours: the forwarder takes your HTTPS_PROXY instead.
const ALLOWED_ENV = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM'];

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const readJson = (path: string): unknown => {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
};
const compare = (a: string, b: string): number => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** What isn't data in an agent's facts: the flags that confine its job, and where it records its account. */
interface AgentParts {
  facts: URL;
  /**
   * Added to the facts' read-only launch: the job's own MCP servers and nothing else, their tools allowed, read tools
   * only, and the sub-agents it may hand work to.
   */
  confine(mcp: Record<string, McpServer>, subagents: Record<string, Subagent>): string[];
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
  /** Your sign-in token from the Keychain, unexpired, when its own sign-in files don't hold it. */
  token(home: string, keychain: (service: string) => Promise<string | undefined>): Promise<string | undefined>;
  /** When that token expires, in ms, if the Keychain says (#19: a run that would outlive it never starts). */
  expires(home: string, keychain: (service: string) => Promise<string | undefined>): Promise<number | undefined>;
}
/** The version a binary shows: its suffix kept where the facts list exact builds, so a stable build is never its alpha. */
/** What a program reads to run: the package holding it, since a launcher in bin loads the rest from there, or its own folder. */
export function programRoot(real: string): string {
  const own = dirname(real);
  const up = dirname(own);
  return existsSync(join(up, 'package.json')) ? up : own;
}
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

const AGENTS: Partial<Record<Agent, AgentParts>> = {
  'claude-code': {
    facts: new URL('../../../adapters/claude-code.facts.json', import.meta.url),
    confine: (mcp, subagents) => [
      '--mcp-config', JSON.stringify({ mcpServers: mcp }),
      ...(Object.keys(mcp).length ? ['--allowedTools', Object.keys(mcp).map((name) => `mcp__${name}`).join(',')] : []),
      '--tools', Object.keys(subagents).length ? 'Read,Grep,Glob,Task' : 'Read,Grep,Glob',
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
    facts: new URL('../../../adapters/codex.facts.json', import.meta.url),
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
/** The system's root certificates as a file: a Codex job's HTTP client can't load them from the keychain in its sandbox. */
const CODEX_ROOTS = '/etc/ssl/cert.pem';
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
        .map((m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1').replace(/"[^"]*"|'[^']*'/g, '""')));
    }
    if (p.type !== 'custom_tool_call_output') continue;
    const asked = commands.get(p.call_id);
    const result = JSON.stringify(p.output);
    // A command it can't read counts as a write: only one it can read is known to be just a read.
    if (asked && (!asked.length || asked.some((c) => WRITES.test(c))) && /exit_code\\*"\s*:\s*[1-9]/.test(result) && SANDBOX_REFUSED.test(result)) return true;
  }
  return false;
}

interface Facts { agent: string; versions: string[]; launch: { readOnlyJob: { args: string[] } }; billing: { apiKeyVariables: string[] }; stop: { cause: { errors: { field: string; values: Record<string, string> } } } }
/** A binary as it was verified: where the PATH named it, the file it is, its bytes' digest, its version and its file's identity. */
interface Verified { path: string; real: string; digest: string; version: string; id: string }
const identity = (st: Stats): string => `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;

interface Job {
  rec: JobRecord;
  spec: JobSpec;
  stdout: string;
  pending: string;
  decoder: StringDecoder;
  since: number;
  seen: Set<string>;
  answered?: string;
  resultAt?: number;
  outputAt: number;
  endedAt?: number;
  /** Resolves once its process has ended and `endedAt` is set. */
  exited?: Promise<void>;
  reserved: boolean;
  budgetAt?: number;
  /** The ledger's ask for its budget, whatever it waits on now. */
  budgetAsk?: string;
  noReading: boolean;
  launching?: Promise<void>;
  ended: Promise<JobRecord>;
  end(rec: JobRecord): void;
  stopCause?: StopCause;
  /** Its result was marked an error: no answer. */
  errored?: boolean;
  settling?: Promise<void>;
  left?: number[];
  /** A cleanup that failed: it reads stopping until one confirms. */
  unconfirmed?: boolean;
  /** Its end is claimed by a settle or a stop: the other then leaves it be. */
  ending?: boolean;
  /** Cancelled: whatever is checking or starting it starts nothing. */
  cancelled?: boolean;
  finished?: boolean;
  /** Its checkout is still being written: nothing starts it before then. */
  preparing?: boolean;
  timers: NodeJS.Timeout[];
  /** Its own temp folder, removed when it ends. */
  temp?: string;
}
interface Account { windows: Map<string, { used: number; resets: number | null; at: number }> }
interface Asked { handle: string; answer?: string }

class LocalRunner implements Runner {
  private readonly jobs = new Map<string, Job>();
  private readonly accounts = new Map<string, Account>();
  /** The one unblock ask per account with no window reading, and its answer. */
  private readonly windowAsks = new Map<string, Asked>();
  /** The one standing approval per agent for its smoke tests. */
  private readonly smokeAsks = new Map<Agent, Asked>();
  /** The starts each account took without a reading, by the clock, for its daily limit. */
  private readonly unread = new Map<string, number[]>();
  private readonly verified = new Map<Agent, Verified>();
  /** Versions a planted runner widened the range to; tests only. */
  private readonly widened = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private cursor = 0;
  private closed = false;
  /** Opened with the first job that launches. */
  /** Each agent's forwarder, so a job reaches its own model API and never another agent's. */
  private readonly forwarders = new Map<string, Promise<Forwarder>>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly o: RunnerOptions) {
    this.timer = setInterval(() => void this.tick().catch(() => undefined), 1000);
    this.timer.unref();
  }

  // ---- The record.

  private append(kind: string, data: Obj, subject?: string): Promise<void> {
    const ts = this.o.now();
    const event: EventInput = { v: 1, id: ulid(ts), kind, ts, data: data as JsonValue, ...(subject ? { subject } : {}) };
    return this.o.record.append(CORE, event).then(() => undefined);
  }
  /**
   * What the log gained of the kinds `fold` reads, the rest never decoded. The cursor moves to the head read first, so
   * a busy log's other events are scanned once, not again at every pump.
   */
  private async events(): Promise<Event[]> {
    const [row] = (await this.o.record.raw('SELECT max(log_pos) AS head FROM events')) as { head: number | bigint | null }[];
    const head = Number(row?.head ?? 0);
    const all: Event[] = [];
    for (;;) {
      const page = await this.o.record.read({ after: this.cursor, limit: 1000, kinds: FOLDED });
      all.push(...page);
      if (page.length) this.cursor = page[page.length - 1]!.log_pos;
      if (page.length < 1000) break;
    }
    this.cursor = Math.max(this.cursor, head);
    return all;
  }
  /** What the record gained: the jobs a crash left, and answers to the runner's asks. */
  private async fold(opening: boolean): Promise<void> {
    const started = new Set<string>();
    /** What each run's last cleanup left running, by its process IDs. */
    const left = new Map<string, number[]>();
    for (const e of await this.events()) {
      const d = e.data as Obj;
      switch (e.kind as Folded) {
        case 'job.recorded': {
          if (!opening || this.jobs.has(String(d.job))) break;
          const rec: JobRecord = { job: String(d.job), kind: d.kind as JobRecord['kind'], agent: d.agent as Agent, account: (d.account as string | null) ?? null, state: 'waiting', folder: String(d.folder) };
          this.jobs.set(rec.job, this.make(rec, { kind: rec.kind, agent: rec.agent, prompt: '' }));
          break;
        }
        case 'job.ended': {
          const job = this.jobs.get(String(d.job));
          if (!opening || !job) break;
          Object.assign(job.rec, ended(d));
          job.end(job.rec);
          break;
        }
        case 'process.starting':
          if (opening && typeof d.run === 'string') started.add(d.run);
          break;
        case 'run.cleaned':
          if (opening && typeof d.run === 'string' && Array.isArray(d.left)) {
            left.set(d.run, d.left.flatMap((l) => (typeof l === 'string' && /^pid:\d+$/.test(l) ? [Number(l.slice(4))] : [])));
          }
          break;
        case 'ask.created': {
          if (d.kind !== 'unblock' && d.kind !== 'authority') break;
          // The runner's own asks are found again by their key: one per account without a reading, one per agent's smoke tests.
          if (typeof d.key === 'string') this.keys.set(d.key, `ask:${e.id}`);
          break;
        }
        case 'ask.answered':
        case 'ask.defaulted': {
          this.answers.set(e.subject ?? '', { answer: String(d.answer), decision: String(d.decision ?? 'none') });
          break;
        }
      }
    }
    if (!opening) return;
    // A job recorded and never ended was cut by a crash: reaped, if it had started (the supervisor stopped what
    // it left when it opened), else reported; never run again.
    for (const job of this.jobs.values()) {
      if (job.rec.state !== 'waiting') continue;
      const alive = (left.get(job.rec.job) ?? []).filter(alivePid);
      if (started.has(job.rec.job) && alive.length) {
        // What the supervisor couldn't stop when it opened: it reads stopping until those are gone.
        Object.assign(job, { left: alive, ending: true, stopCause: 'unknown' as StopCause });
        job.rec.state = 'stopping';
        continue;
      }
      const state = started.has(job.rec.job) ? 'stopped' : 'lost';
      const end = state === 'stopped'
        ? { state, cause: 'unknown' as StopCause, refused: undefined }
        : { state, refused: 'the hub stopped before the job started; it is reported, never run again' };
      // What it reserved before the crash is released: nothing of it ran.
      if (state === 'lost') await this.o.ledger.charge(CORE, job.rec.job, 0).catch(() => undefined);
      await this.append('job.ended', { job: job.rec.job, state, ...(end.refused ? { refused: end.refused } : { cause: 'unknown' }) }, job.rec.job);
      Object.assign(job.rec, state === 'stopped' ? { state, stop: { cause: 'unknown' } } : { state, refused: end.refused });
      job.end(job.rec);
      scrap(job.rec.job);
    }
  }
  private readonly keys = new Map<string, string>();
  private readonly answers = new Map<string, { answer: string; decision: string }>();

  async open(): Promise<void> {
    await this.fold(true);
  }

  private make(rec: JobRecord, spec: JobSpec): Job {
    let end!: (rec: JobRecord) => void;
    const done = new Promise<JobRecord>((resolve) => { end = resolve; });
    return { rec, spec, stdout: '', pending: '', decoder: new StringDecoder('utf8'), since: this.o.now(), seen: new Set(), outputAt: Date.now(), reserved: false, noReading: false, ended: done, end: (r) => end({ ...r }), timers: [] };
  }

  // ---- Jobs.

  async submit(spec: JobSpec): Promise<JobRecord> {
    if (this.closed) throw Error('the runner is closed');
    if (!isObj(spec) || !KINDS.has(spec.kind)) throw Error(`a job's kind is draft, review, read or smoke, not ${String(isObj(spec) ? spec.kind : spec)}`);
    if (typeof spec.prompt !== 'string') throw Error('a job has a prompt');
    const id = `run:${ulid(this.o.now())}`;
    const jobs = join(this.o.root, 'jobs');
    mkdirSync(jobs, { recursive: true, mode: 0o700 });
    const folder = join(realpathSync(jobs), id.slice(4));
    mkdirSync(folder, { mode: 0o700 });
    const parts = AGENTS[spec.agent];
    const home = this.o.env.HOME ?? '';
    const account = spec.account ?? (parts && home ? parts.account(home, this.o.env) : null);
    const rec: JobRecord = { job: id, kind: spec.kind, agent: spec.agent, account, state: 'waiting', folder };
    const job = this.make(rec, spec);
    if (spec.checkout) job.preparing = true;
    this.jobs.set(id, job);
    // Recorded before anything of it starts.
    await this.append('job.recorded', {
      job: id, kind: spec.kind, agent: spec.agent, account, folder, prompt: sha256(spec.prompt), waiting: [spec.task, spec.claim].filter((x): x is string => typeof x === 'string'),
    }, id);
    if (!parts) return this.refuse(job, `no agent ${String(spec.agent)}`);
    if (spec.checkout) {
      const failed = await this.checkout(folder, spec.checkout).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
      job.preparing = false;
      // Cancelled while its checkout was written: it is already ended.
      if (job.rec.state !== 'waiting') return { ...job.rec };
      if (failed) return this.refuse(job, `its base checkout failed: ${failed}`);
    }
    await this.pump();
    if (job.launching) await Promise.race([job.launching, this.held(job, job.launching)]);
    return { ...job.rec };
  }
  /** Resolves once its start is held by the supervisor for a lease, which it then shows as BLOCKED. */
  private async held(job: Job, launching: Promise<void>): Promise<void> {
    let launched = false;
    void launching.finally(() => { launched = true; });
    while (!launched) {
      await sleep(50);
      const s = await this.o.supervisor.status(job.rec.job).catch(() => undefined);
      if (s?.state === 'held' && !launched) {
        job.rec.blocked = this.blocked(job, 'lease', { why: `it waits for ${(s.on ?? []).join(', ') || 'a lease'}` }).blocked;
        return;
      }
    }
  }

  async wait(id: string): Promise<JobRecord> {
    return this.find(id).ended;
  }
  async run(spec: JobSpec): Promise<JobRecord> {
    return this.wait((await this.submit(spec)).job);
  }
  async status(id: string): Promise<JobRecord> {
    return { ...this.find(id).rec };
  }
  async list(): Promise<JobRecord[]> {
    return [...this.jobs.values()].map((j) => ({ ...j.rec }));
  }
  async output(id: string): Promise<string> {
    return this.find(id).stdout;
  }
  private find(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw Error(`${id} is no job of this runner's`);
    return job;
  }

  async cancel(id: string): Promise<JobRecord> {
    const job = this.find(id);
    job.cancelled = true;
    if (job.rec.state === 'waiting' && job.launching) {
      // A start the supervisor holds for a lease is given up on; one already through is stopped once it reads running.
      await this.o.supervisor.cleanup(job.rec.job).catch(() => undefined);
    } else if (job.rec.state === 'waiting') {
      Object.assign(job.rec, { state: 'stopped', stop: { cause: 'unknown' } });
      delete job.rec.blocked;
      await this.finish(job);
    } else if (job.rec.state === 'running') {
      void this.stop(job, 'unknown');
    }
    return { ...job.rec };
  }

  /** Nothing of it ran: what it reserved is released at no cost. */
  private async release(job: Job): Promise<void> {
    if (job.reserved) await this.o.ledger.charge(CORE, job.rec.job, 0).catch(() => undefined);
    job.reserved = false;
  }
  private async refuse(job: Job, why: string): Promise<JobRecord> {
    await this.release(job);
    Object.assign(job.rec, { state: 'refused', refused: why });
    delete job.rec.blocked;
    await this.finish(job);
    return { ...job.rec };
  }

  // ---- Before a job starts: its binary, your approval, its account's window and its budget.

  /** Starts each waiting job that may start now, one pass at a time. */
  private pump(): Promise<void> {
    const next = this.chain.then(() => this.pumpOnce());
    this.chain = next.catch(() => undefined);
    return next;
  }
  private async pumpOnce(): Promise<void> {
    if (this.closed) return;
    await this.fold(false);
    for (const job of this.jobs.values()) {
      if (job.rec.state !== 'waiting' || job.launching || job.preparing) continue;
      if (!AGENTS[job.spec.agent]) continue;
      const verdict = await this.gate(job).catch((error: unknown) => ({ refused: `the runner couldn't check it: ${error instanceof Error ? error.message : String(error)}` }));
      // Cancelled or ended while it was checked: it starts nothing.
      if (job.rec.state !== 'waiting' || job.cancelled) {
        await this.release(job);
        continue;
      }
      if ('refused' in verdict) await this.refuse(job, verdict.refused);
      else if ('blocked' in verdict) job.rec.blocked = verdict.blocked;
      else {
        delete job.rec.blocked;
        if (job.noReading) (this.unread.get(job.rec.account ?? '') ?? this.unread.set(job.rec.account ?? '', []).get(job.rec.account ?? '')!).push(this.o.now());
        job.launching = this.launch(job, verdict.binary).catch(async (error: unknown) => {
          if (job.rec.state === 'waiting') await this.refuse(job, `it couldn't start: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
  }

  private blocked(job: Job, cause: string, extra: Partial<Blocked> = {}): { blocked: Blocked } {
    const on = [job.spec.task, job.spec.claim].filter((x): x is string => typeof x === 'string');
    const since = job.rec.blocked?.cause === cause ? job.rec.blocked.since : this.o.now();
    return { blocked: { status: 'BLOCKED', cause, owner: 'you', since, on, ...(job.rec.account ? { account: job.rec.account } : {}), ...extra } };
  }

  private async gate(job: Job): Promise<{ refused: string } | { blocked: Blocked } | { binary: Verified }> {
    const facts = this.facts(job.spec.agent);
    const binary = await this.binary(job, facts);
    if ('refused' in binary) return binary;
    const covered = AGENTS[job.spec.agent]!.exactVersions ? facts.versions.includes(binary.version) : this.covers(facts, binary.version);
    if (!covered && job.spec.kind !== 'smoke') {
      return { refused: `${facts.agent} ${binary.version} at ${binary.path} is outside what its facts cover, ${facts.versions[0]} to ${facts.versions[facts.versions.length - 1]}` };
    }
    if (!covered) {
      // A smoke test of a version its facts don't cover runs under the one standing approval you gave for that agent.
      const approval = await this.approval(job);
      if (approval === 'deny') return { refused: `you declined smoke tests of ${facts.agent} versions its facts don't cover` };
      if (approval !== 'allow') return this.blocked(job, 'standing approval', { ...(approval ? { ask: approval } : {}), why: `${facts.agent} ${binary.version} is outside what its facts cover; its smoke test waits for your standing approval` });
    }
    const window = await this.window(job);
    if (window) return window;
    const budget = await this.budget(job, facts);
    if (budget) return budget;
    const token = await this.outlives(job);
    if (token) return token;
    return { binary };
  }

  /** A run with a planned end never starts on a sign-in token that expires before it: it would stop halfway. */
  private async outlives(job: Job): Promise<{ refused: string } | undefined> {
    const parts = AGENTS[job.spec.agent];
    const home = this.o.env.HOME ?? '';
    if (!job.spec.deadline_ms || !parts || !home || !this.o.keychain) return undefined;
    const expires = await parts.expires(home, this.o.keychain).catch(() => undefined);
    const ends = this.o.now() + job.spec.deadline_ms;
    if (expires === undefined || expires >= ends) return undefined;
    return { refused: `your ${job.spec.agent} sign-in token expires at ${new Date(expires).toISOString()}, before the run's planned end at ${new Date(ends).toISOString()}, so it would stop halfway; sign in again, then run it again` };
  }

  private readonly factsCache = new Map<Agent, Facts>();
  private facts(agent: Agent): Facts {
    let facts = this.factsCache.get(agent);
    if (!facts) this.factsCache.set(agent, (facts = JSON.parse(readFileSync(AGENTS[agent]!.facts, 'utf8')) as Facts));
    return facts;
  }
  private covers(facts: Facts, version: string): boolean {
    if (this.widened.has(version)) return true;
    const range = facts.versions;
    return range.length > 0 && compare(version, range[0]!) >= 0 && compare(version, range[range.length - 1]!) <= 0;
  }

  /** The agent's binary on the login shell's PATH, resolved once, its bytes and version verified again whenever its file changes. */
  private async binary(job: Job, facts: Facts): Promise<{ refused: string } | Verified> {
    const agent = job.spec.agent;
    const known = this.verified.get(agent);
    let path = known?.path;
    if (!path) {
      for (const dir of this.o.loginPath.split(delimiter)) {
        if (!dir || !isAbsolute(dir)) continue;
        const candidate = join(dir, facts.agent);
        try {
          const st = statSync(candidate);
          if (st.isFile() && st.mode & 0o111) { path = candidate; break; }
        } catch { /* not here */ }
      }
    }
    if (!path) return { refused: `no ${facts.agent} on your login shell's PATH (${this.o.loginPath})` };
    if (known && this.unchanged(known)) return known;
    this.verified.delete(agent);
    // Its digest and identity before and after its version run: a file changed in between is checked again.
    for (let tries = 0; tries < 3; tries++) {
      let real: string;
      try { real = realpathSync(path); } catch { return { refused: `${path} is gone` }; }
      const before = identity(statSync(real));
      const digest = await fileDigest(real);
      const shown = await this.step([path, '--version'], job.rec.folder, { read: this.programs(real) }, { PATH: this.o.loginPath, HOME: this.o.env.HOME ?? '' });
      const after = existsSync(real) ? identity(statSync(real)) : '';
      if (realpathSync(path) !== real || after !== before || (await fileDigest(real)) !== digest) continue;
      const version = shownVersion(shown.stdout.toString('utf8'), AGENTS[agent]!.exactVersions === true);
      if (shown.code !== 0 || !version) return { refused: `${path} --version exited ${String(shown.code)} and printed no version` };
      const verified: Verified = { path, real, digest, version, id: before };
      this.verified.set(agent, verified);
      return verified;
    }
    return { refused: `${path} kept changing while it was verified` };
  }
  private unchanged(v: Verified): boolean {
    try {
      return realpathSync(v.path) === v.real && identity(statSync(v.real)) === v.id;
    } catch {
      return false;
    }
  }
  /** What a job's programs may read and run: the binary's folder and the login shell's PATH. */
  private programs(real: string): string[] {
    const dirs = new Set([programRoot(real)]);
    for (const dir of this.o.loginPath.split(delimiter)) if (dir && isAbsolute(dir) && existsSync(dir)) dirs.add(realpathSync(dir));
    return [...dirs];
  }

  /** The standing approval for the agent's smoke tests: 'allow', 'deny', or the ask's handle while it waits. */
  private async approval(job: Job): Promise<string | undefined> {
    const agent = job.spec.agent;
    const key = sha256(`runner.smoke ${agent}`);
    let asked = this.smokeAsks.get(agent);
    const handle = asked?.handle ?? this.keys.get(key);
    if (!asked && handle) this.smokeAsks.set(agent, (asked = { handle }));
    if (asked) {
      const a = this.answers.get(asked.handle);
      if (a) return a.decision === 'allow' ? 'allow' : 'deny';
      return asked.handle;
    }
    const facts = this.facts(agent);
    const now = this.o.now();
    const ask = await this.o.asks.raise(CORE, 'runner.smoke', {
      kind: 'authority',
      question: `${facts.agent} updated to a version its facts don't cover. Run its live smoke test through the runner whenever that happens, inside your plan reserve?`,
      options: [{ id: 'allow', label: 'Run its smoke tests', decision: 'allow' }, { id: 'deny', label: "Don't run them", decision: 'deny' }],
      recommended: null, deadline: now + this.o.settings.asks.unblock.deadline_ms, fallback: 'you', default: 'deny', provisional: false, owner: 'you',
      key, pinned_to: { kind: 'evidence', ref: sha256(`smoke tests of ${agent}`) },
    }, {
      steps: [{ does: `Run ${facts.agent}'s live smoke test through the runner after each update its facts don't cover`, changes: [`${facts.agent} plan usage, inside your reserve`], undo: null, public: false, cost: 0 }],
      diff: sha256(`smoke tests of ${agent}`),
    });
    this.smokeAsks.set(agent, { handle: ask });
    return ask;
  }

  /** Why the job's account's plan window keeps it waiting, or nothing. */
  private async window(job: Job): Promise<{ blocked: Blocked } | undefined> {
    job.noReading = false;
    if (AGENTS[job.spec.agent]!.planless?.(job.rec.account)) return undefined;
    const account = job.rec.account ?? 'unknown';
    const reading = this.accounts.get(account);
    const now = this.o.now();
    if (!reading) {
      const asked = this.windowAsks.get(account) ?? (this.keys.has(sha256(`runner.window ${account}`)) ? { handle: this.keys.get(sha256(`runner.window ${account}`))! } : undefined);
      if (asked) this.windowAsks.set(account, asked);
      const answer = asked ? this.answers.get(asked.handle)?.answer : undefined;
      const since = job.rec.blocked?.cause === 'first reading' ? job.rec.blocked.since : now;
      if (answer === 'run') {
        const today = (this.unread.get(account) ?? []).filter((at) => at > now - DAY);
        this.unread.set(account, today);
        if (today.length < NO_READING_PER_DAY) { job.noReading = true; return undefined; }
        return this.blocked(job, 'first reading', { account, why: `${account} has no window reading, and ${NO_READING_PER_DAY} jobs ran without one today` });
      }
      if (!asked && now - since >= NO_READING_ASK_MS) await this.askWindow(account, job);
      const handle = this.windowAsks.get(account)?.handle;
      return this.blocked(job, 'first reading', { account, why: `waiting for ${account}'s first window reading`, ...(handle ? { ask: handle } : {}) });
    }
    const reserve = this.o.settings.plan.reserve_pct;
    for (const [name, w] of reading.windows) {
      if (w.resets !== null && w.resets <= now) continue;
      if (w.used >= 100 - reserve) {
        return this.blocked(job, 'plan window', { account, why: `${account}'s ${name.replace('_', '-')} window is ${w.used}% used, at your ${reserve}% reserve${w.resets ? `, until ${new Date(w.resets).toISOString()}` : ''}` });
      }
    }
    return undefined;
  }
  private async askWindow(account: string, job: Job): Promise<void> {
    const now = this.o.now();
    const handle = await this.o.asks.raise(CORE, 'runner.window', {
      kind: 'unblock',
      question: `No window reading for account ${account} for 30 minutes, so its jobs can't check your plan reserve. How should its jobs run?`,
      options: [{ id: 'run', label: `Run without a reading, at most ${NO_READING_PER_DAY} jobs a day`, decision: 'none' }, { id: 'connect', label: 'Connect a CLI that reports windows', decision: 'none' }],
      recommended: 'connect', deadline: now + this.o.settings.asks.unblock.deadline_ms, fallback: 'you', default: 'connect', provisional: false, owner: 'you',
      key: sha256(`runner.window ${account}`), pinned_to: { kind: 'evidence', ref: sha256(`window readings of ${account}`) },
      steps: ["Run a Claude Code session with DeepBuild's status line, or a Codex session, on this account", `Or answer "Run without a reading": its jobs then run, at most ${NO_READING_PER_DAY} a day`],
      where: 'your terminal', why: `${job.rec.job} waits for the account's first window reading`, unblocks: [job.rec.job], proves: `window reading of ${account}`,
    });
    this.windowAsks.set(account, { handle });
  }

  /** A key that would bill an API account: the job waits for a budget that covers it. */
  private async budget(job: Job, facts: Facts): Promise<{ blocked: Blocked } | { refused: string } | undefined> {
    if (job.reserved) return undefined;
    const keys = facts.billing.apiKeyVariables.filter((k) => this.o.env[k]);
    if (!keys.length) return undefined;
    const why = `${keys.join(' and ')} ${keys.length > 1 ? 'are' : 'is'} set, so the job would bill an API account; it starts only under a budget that covers it`;
    // Your answer to the ledger's ask is final: declined, the job is refused; it is never asked again.
    const asked = job.budgetAsk;
    const answer = asked ? this.answers.get(asked) : undefined;
    if (answer && answer.decision !== 'allow') return { refused: `you declined the budget it asked for (${asked})` };
    // Asked again only every ten seconds: the ledger keeps the waiting request and its ask.
    if (job.budgetAt !== undefined && Date.now() - job.budgetAt < 10_000 && job.rec.blocked?.cause === 'budget') return { blocked: job.rec.blocked };
    job.budgetAt = Date.now();
    let outcome: Outcome;
    try {
      outcome = await this.o.ledger.request(CORE, { run: job.rec.job, check: `job.${job.spec.kind}`, inputs: sha256(job.spec.prompt), issue: job.spec.issue ?? `job ${job.rec.job}` });
    } catch (error) {
      // Your yes already reserved its price through the ledger's resolver.
      if (error instanceof Error && /already reserved its price/.test(error.message)) { job.reserved = true; return undefined; }
      throw error;
    }
    if (outcome.status === 'started') { job.reserved = true; return undefined; }
    if ('ask' in outcome) job.budgetAsk = outcome.ask;
    const missing = outcome.status === 'BLOCKED' && outcome.cause === 'price' ? `; nothing knows ${outcome.missing}` : '';
    return this.blocked(job, 'budget', { why: `${why}${missing}`, ...('ask' in outcome ? { ask: outcome.ask } : {}) });
  }

  // ---- Its folder.

  /**
   * The base commit's checkout and nothing else of the repo: no other ref, no hook, no config, no credential.
   * git fetches that commit and streams its files' bytes in the sandbox, reading the repo and writing only the
   * folder's .git; the runner writes the files, since the sandbox refuses every write under a `.claude/` folder,
   * a checkout's own included.
   */
  private async checkout(folder: string, at: { repo: string; commit: string }): Promise<string | undefined> {
    if (!isAbsolute(at.repo) || !/^[0-9a-f]{40}$/.test(at.commit)) return `name the repo by its absolute path and the commit by its SHA, not ${at.repo} ${at.commit}`;
    const git = gitBinary();
    if (!git) return 'no git binary outside the xcrun shim';
    const repo = realpathSync(at.repo);
    const read = [repo, ...gitDirs(repo), dirname(dirname(dirname(git)))];
    const env = { PATH: '/usr/bin:/bin', HOME: folder, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
    const run = async (argv: string[], grant: Grant, input?: Buffer): Promise<Buffer> => {
      const r = await this.step(argv, folder, grant, env, input);
      if (r.code !== 0) throw Error(`git ${argv.slice(1).join(' ').slice(0, 200)} exited ${String(r.code)}: ${r.stderr.trim().slice(0, 500)}`);
      return r.stdout;
    };
    const own = { read, write: [join(folder, '.git')] };
    try {
      if (this.o.plant === 'worktree-of-mirror') {
        await run([git, '-C', repo, 'worktree', 'add', '-q', '--detach', '-f', folder, at.commit], { read, write: [folder, ...gitDirs(repo)] });
        return undefined;
      }
      const commit = this.o.plant === 'checkout-of-session-head' ? (await run([git, '-C', repo, 'rev-parse', 'HEAD'], { read })).toString('utf8').trim() : at.commit;
      await run([git, 'init', '-q', '--template=', folder], { read, write: [folder] });
      await run([git, '-C', folder, 'fetch', '-q', '--no-tags', '--no-write-fetch-head', repo, commit], own);
      writeFileSync(join(folder, '.git', 'HEAD'), `${commit}\n`);
      const tree = (await run([git, '-C', folder, 'ls-tree', '-r', '-z', '--full-tree', 'HEAD'], own)).toString('utf8').split('\0').filter(Boolean)
        .map((entry) => { const [meta, path] = entry.split('\t') as [string, string]; const [mode, type, sha] = meta.split(' ') as [string, string, string]; return { mode, type, sha, path }; });
      const blobs = tree.filter((t) => t.type === 'blob');
      const bytes = blobs.length ? await run([git, '-C', folder, 'cat-file', '--batch'], own, Buffer.from(blobs.map((b) => `${b.sha}\n`).join(''))) : Buffer.alloc(0);
      // As this filesystem compares names: no path twice, none under a link, none in a .git of any case.
      const names = new Set<string>();
      const links: string[] = [];
      const claim = (path: string, link: boolean): void => {
        const name = folded(path);
        const parts = name.split('/');
        if (parts.some((p) => p === '' || p === '.' || p === '..' || p === '.git')
          || names.has(name) || links.some((l) => name.startsWith(`${l}/`)) || (link && [...names].some((n) => n.startsWith(`${name}/`)))) {
          throw Error(`the tree names a path its checkout can't hold safely: ${path}`);
        }
        names.add(name);
        if (link) links.push(name);
      };
      let at0 = 0;
      for (const b of blobs) {
        const nl = bytes.indexOf(10, at0);
        const size = Number(/ (\d+)$/.exec(bytes.subarray(at0, nl).toString('utf8'))?.[1]);
        const body = bytes.subarray(nl + 1, nl + 1 + size);
        at0 = nl + 1 + size + 1;
        const path = resolve(folder, b.path);
        if (!path.startsWith(`${folder}/`)) throw Error(`the tree names a path outside its checkout: ${b.path}`);
        claim(b.path, b.mode === '120000');
        mkdirSync(dirname(path), { recursive: true });
        if (b.mode === '120000') symlinkSync(body.toString('utf8'), path);
        else writeFileSync(path, body, { mode: b.mode === '100755' ? 0o755 : 0o644, flag: 'wx' });
      }
      for (const t of tree) {
        if (t.type !== 'commit') continue;
        claim(t.path, false);
        mkdirSync(resolve(folder, t.path), { recursive: true });
      }
      await run([git, '-C', folder, 'read-tree', 'HEAD'], own);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** One short process of the runner's own, through host@1 in the sandbox: its exit code and output. */
  private async step(argv: string[], cwd: string, grant: Grant, env: Record<string, string>, input?: Buffer): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
    const run = `run:${ulid(this.o.now())}`;
    const out: Buffer[] = [];
    let stderr = '';
    const started = await this.o.supervisor.start({
      run, argv, cwd, env, inherit: false, grant, ...(input ? { input } : {}),
      output: { stdout: (c) => { out.push(c); }, stderr: (c) => { stderr += c.toString('utf8'); } },
    });
    if (started.status !== 'started') return { code: null, stdout: Buffer.alloc(0), stderr: `BLOCKED on ${started.kind}` };
    const exit = await this.o.supervisor.wait(run);
    await this.o.supervisor.cleanup(run);
    return { code: exit.code, stdout: Buffer.concat(out), stderr };
  }

  // ---- Running it.

  private env(agent: Agent): Record<string, string> {
    const env: Record<string, string> = {};
    const facts = this.facts(agent);
    for (const name of [...ALLOWED_ENV, ...facts.billing.apiKeyVariables]) {
      const v = this.o.env[name];
      if (typeof v === 'string') env[name] = v;
    }
    env.PATH = this.o.loginPath;
    return env;
  }

  private async launch(job: Job, binary: Verified): Promise<void> {
    const parts = AGENTS[job.spec.agent]!;
    const facts = this.facts(job.spec.agent);
    const args = [...facts.launch.readOnlyJob.args];
    const m = Math.max(args.indexOf('--model'), args.indexOf('-m'));
    if (job.spec.model) {
      if (m >= 0) args[m + 1] = job.spec.model;
      else args.push('--model', job.spec.model);
    }
    const launched = m >= 0 ? args[m + 1]! : job.spec.model ?? 'unknown';
    const home = this.o.env.HOME ?? '';
    // Its own temp folder, private to you and outside the hub's root (which no run may write), removed when it
    // ends; its only host is the forwarder's port.
    const temp = mkdtempSync(join(realpathSync(tmpdir()), `deep-job-${job.rec.job.slice(job.rec.job.indexOf(':') + 1)}-`));
    job.temp = temp;
    // One that failed to open is tried again with the next job.
    let forwarder = this.forwarders.get(facts.agent);
    if (!forwarder) {
      const opening = openForwarder(new Set(parts.hosts), this.o.env.HTTPS_PROXY ?? this.o.env.https_proxy)
        .catch((error: unknown) => { this.forwarders.delete(facts.agent); throw error; });
      this.forwarders.set(facts.agent, forwarder = opening);
    }
    const { port } = await forwarder;
    const billsKey = facts.billing.apiKeyVariables.some((name) => typeof this.o.env[name] === 'string' && this.o.env[name]);
    const token = billsKey || !home || !this.o.keychain ? undefined : await parts.token(home, this.o.keychain).catch(() => undefined);
    const env = { ...this.env(job.spec.agent), ...parts.reach({ temp, proxy: `http://127.0.0.1:${port}`, home, env: this.o.env, ...(token ? { token } : {}) }) };
    const grant: Grant = {
      read: [...this.programs(binary.real), ...(home ? parts.signIn(home, this.o.env) : []), ...(job.spec.grant?.read ?? [])], write: [temp], hosts: [`127.0.0.1:${port}`],
      ...(job.spec.grant?.sockets?.length ? { sockets: job.spec.grant.sockets } : {}),
    };
    // A launch that ends in `-`, the prompt on stdin, keeps it last.
    const stdin = args.at(-1) === '-' ? args.splice(-1) : [];
    const argv = [binary.path, ...args, ...parts.confine(job.spec.mcp ?? {}, job.spec.subagents ?? {}), ...stdin];
    // The bytes it verified, or none: a file changed since is refused here and checked again next time.
    if (!this.unchanged(binary)) {
      this.verified.delete(job.spec.agent);
      await this.refuse(job, `${binary.path} changed after it was verified; it is checked again before the next job`);
      return;
    }
    job.rec.binary = { path: binary.path, version: binary.version };
    job.outputAt = Date.now();
    // Read before its process starts, so its run covers every hook its process sends.
    const from = Date.now();
    const started = await this.o.supervisor.start({
      run: job.rec.job, argv, cwd: job.rec.folder, env, inherit: false, grant,
      // The prompt goes only to the bytes it verified: swapped during the start, its process reads nothing and is stopped.
      input: () => (this.unchanged(binary) && !job.cancelled ? Buffer.from(job.spec.prompt, 'utf8') : undefined),
      ...(job.spec.leases ? { leases: job.spec.leases } : {}),
      output: { stdout: (chunk) => this.read(job, chunk), stderr: () => { job.outputAt = Date.now(); } },
    });
    if (started.status !== 'started') {
      if (job.cancelled) {
        await this.release(job);
        Object.assign(job.rec, { state: 'stopped', stop: { cause: 'unknown' } });
        delete job.rec.blocked;
        await this.finish(job);
      } else await this.refuse(job, `no ${started.kind} was free for it`);
      return;
    }
    delete job.rec.blocked;
    Object.assign(job.rec, { state: 'running', pid: started.pid, pgid: started.pgid, start: started.start, ran: { from } });
    if (!this.unchanged(binary)) {
      this.verified.delete(job.spec.agent);
      job.stopCause = 'unknown';
      void this.stop(job, 'unknown', `${binary.path} changed while it launched; it is checked again before the next job`);
      return;
    }
    if (job.cancelled) {
      void this.stop(job, 'unknown');
      return;
    }
    if (this.o.plant === 'records-launched-model') job.answered = launched;
    if (job.spec.deadline_ms) job.timers.push(setTimeout(() => void this.stop(job, 'timed_out'), job.spec.deadline_ms));
    if (job.spec.output_timeout_ms) this.watchQuiet(job, job.spec.output_timeout_ms);
    job.exited = this.o.supervisor.wait(job.rec.job).then(() => {
      job.endedAt ??= Date.now();
      void this.settle(job, job.resultAt ?? job.endedAt);
    }, () => undefined);
  }

  /** Its stdout as it comes, read line by line as its agent prints stream-json. */
  private read(job: Job, chunk: Buffer): void {
    const text = job.decoder.write(chunk);
    job.stdout += text;
    job.outputAt = Date.now();
    const lines = (job.pending + text).split('\n');
    job.pending = lines.pop()!;
    for (const line of lines) {
      let e: Obj;
      try { e = JSON.parse(line) as Obj; } catch { continue; }
      if (!isObj(e)) continue;
      if (job.spec.agent === 'codex') this.codexEvent(job, e);
      else this.event(job, e);
    }
  }
  /** One line of `codex exec --json`: its thread, its items, and its turn's end. */
  private codexEvent(job: Job, e: Obj): void {
    if (e.type === 'thread.started' && typeof e.thread_id === 'string' && !job.rec.session) job.rec.session = e.thread_id;
    if (e.type === 'item.completed' && isObj(e.item)) {
      const item = e.item;
      if (item.type === 'agent_message' && typeof item.text === 'string') job.rec.result = item.text;
      // Its read-only mode refusing a write: a patch it declined, or a command the sandbox stopped.
      if (codexRefused(item)) job.stopCause ??= 'refusal';
    }
    if (e.type !== 'turn.completed' && e.type !== 'turn.failed') return;
    job.resultAt ??= Date.now();
    for (const t of job.timers) clearTimeout(t);
    if (isObj(e.usage)) {
      // Codex's input includes the cached tokens, taken back out (its facts' usage).
      const u = job.rec.usage ?? { input: 0, cached: 0, output: 0 };
      u.input += num(e.usage.input_tokens) - num(e.usage.cached_input_tokens);
      u.cached += num(e.usage.cached_input_tokens);
      u.output += num(e.usage.output_tokens);
      job.rec.usage = u;
    }
    if (e.type === 'turn.failed') { job.errored = true; job.stopCause ??= 'unknown'; }
    void this.settle(job, job.resultAt);
  }
  private event(job: Job, e: Obj): void {
    if (typeof e.session_id === 'string' && !job.rec.session) job.rec.session = e.session_id;
    if (e.type === 'assistant' && isObj(e.message)) {
      const msg = e.message;
      if (typeof msg.model === 'string' && msg.model !== '<synthetic>' && this.o.plant !== 'records-launched-model') job.answered = msg.model;
      // An API error's entry names the stop's cause, as the facts map it; never the agent's words. A job's
      // stream-json marks it is_api_error_message, where the transcript the facts describe says isApiErrorMessage.
      const errors = this.facts(job.spec.agent).stop.cause.errors;
      if ((e.isApiErrorMessage === true || e.is_api_error_message === true) && typeof e[errors.field] === 'string') job.stopCause = (errors.values[e[errors.field] as string] ?? 'unknown') as StopCause;
      const usage = msg.usage;
      if (isObj(usage) && typeof msg.id === 'string' && !job.seen.has(msg.id) && msg.model !== '<synthetic>') {
        job.seen.add(msg.id);
        const u = job.rec.usage ?? { input: 0, cached: 0, output: 0 };
        u.input += num(usage.input_tokens) + num(usage.cache_creation_input_tokens);
        u.cached += num(usage.cache_read_input_tokens);
        u.output += num(usage.output_tokens);
        job.rec.usage = u;
      }
    }
    if (e.type === 'result') {
      job.resultAt ??= Date.now();
      // Its grace stops it from here; no deadline ends it twice.
      for (const t of job.timers) clearTimeout(t);
      if (typeof e.result === 'string') job.rec.result = e.result;
      if (typeof e.total_cost_usd === 'number') job.rec.cost_usd = e.total_cost_usd;
      if (!job.answered && isObj(e.modelUsage) && this.o.plant !== 'records-launched-model') {
        const names = Object.keys(e.modelUsage);
        if (names.length) job.answered = names[names.length - 1]!;
      }
      if (Array.isArray(e.permission_denials) && e.permission_denials.length) job.stopCause ??= 'refusal';
      // A result marked an error is no answer: the job stopped, for the cause an error named or for none known.
      if (e.is_error === true) { job.errored = true; job.stopCause ??= RESULT_CAUSES[String(e.subtype)] ?? 'unknown'; }
      void this.settle(job, job.resultAt);
    }
  }

  /** A quiet job is stopped only once the platform reports neither CPU nor disk use by it for the whole timeout. */
  private watchQuiet(job: Job, ms: number): void {
    let last: string | undefined;
    const t = setInterval(() => {
      if (job.rec.state !== 'running' || job.resultAt) { clearInterval(t); return; }
      if (Date.now() - job.outputAt < ms) { last = undefined; return; }
      void usageOf(job.rec.pgid!).then((now) => {
        if (last !== undefined && now === last) { clearInterval(t); void this.stop(job, 'timed_out'); }
        last = now;
        job.outputAt = Date.now() - ms + Math.min(ms, 1000);
      });
    }, Math.min(ms, 1000));
    t.unref();
    job.timers.push(t);
  }

  /**
   * After its final result (or its process's end without one): once every process of its group is gone, or the
   * grace has passed, its run is cleaned up through the supervisor; what was still running then lingered.
   */
  private settle(job: Job, from: number): Promise<void> {
    job.settling ??= (async () => {
      const until = from + GRACE_MS;
      while (Date.now() < until && (job.endedAt === undefined || groupAlive(job.rec.pgid))) {
        // Woken as its process ends too: a group gone with it isn't held a poll longer.
        await Promise.race([sleep(POLL_MS), ...(job.endedAt === undefined && job.exited ? [job.exited] : [])]);
      }
      if (job.rec.state !== 'running' || job.ending) return;
      job.ending = true;
      const alive = await groupMembers(job.rec.pgid);
      const cleaned = await this.o.supervisor.cleanup(job.rec.job).catch(() => ({ left: ['unconfirmed'], stopped: [] as number[] }));
      const lingered = [...new Set([...alive, ...(alive.length ? cleaned.stopped : [])])];
      if (lingered.length) job.rec.lingered = lingered.map((pid) => `pid:${pid}`);
      await this.confirm(job, cleaned.left);
    })();
    return job.settling;
  }

  /** Sends its stop: the job reads stopping until every process of it is proven gone. */
  private async stop(job: Job, cause: StopCause, refused?: string): Promise<void> {
    if (job.rec.state !== 'running' || job.ending) return;
    job.ending = true;
    job.rec.state = 'stopping';
    job.stopCause ??= cause;
    for (const t of job.timers) clearTimeout(t);
    const cleaned = await this.o.supervisor.cleanup(job.rec.job).catch(() => ({ left: ['unconfirmed'] }));
    if (refused) job.rec.refused = refused;
    await this.confirm(job, cleaned.left);
  }

  /** Its end, once nothing of it is left; while something is, it reads stopping and is checked on each tick. */
  private async confirm(job: Job, left: string[]): Promise<void> {
    const pids = left.filter((l) => /^pid:\d+$/.test(l)).map((l) => Number(l.slice(4)));
    if (left.some((l) => !/^pid:\d+$/.test(l) && !l.includes(':'))) {
      // No cleanup confirmed what is left of it: it reads stopping until one does, or a restart reaps it from the record.
      job.rec.state = 'stopping';
      job.unconfirmed = true;
      delete job.left;
      return;
    }
    if (pids.some(alivePid)) {
      job.rec.state = 'stopping';
      job.left = pids;
      return;
    }
    delete job.left;
    delete job.unconfirmed;
    for (const t of job.timers) clearTimeout(t);
    if (job.rec.ran) job.rec.ran.to = Date.now();
    job.rec.model = job.answered ?? 'unknown';
    const finished = job.resultAt !== undefined && !job.errored && !job.rec.refused;
    job.rec.state = job.rec.refused ? 'refused' : finished ? 'finished' : 'stopped';
    if (job.temp && AGENTS[job.spec.agent]?.refusedIn?.(job.temp)) job.stopCause ??= 'refusal';
    const cause = job.stopCause ?? (finished ? undefined : 'agent_crashed');
    if (cause) job.rec.stop = { cause };
    if (this.o.plant === 'widens-range-on-smoke' && job.spec.kind === 'smoke' && job.rec.binary) this.widened.add(job.rec.binary.version);
    // Charged what its output said it cost; with no cost read, its reservation stays held, never charged as zero.
    if (job.reserved && job.rec.cost_usd !== undefined) await this.o.ledger.charge(CORE, job.rec.job, job.rec.cost_usd).catch(() => undefined);
    await this.finish(job);
  }

  private async finish(job: Job): Promise<void> {
    if (job.finished) return;
    job.finished = true;
    const r = job.rec;
    await this.append('job.ended', {
      job: r.job, state: r.state, ...(r.refused ? { refused: r.refused } : {}), ...(r.stop ? { cause: r.stop.cause } : {}), ...(r.session ? { session: r.session } : {}),
      ...(r.model ? { model: r.model } : {}), ...(r.binary ? { binary: r.binary } : {}), ...(r.usage ? { usage: r.usage } : {}), ...(r.cost_usd !== undefined ? { cost_usd: r.cost_usd } : {}),
      ...(r.lingered ? { lingered: r.lingered } : {}), ...(r.ran ? { from: r.ran.from, ...(r.ran.to ? { to: r.ran.to } : {}) } : {}),
    }, r.job).catch(() => undefined);
    job.end(r);
    scrap(job.rec.job, job.temp);
  }

  // ---- Windows.

  async report(reading: WindowReport): Promise<void> {
    if (!isObj(reading) || typeof reading.account !== 'string' || !reading.account) throw Error('a window reading names its account');
    const parts = AGENTS[reading.agent];
    if (!parts) throw Error(`no window reading from ${String(reading.agent)} yet`);
    const windows = parts.windows(reading.rate_limits);
    const known = this.accounts.get(reading.account);
    // A window this snapshot leaves out keeps what was last read of it: unknown stays unknown, never reset.
    const merged = new Map(known?.windows ?? []);
    for (const [name, w] of windows) {
      // A window's reading replaces only an older window's, and within one window its use only grows.
      const was = merged.get(name);
      if (was && !((w.resets ?? -Infinity) > (was.resets ?? -Infinity) || (w.resets === was.resets && w.used >= was.used))) continue;
      merged.set(name, { ...w, at: this.o.now() });
    }
    // A reading that names no window is no reading.
    if (!merged.size) return;
    this.accounts.set(reading.account, { windows: merged });
    await this.pump();
  }

  planWindows(): Map<string, { used: number; resets: number | null; at: number }> {
    const out = new Map<string, { used: number; resets: number | null; at: number }>();
    for (const [account, { windows }] of this.accounts) {
      const w = windows.get('five_hour');
      if (w) out.set(account, { ...w });
    }
    return out;
  }

  async tick(): Promise<void> {
    if (this.closed) return;
    for (const job of this.jobs.values()) {
      if (job.rec.state === 'stopping' && job.unconfirmed) {
        const cleaned = await this.o.supervisor.cleanup(job.rec.job).catch(() => undefined);
        if (cleaned) await this.confirm(job, cleaned.left);
      } else if (job.rec.state === 'stopping' && job.left && !job.left.some(alivePid)) await this.confirm(job, []);
    }
    await this.pump();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    for (const job of this.jobs.values()) for (const t of job.timers) clearTimeout(t);
    await this.chain;
    for (const forwarder of this.forwarders.values()) await (await forwarder.catch(() => undefined))?.close();
  }
}

/**
 * A job's temp folder (found by its run token when a crash lost its path) removed, whatever its agent did to it:
 * a folder it made read-only is made writable first. A failure leaves it, and never stops the job's end.
 */
function scrap(job: string, temp?: string): void {
  const prefix = `deep-job-${job.slice(job.indexOf(':') + 1)}-`;
  let paths: string[] = [];
  try { paths = temp ? [temp] : readdirSync(realpathSync(tmpdir())).filter((n) => n.startsWith(prefix)).map((n) => join(realpathSync(tmpdir()), n)); } catch { return; }
  const writable = (path: string): void => {
    const s = lstatSync(path);
    if (!s.isDirectory()) return;
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) writable(join(path, name));
  };
  for (const path of paths) {
    try { rmSync(path, { recursive: true, force: true }); } catch {
      try { writable(path); rmSync(path, { recursive: true, force: true }); } catch { /* left behind */ }
    }
  }
}

/** job.ended's data as the job's record fields. */
function ended(d: Obj): Partial<JobRecord> {
  return {
    state: d.state as JobRecord['state'],
    ...(typeof d.refused === 'string' ? { refused: d.refused } : {}),
    ...(typeof d.cause === 'string' ? { stop: { cause: d.cause as StopCause } } : {}),
    ...(typeof d.session === 'string' ? { session: d.session } : {}),
    ...(typeof d.model === 'string' ? { model: d.model } : {}),
    ...(isObj(d.binary) ? { binary: d.binary as { path: string; version: string } } : {}),
    ...(isObj(d.usage) ? { usage: d.usage as JobRecord['usage'] & object } : {}),
    ...(typeof d.cost_usd === 'number' ? { cost_usd: d.cost_usd } : {}),
    ...(Array.isArray(d.lingered) ? { lingered: d.lingered as string[] } : {}),
    ...(typeof d.from === 'number' ? { ran: { from: d.from, ...(typeof d.to === 'number' ? { to: d.to } : {}) } } : {}),
  };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
function fileDigest(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}
/** A path as a case-insensitive, normalization-insensitive filesystem compares it, ignorable characters dropped. */
const folded = (path: string): string => path.normalize('NFC').replace(/[\u200B-\u200F\u202A-\u202E\u206A-\u206F\uFEFF]/g, '').toLowerCase();
const alivePid = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};
const groupAlive = (pgid: number | undefined): boolean => !!pgid && alivePid(-pgid);
function ps(args: string[]): Promise<string> {
  return new Promise((resolve) => execFile('/bin/ps', args, { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }, (_e, stdout) => resolve(stdout ?? '')));
}
/** The live members of a process group. */
async function groupMembers(pgid: number | undefined): Promise<number[]> {
  if (!pgid || !groupAlive(pgid)) return [];
  return (await ps(['-A', '-o', 'pid=,pgid=,stat='])).split('\n').map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length === 3 && Number(f[1]) === pgid && !f[2]!.startsWith('Z')).map((f) => Number(f[0]));
}
/** The CPU time its group has used so far, as the platform reports it; macOS's ps reports no disk blocks. */
async function usageOf(pgid: number): Promise<string> {
  return (await ps(['-A', '-o', 'pgid=,cputime='])).split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => Number(f[0]) === pgid).map((f) => f[1]).join(',');
}

/** git itself, past the xcrun shim, which can't run in the sandbox: the developer folder's, as xcode-select picks it. */
function gitBinary(): string | undefined {
  const dirs = [process.env.DEVELOPER_DIR, '/var/db/xcode_select_link', '/Applications/Xcode.app/Contents/Developer', '/Library/Developer/CommandLineTools'];
  for (const dir of dirs) {
    if (!dir) continue;
    try {
      const git = join(realpathSync(dir), 'usr', 'bin', 'git');
      if (existsSync(git)) return git;
    } catch { /* not this one */ }
  }
  return process.platform === 'darwin' ? undefined : '/usr/bin/git';
}
/** The folders git reads a repo from: its own, and for a worktree, its git dir and the common one. */
function gitDirs(repo: string): string[] {
  const dot = join(repo, '.git');
  try {
    if (statSync(dot).isDirectory()) return [dot];
    const gitdir = resolve(repo, /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'))![1]!.trim());
    const common = existsSync(join(gitdir, 'commondir')) ? resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim()) : gitdir;
    return [realpathSync(gitdir), realpathSync(common)];
  } catch {
    return [];
  }
}

/** Opens the runner on the record; before it resolves, every job a crash left is found and reaped or reported. */
export async function openRunner(options: RunnerOptions): Promise<Runner> {
  const runner = new LocalRunner(options);
  await runner.open();
  return runner;
}
