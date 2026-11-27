// What the #1042 acceptance tests stand a bundle in front of (README: The servers, the browser and the logs): the
// bundle's folder served over HTTP and the stand-in public source served over https, each a child process that logs
// every request that reaches it; a throwaway certificate for the source; Google Chrome, headless with WebGPU on,
// driven over its DevTools protocol by this file alone (no browser-automation library), with the browser's own
// record of every request a page and the contexts under it make, and a page-side log of every way a script opens a
// connection; and the scripted session of criterion 1. Nothing here stands in for the export, the bundle or the
// player. No wait here is a wait for time: each is for an event (a child's line, a DevTools event, an event of the
// page), bounded by one deadline timer that can only turn a hang into a failure.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  STEP, ageFailures, deliveryFailures, entriesOf, requestFailures,
  type Allowed, type Arrived, type Delivery, type Entry, type JsonValue, type Reached, type Shown,
} from './judges.ts';

/** A platform need is missing here: never a pass (AGENTS.md: the four invariants). */
export function blocked(reason: string): never {
  throw Error(`BLOCKED: ${reason}; this is not a pass`);
}
/** A wait that met its deadline. */
export class Deadline extends Error {}
/** `p`, or a `Deadline` naming `what` when nothing settled it within `ms`. */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((done, fail) => {
    // deadline: bounds a wait for an event (a DevTools answer, a page's event, a child's line or its exit), so a hang becomes a failure that names what was awaited
    const timer = setTimeout(() => fail(new Deadline(`${what}: nothing within ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(timer); done(v); }, (e: unknown) => { clearTimeout(timer); fail(e instanceof Error ? e : Error(String(e))); });
  });
}
/** Each whole line a child writes, as it arrives. */
function lines(stream: NodeJS.ReadableStream, on: (line: string) => void): void {
  let held = '';
  stream.on('data', (d: Buffer) => {
    held += d.toString('utf8');
    for (let at = held.indexOf('\n'); at >= 0; at = held.indexOf('\n')) { const line = held.slice(0, at); held = held.slice(at + 1); if (line) on(line); }
  });
}
/** Stops a child this file started, by its PID, and waits for it to end. */
async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill();
  await within(gone, 20_000, 'a server this suite started ends').catch(() => { child.kill('SIGKILL'); });
}

// ---------------------------------------------------------------------------------------------------
// The bundle's server (README: The servers): a `node:http` listener in a child process of its own, since `deep-show
// run` under spawnSync blocks this process's event loop. It serves a folder as a static host does (every index page
// with `no-cache`, every other file with a max-age of a year, WebAssembly as `application/wasm`, no cross-origin
// isolation headers) and writes one line for each request that reaches it: when, its method, its target and its
// headers, and the status it answered.

const BUNDLE_SERVER = `
const http = require('http'), fs = require('fs'), path = require('path');
const [root] = process.argv.slice(1);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.txt': 'text/plain' };
const s = http.createServer((q, r) => {
  const said = (status) => console.log(JSON.stringify({ at: Date.now(), method: q.method, url: q.url, headers: q.headers, status }));
  let rel = decodeURIComponent((q.url || '/').split('?')[0].split('#')[0]).replace(/^\\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, rel);
  let body = null;
  if (file.startsWith(path.resolve(root) + path.sep)) { try { body = fs.readFileSync(file); } catch {} }
  if (!body) { said(404); r.statusCode = 404; r.end(); return; }
  let type = types[path.extname(file)] || 'application/octet-stream';
  if (body.length >= 4 && body[0] === 0 && body[1] === 0x61 && body[2] === 0x73 && body[3] === 0x6d) type = 'application/wasm';
  r.setHeader('content-type', type);
  r.setHeader('cache-control', path.basename(file) === 'index.html' ? 'no-cache' : 'max-age=31536000');
  said(200);
  r.end(body);
});
s.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: s.address().port })));`;

export class BundleServer {
  /** Every request that reached the server, in order. */
  readonly log: Arrived[] = [];
  origin = '';
  private child: ChildProcess | null = null;
  /** Serves `root`; resolves with the origin once it listens. */
  async start(root: string): Promise<string> {
    const child = spawn(process.execPath, ['-e', BUNDLE_SERVER, root], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.child = child;
    const port = new Promise<number>((done, fail) => {
      lines(child.stdout!, (l) => { const m = JSON.parse(l) as { port?: number } & Arrived; if (typeof m.port === 'number') done(m.port); else this.log.push(m); });
      child.once('error', fail);
      child.once('exit', (code) => fail(Error(`it ended with ${String(code)}`)));
    });
    this.origin = `http://127.0.0.1:${await within(port, 120_000, "the bundle's server listens").catch((e: Error) => blocked(`the bundle's server didn't start (${e.message}). Unblock: run on a machine with room for it`))}`;
    return this.origin;
  }
  /** Stops the listener this object started, by its PID. */
  async stop(): Promise<void> { const child = this.child; this.child = null; await stopChild(child); }
}

// ---------------------------------------------------------------------------------------------------
// The throwaway certificate (README: The servers): an authority and a certificate for IP 127.0.0.1 it signed, made
// with the `openssl` command in a temporary folder, as #309's suite makes its relay's. Nothing is installed anywhere:
// the app is handed the authority's file (the scenario's `source_ca`), and Chrome trusts the certificate by its
// public key's pin, for that browser alone.

export interface Certs { dir: string; ca: string; cert: string; key: string; pin: string }
export function makeCerts(): Certs {
  const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) blocked(`the openssl command can't run (${probe.error?.message ?? probe.stderr}); the stand-in source's throwaway certificate is made with it. Unblock: install openssl`);
  const dir = mkdtempSync(join(tmpdir(), 'deep-1042-certs-'));
  const at = (f: string): string => join(dir, f);
  // Each name from its own config file, a named P-256 curve and no extension twice (#309's helper found each need).
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = deep-1042 throwaway test authority\n[ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('source.cnf'), '[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = 127.0.0.1\n');
  writeFileSync(at('source.ext'), 'subjectAltName = IP:127.0.0.1\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = serverAuth\nauthorityKeyIdentifier = keyid\n');
  const steps: string[][] = [
    ['ecparam', '-name', 'prime256v1', '-param_enc', 'named_curve', '-out', at('p256.pem')],
    ['req', '-x509', '-new', '-newkey', `ec:${at('p256.pem')}`, '-nodes', '-keyout', at('ca.key'), '-out', at('ca.pem'), '-days', '2', '-config', at('ca.cnf'), '-extensions', 'ca'],
    ['req', '-new', '-newkey', `ec:${at('p256.pem')}`, '-nodes', '-keyout', at('source.key'), '-out', at('source.csr'), '-config', at('source.cnf')],
    ['x509', '-req', '-in', at('source.csr'), '-CA', at('ca.pem'), '-CAkey', at('ca.key'), '-set_serial', '1042', '-out', at('source.pem'), '-days', '2', '-sha256', '-extfile', at('source.ext')],
  ];
  for (const args of steps) {
    const r = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) { rmSync(dir, { recursive: true, force: true }); blocked(`openssl ${args.slice(0, 2).join(' ')} failed (${r.error?.message ?? r.stderr.trim().split('\n')[0]}); the stand-in source has no certificate. Unblock: an openssl that makes a P-256 certificate`); }
  }
  const pin = createHash('sha256').update(new X509Certificate(readFileSync(at('source.pem'))).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  return { dir, ca: at('ca.pem'), cert: at('source.pem'), key: at('source.key'), pin };
}

// ---------------------------------------------------------------------------------------------------
// The stand-in sources (README: The servers): one `node:https` listener on 127.0.0.1 in a child process of its own.
//   GET /outside.json   the public source: it answers anyone, with no key, `{"value": <number>}`. It is `open` (each
//                       request answered at once with the value last set), `held` (each request waits until the test
//                       gives it a value, so the test knows the step the player was at) or `down` (503, no value).
//   GET /keyed.json     the source that answers only with a key: 401 unless the request carries the made-up key.
//   GET /control        204; the test's own request that proves a planted cookie is sent when a request asks for it.
// Every answer allows any origin to read it, with credentials and any header, so a player that sent a cookie or a
// key header would get through and be seen. One line for each request that arrives, and for each answer.

/** The paths of the two stand-in sources, and the made-up key the keyed one answers to. It opens nothing: it is
 * made up here, for this stand-in alone. */
export const OUTSIDE_PATH = '/outside.json';
export const KEYED_PATH = '/keyed.json';
export const MADE_UP_KEY = 'deep1042-made-up-key-that-opens-nothing';

const SOURCE_SERVER = `
const https = require('https'), fs = require('fs');
const [cert, key, outside, keyed, secret] = process.argv.slice(1);
const say = (m) => console.log(JSON.stringify(m));
let mode = 'open', value = 0, n = 0;
const waiting = new Map();
const cors = (q, r) => {
  r.setHeader('access-control-allow-origin', q.headers.origin || '*');
  if (q.headers.origin) r.setHeader('access-control-allow-credentials', 'true');
  r.setHeader('access-control-allow-headers', q.headers['access-control-request-headers'] || '*');
  r.setHeader('access-control-allow-methods', 'GET');
  r.setHeader('vary', 'origin');
  r.setHeader('cache-control', 'no-store');
};
const give = (id, r, status, v) => {
  r.statusCode = status;
  if (status === 200) { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ value: v })); } else r.end();
  say({ ev: 'answered', id, at: Date.now(), status, value: status === 200 ? v : null });
};
const s = https.createServer({ cert: fs.readFileSync(cert), key: fs.readFileSync(key) }, (q, r) => {
  const id = ++n;
  say({ ev: 'request', id, at: Date.now(), method: q.method, url: q.url, headers: q.headers });
  cors(q, r);
  if (q.method === 'OPTIONS') return give(id, r, 204);
  if (q.method !== 'GET') return give(id, r, 405);
  if (q.url === '/control') return give(id, r, 204);
  if (q.url === keyed) {
    if (q.headers.authorization === 'Bearer ' + secret) return give(id, r, 200, 7.5);
    r.setHeader('www-authenticate', 'Bearer');
    return give(id, r, 401);
  }
  if (q.url !== outside) return give(id, r, 404);
  if (mode === 'open') return give(id, r, 200, value);
  if (mode === 'down') return give(id, r, 503);
  waiting.set(id, r);
  r.on('close', () => { if (waiting.delete(id)) say({ ev: 'left', id, at: Date.now() }); });
});
let held = '';
process.stdin.on('data', (d) => {
  held += d;
  for (let at = held.indexOf('\\n'); at >= 0; at = held.indexOf('\\n')) {
    const m = JSON.parse(held.slice(0, at)); held = held.slice(at + 1);
    if (m.mode) {
      mode = m.mode; if (typeof m.value === 'number') value = m.value;
      // A request still waiting when the source stops being held is answered as the new mode answers.
      if (mode !== 'held') for (const [id, r] of [...waiting]) { waiting.delete(id); if (mode === 'open') give(id, r, 200, value); else give(id, r, 503); }
      say({ ev: 'mode', mode });
    }
    if (m.answer) { const r = waiting.get(m.answer); waiting.delete(m.answer); if (r) give(m.answer, r, m.status || 200, m.value); say({ ev: 'told', id: m.answer, gave: !!r }); }
  }
});
process.stdin.on('end', () => process.exit(0));
s.listen(0, '127.0.0.1', () => say({ port: s.address().port }));`;

/** A request that waits at the held public source for the test to answer it. */
export interface Ask { id: number; at: number }
type SourceLine = { port?: number; ev?: string; id?: number; at?: number; method?: string; url?: string; headers?: Record<string, string>; status?: number; mode?: string; gave?: boolean };

export class Source {
  /** Every request that reached the stand-in, in order; a request's `status` is 0 until it is answered. */
  readonly log: (Arrived & { id: number })[] = [];
  origin = '';
  private child: ChildProcess | null = null;
  private readonly asks: Ask[] = [];
  private readonly awaited: { url: string; done: (q: Arrived) => void }[] = [];
  private wake: (() => void) | null = null;
  private readonly settled = new Map<string, () => void>();
  private readonly gave = new Map<number, boolean>();
  private state = 'open';
  /** The public source's URL, the keyed one's, and the host both are named by. */
  get outside(): string { return `${this.origin}${OUTSIDE_PATH}`; }
  get keyed(): string { return `${this.origin}${KEYED_PATH}`; }
  get host(): string { return new URL(this.origin).host; }
  async start(certs: Certs): Promise<string> {
    const child = spawn(process.execPath, ['-e', SOURCE_SERVER, certs.cert, certs.key, OUTSIDE_PATH, KEYED_PATH, MADE_UP_KEY], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child = child;
    const port = new Promise<number>((done, fail) => {
      lines(child.stdout!, (l) => { const m = JSON.parse(l) as SourceLine; if (typeof m.port === 'number') done(m.port); else this.heard(m); });
      child.once('error', fail);
      child.once('exit', (code) => fail(Error(`it ended with ${String(code)}`)));
    });
    this.origin = `https://127.0.0.1:${await within(port, 120_000, 'the stand-in source listens').catch((e: Error) => blocked(`the stand-in source didn't start (${e.message}). Unblock: run on a machine with room for it`))}`;
    return this.origin;
  }
  private heard(m: SourceLine): void {
    if (m.ev === 'request') {
      const q = { id: m.id!, at: m.at!, method: m.method!, url: m.url!, headers: m.headers ?? {}, status: 0 };
      this.log.push(q);
      for (const w of this.awaited.splice(0)) { if (w.url === q.url) w.done(q); else this.awaited.push(w); }
      if (this.state === 'held' && m.method === 'GET' && m.url === OUTSIDE_PATH) { this.asks.push({ id: m.id!, at: m.at! }); this.wake?.(); this.wake = null; }
    } else if (m.ev === 'answered') {
      const q = this.log.find((x) => x.id === m.id);
      if (q && m.status) q.status = m.status;
    } else if (m.ev === 'told') {
      this.gave.set(m.id!, m.gave === true);
      this.settle(`answer ${m.id}`);
    } else if (m.ev === 'left') {
      const at = this.asks.findIndex((a) => a.id === m.id);
      if (at >= 0) this.asks.splice(at, 1);
    } else if (m.ev === 'mode') {
      // The stand-in's own word, in the order of its lines: a request it answered before the change is no ask, and
      // one that arrives after it is.
      this.state = m.mode ?? this.state;
      if (this.state !== 'held') this.asks.length = 0;
      this.settle(`mode ${m.mode}`);
    }
  }
  private settle(what: string): void { this.settled.get(what)?.(); this.settled.delete(what); }
  private async tell(message: object, heard: string): Promise<void> {
    const said = new Promise<void>((done) => this.settled.set(heard, done));
    this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
    await within(said, 60_000, `the stand-in source says ${heard}`);
  }
  /** The public source from now on: `open` with `value`, `held`, or `down`. */
  async mode(mode: 'open' | 'held' | 'down', value?: number): Promise<void> {
    await this.tell({ mode, ...(value === undefined ? {} : { value }) }, `mode ${mode}`);
  }
  /** The first request for `url` (a path) to have arrived at the stand-in, awaited. */
  seen(url: string, ms: number): Promise<Arrived> {
    const here = this.log.find((q) => q.url === url);
    return here ? Promise.resolve(here) : within(new Promise<Arrived>((done) => { this.awaited.push({ url, done }); }), ms, `a request for ${url} arriving at the stand-in source`);
  }
  /** Resolves once a request waits at the held source. */
  asked(): Promise<void> { return this.asks.length ? Promise.resolve() : new Promise((done) => { this.wake = done; }); }
  /** The request that has waited longest, taken off the line. */
  take(): Ask | undefined { return this.asks.shift(); }
  /** Answers the waiting request `id` with `value`; whether the caller was still there to be given it. */
  async answer(id: number, value: number): Promise<boolean> {
    await this.tell({ answer: id, status: 200, value }, `answer ${id}`);
    return this.gave.get(id) === true;
  }
  async stop(): Promise<void> { const child = this.child; this.child = null; child?.stdin?.end(); await stopChild(child); }
}
/** The test's own request to a stand-in source, trusting the throwaway authority alone, with `key` when given: the
 * status the source answers. It is how a test shows its stand-in is what the criterion names. */
export function statusOf(url: string, certs: Certs, key?: string): Promise<number> {
  const asked = new Promise<number>((done, fail) => {
    const q = httpsGet(url, { ca: readFileSync(certs.ca), headers: key ? { authorization: `Bearer ${key}` } : {} }, (r) => { r.resume(); done(r.statusCode ?? 0); });
    q.on('error', fail);
  });
  return within(asked, 60_000, `the test's own request to ${url}`);
}

// ---------------------------------------------------------------------------------------------------
// Google Chrome, headless with WebGPU on (README: The browser), over its DevTools protocol in flat sessions. Chrome
// runs in a process group of its own and is stopped by that PID; its profile is a fresh folder, removed after.

export const CHROME = process.env['CHROME_BIN'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ARGS = [
  '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--use-mock-keychain',
  '--password-store=basic', '--disable-background-networking', '--disable-component-update', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required',
  // No request leaves the machine: every host but this machine's loopback address resolves nowhere, and every request
  // to a host that isn't loopback goes to a closed port, the proxy's (#169's two flags). Loopback is left out of the
  // resolver's rule, which takes an address as it takes a name: with 127.0.0.1 in it no page there loads at all, and
  // the bundle and the stand-ins are served there. The browser keeps loopback off the proxy by itself.
  '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9',
];

type Params = Record<string, unknown>;
type Message = { id?: number; method?: string; params?: Params; result?: Params; error?: { message: string }; sessionId?: string };
class Protocol {
  private n = 0;
  private readonly pending = new Map<number, { done: (r: Params) => void; fail: (e: Error) => void }>();
  private readonly ws: WebSocket;
  /** Every event, with the session it came from ('' for the browser's own). */
  heard: (session: string, method: string, params: Params) => void = () => undefined;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(String(ev.data)) as Message;
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.fail(Error(m.error.message)); else p?.done(m.result ?? {});
      } else if (m.method) this.heard(m.sessionId ?? '', m.method, m.params ?? {});
    });
    ws.addEventListener('close', () => { for (const p of this.pending.values()) p.fail(Error('the DevTools connection closed')); this.pending.clear(); });
  }
  static async connect(url: string): Promise<Protocol> {
    const ws = new WebSocket(url);
    await within(new Promise<void>((done, fail) => { ws.addEventListener('open', () => done()); ws.addEventListener('error', () => fail(Error(`no DevTools connection at ${url}`))); }), 60_000, 'the DevTools connection opens');
    return new Protocol(ws);
  }
  /** One command and its answer; `what` names what the answer is awaited for, when a deadline has to say so. */
  send(method: string, params: Params = {}, session = '', ms = 60_000, what = `the browser's answer to ${method}`): Promise<Params> {
    const id = ++this.n;
    const answered = new Promise<Params>((done, fail) => {
      this.pending.set(id, { done, fail });
      this.ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });
    return within(answered, ms, what).finally(() => this.pending.delete(id));
  }
  close(): void { this.ws.close(); }
}

/** Installed before the page's scripts (`Page.addScriptToEvaluateOnNewDocument`), as #549's: every way a script
 * opens a connection or starts a context that can, logged in `window.__deep1042`. It changes no call's behavior. */
const SPY = `(() => {
  const log = []; Object.defineProperty(window, '__deep1042', { value: log });
  const note = (kind, url, servers) => { try { log.push({ kind, url: String(url), servers: servers || null }); } catch (e) {} };
  const wrap = (name, describe) => { const Real = window[name]; if (typeof Real !== 'function') return;
    window[name] = new Proxy(Real, { construct(t, args, nt) { const d = describe(args); note(name, d.url, d.servers); return Reflect.construct(t, args, nt); } }); };
  wrap('WebSocket', (a) => ({ url: a[0] }));
  wrap('WebTransport', (a) => ({ url: a[0] }));
  wrap('EventSource', (a) => ({ url: a[0] }));
  wrap('Worker', (a) => ({ url: a[0] }));
  wrap('SharedWorker', (a) => ({ url: a[0] }));
  wrap('RTCPeerConnection', (a) => ({ url: 'rtc:', servers: ((a[0] && a[0].iceServers) || []).flatMap((s) => [].concat(s.urls || s.url || [])).map(String) }));
  const f = window.fetch; if (f) window.fetch = function (input) { note('fetch', input && input.url ? input.url : input); return f.apply(this, arguments); };
  const open = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { note('xhr', u); return open.apply(this, arguments); };
  const beacon = navigator.sendBeacon; if (beacon) navigator.sendBeacon = function (u) { note('beacon', u); return beacon.apply(this, arguments); };
  const sw = navigator.serviceWorker; if (sw && sw.register) { const register = sw.register; sw.register = function (u) { note('ServiceWorker', u); return register.apply(this, arguments); }; }
})();`;

/** Page-side: every element of the document and of the open shadow roots under it, and the notices among them. */
const NOTICES = `const all = (root, out = []) => { for (const e of root.querySelectorAll('*')) { out.push(e); if (e.shadowRoot) all(e.shadowRoot, out); } return out; };
  const notices = () => all(document).filter((e) => e.hasAttribute('data-deep-notice')).map((e) => ({ kind: e.getAttribute('data-deep-notice') || '', text: (e.textContent || '').trim() }));`;
/** Page-side: a bound value as the page shows it (README: What the page shows), as #169's suite reads one. */
const BOUND = (id: string): string => `const bound = () => { const el = document.querySelector('[data-deep-bound=' + ${JSON.stringify(JSON.stringify(id))} + ']'); if (!el) return null;
    const times = [...(el.matches('time[datetime]') ? [el] : []), ...el.querySelectorAll('time[datetime]')].map((t) => ({ datetime: t.getAttribute('datetime') || '', text: (t.textContent || '').trim() }));
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return { text: el.textContent || '', times, visible: r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }; };`;

/** A notice the page shows: its kind (the value of `data-deep-notice`) and its text. */
export interface Notice { kind: string; text: string }
/** What the tests read of the player's members. */
export interface State { ready: boolean; paused: boolean; currentTime: number; duration: number | null; href: string }

/** A script's text on one short line, for a deadline that has to say which script it waited on. */
const brief = (expression: string): string => expression.replace(/\s+/g, ' ').trim().slice(0, 160);
/** The contexts that start under the browser, not under a page. */
const WORKERS = ['service_worker', 'shared_worker'];
/** The URL of a context that is the browser's own, '' for any other: one whose script or document the browser serves
 * from itself (an extension it ships, such as its speech engine's worker, or an internal page). No page of a bundle
 * can start one, so it is no part of a page's record. */
const browsersOwn = (info: unknown): string => {
  const url = String(((info ?? {}) as { url?: string }).url ?? '');
  return /^(chrome-extension|chrome|chrome-untrusted|devtools):/i.test(url) ? url : '';
};

/** One page in the browser (a target in a flat session), with the browser's record of what it and the contexts
 * under it asked for. */
export class Page {
  readonly errors: string[] = [];
  /** The browser's own record: every request, the headers each went out with, every socket. */
  readonly reached: Reached[] = [];
  /** The browser's own contexts that started while this page was open and were left out of its record, by URL. */
  readonly left: string[] = [];
  /** Why the browser didn't load the page's URL, when it didn't (the navigation's own error). */
  failed = '';
  private readonly cdp: Protocol;
  private readonly session: string;
  private readonly target: string;
  private readonly url: string;
  private readonly sessions = new Set<string>();
  private readonly urls = new Map<string, string>();
  private readonly unnamed = new Map<string, Reached[]>();
  private committed = false;
  private loaded: () => void = () => undefined;
  /** Resolves at the load event of the page's own document (never the blank one its target starts with). */
  readonly load: Promise<void>;
  constructor(cdp: Protocol, session: string, target: string, url: string) {
    this.cdp = cdp; this.session = session; this.target = target; this.url = url;
    this.sessions.add(session);
    this.load = new Promise((done) => { this.loaded = done; });
  }
  owns(session: string): boolean { return this.sessions.has(session); }
  /** One DevTools event of this page or of a context under it. */
  hear(session: string, method: string, p: Params): void {
    const headers = (h: unknown): Record<string, string> => Object.fromEntries(Object.entries((h ?? {}) as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    if (method === 'Network.requestWillBeSent') {
      const q = (p['request'] ?? {}) as { url?: string; method?: string; headers?: unknown };
      const id = String(p['requestId']);
      this.urls.set(id, String(q.url ?? ''));
      // The headers a request went out with may be told before the request itself: they take its URL here.
      for (const w of this.unnamed.get(id) ?? []) w.url = String(q.url ?? '');
      this.unnamed.delete(id);
      this.reached.push({ by: 'browser', kind: 'request', url: String(q.url ?? ''), method: String(q.method ?? ''), headers: headers(q.headers) });
    } else if (method === 'Network.requestWillBeSentExtraInfo') {
      const h = headers(p['headers']);
      const id = String(p['requestId']);
      const wire: Reached = { by: 'browser', kind: 'wire', url: this.urls.get(id) ?? '', host: h[':authority'] ?? h['host'] ?? '', headers: h };
      if (!this.urls.has(id)) this.unnamed.set(id, [...(this.unnamed.get(id) ?? []), wire]);
      this.reached.push(wire);
    } else if (method === 'Network.webSocketCreated') this.reached.push({ by: 'browser', kind: 'websocket', url: String(p['url'] ?? ''), headers: {} });
    else if (method === 'Network.webTransportCreated') this.reached.push({ by: 'browser', kind: 'webtransport', url: String(p['url'] ?? ''), headers: {} });
    else if (method === 'Target.attachedToTarget') this.attached(p);
    else if (method === 'Runtime.exceptionThrown' && session === this.session) this.errors.push(JSON.stringify(p['exceptionDetails'] ?? p).slice(0, 500));
    else if (method === 'Page.frameNavigated' && session === this.session) {
      const frame = (p['frame'] ?? {}) as { parentId?: string; url?: string };
      if (!frame.parentId && frame.url !== 'about:blank') this.committed = true;
    } else if (method === 'Page.loadEventFired' && session === this.session && this.committed) this.loaded();
  }
  /** A context that attached under this page, or under the browser while this page was the one open: it joins the
   * page's record, unless it is the browser's own, which runs on and is named in `left`. */
  attached(p: Params): void {
    const session = String(p['sessionId']);
    const own = browsersOwn(p['targetInfo']);
    if (!own) { void this.watch(session).catch(() => undefined); return; }
    this.left.push(own);
    void this.cdp.send('Runtime.runIfWaitingForDebugger', {}, session).catch(() => undefined);
  }
  /** The browser's record turned on for a session, and for every context that starts under it (a worker, a frame of
   * another process), each held at its start until its record is on. */
  async watch(session: string): Promise<void> {
    this.sessions.add(session);
    await this.cdp.send('Network.enable', {}, session).catch(() => undefined);
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, session).catch(() => undefined);
    if (session !== this.session) await this.cdp.send('Runtime.runIfWaitingForDebugger', {}, session).catch(() => undefined);
  }
  /** A script's value in the page (its own JavaScript, as text), awaited; with `gesture`, as a user's. `what` says
   * what the script waits for or reads, and a deadline met names it with the script. */
  async evaluate<T>(what: string, expression: string, ms = 60_000, gesture = false): Promise<T> {
    const r = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: gesture }, this.session, ms, `${what} (the page's answer to the script ${brief(expression)})`);
    const thrown = r['exceptionDetails'] as { text?: string; exception?: { description?: string } } | undefined;
    if (thrown) throw Error(`${what}: a script in the page threw: ${thrown.text ?? ''} ${thrown.exception?.description ?? ''}`);
    return (r['result'] as { value?: T } | undefined)?.value as T;
  }
  /** The notices the page shows: every element marked `data-deep-notice`, in document order. */
  notices(): Promise<Notice[]> { return this.evaluate<Notice[]>('the notices the page shows', `(() => { ${NOTICES} return notices(); })()`); }
  /** The player's members. */
  state(): Promise<State> {
    return this.evaluate<State>("the player's members", `(() => { const p = document.querySelector('deep-player'); const d = p ? p.duration : NaN;
      return { ready: !!p && p.ready === true, paused: !p || p.paused !== false, currentTime: p ? p.currentTime : 0, duration: Number.isFinite(d) ? d : null, href: location.href }; })()`);
  }
  /** Resolves once the page's player is `ready`: the page's load event, then the player's `ready` event, awaited.
   * BLOCKED when the browser didn't load the page or offers no WebGPU adapter there; any other player that isn't
   * ready within `ms` fails, naming the wait that met its deadline and what the page shows, its notices among it. */
  async ready(what: string, ms = 300_000): Promise<void> {
    if (this.failed) blocked(`Chrome at ${CHROME} didn't load ${this.url} (${this.failed}); the bundle's own server is on this machine's loopback. Unblock: a Chrome that reaches 127.0.0.1 under this suite's flags`);
    type Seen = { player: boolean; ready: boolean; notices: Notice[] };
    const seen = `{ player: !!p, ready: !!p && p.ready === true, notices: notices() }`;
    // Two waits, each with its own deadline, so the one that is met is the one named.
    let met = '';
    const s = await (async (): Promise<Seen> => {
      await within(this.load, ms, `${what}: the load event of the page at ${this.url}`);
      return this.evaluate<Seen>(`${what}: the player's ready event`, `(async () => { ${NOTICES}
        const p = document.querySelector('deep-player');
        if (p && p.ready !== true) await new Promise((done) => p.addEventListener('ready', () => done(), { once: true }));
        return ${seen}; })()`, ms);
    })().catch((e: Error): Promise<Seen> => {
      met = e.message;
      return this.evaluate<Seen>(`${what}: what the page shows`, `(() => { ${NOTICES} const p = document.querySelector('deep-player'); return ${seen}; })()`).catch(() => ({ player: false, ready: false, notices: [] }));
    });
    if (s.ready) return;
    // No WebGPU is said only when the page itself says so: a page that doesn't answer is a failure, not a missing adapter.
    const at = await this.evaluate<{ href: string; gpu: string }>(`${what}: where the page is, and its WebGPU adapter`, `(async () => ({ href: location.href, gpu: !navigator.gpu ? 'no navigator.gpu' : (await navigator.gpu.requestAdapter()) ? '' : 'no adapter' }))()`).catch((e: Error) => ({ href: `an address it doesn't tell (${e.message})`, gpu: '' }));
    if (at.gpu) blocked(`Chrome at ${CHROME} offers no WebGPU here (${at.gpu}, in the page at ${at.href}); the piece plays live on WebGPU in headless Chrome. Unblock: run on a Mac whose Chrome gives a WebGPU adapter headless`);
    throw Error(`${what}: the player (<deep-player>) is not ready${met ? ` (${met})` : ''}; the page at ${at.href} shows ${s.player ? 'a player' : 'no <deep-player>'}, notices ${JSON.stringify(s.notices)}, page errors ${JSON.stringify(this.errors.slice(0, 5))}`);
  }
  /** probe(), awaited, as plain JSON. */
  probe(): Promise<JsonValue> {
    return this.evaluate<JsonValue>("the player's probe()", `(async () => { const v = await document.querySelector('deep-player').probe(); return JSON.parse(JSON.stringify(v ?? null)); })()`);
  }
  /** play() as a user's gesture, when the player is paused; pause(). */
  async play(): Promise<void> { await this.evaluate("the player's play()", `(() => { const p = document.querySelector('deep-player'); if (p.paused) p.play(); })()`, 60_000, true); }
  async pause(): Promise<void> { await this.evaluate("the player's pause()", `(() => { document.querySelector('deep-player').pause(); })()`); }
  /** Resolves when the player's clock, as it plays, reads `seconds` or later (its `timeupdate` events). */
  clockPast(seconds: number, ms: number): Promise<number> {
    return this.evaluate<number>(`the player's clock reading ${seconds} s or later as it plays (its timeupdate events)`, `new Promise((done) => { const p = document.querySelector('deep-player');
      const on = () => { if (p.currentTime >= ${seconds}) { p.removeEventListener('timeupdate', on); done(p.currentTime); } };
      p.addEventListener('timeupdate', on); on(); })`, ms);
  }
  /** Resolves when the player ends its play (its `ended` event), or stops where it is with a notice saying so. */
  ended(what: string, ms: number): Promise<{ ended: boolean; stopped: string }> {
    return this.evaluate(`${what}: the player's ended event, or a notice that the piece stopped`, `new Promise((done) => { const p = document.querySelector('deep-player');
      const stopped = () => { const s = document.querySelector('[data-deep-notice="stopped"]'); if (s) done({ ended: false, stopped: (s.textContent || '').trim() }); };
      p.addEventListener('ended', () => done({ ended: true, stopped: '' }), { once: true });
      new MutationObserver(stopped).observe(document.documentElement, { subtree: true, childList: true });
      stopped(); })`, ms);
  }
  /** The bound value `id` as the page shows it now, or null when the page shows none. */
  bound(id: string): Promise<Shown | null> { return this.evaluate<Shown | null>(`the bound value ${id} as the page shows it`, `(() => { ${BOUND(id)} return bound(); })()`); }
  /** Resolves when the page shows the bound value `id` with an as-of time other than `not` (a change of the page's
   * own document, observed): the value as shown then. */
  shownAfter(id: string, not: string, ms: number): Promise<Shown> {
    return this.evaluate<Shown>(`the page showing the bound value ${id} with ${not ? `an as-of time other than ${not}` : 'an as-of time'} (a change of its document)`, `new Promise((done) => { ${BOUND(id)}
      const seen = new MutationObserver(() => check());
      const check = () => { const b = bound(); if (b && b.times.length && !b.times.some((t) => t.datetime === ${JSON.stringify(not)})) { seen.disconnect(); done(b); } };
      seen.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      check(); })`, ms);
  }
  /** The frame at `seconds` as the player draws it on its canvas, read back from the canvas in the task that drew
   * it: a seek away and back, so the frame is drawn anew, then the canvas's own pixels as a PNG. */
  async canvas(seconds: number): Promise<{ width: number; height: number; png: Buffer } | null> {
    const r = await this.evaluate<{ width: number; height: number; url: string } | null>(`the player's canvas read back at ${seconds} s`, `(() => { const p = document.querySelector('deep-player'); const c = p && p.querySelector('canvas'); if (!c) return null;
      p.currentTime = ${seconds} + 1; p.currentTime = ${seconds};
      return { width: c.width, height: c.height, url: c.toDataURL('image/png') }; })()`, 120_000);
    return r ? { width: r.width, height: r.height, png: Buffer.from(r.url.slice(r.url.indexOf(',') + 1), 'base64') } : null;
  }
  /** The page-side log: every way a script of the page opened a connection. */
  async spied(): Promise<Reached[]> {
    const log = await this.evaluate<{ kind: string; url: string; servers: string[] | null }[] | null>('the page-side log', 'window.__deep1042 ? JSON.parse(JSON.stringify(window.__deep1042)) : null').catch(() => null);
    return (log ?? []).map((s) => ({ by: 'page' as const, kind: s.kind, url: s.url, headers: {}, ...(s.servers ? { servers: s.servers } : {}) }));
  }
  async close(): Promise<void> { await this.cdp.send('Target.closeTarget', { targetId: this.target }).catch(() => undefined); }
}

/** A cookie the test plants so that a request that asked for cookies would carry one. Both are made up here. */
export interface Planted { name: string; value: string; url: string; secure: boolean }

/** One browser with one profile, a fresh folder. */
export class Browser {
  private readonly chrome: ChildProcess;
  private readonly cdp: Protocol;
  private readonly profile: string;
  private readonly control: string;
  private readonly pages: Page[] = [];
  private closed = false;
  private constructor(chrome: ChildProcess, cdp: Protocol, profile: string, control: string) {
    this.chrome = chrome; this.cdp = cdp; this.profile = profile; this.control = control;
    cdp.heard = (session, method, params) => {
      // A page hears its own session's events and those of the contexts under it, and no other page's.
      if (session !== '') { this.pages.find((p) => p.owns(session))?.hear(session, method, params); return; }
      // The browser's own session is told of every attach, this file's own attach to a page included. Only a shared
      // or service worker, which starts under the browser and is held at its start, is a context to watch: it joins
      // the record of the page opened last, unless it is the browser's own, or runs on when there is no page.
      if (method !== 'Target.attachedToTarget' || !WORKERS.includes(String((params['targetInfo'] as { type?: string } | undefined)?.type))) return;
      const page = this.pages.at(-1);
      if (page) page.attached(params);
      else void cdp.send('Runtime.runIfWaitingForDebugger', {}, String(params['sessionId'])).catch(() => undefined);
    };
  }
  /** A browser with a fresh profile; `pins` are the certificates it trusts by their public key's pin. */
  static async open(pins: readonly string[] = []): Promise<Browser> {
    if (!existsSync(CHROME)) blocked(`no Google Chrome at ${CHROME}; the player is played in headless Chrome with WebGPU. Unblock: install Google Chrome there or set CHROME_BIN`);
    const profile = mkdtempSync(join(tmpdir(), 'deep-1042-chrome-'));
    const args = [...CHROME_ARGS, ...(pins.length ? [`--ignore-certificate-errors-spki-list=${pins.join(',')}`] : []), `--user-data-dir=${profile}`, 'about:blank'];
    const chrome = spawn(CHROME, args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    // Chrome says where its DevTools listen on its error stream, once.
    const listening = new Promise<string>((done, fail) => {
      lines(chrome.stderr!, (l) => { const m = /DevTools listening on (ws:\/\/\S+)/.exec(l); if (m) done(m[1]!); });
      chrome.once('error', fail);
      chrome.once('exit', (code) => fail(Error(`it ended with ${String(code)}`)));
    });
    try {
      const url = await within(listening, 180_000, 'Chrome opens its DevTools port');
      const cdp = await Protocol.connect(url);
      const { targetInfos } = await cdp.send('Target.getTargets') as { targetInfos: { targetId: string; type: string }[] };
      const blank = targetInfos.find((t) => t.type === 'page') ?? (await cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: blank.targetId, flatten: true }) as { sessionId: string };
      // Shared and service workers start under the browser, not under a page: the record takes them here.
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: WORKERS.map((type) => ({ type })) }).catch(() => undefined);
      return new Browser(chrome, cdp, profile, sessionId);
    } catch (e) {
      await endChrome(chrome, profile, 0);
      return blocked(`${CHROME} gave no DevTools connection within 180 s (${(e as Error).message}). Unblock: run where headless Chrome starts, on a machine with room for it`);
    }
  }
  /** Plants `cookie` in this profile; BLOCKED when the browser keeps none. */
  async plant(cookie: Planted): Promise<void> {
    await this.cdp.send('Network.enable', {}, this.control);
    await this.cdp.send('Network.setCookie', { name: cookie.name, value: cookie.value, url: cookie.url, secure: cookie.secure, ...(cookie.secure ? { sameSite: 'None' } : {}) }, this.control);
    const { cookies } = await this.cdp.send('Network.getCookies', { urls: [cookie.url] }, this.control) as { cookies: { name: string; value: string }[] };
    if (!cookies.some((c) => c.name === cookie.name && c.value === cookie.value)) blocked(`the browser kept no planted cookie for ${cookie.url}, so a player that would send one has none to send. Unblock: a Chrome profile that takes cookies`);
  }
  /** The test's own request from a blank page of this profile, asking for cookies to be sent: what proves a planted
   * cookie reaches `url`'s host when a request asks for it. '' once it was answered, else why it was not. */
  async controlRequest(url: string): Promise<string> {
    const what = `the test's own request to ${url} from a blank page, asking for cookies to be sent`;
    const r = await this.cdp.send('Runtime.evaluate', { expression: `fetch(${JSON.stringify(url)}, { credentials: 'include', mode: 'no-cors', cache: 'no-store' }).then(() => '', (e) => String((e && e.message) || e) || 'it failed')`, awaitPromise: true, returnByValue: true }, this.control, 60_000, what);
    const said = (r['result'] as { value?: string } | undefined)?.value;
    return typeof said === 'string' ? said : 'the blank page gave no answer';
  }
  /** Opens `url` in a new page of this profile, 1280 x 720 at device scale 1, the page-side log installed first and
   * the browser's record on. */
  async page(url: string): Promise<Page> {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' }) as { targetId: string };
    const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true }) as { sessionId: string };
    const page = new Page(this.cdp, sessionId, targetId, url);
    this.pages.push(page);
    await page.watch(sessionId);
    await this.cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await this.cdp.send('Page.enable', {}, sessionId);
    await this.cdp.send('Runtime.enable', {}, sessionId);
    await this.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SPY }, sessionId);
    // The navigation's own answer: an address the browser can't reach is told here, not left for a wait to meet.
    const went = await this.cdp.send('Page.navigate', { url }, sessionId, 180_000, `the browser's answer to the navigation to ${url}`).catch((e: Error): Params => ({ errorText: e.message }));
    page.failed = typeof went['errorText'] === 'string' ? went['errorText'] : '';
    return page;
  }
  /** Closes the browser this object started and removes its profile; a second call does nothing. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.cdp.send('Browser.close', {}, '', 5_000).catch(() => undefined);
    this.cdp.close();
    await endChrome(this.chrome, this.profile, 10_000);
  }
}
/** Ends the Chrome this file started and removes its profile. A Chrome still running after `grace` ms is stopped by
 * its own process group's PID; one that has ended is never signalled, so no other process can be. */
async function endChrome(chrome: ChildProcess, profile: string, grace: number): Promise<void> {
  const over = (): boolean => chrome.exitCode !== null || chrome.signalCode !== null;
  const exit = new Promise<void>((done) => { if (over()) done(); else chrome.once('exit', () => done()); });
  await within(exit, Math.max(grace, 1), 'Chrome ends').catch(() => undefined);
  if (!over() && chrome.pid) {
    try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* already gone */ }
    await within(exit, 10_000, 'Chrome ends once stopped').catch(() => undefined);
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1's scripted session (README: The scripted session). The piece's own length is the session's: it is
// played from its start to its `ended` event with no seek, so the session lasts the piece's 10 minutes of play and
// every wait in it is for an event. The stand-in source is held, so each of its values is given at a moment the test
// chose: the first while the piece plays, the second (the same number again) while the player is held paused, then
// none for `outage` seconds of play while the shown value ages, then a new number for each further request.

export interface SessionPlan {
  /** The index page's URL, the bundle's folder URL (ending in `/`) and the paths of the bundle's files under it. */
  url: string; base: string; files: readonly string[];
  /** The declared reading's ID and the ID of the bound value that shows it. */
  reading: string; bound: string;
  /** The piece's length in seconds, the seconds between two asks the piece declares (`every`), the seconds of play
   * with no value, and the least values the session must see given. */
  duration: number; every: number; outage: number; least: number;
  /** The values the source gives, in order: the second repeats the first. */
  values: readonly number[];
  /** The cookies planted before the page opens: one for the bundle's own host, one for the source's. */
  site: Planted; third: Planted;
}
/** What a session read: its failures, the values the source gave, the steps run, how often the source was asked,
 * and the browser's own contexts left out of the page's record, by URL. */
export interface SessionRead { failures: string[]; given: number[]; steps: number; asked: number; left: string[] }

/** Plays the session and judges it: the failures of criterion 1's first two clauses, each naming what it names. A
 * wait that met its deadline is named in the failure it leads to. */
export async function playSession(browser: Browser, bundle: BundleServer, source: Source, plan: SessionPlan): Promise<SessionRead> {
  const f: string[] = [];
  const given: number[] = [];
  // A player that would send a cookie has one to send: one for each host, and the source's proven to travel.
  await browser.plant(plan.site);
  await browser.plant(plan.third);
  const control = `${source.origin}/control`;
  const unanswered = await browser.controlRequest(control);
  if (unanswered) blocked(`the test's own request from a blank page of this browser was not answered by the stand-in source at ${control} (${unanswered}), so nothing can be said of what this browser sends there. Unblock: a Chrome that reaches 127.0.0.1 over https and trusts the stand-in's certificate by its pin`);
  const arrived = await source.seen('/control', 60_000);
  if (!(arrived.headers['cookie'] ?? '').includes(plan.third.value)) blocked(`this browser doesn't send the planted cookie to ${source.origin} even on a request that asks for it (the request arrived with cookie: ${JSON.stringify(arrived.headers['cookie'] ?? null)}), so a log with no cookie proves nothing. Unblock: a Chrome profile that sends cookies to another site`);
  await source.mode('held');
  const [bundleFrom, sourceFrom] = [bundle.log.length, source.log.length];

  const page = await browser.page(plan.url);
  await page.ready('the gauge');
  const start = await page.state();
  if (start.duration !== plan.duration) f.push(`the piece is ${String(start.duration)} s long in the player, not the session's ${plan.duration} s`);
  const first = await page.probe();
  const backend = typeof first === 'object' && first !== null && !Array.isArray(first) ? String(first['backend'] ?? '') : '';
  if (!/webgpu/i.test(backend)) f.push(`the player runs on ${backend || 'no backend'}, not WebGPU`);
  if (!bundle.log.slice(bundleFrom).some((q) => (q.headers['cookie'] ?? '').includes(plan.site.value))) blocked("the browser's own load of the index page didn't carry the cookie planted for the bundle's host, so a log with no cookie proves nothing. Unblock: a Chrome profile that takes cookies");

  // The player's reading entries, and the steps it has run.
  let unreadable = '';
  const read = async (): Promise<{ entries: Entry[]; step: number }> => {
    const p = await page.probe();
    const { entries, why } = entriesOf(p);
    unreadable = why;
    return { entries, step: typeof p === 'object' && p !== null && !Array.isArray(p) && typeof p['step'] === 'number' ? p['step'] : -1 };
  };
  const baseline = (await read()).entries;

  // The whole play's bound: its length and 15 minutes for the holds, so that the session's waits, one after another
  // at their bounds, still end inside a test's hour.
  const all = plan.duration * 1000 + 900_000;
  const over = page.ended('the gauge', all).then((e) => ({ over: e }), (e: Error) => ({ over: { ended: false, stopped: e.message } }));
  let done: { ended: boolean; stopped: string } | null = null;
  void over.then((o) => { done = o.over; });
  /** The deadline the last wait met, in its own words. */
  let met = '';
  /** The next request at the held source, 'over' when the play ends first, or 'none' at the deadline (`met` then says
   * which wait it was). A request the player left before it could be taken is no ask: the next is awaited. */
  const next = (ms: number, what: string): Promise<Ask | 'over' | 'none'> => {
    const awaited = (async (): Promise<Ask | 'over'> => {
      for (;;) {
        if ((await Promise.race([source.asked().then(() => 'ask' as const), over.then(() => 'over' as const)])) === 'over') return 'over';
        const ask = source.take();
        if (ask) return ask;
      }
    })();
    return within(awaited, ms, what).catch((e: Error) => { met = e.message; return 'none' as const; });
  };
  /** One value given to the request `ask`, with what the player and the page hold around it. With `paused` the
   * player is held paused from before the answer until the page has shown the value, and plays on after, whatever
   * happened in between. */
  let shownGone = false;
  const deliver = async (ask: Ask, value: number, paused: boolean): Promise<Shown | null> => {
    if (paused) await page.pause();
    try {
      const before = await read();
      const was = (await page.bound(plan.bound))?.times[0]?.datetime ?? '';
      if (!(await source.answer(ask.id, value))) {
        // The player had left before the answer, so no value was given. Playing, that is no failure: it asks again.
        // Paused, it leaves the one exact reading of "the first step not yet run" unmade, which is said.
        if (paused) f.push(`the player dropped its request to the declared source when it was paused, so the value ${value} the source then gave went nowhere: a value given while the player is held paused must be one input entry at the step it is held at`);
        return null;
      }
      given.push(value);
      const shown = await page.shownAfter(plan.bound, was, 120_000).catch((e: Error) => { f.push(`the value ${value} the source gave: ${e.message}`); return null; });
      const seenAt = Date.now();
      const after = await read();
      const d: Delivery = { value, askedAt: ask.at, seenAt, stepBefore: before.step, stepAfter: after.step, paused, before: before.entries, after: after.entries, shown };
      f.push(...deliveryFailures(d, { reading: plan.reading, host: source.host }));
      if (!shown) shownGone = true;
      return shown;
    } finally {
      if (paused) await page.play();
    }
  };

  await page.play();
  const wait = (plan.every + 120) * 1000;
  let ask = await next(wait, `the player's first request to its declared source ${source.outside}, or the end of the play`);
  if (typeof ask !== 'object') {
    const shows = await page.bound(plan.bound);
    f.unshift(`the player asked the piece's declared public source ${source.outside} for no value in the first ${plan.every + 120} s of play (the piece asks every ${plan.every} s${ask === 'over' ? '; the play was over first' : `; ${met}`}); the page shows ${shows ? `"${shows.text.trim().slice(0, 80)}"` : 'no bound value'}${unreadable ? `, and ${unreadable}` : ''}`);
  } else {
    await deliver(ask, plan.values[0]!, false);
    ask = shownGone ? 'none' : await next(wait + 60_000, `the player's second request to its declared source ${source.outside}, or the end of the play`);
    if (typeof ask !== 'object') { if (!shownGone) f.push(`the player asked the declared source once and not again within ${plan.every + 180} s of play (${ask === 'over' ? 'the play was over first' : met})`); } else {
      const fresh = await deliver(ask, plan.values[1]!, true);
      if (fresh) {
        // No value for `outage` seconds of play: the value shown ages, and the words of its age change.
        await source.mode('down');
        const from = (await page.state()).currentTime;
        const reached = await within(Promise.race([page.clockPast(from + plan.outage, all).then(() => 'aged' as const), over.then(() => 'over' as const)]), (plan.outage + 600) * 1000, `${plan.outage} s of play past ${from} s with no value from the source`).catch((e: Error) => { met = e.message; return 'none' as const; });
        if (reached === 'aged') f.push(...ageFailures(fresh, await page.bound(plan.bound), plan.values[1]!, plan.outage));
        else f.push(reached === 'over' ? `the play was over before the value had aged ${plan.outage} s` : `the play didn't run on for the value to age ${plan.outage} s (${met})`);
        await source.mode('held');
        for (let k = 2; !shownGone && !done; k++) {
          ask = await next(all, `a later request of the player to its declared source ${source.outside}, or the end of the play`);
          if (typeof ask !== 'object') { if (ask === 'none') f.push(`the player neither asked its declared source again nor ended its play (${met})`); break; }
          await deliver(ask, plan.values[k] ?? plan.values.at(-1)! + (k - plan.values.length + 1), false);
        }
      }
    }
  }
  // The end: no further value is given (a request still waiting is told the source is down), and what the session
  // gained is read once the play is over.
  await source.mode('down');
  if (!shownGone && typeof ask !== 'string') done = (await over).over;
  await page.pause().catch(() => undefined);
  const end = await read();
  if (unreadable) f.push(unreadable);
  const ended = done as { ended: boolean; stopped: string } | null;
  if (ended && !ended.ended) f.push(`the play stopped before its end: ${ended.stopped}`);
  if (ended?.ended && end.step !== plan.duration * 60) f.push(`the play ended at step ${end.step}, not the ${plan.duration * 60} steps of ${plan.duration} s`);
  if (given.length && given.length < plan.least) f.push(`the source gave ${given.length} ${given.length === 1 ? 'value' : 'values'} over the session, under the ${plan.least} it needs (two alike and one more); at one ask every ${plan.every} s a ${plan.duration} s play has time for about ${Math.floor(plan.duration / plan.every)}`);
  if (!unreadable && end.entries.length - baseline.length !== given.length) f.push(`the session gained ${end.entries.length - baseline.length} reading entries for the ${given.length} values the source gave`);
  if (end.entries.some((e, i) => i > 0 && e.t < end.entries[i - 1]!.t)) f.push(`the reading entries are out of the track's order: ${JSON.stringify(end.entries.map((e) => e.t / STEP))}`);

  const allowed: Allowed = { base: plan.base, files: plan.files, sources: [source.outside] };
  const reached = [...page.reached, ...(await page.spied())];
  f.push(...requestFailures(allowed, reached, bundle.log.slice(bundleFrom), source.log.slice(sourceFrom)));
  await page.close();
  return { failures: f, given, steps: end.step, asked: source.log.slice(sourceFrom).filter((q) => q.method === 'GET').length, left: [...page.left] };
}
