// Shared test-side tools for #1523's acceptance tests (README): a temp world (a home with the shipped default guards
// and your ask settings, a git repository on the branch `b` with a `.deepbuild/done.yaml` spec and a drafted check),
// the hub as a process with its test settings, the record and an ask's card read back through the hub's socket
// (`events.read`, `ask.card`), Claude Code sessions driven through the real deep-hook binary with payloads and
// transcripts shaped like the corpus's, deep-hook's check mode and its spool, and the judgements the criteria read.
//
// Adapted from tests/acceptance/84/guard/helpers.ts (all of it but the MCP server), tests/acceptance/321/helpers.ts
// (the planted sorter and its proceed) and tests/acceptance/1202/helpers.ts (reading the spool), same repo, same
// license. This suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for
// DeepBuild: every decision comes from the real hub and deep-hook. The test plays the agent.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
export const AGENT = fileURLToPath(new URL('./fixtures/agent.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
/** The model the fake reviewer answers as: another model than the session's (claude-haiku-5-5), one the facts name. */
export const REVIEWER_MODEL = 'claude-sonnet-5-5';

/** Each criterion's ID: `#1523.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. Numbered in the issue's order. */
export const AC1 = 'AC1 #1523.b593135b';
export const AC2 = 'AC2 #1523.6933063f';
export const AC3 = 'AC3 #1523.2436253f';
export const AC4 = 'AC4 #1523.fca551f5';
export const AC5 = 'AC5 #1523.d4c1de27';
export const AC6 = 'AC6 #1523.ea4ec67a';
export const AC7 = 'AC7 #1523.bc21ee43';
export const AC8 = 'AC8 #1523.da8f9b01';
/** The Scope line with no checkbox of its own: each new form lands with a planted call and a twin in the install check. */
export const INSTALL = 'Scope (install check)';

/** The calls and prompts of #84's flow that the merge criteria start from. */
export const PUSH = 'git push origin HEAD';
export const PR_CREATE = 'gh pr create --fill';
/** A prompt you type that names no push, PR or merge. */
export const UNASKED = 'Fix the login bug in src/auth.js.';
export const CREATE_PR = 'create PR';
export const MERGE_ASK = 'merge PR 12';
/** The pull request's link, as gh prints it when `gh pr create` goes through. */
export const PR_URL = 'https://github.com/acme/shop/pull/12';
/** AC6's branch `b`: the branch the PR's thread works on, so `--auto` is armed on it. */
export const PR_BRANCH = 'b';

// ---- The calls the criteria name (README, The calls).
/** A whole GraphQL merge, as an agent writes it: `mergePullRequest` on a pull request's node ID, with `expectedHeadOid` when `head` is given. */
export const graphqlMerge = (head?: string): string =>
  `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "PR_kwDOAcme12"${head ? `, expectedHeadOid: "${head}"` : ''}}) { pullRequest { number merged } } }'`;
/** The same, arming auto-merge. */
export const graphqlAutoMerge = `gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {pullRequestId: "PR_kwDOAcme12", mergeMethod: SQUASH}) { pullRequest { number } } }'`;
export const UNREADABLE_JJ = '"$(printf jj)" git push';
/** The effect classes the issue's Scope gives each new form. */
export type Effect = 'push' | 'pr' | 'merge' | 'send';
/** AC1's calls, each with the classes its Scope line gives it. */
export const HELD: [string, Effect[]][] = [
  ['jj git push --bookmark main', ['push']],
  ['gt submit --stack', ['push', 'pr']],
  ['git town ship', ['push', 'merge']],
  ['sl push', ['push']],
  ['glab mr merge 3', ['merge']],
  [graphqlMerge(), ['merge']],
];
/** AC3's calls: read-only forms of the same tools, and a GET of the merge endpoint. */
export const FREE = ['jj log', 'jj git fetch', 'gt log', 'gh api repos/acme/shop/pulls/3', 'gh api repos/acme/shop/pulls/3/merge'];
export const ISSUE_CREATE = 'gh issue create -t x';

/** The stop hold every hub here runs with (DEEP_HUB_TEST_STOP_HOLD_MS). */
export const HOLD_MS = 30_000;

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
export const COVERED = (() => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
/** Whether other work loads the machine past its core count. */
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
/**
 * Runs `judge` on each item in turn and fails once, naming every item that failed, so one run names each call. A
 * BLOCKED setup or an INCONCLUSIVE reading stops it at once.
 */
export async function each<T>(items: readonly T[], judge: (item: T) => Promise<unknown>): Promise<void> {
  const failed: string[] = [];
  for (const item of items) {
    try {
      await judge(item);
    } catch (error) {
      if (error instanceof Inconclusive) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('BLOCKED:')) throw error;
      failed.push(message);
    }
  }
  must(!failed.length, failed.join(' | '));
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1523-'));
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

/** Variables that make an agent bill an API account, and forge tokens; a child never inherits this process's. */
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

// ---- The definitions the kernel is handed and the test work source (README, The world).
interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code'; near_misses: string[] }
interface Draft { issue: string; requirements: Requirement[]; deliverables: string[]; budget: null }
interface Reading { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: 'owner' }[]; updated: string }

/** The repo's spec, `.deepbuild/done.yaml`: one claim, done, with the unit check, a node:test run the hermetic runner counts. */
const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
/** The unit test: checkToken rejects a token whose exp has passed. It fails at the base commit and passes once FIX is made. */
const UNIT_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken rejects an expired token', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\n";
/** `note` is the line the second head's edit bumps, so its snapshot changes the checks' inputs and they run again. */
const AUTH_JS = "module.exports = {\n  checkToken: (token) => token.exp > 0,\n  rejectsExpired: false,\n  note: 0,\n};\n";
/** The edit that makes the spec's unit test pass. */
export const FIX = { file: 'src/auth.js', from: 'token.exp > 0', to: 'token.exp > Date.now() / 1000' } as const;
/** The edit that makes R1's drafted check pass. */
export const FLAG = { file: 'src/auth.js', from: 'rejectsExpired: false', to: 'rejectsExpired: true' } as const;
/** The edit that makes a new head. */
export const BUMP = { file: 'src/auth.js', from: 'note: 0,', to: 'note: 1,' } as const;
/** R1's drafted check: a `#!/bin/sh` file that runs its node:test file, so the runner counts the tests it ran. */
const CHECK = {
  file: '.deepbuild/checks/expired-token.sh', test: '.deepbuild/checks/expired-token.test.cjs', assertion: '.deepbuild/checks/expired-token.test.cjs:4',
  bytes: '#!/bin/sh\n# Drafted check: an expired token is rejected with 401\nnode --test .deepbuild/checks/expired-token.test.cjs\n',
  testBytes: "const test = require('node:test');\nconst assert = require('node:assert');\ntest('an expired token is rejected with 401', () => {\n  assert.strictEqual(require('../../src/auth.js').rejectsExpired, true);\n});\n",
};
/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
const ACCOUNT = 'acct-dh1523-0001';

/** The one work item the delivered thread starts from: R1 is judged by CHECK, which fails until FLAG. */
const ITEM = 61;
const WORK_LINK = `https://work.test/acme/shop/issues/${ITEM}`;
const SOURCE = `item-${ITEM}`;
const CRITERION = 'An expired token is rejected with 401';
const READING: Reading = {
  source_id: SOURCE, link: WORK_LINK, title: 'Expired tokens are accepted', body: `Expired tokens are accepted.\n\n- ${CRITERION}`, criteria: [CRITERION],
  authors: [{ handle: 'maya', role: 'owner' }], updated: '2026-10-20T09:00:00Z',
};
const DRAFT: Draft = {
  issue: SOURCE,
  requirements: [{ id: 'R1', text: CRITERION, source_line: `${SOURCE}#L3`, refuted_by: 'a run where an expired token is accepted', check: CHECK.file, on_base: 'fails', asserts: [CHECK.assertion], depth: 'unit', oracle: 'code', near_misses: [] }],
  deliverables: ['src/auth.js'], budget: null,
};

export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; drafts: string; work: string; base: string; plant?: string | undefined }
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the first
 * rules.json and config.json with your settings; `<home>/.claude.json` names the account and marks the repo
 * trusted. `<tmp>/repo` is a git repository with one commit on main (`base`), checked out on the branch PR_BRANCH. `<tmp>/confirm` says `confirmed` (DEEP_HUB_TEST_CONFIRM). `<tmp>/drafts.json` is
 * DEEP_HUB_TEST_DRAFTS, `<tmp>/work.json` DEEP_HUB_TEST_WORK.
 *
 * The second model (README, The second model; blind redraft for #1537): since #1537 every claim whose session has a
 * PR gets a review check run by a second model, so the delivered thread (`delivered`) needs one or its PR stop is
 * sent back with the review unmet. As tests/acceptance/1537 does, the fake reviewer (`fixtures/fake-reviewer.pl`,
 * answering a clean review: no findings) is installed as `claude` in `<tmp>/bin`, first on the runner's login PATH
 * (`runner.login_path` in config.json); `<home>/.claude/.credentials.json` is a made-up Claude Code sign-in, so no
 * job reads a real keychain; the wiki's review rubric is `<root>/wiki/review-rubric.md`.
 */
export function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  const bin = join(tmp, 'bin');
  mkdirSync(bin, { recursive: true });
  const reviewer = join(bin, 'claude');
  writeFileSync(reviewer, fixture('fake-reviewer.pl').replace('__CONFIG__', Buffer.from(JSON.stringify({ version: COVERED, model: REVIEWER_MODEL, findings: [] }), 'utf8').toString('base64')), { mode: 0o755 });
  chmodSync(reviewer, 0o755);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, runner: { login_path: `${bin}:/usr/bin:/bin` }, plan: { reserve_pct: 10 } }, null, 2)}\n`);
  writeFileSync(join(home, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-dh1523FAKE${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-dh1523FAKE${'y'.repeat(40)}`, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
  mkdirSync(join(root, 'wiki'), { recursive: true });
  writeFileSync(join(root, 'wiki', 'review-rubric.md'), fixture('rubric.md'));
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  const files: Record<string, string> = {
    'src/auth.js': AUTH_JS, 'tests/unit.test.js': UNIT_TEST, '.deepbuild/done.yaml': SPEC, [CHECK.file]: CHECK.bytes, [CHECK.test]: CHECK.testBytes,
    'package.json': `${JSON.stringify({ name: 'shop', version: '1.0.0', scripts: { test: 'node --test tests/unit.test.js' } }, null, 2)}\n`,
  };
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), bytes, path.endsWith('.sh') ? { mode: 0o755 } : {});
  }
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  git(tmp, repo, ['add', '.']);
  git(tmp, repo, ['commit', '-q', '-m', 'base']);
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  git(tmp, repo, ['switch', '-q', '-c', PR_BRANCH]);
  const real = realpathSync(repo);
  const claudeJson: Line = { oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3, projects: { [real]: { allowedTools: [], hasTrustDialogAccepted: true } } };
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify(claudeJson, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [DRAFT] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [READING] }, null, 2)}\n`);
  return { tmp, home, root, repo: real, confirm, drafts, work, base };
}
export function git(tmp: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The hub as a process: `deep hub run`, HOME the world's.
export interface Hub { pid: number; socket: string; home: string; root: string; child: ChildProcess; exit: Promise<void>; stderr(): string }
/**
 * Starts `deep hub run` with its test settings, DEEP_HUB_PLANT when given (README, Wrong programs; the sessions started
 * after it get the same plant, so a plant may sit on deep-hook's side or the hub's) and DEEP_HUB_TEST_SORTER when given
 * (#321's planted sorter, README: A proceed). A plant the hub doesn't list is BLOCKED: the implementer adds it to
 * packages/hub/src/plant.ts.
 */
export async function startHub(w: World, o: { plant?: string | undefined; sorter?: string | undefined } = {}): Promise<Hub> {
  w.plant = o.plant;
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_WORK: w.work,
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_SORTER: o.sorter,
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
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, stderr: () => err };
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
/** One event as `events.read` returns it. */
export interface Ev { id: string; kind: string; log_pos: number; ts: number; subject?: string; session?: string; data: Line }
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
/** Reads the log until `done` holds, or `timeoutMs` passes; resolves with the last read either way. */
export async function settle(hub: Hub, done: (events: Ev[]) => boolean, timeoutMs = 30_000): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await allEvents(hub);
    if (done(events) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
/** Events in one line each, for failure messages. */
export const listed = (events: readonly Ev[]): string => events.map((e) => `${e.kind} ${e.id} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 400)}`).join('; ') || 'none';
const asksNaming = (events: readonly Ev[], since: number, name: string): Ev[] => events.filter((e) => e.kind === 'ask.created' && e.log_pos > since && String(e.data?.question ?? '').includes(name));

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session, as Claude Code is of its hook commands, so `deep inbox answer`, run by this test
// process, is outside every session's process tree, as your terminal is.
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
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: w.repo, DEEP_HUB_PLANT: w.plant }), stdio: ['pipe', 'pipe', 'ignore'] });
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

/** What deep-hook's output tells the agent: exit 2 or a deny/block decision stops the call (or the stop); exit 0 lets it go. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || d === 'deny' || d === 'block') return 'deny';
  if (r.code === 0 && (d === undefined || d === 'allow' || d === 'approve')) return 'allow';
  return 'other';
}
/** Whether deep-hook couldn't hand this hook to the hub within its budget, so its reply says nothing of what the hub decides. */
export const spoiled = (r: Ran): boolean => /spooled \S+, but its sync didn't finish|could not spool \S+ within/.test(r.stderr);
/** What a denial says to the agent: a block's reason (stdout JSON, or stderr at exit 2). */
export function replyText(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  const reason: unknown = out?.reason ?? out?.hookSpecificOutput?.permissionDecisionReason;
  return typeof reason === 'string' ? reason : r.stderr;
}

export interface Call { tool_name: string; tool_input: Line }
export const bash = (command: string): Call => ({ tool_name: 'Bash', tool_input: { command, description: command.slice(0, 40) } });
/** A call's words, as an ask and a failure message name it: a shell call's command, or an MCP call's tool. */
export const labelOf = (c: Call): string => (c.tool_name === 'Bash' ? String(c.tool_input.command) : c.tool_name.split('__').slice(2).join('__'));
export interface Called { id: string; allowed: boolean; before: Ran }
let calls = 0;
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** A Claude Code session on the world's repo: its transcript, its own Claude Code process, and its hooks fired through deep-hook. */
export class Session {
  readonly id = randomUUID();
  readonly cwd: string;
  readonly transcript: string;
  prompt: string | undefined;
  hub: Hub | undefined;
  private parent: string | null = null;
  private turn = 0;
  constructor(readonly w: World) {
    this.cwd = w.repo;
    this.transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    agents.set(this.id, Agent.start(w));
  }
  /** Appends one transcript entry, as Claude Code writes it. */
  private entry(value: Line): void {
    const uuid = randomUUID();
    writeFileSync(this.transcript, `${JSON.stringify({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: PR_BRANCH })}\n`, { flag: 'a' });
    this.parent = uuid;
  }
  /** `deep-hook claude-code <event>`, the hook's JSON on stdin, as a child of the session's own Claude Code process. */
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
    // The load rule (README, Load). `hub` is unset once a test stops it; a PreToolUse is read by the judgement that needs its decision.
    if (this.hub && event !== 'PreToolUse' && spoiled(ran)) throw new Inconclusive(`deep-hook couldn't hand ${event} to the hub within its budget (${ran.stderr.trim()}), ${loadReading()}`);
    if (event === 'Stop' && decision(ran) === 'deny') this.entry({ type: 'user', ...(this.prompt ? { promptId: this.prompt } : {}), message: { role: 'user', content: `Stop hook feedback:\n${replyText(ran)}` } });
    return ran;
  }
  async start(): Promise<void> {
    this.prompt = undefined;
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
  }
  private async submit(text: string, entry: Line): Promise<void> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: entry.content ?? text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, ...entry, content: undefined });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
  }
  /** A prompt you typed: its transcript entry (turnOrigin human) and its UserPromptSubmit. */
  typed(text: string): Promise<void> {
    return this.submit(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  }
  /** A background subagent's report (origin.handback), as the corpus's 2.1.308 subagent session has it. */
  handback(text: string, agentId = 'a2711031fe8c87e48'): Promise<void> {
    return this.submit(text, { content: `Another Claude session sent a message:\n${text}`, isMeta: true, promptSource: 'system', turnOrigin: 'peer', origin: { kind: 'peer', from: agentId, senderTaskId: agentId, name: 'general-purpose', body: text, handback: true, handbackReportText: text } });
  }
  /**
   * One tool call: the assistant's tool_use entry and PreToolUse; when allowed, `effect` (what the call does, which may
   * give the response), its tool_result entry and PostToolUse. A denied call never runs.
   */
  async call(call: Call, o: { response?: Line; effect?: () => Line | void } = {}): Promise<Called> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: call.tool_name, input: call.tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { ...call, tool_use_id: id });
    if (decision(before) !== 'allow') return { id, allowed: false, before };
    const response = (o.effect?.() ?? o.response ?? { stdout: '', stderr: '', interrupted: false, isImage: false }) as Line;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', { ...call, tool_use_id: id, tool_response: response, duration_ms: 40 });
    return { id, allowed: true, before };
  }
  /** The agent reads a file of the repository (Read). */
  async read(file: string): Promise<void> {
    const path = join(this.cwd, file);
    const content = readFileSync(path, 'utf8');
    const r = await this.call({ tool_name: 'Read', tool_input: { file_path: path } }, { response: { type: 'text', file: { filePath: path, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } } });
    if (!r.allowed) throw Error(`BLOCKED: the Read of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent edits a file of the repository (Edit), and the edit is made; a denied edit is BLOCKED. */
  async edit({ file, from, to }: { file: string; from: string; to: string }): Promise<void> {
    const path = join(this.cwd, file);
    const r = await this.call({ tool_name: 'Edit', tool_input: { file_path: path, old_string: from, new_string: to, replace_all: false } }, {
      response: { filePath: path, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false },
      effect: () => { writeFileSync(path, readFileSync(path, 'utf8').replace(from, to)); },
    });
    if (!r.allowed) throw Error(`BLOCKED: the Edit of ${file} must be allowed: ${shown(r.before)}`);
  }
  /** The agent commits every change, the commit made in the repository; a denied commit is BLOCKED. Returns the new head. */
  async commit(message: string): Promise<string> {
    const r = await this.call(bash(`git add -A && git commit -m "${message}"`), { effect: () => { git(this.w.tmp, this.cwd, ['add', '-A']); git(this.w.tmp, this.cwd, ['commit', '-q', '-m', message]); } });
    if (!r.allowed) throw Error(`BLOCKED: the commit must be allowed: ${shown(r.before)}`);
    return git(this.w.tmp, this.cwd, ['rev-parse', 'HEAD']);
  }
  /** The agent's last words of the turn, then Stop; a stop the hold let through before its checks ended under load is INCONCLUSIVE. */
  async stop(words: string): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn'));
    const since = this.hub ? await lastPos(this.hub) : 0;
    const ran = await this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
    if (this.hub && loaded() && decision(ran) !== 'deny') {
      const events = await allEvents(this.hub);
      const claims = new Set(events.filter((e) => e.kind === 'claim.made' && e.log_pos > since).map((c) => `claim:${c.id}`));
      const late = events.filter((e) => e.kind === 'run.started' && claims.has(String(e.data.claim)) && e.data.lane === 'fast').filter((r) => !events.some((f) => f.kind === 'run.finished' && f.data.run === r.data.run && f.ts <= ran.ended));
      if (late.length) throw new Inconclusive(`the stop was let through ${(ran.ms / 1000).toFixed(1)} s after it, before ${late.length} of its fast-lane checks ended, ${loadReading()}`);
    }
    return ran;
  }
}

// ---- The rules: the shipped default entries (README, Surfaces the implementer must provide), and deep-hook's check mode on them.
export interface Guard { match: string; scope: string; mode: string; reason: string; next_step: string; fail_closed: boolean }
export type Placed = Call & { cwd?: string };
export interface Proof { planted: Placed; twin: Placed }
export const shipped = (): { entries: Record<string, Guard>; proofs: Record<string, unknown> } => JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as { entries: Record<string, Guard>; proofs: Record<string, unknown> };
/** The `match` of a shipped entry, by name. */
export const matchOf = (rule: string): string => String(shipped().entries[rule]?.match ?? '');
/**
 * An entry's planted calls and twins as default-rules.json ships them (README, Surfaces the implementer must provide): `{planted, twin}`,
 * as #304 fixed it, or a list of them, so one entry can carry one per form it reads.
 */
export function proofsOf(rule: string): Proof[] {
  const p: unknown = shipped().proofs[rule];
  const list: unknown[] = Array.isArray(p) ? p : p ? [p] : [];
  return list.filter((x): x is Proof => typeof x === 'object' && x !== null && 'planted' in x && 'twin' in x);
}
/** A guard@1 entry whose `match` is `match`, for check mode, which reads only an entry's `match`. */
export const entry = (match: string): Guard => ({ match, scope: 'all_repos', mode: 'block', reason: `Acceptance test of ${match}.`, next_step: 'None.', fail_closed: false });
/** A shipped proof's call with its placeholders filled for this world. */
export function filled(w: World, c: Placed): Placed {
  const fill = (v: unknown): unknown => typeof v === 'string'
    ? v.replaceAll('{repo}', w.repo).replaceAll('{home}', w.home).replaceAll('{work}', join(w.tmp, 'work')).replaceAll('{worktree}', join(w.tmp, 'worktree')).replaceAll('{hub_pid}', '999999')
    : Array.isArray(v) ? v.map(fill) : typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v;
  return fill(c) as Placed;
}

// ---- deep-hook's spool: with the hub down, each hook's request saved as it would have gone to the hub (design: Hook
// protocol), with the entries deep-hook matched (`matched`) and the payload. After tests/acceptance/1202/helpers.ts.
export function spooled(w: World): Line[] {
  const dir = join(w.root, 'spool');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort().flatMap((n) => readFileSync(join(dir, n), 'utf8').split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; }));
}
/** The shipped entries a text names, by name, as a whole word. */
export function rulesIn(text: string): string[] {
  const names = Object.keys(shipped().entries);
  return names.filter((n) => new RegExp(`(?<![\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(text));
}
/** deep-hook's check mode: whether `entry` matches `call` (#304's `{"entry", "call"}` on stdin, `{"matched": bool}` on stdout). */
export async function matches(w: World, entry: Guard, call: Placed): Promise<boolean> {
  const r = await run(DEEP_HOOK, ['check'], { cwd: w.repo, env: childEnv(w.home), input: JSON.stringify({ entry, call: { cwd: w.repo, ...call } }), timeoutMs: 60_000 });
  const line = parseObject(r.stdout.trim());
  if (r.code !== 0 || typeof line?.matched !== 'boolean') throw Error(`BLOCKED: deep-hook's check mode must answer: ${shown(r)}`);
  return line.matched;
}

// ---- The judgements the criteria read.
/** Whether the hub never decided this call: deep-hook let it through for a late acknowledgement, spooled marked late. */
async function late(hub: Hub, id: string): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const before = (await allEvents(hub)).find((e) => e.kind === 'tool.before' && e.data?.call === id);
    if (before) return before.data.late === true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}
/** An allow the hub never decided is INCONCLUSIVE: deep-hook couldn't hand it over, or the acknowledgement came late. */
export async function expectDecided(hub: Hub, r: Called, label: string, who: string): Promise<void> {
  if (spoiled(r.before) || await late(hub, r.id)) throw new Inconclusive(`${who} \`${label}\` was let through before the hub decided it (${shown(r.before)}); read at ${loadReading()}`);
}
export interface Denied { label: string; text: string; rules: string[]; since: number }
/**
 * The agent makes `call`; it must not run, and its denial must name the rule it breaks: a shipped default entry, by
 * name, in block mode. An allow the hub never decided, or a denial of a gate that ran out of time, is INCONCLUSIVE.
 */
export async function expectDenied(hub: Hub, s: Session, call: Call, who: string): Promise<Denied> {
  const label = labelOf(call);
  const since = await lastPos(hub);
  const r = await s.call(call);
  if (r.allowed) {
    await expectDecided(hub, r, label, who);
    throw Error(`${who} \`${label}\` must be denied; deep-hook allowed it: ${shown(r.before)}`);
  }
  const text = replyText(r.before);
  if (/in time\. Run it again\./.test(text)) throw new Inconclusive(`${who} the gate ran out of time on \`${label}\` (${text.trim()}); read at ${loadReading()}`);
  const rules = rulesIn(text);
  must(rules.length > 0, `${who} the denial of \`${label}\` must name the rule it breaks, a default entry of crates/deep-hook/default-rules.json by its name: ${text.slice(0, 600)}`);
  const { entries } = shipped();
  must(rules.some((n) => entries[n]!.mode === 'block'), `${who} the rule that denies \`${label}\` must be a block entry, as the guard engine reads one; ${rules.map((n) => `${n} is ${entries[n]!.mode}`).join(', ')}`);
  return { label, text, rules, since };
}
/** The agent makes `call`; it runs, and no ask names it. */
export async function expectAllowed(hub: Hub, s: Session, call: Call, who: string, o: { response?: Line; effect?: () => Line | void } = {}): Promise<void> {
  const label = labelOf(call);
  const since = await lastPos(hub);
  const r = await s.call(call, o);
  must(r.allowed, `${who} \`${label}\` must go through; deep-hook ended ${decision(r.before)}: ${shown(r.before)}`);
  await sleep(1000);
  const asks = asksNaming(await allEvents(hub), since, label);
  must(!asks.length, `${who} \`${label}\` must go through with no ask: ${listed(asks)}`);
}
/** "An authority ask for it is filed": an ask raised since the denial whose question names the call, kind authority. */
export async function expectAuthorityAsk(hub: Hub, denied: Denied, who: string): Promise<Ev> {
  const events = await settle(hub, (all) => asksNaming(all, denied.since, denied.label).length > 0);
  const [ask] = asksNaming(events, denied.since, denied.label);
  must(ask !== undefined, `${who} the denial of \`${denied.label}\` must file an authority ask for it: 30 s after the denial no ask's question names it`);
  must(ask.data.kind === 'authority', `${who} the ask filed for \`${denied.label}\` must be an authority ask: ${listed([ask])}`);
  return ask;
}

// ---- The card (README, Surfaces the implementer must provide): the ask's question card, as `ask.card` gives it to the app and the CLI.
export const cardOf = (hub: Hub, ask: Ev): Promise<Line> => control(hub, 'ask.card', { ask: `ask:${ask.id}` });
/** How a card names each effect, in its own words: the call's words are taken out first, since `sl push` holds "push". */
const EFFECT_WORDS: Record<Effect, RegExp> = { push: /\bpush/i, pr: /\bpull requests?\b|\bPRs?\b/, merge: /\bmerg/i, send: /\bsend/i };
/** A card's own words: its question, its plan's steps and its options, each with every copy of the call's words taken out. */
export function cardWords(card: Line, label: string): string {
  const steps = ((card.plan?.steps ?? []) as Line[]).map((s) => String(s.does ?? ''));
  const options = ((card.options ?? []) as Line[]).map((o) => String(o.label ?? ''));
  return [String(card.question ?? ''), ...steps, ...options].map((t) => t.split(label).join(' ')).join('\n');
}
export const effectsNamed = (card: Line, label: string): Effect[] => (Object.keys(EFFECT_WORDS) as Effect[]).filter((e) => EFFECT_WORDS[e].test(cardWords(card, label)));
export interface Held { denied: Denied; ask: Ev; card: Line; effects: Effect[] }
/**
 * "Held, with the effect named on its card": the call is denied naming a block entry whose `match` is `effect:<one of
 * effects>`, an authority ask naming it is filed, and that ask's card names one of `effects` in its own words.
 */
export async function expectHeld(hub: Hub, s: Session, command: string, effects: Effect[], who: string): Promise<Held> {
  const denied = await expectDenied(hub, s, bash(command), who);
  const classed = denied.rules.filter((r) => effects.some((e) => matchOf(r) === `effect:${e}`));
  must(classed.length > 0, `${who} \`${command}\` must be held by a default entry of its effect (${effects.map((e) => `effect:${e}`).join(' or ')}); its denial names ${denied.rules.map((r) => `${r} (${matchOf(r)})`).join(', ')}: ${denied.text.slice(0, 600)}`);
  const ask = await expectAuthorityAsk(hub, denied, who);
  const card = await cardOf(hub, ask);
  const named = effectsNamed(card, command).filter((e) => effects.includes(e));
  must(named.length > 0, `${who} the card of ask:${ask.id}, holding \`${command}\`, must name its effect (${effects.join(' or ')}) in its own words: ${JSON.stringify({ question: card.question, plan: card.plan, options: card.options }).slice(0, 900)}`);
  return { denied, ask, card, effects: named };
}

// ---- A proceed (README, A proceed): #321's planted sorter answers a stop's question "proceed", by a rule of its own.
export function writeSorter(w: World, rule: string, proceed: string[]): string {
  const file = join(w.tmp, 'sorter.json');
  writeFileSync(file, `${JSON.stringify({ rule, proceed }, null, 2)}\n`);
  return file;
}
/** The agent ends its turn on `question`; the planted sorter answers it proceed, recorded with its rule, and the stop's reply sends the agent on. */
export async function expectProceed(hub: Hub, s: Session, question: string, rule: string, who: string): Promise<void> {
  const since = await lastPos(hub);
  const r = await s.stop(question);
  const events = await settle(hub, (all) => all.some((e) => e.log_pos > since && !e.kind.startsWith('ask.') && JSON.stringify(e.data ?? {}).includes(question) && JSON.stringify(e.data ?? {}).includes(rule)));
  must(events.some((e) => e.log_pos > since && !e.kind.startsWith('ask.') && JSON.stringify(e.data ?? {}).includes(question) && JSON.stringify(e.data ?? {}).includes(rule)), `BLOCKED: ${who} the planted sorter's proceed for "${question}" must be recorded with its rule ${rule}: 30 s after the stop, no event names both`);
  must(decision(r) === 'deny' && /proceed/i.test(`${r.stdout}\n${r.stderr}`), `BLOCKED: ${who} the stop's one reply must carry the proceed for "${question}" (a Stop block whose reason says proceed): ${shown(r)}; read at ${loadReading()}`);
}

/** A session's typed start: the shared thread for "a thread whose ask names no push, PR or merge". */
export async function unasked(hub: Hub, w: World): Promise<Session> {
  const s = new Session(w);
  s.hub = hub;
  await s.start();
  await s.typed(UNASKED);
  return s;
}
/** Waits for a PASS whose claim's commit is `commit`. No PASS is BLOCKED, or INCONCLUSIVE on a loaded machine. */
export async function expectPass(hub: Hub, commit: string, who: string): Promise<void> {
  const pass = (all: Ev[]) => all.some((v) => v.kind === 'verdict.made' && v.data.outcome === 'PASS' && all.some((c) => c.kind === 'claim.made' && `claim:${c.id}` === String(v.data.claim) && c.data.commit === commit));
  const events = await settle(hub, pass, 120_000);
  if (pass(events)) return;
  const seen = listed(events.filter((e) => /^(claim\.made|claim\.sent_back|verdict\.made)$/.test(e.kind)).slice(-6));
  if (loaded()) throw new Inconclusive(`${who} no PASS on ${commit} within 120 s, ${loadReading()}: ${seen}`);
  throw Error(`BLOCKED: ${who} the claim on ${commit} must PASS for a merge to be allowed at all: ${seen}`);
}
/** The account's five-hour window, as the runner reads it (`windows.report`): `used` percent, resetting at `resetsAt`. */
export async function reportWindow(hub: Hub, used: number, resetsAt: number): Promise<void> {
  await control(hub, 'windows.report', { agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: used, resets_at: Math.round(resetsAt / 1000) } } });
}
/**
 * The thread every merge test starts from: you type `Fix <link>, then create PR.`, the agent makes the fix, commits,
 * pushes and opens the pull request (each of which must go through), and its stop's claim is PASS, pinned to the head it
 * returns. Since #1537 the claim of a session with a PR needs a review by a second model (README, The second model):
 * the world's fake reviewer answers it, once the account's window is read with room (5% used, as #1537's suite reports
 * it), since the runner starts no job before the account's first window reading.
 */
export async function delivered(hub: Hub, s: Session, who: string): Promise<string> {
  const text = `Fix ${WORK_LINK}, then ${CREATE_PR}.`;
  s.hub = hub;
  await reportWindow(hub, 5, Date.now() + 3 * 3_600_000);
  await s.start();
  await s.typed(text);
  await s.read('src/auth.js');
  const locked = (all: Ev[]) => all.some((e) => e.kind === 'definition.locked');
  const events = await settle(hub, locked, 60_000);
  if (!locked(events)) {
    if (loaded()) throw new Inconclusive(`${who} the session started from ${WORK_LINK} locked no definition within 60 s, ${loadReading()}`);
    throw Error(`BLOCKED: ${who} the session started from ${WORK_LINK} must lock its handed definition: ${listed(events.filter((e) => /^(task|definition)\./.test(e.kind)))}`);
  }
  await s.edit(FIX);
  await s.edit(FLAG);
  const head = await s.commit('Reject expired tokens');
  await expectAllowed(hub, s, bash(PUSH), who);
  await expectAllowed(hub, s, bash(PR_CREATE), who, { response: { stdout: `${PR_URL}\n`, stderr: '', interrupted: false, isImage: false } });
  const stop = await s.stop(`Opened ${PR_URL}.`);
  must(decision(stop) !== 'deny', `BLOCKED: ${who} the stop on the passing head must not be sent back: ${shown(stop)}`);
  await expectPass(hub, head, who);
  return head;
}
