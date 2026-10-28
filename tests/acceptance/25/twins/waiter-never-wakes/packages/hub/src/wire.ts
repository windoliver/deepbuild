// What crosses the socket and the threads: every socket line is one JSON object with `v`, and every refusal
// is error@3's shape. Shared by the main thread, the parser workers and the core.
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

export const VERSION = 1;
/** The features the hub lists in its hello; a client turns off any of its own the hub doesn't list. */
export const FEATURES: readonly string[] = [];

/** error@3: one refusal. */
export interface Refusal { code: string; retryable: boolean; remediation: string; path: string; actual: string; evidence: string[] }
const actualText = (actual: unknown): string => (typeof actual === 'string' ? actual : actual === undefined ? '' : JSON.stringify(actual) ?? String(actual));
export function refusal(code: string, path: string, remediation: string, actual: unknown = '', retryable = false): Refusal {
  return { code, retryable, remediation, path, actual: actualText(actual).slice(0, 8192), evidence: [] };
}
/**
 * A refusal thrown through the core or the server, carried to the reply line as is. `whole` is the refused value
 * before the cut, for a reply to an agent, whose `actual` is scrubbed whole before it is cut.
 */
export class Refused extends Error {
  constructor(readonly refusal: Refusal, readonly whole?: string) {
    super(refusal.remediation);
  }
}
/** A refusal that keeps the whole refused value beside the cut one. */
export const refuse = (code: string, path: string, remediation: string, actual: unknown = '', retryable = false): Refused =>
  new Refused(refusal(code, path, remediation, actual, retryable), actualText(actual));

/** One socket line: the object with the protocol version first; a bigint (a seq) is written as its decimal string. */
export const line = (o: object): string => `${JSON.stringify({ v: VERSION, ...o }, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}\n`;

/**
 * A process's start time, as `ps -o lstart=` prints it: how a process is told apart from a reused PID.
 * Undefined when it can't be read.
 */
export const startOf = (pid: number): Promise<string | undefined> => new Promise((done) => {
  try {
    execFile('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => done(error ? undefined : stdout.trim() || undefined));
  } catch {
    done(undefined);
  }
});

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID at `ms`: 48 bits of time, then 80 bits, random or the 20 hex digits given. */
export function ulid(ms: number, hex = randomBytes(10).toString('hex')): string {
  let out = '';
  let time = BigInt(Math.max(0, Math.floor(ms)));
  for (let i = 0; i < 10; i++) { out = CROCKFORD[Number(time & 31n)] + out; time >>= 5n; }
  let random = BigInt(`0x${hex}`);
  let tail = '';
  for (let i = 0; i < 16; i++) { tail = CROCKFORD[Number(random & 31n)] + tail; random >>= 5n; }
  return out + tail;
}
/** The time a ULID was minted at, in ms. */
export function ulidTime(id: string): number {
  return [...id.slice(0, 10)].reduce((ms, c) => ms * 32 + CROCKFORD.indexOf(c), 0);
}

/** An event a hook request maps to, its data held to its kind's catalogue fields; the core fills the counters. */
export interface Draft { kind: string; v: number; id: string; ts: number; seq?: string; subject?: string; data: Record<string, unknown>; fill?: 'msg' | 'turn' | 'loads' }
/** What the parser read of a hook request that the core needs to check and bind it. */
export interface HookMeta {
  id: string;
  agent: string;
  event: string;
  session: string;
  cwd: string;
  transcript: string;
  pid: number;
  ppid: number;
  /** A tool hook's tool_use_id: the transcript's tool calls a hook reached the hub for. */
  toolUse?: string;
  /** For a PreToolUse of a deep_* tool: the tool, and the RFC 8785 digest of its input, which a deep mcp call binds by. */
  stamp?: { tool: string; digest: string };
  /** The guard entries in rules.json the call matched, by name, as deep-hook read them. */
  matched: string[];
  /** What deep-hook read of the call for a matched entry, by name, shown with that entry's denial. */
  notes?: Record<string, string>;
  /** A spooled call deep-hook let through because the hub was late, and the guard entries it matched. */
  late?: { matched: string[] };
  /** Only the writer-from-payload plant reads it. */
  payloadWriter?: string;
  /** The agent version the session's transcript names; unset until it holds an entry. */
  version?: string;
  /** Set for a session on a version its facts don't cover: recorded unverified, its holds and blocks watch-only. */
  watchOnly?: boolean;
  /** What the core joins to the transcript or reads loop facts from: the payload's prompt ID, prompt, error and subagent. */
  fields?: { prompt_id?: string; prompt?: string; error?: string; agent_id?: string; source?: string };
  /** A loop fact the call carries (#29): a wake-up or cron job scheduled, one cancelled, or a background subagent started. */
  loop?: { scheduled: number | null } | { cron: string; due: number | null; recurring: boolean } | { cancelled: string } | { background: true };
}
/** A parser's answer for one line. */
export type Parsed =
  | { kind: 'control'; value: Record<string, unknown> }
  | { kind: 'hook'; drafts: Draft[]; meta: HookMeta }
  | { kind: 'refused'; id: string | null; error: Refusal };

/** The planted wrong programs a test selects with DEEP_HUB_PLANT; only tests set it. */
export type Plant =
  | 'writer-from-payload' | 'unlink-before-lock' | 'accept-stops-at-emfile' | 'ends-binding' | 'git-in-hook-handler' | 'commit-on-event-loop'
  | 'parse-on-event-loop' | 'origin-from-payload' | 'no-run-values' | 'empty-cited' | 'ignores-unknown-field' | 'run-spawns-itself'
  | 'env-kills-by-port' | 'env-leases-port-again' | 'env-holds-lease-for-helper' | 'compose-default-project'
  | 'stops-at-first-bad-line' | 'remove-spool-after-normal' | 'drops-post-tool-use' | 'replay-appends-twice'
  | 'answer-on-peer-check' | 'answer-on-token' | 'answer-inside-session' | 'skip-default-at-deadline'
  | 'evidence-checks-path-first' | 'binds-first-stamp' | 'unbound-reads-all' | 'errors-without-actual' | 'errors-unscrubbed' | 'trusts-index'
  | 'adapter-decides' | 'unknown-tool-read' | 'unplaced-is-person' | 'loop-from-origins' | 'holds-stop-anyway' | 'restores-at-session-start-only'
  | 'answer-skips-held-stop' | 'stop-hold-releases-without-answer' | 'both-routes' | 'stop-hold-polls' | 'no-stop-count' | 'stop-count-never-resets'
  | 'waiter-never-wakes' | 'waiter-outlives-session' | 'waiter-gives-up-at-600s' | 'waiter-per-stop' | 'waiter-polls' | 'waiter-checks-every-5s'
  | 'delivered-on-waiter-exit' | 'wake-assumed' | 'delivered-to-dead-waiter' | 'routes-from-settings' | 'routes-kept-across-sessions'
  | 'ended-answer-to-worktree' | 'ended-answer-at-next-prompt';
const PLANTS: readonly string[] = [
  'writer-from-payload', 'unlink-before-lock', 'accept-stops-at-emfile', 'ends-binding', 'git-in-hook-handler', 'commit-on-event-loop',
  'parse-on-event-loop', 'origin-from-payload', 'no-run-values', 'empty-cited', 'ignores-unknown-field', 'run-spawns-itself',
  'env-kills-by-port', 'env-leases-port-again', 'env-holds-lease-for-helper', 'compose-default-project',
  'stops-at-first-bad-line', 'remove-spool-after-normal', 'drops-post-tool-use', 'replay-appends-twice',
  'answer-on-peer-check', 'answer-on-token', 'answer-inside-session', 'skip-default-at-deadline',
  'evidence-checks-path-first', 'binds-first-stamp', 'unbound-reads-all', 'errors-without-actual', 'errors-unscrubbed', 'trusts-index',
  'adapter-decides', 'unknown-tool-read', 'unplaced-is-person', 'loop-from-origins', 'holds-stop-anyway', 'restores-at-session-start-only',
  'answer-skips-held-stop', 'stop-hold-releases-without-answer', 'both-routes', 'stop-hold-polls', 'no-stop-count', 'stop-count-never-resets',
  'waiter-never-wakes', 'waiter-outlives-session', 'waiter-gives-up-at-600s', 'waiter-per-stop', 'waiter-polls', 'waiter-checks-every-5s',
  'delivered-on-waiter-exit', 'wake-assumed', 'delivered-to-dead-waiter', 'routes-from-settings', 'routes-kept-across-sessions',
  'ended-answer-to-worktree', 'ended-answer-at-next-prompt',
];
export function plantOf(value: string | undefined): Plant | undefined {
  if (!value) return 'waiter-never-wakes';
  if (!PLANTS.includes(value)) throw Error(`DEEP_HUB_PLANT=${value} names no planted program`);
  return value as Plant;
}

/**
 * An error signature: the same for the same failure in any session. IDs, hex runs, numbers past three digits and the
 * session's own folder are taken out of the text first, so it names the failure, never the session or the call.
 */
export function signature(what: string, text: string, cwd = ''): string {
  let plain = cwd ? text.replaceAll(cwd, '<cwd>') : text;
  plain = plain.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>').replace(/\b(toolu|msg|req)_[0-9A-Za-z]+/g, '<id>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>').replace(/\d{4,}/g, '<n>');
  return `sig:${createHash('sha256').update(`${what}\0${plain}`).digest('hex').slice(0, 16)}`;
}

/** What the agent gets of the extensions' joined tool.before reply (#350): their denies and their context blocks. */
export interface ExtensionReply { denies: { extension: string; reason: string }[]; context: { extension: string; text: string }[] }
/** How long each extension's tool.before handler has to reply; past it, it is recorded as failed and its reply dropped. */
export const EXTENSION_HOOK_MS = 500;
/**
 * The hold the hub acknowledges for a hook some extension handles: the handlers' deadline, the host's grace for the
 * trip back, and room for the core's answer to cross to the socket. A reply past it is the hook's fail-open one.
 */
export const EXTENSION_HOLD_MS = EXTENSION_HOOK_MS + 500;

/** The test VFS's settings, from DEEP_HUB_TEST_VFS. */
export interface VfsSettings { points?: string; cutAfter?: number; syncDelayMs?: number; refuse?: string }

/** What the core is started with, in its worker or inline. */
export interface CoreOptions {
  root: string;
  /** The hub's clock at start and the real time it was read, so the clock moves with real time from a test's start. */
  clock: { start: number; real: number };
  /** The values the hub holds: every text it keeps is scrubbed of them. */
  held: string[];
  plant?: Plant;
  vfs?: VfsSettings;
  /** A module whose default export takes the local host and returns the host@1 the hub uses instead, from DEEP_HUB_TEST_HOST; only tests set it. */
  host?: string;
  /** The term of every lease the hub grants, from DEEP_HUB_TEST_LEASE_MS; only tests set it. */
  leaseMs?: number;
  /** Where the hub kills itself in a stack process's start, from DEEP_HUB_TEST_CRASH; only tests set it. */
  crash?: 'start-recorded' | 'spawned';
  /** The file that stands for the OS confirming you, from DEEP_HUB_TEST_CONFIRM; only tests set it. */
  confirm?: string;
  /** A module whose default export returns the index@1 fill deep_search reads the wiki through, from DEEP_HUB_TEST_INDEX; only tests set it. */
  index?: string;
  /** The forge's REST API the archive copies CI runs from, from DEEP_HUB_TEST_FORGE; only tests set it. */
  forge?: string;
}
