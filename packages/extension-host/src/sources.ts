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
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { scrubValues } from '@deepbuild/evidence';
import { ulid } from '@deepbuild/record';

/** One outside call the hub makes for a source, as it hands it to its HTTP client. */
export interface HttpRequest { url: string; method: string; headers: Record<string, string>; body?: string }
/** What came back, as the client got it: header names lower-case, a 3xx as it is, with its Location. */
export interface HttpAnswer { status: number; headers: Record<string, string>; body: string }
/** The hub's HTTP client for source calls: it never follows a redirect, rejects when the host can't be reached, and stops when `signal` aborts. */
export type HttpClient = (request: HttpRequest, signal: AbortSignal) => Promise<HttpAnswer>;
/** The OS secret store as the hub reaches it (the Keychain on macOS). */
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
/** One source call as recorded: no form of any secret value anywhere in it. */
export interface RecordedCall { source: string; request: HttpRequest; answer: HttpAnswer | { error: 'timeout' | 'unreachable' } }
export interface Recording { v: 1; calls: RecordedCall[] }
/** A reading: the parser's value and unit, with the source and the as-of time of the call that fetched it. */
export interface Reading { source: string; value: number; unit: string; as_of: number }
export type SourceRead = { status: 'reading'; reading: Reading } | { status: 'BLOCKED' | 'failed'; source: string; cause: string };
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
}
export type Declared = Polled | { variant: 'stream'; name: string };

/** The handle `deep.secret(name)` gives: it names the secret, never holds its value. */
export const handleOf = (name: string): string => `secret:${name}`;
/** Where a package's secret is kept in the secret store. */
export const secretKey = (owner: string, name: string): string => `deepbuild/${owner}/${name}`;

/** The largest answer a source call takes. */
const ANSWER = 1024 * 1024;
const HOPS = 5;
const MINUTE = 60_000;
const DAY = 86_400_000;
/** A source that failed waits this long before its next call, doubling with each failure in a row, up to 6 h. */
const BACKOFF_MS = 1_000;
const BACKOFF_CAP_MS = 6 * 3_600_000;
/** How long a sign-in waits for the browser to come back. */
const SIGN_IN_MS = 5 * MINUTE;
const HEADER = /^[A-Za-z0-9-]+$/;
const whole = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const path = (p: unknown): p is string => typeof p === 'string' && p.startsWith('/') && !p.startsWith('//');

/**
 * A `deep.registerSource` call, held to what the package declared and was granted: a name and variant its manifest
 * lists, and for a polled source a host its grant names, a secret by a handle its manifest names, sent one way.
 */
export function declareSource(name: unknown, declared: unknown, own: { sources: { name: string; variant: string }[]; secrets: { name: string }[]; hosts: string[] }): Declared {
  const d = (typeof declared === 'object' && declared !== null ? declared : {}) as Record<string, unknown>;
  const refuse = (why: string): never => { throw Error(`deep.registerSource: ${String(name)} ${why}`); };
  if (!own.sources.some((s) => s.name === name && s.variant === d.variant)) refuse(`isn't a ${String(d.variant)} source the manifest lists`);
  if (d.variant === 'stream') return { variant: 'stream', name: name as string };
  if (d.variant !== 'polled') refuse(`is a ${String(d.variant)} source, which this host doesn't call yet`);
  if (typeof d.host !== 'string' || !own.hosts.includes(d.host)) refuse('names a host the grant doesn\'t');
  if (!path(d.path)) refuse('gives no path on its host');
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
  if (!whole(d.timeout) || !whole(d.freshFor)) refuse('gives no timeout or freshness in ms');
  const keyPath = (d.keyTest as { path?: unknown } | undefined)?.path;
  if (d.keyTest !== undefined && (!secret || !path(keyPath))) refuse('declares a key test with no secret or no path');
  const o = d.oauth as { authorize?: unknown; token?: unknown; client?: unknown; scope?: unknown } | undefined;
  if (o !== undefined && (!secret || !path(o.authorize) || !path(o.token) || typeof o.client !== 'string' || !o.client || (o.scope !== undefined && typeof o.scope !== 'string'))) {
    refuse('declares an OAuth sign-in with no secret, or without its authorize and token paths and its client');
  }
  return {
    variant: 'polled', name: name as string, host: d.host as string, path: d.path as string, secret, auth,
    oauth: o === undefined ? null : { authorize: o.authorize as string, token: o.token as string, client: o.client as string, scope: (o.scope as string | undefined) ?? null },
    quota: { per_minute: quota!.per_minute as number, per_day: quota!.per_day as number }, timeout: d.timeout as number, freshFor: d.freshFor as number,
    keyTest: d.keyTest === undefined ? null : { path: keyPath as string },
  };
}

/** Node's fetch, never following a redirect, an answer cut at its cap. */
export const nodeHttp: HttpClient = async (request, signal) => {
  const res = await fetch(request.url, { method: request.method, headers: request.headers, redirect: 'manual', signal, ...(request.body === undefined ? {} : { body: request.body }) });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.byteLength;
    if (size > ANSWER) throw Error(`the answer from ${new URL(request.url).host} is over ${ANSWER} bytes`);
    chunks.push(chunk);
  }
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return { status: res.status, headers, body: Buffer.concat(chunks).toString('utf8') };
};
/** No OS secret store this host can reach: nothing is held, so what needs a secret is BLOCKED, and none can be entered. */
export const noSecrets: SecretStore = {
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
/** The OS secret store this platform has: the Keychain on macOS (others arrive with their platforms). */
export const osSecrets = (): SecretStore => (process.platform === 'darwin' ? keychainStore() : noSecrets);
/** Opens your browser at a sign-in page. */
export const openBrowser = (url: string): Promise<void> => new Promise((done, fail) => {
  if (process.platform !== 'darwin') return fail(Error('this host opens no browser for a sign-in'));
  execFile('/usr/bin/open', [url], { timeout: 10_000 }, (error) => (error ? fail(error) : done()));
});

type Outcome = HttpAnswer | { error: string };
/** What the record keeps of a source's calls and readings, appended as the core. */
export type Append = (kind: 'source.called' | 'reading.recorded', data: Record<string, unknown>) => Promise<void>;

/** The hub's side of every source: its calls, cache, quotas, back-off, recording and the secret values it holds to scrub. */
export class Sources {
  private readonly cache = new Map<string, Reading>();
  /** The reading.recorded handle of each cached reading. */
  private readonly handles = new Map<string, string>();
  private readonly spent = new Map<string, number[]>();
  private readonly backoff = new Map<string, { until: number; gap: number }>();
  private readonly recorded: RecordedCall[] = [];
  private readonly replayed = new Set<number>();
  /** Every secret value the hub read or was given: each is scrubbed from what a package gets and from the recording. */
  private readonly held = new Set<string>();

  constructor(private readonly options: { now: () => number; http: HttpClient; secrets: SecretStore; append: Append; replay?: Recording }) {}

  recording(): Recording {
    return { v: 1, calls: structuredClone(this.recorded) };
  }

  /** A reading of the source: from the cache while it's fresh, else one call, parsed by the package once scrubbed. */
  async read(owner: string, source: Polled, parse: (answer: HttpAnswer) => Promise<unknown>): Promise<SourceRead> {
    return (await this.readOne(owner, source, parse)).read;
  }
  /** Whether the secret store holds a package's secret now. */
  async holds(owner: string, name: string): Promise<boolean> {
    return this.options.replay !== undefined || (await this.options.secrets.get(secretKey(owner, name))) !== undefined;
  }
  /**
   * A read as a schedule's run needs it (#365): with the handle of the reading.recorded it came from, and whether the
   * call was held, by a rate limit or a 5xx from the provider, or by the hub's own quota or back-off.
   */
  async readOne(owner: string, source: Polled, parse: (answer: HttpAnswer) => Promise<unknown>): Promise<{ read: SourceRead; handle: string | null; held: boolean }> {
    const now = this.options.now();
    const cached = this.cache.get(source.name);
    if (cached && now - cached.as_of < source.freshFor) return { read: { status: 'reading', reading: { ...cached } }, handle: this.handles.get(source.name) ?? null, held: false };
    let held = false;
    const stop = (status: 'BLOCKED' | 'failed', cause: string): { read: SourceRead; handle: null; held: boolean } => ({ read: { status, source: source.name, cause }, handle: null, held });
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
    if (times.filter((t) => now - t < MINUTE).length >= source.quota.per_minute) return stop('failed', `quota: ${source.quota.per_minute} calls a minute`);
    if (times.length >= source.quota.per_day) return stop('failed', `quota: ${source.quota.per_day} calls a day`);
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
        this.cache.set(source.name, reading);
        this.handles.set(source.name, handle);
        return { read: { status: 'reading', reading: { ...reading } }, handle, held: false };
      }
      // The client never follows a redirect: the hub does, only to the source's own host, which the handle goes to.
      let next: URL | undefined;
      try { next = new URL(location, url); } catch { /* unreadable: no host the source names */ }
      if (next?.protocol !== 'https:' || next.host !== source.host) return stop('BLOCKED', `off-host redirect to ${next?.host || 'an unreadable location'}`);
      if (hop >= HOPS) return stop('failed', `more than ${HOPS} redirects`);
      url = next.href;
    }
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
      const at = replay.calls.findIndex((c, i) => !this.replayed.has(i) && c.source === source.name && c.request.method === stripped.method && c.request.url === stripped.url);
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
      bytes = Buffer.byteLength(got.body);
      answer = this.scrubAnswer(got);
    } catch {
      answer = { error: signal.aborted ? 'timeout' : 'unreachable' };
    }
    this.recorded.push({ source: source.name, request: stripped, answer: structuredClone(answer) });
    await this.options.append('source.called', {
      source: source.name, host: new URL(request.url).host, outcome: 'error' in answer ? answer.error : 'answered',
      ...('error' in answer ? {} : { status: answer.status }), ms: Math.round(performance.now() - started), bytes,
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
    return { status: answer.status, headers: this.scrubAll(answer.headers), body: this.scrub(answer.body) };
  }
}

const describe = (error: string, source: Polled): string => (error === 'timeout' ? `timeout after ${source.timeout} ms` : error === 'unreachable' ? `${source.host} unreachable` : error);
