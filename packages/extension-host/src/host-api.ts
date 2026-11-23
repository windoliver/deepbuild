// The extension host's interface (#348): what it answers, and the hook requests, action calls, installs and loads it
// takes and returns.
import type { AdapterCaps, HookRequestLine } from '@deepbuild/adapters';
import type { Delivery } from '@deepbuild/asks';
import type { StateSource } from '@deepbuild/conformance';
import type { ChannelCtx, ChannelDelivered, ChannelItem, ChannelReceived, CheckResult, CheckSpec, EnvironmentHandle, EnvironmentLease, EnvironmentSpec } from '@deepbuild/conformance';
import type { JoinedHookReply, JsonValue } from '@deepbuild/contracts';
import type { Connection, Event } from '@deepbuild/record';
import type { JobBytes, JobCall, JobCounter, Weight } from './job-kinds.js';
import type { JobListing } from './jobs.js';
import type { Delivered } from './adapter-routing.js';
import type { HostGrant, KitRun, ProjectView, InstalledView, Installed, IndexFill } from './host-types.js';
import type { ViewShown } from './source-types.js';
import type { SetAside } from './aside.js';
import type { ScheduleRow, ScheduleRun, Verdict } from './schedules.js';
import type { BoundValue, Rollup, Span } from './series.js';
import type { SendRow, SendRule, NoticeRow } from './sends.js';
import type { DeliveryRow, WorkEvent, WorkKitFixture, WorkPage, WorkResult, WorkTask } from './work.js';
import type { KeyTest, Reading, Recording, SourceRead, StreamRead } from './sources.js';
import type { OpenSpec, TerminalTab } from './terminals.js';

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
/**
 * The joined reply: hook.joined@1's fields, and the handlers recorded as failed. `aside`, only when there are any, holds
 * the handlers of the kind set aside (#2402): each one this request didn't ask, and each its failure set aside.
 */
export interface HookReply extends JoinedHookReply { failed: { extension: string; reason: string }[]; aside?: SetAside[] }
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
  /** Stops a loaded package and loads it again, as a new load (#2402). */
  restart(id: string): Promise<Load>;
  loaded(): Promise<Loaded[]>;
  /** The installed packages started, their code run and what it fills registered, of those to start; undefined once none is loading (#1415). */
  loadProgress(): { loaded: number; total: number } | undefined;
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
  /** The handlers set aside, three failures in a row each (#2402), until their extension loads again. */
  setAside(): SetAside[];
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
  /**
   * Every source call this host made while it records, with its secrets stripped: its first 10,000 calls and 64 MiB of
   * answers, and nothing when it was opened with `recording: false` (#2650).
   */
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
