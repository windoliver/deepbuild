// Test-side tools for the #159 acceptance tests: temp folders and a temp HOME with a fake sign-in, the fake
// `claude` installs (fixtures/fake-claude.pl), what a fake reported in its output, git repos, the process table as
// `ps` shows it, the hub as a process with a small client for its line protocol and a deep-hook stand-in, and the
// reference-Mac timing judge (as tests/acceptance/236/helpers.ts has it). Nothing here stands in for the runner,
// the supervisor or the sandbox: library tests reach them through `@deepbuild/runner` (world.ts), hub tests
// through `deep hub run --root` and its socket (README, The surface under test).
//
// Safety: every process the tests start is stopped by PID only, never by name or port; every folder is under
// /tmp/dh159-*; HOME is a temp folder for this process and every child; the agent's own CLAUDE*, DEEP_* and
// ANTHROPIC_* variables are removed first; no `claude` here is real, no test signs in, calls a model or touches
// the real ~/.deepbuild, ~/.claude or the keychain. The sign-in files are fakes holding made-up values.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const MINUTE = 60_000;
export const DAY = 86_400_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('ANTHROPIC_')) delete process.env[key];
}

/** The four variables that mark a nested Claude Code session (Scope), as a Claude Code terminal sets them. */
export const NESTING: Readonly<Record<string, string>> = {
  CLAUDECODE: '1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_SESSION: '5c0ffee0-0000-4000-8000-000000000001',
  CLAUDE_CODE_PARENT_SESSION: '5c0ffee0-0000-4000-8000-000000000002',
};
/** The account Claude Code keeps beside the fake login (`oauthAccount.accountUuid` in ~/.claude.json). */
export const ACCOUNT = '0a0a0a0a-1111-4222-8333-444444444444';
/** A made-up OAuth token in the fake sign-in: a search for it must find nothing in a job's folder. */
export const TOKEN = `sk-ant-oat01-dh159FAKE${'x'.repeat(40)}`;
export const REFRESH = `sk-ant-ort01-dh159FAKE${'y'.repeat(40)}`;

// ---- HOME: a temp folder for this process and every child, with a fake Claude Code sign-in.
let HOME: string | undefined;
export interface SignIn { home: string; claudeJson: string; credentials: string; settings: string }
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh159-home-'));
    process.env.HOME = HOME;
    signIn();
  }
  return HOME;
}
/** (Re)writes the fake sign-in under HOME: ~/.claude.json, ~/.claude/.credentials.json and empty user settings. */
export function signIn(o: { mcpServers?: Record<string, unknown> } = {}): SignIn {
  const h = HOME ?? home();
  mkdirSync(join(h, '.claude'), { recursive: true });
  const claudeJson = join(h, '.claude.json');
  const credentials = join(h, '.claude', '.credentials.json');
  const settings = join(h, '.claude', 'settings.json');
  writeFileSync(claudeJson, `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh159@example.invalid', organizationUuid: 'org-dh159' }, mcpServers: o.mcpServers ?? {}, projects: {} }, null, 2)}\n`);
  writeFileSync(credentials, `${JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, refreshToken: REFRESH, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
  if (!existsSync(settings)) writeFileSync(settings, '{}\n');
  return { home: h, claudeJson, credentials, settings };
}
afterAll(() => {
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

// ---- IDs and hook stamps.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export function ulid(ms = Date.now()): string {
  return base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
}
export const uuid = (): string => {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
let lastSeq = 0n;
/** deep-hook's stamp: the wall clock in ns when the hook started, as a decimal string, never repeating here. */
export function seqNow(): string {
  let s = BigInt(Date.now()) * 1_000_000n;
  if (s <= lastSeq) s = lastSeq + 1n;
  lastSeq = s;
  return s.toString();
}

// ---- Temp folders: short real paths (a Unix socket path fits in 104 bytes; Seatbelt matches real paths).
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dh159-'));
  made.push(dir);
  return dir;
}
export function sub(dir: string, ...names: string[]): string {
  const path = join(dir, ...names);
  mkdirSync(path, { recursive: true });
  return path;
}

// ---- Processes. Stopped by PID only, and only ones this suite started or that run a program under /tmp/dh159-.
const owned = new Set<number>();
export function own(pid: number | undefined): void {
  if (pid) owned.add(pid);
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
export interface Proc { pid: number; pgid: number; args: string }
/** Every process whose command line names `needle` (`ps -A -ww`, LC_ALL=C). */
export function processesNaming(needle: string): Proc[] {
  const out = execFileSync('ps', ['-A', '-ww', '-o', 'pid=,pgid=,args='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  return out.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), pgid: Number(m[2]), args: m[3]! })).filter((p) => p.args.includes(needle) && p.pid !== process.pid);
}
/** The PIDs of the processes in group `pgid`. */
export function processesInGroup(pgid: number): number[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,pgid='], { encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim().split(/\s+/).map(Number)).filter((x) => x.length === 2 && x[1] === pgid).map((x) => x[0]!);
}
/** The headless runs (`-p`) of the fake at `bin`, as `ps` shows them now. */
export const launches = (bin: string): Proc[] => processesNaming(bin)
  .filter((p) => !p.args.startsWith('/usr/bin/sandbox-exec') && !/ --version| auth status/.test(p.args) && / (-p|--print)( |$)/.test(p.args));
/**
 * Stops what this suite started (SIGTERM, then SIGKILL), by PID: the processes it spawned, and those running a
 * program from a folder this test process made (the fakes its jobs launched), found by that folder's unique path.
 */
export async function cleanup(): Promise<void> {
  const pids = new Set(owned);
  const mine = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim());
  const groups = new Set<number>();
  for (const dir of made) {
    for (const p of processesNaming(dir)) {
      pids.add(p.pid);
      // Its group, when it has one of its own (a job's helpers, such as a /bin/sleep it forked, name no folder).
      if (p.pgid === p.pid && p.pgid !== mine) groups.add(p.pgid);
    }
  }
  for (const g of groups) for (const p of processesInGroup(g)) pids.add(p);
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...pids].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The fake `claude` (fixtures/fake-claude.pl), installed as a file named `claude` in a folder of its own.
export interface FakeOptions {
  version?: string;      // what `claude --version` prints; default 2.1.304, the newest the facts cover
  slowVersion?: number;  // seconds `--version` keeps running after it printed
  evil?: boolean;        // the swapped-in binary: prints EVIL RAN instead of doing its work
  startup?: number;      // seconds a headless run waits before it reads its prompt
}
export function install(dir: string, o: FakeOptions = {}): string {
  mkdirSync(dir, { recursive: true });
  const text = readFileSync(join(FIXTURES, 'fake-claude.pl'), 'utf8')
    .replace("'__VERSION__'", JSON.stringify(o.version ?? '2.1.304').replace(/"/g, "'"))
    .replace('__SLOW__', String(o.slowVersion ?? 0))
    .replace('__EVIL__', o.evil ? '1' : '0')
    .replace('__STARTUP__', String(o.startup ?? 0));
  const path = join(dir, 'claude');
  writeFileSync(`${path}.new`, text, { mode: 0o755 });
  chmodSync(`${path}.new`, 0o755);
  // An atomic swap: the path names either the old bytes or the new ones, never a half-written file.
  execFileSync('/bin/mv', ['-f', `${path}.new`, path]);
  return path;
}
/** The covered range, as adapters/claude-code.facts.json names it. */
export function coveredVersions(): string[] {
  return (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions;
}

// ---- What a fake printed (the job's stdout, as the runner read it).
export function streamOf(stdout: string): Line[] {
  return stdout.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) as Line; } catch { return { unparsed: l }; } });
}
/** The fake's own reports, `fake:<JSON>` assistant texts, in order. */
export function reportsOf(stdout: string): Line[] {
  const out: Line[] = [];
  for (const e of streamOf(stdout)) {
    if (e.type !== 'assistant') continue;
    for (const c of (e.message?.content ?? []) as Line[]) {
      if (c.type === 'text' && typeof c.text === 'string' && c.text.startsWith('fake:')) out.push(JSON.parse(c.text.slice(5)) as Line);
    }
  }
  return out;
}
export function reported(stdout: string, cmd: string): Line {
  const r = reportsOf(stdout).find((x) => x.cmd === cmd);
  if (!r) throw Error(`the fake never reported ${cmd}: its output was ${stdout.slice(0, 3000) || '(empty)'}`);
  return r;
}
/** The prompt the fake read on its stdin. */
export const stdinOf = (stdout: string): string => Buffer.from(String(reported(stdout, 'start').stdin), 'base64').toString('utf8');
export const initOf = (stdout: string): Line | undefined => streamOf(stdout).find((e) => e.type === 'system' && e.subtype === 'init');

// ---- git, with no system or user config.
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', args, {
    cwd, encoding: 'utf8', maxBuffer: 64 << 20,
    env: { PATH: '/usr/bin:/bin', HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'dh159', GIT_AUTHOR_EMAIL: 'dh159@example.invalid',
      GIT_COMMITTER_NAME: 'dh159', GIT_COMMITTER_EMAIL: 'dh159@example.invalid', GIT_AUTHOR_DATE: '2026-10-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-01T00:00:00Z' },
  });
}
export interface Repo { dir: string; base: string; history: string[] }
/** A repo whose `main` holds two commits; the second is the base commit a job checks out. */
export function makeRepo(files: Record<string, string> = {}): Repo {
  const dir = sub(tempDir(), 'repo');
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), '# a repo\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  writeFileSync(join(dir, 'src.txt'), 'the base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  return { dir, base, history: git(dir, 'rev-list', base).trim().split('\n') };
}
/** Every file's bytes under `dir`, git objects decompressed through git itself when `dir/.git` is a folder. */
export function contentsOf(dir: string): { files: string[]; text: string } {
  const files: string[] = [];
  const parts: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) { files.push(path); parts.push(readFileSync(path).toString('latin1')); }
    }
  };
  if (existsSync(dir)) walk(dir);
  if (existsSync(join(dir, '.git')) && lstatSync(join(dir, '.git')).isDirectory()) {
    try { parts.push(execFileSync('/usr/bin/git', ['--git-dir', join(dir, '.git'), 'cat-file', '--batch-all-objects', '--batch'], { encoding: 'latin1', maxBuffer: 256 << 20 })); } catch { /* no objects */ }
  }
  return { files, text: parts.join('\n') };
}

// ---- Listeners: a stand-in API host on 127.0.0.1, and a stand-in hub socket that greets as the hub does.
export interface Listener { port: number; path: string; connections: number; text(): string; close(): Promise<void> }
const listeners: Listener[] = [];
async function listen(at: { path?: string; hub?: boolean }): Promise<Listener> {
  const server = net.createServer();
  let connections = 0;
  let text = '';
  server.on('connection', (sock) => {
    connections++;
    sock.on('error', () => undefined);
    sock.setEncoding('utf8');
    let buffer = '';
    // As the hub (#16): its hello on accept, and a result for each method call.
    if (at.hub) sock.write(`${JSON.stringify({ v: 1, hello: 'deep-hub', start: ulid(), features: [] })}\n`);
    sock.on('data', (d: string) => {
      text += d;
      buffer += d;
      let i: number;
      while (at.hub && (i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          const msg = JSON.parse(line) as Line;
          if (msg.method) sock.write(`${JSON.stringify({ v: 1, id: msg.id ?? null, result: {} })}\n`);
          else if (msg.hello === 'cli' || msg.hello === 'app') sock.write(`${JSON.stringify({ v: 1, role: msg.hello })}\n`);
        } catch { /* not a line of ours */ }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    if (at.path) server.listen(at.path, resolve);
    else server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const l: Listener = {
    port: typeof address === 'object' && address ? address.port : 0,
    path: at.path ?? '',
    get connections() { return connections; },
    text: () => text,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  listeners.push(l);
  return l;
}
export const tcpListener = (): Promise<Listener> => listen({});
export const unixListener = (path: string): Promise<Listener> => listen({ path });
/** A stand-in for the hub's socket: its hello on accept, `{}` for every method call; it keeps what it read. */
export const hubListener = (path: string): Promise<Listener> => listen({ path, hub: true });
export async function closeListeners(): Promise<void> {
  await Promise.all(listeners.splice(0).map((l) => l.close()));
}

// ---- Waiting.
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(20);
  }
}

/** Nothing missing passes (AGENTS.md, invariant 2): a half whose surface another issue builds fails BLOCKED. */
export function blocked(what: string): never {
  throw Error(`BLOCKED: ${what}; this half of the criterion is tested once that surface exists, by a blind redraft of this job`);
}

// ---- The hub as a process: `deep hub run --root <folder>` (#16), with the runner in it (README, The hub).
export function childEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home(), LC_ALL: 'C' };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
export interface HubConfig { loginPath: string; reservePct?: number }
/** The settings a hub's runner reads at start from `<root>/config.json` (README, The hub). */
export function writeHubConfig(root: string, c: HubConfig): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ runner: { login_path: c.loginPath }, plan: { reserve_pct: c.reservePct ?? 10 } }, null, 2)}\n`);
}
export interface Hub { pid: number; root: string; socket: string; child: ChildProcess; exit: Promise<unknown>; stderr(): string }
export async function startHub(root: string, env: Record<string, string | undefined> = {}): Promise<Hub> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the hub isn't built (${CLI}); run npm run build --workspaces`);
  const child = spawn(NODE, [CLI, 'hub', 'run', '--root', root], { cwd: REPO, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, sleep(10_000)]);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}

/** A client of the hub's line protocol with the cli role (README of #16, The socket). */
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
  async call(method: string, params: unknown = {}, timeoutMs = 15_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await waitFor(() => this.lines.find((l) => l.id === id), timeoutMs, `the reply to ${method}`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  async events(): Promise<Line[]> {
    const out: Line[] = [];
    for (let after = 0; ;) {
      const page = await this.call('events.read', { after, limit: 1000 });
      const events = page.events as Line[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos as number;
    }
  }
  close(): void { this.sock.destroy(); }
}

/** deep-hook's part, carried by the test: one hook.request@1 line, as deep-hook sends it, answered or refused. */
export async function sendHook(socket: string, event: string, payload: Line, seq = seqNow()): Promise<Line[]> {
  const request = { v: 1, agent: 'claude-code', event, seq, id: ulid(), pid: process.pid, ppid: process.ppid, matched: [], payload: { ...payload, hook_event_name: event } };
  const sock = net.connect(socket);
  const lines: Line[] = [];
  let buffer = '';
  return new Promise<Line[]>((resolve) => {
    const done = () => { sock.destroy(); resolve(lines); };
    const timer = setTimeout(done, 10_000);
    sock.setEncoding('utf8');
    sock.on('error', () => { clearTimeout(timer); done(); });
    sock.on('close', () => { clearTimeout(timer); done(); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = JSON.parse(buffer.slice(0, i)) as Line;
        buffer = buffer.slice(i + 1);
        lines.push(line);
        if (lines.length === 1) sock.write(`${JSON.stringify(request)}\n`);
        else if ('exit' in line || 'error' in line) { clearTimeout(timer); done(); }
      }
    });
  });
}

// ---- Timing on the reference Mac (tests/acceptance/14, 16 and 236's rule).
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
