// Shared test-side tools for issue #325's acceptance tests (README): a temp world (a home with the shipped default
// guards, your ask settings and the OS-confirmation stub; a git repository with a `.deepbuild/done.yaml` spec, a unit
// test and drafted checks; the definitions the kernel is handed, the test work source's readings and the recorded
// prices), the hub as a process with its test settings, the record read back through the hub's socket (`events.read`,
// `inbox.read`, `changes.read`), Claude Code sessions driven through the real deep-hook binary with payloads and
// transcripts shaped like the corpus's, the session's own `deep mcp` for deep_ask, and your answer through `deep inbox
// answer`. Adapted from tests/acceptance/322/helpers.ts (same repo, same license); this suite keeps its own copy so a
// redraft of theirs never moves these tests. Nothing here stands in for DeepBuild: every reading comes from the real
// hub, deep-hook and CLI. The test plays Claude Code, including what Claude Code writes into the transcript from a
// hook's reply (a `hook_additional_context` attachment, a Stop's "Stop hook feedback").

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import net from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

/** Each criterion's ID: `#325.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #325.48d4efcc';
export const AC2 = 'AC2 #325.9d341426';
export const AC3 = 'AC3 #325.ae91cc84';
export const AC4 = 'AC4 #325.84b92502';
export const AC5 = 'AC5 #325.3ce2ada4';
export const AC6 = 'AC6 #325.e4aeb66b';
export const AC7 = 'AC7 #325.ea463eff';
export const AC8 = 'AC8 #325.7685f017';
export const AC9 = 'AC9 #325.68bf903d';

/** The stop hold every hub here runs with (DEEP_HUB_TEST_STOP_HOLD_MS): long enough for a stop's fast-lane checks, even on a loaded machine, and short enough that a stop let through with an ask open waits half a minute, not a whole one. */
export const HOLD_MS = 30_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const tag = (n = 4) => randomBytes(n).toString('hex');
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
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
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
/** Whether other work loads the machine past its core count (design: a timing check under load). */
export const loaded = (): boolean => loadavg()[0]! > availableParallelism();

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
export async function failureOf(judge: () => Promise<unknown>): Promise<string | null> {
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
  const dir = realpathSync(mkdtempSync('/tmp/dh325-'));
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

// ---- The definitions the kernel is handed, the test work source, and the recorded prices (README).
/** The kinds of spend a paid check is (README, Paid checks): `paid` on a handed requirement. */
export type PaidKind = 'live call' | 'hosted browser run' | 'model job';
/** One requirement of a handed definition, in #303's and #322's Fields, with this suite's `paid`. */
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[]; paid?: PaidKind }
/** A definition the kernel is handed for a work item, by its source_id (`issue`). */
export interface Draft { issue: string; requirements: Requirement[]; deliverables: string[]; budget: null }
/** A test work source's reading, in work.item@1's fields; `body` is the text itself here. */
export interface Reading { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: 'owner' | 'collaborator' | 'outside' }[]; updated: string }
/** The recorded prices (README, DEEP_HUB_TEST_PRICES): each paid check's price, and the cost reading its run lands with. */
export interface Prices { prices: Record<string, number>; costs: Record<string, number> }

export const req = (id: string, text: string, o: Partial<Requirement> = {}): Requirement => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check: null, on_base: 'fails', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...o,
});

/** The repo's spec, `.deepbuild/done.yaml`: one claim, done, with the unit check, a node:test run the hermetic runner counts. */
export const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
/** The unit test: checkToken rejects a token whose exp has passed. It fails at the base commit and passes once FIX is made. */
export const UNIT_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken rejects an expired token', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\n";
/** `note` is the line each round's edit bumps, so every stop's snapshot changes the checks' inputs and they run again. */
export const AUTH_JS = "module.exports = {\n  checkToken: (token) => token.exp > 0,\n  rejectsExpired: false,\n  logsRejected: false,\n  allowsLegacy: false,\n  note: 0,\n};\n";
export const NET_JS = 'module.exports = { retries: 0 };\n';
/** The edit that makes the spec's unit test pass. */
export const FIX = { file: 'src/auth.js', from: 'token.exp > 0', to: 'token.exp > Date.now() / 1000' } as const;
/** The edit that makes R1's drafted check pass. */
export const FLAG = { file: 'src/auth.js', from: 'rejectsExpired: false', to: 'rejectsExpired: true' } as const;

/**
 * A drafted check: a `#!/bin/sh` file that runs its node:test file, so the runner counts the tests it ran (a bare
 * script counts none and ran nothing). Its assertion is line 4 of the test file, which `asserts` names.
 */
const check = (name: string, what: string, actual: string, expected: string) => {
  const file = `.deepbuild/checks/${name}.sh`;
  const test = `.deepbuild/checks/${name}.test.cjs`;
  return {
    file, test, assertion: `${test}:4`,
    bytes: `#!/bin/sh\n# Drafted check: ${what}\nnode --test ${test}\n`,
    testBytes: `const test = require('node:test');\nconst assert = require('node:assert');\ntest(${JSON.stringify(what)}, () => {\n  assert.strictEqual(${actual}, ${expected});\n});\n`,
  };
};
export const CHECKS = {
  /** R1's check everywhere: fails until FLAG. */
  expired: check('expired-token', 'an expired token is rejected with 401', "require('../../src/auth.js').rejectsExpired", 'true'),
  /** Fails on every commit of these tests: nothing the agent does gives src/net.js a retry. */
  retry: check('retry', 'a dropped connection is retried', "require('../../src/net.js').retries > 0", 'true'),
  /** Fails on every commit of these tests: the agent never sets logsRejected. */
  audit: check('audit', 'each rejected token is logged', "require('../../src/auth.js').logsRejected", 'true'),
  /** The three paid checks (README, Paid checks): each passes on every commit, as a guard of behavior that must not change. */
  live: check('live-quote', 'a live price quote is given for a valid token (a live call)', "require('../../src/auth.js').checkToken({ exp: Date.now() / 1000 + 3600 })", 'true'),
  hosted: check('hosted-checkout', 'the hosted checkout accepts a valid token (a hosted browser run)', "require('../../src/auth.js').checkToken({ exp: Date.now() / 1000 + 7200 })", 'true'),
  model: check('model-review', 'the model review accepts a valid token (a model job)', "require('../../src/auth.js').checkToken({ exp: Date.now() / 1000 + 600 })", 'true'),
} as const;

/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export const ACCOUNT = 'acct-dh325-0001';

// ---- The test work source (DEEP_HUB_TEST_WORK): a source that isn't GitHub, at work.test (#322's).
export const WORK_LINK = (n: number) => `https://work.test/acme/shop/issues/${n}`;
export const ITEM = (n: number) => `item-${n}`;
/** A work item written by its owner maya, its criteria as given. */
export const workItem = (n: number, title: string, criteria: readonly string[]): Reading => ({
  source_id: ITEM(n), link: WORK_LINK(n), title, body: `${title}.\n\n${criteria.map((c) => `- ${c}`).join('\n')}`, criteria: [...criteria],
  authors: [{ handle: 'maya', role: 'owner' }], updated: '2026-10-20T09:00:00Z',
});
/** The definition a drafting job would hand for the item: one requirement per criterion, R1…Rn, each from its line. */
export const draftFor = (n: number, reqs: { text: string; check: { file: string; assertion: string }; on_base?: 'fails' | 'passes'; paid?: PaidKind }[]): Draft => ({
  issue: ITEM(n),
  requirements: reqs.map((r, i) => req(`R${i + 1}`, r.text, { source_line: `${ITEM(n)}#L${i + 3}`, check: r.check.file, asserts: [r.check.assertion], on_base: r.on_base ?? 'fails', ...(r.paid ? { paid: r.paid } : {}) })),
  deliverables: ['src/auth.js'], budget: null,
});

export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; drafts: string; work: string; prices: string; base: string; main: string; head(): string }
export interface WorldOptions {
  drafts?: Draft[]; readings?: Reading[]; prices?: Prices;
  /** The repo's `.deepbuild/done.yaml`. Default SPEC. */
  spec?: string;
  /** Extra files in the repo at its base commit, path to bytes. */
  files?: Record<string, string>;
  /** Files of a later commit on main, made after the base; the session then works on branch `fix`, cut from the base (AC5). */
  mainAhead?: Record<string, string>;
}
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the first
 * rules.json and config.json with your settings; `<home>/.claude.json` names the account and marks the repo trusted in
 * Claude Code's workspace trust, so the repo's spec checks run (#322 AC1). `<tmp>/repo` is a git repository with one
 * commit on main (`base`), the folder every session works in. `<tmp>/confirm` says `confirmed` (DEEP_HUB_TEST_CONFIRM).
 * `<tmp>/drafts.json` is DEEP_HUB_TEST_DRAFTS, `<tmp>/work.json` DEEP_HUB_TEST_WORK, `<tmp>/prices.json`
 * DEEP_HUB_TEST_PRICES.
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
  const files: Record<string, string> = {
    'src/auth.js': AUTH_JS, 'src/net.js': NET_JS, 'tests/unit.test.js': UNIT_TEST, '.deepbuild/done.yaml': o.spec ?? SPEC,
    'package.json': `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node --test tests/unit.test.js' } }, null, 2)}\n`,
    ...Object.fromEntries(Object.values(CHECKS).flatMap((c) => [[c.file, c.bytes], [c.test, c.testBytes]])),
    ...o.files,
  };
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), bytes, path.endsWith('.sh') ? { mode: 0o755 } : {});
  }
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  git(tmp, repo, ['add', '.']);
  git(tmp, repo, ['commit', '-q', '-m', 'base']);
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  let main = base;
  if (o.mainAhead) {
    for (const [path, bytes] of Object.entries(o.mainAhead)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), bytes);
    }
    git(tmp, repo, ['add', '.']);
    git(tmp, repo, ['commit', '-q', '-m', 'main moves on']);
    main = git(tmp, repo, ['rev-parse', 'HEAD']);
    git(tmp, repo, ['checkout', '-q', '-b', 'fix', base]);
  }
  const real = realpathSync(repo);
  const claudeJson: Line = { oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3, projects: { [real]: { allowedTools: [], hasTrustDialogAccepted: true } } };
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify(claudeJson, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: o.drafts ?? [] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: o.readings ?? [] }, null, 2)}\n`);
  const prices = join(tmp, 'prices.json');
  writeFileSync(prices, `${JSON.stringify(o.prices ?? { prices: {}, costs: {} }, null, 2)}\n`);
  return { tmp, home, root, repo: real, confirm, drafts, work, prices, base, main, head: () => git(tmp, real, ['rev-parse', 'HEAD']) };
}
export function git(tmp: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; plant: string | undefined; stderr(): string }
/**
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, DEEP_HUB_TEST_DRAFTS, DEEP_HUB_TEST_WORK, DEEP_HUB_TEST_PRICES and
 * DEEP_HUB_TEST_STOP_HOLD_MS, and DEEP_HUB_PLANT when given. A hub that doesn't start (a plant the base doesn't list) is BLOCKED.
 */
export async function startHub(w: World, o: { plant?: string | undefined } = {}): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_WORK: w.work,
    DEEP_HUB_TEST_PRICES: w.prices,
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_STOP_HOLD_MS: String(HOLD_MS),
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
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, plant: o.plant, stderr: () => err };
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
export interface Ev { v?: number; id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; data: Line; [key: string]: unknown }
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
/** `inbox.read` (#24's RPC behind `deep inbox`): the asks in Needs you, each `{ask: 'ask:<id>', question, options: [ids]}`. */
export async function inbox(hub: Hub): Promise<Line[]> {
  return ((await control(hub, 'inbox.read', {})).asks ?? []) as Line[];
}
/** `changes.read` (#83's RPC behind the receipt): a claim's change, with its receipt's lines and the checks it ran. */
export async function receipt(hub: Hub, claim: string): Promise<Line> {
  return ((await control(hub, 'changes.read', { id: claim })).change ?? {}) as Line;
}

// ---- Readers of the record (as #322's suite reads it).
/** The thread the session's start recorded. */
export const threadOf = (events: readonly Ev[], s: Session): string | undefined => events.find((e) => e.kind === 'session.start' && e.session === s.id && typeof e.data.thread === 'string')?.data.thread as string | undefined;
/** The one task the session's thread holds (a session started from a work item), or undefined. */
export function itemTask(events: readonly Ev[], s: Session): string | undefined {
  // The prompt that started it names it (its user.ask's `tasks`), as #322's suite reads a prompt's task.
  const named = events.filter((e) => e.kind === 'user.ask' && e.session === s.id && Array.isArray(e.data.tasks) && e.data.tasks.length === 1);
  if (named.length) return String(named[0]!.data.tasks[0]);
  const thread = threadOf(events, s);
  const tasks = events.filter((e) => e.kind === 'task.created' && thread !== undefined && e.data.thread === thread);
  return tasks.length === 1 ? String(tasks[0]!.data.task_ref) : undefined;
}
/** The definitions locked for a task, in log order. */
export const lockedFor = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
/** The claims made for a task after a log position. */
export const claimsOf = (events: readonly Ev[], ref: string, since = 0): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.log_pos > since && e.data.task_ref === ref);
/** The claim handles (`claim:<id>`) of every event after `since` naming the task. */
export const claimHandles = (events: readonly Ev[], ref: string, since: number): Set<string> => new Set(events.filter((e) => e.log_pos > since && e.data?.task_ref === ref).map((e) => `claim:${e.id}`));
/** The verdicts made on any claim of the task after `since`. */
export const taskVerdicts = (events: readonly Ev[], ref: string, since: number): Ev[] => { const claims = claimHandles(events, ref, since); return events.filter((e) => e.kind === 'verdict.made' && e.log_pos > since && (claims.has(String(e.data.claim)) || claims.has(String(e.subject)))); };
/** The runs started for the task's claims after `since`, each with its finish. */
export function runsOf(events: readonly Ev[], ref: string, since: number): { started: Ev; finished: Ev | undefined }[] {
  const claims = claimHandles(events, ref, since);
  return events.filter((e) => e.kind === 'run.started' && e.log_pos > since && claims.has(String(e.data.claim)))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
/** Whether a run is of the named check: its `check` names the file or the name. */
export const runOf = (name: string) => (r: { started: Ev }): boolean => { const c = String(r.started.data.check); return c === name || c.includes(name) || new RegExp(`(^|[#:])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(c); };
/** The asks raised after `since`. */
export const asksRaised = (events: readonly Ev[], since: number): Ev[] => events.filter((e) => e.kind === 'ask.created' && e.log_pos > since);
/** An ask's options as `id label` texts. */
export const optionTexts = (ask: Ev): string[] => ((ask.data.options ?? []) as Line[]).map((o) => `${String(o.id ?? '')} ${String(o.label ?? '')}`);
/** The option of an ask whose id or label matches `re`. */
export const optionMatching = (ask: Ev, re: RegExp): string | undefined => {
  const o = ((ask.data.options ?? []) as Line[]).find((x) => re.test(`${String(x.id ?? '')} ${String(x.label ?? '')}`));
  return o ? String(o.id) : undefined;
};
/** The stopped claim's decision (README, The decision): an ask whose options split the issue, fund the live runs and accept what's proven. */
export const isStallDecision = (ask: Ev): boolean => { const t = optionTexts(ask).join('\n'); return /split/i.test(t) && /fund/i.test(t) && /accept/i.test(t); };
export const stallDecisions = (events: readonly Ev[], since = 0): Ev[] => asksRaised(events, since).filter(isStallDecision);
/** The session's stops, in log order. */
export const stopsOf = (events: readonly Ev[], s: Session): Ev[] => events.filter((e) => e.kind === 'agent.stop' && e.session === s.id);
/** The asks still open: raised, and closed by none of the asks core's closing kinds. */
export function openAsks(events: readonly Ev[]): Set<string> {
  const open = new Set(events.filter((e) => e.kind === 'ask.created').map((e) => `ask:${e.id}`));
  for (const e of events) if (/^ask\.(answered|defaulted|escalated|cancelled|superseded|moot)$/.test(e.kind)) open.delete(String(e.subject ?? e.data.ask));
  return open;
}

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session and of its `deep mcp`, as Claude Code is of its hook commands and MCP servers.
class Agent {
  private n = 0;
  private buffer = '';
  private readonly pending = new Map<number, (r: Line) => void>();
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = parseObject(this.buffer.slice(0, i));
        this.buffer = this.buffer.slice(i + 1);
        if (!line || typeof line.n !== 'number') continue;
        if ('pid' in line && !('code' in line)) { own(Number(line.pid)); continue; }
        if ('mcp_pid' in line) own(Number(line.mcp_pid));
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
  static start(w: World, cwd: string): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  private send(command: Line): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve);
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    return this.send({ args, cwd, input, timeoutMs }) as Promise<Ran>;
  }
  /** One JSON-RPC line to this agent's own `deep mcp` (started on first use, in `cwd`): the reply of its id, or null for a notification. */
  async mcp(cwd: string, line: Line, timeoutMs: number): Promise<Line | null> {
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], cwd, line, timeoutMs });
    if (typeof r.failed === 'string') throw Error(`BLOCKED: ${r.failed}`);
    return (r.reply ?? null) as Line | null;
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
/** Whether a stop was sent back: deep-hook blocked it, so the turn goes on. */
export const sentBack = (r: Ran): boolean => decision(r) === 'deny';

let calls = 0;
let rpc = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  private mcpReady = false;
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
  /**
   * `deep-hook claude-code <event>`, the hook's JSON on stdin, as a child of the session's own Claude Code process.
   * What Claude Code then writes from the reply: a hook's added context as a `hook_additional_context` attachment, and
   * a Stop's block reason as the user entry "Stop hook feedback" (as #906's suite records them).
   */
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
    const out = parseObject(ran.stdout.trim());
    const context = out?.hookSpecificOutput?.additionalContext;
    if (ran.code === 0 && typeof context === 'string' && context) {
      this.entry({ type: 'attachment', ...(this.prompt ? { promptId: this.prompt } : {}), attachment: { type: 'hook_additional_context', content: [context], hookName: event, toolUseID: fields.tool_use_id ?? event, hookEvent: event } });
    }
    if (event === 'Stop' && decision(ran) === 'deny') this.entry({ type: 'user', ...(this.prompt ? { promptId: this.prompt } : {}), message: { role: 'user', content: `Stop hook feedback:\n${replyText(ran)}` } });
    return ran;
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
   * One tool call: the assistant's tool_use entry and PreToolUse; when allowed, `effect` (what the call does, which
   * may give the response), its tool_result entry and PostToolUse.
   */
  async call(tool_name: string, tool_input: Line, o: { response?: Line; effect?: () => Line | void | Promise<Line | void> } = {}): Promise<{ id: string; allowed: boolean; before: Ran; after?: Ran }> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
    if (decision(before) !== 'allow') return { id, allowed: false, before };
    const effected = await o.effect?.();
    const response = (effected ?? o.response ?? { stdout: '', stderr: '', interrupted: false, isImage: false }) as Line;
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
  /** The agent edits a file of the repository (Edit), and the edit is made; a denied edit is BLOCKED. */
  async edit(file: string, from: string, to: string): Promise<void> {
    const path = join(this.cwd, file);
    const r = await this.call('Edit', { file_path: path, old_string: from, new_string: to, replace_all: false }, {
      response: { filePath: path, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false },
      effect: () => { writeFileSync(path, readFileSync(path, 'utf8').replace(from, to)); },
    });
    if (!r.allowed) throw Error(`BLOCKED: the Edit of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent's Bash call: PreToolUse, and when allowed `effect` runs it and gives its response. */
  bash(command: string, effect?: () => Line | void | Promise<Line | void>): Promise<{ allowed: boolean; before: Ran }> {
    return this.call('Bash', { command, description: command.slice(0, 40) }, effect ? { effect } : {});
  }
  /** The agent's last words of the turn, then Stop. */
  async stop(words = 'Done.'): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
  /**
   * The agent's deep_ask, as Claude Code calls an MCP tool: its tool_use entry and PreToolUse (`mcp__deep__deep_ask`);
   * when allowed, the call through this session's own `deep mcp` (initialized on first use), which waits for an answer
   * up to its wait and then says it is still waiting; its tool_result entry and PostToolUse. Returns the tool's value.
   */
  async deepAsk(args: Line): Promise<{ allowed: boolean; before: Ran; value: Line | undefined }> {
    const agent = agents.get(this.id)!;
    if (!this.mcpReady) {
      const init = await agent.mcp(this.cwd, { jsonrpc: '2.0', id: `init#${++rpc}`, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-325', version: '0' } } }, 30_000);
      if (!init?.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
      await agent.mcp(this.cwd, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, 5_000);
      this.mcpReady = true;
    }
    let value: Line | undefined;
    const r = await this.call('mcp__deep__deep_ask', args, {
      effect: async () => {
        const reply = await agent.mcp(this.cwd, { jsonrpc: '2.0', id: `ask#${++rpc}`, method: 'tools/call', params: { name: 'deep_ask', arguments: args } }, 90_000);
        const result = (reply?.result ?? {}) as Line;
        const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
        value = (result.structuredContent ?? (typeof text === 'string' ? parseObject(text) : undefined) ?? reply?.error) as Line | undefined;
        return result;
      },
    });
    return { allowed: r.allowed, before: r.before, value };
  }
}

/** Your answer on the trusted path: `deep inbox answer <ask> <option>`, the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
export async function answer(w: World, ask: Ev, option: string): Promise<Ran> {
  return run(NODE, [CLI, 'inbox', 'answer', `ask:${ask.id}`, option], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
}
/** Your answer, which must be taken: a refused one is BLOCKED, since the scenario can't go on without it. */
export async function answered(w: World, ask: Ev, option: string, who: string): Promise<void> {
  const r = await answer(w, ask, option);
  if (r.code !== 0) throw Error(`BLOCKED: ${who} deep inbox answer ask:${ask.id} ${option} must be taken: ${shown(r)}`);
}

/**
 * A session started from a work item (`Fix <link>`, as #322's suite starts one), its file read, and the item's handed
 * definition locked. Returns the task.
 */
export async function startOnItem(hub: Hub, s: Session, n: number, who: string): Promise<string> {
  await s.start();
  await s.typed(`Fix ${WORK_LINK(n)}`);
  await s.read('src/auth.js');
  const events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
  const ref = itemTask(events, s);
  must(ref !== undefined && lockedFor(events, ref).length > 0, `${who} the session started from ${WORK_LINK(n)} must open one task with its handed definition locked: ${ref ?? 'no task'}; ${listed(events.filter((e) => /^(task|definition|ask)\./.test(e.kind)))}`);
  return ref!;
}
