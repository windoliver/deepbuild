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
import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs';
import { appendFile, mkdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createConnection, type AddressInfo } from 'node:net';
import { scrubValues } from '@deepbuild/evidence';
import { ulid } from '@deepbuild/record';
import { SERIES_MAX } from './series.js';

/** One outside call the hub makes for a source, as it hands it to its HTTP client. */
export interface HttpRequest { url: string; method: string; headers: Record<string, string>; body?: string; /** A file's bytes (#1731): the answer's body as base64. */ encoding?: 'base64'; /** A binary recording refers to its downloaded bytes, never retains every chunk in memory. */ recording?: { file: string; offset: number } }
/** What came back, as the client got it: header names lower-case, a 3xx as it is, with its Location. */
export interface HttpAnswer { status: number; headers: Record<string, string>; body: string; partial?: true; refused?: 'range_not_supported' | 'invalid_range_response' }
/** The hub's HTTP client for source calls: it never follows a redirect, rejects when the host can't be reached, and stops when `signal` aborts. */
export type HttpClient = (request: HttpRequest, signal: AbortSignal) => Promise<HttpAnswer>;
/** The OS secret store as the hub reaches it (the Keychain on macOS). */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
/** One source call as recorded: no form of any secret value anywhere in it. */
export interface RecordedCall { source: string; request: HttpRequest; answer: HttpAnswer | { error: 'timeout' | 'unreachable' | 'asset_refused' } }
export interface Recording { v: 1; calls: RecordedCall[] }
/** A reading: the parser's value and unit, with the source and the as-of time of the call that fetched it. */
export interface Reading { source: string; value: number; unit: string; as_of: number }
/** A series call's values, kept in one evidence file named by one reading.batch event (#262). */
export interface Batch { handle: string; source: string; as_of: number; file: string; count: number }
/** A read: a number's reading, a series' batch, or why there is none; `until`, when the quota refused it, is when it can run. */
export type SourceRead = { status: 'reading'; reading: Reading } | { status: 'batch'; batch: Batch } | { status: 'BLOCKED' | 'failed'; source: string; cause: string; until?: number };
export type KeyTest = 'valid' | 'invalid' | 'INCONCLUSIVE' | 'untested';
/** One event of a stream source, as source@1 has it. */
export interface StreamEvent { seq: number; kind: string; data: unknown }
export type StreamRead = { status: 'events'; source: string; events: StreamEvent[] } | { status: 'BLOCKED' | 'failed'; source: string; cause: string };

/** A polled source as its package declared it, checked: functions stay with the package. */
export interface Polled {
  variant: 'polled'; name: string; host: string; path: string;
  /** The secret's name in the manifest, or null for a source that needs none. */
  secret: string | null;
  auth: { header: string } | { basic: string } | { bearer: true } | null;
  /** Sign-in through an OAuth loopback (RFC 8252), its endpoints on the source's own host; the token is the secret. */
  oauth: { authorize: string; token: string; client: string; scope: string | null } | null;
  quota: { per_minute: number; per_day: number };
  timeout: number; freshFor: number;
  keyTest: { path: string } | null;
  /** A number, or a series of up to 10,000 named values a call (#262). */
  shape: 'number' | 'series';
  /** A cadence the hub runs only while a view that binds the source is shown (#262). */
  whileShown: { every: number } | null;
}
/**
 * A work source (#66): a stream source whose reading is work.item@1, read through the hub. Its provider calls go to its
 * host only, with its secret by handle, under its quota; `delivers` says what a delivery into its threads is.
 */
export interface WorkDecl { host: string; secret: string | null; auth: Polled['auth']; quota: { per_minute: number; per_day: number }; delivers: 'comment' | 'chat' | 'email' }
/**
 * A library source (#1731), asset.library@1's fill: its search and fetch run in the package, every call they make and
 * every byte of a picked asset going through the hub to its one host, with its secret by handle, its quota and timeout.
 */
export interface LibraryDecl extends Omit<WorkDecl, 'delivers'> { timeout: number }
export type Declared = Polled | { variant: 'stream'; name: string; work: WorkDecl | null } | { variant: 'library'; name: string; library: LibraryDecl };

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
