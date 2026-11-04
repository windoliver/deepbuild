// Test-side tools for the blind redraft of #1018 AC6 (README): the two sides (this checkout and the merge base, each
// with its own build of the CLI and deep-hook), a world per side (a home, a git repository with worktrees, and the
// definitions the kernel is handed), `deep hub run` per side, Claude Code sessions played through each side's own
// deep-hook, and the record read back through the hub's socket (`events.read`). Nothing here stands in for the hub,
// the gate runner, deep-hook or the check runner: every timing comes from the hub's own record. The generic process,
// socket and env tools are imported from the #29 suite's tests/acceptance/29/h-d.ts, never copied; the session player
// is this file's own, since h-d.ts's binds the deep-hook of this checkout only.
//
// Safety: folders are under /tmp/dh29-* (made by h-d.ts's tempDir, removed by its cleanup); no network (the forge is a
// closed local port), no model, no real `claude`, no sign-in. Every process a test starts is stopped by its PID, never
// by name or port. The merge base's copy is built under this checkout's git-ignored target/ folder.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { alive, childEnv, control, own, parseObject, sleep, tempDir, type Hub as Hub29, type Line, type Ran } from '../../29/h-d.ts';

export { cleanup } from '../../29/h-d.ts';
export { sleep };

/** The criterion's tag, as scripts/proof-change.mjs computes it from the issue's text. */
export const AC6 = 'AC6 #1018.e558130f';
export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const NODE = process.execPath;
/** The stand-in Claude Code process of the #29 suite: its children are a session's deep-hook runs. */
const AGENT = fileURLToPath(new URL('../../29/fixtures/agent.mjs', import.meta.url));

// ---- The two sides.
/** One side of the comparison: a checkout with its own built CLI and deep-hook. */
export interface Side { name: 'this side' | 'merge base'; root: string; commit: string; cli: string; deepHook: string; rules: string; covered: string }
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function sideAt(name: Side['name'], root: string, commit: string, deepHook: string): Side {
  const cli = join(root, 'packages/cli/dist/main.js');
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', cli], ['deep-hook (cargo build -p deep-hook)', deepHook]] as const) {
    if (!existsSync(path)) throw Error(`BLOCKED: ${name}: ${what} is not built at ${path}`);
  }
  const facts = JSON.parse(readFileSync(join(root, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] };
  return { name, root, commit, cli, deepHook, rules: join(root, 'crates/deep-hook/default-rules.json'), covered: facts.versions[facts.versions.length - 1]! };
}
/** This checkout, as built. */
export function thisSide(): Side {
  return sideAt('this side', REPO, git(REPO, 'rev-parse', 'HEAD'), join(REPO, 'target/debug/deep-hook'));
}
/** The merge base with origin/main; BLOCKED when there is none. */
export function mergeBase(): string {
  try {
    return git(REPO, 'merge-base', 'HEAD', 'origin/main');
  } catch (e) {
    throw Error(`BLOCKED: no merge base to compare with (git merge-base HEAD origin/main in ${REPO}): ${(e as Error).message.split('\n')[0]}`);
  }
}
/**
 * The merge base, exported whole by `git archive` into this checkout's git-ignored target/ folder and built there as
 * the repo builds itself: `npm ci`, `npm run build --workspaces`, and `cargo build -p deep-hook` into its own target
 * folder. Kept by commit, so a second run reuses it. A build that fails is BLOCKED, naming the step.
 */
export function mergeBaseSide(sha: string): Side {
  const dir = join(REPO, 'target', 'acceptance-1018-ac6-base', sha.slice(0, 12));
  const done = join(dir, '.built');
  if (!existsSync(done)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = `${dir}.tar`;
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-mxf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    const steps: [string, string[], NodeJS.ProcessEnv][] = [
      ['npm', ['ci', '--no-audit', '--no-fund'], {}],
      ['npm', ['run', 'build', '--workspaces'], {}],
      ['cargo', ['build', '-p', 'deep-hook'], { CARGO_TARGET_DIR: join(dir, 'target') }],
    ];
    for (const [command, args, env] of steps) {
      const r = spawnSync(command, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 });
      if (r.status !== 0) throw Error(`BLOCKED: the merge base ${sha.slice(0, 12)} did not build: ${command} ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.error?.message || '').slice(-1500)}`);
    }
    writeFileSync(done, `${sha}\n`);
  }
  return sideAt('merge base', dir, sha, join(dir, 'target/debug/deep-hook'));
}

// ---- The machine.
export interface Judged { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; margin?: number; reason?: string }
interface Benchmark {
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown> }): Judged;
}
/** The repo's own fingerprint and judge for a timing result (scripts/benchmark.mjs). */
export const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;
/** Why this machine can't time a budget now: off a reference Mac (as judgeLimit reads it), or loaded past its core count. Null when it can. */
export async function machineProblem(): Promise<string | null> {
  const { fingerprint, judgeLimit } = await benchmark();
  const off = judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: fingerprint() });
  if (off.status === 'INCONCLUSIVE') return off.reason ?? 'off the reference Macs';
  return loadProblem();
}
export function loadProblem(): string | null {
  const [one] = loadavg();
  return one! > availableParallelism() ? `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores` : null;
}

// ---- A world per side.
/** The prompt the measuring sessions type: its definition has one check, C01. */
export const MEASURE_ASK = 'make the cart total round each line to cents';
/** The prompt the seeding sessions type: its definition has the twenty checks C01 to C20. */
export const SEED_ASK = 'keep the cart total in cents through every checkout path';
export const CART = 'src/cart.ts';
export const CHECKS = Array.from({ length: 20 }, (_, i) => `.deepbuild/checks/c${String(i + 1).padStart(2, '0')}.sh`);
export const C01 = CHECKS[0]!;
/** Your ask settings, as the #29 suite writes them. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
const requirement = (id: string, check: string) => ({
  id, text: `the cart total is in cents (${check})`, source_line: 'ask#L1', refuted_by: `a run of ${check} that fails`, check,
  on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [],
});
export interface World { side: Side; tmp: string; home: string; root: string; repo: string; confirm: string; drafts: string; work: string }
const gitIn = (tmp: string, cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
  cwd, encoding: 'utf8',
  env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
}).trim();
/** `src/cart.ts` with a content named by `tag`: each tag a tree of its own, so a key of its own for every check. */
export const cart = (tag: string): string => `// cents\nexport function total(lines: number[]): number {\n  return Math.round(lines.reduce((a, b) => a + b, 0) * 100) / 100;\n}\nexport const version = '${tag}';\n`;
/**
 * `<tmp>/h` is HOME (its `.deepbuild` holds the side's shipped default guards and your ask settings); `<tmp>/repo` is a
 * git repository with one commit on main holding `src/cart.ts` and twenty drafted checks, each `sh` running a node:test
 * suite of one test that reads `src/cart.ts`. Every other folder a session works in is a `git worktree` of it, made by
 * `worktree()`, so every session works in one repo.
 */
export function makeWorld(side: Side): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(side.rules, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, '.deepbuild', 'checks'), { recursive: true });
  writeFileSync(join(repo, CART), cart('base'));
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', type: 'module' }, null, 2)}\n`);
  for (const check of CHECKS) {
    const suite = check.replace(/\.sh$/, '.test.mjs');
    writeFileSync(join(repo, check), `#!/bin/sh\nnode --test ${suite}\n`);
    chmodSync(join(repo, check), 0o755);
    writeFileSync(join(repo, suite), `import { test } from 'node:test';\nimport { readFileSync } from 'node:fs';\nimport assert from 'node:assert/strict';\ntest('${check}: the cart is in cents', () => { assert.match(readFileSync('${CART}', 'utf8'), /cents/); });\n`);
  }
  gitIn(tmp, repo, 'init', '-q', '-b', 'main');
  gitIn(tmp, repo, 'add', '.');
  gitIn(tmp, repo, 'commit', '-q', '-m', 'the cart and its drafted checks');
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [
    { ask: MEASURE_ASK, requirements: [requirement('R1', C01)], deliverables: [CART], budget: null },
    { ask: SEED_ASK, requirements: CHECKS.map((c, i) => requirement(`R${i + 1}`, c)), deliverables: [CART], budget: null },
  ] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
  return { side, tmp, home, root, repo: realpathSync(repo), confirm, drafts, work };
}
/** A new worktree of the world's repo, on a branch of its own from main's one commit. */
export function worktree(w: World, name: string): string {
  const dir = join(w.tmp, name);
  gitIn(w.tmp, w.repo, 'worktree', 'add', '-q', '-b', name, dir, 'main');
  return realpathSync(dir);
}

// ---- The hub per side.
export interface Hub { side: Side; pid: number; socket: string; root: string; child: ChildProcess; exit: Promise<void>; stderr(): string }
/** `deep hub run` from the side's own build, HOME the world's, with the #29 suite's test settings and a closed forge port. */
export async function startHub(w: World): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9' });
  const child = spawn(NODE, [w.side.cli, 'hub', 'run'], { cwd: w.side.root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: ${w.side.name}'s hub did not start: ${err.slice(-1500)}`);
  return { side: w.side, pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), root: w.root, child, exit, stderr: () => err };
}
export async function stopHub(hub: Hub): Promise<void> {
  try { process.kill(hub.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 30_000;
  while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
  if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
  await hub.exit;
}
const hubState = (hub: Hub): string => `${hub.side.name}'s hub (pid ${hub.pid}) ${alive(hub.pid) ? 'is running' : 'has exited'}; its stderr ends ${JSON.stringify(hub.stderr().slice(-1200))}`;


// ---- The record, read incrementally through `events.read`.
export interface Ev { id: string; kind: string; log_pos: number; ts: number; session?: string; subject?: string; data: Line }
export interface RunSeen { run: string; claim: string; check: string; commit: string; started: number; finished: number | null; outcome: string | null }
/** The kinds this suite reads; the rest of the log is read and dropped. */
const READ = new Set(['user.ask', 'definition.locked', 'agent.stop', 'claim.made', 'verdict.made', 'run.started', 'run.finished']);
/** The hub's record, read once each event and indexed by what this suite reads. One read at a time. */
export class Log {
  private after = 0;
  private reading: Promise<void> = Promise.resolve();
  /** user.ask and definition.locked, for the task an ask opened. */
  readonly asks: Ev[] = [];
  /** Each session's claim.made and its own agent.stop events (a child's left out), in log order. */
  readonly claimsOf = new Map<string, Ev[]>();
  readonly stopsOf = new Map<string, Ev[]>();
  /** The newest verdict.made of each claim, by claim handle. */
  readonly verdicts = new Map<string, Ev>();
  readonly runs = new Map<string, RunSeen>();
  private readonly byClaim = new Map<string, RunSeen[]>();
  constructor(readonly hub: Hub) {}
  pull(): Promise<void> {
    this.reading = this.reading.then(() => this.read());
    return this.reading;
  }
  private async read(): Promise<void> {
    for (;;) {
      const got = await control(this.hub as unknown as Hub29, 'events.read', { after: this.after, limit: 1000 });
      const events = (typeof got.events === 'string' ? JSON.parse(got.events) : got.events) as Ev[];
      if (!events.length) return;
      for (const e of events) {
        if (!READ.has(e.kind)) continue;
        const d = e.data ?? {};
        if (e.kind === 'user.ask' || e.kind === 'definition.locked') this.asks.push(e);
        else if (e.kind === 'claim.made' && e.session) this.claimsOf.set(e.session, [...(this.claimsOf.get(e.session) ?? []), e]);
        else if (e.kind === 'agent.stop' && e.session && (d.child === undefined || d.child === null)) this.stopsOf.set(e.session, [...(this.stopsOf.get(e.session) ?? []), e]);
        else if (e.kind === 'verdict.made' && typeof d.claim === 'string') this.verdicts.set(d.claim, e);
        else if (e.kind === 'run.started' && typeof d.run === 'string') {
          const r: RunSeen = { run: d.run, claim: String(d.claim), check: String(d.check), commit: String(d.commit), started: e.ts, finished: null, outcome: null };
          this.runs.set(r.run, r);
          this.byClaim.set(r.claim, [...(this.byClaim.get(r.claim) ?? []), r]);
        } else if (e.kind === 'run.finished' && typeof d.run === 'string') {
          const r = this.runs.get(d.run);
          if (r) { r.finished = e.ts; r.outcome = String(d.outcome); }
        }
      }
      this.after = events[events.length - 1]!.log_pos;
    }
  }
  /** The claim's own runs: those whose run.started names it. */
  runsOf(claim: string): RunSeen[] {
    return this.byClaim.get(claim) ?? [];
  }
  /** Reads until `done` gives a value; BLOCKED past `timeoutMs`. */
  async until<T>(what: string, done: () => T | undefined, timeoutMs = 180_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.pull();
      const v = done();
      if (v !== undefined) return v;
      if (Date.now() > deadline) throw Error(`BLOCKED: ${what} within ${timeoutMs / 1000} s; ${hubState(this.hub)}`);
      await sleep(20);
    }
  }
}

// ---- Claude Code sessions, played through the side's own deep-hook.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Ran) => void>();
  constructor(private readonly child: ChildProcess) {
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
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, args, cwd, input, timeoutMs })}\n`);
    });
  }
}
const shown = (r: Ran) => `exit ${r.code}${r.timedOut ? ' (timed out)' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;
const allowed = (r: Ran): boolean => {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  return r.code === 0 && (d === undefined || d === 'allow');
};
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(6).toString('hex')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
let calls = 0;
/** The prompt that begins each turn after the first: a question you type, which opens no task (as the #29 suite's QUESTION). */
export const NEXT_TURN = 'explain how the cart total is rounded';

/** One claim as the record has it, timed on the hub's own clock. */
export interface Claimed {
  claim: string;
  /** The claim's Stop as the record has it: its agent.stop event's time. */
  stoppedAt: number;
  /** verdict.made's time and outcome. */
  verdictAt: number;
  outcome: string;
  verdict: Ev;
  /** The claim's own runs (run.started naming it), and how long they took, from the first start to the last finish. */
  runs: RunSeen[];
  runSpan: number;
  /** From the stop to the verdict, in ms. */
  latency: number;
}

/** A Claude Code session in one folder of the world's repo: its transcript, its own Claude Code process, its hooks. */
export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  private readonly agent: Agent;
  private promptId: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  private claims = 0;
  task: string | undefined;
  constructor(readonly w: World, readonly cwd: string) {
    this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    const child = spawn(NODE, [AGENT, w.side.deepHook], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    this.agent = new Agent(child);
  }
  private entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: this.w.side.covered, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  private hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.promptId && event !== 'SessionStart' ? { prompt_id: this.promptId } : {}), ...fields };
    return this.agent.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
  }
  /** SessionStart, then the ask typed: waits until it opened one task whose definition is locked. */
  async open(record: Log, ask: string): Promise<void> {
    const started = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (started.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(started)}`);
    await this.typed(ask);
    this.task = await record.until(`the typed ask "${ask}" opened no task with a locked definition`, () => {
      const typed = record.asks.find((e) => e.kind === 'user.ask' && e.session === this.id && e.data.text === ask);
      const ref = Array.isArray(typed?.data.tasks) && typed!.data.tasks.length === 1 ? String(typed!.data.tasks[0]) : undefined;
      return ref !== undefined && record.asks.some((e) => e.kind === 'definition.locked' && e.data.task_ref === ref) ? ref : undefined;
    });
  }
  private async typed(text: string): Promise<void> {
    this.promptId = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
  }
  /** The agent writes `src/cart.ts` whole (Edit), and the write is made. */
  private async write(content: string): Promise<void> {
    const path = join(this.cwd, CART);
    const from = readFileSync(path, 'utf8');
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    const input = { file_path: path, old_string: from, new_string: content, replace_all: false };
    this.entry(assistant([{ type: 'tool_use', id, name: 'Edit', input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name: 'Edit', tool_input: input, tool_use_id: id });
    if (!allowed(before)) throw Error(`BLOCKED: the Edit of ${CART} must be allowed: ${shown(before)}`);
    writeFileSync(path, content);
    const response = { filePath: path, oldString: from, newString: content, replaceAll: false, structuredPatch: [], userModified: false };
    this.entry({ promptId: this.promptId, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name: 'Edit', tool_input: input, tool_use_id: id, tool_response: response, duration_ms: 40 });
  }
  /**
   * One claim: a turn that sets `src/cart.ts` to `content` and stops; the stop rule reads a stop whose turn did work as
   * a claim. The first claim's turn is the one that typed the ask; each later one begins with NEXT_TURN. Resolves once
   * the claim's verdict is recorded and none of its runs is still going, with its times on the hub's clock.
   */
  async claim(record: Log, content: string, timeoutMs = 180_000): Promise<Claimed> {
    if (this.claims > 0) await this.typed(NEXT_TURN);
    await this.write(content);
    this.entry(assistant([{ type: 'text', text: 'Done.' }], 'end_turn'));
    const k = this.claims++;
    const ran = await this.hook('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
    if (ran.code === null) throw Error(`BLOCKED: the Stop hook did not end: ${shown(ran)}`);
    const made = await record.until(`the session's stop ${k + 1} made no claim (claim.made); its Stop hook replied ${shown(ran)}`, () => record.claimsOf.get(this.id)?.[k], timeoutMs);
    const claim = `claim:${made.id}`;
    const verdict = await record.until(`${claim} got no verdict (verdict.made) with all its runs ended`, () => {
      const v = record.verdicts.get(claim);
      return v && record.runsOf(claim).every((r) => r.finished !== null) ? v : undefined;
    }, timeoutMs);
    const stops = record.stopsOf.get(this.id) ?? [];
    const stop = [...stops].reverse().find((e) => e.log_pos <= made.log_pos) ?? stops.find((e) => e.log_pos > made.log_pos);
    if (!stop) throw Error(`BLOCKED: ${claim} has no agent.stop of its session in the record`);
    const runs = record.runsOf(claim);
    const runSpan = runs.length ? Math.max(...runs.map((r) => r.finished!)) - Math.min(...runs.map((r) => r.started)) : 0;
    return { claim, stoppedAt: stop.ts, verdictAt: verdict.ts, outcome: String(verdict.data.outcome), verdict, runs, runSpan, latency: verdict.ts - stop.ts };
  }
}

// ---- One side's bench: its world, its hub, and the two measuring sessions in worktrees of their own.
export interface Bench { w: World; hub: Hub; rec: Log; a: Session; b: Session }
export async function bench(side: Side): Promise<Bench> {
  const w = makeWorld(side);
  const hub = await startHub(w);
  const rec = new Log(hub);
  const a = new Session(w, worktree(w, 'wa'));
  const b = new Session(w, worktree(w, 'wb'));
  await a.open(rec, MEASURE_ASK);
  await b.open(rec, MEASURE_ASK);
  return { w, hub, rec, a, b };
}
/**
 * Keys kept: a seeding session in a worktree of its own types SEED_ASK and claims a new `src/cart.ts` until `keys`
 * results are kept, twenty a claim (one per check, each on a tree no claim had before). One claim at a time, so its
 * twenty checks fit the stop's fast lane. Every seeding claim must PASS with all twenty checks run on its own; anything
 * else is BLOCKED, as the record would then hold fewer keys. Returns how many distinct (check, snapshot) results passed.
 */
export async function seed(x: Bench, keys: number): Promise<number> {
  const session = new Session(x.w, worktree(x.w, 'seeding'));
  await session.open(x.rec, SEED_ASK);
  for (let i = 0; i < Math.ceil(keys / CHECKS.length); i++) {
    const c = await session.claim(x.rec, cart(`seed ${i} ${randomBytes(6).toString('hex')}`), 600_000);
    const ran = new Set(c.runs.filter((r) => r.outcome === 'passed').map((r) => r.check));
    if (c.outcome !== 'PASS' || CHECKS.some((k) => !ran.has(k))) {
      throw Error(`BLOCKED: ${x.w.side.name}: seeding claim ${i} (${c.claim}) must PASS with all ${CHECKS.length} checks run on its own; it reads ${c.outcome} with ${ran.size} passed runs of its own`);
    }
  }
  return new Set([...x.rec.runs.values()].filter((r) => r.outcome === 'passed').map((r) => `${r.check}\0${r.commit}`)).size;
}
/** One pair: A claims `content` in its worktree, its verdict lands, then B claims the same content in its own. */
export async function pairOn(x: Bench, content: string): Promise<{ a: Claimed; b: Claimed }> {
  const a = await x.a.claim(x.rec, content);
  const b = await x.b.claim(x.rec, content);
  return { a, b };
}
/** The gate's own time on a claim: from its stop to its verdict, less the time its own runs took. */
export const gateTime = (c: Claimed): number => c.latency - c.runSpan;

// ---- Numbers.
/** The p-th percentile by the nearest-rank method: the smallest value with at least p% of the values at or below it. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
export const fixed = (xs: readonly number[], d = 1): string => xs.map((x) => x.toFixed(d)).join(', ');

// ---- The measurement.
/** A pair measures carrying only when, on this side, A's claim ran its own check and B's read A's run, carried. */
export function carriedOrFail(p: PairSample, i: number): void {
  const { a, b } = p.head;
  const aRuns = a.runs.filter((r) => r.check === C01);
  expect(a.outcome, `pair ${i}: this side's A claim ${a.claim} must PASS (its verdict.made)`).toBe('PASS');
  expect(aRuns.length, `pair ${i}: this side's A claim ${a.claim} is on a tree no claim had before, so ${C01} must run for it (a run.started naming it); none did, so it read a result no run on its key made`).toBeGreaterThan(0);
  expect(b.outcome, `pair ${i}: this side's B claim ${b.claim} must PASS on the result it carries`).toBe('PASS');
  expect(b.runs.length, `pair ${i}: this side's B claim ${b.claim}, in another session and worktree on A's tree, must read A's result (${aRuns.map((r) => r.run).join(', ')}) as carried and run nothing of its own; it ran ${b.runs.map((r) => `${r.run} (${r.check})`).join(', ')}`).toBe(0);
  const named = aRuns.filter((r) => JSON.stringify(b.verdict.data).includes(r.run));
  expect(named.length, `pair ${i}: B's verdict (${b.verdict.id}) must name the run it carried, A's ${aRuns.map((r) => r.run).join(', ')}: ${JSON.stringify(b.verdict.data).slice(0, 800)}`).toBeGreaterThan(0);
  for (const [who, c] of [['A', p.base.a], ['B', p.base.b]] as const) {
    if (c.outcome !== 'PASS' || !c.runs.length) throw Error(`BLOCKED: the merge base's ${who} claim ${c.claim} must PASS on a run of its own; it reads ${c.outcome} with ${c.runs.length} runs`);
  }
}

/** One pair of claims on each side, on the same content: A's claim (a key no claim had), then B's in another session. */
export interface PairSample { head: { a: Claimed; b: Claimed }; base: { a: Claimed; b: Claimed } }
/**
 * `n` pairs, each on a content of its own, the two sides taking turns going first. `check` sees each pair as it lands,
 * so a pair that measures nothing stops the run at once.
 */
export async function pairs(head: Bench, base: Bench, n: number, tag: string, check: (p: PairSample, i: number) => void): Promise<PairSample[]> {
  const out: PairSample[] = [];
  for (let i = 0; i < n; i++) {
    const content = cart(`${tag} ${i} ${randomBytes(6).toString('hex')}`);
    const first = i % 2 === 0 ? head : base;
    const second = first === head ? base : head;
    const one = await pairOn(first, content);
    const two = await pairOn(second, content);
    const p = first === head ? { head: one, base: two } : { head: two, base: one };
    check(p, i);
    out.push(p);
  }
  return out;
}
/**
 * One run's figures, in ms, for one kind of claim (`a` or `b`): the p95 of the gate's own time on each side, what this
 * side adds (head's p95 less the merge base's), and the run's noise floor: the merge base's own p95 over its even pairs
 * less that over its odd pairs, which two samples of one program differ by.
 */
export interface Figures { head: number; base: number; adds: number; floor: number; headP50: number; baseP50: number }
export function figures(run: readonly PairSample[], which: 'a' | 'b'): Figures {
  const head = run.map((p) => gateTime(p.head[which]));
  const base = run.map((p) => gateTime(p.base[which]));
  const even = base.filter((_, i) => i % 2 === 0);
  const odd = base.filter((_, i) => i % 2 === 1);
  const h = percentile(head, 95);
  const b = percentile(base, 95);
  return { head: h, base: b, adds: h - b, floor: percentile(even, 95) - percentile(odd, 95), headP50: percentile(head, 50), baseP50: percentile(base, 50) };
}
/**
 * The resolution of a figure over five runs: the root mean square of the five noise floors, over √2. A floor compares
 * two half-size samples of one program, so its spread is about √2 times that of `adds`, which compares two full ones.
 */
export const resolution = (floors: readonly number[]): number => Math.sqrt(floors.reduce((s, f) => s + f * f, 0) / floors.length) / Math.SQRT2;
