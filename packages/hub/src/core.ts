
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

import { UsageTail } from '@deepbuild/readings';
import { Numbers } from './numbers.js';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTERS } from '@deepbuild/adapters';
import { openAsks, type Asks } from '@deepbuild/asks';
import { openLedger, type Ledger } from '@deepbuild/budget';
import { canonicalize, contextBoundFor, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import { openEvidenceStore, scrubText, type EvidenceStore } from '@deepbuild/evidence';
import { openExtensionHost, openTrust, type ExtensionHost, type ProjectTrust } from '@deepbuild/extension-host';
import { openRecord, RecordError, type Connection, type EventInput, type Message, type RecordStore } from '@deepbuild/record';
import type { DecisionsProvider } from './decisions-port.js';
import type { EnvironmentProvider, ComposeResource } from './environment-port.js';
import { openCheckouts, type Checkouts, type TaskListFacts } from '@deepbuild/gate';

import { openLeases, SLOW_SLOT, type LeaseTable } from '@deepbuild/leases';
import { Acceptance } from './acceptance.js';
import { Landing } from './landing.js';
import { openRunner, type JobRecord, type JobSpec, type Runner } from '@deepbuild/runner';
import { openSupervisor, openUnder, type Host, type Supervisor } from '@deepbuild/supervisor';

import { ClaudeSettings, readJson, STOP_HOLD_MS, words } from './claude-settings.js';
import { statKey } from './agent-files.js';
import { Confirmer } from './confirm.js';
import { keychain } from './keychain.js';
import { recordedHome, saveTrust } from './codex-settings.js';

import { listRows } from './rows.js';
import { addGuards, blocksCall } from './guards.js';
import { captureRejected, repoFolders, syncRejected } from './memory.js';
import { AskTasks, type WorkItem } from './ask-tasks.js';
import { SizeScope } from './scope.js';

import { Holds } from './holds.js';
import { Spool } from './spool.js';

import { Questions } from './questions.js';

import { Staging } from './staging.js';
import { CAN_RUN, CANT_RUN, describe, RUN_BY, unrunnable } from './hook-programs.js';
import { SLASH_COMMAND, adapterOf, coveredBy, loopFact, registry, toolClasses, versionOf } from './hookmap.js';
import { continueLine, fit, type Part } from './context-fit.js';

import { briefing, headOf, loadsOf } from './session-facts.js';

import { GateRunner } from './gate-runner.js';
import { Siblings } from './siblings.js';
import type { KeyFacts } from './shared-runs.js';
import { groupUnder } from './children.js';
import { deepHook, repoOf, rootOf, type Root } from './paths.js';
import { OWNER, People, scopeOf } from './people.js';

import type { KnowledgeProvider, WikiBuild } from './knowledge-port.js';
import { Teardowns } from './teardowns.js';
import { Agents, type Sync } from './agents.js';
import { Box } from './box.js';
import { NEWER_SET, OLDER_SET } from './status.js';
import { aboutCall, aboutPermission } from './standing.js';
import { Channels } from './channels.js';
import type { WorkspacesProvider, WorkspaceService } from './workspaces-port.js';
import { Devices } from './trusted.js';
import type { ForgeProvider, ForgeObserver, AppKey } from './forge-port.js';

import { liveFetch, liveGraphql, readIssue, recordedFetch, recordedGraphql } from './github-source.js';
import { OpenItems } from './open-items.js';
import { isStatusQuestion, newestClaim, statusAnswer } from './verdict-chat.js';
import { apiHost, networkCheck, reachable, slackThreads } from './reach.js';

import { Answers } from './answers.js';
import { Runs } from './runs.js';
import type { ChecksProvider, CheckKinds, ReviewOf } from './checks-port.js';
import { ReviewRounds } from './review-rounds.js';
import type { CheckSpec } from '@deepbuild/conformance';
import type { DocSpec } from './doc-checks.js';
const PROMPTED = new Set(['claude-code', 'claude', 'codex', 'paseo']);

import { Stacks } from './stacks.js';
import { Starts } from './starts.js';

import { Replicas, REPLICA_LEASE } from './drive.js';
import { plantedStop } from './plant.js';
import { draftedPools, HeavyQueue, JobPool, poolTokens } from './heavy.js';
import { Products } from './products.js';
import { LogReads } from './log-reads.js';
import { Hosts } from './hosts.js';
import { Jobs } from './jobs.js';
import { Libraries } from './libraries.js';

import { excerpt, historyKey, type Restored } from './waits.js';
import { claudeHomes, claudeOnPath, denyHolds, homeMods, homeOfTranscript, loginPlan, MODS_GONE, MODS_WATCH, overrideWords, pluginDirs, type HomeMods } from './mods.js';
import { disk, testVfs, writeAtomic, type Durable } from './vfs.js';
import { CHROME, EXTENSION_HOOK_MS, refuse, signature, ulid, type CoreOptions, type Draft, type ExtensionReply, type Gated, type HookMeta, type Scope, SCREEN_TOOLS } from './wire.js';
import type { CallContext, Session, Live, Cursor, Counter, Routes } from './session-types.js';
import { CODEX_BINARY, CLAUDE_BINARY, HOUR, ARCHIVED_THREADS_MS, DRIFT_MS, DAY, sql, letters, ghToken, GITHUB_PASS_MS, HOOK_CHECK_MS, CALL_GRACE, SLEPT, said, TURN_ENTRIES, PROMPT_PLACE_MS, CORES, machineLoad, FOREIGN, HOLDS_NO_PROMPT, signInCommands, type Obj, isObj, watching, waitingOn, READS, AUTOMATIC_QUEUED, effectEntries, callOf, MODS_MS, sendKey, OWN_TURN, holdsTurns, childPrompt, streamed, wrapped } from "./hub-shared.js";

import { HubCanvas } from './hub-canvas.js';
import { TranscriptReader } from './transcript-reader.js';
import { AnswerDelivery } from './answer-delivery.js';
import { StopJudging } from './stop-judging.js';
import { SessionMemory } from './session-memory.js';
import { Transcripts } from './transcripts.js';
import { SessionState } from './session-state.js';
import { SessionFlags } from './session-flags.js';
import { McpOperations } from './mcp-operations.js';
import { HubControl } from './hub-control.js';
function lazyServices<T extends Record<string, () => unknown>>(read: T): { [K in keyof T]: ReturnType<T[K]> } {
  return Object.defineProperties({}, Object.fromEntries(Object.entries(read).map(([key, get]) => [key, { get }]))) as { [K in keyof T]: ReturnType<T[K]> };
}
export type { CallContext } from './session-types.js';

type HookReply = { context?: string; block?: string; message?: string };
/** Internal DI contract: required domain capabilities supplied by the outer runtime, never selected by Core. */
export interface CoreProviders {
  checks: ChecksProvider;
  environment: EnvironmentProvider;
  decisions: DecisionsProvider;
  knowledge: KnowledgeProvider;
  forge: ForgeProvider;
  workspaces: WorkspacesProvider;
}
/** Internal kernel. Production constructs it through hub-runtime.createCore; package entry points stay unchanged. */
export class Core {
  private readonly options: CoreOptions & { forge: string };
  /** The shared spec reader stays in the wiring owner; domains receive it as a capability. */
  private readonly doneSpec = (cwd: string): unknown => {
    try { return parseYaml(readFileSync(join(cwd, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return undefined; }
  };
  private delivery!: AnswerDelivery;
  private judging!: StopJudging;
  private memory!: SessionMemory;
  private transcripts!: Transcripts;
  private state!: SessionState;
  private flags!: SessionFlags;
  private mcp!: McpOperations;
  private control!: HubControl;
  private wireAnswerDelivery(): void {
    const readstopping = () => this.stopping;
    const readabandoned = () => this.abandoned;
    const readready = () => this.ready;
    this.delivery = new AnswerDelivery({ settings: this.options, services: lazyServices({ now: () => this.now, asks: () => this.asks, record: () => this.record, libraries: () => this.libraries, jobKinds: () => this.jobKinds, hosts: () => this.hosts, tasks: () => this.tasks, acceptance: () => this.acceptance, root: () => this.root, transcriptReader: () => this.transcriptReader, holds: () => this.holds }), state: () => this.state, mcp: () => this.mcp, judging: () => this.judging, control: () => this.control, memory: () => this.memory, events: { appendSession: (session, agent, kind, data) => this.appendSession(session, agent, kind, data), appendReading: (session, agent, reading, hook) => this.appendReading(session, agent, reading, hook), connection: (writer, extra) => this.connection(writer, extra), append: (connection, input, backfill) => this.append(connection, input, backfill) }, kernel: { get stopping() { return readstopping(); }, get ready() { return readready(); } }, schedule: { queue: (work, starting) => this.queue(work, starting), askingSoon: () => this.askingSoon(), get abandoned() { return readabandoned(); } } });
  }
  private wireStopJudging(): void {
    const readblocked = () => this.blocked;
    const readstopping = () => this.stopping;
    const readabandoned = () => this.abandoned;
    const readoverrides = () => this.overrides;
    this.judging = new StopJudging({ settings: this.options, doneSpec: this.doneSpec, services: lazyServices({ tasks: () => this.tasks, openItems: () => this.openItems, now: () => this.now, asks: () => this.asks, agents: () => this.agents, box: () => this.box, ledger: () => this.ledger, record: () => this.record, gate: () => this.gate, raw: () => this.raw, leases: () => this.leases, extensions: () => this.extensions, sizing: () => this.sizing, root: () => this.root, holds: () => this.holds, questions: () => this.questions, runner: () => this.runner, checkKinds: () => this.checkKinds, reviewRounds: () => this.reviewRounds, store: () => this.store, trust: () => this.trust, heavy: () => this.heavy, host: () => this.host, runs: () => this.runs, stacks: () => this.stacks, canvasSide: () => this.canvasSide }), state: () => this.state, mcp: () => this.mcp, delivery: () => this.delivery, transcripts: () => this.transcripts, control: () => this.control, flags: () => this.flags, events: { appendReading: (session, agent, reading, hook) => this.appendReading(session, agent, reading, hook), connection: (writer, extra) => this.connection(writer, extra), append: (connection, input, backfill) => this.append(connection, input, backfill) }, kernel: { get stopping() { return readstopping(); }, get overrides() { return readoverrides(); }, get blocked() { return readblocked(); } }, schedule: { askingSoon: () => this.askingSoon(), queue: (work, starting) => this.queue(work, starting), get abandoned() { return readabandoned(); }, wakeable: (waits, key, ms) => this.wakeable(waits, key, ms), askingNow: () => this.askingNow() } });
  }
  private wireSessionMemory(): void {

    this.memory = new SessionMemory({ decisions: this.providers.decisions, cwdOf: this.providers.knowledge.cwdOf, settings: this.options, services: lazyServices({ record: () => this.record, now: () => this.now, asks: () => this.asks, raw: () => this.raw, root: () => this.root, store: () => this.store, wikiBuild: () => this.wikiBuild, confirmer: () => this.confirmer }), delivery: () => this.delivery, mcp: () => this.mcp, state: () => this.state, events: { connection: (writer, extra) => this.connection(writer, extra), append: (connection, input, backfill) => this.append(connection, input, backfill) }, kernel: { config: () => this.config() } });
  }
  private wireTranscripts(): void {
    const readreplaying = () => this.replaying;
    const readstopping = () => this.stopping;
    this.transcripts = new Transcripts({ settings: this.options, services: lazyServices({ root: () => this.root, now: () => this.now }), state: () => this.state, flags: () => this.flags, events: { appendReading: (session, agent, reading, hook) => this.appendReading(session, agent, reading, hook), connection: (writer, extra) => this.connection(writer, extra), append: (connection, input, backfill) => this.append(connection, input, backfill) }, kernel: { get stopping() { return readstopping(); } }, schedule: { replayLate: (kept) => this.replayLate(kept), get replaying() { return readreplaying(); }, queue: (work, starting) => this.queue(work, starting) } });
  }
  private wireSessionState(): void {
    const readstopping = () => this.stopping;
    this.state = new SessionState({ settings: this.options, services: lazyServices({ gate: () => this.gate, asks: () => this.asks, now: () => this.now, record: () => this.record, raw: () => this.raw, transcriptReader: () => this.transcriptReader, stacks: () => this.stacks, replicas: () => this.replicas, archivedSessions: () => this.archivedSessions, archiveSession: () => this.archiveSession, runner: () => this.runner, root: () => this.root, siblings: () => this.siblings, sessionStarts: () => this.sessionStarts, people: () => this.people }), judging: () => this.judging, transcripts: () => this.transcripts, delivery: () => this.delivery, mcp: () => this.mcp, memory: () => this.memory, flags: () => this.flags, events: { appendReading: (session, agent, reading, hook) => this.appendReading(session, agent, reading, hook), append: (connection, input, backfill) => this.append(connection, input, backfill), connection: (writer, extra) => this.connection(writer, extra), appendSession: (session, agent, kind, data) => this.appendSession(session, agent, kind, data) }, kernel: { get stopping() { return readstopping(); } }, schedule: { askingSoon: () => this.askingSoon(), queue: (work, starting) => this.queue(work, starting) } });
  }
  private wireMcpOperations(): void {
    const readreplaying = () => this.replaying;
    const readblocked = () => this.blocked;
    const readstopping = () => this.stopping;
    this.mcp = new McpOperations({ settings: this.options, doneSpec: this.doneSpec, services: lazyServices({ sessionStarts: () => this.sessionStarts, hosts: () => this.hosts, canvasSide: () => this.canvasSide, replicas: () => this.replicas, extensions: () => this.extensions, holds: () => this.holds, record: () => this.record, numbers: () => this.numbers, root: () => this.root, asks: () => this.asks, now: () => this.now, raw: () => this.raw, runs: () => this.runs, stacks: () => this.stacks }), control: () => this.control, state: () => this.state, judging: () => this.judging, delivery: () => this.delivery, events: { connection: (writer, extra) => this.connection(writer, extra), appendReading: (session, agent, reading, hook) => this.appendReading(session, agent, reading, hook), append: (connection, input, backfill) => this.append(connection, input, backfill) }, kernel: { get blocked() { return readblocked(); }, get stopping() { return readstopping(); } }, schedule: { get replaying() { return readreplaying(); }, queue: (work, starting) => this.queue(work, starting), askingNow: () => this.askingNow(), wakeable: (waits, key, ms) => this.wakeable(waits, key, ms) } });
  }
  private wireHubControl(): void {
    const readready = () => this.ready;
    const readreplaying = () => this.replaying;
    const readblocked = () => this.blocked;
    const readjobs = () => this.jobs;
    this.control = new HubControl({ settings: this.options, services: lazyServices({ wikiWritten: () => this.providers.knowledge.writtenOf, log: () => this.log, people: () => this.people, numbers: () => this.numbers, staging: () => this.staging, agents: () => this.agents, box: () => this.box, extensions: () => this.extensions, runs: () => this.runs, hosts: () => this.hosts, sessionStarts: () => this.sessionStarts, heavy: () => this.heavy, wikiBuild: () => this.wikiBuild, raw: () => this.raw, root: () => this.root, record: () => this.record, now: () => this.now, acceptance: () => this.acceptance, landing: () => this.landing, runner: () => this.runner, checkKinds: () => this.checkKinds, canvasSide: () => this.canvasSide, spaces: () => this.spaces, asks: () => this.asks, tasks: () => this.tasks, claudeSettings: () => this.claudeSettings, store: () => this.store, devices: () => this.devices, confirmer: () => this.confirmer, teardowns: () => this.teardowns, openItems: () => this.openItems, checkouts: () => this.checkouts, channels: () => this.channels, libraries: () => this.libraries, jobKinds: () => this.jobKinds, durable: () => this.durable, stacks: () => this.stacks }), delivery: () => this.delivery, judging: () => this.judging, state: () => this.state, memory: () => this.memory, mcp: () => this.mcp, transcripts: () => this.transcripts, events: { connection: (writer, extra) => this.connection(writer, extra), appendCore: (kind, data, extra) => this.appendCore(kind, data, extra), appendReading: (session, agent, reading, hook) => this.appendReading(session, agent, reading, hook), append: (connection, input, backfill) => this.append(connection, input, backfill) }, kernel: { get ready() { return readready(); }, get blocked() { return readblocked(); }, get jobs() { return readjobs(); } }, schedule: { testClock: (params) => this.testClock(params), replayLate: (kept) => this.replayLate(kept), get replaying() { return readreplaying(); }, queue: (work, starting) => this.queue(work, starting) } });
  }

  private transcriptReader!: TranscriptReader;
  private canvasSide!: HubCanvas;
  private root!: Root;
  private now!: () => number;
  private durable!: Durable;
  private spool!: Spool;
  private record!: RecordStore;
  /** The record's raw reads, as the helpers that take them call them: parameters bound. */
  private readonly raw: RecordStore['raw'] = (sql, params) => this.record.raw(sql, params);
  /** The log's pages, read-ahead and stream; a read waits for the appends in flight, and the owner's stream reads what the owner may see (#1337). */
  private readonly log = new LogReads({ raw: this.raw, settled: () => Promise.allSettled([...this.inflight]), ownerSeen: () => this.state.seenBy(OWNER), emit: (sub, json, caught) => this.emit(sub, json, caught) });
  private asks!: Asks;
  /** Online model libraries (#1731): which are on, your standing rules, searches and fetches. */
  private libraries?: Libraries;
  /** The job kinds' runs (#1922): the cache by key, your standing rules for paid tools, and the asks they wait on. */
  private jobKinds?: Jobs;
  /** Hosts your SSH config names, their facts and the runs on them (#1942). */
  private hosts!: Hosts;
  /** Authority at PreToolUse (#321): the planted sorter's proceeds, the servers' tool lists, and the calls held for you. */
  private holds!: Holds;
  /** Only real questions reach you (#84): what a stop ends on, and the question cards a turn raises, sorted. */
  private questions!: Questions;
  /** One session's transcript copied into the record now; unset until the archive opens. */
  private archiveSession?: (session: string) => Promise<void>;
  /** The sessions whose transcripts their agents moved to an archived folder; unset until the archive opens. */
  private archivedSessions?: () => Promise<Set<string>>;
  /** Ask-tasks in the kernel (#303): a task for each prompt you typed that asks for a change, and its definition locked by hash. */
  private tasks!: AskTasks;
  private sizing!: SizeScope;
  /** What claims leave open, as open items in the record (#323). */
  private openItems!: OpenItems;
  /** The gate runner (#29): each claim's checks on its snapshot, in their lanes, under the stop's hold. */
  private gate!: GateRunner;
  /** The session map and the notices it hands each session, and the loop rule (#352). */
  private siblings!: Siblings;
  /** The sessions told the loop rule is watch-only for them (#352). */
  private readonly loopWatched = new Set<string>();
  private numbers!: Numbers;
  /** The project trust decision the core holds (#348), which the done gate reads for a repo's spec checks (#322). */
  private trust!: ProjectTrust;
  /** The one ledger of the budgets you approved (#86), each issue's budget ask with the budget your yes approves, and each claim's paid checks (#325). */
  private ledger!: Ledger;
  /** Staging for destructive commands (#347): a delete whose reach can't be worked out, staged copy-on-write or asked about. */
  private staging!: Staging;
  private devices!: Devices;
  private confirmer!: Confirmer;
  private store!: EvidenceStore;
  private supervisor!: Supervisor;
  private checkouts!: Checkouts;
  /** The kernel's lease table (#237), read by deep env down for who holds a port now, and the gate runner's cpu.slot. */
  private leases!: LeaseTable;
  /** The queue `deep lease` waits in, and the heavy commands it holds leases for (#1015). */
  private heavy!: HeavyQueue;
  private pool?: JobPool;
  private products!: Products;
  /** host@1: where every check run starts, is signalled and waited for; the supervisor, unless a test put another in its place. */
  private host!: Host;
  /** The sessions whose stop a running hub replayed from the spool, to judge once the replay ends (#580). */
  private readonly lateStops: string[] = [];
  /** env-local's compose kind, with the Docker CLI it found when the hub started (#331). */
  private compose?: ComposeResource;
  /** DeepBuild's own headless jobs (#159): their hooks are theirs, never a session's. */
  private runner!: Runner;
  /** The blind acceptance job (#1328): the runner's one kind that writes, before an issue's first attempt. */
  private acceptance!: Acceptance;
  /** Landing in turn (#1331): each repo's changes onto its default branch, one at a time. */
  private landing!: Landing;
  /** Sessions started without your Send, under a run you approved (#1330). */
  private sessionStarts!: Starts;
  /** Setup's wiki build (#356). */
  private wikiBuild!: WikiBuild;
  private ready!: Promise<void>;
  /** The work items prompts name, read off the hook's parse, for the append that opens their tasks. */
  private readonly items = new WeakMap<Draft, WorkItem>();
  /** Hooks and calls run in arrival order: a deep_* call finds the stamp its PreToolUse left. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Whether the start has finished: from then on, work waiting for it joins the queue at once. */
  private opened = false;
  private blocked: string | undefined;
  /** The hub's lock file was removed or replaced under it (#909): appends stop for good, so `blocked` never clears. */
  private lost = false;
  /** Unset until the start opened it: a start that fails before has nothing to close or ask. */
  private extensions: ExtensionHost | undefined;
  /** The ways to reach you (#65), once the extensions are ready. */
  private channels: Channels | undefined;
  /** Work outside a repo (#67). */
  private spaces!: WorkspaceService;
  /** The supervisor's runs (runs.ts). */
  private runs!: Runs;
  private checkKinds!: CheckKinds;
  private reviewRounds!: ReviewRounds;
  /** Each worktree's stack and every stack run a check started (#331, #332). */
  private stacks!: Stacks;
  /** Each outside resource a session created, and its teardown task (#342). */
  private teardowns!: Teardowns;
  /** The Agents page's syncs (#148): servers and skills written into each agent's own files. */
  private agents!: Agents;
  /** The box (#1998): changes in words, each a proposal you approve. */
  private box!: Box;
  /** Each session's deep_drive replicas (#124). */
  private replicas!: Replicas;
  /** Appends handed to the record and not yet settled: a read waits for them, so it sees every hook acknowledged before it. */
  private readonly inflight = new Set<Promise<unknown>>();
  private readonly timers: NodeJS.Timeout[] = [];
  /**
   * Each background job's failures in a row, when the first of them was and the last one's error, cleared by its
   * next clean run (#909): one blip reads apart from a job that has failed for an hour.
   */
  private readonly jobs = new Map<string, { failures: number; since: number; at: number; error: string } | null>();
  private stopping = false;
  private replaying: Promise<unknown> | undefined;
  /** Only the drops-post-tool-use and replay-appends-twice plants read them. */
  private dropped = false;
  /** The newest hook ID #2026's planted asker read; only that plant reads it. */
  private askedThrough = '';
  /** Whether appends came back during a replay, so the files it kept are taken again after it. */
  private retake = false;
  private github: ForgeObserver | undefined;
  private claudeSettings!: ClaudeSettings;
  /** Hooks waiting on a network stop's try, which the hub finishes before it stops. */
  private readonly tried = new Set<Promise<unknown>>();
  /**
   * Claude Code prompts set aside until their transcript entry is written, by session (#567): Claude Code writes a
   * prompt's entry only once its hooks have returned, and the origin joins the prompt to that entry.
   */
  private readonly unplaced = new Map<string, { drafts: Draft[]; meta: HookMeta; writer: string; timer: NodeJS.Timeout; done: (settled: Promise<void>) => void }>();
  /** The calls a guard entry or the gate denied at PreToolUse, by session and call (#1033): what denied each, and the call in words. */
  private readonly denials = new Map<string, Map<string, { guard: string; label: string }>>();
  /** Each session's denied calls that ran anyway (#1033), as they arrive: its claims don't pass on its own evidence. */
  private readonly overrides = new Map<string, { call: string; label: string; ts: number }[]>();
  /** Each session's sends in its turn under way, by call (#1033): the key an identical send matches by, and whether it completed. */
  private readonly turnSends = new Map<string, Map<string, { key: string; label: string; done: boolean }>>();
  /** When this core started: a deny from before it is read back from the record (#1033). */
  private readonly bootAt = Date.now();
  /** Each Claude Code home's mods as last read, by what they were read from (#1033). */
  private readonly modsSeen = new Map<string, { at: number; read: Promise<HomeMods> }>();
  /** Each Claude Code home's login plan as `claude auth status` last read it, by the files a sign-in rewrites. */
  private readonly plansSeen = new Map<string, { key: string; at: number; plan: Promise<unknown> }>();
  /** The people on this hub's projects (#1337), and the person each session's first hook connection named. */
  private people!: People;
  /** How far test.clock has stepped the hub's clock past the wall clock deep-hook stamps hooks by (#965). */
  private stepped = 0;

  /**
   * `asking` hears the sessions with an ask still to deliver whenever that set changes, so the event loop holds a stop
   * only where an answer may come back through it (#19: right after install no stop is held for anything else);
   * `acking` hears a session with a message typed mid-turn to acknowledge, so its next tool call's hook is held (#340).
   */
  constructor(options: CoreOptions, private readonly emit: (sub: string, event: string, caught?: boolean) => void, private readonly providers: CoreProviders, private readonly asking: (sessions: string[], judged: string[], resend: string[], cantRun: string[]) => void = () => undefined, private readonly acking: (session: string) => void = () => undefined, private readonly scrubbing: (values: string[]) => void = () => undefined) {
    this.options = { ...options, forge: options.forge ?? 'https://api.github.com' };
    this.wireHookServices();
    this.wireWorkServices();
    this.wireGateServices();
    this.wirePeopleServices();
    this.wireRunServices();
  }
  private wireHookServices(): void {
    const options = this.options;
    this.transcriptReader = new TranscriptReader({ plant: options.plant, now: () => this.now() });
    this.flags = new SessionFlags({ services: lazyServices({ record: () => this.record, now: () => this.now, asks: () => this.asks, agents: () => this.agents, root: () => this.root, siblings: () => this.siblings, transcriptReader: () => this.transcriptReader }), state: () => this.state, mcp: () => this.mcp, events: { append: (connection, input, backfill) => this.append(connection, input, backfill), connection: (writer, extra) => this.connection(writer, extra) }, schedule: { queue: (work, starting) => this.queue(work, starting) }, readCodexTrust: (cwd) => this.readCodexTrust(cwd) });
    this.canvasSide = new HubCanvas({
      root: rootOf(options.root), now: () => this.now(), plant: options.plant, doneSpec: this.doneSpec,
      record: () => this.record, store: () => this.store, libraries: () => this.libraries, sessions: () => this.state.sessions,
      evidence: { stored: (put, what) => this.control.stored(put, what) },
      events: { append: (connection, input) => this.append(connection, input), connection: (writer, extra) => this.connection(writer, extra), agentConnection: (session) => this.mcp.agentConnection(session) },
      agentAbove: (peer) => this.state.agentAbove(peer),
    });
    this.wireAnswerDelivery();
    this.wireStopJudging();
    this.wireSessionMemory();
    this.wireTranscripts();
    this.wireSessionState();
    this.wireMcpOperations();
    this.wireHubControl();
    this.root = rootOf(options.root);
    this.people = new People(this.root.dir);
    this.claudeSettings = new ClaudeSettings({
      root: this.root.dir, plant: options.plant, raw: this.raw, queue: (work) => this.queue(work),
      running: () => {
        const now = Date.now();
        return [...this.state.live].flatMap(([id, l]) => [...l.calls.values()].filter((c) => c.ended === undefined || now - c.ended <= CALL_GRACE).map((c) => ({ id, agent: l.agent, what: c.what })));
      },
      reading: (session, agent, text) => this.appendReading(session, agent, text),
    });
    this.now = () => options.clock.start + (Date.now() - options.clock.real);
    this.durable = options.vfs ? testVfs(options.vfs) : disk;
    this.devices = new Devices(this.root.devices);
    this.confirmer = new Confirmer({ devices: this.devices, key: this.root.confirmKey, ...(options.confirm !== undefined ? { stub: options.confirm } : {}), ...(options.polkit !== undefined ? { polkit: options.polkit } : {}), ...(options.plant ? { plant: options.plant } : {}) });
    this.spool = new Spool({
      dir: this.root.spool, held: options.held, plant: options.plant, durable: this.durable, stopping: () => this.stopping,
      raw: this.raw, appendCore: (kind, data) => this.appendCore(kind, data),
      tryNetwork: (drafts, meta, tries) => this.tryNetwork(drafts, meta, tries),
      replay: (drafts, meta) => this.queue(() => this.handleHook(drafts, meta, 'hook', true), true).then(({ settled }) => settled),
      sync: () => this.record.sync(),
    });
    this.holds = new Holds({
      raw: this.raw, asks: () => this.asks, now: this.now, plant: options.plant, sorter: options.sorter,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
      pin: (cwd, question) => this.mcp.pinOf(cwd, question), heard: (ask) => this.delivery.heardBy(ask),
      archived: async (session) => { await this.archiveSession?.(session); },
      reading: (session, agent, reading) => this.appendReading(session, agent, reading),
    });
    this.questions = new Questions({
      raw: this.raw, asks: () => this.asks, holds: this.holds, plant: options.plant,
      connection: (session, agent) => this.connection('core', { session, agent }),
      pin: (cwd, question) => this.mcp.pinOf(cwd, question), reading: (session, agent, reading) => this.appendReading(session, agent, reading),
      reach: (session) => this.judging.reachOfSession(session), checks: (cwd) => [...this.mcp.checksOf(cwd).keys()],
      denied: (command) => blocksCall(this.root.dir, deepHook(), command), signIns: () => signInCommands(),
    });
  }

  private wireWorkServices(): void {
    const options = this.options;
    // Shared build products (#1017): made first, so a session that starts while the hub opens finds them; their builds
    // take the host and the lease queue only once a session's start asks.
    this.products = new Products({
      root: this.root.dir, now: this.now, plant: this.options.plant,
      trusted: (cwd) => this.judging.projectTrusted(cwd),
      append: (kind, data, session) => this.appendCore(kind, data, {}, session ? { session, ...(this.state.sessions.get(session)?.agent ? { agent: this.state.sessions.get(session)!.agent } : {}) } : {}),
      build: (b) => this.judging.buildProduct(b),
      openUnder,
      guard: (given) => addGuards(this.root.dir, given, { deepHook: deepHook(), classes: toolClasses(), plant: this.options.plant }),
    });
    this.staging = new Staging({
      root: this.root.dir, raw: this.raw, now: this.now, plant: options.plant, holds: this.holds,
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
    });
    this.spaces = this.providers.workspaces.create({
      root: this.root.dir, now: this.now, plant: options.plant, record: () => this.record,
      raw: this.raw, append: (connection, input) => this.append(connection, input),
      connection: (extra) => this.connection('core', extra), keep: (bytes, source) => this.control.keep(bytes, source), fetch: (sha256) => this.store.read(sha256),
      trust: (folder) => this.trust.answer(this.connection('app'), folder, true), plugin: (name) => this.extensions!.stateSource(name),
      adopted: (session, id) => { this.state.projects.set(session, id); }, told: (session, cwd, text) => this.delivery.later(session, cwd, text), rerun: (claim, checks, state) => this.gate.rerun(claim, checks, state),
    });
    this.tasks = new AskTasks({
      spaces: this.spaces, renamedSince: this.providers.workspaces.renamedSince,
      raw: this.raw, asks: () => this.asks, now: this.now, plant: options.plant, drafts: options.drafts, work: options.work,
      github: options.github, forge: options.forge, token: async () => process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken(),
      append: (connection, input) => this.append(connection, input), connection: (session, agent) => this.connection('core', { session, agent }),
      reading: (session, agent, text) => this.appendReading(session, agent, text),
      // The window reading of the account the session's agent runs on, in the hub's own home (#322).
      atReserve: (agent) => this.runner.atReserve(agent === 'claude' ? 'claude-code' : agent as Parameters<typeof this.runner.atReserve>[0], homedir()),
      pin: (cwd, question) => this.mcp.pinOf(cwd, question), keep: (bytes, source) => this.control.keep(bytes, source), run: (r) => this.judging.runClaim(r),
      invalid: (claim, commit, reason) => this.judging.invalid(claim, commit, reason),
      // A definition just locked: its paid checks priced (#325), and a plan marked large sized before any code (#324).
      locked: async (d) => {
        await this.judging.priceLocked(d).catch((error: unknown) => process.stderr.write(`deep hub: ${d.task_ref}'s paid checks were not priced: ${error instanceof Error ? error.message : String(error)}\n`));
        await this.sizing.planned(d);
      },
      unresolved: (claim, targets) => this.judging.unresolvedTargets.set(claim, targets),
    });
    this.sizing = new SizeScope({
      raw: this.raw, append: (connection, input) => this.append(connection, input),
      connection: (session, agent) => this.connection('core', { session, agent }), asks: () => this.asks, now: this.now,
      pin: (cwd, question) => this.mcp.pinOf(cwd, question), keep: (bytes, source) => this.control.keep(bytes, source), scopeOf: (task) => this.tasks.scopeOf(task),
      evidence: this.root.evidence, accepted: options.accepted,
    });
    this.openItems = new OpenItems({
      raw: this.raw, append: (connection, input) => this.append(connection, input), now: this.now, plant: options.plant,
      connection: (session, agent) => this.connection('core', session ? { session, ...(agent ? { agent } : {}) } : {}), asks: () => this.asks, pin: (cwd, question) => this.mcp.pinOf(cwd, question),
      github: async () => {
        if (options.github) return { fetch: recordedFetch(options.github), graphql: recordedGraphql(options.github) };
        const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken();
        const api = options.forge;
        return { fetch: liveFetch(api, token), graphql: liveGraphql(api, token) };
      },
      taskList: (agent) => ((registry().get(agent === 'codex' ? 'codex' : 'claude').facts as Obj).taskList as TaskListFacts | undefined),
    });
  }

  private wireGateServices(): void {
    const options = this.options;
    this.gate = new GateRunner({
      raw: this.raw, now: this.now, append: (connection, input) => this.append(connection, input), core: this.connection('core'),
      start: (r) => this.judging.runApproved(r), ended: (run) => this.judging.runEnded(run), judged: (claim) => this.judging.judged(claim), stackStart: (folder, worktree) => this.stacks.expectedStart(folder, worktree), stacked: (folder) => this.stacks.wanted(folder),
      ...(options.plant === 'env-starts-at-every-claim' ? {
        startsAtClaim: async (folder: string, session: string, worktree: string) => {
          const run = this.providers.environment.newRun();
          if (!this.stacks.wanted(folder)) return;
          const started = await this.stacks.serve({ run, claim: 'claim:planted', check: 'planted', folder, worktree, session, on_base: 'passes', expected_ms: null });
          if (!('cause' in started)) await this.stacks.finish(run);
        },
      } : {}),
      checkouts: () => this.checkouts, invalid: (claim, commit, reason, outcome) => this.judging.invalid(claim, commit, reason, outcome), stopping: () => this.stopping,
      stoodIn: (r) => this.tasks.stoodIn(this.connection('core'), r),
      kept: async (evidence) => (await Promise.all(evidence.map((sha) => this.store.get(sha)))).every(Boolean),
      slots: () => ({ free: Math.max(0, Math.max(1, Math.floor(CORES / 2)) - this.runs.size) }),
      capped: (session, checks) => void this.judging.backgroundCapped(session, checks).catch(() => undefined), plant: options.plant, load: machineLoad,
      // The design's 10 s fast-lane budget and 60 s hold, proposals until the dogfood week measures them (#43).
      budget_ms: 10_000, hold_ms: STOP_HOLD_MS,
    });
    this.siblings = new Siblings({
      raw: this.raw, now: this.now,
      append: (session, agent, input) => this.append(this.connection('core', { session, agent }), input),
      ask: async (session, agent, cwd, source, ask) => this.asks.raise(this.connection('core', { session, agent }), source, {
        ...ask, deadline: this.now() + 2 * DAY, key: sha256Hex(canonicalize({ kind: source, key: String(ask.key) })), pinned_to: await this.mcp.pinOf(cwd, String(ask.question)),
      }),
      acking: (session) => this.acking(session), queue: (work) => void this.queue(work).catch(() => undefined), wake: (session, text) => this.noticeWake(session, text),
    });
    this.delivery.answers = new Answers({
      raw: this.raw, settled: () => Promise.allSettled([...this.inflight]),
      excluded: (id) => this.delivery.handed.has(id) || this.delivery.prompts.has(`ask:${id}`),
      delivered: options.plant === 'words-only-at-turn-start' ? undefined : (session) => { const live = this.state.live.get(session); if (live) live.words ??= 'answer'; },
      append: (data, v) => this.appendCore('delivery.outcome', data, { subject: data.delivery, ...(v === 2 ? { v } : {}) }),
    });
    this.stacks = new Stacks({
      raw: this.raw, now: this.now, plant: options.plant, held: options.held, scrub: (values) => this.scrubbing(values),
      appendCore: (kind, data, extra) => this.appendCore(kind, data, extra), supervisor: () => this.supervisor, leases: () => this.leases,
      environment: this.providers.environment.stacks({
        host: () => this.host, compose: () => this.compose, plant: options.plant,
        products: { declared: (f, p) => this.products.declared(f, p), holds: (w, n, k) => this.products.holds(w, n, k), place: (w, n, k, d) => this.products.placeIn(w, n, k, d), keep: (w, n, p, k, s) => this.products.keep(w, n, p, k, s), placeCache: (w, k, p, d) => this.products.placeCache(w, k, p, d), keepCache: (w, k, p, s) => this.products.keepCache(w, k, p, s) },
      }),
      stopping: () => this.stopping, session: (id) => this.state.sessions.get(id),
      pending: (worktree) => this.gate.pendingIn(worktree), idle: (session) => this.state.live.get(session)?.state !== 'working',
      plantedAsk: async (session, question) => { await this.control.raiseTask(session, this.state.sessions.get(session)?.agent ?? 'claude-code', { kind: 'unblock', question, options: [{ id: 'done', label: 'I did it', decision: 'none' }], recommended: 'done', default: 'done', steps: [question], where: 'your terminal', why: 'The pool is full', unblocks: [`session:${letters(session)}`], proves: 'stack.slot', fallback: 'you', provisional: false, owner: 'you', key: sha256Hex(new TextEncoder().encode(question)), pinned_to: { kind: 'evidence', ref: sha256Hex(new TextEncoder().encode(question)) } }); },
    });
    this.teardowns = new Teardowns({
      raw: this.raw, held: options.held, append: (session, agent, kind, data) => this.appendSession(session, agent, kind, data),
      reading: (session, agent, text) => this.appendReading(session, agent, text), raise: (session, agent, ask) => this.control.raiseTask(session, agent, ask),
    });
  }

  private wirePeopleServices(): void {
    const options = this.options;
    this.agents = new Agents({
      root: this.root.dir, plant: options.plant, durable: this.durable, now: this.now, held: options.held,
      raise: async (source, ask, plan) => { await this.ready; return this.asks.raise(this.connection('core'), source, ask, plan as never); },
      synced: async (data) => { await this.ready; await this.appendCore('agents.synced', data); },
      wanted: async () => { await this.ready; return ((await this.record.raw("SELECT data FROM events WHERE kind = 'agents.synced' ORDER BY log_pos")) as { data: string }[]).map((r) => JSON.parse(r.data) as Obj); },
      sessions: () => [...this.state.sessions.values()].filter((s) => !s.ended).map((s) => ({ id: s.id, agent: s.agent, pid: s.pid, start: s.start })),
      older: (sync) => this.olderSet(sync),
    });
    this.box = new Box({
      root: this.root.dir, plant: options.plant, now: this.now,
      raise: async (source, ask, plan) => { await this.ready; return this.asks.raise(this.connection('core'), source, ask, plan as never); },
      folders: async () => { await this.ready; return [...new Set([...[...this.state.sessions.values()].map((s) => s.cwd), ...(await repoFolders(this.record, this.store, this.providers.knowledge.cwdOf)).values()])]; },
      lessons: async () => { await this.ready; return (await this.memory.lessons()).map((l) => ({ id: l.id, text: l.text })); },
      forget: async (id) => {
        const lesson = (await this.memory.lessons()).find((l) => l.id === id);
        if (!lesson) return `the lesson ${id} is gone`;
        if (lesson.claim.startsWith('wiki:rules#') && lesson.why) { const r = await this.memory.removeRule(lesson); return r.status === 'refused' ? String(r.reason) : undefined; }
        await this.wikiBuild.forget(lesson.claim);
        return undefined;
      },
      learn: async () => { await this.wikiBuild.build(); await syncRejected(this.raw, this.root.dir); },
    });
    this.hosts = new Hosts({
      root: this.root.dir, now: this.now, plant: options.plant, raise: async (source, ask, plan) => { await this.ready; return this.asks.raise(this.connection('core'), source, ask, plan); },
      append: (kind, data, extra) => this.appendCore(kind, data, extra), raw: this.raw,
      // Bytes as the host gave them, so their hash is the hash of what was read there (#1945).
      put: async (bytes, kind, source) => (await this.control.stored(await this.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind, source, redaction: 'complete', license: { name: 'local', allows: [] } }), kind)).sha256,
    });
  }

  private wireRunServices(): void {
    const options = this.options;
    this.runs = new Runs({
      command: this.providers.checks.command,
      hosts: () => this.hosts,
      journalFile: this.root.runs, point: () => this.durable.point('journal_rewrite'), checkouts: join(this.root.dir, 'checkouts'), now: this.now, plant: options.plant, held: options.held,
      raw: this.raw, sync: () => this.record.sync(), appendAsCore: (input) => this.append(this.connection('core'), input as EventInput),
      appendCore: (kind, data, extra) => this.appendCore(kind, data, extra), stored: (put, what) => this.control.stored(put, what),
      invalid: (claim, commit, reason, outcome) => this.judging.invalid(claim, commit, reason, outcome), recorded: (run, record) => this.gate.recorded(run, record), keyed: (key, run, record) => this.gate.keyed(key, run, record),
      stopping: () => this.stopping, stacks: this.stacks, store: () => this.store, host: () => this.host, supervisor: () => this.supervisor, leases: () => this.leases, extensions: () => this.extensions,
      kind: async (run, checkout, deadline, stop) => {
        const of: ReviewOf = this.judging.kindChecks.get(run.claim)?.get(run.check)?.of ?? { claim: run.claim, task: '', agent: 'claude-code', transcript: undefined };
        const spec = run.spec as unknown as CheckSpec;
        // A document check runs through the canvas core's verdict on the document's revision (#1723).
        if ((spec as DocSpec).runner === 'canvas') return this.canvasSide.documentCheck(run, spec as DocSpec);
        // A review reads the diff from the merge base to the claim's snapshot, both in the hub's object store, which
        // reads the repo's objects as alternates; the checkout is the snapshot's tree alone.
        // On a pull request it reads from the commit the last round read, and its own run on the snapshot is the next round (#1862).
        if (spec.kind === 'review') {
          const head = this.gate.snapshotOf(run.claim) ?? run.commit;
          const since = of.pr ? await this.reviewRounds.since(of.pr, run.claim) : null;
          const { round, ...result } = await this.checkKinds.run({ ...spec, head, since } as CheckSpec, { checkout: join(this.root.dir, 'objects'), deadline, now: this.now }, of);
          if (round && of.pr && run.commit === head) await this.reviewRounds.read(of.pr, run.claim, head, round);
          return result;
        }
        return this.checkKinds.run(spec, { checkout, deadline, now: this.now }, of, { run: run.run, worktree: this.judging.claimFolder(run.claim) ?? checkout, stop });
      },
    });
    // The check kinds the hub holds (#1537): command, review, numbers and the work kinds, each with its routes.
    this.reviewRounds = new ReviewRounds({ outcomes: this.providers.checks.reviewOutcomes, raw: this.raw, appendCore: (kind, data, extra) => this.appendCore(kind, data, extra), objects: join(this.root.dir, 'objects') });
    this.checkKinds = this.providers.checks.kinds({ host: () => this.host, supervisor: () => this.supervisor, checkouts: () => this.checkouts, store: join(this.root.dir, 'objects'), submit: (spec) => this.runner.submit(spec), wait: (job) => this.runner.wait(job), cancel: (job) => this.runner.cancel(job), plant: options.plant });
    this.replicas = new Replicas({ folder: join(this.root.dir, 'replicas'), now: this.now, leases: () => this.leases, plant: options.plant });
    this.numbers = new Numbers({
      raw: this.raw, now: this.now, append: (connection, input) => this.append(connection, input), core: this.connection('core'),
      root: this.root.dir, forge: this.options.forge,
      token: async () => process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken(),
      held: () => this.options.held,
      keep: (bytes, source) => this.control.keep(bytes, source),
      evidence: (sha) => this.store.read(sha).catch(() => null),
    });
    this.ready = this.init();
    this.ready.then(() => { this.opened = true; }, () => undefined);
    // A start that fails stops nothing else; each call then reports why.
    this.ready.catch(() => undefined);
  }

  /** Resolves once the record is open, the spool replayed and runs recovered; rejects with why it couldn't start. */
  started(): Promise<void> {
    return this.ready;
  }

  private async init(): Promise<void> {
    await this.openRecordAndAsks();
    const { port, compose, leases } = await this.openResources();
    await this.openExecution(port, compose, leases);
    const trust = await this.openRunner();
    await this.openExtensions(trust);
    await this.recoverRecord();
    await this.startBackground();
  }
  private async openRecordAndAsks(): Promise<void> {

    this.store = await openEvidenceStore({ root: this.root.evidence, now: this.now });
    const storage = this.durable.backend();
    // Each event its own commit: the durable write points a run makes depend only on the events it appends,
    // never on how many arrived together, so a cut at any one can be replayed.
    this.record = await openRecord({ path: this.root.ledger, now: this.now, evidence: this.store, commitEach: true, ...(storage ? { storage } : {}), ...(this.options.plant === 'turn-closes-at-child-stop' ? { plant: this.options.plant } : {}) });
    this.record = wrapped(this.record, this.control.requests);
    // Every append reaches the stream, whoever appends it: the hub, the asks core, the supervisor or the leases.
    this.record = streamed(this.record, ({ kind, subject, data }, connection) => {
      this.log.stream();
      if (kind !== 'session.state' && kind !== 'row.set' && kind !== 'write.done') {
        // The next state pass reads the sessions appended to since the last; an event of no session, every session.
        if (this.state.touched !== 'all') { if (connection.session) this.state.touched.add(connection.session); else this.state.touched = 'all'; }
        this.state.stateSoon();
      }
      if (kind.startsWith('ask.') || kind.startsWith('delivery.') || kind === 'session.start' || kind === 'session.end') this.askingSoon();
      if (kind === 'verdict.made') this.github?.verdicts();
      // A deep_wait or deep_run waiting on what this event settles reads it again now, and answers before the
      // appender's next commit holds this thread with its sync (#823).
      const about = kind === 'decision.applied' && isObj(data) ? data.ask : subject;
      const woken = typeof about === 'string' ? [...this.delivery.settling.get(about) ?? []] : [];
      for (const wake of woken) wake();
      return woken.length ? new Promise((done) => setImmediate(done)) : undefined;
    });
    // A start that finds the last run still marked running records that run's stop as a crash.
    try {
      // A cursor whose transcript is gone has no session left to judge.
      this.transcripts.cursors = new Map(Object.entries(JSON.parse(readFileSync(this.root.transcripts, 'utf8')) as Record<string, Cursor>).filter(([, c]) => typeof c?.transcript === 'string' && existsSync(c.transcript)));
    } catch {
      // None yet, or unreadable: the sessions are read from where this hub meets them.
    }
    const crashed = existsSync(this.root.state) && readFileSync(this.root.state, 'utf8').trim() === 'running';
    this.writeState('running');
    if (crashed) await this.appendCore('hub.stopped', { reason: 'crashed' });
    await this.runs.open();
    // The continues the hub carried before this start are those recorded before it; opening the core below settles
    // what landed while the hub was down (a task's check passed, a window reset, a fresh transient stop), and each
    // continue that records is routed right after, never skipped as already carried (#85).
    this.delivery.continuedPos = Number(((await this.record.raw(`SELECT COALESCE(MAX(log_pos), 0) AS pos FROM events WHERE kind = 'session.continued'`)) as { pos: number }[])[0]?.pos ?? 0);
    // A continue parked for a session's next prompt outlives the hub: each that no later turn of its session carried
    // goes with that session's next prompt again (#85).
    for (const row of (await this.record.raw(`SELECT c.session_id, c.data FROM events c WHERE c.kind = 'session.continued' AND c.session_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = c.session_id AND e.log_pos > c.log_pos AND e.kind IN ('user.ask', 'tool.before', 'tool.after', 'agent.stop', 'permission.request') AND ${OWN_TURN}) ORDER BY c.log_pos`)) as { session_id: string; data: string | Obj }[]) {
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      this.delivery.routesOf(row.session_id).later.push(await this.delivery.continueBlock(row.session_id, String(d.because), typeof d.task === 'string' ? d.task : null, typeof d.stop === 'string' ? d.stop : undefined));
    }
    // A stop whose task is open holds its session's DeepBuild turns across a restart too (#85): each session's newest
    // stop that no turn, prompt or continue followed.
    for (const row of (await this.record.raw(`SELECT s.session_id, s.data FROM events s WHERE s.kind = 'agent.stop' AND s.session_id IS NOT NULL AND json_extract(s.data, '$.child') IS NULL AND NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.session_id AND e.log_pos > s.log_pos AND e.kind IN ('user.ask', 'tool.before', 'tool.after', 'agent.stop', 'session.continued', 'session.end') AND ${OWN_TURN})`)) as { session_id: string; data: string | Obj }[]) {
      const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
      if (holdsTurns(d)) this.delivery.routesOf(row.session_id).blocked = String(d.cause);
    }
    // Opening the supervisor reaps what the record says a run left before this start.
    const asks = this.asks = await openAsks({
      record: this.record, now: this.now, deliver: (d) => this.delivery.answered(d), home: this.root.dir, threads: slackThreads(this.root.dir), network: networkCheck(),
      // The hub's own adapters answer, so the facts it maps hooks by are the facts that decide a continue.
      errorTurnHook: (agent) => adapterOf(agent)?.caps.errorTurnHook === true,
    });
    await this.delivery.continues();
    await this.delivery.notesOwed();
    this.askingSoon();
    // The results every session's claims share (#1018): each kept run's key, from its finish, read once at start.
    const kept = (await this.record.raw(`SELECT data FROM events WHERE kind = 'run.finished' AND json_extract(data, '$.key') IS NOT NULL ORDER BY log_pos`)) as { data: string }[];
    this.gate.kept(kept.map((row) => JSON.parse(row.data) as { run: string; check: string; outcome: string; tests_run: number; findings: string[]; evidence: string[]; key: KeyFacts }));
    // Every second, once an open ask's deadline has passed, the asks core takes its default (showing it first if it
    // hadn't shown), so no ask waits on a read; once a stop or a verdict landed, or while a task waits on its check,
    // it reads them for the task, the continue or the resume they call for (#85). With nothing due it reads nothing,
    // so a backfill never feeds it. The hub takes each continue's route every beat, since an answer records them too.
    // While the Mac sleeps no beat runs: a beat that finds the wall clock far past the last one tells the asks core the
    // hub didn't run in between, which moves the deadline of each ask that hadn't shown (#908).
    let beat = { wall: Date.now(), at: this.now() };
    const landed = async (): Promise<number> => Number(((await this.record.raw(`SELECT COALESCE(MAX(log_pos), 0) AS pos FROM events WHERE kind IN ('agent.stop', 'verdict.made')`)) as { pos: number }[])[0]?.pos ?? 0);
    let ticked = await landed();
    const due = async (): Promise<boolean> => {
      const pos = await landed();
      if (pos > ticked) { ticked = pos; return true; }
      return (await this.record.raw(`SELECT 1 FROM asks WHERE status IN ('open', 'later') AND (deadline <= ? OR kind = 'unblock') LIMIT 1`, [this.now()])).length > 0;
    };
    // The hook programs are checked at start and every 10 minutes on the hub's clock (#993): no hook arrives to say they can't run.
    await this.hookPrograms().catch(() => undefined);
    this.every('hook-programs', 1000, () => this.hookPrograms());
    // A hook that missed its acknowledgement under load may be the last of its turn: its stop is judged without one to follow it (#580).
    this.every('spool', 2000, async () => { this.replayLate(); });
    if (this.options.plant !== 'skip-default-at-deadline') this.every('asks', 1000, async () => {
      const now = { wall: Date.now(), at: this.now() };
      if (now.wall - beat.wall > SLEPT) await asks.away(beat.at, now.at);
      beat = now;
      if (await due()) {
        await asks.tick();
        for (const { handle, data, resource } of await this.teardowns.defaulted()) void this.control.didIt(handle, resource.session, data).catch(() => undefined);
      }
      await this.delivery.continues();
    });

  }

  private async openResources(): Promise<ReturnType<EnvironmentProvider['resources']> & { leases: LeaseTable }> {

    this.mcp.index = this.providers.knowledge.index(this.root.wiki, this.options.index);
    this.mcp.index.catch(() => undefined);
    // Compose's own folder sits in the hub's, which no run writes: the files a compose stack runs are the hub's.
    const { compose, port } = this.providers.environment.resources(join(this.root.dir, 'compose'), this.options.plant !== 'env-leases-port-again');
    this.compose = compose;
    // The kernel's one lease table (#237): env-local declares its kinds there with their free checks, the core its
    // cpu.slot, and the supervisor takes every run's keys through it.
    const leases = this.leases = await openLeases({
      record: this.record, now: this.now, cores: CORES, ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}), ...(this.options.plant === 'fills-every-slot' ? { plant: this.options.plant } : {}),
    });
    for (const kind of this.providers.environment.leaseKinds) await leases.declare('env-local', kind, [port, compose].find((k) => k.kind === kind.name)?.free);
    // deep_drive's replicas (#124): a replica's process ends with the hub that started it, whose pipe was its stdin,
    // so a replica lease an earlier hub left is released.
    await leases.declare('core', REPLICA_LEASE);
    for (const v of await leases.leases()) if (v.lease.resource.kind === REPLICA_LEASE.name) await leases.release(v.lease.id, []);
    this.every('leases', 1000, () => leases.tick());
    // Heavy commands' kinds beside cpu.slot (#1015): browsers and stacks as pools drafted from the machine; the GPU
    // is env-local's, shared or exclusive.
    const pools = draftedPools(CORES);
    for (const [name, n] of Object.entries(pools)) await leases.declare('core', { name, match: `pool(${n})`, cap: 1000, cooldown: 0, cost: 0 });
    // The warm stacks' pool (#580): your settings size it, drafted as 4 on the reference Mac, an estimate until week 4 measures it.
    await leases.declare('core', { name: 'stack.slot', match: `pool(${this.stackSlots()})`, cap: 1000, cooldown: 0, cost: 0 });
    // One compile job pool per host (#1016): every build deep lease runs joins it.
    this.pool = new JobPool(join(this.root.dir, 'jobserver'), poolTokens(CORES));
    this.heavy = new HeavyQueue({
      table: leases, slow: SLOW_SLOT, now: this.now, pool: this.pool, ...(this.options.plant ? { plant: this.options.plant } : {}),
      append: async (kind, v, data, subject, session) => {
        const ts = this.now();
        const id = ulid(ts);
        const agent = session ? this.state.sessions.get(session)?.agent : undefined;
        await this.append(this.connection('core', session ? { session, ...(agent ? { agent } : {}) } : {}), { v, id, kind, ts, data: data as JsonValue, ...(subject ? { subject } : {}) });
        return id;
      },
      worktreeOf: (s) => [...this.state.sessions.values()].find((x) => letters(x.id) === s || x.id === s)?.cwd,
      agentOf: (s) => { const x = this.state.sessions.get(s); return x ? { pid: x.pid, start: x.start } : undefined; },
    });
    await this.heavy.recover(this.raw);
    await this.heavy.tick();
    this.every('heavy', 500, () => this.heavy.tick());
    this.every('gone', 1000, () => this.state.goneSessions());
    // Each session's state as last recorded, then any change since; a session goes quiet after a day with no hook.
    for (const row of (await this.record.raw("SELECT session_id, json_extract(data, '$.state') AS state, json_extract(data, '$.cause') AS cause FROM events WHERE kind = 'session.state' AND session_id IS NOT NULL ORDER BY log_pos")) as { session_id: string; state: string; cause: string }[]) this.state.states.set(row.session_id, `${row.state}/${row.cause}`);
    // The list's rows as last appended (#1463): a record with none yet is a backfill.
    for (const p of await listRows(this.raw)) this.state.rows.set(p.row.id, p);
    this.state.rowsFirst = this.state.rows.size === 0;
    // A job's row the last hub left listed (#1925): its tool's run ended with that hub, so the row leaves the list.
    for (const id of [...this.state.rows.keys()].filter((id) => id.startsWith('job:'))) this.state.jobRowAppend(id, null);
    this.state.statesRead = true;
    this.state.stateSoon();
    // Each minute every session is read again: a state that changes with time alone (quiet) has no append to say so.
    this.every('states', 60_000, async () => { this.state.touched = 'all'; this.state.stateSoon(); });
    this.every('unpushed', 60_000, () => this.flags.unpushedAgain());
    void this.run('unpushed', () => this.flags.unpushedAgain());
    this.every('gates', 1000, () => this.flags.gatesWatched());
    this.every('agents-reach', 1000, () => this.flags.agentsReached());
    // A live session's transcript is read between its hooks too: an agent retrying a model call fires none (#2019).
    this.every('transcripts', 2000, () => this.flags.transcriptsRead());
    // A background command whose process group has ended no longer holds its session's slow checks (#907); one that
    // ends mid-turn leaves them to the turn's stop. A monitor's watch ends the same way, or at its timeout, and an idle
    // session's row then reads its stop again (#997). An idle session whose facts have emptied starts what they held, and
    // the gate runner's timers come due on the hub's clock (#965). The planted wrong program reads the facts only at stops.
    this.every('background', 2000, async () => {
      for (const [id, live] of this.state.live) {
        for (const [call, b] of live.background) {
          let ended = b.watch?.expires != null && this.now() >= b.watch.expires ? 'its timeout passed' : undefined;
          if (!ended && b.group) try { process.kill(-b.group, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') ended = 'its process ended'; }
          if (!ended) continue;
          // Off the poll's path: the stop it makes final is judged, with its fast lane, while other sessions are read.
          if (b.watch) void this.judging.watchEnded(id, call, ended).catch(() => undefined);
          else live.background.delete(call);
        }
        if (live.state !== 'working' && this.options.plant !== 'rechecks-facts-at-stops-only') this.gate.idle(id, { background: live.background.size, crons: live.crons.size });
      }
      this.gate.tick();
    });
    return { port, compose, leases };
  }

  private async openExecution(port: ReturnType<EnvironmentProvider['resources']>['port'], compose: ComposeResource, leases: LeaseTable): Promise<void> {
    const asks = this.asks;
    this.supervisor = await openSupervisor({
      record: this.record, asks, now: this.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } },
      resources: [port, compose], leases,
      kept: join(this.root.dir, 'kept'),
      ...(this.options.plant === 'kept-in-service-cgroup' ? { plant: 'kept-in-service-cgroup' as const } : {}),
      ...(this.options.plant === 'env-holds-lease-for-helper' ? { plant: 'holds-lease-while-taken' as const } : {}),
      ...(this.options.plant === 'standin-value-in-env' || this.options.plant === 'standin-every-host' || this.options.plant === 'run-ca-in-login-keychain' || this.options.plant === 'sandbox-any-loopback' ? { plant: this.options.plant } : {}),
      ...(this.options.leaseMs ? { lease_ms: this.options.leaseMs } : {}),
      ...(this.options.crash ? { crash: this.options.crash } : {}),
      // No run, run-as-you included, writes the record, the agents' config folders or the Node the hub runs on;
      // the sandbox profile itself keeps every project's agent hook and MCP files. The runner's jobs/ is left to
      // each run's own grant: a job's checkout writes only its own folder.
      guarded: [
        { path: this.root.dir, except: [join(this.root.dir, 'jobs'), join(this.root.dir, 'checkouts'), join(this.root.dir, 'products', '.building'), join(this.root.dir, 'jobserver')] }, join(homedir(), '.claude'), join(homedir(), '.codex'), realpathSync(resolve(fileURLToPath(import.meta.url), '../../..')),
        join(homedir(), 'Library', 'LaunchAgents'),
        process.execPath, resolve(process.execPath, '../../lib/node_modules'),
        ...[process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME].filter((p): p is string => !!p && isAbsolute(p)),
        ...compose.guarded,
      ],
    });
    // The base-commit service (#31), its checkouts under the hub's root: opening removes what a crash left, whose
    // processes the supervisor has just reaped; no run writes the store, each only its own checkout.
    this.checkouts = await openCheckouts({
      store: join(this.root.dir, 'objects'), root: join(this.root.dir, 'checkouts'), kinds: [], host: this.supervisor, leases, now: this.now,
      ...(this.options.plant === 'git-inherits-env' ? { plant: 'git-inherits-env' } : this.options.plant === 'stand-in-always' ? { plant: 'stands-in-always' } : {}),
    });
    // The keys a stack leased per session before this start (#332): its processes were reaped as the supervisor opened,
    // so each ends now that the record proves them gone.
    for (const v of await leases.leases()) {
      if (!this.providers.environment.sessionKinds.includes(v.lease.resource.kind) || !(v.lease.holder === 'core' || v.lease.holder.startsWith('mcp:'))) continue;
      const [row] = (await this.record.raw(`SELECT json_extract(data, '$.run') AS run FROM events WHERE kind = 'lease.acquired' AND subject = ? LIMIT 1`, [v.lease.id])) as { run: string | null }[];
      if (row?.run) await this.stacks.adopt(row.run, v.lease.id);
    }
    this.host = this.options.host ? await this.providers.environment.host(this.supervisor, this.options.host) : this.supervisor;
    this.every('supervisor', 1000, () => this.supervisor.tick());
    // Shared build products (#1017): the store's index, its guard entry and its watch; session starts wait for it.
    await this.products.open();

  }

  private async openRunner(): Promise<ProjectTrust> {
    const asks = this.asks;
    const config = this.config();
    // A paid check's price comes from its kind's lookup; none is wired in version 0 but the tests' file, so a paid run with none is BLOCKED (#325).
    const ledger = this.ledger = await openLedger({ record: this.record, asks, now: this.now, price: async (run) => this.judging.priceOf(run.check) });
    // resolver-decisions ships on by default (#23): your saved decisions, and the budgets you approved, answer the
    // asks they cover, each answer gated by the core.
    asks.registerResolver('resolver-decisions', this.providers.decisions.resolver({ record: this.record, ledger }));
    this.delivery.precheck = this.providers.decisions.resolver({ record: this.record });
    await this.memory.syncStanding().catch(() => undefined);
    this.every('rules', HOUR, () => this.memory.judgeRules());
    // The runner reaps or reports what a crash cut, and ticks itself.
    this.runner = await openRunner({
      record: this.record, asks, supervisor: this.supervisor, ledger, now: this.now, root: this.root.dir, loginPath: config.loginPath, env: process.env, keychain,
      settings: { plan: { reserve_pct: config.reservePct }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    });
    this.sessionStarts = new Starts({
      credentials: this.providers.forge,
      root: this.root.dir, socket: this.root.socket, lock: this.root.lock, loginPath: () => this.config().loginPath, now: this.now, plant: this.options.plant,
      supervisor: () => this.supervisor, asks: () => asks, raw: this.raw, appendCore: (kind, data, extra) => this.appendCore(kind, data, extra),
      agentAbove: (peer) => this.state.agentAbove(peer), windowUsed: (agent, home) => this.runner.windowUsed(agent as JobSpec['agent'], home),
      forge: this.options.forge, agentsApp: () => this.forgeApp('agents'), gateToken: (repo) => this.gateToken(repo),
    });
    await this.sessionStarts.open();
    // Every installed extension loads, sandboxed until a signed release lists it; one refused is named and left out.
    const trust = this.trust = await openTrust({ record: this.record, now: this.now });
    return trust;
  }

  private async openExtensions(trust: ProjectTrust): Promise<void> {
    const leases = this.leases;
    await this.spaces.open();
    this.acceptance = new Acceptance({
      command: this.providers.checks.command,
      record: this.record, runner: () => this.runner, supervisor: () => this.supervisor, checkouts: () => this.checkouts, asks: () => this.asks, core: this.connection('core'), now: this.now, ...this.config().acceptance,
      append: (kind, data) => this.appendCore(kind, data),
      read: async (owner, name, n) => {
        const fetch = this.options.github ? recordedFetch(this.options.github) : liveFetch(this.options.forge, process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken());
        return (await readIssue(fetch, owner, name, n, undefined))?.[0];
      },
    });
    // Landing in turn (#1331): the forge's reads and merges with your login, the verdict's status with the gate's identity.
    this.landing = new Landing({
      root: this.root.dir, api: this.options.forge, plant: this.options.plant,
      repoOf: (remote) => this.providers.forge.repoOf(remote),
      token: async () => process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken(),
      gateToken: (repo) => this.gateToken(repo), gateApp: () => this.forgeApp('gate'),
      landingToken: (repo) => (this.landingTokens ??= this.providers.forge.gateTokens(this.options.forge, () => this.forgeApp('gate'), true))(repo),
      judge: (r) => this.judging.judgeLanding(r),
      sendBack: (r) => this.delivery.landingSendBack(r),
      appendCore: (kind, data, extra) => this.appendCore(kind, data, extra),
    });
    // #1922's planted hosts build a tool's digest wrongly: the host's plants, selected with the hub's variable.
    const plant = this.options.plant?.startsWith('job-build-') ? { plant: this.options.plant as 'job-build-entry-only' } : {};
    const extensions = this.extensions = await openExtensionHost({ record: this.record, supervisor: this.supervisor, trust, home: this.root.dir, release: [], now: this.now, leases, runner: this.runner, evidence: this.store, point: () => this.durable.point('terminals_rewrite'), ...plant });
    this.jobKinds = new Jobs({
      root: this.root.dir, now: this.now, host: () => this.extensions, plant: this.options.plant,
      keep: async (bytes, source) => (await this.control.stored(await this.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind: 'file', source, redaction: 'complete', license: { name: 'job output', allows: [] } }), `a job output from ${source}`)).sha256,
      has: async (sha) => (await this.store.get(sha)) !== undefined,
      read: (sha) => this.store.read(sha),
      adopt: async (bytes) => { await this.control.stored(await this.store.connect({ role: 'agent', session: 'unknown' }).put({ bytes, kind: 'file', source: 'unrecorded', redaction: 'unknown', license: { name: 'unknown', allows: [] } }), 'a file of unknown origin'); },
      send: (request, boundary) => this.store.send(request, boundary),
      raise: (source, ask, plan) => this.asks.raise(this.connection('core'), source, ask, plan),
      row: (job, running) => this.state.jobShown(job, running),
    });
    this.libraries = new Libraries({
      root: this.root.dir, now: this.now, host: () => this.extensions,
      keep: async (bytes, kind, source, license) => (await this.control.stored(await this.store.connect({ role: 'deepbuild', via: 'job' }).put({ bytes, kind, source, redaction: 'complete', license }), `${kind} from ${source}`)).sha256,
      keepFile: async (file, sha256, kind, source, license) => (await this.control.stored(await this.store.connect({ role: 'deepbuild', via: 'job' }).file({ file, sha256, kind, source, redaction: 'complete', license }), `${kind} from ${source}`)).sha256,
      has: (sha) => this.store.verify(sha),
      raise: (source, ask, plan) => this.asks.raise(this.connection('core'), source, ask, plan),
    });
    for (const pkg of await extensions.installed()) {
      // One installed by a hub that ran no conformance at install has no kept result: it runs now, once, so the
      // package loads from its result at this start and each later one, as one installed since #785 does. A check
      // that can't run (an untrusted project) is left to the load's refusal, which names it.
      if (!extensions.checked(pkg)) await extensions.check(pkg).catch(() => undefined);
      const load = await extensions.load(pkg);
      if (load.status === 'refused') process.stderr.write(`deep hub: extension ${pkg.id}@${pkg.version} not loaded: ${load.reason}\n`);
      // One installed before panel@1 ran at install has no kept verdict for its views: they run now, once.
      else await this.control.panelKits(pkg.id, true);
    }

  }

  private async recoverRecord(): Promise<void> {
    const extensions = this.extensions!;
    await this.spool.replay();
    // The replay is done: the extensions start, and each that can't is unloaded and named.
    await extensions.ready().catch((error: unknown) => process.stderr.write(`deep hub: ${error instanceof Error ? error.message : String(error)}\n`));
    // Your channels (#65): the asks reach you where you said, and each answer a channel returns is checked here.
    this.channels = new Channels({
      root: this.root.dir, hub: this.control.hubId(), now: this.now, plant: this.options.plant, devices: this.devices,
      loaded: () => extensions.channels(),
      call: (name, op, item, ctx) => (op === 'deliver' ? extensions.channel(name, op, item!, ctx) : extensions.channel(name, op, null, ctx)),
      asks: () => this.control.channelAsks(),
      append: (kind, data, subject) => this.appendCore(kind, data, subject ? { subject } : {}),
      answer: (handle, option, how) => this.control.answer({ ask: handle, option }, { role: how.proof === 'device' ? 'app' : 'cli' } as CallContext, how).then(() => undefined),
      cancel: (handle) => this.appendCore('ask.cancelled', { answer: 'cancel', plan_hash: null, decision: 'none' }, { subject: handle }),
    });
    this.channels.start();
    // A session that ended with turns still to judge sends no hook again: they are judged now.
    for (const [id, cursor] of this.transcripts.cursors) {
      if (typeof cursor.ended?.agent !== 'string' || typeof cursor.read !== 'number' || !Array.isArray(cursor.reached)) continue;
      this.transcripts.cursors.delete(id);
      const session: Session = { id, thread: id, agent: cursor.ended.agent, pid: 0, start: '', cwd: '', transcript: cursor.transcript, ended: true, read: cursor.read, turn: undefined, closed: [], reached: new Set(cursor.reached), pending: new Map(), prompts: new Map(), entries: [] };
      this.state.sessions.set(id, session);
      await this.transcriptReader.readTranscript(session, this.flags.modelCalled(session));
      this.transcriptReader.endTurn(session);
      this.transcripts.judge(session);
    }
    await this.judging.judgedAcrossRestart();
    await this.runs.recover();
    await this.control.retain();
    this.every('retention', DAY, () => this.control.retain());
    // Each staged copy is let go at its set time (#347): at start, then once an hour.
    await this.staging.prune().catch(() => undefined);
    this.every('staging', HOUR, () => this.staging.prune());
    if (this.options.failJob) this.testJob(this.options.failJob);

  }

  private async startBackground(): Promise<void> {
    const asks = this.asks;
    // The transcript archive (#20) copies what the agents' cleanups would delete, and the CI runs of the GitHub repos
    // recent sessions worked in before the forge's retention deletes them: at start, then once an hour, one pass at a time.
    const env: Record<string, string | undefined> = { ...process.env };
    const repos: string[] = [];
    const archive = await this.providers.knowledge.archive({
      record: this.record, evidence: this.store, asks, env, connection: this.connection('ext:deepbuild/archive'), now: this.now,
      held: () => this.options.held, forge: { api: this.options.forge, repos }, plant: this.options.plant,
    });
    let archiving: Promise<void> | undefined;
    const archivePass = () => {
      archiving ??= (async () => {
        env.GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? (await ghToken());
        // With no token the forge's logs can't be read, so no run is asked for.
        repos.splice(0, repos.length, ...(env.GH_TOKEN ? await this.control.forgeRepos() : []));
        await archive.pass();
      })().catch((error: unknown) => { process.stderr.write(`deep hub: archive: ${error instanceof Error ? error.message : String(error)}\n`); })
        // The archive's text index follows each pass, whatever the pass copied (#1515): a session it doesn't hold yet is read from its transcript.
        .then(() => this.record.indexTranscripts()).catch((error: unknown) => { process.stderr.write(`deep hub: archive index: ${error instanceof Error ? error.message : String(error)}\n`); })
        .finally(() => { archiving = undefined; });
      return archiving;
    };
    archivePass();
    this.archiveSession = (session) => archive.session(session);
    this.archivedSessions = () => archive.archived();
    this.every('archived-threads', ARCHIVED_THREADS_MS, () => this.state.archivedThreads());
    // Setup's wiki build (#356) starts from a pass of its own, after the one at start has finished.
    this.wikiBuild = this.providers.knowledge.wiki({
      record: this.record, root: this.root, store: this.store, runner: this.runner, asks, now: this.now, archive: async () => { await archiving; await archivePass(); },
      core: this.connection('core'), cli: this.connection('cli'), plant: this.options.plant, held: this.options.held,
    });
    this.timers.push(setInterval(archivePass, HOUR));
    this.github = this.openGitHub();
    this.timers.push(setInterval(() => void this.github?.pass(), GITHUB_PASS_MS));
    this.timers.push(setInterval(() => void this.spaces.driftAll(), DRIFT_MS));
    // While appends fail, a small synced write is tried every quarter second; the gates come back with it.
    this.timers.push(setInterval(() => { if (this.blocked && !this.lost && this.durable.probe(this.root.dir)) { this.blocked = undefined; this.replayLate(true); } }, 250));
    // Between session starts, a removed or weakened entry of ours in Claude Code's settings goes back at once.
    const settingsWatch = this.claudeSettings.watch();
    if (settingsWatch) this.timers.push(settingsWatch);
    // A sync a stop cut short is recovered from its journal before anything else is synced (#148).
    void this.agents.recoverAtStart().catch((error: unknown) => process.stderr.write(`deep hub: agent syncs not recovered: ${error instanceof Error ? error.message : String(error)}\n`));
    // The promised checks the record still holds wait on, armed again (#120).
    await this.delivery.restorePromises().catch(() => undefined);
    await this.acceptance.open();
    // The session map and what its notices delivered, and the loop rule's count, read back (#352).
    await this.siblings.restore().catch(() => undefined);
    for (const timer of this.timers) timer.unref();

  }

  /** The github extension (#46): what it reads of the hub, and where its status lands. */
  private openGitHub(): ForgeObserver {
    const plant = (['posts-on-head', 'unguarded-marks-every-push', 'unguarded-marks-none'] as const).find((p) => p === this.options.plant);
    return this.providers.forge.open({
      api: this.options.forge, state: join(this.root.dir, 'github.json'), snapshots: join(this.root.dir, 'objects'), raw: this.raw,
      reads: async () => process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? await ghToken(),
      // The gate's own identity once your settings name it; until then your login, which no ruleset counts (#1325).
      posts: async (repo) => (this.forgeApp('gate') ? this.gateToken(repo) : process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN),
      settings: () => {
        let github: { delivery?: unknown; yours?: unknown } | undefined;
        try { github = (JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as { github?: typeof github }).github; } catch { /* none yet: nothing is on */ }
        return { delivery: isObj(github?.delivery) ? github.delivery : {}, yours: Array.isArray(github?.yours) ? github.yours.map(String) : [] };
      },
      sessions: () => [...this.state.live].map(([id, l]) => ({ id, agent: l.agent, cwd: l.cwd })),
      unguarded: (session, data) => {
        const ts = this.now();
        return this.append(this.connection('core', session ? { session: session.id, agent: session.agent } : {}), { v: 1, id: ulid(ts), kind: 'ref.unguarded', ts, ...(session ? { subject: `session:${letters(session.id)}` } : {}), data });
      },
      pushed: (_repo, change) => this.sessionStarts.pushed(change),
      hear: (session, text) => { this.delivery.later(session.id, session.cwd, text); this.delivery.offer(session.id); },
      ...(plant ? { plant } : {}),
    });
  }
  /** An app your settings name as `github.gate` or `github.agents` (#1325): its ID, and its key from the Keychain service named. */
  private forgeApp(which: 'gate' | 'agents'): AppKey | undefined {
    let app: unknown;
    try { app = (JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as { github?: Obj }).github?.[which]; } catch { /* none yet */ }
    if (!isObj(app) || !Number.isSafeInteger(app.app_id) || typeof app.key !== 'string' || !app.key) return undefined;
    const service = app.key;
    return { app_id: app.app_id as number, key: () => keychain(service) };
  }
  private gateTokens?: (repo: string) => Promise<string | undefined>;
  /** The gate's landing tokens (#1331), minted in this process and kept only in its memory, as its status tokens are. */
  private landingTokens?: (repo: string) => Promise<string | undefined>;
  /** The gate's token for a repo: minted in this process, kept only in its memory. */
  private gateToken(repo: string): Promise<string | undefined> {
    return (this.gateTokens ??= this.providers.forge.gateTokens(this.options.forge, () => this.forgeApp('gate')))(repo);
  }
  /** `stack.slot` in <root>/config.json: how many warm stacks this machine keeps. */
  private stackSlots(): number {
    let slot: unknown;
    try { slot = (JSON.parse(readFileSync(join(this.root.dir, 'config.json'), 'utf8')) as { stack?: { slot?: unknown } }).stack?.slot; } catch { /* none yet */ }
    return typeof slot === 'number' && Number.isInteger(slot) && slot > 0 ? slot : 4;
  }
  /** What setup wrote to <root>/config.json for the runner: the login shell's PATH and the plan's reserve. */
  private config(): { loginPath: string; reservePct: number; rules: { margin: number; windowMs: number }; acceptance: { slots: number; gateKey: string | null } } {
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
      // The issues that run at once, and the gate identity's key (#1325): with none, a swap goes to you.
      acceptance: { slots: isObj(c.acceptance) && typeof c.acceptance.slots === 'number' ? c.acceptance.slots : 1, gateKey: isObj(c.gate) && typeof c.gate.key === 'string' ? c.gate.key : null },
    };
  }

  private writeState(state: 'running' | 'stopped'): void {
    writeAtomic(this.root.state, Buffer.from(`${state}\n`));
  }

  // ---- Appends.

  /**
   * An event's connection: its actor is the person whose connection sent it, or for the core's own events the person
   * whose session they are about, never a field the event carries (#1337); its scope is who may see it.
   */
  private connection(writer: string, extra: Partial<Connection> = {}): Connection {
    const project = extra.project ?? (extra.session ? this.state.projects.get(extra.session) : undefined);
    const actor = extra.actor ?? (extra.session ? this.state.sessionPeople.get(extra.session) : undefined) ?? OWNER;
    return { writer, actor, scope: scopeOf(this.people, actor, project), ...(project ? { project } : {}), ...extra };
  }
  /** Appends one event; a storage failure turns every gate watch-only, BLOCKED, until a write succeeds again. */
  private async append(connection: Connection, input: EventInput, backfill = false): Promise<void> {
    if (this.lost) throw Error(this.blocked);
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
  private appendCore(kind: string, data: Obj, extra: { id?: string; subject?: string; evidence?: string[]; v?: number } = {}, who: Partial<Connection> = {}): Promise<void> {
    const ts = this.now();
    return this.append(this.connection('core', who), { v: 1, id: extra.id ?? ulid(ts), kind, ts, data: data as JsonValue, ...extra });
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
      const at = this.now();
      const last = this.jobs.get(name);
      this.jobs.set(name, { failures: (last?.failures ?? 0) + 1, since: last?.since ?? at, at, error: error instanceof Error ? error.message : String(error) });
    }
  }
  /** The test job (#909): one run per line a test appends to `file`, `fail` a failed run and `ok` a clean one. */
  private testJob(file: string): void {
    this.jobs.set('test', null);
    let taken = 0;
    this.timers.push(setInterval(() => {
      const lines = readFileSync(file, 'utf8').split('\n').slice(0, -1);
      for (const run of lines.slice(taken)) void this.run('test', async () => { if (run === 'fail') throw Error('the test job failed'); });
      taken = lines.length;
    }, 200));
  }
  /** The hub's lock file is no longer the one it holds (#909): another hub may start on it, so this one appends nothing more. */
  lockLost(path: string): void {
    this.lost = true;
    this.blocked = `BLOCKED: lock lost: ${path} is no longer the file this hub holds locked; stop this hub and start it again`;
  }
  /**
   * Checks the programs the hook entries run (#993), when due: the agents a failing program's settings serve have their
   * gates watch-only, and each of their open sessions reads BLOCKED until a check finds the program again. A session
   * already reading the same is left as it is, so a restart or the next check appends nothing new.
   */
  private async hookPrograms(): Promise<void> {
    if (this.now() < this.hookCheckDue) return;
    this.hookCheckDue = this.now() + HOOK_CHECK_MS;
    const found = unrunnable(this.root.dir);
    this.cantRun = [...new Set(found.flatMap((u) => RUN_BY[u.agent]))].sort();
    this.askingSoon();
    for (const [owner, agents] of Object.entries(RUN_BY)) {
      const problem = found.filter((u) => u.agent === owner).map(describe).join('; ');
      const open = (await this.record.raw(`SELECT id, agent, last_seen FROM sessions WHERE agent IN (${agents.map(() => '?').join(', ')}) AND id NOT IN (SELECT session_id FROM events WHERE kind IN ('session.end', 'session.gone', 'session.archived') AND session_id IS NOT NULL)`, [...agents])) as { id: string; agent: string; last_seen: number | null }[];
      for (const s of open) {
        // A reading counts as the session seen, so one quiet for a day reads BLOCKED only if it already did.
        const quiet = (s.last_seen ?? 0) < this.now() - DAY;
        const [last] = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS text FROM events WHERE session_id = ? AND kind = 'session.reading' AND (json_extract(data, '$.reading') LIKE ? OR json_extract(data, '$.reading') LIKE ?) ORDER BY log_pos DESC LIMIT 1`, [s.id, `${CANT_RUN}%`, `${CAN_RUN}%`])) as { text: string }[];
        if (problem && quiet && !last?.text.startsWith(CANT_RUN)) continue;
        const text = problem ? `${CANT_RUN}, so this session's holds and every block but the floor are watch-only: ${problem}. Run \`deep setup\` to point them at a deep-hook that runs.` : last?.text.startsWith(CANT_RUN) ? `${CAN_RUN}: this session's gates hold again.` : undefined;
        if (text && text !== last?.text) await this.queue(async () => { await this.appendReading(s.id, s.agent, text); await this.flags.watchOnly(s.id, s.agent, 'hooks', text.startsWith(CANT_RUN)); });
      }
    }
  }
  /**
   * A sync landed (#148): each live session of an agent it reached that started before it runs the older set, until
   * its own evidence shows otherwise; for Codex, whose sessions share a daemon, that daemon is named by its PID.
   */
  private async olderSet(sync: Sync): Promise<void> {
    await this.ready;
    const at = sync.completed ?? this.now();
    const reached = new Set(sync.agents);
    for (const s of [...this.state.sessions.values()]) {
      if (s.ended || !reached.has(s.agent === 'claude' ? 'claude-code' : s.agent)) continue;
      const [row] = (await this.record.raw(`SELECT MAX(ts) AS ts FROM events WHERE session_id = ? AND kind = 'session.start'`, [s.id])) as { ts: number | null }[];
      if (row?.ts === null || row?.ts === undefined || row.ts > at) continue;
      const text = s.agent === 'codex'
        ? `${OLDER_SET} Codex's daemon (pid ${s.pid}${s.start ? `, started ${s.start}` : ''}) started before sync:${sync.id} landed, so this session loads the new MCP servers and skills only once it starts from a daemon started since.`
        : `${OLDER_SET} it started before sync:${sync.id} landed, and loads the new MCP servers and skills only once it starts again.`;
      await this.queue(() => this.appendReading(s.id, s.agent, text));
    }
  }
  /** A session's start from a process started after the sync its row names: its own evidence of the new set (#148). */
  private async newSet(session: Session, meta: HookMeta): Promise<void> {
    // Its own start: its transcript, from a process of its agent's own binary, a Codex daemon started since included.
    if (meta.transcript && resolve(meta.transcript) !== session.transcript) return;
    // npm's Codex runs as node with its bin script, its native build as codex itself.
    const binaries = meta.agent === 'codex' ? [CODEX_BINARY, /@openai\/codex\/bin\/codex\.js(?:\s|$)/] : meta.agent === 'claude-code' || meta.agent === 'claude' ? [CLAUDE_BINARY] : [];
    const args = binaries.length ? await this.state.parentArgs(meta) : '';
    if (binaries.length && !binaries.some((b) => b.test(args))) return;
    const ppid = meta.ppid;
    const [last] = (await this.record.raw(`SELECT ts, json_extract(data, '$.reading') AS text FROM events WHERE session_id = ? AND kind = 'session.reading' AND (json_extract(data, '$.reading') LIKE ? OR json_extract(data, '$.reading') LIKE ?) ORDER BY log_pos DESC LIMIT 1`, [session.id, `${OLDER_SET}%`, `${NEWER_SET}%`])) as { ts: number; text: string }[];
    if (!last || last.text.startsWith(NEWER_SET)) return;
    const started = Date.parse((await this.state.startOf(ppid, true)) ?? '');
    if (!(started > last.ts)) return;
    await this.queue(() => this.appendReading(session.id, session.agent, `${NEWER_SET} its process started after the sync its row named, so it loads the MCP servers and skills synced since.`));
  }
  /** A session.reading for the session, appended as the core. */
  private appendReading(session: string, agent: string, reading: string, hook?: string): Promise<void> {
    return this.appendCore('session.reading', { reading }, hook && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(hook) ? { id: hook } : {}, { session, agent });
  }

  // ---- Hooks.

  /** A Claude Code stop whose payload says server_error, under 10 minutes old: the try of the host its API calls go to. */
  private tryNetwork(drafts: Draft[], meta: HookMeta, tries = new Map<string, Promise<boolean>>()): Promise<void> | undefined {
    if ((meta.agent !== 'claude-code' && meta.agent !== 'claude') || meta.fields?.error !== 'server_error' || this.now() - (drafts[0]?.ts ?? 0) >= 10 * 60_000) return undefined;
    const host = apiHost();
    const trying = tries.get(host) ?? reachable(host);
    tries.set(host, trying);
    return trying.then((reached) => { meta.network = { host, reached }; });
  }

  /**
   * One hook's events, checked and handed to the record in the order hooks arrived; the next hook waits only
   * for that, not for the commit. Resolves once each append settled.
   */
  /** A hook another machine spooled for this hub while its link was down (#1338): recorded once, as a spool's line is. */
  async replayed(drafts: Draft[], meta: HookMeta): Promise<void> {
    this.delivery.track(meta);
    await (await this.queue(() => this.handleHook(drafts, meta, 'hook', true))).settled;
  }
  hook(drafts: Draft[], meta: HookMeta, writer: string): Promise<void> {
    this.delivery.track(meta);
    // What deep-hook spooled ran before this hook, so a replay this hook starts, or one running, goes first.
    this.replayLate();
    const replayed = this.replaying ?? Promise.resolve();
    // A network stop's try runs before it queues, so it holds no other hook of any session (#85).
    const tried = this.tryNetwork(drafts, meta);
    const handled = replayed.then(() => tried).then(() => this.queue(() => this.handleHook(drafts, meta, writer))).then(({ settled }) => settled);
    if (!tried) return handled;
    // It was acknowledged, so nothing else keeps it: the hub stops only once it's in the record.
    const kept = handled.catch(() => undefined).finally(() => this.tried.delete(kept));
    this.tried.add(kept);
    return handled;
  }
  /** Whether a hook is a Claude Code prompt whose transcript entry isn't written yet, so its origin can't be read (#567). */
  private async entryLater(meta: HookMeta): Promise<boolean> {
    const id = meta.fields?.prompt_id;
    if (meta.event !== 'UserPromptSubmit' || !id || !meta.transcript || childPrompt(meta) || (meta.agent !== 'claude-code' && meta.agent !== 'claude')) return false;
    // The wrong program assumes a person now, without waiting for the transcript's origin evidence.
    if (this.options.plant === 'unplaced-is-person') return false;
    if (this.state.sessions.get(meta.session)?.prompts.has(id)) return false;
    const tail = await this.transcriptReader.tail(meta.transcript, 4 << 20).catch(() => '');
    return !tail.split('\n').some((l) => l.includes(id) && l.includes('"promptId"'));
  }
  /** Handles the session's prompt set aside for its entry, if any, with whatever the transcript now shows. */
  private async placeHeld(session: string): Promise<void> {
    const held = this.unplaced.get(session);
    if (!held) return;
    this.unplaced.delete(session);
    clearTimeout(held.timer);
    const handled = this.handleHook(held.drafts, held.meta, held.writer, false, false, true);
    held.done(handled.then(({ settled }) => settled));
    await handled.catch(() => undefined);
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
    if (!this.spool.waiting(kept)) return;
    // A hub that couldn't start replays nothing; its start reports why.
    this.replaying = this.ready
      .then(() => this.spool.replay(), () => undefined)
      .catch((error: unknown) => process.stderr.write(`deep hub: the spool replay stopped: ${error instanceof Error ? error.message : String(error)}\n`))
      .finally(() => {
        this.replaying = undefined;
        // The turns that waited on the replay are judged now, after the hooks queued before.
        void this.queue(async () => {
          for (const session of this.state.sessions.values()) {
            if (!session.deferred) continue;
            session.deferred = false;
            this.transcripts.judge(session);
          }
        }).catch(() => undefined);
        // A stop that missed its acknowledgement has no reply to wait for: the turn it ended is judged now.
        for (const session of this.lateStops.splice(0)) void this.judging.judgeEnded(session).catch(() => undefined);
        // What was spooled during the replay, and the files it kept if appends came back, are taken now.
        const kept = this.retake;
        this.retake = false;
        if (!this.blocked) this.replayLate(kept);
      });
  }
  /**
   * Runs `work` after everything queued before it, and after the start, which the spool replay is part of. Work that
   * waits for the start joins the queue only once the start is done: a hook that reaches the hub while it starts
   * would otherwise hold the queue until the start ends, and the start's own replay, queued behind it, never would (#669).
   */
  private queue<T>(work: () => Promise<T>, starting = false): Promise<T> {
    if (!starting && !this.opened) return this.ready.then(() => this.queue(work));
    const done = this.chain.then(work);
    this.chain = done.catch(() => undefined);
    return done;
  }

  private async routeHook(drafts: Draft[], meta: HookMeta, writer: string, replayed: boolean, waited: boolean, placing: boolean): Promise<{ settled: Promise<void> } | undefined> {
    // A prompt set aside for its entry goes first: the session's next hook means its turn has begun (#567).
    if (!placing) await this.placeHeld(meta.session);
    if (!placing && !replayed && await this.entryLater(meta)) {
      let done!: (settled: Promise<void>) => void;
      const settled = new Promise<void>((resolve, reject) => { done = (s) => void s.then(resolve, reject); });
      const timer = setTimeout(() => void this.queue(() => this.placeHeld(meta.session)).catch(() => undefined), PROMPT_PLACE_MS);
      timer.unref();
      this.unplaced.set(meta.session, { drafts, meta, writer, timer, done });
      return { settled };
    }
    // The planted wrong program answers the first PostToolUse it reads and appends nothing for it.
    if (this.options.plant === 'drops-post-tool-use' && meta.event === 'PostToolUse' && !this.dropped) {
      this.dropped = true;
      return { settled: Promise.resolve() };
    }
    // A spooled line whose hook the hub already recorded live changes nothing: no count, no stamp, no append.
    if (replayed && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(meta.id)) {
      // Its live copy may be acknowledged and still on its way to the record.
      await Promise.allSettled([...this.inflight]);
      const known = await this.record.raw(`SELECT json_extract(data, '$.late') AS late FROM events WHERE id ${this.options.plant === 'replay-keeps-place-by-id' ? '>=' : '='} ? LIMIT 1`, [meta.id]);
      if (known.length) {
        // Unless deep-hook gave up on an acknowledgement the hub sent just too late: the live copy is in the record
        // unmarked while deep-hook acted on its own, so the session says so rather than the fail-open going unseen.
        if (meta.late && Number((known[0] as { late?: unknown }).late) !== 1) return { settled: this.lateAnswered(meta, meta.late.matched) };
        return { settled: Promise.resolve() };
      }
    }
    // A heavy command deep-hook let through with the hub away ran unleased (#1015): its session's row says so. With
    // the hub only late, deep-hook leased it itself where the agent's call can be rewritten or denied.
    const leasedAlone = meta.late && (meta.agent === 'claude-code' || meta.agent === 'codex');
    if (replayed && meta.event === 'PreToolUse' && meta.heavy && !leasedAlone && typeof meta.call?.input.command === 'string') {
      await this.appendReading(meta.session, meta.agent, `\`${excerpt(meta.call.input.command)}\` ran unleased: the hub was away when it started, so it took no cpu.slot (heavy command ${meta.heavy.name})`).catch(() => undefined);
    }
    // A call whose prompt went to you has run, live or replayed: offered back as a decision to save (#23).
    if (meta.event === 'PostToolUse' && meta.call) void this.delivery.offerBack(meta).catch(() => undefined);
    if (drafts.some((d) => d.kind === 'session.end' && d.data.reason === 'clear')) await this.delivery.replaced(meta.session);
    if (drafts.some((d) => d.kind === 'session.end')) {
      void this.control.leftProject(meta.session);
      // Copied now, verified or not: a desktop app deletes what follows this hook (#342), and a copy changes nothing.
      void this.archiveSession?.(meta.session).catch((error: unknown) => process.stderr.write(`deep hub: archive of ${meta.session}: ${error instanceof Error ? error.message : String(error)}\n`));
    }
    if (meta.printed) void this.sessionStarts.refusals(meta.session, meta.toolUse, meta.printed).catch(() => undefined);
    if (meta.ran && meta.cwd) void this.teardowns.saw({ session: meta.session, agent: meta.agent, cwd: meta.cwd, call: meta.toolUse ?? meta.id, ...meta.ran }).catch(() => undefined);
    if (meta.event === 'UserPromptSubmit' && this.options.plant === 'typed-saves-decision') {
      this.delivery.typedAt.set(meta.session, Date.now());
      void this.delivery.typedSaves(meta.session).catch(() => undefined);
    }
    const whose = await this.state.whose(meta, drafts.find((d) => d.seq !== undefined)?.seq);
    if (whose.job) {
      const settled = this.appendCore('job.event', { job: whose.job, event: meta.event });
      settled.catch(() => undefined);
      return { settled };
    }
    if (whose.wait && !waited) {
      // Held, not queued: the hooks behind it go on; it is read again once its job's session ID is known.
      const settled = this.state.park(whose.wait).then(() => this.queue(() => this.handleHook(drafts, meta, writer, replayed, true))).then(({ settled: s }) => s);
      settled.catch(() => undefined);
      return { settled };
    }
    if (whose.reading && !this.state.readings.has(`${meta.session}\0${whose.reading.job}`)) {
      this.state.readings.add(`${meta.session}\0${whose.reading.job}`);
      await this.appendReading(meta.session, meta.agent, whose.reading.text).catch(() => undefined);
    }
    // The server's watch-only for hooks that can't run (#993) is no version's: the session is still verified. A hook
    // arriving says a hook program ran, so the programs are checked again at the next tick.
    if (meta.cantRun) {
      delete meta.watchOnly;
      this.hookCheckDue = 0;
    }
    // A session on a version its facts don't cover is recorded unverified, with one reading naming the version.
    if (!meta.version && meta.transcript) {
      const version = versionOf(meta.transcript);
      if (version) Object.assign(meta, { version, ...(coveredBy(meta.agent, version) ? {} : { watchOnly: true }) });
    }
    if (meta.caller && meta.session && !this.state.miscalled.has(meta.session)) {
      this.state.miscalled.add(meta.session);
      await this.appendReading(meta.session, meta.agent, meta.caller).catch(() => undefined);
    }
    return undefined;
  }
  private async handleHook(drafts: Draft[], meta: HookMeta, writer: string, replayed = false, waited = false, placing = false): Promise<{ settled: Promise<void> }> {
    const early = await this.routeHook(drafts, meta, writer, replayed, waited, placing);
    if (early) return early;
    const verified = meta.watchOnly || await this.delivery.tokenTaken(meta) ? false : this.delivery.checked(meta, await this.state.verify(meta));
    // A session's first hook from under a run DeepBuild started (#1330): its start.session first, so its first event names the run.
    if (meta.session) await this.sessionStarts.sessionOf(meta.session, meta.ppid, meta.agent).catch(() => undefined);
    const unread = Boolean(meta.watchOnly && meta.session && !this.state.versioned.has(meta.session));
    if (unread) {
      this.state.versioned.add(meta.session);
      await this.appendReading(meta.session, meta.agent, meta.paseo?.lacks ?? `This session runs ${meta.agent} ${meta.version}, past the versions its facts cover: it is recorded unverified, and its holds and every block but the floor are watch-only until the live smoke test widens the range to ${meta.version}. The floor still holds: its fail_closed guard entries deny as they do with the hub stopped.`).catch(() => undefined);
    }
    await this.flags.versionRead(meta, unread);
    const session = this.state.sessions.get(meta.session);
    if (session && (verified || this.options.plant === 'ends-binding')) {
      // Only an event checked against its session acts on it: an unverified SessionEnd ends nothing.
      // pi resumes a session it replaced in the same process, so the same session can start again.
      if (meta.event === 'SessionStart' && meta.agent === 'pi') session.ended = false;
      if (meta.event === 'SessionEnd') this.state.sessionOver(session);
      // A replayed PreToolUse was let through late; its call has run, so it stamps nothing a later call could bind.
      if (verified && meta.stamp && !replayed) this.mcp.stamps.push({ session: session.id, tool: meta.stamp.tool, digest: meta.stamp.digest });
    }
    const call = session && verified && drafts.length ? meta.toolUse : undefined;
    if (session && call) session.pending.set(call, (session.pending.get(call) ?? 0) + 1);
    // A switch to a leased screen counts once it ran: Claude Code sends PostToolUse only for a call that succeeded (#332).
    if (session && verified && meta.event === 'PostToolUse' && meta.call && /(^|_)switch_display$/.test(meta.call.tool) && SCREEN_TOOLS.some((prefix) => meta.call!.tool.startsWith(prefix))) await this.switched(session.id, String(meta.call.input.display ?? ''));
    if (session && verified) {
      await this.transcriptReader.readTranscript(session, this.flags.modelCalled(session));
      if (meta.event === 'SessionEnd') this.transcriptReader.endTurn(session);
      this.transcripts.judge(session);
      // Written at once, like a session's first cursor: no later hook of the session would write it.
      if (meta.event === 'SessionEnd') {
        this.transcripts.writeCursors();
        this.state.endedOrder.delete(session.id);
        this.state.endedOrder.add(session.id);
        this.state.forgetEnded();
      }
    }
    await this.enrich(drafts, meta, session && verified ? session : undefined);
    // A session's start is its own evidence of the set it loads (#148), from the process it starts in.
    if (meta.event === 'SessionStart' && session && !FOREIGN.has(meta.agent)) void this.newSet(session, meta).catch(() => undefined);
    // The session's newest stop, with its cause and owner read: one whose task is open holds the turns DeepBuild
    // would start there until the task closes (#85); any other stop ends an earlier hold.
    const stopped = meta.session && !meta.fields?.agent_id ? drafts.find((d) => d.kind === 'agent.stop') : undefined;
    if (stopped) this.delivery.routesOf(meta.session, meta.cwd).blocked = holdsTurns(stopped.data) ? String(stopped.data.cause) : undefined;
    // The cut-off turn's unknown sends are the continue's business: a turn that ended normally, or a prompt you typed,
    // ends their denial, so a later identical send of yours runs. Not the prompt that carries a parked continue itself:
    // the block goes with it, and its turn is the one the denial is for.
    const carrying = this.delivery.routes.get(meta.session ?? '');
    const typedNow = drafts.some((d) => d.kind === 'user.ask' && d.data.from === 'person' && !d.queued) && !carrying?.later.length && !carrying?.handed?.length;
    if (meta.session && this.delivery.unknownSends.has(meta.session) && ((stopped && stopped.data.outcome !== 'failed') || typedNow)) {
      this.delivery.unknownSends.delete(meta.session);
      this.askingSoon();
    }
    // After a restart the core knows a session's state from its next hook on; a person's status question, which
    // changes none, takes the row's before the prompt's event reads as work (#83). Read before the queue's splice,
    // which may take the prompt's own draft.
    if (session && verified && !replayed && meta.event === 'UserPromptSubmit' && isStatusQuestion(meta.fields?.prompt ?? '') && drafts.some((d) => d.kind === 'user.ask' && d.data.from === 'person')) {
      const live = this.state.liveOf(meta);
      if (live.state === undefined) {
        const [row] = (await this.record.raw(`SELECT status FROM sessions WHERE id = ?`, [meta.session])) as { status: string | null }[];
        if (row?.status) live.state = row.status;
      }
    }
    if (session && verified && !replayed) {
      await this.promptless(drafts, meta, session);
      this.queuedAsks(drafts, session, meta.event);
      if (meta.event === 'UserPromptSubmit') this.delivery.appNotes(drafts, meta.session);
    }
    const count = this.judging.counters.get(meta.session) ?? await this.judging.counterOf(meta.session);
    const { appends, claimed, live, typed } = this.appendHookDrafts(drafts, meta, writer, verified, count);
    const done = await this.settleHook(drafts, meta, verified, replayed, session, call, appends, claimed, live, typed);
    // Only live session hooks reach rules; jobs and unresolved ownership returned at routeHook above.
    if (!replayed) {
      if (meta.event === 'SessionEnd') this.memory.ruleState.delete(meta.session);
      if (meta.event === 'PreToolUse' || meta.event === 'PostToolUse') await this.memory.ruleHook(meta).catch((error: unknown) => process.stderr.write(`deep hub: rules at ${meta.session}'s call: ${error instanceof Error ? error.message : String(error)}\n`));
    }
    return done;
  }
  private async settleHook(drafts: Draft[], meta: HookMeta, verified: boolean, replayed: boolean, session: Session | undefined, call: string | undefined, appends: Promise<void>[], claimed: boolean, live: Live, typed: { text: string; task: string | undefined }[]): Promise<{ settled: Promise<void> }> {
    this.state.follow(drafts, meta, verified);
    if (typed.length) {
      this.state.acks.set(meta.session, [...(this.state.acks.get(meta.session) ?? []), ...typed]);
      this.state.midTurn.set(meta.session, [...(this.state.midTurn.get(meta.session) ?? []), ...typed.map((t) => t.text)].slice(-32));
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
      // A stop drops what its turn no longer asks as it lands (#84).
      if (drafts.some((d) => d.kind === 'agent.stop')) void this.asks.tick().catch(() => undefined);
    });
    settled.catch(() => undefined);
    // Replayed permission prompts still raise an ask once their request is recorded (#2026).
    const readBefore = this.options.plant === 'asks-keep-place-by-id' && meta.id <= this.askedThrough;
    if (this.options.plant === 'asks-keep-place-by-id' && !readBefore) this.askedThrough = meta.id;
    if (replayed && !readBefore && !meta.late && meta.event === 'PermissionRequest' && meta.call && meta.session && !meta.watchOnly && PROMPTED.has(meta.agent)) {
      const call = meta.call;
      void settled.then(async () => { this.delivery.prompts.add((await this.holds.asked(meta, aboutPermission(call.tool, call.input))).ask); })
        .catch((error: unknown) => process.stderr.write(`deep hub: the replayed permission request ${meta.id} raised no ask: ${error instanceof Error ? error.message : String(error)}\n`));
    }
    // The session map reads the hook before its reply is asked for (#352), once its appends are watched.
    if (verified && meta.session && !FOREIGN.has(meta.agent)) await this.siblings.hook(drafts, meta).catch(() => undefined);
    // A third alike failure in a row hears so once, in this call's reply (#2019).
    const failed = verified && meta.session && !FOREIGN.has(meta.agent) ? drafts.find((d) => d.kind === 'tool.after' && d.data.outcome === 'failed') : undefined;
    if (failed) await this.flags.repeated(meta, failed).catch(() => undefined);
    // A stop that leaves the agent's question open is recorded as waiting on you once the stop is in the record (#27).
    if (meta.event === 'Stop' && drafts.some((d) => d.kind === 'agent.stop' && d.data.outcome !== 'failed')) {
      void settled.then(async () => { if (await this.state.asksYou(meta.session)) await this.state.attention(meta.session, meta.agent, 'waiting'); }).catch(() => undefined);
    }
    // A stop the rule reads as a claim recomputes its tasks' definitions' hashes once the stop is in the record; the
    // agent's final message is what the claim cites, for the validity gate (#29).
    if (claimed) this.judging.lastMessage.set(meta.session, meta.fields?.last_assistant_message ?? '');
    if (claimed && replayed) this.lateStops.push(meta.session);
    // A stop while a monitor's watch runs isn't final (#997): its claims are made once the watch ends, as this stop
    // reads them now, and its row reads waiting on the watch at every stop, held or not, since its events are the
    // session's next turns.
    if (meta.event === 'Stop' && verified && watching(live).length) void settled.then(() => this.appendReading(meta.session, meta.agent, waitingOn(watching(live)))).catch(() => undefined);
    if (claimed) {
      const early = !(live.claim && live.claimTurn === live.turn && !live.workedSinceClaim);
      const task = this.judging.turnTaskOf(meta.session, live);
      const claim = async () => this.tasks.claim(meta.session, meta.agent, meta.cwd, { early, task: await task });
      if (watching(live).length) live.deferred = claim;
      else live.claiming = settled.then(claim).catch((error: unknown): string[] => { process.stderr.write(`deep hub: the claim at ${meta.id} was not recorded: ${error instanceof Error ? error.message : String(error)}\n`); return []; });
    }
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
        void this.queue(async () => this.transcripts.judge(session), true).catch(() => undefined);
      });
    }
    if (verified && meta.session) this.watchCalls(drafts, meta, settled);
    if (meta.session) this.products.hook(meta);
    if (meta.event === 'SessionStart') void this.products.sessionStart(meta.session, meta.cwd, meta.id).catch(() => undefined);
    return { settled };
  }

  private promptDraft(draft: Draft, meta: HookMeta, verified: boolean, data: Obj, count: Counter, live: Live, typed: { text: string; task: string | undefined }[], opens: Promise<void>[]): void {
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
          this.state.midTurn.delete(meta.session);
          // The prompt that opens a turn is its origin, and ends the grace window a loop's last stop started (#965).
          live.turnFrom = String(data.from);
          this.siblings.turn(meta.session, draft.id, live.turnFrom, this.now());
          // An adapter with no route to hold a prompt leaves the loop rule watch-only for its session, which says so once (#352).
          if (HOLDS_NO_PROMPT.has(meta.agent) && this.siblings.looping(meta.session) && !this.loopWatched.has(meta.session)) {
            this.loopWatched.add(meta.session);
            void this.appendReading(meta.session, meta.agent, `Another session's messages started more than 20 of this session's turns in 10 minutes with no prompt from you, but its adapter (${meta.agent}) has no route to hold a prompt, so the loop rule is watch-only for it: nothing was held.`).catch(() => undefined);
          }
          live.claimedInTurn = false;
          this.gate.prompted(meta.session);
        }
        // Each message typed mid-turn is acknowledged at the session's next tool call (#340). It starts a loop's held
        // checks at the next green turn end (#965), as the app's words do from when they're sent (`note`), unless the
        // planted wrong program counts only a turn's first.
        if (draft.queued && data.from === 'person' && verified) typed.push({ text: String(data.text), task: tasks[0] });
        if (draft.queued && data.from === 'person' && verified && this.options.plant !== 'words-only-at-turn-start') live.words = 'words';
        if (!childPrompt(meta)) {
          count.fresh = false;
          count.changed = false;
        }
        const session = this.state.sessions.get(meta.session);
        if (session && verified) {
          // Its stops are held from now, so one with no work that leaves the ask open can be sent on (#82).
          if (tasks.length) { this.judging.nudgeable.add(meta.session); this.askingSoon(); }
          for (const task_ref of tasks) opens.push(this.tasks.opened({ session: meta.session, agent: meta.agent, cwd: meta.cwd, thread: session.thread, task_ref, text: String(data.text), prompt: draft.id, at: draft.ts, ...(item ? { item } : {}) }));
        }

  }
  private appendHookDrafts(drafts: Draft[], meta: HookMeta, writer: string, verified: boolean, count: Counter): { appends: Promise<void>[]; claimed: boolean; live: Live; typed: { text: string; task: string | undefined }[] } {
    const live = this.state.liveOf(meta);
    let claimed = false;
    const typed: { text: string; task: string | undefined }[] = [];
    const appends = drafts.flatMap((draft) => {
      const data = { ...draft.data };
      const opens: Promise<void>[] = [];
      if (draft.kind === 'session.start') {
        count.fresh = true;
        // Work counts from the start (#82): a stop after a resume with nothing done since is no claim, and the turn the
        // start cut off is remembered for the one continue after the app's resume prompt.
        live.cutOff = count.worked;
        count.worked = false;
        count.changed = false;
        if (verified) live.judged = false;
      }
      if (draft.fill === 'msg') data.msg = count.msgs++;
      if (draft.kind === 'user.ask') this.promptDraft(draft, meta, verified, data, count, live, typed, opens);
      if (draft.fill === 'turn') {
        data.turn = ++count.turns;
        data.did_work = count.worked;
        // The stop rule (#303): a stop with no prompt since startup, a resume or /clear is no claim, and neither is an
        // answer, a turn begun by a prompt you typed that opened no task, with no edit, write or ask in it.
        data.claim = this.judging.stopRule(count);
        if (data.claim && verified) claimed = true;
        // The stop is judged as the rule reads it (#83): a turn's claim stands until a prompt opens the next turn,
        // and a stop with work the rule reads as no claim (an answer) is not judged, whatever was told ahead.
        if (verified && count.worked) live.judged = Boolean(data.claim);
        // A stop with no work that isn't an answer, nor right after a start: an ask it leaves open gets one send-back (#82).
        // A turn a reply of DeepBuild's kept going wasn't begun by your prompt, so its stop is no answer.
        live.idle = verified && !count.worked && !count.fresh && (live.sentOn === true || !this.judging.isAnswer(count));
        if (verified && !count.worked && this.options.plant === 'no-work-never-sent-back') live.judged = false;
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
      if (verified && draft.fill !== 'turn' && !live.judged && this.judging.stopRule(count)) { live.judged = true; this.askingSoon(); }
      // A session's events carry the repo it works in, so your answer there is saved for the repo (#23).
      const project = repoOf(meta.cwd);
      if (project && meta.session) this.state.projects.set(meta.session, project);
      // The person is the hook connection's, and a session is the person's whose connection first sent its hooks (#1337).
      const actor = meta.person ?? OWNER;
      if (meta.session && !this.state.sessionPeople.has(meta.session)) this.state.sessionPeople.set(meta.session, actor);
      const connection = this.connection(writer, { ...(meta.session ? { session: meta.session } : {}), agent: meta.agent, verified, actor });
      // The tasks a prompt opens are appended after it, as the core.
      return [this.append(connection, {
        v: draft.v, id: draft.id, kind: draft.kind, ts: draft.ts, ...(draft.seq !== undefined ? { seq: draft.seq } : {}), ...(draft.subject ? { subject: draft.subject } : {}), data: data as JsonValue,
      }), ...opens];
    });
    return { appends, claimed, live, typed };
  }

  /**
   * What a session's calls show of its guard (#1033). A call denied at PreToolUse whose PostToolUse or
   * PostToolUseFailure arrives ran anyway, as a Claude Code mod's tool.check can make it: guard.overridden. A send that
   * completed in a turn cut off isn't made again once the session resumes, as the cut-off turn's unfinished sends
   * aren't (#85). A start reads whether the session's home loads a mod that can override the guard.
   */
  private watchCalls(drafts: Draft[], meta: HookMeta, settled: Promise<void>): void {
    const { session, toolUse: call } = meta;
    const before = drafts.find((d) => d.kind === 'tool.before');
    if (before && call) {
      const { label, send } = callOf(before.data as Obj, effectEntries(this.root.dir));
      if (meta.blockedBy?.length) this.denied(session, call, { guard: meta.blockedBy.join(', '), label: label.slice(0, 2000) });
      const command = before.data.kind === 'shell' && typeof before.data.command === 'string' ? before.data.command : undefined;
      if (send && meta.call) (this.turnSends.get(session) ?? this.turnSends.set(session, new Map()).get(session)!).set(call, { key: sendKey(meta.call.tool, command, meta.call.input), label, done: false });
    }
    const after = drafts.find((d) => d.kind === 'tool.after');
    if (after && call) {
      const sent = this.turnSends.get(session)?.get(call);
      if (sent) sent.done = after.data.outcome !== 'failed';
      const denial = this.denials.get(session)?.get(call);
      if (denial) this.denials.get(session)!.delete(call);
      const failed = (error: unknown) => process.stderr.write(`deep hub: ${call}'s override was not recorded: ${error instanceof Error ? error.message : String(error)}\n`);
      if (denial) {
        (this.overrides.get(session) ?? this.overrides.set(session, []).get(session)!).push({ call, label: denial.label, ts: this.now() });
        void settled.then(() => this.overridden(meta, call, denial)).catch(failed);
      } else {
        // A deny from before this hub started (a restart, a spooled PostToolUse) is read back from what its call matched.
        void settled.then(() => this.deniedBefore(session, call)).then((before) => {
          if (!before) return;
          (this.overrides.get(session) ?? this.overrides.set(session, []).get(session)!).push({ call, label: before.label, ts: this.now() });
          return this.overridden(meta, call, before);
        }).catch(failed);
      }
    }
    // A turn ends at its stop, or at the next prompt when it ended with none (an interrupt): its sends go with it.
    if (drafts.some((d) => (d.kind === 'agent.stop' && !d.data.child) || d.kind === 'user.ask')) this.turnSends.delete(session);
    // A session's sends wait past its end for a resume; what it denied and saw run is the record's from then on.
    if (meta.event === 'SessionEnd') { this.denials.delete(session); this.overrides.delete(session); }
    if (meta.event === 'SessionStart') {
      const done = meta.fields?.source === 'resume' ? [...(this.turnSends.get(session)?.values() ?? [])].filter((s) => s.done) : [];
      this.turnSends.delete(session);
      const sends = done.length ? this.delivery.unknownSends.get(session) ?? this.delivery.unknownSends.set(session, new Map()).get(session)! : undefined;
      for (const s of done) sends!.set(s.key, { label: s.label, pr: false, done: true });
      // The server gates a resumed session's calls until it hears again which sessions have sends to match.
      if (meta.fields?.source === 'resume') { this.askingSent = ''; this.askingSoon(); }
      void settled.then(() => this.modsReading(meta)).catch(() => undefined);
    }
  }
  /** A PreToolUse the server's reply denied (#1033): what denied it and the call in words. */
  denied(session: string, call: string, denial: { guard: string; label: string }): void {
    (this.denials.get(session) ?? this.denials.set(session, new Map()).get(session)!).set(call, { guard: denial.guard.slice(0, 2000), label: denial.label.slice(0, 2000) });
  }
  /** The mods of the Claude Code home a session's transcript lives in, and the folders its command line loads; another agent loads none. */
  private async sessionMods(meta: HookMeta): Promise<HomeMods> {
    if (meta.agent !== 'claude-code' && meta.agent !== 'claude') return { home: '', mods: [] };
    const dirs = pluginDirs(await this.state.parentArgs(meta));
    const home = homeOfTranscript(meta.transcript) ?? claudeHomes(process.env)[0]!;
    // Read again only when what Claude Code lists them from changes, or after MODS_MS: each read starts claude several
    // times. A read in flight is shared, so starts that arrive together start claude once.
    const key = JSON.stringify([home, meta.cwd, dirs, ...[join(home, 'plugins', 'installed_plugins.json'), join(home, 'settings.json'), join(home, 'skills'), ...dirs].map(statKey)]);
    const seen = this.modsSeen.get(key);
    if (seen && this.now() - seen.at < MODS_MS) return seen.read;
    const read = homeMods(home, claudeOnPath(process.env), process.env, { cwd: meta.cwd, dirs });
    this.modsSeen.set(key, { at: this.now(), read });
    // A read that failed is not kept: the next start reads again.
    read.catch(() => { if (this.modsSeen.get(key)?.read === read) this.modsSeen.delete(key); });
    return read;
  }
  /**
   * The login plan of a Claude Code home (#1033), read again only after MODS_MS or once a file a sign-in rewrites
   * changes: each read starts claude, about 175 ms of CPU, on every Claude Code session's start.
   */
  private planOf(home: string): Promise<unknown> {
    const claude = claudeOnPath(process.env);
    if (!claude) return Promise.resolve(undefined);
    const files = [join(home, '.credentials.json'), join(home, '..', '.claude.json'), join(home, '.claude.json')];
    const key = JSON.stringify([claude, ...files.map(statKey)]);
    const seen = this.plansSeen.get(home);
    if (seen && seen.key === key && this.now() - seen.at < MODS_MS) return seen.plan;
    const plan = loginPlan(claude, { ...process.env, ...(home ? { CLAUDE_CONFIG_DIR: home } : {}) });
    this.plansSeen.set(home, { key, at: this.now(), plan });
    return plan;
  }
  /**
   * A denied call that ran anyway (#1033): guard.overridden with what denied it and the home's mods that could have
   * approved it, one line on the session's row, its claims judged again, and for a send, which may already have left,
   * one ask naming it.
   */
  private async overridden(meta: HookMeta, call: string, denial: { guard: string; label: string }): Promise<void> {
    const [row] = (await this.record.raw(`SELECT data FROM events WHERE session_id = ? AND kind = 'tool.before' AND json_extract(data, '$.call') = ? ORDER BY log_pos DESC LIMIT 1`, [meta.session, call])) as { data: string | Obj }[];
    const d = row ? ((typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj) : { kind: 'unknown' };
    const { send } = callOf(d, effectEntries(this.root.dir));
    const read = await this.sessionMods(meta);
    const mods = 'mods' in read ? read.mods.filter((m) => m.overrides).map((m) => m.name) : [];
    const tool = meta.call?.tool ?? (d.kind === 'mcp' ? `mcp__${String(d.server)}__${String(d.tool)}` : String(d.kind));
    await this.appendSession(meta.session, meta.agent, 'guard.overridden', { call, tool: tool.slice(0, 2000), label: denial.label, guard: denial.guard, send, mods: mods.map((m) => m.slice(0, 2000)), mods_unread: 'unread' in read ? read.unread.slice(0, 2000) : null });
    // Its claims first, so a verdict that passed before the override arrived doesn't stand on what follows failing.
    const claims = (await this.record.raw(`SELECT id FROM events WHERE kind = 'claim.made' AND session_id = ?`, [meta.session])) as { id: string }[];
    for (const { id } of claims) await this.judging.judged(`claim:${id}`);
    const by = mods.length ? `, approved past the deny by ${mods.join(', ')}` : '';
    await this.appendReading(meta.session, meta.agent, `DeepBuild denied ${denial.label} (${denial.guard}) and it ran anyway${by}: this session's claims can't pass on its own checks.`.slice(0, 8000));
    if (send) {
      const question = `A send DeepBuild denied ran anyway: ${denial.label.slice(0, 1000)} (call ${call})${by}. It may already have left. Check whether it went out?`;
      const options = [{ id: 'checked', label: 'I checked it', decision: 'none' }, { id: 'later', label: 'Not now', decision: 'none' }];
      const raised = { kind: 'exception', question, options, recommended: 'checked', deadline: this.now() + 2 * 86_400_000, fallback: 'you', default: 'later', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'guard.overridden', session: meta.session, call } as JsonValue)), pinned_to: await this.mcp.pinOf(meta.cwd, question) };
      await this.asks.raise(this.connection('core', { session: meta.session, agent: meta.agent }), 'guard.overridden', raised);
    }
  }
  /**
   * At a Claude Code session's start (#1033): a home that loads a mod able to approve a call past the guard reads its
   * guard as watch-only on the session's row, unless the setup holds the deny: managed settings, or a Team or Enterprise login.
   */
  private async modsReading(meta: HookMeta): Promise<void> {
    const read = await this.sessionMods(meta);
    if (!read.home) return;
    const held = await denyHolds({ ...process.env, ...(read.home ? { CLAUDE_CONFIG_DIR: read.home } : {}) }, claudeOnPath(process.env), () => this.planOf(read.home));
    const risky = held || !('mods' in read) ? [] : read.mods.filter((m) => m.overrides);
    let reading: string | undefined;
    if ('unread' in read && !held) reading = `${MODS_WATCH} (${read.home}) loads mods DeepBuild couldn't read (${read.unread}), so whether one can approve a call past the guard is not checked: its holds and blocks may be watch-only.`;
    else if (risky.length) reading = `${MODS_WATCH} (${read.home}) loads ${risky.map((m) => `the mod ${m.name}, which ${overrideWords(m)!}`).join('; ')}: its holds and blocks are watch-only until the mod is gone or the setup holds the deny (managed settings, or a Team or Enterprise login).`;
    else {
      // The line a start before this one left on the session's row is taken back.
      const [said] = (await this.record.raw(`SELECT json_extract(data, '$.reading') AS text FROM events WHERE session_id = ? AND kind = 'session.reading' AND (json_extract(data, '$.reading') LIKE ? OR json_extract(data, '$.reading') LIKE ?) ORDER BY log_pos DESC LIMIT 1`, [meta.session, `${MODS_WATCH}%`, `${MODS_GONE}%`])) as { text: string }[];
      if (said?.text.startsWith(MODS_WATCH)) reading = `${MODS_GONE} that can approve a call past the guard${held ? ` that ${held} doesn't hold` : ''}: its holds and blocks apply again.`;
    }
    if (reading) await this.appendReading(meta.session, meta.agent, reading.slice(0, 8000));
  }
  /**
   * What denied a call before this hub started, read from its tool.before: the block-mode guard entries it matched, as
   * the reply denies them; undefined when none did.
   */
  private async deniedBefore(session: string, call: string): Promise<{ guard: string; label: string } | undefined> {
    const [row] = (await this.record.raw(`SELECT ts, data FROM events WHERE session_id = ? AND kind = 'tool.before' AND json_extract(data, '$.call') = ? ORDER BY log_pos DESC LIMIT 1`, [session, call])) as { ts: number; data: string | Obj }[];
    if (!row || row.ts >= this.bootAt) return undefined;
    const d = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Obj;
    const rules = readJson(join(this.root.dir, 'rules.json'));
    const entries = isObj(rules) && isObj(rules.entries) ? rules.entries : {};
    const blocks = (Array.isArray(d.matched) ? d.matched.map(String) : []).filter((n) => { const e = entries[n]; return isObj(e) && e.mode === 'block' && !/^effect:(dependency|cloud-resource|unknown-reach-delete|unrestorable-delete|discard-edits|drop-stash)$/.test(String(e.match)); });
    return blocks.length ? { guard: blocks.join(', ').slice(0, 2000), label: callOf(d, effectEntries(this.root.dir)).label.slice(0, 2000) } : undefined;
  }
  /** A request line the adapters map, for a payload the core rebuilt from what the parser kept of the hook. */
  private mapped(meta: HookMeta, draft: Draft, payload: Obj, transcript: readonly Obj[]): Obj | undefined {
    if (meta.agent === 'pi' || meta.agent === 'paseo') return undefined;
    const name = ADAPTERS[meta.agent] ?? 'claude';
    const adapter = registry().get(name);
    const version = ((adapter.facts as Obj).versions as string[]).at(-1)!;
    const line = { v: 1 as const, agent: name, event: meta.event, seq: draft.seq ?? '0', id: draft.id, pid: meta.pid, ppid: meta.ppid, matched: [], payload: { session_id: meta.session, hook_event_name: meta.event, ...payload } as JsonValue };
    return adapter.mapHook(line, version, transcript as JsonValue[]).events.find((e) => e.kind === draft.kind)?.data as Obj | undefined;
  }

  /** Fills what the core reads beside a hook, off the parser: what a session loads, a prompt's origin, a stop's records and loop. */
  private async enrich(drafts: Draft[], meta: HookMeta, session: Session | undefined): Promise<void> {
    if (!meta.session) return;
    const live = this.state.liveOf(meta);
    const foreign = FOREIGN.has(meta.agent);
    for (const draft of drafts) {
      const data = draft.data;
      // The pull request a `gh pr create` call opened, read once off its own PostToolUse (#83).
      if (draft.kind === 'tool.after' && meta.pr) {
        await this.judging.openedPr(meta.session, live.agent, meta.pr);
        live.claimedInTurn = true;
        live.prOpened = meta.pr;
      }
      if (draft.kind === 'session.start') {
        data.loads = await loadsOf(meta.cwd).catch(() => []);
        if (!foreign) void this.control.enteredProject(meta.session, meta.cwd);
        // Each server's tool list, read off this hook's path: recorded after the start, its changes held for you.
        if (!foreign && session) void this.holds.listed(meta.session, live.agent, meta.cwd).catch((error: unknown) => process.stderr.write(`deep hub: tool lists for ${meta.session} not recorded: ${error instanceof Error ? error.message : String(error)}\n`));
        if (!foreign) await this.claudeSettings.recheck().catch(() => undefined);
        if (session) {
          data.thread = session.thread = await this.state.threadOf(session, meta.fields?.source);
          void this.state.childOf(session, live.agent).catch(() => undefined);
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
        // The app's own resume prompt (#82): the stop it leads to gets one automatic continue while asks are open.
        if (from === 'continuation' && live.agent === 'claude-code') { live.resumed = true; this.judging.nudgeable.add(meta.session); this.askingSoon(); }
        if (from === 'person' && !foreign) {
          const item = await this.tasks.itemOf(String(data.text));
          if (item) this.items.set(draft, item);
        }
        // A subagent's report or a command's end notice ends its wait: the call the notice names, or else the oldest
        // that isn't a monitor's watch; a monitor's event, naming a watch the session armed, ends none (#997). A
        // scheduled prompt fires its one-shot crons.
        const watch = /<task-id>([^<]+)<\/task-id>/.exec(String(data.text))?.[1];
        if (from === 'subagent' && !(watch && live.armed?.has(watch))) {
          const named = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(String(data.text))?.[1];
          live.background.delete(named && live.background.has(named) ? named : [...live.background].find(([, b]) => !b.watch)?.[0] ?? '');
        }
        if (from === 'scheduled') for (const [id, cron] of live.crons) if (!cron.recurring) live.crons.delete(id);
      } else if (draft.kind === 'tool.after' && meta.loop) {
        const fact = meta.loop;
        if ('scheduled' in fact) { if (fact.scheduled !== null) live.wakeups.push(draft.ts + this.stepped + fact.scheduled); }
        else if ('cron' in fact) live.crons.set(fact.cron, { due: fact.due, recurring: fact.recurring });
        else if ('cancelled' in fact) live.crons.delete(fact.cancelled);
        else if ('monitor' in fact || 'stopped' in fact) {
          // A monitor's watch holds the session looping until its stop call, its process group ending or its timeout
          // (#997). The planted wrong program reads no monitor, as the merge base did.
          if (this.options.plant === 'monitor-unread') continue;
          if ('stopped' in fact) void this.judging.watchEnded(meta.session, fact.stopped, 'a stop call named it');
          else {
            const id = fact.monitor;
            (live.armed ??= new Set()).add(id);
            live.background.set(id, { what: fact.what, watch: { expires: fact.timeout === null ? null : draft.ts + this.stepped + fact.timeout } });
            void groupUnder(meta.ppid, fact.command).then((group) => { const b = live.background.get(id); if (b && group) b.group = group; });
          }
        } else if (fact.background === 'subagent' || this.options.plant !== 'background-subagents-only') {
          live.background.set(fact.call, { what: fact.what });
          // A command also ends when its process group does, read off the agent's process tree.
          if (fact.background === 'command') void groupUnder(meta.ppid, fact.what).then((group) => { const b = live.background.get(fact.call); if (b && group) b.group = group; });
        }
      } else if (draft.kind === 'agent.stop' && !draft.data.child) {
        await this.stopRecords(draft, meta, session);
        if (session && meta.agent === 'claude-code' && meta.fields?.prompt_id && !meta.fields.agent_id) this.loopsOfTurn(live, await this.turnFrom(session, meta.fields.prompt_id));
        const loop = this.loopAt(live);
        if (loop) data.loop = loop;
        if (session && meta.agent === 'codex' && !meta.fields?.agent_id && !meta.watchOnly) await this.judging.codexStop(meta, data, live).catch(() => undefined);
        // A check the agent promises for later becomes a wake-up (#120); a subagent's stop promises nothing to you.
        if (session && !meta.fields?.agent_id) await this.delivery.promised(meta).catch(() => undefined);
      }
    }
  }

  // ---- Long waits and promised checks (#120; design: Before each command, "Commands end.").

  /** An event about a session, appended as the core. */
  private appendSession(session: string, agent: string, kind: string, data: Obj): Promise<void> {
    return this.appendCore(kind, data, { subject: `session:${letters(session)}` }, { session, agent });
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
        // A child's stop (agent.stop@5 naming the child) ends no turn of the session: its open calls stay open.
        case 'agent.stop': if (typeof d.child !== 'string') { r.lastLine = e.ts; r.open = []; } break;
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
    const facts = (adapterOf(meta.agent)?.facts as Obj | undefined)?.turnWithoutPrompt as { values: Record<string, string>; otherwise: string } | undefined;
    if (!facts) return;
    const turn = meta.fields?.turn_id;
    // A subagent's hooks carry its own turn; no prompt of the root's stands behind them.
    if (!turn || meta.fields?.agent_id) return;
    // A compaction, /compact's own turn included, and a slash command are no prompt (#1022): they open no ask, and
    // leave the turn unstarted, so a continuation that compacts first still opens its own at its next hook.
    if (meta.event === 'PreCompact' || meta.event === 'PostCompact' || meta.event === SLASH_COMMAND) return;
    const started = this.state.turnsStarted.get(session.id);
    this.state.turnsStarted.set(session.id, turn);
    if (meta.event === 'UserPromptSubmit' || meta.event === 'SessionStart' || started === undefined || started === turn) return;
    let text = '';
    let inTurn = false;
    for (const raw of (await this.transcriptReader.tail(session.transcript, 4 << 20)).split('\n')) {
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
    const live = this.state.live.get(session.id);
    if (live) live.from = from;
    const ts = this.now();
    drafts.unshift({ kind: 'user.ask', v: 1, id: ulid(ts), ts, data: { msg: 0, text: scrubText(text, { held: this.options.held }).slice(0, 8192), tasks: [], from }, fill: 'msg' });
  }

  /**
   * The transcript entries of the turn a prompt opened, from its own entry on. The core keeps the current turn's as
   * it reads them; a session it met after its prompt's entry was written (its first hook came late) is read here
   * from the transcript's last few MiB.
   */
  private async turnFrom(session: Session, promptId: string): Promise<Obj[]> {
    if (session.prompts.has(promptId)) return session.entries[0]?.promptId === promptId ? session.entries : [session.prompts.get(promptId)!];
    const lines = (await this.transcriptReader.tail(session.transcript, 4 << 20)).split('\n');
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
    if (meta.transcript && !meta.fields?.agent_id) void this.recordUsage(meta).catch(() => undefined);
    const cause = String(data.cause);
    if (cause === 'unknown') return;
    data.signature = signature(`stop:${cause}`, meta.fields?.error ?? cause, meta.cwd);
    // Who clears it. A spend limit reads as a rate limit, but only you can raise it (#85).
    data.owner = cause === 'sign_in_required' || cause === 'token_refresh_failed' || meta.fields?.error === 'billing_error' ? 'you' : cause === 'rate_limited' || cause === 'plan_window_spent' || cause === 'timed_out' ? 'service' : 'agent';
    // The payload can't tell a dropped connection from a network you must reconnect, so the hub tried it (#85).
    if (cause === 'timed_out' && meta.network && !meta.network.reached) { data.owner = 'you'; data.signature = signature('stop:network', meta.network.host); }
  }

  /**
   * What the session has spent so far, as turn.usage (#45), off the hook's path: Claude Code's from its transcript and
   * its subagents', estimated from the rate card; Codex's from its rollout, by its adapter, unpriced. A stop that reads
   * nothing records nothing, so that turn's usage reads unknown.
   */
  private async recordUsage(meta: HookMeta): Promise<void> {
    let usage: Obj | undefined;
    if (meta.agent === 'claude-code') {
      const tail = this.state.tails.get(meta.session) ?? new UsageTail();
      this.state.tails.set(meta.session, tail);
      const { tokens, cost, model } = await tail.read(meta.transcript);
      if (model) usage = { turn: this.state.live.get(meta.session)?.turnAsk ?? meta.fields?.prompt_id ?? meta.id, model, covers: 'session', tokens: { input: tokens.input + tokens.cache_write, cached: tokens.cache_read, output: tokens.output, exact: true }, cost };
    } else if (meta.agent === 'codex') {
      const text = await readFile(meta.transcript, 'utf8').catch(() => '');
      const lines = text.split('\n').flatMap((l) => { try { return [JSON.parse(l) as JsonValue]; } catch { return []; } });
      // The session's total, the last it reads; counted as the growth since the one before.
      usage = registry().get('codex').readUsage?.(lines).at(-1) as unknown as Obj | undefined;
    }
    if (!usage) return;
    await this.appendSession(meta.session, meta.agent, 'turn.usage', usage);
  }

  /**
   * The wake-ups and cron jobs the turn's transcript shows it scheduled or cancelled, read by the same loop facts as
   * their hooks (#965): a PostToolUse deep-hook spooled under load reaches the hub after the stop, and the stop would
   * otherwise read no loop and start checks on code the next wake-up changes. A wake-up its hook counted too is due
   * at the same time.
   */
  private loopsOfTurn(live: Live, entries: readonly Obj[]): void {
    const results = new Map<string, unknown>();
    const parts = (e: Obj): Obj[] => (isObj(e.message) && Array.isArray(e.message.content) ? e.message.content.filter(isObj) : []);
    for (const e of entries) for (const p of parts(e)) if (p.type === 'tool_result') results.set(String(p.tool_use_id), e.toolUseResult);
    for (const e of entries) {
      for (const p of parts(e)) {
        if (p.type !== 'tool_use' || !results.has(String(p.id))) continue;
        const payload = { tool_input: p.input, tool_response: results.get(String(p.id)), tool_use_id: p.id } as Parameters<typeof loopFact>[3];
        const fact = loopFact('claude', String(p.name), 'PostToolUse', payload, '');
        if (!fact) continue;
        if ('scheduled' in fact) { if (fact.scheduled !== null) live.wakeups.push(Date.parse(String(e.timestamp)) + this.stepped + fact.scheduled); }
        else if ('cron' in fact) { if (!live.crons.has(fact.cron)) live.crons.set(fact.cron, { due: fact.due, recurring: fact.recurring }); }
        else if ('cancelled' in fact) live.crons.delete(fact.cancelled);
      }
    }
  }
  /**
   * A stop's loop reading, from the session's own tool calls: looping while a wake-up or cron job it scheduled is
   * due, or a background subagent or command it started hasn't reported; a loop with none left once neither holds.
   */
  private loopAt(live: Live): Obj | undefined {
    const dues = [...live.wakeups, ...[...live.crons.values()].flatMap((c) => (c.due === null ? [] : [c.due]))];
    const due = dues.length ? Math.min(...dues) : null;
    // What the soonest is, for the gate runner and the line (#965).
    live.due = due === null ? null : { at: due, what: live.wakeups.includes(due) ? 'wake-up' : 'cron' };
    let loop: Obj | undefined;
    if (this.options.plant === 'loop-from-origins') {
      // The planted wrong program reads the loop from the prompt's origin alone.
      loop = live.from === 'scheduled' || live.from === 'subagent' ? { state: 'looping', due: null } : live.wakeups.length || live.background.size ? { state: 'looping', due } : undefined;
    } else if (live.wakeups.length || live.crons.size) loop = { state: 'looping', due };
    else if (live.background.size) loop = { state: 'looping', due: null };
    else if (live.looping || live.from === 'scheduled' || live.from === 'subagent') loop = { state: 'none_left' };
    live.looping = loop?.state === 'looping';
    live.wakeups = [];
    return loop;
  }
  private askingQueued = false;
  private askingSent = '';
  /** The agents whose hook entries run a program that can't run, as the last check found (#993): their gates are watch-only. */
  private cantRun: string[] = [];
  /** When the next check of the hook programs is due, on the hub's clock (#993). */
  private hookCheckDue = 0;
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
    // A session whose newest start or end is a verified end sends no stop until it starts again, so it leaves the set
    // (#824): one each churned session otherwise kept.
    const rows = ((await this.record.raw(`SELECT id, session_id FROM asks a WHERE session_id IS NOT NULL AND status IN ('open', 'later', 'answered') AND id NOT IN (SELECT delivery FROM deliveries WHERE outcome = 'delivered')`
      + ` AND NOT COALESCE((SELECT kind = 'session.end' AND unverified = 0 FROM events WHERE session_id = a.session_id AND kind IN ('session.start', 'session.end') ORDER BY log_pos DESC LIMIT 1), 0)`)) as { id: string; session_id: string }[])
      .filter((r) => !this.delivery.prompts.has(`ask:${r.id}`));
    // A session with a send-back planted for its next stop has that stop held too (#25), and one whose promised check is due (#120).
    const planted = [...this.delivery.routes].filter(([, r]) => r.sendBacks.length).map(([id]) => id);
    const promised = [...this.delivery.promises].filter(([, p]) => p.status === 'due').map(([id]) => id);
    const sessions = [...new Set([...rows.map((r) => r.session_id), ...planted, ...promised])].sort();
    const judged = [...this.state.live].filter(([id, l]) => l.judged || this.judging.nudgeable.has(id)).map(([id]) => id).sort();
    // A session whose cut-off turn started a send with no recorded end has its tool calls held for the gate (#85).
    const resend = [...this.delivery.unknownSends].filter(([, sends]) => sends.size).map(([id]) => id).sort();
    const key = `${sessions.join(' ')}|${judged.join(' ')}|${resend.join(' ')}|${this.cantRun.join(' ')}`;
    if (key === this.askingSent) return;
    this.askingSent = key;
    this.asking(sessions, judged, resend, this.cantRun);
  }

  /**
   * A PreToolUse the hub held for the gate: why its call waits for you, or nothing when it runs (#321), and the rule
   * that denied it, which the server keeps with the deny it sends (#1033).
   */
  async toolGate(meta: HookMeta, call: Gated): Promise<{ held?: string; allow?: string; deny?: string; rule?: string; answers?: Record<string, string> }> {
    await this.ready;
    // A synced server is called only from a session in its scope (#148).
    const scoped = call.mcp ? this.agents.scopeDenial(call.mcp.server, meta.cwd) : undefined;
    if (scoped) return { deny: scoped, rule: "the server's scope (#148)" };
    // A question card is sorted like a question at a stop (#84).
    if (call.card) {
      if (FOREIGN.has(meta.agent) || !meta.session) return {};
      const live = this.state.live.get(meta.session);
      const reply = await this.questions.card(meta, call.card, [...(this.judging.claimRequirements.get(live?.claim ?? '')?.values() ?? await this.judging.requirementsOf(meta.session))]);
      return reply.answers ? { answers: reply.answers } : reply.reason ? { held: reply.reason, rule: "the question sort (#84)" } : {};
    }
    // A pull request says Closes only when every requirement of the issue's task passed (#322; design: At the claim).
    if (call.pr && call.command && meta.session && !FOREIGN.has(meta.agent)) {
      const deny = await this.judging.closesGate(meta.session, call.command).catch(() => undefined);
      if (deny) return { deny, rule: "the gate's Closes rule (#322)" };
      if (!call.classes.length && !call.named && !call.mcp && !call.decided?.length && call.stage === undefined && !call.screen && !call.resend) return {};
    }
    // Computer use stays on what the session leases (#332), so your own screen and browser are never touched.
    if (call.screen && meta.call) {
      const deny = await this.offScreen(meta.session, meta.call.tool, meta.call.input);
      if (deny) return { deny };
    }
    // A send the cut-off turn started with no recorded end isn't made again (#85): denied with the earlier result. The
    // hooks before this one go first, so a resume's start has said which sends its cut-off turn made (#1033).
    if (call.resend) {
      await this.queue(async () => undefined);
      const deny = await this.delivery.resent(meta).catch(() => undefined);
      if (deny) return { deny, rule: "the gate's repeated-send rule (#85)" };
      if (!call.classes.length && !call.named && !call.mcp && !call.decided?.length && call.stage === undefined) return {};
    }
    // A cloud resource nobody can be asked about from here stays denied, as with the hub down; a destructive command
    // runs only staged.
    if (FOREIGN.has(meta.agent) || !meta.session) {
      if (call.decided?.includes('cloud-resource')) return { deny: 'DeepBuild blocked this: creating a cloud resource the plan doesn\'t name needs your standing rule or your answer, and this session can\'t be asked.' };
      return call.stage !== undefined ? this.staging.gate(meta, call, false) : {};
    }
    const held = await this.holds.gate(meta, call);
    if (held) return { held };
    // A destructive command runs only once what it reaches is staged, or you said yes (#347, #1294).
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
    if (leased) this.state.onScreen.set(session, display);
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
    const current = this.state.onScreen.get(session);
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
   * What the hub says back to a hook it holds: a session's start gets its briefing and the answers of its thread; a
   * prompt the answers waiting for it, or, a person's status question with nothing waiting, the answer from the
   * record that keeps it from the model (#83); a stop, while the agent left a question, waits until `until` for its
   * answer, and is sent back with it while the turn is under Claude Code's cap on continuations; a judged stop
   * carries its verdict line, first in a send-back's reason and beside any reply where the chat shows it (#83).
   */
  async hookReply(meta: HookMeta, until: number): Promise<{ context?: string; block?: string; message?: string }> {
    // Only a hook whose reply is being built can be abandoned; once it is built, its ID is kept no longer (#41's soak).
    this.replying.add(meta.id);
    try {
      return await this.buildReply(meta, until);
    } finally {
      this.replying.delete(meta.id);
      this.abandoned.delete(meta.id);
    }
  }
  /**
   * A reply's context inside the cap the agent's facts set on injected output (#1296): under it, the parts joined as
   * ever; past it, the rules you typed and the requirement IDs inline first, the rest kept as evidence and named by its
   * handle on a line saying where to continue, and the record says which part went how. The planted wrong program
   * sends the whole block, which the agent cuts to a preview.
   */
  /** The extensions' context for a call, fitted as the core's own is (#1296). */
  fitContext(meta: HookMeta, parts: Part[], join: string): Promise<string> { return this.fitted(meta, parts, join); }
  private async fitted(meta: HookMeta, parts: Part[], join?: string): Promise<string> {
    const cap = Number(((adapterOf(meta.agent)?.facts as Obj | undefined)?.contextOutput as Obj | undefined)?.capChars) || Infinity;
    const out = fit(parts, this.options.plant === 'sends-block-whole' ? Infinity : cap, join);
    if (!out.rest) return out.inline;
    const handle = await this.record.keep(this.connection('core'), { bytes: new TextEncoder().encode(out.rest), kind: 'hook.context', source: meta.event });
    const ts = this.now();
    await this.append(this.connection('core', { session: meta.session }), { v: 1, id: ulid(ts), kind: 'session.context_fit', ts, subject: `session:${letters(meta.session)}`, data: { event: meta.event, cap, chars: out.inline.length + out.rest.length, inline: out.inlineNames, inline_ids: out.inlineIds, by_handle: out.restNames, handle }, evidence: [handle.slice(3)] });
    return [out.inline, continueLine(handle, out.restNames, cap)].filter(Boolean).join('\n\n');
  }

  private async startReply(meta: HookMeta, until: number, own: string | false): Promise<HookReply> {
      // After a compaction or a resume the next prompt carries every rule you typed (#344), set before any wait here,
      // so a prompt whose hook arrives before this reply is done still carries them.
      if (own && (meta.fields?.source === 'compact' || meta.fields?.source === 'resume')) this.memory.ruleStateOf(meta.session).full = true;
      // What Codex says of our entries' trust, off this reply's path.
      if (meta.agent === 'codex') void this.readCodexTrust(meta.cwd);
      // The worktree receives its build products first, beside the rest of the reply (#1017).
      const placed = this.products.sessionStart(meta.session, meta.cwd, meta.id).catch((error: unknown) => { process.stderr.write(`deep hub: products weren't placed in ${meta.cwd}: ${error instanceof Error ? error.message : String(error)}\n`); return undefined; });
      const brief = await briefing(meta.cwd);
      const answers = own && this.options.plant !== 'ended-answer-at-next-prompt'
        // The planted wrong program gives a new session the answers of every session that worked in its folder.
        ? await this.queue(async () => this.delivery.deliver(await this.delivery.answers.waitingFor(meta.session, this.options.plant === 'ended-answer-to-worktree' ? `a.session_id IN (SELECT id FROM sessions WHERE worktree = '${sql(meta.cwd)}')` : undefined), 'next_prompt', { session: meta.session, id: meta.id }))
        : undefined;
      // After a compaction or a resume, the open asks' requirement IDs again, in one short block. The planted wrong
      // programs send them only at startup, or 25 ms late on the hook's path.
      const source = meta.fields?.source;
      const open = own && !(this.options.plant === 'brief-at-startup-only' && source !== 'startup') ? await this.tasks.brief(meta.session, this.state.sessions.get(meta.session)?.thread) : undefined;
      if (this.options.plant === 'slow-brief' && (source === 'compact' || source === 'resume')) await new Promise((done) => setTimeout(done, 25));
      const taste = own ? await this.memory.tasteAt(meta.session, meta.cwd, (await headOf(meta.cwd))?.branch ?? '', true) : undefined;
      // Your rules first (#344): every agent's rule files and the rules you typed, recorded as the set this session runs under.
      const rules = own ? await this.queue(() => this.memory.startRules(meta)).catch((error: unknown) => { process.stderr.write(`deep hub: no rules for ${meta.session}: ${error instanceof Error ? error.message : String(error)}\n`); return undefined; }) : undefined;
      // Who else is in the repo, and on what (#352).
      const siblings = own ? await this.queue(() => this.siblings.deliver(meta, until)) : undefined;
      const context = await this.fitted(meta, [{ name: 'rules', ...(rules ? { pieces: rules } : {}) }, { name: 'build products', text: await placed }, { name: 'briefing', text: brief }, { name: 'requirement IDs', ...(open ? { pieces: open.text.split('\n').map((text, i) => ({ text, keep: true, ...(i === 0 ? { ids: open.ids } : {}) })) } : {}) }, { name: 'answers', text: answers, keep: true }, { name: 'taste', text: taste }, { name: 'sibling sessions', text: siblings }]);
      return context ? { context } : {};
    }
  private async promptReply(meta: HookMeta, until: number, r: Routes): Promise<HookReply> {
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
        // Another session's message past the loop rule's count waits for your answer, at its submit (#352).
        const held = await this.loopHeld(meta);
        if (held) return { block: held, message: held.split(':')[0]! };
        // Behind this prompt's own hook, so its origin is recorded (its event, or the queue's) when read.
        const status = await this.statusReply(meta);
        for (const [ask, handed] of [...this.delivery.handed]) if (handed.session === meta.session) await this.delivery.unwoken(meta.session, ask, prompt);
        // A continue a waiter took is shown by the wake that carries it; any other prompt carries it instead (#85).
        r.later.unshift(...(r.handed ?? []).filter((text) => !prompt.includes(text)));
        delete r.handed;
        // An answer whose delivery timed out is read for first: one a turn already showed isn't sent again.
        for (const [ask, session] of [...this.delivery.unread]) {
          if (session !== meta.session) continue;
          const woken = await this.delivery.woken(session, said(ask));
          if (woken === undefined) continue;
          this.delivery.unread.delete(ask);
          if (woken) await this.delivery.answers.outcome(ask, 'next_prompt', 'delivered');
        }
        const waiting = await this.delivery.answers.waitingFor(meta.session);
        if (status && !waiting.length && !r.later.length && !this.delivery.promiseDueFor(meta.session)) {
          // The prompt's event read as the session working; it stays as it was, since no model runs on it.
          const live = this.state.live.get(meta.session);
          if (live?.state && live.state !== 'working') await this.state.attention(meta.session, live.agent, live.state);
          return { block: status, message: status.split('\n')[0]! };
        }
        // The planted wrong program counts the waiter your settings declare as a route, shown or not, and leaves the answer for it.
        const leaves = this.options.plant === 'routes-from-settings' && !r.shown.has('waiter');
        const answers = leaves ? undefined : await this.delivery.deliver(waiting, 'next_prompt', { session: meta.session, id: meta.id });
        // A verdict that landed after the stop's reply goes with the next prompt (#83).
        // Your answer to a question that held the send-back goes with the claim's line as it stands (#84).
        const landed = (await this.judging.landedLine(meta.session)) ?? (answers ? await this.judging.lineStanding(meta.session) : undefined);
        const slow = this.judging.slowVerdicts(r);
        // A continue the core recorded since the timer last read them goes with this prompt, not the one after (#85).
        await this.delivery.continues();
        // Notes this prompt's hook recorded go as its context, once; a prompt typed mid-turn is acknowledged in its reply (#340).
        const notes = this.delivery.carried.get(meta.session);
        this.delivery.carried.delete(meta.session);
        const ack = this.acknowledge(meta.session);
        const promised = await this.delivery.promiseCarried(meta.session, 'next_prompt', prompt);
        // What you reject while a session runs stops it now, not at the next wiki build (#111).
        if (prompt.includes('rejected:')) {
          const message = { id: meta.id, role: 'user', text: prompt, outside: false } as Message;
          await captureRejected(this.record, this.connection('cli'), this.now, [{ session: meta.session.replace(/[^0-9A-Za-z]/g, ''), project: repoOf(meta.cwd) ?? null, messages: [message], from: 0 }], true);
          await syncRejected(this.raw, this.root.dir).catch(() => undefined);
        }
        // A branch's name may not say which screen a session works on, so its first prompt is read too.
        const first = !this.memory.firstPrompted.has(meta.session);
        this.memory.firstPrompted.add(meta.session);
        const taste = first ? await this.memory.tasteAt(meta.session, meta.cwd, prompt, false) : undefined;
        // A rule you typed anywhere, or every one after a compaction or a resume (#344).
        const rules = await this.memory.promptRules(meta, prompt).catch((error: unknown) => { process.stderr.write(`deep hub: rules at ${meta.session}'s prompt: ${error instanceof Error ? error.message : String(error)}\n`); return undefined; });
        const siblings = await this.siblings.deliver(meta, until);
        const later = r.later.splice(0).filter((text) => !prompt.includes(text)).map((text) => ({ name: 'continues', text }));
        const context = await this.fitted(meta, [{ name: 'rules', ...(rules ? { pieces: rules } : {}) }, { name: 'answers', text: answers, keep: true }, { name: 'promised checks', text: promised }, { name: 'notes', text: notes ? this.delivery.noteText(notes) : undefined }, ...later, { name: 'verdict', text: landed ? `DeepBuild: ${landed}` : undefined }, { name: 'slow verdicts', text: slow }, { name: 'acknowledgement', text: ack.context, keep: true }, { name: 'taste', text: taste }, { name: 'sibling sessions', text: siblings }]);
        const message = [status, ack.message].filter(Boolean).join('\n');
        return { ...(context ? { context } : {}), ...(message ? { message } : {}) };
      });
      return reply;
    }
  private async buildReply(meta: HookMeta, until: number): Promise<{ context?: string; block?: string; message?: string }> {
    // Event and reply routing use the same ownership evidence before any session-only side effect.
    await (this.replaying ?? Promise.resolve());
    const whose = await this.queue(() => this.state.whose(meta, meta.seq));
    if (whose.job || whose.wait) return {};
    const own = !FOREIGN.has(meta.agent) && meta.session;
    // A tool call's reply carries a message typed mid-turn and the notices waiting for the session (#340, #352), a
    // failed call's too, so a repeat is told in the third failure's own reply (#2019).
    if (own && (meta.event === 'PreToolUse' || meta.event === 'PostToolUse' || meta.event === 'PostToolUseFailure')) {
      return this.queue(async () => {
        const ack = this.acknowledge(meta.session);
        const context = await this.fitted(meta, [{ name: 'acknowledgement', text: ack.context, keep: true }, { name: 'sibling sessions', text: await this.siblings.deliver(meta, until) }], '\n');
        return { ...ack, ...(context ? { context } : {}) };
      });
    }
    if (meta.event === 'SessionStart') return this.startReply(meta, until, own);
    if (!own || (meta.event === 'UserPromptSubmit' && childPrompt(meta))) return {};
    const r = this.delivery.routesOf(meta.session, meta.cwd);
    if (meta.event === 'UserPromptSubmit') return this.promptReply(meta, until, r);
    if (meta.event !== 'Stop') return {};
    return this.judging.stopReply(meta, until, r, () => this.stepped);
  }
  /**
   * An idle session woken with a notice through its waiter (#352): never one held on an ask still open for you, or
   * whose newest claim's verdict stands BLOCKED (its cause yours to clear, which a BLOCKED verdict names); that one
   * hears it at its next turn instead.
   */
  private async noticeWake(session: string, text: string): Promise<boolean> {
    const r = this.delivery.routes.get(session);
    if (!r?.waiter || r.holding || r.places || await this.state.asksYou(session)) return false;
    const [newest] = (await this.record.raw(`SELECT v.outcome FROM claims c JOIN verdicts v ON v.claim_id = c.id WHERE c.session_id = ? AND v.stale = 0 ORDER BY c.created DESC, v.created DESC LIMIT 1`, [session])) as { outcome: string }[];
    if (newest?.outcome === 'BLOCKED') return false;
    r.waiter.give({ session, text });
    r.waiter = undefined;
    return true;
  }
  /**
   * Whether the loop rule holds this prompt (#352): its origin as the hook mapped it, and the session whose message
   * started it as the prompt's transcript entry names it (Claude Code's origin.from), never the message's text.
   */
  private async loopHeld(meta: HookMeta): Promise<string | undefined> {
    const live = this.state.live.get(meta.session);
    const session = this.state.sessions.get(meta.session);
    if (!live?.turnFrom || childPrompt(meta)) return undefined;
    return this.siblings.held(meta, live.turnFrom, async () => {
      const entry = session && meta.fields?.prompt_id ? (await this.turnFrom(session, meta.fields.prompt_id))[0] : undefined;
      const origin = entry && isObj(entry.origin) ? entry.origin : undefined;
      return typeof origin?.from === 'string' ? /^local_(.+)$/.exec(origin.from)?.[1] : undefined;
    });
  }
  /**
   * The messages typed mid-turn since the last acknowledgement (#340): the agent is asked to acknowledge each in one
   * line, and the chat shows each with its task and the queue: every message typed mid-turn in the turn so far.
   */
  private acknowledge(id: string): { context?: string; message?: string } {
    const acks = this.state.acks.get(id);
    this.state.acks.delete(id);
    if (!acks?.length) return {};
    const short = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);
    const noted = acks.map((a) => `DeepBuild: your message “${short(a.text)}” ${a.task ? `is a new ask, ${a.task}` : 'opens no ask'}.`);
    // The planted wrong program shows only the message just read.
    const waiting = this.options.plant === 'queue-shows-newest' ? [acks.at(-1)!.text] : this.state.midTurn.get(id) ?? [];
    const queue = `DeepBuild queue (${waiting.length}): ${waiting.map((t) => `“${short(t)}”`).join(' · ')}`;
    const context = acks.map((a) => `You were sent a message while you worked: “${a.text}”${a.task ? `, a new ask (${a.task})` : ''}. Acknowledge it in one line, then go on.`).join('\n');
    return { context, message: [...noted, queue].join('\n') };
  }
  private async readCodexTrust(cwd: string): Promise<void> {
    const dirs = [...(process.env.PATH ?? '').split(':'), ...this.config().loginPath.split(':')].filter(Boolean);
    const codex = dirs.map((d) => join(d, 'codex')).find((p) => existsSync(p));
    if (codex) await saveTrust(this.root.dir, codex, cwd, { ...process.env, CODEX_HOME: recordedHome(this.root.dir) }).catch(() => undefined);
  }
  /** The hooks whose deep-hook let them through before reading the hub's reply, by event ID: none of them is held. */
  private readonly abandoned = new Set<string>();
  /** The hooks whose reply the core is building, by event ID. */
  private readonly replying = new Set<string>();
  /** A held hook whose deep-hook is gone: its stop hold ends at once and delivers nothing, and an answer its reply carried reads stalled. */
  hookGone(id: string, session: string): void {
    if (this.replying.has(id)) this.abandoned.add(id);
    for (const wake of this.delivery.waiting.get(session) ?? []) wake();
    // What its reply carried never reached the agent (#906): stalled, unless a turn shows it, and it goes by the next route.
    for (const [ask, handed] of this.delivery.handed) if (handed.hook === id) void this.queue(() => this.delivery.unwoken(handed.session, ask)).catch(() => undefined);
    // The notices it carried wait for the session's next hook (#352).
    this.siblings.gone(id);
  }
  /**
   * A deep mcp call cancelled, or its connection `closed` (#1923): it leaves the job it waits on. A cancel stops the job
   * once no caller is left; a closed session never does, so the job runs on (#1925).
   */
  callGone(call: string, closed = false): void {
    this.jobKinds?.gone(call, closed);
  }
  /**
   * A status question a person typed ("still going?", "all done?", "what's next?", "anything for me?"), answered from
   * the record with no model call: the answer the prompt is blocked with. Undefined for any other prompt, and for
   * the same words from a scheduled task, a subagent's report, another session or a prompt the adapter can't place.
   */
  private async statusReply(meta: HookMeta): Promise<string | undefined> {
    const prompt = meta.fields?.prompt ?? '';
    // #669's planted wrong program: a status question goes on to the model as any prompt does.
    if (!isStatusQuestion(prompt) || this.options.plant === 'status-from-model') return undefined;
    // The prompt's origin as the hook mapped it: kept at the splice for one the transcript's queue had shown first
    // (#25), else on its own event, once its append has settled (one that never lands has no origin: not a person's).
    const spliced = this.state.sessions.get(meta.session)?.spliced;
    let from = spliced?.get(meta.id)?.from;
    spliced?.delete(meta.id);
    if (from === undefined) {
      await Promise.allSettled([...this.inflight]);
      const [row] = (await this.record.raw(`SELECT json_extract(data, '$.from') AS f FROM events WHERE id = ?`, [meta.id])) as { f: string | null }[];
      from = row ? row.f ?? 'unknown' : undefined;
    }
    if (from !== 'person') return undefined;
    const live = this.state.live.get(meta.session);
    // A turn newer than the claim's that has not finished (going, waiting, stuck, failed or gone quiet) answers with
    // the session's own state, whatever the earlier claim says; one that finished unjudged has no claim of its own.
    // With no claim at all the session's own state answers too.
    const unjudged = live?.state !== undefined && live.claimTurn !== live.turn && live.state !== 'finished';
    const claim = unjudged ? undefined : live?.claim ?? (await newestClaim(this.raw, meta.session).then((id) => (id ? `claim:${id}` : undefined)));
    const state = claim ? await this.judging.stateOf(claim) : undefined;
    const [stop] = (await this.record.raw(`SELECT MAX(ts) AS at FROM events WHERE session_id = ? AND kind = 'agent.stop' AND json_extract(data, '$.child') IS NULL`, [meta.session])) as { at: number | null }[];
    // The list's one count (#1463): its ask rows, as deep and the app count them.
    await this.state.statesSettled();
    const needsYou = [...this.state.rows.keys()].filter((id) => id.startsWith('ask:')).length;
    return statusAnswer(state, { session: meta.session, agent: live?.agent ?? meta.agent, worktree: live?.cwd || meta.cwd, needsYou, now: this.now(), lastStop: stop?.at ?? null, state: claim ? undefined : live?.state });
  }

  /**
   * test.clock: the hub's clock steps forward (the hub runs with DEEP_HUB_TEST_CLOCK_STEPS=1), and what the gate
   * runner timed on it comes due now (#965).
   */
  private testClock(params: Obj): Obj {
    const step = params.advance_ms;
    if (typeof step !== 'number' || !Number.isSafeInteger(step) || step < 0) throw refuse('type', '/params/advance_ms', 'Step the clock by a whole number of ms, 0 or more.', step);
    this.options.clock.start += step;
    this.stepped += step;
    this.gate.tick();
    void this.state.quietDue().catch(() => undefined);
    return { now: this.now() };
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

  // ---- Methods.

  /**
   * One socket method. It sees every hook that arrived before it, but holds the queue only to bind a deep_*
   * call to its session, so a long call (a run's start, a file read, a test load) holds up no session's hooks.
   */
  call(method: string, params: unknown, context: CallContext): Promise<unknown> {
    const p = isObj(params) ? params : {};
    if (method === 'mcp.call') return this.mcp.mcpCall(p, context);
    return this.queue(async () => undefined).then(() => this.control.dispatch(method, p, context));
  }

  /** Streams every event after `after` to the subscriber, then each one appended from then on; a scope narrows it (#1575). */
  async subscribe(sub: string, after: number, scope?: Scope): Promise<{ head?: number; snapshot?: true }> {
    await this.ready;
    return this.log.subscribe(sub, after, scope);
  }
  unsubscribe(sub: string): void {
    this.log.unsubscribe(sub);
  }

  // ---- Stop.

  /** A clean stop: in-flight runs stopped and recorded, the stop and its reason appended, the record closed FULL. */
  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    plantedStop();
    for (const timer of this.timers) clearInterval(timer);
    this.siblings.stop();
    // The pool's pipe goes with the hub, as its socket does: left in the root with no writer, any read of it blocks.
    this.pool?.close(true);
    for (const live of this.state.live.values()) clearTimeout(live.quiet);
    for (const p of this.delivery.promises.values()) clearTimeout(p.timer);
    this.claudeSettings.close();
    for (const waits of [this.delivery.waiting, this.delivery.settling]) for (const set of [...waits.values()]) for (const wake of set) wake();
    try {
      await this.ready;
    } catch {
      return;
    }
    await this.replaying;
    await Promise.all(this.tried);
    for (const session of [...this.unplaced.keys()]) await this.queue(() => this.placeHeld(session)).catch(() => undefined);
    await this.chain;
    await this.state.flushStates();
    // The pass the stop kept from starting, so the rows a stopped hub's database holds are the list as it stood.
    await this.state.recordStates().catch(() => undefined);
    this.transcripts.writeCursors();
    this.canvasSide.close();
    await this.replicas.close();
    this.runs.stopAll();
    // Runs on hosts go on there; only this hub's followers of them stop, and the next hub follows them again (#1942).
    this.hosts.close();
    // Each worktree's stack goes down with the hub, through the supervisor.
    await this.stacks.close();
    // Each running job is stopped through the supervisor; one still stopping is reaped on the next start.
    const jobs = await this.runner.list().catch(() => [] as JobRecord[]);
    await Promise.race([Promise.allSettled(jobs.filter((j) => j.state === 'running' || j.state === 'waiting').map((j) => this.runner.cancel(j.job))), new Promise((done) => setTimeout(done, 5000))]);
    await this.runner.close();
    await this.runs.settled();
    await this.checkouts.close().catch(() => undefined);
    await this.appendCore('hub.stopped', { reason }).catch(() => undefined);
    this.channels?.stop();
    await this.extensions?.close();
    await this.supervisor.close();
    // The product store's watch and the session starts' timers, set once the hub was ready, go with it.
    this.products.close();
    this.sessionStarts.close();
    await this.record.close();
    this.writeState('stopped');
  }

  later(session: string, cwd: string, text: string): void { return this.delivery.later(session, cwd, text); }

  async permission(meta: HookMeta, until = 0, inPaseo = false): Promise<{ decision: 'allow' | 'deny' | 'none'; because?: string }> { return this.delivery.permission(meta, until, inPaseo); }

  paseoOwner(meta: HookMeta): Promise<string | null> { return this.delivery.paseoOwner(meta); }

  async paseoAppAnswer(meta: HookMeta): Promise<Obj> { return this.delivery.paseoAppAnswer(meta); }

  waiterGone(key: number): void { return this.delivery.waiterGone(key); }

  mcpHello(fd: number | undefined, claimed: { pid: number; start: string } | undefined, paseo?: string): Promise<{ session: string | null; parent?: { pid: number; start: string } }> { return this.state.mcpHello(fd, claimed, paseo); }

  async notifierGone(): Promise<void> { return this.control.notifierGone(); }

  async health(): Promise<Obj> { return this.control.health(); }
}
