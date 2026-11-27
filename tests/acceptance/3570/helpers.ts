// Test-side tools for the #3570 acceptance tests (README: The surface under test). A world is a real hub (`deep hub
// run`) in a temp home under /tmp/dh3570-*, the first-party plug-in `packages/jobs/import` installed with `deep
// install`, a `deep mcp` the test talks to as an agent's MCP client does, the hub's socket as the cli role (your trusted
// path, the OS confirmation stubbed by DEEP_HUB_TEST_CONFIRM), and an HTTPS file server on 127.0.0.1 under a test CA the
// hub trusts through NODE_EXTRA_CA_CERTS. A published table is a data pack the test installs, its assets listed by URL
// and SHA-256 on that server, fetched once through the hub's Source block after one ask (#1820's path), and handed to
// `deep_job {op: run, kind: import}` by its hash in the evidence store. Cut down from #1922's, #1731's and #1820's
// suites' helpers, copied, never imported.
//
// No function here asserts. What a program answers and what is wrong with it come back as values or text, so each
// test's failing assertion is in its own file. A hub that can't start, a fetch that never lands, a binary not built:
// `BLOCKED:`; a reading that can't be judged: `INCONCLUSIVE:`. Nothing missing or unrun passes.
//
// Safety: every folder is under /tmp/dh3570-* and removed after its file; HOME is a temp home for every child; DEEP_*,
// CLAUDE*, CODEX* and NODE_OPTIONS are left out of their environment; nothing leaves 127.0.0.1; every process is one
// this file started, stopped by its PID.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll } from 'vitest';
import { sha256 } from './fixtures.ts';

export { sha256 };
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
const HERE = fileURLToPath(new URL('./', import.meta.url));
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = {
  1: 'AC1 #3570.d751be37', 2: 'AC2 #3570.dabc4318', 3: 'AC3 #3570.090eb211', 4: 'AC4 #3570.c30fc78d', 5: 'AC5 #3570.9251b800',
  6: 'AC6 #3570.39c1c79a', 7: 'AC7 #3570.df4af9a2', 8: 'AC8 #3570.112c972a', 9: 'AC9 #3570.1144aef4',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const first = (text: string): string => text.split('\n')[0] ?? '';
export const show = (v: unknown, most = 900): string => (JSON.stringify(v) ?? 'undefined').slice(0, most);

// ---------------------------------------------------------------------------------------------------
// Temp folders, processes and servers, all gone after the file

const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3570-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const closers: (() => Promise<void>)[] = [];
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/** Resolves once `done()` holds, checking each time the event loop turns, or rejects at `ms`. */
function until(done: () => boolean, ms: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // deadline: a process that ignores SIGTERM is waited on this long before it is killed.
    const bound = setTimeout(() => { clearImmediate(tick); reject(Error(what)); }, ms);
    let tick: NodeJS.Immediate;
    const look = () => { if (done()) { clearTimeout(bound); resolve(); } else tick = setImmediate(look); };
    tick = setImmediate(look);
  });
}
afterAll(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  await until(() => ![...owned].some(alive), 3000, 'still running').catch(() => undefined);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export const said = (r: Ran): string => `${r.stdout}\n${r.stderr}`;
function run(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // deadline: a CLI call that hangs is killed after 5 minutes, a failure in place of a hang.
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---------------------------------------------------------------------------------------------------
// TLS and the file server

function certs(dir: string): { key: string; cert: string; ca: string } {
  const at = (f: string) => join(dir, f);
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('leaf.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_leaf]\nbasicConstraints = CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:127.0.0.1\n');
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  ssl('req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh3570 test CA', '-config', 'ca.cnf', '-extensions', 'v3_ca');
  ssl('req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1', '-config', 'leaf.cnf');
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.cnf', '-extensions', 'v3_leaf');
  return { key: readFileSync(at('leaf.key'), 'utf8'), cert: readFileSync(at('leaf.pem'), 'utf8'), ca: at('ca.pem') };
}
interface Files { host: string; routes: Map<string, Buffer>; served: Map<string, number>; waiters: Set<() => void> }
async function openFiles(tls: { key: string; cert: string }): Promise<Files> {
  const routes = new Map<string, Buffer>();
  const served = new Map<string, number>();
  const waiters = new Set<() => void>();
  // A file is served whole, or by the byte ranges the hub's Source block asks for (#1820: a large file is read in
  // aligned blocks, each checked against its Content-Range, under the ETag of the first answer). `served` counts the
  // answers that hold a file's last byte.
  const server: Server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x.invalid').pathname;
    req.resume();
    const body = routes.get(path);
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !body) return void res.writeHead(404).end('not found');
    const etag = `"${sha256(body).slice(0, 32)}"`;
    const common = { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag, 'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT' };
    const match = req.headers['if-match'];
    if (match !== undefined && match !== etag && match !== '*') return void res.writeHead(412, common).end();
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers['range'] ?? ''));
    let start = 0, end = body.length - 1, status = 200;
    if (range && (range[1] !== '' || range[2] !== '')) {
      if (range[1] === '') { start = Math.max(0, body.length - Number(range[2])); } else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
      if (start > end || start >= body.length) return void res.writeHead(416, { ...common, 'content-range': `bytes */${body.length}` }).end();
      status = 206;
    }
    const part = body.subarray(start, end + 1);
    if (req.method === 'GET' && end === body.length - 1) res.on('finish', () => { served.set(path, (served.get(path) ?? 0) + 1); for (const w of [...waiters]) w(); });
    res.writeHead(status, { ...common, 'content-length': part.length, ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}) });
    res.end(req.method === 'HEAD' ? undefined : part);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  return { host: `127.0.0.1:${(server.address() as AddressInfo).port}`, routes, served, waiters };
}

// ---------------------------------------------------------------------------------------------------
// The hub, its socket, deep mcp

interface HubProc { pid: number; socket: string; root: string; child: ChildProcess }
async function startHub(home: string, env: Record<string, string>): Promise<HubProc> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    // deadline: a hub that never says it is ready within 2 minutes didn't start.
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start (deep hub run): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  return { pid: child.pid!, socket: typeof ready.socket === 'string' ? ready.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild'), child };
}
async function control(w: World, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    // deadline: a socket call the hub never answers fails at this bound.
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
        else if (step === 1) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (line.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
async function events(w: World, after = 0): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = after; ;) {
    const reply = await control(w, 'events.read', { after: from, limit: 1000 });
    if (reply.error) throw Error(`BLOCKED: events.read was refused: ${show(reply.error)}`);
    const page = (reply.result?.events ?? []) as Line[];
    all.push(...page);
    if (page.length < 1000) return all;
    from = page[page.length - 1]!.log_pos;
  }
}
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {});
async function asks(w: World): Promise<{ handle: string; kind: string; data: Line }[]> {
  return (await events(w)).filter((e) => e.kind === 'ask.created').map((e) => ({ handle: `ask:${String(e.id)}`, kind: String(dataOf(e).kind), data: dataOf(e) }));
}
function yes(w: World, ask: { handle: string; data: Line }): Promise<Ran> {
  const option = (ask.data.options as Line[] | undefined)?.find((o) => o.decision === 'allow')?.id;
  if (typeof option !== 'string') return Promise.resolve({ code: null, stdout: '', stderr: `${ask.handle} has no option that says yes: ${show(ask.data.options)}` });
  return run(['inbox', 'answer', ask.handle, option], w.home, w.work);
}

export interface Outcome { isError: boolean; value: Line; text: string }
class Mcp {
  private lines: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = 600_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      // deadline: a call deep mcp never answers fails at this bound.
      const timer = setTimeout(() => { this.wakers.delete(check); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const at = this.lines.findIndex((l) => parse(l)?.id === id);
        if (at >= 0) { clearTimeout(timer); this.wakers.delete(check); resolve(parse(this.lines.splice(at, 1)[0]!)!); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); reject(Error(`deep mcp exited ${this.child.exitCode}`)); }
      };
      this.wakers.add(check);
      check();
    });
  }
  notify(method: string): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); }
}
async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  if (child.pid) owned.add(child.pid);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-3570', version: '0' } });
  if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${show(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}
async function tool(w: World, name: string, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name, arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
const job = (w: World, args: Line): Promise<Outcome> => tool(w, 'deep_job', args);

// ---------------------------------------------------------------------------------------------------
// The world, and the import kind's table tool

/** The first-party plug-in that holds the kind, and the kind, both the base's (#162). */
export const IMPORT_PACKAGE = join(REPO, 'packages', 'jobs', 'import');
export const KIND = 'import';
/** The one tool of the kind that reads tables *(chosen)*: its name starts `table`, pinned as every job tool is. */
const TOOL_NAME = /^table[a-z0-9_-]*@\d+\.\d+\.\d+$/;

export interface World {
  tmp: string; home: string; work: string; hub: HubProc; mcp: Mcp; files: Files;
  /** The hub's evidence store, `<home>/.deepbuild/evidence`. */
  evidence: string;
  /** The kind's table tool, name@version, as deep_job lists it. */
  tool: string;
}
async function toolsOf(w: Omit<World, 'tool'>): Promise<string[] | string> {
  let listed: Outcome;
  try { listed = await job(w as World, { op: 'list' }); } catch (e) { return `BLOCKED: deep_job {op: list} gave no reply: ${first(message(e))}; this is not a pass`; }
  const kinds = Array.isArray(listed.value['kinds']) ? (listed.value['kinds'] as Line[]) : [];
  const kind = kinds.find((k) => k['kind'] === KIND);
  if (!kind) return `deep_job lists no kind ${KIND}: ${listed.text.slice(0, 600)}`;
  return (Array.isArray(kind['tools']) ? kind['tools'] : []).filter(isObj).map((t) => String(t['tool']));
}
/**
 * A world with `packages/jobs/import` installed and its one table tool; or, as text, what is missing: a hub that
 * doesn't start (`BLOCKED:`, tried three times, since a loaded machine starts one slowly), an install that is refused,
 * or a kind that lists no table tool or more than one.
 */
export async function openWorld(): Promise<World | string> {
  if (!existsSync(join(REPO, 'target', 'debug', 'deep-hook'))) return 'BLOCKED: no deep-hook is built (README, How to run); the hub won\'t start without it; this is not a pass';
  let w: Omit<World, 'tool'> | undefined;
  let why = '';
  for (let attempt = 0; attempt < 3 && !w; attempt++) {
    try {
      const tmp = tempDir();
      const home = join(tmp, 'h');
      const work = join(tmp, 'work');
      mkdirSync(home);
      mkdirSync(work);
      mkdirSync(join(tmp, 'tls'));
      const tls = certs(join(tmp, 'tls'));
      const files = await openFiles(tls);
      writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
      const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), NODE_EXTRA_CA_CERTS: tls.ca });
      const mcp = await startMcp(home, work);
      w = { tmp, home, work, hub, mcp, files, evidence: join(home, '.deepbuild', 'evidence') };
    } catch (e) { why = first(message(e)); }
  }
  if (!w) return `${why.startsWith('BLOCKED:') ? '' : 'BLOCKED: '}${why}; this is not a pass`;
  const ran = await run(['install', IMPORT_PACKAGE], w.home, w.work);
  if (ran.code !== 0) return `deep install packages/jobs/import didn't load it: exit ${String(ran.code)}: ${said(ran).trim().slice(-1200)}`;
  const tools = await toolsOf(w);
  if (typeof tools === 'string') return tools;
  const mine = tools.filter((t) => TOOL_NAME.test(t));
  if (mine.length !== 1) return `the kind ${KIND} lists ${mine.length} tools whose name starts table, not one (README: The surface under test); its tools: ${tools.join(', ') || 'none'}`;
  return { ...w, tool: mine[0]! };
}

// ---------------------------------------------------------------------------------------------------
// Publishing a table and fetching it once through the Source block

export interface Published { path: string; url: string; sha256: string; size: number; pack: string }
let packs = 0;
const CC0 = { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/', shareable: true, credit: null };
/** Serves each file on the world's server and installs a data pack that lists them by URL, SHA-256 and size. */
export async function publish(w: World, files: Record<string, Buffer>): Promise<Record<string, Published> | string> {
  const id = `agency/tables${++packs}`;
  const version = '1.0.0';
  const out: Record<string, Published> = {};
  for (const [path, bytes] of Object.entries(files)) {
    const route = `/${id}/${path}`;
    w.files.routes.set(route, bytes);
    out[path] = { path, url: `https://${w.files.host}${route}`, sha256: sha256(bytes), size: bytes.length, pack: `${id}@${version}` };
  }
  const dir = join(w.tmp, `pack-${packs}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({
    id, name: id.split('/')[1], version, license: 'CC0-1.0', description: 'Published tables for the #3570 acceptance tests.', requires: { core: '^1', modules: {} },
    assets: Object.values(out).map((a) => ({ path: a.path, url: a.url, sha256: a.sha256, size: a.size, license: CC0, upstream: { url: a.url, version, modified: '2026-01-01T00:00:00Z' } })),
  }, null, 2)}\n`);
  const ran = await run(['install', dir], w.home, w.work);
  if (ran.code !== 0) return `BLOCKED: deep install of a data pack listing the tables by URL didn't install it (#1820's path): ${said(ran).trim().slice(-800)}; this is not a pass`;
  return out;
}
export interface Fetched { sha256: string; url: string; asked: number; landed: number; reply: Line }
/**
 * The hub's fetch of one published file (`deep_kinds {op: fetch, pack, asset}`): held on one authority ask, your yes
 * on the trusted path, then fetched once the server has sent it. `asked` and `landed` bound the fetch time the hub
 * may write. Or, as text, why it never landed.
 */
export async function fetchFile(w: World, p: Published): Promise<Fetched | string> {
  const args = { op: 'fetch', pack: p.pack, asset: p.path };
  const before = (await asks(w)).length;
  const asked = Date.now();
  let o = await tool(w, 'deep_kinds', args);
  if (o.value.status === 'held') {
    const raised = (await asks(w)).slice(before).filter((a) => a.kind === 'authority');
    if (raised.length !== 1) return `BLOCKED: the fetch of ${p.path} is held, and ${raised.length} authority asks were raised, not one: ${o.text.slice(0, 400)}`;
    const answered = await yes(w, raised[0]!);
    if (answered.code !== 0) return `BLOCKED: your yes to the fetch of ${p.path} wasn't taken: ${said(answered).trim().slice(-400)}`;
    const route = new URL(p.url).pathname;
    // A fetch your yes started answers held while it runs; once the server has sent the file, it lands.
    await new Promise<void>((resolve) => {
      // deadline: a file whose last byte the hub hasn't asked for in 2 minutes is polled for as it stands.
      const bound = setTimeout(() => { w.files.waiters.delete(wake); resolve(); }, 120_000);
      const wake = () => { if ((w.files.served.get(route) ?? 0) > 0) { clearTimeout(bound); w.files.waiters.delete(wake); resolve(); } };
      w.files.waiters.add(wake);
      wake();
    });
    const deadline = Date.now() + 600_000; // deadline: a fetch that never lands fails, not hangs.
    do { o = await tool(w, 'deep_kinds', args); } while (o.value.status === 'held' && Date.now() < deadline);
  }
  const landed = Date.now();
  if (o.value.status !== 'fetched' || o.value.asset?.sha256 !== p.sha256) return `BLOCKED: the hub's fetch of ${p.path} didn't land by its SHA-256 (#1820): ${o.text.slice(0, 600)}; this is not a pass`;
  return { sha256: p.sha256, url: p.url, asked, landed, reply: o.value };
}
/** Publishes the files and fetches each: the fetched files by name, or why one isn't. */
export async function fetchAll(w: World, files: Record<string, Buffer>): Promise<Record<string, Fetched> | string> {
  const published = await publish(w, files);
  if (typeof published === 'string') return published;
  const out: Record<string, Fetched> = {};
  for (const [name, p] of Object.entries(published)) {
    const f = await fetchFile(w, p);
    if (typeof f === 'string') return f;
    out[name] = f;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The import, and what it writes

/** A column the import names *(chosen: `unit` is always written, since the Scope gives it no default)*. */
export interface Column { from: string; dtype: 'str' | 'i64' | 'f64'; unit: string; missing?: string[]; group?: string }
/** The params of a table import *(chosen: flat beside `from`, as `from: urdf` sits beside `look`; the file is the input `file`)*. */
export interface TableParams {
  member?: string; format?: 'csv' | 'jsonl' | 'xlsx'; delimiter?: 'comma' | 'tab' | 'pipe'; sheet?: string; header?: number;
  encoding?: 'utf-8' | 'latin-1' | 'windows-1252'; columns: Record<string, Column>; key: string;
  where?: ({ column: string; in: string[] } | { column: string; prefix: string })[]; max_bytes?: number;
}
/** Criterion 1's import of the pipe file, which criteria 2 and 9 run too: three columns, the counties by prefix. */
export const COUNTY_COLUMNS = ['GEO_ID', 'NAME', 'POP'];
export const COUNTY_PARAMS: TableParams = {
  format: 'csv', delimiter: 'pipe',
  columns: { GEO_ID: { from: 'GEO_ID', dtype: 'str', unit: 'text' }, NAME: { from: 'NAME', dtype: 'str', unit: 'text' }, POP: { from: 'POP', dtype: 'i64', unit: 'people' } },
  key: 'GEO_ID', where: [{ column: 'GEO_ID', prefix: '0500000US' }],
};
/** The three columns of the small comma, tab and latin-1 tables, `pop` with its own spec. */
export const smallParams = (pop: Partial<Column> = {}, more: Partial<TableParams> = {}): TableParams => ({
  columns: { fips: { from: 'fips', dtype: 'str', unit: 'text' }, name: { from: 'name', dtype: 'str', unit: 'text' }, pop: { from: 'pop', dtype: 'i64', unit: 'people', ...pop } },
  key: 'fips', ...more,
});
export interface Ran2 { outcome: Outcome; ms: number }
/** One deep_job run of the table import on a fetched file, given by its SHA-256 in the evidence store, and its wall time. */
export async function runTable(w: World, params: TableParams, sha: string, toolName = w.tool): Promise<Ran2 | string> {
  const t0 = performance.now();
  try {
    const outcome = await job(w, { op: 'run', kind: KIND, tool: toolName, params: JSON.stringify({ from: 'table', ...params }), inputs: [{ name: 'file', sha256: sha }] });
    return { outcome, ms: performance.now() - t0 };
  } catch (e) {
    return `BLOCKED: the run gave no reply: ${first(message(e))}; this is not a pass`;
  }
}
export const done = (o: Outcome): boolean => !o.isError && o.value.status === 'done';
/** A reply's outputs, each by its SHA-256. */
export function outputsOf(o: Outcome): Record<string, string> {
  const outputs = isObj(o.value['outputs']) ? (o.value['outputs'] as Line) : {};
  return Object.fromEntries(Object.entries(outputs).map(([n, v]) => [n, isObj(v) && typeof v['sha256'] === 'string' ? v['sha256'] : '']));
}
/** Bytes the hub's evidence store holds under a SHA-256 (`<2 hex>/<62 hex>`), or null. */
export function stored(w: World, sha: string): Buffer | null {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  const path = join(w.evidence, sha.slice(0, 2), sha.slice(2));
  return existsSync(path) ? readFileSync(path) : null;
}
/** Every file under the hub's evidence store, by its path there, sorted: what a refusal must leave as it was. */
export function kept(w: World): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (lstatSync(path).isDirectory()) walk(path);
      else out.push(relative(w.evidence, path));
    }
  };
  walk(w.evidence);
  return out.sort();
}
/** The output named `table` *(chosen)*: its SHA-256 and its bytes from the store, or why there are none. */
export function tableOf(w: World, o: Outcome): { sha256: string; bytes: Buffer } | string {
  if (!done(o)) return `the import isn't done: ${o.text.slice(0, 900)}`;
  const sha = outputsOf(o)['table'];
  if (!sha) return `the import wrote no output named table: outputs ${show(o.value['outputs'], 400)}`;
  const bytes = stored(w, sha);
  if (!bytes) return `the evidence store holds no table ${sha}`;
  return { sha256: sha, bytes };
}
/** The receipt's fields wherever the import writes them *(chosen: the reply's receipt, or a JSON output beside the table)*: the first object holding `rows_read`. */
export function receiptOf(w: World, o: Outcome): Line | string {
  if (isObj(o.value['receipt']) && 'rows_read' in o.value['receipt']) return o.value['receipt'] as Line;
  for (const [name, sha] of Object.entries(outputsOf(o))) {
    if (name === 'table') continue;
    const bytes = stored(w, sha);
    const v = bytes ? parse(bytes.toString('utf8')) : undefined;
    if (v && 'rows_read' in v) return v;
    if (v && isObj(v['receipt']) && 'rows_read' in v['receipt']) return v['receipt'] as Line;
  }
  return `no receipt with rows_read in the reply's receipt or any output: ${o.text.slice(0, 900)}`;
}

/** A table asset as rows: its header, and each row's cells as text, a missing cell null (an empty CSV cell, a JSON null or a key left out). */
export interface Table { columns: string[]; rows: (string | null)[][] }
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i <= text.length) {
    let cell = '';
    if (text[i] === '"') {
      i++;
      for (;;) {
        if (i >= text.length) break;
        if (text[i] === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        if (text[i] === '"') { i++; break; }
        cell += text[i++];
      }
      while (i < text.length && text[i] !== ',' && text[i] !== '\n') i++;
    } else {
      while (i < text.length && text[i] !== ',' && text[i] !== '\n') cell += text[i++];
      if (cell.endsWith('\r') && (i >= text.length || text[i] === '\n')) cell = cell.slice(0, -1);
    }
    row.push(cell);
    const end = i >= text.length || text[i] === '\n';
    i++;
    if (end) { if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; }
  }
  return rows;
}
const cellText = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));
/** Reads a table asset: JSON lines if its first line is an object, else CSV with its header first. */
export function readTable(bytes: Buffer): Table | string {
  const text = bytes.toString('utf8');
  const firstLine = text.split('\n').find((l) => l.trim() !== '') ?? '';
  if (firstLine.trim().startsWith('{')) {
    const objects: Line[] = [];
    for (const [n, line] of text.split('\n').entries()) {
      if (line.trim() === '') continue;
      const v = parse(line);
      if (!v) return `the table's line ${n + 1} isn't one JSON object`;
      objects.push(v);
    }
    const columns: string[] = [];
    for (const o of objects) for (const k of Object.keys(o)) if (!columns.includes(k)) columns.push(k);
    return { columns, rows: objects.map((o) => columns.map((c) => cellText(o[c]))) };
  }
  const [header, ...rows] = csvRows(text);
  if (!header) return 'the table has no header row';
  return { columns: header, rows: rows.map((r) => r.map((c) => (c === '' ? null : c))) };
}
/** A table's rows as the given columns in that order, or why it lacks one. */
export function cut(t: Table, columns: string[]): (string | null)[][] | string {
  const at = columns.map((c) => t.columns.indexOf(c));
  if (at.some((i) => i < 0)) return `the table's columns are ${show(t.columns)}, not ${show(columns)}`;
  return t.rows.map((r) => at.map((i) => r[i] ?? null));
}
/** The first row where `got` and `want` differ, in words, or '' when they hold the same rows in the same order. */
export function firstDiff(got: (string | null)[][], want: (string | null)[][]): string {
  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (JSON.stringify(got[i]) !== JSON.stringify(want[i])) return `row ${i + 1} of ${got.length} reads ${show(got[i], 200)} where ${want.length} rows are expected and row ${i + 1} is ${show(want[i], 200)}`;
  }
  return '';
}

/** Whether a refusal's text names a row of a small table: its line in the file, its data row from 1 or 0, or its key. */
export function namesRow(text: string, line: number, key: string): boolean {
  return [line, line - 1, line - 2].some((n) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(text)) || text.includes(key);
}
/** A refusal's words: status refused, its reason, and no outputs. */
export function refusalOf(o: Outcome): { refused: boolean; reason: string; outputs: number } {
  const reason = typeof o.value['reason'] === 'string' ? o.value['reason'] : o.isError ? o.text : '';
  return { refused: o.isError || o.value['status'] === 'refused', reason, outputs: Object.keys(outputsOf(o)).length };
}

// ---------------------------------------------------------------------------------------------------
// The planted readers (README: The planted readers)

export type PlantName = 'takes_first_member' | 'evaluates_formulas' | 'reads_marker_as_zero';
const PLANTED_TOOL: Record<PlantName | 'as_is', string> = {
  takes_first_member: 'takes-first-member@1.0.0', evaluates_formulas: 'evaluates-formulas@1.0.0', reads_marker_as_zero: 'reads-marker-as-zero@1.0.0', as_is: 'runs-as-is@1.0.0',
};
interface Registered { kind: string; descriptor: Line }
/** The table tool as the import plug-in hands it to `deep.registerJobTool`, read with a `deep` that only records. */
async function rightTool(): Promise<Registered | string> {
  const tools: Registered[] = [];
  const deep = new Proxy({}, {
    get: (_target, name) => {
      if (name === 'then') return undefined;
      if (name === 'registerJobTool') return async (kind: unknown, descriptor: unknown) => { tools.push({ kind: String(kind), descriptor: JSON.parse(JSON.stringify(descriptor ?? {})) as Line }); };
      return async () => undefined;
    },
  });
  try {
    const plugin = await import(pathToFileURL(join(IMPORT_PACKAGE, 'index.ts')).href) as { default?: (deep: unknown) => Promise<void> };
    if (typeof plugin.default !== 'function') return 'packages/jobs/import/index.ts has no default export';
    await plugin.default(deep);
  } catch (e) { return `packages/jobs/import/index.ts couldn't register its tools: ${first(message(e))}`; }
  const mine = tools.filter((t) => t.kind === KIND && TOOL_NAME.test(String(t.descriptor['tool'])));
  if (mine.length !== 1) return `the import plug-in registers ${mine.length} table tools, not one`;
  const runs = mine[0]!.descriptor['run'];
  if (!isObj(runs) || typeof runs['dir'] !== 'string' || typeof runs['entry'] !== 'string') return `the table tool doesn't run as its own files (run {dir, entry}): ${show(runs, 200)}`;
  return mine[0]!;
}
const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
/**
 * A plug-in that adds one tool to the kind: a copy of the table tool's folder with `deep-3570-plant.mjs` and its plan
 * laid beside its files, registered under the table tool's own descriptor but for its name and its entry. The entry
 * runs the right entry with `DEEP_3570_PLANT` set to the plant's name (none for `as_is`), its stdin, stdout and stderr
 * handed through as they are.
 */
function plantedPlugin(dir: string, right: Registered, name: PlantName | 'as_is'): void {
  const runs = right.descriptor['run'] as Line;
  const folder = join(dir, String(runs['dir']));
  mkdirSync(dir, { recursive: true });
  cpSync(join(IMPORT_PACKAGE, String(runs['dir'])), folder, { recursive: true });
  writeFileSync(join(folder, 'deep-3570-plant.mjs'), readFileSync(join(HERE, 'plant', 'plant.mjs.fixture')));
  writeFileSync(join(folder, 'deep-3570-plan.json'), `${JSON.stringify({ entry: runs['entry'], plant: name === 'as_is' ? null : name })}\n`);
  writeFileSync(join(dir, 'index.ts'), readFileSync(join(HERE, 'plant', 'index.ts.fixture')));
  const descriptor = { ...right.descriptor, tool: PLANTED_TOOL[name], run: { ...runs, entry: 'deep-3570-plant.mjs' } };
  writeFileSync(join(dir, 'probe.json'), `${JSON.stringify({ kind: KIND, descriptor }, null, 2)}\n`);
  const manifest: Line = { id: `test/${PLANTED_TOOL[name].split('@')[0]!}`, version: '1.0.0', digest: 'd1:0', job_tools: [{ kind: KIND, tool: PLANTED_TOOL[name] }], requires: { preview: ['deep.registerJobTool'] } };
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  manifest['digest'] = packageDigest(dir);
  writeFileSync(join(dir, 'deepbuild.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
export interface Planted { problem: string; tool: string; asIs: string; control: Ran | null; controlListed: boolean; install: Ran | null; listed: string[] }
/** Installs `runs-as-is@1.0.0` and then the planted tool: the kind's qualification, run by `deep install`, judges both. */
export async function plant(w: World, name: PlantName): Promise<Planted> {
  const out: Planted = { problem: '', tool: PLANTED_TOOL[name], asIs: PLANTED_TOOL.as_is, control: null, controlListed: false, install: null, listed: [] };
  const right = await rightTool();
  if (typeof right === 'string') return { ...out, problem: right };
  const add = async (which: PlantName | 'as_is'): Promise<Ran | string> => {
    try {
      const dir = join(w.tmp, `planted-${which}`);
      plantedPlugin(dir, right, which);
      return await run(['install', dir], w.home, w.work);
    } catch (e) { return `BLOCKED: the plug-in of ${PLANTED_TOOL[which]} couldn't be made or installed: ${first(message(e))}; this is not a pass`; }
  };
  const control = await add('as_is');
  if (typeof control === 'string') return { ...out, problem: control };
  out.control = control;
  const after = await toolsOf(w);
  out.controlListed = typeof after !== 'string' && after.includes(out.asIs);
  const planted = await add(name);
  if (typeof planted === 'string') return { ...out, problem: planted };
  out.install = planted;
  const tools = await toolsOf(w);
  if (typeof tools === 'string') return { ...out, problem: tools };
  out.listed = tools;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The document check (#397's and #406's surface): `deep-canvas-render check` with the hub's evidence store

/** The debug `deep-canvas-render` this checkout built (README, How to run), or why there is none. */
export function renderBin(): string {
  const bin = join(REPO, 'target', 'debug', 'deep-canvas-render');
  return existsSync(bin) ? bin : '';
}
/** One `check` of a document under the clean look, its tables read from the hub's evidence store: the reply. */
export function check(w: World, doc: Line): Line | string {
  const bin = renderBin();
  if (!bin) return 'BLOCKED: no deep-canvas-render is built (README, How to run); this is not a pass';
  const r = spawnSync(bin, ['check'], { cwd: REPO, input: `${JSON.stringify({ doc, look: 'clean', evidence: w.evidence })}\n`, encoding: 'utf8', maxBuffer: 256 << 20, timeout: 600_000, killSignal: 'SIGKILL' });
  if (r.error) return `BLOCKED: deep-canvas-render check couldn't run: ${r.error.message}`;
  const reply = parse((r.stdout ?? '').trim().split('\n')[0] ?? '');
  return reply ?? `deep-canvas-render check answered no JSON: exit ${String(r.status)}, ${(r.stdout ?? '').slice(0, 400)} ${(r.stderr ?? '').slice(-400)}`;
}
/**
 * A time the trace's source holds under a key `fetched`, anywhere in it, in ms since the epoch: a number of ms or of
 * seconds, or an ISO 8601 string. Every one found.
 */
export function fetchedTimes(v: unknown): number[] {
  const out: number[] = [];
  const walk = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!isObj(x)) return;
    for (const [k, val] of Object.entries(x)) {
      if (k === 'fetched') {
        if (typeof val === 'number') out.push(val < 1e11 ? val * 1000 : val);
        else if (typeof val === 'string' && !Number.isNaN(Date.parse(val))) out.push(Date.parse(val));
      }
      walk(val);
    }
  };
  walk(v);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Budgets and machines

/** A reading judged once (AGENTS.md: a budget is best effort under load): PASS or FAIL on a fit reference Mac at a load under its cores, else INCONCLUSIVE. */
export async function judgeOnce(ms: number, limit: number): Promise<{ status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; reason: string }> {
  const bench = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { fingerprint(): Line; references: Line[] };
  const machine = bench.fingerprint();
  const load = loadavg()[0]!;
  const cores = availableParallelism();
  const reading = `one reading: ${Math.round(ms)} ms against ${limit} ms, load ${load.toFixed(1)} on ${cores} cores, ${String(machine['model'])} (${String(machine['chip'])}), power ${String(machine['power'])}, Low Power Mode ${String(machine['lowPowerMode'])}, thermal ${String(machine['thermalState'])}`;
  const reference = bench.references.some((r) => r['model'] === machine['model'] && r['chip'] === machine['chip'] && r['memoryBytes'] === machine['memoryBytes']);
  const fit = machine['power'] === 'ac' && machine['lowPowerMode'] === false && machine['thermalState'] === 'nominal';
  if (!reference || !fit || !(load <= cores)) return { status: 'INCONCLUSIVE', reason: `INCONCLUSIVE: ${reading}; not a fit reference Mac at a load under its cores, so this is a reading, not a budget result` };
  return ms <= limit ? { status: 'PASS', reason: reading } : { status: 'FAIL', reason: `${reading}: over the budget` };
}
/** The second machine for criterion 8 (README: Two machines): a Linux aarch64 host by ssh, or why there is none. */
export function linuxHost(): { host: string; dir: string } | string {
  const host = process.env['DEEP_LINUX_AARCH64'];
  const dir = process.env['DEEP_LINUX_AARCH64_DIR'];
  if (!host || !dir) return 'INCONCLUSIVE: no second machine: set DEEP_LINUX_AARCH64 to a Linux aarch64 host\'s ssh destination and DEEP_LINUX_AARCH64_DIR to a built checkout of this commit there; the Mac pair alone is not two machines';
  return { host, dir };
}
/** The table hash the other machine's run of criterion 8's leg prints, or why it gave none. */
export function remoteTable(h: { host: string; dir: string }): string {
  const leg = '/tmp/deep-3570-leg.txt';
  const r = spawnSync('ssh', [h.host, `cd ${JSON.stringify(h.dir)} && rm -f ${leg} && DEEP_3570_LEG=${leg} node node_modules/vitest/vitest.mjs run --root tests/acceptance/3570 ac8-trace.test.ts -t "one machine" --testTimeout=600000 --hookTimeout=180000; cat ${leg}`], { encoding: 'utf8', timeout: 1_800_000, maxBuffer: 64 << 20 });
  const m = /#3570 table sha256 ([0-9a-f]{64})/.exec(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  return m ? m[1]! : `BLOCKED: the run on ${h.host} printed no table hash: exit ${String(r.status)}, ${(r.stdout ?? '').slice(-600)} ${(r.stderr ?? '').slice(-600)}`;
}
