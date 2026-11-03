// Test-side tools for the #1106 acceptance tests: temp folders and a temp HOME, a test repo with a worktree and a
// plain checkout carrying the done.yaml environment block (README, The surface under test), the hub as a process
// (`deep hub run --root`) with a small client for its line protocol, `deep env up`/`down` as a person runs them,
// the sample APIs (HTTPS servers of the test's own on loopback, with a test CA made per test), and the app's own
// report of what it holds and what its calls got (fixtures/app.mjs). Nothing here stands in for the hub, env-local,
// the supervisor or its egress filter: the tests reach them through `deep env up`, the hub's `run.start` and its
// record. Adapted from tests/acceptance/332/helpers.ts (same repo, same license); this suite keeps its own copy.
//
// Safety: every process the tests start is stopped by PID only, after checking the PID still runs one of this
// suite's programs, never by name or port; every folder is under /tmp/dh1106-*; HOME is a temp folder for this
// process and every child; the agent's own CLAUDE_* and DEEP_* variables are removed first. Nothing here reads or
// writes the real login keychain or any system trust store: the one keychain path read is under the temp HOME, by
// that explicit path. Every credential value is a fake made up for the test; nothing leaves the loopback.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { afterAll, expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const APP = join(FIXTURES, 'app.mjs');
export const JOURNEY = join(FIXTURES, 'journey.mjs');
export const NODE = process.execPath;
export const COMMIT = '0000000000000000000000000000000000001106';
/** The byte each XOR'd copy is made with (fixtures/app.mjs). */
export const XOR_KEY = 0x5a;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
/** This process's HOME and every child's: a temp folder, made before the first thing a test starts. */
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh1106-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
afterAll(() => {
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export function ulid(ms = Date.now()): string {
  return base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
}

// ---- Temp folders: short real paths (a Unix socket path fits in 104 bytes; Seatbelt matches real paths).
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dh1106-'));
  made.push(dir);
  return dir;
}
export function sub(dir: string, ...names: string[]): string {
  const path = join(dir, ...names);
  mkdirSync(path, { recursive: true });
  return path;
}

// ---- Processes this suite started, and the PID files its fixtures write. Stopped by PID only.
const owned = new Set<number>();
const pidDirs = new Set<string>();
const closers: (() => Promise<void>)[] = [];
export function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
}
export function ownPidDir(dir: string): string {
  pidDirs.add(dir);
  return dir;
}
function pidsIn(dir: string): number[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => /^[a-z]+\.(\d+)$/.exec(name)).filter((m) => m !== null).map((m) => Number(m![1]));
}
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  try {
    return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}
function command(pid: number): string | undefined {
  try {
    return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
  } catch {
    return undefined;
  }
}
const ours = (pid: number): boolean => {
  const c = command(pid);
  return c !== undefined && (c.includes('/tmp/dh1106-') || c.includes(FIXTURES) || c.includes(CLI));
};
/** Stops every process this suite started or its fixtures recorded (SIGTERM, then SIGKILL), closes the sample APIs, and removes the folders. */
export async function cleanup(): Promise<void> {
  const pids = new Set<number>();
  for (const pid of owned) if (ours(pid)) pids.add(pid);
  for (const dir of pidDirs) for (const pid of pidsIn(dir)) if (ours(pid)) pids.add(pid);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...pids].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid) && ours(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  owned.clear();
  pidDirs.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The sample APIs: HTTPS servers on loopback with their own test CA (README, The sample APIs).
export interface Tls { caFile: string; ca: X509Certificate; key: string; cert: string }
/** A test CA and a server certificate it signed for localhost, 127.0.0.1 and ::1, made with the system's openssl. */
export function makeTls(): Tls {
  const dir = tempDir();
  const cnf = join(dir, 'openssl.cnf');
  writeFileSync(cnf, [
    '[req]', 'distinguished_name = dn', '[dn]',
    '[v3_ca]', 'basicConstraints = critical,CA:TRUE', 'keyUsage = critical,keyCertSign,cRLSign', 'subjectKeyIdentifier = hash',
    '[v3_leaf]', 'basicConstraints = CA:FALSE', 'keyUsage = critical,digitalSignature,keyEncipherment', 'extendedKeyUsage = serverAuth',
    'subjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1', '',
  ].join('\n'));
  const ssl = (...args: string[]) => execFileSync('/usr/bin/openssl', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } });
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh1106 sample API test CA', '-config', cnf, '-extensions', 'v3_ca');
  ssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'api.key', '-out', 'api.csr', '-subj', '/CN=localhost', '-config', cnf);
  ssl('x509', '-req', '-in', 'api.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'api.pem', '-days', '2', '-extfile', cnf, '-extensions', 'v3_leaf');
  const caFile = join(dir, 'ca.pem');
  return { caFile, ca: new X509Certificate(readFileSync(caFile)), key: readFileSync(join(dir, 'api.key'), 'utf8'), cert: readFileSync(join(dir, 'api.pem'), 'utf8') };
}
/** One request the sample API received, as it received it. */
export interface Seen { attempt: string; method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string }
export interface Api { name: string; host: string; port: number; seen: Seen[] }
/**
 * A sample API on 127.0.0.1 (and ::1 where it can, so `localhost` reaches it either way). It answers 200 with
 * `x-dh1106-upstream: <name>` only to `Authorization: Bearer <value>`, and 401 to anything else; it keeps every
 * request it got.
 */
export async function startApi(name: string, tls: Tls, hostName: 'localhost' | '127.0.0.1', value: string): Promise<Api> {
  const seen: Seen[] = [];
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d: string) => (body += d));
    req.on('end', () => {
      seen.push({ attempt: String(req.headers['x-dh1106-attempt'] ?? ''), method: req.method ?? '', url: req.url ?? '', headers: { ...req.headers }, body });
      const ok = req.headers.authorization === `Bearer ${value}`;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json', 'x-dh1106-upstream': name });
      res.end(JSON.stringify({ ok }));
    });
  };
  const v4 = https.createServer({ key: tls.key, cert: tls.cert }, handler);
  await new Promise<void>((resolve, reject) => { v4.once('error', reject); v4.listen(0, '127.0.0.1', resolve); });
  const port = (v4.address() as net.AddressInfo).port;
  const v6 = https.createServer({ key: tls.key, cert: tls.cert }, handler);
  const both = await new Promise<boolean>((resolve) => { v6.once('error', () => resolve(false)); v6.listen(port, '::1', () => resolve(true)); });
  closers.push(async () => {
    v4.closeAllConnections();
    await new Promise<void>((resolve) => v4.close(() => resolve()));
    if (both) { v6.closeAllConnections(); await new Promise<void>((resolve) => v6.close(() => resolve())); }
  });
  return { name, host: `${hostName}:${port}`, port, seen };
}
/** Whether a request the API received holds the text anywhere: its URL, any header or its body, raw or URL-encoded. */
export function holds(r: Seen, text: string): boolean {
  const all = `${r.url}\n${JSON.stringify(r.headers)}\n${r.body}`;
  return all.includes(text) || all.includes(encodeURIComponent(text));
}

// ---- The world every test starts from (README, The surface under test).
/** Clearly fake values: no service takes them. */
export const SHOP_VALUE = 'dh1106-FAKE-shop-api-key-not-a-secret-Qm7x';
export const OTHER_VALUE = 'dh1106-FAKE-other-api-key-not-a-secret-Zr4k';
export interface World { tls: Tls; shop: Api; other: Api; env: EnvBlock }
/**
 * The two sample APIs (shop at localhost:<port>, other at 127.0.0.1:<port>), each credential's dotfile in the temp
 * HOME, and the environment block that names them: SHOP_API_KEY for the shop API's host, GET and POST;
 * OTHER_API_KEY for the other's, GET.
 */
export async function world(): Promise<World> {
  const tls = makeTls();
  const shop = await startApi('shop', tls, 'localhost', SHOP_VALUE);
  const other = await startApi('other', tls, '127.0.0.1', OTHER_VALUE);
  for (const [dir, line] of [['.shop', `SHOP_API_KEY=${SHOP_VALUE}`], ['.other', `OTHER_API_KEY=${OTHER_VALUE}`]] as const) {
    mkdirSync(join(home(), dir), { recursive: true });
    writeFileSync(join(home(), dir, 'test.env'), `${line}\n`, { mode: 0o600 });
  }
  const env: EnvBlock = {
    up: `${sh(NODE, APP)} --pid-dir .pids`, ports: ['web'], ready: 'http://127.0.0.1:${web}/health', within: 20,
    credentials: {
      SHOP_API_KEY: { dotfile: '~/.shop/test.env', hosts: [shop.host], methods: ['GET', 'POST'] },
      OTHER_API_KEY: { dotfile: '~/.other/test.env', hosts: [other.host], methods: ['GET'] },
    },
  };
  return { tls, shop, other, env };
}
/** The hub's own environment for a world: the sample APIs' test CA, which its upstream connections trust, and a plant. */
export const hubEnv = (w: World, plant?: string): Record<string, string> => ({ NODE_EXTRA_CA_CERTS: w.tls.caFile, ...(plant ? { DEEP_HUB_PLANT: plant } : {}) });

// ---- The repo's environment block.
export interface Credential { dotfile: string; hosts?: string[]; methods?: string[] }
export interface EnvBlock { up: string; ports: string[]; ready: string; within?: number; credentials?: Record<string, Credential> }
const q = (s: string) => JSON.stringify(s);
export function doneYaml(env: EnvBlock): string {
  const lines = [
    'environment:',
    `  up: ${q(env.up)}`,
    `  ports: [${env.ports.join(', ')}]`,
    `  ready: { http: ${q(env.ready)}${env.within !== undefined ? `, within: ${env.within}` : ''} }`,
  ];
  if (env.credentials) {
    lines.push('  credentials:');
    for (const [variable, c] of Object.entries(env.credentials)) {
      const keys = [`dotfile: ${q(c.dotfile)}`];
      if (c.hosts) keys.push(`hosts: [${c.hosts.map(q).join(', ')}]`);
      if (c.methods) keys.push(`methods: [${c.methods.join(', ')}]`);
      lines.push(`    ${variable}: { ${keys.join(', ')} }`);
    }
  }
  return `${lines.join('\n')}\n`;
}
/** Shell words, single-quoted. */
export const sh = (...words: string[]): string => words.map((w) => (/^[\w./=-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`)).join(' ');

const gitEnv = (): NodeJS.ProcessEnv => ({ ...process.env, HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' });
function git(dir: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', ['-C', dir, '-c', 'user.name=dh1106', '-c', 'user.email=dh1106@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
}
/** A git repo (branch main) with .deepbuild/done.yaml, committed, and one worktree beside it: the folder `deep env up` runs in. */
export function makeWorktree(env: EnvBlock): string {
  const dir = tempDir();
  const repo = sub(dir, 'repo');
  for (const [path, text] of Object.entries({ '.deepbuild/done.yaml': doneYaml(env), '.gitignore': '.pids/\n' })) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'test repo');
  ownPidDir(join(repo, '.pids'));
  const wt = join(dir, 'wt-a');
  git(repo, 'worktree', 'add', '-q', '-b', 'wt-a', wt);
  ownPidDir(join(wt, '.pids'));
  return realpathSync(wt);
}
/** A plain folder holding the repo's files at its commit: a check's temporary checkout (not a worktree). */
export function makeCheckout(env: EnvBlock): string {
  const dir = sub(tempDir(), 'checkout');
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild/done.yaml'), doneYaml(env));
  ownPidDir(join(dir, '.pids'));
  return dir;
}

// ---- Waiting.
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(25);
  }
}

// ---- The app's own report: GET <path> on 127.0.0.1:<port>, its status and JSON body.
export function get(port: number, path: string, timeoutMs = 15_000): Promise<{ status: number | null; body: Line | null; error: string | null }> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d: string) => (text += d));
      res.on('end', () => {
        let body: Line | null = null;
        try { body = JSON.parse(text) as Line; } catch { body = null; }
        resolve({ status: res.statusCode ?? null, body, error: null });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: null, body: null, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: null, body: null, error: (e as NodeJS.ErrnoException).code ?? e.message }));
  });
}
/** What one call the app made through its egress got (fixtures/app.mjs, GET /call). */
export interface Call { status?: number; upstream?: string | null; error?: string; chain?: string[]; trust?: { variable: string; pem: string }[] }
/** Has the app call `to` with its variable's stand-in placed as `put` (header, query or body), tagged `attempt`. */
export async function call(port: number, o: { variable: string; to: string; put: 'header' | 'query' | 'body'; method: 'GET' | 'POST'; attempt: string }): Promise<Call> {
  const qs = new URLSearchParams({ var: o.variable, to: o.to, put: o.put, method: o.method, attempt: o.attempt });
  const r = await get(port, `/call?${qs}`);
  return r.body ?? { error: `GET /call on the app answered ${r.status ?? r.error}` };
}

// ---- The hub as a process: `deep hub run --root <folder>` (#16).
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home(), LC_ALL: 'C' };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface Hub { pid: number; root: string; socket: string; child: ChildProcess; exit: Promise<unknown>; stderr(): string }
export async function startHub(root: string, env: Record<string, string | undefined> = {}): Promise<Hub> {
  mkdirSync(root, { recursive: true });
  const child = spawn(NODE, [CLI, 'hub', 'run', '--root', root], { cwd: root, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise((resolve) => child.on('exit', resolve));
  const ready = new Promise<Line | undefined>((resolve) => {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) {
        try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); }
      }
    });
    void exit.then(() => resolve(undefined));
  });
  const line = await Promise.race([ready, sleep(20_000).then(() => undefined)]);
  if (!line?.ready) throw Error(`BLOCKED: the hub didn't start (deep hub run --root ${root}): ${err.slice(0, 2000)}`);
  return { pid: child.pid!, root, socket: line.socket as string, child, exit, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  if (!alive(hub.pid)) return;
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, sleep(10_000)]);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}

/** A client of the hub's line protocol with the cli role. */
export class Client {
  private buffer = '';
  private lines: Line[] = [];
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, i)) as Line); } catch { /* not a line of ours */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    sock.on('error', () => undefined);
  }
  static async open(hub: Hub): Promise<Client> {
    const sock = net.connect(hub.socket);
    await new Promise<void>((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    const c = new Client(sock);
    await waitFor(() => c.lines.length > 0, 5000, 'the hub\'s hello');
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(hub.root, 'control.token'), 'utf8').trim() })}\n`);
    await waitFor(() => c.lines.some((l) => l.role === 'cli'), 5000, 'the cli role');
    return c;
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await waitFor(() => this.lines.find((l) => l.id === id), timeoutMs, `the reply to ${method}`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  async events(kind?: string): Promise<Line[]> {
    const out: Line[] = [];
    for (let after = 0; ;) {
      const page = await this.call('events.read', { after, limit: 1000 });
      const events = page.events as Line[];
      if (!events.length) break;
      out.push(...events);
      after = events[events.length - 1]!.log_pos as number;
    }
    return kind ? out.filter((e) => e.kind === kind) : out;
  }
  close(): void { this.sock.destroy(); }
}

// ---- `deep env up` and `deep env down`, as a person runs them in a worktree.
export interface Ran { code: number | null; stdout: string; stderr: string }
export function deep(args: string[], o: { cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: o.cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { if (child.pid && ours(child.pid)) child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
function jsonOut(ran: Ran): Line | undefined {
  for (const line of ran.stdout.trim().split('\n').reverse()) {
    try { return JSON.parse(line) as Line; } catch { /* not JSON */ }
  }
  return undefined;
}
/** `deep env up` that must come up: exit 0 and status ready, or the test fails naming what it printed. */
export function mustBeReady(ran: Ran, where: string): Line {
  const out = jsonOut(ran);
  expect(ran.code, `deep env up in ${where} exits 0 (stdout ${ran.stdout.trim().slice(0, 600)} stderr ${ran.stderr.trim().slice(0, 600)})`).toBe(0);
  expect(out?.status, `deep env up in ${where} reports ready: ${JSON.stringify(out)}`).toBe('ready');
  expect(Number.isInteger(out?.ports?.web), `it names the port it leased for web (${JSON.stringify(out?.ports)})`).toBe(true);
  return out!;
}

/** A hub, a client, and the world's stack brought up by `deep env up` in a worktree: the scenario AC1, AC3 and AC4 share. */
export interface Up { w: World; hub: Hub; client: Client; wt: string; run: string; port: number }
export async function upWorld(plant?: string): Promise<Up> {
  const w = await world();
  const wt = makeWorktree(w.env);
  const hub = await startHub(sub(tempDir(), 'root'), hubEnv(w, plant));
  const client = await Client.open(hub);
  const out = mustBeReady(await deep(['env', 'up', '--root', hub.root, '--json'], { cwd: wt }), wt);
  return { w, hub, client, wt, run: out.run as string, port: out.ports.web as number };
}
export async function downWorld(u: Up | undefined): Promise<void> {
  if (!u) return;
  await deep(['env', 'down', '--root', u.hub.root, '--json'], { cwd: u.wt, timeoutMs: 60_000 }).catch(() => undefined);
  u.client.close();
  await stopHub(u.hub);
}

// ---- Files.
/** Every regular file under a folder. */
export function filesUnder(dir: string, skip: (path: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try { names = readdirSync(d); } catch { return; }
    for (const name of names) {
      const path = join(d, name);
      if (skip(path)) continue;
      let s;
      try { s = statSync(path); } catch { continue; }
      if (s.isDirectory()) walk(path);
      else if (s.isFile()) out.push(path);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
/** A file's bytes, a packed (.zst) one unpacked; undefined when it can't be read. */
export function bytesOf(path: string): Buffer | undefined {
  try {
    const raw = readFileSync(path);
    return path.endsWith('.zst') ? zstdDecompressSync(raw) : raw;
  } catch {
    return undefined;
  }
}
