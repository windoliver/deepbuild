// Shared test-side tools for issue #82's acceptance tests (README): a temp world (a home with the shipped default
// guards and your ask settings; a git repository with a `.deepbuild/done.yaml` spec, a unit test and drafted checks;
// the definitions the kernel is handed and the test work source's readings), the hub as a process with its test
// settings, the record read back through the hub's socket (`events.read`), Claude Code and Codex sessions driven
// through the real deep-hook binary with payloads and transcripts shaped like the corpus's, and DeepBuild's waiter as
// Claude Code's async Stop entry runs it.
//
// Copied from tests/acceptance/325/helpers.ts (the world, the hub, the record, Claude Code sessions; same repo, same
// license), with the desktop app's prompts, quit and resume from tests/acceptance/340/flow/helpers.ts and the Codex
// session from the same file. This suite keeps its own copy so a redraft of theirs never moves these tests. Nothing
// here stands in for DeepBuild: every reading comes from the real hub and deep-hook. The test plays the agent,
// including what Claude Code writes into the transcript from a hook's reply ("Stop hook feedback").

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
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

/** Each criterion's ID: `#82.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #82.7c6a9250';
export const AC2 = 'AC2 #82.429cda18';
export const AC3 = 'AC3 #82.3f863987';
export const AC4 = 'AC4 #82.731c9e54';
export const AC5 = 'AC5 #82.fbbdd208';
export const AC6 = 'AC6 #82.7f8929f5';
export const AC7 = 'AC7 #82.443b3a5a';
export const AC8 = 'AC8 #82.b6297cd7';
export const AC9 = 'AC9 #82.0fcced84';
export const AC10 = 'AC10 #82.6e3bad75';
export const AC11 = 'AC11 #82.c17a5871';
export const AC12 = 'AC12 #82.be677619';
export const AC13 = 'AC13 #82.94380d25';
export const PROOF = 'Proof #82';

/** The stop hold every hub here runs with unless a test asks for the shipped one (DEEP_HUB_TEST_STOP_HOLD_MS). */
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
  const dir = realpathSync(mkdtempSync('/tmp/dh82-'));
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

// ---- The definitions the kernel is handed and the test work source (README, The world).
/** One requirement of a handed definition, in #303's and #322's fields, with `expected_ms` (a check's expected time, design: Fast and slow lanes). */
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[]; expected_ms?: number }
/** A definition the kernel is handed: by a work item (`issue`) or by a prompt's exact text (`ask`). */
export interface Draft { issue?: string; ask?: string; requirements: Requirement[]; deliverables: string[]; budget: null }
/** A test work source's reading, in work.item@1's fields; `body` is the text itself here. */
export interface Reading { source_id: string; link: string; title: string; body: string; criteria: string[]; authors: { handle: string; role: 'owner' | 'collaborator' | 'outside' }[]; updated: string }

export const req = (id: string, text: string, o: Partial<Requirement> = {}): Requirement => ({
  id, text, source_line: 'ask#L1', refuted_by: `a run where ${text.toLowerCase()} does not hold`, check: null, on_base: 'fails', asserts: [], depth: 'unit', oracle: 'code', near_misses: [], ...o,
});

/** The repo's spec, `.deepbuild/done.yaml`: one claim, done, with the unit check, a node:test run the hermetic runner counts. */
export const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
/** The unit test: checkToken rejects a token whose exp has passed. It fails at the base commit and passes once FIX is made. */
export const UNIT_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken rejects an expired token', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\n";
/** `note` is the line a round's edit bumps, so a stop's snapshot changes the checks' inputs and they run again. */
export const AUTH_JS = "module.exports = {\n  checkToken: (token) => token.exp > 0,\n  rejectsExpired: false,\n  logsRejected: false,\n  note: 0,\n};\n";
export const NET_JS = 'module.exports = { retries: 0 };\n';
/** The cart the typed question asks about (AC9-AC11): it rounds the tax on each line. */
export const CART_JS = "// Tax is rounded per line, as the receipts show it.\nmodule.exports = {\n  total: (lines) => lines.reduce((sum, l) => sum + Math.round(l.price * l.qty * 0.08 * 100) / 100 + l.price * l.qty, 0),\n};\n";
/** The edit that makes the spec's unit test pass. */
export const FIX = { file: 'src/auth.js', from: 'token.exp > 0', to: 'token.exp > Date.now() / 1000' } as const;
/** The edit that makes R1's drafted check (expired) pass. */
export const FLAG = { file: 'src/auth.js', from: 'rejectsExpired: false', to: 'rejectsExpired: true' } as const;

/**
 * A drafted check: a `#!/bin/sh` file that runs its node:test file, so the runner counts the tests it ran. Its
 * assertion is line 4 of the test file, which `asserts` names.
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
export type Check = ReturnType<typeof check>;
export const CHECKS = {
  /** Fails until FLAG. */
  expired: check('expired-token', 'an expired token is rejected with 401', "require('../../src/auth.js').rejectsExpired", 'true'),
  /** Fails on every commit of these tests: nothing the agent does gives src/net.js a retry. */
  retry: check('retry', 'a dropped connection is retried', "require('../../src/net.js').retries > 0", 'true'),
  /** Passes on every commit; handed with an expected time of 10 minutes, so it never fits a stop's fast lane. */
  journey: check('checkout-journey', 'the checkout journey accepts a valid token', "require('../../src/auth.js').checkToken({ exp: Date.now() / 1000 + 3600 })", 'true'),
} as const;
/** The expected time handed with CHECKS.journey: ten minutes, past the 10 s fast-lane budget. */
export const SLOW_MS = 600_000;

export const CRITERIA = {
  expired: 'An expired token is rejected with 401',
  retry: 'A dropped connection is retried',
  journey: 'The checkout journey accepts a valid token',
  approve: 'You approve the new error page wording',
} as const;

/** Your ask settings (#319's shape): setup's drafts with no `batch`, so every ask shows when it's raised. */
export const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
export const ACCOUNT = 'acct-dh82-0001';

// ---- The test work source (DEEP_HUB_TEST_WORK): a source that isn't GitHub, at work.test (#322's).
export const WORK_LINK = (n: number) => `https://work.test/acme/shop/issues/${n}`;
export const ITEM = (n: number) => `item-${n}`;
/** A work item written by its owner maya, its criteria as given. */
export const workItem = (n: number, title: string, criteria: readonly string[]): Reading => ({
  source_id: ITEM(n), link: WORK_LINK(n), title, body: `${title}.\n\n${criteria.map((c) => `- ${c}`).join('\n')}`, criteria: [...criteria],
  authors: [{ handle: 'maya', role: 'owner' }], updated: '2026-10-20T09:00:00Z',
});
/** One requirement as a test names it: its text, its check (null for none), and how it is judged. */
export interface Wanted { text: string; check: Check | null; on_base?: 'fails' | 'passes'; oracle?: 'code' | 'person'; expected_ms?: number }
/** The definition a drafting job would hand for item n: one requirement per criterion, R1…Rn, each from its line. */
export const draftFor = (n: number, reqs: readonly Wanted[]): Draft => ({
  issue: ITEM(n),
  requirements: reqs.map((r, i) => req(`R${i + 1}`, r.text, {
    source_line: `${ITEM(n)}#L${i + 3}`, check: r.check?.file ?? null, asserts: r.check ? [r.check.assertion] : [], on_base: r.on_base ?? 'fails',
    ...(r.oracle ? { oracle: r.oracle } : {}), ...(r.expected_ms ? { expected_ms: r.expected_ms } : {}),
  })),
  deliverables: ['src/auth.js'], budget: null,
});
/** Item n with the given requirements: its reading and its draft. */
export const item = (n: number, title: string, reqs: readonly Wanted[]) => ({ reading: workItem(n, title, reqs.map((r) => r.text)), draft: draftFor(n, reqs) });
/** The usual item: R1, an expired token is rejected, judged by CHECKS.expired, which fails until FLAG. */
export const EXPIRED: Wanted = { text: CRITERIA.expired, check: CHECKS.expired };
/** A definition handed for a prompt's exact text, so a wrong kernel that opened a task for it would lock one. */
export const askDraft = (ask: string): Draft => ({ ask, requirements: [req('R1', `${ask}: the change works`)], deliverables: ['src/cart.js'], budget: null });

export interface World { tmp: string; home: string; root: string; repo: string; confirm: string; drafts: string; work: string; base: string }
export interface WorldOptions {
  items?: { reading: Reading; draft: Draft }[];
  drafts?: Draft[];
  /** Extra files in the repo at its base commit, path to bytes. */
  files?: Record<string, string>;
}
/**
 * `<tmp>/h` is HOME for every process: the hub's root `<home>/.deepbuild` holds the shipped default guards as the first
 * rules.json and config.json with your settings; `<home>/.claude.json` names the account and marks the repo trusted in
 * Claude Code's workspace trust, so the repo's checks run. `<tmp>/repo` is a git repository with one commit on main
 * (`base`). `<tmp>/confirm` says `confirmed` (DEEP_HUB_TEST_CONFIRM). `<tmp>/drafts.json` is DEEP_HUB_TEST_DRAFTS,
 * `<tmp>/work.json` DEEP_HUB_TEST_WORK.
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
    'src/auth.js': AUTH_JS, 'src/net.js': NET_JS, 'src/cart.js': CART_JS, 'tests/unit.test.js': UNIT_TEST, '.deepbuild/done.yaml': SPEC,
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
  const real = realpathSync(repo);
  const claudeJson: Line = { oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3, projects: { [real]: { allowedTools: [], hasTrustDialogAccepted: true } } };
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify(claudeJson, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [...(o.items ?? []).map((i) => i.draft), ...(o.drafts ?? [])] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: (o.items ?? []).map((i) => i.reading) }, null, 2)}\n`);
  return { tmp, home, root, repo: real, confirm, drafts, work, base };
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
 * Starts `deep hub run` with DEEP_HUB_TEST_CONFIRM, DEEP_HUB_TEST_DRAFTS, DEEP_HUB_TEST_WORK and, unless `hold` is
 * null (the shipped 60 s hold), DEEP_HUB_TEST_STOP_HOLD_MS; DEEP_HUB_PLANT when given. A plant the hub doesn't list
 * is BLOCKED: the implementer adds it to packages/hub/src/plant.ts (README, Plants).
 */
export async function startHub(w: World, o: { plant?: string | undefined; hold?: number | null } = {}): Promise<Hub> {
  const hold = o.hold === undefined ? HOLD_MS : o.hold;
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm,
    DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_WORK: w.work,
    DEEP_HUB_PLANT: o.plant,
    DEEP_HUB_TEST_STOP_HOLD_MS: hold === null ? undefined : String(hold),
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
export async function settle(hub: Hub, done: (events: Ev[]) => boolean, timeoutMs = 30_000): Promise<Ev[]> {
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

// ---- Readers of the record (as #322's and #325's suites read it).
/** The task a session's prompt opened: the one task its user.ask names. */
export function itemTask(events: readonly Ev[], s: { id: string }, text?: string): string | undefined {
  const named = events.filter((e) => e.kind === 'user.ask' && e.session === s.id && (text === undefined || e.data.text === text) && Array.isArray(e.data.tasks) && e.data.tasks.length === 1);
  return named.length ? String(named[0]!.data.tasks[0]) : undefined;
}
/** The definitions locked for a task, in log order. */
export const lockedFor = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
/** The claims made for a task in a window of log positions (after `since`, before `until`). */
export const claimsOf = (events: readonly Ev[], ref: string, since = 0, until = Infinity): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.log_pos > since && e.log_pos < until && e.data.task_ref === ref);
/** Every claim made in a window, whatever its task. */
export const claimsIn = (events: readonly Ev[], since = 0, until = Infinity): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.log_pos > since && e.log_pos < until);
/** The claim handles (`claim:<id>`) made in a window. */
export const handles = (claims: readonly Ev[]): Set<string> => new Set(claims.map((c) => `claim:${c.id}`));
/** The send-backs recorded in a window. */
export const sendBacksIn = (events: readonly Ev[], since = 0, until = Infinity): Ev[] => events.filter((e) => e.kind === 'claim.sent_back' && e.log_pos > since && e.log_pos < until);
/** The verdicts made in a window. */
export const verdictsIn = (events: readonly Ev[], since = 0, until = Infinity): Ev[] => events.filter((e) => e.kind === 'verdict.made' && e.log_pos > since && e.log_pos < until);
/** The runs started for the given claims, each with its finish. */
export function runsFor(events: readonly Ev[], claims: Set<string>): { started: Ev; finished: Ev | undefined }[] {
  return events.filter((e) => e.kind === 'run.started' && claims.has(String(e.data.claim)))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
/** The session's stops, in log order. */
export const stopsOf = (events: readonly Ev[], s: { id: string }): Ev[] => events.filter((e) => e.kind === 'agent.stop' && e.session === s.id && e.data.child === undefined);
/** The session's newest stop after `since`. */
export const stopAfter = (events: readonly Ev[], s: { id: string }, since: number): Ev | undefined => stopsOf(events, s).filter((e) => e.log_pos > since)[0];
/** Whether a task was closed (its task.closed, or its ask closed) after `since`. */
export const closedAfter = (events: readonly Ev[], ref: string, since: number): Ev[] => events.filter((e) => e.log_pos > since && (e.kind === 'task.closed' || /^ask\.(answered|moot|cancelled|superseded)$/.test(e.kind)) && (e.subject === ref || e.data.task_ref === ref || e.data.task === ref));
/** The open items opened for a task after `since`. */
export const openItemsOf = (events: readonly Ev[], ref: string, since: number): Ev[] => events.filter((e) => e.kind === 'open_item.opened' && e.log_pos > since && e.data.task_ref === ref);
/** The person-typed user.asks of a session after `since`. */
export const typedAfter = (events: readonly Ev[], s: { id: string }, since: number): Ev[] => events.filter((e) => e.kind === 'user.ask' && e.session === s.id && e.log_pos > since && e.data.from === 'person');

// ---- Each session's agent (fixtures/agent.mjs): one long-lived process per session, the parent of every deep-hook
// run of that session, as Claude Code (or Codex) is of its hook commands.
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
        done({ code: null, signal: null, stdout: '', stderr: 'the session\'s agent process exited', ms: 0, timedOut: false, ended: Date.now() });
      }
    });
  }
  static start(w: World, env: Record<string, string>): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, env), stdio: ['pipe', 'pipe', 'ignore'] });
    own(child.pid);
    child.stdin!.on('error', () => undefined);
    return new Agent(child);
  }
  run(args: readonly string[], cwd: string, input: string, timeoutMs: number): Promise<Ran> {
    const n = ++this.n;
    return new Promise((resolve) => {
      this.pending.set(n, resolve as (r: Line) => void);
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
/** What a hook's reply says: a block's reason (stdout JSON, or stderr at exit 2) and the message the chat shows (systemMessage); both as one text to search. */
export function replyText(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  const reason = typeof out?.reason === 'string' ? out.reason : typeof out?.hookSpecificOutput?.permissionDecisionReason === 'string' ? out.hookSpecificOutput.permissionDecisionReason : r.code === 2 ? r.stderr : '';
  const message = typeof out?.systemMessage === 'string' ? out.systemMessage : '';
  return `${reason}\n${message}`.trim();
}
/** The line the chat shows for a stop (design: The verdict in the chat): its systemMessage, else the first line of a block's reason. */
export function chatLine(r: Ran): string {
  const out = parseObject(r.stdout.trim());
  if (typeof out?.systemMessage === 'string' && out.systemMessage) return out.systemMessage;
  return replyText(r).split('\n')[0] ?? '';
}
/** Whether a stop was blocked: deep-hook kept the turn going (a send-back, a continue or a completion prompt). */
export const blocked = (r: Ran): boolean => decision(r) === 'deny';
/** Whether a reply names requirement `id` or its text. */
export const names = (text: string, id: string, words: string): boolean => new RegExp(`\\b${id}\\b`).test(text) || text.includes(words);

let calls = 0;
const assistant = (content: Line[], stop: string, model = 'claude-haiku-5-5'): Line => ({ type: 'assistant', message: { model, id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** The Claude desktop app's resume prompt, as the corpus's 2.1.299 desktop-resume session has it. */
export const RESUME = 'The app was quit while you were working. Please continue from where you left off.';
/** What Claude Code writes as the assistant's words when a turn ends with nothing said, a `<synthetic>` message (2.1.299 desktop-resume). */
export const NO_RESPONSE = 'No response requested.';

/**
 * A Claude Code session: its transcript, its own Claude Code process, and its hooks fired through deep-hook. On the
 * `desktop` surface (the Claude desktop app, entrypoint claude-desktop), every prompt comes with the app's queue pair
 * (an enqueue of its text and a dequeue 5 ms later) before its entry and UserPromptSubmit, as the corpus's 2.1.299
 * desktop sessions have it.
 */
export class Session {
  readonly id: string;
  readonly cwd: string;
  readonly transcript: string;
  prompt: string | undefined;
  /** The hub the session's task was opened on (startOnItem), read at each stop for the load rule (README, Load). */
  hub: Hub | undefined;
  private parent: string | null = null;
  private turn = 0;
  constructor(readonly w: World, readonly surface: 'terminal' | 'desktop' = 'terminal') {
    this.id = randomUUID();
    this.cwd = w.repo;
    this.transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    agents.set(this.id, Agent.start(w, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: surface === 'desktop' ? 'claude-desktop' : 'cli', CLAUDE_PROJECT_DIR: w.repo }));
  }
  private write(value: Line): void {
    writeFileSync(this.transcript, `${JSON.stringify(value)}\n`, { flag: 'a' });
  }
  /** Appends one transcript entry, as Claude Code writes it. */
  entry(value: Line): void {
    const uuid = randomUUID();
    this.write({ parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: this.surface === 'desktop' ? 'claude-desktop' : 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' });
    this.parent = uuid;
  }
  /** The desktop app's pair before a prompt: its enqueue, then its dequeue a few ms later. */
  async pair(text: string): Promise<void> {
    this.write({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: this.id, content: text });
    await sleep(5);
    this.write({ type: 'queue-operation', operation: 'dequeue', timestamp: new Date().toISOString(), sessionId: this.id });
  }
  /**
   * `deep-hook claude-code <event>`, the hook's JSON on stdin, as a child of the session's own Claude Code process.
   * A Stop's block reason is then written as the user entry "Stop hook feedback", as Claude Code writes it.
   */
  async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
    unreached(event, ran);
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
  /** SessionEnd, with its reason (`other` when the desktop app is quit, `clear` at /clear). */
  end(reason = 'prompt_input_exit'): Promise<Ran> {
    return this.hook('SessionEnd', { reason });
  }
  /** A prompt: on the desktop the app's queue pair first, then its transcript entry, then UserPromptSubmit. */
  async submit(text: string, entry: Line, o: { pair?: boolean } = {}): Promise<Ran> {
    if (o.pair ?? this.surface === 'desktop') await this.pair(text);
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: entry.content ?? text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, ...entry, content: undefined });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A prompt you typed: its transcript entry (turnOrigin human) and its UserPromptSubmit. */
  typed(text: string): Promise<Ran> {
    return this.submit(text, { origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  }
  /** The desktop app's resume prompt after a quit: the app's "No response requested." for the cut turn, then the prompt (sdk), as 2.1.299 desktop-resume has it. */
  async resumePrompt(): Promise<Ran> {
    await this.pair(RESUME);
    this.says(NO_RESPONSE, '<synthetic>');
    return this.submit(RESUME, { promptSource: 'sdk', turnOrigin: 'sdk' }, { pair: false });
  }
  /** A scheduled task's prompt (turnOrigin scheduled), as the corpus's 2.1.308 loop session has it. */
  scheduled(text: string): Promise<Ran> {
    return this.submit(text, { isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'scheduled', queuePriority: 'later', queueSkipAttachments: true });
  }
  /** A background subagent's report (origin.handback), as the corpus's 2.1.308 subagent session has it. */
  handback(text: string, agentId = 'a2711031fe8c87e48'): Promise<Ran> {
    return this.submit(text, { content: `Another Claude session sent a message:\n${text}`, isMeta: true, promptSource: 'system', turnOrigin: 'peer', origin: { kind: 'peer', from: agentId, senderTaskId: agentId, name: 'general-purpose', body: text, handback: true, handbackReportText: text } });
  }
  /** A message from another Claude Code session (turnOrigin peer, hostInjected), as the corpus's desktop-peer session has it. */
  peer(text: string, from = 'local_8f6f9e9a-898e-4858-aefe-44dfc1b77684'): Promise<Ran> {
    return this.submit(text, { content: `Another Claude session sent a message:\n${text}`, isMeta: true, promptSource: 'system', queueSkipSlashCommands: true, queueSkipAttachments: true, turnOrigin: 'peer', origin: { kind: 'peer', from, hostInjected: true } });
  }
  /** The assistant's tool_use entry and PreToolUse only: a call the app was quit in the middle of. */
  async begin(tool_name: string, tool_input: Line): Promise<Ran> {
    const id = `toolu_${randomBytes(10).toString('hex')}${++calls}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    return this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
  }
  /**
   * One tool call: the assistant's tool_use entry and PreToolUse; when allowed, `effect` (what the call does, which
   * may give the response), its tool_result entry and PostToolUse. The call runs with the input deep-hook's reply
   * gives it (`updatedInput`), as Claude Code runs it.
   */
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
  /** The agent's Bash call: PreToolUse, and when allowed `effect` runs it (with the input deep-hook gave it) and gives its response. */
  bash(command: string, effect?: (input: Line) => Line | void | Promise<Line | void>): Promise<{ allowed: boolean; before: Ran; input: Line }> {
    return this.call('Bash', { command, description: command.slice(0, 40) }, effect ? { effect } : {});
  }
  /** The assistant's words, with no hook. */
  says(words: string, model?: string): void {
    this.entry(assistant([{ type: 'text', text: words }], 'end_turn', model));
  }
  /** The agent's last words of the turn, then Stop; a stop the hold let through early under load is INCONCLUSIVE (README, Load). */
  async stop(words = 'Done.', o: { synthetic?: boolean } = {}): Promise<Ran> {
    this.says(words, o.synthetic ? '<synthetic>' : undefined);
    const since = this.hub ? await lastPos(this.hub) : 0;
    const ran = await this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
    if (this.hub) await heldOut(this.hub, ran, since);
    return ran;
  }
  /** The agent's last words and Stop, with DeepBuild's waiter started beside it, as Claude Code starts its async Stop entry. */
  async stopWaiting(words: string, waitMs: number, o: { synthetic?: boolean } = {}): Promise<{ stop: Ran; waiter: Promise<Ran> }> {
    const waiter = this.waiter(waitMs);
    const stop = await this.stop(words, o);
    return { stop, waiter };
  }
  /**
   * DeepBuild's waiter as Claude Code's async Stop entry (asyncRewake) runs it at a stop: `deep-hook claude-code
   * waiter`, the Stop's payload on stdin, a child of the session's own process. It exits 2 with what wakes the session
   * on stderr; it is stopped at `waitMs` when nothing comes.
   */
  waiter(waitMs: number): Promise<Ran> {
    const body = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: 'Stop', stop_hook_active: false, permission_mode: 'default' };
    return agents.get(this.id)!.run(['claude-code', 'waiter'], this.cwd, JSON.stringify(body), waitMs);
  }
}

/**
 * The load rule (README, Load): a hook deep-hook couldn't hand to the hub within its budget ("spooled …, but its sync
 * didn't finish") is INCONCLUSIVE: its reply is deep-hook's own, and its event reaches the record late, out of the
 * turn's order, so no reading of that turn says what the hub decides.
 */
function unreached(event: string, ran: Ran): void {
  if (/spooled \S+, but its sync didn't finish/.test(ran.stderr)) {
    throw new Inconclusive(`deep-hook couldn't hand ${event} to the hub within its budget (${ran.stderr.trim()}), ${loadReading()}`);
  }
}
/**
 * The load rule (README, Load): a stop let through while a fast-lane run of a claim made at it hadn't ended, with the
 * 1-minute load past the core count, is INCONCLUSIVE: the hold ran out before the checks it waits for.
 */
async function heldOut(hub: Hub, stop: Ran, since: number): Promise<void> {
  if (blocked(stop) || !loaded()) return;
  const events = await allEvents(hub);
  const late = runsFor(events, handles(claimsIn(events, since))).filter((r) => r.started.data.lane === 'fast' && (!r.finished || r.finished.ts > stop.ended));
  if (late.length) throw new Inconclusive(`the stop was let through ${(stop.ms / 1000).toFixed(1)} s after it, before ${late.length} of its fast-lane checks ended (${late.map((r) => String(r.started.data.check)).join(', ')}), ${loadReading()}`);
}

/** What woke a session after a stop without you typing: a blocked reply's reason, or the waiter's wake, or nothing. */
export async function continuation(stop: Ran, waiter: Promise<Ran>): Promise<string | undefined> {
  if (blocked(stop)) return replyText(stop) || '(a block with no reason)';
  const w = await waiter;
  return w.code === 2 ? (w.stderr.trim() || '(a wake with no text)') : undefined;
}

/**
 * A Codex session: its rollout under `<home>/.codex/sessions`, its own Codex process, and its hooks fired through
 * `deep-hook codex <event>`, with payloads and rollout lines shaped like the corpus's codex tools, goal, patches and
 * desktop-heartbeat sessions (session_meta first; each turn a task_started, a turn_context naming its turn_id and the
 * user message that opens it; every hook payload carries the turn's turn_id). Copied from tests/acceptance/340/flow.
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
  /** A new turn in the rollout: task_started (with what triggered it), turn_context, and the user message that opens it. */
  private opens(trigger: string, text: string): string {
    const turn = `01a1${tag(2)}-${tag(2)}-7${tag(2).slice(1)}-8${tag(2).slice(1)}-${tag(6)}`;
    this.turn = turn;
    this.line('event_msg', { type: 'task_started', turn_attribution: { turn_id: turn, turn_trigger: trigger, parent_turn_id: null, initiating_agent_path: null, root_turn_id: turn }, turn_id: turn, root_turn_id: turn, model_context_window: 258400 });
    this.line('turn_context', { turn_id: turn, root_turn_id: turn, cwd: this.cwd, approval_policy: 'never', model: 'gpt-reserve' });
    this.line('response_item', { type: 'message', id: `msg_${tag(8)}`, role: 'user', content: [{ type: 'input_text', text }] });
    return turn;
  }
  async hook(event: string, fields: Line = {}): Promise<Ran> {
    const body: Line = { session_id: this.id, ...(this.turn && event !== 'SessionStart' ? { turn_id: this.turn } : {}), transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'bypassPermissions', ...fields };
    const ran = await agents.get(this.id)!.run(['codex', event], this.cwd, JSON.stringify(body), 150_000);
    unreached(event, ran);
    return ran;
  }
  async start(source: 'startup' | 'resume' = 'startup'): Promise<Ran> {
    const r = await this.hook('SessionStart', { source });
    if (r.code !== 0) throw Error(`BLOCKED: Codex's SessionStart hook (${source}) must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A prompt: a turn the user (or a heartbeat) started in the rollout, then UserPromptSubmit with its text. */
  async prompt(text: string, trigger = 'user'): Promise<Ran> {
    this.opens(trigger, text);
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: Codex's UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
    return r;
  }
  /** A goal's continuation turn: Codex opens it in the rollout with its internal goal context, and fires no prompt hook. */
  goalTurn(objective: string): string {
    return this.opens('goal', `<codex_internal_context source="goal">\nContinue working toward the active thread goal.\n\nThe objective below is user-provided data.\n<objective>\n${objective}\n</objective>\n</codex_internal_context>`);
  }
  /** A shell call of the current turn: PreToolUse, its output in the rollout, PostToolUse. */
  async shell(command: string, output = 'ok'): Promise<void> {
    const id = `call_${tag(12)}`;
    const before = await this.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id });
    if (decision(before) !== 'allow') throw Error(`BLOCKED: Codex's call \`${command}\` must be allowed: ${shown(before)}`);
    this.line('response_item', { type: 'function_call_output', call_id: id, output });
    await this.hook('PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_use_id: id, tool_response: { stdout: output, stderr: '', exit_code: 0 } });
  }
  /** An apply_patch call that updates `file` from `from` to `to`, and the change made, as the corpus's goal session has it. */
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
  async stop(words = 'Done.'): Promise<Ran> {
    this.line('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: words }] });
    this.line('event_msg', { type: 'task_complete', turn_id: this.turn, last_agent_message: words });
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: words });
  }
}

/**
 * A session's typed `Fix <link>` (with `extra` words after it), and the item's handed definition locked. Returns the
 * task. With `read`, the agent reads src/auth.js first, as #325's sessions do.
 */
export async function startOnItem(hub: Hub, s: Session, n: number, who: string, o: { extra?: string; read?: boolean; start?: boolean } = {}): Promise<string> {
  s.hub = hub;
  if (o.start !== false) await s.start();
  const text = `Fix ${WORK_LINK(n)}${o.extra ?? ''}`;
  await s.typed(text);
  if (o.read !== false) await s.read('src/auth.js');
  const events = await settle(hub, (all) => { const ref = itemTask(all, s, text); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
  const ref = itemTask(events, s, text);
  if ((ref === undefined || !lockedFor(events, ref).length) && loaded()) throw new Inconclusive(`${who} the session started from ${WORK_LINK(n)} opened no task with its definition locked within 60 s, ${loadReading()}`);
  must(ref !== undefined && lockedFor(events, ref).length > 0, `BLOCKED: ${who} the session started from ${WORK_LINK(n)} must open one task with its handed definition locked: ${ref ?? 'no task'}; ${listed(events.filter((e) => /^(task|definition)\./.test(e.kind)))}`);
  return ref!;
}

/** The PR body gh would get from a `gh pr create` command: its --body text, or the file --body-file names. */
export function prBody(command: string, cwd: string): string {
  const file = /--body-file\s+(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(command);
  if (file) { const path = file[1] ?? file[2] ?? file[3]!; const abs = path.startsWith('/') ? path : join(cwd, path); return existsSync(abs) ? readFileSync(abs, 'utf8') : ''; }
  const body = /--body\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|\$'((?:[^'\\]|\\.)*)'|(\S+))/s.exec(command);
  return body ? (body[1] ?? body[2] ?? body[3] ?? body[4] ?? '') : '';
}
/** The pull request's link, as gh prints it when the call goes through. */
export const PR_URL = 'https://github.com/acme/shop/pull/12';
