// Test-side tools for the #154 acceptance tests (the blind redraft): a world of a real hub (`deep hub run`) in a temp
// home, a `deep mcp` spoken to as an agent's MCP client (deep_kinds' pack fetch, deep_job), the hub's socket as the cli
// role (the record's asks, `pack.rule`, your yes), a local HTTPS server under a test CA the hub trusts that serves the
// sample libraries' takes, and `deep-show run` (built once per file) for `deep show`, `score_plan` and `media_mix`, its
// evidence folder the hub's evidence store, so the takes the hub fetches are what the plan names and the stems the job
// keeps are what the mix plays. Every take is synthesized here at run time, so the truth each judge holds the product
// to (where a note starts, which take sounds, what pitch it has) is known by construction; nothing here renders a note.
//
// Safety: every folder is under /tmp/dh154r-* and removed after its file; the hub, `deep` commands and `deep mcp` run
// with HOME in the world's temp folder and without the caller's DEEP_*, CLAUDE*, CODEX*, NODE_OPTIONS; nothing leaves
// 127.0.0.1; every process is one this file started, stopped by its PID; nothing is stopped by name or port.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
/** The first-party plug-in that renders scores (Score: As built (#154)), its job kind and its one tool. */
const SCORE_PLUGIN = join(REPO, 'packages/jobs/score');
const KIND = 'score.render';
const TOOL = 'score-render@1.0.0';
/** Time: one flick is 1/705,600,000 s; a 48 kHz sample is 14,700 flicks. */
export const FLICKS = 705_600_000;
const RATE = 48_000;
export const SAMPLE = FLICKS / RATE;
/** Every test passes this: a first build of deep-show and a hub's start are long. */
export const TIMEOUT = 3_600_000;

/** Each criterion's ID (scripts/proof-change.mjs `criterionId`: the first 8 hex of SHA-256 of its text), which starts its test's name. */
export const AC = {
  1: 'AC1 #154.c8c95dbc',
  2: 'AC2 #154.8b0e5b99',
  3: 'AC3 #154.6e31be7c',
  5: 'AC5 #154.87a31a62',
  6: 'AC6 #154.74061b19',
  7: 'AC7 #154.54798db1',
  9: 'AC9 #154.d6804da4',
} as const;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };
export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md, the four invariants). */
export function inconclusive(reason: string): never { return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`); }
/** A judge's failures, which must be none. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}: ${failures.slice(0, 8).join(' | ')}`).toEqual([]);
}

// ---- Temp folders and processes, all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh154r-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const closers: (() => Promise<void>)[] = [];
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const c of closers.splice(0)) await c().catch(() => undefined);
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 60_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
interface Ran { code: number | null; stdout: string; stderr: string }
const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function deep(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 900_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); resolve({ code, stdout, stderr }); });
  });
}

// ---- deep-show, built once per file (`cargo build --locked --bin deep-show`, honoring CARGO_TARGET_DIR) and copied out.
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-154r-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0', ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env.PATH ?? ''}` } : {}) };
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo build --locked --bin deep-show failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', 'deep-show'), join(dir, 'deep-show'));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    expect(error, 'deep-show builds: cargo build --locked --bin deep-show').toBe('');
    return join(dir, 'deep-show');
  };
}

// ---- TLS: a test CA and a leaf for 127.0.0.1, made per world with openssl; the hub trusts the CA through NODE_EXTRA_CA_CERTS.
interface Tls { key: string; cert: string; ca: string }
function certs(dir: string): Tls {
  mkdirSync(dir, { recursive: true });
  const at = (f: string) => join(dir, f);
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('leaf.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_leaf]\nbasicConstraints = CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:127.0.0.1\n');
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  ssl('req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh154r test CA', '-config', 'ca.cnf', '-extensions', 'v3_ca');
  ssl('req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1', '-config', 'leaf.cnf');
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.cnf', '-extensions', 'v3_leaf');
  return { key: readFileSync(at('leaf.key'), 'utf8'), cert: readFileSync(at('leaf.pem'), 'utf8'), ca: at('ca.pem') };
}

// ---- The take server: each library's takes over HTTPS on 127.0.0.1, with a log of every request; offline = closed.
interface Req { method: string; path: string }
interface TakeServer { host: string; log: Req[]; route(path: string, body: Buffer): void; close(): Promise<void>; since(from: number): Req[] }
async function openTakeServer(tls: Tls): Promise<TakeServer> {
  const log: Req[] = [];
  const routes = new Map<string, Buffer>();
  const server: Server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://x.invalid').pathname;
    log.push({ method: req.method ?? '', path });
    req.resume();
    const body = routes.get(path);
    if (req.method !== 'GET' || !body) return void res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': body.length, 'accept-ranges': 'bytes' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`, log,
    route: (path, body) => { routes.set(path, body); },
    since: (from) => log.slice(from),
    close: () => (closed ? Promise.resolve() : new Promise<void>((resolve) => { closed = true; server.close(() => resolve()); server.closeAllConnections(); })),
  };
}

// ---- The hub.
interface Hub { pid: number; socket: string; root: string }
async function startHub(home: string, env: Record<string, string>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  expect(ready?.ready, `the hub starts (deep hub run; deep-hook must be built): ${out.slice(0, 500)} ${err.slice(-1500)}`).toBe(true);
  return { pid: child.pid!, socket: typeof ready!.socket === 'string' ? ready!.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild') };
}
/** One call on the hub's socket as the cli role, with the control token and this process for the peer check: the reply line. */
async function control(w: World, method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
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
/** The hub's record, through events.read on the cli role. */
async function events(w: World): Promise<Line[]> {
  const all: Line[] = [];
  for (let after = 0; ;) {
    const reply = await control(w, 'events.read', { after, limit: 1000 });
    expect(reply.error, `events.read answers: ${show(reply.error)}`).toBeUndefined();
    const page = reply.result.events as Line[];
    all.push(...page);
    if (page.length < 1000) return all;
    after = page[page.length - 1]!.log_pos;
  }
}
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {});
interface Ask { handle: string; kind: string; text: string; data: Line }
/** Every ask raised in the record, oldest first. */
export async function asks(w: World): Promise<Ask[]> {
  return (await events(w)).filter((e) => e.kind === 'ask.created').map((e) => ({ handle: `ask:${String(e.id)}`, kind: String(dataOf(e).kind), text: JSON.stringify(dataOf(e)), data: dataOf(e) }));
}
/** Your yes to an ask, on the trusted path: `deep inbox answer <ask> <the option whose decision is allow>`. */
export async function yes(w: World, ask: Ask): Promise<Ran> {
  const option = (ask.data.options as Line[] | undefined)?.find((o) => o.decision === 'allow')?.id;
  if (typeof option !== 'string') return { code: null, stdout: '', stderr: `${ask.handle} has no option whose decision is allow: ${show(ask.data.options)}` };
  return deep(['inbox', 'answer', ask.handle, option], w.home, w.project);
}

// ---- deep mcp, as an agent's MCP client talks to it (deep_kinds and deep_job bind no session).
export interface Outcome { isError: boolean; value: Line; text: string }
class Mcp {
  private readonly replies = new Map<number, Line>();
  private readonly wakers = new Set<() => void>();
  private n = 0;
  constructor(readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line && typeof line.id === 'number') this.replies.set(line.id, line);
      }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = 1_800_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wakers.delete(check); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const found = this.replies.get(id);
        if (found) { clearTimeout(timer); this.wakers.delete(check); this.replies.delete(id); resolve(found); }
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
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-154r', version: '0' } });
  expect(init.result, `deep mcp answers initialize: ${show(init)}`).toBeDefined();
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
const deepKinds = (w: World, args: Line): Promise<Outcome> => tool(w, 'deep_kinds', args);
const deepJob = (w: World, args: Line): Promise<Outcome> => tool(w, 'deep_job', args);

// ---- The world.
export interface World {
  tmp: string; home: string; project: string; hub: Hub; mcp: Mcp; takes: TakeServer;
  /** The hub's evidence store, which `deep-show run` reads and keeps by hash too. */
  evidence: string;
}
export async function openWorld(): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const project = join(tmp, 'proj');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  mkdirSync(project);
  const tls = certs(join(tmp, 'tls'));
  const takes = await openTakeServer(tls);
  closers.push(() => takes.close());
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), NODE_EXTRA_CA_CERTS: tls.ca });
  const mcp = await startMcp(home, project);
  return { tmp, home, project, hub, mcp, takes, evidence: join(home, '.deepbuild', 'evidence') };
}
/** deepbuild/score installed from packages/jobs/score as you install any package (Score: As built (#154)). */
export async function installScore(w: World): Promise<void> {
  expect(existsSync(join(SCORE_PLUGIN, 'deepbuild.json')), 'the first-party plug-in deepbuild/score is at packages/jobs/score (Score: As built (#154)): there is no packages/jobs/score/deepbuild.json').toBe(true);
  const ran = await deep(['install', SCORE_PLUGIN], w.home, w.project);
  expect(ran.code, `deep install packages/jobs/score installs deepbuild/score: ${shown(ran)}`).toBe(0);
}

// ---- Sound written here: takes as 16-bit mono WAV at 48 kHz, read back as numbers.
interface Overtone { ratio: number; amp: number }
/** A tone in cosine phase, so its first sample is its loudest: `partials` over `hz`, an optional decay (s), a 2 ms fade at its end. */
export function tone(hz: number, seconds: number, partials: Overtone[] = [{ ratio: 1, amp: 1 }], opts: { amp?: number; decay?: number } = {}): Float64Array {
  const n = Math.round(seconds * RATE);
  const x = new Float64Array(n);
  const sum = partials.reduce((a, p) => a + Math.abs(p.amp), 0);
  const fade = Math.round(0.002 * RATE);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (const p of partials) v += p.amp * Math.cos(2 * Math.PI * hz * p.ratio * t);
    const env = (opts.decay ? Math.exp(-t / opts.decay) : 1) * Math.min(1, (n - 1 - i) / fade);
    x[i] = ((opts.amp ?? 0.5) * v * env) / sum;
  }
  return x;
}
function wav16(x: Float64Array): Buffer {
  const data = x.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i]!)) * 32767), 44 + i * 2);
  return b;
}
/** A float or 16-bit PCM WAV's samples per channel (media_mix writes float WAVs). */
function readWav(bytes: Buffer, what: string): { rate: number; channels: Float32Array[] } {
  expect(bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', `${what} is a RIFF WAVE file`).toBe(true);
  let fmt: { tag: number; nch: number; rate: number; bits: number } | null = null; let data: Buffer | null = null;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', o, o + 4); const size = bytes.readUInt32LE(o + 4); const body = bytes.subarray(o + 8, Math.min(bytes.length, o + 8 + size));
    if (id === 'fmt ') { let tag = body.readUInt16LE(0); if (tag === 0xfffe && body.length >= 26) tag = body.readUInt16LE(24); fmt = { tag, nch: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) }; } else if (id === 'data') data = body;
    o += 8 + size + (size % 2);
  }
  expect(fmt !== null && data !== null, `${what} has fmt and data chunks`).toBe(true);
  const { tag, nch, rate, bits } = fmt!;
  expect((tag === 3 && bits === 32) || (tag === 1 && bits === 16), `${what} is float 32-bit or PCM 16-bit, got format ${tag} at ${bits} bits`).toBe(true);
  const width = bits / 8; const frames = Math.floor(data!.length / (width * nch));
  const channels = Array.from({ length: nch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < nch; c++) { const o = (i * nch + c) * width; channels[c]![i] = tag === 3 ? data!.readFloatLE(o) : data!.readInt16LE(o) / 32768; }
  return { rate, channels };
}

// ---- FLAC, read here (metadata and frames; fixed, LPC, verbatim and constant subframes; every stereo decorrelation),
// so the stem's samples, its format and its Vorbis comments are this suite's reading, not the product's decoder's.
export interface Flac { rate: number; channels: number; bits: number; total: number; comments: Record<string, string>; samples: Int32Array[] }
class Bits {
  private pos: number;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array, start: number) { this.b = b; this.pos = start * 8; }
  get byte(): number { return this.pos >> 3; }
  align(): void { this.pos = (this.pos + 7) & ~7; }
  read(n: number): number {
    let v = 0;
    while (n > 0) {
      const used = this.pos & 7;
      const take = Math.min(n, 8 - used);
      const byte = this.b[this.pos >> 3];
      if (byte === undefined) throw Error('FLAC: read past the end of the stream');
      v = v * (1 << take) + ((byte >> (8 - used - take)) & ((1 << take) - 1));
      this.pos += take;
      n -= take;
    }
    return v;
  }
  signed(n: number): number {
    if (n === 0) return 0;
    const v = this.read(n);
    return v >= 2 ** (n - 1) ? v - 2 ** n : v;
  }
  unary(): number {
    let n = 0;
    for (;;) {
      const used = this.pos & 7;
      const byte = this.b[this.pos >> 3];
      if (byte === undefined) throw Error('FLAC: read past the end of the stream');
      const rest = (byte << used) & 0xff;
      if (rest === 0) { n += 8 - used; this.pos += 8 - used; continue; }
      const z = Math.clz32(rest) - 24;
      n += z; this.pos += z + 1;
      return n;
    }
  }
  rice(k: number): number {
    const u = this.unary() * 2 ** k + (k ? this.read(k) : 0);
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }
}
function residual(r: Bits, n: number, order: number, s: number[]): void {
  const method = r.read(2);
  if (method > 1) throw Error(`FLAC: reserved residual coding ${method}`);
  const pbits = method === 0 ? 4 : 5;
  const escape = method === 0 ? 15 : 31;
  const porder = r.read(4);
  for (let p = 0; p < 2 ** porder; p++) {
    const count = (n >> porder) - (p === 0 ? order : 0);
    const k = r.read(pbits);
    if (k === escape) { const raw = r.read(5); for (let i = 0; i < count; i++) s.push(r.signed(raw)); }
    else for (let i = 0; i < count; i++) s.push(r.rice(k));
  }
}
const FIXED = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]];
function subframe(r: Bits, n: number, depth: number): number[] {
  r.read(1);
  const type = r.read(6);
  const wasted = r.read(1) ? r.unary() + 1 : 0;
  const bps = depth - wasted;
  let s: number[];
  if (type === 0) { s = new Array<number>(n).fill(r.signed(bps)); }
  else if (type === 1) { s = []; for (let i = 0; i < n; i++) s.push(r.signed(bps)); }
  else if (type >= 8 && type <= 12) {
    const order = type - 8;
    s = []; for (let i = 0; i < order; i++) s.push(r.signed(bps));
    residual(r, n, order, s);
    const c = FIXED[order]!;
    for (let i = order; i < n; i++) { let p = 0; for (let j = 0; j < order; j++) p += c[j]! * s[i - 1 - j]!; s[i] = s[i]! + p; }
  } else if (type >= 32) {
    const order = type - 31;
    s = []; for (let i = 0; i < order; i++) s.push(r.signed(bps));
    const precision = r.read(4) + 1;
    const shift = r.signed(5);
    const q: number[] = []; for (let i = 0; i < order; i++) q.push(r.signed(precision));
    residual(r, n, order, s);
    const div = 2 ** shift;
    for (let i = order; i < n; i++) { let p = 0; for (let j = 0; j < order; j++) p += q[j]! * s[i - 1 - j]!; s[i] = s[i]! + Math.floor(p / div); }
  } else throw Error(`FLAC: reserved subframe type ${type}`);
  if (wasted) for (let i = 0; i < n; i++) s[i] = s[i]! * 2 ** wasted;
  return s;
}
const BLOCK = [0, 192, 576, 1152, 2304, 4608, -8, -16, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];
const DEPTH = [0, 8, 12, 0, 16, 20, 24, 32];
function readFlac(bytes: Uint8Array): Flac {
  const td = new TextDecoder();
  if (td.decode(bytes.subarray(0, 4)) !== 'fLaC') throw Error('not a FLAC stream: it doesn\'t start with fLaC');
  let o = 4;
  let rate = 0, channels = 0, bits = 0, total = 0;
  const comments: Record<string, string> = {};
  for (let last = false; !last;) {
    const head = bytes[o]!;
    last = (head & 0x80) !== 0;
    const len = (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!;
    const body = bytes.subarray(o + 4, o + 4 + len);
    if ((head & 0x7f) === 0) {
      const r = new Bits(body, 0);
      r.read(16); r.read(16); r.read(24); r.read(24);
      rate = r.read(20); channels = r.read(3) + 1; bits = r.read(5) + 1; total = r.read(36);
    } else if ((head & 0x7f) === 4) {
      const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
      let p = 4 + dv.getUint32(0, true);
      const count = dv.getUint32(p, true); p += 4;
      for (let i = 0; i < count; i++) {
        const l = dv.getUint32(p, true); p += 4;
        const text = td.decode(body.subarray(p, p + l)); p += l;
        const eq = text.indexOf('=');
        if (eq > 0) comments[text.slice(0, eq).toUpperCase()] = text.slice(eq + 1);
      }
    }
    o += 4 + len;
  }
  const out = Array.from({ length: channels }, () => new Int32Array(total));
  for (let at = 0; o < bytes.length && at < total;) {
    const r = new Bits(bytes, o);
    if (r.read(14) !== 0x3ffe) throw Error(`FLAC: no frame sync at byte ${o}`);
    r.read(2);
    const bsCode = r.read(4); const srCode = r.read(4); const chCode = r.read(4); const ssCode = r.read(3); r.read(1);
    let lead = r.read(8);
    let ones = 0;
    while (lead & 0x80) { ones++; lead = (lead << 1) & 0xff; }
    for (let i = 1; i < ones; i++) r.read(8);
    let block = BLOCK[bsCode]!;
    if (block === -8) block = r.read(8) + 1; else if (block === -16) block = r.read(16) + 1;
    if (srCode === 12) r.read(8); else if (srCode === 13 || srCode === 14) r.read(16);
    r.read(8);
    const depth = ssCode === 0 ? bits : DEPTH[ssCode]!;
    const nch = chCode < 8 ? chCode + 1 : 2;
    const d: number[][] = [];
    for (let c = 0; c < nch; c++) d.push(subframe(r, block, depth + (((chCode === 8 || chCode === 10) && c === 1) || (chCode === 9 && c === 0) ? 1 : 0)));
    if (chCode === 8) for (let i = 0; i < block; i++) d[1]![i] = d[0]![i]! - d[1]![i]!;
    else if (chCode === 9) for (let i = 0; i < block; i++) d[0]![i] = d[0]![i]! + d[1]![i]!;
    else if (chCode === 10) for (let i = 0; i < block; i++) { const side = d[1]![i]!; const mid = d[0]![i]! * 2 + (side & 1); d[0]![i] = (mid + side) >> 1; d[1]![i] = (mid - side) >> 1; }
    r.align();
    r.read(16);
    for (let c = 0; c < nch; c++) out[c]!.set(d[c]!.slice(0, Math.min(block, total - at)), at);
    at += block;
    o = r.byte;
  }
  return { rate, channels, bits, total, comments, samples: out };
}

// ---- The evidence store (#15's layout: `<2 hex>/<62 hex>`, each file named by its bytes' SHA-256).
export function stored(w: { evidence: string }, sha: string, what: string): Buffer {
  const path = join(w.evidence, sha.slice(0, 2), sha.slice(2));
  expect(existsSync(path), `${what}: the evidence store holds ${sha}`).toBe(true);
  const bytes = readFileSync(path);
  expect(sha256(bytes), `${what}: the stored file hashes to its name`).toBe(sha);
  return bytes;
}
export const holds = (w: { evidence: string }, sha: string): boolean => existsSync(join(w.evidence, sha.slice(0, 2), sha.slice(2)));
/** Every file in the evidence store, by name. */
export function storeFiles(evidence: string): string[] {
  if (!existsSync(evidence)) return [];
  return readdirSync(evidence).filter((d) => /^[0-9a-f]{2}$/.test(d)).flatMap((d) => readdirSync(join(evidence, d)).map((f) => d + f));
}

// ---- Sample libraries: a pack folder with `assets` (each take by url, sha256, size, license, upstream) and `samples`
// (Score: Fields), its takes served by the world's take server.
interface Lic { id: string; terms: string; shareable: boolean; credit: string | null }
const CC0: Lic = { id: 'CC0-1.0', terms: 'https://creativecommons.org/publicdomain/zero/1.0/', shareable: true, credit: null };
export interface Library {
  /** owner/name */
  id: string; version: string; preset: string; sustained: boolean;
  /** The measured root the manifest states, in MIDI (fractional allowed). */
  root: number; lo: number; hi: number;
  takes: { path: string; samples: Float64Array; bytes: Buffer }[];
  license: Lic;
}
export const ref = (lib: Library): string => `${lib.id}@${lib.version}`;
export function library(id: string, preset: string, root: number, takes: Float64Array[], opts: { sustained?: boolean; lo?: number; hi?: number; license?: Lic } = {}): Library {
  return {
    id, version: '1.0.0', preset, sustained: opts.sustained ?? false, root, lo: opts.lo ?? 0, hi: opts.hi ?? 127, license: opts.license ?? CC0,
    takes: takes.map((samples, k) => ({ path: `${preset}/take${k + 1}.wav`, samples, bytes: wav16(samples) })),
  };
}
const takeUrl = (host: string, lib: Library, path: string) => `https://${host}/${lib.id}/${path}`;
/** Writes the library's pack folder (pack.json only: its takes are listed by url) and serves its takes; returns the folder. */
export function writeLibrary(dir: string, host: string, lib: Library, serve?: TakeServer): string {
  mkdirSync(dir, { recursive: true });
  const [, name] = lib.id.split('/');
  writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({
    id: lib.id, name, version: lib.version, license: lib.license.id, description: `Takes for the score acceptance tests (${lib.preset}).`,
    requires: { core: '^1', modules: { media: '^1' } },
    assets: lib.takes.map((t) => ({ path: t.path, url: takeUrl(host, lib, t.path), sha256: sha256(t.bytes), size: t.bytes.length, license: lib.license, upstream: { url: takeUrl(host, lib, t.path), version: lib.version, modified: '2026-01-01T00:00:00Z' } })),
    samples: { [lib.preset]: { sustained: lib.sustained, zones: [{ lo: lib.lo, hi: lib.hi, root: lib.root, takes: lib.takes.map((t) => t.path) }] } },
  }, null, 2)}\n`);
  if (serve) for (const t of lib.takes) serve.route(`/${lib.id}/${t.path}`, t.bytes);
  return dir;
}
/** The library's pack folder in the world, written, served and installed with `deep install <folder>`, as #1820's packs are. */
export async function installLibrary(w: World, lib: Library): Promise<string> {
  const dir = writeLibrary(join(w.tmp, 'packs', lib.id.replace('/', '__')), w.takes.host, lib, w.takes);
  const ran = await deep(['install', dir], w.home, w.project);
  expect(ran.code, `deep install of the library ${ref(lib)} (a pack with assets and samples) exits 0: ${shown(ran)}`).toBe(0);
  return dir;
}
const fetchArgs = (lib: Library, path: string): Line => ({ op: 'fetch', pack: ref(lib), asset: path });
export const fetchTake = (w: World, lib: Library, path: string): Promise<Outcome> => deepKinds(w, fetchArgs(lib, path));
/** Your standing rule for the library's pack and license (`pack.rule` on the cli socket, #1820), then each take fetched. */
async function fetchLibrary(w: World, lib: Library): Promise<void> {
  const rule = await control(w, 'pack.rule', { pack: lib.id, licenses: [lib.license.id] });
  expect(rule.error, `pack.rule ${lib.id} ${lib.license.id}: ${show(rule)}`).toBeUndefined();
  for (const t of lib.takes) {
    let o = await fetchTake(w, lib, t.path);
    for (let i = 0; i < 240 && o.value.status !== 'fetched' && !o.isError && (o.value.status === 'held' || o.value.status === 'pending'); i++) { await sleep(500); o = await fetchTake(w, lib, t.path); }
    expect(o.value.status, `the hub fetches ${ref(lib)} ${t.path} under your standing rule: ${o.text.slice(0, 800)}`).toBe('fetched');
    expect(holds(w, sha256(t.bytes)), `${ref(lib)} ${t.path} is in the evidence store by its listed sha256`).toBe(true);
  }
}

// ---- Score documents (Document envelope; Score: Fields; Tempo map and cue alignment).
interface Segment { at: string; bpm: number; span: number; to_bpm?: number }
/** A tempo map in 4/4, each segment `{at, bpm, meter, span, ramp}` as #491's suite spells it. */
const tempoMap = (segments: Segment[]): Line => ({
  segments: segments.map((s) => ({ at: s.at, bpm: s.bpm, meter: [4, 4], span: s.span, ramp: s.to_bpm === undefined ? 'none' : { to_bpm: s.to_bpm, shape: 'linear_in_beats' } })),
});
/** Flicks at beat `x` (from 0) of a 4/4 tempo map whose first segment starts at 0 s: exact for a constant segment, the closed form in f64 for a ramp. */
export function beatFlicks(segments: Segment[], x: number): number {
  let t = 0;
  let start = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const last = i === segments.length - 1;
    const into = last ? x - start : Math.min(x - start, s.span);
    if (s.to_bpm === undefined) t += (60 * into * FLICKS) / s.bpm;
    else t += ((60 * s.span) / (s.to_bpm - s.bpm)) * Math.log(1 + ((s.to_bpm - s.bpm) * into) / (s.span * s.bpm)) * FLICKS;
    if (last || x - start <= s.span) break;
    start += s.span;
  }
  return Math.round(t);
}
/** `"bar:beat"` (from 1, fractional beats allowed) as a beat index from 0, in 4/4. */
export const beatOf = (bar: number, beat: number): number => (bar - 1) * 4 + (beat - 1);

export interface Instrument { source: Line; stem: string; bass?: boolean }
export const sampled = (lib: Library, stem: string, bass?: boolean): Instrument => ({ source: { sampled: { library: ref(lib), preset: lib.preset } }, stem, ...(bass === undefined ? {} : { bass }) });
export const pluck = (preset: 'nylon' | 'steel' | 'harp', stem: string, overrides: Line = { damping: 0.4, brightness: 0.6 }): Instrument => ({ source: { pluck: { preset, overrides } }, stem });
export const synth = (preset: 'sine' | 'triangle' | 'saw' | 'square' | 'pad', stem: string, bass?: boolean): Instrument => ({ source: { synth: { preset } }, stem, ...(bass === undefined ? {} : { bass }) });
export interface Event { at: string | number; inst: string; pitch: string | number; dur: string | number; vel?: number; pan?: number; gain?: number; attack?: number; release?: number }

const LAYER = 'main';
/** A film holding one score item (`score.music@1`, its fields as params as `media.strip@1` holds a strip's) and the film's tempo map. */
export function scoreDoc(opts: {
  id: string; item?: string; instruments: Record<string, Instrument>; events: Record<string, Event>; loop?: { from: string; to: string };
  tempo?: Segment[]; markers?: Line; span: string; packs?: Library[];
}): Line {
  const item = opts.item ?? 'score';
  return {
    format: 1, id: opts.id, profile: 'film', title: `Score ${opts.id}`, description: `A score for the #154 acceptance tests (${opts.id}).`, size: [320, 180],
    layers: { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    transport: { frame_rate: [24, 1], span: opts.span, sample_rate: RATE },
    ...(opts.tempo ? { tempo_map: tempoMap(opts.tempo) } : {}),
    ...(opts.markers ? { markers: opts.markers } : {}),
    ...(opts.packs?.length ? { packs: [...new Set(opts.packs.map(ref))] } : {}),
    items: {
      [item]: { id: item, kind: 'score.music@1', layer: LAYER, name: 'Score', order: 'a0', params: { instruments: opts.instruments, events: opts.events, ...(opts.loop ? { loop: opts.loop } : {}) } },
    },
  };
}

// ---- deep-show run: `deep show` from your shell, `score_plan`, `media_mix` (README: The surface under test).
const ulid = (k: number): string => `01JB154R${String(k).padStart(18, '0')}`;
const DOC = ulid(1);
export const docHandle = ulid;
const YOU_PEER: Line = { pid: 3002, start: 3_000 };
const PROCESSES: Line[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
/** A scenario: the evidence store, your shell's process tree, one panel per document, the packs offered (#306), the calls. */
export function scenario(evidence: string, docs: string[], calls: Line[], packs: { id: string; dir: string }[] = []): Line {
  const panels: Line = {};
  const docsOut: Line = {};
  docs.forEach((d, i) => { panels[`p${i}`] = { rect: [0, 0, 640, 360] }; docsOut[d] = { panel: `p${i}` }; });
  return { evidence, sessions: {}, processes: PROCESSES, panels, docs: docsOut, ...(packs.length ? { packs } : {}), calls };
}
/** `deep show` of a whole document from your shell; the hub stamps the writer layer, so the payload has none. */
export function present(doc: string, document: Line): Line {
  const payload = JSON.parse(JSON.stringify(document)) as Line;
  delete payload.layers;
  for (const item of Object.values((payload.items ?? {}) as Line)) if (item && typeof item === 'object') delete (item as Line).layer;
  return { call: 'deep show', peer: YOU_PEER, doc, document: payload, include: ['issues'] };
}
const planCall = (doc: string, item = 'score'): Line => ({ call: 'score_plan', doc, item });
/** One `deep-show run` scenario: one reply per call, or the run fails, naming what it answered. */
export function runShow(bin: string, sc: Line, what: string): Line[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = stdout.split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one answer line`).toBe(1);
  const answer = parse(out[0]!) ?? {};
  expect(answer.ok, `${what}: deep-show run answers the scenario ok (README: The surface under test); got ${show(answer, 800)}`).toBe(true);
  expect(Array.isArray(answer.replies) && answer.replies.length === sc.calls.length, `${what}: one reply per call: ${show(answer, 800)}`).toBe(true);
  return answer.replies as Line[];
}
interface Issue { code: string; severity: string; raw: Line }
export const issuesOf = (reply: Line): Issue[] => ((reply.issues ?? []) as Line[]).map((o) => ({ code: String(o.code), severity: String(o.severity), raw: o }));
/** Presented, with no error issue and no item skipped as a kind the build doesn't know. */
export function presented(reply: Line, what: string): void {
  const errors = issuesOf(reply).filter((i) => i.severity === 'error');
  expect(errors.map((e) => show(e.raw, 400)), `${what}: no error issue`).toEqual([]);
  const skipped = ((reply.notices ?? []) as Line[]).filter((n) => n?.code === 'unknown_kind');
  expect(skipped.map((n) => show(n, 300)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply.outcome, `${what}: presented, got ${show(reply)}`).toBe('presented');
}

// ---- The plan (Score: As built (#154)): `stems: {name → {kind, tool, params, inputs}}`, `note_on: [{t, sample, event, stem}]`.
interface PlannedStem { kind: string; tool: string; params: Line; inputs: { name: string; sha256: string }[] }
interface NoteOn { t: number; sample: number; event: string; stem: string }
export interface Plan { stems: Record<string, PlannedStem>; note_on: NoteOn[]; raw: Line }
/** The plan's fields, from the reply or its `plan` field *(chosen)*. */
const planBody = (reply: Line): Line => (reply.plan && typeof reply.plan === 'object' ? reply.plan : reply) as Line;
export const isBlocked = (reply: Line): boolean => /\bBLOCKED\b/.test(JSON.stringify(reply));
export function planOf(reply: Line, what: string): Plan {
  expect(isBlocked(reply), `${what}: the plan isn't BLOCKED: ${show(reply)}`).toBe(false);
  const body = planBody(reply);
  expect(body.stems !== null && typeof body.stems === 'object' && !Array.isArray(body.stems), `${what}: the plan answers stems {name → job}: ${show(reply)}`).toBe(true);
  expect(Array.isArray(body.note_on), `${what}: the plan answers note_on [{t, sample, event, stem}]: ${show(reply)}`).toBe(true);
  for (const [name, s] of Object.entries(body.stems as Line)) {
    expect({ kind: s?.kind, tool: s?.tool }, `${what}: stem ${name} is a ${KIND} job on ${TOOL}`).toEqual({ kind: KIND, tool: TOOL });
    expect(s.params !== null && typeof s.params === 'object' && Array.isArray(s.inputs), `${what}: stem ${name} has params and inputs: ${show(s)}`).toBe(true);
  }
  return { stems: body.stems as Record<string, PlannedStem>, note_on: body.note_on as NoteOn[], raw: reply };
}
/** A document checked and planned in one scenario: the plan's reply (the `deep show` reply must be presented). */
export function planReply(bin: string, evidence: string, document: Line, libs: { lib: Library; dir: string }[], what: string, item = 'score'): Line {
  const [shownReply, planned] = runShow(bin, scenario(evidence, [DOC], [present(DOC, document), planCall(DOC, item)], libs.map(({ lib, dir }) => ({ id: lib.id, dir }))), what);
  presented(shownReply!, `${what}: deep show`);
  return planned!;
}
export const plan = (bin: string, evidence: string, document: Line, libs: { lib: Library; dir: string }[], what: string, item = 'score'): Plan =>
  planOf(planReply(bin, evidence, document, libs, what, item), what);

// ---- deep_job on score.render.
export interface Rendered { outcome: Outcome; stem: string; meta: string; key: string; cache: string; ms: number }
/** One deep_job run of a planned stem. A reply held on an ask gets your yes and the call is made again, at most 5 times. */
export async function runStem(w: World, s: PlannedStem): Promise<{ outcome: Outcome; ms: number }> {
  const args = { op: 'run', kind: s.kind, tool: s.tool, params: JSON.stringify(s.params), inputs: s.inputs };
  const t0 = performance.now();
  for (let i = 0; ; i++) {
    const o = await deepJob(w, args);
    if (o.value.status !== 'held' || typeof o.value.ask !== 'string' || i >= 5) return { outcome: o, ms: performance.now() - t0 };
    const ask = (await asks(w)).find((a) => a.handle === o.value.ask);
    if (!ask) return { outcome: o, ms: performance.now() - t0 };
    await yes(w, ask);
  }
}
/** A done render of a stem: its two outputs by hash (`stem`, `meta`) and its receipt's key and cache. */
export function doneOf(o: Outcome, ms: number, what: string): Rendered {
  const stem = o.value.outputs?.stem?.sha256;
  const meta = o.value.outputs?.meta?.sha256;
  expect(!o.isError && o.value.status === 'done' && /^[0-9a-f]{64}$/.test(String(stem)) && /^[0-9a-f]{64}$/.test(String(meta)), `${what}: deep_job runs ${KIND} on ${TOOL}, done with outputs stem and meta by hash: ${o.text.slice(0, 1500)}`).toBe(true);
  return { outcome: o, stem, meta, key: String(o.value.receipt?.key), cache: String(o.value.receipt?.cache), ms };
}
export async function render(w: World, s: PlannedStem, what: string): Promise<Rendered> {
  const { outcome, ms } = await runStem(w, s);
  return doneOf(outcome, ms, what);
}
export async function renderAll(w: World, p: Plan, what: string): Promise<Record<string, Rendered>> {
  const out: Record<string, Rendered> = {};
  for (const [name, s] of Object.entries(p.stems)) out[name] = await render(w, s, `${what}: stem ${name}`);
  return out;
}
/** A stem from the store, read as FLAC: 48 kHz, stereo, 24-bit (Score: As built). */
export function readStem(w: { evidence: string }, sha: string, what: string): Flac {
  const f = readFlac(new Uint8Array(stored(w, sha, what)));
  expect({ rate: f.rate, channels: f.channels, bits: f.bits }, `${what}: the stem is a 48 kHz stereo 24-bit FLAC`).toEqual({ rate: RATE, channels: 2, bits: 24 });
  return f;
}
export function readMeta(w: { evidence: string }, sha: string, what: string): Line {
  const v = parse(stored(w, sha, what).toString('utf8'));
  expect(v, `${what}: the meta output is a JSON object`).toBeDefined();
  return v!;
}
interface MetaNote { event: string; sample: number; pitch: number; take: unknown }
export function metaNotes(meta: Line, what: string): MetaNote[] {
  expect(Array.isArray(meta.note_on), `${what}: meta.note_on is a list of {event, sample, pitch, take}: ${show(meta)}`).toBe(true);
  return meta.note_on as MetaNote[];
}

// ---- Readings of a stem (24-bit integers per channel; sample k sits at k × 14,700 flicks from the score's start).
/** The first sample in [from, to) of either channel that isn't zero, or -1. */
export function firstSound(f: Flac, from: number, to: number): number {
  const [l, r] = [f.samples[0]!, f.samples[1]!];
  for (let i = Math.max(0, from); i < Math.min(to, f.total); i++) if (l[i] !== 0 || r[i] !== 0) return i;
  return -1;
}
/** The first sample in [from, to) where two stems differ, or -1. */
export function firstDiff(a: Flac, b: Flac, from: number, to: number): number {
  for (let i = Math.max(0, from); i < to; i++) for (let c = 0; c < 2; c++) if ((a.samples[c]![i] ?? 0) !== (b.samples[c]![i] ?? 0)) return i;
  return -1;
}
/**
 * Which take sounds from `atSample`: the best normalized correlation of the stem's left channel with each take, over
 * `w` samples from `off` samples in (past any attack ramp), so gain, velocity and pan don't count.
 */
export function whichTake(f: Flac, atSample: number, takes: Float64Array[], w = 512, off = 256): { take: number; score: number; next: number } {
  const seg = Array.from({ length: w }, (_, i) => f.samples[0]![atSample + off + i] ?? 0);
  const norm = (v: ArrayLike<number>) => Math.sqrt(Array.from({ length: w }, (_, i) => (v[i] ?? 0) ** 2).reduce((a, b) => a + b, 0)) || 1;
  const ns = norm(seg);
  const scores = takes.map((t) => { const part = t.subarray(off, off + w); let d = 0; for (let i = 0; i < w; i++) d += seg[i]! * (part[i] ?? 0); return d / (ns * norm(part)); });
  const order = scores.map((s, k) => [s, k] as const).sort((a, b) => b[0] - a[0]);
  return { take: order[0]![1], score: order[0]![0], next: order[1]?.[0] ?? 0 };
}

// ---- media_mix (#499's call): a media document's sound, as the export renders it, its segments written as float WAVs.
export function mix(bin: string, evidence: string, media: Line, segments: { from: number; to: number }[], what: string): Float32Array[][] {
  const [reply] = runShow(bin, { evidence, calls: [{ call: 'media_mix', doc: media, segments: segments.map((s) => ({ ...s, write: true })) }] }, what);
  const m = reply?.mix as Line | undefined;
  expect(m && Array.isArray(m.segments) && m.segments.length === segments.length, `${what}: media_mix answers its segments: ${show(reply)}`).toBe(true);
  return (m!.segments as Line[]).map((s, i) => {
    expect(typeof s.wav === 'string', `${what}: segment ${i} was written: ${show(s)}`).toBe(true);
    return readWav(stored({ evidence }, s.wav as string, `${what}: segment ${i}`), `${what}: segment ${i}`).channels;
  });
}

// ---- Shared fixtures and setup.
/** MIDI note to Hz (A4 = 69 = 440 Hz). */
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
/** Four takes of one note, each with its own overtone (the 2nd to 5th), so the stem shows which take sounds; 0.3 s long. */
const fourTakes = (midi: number): Float64Array[] => [2, 3, 4, 5].map((h) => tone(hz(midi), 0.3, [{ ratio: 1, amp: 1 }, { ratio: h, amp: 0.7 }]));
/** The keys library: four takes of A4, its measured root 69. */
export const KEYS_FIXTURE = (): Library => library('testlib/keys', 'keys', 69, fourTakes(69));
/** The bells library: four takes of E5, its measured root 76. */
export const BELLS_FIXTURE = (): Library => library('testlib/bells', 'bells', 76, fourTakes(76));
/** A setup run once per file and shared by its tests: each test that awaits it fails the same way when it fails. */
export function once<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}
/** A world with deepbuild/score installed and each library installed and, unless `fetch` is false, fetched under your standing rule. */
export async function scoreWorld(libs: Library[], fetch = true): Promise<{ w: World; dirs: { lib: Library; dir: string }[] }> {
  const w = await openWorld();
  await installScore(w);
  const dirs: { lib: Library; dir: string }[] = [];
  for (const lib of libs) dirs.push({ lib, dir: await installLibrary(w, lib) });
  if (fetch) for (const lib of libs) await fetchLibrary(w, lib);
  return { w, dirs };
}
/** Integer flicks for a time in seconds. */
export const fl = (seconds: number): number => Math.round(seconds * FLICKS);
