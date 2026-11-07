// Test-side tools for #148's acceptance tests (README): a world (a temp HOME with your own agent files, the real agents
// on its login PATH, and `deep hub run` on its installed root), the hub's socket as the CLI and the app reach it, the
// `deep` CLI, the agents' own list commands, byte snapshots, a skill's source repository, and sessions played through
// the real deep-hook under processes of their own. Nothing here stands in for the hub, deep-hook or the agents: only
// MCP servers (fixtures/mcp-server.mjs), the OS secret store (a JSON file outside HOME), the OS confirming you, and
// the agents that aren't installed here (fixtures/stub.mjs) are played.
//
// Safety: every folder is under /tmp/dh148-*; HOME is a temp folder for every process started, so no real ~/.claude,
// ~/.codex, ~/.pi, ~/.deepbuild or Keychain is read or written; no child inherits this process's DEEP_*, CLAUDE*,
// CODEX*, PI_*, XDG_*, GIT_*, NODE_OPTIONS or billing keys; the agents run with their own offline switches; every
// process is stopped by its PID, never by name or port. Every token is a fake made per test.
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { cpus, loadavg } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, vi } from 'vitest';

// Every test starts real hubs and agents: Vitest's 5 s default stays out, under any root.
vi.setConfig({ testTimeout: 900_000, hookTimeout: 300_000 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const FIXTURES = join(SUITE, 'fixtures');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const SERVER = join(FIXTURES, 'mcp-server.mjs');
const AGENT = join(FIXTURES, 'agent.mjs');
const STUB = join(FIXTURES, 'stub.mjs');
export const NET_LOG_PRELOAD = join(FIXTURES, 'net-log.cjs');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text, trimmed, white space collapsed. */
export const AC = {
  1: 'AC1 #148.db662158', 2: 'AC2 #148.55a38c24', 3: 'AC3 #148.3f741c71', 4: 'AC4 #148.5e23d774', 5: 'AC5 #148.dedd4339',
  6: 'AC6 #148.cea55b43', 7: 'AC7 #148.a2efc551', 8: 'AC8 #148.090693c4', 9: 'AC9 #148.d24b369d', 10: 'AC10 #148.b1b5d323',
  11: 'AC11 #148.5ea00b01', 12: 'AC12 #148.51e021f8', 13: 'AC13 #148.36f090c8', 14: 'AC14 #148.f24103f9', 15: 'AC15 #148.930bb7b7',
  16: 'AC16 #148.9536f2a1', 17: 'AC17 #148.62546d1a',
} as const;

// The real agents, named by the variables a run sets (README, Run them). Read once, before any child environment is made.
const BIN_VARS = { claude: 'DEEP_CLAUDE_BIN', codex: 'DEEP_CODEX_BIN', pi: 'DEEP_PI_BIN' } as const;
const GIVEN = Object.fromEntries(Object.entries(BIN_VARS).map(([k, v]) => [k, process.env[v]])) as Record<keyof typeof BIN_VARS, string | undefined>;
export const SHOTS = process.env.DEEP148_SHOTS;

// ---- Judging.
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const tag = (n = 3) => randomBytes(n).toString('hex');
export const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
export const shown = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const parse = (raw: string): Line | undefined => { try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null ? v as Line : undefined; } catch { return undefined; } };
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Runs a check and returns why it failed, or null when it passed; a BLOCKED world is never a wrong program's failure. */
export async function failureOf(check: () => Promise<void>): Promise<string | null> {
  try {
    await check();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED')) throw error;
    return message;
  }
}
/** The planted wrong program must fail the criterion's check, and the failure must name `name`. */
export function failsNaming(failure: string | null, name: string, what: string): void {
  expect(failure, `${what}: the check passed on the planted wrong program`).not.toBeNull();
  expect(failure!.includes(name), `${what}: the check failed, but its failure doesn't name ${name}: ${failure!.slice(0, 2000)}`).toBe(true);
}
export const loadPerCore = (): number => loadavg()[0]! / cpus().length;

// ---- Temp folders and processes. Short real paths: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh148-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
export function own(pid: number | undefined): void { if (pid) owned.add(pid); }
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
const ours = (pid: number): boolean => {
  try {
    const c = execFileSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    return c.includes('/dh148-') || c.includes(CLI) || c.includes(FIXTURES) || c.includes(DEEP_HOOK);
  } catch { return false; }
};
/** Stops every process this file started, by PID and only while it still runs one of ours, and removes the folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) if (alive(pid) && ours(pid)) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid) && ours(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
/** Registers the cleanup after the file's tests. */
export function useCleanup(): void { afterAll(cleanup, 120_000); }

// ---- The environment every child gets.
const STRIPPED = /^(DEEP_|CLAUDE|CODEX|PI_|XDG_|GIT_|ANTHROPIC|OPENAI|AWS_|NODE_OPTIONS$|DEEP148_|FIXTURE_)/;
/** What each agent has to stay off the network (README, No network). */
const OFFLINE = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0',
};
export function childEnv(w: World, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!STRIPPED.test(k)) env[k] = v;
  Object.assign(env, OFFLINE, { HOME: w.home, PATH: w.path, LC_ALL: 'C', TMPDIR: w.tmp });
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; input?: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${e.message}`, ms: performance.now() - t0, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const ranText = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at its timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
export async function waitFor<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms: number, what: string, every = 100): Promise<T> {
  const deadline = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const v = await probe();
      if (v !== undefined && v !== false && v !== null) return v as T;
    } catch (error) { last = error; }
    if (Date.now() > deadline) throw Error(`timed out after ${ms} ms waiting for ${what}${last ? ` (last error: ${last instanceof Error ? last.message : String(last)})` : ''}`);
    await sleep(every);
  }
}

// ---- Facts: adapters/<agent>.facts.json, the agent ids this suite names (README, Agents).
export type AgentId = 'claude-code' | 'codex' | 'pi' | 'opencode' | 'cursor';
export function facts(id: AgentId): Line | undefined {
  const file = join(REPO, 'adapters', `${id}.facts.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Line : undefined;
}
export function factsOf(id: AgentId): Line {
  const f = facts(id);
  expect(f, `adapters/${id}.facts.json exists: ${id}'s rules and folders live in its facts`).toBeDefined();
  expect(Array.isArray(f!.versions) && f!.versions.length > 0, `adapters/${id}.facts.json names the versions it covers`).toBe(true);
  expect(typeof f!.agent, `adapters/${id}.facts.json names its binary in "agent"`).toBe('string');
  return f!;
}
export const newest = (id: AgentId): string => { const v = factsOf(id).versions as string[]; return v[v.length - 1]!; };

// ---- The real agents. A missing or uncovered one is BLOCKED, never a skip.
const REAL = { claude: 'claude-code', codex: 'codex', pi: 'pi' } as const;
let checked: Record<keyof typeof BIN_VARS, string> | undefined;
/** The version each real agent answered, by its facts' id. */
export const installed: Partial<Record<AgentId, string>> = {};
export function realAgents(): Record<keyof typeof BIN_VARS, string> {
  if (checked) return checked;
  const out = {} as Record<keyof typeof BIN_VARS, string>;
  const scratch = tempDir();
  for (const [bin, variable] of Object.entries(BIN_VARS) as [keyof typeof BIN_VARS, string][]) {
    const path = GIVEN[bin];
    if (!path || !existsSync(path)) throw Error(`BLOCKED: ${variable} must name the ${bin} command to run (README, Run them); it is ${path === undefined ? 'unset' : `${path}, which doesn't exist`}`);
    const r = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 60_000, env: { PATH: `${dirname(NODE)}:/usr/bin:/bin`, HOME: scratch, TMPDIR: scratch, ...OFFLINE } });
    const version = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(`${r.stdout ?? ''}`)?.[1];
    const covered = (facts(REAL[bin])?.versions ?? []) as string[];
    if (!version || !covered.includes(version)) throw Error(`BLOCKED: ${variable}=${path} answers --version with ${JSON.stringify((r.stdout ?? '').trim() || r.stderr)}, not a version adapters/${REAL[bin]}.facts.json covers (${covered.join(', ')})`);
    out[bin] = realpathSync(path);
    installed[REAL[bin]] = version;
  }
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook isn't built at ${DEEP_HOOK} (cargo build --locked -p deep-hook)`);
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI isn't built at ${CLI} (npm run build --workspaces)`);
  return (checked = out);
}

// ---- Your ask settings, as setup drafts them, with no batching: every ask shows when it's raised (#319's shape).
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};

// ---- A world.
export interface Hub { pid: number; socket: string; child: ChildProcess; exit: Promise<void>; stderr(): string }
export interface World {
  tmp: string; home: string; root: string; bin: string; path: string; work: string; logs: string; confirm: string; secrets: string;
  restarts: string; hub?: Hub | undefined;
}
/** Your own files, as each agent keeps them, written before anything of DeepBuild's (README, The world). */
export const MINE = 'mine';
export function yourClaudeJson(w: World): string {
  return `${JSON.stringify({ theme: 'dark', mcpServers: { [MINE]: { type: 'stdio', command: NODE, args: [SERVER, MINE, join(w.logs, `${MINE}.log`)], env: {} } } }, null, 2)}\n`;
}
export const YOUR_COMMENT = '# My Codex settings, written by hand: keep these lines.';
export function yourCodexToml(w: World): string {
  return [
    YOUR_COMMENT,
    'model = "gpt-reserve"',
    '',
    '# A server of mine, added by hand.',
    `[mcp_servers.${MINE}]`,
    `command = "${NODE}"`,
    `args = ["${SERVER}", "${MINE}", "${join(w.logs, `${MINE}.log`)}"]`,
    '',
  ].join('\n');
}
export function yourPiJson(w: World): string {
  return `${JSON.stringify({ mcpServers: { [MINE]: { command: NODE, args: [SERVER, MINE, join(w.logs, `${MINE}.log`)] } } }, null, 2)}\n`;
}
export const claudeJson = (w: World) => join(w.home, '.claude.json');
export const codexToml = (w: World) => join(w.home, '.codex', 'config.toml');
export const piJson = (w: World) => join(w.home, '.pi', 'agent', 'mcp.json');

function wrapper(path: string, version: string, record: string, real: string | undefined): void {
  writeFileSync(path, `#!/bin/sh\nexec '${NODE}' '${STUB}' '${version}' '${record}' '${real ?? '-'}' "$@"\n`);
  chmodSync(path, 0o755);
}
export interface WorldOptions {
  /** OpenCode and Cursor installed: their commands, named by their facts, answer their newest covered version. */
  opencode?: boolean; cursor?: boolean;
  /** Codex's command records `app-server daemon ...` instead of running it (AC16). */
  codexRestartRecorded?: boolean;
  /** Leave your agent files out (a world a backup is restored into still has them). */
}
/**
 * A temp HOME with your own Claude Code, Codex and pi files, the agents on the login PATH, the hub's installed root laid
 * out as setup leaves it (the shipped rules.json, your ask settings, the login PATH), and each agent run once so its
 * first-run writes are behind us. The hub isn't started.
 */
export async function makeWorld(o: WorldOptions = {}): Promise<World> {
  const agents = realAgents();
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const w: World = {
    tmp, home, root: join(home, '.deepbuild'), bin, path: `${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, work: join(tmp, 'work'), logs: join(tmp, 'logs'),
    confirm: join(tmp, 'confirm'), secrets: join(tmp, 'secrets.json'), restarts: join(tmp, 'restarts.jsonl'),
  };
  for (const d of [home, bin, w.work, w.logs, w.root, join(home, '.claude'), join(home, '.codex'), join(home, '.pi', 'agent')]) mkdirSync(d, { recursive: true });
  symlinkSync(agents.claude, join(bin, 'claude'));
  symlinkSync(agents.pi, join(bin, 'pi'));
  if (o.codexRestartRecorded) wrapper(join(bin, 'codex'), newest('codex'), w.restarts, agents.codex);
  else symlinkSync(agents.codex, join(bin, 'codex'));
  if (o.opencode) {
    wrapper(join(bin, String(factsOf('opencode').agent)), newest('opencode'), join(tmp, 'opencode.jsonl'), undefined);
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  }
  if (o.cursor) {
    wrapper(join(bin, String(factsOf('cursor').agent)), newest('cursor'), join(tmp, 'cursor.jsonl'), undefined);
    mkdirSync(join(home, '.cursor'), { recursive: true });
  }
  writeFileSync(join(w.root, 'rules.json'), readFileSync(join(REPO, 'crates/deep-hook/default-rules.json')));
  writeFileSync(join(w.root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: w.path } }, null, 2)}\n`);
  writeFileSync(w.confirm, 'confirmed\n');
  writeFileSync(w.secrets, '{}\n', { mode: 0o600 });
  writeFileSync(claudeJson(w), yourClaudeJson(w));
  writeFileSync(codexToml(w), yourCodexToml(w));
  writeFileSync(piJson(w), yourPiJson(w));
  // Each agent once, as you would have run it before: Claude Code writes its first-run keys into ~/.claude.json here.
  for (const [what, ran] of [['claude mcp list', await claudeList(w)], ['codex mcp list', (await codexList(w)).ran], ['pi mcp list', (await piList(w)).ran]] as const) {
    if (ran.code === null) throw Error(`BLOCKED: ${what} didn't run in the world: ${ranText(ran)}`);
  }
  return w;
}

// ---- The hub.
export interface HubOptions { plant?: string | undefined; vfs?: Line; env?: Record<string, string | undefined> }
/**
 * `deep hub run` on the world's installed root, with the test settings: the OS confirming you, no forge, the secret
 * store stand-in, and when given a plant, the test VFS and more environment. One that doesn't start is BLOCKED.
 */
export async function startHub(w: World, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(w, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9',
    DEEP_HUB_TEST_SECRETS: w.secrets,
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_VFS: o.vfs ? JSON.stringify(o.vfs) : undefined,
    ...o.env,
  });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parse(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  const hub: Hub = { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), child, exit, stderr: () => err };
  own(hub.pid);
  w.hub = hub;
  return hub;
}
export async function stopHub(w: World): Promise<void> {
  const hub = w.hub;
  if (!hub) return;
  w.hub = undefined;
  if (!alive(hub.pid)) return;
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  await Promise.race([hub.exit, sleep(30_000)]);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
}
/** The hub ended by itself, as a test VFS cut ends it (by SIGKILL, from inside). */
export async function hubEnded(w: World, ms: number, what: string): Promise<void> {
  const hub = w.hub!;
  await waitFor(() => !alive(hub.pid), ms, `the hub (pid ${hub.pid}) to end ${what}`, 50);
  w.hub = undefined;
}

/** One call on the hub's socket as the cli role, with the control token, as the CLI and the app make theirs. */
export function call(w: World, method: string, params: Line = {}, timeoutMs = 60_000): Promise<Line> {
  const hub = w.hub;
  if (!hub) return Promise.reject(Error(`no hub runs for ${method}`));
  const token = readFileSync(join(w.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; session?: string; subject?: string; data: Line }
export async function events(w: World): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const page = (await call(w, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!page.length) return out;
    out.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}
export const lastPos = async (w: World): Promise<number> => (await events(w)).reduce((a, e) => Math.max(a, e.log_pos), 0);
const bare = (handle: string): string => String(handle).replace(/^[a-z]+:/, '');
/** The ask.created event of an ask handle (`ask:<id>` or the bare id). */
export async function askOf(w: World, handle: string): Promise<Ev> {
  return waitFor(async () => (await events(w)).find((e) => e.kind === 'ask.created' && e.id === bare(handle)), 30_000, `the ask.created of ${handle}`);
}

// ---- The deep CLI, as you run it in your terminal: outside every session's process tree, the OS confirming you.
export function deep(w: World, args: readonly string[], o: { env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { cwd: w.work, env: childEnv(w, { DEEP_HUB_TEST_CONFIRM: w.confirm, ...o.env }), timeoutMs: o.timeoutMs ?? 120_000 });
}
/** `deep inbox answer <ask> <option>`, which must count. */
export async function answer(w: World, ask: string, option: string): Promise<Ran> {
  const handle = `ask:${bare(ask)}`;
  const r = await deep(w, ['inbox', 'answer', handle, option]);
  expect(r.code, `deep inbox answer ${handle} ${option} counts: ${ranText(r)}`).toBe(0);
  return r;
}

// ---- The Agents page's methods (README, The surface).
export interface Planned { path: string; agents: string[]; before: string | null; after: string; diff?: string }
export interface Proposal extends Line { sync: string; ask: string; files: Planned[]; refused: { agent: string; field: string; reason?: string }[] }
/** `agents.propose`: one add (a server or a skill) for the agents chosen, through one write path; the plan comes back. */
export async function propose(w: World, params: Line): Promise<Proposal> {
  const r = await call(w, 'agents.propose', params);
  expect(typeof r.sync === 'string' && r.sync !== '', `agents.propose names the sync it plans: ${shown(r)}`).toBe(true);
  expect(typeof r.ask === 'string' && r.ask !== '', `agents.propose names the ask you approve it with: ${shown(r)}`).toBe(true);
  expect(Array.isArray(r.files), `agents.propose shows the plan, file by file: ${shown(r)}`).toBe(true);
  return { refused: [], ...r } as unknown as Proposal;
}
export const syncHandle = (p: Proposal): string => `sync:${bare(p.sync)}`;
export async function agentsRead(w: World): Promise<Line> { return call(w, 'agents.read', {}); }
export async function syncOf(w: World, sync: string): Promise<Line | undefined> {
  const page = await agentsRead(w);
  return (Array.isArray(page.syncs) ? page.syncs as Line[] : []).find((s) => bare(String(s.id)) === bare(sync));
}
/** Waits for the sync to reach a status; returns its entry. */
export async function syncReaches(w: World, sync: string, statuses: readonly string[], ms = 60_000): Promise<Line> {
  return waitFor(async () => { const s = await syncOf(w, sync); return s && statuses.includes(String(s.status)) ? s : undefined; }, ms, `${sync} to be ${statuses.join(' or ')} in agents.read`, 50);
}
/** Your yes to a proposal (`apply`), and the sync complete. */
export async function approve(w: World, p: Proposal): Promise<Line> {
  await answer(w, p.ask, 'apply');
  return syncReaches(w, p.sync, ['complete']);
}

// ---- The agents' own list commands, run as you run them, with HOME the world's.
export const claudeList = (w: World, cwd = w.work): Promise<Ran> => run(join(w.bin, 'claude'), ['mcp', 'list'], { cwd, env: childEnv(w), timeoutMs: 180_000 });
export const claudeLists = (r: Ran, name: string): boolean => new RegExp(`^${name.replace(/[-.]/g, '\\$&')}: `, 'm').test(r.stdout);
export async function codexList(w: World): Promise<{ ran: Ran; names: string[] | null; servers: Line[] }> {
  const ran = await run(join(w.bin, 'codex'), ['mcp', 'list', '--json'], { cwd: w.work, env: childEnv(w), timeoutMs: 120_000 });
  const v: unknown = ran.code === 0 ? (() => { try { return JSON.parse(ran.stdout); } catch { return undefined; } })() : undefined;
  const servers = Array.isArray(v) ? v as Line[] : [];
  return { ran, names: Array.isArray(v) ? servers.map((s) => String(s.name)) : null, servers };
}
export async function piList(w: World): Promise<{ ran: Ran; servers: Line[] }> {
  const ran = await run(join(w.bin, 'pi'), ['mcp', 'list', '--json'], { cwd: w.work, env: childEnv(w), timeoutMs: 180_000 });
  const v = parse(ran.stdout.slice(ran.stdout.indexOf('{')));
  return { ran, servers: Array.isArray(v?.servers) ? v!.servers as Line[] : [] };
}

// ---- Bytes.
export const digest = (path: string): string | null => (existsSync(path) ? sha256(readFileSync(path)) : null);
/** Files an agent writes as it runs (caches, logs, sessions, backups of its own) and the hub's root: not your settings. */
export const RUNTIME = [/^\.deepbuild\//, /^Library\//, /^\.claude\/backups\//, /^\.claude\/projects\//, /^\.claude\/statsig\//, /^\.codex\/log\//, /^\.codex\/sessions\//, /^\.codex\/[^/]*\.sqlite/, /^\.pi\/agent\/sessions\//, /^\.cache\//];
/** Every regular file under `dir` (links followed to files and not into folders), by its path relative to `dir`, with its SHA-256. */
export function snapshot(dir: string, skip: readonly RegExp[] = []): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      const rel = relative(dir, path);
      let s;
      try { s = statSync(path); } catch { out.set(rel, 'a dangling link'); continue; }
      if (s.isDirectory()) { if (!skip.some((r) => r.test(`${rel}/`))) walk(path); }
      else if (s.isFile() && !skip.some((r) => r.test(rel))) out.set(rel, sha256(readFileSync(path)));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
export const homeSnapshot = (w: World) => snapshot(w.home, RUNTIME);
/** The files under `dir` (nothing skipped) whose bytes hold any of `forms`. */
export function filesHolding(dir: string, forms: readonly string[]): string[] {
  const needles = forms.map((f) => Buffer.from(f));
  return [...snapshot(dir).keys()].map((rel) => join(dir, rel)).filter((path) => {
    let bytes: Buffer;
    try { bytes = readFileSync(path); } catch { return false; }
    return needles.some((n) => bytes.includes(n));
  });
}
/** The forms a value is searched in: as it is, base64 with and without padding, base64url and hex. */
export const formsOf = (value: string): string[] => {
  const b = Buffer.from(value);
  return [...new Set([value, b.toString('base64'), b.toString('base64').replace(/=+$/, ''), b.toString('base64url'), b.toString('hex')])];
};
export function differences(before: Map<string, string>, after: Map<string, string>, root: string): string[] {
  const out: string[] = [];
  for (const [p, h] of before) if (!after.has(p)) out.push(`${join(root, p)} is gone`); else if (after.get(p) !== h) out.push(`${join(root, p)} differs`);
  for (const p of after.keys()) if (!before.has(p)) out.push(`${join(root, p)} is new`);
  return out;
}
/** Whether `text` names `path`: as it is, or under HOME as ~/... */
export function names(text: string, path: string, w: World): boolean {
  const forms = [path, path.startsWith(`${w.home}/`) ? `~/${relative(w.home, path)}` : path];
  return forms.some((f) => text.includes(f));
}
export const same = (a: string, b: string): boolean => { try { return realpathSync(a) === realpathSync(b); } catch { return a === b; } };

// ---- A server and its fake MCP program. The token, when given, is entered once with the spec and lives only in the
// secret store; the program logs only its SHA-256.
export const serverLog = (w: World, name: string): Line[] => {
  const file = join(w.logs, `${name}.log`);
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').flatMap((l) => (parse(l) ? [parse(l)!] : [])) : [];
};
export const TOKEN_VARIABLE = 'FORGE_TOKEN';
export function stdioServer(w: World, name: string, o: { token?: string; scope?: Line } = {}): Line {
  return {
    name, transport: 'stdio', command: NODE, args: [SERVER, name, join(w.logs, `${name}.log`), ...(o.token ? [TOKEN_VARIABLE] : [])],
    ...(o.token ? { secrets: { [TOKEN_VARIABLE]: o.token } } : {}), ...(o.scope ? { scope: o.scope } : {}),
  };
}
/** A fake token of a common form, made per test and never written by the test anywhere under HOME. */
export const fakeToken = (): string => `ghp_${randomBytes(18).toString('base64url').replace(/[-_]/g, 'x').slice(0, 36)}`;

// ---- Git: a skill's source repository and the repos sessions work in. Local folders, so nothing is fetched.
function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], {
    cwd: dir, encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'You', GIT_AUTHOR_EMAIL: 'you@example.test', GIT_COMMITTER_NAME: 'You', GIT_COMMITTER_EMAIL: 'you@example.test' },
  }).trim();
}
function writeTree(dir: string, files: Record<string, string>): void {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
    if (p.endsWith('.sh')) chmodSync(join(dir, p), 0o755);
  }
}
/** A git repository at `<tmp>/<name>` with `files` committed on main; its path (real) and that commit. */
export function gitRepo(w: World, name: string, files: Record<string, string>): { dir: string; commit: string } {
  const dir = join(w.tmp, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  writeTree(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  return { dir: realpathSync(dir), commit: git(dir, 'rev-parse', 'HEAD') };
}
export function commitMore(dir: string, files: Record<string, string>): string {
  writeTree(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'more');
  return git(dir, 'rev-parse', 'HEAD');
}
export const gitStatus = (dir: string): string => git(dir, 'status', '--porcelain', '--ignored', '--untracked-files=all');
/** A skill: SKILL.md with its name and description, a LICENSE, and whatever else is given, under skills/<name>. */
export function skillFiles(name: string, more: Record<string, string> = {}): Record<string, string> {
  return {
    [`skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: Notes on how this team ships, for the ${name} skill's tests.\n---\n\nWrite a short changelog entry for each change.\n`,
    [`skills/${name}/LICENSE`]: 'MIT License\n\nCopyright (c) 2026 You\n',
    ...Object.fromEntries(Object.entries(more).map(([p, t]) => [`skills/${name}/${p}`, t])),
  };
}

// ---- Sessions, played through the real deep-hook under a process of their own (fixtures/agent.mjs).
let procs = 0;
export class Proc {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  readonly signals: string;
  private constructor(private readonly child: ChildProcess, signals: string) {
    this.signals = signals;
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parse(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        this.pending.get(line.n)?.({ code: line.code, signal: line.signal, stdout: String(line.stdout), stderr: String(line.stderr), ms: 0, timedOut: false });
        this.pending.delete(line.n);
      }
    });
    child.on('exit', () => {
      for (const [n, done] of [...this.pending]) { this.pending.delete(n); done({ code: null, signal: null, stdout: '', stderr: 'the process exited', ms: 0, timedOut: false }); }
    });
    child.stdin!.on('error', () => undefined);
  }
  /**
   * `claude`: one Claude Code session's process, its program where npm puts Claude Code's. `codex-daemon`: Codex's shared
   * app-server daemon, its command line `node .../@openai/codex/bin/codex.js app-server --listen unix://`.
   */
  static start(w: World, kind: 'claude' | 'codex-daemon'): Proc {
    const dir = join(w.tmp, 'procs', String(++procs), 'node_modules', ...(kind === 'claude' ? ['@anthropic-ai', 'claude-code'] : ['@openai', 'codex', 'bin']));
    mkdirSync(dir, { recursive: true });
    const program = join(dir, kind === 'claude' ? 'cli.mjs' : 'codex.js');
    copyFileSync(AGENT, program);
    const signals = join(w.tmp, `signals-${procs}.jsonl`);
    writeFileSync(signals, '');
    const child = spawn(NODE, [program, ...(kind === 'codex-daemon' ? ['app-server', '--listen', 'unix://'] : [])], {
      cwd: w.work, env: childEnv(w, { FIXTURE_DEEP_HOOK: DEEP_HOOK, FIXTURE_SIGNALS: signals }), stdio: ['pipe', 'pipe', 'ignore'],
    });
    own(child.pid);
    return new Proc(child, signals);
  }
  get pid(): number { return this.child.pid!; }
  /** `deep-hook <args...>` as this process's child, `input` on its stdin. */
  hook(args: readonly string[], cwd: string, input: Line, timeoutMs = 150_000): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input: JSON.stringify(input), timeoutMs })}\n`);
    });
  }
  signalled(): Line[] { return readFileSync(this.signals, 'utf8').split('\n').flatMap((l) => (parse(l) ? [parse(l)!] : [])); }
  stop(): void { try { process.kill(this.pid, 'SIGKILL'); } catch { /* gone */ } }
}
/** What deep-hook told the agent about a call: exit 2 or a deny/block decision stops it; exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parse(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}

/** A Claude Code session in `cwd`: its transcript as Claude Code writes it, at the newest version its facts cover. */
export class ClaudeSession {
  readonly id = randomUUID();
  readonly transcript: string;
  private prompt = randomUUID();
  readonly proc: Proc;
  constructor(readonly w: World, readonly cwd: string) {
    this.transcript = join(w.home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    this.proc = Proc.start(w, 'claude');
  }
  private entry(e: Line): void {
    appendFileSync(this.transcript, `${JSON.stringify({ parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: this.id, cwd: this.cwd, version: newest('claude-code'), userType: 'external', entrypoint: 'cli', ...e })}\n`);
  }
  hook(event: string, fields: Line = {}): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(event === 'SessionStart' ? { source: 'startup', model: 'claude-haiku-5-5' } : { prompt_id: this.prompt }), ...fields };
    return this.proc.hook(['claude-code', event], this.cwd, body);
  }
  /** SessionStart, then a prompt you typed. */
  async start(): Promise<void> {
    const r = await this.hook('SessionStart');
    if (r.code !== 0) throw Error(`BLOCKED: SessionStart through deep-hook must end with exit 0: ${ranText(r)}`);
    const text = 'look after the shop';
    this.entry({ type: 'user', promptId: this.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const p = await this.hook('UserPromptSubmit', { prompt: text });
    if (p.code !== 0) throw Error(`BLOCKED: UserPromptSubmit through deep-hook must end with exit 0: ${ranText(p)}`);
  }
  /** The agent calls an MCP tool: its tool_use in the transcript and its PreToolUse through deep-hook. */
  mcp(server: string, tool: string): Promise<Ran> {
    const id = `toolu_${randomBytes(10).toString('hex')}`;
    const call = { tool_name: `mcp__${server}__${tool}`, tool_input: { repo: 'shop' } };
    this.entry({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(8)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: call.tool_name, input: call.tool_input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    return this.hook('PreToolUse', { ...call, tool_use_id: id });
  }
}

/** A Codex session in `cwd` whose hooks run inside a daemon's process: its rollout as Codex writes it. */
export class CodexSession {
  readonly id = randomUUID();
  readonly rollout: string;
  private readonly turn = randomUUID();
  constructor(readonly w: World, readonly cwd: string, public daemon: Proc) {
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    this.rollout = join(w.home, '.codex', 'sessions', String(d.getUTCFullYear()), pad(d.getUTCMonth() + 1), pad(d.getUTCDate()), `rollout-${d.toISOString().slice(0, 19).replace(/:/g, '-')}-${this.id}.jsonl`);
    mkdirSync(dirname(this.rollout), { recursive: true });
    writeFileSync(this.rollout, `${JSON.stringify({ timestamp: d.toISOString(), type: 'session_meta', payload: { session_id: this.id, id: this.id, timestamp: d.toISOString(), cwd, originator: 'codex_cli_rs', cli_version: newest('codex'), source: 'cli' } })}\n`);
  }
  hook(event: string, fields: Line = {}): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.rollout, cwd: this.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default', ...(event === 'SessionStart' ? {} : { turn_id: this.turn }), ...fields };
    return this.daemon.hook(['codex', event], this.cwd, body);
  }
  /** SessionStart from its daemon (`startup`, or `resume` from a new one), then a prompt you typed. */
  async start(source: 'startup' | 'resume' = 'startup'): Promise<void> {
    const r = await this.hook('SessionStart', { source });
    if (r.code !== 0) throw Error(`BLOCKED: Codex's SessionStart through deep-hook must end with exit 0: ${ranText(r)}`);
    const text = 'tidy the release notes';
    appendFileSync(this.rollout, `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })}\n`);
    const p = await this.hook('UserPromptSubmit', { prompt: text });
    if (p.code !== 0) throw Error(`BLOCKED: Codex's UserPromptSubmit through deep-hook must end with exit 0: ${ranText(p)}`);
  }
}
/** The session rows `deep status` reads (status.read), by session ID. */
export async function rowOf(w: World, session: string): Promise<Line | undefined> {
  const rows = ((await call(w, 'status.read', {})).rows ?? []) as Line[];
  const plain = session.replace(/-/g, '');
  return rows.find((r) => String(r.id) === session || String(r.id).replace(/^session:/, '').replace(/-/g, '') === plain);
}
export const readingsOf = (row: Line | undefined): string[] => (Array.isArray(row?.readings) ? row!.readings.map(String) : []);

// ---- Your edits to an agent's file, in its own format (JSON or TOML).
const isToml = (path: string) => path.endsWith('.toml');
/** An edit that leaves DeepBuild's entry's meaning alone: a comment, or a key of yours. Returns the marker. */
export function harmlessEdit(path: string): string {
  const marker = `yours-${tag(4)}`;
  const text = readFileSync(path, 'utf8');
  if (isToml(path)) writeFileSync(path, `${text}${text.endsWith('\n') ? '' : '\n'}# ${marker}\n`);
  else writeFileSync(path, `${JSON.stringify({ ...JSON.parse(text), [marker]: true }, null, 2)}\n`);
  return marker;
}
/** An edit that changes what the approved diff means: your own server under the name DeepBuild's entry takes. */
export function conflictingEdit(path: string, name: string): void {
  const text = readFileSync(path, 'utf8');
  if (isToml(path)) { writeFileSync(path, `${text}${text.endsWith('\n') ? '' : '\n'}\n[mcp_servers.${name}]\ncommand = "/bin/echo"\nargs = ["yours"]\n`); return; }
  const v = JSON.parse(text) as Line;
  writeFileSync(path, `${JSON.stringify({ ...v, mcpServers: { ...(v.mcpServers ?? {}), [name]: { type: 'stdio', command: '/bin/echo', args: ['yours'] } } }, null, 2)}\n`);
}
/** An edit that leaves the file invalid in the agent's own format. */
export function invalidEdit(path: string): void {
  appendFileSync(path, isToml(path) ? '\n[[[ not toml\n' : '\n{{{ not json\n');
}
