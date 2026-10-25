// What crosses the socket and the threads: every socket line is one JSON object with `v`, and every refusal
// is error@2's shape. Shared by the main thread, the parser workers and the core.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export const VERSION = 1;
/** The features the hub lists in its hello; a client turns off any of its own the hub doesn't list. */
export const FEATURES: readonly string[] = [];

/** error@2: one refusal. */
export interface Refusal { code: string; retryable: boolean; remediation: string; path: string; actual: string; evidence: string[] }
export function refusal(code: string, path: string, remediation: string, actual: unknown = '', retryable = false): Refusal {
  const text = typeof actual === 'string' ? actual : actual === undefined ? '' : JSON.stringify(actual) ?? String(actual);
  return { code, retryable, remediation, path, actual: text.slice(0, 8192), evidence: [] };
}
/** A refusal thrown through the core or the server, carried to the reply line as is. */
export class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.remediation);
  }
}

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
/** A ULID at `ms`: 48 bits of time, 80 random. */
export function ulid(ms: number): string {
  let out = '';
  let time = BigInt(Math.max(0, Math.floor(ms)));
  for (let i = 0; i < 10; i++) { out = CROCKFORD[Number(time & 31n)] + out; time >>= 5n; }
  let random = BigInt(`0x${randomBytes(10).toString('hex')}`);
  let tail = '';
  for (let i = 0; i < 16; i++) { tail = CROCKFORD[Number(random & 31n)] + tail; random >>= 5n; }
  return out + tail;
}
/** The time a ULID was minted at, in ms. */
export function ulidTime(id: string): number {
  return [...id.slice(0, 10)].reduce((ms, c) => ms * 32 + CROCKFORD.indexOf(c), 0);
}

/** An event a hook request maps to, its data held to its kind's catalogue fields; the core fills the counters. */
export interface Draft { kind: string; v: number; id: string; ts: number; seq?: string; subject?: string; data: Record<string, unknown>; fill?: 'msg' | 'turn' }
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
  /** A spooled call deep-hook let through because the hub was late, and the guard entries it matched. */
  late?: { matched: string[] };
  /** Only the writer-from-payload plant reads it. */
  payloadWriter?: string;
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
  | 'stops-at-first-bad-line' | 'remove-spool-after-normal' | 'drops-post-tool-use' | 'replay-appends-twice';
const PLANTS: readonly string[] = [
  'writer-from-payload', 'unlink-before-lock', 'accept-stops-at-emfile', 'ends-binding', 'git-in-hook-handler', 'commit-on-event-loop',
  'parse-on-event-loop', 'origin-from-payload', 'no-run-values', 'empty-cited', 'ignores-unknown-field', 'run-spawns-itself',
  'env-kills-by-port', 'env-leases-port-again', 'env-holds-lease-for-helper', 'compose-default-project',
  'stops-at-first-bad-line', 'remove-spool-after-normal', 'drops-post-tool-use', 'replay-appends-twice',
];
export function plantOf(value: string | undefined): Plant | undefined {
  if (!value) return undefined;
  if (!PLANTS.includes(value)) throw Error(`DEEP_HUB_PLANT=${value} names no planted program`);
  return value as Plant;
}

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
}
