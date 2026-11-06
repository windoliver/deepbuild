// Shared test-side tools for issue #84's reach suite (README): a temp world (a home with the shipped default guards and
// your ask settings; a git repository with a `.deepbuild/done.yaml` spec and drafted checks; the definitions the kernel
// is handed, the test work source's readings, the recorded prices, and what the could-the-agent-do-it check reads), the
// hub as a process with its test settings, the record read back through the hub's socket, Claude Code and Codex
// sessions driven through the real deep-hook binary with payloads and transcripts shaped like the corpus's, DeepBuild's
// waiter, the session's own `deep mcp` for deep_ask, and your answer through `deep inbox answer`.
//
// Copied from tests/acceptance/82/helpers.ts (the world, the hub, the record, both agents' sessions) and
// tests/acceptance/325/helpers.ts (deep_ask, `deep inbox answer`, prices), same repo, same license. This suite keeps its
// own copy so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild: every reading comes
// from the real hub and deep-hook. The test plays the agent, including what Claude Code writes into the transcript from
// a hook's reply ("Stop hook feedback").

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));

/** Each criterion's ID: `#84.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const LEASED = '#84.986a9302';
export const ONE_TAP = '#84.804317c5';
export const OWNER = '#84.93a842f3';
export const REPLAY = '#84.a35c51d3';
export const SWITCH = '#84.b85e1a32';
export const ON_ITS_OWN = '#84.29e07ab1';
export const GOES_ON = '#84.21aff0fa';
export const BUDGET_CARD = '#84.649e58d4';
export const DEFAULT_CARD = '#84.a45e1085';
export const ASK_USER = '#84.d85d8803';
export const URL_PLAIN = '#84.a7a12533';
export const TRUSTED_PATH = '#84.28df6377';

/** The stop hold every hub here runs with (DEEP_HUB_TEST_STOP_HOLD_MS). */
export const HOLD_MS = 20_000;

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
const newestOf = (file: string): string => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters', file), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; };
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
export const COVERED = newestOf('claude-code.facts.json');
/** The newest Codex version the facts cover, in every rollout's session_meta. */
export const CODEX_COVERED = newestOf('codex.facts.json');
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
  const dir = realpathSync(mkdtempSync('/tmp/dh84r-'));
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
  for (const dir of made.splice(0)) try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a stopping process still wrote there; /tmp is cleared by the OS */ }
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
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
  });
}

// ---- The definitions the kernel is handed and the test work source (README, The world).
export type PaidKind = 'live call' | 'hosted browser run' | 'model job';
/** One requirement of a handed definition, in #303's and #322's fields, with #325's `paid`. */
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[]; paid?: PaidKind }
export interface Draft { issue: string; requirements: Requirement[]; deliverables: string[]; budget: null }
/** A test work source's reading, in work.item@1's fields; `body` is the text itself here. */
export interface Reading { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: 'owner' | 'collaborator' | 'outside' }[]; updated: string }

/** The repo's spec, `.deepbuild/done.yaml`: one claim, done, with the unit check, which passes on every commit here. */
export const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
export const UNIT_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken rejects an expired token', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\n";
/** `note` is the line a round's edit bumps, so a stop's snapshot changes the checks' inputs and they run again. */
export const AUTH_JS = "module.exports = {\n  checkToken: (token) => token.exp > Date.now() / 1000,\n  rejectsExpired: false,\n  note: 0,\n};\n";
/** Where sessions live: no store until the agent picks one. */
export const STORE_JS = "module.exports = {\n  kind: null,\n};\n";
/** The edit that makes CHECKS.expired pass. */
export const FLAG = { file: 'src/auth.js', from: 'rejectsExpired: false', to: 'rejectsExpired: true' } as const;

/** A drafted check: a `#!/bin/sh` file that runs its node:test file, its assertion line 4 of the test file. */
const check = (name: string, what: string, actual: string, expected: string) => {
  const file = `.deepbuild/checks/${name}.sh`;
  const test = `.deepbuild/checks/${name}.test.cjs`;
  return {
    file, test, assertion: `${test}:4`,
    bytes: `#!/bin/sh\n# Drafted check: ${what}\nnode --test ${test}\n`,
    testBytes: `const test = require('node:test');\nconst assert = require('node:assert');\ntest(${JSON.stringify(what)}, () => {\n  assert.strictEqual(${actual}, ${expected});\n});\n`,
  };
};
export type Check = ReturnType<typeof check>;
export const CHECKS = {
  /** Fails until FLAG. */
  expired: check('expired-token', 'an expired token is rejected with 401', "require('../../src/auth.js').rejectsExpired", 'true'),
  /** Fails until a store is picked, and passes on either store: the requirement doesn't say which. */
  store: check('session-store', 'a session survives a restart', "require('../../src/store.js').kind !== null", 'true'),
  /** A paid check that passes on every commit. */
  live: check('live-quote', 'a live price quote is given for a valid token (a live call)', "require('../../src/auth.js').checkToken({ exp: Date.now() / 1000 + 3600 })", 'true'),
} as const;

export const CRITERIA = { expired: 'An expired token is rejected with 401', store: 'A session survives a restart', live: 'A live price quote is given for a valid token' } as const;

/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export const ACCOUNT = 'acct-dh84-0001';

export const WORK_LINK = (n: number) => `https://work.test/acme/shop/issues/${n}`;
export const ITEM = (n: number) => `item-${n}`;
/** One requirement as a test names it. */
export interface Wanted { text: string; check: Check; on_base?: 'fails' | 'passes'; paid?: PaidKind }
export const EXPIRED: Wanted = { text: CRITERIA.expired, check: CHECKS.expired };
export const STORE: Wanted = { text: CRITERIA.store, check: CHECKS.store };
/** Item n with the given requirements: its reading and the definition a drafting job would hand for it, R1…Rn, each from its line. */
export const item = (n: number, reqs: readonly Wanted[] = [EXPIRED]): { reading: Reading; draft: Draft } => ({
  reading: { source_id: ITEM(n), link: WORK_LINK(n), title: `Item ${n}`, body: `Item ${n}.\n\n${reqs.map((r) => `- ${r.text}`).join('\n')}`, criteria: reqs.map((r) => r.text), authors: [{ handle: 'maya', role: 'owner' }], updated: '2026-10-20T09:00:00Z' },
  draft: {
    issue: ITEM(n), deliverables: ['src/auth.js', 'src/store.js'], budget: null,
    requirements: reqs.map((r, i) => ({
      id: `R${i + 1}`, text: r.text, source_line: `${ITEM(n)}#L${i + 3}`, refuted_by: `a run where ${r.text.toLowerCase()} does not hold`, check: r.check.file, on_base: r.on_base ?? 'fails', asserts: [r.check.assertion], depth: 'unit', oracle: 'code', near_misses: [],
      ...(r.paid ? { paid: r.paid } : {}),
    })),
  },
});

/**
 * What the check before a task reaches you reads (DEEP_HUB_TEST_REACH; README, Surfaces the implementer must provide).
 * `tools`: what the agent can run. `profiles`: signed-in browser profiles, `leased` when you leased it to this agent.
 * `credentials`: secrets held by reference. `grants`: your standing grants. `access`: who already has access to a repo.
 */
export interface Reach {
  tools?: { name: string; kind: 'cli' | 'mcp' | 'browser' | 'computer'; provider?: string; signed_in?: boolean; connector?: string; read_only?: boolean; reads?: string[] }[];
  profiles?: { profile: string; provider: string; leased: boolean }[];
  credentials?: { secret: string; provider?: string }[];
  grants?: { grant: string; step: string }[];
  access?: { repo: string; who: 'you' | 'agent'; via: string }[];
}

export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; drafts: string; work: string; prices: string; reach: string; base: string }
export interface WorldOptions {
  items?: { reading: Reading; draft: Draft }[];
  reach?: Reach;
  prices?: { prices: Record<string, number>; costs: Record<string, number> };
}
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the first
 * rules.json and config.json with your settings; `<home>/.claude.json` names the account and marks the repo trusted.
 * `<tmp>/repo` is a git repository with one commit on main. The rest are the test settings' files: `<tmp>/confirm` says
 * `confirmed` (DEEP_HUB_TEST_CONFIRM); drafts.json, work.json, prices.json and reach.json.
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
    'src/auth.js': AUTH_JS, 'src/store.js': STORE_JS, 'tests/unit.test.js': UNIT_TEST, '.deepbuild/done.yaml': SPEC,
    'package.json': `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node --test tests/unit.test.js' } }, null, 2)}\n`,
    ...Object.fromEntries(Object.values(CHECKS).flatMap((c) => [[c.file, c.bytes], [c.test, c.testBytes]])),
  };
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), bytes, path.endsWith('.sh') ? { mode: 0o755 } : {});
  }
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  git(tmp, repo, ['add', '.']);
  git(tmp, repo, ['commit', '-q', '-m', 'base']);
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  const real = realpathSync(repo);
  const claudeJson: Line = { oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3, projects: { [real]: { allowedTools: [], hasTrustDialogAccepted: true } } };
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify(claudeJson, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: (o.items ?? []).map((i) => i.draft) }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: (o.items ?? []).map((i) => i.reading) }, null, 2)}\n`);
  const prices = join(tmp, 'prices.json');
  writeFileSync(prices, `${JSON.stringify(o.prices ?? { prices: {}, costs: {} }, null, 2)}\n`);
  const reach = join(tmp, 'reach.json');
  writeFileSync(reach, `${JSON.stringify({ tools: [], profiles: [], credentials: [], grants: [], access: [], ...o.reach }, null, 2)}\n`);
  return { tmp, home, root, repo: real, confirm, drafts, work, prices, reach, base };
}
export function git(tmp: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; plant: string | undefined; stderr(): string }
/** Starts `deep hub run` with the test settings; DEEP_HUB_PLANT when given. A plant the hub doesn't list is BLOCKED (README, Plants). */
export async function startHub(w: World, o: { plant?: string | undefined } = {}): Promise<Hub> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_WORK: w.work,
    DEEP_HUB_TEST_PRICES: w.prices,
    DEEP_HUB_TEST_REACH: w.reach,
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
  if (!ready || ready.ready !== true) {
    if (o.plant && /names no planted program/.test(err)) throw Error(`BLOCKED: plant ${o.plant} not listed in packages/hub/src/plant.ts (DEEP_HUB_PLANT=${o.plant}): ${err.slice(-300)}`);
    throw Error(`BLOCKED: the hub${o.plant ? ` with the plant DEEP_HUB_PLANT=${o.plant}` : ''} did not start: ${err.slice(-1500)}`);
  }
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
export async function settle(hub: Hub, done: (events: Ev[]) => boolean, timeoutMs = 20_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await allEvents(hub);
    if (done(events) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
/** An event's kind and data in one line, for failure messages. */
export const said = (e: Ev | undefined): string => (e ? `${e.kind} ${e.id} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 600)}` : 'no event');
export const listed = (events: readonly Ev[]): string => events.map(said).join('; ') || 'none';

// ---- Readers of the record.
export function itemTask(events: readonly Ev[], s: { id: string }, text: string): string | undefined {
  const named = events.filter((e) => e.kind === 'user.ask' && e.session === s.id && e.data.text === text && Array.isArray(e.data.tasks) && e.data.tasks.length === 1);
  return named.length ? String(named[0]!.data.tasks[0]) : undefined;
}
export const lockedFor = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
export const claimsIn = (events: readonly Ev[], since = 0, until = Infinity): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.log_pos > since && e.log_pos < until);
export const claimsOf = (events: readonly Ev[], ref: string, since = 0, until = Infinity): Ev[] => claimsIn(events, since, until).filter((e) => e.data.task_ref === ref);
export const handles = (claims: readonly Ev[]): Set<string> => new Set(claims.map((c) => `claim:${c.id}`));
export const sendBacksIn = (events: readonly Ev[], since = 0, until = Infinity): Ev[] => events.filter((e) => e.kind === 'claim.sent_back' && e.log_pos > since && e.log_pos < until);
export const verdictsIn = (events: readonly Ev[], since = 0, until = Infinity): Ev[] => events.filter((e) => e.kind === 'verdict.made' && e.log_pos > since && e.log_pos < until);
/** A verdict's outcome, as the record says it. */
export const outcomeOf = (v: Ev): string => String(v.data.outcome ?? v.data.verdict ?? 'none');
/** The runs started for the given claims, each with its finish. */
export function runsFor(events: readonly Ev[], claims: Set<string>): { started: Ev; finished: Ev | undefined }[] {
  return events.filter((e) => e.kind === 'run.started' && claims.has(String(e.data.claim)))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
/** The asks raised in a window, in log order. */
export const asksIn = (events: readonly Ev[], since = 0, until = Infinity): Ev[] => events.filter((e) => e.kind === 'ask.created' && e.log_pos > since && e.log_pos < until);
/** The asks a session raised after `since`. */
export const asksOf = (events: readonly Ev[], s: { id: string }, since = 0): Ev[] => asksIn(events, since).filter((e) => e.session === s.id);
export const stopsOf = (events: readonly Ev[], s: { id: string }): Ev[] => events.filter((e) => e.kind === 'agent.stop' && e.session === s.id && e.data.child === undefined);
/** An ask's options, as raised. */
export const optionsOf = (ask: Ev): { id: string; label: string }[] => (ask.data.options ?? []) as { id: string; label: string }[];
/** The option of an ask whose id or label matches `re`. */
export const optionMatching = (ask: Ev, re: RegExp): { id: string; label: string } | undefined => optionsOf(ask).find((o) => re.test(`${o.id} ${o.label}`));

/** `inbox.read` (#24's RPC behind `deep inbox`): every ask the hub holds, each `{ask: 'ask:<id>', status, question, options: [ids]}`. */
export async function inboxRows(hub: Hub): Promise<Line[]> {
  return ((await control(hub, 'inbox.read', {})).asks ?? []) as Line[];
}
/** Needs you: the rows still open. */
export const needsYou = async (hub: Hub): Promise<Line[]> => (await inboxRows(hub)).filter((r) => r.status !== 'closed');
/** `deep inbox`, as you run it. */
export const deepInbox = (w: World): Promise<Ran> => run(NODE, [CLI, 'inbox'], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 60_000 });
/** The question card's document for an ask, over the socket (README, Surfaces the implementer must provide). */
export const cardOf = (hub: Hub, ask: Ev): Promise<Line> => control(hub, 'ask.card', { ask: `ask:${ask.id}` });
/** Your answer on the trusted path: `deep inbox answer <ask> <option>`, the OS confirming you (DEEP_HUB_TEST_CONFIRM). */
export async function answered(w: World, ask: Ev, option: string, who: string): Promise<void> {
  const r = await run(NODE, [CLI, 'inbox', 'answer', `ask:${ask.id}`, option], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 120_000 });
  if (r.code !== 0) throw Error(`BLOCKED: ${who} deep inbox answer ask:${ask.id} ${option} must be taken: ${shown(r)}`);
}

// ---- Each session's agent (fixtures/agent.mjs): one long-lived process per session, the parent of every deep-hook
// run of that session and of its `deep mcp`, as Claude Code (or Codex) is of its hook commands.
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
  static start(w: World, env: Record<string, string>): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, env), stdio: ['pipe', 'pipe', 'ignore'] });
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

/** What deep-hook's output tells the agent: exit 2 or a deny/block decision stops the call (or the stop); exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  if (r.code === 0 && (d === undefined || d === 'allow' || d === 'approve')) return 'allow';
  return 'other';
}
/** What a hook's reply says: a block's reason (stdout JSON, or stderr at exit 2), the chat's systemMessage, and any additionalContext; as one text to search. */
export function replyText(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  const reason = typeof out?.reason === 'string' ? out.reason : typeof out?.hookSpecificOutput?.permissionDecisionReason === 'string' ? out.hookSpecificOutput.permissionDecisionReason : r.code === 2 ? r.stderr : '';
  const message = typeof out?.systemMessage === 'string' ? out.systemMessage : '';
  const context = typeof out?.hookSpecificOutput?.additionalContext === 'string' ? out.hookSpecificOutput.additionalContext : '';
  return `${reason}\n${message}\n${context}`.trim();
}
/** Whether a stop was blocked: deep-hook kept the turn going. */
export const blocked = (r: Ran): boolean => decision(r) === 'deny';
/** Whether a text names a word, a tool's name or a commit's first seven hex digits, as a word of its own. */
export const namesWord = (text: string, word: string): boolean => new RegExp(`(^|[^0-9A-Za-z_-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9A-Za-z_-]|$)`).test(text);

let calls = 0;
let rpc = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** One AskUserQuestion question, in the tool's own input shape. */
export interface AskedQuestion { question: string; header: string; multiSelect: boolean; options: { label: string; description: string }[] }
export const asked = (question: string, header: string, labels: readonly string[]): AskedQuestion => ({ question, header, multiSelect: false, options: labels.map((label) => ({ label, description: `${label} for this requirement` })) });

/** A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  prompt: string | undefined;
  /** The hub the session's task was opened on (startOnItem), read at each stop for the load rule (README, Load). */
  hub: Hub | undefined;
  private parent: string | null = null;
  private turn = 0;
  private mcpReady = false;
  constructor(readonly w: World) {
    this.id = randomUUID();
    this.cwd = w.repo;
    this.transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    agents.set(this.id, Agent.start(w, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: w.repo }));
  }
  /** Appends one transcript entry, as Claude Code writes it. */
  entry(value: Line): void {
    const uuid = randomUUID();
    writeFileSync(this.transcript, `${JSON.stringify({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' })}\n`, { flag: 'a' });
    this.parent = uuid;
  }
  /** `deep-hook claude-code <event>`; a Stop's block reason is then written as the user entry "Stop hook feedback", as Claude Code writes it. */
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
    unreached(event, ran);
    if (event === 'Stop' && decision(ran) === 'deny') this.entry({ type: 'user', ...(this.prompt ? { promptId: this.prompt } : {}), message: { role: 'user', content: `Stop hook feedback:\n${replyText(ran)}` } });
    return ran;
  }
  async start(): Promise<void> {
    this.prompt = undefined;
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
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
  /** One tool call: the assistant's tool_use entry and PreToolUse; when allowed, `effect`, its tool_result entry and PostToolUse. */
  async call(tool_name: string, tool_input: Line, o: { response?: Line; effect?: (input: Line) => Line | void | Promise<Line | void> } = {}): Promise<{ id: string; allowed: boolean; before: Ran; input: Line; after?: Ran }> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
    if (decision(before) !== 'allow') return { id, allowed: false, before, input: tool_input };
    const updated = parseObject(before.stdout.trim())?.hookSpecificOutput?.updatedInput;
    const input = updated && typeof updated === 'object' ? (updated as Line) : tool_input;
    const effected = await o.effect?.(input);
    const response = (effected ?? o.response ?? { stdout: '', stderr: '', interrupted: false, isImage: false }) as Line;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    const after = await this.hook('PostToolUse', { tool_name, tool_input: input, tool_use_id: id, tool_response: response, duration_ms: 40 });
    return { id, allowed: true, before, input, after };
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
  /** One round's work: the `note` line of src/auth.js goes up by one, so the snapshot changes. */
  async bump(): Promise<void> {
    const n = Number(/note: (\d+),/.exec(readFileSync(join(this.cwd, 'src/auth.js'), 'utf8'))?.[1] ?? NaN);
    must(Number.isInteger(n), 'BLOCKED: src/auth.js keeps its note line');
    await this.edit('src/auth.js', `note: ${n},`, `note: ${n + 1},`);
  }
  /** The agent's `git commit` of everything it changed, run for real. Returns the commit. */
  async commit(message: string): Promise<string> {
    const r = await this.call('Bash', { command: `git add -A && git commit -m "${message}"`, description: 'Commit' }, {
      effect: () => { git(this.w.tmp, this.cwd, ['add', '-A']); return { stdout: git(this.w.tmp, this.cwd, ['commit', '-q', '-m', message]), stderr: '', interrupted: false, isImage: false }; },
    });
    if (!r.allowed) throw Error(`BLOCKED: the agent's commit "${message}" must be allowed: ${shown(r.before)}`);
    return git(this.w.tmp, this.cwd, ['rev-parse', 'HEAD']);
  }
  /** The assistant's words, with no hook. */
  says(words: string): void {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
  }
  /** The agent's last words of the turn, then Stop; a stop the hold let through early under load is INCONCLUSIVE (README, Load). */
  async stop(words = 'Done.'): Promise<Ran> {
    this.says(words);
    const since = this.hub ? await lastPos(this.hub) : 0;
    const ran = await this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
    if (this.hub) await heldOut(this.hub, ran, since);
    return ran;
  }
  /** The agent's last words and Stop, with DeepBuild's waiter started beside it, as Claude Code starts its async Stop entry. */
  async stopWaiting(words: string, waitMs: number): Promise<{ stop: Ran; waiter: Promise<Ran> }> {
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: 'Stop', stop_hook_active: false, permission_mode: 'default' };
    const waiter = agents.get(this.id)!.run(['claude-code', 'waiter'], this.cwd, JSON.stringify(body), waitMs);
    const stop = await this.stop(words);
    return { stop, waiter };
  }
  /** The agent's deep_ask, as Claude Code calls an MCP tool, through this session's own `deep mcp`. Returns the tool's value and when it returned. */
  async deepAsk(args: Line): Promise<{ allowed: boolean; before: Ran; value: Line | undefined; ms: number }> {
    const agent = agents.get(this.id)!;
    if (!this.mcpReady) {
      const init = await agent.mcp(this.cwd, { jsonrpc: '2.0', id: `init#${++rpc}`, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-84', version: '0' } } }, 30_000);
      if (!init?.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
      await agent.mcp(this.cwd, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, 5_000);
      this.mcpReady = true;
    }
    let value: Line | undefined;
    let ms = 0;
    const r = await this.call('mcp__deep__deep_ask', args, {
      effect: async () => {
        const t0 = performance.now();
        const reply = await agent.mcp(this.cwd, { jsonrpc: '2.0', id: `ask#${++rpc}`, method: 'tools/call', params: { name: 'deep_ask', arguments: args } }, 120_000);
        ms = performance.now() - t0;
        const result = (reply?.result ?? {}) as Line;
        const text = Array.isArray(result.content) ? result.content.find((c: Line) => c?.type === 'text')?.text : undefined;
        value = (result.structuredContent ?? (typeof text === 'string' ? parseObject(text) ?? { text } : undefined) ?? reply?.error) as Line | undefined;
        return result;
      },
    });
    return { allowed: r.allowed, before: r.before, value, ms };
  }
}

/** The load rule (README, Load): a hook deep-hook couldn't hand to the hub within its budget is INCONCLUSIVE. */
function unreached(event: string, ran: Ran): void {
  if (/spooled \S+, but its sync didn't finish/.test(ran.stderr)) {
    throw new Inconclusive(`deep-hook couldn't hand ${event} to the hub within its budget (${ran.stderr.trim()}), ${loadReading()}`);
  }
}
/** The load rule (README, Load): a stop let through before a fast-lane run of a claim made at it ended, with the load past the core count, is INCONCLUSIVE. */
async function heldOut(hub: Hub, stop: Ran, since: number): Promise<void> {
  if (blocked(stop) || !loaded()) return;
  const events = await allEvents(hub);
  const late = runsFor(events, handles(claimsIn(events, since))).filter((r) => r.started.data.lane === 'fast' && (!r.finished || r.finished.ts > stop.ended));
  if (late.length) throw new Inconclusive(`the stop was let through ${(stop.ms / 1000).toFixed(1)} s after it, before ${late.length} of its fast-lane checks ended (${late.map((r) => String(r.started.data.check)).join(', ')}), ${loadReading()}`);
}

/** One Codex `request_user_input` question, in the tool's own input shape. */
export interface CardQuestion { id: string; header: string; question: string; options: { label: string; description: string }[] }
export const cardQuestion = (id: string, header: string, question: string, labels: readonly string[]): CardQuestion => ({ id, header, question, options: labels.map((label) => ({ label, description: `${label} for this step` })) });

/**
 * A Codex session: its rollout under `<home>/.codex/sessions`, its own Codex process, and its hooks fired through
 * `deep-hook codex <event>`, with payloads and rollout lines shaped like the corpus's Codex sessions. Copied from
 * tests/acceptance/82/helpers.ts, with `card`, the `request_user_input` call the facts name.
 */
export class CodexSession {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  turn: string | undefined;
  private ordinal = 0;
  constructor(readonly w: World) {
    this.id = `01a1${tag(2)}-${tag(2)}-7${tag(2).slice(1)}-a${tag(2).slice(1)}-${tag(6)}`;
    this.cwd = w.repo;
    this.transcript = join(w.home, '.codex/sessions/2026/11/03', `rollout-2026-11-03T09-00-00-${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    this.line('session_meta', { session_id: this.id, id: this.id, timestamp: new Date().toISOString(), cwd: this.cwd, originator: 'codex_cli_rs', cli_version: CODEX_COVERED, source: 'cli', model_provider: 'openai' });
    agents.set(this.id, Agent.start(w, {}));
  }
  private line(type: string, payload: Line): void {
    writeFileSync(this.transcript, `${JSON.stringify({ timestamp: new Date().toISOString(), ordinal: this.ordinal++, type, payload })}\n`, { flag: 'a' });
  }
  async hook(event: string, fields: Line = {}): Promise<Ran> {
    const body: Line = { session_id: this.id, ...(this.turn && event !== 'SessionStart' ? { turn_id: this.turn } : {}), transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default', ...fields };
    const ran = await agents.get(this.id)!.run(['codex', event], this.cwd, JSON.stringify(body), 150_000);
    unreached(event, ran);
    return ran;
  }
  async start(): Promise<void> {
    const r = await this.hook('SessionStart', { source: 'startup' });
    if (r.code !== 0) throw Error(`BLOCKED: Codex's SessionStart hook must end with exit 0: ${shown(r)}`);
  }
  /** A prompt you typed: a turn in the rollout, then UserPromptSubmit with its text. */
  async prompt(text: string): Promise<Ran> {
    const turn = `01a1${tag(2)}-${tag(2)}-7${tag(2).slice(1)}-8${tag(2).slice(1)}-${tag(6)}`;
    this.turn = turn;
    this.line('event_msg', { type: 'task_started', turn_attribution: { turn_id: turn, turn_trigger: 'user', parent_turn_id: null, initiating_agent_path: null, root_turn_id: turn }, turn_id: turn, root_turn_id: turn, model_context_window: 258400 });
    this.line('turn_context', { turn_id: turn, root_turn_id: turn, cwd: this.cwd, approval_policy: 'on-request', model: 'gpt-reserve' });
    this.line('response_item', { type: 'message', id: `msg_${tag(8)}`, role: 'user', content: [{ type: 'input_text', text }] });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: Codex's UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A shell call of the current turn: PreToolUse, its output in the rollout, PostToolUse. Returns what PostToolUse told the agent. */
  async shell(command: string, output = 'ok'): Promise<string> {
    const id = `call_${tag(12)}`;
    const before = await this.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id });
    if (decision(before) !== 'allow') throw Error(`BLOCKED: Codex's call \`${command}\` must be allowed: ${shown(before)}`);
    this.line('response_item', { type: 'function_call_output', call_id: id, output });
    return replyText(await this.hook('PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, tool_response: { stdout: output, stderr: '', exit_code: 0 } }));
  }
  /** An apply_patch call that updates `file` from `from` to `to`, and the change made, as the corpus's patches session has it. */
  async patch(file: string, from: string, to: string): Promise<void> {
    const id = `call_${tag(12)}`;
    const command = `*** Begin Patch\n*** Update File: ${join(this.cwd, file)}\n@@\n-${from}\n+${to}\n*** End Patch`;
    const before = await this.hook('PreToolUse', { tool_name: 'apply_patch', tool_input: { command }, tool_use_id: id });
    if (decision(before) !== 'allow') throw Error(`BLOCKED: Codex's apply_patch of ${file} must be allowed: ${shown(before)}`);
    const path = join(this.cwd, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
    const out = `Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nM ${path}\n`;
    this.line('response_item', { type: 'function_call_output', call_id: id, output: out });
    await this.hook('PostToolUse', { tool_name: 'apply_patch', tool_input: { command }, tool_use_id: id, tool_response: out });
  }
  /** One `request_user_input` card, at PreToolUse. Returns deep-hook's reply: a block reason is the card's answer. */
  card(questions: readonly CardQuestion[]): Promise<Ran> {
    return this.hook('PreToolUse', { tool_name: 'request_user_input', tool_input: { questions }, tool_use_id: `call_${tag(12)}` });
  }
  async stop(words = 'Done.'): Promise<Ran> {
    this.line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: words }] });
    this.line('event_msg', { type: 'task_complete', turn_id: this.turn, last_agent_message: words });
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
}

/** A session's typed `Fix <link>`, and the item's handed definition locked. Returns the task. */
export async function startOnItem(hub: Hub, s: Session, n: number, who: string): Promise<string> {
  s.hub = hub;
  await s.start();
  const text = `Fix ${WORK_LINK(n)}`;
  await s.typed(text);
  await s.read('src/auth.js');
  return locked(hub, s, text, n, who);
}
/** The same for a Codex session. */
export async function startCodexOnItem(hub: Hub, s: CodexSession, n: number, who: string): Promise<string> {
  await s.start();
  const text = `Fix ${WORK_LINK(n)}`;
  await s.prompt(text);
  await s.shell('cat src/auth.js', 'module.exports = {};');
  return locked(hub, s, text, n, who);
}
async function locked(hub: Hub, s: { id: string }, text: string, n: number, who: string): Promise<string> {
  const events = await settle(hub, (all) => { const ref = itemTask(all, s, text); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
  const ref = itemTask(events, s, text);
  if ((ref === undefined || !lockedFor(events, ref).length) && loaded()) throw new Inconclusive(`${who} the session started from ${WORK_LINK(n)} opened no task with its definition locked within 60 s, ${loadReading()}`);
  must(ref !== undefined && lockedFor(events, ref).length > 0, `BLOCKED: ${who} the session started from ${WORK_LINK(n)} must open one task with its handed definition locked: ${ref ?? 'no task'}; ${listed(events.filter((e) => /^(task|definition)\./.test(e.kind)))}`);
  return ref!;
}

/** Fails unless the session's task went back to the agent: its stop kept going, naming `tool`, and nothing reached you. */
export async function wentBack(hub: Hub, s: { id: string }, stop: Ran, since: number, tool: string, who: string): Promise<void> {
  must(blocked(stop), `${who} the task must go back to the agent: the Stop hook must keep the turn going; it let the stop through: ${shown(stop)}`);
  must(namesWord(replyText(stop), tool), `${who} the reply must name the tool to use, ${tool}: ${replyText(stop).slice(0, 500)}`);
  const events = await settle(hub, () => true);
  must(asksOf(events, s, since).length === 0, `${who} nothing reaches you when the agent could take the step: ${listed(asksOf(events, s, since))}`);
}
/** The task the session's stop raised, once it reaches Needs you, or a failure saying what stands instead. */
export async function reachedYou(hub: Hub, s: { id: string }, since: number, who: string): Promise<Ev> {
  const events = await settle(hub, (all) => asksOf(all, s, since).some((a) => a.data.kind === 'unblock'));
  const task = asksOf(events, s, since).find((a) => a.data.kind === 'unblock');
  must(task !== undefined, `${who} the stop must raise a task only you can do: ${listed(asksOf(events, s, since))}`);
  const row = (await needsYou(hub)).find((r) => r.ask === `ask:${task.id}`);
  must(row !== undefined, `${who} the task must be in Needs you: ask:${task.id} isn't an open row of inbox.read`);
  return task;
}

/** A link or a button a text could carry for a URL: a terminal hyperlink, a Markdown link, HTML, or an angle-bracket autolink. */
export const linkInText = (text: string): string | undefined => /\u001b\]8;|\]\(\s*https?:|<a[\s>]|href\s*=|<https?:/i.exec(text)?.[0];
/**
 * Every place a document holds the URL's host as something to press or open: a field named as a link, an action or a
 * button, or an option. `path` names the place, for the failure.
 */
export function linkFields(value: unknown, host: string, path = '$'): string[] {
  if (typeof value === 'string') return linkInText(value) ? [`${path}: ${value.slice(0, 200)}`] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => linkFields(v, host, `${path}[${i}]`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, v]) => {
    const pressed = /^(url|uri|href|link|links|open|opens|open_url|action|actions|button|buttons|target)$/i.test(key) || key === 'options';
    return [...(pressed && JSON.stringify(v ?? null).includes(host) ? [`${path}.${key}: ${JSON.stringify(v).slice(0, 200)}`] : []), ...linkFields(v, host, `${path}.${key}`)];
  });
}
