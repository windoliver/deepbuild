import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const NODE = process.execPath;

export const MODERN = '2026-07-28';
export const FUTURE = '2099-01-01';
export const META = {
  version: 'io.modelcontextprotocol/protocolVersion',
  client: 'io.modelcontextprotocol/clientInfo',
  capabilities: 'io.modelcontextprotocol/clientCapabilities',
  serverInfo: 'io.modelcontextprotocol/serverInfo',
} as const;
export const TTL_MS = 0;
export const CACHE_SCOPE = 'private';
export const HELD: readonly string[] = (() => {
  try {
    const schema = JSON.parse(readFileSync(join(root, 'packages/contracts/schemas/mcp.handshake@1.json'), 'utf8')) as { properties: { protocolVersion: { enum: string[] } } };
    return schema.properties.protocolVersion.enum;
  } catch { return []; }
})();
export const NEWEST = HELD[HELD.length - 1] ?? '2025-11-25';
export const SUPPORTED = [MODERN, ...HELD];

export type Obj = Record<string, unknown>;
export type Line = { [key: string]: any };
export interface Tool { name: string; inputSchema?: unknown; [key: string]: unknown }
export const pollStep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)); // deadline: one step of a poll, which its caller bounds by a limit
export const tag = (n = 4) => randomBytes(n).toString('hex');
export const parseObject = (raw: string): Line | undefined => {
  try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
const shortJson = (v: unknown, n = 300): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);

const made: string[] = [];
const owned = new Set<number>();
export function tempDir(): string { const d = realpathSync(mkdtempSync('/tmp/dh2855-')); made.push(d); return d; }
export const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
const closers: (() => void)[] = [];
export async function cleanup(): Promise<void> {
  for (const close of closers.splice(0)) try { close(); } catch {}
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch {}
  const end = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < end) await pollStep(50);
  for (const pid of owned) try { process.kill(pid, 'SIGKILL'); } catch {}
  owned.clear();
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

const DROP = /^(DEEP_|CLAUDE|XDG_|OPENAI_|CODEX_|ANTHROPIC_|GH_|GITHUB_|GIT_)/;
export function childEnv(home: string, extra: Record<string, string | undefined> = {}, bin?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!DROP.test(k) && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), LC_ALL: 'C', PATH: `${bin ? `${bin}:` : ''}${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin` });
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
  return env;
}

const CLI = join(root, 'packages/cli/dist/main.js');
const READING = join(root, 'packages/reading/dist/tools.mjs');
const BUILD_NODE = 'npm run build --workspaces';
const BUILD_HOOK = 'node scripts/throttle.mjs build -- cargo build -p deep-hook';

export function deepHook(): string | undefined {
  const built = ['target/debug/deep-hook', 'target/release/deep-hook'].map((p) => join(root, p)).filter((p) => existsSync(p));
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}
export function needHook(): string {
  const hook = deepHook();
  if (!hook) throw Error(`BLOCKED: deep-hook isn't built: ${BUILD_HOOK}`);
  return hook;
}
export function needCli(): string {
  if (!existsSync(CLI)) throw Error(`BLOCKED: deep isn't built: ${BUILD_NODE}`);
  return CLI;
}

export interface Server {
  label: string;
  argv: (home: string) => string[] | undefined;
  build: string;
  reaches: 'hub' | 'reading job';
}
export const readingSocket = (home: string): string => join(home, 'r.sock');
export const hubSocket = (home: string): string => join(home, 'h.sock');

export const SERVERS: readonly Server[] = [
  { label: 'deep mcp', argv: () => (existsSync(CLI) ? [NODE, CLI, 'mcp'] : undefined), build: BUILD_NODE, reaches: 'hub' },
  { label: 'deep mcp actions', argv: () => (existsSync(CLI) ? [NODE, CLI, 'mcp', 'actions'] : undefined), build: BUILD_NODE, reaches: 'hub' },
  { label: "deep-hook's mcp actions", argv: () => { const hook = deepHook(); return hook ? [hook, 'mcp', 'actions'] : undefined; }, build: BUILD_HOOK, reaches: 'hub' },
  { label: 'the reading tools', argv: (home) => (existsSync(READING) ? [NODE, READING, readingSocket(home)] : undefined), build: BUILD_NODE, reaches: 'reading job' },
];

export function serverHome(): string {
  const home = tempDir();
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  writeFileSync(join(home, '.deepbuild', 'config.json'), `${JSON.stringify({ hub: { address: `unix:${hubSocket(home)}` } })}\n`);
  return home;
}

export class Mcp {
  private readonly replies = new Map<string, Obj>();
  private readonly wakers = new Set<() => void>();
  private err = '';
  private ids = 0;
  private constructor(readonly child: ChildProcess, readonly label: string) {
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const message = parseObject(raw);
      if (message && message.id !== undefined) this.replies.set(JSON.stringify(message.id), message);
      for (const wake of [...this.wakers]) wake();
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
  }
  static start(server: Server, home: string): Mcp {
    const argv = server.argv(home);
    if (!argv) throw Error(`BLOCKED: ${server.label} isn't built: ${server.build}`);
    const child = spawn(argv[0]!, argv.slice(1), { cwd: home, env: childEnv(home), stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Mcp(child, server.label);
  }
  notify(method: string, params: Obj = {}): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
  async request(method: string, params: Obj = {}, timeoutMs = 60_000): Promise<Obj> {
    const id = ++this.ids;
    const key = JSON.stringify(id);
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    const due = Date.now() + timeoutMs;
    while (!this.replies.has(key)) {
      if (Date.now() > due || this.child.exitCode !== null) throw Error(`BLOCKED: ${this.label} gave no reply to ${method} in ${timeoutMs} ms (exit ${this.child.exitCode}); stderr: ${this.err}`);
      await new Promise<void>((resolve) => {
        const done = (): void => { clearTimeout(timer); this.wakers.delete(done); resolve(); };
        const timer = setTimeout(done, 200); // deadline: a reply wakes the wait at once; this only rechecks the due time and the server's exit
        this.wakers.add(done);
      });
    }
    return this.replies.get(key)!;
  }
  stop(): void {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin!.end();
  }
}

export const meta = (version = MODERN, name = 'acceptance-2855'): Obj => ({ [META.version]: version, [META.client]: { name, version: '0' }, [META.capabilities]: {} });
export const modern = (params: Obj = {}, version = MODERN, name?: string): Obj => ({ ...params, _meta: meta(version, name) });

export async function handshakeSession(server: Server, home: string): Promise<{ mcp: Mcp; init: Obj }> {
  const mcp = Mcp.start(server, home);
  const init = await mcp.request('initialize', { protocolVersion: NEWEST, capabilities: {}, clientInfo: { name: 'acceptance-2855', version: '0' } });
  mcp.notify('notifications/initialized');
  return { mcp, init };
}
export const resultOf = (reply: Obj | undefined): Obj | undefined => (reply?.result && typeof reply.result === 'object' ? reply.result as Obj : undefined);
export const errorOf = (reply: Obj | undefined): { code?: unknown; message?: unknown; data?: unknown } | undefined => (reply?.error && typeof reply.error === 'object' ? reply.error as Obj : undefined);
export const toolsOf = (reply: Obj | undefined): Tool[] | undefined => { const t = resultOf(reply)?.tools; return Array.isArray(t) ? t as Tool[] : undefined; };
export const answered = (reply: Obj | undefined): string => {
  const error = errorOf(reply);
  return error ? `error ${String(error.code)} (${shortJson(error.message, 160)})` : `result ${shortJson(resultOf(reply))}`;
};
export const MISSING_PAGE = 'deep://codes/no_such_code_2855';

export interface Counter { calls: () => number; lines: () => string[] }
export async function countCalls(server: Server, home: string): Promise<Counter> {
  const seen: string[] = [];
  let calls = 0;
  const path = server.reaches === 'hub' ? hubSocket(home) : readingSocket(home);
  let srv: net.Server;
  if (server.reaches === 'hub') {
    srv = net.createServer((sock) => {
      sock.setEncoding('utf8');
      sock.on('error', () => undefined);
      sock.write(`${JSON.stringify({ v: 1, hub: 'acceptance-2855 counting listener' })}\n`);
      let buffer = '';
      sock.on('data', (chunk: string) => {
        buffer += chunk;
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const raw = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          const line = parseObject(raw);
          if (!line) continue;
          seen.push(raw.slice(0, 400));
          if ('hello' in line) sock.write(`${JSON.stringify({ v: 1, role: 'mcp' })}\n`);
          else if (line.method === 'mcp.call') { calls++; sock.write(`${JSON.stringify({ v: 1, id: line.id, result: { counted: calls } })}\n`); }
          else if (line.id !== undefined) sock.write(`${JSON.stringify({ v: 1, id: line.id, error: { code: 'unavailable', message: 'a counting listener' } })}\n`);
        }
      });
    });
  } else {
    srv = createHttpServer((req, res) => {
      let body = '';
      req.setEncoding('utf8').on('data', (d: string) => (body += d)).on('end', () => {
        seen.push(`${req.method} ${req.url} ${body.slice(0, 300)}`);
        if (req.url === '/call') calls++;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ counted: calls }));
      });
    }) as unknown as net.Server;
  }
  await new Promise<void>((resolve, reject) => { srv.once('error', reject); srv.listen(path, () => resolve()); });
  closers.push(() => srv.close());
  return { calls: () => calls, lines: () => [...seen] };
}

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const AGENT = join(FIXTURES, 'agent.mjs');
export const FAKE = join(FIXTURES, 'fake-server.mjs');
const CODEX_STAND_IN = join(root, 'tests/acceptance/39/fixtures/fake-codex.pl');
const DEFAULT_RULES = join(root, 'crates/deep-hook/default-rules.json');
const ASKS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
const covered = (file: string): string => { const v = (JSON.parse(readFileSync(join(root, 'adapters', file), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; };
export const CLAUDE_COVERED = covered('claude-code.facts.json');
export const CODEX_COVERED = covered('codex.facts.json');

export interface World { tmp: string; home: string; bin: string; root: string; repo: string; confirm: string; codexHome: string; configToml: string }
export function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const rootDir = join(home, '.deepbuild');
  const codexHome = join(home, '.codex');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  mkdirSync(bin);
  writeFileSync(join(rootDir, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(rootDir, 'config.json'), `${JSON.stringify({ asks: ASKS }, null, 2)}\n`);
  for (const n of ['launchctl', 'systemctl', 'claude']) { writeFileSync(join(bin, n), '#!/bin/sh\nexit 0\n'); chmodSync(join(bin, n), 0o755); }
  copyFileSync(CODEX_STAND_IN, join(bin, 'codex'));
  chmodSync(join(bin, 'codex'), 0o755);
  writeFileSync(join(bin, 'fake-codex.json'), JSON.stringify({ version: CODEX_COVERED, loginExit: 0, log: join(tmp, 'codex-calls.log') }));
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: repo, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin:/usr/local/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'src', 'cart.ts'), 'export const total = 0;\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  return { tmp, home, bin, root: rootDir, repo: realpathSync(repo), confirm, codexHome, configToml: join(codexHome, 'config.toml') };
}
export const worldEnv = (w: World, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, SHELL: '/bin/sh', ...extra }, w.bin);

export interface Ran { code: number | null; stdout: string; stderr: string; ms: number }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? root, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 120_000); // deadline: a command that hangs is killed and shown
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${e.message}`, ms: performance.now() - t0 }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(-600))}, stderr ${JSON.stringify(r.stderr.slice(-600))}`;

export interface Hub { pid: number; socket: string; root: string }
export async function startHub(w: World): Promise<Hub> {
  const cli = needCli();
  const child = spawn(NODE, [cli, 'hub', 'run'], { cwd: root, env: worldEnv(w), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000); // deadline: a hub that never prints its ready line is BLOCKED
    let first = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; first += d; if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)); } });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket ?? join(w.root, 'hub.sock')), root: w.root };
}
export async function setup(w: World): Promise<void> {
  const r = await run(NODE, [needCli(), 'setup'], { env: worldEnv(w), cwd: w.tmp, timeoutMs: 180_000 });
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0: ${shown(r)}`);
}

export function control(hub: Hub, method: string, params: Line = {}, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs); // deadline: a silent hub is BLOCKED
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) { clearTimeout(timer); sock.destroy(); if (line.error) reject(Error(`BLOCKED: ${method} refused: ${JSON.stringify(line.error)}`)); else resolve(line.result as Line); }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = ((await control(hub, 'events.read', { after, limit: 1000 })).events ?? []) as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
export const lastPos = async (hub: Hub): Promise<number> => (await allEvents(hub)).at(-1)?.log_pos ?? 0;
export async function within<T>(ms: number, probe: () => Promise<T | undefined | false>): Promise<T | undefined> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) return undefined;
    await pollStep(250);
  }
}

export class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (l: Line) => void>();
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const l = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (l && typeof l.n === 'number') { const done = this.pending.get(l.n); this.pending.delete(l.n); done?.(l); }
      }
    });
  }
  static start(w: World, cwd: string): Agent {
    const child = spawn(NODE, [AGENT], { cwd, env: worldEnv(w), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  private send(cmd: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      this.pending.set(n, (l) => (l.failed ? reject(Error(`BLOCKED: the agent stand-in failed: ${String(l.failed)}`)) : resolve(l)));
      this.child.stdin!.write(`${JSON.stringify({ n, ...cmd })}\n`);
    });
  }
  async hook(agent: 'claude-code' | 'codex', payload: Line, cwd: string, timeoutMs = 90_000): Promise<Ran & { ended: number }> {
    const l = await this.send({ op: 'hook', binary: needHook(), args: [agent, payload.hook_event_name], payload, cwd, timeoutMs });
    return { code: l.code as number | null, stdout: String(l.stdout), stderr: String(l.stderr), ms: Number(l.ms), ended: Number(l.ended) };
  }
  async mcp(line: Line, timeoutMs = 150_000): Promise<{ reply: Line | null; ms: number }> {
    const l = await this.send({ op: 'mcp', argv: [NODE, needCli(), 'mcp'], line: { jsonrpc: '2.0', ...line }, timeoutMs });
    own(Number(l.pid));
    return { reply: (l.reply ?? null) as Line | null, ms: Number(l.ms) };
  }
}
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}

export interface Thread { id: string; cwd: string; transcript: string; turn: string }
export function codexThread(w: World): Thread {
  const id = randomUUID();
  const cwd = join(w.tmp, `w${tag(3)}`);
  mkdirSync(cwd, { recursive: true });
  const transcript = join(w.codexHome, 'sessions', `rollout-${id}.jsonl`);
  writeFileSync(transcript, `${JSON.stringify({ type: 'session_meta', payload: { id, cwd, cli_version: CODEX_COVERED, originator: 'codex_cli_rs' } })}\n`);
  return { id, cwd, transcript, turn: randomUUID() };
}
export function codexPayload(t: Thread, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: t.id, transcript_path: t.transcript, cwd: t.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default' };
  if (event === 'SessionStart') base.source = 'startup'; else if (event !== 'SessionEnd') base.turn_id = t.turn;
  return { ...base, ...extra };
}

export interface Session { id: string; cwd: string; transcript: string; prompt?: string; agent: Agent }
export function claudeSession(w: World): Session {
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd: w.repo, transcript, agent: Agent.start(w, w.tmp) };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: CLAUDE_COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
export function claudePayload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
export async function sessionStart(s: Session): Promise<void> {
  const r = await s.agent.hook('claude-code', claudePayload(s, 'SessionStart'), s.cwd);
  if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
}
export async function typed(s: Session, text: string): Promise<void> {
  s.prompt = randomUUID();
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  const r = await s.agent.hook('claude-code', claudePayload(s, 'UserPromptSubmit', { prompt: text }), s.cwd);
  if (r.code !== 0) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
}
export function preToolUse(s: Session, server: string, tool: string): { started: number; done: Promise<Ran>; result?: Ran } {
  const id = `toolu_${tag(10)}`;
  const call = { tool_name: `mcp__${server}__${tool}`, tool_input: { owner: 'acme', repo: 'shop' } };
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: call.tool_name, input: call.tool_input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
  const p: { started: number; done: Promise<Ran>; result?: Ran } = { started: Date.now(), done: Promise.resolve(undefined as unknown as Ran) };
  p.done = s.agent.hook('claude-code', claudePayload(s, 'PreToolUse', { ...call, tool_use_id: id }), s.cwd, 120_000).then((r) => { p.result = r; return r; });
  return p;
}

export type Mode = 'modern' | 'minus32601' | 'silent';
const SCHEMA = { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } }, required: ['owner', 'repo'] };
export const tool = (name: string, annotations?: Line): Tool => ({ name, description: `${name.replace(/_/g, ' ')} on a repository`, inputSchema: SCHEMA, ...(annotations ? { annotations } : {}) });
export const V1 = [tool('list_issues', { readOnlyHint: true }), tool('create_issue')];
export function digestOf(schema: unknown): string {
  const text = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(text).join(',')}]`;
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${text((v as Obj)[k])}`).join(',')}}`;
  };
  return createHash('sha256').update(text(schema ?? null)).digest('hex');
}
export class FakeServer {
  private constructor(readonly w: World, readonly name: string, readonly mode: Mode, readonly toolsFile: string, readonly log: string, public tools: Tool[]) {}
  static install(w: World, name: string, mode: Mode, tools: Tool[] = V1): FakeServer {
    const dir = join(w.tmp, `mcp-${name}`);
    mkdirSync(dir, { recursive: true });
    const server = new FakeServer(w, name, mode, join(dir, 'tools.json'), join(dir, 'requests.jsonl'), tools);
    writeFileSync(server.toolsFile, `${JSON.stringify({ version: '1.0.0', tools }, null, 2)}\n`);
    writeFileSync(server.log, '');
    const file = join(w.home, '.claude.json');
    const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
    config.mcpServers = { ...(config.mcpServers ?? {}), [name]: { type: 'stdio', command: NODE, args: [FAKE, mode, name, server.toolsFile, server.log], env: {} } };
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    return server;
  }
  update(tools: Tool[], version: string): void {
    this.tools = tools;
    writeFileSync(this.toolsFile, `${JSON.stringify({ version, tools }, null, 2)}\n`);
  }
  requests(): Line[] { return jsonLines(readFileSync(this.log, 'utf8')); }
  calls(toolName: string): number { return this.requests().filter((r) => r.method === 'tools/call' && r.tool === toolName).length; }
  byProcess(): Line[][] {
    const groups = new Map<number, Line[]>();
    for (const r of this.requests()) { const g = groups.get(Number(r.pid)) ?? []; g.push(r); groups.set(Number(r.pid), g); }
    return [...groups.values()];
  }
  runCall(toolName: string): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const child = spawn(NODE, [FAKE, this.mode, this.name, this.toolsFile, this.log], { env: childEnv(this.w.home), stdio: ['pipe', 'pipe', 'ignore'] });
      own(child.pid);
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(undefined); }, 30_000); // deadline: a fake server that never answers the call reads as no answer
      createInterface({ input: child.stdout }).on('line', (raw) => { const l = parseObject(raw); if (l?.id === 3) { clearTimeout(timer); child.stdin.end(); resolve(l); } });
      child.stdin.on('error', () => undefined);
      const send = (m: Line) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
      if (this.mode === 'modern') send({ id: 3, method: 'tools/call', params: modern({ name: toolName, arguments: { owner: 'acme', repo: 'shop' } }, MODERN, 'claude-code') });
      else {
        send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: CLAUDE_COVERED } } });
        send({ method: 'notifications/initialized' });
        send({ id: 3, method: 'tools/call', params: { name: toolName, arguments: { owner: 'acme', repo: 'shop' } } });
      }
    });
  }
}

export const listedOf = (events: readonly Ev[], server: string): Ev[] => events.filter((e) => e.kind === 'mcp.tools_listed' && e.data?.server === server);
export function listFailures(who: string, listed: Ev | undefined, tools: readonly Tool[]): string[] {
  if (!listed) return [`${who}: the record holds no mcp.tools_listed for it, so the lister read no list`];
  const got = Array.isArray(listed.data.tools) ? (listed.data.tools as Line[]).map((t) => ({ name: t.name, digest: t.digest })) : [];
  const want = tools.map((t) => ({ name: t.name, digest: digestOf(t.inputSchema) }));
  return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${who}: mcp.tools_listed holds ${shortJson(got, 600)}, not its tools with their digests ${shortJson(want, 600)}`];
}
export function saysNoHandshake(listed: Ev): boolean {
  const { tools: _tools, server: _server, ...rest } = listed.data;
  let says = false;
  const walk = (v: unknown, key: string): void => {
    if (typeof v === 'string' && (v === MODERN || /\b(no|without( a)?) handshake\b|\bhandshake.?less\b/i.test(v))) says = true;
    else if (v === false && /handshake/i.test(key)) says = true;
    else if (v && typeof v === 'object') for (const [k, sub] of Object.entries(v as Obj)) walk(sub, k);
  };
  walk(rest, '');
  return says;
}

export interface BudgetTask { id: string; command?: unknown; margin?: unknown; limits?: Record<string, unknown> }
export const budgets = (): { tasks: BudgetTask[] } => JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8')) as { tasks: BudgetTask[] };
