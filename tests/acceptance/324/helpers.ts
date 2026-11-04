// Shared test-side tools for issue #324's acceptance tests (README): a temp world (a home with the shipped default
// guards, your ask settings and the OS-confirmation stub; a git repository whose history holds the changes you
// accepted before, with a `.deepbuild/done.yaml` spec, a unit test and a drafted check; the definitions and plans the
// kernel is handed; the list of accepted changes; and, for the figure, the canvas world with the figure at revision
// 0), the hub as a process with its test settings, the record read back through the hub's socket (`events.read`),
// the project's trust decision as #348 records it, Claude Code sessions driven through the real deep-hook binary with
// payloads and transcripts shaped like the corpus's (adapters/corpus/claude-code), the session's own `deep show`, and
// your answer through `deep inbox answer`. Adapted from tests/acceptance/322/helpers.ts (same repo, same license),
// itself after #303's; this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here
// stands in for DeepBuild: every reading comes from the real hub, deep-hook and CLI. The test plays Claude Code: it
// fires each hook through deep-hook, as a child of the session's own process (fixtures/agent.mjs), and runs a call
// only when deep-hook's PreToolUse allows it.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

/** Each criterion's ID: `#324.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #324.5829869b';
export const AC2 = 'AC2 #324.adc9187e';
export const AC3 = 'AC3 #324.c3d7daec';
export const AC4 = 'AC4 #324.a94619b4';
export const AC5 = 'AC5 #324.96d43bd6';

/** The words the hold sends back with the numbers (design: Size and scope; the issue's Scope). */
export const CUT_IT = 'cut it to what the issue needs, or say why each part is needed';

/** The prompt this suite types for a change (#303's and #322's words), and the edits that make the checks pass. */
export const BEHAVIOR = 'make the auth middleware reject expired tokens';
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
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// A judgement throws an Error naming the criterion; a setup that didn't hold throws one starting BLOCKED.
export function must(ok: boolean, message: string): asserts ok {
  if (!ok) throw Error(message);
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh324-'));
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
/** The environment a child gets: HOME the test's home, and no DEEP_/GIT_/XDG_/CLAUDE settings, forge tokens or billing keys of this process's. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('CLAUDE') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
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

// ---- The definitions and plans the kernel is handed (README).
/** One requirement of a handed definition, in #322's Fields. */
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[] }
/**
 * The plan handed with a definition (README, The plan): whether it marks the issue as large, and its scope section,
 * the files and parts it will touch, the dependencies and top-level folders it names. A part is a part of the code by
 * name, or a document's item by its stable ID.
 */
export interface Plan { large: boolean; scope: { files: string[]; parts: string[]; dependencies: string[]; folders: string[] } }
/** A definition the kernel is handed for an ask (by the prompt's exact text), with its issue's kind and its plan (README). */
export interface Draft { ask: string; kind: string; plan: Plan; requirements: Requirement[]; deliverables: string[]; budget: null }

export const req = (id: string, text: string, o: Partial<Requirement> = {}): Requirement => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check: null, on_base: 'fails', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...o,
});
export const plan = (scope: Partial<Plan['scope']>, large = false): Plan => ({ large, scope: { files: [], parts: [], dependencies: [], folders: [], ...scope } });
/** The drafted check the repo holds at its base commit: it fails until FLAG is made (the middleware says it rejects expired tokens). */
export const CHECK_FILE = '.deepbuild/checks/expired-token.sh';
export const CHECK_BYTES = '#!/bin/sh\n# Drafted check: an expired token is rejected with 401.\nnode --test tests/expired.test.js\n';
/** The test the drafted check runs (a check that counts no test runs nothing): it fails until FLAG is made. */
export const EXPIRED_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('the middleware rejects an expired token with 401', () => {\n  assert.strictEqual(auth.rejectsExpired, true);\n});\n";
/** R1 of the definition handed for BEHAVIOR: the drafted check judges it. */
export const R1 = () => req('R1', 'An expired token is rejected with 401', { check: CHECK_FILE, asserts: ['tests/expired.test.js:5'] });
/** The kind of issue every task in this suite is, and the kind of the accepted changes that count for it. */
export const KIND = 'feature';
/** The definition handed for BEHAVIOR: R1 with the drafted check, and the plan given. */
export const BEHAVIOR_DRAFT = (p: Plan, o: Partial<Draft> = {}): Draft => ({ ask: BEHAVIOR, kind: KIND, plan: p, requirements: [R1()], deliverables: ['src/auth.js'], budget: null, ...o });

/** The repo's spec, `.deepbuild/done.yaml`: one claim, done, with the unit check (#322's). */
export const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
/** The unit test: checkToken rejects a token whose exp has passed. It fails at the base commit and passes once FIX is made. */
export const UNIT_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken rejects an expired token', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\n";
/** The middleware; it reads its clock from src/clock.js, so every check that loads it reaches that file too. */
export const AUTH_JS = "const clock = require('./clock.js');\nmodule.exports = {\n  checkToken: (token) => token.exp > 0,\n  rejectsExpired: false,\n  now: clock.now,\n};\n";
export const CLOCK_JS = "// The middleware's clock.\nmodule.exports = { now: () => Date.now() };\n";
/** A module no check loads and the auth plans never name. */
export const BILLING_JS = "// Billing: invoice totals.\nmodule.exports = { total: (lines) => lines.reduce((a, l) => a + l.amount, 0) };\n";
export const PACKAGE_JSON = `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node --test tests/unit.test.js' }, dependencies: {} }, null, 2)}\n`;

/** Your ask settings (#319's shape, as #322's suite writes them): a taste call's deadline is 3 days, its default the recommended option. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export const TASTE_DEADLINE_MS = 3 * 24 * 3600 * 1000;
export const ACCOUNT = 'acct-dh324-0001';

// ---- Your accepted changes (README, The changes you accepted: DEEP_HUB_TEST_ACCEPTED).
/** One change of the history: its kind, and the files it added (path to line count) under `dir`. */
interface Past { kind: string; files: number; lines: number; dir: string }
/**
 * The repo's history before the session's base: 20 accepted feature changes, each 17 lines added over 3 new files
 * (so the median for a feature is 17 lines and 3 files, no dependency, no top-level folder), then the 15 most recent
 * accepted changes, each a fix of 400 lines over 3 files. The last 20 accepted changes of any kind are 15 fixes and 5
 * features, whose median is 400 lines: only a reading that keeps to the feature kind gets 17.
 */
export const HISTORY: readonly Past[] = [
  ...Array.from({ length: 20 }, (_, i) => ({ kind: KIND, files: 3, lines: 17, dir: `src/feat/f${String(i + 1).padStart(2, '0')}` })),
  ...Array.from({ length: 15 }, (_, i) => ({ kind: 'fix', files: 3, lines: 400, dir: `src/fixes/x${String(i + 1).padStart(2, '0')}` })),
];
/** The usual size of a feature change in the world's repo: the median of its last 20 accepted feature changes. */
export const USUAL = { lines: 17, files: 3 } as const;
/** `n` lines of plain JavaScript, each its own statement, numbered so no two files share a block. */
export const jsLines = (name: string, n: number): string => Array.from({ length: n }, (_, i) => `exports.${name}_${i + 1} = ${i + 1};`).join('\n') + '\n';
/** Splits `lines` over `files` as evenly as it goes, the first files taking the remainder. */
const split = (lines: number, files: number): number[] => Array.from({ length: files }, (_, i) => Math.floor(lines / files) + (i < lines % files ? 1 : 0));

export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; drafts: string; accepted: string; show: string; base: string }
export interface WorldOptions {
  drafts?: Draft[];
  /** The canvas world (DEEP_HUB_TEST_SHOW), when the test draws a figure. */
  show?: Line;
  /** The middleware already fixed at the base (FIX and FLAG made), so the repo's checks pass with no code change. */
  fixed?: boolean;
}
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the first
 * rules.json and config.json with your ask settings; `<home>/.claude.json` names the account. `<tmp>/repo` is a git
 * repository: the base files in a first commit, then HISTORY's 35 changes, one commit each, every one accepted
 * (`<tmp>/accepted.json`, DEEP_HUB_TEST_ACCEPTED). Its HEAD (`base`) is where every session starts. `<tmp>/confirm`
 * says `confirmed` (DEEP_HUB_TEST_CONFIRM). `<tmp>/drafts.json` is DEEP_HUB_TEST_DRAFTS, `<tmp>/show.json`
 * DEEP_HUB_TEST_SHOW.
 */
export function makeWorld(o: WorldOptions = {}): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  const put = (path: string, bytes: string, mode?: number) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), bytes, mode === undefined ? {} : { mode });
  };
  put('src/auth.js', o.fixed ? AUTH_JS.replace(FIX.from, FIX.to).replace(FLAG.from, FLAG.to) : AUTH_JS);
  put('src/clock.js', CLOCK_JS);
  put('src/billing.js', BILLING_JS);
  put('tests/unit.test.js', UNIT_TEST);
  put('tests/expired.test.js', EXPIRED_TEST);
  put(CHECK_FILE, CHECK_BYTES, 0o755);
  put('.deepbuild/done.yaml', SPEC);
  put('package.json', PACKAGE_JSON);
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  git(tmp, repo, ['add', '.']);
  git(tmp, repo, ['commit', '-q', '-m', 'base']);
  const real = realpathSync(repo);
  const accepted: Line[] = [];
  const start = Date.now() - HISTORY.length * 3_600_000;
  HISTORY.forEach((p, i) => {
    split(p.lines, p.files).forEach((n, f) => put(`${p.dir}/part${f + 1}.js`, jsLines(`${p.dir.replace(/\W/g, '_')}_${f + 1}`, n)));
    git(tmp, repo, ['add', '.']);
    git(tmp, repo, ['commit', '-q', '-m', `${p.kind}: change ${i + 1}`]);
    const commit = git(tmp, repo, ['rev-parse', 'HEAD']);
    accepted.push({ repo: real, kind: p.kind, base: git(tmp, repo, ['rev-parse', 'HEAD~1']), commit, accepted_at: start + i * 3_600_000 });
  });
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3 }, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: o.drafts ?? [] }, null, 2)}\n`);
  const acceptedFile = join(tmp, 'accepted.json');
  writeFileSync(acceptedFile, `${JSON.stringify({ accepted }, null, 2)}\n`);
  const show = join(tmp, 'show.json');
  writeFileSync(show, `${JSON.stringify(o.show ?? {})}\n`);
  return { tmp, home, root, repo: real, confirm, drafts, accepted: acceptedFile, show, base };
}
export function git(tmp: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}
/** The canvas world rewritten (the hub reads it again when it changes). */
export function setShow(w: World, show: Line): void {
  writeFileSync(w.show, `${JSON.stringify(show)}\n`);
}

/**
 * The project's trust decision as #348 records it (#322's suite): your answer on the trusted path, appended to the
 * record at `<home>/.deepbuild/ledger.db` through `openTrust` of the extension host's public entry. Made with no hub
 * running on the record, before the first hub starts.
 */
export async function trustRepo(w: World): Promise<void> {
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openTrust } = await import('../../../packages/extension-host/src/index.ts');
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: Date.now });
  try {
    const trust = await openTrust({ record, now: Date.now });
    await trust.answer({ writer: 'app', actor: 'you', scope: 'you' }, w.repo, true);
  } finally {
    await record.close();
  }
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; stderr(): string }
/**
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, DEEP_HUB_TEST_DRAFTS, DEEP_HUB_TEST_ACCEPTED, DEEP_HUB_TEST_SHOW
 * and DEEP_HUB_TEST_STOP_HOLD_MS. A hub that doesn't start is BLOCKED.
 */
export async function startHub(w: World, o: { holdMs?: number } = {}): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_ACCEPTED: w.accepted,
    DEEP_HUB_TEST_SHOW: w.show,
    DEEP_HUB_TEST_STOP_HOLD_MS: String(o.holdMs ?? 30_000),
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
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, stderr: () => err };
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
export interface Ev { v?: number; id: string; kind: string; log_pos: number; ts: number; writer?: string; actor?: string; scope?: string; subject?: string; session?: string; seq?: string; data: Line; [key: string]: unknown }
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
/** An event's kind and data in one line, for failure messages. */
export const said = (e: Ev | undefined): string => (e ? `${e.kind} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 700)}` : 'no event');
export const listed = (events: readonly Ev[]): string => events.map(said).join('; ') || 'none';

/** The session's prompts, in log order. */
export const asksOf = (events: readonly Ev[], s: Session): Ev[] => events.filter((e) => e.kind === 'user.ask' && e.session === s.id);
export const askNamed = (events: readonly Ev[], s: Session, text: string): Ev | undefined => asksOf(events, s).find((e) => e.data.text === text);
/** The thread the session's start recorded. */
export const threadOf = (events: readonly Ev[], s: Session): string | undefined => events.find((e) => e.kind === 'session.start' && e.session === s.id && typeof e.data.thread === 'string')?.data.thread as string | undefined;
/** The tasks opened under a thread, in log order. */
export const tasksIn = (events: readonly Ev[], thread: string | undefined): Ev[] => events.filter((e) => e.kind === 'task.created' && thread !== undefined && e.data.thread === thread);
/** The definitions locked for a task, in log order. */
export const lockedFor = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
/** The task a prompt opened, as its user.ask names it: its one entry in `tasks`, or undefined. */
export const taskOf = (ask: Ev | undefined): string | undefined => (Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined);
/** The prompt's task: its user.ask names one task, and a task.created under the session's thread has that task_ref. */
export function expectTask(events: readonly Ev[], s: Session, text: string, who: string): string {
  const ask = askNamed(events, s, text);
  must(ask !== undefined, `BLOCKED: ${who} the prompt "${text}" must be recorded as a user.ask: the session's are ${listed(asksOf(events, s))}`);
  const ref = taskOf(ask);
  must(ref !== undefined, `BLOCKED: ${who} the prompt "${text}" asks for a change, so its user.ask must name the one task it opens: ${said(ask)}`);
  const thread = threadOf(events, s);
  const created = tasksIn(events, thread).filter((e) => e.data.task_ref === ref);
  must(created.length === 1, `BLOCKED: ${who} the prompt "${text}" must open one task under the session's thread (${thread ?? 'no thread recorded'}): ${listed(tasksIn(events, thread))}`);
  return ref!;
}
/** Opens the session's task for `text` and waits for its handed definition to lock; BLOCKED when it doesn't. */
export async function lockedTask(hub: Hub, s: Session, text: string, who: string): Promise<string> {
  const events = await settle(hub, (all) => { try { return lockedFor(all, expectTask(all, s, text, who)).length > 0; } catch { return false; } }, 60_000);
  const ref = expectTask(events, s, text, who);
  must(lockedFor(events, ref).length > 0, `BLOCKED: ${who} the handed definition of ${ref} must lock before the agent works: none was recorded`);
  return ref;
}

/** The claims made for a task after a log position: claim.made events naming it, in log order. */
export const claimsOf = (events: readonly Ev[], ref: string, since = 0): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.log_pos > since && e.data.task_ref === ref);
/** The claim handles (`claim:<id>`) of every event after `since` naming the task (#322's reading). */
export const claimHandles = (events: readonly Ev[], ref: string, since: number): Set<string> => new Set(events.filter((e) => e.log_pos > since && e.data?.task_ref === ref).map((e) => `claim:${e.id}`));
/**
 * What the record says of the task's claims after `since` (README, Listed in the claim): every event after it whose
 * data names the task, or one of its claims (`claim`, or its subject), other than the session's own prompts and
 * tool calls and the claim's check runs.
 */
export function claimRecord(events: readonly Ev[], ref: string, since: number): Ev[] {
  const claims = claimHandles(events, ref, since);
  return events.filter((e) => e.log_pos > since && !/^(user\.ask|tool\.|hook\.|session\.|run\.)/.test(e.kind)
    && (e.data?.task_ref === ref || claims.has(String(e.data?.claim)) || claims.has(String(e.subject))));
}
/** The verdicts made on any claim of the task after `since`. */
export const taskVerdicts = (events: readonly Ev[], ref: string, since: number): Ev[] => { const claims = claimHandles(events, ref, since); return events.filter((e) => e.kind === 'verdict.made' && e.log_pos > since && (claims.has(String(e.data.claim)) || claims.has(String(e.subject)))); };
/** The runs started for the task's claims after `since`, each with its finish. */
export function runsOf(events: readonly Ev[], ref: string, since: number): { started: Ev; finished: Ev | undefined }[] {
  const claims = claimHandles(events, ref, since);
  return events.filter((e) => e.kind === 'run.started' && e.log_pos > since && claims.has(String(e.data.claim)))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
/** Whether every run started for the task's claims after `since` has finished, and at least one did. */
export const runsDone = (events: readonly Ev[], ref: string, since: number): boolean => { const r = runsOf(events, ref, since); return r.length > 0 && r.every((x) => x.finished !== undefined); };
/** The asks raised after `since`. */
export const asksRaised = (events: readonly Ev[], since: number): Ev[] => events.filter((e) => e.kind === 'ask.created' && e.log_pos > since);
/** The taste calls raised after `since`. */
export const tasteCalls = (events: readonly Ev[], since: number): Ev[] => asksRaised(events, since).filter((e) => e.data.kind === 'taste');
/** An ask's options as `id label` lines, for matching words and failure messages. */
export const optionWords = (ask: Ev): string[] => ((ask.data.options ?? []) as Line[]).map((o) => `${String(o.id ?? '')} ${String(o.label ?? '')}`);

// ---- Listings (README, Listed in the claim). The record's shape for a listing is the implementer's; these read it as
// structure: an entry that names a thing is an object one of whose own string fields names it, or a string that does.
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** Every object and string inside a value, depth first. */
function* walk(value: unknown): Generator<Json> {
  if (typeof value === 'string') { yield value; return; }
  if (Array.isArray(value)) { for (const v of value) yield* walk(v); return; }
  if (typeof value === 'object' && value !== null) {
    yield value as Json;
    for (const v of Object.values(value)) yield* walk(v);
  }
}
/**
 * Entries that name `name` (a test on a string) together with one of `origins`: an object with an own string field
 * `name` accepts, and an origin anywhere inside it; or one string that `name` accepts and that holds an origin.
 */
export function entriesWith(value: unknown, name: (s: string) => boolean, origins: readonly string[]): Json[] {
  return [...walk(value)].filter((v) => {
    if (typeof v === 'string') return name(v) && origins.some((o) => v.includes(o));
    if (Array.isArray(v) || v === null || typeof v !== 'object') return false;
    const own = Object.values(v).filter((x): x is string => typeof x === 'string');
    return own.some(name) && origins.some((o) => JSON.stringify(v).includes(o));
  });
}
/**
 * The lists in a value that name `name`: each array with a string element that names it, or with an object element
 * one of whose own string fields does, as the strings and own string fields of its elements; and each object one of
 * whose own string fields names it, as its own strings. A list that is a listing of what's outside the plan names
 * nothing that the plan or a check covers.
 */
export function listsNaming(value: unknown, name: string): string[][] {
  const out: string[][] = [];
  const own = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v).filter((x): x is string => typeof x === 'string') : []);
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      const strings = v.flatMap(own);
      if (strings.some((s) => s.includes(name))) out.push(strings);
      v.forEach(visit);
    } else if (v && typeof v === 'object') {
      const strings = own(v);
      if (strings.some((s) => s.includes(name))) out.push(strings);
      Object.values(v).forEach(visit);
    }
  };
  visit(value);
  return out;
}

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session and of every command its Bash tool runs.
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
  static start(w: World, cwd: string): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number, exe?: string): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, ...(exe ? { exe } : {}), args, cwd, input, timeoutMs })}\n`);
    });
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
/** Whether a stop's reply is a send-back carrying the size-and-scope words. */
export const sizeSendBack = (r: Ran): boolean => decision(r) === 'deny' && replyText(r).toLowerCase().includes(CUT_IT);

let calls = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  readonly hooks: { event: string; ran: Ran }[] = [];
  constructor(readonly w: World, cwd = w.repo) {
    this.id = randomUUID();
    this.cwd = cwd;
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
    const ran = await agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
    this.hooks.push({ event, ran });
    return ran;
  }
  /** A command the session's Bash tool runs: a child of the session's own Claude Code process, in its cwd. */
  exec(exe: string, args: readonly string[], timeoutMs = 60_000): Promise<Ran> {
    return agents.get(this.id)!.run(args, this.cwd, '', timeoutMs, exe);
  }
  /** SessionStart, with its source. */
  async start(source: 'startup' | 'resume' | 'clear' | 'compact' = 'startup'): Promise<Ran> {
    this.prompt = undefined;
    const r = await this.hook('SessionStart', { source, model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook (${source}) must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A prompt you typed: its transcript entry (turnOrigin human) and its UserPromptSubmit. */
  async typed(text: string): Promise<Ran> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
    return r;
  }
  /**
   * One tool call: the assistant's tool_use entry and PreToolUse; when allowed, `effect` (what the call does, awaited),
   * its tool_result entry and PostToolUse.
   */
  async call(tool_name: string, tool_input: Line, o: { response?: Line; effect?: () => unknown; timeoutMs?: number } = {}): Promise<{ id: string; allowed: boolean; before: Ran; after?: Ran }> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id }, o.timeoutMs);
    if (decision(before) !== 'allow') return { id, allowed: false, before };
    const produced = await o.effect?.();
    const response = o.response ?? (produced && typeof produced === 'object' ? (produced as Line) : { stdout: '', stderr: '', interrupted: false, isImage: false });
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    const after = await this.hook('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40 });
    return { id, allowed: true, before, after };
  }
  /** The agent reads a file of the repository (Read). */
  async read(file: string): Promise<void> {
    const path = join(this.cwd, file);
    const content = readFileSync(path, 'utf8');
    const r = await this.call('Read', { file_path: path }, { response: { type: 'text', file: { filePath: path, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } } });
    if (!r.allowed) throw Error(`BLOCKED: the Read of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent's Edit of a file: PreToolUse, and when allowed the edit is made and PostToolUse fired. */
  editCall(file: string, from: string, to: string, timeoutMs?: number): Promise<{ id: string; allowed: boolean; before: Ran }> {
    const path = join(this.cwd, file);
    return this.call('Edit', { file_path: path, old_string: from, new_string: to, replace_all: false }, {
      response: { filePath: path, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false },
      effect: () => writeFileSync(path, readFileSync(path, 'utf8').replace(from, to)),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  }
  /** The agent edits a file of the repository (Edit), and the edit is made; a denied edit is BLOCKED. Returns the call's ID. */
  async edit(file: string, from: string, to: string): Promise<string> {
    const r = await this.editCall(file, from, to);
    if (!r.allowed) throw Error(`BLOCKED: the Edit of ${file} must be allowed: ${shown(r.before)}`);
    return r.id;
  }
  /** The agent writes a file of the repository (Write), and it is written; a denied write is BLOCKED. Returns the call's ID. */
  async write(file: string, content: string): Promise<string> {
    const path = join(this.cwd, file);
    const r = await this.call('Write', { file_path: path, content }, { response: { type: 'create', filePath: path, content, structuredPatch: [] }, effect: () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); } });
    if (!r.allowed) throw Error(`BLOCKED: the Write of ${file} must be allowed: ${shown(r.before)}`);
    return r.id;
  }
  /** The agent's Bash call: PreToolUse, and when allowed `effect` runs it; its result is the tool's response. */
  bash(command: string, effect?: () => unknown): Promise<{ id: string; allowed: boolean; before: Ran }> {
    return this.call('Bash', { command, description: command.slice(0, 40) }, effect ? { effect } : {});
  }
  /** The agent's last words of the turn, then Stop. */
  async stop(words = 'Done.'): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
}

/** Your answer on the trusted path: `deep inbox answer <ask> <option>`, the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
export async function answer(w: World, ask: Ev, option: string): Promise<Ran> {
  return run(NODE, [CLI, 'inbox', 'answer', `ask:${ask.id}`, option], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
}
