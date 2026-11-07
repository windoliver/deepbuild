// Shared test-side tools for the issue #1407 acceptance tests (a panic while deep-hook rules on a call). Temp homes
// with no hub; a rules.json written into them; deep-hook built plain, as the planted twin `plant-matcher-panic`, or
// from the base commit's sources; deep-hook run as an agent's hook entry runs it. `tempDir`, `own`, `alive`,
// `cleanup`, `childEnv`, `run`, `shown`, `failureOf`, `must`, the build cache and `preToolUse`/`hook` are adapted
// from tests/acceptance/304/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of that
// suite never moves these tests. Nothing here stands in for deep-hook: every decision comes from the real binary.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
/** The base commit these tests were written against (origin/main before any #1407 code). */
export const BASE = '2bba2a50';
/** The planted wrong program the implementer adds: deep-hook's matcher (`Call::matches`) panics when it matches a call. */
export const PLANT = 'plant-matcher-panic';

/** Each criterion's ID: `#1407.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#1407.3799f437';
export const AC2 = '#1407.055ae8d4';
export const AC3 = '#1407.14eb6bf3';

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- Temp folders, under /tmp.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1407-'));
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
/** Stops every process this suite started that is still running (SIGTERM, then SIGKILL after 3 s) and removes temp folders. */
export async function cleanup(): Promise<void> {
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Variables that make an agent bill an API account; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: this one with HOME moved to the test's home and no DEEP_, GIT_, XDG_, CLAUDE, CURSOR, CODEX or RUST_ settings or billing keys. */
export function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('CLAUDE') || key.startsWith('CURSOR') || key.startsWith('CODEX') || key.startsWith('RUST_') || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.LC_ALL = 'C';
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
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
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, ms: performance.now() - t0, timedOut }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''} after ${r.ms.toFixed(1)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;

/** The message a judgement throws, or null when it holds: a wrong program's test expects it to throw. */
export async function failureOf(judge: () => unknown): Promise<string | null> {
  try {
    await judge();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
/** Throws `message` unless `ok`: the judgements read as one assertion per sentence of the criterion. */
export function must(ok: boolean, message: string): void {
  if (!ok) throw Error(message);
}
/**
 * stderr without the one line whose presence and bytes depend on the disk's timing, not the decision: the spool's
 * "deep-hook: spooled <its fresh ULID>, but its sync didn't finish within the hook's 50 ms" (main.rs, `spool_by`),
 * printed when an fsync runs past 50 ms, as it does on a loaded machine. Everything else is compared byte for byte.
 */
export const steady = (stderr: string): string =>
  stderr.replace(/^deep-hook: spooled [0-9A-HJKMNP-TV-Z]{26}, but its sync didn't finish within the hook's 50 ms\n/gm, '');
/** A run killed at its timeout decides nothing: INCONCLUSIVE, never PASS and never a criterion's FAIL. */
export function decided(r: Ran, what: string): void {
  if (r.timedOut) throw Error(`INCONCLUSIVE: ${what} was killed at the timeout (the machine may be loaded): ${shown(r)}`);
}

// ---- deep-hook builds (README, How to run). Each build is made once per test process; cargo runs niced.
const builds = new Map<string, Promise<string>>();
function cargo(args: string[], cwd: string, binary: string, what: string): Promise<string> {
  return run('nice', ['-n', '10', 'cargo', ...args], { cwd, timeoutMs: 1_800_000 }).then((r) => {
    if (r.timedOut) throw Error(`INCONCLUSIVE: ${what}: cargo ${args.join(' ')} was killed at the timeout`);
    if (r.code !== 0) throw Error(`BLOCKED: ${what} did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-2000)}`);
    if (!existsSync(binary)) throw Error(`BLOCKED: no binary at ${binary} after cargo ${args.join(' ')}`);
    spawnSync(binary, ['--version'], { stdio: 'ignore', timeout: 30_000 });
    return binary;
  });
}
/**
 * This checkout's deep-hook: plain into target/debug, or with `feature` (the planted twin) into a target folder of
 * its own, target/<feature>/debug/deep-hook. A plant whose feature the checkout lacks fails the cargo build, so its
 * test fails as BLOCKED (never passes).
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
      binary = join(dir, 'debug', 'deep-hook');
    }
    built = cargo(args, REPO, binary, feature ? `the deep-hook build with the plant ${feature}` : 'deep-hook');
    builds.set(key, built);
  }
  return built;
}
/**
 * The base commit's deep-hook, built from its own sources: `git archive` of BASE (the workspace manifest, lock file,
 * cargo config, crates and vendored patches) unpacked into a temp folder, never the working tree, and built into
 * target/base-<BASE>/debug/deep-hook.
 */
export function buildBaseDeepHook(): Promise<string> {
  let built = builds.get('base');
  if (!built) {
    const src = realpathSync(mkdtempSync('/tmp/dh1407-base-'));
    made.push(src);
    const archive = join(src, 'base.tar');
    execFileSync('git', ['-C', REPO, 'archive', '-o', archive, BASE, 'Cargo.toml', 'Cargo.lock', '.cargo', 'crates', 'vendor'], { stdio: 'pipe' });
    execFileSync('tar', ['-x', '-f', archive, '-C', src], { stdio: 'pipe' });
    rmSync(archive);
    const dir = join(REPO, 'target', `base-${BASE}`);
    built = cargo(['build', '--locked', '-q', '-p', 'deep-hook', '--target-dir', dir], src, join(dir, 'debug', 'deep-hook'), `the base commit ${BASE}'s deep-hook`);
    builds.set('base', built);
  }
  return built;
}

// ---- guard@1 entries and rules.json.
export interface Guard { match: string; scope: string; mode: 'watch' | 'warn' | 'block'; reason: string; next_step: string; fail_closed: boolean }
export const entry = (name: string, match: string, failClosed: boolean): Guard => ({
  match,
  scope: 'all_repos',
  mode: 'block',
  reason: `Test entry ${name} holds this call.`,
  next_step: `Leave ${name} alone; this is a test.`,
  fail_closed: failClosed,
});

/**
 * A home at a fixed path with no hub (nothing at its address), a work folder in it, and `entries` as
 * <home>/.deepbuild/rules.json. `at` reuses a path an earlier home had, emptied first, so two binaries can be run
 * on byte-for-byte the same paths.
 */
export function makeHome(entries: Record<string, Guard>, at?: string): { home: string; work: string } {
  const home = at ?? join(tempDir(), 'h');
  rmSync(home, { recursive: true, force: true });
  const work = join(home, 'w');
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  mkdirSync(work);
  writeFileSync(join(home, '.deepbuild', 'rules.json'), `${JSON.stringify({ v: 1, entries }, null, 2)}\n`);
  return { home, work };
}

/** A Claude Code PreToolUse payload for a Bash call; the same arguments give byte-for-byte the same payload. */
export function bashPreToolUse(home: string, work: string, command: string): string {
  return JSON.stringify({
    session_id: '0b5e1407-0000-4000-8000-000000000001',
    transcript_path: join(home, 't.jsonl'),
    cwd: work,
    hook_event_name: 'PreToolUse',
    permission_mode: 'default',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: 'toolu_1407_0001',
  });
}
/** deep-hook as a hook entry runs it: `deep-hook claude-code PreToolUse`, the payload on stdin, HOME the agent's. */
export function hook(binary: string, home: string, work: string, command: string): Promise<Ran> {
  return run(binary, ['claude-code', 'PreToolUse'], { cwd: work, env: childEnv(home), input: bashPreToolUse(home, work, command), timeoutMs: 60_000 });
}
