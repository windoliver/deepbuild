// Test-side tools for the blind redraft of #1407's acceptance tests (a panic while deep-hook rules on a call): temp
// homes with no hub and only a rules.json, deep-hook built plain, with the plant `plant-matcher-panic`, or from the
// base commit's own sources, and deep-hook run as Claude Code's hook entry runs it. `run`, `childEnv`, the build
// cache and the payload are adapted from ../helpers.ts (this repo's first draft, same license); the redraft keeps its
// own copy so it stands without the first draft. Nothing here stands in for deep-hook: every result is the real
// binary's. Nothing here asserts a criterion: a setup that can't be made throws BLOCKED or INCONCLUSIVE, a plain
// Error, so it is never read as a failure at an assertion; the criteria's assertions are the tests' own `expect`s.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This checkout's root: a file here sits at tests/acceptance/1407/redraft/. */
export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
/** The base commit the redraft was written against (origin/main before any #1407 code). */
export const BASE = '2bba2a50';
/** The planted wrong program the implementer adds as a Cargo feature: `Call::matches` (matcher.rs) panics whenever called. */
export const PLANT = 'plant-matcher-panic';

/** `#1407.` and the first 8 hex of SHA-256 of each criterion's text, trimmed, whitespace collapsed. */
export const AC1 = '#1407.3799f437';
export const AC2 = '#1407.055ae8d4';
export const AC3 = '#1407.14eb6bf3';

// ---- Temp folders under /tmp, removed after each test.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1407r-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started; stopped by PID only, never by name or port.
const owned = new Set<number>();
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
/** Stops what this suite started that still runs (it shouldn't: each run is awaited) and removes its temp folders. */
export function cleanup(): void {
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * A hook's environment: this one with HOME the test's and no DEEP_, GIT_, XDG_, CLAUDE, CURSOR, CODEX or RUST_
 * settings (so no RUST_BACKTRACE changes a panic's text and no DEEP_HUB_PLANT plants anything) and no billing keys.
 */
export function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:DEEP_|XDG_|GIT_|CLAUDE|CURSOR|CODEX|RUST_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.LC_ALL = 'C';
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end, with stdin `input`, killing it (by its PID) at `timeoutMs`. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs);
    const done = (code: number | null, signal: NodeJS.Signals | null, extra = '') => {
      clearTimeout(timer);
      if (child.pid) owned.delete(child.pid);
      resolve({ code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, timedOut });
    };
    child.on('error', (error) => done(null, null, error.message));
    child.on('close', (code, signal) => done(code, signal));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(0)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 900))}`;

/**
 * stderr without the lines whose presence depends on the disk's timing, not on the decision: deep-hook's spool lines
 * (main.rs, `spool_by`) "deep-hook: spooled <a fresh ULID>, but its sync didn't finish within the hook's 50 ms" and
 * "deep-hook: could not spool <a fresh ULID> within the hook's 50 ms". Each carries a new ID on every run, and the
 * base differs from itself on them under load. Every other byte of stderr is kept.
 */
export const steady = (stderr: string): string =>
  stderr.replace(/^deep-hook: (?:spooled [0-9A-HJKMNP-TV-Z]{26}, but its sync didn't finish|could not spool [0-9A-HJKMNP-TV-Z]{26}) within the hook's 50 ms\n/gm, '');

/** The base watchdog's words for a call it couldn't read and match in time (main.rs, `watchdog`). */
export const WATCHDOG_WORDS = "DeepBuild blocked this: deep-hook couldn't read this call and check it against the guards";
/** The watchdog's 500 ms limit (main.rs, RULING_LIMIT). */
const RULING_LIMIT_MS = 500;

/**
 * A run that decides nothing: killed at its timeout, or a plain build's run that ran past the watchdog's 500 ms and
 * was denied by it in its words, which the machine's load decides, not the rules. INCONCLUSIVE, never a pass and never
 * a criterion's failure. A watchdog denial within 500 ms is no timing artifact and is left for the test to judge.
 */
export function decided(r: Ran, what: string, { watchdogIsLoad = true } = {}): void {
  if (r.timedOut) throw Error(`INCONCLUSIVE: ${what} was killed at the timeout (the machine may be loaded): ${shown(r)}`);
  if (watchdogIsLoad && r.ms >= RULING_LIMIT_MS && r.stderr.includes(WATCHDOG_WORDS)) {
    throw Error(`INCONCLUSIVE: ${what} ran past the watchdog's ${RULING_LIMIT_MS} ms and was denied by it (the machine may be loaded): ${shown(r)}`);
  }
}

// ---- deep-hook builds. Each is made once per test file; cargo runs niced, CARGO_BUILD_JOBS as the caller set it.
const BUILD_TIMEOUT = 1_800_000;
const builds = new Map<string, Promise<string>>();
async function cargo(args: string[], cwd: string, binary: string, what: string): Promise<string> {
  const r = await run('nice', ['-n', '10', 'cargo', ...args], { cwd, timeoutMs: BUILD_TIMEOUT });
  if (r.timedOut) throw Error(`INCONCLUSIVE: ${what}: cargo ${args.join(' ')} was killed at the timeout`);
  if (r.code !== 0) throw Error(`BLOCKED: ${what} did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-1500)}`);
  if (!existsSync(binary)) throw Error(`BLOCKED: no binary at ${binary} after cargo ${args.join(' ')}`);
  return binary;
}
/**
 * This checkout's deep-hook: plain, target/debug/deep-hook; or with the planted feature, into a target folder of
 * its own, target/<feature>/debug/deep-hook. A checkout without the feature fails that build, so the test is
 * BLOCKED there, never passed.
 */
export function buildDeepHook(feature?: string): Promise<string> {
  const key = feature ?? 'plain';
  let built = builds.get(key);
  if (!built) {
    const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
    let binary = join(REPO, 'target/debug/deep-hook');
    if (feature) {
      const dir = join(REPO, 'target', feature);
      args.push('--features', feature, '--target-dir', dir);
      binary = join(dir, 'debug/deep-hook');
    }
    built = cargo(args, REPO, binary, feature ? `deep-hook with the plant ${feature}` : 'deep-hook');
    builds.set(key, built);
  }
  return built;
}
/**
 * The base commit's deep-hook, from its own sources: `git archive` of BASE (workspace manifest, lock, cargo config,
 * crates, vendored patches) unpacked into target/base-<BASE>/src, so the working tree, the index and the worktree
 * list are never touched, and built there into target/base-<BASE>/target. tar keeps the commit's mtimes, so a
 * second run finds the build fresh.
 */
export function buildBaseDeepHook(): Promise<string> {
  let built = builds.get('base');
  if (!built) {
    const root = join(REPO, 'target', `base-${BASE}`);
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    const archive = join(root, 'base.tar');
    try {
      execFileSync('git', ['-C', REPO, 'archive', '-o', archive, BASE, 'Cargo.toml', 'Cargo.lock', '.cargo', 'crates', 'vendor'], { stdio: 'pipe' });
      execFileSync('tar', ['-x', '-f', archive, '-C', src], { stdio: 'pipe' });
    } catch (error) {
      throw Error(`BLOCKED: the base commit ${BASE}'s sources could not be unpacked: ${(error as Error).message}`);
    } finally {
      rmSync(archive, { force: true });
    }
    const dir = join(root, 'target');
    built = cargo(['build', '--locked', '-q', '-p', 'deep-hook', '--target-dir', dir], src, join(dir, 'debug/deep-hook'), `the base commit ${BASE}'s deep-hook`);
    builds.set('base', built);
  }
  return built;
}

// ---- guard@1 entries, rules.json, and the hook.
export interface Guard { match: string; scope: string; mode: 'block'; reason: string; next_step: string; fail_closed: boolean }
export const entry = (name: string, match: string, failClosed: boolean): Guard => ({
  match,
  scope: 'all_repos',
  mode: 'block',
  reason: `Test entry ${name} holds this call.`,
  next_step: `Leave ${name} alone; this is a test.`,
  fail_closed: failClosed,
});

/**
 * A home with no hub (nothing at its address) holding only .deepbuild/rules.json with `entries`, and a work folder.
 * `at` empties and reuses an earlier home's path, so two binaries see byte-for-byte the same paths and input.
 */
export function makeHome(entries: Record<string, Guard>, at?: string): { home: string; work: string } {
  const home = at ?? join(tempDir(), 'h');
  rmSync(home, { recursive: true, force: true });
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.deepbuild', 'rules.json'), `${JSON.stringify({ v: 1, entries }, null, 2)}\n`);
  const work = join(home, 'w');
  mkdirSync(work);
  return { home, work };
}

/** A Claude Code PreToolUse payload for a Bash call; the same arguments give the same bytes. */
export function bashPreToolUse(home: string, work: string, command: string): string {
  return JSON.stringify({
    session_id: '0b5e1407-0000-4000-8000-000000000002',
    transcript_path: join(home, 't.jsonl'),
    cwd: work,
    hook_event_name: 'PreToolUse',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: 'toolu_1407_redraft',
  });
}
/** deep-hook as Claude Code's hook entry runs it: `deep-hook claude-code PreToolUse`, the payload on stdin. */
export function hook(binary: string, home: string, work: string, command: string): Promise<Ran> {
  return run(binary, ['claude-code', 'PreToolUse'], { cwd: work, env: childEnv(home), input: bashPreToolUse(home, work, command), timeoutMs: 60_000 });
}
