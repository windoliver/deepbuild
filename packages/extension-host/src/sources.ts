// Plug-in sources and secrets (#364). A polled source is declared once (its host, the secret it needs, its quota, a
// timeout and how long a reading stays fresh) and the hub makes every call: the package's code only parses what comes
// back. A secret reaches a package as a handle; its value lives in the OS secret store, and the hub adds it to the
// header the source names, only on that source's host. A redirect is followed only to the same host, never by the
// HTTP client; and before the parser gets an answer, every secret value the hub holds is scrubbed from its headers
// and body in the Privacy scrub's forms. Every call is recorded with its secrets stripped, and a recording replays on
// the clock the host was given, so tests, the installer's dry run and the gate make no live call. A failed call backs
// the source off; each live call's cost and each new reading go to the record, as the core.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { appendFile, mkdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createConnection, type AddressInfo } from 'node:net';
import { scrubValues } from '@deepbuild/evidence';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';
import { sha256Hex, validate } from '@deepbuild/contracts';
import type { Entry, Ext, Manifest } from './host-types.js';
import { CALL_MS, HostFiles, isPlain, message, trustedPath, within } from './host-shared.js';
import { SERIES_MAX, missing, shownValue, type SeriesStore, type BoundValue, type Span, type Rollup } from './series.js';
import type { HttpRequest, HttpAnswer, HttpClient, SecretStore, RecordedCall, Recording, Reading, Batch, SourceRead, KeyTest, StreamEvent, StreamRead, Polled, WorkDecl, LibraryDecl, Declared, ViewShown, SavedNotice } from './source-types.js';
export type { HttpRequest, HttpAnswer, HttpClient, SecretStore, RecordedCall, Recording, Reading, Batch, SourceRead, KeyTest, StreamEvent, StreamRead, Polled, WorkDecl, LibraryDecl, Declared } from './source-types.js';
const WORK_CALL_MS = 60_000;
const BOUND = /^reading:([a-z][a-z0-9_.-]*)(?:#(.+))?$/;
const SOURCE_NAME = /^ext\.[a-z0-9][a-z0-9_-]*\.[a-z][a-z0-9_]*$/;
const KEPT_MS = 2_000;
const SHOWN_MS = 10_000;
interface HostSourcesOptions {
  record: RecordStore; now(): number; files: HostFiles;
  exts: ReadonlyMap<string, Ext>;
  ask(ext: Ext, ms: number, what: string, method: string, params: unknown): Promise<unknown>;
}
/** Loaded source calls, cursor and visibility state belong to this host's source service. */
export class HostSources {
  /** The app's last views/shown report for each view and window (#262). */
  private readonly shown = new Map<string, { report: ViewShown; at: number }>();
  /** When each while-shown source is next called (#262). */
  private readonly shownNext = new Map<string, number>();
  /** Each source whose last call the quota refused, with when it can run (#262). */
  private readonly quotaUntil = new Map<string, number>();

  /** The work-source calls under way, by the call ID their context's fetch names (#66). */
  private readonly workCalls = new Map<string, { ext: Ext; source: string; work: Omit<WorkDecl, 'delivers'>; library?: LibraryDecl; noAnswer: boolean }>();
  private workCount = 0;
  constructor(private readonly options: HostSourcesOptions, private readonly sources: Sources, private readonly series: SeriesStore | undefined) {}
  workExt(source: string): Ext | undefined {
    return [...this.options.exts.values()].find((e) => e.live && e.ask && e.mode === 'loaded' && (e.sources.get(source) as { work?: unknown } | undefined)?.work);
  }

  /** One op of a loaded work source, bounded; its context's fetch goes through the hub under this call's ID. */
  async workCall(source: string, op: 'list' | 'item' | 'deliver' | 'find', arg: unknown): Promise<{ value: unknown; noAnswer: boolean }> {
    const ext = this.workExt(source);
    const d = ext?.sources.get(source);
    if (!ext || d?.variant !== 'stream' || !d.work) throw Error(`no loaded package registers the work source ${source}`);
    return this.sourceCall({ ext, source, work: d.work, noAnswer: false }, op, arg);
  }
  /** Work and library operations share the call lifetime and its recorded no-answer state. */
  private async sourceCall(live: { ext: Ext; source: string; work: Omit<WorkDecl, 'delivers'>; library?: LibraryDecl; noAnswer: boolean }, op: string, arg: unknown): Promise<{ value: unknown; noAnswer: boolean }> {
    const { ext, source } = live;
    const call = `work:${++this.workCount}`;
    this.workCalls.set(call, live);
    try {
      const value = await within(WORK_CALL_MS, `${ext.entry.id}'s ${live.library ? 'library' : 'work source'} ${source}'s ${op}`, ext.ask!(live.library ? 'library' : 'work', { name: source, op, call, arg }));
      return { value, noAnswer: live.noAnswer };
    } catch (e) {
      throw Object.assign(e instanceof Error ? e : Error(String(e)), { noAnswer: live.noAnswer });
    } finally {
      this.workCalls.delete(call);
    }
  }

  /** The library sources loaded packages registered (#1731), asset.library@1's fills: each one's name and package. */
  libraries(): { name: string; extension: string }[] {
    return [...this.options.exts.values()].filter((e) => e.live && e.ask && e.mode === 'loaded')
      .flatMap((e) => [...e.sources.values()].filter((d) => d.variant === 'library').map((d) => ({ name: d.name, extension: e.entry.id })));
  }

  private libraryOf(name: string): { ext: Ext; library: LibraryDecl } {
    for (const ext of this.options.exts.values()) {
      const d = ext.live && ext.ask && ext.mode === 'loaded' ? ext.sources.get(name) : undefined;
      if (d?.variant === 'library') return { ext, library: d.library };
    }
    throw Error(`no loaded package registers the library ${name}`);
  }

  /**
   * One op of a loaded library source (#1731), search or fetch, bounded by its timeout: the package's code reads the
   * library's API through its context's fetch, the hub's call to the library's host; `noAnswer` when a call got none.
   */
  async libraryCall(name: string, op: 'search' | 'fetch', arg: unknown): Promise<{ value: unknown; noAnswer: boolean }> {
    const { ext, library } = this.libraryOf(name);
    return this.sourceCall({ ext, source: name, work: library, library, noAnswer: false }, op, arg);
  }

  /** A file a library's fetch named, downloaded through its source on its host by the hub, never by the package (#1731). */
  async libraryFile(name: string, path: string): Promise<{ status: number; bytes: Uint8Array } | { status: null; why: string }> {
    const { ext, library } = this.libraryOf(name);
    try {
      const answer = await this.sources.workFetch(ext.entry.id, name, library, { method: 'GET', path }, { timeout: library.timeout, encoding: 'base64' });
      return { status: answer.status, bytes: Buffer.from(answer.body, 'base64') };
    } catch (e) {
      if (e instanceof NoAnswer) return { status: null, why: e.message };
      throw e;
    }
  }

  private packSource(pack: string, value: string): { name: string; path: string; source: LibraryDecl } {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error(`${pack}: an asset URL must be https with no credentials or fragment`);
    return { name: `ext.pack_${sha256Hex(new TextEncoder().encode(`${pack}\n${url.host}`))}.assets`, path: `${url.pathname}${url.search}`, source: { host: url.host, secret: null, auth: null, quota: { per_minute: 600, per_day: 100_000 }, timeout: WORK_CALL_MS } };
  }

  async assetFile(source: { pack: string; url: string } | { library: string; path: string }, spec: { file: string; sha256: string; size: number; kept: string }): Promise<string> {
    if ('library' in source) {
      const { ext, library } = this.libraryOf(source.library);
      return this.sources.download(ext.entry.id, source.library, library, source.path, spec);
    }
    const p = this.packSource(source.pack, source.url);
    return this.sources.download(source.pack, p.name, p.source, p.path, spec);
  }

  async assetOnline(pack: string, value: string): Promise<boolean> {
    const p = this.packSource(pack, value);
    try {
      await this.sources.workFetch(pack, p.name, p.source, { method: 'CONNECT', path: '/' }, { timeout: 2000 });
      return true;
    } catch (e) {
      if (e instanceof NoAnswer) return false;
      throw e;
    }
  }

  async assetTerms(pack: string, url: string): Promise<string> {
    const p = this.packSource(pack, url);
    const answer = await this.sources.workFetch(pack, p.name, p.source, { method: 'GET', path: p.path }, { timeout: p.source.timeout });
    if (answer.status !== 200) throw Error(`${pack}: license ${url} answered ${answer.status}`);
    return answer.body;
  }

  async readSource(name: string): Promise<SourceRead> {
    const ext = [...this.options.exts.values()].find((e) => e.live && e.sources.get(name)?.variant === 'polled');
    if (!ext) return { status: 'BLOCKED', source: name, cause: `no loaded package registers the polled source ${name}` };
    return (await this.readPolled(ext, name)).read;
  }

  /** One read of a loaded plug-in's polled source, through the hub, keeping when the quota refused it (#262). */
  async readPolled(owner: Ext, name: string): Promise<{ read: SourceRead; handle: string | null; held: boolean }> {
    const got = await this.sources.readOne(owner.entry.id, owner.sources.get(name) as Polled, (answer) => this.options.ask(owner, CALL_MS, `${name}'s parser`, 'source.parse', { name, answer }));
    if (got.read.status === 'reading' || got.read.status === 'batch') this.quotaUntil.delete(name);
    else if (got.read.until !== undefined) this.quotaUntil.set(name, got.read.until);
    return got;
  }

  recording(): Recording {
    return this.sources.recording();
  }

  async readings(source: string, window: { from: number; to: number }): Promise<Reading[]> {
    if (!SOURCE_NAME.test(source) || !Number.isSafeInteger(window?.from) || !Number.isSafeInteger(window?.to)) throw Error('readings takes a source\'s name and a window of two times in ms');
    const rows = await this.options.record.raw('SELECT value, unit, as_of, source FROM readings WHERE source = ? AND as_of BETWEEN ? AND ? ORDER BY as_of, reading', [source, window.from, window.to]) as { value: string; unit: string; as_of: number; source: string }[];
    return rows.map((r) => ({ source: r.source, value: Number(r.value), unit: r.unit, as_of: r.as_of }));
  }

  async readStream(name: string, limit: number): Promise<StreamRead> {
    const ext = [...this.options.exts.values()].find((e) => e.live && e.sources.get(name)?.variant === 'stream');
    if (!ext) return { status: 'BLOCKED', source: name, cause: `no loaded package registers the stream source ${name}` };
    if (!Number.isSafeInteger(limit) || limit < 1) throw Error('readStream takes a page limit of at least one event');
    const failed = (cause: string): StreamRead => ({ status: 'failed', source: name, cause });
    const cursors = this.options.files.read<string | null>('cursors.json');
    // At run time the stream is the package's own upstream, which its read reaches through its grant.
    let page: unknown;
    try {
      page = await this.options.ask(ext, CALL_MS, `${name}'s read`, 'source.read', { name, stream: null, cursor: cursors[name] ?? null, limit });
    } catch (e) {
      return failed(`its read failed: ${message(e)}`);
    }
    const p = page as { events?: unknown; cursor?: unknown } | null;
    const events = p?.events;
    const isEvent = (e: unknown): e is StreamEvent => isPlain(e) && Number.isSafeInteger(e.seq) && typeof e.kind === 'string' && 'data' in e;
    if (!Array.isArray(events) || events.length > limit || !events.every(isEvent) || (p!.cursor !== null && typeof p!.cursor !== 'string')) return failed('its read gave no page of at most the limit, with a cursor');
    const type = (ext.manifest.sources ?? []).find((s) => s.name === name)?.reading;
    for (const e of type ? events : []) {
      const held = validate(type!, e.data);
      if (!held.ok) return failed(`event ${e.seq} isn't ${type}: ${held.issues[0]!.path || '/'} ${held.issues[0]!.code}`);
    }
    // Read again: another stream's read may have saved its cursor while this one waited.
    this.options.files.save('cursors.json', { ...this.options.files.read<string | null>('cursors.json'), [name]: p!.cursor });
    return { status: 'events', source: name, events };
  }

  /**
   * Each while-shown cadence that is due (#262): one call a period for the source, however many views bind it, while
   * one of them is shown; none once none is, or while the schedule a notice gave its checking job stands in for it.
   */
  async shownTick(): Promise<void> {
    const now = this.options.now();
    const standIn = new Map<string, number>();
    for (const n of Object.values(this.options.files.read<SavedNotice>('notices.json'))) if (n.every !== null) standIn.set(n.source, Math.min(standIn.get(n.source) ?? Infinity, n.every));
    for (const ext of [...this.options.exts.values()].filter((e) => e.live)) {
      for (const source of ext.sources.values()) {
        if (source.variant !== 'polled' || !source.whileShown) continue;
        const every = source.whileShown.every;
        if (!this.sourceShown(source.name, now) || (standIn.get(source.name) ?? Infinity) <= every) {
          this.shownNext.delete(source.name);
          continue;
        }
        const due = this.shownNext.get(source.name) ?? now;
        if (now < due) continue;
        this.shownNext.set(source.name, due + every > now ? due + every : now + every);
        await this.readPolled(ext, source.name);
      }
    }
  }

  /** Whether a view that binds the source is shown: the app reported it in the last 10 s, visible, not minimized, on an awake display, unlocked, and not a replica's. */
  private sourceShown(source: string, now: number): boolean {
    const bound = new Set([...this.options.exts.values()].filter((e) => e.live).flatMap((e) => [...e.views].filter(([, binds]) => binds.some((b) => BOUND.exec(b)?.[1] === source)).map(([view]) => view)));
    for (const { report, at } of this.shown.values()) {
      if (bound.has(report.view) && now - at < SHOWN_MS && report.visible && !report.minimized && report.display_awake && !report.session_locked && !report.replica) return true;
    }
    return false;
  }

  /**
   * `deep.readNow(view)` (#262): every source the plug-in's view binds, read at once, each through its quota. One
   * answered in the last 2 s keeps that answer; one the quota refuses reads `quota` until it can run.
   */
  async readNow(ext: Ext, view: unknown): Promise<{ view: string; sources: { source: string; status: 'kept' | 'read' | 'quota' | 'failed'; until?: number; cause?: string }[] }> {
    const binds = typeof view === 'string' ? ext.views.get(view) : undefined;
    if (!binds) throw Error(`deep.readNow: ${String(view)} isn't a view ${ext.entry.id} registered`);
    const names = [...new Set(binds.map((b) => BOUND.exec(b)![1]!))];
    const now = this.options.now();
    return {
      view: view as string,
      sources: await Promise.all(names.map(async (source) => {
        const owner = [...this.options.exts.values()].find((e) => e.live && e.sources.get(source)?.variant === 'polled');
        if (!owner) return { source, status: 'failed' as const, cause: `no loaded plug-in registers the polled source ${source}` };
        const last = this.sources.last(source);
        if (last && now - last.as_of <= KEPT_MS) return { source, status: 'kept' as const };
        const { read } = await this.readPolled(owner, source);
        if (read.status === 'reading' || read.status === 'batch') return { source, status: 'read' as const };
        return read.until === undefined ? { source, status: 'failed' as const, cause: read.cause } : { source, status: 'quota' as const, until: read.until };
      })),
    };
  }

  async viewsShown(connection: Connection, report: ViewShown): Promise<void> {
    trustedPath(connection, 'a view is reported shown');
    const r = (isPlain(report) ? report : {}) as Record<string, unknown>;
    const flags = ['visible', 'minimized', 'display_awake', 'session_locked', 'replica'] as const;
    if (typeof r.view !== 'string' || typeof r.window !== 'string' || flags.some((f) => typeof r[f] !== 'boolean')) {
      throw Error(`views/shown names its view and window and says whether it is ${flags.join(', ')}`);
    }
    this.shown.set(`${r.view}\n${r.window}`, { report: { ...(r as unknown as ViewShown) }, at: this.options.now() });
  }

  async viewsHidden(connection: Connection, report: { view: string; window: string }): Promise<void> {
    trustedPath(connection, 'a view is reported hidden');
    this.shown.delete(`${report?.view}\n${report?.window}`);
  }

  async boundValues(handles: string[], at?: { log_pos: number }): Promise<BoundValue[]> {
    if (at !== undefined && !Number.isSafeInteger(at?.log_pos)) throw Error('a bound value is pinned to a log position');
    const now = this.options.now();
    return Promise.all(handles.map(async (handle): Promise<BoundValue> => {
      const m = typeof handle === 'string' ? BOUND.exec(handle) : null;
      if (!m) return missing(String(handle), `${String(handle)} isn't reading:<source> or reading:<source>#<series>`);
      const [, source, series] = m as unknown as [string, string, string | undefined];
      if (at) {
        if (series !== undefined) return this.series ? this.series.at(handle, source, series, at.log_pos) : missing(handle, 'this hub keeps no series');
        const [row] = (await this.options.record.raw("SELECT data FROM events WHERE kind = 'reading.recorded' AND log_pos <= ? AND json_extract(data, '$.source') = ? ORDER BY log_pos DESC LIMIT 1", [at.log_pos, source])) as { data: string }[];
        const d = row ? JSON.parse(row.data) as { value: number; as_of: number } : undefined;
        return d ? shownValue(handle, d.value, d.as_of) : missing(handle, `no reading of ${source} at or before log position ${at.log_pos}`);
      }
      const until = this.quotaUntil.get(source);
      if (until !== undefined && now < until) return { handle, status: 'quota', value: null, as_of: null, shown: `quota until ${new Date(until).toISOString()}`, until };
      if (series !== undefined) {
        const v = this.series?.live(source, series);
        return v ? shownValue(handle, v.value, v.as_of) : missing(handle, `no batch of ${source} holds ${series}`);
      }
      const last = this.sources.last(source)?.read;
      return last?.status === 'reading' ? shownValue(handle, last.reading.value, last.reading.as_of) : missing(handle, `no reading of ${source}`);
    }));
  }

  async rollup(source: string, span: Span, start: number): Promise<Record<string, Rollup> | null> {
    const r = this.series ? await this.series.rollup(source, span, start) : null;
    if (typeof r === 'string') throw Error(`the ${span} rollup of ${source} from ${new Date(start).toISOString()} ${r}`);
    return r;
  }

  async heldSecrets(): Promise<{ secret: string; provider: string }[]> {
    const named = [...this.options.exts.entries()].flatMap(([id, ext]) => (ext.manifest.secrets ?? []).map((s) => ({ secret: s.name, provider: id })));
    const held = await Promise.all(named.map((n) => this.sources.holds(n.provider, n.secret)));
    return named.filter((_, i) => held[i]);
  }

  async workFetch(ext: Ext, call: unknown, request: unknown): Promise<unknown> {
    // Only a call of its own work source under way: the hub's call, to the source's host, with its secret and quota.
    const id = ext.entry.id;
    const live = typeof call === 'string' ? this.workCalls.get(call) : undefined;
    if (!live || live.ext !== ext) throw Error(`deep.work.fetch: ${id} has no work source call under way as ${String(call)}`);
    try {
      return await this.sources.workFetch(ext.entry.id, live.source, live.work, request as Parameters<Sources['workFetch']>[3], live.library);
    } catch (e) {
      if (e instanceof NoAnswer) live.noAnswer = true;
      throw e;
    }
  }
  async enterSecret(connection: Connection, extension: string, name: string, value: string, entries: Readonly<Record<string, Entry>>, schedules: SecretSchedules): Promise<{ test: KeyTest; saved: boolean }> {
    trustedPath(connection, 'a secret is entered');
    this.secretOf(entries, extension, name);
    if (typeof value !== 'string' || !value) throw Error(`a value for ${name} is a string`);
    const ext = this.options.exts.get(extension);
    const tested = [...(ext?.live ? ext.sources.values() : [])].find((s): s is Polled => s.variant === 'polled' && s.secret === name && s.keyTest !== null);
    const entered = await this.sources.enter(extension, name, value, tested);
    // A schedule BLOCKED on it runs at the next tick (#365).
    if (entered.saved) schedules.supplied();
    return entered;
  }

  async removeSecret(connection: Connection, extension: string, name: string, answer: { yes: string[] } | undefined, entries: Readonly<Record<string, Entry>>, schedules: SecretSchedules): Promise<{ removed: boolean; blocked: string[] }> {
    trustedPath(connection, 'a secret is removed');
    this.secretOf(entries, extension, name);
    // What plug-ins declared needing it: its sources, and the schedules and checks that read them (#365).
    const sources = [...(this.options.exts.get(extension)?.sources.values() ?? [])].filter((s) => s.variant === 'polled' && s.secret === name).map((s) => s.name);
    const reads = (r: string[]): boolean => r.some((x) => sources.includes(x));
    const blocked = [
      ...sources,
      ...schedules.decls().filter((d) => reads(d.declares.readings)).map((d) => d.name),
      ...[...this.options.exts.values()].flatMap((e) => [...e.checkReads].filter(([, r]) => reads(r)).map(([kind]) => kind)),
    ].sort();
    const yes = [...(answer?.yes ?? [])].sort();
    if (!answer || yes.length !== blocked.length || yes.some((s, i) => s !== blocked[i])) return { removed: false, blocked };
    await this.sources.remove(extension, name, blocked);
    return { removed: true, blocked };
  }

  async signIn(connection: Connection, extension: string, name: string, entries: Readonly<Record<string, Entry>>, schedules: SecretSchedules, browse: ((url: string) => Promise<void>) | undefined): Promise<{ saved: true }> {
    trustedPath(connection, 'a sign-in is made');
    this.secretOf(entries, extension, name);
    const ext = this.options.exts.get(extension);
    const source = [...(ext?.live ? ext.sources.values() : [])].find((s): s is Polled => s.variant === 'polled' && s.secret === name && s.oauth !== null);
    if (!source) throw Error(`no loaded source of ${extension} signs in for ${name}`);
    const signed = await this.sources.signIn(extension, name, source, browse ?? openBrowser);
    schedules.supplied();
    return signed;
  }

  /** The secret a package's manifest names, or a refusal naming it. */
  private secretOf(entries: Readonly<Record<string, Entry>>, extension: string, name: string): void {
    const entry = entries[extension];
    if (!entry) throw Error(`${extension} isn't installed`);
    const manifest = JSON.parse(readFileSync(join(entry.folder, 'deepbuild.json'), 'utf8')) as Manifest;
    if (!(manifest.secrets ?? []).some((s) => s.name === name)) throw Error(`${extension}'s manifest names no secret ${name}`);
  }
}

interface SecretSchedules { supplied(): void; decls(): { name: string; declares: { readings: string[] } }[] }

/** The handle `deep.secret(name)` gives: it names the secret, never holds its value. */
export const handleOf = (name: string): string => `secret:${name}`;
/** Where a package's secret is kept in the secret store. */
const secretKey = (owner: string, name: string): string => `deepbuild/${owner}/${name}`;

/** The largest answer a source call takes. */
const ANSWER = 1024 * 1024;
/** The largest file a library fetch downloads in one call (#1731): under what one base64 string can hold, 384 MiB of bytes. */
const FILE = 380 * 1024 * 1024;
/** Asset downloads keep at most one MiB in memory, even for multi-gigabyte weights. */
const CHUNK = 1024 * 1024;
const HOPS = 5;
const MINUTE = 60_000;
const DAY = 86_400_000;
/** A source that failed waits this long before its next call, doubling with each failure in a row, up to 6 h. */
const BACKOFF_MS = 1_000;
const BACKOFF_CAP_MS = 6 * 3_600_000;
/** How long a sign-in waits for the browser to come back. */
const SIGN_IN_MS = 5 * MINUTE;
const HEADER = /^[A-Za-z0-9-]+$/;
/** The shortest while-shown cadence. */
const SHOWN_MIN_MS = 10_000;
/** How long a work source's provider call has to answer (#66). */
const WORK_MS = 20_000;
/** A work source call that went out with no answer: whether it landed is unknown (#66). */
export class NoAnswer extends Error {}
const whole = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const path = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//');

/**
 * A `deep.registerSource` call, held to what the package declared and was granted: a name and variant its manifest
 * lists, and for a polled source a host its grant names, a secret by a handle its manifest names, sent one way.
 */
export function declareSource(name: unknown, declared: unknown, own: { sources: { name: string; variant: string; reading?: string; host?: string }[]; secrets: { name: string }[]; hosts: string[] }): Declared {
  const d = (typeof declared === 'object' && declared !== null ? declared : {}) as Record<string, unknown>;
  const refuse = (why: string): never => { throw Error(`deep.registerSource: ${String(name)} ${why}`); };
  const listed = own.sources.find((s) => s.name === name && s.variant === d.variant) ?? refuse(`isn't a ${String(d.variant)} source the manifest lists`);
  if (d.variant === 'stream' && listed.reading !== 'work.item@1') return { variant: 'stream', name: name as string, work: null };
  if (d.variant !== 'polled' && d.variant !== 'stream' && d.variant !== 'library') refuse(`is a ${String(d.variant)} source, which this host doesn't call yet`);
  if (typeof d.host !== 'string' || !own.hosts.includes(d.host)) refuse('names a host the grant doesn\'t');
  if (d.variant === 'library' && d.host !== listed.host) refuse(`names ${String(d.host)}, not the host ${String(listed.host)} its manifest lists`);
  if (d.variant === 'polled' && !path(d.path)) refuse('gives no path on its host');
  let secret: string | null = null;
  let auth: Polled['auth'] = null;
  if (d.secret !== undefined) {
    secret = own.secrets.map((s) => s.name).find((s) => handleOf(s) === d.secret) ?? refuse('names a secret by no handle deep.secret gave it');
    const basic = (d.basic as { user?: unknown } | undefined)?.user;
    const ways = [d.header, d.basic, d.bearer].filter((w) => w !== undefined).length;
    if (ways === 1 && typeof d.header === 'string' && HEADER.test(d.header) && d.header.toLowerCase() !== 'host') auth = { header: d.header };
    else if (ways === 1 && typeof basic === 'string' && !basic.includes(':')) auth = { basic };
    else if (ways === 1 && d.bearer === true) auth = { bearer: true };
    else refuse('sends its secret in one header it names, as Basic credentials for a user, or as a bearer token');
  }
  const quota = d.quota as { per_minute?: unknown; per_day?: unknown } | undefined;
  if (!whole(quota?.per_minute) || !whole(quota?.per_day)) refuse('gives no quota of calls per minute and per day');
  // A work source (#66): read item by item through the hub; what a delivery into its threads is decides how it's written.
  if (d.variant === 'stream') {
    if (d.delivers !== 'comment' && d.delivers !== 'chat' && d.delivers !== 'email') refuse('says what a delivery to it is: a comment, a chat reply or an email');
    return { variant: 'stream', name: name as string, work: { host: d.host as string, secret, auth, quota: { per_minute: quota!.per_minute as number, per_day: quota!.per_day as number }, delivers: d.delivers as WorkDecl['delivers'] } };
  }
  if (d.variant === 'library') {
    if (!whole(d.timeout)) refuse('gives no timeout in ms');
    return { variant: 'library', name: name as string, library: { host: d.host as string, secret, auth, quota: { per_minute: quota!.per_minute as number, per_day: quota!.per_day as number }, timeout: d.timeout as number } };
  }
  if (!whole(d.timeout) || !whole(d.freshFor)) refuse('gives no timeout or freshness in ms');
  const keyPath = (d.keyTest as { path?: unknown } | undefined)?.path;
  if (d.keyTest !== undefined && (!secret || !path(keyPath))) refuse('declares a key test with no secret or no path');
  if (d.shape !== undefined && d.shape !== 'number' && d.shape !== 'series') refuse(`declares its shape as a number or a series, not ${String(d.shape)}`);
  // A while-shown cadence its quota can't serve is refused here, naming both (#262).
  let whileShown: Polled['whileShown'] = null;
  if (d.while_shown !== undefined) {
    const every = (d.while_shown as { every?: unknown } | null)?.every;
    if (!Number.isSafeInteger(every) || (every as number) < SHOWN_MIN_MS) refuse(`declares while_shown every ${String(every)} ms; while_shown runs every ${SHOWN_MIN_MS / 1000} s or longer`);
    whileShown = { every: every as number };
    const perMinute = Math.ceil(MINUTE / whileShown.every);
    const perDay = Math.ceil(DAY / whileShown.every);
    if (perMinute > (quota?.per_minute as number) || perDay > (quota?.per_day as number)) {
      refuse(`declares while_shown every ${whileShown.every / 1000} s, ${perMinute} calls a minute and ${perDay} a day, which its quota of ${String(quota?.per_minute)} calls a minute and ${String(quota?.per_day)} a day can't serve`);
    }
  }
  const o = d.oauth as { authorize?: unknown; token?: unknown; client?: unknown; scope?: unknown } | undefined;
  if (o !== undefined && (!secret || !path(o.authorize) || !path(o.token) || typeof o.client !== 'string' || !o.client || (o.scope !== undefined && typeof o.scope !== 'string'))) {
    refuse('declares an OAuth sign-in with no secret, or without its authorize and token paths and its client');
  }
  return {
    variant: 'polled', name: name as string, host: d.host as string, path: d.path as string, secret, auth,
    oauth: o === undefined ? null : { authorize: o.authorize as string, token: o.token as string, client: o.client as string, scope: (o.scope as string | undefined) ?? null },
    quota: { per_minute: quota!.per_minute as number, per_day: quota!.per_day as number }, timeout: d.timeout as number, freshFor: d.freshFor as number,
    keyTest: d.keyTest === undefined ? null : { path: keyPath as string },
    shape: d.shape === 'series' ? 'series' : 'number', whileShown,
  };
}

/** An answer that exceeded its byte cap; callers retain their own refusal wording. */
export class AnswerTooLarge extends Error {}

/** Source transport, including the asset reachability probe. */
export const nodeHttp: HttpClient = async (request, signal) => {
  // Reachability before an asset ask sends no HTTP request and reads no byte. It is still a Source call,
  // under its quota and timeout, recorded/replayed like the later authorized GETs.
  if (request.method === 'CONNECT') return new Promise((resolve, reject) => {
    const url = new URL(request.url);
    const socket = createConnection({ host: url.hostname, port: Number(url.port) || 443, signal });
    socket.once('connect', () => { socket.destroy(); resolve({ status: 200, headers: {}, body: '' }); });
    socket.once('error', reject);
  });
  return nodeFetch(request, signal);
};
/** Node's HTTP fetch, never following a redirect, an answer cut at its cap. */
export const nodeFetch: HttpClient = async (request, signal) => {
  const res = await fetch(request.url, { method: request.method, headers: request.headers, redirect: 'manual', signal, ...(request.body === undefined ? {} : { body: request.body }) });
  const chunks: Uint8Array[] = [];
  let size = 0;
  const ranged = request.encoding === 'base64' && request.headers.range !== undefined;
  const cap = ranged ? CHUNK : request.encoding === 'base64' ? FILE : ANSWER;
  if (ranged && Number(res.headers.get('content-length')) > cap) {
    await res.body?.cancel();
    return { status: res.status, headers: {}, body: '', refused: res.status === 200 ? 'range_not_supported' : 'invalid_range_response' };
  }
  let partial = false;
  try {
    for await (const chunk of res.body ?? []) {
      size += chunk.byteLength;
      if (size > cap) throw new AnswerTooLarge(`the answer from ${new URL(request.url).host} is over ${cap} bytes`);
      chunks.push(chunk);
    }
  } catch (e) {
    if (ranged && size > cap) return { status: res.status, headers: {}, body: '', refused: res.status === 200 ? 'range_not_supported' : 'invalid_range_response' };
    if (!ranged || !size) throw e;
    partial = true;
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: Buffer.concat(chunks).toString(request.encoding === 'base64' ? 'base64' : 'utf8'), ...(partial ? { partial: true } : {}) };
};
/** No OS secret store this host can reach: nothing is held, so what needs a secret is BLOCKED, and none can be entered. */
const noSecrets: SecretStore = {
  get: async () => undefined,
  set: async () => { throw Error('this host has no secret store to keep a secret in'); },
  delete: async () => undefined,
};

const SECURITY = '/usr/bin/security';
const SERVICE = 'deepbuild.secret';
/** `security`'s exit code for an item that isn't there. */
const NOT_FOUND = 44;
/**
 * The macOS Keychain: your login keychain, or the one at `keychain`. A value goes to `security` on its standard input,
 * as hex, never on a command line another process could read.
 */
export function keychainStore(keychain?: string): SecretStore {
  const plain = /^[A-Za-z0-9._/-]+$/;
  const at = keychain === undefined ? [] : [keychain];
  const named = (key: string): string => { if (!plain.test(key)) throw Error(`${key} isn't a secret's key`); return key; };
  const run = (args: string[]): Promise<{ code: number; out: string }> => new Promise((done) => {
    execFile(SECURITY, args, { timeout: 10_000 }, (error, out) => done({ code: error ? Number((error as { code?: unknown }).code ?? 1) : 0, out }));
  });
  return {
    async get(key) {
      const { code, out } = await run(['find-generic-password', '-s', SERVICE, '-a', named(key), '-w', ...at]);
      if (code === NOT_FOUND) return undefined;
      if (code !== 0) throw Error(`the Keychain didn't read ${key} (security exited ${code})`);
      return out.endsWith('\n') ? out.slice(0, -1) : out;
    },
    async set(key, value) {
      if (keychain !== undefined && !plain.test(keychain)) throw Error(`${keychain} isn't a keychain's path`);
      const line = `add-generic-password -U -s ${SERVICE} -a ${named(key)} -X ${Buffer.from(value, 'utf8').toString('hex')}${keychain === undefined ? '' : ` ${keychain}`}\n`;
      const code = await new Promise<number>((done) => {
        const child = spawn(SECURITY, ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
        let failed = false;
        child.stderr.on('data', () => { failed = true; });
        child.on('error', () => done(1));
        child.on('close', (c) => done(failed ? 1 : c ?? 1));
        child.stdin.end(line);
      });
      if (code !== 0) throw Error(`the Keychain didn't keep ${key}`);
    },
    async delete(key) {
      const { code } = await run(['delete-generic-password', '-s', SERVICE, '-a', named(key), ...at]);
      if (code !== 0 && code !== NOT_FOUND) throw Error(`the Keychain didn't remove ${key} (security exited ${code})`);
    },
  };
}
const SECRET_TOOL = '/usr/bin/secret-tool';
/**
 * The Secret Service on Linux, through secret-tool: a value goes on its standard input and comes back on its standard
 * output, never on a command line another process could read, under the attributes the Keychain's item names.
 */
export function secretServiceStore(): SecretStore {
  const item = (key: string): string[] => { if (!/^[A-Za-z0-9._/-]+$/.test(key)) throw Error(`${key} isn't a secret's key`); return ['service', SERVICE, 'account', key]; };
  const run = (args: string[], input?: string): Promise<{ code: number; out: string; err: string }> => new Promise((done) => {
    const child = execFile(SECRET_TOOL, args, { timeout: 10_000 }, (error, out, err) => done({ code: error ? Number((error as { code?: unknown }).code ?? 1) : 0, out, err }));
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ?? '');
  });
  return {
    async get(key) {
      const { code, out, err } = await run(['lookup', ...item(key)]);
      // Exit 1 with nothing said is an item that isn't there.
      if (code === 1 && !err.trim()) return undefined;
      if (code !== 0) throw Error(`the Secret Service didn't read ${key}: ${err.trim().slice(0, 200)}`);
      return out;
    },
    async set(key, value) {
      const { code, err } = await run(['store', `--label=DeepBuild ${key}`, ...item(key)], value);
      if (code !== 0) throw Error(`the Secret Service didn't keep ${key}: ${err.trim().slice(0, 200)}`);
    },
    async delete(key) {
      const { code, err } = await run(['clear', ...item(key)]);
      if (code !== 0 && err.trim()) throw Error(`the Secret Service didn't remove ${key}: ${err.trim().slice(0, 200)}`);
    },
  };
}
/** The OS secret store this platform has: the Keychain on macOS, the Secret Service on Linux. */
export const osSecrets = (): SecretStore => (process.platform === 'darwin' ? keychainStore() : process.platform === 'linux' ? secretServiceStore() : noSecrets);
/** Opens your browser at a sign-in page. */
export const openBrowser = (url: string): Promise<void> => new Promise((done, fail) => {
  if (process.platform !== 'darwin') return fail(Error('this host opens no browser for a sign-in'));
  execFile('/usr/bin/open', [url], { timeout: 10_000 }, (error) => (error ? fail(error) : done()));
});

type Outcome = HttpAnswer | { error: string };
/** What the record keeps of a source's calls and readings, appended as the core. */
type Append = (kind: 'source.called' | 'reading.recorded', data: Record<string, unknown>) => Promise<void>;

/** The hub's side of every source: its calls, cache, quotas, back-off, recording and the secret values it holds to scrub. */
export class Sources {
  /** Each source's last answer: its reading or batch, with the handle the record holds it by. */
  private readonly cache = new Map<string, { as_of: number; read: SourceRead; handle: string }>();
  private readonly spent = new Map<string, number[]>();
  private readonly backoff = new Map<string, { until: number; gap: number }>();
  private readonly recorded: RecordedCall[] = [];
  private readonly binary = new Map<number, { file: string; offset: number; size: number; sha256: string }>();
  private readonly replayed = new Set<number>();
  /** Every secret value the hub read or was given: each is scrubbed from what a package gets and from the recording. */
  private readonly held = new Set<string>();

  constructor(private readonly options: {
    now: () => number; http: HttpClient; secrets: SecretStore; append: Append; replay?: Recording;
    /** A series call's values, landed as one batch (#262). */
    land?: (source: Polled, asOf: number, values: Map<string, number>) => Promise<Batch>;
  }) {}

  /** The source's last answer, fresh or not: what Read now keeps and a live bound value shows (#262). */
  last(name: string): { as_of: number; read: SourceRead; handle: string } | undefined {
    return this.cache.get(name);
  }

  recording(): Recording {
    const calls = structuredClone(this.recorded);
    for (const [at, ref] of this.binary) {
      const bytes = Buffer.alloc(ref.size);
      let fd: number;
      try { fd = openSync(ref.file, 'r'); } catch { calls[at]!.answer = { error: 'asset_refused' }; continue; }
      try {
        if (statSync(ref.file).size < ref.offset + ref.size || readSync(fd, bytes, 0, bytes.length, ref.offset) !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw Error('recording has missing or changed asset bytes');
      } finally { closeSync(fd); }
      const answer = calls[at]!.answer;
      if (!('error' in answer)) answer.body = bytes.toString('base64');
    }
    return { v: 1, calls };
  }

  /** Whether the secret store holds a package's secret now. */
  async holds(owner: string, name: string): Promise<boolean> {
    return this.options.replay !== undefined || (await this.options.secrets.get(secretKey(owner, name))) !== undefined;
  }
  /**
   * A reading of the source: from the cache while it's fresh, else one call, parsed by the package once scrubbed. As a
   * schedule's run needs it (#365): with the handle of the reading.recorded it came from, and whether the
   * call was held, by a rate limit or a 5xx from the provider, or by the hub's own quota or back-off.
   */
  async readOne(owner: string, source: Polled, parse: (answer: HttpAnswer) => Promise<unknown>): Promise<{ read: SourceRead; handle: string | null; held: boolean }> {
    const now = this.options.now();
    const cached = this.cache.get(source.name);
    if (cached && now - cached.as_of < source.freshFor) return { read: structuredClone(cached.read), handle: cached.handle, held: false };
    let held = false;
    const stop = (status: 'BLOCKED' | 'failed', cause: string, until?: number): { read: SourceRead; handle: null; held: boolean } => ({ read: { status, source: source.name, cause, ...(until === undefined ? {} : { until }) }, handle: null, held });
    // A replay reads no secret: a recording holds none.
    let value: string | undefined;
    if (source.secret && !this.options.replay) {
      value = await this.options.secrets.get(secretKey(owner, source.secret));
      if (value === undefined) return stop('BLOCKED', `missing secret ${source.secret}`);
      this.held.add(value);
    }
    const back = this.backoff.get(source.name);
    held = true;
    if (back && now < back.until) return stop('failed', `backing off until ${new Date(back.until).toISOString()}`);
    const times = (this.spent.get(source.name) ?? []).filter((t) => now - t < DAY);
    const minute = times.filter((t) => now - t < MINUTE);
    // A call the quota refuses says when it can run: once the oldest call in the window leaves it.
    const spent = minute.length >= source.quota.per_minute ? { per: 'minute', n: source.quota.per_minute, until: minute[minute.length - source.quota.per_minute]! + MINUTE }
      : times.length >= source.quota.per_day ? { per: 'day', n: source.quota.per_day, until: times[times.length - source.quota.per_day]! + DAY } : null;
    if (spent) return stop('failed', `quota: ${spent.n} calls a ${spent.per}, until ${new Date(spent.until).toISOString()}`, spent.until);
    this.spent.set(source.name, [...times, now]);
    held = false;
    let url = `https://${source.host}${source.path}`;
    for (let hop = 0; ; hop++) {
      const answer = await this.call(source, { url, method: 'GET', headers: this.headers(source, value) });
      // No answer, a rate limit or the provider's own failure: the next call waits, twice as long each time in a row.
      if ('error' in answer || answer.status === 429 || answer.status >= 500) {
        const gap = back ? Math.min(back.gap * 2, BACKOFF_CAP_MS) : BACKOFF_MS;
        this.backoff.set(source.name, { until: now + gap, gap });
        held = !('error' in answer);
        if ('error' in answer) return stop('failed', answer.error);
      } else {
        this.backoff.delete(source.name);
      }
      const location = answer.status >= 300 && answer.status < 400 ? answer.headers.location : undefined;
      if (location === undefined) {
        let parsed: unknown;
        try {
          parsed = await parse(answer);
        } catch (e) {
          return stop('failed', `no reading: ${this.scrub(e instanceof Error ? e.message : String(e))}`);
        }
        if (source.shape === 'series') return this.series(source, parsed, now);
        const { value: v, unit } = (parsed ?? {}) as { value?: unknown; unit?: unknown };
        if (typeof v !== 'number' || !Number.isFinite(v) || typeof unit !== 'string' || !unit) {
          // What it returned goes back scrubbed, so the plug-in's author sees what to fix (#366).
          let returned: string;
          try { returned = JSON.stringify(parsed) ?? String(parsed); } catch { returned = String(parsed); }
          return stop('failed', `no reading: a parser returns { value, unit }, one finite number and its unit, and this one returned ${this.scrub(returned.slice(0, 200))}`);
        }
        const reading: Reading = { source: source.name, value: v, unit, as_of: now };
        const handle = `reading:${ulid(now)}`;
        await this.options.append('reading.recorded', { reading: handle, value: v, unit, as_of: now, source: source.name, n: 1, outside: false });
        const read: SourceRead = { status: 'reading', reading };
        this.cache.set(source.name, { as_of: now, read, handle });
        return { read: structuredClone(read), handle, held: false };
      }
      // The client never follows a redirect: the hub does, only to the source's own host, which the handle goes to.
      let next: URL | undefined;
      try { next = new URL(location, url); } catch { /* unreadable: no host the source names */ }
      if (next?.protocol !== 'https:' || next.host !== source.host) return stop('BLOCKED', `off-host redirect to ${next?.host || 'an unreadable location'}`);
      if (hop >= HOPS) return stop('failed', `more than ${HOPS} redirects`);
      url = next.href;
    }
  }

  /** A series call's values (#262): up to 10,000 finite numbers by name, landed as one batch; past that, no reading. */
  private async series(source: Polled, parsed: unknown, now: number): Promise<{ read: SourceRead; handle: string | null; held: boolean }> {
    const failed = (cause: string) => ({ read: { status: 'failed' as const, source: source.name, cause }, handle: null, held: false });
    const values = (parsed as { values?: unknown } | null)?.values;
    if (typeof values !== 'object' || values === null || Array.isArray(values)) return failed('no reading: a series parser returns { values, unit }, its values a record of numbers by name');
    const entries = Object.entries(values);
    if (entries.length > SERIES_MAX) return failed(`no reading: the call returned ${entries.length.toLocaleString('en-US')} values, over a series' ${SERIES_MAX.toLocaleString('en-US')}`);
    const bad = entries.find(([name, v]) => !name || name.includes('\n') || typeof v !== 'number' || !Number.isFinite(v));
    if (bad) return failed(`no reading: the series value ${JSON.stringify(bad[0]).slice(0, 100)} isn't a finite number by a name`);
    if (!this.options.land) return failed('no reading: this host keeps no series');
    const batch = await this.options.land(source, now, new Map(entries as [string, number][]));
    const read: SourceRead = { status: 'batch', batch };
    this.cache.set(source.name, { as_of: now, read, handle: batch.handle });
    return { read: structuredClone(read), handle: batch.handle, held: false };
  }

  /**
   * The value as you entered it on the trusted path: a key test, when the source declares one, calls once with it.
   * The source refusing the key reads invalid and saves nothing; a test that couldn't run reads INCONCLUSIVE and saves.
   */
  async enter(owner: string, name: string, value: string, test: Polled | undefined): Promise<{ test: KeyTest; saved: boolean }> {
    this.held.add(value);
    let result: KeyTest = 'untested';
    if (test?.keyTest) {
      const answer = await this.call(test, { url: `https://${test.host}${test.keyTest.path}`, method: 'GET', headers: this.headers(test, value) });
      result = 'error' in answer || answer.status === 429 || answer.status >= 500 ? 'INCONCLUSIVE'
        : answer.status >= 200 && answer.status < 300 ? 'valid'
          : answer.status === 401 || answer.status === 403 ? 'invalid' : 'INCONCLUSIVE';
    }
    if (result === 'invalid') return { test: result, saved: false };
    await this.options.secrets.set(secretKey(owner, name), value);
    return { test: result, saved: true };
  }

  /** The secret leaves the store, and the readings of the sources that needed it leave the cache. */
  async remove(owner: string, name: string, sources: string[]): Promise<void> {
    await this.options.secrets.delete(secretKey(owner, name));
    for (const s of sources) this.cache.delete(s);
  }

  /**
   * Sign-in through an OAuth loopback (RFC 8252, with PKCE): your browser opens the source's authorize page with a
   * redirect to a listener on 127.0.0.1 that lives for this sign-in only; a code that comes back with this sign-in's
   * state is exchanged on the source's host, and the token is saved as the secret. Another state saves nothing.
   */
  async signIn(owner: string, name: string, source: Polled, browse: (url: string) => Promise<void>): Promise<{ saved: true }> {
    const o = source.oauth!;
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('base64url');
    // node:http loads only for a sign-in, never in a hub that runs none.
    const { createServer } = await import('node:http');
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    let timer: NodeJS.Timeout | undefined;
    const code = new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(Error(`no sign-in came back within ${SIGN_IN_MS / MINUTE} minutes; nothing is saved`)), SIGN_IN_MS);
      server.on('request', (req, res) => {
        const u = new URL(req.url ?? '/', redirect);
        if (u.pathname !== '/callback') return void res.writeHead(404).end();
        const got = u.searchParams.get('code');
        const ok = u.searchParams.get('state') === state && got !== null;
        res.writeHead(ok ? 200 : 400, { 'content-type': 'text/plain' }).end(ok ? 'Signed in. You can close this tab.' : 'This sign-in was refused.');
        if (ok) resolve(got);
        else reject(Error(u.searchParams.get('state') === state ? `the sign-in came back with no code${u.searchParams.has('error') ? ` (${u.searchParams.get('error')})` : ''}; nothing is saved` : 'the sign-in came back with another state; nothing is saved'));
      });
    });
    code.catch(() => undefined);
    try {
      const authorize = new URL(`https://${source.host}${o.authorize}`);
      for (const [k, v] of Object.entries({ response_type: 'code', client_id: o.client, redirect_uri: redirect, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...(o.scope ? { scope: o.scope } : {}) })) authorize.searchParams.set(k, v);
      await browse(authorize.href);
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: await code, redirect_uri: redirect, client_id: o.client, code_verifier: verifier }).toString();
      const answer = await this.options.http({ url: `https://${source.host}${o.token}`, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body }, AbortSignal.timeout(source.timeout));
      let token: unknown;
      try { token = (JSON.parse(answer.body) as { access_token?: unknown }).access_token; } catch { /* no token */ }
      if (answer.status < 200 || answer.status > 299 || typeof token !== 'string' || !token) throw Error(`the token call answered ${answer.status} with no access token; nothing is saved`);
      this.held.add(token);
      await this.options.secrets.set(secretKey(owner, name), token);
      this.cache.delete(source.name);
      return { saved: true };
    } finally {
      clearTimeout(timer);
      server.close();
      server.closeAllConnections();
    }
  }

  /**
   * One provider call of a work source (#66), made by the hub: to its host only, its secret added by handle, under its
   * quota (the call is refused, and made no more, once the minute's or the day's calls are spent), recorded and scrubbed
   * as any source call. `noAnswer` is set when the request went out and no answer came, so whether it landed is unknown.
   */
  /** A work source's call (#66), or a library source's (#1731) under its own timeout, a file's bytes as base64. */
  async workFetch(owner: string, name: string, work: Omit<WorkDecl, 'delivers'>, request: { method: string; path: string; headers?: Record<string, string>; body?: string }, library?: { timeout: number; encoding?: 'base64'; recording?: { file: string; offset: number } }): Promise<HttpAnswer> {
    if (!['GET', 'POST', 'CONNECT'].includes(request?.method) || !path(request.path)) throw Error(`${name}'s call names no method and path on ${work.host}`);
    const now = this.options.now();
    const key = `${library ? 'library' : 'work'}:${name}`;
    const times = (this.spent.get(key) ?? []).filter((t) => now - t < DAY);
    const minute = times.filter((t) => now - t < MINUTE);
    if (minute.length >= work.quota.per_minute || times.length >= work.quota.per_day) {
      const until = minute.length >= work.quota.per_minute ? minute[0]! + MINUTE : times[0]! + DAY;
      throw Object.assign(Error(`${name}'s quota of ${work.quota.per_minute} calls a minute and ${work.quota.per_day} a day is spent until ${new Date(until).toISOString()}`), { until });
    }
    let value: string | undefined;
    if (work.secret) {
      value = await this.options.secrets.get(secretKey(owner, work.secret));
      if (value === undefined) throw Error(`missing secret ${work.secret}`);
      this.held.add(value);
    }
    this.spent.set(key, [...times, now]);
    const source: Polled = {
      variant: 'polled', name, host: work.host, path: request.path, secret: work.secret, auth: work.auth, oauth: null, quota: work.quota,
      timeout: library?.timeout ?? WORK_MS, freshFor: 1, keyTest: null, shape: 'number', whileShown: null,
    };
    const headers = { ...Object.fromEntries(Object.entries(request.headers ?? {}).filter(([k]) => typeof k === 'string' && k.toLowerCase() !== 'host').map(([k, v]) => [k, String(v)])), ...this.headers(source, value) };
    const answer = await this.call(source, { url: `https://${work.host}${request.path}`, method: request.method, headers, ...(typeof request.body === 'string' ? { body: request.body } : {}), ...(library?.encoding ? { encoding: library.encoding } : {}), ...(library?.recording ? { recording: library.recording } : {}) });
    if ('error' in answer) throw new NoAnswer(`${work.host} gave no answer: ${answer.error}`);
    return answer;
  }

  /** A networked asset job's file: quota on each bounded range, resumable on no answer, admitted only by its hash. */
  async download(owner: string, name: string, source: Omit<WorkDecl, 'delivers'> & { timeout?: number }, path: string, spec: { file: string; sha256: string; size: number; kept?: string }): Promise<string> {
    const disk = await statfs(dirname(spec.file));
    const free = disk.bavail * disk.bsize;
    if (BigInt(free) * 5n < BigInt(spec.size) * 11n) throw Error(`${path}: ${spec.size} bytes needs 2.2× free on disk; only ${free} bytes free`);
    let offset = await stat(spec.file).then((s) => s.size, () => 0);
    const invalid = async (why: string): Promise<never> => { await rm(spec.file, { force: true }); throw Error(`${path}: ${why}`); };
    if (offset > spec.size) return invalid(`partial file exceeds its listed ${spec.size} bytes`);
    await mkdir(dirname(spec.file), { recursive: true });
    if (!offset) await writeFile(spec.file, new Uint8Array());
    while (offset < spec.size) {
      const end = Math.min(spec.size - 1, offset + CHUNK - 1);
      const answer = await this.workFetch(owner, name, source, { method: 'GET', path, headers: { range: `bytes=${offset}-${end}` } }, { timeout: source.timeout ?? WORK_MS, encoding: 'base64', recording: { file: spec.kept ?? spec.file, offset } });
      if (answer.refused) return invalid(answer.refused);
      const bytes = Buffer.from(answer.body, 'base64');
      if (answer.status === 206) {
        if (answer.headers['content-range'] !== `bytes ${offset}-${end}/${spec.size}` || (answer.partial ? bytes.length > end - offset + 1 : bytes.length !== end - offset + 1)) return invalid('invalid_range_response');
      } else if (answer.status !== 200 || offset !== 0 || (answer.partial ? bytes.length > spec.size : bytes.length !== spec.size)) {
        return invalid(`answered ${answer.status}, not the requested range or ${spec.size} bytes`);
      }
      await appendFile(spec.file, bytes);
      offset += bytes.length;
      // A partial body still advanced the cursor. Continue from there; a call that gets no answer at all
      // ends BLOCKED, leaving these bytes for the next authorized use.
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(spec.file)) hash.update(chunk);
    if (hash.digest('hex') !== spec.sha256) return invalid(`bytes do not match listed sha256 ${spec.sha256}; removed`);
    return spec.file;
  }

  private headers(source: Polled, value: string | undefined): Record<string, string> {
    if (value === undefined || !source.auth) return {};
    if ('header' in source.auth) return { [source.auth.header]: value };
    return { authorization: 'basic' in source.auth ? `Basic ${Buffer.from(`${source.auth.basic}:${value}`).toString('base64')}` : `Bearer ${value}` };
  }

  /**
   * One call, from the recording when replaying and else through the client within the source's timeout: recorded,
   * its cost to the record, and scrubbed before anyone reads it.
   */
  private async call(source: Polled, request: HttpRequest): Promise<Outcome> {
    const stripped: HttpRequest = { url: this.scrub(request.url), method: request.method, headers: this.scrubAll(request.headers) };
    const replay = this.options.replay;
    if (replay) {
      const at = replay.calls.findIndex((c, i) => !this.replayed.has(i) && c.source === source.name && c.request.method === stripped.method && c.request.url === stripped.url && c.request.headers.range === stripped.headers.range);
      if (at < 0) return { error: `no recorded call answers ${stripped.method} ${stripped.url}` };
      this.replayed.add(at);
      const answer = replay.calls[at]!.answer;
      return 'error' in answer ? { error: describe(answer.error, source) } : this.scrubAnswer(answer);
    }
    const signal = AbortSignal.timeout(source.timeout);
    const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    const started = performance.now();
    let answer: RecordedCall['answer'];
    let bytes = 0;
    try {
      const got = await Promise.race([this.options.http(request, signal), aborted]);
      // A file's body is base64 text: its bytes are what the text carries.
      bytes = Buffer.byteLength(got.body, request.encoding === 'base64' ? 'base64' : 'utf8');
      answer = this.scrubAnswer(got);
    } catch {
      answer = { error: signal.aborted ? 'timeout' : 'unreachable' };
    }
    if (request.recording && !('error' in answer)) {
      const bytes = Buffer.from(answer.body, 'base64');
      this.binary.set(this.recorded.length, { ...request.recording, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      this.recorded.push({ source: source.name, request: stripped, answer: { ...answer, body: '' } });
    } else this.recorded.push({ source: source.name, request: stripped, answer: structuredClone(answer) });
    await this.options.append('source.called', {
      source: source.name, host: new URL(request.url).host, outcome: 'error' in answer ? answer.error : answer.partial ? 'unreachable' : 'answered',
      ...('error' in answer || request.method === 'CONNECT' ? {} : { status: answer.status }), ms: Math.round(performance.now() - started), bytes,
    });
    return 'error' in answer ? { error: describe(answer.error, source) } : answer;
  }

  private scrub(text: string): string {
    return this.held.size ? scrubValues(text, { held: [...this.held] }) : text;
  }
  private scrubAll(headers: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(headers).map(([k, v]) => [this.scrub(k.toLowerCase()), this.scrub(String(v))]));
  }
  private scrubAnswer(answer: HttpAnswer): HttpAnswer {
    return { status: answer.status, headers: this.scrubAll(answer.headers), body: this.scrub(answer.body), ...(answer.partial ? { partial: true } : {}), ...(answer.refused ? { refused: answer.refused } : {}) };
  }
}

const describe = (error: string, source: Polled): string => (error === 'timeout' ? `timeout after ${source.timeout} ms` : error === 'unreachable' ? `${source.host} unreachable` : error);
