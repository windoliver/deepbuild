// Test-side tools for #23's permissions/ criteria (README): a temp world (a home with the shipped default guards plus
// one guard of yours, your ask settings, the OS-confirmation stub, Claude Code's settings files and an AWS config; a
// git repository the sessions work in), the hub as a process on a test clock, the record read back through the hub's
// socket (`events.read`), Claude Code sessions driven through the real deep-hook binary with payloads shaped like the
// corpus's, your answer through `deep inbox answer`, and the readings each criterion judges. Parts are adapted from
// tests/acceptance/321/helpers.ts (same repo, same license); this folder keeps its own copy so a redraft there never
// moves these tests. Nothing here stands in for DeepBuild: every decision comes from the real hub, deep-hook and CLI.
// The test plays Claude Code: it fires each hook through deep-hook as that session's child, and applies a
// PermissionRequest reply's `updatedPermissions` to the settings files the way Claude Code does.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
export const DAY = 86_400_000;
/** Monday 2 November 2026, 09:00 UTC: where every hub's test clock starts. */
export const T0 = Date.UTC(2026, 10, 2, 9, 0, 0);

/** Each criterion's ID: `#23.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const WEEK = '#23.7232c832';
export const CANCEL = '#23.02482c32';
export const TYPED = '#23.3b29ddde';
export const MODE_GUARD = '#23.15c1cac3';
export const DEPENDENCY = '#23.56633035';
export const CLOUD = '#23.e3e9bdfd';
export const HUB_DOWN = '#23.1e4ae1da';

/** The AWS accounts (README, Accounts): the profile a command names, and the account it signs into. */
export const ACCOUNT_A = { profile: 'shop-prod', id: '111122223333' };
export const ACCOUNT_B = { profile: 'shop-new', id: '444455556666' };
export const kms = (account: { profile: string }, extra = ''): string => `aws kms create-key --profile ${account.profile} --description shop-orders${extra}`;
/** Your guard (README, World): no KMS key that skips the key-policy lockout check, in block mode. */
export const LOCKOUT_GUARD = 'no-kms-lockout-bypass';
export const LOCKOUT_FLAG = ' --bypass-policy-lockout-safety-check';

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
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- Verdicts. A judgement throws an Error naming the criterion; INCONCLUSIVE is a skip, never a pass.
/** A reading the machine spoiled: a hook whose acknowledgement came too late, so the hub never decided it. */
export class Inconclusive extends Error {}
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message} (read at ${loadReading()})`);
    throw error;
  }
}
/** The message a scenario throws, or null when it holds. BLOCKED and INCONCLUSIVE are thrown on, never read as a failure. */
export async function failureOf(judge: () => Promise<void>): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    if (error instanceof Inconclusive) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh23p-'));
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
/** Stops every process this suite started (SIGCONT and SIGTERM, then SIGKILL after 3 s) and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  agents.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, and no DEEP_/GIT_/XDG_/CLAUDE/AWS settings or billing keys of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('CLAUDE') || key.startsWith('AWS_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; ended: number }
/** Runs a command to its end without blocking this process's event loop. */
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
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

// ---- A world: a home and a repository.
/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised; authority 1 day. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** Claude Code's settings files (README, Settings files): user, project and local, and its own config. */
export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; settings: string[] }
/**
 * `<tmp>/h` is HOME for every process. The hub's root `<home>/.deepbuild` holds the shipped default guards plus your
 * guard LOCKOUT_GUARD as the first rules.json, and config.json with your ask settings. `<tmp>/repo` is a git
 * repository with one commit on main, the folder every session works in. `<tmp>/confirm` says `confirmed`: the OS
 * confirming you when `deep inbox answer` counts (#24's stub, DEEP_HUB_TEST_CONFIRM). Claude Code's settings files
 * each hold a permissions block of yours already, and `~/.aws/config` names the two accounts' profiles.
 */
export function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rules = JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as Line;
  rules.entries[LOCKOUT_GUARD] = {
    match: `run:aws kms create-key ${LOCKOUT_FLAG.trim()}`, scope: 'all_repos', mode: 'block',
    reason: 'A KMS key created past the key-policy lockout check can lock everyone out of it, you included.',
    next_step: 'Create the key without --bypass-policy-lockout-safety-check.', fail_closed: false,
  };
  rules.proofs[LOCKOUT_GUARD] = {
    planted: { tool_name: 'Bash', tool_input: { command: kms(ACCOUNT_A, LOCKOUT_FLAG) } },
    twin: { tool_name: 'Bash', tool_input: { command: kms(ACCOUNT_A) } },
  };
  writeFileSync(join(root, 'rules.json'), `${JSON.stringify(rules, null, 2)}\n`);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  mkdirSync(join(home, '.aws'), { recursive: true });
  writeFileSync(join(home, '.aws', 'config'), [ACCOUNT_A, ACCOUNT_B].map((a) => `[profile ${a.profile}]\nsso_account_id = ${a.id}\nsso_role_name = Developer\nregion = eu-west-1\n`).join('\n'));
  const repoDir = join(tmp, 'repo');
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repoDir, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(join(repoDir, 'src', 'login.ts'), 'export const login = () => false;\n');
  writeFileSync(join(repoDir, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { build: 'node -e 0', test: 'node -e 0' } }, null, 2)}\n`);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  const repo = realpathSync(repoDir);
  // Your own settings, as Claude Code keeps them: each file exists and holds rules you wrote.
  mkdirSync(join(repo, '.claude'), { recursive: true });
  const settings = [join(home, '.claude', 'settings.json'), join(home, '.claude', 'settings.local.json'), join(repo, '.claude', 'settings.json'), join(repo, '.claude', 'settings.local.json'), join(home, '.claude.json')];
  writeFileSync(settings[0]!, `${JSON.stringify({ permissions: { allow: ['Bash(git status)'], deny: ['Bash(curl:*)'] }, model: 'opus' }, null, 2)}\n`);
  writeFileSync(settings[1]!, `${JSON.stringify({ permissions: { allow: ['Read(~/notes/**)'] } }, null, 2)}\n`);
  writeFileSync(settings[2]!, `${JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }, null, 2)}\n`);
  writeFileSync(settings[3]!, `${JSON.stringify({ permissions: { allow: ['Bash(git diff:*)'] } }, null, 2)}\n`);
  writeFileSync(settings[4]!, `${JSON.stringify({ numStartups: 12, projects: { [repo]: { allowedTools: [] } } }, null, 2)}\n`);
  return { tmp, home, root, repo, confirm, settings };
}
/** Each settings file's SHA-256, to compare its bytes later. */
export function snapshot(w: World): Map<string, string> {
  return new Map(w.settings.map((f) => [f, existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : 'missing']));
}
/** The settings files whose bytes differ from `before`, each named. */
export function changedSince(w: World, before: Map<string, string>): string[] {
  const now = snapshot(w);
  return [...before].filter(([f, h]) => now.get(f) !== h).map(([f]) => f);
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; readyAt: number; clock: number | undefined; plant: string | undefined; stderr(): string }
export interface HubOptions { plant?: string | undefined; clock?: number | undefined }
/**
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, and with DEEP_HUB_PLANT and DEEP_HUB_TEST_CLOCK (the hub's clock
 * starts there and moves with real time) when given. A hub that doesn't start (a plant the program doesn't list) is BLOCKED.
 */
export async function startHub(w: World, o: HubOptions = {}): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_CLOCK: o.clock === undefined ? undefined : String(Math.round(o.clock)),
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
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: o.clock, plant: o.plant, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGCONT'); } catch { /* gone */ }
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}

// ---- The record, read back through the hub's socket as the CLI reads it (the cli role, with the control token).
export function control(hub: Hub, method: string, params: Line, timeoutMs = 30_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1 && line?.role !== undefined) {
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve(line.result as Line);
        }
      }
    });
  });
}
export interface Ev { id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; data: Line }
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const events = (await control(hub, 'events.read', { after, limit: 1000 })).events as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
export async function lastPos(hub: Hub): Promise<number> {
  const events = await allEvents(hub);
  return events.length ? events[events.length - 1]!.log_pos : 0;
}
export const handleOf = (ask: Ev) => `ask:${ask.id}`;
/** The asks raised after `since` whose question names every one of `names`. */
export async function asksNaming(hub: Hub, since: number, names: readonly string[]): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'ask.created' && e.log_pos > since && names.every((n) => String(e.data?.question ?? '').includes(n)));
}
/** The saved decisions (decision.created) after `since`, by the core. */
export async function decisionsSince(hub: Hub, since: number): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'decision.created' && e.log_pos > since);
}
/** How the ask closed, as the record says: the kind of the first closing event naming it, or undefined while open. */
const CLOSING = /^(ask\.(answered|defaulted|escalated|cancelled|superseded|moot)|decision\.applied)$/;
export function closingOf(events: Ev[], handle: string): Ev | undefined {
  return events.find((e) => CLOSING.test(e.kind) && (e.subject === handle || e.data?.ask === handle) && !(e.kind === 'decision.applied' && e.data?.ask !== handle));
}
/** Waits up to `ms` for an ask raised after `since` naming every one of `names`. */
export async function waitAsk(hub: Hub, since: number, names: readonly string[], ms: number, pending?: Pending): Promise<Ev | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const [ask] = await asksNaming(hub, since, names);
    if (ask) return ask;
    if (Date.now() > deadline || (pending?.result && Date.now() > pending.result.ended + 10_000)) return undefined;
    await sleep(250);
  }
}

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session, as Claude Code is of its hook commands. The hub binds the session to it, so
// `deep inbox answer`, run by this test process, is outside every session's process tree, as your terminal is.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        if ('pid' in line && !('code' in line)) { own(Number(line.pid)); continue; }
        const done = this.pending.get(line.n);
        this.pending.delete(line.n);
        done?.(line as unknown as Ran);
      }
    });
    child.on('exit', () => {
      for (const [n, done] of [...this.pending]) {
        this.pending.delete(n);
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s agent process exited', ms: 0, timedOut: false, ended: Date.now() });
      }
    });
  }
  static start(w: World): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const agents = new Map<string, Agent>();

// ---- Claude Code sessions: hook payloads and transcripts shaped like the corpus's (adapters/corpus/claude-code).
export type Mode = 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions';
export interface Session { id: string; cwd: string; transcript: string; prompt?: string; mode: Mode }
/** A session in permission mode `mode`: its transcript, and its own Claude Code process that runs its hooks. */
export function newSession(w: World, mode: Mode = 'default'): Session {
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  agents.set(id, Agent.start(w));
  return { id, cwd: w.repo, transcript, mode };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, output_tokens: 10 } } });
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: s.mode };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
/** deep-hook as Claude Code runs our hook entry: `deep-hook claude-code <event>`, the payload on stdin, a child of the session's Claude Code. */
export function fire(body: Line, timeoutMs = 150_000): Promise<Ran> {
  const agent = agents.get(String(body.session_id));
  if (!agent) throw Error(`BLOCKED: no Claude Code process for session ${String(body.session_id)}; make sessions with newSession`);
  return agent.run(['claude-code', String(body.hook_event_name)], String(body.cwd), JSON.stringify(body), timeoutMs);
}
export async function sessionStart(s: Session): Promise<void> {
  const r = await fire(payload(s, 'SessionStart'));
  if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
  // The hub's work on a session's start (its briefing, the transcript) settles before the session's first call, so
  // that call's acknowledgement isn't late for it on a loaded machine. Not a wait on the program's answer.
  await sleep(1500);
}
/** Words you type in the session: its transcript entry and its UserPromptSubmit. */
export async function typed(s: Session, text: string): Promise<Ran> {
  const promptId = randomUUID();
  s.prompt = promptId;
  appendTranscript(s, { type: 'user', promptId, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return fire(payload(s, 'UserPromptSubmit', { prompt: text }));
}

// ---- Calls, and what each hook's reply tells Claude Code.
export interface Call { tool_name: string; tool_input: Line }
export const bash = (command: string): Call => ({ tool_name: 'Bash', tool_input: { command, description: command } });
let calls = 0;
export const callId = () => `toolu_${randomBytes(10).toString('hex')}${++calls}`;
/** What Claude Code offers in its own dialog: "Yes, and don't ask again" for this command here, a rule for the local settings file. */
export const alwaysAllow = (c: Call): Line[] => [{ type: 'addRules', rules: [{ toolName: c.tool_name, ruleContent: String(c.tool_input.command) }], behavior: 'allow', destination: 'localSettings' }];

/** A PreToolUse reply as Claude Code reads it: denied, explicitly allowed (no prompt, past the permission mode), or passed on to the permission mode. */
export type PreToolDecision = 'deny' | 'allow' | 'pass';
export function preTool(r: Ran): PreToolDecision {
  const out = parseObject(r.stdout.trim());
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (said === 'allow' || said === 'approve') return 'allow';
  return 'pass';
}
/** A PermissionRequest reply as Claude Code reads it: allow, deny, or no decision (cancel: Claude Code's own dialog shows). */
export interface PermissionReply { behavior: 'allow' | 'deny' | 'none'; updated: Line[]; message: string; raw: Ran }
export function permissionOf(r: Ran): PermissionReply {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.decision;
  const behavior = r.code === 2 || d?.behavior === 'deny' ? 'deny' : d?.behavior === 'allow' ? 'allow' : 'none';
  return { behavior, updated: Array.isArray(d?.updatedPermissions) ? (d.updatedPermissions as Line[]) : [], message: `${String(d?.message ?? '')}${r.code === 2 ? r.stderr : ''}`, raw: r };
}
/** The words the agent reads from a hook's reply: a block's stderr, a deny's reason or message, and any added context. */
export function agentReads(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  const h = out?.hookSpecificOutput ?? {};
  const parts = [r.code === 2 ? r.stderr : '', String(h.additionalContext ?? '')];
  if (h.permissionDecision === 'deny') parts.push(String(h.permissionDecisionReason ?? ''));
  if (h.decision?.behavior === 'deny') parts.push(String(h.decision?.message ?? ''));
  if (out?.decision === 'block') parts.push(String(out.reason ?? ''));
  return parts.filter(Boolean).join('\n');
}
/** Where Claude Code writes an `updatedPermissions` entry: a settings file for a lasting destination, nowhere for the session. */
const DESTINATIONS: Record<string, (w: World) => string> = {
  userSettings: (w) => w.settings[0]!,
  projectSettings: (w) => w.settings[2]!,
  localSettings: (w) => w.settings[3]!,
};
/**
 * Claude Code applying a PermissionRequest reply's `updatedPermissions`: an entry for `session` lasts the session and
 * is written nowhere; one for a settings file is written into it (rules into its allow or deny list, a mode as its
 * default mode, directories as additional directories). Returns the lasting destinations it wrote.
 */
export function applyLikeClaude(w: World, reply: PermissionReply): string[] {
  const wrote: string[] = [];
  for (const entry of reply.updated) {
    const where = DESTINATIONS[String(entry.destination)];
    if (!where) continue;
    const file = where(w);
    const settings = (existsSync(file) ? parseObject(readFileSync(file, 'utf8')) : undefined) ?? {};
    settings.permissions ??= {};
    if (entry.type === 'addRules' || entry.type === 'replaceRules') {
      const list = String(entry.behavior ?? 'allow');
      const rules = (Array.isArray(entry.rules) ? entry.rules : []).map((r: Line) => (r.ruleContent ? `${String(r.toolName)}(${String(r.ruleContent)})` : String(r.toolName)));
      settings.permissions[list] = [...(Array.isArray(settings.permissions[list]) ? settings.permissions[list] : []), ...rules];
    } else if (entry.type === 'setMode') settings.permissions.defaultMode = entry.mode;
    else if (entry.type === 'addDirectories') settings.permissions.additionalDirectories = [...(settings.permissions.additionalDirectories ?? []), ...(entry.directories ?? [])];
    else settings.permissions[String(entry.type)] = entry;
    writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    wrote.push(`${String(entry.destination)} (${file})`);
  }
  return wrote;
}

/** One call the agent makes: its tool_use in the transcript and its PreToolUse through deep-hook. */
export async function preToolUse(s: Session, call: Call, id = callId()): Promise<{ id: string; r: Ran }> {
  appendTranscript(s, assistant([{ type: 'tool_use', id, name: call.tool_name, input: call.tool_input }], 'tool_use'));
  return { id, r: await fire(payload(s, 'PreToolUse', { ...call, tool_use_id: id })) };
}
/** The call ran (a Bash call, after the person typed yes on Claude Code's own prompt): its result and its PostToolUse. */
export async function postToolUse(s: Session, call: Call, id: string): Promise<Ran> {
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'ok', is_error: false }] } });
  return fire(payload(s, 'PostToolUse', { ...call, tool_use_id: id, tool_response: { stdout: 'ok', stderr: '', interrupted: false, isImage: false } }));
}
/** A permission prompt pending in Claude Code: its PermissionRequest hook running through deep-hook. */
export interface Pending { call: Call; started: number; done: Promise<Ran>; result?: Ran }
/** Claude Code asks permission for `call` (its PreToolUse passed it on): the PermissionRequest hook, offering "always allow". */
export function permissionRequest(s: Session, call: Call): Pending {
  const p: Pending = { call, started: Date.now(), done: Promise.resolve(undefined as unknown as Ran) };
  p.done = fire(payload(s, 'PermissionRequest', { ...call, permission_suggestions: alwaysAllow(call) }), 150_000).then((r) => { p.result = r; return r; });
  return p;
}
/** Claude Code's timeout for a PermissionRequest hook: the facts' default, since no per-hook entry names it. */
export const PERMISSION_TIMEOUT_MS = (() => {
  const t = (JSON.parse(readFileSync(FACTS, 'utf8')) as Line).hookTimeouts ?? {};
  return Number(t.perHook?.PermissionRequest ?? t.defaultMs ?? 60_000);
})();

/** deep-hook's watchdog: past this, a hook the hub hasn't acknowledged ends on its own (crates/deep-hook, WATCHDOG). */
const WATCHDOG_MS = 45;
/**
 * Whether the hub may never have decided this hook (README, Late hooks): deep-hook says it spooled the call or denied
 * it on the floor that holds while the hub doesn't answer; the spool still holds it marked late; it ended with nothing
 * said past deep-hook's watchdog, which is how a hook the hub didn't acknowledge in time ends; or the record marks its
 * call late. A reading this spoils is INCONCLUSIVE, never a pass.
 */
export async function lateHook(hub: Hub, sessionId: string, event: string, r: Ran, call?: string): Promise<boolean> {
  if (/deep-hook: (spooled|could not spool)|while the hub doesn't answer/.test(r.stderr)) return true;
  if (r.code === 0 && !r.stdout.trim() && r.ms >= WATCHDOG_MS && r.ms < 2000) return true;
  const dir = join(hub.root, 'spool');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      let text = '';
      try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      if (jsonLines(text).some((l) => l.late === true && l.event === event && JSON.stringify(l.payload ?? {}).includes(sessionId))) return true;
    }
  }
  if (!call) return false;
  const before = (await allEvents(hub)).find((e) => e.kind === 'tool.before' && e.data?.call === call);
  return before?.data?.late === true;
}

// ---- Your answers, on the trusted path: `deep inbox answer` in your own terminal, the OS confirming you (the stub).
export async function answer(w: World, ask: Ev, decision: 'allow' | 'deny'): Promise<Ran> {
  const options = (ask.data.options ?? []) as Line[];
  const option = options.find((o) => o.decision === decision);
  must(option !== undefined, `${handleOf(ask)} must have an option that says ${decision}: its options are ${JSON.stringify(options)}`);
  return run(NODE, [CLI, 'inbox', 'answer', handleOf(ask), String(option.id)], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
}
/** `deep inbox` in your own terminal: what it lists (README, surface 2: your asks, and the decisions offered back to you). */
export function inboxList(w: World): Promise<Ran> {
  return run(NODE, [CLI, 'inbox'], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
}
/** `deep inbox save <offer>`: the one click that saves a decision offered back to you, the OS confirming you (the stub). */
export function saveOffer(w: World, offer: string): Promise<Ran> {
  return run(NODE, [CLI, 'inbox', 'save', offer], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
}
