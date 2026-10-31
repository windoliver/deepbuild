// The hub's core: the one writer to the record and the evidence store. It checks each hook against the
// session it claims, binds deep mcp calls to sessions, supervises check runs, replays deep-hook's spool, runs
// retention, and answers the socket's methods. It runs in a worker thread of its own, so a disk sync, a run's
// output or a backfill never holds up the event loop that acknowledges hooks.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { access, chmod, copyFile, mkdir, open, readFile, realpath, stat, type FileHandle } from 'node:fs/promises';
import { writtenOf as wikiWritten } from '@deepbuild/wiki';
import { availableParallelism, homedir, networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shipped } from '@deepbuild/adapters';
import { openArchive } from '@deepbuild/archive';
import { AskRefused, duration, openAsks, subjectKey, type Asks, type Delivery, type Resolver } from '@deepbuild/asks';
import { openLedger } from '@deepbuild/budget';
import { canonicalize, contextBoundFor, fixtures, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { openEvidenceStore, scrubText, type Evidence, type EvidenceStore, type Origin, type Peer, type PutResult } from '@deepbuild/evidence';
import { openExtensionHost, openTrust, type ExtensionHost } from '@deepbuild/extension-host';
import { openRecord, RecordError, type Connection, type EventInput, type Message, type RecordStore } from '@deepbuild/record';
import { evidence, judge, resolverDecisions } from '@deepbuild/resolver-decisions';
import { answers, composeKind, downStack, leaseKinds, newRun, portKind, SESSION_KINDS, upStack, type Stack, type Take, type Up } from '@deepbuild/env-local';
import { headTrust, slot, validityGate, type SessionLog } from '@deepbuild/gate';
import { piAcceptsReplaced } from './plant.js';
import { openLeases, type LeaseTable } from '@deepbuild/leases';
import { openRunner, type JobRecord, type JobSpec, type Runner, type WindowReport } from '@deepbuild/runner';
import { after, openSupervisor, type Grant, type Host, type Started, type Supervisor } from '@deepbuild/supervisor';
import { predictionContradictions, verdictLine, type Prediction, type RunOutcome } from '@deepbuild/verdicts';
import { parse as parseYaml } from 'yaml';
import { ASK_WAIT_MS, claudeSettings, CONTINUATION_CAP, installed, readJson, relations, restore, STOP_HOLD_MS, tampered, words } from './claude-settings.js';
import { confirmYou } from './confirm.js';
import { keychain, ownHome } from './keychain.js';
import { recordedHome, codexRelations, holdsFor, modified, readTrust, saveTrust, sessionHomes, stopTimeoutS, trustProblems } from './codex-settings.js';
import { codexReadings, heartbeatsGone, loopsCovered, standingReadings, stands, uncoveredLoops } from './codex-loops.js';
import { statusRows } from './status.js';
import { addGuards, writeStanding } from './guards.js';
import { captureRejected, dropKept, guardOf, keepLesson, lessonsOf, rejectedDirections, repoFolders, revives, syncRejected, tasteBlock, tastesFor } from './memory.js';
import { AskTasks, type WorkItem } from './ask-tasks.js';
import { Holds } from './holds.js';
import { Staging } from './staging.js';
import { coveredBy, parseLine, registry, toolClasses, versionOf } from './hookmap.js';
import { briefing, commitsBetween, headOf, loadsOf } from './session-facts.js';
import { GateRunner } from './gate-runner.js';
import { argsOf, parents, startOf } from './children.js';
import { deepHook, repoOf, rootOf, type Root } from './paths.js';
import { MEMORY_TRANSCRIPTS, openWikiBuild, projectOf, type WikiBuilt } from './wiki-build.js';
import { aboutCall, aboutPermission, standingRules, type About } from './standing.js';
import { checkKey, Devices } from './trusted.js';
import { openIndex, pageClaims, search, type IndexFill } from './search.js';
import { Forge, parsePrUrl, prUrlIn } from './forge.js';
import { claimState, isStatusQuestion, newestClaim, statusAnswer, type ClaimState } from './verdict-chat.js';
import { blockedCause, blockedReading, dueReading, ownerOf, promisesIn, setPromise, promiseToken, wakeText, type PromiseState } from './promises.js';
import { downLeaving } from './leftover.js';
import { checkArguments } from './tools.js';
import { Canvas, nameOf, showCall, waitForApp, WorldFile, type CanvasWorld } from './canvas.js';
import { excerpt, historyKey, type Restored } from './waits.js';
import { copySynced, disk, synced, syncPath, testVfs, writeSynced, type Durable } from './vfs.js';
import { CHROME, derivedId, EXTENSION_HOOK_MS, refuse, Refused, refusal, signature, ulid, ulidTime, type CoreOptions, type Draft, type ExtensionReply, type Gated, type HookMeta, type Refusal, SCREEN_TOOLS } from './wire.js';

/** A process running Codex's own binary, by the path it was started from. */
const CODEX_BINARY = /^(?:\S*\/)?codex(?:-[^\s/]+)?(?:\s|$)/;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A value quoted into SQL. */
const sql = (text: string): string => text.replace(/'/g, "''");
/** A session ID as a handle holds it: letters and digits only. */
const letters = (session: string): string => session.replace(/[^0-9A-Za-z]/g, '');
/** The GitHub CLI's token, only while HOME is your own account's home: the archive reads CI logs with it (#20). */
const ghToken = (): Promise<string | undefined> => {
  if (!ownHome()) return Promise.resolve(undefined);
  return new Promise((done) => execFile('gh', ['auth', 'token'], { timeout: 5000 }, (error, out) => done(error || !out.trim() ? undefined : out.trim())));
};
const YOU = { actor: 'you', scope: 'you' };
const SECRETS_TTL = 10_000;
/** The spool file every deep-hook appends to. */
const SPOOL = 'spool.jsonl';
const REACHED = 10_000;
/** The reading a session gets for a turn with tool calls none of whose hooks reached the hub. */
const HOOKS_MISSING = 'hooks not reaching DeepBuild';
const TRANSCRIPT_STEP = 64 * 1024 * 1024;
/** How long after the hub reads a turn's end it judges whether any of the turn's hooks reached it. */
const TURN_GRACE = 100;
/** How long cursor changes gather before transcripts.json is written: a busy session writes it once, not per hook. */
const CURSOR_SAVE = 200;
/** How long a working session's hooks may go quiet before its transcript's tail is read and, unchanged, it reads unknown. */
const QUIET_MS = 30_000;
/** A call that ended this recently still counts as running when our settings entries change. */
const CALL_GRACE = 2_000;
/** A shell command that makes commits of its own: git commit, merge, cherry-pick, am, revert or rebase (#29). */
const COMMITS = /(?:^|[\s;&|(])git(?:\s+-[Cc]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+(?:commit|merge|cherry-pick|am|revert|rebase)\b/;
/** How long a waiter's answer has to show in a turn before its delivery reads stalled and goes by the next prompt. */
const WAKE_GRACE = 10_000;
/** The most transcript entries of one turn the core keeps for its stop's records. */
const TURN_ENTRIES = 5_000;
/** The agents whose hooks run Claude Code's entries but who aren't Claude Code: never a session's asks or claims. */
const FOREIGN = new Set(['cursor', 'grok']);
/** The commands that take effect only once the OS confirms you (#19), as `you.confirm` names them. */
const AUTHORITY = new Set(['deep off', 'deep on', 'deep hub stop', 'deep hub use', 'deep setup --undo']);
const REQUEST = Buffer.from('{"v":1,"agent":');
type Obj = Record<string, unknown>;
/** The PIDs a test says another process now holds (DEEP_HUB_TEST_PID_REUSE, a JSON list read at each check); only tests set it. */
const reusedPids = (): number[] => {
  const file = process.env.DEEP_HUB_TEST_PID_REUSE;
  if (!file) return [];
  try { const list = JSON.parse(readFileSync(file, 'utf8')) as unknown; return Array.isArray(list) ? list.filter((n): n is number => Number.isSafeInteger(n)) : []; } catch { return []; }
};
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A per-session key's holder, as a person reads it. */
const owned = (holder: string): string => (holder === 'core' ? 'your own terminal\'s deep env up' : `session ${holder.slice('mcp:'.length)}`);
const running = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
};
/** The PIDs that listen on the TCP port, as lsof shows them; a failed lsof rejects, since it proves nothing. */
const listening = (port: number): Promise<number[]> => new Promise((done, fail) => {
  execFile('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
    // lsof exits 1 with no output when nothing listens.
    if (error && !((error as { code?: unknown }).code === 1 && stdout.trim() === '' && stderr.trim() === '')) return fail(Error(`lsof can't list port ${port}'s listeners: ${stderr.trim() || error.message}`));
    done([...new Set(String(stdout ?? '').split('\n').filter((l) => l.startsWith('p')).map((l) => Number(l.slice(1))))]);
  });
});
const isUnder = (path: string, dir: string) => {
  const rel = relative(dir, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
};

/**
 * What a connection brings to a call: its role, the session it is bound to, for deep mcp the process it serves, and
 * for the app or the CLI the process its hello named as its own.
 */
export interface CallContext { role: string; session?: string | null; parent?: { pid: number; start: string }; cwd?: string; peer?: { pid: number; start: string }; waiter?: number }
/** The asks core's refusal as the socket's error@3, with the code that fits what it names. */
const asRefused = (error: unknown): unknown => {
  if (!(error instanceof AskRefused)) return error;
  const code = error.outcome ? 'not_found' : error.option ? 'enum' : error.field === 'writer' ? 'role' : 'type';
  return new Refused(refusal(code, `/params/${error.option ? 'option' : error.field ?? 'ask'}`, error.message, error.option ?? error.ask ?? ''));
};
/**
 * A session as its own hooks established it: the agent process, its working folder and its transcript; and how
 * far the core has read that transcript, the turn it is in there, and the tool calls whose hooks reached the hub.
 */
interface Session {
  id: string; agent: string; pid: number; start: string; cwd: string; transcript: string; ended: boolean;
  /** The thread its ID joins: IDs rotated by `/clear`, `/compact` or a fork are one thread. */
  thread: string;
  read: number; turn: Turn | undefined; closed: Turn[]; reached: Set<string>;
  /** Calls whose hooks' events are on their way to the record, and how many: their turns wait for them. */
  pending: Map<string, number>;
  /** Whether its closed turns wait for a replay's end to be judged. */
  deferred?: boolean;
  /** The timer that judges its closed turns once their grace has passed. */
  judging?: NodeJS.Timeout | undefined;
  /** Its prompts' transcript entries, by prompt ID, which a prompt's origin joins to. */
  prompts: Map<string, Obj>;
  /** The transcript entries of its current turn, which its stop's cause and usage are read from. */
  entries: Obj[];
  /**
   * Its transcript's queue as it stands, each message marked once a hook found it waiting there (#340); and the
   * prompts recorded from the queue, or from a UserPromptSubmit, that the other hasn't shown yet: each message is
   * recorded once.
   */
  queued?: { text: string; taken: boolean }[]; fromQueue?: string[]; prompted?: string[];
  /**
   * The prompt hooks whose message the queue had shown, with the origin each mapped to and the queue's draft of the
   * message, which holds its task once appended: their event is the queue's, not their own (#83 reads both here).
   */
  spliced?: Map<string, { from: string; task: Draft | undefined }>;
  /** The queue's drafts in order, until the prompt hook that takes each. */
  queuedTasks?: Draft[];
}
/**
 * What the core follows of every session by its hooks, checked or not: its attention, its open calls, the commit
 * its worktree had, and its loop: wake-ups and crons it scheduled and background subagents still to report.
 */
interface Live {
  agent: string; cwd: string; state?: string; last: number; quiet?: NodeJS.Timeout | undefined;
  calls: Map<string, { what: string; ended?: number }>; head?: string | undefined; unborn?: boolean; reading?: Promise<void>;
  from?: string; wakeups: number[]; crons: Map<string, { due: number | null; recurring: boolean }>; background: number; looping: boolean;
  /**
   * Its turns as the verdict line judges them (#83): the turn's count and whether the stop rule reads its stop as a
   * claim; the newest claim the line reads and the turn it was made in; the line last delivered to the chat, so
   * one that lands later goes with the next prompt.
   */
  turn: number; turnTask?: string | undefined; judged: boolean; claiming?: Promise<string[]> | undefined; workedSinceClaim?: boolean; claim?: string | undefined; claimTurn?: number; delivered?: string | undefined;
}
/**
 * A turn of a transcript: where its prompt starts there, its tool calls, and for a closed one when the hub read
 * its end (its monotonic clock).
 */
interface Turn { uuid: string; from: number; calls: string[]; at?: number; recording?: boolean }
/**
 * A session's numbering and what the stop rule reads of its turn: no prompt since its start, the prompt the turn
 * began with (typed by a person, opening a task or not), and whether it made an edit, a write or an ask.
 */
interface Counter { msgs: number; turns: number; worked: boolean; fresh?: boolean; prompt?: { person: boolean; opened: boolean }; changed?: boolean }
/** The tool kinds that only read: a turn of them alone, begun by your question, is an answer. */
const READS = new Set(['read', 'search', 'fetch']);
/** What Claude Code queues for another session's message, a subagent's report or a task's notice: never typed. */
const AUTOMATIC_QUEUED = /<task-notification>|^\s*<(?:cross-session-message|agent-message)\b/;
/**
 * The routes back into a session (#25): the hooks of ours it showed firing since it last started, on a version its
 * facts cover; its stops held now; when a hook last showed a turn running (wall ms); its waiter; the turn's
 * continuations; send-backs planted for its next stop and what waits past the cap for its next prompt; and whether
 * its app showed a wake working.
 */
interface Routes {
  cwd: string; shown: Set<string>; covered: boolean; holding: number; busy: number;
  waiter?: { key: number; at: number; since: number; give(reply: Obj): void } | undefined;
  continued: number; capped: boolean; sendBacks: string[]; later: string[]; wakes?: boolean;
  /** The claims whose slow checks a stop wasn't held for (#39): each one's verdict goes with the next prompt after it ends. */
  slowClaims?: string[];
  /** Its waiter is the agent's own package, which places an answer itself, busy or idle, and says what became of each (#40). */
  places?: boolean; placing?: Set<string>;
}
/** An answered ask, as a route delivers it. */
interface Answer { id: string; session: string; question: string | null; options: string | null; answer: string | null; words: string | null; image: string | null }
/** Your words sent from the app into a session (#340), by the delivery's request ID. */
interface Note { session: string; text: string; request: string }
/**
 * Where a session's transcript is judged from after a restart, and the calls whose hooks reached the hub past there;
 * for an ended session with turns still to judge, its agent too, since no hook of it comes again.
 */
interface Cursor { transcript: string; read: number; reached: string[]; ended?: { agent: string } }
/** A PreToolUse deep-hook stamped for a deep_* call, which one call of that session's deep mcp may bind to. */
interface Stamp { session: string; tool: string; digest: string }
/** A run the supervisor started, as the journal keeps it until its finish is durable; `environment`: it needs its folder's stack running. */
interface Run { run: string; check: string; claim: string; commit: string; argv: string[]; env: Record<string, string>; cwd: string; grant: Grant; environment?: boolean; lane?: 'fast' | 'slow'; expected_ms?: number | null; deadline?: number }
/** What a run gets when run.start names no grant: your files and programs, as you, in the sandbox all the same (Access: run-as-you). */
const RUN_AS_YOU: Grant = { run_as_you: true };
const GRANT_LISTS = ['read', 'write', 'hosts', 'sockets'] as const;

/** How long a run past its deadline has to stop once asked. */
const RUN_KILL_GRACE_MS = 10_000;
/** A prompt Codex's subagent got, which its hook names with the root's session ID and an agent_id. */
const childPrompt = (meta: HookMeta): boolean => meta.agent === 'codex' && Boolean(meta.fields?.agent_id);
/** One events row as the record stores it, its seq read as text so no digit is lost. */
interface Row { v: number; id: string; kind: string; writer: string; actor: string; scope: string; ts: number; log_pos: number; data: string; evidence: string | null;
  subject: string | null; seq: string | null; session_id: string | null; project_id: string | null; agent: string | null; unverified: number }
const q = JSON.stringify;
/** An event's JSON text: the record's toJson fields, seq as its decimal string, and `verified` for the unverified mark. */
const eventText = (r: Row): string => `{"v":${r.v},"id":${q(r.id)},"kind":${q(r.kind)},"writer":${q(r.writer)},"actor":${q(r.actor)},"scope":${q(r.scope)},"ts":${r.ts},"log_pos":${r.log_pos},`
  + `"data":${r.data},"evidence":${r.evidence ?? '[]'}${r.subject === null ? '' : `,"subject":${q(r.subject)}`}${r.seq === null ? '' : `,"seq":${q(r.seq)}`}`
  + `${r.session_id === null ? '' : `,"session":${q(r.session_id)}`}${r.project_id === null ? '' : `,"project":${q(r.project_id)}`}${r.agent === null ? '' : `,"agent":${q(r.agent)}`},"verified":${r.unverified ? 'false' : 'true'}}`;

export class Core {
  private readonly root: Root;
  private readonly now: () => number;
  private readonly durable: Durable;
  private record!: RecordStore;
  private asks!: Asks;
  /** Authority at PreToolUse (#321): the planted sorter's proceeds, the servers' tool lists, and the calls held for you. */
  private readonly holds: Holds;
  /** Ask-tasks in the kernel (#303): a task for each prompt you typed that asks for a change, and its definition locked by hash. */
  private readonly tasks: AskTasks;
  /** The gate runner (#29): each claim's checks on its snapshot, in their lanes, under the stop's hold. */
  private readonly gate: GateRunner;
  /** Claims whose head is untrusted (#29): their checks run in the sandbox with no network and no credentials. */
  private readonly untrusted = new Map<string, boolean>();
  /** Each session's last stop's final message, what its claims cite (#29). */
  private readonly lastMessage = new Map<string, string>();
  /** What each claim's stop waits on: its fast lane, and what the hold reports of it. */
  private readonly lanes = new Map<string, Promise<{ fast: string[]; slow: string[]; snapshot: string; fastEndedAt: number; readyAt: number; findings: string[] }>>();
  /** Staging for destructive commands (#347): a delete whose reach can't be worked out, staged copy-on-write or asked about. */
  private readonly staging: Staging;
  private readonly devices: Devices;
  private store!: EvidenceStore;
  private supervisor!: Supervisor;
  /** The kernel's lease table (#237), read by deep env down for who holds a port now, and the gate runner's cpu.slot. */
  private leases!: LeaseTable;
  /** The test's index@1 fill for the wiki, if it named one; the ledger's own index otherwise. */
  private index!: Promise<IndexFill | undefined>;
  /** A package's index, once rebuilt from the pages. */
  private swapped: IndexFill | undefined;
  /** host@1: where every check run starts, is signalled and waited for; the supervisor, unless a test put another in its place. */
  private host!: Host;
  /** env-local's compose kind, with the Docker CLI it found when the hub started (#331). */
  private compose?: ReturnType<typeof composeKind>;
  /** DeepBuild's own headless jobs (#159): their hooks are theirs, never a session's. */
  private runner!: Runner;
  /** Setup's wiki build (#356). */
  private wikiBuild!: { build(): Promise<WikiBuilt>; forget(claim: string): Promise<string> };
  /** The taste calls each session was given since it started, and the sessions whose first prompt was read for its screen (#111). */
  private tasted = new Map<string, Set<string>>();
  private firstPrompted = new Set<string>();
  /** Hooks from a running job's folder held until the runner reads that job's session ID, by job. */
  private readonly parked = new Map<string, Promise<void>>();
  /** Each session a reading named a job for, once. */
  private readonly readings = new Set<string>();
  private readonly ready: Promise<void>;
  private readonly sessions = new Map<string, Session>();
  /** The cursors the last hub left for sessions this one hasn't met yet. */
  private cursors = new Map<string, Cursor>();
  /** The pending write of transcripts.json. */
  private saving: NodeJS.Timeout | undefined;
  /**
   * What the stop rule reads of each session's turns: whether no prompt has come since its start (a startup, a resume
   * or /clear), the prompt its turn began with, and whether the turn made an edit, a write or an ask.
   */
  private readonly counters = new Map<string, Counter>();
  /** The work items prompts name, read off the hook's parse, for the append that opens their tasks. */
  private readonly items = new WeakMap<Draft, WorkItem>();
  /** Unspent PreToolUse stamps: a call that binds to one spends it, and SessionEnd spends its session's. */
  private stamps: Stamp[] = [];
  /** How long each run still going is expected to take, in seconds, by run handle: what the line's "about" reads (#83). */
  private readonly expected = new Map<string, number>();
  /** Each process's start time, as `ps -o lstart=` prints it: how a process is told apart from a reused PID. */
  private readonly starts = new Map<number, Promise<string | undefined>>();
  /** Hooks and calls run in arrival order: a deep_* call finds the stamp its PreToolUse left. */
  private chain: Promise<unknown> = Promise.resolve();
  private blocked: string | undefined;
  /** Unset until the start opened it: a start that fails before has nothing to close or ask. */
  private extensions: ExtensionHost | undefined;
  private readonly runs = new Map<string, { run: Run; done: Promise<void>; stop(): void }>();
  /** The stack `deep env up` started in each worktree, by the worktree's real path, and each one on its way up. */
  private readonly stacks = new Map<string, Stack>();
  /** Each worktree's env up and down, one after another. */
  private readonly turns = new Map<string, Promise<unknown>>();
  /** Every stack run started and not yet cleaned up, a run's or a worktree's, so the hub's stop takes each down. */
  private readonly stackRuns = new Set<string>();
  /** The per-session keys each stack run leased through the table (#332), by lease ID, ended once its processes are gone. */
  private readonly taken = new Map<string, string[]>();
  /** Who leased each stack run's per-session keys: its session's deep mcp, or the core. */
  private readonly owners = new Map<string, string>();
  /** The screen each session's computer use last switched to, one it leases (#332). */
  private readonly onScreen = new Map<string, string>();
  /** Each worktree's stack run while it waits for its health route, so a down can end it rather than wait. */
  private readonly rising = new Map<string, string>();
  private readonly subscribers = new Map<string, number>();
  /** Appends handed to the record and not yet settled: a read waits for them, so it sees every hook acknowledged before it. */
  private readonly inflight = new Set<Promise<unknown>>();
  private streaming = false;
  private restream = false;
  /** The full page after the last one read, built ahead for a reader paging in order. */
  private ahead: { after: number; limit: number; log_pos: number; events: string } | undefined;
  private secrets: { at: number; value: Promise<string> } | undefined;
  private readonly timers: NodeJS.Timeout[] = [];
  /** Each background job's last failure, cleared by its next clean run: a job that keeps failing shows in hub.health. */
  private readonly jobs = new Map<string, { at: number; error: string } | null>();
  private stopping = false;
  private replaying: Promise<unknown> | undefined;
  /** Only the drops-post-tool-use and replay-appends-twice plants read them. */
  private dropped = false;
  private doubled = false;
  /** Whether appends came back during a replay, so the files it kept are taken again after it. */
  private retake = false;
  /** Every session the hooks named, checked or not, by ID. */
  private readonly live = new Map<string, Live>();
  /** The sessions that got their reading for a version past their facts. */
  private readonly versioned = new Set<string>();
  /** The commits recorded, so one made across two hooks is recorded once. */
  private readonly committed = new Set<string>();
  /** The watch on Claude Code's user settings, and the readings it and the session-start recheck took. */
  private watcher: FSWatcher | undefined;
  private settingsKey = '';
  private readonly settingsReadings: string[] = [];
  /** Held stops, each woken when an answer for its session is ready to deliver. */
  private readonly waiting = new Map<string, Set<() => void>>();
  /** deep_wait and deep_run calls, by the ask or run they wait on, each woken by the event that settles it (#823). */
  private readonly settling = new Map<string, Set<() => void>>();
  /** Each session's routes back into it, by session ID. */
  private readonly routes = new Map<string, Routes>();
  /** Answers handed to a waiter that no turn has shown yet, by ask ID. */
  private readonly handed = new Map<string, { session: string; at: number; timer: NodeJS.Timeout }>();
  /** Answers whose delivery timed out because their session couldn't be read, by ask ID, with the session. */
  private readonly unread = new Map<string, string>();
  /**
   * Notes from the app (#340): those waiting for a route into their session, by session; those handed to a waiter
   * that no turn has shown yet, by request ID; and those a prompt's hook carries as its context, for its reply.
   */
  private readonly notes = new Map<string, Note[]>();
  private readonly handedNotes = new Map<string, Note & { timer: NodeJS.Timeout }>();
  private readonly carried = new Map<string, Note[]>();
  /** Each Codex session's turn its last hook named, so a turn no prompt hook started is seen at its first hook. */
  private readonly turnsStarted = new Map<string, string>();
  /**
   * Each session's messages typed mid-turn not yet acknowledged, with the task each opened, and all those of its
   * current turn: the queue the chat line shows (#340).
   */
  private readonly acks = new Map<string, { text: string; task: string | undefined }[]>();
  private readonly midTurn = new Map<string, string[]>();
  /** The repo each session works in, from its hooks' folder: what its events carry as their project (#23). */
  private readonly projects = new Map<string, string>();
  /** The asks raised for permission prompts and saved offers, by handle: their answer is never delivered as a message (#23). */
  private readonly prompts = new Set<string>();
  /** Prompts no decision covered, by session and what the call is, until the call runs and is offered back (#23). */
  private readonly pending = new Map<string, { meta: HookMeta; about: About }>();
  /** Permissions you said yes to in the terminal, offered back as decisions to save, by handle (#23). */
  private readonly offers = new Map<string, { meta: HookMeta; about: About; scope: string }>();
  /** The typed-saves-decision plant's sessions you typed words in. */
  private readonly typedAt = new Map<string, number>();
  /** Each session's promised check (#120): its state as the record has it, the timer for its due time, and whether its one ask was raised. */
  private readonly promises = new Map<string, PromiseState & { timer?: NodeJS.Timeout | undefined; asked?: boolean; handed?: boolean }>();
  /** resolver-decisions with no ledger, asked whether a saved decision covers a prompt before anything is raised (#23). */
  private precheck!: Resolver;

  /**
   * `asking` hears the sessions with an ask still to deliver whenever that set changes, so the event loop holds a stop
   * only where an answer may come back through it (#19: right after install no stop is held for anything else);
   * `acking` hears a session with a message typed mid-turn to acknowledge, so its next tool call's hook is held (#340).
   */
  constructor(private readonly options: CoreOptions, private readonly emit: (sub: string, event: string) => void, private readonly asking: (sessions: string[], judged: string[]) => void = () => undefined, private readonly acking: (session: string) => void = () => undefined, private readonly scrubbing: (values: string[]) => void = () => undefined) {
    this.root = rootOf(options.root);
    this.now = () => options.clock.start + (Date.now() - options.clock.real);
    this.durable = options.vfs ? testVfs(options.vfs) : disk;
    this.devices = new Devices(this.root.devices);
    this.holds = new Holds({
      raw: (query, params) => this.record.raw(query, params), asks: () => this.asks, now: this.now, plant: options.plant, sorter: options.sorter,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
      pin: (cwd, question) => this.pinOf(cwd, question),
    });
    this.staging = new Staging({
      root: this.root.dir, raw: (query, params) => this.record.raw(query, params), now: this.now, plant: options.plant, holds: this.holds,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
    });
    this.tasks = new AskTasks({
      raw: (query, params) => this.record.raw(query, params), asks: () => this.asks, now: this.now, plant: options.plant, drafts: options.drafts, work: options.work,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
      pin: (cwd, question) => this.pinOf(cwd, question), keep: (bytes, source) => this.keep(bytes, source), run: (r) => this.runClaim(r),
      invalid: (claim, commit, reason) => this.invalid(claim, commit, reason),
    });
    this.gate = new GateRunner({
      raw: (query, params) => this.record.raw(query, params), now: this.now, append: (connection, input) => this.append(connection, input), core: this.connection('core'),
      start: (r) => this.runApproved(r), ended: (run) => this.runEnded(run),
      slots: () => ({ free: Math.max(0, Math.floor(availableParallelism() / 2) - this.runs.size) }),
      // The design's 10 s fast-lane budget and 60 s hold, proposals until the dogfood week measures them (#43).
      budget_ms: 10_000, hold_ms: STOP_HOLD_MS,
    });
    this.ready = this.init();
    // A start that fails stops nothing else; each call then reports why.
    this.ready.catch(() => undefined);
  }

  /** Resolves once the record is open, the spool replayed and runs recovered; rejects with why it couldn't start. */
  started(): Promise<void> {
    return this.ready;
  }

  private async init(): Promise<void> {
    this.store = await openEvidenceStore({ root: this.root.evidence, now: this.now });
    const storage = this.durable.backend();
    // Each event its own commit: the durable write points a run makes depend only on the events it appends,
    // never on how many arrived together, so a cut at any one can be replayed.
    this.record = await openRecord({ path: this.root.ledger, now: this.now, evidence: this.store, commitEach: true, ...(storage ? { storage } : {}) });
    if (process.env.DEEP_HUB_TEST_CRASH) this.record = crashing(this.record, process.env.DEEP_HUB_TEST_CRASH);
    if (process.env.DEEP_HUB_TEST_READS) this.record = readsLogged(this.record, process.env.DEEP_HUB_TEST_READS);
    // Every append reaches the stream, whoever appends it: the hub, the asks core, the supervisor or the leases.
    this.record = streamed(this.record, ({ kind, subject, data }) => {
      this.stream();
      if (kind.startsWith('ask.') || kind.startsWith('delivery.')) this.askingSoon();
      // A deep_wait or deep_run waiting on what this event settles reads it again now, and answers before the
      // appender's next commit holds this thread with its sync (#823).
      const about = kind === 'decision.applied' && isObj(data) ? data.ask : subject;
      const woken = typeof about === 'string' ? [...this.settling.get(about) ?? []] : [];
      for (const wake of woken) wake();
      return woken.length ? new Promise((done) => setImmediate(done)) : undefined;
    });
    // A start that finds the last run still marked running records that run's stop as a crash.
    try {
      // A cursor whose transcript is gone has no session left to judge.
      this.cursors = new Map(Object.entries(JSON.parse(readFileSync(this.root.transcripts, 'utf8')) as Record<string, Cursor>).filter(([, c]) => typeof c?.transcript === 'string' && existsSync(c.transcript)));
    } catch {
      // None yet, or unreadable: the sessions are read from where this hub meets them.
    }
    const crashed = existsSync(this.root.state) && readFileSync(this.root.state, 'utf8').trim() === 'running';
    this.writeState('running');
    if (crashed) await this.appendCore('hub.stopped', { reason: 'crashed' });
    // Opening the supervisor reaps what the record says a run left before this start.
    const asks = this.asks = await openAsks({ record: this.record, now: this.now, deliver: (d) => this.answered(d), home: this.root.dir });
    this.askingSoon();
    // Every second, once an open ask's deadline has passed, the asks core takes its default (showing it first if it
    // hadn't shown), so no ask waits on a read. With none due it reads nothing, so a backfill never feeds it.
    const due = async (): Promise<boolean> => (await this.record.raw(`SELECT 1 FROM asks WHERE status IN ('open', 'later') AND deadline <= ${this.now()} LIMIT 1`)).length > 0;
    if (this.options.plant !== 'skip-default-at-deadline') this.every('asks', 1000, async () => { if (await due()) await asks.tick(); });
    this.index = openIndex(this.root.wiki, this.options.index);
    this.index.catch(() => undefined);
    // Compose's own folder sits in the hub's, which no run writes: the files a compose stack runs are the hub's.
    const compose = this.compose = composeKind(join(this.root.dir, 'compose'));
    // env-local's port kind (#331): ports from 3000 up, each checked free before it is leased.
    const port = portKind({ free: this.options.plant !== 'env-leases-port-again' });
    // The kernel's one lease table (#237): env-local declares its kinds there with their free checks, the core its
    // cpu.slot, and the supervisor takes every run's keys through it.
    const leases = this.leases = await openLeases({ record: this.record, now: this.now, ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}) });
    for (const kind of leaseKinds) await leases.declare('env-local', kind, [port, compose].find((k) => k.kind === kind.name)?.free);
    this.every('leases', 1000, () => leases.tick());
    this.supervisor = await openSupervisor({
      record: this.record, asks, now: this.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } },
      resources: [port, compose], leases,
      ...(this.options.plant === 'env-holds-lease-for-helper' ? { plant: 'holds-lease-while-taken' as const } : {}),
      ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}),
      ...(this.options.crash ? { crash: this.options.crash } : {}),
      // No run, run-as-you included, writes the record, the agents' config folders or the Node the hub runs on;
      // the sandbox profile itself keeps every project's agent hook and MCP files. The runner's jobs/ is left to
      // each run's own grant: a job's checkout writes only its own folder.
      guarded: [
        { path: this.root.dir, except: [join(this.root.dir, 'jobs')] }, join(homedir(), '.claude'), join(homedir(), '.codex'), realpathSync(resolve(fileURLToPath(import.meta.url), '../../..')),
        join(homedir(), 'Library', 'LaunchAgents'),
        process.execPath, resolve(process.execPath, '../../lib/node_modules'),
        ...[process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME].filter((p): p is string => !!p && isAbsolute(p)),
        ...compose.guarded,
      ],
    });
    // The keys a stack leased per session before this start (#332): its processes were reaped as the supervisor opened,
    // so each ends now that the record proves them gone.
    for (const v of await leases.leases()) {
      if (!SESSION_KINDS.includes(v.lease.resource.kind) || !(v.lease.holder === 'core' || v.lease.holder.startsWith('mcp:'))) continue;
      const [row] = (await this.record.raw(`SELECT json_extract(data, '$.run') AS run FROM events WHERE kind = 'lease.acquired' AND subject = ? LIMIT 1`, [v.lease.id])) as { run: string | null }[];
      if (!row?.run) continue;
      this.taken.set(row.run, [...(this.taken.get(row.run) ?? []), v.lease.id]);
      await this.giveBack(row.run).catch(() => undefined);
    }
    this.host = this.options.host
      ? ((await import(pathToFileURL(this.options.host).href)) as { default: (local: Host) => Host }).default(this.supervisor)
      : this.supervisor;
    this.every('supervisor', 1000, () => this.supervisor.tick());
    const config = this.config();
    const ledger = await openLedger({ record: this.record, asks, now: this.now, price: async () => null });
    // resolver-decisions ships on by default (#23): your saved decisions, and the budgets you approved, answer the
    // asks they cover, each answer gated by the core.
    asks.registerResolver('resolver-decisions', resolverDecisions({ record: this.record, ledger }));
    this.precheck = resolverDecisions({ record: this.record });
    await this.syncStanding().catch(() => undefined);
    this.every('rules', HOUR, () => this.judgeRules());
    // The runner reaps or reports what a crash cut, and ticks itself.
    this.runner = await openRunner({
      record: this.record, asks, supervisor: this.supervisor, ledger, now: this.now, root: this.root.dir, loginPath: config.loginPath, env: process.env, keychain,
      settings: { plan: { reserve_pct: config.reservePct }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    });
    // Every installed extension loads, sandboxed until a signed release lists it; one refused is named and left out.
    const trust = await openTrust({ record: this.record, now: this.now });
    const extensions = this.extensions = await openExtensionHost({ record: this.record, supervisor: this.supervisor, trust, home: this.root.dir, release: [], now: this.now, leases });
    for (const pkg of await extensions.installed()) {
      // One installed by a hub that ran no conformance at install has no kept result: it runs now, once, so the
      // package loads from its result at this start and each later one, as one installed since #785 does. A check
      // that can't run (an untrusted project) is left to the load's refusal, which names it.
      if (!extensions.checked(pkg)) await extensions.check(pkg).catch(() => undefined);
      const load = await extensions.load(pkg);
      if (load.status === 'refused') process.stderr.write(`deep hub: extension ${pkg.id}@${pkg.version} not loaded: ${load.reason}\n`);
    }
    await this.replaySpool();
    // The replay is done: the extensions start, and each that can't is unloaded and named.
    await extensions.ready().catch((error: unknown) => process.stderr.write(`deep hub: ${error instanceof Error ? error.message : String(error)}\n`));
    // A session that ended with turns still to judge sends no hook again: they are judged now.
    for (const [id, cursor] of this.cursors) {
      if (typeof cursor.ended?.agent !== 'string' || typeof cursor.read !== 'number' || !Array.isArray(cursor.reached)) continue;
      this.cursors.delete(id);
      const session: Session = { id, thread: id, agent: cursor.ended.agent, pid: 0, start: '', cwd: '', transcript: cursor.transcript, ended: true, read: cursor.read, turn: undefined, closed: [], reached: new Set(cursor.reached), pending: new Map(), prompts: new Map(), entries: [] };
      this.sessions.set(id, session);
      await this.readTranscript(session);
      this.endTurn(session);
      this.judge(session);
    }
    await this.judgedAcrossRestart();
    await this.recoverRuns();
    await this.retain();
    this.every('retention', DAY, () => this.retain());
    // Each staged copy is let go at its set time (#347): at start, then once an hour.
    await this.staging.prune().catch(() => undefined);
    this.every('staging', HOUR, () => this.staging.prune());
    // The transcript archive (#20) copies what the agents' cleanups would delete, and the CI runs of the GitHub repos
    // recent sessions worked in before the forge's retention deletes them: at start, then once an hour, one pass at a time.
    const env: Record<string, string | undefined> = { ...process.env };
    const repos: string[] = [];
    const archive = await openArchive({
      record: this.record, evidence: this.store, asks, adapters: shipped(), transcripts: MEMORY_TRANSCRIPTS, env, connection: this.connection('ext:deepbuild/archive'), now: this.now,
      held: () => this.options.held, forge: { api: this.options.forge ?? 'https://api.github.com', repos },
      // A session's copy is recorded under the repo its folder is in, so what it says reaches that repo's page (#356).
      projectOf: (cwd, agent) => projectOf(cwd, agent, this.options.plant),
    });
    let archiving: Promise<void> | undefined;
    const archivePass = () => {
      archiving ??= (async () => {
        env.GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? (await ghToken());
        // With no token the forge's logs can't be read, so no run is asked for.
        repos.splice(0, repos.length, ...(env.GH_TOKEN ? await this.forgeRepos() : []));
        await archive.pass();
      })().catch((error: unknown) => { process.stderr.write(`deep hub: archive: ${error instanceof Error ? error.message : String(error)}\n`); }).finally(() => { archiving = undefined; });
      return archiving;
    };
    archivePass();
    // Setup's wiki build (#356) starts from a pass of its own, after the one at start has finished.
    this.wikiBuild = openWikiBuild({
      record: this.record, root: this.root, store: this.store, runner: this.runner, asks, now: this.now, archive: async () => { await archiving; await archivePass(); },
      core: this.connection('core'), cli: this.connection('cli'), plant: this.options.plant, held: this.options.held,
    });
    this.timers.push(setInterval(archivePass, HOUR));
    // While appends fail, a small synced write is tried every quarter second; the gates come back with it.
    this.timers.push(setInterval(() => { if (this.blocked && this.durable.probe(this.root.dir)) { this.blocked = undefined; this.replayLate(true); } }, 250));
    // Between session starts, a removed or weakened entry of ours in Claude Code's settings goes back at once.
    if (this.options.plant !== 'restores-at-session-start-only') this.watchSettings();
    // The promised checks the record still holds wait on, armed again (#120).
    await this.restorePromises().catch(() => undefined);
    for (const timer of this.timers) timer.unref();
  }

  /** What setup wrote to <root>/config.json for the runner: the login shell's PATH and the plan's reserve. */
  private config(): { loginPath: string; reservePct: number; rules: { margin: number; windowMs: number } } {
    let c: Obj = {};
    try { c = JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as Obj; } catch { /* none yet: no binary resolves, so every job is refused saying so */ }
    const runner = isObj(c.runner) ? c.runner : {};
    const plan = isObj(c.plan) ? c.plan : {};
    // Standing rules are judged at this margin over this window (#23): the design's 1.5 and 30 days unless you set them.
    const rules = isObj(c.rules) ? c.rules : {};
    return {
      loginPath: typeof runner.login_path === 'string' ? runner.login_path : '',
      reservePct: typeof plan.reserve_pct === 'number' ? plan.reserve_pct : 10,
      rules: { margin: typeof rules.margin === 'number' ? rules.margin : 1.5, windowMs: (typeof rules.window_days === 'number' ? rules.window_days : 30) * DAY },
    };
  }

  /** One round of judging your standing rules by what later broke, at the margin and over the window in your settings (#23). */
  private async judgeRules(): Promise<void> {
    const { margin, windowMs } = this.config().rules;
    for (const e of await evidence({ record: this.record, now: this.now(), window: windowMs })) {
      await this.asks.judged(this.connection('core'), e.decision, { rule: e.rule, yours: e.yours, margin, judgment: judge(e.rule, e.yours, margin) });
    }
    await this.syncStanding();
    await syncRejected((q) => this.record.raw(q), this.root.dir);
  }

  private writeState(state: 'running' | 'stopped'): void {
    writeFileSync(`${this.root.state}.tmp`, `${state}\n`, { mode: 0o600 });
    renameSync(`${this.root.state}.tmp`, this.root.state);
  }

  // ---- Appends.

  private connection(writer: string, extra: Partial<Connection> = {}): Connection {
    const project = extra.project ?? (extra.session ? this.projects.get(extra.session) : undefined);
    return { writer, ...YOU, ...(project ? { project } : {}), ...extra };
  }
  /** Appends one event; a storage failure turns every gate watch-only, BLOCKED, until a write succeeds again. */
  private async append(connection: Connection, input: EventInput, backfill = false): Promise<void> {
    const appended = this.record.append(connection, input);
    // No read waits for a backfill: nobody was acknowledged for its events.
    if (!backfill) this.inflight.add(appended);
    try {
      await appended;
    } catch (error) {
      if (error instanceof RecordError && error.code === 'storage') this.blocked = `BLOCKED: appends fail: ${error.message}`;
      throw error;
    } finally {
      this.inflight.delete(appended);
    }
  }
  private appendCore(kind: string, data: Obj, extra: { subject?: string; evidence?: string[]; v?: number } = {}): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core'), { v: 1, id: ulid(ts), kind, ts, data: data as JsonValue, ...extra });
  }
  /**
   * A background job, run every `ms`: no caller waits on it, so its last failure is kept for hub.health instead of
   * dropped, and its next clean run clears it.
   */
  private every(name: string, ms: number, job: () => Promise<unknown>): void {
    this.jobs.set(name, null);
    this.timers.push(setInterval(() => void this.run(name, job), ms));
  }
  private async run(name: string, job: () => Promise<unknown>): Promise<void> {
    try {
      await job();
      this.jobs.set(name, null);
    } catch (error) {
      this.jobs.set(name, { at: this.now(), error: error instanceof Error ? error.message : String(error) });
    }
  }
  /** A session.reading for the session, appended as the core. */
  private appendReading(session: string, agent: string, reading: string): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core', { session, agent }), { v: 1, id: ulid(ts), kind: 'session.reading', ts, data: { reading } });
  }

  // ---- Hooks.

  /**
   * One hook's events, checked and handed to the record in the order hooks arrived; the next hook waits only
   * for that, not for the commit. Resolves once each append settled.
   */
  hook(drafts: Draft[], meta: HookMeta, writer: string): Promise<void> {
    this.track(meta);
    // What deep-hook spooled ran before this hook, so a replay this hook starts, or one running, goes first.
    this.replayLate();
    const replayed = this.replaying ?? Promise.resolve();
    return replayed.then(() => this.queue(() => this.handleHook(drafts, meta, writer))).then(({ settled }) => settled);
  }
  /**
   * A hook reaching the running hub shows it answers again: what deep-hook spooled while the hub was late is
   * replayed then, beside the hooks that follow, rather than at the next start.
   */
  private replayLate(kept = false): void {
    if (this.stopping) return;
    if (this.replaying) {
      this.retake ||= kept;
      return;
    }
    // A file a failed replay kept is taken again once appends work again.
    const waiting = existsSync(join(this.root.spool, SPOOL)) || (kept && existsSync(this.root.spool) && readdirSync(this.root.spool).some((f) => f.endsWith('.jsonl')));
    if (!waiting) return;
    // A hub that couldn't start replays nothing; its start reports why.
    this.replaying = this.ready
      .then(() => this.replaySpool(), () => undefined)
      .catch((error: unknown) => process.stderr.write(`deep hub: the spool replay stopped: ${error instanceof Error ? error.message : String(error)}\n`))
      .finally(() => {
        this.replaying = undefined;
        // The turns that waited on the replay are judged now, after the hooks queued before.
        void this.queue(async () => {
          for (const session of this.sessions.values()) {
            if (!session.deferred) continue;
            session.deferred = false;
            this.judge(session);
          }
        }).catch(() => undefined);
        // What was spooled during the replay, and the files it kept if appends came back, are taken now.
        const kept = this.retake;
        this.retake = false;
        if (!this.blocked) this.replayLate(kept);
      });
  }
  /** Runs `work` after everything queued before it, and after the start, which the spool replay is part of. */
  private queue<T>(work: () => Promise<T>, starting = false): Promise<T> {
    const done = this.chain.then(() => (starting ? undefined : this.ready)).then(work);
    this.chain = done.catch(() => undefined);
    return done;
  }
  private async handleHook(drafts: Draft[], meta: HookMeta, writer: string, replayed = false, waited = false): Promise<{ settled: Promise<void> }> {
    // The planted wrong program answers the first PostToolUse it reads and appends nothing for it.
    if (this.options.plant === 'drops-post-tool-use' && meta.event === 'PostToolUse' && !this.dropped) {
      this.dropped = true;
      return { settled: Promise.resolve() };
    }
    // A spooled line whose hook the hub already recorded live changes nothing: no count, no stamp, no append.
    if (replayed && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(meta.id)) {
      // Its live copy may be acknowledged and still on its way to the record.
      await Promise.allSettled([...this.inflight]);
      const known = await this.record.raw(`SELECT json_extract(data, '$.late') AS late FROM events WHERE id = ? LIMIT 1`, [meta.id]);
      if (known.length) {
        // Unless deep-hook gave up on an acknowledgement the hub sent just too late: the live copy is in the record
        // unmarked while deep-hook acted on its own, so the session says so rather than the fail-open going unseen.
        if (meta.late && Number((known[0] as { late?: unknown }).late) !== 1) return { settled: this.lateAnswered(meta, meta.late.matched) };
        return { settled: Promise.resolve() };
      }
    }
    // A call whose prompt went to you has run, live or replayed: offered back as a decision to save (#23).
    if (meta.event === 'PostToolUse' && meta.call) void this.offerBack(meta).catch(() => undefined);
    if (drafts.some((d) => d.kind === 'session.end' && d.data.reason === 'clear')) await this.replaced(meta.session);
    if (meta.event === 'UserPromptSubmit' && this.options.plant === 'typed-saves-decision') {
      this.typedAt.set(meta.session, Date.now());
      void this.typedSaves(meta.session).catch(() => undefined);
    }
    const whose = await this.whose(meta, drafts.find((d) => d.seq !== undefined)?.seq);
    if (whose.job) {
      const settled = this.appendCore('job.event', { job: whose.job, event: meta.event });
      settled.catch(() => undefined);
      return { settled };
    }
    if (whose.wait && !waited) {
      // Held, not queued: the hooks behind it go on; it is read again once its job's session ID is known.
      const settled = this.park(whose.wait).then(() => this.queue(() => this.handleHook(drafts, meta, writer, replayed, true))).then(({ settled: s }) => s);
      settled.catch(() => undefined);
      return { settled };
    }
    if (whose.reading && !this.readings.has(`${meta.session}\0${whose.reading.job}`)) {
      this.readings.add(`${meta.session}\0${whose.reading.job}`);
      await this.appendReading(meta.session, meta.agent, whose.reading.text).catch(() => undefined);
    }
    // A session on a version its facts don't cover is recorded unverified, with one reading naming the version.
    if (!meta.version && meta.transcript) {
      const version = versionOf(meta.transcript);
      if (version) Object.assign(meta, { version, ...(coveredBy(meta.agent, version) ? {} : { watchOnly: true }) });
    }
    const verified = meta.watchOnly ? false : await this.verify(meta);
    if (meta.watchOnly && meta.session && !this.versioned.has(meta.session)) {
      this.versioned.add(meta.session);
      await this.appendReading(meta.session, meta.agent, `This session runs ${meta.agent} ${meta.version}, past the versions its facts cover: it is recorded unverified, and its holds and blocks are watch-only until the live smoke test widens the range to ${meta.version}.`).catch(() => undefined);
    }
    const session = this.sessions.get(meta.session);
    if (session && (verified || this.options.plant === 'ends-binding')) {
      // Only an event checked against its session acts on it: an unverified SessionEnd ends nothing.
      // pi resumes a session it replaced in the same process, so the same session can start again.
      if (meta.event === 'SessionStart' && meta.agent === 'pi') session.ended = false;
      if (meta.event === 'SessionEnd') {
        session.ended = true;
        this.endStacks(session.id);
        this.stamps = this.stamps.filter((stamp) => stamp.session !== session.id);
      }
      // A replayed PreToolUse was let through late; its call has run, so it stamps nothing a later call could bind.
      if (verified && meta.stamp && !replayed) this.stamps.push({ session: session.id, tool: meta.stamp.tool, digest: meta.stamp.digest });
    }
    const call = session && verified && drafts.length ? meta.toolUse : undefined;
    if (session && call) session.pending.set(call, (session.pending.get(call) ?? 0) + 1);
    // A switch to a leased screen counts once it ran: Claude Code sends PostToolUse only for a call that succeeded (#332).
    if (session && verified && meta.event === 'PostToolUse' && meta.call && /(^|_)switch_display$/.test(meta.call.tool) && SCREEN_TOOLS.some((prefix) => meta.call!.tool.startsWith(prefix))) await this.switched(session.id, String(meta.call.input.display ?? ''));
    if (session && verified) {
      await this.readTranscript(session);
      if (meta.event === 'SessionEnd') this.endTurn(session);
      this.judge(session);
      // Written at once, like a session's first cursor: no later hook of the session would write it.
      if (meta.event === 'SessionEnd') this.writeCursors();
    }
    await this.enrich(drafts, meta, session && verified ? session : undefined);
    // After a restart the core knows a session's state from its next hook on; a person's status question, which
    // changes none, takes the row's before the prompt's event reads as work (#83). Read before the queue's splice,
    // which may take the prompt's own draft.
    if (session && verified && !replayed && meta.event === 'UserPromptSubmit' && isStatusQuestion(meta.fields?.prompt ?? '') && drafts.some((d) => d.kind === 'user.ask' && d.data.from === 'person')) {
      const live = this.liveOf(meta);
      if (live.state === undefined) {
        const [row] = (await this.record.raw(`SELECT status FROM sessions WHERE id = ?`, [meta.session])) as { status: string | null }[];
        if (row?.status) live.state = row.status;
      }
    }
    if (session && verified && !replayed) {
      if (meta.agent === 'codex') await this.promptless(drafts, meta, session);
      this.queuedAsks(drafts, session, meta.event);
      if (meta.event === 'UserPromptSubmit') this.appNotes(drafts, meta.session);
    }
    const count = this.counters.get(meta.session) ?? await this.counterOf(meta.session);
    const live = this.liveOf(meta);
    let claimed = false;
    const typed: { text: string; task: string | undefined }[] = [];
    const appends = drafts.flatMap((draft) => {
      const data = { ...draft.data };
      const opens: Promise<void>[] = [];
      if (draft.kind === 'session.start') count.fresh = true;
      if (draft.fill === 'msg') data.msg = count.msgs++;
      if (draft.kind === 'user.ask') {
        // A prompt you typed that asks for a change opens a task: the issue it names, or the message that asked for it.
        const item = this.items.get(draft);
        let tasks = this.tasks.tasksOf({ session: meta.session, msg: Number(data.msg), text: String(data.text), from: String(data.from), queued: draft.queued === true, first: data.msg === 0 });
        if (item && tasks.length) tasks = [`task:${letters(item.source_id)}`];
        // Kept on the draft too: the turn it opens reads its task there (#83).
        draft.data.tasks = data.tasks = tasks;
        // A message typed mid-turn joins its turn; the turn's own prompt is what an answer begins with.
        if (childPrompt(meta)) { /* the root's turn reads no prompt of its subagent's */ }
        else if (draft.queued && count.prompt) count.prompt.opened ||= tasks.length > 0;
        else {
          count.prompt = { person: data.from === 'person' || data.from === 'app', opened: tasks.length > 0 };
          this.midTurn.delete(meta.session);
        }
        // Each message typed mid-turn is acknowledged at the session's next tool call (#340).
        if (draft.queued && data.from === 'person' && verified) typed.push({ text: String(data.text), task: tasks[0] });
        if (!childPrompt(meta)) {
          count.fresh = false;
          count.changed = false;
        }
        const session = this.sessions.get(meta.session);
        if (session && verified) {
          for (const task_ref of tasks) opens.push(this.tasks.opened({ session: meta.session, agent: meta.agent, cwd: meta.cwd, thread: session.thread, task_ref, text: String(data.text), prompt: draft.id, at: draft.ts, ...(item ? { item } : {}) }));
        }
      }
      if (draft.fill === 'turn') {
        data.turn = ++count.turns;
        data.did_work = count.worked;
        // The stop rule (#303): a stop with no prompt since startup, a resume or /clear is no claim, and neither is an
        // answer, a turn begun by a prompt you typed that opened no task, with no edit, write or ask in it.
        data.claim = this.stopRule(count);
        if (data.claim && verified) claimed = true;
        // The stop is judged as the rule reads it (#83): a turn's claim stands until a prompt opens the next turn,
        // and a stop with work the rule reads as no claim (an answer) is not judged, whatever was told ahead.
        if (verified && count.worked) live.judged = Boolean(data.claim);
        count.worked = false;
        count.changed = false;
      }
      if (draft.kind === 'tool.after') {
        count.worked = true;
        if (!READS.has(String(data.kind))) {
          count.changed = true;
          // A call of DeepBuild's own tools (the claim itself, a run, an ask) changes no code: the turn's claim stands (#83).
          if (!(data.kind === 'mcp' && data.server === 'deep')) live.workedSinceClaim = true;
        }
      }
      // What the rule would read of a stop now, told ahead so the stop is held for its line (#83).
      if (verified && draft.fill !== 'turn' && !live.judged && this.stopRule(count)) { live.judged = true; this.askingSoon(); }
      // A session's events carry the repo it works in, so your answer there is saved for the repo (#23).
      const project = repoOf(meta.cwd);
      if (project && meta.session) this.projects.set(meta.session, project);
      const connection = this.connection(writer, { ...(meta.session ? { session: meta.session } : {}), agent: meta.agent, verified });
      // The tasks a prompt opens are appended after it, as the core.
      return [this.append(connection, {
        v: draft.v, id: draft.id, kind: draft.kind, ts: draft.ts, ...(draft.seq !== undefined ? { seq: draft.seq } : {}), ...(draft.subject ? { subject: draft.subject } : {}), data: data as JsonValue,
      }), ...opens];
    });
    this.follow(drafts, meta, verified);
    if (typed.length) {
      this.acks.set(meta.session, [...(this.acks.get(meta.session) ?? []), ...typed]);
      this.midTurn.set(meta.session, [...(this.midTurn.get(meta.session) ?? []), ...typed.map((t) => t.text)].slice(-32));
      this.acking(meta.session);
    }
    const settled = Promise.allSettled(appends).then((results) => {
      // A conflict is an ID the log already holds: a spool replayed again, whose event is there once already.
      const failed = results.filter((r) => r.status === 'rejected' && !(r.reason instanceof RecordError && r.reason.code === 'conflict'));
      for (const result of failed) {
        if (result.status === 'rejected' && !(result.reason instanceof RecordError && result.reason.code === 'storage')) {
          process.stderr.write(`deep hub: hook ${meta.id} (${meta.event}) not recorded: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`);
        }
      }
      if (failed.length) throw Error(`hook ${meta.id} was not recorded`);
    });
    settled.catch(() => undefined);
    // A stop that leaves the agent's question open is recorded as waiting on you once the stop is in the record (#27).
    if (meta.event === 'Stop' && drafts.some((d) => d.kind === 'agent.stop' && d.data.outcome !== 'failed')) {
      void settled.then(async () => { if (await this.asksYou(meta.session)) await this.attention(meta.session, meta.agent, 'waiting'); }).catch(() => undefined);
    }
    // A stop the rule reads as a claim recomputes its tasks' definitions' hashes once the stop is in the record; the
    // agent's final message is what the claim cites, for the validity gate (#29).
    if (claimed) this.lastMessage.set(meta.session, meta.fields?.last_assistant_message ?? '');
    if (claimed) live.claiming = settled.then(() => this.tasks.claim(meta.session, meta.agent, meta.cwd)).catch((error: unknown): string[] => { process.stderr.write(`deep hub: the claim at ${meta.id} was not recorded: ${error instanceof Error ? error.message : String(error)}\n`); return []; });
    // A call reaches the hub once its hook's event is durable, never before: a restart trusts the cursors kept.
    // Its turn is judged once the append settles, however long past the grace that is.
    if (session && call) {
      void settled.then(() => {
        session.reached.add(call);
      }, () => undefined).finally(() => {
        const left = session.pending.get(call)! - 1;
        if (left) session.pending.set(call, left);
        else session.pending.delete(call);
        // Judged in the start too, as its replay is: queued behind the start, it would hold up the replay that ends it.
        void this.queue(async () => this.judge(session), true).catch(() => undefined);
      });
    }
    return { settled };
  }

  // ---- What the core reads beside a session's hooks (#18).

  private liveOf(meta: HookMeta): Live {
    let live = this.live.get(meta.session);
    if (!live) this.live.set(meta.session, (live = { agent: meta.agent, cwd: meta.cwd, last: 0, calls: new Map(), wakeups: [], crons: new Map(), background: 0, looping: false, turn: 0, judged: false }));
    return live;
  }
  /** A request line the adapters map, for a payload the core rebuilt from what the parser kept of the hook. */
  private mapped(meta: HookMeta, draft: Draft, payload: Obj, transcript: readonly Obj[]): Obj | undefined {
    if (meta.agent === 'pi') return undefined;
    const name = meta.agent === 'codex' ? 'codex' : 'claude';
    const adapter = registry().get(name);
    const version = ((adapter.facts as Obj).versions as string[]).at(-1)!;
    const line = { v: 1 as const, agent: name, event: meta.event, seq: draft.seq ?? '0', id: draft.id, pid: meta.pid, ppid: meta.ppid, matched: [], payload: { session_id: meta.session, hook_event_name: meta.event, ...payload } as JsonValue };
    return adapter.mapHook(line, version, transcript as JsonValue[]).events.find((e) => e.kind === draft.kind)?.data as Obj | undefined;
  }

  /** Fills what the core reads beside a hook, off the parser: what a session loads, a prompt's origin, a stop's records and loop. */
  private async enrich(drafts: Draft[], meta: HookMeta, session: Session | undefined): Promise<void> {
    if (!meta.session) return;
    const live = this.liveOf(meta);
    const foreign = FOREIGN.has(meta.agent);
    for (const draft of drafts) {
      const data = draft.data;
      // The pull request a `gh pr create` call opened, read once off its own PostToolUse (#83).
      if (draft.kind === 'tool.after' && meta.pr) await this.openedPr(meta.session, live.agent, meta.pr);
      if (draft.kind === 'session.start') {
        data.loads = await loadsOf(meta.cwd).catch(() => []);
        // Each server's tool list, read off this hook's path: recorded after the start, its changes held for you.
        if (!foreign && session) void this.holds.listed(meta.session, live.agent, meta.cwd).catch((error: unknown) => process.stderr.write(`deep hub: tool lists for ${meta.session} not recorded: ${error instanceof Error ? error.message : String(error)}\n`));
        if (!foreign) await this.recheck().catch(() => undefined);
        if (session) {
          data.thread = session.thread = await this.threadOf(session, meta.fields?.source);
          void this.childOf(session, live.agent).catch(() => undefined);
        }
      } else if (draft.kind === 'user.ask') {
        // The origin joins the prompt to its transcript entry; one it can't place is unknown and opens no ask.
        const entry = meta.fields?.prompt_id && session ? (await this.turnFrom(session, meta.fields.prompt_id))[0] : undefined;
        // A Codex subagent's prompt carries the root's session ID with an agent_id: no message of yours, nor the root's turn (#39).
        if (childPrompt(meta)) { data.from = 'subagent'; continue; }
        let from = foreign ? 'unknown' : String(this.mapped(meta, draft, { ...meta.fields }, entry ? [entry] : [])?.from ?? data.from);
        if (from === 'unknown' && !foreign && this.options.plant === 'unplaced-is-person') from = 'person';
        // The planted wrong programs take an automatic continuation for yours, or read the resume prompt by its look.
        if (from === 'continuation' && this.options.plant === 'continuation-as-person') from = 'person';
        if (this.options.plant === 'continuation-by-likeness' && String(data.text).startsWith('The app was quit while you were working')) from = 'continuation';
        data.from = from;
        live.from = from;
        if (from === 'person' && !foreign) {
          const item = await this.tasks.itemOf(String(data.text));
          if (item) this.items.set(draft, item);
        }
        // A subagent's report ends its wait; a scheduled prompt fires its one-shot crons.
        if (from === 'subagent') live.background = Math.max(0, live.background - 1);
        if (from === 'scheduled') for (const [id, cron] of live.crons) if (!cron.recurring) live.crons.delete(id);
      } else if (draft.kind === 'tool.after' && meta.loop) {
        const fact = meta.loop;
        if ('scheduled' in fact) { if (fact.scheduled !== null) live.wakeups.push(draft.ts + fact.scheduled); }
        else if ('cron' in fact) live.crons.set(fact.cron, { due: fact.due, recurring: fact.recurring });
        else if ('cancelled' in fact) live.crons.delete(fact.cancelled);
        else live.background += 1;
      } else if (draft.kind === 'agent.stop' && !draft.data.subagent) {
        await this.stopRecords(draft, meta, session);
        const loop = this.loopAt(live);
        if (loop) data.loop = loop;
        if (session && meta.agent === 'codex' && !meta.fields?.agent_id && !meta.watchOnly) await this.codexStop(meta, data, live).catch(() => undefined);
        // A check the agent promises for later becomes a wake-up (#120); a subagent's stop promises nothing to you.
        if (session && !meta.fields?.agent_id) await this.promised(meta).catch(() => undefined);
      }
    }
  }

  // ---- Long waits and promised checks (#120; design: Before each command, "Commands end.").

  /** An event about a session, appended as the core. */
  private appendSession(session: string, agent: string, kind: string, data: Obj): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core', { session, agent }), { v: 1, id: ulid(ts), kind, ts, subject: `session:${letters(session)}`, data: data as JsonValue });
  }
  /**
   * The waits as the record holds them, for a hub starting on it (#120): how long each command took before, and
   * each session's turn and calls still running, with the last line its chat could read and each call's overrun.
   */
  async waitsState(): Promise<{ history: [string, number][]; sessions: Restored[] }> {
    await this.ready;
    // One read of the recent events, paired by call in memory: no join the database could not index.
    const events = (await this.record.raw(`SELECT e.session_id AS session, e.kind, e.ts, e.data, s.agent, s.worktree FROM events e JOIN sessions s ON s.id = e.session_id
      WHERE e.kind IN ('user.ask', 'agent.stop', 'session.end', 'tool.before', 'tool.after', 'session.reading', 'call.overrun') AND e.log_pos > (SELECT COALESCE(MAX(log_pos), 0) - 20000 FROM events) ORDER BY e.log_pos`)) as { session: string; kind: string; ts: number; data: string | Obj; agent: string | null; worktree: string | null }[];
    const history: [string, number][] = [];
    const befores = new Map<string, { ts: number; key: string }>();
    const state = new Map<string, Restored>();
    for (const e of events) {
      const d = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data) as Obj;
      let r = state.get(e.session);
      if (!r) state.set(e.session, r = { session: e.session, agent: e.agent ?? 'agent', cwd: e.worktree ?? '', lastLine: e.ts, open: [] });
      const call = typeof d.call === 'string' ? d.call : undefined;
      switch (e.kind) {
        case 'user.ask':
          if (d.from === 'person' || !r.turnStart) { r.ask = excerpt(String(d.text ?? ''), 40) || 'your prompt'; r.turnStart = e.ts; }
          r.lastLine = e.ts;
          r.open = [];
          break;
        case 'agent.stop': r.lastLine = e.ts; if (!d.subagent) r.open = []; break;
        case 'session.end': state.delete(e.session); break;
        case 'tool.before':
          if (call) {
            const kind = String(d.kind ?? 'unknown');
            const tool = String(d.tool ?? '');
            const command = typeof d.command === 'string' ? d.command : null;
            befores.set(`${e.session}|${call}`, { ts: e.ts, key: historyKey(kind, command, tool) });
            r.open.push({ call, kind, tool, command, started: e.ts, shown: e.ts });
          }
          break;
        case 'tool.after': {
          const before = call ? befores.get(`${e.session}|${call}`) : undefined;
          // A call that ended well teaches the next one its time.
          if (before && d.outcome === 'ok' && e.ts >= before.ts) history.push([before.key, e.ts - before.ts]);
          if (call) befores.delete(`${e.session}|${call}`);
          r.open = r.open.filter((o) => o.call !== call);
          break;
        }
        case 'call.overrun': for (const o of r.open) if (o.call === call) { o.overrun = e.ts; o.shown = e.ts; } break;
        case 'session.reading':
          r.lastLine = e.ts;
          for (const o of r.open) o.shown = e.ts;
          break;
        default:
      }
    }
    return { history, sessions: [...state.values()].filter((r) => r.turnStart !== undefined) };
  }
  /** A line the chat showed of a wait: kept as the session's reading, so the next ten minutes count from it after a restart too. */
  async line(session: string, agent: string, text: string): Promise<void> {
    await this.ready;
    await this.queue(() => this.appendReading(session, agent, text.replace(/^DeepBuild: /gm, '')));
  }
  /** A call still running past its expected time: recorded as an overrun, and the session's row says so. It never becomes a wait on you. */
  async overrun(m: { session: string; agent: string; cwd: string; data: Obj }): Promise<void> {
    await this.ready;
    // The line itself is recorded by the hook that shows it (`line`), once, where the chat read it.
    await this.queue(() => this.appendSession(m.session, m.agent, 'call.overrun', m.data));
    // The session's row says so (#27): a reading naming the call, as the record reads no chat line until a hook shows one.
    const d = m.data as { call: string; command: string | null; expected_ms: number; ran_ms: number };
    const what = d.command === null ? '' : ` (\`${d.command.length > 80 ? `${d.command.slice(0, 80)}…` : d.command}\`)`;
    await this.queue(() => this.appendReading(m.session, m.agent, `Call ${d.call}${what} overran: still running ${words(d.ran_ms)} in, past the ${words(d.expected_ms)} expected for it. What it did is unknown until the session is read, so nothing retries it.`)).catch(() => undefined);
  }
  /** Words for an agent whose hooks take no context: carried by its next prompt. */
  later(session: string, cwd: string, text: string): void {
    this.routesOf(session, cwd).later.push(text);
  }
  /**
   * The checks a stop's last message promises for later: the first sets the session's wake-up, or sets it again,
   * keeping its first end; a wake-up never sets itself again. A promise set a fourth time, or due past its end, is
   * BLOCKED with its owner and at most one ask, and no further wake-up fires.
   */
  private async promised(meta: HookMeta): Promise<void> {
    const text = meta.fields?.last_assistant_message;
    if (!text) return;
    const now = this.now();
    const [next] = promisesIn(text, now);
    if (!next) return;
    const current = this.promises.get(meta.session);
    // BLOCKED stands until the session ends: no further wake-up is set, and the one ask is not asked again.
    if (current?.status === 'blocked') return;
    clearTimeout(current?.timer);
    const state = setPromise(current, next, ulid(now));
    const entry = { ...state, timer: undefined, asked: current?.asked ?? false };
    this.promises.set(meta.session, entry);
    if (state.status === 'blocked') return this.promiseBlocked(meta.session, meta.agent, meta.cwd, entry);
    await this.appendSession(meta.session, meta.agent, 'promise.set', { promise: state.id, quote: state.quote, due: state.due, times_set: state.set, end: state.end });
    this.armPromise(meta.session);
  }
  /** One timer per promise, for its due time; nothing polls, so an idle session costs no CPU while it waits. */
  private armPromise(session: string): void {
    const p = this.promises.get(session);
    if (!p || p.status !== 'set' || this.stopping) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => void this.queue(() => this.promiseDue(session)).catch(() => undefined), Math.min(Math.max(0, p.due - this.now()), 2 ** 31 - 1));
    p.timer.unref();
  }
  /**
   * A promise's due time: where the session has shown it can be woken when idle (Claude Code's waiter), the wake-up
   * starts a turn now; elsewhere, as in Codex, whose hooks never start a turn, it starts nothing: the session's row
   * shows it due, and its next prompt or stop carries it. The route is the session's shown routes, never the agent's name.
   */
  private async promiseDue(session: string): Promise<void> {
    const p = this.promises.get(session);
    if (!p || p.status !== 'set' || this.stopping) return;
    if (p.due > this.now()) return this.armPromise(session);
    const agent = this.sessions.get(session)?.agent ?? this.live.get(session)?.agent ?? 'claude-code';
    const r = this.routes.get(session);
    const idle = r !== undefined && r.waiter !== undefined && r.covered && r.shown.has('waiter') && r.wakes !== false && !r.holding && r.busy < r.waiter.since;
    await this.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: idle ? 'wake' : 'next_hook' });
    p.status = 'due';
    if (idle && r.waiter) return this.handPromise(session, p, r);
    await this.appendReading(session, agent, dueReading(p));
    // The event loop holds this session's next stop for it.
    this.askingSoon();
  }
  /**
   * The wake-up handed to the session's waiter: woken only once the wake's prompt shows it (the `promise:<id>` token
   * in the waiter's text). A wake that shows no turn within the grace reads stalled, as an ask's does: the route is
   * marked as not waking, the row shows the check due, and the session's next prompt or stop carries it.
   */
  private handPromise(session: string, p: PromiseState & { timer?: NodeJS.Timeout | undefined; handed?: boolean }, r: Routes): void {
    const waiter = r.waiter;
    if (!waiter) return;
    r.waiter = undefined;
    p.handed = true;
    waiter.give({ session, text: wakeText(p) });
    this.armPromiseGrace(session, p, WAKE_GRACE);
  }
  private armPromiseGrace(session: string, p: PromiseState & { timer?: NodeJS.Timeout | undefined }, inMs: number): void {
    if (this.stopping) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => void this.queue(() => this.promiseUnwoken(session, p.id)).catch(() => undefined), Math.max(0, inMs));
    p.timer.unref();
  }
  private async promiseUnwoken(session: string, id: string): Promise<void> {
    const p = this.promises.get(session);
    if (!p || p.id !== id || p.status !== 'due' || p.handed !== true) return;
    p.handed = false;
    const agent = this.sessions.get(session)?.agent ?? 'claude-code';
    const r = this.routes.get(session);
    // A route never seen working counts as absent: this session's promised checks wait for its next prompt or stop.
    if (r && r.wakes !== true) r.wakes = false;
    await this.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: 'next_hook' });
    await this.appendReading(session, agent, `Claude Code didn't wake this session for its promised check: its waiter handed it over and no turn started. ${dueReading(p)}`);
    this.askingSoon();
  }
  /** The due promise a session's prompt or stop carries, taken once, with how it went. */
  private async promiseCarried(session: string, via: 'next_prompt' | 'stop_hold', prompt = ''): Promise<string | undefined> {
    const p = this.promises.get(session);
    if (!p || p.status !== 'due') return undefined;
    p.status = 'woken';
    const agent = this.sessions.get(session)?.agent ?? 'claude-code';
    // The wake's own prompt, carrying the text the waiter was handed, proves the wake; any other hook carries the check
    // itself. Only a handed wake text carries this set's token, so a late wake (its prompt after the grace) still proves
    // the route, and a typed prompt that lands while the wake is queued finds it in the transcript, as an ask's does.
    const token = promiseToken(p);
    const stalled = p.handed === false;
    const woke = via === 'next_prompt' && (prompt.includes(token) || (p.handed !== undefined && await this.woken(session, token)));
    clearTimeout(p.timer);
    const r = this.routes.get(session);
    if (woke && r) r.wakes = true;
    await this.appendSession(session, agent, 'promise.woken', { promise: p.id, via: woke ? 'waiter' : via }).catch(() => undefined);
    if (woke && stalled) await this.appendReading(session, agent, 'Claude Code woke this session for its promised check after all; the check goes with that wake\'s turn.').catch(() => undefined);
    this.askingSoon();
    return woke ? undefined : wakeText(p);
  }
  private promiseDueFor(session: string): boolean { return this.promises.get(session)?.status === 'due'; }
  private async promiseBlocked(session: string, agent: string, cwd: string, p: PromiseState & { asked?: boolean }): Promise<void> {
    const owner = ownerOf(p.quote);
    let ask: string | null = null;
    if (!p.asked) {
      p.asked = true;
      const question = `The agent's promised check is BLOCKED (${blockedCause(p) === 'set_again' ? `promised ${p.set} times` : 'promised past its end'}; owner: ${owner}): "${p.quote}" Do the check yourself, or drop it?`;
      const options = [{ id: 'take', label: 'I will do the check', decision: 'none' }, { id: 'drop', label: 'Drop it', decision: 'none' }];
      const raised = { kind: 'choice', question, options, recommended: 'drop', fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'promise', session, quote: p.quote } as JsonValue)), pinned_to: await this.pinOf(cwd, question) };
      ask = await this.asks.raise(this.connection('core', { session, agent }), 'promise.blocked', raised).catch(() => null);
    }
    await this.appendSession(session, agent, 'promise.blocked', { promise: p.id, status: 'BLOCKED', quote: p.quote, cause: blockedCause(p), owner, ask });
    await this.appendReading(session, agent, blockedReading(p, owner));
    await this.attention(session, agent, 'stuck');
  }
  /** The promises the record holds that still wait, after a restart: each set one is armed again, each due one waits for its hook. */
  private async restorePromises(): Promise<void> {
    const rows = (await this.record.raw(`SELECT session_id AS session, kind, data, ts FROM events WHERE kind IN ('promise.set', 'promise.due', 'promise.woken', 'promise.blocked', 'session.end') AND session_id IS NOT NULL ORDER BY log_pos`)) as { session: string; kind: string; data: string | Obj; ts: number }[];
    const handedAt = new Map<string, number>();
    for (const row of rows) {
      // A session's end takes its promise with it: nothing wakes a session that is gone.
      if (row.kind === 'session.end') { this.promises.delete(row.session); continue; }
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      const p = this.promises.get(row.session);
      if (row.kind === 'promise.set') this.promises.set(row.session, { id: String(d.promise), quote: String(d.quote), due: Number(d.due), set: Number(d.times_set), end: Number(d.end), status: 'set', timer: undefined, asked: p?.asked ?? false });
      else if (p && p.id === d.promise) {
        p.status = row.kind === 'promise.due' ? 'due' : row.kind === 'promise.woken' ? 'woken' : 'blocked';
        p.handed = row.kind === 'promise.due' && d.route === 'wake';
        if (p.handed) handedAt.set(row.session, Number(row.ts));
      }
      if (row.kind === 'promise.blocked' && p) p.asked = true;
    }
    for (const [session, p] of this.promises) {
      if (p.status === 'set') this.armPromise(session);
      else if (p.status === 'due' && p.handed) this.armPromiseGrace(session, p, WAKE_GRACE - (this.now() - (handedAt.get(session) ?? this.now())));
      else if (p.status === 'due') this.askingSoon();
    }
  }

  /**
   * Messages typed while the agent works (#25), read from the transcript's queue at the end of the call they were
   * typed during (#80: its PostToolUse): each is recorded as a prompt you typed, once, whichever of the queue and its
   * UserPromptSubmit shows it first. Any other hook leaves the queue untaken: one that read the transcript between
   * the desktop app's enqueue of its own prompt (a resume prompt, a scheduled tick) and its dequeue would take that
   * prompt for yours, and drop its UserPromptSubmit, which carries its origin (#340).
   */
  private queuedAsks(drafts: Draft[], session: Session, event: string): void {
    const met = (list: string[], text: string) => { const at = list.indexOf(text); if (at >= 0) list.splice(at, 1); return at >= 0; };
    const fromQueue = session.fromQueue ??= [];
    const prompted = session.prompted ??= [];
    const tasks = session.queuedTasks ??= [];
    const asked = drafts.findIndex((d) => d.kind === 'user.ask');
    const every = this.options.plant === 'counts-every-enqueue';
    if (asked >= 0 && !every) {
      const prompt = drafts[asked]!;
      const text = String(prompt.data.text);
      if (met(fromQueue, text)) {
        const spliced = session.spliced ??= new Map();
        // The queue's drafts are taken in their order, like the messages: the same text twice is two tasks.
        const at = tasks.findIndex((d) => d.data.text === text);
        spliced.set(String(prompt.id), { from: String(prompt.data.from ?? 'unknown'), task: at >= 0 ? tasks.splice(at, 1)[0] : undefined });
        for (const id of spliced.keys()) { if (spliced.size <= 32) break; spliced.delete(id); }
        drafts.splice(asked, 1);
      } else {
        prompted.push(text);
        // In the terminal a message typed while the agent works fires its UserPromptSubmit at once (#80): one whose
        // text waits in the queue joins the turn and is acknowledged (#340).
        const waiting = (session.queued ?? []).find((q) => scrubText(q.text, { held: this.options.held }).slice(0, 8192) === text);
        // Its entry may not be in the transcript yet, so a prompt still waiting in the queue is yours: only what you type waits there.
        if (prompt.data.from === 'unknown' && waiting && !AUTOMATIC_QUEUED.test(waiting.text)) prompt.data.from = 'person';
        if (prompt.data.from === 'person' && waiting) {
          prompt.queued = true;
          waiting.taken = true;
        }
      }
    }
    const reads = every || event === 'PostToolUse' || event === 'PostToolUseFailure';
    for (const queued of reads ? session.queued ?? [] : []) {
      if (queued.taken) continue;
      queued.taken = true;
      // What another session, a subagent or a task's notice queued is an automatic prompt, recorded at its dequeue.
      if (AUTOMATIC_QUEUED.test(queued.text) && !every) continue;
      const text = scrubText(queued.text, { held: this.options.held }).slice(0, 8192);
      if (!every && met(prompted, text)) continue;
      fromQueue.push(text);
      const ts = this.now();
      // Its task is set when it is appended (handleHook); the prompt hook that takes it reads it here.
      const draft: Draft = { kind: 'user.ask', v: 1, id: ulid(ts), ts, data: { msg: 0, text, tasks: [], from: 'person' }, fill: 'msg', queued: true };
      drafts.push(draft);
      tasks.push(draft);
    }
    for (const list of [fromQueue, prompted, tasks]) list.splice(0, Math.max(0, list.length - 32));
  }

  /**
   * A Codex turn no prompt hook started, such as a goal's continuation (#340): it opens with a user.ask before its
   * first hook's events, its origin read from the rollout's opening user message by the facts' turnWithoutPrompt.
   */
  private async promptless(drafts: Draft[], meta: HookMeta, session: Session): Promise<void> {
    const turn = meta.fields?.turn_id;
    // A subagent's hooks carry its own turn; no prompt of the root's stands behind them.
    if (!turn || meta.fields?.agent_id) return;
    const started = this.turnsStarted.get(session.id);
    this.turnsStarted.set(session.id, turn);
    if (meta.event === 'UserPromptSubmit' || meta.event === 'SessionStart' || started === undefined || started === turn) return;
    const facts = (registry().get('codex').facts as Obj).turnWithoutPrompt as { values: Record<string, string>; otherwise: string } | undefined;
    if (!facts) return;
    let text = '';
    let inTurn = false;
    for (const raw of (await this.tail(session.transcript, 4 << 20)).split('\n')) {
      let line: Obj;
      try { line = JSON.parse(raw) as Obj; } catch { continue; }
      const payload = isObj(line.payload) ? line.payload : {};
      if (line.type === 'turn_context') inTurn = payload.turn_id === turn;
      else if (inTurn && payload.type === 'message' && payload.role === 'user' && Array.isArray(payload.content)) {
        text = payload.content.filter(isObj).map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n');
        break;
      }
    }
    let from = Object.entries(facts.values).find(([lead]) => text.startsWith(lead))?.[1] ?? facts.otherwise;
    if (from === 'continuation' && this.options.plant === 'continuation-as-person') from = 'person';
    const live = this.live.get(session.id);
    if (live) live.from = from;
    const ts = this.now();
    drafts.unshift({ kind: 'user.ask', v: 1, id: ulid(ts), ts, data: { msg: 0, text: scrubText(text, { held: this.options.held }).slice(0, 8192), tasks: [], from }, fill: 'msg' });
  }
  /**
   * Your words from the app at a prompt's hook (#340), each recorded `from: app` with its request ID: a note its
   * waiter handed over, which the wake's prompt carries, is that prompt's own ask; one still waiting goes as this
   * prompt's context, an ask beside the prompt's. They are matched by request ID, never by their words.
   */
  private appNotes(drafts: Draft[], session: string): void {
    const at = drafts.findIndex((d) => d.kind === 'user.ask' && !d.queued);
    if (at < 0) return;
    const prompt = drafts[at]!;
    const draft = (note: Note): Draft['data'] => {
      const text = scrubText(note.text, { held: this.options.held }).slice(0, 8000);
      // The planted wrong program takes the app's words for yours, with no request ID.
      if (this.options.plant === 'app-note-as-person') return { msg: 0, text, tasks: [], from: 'person' };
      // Recorded as the session reads them, with their request ID, so the same words typed are never the note.
      return { msg: 0, text: `${text} (request ${note.request})`, tasks: [], from: 'app', request: note.request };
    };
    const woke = [...this.handedNotes.values()].filter((n) => n.session === session && String(prompt.data.text).includes(`(request ${n.request})`));
    for (const note of woke) {
      clearTimeout(note.timer);
      this.handedNotes.delete(note.request);
    }
    const waiting = this.notes.get(session)?.splice(0) ?? [];
    if (waiting.length) this.carried.set(session, [...(this.carried.get(session) ?? []), ...waiting]);
    const asks = waiting.map((note): Draft => {
      const ts = this.now();
      return { kind: 'user.ask', v: 1, id: ulid(ts), ts, data: draft(note), fill: 'msg', queued: true };
    });
    const [first, ...rest] = woke;
    // The planted wrong program delivers a waiter's note and records nothing for it.
    if (first && this.options.plant === 'app-note-unrecorded') drafts.splice(at, 1);
    else if (first) {
      prompt.data = draft(first);
      const live = this.live.get(session);
      if (live) live.from = String(prompt.data.from);
      for (const note of rest) {
        const ts = this.now();
        asks.push({ kind: 'user.ask', v: 1, id: ulid(ts), ts, data: draft(note), fill: 'msg', queued: true });
      }
    }
    drafts.push(...asks);
    // The planted wrong program lets a note's yes answer the session's open authority ask, as the trusted path would.
    if (this.options.plant === 'app-note-answers-authority' && [...woke, ...waiting].some((n) => /\b(?:yes|approve|go ahead)\b/i.test(n.text))) void this.noteAnswers(session).catch(() => undefined);
  }
  /** The app-note-answers-authority plant: the session's open authority asks answered with their allowing option. */
  private async noteAnswers(session: string): Promise<void> {
    const rows = (await this.record.raw(`SELECT id, options FROM asks WHERE session_id = ? AND kind = 'authority' AND status IN ('open', 'later')`, [session])) as { id: string; options: string | null }[];
    for (const row of rows) {
      const option = (JSON.parse(row.options ?? '[]') as { id: string; decision?: string }[]).find((o) => o.decision === 'allow');
      if (option) await this.asks.answer(this.connection('app'), `ask:${row.id}`, { option: option.id, plan_hash: (await this.asks.card(`ask:${row.id}`)).plan?.hash ?? null, token: `os-confirm:${ulid(this.now())}` });
    }
  }
  /** The notes as the agent reads them, each labelled as yours, sent from the app, with its request ID. */
  private noteText(notes: Note[]): string {
    return `DeepBuild delivers your words, sent from the app:\n${notes.map((n) => `(request ${n.request}) ${n.text}`).join('\n')}`;
  }
  /** session.note, from the app: your words into a session, by the route its flags allow, as an answer goes (#25). */
  private note(params: Obj): Obj {
    const { session, text, request } = params;
    if (typeof session !== 'string' || !session) throw refuse('type', '/params/session', 'Name the session by its ID, as its hooks carry it.', session);
    if (typeof text !== 'string' || !text.trim() || text.length > 8192) throw refuse('type', '/params/text', 'Send the note\'s words as a string of 1 to 8192 characters.', text);
    if (typeof request !== 'string' || !/^[0-9A-Za-z_-]{1,64}$/.test(request)) throw refuse('type', '/params/request', 'Give the delivery\'s request ID: 1 to 64 letters, digits, - or _.', request);
    if (!this.live.has(session)) throw refuse('not_found', '/params/session', `No session ${session} has reached the hub; send the note to one deep status lists.`, session);
    // A request ID applies once: a retried send changes nothing.
    const known = [...(this.notes.get(session) ?? []), ...this.handedNotes.values()].some((n) => n.request === request);
    if (!known) {
      this.notes.set(session, [...(this.notes.get(session) ?? []), { session, text, request }]);
      this.offer(session);
    }
    return { session, request };
  }

  /**
   * The transcript entries of the turn a prompt opened, from its own entry on. The core keeps the current turn's as
   * it reads them; a session it met after its prompt's entry was written (its first hook came late) is read here
   * from the transcript's last few MiB.
   */
  private async turnFrom(session: Session, promptId: string): Promise<Obj[]> {
    if (session.prompts.has(promptId)) return session.entries[0]?.promptId === promptId ? session.entries : [session.prompts.get(promptId)!];
    const lines = (await this.tail(session.transcript, 4 << 20)).split('\n');
    const at = lines.findIndex((l) => l.includes(promptId) && l.includes('"promptId"'));
    if (at < 0) return [];
    return lines.slice(at).flatMap((l) => { try { const e: unknown = JSON.parse(l); return isObj(e) && e.isSidechain !== true ? [e] : []; } catch { return []; } }).slice(0, TURN_ENTRIES);
  }

  /**
   * A stop's cause from its records: the payload's error, then the turn's transcript error records, never the
   * agent's text; its usage; and for a stop with a cause, its error signature and who can act on it.
   */
  private async stopRecords(draft: Draft, meta: HookMeta, session: Session | undefined): Promise<void> {
    const data = draft.data;
    if (session && meta.fields?.prompt_id && !meta.fields.agent_id) {
      const read = this.mapped(meta, draft, { ...meta.fields }, await this.turnFrom(session, meta.fields.prompt_id));
      if (read && typeof read.cause === 'string') {
        data.cause = read.cause;
        if (read.cause === 'plan_window_spent' && typeof read.plan_resets === 'number') data.plan_resets = read.plan_resets;
      }
      if (read && read.usage !== undefined) data.usage = read.usage;
    }
    const cause = String(data.cause);
    if (cause === 'unknown') return;
    data.signature = signature(`stop:${cause}`, meta.fields?.error ?? cause, meta.cwd);
    data.owner = cause === 'sign_in_required' || cause === 'token_refresh_failed' ? 'you' : cause === 'rate_limited' || cause === 'plan_window_spent' ? 'service' : 'agent';
  }

  /**
   * A stop's loop reading, from the session's own tool calls: looping while a wake-up or cron job it scheduled is
   * due, or a background subagent it started hasn't reported; a loop with none left once neither holds.
   */
  private loopAt(live: Live): Obj | undefined {
    const dues = [...live.wakeups, ...[...live.crons.values()].flatMap((c) => (c.due === null ? [] : [c.due]))];
    const due = dues.length ? Math.min(...dues) : null;
    let loop: Obj | undefined;
    if (this.options.plant === 'loop-from-origins') {
      // The planted wrong program reads the loop from the prompt's origin alone.
      loop = live.from === 'scheduled' || live.from === 'subagent' ? { state: 'looping', due: null } : live.wakeups.length || live.background ? { state: 'looping', due } : undefined;
    } else if (live.wakeups.length || live.crons.size) loop = { state: 'looping', due };
    else if (live.background) loop = { state: 'looping', due: null };
    else if (live.looping || live.from === 'scheduled' || live.from === 'subagent') loop = { state: 'none_left' };
    live.looping = loop?.state === 'looping';
    live.wakeups = [];
    return loop;
  }

  /**
   * What a hook says of its session beyond its events: whether it is working, so its hooks going quiet reads unknown,
   * the calls still running, and the commits made in its worktree.
   */
  private follow(drafts: Draft[], meta: HookMeta, verified: boolean): void {
    if (!meta.session) return;
    const live = this.liveOf(meta);
    const now = Date.now();
    live.last = now;
    let state = live.state;
    // A prompt hook opens the turn the next stop is judged on: a person's, with work done in it (#83). A prompt read
    // from the transcript's queue (#25) opens none yet: its turn starts when the agent takes it, at its own prompt
    // hook, which then has no draft left. A wake (the waiter's, or a subagent's report as its `<task-notification>`),
    // the app's resume, a status question answered from the record and a subagent's own prompt all leave the turn
    // as it is, so the stop that finishes the person's task is still judged; a hand-back prompt without that text
    // opens a turn of its own, unjudged.
    const prompt = meta.fields?.prompt ?? '';
    const statusQuestion = meta.event === 'UserPromptSubmit' && live.from === 'person' && isStatusQuestion(prompt);
    const continues = prompt.includes('<task-notification>') || live.from === 'continuation' || statusQuestion || Boolean(meta.fields?.agent_id);
    if (meta.event === 'UserPromptSubmit' && !continues) {
      live.turn++;
      live.judged = false;
      // The task the prompt opened: on its draft, or on the queue's draft of it when the queue showed it first.
      const ask = drafts.find((d) => d.kind === 'user.ask')?.data.tasks ?? this.sessions.get(meta.session)?.spliced?.get(meta.id)?.task?.data.tasks;
      live.turnTask = Array.isArray(ask) && typeof ask[0] === 'string' ? ask[0] : undefined;
      this.askingSoon();
    }
    for (const draft of drafts) {
      const call = typeof draft.data.call === 'string' ? draft.data.call : undefined;
      if (draft.kind === 'user.ask') state = 'working';
      else if (draft.kind === 'permission.request') state = 'waiting';
      else if (draft.kind === 'tool.before' || draft.kind === 'tool.after') {
        // A late call event never reopens a turn that stopped.
        if (state !== 'finished' && state !== 'failed') state = 'working';
        if (call && draft.kind === 'tool.before') live.calls.set(call, { what: `${String(draft.data.kind)} call ${call}${typeof draft.data.command === 'string' ? ` (\`${draft.data.command}\`)` : ''}` });
        else if (call) { const open = live.calls.get(call); if (open) open.ended = now; }
      } else if (draft.kind === 'agent.stop' && !draft.data.subagent) {
        // A turn that ended on a block only you or a service can clear (a sign-in, a rate limit) leaves the session stuck.
        state = draft.data.outcome !== 'failed' ? 'finished' : draft.data.owner === 'you' || draft.data.owner === 'service' ? 'stuck' : 'failed';
      }
    }
    for (const [call, c] of live.calls) if (c.ended !== undefined && now - c.ended > CALL_GRACE) live.calls.delete(call);
    // A turn you interrupted (#39) has no stop to say so: it ends here, with no claim.
    if (verified && meta.event === 'Interrupt') { state = 'finished'; void this.attention(meta.session, meta.agent, 'finished'); }
    if (verified && meta.reading) void this.appendReading(meta.session, meta.agent, meta.reading).catch(() => undefined);
    // The record reads these states from the hook events themselves; only unknown, below, is the core's to append.
    // A person's status question changes none: answered from the record it runs no model, and let through (an
    // answer waiting, or DeepBuild off) it shows its state at its next hook, as the record's row does.
    if (state && !statusQuestion) live.state = state;
    clearTimeout(live.quiet);
    live.quiet = undefined;
    if (meta.event === 'SessionEnd') { this.live.delete(meta.session); this.askingSoon(); }
    else if (state === 'working' && !statusQuestion && !this.stopping) {
      live.quiet = setTimeout(() => void this.queue(() => this.quiet(meta.session, now)).catch(() => undefined), QUIET_MS);
      live.quiet.unref();
    }
    // Read on the session's own chain, never the core's: a replay at the start would wait on the start it is part of.
    if (meta.cwd && ['SessionStart', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'].includes(meta.event)) {
      // A call of the session's that makes commits (git commit, merge, cherry-pick, am, revert, rebase) makes the
      // commits that appear by its end the session's (#29: head trust reads them); any other new head is not.
      const after = drafts.find((d) => d.kind === 'tool.after');
      const made = after !== undefined && typeof after.data.command === 'string' && COMMITS.test(after.data.command);
      live.reading = (live.reading ?? Promise.resolve()).then(() => this.commits(meta, live, made)).catch(() => undefined);
    }
  }
  private async attention(session: string, agent: string, state: string): Promise<void> {
    // A session whose question to you is still open waits on you: its stop never reads as finished (#27).
    if (state === 'finished' && await this.asksYou(session)) state = 'waiting';
    const ts = this.now();
    return this.append(this.connection('core', { session, agent }), { v: 2, id: ulid(ts), kind: 'session.attention', ts, subject: `session:${letters(session)}`, data: { state } }).catch(() => undefined);
  }
  /** Whether the session has an ask still open for you. */
  private async asksYou(session: string): Promise<boolean> {
    return ((await this.record.raw(`SELECT 1 FROM asks WHERE session_id = ? AND status IN ('open', 'later') LIMIT 1`, [session]).catch(() => [])) as unknown[]).length > 0;
  }
  /** A working session whose hooks went quiet: unknown, unless its transcript's tail shows it still at work. */
  private async quiet(id: string, since: number): Promise<void> {
    const live = this.live.get(id);
    if (!live || live.last !== since || live.state !== 'working') return;
    const session = this.sessions.get(id);
    const read = session?.read;
    if (session) await this.readTranscript(session);
    if (session && session.read !== read) {
      live.quiet = setTimeout(() => void this.queue(() => this.quiet(id, since)).catch(() => undefined), QUIET_MS);
      live.quiet.unref();
      return;
    }
    live.state = 'unknown';
    await this.attention(id, live.agent, 'unknown');
  }
  /**
   * The thread a session's ID joins. `/clear`, `/compact` and a fork inside a session rotate the ID in the same agent
   * process, so the new ID joins that process's last session; `--fork-session` starts a new process, whose arguments
   * name the session it forked. Anything else starts a thread of its own. Codex keeps its ID through a compaction and
   * a clear, its daemon runs many threads, and its payload names no fork's parent: its thread is its own ID.
   */
  private async threadOf(session: Session, source: string | undefined): Promise<string> {
    if (session.agent === 'codex') return session.id;
    if (source !== 'clear' && source !== 'compact' && source !== 'fork') return session.id;
    const before = [...this.sessions.values()].filter((s) => s.id !== session.id && s.pid === session.pid && s.start === session.start).at(-1);
    if (before) return before.thread;
    if (source !== 'fork') return session.id;
    const from = /(?:^|\s)(?:--resume|-r)[\s=]([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=\s|$)/.exec(await argsOf(session.pid))?.[1];
    return from ? this.sessions.get(from)?.thread ?? from : session.id;
  }
  /** Links a session whose agent process another session's agent process started, such as `codex exec` run by Claude Code, as its child. */
  private async childOf(session: Session, agent: string): Promise<void> {
    const parent = await this.agentAbove({ pid: session.pid, start: session.start });
    if (!parent || parent === session.id) return;
    const ts = this.now();
    await this.append(this.connection('core', { session: session.id, agent }), { v: 1, id: ulid(ts), kind: 'session.child_started', ts, subject: `session:${letters(session.id)}`, data: { parent: `session:${letters(parent)}`, child: `session:${letters(session.id)}`, task_ref: null } });
  }
  /**
   * The commits a session made in its worktree since its last hook, each recorded once under it: only those a call of
   * its own that makes commits brought (`made`), never a head that moved some other way, such as a pull of a
   * stranger's commits, whatever their author and committer fields say.
   */
  private async commits(meta: HookMeta, live: Live, made: boolean): Promise<void> {
    const head = await headOf(meta.cwd).catch(() => undefined);
    // A folder with no commit yet: the first one a call makes is a commit too.
    if (!head) { live.unborn = true; return; }
    const before = live.head;
    const first = before === undefined && live.unborn === true;
    live.head = head.sha;
    live.unborn = false;
    if ((before === undefined && !first) || before === head.sha || !made) return;
    for (const sha of first ? [head.sha] : await commitsBetween(meta.cwd, before!, head.sha)) {
      if (this.committed.has(sha)) continue;
      this.committed.add(sha);
      const ts = this.now();
      await this.append(this.connection('core', { session: meta.session, agent: live.agent }), { v: 1, id: ulid(ts), kind: 'commit.made', ts, subject: `session:${letters(meta.session)}`, data: { sha, worktree: meta.cwd, branch: head.branch } }).catch(() => undefined);
    }
  }

  // ---- Our entries in Claude Code's settings (#18).

  /** A file's identity and size and time, so a change is seen once. */
  private keyOf(file: string): string {
    try { const s = statSync(file); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return 'none'; }
  }
  private watchSettings(): void {
    const file = claudeSettings();
    this.settingsKey = this.keyOf(file);
    const check = () => void this.queue(() => this.settingsChanged()).catch(() => undefined);
    try {
      this.watcher = watch(resolve(file, '..'), (_, name) => { if (!name || String(name) === 'settings.json') check(); });
      this.watcher.unref();
    } catch {
      // No folder yet: the poll finds the file once setup writes it.
    }
    this.timers.push(setInterval(check, 500));
  }
  /**
   * The settings changed between session starts: an entry of ours removed or weakened while an agent's call was
   * running goes back at once, with a reading naming the call; a change with none running is yours, and stays.
   */
  private async settingsChanged(): Promise<void> {
    const file = claudeSettings();
    const key = this.keyOf(file);
    if (key === this.settingsKey) return;
    this.settingsKey = key;
    const record = installed(this.root.dir);
    const changed = record ? tampered(readJson(file), record) : [];
    if (!record || !changed.length) return;
    const now = Date.now();
    const running = [...this.live].flatMap(([id, l]) => [...l.calls.values()].filter((c) => c.ended === undefined || now - c.ended <= CALL_GRACE).map((c) => ({ id, agent: l.agent, what: c.what })));
    if (!running.length) return;
    restore(record);
    this.settingsKey = this.keyOf(file);
    for (const r of running) {
      const text = `DeepBuild's hook entries in ${file} were removed or changed (${changed.join('; ')}) while the ${r.what} was running; they were put back at once.`;
      this.settingsReadings.push(text);
      await this.appendReading(r.id, r.agent, text).catch(() => undefined);
    }
  }
  /**
   * The recheck at a session's start: our entries changed, or Claude Code's hooks turned off, by a recorded agent call
   * that wrote the settings file, is tampering, and goes back with a reading naming the call; a change no recorded
   * call made is yours, and stays.
   */
  private async recheck(): Promise<void> {
    const record = installed(this.root.dir);
    if (!record) return;
    const file = claudeSettings();
    const settings = readJson(file);
    const flag = settings?.disableAllHooks === true;
    const changed = tampered(settings, record);
    if (!flag && !changed.length) return;
    if (this.options.plant === 'restores-at-session-start-only') {
      if (changed.length) restore(record);
      return;
    }
    const since = Math.floor(statSync(join(this.root.dir, 'claude-hooks.json')).mtimeMs) - 1000;
    const rows = (await this.record.raw(`SELECT id, session_id, agent, data FROM events WHERE kind IN ('tool.before', 'tool.after') AND ts >= ? AND session_id IS NOT NULL AND (instr(data, ?) > 0 OR instr(data, '.claude/settings.json') > 0) ORDER BY log_pos`, [since, file])) as { id: string; session_id: string; agent: string | null; data: string }[];
    if (!rows.length) return;
    restore(record, flag);
    this.settingsKey = this.keyOf(file);
    const what = [flag ? 'turned Claude Code\'s hooks off (disableAllHooks)' : '', changed.length ? `changed DeepBuild's entries (${changed.join('; ')})` : ''].filter(Boolean).join(' and ');
    for (const session of new Set(rows.map((r) => r.session_id))) {
      const mine = rows.filter((r) => r.session_id === session);
      const calls = [...new Set(mine.map((r) => (JSON.parse(r.data) as Obj).call).filter((c): c is string => typeof c === 'string'))];
      const text = `An agent call ${calls.join(', ') || mine[0]!.id} (events ${mine.map((r) => r.id).join(', ')}) wrote ${file} and ${what}; at this session start DeepBuild put its entries back${flag ? ' and took the flag out' : ''}.`;
      this.settingsReadings.push(text);
      await this.appendReading(session, mine[0]!.agent ?? 'claude-code', text).catch(() => undefined);
    }
  }

  // ---- Answers back to a session (#25): through a held stop, its waiter, or the context of its next prompt or start.

  /** What a session has shown of the routes back into it since it last started, its holds, waiter and continuations. */
  private routesOf(session: string, cwd = ''): Routes {
    let r = this.routes.get(session);
    if (!r) this.routes.set(session, r = { cwd, shown: new Set(), covered: true, holding: 0, busy: 0, continued: 0, capped: false, sendBacks: [], later: [] });
    return r;
  }
  /**
   * What each hook shows of its session's routes, read as it arrives, before the record has it: a hook of ours that
   * fired on a version the facts cover counts its route; a tool call or a prompt starts the turn's count again and
   * shows a turn running, from when its hook started; a session's end retires its waiter.
   */
  private track(meta: HookMeta): void {
    if (!meta.session || FOREIGN.has(meta.agent)) return;
    if (meta.event === 'SessionStart') {
      // What a session has shown resets only when it starts again.
      const before = this.options.plant === 'routes-kept-across-sessions' ? [...this.routes.values()].reverse().find((r) => r.cwd === meta.cwd) : undefined;
      const fresh: Routes = { cwd: meta.cwd, shown: before ? before.shown : new Set(), covered: true, holding: 0, busy: 0, continued: 0, capped: false, sendBacks: [], later: [] };
      const old = this.routes.get(meta.session);
      if (old?.waiter) fresh.waiter = old.waiter;
      if (old?.places) fresh.places = true;
      this.routes.delete(meta.session);
      this.routes.set(meta.session, fresh);
    }
    const r = this.routesOf(meta.session, meta.cwd);
    r.covered = !meta.watchOnly;
    if (r.covered && !(this.options.plant === 'routes-kept-across-sessions' && r.shown.size)) r.shown.add(meta.event);
    if (meta.parent) void this.queue(() => this.placeOrRefuse(meta.parent!)).catch(() => undefined);
    if (meta.event === 'PreToolUse') {
      if (this.options.plant !== 'stop-count-never-resets') r.continued = 0;
      r.capped = false;
    }
    if (meta.event === 'SessionEnd') {
      if (this.options.plant !== 'waiter-outlives-session') r.waiter?.give({ exit: 'session ended' });
      this.routes.delete(meta.session);
      // A call running as its session quit returns to nobody: its answer waits for the session's resume.
      for (const [ask, waiting] of this.askWaits) if (waiting === meta.session) this.stopAskWait(ask);
      const promise = this.promises.get(meta.session);
      clearTimeout(promise?.timer);
      this.promises.delete(meta.session);
      for (const map of [this.acks, this.midTurn, this.carried, this.turnsStarted, this.onScreen]) map.delete(meta.session);
    } else if (meta.event !== 'Stop' && meta.event !== 'SessionStart') r.busy = Math.max(r.busy, ulidTime(meta.id));
  }
  /** Claude Code's cap on stop-hook continuations in one turn, from its facts. */
  private cap(): number {
    const continuation = (registry().get('claude').facts as Obj).continuation;
    return isObj(continuation) && typeof continuation.cap === 'number' ? continuation.cap : CONTINUATION_CAP;
  }

  /**
   * The answers waiting for a session: answered asks of its thread (its ID and those `/clear`, `/compact` or a fork
   * joined to it) not yet delivered, nor handed to its waiter and not yet seen in a turn; or, with `scope`, the
   * answered asks it names.
   */
  private async waitingFor(session: string, scope?: string): Promise<Answer[]> {
    await Promise.allSettled([...this.inflight]);
    const thread = `COALESCE((SELECT thread_id FROM sessions WHERE id = '${sql(session)}'), '${sql(session)}')`;
    const mine = scope ?? `COALESCE((SELECT thread_id FROM sessions WHERE id = a.session_id), a.session_id) = ${thread}`;
    const rows = ((await this.record.raw(`SELECT a.id, a.session_id AS session, a.question, a.options, a.answer FROM asks a WHERE a.status = 'answered' AND ${mine}
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.delivery = a.id AND d.outcome = 'delivered') ORDER BY a.answered`)) as Omit<Answer, 'words' | 'image'>[])
      .filter((row) => !this.handed.has(row.id) && !this.prompts.has(`ask:${row.id}`));
    if (!rows.length) return [];
    // Your words and the screenshot sent from the card (#327) ride on the answer event, which the asks table doesn't
    // carry: one read of those events for the rows still waiting, the latest per ask.
    const events = (await this.record.raw(`SELECT subject, data FROM events WHERE kind = 'ask.answered' AND subject IN (${rows.map(() => '?').join(', ')}) ORDER BY log_pos`, rows.map((row) => `ask:${row.id}`))) as { subject: string; data: string }[];
    const latest = new Map(events.map((e) => [e.subject, JSON.parse(e.data) as { words?: unknown; image?: unknown }]));
    return rows.map((row) => {
      const data = latest.get(`ask:${row.id}`) ?? {};
      return { ...row, words: typeof data.words === 'string' ? data.words : null, image: typeof data.image === 'string' ? data.image : null };
    });
  }
  /** The answers as the agent reads them, each naming its ask. */
  private answerText(rows: Answer[]): string {
    const lines = rows.map((row) => {
      const chosen = row.answer === null ? null : JSON.parse(row.answer) as unknown;
      const options = row.options === null ? [] : JSON.parse(row.options) as { id: string; label: string }[];
      const label = options.find((o) => o.id === chosen)?.label;
      // An answer of words or a screenshot alone is already the answer: it isn't said twice.
      const beside = [row.words === null || row.words === chosen ? [] : [`your words: "${row.words}"`], row.image === null ? [] : [`a screenshot, sha256 ${row.image}`]].flat();
      if (row.image !== null && row.image === chosen) return `Your answer to ask:${row.id}${row.question ? ` ("${row.question}")` : ''}: a screenshot, sha256 ${row.image}${row.words === null ? '' : ` — with your words: "${row.words}"`}.`;
      return `Your answer to ask:${row.id}${row.question ? ` ("${row.question}")` : ''}: ${label ? `${label} (${String(chosen)})` : String(chosen)}${beside.length ? ` — with ${beside.join(' and ')}` : ''}.`;
    });
    return `DeepBuild delivers your answers:\n${lines.join('\n')}`;
  }
  /** The asks a running deep_ask or deep_wait of a session whose package places answers will return itself. */
  private readonly askWaits = new Map<string, string>();
  private outcome(ask: string, via: string, outcome: 'delivered' | 'stalled' | 'timed_out' | 'replaced' | 'waiting'): Promise<void> {
    return this.appendCore('delivery.outcome', { delivery: `ask:${ask}`, via, outcome }, { subject: `ask:${ask}`, ...(outcome === 'waiting' ? { v: 2 } : {}) }).catch(() => undefined);
  }
  /** An answer to a Codex session that ended waits on its task, and only the same thread's resume hears it (#39). */
  private async waitsOnTask(delivery: Delivery): Promise<void> {
    const [last] = (await this.record.raw(`SELECT e.kind, s.agent FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.session_id = '${sql(delivery.session)}' AND e.kind IN ('session.start', 'session.end') ORDER BY e.log_pos DESC LIMIT 1`)) as { kind: string; agent: string }[];
    if (last?.kind === 'session.end' && last.agent === 'codex') await this.outcome(delivery.ask.replace(/^ask:/, ''), 'on_task', 'waiting');
  }
  /** Each answer delivered once: recorded delivered `via` before the agent reads it. */
  private async deliver(rows: Answer[], via: 'next_prompt' | 'stop_hold'): Promise<string | undefined> {
    if (!rows.length) return undefined;
    for (const row of rows) await this.outcome(row.id, via, 'delivered');
    return this.answerText(rows);
  }

  /** An answer the asks core recorded: a stop of its session held now takes it, else its waiter if the session is idle. */
  private answered(delivery: Delivery): void {
    // A permission prompt's answer goes back through the prompt it holds (#23).
    if (this.prompts.has(delivery.ask)) return;
    this.tasks.answered(delivery);
    void this.waitsOnTask(delivery).catch(() => undefined);
    const asker = this.sessions.get(delivery.session);
    if (asker?.agent === 'pi' || this.routes.get(delivery.session)?.places) return void this.queue(() => this.placeOrRefuse(delivery.session)).catch(() => undefined);
    // One the restarted hub hasn't heard from may be a pi session replaced before it, or any idle session whose waiter asked again.
    if (!asker) void this.queue(() => this.placeOrRefuse(delivery.session)).catch(() => undefined);
    if (this.routes.get(delivery.session)?.holding) for (const wake of this.waiting.get(delivery.session) ?? []) wake();
    else this.offer(delivery.session);
  }
  /** The planted wrong programs that let a held stop go when its answer comes, leaving the answer to the waiter. */
  private get releases(): boolean {
    return this.options.plant === 'answer-skips-held-stop' || this.options.plant === 'stop-hold-releases-without-answer';
  }
  private askingQueued = false;
  private askingSent = '';
  /**
   * Sends the event loop the sessions with an ask still to deliver, and those whose next stop the stop rule would read
   * as a claim, so it is held for its line (#83); once per turn of appends, when it changed.
   */
  private askingSoon(): void {
    if (this.askingQueued) return;
    this.askingQueued = true;
    setImmediate(() => {
      this.askingQueued = false;
      void this.askingNow().catch(() => undefined);
    });
  }
  private async askingNow(): Promise<void> {
    const rows = ((await this.record.raw(`SELECT id, session_id FROM asks WHERE session_id IS NOT NULL AND status IN ('open', 'later', 'answered') AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered')`)) as { id: string; session_id: string }[])
      .filter((r) => !this.prompts.has(`ask:${r.id}`));
    // A session with a send-back planted for its next stop has that stop held too (#25), and one whose promised check is due (#120).
    const planted = [...this.routes].filter(([, r]) => r.sendBacks.length).map(([id]) => id);
    const promised = [...this.promises].filter(([, p]) => p.status === 'due').map(([id]) => id);
    const sessions = [...new Set([...rows.map((r) => r.session_id), ...planted, ...promised])].sort();
    const judged = [...this.live].filter(([, l]) => l.judged).map(([id]) => id).sort();
    const key = `${sessions.join(' ')}|${judged.join(' ')}`;
    if (key === this.askingSent) return;
    this.askingSent = key;
    this.asking(sessions, judged);
  }

  /**
   * Hands what waits for an idle session to its waiter, which exits 2 with it and so wakes the session. Claude Code
   * starts the waiter at a stop, so the session is idle while no stop of it is held (the hold takes the answer) and no
   * hook started since shows a turn running; never past the turn's cap (the next prompt does), or once its app has
   * shown it doesn't wake.
   */
  private offer(session: string): void {
    const r = this.routes.get(session);
    if (!r) return;
    if (r.places) return void this.queue(() => this.placeOrRefuse(session)).catch(() => undefined);
    const idle = () => r.waiter !== undefined && !r.holding && r.busy < r.waiter.since;
    if (!r.covered || !r.shown.has('waiter') || r.capped || r.wakes === false || !idle()) return;
    void this.queue(async () => {
      const waiter = r.waiter;
      if (!waiter || !idle()) return;
      // A promised check that came due before this waiter asked (a hub restarted on the record, the waiter back a
      // moment later) wakes the session now: the route is the waiter's, however the two arrived (#120).
      const p = this.promises.get(session);
      if (p?.status === 'due' && !p.handed) {
        // The hand follows its recorded route, or not at all.
        const agent = this.sessions.get(session)?.agent ?? 'claude-code';
        await this.appendSession(session, agent, 'promise.due', { promise: p.id, due: p.due, route: 'wake' });
        await this.appendReading(session, agent, 'The promised check\'s wake-up is handed to this session\'s waiter.').catch(() => undefined);
        return this.handPromise(session, p, r);
      }
      const rows = await this.waitingFor(session);
      const notes = this.notes.get(session) ?? [];
      if (!rows.length && !notes.length) return;
      if (this.options.plant === 'waiter-checks-every-5s') {
        // The planted waiter asks every 5 s instead of being told.
        const due = 5000 - ((Date.now() - waiter.at) % 5000);
        setTimeout(() => this.offer(session), due).unref();
        if (due < 4900) return;
      }
      r.waiter = undefined;
      if (this.options.plant === 'waiter-never-wakes') return waiter.give({ exit: 'planted: never wakes' });
      waiter.give({ session, text: [rows.length ? this.answerText(rows) : '', notes.length ? this.noteText(notes) : ''].filter(Boolean).join('\n\n') });
      // A note is your words once a turn shows them: the wake's prompt names its request ID, else it goes by the next prompt.
      for (const note of this.notes.get(session)?.splice(0) ?? []) {
        this.handedNotes.set(note.request, { ...note, timer: setTimeout(() => void this.queue(async () => this.notWoken(note.request)).catch(() => undefined), WAKE_GRACE) });
      }
      if (this.options.plant === 'delivered-on-waiter-exit' || this.options.plant === 'wake-assumed' || this.options.plant === 'delivered-to-dead-waiter') {
        for (const row of rows) await this.outcome(row.id, 'next_prompt', 'delivered');
        return;
      }
      // Delivered only once a turn shows it: the wake's prompt carries it, or the transcript does.
      const at = Date.now();
      for (const row of rows) this.handed.set(row.id, { session, at, timer: setTimeout(() => void this.queue(() => this.unwoken(session, row.id)).catch(() => undefined), WAKE_GRACE) });
    }).catch(() => undefined);
  }
  /**
   * A waiter's answer no turn has shown: the transcript is read for the wake, and with none it reads stalled, the
   * view says the app didn't wake the session, and the answer goes by its next prompt.
   */
  private async unwoken(session: string, ask: string, prompt?: string): Promise<void> {
    const handed = this.handed.get(ask);
    if (!handed) return;
    clearTimeout(handed.timer);
    this.handed.delete(ask);
    const woken = (prompt ?? '').includes(`ask:${ask}`) || await this.woken(session, `ask:${ask}`);
    if (woken) {
      const r = this.routes.get(session);
      if (r) r.wakes = true;
      return this.outcome(ask, 'next_prompt', 'delivered');
    }
    // A session that can't be read proves nothing either way (#27): timed out, and the next prompt reads it first.
    if (woken === undefined) {
      this.unread.set(ask, session);
      return this.outcome(ask, 'next_prompt', 'timed_out');
    }
    await this.outcome(ask, 'next_prompt', 'stalled');
    const r = this.routes.get(session);
    // A route never seen working counts as absent: this session's answers wait for its next prompt.
    if (r && r.wakes !== true) r.wakes = false;
    await this.appendReading(session, this.sessions.get(session)?.agent ?? 'claude-code', `Claude Code didn't wake this session with your answer to ask:${ask}: its waiter handed it over and no turn started. The answer goes with the session's next prompt.`).catch(() => undefined);
  }
  /**
   * A session cleared while its waiter's answers showed in no turn (#27): replaced, and each goes to the thread's new
   * session at its start, as an answer that never reached it.
   */
  private async replaced(session: string): Promise<void> {
    for (const [ask, handed] of [...this.handed]) {
      if (handed.session !== session) continue;
      clearTimeout(handed.timer);
      this.handed.delete(ask);
      await this.outcome(ask, 'next_prompt', 'replaced');
    }
  }
  /** A note its waiter handed over that no turn showed: it waits for the session's next prompt. */
  private notWoken(request: string): void {
    const note = this.handedNotes.get(request);
    if (!note) return;
    this.handedNotes.delete(request);
    this.notes.set(note.session, [...(this.notes.get(note.session) ?? []), { session: note.session, text: note.text, request }]);
  }
  /**
   * Whether the transcript shows a turn carrying a waiter's text (an ask's answer, a promise's wake-up): a queued wake
   * or a prompt naming its token; undefined when the transcript can't be read.
   */
  private async woken(session: string, token: string): Promise<boolean | undefined> {
    const transcript = this.sessions.get(session)?.transcript;
    if (!transcript) return false;
    try { await access(transcript, constants.R_OK); } catch { return undefined; }
    return (await this.tail(transcript, 1 << 20)).split('\n').some((l) => {
      if (!l.includes(token)) return false;
      try {
        const e = JSON.parse(l) as Obj;
        return e.type === 'queue-operation' || (e.type === 'user' && isObj(e.message) && typeof e.message.content === 'string');
      } catch { return false; }
    });
  }
  private async tail(file: string, bytes: number): Promise<string> {
    try {
      const handle = await open(file, 'r');
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, bytes);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, size - length);
        return buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return '';
    }
  }

  /** A PreToolUse the hub held for the gate: why its call waits for you, or nothing when it runs (#321). */
  async toolGate(meta: HookMeta, call: Gated): Promise<{ held?: string; allow?: string; deny?: string }> {
    await this.ready;
    // Computer use stays on what the session leases (#332), so your own screen and browser are never touched.
    if (call.screen && meta.call) {
      const deny = await this.offScreen(meta.session, meta.call.tool, meta.call.input);
      if (deny) return { deny };
    }
    // A cloud resource nobody can be asked about from here stays denied, as with the hub down; a delete whose reach
    // can't be worked out runs only staged.
    if (FOREIGN.has(meta.agent) || !meta.session) {
      if (call.decided?.includes('cloud-resource')) return { deny: 'DeepBuild blocked this: creating a cloud resource the plan doesn\'t name needs your standing rule or your answer, and this session can\'t be asked.' };
      return call.stage !== undefined ? this.staging.gate(meta, call, false) : {};
    }
    const held = await this.holds.gate(meta, call);
    if (held) return { held };
    // A delete whose reach can't be worked out runs only once what it names is staged, or you said yes (#347).
    if (call.stage !== undefined) {
      const staged = await this.staging.gate(meta, call, true);
      if (staged.held) return staged;
    }
    // A dependency or a cloud resource the plan doesn't name: answered by your standing rule, or asked (#23).
    const about = call.decided?.length && call.command ? aboutCall(call.decided, call.command, homedir()) : undefined;
    return about ? this.holds.decide(meta, about) : {};
  }

  /** The session is on `display` once its switch ran, if that is a screen it leases. */
  private async switched(session: string, display: string): Promise<void> {
    const leased = (await this.leases.leases()).some((v) => v.lease.holder === `mcp:${session}` && v.lease.resource.kind === 'screen' && v.lease.resource.key === display);
    if (leased) this.onScreen.set(session, display);
  }
  /**
   * Why a computer-use or Chrome step is denied, or nothing when it acts on what its session leases (#332): a switch
   * to a screen it leases, an app whose window it leases, and any other step on the leased screen it last switched
   * to. Claude in Chrome, a session that leases no screen, a step naming another, and one before any switch are
   * denied, so your own screen, your browser and their windows are never touched.
   */
  private async offScreen(session: string, action: string, input: Record<string, unknown>): Promise<string | undefined> {
    const holder = `mcp:${session}`;
    const mine = (await this.leases.leases()).filter((v) => v.lease.holder === holder && v.lease.resource.host === 'local');
    const keys = (kind: string) => mine.filter((v) => v.lease.resource.kind === kind).map((v) => v.lease.resource.key);
    const screens = keys('screen');
    const windows = keys('window');
    const leased = screens.length ? `it leases ${screens.join(', ')}` : 'it leases no screen; deep env up leases one when the environment names a screen pool';
    const why = (what: string) => `DeepBuild blocked this: computer use acts only on a screen and windows its session leases, so your own are never touched. This step ${what}, and ${leased}${windows.length ? ` and the windows of ${windows.join(', ')}` : ''}.`;
    // Claude in Chrome acts in your own Chrome profile, with your sign-ins, which no window lease covers.
    if (action.startsWith(CHROME)) return why('acts in your own Chrome, which no lease covers');
    if (/(^|_)switch_display$/.test(action)) {
      const display = String(input.display ?? '');
      // The screen counts as the session's once the switch has run (`switched`), never on the asking alone.
      return screens.includes(display) ? undefined : why(`switches to ${display || 'a screen it doesn\'t name'}`);
    }
    const current = this.onScreen.get(session);
    if (current === undefined || !screens.includes(current)) return why('acts on the screen the session is on, which it hasn\'t switched to a leased one');
    // Your clipboard is yours whichever screen a session is on.
    if (/clipboard/.test(action) || input.clipboardRead || input.clipboardWrite) return why('acts on your clipboard, which no lease covers');
    if (input.systemKeyCombos) return why('asks for key combos that act on your whole machine');
    // Any step naming apps, granting, teaching or opening them, names only apps whose windows it leases.
    const apps = [...(input.app === undefined ? [] : [input.app]), ...(Array.isArray(input.apps) ? input.apps : [])];
    if (!apps.length && /(^|_)(open_application|request_access|request_teach_access)$/.test(action)) return why('names no app');
    const off = apps.find((app) => typeof app !== 'string' || !windows.includes(app));
    if (off !== undefined) return why(`acts on the window of ${typeof off === 'string' ? off : JSON.stringify(off)}, which it doesn't lease`);
    return undefined;
  }

  /**
   * A permission prompt (#23): answered through the hook only from a saved decision that covers it, logged as decided
   * for you. One no decision covers opens no ask: the agent's own prompt asks you in the terminal (#18), and once the
   * call you said yes to runs it is offered back as a decision you save with one click (`deep inbox save`).
   */
  async permission(meta: HookMeta): Promise<{ decision: 'allow' | 'deny' | 'none'; because?: string }> {
    await this.ready;
    if (FOREIGN.has(meta.agent) || !meta.session || !meta.call) return { decision: 'none' };
    const about = aboutPermission(meta.call.tool, meta.call.input);
    if (!(await this.covered(meta.session, about))) {
      this.pending.set(`${meta.session}|${about.subject.target.owner}`, { meta, about });
      return { decision: 'none' };
    }
    const asked = await this.holds.asked(meta, about);
    this.prompts.add(asked.ask);
    if (asked.decision) return { decision: asked.option === 'approve' ? 'allow' : 'deny', because: asked.decision };
    // The core's gate refused what looked covered, as when two decisions disagree: the prompt goes to you, and its ask with it.
    const ts = this.now();
    await this.append(this.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'ask.cancelled', subject: asked.ask, ts, data: { answer: 'decline', plan_hash: null, decision: 'none' } });
    return { decision: 'none' };
  }
  /** Whether a saved decision covers what a prompt is about, asked of resolver-decisions with nothing raised. */
  private async covered(session: string, about: About): Promise<boolean> {
    const options = [{ id: 'approve', label: about.options[0], decision: 'allow' as const }, { id: 'decline', label: about.options[1], decision: 'deny' as const }];
    const key = subjectKey({ kind: 'authority', subject: about.subject, options } as unknown as Parameters<typeof subjectKey>[0], '');
    const answer = await this.precheck({
      ask: 'ask:0', kind: 'authority', options, plan: null, words: [], changed: null, folded: [], undo: false, cost_usd: null, suggested: null, conflict: [],
      needs_person: [], budget: null, session, key, repo: this.projects.get(session) ?? null, subject: about.subject,
    });
    return answer !== undefined && !answer.also?.length;
  }
  /** A call whose prompt no decision covered has run: you said yes in the terminal, so it is offered back to save. */
  private async offerBack(meta: HookMeta): Promise<void> {
    // The prompt and the call that ran are matched by session and call: a prompt's payload names no tool_use_id.
    const key = `${meta.session}|${aboutPermission(meta.call!.tool, meta.call!.input).subject.target.owner}`;
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    const project = this.projects.get(meta.session);
    const handle = `offer:${ulid(this.now())}`;
    this.offers.set(handle, { ...pending, scope: project ? `repo:${project}` : `session:${letters(meta.session)}` });
    // The typed-saves-decision plant, when your words came in before the call's run did.
    if (this.options.plant === 'typed-saves-decision' && this.typedAt.has(meta.session)) await this.typedSaves(meta.session);
  }
  /** The typed-saves-decision plant: words you type in the session save what it offers back, with no click. */
  private async typedSaves(session: string): Promise<void> {
    for (const [handle, offer] of [...this.offers]) if (offer.meta.session === session) await this.saveOffer(handle, this.connection('cli'));
  }
  /** The offers still open: each one no saved decision covers yet. */
  private async openOffers(): Promise<Obj[]> {
    const open: Obj[] = [];
    for (const [offer, o] of this.offers) {
      if (await this.covered(o.meta.session, o.about)) this.offers.delete(offer);
      else open.push({ offer, session: o.meta.session, command: o.about.subject.target.ref, scope: o.scope });
    }
    return open;
  }
  /** offers/:id/save, from the app or `deep inbox save`: your one click, once the trusted path allows it, saves the offered permission for its repo. */
  private async saveOffered(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.offer;
    if (typeof handle !== 'string' || !/^offer:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/offer', 'Name the offer by its handle, offer:<id>, as deep inbox lists it.', handle));
    const offer = this.offers.get(handle);
    if (!offer) throw new Refused(refusal('not_found', '/params/offer', `No offer ${handle}; save one deep inbox lists.`, handle));
    await this.trusted(params, context, `save “${offer.about.subject.target.ref.slice(0, 120)}” as a decision for ${offer.scope}`, handle);
    return this.saveOffer(handle, this.connection(context.role === 'app' ? 'app' : 'cli'));
  }
  /** The offer saved: its permission raised as an authority ask and answered yes on the trusted path, which saves it for the repo. */
  private async saveOffer(handle: string, as: Connection): Promise<Obj> {
    const offer = this.offers.get(handle)!;
    this.offers.delete(handle);
    const asked = await this.holds.asked(offer.meta, offer.about);
    // Its answer is yours, given here: nothing is delivered to the session.
    this.prompts.add(asked.ask);
    if (!asked.decision) await this.asks.answer(as, asked.ask, { option: 'approve', plan_hash: (await this.asks.card(asked.ask)).plan?.hash ?? null, token: `os-confirm:${ulid(this.now())}` }).catch((error: unknown) => { throw asRefused(error); });
    await this.syncStanding().catch(() => undefined);
    const [saved] = (await this.record.raw(`SELECT id, data FROM events WHERE kind = 'decision.created' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [asked.ask])) as { id: string; data: string }[];
    return { offer: handle, ask: asked.ask, decision: saved ? `decision:${saved.id}` : asked.decision ?? null, scope: saved ? String((JSON.parse(saved.data) as Obj).scope) : offer.scope };
  }

  /** The past taste decisions `said` names a screen for that this session wasn't given since it started (#111). */
  private async tasteAt(session: string, cwd: string, said: string, starting: boolean): Promise<string | undefined> {
    const given = starting ? new Set<string>() : this.tasted.get(session) ?? new Set<string>();
    this.tasted.set(session, given);
    const fresh = (await tastesFor((q) => this.record.raw(q), repoOf(cwd), said)).filter((t) => !given.has(t.ask));
    for (const t of fresh) given.add(t.ask);
    return tasteBlock(fresh);
  }
  /** `deep memory`'s list (#111). */
  private async lessons() {
    return lessonsOf((q) => this.record.raw(q), await repoFolders(this.record, this.store));
  }
  /**
   * `deep memory keep` and `remove` (#111): yours alone, from your own terminal, once the OS confirms you. Keeping a
   * proposed guard installs it through the guard engine, checked on its planted call and twin, before the decision is saved.
   */
  private async memoryAct(params: Obj, context: CallContext): Promise<Obj> {
    const verb = params.verb;
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A lesson is kept or removed from the CLI, once the OS confirms you.', 'memory.act'));
    const lesson = (await this.lessons()).find((l) => l.id === params.lesson);
    if (!lesson) throw new Refused(refusal('not_found', '/params/lesson', `No lesson ${String(params.lesson)}; deep memory lists the lessons left.`, params.lesson));
    // An agent may start this; the OS prompt is yours to refuse, so it says so, and shows the whole rule a guard would install.
    const agent = await this.agentAbove(context.peer);
    const why = await confirmYou(`${verb === 'keep' ? 'keep' : 'remove'} the lesson “${lesson.text}”${agent ? `, asked from inside agent session ${agent}` : ''}`, this.options.confirm);
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing changed: the OS didn't confirm you (${why}).`, lesson.id, true));
    if (verb === 'remove') return { decision: await this.wikiBuild.forget(lesson.claim) };
    const guard = guardOf(lesson);
    if (guard) {
      const added = await addGuards(this.root.dir, guard, { deepHook: deepHook(), classes: toolClasses(), plant: this.options.plant });
      if (added.status === 'refused') return added;
    }
    return { decision: await keepLesson(this.record, this.connection('cli'), this.now, lesson) };
  }

  /** Copies your standing rules for cloud resources into rules.json, so deep-hook honours them with the hub down (#23). */
  private async syncStanding(): Promise<void> {
    if (this.options.plant === 'copies-no-standing-rules') return;
    const rows = (await this.record.raw(`SELECT d.id AS id, d.answer AS answer, d.state AS state, e.data AS data FROM decisions d JOIN events e ON e.id = d.ask_id AND e.kind = 'ask.created'`)) as { id: string; answer: string; state: string; data: string }[];
    const decided = rows.map((r) => {
      const data = JSON.parse(r.data) as Obj;
      return { id: r.id, answer: (JSON.parse(r.answer) as unknown) as string, state: r.state, subject: isObj(data.subject) ? data.subject : null };
    });
    writeStanding(this.root.dir, standingRules(decided));
  }
  /**
   * What the hub says back to a hook it holds: a session's start gets its briefing and the answers of its thread; a
   * prompt the answers waiting for it, or, a person's status question with nothing waiting, the answer from the
   * record that keeps it from the model (#83); a stop, while the agent left a question, waits until `until` for its
   * answer, and is sent back with it while the turn is under Claude Code's cap on continuations; a judged stop
   * carries its verdict line, first in a send-back's reason and beside any reply where the chat shows it (#83).
   */
  async hookReply(meta: HookMeta, until: number): Promise<{ context?: string; block?: string; message?: string }> {
    const own = !FOREIGN.has(meta.agent) && meta.session;
    if (own && (meta.event === 'PreToolUse' || meta.event === 'PostToolUse')) return this.queue(async () => this.acknowledge(meta.session));
    if (meta.event === 'SessionStart') {
      // What Codex says of our entries' trust, off this reply's path.
      if (meta.agent === 'codex') void this.readCodexTrust(meta.cwd);
      const brief = await briefing(meta.cwd);
      const answers = own && this.options.plant !== 'ended-answer-at-next-prompt'
        // The planted wrong program gives a new session the answers of every session that worked in its folder.
        ? await this.queue(async () => this.deliver(await this.waitingFor(meta.session, this.options.plant === 'ended-answer-to-worktree' ? `a.session_id IN (SELECT id FROM sessions WHERE worktree = '${sql(meta.cwd)}')` : undefined), 'next_prompt'))
        : undefined;
      // After a compaction or a resume, the open asks' requirement IDs again, in one short block. The planted wrong
      // programs send them only at startup, or 25 ms late on the hook's path.
      const source = meta.fields?.source;
      const open = own && !(this.options.plant === 'brief-at-startup-only' && source !== 'startup') ? await this.tasks.brief(meta.session, this.sessions.get(meta.session)?.thread) : undefined;
      if (this.options.plant === 'slow-brief' && (source === 'compact' || source === 'resume')) await new Promise((done) => setTimeout(done, 25));
      const taste = own ? await this.tasteAt(meta.session, meta.cwd, (await headOf(meta.cwd))?.branch ?? '', true) : undefined;
      const context = [brief, open, answers, taste].filter(Boolean).join('\n\n');
      return context ? { context } : {};
    }
    if (!own || (meta.event === 'UserPromptSubmit' && childPrompt(meta))) return {};
    // Behind the replay its hook waited for, so the queue holds the hook before this reply. A long replay can
    // put a stop's reply past the server's wait; its line then shows at the next prompt, from the record.
    await (this.replaying ?? Promise.resolve());
    const r = this.routesOf(meta.session, meta.cwd);
    if (meta.event === 'UserPromptSubmit') {
      const prompt = meta.fields?.prompt ?? '';
      // A prompt the waiter's exit started (a wake) is part of the turn's continuations; any other starts the count again.
      if (!prompt.includes('<task-notification>')) {
        r.continued = 0;
        r.capped = false;
      }
      // A status question a person typed is answered from the record, and never reaches the model (#83), unless
      // an answer or a send-back waits for the agent at this prompt: that is never lost, so the prompt goes on
      // with it, and the status rides beside it where the chat shows it.
      const reply = await this.queue(async (): Promise<{ context?: string; block?: string; message?: string }> => {
        // Behind this prompt's own hook, so its origin is recorded (its event, or the queue's) when read.
        const status = await this.statusReply(meta);
        for (const [ask, handed] of [...this.handed]) if (handed.session === meta.session) await this.unwoken(meta.session, ask, prompt);
        // An answer whose delivery timed out is read for first: one a turn already showed isn't sent again.
        for (const [ask, session] of [...this.unread]) {
          if (session !== meta.session) continue;
          const woken = await this.woken(session, `ask:${ask}`);
          if (woken === undefined) continue;
          this.unread.delete(ask);
          if (woken) await this.outcome(ask, 'next_prompt', 'delivered');
        }
        const waiting = await this.waitingFor(meta.session);
        if (status && !waiting.length && !r.later.length && !this.promiseDueFor(meta.session)) {
          // The prompt's event read as the session working; it stays as it was, since no model runs on it.
          const live = this.live.get(meta.session);
          if (live?.state && live.state !== 'working') await this.attention(meta.session, live.agent, live.state);
          return { block: status, message: status.split('\n')[0]! };
        }
        // The planted wrong program counts the waiter your settings declare as a route, shown or not, and leaves the answer for it.
        const leaves = this.options.plant === 'routes-from-settings' && !r.shown.has('waiter');
        const answers = leaves ? undefined : await this.deliver(waiting, 'next_prompt');
        // A verdict that landed after the stop's reply goes with the next prompt (#83).
        const landed = await this.landedLine(meta.session);
        const slow = this.slowVerdicts(r);
        // Notes this prompt's hook recorded go as its context, once; a prompt typed mid-turn is acknowledged in its reply (#340).
        const notes = this.carried.get(meta.session);
        this.carried.delete(meta.session);
        const ack = this.acknowledge(meta.session);
        const promised = await this.promiseCarried(meta.session, 'next_prompt', prompt);
        // What you reject while a session runs stops it now, not at the next wiki build (#111).
        if (prompt.includes('rejected:')) {
          const message = { id: meta.id, role: 'user', text: prompt, outside: false } as Message;
          await captureRejected(this.record, this.connection('cli'), this.now, [{ session: meta.session.replace(/[^0-9A-Za-z]/g, ''), project: repoOf(meta.cwd) ?? null, messages: [message], from: 0 }], true);
          await syncRejected((q) => this.record.raw(q), this.root.dir).catch(() => undefined);
        }
        // A branch's name may not say which screen a session works on, so its first prompt is read too.
        const first = !this.firstPrompted.has(meta.session);
        this.firstPrompted.add(meta.session);
        const taste = first ? await this.tasteAt(meta.session, meta.cwd, prompt, false) : undefined;
        const context = [answers, promised, notes ? this.noteText(notes) : undefined, ...r.later.splice(0), landed && `DeepBuild: ${landed}`, slow, ack.context, taste].filter(Boolean).join('\n\n');
        const message = [status, ack.message].filter(Boolean).join('\n');
        return { ...(context ? { context } : {}), ...(message ? { message } : {}) };
      });
      return reply;
    }
    if (meta.event !== 'Stop') return {};
    r.holding++;
    let block: string | undefined;
    // A judged stop's claim is made, and its pull request recorded, before the hold, behind this stop's own hook (#83).
    const judged = await this.queue(() => this.judging(meta)).catch(async (e: unknown) => {
      await this.appendReading(meta.session, meta.agent, `This stop's claim could not be recorded: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return undefined;
    });
    // The claim's fast lane (#29): the hold waits for the checks the budget admitted, and no longer than the hold.
    const stopAt = ulidTime(meta.id);
    // Codex's hold may run as long as its Stop timeout lets a slow check, but an answer waits no longer than anyone's.
    const held = until;
    until = meta.agent === 'codex' ? Math.min(until, Date.now() + STOP_HOLD_MS) : until;
    const lane = judged?.claim ? await this.laneOf(judged.claim, until) : undefined;
    let proceeded = false;
    try {
      if (lane && !lane.sendBack && judged?.claim && meta.agent === 'codex' && lane.slow.length) {
        const failed = await this.slowStop(meta, r, judged.claim, held);
        if (failed) lane.sendBack = failed;
        // An answer that ended the hold is delivered below, with the wait an answer gets.
        until = Math.min(held, Date.now() + STOP_HOLD_MS);
      }
      // A stop the sorter answers "proceed" goes on at once: the proceed rides in its one reply with what else waits.
      // pi's package places its own answers: a reply here would hand them over a second time.
      const proceed = r.places ? undefined : await this.holds.proceed(meta, until);
      if (proceed) {
        proceeded = true;
        const delivered = await this.queue(async () => this.deliver(await this.waitingFor(meta.session), 'stop_hold'));
        block = [r.sendBacks.shift(), delivered, lane?.sendBack, proceed].filter(Boolean).join('\n\n');
      } else block = lane?.sendBack ?? (r.places ? undefined : await this.stopHold(meta, r, until));
    } finally {
      this.abandoned.delete(meta.id);
      r.holding--;
      if (block) {
        r.continued++;
        r.busy = Date.now();
        // The turn goes on with it, and its next stop starts a waiter of its own: this one exits without waking.
        if (this.options.plant === 'both-routes') r.waiter?.give({ session: meta.session, text: block });
        else r.waiter?.give({ exit: 'answered through the stop hold' });
        r.waiter = undefined;
      } else this.offer(meta.session);
    }
    // The verdict in the chat: one line at every judged stop, as the verdict stands once the hold is over, first in a send-back's reason too (#83).
    const line = judged ? await this.judgedLine(judged).catch(async (e: unknown) => {
      await this.appendReading(meta.session, meta.agent, `This stop's verdict line could not be read from the record: ${e instanceof Error ? e.message : String(e)}`).catch(() => undefined);
      return undefined;
    }) : undefined;
    // The chat has seen it once it is replied in time; a reply past the hold is not, and the next prompt shows the line.
    if (line && judged && Date.now() < held) judged.delivered = line;
    if (block && line) block = `${line}\n${block}`;
    // Slow runs start when the turn ends (#29): only once the fast lane is green and this reply lets the turn end.
    if (lane && judged?.claim && !block && !proceeded) this.gate.turnEnded(judged.claim);
    if (lane && judged?.claim) {
      await this.gate.held({ session: meta.session, stop: meta.id, claim: judged.claim, stopAt, readyAt: lane.readyAt, fastEndedAt: lane.fastEndedAt, replyAt: this.now(), question: false, codeChanging: lane.fast.length + lane.slow.length > 0 }).catch(() => undefined);
    }
    return { ...(block ? { block } : {}), ...(line ? { message: line } : {}) };
  }
  /**
   * The messages typed mid-turn since the last acknowledgement (#340): the agent is asked to acknowledge each in one
   * line, and the chat shows each with its task and the queue: every message typed mid-turn in the turn so far.
   */
  private acknowledge(id: string): { context?: string; message?: string } {
    const acks = this.acks.get(id);
    this.acks.delete(id);
    if (!acks?.length) return {};
    const short = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);
    const noted = acks.map((a) => `DeepBuild: your message “${short(a.text)}” ${a.task ? `is a new ask, ${a.task}` : 'opens no ask'}.`);
    // The planted wrong program shows only the message just read.
    const waiting = this.options.plant === 'queue-shows-newest' ? [acks.at(-1)!.text] : this.midTurn.get(id) ?? [];
    const queue = `DeepBuild queue (${waiting.length}): ${waiting.map((t) => `“${short(t)}”`).join(' · ')}`;
    const context = acks.map((a) => `You were sent a message while you worked: “${a.text}”${a.task ? `, a new ask (${a.task})` : ''}. Acknowledge it in one line, then go on.`).join('\n');
    return { context, message: [...noted, queue].join('\n') };
  }
  /**
   * A claim's fast lane as the stop's hold sees it (#29), waited for until `until`: the validity gate's findings and a
   * fast-lane check that failed send the claim back, naming what's missing or which check failed.
   */
  private async laneOf(claim: string, until: number): Promise<{ fast: string[]; slow: string[]; readyAt: number; fastEndedAt: number; sendBack?: string } | undefined> {
    const lane = this.lanes.get(claim);
    if (!lane) return undefined;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<undefined>((done) => { timer = setTimeout(() => done(undefined), Math.max(0, until - Date.now())); });
    const ran = await Promise.race([lane.catch(() => undefined), late]).finally(() => clearTimeout(timer));
    if (!ran) return undefined;
    const failed = this.gate.standing(claim).filter((c) => c.lane === 'fast' && (c.result === 'FAIL' || c.result === 'BLOCKED'));
    const sendBack = ran.findings.length ? `DeepBuild sent this claim back before any check ran:\n${ran.findings.map((f) => `- ${f}`).join('\n')}`
      : failed.length ? `DeepBuild sent this claim back: ${failed.map((c) => `${c.check} ${c.result}`).join(', ')}.` : undefined;
    return { fast: ran.fast, slow: ran.slow, readyAt: ran.readyAt, fastEndedAt: ran.fastEndedAt, ...(sendBack ? { sendBack } : {}) };
  }
  /**
   * A Codex stop with slow checks (#39): held for them only when each one's deadline ends at least 5 s before the Stop
   * entry's timeout, so a FAIL reaches the agent in the same turn; otherwise replied at once, with the row saying why,
   * and the verdict comes with the next message. What it is sent back with, or nothing.
   */
  private async slowStop(meta: HookMeta, r: Routes, claim: string, held: number): Promise<string | undefined> {
    const timeoutS = stopTimeoutS(this.root.dir) ?? 600;
    const slowClaims = (r.slowClaims ??= []);
    const verdictLater = async (why: string) => {
      // A claim the agent stopped on again is told once, and said once.
      if (slowClaims.includes(claim)) return;
      slowClaims.push(claim);
      await this.appendReading(meta.session, meta.agent, `This stop isn't held: ${why}. Its verdict comes with your next message.`).catch(() => undefined);
    };
    // Something already sends the agent on: the turn isn't ending, so no slow check starts.
    const waiting = () => this.queue(() => this.waitingFor(meta.session));
    if (r.sendBacks.length || (await waiting()).length) return undefined;
    const deadlines = this.gate.slowDeadlines(claim);
    const late = deadlines.find((c) => c.deadline_ms === null || !holdsFor(c.deadline_ms, timeoutS));
    await this.gate.turnEnded(claim);
    if (late) {
      const deadline = late.deadline_ms === null ? 'has no deadline' : `has a deadline of ${words(late.deadline_ms)}`;
      await verdictLater(`${late.check} ${deadline}, which must end at least 5 s before Codex's Stop hook timeout, ${timeoutS} s`);
      return undefined;
    }
    // Measured from now, with the check started: `held` already ends 5 s before the timeout, counted from the stop.
    const unstarted = this.gate.slowUnstarted(claim);
    if (unstarted.length) { await verdictLater(`${unstarted[0]} is waiting for a CPU slot, so its deadline can't be kept before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    const tight = deadlines.find((c) => Date.now() + c.deadline_ms! > held);
    if (tight) { await verdictLater(`${tight.check} has a deadline of ${words(tight.deadline_ms!)}, which no longer ends at least 5 s before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    while (Date.now() < held && this.gate.slowStanding(claim).pending) {
      await this.gate.slowEnded(claim, Math.min(held, Date.now() + 500));
      // An answer goes back at once; the check's verdict then comes with your next message.
      if (r.sendBacks.length || (await waiting()).length) { if (!slowClaims.includes(claim)) slowClaims.push(claim); return undefined; }
    }
    const standing = this.gate.slowStanding(claim);
    if (standing.pending) { await verdictLater(`its checks were still going when the hold ended, 5 s before Codex's Stop hook timeout, ${timeoutS} s`); return undefined; }
    return standing.failed.length ? `DeepBuild sent this claim back: ${standing.failed.join(', ')}.` : undefined;
  }
  private async readCodexTrust(cwd: string): Promise<void> {
    const dirs = [...(process.env.PATH ?? '').split(':'), ...this.config().loginPath.split(':')].filter(Boolean);
    const codex = dirs.map((d) => join(d, 'codex')).find((p) => existsSync(p));
    if (codex) await saveTrust(this.root.dir, codex, cwd, { ...process.env, CODEX_HOME: recordedHome(this.root.dir) }).catch(() => undefined);
  }
  /** The verdicts of the slow checks no stop was held for, once each has ended: what a prompt carries, or nothing. */
  private slowVerdicts(r: Routes): string | undefined {
    const told: string[] = [];
    r.slowClaims = (r.slowClaims ?? []).filter((claim) => {
      const { pending, failed } = this.gate.slowStanding(claim);
      if (pending) return true;
      if (failed.length) told.push(`DeepBuild sent this claim back: ${failed.join(', ')}.`);
      return false;
    });
    return told.join('\n') || undefined;
  }
  /** A stop held while the agent left a question: what it is sent back with, or nothing. */
  private async stopHold(meta: HookMeta, r: Routes, until: number): Promise<string | undefined> {
    const session = meta.session;
    // A promised check that came due while no route could wake the session goes back with this stop (#120).
    const promised = await this.queue(() => this.promiseCarried(session, 'stop_hold'));
    if (promised) return promised;
    const open = async () => ((await this.record.raw(`SELECT 1 FROM asks WHERE session_id = ? AND status IN ('open', 'later', 'answered') AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered') LIMIT 1`, [session])) as unknown[]).length > 0;
    if (this.options.plant !== 'no-stop-count' && r.continued >= this.cap()) {
      // One more block would pass Claude Code's cap and be overridden: what would continue the turn waits for its next prompt.
      if (!r.sendBacks.length && !await open()) return undefined;
      r.later.push(...r.sendBacks.splice(0));
      r.capped = true;
      this.askingSoon();
      await this.appendReading(session, meta.agent, `This turn's stop was sent back ${r.continued} times in a row with no tool call between, Claude Code's cap of ${this.cap()} stop-hook continuations, so the next would be overridden: what waits for this session goes with its next prompt instead.`).catch(() => undefined);
      return undefined;
    }
    if (r.sendBacks.length) {
      this.askingSoon();
      return r.sendBacks.shift();
    }
    const polls = this.options.plant === 'stop-hold-polls';
    const held = Date.now();
    while (!this.stopping && Date.now() < until && !this.abandoned.has(meta.id) && await open()) {
      if (this.releases) {
        if ((await this.queue(() => this.waitingFor(session))).length) return undefined;
      } else {
        const block = await this.queue(async () => (this.abandoned.has(meta.id) ? undefined : this.deliver(await this.waitingFor(session), 'stop_hold')));
        if (block) return block;
      }
      if (polls) await new Promise((done) => setTimeout(done, Math.min(250, Math.max(0, until - Date.now()))));
      else await this.wakeable(this.waiting, session, Math.min(until - Date.now(), 1000)).woken;
    }
    // A hold that ran out with the agent's question still open ends on the record (#27), naming what it waited for.
    if (!this.stopping && !this.abandoned.has(meta.id) && Date.now() >= until) {
      const asks = (await this.record.raw(`SELECT id FROM asks WHERE session_id = ? AND status IN ('open', 'later') ORDER BY created`, [session])) as { id: string }[];
      if (asks.length) await this.appendReading(session, meta.agent, `This stop was held ${words(until - held)} for ${asks.map((a) => `ask:${a.id}`).join(', ')} and nothing was answered, so the hold ended and the stop went through. The session waits on you: your answer goes by its waiter or its next prompt.`).catch(() => undefined);
    }
    return undefined;
  }
  /**
   * The waiter: one per session, the newest. It waits until the session is idle with an answer for it, then hands
   * it over to wake the session; it is told to exit when a newer one replaces it, the stop hold took the answer, or
   * the session ends. Its life is its session's, not this hub's: one that waited across a restart asks again.
   */
  private async waitAnswer(params: Obj, context: CallContext): Promise<Obj> {
    const session = String(params.session);
    const since = typeof params.since === 'number' ? params.since : this.now();
    if (this.stopping) throw refuse('unavailable', '', 'The hub is stopping; ask again once it is back.', session, true);
    if (this.options.plant === 'waiter-gives-up-at-600s' && this.now() - since > 600_000) return { exit: 'planted: gave up at 600 s' };
    const r = this.routesOf(session, typeof params.cwd === 'string' ? params.cwd : '');
    if (params.push === true || context.role === 'mcp') {
      if (context.session !== session || this.sessions.get(session)?.agent !== 'pi') throw refuse('role', '/params/session', 'Wait only on the pi session this connection is bound to.', session);
      r.places = true;
    }
    if (params.poll === true) {
      // The planted Node waiter (waiter-polls) asks each time instead of being told.
      const rows = !r.holding ? await this.queue(() => this.waitingFor(session)) : [];
      if (!rows.length) return {};
      for (const row of rows) await this.outcome(row.id, 'next_prompt', 'delivered');
      return { session, text: this.answerText(rows) };
    }
    return new Promise((give) => {
      const waiter = { key: Number(context.waiter ?? 0), at: Date.now(), since, give: (reply: Obj) => give(reply) };
      const old = r.waiter;
      if (old && this.options.plant !== 'waiter-per-stop') {
        if (old.since > since) return give({ exit: 'replaced by a newer waiter' });
        old.give({ exit: 'replaced by a newer waiter' });
      }
      r.waiter = waiter;
      if (r.covered && this.options.plant !== 'routes-kept-across-sessions') r.shown.add('waiter');
      this.offer(session);
    });
  }
  /** The session that replaced this one in its process, if it hasn't itself been resumed since: its answers are bound to the old generation. */
  private async replacedBy(session: string): Promise<string | undefined> {
    const [row] = (await this.record.raw(`SELECT session_id FROM events WHERE kind = 'session.start' AND json_extract(data, '$.parent') = ?
      AND log_pos > (SELECT COALESCE(MAX(log_pos), 0) FROM events WHERE kind = 'session.start' AND session_id = ?) ORDER BY log_pos DESC LIMIT 1`, [session, session])) as { session_id: string }[];
    // Replaced in its own process: a start naming it as parent from anywhere else replaces nothing.
    const [was, now] = [this.sessions.get(session), row && this.sessions.get(row.session_id)];
    // A hub restarted since knows the old one by no process: the start that named it is what's left.
    return now && (!was || was.pid === 0 || (was.pid === now.pid && was.start === now.start)) ? row!.session_id : undefined;
  }
  /**
   * An answer of a session whose package places them (#40): refused when another session has replaced it, so it never
   * reaches the replacement; else handed to the package, unless the deep_ask or deep_wait still running returns it.
   */
  private async placeOrRefuse(session: string): Promise<void> {
    // A refusal is final: a session resumed later doesn't take what was refused for it.
    const refused = (await this.record.raw(`SELECT delivery FROM deliveries WHERE outcome = 'replaced'`)) as { delivery: string }[];
    // Its own: a fork shares its thread, and only the session that asked takes an answer or reports on it.
    const rows = (await this.waitingFor(session)).filter((row) => row.session === session && !this.askWaits.has(row.id) && !refused.some((d) => d.delivery === row.id));
    if (!rows.length) return;
    const successor = await this.replacedBy(session);
    const r = this.routes.get(successor && piAcceptsReplaced() ? successor : session);
    if (successor && !piAcceptsReplaced()) {
      for (const row of rows) await this.outcome(row.id, 'next_prompt', 'replaced');
      return;
    }
    if (!r?.places || !r.waiter) return;
    const placing = (r.placing ??= new Set());
    const fresh = rows.filter((row) => !placing.has(row.id));
    const waiter = r.waiter;
    if (!fresh.length) return;
    r.waiter = undefined;
    for (const row of fresh) placing.add(row.id);
    waiter.give({ session, text: this.answerText(fresh), asks: fresh.map((row) => row.id) });
  }
  /** What the package did with the answers it took: only the session that raised an ask reports on it. */
  private async placed(params: Obj, context: CallContext): Promise<Obj> {
    const session = String(params.session);
    if (!context.session || context.session !== session || this.sessions.get(session)?.agent !== 'pi') throw refuse('role', '/params/session', 'Report only on the pi session this connection is bound to.', session);
    const via = String(params.via);
    const outcome = String(params.outcome);
    if (!['steer', 'next_prompt'].includes(via)) throw refuse('enum', '/params/via', 'Say steer or next_prompt.', via);
    if (!['delivered', 'replaced'].includes(outcome)) throw refuse('enum', '/params/outcome', 'Say delivered or replaced.', outcome);
    const asks = Array.isArray(params.asks) ? params.asks.map(String) : [];
    for (const ask of asks) {
      const [row] = (await this.record.raw(`SELECT session_id, status FROM asks WHERE id = ?`, [ask])) as { session_id: string | null; status: string }[];
      if (!piAcceptsReplaced()) {
        if (row?.session_id !== session || row.status !== 'answered') throw refuse('not_found', '/params/asks', 'Report only on an answered ask this session raised.', ask);
        // Delivered is a word about what the hub handed over, or what a running call returned.
        if (outcome === 'delivered' && !this.routes.get(session)?.placing?.has(ask) && !this.askWaits.has(ask)) throw refuse('not_found', '/params/asks', 'Report only on an answer handed to this session.', ask);
      }
      this.askWaits.delete(ask);
      const [done] = (await this.record.raw(`SELECT 1 AS yes FROM deliveries WHERE delivery = ? AND outcome IN ('delivered', 'replaced')`, [ask])) as unknown[];
      if (done) continue;
      await this.outcome(ask, via as 'steer' | 'next_prompt', outcome as 'delivered' | 'replaced');
    }
    return { reported: asks.length };
  }
  /** Ends a running call's hold on its ask, and wakes the call: nothing about the ask landed to wake it (#823). */
  private stopAskWait(ask: string): void {
    this.askWaits.delete(ask);
    for (const wake of this.settling.get(`ask:${ask}`) ?? []) wake();
  }
  /** Stops this session's running deep_ask and deep_wait: the call was aborted, and its answer comes as a message of its own. */
  private stopWaiting(context: CallContext): Obj {
    for (const [ask, session] of [...this.askWaits]) if (session === context.session) this.stopAskWait(ask);
    // One answered as it was aborted: the call's reply went unread.
    if (context.session && this.sessions.get(context.session)?.agent === 'pi') { const session = context.session; void this.queue(() => this.placeOrRefuse(session)).catch(() => undefined); }
    return {};
  }
  /** The hooks whose deep-hook let them through before reading the hub's reply, by event ID: none of them is held. */
  private readonly abandoned = new Set<string>();
  /** A held hook whose deep-hook is gone: its stop hold ends at once and delivers nothing, so the answer waits for the waiter or the next prompt. */
  hookGone(id: string, session: string): void {
    this.abandoned.add(id);
    for (const wake of this.waiting.get(session) ?? []) wake();
  }
  /** A waiter whose connection closed: Claude Code stopped it, or it exited. */
  waiterGone(key: number): void {
    if (this.options.plant === 'delivered-to-dead-waiter') return;
    for (const [session, r] of this.routes) {
      if (r.waiter?.key !== key) continue;
      r.waiter = undefined;
      // The running deep_ask went with it: its answer waits for the next waiter.
      if (r.places) for (const [ask, waiting] of this.askWaits) if (waiting === session) this.stopAskWait(ask);
    }
  }
  // ---- The verdict in the chat, and status from the record (#83; design: The verdict in the chat).

  /** The newest claim the session's line reads, and the turn it was made in. */
  private claimed(session: string, claim: string): void {
    const live = this.live.get(session);
    if (!live) return;
    live.claim = claim;
    live.claimTurn = live.turn;
    live.workedSinceClaim = false;
  }
  /** A claim's state from the record (verdict-chat), with the runs' expected times. */
  private stateOf(claim: string): Promise<ClaimState | undefined> {
    return claimState((q) => this.record.raw(q), claim.replace(/^claim:/, ''), this.expected);
  }
  /**
   * A stop that is judged (design: Every stop is judged): one the stop rule (#303) reads as a claim, and a later
   * stop of the same turn with nothing changed since; undefined for any other. The pull request the turn opened is
   * recorded, and a turn with no claim yet gets one, as the agent's claim for the task its prompt named, at the
   * worktree's commit, or at the record's no-commit value (forty zeros) where the folder has none.
   */
  private async judging(meta: HookMeta): Promise<Live | undefined> {
    const live = this.live.get(meta.session);
    if (!live?.judged) return undefined;
    // The claims the rule made at this stop, for the locked ask-tasks (#303): the newest is the one the line reads.
    const made = (await live.claiming) ?? [];
    live.claiming = undefined;
    const newest = made[made.length - 1];
    if (newest) { this.claimed(meta.session, newest); return live; }
    // With none, the turn's claim stands while nothing changed since it: a stop after a send-back that changed code
    // claims anew, for the turn's own task.
    if (live.claim && live.claimTurn === live.turn && !live.workedSinceClaim) return live;
    // The head as the turn's last commits left it, read by the chain follow() started.
    await live.reading?.catch(() => undefined);
    const commit = live.head ?? (await headOf(meta.cwd).catch(() => undefined))?.sha ?? '0'.repeat(40);
    const ts = this.now();
    const id = ulid(ts);
    // The task the prompt that opened the turn named, kept at the prompt; after a restart, the newest a person named.
    const [prompt] = live.turnTask ? [] : (await this.record.raw(`SELECT json_extract(data, '$.tasks[0]') AS task FROM events WHERE session_id = ? AND kind = 'user.ask' AND json_extract(data, '$.from') = 'person' AND json_extract(data, '$.tasks[0]') IS NOT NULL ORDER BY log_pos DESC LIMIT 1`, [meta.session])) as { task: string | null }[];
    const task_ref = live.turnTask ?? prompt?.task ?? `session:${letters(meta.session)}#0`;
    const [before] = (await this.record.raw(`SELECT COUNT(*) AS n FROM claims WHERE session_id = ? AND subject_ref = ?`, [meta.session, task_ref])) as { n: number }[];
    await this.append(this.connection('core', { session: meta.session, agent: live.agent }), { v: 2, id, kind: 'claim.made', ts, data: { task_ref, attempt: (before?.n ?? 0) + 1, commit, scope: 'session', predictions: [] } });
    this.claimed(meta.session, `claim:${id}`);
    // The claim (and any reading taken with it) lands behind the stop that ended the session's turn: its end is
    // recorded again after them, or an unclean restart would read the idle session as active and its claim as lost.
    if (live.state === 'finished' || live.state === 'failed') await this.attention(meta.session, live.agent, live.state);
    return live;
  }
  /**
   * A session whose turn this hub's restart interrupted, with work the stop rule would read as a claim, is judged
   * from the start (#83): its stop is held for its line, as it would have been had the hub stayed up.
   */
  private async judgedAcrossRestart(): Promise<void> {
    const rows = (await this.record.raw(`SELECT id, agent, worktree FROM sessions WHERE status NOT IN ('finished', 'failed') AND id IN (${[...this.cursors.keys()].map(() => '?').join(', ') || "''"})`, [...this.cursors.keys()]).catch(() => [])) as { id: string; agent: string | null; worktree: string | null }[];
    for (const row of rows) {
      if (!this.stopRule(await this.counterOf(row.id))) continue;
      // A session the spool replay already brought back keeps what the replay knew of it.
      const live = this.live.get(row.id);
      if (live) live.judged = true;
      else this.live.set(row.id, { agent: row.agent ?? 'claude-code', cwd: row.worktree && row.worktree !== '-' ? row.worktree : '', last: 0, calls: new Map(), wakeups: [], crons: new Map(), background: 0, looping: false, turn: 0, judged: true });
    }
    // Told before the hub reports ready, so the stop that comes first is held.
    await this.askingNow();
  }
  /** The line a judged stop carries, from the record as it stands now, never from the agent's words. */
  private async judgedLine(live: Live): Promise<string> {
    const state = live.claim && live.claimTurn === live.turn ? await this.stateOf(live.claim) : undefined;
    return verdictLine(state ? state.state : { outcome: null, requirements: [], running: [] });
  }
  /** A line that changed since the chat last saw one, for the session's next prompt (Codex hears a late verdict there); undefined otherwise. */
  private async landedLine(session: string): Promise<string | undefined> {
    const live = this.live.get(session);
    if (!live) return undefined;
    // After a restart the newest claim is the record's; its line may show once more, never go unseen.
    live.claim ??= await newestClaim((q) => this.record.raw(q), session).then((id) => (id ? `claim:${id}` : undefined));
    if (!live.claim) return undefined;
    const state = await this.stateOf(live.claim);
    if (!state) return undefined;
    const line = verdictLine(state.state);
    if (line === live.delivered) return undefined;
    live.delivered = line;
    return line;
  }
  /**
   * The pull request a session opened with `gh pr create`, read from the call's own PostToolUse (hookmap) and
   * recorded once as a session.reading, for the receipt (#83); a Codex session's too, whose rollout is never read.
   */
  private async openedPr(session: string, agent: string, url: string): Promise<void> {
    const reading = `Opened pull request ${url}`;
    const [seen] = await this.record.raw(`SELECT 1 FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') = ? LIMIT 1`, [session, reading]);
    if (!seen) await this.appendReading(session, agent, reading);
  }
  /** What a Codex stop's own records say (#39): its goal and heartbeat as the stop's loop, each new reading once. */
  private async codexStop(meta: HookMeta, data: Obj, live: Live): Promise<void> {
    const read = await codexReadings(meta.session, meta.transcript, meta.fields?.turn_id, live.from === 'continuation');
    if (read.loop) data.loop = read.loop;
    live.looping = read.loop?.state === 'looping' || live.looping;
    // A session's newest windows are what the runner admits the account's Codex jobs by.
    if (read.limits && read.account) await this.runner.report({ agent: 'codex', account: read.account, rate_limits: read.limits } as unknown as WindowReport).catch(() => undefined);
    const readings = read.version && !loopsCovered(read.version) && coveredBy('codex', read.version) ? [uncoveredLoops(read.version)] : read.readings;
    const before = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = '${sql(meta.session)}' AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Codex %: %' ORDER BY log_pos`)) as { reading: string }[];
    const standing = standingReadings(before.map((b) => b.reading));
    if (readings === read.readings) for (const gone of heartbeatsGone(standing, readings)) await this.appendReading(meta.session, meta.agent, gone);
    for (const reading of readings) if (!stands(standing, reading)) await this.appendReading(meta.session, meta.agent, reading);
  }
  /** The pull request a session opened, as its readings record it: the newest. */
  private async prOf(session: string | null): Promise<string | undefined> {
    if (!session) return undefined;
    const [row] = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = ? AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Opened pull request %' ORDER BY log_pos DESC LIMIT 1`, [session])) as { reading: string }[];
    return row ? prUrlIn(row.reading) : undefined;
  }
  /**
   * A status question a person typed ("still going?", "all done?", "what's next?", "anything for me?"), answered from
   * the record with no model call: the answer the prompt is blocked with. Undefined for any other prompt, and for
   * the same words from a scheduled task, a subagent's report, another session or a prompt the adapter can't place.
   */
  private async statusReply(meta: HookMeta): Promise<string | undefined> {
    const prompt = meta.fields?.prompt ?? '';
    if (!isStatusQuestion(prompt)) return undefined;
    // The prompt's origin as the hook mapped it: kept at the splice for one the transcript's queue had shown first
    // (#25), else on its own event, once its append has settled (one that never lands has no origin: not a person's).
    const spliced = this.sessions.get(meta.session)?.spliced;
    let from = spliced?.get(meta.id)?.from;
    spliced?.delete(meta.id);
    if (from === undefined) {
      await Promise.allSettled([...this.inflight]);
      const [row] = (await this.record.raw(`SELECT json_extract(data, '$.from') AS f FROM events WHERE id = ?`, [meta.id])) as { f: string | null }[];
      from = row ? row.f ?? 'unknown' : undefined;
    }
    if (from !== 'person') return undefined;
    const live = this.live.get(meta.session);
    // A turn newer than the claim's that has not finished (going, waiting, stuck, failed or gone quiet) answers with
    // the session's own state, whatever the earlier claim says; one that finished unjudged has no claim of its own.
    // With no claim at all the session's own state answers too.
    const unjudged = live?.state !== undefined && live.claimTurn !== live.turn && live.state !== 'finished';
    const claim = unjudged ? undefined : live?.claim ?? (await newestClaim((q) => this.record.raw(q), meta.session).then((id) => (id ? `claim:${id}` : undefined)));
    const state = claim ? await this.stateOf(claim) : undefined;
    const [stop] = (await this.record.raw(`SELECT MAX(ts) AS at FROM events WHERE session_id = ? AND kind = 'agent.stop' AND json_extract(data, '$.subagent') IS NULL`, [meta.session])) as { at: number | null }[];
    const needsYou = (await this.asks.inbox()).length;
    return statusAnswer(state, { session: meta.session, agent: live?.agent ?? meta.agent, worktree: live?.cwd || meta.cwd, needsYou, now: this.now(), lastStop: stop?.at ?? null, state: claim ? undefined : live?.state });
  }
  /**
   * test.verdict: a record state planted on a session's claim, by the events the core's gate would append (the
   * server serves it only with DEEP_HUB_TEST_VERDICT=1, to the CLI): a verdict.made with the given requirement
   * outcomes, a claim.sent_back for a FAIL's round, a run.started and run.finished for each check that ran, and a
   * run.started for each still going, with its expected time. The line and the receipt then read the record alone.
   */
  private async testVerdict(params: Obj): Promise<Obj> {
    const session = typeof params.session === 'string' ? params.session : undefined;
    const claim = typeof params.claim === 'string' && /^claim:[0-9A-Za-z]+$/.test(params.claim) ? params.claim : undefined;
    if (!session || !claim) throw refuse('type', '/params', 'Name the session and the claim (claim:<id>).', params);
    const [row] = (await this.record.raw(`SELECT commit_sha FROM claims WHERE id = ?`, [claim.slice(6)])) as { commit_sha: string | null }[];
    if (!row) throw new Refused(refusal('not_found', '/params/claim', `No claim ${claim} in the record.`, claim));
    const commit = row.commit_sha && /^[0-9a-f]{40}$/.test(row.commit_sha) ? row.commit_sha : '0'.repeat(40);
    const agent = this.live.get(session)?.agent ?? this.sessions.get(session)?.agent ?? 'claude-code';
    const core = this.connection('core', { session, agent });
    const ran = Array.isArray(params.ran) ? (params.ran as { check: string; outcome: string }[]) : [];
    const running = Array.isArray(params.running) ? (params.running as { check: string; about_s: number }[]) : [];
    const started = async (check: string): Promise<string> => {
      const ts = this.now();
      const run = `run:${ulid(ts)}`;
      await this.append(core, { v: 1, id: ulid(ts), kind: 'run.started', ts, subject: run, data: { run, check, claim, commit } });
      return run;
    };
    for (const r of ran) {
      const run = await started(r.check);
      const ts = this.now();
      await this.append(core, { v: 1, id: ulid(ts), kind: 'run.finished', ts, subject: run, data: { run, outcome: r.outcome, tests_run: 1, passed: r.outcome === 'passed' ? 1 : 0, runs: 1, evidence: [], check: r.check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'test' } });
    }
    for (const r of running) this.expected.set(await started(r.check), Number(r.about_s));
    const outcome = params.outcome;
    if (typeof outcome !== 'string') return { planted: true, verdict: null };
    const reqs = (Array.isArray(params.requirements) ? (params.requirements as Obj[]) : []).map((r) => ({
      req: String(r.req), outcome: String(r.outcome), check: String(r.check ?? 'unit'), depth: 'unit', oracle: 'code', runs: { clean: 0, needed: 0, counted: [] },
      smallest: typeof r.smallest === 'string' ? r.smallest : null, points_to: typeof r.points_to === 'string' ? r.points_to : null, evidence: [], proof: 'test_run',
    }));
    const failing = reqs.find((r) => r.outcome === outcome && r.smallest);
    const ts = this.now();
    const id = ulid(ts);
    const verdict = `verdict:${id}`;
    await this.append(core, {
      v: 1, id, kind: 'verdict.made', ts, subject: claim,
      data: { outcome, verdict, claim, reasons: [], requirements: reqs, smallest: failing?.smallest ?? null, points_to: failing?.points_to ?? null, commit, key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: 'test', tools: [] } },
    });
    if (outcome === 'FAIL' && typeof params.round === 'number') {
      const at = this.now();
      await this.append(core, { v: 1, id: ulid(at), kind: 'claim.sent_back', ts: at, subject: claim, data: { claim, verdict, round: params.round, to: `session:${letters(session)}` } });
    }
    return { planted: true, verdict };
  }

  /** test.send_back: a send-back planted for the session's next stop (the hub runs with DEEP_HUB_TEST_SEND_BACK=1). */
  private sendBack(params: Obj): Obj {
    if (typeof params.session !== 'string' || typeof params.reason !== 'string') throw refuse('type', '/params', 'Name the session and the reason, as strings.', params);
    this.routesOf(params.session).sendBacks.push(params.reason);
    this.askingSoon();
    return { planted: true };
  }
  /**
   * A wait on `key`, woken by whoever wakes `waits` for it, by the hub stopping or after `ms`. It counts from the
   * call, so a wake that comes while the caller still reads what it waits on isn't missed; `cancel` ends it.
   */
  private wakeable(waits: Map<string, Set<() => void>>, key: string, ms: number): { woken: Promise<void>; cancel: () => void } {
    const set = waits.get(key) ?? new Set();
    waits.set(key, set);
    let wake = (): void => undefined;
    const woken = new Promise<void>((done) => {
      wake = () => {
        clearTimeout(timer);
        set.delete(wake);
        if (!set.size && waits.get(key) === set) waits.delete(key);
        done();
      };
    });
    const timer = setTimeout(wake, Math.max(0, ms));
    set.add(wake);
    return { woken, cancel: wake };
  }

  /** The hook kinds some loaded extension handles, read once the extensions have started. */
  hooks(): string[] {
    return this.extensions?.hooks() ?? [];
  }
  /**
   * The extensions' joined reply to a tool.before, or null when it takes the hook's fail-open policy: while appends
   * fail every gate is watch-only, and the extensions' denies and context go with them. A handler that failed is
   * named on stderr; its reply is already out of the join.
   */
  async extensionHook(data: unknown): Promise<ExtensionReply | null> {
    if (this.blocked || !this.extensions) return null;
    const reply = await this.extensions.hook({ kind: 'tool.before', data, deadline: EXTENSION_HOOK_MS, bound: contextBoundFor(EXTENSION_HOOK_MS) });
    for (const { reason } of reply.failed) process.stderr.write(`deep hub: tool.before handler failed: ${reason}\n`);
    return { denies: reply.denies, context: reply.context };
  }

  /** Records, once, that a call the hub answered was let through by deep-hook as late, naming its guard entries. */
  private async lateAnswered(meta: HookMeta, matched: string[]): Promise<void> {
    const reading = `deep-hook let ${meta.event} ${meta.id} through as late, after the hub's answer missed its deadline; `
      + (matched.length ? `it matched ${matched.join(', ')}` : 'it matched no guard entry');
    // The ID is a ULID (checked before this is called), so it goes into the query as it is.
    const known = await this.record.raw(`SELECT 1 FROM events WHERE kind = 'session.reading' AND instr(json_extract(data, '$.reading'), ?) > 0 LIMIT 1`, [meta.id]);
    if (known.length) return;
    await this.appendReading(meta.session, meta.agent, reading);
  }

  /**
   * Reads what the session's transcript gained since the last hook. A turn there that made tool calls, none of
   * whose hooks reached the hub, is recorded once the next prompt shows it ended and a later hook judges it: the
   * session then reads "hooks not reaching DeepBuild", so failing open is never silent.
   */
  private async readTranscript(session: Session): Promise<void> {
    let handle: FileHandle;
    try {
      handle = await open(session.transcript, 'r');
    } catch {
      return;
    }
    try {
      const { size } = await handle.stat();
      // At most TRANSCRIPT_STEP is held at once: more growth than that is read a step at a time.
      while (size > session.read) {
        const want = Buffer.alloc(Math.min(size - session.read, TRANSCRIPT_STEP));
        // Only the bytes the read returned: a transcript cut shorter since the stat returns fewer.
        const { bytesRead } = await handle.read(want, 0, want.length, session.read);
        if (!bytesRead) return;
        const text = want.subarray(0, bytesRead);
        // Only whole lines: a line still being written is read with the next hook. A line longer than a step is
        // passed over; what is left of it doesn't parse, as no prompt or call longer than a step would.
        let end = text.lastIndexOf(0x0a) + 1;
        if (!end) {
          if (text.length < TRANSCRIPT_STEP) return;
          end = text.length;
        }
        const base = session.read;
        session.read += end;
        for (let at = 0; at < end;) {
          const from = base + at;
          const next = text.indexOf(0x0a, at) + 1 || end;
          const raw = text.subarray(at, next).toString('utf8');
          at = next;
          let line: unknown;
          try {
            line = JSON.parse(raw);
          } catch {
            continue;
          }
          // A message typed while the agent works waits in the queue, with no hook until it is dequeued (#80). The
          // desktop app queues every prompt and dequeues it at once (#340): one no hook found waiting never waited.
          if (isObj(line) && line.type === 'queue-operation') {
            const queue = session.queued ??= [];
            if (line.operation === 'enqueue' && typeof line.content === 'string') queue.push({ text: line.content, taken: false });
            // The planted wrong program counts every enqueue, the app's own before each prompt included.
            else if (line.operation === 'dequeue' && this.options.plant !== 'counts-every-enqueue') queue.shift();
            if (queue.length > 64) queue.splice(0, queue.length - 64);
          }
          if (!isObj(line) || line.isSidechain === true || !isObj(line.message)) continue;
          const content = line.message.content;
          const parts = Array.isArray(content) ? content.filter(isObj) : [];
          const prompt = line.type === 'user' && !(parts.length && parts.every((c) => c.type === 'tool_result'));
          // A prompt's entry, which its origin joins to, opens the turn whose records its stop reads.
          if (prompt && typeof line.promptId === 'string') {
            if (session.prompts.size >= 256) session.prompts.delete(session.prompts.keys().next().value!);
            session.prompts.set(line.promptId, line);
            session.entries = [line];
          } else if (session.entries.length < TURN_ENTRIES) session.entries.push(line);
          if (prompt) {
            // A person's prompt ends the turn before it.
            if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
            session.turn = { uuid: typeof line.uuid === 'string' && line.uuid ? line.uuid : `offset:${from}`, from, calls: [] };
          } else if (line.type === 'assistant' && session.turn) {
            for (const part of parts) if (part.type === 'tool_use' && typeof part.id === 'string') session.turn.calls.push(part.id);
          }
        }
      }
    } catch {
      // A transcript that can't be read now is read from the same place with the next hook.
    } finally {
      await handle.close();
    }
  }

  /** A session's last turn ends with it: no prompt comes after it to end it. */
  private endTurn(session: Session): void {
    if (session.turn?.calls.length) session.closed.push({ ...session.turn, at: performance.now() });
    session.turn = undefined;
  }

  /**
   * Judges the turns whose end the hub read at least TURN_GRACE ago, on its own monotonic clock: a hook started
   * before that read has reached the hub by then, since deep-hook gives up on the hub after 20 ms and spools. While
   * a replay runs, or a spool waits for one, the turns wait for it: one of their hooks may be there. A turn none of
   * whose calls reached the hub is recorded. Turns still in their grace are judged by a timer.
   */
  private judge(session: Session): void {
    if (session.closed.length) this.replayLate();
    if (this.replaying) {
      session.deferred = true;
      return;
    }
    const now = performance.now();
    const waits = (turn: Turn) => turn.calls.some((call) => session.pending.has(call));
    for (const turn of session.closed.filter((t) => !t.recording && now - t.at! >= TURN_GRACE)) {
      if (waits(turn)) break;
      if (turn.calls.some((call) => session.reached.has(call))) {
        for (const call of turn.calls) session.reached.delete(call);
        session.closed.splice(session.closed.indexOf(turn), 1);
        continue;
      }
      turn.recording = true;
      // Settled like a hook's drafts: the next hook doesn't wait for its commit. The turn, and so where a restart
      // reads from, stays until its reading is durable; one whose append fails is judged again with the next hook.
      void this.appendReading(session.id, session.agent, HOOKS_MISSING).then(() => {
        session.closed.splice(session.closed.indexOf(turn), 1);
        this.saveCursors();
      }, () => {
        turn.recording = false;
      });
    }
    const next = session.closed.find((t) => !t.recording);
    if (next && !waits(next) && !session.judging && !this.stopping) {
      session.judging = setTimeout(() => {
        session.judging = undefined;
        void this.queue(async () => this.judge(session), true).catch(() => undefined);
      }, Math.max(1, TURN_GRACE - (now - next.at!)));
      session.judging.unref();
    }
    // Calls no read turn holds (a subagent's) are forgotten oldest first; a read turn's are kept until it's judged.
    if (session.reached.size > REACHED) {
      const held = new Set([...session.closed, ...(session.turn ? [session.turn] : [])].flatMap((t) => t.calls));
      for (const call of session.reached) {
        if (session.reached.size <= REACHED) break;
        if (!held.has(call)) session.reached.delete(call);
      }
    }
    this.saveCursors();
  }

  /** Keeps where each live session's transcript is judged from (its oldest unjudged turn), so a restart judges what it missed. */
  private saveCursors(): void {
    if (this.saving || this.stopping) return;
    this.saving = setTimeout(() => this.writeCursors(), CURSOR_SAVE);
    this.saving.unref();
  }
  private writeCursors(): void {
    clearTimeout(this.saving);
    this.saving = undefined;
    const cursors = new Map(this.cursors);
    for (const s of this.sessions.values()) {
      cursors.delete(s.id);
      // An ended session is kept until its last turns are judged and their readings durable.
      if (s.ended && !s.closed.length) continue;
      cursors.set(s.id, { transcript: s.transcript, read: s.closed[0]?.from ?? s.turn?.from ?? s.read, reached: [...s.reached], ...(s.ended ? { ended: { agent: s.agent } } : {}) });
    }
    // Synced, so a power cut leaves the last whole save; a failed save is made again with the next hook's.
    try {
      writeSynced(this.root.transcripts, Buffer.from(JSON.stringify(Object.fromEntries(cursors))));
    } catch (error) {
      process.stderr.write(`deep hub: ${this.root.transcripts} not saved: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  /**
   * Whose a hook is: a job's, when its session ID is the one the runner read from that job's own output and it was
   * sent inside the job's run; held, when it comes from a running job's folder before that ID is read; otherwise
   * the session's own, with a reading when it only looks like a job's.
   */
  private async whose(meta: HookMeta, seq: string | undefined): Promise<{ job?: string; wait?: string; reading?: { job: string; text: string } }> {
    const jobs = await this.runner.list();
    const at = seq ? Number(BigInt(seq) / 1_000_000n) : Date.now();
    const during = (j: JobRecord) => j.ran !== undefined && at >= j.ran.from && (j.ran.to === undefined || at <= j.ran.to);
    const own = jobs.find((j) => meta.session && j.session === meta.session && during(j));
    if (own) return { job: own.job };
    const there = jobs.find((j) => meta.cwd && (meta.cwd === j.folder || isUnder(meta.cwd, j.folder)));
    if (there && there.session === undefined && (there.state === 'running' || there.state === 'stopping')) return { wait: there.job };
    const resumed = jobs.find((j) => meta.session && j.session === meta.session);
    if (resumed) return { reading: { job: resumed.job, text: `It resumes the session ID of DeepBuild's job ${resumed.job}, which it is not: it is judged as your own session.` } };
    if (there) return { reading: { job: there.job, text: `It works in the folder of DeepBuild's job ${there.job} (${there.folder}), which it is not: it is judged as your own session.` } };
    return {};
  }
  /** Resolves once the runner has read the job's session ID, or the job has ended without one. */
  private park(job: string): Promise<void> {
    let parked = this.parked.get(job);
    if (!parked) {
      parked = (async () => {
        for (;;) {
          const rec = await this.runner.status(job).catch(() => undefined);
          if (!rec || rec.session !== undefined || (rec.state !== 'running' && rec.state !== 'stopping')) return;
          await new Promise((done) => setTimeout(done, 50));
        }
      })();
      this.parked.set(job, parked);
      void parked.finally(() => this.parked.delete(job));
    }
    return parked;
  }

  /** A process's start time, or undefined when it can't be read. Read from the children's thread, never this one or the event loop. */
  private startOf(pid: number, fresh = false): Promise<string | undefined> {
    const known = this.starts.get(pid);
    if (known && !fresh) return known;
    const read = startOf(pid);
    // A fresh read replaces the kept one once it is in: a hook's check meanwhile reads the kept one, never waits on it.
    // One that fails keeps the kept one, since a failed ps proves nothing about the process.
    if (known) void read.then((start) => { if (start !== undefined) this.starts.set(pid, read); });
    else this.starts.set(pid, read);
    return read;
  }

  /**
   * Whether an event can be checked against the session it claims: its transcript under its agent's home, its
   * working folder and its process tree (its hook's parent, by PID and start time) all as the session's own
   * hooks established them. The first checked event of a session establishes it.
   */
  private async verify(meta: HookMeta): Promise<boolean> {
    // A Codex hook may carry no transcript path (its facts: `transcript_path: string|null`); such a session is checked by
    // its working folder and process tree alone, and nothing is read from a transcript for it (#806).
    const none = meta.agent === 'codex' && !meta.transcript;
    if (!meta.session || !meta.cwd || (!none && !isAbsolute(meta.transcript))) return false;
    const homes = meta.agent === 'codex' ? sessionHomes(this.root.dir) : [join(homedir(), '.claude', 'projects')];
    const transcript = none ? '' : resolve(meta.transcript);
    // pi's --session-dir puts a session's file anywhere; its package runs inside pi, and pi's process is what is checked.
    if (!none && meta.agent !== 'pi' && !homes.some((home) => isUnder(transcript, home))) return false;
    const start = await this.startOf(meta.ppid);
    if (!start) return false;
    const session = this.sessions.get(meta.session);
    if (!session) {
      // A session the last hub met is read from where that hub left it; one this hub meets first, from here on:
      // what its transcript held before isn't judged.
      const cursor = this.cursors.get(meta.session);
      this.cursors.delete(meta.session);
      const left = cursor?.transcript === transcript && typeof cursor.read === 'number' && Array.isArray(cursor.reached) ? cursor : undefined;
      const read = left ? left.read : none ? 0 : await stat(transcript).then((s) => s.size, () => 0);
      this.sessions.set(meta.session, { id: meta.session, thread: meta.session, agent: meta.agent, pid: meta.ppid, start, cwd: meta.cwd, transcript, ended: false, read, turn: undefined, closed: [], reached: new Set(left?.reached), pending: new Map(), prompts: new Map(), entries: [] });
      // A session's first cursor is written at once: a restart before it would read the session from its end.
      this.writeCursors();
      return true;
    }
    // A Codex thread's identity is its payload's: resumed in a new Codex process, once the old one is gone or the session
    // ended, it is bound to that process from its start.
    if (meta.agent === 'codex' && transcript === session.transcript && meta.event === 'SessionStart' && (meta.fields?.source === 'resume' || meta.fields?.source === 'startup')
      && (session.ended || await this.startOf(session.pid, true) !== session.start) && CODEX_BINARY.test(await argsOf(meta.ppid))) {
      Object.assign(session, { pid: meta.ppid, start, cwd: meta.cwd, ended: false });
      return true;
    }
    // pi resumes a session from a new process, by its file: its start takes the session over once the old process is gone.
    const gone = async () => {
      if (!session.pid) return true;
      const was = await this.startOf(session.pid, true);
      return was === undefined ? !running(session.pid) : was !== session.start;
    };
    if (meta.agent === 'pi' && session.agent === 'pi' && meta.event === 'SessionStart' && transcript === session.transcript && await gone()) {
      Object.assign(session, { pid: meta.ppid, start, cwd: meta.cwd });
      return true;
    }
    return transcript === session.transcript && meta.cwd === session.cwd && meta.ppid === session.pid && start === session.start;
  }

  /** Binds a deep mcp to the one live session whose checked hooks came from its parent process, or to none. */
  mcpHello(parent: { pid: number; start: string }): Promise<string | null> {
    return this.queue(async () => {
      const actual = await this.startOf(parent.pid, true);
      if (!actual || actual !== parent.start) return null;
      const served = [...this.sessions.values()].filter((s) => s.pid === parent.pid && s.start === actual && !s.ended);
      // A Codex process may run another thread at any time: each of its calls binds by its own stamp.
      return served.length === 1 && served[0]!.agent !== 'codex' ? served[0]!.id : null;
    });
  }

  // ---- Methods.

  /**
   * One socket method. It sees every hook that arrived before it, but holds the queue only to bind a deep_*
   * call to its session, so a long call (a run's start, a file read, a test load) holds up no session's hooks.
   */
  call(method: string, params: unknown, context: CallContext): Promise<unknown> {
    const p = isObj(params) ? params : {};
    if (method === 'mcp.call') return this.mcpCall(p, context);
    return this.queue(async () => undefined).then(() => this.dispatch(method, p, context));
  }
  private async dispatch(method: string, params: Obj, context: CallContext): Promise<unknown> {
    switch (method) {
      case 'hub.health':
      case 'health': return this.health();
      case 'session.wait': return this.waitAnswer(params, context);
      case 'session.delivered': return this.placed(params, context);
      case 'session.stop_waiting': return this.stopWaiting(context);
      case 'session.note': return this.note(params);
      case 'test.send_back': return this.sendBack(params);
      case 'test.verdict': return this.testVerdict(params);
      case 'events.read': return this.read(params);
      case 'inbox.read': return this.reflecting(() => this.inbox());
      case 'sessions.read': return this.reflecting(async () => ({ sessions: (await this.record.table('sessions')).rows }));
      case 'numbers.read': return this.reflecting(async () => ({ numbers: (await this.record.table('readings')).rows }));
      case 'changes.read': return this.change(params);
      case 'evidence.read': return this.evidence(params);
      case 'ask.answer': return this.answer(params, context);
      case 'decision.overrule': return this.overrule(params, context);
      case 'ask.undo': return this.undo(params, context);
      case 'offer.save': return this.saveOffered(params, context);
      case 'staged.undo': return this.staging.undo(params);
      case 'device.pair': return this.pair(params);
      case 'extension.install': return this.install(params, context);
      case 'you.confirm': return this.confirmCommand(params, context);
      // A hook that ended before this read is in the row: one deep-hook spooled is replayed first, and one acknowledged has its turn on the core's queue.
      case 'status.read':
        this.replayLate();
        return (this.replaying ?? Promise.resolve()).then(() => this.queue(async () => undefined)).then(() => this.reflecting(async () => ({ rows: await statusRows((sql) => this.record.raw(sql), this.now()) })));
      case 'guard.add': return this.addGuard(params, context);
      case 'evidence.paste': return this.paste(params);
      case 'run.start': return this.runStart(params);
      case 'test.load': return this.testLoad(params);
      case 'record.backup': return this.backup(params);
      case 'env.up': return this.envUp(params, context);
      case 'env.down': return this.envDown(params, context);
      case 'wiki.build': {
        const built = await this.wikiBuild.build();
        await syncRejected((q) => this.record.raw(q), this.root.dir);
        return built;
      }
      case 'memory.list': return { lessons: await this.lessons(), rejected: await rejectedDirections((q) => this.record.raw(q)) };
      case 'memory.act': return this.memoryAct(params, context);
      case 'job.submit': return this.runner.submit(params.spec as JobSpec);
      case 'job.status': return this.runner.status(String(params.job));
      case 'job.list': return { jobs: await this.runner.list() };
      case 'job.output': return { stdout: await this.runner.output(String(params.job)) };
      case 'canvas.show': return this.showCli(params, context);
      case 'canvas.revisions': return this.canvasCall({ call: 'revisions', doc: String(params.doc) });
      case 'canvas.messages': return this.canvasCall({ call: 'messages', session: String(params.session) });
      case 'canvas.user': return this.canvasUser(params, context);
      case 'canvas.drawn': return this.drawnBy(context);
      case 'windows.report': return this.runner.report(params as unknown as WindowReport).then(() => ({ reported: true }));
      default: throw new Refused(refusal('unknown_method', '/method', `The hub serves no method ${method}.`, method));
    }
  }

  /**
   * `deep backup <folder>` (#572): the record through SQLite's online backup on the writer's connection, which runs
   * here, off the hub's event loop, so hooks are answered while it copies; then the evidence and wiki folders. Evidence
   * is written before the event that cites it commits, so a copy taken after the record's holds every file it cites.
   * The record's copy is named ledger.db only once the folders are copied, so a folder with one holds a whole backup.
   */
  private async backup(params: Obj): Promise<Obj> {
    const folder = params.folder;
    if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Refused(refusal('type', '/params/folder', 'Name the backup folder by its absolute path.', folder));
    const ledger = join(folder, 'ledger.db');
    const partial = `${ledger}.partial`;
    // Checked before anything is made: the folder's nearest part that exists, with its links resolved.
    let nearest = folder;
    while (!existsSync(nearest)) nearest = dirname(nearest);
    const [real, own] = [await realpath(nearest), await realpath(this.root.dir)];
    if (real === own || real.startsWith(`${own}/`)) throw new Refused(refusal('conflict', '/params/folder', `Back up outside DeepBuild's own folder ${own}, which the backup copies.`, folder));
    // Only an empty folder, made yours alone: nothing in it is read or written through, and no one else reads the copy.
    if (existsSync(folder) && readdirSync(folder).length > 0) throw new Refused(refusal('conflict', '/params/folder', `${folder} isn't empty; back up into an empty folder, or one that doesn't exist yet.`, folder));
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);
    const copies = [[this.root.evidence, 'evidence'], [this.root.wiki, 'wiki']] as const;
    try {
      await this.record.backup(partial);
      await chmod(partial, 0o600);
      await synced(partial);
      for (const [from, name] of copies) await copySynced(from, join(folder, name));
      // What the wiki last wrote sits beside its folder (#356): without it, every restored page would read as your edit.
      if (existsSync(wikiWritten(this.root.wiki))) await copyFile(wikiWritten(this.root.wiki), wikiWritten(join(folder, 'wiki')));
      // ledger.db names a whole backup only once all of it is on disk, and lasts once its folder is synced.
      await synced(folder);
      renameSync(partial, ledger);
    } catch (error) {
      rmSync(partial, { force: true });
      for (const [, name] of copies) rmSync(join(folder, name), { recursive: true, force: true });
      rmSync(wikiWritten(join(folder, 'wiki')), { force: true });
      throw error;
    }
    // After the rename the backup is whole, so a failed sync here leaves it as it is.
    await synced(folder);
    return { folder };
  }

  async health(): Promise<Obj> {
    const network = Object.values(networkInterfaces()).flat().some((i) => i && !i.internal) ? 'reachable' : 'unreachable';
    // The timing relations our entries in Claude Code's settings keep, and what the settings watch and recheck put back.
    const claude = { relations: relations(this.root.dir).map((r) => ({ name: r.name, holds: r.holds, reading: r.text })), readings: [...this.settingsReadings] };
    const codex = { relations: codexRelations(this.root.dir).map((r) => ({ name: r.name, holds: r.holds, reading: r.text })), readings: [...modified(this.root.dir), ...trustProblems(this.root.dir).map((p) => `Codex's hook list reports ${p}`)], trust: readTrust(this.root.dir) ?? null };
    return { gates: { watch_only: this.blocked !== undefined, reason: this.blocked ?? null }, secrets: await this.secretStore(), network, claude, codex, jobs: Object.fromEntries([...this.jobs].map(([name, failing]) => [name, { failing }])) };
  }
  /** Whether this process can reach the OS secret store, read at most every ten seconds. */
  private secretStore(): Promise<string> {
    const at = Date.now();
    if (this.secrets && at - this.secrets.at < SECRETS_TTL) return this.secrets.value;
    const value = new Promise<string>((done) => {
      // securityd answers the keychain list for this process's security session, whatever HOME is.
      if (process.platform === 'darwin') execFile('/usr/bin/security', ['list-keychains'], (error) => done(error ? 'unreachable' : 'reachable'));
      else done(process.env.DBUS_SESSION_BUS_ADDRESS ? 'reachable' : 'unreachable');
    });
    this.secrets = { at, value };
    return value;
  }

  /**
   * A page of the log as each event's JSON text, the record's own JSON with `verified` for its unverified mark,
   * built from the stored text without parsing it again: the reads and the stream page through many events.
   */
  private async page(after: number, limit: number, kinds?: string[]): Promise<{ log_pos: number; json: string }[]> {
    const only = kinds ? ` AND kind IN (${kinds.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')})` : '';
    const rows = (await this.record.raw(`SELECT v, id, kind, writer, actor, scope, ts, log_pos, data, evidence, subject, CAST(seq AS TEXT) AS seq, session_id, project_id, agent, unverified FROM events WHERE log_pos > ${after}${only} ORDER BY log_pos LIMIT ${limit}`)) as Row[];
    return rows.map((r) => ({ log_pos: r.log_pos, json: eventText(r) }));
  }
  /**
   * The log's committed end, read in the same step as `read` starts, before anything else can append: a read
   * reflects at least that log_pos, so a consumer that subscribes after it misses nothing.
   */
  private async reflecting(read: () => Promise<Obj>): Promise<Obj> {
    await Promise.allSettled([...this.inflight]);
    const end = this.record.raw('SELECT coalesce(max(log_pos), 0) AS log_pos FROM events');
    const result = read();
    result.catch(() => undefined);
    return { log_pos: Number(((await end) as { log_pos: number }[])[0]!.log_pos), ...(await result) };
  }
  /**
   * A page of the log: a full one reflects its last event, a short one the log's end, so an empty gap is crossed
   * once. Its events go back as one JSON array's text, which the server writes as it is.
   */
  private async read(params: Obj): Promise<Obj> {
    const after = Number.isSafeInteger(params.after) && (params.after as number) >= 0 ? (params.after as number) : 0;
    const limit = Number.isSafeInteger(params.limit) && (params.limit as number) > 0 ? Math.min(params.limit as number, 1000) : 1000;
    const kinds = Array.isArray(params.kinds) && params.kinds.every((k) => typeof k === 'string') ? (params.kinds as string[]) : undefined;
    const ahead = !kinds && this.ahead?.after === after && this.ahead.limit === limit ? this.ahead : undefined;
    this.ahead = undefined;
    let out: { log_pos: number; events: string };
    if (ahead) {
      await Promise.allSettled([...this.inflight]);
      out = { log_pos: ahead.log_pos, events: ahead.events };
    } else {
      const read = await this.reflecting(async () => ({ events: await this.page(after, limit, kinds) }));
      const events = read.events as { log_pos: number; json: string }[];
      out = { log_pos: events.length === limit ? events[limit - 1]!.log_pos : Math.max(after, read.log_pos as number), events: `[${events.map((e) => e.json).join(',')}]` };
    }
    // History is paged in order: the next full page is built while the reader takes this one. A full page never
    // changes once committed, since log positions only grow and a gap never fills.
    if (!kinds && out.events !== '[]') {
      setImmediate(() => void this.page(out.log_pos, limit).then((next) => {
        if (next.length === limit) this.ahead = { after: out.log_pos, limit, log_pos: next[limit - 1]!.log_pos, events: `[${next.map((e) => e.json).join(',')}]` };
      }));
    }
    return out;
  }
  /**
   * changes/:id: a claim, with the runs and verdicts of its checks, and its receipt (#83): the line the chat showed
   * and the second line; the checks it ran; its ask with the PR's state and link, read from the forge now; what it
   * produced (the PR, the files the session wrote, the pages the record saw); and, once it passed, the next
   * unblocked issue in its epic.
   */
  private change(params: Obj): Promise<Obj> {
    const id = typeof params.id === 'string' && /^claim:[0-9A-Za-z]+$/.test(params.id) ? params.id.slice(6) : undefined;
    if (!id) throw new Refused(refusal('pattern', '/params/id', 'Name the change as claim:<id>.', params.id));
    return this.reflecting(async () => {
      const [claim] = await this.record.raw(`SELECT * FROM claims WHERE id = ?`, [id]);
      if (!claim) throw new Refused(refusal('not_found', '/params/id', `No change claim:${id} in the record.`, params.id));
      const runs = await this.record.raw(`SELECT * FROM runs WHERE claim_id = ? ORDER BY started`, [id]);
      const verdicts = await this.record.raw(`SELECT * FROM verdicts WHERE claim_id = ? ORDER BY created`, [id]);
      const state = (await this.stateOf(`claim:${id}`))!;
      const line = verdictLine(state.state);
      const url = await this.prOf(state.session);
      const pr = url ? parsePrUrl(url) : undefined;
      const forge = pr ? new Forge(this.options.forge ?? 'https://api.github.com', process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken()) : undefined;
      const pulled = pr && forge ? await forge.pull(pr) : undefined;
      const files = state.session ? ((await this.record.raw(`SELECT path FROM session_files WHERE session = ? AND kind IN ('edit', 'write') ORDER BY last`, [state.session])) as { path: string }[]).map((r) => r.path) : [];
      const next_issue = pr && forge && pulled?.closes !== undefined && state.state.outcome === 'PASS' ? await forge.nextIssue(pr, pulled.closes) : null;
      // A forge that didn't answer leaves the state unknown, never a guess.
      const asks = [{ ask: state.task, pr: url ? { state: pulled?.state ?? 'unknown', url } : null }];
      const second = [
        state.checks.length ? `checks: ${state.checks.map((c) => `${c.check} ${c.outcome}`).join(', ')}` : '',
        url ? `PR ${pulled?.state ?? 'unknown'} ${url}` : '',
        files.length ? `wrote ${files.join(', ')}` : '',
        next_issue ? `next issue #${next_issue.number} ${next_issue.url}` : '',
      ].filter(Boolean).join(' · ');
      return { change: { claim, runs, verdicts, line, second, checks: state.checks, asks, produced: { pr: url ?? null, files, pages: [] }, next_issue } };
    });
  }
  /** evidence/:sha: what the store holds of one file, never its bytes. */
  private evidence(params: Obj): Promise<Obj> {
    const sha = typeof params.sha === 'string' && /^[0-9a-f]{64}$/.test(params.sha) ? params.sha : undefined;
    if (!sha) throw new Refused(refusal('pattern', '/params/sha', 'Name the evidence by its SHA-256, in lower-case hex.', params.sha));
    return this.reflecting(async () => {
      const evidence = await this.store.get(sha);
      if (!evidence) throw new Refused(refusal('not_found', '/params/sha', `The store holds no evidence ${sha}.`, sha));
      return { evidence: JSON.parse(JSON.stringify(evidence)) as Obj };
    });
  }

  // ---- Answers on the trusted path (#24, #34).

  /**
   * Whether an answer may count: a paired device's valid signature, from any role; otherwise, from the CLI alone,
   * the OS confirming you with a prompt that names what you answer. The control token and the peer check alone
   * never make one count, and a deep command run inside an agent's process tree acts as that agent's session.
   */
  private async trusted(params: Obj, context: CallContext, what: string, handle: string): Promise<void> {
    if (params.signature !== undefined || params.device !== undefined) {
      if (this.devices.signed(params)) return;
      throw new Refused(refusal('credential', '/params/signature', 'Sign the answer with a device you paired, over exactly the params it sends.', params.device));
    }
    if (context.role !== 'cli') throw new Refused(refusal('unconfirmed', '/params/signature', `${handle} stays open: an answer from the app counts only when a device you paired signs it.`, handle));
    const agent = await this.agentAbove(context.peer);
    if (agent && this.options.plant !== 'answer-inside-session') {
      throw new Refused(refusal('role', '/params/ask', `${handle} stays open: this deep command runs inside agent session ${agent}'s process tree, so it acts as that session, and no agent answers an ask. Answer it from your own terminal or on the question card.`, handle));
    }
    const plant = this.options.plant;
    if (plant === 'answer-on-token' || plant === 'answer-on-peer-check') return;
    const why = await confirmYou(what, this.options.confirm);
    if (why) {
      throw new Refused(refusal('unconfirmed', '/params/ask', `${handle} stays open: the OS didn't confirm you (${why}). An answer from the CLI counts only once it does; answer again and confirm, or answer on the question card.`, handle, true));
    }
  }

  /** Every ask, as the inbox projection holds it, with each one's question and options; `deep inbox` lists the open ones. */
  private async inbox(): Promise<Obj> {
    const rows = (await this.record.raw('SELECT id, question, options FROM asks')) as { id: string; question: string | null; options: string | null }[];
    const texts = new Map(rows.map((r) => [r.id, r]));
    // What each decision answered, for the asks it decided for you (#27).
    const saved = new Map(((await this.record.raw('SELECT id, answer FROM decisions')) as { id: string; answer: string | null }[]).map((d) => [`decision:${d.id}`, d.answer === null ? null : JSON.parse(d.answer) as string]));
    // An authority ask's plan, by the digest an approval binds: what `deep inbox` shows before you answer (#69).
    // The first the core proposed for each ask, as the asks core holds it; an agent's plan.proposed binds nothing.
    const plans = (await this.record.raw("SELECT data FROM events WHERE kind = 'plan.proposed' AND writer = 'core' ORDER BY log_pos")) as { data: string }[];
    const planOf = new Map<string, { hash: string; steps: unknown }>();
    for (const { data } of plans) {
      const d = JSON.parse(data) as { ask: string; hash: string; steps: unknown };
      if (!planOf.has(d.ask)) planOf.set(d.ask, { hash: d.hash, steps: d.steps });
    }
    return {
      asks: (await this.asks.inbox()).map((row) => {
        const text = texts.get(row.ask.slice(4));
        return {
          ...row, question: text?.question ?? '', options: text?.options ? (JSON.parse(text.options) as { id: string }[]).map((o) => o.id) : [], plan: planOf.get(row.ask) ?? null,
          ...(row.outcome === 'decided_for_you' && row.decision ? { answer: saved.get(row.decision) ?? null } : {}),
        };
      }),
      // Permissions you said yes to in the terminal, offered back as decisions to save: never asks (#23).
      offers: await this.openOffers(),
    };
  }

  /**
   * asks/:id/answer, from the app or `deep inbox answer`: once the trusted path allows it, the asks core records it
   * and the core saves it as a decision for the ask's repo, or its session; an ask with neither saves none.
   */
  private async answer(params: Obj, context: CallContext): Promise<Obj> {
    const { ask: handle, device: _device, signature: _signature, ...input } = params;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>, as deep inbox lists it.', handle));
    const [row] = (await this.record.raw(`SELECT e.session_id AS session, e.project_id AS project, e.data AS data, a.status AS status FROM events e JOIN asks a ON a.id = e.id WHERE e.id = ? AND e.kind = 'ask.created'`, [handle.slice(4)])) as { session: string | null; project: string | null; data: string; status: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; answer an ask deep inbox lists.`, handle));
    const answered = (): Promise<void> => this.asks.answer(this.connection(context.role === 'app' ? 'app' : 'cli'), handle, input).catch((error: unknown) => { throw asRefused(error); });
    // A closed ask takes no answer: the asks core records the refusal, and there's nothing to confirm you for.
    if (row.status !== 'open' && row.status !== 'later') {
      await answered();
      throw new Refused(refusal('not_found', '/params/ask', `${handle} is closed.`, handle));
    }
    const ask = JSON.parse(row.data) as { key: string; question: string; options: { id: string; label: string; decision?: string }[] };
    const chosen = ask.options.find((o) => o.id === input.option);
    if (input.option !== undefined && !chosen) {
      throw new Refused(refusal('enum', '/params/option', `${handle} has no option ${String(input.option)}; its options are ${ask.options.map((o) => o.id).join(', ')}.`, input.option));
    }
    await this.trusted(params, context, `answer “${ask.question.slice(0, 120)}” with ${chosen ? `“${chosen.label.slice(0, 80)}”` : 'your words'}`, handle);
    // From the CLI, the OS prompt that just confirmed you is the click an approval binds (#321): its token is minted here,
    // for an approval only, so any other answer is handed on as its twin from the app is (#34).
    if (context.role === 'cli' && chosen?.decision === 'allow' && input.token === undefined) input.token = `os-confirm:${ulid(this.now())}`;
    // `deep inbox answer` names an option, and its prompt named the plan the card shows: an approval binds that one (#69).
    if (context.role === 'cli' && chosen?.decision === 'allow' && input.plan_hash === undefined) input.plan_hash = (await this.asks.card(handle)).plan?.hash ?? null;
    await answered();
    // The asks core saved an option you chose for the ask's repo, or its session, never wider than its card showed.
    const [saved] = (await this.record.raw(`SELECT data FROM events WHERE kind = 'decision.created' AND subject = ? ORDER BY log_pos DESC LIMIT 1`, [handle])) as { data: string }[];
    const answer = chosen?.id ?? String(input.words ?? input.image);
    await this.syncStanding().catch(() => undefined);
    await syncRejected((q) => this.record.raw(q), this.root.dir).catch(() => undefined);
    return { ask: handle, answer, scope: saved ? String((JSON.parse(saved.data) as Obj).scope) : null };
  }
  /** asks/:id/undo, from the app or `deep inbox undo`: a defaulted ask opens again, once the trusted path allows it. */
  private async undo(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.ask;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>.', handle));
    const [row] = (await this.record.raw(`SELECT question, status FROM asks WHERE id = ?`, [handle.slice(4)])) as { question: string; status: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; undo the default of an ask the inbox holds.`, handle));
    if (row.status !== 'defaulted') throw new Refused(refusal('not_found', '/params/ask', `${handle} didn't take its default (it's ${row.status}), so there's nothing to undo.`, handle));
    // A definition that locked on the default stands: a different answer now would change nothing but the record of it.
    const locked = await this.tasks.lockedOn(handle);
    if (locked) throw new Refused(refusal('locked', '/params/ask', `${handle} took its default and the definition of ${locked} locked on it; a change to that definition goes through a dispute, not an undo.`, handle));
    await this.trusted(params, context, `undo the default “${row.question.slice(0, 120)}” took`, handle);
    await this.asks.undo(this.connection(context.role === 'app' ? 'app' : 'cli'), handle).catch((error: unknown) => { throw asRefused(error); });
    const [open] = (await this.record.raw(`SELECT deadline FROM asks WHERE id = ?`, [handle.slice(4)])) as { deadline: number }[];
    return { ask: handle, deadline: open?.deadline ?? null };
  }
  /** decisions/:id/overrule: a saved decision taken out of force, on the trusted path alone. */
  private async overrule(params: Obj, context: CallContext): Promise<Obj> {
    const id = typeof params.decision === 'string' && /^decision:[0-9A-Za-z]+$/.test(params.decision) ? params.decision : undefined;
    if (!id) throw new Refused(refusal('pattern', '/params/decision', 'Name the decision as decision:<id>.', params.decision));
    const [row] = (await this.record.raw(`SELECT key, answer, state FROM decisions WHERE id = ?`, [id.slice(9)])) as { key: string; answer: string; state: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/decision', `No decision ${id} in the record.`, id));
    if (row.state === 'revoked') return { overruled: id };
    await this.trusted(params, context, `overrule the saved decision ${row.answer}`, id);
    // First: a retry finds a revoked decision done, so a guard left behind would never go.
    dropKept(this.root.dir, row.key);
    await this.appendCore('decision.overruled', { decision: id }, { subject: id });
    await this.syncStanding().catch(() => undefined);
    await syncRejected((q) => this.record.raw(q), this.root.dir).catch(() => undefined);
    return { overruled: id };
  }
  /** Pairs a device's key, once the OS confirms you, so the control token alone can't pair one. */
  private async pair(params: Obj): Promise<Obj> {
    if (typeof params.name !== 'string' || !params.name) throw new Refused(refusal('required', '/params/name', 'Name the device you pair.', params.name));
    const key = checkKey(params.public_key);
    const why = await confirmYou(`pair “${params.name.slice(0, 80)}” with DeepBuild, so what it signs answers for you`, this.options.confirm);
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was paired: the OS didn't confirm you (${why}).`, params.name, true));
    const device = `device:${ulid(this.now())}`;
    this.devices.pair(device, params.name, key, this.now());
    return { device };
  }

  /**
   * `deep install` (#351): installs the package in a folder once the OS confirms you, the prompt naming it, after the
   * CLI showed its source and permissions; with `trust_key`, the prompt names the publisher key its envelope names
   * too, and your confirmation trusts that key for the package first. A deep command inside an agent's process tree
   * acts as that session, and no agent installs a package. The installer's refusal comes back as the result.
   */
  private async install(params: Obj, context: CallContext): Promise<Obj> {
    const from = params.from;
    if (typeof from !== 'string' || !isAbsolute(from)) throw new Refused(refusal('type', '/params/from', 'Give the package folder as an absolute path.', from));
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'An install counts from the CLI, once the OS confirms you.', 'extension.install'));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing was installed: this deep command runs inside agent session ${agent}'s process tree, and no agent installs a package. Install it from your own terminal.`, 'extension.install'));
    // Only for the prompt's words: the installer reads the manifest again, as data, and refuses what it must.
    const m = await readFile(join(from, 'deepbuild.json'), 'utf8').then((text) => JSON.parse(text) as { id?: unknown; version?: unknown; publisher_key?: unknown })
      .catch(() => ({ id: undefined, version: undefined, publisher_key: undefined }));
    const key = params.trust_key === true ? m.publisher_key : undefined;
    if (params.trust_key === true && (typeof key !== 'string' || typeof m.id !== 'string')) throw new Refused(refusal('required', '/params/trust_key', 'Only a signed package names a publisher key to trust.', from));
    const why = await confirmYou(`${key ? `trust the publisher key ${String(key)} for ${String(m.id)}, and ` : ''}install ${String(m.id)}@${String(m.version)} from ${from}`, this.options.confirm);
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was installed: the OS didn't confirm you (${why}).`, from, true));
    if (!this.extensions) throw new Refused(refusal('unavailable', '', 'The hub has no extension host yet; try again once it is ready.', from, true));
    try {
      if (key) await this.extensions.trustKey(this.connection('cli'), String(m.id), String(key));
      const pkg = await this.extensions.install({ from, builtBy: null });
      const installed = { status: 'installed', id: pkg.id, version: pkg.version, digest: pkg.digest };
      // Nothing loads before its conformance passes (#348): it runs now, and the package loads at once; its result,
      // kept for these bytes, lets each later start load it. One that fails stays installed, and the reason is shown.
      try {
        const checked = await this.extensions.check(pkg);
        const load = checked.passed ? await this.extensions.load(pkg) : { status: 'refused' as const, reason: `it failed conformance: ${checked.reasons.join('; ')}` };
        return load.status === 'refused' ? { ...installed, not_loaded: load.reason } : installed;
      } catch (error) {
        return { ...installed, not_loaded: error instanceof Error ? error.message : String(error) };
      }
    } catch (error) {
      return { status: 'refused', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * `deep off`, `deep on`, `deep hub stop`, `deep hub use` and `deep setup --undo` (#19): each takes effect only once
   * the OS confirms you, with a prompt naming the command. Run inside an agent's process tree it acts as that agent's
   * session, and no agent switches DeepBuild off; the peer check alone never makes one count.
   */
  private async confirmCommand(params: Obj, context: CallContext): Promise<Obj> {
    const command = params.command;
    if (typeof command !== 'string' || !AUTHORITY.has(command)) throw new Refused(refusal('enum', '/params/command', `Name one of ${[...AUTHORITY].join(', ')}.`, command));
    const what = typeof params.detail === 'string' ? `${command} ${params.detail.slice(0, 200)}` : command;
    if (context.role !== 'cli') throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: from the app it counts only when a device you paired signs it; from your terminal, once the OS confirms you.`, command));
    // A deep command names its process so the peer check can read whose it is; a call that names none counts for
    // nothing, and asks the OS nothing.
    if (!context.peer) throw new Refused(refusal('unconfirmed', '/method', `${what} changed nothing: the call names no process for the peer check; run the deep command itself.`, command));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/params/command', `${what} changed nothing: it runs inside agent session ${agent}'s process tree, so it acts as that session, and no agent changes what watches it. Run it from your own terminal.`, command));
    if (this.options.plant === 'acts-on-peer-check') return { confirmed: command };
    const why = await confirmYou(what, this.options.confirm);
    if (why) throw new Refused(refusal('unconfirmed', '/params/command', `${what} changed nothing: the OS didn't confirm you (${why}). It takes effect only once the OS confirms you; run it again and confirm.`, command, true));
    return { confirmed: command };
  }

  /**
   * `deep guard add` (#304): installs the guard entries you wrote once the OS confirms you, the prompt naming them.
   * Each is checked first through deep-hook's check mode on its planted call and twin; a refusal comes back as the
   * result. No agent writes rules.json, so a deep command inside an agent's process tree adds nothing.
   */
  private async addGuard(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'cli') throw new Refused(refusal('role', '/method', 'A guard is added from the CLI, once the OS confirms you.', 'guard.add'));
    const agent = await this.agentAbove(context.peer);
    if (agent) throw new Refused(refusal('role', '/method', `Nothing was added: this deep command runs inside agent session ${agent}'s process tree, and no agent changes your rules. Add it from your own terminal.`, 'guard.add'));
    const names = isObj(params.guards) && isObj(params.guards.entries) ? Object.keys(params.guards.entries) : [];
    const why = await confirmYou(`add the guard ${names.length === 1 ? 'entry' : 'entries'} ${names.join(', ')} to your rules`, this.options.confirm);
    if (why) throw new Refused(refusal('unconfirmed', '', `Nothing was added: the OS didn't confirm you (${why}).`, names.join(', '), true));
    return addGuards(this.root.dir, params.guards, { deepHook: deepHook(), classes: toolClasses(), plant: this.options.plant });
  }

  /**
   * The peer check: the agent session whose process is above the caller's, by PID and start time as that session's
   * hooks established them. It decides whose session a deep command acts as, never whether an answer counts.
   */
  private async agentAbove(peer: CallContext['peer']): Promise<string | undefined> {
    if (!peer || (await this.startOf(peer.pid, true)) !== peer.start) return undefined;
    const up = await parents();
    const seen = new Set<number>();
    for (let pid = up.get(peer.pid); pid !== undefined && pid > 1 && !seen.has(pid); pid = up.get(pid)) {
      seen.add(pid);
      // A PID another process now holds, with a start time no session recorded (#806's test seam): no agent's tree.
      if (reusedPids().includes(pid)) continue;
      // After a `/clear` the process's session is its newest one.
      const session = [...this.sessions.values()].filter((s) => s.pid === pid).at(-1);
      // A start that can't be read (ps failing under load) proves nothing: the session's process still running counts.
      const start = session ? await this.startOf(pid, true) : undefined;
      if (session && (start === undefined ? running(pid) : start === session.start)) return session.id;
    }
    return undefined;
  }

  /** Streams every event after `after` to the subscriber, then each one appended from then on. */
  async subscribe(sub: string, after: number): Promise<void> {
    await this.ready;
    this.subscribers.set(sub, after);
    this.stream();
  }
  unsubscribe(sub: string): void {
    this.subscribers.delete(sub);
  }
  private stream(): void {
    if (!this.subscribers.size) return;
    // An append during a flush flushes again after it, so its frame never waits for the next append.
    if (this.streaming) {
      this.restream = true;
      return;
    }
    this.streaming = true;
    setImmediate(() => void this.flushStream().finally(() => {
      this.streaming = false;
      if (this.restream) {
        this.restream = false;
        this.stream();
      }
    }));
  }
  private async flushStream(): Promise<void> {
    for (const [sub, after] of this.subscribers) {
      let last = after;
      for (;;) {
        const events = await this.page(last, 1000);
        if (!this.subscribers.has(sub)) break;
        for (const event of events) this.emit(sub, event.json);
        if (events.length) last = events[events.length - 1]!.log_pos;
        if (events.length < 1000) break;
      }
      if (this.subscribers.has(sub)) this.subscribers.set(sub, last);
    }
  }

  // ---- deep mcp.

  /**
   * One deep_* call: its arguments held to its tool's schema, bound to the session it acts for, then served. Binding
   * holds the queue, so it sees every hook that arrived before the call; serving holds up no session's hooks. Its
   * refusal reaches the agent scrubbed of every value the hub holds, scrubbed whole before it is cut.
   */
  private async mcpCall(params: Obj, context: CallContext): Promise<unknown> {
    const tool = String(params.tool);
    try {
      const args = checkArguments(tool, params.arguments);
      const sent = isObj(params.arguments) ? params.arguments : {};
      // What deep-hook spooled ran before this call, as a hook's does: a replay running goes first, so a claim comes
      // after the call it follows, not before the work it claims.
      await (this.replaying ?? Promise.resolve());
      // A call bound to no session still reads what belongs to no session; every other tool needs its session.
      // A deep_show bound to no session is refused by the canvas side with no_session, as its reply (#806).
      const session = await this.queue(async () => this.bind(tool, sent, context, tool !== 'deep_status' && tool !== 'deep_search' && tool !== 'deep_show'));
      switch (tool) {
        case 'deep_show': return await this.show(session ? { session } : { session: null }, showCall(args));
        case 'deep_status': return await this.status(session);
        case 'deep_search': return await this.find(String(args.query), session, context);
        case 'deep_ask': return await this.askFor(session!, args);
        case 'deep_wait': return await this.waitFor(session!, String(args.ask));
        case 'deep_open_item': return await this.openItem(session!, String(args.text));
        case 'deep_claim': return await this.claim(session!, args);
        case 'deep_evidence': return await this.attach(session!, args);
        case 'deep_propose': return await this.propose(session!, args);
        case 'deep_env': return await this.deepEnv(session!, String(args.action));
        default: return await this.runCheck(session!, args);
      }
    } catch (error) {
      throw this.forAgent(error, tool);
    }
  }
  private forAgent(error: unknown, tool: string): Refused {
    const refused = error instanceof Refused ? error : error instanceof AskRefused ? (asRefused(error) as Refused)
      : new Refused(refusal('unavailable', '', `${tool} failed in the hub: ${error instanceof Error ? error.message : String(error)}; nothing was recorded.`, tool, true));
    const plant = this.options.plant;
    const scrub = (text: string) => (plant === 'errors-unscrubbed' ? text : scrubText(text, { held: this.options.held }));
    const out: Partial<Refusal> = { ...refused.refusal, remediation: scrub(refused.refusal.remediation), actual: scrub(refused.whole ?? refused.refusal.actual).slice(0, 8192) };
    if (plant === 'errors-without-actual') delete out.actual;
    return new Refused(out as Refusal);
  }
  /**
   * The session a deep_* call acts for: its deep mcp's own, or the one unspent PreToolUse stamped for this very call,
   * by its tool and the digest of its arguments as sent. A call more than one unspent stamp matches binds to none.
   * Unbound, a call that needs its session is refused; one that only reads goes on bound to none.
   */
  private bind(tool: string, args: Obj, context: CallContext, required: boolean): string | undefined {
    const live = (id: string) => { const s = this.sessions.get(id); return s && !s.ended ? s : undefined; };
    if (context.session) {
      if (live(context.session)) return context.session;
      if (!required) return undefined;
      throw refuse('unbound', '/params/tool', `Session ${context.session} has ended; this deep mcp acts for no session now.`, tool);
    }
    const parent = context.parent;
    const digest = sha256Hex(canonicalize(args as JsonValue));
    const matches = parent ? this.stamps.filter((s) => {
      const session = live(s.session);
      return s.tool === tool && s.digest === digest && session !== undefined && session.pid === parent.pid && session.start === parent.start;
    }) : [];
    const bound = this.options.plant === 'binds-first-stamp' || matches.length === 1 ? matches[0] : undefined;
    if (!bound) {
      if (!required) return undefined;
      throw refuse('unbound', '/params/arguments', `This ${tool} call binds to no session: ${matches.length ? 'more than one' : 'no'} PreToolUse stamped for it is unspent.`, tool);
    }
    this.stamps.splice(this.stamps.indexOf(bound), 1);
    return bound.session;
  }
  // ---- The canvas side (#806): deep_show, `deep show`, render-back, and what the app draws.

  /** The canvas core, started at the first canvas call; the world file a test gives it; the app's presentations. */
  private canvasCore?: Canvas;
  private readonly worldFile = new WorldFile(process.env.DEEP_HUB_TEST_SHOW);
  /** Each presented revision for the app, in order; an app's `canvas.drawn` takes those after the last it took. */
  private readonly presented: Obj[] = [];
  private readonly drawnUpTo = new Map<string, number>();
  /** When an app last took what was presented: an app that took it within the last 250 ms is open (it asks every 100 ms), and draws it. */
  private appSeen = 0;
  private readonly appOpen = (): boolean => Date.now() - this.appSeen < 250;

  /** The world the canvas core reads: the hub's live sessions, the record's asks and readings, and the world file. */
  private async canvasWorld(): Promise<CanvasWorld> {
    const file = this.worldFile.read();
    const sessions = [...this.sessions.values()].filter((s) => !s.ended).map((s) => ({ id: s.id, thread: s.thread, name: nameOf(file, s.id, s.agent) }));
    const record: Obj = {};
    const asks = (await this.record.raw('SELECT id, session_id, status FROM asks')) as { id: string; session_id: string | null; status: string }[];
    for (const a of asks) record[`ask:${a.id}`] = { session: a.session_id, state: a.status === 'open' || a.status === 'later' ? 'needs_you' : 'done' };
    const readings = (await this.record.raw("SELECT e.session_id AS session, e.data AS data FROM events e WHERE e.kind = 'reading.recorded' ORDER BY e.log_pos")) as { session: string | null; data: string }[];
    for (const r of readings) {
      const d = JSON.parse(r.data) as Obj;
      if (typeof d.reading === 'string' && typeof d.value === 'number') record[d.reading] = { session: r.session, value: d.value, as_of: Number(d.as_of ?? 0) };
    }
    return { sessions, record, file };
  }
  private canvas(): Canvas {
    return (this.canvasCore ??= new Canvas(this.root.evidence));
  }
  private async canvasCall(call: Obj): Promise<Obj> {
    return (await this.canvas().call(await this.canvasWorld(), call)).reply;
  }

  /**
   * deep_show for a session, or for none (the call binds to no session), or `deep show` from the CLI acting as the
   * session the peer check found, or as you: the writer is the binding's, never the payload's.
   */
  private async show(as: { session: string | null } | { you: true }, call: Obj): Promise<Obj> {
    // The planted hub stamps the writer the payload claims (#806's wrong program): a session whose thread it names.
    if (this.options.plant === 'deep-show-writer-from-payload' && 'session' in as && isObj(call.document) && typeof call.document.writer === 'string') {
      const claimed = [...this.sessions.values()].find((s) => `agent:${s.thread}` === (call.document as Obj).writer);
      if (claimed) {
        const { writer: _writer, ...document } = call.document;
        as = { session: claimed.id };
        call = { ...call, document };
      }
    }
    if (call.call === 'render_back') {
      // Render-back of a revision the document has had, at a time: the session's own, never one bound to none.
      if (!('session' in as) || !as.session) return { outcome: 'refused', code: 'no_session', issues: [], snapshots: [] };
      let rev = call.rev;
      if (rev === null) rev = ((await this.canvasCall({ call: 'revisions', doc: call.doc })).revisions as { rev: number; state: string }[] | undefined)?.find((r) => r.state === 'current')?.rev ?? 0;
      return this.canvasCall({ ...call, rev, session: as.session });
    }
    const via = 'you' in as ? { peer: { pid: 0, start: 0 } } : { session: as.session };
    const name = 'you' in as ? 'deep show' : 'deep_show';
    const { reply, presented } = await this.canvas().call(await this.canvasWorld(), { call: name, ...via, ...call });
    if (presented) await this.recordRevision(as, presented, reply);
    // The planted hub waits for an app to draw the revision instead of rendering back headless.
    if (this.options.plant === 'deep-show-waits-for-app' && reply.outcome === 'presented' && !(await waitForApp(this.appOpen))) {
      return { ...reply, outcome: 'not_presented', reason: 'timeout', snapshots: [] };
    }
    return reply;
  }
  /** A revision the canvas core made current: recorded by its hash, its canonical document in evidence, and presented to the app. */
  private async recordRevision(as: { session: string | null } | { you: true }, p: Obj, reply: Obj): Promise<void> {
    const session = 'session' in as ? as.session : null;
    const writer = p.writer as { kind: string; id: string };
    const hash = String(p.hash);
    // The canvas core wrote the canonical document under its hash; the store's index takes it, origin from the binding.
    await this.stored(await this.store.connect(session ? { role: 'agent', session } : { role: 'deepbuild', via: 'job' }).put({
      bytes: new Uint8Array(readFileSync(join(this.root.evidence, hash.slice(0, 2), hash.slice(2)))), kind: 'canvas.revision', source: `doc:${String(p.doc)}`,
      redaction: 'complete', license: { name: 'session', allows: [] },
    }), "the revision's canonical document");
    const ts = this.now();
    const agent = session ? this.sessions.get(session)?.agent : undefined;
    const connection = session ? this.agentConnection(session) : this.connection('cli');
    const count = (k: string) => ((reply[k] as unknown[] | undefined) ?? []).length;
    await this.append({ ...connection, ...(agent ? { agent } : {}) }, {
      v: 2, id: ulid(ts), kind: 'doc.patched', ts, subject: `doc:${String(p.doc)}`, evidence: [hash],
      data: {
        doc: `doc:${String(p.doc)}`, rev: Number(p.rev), patch: null, writer: writer.kind,
        achieved: { created: {}, updated: count('changed'), deleted: {}, unchanged: count('changed') + count('created') + count('removed') === 0 },
        hash, layer: String(p.layer), thread: writer.kind === 'agent' ? writer.id : null,
      } as JsonValue,
    });
    this.presented.push({ doc: p.doc, rev: p.rev, rect: p.rect, layers: p.layers });
  }
  /** `deep show` from the CLI: the peer check makes it the agent's whose process tree runs it, never by PID alone; else yours. */
  private async showCli(params: Obj, context: CallContext): Promise<Obj> {
    const session = await this.agentAbove(context.peer);
    return this.show(session ? { session } : { you: true }, showCall(params));
  }
  /** The user's side the app plays (#384, #393): its input, asks and window, through the canvas core. */
  private async canvasUser(params: Obj, context: CallContext): Promise<Obj> {
    if (context.role !== 'app') throw refuse('role', '/method', 'Only the app plays your input on the canvas.', 'canvas.user');
    const call = isObj(params.call) ? params.call : {};
    return this.canvasCall(call);
  }
  /** What the app has yet to draw: every revision presented after the last it took. */
  private drawnBy(context: CallContext): Obj {
    this.appSeen = Date.now();
    const key = context.role;
    const from = this.drawnUpTo.get(key) ?? 0;
    this.drawnUpTo.set(key, this.presented.length);
    return { presented: this.presented.slice(from) };
  }

  /** The connection a session's deep mcp writes through: writer mcp:<session>, from the binding, never the call. */
  private agentConnection(session: string): Connection {
    const agent = this.sessions.get(session)?.agent;
    return this.connection(`mcp:${session}`, { session, ...(agent ? { agent } : {}) });
  }

  /** deep_status: the gates, and for a bound session its newest claims, each with its runs, its verdict and its contradictions. */
  private async status(session: string | undefined): Promise<Obj> {
    const gates = { watch_only: this.blocked !== undefined, reason: this.blocked ?? null };
    if (!session) return { session: null, gates, claims: [] };
    const made = (await this.record.raw(`SELECT id, data FROM events WHERE session_id = ? AND kind = 'claim.made' ORDER BY log_pos DESC LIMIT 10`, [session])) as { id: string; data: string }[];
    const claims: Obj[] = [];
    for (const row of made) {
      const claim = JSON.parse(row.data) as { task_ref: string; commit: string; predictions?: Prediction[] };
      const runs = (await this.record.raw(`SELECT kind, ts, data FROM events WHERE kind IN ('run.started', 'run.finished') AND subject IN
        (SELECT subject FROM events WHERE kind = 'run.started' AND json_extract(data, '$.claim') = 'claim:${row.id}') ORDER BY log_pos`)) as { kind: string; ts: number; data: string }[];
      const byRun = new Map<string, { run: string; check: string; started?: number; ended?: number; outcome?: RunOutcome }>();
      for (const r of runs) {
        const d = JSON.parse(r.data) as { run: string; check?: string; outcome?: RunOutcome };
        const one = byRun.get(d.run) ?? { run: d.run, check: String(d.check) };
        if (r.kind === 'run.started') Object.assign(one, { check: String(d.check), started: r.ts });
        else Object.assign(one, { ended: r.ts, outcome: d.outcome });
        byRun.set(d.run, one);
      }
      const finished = [...byRun.values()].flatMap((r) => (r.outcome !== undefined && r.ended !== undefined ? [{ ...r, outcome: r.outcome, ended: r.ended }] : []));
      const checks = [...new Set(finished.map((r) => r.check))].map((check) => ({ check, runs: finished.filter((r) => r.check === check) }));
      const [verdict] = (await this.record.raw(`SELECT handle, outcome, smallest, points_to FROM verdicts WHERE claim_id = ? AND stale = 0 ORDER BY created DESC LIMIT 1`, [row.id])) as Obj[];
      claims.push({
        claim: `claim:${row.id}`, task_ref: claim.task_ref, commit: claim.commit,
        runs: [...byRun.values()].map((r) => ({ run: r.run, check: r.check, outcome: r.outcome ?? 'running' })),
        verdict: verdict ?? null,
        contradictions: predictionContradictions(claim.predictions ?? [], checks),
      });
    }
    return { session, gates, claims };
  }

  /** deep_search: the wiki, decisions and the project's spec; bound to a session, its own open items and verdicts too. */
  private async find(query: string, session: string | undefined, context: CallContext): Promise<Obj> {
    const worktree = session ? this.sessions.get(session)?.cwd : this.worktreeAt(context.cwd);
    const everyone = !session && this.options.plant === 'unbound-reads-all';
    // A claim reaches a session at its own scope, its repo's or everywhere's; a call bound to no session reads every repo's.
    const [project] = session ? (await this.record.raw(`SELECT project_id FROM sessions WHERE id = ?`, [session])) as { project_id: string | null }[] : [];
    const scopes = new Set(session ? [`session:${letters(session)}`, 'all', ...(project?.project_id ? [`repo:${letters(project.project_id)}`] : [])] : []);
    const covers = (scope: string): boolean => everyone || (session ? scopes.has(scope) : scope === 'all' || scope.startsWith('repo:'));
    return search({
      query, index: await this.wikiIndex(), raw: (q, params) => this.record.raw(q, params), worktree, session: everyone ? { everyone: true } : session, covers,
      trustsIndex: this.options.plant === 'trusts-index',
    });
  }
  /** The wiki's index: a loaded package's in place of the shipped one, rebuilt from the pages when it first serves (#355). */
  private async wikiIndex(): Promise<IndexFill | undefined> {
    const swapped = this.extensions?.index()?.fill;
    if (!swapped) return this.index;
    if (this.swapped !== swapped) {
      await swapped.rebuild(pageClaims(this.root.wiki));
      this.swapped = swapped;
    }
    return swapped;
  }
  /** The worktree of a session the hub knows that holds `folder`: an unbound call reads that project's spec, and no other file. */
  private worktreeAt(folder: string | undefined): string | undefined {
    if (!folder || !isAbsolute(folder)) return undefined;
    let real: string;
    try { real = realpathSync(folder); } catch { return undefined; }
    return [...this.sessions.values()].map((s) => s.cwd).find((cwd) => cwd === real || isUnder(real, cwd));
  }
  /** The checks a worktree's spec names, by name, with the command each runs and its deadline as the spec writes it, where it gives one. */
  private checksOf(worktree: string): Map<string, { run: string; deadline?: unknown }> {
    let spec: unknown;
    try { spec = parseYaml(readFileSync(join(worktree, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return new Map(); }
    const checks = isObj(spec) && isObj(spec.checks) ? spec.checks : {};
    return new Map(Object.entries(checks).flatMap(([name, c]) => {
      if (!isObj(c) || typeof c.run !== 'string') return [];
      return [[name, { run: c.run, ...(c.deadline !== undefined ? { deadline: c.deadline } : {}) }] as const];
    }));
  }
  private unknownCheck(worktree: string, check: unknown): Refused {
    const names = [...this.checksOf(worktree).keys()];
    return refuse('enum', '/params/arguments/check', `Name a check this repo's .deepbuild/done.yaml names: ${names.join(', ') || 'it names none'}.`, check);
  }

  /** deep_ask: raises the ask under the session, then waits for its answer as deep_wait does. */
  private async askFor(session: string, args: Obj): Promise<Obj> {
    const s = this.sessions.get(session)!;
    const kind = String(args.kind);
    const question = String(args.question);
    const need = (field: string, why: string) => { if (args[field] === null) throw refuse('required', `/params/arguments/${field}`, why, null); };
    let raised: Obj;
    if (kind === 'unblock') {
      need('check', 'Name the check in the repo\'s spec that will prove the task done; a task without one is refused, since nobody could tell it was done.');
      if (!this.checksOf(s.cwd).has(String(args.check))) throw this.unknownCheck(s.cwd, args.check);
      need('steps', 'List the task\'s steps, in order.');
      need('where', 'Say where the person does the task.');
      need('why', 'Say what the task unblocks.');
      raised = {
        kind, question, options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done',
        steps: args.steps, where: args.where, why: args.why, unblocks: [`session:${letters(session)}`], proves: args.check,
      };
    } else {
      need('options', 'Give the question\'s options.');
      const options = (args.options as { id: string; label: string }[]).map((o) => ({ ...o, decision: 'none' }));
      raised = { kind, question, options, recommended: args.recommended };
    }
    const pinned = await this.pinOf(s.cwd, question);
    // A question that names what it is about is keyed by the asks core from that alone (#23); one that names
    // nothing keeps a key of its own wording in its session, which no saved decision answers elsewhere.
    const about = isObj(args.subject) ? args.subject : {};
    // The repeat-reaches-you plant (#27) drops the subject, so no saved decision answers a repeat.
    const subject = this.options.plant === 'repeat-reaches-you' ? undefined
      : kind === 'choice' && typeof about.point === 'string' ? { point: about.point }
      : kind === 'taste' && typeof about.screen === 'string' && typeof about.element === 'string' ? { screen: about.screen, element: about.element } : undefined;
    const ask = { ...raised, fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind, question, session } as JsonValue)), pinned_to: pinned, ...(subject ? { subject } : {}) };
    const handle = await this.asks.raise(this.agentConnection(session), `deep_ask.${kind}`, ask);
    // The event loop knows this session's stop may carry the answer back before the agent hears of its ask.
    await this.askingNow().catch(() => undefined);
    await this.waiterNote(session, handle).catch(() => undefined);
    return this.waitFor(session, handle);
  }
  /**
   * An ask whose deadline runs past the waiter's timeout says why its answer may wait: Claude Code stops the waiter
   * at its timeout, and an answer after it arrives at the session's next prompt.
   */
  private async waiterNote(session: string, handle: string): Promise<void> {
    const waiter = relations(this.root.dir).find((r) => r.name === 'waiter');
    const [row] = (await this.record.raw(`SELECT deadline, created FROM asks WHERE id = ?`, [handle.slice(4)])) as { deadline: number | null; created: number | null }[];
    if (!waiter || !row?.deadline || row.deadline - (row.created ?? this.now()) <= waiter.timeoutS * 1000) return;
    await this.appendReading(session, this.sessions.get(session)?.agent ?? 'claude-code', `${handle} can be answered up to ${words(row.deadline - (row.created ?? this.now()))} on, past the waiter's ${waiter.timeoutS} s timeout: an answer you give after the waiter stops arrives at this session's next prompt.`);
  }
  /** What an ask shows: the worktree's commit, or where there's none, the question's own digest. */
  private pinOf(worktree: string, question: string): Promise<Obj> {
    return new Promise((done) => execFile('git', ['-C', worktree, 'rev-parse', 'HEAD'], { timeout: 2000 }, (error, out) => {
      const commit = String(out ?? '').trim();
      done(!error && /^[0-9a-f]{40}$/.test(commit) ? { kind: 'commit', ref: commit } : { kind: 'evidence', ref: sha256Hex(new TextEncoder().encode(question)) });
    }));
  }
  /**
   * deep_wait: the ask's answer once one arrives, or before the agent's tool timeout, that it's still waiting, with
   * its deadline and default. Only the session that raised an ask waits on it.
   */
  /** How long deep_ask and deep_wait wait: none once Claude Code's MCP tool timeout leaves no room (the deep_ask relation). */
  private askWait(session: string): number {
    if (this.sessions.get(session)?.agent === 'codex') {
      const relation = codexRelations(this.root.dir).find((r) => r.name === 'deep_ask');
      if (relation) return relation.waitMs;
    }
    return relations(this.root.dir).find((r) => r.name === 'deep_ask')?.holds === false ? 0 : ASK_WAIT_MS;
  }
  private async waitFor(session: string, handle: string): Promise<Obj> {
    const until = Date.now() + this.askWait(session);
    const places = this.routes.get(session)?.places === true;
    if (places) {
      const [own] = (await this.record.raw(`SELECT session_id FROM asks WHERE id = ?`, [handle.slice(4)])) as { session_id: string | null }[];
      if (own?.session_id === session) this.askWaits.set(handle.slice(4), session);
    }
    // The deep-wait-polls plant reads the ask every 100 ms, as the hub did before #823.
    const polls = this.options.plant === 'deep-wait-polls';
    for (;;) {
      // The ask is read again only once an event about it lands, its call is stopped, the hub stops or the wait runs out (#823).
      const wait = polls ? { woken: new Promise((done) => setTimeout(done, 100)), cancel: () => undefined } : this.wakeable(this.settling, handle, until - Date.now());
      try {
        const [row] = (await this.record.raw(`SELECT session_id, status, answer, deadline, default_option FROM asks WHERE id = ?`, [handle.slice(4)])) as { session_id: string | null; status: string; answer: string | null; deadline: number; default_option: string | null }[];
        if (!row || row.session_id !== session) throw refuse('not_found', '/params/arguments/ask', 'Wait on an ask this session raised, by the handle deep_ask returned.', handle);
        // Aborted: the answer goes as a message of its own.
        if (places && !this.askWaits.has(handle.slice(4))) return { ask: handle, status: 'waiting', answer: null, deadline: row.deadline, default: row.default_option === null ? null : JSON.parse(row.default_option) };
        // Decided for you (#27): the answer is the one the decision that closed it saved.
        if (row.status === 'decided' && row.answer === null) {
          if (places) this.askWaits.delete(handle.slice(4));
          const [d] = (await this.record.raw(`SELECT d.answer AS answer FROM events e JOIN decisions d ON 'decision:' || d.id = json_extract(e.data, '$.decision') WHERE e.kind = 'decision.applied' AND json_extract(e.data, '$.ask') = ? ORDER BY e.log_pos DESC LIMIT 1`, [handle])) as { answer: string | null }[];
          return { ask: handle, status: row.status, answer: d?.answer ? JSON.parse(d.answer) : null };
        }
        if (row.status !== 'open' && row.status !== 'later') {
          // The running call carries it into the turn; the package says when it has, and till then nothing else hands it over.
          if (places && row.status !== 'answered') this.askWaits.delete(handle.slice(4));
          return { ask: handle, status: row.status, answer: row.answer === null ? null : JSON.parse(row.answer) };
        }
        if (this.stopping && this.options.plant !== 'stop-answers-waiting') throw refuse('unavailable', '', 'The hub is stopping, and nothing was answered; wait on the ask again once it is back.', handle, true);
        if (this.stopping || Date.now() >= until) {
          if (places) this.askWaits.delete(handle.slice(4));
          return { ask: handle, status: 'waiting', ...(this.sessions.get(session)?.agent === 'codex' ? { note: 'Still waiting for your answer; wait on it again with deep_wait.' } : {}), answer: null, deadline: row.deadline, default: row.default_option === null ? null : JSON.parse(row.default_option) };
        }
        await wait.woken;
      } finally {
        wait.cancel();
      }
    }
  }

  /** deep_open_item: an open item on the session's newest claim's task, or else on the message it works on. */
  private async openItem(session: string, text: string): Promise<Obj> {
    const [claim] = (await this.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'claim.made' ORDER BY log_pos DESC LIMIT 1`, [session])) as { data: string }[];
    const message = this.sessions.get(session)?.turn?.uuid.replace(/[^A-Za-z0-9._-]/g, '') || 'start';
    const task_ref = claim ? String((JSON.parse(claim.data) as Obj).task_ref) : `session:${letters(session)}#${message}`;
    const ts = this.now();
    const id = ulid(ts);
    try {
      await this.append(this.agentConnection(session), { v: 1, id, kind: 'open_item.opened', ts, data: { task_ref, text: scrubText(text, { held: this.options.held }).slice(0, 8192) } });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_open_item');
    }
    return { task_ref, event: id };
  }

  /**
   * deep_propose: a change the agent proposes, recorded as learn.proposed and applied by no one, and an ask in your
   * inbox naming it; the proposal cites that ask, whose question holds the change's words (#355).
   */
  private async propose(session: string, args: Obj): Promise<Obj> {
    const target = scrubText(String(args.target), { held: this.options.held }).slice(0, 1000);
    const change = scrubText(String(args.change), { held: this.options.held }).slice(0, 4000);
    // A direction you rejected isn't asked about again: the agent hears your decision, and you hear nothing (#111).
    const revived = await revives((q) => this.record.raw(q), change, repoOf(this.sessions.get(session)!.cwd), session);
    if (revived) throw refuse('rejected', '/params/arguments/change', `You can't propose \`${revived.direction}\`: the person rejected it (${revived.decision}). Take another direction; only they can overrule that decision.`, revived.decision);
    const question = `Apply this change an agent proposed to ${target}? ${change}`;
    const pinned = await this.pinOf(this.sessions.get(session)!.cwd, question);
    const options = [{ id: 'apply', label: 'Apply it', decision: 'none' }, { id: 'keep', label: 'Keep it as it is', decision: 'none' }];
    const raised = { kind: 'choice', question, options, recommended: 'keep', fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'propose', target, change, session } as JsonValue)), pinned_to: pinned };
    const ask = await this.asks.raise(this.agentConnection(session), 'deep_propose.choice', raised);
    const ts = this.now();
    const id = ulid(ts);
    const evidence = [...((args.evidence as { at: string; quote: string }[] | null) ?? []), { at: ask, quote: change }];
    try {
      await this.append(this.agentConnection(session), {
        v: 1, id, kind: 'learn.proposed', ts,
        data: { layer: 'learned', target, diff: `+ ${change}`, evidence, scope: `session:${letters(session)}`, replay: null, applied_by: null, supersedes: null },
      });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_propose');
    }
    return { proposal: `doc:${id}`, ask };
  }

  private async claim(session: string, args: Obj): Promise<Obj> {
    // While appends fail, no claim is acknowledged.
    if (this.blocked) throw refuse('unavailable', '/params/tool', `${this.blocked}; the claim was not recorded. Claim again once appends work.`, 'deep_claim', true);
    const ts = this.now();
    const id = ulid(ts);
    // What the agent expects each check to show, stamped now, before any run it could have seen.
    const predictions = ((args.predictions ?? []) as { check: string; expects: string }[]).map((p) => ({ ...p, at: ts }));
    const data = { task_ref: args.task_ref, attempt: args.attempt, commit: args.commit, scope: args.scope, predictions };
    try {
      await this.append(this.agentConnection(session), { v: 2, id, kind: 'claim.made', ts, data: data as JsonValue });
    } catch (error) {
      throw this.refusedAppend(error, 'deep_claim');
    }
    this.claimed(session, `claim:${id}`);
    // An answer to an ended session of another thread waits on its task: the next session that works the task reads it.
    const task = sql(String(args.task_ref));
    const answers = await this.queue(async () => this.deliver(await this.waitingFor(session, `a.session_id IN (SELECT session_id FROM events WHERE kind = 'claim.made' AND json_extract(data, '$.task_ref') = '${task}')
      AND a.session_id IN (SELECT session_id FROM events WHERE kind = 'session.end')`), 'next_prompt'));
    return { session, claim: `claim:${id}`, event: id, ...(answers ? { answers } : {}) };
  }

  /** deep_run: a check the session's spec names, run for one of its claims (its newest by default) at that claim's commit, answered with its outcome. */
  private async runCheck(session: string, args: Obj): Promise<Obj> {
    const cwd = this.sessions.get(session)!.cwd;
    const check = this.checksOf(cwd).get(String(args.check));
    if (check === undefined) throw this.unknownCheck(cwd, args.check);
    // A deadline the hub can't read is refused before the run starts, never taken as none (#822).
    const deadline = check.deadline === undefined ? undefined : duration(check.deadline as JsonValue);
    if (check.deadline !== undefined && !deadline) {
      throw refuse('pattern', `/checks/${String(args.check)}/deadline`, `Give the check's deadline in .deepbuild/done.yaml as a whole number above 0 of m, h or d, such as 30m, not ${String(check.deadline)}.`, String(check.deadline));
    }
    const which = args.claim === null ? '' : `AND id = '${sql(String(args.claim).slice(6))}'`;
    const [claim] = (await this.record.raw(`SELECT id, data FROM events WHERE session_id = ? AND kind = 'claim.made' ${which} ORDER BY log_pos DESC LIMIT 1`, [session])) as { id: string; data: string }[];
    if (!claim) throw refuse('not_found', '/params/arguments/claim', 'Run a check for a claim this session made: claim first with deep_claim.', args.claim);
    const commit = String((JSON.parse(claim.data) as Obj).commit);
    const { run } = await this.runStart({ check: args.check, claim: `claim:${claim.id}`, commit, argv: ['/bin/sh', '-c', check.run], cwd }, deadline);
    // The run's outcome once it finishes, so the agent needn't poll; past the wait, that it's still running.
    const until = Date.now() + this.askWait(session);
    for (;;) {
      // Read again only once an event about the run lands, the hub stops or the wait runs out (#823).
      const wait = this.wakeable(this.settling, String(run), until - Date.now());
      try {
        const [done] = (await this.record.raw(`SELECT data FROM events WHERE kind = 'run.finished' AND subject = ? LIMIT 1`, [String(run)])) as { data: string }[];
        if (done) {
          const d = JSON.parse(done.data) as { outcome: string; evidence: string[] };
          return { run, claim: `claim:${claim.id}`, outcome: d.outcome, evidence: d.evidence.map((sha) => `ev:${sha}`) };
        }
        if (this.stopping || Date.now() >= until) return { run, claim: `claim:${claim.id}`, outcome: 'running', evidence: [] };
        await wait.woken;
      } finally {
        wait.cancel();
      }
    }
  }
  private refusedAppend(error: unknown, what: string): Refused {
    if (error instanceof RecordError && error.code === 'storage') return new Refused(refusal('unavailable', '', `BLOCKED: appends fail: ${error.message}; ${what} was not recorded.`, what, true));
    const message = error instanceof Error ? error.message : String(error);
    const code = /^(\w+) at /.exec(message)?.[1] ?? 'type';
    return new Refused(refusal(code, error instanceof RecordError && error.path ? `/params/arguments${error.path.replace(/^\/data/, '')}` : '/params/arguments', message, what));
  }

  /** The peer a store writer is bound to: from the connection's credential, never from what the payload says. */
  private peer(fromCredential: Peer, claimed: unknown, session?: string): Peer {
    if (this.options.plant !== 'origin-from-payload') return fromCredential;
    if (claimed === 'deepbuild') return { role: 'deepbuild', via: 'job' };
    if (claimed === 'you') return { role: 'you', via: 'paste' };
    if (claimed === 'agent' && session) return { role: 'agent', session };
    return fromCredential;
  }
  /** The core's INVALID verdict on a claim the floor refused (#29): before any check counts, naming why. */
  private async invalid(claim: string, commit: string, reason: string): Promise<void> {
    const ts = this.now();
    const id = ulid(ts);
    await this.append(this.connection('core'), {
      v: 1, id, kind: 'verdict.made', ts, subject: claim,
      data: {
        outcome: 'INVALID', verdict: `verdict:${id}`, claim, reasons: [reason.slice(0, 8192)], requirements: [], smallest: null, points_to: null, commit,
        key: { commit, doc_revisions: [], check_digests: [], state_digests: [], environment: `${process.platform}-${process.arch}`, tools: [] },
      },
    });
  }
  /** A drafted check's bytes as approved at its definition's lock, kept by digest for the claim's checks to run. */
  private async keep(bytes: Uint8Array, source: string): Promise<string> {
    const put = await this.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind: 'file', source, redaction: 'unknown', license: { name: 'session', allows: [] } });
    return (await this.stored(put, source)).sha256;
  }
  /**
   * A claim's check, run from its approved bytes: read from the evidence store, checked against their digest, and
   * written once under the hub's root by that digest, so a change to the file in the session's folder never runs.
   */
  /**
   * A claim's checks (#29): the validity gate first, with no model, then the gate runner takes its snapshot and its
   * temporary checkout and runs its fast lane; what the stop waits for.
   */
  private async runClaim(r: { claim: string; session: string; commit: string; base: string; cwd: string; deliverables: string[]; checks: { check: string; approved: string; on_base: 'fails' | 'passes'; expected_ms?: number; deadline_ms?: number }[] }): Promise<void> {
    const at = this.now();
    const lane = (async () => {
      const findings = validityGate({ claim: { claim: r.claim, message: this.lastMessage.get(r.session) ?? '' }, checkout: r.cwd, deliverables: r.deliverables, session: await this.sessionLog(r.session) }).map((f) => f.why);
      // A claim that fails the validity gate goes back naming what's missing, before any check runs.
      if (findings.length) return { fast: [], slow: [], snapshot: r.commit, fastEndedAt: this.now(), readyAt: this.now(), findings };
      // Head trust (#29): checks run as you only when every commit since the base was recorded from a DeepBuild
      // session; any other head runs only in the platform sandbox, with no network and no credentials.
      this.untrusted.set(r.claim, !(await this.trustedHead(r.cwd, r.base)));
      const ran = await this.gate.stop({ session: r.session, claim: r.claim, cwd: r.cwd, checks: r.checks, stopAt: at });
      return { ...ran, findings };
    })();
    this.lanes.set(r.claim, lane);
    lane.catch((error: unknown) => process.stderr.write(`deep hub: ${r.claim}'s checks did not start: ${error instanceof Error ? error.message : String(error)}\n`));
  }
  /**
   * Whether a claim's head is trusted: every commit from its base to HEAD was recorded from a DeepBuild session (its
   * commit.made) or has a push.record@1 reading whose pusher is yours. Until a forge's reader is installed (#46), no
   * reading is there, so a commit no session recorded is untrusted, never trusted for its author or committer fields.
   */
  private async trustedHead(cwd: string, base: string): Promise<boolean> {
    const head = (await headOf(cwd).catch(() => undefined))?.sha;
    if (!head || !/^[0-9a-f]{40}$/.test(base) || head === base) return true;
    // The commits a session's own call made, as commit.made records them (a claim's commit lands in the commits table too).
    const recorded = ((await this.record.raw("SELECT json_extract(data, '$.sha') AS sha FROM events WHERE kind = 'commit.made'")) as { sha: string }[]).map((r) => r.sha);
    try {
      return headTrust({ repo: cwd, base, head, recorded, yours: [], provider: [] }).trusted;
    } catch {
      return false;
    }
  }
  /** What this session read and ran, from its own tool calls in the record: what a claim's cites must name. */
  private async sessionLog(session: string): Promise<SessionLog> {
    const rows = (await this.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'tool.after'`, [session])) as { data: string }[];
    const read: string[] = [];
    const ran: SessionLog['ran'] = [];
    const cwd = this.live.get(session)?.cwd ?? '';
    for (const row of rows) {
      const d = JSON.parse(row.data) as Obj;
      for (const p of Array.isArray(d.paths) ? d.paths : []) if (typeof p === 'string') read.push(cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p);
      if (typeof d.command === 'string') ran.push({ command: d.command, exit_status: typeof d.exit_code === 'number' ? d.exit_code : d.outcome === 'ok' ? 0 : null, output: '' });
    }
    return { read, ran, links: [] };
  }
  /** A run's outcome, once its finish is in the record. */
  private async runEnded(run: string): Promise<string> {
    await this.runs.get(run)?.done.catch(() => undefined);
    const [row] = (await this.record.raw(`SELECT outcome FROM runs WHERE id = ?`, [run.slice(4)])) as { outcome: string | null }[];
    return row?.outcome ?? 'stopped';
  }
  private async runApproved(r: { claim: string; check: string; approved: string; commit: string; cwd: string; lane?: 'fast' | 'slow'; expected_ms?: number | null; deadline_ms?: number | null }): Promise<string> {
    let script = join(this.root.dir, 'checks', r.approved);
    if (this.options.plant === 'runs-disk-bytes') script = join(r.cwd, r.check);
    else if (!existsSync(script)) {
      mkdirSync(join(this.root.dir, 'checks'), { recursive: true, mode: 0o700 });
      writeFileSync(`${script}.tmp`, await this.store.read(r.approved), { mode: 0o500 });
      renameSync(`${script}.tmp`, script);
    }
    // An untrusted head's run gets its checkout and nothing else: no network, no credentials, none of your files.
    const grant = this.untrusted.get(r.claim) ? { write: [r.cwd], read: [r.cwd, script] } : RUN_AS_YOU;
    const { run } = await this.runStart({ check: r.check, claim: r.claim, commit: r.commit, argv: ['/bin/sh', script], cwd: r.cwd, grant, lane: r.lane ?? 'slow', expected_ms: r.expected_ms ?? null, deadline_ms: r.deadline_ms ?? null });
    return String(run);
  }
  /**
   * The stop rule (#303, design: Every stop is judged): a stop whose turn did work is a claim, other than one right
   * after startup, a resume or /clear, or an answer, a turn begun by a prompt you typed that opened no task, with no
   * edit, write or ask in it. The planted wrong program reads every stop with tool calls as a claim.
   */
  private stopRule(count: Counter): boolean {
    const answer = count.prompt?.person === true && !count.prompt.opened && !count.changed;
    return this.options.plant === 'claim-on-tool-calls' ? count.worked : count.worked && !count.fresh && !answer;
  }
  /**
   * A session's counter, its messages numbered on from its last recorded one, so a restarted hub never reuses a
   * handle; with what the stop rule reads of the turn under way: its prompt, and whether a start came after it.
   */
  private async counterOf(session: string): Promise<Counter> {
    const [row] = session ? await this.record.raw(`SELECT MAX(json_extract(data, '$.msg')) AS msg FROM events WHERE session_id = ? AND kind = 'user.ask'`, [session]).catch(() => []) as { msg: number | null }[] : [];
    // The newest prompt stands for the turn's: a mid-turn message after the one that opened a task reads, until
    // the next prompt, as a prompt that opened none.
    const [prompt] = session ? await this.record.raw(`SELECT json_extract(data, '$.from') AS f, json_extract(data, '$.tasks[0]') AS task, log_pos FROM events WHERE session_id = ? AND kind = 'user.ask' AND NOT (agent = 'codex' AND json_extract(data, '$.from') = 'subagent') ORDER BY log_pos DESC LIMIT 1`, [session]).catch(() => []) as { f: string | null; task: string | null; log_pos: number }[] : [];
    const [started] = prompt ? await this.record.raw(`SELECT 1 AS one FROM events WHERE session_id = ? AND kind = 'session.start' AND log_pos > ? LIMIT 1`, [session, prompt.log_pos]).catch(() => []) as { one: number }[] : [];
    // The turn's work since its last boundary (its prompt, its last stop or a start), so a turn a hub restart
    // interrupted is judged at its stop as the rule reads it (#83): a tool call, and one that may have changed code.
    const [boundary] = session ? await this.record.raw(`SELECT MAX(log_pos) AS at FROM events WHERE session_id = ? AND kind IN ('user.ask', 'agent.stop', 'session.start') AND json_extract(data, '$.subagent') IS NULL AND NOT (kind = 'user.ask' AND agent = 'codex' AND json_extract(data, '$.from') = 'subagent')`, [session]).catch(() => []) as { at: number | null }[] : [];
    const calls = boundary?.at !== null && boundary?.at !== undefined ? (await this.record.raw(`SELECT json_extract(data, '$.kind') AS k FROM events WHERE session_id = ? AND kind = 'tool.after' AND log_pos > ?`, [session, boundary.at]).catch(() => [])) as { k: string | null }[] : [];
    const count = this.counters.get(session) ?? {
      msgs: row?.msg === null || row?.msg === undefined ? 0 : Number(row.msg) + 1, turns: 0, worked: calls.length > 0, changed: calls.some((c) => !READS.has(String(c.k))),
      ...(prompt ? { prompt: { person: prompt.f === 'person', opened: prompt.task !== null }, fresh: started !== undefined } : {}),
    };
    this.counters.set(session, count);
    return count;
  }
  private async stored(put: PutResult, what: string): Promise<Evidence> {
    if (put.status !== 'stored') throw new Refused(refusal('unavailable', '', `The evidence store refused ${what}: ${put.reason}`, what, true));
    this.durable.point('evidence_rename');
    const ev = put.evidence;
    await this.appendCore('evidence.stored', {
      sha256: ev.sha256, kind: ev.kind, type: ev.type, size: ev.size, origin: ev.origin, redaction: ev.redaction, license: ev.license.name, derived_from: [...ev.derivedFrom], step_times: [],
    }).catch(() => undefined);
    return ev;
  }
  /**
   * deep_evidence: a file in the session's working folder, read only once `..` and every link in its path are
   * resolved and it is still inside; any other path is answered exactly as one that doesn't exist.
   */
  private async attach(session: string, args: Obj): Promise<Obj> {
    const folder = realpathSync(this.sessions.get(session)!.cwd);
    const sent = String(args.path);
    const missing = () => refuse('not_found', '/params/arguments/path', `No file ${sent} in this session's working folder; name a file inside it.`, sent);
    let path = resolve(folder, sent);
    if (this.options.plant !== 'evidence-checks-path-first') path = await realpath(path).catch(() => '');
    if (!path || !isUnder(path, folder)) throw missing();
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      throw missing();
    }
    const claimed = typeof args.origin === 'string' ? args.origin : undefined;
    const writer = this.store.connect(this.peer({ role: 'agent', session }, claimed, session));
    const put = await writer.put({
      bytes: new Uint8Array(bytes), kind: typeof args.kind === 'string' && args.kind ? args.kind : 'file', source: relative(folder, path),
      redaction: 'unknown', license: { name: 'session', allows: [] }, ...(claimed && ['deepbuild', 'you', 'agent'].includes(claimed) ? { origin: claimed as Origin } : {}),
    });
    return { sha256: (await this.stored(put, relative(folder, path))).sha256 };
  }
  private async paste(params: Obj): Promise<Obj> {
    if (typeof params.bytes !== 'string' || !params.bytes) throw new Refused(refusal('required', '/params/bytes', 'Send the pasted image as base64 in bytes.', params.bytes));
    const bytes = new Uint8Array(Buffer.from(params.bytes, 'base64'));
    const declares = params.type === 'png' || params.type === 'jpeg' ? params.type : undefined;
    const writer = this.store.connect(this.peer({ role: 'you', via: 'paste' }, params.origin));
    const put = await writer.put({ bytes, kind: 'image', source: 'app:paste', redaction: 'unknown', license: { name: 'yours', allows: [] }, ...(declares ? { declares } : {}) });
    return { sha256: (await this.stored(put, 'the pasted image')).sha256 };
  }

  // ---- The supervisor's runs.

  private journal(): Record<string, Run> {
    try {
      return JSON.parse(readFileSync(this.root.runs, 'utf8')) as Record<string, Run>;
    } catch {
      return {};
    }
  }
  private writeJournal(update: (runs: Record<string, Run>) => void): void {
    const runs = this.journal();
    update(runs);
    writeFileSync(`${this.root.runs}.tmp`, JSON.stringify(runs), { mode: 0o600 });
    renameSync(`${this.root.runs}.tmp`, this.root.runs);
  }

  /** run.start, and deep_run's runs with the deadline their spec gives, in ms. */
  private async runStart(params: Obj, deadline?: number): Promise<Obj> {
    const { check, claim, commit, argv, env = {}, cwd = process.cwd(), grant = RUN_AS_YOU, environment = false, lane, expected_ms, deadline_ms } = params;
    const limit = deadline ?? (typeof deadline_ms === 'number' ? deadline_ms : undefined);
    if (typeof check !== 'string' || !check) throw new Refused(refusal('required', '/params/check', 'Name the check the run is for.', check));
    if (typeof claim !== 'string' || !/^claim:[0-9A-Za-z]+$/.test(claim)) throw new Refused(refusal('pattern', '/params/claim', 'Name the claim as claim:<id>.', claim));
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) throw new Refused(refusal('pattern', '/params/commit', 'Name the commit by its 40-character SHA.', commit));
    if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== 'string')) throw new Refused(refusal('type', '/params/argv', 'Give the run its program and arguments as strings.', argv));
    if (!isObj(env) || Object.values(env).some((v) => typeof v !== 'string')) throw new Refused(refusal('type', '/params/env', 'Give env as names to string values.', env));
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Refused(refusal('type', '/params/cwd', 'Give the run its folder as an absolute path.', cwd));
    if (!isObj(grant) || Object.keys(grant).some((k) => k !== 'run_as_you' && !(GRANT_LISTS as readonly string[]).includes(k))) {
      throw new Refused(refusal('type', '/params/grant', 'Give the grant as read, write, hosts and sockets lists, or run_as_you.', grant));
    }
    for (const k of GRANT_LISTS) {
      const list = grant[k];
      if (list !== undefined && (!Array.isArray(list) || list.some((v) => typeof v !== 'string' || (k !== 'hosts' && !isAbsolute(v))))) {
        throw new Refused(refusal('type', `/params/grant/${k}`, k === 'hosts' ? 'List hosts as host:port strings.' : 'List absolute paths.', list));
      }
    }
    if (grant.run_as_you !== undefined && typeof grant.run_as_you !== 'boolean') throw new Refused(refusal('type', '/params/grant/run_as_you', 'Give run_as_you as true or false.', grant.run_as_you));
    if (typeof environment !== 'boolean') throw new Refused(refusal('type', '/params/environment', 'Give environment as true when the run needs its folder\'s stack running.', environment));
    const run = await this.launch({
      run: `run:${ulid(this.now())}`, check, claim, commit, argv: argv as string[], env: env as Record<string, string>, cwd, grant: grant as Grant, ...(environment ? { environment } : {}),
      ...(lane === 'fast' || lane === 'slow' ? { lane } : {}), ...(typeof expected_ms === 'number' ? { expected_ms } : {}),
      ...(limit ? { deadline: limit } : {}),
    });
    return { run };
  }

  /** The session a claim was made in, as a lease holder; the core's own for a claim the record doesn't hold. */
  private async claimSession(claim: string): Promise<string> {
    const [row] = (await this.record.raw(`SELECT session_id FROM events WHERE kind = 'claim.made' AND id = ? LIMIT 1`, [claim.slice(6)])) as { session_id: string | null }[];
    return row?.session_id ? `session:${letters(row.session_id)}` : 'core';
  }
  /** Starts a run through the host, sandboxed, with the hub's run token injected; its output becomes scrubbed evidence. */
  private async launch(run: Run): Promise<string> {
    this.writeJournal((runs) => { runs[run.run] = run; });
    // Every check run takes a `cpu.slot` from the kernel's lease table first, held for the claim's session (#29):
    // at most half the cores run checks, and the slot shows in the lease table under that session.
    const holder = await this.claimSession(run.claim);
    const lease = await slot(this.leases, holder, run.run);
    // Where it runs and what it needs (#29), so a later placement can pick any host from the same record.
    const ts = this.now();
    await this.append(this.connection('core'), {
      v: 2, id: ulid(ts), kind: 'run.started', ts, subject: run.run,
      data: { run: run.run, check: run.check, claim: run.claim, commit: run.commit, host: 'local', needs: { cores: 1, memory_mb: 0, stack_slot: run.environment ? 1 : 0, gpus: 0, expected_ms: run.expected_ms ?? null }, lane: run.lane ?? 'slow' },
    });
    const token = randomBytes(24).toString('base64url');
    const env = { ...run.env, DEEP_RUN_TOKEN: token };
    const values = this.options.plant === 'no-run-values' ? undefined : { env, held: [token, ...this.options.held] };
    const writer = this.store.connect({ role: 'deepbuild', via: 'job' });
    const label = { source: run.run, redaction: 'complete' as const, license: { name: 'local', allows: [] }, ...(values ? { run: values } : {}) };
    const sinks = [writer.text({ kind: 'run.stdout', ...label }), writer.text({ kind: 'run.stderr', ...label })];
    let writes = Promise.resolve();
    const output = {
      stdout: (chunk: Buffer) => { writes = writes.then(() => sinks[0]!.write(chunk)); },
      stderr: (chunk: Buffer) => { writes = writes.then(() => sinks[1]!.write(chunk)); },
    };
    let stop: () => void;
    let ended: Promise<{ code: number | null; failed?: string; missing?: string }>;
    if (this.options.plant === 'run-spawns-itself') {
      // The planted wrong program: the hub spawns the run itself, past the host and its sandbox.
      const child = spawn(run.argv[0]!, run.argv.slice(1), { cwd: run.cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout!.on('data', output.stdout);
      child.stderr!.on('data', output.stderr);
      ended = new Promise((done) => {
        child.on('error', (error) => done({ code: null, failed: error.message }));
        child.on('close', (code) => done({ code }));
      });
      stop = () => { try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* gone */ } };
    } else {
      // A run that needs the app has its stack brought up from its own folder first, its check's checkout; a stack
      // that isn't ready makes the run missing, and its own process never starts.
      const stackRun = run.environment ? newRun(this.now()) : undefined;
      if (stackRun) this.stackRuns.add(stackRun);
      const stack: Promise<Up | undefined> = stackRun
        ? upStack(this.host, { run: stackRun, folder: run.cwd, compose: this.compose, sharedProject: this.options.plant === 'compose-default-project', take: this.take('core', stackRun), scrub: (v) => { values?.held.push(...v); this.scrubValues(v); } })
          .catch((error: Error) => ({ status: 'BLOCKED' as const, run: stackRun, cause: error.message }))
        : Promise.resolve(undefined);
      const started = stack.then<Started | { run: string; status: 'missing'; cause: string }>(async (up) => {
        if (up?.status === 'BLOCKED') return { run: run.run, status: 'missing', cause: up.cause };
        if (up) {
          // Its database's clone is recorded (#332).
          await this.cloned(run.run, up.stack);
        }
        const ports = Object.entries(up?.stack.ports ?? {});
        const hosts = ports.map(([, port]) => `127.0.0.1:${port}`);
        return this.host.start({
          run: run.run, argv: run.argv, cwd: run.cwd, env: { ...env, ...Object.fromEntries(ports.map(([name, port]) => [name, String(port)])) },
          grant: hosts.length ? { ...run.grant, hosts: [...(run.grant.hosts ?? []), ...hosts] } : run.grant, output,
        });
      });
      ended = started.then(async (s) => {
        if (s.status === 'missing') return { code: null, missing: s.cause };
        if (s.status === 'BLOCKED') return { code: null, failed: `BLOCKED: no ${s.kind} free` };
        const exit = await this.host.wait(run.run);
        return { code: exit.code };
      }, (error: Error) => ({ code: null, failed: error.message }));
      // The stack goes down once the run has ended, its leases released by its cleanup.
      if (stackRun) ended = ended.then(async (end) => { await this.takeDown(stackRun).catch(() => undefined); return end; });
      stop = () => {
        void started.then(() => this.host.signal(run.run, 'SIGTERM')).catch(() => undefined);
        // A run still held on a resource never starts: given up on, its start resolves BLOCKED.
        void this.supervisor.status(run.run).then((s) => (s.state === 'held' ? this.supervisor.cleanup(run.run) : undefined)).catch(() => undefined);
      };
    }
    // A run still going at its spec's deadline is stopped and ends overran (#27), never passed or failed.
    let overran = false;
    const disarm = run.deadline ? after(run.deadline, () => { overran = true; stop(); setTimeout(() => void this.host.signal(run.run, 'SIGKILL').catch(() => undefined), RUN_KILL_GRACE_MS).unref(); }) : undefined;
    const done = ended.then(async ({ code, failed, missing }) => {
      disarm?.();
      // What the run left behind is stopped and its leases released before its finish is recorded.
      if (this.options.plant !== 'run-spawns-itself') await this.supervisor.cleanup(run.run).catch(() => undefined);
      await writes;
      const evidence: string[] = [];
      for (const sink of sinks) {
        const put = await sink.close();
        if (put.status === 'stored') evidence.push((await this.stored(put, `${run.run}'s output`)).sha256);
      }
      const outcome = this.stopping ? 'stopped' : overran ? 'overran' : missing ? 'missing' : code === 0 ? 'passed' : 'failed';
      const findings = this.stopping ? ['hub stopped'] : overran ? [`still running at its deadline of ${words(run.deadline!)}, so it was stopped`] : missing ? [`its stack never came up: ${missing}`] : failed ? [failed] : [];
      await this.finish(run, outcome, findings, evidence);
    });
    this.runs.set(run.run, { run, done, stop });
    void done.finally(() => this.leases.release(lease.id, []).catch(() => undefined)).finally(() => this.runs.delete(run.run));
    return run.run;
  }
  private async finish(run: Run, outcome: string, findings: string[], evidence: string[]): Promise<void> {
    await this.appendCore('run.finished', {
      run: run.run, outcome, tests_run: 0, passed: 0, runs: 1, evidence, check: run.check, assertion: null, expected: null, actual: null, step: null,
      points_to: null, findings, environment: `${process.platform}-${process.arch}`,
    }, { subject: run.run });
    // The journal keeps the run until its finish is durable, so a cut before then reruns it.
    await this.record.sync();
    this.writeJournal((runs) => { delete runs[run.run]; });
  }
  /** After a start with runs still in the journal: each was in flight when the hub stopped without a clean stop. */
  private async recoverRuns(): Promise<void> {
    const recorded = async (kind: string, run: string) => (await this.record.raw(`SELECT 1 FROM events WHERE kind = ? AND json_extract(data, '$.run') = ? LIMIT 1`, [kind, run.replace(/'/g, "''")])).length > 0;
    for (const run of Object.values(this.journal())) {
      if (await recorded('run.finished', run.run)) {
        this.writeJournal((runs) => { delete runs[run.run]; });
        continue;
      }
      // Its processes were reaped when the supervisor opened.
      if (await recorded('run.started', run.run)) await this.finish(run, 'stopped', ['hub restarted'], []);
      else this.writeJournal((runs) => { delete runs[run.run]; });
      // Its claim's check runs again.
      await this.launch({ ...run, run: `run:${ulid(this.now())}`, cwd: run.cwd ?? process.cwd(), grant: run.grant ?? RUN_AS_YOU });
    }
  }

  // ---- deep env up and down (#331): a worktree's stack through env-local, every process through the host.

  private worktreeOf(params: Obj): string {
    const { worktree } = params;
    if (typeof worktree !== 'string' || !isAbsolute(worktree) || !existsSync(worktree)) throw new Refused(refusal('type', '/params/worktree', 'Name the worktree by its absolute path.', worktree));
    return realpathSync(worktree);
  }
  /** Runs the worktree's env call once every earlier one for it has finished: a second up waits and finds the first's stack, an up during a down starts after it. */
  private inTurn(worktree: string, call: () => Promise<Obj>): Promise<Obj> {
    const turn = (this.turns.get(worktree) ?? Promise.resolve()).catch(() => undefined).then(call);
    this.turns.set(worktree, turn);
    void turn.catch(() => undefined).then(() => { if (this.turns.get(worktree) === turn) this.turns.delete(worktree); });
    return turn;
  }
  /**
   * Signals a stack run down through the host, then the supervisor stops what's left of it and releases its leases;
   * the keys its session leased through the table (#332) end once every process recorded for it is gone, citing those ends.
   */
  private async takeDown(run: string): Promise<{ stopped: number[]; left: string[] }> {
    try {
      await downStack(this.host, run);
      return await this.supervisor.cleanup(run);
    } finally {
      this.stackRuns.delete(run);
      await this.giveBack(run).catch(() => undefined);
    }
  }
  /**
   * Ends the per-session keys a stack run leased once every process recorded for it has its process.ended, citing
   * those; while one runs, or for a run whose start nothing recorded, the record decides, never a guess.
   */
  private async giveBack(run: string): Promise<void> {
    const ids = this.taken.get(run) ?? [];
    if (!ids.length) return;
    const rows = await this.record.raw(`SELECT kind, id, json_extract(data, '$.pid') AS pid FROM events WHERE kind IN ('process.tracked', 'process.ended') AND json_extract(data, '$.run') = ?`, [run]) as { kind: string; id: string; pid: number }[];
    const ended = rows.filter((r) => r.kind === 'process.ended');
    if (rows.some((r) => r.kind === 'process.tracked' && !ended.some((e) => e.pid === r.pid))) return;
    this.taken.delete(run);
    this.owners.delete(run);
    for (const id of ids) await this.leases.release(id, ended.map((r) => r.id));
  }
  /**
   * env-local's Take for one stack run (#332): one of the keys, leased to the holder for the run through the kernel's
   * table, or BLOCKED naming each lease that holds them, so a session never starts on a key another one holds.
   */
  private take(holder: string, run: string): Take {
    // Two variables leased from one pool get two keys: a key this stack already holds isn't leased to it again.
    const mine = new Set<string>();
    return async (kind, keys) => {
      // Keys of a stack already taken down, whose cleanup left a process the supervisor has since seen end, go back.
      for (const other of [...this.taken.keys()]) if (!this.stackRuns.has(other)) await this.giveBack(other).catch(() => undefined);
      // A worktree's stack whose process ended on its own is cleaned up first, which records its ends and gives its keys back.
      for (const [worktree, stack] of [...this.stacks]) {
        if (!this.taken.has(stack.run)) continue;
        // A stack whose session is gone without a SessionEnd goes down with it, so its keys don't outlive it.
        if (this.owners.has(stack.run) && (await this.ownerOf(stack.run)) === undefined) {
          if (this.stacks.get(worktree) === stack) this.stacks.delete(worktree);
          await this.takeDown(stack.run).catch(() => undefined);
          continue;
        }
        if (!(await this.gone(stack.run))) continue;
        if (this.stacks.get(worktree) === stack) this.stacks.delete(worktree);
        await this.takeDown(stack.run).catch(() => undefined);
      }
      const held: string[] = [];
      for (const key of keys) {
        if (mine.has(`${kind}:${key}`)) continue;
        const got = await this.leases.lease({ holder, run }, { host: 'local', kind, key }, 'exclusive');
        if (got.status === 'granted') {
          mine.add(`${kind}:${key}`);
          this.taken.set(run, [...(this.taken.get(run) ?? []), got.lease.id]);
          this.owners.set(run, holder);
          return { key };
        }
        held.push(got.message);
      }
      return { cause: `no ${kind} of ${keys.join(', ')} is free to lease: ${held.join('; ')}` };
    };
  }
  /** A session that ended takes the stacks its keys back down with it, so no key outlives its session (#332). */
  private endStacks(session: string): void {
    for (const [worktree, stack] of this.stacks) {
      if (this.owners.get(stack.run) === `mcp:${session}`) void this.downFor(worktree, { path: '/params/worktree', remedy: 'deep env up' }).catch(() => undefined);
    }
  }
  /** Whether a stack run ended on its own: its first process exited, and none recorded for it still runs in the background. */
  private async gone(run: string): Promise<boolean> {
    if ((await this.supervisor.status(run).catch(() => undefined))?.state !== 'exited') return false;
    const pids = await this.record.raw(`SELECT DISTINCT json_extract(data, '$.pid') AS pid FROM events WHERE kind = 'process.tracked' AND json_extract(data, '$.run') = ?`, [run]) as { pid: number }[];
    return !pids.some((r) => running(r.pid));
  }
  /**
   * Who a stack run's per-session keys stay with: its owner, unless that is a session that has ended, which owns
   * nothing; one that ended without a SessionEnd (its agent killed) is ended once its agent's process is gone. A start
   * that can't be read (ps failing under load) proves nothing, so the session keeps its stack while its process runs.
   */
  private async ownerOf(run: string): Promise<string | undefined> {
    const owner = this.owners.get(run);
    const session = owner?.startsWith('mcp:') ? this.sessions.get(owner.slice('mcp:'.length)) : undefined;
    if (!session) return owner;
    if (session.ended) return undefined;
    const start = await this.startOf(session.pid, true);
    return (start === undefined ? running(session.pid) : start === session.start) ? owner : undefined;
  }
  /** Values env-local loaded into a stack: scrubbed by value from hook text and evidence from now on (#332). */
  private scrubValues(values: string[]): void {
    const fresh = [...new Set(values)].filter((value) => !this.options.held.includes(value));
    if (!fresh.length) return;
    this.options.held.push(...fresh);
    this.scrubbing(fresh);
  }
  /** A run's database clone, kept in the record: the template's seed record, the template's digest and when it was cloned (#332). */
  private async cloned(run: string, stack: Stack): Promise<void> {
    // The planted wrong program copies the database and drops its record.
    if (!stack.seed || this.options.plant === 'env-clone-without-record') return;
    const held = { held: this.options.held };
    const { source, copied_at, migration, template } = stack.seed;
    await this.appendCore('seed.cloned', { run, stack: stack.run, source: scrubText(source, held), copied_at: scrubText(copied_at, held), migration: scrubText(migration, held), template, cloned_at: this.now() }, { subject: run });
  }
  /** `deep env up`: its leases are held by the agent session whose process runs the command, found by the peer check, or by the core from your own terminal. */
  private async envUp(params: Obj, context: CallContext): Promise<Obj> {
    const worktree = this.worktreeOf(params);
    return this.upFor(worktree, await this.envCaller(context.peer, worktree));
  }
  /**
   * The agent session a `deep env` caller runs under, or none for your own terminal (#332). A caller whose start can't
   * be read is refused, so a ps failing under load never credits an agent's keys to your terminal.
   */
  private async envCaller(peer: CallContext['peer'], worktree: string): Promise<string | undefined> {
    if (peer && (!peer.start || (await this.startOf(peer.pid, true)) === undefined)) {
      throw new Refused(refusal('unavailable', '', 'The hub couldn\'t read when the process asking started, so it can\'t tell which session asks; try again.', worktree, true));
    }
    const session = await this.agentAbove(peer);
    return session ? `mcp:${session}` : undefined;
  }
  private upFor(worktree: string, holder?: string): Promise<Obj> {
    return this.inTurn(worktree, () => this.riseIn(worktree, holder));
  }
  /**
   * deep_env (#331): the bound session's own worktree's stack, up or down, as `deep env up` and `deep env down` run
   * there. The worktree is the session's, from its hooks, never from the call, so a child session in a worktree of its
   * own leases its own ports there and never its parent's. Its leases name the session's deep mcp as their holder; a
   * stack already up in that worktree is reused as it is, so the holder says who leased it, not who uses it.
   */
  private async deepEnv(session: string, action: string): Promise<Obj> {
    const cwd = this.sessions.get(session)!.cwd;
    if (!existsSync(cwd)) throw refuse('not_found', '/params/arguments', `Session ${session}'s worktree ${cwd} doesn't exist; its stack runs from its worktree alone.`, cwd);
    const worktree = realpathSync(cwd);
    return action === 'up' ? this.upFor(worktree, `mcp:${session}`) : this.downFor(worktree, { path: '/params/arguments', remedy: 'deep_env with action up' }, `mcp:${session}`);
  }
  private async riseIn(worktree: string, holder?: string): Promise<Obj> {
    let running = this.stacks.get(worktree);
    // A stack that ended on its own is no one's: it is cleaned up, which gives its keys back, and a new one starts.
    if (running && (await this.gone(running.run))) {
      this.stacks.delete(worktree);
      await this.takeDown(running.run).catch(() => undefined);
      running = undefined;
    }
    // A stack is reused only while its process runs and its health route still answers 200, and by an agent session
    // only when no other session leased its keys: they stay that session's (#332).
    const owner = running ? await this.ownerOf(running.run) : undefined;
    if (running && holder && owner && owner !== holder) return { status: 'BLOCKED', worktree, cause: `the stack in ${worktree} runs on leases ${(this.taken.get(running.run) ?? []).join(', ')} held by ${owned(owner)}, so it stays theirs; their deep env down, or yours from your own terminal, ends it` };
    // A stack whose keys an ended session leased starts again under its new holder, so no key outlives its session's use.
    const orphaned = running !== undefined && this.owners.has(running.run) && owner === undefined && this.owners.get(running.run) !== (holder ?? 'core');
    if (running && !orphaned && (await this.supervisor.status(running.run)).state === 'running' && (await answers(running))) {
      return { status: 'ready', run: running.run, worktree, ports: running.ports, ...(running.project ? { project: running.project } : {}) };
    }
    // Any other is taken down, and a new one started.
    if (running) {
      this.stacks.delete(worktree);
      await this.takeDown(running.run).catch(() => undefined);
    }
    if (this.stopping) return { status: 'BLOCKED', worktree, cause: 'the hub is stopping' };
    const run = newRun(this.now());
    this.stackRuns.add(run);
    this.rising.set(worktree, run);
    const up = await upStack(this.host, { run, folder: worktree, compose: this.compose, sharedProject: this.options.plant === 'compose-default-project', take: this.take(holder ?? 'core', run), scrub: (v) => this.scrubValues(v), ...(holder ? { holder } : {}) })
      .catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }))
      .finally(() => this.rising.delete(worktree));
    if (up.status === 'BLOCKED') {
      // What it started is stopped and its leases released; a stack that never started has nothing to clean.
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: up.cause };
    }
    // A session that ended while its stack came up leaves no key behind: the stack goes down with it.
    const ended = this.owners.get(run);
    if (ended && (await this.ownerOf(run)) === undefined) {
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: `${owned(ended)} ended while its stack came up` };
    }
    const unrecorded = await this.cloned(run, up.stack).then(() => undefined, (error: Error) => error.message);
    if (unrecorded) {
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: `its database's clone record couldn't be kept: ${unrecorded}` };
    }
    this.stacks.set(worktree, up.stack);
    return { status: 'ready', run, worktree, ports: up.stack.ports, ...(up.stack.project ? { project: up.stack.project } : {}) };
  }
  /**
   * Takes the worktree's stack down: signalled through the host, then the supervisor's cleanup stops what it can
   * prove is the run's and ends its leases once every recorded process is gone. A process it can't prove, or one
   * that was never recorded and still listens on a leased port, is reported with its PID and the port, never stopped.
   */
  private async envDown(params: Obj, context: CallContext): Promise<Obj> {
    const worktree = this.worktreeOf(params);
    return this.downFor(worktree, { path: '/params/worktree', remedy: 'deep env up' }, await this.envCaller(context.peer, worktree));
  }
  /** `at` names, for the caller's surface, where a refusal points and what starts a stack there. */
  /** `caller` is the agent session's deep mcp asking; a stack whose keys another session leased stays up for it (#332). */
  private async downFor(worktree: string, at: { path: string; remedy: string }, caller?: string): Promise<Obj> {
    // A stack still coming up is signalled down now: its up ends BLOCKED, and this down's turn follows it.
    const rising = this.rising.get(worktree);
    const owner = rising ? await this.ownerOf(rising) : undefined;
    if (rising && caller && owner && owner !== caller) throw (new Refused(refusal('role', at.path, `The stack coming up in ${worktree} runs on keys ${owned(owner!)} leased, so only they, or you from your own terminal, take it down.`, worktree)));
    if (rising) void downStack(this.host, rising);
    return this.inTurn(worktree, () => this.downIn(worktree, at, rising, caller));
  }
  private async downIn(worktree: string, at: { path: string; remedy: string }, interrupted?: string, caller?: string): Promise<Obj> {
    const stack = this.stacks.get(worktree);
    // The up it interrupted took its own stack down and cleaned it up.
    if (!stack && interrupted) return { run: interrupted, stopped: [], left: [] };
    if (!stack) throw new Refused(refusal('not_found', at.path, `No stack runs for ${worktree}; start one with ${at.remedy}.`, worktree));
    const owner = await this.ownerOf(stack.run);
    if (caller && owner && owner !== caller) throw new Refused(refusal('role', at.path, `The stack in ${worktree} runs on keys ${owned(owner)} leased, so only they, or you from your own terminal, take it down.`, worktree));
    const ports = Object.values(stack.ports);
    const recorded = (await this.record.raw(`SELECT DISTINCT json_extract(data, '$.pid') AS pid FROM events WHERE kind = 'process.tracked' AND json_extract(data, '$.run') = ?`, [stack.run]) as { pid: number }[]).map((r) => r.pid);
    const before = recorded.filter(running);
    this.stacks.delete(worktree);
    const { result: cleaned, left } = await downLeaving(ports, { listen: listening, leases: async () => (await this.leases.leases()).map((v) => v.lease) }, async () => {
      // The planted wrong program stops whatever listens on the leased ports, the run's or not.
      if (this.options.plant === 'env-kills-by-port') for (const port of ports) for (const pid of await listening(port)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      return this.takeDown(stack.run);
    });
    const stopped = [...new Set([...before.filter((pid) => !running(pid)), ...cleaned.stopped])];
    return { run: stack.run, stopped, left };
  }

  // ---- Spool, retention and the test load.

  /**
   * Replays deep-hook's spool: each line once, in the order it was written. A line that doesn't parse, cut by a
   * write that never finished, is skipped and recorded naming its offset, and every request after it is kept,
   * one appended right after the cut bytes included. A file is removed only once its events are in a FULL commit.
   */
  private async replaySpool(): Promise<void> {
    if (!existsSync(this.root.spool)) return;
    // Every deep-hook appends to spool.jsonl. It moves aside first, so a hook that spools during the replay begins
    // a new file, which the next replay takes. A hook whose write lands in the moved file sees the path no longer
    // names it and writes the line again to the new one (deep-hook's spool), so nothing written late is lost; the
    // short wait only lets a write in flight finish here rather than read as a cut line.
    const live = join(this.root.spool, SPOOL);
    if (existsSync(live)) {
      // Named after every file a replay kept, whatever the clock says now: the files replay in name order.
      const kept = readdirSync(this.root.spool).filter((f) => /^replay-[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/.test(f)).sort().at(-1);
      const after = kept ? ulidTime(kept.slice(7, 33)) + 1 : 0;
      const moved = join(this.root.spool, `replay-${ulid(Math.max(Date.now(), after))}.jsonl`);
      renameSync(live, moved);
      await new Promise((done) => setTimeout(done, 100));
      // deep-hook syncs spool.jsonl by its name, so a line written just before the move may be synced by no one:
      // the moved file and the move are synced here before any of it is read.
      syncPath(moved);
      syncPath(this.root.spool);
    }
    for (const name of readdirSync(this.root.spool).filter((f) => f.endsWith('.jsonl') && f !== SPOOL).sort()) {
      const file = join(this.root.spool, name);
      const text = readFileSync(file);
      this.durable.point('spool_read');
      let failed = false;
      // A cut line is recorded once, however often its kept file is replayed.
      const skip = async (offset: number, reason: string) => {
        try {
          const known = await this.record.raw(`SELECT 1 FROM events WHERE kind = 'spool.refused' AND json_extract(data, '$.file') = ? AND json_extract(data, '$.offset') = ? LIMIT 1`, [name, offset]);
          if (!known.length) await this.appendCore('spool.refused', { file: name, offset, reason });
        } catch {
          failed = true;
        }
      };
      for (let offset = 0; offset < text.length;) {
        // A stopping hub keeps the rest of the file for its next start.
        if (this.stopping) {
          failed = true;
          break;
        }
        let end = text.indexOf(0x0a, offset);
        if (end < 0) end = text.length;
        const line = text.subarray(offset, end);
        let parsed = line.length ? parseLine(line, true, this.options.held, this.options.plant) : undefined;
        if (parsed?.kind === 'refused' && parsed.error.code === 'not_json') {
          await skip(offset, 'a cut line: a spooled write that never finished, so it does not parse');
          if (this.options.plant === 'stops-at-first-bad-line') break;
          // A request appended right after the cut bytes shares their line; each begins as deep-hook writes it.
          parsed = undefined;
          for (let at = line.indexOf(REQUEST, 1); at > 0 && !parsed; at = line.indexOf(REQUEST, at + 1)) {
            const glued = parseLine(line.subarray(at), true, this.options.held, this.options.plant);
            if (glued.kind !== 'refused' || glued.error.code !== 'not_json') parsed = glued;
          }
        }
        if (parsed?.kind === 'hook') {
          const { drafts, meta } = parsed;
          await this.queue(() => this.handleHook(drafts, meta, 'hook', true), true).then(({ settled }) => settled).catch((error: unknown) => {
            failed = true;
            process.stderr.write(`deep hub: ${name} kept: ${meta.id} not replayed: ${error instanceof Error ? error.message : String(error)}\n`);
          });
          // The planted wrong program appends the first event it replays a second time, under a new ID.
          if (this.options.plant === 'replay-appends-twice' && !this.doubled) {
            this.doubled = true;
            const again = ulid(Date.now());
            await this.queue(() => this.handleHook(drafts.map((d) => ({ ...d, id: again })), { ...meta, id: again }, 'hook', true), true).then(({ settled }) => settled);
          }
        } else if (parsed) {
          await skip(offset, parsed.kind === 'refused' ? `refused: ${parsed.error.code} at ${parsed.error.path || '/'}` : 'not a hook request');
        }
        offset = end + 1;
      }
      if (failed) continue;
      // The planted wrong program removes the file with its events still in NORMAL commits only.
      if (this.options.plant !== 'remove-spool-after-normal') await this.record.sync();
      rmSync(file);
      this.durable.point('spool_removal');
    }
  }

  /**
   * The retention pass: keeps the files decisions and verdicts cite, the transcripts transcript.archived links and the
   * CI logs ci.archived links, which outlive the forge's own retention only if ours keeps them.
   */
  private async retain(): Promise<void> {
    const rows = (await this.record.raw("SELECT evidence FROM events WHERE kind IN ('decision.created', 'decision.applied', 'verdict.made') AND evidence IS NOT NULL")) as { evidence: string }[];
    const cited = new Set<string>(this.options.plant === 'empty-cited' ? [] : rows.flatMap((r) => JSON.parse(r.evidence) as string[]));
    const linked = (await this.record.raw("SELECT json_extract(data, '$.evidence') AS sha FROM events WHERE kind = 'transcript.archived'")) as { sha: string | null }[];
    const logs = (await this.record.raw("SELECT evidence FROM events WHERE kind = 'ci.archived' AND evidence IS NOT NULL")) as { evidence: string }[];
    const archived = new Set([...linked.flatMap((r) => (r.sha ? [r.sha] : [])), ...logs.flatMap((r) => JSON.parse(r.evidence) as string[])]);
    const { removed } = await this.store.retain({ cited, archived });
    for (const sha256 of removed) await this.appendCore('evidence.removed', { sha256 }).catch(() => undefined);
  }

  /** The GitHub repos (owner/name) whose worktrees sessions worked in over the last 90 days, GitHub's default log retention. */
  private async forgeRepos(): Promise<string[]> {
    const rows = (await this.record.raw(`SELECT DISTINCT worktree FROM sessions WHERE worktree IS NOT NULL AND last_seen > ${this.now() - 90 * DAY}`)) as { worktree: string }[];
    const origins = await Promise.all(rows.map(({ worktree }) => new Promise<string>((done) => execFile('git', ['-C', worktree, 'remote', 'get-url', 'origin'], { timeout: 2000 }, (error, out) => done(error ? '' : out.trim())))));
    return [...new Set(origins.flatMap((url) => /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/.exec(url)?.[1] ?? []))];
  }

  /** test.load: ten verdicts each in its own FULL commit, a checkpoint and a transcript backfill, as the hub would do them. */
  private async testLoad(params: Obj): Promise<Obj> {
    if (!this.options.vfs) throw new Refused(refusal('unknown_method', '/method', 'test.load is served only to a hub running under the test VFS.', 'test.load'));
    const verdicts = Number.isSafeInteger(params.verdicts) ? (params.verdicts as number) : 0;
    const template = (fixtures('verdict.made@1')[0] as Obj).data as Obj;
    for (let i = 0; i < verdicts; i++) {
      const ts = this.now();
      const id = ulid(ts);
      await this.append(this.connection('core'), { v: 1, id, kind: 'verdict.made', ts, data: { ...template, verdict: `verdict:${id}`, claim: `claim:${ulid(ts)}`, requirements: [] } as JsonValue });
    }
    // The test image has no WAL of its own: a checkpoint costs the hub one sync.
    if (params.checkpoint === true) this.durable.sync();
    let backfilled = 0;
    if (isObj(params.backfill)) backfilled = await this.backfill(params.backfill);
    return { done: true, verdicts, backfilled };
  }
  /** Reads a transcript and appends what its lines say, scrubbed: each prompt, and each turn's end; each once whatever the number of passes. */
  private async backfill(spec: Obj): Promise<number> {
    const session = String(spec.session ?? '');
    const agent = String(spec.agent ?? '');
    const handle = session.replace(/[^0-9A-Za-z]/g, '');
    const text = await readFile(String(spec.transcript), 'utf8');
    const appends: Promise<void>[] = [];
    let msg = 0;
    let turn = 0;
    let worked = false;
    let waited = 0;
    for (const [i, raw] of text.split('\n').entries()) {
      if (!raw) continue;
      let line: Obj;
      try {
        line = JSON.parse(raw) as Obj;
      } catch {
        continue;
      }
      if (!isObj(line.message) || (line.type !== 'user' && line.type !== 'assistant')) continue;
      const content = line.message.content;
      const parts = Array.isArray(content) ? content.filter(isObj) : [];
      const ts = Date.parse(String(line.timestamp)) || this.now();
      const id = derivedId(ts, `${session}:${String(line.uuid ?? i)}`);
      const connection = this.connection('hook', { session, agent });
      if (line.type === 'user') {
        // A person's prompt; a user line that only carries tool results is part of the turn.
        if (parts.length && parts.every((c) => c.type === 'tool_result')) continue;
        const said = typeof content === 'string' ? content : parts.flatMap((c) => (typeof c.text === 'string' ? [c.text] : [])).join('\n');
        appends.push(this.append(connection, { v: 1, id, kind: 'user.ask', ts, data: { msg: msg++, text: scrubText(said, { held: this.options.held }), tasks: [], from: 'person' } }, true));
      } else if (parts.some((c) => c.type === 'tool_use')) {
        worked = true;
      } else if (handle) {
        // An assistant message that calls no tool ends its turn.
        appends.push(this.append(connection, { v: 1, id, kind: 'agent.stop', subject: `session:${handle}`, ts, data: { turn: ++turn, did_work: worked } }, true));
        worked = false;
      }
      // Each thousand settle, and the stream's flush gets its turn, before the next are read: the stream carries
      // them while the backfill runs (#34).
      if (appends.length - waited >= 1000) {
        waited = appends.length;
        await Promise.allSettled(appends.slice(-1000));
        await new Promise((done) => setImmediate(done));
      }
    }
    await Promise.allSettled(appends);
    return appends.length;
  }


  // ---- Stop.

  /** A clean stop: in-flight runs stopped and recorded, the stop and its reason appended, the record closed FULL. */
  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    for (const timer of this.timers) clearInterval(timer);
    for (const live of this.live.values()) clearTimeout(live.quiet);
    for (const p of this.promises.values()) clearTimeout(p.timer);
    this.watcher?.close();
    for (const waits of [this.waiting, this.settling]) for (const set of [...waits.values()]) for (const wake of set) wake();
    try {
      await this.ready;
    } catch {
      return;
    }
    await this.replaying;
    await this.chain;
    this.writeCursors();
    this.canvasCore?.close();
    for (const { stop } of this.runs.values()) stop();
    // Each worktree's stack goes down with the hub, through the supervisor.
    await Promise.race([Promise.allSettled([...this.stackRuns].map((run) => this.takeDown(run))), new Promise((done) => setTimeout(done, 5000))]);
    // Each running job is stopped through the supervisor; one still stopping is reaped on the next start.
    const jobs = await this.runner.list().catch(() => [] as JobRecord[]);
    await Promise.race([Promise.allSettled(jobs.filter((j) => j.state === 'running' || j.state === 'waiting').map((j) => this.runner.cancel(j.job))), new Promise((done) => setTimeout(done, 5000))]);
    await this.runner.close();
    await Promise.race([Promise.allSettled([...this.runs.values()].map((r) => r.done)), new Promise((done) => setTimeout(done, 5000))]);
    await this.appendCore('hub.stopped', { reason }).catch(() => undefined);
    await this.extensions?.close();
    await this.supervisor.close();
    await this.record.close();
    this.writeState('stopped');
  }
}

/**
 * The record, killed with SIGKILL right after the append a test names (DEEP_HUB_TEST_CRASH): job.recorded, once a
 * job is recorded and before anything of it starts; job.started, once a job's process is tracked and before its
 * prompt is written. Only tests set it.
 */
/** The record, with its append replaced. */
function withAppend(record: RecordStore, append: RecordStore['append']): RecordStore {
  return new Proxy(record, {
    get: (target, key) => {
      if (key === 'append') return append;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * The record, each read it serves first logged to `file` as a JSON line: when it began, the method, and its SQL with
 * its bound values, or its arguments (DEEP_HUB_TEST_READS, #823). Only tests set it.
 */
function readsLogged(record: RecordStore, file: string): RecordStore {
  writeFileSync(file, '');
  const reads = new Set(['raw', 'read', 'table', 'session', 'resolve', 'startSlice', 'loadLearned']);
  return new Proxy(record, {
    get: (target, key) => {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      const bound = (value as (...a: unknown[]) => unknown).bind(target);
      if (typeof key !== 'string' || !reads.has(key)) return bound;
      return (...args: unknown[]) => {
        // A raw read's bound values follow its SQL, so a read of an ask names its ID whether the ID is in the text or bound.
        const query = key === 'raw' ? (Array.isArray(args[1]) && args[1].length ? `${String(args[0])} -- ${JSON.stringify(args[1])}` : args[0]) : JSON.stringify(args);
        appendFileSync(file, `${JSON.stringify({ at: Date.now(), via: key, query })}\n`);
        return bound(...args);
      };
    },
  });
}

/** The record, calling `appended` after each append it took, and waiting for what it returns. */
function streamed(record: RecordStore, appended: (input: EventInput) => Promise<unknown> | undefined): RecordStore {
  return withAppend(record, async (connection, input) => {
    const event = await record.append(connection, input);
    await appended(input);
    return event;
  });
}

function crashing(record: RecordStore, point: string): RecordStore {
  const jobs = new Set<string>();
  const append: RecordStore['append'] = async (connection, input) => {
    // `before:<kind>`: the hub dies before it appends an event of that kind, after what the call that appends it does next.
    if (point === `before:${input.kind}`) {
      await new Promise((done) => setTimeout(done, 50));
      process.kill(process.pid, 'SIGKILL');
    }
    // `slow:<kind>`: an event of that kind takes 300 ms to append.
    if (point === `slow:${input.kind}`) await new Promise((done) => setTimeout(done, 300));
    const event = await record.append(connection, input);
    const run = isObj(input.data) ? String(input.data.job ?? input.data.run) : '';
    if (input.kind === 'job.recorded') jobs.add(run);
    if ((point === 'job.recorded' && input.kind === 'job.recorded') || (point === 'job.started' && input.kind === 'process.tracked' && jobs.has(run))) process.kill(process.pid, 'SIGKILL');
    return event;
  };
  return withAppend(record, append);
}
