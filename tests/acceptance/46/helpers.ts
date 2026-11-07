// Tools for #46's acceptance tests (README: The world). Adapted from tests/acceptance/27/helpers.ts,
// tests/acceptance/83/helpers.ts and tests/acceptance/29/h-d.ts (same repo, same license); this suite keeps its own copy
// so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild: the hub is `deep hub run`, the
// hooks are deep-hook as `deep setup` installs them, run by the Claude Code stand-in (fixtures/claude.mjs), the repos are
// real git repositories under a temp folder, and GitHub is the fixture forge (forge.ts), real HTTP on 127.0.0.1.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';
import { FixtureForge, type Status } from './forge.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const FACTS = join(REPO, 'adapters/claude-code.facts.json');
const NODE = process.execPath;

// Each criterion's ID, as scripts/proof-change.mjs computes it from the issue's text.
export const AC1 = 'AC1 #46.e08142a9';
export const AC2 = 'AC2 #46.9325142d';
export const AC3 = 'AC3 #46.ac8aa097';
export const AC4 = 'AC4 #46.91d94362';
export const AC5 = 'AC5 #46.37377a09';
export const AC6 = 'AC6 #46.0056730f';
export const AC7 = 'AC7 #46.6cfd00c5';
export const AC8 = 'AC8 #46.dd80e30a';
export const AC9 = 'AC9 #46.50c5a8a8';
export const AC10 = 'AC10 #46.5d0044f9';
export const AC11 = 'AC11 #46.dfe059cf';

/** The issue's context, and the names every world uses. */
export const CONTEXT = 'deepbuild/verdict';
export const SHOP = 'acme/shop';
export const YOU = 'maya';
export const STRANGER = 'dev-x';
/** How long a status may take to land in a functional test; the 5 s budget is AC8's, on the reference Mac. */
export const STATUS_WAIT = 30_000;
/** How long a test waits to say nothing was posted: past the 5 s budget. */
export const QUIET_MS = 6000;
/** How long the hub may take to read a push from the forge (README: The surface, the hub's reads). */
export const READ_WAIT = 90_000;

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
const tag = (n = 6) => randomBytes(n).toString('hex');
const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- Verdicts of a scenario: a judgement throws an Error naming what it saw; BLOCKED is thrown on, never read as a plant's failure.
export class Inconclusive extends Error {}
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}
/** The message a scenario throws on a planted program, or null when it holds. A BLOCKED setup is thrown on, as is a plant the hub doesn't list. */
export async function failureOf(judge: () => Promise<unknown>): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Inconclusive || message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}

// ---- Temp folders and processes. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh46-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const groups = new Set<number>();
const forges: FixtureForge[] = [];
const own = (pid: number | undefined): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
  return !/Z/.test(spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '');
}
/** Stops every process this suite started, by PID and by the process groups it started, closes the forges and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pgid of groups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  groups.clear();
  await Promise.all(forges.splice(0).map((f) => f.close()));
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- A home. `<tmp>/h` is HOME for every process; `<tmp>/bin` comes first on PATH with stand-ins for launchctl, systemctl and claude.
export interface Checkout { label: string; root: string; cli: string; hook: string }
export const CURRENT: Checkout = { label: 'this checkout', root: REPO, cli: join(REPO, 'packages/cli/dist/main.js'), hook: join(REPO, 'target/debug/deep-hook') };
interface Home { tmp: string; home: string; bin: string; co: Checkout }
function makeHome(co: Checkout): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl', 'claude']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${co.cli}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, co };
}
const rootOf = (h: Home) => join(h.home, '.deepbuild');
const settingsFile = (h: Home) => join(h.home, '.claude', 'settings.json');
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** What a child gets: HOME the test's home, the stand-ins first on PATH, none of this process's DEEP_, CLAUDE*, CODEX*, GIT_ or OTEL_ settings or tokens, and pushes recorded as `FORGE_ACTOR`. */
function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|OTEL_|GH_|GITHUB_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${h.bin}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, DEEP_HUB_TEST_CONFIRM: join(h.tmp, 'confirm'), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', FORGE_ACTOR: YOU,
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
interface Ran { code: number | null; stdout: string; stderr: string }
function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), o.timeoutMs ?? 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- The hub as a process, and its socket's line protocol (#16).
interface Hub { pid: number; socket: string; root: string; output(): string }
async function startHub(h: Home, env: Record<string, string | undefined>, plant: string | undefined): Promise<Hub> {
  const child: ChildProcess = spawn(NODE, [h.co.cli, 'hub', 'run'], { cwd: h.co.root, env: childEnv(h, { ...env, DEEP_HUB_PLANT: plant, DEEP_HUB_TEST_VERDICT: '1' }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready) throw Error(`BLOCKED: the hub (${h.co.label}) didn't start${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''}: ${out.slice(0, 2000)}`);
  return { pid: child.pid!, socket: join(rootOf(h), 'hub.sock'), root: rootOf(h), output: () => out };
}
async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}
class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private readonly wakers = new Set<() => void>();
  private ids = 0;
  private ended = false;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? {});
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    const end = () => { this.ended = true; for (const w of [...this.wakers]) w(); };
    sock.on('error', end);
    sock.on('close', end);
  }
  static async open(path: string): Promise<Conn> {
    const conn = new Conn(net.connect(path));
    if (!await conn.wait(() => true, 0, 5000)) throw Error(`can't reach the hub at ${path}`);
    return conn;
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
    if (reply?.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
  }
  async call(method: string, params: unknown, timeoutMs = 30_000): Promise<Line> {
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
async function control<T>(hub: Hub, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string, everyMs = 100): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() >= deadline) throw Error(`no ${what} within ${timeoutMs} ms`);
    await sleep(everyMs);
  }
}

// ---- The Claude Code stand-in, one per session.
interface HookRun { command: string; async: boolean; asyncRewake: boolean; pid: number; session: string; ended: number | null; code: number | null; stdout: string; stderr: string }
interface Fired { ran: HookRun[]; background: HookRun[]; blocked?: string }
export interface Wake { session: string; at: number; stderr: string; prompt?: string; fired?: Fired }
const isDeepBuild = (command: unknown): boolean => typeof command === 'string' && /deep-hook|\bdeep\b/.test(command);
class Claude {
  private n = 0;
  private rpc = 0;
  private initialized = false;
  private readonly pending = new Map<number, (line: Line) => void>();
  readonly wakes: Wake[] = [];
  private constructor(private readonly child: ChildProcess, private readonly h: Home) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (typeof line?.n === 'number') this.pending.get(line.n)?.(line);
      else if (line?.wake) this.wakes.push(line.wake as Wake);
    });
  }
  static start(h: Home): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), h.co.cli, FACTS], { cwd: h.tmp, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Claude(child, h);
  }
  private send(command: Line, timeoutMs = 600_000): Promise<Line> {
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
  async hook(event: string, body: Line): Promise<Fired> {
    const fired = (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.h) })) as unknown as Fired;
    for (const r of [...fired.ran, ...fired.background]) groups.add(r.pid);
    return fired;
  }
  exec(command: string, cwd: string): Promise<Line> { return this.send({ op: 'exec', command, cwd }); }
  async waiters(session: string): Promise<HookRun[]> {
    return ((await this.send({ op: 'background' })).background as HookRun[]).filter((r) => r.asyncRewake && isDeepBuild(r.command) && r.session === session && r.ended === null);
  }
  private async request(method: string, params: Line, timeoutMs = 120_000): Promise<Line> {
    const id = `${method}#${++this.rpc}`;
    const r = await this.send({ op: 'mcp', line: { jsonrpc: '2.0', id, method, params }, timeoutMs }, timeoutMs + 5000);
    own(r.pid as number);
    return r.reply as Line;
  }
  async mcpCall(name: string, args: Line): Promise<Line> {
    if (!this.initialized) {
      const reply = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-46', version: '0' } });
      if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
      await this.send({ op: 'mcp', line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
      this.initialized = true;
    }
    return this.request('tools/call', { name, arguments: args });
  }
  quit(): void { try { this.child.stdin!.write(`${JSON.stringify({ n: ++this.n, op: 'exit' })}\n`); } catch { /* gone */ } }
}

// ---- The world: a fixture forge holding acme/shop, a real hub and `deep setup`'s hooks.
/** The prompt every session types: it names the push, so the push the session makes is one the ask covers, and it has a definition handed for it. */
export const PROMPT = 'Fix the cart total and push it.';
/** A question you typed: it opens no task, so its stop goes through and the session is idle with nothing owed (AC7). */
export const QUESTION = 'Explain how the cart total is computed.';
/** A later prompt of a session, with its own handed definition: AC10's commit and push of what the first turn left uncommitted. */
export const PUSH_PROMPT = 'Commit that and push it.';
/** The branch the repo's `npm test` script pushes to, from a child process no hook sees (AC11). */
export const SCRIPT_PUSHES = 'feature';
const CHECK = '.deepbuild/checks/total.sh';
const SUITE = '.deepbuild/checks/total.test.mjs';
const SEED: Record<string, string> = {
  'README.md': '# shop\n',
  'src/total.ts': 'export const total = (n: number) => n * 1.07;\n',
  'src/other.ts': 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n',
  'package.json': `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: `sleep 1 && git push -q origin HEAD:refs/heads/${SCRIPT_PUSHES} && sleep 1` } }, null, 2)}\n`,
  [CHECK]: `#!/bin/sh\nnode --test ${SUITE}\n`,
  [SUITE]: "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\ntest('the total uses the new rate', () => {\n  assert.match(readFileSync('src/total.ts', 'utf8'), /1\\.08/);\n});\n",
};
const REQUIREMENT = { id: 'R1', text: 'the total uses the new rate', source_line: 'ask#L1', refuted_by: 'a run where the total keeps the old rate', check: CHECK, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [] };
export type Rule = 'on' | 'off' | null;
export interface WorldOptions {
  rule?: Rule; visibility?: 'private' | 'public'; yours?: string[]; plant?: string; co?: Checkout;
  /** live.test.ts alone: the real GitHub and a test repo in place of the fixture forge and its seed. */
  live?: { repo: string; token: string };
}

/** Runs git as `actor`'s machine does: the actor the forge records, and the identity the commits carry. */
function gitAs(h: Home, cwd: string, args: readonly string[], actor: string, author = actor): string {
  const r = spawnSync('git', ['-c', `user.name=${author}`, '-c', `user.email=${author}@example.invalid`, '-c', 'commit.gpgsign=false', ...args], { cwd, env: childEnv(h, { FORGE_ACTOR: actor }), encoding: 'utf8' });
  if (r.status !== 0) throw Error(`BLOCKED: git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export class World {
  private constructor(readonly h: Home, readonly forge: FixtureForge, readonly bare: string, readonly hub: Hub, private readonly name: string, readonly live: boolean) {}
  /** The world: acme/shop with SEED on main, pushed by you; `github` in your settings (README: The surface); the hub, and `deep setup` run against it. */
  static async start(o: WorldOptions = {}): Promise<World> {
    const co = o.co ?? CURRENT;
    for (const [what, path] of [['the deep CLI (npm run build --workspaces)', co.cli], ['deep-hook (cargo build -p deep-hook)', co.hook]] as const) {
      if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
    }
    const h = makeHome(co);
    const forge = await FixtureForge.start(h.tmp);
    forges.push(forge);
    const bare = o.live ? `https://x-access-token:${o.live.token}@github.com/${o.live.repo}.git` : forge.repo(SHOP, { private: (o.visibility ?? 'private') === 'private' });
    if (!o.live) {
      const seed = join(h.tmp, 'seed');
      gitAs(h, h.tmp, ['clone', '-q', bare, seed], YOU);
      gitAs(h, seed, ['checkout', '-q', '-b', 'main'], YOU);
      for (const [path, text] of Object.entries(SEED)) {
        mkdirSync(dirname(join(seed, path)), { recursive: true });
        writeFileSync(join(seed, path), text);
      }
      chmodSync(join(seed, CHECK), 0o755);
      gitAs(h, seed, ['add', '-A'], YOU);
      gitAs(h, seed, ['commit', '-q', '-m', 'Start the shop'], YOU);
      gitAs(h, seed, ['push', '-q', 'origin', 'main'], YOU);
    }
    mkdirSync(rootOf(h), { recursive: true, mode: 0o700 });
    writeFileSync(join(h.tmp, 'drafts.json'), JSON.stringify({ drafts: [PROMPT, PUSH_PROMPT].map((ask) => ({ ask, requirements: [REQUIREMENT], deliverables: ['src/total.ts'], budget: null })) }));
    writeFileSync(join(h.tmp, 'work.json'), JSON.stringify({ readings: [] }));
    const hub = await startHub(h, { DEEP_HUB_TEST_FORGE: o.live ? 'https://api.github.com' : forge.url, GH_TOKEN: o.live?.token ?? 'test-gate-token', DEEP_HUB_TEST_DRAFTS: join(h.tmp, 'drafts.json'), DEEP_HUB_TEST_WORK: join(h.tmp, 'work.json') }, o.plant);
    const set = await run(NODE, [co.cli, 'setup'], { cwd: h.tmp, env: childEnv(h) });
    if (set.code !== 0 || !existsSync(settingsFile(h))) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild's hooks: ${set.stdout}${set.stderr}`);
    const world = new World(h, forge, bare, hub, o.live?.repo ?? SHOP, o.live !== undefined);
    world.configure({ rule: o.rule === undefined ? 'on' : o.rule, yours: o.yours ?? [YOU] });
    return world;
  }
  /** Your settings, <home>/.deepbuild/config.json: `github.delivery` holds the repo's delivery rule, `github.yours` the accounts you named. */
  configure(o: { rule?: Rule; yours?: string[] }): void {
    const file = join(rootOf(this.h), 'config.json');
    const config = (existsSync(file) ? parseObject(readFileSync(file, 'utf8')) : undefined) ?? {};
    const github = (config.github ?? {}) as Line;
    if (o.rule !== undefined) github.delivery = o.rule === null ? {} : { [this.name]: o.rule };
    if (o.yours) github.yours = o.yours;
    writeFileSync(file, `${JSON.stringify({ ...config, github }, null, 2)}\n`);
  }
  /** Every event in the log, paged by log_pos through `events.read`. */
  events(): Promise<Ev[]> {
    return control(this.hub, async (conn) => {
      const out: Ev[] = [];
      for (let after = 0; ;) {
        const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
        if (!events.length) return out;
        out.push(...events);
        after = events.at(-1)!.log_pos;
      }
    });
  }
  /** The status a commit holds once one lands; a hub that never posts one fails naming the commit. */
  status(sha: string, timeoutMs = STATUS_WAIT): Promise<Status> {
    return waitFor(() => this.forge.latest(sha), timeoutMs, `commit status on ${sha}`);
  }
  verdictOn(sha: string, timeoutMs = 90_000): Promise<Ev> {
    return waitFor(async () => (await this.events()).find((e) => e.kind === 'verdict.made' && e.data.commit === sha), timeoutMs, `verdict.made on ${sha}`, 250);
  }
  /** The real gate's PASS on `sha`. The world's check passes by construction, so anything else is the world's, never a pass: on a Mac whose Node can't load under the check's sandbox the run is uncounted. */
  async gatePass(sha: string): Promise<Ev> {
    const verdict = await this.verdictOn(sha);
    if (verdict.data.outcome === 'PASS') return verdict;
    const runs = (await this.events()).filter((e) => e.kind === 'run.finished').map((e) => [e.data.outcome, e.data.findings]);
    throw Error(`BLOCKED: the world's check must pass on ${sha}, and its verdict is ${verdict.data.outcome}: ${JSON.stringify(verdict.data.reasons)}, runs ${JSON.stringify(runs)}`);
  }
  /** A clone of acme/shop for someone who isn't a session: pushes from it are recorded as `actor`, its commits authored as `author`. */
  outsider(actor: string, author: string = actor): Outsider {
    const dir = join(this.h.tmp, `o${tag(3)}`);
    gitAs(this.h, this.h.tmp, ['clone', '-q', this.bare, dir], actor, author);
    return new Outsider(this.h, dir, actor, author);
  }
  /** A session in a clone of its own, on `branch` (made from main when the forge has none): SessionStart and the prompt you typed. */
  async session(o: { branch?: string; prompt?: string } = {}): Promise<Worker> {
    const cwd = join(this.h.tmp, `w${tag(3)}`);
    gitAs(this.h, this.h.tmp, ['clone', '-q', this.bare, cwd], YOU);
    gitAs(this.h, cwd, ['config', 'user.name', YOU], YOU);
    gitAs(this.h, cwd, ['config', 'user.email', `${YOU}@example.invalid`], YOU);
    gitAs(this.h, cwd, ['config', 'commit.gpgsign', 'false'], YOU);
    const branch = o.branch ?? 'feature';
    gitAs(this.h, cwd, ['checkout', '-q', ...(this.tip(branch) ? [branch] : ['-b', branch])], YOU);
    const worker = new Worker(this, cwd, branch);
    await worker.begin(o.prompt ?? PROMPT);
    return worker;
  }
  /** What a branch holds on the forge, or an empty string. */
  tip(branch: string): string {
    return spawnSync('git', ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: this.bare, env: childEnv(this.h), encoding: 'utf8' }).stdout?.trim() ?? '';
  }
  /** Stops the hub and any stand-in early (a world in a budget run; cleanup does the rest). */
  stop(): Promise<void> { return stopHub(this.hub); }
}

export class Outsider {
  constructor(private readonly h: Home, readonly dir: string, private readonly actor: string, private readonly author: string) {}
  /** A commit of `files`, authored and committed as this clone's author, on `branch`, made from the forge's main or the branch as it stands. */
  commit(branch: string, files: Record<string, string>): string {
    gitAs(this.h, this.dir, ['fetch', '-q', 'origin'], this.actor, this.author);
    gitAs(this.h, this.dir, ['checkout', '-q', '-B', branch, 'origin/main'], this.actor, this.author);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(this.dir, path)), { recursive: true });
      writeFileSync(join(this.dir, path), text);
    }
    gitAs(this.h, this.dir, ['add', '-A'], this.actor, this.author);
    gitAs(this.h, this.dir, ['commit', '-q', '-m', `Change ${Object.keys(files).join(', ')}`], this.actor, this.author);
    return gitAs(this.h, this.dir, ['rev-parse', 'HEAD'], this.actor, this.author);
  }
  push(ref: string): void { gitAs(this.h, this.dir, ['push', '-q', 'origin', `HEAD:refs/heads/${ref}`], this.actor, this.author); }
}

export interface Claimed { claim: string; commit: string }
export type Outcome = 'PASS' | 'FAIL' | 'BLOCKED' | 'INVALID' | 'INCONCLUSIVE';
const callId = () => `toolu_${randomBytes(12).toString('hex')}`;

/** One Claude Code session on a clone of acme/shop, driven as Claude Code drives its hooks. */
export class Worker {
  readonly id = randomUUID();
  readonly claude: Claude;
  private readonly transcript: string;
  private prompt: string | undefined;
  constructor(private readonly w: World, readonly cwd: string, readonly branch: string) {
    this.claude = Claude.start(w.h);
    this.transcript = join(w.h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
  }
  private entry(value: Line): void {
    const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: this.id, cwd: this.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...value };
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  private payload(event: string, extra: Line = {}): Line {
    const base: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default' };
    if (this.prompt) base.prompt_id = this.prompt;
    if (event === 'SessionStart') { Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' }); delete base.prompt_id; }
    return { ...base, ...extra };
  }
  private assistant(content: Line[], stop_reason: string): void {
    this.entry({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content, stop_reason, usage: { input_tokens: 2, output_tokens: 10 } } });
  }
  /** SessionStart, a prompt you typed, and its definition's lock. */
  async begin(text: string): Promise<void> {
    await this.claude.hook('SessionStart', this.payload('SessionStart'));
    await this.typed(text);
    // A question opens no task, and a live repo holds no seed: its claims are planted on. Neither has a definition to wait for.
    if (this.w.live || text === QUESTION) return;
    await waitFor(async () => {
      const events = await this.w.events();
      const ask = events.find((e) => e.kind === 'user.ask' && e.session === this.id && e.data.text === text);
      const task = Array.isArray(ask?.data.tasks) ? String(ask!.data.tasks[0]) : undefined;
      return task !== undefined && events.some((e) => e.kind === 'definition.locked' && e.data.task_ref === task);
    }, 60_000, `definition locked for "${text}" in ${this.id}`, 250).catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  }
  /** A later prompt you typed: the session's next turn. */
  async typed(text: string): Promise<void> {
    this.prompt = randomUUID();
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    await this.claude.hook('UserPromptSubmit', this.payload('UserPromptSubmit', { prompt: text }));
  }
  /** One built-in tool call: its tool_use entry, PreToolUse, what the call does when the hook allows it, its tool_result entry, PostToolUse. */
  async tool(name: string, input: Line, effect: () => Promise<Line> | Line): Promise<{ call: string; response: Line }> {
    const call = callId();
    this.assistant([{ type: 'tool_use', id: call, name, input }], 'tool_use');
    const before = await this.claude.hook('PreToolUse', this.payload('PreToolUse', { tool_name: name, tool_input: input, tool_use_id: call }));
    const denied = before.ran.filter((r) => isDeepBuild(r.command) && (r.code === 2 || /"permissionDecision"\s*:\s*"deny"/.test(r.stdout)));
    if (denied.length) throw Error(`BLOCKED: ${name} ${JSON.stringify(input).slice(0, 200)} was denied: ${denied.map((r) => `${r.stdout}${r.stderr}`).join(' ').slice(0, 800)}`);
    const response = await effect();
    this.entry({ type: 'user', promptId: this.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.claude.hook('PostToolUse', this.payload('PostToolUse', { tool_name: name, tool_input: input, tool_use_id: call, tool_response: response }));
    return { call, response };
  }
  /** A Bash call as Claude Code runs one: the command is a child of this session, between its PreToolUse and PostToolUse. */
  async bash(command: string): Promise<{ call: string; stdout: string }> {
    const { call, response } = await this.tool('Bash', { command, description: command }, async () => {
      const r = await this.claude.exec(command, this.cwd);
      if (r.code !== 0) throw Error(`BLOCKED: \`${command}\` exited ${r.code}: ${String(r.stderr).slice(0, 800)}`);
      return { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false };
    });
    return { call, stdout: String(response.stdout) };
  }
  async read(path: string): Promise<void> {
    const file = join(this.cwd, path);
    const content = readFileSync(file, 'utf8');
    await this.tool('Read', { file_path: file }, () => ({ type: 'text', file: { filePath: file, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } }));
  }
  async edit(path: string, from: string, to: string): Promise<void> {
    const file = join(this.cwd, path);
    await this.tool('Edit', { file_path: file, old_string: from, new_string: to, replace_all: false }, () => {
      writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
      return { filePath: file, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false };
    });
  }
  /** The fix the handed definition's check passes on: the total's rate, read then edited through their tools. */
  async fix(): Promise<void> {
    await this.read('src/total.ts');
    await this.edit('src/total.ts', 'n * 1.07', 'n * 1.08');
  }
  head(): string { return gitAs(this.w.h, this.cwd, ['rev-parse', 'HEAD'], YOU); }
  /** A commit of everything in the worktree, made through the session's Bash call so the record holds it as the session's. */
  async commit(message = 'Change the shop'): Promise<string> {
    await this.bash(`git add -A && git commit -q -m '${message}'`);
    return this.head();
  }
  /** A commit of one new file, through the session's calls. */
  async commitFile(path: string, text = `${tag()}\n`): Promise<string> {
    await this.tool('Write', { file_path: join(this.cwd, path), content: text }, () => {
      mkdirSync(dirname(join(this.cwd, path)), { recursive: true });
      writeFileSync(join(this.cwd, path), text);
      return { type: 'create', filePath: join(this.cwd, path), content: text };
    });
    return this.commit(`Add ${path}`);
  }
  async push(ref = this.branch): Promise<{ call: string; command: string }> {
    const command = `git push -q origin HEAD:refs/heads/${ref}`;
    return { call: (await this.bash(command)).call, command };
  }
  /** The agent's last words and its Stop: the turn ends and the session goes idle, or the stop is judged. */
  async stop(said: string): Promise<Fired> {
    this.assistant([{ type: 'text', text: said }], 'end_turn');
    return this.claude.hook('Stop', this.payload('Stop', { stop_hook_active: false, last_assistant_message: said }));
  }
  /** A claim on `commit` through `deep_claim`, HEAD when none is named. */
  async claim(commit = this.head()): Promise<Claimed> {
    const reply = await this.claude.mcpCall('deep_claim', { task_ref: `task:${ulidLike()}`, attempt: 1, commit, scope: 'session', predictions: null });
    const m = /claim:([0-9A-Z]{26})/.exec(JSON.stringify(reply));
    if (!m) throw Error(`BLOCKED: deep_claim must answer with the claim's handle: ${JSON.stringify(reply).slice(0, 800)}`);
    return { claim: `claim:${m[1]}`, commit };
  }
  /** What the session leaves open, through `deep_open_item`, on its newest claim's task. */
  async openItem(text: string): Promise<void> { await this.claude.mcpCall('deep_open_item', { text }); }
  /** A verdict planted on a claim (`test.verdict`, the events the core's gate would append); returns its verdict.made. */
  async verdict(c: Claimed, outcome: Outcome): Promise<Ev> {
    const requirements = [{ req: 'req:01K74G0A1B2C3D4E5F6G7H8J9K#R1', outcome, check: 'unit', smallest: null, points_to: null }];
    const planted = await control(this.w.hub, (conn) => conn.call('test.verdict', { session: this.id, claim: c.claim, outcome, requirements }))
      .catch((e: Error) => { throw Error(`BLOCKED: the hub must serve test.verdict with DEEP_HUB_TEST_VERDICT=1: ${e.message}`); });
    return waitFor(async () => (await this.w.events()).find((e) => e.kind === 'verdict.made' && e.data.verdict === planted.verdict), 30_000, `the planted ${outcome} in the record`);
  }
  /** Idle: the turn ended and its background waiter waits. */
  async idle(): Promise<void> {
    await waitFor(async () => (await this.claude.waiters(this.id)).length > 0, 30_000, `the waiter of ${this.id}`, 200).catch((e: Error) => { throw Error(`BLOCKED: ${e.message}`); });
  }
  /** What the session heard from a wake: its turn's prompt and what that prompt's hooks added. */
  static heard(wake: Wake): string {
    return [wake.prompt ?? '', ...(wake.fired?.ran ?? []).filter((r) => isDeepBuild(r.command)).map((r) => r.stdout)].join('\n');
  }
}
const ulidLike = () => { const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; return Array.from({ length: 26 }, () => chars[Math.floor(Math.random() * 32)]).join(''); };

// ---- The reference-Mac gate, as tests/acceptance/27/helpers.ts has it: on battery or mains alike.
const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export interface Load { one: number; cores: number }
export const load = (): Load => ({ one: loadavg()[0]!, cores: availableParallelism() });
/** Why this machine's readings only count as readings, or null. */
function environmentProblem(loads: Load[]): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  if ([...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100) || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const worst = loads.reduce((a, b) => (b.one / b.cores > a.one / a.cores ? b : a), loads[0] ?? { one: 0, cores: 1 });
  if (worst.one > worst.cores) return `heavy contention: 1-minute load ${worst.one.toFixed(1)} on ${worst.cores} cores`;
  return null;
}
/** Skips the test as INCONCLUSIVE, printing why, when the machine's readings don't count; returns otherwise. */
export function inconclusiveIfLoaded(ctx: TestContext, loads: Load[], what: string): void {
  const problem = environmentProblem(loads);
  if (!problem) return;
  console.log(`INCONCLUSIVE (${problem}): ${what}`);
  ctx.skip(`INCONCLUSIVE (${problem}): ${what}`);
}
/** The design's rule for a timing result: PASS when all five are within the limit, FAIL when all are over it by more than the margin, else INCONCLUSIVE. */
export function judge(name: string, runs: number[], limit: number, unit: string): { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; text: string } {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const text = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} ${unit} against under ${limit} ${unit} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.every((r) => r < limit)) return { verdict: 'PASS', text };
  if (runs.every((r) => r > limit * (1 + margin))) return { verdict: 'FAIL', text };
  return { verdict: 'INCONCLUSIVE', text };
}
export function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}
export const median = (xs: readonly number[]): number => percentile(xs, 50);

// ---- The merge base's side, as tests/acceptance/27/helpers.ts builds it.
const gitHere = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
const sameAs = (sha: string, paths: string[]) => spawnSync('git', ['diff', '--quiet', sha, '--', ...paths], { cwd: REPO }).status === 0
  && gitHere('ls-files', '--others', '--exclude-standard', '--', ...paths) === '';
/** The merge base with origin/main, built: this checkout when its code is the base's, else a copy at /tmp/dh46-base-<sha12>, kept between runs. */
export async function mergeBase(): Promise<Checkout> {
  let sha: string;
  try { sha = gitHere('merge-base', 'HEAD', 'origin/main'); } catch (e) { throw Error(`BLOCKED: no merge base with origin/main to compare with: ${(e as Error).message.split('\n')[0]}`); }
  const label = `the merge base ${sha.slice(0, 12)}`;
  if (sameAs(sha, ['packages', 'crates', 'Cargo.toml', 'Cargo.lock', 'package.json', 'package-lock.json'])) return { ...CURRENT, label: `${label} (this checkout's own code)` };
  const dir = `/tmp/dh46-base-${sha.slice(0, 12)}`;
  const co = { label, root: dir, cli: join(dir, 'packages/cli/dist/main.js'), hook: join(dir, 'target/debug/deep-hook') };
  if (existsSync(join(dir, '.built'))) return co;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync('/bin/sh', ['-c', `git -C '${REPO}' archive ${sha} | tar -x -C '${dir}'`], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 });
  const step = async (what: string, command: string, args: string[], env: NodeJS.ProcessEnv = process.env) => {
    const r = await run(command, args, { cwd: dir, env, timeoutMs: 1_800_000 });
    if (r.code !== 0) throw Error(`BLOCKED: building ${label} for the comparison: ${what} failed: ${r.stderr.slice(-2000)}`);
  };
  if (gitHere('show', `${sha}:package-lock.json`) === readFileSync(join(REPO, 'package-lock.json'), 'utf8').trim()) {
    mkdirSync(join(dir, 'node_modules/@deepbuild'), { recursive: true });
    for (const entry of readdirSync(join(REPO, 'node_modules'))) if (entry !== '@deepbuild') symlinkSync(join(REPO, 'node_modules', entry), join(dir, 'node_modules', entry));
    for (const pkg of readdirSync(join(dir, 'packages'))) {
      const file = join(dir, 'packages', pkg, 'package.json');
      const name = existsSync(file) ? String((JSON.parse(readFileSync(file, 'utf8')) as Line).name ?? '') : '';
      if (name.startsWith('@deepbuild/')) symlinkSync(join(dir, 'packages', pkg), join(dir, 'node_modules/@deepbuild', name.slice('@deepbuild/'.length)));
    }
  } else {
    await step('npm ci', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund']);
  }
  await step('npm run build --workspaces', 'npm', ['run', 'build', '--workspaces']);
  if (sameAs(sha, ['crates', 'Cargo.toml', 'Cargo.lock']) && existsSync(CURRENT.hook)) {
    mkdirSync(join(dir, 'target/debug'), { recursive: true });
    copyFileSync(CURRENT.hook, co.hook);
    chmodSync(co.hook, 0o755);
  } else {
    await step('cargo build -p deep-hook', 'cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { ...process.env, CARGO_TARGET_DIR: join(dir, 'target') });
  }
  writeFileSync(join(dir, '.built'), `${sha}\n`);
  return co;
}
