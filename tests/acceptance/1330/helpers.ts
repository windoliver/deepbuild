// Test-side tools for #1330's acceptance tests (README): a world (a test home outside the temp folders, the hub as
// `deep hub run` on its installed root there, a git repo with an origin, the Claude Code stand-in on its login PATH,
// a planted key and rc file, and a TCP listener no approval names), the `deep start` commands as you run them, a
// desktop session's agent process for the callers that must be refused, and readings of the record. Nothing here
// stands in for the hub, deep-hook, git or the worktree; only the agent (fixtures/claude.mjs) is played.
//
// Safety: every folder is under /Users/Shared/dh1330-* (made here, removed at the end); HOME is that folder for every
// child, so no real ~/.claude, ~/.codex, ~/.ssh or ~/.deepbuild is read or written; the planted key is random text;
// processes are stopped by PID only: the hubs, their descendants and the stand-ins this suite started. No model, no
// sign-in, no network beyond 127.0.0.1.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** #342's desktop agent process: deep-hook runs and Bash commands as its children (imported, not copied). */
const AGENT_PROGRAM = fileURLToPath(new URL('../342/fixtures/agent.mjs', import.meta.url));
export const SECOND = 1000;

/** The criteria's IDs: `#1330.` and the first 8 hex digits of SHA-256 of each criterion's text, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1330.89d3f79e',
  2: 'AC2 #1330.9fc71a10',
  3: 'AC3 #1330.33af7183',
  4: 'AC4 #1330.0e898a6c',
  5: 'AC5 #1330.7c62dec2',
  6: 'AC6 #1330.ea16f151',
  7: 'AC7 #1330.cb616e31',
  8: 'AC8 #1330.88d51ada',
  9: 'AC9 #1330.7ab28245',
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('CODEX')) delete process.env[key];

// ---- Folders: a test home outside /tmp and /var/folders, since the sandbox under test lets writes reach the temp
// folders, and AC6's ~/.zshrc must be a file it holds.
const made: string[] = [];
function testHome(): string {
  if (!existsSync('/Users/Shared')) throw Error('BLOCKED: /Users/Shared is missing; the test home must be outside the temp folders the sandbox lets writes reach');
  const dir = realpathSync(mkdtempSync('/Users/Shared/dh1330-'));
  made.push(dir);
  if (!process.env.HOME?.startsWith('/Users/Shared/dh1330-')) process.env.HOME = dir;
  return dir;
}

// ---- Processes: stopped by PID only.
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
const commandOf = (pid: number): string => {
  try { return execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim(); } catch { return ''; }
};
function descendants(root: number): number[] {
  const table = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
  const out: number[] = [];
  const walk = (p: number): void => { for (const [pid, ppid] of table) if (ppid === p) { out.push(pid); walk(pid); } };
  walk(root);
  return out;
}
async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

// ---- git.
export function git(dir: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', ['-C', dir, '-c', 'user.name=dh1330', '-c', 'user.email=dh1330@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
export interface Worktree { path: string; head: string; branch: string }
export function worktrees(repo: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of git(repo, 'worktree', 'list', '--porcelain').trim().split('\n\n')) {
    const get = (k: string): string => block.split('\n').find((l) => l.startsWith(`${k} `))?.slice(k.length + 1) ?? '';
    out.push({ path: get('worktree'), head: get('HEAD'), branch: get('branch').replace(/^refs\/heads\//, '') });
  }
  return out;
}
export const realOr = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

// ---- The hub's line protocol, as the CLI role.
export class Client {
  private buffer = '';
  private readonly lines: Line[] = [];
  private ids = 0;
  private constructor(private readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        try { this.lines.push(JSON.parse(this.buffer.slice(0, i)) as Line); } catch { /* not a line */ }
        this.buffer = this.buffer.slice(i + 1);
      }
    });
    sock.on('error', () => undefined);
  }
  static async open(socket: string, root: string): Promise<Client> {
    const sock = net.connect(socket);
    await new Promise<void>((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
    const c = new Client(sock);
    await waitFor(() => c.lines.length > 0, 5000, "the hub's hello");
    sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token: readFileSync(join(root, 'control.token'), 'utf8').trim() })}\n`);
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

export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(100);
  }
}

// ---- The world.
const ASKS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** The hooks `deep setup` writes into Claude Code's user settings: deep-hook as the `claude-code` adapter, one entry per event. */
const HOOKS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd'];
const TOOL_HOOKS = new Set(['PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure']);
const hookGroups = (): Line => Object.fromEntries(HOOKS.map((h) => {
  const entry = { type: 'command', command: `exec '${DEEP_HOOK}' claude-code ${h}` };
  return [h, [TOOL_HOOKS.has(h) ? { matcher: '*', hooks: [entry] } : { hooks: [entry] }]];
}));
/** The newest Claude Code version the shipped facts cover: the version the stand-in reports. */
export function newestClaude(): string {
  const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
  return (facts.versions as string[]).at(-1)!;
}

export interface Hub { pid: number; socket: string; child: ChildProcess; exit: Promise<unknown>; stderr(): string }
export interface World {
  home: string; root: string; hub: Hub; client: Client; plant: string | undefined;
  repo: string; base: string; bin: string; loginPath: string;
  key: string; rc: string; rcText: string;
  /** A TCP listener on 127.0.0.1 that no approval names, and when each connection reached it. */
  listener: { host: string; port: number; connections: number[]; server: net.Server };
  agents: Set<ChildProcess>;
}
export interface WorldOptions {
  plant?: string;
  /** Claude Code's facts as this hub reads them (DEEP_HUB_TEST_FACTS): the shipped file changed by this function. */
  claudeFacts?: (facts: Line) => Line;
  /** Merged into Claude Code's user settings beside the hooks. */
  userSettings?: Line;
}
const worlds: World[] = [];

function laidOut(o: WorldOptions): Omit<World, 'hub' | 'client' | 'plant' | 'listener' | 'agents'> & { facts?: string } {
  const home = testHome();
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  copyFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), join(root, 'rules.json'));
  // The login shell's PATH: the stand-in's folder first, then Node's (npm), then the system's.
  const bin = join(home, 'bin');
  const loginPath = [bin, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: ASKS, runner: { login_path: loginPath } }, null, 2)}\n`);
  writeFileSync(join(home, 'confirm'), 'confirmed\n');
  for (const f of ['.zprofile', '.zshenv', '.bash_profile', '.profile']) writeFileSync(join(home, f), `export PATH="${loginPath}"\n`);
  const rcText = `# the test home's own .zshrc (${randomBytes(4).toString('hex')})\n`;
  writeFileSync(join(home, '.zshrc'), rcText);
  mkdirSync(join(home, '.ssh'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.ssh/id_ed25519'), `not a key: ${randomBytes(24).toString('hex')}\n`, { mode: 0o600 });
  // The stand-in, as `claude` on the login PATH: one file, Node's own path in its first line.
  mkdirSync(bin, { recursive: true });
  const program = readFileSync(join(FIXTURES, 'claude.mjs'), 'utf8').replace(/^#!.*\n/, `#!${NODE}\n`)
    .replace("'__VERSION__'", JSON.stringify(newestClaude())).replace("'__LOGDIR__'", JSON.stringify(join(home, '.standin')));
  writeFileSync(join(bin, 'claude'), program, { mode: 0o755 });
  // Claude Code's user settings, with DeepBuild's hooks as setup writes them.
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude/settings.json'), `${JSON.stringify({ ...(o.userSettings ?? {}), hooks: hookGroups() }, null, 2)}\n`);
  let facts: string | undefined;
  if (o.claudeFacts) {
    facts = join(home, 'facts');
    mkdirSync(facts);
    for (const f of readdirSync(join(REPO, 'adapters')).filter((n) => n.endsWith('.facts.json'))) {
      const text = readFileSync(join(REPO, 'adapters', f), 'utf8');
      writeFileSync(join(facts, f), f === 'claude-code.facts.json' ? `${JSON.stringify(o.claudeFacts(JSON.parse(text) as Line), null, 2)}\n` : text);
    }
  }
  const origin = join(home, 'origin.git');
  const repo = join(home, 'src', 'shop');
  mkdirSync(repo, { recursive: true });
  git(home, 'init', '-q', '--bare', '-b', 'main', origin);
  return { home, root, repo, base: '', bin, loginPath, key: join(home, '.ssh/id_ed25519'), rc: join(home, '.zshrc'), rcText, ...(facts ? { facts } : {}) };
}

/** Every child's environment: the test home, the login PATH, and only the test variables named. */
export function envFor(w: Pick<World, 'home' | 'loginPath'>, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: w.home, PATH: `${w.loginPath}:${process.env.PATH ?? ''}`, SHELL: '/bin/zsh', LC_ALL: 'C' };
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete env[k]; else env[k] = v; }
  return env;
}

async function runHub(w: Pick<World, 'home' | 'root' | 'loginPath'>, plant: string | undefined, facts: string | undefined): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], {
    cwd: w.home, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: envFor(w, { DEEP_HUB_PLANT: plant, DEEP_HUB_TEST_CONFIRM: join(w.home, 'confirm'), DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9', DEEP_HUB_TEST_FACTS: facts }),
  });
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise((resolve) => child.on('exit', resolve));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) { try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); } }
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (ready?.ready !== true) {
    if (child.pid && alive(child.pid)) try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ }
    throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start (a hub that doesn't list a plant refuses to start): ${err.slice(-800)}`);
  }
  return { pid: child.pid!, socket: String(ready.socket), child, exit, stderr: () => err };
}

/** A world: the home laid out, the repo committed and pushed to its origin, the listener up, the hub on it. */
export async function openWorld(o: WorldOptions = {}): Promise<World> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook (cargo build --locked -p deep-hook) is not built at ${DEEP_HOOK}`);
  if (!existsSync('/usr/bin/sandbox-exec')) throw Error('BLOCKED: /usr/bin/sandbox-exec is missing; the stand-in agent enforces its sandbox with Seatbelt (macOS only)');
  const l = laidOut(o);
  const server = net.createServer((s) => { listener.connections.push(Date.now()); s.destroy(); });
  const listener = { host: '127.0.0.1', port: 0, connections: [] as number[], server };
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  listener.port = (server.address() as net.AddressInfo).port;
  const files: Record<string, string> = {
    'README.md': 'a sample shop\n',
    'package.json': `${JSON.stringify({ name: 'shop', version: '1.0.0', private: true, scripts: { test: 'node probe.mjs' } }, null, 2)}\n`,
    'probe.mjs': readFileSync(join(FIXTURES, 'probe.mjs'), 'utf8'),
    'probe-config.json': `${JSON.stringify({ key: l.key, rc: l.rc, host: listener.host, port: listener.port })}\n`,
    // npm's cache and logs out of the home: what a repo's build needs, kept to the temp folder and the worktree.
    '.npmrc': 'update-notifier=false\nfund=false\naudit=false\nlogs-max=0\ncache=/tmp/dh1330-npm-cache\n',
    // Only the probe's reports are ignored: probe-config.json is committed, so a worktree from origin/main has it.
    '.gitignore': 'probe-in.json\nprobe-out.json\n',
  };
  for (const [path, text] of Object.entries(files)) writeFileSync(join(l.repo, path), text);
  git(l.repo, 'init', '-q', '-b', 'main');
  git(l.repo, 'add', '-A');
  git(l.repo, 'commit', '-q', '-m', 'the sample');
  git(l.repo, 'remote', 'add', 'origin', join(l.home, 'origin.git'));
  git(l.repo, 'push', '-q', '-u', 'origin', 'main');
  const base = git(l.repo, 'rev-parse', 'origin/main').trim();
  const hub = await runHub(l, o.plant, l.facts);
  const w: World = { ...l, base, hub, client: await Client.open(hub.socket, l.root), plant: o.plant, listener, agents: new Set() };
  worlds.push(w);
  return w;
}

/** Everything a world left: its stand-ins and agent processes, its hub and what the hub started, by PID; then its home. */
export async function closeWorld(w: World): Promise<void> {
  w.client.close();
  const pids = new Set<number>(descendants(w.hub.pid));
  for (const s of standIns(w)) if (alive(s.pid) && commandOf(s.pid).includes(w.home)) pids.add(s.pid);
  for (const a of w.agents) if (a.pid) pids.add(a.pid);
  pids.add(w.hub.pid);
  await stopPids([...pids]);
  for (const s of standIns(w)) if (alive(s.pid) && commandOf(s.pid).includes(w.home)) await stopPids([s.pid]);
  w.listener.server.close();
}
afterAll(async () => {
  for (const w of worlds.splice(0)) await closeWorld(w);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 120_000);

// ---- `deep` as you run it in your terminal: the test home, outside any agent's process tree.
export interface Ran { code: number | null; stdout: string; stderr: string; out: Line | undefined }
/** The last line of stdout that parses as a JSON object. */
export function jsonOut(stdout: string): Line | undefined {
  for (const line of stdout.trim().split('\n').reverse()) {
    try { const v = JSON.parse(line) as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) return v as Line; } catch { /* not JSON */ }
  }
  return undefined;
}
export function deep(w: World, args: string[], o: { cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd: o.cwd ?? w.home, env: envFor(w), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, o.timeoutMs ?? 180_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, out: jsonOut(stdout) }); });
  });
}
export const shown = (r: Pick<Ran, 'code' | 'stdout' | 'stderr'>): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1200))}, stderr ${JSON.stringify(r.stderr.slice(-1200))}`;

// ---- Approvals (README, The surface under test).
export interface Bounds {
  issues: number[]; agents: string[]; atOnce: number; planShare: number;
  modes?: Record<string, string>; homes?: Record<string, string>; until?: Date; hosts?: string[];
}
export function approveArgs(w: World, b: Bounds): string[] {
  const homes = b.homes ?? Object.fromEntries(b.agents.filter((a) => a === 'claude-code').map((a) => [a, join(w.home, '.claude')]));
  return [
    'start', 'approve', '--repo', w.repo, '--issues', b.issues.join(','), '--agents', b.agents.join(','),
    ...Object.entries(homes).flatMap(([a, h]) => ['--home', `${a}=${h}`]),
    ...Object.entries(b.modes ?? {}).flatMap(([a, m]) => ['--mode', `${a}=${m}`]),
    '--at-once', String(b.atOnce), '--plan-share', String(b.planShare),
    ...(b.until ? ['--until', b.until.toISOString()] : []),
    ...(b.hosts ?? []).flatMap((h) => ['--host', h]),
    '--json',
  ];
}
const mentions = (value: unknown, id: string): boolean => {
  const text = JSON.stringify(value).toLowerCase();
  return text.includes(id.toLowerCase()) || text.includes(id.replace(/-/g, '').toLowerCase());
};
export { mentions };
/** `deep start approve`: the authority ask it raises, open, and its `ask.created` event. */
export async function requestApproval(w: World, b: Bounds): Promise<{ handle: string; created: Line }> {
  const r = await deep(w, approveArgs(w, b));
  expect(r.code, `deep start approve exits 0 with the ask it raised (${shown(r)})`).toBe(0);
  const handle = r.out?.ask;
  expect(typeof handle === 'string' && handle.startsWith('ask:'), `deep start approve --json prints { ask: "ask:<id>" }: ${JSON.stringify(r.out)}`).toBe(true);
  const id = String(handle).slice(4);
  const created = await waitFor(async () => (await w.client.events('ask.created')).find((e) => e.id === id || e.data?.id === id || e.data?.handle === handle || mentions(e, id)), 15_000, `the ask.created event of ${handle}`);
  expect(created.data?.kind, `${handle} is an authority ask`).toBe('authority');
  return { handle: String(handle), created };
}
/** Your yes to the ask, on the trusted path: `deep inbox answer`, the OS confirming you (the hub's test stand-in for it). */
export async function answerYes(w: World, a: { handle: string; created: Line }): Promise<void> {
  const options = (a.created.data?.options ?? []) as { id: string; decision?: string }[];
  const yes = options.find((o) => o.decision === 'allow');
  expect(yes, `${a.handle} offers a yes (an option whose decision is allow): ${JSON.stringify(options)}`).toBeTruthy();
  const r = await deep(w, ['inbox', 'answer', a.handle, yes!.id]);
  expect(r.code, `deep inbox answer ${a.handle} ${yes!.id} exits 0 (${shown(r)})`).toBe(0);
}
export async function approve(w: World, b: Bounds): Promise<{ handle: string; created: Line }> {
  const a = await requestApproval(w, b);
  await answerYes(w, a);
  return a;
}

// ---- Starts.
export interface Start { issue: number; agent?: string; mode?: string; prompt?: string }
export const startArgs = (w: World, s: Start): string[] => [
  'start', '--repo', w.repo, '--issue', String(s.issue), '--agent', s.agent ?? 'claude-code',
  ...(s.mode ? ['--mode', s.mode] : []), '--prompt', s.prompt ?? 'Say ready.', '--json',
];
export const start = (w: World, s: Start): Promise<Ran> => deep(w, startArgs(w, s));
export function mustStart(r: Ran, what: string): { run: string; worktree: string; branch: string; out: Line } {
  expect(r.code, `${what}: deep start exits 0 (${shown(r)})`).toBe(0);
  expect(r.out?.status, `${what}: deep start --json says started: ${JSON.stringify(r.out)}`).toBe('started');
  expect(typeof r.out?.run === 'string' && r.out.run.length > 0, `${what}: it names the run: ${JSON.stringify(r.out)}`).toBe(true);
  expect(typeof r.out?.worktree === 'string', `${what}: it names the worktree: ${JSON.stringify(r.out)}`).toBe(true);
  return { run: r.out!.run as string, worktree: r.out!.worktree as string, branch: String(r.out!.branch ?? ''), out: r.out! };
}
export function mustRefuse(r: Ran, what: string): Line {
  expect(r.out?.status, `${what}: deep start --json says refused (${shown(r)})`).toBe('refused');
  expect(r.code, `${what}: a refused start exits non-zero (${shown(r)})`).not.toBe(0);
  expect(typeof r.out?.reason, `${what}: the refusal says why: ${JSON.stringify(r.out)}`).toBe('string');
  return r.out!;
}

// ---- The stand-in's own log (fixtures/claude.mjs): what each `claude` process saw and did.
export function standIns(w: Pick<World, 'home'>): Line[] {
  const dir = join(w.home, '.standin');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    try { return [JSON.parse(readFileSync(join(dir, f), 'utf8')) as Line]; } catch { return []; }
  });
}
/** The stand-in session started in the worktree: its log, once `done` holds (or at once, with `done` false). */
export function standInIn(w: World, worktree: string, o: { done?: boolean; ms?: number } = {}): Promise<Line> {
  const want = realOr(worktree);
  return waitFor(() => standIns(w).find((s) => realOr(String(s.cwd)) === want && !s.refused && (!o.done || s.done === true)), o.ms ?? 120_000,
    `the claude stand-in in ${worktree}${o.done ? ' to finish its turn' : ''} (stand-ins seen: ${JSON.stringify(standIns(w).map((s) => ({ cwd: s.cwd, argv: s.argv, done: s.done })))})`);
}
/** The record's events that name the session, oldest first. */
export async function eventsOfSession(w: World, session: string): Promise<Line[]> {
  return (await w.client.events()).filter((e) => mentions(e, session)).sort((a, b) => Number(a.log_pos) - Number(b.log_pos));
}

// ---- A session in your terminal, in Claude Code: its agent process, deep-hook and its Bash commands as children.
export class DesktopSession {
  readonly id = randomUUID();
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Line) => void>();
  readonly child: ChildProcess;
  readonly transcript: string;
  constructor(readonly w: World, readonly cwd: string) {
    this.child = spawn(NODE, [AGENT_PROGRAM, DEEP_HOOK], { cwd, env: envFor(w, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }), stdio: ['pipe', 'pipe', 'ignore'] });
    w.agents.add(this.child);
    this.child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const line = JSON.parse(this.buffer.slice(0, i)) as Line;
        this.buffer = this.buffer.slice(i + 1);
        this.pending.get(line.n as number)?.(line);
        this.pending.delete(line.n as number);
      }
    });
    this.child.stdin!.on('error', () => undefined);
    this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
  }
  private send(command: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve) => { this.pending.set(n, resolve); this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`); });
  }
  hook(event: string, fields: Line = {}): Promise<Line> {
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...fields };
    return this.send({ op: 'hook', args: ['claude-code', event], cwd: this.cwd, input: JSON.stringify(body) });
  }
  async start(): Promise<void> {
    appendFileSync(this.transcript, `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'look after the shop' }, uuid: randomUUID(), timestamp: new Date().toISOString(), cwd: this.cwd, sessionId: this.id, userType: 'external', entrypoint: 'cli' })}\n`);
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook's SessionStart ended with ${r.code}: ${String(r.stderr).slice(-400)}`);
    await this.hook('UserPromptSubmit', { prompt: 'look after the shop' });
  }
  /** One Bash tool call: PreToolUse, then the command as the agent's child whatever the hook said (the hub must refuse on its own), then PostToolUse. */
  async bash(command: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const tool_use_id = `toolu_${randomBytes(10).toString('hex')}`;
    const tool_input = { command, description: 'Run a command' };
    await this.hook('PreToolUse', { tool_name: 'Bash', tool_input, tool_use_id });
    const r = await this.send({ op: 'bash', command, cwd: this.cwd });
    await this.hook('PostToolUse', { tool_name: 'Bash', tool_input, tool_use_id, tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false } });
    return { code: r.code as number | null, stdout: String(r.stdout), stderr: String(r.stderr) };
  }
}
export const sh = (...words: string[]): string => words.map((w) => `'${w.replace(/'/g, `'\\''`)}'`).join(' ');

// ---- Planted programs.
/** One reading of a planted program: the message its scenario throws, or null when it holds. BLOCKED is thrown on, never read as the plant's failure. */
export async function failureOf(scenario: () => unknown): Promise<string | null> {
  try {
    await scenario();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}

// ---- Facts (README, The surface under test): `sandbox` in an agent's facts, each `walls` object under it naming
// `writes`, `credentials` and `network`.
const WALLS = ['writes', 'credentials', 'network'] as const;
export function wallObjects(node: unknown): Line[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(wallObjects);
  const o = node as Line;
  return [...(o.walls && typeof o.walls === 'object' && !Array.isArray(o.walls) ? [o.walls as Line] : []), ...Object.entries(o).filter(([k]) => k !== 'walls').flatMap(([, v]) => wallObjects(v))];
}
/** Whether the shipped Claude Code facts name all three walls somewhere under `sandbox`. */
export function shippedNamesAllWalls(): boolean {
  const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as Line;
  return wallObjects(facts.sandbox).some((w) => WALLS.every((k) => k in w));
}
/** The facts with no sandbox at all. */
export const withoutSandbox = (facts: Line): Line => { const { sandbox: _gone, ...rest } = facts; return rest; };
/** The facts with every `walls` object cut to the write wall alone. */
export function writesOnly(facts: Line): Line {
  const copy = JSON.parse(JSON.stringify(facts)) as Line;
  for (const walls of wallObjects(copy.sandbox)) for (const k of Object.keys(walls)) if (k !== 'writes') delete walls[k];
  return copy;
}
