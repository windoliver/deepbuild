// Shared test-side tools for #1015's acceptance tests (README): the criterion tags; a world (a temp home, the hub as a
// process, a bin folder with `deep` and the stand-in heavy commands, the stand-ins' log and go files); scripted Claude
// Code and Codex sessions, each its own stand-in agent process (fixtures/agent.mjs) that is the parent of its real
// deep-hook calls and of its shell commands; the record's leases folded from `lease.acquired` and `lease.released`;
// and the judges. Nothing here stands in for deep-hook, the hub, `deep lease` or the lease table: every decision comes
// from them. The #18 mapping suite's helpers (the environment, deep-hook's build, the socket, `events.read`) are
// imported, never copied.
//
// Safety: every folder is under /tmp/dh1015-* (and /tmp/dh18m-* for #18's); no network, no model, no real `claude`
// or `codex`, no real cargo or npx (the stand-ins run instead); a process a test starts is stopped by its PID or its
// process group's ID, never by name or port.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir, loadavg } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { alive, allEvents, cleanEnv, CLI, Conn, deepHook, failureOf, git, NODE, parseObject, REPO, sleep, type Ev, type Hub, type Line } from '../18/mapping/helpers.ts';

export { allEvents, failureOf, git, NODE, REPO, sleep, type Ev, type Hub, type Line };

// ---- Criterion tags: `#1015.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #1015.081f8373';
export const AC2 = 'AC2 #1015.b593e460';
export const AC3 = 'AC3 #1015.0ceaf8cf';
export const AC4 = 'AC4 #1015.b67ee1cc';
export const AC5 = 'AC5 #1015.1ce5e240';
export const AC6 = 'AC6 #1015.289f0347';
export const AC7 = 'AC7 #1015.d86f2d2a';
export const AC8 = 'AC8 #1015.6118ebcf';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
/** The reference Mac's 12 cores, as the hub is told them (DEEP_HUB_TEST_CORES): its `cpu.slot` pool is 6. */
export const CORES = 12;
export const POOL = CORES / 2;
/** What slow work may hold at once: the pool less the slot #907 keeps for fast-lane checks. */
export const LIMIT = POOL - 1;
export const CARGO_TEST = 'cargo test --workspace';
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
export const ordinal = (n: number): string => ORDINALS[n - 1] ?? `${n}th`;
export const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');

// ---- Temp folders and processes of this suite's own.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1015-'));
  made.push(dir);
  return dir;
}
const children = new Set<ChildProcess>();
const groups = new Set<number>();
const goDirs = new Set<string>();
/** Every go file written, every shell's process group, agent and hub this file started stopped by its ID, every folder removed. */
export async function cleanup(): Promise<void> {
  for (const dir of goDirs) try { writeFileSync(join(dir, 'all'), 'go'); } catch { /* gone */ }
  await sleep(300);
  for (const pgid of groups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const child of children) if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...children].some((c) => c.exitCode === null && c.signalCode === null) && Date.now() < deadline) await sleep(50);
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  for (const child of children) if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGKILL'); } catch { /* gone */ }
  children.clear();
  groups.clear();
  goDirs.clear();
  await sleep(100);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
afterAll(cleanup, 60_000);

// ---- The world: a home, its hub, and the commands sessions run.
export interface WorldOptions {
  /** DEEP_HUB_PLANT for the hub, deep-hook and every `deep` the sessions run (README, Plants). */
  plant?: string;
  /** Memory pressure the lease reads (README, Surfaces: DEEP_TEST_MEMORY_PRESSURE_FILE), written to the world's pressure file. */
  pressure?: 'normal' | 'warn' | 'critical';
}
export interface Stamp { kind: 'S' | 'E' | 'P'; label: string; pid: number; ms: number; what: string; child?: number; group?: number }
const STANDINS = ['cargo', 'npx', 'kit-run', 'gpu-export', 'build-block', 'spawner'];

export class World {
  readonly dir = tempDir();
  readonly home = join(this.dir, 'h');
  readonly bin = join(this.dir, 'bin');
  readonly root = join(this.home, '.deepbuild');
  /** Where the stand-ins write `log` and read `go/<label>`. */
  readonly runs = join(this.dir, 'runs');
  readonly pressureFile = join(this.dir, 'memory-pressure');
  hub: Hub | undefined;
  private hubChild: ChildProcess | undefined;
  constructor(readonly o: WorldOptions = {}) {
    mkdirSync(this.home);
    mkdirSync(join(this.home, '.claude'), { recursive: true });
    mkdirSync(join(this.home, '.codex', 'sessions'), { recursive: true });
    mkdirSync(this.bin);
    mkdirSync(join(this.runs, 'go'), { recursive: true });
    goDirs.add(join(this.runs, 'go'));
    writeFileSync(join(this.runs, 'log'), '');
    // `deep` as an installed CLI is: the built CLI on PATH.
    writeFileSync(join(this.bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`, { mode: 0o755 });
    const standin = readFileSync(join(FIXTURES, 'standin.pl'), 'utf8').replaceAll('__DIR__', this.runs);
    for (const name of STANDINS) {
      writeFileSync(join(this.bin, name), standin);
      chmodSync(join(this.bin, name), 0o755);
    }
    // The hub reads the sessions' Claude Code home with `claude plugin list --json`: a home with no plugins, so no
    // session reads as watch-only for want of a claude to list them with.
    writeFileSync(join(this.bin, 'claude'), `#!/bin/sh\n[ "$1 $2" = "plugin list" ] && echo '[]'\nexit 0\n`, { mode: 0o755 });
    if (o.pressure) this.setPressure(o.pressure);
  }
  setPressure(level: 'normal' | 'warn' | 'critical'): void { writeFileSync(this.pressureFile, `${level}\n`); }
  /** The environment of the hub, of every hook and of every command a session runs, with `extra` on top. */
  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return cleanEnv(this.home, {
      PATH: `${this.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: '/bin/sh',
      // A temporary HOME would leave rustup and Cargo homeless (scripts/preflight.mjs): theirs stay put.
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
      CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
      DEEP_HUB_TEST_CORES: String(CORES),
      DEEP_HUB_PLANT: this.o.plant,
      DEEP_TEST_MEMORY_PRESSURE_FILE: this.o.pressure ? this.pressureFile : undefined,
      ...extra,
    });
  }
  /** `deep hub run` for this home. A hub that doesn't start fails the test here, naming the plant when one is set. */
  async startHub(): Promise<Hub> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    await deepHook();
    const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children.add(child);
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const ready = await new Promise<Line | undefined>((resolve) => {
      let first = '';
      const timer = setTimeout(() => resolve(undefined), 120_000);
      child.stdout!.setEncoding('utf8').on('data', (d: string) => { first += d; if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)); } });
      child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
    });
    if (!ready || ready.ready !== true) {
      expect.fail(`the hub didn't start${this.o.plant ? ` with DEEP_HUB_PLANT=${this.o.plant} (the planted wrong program this test runs against)` : ''}: ${err.slice(0, 1500)}`);
    }
    this.hubChild = child;
    this.hub = { home: this.home, root: this.root, socket: String(ready!.socket), pid: child.pid!, ...(this.o.plant ? { plant: this.o.plant } : {}), stderr: () => err };
    return this.hub;
  }
  /** Stops the hub by its PID and waits for it to exit. */
  async stopHub(): Promise<void> {
    const child = this.hubChild;
    if (!child) return;
    try { process.kill(child.pid!, 'SIGTERM'); } catch { /* gone */ }
    const deadline = Date.now() + 30_000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(50);
    if (child.exitCode === null && child.signalCode === null) try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ }
    this.hub = undefined;
    this.hubChild = undefined;
  }
  /** The stand-ins' marks, in the order written. */
  stamps(): Stamp[] {
    return readFileSync(join(this.runs, 'log'), 'utf8').split('\n').filter(Boolean).map((line) => {
      const [kind, label, pid, a, b] = line.split('\t');
      return kind === 'P'
        ? { kind: 'P' as const, label: label!, pid: Number(pid), ms: 0, what: 'spawner', child: Number(a), group: Number(b) }
        : { kind: kind as 'S' | 'E', label: label!, pid: Number(pid), ms: Number(a), what: b ?? '' };
    });
  }
  started(label: string): Stamp | undefined { return this.stamps().find((s) => s.kind === 'S' && s.label === label); }
  ended(label: string): Stamp | undefined { return this.stamps().find((s) => s.kind === 'E' && s.label === label); }
  /** Lets the stand-in labelled `label` end. */
  go(label: string): void { writeFileSync(join(this.runs, 'go', label), 'go'); }
}

/** A git repo with one commit, `main`, and `n` worktrees of it named `wt-1` … `wt-n`, as parallel sessions' worktrees. */
export function sampleRepo(w: World, n: number, files: Record<string, string> = {}): { repo: string; worktrees: string[] } {
  const repo = join(w.dir, 'shop');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'Cargo.toml'), '[workspace]\nmembers = ["cart"]\nresolver = "2"\n');
  writeFileSync(join(repo, 'README.md'), '# shop\n');
  writeFileSync(join(repo, 'src/cart.test.ts'), "import { test } from 'vitest';\ntest('total', () => {});\n");
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); }
  git(w.home, repo, 'init', '-q', '-b', 'main');
  git(w.home, repo, 'add', '-A');
  git(w.home, repo, 'commit', '-q', '-m', 'Start');
  const worktrees: string[] = [];
  for (let i = 1; i <= n; i++) {
    const wt = join(w.dir, `wt-${i}`);
    git(w.home, repo, 'worktree', 'add', '-q', '-b', `b-${i}`, wt);
    worktrees.push(realpathSync(wt));
  }
  return { repo: realpathSync(repo), worktrees };
}
/** A plain folder named `name`, as a session's working folder where no repo is needed. */
export function folder(w: World, name: string): string {
  const dir = join(w.dir, name);
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

// ---- The stand-in agent process.
export interface Hooked { code: number | null; stdout: string; stderr: string; ms: number }
export interface Ran { code: number | null; signal: string | null; output: string; pid: number }
/** A shell command the session's agent runs: its shell's PID (its process group's ID), its output so far, and its end. */
export interface Bash { command: string; pid: Promise<number>; output(): string; done: Promise<Ran>; finished(): boolean }
class Agent {
  private readonly child: ChildProcess;
  private readonly waiting = new Map<number, (l: Line) => void>();
  private readonly streams = new Map<number, { pid?: (p: number) => void; output: string }>();
  private n = 0;
  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(NODE, [join(FIXTURES, 'agent.mjs')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    children.add(this.child);
    createInterface({ input: this.child.stdout! }).on('line', (raw) => {
      const l = parseObject(raw);
      if (!l || typeof l.n !== 'number') return;
      const s = this.streams.get(l.n);
      if (typeof l.started === 'number') { groups.add(l.started); s?.pid?.(l.started); }
      if (typeof l.output === 'string' && s) s.output += l.output;
      if (l.done) this.waiting.get(l.n)?.(l);
    });
  }
  private send(command: Line): { n: number; reply: Promise<Line> } {
    const n = ++this.n;
    const reply = new Promise<Line>((resolve) => this.waiting.set(n, resolve));
    this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    return { n, reply };
  }
  async hook(agent: string, event: string, payload: Line, cwd: string, env: NodeJS.ProcessEnv): Promise<Hooked> {
    const l = await this.send({ op: 'hook', binary: await deepHook(), agent, event, payload, cwd, env }).reply;
    if (l.failed) throw Error(`the stand-in agent couldn't run deep-hook: ${String(l.failed)}`);
    return { code: l.code as number | null, stdout: String(l.stdout ?? ''), stderr: String(l.stderr ?? ''), ms: Number(l.ms) };
  }
  bash(command: string, cwd: string, env: NodeJS.ProcessEnv): Bash {
    const n = this.n + 1;
    const stream: { pid?: (p: number) => void; output: string } = { output: '' };
    const pid = new Promise<number>((resolve) => { stream.pid = resolve; });
    this.streams.set(n, stream);
    let over = false;
    const { reply } = this.send({ op: 'bash', command, cwd, env });
    const done = reply.then((l) => { over = true; return { code: l.code as number | null, signal: (l.signal as string | null) ?? null, output: String(l.output ?? stream.output), pid: Number(l.pid) }; });
    return { command, pid, output: () => stream.output, done, finished: () => over };
  }
  stop(): void { try { this.child.stdin!.write(`${JSON.stringify({ n: 0, op: 'exit' })}\n`); } catch { /* gone */ } }
}

// ---- Scripted sessions.
const CLAUDE_VERSION = '2.1.304';
const CODEX_VERSION = '0.160.0';
const MODEL = 'claude-haiku-5-5';
export interface Decision { denied: boolean; reason: string; updated?: string }
/** What a PreToolUse reply decided: a deny (exit 2, `permissionDecision: deny` or `decision: block`) with its reason, or the command it rewrote the call to. */
export function decisionOf(h: Hooked): Decision {
  const reply = parseObject(h.stdout.trim());
  const specific = reply?.hookSpecificOutput as Line | undefined;
  if (h.code === 2) return { denied: true, reason: h.stderr.trim() };
  if (specific?.permissionDecision === 'deny') return { denied: true, reason: String(specific.permissionDecisionReason ?? '') };
  if (reply?.decision === 'block') return { denied: true, reason: String(reply.reason ?? '') };
  const updated = specific?.updatedInput?.command;
  return { denied: false, reason: '', ...(typeof updated === 'string' ? { updated } : {}) };
}
/** The `deep lease` command a deny gives to run instead: the first span in backticks that holds `deep lease`. */
export const leasedForm = (reason: string): string | undefined => [...reason.matchAll(/`([^`]*\bdeep lease\b[^`]*)`/g)].map((m) => m[1]!)[0];
export const shownHook = (h: Hooked): string => `exit ${h.code}, stdout ${JSON.stringify(h.stdout.slice(0, 600))}, stderr ${JSON.stringify(h.stderr.slice(0, 600))}`;

export interface Pre { id: string; command: string; hooked: Hooked; decision: Decision }
/**
 * One scripted session: Claude Code (`claude`, payloads and transcript as Claude Code 2.1.304 writes them, in
 * bypassPermissions mode, as an unattended scripted session runs) or Codex (`codex`, as Codex 0.160.0 does), in `cwd`,
 * its own stand-in agent process the parent of its hooks and its commands.
 */
export class Session {
  readonly id = randomUUID();
  readonly label: string;
  private readonly agent: Agent;
  private readonly transcript: string;
  private turn = randomUUID();
  private parent: string | null = null;
  private promptId: string | undefined;
  constructor(readonly w: World, readonly kind: 'claude' | 'codex', readonly cwd: string, readonly extraEnv: Record<string, string> = {}) {
    this.label = basename(cwd);
    this.agent = new Agent(w.env());
    if (kind === 'claude') {
      this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
      mkdirSync(dirname(this.transcript), { recursive: true });
      writeFileSync(this.transcript, '');
    } else {
      this.transcript = join(w.home, '.codex', 'sessions', `rollout-${this.id}.jsonl`);
      writeFileSync(this.transcript, `${JSON.stringify({ type: 'session_meta', payload: { id: this.id, cwd, cli_version: CODEX_VERSION, originator: 'codex_cli_rs' } })}\n`);
    }
  }
  /** The environment the agent gives its hooks and its shell commands. */
  env(): NodeJS.ProcessEnv {
    return this.w.env(this.kind === 'claude' ? { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: this.cwd, ...this.extraEnv } : { ...this.extraEnv });
  }
  private entry(value: Line): void {
    if (this.kind !== 'claude') return;
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: CLAUDE_VERSION, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  hook(event: string, fields: Line = {}): Promise<Hooked> {
    const payload: Line = this.kind === 'claude'
      ? { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, ...(this.promptId ? { prompt_id: this.promptId } : {}), permission_mode: 'bypassPermissions', effort: { level: 'medium' }, hook_event_name: event, ...fields }
      : { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default', ...(event === 'SessionStart' ? { source: 'startup' } : event === 'SessionEnd' ? {} : { turn_id: this.turn }), ...fields };
    return this.agent.hook(this.kind === 'claude' ? 'claude-code' : 'codex', event, payload, this.cwd, this.env());
  }
  /** SessionStart, then your prompt (its transcript entry first), then UserPromptSubmit. */
  async begin(prompt = 'Run the whole test suite and tell me whether it passes.'): Promise<void> {
    await this.hook('SessionStart', this.kind === 'claude' ? { source: 'startup', model: MODEL } : {});
    this.promptId = randomUUID();
    this.turn = randomUUID();
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: prompt }, origin: { kind: 'human' }, turnOrigin: 'human', turnPosition: { promptIndex: 1, turnIndex: 1 } });
    await this.hook('UserPromptSubmit', { prompt });
  }
  /** The shell call's PreToolUse (its tool_use entry first): what the hook decided. */
  async pre(command: string): Promise<Pre> {
    const id = this.kind === 'claude' ? `toolu_${randomBytes(12).toString('hex')}` : `call_${randomBytes(6).toString('hex')}`;
    this.entry({ type: 'assistant', message: { model: MODEL, id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }], stop_reason: 'tool_use', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 } } });
    const hooked = await this.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command, ...(this.kind === 'claude' ? { description: 'Run the tests' } : {}) }, tool_use_id: id });
    return { id, command, hooked, decision: decisionOf(hooked) };
  }
  /** The agent runs `command` with its shell tool, in the session's folder or `cwd`, with `env` on top of the session's. */
  run(command: string, o: { cwd?: string; env?: Record<string, string> } = {}): Bash {
    return this.agent.bash(command, o.cwd ?? this.cwd, { ...this.env(), ...(o.env ?? {}) });
  }
  /** The call's tool result entry and PostToolUse. */
  async post(pre: Pre, command: string, ran: Ran): Promise<Hooked> {
    const response = this.kind === 'claude' ? { stdout: ran.output, stderr: '', interrupted: false, isImage: false } : { stdout: ran.output, stderr: '', exit_code: ran.code ?? 1 };
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: pre.id, content: ran.output, is_error: ran.code !== 0 }] }, toolUseResult: response });
    return this.hook('PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_response: response, tool_use_id: pre.id, ...(this.kind === 'claude' ? { duration_ms: 1000 } : {}) });
  }
  stop(): void { this.agent.stop(); }
}

/**
 * A Claude Code session's shell call as Claude Code makes it: PreToolUse, then the command the hook rewrote it to (or
 * the one typed, when it wasn't), then, once that ends, PostToolUse. `ran` is undefined when the hook denied the call.
 */
export async function claudeCall(s: Session, command: string, o: { cwd?: string; env?: Record<string, string> } = {}): Promise<{ pre: Pre; bash?: Bash; after: Promise<Ran | undefined> }> {
  const pre = await s.pre(command);
  if (pre.decision.denied) return { pre, after: Promise.resolve(undefined) };
  const used = pre.decision.updated ?? command;
  const bash = s.run(used, o);
  const after = bash.done.then(async (ran) => { await s.post(pre, used, ran); return ran; });
  return { pre, bash, after };
}
/** `cmd` rewritten into a `deep lease` form: it names `deep lease` and holds the command as typed. */
export const rewrittenToLease = (d: Decision, cmd: string): boolean => d.updated !== undefined && /\bdeep lease\b/.test(d.updated) && d.updated.includes(cmd);
/** `cmd` left as typed: allowed, and not rewritten (or rewritten to itself). */
export const asWritten = (d: Decision, cmd: string): boolean => !d.denied && (d.updated === undefined || d.updated.trim() === cmd);

// ---- The record's leases, folded from its lease events.
export interface LeaseRow { id: string; kind: string; key: string; mode: string; holder: string; run?: string; at: number; released?: number }
export async function leaseRows(hub: Hub): Promise<LeaseRow[]> {
  const rows = new Map<string, LeaseRow>();
  for (const e of await allEvents(hub)) {
    if (e.kind === 'lease.acquired') {
      const r = e.data.resource as Line | undefined;
      const id = String(e.subject ?? e.id);
      rows.set(id, { id, kind: String(r?.kind), key: String(r?.key), mode: String(e.data.mode), holder: String(e.data.holder), ...(e.data.run ? { run: String(e.data.run) } : {}), at: e.ts });
    }
    if (e.kind === 'lease.released') {
      const row = rows.get(String(e.subject));
      if (row && row.released === undefined) row.released = e.ts;
    }
  }
  return [...rows.values()];
}
export const heldNow = (rows: readonly LeaseRow[]): LeaseRow[] => rows.filter((r) => r.released === undefined);
/** Whether the lease's holder is the session: `session:<its ID>`, the ID's letters and digits as the hub writes them. */
export const heldBy = (r: LeaseRow, s: Session): boolean => r.holder.startsWith('session:') && letters(r.holder.slice('session:'.length)) === letters(s.id);
export const slotsOf = (rows: readonly LeaseRow[], s: Session): LeaseRow[] => rows.filter((r) => r.kind === 'cpu.slot' && heldBy(r, s));
export const shownLeases = (rows: readonly LeaseRow[]): string => rows.map((r) => `${r.kind} ${r.key} ${r.mode} by ${r.holder}${r.released ? ' (released)' : ''}`).join('; ') || 'none';

/** One socket call with the control token. */
export async function rpc(hub: Hub, method: string, params: unknown = {}, timeoutMs = 60_000): Promise<Line> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await conn.call(method, params, timeoutMs);
  } finally {
    conn.close();
  }
}

/** Polls until `ok` holds or `ms` passes; returns whether it held. */
export async function until(ok: () => boolean | Promise<boolean>, ms: number, every = 250): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok()) return true;
    if (Date.now() > deadline) return false;
    await sleep(every);
  }
}
/** A line of a command's output that says it waits. */
export const waitLines = (output: string): string[] => output.split('\n').filter((l) => /\bwait/i.test(l));

// ---- Commands in waves: the scenario of AC1 and AC2.
export interface Running { s: Session; bash: Bash }
export interface Wave { running: string[]; leases: LeaseRow[] }
/**
 * Lets the commands run as the lease table lets them, holding each that runs until a wave is seen: a wave is read once
 * no stand-in has started for 4 s and every command not started yet has printed a waiting line or ended (or after 150
 * s, whichever is first). Then the record's leases are read, and every command running is let end. Ends when every
 * command has ended, or after `ms`.
 */
export async function inWaves(w: World, calls: readonly Running[], ms = 900_000): Promise<Wave[]> {
  const waves: Wave[] = [];
  const deadline = Date.now() + ms;
  let freed = new Set<string>();
  while (calls.some((c) => !c.bash.finished()) && Date.now() < deadline) {
    const t0 = Date.now();
    let count = -1;
    let since = Date.now();
    await until(() => {
      const stamps = w.stamps().filter((x) => x.kind === 'S');
      if (stamps.length !== count) { count = stamps.length; since = Date.now(); }
      const pending = calls.filter((c) => !c.bash.finished() && !w.started(c.s.label));
      const quiet = Date.now() - since > 4000;
      return (quiet && pending.every((c) => waitLines(c.bash.output()).length > 0)) || Date.now() - t0 > 150_000 || calls.every((c) => c.bash.finished());
    }, deadline - Date.now(), 300);
    const running = calls.filter((c) => w.started(c.s.label) && !w.ended(c.s.label) && !freed.has(c.s.label)).map((c) => c.s.label);
    if (running.length) waves.push({ running, leases: heldNow(await leaseRows(w.hub!)) });
    for (const label of running) w.go(label);
    freed = new Set([...freed, ...running]);
    // A wave with nothing running and nothing left to start: whatever is left waits on nothing this test can free.
    if (!running.length && calls.every((c) => c.bash.finished() || w.started(c.s.label))) await sleep(1000);
    if (!running.length && Date.now() - t0 > 150_000) break;
  }
  return waves;
}
/** The most stand-ins that ran at once, and the one that started past `limit` (with those running beside it), if any. */
export function overlap(stamps: readonly Stamp[], labels: readonly string[], limit: number): { most: number; past?: { label: string; beside: string[]; n: number } } {
  const starts = stamps.filter((x) => x.kind === 'S' && labels.includes(x.label)).sort((a, b) => a.ms - b.ms);
  const endOf = (label: string) => stamps.find((x) => x.kind === 'E' && x.label === label)?.ms ?? Infinity;
  let most = 0;
  let past: { label: string; beside: string[]; n: number } | undefined;
  starts.forEach((s, i) => {
    const beside = starts.slice(0, i).filter((o) => endOf(o.label) > s.ms).map((o) => o.label);
    most = Math.max(most, beside.length + 1);
    if (!past && beside.length >= limit) past = { label: s.label, beside, n: i + 1 };
  });
  return { most, ...(past ? { past } : {}) };
}

// ---- Judges.
/** Runs `assertion` against a planted wrong program: it must fail, and its message must name each of `names`. */
export async function mustFail(what: string, assertion: () => unknown, names: readonly string[]): Promise<string> {
  const message = await failureOf(assertion);
  expect(message, `${what}: the planted wrong program passed the assertion, so the assertion proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
  return message!;
}
/** Why a timing reading here can't count: the machine's load past its cores. */
export function loaded(): string | null {
  const load = loadavg()[0]!;
  return load > availableParallelism() ? `load ${load.toFixed(1)} is past the ${availableParallelism()} cores` : null;
}
/** Whether a process still runs (not a zombie). */
export const running = (pid: number): boolean => alive(pid);
/** A process the test starts on the machine beside the sessions' work, stopped by its PID after the file. */
export function bystander(): number {
  const child = spawn('/bin/sleep', ['600'], { stdio: 'ignore' });
  children.add(child);
  return child.pid!;
}
/** SIGTERM to a shell's process group, as an agent's tool timeout ends a command. */
export const terminateGroup = (pgid: number): void => { try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ } };
