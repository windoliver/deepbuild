// The hub's core: the one writer to the record and the evidence store. It checks each hook against the
// session it claims, binds deep mcp calls to sessions, supervises check runs, replays deep-hook's spool, runs
// retention, and answers the socket's methods. It runs in a worker thread of its own, so a disk sync, a run's
// output or a backfill never holds up the event loop that acknowledges hooks.
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { chmod, mkdir, open, readFile, realpath, stat, type FileHandle } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shipped, type AdapterRegistry } from '@deepbuild/adapters';
import { openArchive } from '@deepbuild/archive';
import { AskRefused, openAsks, subjectKey, type Asks, type Delivery, type Resolver } from '@deepbuild/asks';
import { openLedger } from '@deepbuild/budget';
import { canonicalize, contextBoundFor, fixtures, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { openEvidenceStore, scrubText, type Evidence, type EvidenceStore, type Origin, type Peer, type PutResult } from '@deepbuild/evidence';
import { openExtensionHost, openTrust, type ExtensionHost } from '@deepbuild/extension-host';
import { openRecord, RecordError, type Connection, type EventInput, type RecordStore } from '@deepbuild/record';
import { evidence, judge, resolverDecisions } from '@deepbuild/resolver-decisions';
import { answers, composeKind, downStack, leaseKinds, newRun, portKind, upStack, type Stack, type Up } from '@deepbuild/env-local';
import { openLeases } from '@deepbuild/leases';
import { openRunner, type JobRecord, type JobSpec, type Runner, type WindowReport } from '@deepbuild/runner';
import { openSupervisor, type Grant, type Host, type Started, type Supervisor } from '@deepbuild/supervisor';
import { predictionContradictions, verdictLine, type Prediction, type RunOutcome } from '@deepbuild/verdicts';
import { parse as parseYaml } from 'yaml';
import { ASK_WAIT_MS, claudeSettings, CONTINUATION_CAP, installed, readJson, relations, restore, tampered, words } from './claude-settings.js';
import { confirmYou } from './confirm.js';
import { keychain, ownHome } from './keychain.js';
import { statusRows } from './status.js';
import { addGuards, writeStanding } from './guards.js';
import { AskTasks, type WorkItem } from './ask-tasks.js';
import { Holds } from './holds.js';
import { coveredBy, hubAdapters, parseLine, toolClasses, versionOf } from './hookmap.js';
import { briefing, commitsBetween, headOf, loadsOf } from './session-facts.js';
import { deepHook, repoOf, rootOf, type Root } from './paths.js';
import { aboutCall, aboutPermission, standingRules, type About } from './standing.js';
import { checkKey, Devices } from './trusted.js';
import { openIndex, pageClaims, search, type IndexFill } from './search.js';
import { Forge, parsePrUrl, prUrlIn } from './forge.js';
import { claimState, isStatusQuestion, newestClaim, statusAnswer, type ClaimState } from './verdict-chat.js';
import { checkArguments } from './tools.js';
import { copySynced, disk, synced, syncPath, testVfs, writeSynced, type Durable } from './vfs.js';
import { EXTENSION_HOOK_MS, refuse, Refused, refusal, signature, startOf, ulid, ulidTime, type CoreOptions, type Draft, type ExtensionReply, type Gated, type HookMeta, type Refusal } from './wire.js';

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
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
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
/** Every process's parent, from one `ps`: how the peer check walks up from a deep command to the agent above it. */
const parents = (): Promise<Map<number, number>> => new Promise((done) => {
  execFile('ps', ['-A', '-o', 'pid=,ppid='], { env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 << 20 }, (error, stdout) => {
    const map = new Map<number, number>();
    if (!error) for (const row of String(stdout).split('\n')) { const [pid, ppid] = row.trim().split(/\s+/).map(Number); if (pid && ppid) map.set(pid, ppid); }
    done(map);
  });
});

/** A process's arguments, or nothing once it is gone. */
const argsOf = (pid: number): Promise<string> => new Promise((done) => {
  execFile('ps', ['-o', 'args=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => done(error ? '' : String(stdout).trim()));
});

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
   * Messages typed while it works, read from its transcript's queue and not yet recorded; and the prompts recorded
   * from the queue, or from a UserPromptSubmit, that the other hasn't shown yet: each message is recorded once.
   */
  queued?: string[]; fromQueue?: string[]; prompted?: string[];
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
  calls: Map<string, { what: string; ended?: number }>; head?: string | undefined; reading?: Promise<void>;
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
}
/** An answered ask, as a route delivers it. */
interface Answer { id: string; session: string; question: string | null; options: string | null; answer: string | null }
/**
 * Where a session's transcript is judged from after a restart, and the calls whose hooks reached the hub past there;
 * for an ended session with turns still to judge, its agent too, since no hook of it comes again.
 */
interface Cursor { transcript: string; read: number; reached: string[]; ended?: { agent: string } }
/** A PreToolUse deep-hook stamped for a deep_* call, which one call of that session's deep mcp may bind to. */
interface Stamp { session: string; tool: string; digest: string }
/** A run the supervisor started, as the journal keeps it until its finish is durable; `environment`: it needs its folder's stack running. */
interface Run { run: string; check: string; claim: string; commit: string; argv: string[]; env: Record<string, string>; cwd: string; grant: Grant; environment?: boolean }
/** What a run gets when run.start names no grant: your files and programs, as you, in the sandbox all the same (Access: run-as-you). */
const RUN_AS_YOU: Grant = { run_as_you: true };
const GRANT_LISTS = ['read', 'write', 'hosts', 'sockets'] as const;

/** One events row as the record stores it, its seq read as text so no digit is lost. */
interface Row { v: number; id: string; kind: string; writer: string; actor: string; scope: string; ts: number; log_pos: number; data: string; evidence: string | null;
  subject: string | null; seq: string | null; session_id: string | null; project_id: string | null; agent: string | null; unverified: number }
const q = JSON.stringify;
/** An event's JSON text: the record's toJson fields, seq as its decimal string, and `verified` for the unverified mark. */
const eventText = (r: Row): string => `{"v":${r.v},"id":${q(r.id)},"kind":${q(r.kind)},"writer":${q(r.writer)},"actor":${q(r.actor)},"scope":${q(r.scope)},"ts":${r.ts},"log_pos":${r.log_pos},`
  + `"data":${r.data},"evidence":${r.evidence ?? '[]'}${r.subject === null ? '' : `,"subject":${q(r.subject)}`}${r.seq === null ? '' : `,"seq":${q(r.seq)}`}`
  + `${r.session_id === null ? '' : `,"session":${q(r.session_id)}`}${r.project_id === null ? '' : `,"project":${q(r.project_id)}`}${r.agent === null ? '' : `,"agent":${q(r.agent)}`},"verified":${r.unverified ? 'false' : 'true'}}`;

/** A ULID at `ms` whose random part is a hash of `key`, so the same source line always gets the same ID. */
const derivedId = (ms: number, key: string): string => ulid(ms, sha256Hex(new TextEncoder().encode(key)).slice(0, 20));

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
  private readonly devices: Devices;
  private store!: EvidenceStore;
  private supervisor!: Supervisor;
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
  /** The adapters, which read a prompt's origin and a stop's records from the transcript. */
  private adapters?: AdapterRegistry;
  /** The watch on Claude Code's user settings, and the readings it and the session-start recheck took. */
  private watcher: FSWatcher | undefined;
  private settingsKey = '';
  private readonly settingsReadings: string[] = [];
  /** Held stops, each woken when an answer for its session is ready to deliver. */
  private readonly waiting = new Map<string, Set<() => void>>();
  /** Each session's routes back into it, by session ID. */
  private readonly routes = new Map<string, Routes>();
  /** Answers handed to a waiter that no turn has shown yet, by ask ID. */
  private readonly handed = new Map<string, { session: string; at: number; timer: NodeJS.Timeout }>();
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
  /** resolver-decisions with no ledger, asked whether a saved decision covers a prompt before anything is raised (#23). */
  private precheck!: Resolver;

  /**
   * `asking` hears the sessions with an ask still to deliver whenever that set changes, so the event loop holds a stop
   * only where an answer may come back through it (#19: right after install no stop is held for anything else).
   */
  constructor(private readonly options: CoreOptions, private readonly emit: (sub: string, event: string) => void, private readonly asking: (sessions: string[], judged: string[]) => void = () => undefined) {
    this.root = rootOf(options.root);
    this.now = () => options.clock.start + (Date.now() - options.clock.real);
    this.durable = options.vfs ? testVfs(options.vfs) : disk;
    this.devices = new Devices(this.root.devices);
    this.holds = new Holds({
      raw: (query) => this.record.raw(query), asks: () => this.asks, now: this.now, plant: options.plant, sorter: options.sorter,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
      pin: (cwd, question) => this.pinOf(cwd, question),
    });
    this.tasks = new AskTasks({
      raw: (query) => this.record.raw(query), asks: () => this.asks, now: this.now, plant: options.plant, drafts: options.drafts, work: options.work,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
      pin: (cwd, question) => this.pinOf(cwd, question), keep: (bytes, source) => this.keep(bytes, source), run: (r) => this.runApproved(r),
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
    // Every append reaches the stream, whoever appends it: the hub, the asks core, the supervisor or the leases.
    this.record = streamed(this.record, (kind) => {
      this.stream();
      if (kind.startsWith('ask.') || kind.startsWith('delivery.')) this.askingSoon();
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
    if (this.options.plant !== 'skip-default-at-deadline') this.timers.push(setInterval(() => void due().then((now) => (now ? asks.tick() : undefined)).catch(() => undefined), 1000));
    this.index = openIndex(this.root.wiki, this.options.index);
    this.index.catch(() => undefined);
    // Compose's own folder sits in the hub's, which no run writes: the files a compose stack runs are the hub's.
    const compose = this.compose = composeKind(join(this.root.dir, 'compose'));
    // env-local's port kind (#331): ports from 3000 up, each checked free before it is leased.
    const port = portKind({ free: this.options.plant !== 'env-leases-port-again' });
    // The kernel's one lease table (#237): env-local declares its kinds there with their free checks, the core its
    // cpu.slot, and the supervisor takes every run's keys through it.
    const leases = await openLeases({ record: this.record, now: this.now, ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}) });
    for (const kind of leaseKinds) await leases.declare('env-local', kind, [port, compose].find((k) => k.kind === kind.name)?.free);
    this.timers.push(setInterval(() => void leases.tick().catch(() => undefined), 1000));
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
    this.host = this.options.host
      ? ((await import(pathToFileURL(this.options.host).href)) as { default: (local: Host) => Host }).default(this.supervisor)
      : this.supervisor;
    this.timers.push(setInterval(() => void this.supervisor.tick().catch(() => undefined), 1000));
    const config = this.config();
    const ledger = await openLedger({ record: this.record, asks, now: this.now, price: async () => null });
    // resolver-decisions ships on by default (#23): your saved decisions, and the budgets you approved, answer the
    // asks they cover, each answer gated by the core.
    asks.registerResolver('resolver-decisions', resolverDecisions({ record: this.record, ledger }));
    this.precheck = resolverDecisions({ record: this.record });
    await this.syncStanding().catch(() => undefined);
    this.timers.push(setInterval(() => void this.judgeRules().catch(() => undefined), HOUR));
    // The runner reaps or reports what a crash cut, and ticks itself.
    this.runner = await openRunner({
      record: this.record, asks, supervisor: this.supervisor, ledger, now: this.now, root: this.root.dir, loginPath: config.loginPath, env: process.env, keychain,
      settings: { plan: { reserve_pct: config.reservePct }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    });
    // Every installed extension loads, sandboxed until a signed release lists it; one refused is named and left out.
    const trust = await openTrust({ record: this.record, now: this.now });
    const extensions = this.extensions = await openExtensionHost({ record: this.record, supervisor: this.supervisor, trust, home: this.root.dir, release: [], now: this.now, leases });
    for (const pkg of await extensions.installed()) {
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
    this.timers.push(setInterval(() => void this.retain().catch(() => undefined), DAY));
    // The transcript archive (#20) copies what the agents' cleanups would delete, and the CI runs of the GitHub repos
    // recent sessions worked in before the forge's retention deletes them: at start, then once an hour, one pass at a time.
    const env: Record<string, string | undefined> = { ...process.env };
    const repos: string[] = [];
    const archive = await openArchive({
      record: this.record, evidence: this.store, asks, adapters: shipped(), env, connection: this.connection('ext:deepbuild/archive'), now: this.now,
      held: () => this.options.held, forge: { api: this.options.forge ?? 'https://api.github.com', repos },
    });
    let archiving: Promise<void> | undefined;
    const archivePass = () => {
      archiving ??= (async () => {
        env.GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? (await ghToken());
        // With no token the forge's logs can't be read, so no run is asked for.
        repos.splice(0, repos.length, ...(env.GH_TOKEN ? await this.forgeRepos() : []));
        await archive.pass();
      })().catch((error: unknown) => { process.stderr.write(`deep hub: archive: ${error instanceof Error ? error.message : String(error)}\n`); }).finally(() => { archiving = undefined; });
    };
    archivePass();
    this.timers.push(setInterval(archivePass, HOUR));
    // While appends fail, a small synced write is tried every quarter second; the gates come back with it.
    this.timers.push(setInterval(() => { if (this.blocked && this.durable.probe(this.root.dir)) { this.blocked = undefined; this.replayLate(true); } }, 250));
    // Between session starts, a removed or weakened entry of ours in Claude Code's settings goes back at once.
    if (this.options.plant !== 'restores-at-session-start-only') this.watchSettings();
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
  private appendCore(kind: string, data: Obj, extra: { subject?: string; evidence?: string[] } = {}): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core'), { v: 1, id: ulid(ts), kind, ts, data: data as JsonValue, ...extra });
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
      const known = await this.record.raw(`SELECT json_extract(data, '$.late') AS late FROM events WHERE id = '${meta.id}' LIMIT 1`);
      if (known.length) {
        // Unless deep-hook gave up on an acknowledgement the hub sent just too late: the live copy is in the record
        // unmarked while deep-hook acted on its own, so the session says so rather than the fail-open going unseen.
        if (meta.late && Number((known[0] as { late?: unknown }).late) !== 1) return { settled: this.lateAnswered(meta, meta.late.matched) };
        return { settled: Promise.resolve() };
      }
    }
    // A call whose prompt went to you has run, live or replayed: offered back as a decision to save (#23).
    if (meta.event === 'PostToolUse' && meta.call) void this.offerBack(meta).catch(() => undefined);
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
      if (meta.event === 'SessionEnd') {
        session.ended = true;
        this.stamps = this.stamps.filter((stamp) => stamp.session !== session.id);
      }
      // A replayed PreToolUse was let through late; its call has run, so it stamps nothing a later call could bind.
      if (verified && meta.stamp && !replayed) this.stamps.push({ session: session.id, tool: meta.stamp.tool, digest: meta.stamp.digest });
    }
    const call = session && verified && drafts.length ? meta.toolUse : undefined;
    if (session && call) session.pending.set(call, (session.pending.get(call) ?? 0) + 1);
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
        const [row] = (await this.record.raw(`SELECT status FROM sessions WHERE id = '${sql(meta.session)}'`)) as { status: string | null }[];
        if (row?.status) live.state = row.status;
      }
    }
    if (session && verified && !replayed) this.queuedAsks(drafts, session);
    const count = this.counters.get(meta.session) ?? await this.counterOf(meta.session);
    const live = this.liveOf(meta);
    let claimed = false;
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
        if (draft.queued && count.prompt) count.prompt.opened ||= tasks.length > 0;
        else count.prompt = { person: data.from === 'person', opened: tasks.length > 0 };
        count.fresh = false;
        count.changed = false;
        const session = this.sessions.get(meta.session);
        if (session && verified) {
          for (const task_ref of tasks) opens.push(this.tasks.opened({ session: meta.session, agent: meta.agent, cwd: meta.cwd, thread: session.thread, task_ref, text: String(data.text), ...(item ? { item } : {}) }));
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
    this.follow(drafts, meta);
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
    // A stop the rule reads as a claim recomputes its tasks' definitions' hashes once the stop is in the record.
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
  private registry(): AdapterRegistry {
    return (this.adapters ??= hubAdapters());
  }
  /** A request line the adapters map, for a payload the core rebuilt from what the parser kept of the hook. */
  private mapped(meta: HookMeta, draft: Draft, payload: Obj, transcript: readonly Obj[]): Obj | undefined {
    const name = meta.agent === 'codex' ? 'codex' : 'claude';
    const adapter = this.registry().get(name);
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
        let from = foreign ? 'unknown' : String(this.mapped(meta, draft, { ...meta.fields }, entry ? [entry] : [])?.from ?? data.from);
        if (from === 'unknown' && !foreign && this.options.plant === 'unplaced-is-person') from = 'person';
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
      } else if (draft.kind === 'agent.stop') {
        await this.stopRecords(draft, meta, session);
        const loop = this.loopAt(live);
        if (loop) data.loop = loop;
      }
    }
  }

  /**
   * Messages typed while the agent works (#25), read from the transcript's queue at the session's next hook: each is
   * recorded as a prompt you typed, once, whichever of the queue and its UserPromptSubmit shows it first.
   */
  private queuedAsks(drafts: Draft[], session: Session): void {
    const met = (list: string[], text: string) => { const at = list.indexOf(text); if (at >= 0) list.splice(at, 1); return at >= 0; };
    const fromQueue = session.fromQueue ??= [];
    const prompted = session.prompted ??= [];
    const tasks = session.queuedTasks ??= [];
    const asked = drafts.findIndex((d) => d.kind === 'user.ask');
    if (asked >= 0) {
      const text = String(drafts[asked]!.data.text);
      if (met(fromQueue, text)) {
        const spliced = session.spliced ??= new Map();
        // The queue's drafts are taken in their order, like the messages: the same text twice is two tasks.
        const at = tasks.findIndex((d) => d.data.text === text);
        spliced.set(String(drafts[asked]!.id), { from: String(drafts[asked]!.data.from ?? 'unknown'), task: at >= 0 ? tasks.splice(at, 1)[0] : undefined });
        for (const id of spliced.keys()) { if (spliced.size <= 32) break; spliced.delete(id); }
        drafts.splice(asked, 1);
      } else prompted.push(text);
    }
    for (const raw of (session.queued ?? []).splice(0)) {
      const text = scrubText(raw, { held: this.options.held }).slice(0, 8192);
      if (met(prompted, text)) continue;
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
   * The transcript entries of the turn a prompt opened, from its own entry on. The core keeps the current turn's as
   * it reads them; a session it met after its prompt's entry was written (its first hook came late) is read here
   * from the transcript's last few MiB.
   */
  private async turnFrom(session: Session, promptId: string): Promise<Obj[]> {
    if (session.prompts.has(promptId)) return session.entries[0]?.promptId === promptId ? session.entries : [session.prompts.get(promptId)!];
    let tail = '';
    try {
      const handle = await open(session.transcript, 'r');
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, 4 * 1024 * 1024);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, size - length);
        tail = buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    } catch {
      return [];
    }
    const lines = tail.split('\n');
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
  private follow(drafts: Draft[], meta: HookMeta): void {
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
      } else if (draft.kind === 'agent.stop') {
        // A turn that ended on a block only you or a service can clear (a sign-in, a rate limit) leaves the session stuck.
        state = draft.data.outcome !== 'failed' ? 'finished' : draft.data.owner === 'you' || draft.data.owner === 'service' ? 'stuck' : 'failed';
      }
    }
    for (const [call, c] of live.calls) if (c.ended !== undefined && now - c.ended > CALL_GRACE) live.calls.delete(call);
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
      live.reading = (live.reading ?? Promise.resolve()).then(() => this.commits(meta, live)).catch(() => undefined);
    }
  }
  private attention(session: string, agent: string, state: string): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core', { session, agent }), { v: 2, id: ulid(ts), kind: 'session.attention', ts, subject: `session:${letters(session)}`, data: { state } }).catch(() => undefined);
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
   * name the session it forked. Anything else starts a thread of its own.
   */
  private async threadOf(session: Session, source: string | undefined): Promise<string> {
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
  /** The commits made in a session's worktree since its last hook, each recorded once under it. */
  private async commits(meta: HookMeta, live: Live): Promise<void> {
    const head = await headOf(meta.cwd).catch(() => undefined);
    if (!head) return;
    const before = live.head;
    live.head = head.sha;
    if (!before || before === head.sha) return;
    for (const sha of await commitsBetween(meta.cwd, before, head.sha)) {
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
    const rows = (await this.record.raw(`SELECT id, session_id, agent, data FROM events WHERE kind IN ('tool.before', 'tool.after') AND ts >= ${since} AND session_id IS NOT NULL AND (instr(data, '${sql(file)}') > 0 OR instr(data, '.claude/settings.json') > 0) ORDER BY log_pos`)) as { id: string; session_id: string; agent: string | null; data: string }[];
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
      this.routes.delete(meta.session);
      this.routes.set(meta.session, fresh);
    }
    const r = this.routesOf(meta.session, meta.cwd);
    r.covered = !meta.watchOnly;
    if (r.covered && !(this.options.plant === 'routes-kept-across-sessions' && r.shown.size)) r.shown.add(meta.event);
    if (meta.event === 'PreToolUse') {
      if (this.options.plant !== 'stop-count-never-resets') r.continued = 0;
      r.capped = false;
    }
    if (meta.event === 'SessionEnd') {
      if (this.options.plant !== 'waiter-outlives-session') r.waiter?.give({ exit: 'session ended' });
      this.routes.delete(meta.session);
    } else if (meta.event !== 'Stop' && meta.event !== 'SessionStart') r.busy = Math.max(r.busy, ulidTime(meta.id));
  }
  /** Claude Code's cap on stop-hook continuations in one turn, from its facts. */
  private cap(): number {
    const continuation = (this.registry().get('claude').facts as Obj).continuation;
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
    const rows = (await this.record.raw(`SELECT a.id, a.session_id AS session, a.question, a.options, a.answer FROM asks a WHERE a.status = 'answered' AND ${mine}
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.delivery = a.id AND d.outcome = 'delivered') ORDER BY a.answered`)) as Answer[];
    return rows.filter((row) => !this.handed.has(row.id) && !this.prompts.has(`ask:${row.id}`));
  }
  /** The answers as the agent reads them, each naming its ask. */
  private answerText(rows: Answer[]): string {
    const lines = rows.map((row) => {
      const chosen = row.answer === null ? null : JSON.parse(row.answer) as unknown;
      const options = row.options === null ? [] : JSON.parse(row.options) as { id: string; label: string }[];
      const label = options.find((o) => o.id === chosen)?.label;
      return `Your answer to ask:${row.id}${row.question ? ` ("${row.question}")` : ''}: ${label ? `${label} (${String(chosen)})` : String(chosen)}.`;
    });
    return `DeepBuild delivers your answers:\n${lines.join('\n')}`;
  }
  private outcome(ask: string, via: string, outcome: 'delivered' | 'stalled'): Promise<void> {
    return this.appendCore('delivery.outcome', { delivery: `ask:${ask}`, via, outcome }, { subject: `ask:${ask}` }).catch(() => undefined);
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
    // A session with a send-back planted for its next stop has that stop held too (#25).
    const planted = [...this.routes].filter(([, r]) => r.sendBacks.length).map(([id]) => id);
    const sessions = [...new Set([...rows.map((r) => r.session_id), ...planted])].sort();
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
    const idle = () => r.waiter !== undefined && !r.holding && r.busy < r.waiter.since;
    if (!r.covered || !r.shown.has('waiter') || r.capped || r.wakes === false || !idle()) return;
    void this.queue(async () => {
      const waiter = r.waiter;
      if (!waiter || !idle()) return;
      const rows = await this.waitingFor(session);
      if (!rows.length) return;
      if (this.options.plant === 'waiter-checks-every-5s') {
        // The planted waiter asks every 5 s instead of being told.
        const due = 5000 - ((Date.now() - waiter.at) % 5000);
        setTimeout(() => this.offer(session), due).unref();
        if (due < 4900) return;
      }
      r.waiter = undefined;
      if (this.options.plant === 'waiter-never-wakes') return waiter.give({ exit: 'planted: never wakes' });
      waiter.give({ session, text: this.answerText(rows) });
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
    if ((prompt ?? '').includes(`ask:${ask}`) || await this.woken(session, ask)) {
      const r = this.routes.get(session);
      if (r) r.wakes = true;
      return this.outcome(ask, 'next_prompt', 'delivered');
    }
    await this.outcome(ask, 'next_prompt', 'stalled');
    const r = this.routes.get(session);
    // A route never seen working counts as absent: this session's answers wait for its next prompt.
    if (r && r.wakes !== true) r.wakes = false;
    await this.appendReading(session, this.sessions.get(session)?.agent ?? 'claude-code', `Claude Code didn't wake this session with your answer to ask:${ask}: its waiter handed it over and no turn started. The answer goes with the session's next prompt.`).catch(() => undefined);
  }
  /** Whether the transcript shows a turn carrying an ask's answer: a queued wake or a prompt naming it. */
  private async woken(session: string, ask: string): Promise<boolean> {
    const transcript = this.sessions.get(session)?.transcript;
    if (!transcript) return false;
    return (await this.tail(transcript, 1 << 20)).split('\n').some((l) => {
      if (!l.includes(`ask:${ask}`)) return false;
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
    // A cloud resource nobody can be asked about from here stays denied, as with the hub down.
    if (FOREIGN.has(meta.agent) || !meta.session) return call.decided?.includes('cloud-resource') ? { deny: 'DeepBuild blocked this: creating a cloud resource the plan doesn\'t name needs your standing rule or your answer, and this session can\'t be asked.' } : {};
    const held = await this.holds.gate(meta, call);
    if (held) return { held };
    // A dependency or a cloud resource the plan doesn't name: answered by your standing rule, or asked (#23).
    const about = call.decided?.length && call.command ? aboutCall(call.decided, call.command, homedir()) : undefined;
    return about ? this.holds.decide(meta, about) : {};
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
    if (!asked.decision) await this.asks.answer(as, asked.ask, { option: 'approve', plan_hash: null, token: `os-confirm:${ulid(this.now())}` }).catch((error: unknown) => { throw asRefused(error); });
    await this.syncStanding().catch(() => undefined);
    const [saved] = (await this.record.raw(`SELECT id, data FROM events WHERE kind = 'decision.created' AND subject = '${sql(asked.ask)}' ORDER BY log_pos DESC LIMIT 1`)) as { id: string; data: string }[];
    return { offer: handle, ask: asked.ask, decision: saved ? `decision:${saved.id}` : asked.decision ?? null, scope: saved ? String((JSON.parse(saved.data) as Obj).scope) : offer.scope };
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
    if (meta.event === 'SessionStart') {
      const brief = await briefing(meta.cwd);
      const answers = own && this.options.plant !== 'ended-answer-at-next-prompt'
        // The planted wrong program gives a new session the answers of every session that worked in its folder.
        ? await this.queue(async () => this.deliver(await this.waitingFor(meta.session, this.options.plant === 'ended-answer-to-worktree' ? `a.session_id IN (SELECT id FROM sessions WHERE worktree = '${sql(meta.cwd)}')` : undefined), 'next_prompt'))
        : undefined;
      // After a compaction or a resume, the open asks' requirement IDs again, in one short block.
      const open = own ? await this.tasks.brief(meta.session, this.sessions.get(meta.session)?.thread) : undefined;
      const context = [brief, open, answers].filter(Boolean).join('\n\n');
      return context ? { context } : {};
    }
    if (!own) return {};
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
        const waiting = await this.waitingFor(meta.session);
        if (status && !waiting.length && !r.later.length) {
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
        const context = [answers, ...r.later.splice(0), landed && `DeepBuild: ${landed}`].filter(Boolean).join('\n\n');
        return { ...(context ? { context } : {}), ...(status ? { message: status } : {}) };
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
    try {
      // A stop the sorter answers "proceed" goes on at once: the proceed rides in its one reply with what else waits.
      const proceed = await this.holds.proceed(meta, until);
      if (proceed) {
        const delivered = await this.queue(async () => this.deliver(await this.waitingFor(meta.session), 'stop_hold'));
        block = [r.sendBacks.shift(), delivered, proceed].filter(Boolean).join('\n\n');
      } else block = await this.stopHold(meta, r, until);
    } finally {
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
    if (line && judged && Date.now() < until) judged.delivered = line;
    // Planted wrong program (#83 AC1 twin): the judged stop's reply carries no line.
    return { ...(block ? { block } : {}) };
  }
  /** A stop held while the agent left a question: what it is sent back with, or nothing. */
  private async stopHold(meta: HookMeta, r: Routes, until: number): Promise<string | undefined> {
    const session = meta.session;
    const open = async () => ((await this.record.raw(`SELECT 1 FROM asks WHERE session_id = '${sql(session)}' AND status IN ('open', 'later', 'answered') AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered') LIMIT 1`)) as unknown[]).length > 0;
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
    while (!this.stopping && Date.now() < until && await open()) {
      if (this.releases) {
        if ((await this.queue(() => this.waitingFor(session))).length) return undefined;
      } else {
        const block = await this.queue(async () => this.deliver(await this.waitingFor(session), 'stop_hold'));
        if (block) return block;
      }
      if (polls) await new Promise((done) => setTimeout(done, Math.min(250, Math.max(0, until - Date.now()))));
      else await this.answerOrTimeout(session, Math.min(until - Date.now(), 1000));
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
  /** A waiter whose connection closed: Claude Code stopped it, or it exited. */
  waiterGone(key: number): void {
    if (this.options.plant === 'delivered-to-dead-waiter') return;
    for (const r of this.routes.values()) if (r.waiter?.key === key) r.waiter = undefined;
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
    const [prompt] = live.turnTask ? [] : (await this.record.raw(`SELECT json_extract(data, '$.tasks[0]') AS task FROM events WHERE session_id = '${sql(meta.session)}' AND kind = 'user.ask' AND json_extract(data, '$.from') = 'person' AND json_extract(data, '$.tasks[0]') IS NOT NULL ORDER BY log_pos DESC LIMIT 1`)) as { task: string | null }[];
    const task_ref = live.turnTask ?? prompt?.task ?? `session:${letters(meta.session)}#0`;
    const [before] = (await this.record.raw(`SELECT COUNT(*) AS n FROM claims WHERE session_id = '${sql(meta.session)}' AND subject_ref = '${sql(task_ref)}'`)) as { n: number }[];
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
    const rows = (await this.record.raw(`SELECT id, agent, worktree FROM sessions WHERE status NOT IN ('finished', 'failed') AND id IN (${[...this.cursors.keys()].map((id) => `'${sql(id)}'`).join(', ') || "''"})`).catch(() => [])) as { id: string; agent: string | null; worktree: string | null }[];
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
    const [seen] = await this.record.raw(`SELECT 1 FROM events WHERE session_id = '${sql(session)}' AND kind = 'session.reading' AND json_extract(data, '$.reading') = '${sql(reading)}' LIMIT 1`);
    if (!seen) await this.appendReading(session, agent, reading);
  }
  /** The pull request a session opened, as its readings record it: the newest. */
  private async prOf(session: string | null): Promise<string | undefined> {
    if (!session) return undefined;
    const [row] = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS reading FROM events WHERE session_id = '${sql(session)}' AND kind = 'session.reading' AND json_extract(data, '$.reading') LIKE 'Opened pull request %' ORDER BY log_pos DESC LIMIT 1`)) as { reading: string }[];
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
      const [row] = (await this.record.raw(`SELECT json_extract(data, '$.from') AS f FROM events WHERE id = '${sql(meta.id)}'`)) as { f: string | null }[];
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
    const [stop] = (await this.record.raw(`SELECT MAX(ts) AS at FROM events WHERE session_id = '${sql(meta.session)}' AND kind = 'agent.stop'`)) as { at: number | null }[];
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
    const [row] = (await this.record.raw(`SELECT commit_sha FROM claims WHERE id = '${sql(claim.slice(6))}'`)) as { commit_sha: string | null }[];
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
  private answerOrTimeout(session: string, ms: number): Promise<void> {
    return new Promise((done) => {
      const set = this.waiting.get(session) ?? new Set();
      this.waiting.set(session, set);
      const wake = () => { clearTimeout(timer); set.delete(wake); done(); };
      const timer = setTimeout(wake, Math.max(0, ms));
      set.add(wake);
    });
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
    const known = await this.record.raw(`SELECT 1 FROM events WHERE kind = 'session.reading' AND instr(json_extract(data, '$.reading'), '${meta.id}') > 0 LIMIT 1`);
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
          // A message typed while the agent works waits in the queue, with no hook until it is dequeued (#80).
          if (isObj(line) && line.type === 'queue-operation' && line.operation === 'enqueue' && typeof line.content === 'string' && !line.content.includes('<task-notification>')) (session.queued ??= []).push(line.content);
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

  /** A process's start time, or undefined when it can't be read. Read in this worker, never on the event loop. */
  private startOf(pid: number, fresh = false): Promise<string | undefined> {
    const known = this.starts.get(pid);
    if (known && !fresh) return known;
    const read = startOf(pid);
    this.starts.set(pid, read);
    return read;
  }

  /**
   * Whether an event can be checked against the session it claims: its transcript under its agent's home, its
   * working folder and its process tree (its hook's parent, by PID and start time) all as the session's own
   * hooks established them. The first checked event of a session establishes it.
   */
  private async verify(meta: HookMeta): Promise<boolean> {
    if (!meta.session || !meta.cwd || !isAbsolute(meta.transcript)) return false;
    const home = meta.agent === 'codex' ? join(homedir(), '.codex', 'sessions') : join(homedir(), '.claude', 'projects');
    const transcript = resolve(meta.transcript);
    if (!isUnder(transcript, home)) return false;
    const start = await this.startOf(meta.ppid);
    if (!start) return false;
    const session = this.sessions.get(meta.session);
    if (!session) {
      // A session the last hub met is read from where that hub left it; one this hub meets first, from here on:
      // what its transcript held before isn't judged.
      const cursor = this.cursors.get(meta.session);
      this.cursors.delete(meta.session);
      const left = cursor?.transcript === transcript && typeof cursor.read === 'number' && Array.isArray(cursor.reached) ? cursor : undefined;
      const read = left ? left.read : await stat(transcript).then((s) => s.size, () => 0);
      this.sessions.set(meta.session, { id: meta.session, thread: meta.session, agent: meta.agent, pid: meta.ppid, start, cwd: meta.cwd, transcript, ended: false, read, turn: undefined, closed: [], reached: new Set(left?.reached), pending: new Map(), prompts: new Map(), entries: [] });
      // A session's first cursor is written at once: a restart before it would read the session from its end.
      this.writeCursors();
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
      return served.length === 1 ? served[0]!.id : null;
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
      case 'hub.health': return this.health();
      case 'session.wait': return this.waitAnswer(params, context);
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
      case 'device.pair': return this.pair(params);
      case 'extension.install': return this.install(params, context);
      case 'you.confirm': return this.confirmCommand(params, context);
      case 'status.read': return this.reflecting(async () => ({ rows: await statusRows((sql) => this.record.raw(sql), this.now()) }));
      case 'guard.add': return this.addGuard(params, context);
      case 'evidence.paste': return this.paste(params);
      case 'run.start': return this.runStart(params);
      case 'test.load': return this.testLoad(params);
      case 'record.backup': return this.backup(params);
      case 'env.up': return this.envUp(params);
      case 'env.down': return this.envDown(params);
      case 'job.submit': return this.runner.submit(params.spec as JobSpec);
      case 'job.status': return this.runner.status(String(params.job));
      case 'job.list': return { jobs: await this.runner.list() };
      case 'job.output': return { stdout: await this.runner.output(String(params.job)) };
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
      // ledger.db names a whole backup only once all of it is on disk, and lasts once its folder is synced.
      await synced(folder);
      renameSync(partial, ledger);
    } catch (error) {
      rmSync(partial, { force: true });
      for (const [, name] of copies) rmSync(join(folder, name), { recursive: true, force: true });
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
    return { gates: { watch_only: this.blocked !== undefined, reason: this.blocked ?? null }, secrets: await this.secretStore(), network, claude };
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
  private async page(after: number, limit: number): Promise<{ log_pos: number; json: string }[]> {
    const rows = (await this.record.raw(`SELECT v, id, kind, writer, actor, scope, ts, log_pos, data, evidence, subject, CAST(seq AS TEXT) AS seq, session_id, project_id, agent, unverified FROM events WHERE log_pos > ${after} ORDER BY log_pos LIMIT ${limit}`)) as Row[];
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
    const ahead = this.ahead?.after === after && this.ahead.limit === limit ? this.ahead : undefined;
    this.ahead = undefined;
    let out: { log_pos: number; events: string };
    if (ahead) {
      await Promise.allSettled([...this.inflight]);
      out = { log_pos: ahead.log_pos, events: ahead.events };
    } else {
      const read = await this.reflecting(async () => ({ events: await this.page(after, limit) }));
      const events = read.events as { log_pos: number; json: string }[];
      out = { log_pos: events.length === limit ? events[limit - 1]!.log_pos : Math.max(after, read.log_pos as number), events: `[${events.map((e) => e.json).join(',')}]` };
    }
    // History is paged in order: the next full page is built while the reader takes this one. A full page never
    // changes once committed, since log positions only grow and a gap never fills.
    if (out.events !== '[]') {
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
      const [claim] = await this.record.raw(`SELECT * FROM claims WHERE id = '${id}'`);
      if (!claim) throw new Refused(refusal('not_found', '/params/id', `No change claim:${id} in the record.`, params.id));
      const runs = await this.record.raw(`SELECT * FROM runs WHERE claim_id = '${id}' ORDER BY started`);
      const verdicts = await this.record.raw(`SELECT * FROM verdicts WHERE claim_id = '${id}' ORDER BY created`);
      const state = (await this.stateOf(`claim:${id}`))!;
      const line = verdictLine(state.state);
      const url = await this.prOf(state.session);
      const pr = url ? parsePrUrl(url) : undefined;
      const forge = pr ? new Forge(this.options.forge ?? 'https://api.github.com', process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken()) : undefined;
      const pulled = pr && forge ? await forge.pull(pr) : undefined;
      const files = state.session ? ((await this.record.raw(`SELECT path FROM session_files WHERE session = '${sql(state.session)}' AND kind IN ('edit', 'write') ORDER BY last`)) as { path: string }[]).map((r) => r.path) : [];
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
    return {
      asks: (await this.asks.inbox()).map((row) => {
        const text = texts.get(row.ask.slice(4));
        return { ...row, question: text?.question ?? '', options: text?.options ? (JSON.parse(text.options) as { id: string }[]).map((o) => o.id) : [] };
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
    const [row] = (await this.record.raw(`SELECT e.session_id AS session, e.project_id AS project, e.data AS data, a.status AS status FROM events e JOIN asks a ON a.id = e.id WHERE e.id = '${handle.slice(4)}' AND e.kind = 'ask.created'`)) as { session: string | null; project: string | null; data: string; status: string }[];
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
    await answered();
    // The asks core saved an option you chose for the ask's repo, or its session, never wider than its card showed.
    const [saved] = (await this.record.raw(`SELECT data FROM events WHERE kind = 'decision.created' AND subject = '${handle}' ORDER BY log_pos DESC LIMIT 1`)) as { data: string }[];
    const answer = chosen?.id ?? String(input.words);
    await this.syncStanding().catch(() => undefined);
    return { ask: handle, answer, scope: saved ? String((JSON.parse(saved.data) as Obj).scope) : null };
  }
  /** asks/:id/undo, from the app or `deep inbox undo`: a defaulted ask opens again, once the trusted path allows it. */
  private async undo(params: Obj, context: CallContext): Promise<Obj> {
    const handle = params.ask;
    if (typeof handle !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/ask', 'Name the ask by its handle, ask:<id>.', handle));
    const [row] = (await this.record.raw(`SELECT question, status FROM asks WHERE id = '${handle.slice(4)}'`)) as { question: string; status: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/ask', `No ask ${handle}; undo the default of an ask the inbox holds.`, handle));
    if (row.status !== 'defaulted') throw new Refused(refusal('not_found', '/params/ask', `${handle} didn't take its default (it's ${row.status}), so there's nothing to undo.`, handle));
    await this.trusted(params, context, `undo the default “${row.question.slice(0, 120)}” took`, handle);
    await this.asks.undo(this.connection(context.role === 'app' ? 'app' : 'cli'), handle).catch((error: unknown) => { throw asRefused(error); });
    const [open] = (await this.record.raw(`SELECT deadline FROM asks WHERE id = '${handle.slice(4)}'`)) as { deadline: number }[];
    return { ask: handle, deadline: open?.deadline ?? null };
  }
  /** decisions/:id/overrule: a saved decision taken out of force, on the trusted path alone. */
  private async overrule(params: Obj, context: CallContext): Promise<Obj> {
    const id = typeof params.decision === 'string' && /^decision:[0-9A-Za-z]+$/.test(params.decision) ? params.decision : undefined;
    if (!id) throw new Refused(refusal('pattern', '/params/decision', 'Name the decision as decision:<id>.', params.decision));
    const [row] = (await this.record.raw(`SELECT answer, state FROM decisions WHERE id = '${id.slice(9)}'`)) as { answer: string; state: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/decision', `No decision ${id} in the record.`, id));
    if (row.state === 'revoked') return { overruled: id };
    await this.trusted(params, context, `overrule the saved decision ${row.answer}`, id);
    await this.appendCore('decision.overruled', { decision: id }, { subject: id });
    await this.syncStanding().catch(() => undefined);
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
      // After a `/clear` the process's session is its newest one.
      const session = [...this.sessions.values()].filter((s) => s.pid === pid).at(-1);
      if (session && (await this.startOf(pid, true)) === session.start) return session.id;
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
      // A call bound to no session still reads what belongs to no session; every other tool needs its session.
      const session = await this.queue(async () => this.bind(tool, sent, context, tool !== 'deep_status' && tool !== 'deep_search'));
      switch (tool) {
        case 'deep_status': return await this.status(session);
        case 'deep_search': return await this.find(String(args.query), session, context);
        case 'deep_ask': return await this.askFor(session!, args);
        case 'deep_wait': return await this.waitFor(session!, String(args.ask));
        case 'deep_open_item': return await this.openItem(session!, String(args.text));
        case 'deep_claim': return await this.claim(session!, args);
        case 'deep_evidence': return await this.attach(session!, args);
        case 'deep_propose': return await this.propose(session!, args);
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
  /** The connection a session's deep mcp writes through: writer mcp:<session>, from the binding, never the call. */
  private agentConnection(session: string): Connection {
    const agent = this.sessions.get(session)?.agent;
    return this.connection(`mcp:${session}`, { session, ...(agent ? { agent } : {}) });
  }

  /** deep_status: the gates, and for a bound session its newest claims, each with its runs, its verdict and its contradictions. */
  private async status(session: string | undefined): Promise<Obj> {
    const gates = { watch_only: this.blocked !== undefined, reason: this.blocked ?? null };
    if (!session) return { session: null, gates, claims: [] };
    const made = (await this.record.raw(`SELECT id, data FROM events WHERE session_id = '${sql(session)}' AND kind = 'claim.made' ORDER BY log_pos DESC LIMIT 10`)) as { id: string; data: string }[];
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
      const [verdict] = (await this.record.raw(`SELECT handle, outcome, smallest, points_to FROM verdicts WHERE claim_id = '${row.id}' AND stale = 0 ORDER BY created DESC LIMIT 1`)) as Obj[];
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
    const [project] = session ? (await this.record.raw(`SELECT project_id FROM sessions WHERE id = '${sql(session)}'`)) as { project_id: string | null }[] : [];
    const scopes = new Set(session ? [`session:${letters(session)}`, 'all', ...(project?.project_id ? [`repo:${letters(project.project_id)}`] : [])] : []);
    const covers = (scope: string): boolean => everyone || (session ? scopes.has(scope) : scope === 'all' || scope.startsWith('repo:'));
    return search({
      query, index: await this.wikiIndex(), raw: (q) => this.record.raw(q), worktree, session: everyone ? { everyone: true } : session, covers,
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
  /** The checks a worktree's spec names, by name, with the command each runs. */
  private checksOf(worktree: string): Map<string, string> {
    let spec: unknown;
    try { spec = parseYaml(readFileSync(join(worktree, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return new Map(); }
    const checks = isObj(spec) && isObj(spec.checks) ? spec.checks : {};
    return new Map(Object.entries(checks).flatMap(([name, c]) => (isObj(c) && typeof c.run === 'string' ? [[name, c.run] as [string, string]] : [])));
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
    const subject = kind === 'choice' && typeof about.point === 'string' ? { point: about.point }
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
    const [row] = (await this.record.raw(`SELECT deadline, created FROM asks WHERE id = '${sql(handle.slice(4))}'`)) as { deadline: number | null; created: number | null }[];
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
  private askWait(): number {
    return relations(this.root.dir).find((r) => r.name === 'deep_ask')?.holds === false ? 0 : ASK_WAIT_MS;
  }
  private async waitFor(session: string, handle: string): Promise<Obj> {
    const until = Date.now() + this.askWait();
    for (;;) {
      const [row] = (await this.record.raw(`SELECT session_id, status, answer, deadline, default_option FROM asks WHERE id = '${sql(handle.slice(4))}'`)) as { session_id: string | null; status: string; answer: string | null; deadline: number; default_option: string | null }[];
      if (!row || row.session_id !== session) throw refuse('not_found', '/params/arguments/ask', 'Wait on an ask this session raised, by the handle deep_ask returned.', handle);
      if (row.status !== 'open' && row.status !== 'later') return { ask: handle, status: row.status, answer: row.answer === null ? null : JSON.parse(row.answer) };
      if (this.stopping) throw refuse('unavailable', '', 'The hub is stopping, and nothing was answered; wait on the ask again once it is back.', handle, true);
      if (Date.now() >= until) return { ask: handle, status: 'waiting', answer: null, deadline: row.deadline, default: row.default_option === null ? null : JSON.parse(row.default_option) };
      await new Promise((done) => setTimeout(done, 100));
    }
  }

  /** deep_open_item: an open item on the session's newest claim's task, or else on the message it works on. */
  private async openItem(session: string, text: string): Promise<Obj> {
    const [claim] = (await this.record.raw(`SELECT data FROM events WHERE session_id = '${sql(session)}' AND kind = 'claim.made' ORDER BY log_pos DESC LIMIT 1`)) as { data: string }[];
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
    const command = this.checksOf(cwd).get(String(args.check));
    if (command === undefined) throw this.unknownCheck(cwd, args.check);
    const which = args.claim === null ? '' : `AND id = '${sql(String(args.claim).slice(6))}'`;
    const [claim] = (await this.record.raw(`SELECT id, data FROM events WHERE session_id = '${sql(session)}' AND kind = 'claim.made' ${which} ORDER BY log_pos DESC LIMIT 1`)) as { id: string; data: string }[];
    if (!claim) throw refuse('not_found', '/params/arguments/claim', 'Run a check for a claim this session made: claim first with deep_claim.', args.claim);
    const commit = String((JSON.parse(claim.data) as Obj).commit);
    const { run } = await this.runStart({ check: args.check, claim: `claim:${claim.id}`, commit, argv: ['/bin/sh', '-c', command], cwd });
    // The run's outcome once it finishes, so the agent needn't poll; past the wait, that it's still running.
    const until = Date.now() + this.askWait();
    for (;;) {
      const [done] = (await this.record.raw(`SELECT data FROM events WHERE kind = 'run.finished' AND subject = '${sql(String(run))}' LIMIT 1`)) as { data: string }[];
      if (done) {
        const d = JSON.parse(done.data) as { outcome: string; evidence: string[] };
        return { run, claim: `claim:${claim.id}`, outcome: d.outcome, evidence: d.evidence.map((sha) => `ev:${sha}`) };
      }
      if (this.stopping || Date.now() >= until) return { run, claim: `claim:${claim.id}`, outcome: 'running', evidence: [] };
      await new Promise((wake) => setTimeout(wake, 100));
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
  /** A drafted check's bytes as approved at its definition's lock, kept by digest for the claim's checks to run. */
  private async keep(bytes: Uint8Array, source: string): Promise<string> {
    const put = await this.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind: 'file', source, redaction: 'unknown', license: { name: 'session', allows: [] } });
    return (await this.stored(put, source)).sha256;
  }
  /**
   * A claim's check, run from its approved bytes: read from the evidence store, checked against their digest, and
   * written once under the hub's root by that digest, so a change to the file in the session's folder never runs.
   */
  private async runApproved(r: { claim: string; check: string; approved: string; commit: string; cwd: string }): Promise<void> {
    let script = join(this.root.dir, 'checks', r.approved);
    if (this.options.plant === 'runs-disk-bytes') script = join(r.cwd, r.check);
    else if (!existsSync(script)) {
      mkdirSync(join(this.root.dir, 'checks'), { recursive: true, mode: 0o700 });
      writeFileSync(`${script}.tmp`, await this.store.read(r.approved), { mode: 0o500 });
      renameSync(`${script}.tmp`, script);
    }
    await this.runStart({ check: r.check, claim: r.claim, commit: r.commit, argv: ['/bin/sh', script], cwd: r.cwd });
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
    const [row] = session ? await this.record.raw(`SELECT MAX(json_extract(data, '$.msg')) AS msg FROM events WHERE session_id = '${sql(session)}' AND kind = 'user.ask'`).catch(() => []) as { msg: number | null }[] : [];
    // The newest prompt stands for the turn's: a mid-turn message after the one that opened a task reads, until
    // the next prompt, as a prompt that opened none.
    const [prompt] = session ? await this.record.raw(`SELECT json_extract(data, '$.from') AS f, json_extract(data, '$.tasks[0]') AS task, log_pos FROM events WHERE session_id = '${sql(session)}' AND kind = 'user.ask' ORDER BY log_pos DESC LIMIT 1`).catch(() => []) as { f: string | null; task: string | null; log_pos: number }[] : [];
    const [started] = prompt ? await this.record.raw(`SELECT 1 AS one FROM events WHERE session_id = '${sql(session)}' AND kind = 'session.start' AND log_pos > ${prompt.log_pos} LIMIT 1`).catch(() => []) as { one: number }[] : [];
    // The turn's work since its last boundary (its prompt, its last stop or a start), so a turn a hub restart
    // interrupted is judged at its stop as the rule reads it (#83): a tool call, and one that may have changed code.
    const [boundary] = session ? await this.record.raw(`SELECT MAX(log_pos) AS at FROM events WHERE session_id = '${sql(session)}' AND kind IN ('user.ask', 'agent.stop', 'session.start')`).catch(() => []) as { at: number | null }[] : [];
    const calls = boundary?.at !== null && boundary?.at !== undefined ? (await this.record.raw(`SELECT json_extract(data, '$.kind') AS k FROM events WHERE session_id = '${sql(session)}' AND kind = 'tool.after' AND log_pos > ${boundary.at}`).catch(() => [])) as { k: string | null }[] : [];
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

  private async runStart(params: Obj): Promise<Obj> {
    const { check, claim, commit, argv, env = {}, cwd = process.cwd(), grant = RUN_AS_YOU, environment = false } = params;
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
    });
    return { run };
  }

  /** Starts a run through the host, sandboxed, with the hub's run token injected; its output becomes scrubbed evidence. */
  private async launch(run: Run): Promise<string> {
    this.writeJournal((runs) => { runs[run.run] = run; });
    await this.appendCore('run.started', { run: run.run, check: run.check, claim: run.claim, commit: run.commit }, { subject: run.run });
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
        ? upStack(this.host, { run: stackRun, folder: run.cwd, compose: this.compose, sharedProject: this.options.plant === 'compose-default-project' }).catch((error: Error) => ({ status: 'BLOCKED' as const, run: stackRun, cause: error.message }))
        : Promise.resolve(undefined);
      const started = stack.then<Started | { run: string; status: 'missing'; cause: string }>((up) => {
        if (up?.status === 'BLOCKED') return { run: run.run, status: 'missing', cause: up.cause };
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
    const done = ended.then(async ({ code, failed, missing }) => {
      // What the run left behind is stopped and its leases released before its finish is recorded.
      if (this.options.plant !== 'run-spawns-itself') await this.supervisor.cleanup(run.run).catch(() => undefined);
      await writes;
      const evidence: string[] = [];
      for (const sink of sinks) {
        const put = await sink.close();
        if (put.status === 'stored') evidence.push((await this.stored(put, `${run.run}'s output`)).sha256);
      }
      const outcome = this.stopping ? 'stopped' : missing ? 'missing' : code === 0 ? 'passed' : 'failed';
      const findings = this.stopping ? ['hub stopped'] : missing ? [`its stack never came up: ${missing}`] : failed ? [failed] : [];
      await this.finish(run, outcome, findings, evidence);
    });
    this.runs.set(run.run, { run, done, stop });
    void done.finally(() => this.runs.delete(run.run));
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
    const recorded = async (kind: string, run: string) => (await this.record.raw(`SELECT 1 FROM events WHERE kind = '${kind}' AND json_extract(data, '$.run') = '${run.replace(/'/g, "''")}' LIMIT 1`)).length > 0;
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
  /** Signals a stack run down through the host, then the supervisor stops what's left of it and releases its leases. */
  private async takeDown(run: string): Promise<{ stopped: number[]; left: string[] }> {
    try {
      await downStack(this.host, run);
      return await this.supervisor.cleanup(run);
    } finally {
      this.stackRuns.delete(run);
    }
  }
  private envUp(params: Obj): Promise<Obj> {
    const worktree = this.worktreeOf(params);
    return this.inTurn(worktree, () => this.riseIn(worktree));
  }
  private async riseIn(worktree: string): Promise<Obj> {
    const running = this.stacks.get(worktree);
    // A stack is reused only while its process runs and its health route still answers 200.
    if (running && (await this.supervisor.status(running.run)).state === 'running' && (await answers(running))) return { status: 'ready', run: running.run, worktree, ports: running.ports, ...(running.project ? { project: running.project } : {}) };
    // Any other is taken down, and a new one started.
    if (running) {
      this.stacks.delete(worktree);
      await this.takeDown(running.run).catch(() => undefined);
    }
    if (this.stopping) return { status: 'BLOCKED', worktree, cause: 'the hub is stopping' };
    const run = newRun(this.now());
    this.stackRuns.add(run);
    this.rising.set(worktree, run);
    const up = await upStack(this.host, { run, folder: worktree, compose: this.compose, sharedProject: this.options.plant === 'compose-default-project' })
      .catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }))
      .finally(() => this.rising.delete(worktree));
    if (up.status === 'BLOCKED') {
      // What it started is stopped and its leases released; a stack that never started has nothing to clean.
      await this.takeDown(run).catch(() => undefined);
      return { status: 'BLOCKED', worktree, cause: up.cause };
    }
    this.stacks.set(worktree, up.stack);
    return { status: 'ready', run, worktree, ports: up.stack.ports, ...(up.stack.project ? { project: up.stack.project } : {}) };
  }
  /**
   * Takes the worktree's stack down: signalled through the host, then the supervisor's cleanup stops what it can
   * prove is the run's and ends its leases once every recorded process is gone. A process it can't prove, or one
   * that was never recorded and still listens on a leased port, is reported with its PID and the port, never stopped.
   */
  private envDown(params: Obj): Promise<Obj> {
    const worktree = this.worktreeOf(params);
    // A stack still coming up is signalled down now: its up ends BLOCKED, and this down's turn follows it.
    const rising = this.rising.get(worktree);
    if (rising) void downStack(this.host, rising);
    return this.inTurn(worktree, () => this.downIn(worktree, rising));
  }
  private async downIn(worktree: string, interrupted?: string): Promise<Obj> {
    const stack = this.stacks.get(worktree);
    // The up it interrupted took its own stack down and cleaned it up.
    if (!stack && interrupted) return { run: interrupted, stopped: [], left: [] };
    if (!stack) throw new Refused(refusal('not_found', '/params/worktree', `No stack runs for ${worktree}; start one with deep env up.`, worktree));
    const ports = Object.values(stack.ports);
    const recorded = (await this.record.raw(`SELECT DISTINCT json_extract(data, '$.pid') AS pid FROM events WHERE kind = 'process.tracked' AND json_extract(data, '$.run') = '${stack.run}'`) as { pid: number }[]).map((r) => r.pid);
    const before = recorded.filter(running);
    // The planted wrong program stops whatever listens on the leased ports, the run's or not.
    if (this.options.plant === 'env-kills-by-port') for (const port of ports) for (const pid of await listening(port)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    this.stacks.delete(worktree);
    const cleaned = await this.takeDown(stack.run);
    const stopped = [...new Set([...before.filter((pid) => !running(pid)), ...cleaned.stopped])];
    const left = new Map<number, { pid: number; port?: number }>();
    for (const name of cleaned.left) if (name.startsWith('pid:')) left.set(Number(name.slice(4)), { pid: Number(name.slice(4)) });
    for (const port of ports) for (const pid of await listening(port)) left.set(pid, { pid, port });
    return { run: stack.run, stopped, left: [...left.values()] };
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
          const known = await this.record.raw(`SELECT 1 FROM events WHERE kind = 'spool.refused' AND json_extract(data, '$.file') = '${name.replace(/'/g, "''")}' AND json_extract(data, '$.offset') = ${offset} LIMIT 1`);
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
    this.watcher?.close();
    for (const set of this.waiting.values()) for (const wake of set) wake();
    try {
      await this.ready;
    } catch {
      return;
    }
    await this.replaying;
    await this.chain;
    this.writeCursors();
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

/** The record, calling `appended` after each append it took. */
function streamed(record: RecordStore, appended: (kind: string) => void): RecordStore {
  return withAppend(record, async (connection, input) => {
    const event = await record.append(connection, input);
    appended(input.kind);
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
