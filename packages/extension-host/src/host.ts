// The extension host (#348). A TypeScript package inside DeepBuild's signed release, written by no agent, loads in
// the hub's own process; every other package, whoever wrote it, loads in the platform sandbox, out of process,
// started through the supervisor (host@1), and speaks JSON-RPC with the host over a socket of its own. Nothing loads
// before its conformance passed on the files it has now, or before you trust its project; no package code runs
// before the hub is ready; every call is checked against the package's grant here, in the host, never in the
// package; and inbound traffic reaches a package only through routes you chose when you turned it on.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CheckResult, CheckSpec } from '@deepbuild/conformance';
import { checkManifest } from '@deepbuild/contracts';
import { toJson, ulid, type Event, type EventInput, type RecordStore } from '@deepbuild/record';
import type { Supervisor } from '@deepbuild/supervisor';
import { API, extensionSide, peer } from '../runtime/deep.mjs';
import { packageDigest } from './digest.js';
import type { ProjectTrust } from './trust.js';

/** A package inside DeepBuild's signed release, as the release's signed manifest lists it. */
export interface ReleaseEntry { id: string; version: string; digest: string }
/** The planted wrong programs the criteria name, selected per host; tests only. */
export type Plant = 'hub-unless-agent-built' | 'grants-only-in-record-query' | 'first-party-appends-every-kind';
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
  /** What you approved: the event kinds of the record it may read. */
  grant?: { record?: string[] };
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
  /** Hands each event to the loaded packages subscribed to its kind, once they have all taken it. */
  deliver(events: Event[]): Promise<void>;
  /** The hub is ready: its socket listens and its replay is done. Packages loaded before it start now. */
  ready(): Promise<void>;
  /** "<METHOD> <path>" routes you chose, served on one listener on 127.0.0.1. */
  turnOn(id: string, routes: string[]): Promise<{ address: string }>;
  turnOff(id: string): Promise<void>;
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
const PAGE = 1000;
/** Folder-safe, as extension.manifest@1 writes them. */
const ID = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/;
const VERSION = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$/;
const ROUTE = /^(GET|HEAD|POST|PUT|PATCH|DELETE) \/\S*$/;

interface Manifest { id: string; version: string; digest?: string; access?: { words: string[] }; checks?: string[]; notices?: string[] }
interface Entry extends Installed { grant: { record: string[] } }
type Ask = (method: string, params: unknown) => Promise<unknown>;
interface Ext {
  entry: Entry;
  manifest: Manifest;
  place: 'hub' | 'sandbox';
  run: string | null;
  digest: string;
  mode: 'conformance' | 'loaded';
  /** Check kinds it registered; at its conformance run, every one it tried. */
  kinds: string[];
  subscribed: Set<string>;
  routes: Set<string>;
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
const isResult = (r: unknown): r is CheckResult => typeof r === 'object' && r !== null && typeof (r as CheckResult).outcome === 'string'
  && typeof (r as CheckResult).testsRun === 'number' && Array.isArray((r as CheckResult).failures);
/** Whether the manifest asks for the grant: an access word, or `notices` for a declared notice kind. */
const granted = (m: Manifest, needs: string): boolean => (needs === 'notices' ? (m.notices ?? []).length > 0 : (m.access?.words ?? []).includes(needs));
/** The interpreter a `main` names on its first line, so its install can be read in the sandbox. */
function interpreter(folder: string): string[] {
  const first = readFileSync(join(folder, 'main'), 'utf8').split('\n', 1)[0] ?? '';
  const program = first.startsWith('#!') ? first.slice(2).trim().split(/\s+/)[0] ?? '' : '';
  return program.startsWith('/') && existsSync(program) ? [dirname(dirname(realpathSync(program)))] : [];
}

class Host implements ExtensionHost {
  private readonly entries: Record<string, Entry>;
  private readonly results: Record<string, Conformance>;
  private readonly exts = new Map<string, Ext>();
  private isReady = false;
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
    const folder = join(this.options.home, 'extensions', id, version);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(dirname(folder), { recursive: true });
    cpSync(from.from, folder, { recursive: true });
    const entry: Entry = {
      id, version, folder, digest: packageDigest(folder), builtBy: from.builtBy,
      project: from.project === undefined ? null : realpathSync(from.project), grant: { record: [...(from.grant?.record ?? [])] },
    };
    this.entries[id] = entry;
    this.save('installed.json', this.entries);
    return this.installedOf(entry);
  }
  private installedOf(e: Entry): Installed {
    return { id: e.id, version: e.version, folder: e.folder, digest: e.digest, builtBy: e.builtBy, project: e.project };
  }
  async installed(): Promise<Installed[]> {
    return Object.values(this.entries).map((e) => this.installedOf(e));
  }

  async check(pkg: Installed): Promise<Conformance> {
    const entry = this.entry(pkg);
    if (entry.project && !(await this.options.trust.trusted(entry.project))) {
      throw Error(`${entry.id} comes with ${entry.project}, a project you haven't trusted, so none of its code runs, its checks included`);
    }
    const digest = packageDigest(entry.folder);
    const reasons: string[] = [];
    let manifest: Manifest | undefined;
    try {
      manifest = JSON.parse(readFileSync(join(entry.folder, 'deepbuild.json'), 'utf8')) as Manifest;
    } catch (e) {
      reasons.push(`its deepbuild.json can't be read: ${message(e)}`);
    }
    if (manifest) {
      const held = checkManifest(manifest);
      if (!held.ok) for (const i of held.issues) reasons.push(`its manifest fails extension.manifest@1 at ${i.path || '/'}: ${i.code} ${i.actual}`);
      else if (manifest.id !== entry.id || manifest.version !== entry.version) reasons.push(`its manifest names ${manifest.id}@${manifest.version}, not ${entry.id}@${entry.version}`);
      else if (manifest.digest !== digest) reasons.push(`its manifest's digest ${manifest.digest} isn't its files' digest ${digest}`);
    }
    if (!existsSync(join(entry.folder, 'index.ts')) && !existsSync(join(entry.folder, 'main'))) reasons.push('it has neither an index.ts nor a main to run');
    if (!reasons.length) reasons.push(...(await this.registers(entry, manifest!, digest)));
    const result: Conformance = { id: entry.id, version: entry.version, digest, passed: !reasons.length, reasons };
    this.results[`${entry.id}@${entry.version}`] = result;
    this.save('checked.json', this.results);
    return result;
  }
  /** Conformance's run of the package's code: it registers in the platform sandbox without throwing, and only the check kinds its manifest declares. */
  private async registers(entry: Entry, manifest: Manifest, digest: string): Promise<string[]> {
    const ext = this.ext(entry, manifest, digest, 'sandbox', 'conformance');
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
  private ext(entry: Entry, manifest: Manifest, digest: string, place: Ext['place'], mode: Ext['mode']): Ext {
    return { entry, manifest, digest, place, mode, run: place === 'sandbox' ? `run:${ulid(this.options.now())}` : null, kinds: [], subscribed: new Set(), routes: new Set() };
  }

  async load(pkg: Installed): Promise<Load> {
    const refuse = (reason: string): Refused => ({ status: 'refused', id: pkg.id, version: pkg.version, reason });
    if (this.options.safe) return refuse('safe mode: the hub loads no extension');
    const entry = this.entries[pkg.id];
    if (!entry) return refuse(`${pkg.id} isn't installed`);
    const running = this.exts.get(entry.id);
    if (running) return this.loadedOf(running);
    if (entry.project && !(await this.options.trust.trusted(entry.project))) return refuse(`${entry.id} comes with ${entry.project}, a project you haven't trusted`);
    let digest: string;
    try {
      digest = packageDigest(entry.folder);
    } catch (e) {
      return refuse(message(e));
    }
    const result = this.results[`${entry.id}@${entry.version}`];
    if (!result) return refuse(`${entry.id}'s conformance hasn't run: check it first`);
    if (result.digest !== digest) return refuse(`changed since checked: its files' digest is ${digest}, and its checks ran on ${result.digest}`);
    if (!result.passed) return refuse(`${entry.id} failed conformance: ${result.reasons.join('; ')}`);
    const manifest = JSON.parse(readFileSync(join(entry.folder, 'deepbuild.json'), 'utf8')) as Manifest;
    const released = this.options.release.some((r) => r.id === entry.id && r.version === entry.version && r.digest === digest);
    const hub = entry.builtBy === null && existsSync(join(entry.folder, 'index.ts')) && (released || this.options.plant === 'hub-unless-agent-built');
    const ext = this.ext(entry, manifest, digest, hub ? 'hub' : 'sandbox', 'loaded');
    this.exts.set(entry.id, ext);
    // Before the hub is ready, it starts at ready: none of its code runs until then.
    if (this.isReady) {
      try {
        await this.start(ext);
      } catch (e) {
        await this.unload(ext);
        return refuse(`${entry.id} didn't load: ${message(e)}`);
      }
    }
    return this.loadedOf(ext);
  }
  private loadedOf(ext: Ext): Loaded {
    return { status: 'loaded', id: ext.entry.id, version: ext.entry.version, place: ext.place, run: ext.run };
  }

  /** Runs the package's code: in the hub's process, or in the platform sandbox through the supervisor. */
  private async start(ext: Ext): Promise<void> {
    if (ext.place === 'hub') {
      const url = `${pathToFileURL(join(ext.entry.folder, 'index.ts')).href}?digest=${ext.digest.slice(3)}`;
      ext.ask = extensionSide((method, params) => this.dispatch(ext, method, params), async (deep) => {
        const code = (await import(url)) as { default: (deep: unknown) => unknown };
        await code.default(deep);
      }).serve;
    } else {
      await this.sandboxed(ext);
    }
    const index = join(ext.entry.folder, 'index.ts');
    const params = ext.place === 'sandbox' && existsSync(index) ? { source: stripTypeScriptTypes(readFileSync(index, 'utf8')) } : {};
    await within(LOAD_MS, `${ext.entry.id}'s registering`, ext.ask!('load', params));
  }
  private async sandboxed(ext: Ext): Promise<void> {
    const { supervisor } = this.options;
    const folder = ext.entry.folder;
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
  private async unload(ext: Ext): Promise<void> {
    if (this.exts.get(ext.entry.id) === ext) this.exts.delete(ext.entry.id);
    await this.turnOff(ext.entry.id, ext);
    delete ext.ask;
    await ext.stop?.();
  }

  /** A package's call, checked here against its grant before anything else of it. */
  private async dispatch(ext: Ext, method: string, params: unknown): Promise<unknown> {
    const args: unknown[] = Array.isArray(params) ? params : [];
    const schema = API.find((m) => m.method === method);
    if (!schema) throw Error(`${method} isn't in the extension API`);
    const checked = this.options.plant !== 'grants-only-in-record-query' || method === 'deep.record.query';
    if (schema.needs && checked && !granted(ext.manifest, schema.needs)) throw Error(`${method} needs the grant "${schema.needs}", which ${ext.entry.id} wasn't given`);
    const id = ext.entry.id;
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
        if (!ext.entry.grant.record.includes(kind)) throw Error(`deep.on: ${kind} isn't in the record ${id}'s grant names`);
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
  private owner(kind: string): Ext | undefined {
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
    const ext = this.owner(kind);
    if (!ext?.ask) return nothing('missing', `no loaded extension registered the check kind ${kind}`);
    try {
      const result = await within(ctx.deadline, `${ext.entry.id}'s ${kind}`, ext.ask('run', { type: kind, spec, ctx }));
      if (!isResult(result)) throw Error(`${ext.entry.id}'s ${kind} returned no check result`);
      return result;
    } catch (e) {
      if (e instanceof Overran) return nothing('overran', `${ext.entry.id}'s ${kind} ran past its deadline of ${ctx.deadline} ms`);
      throw e;
    }
  }
  async deliver(events: Event[]): Promise<void> {
    await Promise.all([...this.exts.values()].map(async (ext) => {
      const mine = events.filter((e) => ext.subscribed.has(e.kind)).map((e) => JSON.parse(toJson(e)) as unknown);
      if (mine.length && ext.ask) await within(CALL_MS, `${ext.entry.id}'s events`, ext.ask('deliver', { events: mine })).catch(() => undefined);
    }));
  }
  async ready(): Promise<void> {
    if (this.isReady) return;
    this.isReady = true;
    for (const ext of [...this.exts.values()]) {
      if (!ext.ask) await this.start(ext).catch(() => this.unload(ext));
    }
  }

  async turnOn(id: string, routes: string[]): Promise<{ address: string }> {
    const ext = this.exts.get(id);
    if (!ext?.ask) throw Error(`${id} isn't loaded and running`);
    if (ext.server) throw Error(`${id} is already turned on`);
    for (const route of routes) if (!ext.routes.has(route)) throw Error(`${id} registered no route ${route}`);
    const chosen = new Set(routes);
    const server = createHttpServer((req, res) => void this.serve(ext, chosen, req, res));
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    ext.server = server;
    return { address: `127.0.0.1:${(server.address() as AddressInfo).port}` };
  }
  private async serve(ext: Ext, chosen: Set<string>, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0]!;
    const route = `${req.method} ${path}`;
    if (!chosen.has(route) || !ext.ask) {
      req.resume();
      const chosenPath = [...chosen].some((r) => r.slice(r.indexOf(' ') + 1) === path);
      res.writeHead(chosenPath ? 405 : 404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
      const request = { method: req.method, path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      const answer = (await within(CALL_MS, `${ext.entry.id}'s ${route}`, ext.ask('route', { route, request }))) as { status?: unknown; body?: unknown } | null;
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
    for (const ext of [...this.exts.values()]) await this.unload(ext);
  }
}

export async function openExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost> {
  return new Host(options);
}
