// Shared test-side tools for #70's acceptance tests (README): what each test needs of the machine, each missing thing
// failing BLOCKED; temp homes; the hub as the real systemd user service, with its environment set by a drop-in; the
// line protocol; the polkit boundary's stub and the real polkitd's rule; the Claude Code stand-in; a process an agent
// started that left its tree; the record seeded through the record and asks core. Parts are adapted from
// tests/acceptance/19/authority/helpers.ts and tests/acceptance/347/helpers.ts (same repo, same license); this suite
// keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild. Processes
// are stopped by PID only, and only ones this suite started, each checked against the start time first read for it.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { askSources, openAsks } from '../../../packages/asks/src/index.ts';
import type { AskKind } from '../../../packages/asks/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection } from '../../../packages/record/src/index.ts';
import { HELPER } from '../../../packages/supervisor/src/index.ts';
import { withPlans } from '../plans.ts';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const NODE = process.execPath;
export const DAY = 86_400_000;
export const MINUTE = 60_000;
/** The hub's login service (packages/hub/src/service.ts), a fixed name: one hub at a time, so one test at a time. */
export const UNIT = 'deepbuild-hub.service';

// Criterion IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed
// (scripts/proof-change.mjs, criterionId). Each test's title starts with its criterion and ID.
export const AC1 = 'AC1 #70.3a94aeb5';
export const AC2 = 'AC2 #70.eb5a58a0';
export const AC3 = 'AC3 #70.18ce54cd';
export const AC4 = 'AC4 #70.ef8d1e25';
export const AC5 = 'AC5 #70.7f24fc90';
export const AC6 = 'AC6 #70.6c040d74';
export const AC7 = 'AC7 #70.b6da6dea';
export const AC8 = 'AC8 #70.047e3c2e';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const tag = (n = 4) => randomBytes(n).toString('hex');
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
const quoted = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- What these tests need of the machine. Each missing thing fails BLOCKED; nothing skips.
export function requireLinux(): void {
  if (process.platform !== 'linux') throw Error(`BLOCKED: this criterion is Linux's and this is ${process.platform}; run it in the deep-ubuntu and deep-fedora VMs (README)`);
  for (const [file, how] of [[CLI, 'npm run build --workspaces'], [HELPER, 'npm run build --workspaces'], [join(REPO, 'target/debug/deep-hook'), 'cargo build --locked -q -p deep-hook']] as const) {
    if (!existsSync(file)) throw Error(`BLOCKED: ${file} is missing; run ${how} first`);
  }
}
/** The distribution this run is on: Ubuntu LTS or Fedora, the two the issue names. */
export function distribution(): string {
  requireLinux();
  const os = Object.fromEntries(readFileSync('/etc/os-release', 'utf8').split('\n').map((l) => /^(\w+)=(.*)$/.exec(l)).flatMap((m) => (m ? [[m[1]!, m[2]!.replace(/^"|"$/g, '')]] : []))) as Record<string, string>;
  const lts = os.ID === 'ubuntu' && /LTS/.test(os.VERSION ?? '');
  if (!lts && os.ID !== 'fedora') throw Error(`BLOCKED: this is ${os.PRETTY_NAME ?? os.ID}; the issue names Ubuntu LTS and Fedora`);
  return os.PRETTY_NAME ?? os.ID!;
}
/** bubblewrap as the backend runs it, and a kernel with the Landlock ABI it needs (packages/supervisor/src/bubblewrap.ts). */
export function requireBubblewrap(): void {
  requireLinux();
  if (!existsSync('/usr/bin/bwrap')) throw Error('BLOCKED: /usr/bin/bwrap is missing; install bubblewrap');
  const namespaces = spawnSync('/usr/bin/bwrap', ['--unshare-user', '--ro-bind', '/', '/', '--', '/bin/true'], { encoding: 'utf8', timeout: 30_000 });
  if (namespaces.status !== 0) throw Error(`BLOCKED: bubblewrap can't make a user namespace here (AppArmor's unprivileged user-namespace restriction, or a sysctl): ${namespaces.stderr}`);
  const abi = Number(execFileSync(HELPER, ['landlock'], { encoding: 'utf8' }).trim()) || 0;
  if (abi < 4) throw Error(`BLOCKED: this kernel's Landlock ABI is ${abi}; the sandbox needs 4 or later (Linux 6.7)`);
}

// ---- systemd --user, as the real user: the bus and the unit folder a user manager reads, whatever HOME a test sets.
const uid = userInfo().uid;
const RUNTIME = process.env.XDG_RUNTIME_DIR ?? `/run/user/${uid}`;
const BUS = process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${RUNTIME}/bus`;
const REAL_CONFIG = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
const USER_UNITS = join(REAL_CONFIG, 'systemd', 'user');
const DROP_IN = join(USER_UNITS, `${UNIT}.d`);
const OUR_DROP_IN = join(DROP_IN, 'dh70.conf');
const userEnv = (): NodeJS.ProcessEnv => ({ ...process.env, XDG_RUNTIME_DIR: RUNTIME, DBUS_SESSION_BUS_ADDRESS: BUS });
export const systemctl = (...args: string[]) => spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8', env: userEnv(), timeout: 120_000 });

/** Takes this suite's unit away: stopped, its files gone, the manager told. */
function clearService(): void {
  systemctl('disable', '--now', UNIT);
  rmSync(join(USER_UNITS, UNIT), { force: true });
  rmSync(DROP_IN, { recursive: true, force: true });
  systemctl('daemon-reload');
  systemctl('reset-failed', UNIT);
}
/** A running user manager, and the hub's unit name free: a real installed hub on this machine is never touched. */
export function requireService(): void {
  requireLinux();
  const state = systemctl('is-system-running');
  if (state.error || !/^(running|degraded)/.test(state.stdout.trim())) throw Error(`BLOCKED: no running systemd --user here (is-system-running: ${state.stdout.trim() || state.error?.message}); run loginctl enable-linger and start from a login shell`);
  if (existsSync(OUR_DROP_IN)) clearService();
  if (systemctl('cat', UNIT).status === 0) throw Error(`BLOCKED: this machine has a ${UNIT} of its own; these tests take that name, so run them on a throwaway VM`);
}
/** `secret-tool` on a Secret Service that stores and gives back: a control item, cleared after. */
export function requireSecretService(): void {
  requireLinux();
  const control = ['dh70-control', tag()];
  const tool = (args: string[], input?: string) => spawnSync('secret-tool', args, { encoding: 'utf8', env: userEnv(), input, timeout: 30_000 });
  const stored = tool(['store', '--label=dh70 control', ...control], 'control');
  if (stored.error || stored.status !== 0) throw Error(`BLOCKED: no working Secret Service on the session bus: secret-tool store: ${stored.error?.message ?? stored.stderr}; install gnome-keyring and libsecret's secret-tool, and unlock the default collection`);
  const back = tool(['lookup', ...control]);
  tool(['clear', ...control]);
  if (back.stdout.trim() !== 'control') throw Error(`BLOCKED: the Secret Service didn't give a control item back: ${back.stderr}`);
}
export const secretTool = (args: string[]) => spawnSync('secret-tool', args, { encoding: 'utf8', env: userEnv(), timeout: 30_000 });
/** A real polkitd, and root to give it a rule. */
function requirePolkit(): void {
  requireLinux();
  if (!existsSync('/usr/bin/pkcheck')) throw Error('BLOCKED: /usr/bin/pkcheck is missing; install polkit');
  if (spawnSync('sudo', ['-n', 'true']).status !== 0) throw Error('BLOCKED: this test gives the real polkitd a rule, which needs passwordless sudo');
  // A ping, which D-Bus activates it for: polkitd exits when idle, so `busctl status` would find no owner.
  const on = spawnSync('busctl', ['--system', 'call', 'org.freedesktop.PolicyKit1', '/org/freedesktop/PolicyKit1/Authority', 'org.freedesktop.DBus.Peer', 'Ping'], { encoding: 'utf8', timeout: 30_000 });
  if (on.status !== 0) throw Error(`BLOCKED: no polkitd on the system bus: ${on.stderr}`);
}

// ---- Temp folders. Short paths: a Unix socket path must fit in 108 bytes.
const made: string[] = [];
function tempDir(under: string): string {
  if (!existsSync(under)) throw Error(`BLOCKED: ${under} is missing`);
  const dir = realpathSync(mkdtempSync(join(under, 'dh70-')));
  made.push(dir);
  return dir;
}
/**
 * A fresh home. `home` is HOME for every process a test starts and the worktree sits beside it, both under `under`.
 * `bin`, first on PATH, stays under /tmp, since /dev/shm may be noexec: a stand-in for `claude`, a `deep`, and the
 * polkit boundary's stub, which reads `polkit.answer` at each ask and is `cancelled` until a test says otherwise.
 */
export interface Home { tmp: string; base: string; home: string; bin: string; tmpdir: string; polkit: { stub: string; answer: string; log: string } }
export function makeHome(under = '/tmp'): Home {
  const tmp = tempDir('/tmp');
  const base = under === '/tmp' ? tmp : tempDir(under);
  const home = join(base, 'h');
  const tmpdir = join(base, 't');
  const bin = join(tmp, 'bin');
  for (const dir of [join(home, '.claude'), tmpdir, bin]) mkdirSync(dir, { recursive: true });
  copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, 'claude'));
  chmodSync(join(bin, 'claude'), 0o755);
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  const polkit = { stub: join(bin, 'polkit-stub'), answer: join(tmp, 'polkit.answer'), log: join(tmp, 'polkit.log') };
  // pkcheck's exit codes: 0 authorized, 3 dismissed. Its arguments are kept, so a test can read what was asked.
  writeFileSync(polkit.stub, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${polkit.log}'\n[ "$(cat '${polkit.answer}')" = confirmed ] && exit 0\nexit 3\n`);
  chmodSync(polkit.stub, 0o755);
  writeFileSync(polkit.answer, 'cancelled\n');
  return { tmp, base, home, bin, tmpdir, polkit };
}
/** What the polkit prompt does from now on: the boundary's stub, read at each ask. */
export const confirmWith = (h: Home, answer: 'confirmed' | 'cancelled'): void => writeFileSync(h.polkit.answer, `${answer}\n`);
/** Each ask that reached the polkit boundary: its arguments, one line per ask. */
export const polkitCalls = (h: Home): string[] => (existsSync(h.polkit.log) ? readFileSync(h.polkit.log, 'utf8').split('\n').filter(Boolean) : []);

// ---- Processes this suite started, each with the start time first read for it.
/** A process's start time in clock ticks, from /proc; undefined once it is gone or a zombie. */
export function startOf(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return fields[0] === 'Z' || fields[0] === 'X' ? undefined : fields[19];
  } catch {
    return undefined;
  }
}
/** A process's cgroup, as the unified hierarchy names it; undefined once it is gone. */
export function cgroupOf(pid: number): string | undefined {
  try {
    return /^0::(.*)$/m.exec(readFileSync(`/proc/${pid}/cgroup`, 'utf8'))?.[1];
  } catch {
    return undefined;
  }
}
const owned = new Map<number, string | undefined>();
export function own(pid: number | undefined): void {
  if (pid && !owned.has(pid)) owned.set(pid, startOf(pid));
}
const rootFiles = new Set<string>();
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s), its hub's unit, and removes its folders. */
export async function cleanup(): Promise<void> {
  const ours = () => [...owned].filter(([pid, start]) => start !== undefined && startOf(pid) === start).map(([pid]) => pid);
  for (const pid of ours()) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while (ours().length && Date.now() < deadline) await sleep(50);
  for (const pid of ours()) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  if (process.platform === 'linux' && existsSync(OUR_DROP_IN)) clearService();
  for (const file of rootFiles) spawnSync('sudo', ['-n', 'rm', '-f', file]);
  rootFiles.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the test's home, the stand-ins first on PATH, the user manager's bus, and no
 * DEEP_, CLAUDE, CODEX, GIT_ or other XDG_ setting or billing key of this process's. DEEP_HUB_TEST_CONFIRM is never
 * set: it stands above the platform's code, so a hub that never asks polkit would pass with it (README: the polkit boundary).
 */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|TMUX)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), XDG_DATA_HOME: join(h.home, '.local/share'),
    XDG_RUNTIME_DIR: RUNTIME, DBUS_SESSION_BUS_ADDRESS: BUS, TMPDIR: h.tmpdir, SHELL: '/bin/sh', PATH: `${h.bin}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C',
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
  });
}
export const shown = (r: { code: number | null; stdout: string; stderr: string }) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
export const said = (r: { stdout: string; stderr: string }) => `${r.stdout}${r.stderr}`;
/** `deep <args>` from the built CLI, run by you: a child of this test process, under no agent. */
export function deep(h: Home, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(h, o.env), cwd: o.cwd ?? h.tmp, timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- The hub as the real systemd user service.
export interface Hub { home: string; root: string; socket: string }
export const rootOf = (h: Home) => join(h.home, '.deepbuild');
export const mainPid = (): number => Number(systemctl('show', '-p', 'MainPID', '--value', UNIT).stdout.trim());
export const answers = (socket: string): Promise<boolean> => Conn.open(socket, 3000).then((c) => { c.close(); return true; }, () => false);
/**
 * `deep hub start`, which writes the unit and enables it through the real systemctl, its unit folder the user
 * manager's own. A drop-in beside the unit carries what a test sets on the hub: the plant, and the polkit boundary's
 * stub unless `polkit` is 'real'. Fails BLOCKED if the service doesn't come up.
 */
export async function startService(h: Home, o: { plant?: string | undefined; polkit?: 'stub' | 'real' | undefined } = {}): Promise<Hub> {
  requireService();
  const env = [...(o.plant ? [`DEEP_HUB_PLANT=${o.plant}`] : []), ...(o.polkit === 'real' ? [] : [`DEEP_HUB_TEST_POLKIT=${h.polkit.stub}`])];
  mkdirSync(DROP_IN, { recursive: true });
  writeFileSync(OUR_DROP_IN, `[Service]\n${env.map((e) => `Environment="${e}"`).join('\n')}\n`);
  const started = await deep(h, ['hub', 'start'], { env: { XDG_CONFIG_HOME: REAL_CONFIG, DEEP_HUB_PLANT: o.plant } });
  if (started.code !== 0) throw Error(`BLOCKED: the hub's service didn't start${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''}: ${shown(started)}; systemd says ${systemctl('status', '--no-pager', '-n', '20', UNIT).stdout.slice(-1500)}`);
  const root = rootOf(h);
  return { home: h.home, root, socket: join(root, 'hub.sock') };
}
/** `systemctl --user restart` of the hub's service; resolves once a new process answers on its socket. */
export async function restartService(hub: Hub): Promise<void> {
  const before = mainPid();
  const restarted = systemctl('restart', UNIT);
  if (restarted.status !== 0) throw Error(`BLOCKED: systemctl --user restart ${UNIT} failed: ${restarted.stderr}`);
  await waitFor(async () => mainPid() !== before && mainPid() !== 0 && (await answers(hub.socket)), 60_000, `a new hub answering at ${hub.socket} after the restart`);
}
/** What the hub's service wrote to the journal, from whichever journal this machine keeps it in. */
export function journal(): string {
  for (const args of [['--user', '-u', UNIT], [`_SYSTEMD_USER_UNIT=${UNIT}`]]) {
    const r = spawnSync('journalctl', [...args, '--no-pager', '-o', 'cat'], { encoding: 'utf8', env: userEnv(), timeout: 60_000, maxBuffer: 1 << 28 });
    if (r.status === 0 && /"ready"/.test(r.stdout)) return r.stdout;
  }
  throw Error(`BLOCKED: neither the user nor the system journal shows ${UNIT}'s ready line, so what it logged can't be read`);
}

// ---- The line protocol (#16), as the CLI or the app, with the control token the hub wrote at its launch.
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private wakers = new Set<() => void>();
  private ids = 0;
  ended = false;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    const wake = () => { for (const w of [...this.wakers]) w(); };
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      wake();
    });
    for (const event of ['error', 'close']) sock.on(event, () => { this.ended = true; wake(); });
  }
  static open(path: string, timeoutMs = 5000): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const conn = new Conn(net.connect(path));
      const timer = setTimeout(() => { conn.sock.destroy(); reject(Error(`no hello from the hub at ${path}`)); }, timeoutMs);
      const check = () => {
        if (conn.lines.length > 0) { clearTimeout(timer); conn.wakers.delete(check); resolve(conn); }
        else if (conn.ended) { clearTimeout(timer); conn.wakers.delete(check); reject(Error(`can't reach the hub at ${path}`)); }
      };
      conn.wakers.add(check);
    });
  }
  private wait(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const done = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolve(v); };
      const check = () => { const found = this.lines.slice(from).find(match); if (found) done(found); else if (this.ended) done(undefined); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async hello(role: 'cli' | 'app', token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: role, token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (reply?.role !== role) throw Error(`BLOCKED: the hub refused the ${role} hello: ${JSON.stringify(reply)}`);
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
/** One call on a fresh connection, in `role`, with the token of the hub's current launch. */
export async function call(hub: Hub, role: 'cli' | 'app', method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(role, readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await conn.call(method, params, timeoutMs);
  } finally {
    conn.close();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
/** Every event in the hub's log after `after`, paged by log_pos through `events.read`. */
export async function allEvents(hub: Hub, after = 0): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let at = after; ;) {
    const events = (await call(hub, 'cli', 'events.read', { after: at, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    at = events[events.length - 1]!.log_pos;
  }
}
/** Polls until probe gives a value, or fails naming what it waited for. */
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(200);
  }
}

// ---- Sessions and their hook payloads, shaped like the corpus's Claude Code payloads.
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
/** A git repository with one commit for sessions to work in; build/ is ignored, so git can't restore it. */
function makeWorktree(h: Home): string {
  const dir = join(h.base, 'w');
  mkdirSync(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=dh70', '-c', 'user.email=dh70@example.test', ...args], { cwd: dir, stdio: 'ignore', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: h.base, GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, '.gitignore'), 'build/\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}
function newSession(h: Home, cwd: string): Session {
  const id = randomUUID();
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  if (event === 'SessionStart') { Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; }
  return { ...base, ...extra };
}
/** The transcript entry Claude Code writes for a prompt you typed; its prompt ID goes on the hooks of its turn. */
function typedPrompt(s: Session, text: string): void {
  s.prompt = randomUUID();
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', type: 'user', promptId: s.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}

// ---- The Claude Code stand-in (fixtures/claude.mjs, #19's): one process per session, the parent of what its hooks and its Bash tool run.
export interface HookRun { command: string; code: number | null; stdout: string; stderr: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, private readonly settings: string) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  get pid(): number { return this.child.pid!; }
  static start(h: Home, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS], { cwd: h.tmp, env: childEnv(h, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Claude(child, join(h.home, '.claude/settings.json'));
  }
  private send(command: Line, timeoutMs = 300_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the Claude Code stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the Claude Code stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** Fires one hook: every entry of the user settings file for it, as Claude Code runs them. Returns DeepBuild's entries' runs. */
  async hook(event: string, body: Line): Promise<HookRun[]> {
    const fired = await this.send({ op: 'hook', event, payload: body, settings: this.settings });
    return (fired.ran as HookRun[]).filter((r) => /deep-hook/.test(r.command));
  }
  /** A command as the Bash tool runs it, a child of this session's process. */
  async exec(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return (await this.send({ op: 'exec', command, cwd })) as unknown as { code: number; stdout: string; stderr: string };
  }
}

// ---- A session of the stand-in, its hooks running what `deep setup` wrote, against the real service.
export interface World { h: Home; hub: Hub; claude: Claude; s: Session; worktree: string }
/**
 * The hub's service, `deep setup`, the shipped guard rules, and one Claude Code session in a worktree that has started
 * and taken a prompt. `seed` runs before the hub starts, with the record free. `under` is where HOME and the worktree sit.
 */
export async function world(o: { plant?: string | undefined; polkit?: 'stub' | 'real' | undefined; under?: string; seed?: (h: Home, s: Session) => Promise<void> } = {}): Promise<World> {
  requireService();
  const h = makeHome(o.under);
  const worktree = makeWorktree(h);
  const s = newSession(h, worktree);
  if (o.seed) await o.seed(h, s);
  const hub = await startService(h, { plant: o.plant, polkit: o.polkit });
  const plantEnv = { DEEP_HUB_PLANT: o.plant };
  const setup = await deep(h, ['setup'], { env: plantEnv });
  if (setup.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild's hooks: ${shown(setup)}`);
  const rules = join(rootOf(h), 'rules.json');
  if (!existsSync(rules)) copyFileSync(DEFAULT_RULES, rules);
  const claude = Claude.start(h, plantEnv);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Tidy the release notes, then stop.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Tidy the release notes, then stop.' }));
  return { h, hub, claude, s, worktree };
}

// ---- A command an agent started that left its process tree, so the peer check finds no agent above it.
export interface Left { code: number; stdout: string; stderr: string; chain: string; cgroup: string }
/**
 * Waits for `deep <args>`, run through `start`, the script it is given recording its ancestors and cgroup. A chain that
 * still holds the agent is BLOCKED, since the test would prove nothing.
 */
async function leftTree(w: World, args: readonly string[], start: (script: string, dir: string) => Promise<void>): Promise<Left> {
  const out = mkdtempSync(join(w.h.tmp, 'f-'));
  const script = join(out, 'run.sh');
  writeFileSync(script, [
    'chain=""; p=$$',
    'while [ -n "$p" ] && [ "$p" -gt 1 ]; do chain="$chain $p"; p=$(ps -o ppid= -p "$p" | tr -d " "); done',
    `echo "$chain -> $p" > '${out}/chain'`,
    `cat /proc/self/cgroup > '${out}/cgroup'`,
    `${[NODE, CLI, ...args].map(quoted).join(' ')} >'${out}/out' 2>'${out}/err' </dev/null; echo $? >'${out}/code.tmp'`,
    `mv '${out}/code.tmp' '${out}/code'`,
    '',
  ].join('\n'));
  await start(script, out);
  await waitFor(() => existsSync(join(out, 'code')), 180_000, `deep ${args.join(' ')} to end after leaving the agent's tree`);
  const read = (name: string) => readFileSync(join(out, name), 'utf8');
  const chain = read('chain').trim();
  const pids = chain.split('->')[0]!.trim().split(/\s+/).map(Number);
  if (pids.includes(w.claude.pid)) throw Error(`BLOCKED: deep ${args.join(' ')} still has the agent ${w.claude.pid} above it: ${chain}`);
  return { code: Number(read('code').trim()), stdout: read('out'), stderr: read('err'), chain, cgroup: read('cgroup') };
}
/** The agent's Bash tool double-forks: the shell between exits at once, and PID 1 adopts the rest. */
export async function doubleForked(w: World, args: readonly string[]): Promise<Left> {
  const left = await leftTree(w, args, async (script) => {
    const forked = await w.claude.exec(`( sleep 1; /bin/sh ${quoted(script)} ) </dev/null >/dev/null 2>&1 &`, w.worktree);
    if (forked.code !== 0) throw Error(`BLOCKED: the double fork failed: ${forked.stderr}`);
  });
  // The script, and at most the subshell its shell left, then PID 1: a subreaper in between would be no adoption by PID 1.
  if (left.chain.split('->')[0]!.trim().split(/\s+/).length > 2) throw Error(`BLOCKED: the double fork wasn't adopted by PID 1 (its ancestors: ${left.chain}); run from a login shell, not inside a user unit or a subreaper`);
  return left;
}
/** The agent's Bash tool hands the command to `systemd-run --user`: the user manager starts it, in a unit of its own. */
export async function viaSystemdRun(w: World, args: readonly string[]): Promise<Left> {
  const unit = `dh70-${tag()}.service`;
  const env = childEnv(w.h);
  const setenv = ['HOME', 'PATH', 'XDG_CONFIG_HOME', 'LC_ALL'].map((k) => `--setenv=${quoted(`${k}=${env[k]}`)}`);
  const left = await leftTree(w, args, async (script) => {
    const started = await w.claude.exec(`systemd-run --user --quiet --collect --unit=${unit} --working-directory=${quoted(w.worktree)} ${setenv.join(' ')} /bin/sh ${quoted(script)}`, w.worktree);
    if (started.code !== 0) throw Error(`BLOCKED: systemd-run --user failed: ${started.stderr}`);
  });
  if (!left.cgroup.includes(unit)) throw Error(`BLOCKED: the command didn't run in the unit systemd-run started (${unit}); its cgroup: ${left.cgroup}`);
  return left;
}

// ---- The record, seeded before the hub starts, through the real record and asks core (as #24's suite seeds it).
const who = { actor: 'you', scope: 'you' };
const ULID_CHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ULID_CHARS[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = ULID_CHARS[n % 32] + tail;
  return time + tail;
}
const OPTIONS = [{ id: 'approve', label: 'Push it', decision: 'allow' }, { id: 'decline', label: 'Hold the push', decision: 'deny' }];
/** An authority ask raised by DeepBuild's core for the session, open for a day, with the hub stopped. Returns its handle. */
export async function seedAuthorityAsk(h: Home, s: Session, subject: string): Promise<string> {
  mkdirSync(rootOf(h), { recursive: true, mode: 0o700 });
  const now = Date.now();
  const record = await openRecord({ path: join(rootOf(h), 'ledger.db'), now: () => now });
  const asks = withPlans(await openAsks({ record, now: () => now, deliver: () => undefined }));
  try {
    await record.append({ writer: 'hook', ...who, session: s.id, project: 'shop', agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree: s.cwd, branch: 'main', thread: s.id } });
    const core: Connection = { writer: 'core', ...who, session: s.id, project: 'shop' };
    const kind: AskKind = 'authority';
    const source = askSources().find((row) => row.kind === kind)!.source;
    return await asks.raise(core, source, {
      kind, question: `Push ${subject} to origin?`, options: structuredClone(OPTIONS), recommended: null, deadline: now + DAY,
      fallback: 'you', default: 'decline', provisional: false, owner: 'you', key: sha256(`${kind}:${subject}`),
      pinned_to: { kind: 'evidence', ref: sha256(subject) },
    });
  } finally {
    await record.close();
  }
}
const CLOSING = new Set(['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot']);
const counted = (all: readonly Ev[], handle: string) => all.filter((e) => (CLOSING.has(e.kind) && e.subject === handle) || ((e.kind === 'decision.created' || e.kind === 'decision.applied') && e.data?.ask === handle));
/** The ask is still open: nothing closed it, and no decision was saved from it or applied to it. */
export async function expectOpen(hub: Hub, handle: string, how: string): Promise<void> {
  await sleep(300); // anything the hub appends for the answer lands before this read
  const found = counted(await allEvents(hub), handle);
  expect(found.map((e) => `${e.kind} ${e.id}`), `ask ${handle} (${how}) counted: the ask must stay open and no decision be saved`).toEqual([]);
}
/** The answer counted once: one ask.answered from deep inbox answer, verified, and one decision saved from it. */
export async function expectCountedOnce(hub: Hub, handle: string, option: string, how: string): Promise<void> {
  const found = counted(await allEvents(hub), handle);
  expect(found.filter((e) => e.kind === 'ask.answered').map((e) => [e.data.answer, e.data.via, e.data.verified]), `ask ${handle} (${how}), once polkit confirmed you, is answered exactly once, with ${option}, from deep inbox answer`).toEqual([[option, 'inbox', true]]);
  expect(found.filter((e) => e.kind === 'decision.created').length, `ask ${handle} (${how}), once polkit confirmed you, saves exactly one decision`).toBe(1);
}

// ---- The real polkitd, the prompt replaced by a rule (README: the polkit boundary).
const RULE = '/etc/polkit-1/rules.d/49-dh70.rules';
const ACTIONS = join(REPO, 'packages/hub/native');
/** The action files the repo ships go where a package puts them, so the real polkitd knows the hub's action. */
export function installPolkitActions(): void {
  requirePolkit();
  for (const name of existsSync(ACTIONS) ? readdirSync(ACTIONS).filter((f) => f.endsWith('.policy')) : []) {
    const to = `/usr/share/polkit-1/actions/${name}`;
    const copied = spawnSync('sudo', ['-n', 'install', '-m', '644', join(ACTIONS, name), to], { encoding: 'utf8' });
    if (copied.status !== 0) throw Error(`BLOCKED: couldn't install ${name} for polkitd: ${copied.stderr}`);
    rootFiles.add(to);
  }
}
/**
 * From now on the real polkitd answers this user's every check with `result`, as a person at the prompt would: the
 * prompt alone is replaced, and pkcheck, polkitd and the action stay real. A control check reads the rule live first.
 */
export async function polkitAnswers(result: 'YES' | 'NO'): Promise<void> {
  const js = `polkit.addRule(function (action, subject) {\n  if (subject.user === ${JSON.stringify(userInfo().username)}) return polkit.Result.${result};\n});\n`;
  const wrote = spawnSync('sudo', ['-n', 'tee', RULE], { input: js, encoding: 'utf8' });
  if (wrote.status !== 0) throw Error(`BLOCKED: couldn't write ${RULE}: ${wrote.stderr}`);
  rootFiles.add(RULE);
  const control = () => spawnSync('pkcheck', ['--action-id', 'org.freedesktop.policykit.exec', '--process', String(process.pid)], { timeout: 10_000 }).status;
  await waitFor(() => (control() === 0) === (result === 'YES'), 15_000, `polkitd to take the rule ${result}`).catch(() => { throw Error(`BLOCKED: polkitd never read ${RULE} as ${result}`); });
}

/** A planted run's failure: the message it failed with, '' when it passed. */
export async function failure(scenario: () => Promise<void>): Promise<string> {
  try {
    await scenario();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}
/** A plant must start and run: a BLOCKED or INCONCLUSIVE run is not its failure. */
export const notBlocked = (message: string) => expect(message, 'the planted program must start and run').not.toMatch(/BLOCKED|INCONCLUSIVE/);
