import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const HERE = fileURLToPath(new URL('./', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
const DEBUG = join(REPO, 'target', 'debug');
export const TIMEOUT = 1_800_000;

export const AC = {
  1: 'AC1 #3575.1149d4e1', 2: 'AC2 #3575.cc5a5b34', 3: 'AC3 #3575.b050d53d', 4: 'AC4 #3575.f439728a',
  5: 'AC5 #3575.e744d3c9', 6: 'AC6 #3575.1f2653c3', 7: 'AC7 #3575.397602e4', 8: 'AC8 #3575.723dcdab',
} as const;

export const KIND = 'sources@1';
export const CHECK = 'data.sources';
export const PLANTED_LIST = 'sources_leaves_out_uncredited';
export const FIELDS = ['title', 'publisher', 'edition', 'license', 'credit', 'url', 'fetched', 'sha256', 'bytes', 'used_by'] as const;
export type Field = (typeof FIELDS)[number];

export type Line = Record<string, unknown>;
export const isLine = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
export const dig = (v: unknown, ...path: (string | number)[]): unknown => path.reduce<unknown>((x, k) => (Array.isArray(x) ? x[Number(k)] : isLine(x) ? x[String(k)] : undefined), v);
export const lines = (v: unknown): Line[] => (Array.isArray(v) ? v.filter(isLine) : []);
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const show = (v: unknown, most = 900): string => (JSON.stringify(v) ?? 'undefined').slice(0, most);
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const fixture = (name: string): Buffer => readFileSync(join(HERE, 'fixtures', name));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return isLine(v) ? v : undefined; } catch { return undefined; } };
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const first = (text: string): string => text.split('\n')[0] ?? '';
function until(done: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let tick: NodeJS.Immediate;
    // deadline: a wait whose event never comes ends here and reads false, a failure in place of a hang
    const bound = setTimeout(() => { clearImmediate(tick); resolve(false); }, ms);
    const look = (): void => { if (done()) { clearTimeout(bound); resolve(true); } else tick = setImmediate(look); };
    tick = setImmediate(look);
  });
}

export const PROOF = join(tmpdir(), 'deep-3575-proof');
export function proof(name: string, value: unknown): string {
  mkdirSync(PROOF, { recursive: true });
  const path = join(PROOF, name);
  writeFileSync(path, Buffer.isBuffer(value) ? value : typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

const made: string[] = [];
function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3575-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const closers: (() => Promise<void>)[] = [];
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { owned.delete(pid); }
  await until(() => ![...owned].some(alive), 3000);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { owned.delete(pid); }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|GIT_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
export interface Ran { code: number | null; stdout: string; stderr: string }
const said = (r: Ran): string => `${r.stdout}\n${r.stderr}`;
function cli(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    // deadline: a deep command that hangs is killed after ten minutes, a failure in place of a hang
    const timer = setTimeout(() => child.kill('SIGKILL'), 600_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); resolve({ code, stdout, stderr }); });
  });
}

function certs(dir: string): { key: string; cert: string; ca: string } {
  const at = (f: string) => join(dir, f);
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('leaf.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_leaf]\nbasicConstraints = CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:127.0.0.1\n');
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  ssl('req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh3575 test CA', '-config', 'ca.cnf', '-extensions', 'v3_ca');
  ssl('req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1', '-config', 'leaf.cnf');
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.cnf', '-extensions', 'v3_leaf');
  return { key: readFileSync(at('leaf.key'), 'utf8'), cert: readFileSync(at('leaf.pem'), 'utf8'), ca: at('ca.pem') };
}
export interface Files { host: string; ca: string; routes: Map<string, Buffer>; requests: string[]; ended: Map<string, number>; waiters: Set<() => void> }
function sent(files: Files, route: string): Promise<void> {
  return new Promise((resolve) => {
    // deadline: a file whose last byte the hub hasn't asked for in two minutes is polled for as it stands
    const bound = setTimeout(() => { files.waiters.delete(wake); resolve(); }, 120_000);
    const wake = (): void => { if ((files.ended.get(route) ?? 0) > 0) { clearTimeout(bound); files.waiters.delete(wake); resolve(); } };
    files.waiters.add(wake);
    wake();
  });
}
export async function openFiles(): Promise<Files> {
  const dir = tempDir();
  const tls = certs(dir);
  const routes = new Map<string, Buffer>();
  const requests: string[] = [];
  const ended = new Map<string, number>();
  const waiters = new Set<() => void>();
  const server: Server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://files.example.test').pathname;
    requests.push(`${req.method ?? ''} ${path}`);
    req.resume();
    const body = routes.get(path);
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !body) return void res.writeHead(404).end('not found');
    const etag = `"${sha256(body).slice(0, 32)}"`;
    const common = { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes', etag, 'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT' };
    const match = req.headers['if-match'];
    if (match !== undefined && match !== etag && match !== '*') return void res.writeHead(412, common).end();
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers['range'] ?? ''));
    let start = 0;
    let end = body.length - 1;
    let status = 200;
    if (range && (range[1] !== '' || range[2] !== '')) {
      if (range[1] === '') start = Math.max(0, body.length - Number(range[2]));
      else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
      if (start > end || start >= body.length) return void res.writeHead(416, { ...common, 'content-range': `bytes */${body.length}` }).end();
      status = 206;
    }
    const part = body.subarray(start, end + 1);
    if (req.method === 'GET' && end === body.length - 1) res.on('finish', () => { ended.set(path, (ended.get(path) ?? 0) + 1); for (const wake of [...waiters]) wake(); });
    res.writeHead(status, { ...common, 'content-length': part.length, ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}) });
    res.end(req.method === 'HEAD' ? undefined : part);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }));
  return { host: `127.0.0.1:${(server.address() as AddressInfo).port}`, ca: tls.ca, routes, requests, ended, waiters };
}

interface HubProc { pid: number; socket: string; root: string }
async function startHub(home: string, env: Record<string, string>): Promise<HubProc> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    // deadline: a hub that says nothing in five minutes didn't start
    const timer = setTimeout(() => resolve(undefined), 300_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(first(out))); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start (deep hub run): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  return { pid: child.pid!, socket: str(ready.socket) || join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}
function control(w: Pick<World, 'hub'>, method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    // deadline: a socket call the hub never answers fails at this bound
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
async function events(w: Pick<World, 'hub'>): Promise<Line[]> {
  const all: Line[] = [];
  for (let from = 0; ;) {
    const reply = await control(w, 'events.read', { after: from, limit: 1000 });
    if (reply.error) throw Error(`BLOCKED: events.read was refused: ${show(reply.error)}`);
    const page = lines(dig(reply, 'result', 'events'));
    all.push(...page);
    if (page.length < 1000) return all;
    from = Number(page[page.length - 1]!.log_pos);
  }
}
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : isLine(e.data) ? e.data : {});

export interface Outcome { isError: boolean; value: Line; text: string }
class Mcp {
  private replies: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.replies.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = 900_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      // deadline: a call deep mcp never answers fails at this bound
      const timer = setTimeout(() => { this.wakers.delete(look); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const look = () => {
        const at = this.replies.findIndex((l) => parse(l)?.id === id);
        if (at >= 0) { clearTimeout(timer); this.wakers.delete(look); resolve(parse(this.replies.splice(at, 1)[0]!)!); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(look); reject(Error(`deep mcp exited ${this.child.exitCode}`)); }
      };
      this.wakers.add(look);
      look();
    });
  }
  notify(method: string): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); }
}
async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  if (child.pid) owned.add(child.pid);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-3575', version: '0' } }, 300_000);
  if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${show(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}
async function tool(w: Pick<World, 'mcp'>, name: string, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name, arguments: args });
  if (isLine(reply.error)) return { isError: true, value: reply.error, text: JSON.stringify(reply.error) };
  const result = isLine(reply.result) ? reply.result : {};
  const text = str(lines(result.content).find((c) => c.type === 'text')?.text);
  const value = isLine(result.structuredContent) ? result.structuredContent : parse(text) ?? {};
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}

export interface World { tmp: string; home: string; work: string; hub: HubProc; mcp: Mcp; files: Files; evidence: string; importTool: string; deriveTool: string; packs: number }
const built = (bin: string): string => (existsSync(join(DEBUG, bin)) ? '' : `BLOCKED: no ${bin} is built in target/debug (README: Run them); this is not a pass`);
async function toolOf(w: Pick<World, 'mcp'>, kind: string, named: RegExp): Promise<string> {
  let listed: Outcome;
  try { listed = await tool(w, 'deep_job', { op: 'list' }); } catch (e) { return `BLOCKED: deep_job {op: list} gave no reply: ${first(message(e))}; this is not a pass`; }
  const found = lines(listed.value.kinds).find((k) => k.kind === kind);
  const tools = lines(found?.tools).map((t) => str(t.tool)).filter((t) => named.test(t));
  return tools.length === 1 ? tools[0]! : `BLOCKED: deep_job lists ${tools.length} tools of the kind ${kind} matching ${String(named)}, not one: ${listed.text.slice(0, 600)}; this is not a pass`;
}
export async function openWorld(files: Files): Promise<World | string> {
  if (!existsSync(CLI)) return `BLOCKED: ${CLI} is missing; build it with \`npm run build --workspaces\` first; this is not a pass`;
  const lacking = built('deep-hook') || built('deep-show');
  if (lacking) return lacking;
  let started: Pick<World, 'tmp' | 'home' | 'work' | 'hub' | 'mcp'> | undefined;
  let why = '';
  for (let attempt = 0; attempt < 3 && !started; attempt++) {
    try {
      const tmp = tempDir();
      const home = join(tmp, 'h');
      const work = join(tmp, 'work');
      mkdirSync(home);
      mkdirSync(work);
      writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
      const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), NODE_EXTRA_CA_CERTS: files.ca });
      started = { tmp, home, work, hub, mcp: await startMcp(home, work) };
    } catch (e) { why = first(message(e)); }
  }
  if (!started) return `${why.startsWith('BLOCKED:') ? '' : 'BLOCKED: '}${why}; this is not a pass`;
  for (const plugin of ['import', 'asset-tools']) {
    const ran = await cli(['install', join(REPO, 'packages', 'jobs', plugin)], started.home, started.work);
    if (ran.code !== 0) return `BLOCKED: deep install packages/jobs/${plugin} didn't load it: exit ${String(ran.code)}: ${said(ran).trim().slice(-1200)}; this is not a pass`;
  }
  const importTool = await toolOf(started, 'import', /^table[a-z0-9_-]*@\d+\.\d+\.\d+$/);
  if (importTool.startsWith('BLOCKED:')) return importTool;
  const deriveTool = await toolOf(started, 'table.derive', /@\d+\.\d+\.\d+$/);
  if (deriveTool.startsWith('BLOCKED:')) return deriveTool;
  return { ...started, files, evidence: join(started.home, '.deepbuild', 'evidence'), importTool, deriveTool, packs: 0 };
}

export interface License { id: string; terms: string; shareable: boolean; credit: string | null }
export interface Listed { path: string; bytes: Buffer; license: License; title?: string; publisher?: string; edition?: string }
export interface Published extends Listed { url: string; sha256: string; size: number; pack: string }
const TERMS: Record<string, string> = {
  'CC-BY-4.0': 'CC-BY-4.0: reuse is allowed with credit to the publisher.',
  'CC0-1.0': 'CC0-1.0: a public domain dedication.',
};
export async function publish(w: World, listed: Listed[]): Promise<Published[] | string> {
  w.packs += 1;
  const id = `fixture/tables${w.packs}`;
  const version = '1.0.0';
  const dir = join(w.tmp, `pack-${w.packs}`);
  mkdirSync(join(dir, 'terms'), { recursive: true });
  const out: Published[] = listed.map((f) => {
    const route = `/${id}/${f.path}`;
    w.files.routes.set(route, f.bytes);
    return { ...f, url: `https://${w.files.host}${route}`, sha256: sha256(f.bytes), size: f.bytes.length, pack: `${id}@${version}` };
  });
  for (const f of out) writeFileSync(join(dir, 'terms', `${f.license.id}.txt`), TERMS[f.license.id] ?? '');
  const named = (f: Published): Line => Object.fromEntries((['title', 'publisher', 'edition'] as const).filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({
    id, name: id.split('/')[1], version, license: 'CC0-1.0', description: 'Published tables for the sources list acceptance tests.', requires: { core: '>=0.0.0', modules: {} },
    assets: out.map((f) => ({
      path: f.path, url: f.url, sha256: f.sha256, size: f.size, license: { ...f.license, terms: `terms/${f.license.id}.txt` },
      upstream: { url: f.url, version, modified: '2026-01-01T00:00:00Z' }, ...named(f),
    })),
  }, null, 2)}\n`);
  const ran = await cli(['install', dir], w.home, w.work);
  if (ran.code !== 0) return `deep install of a data pack whose assets list title, publisher and edition didn't install it: exit ${String(ran.code)}: ${said(ran).trim().slice(-900)}`;
  return out;
}

export interface AskShown { handle: string; inbox: string; created: Line; plan: Line | null }
export interface Fetched { file: Published; asked: number; landed: number; ask: AskShown | null; record: Line }
async function inboxLines(w: World, handle: string): Promise<string> {
  const ran = await cli(['inbox'], w.home, w.work);
  const all = ran.stdout.split('\n');
  const at = all.findIndex((l) => !l.startsWith(' ') && l.includes(handle));
  if (at < 0) return '';
  const rest = all.slice(at + 1);
  const end = rest.findIndex((l) => !l.startsWith(' '));
  return [all[at]!, ...(end < 0 ? rest : rest.slice(0, end))].join('\n');
}
export async function fetchFile(w: World, file: Published): Promise<Fetched | string> {
  const args = { op: 'fetch', pack: file.pack, asset: file.path };
  const authority = async (): Promise<Line[]> => (await events(w)).filter((e) => e.kind === 'ask.created' && dataOf(e).kind === 'authority');
  const before = (await authority()).length;
  const asked = Date.now();
  let o = await tool(w, 'deep_kinds', args);
  let ask: AskShown | null = null;
  if (o.value.status === 'held') {
    const raised = (await authority()).slice(before);
    if (raised.length !== 1) return `BLOCKED: the fetch of ${file.path} is held, and ${raised.length} authority asks were raised, not one: ${o.text.slice(0, 400)}; this is not a pass`;
    const handle = `ask:${String(raised[0]!.id)}`;
    const created = dataOf(raised[0]!);
    const plan = (await events(w)).filter((e) => e.kind === 'plan.proposed').map(dataOf).find((d) => d.ask === handle) ?? null;
    ask = { handle, inbox: await inboxLines(w, handle), created, plan };
    const option = str(lines(created.options).find((x) => x.decision === 'allow')?.id);
    if (!option) return `BLOCKED: ${handle} has no option that says yes: ${show(created.options)}; this is not a pass`;
    const answered = await cli(['inbox', 'answer', handle, option], w.home, w.work);
    if (answered.code !== 0) return `BLOCKED: your yes to the fetch of ${file.path} wasn't taken: ${said(answered).trim().slice(-400)}; this is not a pass`;
    await sent(w.files, new URL(file.url).pathname);
    const last = Date.now() + 600_000;
    do { o = await tool(w, 'deep_kinds', args); } while (o.value.status === 'held' && Date.now() < last);
  }
  const landed = Date.now();
  const record = o.value.asset;
  if (o.value.status !== 'fetched' || !isLine(record) || record.sha256 !== file.sha256) return `BLOCKED: the hub's fetch of ${file.path} didn't land by its SHA-256: ${o.text.slice(0, 600)}; this is not a pass`;
  return { file, asked, landed, ask, record };
}

export interface Kept { sha256: string; reply: Line }
async function job(w: World, kind: string, toolName: string, params: Line, inputs: Line[] | null, what: string): Promise<Kept | string> {
  let o: Outcome;
  try { o = await tool(w, 'deep_job', { op: 'run', kind, tool: toolName, params: JSON.stringify(params), inputs }); } catch (e) { return `BLOCKED: ${what} gave no reply: ${first(message(e))}; this is not a pass`; }
  const table = str(dig(o.value, 'outputs', 'table', 'sha256'));
  if (o.isError || o.value.status !== 'done' || !table) return `BLOCKED: ${what} isn't done with a table: ${o.text.slice(0, 900)}; this is not a pass`;
  return { sha256: table, reply: o.value };
}
export const importTable = (w: World, input: { sha256: string } | { path: string }, params: Line): Promise<Kept | string> =>
  job(w, 'import', w.importTool, { from: 'table', ...params }, [{ name: 'file', ...input }], `the table import of ${'sha256' in input ? input.sha256 : input.path}`);
export const deriveTable = (w: World, params: Line): Promise<Kept | string> => job(w, 'table.derive', w.deriveTool, params, null, 'the table.derive job');
export function tableRecord(w: World, sha: string): Line | null {
  const path = join(w.evidence, 'tables', `${sha}.json`);
  return existsSync(path) ? parse(readFileSync(path, 'utf8')) ?? null : null;
}

const CREDITED: License = { id: 'CC-BY-4.0', terms: '', shareable: true, credit: 'The county returns of Tarn Vale' };
const UNCREDITED: License = { id: 'CC0-1.0', terms: '', shareable: true, credit: null };
export const METRO = 'Northfold';
export const COLUMN = 'employed';
export const UNIT = 'workers';
export const SHOWN = { first: '250', second: '48226', unlisted: '37', agent: '9120' };
export const LISTED = {
  counties: { path: 'a-counties.csv', bytes: fixture('counties.csv'), license: CREDITED, title: 'County employment', publisher: 'Tarn Vale Census Office', edition: '2019' },
  crosswalk: { path: 'b-crosswalk.csv', bytes: fixture('crosswalk.csv'), license: UNCREDITED, title: 'County to metro area crosswalk', publisher: 'Tarn Vale Mapping Board', edition: '2020' },
  population: { path: 'c-population.csv', bytes: fixture('population.csv'), license: UNCREDITED, title: 'Metro area population', publisher: 'Tarn Vale Residents Register', edition: '2022' },
} satisfies Record<string, Listed>;
export const UNLISTED: Listed = { path: 'd-unlisted.csv', bytes: fixture('unlisted.csv'), license: UNCREDITED };
const i64 = (from: string, unit: string): Line => ({ from, dtype: 'i64', unit });
const text = (from: string): Line => ({ from, dtype: 'str', unit: 'text' });
const IMPORTS = {
  counties: { columns: { county: i64('county', 'id'), manufacturing: i64('manufacturing', UNIT) }, key: 'county' },
  crosswalk: { columns: { link: i64('link', 'id'), county: i64('county', 'id'), metro: text('metro') }, key: 'link' },
  population: { columns: { metro: text('metro'), people: i64('people', 'people') }, key: 'metro' },
};
export const UNLISTED_IMPORT = { columns: { metro: text('metro'), schools: i64('schools', 'schools') }, key: 'metro' };
export const AGENT_IMPORT = { columns: { metro: text('metro'), visitors: i64('visitors', 'people') }, key: 'metro' };

export type Name = keyof typeof LISTED;
export const NAMES: Name[] = ['counties', 'crosswalk', 'population'];
export interface Piece { files: Record<Name, Fetched>; tables: Record<Name, string>; derived: string; unit: string | null }
export async function piece(w: World, editions: Partial<Record<Name, string>> = {}): Promise<Piece | string> {
  const published = await publish(w, NAMES.map((n) => ({ ...LISTED[n], ...(editions[n] ? { edition: editions[n] } : {}) })));
  if (typeof published === 'string') return published;
  const files = {} as Record<Name, Fetched>;
  const tables = {} as Record<Name, string>;
  for (const [i, n] of NAMES.entries()) {
    const fetched = await fetchFile(w, published[i]!);
    if (typeof fetched === 'string') return fetched;
    files[n] = fetched;
    const table = await importTable(w, { sha256: fetched.file.sha256 }, IMPORTS[n]);
    if (typeof table === 'string') return table;
    tables[n] = table.sha256;
  }
  const derived = await deriveTable(w, {
    inputs: { county: tables.counties, metro: tables.crosswalk },
    steps: [
      { join: { with: 'metro', on: ['county'], kind: 'inner', expect: 'many_to_one' } },
      { derive: { jobs: { expr: 'manufacturing', unit: UNIT } } },
      { group: { by: ['metro'], agg: { [COLUMN]: 'sum(jobs)' } } },
    ],
    key: 'metro',
  });
  if (typeof derived === 'string') return derived;
  const column = lines(dig(tableRecord(w, derived.sha256), 'probe', 'table', 'columns')).find((c) => c.name === COLUMN);
  return { files, tables, derived: derived.sha256, unit: typeof column?.unit === 'string' ? column.unit : null };
}

const TYPED: License = { id: 'CC0-1.0', terms: 'Typed in the document.', shareable: true, credit: 'Typed in the document' };
const f32 = (value: number): Line => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value, 0);
  return { dtype: 'f32', len: 1, data: b.toString('base64') };
};
export function label(id: string, table: string, key: string, column: string, y: number, read: Line = {}): Line {
  const from = (c: string, more: Line = {}): Line => ({ from: table, column: c, ...more });
  return {
    id, kind: 'marks@1', name: `Label ${id}`,
    params: {
      mark: 'text', n: 1, key: 'key',
      columns: { key: from(key), x: f32(80), y: { const: y }, text: from(column, read), size: { const: 20 } },
      encode: { x: { column: 'x' }, y: { column: 'y' }, text: { column: 'text' }, size: { column: 'size' } }, paint: { fill: { role: 'ink' } },
    },
  };
}
export const FIRST = (read: Line = {}): Line => label('first', 'derived', 'metro', COLUMN, 60, read);
export const SECOND = (): Line => label('second', 'population', 'metro', 'people', 110);
export const list = (params: Line): Line => ({ id: 'sources', kind: KIND, name: 'Sources', at: { pos: [24, 160, 0] }, params });
export const READING: Line = { id: 'reading', kind: 'text@1', name: 'reading', at: { pos: [24, 20, 0] }, params: { font: 'body', size: 20, text: '' } };
export const BOUND: Line = { 'reading-value': { target: 'items/reading/params/text', source: 'reading:01JB3575R00000000000000002' } };
const words = { title: 'Employment in a metro area', description: 'Labels that show cells of published tables, with the list of the files they come from.' };
export function chart(items: Line[], assets: Record<string, string>, more: Line = {}): Line {
  return {
    format: 1, id: 'chart-sources', profile: 'chart', ...words, size: [640, 360], layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    assets: Object.fromEntries(Object.entries(assets).map(([id, sha]) => [id, { sha256: sha, license: TYPED }])),
    items: Object.fromEntries(items.map((item, i) => [str(item.id), { ...item, layer: 'main', order: `a${i + 1}` }])),
    ...more,
  };
}
export function figure(items: Line[], assets: Record<string, string>): Line {
  const cam: Line = { id: 'cam', kind: 'camera@1', name: 'Camera', params: { projection: 'orthographic', target: [400, 225, 0], view_width: 800, user: { zoom: [0.25, 8], pan: { bounds: 'none' } } } };
  return {
    format: 1, profile: 'figure', ...words, size: [800, 450], camera: 'cam',
    assets: Object.fromEntries(Object.entries(assets).map(([id, sha]) => [id, { sha256: sha, license: TYPED }])),
    items: Object.fromEntries([cam, ...items].map((item, i) => [str(item.id), { ...item, order: `a${i}` }])),
  };
}
export const assetsOf = (p: Piece): Record<string, string> => ({ derived: p.derived, population: p.tables.population });

export interface Checked { ok: boolean; errors: Line[]; numbers: Line[]; raw: Line }
export function check(w: World, doc: Line, planted?: string): Checked | string {
  const lacking = built('deep-canvas-render');
  if (lacking) return lacking;
  const r = spawnSync(join(DEBUG, 'deep-canvas-render'), ['check'], {
    cwd: REPO, env: childEnv(w.home), input: `${JSON.stringify({ doc, look: 'clean', evidence: w.evidence, ...(planted ? { planted } : {}) })}\n`,
    encoding: 'utf8', maxBuffer: 256 << 20, timeout: 600_000, killSignal: 'SIGKILL',
  });
  if (r.error) return `BLOCKED: deep-canvas-render check couldn't run: ${r.error.message}; this is not a pass`;
  const reply = parse(first((r.stdout ?? '').trim()));
  if (!reply) return `deep-canvas-render check answered no JSON: exit ${String(r.status)}, ${(r.stdout ?? '').slice(0, 400)} ${(r.stderr ?? '').slice(-400)}`;
  if (typeof reply.ok !== 'boolean' || !Array.isArray(reply.issues)) return `deep-canvas-render check answered no ok and issues${planted ? ` to the planted ${planted}` : ''}: ${show(reply, 600)}`;
  return { ok: reply.ok, errors: lines(reply.issues).filter((i) => i.severity === 'error'), numbers: lines(reply.numbers), raw: reply };
}
export const errorsOf = (c: Checked): string[] => c.errors.map((e) => `${str(e.check)} ${str(e.code)} ${show(e.ids, 120)} ${str(e.path)}`);
export const failuresOf = (c: Checked): Line[] => c.errors.filter((e) => e.check === CHECK || e.code === CHECK);

export interface Row { group: string | null; fields: Record<string, string> }
export function rowsOf(c: Checked, item = 'sources'): Row[] | string {
  if (!Array.isArray(c.raw.sources)) return `the check's answer holds no sources, the rows each ${KIND} item draws (README: The surface under test); it holds ${Object.keys(c.raw).join(', ')}`;
  const found = lines(c.raw.sources).find((s) => s.item === item);
  if (!found || !Array.isArray(found.rows)) return `the check's sources holds no rows for the item ${item}: ${show(c.raw.sources, 600)}`;
  const rows: Row[] = [];
  for (const [i, row] of lines(found.rows).entries()) {
    if (!isLine(row.fields) || Object.values(row.fields).some((v) => typeof v !== 'string')) return `row ${i + 1} of ${item} holds no fields, each the text it shows: ${show(row, 400)}`;
    if (!('group' in row) || (row.group !== null && typeof row.group !== 'string')) return `row ${i + 1} of ${item} holds no group, the heading it lists under or null: ${show(row, 400)}`;
    rows.push({ group: row.group, fields: row.fields as Record<string, string> });
  }
  return rows;
}
export const isDash = (shown: string | undefined): boolean => shown !== undefined && /^[-\u2010-\u2015\u2212]$/.test(shown);
export function holdsWord(where: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}($|[^0-9A-Za-z])`).test(where);
}
export function fetchedAt(shown: string | null): number {
  if (shown === null) return Number.NaN;
  if (/^\d+(\.\d+)?$/.test(shown)) return Number(shown) < 1e11 ? Number(shown) * 1000 : Number(shown);
  return Date.parse(shown);
}
const scalar = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
export function recorded(f: Fetched): Record<Field, string | null> | string {
  const source = f.record.source;
  if (!isLine(source)) return `the fetched asset's record of ${f.file.path} holds no source {url, fetched, title, publisher, edition}: ${show(f.record, 600)}`;
  const missing = ['url', 'fetched'].filter((k) => scalar(source[k]) === null);
  if (missing.length) return `the fetched asset's record of ${f.file.path} holds no source.${missing.join(' and no source.')}: ${show(source, 400)}`;
  const size = lines(f.record.files).find((x) => x.sha256 === f.file.sha256)?.bytes;
  return {
    title: scalar(source.title), publisher: scalar(source.publisher), edition: scalar(source.edition),
    license: scalar(dig(f.record, 'license', 'id')), credit: scalar(dig(f.record, 'license', 'credit')),
    url: scalar(source.url), fetched: scalar(source.fetched), sha256: scalar(f.record.sha256), bytes: scalar(size), used_by: null,
  };
}
export const tells = (issue: Line, f: Fetched): boolean => {
  const said = JSON.stringify([issue.ids, issue.path, issue.actual, issue.what]);
  return [f.file.sha256, f.file.url, f.file.title ?? f.file.url].some((name) => said.includes(JSON.stringify(name).slice(1, -1)));
};

const RECORD = join(REPO, 'crates/deep-replica/fixtures/plain-words.events.jsonl');
export type Box = [number, number, number, number];
export type Point = [number, number];
const FLICKS = 705_600_000;
export class Replica {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  private t = 0;
  private constructor(private readonly child: ChildProcess, readonly out: string) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const got = parse(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) };
        this.buffer = this.buffer.slice(i + 1);
        this.waiting.shift()?.(got);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  static async launch(evidence: string): Promise<Replica | string> {
    if (process.platform !== 'darwin') return 'INCONCLUSIVE: the replica renders on macOS only; this is not a pass';
    const lacking = built('deep-drive');
    if (lacking) return lacking;
    const dir = tempDir();
    const out = join(dir, 'out');
    const home = join(dir, 'home');
    mkdirSync(out);
    mkdirSync(home);
    mkdirSync(join(out, '1'));
    cpSync(evidence, join(out, '1', 'evidence'), { recursive: true });
    const child = spawn(join(DEBUG, 'deep-drive'), ['--out', out], { cwd: REPO, env: { ...childEnv(home), TMPDIR: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    const r = new Replica(child, out);
    const ready = await r.next(300_000);
    if (ready.ready !== true) return `BLOCKED: deep-drive didn't start: ${show(ready, 300)} ${r.err.slice(-600)}; this is not a pass`;
    const launched = await r.call({ call: 'launch', launch: { from: 'fixture', fixture: RECORD } });
    return typeof launched === 'string' || launched.ok !== true ? `BLOCKED: the replica didn't launch on the fixture record ${RECORD}: ${show(launched, 600)}; this is not a pass` : r;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      // deadline: a call the replica never answers reads timedOut at this bound
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((got) => { clearTimeout(timer); resolve(got); });
    });
  }
  async call(args: Line): Promise<Line | string> {
    const reply = this.next(300_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) return `BLOCKED: deep-drive gave no JSON reply to ${str(args.call)}: ${show(got, 300)} ${this.err.slice(-600)}; this is not a pass`;
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  async must(what: string, args: Line): Promise<Line | string> {
    const reply = await this.call(args);
    if (typeof reply === 'string') return reply;
    return reply.ok === true ? reply : `${what}: the replica answered ${show(reply.error ?? reply, 900)}`;
  }
  async page(session: string): Promise<string> {
    const address = `session/${session}`;
    const opened = await this.must(`opening ${address}`, { call: 'open', open: { address } });
    if (typeof opened === 'string') return opened;
    return opened.address === address ? '' : `BLOCKED: the replica shows ${show(opened.address)} where ${address} was opened: ${str(opened.said)}; this is not a pass`;
  }
  wait(ms: number): Promise<Line | string> {
    return this.must(`waiting ${ms} ms of the replica's clock`, { call: 'wait_for', wait_for: { t: this.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 5000 });
  }
  hid(what: string, act: Line): Promise<Line | string> {
    return this.must(what, { call: 'act', act: { ...act, source: 'hid' } });
  }
  async copied(marker: string): Promise<string | null> {
    for (let i = 0; i < 20; i++) {
      const r = await this.call({ call: 'clipboard' });
      const held = typeof r === 'string' ? null : dig(r, 'clipboard', 'text');
      if (typeof held === 'string' && held !== marker) return held;
      await this.wait(50);
    }
    return null;
  }
  async stop(): Promise<void> {
    this.child.stdin!.end();
    await until(() => this.exited, 5000);
    if (!this.exited && this.child.pid) try { process.kill(this.child.pid, 'SIGKILL'); } catch { this.exited = true; }
  }
}
export function sessionsOfFixture(): string[] {
  const rows = readFileSync(RECORD, 'utf8').trim().split('\n').map((l) => parse(l) ?? {});
  return [...new Set(rows.map((r) => str(r.session_id)).filter(Boolean))];
}
export interface Node { role: string; text: string; bounds: Box }
export function nodes(tree: unknown, out: Node[] = []): Node[] {
  if (!isLine(tree)) return out;
  const own = (n: Line): string => [n.name, n.value].filter((v) => typeof v === 'string').join('\n');
  const all = (n: Line): string => [own(n), ...lines(n.children).map(all)].join('\n');
  const b = Array.isArray(tree.bounds) ? tree.bounds.map(Number) : [];
  out.push({ role: str(tree.role), text: all(tree), bounds: [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0] });
  for (const child of lines(tree.children)) nodes(child, out);
  return out;
}
