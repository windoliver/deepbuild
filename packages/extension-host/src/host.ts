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
import { createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AdapterCaps, HookRequestLine } from '@deepbuild/adapters';
import type { Asks, Delivery, ResolverAnswer } from '@deepbuild/asks';
import { runKit, slotKits } from '@deepbuild/conformance';
import type { CheckResult, CheckRunnerFill, CheckSpec, EnvironmentFill, EnvironmentHandle, EnvironmentLease, EnvironmentSpec, SlotFill, SlotKit } from '@deepbuild/conformance';
import { canonicalize, checkManifest, frozenDigests, hubSlots, registry, sha256Hex, validate, type HookContribution, type JoinedHookReply, type JsonValue, type Schema } from '@deepbuild/contracts';
import { toJson, ulid, type Connection, type Event, type EventInput, type RecordStore } from '@deepbuild/record';
import type { LeaseKind, LeaseResult, LeaseTable } from '@deepbuild/leases';
import type { Cleanup, Supervisor } from '@deepbuild/supervisor';
import { API, extensionSide, peer } from '../runtime/deep.mjs';
import { packageDigest } from './digest.js';
import { checkReply, join as joinReplies, type JoinPlant, type Template } from './replies.js';
import { Terminals, type OpenSpec } from './terminals.js';
import type { ProjectTrust } from './trust.js';

/** A package inside DeepBuild's signed release, as the release's signed manifest lists it. */
export interface ReleaseEntry { id: string; version: string; digest: string }
/** The planted wrong programs the criteria name, selected per host; tests only. */
export type Plant = 'hub-unless-agent-built' | 'grants-only-in-record-query' | 'first-party-appends-every-kind'
  | 'context-as-text' | 'writer-from-arguments' | JoinPlant | 'stop-provider-first'
  | 'both-adapters-deliver' | 'first-to-bind-owns' | 'refuses-only-the-ring' | 'trusts-envelope-digest'
  | 'skips-kind-declare' | 'drops-mode' | 'holder-from-arguments' | 'declares-kind-on-first-lease'
  | 'close-stops-every-host' | 'narrower-grant-implies-run-as-you' | 'revoke-keeps-running' | 'revoke-stops-programs-only'
  | 'input-from-any-writer' | 'piece-writes-input';

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
}
export type ActionResult = { status: 'done'; output: unknown } | { status: 'refused'; reason: string };
/** A host you approved for a package's outside calls, with its quota. */
export interface HostGrant { host: string; quota: { calls: number; per_ms: number } }
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
  plant?: Plant;
}
export interface InstallFrom {
  from: string;
  /** The agent session that built or changed it, or null when no agent wrote it. */
  builtBy: string | null;
  /** A project's extension: the repo folder it comes with. */
  project?: string;
  /** What you approved: the event kinds of the record it may read, and the hosts its outside calls may reach. */
  grant?: { record?: string[]; hosts?: HostGrant[] };
}
/** A kit the install ran on what the package registers: the slot, the fill (a check kind's name), its verdict. */
export interface KitRun { slot: string; fill: string; verdict: 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE' }
export interface Installed { id: string; version: string; folder: string; digest: string; builtBy: string | null; project: string | null; kits: KitRun[] }
/** How an answer reaches a session: into the running turn, in the stop hold, waking an idle session, or at its next prompt. */
export type Route = 'steer' | 'hold' | 'wake' | 'prompt';
export type Delivered =
  | { status: 'delivered'; session: string; adapter: string; route: Route }
  | { status: 'held'; session: string; adapter: string };
export interface Conformance { id: string; version: string; digest: string; passed: boolean; reasons: string[] }
export interface Loaded { status: 'loaded'; id: string; version: string; place: 'hub' | 'sandbox'; run: string | null }
export interface Refused { status: 'refused'; id: string; version: string; reason: string }
export type Load = Loaded | Refused;
export interface ExtensionHost {
  install(from: InstallFrom): Promise<Installed>;
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
  rawInput(connection: Connection, terminal: string, text: string): Promise<void>;
  /** Runs its conformance on its files now; the result is kept for that digest. */
  check(pkg: Installed): Promise<Conformance>;
  /** Whether a conformance result is kept for this id and version, passed or failed; a load with none is refused. */
  checked(pkg: Installed): boolean;
  load(pkg: Installed): Promise<Load>;
  loaded(): Promise<Loaded[]>;
  checks(): Promise<{ kind: string; extension: string }[]>;
  runCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number }): Promise<CheckResult>;
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
  /** Runs an action of the live piece the call targets, at the version it names, for its caller. */
  callAction(call: ActionCall): Promise<ActionResult>;
  /** Removes a loaded piece: new calls stop first, its users' uses detach, then it stops. `load` enables it again. */
  disable(id: string): Promise<void>;
  /** The adapters loaded extensions registered. */
  adapters(): Promise<{ name: string; extension: string; caps: AdapterCaps }[]>;
  /** The index a loaded package registered in place of the shipped one, if any (#355). */
  index(): { name: string; extension: string; fill: IndexFill } | undefined;
  /** The adapter that owns the session: the one that gates it; null before any adapter bound it. */
  owner(session: string): Promise<{ adapter: string } | null>;
  /** An answer for a session: the owning adapter delivers it by a route its flags allow now, or it waits for one. */
  deliverAnswer(answer: Delivery): Promise<Delivered>;
  /** Stops every process it started, but the terminals of a piece whose manifest's host lives past the app. */
  close(): Promise<void>;
}

const RUNTIME = fileURLToPath(new URL('../runtime/', import.meta.url));
const RUNNER = join(RUNTIME, 'runner.mjs');
const NODE_HOME = dirname(dirname(realpathSync(process.execPath)));
/** How long a package gets to start and register, at its conformance run and at its load. */
const LOAD_MS = 10_000;
/** How long a package gets to take a batch of events, or to answer a request on a route. */
const CALL_MS = 10_000;
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
/** Folder-safe, as extension.manifest@1 writes them. */
const ID = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/;
const VERSION = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$/;
const ROUTE = /^(GET|HEAD|POST|PUT|PATCH|DELETE) \/\S*$/;
/** An adapter's name, as adapter@1 has it: one lower-case word. */
const ADAPTER_NAME = /^[a-z][a-z0-9-]*$/;
/** The hooks deep-hook holds for the hub's reply: an adapter that maps one of a session's gates the session. */
const GATES = new Set(['PreToolUse', 'Stop']);
/** The hooks that open a turn, and the one that ends it, as deep-hook names them: the owner's lines set the turn. */
const OPENS_TURN = new Set(['UserPromptSubmit', 'PreToolUse']);
const ENDS_TURN = 'Stop';
const ENDS_SESSION = 'SessionEnd';
/** How long a kit's case may run past the deadline it gave the runner before the install counts it stuck. */
const KIT_GRACE_MS = 5_000;
const CHECK_KIND = 'check.kind@1';
/** The trusted ring's pieces beyond the kernel, which no package replaces. */
const RING = ['app-shell', 'canvas-core', 'supervisor', 'installer'];
/** The done gate's interface, which no package provides until a second gate exists and it has a slot and a kit. */
const GATE = 'gate@1';
const PUBLISHER_KEY = /^ed25519:([0-9a-f]{64})$/;
const ENVIRONMENT = 'environment@1';
/** The wiki's index slot (#355): one fill, a package's that replaces the shipped index. */
const INDEX = 'index@1';
const INDEX_NAME = /^[a-z][a-z0-9_.-]*$/;
/** An index@1 fill as the host reaches it in the package: each call answered over the package's side. */
export interface IndexFill extends SlotFill {
  slot: 'index@1';
  revision: number;
  rebuild(claims: { id: string; page: string; source: string; text: string }[]): Promise<unknown>;
  upsert(claims: { id: string; page: string; source: string; text: string }[]): Promise<unknown>;
  search(query: string): Promise<{ claim: string; page: string; quote: string; source: string }[]>;
  dropSource(source: string): Promise<unknown>;
}

interface Manifest {
  id: string; version: string; digest?: string; access?: { words: string[] }; checks?: string[]; replaces?: string[]; notices?: string[]; actions?: string[]; environments?: string[];
  provides?: { interface: string; kind: string }[]; uses?: { interface: string }[]; templates?: Template[];
  conflicts?: string[]; kernel?: string[]; publisher_key?: string; signature?: string; leases?: LeaseKind[];
  host?: { runs: 'terminals'; lives: 'past_app'; owns: 'terminals'[] };
}
/** An install: also the check kinds it holds, its own until a package that replaces one installs. */
interface Entry extends Installed { grant: { record: string[]; hosts?: HostGrant[] }; holds: string[] }
/** A session adapters bound: who bound it in order, who gates it, whether a turn runs, and the answers waiting for a route. */
interface Bound { bound: string[]; gater: string | null; inTurn: boolean; waiting: Delivery[] }
type Ask = (method: string, params: unknown) => Promise<unknown>;
/** An action a piece registered: its input schema's check, giving the failing path as that schema names it. */
interface Action { check: (input: unknown) => { ok: true } | { ok: false; path: string; code: string } }
interface Ext {
  entry: Entry;
  /** The copy of its install folder it runs from, which only the host writes. */
  folder: string;
  manifest: Manifest;
  place: 'hub' | 'sandbox';
  run: string | null;
  digest: string;
  mode: 'conformance' | 'loaded';
  /** Check kinds it registered; at its conformance run, every one it tried. */
  kinds: string[];
  /** Environments it registered (#331); at its conformance run, every one it tried. */
  environments: string[];
  subscribed: Set<string>;
  routes: Set<string>;
  /** The adapter names it registered. */
  adapters: Set<string>;
  /** The index it registered, by name, with the kit revision it declares, and how the host reaches it once loaded. */
  index?: { name: string; revision: number; fill?: IndexFill };
  /** Whether a load of these bytes runs in the hub: a release package written by no agent, with an index.ts. */
  hubBound: boolean;
  /** How to take its resolver back from the asks core, once it registered one. */
  resolverDrop?: () => void;
  /** Inside DeepBuild's signed release: its replies are text, and join first. */
  released: boolean;
  /**
   * Staged until its start finished: only then do hooks, action calls and events reach it. Cleared first when it
   * is removed, so no new call reaches it while it stops.
   */
  live: boolean;
  actions: Map<string, Action>;
  /** The outputs it provides, by interface. */
  provides: Set<string>;
  /** The output interfaces it uses. */
  uses: Set<string>;
  /** Removing it detached its users' uses: their reads through it read missing. */
  detached: boolean;
  /** Its users' reads through it under way, which its removal waits for before it stops. */
  reads: Set<Promise<unknown>>;
  /** The callers of the action calls it is serving, by the scope token each call was given. */
  scopes: Map<string, Connection>;
  /** How the host asks the running package: its in-process side, or its socket. Unset until it runs. */
  ask?: Ask;
  stop?: () => Promise<void>;
  /** A sandboxed one's run, as the supervisor's cleanup left it once stopped: its leases end only on a clean one. */
  cleaned?: Cleanup | undefined;
  /** The leases granted to this load of it: its unload ends these, never another load's under the same holder. */
  leased: string[];
  /** Set once its unload ends its leases: one granted after, to a call already under way, ends at its grant. */
  leasesEnded?: boolean;
  server?: HttpServer;
}

class Overran extends Error {}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const texts = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string');
const count = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) >= 0;
/**
 * The keywords contracts' validator checks or that annotate only, each with the value it reads; any other keyword,
 * or one whose value it would ignore, would be skipped, so passed unchecked.
 */
const CHECKED: Record<string, (v: unknown) => boolean> = {
  type: (v) => typeof v === 'string' || texts(v), properties: isPlain, required: texts, additionalProperties: (v) => typeof v === 'boolean' || isPlain(v),
  propertyNames: isPlain, items: isPlain, minItems: count, maxItems: count, minLength: count, maxLength: count,
  minimum: (v) => typeof v === 'number' && Number.isFinite(v), maximum: (v) => typeof v === 'number' && Number.isFinite(v),
  enum: texts, pattern: (v) => typeof v === 'string', format: (v) => typeof v === 'string', const: () => true, oneOf: Array.isArray,
  $ref: (v) => typeof v === 'string', $defs: isPlain, title: (v) => typeof v === 'string', description: (v) => typeof v === 'string',
};
/** What the validator reads beside $ref, oneOf or const: nothing but these. */
const ALONE = new Set(['$ref', 'oneOf', 'const', '$defs', 'title', 'description']);
/** The first rule in an action's input schema the host can't check, or undefined when it checks them all. */
function unchecked(schema: unknown, at = ''): string | undefined {
  const here = at || '/';
  if (!isPlain(schema)) return `${here} isn't a schema`;
  const s = schema;
  for (const [key, value] of Object.entries(s)) {
    if (!Object.hasOwn(CHECKED, key)) return `${here} uses ${key}`;
    if (!CHECKED[key]!(value)) return `${here} gives ${key} a value it can't use`;
  }
  if (['$ref', 'oneOf', 'const'].some((k) => k in s)) {
    const beside = Object.keys(s).find((k) => !ALONE.has(k));
    if (beside) return `${here} uses ${beside} beside $ref, oneOf or const, which is never read`;
  }
  if ('enum' in s && s.type !== 'string') return `${here} uses enum on a value that isn't text`;
  // A map is propertyNames' pattern with additionalProperties as each value's schema, and nothing else of an object.
  if ('propertyNames' in s) {
    const names = s.propertyNames as Record<string, unknown>;
    if ('properties' in s || 'required' in s) return `${here} uses properties or required on a map, which is never read`;
    if (typeof names.pattern !== 'string' || Object.keys(names).some((k) => k !== 'pattern' && !(k === 'type' && names.type === 'string'))) return `${here}/propertyNames uses more than a pattern`;
    if (!isPlain(s.additionalProperties)) return `${here} is a map without a schema for its values`;
  } else if (isPlain(s.additionalProperties)) {
    return `${here} uses additionalProperties as a schema without propertyNames`;
  }
  const children: [string, unknown][] = [
    ...Object.entries((s.properties ?? {}) as Record<string, unknown>).map(([k, v]): [string, unknown] => [`${at}/properties/${k}`, v]),
    ...Object.entries((s.$defs ?? {}) as Record<string, unknown>).map(([k, v]): [string, unknown] => [`${at}/$defs/${k}`, v]),
    ...(Array.isArray(s.oneOf) ? s.oneOf.map((v, i): [string, unknown] => [`${at}/oneOf/${i}`, v]) : []),
    ...(s.items !== undefined ? [[`${at}/items`, s.items] as [string, unknown]] : []),
    ...(isPlain(s.additionalProperties) ? [[`${at}/additionalProperties`, s.additionalProperties] as [string, unknown]] : []),
  ];
  for (const [path, child] of children) {
    const found = unchecked(child, path);
    if (found) return found;
  }
  return undefined;
}
/**
 * The part of a failing input path its schema names: the properties it lists and array indexes, cut at the first key
 * the input chose, so no name from a call reaches a refusal.
 */
function declaredPath(schema: unknown, path: string): string {
  let node = schema as Record<string, unknown> | undefined;
  let kept = '';
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    const properties = node?.properties as Record<string, unknown> | undefined;
    if (properties && Object.hasOwn(properties, key)) node = properties[key] as Record<string, unknown>;
    else if (node?.items !== undefined && /^\d+$/.test(key)) node = node.items as Record<string, unknown>;
    else return `${kept}/*`;
    kept += `/${raw}`;
  }
  return kept;
}
const message = (e: unknown): string => String((e as Error)?.message ?? e);
async function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Overran(`${what} took longer than ${ms} ms`)), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}
const nothing = (outcome: CheckResult['outcome'], failure?: string): CheckResult => ({
  outcome, testsRun: 0, evidence: [], read: [], mask: null,
  failures: failure ? [{ test: 'extension host', file: '', line: 0, stack: null, assertion: false, message: failure }] : [],
});
/** check.kind@1's outcomes. */
const OUTCOMES: readonly string[] = ['passed', 'failed', 'ran_nothing', 'missing', 'overran', 'stopped', 'uncounted'];
const strings = (v: unknown): boolean => Array.isArray(v) && v.every((s) => typeof s === 'string');
const isFailure = (f: unknown): boolean => {
  const x = f as Record<string, unknown> | null;
  return typeof x === 'object' && x !== null && typeof x.test === 'string' && typeof x.file === 'string' && Number.isInteger(x.line)
    && (x.stack === null || typeof x.stack === 'string') && typeof x.assertion === 'boolean' && typeof x.message === 'string';
};
/** A check result as check.kind@1 defines one, every field; anything else from a package is no result. */
const isResult = (r: unknown): r is CheckResult => {
  const x = r as Record<string, unknown> | null;
  return typeof x === 'object' && x !== null && OUTCOMES.includes(x.outcome as string) && Number.isInteger(x.testsRun) && (x.testsRun as number) >= 0
    && Array.isArray(x.failures) && x.failures.every(isFailure) && strings(x.evidence) && strings(x.read) && (x.mask === null || typeof x.mask === 'string');
};
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
  /** Registered adapters by name: the package that holds each and its flags. */
  private readonly adapterFills = new Map<string, { ext: Ext; caps: AdapterCaps }>();
  /** The agent sessions adapters bound, by session ID. */
  private readonly sessions = new Map<string, Bound>();
  private isReady = false;
  /** The starts of the packages loaded before ready, once ready runs. */
  private starting: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: ExtensionHostOptions) {
    this.entries = this.read('installed.json');
    // An install recorded before #351 holds the check kinds its manifest declares.
    for (const e of Object.values(this.entries)) e.holds ??= (JSON.parse(readFileSync(join(e.folder, 'deepbuild.json'), 'utf8')) as Manifest).checks ?? [];
    this.results = this.read('checked.json');
    this.keys = this.read('keys.json');
    this.runAsYou = this.read('run-as-you.json');
    this.terminals = new Terminals(options.home, options.supervisor);
  }

  private read<T>(name: string): Record<string, T> {
    const path = join(this.options.home, 'extensions', name);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, T> : {};
  }
  private save(name: string, value: unknown): void {
    const path = join(this.options.home, 'extensions', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
    renameSync(`${path}.tmp`, path);
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
      entry = { id, version, folder, digest, builtBy: from.builtBy, project, kits: [], grant: { record: [...(from.grant?.record ?? [])], ...(hosts ? { hosts } : {}) }, holds: [...(manifest.checks ?? [])] };
      // Each slot's kit runs on what it registers first: a FAIL refuses the install, and what was installed stays (#349).
      entry.kits = await this.installKits(entry, manifest as Manifest);
      // A kind it replaces is its own from now on, no longer the package's that held it (#351).
      const replaced = Object.values(this.entries).filter((e) => e.id !== id && e.holds.some((k) => manifest.replaces?.includes(k)))
        .map((e) => ({ ...e, holds: e.holds.filter((k) => !manifest.replaces!.includes(k)) }));
      this.save('installed.json', { ...this.entries, ...Object.fromEntries(replaced.map((e) => [e.id, e])), [id]: entry });
      for (const e of replaced) this.entries[e.id]!.holds = e.holds;
    } catch (e) {
      rmSync(folder, { recursive: true, force: true });
      throw e;
    }
    this.entries[id] = entry;
    // A signed package's key is trusted on first use.
    if (manifest.publisher_key !== undefined && this.keys[id] === undefined) {
      this.keys = { ...this.keys, [id]: manifest.publisher_key };
      this.save('keys.json', this.keys);
    }
    if (before) rmSync(before.folder, { recursive: true, force: true });
    // The copy running is the install before: it stops, after any load of it under way.
    await this.serial(id, async () => {
      const running = this.exts.get(id);
      if (running && running.entry !== entry) await this.unload(running);
    });
    return this.installedOf(entry);
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
    for (const e of others) {
      const theirs = JSON.parse(readFileSync(join(e.folder, 'deepbuild.json'), 'utf8')) as Manifest;
      if (m.conflicts?.includes(e.id) || theirs.conflicts?.includes(id)) throw Error(`${id} conflicts with ${e.id}, which is installed; remove one to install the other`);
    }
    // A user-level package's kinds are in use in every project; a project's, only in its own.
    const overlaps = (e: Entry): boolean => e.project === null || project === null || e.project === project;
    for (const kind of m.checks ?? []) {
      const holder = others.find((e) => e.holds.includes(kind) && overlaps(e));
      if (holder && !replaces.includes(kind)) throw Error(`${id} registers the check kind ${kind}, which ${holder.id} holds, and doesn't declare that it replaces it`);
    }
    const published = frozenDigests();
    for (const contract of m.kernel ?? []) if (!Object.hasOwn(published, contract)) throw Error(`${id} runs on the kernel contract ${contract}, which this kernel doesn't publish`);
  }
  async trustKey(connection: Connection, id: string, key: string): Promise<void> {
    if (connection.writer !== 'app' && connection.writer !== 'cli') throw Error(`a publisher key is trusted only by your answer on the trusted path, the app or the CLI, not by ${connection.writer}`);
    if (!PUBLISHER_KEY.test(key)) throw Error(`${key} isn't a publisher key: ed25519:<64 lower-case hex>`);
    this.keys = { ...this.keys, [id]: key };
    this.save('keys.json', this.keys);
  }
  /** Only you approve or revoke run-as-you: the app, or the CLI outside any agent's session once the OS confirms you. */
  private trustedPath(connection: Connection, what: string): void {
    if ((connection.writer !== 'app' && connection.writer !== 'cli') || connection.session !== undefined) {
      throw Error(`${what} only on your trusted path, the app or the CLI, not by ${connection.writer}${connection.session ? ` in session ${connection.session}` : ''}`);
    }
  }
  async approve(connection: Connection, id: string, word: 'run_as_you'): Promise<void> {
    this.trustedPath(connection, `${RUN_AS_YOU} is approved`);
    const entry = this.entries[id];
    if (!entry) throw Error(`${id} isn't installed`);
    const manifest = JSON.parse(readFileSync(join(entry.folder, 'deepbuild.json'), 'utf8')) as Manifest;
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
    await Promise.all(owned.map((t) => this.terminals.stop(t)));
  }
  async rawInput(connection: Connection, terminal: string, text: string): Promise<void> {
    if (connection.writer !== 'app' && this.options.plant !== 'input-from-any-writer') {
      throw Error(`raw input for ${terminal} comes only from the panel you focused in the app, not from ${connection.writer}${connection.session ? ` in session ${connection.session}` : ''}`);
    }
    this.terminals.input(terminal, text);
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
   * reach), and a BLOCKED one doesn't install. A package that declares nothing to kit runs no code at install.
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
    // No package code runs in the hub before it is ready (#348): a kit that needs to is BLOCKED, so the install is.
    if (hub && indexed && !this.isReady) {
      rmSync(folder, { recursive: true, force: true });
      throw Error(`BLOCKED: ${entry.id} replaces ${INDEX}, whose kit runs its code in the hub, and the hub isn't ready; install it once it is`);
    }
    if (hub && (kitted.length || environments.length) && !this.isReady) {
      rmSync(folder, { recursive: true, force: true });
      throw Error(`BLOCKED: ${entry.id} ${what}, whose ${kits} run${kitted.length && environments.length ? '' : 's'} its code in the hub, and the hub isn't ready; install it once it is`);
    }
    if (!hub && (kitted.length || environments.length)) {
      // The kits' suites and stacks run where the sandbox can't reach: unrun, the package doesn't install.
      rmSync(folder, { recursive: true, force: true });
      throw Error(`BLOCKED: ${entry.id} ${what}, and ${kits} can't run on a package the sandbox will run; only a release package written by no agent replaces a shipped kind or ships an environment`);
    }
    if (!kitted.length && !environments.length && !indexed) {
      rmSync(folder, { recursive: true, force: true });
      return declared.map((kind) => ({ slot: CHECK_KIND, fill: kind, verdict: 'BLOCKED' as const }));
    }
    const ext = this.ext(entry, folder, manifest, digest, hub ? 'hub' : 'sandbox', 'conformance');
    const runs: KitRun[] = [];
    try {
      await this.start(ext);
      const kit = slotKits().find((k) => k.slot === CHECK_KIND) as SlotKit<CheckRunnerFill> | undefined;
      if (!kit) throw Error(`the conformance package ships no ${CHECK_KIND} kit`);
      for (const kind of [...ext.kinds, ...declared.filter((k) => !ext.kinds.includes(k))]) {
        if (!replaces.includes(kind) || !ext.kinds.includes(kind)) { runs.push({ slot: CHECK_KIND, fill: kind, verdict: 'BLOCKED' }); continue; }
        // A runner that never answers can't hang the install: past a case's deadline and a grace its run is refused,
        // and so is every case after it, at once, so the kit's remaining cases don't each wait their deadline out.
        let stuck: string | null = null;
        const run = async (spec: CheckSpec, ctx: { deadline: number }): Promise<CheckResult> => {
          if (stuck) throw Error(stuck);
          try {
            return await within(ctx.deadline + KIT_GRACE_MS, `${entry.id}'s ${kind} at install`, ext.ask!('run', { type: kind, spec, ctx }) as Promise<CheckResult>);
          } catch (e) {
            if (e instanceof Overran) stuck = message(e);
            throw e;
          }
        };
        const fill: CheckRunnerFill = { slot: CHECK_KIND, revision: kit.revision, kind, run };
        const report = await runKit(kit, fill, { parts: ['fixed'] });
        runs.push({ slot: CHECK_KIND, fill: kind, verdict: report.verdict });
        const failed = report.cases.find((c) => c.outcome !== 'PASS');
        if (report.verdict !== 'PASS') throw Error(`${entry.id}'s ${kind} reads ${report.verdict} on ${CHECK_KIND}'s kit${failed ? ` at ${failed.id}: ${failed.message}` : ''}; it isn't installed`);
      }
      // Each environment the manifest declares: the kit brings it up on a lease and a checkout of the kit's own and
      // takes it down, through the package's up and down. One the package didn't register by the time its load
      // returned is BLOCKED, unrun, and refuses the install: a registration that came later would fill the slot unkitted.
      const envKit = environments.length ? slotKits().find((k) => k.slot === ENVIRONMENT) as SlotKit<EnvironmentFill> | undefined : undefined;
      if (environments.length && !envKit) throw Error(`the conformance package ships no ${ENVIRONMENT} kit`);
      for (const name of environments) {
        if (!ext.environments.includes(name)) throw Error(`BLOCKED: ${entry.id} declares the environment ${name} and didn't register it at install, so ${ENVIRONMENT}'s kit couldn't run; it isn't installed`);
        // The kit takes a promise from either step and bounds it; a handle is what the package's up answered with.
        const up = (spec: EnvironmentSpec, lease: EnvironmentLease, checkout: string): Promise<unknown> => ext.ask!('env.up', { name, spec, lease, checkout });
        const down = (handle: EnvironmentHandle): Promise<unknown> => ext.ask!('env.down', { name, handle });
        const fill = { slot: ENVIRONMENT, revision: envKit!.revision, up, down } as unknown as EnvironmentFill;
        const report = await runKit(envKit!, fill, { parts: ['fixed'] });
        runs.push({ slot: ENVIRONMENT, fill: name, verdict: report.verdict });
        const failed = report.cases.find((c) => c.outcome !== 'PASS');
        if (report.verdict !== 'PASS') throw Error(`${entry.id}'s environment ${name} reads ${report.verdict} on ${ENVIRONMENT}'s kit${failed ? ` at ${failed.id}: ${failed.message}` : ''}; it isn't installed`);
      }
      if (indexed) {
        const kit = slotKits().find((k) => k.slot === INDEX) as SlotKit<IndexFill> | undefined;
        if (!kit) throw Error(`the conformance package ships no ${INDEX} kit`);
        if (!ext.index) throw Error(`${entry.id} replaces ${INDEX}, but its code registered no index; it isn't installed`);
        const report = await runKit(kit, this.indexFill(ext), { parts: ['fixed'] });
        runs.push({ slot: INDEX, fill: ext.index.name, verdict: report.verdict });
        const failed = report.cases.find((c) => c.outcome !== 'PASS');
        if (report.verdict !== 'PASS') throw Error(`${entry.id}'s index ${ext.index.name} reads ${report.verdict} on ${INDEX}'s kit${failed ? ` at ${failed.id}: ${failed.message}` : ''}; it isn't installed`);
      }
    } finally {
      await ext.stop?.();
      rmSync(folder, { recursive: true, force: true });
    }
    return runs;
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
      manifest = JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as Manifest;
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
  /** Conformance's run of the package's code: it registers in the platform sandbox without throwing, and only the check kinds its manifest declares. */
  private async registers(entry: Entry, folder: string, manifest: Manifest, digest: string): Promise<string[]> {
    const ext = this.ext(entry, folder, manifest, digest, 'sandbox', 'conformance');
    try {
      await this.start(ext);
    } catch (e) {
      return [`its code didn't register in the platform sandbox: ${message(e)}`];
    } finally {
      await ext.stop?.();
    }
    const declared = manifest.checks ?? [];
    const environments = manifest.environments ?? [];
    return [
      ...ext.kinds.filter((k) => !declared.includes(k)).map((k) => `it registers the check kind ${k}, which its manifest doesn't declare`),
      ...ext.environments.filter((e) => !environments.includes(e)).map((e) => `it registers the environment ${e}, which its manifest doesn't declare`),
    ];
  }
  private ext(entry: Entry, folder: string, manifest: Manifest, digest: string, place: Ext['place'], mode: Ext['mode']): Ext {
    const released = this.options.release.some((r) => r.id === entry.id && r.version === entry.version && r.digest === digest);
    return {
      entry, folder, manifest, digest, place, mode, run: place === 'sandbox' ? `run:${ulid(this.options.now())}` : null, kinds: [], environments: [], subscribed: new Set(), routes: new Set(),
      released: released && place === 'hub', live: false, actions: new Map(), provides: new Set(), uses: new Set(), detached: false, reads: new Set(), scopes: new Map(),
      adapters: new Set(), leased: [], hubBound: this.hubBound(entry, folder, digest),
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
    const manifest = JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as Manifest;
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
    const index = join(ext.folder, 'index.ts');
    const params = {
      ...(ext.place === 'sandbox' && existsSync(index) ? { source: stripTypeScriptTypes(readFileSync(index, 'utf8')) } : {}),
      ...(this.options.plant === 'piece-writes-input' ? { planted: ['deep.terminal.write'] } : {}),
    };
    if (ext.place === 'hub') {
      const url = `${pathToFileURL(index).href}?digest=${ext.digest.slice(3)}`;
      ext.ask = extensionSide((method, params, scope) => this.dispatch(ext, method, params, scope), async (deep) => {
        const code = (await import(url)) as { default: (deep: unknown) => unknown };
        await code.default(deep);
      }).serve;
    } else {
      await this.sandboxed(ext);
    }
    await within(LOAD_MS, `${ext.entry.id}'s registering`, ext.ask!('load', params));
    // Its handlers, actions and outputs publish only now that it started, and only while it's still the one loaded.
    if (ext.mode === 'loaded' && this.exts.get(ext.entry.id) === ext && ext.ask) ext.live = true;
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
    const output: string[] = [];
    const keep = (chunk: Buffer): void => { if (output.length < 64) output.push(chunk.toString('utf8')); };
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
      const connected = new Promise<Socket>((resolve) => server.once('connection', resolve));
      const started = await supervisor.start({
        run, argv: [process.execPath, RUNNER, path, folder, entry], cwd: folder, inherit: false, env: { PATH: '/usr/bin:/bin', HOME: folder },
        grant: { read: [NODE_HOME, RUNTIME, ...(entry === 'main' ? interpreter(folder) : [])], sockets: [path] }, output: { stdout: keep, stderr: keep },
      });
      if (started.status !== 'started') throw Error(`the sandbox held it: BLOCKED on ${started.kind}`);
      // Stoppable from here on: an unload while it connects, at close or a revoke, ends its process.
      ext.stop = async () => { ext.cleaned = await supervisor.cleanup(run).catch(() => undefined); };
      // What it printed is the package's own words: only a release package's reach the refusal, and the hub's log.
      const early = supervisor.wait(run).then((exit) => Promise.reject(Error(`it exited (${exit.code ?? exit.signal}) before it connected${ext.released ? `: ${output.join('').trim()}` : ''}`)));
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
  /** Whether its project's trust was revoked since it loaded: then it is unloaded, its routes and process gone. */
  private async revoked(ext: Ext): Promise<boolean> {
    if (!ext.entry.project || (await this.options.trust.trusted(ext.entry.project))) return false;
    await this.unload(ext);
    return true;
  }
  /**
   * Every removal, a disable, a new install, a revoke, close or its connection gone: new calls stop, its users' uses
   * detach and their reads under way finish, then its handlers stop.
   */
  private async unload(ext: Ext): Promise<void> {
    ext.live = false;
    ext.detached = true;
    if (this.exts.get(ext.entry.id) === ext) this.exts.delete(ext.entry.id);
    ext.resolverDrop?.();
    delete ext.resolverDrop;
    for (const name of ext.adapters) {
      if (this.adapterFills.get(name)?.ext !== ext) continue;
      this.adapterFills.delete(name);
      // The sessions it bound forget it; one it gated has no owner until an adapter gates it again, and its answers wait.
      for (const b of this.sessions.values()) {
        b.bound = b.bound.filter((n) => n !== name);
        if (b.gater === name) b.gater = null;
      }
    }
    // Its routes close with the other ways in, before the drain.
    await this.turnOff(ext.entry.id, ext);
    await Promise.all([...ext.reads].map((r) => r.catch(() => undefined)));
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
      const ended = await this.options.record.raw(`SELECT id FROM events WHERE kind = 'process.ended' AND json_extract(data, '$.run') = '${ext.run}' ORDER BY log_pos`);
      proof = (ended as { id: string }[]).map((e) => e.id);
    }
    for (const id of ids) await table.release(id, proof);
  }
  /** Its handlers stop: nothing more is asked of it, and a sandboxed one's process ends. */
  private async stopHandlers(ext: Ext): Promise<void> {
    delete ext.ask;
    await ext.stop?.();
  }

  async disable(id: string): Promise<void> {
    await this.serial(id, async () => {
      const ext = this.exts.get(id);
      if (!ext) return;
      // AC9's wrong program: its handlers stop while it's still published and its users still read through it.
      if (this.options.plant === 'stop-provider-first') {
        await this.stopHandlers(ext);
        await sleep(200);
      }
      await this.unload(ext);
    });
  }

  /** A package's call, checked here against its grant before anything else of it. */
  private dispatch(ext: Ext, method: string, params: unknown, scope?: string): Promise<unknown> {
    const call = this.dispatchNow(ext, method, params, scope);
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
    if (ext.mode === 'loaded' && (await this.revoked(ext))) throw Error(`${method}: ${id}'s project is no longer trusted, so it was stopped`);
    // Unloaded while trust answered, by a new install, a revoke or close: the call does nothing.
    if (ext.mode === 'loaded' && this.exts.get(id) !== ext) throw Error(`${method}: ${id} was unloaded`);
    const conformance = ext.mode === 'conformance';
    const quiet = (): void => { if (conformance) throw Error(`${method}: nothing reaches the record while conformance runs`); };
    switch (method) {
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
        if (!ext.entry.grant.record.includes(kind)) {
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
      case 'deep.registerAdapter': {
        const [name, adapter] = args;
        if (typeof name !== 'string' || !ADAPTER_NAME.test(name)) throw Error(`deep.registerAdapter takes the adapter's name first, one lower-case word, not ${JSON.stringify(name)}`);
        const a = adapter as Record<string, unknown> | null;
        if (typeof a !== 'object' || a === null) throw Error(`deep.registerAdapter: ${name}'s adapter is an object with its facts, caps and unsupported data`);
        // Held to the adapter contract here, every flag present: the host routes by these flags, never by the name.
        for (const [schema, field] of [['adapter.facts@1', 'facts'], ['adapter.caps@1', 'caps'], ['adapter.unsupported@1', 'unsupported']] as const) {
          const held = validate(schema, a[field]);
          if (!held.ok) throw Error(`deep.registerAdapter: ${name}'s ${field} fails ${schema} at ${held.issues[0]!.path || '/'}: ${held.issues[0]!.remediation}`);
        }
        if (!conformance) {
          const taken = this.adapterFills.get(name);
          if (taken && taken.ext !== ext) throw Error(`the adapter ${name} is already registered by ${taken.ext.entry.id}`);
          this.adapterFills.set(name, { ext, caps: structuredClone(a.caps) as AdapterCaps });
        }
        ext.adapters.add(name);
        return null;
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
      case 'deep.registerRoute': {
        const [route] = args;
        if (typeof route !== 'string' || !ROUTE.test(route)) throw Error(`deep.registerRoute takes "<METHOD> <path>", not ${JSON.stringify(route)}`);
        // Registering opens nothing: a route is served only once you turn the package on and choose it.
        ext.routes.add(route);
        return null;
      }
      case 'deep.record.append': {
        quiet();
        const writing = this.options.plant === 'first-party-appends-every-kind' && ext.place === 'hub' ? { ...connection, writer: 'core' } : connection;
        await this.options.record.append(writing, args[0] as EventInput);
        return null;
      }
      case 'deep.registerAction': {
        const [name, declared] = args as [unknown, { declares?: unknown; input?: unknown } | undefined];
        if (typeof name !== 'string' || !(ext.manifest.actions ?? []).includes(name)) throw Error(`deep.registerAction: ${String(name)} isn't an action ${id}'s manifest declares`);
        if (!['read', 'change', 'send'].includes(declared?.declares as string)) throw Error(`deep.registerAction: ${name} declares read, change or send`);
        const input = declared!.input;
        if (typeof input !== 'object' || input === null || Array.isArray(input)) throw Error(`deep.registerAction: ${name} gives its input's JSON Schema`);
        const skipped = unchecked(input);
        if (skipped) throw Error(`deep.registerAction: ${name}'s input schema has a rule the host can't check: ${skipped}`);
        const schemas = registry([{ name, schema: input as Schema }]);
        const check: Action['check'] = (value) => {
          const held = schemas.validate(name, value);
          return held.ok ? held : { ok: false, path: declaredPath(input, held.issues[0]!.path), code: held.issues[0]!.code };
        };
        // A schema that can't be read refuses the registration, not the first call.
        schemas.validate(name, {});
        ext.actions.set(name, { check });
        return null;
      }
      case 'deep.provide': {
        const [name, kind] = args;
        if (!(ext.manifest.provides ?? []).some((p) => p.interface === name && p.kind === kind)) throw Error(`deep.provide: ${String(name)} isn't a ${String(kind)} ${id}'s manifest provides`);
        ext.provides.add(name as string);
        return null;
      }
      case 'deep.use': {
        const [name] = args;
        if (!(ext.manifest.uses ?? []).some((u) => u.interface === name)) throw Error(`deep.use: ${String(name)} isn't an interface ${id}'s manifest uses`);
        ext.uses.add(name as string);
        return null;
      }
      case 'deep.read':
        quiet();
        return this.readUse(ext, args[0]);
      case 'deep.fetch':
        quiet();
        return this.fetch(ext, args[0], connection);
      case 'deep.record.query':
        quiet();
        return this.query(ext, args[0]);
      case 'deep.lease':
        quiet();
        return this.lease(ext, args[0], args[1]);
      // Hosted terminals (#104): what runs is the piece's own, under run-as-you, and never at its conformance run.
      case 'deep.terminal.open': {
        if (conformance) throw Error(`${method}: nothing runs while conformance runs`);
        const t = await this.terminals.open(id, args[0] as OpenSpec, ext.manifest.host?.lives === 'past_app');
        return { terminal: t.terminal, run: t.run, pid: t.pid };
      }
      case 'deep.terminal.list':
        return this.terminals.of(id).map((t) => ({ terminal: t.terminal, run: t.run, pid: t.pid, title: t.title }));
      case 'deep.terminal.read':
        return this.terminals.read(id, args[0] as string, args[1] as number);
      case 'deep.terminal.write':
        return void this.terminals.input(args[0] as string, args[1] as string);
      case 'deep.notices.send': {
        quiet();
        const readings = (args[0] as { readings?: unknown } | undefined)?.readings;
        const notice = `notice:${ulid(this.options.now())}`;
        const now = this.options.now();
        await this.options.record.append(connection, {
          v: 1, id: ulid(now), kind: 'notice.sent', ts: now, data: { notice, cites: Array.isArray(readings) ? readings : [] },
        });
        return notice;
      }
      default:
        throw Error(`${method} isn't wired into this host yet`);
    }
  }
  /** The record its grant names, filtered here before anything crosses to the package. */
  private async query(ext: Ext, filter: unknown): Promise<unknown[]> {
    const asked = (filter as { kinds?: unknown } | undefined)?.kinds;
    const grant = ext.entry.grant.record;
    const kinds = new Set(Array.isArray(asked) ? grant.filter((k) => asked.includes(k)) : grant);
    const found: unknown[] = [];
    if (!kinds.size) return found;
    for (let after = 0; ;) {
      // Only the granted kinds are read: the rest of the log is never decoded.
      const page = await this.options.record.read({ after, limit: PAGE, kinds: [...kinds] });
      for (const e of page) if (kinds.has(e.kind)) found.push(JSON.parse(toJson(e)));
      if (page.length < PAGE) return found;
      after = page[page.length - 1]!.log_pos;
    }
  }
  private kindOwner(kind: string): Ext | undefined {
    for (const ext of this.exts.values()) if (ext.kinds.includes(kind)) return ext;
    return undefined;
  }
  private environmentOwner(name: string): Ext | undefined {
    for (const ext of this.exts.values()) if (ext.environments.includes(name)) return ext;
    return undefined;
  }

  /** A read through a use: the installed provider's value, or missing once none provides it or its removal detached it. */
  private async readUse(ext: Ext, name: unknown): Promise<unknown> {
    const id = ext.entry.id;
    if (typeof name !== 'string' || !ext.uses.has(name)) throw Error(`deep.read: ${String(name)} isn't an interface ${id} uses`);
    // Only a provider that started: an output publishes once its piece is ready, like its handlers and actions.
    const provider = [...this.exts.values()].find((p) => p !== ext && p.live && p.provides.has(name) && !p.detached);
    if (!provider) return { missing: true };
    const edge = `${id} uses ${name} from ${provider.entry.id}`;
    if (!provider.ask) throw Error(`the edge ${edge}: ${provider.entry.id} stopped while ${id} still used it`);
    const reading = within(CALL_MS, `the edge ${edge}`, provider.ask('output', { name }));
    provider.reads.add(reading);
    try {
      return { value: await reading };
    } finally {
      provider.reads.delete(reading);
    }
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
    const answer = await globalThis.fetch(url!, {
      method: typeof r.method === 'string' ? r.method : 'GET', headers, ...(typeof r.body === 'string' ? { body: r.body } : {}),
      // A redirect would reach a host the grant may not name.
      redirect: 'manual', signal: AbortSignal.timeout(CALL_MS),
    });
    // Read up to the cap, never all of it: an answer past it fails, and the package gets none of it.
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of answer.body ?? []) {
      size += chunk.byteLength;
      // Leaving the loop cancels the rest of the stream.
      if (size > ANSWER) throw Error(`deep.fetch: ${grant.host}'s answer is over ${ANSWER} bytes`);
      chunks.push(chunk);
    }
    return { status: answer.status, body: Buffer.concat(chunks).toString('utf8') };
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
        if (await within(left(), `${id}'s trust check`, this.revoked(ext))) return fail(`${id}'s project is no longer trusted, so it was stopped`);
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

  async callAction(call: ActionCall): Promise<ActionResult> {
    const refuse = (reason: string): ActionResult => ({ status: 'refused', reason });
    const { action, target, caller } = call;
    const id = /^ext:(.+)$/.exec(target?.handle ?? '')?.[1];
    const ext = id === undefined ? undefined : this.exts.get(id);
    if (!ext || !ext.live || !ext.ask) return refuse(`${target?.handle} names no piece that is loaded and started`);
    // The target names its version: a call meant for another one, a removed or never-active version, runs nothing.
    if (ext.entry.version !== target.version) return refuse(`${target.handle}@${target.version} is a stale target: the version active is ${ext.entry.version}`);
    if (await this.revoked(ext)) return refuse(`${id}'s project is no longer trusted, so it was stopped`);
    // Removed while trust answered: new calls stopped first, so this one runs nothing.
    if (this.exts.get(ext.entry.id) !== ext || !ext.live || !ext.ask) return refuse(`${target.handle} was removed before ${action} could run`);
    const declared = ext.actions.get(action);
    if (!declared) return refuse(`${id} registered no action ${action}`);
    const held = declared.check(call.input);
    if (!held.ok) {
      await this.refused(caller, action, 'schema', `${action}'s input at ${held.path || '/'}: ${held.code}`, [{ action, target, input: call.input }]);
      return refuse(`${action}'s input fails its schema at ${held.path || '/'} (${held.code})`);
    }
    const scope = randomUUID();
    ext.scopes.set(scope, caller);
    let output: unknown;
    try {
      output = await within(CALL_MS, `${id}'s ${action}`, ext.ask('action', { name: action, input: call.input, ctx: { target: { handle: target.handle, version: target.version } }, scope }));
    } catch (e) {
      // An error's text is the package's own words: only a release package's reaches its caller.
      return refuse(`${id}'s ${action} failed${ext.released ? `: ${message(e)}` : ''}`);
    } finally {
      ext.scopes.delete(scope);
    }
    // Removed while it ran: what it returns reaches no one, and nothing it does later goes through its replacement.
    if (this.exts.get(ext.entry.id) !== ext || !ext.live) return refuse(`${id}@${target.version} was removed while ${action} ran`);
    return { status: 'done', output };
  }

  async loaded(): Promise<Loaded[]> {
    return [...this.exts.values()].map((ext) => this.loadedOf(ext));
  }
  async checks(): Promise<{ kind: string; extension: string }[]> {
    return [...this.exts.values()].flatMap((ext) => ext.kinds.map((kind) => ({ kind, extension: ext.entry.id })));
  }
  hooks(): string[] {
    return [...new Set([...this.exts.values()].flatMap((ext) => [...ext.subscribed]))].sort();
  }
  async runCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number }): Promise<CheckResult> {
    const ext = this.kindOwner(kind);
    if (!ext?.ask || (await this.revoked(ext))) return nothing('missing', `no loaded extension registered the check kind ${kind}`);
    try {
      const result = await this.ask(ext, ctx.deadline, kind, 'run', { type: kind, spec, ctx });
      if (!isResult(result)) return nothing('failed', `${ext.entry.id}'s ${kind} returned no check result as check.kind@1 defines one`);
      // A passed run rests on the tests it counted: passed with none counted ran nothing it can vouch for.
      if (result.outcome === 'passed' && result.testsRun === 0) return nothing('ran_nothing', `${ext.entry.id}'s ${kind} reported passed without its results: it counted no test`);
      return result;
    } catch (e) {
      if (e instanceof Overran) return nothing('overran', `${ext.entry.id}'s ${kind} ran past its deadline of ${ctx.deadline} ms${ext.place === 'sandbox' ? ', and was stopped' : ''}`);
      throw e;
    }
  }
  async deliver(events: Event[]): Promise<void> {
    const failed: string[] = [];
    await Promise.all([...this.exts.values()].filter((ext) => ext.live).map(async (ext) => {
      const mine = events.filter((e) => ext.subscribed.has(e.kind)).map((e) => JSON.parse(toJson(e)) as unknown);
      if (!mine.length) return;
      if (!ext.ask || (await this.revoked(ext))) return void failed.push(`${ext.entry.id}: it stopped, its project no longer trusted or unloaded`);
      await this.ask(ext, CALL_MS, 'events', 'deliver', { events: mine }).catch((e) => failed.push(`${ext.entry.id}: ${message(e)}`));
    }));
    if (failed.length) throw Error(`not every subscribed package took the events: ${failed.join('; ')}`);
  }
  private async hookLine(line: HookRequestLine): Promise<{ adapter: string; events: { kind: string }[] }> {
    const name = line.agent;
    const fill = this.adapterFills.get(name);
    // An adapter counts once its package started (live), as a hook handler or an action does; never one a start still running registered.
    if (!fill?.ext.live || !fill.ext.ask || (await this.revoked(fill.ext))) throw Error(`no loaded extension registered an adapter ${name}`);
    const mapped = await this.ask(fill.ext, CALL_MS, `adapter ${name}`, 'adapter.mapHook', { name, request: line, version: 'hook.request@2' }) as { events?: unknown } | null;
    const events = (Array.isArray(mapped?.events) ? mapped.events : []).flatMap((e: unknown) => (typeof (e as { kind?: unknown })?.kind === 'string' ? [{ kind: (e as { kind: string }).kind }] : []));
    const session = (line.payload as { session_id?: unknown } | null)?.session_id;
    // An adapter binds a session the first time a line it maps names it, and gates it when it maps one of the
    // session's gates: the hook deep-hook held, as the line names it, never a kind the adapter's own mapping returned.
    if (typeof session === 'string' && session && events.length) {
      const b = this.sessions.get(session) ?? this.sessions.set(session, { bound: [], gater: null, inTurn: false, waiting: [] }).get(session)!;
      if (!b.bound.includes(name)) b.bound.push(name);
      if (b.gater === null && GATES.has(line.event)) b.gater = name;
      // Only the owner's lines set the turn and open routes: an adapter that relays can't steer another's delivery.
      if (this.owners(b).includes(name)) {
        if (OPENS_TURN.has(line.event)) b.inTurn = true;
        if (line.event === ENDS_TURN) b.inTurn = false;
        if (line.event === ENDS_TURN) await this.flush(session, b, 'hold');
        if (line.event === ENDS_TURN) await this.flush(session, b, 'wake');
        if (line.event === 'UserPromptSubmit') await this.flush(session, b, 'prompt');
        if (OPENS_TURN.has(line.event)) await this.flush(session, b, 'steer');
      }
    }
    // The session ends with its owner's SessionEnd line, mapped to an event or not, or with any binder's while no
    // adapter gates it. An answer still waiting then has no route left: the session is forgotten, and the hook
    // rejects naming each, never silently.
    const b = typeof session === 'string' ? this.sessions.get(session) : undefined;
    if (b && line.event === ENDS_SESSION && (this.owners(b).includes(name) || (b.gater === null && b.bound.includes(name)))) {
      this.sessions.delete(session as string);
      if (b.waiting.length) throw Error(`session ${session} ended with ${b.waiting.length} answer(s) waiting for a route that never opened: ${b.waiting.map((w) => w.ask).join(', ')}`);
    }
    return { adapter: name, events };
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
    return [...this.adapterFills].map(([name, { ext, caps }]) => ({ name, extension: ext.entry.id, caps: structuredClone(caps) }));
  }
  /** The adapters that deliver to a session: the one that gates it, none before one does, or every one under the planted twins. */
  private owners(b: Bound): string[] {
    if (this.options.plant === 'both-adapters-deliver') return [...b.bound];
    if (this.options.plant === 'first-to-bind-owns') return b.bound.slice(0, 1);
    return b.gater !== null ? [b.gater] : [];
  }
  async owner(session: string): Promise<{ adapter: string } | null> {
    const b = this.sessions.get(session);
    const [adapter] = b ? this.owners(b) : [];
    return adapter === undefined ? null : { adapter };
  }
  /** The route an adapter's flags allow now: into a running turn only with `steer`, an idle session only with `wakeIdle`; else none, and the answer waits. */
  private routeNow(caps: AdapterCaps, inTurn: boolean): Route | null {
    if (inTurn && caps.steer) return 'steer';
    if (!inTurn && caps.wakeIdle) return 'wake';
    return null;
  }
  /** Whether the route a line opened takes an answer through an adapter with these flags. */
  private opens(caps: AdapterCaps, route: Route): boolean {
    return route === 'prompt' || (route === 'hold' && caps.holdStop) || (route === 'steer' && caps.steer) || (route === 'wake' && caps.wakeIdle);
  }
  async deliverAnswer(answer: Delivery): Promise<Delivered> {
    const session = answer.session;
    const b = this.sessions.get(session);
    if (!b) throw Error(`no adapter bound session ${session}, so its answer ${answer.ask} has no way to it`);
    const owners = this.owners(b);
    // No adapter gates it yet: the answer waits for the one that will. Held names the adapter it waits on: the owner,
    // else the first still bound, else the empty name when every binder was unloaded.
    const held: Delivered = { status: 'held', session, adapter: owners[0] ?? b.bound[0] ?? '' };
    if (!owners.length) {
      b.waiting.push(answer);
      return held;
    }
    let out: Delivered | undefined;
    for (const name of owners) {
      const fill = this.adapterFills.get(name);
      if (!fill) throw Error(`the adapter ${name} that owns session ${session} is no longer registered`);
      let route = this.routeNow(fill.caps, b.inTurn);
      // A delivery that fails leaves the answer waiting for the next route, as flush does: never dropped unheard.
      if (route) await this.deliverVia(fill, name, answer, route).catch(() => { route = null; });
      if (!route && !b.waiting.includes(answer)) b.waiting.push(answer);
      out ??= route ? { status: 'delivered', session, adapter: name, route } : held;
    }
    return out!;
  }
  /**
   * Delivers the answers waiting for the session through the route the owner's line just opened, each once, through
   * each owner whose flags take that route. One whose delivery fails stays waiting, and the hook that opened the
   * route rejects naming the adapter; nothing is dropped unheard.
   */
  private async flush(session: string, b: Bound, route: Route): Promise<void> {
    const owners = this.owners(b).flatMap((name) => { const fill = this.adapterFills.get(name); return fill && this.opens(fill.caps, route) ? [{ name, fill }] : []; });
    if (!owners.length || !b.waiting.length) return;
    const failed: string[] = [];
    for (const answer of [...b.waiting]) {
      b.waiting = b.waiting.filter((w) => w !== answer);
      for (const { name, fill } of owners) {
        try {
          await this.deliverVia(fill, name, answer, route);
        } catch (e) {
          if (!b.waiting.includes(answer)) b.waiting.push(answer);
          failed.push(`${name} didn't take ${answer.ask} by ${route}: ${message(e)}`);
        }
      }
    }
    if (failed.length) throw Error(`session ${session}'s waiting answers weren't all delivered: ${failed.join('; ')}`);
  }
  private async deliverVia(fill: { ext: Ext; caps: AdapterCaps }, name: string, answer: Delivery, route: Route): Promise<void> {
    if (!fill.ext.live || !fill.ext.ask || (await this.revoked(fill.ext))) throw Error(`the adapter ${name}'s package stopped, so ${answer.ask} wasn't delivered`);
    await this.ask(fill.ext, CALL_MS, `adapter ${name}'s delivery`, 'adapter.deliver', { name, answer, session: answer.session, route });
  }

  async ready(): Promise<void> {
    if (this.isReady) return this.starting;
    this.isReady = true;
    this.starting = (async () => {
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Starts, loads and conformance runs under way finish first, each then unloaded here, so none leaves a process behind.
    await this.starting.catch(() => undefined);
    await Promise.all([...this.loading.values(), ...[...this.checking].map((c) => c.catch(() => undefined))]);
    for (const ext of [...this.exts.values()]) await this.unload(ext);
    // A call that was under way finishes, or finds its package unloaded, before close returns.
    await Promise.all(this.calls);
    // A terminal that lives past the app runs on, its run kept by the supervisor; AC1's wrong program stops them all.
    const stopping = this.terminals.all().filter((t) => !t.kept || this.options.plant === 'close-stops-every-host');
    await Promise.all(stopping.map((t) => this.terminals.stop(t).catch(() => undefined)));
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
  return new Host(options);
}
