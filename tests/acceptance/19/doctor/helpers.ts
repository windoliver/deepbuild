// Shared test-side tools for issue #19's doctor criteria (README): temp homes with stand-in agents and system tools,
// `deep setup`/`deep doctor` through the built CLI, Claude Code's user settings and DeepBuild's entries in them, the
// hub as a process with its socket's line protocol, the session stand-in, and "the world where every item is ok".
// Parts are adapted from tests/acceptance/18/install/helpers.ts (same repo, same license); this suite keeps its own
// copy so a redraft of that one never moves these tests. Nothing here stands in for DeepBuild: every test reaches it
// through the CLI, deep-hook as the settings run it, the hub's socket and the files under the temporary home.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { listSchemas } from '@deepbuild/contracts';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const NODE = process.execPath;
export const MINUTE = 60_000;
export const HOUR = 3_600_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw.trim()); return l ? [l] : []; });
export const tag = (n = 6) => randomBytes(n).toString('hex');
const versionsOf = (file: string) => (JSON.parse(readFileSync(join(REPO, 'adapters', file), 'utf8')) as { versions: string[] }).versions;
/** The newest Claude Code version its facts cover, and the oldest: the two stand-in installs of AC11. */
export const CLAUDE_COVERED = versionsOf('claude-code.facts.json').at(-1)!;
export const CLAUDE_OLDER = versionsOf('claude-code.facts.json')[0]!;
/** A plain release Codex's facts cover (not a pre-release). */
export const CODEX_COVERED = versionsOf('codex.facts.json').filter((v) => /^\d+\.\d+\.\d+$/.test(v)).at(-1)!;
/** The account Claude Code records beside your sign-in in the stand-in homes. */
export const ACCOUNT = '0d0d0d0d-1919-4919-8919-191919191919';
/** The doctor family's codes and levels, from their one source, doctor.item@1 (a code it doesn't list is INVALID). */
export function doctorEnums(): { codes: string[]; levels: string[] } {
  const schema = listSchemas().find((e) => e.name === 'doctor.item@1')!.schema as Line;
  return { codes: schema.properties.code.enum as string[], levels: schema.properties.level.enum as string[] };
}
/** The exit-code table's one source, exit.code@1. */
export function exitEnum(): number[] {
  const schema = listSchemas().find((e) => e.name === 'exit.code@1')!.schema as Line;
  return (schema.enum as string[]).map(Number);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh19d-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
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
/** Stops every process this suite started (SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- A home: <tmp>/h is HOME for every process a test starts; <tmp>/bin is first on PATH with the stand-ins.
export interface Home {
  tmp: string;
  home: string;
  bin: string;
  /** The working folder `deep` runs in: a git repo of its own, with no .claude folder. */
  work: string;
  /** The Keychain stand-in (DEEP_HUB_TEST_KEYCHAIN) and Claude Code's managed settings (DEEP_HUB_TEST_MANAGED_SETTINGS). */
  keychain: string;
  managed: string;
  /** Set on every process the test starts, plant included. */
  env: Record<string, string | undefined>;
}
/** A made-up OAuth sign-in as Claude Code keeps it in the Keychain, its access token expiring at `expiresAt`. */
export function keychainToken(expiresAt: number): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-dh19dFAKE${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-dh19dFAKE${'y'.repeat(40)}`, expiresAt, scopes: ['user:inference', 'user:profile'], subscriptionType: 'max' } });
}
export function setKeychain(h: Home, expiresAt: number): void {
  writeFileSync(h.keychain, `${JSON.stringify({ 'Claude Code-credentials': keychainToken(expiresAt) })}\n`, { mode: 0o600 });
}
/** Installs the agent stand-ins (`claude`, `codex`) into `dir`, each answering `version` and signed in. */
export function installAgents(dir: string, o: { claudeVersion?: string; codex?: boolean } = {}): void {
  mkdirSync(dir, { recursive: true });
  const put = (from: string, name: string) => { copyFileSync(join(FIXTURES, from), join(dir, name)); chmodSync(join(dir, name), 0o755); };
  put('claude.sh', 'claude');
  copyFileSync(join(FIXTURES, 'claude-mcp.mjs'), join(dir, 'claude-mcp.mjs'));
  writeFileSync(join(dir, 'node.path'), NODE);
  writeFileSync(join(dir, 'claude.version'), `${o.claudeVersion ?? CLAUDE_COVERED}\n`);
  writeFileSync(join(dir, 'claude.auth'), `${JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max' })}\n`);
  if (o.codex !== false) {
    put('codex.sh', 'codex');
    writeFileSync(join(dir, 'codex.version'), `${CODEX_COVERED}\n`);
    writeFileSync(join(dir, 'codex.login'), '0\n');
  }
}
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const work = join(tmp, 'w');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-q', work]);
  installAgents(bin);
  for (const name of ['launchctl', 'systemctl', 'launcher']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  // You, signed in to Claude Code: the account it records beside your sign-in (~/.claude.json, as #159's runner reads it).
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh19d@example.invalid', organizationUuid: 'org-dh19d' }, projects: {} }, null, 2)}\n`);
  writeFileSync(join(tmp, 'confirm'), 'cancelled\n');
  const h: Home = { tmp, home, bin, work, keychain: join(tmp, 'keychain.json'), managed: join(tmp, 'managed-settings.json'), env: {} };
  // A sign-in token that outlives any run: the Keychain item Claude Code keeps on macOS, stood in for (README: Seams).
  setKeychain(h, Date.UTC(2099, 0, 1));
  return h;
}
export const rootOf = (home: string) => join(home, '.deepbuild');
export const settingsFile = (h: Home) => join(h.home, '.claude', 'settings.json');
export const pathFor = (h: Home) => `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * The environment a child gets: HOME the test's home, PATH the stand-ins and the system folders only (no real
 * `claude` or `codex`), the seams pointed into the temp folder, and no DEEP_, CLAUDE, CODEX or billing variable of
 * this process's.
 */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('OTEL_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    if (key === 'PATH' || key === 'HOME' || key === 'SHELL') continue;
    env[key] = value;
  }
  env.HOME = h.home;
  env.XDG_CONFIG_HOME = join(h.home, '.config');
  env.XDG_CACHE_HOME = join(h.home, '.cache');
  env.SHELL = '/bin/sh';
  env.PATH = pathFor(h);
  env.LC_ALL = 'C';
  env.NO_COLOR = '1';
  env.DEEP_HUB_TEST_CONFIRM = join(h.tmp, 'confirm');
  env.DEEP_HUB_LAUNCHER = join(h.bin, 'launcher');
  env.DEEP_HUB_TEST_KEYCHAIN = h.keychain;
  env.DEEP_HUB_TEST_MANAGED_SETTINGS = h.managed;
  for (const [key, value] of Object.entries({ ...h.env, ...extra })) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 2500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** `deep <args>` from the built CLI, HOME the test's home, in the home's working folder unless `cwd` says otherwise. */
export function deep(h: Home, args: readonly string[], o: { env?: Record<string, string | undefined> | undefined; cwd?: string | undefined; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(h, o.env), cwd: o.cwd ?? h.work, timeoutMs: o.timeoutMs ?? 180_000 });
}

// ---- The stand-ins' calls: calls.log beside each stand-in, one "<name> <args>" line per call.
export function calls(dir: string): string[] {
  const file = join(dir, 'calls.log');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
}
/**
 * Whether a stand-in call sends an agent a prompt, which spends plan usage: `claude -p`/`--print` or `claude` with
 * no subcommand that never reaches the model (README: AC10); `codex exec` or `codex` with no such subcommand.
 */
export function isPrompt(call: string): boolean {
  const [name, ...args] = call.split(' ').filter(Boolean);
  if (name === 'claude') return args.includes('-p') || args.includes('--print') || !['--version', '-v', '--help', '-h', 'auth', 'mcp', 'plugin', 'config', 'doctor'].includes(args[0] ?? '');
  if (name === 'codex') return !['--version', '-V', '--help', '-h', 'login', 'mcp', 'features'].includes(args[0] ?? '');
  return false;
}

// ---- deep-hook: built once per test process; setup names the path its entries run.
const builds = new Map<string, Promise<void>>();
export function cargoBuild(release: boolean): Promise<void> {
  const key = release ? 'release' : 'debug';
  let p = builds.get(key);
  if (!p) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook', ...(release ? ['--release'] : [])];
    p = run('cargo', args, { timeoutMs: 1_200_000 }).then((r) => {
      if (r.code !== 0) throw Error(`BLOCKED: cargo ${args.join(' ')} failed: ${r.stderr.slice(-3000)}`);
    });
    builds.set(key, p);
  }
  return p;
}
async function ensureBinaries(settings: Line): Promise<void> {
  for (const { hook } of deepEntries(settings)) {
    for (const path of String(hook.command).match(/\/[^\s'"]*deep-hook\b/g) ?? []) {
      if (existsSync(path)) continue;
      if (path === join(REPO, 'target/release/deep-hook')) await cargoBuild(true);
      else if (path === join(REPO, 'target/debug/deep-hook')) await cargoBuild(false);
      if (!existsSync(path)) throw Error(`BLOCKED: DeepBuild's entry runs ${path}, which doesn't exist: ${hook.command}`);
    }
  }
}

// ---- Claude Code's user settings and DeepBuild's entries in them.
export function readSettings(h: Home): Line {
  const text = readFileSync(settingsFile(h), 'utf8');
  const parsed = parseObject(text);
  if (!parsed) throw Error(`${settingsFile(h)} is no longer a JSON object: ${text.slice(0, 500)}`);
  return parsed;
}
export function writeSettings(h: Home, settings: Line): void {
  mkdirSync(dirname(settingsFile(h)), { recursive: true });
  writeFileSync(settingsFile(h), `${JSON.stringify(settings, null, 2)}\n`);
}
/** Whether a hook command is DeepBuild's: it runs deep-hook, or the deep CLI (by its built file or as `deep`). */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
export interface Entry { event: string; group: number; index: number; matcher: unknown; hook: Line }
export function entries(settings: Line): Entry[] {
  const hooks = (settings.hooks ?? {}) as Record<string, Line[]>;
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group, g) =>
    (Array.isArray(group?.hooks) ? group.hooks : []).map((hook: Line, index: number) => ({ event, group: g, index, matcher: group.matcher, hook }))));
}
export const deepEntries = (settings: Line): Entry[] => entries(settings).filter((e) => isDeepBuild(e.hook.command));
/** DeepBuild's Stop entry that holds a stop: its one Stop entry that runs in the foreground. */
export function stopHoldEntry(settings: Line): Entry {
  const found = deepEntries(settings).filter((e) => e.event === 'Stop' && !e.hook.async && !e.hook.asyncRewake);
  if (found.length !== 1) throw Error(`setup must write one foreground Stop entry of DeepBuild's into ~/.claude/settings.json; found ${found.length}: ${JSON.stringify(found.map((e) => e.hook))}`);
  return found[0]!;
}
/** Sets DeepBuild's stop-hold entry's timeout, in seconds, as you would in an editor. */
export function setStopTimeout(h: Home, seconds: number): void {
  const settings = readSettings(h);
  const e = stopHoldEntry(settings);
  (settings.hooks[e.event][e.group].hooks[e.index] as Line).timeout = seconds;
  writeSettings(h, settings);
}
/** Your settings, <home>/.deepbuild/config.json, other keys kept. */
export function editConfig(h: Home, edit: (config: Line) => void): void {
  const file = join(rootOf(h.home), 'config.json');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  edit(config);
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
/** The login shell's PATH setup records, which the runner resolves its jobs' `claude` on (#159: runner.login_path). */
export function setLoginPath(h: Home, path: string): void {
  editConfig(h, (c) => { c.runner = { ...(c.runner as Line | undefined), login_path: path }; });
}
/** Claude Code's telemetry sent to DeepBuild's receiver, in the user settings' env block (#42's healthy item). */
export const TELEMETRY: Record<string, string> = {
  CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'none',
  OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
};

// ---- deep doctor --json: one doctor.item@1 (with item and agent) per line.
export interface DoctorItem { item?: string; agent?: string; code: string; level: string; evidence: string; fix: string }
export interface Doctored { ran: Ran; items: DoctorItem[]; calls: string[] }
/** `deep doctor --json <args>`; also the stand-in calls made while it ran. */
export async function doctor(h: Home, args: readonly string[] = [], o: { env?: Record<string, string | undefined> | undefined; cwd?: string | undefined; json?: boolean } = {}): Promise<Doctored> {
  const dirs = [h.bin, ...extraBins(h)];
  const before = dirs.map((d) => calls(d).length);
  const ran = await deep(h, ['doctor', ...(o.json === false ? [] : ['--json']), ...args], { env: o.env, cwd: o.cwd });
  const made = dirs.flatMap((d, i) => calls(d).slice(before[i]));
  return { ran, items: o.json === false ? [] : (jsonLines(ran.stdout) as DoctorItem[]), calls: made };
}
const extras = new Map<string, string[]>();
const extraBins = (h: Home) => extras.get(h.tmp) ?? [];
/** A second folder of stand-ins whose calls `doctor` also reports (AC11's second install, AC4's job binary). */
export function addBin(h: Home, dir: string): void {
  extras.set(h.tmp, [...extraBins(h), dir]);
}
/** Claude Code's test-prompt item: its `item` names the prompt (README: The test-prompt item). */
export const promptItem = (items: DoctorItem[]): DoctorItem | undefined => items.find((i) => i.agent === 'claude-code' && /prompt/i.test(i.item ?? ''));
export const itemText = (i: DoctorItem) => `${i.evidence ?? ''} ${i.fix ?? ''}`;
export const itemsShown = (items: DoctorItem[]) => items.map((i) => JSON.stringify(i)).join('\n');
export const notOk = (items: DoctorItem[]) => items.filter((i) => i.level !== 'ok');

// ---- The hub as a process: `deep hub run`, HOME the test's home (#16).
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; output(): string }
export async function startHub(h: Home, env: Record<string, string | undefined> = {}): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: h.work, env: childEnv(h, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  const plant = childEnv(h, env).DEEP_HUB_PLANT;
  if (!ready) throw Error(`BLOCKED: the hub didn't start${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, socket: join(rootOf(h.home), 'hub.sock'), root: rootOf(h.home), child, output: () => out };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(20);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  while (alive(hub.pid)) await sleep(20);
}

// ---- The line protocol (#16): a cli connection with the control token.
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private wakers = new Set<() => void>();
  private ids = 0;
  ended = false;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    sock.on('error', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
    sock.on('close', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
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
  async hello(token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
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
export async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
export function allEvents(hub: Hub): Promise<Ev[]> {
  return control(hub, async (conn) => {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  });
}
export const health = (hub: Hub): Promise<Line> => control(hub, (conn) => conn.call('hub.health'));
/** The kinds a hook itself maps to: a hook's own events are never a reading. */
const HOOK_KINDS = new Set(['session.start', 'session.end', 'user.ask', 'tool.before', 'tool.after', 'permission.request', 'agent.stop', 'task.completed']);
/** What the hub shows (its `hub.health` answer, and every event in its log that isn't a hook's own), each as JSON text. */
export async function readingTexts(hub: Hub): Promise<string[]> {
  const [hl, events] = await Promise.all([health(hub), allEvents(hub)]);
  return [JSON.stringify(hl), ...events.filter((e) => !HOOK_KINDS.has(e.kind)).map((e) => JSON.stringify({ kind: e.kind, subject: e.subject, session: e.session, data: e.data }))];
}
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(200);
  }
}
export async function eventually(probe: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}
export const count = (text: string, needle: string) => text.split(needle).length - 1;

// ---- The session stand-in (fixtures/session.mjs): one Claude Code session's process.
export interface Session { id: string; cwd: string; transcript: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private rpc = 0;
  private constructor(private readonly child: ChildProcess, readonly h: Home) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the session stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  static start(h: Home, env: Record<string, string | undefined> = {}): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'session.mjs'), CLI, FACTS], { cwd: h.tmp, env: childEnv(h, env), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Claude(child, h);
  }
  private send(command: Line, timeoutMs = 300_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the session stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the session stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  async hook(event: string, body: Line): Promise<Line> {
    return this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.h) });
  }
  async request(method: string, params: Line = {}, timeoutMs = 60_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async notify(method: string, params: Line = {}): Promise<void> {
    await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method, params } });
  }
}
export function newSession(h: Home, cwd = h.work): Session {
  const id = randomUUID();
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
/** A Claude Code session starting in `cwd`: its SessionStart through every entry of your settings, then its own deep mcp. */
export async function startSession(h: Home, cwd = h.work): Promise<{ claude: Claude; s: Session }> {
  const claude = Claude.start(h, { CLAUDE_PROJECT_DIR: cwd });
  const s = newSession(h, cwd);
  await claude.hook('SessionStart', { session_id: s.id, transcript_path: s.transcript, cwd, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-haiku-4-5' });
  const reply = await claude.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-19-doctor', version: '0' } });
  if (!reply.result) throw Error(`BLOCKED: the session's deep mcp refused initialize: ${JSON.stringify(reply)}`);
  await claude.notify('notifications/initialized');
  return { claude, s };
}

// ---- The world where every item is ok (README: Every item ok).
export interface World { h: Home; hub?: Hub; session?: { claude: Claude; s: Session } }
export interface WorldOptions {
  /** DEEP_HUB_PLANT on every process the world starts. */
  plant?: string;
  /** Claude Code's telemetry configured for the receiver (#42's healthy item); default on. */
  telemetry?: boolean;
  /** Your settings before setup, beside the telemetry env block (another tool's hooks, say). */
  before?: (settings: Line, h: Home) => void;
  /** With the hub stopped, after setup: an edit of yours (a timeout, a removed entry, a repo's settings). */
  after?: (h: Home) => void;
  /** Leave the hub stopped after `after` (the watch would put a removed entry back). */
  hubDown?: boolean;
  /** No session started after setup. */
  noSession?: boolean;
}
/**
 * The world where every doctor item is ok: you signed in to Claude Code and Codex with covered versions, one
 * `claude` that your sessions and DeepBuild's jobs both run, no billing key or nesting variable, Claude Code's
 * telemetry sent to the receiver, a sign-in token that outlives any run, DeepBuild set up by `deep setup` with a hub
 * running, and one session started since, whose SessionStart reached the hub through DeepBuild's entry and whose
 * deep mcp is connected.
 */
export async function world(o: WorldOptions = {}): Promise<World> {
  const h = makeHome();
  if (o.plant) h.env.DEEP_HUB_PLANT = o.plant;
  const settings: Line = o.telemetry === false ? {} : { env: { ...TELEMETRY } };
  o.before?.(settings, h);
  writeSettings(h, settings);
  const first = await startHub(h);
  await cargoBuild(false);
  const set = await deep(h, ['setup']);
  if (set.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 in the stand-in home: ${shown(set)}`);
  await ensureBinaries(readSettings(h));
  await stopHub(first);
  setLoginPath(h, pathFor(h));
  o.after?.(h);
  if (o.hubDown) return { h };
  const hub = await startHub(h);
  const w: World = { h, hub };
  if (!o.noSession) w.session = await startSession(h);
  return w;
}
/** Every file under `dir` with its size and modification time, for a check that nothing was written. */
export function tree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.set(p, `${st.size}:${st.mtimeMs}`);
    }
  };
  walk(dir);
  return out;
}
export const uuid = () => randomUUID();
export const tagged = tag;
