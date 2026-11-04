// Shared test-side tools for issue #1263 (README): "all done?" typed in a Claude Code session is answered from the
// record although Claude Code writes the prompt's transcript entry only after its UserPromptSubmit hooks returned.
// A temporary home with stubbed system tools, `deep setup` through the built CLI, the hub as a process and its socket,
// and the Claude Code stand-in (fixtures/claude.mjs, #83's as-is) driven with Claude Code 2.1.308's timing: a typed
// prompt's entry is appended only once the prompt's hooks have returned, and never for a prompt a hook blocked.
// Parts are adapted from tests/acceptance/567/helpers.ts and tests/acceptance/83/helpers.ts (same repo, same license);
// this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild:
// every test reaches it through the CLI, deep-hook as setup's entries run it, and the hub's socket.

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
/** Where each run's proof goes (README: The proof), rewritten on each run and never read back. */
export const PROOF_DIR = join(tmpdir(), 'deep-1263-proof');

/** The criteria, each named by its number in the issue's order and its ID (README: Criteria to tests). */
export const AC1 = 'AC1 #1263.e768d825';
export const AC2 = 'AC2 #1263.19b14762';
export const AC3 = 'AC3 #1263.0fb7dbd3';
/** The status question the issue names. */
export const STATUS_QUESTION = 'all done?';
/** How long the record may take to show the blocked prompt (Readings, 4): past the hub's own wait for a late entry. */
export const RECORDED_WITHIN_MS = 15_000;

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
export const readLines = (file: string | undefined | null): Line[] => (file && existsSync(file) ? jsonLines(readFileSync(file, 'utf8')) : []);
/** The newest Claude Code version the facts cover (2.1.308 at the base): the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

/**
 * A criterion judged: node:assert's own assertion failure, raised here under the test paths, so the proof lane reads
 * it as failing at its assertion (design: Failing on an assertion). Where nothing could be judged, the tests throw a
 * plain Error whose message starts BLOCKED, INVALID or INCONCLUSIVE instead.
 */
export function must(ok: unknown, message: string): asserts ok {
  assert.ok(ok, message);
}

// ---- Temp folders under /tmp/dh1263-*: a Unix socket path must stay short.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1263-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started: stopped by PID (and the process groups the stand-in made), never by name or port.
const owned = new Set<number>();
const groups = new Set<number>();
export function own(pid: number | undefined): void { if (pid) owned.add(pid); }
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
export async function cleanup(): Promise<void> {
  for (const g of groups) try { process.kill(-g, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) for (const target of [pid, -pid]) try { process.kill(target, 'SIGKILL'); } catch { /* gone */ }
  for (const g of groups) try { process.kill(-g, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  groups.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that bill an account or reach a forge; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
/** HOME the test's home, the stand-ins first on PATH, and no DEEP_, CLAUDE, GIT_, XDG_, forge or billing variable of this process's. */
export function childEnv(w: World): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|GIT_|XDG_|OTEL_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: w.home, SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${w.bin}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, DEEP_HUB_TEST_CONFIRM: join(w.tmp, 'confirm'),
  });
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(redact(r.stdout.slice(-1500)))}, stderr ${JSON.stringify(redact(r.stderr.slice(-1500)))}`;

/** Redacts this machine's home folder and the temp folders from proof and messages (AGENTS.md: no personal data in evidence). */
export const redact = (text: string): string => text.split(process.env.HOME || '\u0000').join('~').replace(/\/tmp\/dh1263-[A-Za-z0-9]+/g, '<tmp>');
export function writeProof(file: string, content: string): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, file), redact(content));
}

// ---- The world (README: The fixture repo): a home, stubbed system tools, and a repo with a spec check.
export const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
export const UNIT_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken rejects an expired token', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\ntest('checkToken accepts a token that has not expired', () => {\n  assert.strictEqual(auth.checkToken({ exp: Date.now() / 1000 + 3600 }), true);\n});\n";
export const AUTH_JS = "module.exports = {\n  checkToken: (token) => token.exp > 0,\n};\n";
/** The edit that makes the spec's unit check pass: the session's work. */
export const FIX = { from: 'token.exp > 0', to: 'token.exp > Date.now() / 1000' } as const;
export const PROMPT = 'Make checkToken in src/auth.js reject expired tokens.';
export const DONE = 'Done. Expired tokens are rejected and the unit tests pass.';

export interface World { tmp: string; home: string; bin: string; repo: string; hookLog: string }
export function makeWorld(): World {
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
  writeFileSync(join(bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  chmodSync(join(bin, 'deep'), 0o755);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const repo = join(tmp, 'shop');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'tests'), { recursive: true });
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  writeFileSync(join(repo, 'src', 'auth.js'), AUTH_JS);
  writeFileSync(join(repo, 'tests', 'unit.test.js'), UNIT_TEST);
  writeFileSync(join(repo, '.deepbuild', 'done.yaml'), SPEC);
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', private: true, scripts: { test: 'node --test tests/unit.test.js' } }, null, 2)}\n`);
  const w: World = { tmp, home, bin, repo: realpathSync(repo), hookLog: join(tmp, 'hooks.jsonl') };
  git(w, 'init', '-q', '-b', 'main');
  git(w, 'add', '.');
  git(w, 'commit', '-q', '-m', 'Start the shop');
  // Claude Code's own state: first-run screens done, and the repo trusted in its workspace trust, which the core
  // reuses as project trust, so the spec's command check runs at the stop (#322, #348).
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', numStartups: 3, projects: { [w.repo]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  return w;
}
export function git(w: World, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd: w.repo, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: w.tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  if (r.status !== 0) throw Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
export function editFile(w: World, file: string, change: { from: string; to: string }): void {
  const path = join(w.repo, file);
  const before = readFileSync(path, 'utf8');
  if (!before.includes(change.from)) throw Error(`${file} doesn't hold ${JSON.stringify(change.from)}`);
  writeFileSync(path, before.replace(change.from, change.to));
}

// ---- deep-hook and the CLI, as built at the checkout under test (never built here).
export function ensureBuilt(): void {
  if (!existsSync(CLI)) throw Error('BLOCKED: packages/cli/dist/main.js is missing; run `npm run build --workspaces` first');
  if (!existsSync(DEEP_HOOK)) throw Error('BLOCKED: target/debug/deep-hook is missing; run `cargo build --locked -q -p deep-hook` first');
}
export const settingsFile = (w: World) => join(w.home, '.claude', 'settings.json');
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
/** `deep setup` with HOME the test's home and the system tools stubbed: DeepBuild's entries in Claude Code's user settings. */
export async function setup(w: World): Promise<void> {
  const r = await run(NODE, [CLI, 'setup'], { env: childEnv(w), cwd: w.repo, timeoutMs: 180_000 });
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  const settings = parseObject(readFileSync(settingsFile(w), 'utf8')) ?? {};
  const prompts = ((settings.hooks?.UserPromptSubmit ?? []) as Line[]).flatMap((g) => (g.hooks ?? []) as Line[]).filter((h) => isDeepBuild(h.command) && !h.async && !h.asyncRewake);
  if (!prompts.length) throw Error(`BLOCKED: deep setup wrote no foreground UserPromptSubmit entry of DeepBuild's, the entry that answers a status question (#83): ${redact(JSON.stringify(settings.hooks?.UserPromptSubmit ?? null)).slice(0, 800)}`);
}

// ---- The hub: `deep hub run`, HOME the test's home (#16), with no test seam but the OS confirmation stub.
export interface Hub { pid: number; socket: string; root: string; child: ChildProcess; output(): string }
export async function startHub(w: World): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(w), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const first = await new Promise<Line | undefined>((resolve) => {
    let head = '';
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      head += d;
      if (head.includes('\n')) { clearTimeout(timer); resolve(parseObject(head.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (first?.ready !== true) throw Error(`BLOCKED: the hub didn't start: ${redact(out.slice(0, 2000))}`);
  const root = join(w.home, '.deepbuild');
  return { pid: child.pid!, socket: String(first.socket ?? join(root, 'hub.sock')), root, child, output: () => out };
}
/** One request on a cli connection with the control token (#16's line protocol). */
export function control(hub: Hub, method: string, params: Line = {}, timeoutMs = 30_000): Promise<Line> {
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
export interface Ev { id: string; kind: string; log_pos: number; ts: number; session?: string; subject?: string; data: Line }
export async function allEvents(hub: Hub): Promise<Ev[]> {
  const out: Ev[] = [];
  let after = 0;
  for (;;) {
    const read = await control(hub, 'events.read', { after, limit: 1000 });
    const events = (typeof read.events === 'string' ? JSON.parse(read.events) : read.events) as Ev[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos;
  }
}
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 400)}` : 'no event');
/** The session's prompts in the record (user.ask) after a log position. */
export const asksAfter = (events: readonly Ev[], session: string, after: number): Ev[] => events.filter((e) => e.kind === 'user.ask' && e.session === session && e.log_pos > after);

// ---- The Claude Code stand-in (fixtures/claude.mjs, #83's copy as-is): one process per session.
export interface HookRun { command: string; async: boolean; pid: number; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; blocked?: string; shown?: string[]; model?: boolean; settingsError?: string }
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  exited = false;
  private constructor(private readonly child: ChildProcess, readonly w: World) {
    child.on('exit', () => { this.exited = true; for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  static start(w: World): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude.mjs'), CLI, FACTS, w.hookLog], { cwd: w.tmp, env: childEnv(w), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Claude(child, w);
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
  /** Fires one hook: every entry of the user settings file for it, as Claude Code runs them. */
  async hook(event: string, body: Line): Promise<Fired> {
    const fired = (await this.send({ op: 'hook', event, payload: body, settings: settingsFile(this.w) })) as unknown as Fired;
    for (const r of [...fired.ran, ...fired.background]) groups.add(r.pid);
    return fired;
  }
  /** A built-in tool call: its tool_use entry, PreToolUse, its tool_result entry, PostToolUse. */
  async tool(s: Session, tool: string, input: Line, response: Line): Promise<void> {
    const call = `toolu_${tag(12)}`;
    appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-4-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: call, name: tool, input }], stop_reason: 'tool_use', usage: { input_tokens: 2, output_tokens: 10 } } });
    await this.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: call }));
    appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: [{ tool_use_id: call, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', payload(s, 'PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: call, tool_response: response }));
  }
  async end(): Promise<void> {
    const gone = new Promise<void>((resolve) => { if (this.exited) resolve(); else this.child.once('exit', () => resolve()); });
    await this.send({ op: 'end' }).catch(() => undefined);
    await gone;
  }
}
export function newSession(w: World): Session {
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd: w.repo, transcript };
}
/** A hook's payload with the fields Claude Code 2.1.308 sends; a prompt's carries no origin of its own (the issue). */
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  if (event === 'SessionStart') { Object.assign(base, { source: 'startup', model: 'claude-haiku-4-5' }); delete base.prompt_id; }
  if (event === 'UserPromptSubmit') base.scratchpad_dir = join(dirname(s.transcript), s.id, 'scratchpad');
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false });
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}

/**
 * A prompt you typed, with Claude Code 2.1.308's timing (README: Readings, 1): its UserPromptSubmit fires first, with
 * no entry for it in the transcript; its entry (origin human) is appended only once the prompt's hooks have returned,
 * and never when a hook blocked it (the prompt isn't processed: Claude Code keeps only the hook_blocked_prompt
 * attachment the stand-in writes).
 */
export async function typedLater(claude: Claude, s: Session, text: string): Promise<Fired> {
  s.prompt = randomUUID();
  const fired = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
  if (fired.blocked === undefined) appendTranscript(s, { promptId: s.prompt, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return fired;
}

/** The agent's last words, then its Stop. */
export async function stop(claude: Claude, s: Session, words: string): Promise<Fired> {
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-4-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: words }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 10 } } });
  return claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: words }));
}
export const deepRuns = (f: Fired): HookRun[] => f.ran.filter((r) => isDeepBuild(r.command));
export const firedShown = (f: Fired) => redact(JSON.stringify({ blocked: f.blocked, shown: f.shown, model: f.model, runs: f.ran.map((r) => ({ command: r.command.slice(0, 120), code: r.code, signal: r.signal, timedOut: r.timedOut, ms: r.ended === null ? null : r.ended - r.started, stdout: r.stdout.slice(0, 800), stderr: r.stderr.slice(0, 400) })) }));
/** DeepBuild's own answer to a prompt: the reason its UserPromptSubmit entry blocked it with, or undefined. */
export function answerOf(f: Fired): string | undefined {
  for (const r of deepRuns(f)) {
    const reply = parseObject(r.stdout);
    if (r.code === 0 && reply?.decision === 'block' && typeof reply.reason === 'string') return reply.reason;
    if (r.code === 2 && r.stderr.trim()) return r.stderr.trim();
  }
  return undefined;
}
/** Whether the stand-in's hook log shows the prompt reaching the model (README: The hook log). */
export const modelCalled = (w: World, s: Session, prompt: string): boolean => readLines(w.hookLog).some((l) => l.phase === 'model' && l.session === s.id && l.prompt === prompt);

// ---- The shared scenario: one home, `deep setup`, one hub; sessions in it.
export interface Scene { w: World; hub: Hub }
let scene: Promise<Scene> | undefined;
export function world(): Promise<Scene> {
  scene ??= (async () => {
    ensureBuilt();
    const w = makeWorld();
    const hub = await startHub(w);
    await setup(w);
    return { w, hub };
  })();
  return scene;
}
/** The record's line for a claim, as the chat showed it (#83's receipt: `changes.read {id: claim:<id>}`'s `line`). */
export async function lineOf(hub: Hub, claim: Ev): Promise<string | undefined> {
  const change = ((await control(hub, 'changes.read', { id: `claim:${claim.id}` })).change ?? {}) as Line;
  return typeof change.line === 'string' ? change.line : undefined;
}
export interface Judged { s: Session; claude: Claude; claim: Ev; line: string; stopped: Fired }
/**
 * A session whose stop was judged (the verdict the status question comes after): a typed prompt, with 2.1.308's
 * timing; a Read and the Edit that fixes the bug; then the agent stops saying it's done. The stop's claim, its spec
 * check's run finished, and the record's line for it. BLOCKED when the record holds no settled claim for the stop.
 */
export async function judgedSession(sc: Scene): Promise<Judged> {
  const s = newSession(sc.w);
  const claude = Claude.start(sc.w);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  await typedLater(claude, s, PROMPT);
  const auth = join(sc.w.repo, 'src/auth.js');
  await claude.tool(s, 'Read', { file_path: auth }, { type: 'text', file: { filePath: auth, content: readFileSync(auth, 'utf8') } });
  editFile(sc.w, 'src/auth.js', FIX);
  await claude.tool(s, 'Edit', { file_path: auth, old_string: FIX.from, new_string: FIX.to }, { filePath: auth, oldString: FIX.from, newString: FIX.to });
  const stopped = await stop(claude, s, DONE);
  const deadline = Date.now() + 60_000;
  for (;;) {
    const events = await allEvents(sc.hub);
    const claim = events.filter((e) => e.kind === 'claim.made' && e.session === s.id).at(-1);
    const runs = claim ? events.filter((e) => e.kind === 'run.started' && e.data.claim === `claim:${claim.id}`) : [];
    const settled = claim && runs.length && runs.every((r) => events.some((f) => f.kind === 'run.finished' && f.data.run === r.data.run));
    const line = claim && settled ? await lineOf(sc.hub, claim) : undefined;
    if (claim && line) return { s, claude, claim, line, stopped };
    if (Date.now() > deadline) throw Error(`BLOCKED: the session's stop, after a typed prompt and an edit, left no settled claim with a line in the record to answer from: ${said(claim)}; the stop's reply ${firedShown(stopped)}; the hub's log ${redact(sc.hub.output().slice(-1500))}`);
    await sleep(500);
  }
}
