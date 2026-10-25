// The extension host (#348). A TypeScript package inside DeepBuild's signed release, written by no agent, loads in
// the hub's own process; every other package, whoever wrote it, loads in the platform sandbox, out of process,
// started through the supervisor (host@1), and speaks JSON-RPC with the host over a socket of its own. Nothing loads
// before its conformance passed on the files it has now, or before you trust its project; no package code runs
// before the hub is ready; every call is checked against the package's grant here, in the host, never in the
// package; and inbound traffic reaches a package only through routes you chose when you turned it on.
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CheckResult, CheckSpec } from '@deepbuild/conformance';
import { canonicalize, checkManifest, registry, sha256Hex, type HookContribution, type JoinedHookReply, type JsonValue, type Schema } from '@deepbuild/contracts';
import { toJson, ulid, type Connection, type Event, type EventInput, type RecordStore } from '@deepbuild/record';
import type { Supervisor } from '@deepbuild/supervisor';
import { API, extensionSide, peer } from '../runtime/deep.mjs';
import { packageDigest } from './digest.js';
import { checkReply, join as joinReplies, type JoinPlant, type Template } from './replies.js';
import type { ProjectTrust } from './trust.js';

/** A package inside DeepBuild's signed release, as the release's signed manifest lists it. */
export interface ReleaseEntry { id: string; version: string; digest: string }
/** The planted wrong programs the criteria name, selected per host; tests only. */
export type Plant = 'hub-unless-agent-built' | 'grants-only-in-record-query' | 'first-party-appends-every-kind'
  | 'context-as-text' | 'writer-from-arguments' | JoinPlant | 'stop-provider-first';

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
export interface Installed { id: string; version: string; folder: string; digest: string; builtBy: string | null; project: string | null }
export interface Conformance { id: string; version: string; digest: string; passed: boolean; reasons: string[] }
export interface Loaded { status: 'loaded'; id: string; version: string; place: 'hub' | 'sandbox'; run: string | null }
export interface Refused { status: 'refused'; id: string; version: string; reason: string }
export type Load = Loaded | Refused;
export interface ExtensionHost {
  install(from: InstallFrom): Promise<Installed>;
  /** Kept across a restart: a new host on the same home. */
  installed(): Promise<Installed[]>;
  /** Runs its conformance on its files now; the result is kept for that digest. */
  check(pkg: Installed): Promise<Conformance>;
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
  /** Every live handler of the request's kind replies within its deadline; their replies joined in one fixed order. */
  hook(request: HookRequest): Promise<HookReply>;
  /** Runs an action of the live piece the call targets, at the version it names, for its caller. */
  callAction(call: ActionCall): Promise<ActionResult>;
  /** Removes a loaded piece: new calls stop first, its users' uses detach, then it stops. `load` enables it again. */
  disable(id: string): Promise<void>;
  /** Stops every process it started. */
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

interface Manifest {
  id: string; version: string; digest?: string; access?: { words: string[] }; checks?: string[]; notices?: string[]; actions?: string[];
  provides?: { interface: string; kind: string }[]; uses?: { interface: string }[]; templates?: Template[];
}
interface Entry extends Installed { grant: { record: string[]; hosts?: HostGrant[] } }
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
  subscribed: Set<string>;
  routes: Set<string>;
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
  private readonly exts = new Map<string, Ext>();
  private readonly loading = new Map<string, Promise<void>>();
  /** Packages' calls under way. */
  private readonly calls = new Set<Promise<void>>();
  /** Conformance runs under way. */
  private readonly checking = new Set<Promise<Conformance>>();
  private isReady = false;
  /** The starts of the packages loaded before ready, once ready runs. */
  private starting: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly options: ExtensionHostOptions) {
    this.entries = this.read('installed.json');
    this.results = this.read('checked.json');
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
    // Read as data before any of its code runs; a symlink anywhere refuses the install.
    packageDigest(from.from);
    // A quota that counts nothing would never refuse: each is a whole number of calls per a whole number of ms.
    for (const h of from.grant?.hosts ?? []) {
      const whole = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) > 0;
      if (typeof h?.host !== 'string' || !whole(h.quota?.calls) || !whole(h.quota?.per_ms)) throw Error(`${id}'s grant gives ${String(h?.host)} a quota that isn't a count of calls per a time`);
    }
    const project = from.project === undefined ? null : realpathSync(from.project);
    // A folder of its own for each install, in use once installed.json names it: an install that fails, or stops
    // partway, leaves the one installed before as it was, its bytes with its grant and provenance.
    mkdirSync(join(this.options.home, 'extensions', id), { recursive: true });
    const folder = mkdtempSync(join(this.options.home, 'extensions', id, `${version}-`));
    const before = this.entries[id];
    let entry: Entry;
    try {
      cpSync(from.from, folder, { recursive: true });
      const hosts = from.grant?.hosts?.map((h) => ({ host: h.host, quota: { calls: h.quota.calls, per_ms: h.quota.per_ms } }));
      entry = { id, version, folder, digest: packageDigest(folder), builtBy: from.builtBy, project, grant: { record: [...(from.grant?.record ?? [])], ...(hosts ? { hosts } : {}) } };
      this.save('installed.json', { ...this.entries, [id]: entry });
    } catch (e) {
      rmSync(folder, { recursive: true, force: true });
      throw e;
    }
    this.entries[id] = entry;
    if (before) rmSync(before.folder, { recursive: true, force: true });
    // The copy running is the install before: it stops, after any load of it under way.
    await this.serial(id, async () => {
      const running = this.exts.get(id);
      if (running && running.entry !== entry) await this.unload(running);
    });
    return this.installedOf(entry);
  }
  private installedOf(e: Entry): Installed {
    return { id: e.id, version: e.version, folder: e.folder, digest: e.digest, builtBy: e.builtBy, project: e.project };
  }
  async installed(): Promise<Installed[]> {
    return Object.values(this.entries).map((e) => this.installedOf(e));
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
    return ext.kinds.filter((k) => !declared.includes(k)).map((k) => `it registers the check kind ${k}, which its manifest doesn't declare`);
  }
  private ext(entry: Entry, folder: string, manifest: Manifest, digest: string, place: Ext['place'], mode: Ext['mode']): Ext {
    const released = this.options.release.some((r) => r.id === entry.id && r.version === entry.version && r.digest === digest);
    return {
      entry, folder, manifest, digest, place, mode, run: place === 'sandbox' ? `run:${ulid(this.options.now())}` : null, kinds: [], subscribed: new Set(), routes: new Set(),
      released: released && place === 'hub', live: false, actions: new Map(), provides: new Set(), uses: new Set(), detached: false, reads: new Set(), scopes: new Map(),
    };
  }
  /**
   * A copy of its install folder under the host's home, and that copy's digest: the bytes conformance and a load
   * check are the bytes that run, whatever is written to the install folder after.
   */
  private snapshot(entry: Entry): { folder: string; digest: string } {
    const folder = mkdtempSync(join(this.options.home, 'run-'));
    try {
      cpSync(entry.folder, folder, { recursive: true });
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
    const released = this.options.release.some((r) => r.id === entry.id && r.version === entry.version && r.digest === digest);
    const hub = entry.builtBy === null && existsSync(join(folder, 'index.ts')) && (released || this.options.plant === 'hub-unless-agent-built');
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
  private loadedOf(ext: Ext): Loaded {
    return { status: 'loaded', id: ext.entry.id, version: ext.entry.version, place: ext.place, run: ext.run };
  }

  /** Runs the package's code: in the hub's process, or in the platform sandbox through the supervisor. */
  private async start(ext: Ext): Promise<void> {
    const index = join(ext.folder, 'index.ts');
    const params = ext.place === 'sandbox' && existsSync(index) ? { source: stripTypeScriptTypes(readFileSync(index, 'utf8')) } : {};
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
      ext.stop = async () => { await supervisor.cleanup(run).catch(() => undefined); };
      const early = supervisor.wait(run).then((exit) => Promise.reject(Error(`it exited (${exit.code ?? exit.signal}) before it connected: ${output.join('').trim()}`)));
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
        await supervisor.cleanup(run).catch(() => undefined);
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
    // Its routes close with the other ways in, before the drain.
    await this.turnOff(ext.entry.id, ext);
    await Promise.all([...ext.reads].map((r) => r.catch(() => undefined)));
    await this.stopHandlers(ext);
    rmSync(ext.folder, { recursive: true, force: true });
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
    const schema = API.find((m) => m.method === method);
    if (!schema) throw Error(`${method} isn't in the extension API`);
    const id = ext.entry.id;
    // An unloaded copy's call, or one made for an ended action call, does nothing: not even a refusal on record.
    if (ext.mode === 'loaded' && this.exts.get(id) !== ext) throw Error(`${method}: ${id} was unloaded`);
    const connection = this.connection(ext, scope);
    const checked = this.options.plant !== 'grants-only-in-record-query' || method === 'deep.record.query';
    if (schema.needs && checked && !granted(ext.manifest, schema.needs)) {
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
          const owner = this.owner(type);
          if (owner && owner !== ext) throw Error(`${type} is already registered by ${owner.entry.id}`);
        }
        if (!ext.kinds.includes(type)) ext.kinds.push(type);
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
      const page = await this.options.record.read({ after, limit: PAGE });
      for (const e of page) if (kinds.has(e.kind)) found.push(JSON.parse(toJson(e)));
      if (page.length < PAGE) return found;
      after = page[page.length - 1]!.log_pos;
    }
  }
  private owner(kind: string): Ext | undefined {
    for (const ext of this.exts.values()) if (ext.kinds.includes(kind)) return ext;
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

  async hook(request: HookRequest): Promise<HookReply> {
    const { kind, deadline } = request;
    const failed: HookReply['failed'] = [];
    const contributions: HookContribution[] = [];
    await Promise.all([...this.exts.values()].filter((ext) => ext.live && ext.subscribed.has(kind)).map(async (ext) => {
      const id = ext.entry.id;
      const fail = (reason: string): void => void failed.push({ extension: id, reason });
      if (await this.revoked(ext)) return fail(`${id}'s project is no longer trusted, so it was stopped`);
      // Removed while trust answered: it is asked nothing, and its absence is on the reply.
      if (!ext.live || !ext.ask) return fail(`${id} stopped before it could reply`);
      let replies: unknown;
      const asked = performance.now();
      try {
        // Its own deadline only: a handler that misses it stays loaded, and its late reply goes nowhere.
        replies = await within(deadline + HOOK_GRACE_MS, `${id}'s ${kind} handler`, ext.ask('hook', { kind, request: { kind, data: request.data }, deadline }));
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
  async runCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number }): Promise<CheckResult> {
    const ext = this.owner(kind);
    if (!ext?.ask || (await this.revoked(ext))) return nothing('missing', `no loaded extension registered the check kind ${kind}`);
    try {
      const result = await this.ask(ext, ctx.deadline, kind, 'run', { type: kind, spec, ctx });
      if (!isResult(result)) return nothing('failed', `${ext.entry.id}'s ${kind} returned no check result as check.kind@1 defines one`);
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
  }
}

export async function openExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
  return new Host(options);
}
