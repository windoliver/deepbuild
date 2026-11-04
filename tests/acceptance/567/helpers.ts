// Shared test-side tools for issue #567 (README): the verdict spine's exit. A temporary home with stubbed system tools,
// `deep setup` through the built CLI, the hub as a process and its socket, the Claude Code stand-in (fixtures/claude.mjs)
// for the made-up session, the agent test harness (#48) for the live one, the checks of each criterion, and the spine's
// record (`docs/spine.json`) read against this checkout's git history.
// Parts are adapted from tests/acceptance/83/helpers.ts and tests/acceptance/322/helpers.ts (same repo, same license);
// this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild:
// every test reaches it through the CLI, deep-hook as setup's entries run it, the hub's socket, and git.

import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const HARNESS = join(REPO, 'scripts/agent-harness.mjs');
export const NODE = process.execPath;
export const WIDTH = 80;
/** Where each run's proof goes (README: The proof), rewritten on each run and never read back. */
export const PROOF_DIR = join(tmpdir(), 'deep-567-proof');

/** The criteria, each named by its number in the issue's order and its ID (README: Criteria to tests). */
export const AC1 = 'AC1 #567.4297f978';
export const AC2 = 'AC2 #567.934c6451';
export const AC3 = 'AC3 #567.317a15a0';

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
/** The newest Claude Code version the facts cover: the version the stand-in's sessions run. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

/**
 * A criterion judged: node:assert's own assertion failure (FAIL), raised here under the test paths, so the proof lane
 * reads it as failing at its assertion (design: Failing on an assertion). Where nothing could be judged, the tests
 * throw a plain Error whose message starts BLOCKED, INVALID or INCONCLUSIVE instead.
 */
export function must(ok: unknown, message: string): asserts ok {
  assert.ok(ok, message);
}

// ---- Temp folders under /tmp/dh567-*: a Unix socket path must stay short.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh567-'));
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
export function childEnv(w: World, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|CLAUDE|GIT_|XDG_|OTEL_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: w.home, SHELL: '/bin/sh', LC_ALL: 'C',
    PATH: `${w.bin}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, DEEP_HUB_TEST_CONFIRM: join(w.tmp, 'confirm'),
  });
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; started: number; ended: number; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, started, ended: Date.now(), timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

/** Redacts this machine's home folder and the temp folders from proof text (AGENTS.md: no personal data in evidence). */
export const redact = (text: string): string => text.split(process.env.HOME || '\u0000').join('~').replace(/\/tmp\/dh567-[A-Za-z0-9]+/g, '<tmp>');
export function writeProof(name: string, file: string, content: string): void {
  const dir = join(PROOF_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), redact(content));
}

// ---- The world (README: The fixture repo): a home, stubbed system tools, and a repo whose spec check fails at its base.
/** The repo's spec, `.deepbuild/done.yaml`: the design's bootstrap shape cut to one command check. */
export const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
export const UNIT_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken rejects an expired token', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\ntest('checkToken accepts a token that has not expired', () => {\n  assert.strictEqual(auth.checkToken({ exp: Date.now() / 1000 + 3600 }), true);\n});\n";
export const AUTH_JS = "module.exports = {\n  checkToken: (token) => token.exp > 0,\n};\n";
/** The edit that makes the spec's unit check pass. */
export const FIX = { from: 'token.exp > 0', to: 'token.exp > Date.now() / 1000' } as const;
/** The work the seeded false "done" claims: an edit that leaves the bug in place. */
export const DECOY = { from: 'module.exports = {', to: '// Tokens are checked here.\nmodule.exports = {' } as const;
/** The seeded false "done": the agent's last words, with the spec's unit check failing. */
export const FALSE_DONE = 'Done. Expired tokens are rejected and all tests pass.';
export const PROMPT = 'Make checkToken in src/auth.js reject expired tokens.';

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
  git(w, w.repo, 'init', '-q', '-b', 'main');
  git(w, w.repo, 'add', '.');
  git(w, w.repo, 'commit', '-q', '-m', 'Start the shop');
  // Claude Code's own state: first-run screens done, and the repo trusted in its workspace trust, which the core
  // reuses as project trust (design: First-party extensions, the spec-draft row; #322 AC1).
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', numStartups: 3, projects: { [w.repo]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  return w;
}
export function git(w: World, cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: w.tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  if (r.status !== 0) throw Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
/** The unit check run by hand in the repo: whether it passes now (the test's own reading, never DeepBuild's). */
export function unitPasses(w: World): boolean {
  return spawnSync(NODE, ['--test', 'tests/unit.test.js'], { cwd: w.repo, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, encoding: 'utf8' }).status === 0;
}
export function editFile(w: World, file: string, change: { from: string; to: string }): void {
  const path = join(w.repo, file);
  const before = readFileSync(path, 'utf8');
  if (!before.includes(change.from)) throw Error(`${file} doesn't hold ${JSON.stringify(change.from)}`);
  writeFileSync(path, before.replace(change.from, change.to));
}

// ---- deep-hook and the CLI.
export function ensureDeepHook(): void {
  if (existsSync(DEEP_HOOK)) return;
  const r = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, encoding: 'utf8', timeout: 900_000 });
  if (r.status !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: target/debug/deep-hook isn't built and cargo couldn't build it: ${r.stderr?.slice(-1500)}`);
}
export function ensureCli(): void {
  if (!existsSync(CLI)) throw Error('BLOCKED: packages/cli/dist/main.js is missing; run `npm run build --workspaces` first');
}
export const settingsFile = (w: World) => join(w.home, '.claude', 'settings.json');
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string'
  && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command) || /(^|[\s/'"])deep(\s|$)/.test(command));
/** `deep setup` with HOME the test's home and the system tools stubbed: DeepBuild's entries in Claude Code's user settings. */
export async function setup(w: World): Promise<void> {
  const r = await run(NODE, [CLI, 'setup'], { env: childEnv(w), cwd: w.repo, timeoutMs: 180_000 });
  if (r.code !== 0) throw Error(`BLOCKED: deep setup must exit 0 and install DeepBuild into Claude Code's user settings: ${shown(r)}`);
  const settings = parseObject(readFileSync(settingsFile(w), 'utf8')) ?? {};
  const stops = ((settings.hooks?.Stop ?? []) as Line[]).flatMap((g) => (g.hooks ?? []) as Line[]).filter((h) => isDeepBuild(h.command) && !h.async && !h.asyncRewake);
  must(stops.length, `${AC1} deep setup must install DeepBuild's foreground Stop entry, the Stop hold, in ${settingsFile(w)}: ${JSON.stringify(settings.hooks?.Stop ?? null).slice(0, 800)}`);
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
export interface Ev { id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; data: Line }
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

// ---- The record as the checks read it.
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 500)}` : 'no event');
/** A claim's handle as the record names it: `claim:<the claim.made event's id>`. */
export const handleOf = (e: Ev) => `claim:${e.id}`;
/** Every string a value holds, deep. */
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
/** Whether an event names a claim (its subject, or any string field equal to the handle). */
export const names = (e: Ev, handle: string) => e.subject === handle || strings(e.data).includes(handle);
/** The check a run ran: its `check` field (or the command it ran). */
export const checkOf = (e: Ev): string => String(e.data.check ?? e.data.name ?? e.data.command ?? '');
export interface ClaimRuns { claim: Ev; runs: { started: Ev; finished: Ev | undefined }[]; verdicts: Ev[] }
/** The session's claims made at or after a log position, each with its runs and verdicts. */
export function claimsAfter(events: readonly Ev[], session: string, after: number): ClaimRuns[] {
  return events.filter((e) => e.kind === 'claim.made' && e.session === session && e.log_pos > after).map((claim) => {
    const handle = handleOf(claim);
    const runs = events.filter((e) => e.kind === 'run.started' && names(e, handle)).map((started) => ({
      started,
      finished: events.find((f) => f.kind === 'run.finished' && (f.data.run === started.id || f.data.run === `run:${started.id}` || f.subject === started.id || f.subject === `run:${started.id}` || (started.data.run !== undefined && f.data.run === started.data.run))),
    }));
    return { claim, runs, verdicts: events.filter((e) => e.kind === 'verdict.made' && names(e, handle)) };
  });
}
export const failed = (e: Ev | undefined) => !!e && /fail/i.test(String(e.data.outcome ?? e.data.result ?? e.data.status ?? ''));
export const passed = (e: Ev | undefined) => !!e && /pass/i.test(String(e.data.outcome ?? e.data.result ?? e.data.status ?? ''));

// ---- The Claude Code stand-in (fixtures/claude.mjs, #83's copy as-is): one process per session.
export interface HookRun { command: string; async: boolean; pid: number; started: number; ended: number | null; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; blocked?: string; shown?: string[]; settingsError?: string }
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
  private send(command: Line, timeoutMs = 900_000): Promise<Line> {
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
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt) base.prompt_id = s.prompt;
  if (event === 'SessionStart') { Object.assign(base, { source: 'startup', model: 'claude-haiku-4-5' }); delete base.prompt_id; }
  if (event === 'Stop') Object.assign(base, { stop_hook_active: false });
  if (event === 'SessionEnd') Object.assign(base, { reason: 'other' });
  return { ...base, ...extra };
}
export function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
/** A prompt you typed, as Claude Code writes it (origin human), and its UserPromptSubmit. */
export async function typed(claude: Claude, s: Session, text: string): Promise<Fired> {
  s.prompt = randomUUID();
  appendTranscript(s, { promptId: s.prompt, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
}
/** The agent's last words, then its Stop; `continued` is Claude Code's stop_hook_active after a send-back. */
export async function stop(claude: Claude, s: Session, words: string, continued = false): Promise<Fired> {
  appendTranscript(s, { type: 'assistant', message: { model: 'claude-haiku-4-5', id: `msg_${tag(6)}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: words }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 10 } } });
  return claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: words, stop_hook_active: continued }));
}
export const deepRuns = (f: Fired): HookRun[] => f.ran.filter((r) => isDeepBuild(r.command));
export const firedShown = (f: Fired) => JSON.stringify({ blocked: f.blocked, shown: f.shown, runs: f.ran.map((r) => ({ command: redact(r.command).slice(0, 120), code: r.code, signal: r.signal, timedOut: r.timedOut, ms: r.ended === null ? null : r.ended - r.started, stdout: r.stdout.slice(0, 800), stderr: r.stderr.slice(0, 400) })) });

// ---- What one stop showed at the agent's side, from the stand-in's run of setup's entries (or, live, from Claude Code).
export interface StopSeen {
  /** The send-back's reason, when the stop was held and sent back (a block); undefined when it was let through. */
  blocked: string | undefined;
  /** The line the chat showed: the reply's systemMessage, or the first line of the send-back's reason. */
  line: string | undefined;
  /** When DeepBuild's Stop entry returned (epoch ms), and when it started. */
  returned: number;
  began: number;
  shownAs: string;
}
export function seenOf(f: Fired): StopSeen {
  const ours = deepRuns(f);
  const began = Math.min(...ours.map((r) => r.started));
  const returned = Math.max(...ours.map((r) => r.ended ?? Date.now()));
  return { blocked: f.blocked, line: f.shown?.[0] ?? f.blocked?.split('\n')[0], returned, began, shownAs: firedShown(f) };
}

/**
 * AC1's check, applied to one false "done" stop and the record (README: Readings 1 to 4). Throws naming the clause it
 * fails; INCONCLUSIVE when the evidence can't reach a clause (the spec's check passed, so the "done" wasn't false).
 */
export function falseDoneProblems(o: { events: readonly Ev[]; session: string; since: number; seen: StopSeen; check: string; chat: string[] }): void {
  const claims = claimsAfter(o.events, o.session, o.since);
  must(claims.length > 0, `${AC1} the false "done" stop did work (an Edit), so it must be judged: no claim.made for session ${o.session} after it. Its reply: ${o.seen.shownAs}`);
  const runs = claims.flatMap((c) => c.runs).filter((r) => checkOf(r.started) === o.check || checkOf(r.started).includes(o.check));
  must(runs.length > 0, `${AC1} the judged stop must run the repo's spec check ${o.check} (.deepbuild/done.yaml): no run.started for it on the claim. Runs: ${claims.flatMap((c) => c.runs.map((r) => said(r.started))).join('; ') || 'none'}`);
  const ran = runs.find((r) => r.finished);
  if (ran && passed(ran.finished) && !failed(ran.finished)) throw Error(`INCONCLUSIVE: ${AC1} the spec check ${o.check} passed at the stop, so the seeded "done" wasn't false: ${said(ran.finished)}`);
  // Held: the stop isn't let through, and its reply waited for the check's run.
  must(o.seen.blocked !== undefined, `${AC1} the seeded false "done" must be held and sent back: DeepBuild's Stop entry let the stop through. Its reply: ${o.seen.shownAs}`);
  must(ran?.finished && failed(ran.finished), `${AC1} the stop was sent back, but the record has no failed run.finished of ${o.check} for its claim, so the send-back isn't the check's: ${runs.map((r) => `${said(r.started)} → ${said(r.finished)}`).join('; ')}`);
  must(ran!.finished!.ts <= o.seen.returned + 1000, `${AC1} the stop must be held until its check ran: ${o.check} finished at ${ran!.finished!.ts}, after DeepBuild's Stop entry returned at ${o.seen.returned}`);
  // Sent back with the failing check named.
  must(o.seen.blocked!.includes(o.check), `${AC1} the send-back must name the failing check ${o.check}: ${JSON.stringify(o.seen.blocked!.slice(0, 600))}`);
  // Its verdict line in the chat.
  const line = o.seen.line;
  must(line, `${AC1} the held stop must carry its verdict line for the chat (systemMessage, or the send-back's first line): ${o.seen.shownAs}`);
  must([...line].length <= WIDTH, `${AC1} the verdict line fits ${WIDTH} columns: ${JSON.stringify(line)} is ${[...line].length}`);
  must(/\bsent back\b/.test(line) && !/\bPASS\b/.test(line), `${AC1} the verdict line of a stop sent back says "sent back" (design: States people see) and never PASS: ${JSON.stringify(line)}`);
  must(o.chat.some((shown) => shown.includes(line)), `${AC1} the verdict line must show in the chat: ${JSON.stringify(line)} isn't among what the chat showed: ${JSON.stringify(o.chat.map((c) => c.slice(0, 200))).slice(0, 1200)}`);
}

// ---- The made-up session (fast.test.ts): the exit's scenario, its hooks through setup's entries into the real hub.
export interface Exit { w: World; hub: Hub; s: Session; claude: Claude; since: number; falseDone: StopSeen; events: Ev[]; chat: string[] }
/** The lines the chat showed: each hook_system_message attachment and each Stop hook feedback the transcript holds. */
export function chatOf(s: Session): string[] {
  return readLines(s.transcript).flatMap((e) => {
    if (e.type === 'attachment' && e.attachment?.type === 'hook_system_message') return [String(e.attachment.content)];
    if (e.type === 'user' && typeof e.message?.content === 'string' && e.message.content.startsWith('Stop hook feedback')) return [e.message.content];
    return [];
  });
}
export async function exitScenario(): Promise<Exit> {
  ensureCli();
  ensureDeepHook();
  const w = makeWorld();
  if (unitPasses(w)) throw Error('BLOCKED: the fixture\'s unit check must fail at its base commit');
  const hub = await startHub(w);
  await setup(w);
  const s = newSession(w);
  const claude = Claude.start(w);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  await typed(claude, s, PROMPT);
  const auth = join(w.repo, 'src/auth.js');
  await claude.tool(s, 'Read', { file_path: auth }, { type: 'text', file: { filePath: auth, content: readFileSync(auth, 'utf8') } });
  const since = (await allEvents(hub)).at(-1)?.log_pos ?? 0;
  editFile(w, 'src/auth.js', DECOY);
  await claude.tool(s, 'Edit', { file_path: auth, old_string: DECOY.from, new_string: DECOY.to }, { filePath: auth, oldString: DECOY.from, newString: DECOY.to });
  if (unitPasses(w)) throw Error('BLOCKED: the decoy edit must leave the unit check failing');
  const falseDone = seenOf(await stop(claude, s, FALSE_DONE));
  const events = await settleRuns(hub, s.id, since);
  return { w, hub, s, claude, since, falseDone, events, chat: chatOf(s) };
}
/** The record once the stop's claim and its runs have settled (every run.started has its run.finished), or 60 s. */
export async function settleRuns(hub: Hub, session: string, since: number, timeoutMs = 60_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await allEvents(hub);
    const claims = claimsAfter(events, session, since);
    if ((claims.length && claims.every((c) => c.runs.length && c.runs.every((r) => r.finished))) || Date.now() > deadline) return events;
    await sleep(500);
  }
}

// ---- The live session (session.live.test.ts) through the harness's false-done scenario (README: Additions, 1).
/** The prompt the harness types, word for word: it seeds the false "done" (an edit that fixes nothing, then those words). */
export const LIVE_PROMPT = `Add the comment \`// Tokens are checked here.\` as the first line of src/auth.js, and run nothing. Then end your turn with exactly: ${FALSE_DONE}`;
export interface HarnessLine { verdict: string; reason?: string; sessionId?: string; transcript?: string; workdir?: string; evidence?: Line; [key: string]: unknown }
const plain = (text: string) => text.replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]/g, '');
const collapse = (text: string) => text.replace(/\s+/g, ' ');
/**
 * What the live session's false "done" stop showed at Claude Code's side (README: Reading 4): the record's claim for it,
 * its verdict line (the receipt's `line`), whether Claude Code went on after it (a later Stop with stop_hook_active),
 * the send-back as the transcript keeps it, and what the chat showed: the terminal's screen and the transcript.
 */
export async function liveSeen(hub: Hub, line: HarnessLine): Promise<{ session: string; seen: StopSeen; chat: string[]; events: Ev[]; firstStop: Line }> {
  const session = String(line.sessionId ?? '');
  const hooks = readLines(line.evidence?.events).filter((e) => e.session_id === session);
  const stops = hooks.filter((e) => e.hook_event_name === 'Stop');
  if (line.evidence?.prompt !== LIVE_PROMPT) throw Error(`INVALID: ${AC1} the harness must type the seeding prompt word for word: it says it typed ${JSON.stringify(line.evidence?.prompt ?? null)}`);
  if (!stops.length) throw Error(`INCONCLUSIVE: ${AC1} the live session never stopped: ${JSON.stringify(line).slice(0, 800)}`);
  const firstStop = stops[0]!;
  if (!/\bdone\b/i.test(String(firstStop.last_assistant_message ?? ''))) throw Error(`INCONCLUSIVE: ${AC1} the session's first stop didn't say it was done, so no "done" was seeded: ${JSON.stringify(String(firstStop.last_assistant_message ?? '').slice(0, 300))}`);
  const events = await settleRuns(hub, session, 0);
  const claim = claimsAfter(events, session, 0)[0];
  const receipt = claim ? ((await control(hub, 'changes.read', { id: handleOf(claim.claim) })).change ?? {}) as Line : {};
  const verdictLine = typeof receipt.line === 'string' ? receipt.line : undefined;
  const entries = readLines(line.transcript);
  const theirs = entries.filter((e) => e.type !== 'assistant' && !(e.type === 'user' && e.promptSource === 'typed'));
  const carrying = verdictLine ? theirs.find((e) => JSON.stringify(e).includes(JSON.stringify(verdictLine).slice(1, -1))) : undefined;
  // Every text Claude Code kept that carries the line: the send-back (its first line is the line) and the line itself.
  const sentBack = theirs.flatMap((e) => strings(e)).filter((t) => verdictLine && t.includes(verdictLine)).join('\n');
  const continued = stops.slice(1).some((e) => e.stop_hook_active === true);
  const at = carrying ? Date.parse(String(carrying.timestamp)) : Date.now();
  const seen: StopSeen = {
    blocked: continued && carrying ? sentBack : undefined,
    line: verdictLine,
    began: Number(firstStop.at ?? 0),
    returned: Number.isFinite(at) ? at : Date.now(),
    shownAs: JSON.stringify({ continued, verdictLine, carrying: carrying ? redact(JSON.stringify(carrying)).slice(0, 800) : null, stops: stops.map((e) => ({ at: e.at, stop_hook_active: e.stop_hook_active, said: String(e.last_assistant_message ?? '').slice(0, 160) })) }),
  };
  const screen = line.evidence?.screen && existsSync(String(line.evidence.screen)) ? collapse(plain(readFileSync(String(line.evidence.screen), 'utf8'))) : '';
  const chat = [screen, ...theirs.flatMap((e) => strings(e)).map(collapse)];
  return { session, seen, chat, events, firstStop };
}
export async function liveExit(): Promise<{ w: World; hub: Hub; line: HarnessLine; ran: Ran }> {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error('BLOCKED: this test starts a real Claude Code session on your plan; run it by hand with DEEP_HARNESS_LIVE=1');
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw Error('BLOCKED: the live session runs under a temporary HOME and signs in with CLAUDE_CODE_OAUTH_TOKEN (make one with `claude setup-token`)');
  const claude = (process.env.PATH ?? '').split(':').map((d) => join(d, 'claude')).find((p) => existsSync(p));
  if (!claude) throw Error('BLOCKED: no claude on PATH');
  ensureCli();
  ensureDeepHook();
  const w = makeWorld();
  // The live session runs the real Claude Code, not the stand-in: the bin folder keeps launchctl and systemctl only.
  rmSync(join(w.bin, 'claude'));
  const hub = await startHub(w);
  await setup(w);
  const out = join(w.tmp, 'out');
  const args = [HARNESS, 'run', '--scenario', 'false-done', '--workdir', w.repo, '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--claude', claude, '--timeout-ms', '600000', '--out', out];
  const ran = await run(NODE, args, { env: childEnv(w, { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }), timeoutMs: 780_000 });
  const line = jsonLines(ran.stdout).find((l) => typeof l.run === 'string') as HarnessLine | undefined;
  if (!line) throw Error(`BLOCKED: the harness printed no run line for the false-done scenario: ${redact(shown(ran))}`);
  if (line.verdict === 'BLOCKED') throw Error(`BLOCKED: the harness's false-done run: ${redact(String(line.reason))}`);
  return { w, hub, line, ran };
}

// ---- The spine (AC2, AC3): its 25 tasks as the `spine` label lists them, and its record, docs/spine.json.
/** The 25 issues the `spine` label holds (design: Six weeks to version 0), as of the issue's text. */
export const SPINE = [12, 13, 14, 15, 16, 17, 18, 22, 25, 28, 29, 30, 31, 32, 44, 47, 48, 56, 80, 83, 86, 236, 237, 303, 304] as const;
/** The two tasks in the spine only in part, and #32, of which only #322 is in it: what each counts as (the issue's AC2). */
export const COUNTS_AS: Record<number, readonly number[]> = { 44: [348, 349, 350], 32: [322] };
/** What the record must say of each task in part. */
export const IN_PART: Record<number, RegExp> = { 236: /run tokens?/i, 44: /kits?/i };
/** Spine tasks that landed whole through their parts (their sub-issues on GitHub as of the issue's text): each part lands. */
export const LANDS_THROUGH: Record<number, readonly number[]> = { 13: [311, 312, 313, 314], 17: [315, 316, 317] };
/** The issues whose merges land a spine task: what it counts as, else its parts, else itself. */
export const landsBy = (n: number): readonly number[] => COUNTS_AS[n] ?? LANDS_THROUGH[n] ?? [n];
export const SPINE_RECORD = join(REPO, 'docs/spine.json');
/** The spine's record (README: The spine's record). */
export interface SpineRecord {
  tasks: { issue: number; counts_as?: number[]; part?: string; landed: { issue: number; merge: string }[] }[];
  started: string; landed: string; days: number;
  weeks: { plan: 'six weeks' | 'replanned'; design_change: string | null };
}
export function readSpineRecord(file = SPINE_RECORD): SpineRecord {
  must(existsSync(file), `${AC2} ${AC3} the spine's record ${file.replace(REPO + '/', '')} doesn't exist: the spine's tasks, where each landed, and its measured time are recorded nowhere`);
  const parsed = parseObject(readFileSync(file, 'utf8'));
  must(parsed, `${AC2} ${AC3} the spine's record isn't a JSON object`);
  return parsed as SpineRecord;
}
/** git in this checkout. */
export function repoGit(...args: string[]): string {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}
export function historyOrBlocked(): void {
  const r = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw Error(`BLOCKED: ${AC2} ${AC3} this checkout has no git history to read the spine's landing from: ${r.stderr.trim()}`);
  if (r.stdout.trim() === 'true') throw Error(`BLOCKED: ${AC2} ${AC3} this checkout is shallow; the spine's merges can't be read`);
}
const FIRST_PARENT = (() => { let cache: Set<string> | undefined; return () => (cache ??= new Set(repoGit('rev-list', '--first-parent', 'HEAD').split('\n'))); })();
/** Whether text names an issue: `#n`, `issue-n`, or a branch's `/n-`, never as part of a longer number. */
export const namesIssue = (text: string, n: number) => new RegExp(`(#|issue-|/)${n}(?![0-9])`).test(text);
/** A landing merge as git has it: on HEAD's first-parent line, a merge, and the commits it brought in. */
export interface Merge { sha: string; committed: number; firstAuthored: number; text: string }
export function mergeOf(rev: string): Merge | string {
  let sha: string;
  try { sha = repoGit('rev-parse', '--verify', `${rev}^{commit}`); } catch { return `${rev} is no commit in this checkout`; }
  if (!FIRST_PARENT().has(sha)) return `${rev} isn't on main's first-parent line from HEAD, so it never landed here`;
  const parents = repoGit('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
  if (parents.length < 2) return `${rev} isn't a merge, so no pull request's commits land with it`;
  const brought = repoGit('log', '--format=%at', `${parents[0]}..${sha}`).split('\n').filter(Boolean).map((t) => Number(t) * 1000);
  const text = repoGit('log', '--format=%B', `${parents[0]}..${sha}`);
  return { sha, committed: Number(repoGit('log', '-1', '--format=%ct', sha)) * 1000, firstAuthored: Math.min(...brought), text };
}
/** AC2's check (README: Readings 5 and 6): the record lists the spine's 25 and each landed here. A list of problems. */
export function spineProblems(rec: SpineRecord): string[] {
  const problems: string[] = [];
  const tasks = Array.isArray(rec.tasks) ? rec.tasks : [];
  const listed = tasks.map((t) => t.issue);
  for (const n of SPINE) if (!listed.includes(n)) problems.push(`${AC2} spine task #${n} is missing from the record`);
  for (const n of listed) if (!(SPINE as readonly number[]).includes(n)) problems.push(`${AC2} #${n} isn't one of the spine's 25 tasks`);
  if (listed.length !== new Set(listed).size) problems.push(`${AC2} a spine task is listed twice: ${listed.join(', ')}`);
  for (const t of tasks) {
    const want = COUNTS_AS[t.issue];
    const counts = t.counts_as ?? [];
    if (want && [...want].sort().join() !== [...counts].sort().join()) problems.push(`${AC2} #${t.issue} counts as ${want.map((n) => `#${n}`).join(', ')} in the spine, not ${counts.length ? counts.map((n) => `#${n}`).join(', ') : 'the whole task'}`);
    if (!want && counts.length) problems.push(`${AC2} #${t.issue} is in the spine whole; it counts as nothing else`);
    if (IN_PART[t.issue] && !IN_PART[t.issue]!.test(t.part ?? '')) problems.push(`${AC2} #${t.issue} is in the spine only in part; the record must say which (${IN_PART[t.issue]}): ${JSON.stringify(t.part ?? null)}`);
    const landed = Array.isArray(t.landed) ? t.landed : [];
    const by = landsBy(t.issue);
    for (const n of by) if (!landed.some((l) => l.issue === n)) problems.push(`${AC2} #${n}${n !== t.issue ? ` (for #${t.issue})` : ''} has no landing merge in the record`);
    for (const l of landed) {
      if (!by.includes(l.issue)) { problems.push(`${AC2} #${t.issue}'s landing names #${l.issue}, which doesn't land it`); continue; }
      const m = mergeOf(String(l.merge));
      if (typeof m === 'string') problems.push(`${AC2} #${l.issue}: ${m}`);
      else if (!namesIssue(m.text, l.issue)) problems.push(`${AC2} #${l.issue}: merge ${m.sha.slice(0, 12)} and the commits it brought in never name #${l.issue}`);
    }
  }
  return problems;
}
/** The spine's time as git measures it from the record's merges: from the first commit any of them brought in to the last merge. */
export function measuredSpine(rec: SpineRecord): { started: number; landed: number; days: number } | string {
  const merges = (rec.tasks ?? []).flatMap((t) => t.landed ?? []).map((l) => mergeOf(String(l.merge)));
  const bad = merges.find((m) => typeof m === 'string');
  if (bad !== undefined) return bad as string;
  const ok = merges as Merge[];
  if (!ok.length) return 'no landing merges';
  const started = Math.min(...ok.map((m) => m.firstAuthored));
  const landed = Math.max(...ok.map((m) => m.committed));
  return { started, landed, days: (landed - started) / 86_400_000 };
}
/** The commit's change to the design's "Six weeks to version 0" section, or why it isn't one. */
export function designChangeOf(rev: string, after: number): string | null {
  let sha: string;
  try { sha = repoGit('rev-parse', '--verify', `${rev}^{commit}`); } catch { return `${rev} is no commit in this checkout`; }
  try { repoGit('merge-base', '--is-ancestor', sha, 'HEAD'); } catch { return `${rev} isn't in HEAD's history`; }
  if (Number(repoGit('log', '-1', '--format=%ct', sha)) * 1000 < after) return `${rev} was committed before the spine landed, so it can't plan from its measured pace`;
  const doc = repoGit('show', `${sha}:docs/technical-design.md`).split('\n');
  const start = doc.findIndex((l) => l.startsWith('## Six weeks to version 0'));
  if (start < 0) return `${rev}'s design has no "Six weeks to version 0" section`;
  const next = doc.findIndex((l, i) => i > start && l.startsWith('## '));
  const end = next < 0 ? doc.length : next;
  const hunks = [...repoGit('show', '-U0', '--format=', sha, '--', 'docs/technical-design.md').matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)];
  const touches = hunks.some((h) => { const from = Number(h[1]) - 1; const count = h[2] === undefined ? 1 : Number(h[2]); return count > 0 && from < end && from + count > start; });
  return touches ? null : `${rev} doesn't change the design's "Six weeks to version 0" section`;
}
/** AC3's check (README: Readings 7 to 9): the recorded time is git's measurement, and the weeks follow it. A list of problems. */
export function timeProblems(rec: SpineRecord): string[] {
  const problems: string[] = [];
  const unlanded = spineProblems(rec);
  if (unlanded.length) problems.push(`${AC3} the weeks can't be planned from the spine before it has landed: ${unlanded[0]!.replace(`${AC2} `, '')}${unlanded.length > 1 ? ` (and ${unlanded.length - 1} more)` : ''}`);
  const m = measuredSpine(rec);
  if (typeof m === 'string') return [`${AC3} the spine's time can't be measured from the record's merges: ${m}`];
  const at = (iso: unknown) => (typeof iso === 'string' ? Date.parse(iso) : NaN);
  if (at(rec.started) !== m.started) problems.push(`${AC3} the spine started at ${new Date(m.started).toISOString()} (its first commit), not ${JSON.stringify(rec.started ?? null)}`);
  if (at(rec.landed) !== m.landed) problems.push(`${AC3} the spine landed at ${new Date(m.landed).toISOString()} (its last merge), not ${JSON.stringify(rec.landed ?? null)}`);
  if (typeof rec.days !== 'number' || Math.abs(rec.days - m.days) > 0.01) problems.push(`${AC3} the spine took ${m.days.toFixed(2)} days as git measures it, not ${JSON.stringify(rec.days ?? null)}`);
  problems.push(...weeksProblems(m.days, m.landed, rec.weeks));
  return problems;
}
/** The design's rule for the weeks (README: Reading 9), given the spine's measured days and when it landed. A list of problems. */
export function weeksProblems(days: number, landed: number, weeks: SpineRecord['weeks'] | undefined): string[] {
  const problems: string[] = [];
  const plan = weeks?.plan;
  if (plan !== 'six weeks' && plan !== 'replanned') problems.push(`${AC3} the record must say how the weeks are held: "six weeks" or "replanned", not ${JSON.stringify(plan ?? null)}`);
  if (days > 21) {
    if (plan !== 'replanned') problems.push(`${AC3} the spine took ${days.toFixed(2)} days, longer than three weeks, so weeks 4 to 6 are planned again from its measured pace; the record holds them to ${JSON.stringify(plan ?? null)}`);
    const why = weeks?.design_change ? designChangeOf(String(weeks.design_change), landed) : 'the record names no design change';
    if (why) problems.push(`${AC3} the spine took longer than three weeks, so the new plan is recorded as a design change: ${why}`);
  }
  return problems;
}
