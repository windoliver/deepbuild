// Shared test-side tools for issue #323's acceptance tests (README): a temp world (a home with the shipped default
// guards, your settings and the OS-confirmation stub; one or more git repositories with a `.deepbuild/done.yaml` spec,
// a unit test and drafted checks; the definitions the kernel is handed and the recorded GitHub answers), the hub as a
// process with its test settings, the record read back through the hub's socket (`events.read`, `inbox.read`), the
// project's trust decision as #348 records it, Claude Code sessions driven through the real deep-hook binary (and their
// own `deep mcp`) with payloads and transcripts shaped like the corpus's, Codex sessions through `deep-hook codex`,
// your answer through `deep inbox answer`, and the readers of open items. Adapted from tests/acceptance/322/helpers.ts
// (same repo, same license); this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing
// here stands in for DeepBuild: every reading comes from the real hub, deep-hook and CLI.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
const versions = (file: string): string => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters', file), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; };
/** The newest Claude Code and Codex versions the facts cover: every transcript carries them, so no session is watch-only for its version. */
export const COVERED = versions('claude-code.facts.json');
export const CODEX_COVERED = versions('codex.facts.json');

/** Each criterion's ID: `#323.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #323.035dc227';
export const AC2 = 'AC2 #323.70229cc2';
export const AC3 = 'AC3 #323.5966273a';
export const AC4 = 'AC4 #323.a78cd64d';
export const AC5 = 'AC5 #323.73adf79a';
export const AC6 = 'AC6 #323.6f18b734';
export const AC7 = 'AC7 #323.d33fe764';
export const AC8 = 'AC8 #323.cd7cac96';
export const AC9 = 'AC9 #323.15c51ef6';
export const AC10 = 'AC10 #323.11d61eef';
export const AC11 = 'AC11 #323.056bfe4d';
export const AC12 = 'AC12 #323.9ddcf826';
export const AC13 = 'AC13 #323.b0a29209';
export const AC14 = 'AC14 #323.d6d5ec0c';
export const AC15 = 'AC15 #323.bc9c6272';

/** The stop hold every hub here runs with (DEEP_HUB_TEST_STOP_HOLD_MS): the fast-lane checks end well inside it. */
export const HOLD_MS = 20_000;

/** The edit that makes the spec's unit test pass: checkToken then rejects a token whose exp has passed. */
export const FIX = { file: 'src/auth.js', from: 'token.exp > 0', to: 'token.exp > Date.now() / 1000' } as const;
/** The edit that makes the drafted check pass: the middleware says it rejects expired tokens. */
export const FLAG = { file: 'src/auth.js', from: 'rejectsExpired: false', to: 'rejectsExpired: true' } as const;

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

// ---- Verdicts. A judgement throws an Error naming the criterion; INCONCLUSIVE is a skip, never a pass.
export class Inconclusive extends Error {}
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
    throw error;
  }
}
/**
 * The message a scenario throws on a planted program, or null when it holds. A BLOCKED setup (the plant isn't there
 * to start) and an INCONCLUSIVE reading are thrown on, never read as the plant's failure.
 */
export async function failureOf(judge: () => unknown): Promise<string | null> {
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
/** Runs a scenario once, however many tests read it. */
export function once<T>(make: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= make());
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh323-'));
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
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN'];
/** The environment a child gets: HOME the test's home, and no DEEP_/GIT_/XDG_/CLAUDE/CODEX settings, forge tokens or billing keys of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('CLAUDE') || key.startsWith('CODEX') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
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

// ---- The definitions the kernel is handed and the recorded GitHub answers (README).
/** One requirement of a handed definition, in #303's Fields, with #322's `references` and this suite's `targets`. */
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[]; references?: string[]; targets?: string[] }
/** A definition the kernel is handed for an ask, by the prompt's exact text. */
export interface Draft { ask: string; requirements: Requirement[]; deliverables: string[]; budget: null }
/** One recorded GitHub API answer (README, DEEP_HUB_TEST_GITHUB): a REST GET by path (no query) and page, or a GraphQL POST to /graphql by its variables. */
export interface Answer { method?: 'GET' | 'POST'; path: string; page?: number; variables?: Record<string, unknown>; status: number; headers?: Record<string, string>; body: unknown }

export const req = (id: string, text: string, o: Partial<Requirement> = {}): Requirement => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check: null, on_base: 'fails', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...o,
});
/**
 * A drafted check as the hub's drafted checks are: `.deepbuild/checks/<name>.sh`, run as `sh <file>`, whose one line
 * runs a node:test file beside it, so the hermetic runner traces it and counts its test; the test's assertion is its
 * line 4, which `asserts` names. `assertion` is one `assert.…(…);` statement; paths in it are from the repo's root.
 */
export function testCheck(name: string, title: string, assertion: string): { check: string; asserts: string[]; files: Record<string, string> } {
  const check = `.deepbuild/checks/${name}.sh`;
  const test = `.deepbuild/checks/${name}.test.js`;
  return {
    check, asserts: [`${test}:4`],
    files: {
      [check]: `#!/bin/sh\n# Drafted check: ${title}.\nnode --test ${test}\n`,
      [test]: `const test = require('node:test');\nconst assert = require('node:assert');\ntest(${JSON.stringify(title)}, () => {\n  ${assertion}\n});\n`,
    },
  };
}
/** The drafted check the repo holds at its base commit: it fails until FLAG is made (the middleware says it rejects expired tokens). */
export const EXPIRED = testCheck('expired-token', 'an expired token is rejected with 401', "assert.ok(require('../../src/auth.js').rejectsExpired, 'an expired token is not rejected with 401');");
export const CHECK_FILE = EXPIRED.check;
/** R1 of most definitions here: the drafted check judges it. */
export const R1 = (o: Partial<Requirement> = {}) => req('R1', 'An expired token is rejected with 401', { check: CHECK_FILE, asserts: EXPIRED.asserts, ...o });
/** A definition handed for a prompt: R1 with the drafted check, unless other requirements are given. */
export const draft = (ask: string, requirements: Requirement[] = [R1()]): Draft => ({ ask, requirements, deliverables: ['src/auth.js'], budget: null });

/** The repo's spec, `.deepbuild/done.yaml`: one claim, done, with the unit check, a node:test run the hermetic runner counts. */
export const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
/** The unit test: checkToken rejects a token whose exp has passed. It fails at the base commit and passes once FIX is made. */
export const UNIT_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken rejects an expired token', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\n";
export const AUTH_JS = "module.exports = {\n  checkToken: (token) => token.exp > 0,\n  rejectsExpired: false,\n};\n";

/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
/** The account the sessions run on, as `~/.claude.json` names it. */
export const ACCOUNT = 'acct-dh323-0001';
export interface World { tmp: string; home: string; root: string; repos: Record<string, string>; confirm: string; drafts: string; github: string }
export interface WorldOptions {
  /** The repositories, by folder name under the world's temp folder; each gets the same base commit. Default ['repo']. */
  repos?: string[];
  drafts?: Draft[]; answers?: Answer[];
  /** The repo's `.deepbuild/done.yaml`. Default SPEC. */
  spec?: string;
  /** Extra files in each repo at its base commit, path to bytes; a path ending .sh is executable. */
  files?: Record<string, string>;
}
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the first
 * rules.json and config.json with your settings; `<home>/.claude.json` names the account. Each repo is a git
 * repository with one commit on main, holding `src/auth.js`, the unit test, the spec, the drafted check, a README and
 * the extra files. `<tmp>/confirm` says `confirmed` (DEEP_HUB_TEST_CONFIRM). `<tmp>/drafts.json` is
 * DEEP_HUB_TEST_DRAFTS, `<tmp>/github.json` DEEP_HUB_TEST_GITHUB. Every repo is trusted by your decision (#348).
 */
export async function makeWorld(o: WorldOptions = {}): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex', 'sessions'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const first = join(tmp, (o.repos ?? ['repo'])[0]!);
  mkdirSync(join(first, 'src'), { recursive: true });
  mkdirSync(join(first, 'tests'), { recursive: true });
  mkdirSync(join(first, '.deepbuild', 'checks'), { recursive: true });
  writeFileSync(join(first, 'src', 'auth.js'), AUTH_JS);
  writeFileSync(join(first, 'tests', 'unit.test.js'), UNIT_TEST);
  writeFileSync(join(first, '.deepbuild', 'done.yaml'), o.spec ?? SPEC);
  writeFileSync(join(first, 'README.md'), '# shop\n\nThe auth middleware checks each request\'s token.\n');
  writeFileSync(join(first, 'package.json'), `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node --test tests/unit.test.js' } }, null, 2)}\n`);
  for (const [path, bytes] of Object.entries({ ...EXPIRED.files, ...o.files })) {
    mkdirSync(dirname(join(first, path)), { recursive: true });
    writeFileSync(join(first, path), bytes, path.endsWith('.sh') ? { mode: 0o755 } : {});
  }
  const repos: Record<string, string> = {};
  for (const name of o.repos ?? ['repo']) if (join(tmp, name) !== first) cpSync(first, join(tmp, name), { recursive: true });
  for (const name of o.repos ?? ['repo']) {
    const dir = join(tmp, name);
    git(tmp, dir, ['init', '-q', '-b', 'main']);
    git(tmp, dir, ['add', '.']);
    git(tmp, dir, ['commit', '-q', '-m', 'base']);
    repos[name] = realpathSync(dir);
  }
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3 }, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: o.drafts ?? [] }, null, 2)}\n`);
  const github = join(tmp, 'github.json');
  writeFileSync(github, `${JSON.stringify({ answers: o.answers ?? [] }, null, 2)}\n`);
  const w = { tmp, home, root, repos, confirm, drafts, github };
  await trustRepos(w);
  return w;
}
/** Rewrites the recorded GitHub answers of a world (a reviewer resolves a thread). */
export function recordAnswers(w: World, answers: Answer[]): void {
  writeFileSync(w.github, `${JSON.stringify({ answers }, null, 2)}\n`);
}
export function git(tmp: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}
/**
 * The projects' trust decision as #348 records it: your answer on the trusted path, appended to the record at
 * `<home>/.deepbuild/ledger.db` through `openTrust` of the extension host's public entry, before the hub starts.
 */
async function trustRepos(w: World): Promise<void> {
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openTrust } = await import('../../../packages/extension-host/src/index.ts');
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now });
  try {
    const trust = await openTrust({ record, now: Date.now });
    for (const repo of Object.values(w.repos)) await trust.answer({ writer: 'app', actor: 'you', scope: 'you' }, repo, true);
  } finally {
    await record.close();
  }
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; plant: string | undefined; stderr(): string }
/**
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, DEEP_HUB_TEST_DRAFTS, DEEP_HUB_TEST_GITHUB and
 * DEEP_HUB_TEST_STOP_HOLD_MS, and with DEEP_HUB_PLANT when given. A hub that doesn't start (a plant the base doesn't
 * list) is BLOCKED.
 */
export async function startHub(w: World, plant?: string): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_GITHUB: w.github,
    DEEP_HUB_TEST_STOP_HOLD_MS: String(HOLD_MS),
    DEEP_HUB_PLANT: plant,
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
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, plant, stderr: () => err };
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
/** One event as `events.read` returns it. */
export interface Ev { v?: number; id: string; kind: string; log_pos: number; ts: number; writer?: string; actor?: string; scope?: string; subject?: string; session?: string; data: Line; [key: string]: unknown }
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
export async function lastPos(hub: Hub): Promise<number> {
  const events = await allEvents(hub);
  return events.length ? events[events.length - 1]!.log_pos : 0;
}
/** Reads the log until `done` holds, or `timeoutMs` passes; resolves with the last read either way, so the test's own assertions say what is missing. */
export async function settle(hub: Hub, done: (events: Ev[]) => boolean, timeoutMs = 30_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await allEvents(hub);
    if (done(events) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
/** Your inbox as `deep inbox` reads it (`inbox.read`): one row per ask. */
export async function inbox(hub: Hub): Promise<Line[]> {
  const read = await control(hub, 'inbox.read', {});
  return (Array.isArray(read.rows) ? read.rows : Array.isArray(read.asks) ? read.asks : Array.isArray(read) ? read : []) as Line[];
}
/** An event's kind and data in one line, for failure messages. */
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 700)}` : 'no event');
export const listed = (events: readonly Ev[]): string => events.map(said).join('; ') || 'none';

/** The session's prompts, in log order. */
export const asksOf = (events: readonly Ev[], s: { id: string }): Ev[] => events.filter((e) => e.kind === 'user.ask' && e.session === s.id);
/** The thread the session's start recorded. */
export const threadOf = (events: readonly Ev[], s: { id: string }): string | undefined => events.find((e) => e.kind === 'session.start' && e.session === s.id && typeof e.data.thread === 'string')?.data.thread as string | undefined;
/** The definitions locked for a task, in log order. */
export const lockedFor = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
/** The task a prompt opened: its user.ask names one task in `tasks`, and a task.created under the session's thread has that task_ref. */
export function expectTask(events: readonly Ev[], s: { id: string }, text: string, who: string): string {
  const ask = asksOf(events, s).find((e) => e.data.text === text);
  must(ask !== undefined, `${who} the prompt "${text}" must be recorded as a user.ask: the session's are ${listed(asksOf(events, s))}`);
  const ref = Array.isArray(ask!.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
  must(ref !== undefined, `${who} the prompt "${text}" asks for changed behavior, so its user.ask must name the one task it opens: ${said(ask)}`);
  const thread = threadOf(events, s);
  must(events.some((e) => e.kind === 'task.created' && e.data.thread === thread && e.data.task_ref === ref), `${who} the prompt "${text}" must open task ${ref} under the session's thread (${thread ?? 'none recorded'})`);
  return ref!;
}
/** The claims made for a task after a log position. */
export const claimsOf = (events: readonly Ev[], ref: string, since = 0): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.log_pos > since && e.data.task_ref === ref);
/** The claim handles (`claim:<id>`) of every event after `since` naming the task. */
export const claimHandles = (events: readonly Ev[], ref: string, since: number): Set<string> => new Set(events.filter((e) => e.log_pos > since && e.data?.task_ref === ref).map((e) => `claim:${e.id}`));
/** The verdicts made on any claim of the task after `since`, in log order. */
export const taskVerdicts = (events: readonly Ev[], ref: string, since = 0): Ev[] => { const claims = claimHandles(events, ref, since); return events.filter((e) => e.kind === 'verdict.made' && e.log_pos > since && (claims.has(String(e.data.claim)) || claims.has(String(e.subject)))); };
/** The runs started for the task's claims after `since`, each with its finish. */
export function runsOf(events: readonly Ev[], ref: string, since: number): { started: Ev; finished: Ev | undefined }[] {
  const claims = claimHandles(events, ref, since);
  return events.filter((e) => e.kind === 'run.started' && e.log_pos > since && (claims.has(String(e.data.claim)) || e.data.task_ref === ref))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
/** A verdict's requirement row for R<n> (verdict.made names them req:<task>#R<n>). */
export const reqRow = (v: Ev | undefined, id: string): Line | undefined => ((v?.data.requirements ?? []) as Line[]).find((r) => new RegExp(`#${id}$`).test(String(r.req)));
/** The asks raised after `since`. */
export const asksRaised = (events: readonly Ev[], since: number): Ev[] => events.filter((e) => e.kind === 'ask.created' && e.log_pos > since);

/** Every string value in a value, depth first, so a reader finds text wherever an event keeps it. */
export function strings(value: unknown, skip: ReadonlySet<string> = new Set()): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((v) => strings(v, skip));
  if (value && typeof value === 'object') return Object.entries(value as Line).flatMap(([k, v]) => (skip.has(k) ? [] : strings(v, skip)));
  return [];
}
/** Whether any of the texts holds `part`, case and Unicode form aside. */
export const holds = (texts: readonly string[], part: string): boolean => texts.some((t) => t.normalize('NFC').toLowerCase().includes(part.normalize('NFC').toLowerCase()));

// ---- Open items (README, What the tests read: Open items).
/** An open item's ID: its `item` (or `id`) field, the hash of its normalized text and scope. */
export const itemId = (e: Ev): string | undefined => (typeof e.data.item === 'string' ? e.data.item : typeof e.data.id === 'string' ? e.data.id : undefined);
/** The open items opened for a task after `since`, in log order. */
export const itemsOf = (events: readonly Ev[], ref: string, since = 0): Ev[] => events.filter((e) => e.kind === 'open_item.opened' && e.log_pos > since && e.data.task_ref === ref);
/** The task's open items whose text (any string they hold) names every part. */
export const itemsNaming = (events: readonly Ev[], ref: string, parts: readonly string[], since = 0): Ev[] => itemsOf(events, ref, since).filter((e) => parts.every((p) => holds(strings(e.data), p)));
/** The closings of an open item: an open_item.closed after it with its ID, or with no ID, its task and text. */
export const closingsOf = (events: readonly Ev[], item: Ev): Ev[] => events.filter((e) => e.kind === 'open_item.closed' && e.log_pos > item.log_pos
  && (itemId(item) !== undefined ? itemId(e) === itemId(item) : e.data.task_ref === item.data.task_ref && e.data.text === item.data.text));
/** Whether an open item is still open: no closing after it, or a newer opening of it after its last closing. */
export function isOpen(events: readonly Ev[], item: Ev): boolean {
  const closed = closingsOf(events, item);
  if (!closed.length) return true;
  const last = closed[closed.length - 1]!.log_pos;
  return events.some((e) => e.kind === 'open_item.opened' && e.log_pos > last && (itemId(item) !== undefined ? itemId(e) === itemId(item) : e.data.text === item.data.text));
}

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session and of its `deep mcp`, as Claude Code is of its hook commands and MCP servers.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (line: Line) => void>();
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
        done?.(line);
      }
    });
    child.on('exit', () => {
      for (const [n, done] of [...this.pending]) {
        this.pending.delete(n);
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s agent process exited', ms: 0, timedOut: false, ended: Date.now(), failed: 'the session\'s agent process exited' });
      }
    });
  }
  static start(w: World, cwd: string, agent: 'claude-code' | 'codex' = 'claude-code'): Agent {
    const env = agent === 'codex' ? childEnv(w.home) : childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd });
    const child = spawn(NODE, [AGENT, DEEP_HOOK, NODE, CLI], { cwd: w.tmp, env, stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  send(command: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  async run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    return (await this.send({ args, cwd, input, timeoutMs })) as unknown as Ran;
  }
}
const agents = new Map<string, Agent>();

/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call (or the stop); exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  if (r.code === 0 && (d === undefined || d === 'allow')) return 'allow';
  return 'other';
}
/** What a hook's reply says: a block's reason (stdout JSON, or stderr at exit 2) and the message the chat shows (systemMessage); both as one text to search. */
export function replyText(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  const reason = typeof out?.reason === 'string' ? out.reason : typeof out?.hookSpecificOutput?.permissionDecisionReason === 'string' ? out.hookSpecificOutput.permissionDecisionReason : r.code === 2 ? r.stderr : '';
  const message = typeof out?.systemMessage === 'string' ? out.systemMessage : '';
  return `${reason}\n${message}`.trim();
}

let calls = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
/** One item of a TodoWrite list, as Claude Code's tool input holds it. */
export interface Todo { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string }

/** A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. */
export class Session {
  readonly id: string;
  readonly transcript: string;
  prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  private mcpId = 0;
  private mcpReady: Promise<void> | undefined;
  private todos: Todo[] = [];
  constructor(readonly w: World, readonly cwd: string) {
    this.id = randomUUID();
    this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    agents.set(this.id, Agent.start(w, cwd));
  }
  /** Appends one transcript entry, as Claude Code writes it. */
  entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  /** `deep-hook claude-code <event>`, the hook's JSON on stdin, as a child of the session's own Claude Code process. */
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    return agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
  }
  /** SessionStart (startup). */
  async start(): Promise<void> {
    this.prompt = undefined;
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
  }
  /** A prompt you typed: its transcript entry (turnOrigin human) and its UserPromptSubmit. */
  async typed(text: string): Promise<void> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
  }
  /**
   * One tool call: the assistant's tool_use entry and PreToolUse; when allowed, `effect` (what the call does), its
   * tool_result entry and PostToolUse.
   */
  async call(tool_name: string, tool_input: Line, o: { response?: Line; effect?: () => void } = {}): Promise<{ allowed: boolean; before: Ran }> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
    if (decision(before) !== 'allow') return { allowed: false, before };
    o.effect?.();
    const response = o.response ?? { stdout: '', stderr: '', interrupted: false, isImage: false };
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40 });
    return { allowed: true, before };
  }
  /** The agent reads a file of the repository (Read). */
  async read(file: string): Promise<void> {
    const path = join(this.cwd, file);
    const content = readFileSync(path, 'utf8');
    const r = await this.call('Read', { file_path: path }, { response: { type: 'text', file: { filePath: path, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } } });
    if (!r.allowed) throw Error(`BLOCKED: the Read of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent edits a file of the repository (Edit), and the edit is made; a denied edit is BLOCKED. */
  async edit(file: string, from: string, to: string): Promise<void> {
    const path = join(this.cwd, file);
    const before = readFileSync(path, 'utf8');
    if (!before.includes(from)) throw Error(`BLOCKED: the test's own edit of ${file} finds no ${JSON.stringify(from)}`);
    const r = await this.call('Edit', { file_path: path, old_string: from, new_string: to, replace_all: false }, {
      response: { filePath: path, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false },
      effect: () => writeFileSync(path, before.replace(from, to)),
    });
    if (!r.allowed) throw Error(`BLOCKED: the Edit of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent writes a new file of the repository (Write); a denied write is BLOCKED. */
  async write(file: string, content: string): Promise<void> {
    const path = join(this.cwd, file);
    const r = await this.call('Write', { file_path: path, content }, { response: { type: 'create', filePath: path, content, structuredPatch: [] }, effect: () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); } });
    if (!r.allowed) throw Error(`BLOCKED: the Write of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent's Bash call: PreToolUse, and when allowed `effect` runs and the response is `stdout`. */
  bash(command: string, o: { stdout?: string; effect?: () => void } = {}): Promise<{ allowed: boolean; before: Ran }> {
    return this.call('Bash', { command, description: command.slice(0, 40) }, { response: { stdout: o.stdout ?? '', stderr: '', interrupted: false, isImage: false }, ...(o.effect ? { effect: o.effect } : {}) });
  }
  /** The agent's TodoWrite: its whole list, as Claude Code's tool input and result carry it; a denied call is BLOCKED. */
  async todo(todos: Todo[]): Promise<void> {
    const r = await this.call('TodoWrite', { todos }, { response: { oldTodos: this.todos, newTodos: todos } });
    if (!r.allowed) throw Error(`BLOCKED: the TodoWrite call must be allowed: ${shown(r.before)}`);
    this.todos = todos;
  }
  /** The agent's last words of the turn, then Stop. */
  async stop(words: string): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
  /** One JSON-RPC line to the session's own `deep mcp`; the reply, or null for a notification. */
  private async mcp(line: Line, timeoutMs = 120_000): Promise<Line | null> {
    const r = await agents.get(this.id)!.send({ mcp: line, cwd: this.cwd, timeoutMs });
    if (r.failed) throw Error(`BLOCKED: ${String(r.failed)}`);
    return (r.reply ?? null) as Line | null;
  }
  /** A tool call to the session's `deep mcp` (initialized once): its value, or `{ isError, value }` on a tool error. */
  async tool(name: string, args: Line, timeoutMs = 120_000): Promise<{ isError: boolean; value: unknown; reply: Line }> {
    this.mcpReady ??= (async () => {
      const init = await this.mcp({ jsonrpc: '2.0', id: ++this.mcpId, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: COVERED } } });
      if (!init?.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
      await this.mcp({ jsonrpc: '2.0', method: 'notifications/initialized' });
    })();
    await this.mcpReady;
    const reply = (await this.mcp({ jsonrpc: '2.0', id: ++this.mcpId, method: 'tools/call', params: { name, arguments: args } }, timeoutMs))!;
    const result = (reply.result ?? {}) as Line;
    const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
    return { isError: result.isError === true || !!reply.error, value: result.structuredContent ?? (typeof text === 'string' ? parseObject(text) ?? text : undefined), reply };
  }
}

/** The session's stops, in log order. */
export const stopsOf = (events: readonly Ev[], s: { id: string }): Ev[] => events.filter((e) => e.kind === 'agent.stop' && e.session === s.id);

// ---- A Codex session: its hooks run as Codex runs DeepBuild's entry, `deep-hook codex <event>`, the payload on stdin,
// and its rollout under `~/.codex/sessions/YYYY/MM/DD/`, as the Codex facts name it.
export class CodexSession {
  readonly id = randomUUID();
  readonly transcript: string;
  turn = randomUUID();
  constructor(readonly w: World, readonly cwd: string) {
    const dir = join(w.home, '.codex', 'sessions', '2026', '11', '03');
    mkdirSync(dir, { recursive: true });
    this.transcript = join(dir, `rollout-2026-11-03T12-00-00-${this.id}.jsonl`);
    writeFileSync(this.transcript, '');
    this.entry('session_meta', { id: this.id, session_id: this.id, timestamp: new Date().toISOString(), cwd, originator: 'codex_cli_rs', cli_version: CODEX_COVERED, source: 'cli', model_provider: 'openai' });
    agents.set(this.id, Agent.start(w, cwd, 'codex'));
  }
  /** One rollout line, as Codex writes it. */
  entry(type: string, payload: Line): void {
    writeFileSync(this.transcript, `${JSON.stringify({ timestamp: new Date().toISOString(), type, payload })}\n`, { flag: 'a' });
  }
  async hook(event: string, extra: Line = {}): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default', ...(event === 'SessionStart' ? { source: 'startup' } : { turn_id: this.turn }), ...extra };
    return agents.get(this.id)!.run(['codex', event], this.cwd, JSON.stringify(body), 150_000);
  }
  async start(): Promise<void> {
    const r = await this.hook('SessionStart');
    if (r.code !== 0) throw Error(`BLOCKED: Codex's SessionStart hook must end with exit 0: ${shown(r)}`);
  }
  /** A prompt you typed: the turn's start and your message in the rollout, then UserPromptSubmit. */
  async typed(text: string): Promise<void> {
    this.turn = randomUUID();
    this.entry('event_msg', { type: 'task_started', turn_id: this.turn });
    this.entry('turn_context', { turn_id: this.turn, cwd: this.cwd, approval_policy: 'on-request', model: 'gpt-reserve' });
    this.entry('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
    this.entry('event_msg', { type: 'user_message', message: text, images: [] });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: Codex's UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
  }
  /** Codex's update_plan call and its output, as the rollout records them. */
  plan(plan: { step: string; status: 'pending' | 'in_progress' | 'completed' }[]): void {
    const call_id = `call_${tag(12)}`;
    this.entry('response_item', { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ explanation: null, plan }), call_id });
    this.entry('response_item', { type: 'function_call_output', call_id, output: 'Plan updated' });
  }
  /** A patch that replaces `from` with `to` in a file, through apply_patch's hook pair; a denied patch is BLOCKED. */
  async patch(file: string, from: string, to: string): Promise<void> {
    const path = join(this.cwd, file);
    const before = readFileSync(path, 'utf8');
    const line = before.split('\n').find((l) => l.includes(from))!;
    const input = { command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-${line}\n+${line.replace(from, to)}\n*** End Patch\n` };
    const call_id = `call_${tag(12)}`;
    this.entry('response_item', { type: 'custom_tool_call', name: 'apply_patch', input: input.command, call_id, status: 'completed' });
    const r = await this.hook('PreToolUse', { tool_name: 'apply_patch', tool_input: input, tool_use_id: call_id });
    if (decision(r) !== 'allow') throw Error(`BLOCKED: the apply_patch of ${file} must be allowed: ${shown(r)}`);
    writeFileSync(path, before.replace(from, to));
    this.entry('response_item', { type: 'custom_tool_call_output', call_id, output: 'Success.' });
    await this.hook('PostToolUse', { tool_name: 'apply_patch', tool_input: input, tool_use_id: call_id, tool_response: 'Success.' });
  }
  /** The agent's last words, the turn's end in the rollout, then Stop. */
  async stop(words: string): Promise<Ran> {
    this.entry('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: words }], phase: 'final_answer' });
    this.entry('event_msg', { type: 'task_complete', turn_id: this.turn, last_agent_message: words });
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
}

/**
 * A Claude Code session in `cwd` that starts, types `prompt` and reads src/auth.js, and the task the prompt opens,
 * once its handed definition has locked. A definition that doesn't lock is BLOCKED: every test here starts from one.
 */
export async function begin(w: World, hub: Hub, cwd: string, prompt: string, who: string): Promise<{ s: Session; ref: string }> {
  const s = new Session(w, cwd);
  await s.start();
  await s.typed(prompt);
  await s.read('src/auth.js');
  const events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, prompt, who)).length > 0; } catch { return false; } }, 60_000);
  let ref: string;
  try { ref = expectTask(events, s, prompt, who); } catch (error) { throw Error(`BLOCKED: ${(error as Error).message}`); }
  if (!lockedFor(events, ref).length) throw Error(`BLOCKED: ${who} the definition handed for "${prompt}" never locked for ${ref}`);
  return { s, ref };
}
/** The record once a stop of the task's (after `since`) has a verdict, or `timeoutMs` passed. */
export const judgedAfter = (hub: Hub, ref: string, since: number, timeoutMs = 90_000): Promise<Ev[]> => settle(hub, (all) => taskVerdicts(all, ref, since).length > 0, timeoutMs);

/** Your answer on the trusted path: `deep inbox answer <ask> <option>`, the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
export async function answer(w: World, ask: string, option: string): Promise<Ran> {
  return run(NODE, [CLI, 'inbox', 'answer', ask, option], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
}
