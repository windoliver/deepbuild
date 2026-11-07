// What crosses the socket and the threads: every socket line is one JSON object with `v`, and every refusal
// is error@3's shape. Shared by the main thread, the parser workers and the core.
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { ulid as eventId } from '@deepbuild/record/ids';
export { ulidTime } from '@deepbuild/record/ids';

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

/** Preserve the hook clock's normalization, then use the database-free event-ID entry. */
export function ulid(ms: number, hex = randomBytes(10).toString('hex')): string {
  return eventId(Math.max(0, Math.floor(ms)), hex);
}
/** A ULID at `ms` whose random part is a hash of `key`, so the same source always gets the same ID and the record holds it once. */
export const derivedId = (ms: number, key: string): string => ulid(ms, createHash('sha256').update(key).digest('hex').slice(0, 20));

/** An event a hook request maps to, its data held to its kind's catalogue fields; the core fills the counters. */
export interface Draft { kind: string; v: number; id: string; ts: number; seq?: string; subject?: string; data: Record<string, unknown>; fill?: 'msg' | 'turn' | 'loads'; queued?: boolean }
/** What the parser read of a hook request that the core needs to check and bind it. */
export interface HookMeta {
  /** A Claude Code network stop's try of the host its API calls go to (#85), made before it queues. */
  network?: { host: string; reached: boolean };
  /** The session this one replaced in the same process, where its agent says. */
  parent?: string;
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
  /** What the hub stages before the call runs, by the entry that matched it: the folders a delete whose reach can't be worked out names (#347), the paths a discard of tracked edits reaches, the stash a drop names (#1294). */
  stage?: Record<string, string[]>;
  /** The heavy.command@1 entry a shell call matched in deep-hook (#1015): the hub runs it under `deep lease` with its kinds. */
  heavy?: { name: string; kinds: string[]; form: string };
  /** A spooled call deep-hook let through because the hub was late, and the guard entries it matched. */
  late?: { matched: string[] };
  /** Only the writer-from-payload plant reads it. */
  payloadWriter?: string;
  /** Why the adapter can't read this patch's paths, so its PreToolUse is denied before it runs (#39). */
  denied?: string;
  /** Set by the server on a PreToolUse its guard entries blocked: the entries, by name, for a PostToolUse that shows it ran anyway (#1033). */
  blockedBy?: string[];
  /** What a hook said beside its turn, for the core to append as a session.reading (#39). */
  reading?: string;
  /** A caller name the payload's own fields contradict, for the core to append once per session as a reading (#993). */
  caller?: string;
  /** Set by the server on a hook whose agent's hook program the last check found can't run (#993): its gates watch-only. */
  cantRun?: boolean;
  /** A shell call's command line; only the matches-text plant reads it. */
  command?: string;
  /** The agent version the session's transcript names; unset until it holds an entry. */
  version?: string;
  /** Set for a session on a version its facts don't cover: recorded unverified, its holds and blocks watch-only. */
  watchOnly?: boolean;
  /**
   * A line from paseo's plugin (#55): the agent's provider and paseo's own agent ID, the token its DeepBuild MCP server
   * binds by, a permission request's ID and kind, an answer's source; and, for a provider the facts don't cover, what
   * they lack.
   */
  paseo?: { provider: string; agent: string; bind: string; request?: string; kind?: string; behavior?: string; from?: string; lacks?: string };
  /**
   * What the core joins to the transcript or reads loop facts from: the payload's prompt ID, prompt, error and
   * subagent, a stop's last message, Codex's turn, and a FileChanged hook's path.
   */
  fields?: { prompt_id?: string; prompt?: string; error?: string; agent_id?: string; source?: string; last_assistant_message?: string; turn_id?: string; file_path?: string };
  /**
   * A tool call's own fields, for a PreToolUse, a PermissionRequest or a PostToolUse (#23): the session's permission
   * mode, the tool, its input, and the options the agent offers in its own permission dialog.
   */
  call?: { mode: string; tool: string; input: Record<string, unknown>; suggestions: unknown[] };
  /** The pull request a `gh pr create` call opened, from its PostToolUse's response (#83). */
  pr?: string;
  /** A shell call that ran, with what it printed, read against the repo's outside resources (#342). */
  ran?: { command: string; stdout: string };
  /**
   * A loop fact the call carries (#29): a wake-up or cron job scheduled, one cancelled, a background subagent or
   * command (#907) started, by its call, or a monitor's watch armed or stopped, by its ID (#997).
   */
  loop?: { scheduled: number | null } | { cron: string; due: number | null; recurring: boolean } | { cancelled: string } | { background: 'subagent' | 'command'; call: string; what: string }
    | { monitor: string; what: string; command: string; timeout: number | null } | { stopped: string };
}
/** The effect classes no "proceed" covers (#321). */
export const AUTHORITY = new Set(['push', 'merge', 'dispatch', 'send', 'delete']);
/** What the event loop hands the core of a PreToolUse it holds for the gate: the call as a person reads it, its effect classes and MCP tool. */
/**
 * A PreToolUse held for the core: its label, the effect classes that need your authority, an MCP tool, and the
 * classes a standing rule decides (#23) with the shell command they're read from.
 */
/** The prefix of Claude in Chrome's tools, whose steps act in your own Chrome (#332). */
export const CHROME = 'mcp__claude-in-chrome__';
/** The prefixes of the agent's tools whose steps act on a screen or in your own browser (#332). */
export const SCREEN_TOOLS = ['mcp__computer-use__', 'mcp__remote-devices__computer_', CHROME];
/** What a destructive call reaches; each is null when the line names one nobody can know. */
export interface StageReach {
  /** The folders a delete whose reach can't be worked out names (#347). */
  folders?: string[] | null;
  /** The paths under which a command discards tracked edits (#1294). */
  edits?: string[] | null;
  /** The stash a drop names: the folder it works in, then the entry, or no entry for all of them (#1294). */
  stash?: string[] | null;
}
export interface Gated {
  label: string; classes: string[]; mcp?: { server: string; tool: string }; decided?: string[]; command?: string;
  /** The push, PR and merge defaults this call meets (#84), each with what it does; `merge` is what a merge names. */
  named?: { rule: string; effect: 'push' | 'pr' | 'merge' }[];
  merge?: { head?: string; pr?: string; auto?: boolean; disable?: boolean };
  /** A question card's questions (#84), sorted as a stop's question is. */
  card?: Record<string, unknown>[];
  /** A computer-use step: allowed only on what its session leases (#332). */
  screen?: boolean;
  /** What is staged before it runs (#347, #1294). */
  stage?: StageReach;
  /** A `gh pr create` (#322): its body's `Closes #n` is checked against the issue's task before it runs. */
  pr?: boolean;
  /** A call in a session whose cut-off turn started a send with no recorded end (#85): checked against it first. */
  resend?: boolean;
}
/**
 * How long the hub holds a call it stages (#347): under Claude Code's 60 s PreToolUse timeout with room for the reply,
 * so the stage or the ask comes before the agent runs the call anyway. The seconds ceiling is held below it.
 */
export const STAGE_HOLD_MS = 45_000;
/** A parser's answer for one line. */
export type Parsed =
  | { kind: 'control'; value: Record<string, unknown> }
  | { kind: 'hook'; drafts: Draft[]; meta: HookMeta }
  | { kind: 'refused'; id: string | null; error: Refusal };

import type { Plant } from './plant.js';
export { activePlant, plantOf, type Plant } from './plant.js';

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
export interface VfsSettings { points?: string; cutAfter?: number; syncDelayMs?: number; refuse?: string; /** Cut right after the nth point of one kind (#148). */ cutAt?: { kind: string; nth: number } }

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
  /** The planted sorter's file, from DEEP_HUB_TEST_SORTER: the questions it answers "proceed" and its rule; only tests set it. */
  sorter?: string;
  /** The definitions handed to the kernel, from DEEP_HUB_TEST_DRAFTS: by a prompt's text or a work item's ID; only tests set it. */
  drafts?: string;
  /** The changes you accepted, a file named by DEEP_HUB_TEST_ACCEPTED: by repo, kind, base and commit; only tests set it (#324). */
  accepted?: string;
  /** The test work source's work.item@1 readings, from DEEP_HUB_TEST_WORK; only tests set it. */
  work?: string;
  /** Paid checks' prices and their runs' cost readings, a file named by DEEP_HUB_TEST_PRICES; only tests set it (#325). */
  prices?: string;
  /** The GitHub API's recorded answers, a file named by DEEP_HUB_TEST_GITHUB; only tests set it (#322). */
  github?: string;
  /** A file of runs for the background job `test` (#909), from DEEP_HUB_TEST_FAIL_JOB: a line `fail` throws, `ok` passes; only tests set it. */
  failJob?: string;
}
