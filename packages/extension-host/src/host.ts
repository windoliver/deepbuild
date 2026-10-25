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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { homedir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AdapterCaps, HookRequestLine } from '@deepbuild/adapters';
import type { Asks, Delivery, ResolverAnswer } from '@deepbuild/asks';
import { runKit, slotKits } from '@deepbuild/conformance';
import type { CheckResult, CheckRunnerFill, CheckSpec, SlotKit } from '@deepbuild/conformance';
import { checkManifest, validate } from '@deepbuild/contracts';
import { toJson, ulid, type Event, type EventInput, type RecordStore } from '@deepbuild/record';
import type { Supervisor } from '@deepbuild/supervisor';
import { API, extensionSide, peer } from '../runtime/deep.mjs';
import { packageDigest } from './digest.js';
import type { ProjectTrust } from './trust.js';

/** A package inside DeepBuild's signed release, as the release's signed manifest lists it. */
export interface ReleaseEntry { id: string; version: string; digest: string }
/** The planted wrong programs the criteria name, selected per host; tests only. */
export type Plant = 'hub-unless-agent-built' | 'grants-only-in-record-query' | 'first-party-appends-every-kind' | 'both-adapters-deliver' | 'first-to-bind-owns';
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
  plant?: Plant;
}
export interface InstallFrom {
  from: string;
  /** The agent session that built or changed it, or null when no agent wrote it. */
  builtBy: string | null;
  /** A project's extension: the repo folder it comes with. */
  project?: string;
  /** What you approved: the event kinds of the record it may read. */
  grant?: { record?: string[] };
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
  /** A hook line, mapped through the adapter `line.agent` names; binds and gates the session it carries. */
  hook(line: HookRequestLine): Promise<{ adapter: string; events: { kind: string }[] }>;
  /** The adapters loaded extensions registered. */
  adapters(): Promise<{ name: string; extension: string; caps: AdapterCaps }[]>;
  /** The adapter that owns the session: the one that gates it; null before any adapter bound it. */
  owner(session: string): Promise<{ adapter: string } | null>;
  /** An answer for a session: the owning adapter delivers it by a route its flags allow now, or it waits for one. */
  deliverAnswer(answer: Delivery): Promise<Delivered>;
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
/** The largest request body a route takes. */
const BODY = 1024 * 1024;
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

interface Manifest { id: string; version: string; digest?: string; access?: { words: string[] }; checks?: string[]; replaces?: string[]; notices?: string[] }
interface Entry extends Installed { grant: { record: string[] } }
/** A session adapters bound: who bound it in order, who gates it, whether a turn runs, and the answers waiting for a route. */
interface Bound { bound: string[]; gater: string | null; inTurn: boolean; waiting: Delivery[] }
type Ask = (method: string, params: unknown) => Promise<unknown>;
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
  /** The adapter names it registered. */
  adapters: Set<string>;
  /** Whether a load of these bytes runs in the hub: a release package written by no agent, with an index.ts. */
  hubBound: boolean;
  /** How to take its resolver back from the asks core, once it registered one. */
  resolverDrop?: () => void;
  /** How the host asks the running package: its in-process side, or its socket. Unset until it runs. */
  ask?: Ask;
  stop?: () => Promise<void>;
  server?: HttpServer;
}

class Overran extends Error {}
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
    const project = from.project === undefined ? null : realpathSync(from.project);
    // A folder of its own for each install, in use once installed.json names it: an install that fails, or stops
    // partway, leaves the one installed before as it was, its bytes with its grant and provenance.
    mkdirSync(join(this.options.home, 'extensions', id), { recursive: true });
    const folder = mkdtempSync(join(this.options.home, 'extensions', id, `${version}-`));
    const before = this.entries[id];
    let entry: Entry;
    try {
      cpSync(from.from, folder, { recursive: true });
      entry = { id, version, folder, digest: packageDigest(folder), builtBy: from.builtBy, project, kits: [], grant: { record: [...(from.grant?.record ?? [])] } };
      // Each slot's kit runs on what it registers first: a FAIL refuses the install, and what was installed stays.
      entry.kits = await this.installKits(entry, manifest as Manifest);
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
    return { id: e.id, version: e.version, folder: e.folder, digest: e.digest, builtBy: e.builtBy, project: e.project, kits: structuredClone(e.kits ?? []) };
  }
  /**
   * The kits at install: the package's code runs once, where it will run, and each check kind it registers in place
   * of a shipped one (its manifest's `replaces`) is a check.kind@1 fill the kit's fixed part judges; its first FAIL
   * refuses the install, naming the case. A kind of the package's own is BLOCKED: unrun, so never passed. A
   * replacement the sandbox would run is BLOCKED too (the kit's suites run in a checkout the sandbox can't reach),
   * and a BLOCKED replacement doesn't install. A package that declares no kind to kit runs no code at install.
   */
  private async installKits(entry: Entry, manifest: Manifest): Promise<KitRun[]> {
    const { folder, digest } = this.snapshot(entry);
    const hub = this.hubBound(entry, folder, digest);
    const replaces = manifest.replaces ?? [];
    const declared = manifest.checks ?? [];
    const kitted = declared.filter((kind) => replaces.includes(kind));
    // No package code runs in the hub before it is ready (#348): a kit that needs to is BLOCKED, so the install is.
    if (hub && kitted.length && !this.isReady) {
      rmSync(folder, { recursive: true, force: true });
      throw Error(`BLOCKED: ${entry.id} replaces ${kitted.join(', ')}, whose ${CHECK_KIND} kit runs its code in the hub, and the hub isn't ready; install it once it is`);
    }
    if (!hub && kitted.length) {
      // The kit's suites run in a checkout the sandbox can't reach: unrun, the replacement doesn't install.
      rmSync(folder, { recursive: true, force: true });
      throw Error(`BLOCKED: ${entry.id} replaces ${kitted.join(', ')}, and ${CHECK_KIND}'s kit can't run on a package the sandbox will run; only a release package written by no agent replaces a shipped kind`);
    }
    if (!kitted.length) {
      rmSync(folder, { recursive: true, force: true });
      return declared.map((kind) => ({ slot: CHECK_KIND, fill: kind, verdict: 'BLOCKED' as const }));
    }
    const ext = this.ext(entry, folder, manifest, digest, 'hub', 'conformance');
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
    } finally {
      await ext.stop?.();
      rmSync(folder, { recursive: true, force: true });
    }
    return runs;
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
    return { entry, folder, manifest, digest, place, mode, run: place === 'sandbox' ? `run:${ulid(this.options.now())}` : null, kinds: [], subscribed: new Set(), routes: new Set(), adapters: new Set(), hubBound: this.hubBound(entry, folder, digest) };
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
  private loadedOf(ext: Ext): Loaded {
    return { status: 'loaded', id: ext.entry.id, version: ext.entry.version, place: ext.place, run: ext.run };
  }

  /** Runs the package's code: in the hub's process, or in the platform sandbox through the supervisor. */
  private async start(ext: Ext): Promise<void> {
    const index = join(ext.folder, 'index.ts');
    const params = ext.place === 'sandbox' && existsSync(index) ? { source: stripTypeScriptTypes(readFileSync(index, 'utf8')) } : {};
    if (ext.place === 'hub') {
      const url = `${pathToFileURL(index).href}?digest=${ext.digest.slice(3)}`;
      ext.ask = extensionSide((method, params) => this.dispatch(ext, method, params), async (deep) => {
        const code = (await import(url)) as { default: (deep: unknown) => unknown };
        await code.default(deep);
      }).serve;
    } else {
      await this.sandboxed(ext);
    }
    await within(LOAD_MS, `${ext.entry.id}'s registering`, ext.ask!('load', params));
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
      const wire = peer(socket, (method, params) => this.dispatch(ext, method, params));
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
  private async unload(ext: Ext): Promise<void> {
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
    await this.turnOff(ext.entry.id, ext);
    delete ext.ask;
    await ext.stop?.();
    rmSync(ext.folder, { recursive: true, force: true });
  }

  /** A package's call, checked here against its grant before anything else of it. */
  private dispatch(ext: Ext, method: string, params: unknown): Promise<unknown> {
    const call = this.dispatchNow(ext, method, params);
    const settled = call.then(() => undefined, () => undefined);
    this.calls.add(settled);
    void settled.then(() => this.calls.delete(settled));
    return call;
  }
  private async dispatchNow(ext: Ext, method: string, params: unknown): Promise<unknown> {
    const args: unknown[] = Array.isArray(params) ? params : [];
    const schema = API.find((m) => m.method === method);
    if (!schema) throw Error(`${method} isn't in the extension API`);
    const checked = this.options.plant !== 'grants-only-in-record-query' || method === 'deep.record.query';
    if (schema.needs && checked && !granted(ext.manifest, schema.needs)) throw Error(`${method} needs the grant "${schema.needs}", which ${ext.entry.id} wasn't given`);
    const id = ext.entry.id;
    if (ext.mode === 'loaded' && this.exts.get(id) !== ext) throw Error(`${method}: ${id} was unloaded`);
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
          const owner = this.kindOwner(type);
          if (owner && owner !== ext) throw Error(`${type} is already registered by ${owner.entry.id}`);
        }
        if (!ext.kinds.includes(type)) ext.kinds.push(type);
        return null;
      }
      case 'deep.on': {
        const [kind] = args;
        if (typeof kind !== 'string') throw Error('deep.on takes an event kind first');
        if (!ext.entry.grant.record.includes(kind)) throw Error(`deep.on: ${kind} isn't in the record ${id}'s grant names`);
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
          ext.resolverDrop = asks.registerResolver(id, (ask) => this.ask(ext, CALL_MS, 'resolver', 'resolve', { ask }) as Promise<ResolverAnswer | undefined>);
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
      case 'deep.registerRoute': {
        const [route] = args;
        if (typeof route !== 'string' || !ROUTE.test(route)) throw Error(`deep.registerRoute takes "<METHOD> <path>", not ${JSON.stringify(route)}`);
        // Registering opens nothing: a route is served only once you turn the package on and choose it.
        ext.routes.add(route);
        return null;
      }
      case 'deep.record.append': {
        quiet();
        const writer = this.options.plant === 'first-party-appends-every-kind' && ext.place === 'hub' ? 'core' : `ext:${id}`;
        await this.options.record.append({ writer, actor: 'you', scope: 'you' }, args[0] as EventInput);
        return null;
      }
      case 'deep.record.query':
        quiet();
        return this.query(ext, args[0]);
      case 'deep.notices.send': {
        quiet();
        const readings = (args[0] as { readings?: unknown } | undefined)?.readings;
        const notice = `notice:${ulid(this.options.now())}`;
        const now = this.options.now();
        await this.options.record.append({ writer: `ext:${id}`, actor: 'you', scope: 'you' }, {
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
  private kindOwner(kind: string): Ext | undefined {
    for (const ext of this.exts.values()) if (ext.kinds.includes(kind)) return ext;
    return undefined;
  }

  async loaded(): Promise<Loaded[]> {
    return [...this.exts.values()].map((ext) => this.loadedOf(ext));
  }
  async checks(): Promise<{ kind: string; extension: string }[]> {
    return [...this.exts.values()].flatMap((ext) => ext.kinds.map((kind) => ({ kind, extension: ext.entry.id })));
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
    await Promise.all([...this.exts.values()].map(async (ext) => {
      const mine = events.filter((e) => ext.subscribed.has(e.kind)).map((e) => JSON.parse(toJson(e)) as unknown);
      if (!mine.length) return;
      if (!ext.ask || (await this.revoked(ext))) return void failed.push(`${ext.entry.id}: it stopped, its project no longer trusted or unloaded`);
      await this.ask(ext, CALL_MS, 'events', 'deliver', { events: mine }).catch((e) => failed.push(`${ext.entry.id}: ${message(e)}`));
    }));
    if (failed.length) throw Error(`not every subscribed package took the events: ${failed.join('; ')}`);
  }
  async hook(line: HookRequestLine): Promise<{ adapter: string; events: { kind: string }[] }> {
    const name = line.agent;
    const fill = this.adapterFills.get(name);
    if (!fill?.ext.ask || (await this.revoked(fill.ext))) throw Error(`no loaded extension registered an adapter ${name}`);
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
    if (!fill.ext.ask || (await this.revoked(fill.ext))) throw Error(`the adapter ${name}'s package stopped, so ${answer.ask} wasn't delivered`);
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
  }
}

export async function openExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
  return new Host(options);
}
