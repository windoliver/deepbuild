// The extension host (#348). A TypeScript package inside DeepBuild's signed release, written by no agent, loads in
// the hub's own process; every other package, whoever wrote it, loads in the platform sandbox, out of process,
// started through the supervisor (host@1), and speaks JSON-RPC with the host over a socket of its own. Nothing loads
// before its conformance passed on the files it has now, or before you trust its project; no package code runs
// before the hub is ready; every call is checked against the package's grant here, in the host, never in the
// package; and inbound traffic reaches a package only through routes you chose when you turned it on.
//
// Slots (#349): each `deep.register*` call fills a slot of the hub-slot table. At install the slot's kit runs on what
// the package registers (a check kind that replaces a shipped one runs check.kind@1's fixed part in the hub) and a
// FAIL refuses the install. A resolver is forwarded to the asks core, whose gate decides; an adapter is held to the
// adapter contract, and answers reach a session only through the adapter that gates it, by a route its flags allow.
//
// Packages (#351): the installer reads the manifest as data and refuses, naming why, an envelope digest that isn't its
// files', a signature that doesn't verify or a key other than the one trusted for the package, a piece of the
// trusted ring or the done gate replaced, a conflict with an installed package, a check kind another package holds
// that it doesn't declare it replaces, and a kernel contract version the kernel doesn't publish.
//
// Sources and secrets (#364): the hub makes every call a polled source needs, adding a secret by its handle only on
// the source's host (./sources.ts), and a stream source is held to source@1's kit at install, wherever it runs.
//
// Schedules, notices and sends (#365): a plug-in's jobs run on the hub's timer, one run of a schedule at a time, each
// judged by what the hub recorded for it (./schedules.ts); a notice goes out only for a subscription you made and only
// on fresh readings; and a send leaves only under your standing rule or your yes, its key claimed before it goes out
// (./sends.ts).
//
// Live readings (#262): Read now re-reads what a view binds, each source through its quota; a while-shown cadence runs
// once a period while a view that binds its source is shown, as the app reports it; and a series call lands as one
// batch file named by one reading.batch event, its windows' rollups as files named by reading.rollup events
// (./series.ts), so a bound value resolves at a frame's pinned log position.
import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AdapterCaps, HookRequestLine } from '@deepbuild/adapters';
import type { Asks, Delivery, ResolverAnswer } from '@deepbuild/asks';
import type { EvidenceStore } from '@deepbuild/evidence';
import type { StateSource, StateSourceFill } from '@deepbuild/conformance';
import type { ChannelCtx, ChannelDelivered, ChannelFill, ChannelItem, ChannelReceived, CheckResult, CheckRunnerFill, CheckSpec, EnvironmentFill, EnvironmentHandle, EnvironmentLease, EnvironmentSpec, SlotFill, SlotKit } from '@deepbuild/conformance';
import { canonicalize, checkManifest, extensionApi, frozenDigests, hubSlots, registry, sha256Hex, validate, type ApiEntry, type HookContribution, type JoinedHookReply, type JsonValue, type Schema } from '@deepbuild/contracts';
import { contentFree, toJson, ulid, type Connection, type Event, type EventInput, type RecordStore } from '@deepbuild/record';
import type { LeaseKind, LeaseResult, LeaseTable } from '@deepbuild/leases';
import type { Runner } from '@deepbuild/runner';
import { badDeadline, type Host as RunHost, type Supervisor } from '@deepbuild/supervisor';
import { API, extensionSide, peer } from '../runtime/deep.mjs';
import { cycleThrough, dependents, graph, refusal, resolve, servedAt, type Piece, type UseRow } from './compose.js';
import { packageDigest } from './digest.js';
import type { BuildPlant, HeldJobs, JobBytes, JobCall, JobCounter, Weight } from './job-kinds.js';
import { Jobs, JobTools, type Answer, type JobListing } from './jobs.js';
export type { JobListing } from './jobs.js';
import { AdapterRouting, type Delivered } from './adapter-routing.js';
export type { Route, Delivered } from './adapter-routing.js';
import type { Entry, Ext, Manifest, Store, HostGrant, KitRun, ProjectView, InstalledView, Installed, IndexFill } from './host-types.js';
export type { HostGrant, KitRun, ProjectView, InstalledView, Installed, IndexFill } from './host-types.js';
import type { ViewShown } from './source-types.js';
export type { ViewShown } from './source-types.js';
import { actionRules, unchecked, rejected, declaredPath, type Action } from './action-schema.js';
import { CORE, CALL_MS, HostFiles, Overran, within, stretchable, isPlain, texts, message, trustedPath } from './host-shared.js';
import { NODE_HOME, NODE_LIBS } from './node-runtime.js';
import { checkReply, join as joinReplies, type JoinPlant } from './replies.js';
import { Schedules, HostSchedules, type Ended, type RunEvent, type ScheduleDecl, type ScheduleRow, type ScheduleRun, type Settings, type Verdict } from './schedules.js';
import { SeriesStore, type BoundValue, type Rollup, type Span } from './series.js';
import { Sends, Notices, type SendRow, type SendRule, type NoticeRow } from './sends.js';
export type { NoticeRow } from './sends.js';
import { WorkSources, type Added, type DeliveryRow, type WorkEvent, type WorkKitFixture, type WorkPage, type WorkResult, type WorkTask } from './work.js';
import { AnswerTooLarge, declareSource, handleOf, nodeFetch, nodeHttp, osSecrets, Sources, HostSources, type HttpClient, type KeyTest, type Polled, type Reading, type Recording, type SecretStore, type SourceRead, type StreamRead } from './sources.js';
import { TERMINAL_PLANTS, TERMINAL_PROTOCOL, Terminals, type OpenSpec, type TerminalPlant, type TerminalTab } from './terminals.js';
import type { ProjectTrust } from './trust.js';

/** A package inside DeepBuild's signed release, as the release's signed manifest lists it. */
export interface ReleaseEntry { id: string; version: string; digest: string }
/** The planted wrong programs the criteria name, selected per host; tests only. */
export type Plant = 'hub-unless-agent-built' | 'grants-only-in-record-query' | 'first-party-appends-every-kind'
  | 'context-as-text' | 'writer-from-arguments' | JoinPlant | 'stop-provider-first'
  | 'both-adapters-deliver' | 'first-to-bind-owns' | 'refuses-only-the-ring' | 'trusts-envelope-digest'
  | 'skips-kind-declare' | 'drops-mode' | 'holder-from-arguments' | 'declares-kind-on-first-lease'
  | 'close-stops-every-host' | 'narrower-grant-implies-run-as-you' | 'revoke-keeps-running' | 'revoke-stops-programs-only'
  | 'input-from-any-writer' | 'piece-writes-input' | BuildPlant
  // #139's: a host that lets a stable package call a preview method, and an installer that wires a use to the newest
  // interface its provider has.
  | 'stable-may-call-preview' | 'rewires-to-newest'
  // #363's: a record read filtered by the grant's words alone, and an action.reported that takes `changed` or a
  // malformed `verified` from the handler's report.
  | 'record-by-grant-words' | 'copies-report-changed' | 'keeps-malformed-verified'
  // #103's: a hub that wires a use by its interface's name alone, serves a use the provider's newest shape, keeps a use
  // wired to the piece it prefers once that piece is gone, removes a required use's provider with no ask, reads an
  // optional use with no provider as empty, and runs a call through an edge under the provider's own grant.
  | 'compares-names-alone' | 'serves-newest-minor' | 'wires-by-name' | 'detaches-silently' | 'optional-reads-empty' | 'call-under-provider-grant'
  // #989's hosted terminals: hosts that keep the start size, drop the bottom rows, keep every byte, read a FIFO or
  // block their output on input; hubs that leave a closed terminal's files, throw once input is full, or stop or
  // read as ended a host of another protocol version.
  | TerminalPlant;

/** One hook request to every loaded handler of its kind (#350). */
export interface HookRequest {
  kind: 'tool.before';
  /** The event's data, as tool.before@2 has it. */
  data: unknown;
  /** How long each handler has to reply, in ms; past it, it is recorded as failed. */
  deadline: number;
  /** The hook's total context bound, in characters, as hook.joined@1 counts it. */
  bound: number;
}
/** The joined reply: hook.joined@1's fields, and the handlers recorded as failed. */
export interface HookReply extends JoinedHookReply { failed: { extension: string; reason: string }[] }
/** What an action call targets: the providing piece, `ext:<id>`, and the version of it the caller means. */
export interface ActionTarget { handle: string; version: string }
export interface ActionCall {
  /** ext.<plugin>.<name>, as the manifest's `actions` lists it. */
  action: string;
  target: ActionTarget;
  /** Checked against the action's input schema before it runs. */
  input: unknown;
  /** Who calls, as the hub's socket proved it. */
  caller: Connection;
  /** The window that has focus; it never chooses the target. */
  focus?: string | null;
  /**
   * The call's request ID (#363), as every agent's call through deep-actions carries one: an identical retry gets the
   * first call's result and runs nothing again, and the same ID with other input is refused before anything is
   * written or run.
   */
  request?: string;
}
/**
 * A call's result. A change or send's report and what the hub wrote for it are in its action.reported (#363). A
 * refused one whose handler had started says so, and a change or send names the call it was entered under.
 */
export type ActionResult = { status: 'done'; output: unknown } | { status: 'refused'; reason: string; started?: true; call?: string };
/** An action a loaded piece registered, as agents are offered it, or left out at install with the reason (#363). */
export interface ActionListing {
  action: string;
  extension: string;
  version: string;
  declares: 'read' | 'change' | 'send';
  /** Its input's JSON Schema, as declared. */
  input: Record<string, unknown>;
  exposed: boolean;
  reason: string | null;
}
export interface ExtensionHostOptions {
  record: RecordStore;
  /** Every out-of-process package starts through it, in the platform sandbox. */
  supervisor: Supervisor;
  trust: ProjectTrust;
  /** Your ~/.deepbuild: packages install under extensions/, pinned to a version. */
  home: string;
  release: ReleaseEntry[];
  now: () => number;
  /** Safe mode: the hub loads no extension at all. */
  safe?: boolean;
  /** The asks core resolvers are forwarded to; without one, a package can't register a resolver. */
  asks?: Asks;
  /** The kernel's one lease table (#237): a manifest's lease kinds are declared in it, and `deep.lease` leases from it. */
  leases?: LeaseTable;
  /** The published extension API installs are held to (#139): each method's stability. Default: extensionApi(). */
  api?: readonly ApiEntry[];
  /** Methods this host answers `unsupported` to, as a shim that dropped them would: the contract step's planted twin (#139). */
  unsupported?: readonly string[];
  plant?: Plant;
  /** The hosted-terminal host protocol this hub speaks, and the hosts it starts state (#989). Default: TERMINAL_PROTOCOL. */
  terminalProtocol?: number;
  /** The OS secret store a source's secret is read from (#364). Default: the Keychain on macOS, and none elsewhere. */
  secrets?: SecretStore;
  /** Opens your browser at a sign-in page. Default: macOS's open. */
  browse?: (url: string) => Promise<void>;
  /** The HTTP client every source call goes through; it never follows a redirect. Default: Node's fetch. */
  http?: HttpClient;
  /** Replay: each source call is answered from this recording, never through the client, and no secret is read. */
  replay?: Recording;
  /** The evidence store a series' batch and rollup files go to and are read back from, through their hash (#262). Without one, a series call makes no reading. */
  evidence?: EvidenceStore;
  /** The runner R1 built (#366): every plug-in's model job goes through it, on your own agent. Without one, deep.runner.run refuses. */
  runner?: Runner;
  /**
   * The canvas core `deep.canvas.read` reads through (#411): the hub's own, which takes a deep_query call and answers
   * its reply. Without one, a read is refused.
   */
  canvas?: (call: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /**
   * The first-party pieces the hub runs itself, env-local among them (#103): each a provider in the composition graph,
   * whose users are the pieces whose runs used what it provides. A version the host last saw otherwise is a new one.
   */
  firstParty?: { id: string; version: string; provides: string[] }[];
  /** Marks each write of the hosted terminals index as a durable write point, as the hub's test disk numbers them (#996). */
  point?: () => void;
}
export interface InstallFrom {
  from: string;
  /** The agent session that built or changed it, or null when no agent wrote it. */
  builtBy: string | null;
  /** A project's extension: the repo folder it comes with. */
  project?: string;
  /**
   * What you approved: the event kinds of the record it may read, from the core's and its own (`*` for every one of
   * those), whether it may read their text fields too, the repos or workspaces whose events it may read, by project
   * ID (every one when it names none), the hosts its outside calls may reach, and the canvas documents its check
   * runner may read through `deep.canvas.read`, by doc ID (none when it names none, #411).
   */
  grant?: { record?: string[]; text?: boolean; projects?: string[]; hosts?: HostGrant[]; docs?: string[] };
}
export interface PackageTests { passed: boolean; testsRun: number; failures: { test: string; message: string }[] }
export interface Conformance { id: string; version: string; digest: string; passed: boolean; reasons: string[] }
export interface Loaded { status: 'loaded'; id: string; version: string; place: 'hub' | 'sandbox'; run: string | null }
export interface Refused { status: 'refused'; id: string; version: string; reason: string }
export type Load = Loaded | Refused;
/** One acquired environment handle belongs to the load that created it, never its replacement. */
export interface RunningEnvironment {
  readonly handle: Readonly<EnvironmentHandle>;
  down(): Promise<void>;
}
/** A runtime environment selected from a live, kit-checked package. */
export interface RuntimeEnvironment {
  readonly extension: string;
  readonly version: string;
  up(spec: EnvironmentSpec, lease: EnvironmentLease, checkout: string, deadline: number): Promise<RunningEnvironment>;
}

export interface ExtensionHost {
  install(from: InstallFrom): Promise<Installed>;
  /** The channels of the packages loaded and started (#65), each by name with what it reaches and whether it draws a plan's steps (#1580). */
  channels(): { name: string; kind: 'device' | 'chat' | 'email' | 'text'; steps: boolean; extension: string }[];
  /** A live state source by its registered name (#67): what a workspace's touch reads through. */
  stateSource(name: string): Promise<Omit<StateSource, 'fixture'>>;
  /** You are in this project (#67): its packs, as `.deepbuild/packs.json` names them, install and load if you trust it; an untrusted project's stay out, none installed, none run. */
  enterProject(folder: string): Promise<{ trusted: boolean; views: ProjectView[] }>;
  /** You left it: once nobody is in it, its packs stop and their views go. */
  leaveProject(folder: string): Promise<void>;
  /** What the app shows now: the views and commands of the projects you're in. */
  projectViews(): ProjectView[];
  /** The views of the packages you installed that are loaded, as the app mounts them (#1454). */
  installedViews(): InstalledView[];
  /** What a view's panel kit said of the installed bytes, kept across a restart, as the kits at install are. */
  keepKit(id: string, run: KitRun): void;
  /** One send or read of a loaded channel (#65), its provider calls made by `ctx.fetch`, the caller's. */
  channel(name: string, op: 'deliver', item: ChannelItem, ctx: ChannelCtx): Promise<ChannelDelivered>;
  channel(name: string, op: 'receive', item: null, ctx: ChannelCtx): Promise<ChannelReceived>;
  /** Kept across a restart: a new host on the same home. */
  installed(): Promise<Installed[]>;
  /**
   * Your answer on the trusted path, the app's card (writer `app`) or the CLI once the OS confirms you (writer `cli`):
   * an update of `id` signed by `key` installs from now on.
   */
  trustKey(connection: Connection, id: string, key: string): Promise<void>;
  /**
   * Your yes on the trusted path (the app, or the CLI once the OS confirms you, never from an agent's session): the
   * package may run any command you could, which its manifest asks for with run_as_you. Kept across a restart.
   */
  approve(connection: Connection, id: string, word: 'run_as_you'): Promise<void>;
  /**
   * Takes run-as-you back at once, on the trusted path: resolves once every process the package started through it,
   * whenever it started, is stopped. The package stays loaded, and its terminal calls are refused naming run_as_you.
   */
  revoke(connection: Connection, id: string, word: 'run_as_you'): Promise<void>;
  /** Raw input for a hosted terminal, written to its program: only from the app, which sends the panel you focused. */
  /** A hosted terminal of the hub's own, kept past a restart (#70). */
  openTerminal(connection: Connection, spec: OpenSpec): Promise<{ terminal: string; run: string; pid: number }>;
  rawInput(connection: Connection, terminal: string, text: string): Promise<void>;
  /** What the app's tab for a hosted terminal shows now (#989), for every terminal the hub knows, loaded or not: only for the app. */
  tab(connection: Connection, terminal: string): Promise<TerminalTab>;
  /** The focused tab's size in cells, from the app: the program's terminal and the tab's screen take it (#989). */
  resize(connection: Connection, terminal: string, cols: number, rows: number): Promise<void>;
  /** Runs its conformance on its files now; the result is kept for that digest. */
  check(pkg: Installed): Promise<Conformance>;
  /** Whether a conformance result is kept for this id and version, passed or failed; a load with none is refused. */
  checked(pkg: Installed): boolean;
  load(pkg: Installed): Promise<Load>;
  loaded(): Promise<Loaded[]>;
  checks(): Promise<{ kind: string; extension: string }[]>;
  /** Select a live environment by its registered name; absence and revoked trust refuse, never fall back. */
  environment(name: string): Promise<RuntimeEnvironment>;
  /** `ctx.environment`: the first-party interface the run used, such as environment@1, whose provider it makes the check's piece a user of (#103). */
  runCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number; environment?: string }): Promise<CheckResult>;
  /** Hands each event to the loaded packages subscribed to its kind, once they have all taken it; rejects naming each that didn't. */
  deliver(events: Event[]): Promise<void>;
  /** The hub is ready: its socket listens and its replay is done. Packages loaded before it start now; it rejects naming each that failed to, unloaded. */
  ready(): Promise<void>;
  /** "<METHOD> <path>" routes you chose, served on one listener on 127.0.0.1. */
  turnOn(id: string, routes: string[]): Promise<{ address: string }>;
  turnOff(id: string): Promise<void>;
  /** The hook kinds some loaded package handles: the hub holds a hook only for one of these. */
  hooks(): string[];
  /** Every live handler of the request's kind replies within its deadline; their replies joined in one fixed order. */
  hook(request: HookRequest): Promise<HookReply>;
  /** A hook line, mapped through the adapter `line.agent` names; binds and gates the session it carries (#349). */
  hook(line: HookRequestLine): Promise<{ adapter: string; events: { kind: string }[] }>;
  /**
   * Runs an action of the live piece the call targets, at the version it names, for its caller. A change or send is
   * recorded: action.entered before its handler starts, and action.reported when it ends, with what the hub wrote
   * for it (#363).
   */
  callAction(call: ActionCall): Promise<ActionResult>;
  /** Every action the loaded pieces registered: offered to agents, or left out at install with the reason (#363). */
  actions(): Promise<ActionListing[]>;
  /**
   * Removes a loaded piece: new calls stop first, its users' uses detach, then it stops. `load` enables it again. The
   * provider of a required use is removed only on your yes to one ask naming its users (#103): your no rejects.
   */
  disable(id: string): Promise<void>;
  /** The adapters loaded extensions registered. */
  adapters(): Promise<{ name: string; extension: string; caps: AdapterCaps }[]>;
  /** The index a loaded package registered in place of the shipped one, if any (#355). */
  index(): { name: string; extension: string; fill: IndexFill } | undefined;
  /** The adapter that owns the session: the one that gates it; null before any adapter bound it. */
  owner(session: string): Promise<{ adapter: string } | null>;
  /** An answer for a session: the owning adapter delivers it by a route its flags allow now, or it waits for one. */
  deliverAnswer(answer: Delivery): Promise<Delivered>;
  /** What each loaded package's code returned at its load, by package: a release's fixture returns its calls' results (#139). */
  loadResult(id: string): Record<string, unknown> | undefined;
  /**
   * Each use of a loaded package: the interface its manifest names, the one it is wired to and the provider (#139); and
   * each first-party output with the pieces whose runs used it, as the record keeps them (#103).
   */
  edges(): Promise<{ user: string; uses: string; interface: string; provider: string }[]>;
  /**
   * Your value for a secret a package's manifest names, on the trusted path (#364). A loaded source of it naming the
   * secret with a key test calls once with the value first: valid saves it, the source refusing the key (invalid)
   * saves nothing, and a test that couldn't run (INCONCLUSIVE) saves it. With no key test it reads untested and saves.
   */
  enterSecret(connection: Connection, extension: string, name: string, value: string): Promise<{ test: KeyTest; saved: boolean }>;
  /** The secrets held by reference for the loaded packages, by name with the package that names them; never a value. */
  heldSecrets(): Promise<{ secret: string; provider: string }[]>;
  /** A reading of a loaded polled source, as what needs it would read it: from the cache while fresh, else one call. */
  readSource(name: string): Promise<SourceRead>;
  /** The library sources loaded packages registered (#1731): each one's name and package. */
  libraries(): { name: string; extension: string }[];
  /** The job kinds installed packages hold (#1922), each with the tools that qualified for it and their builds. */
  jobs(): JobListing[];
  /** A kind's params made canonical, every default written out (#1922); an Error names what doesn't hold. */
  jobParams(kind: string, value: unknown): Record<string, JsonValue>;
  /**
   * One run of a qualified tool as a process of its own outside the hub (#1922): its outputs' bytes by name. A tool
   * that calls a provider is given `call`, its submission key and journal, and may reach that provider; `stop` ends its run (#1923).
   * `watch` hears each counter the tool reports as it runs (#1925).
   */
  runJobTool(tool: string, kind: string, params: Record<string, JsonValue>, inputs: JobBytes, call?: Omit<JobCall, 'provider'>, stop?: AbortSignal, watch?: (counter: JobCounter) => void): Promise<Record<string, Uint8Array>>;
  /** What a tool off the machine's host reports before a call (#1924): the weight files it holds, by hash, and its capabilities. */
  jobHostReport(tool: string, kind: string): Promise<{ weights: Weight[]; capabilities: string[] }>;
  /** One search or fetch of a loaded library source (#1731), its calls the hub's; `noAnswer` when one got none. */
  libraryCall(name: string, op: 'search' | 'fetch', arg: unknown): Promise<{ value: unknown; noAnswer: boolean }>;
  /** A file a library's fetch named, downloaded through its source by the hub (#1731); `status` null when its host gave no answer. */
  libraryFile(name: string, path: string): Promise<{ status: number; bytes: Uint8Array } | { status: null; why: string }>;
  /** Pack and library assets use the same resumable Source download, never a package's network client. */
  assetFile(source: { pack: string; url: string } | { library: string; path: string }, spec: { file: string; sha256: string; size: number; kept: string }): Promise<string>;
  /** Reachability without requesting any asset byte, before the networked job's authority ask. */
  assetOnline(pack: string, url: string): Promise<boolean>;
  /** A pack's license file, read through the Source block after the job is authorized. */
  assetTerms(pack: string, url: string): Promise<string>;
  /** Every source call this host made, with its secrets stripped. */
  recording(): Recording;
  /** The readings the record holds of a source with an as-of time in the window, both ends in, in as-of order. */
  readings(source: string, window: { from: number; to: number }): Promise<Reading[]>;
  /**
   * Removes a secret on the trusted path: without your yes, or with a yes naming another list, it only answers the
   * sources that will go BLOCKED without it; with a yes naming exactly those, it removes the secret.
   */
  removeSecret(connection: Connection, extension: string, name: string, answer?: { yes: string[] }): Promise<{ removed: boolean; blocked: string[] }>;
  /** Sign-in through an OAuth loopback for a loaded source that declares one, on the trusted path: the token is saved as the secret. */
  signIn(connection: Connection, extension: string, name: string): Promise<{ saved: true }>;
  /**
   * The next page of a loaded stream source, from the cursor the hub keeps for it across a restart: each event held to
   * the reading type its manifest names, and a page with one that isn't refused with the cursor where it was.
   */
  readStream(name: string, limit: number): Promise<StreamRead>;
  /** On the trusted path (#66): switches a loaded work source on over a scope; its handle, which is also its schedule's name. */
  addWorkSource(connection: Connection, spec: { source: string; scope: string; every: number }): Promise<string>;
  removeWorkSource(connection: Connection, handle: string): Promise<void>;
  /** On the trusted path: your standing rule for a work source's deliveries; its handle. */
  setWorkRule(connection: Connection, handle: string, rule: { sentence: string }): Promise<string>;
  /** "Fix <id>": the item read now by its ID through the sources you switched on, whenever it was made; its task. */
  fix(connection: Connection, id: string): Promise<WorkTask>;
  workTasks(): Promise<WorkTask[]>;
  /** The events taken in on a task's item, each once. */
  workEvents(task_ref: string): Promise<WorkEvent[]>;
  endTask(connection: Connection, task_ref: string): Promise<void>;
  /** A work source's page: its read position, and the items it skipped, dropped, keeps failing or refused. */
  workPage(handle: string): Promise<WorkPage>;
  /** Records a result for delivery into its task's thread; its send key. The hub's timer sends it. */
  deliverResult(task_ref: string, result: WorkResult): Promise<string>;
  deliveries(): Promise<DeliveryRow[]>;
  /** The work.item@1 kit on a loaded work source, against its provider. */
  workKit(source: string, fixture: WorkKitFixture): Promise<{ verdict: 'PASS' | 'FAIL'; failures: string[] }>;
  /** The hub's timer at now() (#365): every run due starts, or queues behind its schedule's running run; resolves once each is dispatched. */
  tick(): Promise<void>;
  /** Resolves once nothing the schedules started is still going and nothing due can start. */
  idle(): Promise<void>;
  /** The schedules list: each row's state in words, its next run from the hub's own schedule and its last result from its last run. */
  schedules(): Promise<ScheduleRow[]>;
  /** A schedule's runs, as the hub recorded them. */
  runs(schedule: string): Promise<ScheduleRun[]>;
  /** Every send, as the hub recorded it. */
  sends(): Promise<SendRow[]>;
  /** Your edit of a schedule's cadence, on the trusted path. */
  editSchedule(connection: Connection, name: string, cadence: { every: number } | { cron: string }): Promise<void>;
  /** Run now, on the trusted path: a run at once, or queued behind the one running. */
  runNow(connection: Connection, name: string): Promise<void>;
  /** Your resume of a paused schedule, on the trusted path. */
  resumeSchedule(connection: Connection, name: string): Promise<void>;
  /** You asked to be told of a notice kind's cause, on the trusted path: recorded as notice.subscribed. Its event's ID. */
  /**
   * A notice you created on the trusted path; `on` names the source it is about, in your words, and a slower cadence
   * it may name. On a source that runs only while shown, the plug-in's job that checks it gets a schedule of its own.
   */
  subscribeNotice(connection: Connection, kind: string, key: string, on?: { source: string; words: string; every?: number }): Promise<string>;
  /** Your standing rule for sends, on the trusted path. Its handle. */
  setSendRule(connection: Connection, rule: SendRule): Promise<string>;
  /** The app API's views/shown and views/hidden (#262): what decides which while-shown cadences run. */
  viewsShown(connection: Connection, report: ViewShown): Promise<void>;
  viewsHidden(connection: Connection, report: { view: string; window: string }): Promise<void>;
  /** Bound values, live or as of a frame's pinned log position, in the order asked (#262). */
  boundValues(handles: string[], at?: { log_pos: number }): Promise<BoundValue[]>;
  /** One window's rollups of a series source by series, from the file its reading.rollup names; null when none is kept. */
  rollup(source: string, span: Span, start: number): Promise<Record<string, Rollup> | null>;
  /** The notices you created, each with its sentence. */
  listNotices(): Promise<NoticeRow[]>;
  /** One run of a check kind, judged: a result citing evidence or a batch whose file is gone or fails its hash is INVALID, naming it. */
  judgeCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number }): Promise<{ verdict: Verdict; cause: string | null; result: CheckResult }>;
  /**
   * Runs a loaded package's own tests (#366), each file under its tests/ in turn, in the package's own process, on this
   * host's recording and clock: what ran, and each failure in the test's own words. None ran is no pass.
   */
  testPackage(pkg: Installed): Promise<PackageTests>;
  /** Stops every process it started, but the terminals of a piece whose manifest's host lives past the app. */
  close(): Promise<void>;
}

const RUNTIME = fileURLToPath(new URL('../runtime/', import.meta.url));
const RUNNER = join(RUNTIME, 'runner.mjs');
/** The kit every view's panel passes (#326, #1454), which the app's replica runs. */
const PANEL_KIT = 'panel@1';
/** How long a package gets to start and register, at its conformance run and at its load. */
const LOAD_MS = 10_000;
/** How long a channel's send or read may take (#65): its provider calls are the hub's, each bounded by the hub. */
const CHANNEL_MS = 30_000;
/** How long one run of a work source has (#66). */
const WORK_RUN_MS = 30 * 60_000;
const CHANNEL = 'channel@1';
const STATE_SOURCE = 'state-source@1';
/** How long one call into a state source may take (#67). */
const STATE_MS = 30_000;
const CHANNEL_KINDS = ['device', 'chat', 'email', 'text'] as const;
type ChannelKind = typeof CHANNEL_KINDS[number];
/**
 * How long past a hook's deadline the host waits for a package's replies to arrive: the package marks each handler
 * late at the deadline itself, so its other handlers' replies (a deny among them) still make the trip back.
 */
const HOOK_GRACE_MS = 250;
/** The largest request body a route takes. */
const BODY = 1024 * 1024;
/** The largest answer an outside call the host makes for a package takes. */
const ANSWER = 1024 * 1024;
const PAGE = 1000;
/** How many readings through its edges a piece keeps by handle, for its model jobs (#103). */
const EDGE_READS = 256;
/** Folder-safe, as extension.manifest@1 writes them. */
const ID = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/;
const VERSION = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$/;
const ROUTE = /^(GET|HEAD|POST|PUT|PATCH|DELETE) \/\S*$/;
/** An adapter's name, as adapter@1 has it: one lower-case word. */
const ADAPTER_NAME = /^[a-z][a-z0-9-]*$/;
/** How long a kit's case may run past the deadline it gave the runner before the install counts it stuck. */
const KIT_GRACE_MS = 5_000;
const CHECK_KIND = 'check.kind@1';
/** The context a check kind in the hub gets with each run: the run's, and host@1 (the supervisor's) to start its process through (#30 AC5). */
export interface HubCheckContext { checkout: string; deadline: number; host: RunHost }
/** The trusted ring's pieces beyond the kernel, which no package replaces. */
const RING = ['app-shell', 'canvas-core', 'supervisor', 'installer'];
/** The done gate's interface, which no package provides until a second gate exists and it has a slot and a kit. */
const GATE = 'gate@1';
const PUBLISHER_KEY = /^ed25519:([0-9a-f]{64})$/;
const ENVIRONMENT = 'environment@1';
/** The wiki's index slot (#355): one fill, a package's that replaces the shipped index. */
const INDEX = 'index@1';
/** A stream source's slot (#364): read from a cursor, in order, losing nothing across a restart. */
const SOURCE = 'source@1';
/** A bound value's handle: a number source's reading, or one series of a series source (#262). */
const BOUND = /^reading:([a-z][a-z0-9_.-]*)(?:#(.+))?$/;
/** Who a package's own test calls its actions as (#366): you, in the app. */
const TESTER: Connection = { writer: 'app', actor: 'you', scope: 'you' };
/** How long one test file of a package may run. */
const TEST_MS = 60_000;
/** What a panel would reach the network with itself (#366). */
const NETWORK = /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\bnew\s+(XMLHttpRequest|WebSocket|EventSource)\b/;
/** How often the hub's timer looks for a schedule's run that is due (#365). */
const TIMER_MS = 250;
const INDEX_NAME = /^[a-z][a-z0-9_.-]*$/;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** A package's manifest, as its folder holds it. */
/** The packs a project names in `.deepbuild/packs.json` (#67): folders inside it. */
function packsNamed(project: string): string[] {
  const file = join(project, '.deepbuild', 'packs.json');
  if (!existsSync(file)) return [];
  const { packs } = JSON.parse(readFileSync(file, 'utf8')) as { packs?: unknown };
  if (!texts(packs)) throw Error(`${file} names no list of packs`);
  for (const pack of packs as string[]) if (isAbsolute(pack) || pack.split('/').includes('..')) throw Error(`${file} names ${pack}, which isn't a folder inside the project`);
  return packs as string[];
}
const manifestOf = (folder: string): Manifest => JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as Manifest;
/** A piece as composition reads it (#103): its id and its manifest's rows. */
const pieceOf = (id: string, m: Manifest): Piece => ({ id, provides: m.provides ?? [], uses: m.uses ?? [] });
/** A use is optional when its manifest row or its `deep.use` says so. */
const optional = (ext: Ext, use: UseRow): boolean => use.optional === true || ext.uses.get(use.interface) === true;
/** Where a value first breaks a JSON Schema, or undefined when it holds (#103); a schema the host can't read breaks at its root. */
function schemaBreak(name: string, schema: unknown, value: unknown): string | undefined {
  try {
    const held = registry([{ name, schema: schema as Schema }]).validate(name, value);
    return held.ok ? undefined : `${held.issues[0]!.path || '/'} (${held.issues[0]!.code})`;
  } catch (e) {
    return `/ (its schema can't be read: ${message(e)})`;
  }
}
const nothing = (outcome: CheckResult['outcome'], failure?: string): CheckResult => ({
  outcome, testsRun: 0, evidence: [], read: [], mask: null,
  failures: failure ? [{ test: 'extension host', file: '', line: 0, stack: null, assertion: false, message: failure }] : [],
});
/** The one permission a piece that hosts shells asks for: run any command you could (#104). */
const RUN_AS_YOU = 'run_as_you';
/** Whether the manifest asks for the grant: an access word, or `notices` for a declared notice kind. */
const granted = (m: Manifest, needs: string): boolean => (needs === 'notices' ? (m.notices ?? []).length > 0 : (m.access?.words ?? []).includes(needs));
/** The interpreters a `main` may name, each only as the program of that name on the hub's own PATH. */
const INTERPRETERS = ['python3', 'python', 'node', 'ruby', 'perl'];
/**
 * The install of the interpreter a `main` names on its first line (the folder above its program's own), so it can
 * run in the sandbox: only an interpreter the hub itself would run by name, and only an install of its own, never
 * one holding your home or the package. A system program (`#!/bin/sh`) needs no grant, and any other adds none.
 */
function interpreter(folder: string): string[] {
  const first = readFileSync(join(folder, 'main'), 'utf8').split('\n', 1)[0] ?? '';
  const program = first.startsWith('#!') ? first.slice(2).trim().split(/\s+/)[0] ?? '' : '';
  if (!program.startsWith('/') || !existsSync(program)) return [];
  const real = realpathSync(program);
  const known = (process.env.PATH ?? '').split(':').filter((dir) => dir.startsWith('/'))
    .some((dir) => INTERPRETERS.some((name) => existsSync(join(dir, name)) && realpathSync(join(dir, name)) === real));
  const install = dirname(dirname(real));
  const holds = (path: string): boolean => path === install || path.startsWith(`${install}/`);
  return known && install.split('/').filter(Boolean).length >= 3 && !holds(realpathSync(homedir())) && !holds(folder) ? [install] : [];
}

class Host implements ExtensionHost {
  private readonly entries: Record<string, Entry>;
  private readonly results: Record<string, Conformance>;
  /** The publisher key trusted for each package ID: its first signed install's, or one you trusted since. */
  private keys: Record<string, string>;
  private readonly exts = new Map<string, Ext>();
  /** The content keys each running check's `deep.canvas.read` calls returned, by the package running it (#411). */
  private readonly canvasKeys = new Map<Ext, string[]>();
  /** The packages you approved run-as-you for, by ID. */
  private runAsYou: Record<string, boolean>;
  private readonly terminals: Terminals;
  private readonly loading = new Map<string, Promise<void>>();
  /** The last package's lease kinds being declared (#44): each package's are read and declared after it. */
  private declaring: Promise<void> = Promise.resolve();
  /** Packages' calls under way. */
  private readonly calls = new Set<Promise<void>>();
  /** Conformance runs under way. */
  private readonly checking = new Set<Promise<Conformance>>();
  private isReady = false;
  /** What each loaded package's code returned at its load (#139). */
  private readonly loadResults = new Map<string, Record<string, unknown>>();
  /** The published API by method, whose stability each call is held to (#139). */
  private readonly published: ReadonlyMap<string, ApiEntry>;
  /** The edges wired at load: user → (the interface its manifest uses → the interface it reads from its provider). */
  private readonly wired = new Map<string, Map<string, string>>();
  /** The provider each use reads from, by user and interface, until a piece loads, stops or installs (#103). */
  private readonly routes = new Map<string, Ext | undefined>();
  /** The channel sends and reads under way (#65), by the call ID their context's fetch names. */
  private readonly channelCalls = new Map<string, { ext: Ext; ctx: ChannelCtx }>();
  private channelCount = 0;
  /** Install folders' manifests, read once each. */
  private readonly manifests = new Map<string, Manifest>();
  /** The starts of the packages loaded before ready, once ready runs. */
  private starting: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly routing: AdapterRouting;
  private readonly sourceHost: HostSources;
  private readonly jobTools: JobTools;
  private readonly modelJobs: Jobs;
  private readonly scheduleHost: HostSchedules;
  private readonly sources: Sources;
  private readonly scheduler: Schedules;
  private readonly sending: Sends;
  /** The work sources you switched on, their runs, tasks and deliveries (#66). */
  private readonly work: WorkSources;
  private readonly noticeHost: Notices;
  /** Each store's items as the record holds them, and their bytes in all, kept as they are put (#365): only this host writes them. */
  private readonly storeItems = new Map<string, { items: Map<string, { value: unknown; generation: number; bytes: number }>; bytes: number }>();
  private timer: NodeJS.Timeout | undefined;
  /** The hub's series, once it has an evidence store (#262). */
  private readonly series: SeriesStore | undefined;
  private readonly files: HostFiles;
  constructor(private readonly options: ExtensionHostOptions) {
    this.files = new HostFiles(options.home);
    this.entries = this.read('installed.json');
    // An install recorded before #351 holds the check kinds its manifest declares.
    for (const e of Object.values(this.entries)) e.holds ??= manifestOf(e.folder).checks ?? [];
    this.results = this.read('checked.json');
    this.keys = this.read('keys.json');
    this.jobTools = new JobTools({ entries: this.entries, supervisor: options.supervisor, home: options.home, now: options.now, files: this.files, plant: options.plant });
    this.published = new Map((options.api ?? extensionApi()).map((e) => [e.method, e]));
    this.runAsYou = this.read('run-as-you.json');
    const plant = options.plant;
    this.terminals = new Terminals(options.home, options.supervisor, {
      protocol: options.terminalProtocol ?? TERMINAL_PROTOCOL,
      // A writer the host refused, by its process: recorded, never delivered.
      refused: (terminal, pid) => {
        const now = options.now();
        void options.record.append(CORE, { v: 1, id: ulid(now), kind: 'terminal.refused', ts: now, data: { terminal, pid } }).catch(() => undefined);
      },
      ...((TERMINAL_PLANTS as readonly string[]).includes(plant as string) ? { plant: plant as TerminalPlant } : {}),
      ...(options.point ? { point: options.point } : {}), now: options.now,
    });
    const series = this.series = options.evidence ? new SeriesStore({
      record: options.record, evidence: options.evidence, now: options.now, connection: CORE,
      timeoutOf: (name) => [...this.exts.values()].map((e) => e.live ? e.sources.get(name) : undefined).find((s): s is Polled => s?.variant === 'polled')?.timeout,
    }) : undefined;
    this.sources = new Sources({
      now: options.now, http: options.http ?? nodeHttp, secrets: options.secrets ?? osSecrets(), ...(options.replay ? { replay: options.replay } : {}),
      ...(series ? { land: (source: Polled, asOf: number, values: Map<string, number>) => series.land(source, asOf, values) } : {}),
      // Each call's cost and each new reading, as the core: the hub makes every source call.
      append: async (kind, data) => { await options.record.append(CORE, { v: 1, id: ulid(options.now()), kind, ts: options.now(), data } as EventInput); },
    });
    this.sending = new Sends({
      record: options.record, now: options.now, http: options.http ?? nodeHttp, asks: options.asks,
      rules: () => this.read<SendRule>('send-rules.json'), saveRules: (rules) => this.save('send-rules.json', rules),
    });
    this.scheduler = new Schedules({
      now: options.now,
      newRun: () => `run:${ulid(options.now())}`,
      append: async (data: RunEvent) => { await options.record.append(CORE, { v: 1, id: ulid(options.now()), kind: 'schedule.run', ts: options.now(), data: data as unknown as JsonValue }); },
      ready: (decl) => this.exts.get(decl.plugin)?.live === true && (!this.work.isWork(decl.name) || this.work.on(decl.name)),
      blocked: (decl) => (this.work.isWork(decl.name) ? this.blockedWork(decl) : this.blockedRun(decl)),
      dispatch: (decl, run) => (this.work.isWork(decl.name) ? this.work.run(decl.name) : this.dispatchRun(decl, run)),
      saved: (name, settings) => this.save('schedules.json', { ...this.read('schedules.json'), [name]: settings }),
    });
    this.work = new WorkSources(this.workHost());
    this.sourceHost = new HostSources({ record: options.record, now: options.now, files: this.files, exts: this.exts, ask: (ext, ms, what, method, params) => this.ask(ext, ms, what, method, params) }, this.sources, series);
    this.scheduleHost = new HostSchedules({ record: options.record, exts: this.exts, sources: { holds: (id, name) => this.sources.holds(id, name), workExt: (source) => this.sourceHost.workExt(source) }, sending: this.sending }, this.scheduler);
    this.routing = new AdapterRouting({ usable: async (ext) => !(await this.revoked(ext)), ask: (ext, ms, what, method, params) => this.ask(ext, ms, what, method, params), plant: options.plant });
    this.modelJobs = new Jobs({ record: options.record, now: options.now, runner: options.runner, access: { reaches: (ext, kind) => this.reaches(ext, kind), visible: (ext, event) => this.visible(ext, event), refuse: (ext, scope, clause, given) => this.refused(this.connection(ext, scope), 'deep.runner.run', 'grant', clause, [given]) } });
    this.noticeHost = new Notices({ record: options.record, now: options.now, files: this.files, entries: this.entries, exts: this.exts, scheduler: this.scheduler, series, answers: this.modelJobs });
  }

  /** The work sources' side of the host (#66). */
  private workHost(): ConstructorParameters<typeof WorkSources>[0] {
    return {
      record: this.options.record, now: () => this.options.now(), asks: this.options.asks,
      added: () => this.read<Added>('work-sources.json'), saveAdded: (all) => this.save('work-sources.json', all),
      decl: (source) => {
        const ext = this.workExt(source);
        const d = ext?.sources.get(source);
        return ext && d?.variant === 'stream' && d.work ? { work: d.work, plugin: ext.entry.id } : undefined;
      },
      call: (source, op, arg) => this.workCall(source, op, arg),
      schedule: async (handle, added, plugin) => {
        const decl: ScheduleDecl = { name: handle, plugin, cadence: { every: added.every }, deadline: WORK_RUN_MS, declares: { readings: [added.source], notices: [], stores: [], sends: [], noop: true } };
        await this.scheduler.register(decl, { runs: await this.runs(handle), settings: this.read<Settings>('schedules.json')[handle] ?? {} });
      },
      trusted: (connection, what) => this.trustedPath(connection, what),
    };
  }
  private workExt(source: string): Ext | undefined {
    return this.sourceHost.workExt(source);
  }
  /** One op of a loaded work source, bounded; its context's fetch goes through the hub under this call's ID. */
  private async workCall(source: string, op: 'list' | 'item' | 'deliver' | 'find', arg: unknown): Promise<{ value: unknown; noAnswer: boolean }> {
    return this.sourceHost.workCall(source, op, arg);
  }
  jobs(): JobListing[] {
    return this.jobTools.jobs();
  }
  jobParams(kind: string, value: unknown): Record<string, JsonValue> {
    return this.jobTools.jobParams(kind, value);
  }
  async runJobTool(tool: string, kind: string, params: Record<string, JsonValue>, inputs: JobBytes, call?: Omit<JobCall, 'provider'>, stop?: AbortSignal, watch?: (counter: JobCounter) => void): Promise<Record<string, Uint8Array>> {
    return this.jobTools.runJobTool(tool, kind, params, inputs, call, stop, watch);
  }
  async jobHostReport(tool: string, kind: string): Promise<{ weights: Weight[]; capabilities: string[] }> {
    return this.jobTools.jobHostReport(tool, kind);
  }
  /** The library sources loaded packages registered (#1731), asset.library@1's fills: each one's name and package. */
  libraries(): { name: string; extension: string }[] {
    return this.sourceHost.libraries();
  }
  /**
   * One op of a loaded library source (#1731), search or fetch, bounded by its timeout: the package's code reads the
   * library's API through its context's fetch, the hub's call to the library's host; `noAnswer` when a call got none.
   */
  async libraryCall(name: string, op: 'search' | 'fetch', arg: unknown): Promise<{ value: unknown; noAnswer: boolean }> {
    return this.sourceHost.libraryCall(name, op, arg);
  }
  /** A file a library's fetch named, downloaded through its source on its host by the hub, never by the package (#1731). */
  async libraryFile(name: string, path: string): Promise<{ status: number; bytes: Uint8Array } | { status: null; why: string }> {
    return this.sourceHost.libraryFile(name, path);
  }
  async assetFile(source: { pack: string; url: string } | { library: string; path: string }, spec: { file: string; sha256: string; size: number; kept: string }): Promise<string> {
    return this.sourceHost.assetFile(source, spec);
  }
  async assetOnline(pack: string, value: string): Promise<boolean> {
    return this.sourceHost.assetOnline(pack, value);
  }
  async assetTerms(pack: string, url: string): Promise<string> {
    return this.sourceHost.assetTerms(pack, url);
  }
  /** A work source's run is BLOCKED while its package isn't loaded or the secret it needs isn't held. */
  private async blockedWork(decl: ScheduleDecl): Promise<string | null> {
    return this.scheduleHost.blockedWork(decl);
  }
  async addWorkSource(connection: Connection, spec: { source: string; scope: string; every: number }): Promise<string> {
    return this.work.add(connection, spec);
  }
  async removeWorkSource(connection: Connection, handle: string): Promise<void> {
    return this.work.remove(connection, handle);
  }
  async setWorkRule(connection: Connection, handle: string, rule: { sentence: string }): Promise<string> {
    return this.work.setRule(connection, handle, rule);
  }
  async fix(connection: Connection, id: string): Promise<WorkTask> {
    return this.work.fix(connection, id);
  }
  async workTasks(): Promise<WorkTask[]> {
    return this.work.workTasks();
  }
  async workEvents(task_ref: string): Promise<WorkEvent[]> {
    return this.work.workEvents(task_ref);
  }
  async endTask(connection: Connection, task_ref: string): Promise<void> {
    return this.work.endTask(connection, task_ref);
  }
  async workPage(handle: string): Promise<WorkPage> {
    return this.work.page(handle);
  }
  async deliverResult(task_ref: string, result: WorkResult): Promise<string> {
    return this.work.deliverResult(task_ref, result);
  }
  async deliveries(): Promise<DeliveryRow[]> {
    return this.work.deliveries();
  }
  async workKit(source: string, fixture: WorkKitFixture): Promise<{ verdict: 'PASS' | 'FAIL'; failures: string[] }> {
    return this.work.kit(source, fixture);
  }

  private read<T>(name: string): Record<string, T> {
    return this.files.read<T>(name);
  }
  private save(name: string, value: unknown): void {
    return this.files.save(name, value);
  }
  private entry(pkg: Installed): Entry {
    const entry = this.entries[pkg.id];
    if (!entry) throw Error(`${pkg.id} isn't installed`);
    return entry;
  }

  async install(from: InstallFrom): Promise<Installed> {
    const manifest = JSON.parse(readFileSync(join(from.from, 'deepbuild.json'), 'utf8')) as Partial<Manifest>;
    const { id, version } = manifest;
    if (typeof id !== 'string' || !ID.test(id) || typeof version !== 'string' || !VERSION.test(version)) {
      throw Error(`${from.from}/deepbuild.json names no owner/name id and version to install under`);
    }
    const project = from.project === undefined ? null : realpathSync(from.project);
    // Read as data before any of its code runs; a symlink anywhere refuses the install.
    this.admit(manifest as Manifest, packageDigest(from.from), project);
    // An update that drops an interface an installed piece uses, with no adapter for it, asks you first (#139).
    await this.updateHeld(manifest as Manifest);
    // Its edges, typed (#103): every use it and the pieces it serves have matches a provider, with no cycle among them.
    const replacing = (manifest.replaces ?? []).filter((r) => r.includes('/') && r !== id && this.entries[r]);
    const after = [...this.pieces().filter((p) => p.id !== id && !replacing.includes(p.id)), pieceOf(id, manifest as Manifest)];
    this.wireCheck(manifest as Manifest, after);
    const users = after.flatMap((p) => p.uses.filter((u) => resolve(p.id, u, after, this.namesAlone)?.id === id).map((use) => ({ user: p.id, use })));
    // A quota that counts nothing would never refuse: each is a whole number of calls per a whole number of ms.
    for (const h of from.grant?.hosts ?? []) {
      const whole = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) > 0;
      if (typeof h?.host !== 'string' || !whole(h.quota?.calls) || !whole(h.quota?.per_ms)) throw Error(`${id}'s grant gives ${String(h?.host)} a quota that isn't a count of calls per a time`);
    }
    // A folder of its own for each install, in use once installed.json names it: an install that fails, or stops
    // partway, leaves the one installed before as it was, its bytes with its grant and provenance.
    mkdirSync(join(this.options.home, 'extensions', id), { recursive: true });
    const folder = mkdtempSync(join(this.options.home, 'extensions', id, `${version}-`));
    const before = this.entries[id];
    let entry: Entry;
    try {
      copyPackage(from.from, folder);
      const hosts = from.grant?.hosts?.map((h) => ({ host: h.host, quota: { calls: h.quota.calls, per_ms: h.quota.per_ms } }));
      const digest = this.options.plant === 'trusts-envelope-digest' ? manifest.digest! : packageDigest(folder);
      entry = {
        id, version, folder, digest, builtBy: from.builtBy, project, kits: [],
        grant: {
          record: [...(from.grant?.record ?? [])], ...(from.grant?.text === true ? { text: true } : {}),
          ...(from.grant?.projects ? { projects: [...from.grant.projects] } : {}), ...(hosts ? { hosts } : {}),
          ...(from.grant?.docs ? { docs: [...from.grant.docs] } : {}),
        },
        holds: [...(manifest.checks ?? [])],
      };
      // Each slot's kit runs on what it registers first: a FAIL refuses the install, and what was installed stays (#349).
      entry.kits = await this.installKits(entry, manifest as Manifest);
      // Its job kinds and tools, read from its code, each tool qualified on its kind's fixtures and its build held (#1922).
      if (manifest.jobs?.length || manifest.job_tools?.length) entry.jobs = await this.jobsAt(entry, manifest as Manifest);
      // A new version, or a replacement, passes its users' contract tests before the version in use stops (#103).
      if ((before || replacing.length) && users.length) await this.contract(entry, manifest as Manifest, users);
      // A kind it replaces is its own from now on, no longer the package's that held it (#351).
      const gone = (k: string): boolean => manifest.replaces?.includes(k) ?? false;
      const replaced = Object.values(this.entries).filter((e) => e.id !== id && (e.holds.some(gone) || Object.keys(e.jobs?.kinds ?? {}).some(gone)))
        .map((e) => ({ ...e, holds: e.holds.filter((k) => !gone(k)), ...(e.jobs ? { jobs: { ...e.jobs, kinds: Object.fromEntries(Object.entries(e.jobs.kinds).filter(([k]) => !gone(k))) } } : {}) }));
      this.save('installed.json', { ...this.entries, ...Object.fromEntries(replaced.map((e) => [e.id, e])), [id]: entry });
      for (const e of replaced) Object.assign(this.entries[e.id]!, { holds: e.holds, ...(e.jobs ? { jobs: e.jobs } : {}) });
      if (entry.jobs?.tools.some((t) => t.build !== null)) {
        this.jobTools.keep(entry.jobs);
      }
    } catch (e) {
      rmSync(folder, { recursive: true, force: true });
      throw e;
    }
    this.entries[id] = entry;
    // AC10's wrong program (#139): each use of an interface of this provider is wired to the newest major it provides.
    if (this.options.plant === 'rewires-to-newest') {
      const provided = (manifest.provides ?? []).map((p) => p.interface);
      for (const e of Object.values(this.entries).filter((x) => x.id !== id)) {
        for (const u of manifestOf(e.folder).uses ?? []) {
          const base = u.interface.slice(0, u.interface.lastIndexOf('@'));
          const newest = provided.filter((i) => i.startsWith(`${base}@`)).sort((a, b) => Number(b.split('@')[1]) - Number(a.split('@')[1]))[0];
          if (newest && newest !== u.interface) this.wired.set(e.id, new Map([...(this.wired.get(e.id) ?? []), [u.interface, newest]]));
        }
      }
    }
    // A signed package's key is trusted on first use.
    if (manifest.publisher_key !== undefined && this.keys[id] === undefined) {
      this.keys = { ...this.keys, [id]: manifest.publisher_key };
      this.save('keys.json', this.keys);
    }
    if (before) rmSync(before.folder, { recursive: true, force: true });
    // The copy running is the install before: it stops, after any load of it under way. A read it still serves is
    // waited for when the copy is of the same version, and refused at its edge when the version changed (#103).
    await this.serial(id, async () => {
      const running = this.exts.get(id);
      if (running && running.entry !== entry) await this.unload(running, running.entry.version === entry.version);
    });
    // The packages it replaces are removed, and their users rewire to it by type (#103).
    for (const gone of replacing) {
      await this.serial(gone, async () => {
        const running = this.exts.get(gone);
        if (running) await this.unload(running, false);
      });
      const removed = this.entries[gone];
      delete this.entries[gone];
      this.save('installed.json', this.entries);
      if (removed) rmSync(removed.folder, { recursive: true, force: true });
    }
    this.routes.clear();
    await this.reopen(id, entry.version, dependents(graph(this.pieces(), this.namesAlone), id));
    return this.installedOf(entry);
  }
  /** Whether the planted hub that wires by names alone runs (#103). */
  private get namesAlone(): boolean {
    return this.options.plant === 'compares-names-alone';
  }
  /** Each installed piece as composition reads it, its manifest read once per install folder. */
  private pieces(): Piece[] {
    return Object.values(this.entries).map((e) => pieceOf(e.id, this.manifestAt(e.folder)));
  }
  private manifestAt(folder: string): Manifest {
    let m = this.manifests.get(folder);
    if (!m) {
      // Only installed folders' are kept: an install in a new folder takes its old one's place (#824).
      const installed = new Set(Object.values(this.entries).map((e) => e.folder));
      for (const old of this.manifests.keys()) if (!installed.has(old)) this.manifests.delete(old);
      this.manifests.set(folder, m = manifestOf(folder));
    }
    return m;
  }
  /**
   * The install's type check (#103), on the pieces as they would be once it installs: each of its uses matches a
   * provider of its interface, each use of the interfaces it provides still matches one, and no use closes a cycle.
   * The first refusal throws, naming the edge and the first schema path that differs, or the cycle; nothing is wired.
   */
  private wireCheck(m: Manifest, after: Piece[]): void {
    const { id } = m;
    for (const use of m.uses ?? []) {
      const why = refusal(id, use, after, this.namesAlone);
      if (why) throw Error(`${why}, so ${id} isn't installed`);
    }
    const provided = new Set((m.provides ?? []).map((p) => p.interface));
    for (const p of after) {
      for (const use of p.id === id ? [] : p.uses.filter((u) => provided.has(u.interface))) {
        const why = refusal(p.id, use, after, this.namesAlone);
        if (why) throw Error(`${why}, so ${id}@${m.version} isn't installed`);
      }
    }
    const cycle = cycleThrough(graph(after, this.namesAlone), id);
    if (cycle) throw Error(`installing ${id} would close a cycle of uses, ${cycle.join(' → ')}, so it isn't installed and nothing is wired`);
  }
  /**
   * The contract tests between a new version and the pieces that will use it (#103), before the version in use stops:
   * the new version starts staged, the outputs those pieces use are recorded and held to their schemas, and each
   * user's own tests replay against them, read at the user's minor. Each run is recorded; one that fails, or a start
   * that fails, refuses the install, naming the edge.
   */
  private async contract(entry: Entry, manifest: Manifest, users: { user: string; use: UseRow }[]): Promise<void> {
    const { folder, digest } = this.snapshot(entry);
    const staged = this.ext(entry, folder, manifest, digest, 'sandbox', 'conformance');
    staged.staged = true;
    const outputs = new Map<string, { value: unknown } | { broke: string }>();
    try {
      try {
        await this.start(staged);
      } catch (e) {
        throw Error(`${entry.id}@${entry.version} didn't start, so it isn't installed and the version in use stays: ${message(e)}`);
      }
      for (const iface of new Set(users.map((u) => u.use.interface))) {
        try {
          const value = await within(CALL_MS, `${entry.id}'s ${iface}`, staged.ask!('output', { name: iface }));
          const schema = (manifest.provides ?? []).find((r) => r.interface === iface)?.schema;
          const broke = schema === undefined ? undefined : schemaBreak(iface, schema, value);
          outputs.set(iface, broke === undefined ? { value } : { broke: `its output breaks its schema at ${broke}` });
        } catch (e) {
          outputs.set(iface, { broke: `its output failed: ${message(e)}` });
        }
      }
    } finally {
      await staged.stop?.();
      rmSync(folder, { recursive: true, force: true });
    }
    const replay = new Map([...outputs].flatMap(([iface, out]) => ('value' in out ? [[iface, out.value] as const] : [])));
    const failed: string[] = [];
    for (const { user, use } of users) {
      const out = outputs.get(use.interface)!;
      let why = 'broke' in out ? out.broke : undefined;
      const ext = this.exts.get(user);
      if (why === undefined && ext?.live && ext.ask) {
        ext.replay = replay;
        try {
          const ran = await this.runTests(ext);
          if (ran.failures.length) why = ran.failures.map((f) => `${f.test}: ${f.message}`).join('; ');
        } finally {
          delete ext.replay;
        }
      }
      const now = this.options.now();
      await this.options.record.append(CORE, {
        v: 1, id: ulid(now), kind: 'composition.tested', ts: now,
        data: { user, interface: use.interface, provider: entry.id, version: entry.version, passed: why === undefined },
      });
      if (why !== undefined) failed.push(`the edge ${user} uses ${use.interface} from ${entry.id}: its contract test against ${entry.version} failed: ${why}`);
    }
    if (failed.length) throw Error(`${failed.join('; ')}; so ${entry.id}@${entry.version} isn't installed, and the version in use stays`);
  }
  /** Each first-party output's users, as the record keeps them (#103): one row per user, interface and provider. */
  private async firstPartyUses(): Promise<{ user: string; interface: string; provider: string }[]> {
    const ids = new Set((this.options.firstParty ?? []).map((f) => f.id));
    if (!ids.size) return [];
    const rows = (await this.options.record.raw("SELECT data FROM events WHERE kind = 'composition.used' ORDER BY log_pos")) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as { user: string; interface: string; provider: string }).filter((u) => ids.has(u.provider));
  }
  /** A run of `user`'s used a first-party output: recorded once, as an edge of the composition graph (#103). */
  private async usedFirstParty(user: string, iface: string): Promise<void> {
    const provider = (this.options.firstParty ?? []).find((f) => f.provides.includes(iface));
    if (!provider) throw Error(`a check run names the output ${iface}, which no first-party piece provides`);
    if ((await this.firstPartyUses()).some((u) => u.user === user && u.interface === iface && u.provider === provider.id)) return;
    const now = this.options.now();
    await this.options.record.append(CORE, { v: 1, id: ulid(now), kind: 'composition.used', ts: now, data: { user, interface: iface, provider: provider.id } });
  }
  /**
   * A first-party piece at a version this host last saw otherwise is a new version (#103): the claims of the pieces
   * whose runs used it, and of everything that uses those, reopen once.
   */
  private async firstPartyVersions(): Promise<void> {
    const seen = this.read<string>('first-party.json');
    const now = { ...seen };
    for (const piece of this.options.firstParty ?? []) {
      now[piece.id] = piece.version;
      if (seen[piece.id] === undefined || seen[piece.id] === piece.version) continue;
      const users = [...new Set((await this.firstPartyUses()).filter((u) => u.provider === piece.id && this.entries[u.user]).map((u) => u.user))];
      const edges = graph(this.pieces(), this.namesAlone);
      await this.reopen(piece.id, piece.version, [...new Set([...users, ...users.flatMap((u) => dependents(edges, u))])].sort());
    }
    this.save('first-party.json', now);
  }
  /** Reopens the claims of each piece, once, for a provider's version now active (#103). */
  private async reopen(provider: string, version: string, pieces: string[]): Promise<void> {
    for (const piece of pieces) {
      const now = this.options.now();
      await this.options.record.append(CORE, { v: 1, id: ulid(now), kind: 'composition.reopened', ts: now, data: { piece, provider, version } });
    }
  }
  /**
   * What the installer checks in the manifest and the files before any of the package is copied (#351); the first
   * refusal throws, naming what refused it, and nothing is installed.
   */
  private admit(m: Manifest, files: string, project: string | null): void {
    const { id } = m;
    if (this.options.plant !== 'trusts-envelope-digest' && m.digest !== files) {
      throw Error(`${id}'s envelope digest ${String(m.digest)} isn't its files' digest ${files}: it changed since it was built, so it isn't installed`);
    }
    if (m.publisher_key !== undefined || m.signature !== undefined) {
      const raw = PUBLISHER_KEY.exec(m.publisher_key ?? '')?.[1];
      const key = raw && createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw, 'hex').toString('base64url') }, format: 'jwk' });
      const envelope = canonicalize({ id, version: m.version, digest: m.digest ?? null, publisher_key: m.publisher_key ?? null });
      const signed = key && /^[0-9a-f]{128}$/.test(m.signature ?? '') && verifySignature(null, envelope, key, Buffer.from(m.signature!, 'hex'));
      if (!signed) throw Error(`${id}'s signature doesn't verify with the publisher key its envelope names, ${String(m.publisher_key)}, so it isn't installed`);
    }
    const trusted = this.keys[id];
    if (trusted !== undefined && m.publisher_key !== trusted) {
      throw Error(`${id}@${m.version} is signed by ${m.publisher_key ?? 'no key'}, not ${trusted}, the key trusted for ${id}; trust the new key on the trusted path (deep install --trust-key) to install it`);
    }
    const replaces = m.replaces ?? [];
    for (const piece of RING) if (replaces.includes(piece)) throw Error(`${id} declares it replaces ${piece}, a piece of the trusted ring, which no package replaces`);
    const gate = replaces.includes('done-gate') || (m.provides ?? []).some((p) => p.interface === GATE);
    if (gate && this.options.plant !== 'refuses-only-the-ring' && !hubSlots().some((row) => row.interface === GATE)) {
      throw Error(`${id} declares it replaces the done gate, or provides a second one beside it (${GATE}); no package does until a second gate exists and ${GATE} opens with its kit`);
    }
    const others = Object.values(this.entries).filter((e) => e.id !== id);
    for (const e of others) if (manifestOf(e.folder).conflicts?.includes(id) || m.conflicts?.includes(e.id)) throw Error(`${id} conflicts with ${e.id}, which is installed; remove one to install the other`);
    // A user-level package's kinds are in use in every project; a project's, only in its own.
    const overlaps = (e: Entry): boolean => e.project === null || project === null || e.project === project;
    for (const kind of m.checks ?? []) {
      const holder = others.find((e) => e.holds.includes(kind) && overlaps(e));
      if (holder && !replaces.includes(kind)) throw Error(`${id} registers the check kind ${kind}, which ${holder.id} holds, and doesn't declare that it replaces it`);
    }
    // A job kind is one slot too (#1922): a second registration of it is refused unless it says it replaces the first.
    for (const kind of m.jobs ?? []) {
      const holder = others.find((e) => e.jobs?.kinds[kind] && overlaps(e));
      if (holder && !replaces.includes(kind)) throw Error(`${id} registers the job kind ${kind}, which ${holder.id} holds, and doesn't declare that it replaces it, so it isn't installed`);
    }
    const published = frozenDigests();
    for (const contract of m.kernel ?? []) if (!Object.hasOwn(published, contract)) throw Error(`${id} runs on the kernel contract ${contract}, which this kernel doesn't publish`);
    // A package that uses a preview entry by name is a preview package (#139).
    const listed = m.requires?.preview ?? [];
    if (m.stability === 'stable' && listed.length && this.options.plant !== 'stable-may-call-preview') throw Error(`${id} declares itself stable and lists ${listed.join(', ')} in requires.preview; a package that uses a preview entry can't declare itself stable`);
  }
  /**
   * An update of an installed package that no longer provides an interface another installed piece uses, neither
   * itself nor through an adapter row, asks you once, naming those users, and installs nothing until you answer: your
   * yes goes on, anything else refuses the update and leaves the installed version and its users' edges as they were.
   */
  private async updateHeld(m: Manifest): Promise<void> {
    const before = this.entries[m.id];
    if (!before) return;
    const old = manifestOf(before.folder);
    const keeps = new Set((m.provides ?? []).map((p) => p.interface));
    const dropped = (old.provides ?? []).map((p) => p.interface).filter((i) => !keeps.has(i));
    const users = Object.values(this.entries).filter((e) => e.id !== m.id)
      .flatMap((e) => (manifestOf(e.folder).uses ?? []).filter((u) => dropped.includes(u.interface)).map((u) => ({ user: e.id, uses: u.interface })));
    if (!users.length) return;
    if (this.options.plant === 'rewires-to-newest') return;
    const named = users.map((u) => `${u.user} uses ${u.uses}`).join('; ');
    if (!this.options.asks) throw Error(`${m.id}@${m.version} no longer provides what installed pieces use (${named}), and this host has no asks core to ask you; nothing was installed`);
    const question = `Install ${m.id} ${m.version}? It no longer provides ${[...new Set(users.map((u) => u.uses))].join(', ')}, which ${[...new Set(users.map((u) => u.user))].join(', ')} use${users.length > 1 ? '' : 's'}, and keeps no adapter for it.`;
    const yes = await this.yours('extension.update', question, { update: m.id, version: m.version, users } as unknown as JsonValue, `Install ${m.version}`, `Keep ${before.version}`,
      users.map((u) => ({ does: `Install ${m.id} ${m.version}, leaving ${u.user}'s use of ${u.uses} with no provider`, changes: [`${u.user} uses ${u.uses}`], undo: `Install ${m.id} ${before.version} again` })));
    if (yes) return;
    if (yes === undefined) throw Error(`${m.id}@${m.version} isn't installed: the host closed before you answered`);
    throw Error(`${m.id}@${m.version} isn't installed: you kept ${before.version}, so ${named} keep${users.length > 1 ? '' : 's'} their provider`);
  }
  async trustKey(connection: Connection, id: string, key: string): Promise<void> {
    if (connection.writer !== 'app' && connection.writer !== 'cli') throw Error(`a publisher key is trusted only by your answer on the trusted path, the app or the CLI, not by ${connection.writer}`);
    if (!PUBLISHER_KEY.test(key)) throw Error(`${key} isn't a publisher key: ed25519:<64 lower-case hex>`);
    this.keys = { ...this.keys, [id]: key };
    this.save('keys.json', this.keys);
  }
  /** Only you approve or revoke run-as-you: the app, or the CLI outside any agent's session once the OS confirms you. */
  private trustedPath(connection: Connection, what: string): void {
    return trustedPath(connection, what);
  }
  async approve(connection: Connection, id: string, word: 'run_as_you'): Promise<void> {
    this.trustedPath(connection, `${RUN_AS_YOU} is approved`);
    const entry = this.entries[id];
    if (!entry) throw Error(`${id} isn't installed`);
    const manifest = manifestOf(entry.folder);
    if (word !== RUN_AS_YOU || !(manifest.access?.words ?? []).includes(word)) throw Error(`${id}'s manifest doesn't ask for ${String(word)}, so there is nothing to approve`);
    this.runAsYou = { ...this.runAsYou, [id]: true };
    this.save('run-as-you.json', this.runAsYou);
  }
  async revoke(connection: Connection, id: string, word: 'run_as_you'): Promise<void> {
    this.trustedPath(connection, `${RUN_AS_YOU} is revoked`);
    if (word !== RUN_AS_YOU) throw Error(`only ${RUN_AS_YOU} is revoked here, not ${String(word)}`);
    const { [id]: _gone, ...rest } = this.runAsYou;
    this.runAsYou = rest;
    this.save('run-as-you.json', this.runAsYou);
    const owned = this.terminals.of(id);
    // AC2's wrong programs: later commands are refused and what runs runs on; or only each terminal's program stops.
    if (this.options.plant === 'revoke-keeps-running') return;
    if (this.options.plant === 'revoke-stops-programs-only') {
      for (const t of owned) {
        try { process.kill(t.pid, 'SIGKILL'); } catch { /* gone */ }
        this.terminals.forget(t);
      }
      return;
    }
    // A lost one stays listed as lost: what it runs can't be proven from damaged bytes.
    await Promise.all(owned.filter((t) => !t.lost).map((t) => this.terminals.stop(t)));
  }
  /** A hosted terminal of the hub's own, not a piece's, kept past a restart (#70). */
  async openTerminal(connection: Connection, spec: OpenSpec): Promise<{ terminal: string; run: string; pid: number }> {
    if (connection.writer !== 'app') throw Error(`a hosted terminal opens only from the app, not from ${connection.writer}`);
    const t = await this.terminals.open('hub', spec, true);
    return { terminal: t.terminal, run: t.run, pid: t.pid };
  }
  async rawInput(connection: Connection, terminal: string, text: string): Promise<void> {
    if (connection.writer !== 'app' && this.options.plant !== 'input-from-any-writer') {
      throw Error(`raw input for ${terminal} comes only from the panel you focused in the app, not from ${connection.writer}${connection.session ? ` in session ${connection.session}` : ''}`);
    }
    await this.terminals.input(terminal, text);
  }
  async tab(connection: Connection, terminal: string): Promise<TerminalTab> {
    if (connection.writer !== 'app') throw Error(`${terminal}'s tab is the app's, not ${connection.writer}'s`);
    return this.terminals.tab(terminal);
  }
  async resize(connection: Connection, terminal: string, cols: number, rows: number): Promise<void> {
    if (connection.writer !== 'app') throw Error(`${terminal}'s size comes only from the tab you focused in the app, not from ${connection.writer}`);
    await this.terminals.resize(terminal, cols, rows);
  }
  /** Whether a loaded package holds the grant a call needs: run-as-you only once its manifest asks for it and you approved it. */
  private holds(ext: Ext, needs: string): boolean {
    if (needs !== RUN_AS_YOU) return granted(ext.manifest, needs);
    const words = ext.manifest.access?.words ?? [];
    if (this.options.plant === 'narrower-grant-implies-run-as-you' && (words.includes('files') || words.includes('programs'))) return true;
    return words.includes(RUN_AS_YOU) && this.runAsYou[ext.entry.id] === true;
  }
  private installedOf(e: Entry): Installed {
    return { id: e.id, version: e.version, folder: e.folder, digest: e.digest, builtBy: e.builtBy, project: e.project, kits: structuredClone(e.kits ?? []) };
  }
  /**
   * The kits at install: the package's code runs once, where it will run, and each check kind it registers in place
   * of a shipped one (its manifest's `replaces`) is a check.kind@1 fill the kit's fixed part judges, as each
   * environment its manifest declares (#331) is an environment@1 fill; a kit's first FAIL refuses the install,
   * naming the case. A kind of the package's own is BLOCKED: unrun, so never passed. A replacement or an
   * environment the sandbox would run is BLOCKED too (the kits' suites and stacks run where the sandbox can't
   * reach), and a BLOCKED one doesn't install. Each stream source its manifest lists is a source@1 fill (#364), judged
   * wherever the package runs, the kit's restart a restart of its code. A package that declares nothing to kit runs no
   * code at install.
   */
  private async installKits(entry: Entry, manifest: Manifest): Promise<KitRun[]> {
    const { folder, digest } = this.snapshot(entry);
    const hub = this.hubBound(entry, folder, digest);
    const replaces = manifest.replaces ?? [];
    const declared = manifest.checks ?? [];
    const kitted = declared.filter((kind) => replaces.includes(kind));
    const environments = manifest.environments ?? [];
    const what = [kitted.length ? `replaces ${kitted.join(', ')}` : '', environments.length ? `registers the environment${environments.length > 1 ? 's' : ''} ${environments.join(', ')}` : ''].filter(Boolean).join(' and ');
    const kits = `${[kitted.length ? CHECK_KIND : '', environments.length ? ENVIRONMENT : ''].filter(Boolean).join(' and ')}'s kit${kitted.length && environments.length ? 's' : ''}`;
    // An index that replaces the shipped one is held to index@1's kit wherever it will run (#355).
    const indexed = replaces.includes(INDEX);
    const streams = (manifest.sources ?? []).filter((s) => s.variant === 'stream').map((s) => s.name);
    const states = manifest.state_sources ?? [];
    const blocked = (why: string): never => {
      rmSync(folder, { recursive: true, force: true });
      throw Error(`BLOCKED: ${entry.id} ${why}`);
    };
    // No package code runs in the hub before it is ready (#348): a kit that needs to is BLOCKED, so the install is.
    const later = 'and the hub isn\'t ready; install it once it is';
    if (hub && streams.length && !this.isReady) blocked(`registers the stream source ${streams.join(', ')}, whose ${SOURCE} kit runs its code in the hub, ${later}`);
    if (hub && states.length && !this.isReady) blocked(`registers the state source ${states.join(', ')}, whose ${STATE_SOURCE} kit runs its code in the hub, ${later}`);
    if (hub && indexed && !this.isReady) blocked(`replaces ${INDEX}, whose kit runs its code in the hub, ${later}`);
    if (hub && (kitted.length || environments.length) && !this.isReady) blocked(`${what}, whose ${kits} run${kitted.length && environments.length ? '' : 's'} its code in the hub, ${later}`);
    // The kits' suites and stacks run where the sandbox can't reach: unrun, the package doesn't install.
    if (!hub && (kitted.length || environments.length)) blocked(`${what}, and ${kits} can't run on a package the sandbox will run; only a release package written by no agent replaces a shipped kind or ships an environment`);
    if (!kitted.length && !environments.length && !indexed && !streams.length && !states.length) {
      rmSync(folder, { recursive: true, force: true });
      return declared.map((kind) => ({ slot: CHECK_KIND, fill: kind, verdict: 'BLOCKED' as const }));
    }
    const ext = this.ext(entry, folder, manifest, digest, hub ? 'hub' : 'sandbox', 'conformance');
    const runs: KitRun[] = [];
    // One fill held to its slot's kit: the run is kept, and anything but PASS refuses the install, naming the case.
    const judge = async <F extends SlotFill>(slot: string, name: string, what: string, fill: (revision: number) => F): Promise<void> => {
      // The kits load with the first install that runs one: a hub that installs nothing never holds them.
      const { runKit, slotKits } = await import('@deepbuild/conformance');
      const kit = slotKits().find((k) => k.slot === slot) as SlotKit<F> | undefined;
      if (!kit) throw Error(`the conformance package ships no ${slot} kit`);
      const report = await runKit(kit, fill(kit.revision), { parts: ['fixed'] });
      runs.push({ slot, fill: name, verdict: report.verdict });
      const failed = report.cases.find((c) => c.outcome !== 'PASS');
      if (report.verdict !== 'PASS') throw Error(`${entry.id}'s ${what} reads ${report.verdict} on ${slot}'s kit${failed ? ` at ${failed.id}: ${failed.message}` : ''}; it isn't installed`);
    };
    try {
      await this.start(ext);
      for (const kind of [...ext.kinds, ...declared.filter((k) => !ext.kinds.includes(k))]) {
        if (!replaces.includes(kind) || !ext.kinds.includes(kind)) { runs.push({ slot: CHECK_KIND, fill: kind, verdict: 'BLOCKED' }); continue; }
        // A runner that never answers can't hang the install: past a case's deadline and a grace its run is refused,
        // and so is every case after it, at once, so the kit's remaining cases don't each wait their deadline out.
        let stuck: string | null = null;
        const run = async (spec: CheckSpec, ctx: { deadline: number }): Promise<CheckResult> => {
          if (stuck) throw Error(stuck);
          try {
            return await within(ctx.deadline + KIT_GRACE_MS, `${entry.id}'s ${kind} at install`, ext.ask!('run', { type: kind, spec, ctx: this.checkContext(ext, ctx) }) as Promise<CheckResult>);
          } catch (e) {
            if (e instanceof Overran) stuck = message(e);
            throw e;
          }
        };
        await judge<CheckRunnerFill>(CHECK_KIND, kind, kind, (revision) => ({ slot: CHECK_KIND, revision, kind, run }));
      }
      // Each environment the manifest declares: the kit brings it up on a lease and a checkout of the kit's own and
      // takes it down, through the package's up and down. One the package didn't register by the time its load
      // returned is BLOCKED, unrun, and refuses the install: a registration that came later would fill the slot unkitted.
      for (const name of environments) {
        if (!ext.environments.includes(name)) throw Error(`BLOCKED: ${entry.id} declares the environment ${name} and didn't register it at install, so ${ENVIRONMENT}'s kit couldn't run; it isn't installed`);
        // The kit takes a promise from either step and bounds it; a handle is what the package's up answered with.
        const up = (spec: EnvironmentSpec, lease: EnvironmentLease, checkout: string): Promise<unknown> => ext.ask!('env.up', { name, spec, lease, checkout });
        const down = (handle: EnvironmentHandle): Promise<unknown> => ext.ask!('env.down', { name, handle });
        await judge(ENVIRONMENT, name, `environment ${name}`, (revision) => ({ slot: ENVIRONMENT, revision, up, down }) as unknown as EnvironmentFill);
      }
      if (indexed) {
        if (!ext.index) throw Error(`${entry.id} replaces ${INDEX}, but its code registered no index; it isn't installed`);
        await judge(INDEX, ext.index.name, `index ${ext.index.name}`, () => this.indexFill(ext));
      }
      // Each state source its manifest lists (#67): the kit makes and undoes changes on the source's own fixture.
      for (const name of states) {
        if (!ext.stateSources.includes(name)) throw Error(`BLOCKED: ${entry.id} lists the state source ${name} and didn't register it at install, so ${STATE_SOURCE}'s kit couldn't run; it isn't installed`);
        await judge(STATE_SOURCE, name, `state source ${name}`, (revision) => this.stateFill(ext, name, revision));
      }
      for (const name of streams) {
        if (ext.sources.get(name)?.variant !== 'stream') throw Error(`BLOCKED: ${entry.id} lists the stream source ${name} and didn't register it at install, so ${SOURCE}'s kit couldn't run; it isn't installed`);
        // The kit's restart is the hub's: the package's code stops and starts again, keeping nothing it held.
        await judge(SOURCE, name, `source ${name}`, (revision) => ({
          slot: SOURCE, revision, variant: 'stream',
          read: (stream: unknown, cursor: unknown, limit: unknown) => within(CALL_MS, `${entry.id}'s ${name}`, ext.ask!('source.read', { name, stream, cursor, limit })),
          restart: async () => {
            await ext.stop?.();
            if (ext.run) ext.run = `run:${ulid(this.options.now())}`;
            await this.start(ext);
          },
        }));
      }
    } finally {
      await ext.stop?.();
      rmSync(folder, { recursive: true, force: true });
    }
    return runs;
  }
  /** One call into a package's state source, bounded (#67). */
  private stateCall(ext: Ext, name: string, op: string, ...args: unknown[]): Promise<unknown> {
    return within(STATE_MS, `${ext.entry.id}'s state source ${name}`, ext.ask!('state', { name, op, args }));
  }
  /** A registered state source as a state-source@1 fill, its calls going to the package. */
  private stateFill(ext: Ext, name: string, revision: number): StateSourceFill {
    const call = <T>(op: string) => (...args: unknown[]): Promise<T> => this.stateCall(ext, name, op, ...args) as Promise<T>;
    return {
      slot: STATE_SOURCE, revision, name, read: call('read'), compare: call('compare'), undo: call('undo'),
      fixture: { start: call('fixture.start'), make: call('fixture.make'), run: call('fixture.run') },
    };
  }
  async stateSource(name: string): Promise<Omit<StateSource, 'fixture'>> {
    const ext = [...this.exts.values()].find((e) => e.live && e.ask && e.stateSources.includes(name));
    if (!ext) throw Error(`no loaded package registers the state source ${name}`);
    const { read, compare, undo } = this.stateFill(ext, name, 1);
    return { read, compare, undo };
  }

  /** Who is in each project now, by real path. */
  private readonly inside = new Map<string, number>();
  async enterProject(folder: string): Promise<{ trusted: boolean; views: ProjectView[] }> {
    const real = realpathSync(folder);
    if (!(await this.options.trust.trusted(real))) {
      for (const ext of this.packsOf(real)) await this.unload(ext);
      this.inside.delete(real);
      return { trusted: false, views: [] };
    }
    this.inside.set(real, (this.inside.get(real) ?? 0) + 1);
    for (const pack of packsNamed(real)) {
      const from = join(real, pack);
      const { id } = manifestOf(from) as { id: string };
      if (this.exts.get(id)?.live) continue;
      // Installed once for its bytes; a pack changed in the project is a new install, held to its kits again.
      const known = this.entries[id];
      const installed = known?.project === real && known.digest === packageDigest(from) ? this.installedOf(known) : await this.install({ from, builtBy: null, project: real });
      const conformance = await this.check(installed);
      if (!conformance.passed) throw Error(`${id}, a pack of ${real}, failed conformance: ${conformance.reasons.join('; ')}`);
      const load = await this.load(installed);
      if (load.status !== 'loaded') throw Error(`${id}, a pack of ${real}, didn't load: ${load.reason}`);
    }
    return { trusted: true, views: this.viewsOf(real) };
  }
  async leaveProject(folder: string): Promise<void> {
    const real = realpathSync(folder);
    const left = (this.inside.get(real) ?? 0) - 1;
    if (left > 0) { this.inside.set(real, left); return; }
    this.inside.delete(real);
    for (const ext of this.packsOf(real)) await this.unload(ext);
  }
  projectViews(): ProjectView[] {
    return [...this.inside.keys()].flatMap((project) => this.viewsOf(project));
  }
  installedViews(): InstalledView[] {
    return [...this.exts.values()].filter((e) => e.live && e.project === null).flatMap((e) => [...e.panels].map(([name, panel]) => ({
      name, extension: e.entry.id, version: e.entry.version, ...panel, commands: e.commands.get(name) ?? [],
      kit: e.entry.kits?.find((k) => k.slot === PANEL_KIT && k.fill === name)?.verdict ?? null,
    })));
  }
  keepKit(id: string, run: KitRun): void {
    const entry = this.entries[id];
    if (!entry) return;
    entry.kits = [...(entry.kits ?? []).filter((k) => k.slot !== run.slot || k.fill !== run.fill), run];
    this.save('installed.json', this.entries);
  }
  private packsOf(project: string): Ext[] {
    return [...this.exts.values()].filter((e) => e.project === project);
  }
  private viewsOf(project: string): ProjectView[] {
    return this.packsOf(project).filter((e) => e.live).flatMap((e) => [...e.views.keys()].map((name) => ({ name, extension: e.entry.id, commands: e.commands.get(name) ?? [] })));
  }

  /** The channels of the packages loaded and started (#65): each by name, with what it reaches and whether it draws a plan's steps (#1580). */
  channels(): { name: string; kind: ChannelKind; steps: boolean; extension: string }[] {
    return [...this.exts.values()].filter((e) => e.live && e.ask).flatMap((e) => [...e.channels].map(([name, c]) => ({ name, ...c, extension: e.entry.id })));
  }
  /** One send or read of a loaded channel, its context's fetch the caller's; bounded, and never unloading it. */
  async channel(name: string, op: 'deliver', item: ChannelItem, ctx: ChannelCtx): Promise<ChannelDelivered>;
  async channel(name: string, op: 'receive', item: null, ctx: ChannelCtx): Promise<ChannelReceived>;
  async channel(name: string, op: 'deliver' | 'receive', item: ChannelItem | null, ctx: ChannelCtx): Promise<unknown> {
    const ext = [...this.exts.values()].find((e) => e.live && e.ask && e.channels.has(name));
    if (!ext) throw Error(`no loaded package registers the channel ${name}`);
    return this.channelAsk(ext, name, op, item, ctx);
  }
  private async channelAsk(ext: Ext, name: string, op: 'deliver' | 'receive', item: ChannelItem | null, ctx: ChannelCtx): Promise<unknown> {
    const call = `channel:${++this.channelCount}`;
    this.channelCalls.set(call, { ext, ctx });
    try {
      return await within(CHANNEL_MS, `${ext.entry.id}'s channel ${name}`, ext.ask!(`channel.${op}`, { name, call, settings: ctx.settings, ...(item ? { item } : {}) }));
    } finally {
      this.channelCalls.delete(call);
    }
  }
  /** A registered channel as a channel@1 fill the kit judges, its calls going to the package. */
  private channelFill(ext: Ext, name: string, kind: ChannelKind, revision: number): ChannelFill {
    return {
      slot: CHANNEL, revision, kind,
      deliver: (item, ctx) => this.channelAsk(ext, name, 'deliver', item, ctx) as Promise<ChannelDelivered>,
      receive: (ctx) => this.channelAsk(ext, name, 'receive', null, ctx) as Promise<ChannelReceived>,
    };
  }
  async heldSecrets(): Promise<{ secret: string; provider: string }[]> {
    return this.sourceHost.heldSecrets();
  }
  async enterSecret(connection: Connection, extension: string, name: string, value: string): Promise<{ test: KeyTest; saved: boolean }> {
    return this.sourceHost.enterSecret(connection, extension, name, value, this.entries, this.scheduler);
  }
  async readSource(name: string): Promise<SourceRead> {
    return this.sourceHost.readSource(name);
  }
  recording(): Recording {
    return this.sourceHost.recording();
  }
  async readings(source: string, window: { from: number; to: number }): Promise<Reading[]> {
    return this.sourceHost.readings(source, window);
  }
  async removeSecret(connection: Connection, extension: string, name: string, answer?: { yes: string[] }): Promise<{ removed: boolean; blocked: string[] }> {
    return this.sourceHost.removeSecret(connection, extension, name, answer, this.entries, this.scheduler);
  }
  async signIn(connection: Connection, extension: string, name: string): Promise<{ saved: true }> {
    return this.sourceHost.signIn(connection, extension, name, this.entries, this.scheduler, this.options.browse);
  }
  async testPackage(pkg: Installed): Promise<PackageTests> {
    const ext = this.exts.get(pkg.id);
    if (!ext?.live || !ext.ask || ext.entry.version !== pkg.version) throw Error(`${pkg.id}@${pkg.version} isn't loaded and started, so its tests can't run`);
    return this.runTests(ext);
  }
  /** A loaded package's own tests, each file under its tests/ in turn, in its own process. */
  private async runTests(ext: Ext): Promise<PackageTests> {
    const tests = join(ext.folder, 'tests');
    const files = existsSync(tests) ? readdirSync(tests, { recursive: true, encoding: 'utf8' }).filter((f) => /\.test\.(ts|mjs|js)$/.test(f)).sort().map((f) => join('tests', f)) : [];
    const failures: PackageTests['failures'] = [];
    let testsRun = 0;
    ext.testing = true;
    try {
      for (const file of files) {
        const source = ext.place === 'sandbox' && file.endsWith('.ts') ? stripTypeScriptTypes(readFileSync(join(ext.folder, file), 'utf8')) : undefined;
        let ran: { test: string; error: string | null }[];
        try {
          ran = (await this.ask(ext, TEST_MS, `tests in ${file}`, 'test', { file, now: this.options.now(), ...(source === undefined ? {} : { source }) })) as typeof ran;
        } catch (e) {
          failures.push({ test: file, message: message(e) });
          continue;
        }
        for (const r of ran) {
          testsRun++;
          if (r.error !== null) failures.push({ test: `${file} › ${r.test}`, message: r.error });
        }
      }
    } finally {
      ext.testing = false;
    }
    return { passed: testsRun > 0 && !failures.length, testsRun, failures };
  }
  async readStream(name: string, limit: number): Promise<StreamRead> {
    return this.sourceHost.readStream(name, limit);
  }
  async tick(): Promise<void> {
    if (this.closed) return;
    await this.shownTick();
    await this.scheduler.tick();
    await this.work.tick();
    await this.series?.tick();
  }
  /**
   * Each while-shown cadence that is due (#262): one call a period for the source, however many views bind it, while
   * one of them is shown; none once none is, or while the schedule a notice gave its checking job stands in for it.
   */
  private async shownTick(): Promise<void> {
    return this.sourceHost.shownTick();
  }
  /**
   * `deep.readNow(view)` (#262): every source the plug-in's view binds, read at once, each through its quota. One
   * answered in the last 2 s keeps that answer; one the quota refuses reads `quota` until it can run.
   */
  private async readNow(ext: Ext, view: unknown): Promise<{ view: string; sources: { source: string; status: 'kept' | 'read' | 'quota' | 'failed'; until?: number; cause?: string }[] }> {
    return this.sourceHost.readNow(ext, view);
  }
  async idle(): Promise<void> {
    await this.scheduler.idle();
  }
  async schedules(): Promise<ScheduleRow[]> {
    return this.scheduleHost.schedules();
  }
  async runs(schedule: string): Promise<ScheduleRun[]> {
    return this.scheduleHost.runs(schedule);
  }
  async sends(): Promise<SendRow[]> {
    return this.sending.rows();
  }
  async editSchedule(connection: Connection, name: string, cadence: { every: number } | { cron: string }): Promise<void> {
    return this.scheduleHost.editSchedule(connection, name, cadence);
  }
  async runNow(connection: Connection, name: string): Promise<void> {
    return this.scheduleHost.runNow(connection, name);
  }
  async resumeSchedule(connection: Connection, name: string): Promise<void> {
    return this.scheduleHost.resumeSchedule(connection, name);
  }
  async subscribeNotice(connection: Connection, kind: string, key: string, on?: { source: string; words: string; every?: number }): Promise<string> {
    return this.noticeHost.subscribeNotice(connection, kind, key, on);
  }
  async setSendRule(connection: Connection, rule: SendRule): Promise<string> {
    return this.sending.setSendRule(connection, rule, this.entries);
  }
  async viewsShown(connection: Connection, report: ViewShown): Promise<void> {
    return this.sourceHost.viewsShown(connection, report);
  }
  async viewsHidden(connection: Connection, report: { view: string; window: string }): Promise<void> {
    return this.sourceHost.viewsHidden(connection, report);
  }
  async boundValues(handles: string[], at?: { log_pos: number }): Promise<BoundValue[]> {
    return this.sourceHost.boundValues(handles, at);
  }
  async rollup(source: string, span: Span, start: number): Promise<Record<string, Rollup> | null> {
    return this.sourceHost.rollup(source, span, start);
  }
  async listNotices(): Promise<NoticeRow[]> {
    return this.noticeHost.listNotices();
  }
  async judgeCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number }): Promise<{ verdict: Verdict; cause: string | null; result: CheckResult }> {
    const result = await this.runCheck(kind, spec, ctx);
    // What it cites must still be what it was: a file gone or failing its hash makes the run INVALID, naming it.
    const files = new Map<string, string>(result.evidence.map((sha) => [sha, `evidence ${sha}`]));
    for (const handle of result.read ?? []) {
      const b = await this.series?.batch(handle);
      if (b) files.set(b.file, `the batch ${handle}, file ${b.file}`);
    }
    for (const [sha, what] of files) {
      const why = !this.options.evidence || !(await this.options.evidence.get(sha)) ? 'is gone'
        : await this.options.evidence.read(sha).then(() => null, (e: Error) => (e.message.includes('match') ? 'fails its hash: its bytes no longer match' : e.message));
      if (why) return { verdict: 'INVALID', cause: `it cites ${what}, which ${why}`, result };
    }
    const verdict: Verdict = result.outcome === 'passed' ? 'PASS' : result.outcome === 'failed' ? 'FAIL' : result.outcome === 'missing' ? 'BLOCKED' : result.outcome === 'ran_nothing' ? 'INVALID' : 'INCONCLUSIVE';
    return { verdict, cause: verdict === 'PASS' ? null : `its run ended ${result.outcome}`, result };
  }
  async installed(): Promise<Installed[]> {
    return Object.values(this.entries).map((e) => this.installedOf(e));
  }

  checked(pkg: Installed): boolean {
    return `${pkg.id}@${pkg.version}` in this.results;
  }
  async check(pkg: Installed): Promise<Conformance> {
    if (this.closed) throw Error('the host is closed: it runs no conformance');
    const run = this.checkNow(pkg);
    this.checking.add(run);
    try {
      return await run;
    } finally {
      this.checking.delete(run);
    }
  }
  private async checkNow(pkg: Installed): Promise<Conformance> {
    const entry = this.entry(pkg);
    if (entry.project && !(await this.options.trust.trusted(entry.project))) {
      throw Error(`${entry.id} comes with ${entry.project}, a project you haven't trusted, so none of its code runs, its checks included`);
    }
    const { folder, digest } = this.snapshot(entry);
    const reasons: string[] = [];
    let manifest: Manifest | undefined;
    try {
      manifest = manifestOf(folder);
    } catch (e) {
      reasons.push(`its deepbuild.json can't be read: ${message(e)}`);
    }
    if (manifest) {
      const held = checkManifest(manifest);
      if (!held.ok) for (const i of held.issues) reasons.push(`its manifest fails extension.manifest@1 at ${i.path || '/'}: ${i.code} ${i.actual}`);
      else if (manifest.id !== entry.id || manifest.version !== entry.version) reasons.push(`its manifest names ${manifest.id}@${manifest.version}, not ${entry.id}@${entry.version}`);
      else if (manifest.digest !== digest) reasons.push(`its manifest's digest ${manifest.digest} isn't its files' digest ${digest}`);
    }
    if (!existsSync(join(folder, 'index.ts')) && !existsSync(join(folder, 'main'))) reasons.push('it has neither an index.ts nor a main to run');
    if (!reasons.length) reasons.push(...(await this.registers(entry, folder, manifest!, digest)));
    rmSync(folder, { recursive: true, force: true });
    const result: Conformance = { id: entry.id, version: entry.version, digest, passed: !reasons.length, reasons };
    this.results[`${entry.id}@${entry.version}`] = result;
    this.save('checked.json', this.results);
    return result;
  }
  /**
   * An install's job kinds and tools (#1922), read from one run of its code in the platform sandbox. Each tool joins a
   * kind this install or an installed package holds only once it writes each of the kind's qualification fixtures'
   * expected bytes, and only as the build its name@version was first qualified as on this target triple. The first
   * refusal throws, naming the kind, the tool, the fixture or both builds, and nothing is installed.
   */
  private async jobsAt(entry: Entry, manifest: Manifest): Promise<HeldJobs> {
    const { folder, digest } = this.snapshot(entry);
    const ext = this.ext(entry, folder, manifest, digest, 'sandbox', 'conformance');
    try {
      await this.start(ext);
      await Promise.all(this.calls);
    } catch (e) {
      throw Error(`${entry.id}'s code didn't register its job kinds and tools in the platform sandbox: ${message(e)}; it isn't installed`);
    } finally {
      await ext.stop?.();
      rmSync(folder, { recursive: true, force: true });
    }
    return this.jobTools.qualify(entry, manifest, ext);
  }
  /** Conformance's run of the package's code: it registers in the platform sandbox without throwing, and only the check kinds its manifest declares. */
  private async registers(entry: Entry, folder: string, manifest: Manifest, digest: string): Promise<string[]> {
    const ext = this.ext(entry, folder, manifest, digest, 'sandbox', 'conformance');
    try {
      await this.start(ext);
      // The calls it made and didn't wait for are answered too before its run is read.
      await Promise.all(this.calls);
    } catch (e) {
      await ext.stop?.();
      return [`its code didn't register in the platform sandbox: ${message(e)}`];
    }
    // Each channel it registers is held to channel@1's kit (#65), its code running where conformance runs it.
    const kitted: string[] = [];
    try {
      for (const [name, { kind }] of ext.channels) {
        const { runKit, slotKits } = await import('@deepbuild/conformance');
        const kit = slotKits().find((k) => k.slot === CHANNEL) as SlotKit<ChannelFill> | undefined;
        if (!kit) { kitted.push(`the conformance package ships no ${CHANNEL} kit, so its channel ${name} is unkitted`); continue; }
        const report = await runKit(kit, this.channelFill(ext, name, kind, kit.revision), { parts: ['fixed'] });
        const failed = report.cases.find((c) => c.outcome !== 'PASS');
        if (report.verdict !== 'PASS') kitted.push(`its channel ${name} reads ${report.verdict} on ${CHANNEL}'s kit${failed ? ` at ${failed.id}: ${failed.message}` : ''}`);
      }
    } finally {
      await ext.stop?.();
    }
    const declared = manifest.checks ?? [];
    const environments = manifest.environments ?? [];
    return [
      ...ext.refusals,
      ...kitted,
      ...actionRules(ext.actions),
      ...ext.kinds.filter((k) => !declared.includes(k)).map((k) => `it registers the check kind ${k}, which its manifest doesn't declare`),
      ...ext.environments.filter((e) => !environments.includes(e)).map((e) => `it registers the environment ${e}, which its manifest doesn't declare`),
    ];
  }
  private ext(entry: Entry, folder: string, manifest: Manifest, digest: string, place: Ext['place'], mode: Ext['mode']): Ext {
    const released = this.options.release.some((r) => r.id === entry.id && r.version === entry.version && r.digest === digest);
    return {
      entry, project: entry.project && (existsSync(entry.project) ? realpathSync(entry.project) : entry.project), folder, manifest, digest, place, mode, run: place === 'sandbox' ? `run:${ulid(this.options.now())}` : null, kinds: [], environments: [], jobKinds: new Map(), jobTools: [], subscribed: new Set(), routes: new Set(),
      released: released && place === 'hub', live: false, actions: new Map(), provides: new Set(), uses: new Map(), detached: false, reads: new Set(), refuseReads: new Set(), scopes: new Map(), callOf: new Map(), stores: new Map(), edgeReads: new Map(),
      adapters: new Set(), channels: new Map(), stateSources: [], leased: [], refusals: [], hubBound: this.hubBound(entry, folder, digest), sources: new Map(), views: new Map(), commands: new Map(), panels: new Map(), checkReads: new Map(), starts: 0, deadlines: new Map(),
      environmentStarts: new Set(), environmentStops: new Set(),
    };
  }
  /** Whether a load of these bytes runs in the hub: a release package written by no agent, with an index.ts (or the planted twin's rule). */
  private hubBound(entry: Entry, folder: string, digest: string): boolean {
    const released = this.options.release.some((r) => r.id === entry.id && r.version === entry.version && r.digest === digest);
    return entry.builtBy === null && existsSync(join(folder, 'index.ts')) && (released || this.options.plant === 'hub-unless-agent-built');
  }
  /**
   * A copy of its install folder under the host's home, and that copy's digest: the bytes conformance and a load
   * check are the bytes that run, whatever is written to the install folder after.
   */
  private snapshot(entry: Entry): { folder: string; digest: string } {
    const folder = mkdtempSync(join(this.options.home, 'run-'));
    try {
      copyPackage(entry.folder, folder);
      return { folder, digest: packageDigest(folder) };
    } catch (e) {
      rmSync(folder, { recursive: true, force: true });
      throw e;
    }
  }

  async load(pkg: Installed): Promise<Load> {
    return this.serial(pkg.id, () => this.loadNow(pkg));
  }
  /** One load or unload of a package at a time, so two callers can't each start a process of it. */
  private serial<T>(id: string, work: () => Promise<T>): Promise<T> {
    const before = this.loading.get(id) ?? Promise.resolve();
    const now = before.then(work);
    const settled = now.then(() => undefined, () => undefined);
    this.loading.set(id, settled);
    void settled.then(() => { if (this.loading.get(id) === settled) this.loading.delete(id); });
    return now;
  }
  private async loadNow(pkg: Installed): Promise<Load> {
    const refuse = (reason: string): Refused => ({ status: 'refused', id: pkg.id, version: pkg.version, reason });
    if (this.options.safe) return refuse('safe mode: the hub loads no extension');
    if (this.closed) return refuse('the host is closed');
    const entry = this.entries[pkg.id];
    if (!entry) return refuse(`${pkg.id} isn't installed`);
    const untrusted = `${entry.id} comes with ${entry.project}, a project you haven't trusted`;
    const running = this.exts.get(entry.id);
    // Running as installed: that is the load. Installed again since: the copy running stops, and the new one loads.
    if (running?.entry === entry) return (await this.revoked(running)) ? refuse(untrusted) : this.loadedOf(running);
    if (running) await this.unload(running);
    if (entry.project && !(await this.options.trust.trusted(entry.project))) return refuse(untrusted);
    let snap: { folder: string; digest: string };
    try {
      snap = this.snapshot(entry);
    } catch (e) {
      return refuse(message(e));
    }
    const { folder, digest } = snap;
    const result = this.results[`${entry.id}@${entry.version}`];
    const not = !result ? `${entry.id}'s conformance hasn't run: check it first`
      : result.digest !== digest ? `changed since checked: its files' digest is ${digest}, and its checks ran on ${result.digest}`
        : !result.passed ? `${entry.id} failed conformance: ${result.reasons.join('; ')}` : null;
    if (not) {
      rmSync(folder, { recursive: true, force: true });
      return refuse(not);
    }
    const manifest = manifestOf(folder);
    try {
      await this.declareKinds(entry.id, manifest.leases ?? []);
    } catch (e) {
      rmSync(folder, { recursive: true, force: true });
      return refuse(message(e));
    }
    const hub = this.hubBound(entry, folder, digest);
    const ext = this.ext(entry, folder, manifest, digest, hub ? 'hub' : 'sandbox', 'loaded');
    this.exts.set(entry.id, ext);
    // Before the hub is ready, it starts at ready: none of its code runs until then.
    if (this.isReady) {
      try {
        await this.start(ext);
      } catch (e) {
        await this.unload(ext);
        return refuse(`${entry.id} didn't load: ${message(e)}`);
      }
      if (this.closed) {
        await this.unload(ext);
        return refuse('the host closed as it loaded');
      }
    }
    return this.loadedOf(ext);
  }
  /**
   * Declares a manifest's lease kinds in the kernel's table under the package's id (#44). The table has no undeclare,
   * so every kind is held to lease.kind@1 and to the names others declared first, and only then is any declared. The
   * table keeps a kind for the hub's life: one this package declared before is its own still, on the same terms.
   * Packages declare one at a time across the host, so the names read are the names declared against.
   */
  private declareKinds(id: string, kinds: LeaseKind[]): Promise<void> {
    const now = this.declaring.then(() => this.declareNow(id, kinds));
    this.declaring = now.then(() => undefined, () => undefined);
    return now;
  }
  private async declareNow(id: string, kinds: LeaseKind[]): Promise<void> {
    if (!kinds.length || this.options.plant === 'skips-kind-declare') return;
    const table = this.options.leases;
    if (!table) throw Error(`${id} declares the lease kinds ${kinds.map((k) => String(k?.name)).join(', ')}, and this host has no lease table to declare them in`);
    const declared = new Map((await table.kinds()).map((k) => [k.name, k]));
    const fresh = new Map<string, LeaseKind>();
    for (const kind of kinds) {
      const held = validate('lease.kind@1', kind);
      if (!held.ok) throw Error(`${id}'s lease kind ${String(kind?.name)} isn't lease.kind@1 data (match: one of exact, glob, prefix or pool(n)): ${held.issues.map((i) => `${i.path || '/'}: ${i.remediation}`).join('; ')}`);
      if (fresh.has(kind.name)) throw Error(`${id} declares the lease kind ${kind.name} twice`);
      const before = declared.get(kind.name);
      if (!before) fresh.set(kind.name, kind);
      else if (before.plugin !== id) throw Error(`${id}'s lease kind ${kind.name} is already declared by ${before.plugin}`);
      else if (before.match !== kind.match || before.cap !== kind.cap || before.cooldown !== kind.cooldown || before.cost !== kind.cost) {
        throw Error(`${id}'s lease kind ${kind.name} differs from the terms it declared it on; the table keeps those until the hub restarts`);
      }
    }
    for (const kind of fresh.values()) await table.declare(id, kind);
  }
  /** `deep.lease(resource, mode)`: a lease held by the package itself, `ext:<id>`, on this host, whatever its arguments name. */
  private async lease(ext: Ext, resource: unknown, mode: unknown): Promise<LeaseResult> {
    const id = ext.entry.id;
    const table = this.options.leases;
    if (!table) throw Error(`deep.lease: this host has no lease table`);
    const { kind, key, holder } = (resource ?? {}) as { kind?: unknown; key?: unknown; holder?: unknown };
    if (typeof kind !== 'string' || typeof key !== 'string') throw Error('deep.lease takes a resource { kind, key }, each a string');
    if (mode !== 'exclusive' && mode !== 'shared') throw Error(`deep.lease takes the mode exclusive or shared, not ${JSON.stringify(mode)}`);
    const plant = this.options.plant;
    if (plant === 'declares-kind-on-first-lease' && !(await table.kinds()).some((k) => k.name === kind)) {
      await table.declare(id, { name: kind, match: 'exact', cap: 100, cooldown: 0, cost: 0 });
    }
    // A sandboxed one's lease names its run, so the table reads it held while a process of that run still runs.
    // The planted wrong program builds its caller from the call's arguments alone.
    const caller = plant === 'holder-from-arguments' && typeof holder === 'string' ? { holder } : { holder: `ext:${id}`, ...(ext.run ? { run: ext.run } : {}) };
    const result = await table.lease(caller, { host: 'local', kind, key }, plant === 'drops-mode' ? 'exclusive' : mode);
    if (result.status === 'granted') ext.leased.push(result.lease.id);
    if (ext.leasesEnded) await this.releaseLeases(ext).catch(() => undefined);
    return result;
  }
  private loadedOf(ext: Ext): Loaded {
    return { status: 'loaded', id: ext.entry.id, version: ext.entry.version, place: ext.place, run: ext.run };
  }

  /** Runs the package's code: in the hub's process, or in the platform sandbox through the supervisor. */
  private async start(ext: Ext): Promise<void> {
    ext.starts++;
    const index = join(ext.folder, 'index.ts');
    const params = {
      ...(ext.place === 'sandbox' && existsSync(index) ? { source: stripTypeScriptTypes(readFileSync(index, 'utf8')) } : {}),
      ...(this.options.plant === 'piece-writes-input' ? { planted: ['deep.terminal.write'] } : {}),
    };
    if (ext.place === 'hub') {
      // A restart runs its code afresh, as a new process would: nothing it held in memory survives.
      const url = `${pathToFileURL(index).href}?digest=${ext.digest.slice(3)}${ext.starts > 1 ? `&start=${ext.starts}` : ''}`;
      ext.ask = extensionSide((method, params, scope) => this.dispatch(ext, method, params, scope), async (deep) => {
        const code = (await import(url)) as { default: (deep: unknown) => unknown };
        return await code.default(deep);
      }, (file: string) => import(pathToFileURL(join(ext.folder, file)).href)).serve;
    } else {
      await this.sandboxed(ext);
    }
    const returned = await within(LOAD_MS, `${ext.entry.id}'s registering`, ext.ask!('load', params));
    if (ext.mode === 'loaded' && isPlain(returned)) this.loadResults.set(ext.entry.id, structuredClone(returned));
    // Its handlers, actions and outputs publish only now that it started, and only while it's still the one loaded.
    if (ext.mode === 'loaded' && this.exts.get(ext.entry.id) === ext && ext.ask) {
      ext.live = true;
      this.routes.clear();
      // A schedule BLOCKED on a source it registers checks again (#365).
      this.scheduler.supplied();
    }
  }
  private async sandboxed(ext: Ext): Promise<void> {
    const { supervisor } = this.options;
    const folder = ext.folder;
    const run = ext.run!;
    const entry = existsSync(join(folder, 'index.ts')) ? 'index.ts' : 'main';
    // One socket per load, taken by its one connection and gone before the package's code runs.
    const dir = mkdtempSync(join(this.options.home, 'ext-'));
    const path = join(dir, 's');
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
      const connected = new Promise<Socket>((resolve) => server.once('connection', resolve));
      const started = await supervisor.start({
        run, argv: [process.execPath, RUNNER, path, folder, entry], cwd: folder, inherit: false, env: { PATH: '/usr/bin:/bin', HOME: folder, ...(NODE_LIBS.length ? { OPENSSL_CONF: '/dev/null' } : {}) },
        grant: { read: [NODE_HOME, ...NODE_LIBS, RUNTIME, ...(entry === 'main' ? interpreter(folder) : [])], sockets: [path] },
      });
      if (started.status !== 'started') throw Error(`the sandbox held it: BLOCKED on ${started.kind}`);
      // Stoppable from here on: an unload while it connects, at close or a revoke, ends its process.
      ext.stop = async () => { ext.cleaned = await supervisor.cleanup(run).catch(() => undefined); };
      // What it printed is the package's own words, and only a release package's reach a refusal: none loads here as one.
      const early = supervisor.wait(run).then((exit) => Promise.reject(Error(`it exited (${exit.code ?? exit.signal}) before it connected`)));
      early.catch(() => undefined);
      let socket: Socket;
      try {
        socket = await within(LOAD_MS, `${ext.entry.id}'s start`, Promise.race([connected, early]));
      } catch (e) {
        await supervisor.cleanup(run).catch(() => undefined);
        throw e;
      }
      const wire = peer(socket, (method, params, scope) => this.dispatch(ext, method, params, scope));
      // Its connection gone, it is gone: a load still running is unloaded.
      socket.once('close', () => { if (this.exts.get(ext.entry.id) === ext) void this.unload(ext); });
      ext.ask = (method, params) => wire.call(method, params);
      ext.stop = async () => {
        socket.end();
        ext.cleaned = await supervisor.cleanup(run).catch(() => undefined);
      };
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  /** Asks the running package, within `ms`; a package that overruns is unloaded, and a sandboxed one's process stopped. */
  private async ask(ext: Ext, ms: number, what: string, method: string, params: unknown): Promise<unknown> {
    try {
      return await within(ms, `${ext.entry.id}'s ${what}`, ext.ask!(method, params));
    } catch (e) {
      if (e instanceof Overran) await this.unload(ext);
      throw e;
    }
  }
  /**
   * Whether its project's trust was revoked since it loaded: then it is unloaded, its routes and process gone. It
   * asks by the real path resolved at load, which trust answers from memory: a hook reads no record and no file (#881).
   */
  private async revoked(ext: Ext): Promise<boolean> {
    if (!ext.project || (await this.options.trust.trusted(ext.project))) return false;
    await this.unload(ext);
    return true;
  }
  /**
   * Every removal, a disable, a new install, a revoke, close or its connection gone: new calls stop, its users' uses
   * detach and their reads under way finish, then its handlers stop. A version replaced by a new install doesn't wait
   * for its reads (`drain` false): each is refused at its edge (#103).
   */
  private async unload(ext: Ext, drain = true): Promise<void> {
    ext.live = false;
    ext.detached = true;
    this.routes.clear();
    if (this.exts.get(ext.entry.id) === ext) {
      this.exts.delete(ext.entry.id);
      this.scheduler.drop(ext.entry.id);
    }
    ext.resolverDrop?.();
    delete ext.resolverDrop;
    this.routing.drop(ext);
    // Its routes close with the other ways in, before the drain.
    await this.turnOff(ext.entry.id, ext);
    if (drain) await Promise.all([...ext.reads].map((r) => r.catch(() => undefined)));
    else for (const refuse of ext.refuseReads) refuse(Error(`${ext.entry.version} was replaced while the read ran, so its answer isn't delivered`));
    await this.stopHandlers(ext);
    await this.releaseLeases(ext).catch(() => undefined);
    rmSync(ext.folder, { recursive: true, force: true });
  }
  /**
   * Its leases end with it (#44, design: Lease): the ones this load was granted end at its unload, and a sandboxed
   * one's only once the supervisor proved every process of its run gone, each release citing those process.ended
   * events. One whose run left a process running stays held, its key refused to the package's later runs, until the
   * supervisor's later checks prove each of its processes gone and the lease table ends it citing them.
   */
  private async releaseLeases(ext: Ext): Promise<void> {
    ext.leasesEnded = true;
    const table = this.options.leases;
    const ids = ext.leased.splice(0);
    if (!table || !ids.length) return;
    let proof: string[] = [];
    if (ext.run) {
      if (ext.cleaned?.outcome !== 'clean') return;
      const ended = await this.options.record.raw(`SELECT id FROM events WHERE kind = 'process.ended' AND json_extract(data, '$.run') = ? ORDER BY log_pos`, [ext.run]);
      proof = (ended as { id: string }[]).map((e) => e.id);
    }
    for (const id of ids) await table.release(id, proof);
  }
  /** Its handlers stop: nothing more is asked of it, and a sandboxed one's process ends. */
  private async stopHandlers(ext: Ext): Promise<void> {
    await Promise.allSettled([...ext.environmentStarts]);
    const stopped = await Promise.allSettled([...ext.environmentStops].map((down) => down()));
    delete ext.ask;
    await ext.stop?.();
    const failed = stopped.flatMap((r) => r.status === 'rejected' ? [r.reason] : []);
    if (failed.length) throw new AggregateError(failed, `${ext.entry.id}'s environments did not all stop`);
  }

  /**
   * Removing the provider of a required use that no other piece would serve asks you once, naming its users, and
   * detaches nothing until you answer (#103): your yes goes on, anything else rejects. An optional use's provider is
   * removed with no ask; that use then reads missing.
   */
  private async removalHeld(ext: Ext): Promise<void> {
    const id = ext.entry.id;
    const others = [...this.exts.values()].filter((p) => p !== ext && !p.detached);
    const rest = others.map((p) => pieceOf(p.entry.id, p.manifest));
    const users = others.flatMap((u) => (u.manifest.uses ?? []).filter((use) => !optional(u, use) && this.providerOf(u, use, false) === ext && !resolve(u.entry.id, use, rest.filter((p) => p.id !== u.entry.id)))
      .map((use) => ({ user: u.entry.id, uses: use.interface })));
    // AC10's wrong program detaches them with no ask.
    if (!users.length || this.options.plant === 'detaches-silently') return;
    const named = users.map((u) => `${u.user} uses ${u.uses}`).join('; ');
    const yes = await this.yours('extension.remove', `Remove ${id}? ${named.replaceAll(' uses ', ' needs its ')}, and no other piece provides it.`,
      { remove: id, users } as unknown as JsonValue, `Remove ${id}`, 'Keep it',
      users.map((u) => ({ does: `Remove ${id}, leaving ${u.user}'s required use of ${u.uses} with no provider`, changes: [`${u.user} uses ${u.uses}`], undo: `Load ${id} again` })));
    if (!yes) throw Error(`${id} isn't removed: you kept it, so ${named} keep${users.length > 1 ? '' : 's'} their provider`);
  }
  /**
   * One authority ask of yours, raised once, waiting for your answer: true on your yes on record, false on anything
   * else; undefined if the host closed while it still waited. A host with no asks core can't ask, so it refuses.
   */
  private async yours(source: string, question: string, about: JsonValue, allow: string, deny: string, steps: { does: string; changes: string[]; undo: string | null }[]): Promise<boolean | undefined> {
    const asks = this.options.asks;
    if (!asks) throw Error(`${question} needs your yes, and this host has no asks core to ask you`);
    const key = sha256Hex(canonicalize(about));
    const ask = await asks.raise({ writer: 'core', actor: 'you', scope: 'you' }, source, {
      kind: 'authority', question,
      options: [{ id: 'approve', label: allow, decision: 'allow' }, { id: 'decline', label: deny, decision: 'deny' }],
      recommended: null, deadline: this.options.now() + 86_400_000, fallback: 'you', default: 'decline', provisional: false, owner: 'you', key,
      pinned_to: { kind: 'evidence', ref: key },
    }, { steps: steps.map((s) => ({ ...s, public: false, cost: 0 })), diff: key });
    for (;;) {
      const [row] = (await this.options.record.raw('SELECT status, decision FROM asks WHERE id = ?', [ask.slice(4)])) as { status: string; decision: string | null }[];
      if (row?.decision === 'allow') return true;
      if (row?.decision === 'deny' || (row && row.status !== 'open' && row.status !== 'later')) return false;
      if (this.closed) return undefined;
      await sleep(50);
    }
  }
  async disable(id: string): Promise<void> {
    const ext = this.exts.get(id);
    if (ext) await this.removalHeld(ext);
    await this.serial(id, async () => {
      const ext = this.exts.get(id);
      if (!ext) return;
      // AC9's wrong program: its handlers stop while it's still published and its users still read through it. Its
      // process keeps running until the unload: ending it here would unload it at once, through its connection's close.
      if (this.options.plant === 'stop-provider-first') {
        delete ext.ask;
        await sleep(200);
      }
      await this.unload(ext);
    });
  }

  /** A package's call, checked here against its grant before anything else of it. */
  private dispatch(ext: Ext, method: string, params: unknown, scope?: string): Promise<unknown> {
    const call = method.startsWith('test.') ? this.testCall(ext, method, params) : this.dispatchNow(ext, method, params, scope);
    const settled = call.then(() => undefined, () => undefined);
    this.calls.add(settled);
    void settled.then(() => this.calls.delete(settled));
    return call;
  }
  /**
   * The connection a package's call acts on: the package as writer, and, while it serves an action call, that call's
   * caller as actor, scope and session. Never anything from the call's own arguments.
   */
  private connection(ext: Ext, scope: string | undefined): Connection {
    const caller = scope === undefined ? undefined : ext.scopes.get(scope);
    // A call made for an action call that has ended acts for no one: never for you.
    if (scope !== undefined && !caller) throw Error(`${ext.entry.id}'s call was made for an action call that has ended`);
    // Everything the hub proved of the caller travels with it, a session it couldn't check marked so; the writer never.
    const { writer: _writer, run: _run, ...proved } = caller ?? { writer: '', actor: 'you', scope: 'you' };
    return { ...proved, writer: `ext:${ext.entry.id}` };
  }
  /**
   * Records a call capabilities refused: `capability.refused`, written as the connection the call came on, naming
   * the clause or limit it broke and the digest of the call, never its values.
   */
  private async refused(connection: Connection, call: string, broke: 'grant' | 'quota' | 'schema', clause: string, args: unknown): Promise<void> {
    let digest: string;
    try {
      digest = sha256Hex(canonicalize(JSON.parse(JSON.stringify({ call, args }) ?? 'null') as JsonValue));
    } catch {
      digest = sha256Hex(new TextEncoder().encode(call));
    }
    const planted = this.options.plant === 'writer-from-arguments' ? (Array.isArray(args) ? args : [args]).map((a) => (a as { writer?: unknown } | null)?.writer).find((w) => typeof w === 'string') : undefined;
    const now = this.options.now();
    await this.options.record.append({ ...connection, ...(typeof planted === 'string' ? { writer: planted } : {}) }, {
      v: 1, id: ulid(now), kind: 'capability.refused', ts: now, data: { call, broke, clause, digest },
    });
  }
  private async dispatchNow(ext: Ext, method: string, params: unknown, scope?: string): Promise<unknown> {
    const args: unknown[] = Array.isArray(params) ? params : [];
    // AC3's wrong program offers a method that writes a terminal's input.
    const planted = this.options.plant === 'piece-writes-input' && method === 'deep.terminal.write' ? { method, needs: RUN_AS_YOU } : undefined;
    const schema = API.find((m) => m.method === method) ?? planted;
    if (!schema) throw Error(`${method} isn't in the extension API`);
    const id = ext.entry.id;
    // An unloaded copy's call, or one made for an ended action call, does nothing: not even a refusal on record.
    if (ext.mode === 'loaded' && this.exts.get(id) !== ext) throw Error(`${method}: ${id} was unloaded`);
    const connection = this.connection(ext, scope);
    const checked = this.options.plant !== 'grants-only-in-record-query' || method === 'deep.record.query';
    if (schema.needs && checked && !this.holds(ext, schema.needs)) {
      if (ext.mode === 'loaded') await this.refused(connection, method, 'grant', `access: ${schema.needs}`, args).catch(() => undefined);
      throw Error(`${method} needs the grant "${schema.needs}", which ${ext.entry.id} wasn't given`);
    }
    if (ext.mode === 'loaded' && (await this.revoked(ext))) throw Error(`${method}: ${id}'s project ${ext.entry.project} is no longer trusted, so it was stopped`);
    // Unloaded while trust answered, by a new install, a revoke or close: the call does nothing.
    if (ext.mode === 'loaded' && this.exts.get(id) !== ext) throw Error(`${method}: ${id} was unloaded`);
    const conformance = ext.mode === 'conformance';
    const quiet = (): void => { if (conformance) throw Error(`${method}: nothing reaches the record while conformance runs`); };
    // A staged new version may read its stores and its uses to answer its outputs for its users' contract tests (#103).
    const quietRead = (): void => { if (!ext.staged) quiet(); };
    this.previewHeld(ext, method);
    // A shim that dropped a method answers it unsupported, naming it (the contract step's planted twin, #139).
    if (this.options.unsupported?.includes(method)) return { outcome: 'unsupported', operation: method, surface: 'extension-api' };
    switch (method) {
      case 'deep.canvas.read': {
        // A revision's evaluated values by stable ID, read only, under the grant's documents (#411): the core answers
        // every path of a document the grant doesn't cover ref_unresolved.
        const [target, query] = args;
        const at = typeof target === 'string' ? target.lastIndexOf('@') : -1;
        const rev = at > 0 ? Number((target as string).slice(at + 1)) : NaN;
        if (typeof target !== 'string' || !Number.isSafeInteger(rev) || rev < 0) throw Error('deep.canvas.read takes "<doc>@<rev>" first');
        const q = (typeof query === 'object' && query !== null ? query : {}) as Record<string, unknown>;
        if (!this.options.canvas) throw Error('deep.canvas.read: this hub has no canvas core');
        const reply = await this.options.canvas({
          call: 'deep_query', plugin: { id, docs: [...(ext.entry.grant.docs ?? [])] }, doc: target.slice(0, at), rev,
          ...(q.paths !== undefined ? { paths: q.paths } : {}), ...(q.at !== undefined ? { at: q.at } : {}),
        });
        const keys = Object.values((reply.keys ?? {}) as Record<string, unknown>).flatMap((list) => (Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []));
        this.canvasKeys.get(ext)?.push(...keys);
        return reply;
      }
      case 'deep.registerCheck': {
        const [type] = args;
        if (typeof type !== 'string') throw Error('deep.registerCheck takes the check kind first');
        if (!conformance) {
          if (!(ext.manifest.checks ?? []).includes(type)) throw Error(`${type} isn't a check kind ${id}'s manifest declares`);
          if (!ext.entry.holds.includes(type)) throw Error(`${type} was replaced by a package installed after ${id}`);
          const owner = this.kindOwner(type);
          if (owner && owner !== ext && owner.entry.holds.includes(type)) throw Error(`${type} is already registered by ${owner.entry.id}`);
          // The package it replaced, still loaded, hands the kind over (#351).
          if (owner && owner !== ext) owner.kinds = owner.kinds.filter((k) => k !== type);
        }
        if (!ext.kinds.includes(type)) ext.kinds.push(type);
        // The sources it reads (#365), from what its plug-in declares: removing a secret they need lists it.
        const reads = (args[1] as { readings?: unknown } | undefined)?.readings;
        if (reads !== undefined) {
          if (!texts(reads) || (reads as string[]).some((r) => !(ext.manifest.sources ?? []).some((x) => x.name === r))) throw Error(`deep.registerCheck: ${type} declares the readings it reads as sources its manifest lists`);
          ext.checkReads.set(type, [...(reads as string[])]);
        }
        return null;
      }
      case 'deep.registerJob':
      case 'deep.registerJobTool': {
        // Data only (#1922): held to what the manifest declares, and read whole at the install's own run of its code.
        const [kind, descriptor] = args;
        if (typeof kind !== 'string') throw Error(`${method} takes the job kind first`);
        if (method === 'deep.registerJob') {
          if (!(ext.manifest.jobs ?? []).includes(kind)) throw Error(`${kind} isn't a job kind ${id}'s manifest declares`);
          ext.jobKinds.set(kind, descriptor);
        } else {
          const tool = (descriptor as { tool?: unknown } | null)?.tool;
          if (!(ext.manifest.job_tools ?? []).some((t) => t.kind === kind && t.tool === tool)) throw Error(`${String(tool)} isn't a tool of ${kind} that ${id}'s manifest declares`);
          ext.jobTools.push({ kind, tool: descriptor });
        }
        return null;
      }
      case 'deep.registerEnvironment': {
        // One package fills each environment name at a time (design, Composition), under a name its manifest declares.
        const [name] = args;
        if (typeof name !== 'string') throw Error('deep.registerEnvironment takes the environment\'s name first');
        if (!conformance) {
          if (!(ext.manifest.environments ?? []).includes(name)) throw Error(`${name} isn't an environment ${id}'s manifest declares`);
          const owner = this.environmentOwner(name);
          if (owner && owner !== ext) throw Error(`the environment ${name} is already registered by ${owner.entry.id}`);
        }
        if (!ext.environments.includes(name)) ext.environments.push(name);
        return null;
      }
      case 'deep.on': {
        const [kind] = args;
        if (typeof kind !== 'string') throw Error('deep.on takes an event kind first');
        if (!this.reaches(ext, kind)) {
          if (ext.mode === 'loaded') await this.refused(connection, method, 'grant', 'record: the event kinds the grant names', args).catch(() => undefined);
          throw Error(`deep.on: ${kind} isn't in the record ${id}'s grant names`);
        }
        ext.subscribed.add(kind);
        return null;
      }
      case 'deep.registerResolver': {
        // Forwarded to the asks core under the extension's id, which the core's refusals name; the gate is the core's.
        // Every ask raised reaches a resolver, its question, options and plan with it: only a release package in the hub gets them.
        if (!ext.hubBound) throw Error(`deep.registerResolver: a resolver runs only in a release package the hub loads, not in ${id}, which the sandbox runs`);
        if (!conformance && !ext.resolverDrop) {
          const asks = this.options.asks;
          if (!asks) throw Error(`deep.registerResolver: this host has no asks core to consult ${id}'s resolver`);
          // Consulted only once the package started (live), as a hook handler or an action is; before that it answers nothing and the ask goes on.
          ext.resolverDrop = asks.registerResolver(id, (ask) => (ext.live ? this.ask(ext, CALL_MS, 'resolver', 'resolve', { ask }) as Promise<ResolverAnswer | undefined> : undefined));
        }
        return null;
      }
      case 'deep.registerAdapter':
        return this.routing.register(ext, args[0], args[1]);
      case 'deep.registerChannel': {
        const [name, channel] = args as [unknown, { slot?: unknown; revision?: unknown; kind?: unknown; steps?: unknown } | null | undefined];
        if (typeof name !== 'string' || !ADAPTER_NAME.test(name)) throw Error(`deep.registerChannel takes the channel's name first, one lower-case word, not ${JSON.stringify(name)}`);
        if (channel?.slot !== CHANNEL || !Number.isSafeInteger(channel.revision) || (channel.revision as number) < 1) throw Error(`deep.registerChannel: ${name} declares itself a ${CHANNEL} fill, with the kit revision it was built against`);
        if (!CHANNEL_KINDS.includes(channel.kind as ChannelKind)) throw Error(`deep.registerChannel: ${name}'s kind is one of ${CHANNEL_KINDS.join(', ')}`);
        const owner = conformance ? undefined : [...this.exts.values()].find((e) => e !== ext && e.channels.has(name));
        if (owner) throw Error(`the channel ${name} is already registered by ${owner.entry.id}`);
        // Only a channel that says it draws a plan's steps gets a card with a plan to answer (#1580).
        ext.channels.set(name, { kind: channel.kind as ChannelKind, steps: channel.steps === true });
        return null;
      }
      case 'deep.registerStateSource': {
        const [name] = args;
        if (typeof name !== 'string' || !ADAPTER_NAME.test(name)) throw Error(`deep.registerStateSource takes the source's name first, one lower-case word, not ${JSON.stringify(name)}`);
        if (!(ext.manifest.state_sources ?? []).includes(name)) throw Error(`deep.registerStateSource: ${name} isn't a state source ${id}'s manifest declares, so no kit held it`);
        const owner = conformance ? undefined : [...this.exts.values()].find((e) => e !== ext && e.stateSources.includes(name));
        if (owner) throw Error(`the state source ${name} is already registered by ${owner.entry.id}`);
        if (!ext.stateSources.includes(name)) ext.stateSources.push(name);
        return null;
      }
      case 'deep.work.fetch':
        return this.sourceHost.workFetch(ext, args[0], args[1]);
      case 'deep.channel.fetch': {
        // Only a send or read of its own under way: the hub's call, with the channel's settings and token.
        const [call, request] = args;
        const live = typeof call === 'string' ? this.channelCalls.get(call) : undefined;
        if (!live || live.ext !== ext) throw Error(`deep.channel.fetch: ${id} has no channel send or read under way as ${String(call)}`);
        return live.ctx.fetch(request as Parameters<ChannelCtx['fetch']>[0]);
      }
      case 'deep.registerIndex': {
        const [name, fill] = args as [unknown, { slot?: unknown; revision?: unknown } | null | undefined];
        if (typeof name !== 'string' || !INDEX_NAME.test(name)) throw Error(`deep.registerIndex takes the index's name first, not ${JSON.stringify(name)}`);
        if (fill?.slot !== INDEX || !Number.isSafeInteger(fill.revision) || (fill.revision as number) < 1) throw Error(`deep.registerIndex: ${name} declares itself an ${INDEX} fill, with the kit revision it was built against`);
        // One index fills the slot: a package's, only by replacing the shipped one, and only one package's at a time.
        if (!(ext.manifest.replaces ?? []).includes(INDEX)) throw Error(`deep.registerIndex: ${id}'s manifest doesn't replace ${INDEX}, the one index deep_search reads`);
        if (ext.index && ext.index.name !== name) throw Error(`deep.registerIndex: ${id} already registered the index ${ext.index.name}`);
        const owner = conformance ? undefined : [...this.exts.values()].find((e) => e.index && e !== ext);
        if (owner) throw Error(`${INDEX} is already filled by ${owner.entry.id}`);
        ext.index = { name, revision: fill.revision as number };
        return null;
      }
      case 'deep.secret': {
        const [name] = args;
        if (!(ext.manifest.secrets ?? []).some((s) => s.name === name)) throw Error(`deep.secret: ${String(name)} isn't a secret ${id}'s manifest names`);
        return handleOf(name as string);
      }
      case 'deep.registerSource': {
        const [name, declared] = args;
        const own = { sources: ext.manifest.sources ?? [], secrets: ext.manifest.secrets ?? [], hosts: (ext.entry.grant.hosts ?? []).map((h) => h.host) };
        const source = declareSource(name, declared, own);
        const owner = conformance ? undefined : [...this.exts.values()].find((e) => e !== ext && e.sources.has(source.name));
        if (owner) throw Error(`deep.registerSource: ${source.name} is already registered by ${owner.entry.id}`);
        ext.sources.set(source.name, source);
        // A work source (#66): each one you switched on over it gets its schedule again.
        if (!conformance && source.variant === 'stream' && source.work) await this.work.registered(source.name, ext.entry.id);
        return null;
      }
      case 'deep.registerRoute': {
        const [route] = args;
        if (typeof route !== 'string' || !ROUTE.test(route)) throw Error(`deep.registerRoute takes "<METHOD> <path>", not ${JSON.stringify(route)}`);
        // Registering opens nothing: a route is served only once you turn the package on and choose it.
        ext.routes.add(route);
        return null;
      }
      case 'deep.record.append': {
        quiet();
        // Its store's items go through deep.store.put, held to the store's schema and generation.
        const kind = (args[0] as { kind?: unknown } | undefined)?.kind;
        if ((ext.manifest.stores ?? []).includes(kind as string)) throw Error(`deep.record.append: ${String(kind)} is a store kind; put its items with deep.store.put`);
        const writing = this.options.plant === 'first-party-appends-every-kind' && ext.place === 'hub' ? { ...connection, writer: 'core' } : connection;
        await this.options.record.append(writing, args[0] as EventInput);
        return null;
      }
      case 'deep.registerAction': {
        const [name, declared] = args as [unknown, { declares?: unknown; input?: unknown; output?: unknown; changes?: unknown; reads?: unknown } | undefined];
        if (typeof name !== 'string' || !(ext.manifest.actions ?? []).includes(name)) throw Error(`deep.registerAction: ${String(name)} isn't an action ${id}'s manifest declares`);
        const declares = declared?.declares;
        if (declares !== 'read' && declares !== 'change' && declares !== 'send') throw Error(`deep.registerAction: ${name} declares read, change or send`);
        const { input, output } = declared!;
        if (!isPlain(input)) throw Error(`deep.registerAction: ${name} gives its input's JSON Schema`);
        if (output !== undefined && !isPlain(output)) throw Error(`deep.registerAction: ${name}'s output is a JSON Schema`);
        for (const [side, schema] of [['input', input], ['output', output]] as const) {
          const skipped = schema === undefined ? undefined : unchecked(schema);
          if (skipped) throw Error(`deep.registerAction: ${name}'s ${side} schema has a rule the host can't check: ${skipped}`);
        }
        // The store kinds a change changes, and those a read lets an agent read: each one of its own manifest's stores.
        const kinds = (field: 'changes' | 'reads'): string[] => {
          const listed = declared![field] ?? [];
          if (!texts(listed) || (listed as string[]).some((k) => !(ext.manifest.stores ?? []).includes(k))) throw Error(`deep.registerAction: ${name}'s ${field} lists store kinds ${id}'s manifest declares`);
          return [...(listed as string[])];
        };
        const changes = kinds('changes');
        const reads = kinds('reads');
        const leftOut = rejected(input);
        let check: Action['check'];
        try {
          const schemas = registry([{ name, schema: input as Schema }]);
          check = (value) => {
            const held = schemas.validate(name, value);
            return held.ok ? held : { ok: false, path: declaredPath(input, held.issues[0]!.path), code: held.issues[0]!.code };
          };
          // A schema that can't be read refuses the registration, not the first call.
          schemas.validate(name, {});
        } catch (e) {
          // One left out for agents stays listed with its reason, such as a union of plain values; every call to it is refused.
          if (!leftOut) throw e;
          check = () => ({ ok: false, path: '', code: 'unchecked' });
        }
        ext.actions.set(name, { check, declares, input, output, changes, reads, leftOut });
        return null;
      }
      // A piece's store (#363): its items are events of a kind its manifest declares, written by the piece alone.
      case 'deep.store': {
        const [kind, declared] = args as [unknown, { generation?: unknown; schema?: unknown; migrates?: unknown; quota?: unknown } | undefined];
        if (typeof kind !== 'string' || !(ext.manifest.stores ?? []).includes(kind)) throw Error(`deep.store: ${String(kind)} isn't a store kind ${id}'s manifest declares`);
        const generation = declared?.generation;
        if (!Number.isSafeInteger(generation) || (generation as number) < 1) throw Error(`deep.store: ${kind} gives the generation of its schema, a whole number from 1`);
        const migrates = declared!.migrates ?? [];
        // Only a migration from a lower generation ever runs: one from this generation or a later one is never asked for.
        if (!Array.isArray(migrates) || !migrates.every((g) => Number.isSafeInteger(g) && g >= 1)) throw Error(`deep.store: ${kind}'s migrates lists the generations it migrates from`);
        const schema = declared!.schema;
        if (!isPlain(schema)) throw Error(`deep.store: ${kind} gives its items' JSON Schema`);
        const skipped = unchecked(schema);
        if (skipped) throw Error(`deep.store: ${kind}'s schema has a rule the host can't check: ${skipped}`);
        const items = registry([{ name: kind, schema: schema as Schema }]);
        items.validate(kind, {});
        // Its quota in bytes (#365): what its items hold, each as JSON, never grows past it.
        const quota = (declared!.quota as { bytes?: unknown } | undefined)?.bytes;
        if (declared!.quota !== undefined && (!Number.isSafeInteger(quota) || (quota as number) < 1)) throw Error(`deep.store: ${kind}'s quota is a number of bytes, a whole number from 1`);
        const store: Store = { generation: generation as number, quota: (quota as number | undefined) ?? null, check: (value) => { const held = items.validate(kind, value); return held.ok ? undefined : `${held.issues[0]!.path || '/'}: ${held.issues[0]!.code}`; } };
        if (!conformance) await this.migrate(ext, kind, store, migrates as number[]);
        ext.stores.set(kind, store);
        return null;
      }
      case 'deep.store.put': {
        quiet();
        const [kind, key, value] = args;
        const store = this.storeOf(ext, kind, method);
        if (typeof key !== 'string' || !key) throw Error(`${method}: ${String(kind)}'s items each have a key, a non-empty string`);
        const broke = store.check(value);
        if (broke) throw Error(`${method}: the item for ${key} fails ${String(kind)}'s schema at ${broke}`);
        const run = this.scheduleHost.context(scope);
        if (run && !run.decl.declares.stores.includes(kind as string)) throw Error(`${method}: ${run.decl.name} doesn't declare ${String(kind)} among the stores it writes`);
        const held = await this.store(kind as string);
        const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null');
        const was = held.items.get(key)?.bytes ?? 0;
        const total = held.bytes - was + bytes;
        if (store.quota !== null && total > store.quota) throw Error(`${method}: ${String(kind)} would hold ${total} bytes with the item for ${key}, past its quota of ${store.quota}`);
        // Its growth counts from the check on: two puts under way can't both fit a quota that one fills.
        const reserved = Math.max(0, bytes - was);
        held.bytes += reserved;
        const now = this.options.now();
        const call = scope === undefined ? null : ext.callOf.get(scope) ?? null;
        try {
          await this.options.record.append(connection, { v: 1, id: ulid(now), kind: kind as string, ts: now, data: { key, generation: store.generation, value: value as JsonValue, call } });
        } catch (e) {
          held.bytes -= reserved;
          throw e;
        }
        // Against what the key holds now: another put of it may have landed while this one was appended.
        held.bytes += bytes - (held.items.get(key)?.bytes ?? 0) - reserved;
        held.items.set(key, { value: structuredClone(value), generation: store.generation, bytes });
        run?.changes.push(`${String(kind)}:${key}`);
        return null;
      }
      case 'deep.store.get': {
        quietRead();
        const [kind, key] = args;
        this.storeOf(ext, kind, method);
        return structuredClone((await this.items(kind as string)).get(String(key))?.value ?? null);
      }
      case 'deep.store.list': {
        quietRead();
        const [kind] = args;
        this.storeOf(ext, kind, method);
        return [...(await this.items(kind as string))].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => ({ key, value: structuredClone(item.value) }));
      }
      case 'deep.provide': {
        const [name, kind] = args;
        if (!(ext.manifest.provides ?? []).some((p) => p.interface === name && p.kind === kind)) throw Error(`deep.provide: ${String(name)} isn't a ${String(kind)} ${id}'s manifest provides`);
        ext.provides.add(name as string);
        return null;
      }
      case 'deep.use': {
        const [name, options] = args as [unknown, { optional?: unknown } | undefined];
        if (!(ext.manifest.uses ?? []).some((u) => u.interface === name)) throw Error(`deep.use: ${String(name)} isn't an interface ${id}'s manifest uses`);
        ext.uses.set(name as string, options?.optional === true);
        return null;
      }
      case 'deep.read':
        quietRead();
        return this.readUse(ext, args[0]);
      case 'deep.call':
        quiet();
        return this.callThrough(ext, args[0], args[1], scope);
      case 'deep.fetch':
        quiet();
        return this.fetch(ext, args[0], connection);
      case 'deep.record.query':
        quiet();
        return this.query(ext, args[0], connection);
      case 'deep.lease':
        quiet();
        return this.lease(ext, args[0], args[1]);
      case 'deep.config.get': {
        // The package's own settings (#139 wires it): ~/.deepbuild/config.json's extensions.<id>.<key>; a key nobody set reads null.
        const [key] = args;
        if (typeof key !== 'string' || !key) throw Error('deep.config.get takes a setting\'s key');
        const file = join(this.options.home, 'config.json');
        const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { extensions?: Record<string, Record<string, unknown>> } : {};
        const value = all.extensions?.[id]?.[key];
        return value === undefined ? null : structuredClone(value);
      }
      // Hosted terminals (#104): what runs is the piece's own, under run-as-you, and never at its conformance run.
      case 'deep.terminal.open': {
        if (conformance) throw Error(`${method}: nothing runs while conformance runs`);
        const t = await this.terminals.open(id, args[0] as OpenSpec, ext.manifest.host?.lives === 'past_app');
        return { terminal: t.terminal, run: t.run, pid: t.pid };
      }
      case 'deep.terminal.list':
        return this.terminals.of(id).map((t) => ({ terminal: t.terminal, run: t.run, pid: t.pid, title: t.title, ...(t.lost ? { lost: true } : {}) }));
      case 'deep.terminal.read':
        return this.terminals.read(id, args[0] as string, args[1] as number);
      case 'deep.terminal.close': {
        const t = this.terminals.of(id).find((x) => x.terminal === args[0]);
        if (!t) throw Error(`${id} has no terminal ${String(args[0])}`);
        return void (await this.terminals.stop(t));
      }
      case 'deep.terminal.write':
        return void (await this.terminals.input(args[0] as string, args[1] as string));
      case 'deep.notices.send': {
        quiet();
        // #348's wrong program checks nothing here, as it checks no grant but deep.record.query's.
        const planted = this.options.plant === 'grants-only-in-record-query';
        const given = (isPlain(args[0]) ? args[0] : {}) as { readings?: unknown; key?: unknown };
        const subject = planted ? undefined : await this.noticeAllowed(ext, args[0], scope);
        if (subject?.sent) return subject.sent;
        const notice = `notice:${ulid(this.options.now())}`;
        const now = this.options.now();
        await this.options.record.append(connection, {
          v: 1, id: ulid(now), kind: 'notice.sent', ...(subject ? { subject: subject.subject } : {}), ts: now, data: { notice, cites: Array.isArray(given.readings) ? given.readings : [] },
        });
        // Sent for an action call, it is part of what that call changed (#363); in a run, of what the run changed (#365).
        const call = scope === undefined ? undefined : ext.callOf.get(scope);
        if (call !== undefined) this.notices.get(call)?.push(notice);
        if (scope !== undefined) this.scheduleHost.context(scope)?.changes.push(notice);
        return notice;
      }
      // Schedules and sends (#365).
      case 'deep.schedule':
        return this.scheduleHost.register(ext, args[0], args[1], this.files);
      case 'deep.schedule.read':
        quiet();
        return this.scheduleHost.read(scope, args[0], this.sourceHost);
      case 'deep.send': {
        quiet();
        return this.sending.dispatch(ext, args[0], scope, this.scheduleHost.context(scope));
      }
      // A view, its pages and its ⌘K commands (#366): its panel reads only what its sources read.
      case 'deep.registerView': {
        const refusal = this.viewRefusal(ext, args);
        if (refusal === null) {
          ext.views.set(args[0] as string, ((args[3] as { binds?: string[] } | undefined)?.binds ?? []).slice());
          ext.commands.set(args[0] as string, ((args[3] as { commands?: { name: string; action: string }[] } | undefined)?.commands ?? []).map((c) => ({ name: c.name, action: c.action })));
          ext.panels.set(args[0] as string, { folder: join(ext.folder, args[1] as string), area: args[2] as string, pages: (args[3] as { pages?: InstalledView['pages'] } | undefined)?.pages ?? [] });
          return null;
        }
        if (conformance) ext.refusals.push(refusal);
        throw Error(`deep.registerView: ${refusal}`);
      }
      case 'deep.runner.run':
        quiet();
        return this.runJob(ext, args[0], scope);
      case 'deep.readNow':
        quiet();
        return this.readNow(ext, args[0]);
      default:
        throw Error(`${method} isn't wired into this host yet`);
    }
  }
  /**
   * Why a view can't register, or null (#366): its panel is a folder of the package with a main.js, whose scripts
   * never call the network themselves, and each ⌘K command runs an action its manifest declares.
   */
  private viewRefusal(ext: Ext, args: unknown[]): string | null {
    const [name, panel, area, view] = args;
    if (typeof name !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(name)) return `${String(name)} isn't a view name`;
    if (typeof area !== 'string' || !['sidebar', 'home', 'tab', 'line'].includes(area)) return `${name}'s area is the sidebar, home, tab or line, not ${String(area)}`;
    const dir = typeof panel === 'string' ? join(ext.folder, panel) : '';
    if (!dir.startsWith(`${ext.folder}/`) || !existsSync(join(dir, 'main.js'))) return `${name}'s panel ${String(panel)} is no folder of ${ext.entry.id} with a main.js`;
    for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(m?js|ts)$/.test(f)).sort()) {
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      const at = lines.findIndex((line) => NETWORK.test(line));
      if (at >= 0) return `${name}'s panel calls the network itself, at ${panel}/${file}:${at + 1}: ${lines[at]!.trim().slice(0, 200)}; a panel shows what its sources read, which the hub fetches`;
    }
    const v = (isPlain(view) ? view : {}) as { pages?: unknown; commands?: unknown; binds?: unknown };
    // What it binds, each a reading of a source its manifest declares (#262).
    if (v.binds !== undefined && !Array.isArray(v.binds)) return `${name}'s binds is a list of reading handles`;
    const own = (ext.manifest.sources ?? []).map((x) => x.name);
    for (const b of (v.binds as unknown[] | undefined) ?? []) {
      const m = typeof b === 'string' ? BOUND.exec(b) : null;
      if (!m || !own.includes(m[1]!)) return `${name} binds ${JSON.stringify(b)}, which isn't reading:<source> or reading:<source>#<series> of a source ${ext.entry.id}'s manifest declares`;
    }
    const pages = Array.isArray(v.pages) ? v.pages : [];
    const commands = Array.isArray(v.commands) ? v.commands : [];
    for (const page of pages) {
      if (!isPlain(page) || typeof page.name !== 'string' || !page.name || typeof page.param !== 'string' || !/^[a-z][a-z0-9_]*$/.test(page.param)) return `${name}'s page ${JSON.stringify(page)} isn't { name, param, values }`;
    }
    for (const command of commands) {
      if (!isPlain(command) || typeof command.name !== 'string' || !command.name) return `${name}'s command ${JSON.stringify(command)} isn't { name, action }`;
      if (!(ext.manifest.actions ?? []).includes(command.action as string)) return `${name}'s command ${command.name} runs ${String(command.action)}, which isn't an action ${ext.entry.id}'s manifest declares`;
    }
    return null;
  }
  /**
   * A model job for a plug-in, through the runner (#366). Every handle it names is checked against its grant before
   * any job is recorded; the agent gets each one's content, filtered as the plug-in would read it; the answer cites
   * only handles the grant reaches, is recorded as a reading and is as old as the oldest reading it cites.
   */
  private async runJob(ext: Ext, given: unknown, scope: string | undefined): Promise<Answer> {
    return this.modelJobs.runJob(ext, given, scope);
  }
  /** What a package's own test asks of the host while its tests run (#366): one of its actions, called as the app would, or one of its sources read. */
  private async testCall(ext: Ext, method: string, params: unknown): Promise<unknown> {
    const id = ext.entry.id;
    if (!ext.testing) throw Error(`${method} answers only while ${id}'s own tests run`);
    const [name, input] = Array.isArray(params) ? params : [];
    if (method === 'test.read') {
      // An interface it uses reads through its edge, or, in a contract test, the provider's new outputs at its minor (#103).
      if (typeof name === 'string' && ext.uses.has(name)) {
        if (!ext.replay) return this.readUse(ext, name);
        const use = (ext.manifest.uses ?? []).find((u) => u.interface === name);
        if (!ext.replay.has(name)) return { missing: true };
        return { value: use?.schema === undefined || this.options.plant === 'serves-newest-minor' ? ext.replay.get(name) : servedAt(ext.replay.get(name), use.schema) };
      }
      if (typeof name !== 'string' || !ext.sources.has(name)) throw Error(`t.read: ${String(name)} isn't a source ${id} registers or an interface it uses`);
      return this.readSource(name);
    }
    if (method !== 'test.call') throw Error(`${method} isn't in a package test's t`);
    const result = await this.callAction({ action: name as string, target: { handle: `ext:${id}`, version: ext.entry.version }, input, caller: TESTER });
    if (result.status !== 'done') throw Error(`t.call: ${String(name)} was refused: ${result.reason}`);
    return result.output;
  }
  /**
   * A preview method is used only by name (#139): a package lists each one it calls in its manifest's requires.preview,
   * or the call is refused with preview_unrequested; and a package that declares itself stable calls none. Conformance
   * runs the package's code at install, so a call it makes there refuses the install, naming the method.
   */
  private previewHeld(ext: Ext, method: string): void {
    if (this.published.get(method)?.stability !== 'preview') return;
    const m = ext.manifest;
    let refusal: string | undefined;
    if (m.stability === 'stable') {
      if (this.options.plant !== 'stable-may-call-preview') refusal = `${m.id} declares itself stable and calls ${method}, a preview method; a stable package calls stable methods only`;
      // A work source's context fetch is part of the deep.registerSource that registered it (#66).
    } else if (!(m.requires?.preview ?? []).includes(method === 'deep.work.fetch' ? 'deep.registerSource' : method)) refusal = `preview_unrequested: ${m.id} calls ${method}, a preview method its manifest doesn't list in requires.preview`;
    if (!refusal) return;
    // Kept on the run, so a package that never awaits the call is refused all the same.
    ext.refusals.push(refusal);
    throw Error(refusal);
  }
  private storeOf(ext: Ext, kind: unknown, method: string): Store {
    const store = ext.stores.get(kind as string);
    if (!store) throw Error(`${method}: ${String(kind)} isn't a store ${ext.entry.id} declared with deep.store`);
    return store;
  }
  /**
   * A store's items as the record holds them now: the newest item for each key, read from the record once and then
   * kept as this host puts them, since only this host writes a store's kind (#365: a lookup reads no log).
   */
  private async items(kind: string): Promise<Map<string, { value: unknown; generation: number; bytes: number }>> {
    return (await this.store(kind)).items;
  }
  private async store(kind: string): Promise<{ items: Map<string, { value: unknown; generation: number; bytes: number }>; bytes: number }> {
    const kept = this.storeItems.get(kind);
    if (kept) return kept;
    const items = new Map<string, { value: unknown; generation: number; bytes: number }>();
    for (let after = 0; ;) {
      const page = await this.options.record.read({ after, limit: PAGE, kinds: [kind] });
      for (const e of page) {
        const { key, value, generation } = e.data as { key: string; value: unknown; generation: number };
        items.set(key, { value, generation, bytes: Buffer.byteLength(JSON.stringify(value) ?? 'null') });
      }
      if (page.length < PAGE) break;
      after = page[page.length - 1]!.log_pos;
    }
    // Read while another call read it too: the first map read stays the one kept.
    if (!this.storeItems.has(kind)) this.storeItems.set(kind, { items, bytes: [...items.values()].reduce((sum, i) => sum + i.bytes, 0) });
    return this.storeItems.get(kind)!;
  }
  /**
   * A store's items moved forward to the generation a load declares (#363): each item at a generation it migrates
   * from, through the piece's own migration, held to the new schema and written again. An item at a later generation,
   * once the code is rolled back, is kept as it is: nothing moves back.
   */
  private async migrate(ext: Ext, kind: string, store: Store, migrates: number[]): Promise<void> {
    const id = ext.entry.id;
    for (const [key, item] of await this.items(kind)) {
      if (item.generation >= store.generation) continue;
      if (!migrates.includes(item.generation)) throw Error(`deep.store: ${kind} holds items at generation ${item.generation}, and ${id} declares no migration from it`);
      const value = await within(CALL_MS, `${id}'s migration of ${kind}`, ext.ask!('migrate', { kind, from: item.generation, value: item.value }));
      const broke = store.check(value);
      if (broke) throw Error(`deep.store: ${id}'s migration of ${kind}'s item ${key} from generation ${item.generation} fails generation ${store.generation}'s schema at ${broke}`);
      const now = this.options.now();
      await this.options.record.append(this.connection(ext, undefined), { v: 1, id: ulid(now), kind, ts: now, data: { key, generation: store.generation, value: value as JsonValue, call: null } });
      const held = await this.store(kind);
      const bytes = Buffer.byteLength(JSON.stringify(value) ?? 'null');
      held.bytes += bytes - item.bytes;
      held.items.set(key, { value: structuredClone(value), generation: store.generation, bytes });
    }
  }
  /** Whether a kind is another plug-in's: an `ext.<plugin>.` kind of a plug-in other than this one. */
  private foreign(ext: Ext, kind: string): boolean {
    return kind.startsWith('ext.') && !kind.startsWith(`ext.${ext.entry.id.slice(ext.entry.id.indexOf('/') + 1)}.`);
  }
  /**
   * Whether its record grant reaches a kind (#363): one the grant names, or with `*` any, of the core's kinds and its
   * own. Another plug-in's store and event kinds never: they come only through a declared use.
   */
  private reaches(ext: Ext, kind: string): boolean {
    // A release package in the hub keeps full access.
    if (ext.released) return true;
    const grant = ext.entry.grant.record;
    const named = grant.includes('*') || grant.includes(kind);
    return this.options.plant === 'record-by-grant-words' ? named : named && !this.foreign(ext, kind);
  }
  /** The installed piece whose manifest declares a plug-in kind, as a store or an event kind. */
  private ownerOf(kind: string): string | undefined {
    return Object.values(this.entries).find((e) => {
      const m = JSON.parse(readFileSync(join(e.folder, 'deepbuild.json'), 'utf8')) as Manifest;
      return [...(m.stores ?? []), ...(m.events ?? [])].includes(kind);
    })?.id;
  }
  /**
   * The record its grant names, filtered here before anything crosses to the package: the kinds it reaches, and
   * their content-free fields unless the grant names text. A query that names another plug-in's kind is refused,
   * naming the kind and the use to declare instead.
   */
  private async query(ext: Ext, filter: unknown, connection: Connection): Promise<unknown[]> {
    const asked = (filter as { kinds?: unknown } | undefined)?.kinds;
    const other = Array.isArray(asked) && !ext.released && this.options.plant !== 'record-by-grant-words' ? asked.find((k): k is string => typeof k === 'string' && this.foreign(ext, k)) : undefined;
    if (other !== undefined) {
      const owner = this.ownerOf(other);
      const outputs = owner ? (this.manifestAt(this.entries[owner]!.folder).provides ?? []).map((p) => p.interface) : [];
      await this.refused(connection, 'deep.record.query', 'grant', 'record: another plug-in\'s kind, which no grant reaches', [filter]).catch(() => undefined);
      throw Error(`deep.record.query: ${other} is ${owner ?? 'another plug-in'}'s kind, which no record grant reaches; declare a use of what ${owner ?? 'it'} provides${outputs.length ? ` (${outputs.join(', ')})` : ''} in your manifest's uses, and read it with deep.read`);
    }
    const grant = ext.entry.grant.record;
    const kinds = Array.isArray(asked) ? asked.filter((k): k is string => typeof k === 'string' && this.reaches(ext, k))
      : ext.released || grant.includes('*') ? undefined : grant.filter((k) => this.reaches(ext, k));
    const found: unknown[] = [];
    if (kinds && !kinds.length) return found;
    for (let after = 0; ;) {
      // Only the kinds it reaches are read: the rest of the log is never decoded.
      const page = await this.options.record.read({ after, limit: PAGE, ...(kinds ? { kinds } : {}) });
      for (const e of page) {
        const seen = this.visible(ext, e);
        if (seen !== undefined) found.push(seen);
      }
      if (page.length < PAGE) return found;
      after = page[page.length - 1]!.log_pos;
    }
  }
  /**
   * An event as the package's record grant lets it see it, or undefined (#363): of a kind it reaches, from a repo or
   * workspace the grant names, with only its content-free fields unless the grant names text. A release package in
   * the hub sees every event whole.
   */
  private visible(ext: Ext, e: Event): unknown {
    const { projects, text } = ext.entry.grant;
    if (!this.reaches(ext, e.kind) || (!ext.released && projects && !projects.includes(e.project ?? ''))) return undefined;
    return JSON.parse(toJson(text || ext.released ? e : contentFree(e)));
  }
  private kindOwner(kind: string): Ext | undefined {
    for (const ext of this.exts.values()) if (ext.kinds.includes(kind)) return ext;
    return undefined;
  }
  private environmentOwner(name: string): Ext | undefined {
    for (const ext of this.exts.values()) if (ext.environments.includes(name)) return ext;
    return undefined;
  }

  /**
   * The loaded piece a use reads from (#103), by type: a live provider of the interface it is wired to whose row
   * matches the use, the one it prefers when several do. Kept until a piece loads, stops or installs.
   */
  private providerOf(ext: Ext, use: UseRow, live = true): Ext | undefined {
    const id = ext.entry.id;
    // The use reads the interface it is wired to (#139): the one its manifest names, unless the planted installer rewired it.
    const to = this.wired.get(id)?.get(use.interface) ?? use.interface;
    const key = `${live}\n${id}\n${use.interface}`;
    if (this.routes.has(key)) return this.routes.get(key);
    const pool = [...this.exts.values()].filter((p) => p !== ext && !p.detached && (!live || (p.live && p.provides.has(to))));
    // AC9's wrong program: a use stays wired to the piece it prefers, by name, whether or not that piece is still there.
    const chosen = this.options.plant === 'wires-by-name' && use.from ? use.from
      : resolve(id, { ...use, interface: to }, pool.map((p) => pieceOf(p.entry.id, p.manifest)), this.namesAlone || to !== use.interface)?.id;
    const found = pool.find((p) => p.entry.id === chosen);
    this.routes.set(key, found);
    return found;
  }
  /**
   * A read through a use: the provider's value, served at the minor the use was built against, with a handle its
   * model jobs may take; missing once none provides it or its removal detached it. An answer a version gives after a
   * new version of it is active is refused at the edge (#103).
   */
  private async readUse(ext: Ext, name: unknown): Promise<unknown> {
    const id = ext.entry.id;
    if (typeof name !== 'string' || !ext.uses.has(name)) throw Error(`deep.read: ${String(name)} isn't an interface ${id} uses`);
    const use = (ext.manifest.uses ?? []).find((u) => u.interface === name) ?? { interface: name };
    // Only a provider that started: an output publishes once its piece is ready, like its handlers and actions.
    const provider = this.providerOf(ext, use);
    // AC10's wrong program reads an optional use with no provider as empty.
    if (!provider) return optional(ext, use) && this.options.plant === 'optional-reads-empty' ? { value: [] } : { missing: true };
    const to = this.wired.get(id)?.get(name) ?? name;
    const edge = `${id} uses ${name} from ${provider.entry.id}`;
    if (!provider.ask) throw Error(`the edge ${edge}: ${provider.entry.id} stopped while ${id} still used it`);
    const reading = within(CALL_MS, `the edge ${edge}`, provider.ask('output', { name: to }));
    provider.reads.add(reading);
    let refuse: (e: Error) => void = () => undefined;
    const replaced = new Promise<never>((_, reject) => { refuse = reject; });
    provider.refuseReads.add(refuse);
    let value: unknown;
    try {
      value = await Promise.race([reading, replaced]);
    } catch (e) {
      throw Error(`the edge ${edge}: ${message(e)}`);
    } finally {
      provider.reads.delete(reading);
      provider.refuseReads.delete(refuse);
    }
    const active = this.exts.get(provider.entry.id);
    if (active && active !== provider) throw Error(`the edge ${edge}: ${provider.entry.version} answered after ${active.entry.version} replaced it, so its answer isn't delivered`);
    // AC15's wrong program hands the user the provider's newest shape.
    const served = use.schema === undefined || this.options.plant === 'serves-newest-minor' ? value : servedAt(value, use.schema);
    const now = this.options.now();
    const handle = `reading:${ulid(now)}`;
    ext.edgeReads.set(handle, { edge, value: served, at: now });
    // The newest readings only: a job takes what its piece just read.
    if (ext.edgeReads.size > EDGE_READS) ext.edgeReads.delete(ext.edgeReads.keys().next().value!);
    return { value: served, handle };
  }
  /**
   * `deep.call`: the action output a piece uses, run through its edge for the calling piece (#103). A read runs; a
   * change or a send runs only on your yes to one ask naming the caller, as an agent's call would, and then under the
   * provider's own grant, its caller the calling piece. Composition never lends the caller the provider's access.
   */
  private async callThrough(ext: Ext, name: unknown, input: unknown, scope: string | undefined): Promise<unknown> {
    const id = ext.entry.id;
    if (typeof name !== 'string' || !ext.uses.has(name)) throw Error(`deep.call: ${String(name)} isn't an interface ${id} uses`);
    const use = (ext.manifest.uses ?? []).find((u) => u.interface === name) ?? { interface: name };
    const provider = this.providerOf(ext, use);
    if (!provider) throw Error(`deep.call: no piece provides ${name} to ${id} now`);
    const action = name.slice(0, name.lastIndexOf('@'));
    const declared = provider.actions.get(action);
    if (!declared || !(provider.manifest.provides ?? []).some((r) => r.interface === name && r.kind === 'action')) throw Error(`deep.call: ${provider.entry.id} provides ${name}, but no action ${action} serves it`);
    const caller = this.connection(ext, scope);
    // AC11's wrong program runs the call as the provider itself, under its own grant and rules, with no ask.
    if (declared.declares !== 'read' && this.options.plant !== 'call-under-provider-grant') {
      const what = declared.declares === 'send' ? 'send through' : 'change your data with';
      const shown = JSON.stringify(input) ?? 'null';
      const yes = await this.yours(`action.${declared.declares}`, `Let ${id} ${what} ${provider.entry.id}'s ${action}, given ${shown.slice(0, 500)}? ${id} calls it through its use of ${name}.`,
        { call: ulid(this.options.now()), caller: id, action, provider: provider.entry.id }, declared.declares === 'send' ? 'Send it' : 'Change it', 'Don\'t',
        [{ does: `${id} calls ${provider.entry.id}'s ${action} with ${shown.slice(0, 500)}`, changes: [`${provider.entry.id}'s ${action}`], undo: null }]);
      if (!yes) throw Error(`deep.call: ${id}'s call of ${action} wasn't run: you didn't say yes`);
    }
    const planted: Connection = { writer: `ext:${provider.entry.id}`, actor: 'you', scope: 'you' };
    const result = await this.callAction({
      action, target: { handle: `ext:${provider.entry.id}`, version: provider.entry.version }, input,
      caller: this.options.plant === 'call-under-provider-grant' ? planted : caller,
    });
    if (result.status !== 'done') throw Error(`deep.call: ${result.reason}`);
    return result.output;
  }

  /** Outside calls made for a package, per package and host: the times of the calls its quota counts. */
  private readonly quotas = new Map<string, number[]>();
  /** An outside call the host makes for a package: only to a host its grant names, within that host's quota. */
  private async fetch(ext: Ext, request: unknown, connection: Connection): Promise<unknown> {
    const id = ext.entry.id;
    const r = (typeof request === 'object' && request !== null ? request : {}) as { url?: unknown; method?: unknown; headers?: unknown; body?: unknown };
    let url: URL | undefined;
    try { url = new URL(String(r.url)); } catch { /* no URL: no host the grant names */ }
    // The clause names the grant's own words, never the call's: a host or a path the package chose could carry anything.
    const grants = ext.entry.grant.hosts ?? [];
    const at = url && ['http:', 'https:'].includes(url.protocol) ? grants.findIndex((g) => g.host === url.host) : -1;
    if (at < 0) {
      await this.refused(connection, 'deep.fetch', 'grant', `hosts: the call's host is none of the ${grants.length} the grant names`, [request]);
      throw Error(`deep.fetch: ${id}'s grant names no such host`);
    }
    const grant = grants[at]!;
    const key = `${id}\n${grant.host}`;
    const now = this.options.now();
    const times = (this.quotas.get(key) ?? []).filter((t) => now - t < grant.quota.per_ms);
    if (times.length >= grant.quota.calls) {
      this.quotas.set(key, times);
      await this.refused(connection, 'deep.fetch', 'quota', `hosts[${at}].quota: ${grant.quota.calls} calls per ${grant.quota.per_ms} ms to ${grant.host}`, [request]);
      throw Error(`deep.fetch: ${id}'s quota for ${grant.host} is spent`);
    }
    this.quotas.set(key, [...times, now]);
    const headers = typeof r.headers === 'object' && r.headers !== null ? Object.fromEntries(Object.entries(r.headers).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {};
    try {
      const answer = await nodeFetch({ url: url!.href, method: typeof r.method === 'string' ? r.method : 'GET', headers, ...(typeof r.body === 'string' ? { body: r.body } : {}) }, AbortSignal.timeout(CALL_MS));
      return { status: answer.status, body: answer.body };
    } catch (error) {
      if (error instanceof AnswerTooLarge) throw Error(`deep.fetch: ${grant.host}'s answer is over ${ANSWER} bytes`);
      throw error;
    }
  }

  /**
   * Whether a notice may go out (#365), refused naming why: a notice kind its manifest declares (and, in a run, its job
   * declares), for a cause you subscribed to, each reading it cites one the hub recorded that is still fresh, within the
   * plug-in's limit a minute. Its subject keys its cause, so the notice already sent for one is answered again.
   */
  private async noticeAllowed(ext: Ext, given: unknown, scope: string | undefined): Promise<{ subject: string; sent?: string }> {
    return this.noticeHost.noticeAllowed(ext, given, this.scheduleHost.context(scope));
  }
  /** What keeps a schedule's run from starting (#365): a source it reads that no loaded plug-in registers, or a secret one needs that isn't held. */
  private async blockedRun(decl: ScheduleDecl): Promise<string | null> {
    return this.scheduleHost.blockedRun(decl);
  }
  /** Hands a run to its plug-in's job (#365), its calls carrying the run's scope; resolves with the run's verdict. */
  private dispatchRun(decl: ScheduleDecl, run: { run: string; due: number }): Promise<Ended> | undefined {
    return this.scheduleHost.dispatchRun(decl, run);
  }

  async hook(request: HookRequest): Promise<HookReply>;
  async hook(line: HookRequestLine): Promise<{ adapter: string; events: { kind: string }[] }>;
  async hook(arg: HookRequest | HookRequestLine): Promise<HookReply | { adapter: string; events: { kind: string }[] }> {
    // Two callers share the name: the hub's hook request to every handler of a kind (#350), and the hook deep-hook
    // held, a line with its `v` and `event`, which binds and gates a session through its adapter (#349).
    const isLine = (a: HookRequest | HookRequestLine): a is HookRequestLine => 'event' in a && typeof (a as HookRequestLine).v === 'number';
    return isLine(arg) ? this.hookLine(arg) : this.hookRequest(arg);
  }
  private async hookRequest(request: HookRequest): Promise<HookReply> {
    const { kind, deadline } = request;
    const bad = badDeadline('deadline', deadline);
    if (bad) throw Error(`a hook request's ${bad}`);
    const failed: HookReply['failed'] = [];
    const contributions: HookContribution[] = [];
    await Promise.all([...this.exts.values()].filter((ext) => ext.live && ext.subscribed.has(kind)).map(async (ext) => {
      const id = ext.entry.id;
      const fail = (reason: string): void => void failed.push({ extension: id, reason });
      // One clock for all of this extension's part: its trust check, an unload that check may start, and its handler.
      // A slow one fails this extension alone, by the deadline, so its siblings' replies still reach the agent in time.
      const due = performance.now() + deadline + HOOK_GRACE_MS;
      const left = (): number => Math.max(0, due - performance.now());
      try {
        if (await within(left(), `${id}'s trust check`, this.revoked(ext))) return fail(`${id}'s project ${ext.entry.project} is no longer trusted, so it was stopped`);
      } catch (e) {
        if (e instanceof Overran) return fail(`${id}'s trust check didn't answer within the hook's deadline of ${deadline} ms`);
        throw e;
      }
      // Removed while trust answered: it is asked nothing, and its absence is on the reply.
      if (!ext.live || !ext.ask) return fail(`${id} stopped before it could reply`);
      let replies: unknown;
      const asked = performance.now();
      try {
        // Its own deadline only: a handler that misses it stays loaded, and its late reply goes nowhere.
        replies = await within(left(), `${id}'s ${kind} handler`, ext.ask('hook', { kind, request: { kind, data: request.data }, deadline }));
      } catch (e) {
        if (e instanceof Overran) return fail(`${id} missed the hook's deadline of ${deadline} ms`);
        // An error's text is the package's own words: only a release package's reaches the reply.
        return fail(`${id}'s ${kind} handler failed${ext.released ? `: ${message(e)}` : ''}`);
      }
      const replier = { id, firstParty: ext.released, templates: ext.manifest.templates ?? [] };
      const context: string[] = [];
      let deny: { reason: string } | undefined;
      // Late by the host's own clock, whatever the package's said: the grace is for the trip back, so what came after
      // the deadline fails and its context goes, though a deny it carries still stands.
      let failure: string | undefined = performance.now() - asked > deadline ? `${id} missed the hook's deadline of ${deadline} ms` : undefined;
      for (const reply of Array.isArray(replies) ? replies : [replies]) {
        // The runtime's marker for one handler that threw or missed the deadline: it fails, its siblings still count.
        const marker = typeof reply === 'object' && reply !== null && Object.keys(reply).length === 1 ? (reply as { $handler?: unknown }).$handler : undefined;
        if (marker === 'threw' || marker === 'late') {
          failure ??= marker === 'late' ? `${id} missed the hook's deadline of ${deadline} ms` : `${id}'s ${kind} handler failed`;
          continue;
        }
        const checked = checkReply(replier, kind, reply, this.options.plant === 'context-as-text');
        if (!checked.ok) {
          failure ??= checked.reason;
          continue;
        }
        context.push(...checked.context);
        deny ??= checked.deny;
      }
      // A failed reply takes all its package's context with it, but no handler's failure removes a deny that stands.
      if (failure !== undefined) fail(failure);
      const kept = failure === undefined ? context : [];
      if (kept.length || deny) contributions.push({ extension: id, firstParty: ext.released, context: kept, ...(deny ? { deny } : {}) });
    }));
    const plant = this.options.plant === 'join-by-id-alone' || this.options.plant === 'cut-in-join-order' ? this.options.plant : undefined;
    return { ...joinReplies(contributions, request.bound, plant), failed: failed.sort((a, b) => (a.extension < b.extension ? -1 : a.extension > b.extension ? 1 : 0)) };
  }

  /** Each request ID's call (#363), by its caller: the digest of what it asked, and its result, which a retry gets. */
  private readonly requests = new Map<string, { digest: string; result: Promise<ActionResult> }>();
  /** The notices each change or send call sent while its handler ran, by its call ID (#363). */
  private readonly notices = new Map<string, string[]>();
  async callAction(call: ActionCall): Promise<ActionResult> {
    const { request } = call;
    if (request === undefined) return this.callNow(call);
    if (typeof request !== 'string' || !request) return { status: 'refused', reason: 'a call\'s request ID is a non-empty string' };
    // An identical retry runs nothing again; the same ID with other input is refused before anything is written or run.
    const key = `${call.caller.writer}\u0000${request}`;
    const digest = sha256Hex(canonicalize(JSON.parse(JSON.stringify({ action: call.action, target: call.target ?? null, input: call.input ?? null })) as JsonValue));
    const seen = this.requests.get(key);
    if (seen) return seen.digest === digest ? seen.result : { status: 'refused', reason: `the request ID ${request} was used for another call; nothing was run or written for this one` };
    const result = this.entered(call, request).then((before) => before ?? this.callNow(call));
    this.requests.set(key, { digest, result });
    return result;
  }
  /**
   * A request ID's call entered before this host started (#363), as its action.entered holds it, or undefined: an
   * identical retry runs nothing again and gets no output, which isn't kept, and one whose call never reported or
   * failed gets the call refused; the same ID with other input is refused.
   */
  private async entered(call: ActionCall, request: string): Promise<ActionResult | undefined> {
    const { session, actor } = call.caller;
    const [row] = (await this.options.record.raw(`SELECT data FROM events WHERE kind = 'action.entered' AND writer = 'core' AND actor = ?
      AND session_id IS ? AND json_extract(data, '$.request') = ? ORDER BY log_pos LIMIT 1`, [actor, session ?? null, request])) as { data: string }[];
    if (!row) return undefined;
    const before = JSON.parse(row.data) as { call: string; plugin: string; action: string; input: JsonValue };
    const same = (v: unknown): string => sha256Hex(canonicalize((JSON.parse(JSON.stringify(v ?? null)) ?? null) as JsonValue));
    if (`ext:${before.plugin}` !== call.target?.handle || before.action !== call.action || same(before.input) !== same(call.input)) {
      return { status: 'refused', reason: `the request ID ${request} was used for another call; nothing was run or written for this one` };
    }
    const [ended] = (await this.options.record.raw("SELECT data FROM events WHERE kind = 'action.reported' AND json_extract(data, '$.call') = ? LIMIT 1", [before.call])) as { data: string }[];
    const error = ended ? (JSON.parse(ended.data) as { error: string | null }).error : `${call.action}'s call ${before.call} never reported, so what it did is unknown`;
    return error === null ? { status: 'done', output: null } : { status: 'refused', reason: error, started: true, call: before.call };
  }
  private async callNow(call: ActionCall): Promise<ActionResult> {
    const refuse = (reason: string): ActionResult => ({ status: 'refused', reason });
    const { action, target, caller, request } = call;
    const id = /^ext:(.+)$/.exec(target?.handle ?? '')?.[1];
    const ext = id === undefined ? undefined : this.exts.get(id);
    if (!ext || !ext.live || !ext.ask) return refuse(`${target?.handle} names no piece that is loaded and started`);
    // The target names its version: a call meant for another one, a removed or never-active version, runs nothing.
    if (ext.entry.version !== target.version) return refuse(`${target.handle}@${target.version} is a stale target: the version active is ${ext.entry.version}`);
    if (await this.revoked(ext)) return refuse(`${id}'s project ${ext.entry.project} is no longer trusted, so it was stopped`);
    // Removed while trust answered: new calls stopped first, so this one runs nothing.
    if (this.exts.get(ext.entry.id) !== ext || !ext.live || !ext.ask) return refuse(`${target.handle} was removed before ${action} could run`);
    const declared = ext.actions.get(action);
    if (!declared) return refuse(`${id} registered no action ${action}`);
    const recorded = declared.declares !== 'read';
    const held = declared.check(call.input);
    if (!held.ok) {
      await this.refused(caller, action, 'schema', `${action}'s input at ${held.path || '/'}: ${held.code}`, [{ action, target, input: call.input }]);
      return refuse(`${action}'s input fails its schema at ${held.path || '/'} (${held.code})`);
    }
    const scope = randomUUID();
    ext.scopes.set(scope, caller);
    // A change or send is entered on record before its handler starts, by the core, for its caller.
    const { writer: _writer, run: _run, ...proved } = caller;
    const core: Connection = { ...proved, writer: 'core' };
    let entered: { call: string; at: number } | undefined;
    let returned: unknown;
    let failure: string | undefined;
    try {
      if (recorded) {
        const now = this.options.now();
        const callId = ulid(now);
        const { log_pos } = await this.options.record.append(core, {
          // A call that came with no request ID, such as a panel's, is entered under its own call ID: nothing retries it.
          v: 1, id: ulid(now), kind: 'action.entered', ts: now, data: { call: callId, plugin: id!, action, request: request ?? callId, input: call.input as JsonValue },
        });
        entered = { call: callId, at: log_pos };
        ext.callOf.set(scope, callId);
        this.notices.set(callId, []);
      }
      const running = stretchable(CALL_MS, `${id}'s ${action}`, ext.ask('action', { name: action, input: call.input, ctx: { target: { handle: target.handle, version: target.version } }, scope }));
      ext.deadlines.set(scope, running.until);
      returned = await running.done;
    } catch (e) {
      // An error's text is the package's own words: only a release package's reaches its caller, and the package's own
      // tests, which hand it back to the package (#366).
      failure = `${id}'s ${action} failed${ext.released || caller === TESTER ? `: ${message(e)}` : ''}`;
    } finally {
      ext.scopes.delete(scope);
      ext.callOf.delete(scope);
      ext.deadlines.delete(scope);
    }
    if (entered) await this.reported(ext, entered, core, returned, failure);
    const ran = { started: true as const, ...(entered ? { call: entered.call } : {}) };
    if (failure !== undefined) return { ...refuse(failure), ...ran };
    // Removed while it ran: what it returns reaches no one, and nothing it does later goes through its replacement.
    if (this.exts.get(ext.entry.id) !== ext || !ext.live) return { ...refuse(`${id}@${target.version} was removed while ${action} ran`), ...ran };
    // A change or send returns { output, report }: its caller gets the output, and the report is on record.
    return { status: 'done', output: entered && isPlain(returned) && Object.hasOwn(returned, 'output') ? returned.output : returned };
  }
  /**
   * action.reported for a change or send call, when its handler ends (#363): the report's `verified` and `checked`,
   * a missing or malformed report counting as unverified and a failed call as unverified, and `changed`, the store
   * items and notices the hub wrote for the call, read from the record, never from the report.
   */
  private async reported(ext: Ext, entered: { call: string; at: number }, core: Connection, returned: unknown, failure: string | undefined): Promise<void> {
    const given = isPlain(returned) && isPlain(returned.report) ? returned.report : {};
    const verified = this.options.plant === 'keeps-malformed-verified' && 'verified' in given ? String(given.verified)
      : failure === undefined && typeof given.verified === 'boolean' ? String(given.verified) : 'unverified';
    const checked = typeof given.checked === 'string' && given.checked ? given.checked.slice(0, 8192) : null;
    const changed: string[] = [];
    const notices = this.notices.get(entered.call) ?? [];
    this.notices.delete(entered.call);
    const kinds = [...(ext.manifest.stores ?? []), ...(notices.length ? ['notice.sent'] : []), 'send.made'];
    for (let after = entered.at; kinds.length;) {
      const page = await this.options.record.read({ after, limit: PAGE, kinds });
      for (const e of page) {
        const item = e.data as { key: string; call: string | null; notice: string; phase?: string };
        if (e.kind === 'notice.sent') {
          if (notices.includes(item.notice)) changed.push(item.notice);
        } else if (e.kind === 'send.made') {
          // A send the hub made for the call (#365): claimed, so it went out or may have.
          if (item.call === entered.call && item.phase === 'claimed') changed.push(`send:${item.key}`);
        } else if (item.call === entered.call) changed.push(`${e.kind}:${item.key}`);
      }
      if (page.length < PAGE) break;
      after = page[page.length - 1]!.log_pos;
    }
    const now = this.options.now();
    await this.options.record.append(core, {
      v: 1, id: ulid(now), kind: 'action.reported', ts: now,
      data: { call: entered.call, changed: this.options.plant === 'copies-report-changed' && texts(given.changed) ? given.changed as string[] : changed, verified, checked, error: failure ?? null },
    });
  }

  async actions(): Promise<ActionListing[]> {
    return [...this.exts.values()].filter((ext) => ext.live).flatMap((ext) => [...ext.actions].map(([action, a]) => ({
      action, extension: ext.entry.id, version: ext.entry.version, declares: a.declares, input: structuredClone(a.input), exposed: a.leftOut === null, reason: a.leftOut,
    })));
  }

  async loaded(): Promise<Loaded[]> {
    return [...this.exts.values()].map((ext) => this.loadedOf(ext));
  }
  async checks(): Promise<{ kind: string; extension: string }[]> {
    return [...this.exts.values()].flatMap((ext) => ext.kinds.map((kind) => ({ kind, extension: ext.entry.id })));
  }
  async environment(name: string): Promise<RuntimeEnvironment> {
    const ext = this.environmentOwner(name);
    const current = async (): Promise<void> => {
      if (!ext?.live || !ext.ask || this.exts.get(ext.entry.id) !== ext || await this.revoked(ext)) {
        throw Error(`no loaded extension registered the environment ${name}; it is absent, replaced or no longer trusted`);
      }
    };
    await current();
    // Only the release's hub-bound environment passed the install kit; never widen its execution boundary here.
    if (!ext!.hubBound || !ext!.entry.kits?.some(k => k.slot === ENVIRONMENT && k.fill === name && k.verdict === 'PASS')) {
      throw Error(`BLOCKED: environment ${name} has no passing install kit for this release package`);
    }
    return {
      extension: ext!.entry.id, version: ext!.entry.version,
      up: async (spec, lease, checkout, deadline) => {
        const bad = badDeadline('deadline', deadline);
        if (bad) throw Error(`an environment start's ${bad}`);
        await current();
        // Capture the owning generation's handler: cleanup must work even after it is unpublished.
        const owner = ext!;
        const ask = owner.ask!;
        let cancelled = false;
        const started = ask('env.up', { name, spec, lease, checkout }).then(async (value): Promise<RunningEnvironment> => {
          if (!isPlain(value) || typeof value.id !== 'string' || !value.id || value.port !== lease.port || !Number.isSafeInteger(value.pid) || Number(value.pid) <= 0) {
            throw Error(`environment ${name} returned an invalid handle or a port outside its lease`);
          }
          const handle = Object.freeze({ id: value.id, port: lease.port, pid: Number(value.pid) });
          let stopped: Promise<void> | undefined;
          const down = (): Promise<void> => stopped ??= within(CALL_MS, `environment ${name} down`, ask('env.down', { name, handle }))
            .then(() => { owner.environmentStops.delete(down); });
          owner.environmentStops.add(down);
          if (cancelled || !owner.live || this.exts.get(owner.entry.id) !== owner) {
            await down();
            throw Error(`no loaded extension registered the environment ${name}; its start was cancelled or its load removed`);
          }
          return { handle, down };
        });
        // Even a start returning after its deadline is observed and cleaned by its own handler.
        const bounded = within(deadline, `environment ${name}`, started);
        owner.environmentStarts.add(bounded);
        try {
          const running = await bounded;
          owner.environmentStarts.delete(bounded);
          await current();
          return running;
        } catch (error) {
          cancelled = true;
          owner.environmentStarts.delete(bounded);
          if (error instanceof Overran) await this.unload(owner);
          throw error;
        } finally {
          owner.environmentStarts.delete(bounded);
        }
      },
    };
  }
  hooks(): string[] {
    return [...new Set([...this.exts.values()].flatMap((ext) => [...ext.subscribed]))].sort();
  }
  /**
   * What a check kind gets with each run (#30 AC5): the run's checkout and deadline, and for a kind in the hub, host@1,
   * the supervisor's, so its process starts only through it and the supervisor sandboxes it. A kind the sandbox runs
   * gets no host: its context crosses a wire, and it never starts a process of its own.
   */
  private checkContext<C extends { deadline: number }>(ext: Ext, ctx: C): C | (C & { host: RunHost }) {
    return ext.place === 'hub' ? { ...ctx, host: this.runHost() } : ctx;
  }
  /** host@1 and nothing more of the supervisor: its name, start, signal, wait and facts, bound to it. */
  private runHost(): RunHost {
    const s = this.options.supervisor;
    return (this.hostOne ??= { name: s.name, start: (spec) => s.start(spec), signal: (run, signal) => s.signal(run, signal), wait: (run) => s.wait(run), facts: () => s.facts() });
  }
  private hostOne: RunHost | undefined;
  async runCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number; environment?: string }): Promise<CheckResult> {
    // Refused before any package is asked.
    const bad = badDeadline('deadline', ctx.deadline);
    if (bad) throw Error(`a check run's ${bad}`);
    const ext = this.kindOwner(kind);
    if (!ext?.ask || (await this.revoked(ext))) return nothing('missing', `no loaded extension registered the check kind ${kind}`);
    // A run in a first-party piece's output, such as env-local's environment, makes the check's piece its user (#103).
    if (ctx.environment !== undefined) await this.usedFirstParty(ext.entry.id, ctx.environment);
    try {
      this.canvasKeys.set(ext, []);
      const result = await this.ask(ext, ctx.deadline, kind, 'run', { type: kind, spec, ctx: this.checkContext(ext, ctx) });
      const read = this.canvasKeys.get(ext) ?? [];
      const { isCheckResult } = await import('@deepbuild/conformance');
      if (!isCheckResult(result)) return nothing('failed', `${ext.entry.id}'s ${kind} returned no check result as check.kind@1 defines one`);
      // A passed run rests on the tests it counted: passed with none counted ran nothing it can vouch for.
      if (result.outcome === 'passed' && result.testsRun === 0) return nothing('ran_nothing', `${ext.entry.id}'s ${kind} reported passed without its results: it counted no test`);
      // A pass built on canvas reads holds only with their content keys as its evidence (Check input: plug-in reads).
      const missing = read.filter((k) => !result.evidence.includes(k));
      if (result.outcome === 'passed' && missing.length) return nothing('failed', `${ext.entry.id}'s ${kind} reported passed without the content keys its deep.canvas.read calls returned as evidence (${missing.length} missing, first ${missing[0]})`);
      return result;
    } catch (e) {
      if (e instanceof Overran) return nothing('overran', `${ext.entry.id}'s ${kind} ran past its deadline of ${ctx.deadline} ms${ext.place === 'sandbox' ? ', and was stopped' : ''}`);
      throw e;
    } finally {
      this.canvasKeys.delete(ext);
    }
  }
  async deliver(events: Event[]): Promise<void> {
    const failed: string[] = [];
    await Promise.all([...this.exts.values()].filter((ext) => ext.live).map(async (ext) => {
      // Filtered by its grant before anything crosses to it, as a query is.
      const mine = events.filter((e) => ext.subscribed.has(e.kind)).map((e) => this.visible(ext, e)).filter((e) => e !== undefined);
      if (!mine.length) return;
      if (!ext.ask || (await this.revoked(ext))) return void failed.push(`${ext.entry.id}: it stopped, its project no longer trusted or unloaded`);
      await this.ask(ext, CALL_MS, 'events', 'deliver', { events: mine }).catch((e) => failed.push(`${ext.entry.id}: ${message(e)}`));
    }));
    if (failed.length) throw Error(`not every subscribed package took the events: ${failed.join('; ')}`);
  }
  private async hookLine(line: HookRequestLine): Promise<{ adapter: string; events: { kind: string }[] }> {
    return this.routing.hookLine(line);
  }
  index(): { name: string; extension: string; fill: IndexFill } | undefined {
    const ext = [...this.exts.values()].find((e) => e.index && e.live);
    return ext && { name: ext.index!.name, extension: ext.entry.id, fill: (ext.index!.fill ??= this.indexFill(ext)) };
  }
  /** The package's index, each call asked of its side within the call deadline. */
  private indexFill(ext: Ext): IndexFill {
    const { name, revision } = ext.index!;
    const call = (op: string, ...args: unknown[]): Promise<unknown> => this.ask(ext, CALL_MS, `index ${name}`, 'index', { name, op, args });
    return {
      slot: INDEX, revision,
      rebuild: (claims) => call('rebuild', claims), upsert: (claims) => call('upsert', claims), dropSource: (source) => call('dropSource', source),
      search: (query) => call('search', query) as ReturnType<IndexFill['search']>,
    };
  }
  async adapters(): Promise<{ name: string; extension: string; caps: AdapterCaps }[]> {
    return this.routing.adapters();
  }
  async owner(session: string): Promise<{ adapter: string } | null> {
    return this.routing.owner(session);
  }
  async deliverAnswer(answer: Delivery): Promise<Delivered> {
    return this.routing.deliverAnswer(answer);
  }

  async ready(): Promise<void> {
    if (this.isReady) return this.starting;
    this.isReady = true;
    this.terminals.attach();
    // The hub's own timer: schedules fire from it, never from the app's clock (#365).
    this.timer = setInterval(() => void this.tick().catch(() => undefined), TIMER_MS);
    this.timer.unref();
    this.starting = (async () => {
      await this.firstPartyVersions();
      const failed: string[] = [];
      for (const ext of [...this.exts.values()]) {
        if (this.closed) return;
        if (!ext.ask) {
          await this.start(ext).then(async () => { if (this.closed) await this.unload(ext); }, async (e) => {
            failed.push(`${ext.entry.id}: ${message(e)}`);
            await this.unload(ext);
          });
        }
      }
      // The rest started; each that didn't is unloaded and named.
      if (failed.length) throw Error(`not every package loaded before ready started: ${failed.join('; ')}`);
    })();
    return this.starting;
  }

  async turnOn(id: string, routes: string[]): Promise<{ address: string }> {
    const ext = this.exts.get(id);
    if (!ext?.ask) throw Error(`${id} isn't loaded and running`);
    const untrusted = `${id}'s project is no longer trusted, so it was stopped and not turned on`;
    if (ext.server) throw Error(`${id} is already turned on`);
    for (const route of routes) if (!ext.routes.has(route)) throw Error(`${id} registered no route ${route}`);
    const chosen = new Set(routes);
    // node:http loads only for a package turned on: about 2.7 MB of heap the hub's core otherwise never holds.
    const { createServer: createHttpServer } = await import('node:http');
    // A request has the call deadline to arrive whole; one that fails is that request's alone.
    const server = createHttpServer({ requestTimeout: CALL_MS, connectionsCheckingInterval: 1000 }, (req, res) => void this.serve(ext, chosen, req, res).catch(() => res.destroy()));
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    if (this.closed || this.exts.get(id) !== ext || !ext.ask || ext.server) {
      await new Promise((resolve) => server.close(resolve));
      throw Error(ext.server ? `${id} is already turned on` : `${id} stopped while it was turned on`);
    }
    ext.server = server;
    // Revoked while it bound: unloading it closes this listener too.
    if (await this.revoked(ext)) throw Error(untrusted);
    return { address: `127.0.0.1:${(server.address() as AddressInfo).port}` };
  }
  private async serve(ext: Ext, chosen: Set<string>, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0]!;
    const route = `${req.method} ${path}`;
    if (!chosen.has(route) || !ext.ask || (await this.revoked(ext))) {
      req.resume();
      const chosenPath = [...chosen].some((r) => r.slice(r.indexOf(' ') + 1) === path);
      res.writeHead(chosenPath ? 405 : 404).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > BODY) {
        res.writeHead(413, { connection: 'close' }).end();
        req.destroy();
        return;
      }
      chunks.push(chunk as Buffer);
    }
    // Its body took time to arrive: trust is checked again before the package sees it.
    if (!ext.ask || (await this.revoked(ext))) {
      res.writeHead(404).end();
      return;
    }
    try {
      const request = { method: req.method, path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      const answer = (await this.ask(ext, CALL_MS, route, 'route', { route, request })) as { status?: unknown; body?: unknown } | null;
      const status = typeof answer?.status === 'number' && answer.status >= 200 && answer.status < 600 ? answer.status : 502;
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(typeof answer?.body === 'string' ? answer.body : '');
    } catch {
      res.writeHead(502).end();
    }
  }
  async turnOff(id: string, ext = this.exts.get(id)): Promise<void> {
    const server = ext?.server;
    if (!ext || !server) return;
    delete ext.server;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  loadResult(id: string): Record<string, unknown> | undefined {
    const r = this.loadResults.get(id);
    return r === undefined ? undefined : structuredClone(r);
  }
  async edges(): Promise<{ user: string; uses: string; interface: string; provider: string }[]> {
    const out: { user: string; uses: string; interface: string; provider: string }[] = [];
    for (const ext of this.exts.values()) {
      for (const use of ext.manifest.uses ?? []) {
        const provider = this.providerOf(ext, use, false);
        if (provider) out.push({ user: ext.entry.id, uses: use.interface, interface: this.wired.get(ext.entry.id)?.get(use.interface) ?? use.interface, provider: provider.entry.id });
      }
    }
    // A first-party output's users (#103): the installed pieces whose runs used it, as the record keeps them.
    for (const u of await this.firstPartyUses()) if (this.entries[u.user]) out.push({ user: u.user, uses: u.interface, interface: u.interface, provider: u.provider });
    return out.sort((a, b) => (a.user + a.uses).localeCompare(b.user + b.uses));
  }

  /** One reading names a terminals index this start couldn't read whole, and the terminals it lost (#996). */
  async opened(): Promise<void> {
    const damaged = this.terminals.damaged;
    if (!damaged) return;
    // The reading first, then the index written again: a cut in between finds the index damaged and reads it again.
    const now = this.options.now();
    await this.options.record.append(CORE, {
      v: 1, id: ulid(now), kind: 'reading.recorded', ts: now,
      data: {
        reading: `reading:${ulid(now)}`, value: damaged.lost.length, unit: 'terminals lost', as_of: now, n: 1, outside: false,
        source: `terminals.json couldn't be read whole, so it was kept aside as ${basename(damaged.aside)}; lost: ${damaged.lost.slice(0, 50).join(', ') || 'none'}${damaged.lost.length > 50 ? ` and ${damaged.lost.length - 50} more` : ''}`,
      },
    });
    this.terminals.settle();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.scheduleHost.close();
    clearInterval(this.timer);
    this.sending.close();
    this.work.close();
    // Starts, loads and conformance runs under way finish first, each then unloaded here, so none leaves a process behind.
    await this.starting.catch(() => undefined);
    await Promise.all([...this.loading.values(), ...[...this.checking].map((c) => c.catch(() => undefined))]);
    for (const ext of [...this.exts.values()]) await this.unload(ext);
    // A call that was under way finishes, or finds its package unloaded, before close returns.
    await Promise.all(this.calls);
    // A terminal that lives past the app runs on, its run kept by the supervisor; AC1's wrong program stops them all.
    const stopping = this.terminals.all().filter((t) => !t.kept || this.options.plant === 'close-stops-every-host');
    await Promise.all(stopping.map((t) => this.terminals.stop(t).catch(() => undefined)));
    this.terminals.close();
  }
}

/**
 * Copies a package's folder with each file's mode as it is: the digest counts modes, and a copy made under a tighter
 * umask (the hub's is 077) would otherwise digest differently from the folder it was checked as.
 */
function copyPackage(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
  const modes = (src: string, dst: string): void => {
    for (const name of readdirSync(src)) {
      const stat = lstatSync(join(src, name));
      if (stat.isDirectory()) modes(join(src, name), join(dst, name));
      else if (stat.isFile()) chmodSync(join(dst, name), stat.mode & 0o7777);
    }
  };
  modes(from, to);
}

export async function openExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
  const host = new Host(options);
  await host.opened();
  return host;
}
