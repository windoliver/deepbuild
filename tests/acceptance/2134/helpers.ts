// Test-side tools for issue #2134's acceptance tests (the hook's matcher: the cloud owner a standing rule covers is
// the creating run's own, and an option's value before the subcommand is never read as the subcommand): temp homes
// under /tmp holding the first-party entries as rules.json with the `standing` member the hub copies your standing
// rules into, a `~/.aws/config` naming two accounts' profiles, and the real deep-hook run as Claude Code's hook entry
// runs it (`deep-hook claude-code PreToolUse`, the payload on stdin) and in its check mode (`deep-hook check`). No hub
// is ever started. `run`, `childEnv`, `shown` and the payload's shape are adapted from tests/acceptance/2042/helpers.ts
// (same repo, same license); this suite keeps its own copy so a redraft there never moves these tests. Nothing here
// stands in for deep-hook, and nothing here asserts a criterion: a setup that can't be made throws a plain BLOCKED or
// INCONCLUSIVE error, never an assertion; the criteria's assertions are the tests' own `expect`s.

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
/** The first-party entries: what setup installs as the first rules.json. */
export const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
/** The first-party entry that holds a cloud create while the hub is away (`effect:cloud-resource`, fail_closed). */
export const CLOUD_GUARD = 'no-unnamed-cloud-resource';

/** Each criterion's ID: `#2134.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#2134.c62f68e2';
export const AC2 = '#2134.45c65c46';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};

// ---- Temp folders.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2134-'));
  made.push(dir);
  return dir;
}
/** Removes the temp folders. Every process this suite starts is run to its end (or killed by its PID at its timeout). */
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/**
 * A child's environment: this one with HOME the test's and no DEEP_, GIT_, XDG_, CLAUDE, CODEX, RUST_ or AWS_ settings
 * or billing keys, so the only AWS profile a call names is the one its own command line holds.
 */
export function childEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(?:DEEP_|XDG_|GIT_|CLAUDE|CODEX|RUST_|AWS_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = home;
  env.XDG_CONFIG_HOME = join(home, '.config');
  env.XDG_CACHE_HOME = join(home, '.cache');
  env.PATH = `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
  env.LC_ALL = 'C';
  return env;
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs a command to its end, with stdin `input`, killing it (by its PID) at `timeoutMs`. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(command, args, { cwd: o.cwd ?? REPO, env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs);
    const done = (code: number | null, signal: NodeJS.Signals | null, extra = '') => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, timedOut });
    };
    child.on('error', (error) => done(null, null, error.message));
    child.on('close', (code, signal) => done(code, signal));
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 400))}, stderr ${JSON.stringify(r.stderr.slice(0, 700))}`;

/** This checkout's deep-hook, built plain into target/debug (a no-op when it is fresh). */
export async function buildDeepHook(): Promise<void> {
  const args = ['build', '--locked', '-q', '-p', 'deep-hook'];
  const r = await run('nice', ['-n', '10', 'cargo', ...args], { timeoutMs: 1_800_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: cargo ${args.join(' ')} was killed at the timeout`);
  if (r.code !== 0 || !existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook did not build: cargo ${args.join(' ')} exited ${r.code}: ${r.stderr.slice(-1500)}`);
}

// ---- A home after setup, with no hub: rules.json, its standing member, and ~/.aws/config.
/** Two AWS accounts as `~/.aws/config` names them: the profile, and the `sso_account_id` it signs into. */
export const DEV = { profile: 'dev', account: '111111111111' };
export const PROD = { profile: 'prod', account: '222222222222' };
/** The owner of a profile's creates as deep-hook and the hub name it at the base: `aws:<its sso_account_id>`. */
export const ownerOf = (a: { account: string }) => `aws:${a.account}`;

export interface Home { home: string; root: string; rules: string; work: string }
/**
 * A fresh home as setup leaves the parts these tests reach, with no hub and none ever started: <home>/.deepbuild
 * (0700) holding rules.json (the shipped default-rules.json's members, plus `standing` when `standing` is given: one
 * `{"effect": "cloud-resource", "owner": ...}` per owner, as the hub copies your standing rules) and a
 * setup-finished.json shaped as setup writes it; <home>/.aws/config naming profile `dev` and profile `prod`, each with
 * its own `sso_account_id`, and, with `defaultIs`, a `[default]` section signing into that account; and a work folder.
 */
export function makeHome(o: { standing?: string[]; defaultIs?: { account: string } } = {}): Home {
  const home = join(tempDir(), 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const rules = join(root, 'rules.json');
  const file = JSON.parse(readFileSync(DEFAULT_RULES, 'utf8')) as Line;
  if (o.standing) file.standing = o.standing.map((owner) => ({ effect: 'cloud-resource', owner }));
  writeFileSync(rules, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  const version = String((JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as Line).version);
  writeFileSync(join(root, 'setup-finished.json'), `${JSON.stringify({ version, at: new Date().toISOString() })}\n`, { mode: 0o600 });
  mkdirSync(join(home, '.aws'));
  const section = (head: string, account: string) => `[${head}]\nsso_account_id = ${account}\nsso_role_name = Developer\nregion = eu-west-1\n`;
  writeFileSync(join(home, '.aws', 'config'), [
    ...(o.defaultIs ? [section('default', o.defaultIs.account)] : []),
    section(`profile ${DEV.profile}`, DEV.account),
    section(`profile ${PROD.profile}`, PROD.account),
  ].join('\n'));
  const work = join(home, 'w');
  mkdirSync(work);
  return { home, root, rules, work };
}

// ---- The hook, as Claude Code's hook entry runs it.
const session = randomUUID();
/** Claude Code's PreToolUse payload for a Bash call of `command`. */
export function payload(h: Home, command: string): string {
  return JSON.stringify({
    session_id: session, transcript_path: join(h.home, 't.jsonl'), cwd: h.work, hook_event_name: 'PreToolUse', permission_mode: 'default',
    tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${randomBytes(12).toString('hex')}`,
  });
}
/** Everything the hook printed: where a denial's words are, whichever stream carries them. */
export const words = (r: Ran) => `${r.stdout}\n${r.stderr}`;
/**
 * `deep-hook claude-code PreToolUse` for a Bash call of `command`, HOME the test's, nothing listening at the hub's
 * address. A hook the machine gave no time is not a reading: past 500 ms with the call unread, deep-hook's watchdog
 * denies it unchecked ("... within 500 ms ..."), naming no entry. Such a try is made again, 10 times, then INCONCLUSIVE.
 */
export async function hook(h: Home, command: string): Promise<Ran> {
  let last: Ran | undefined;
  for (let tries = 0; tries < 10; tries++) {
    const r = await run(DEEP_HOOK, ['claude-code', 'PreToolUse'], { cwd: h.work, env: childEnv(h.home), input: payload(h, command), timeoutMs: 60_000 });
    last = r;
    if (r.timedOut) continue;
    if (r.code === 2 && /within 500 ms/.test(r.stderr) && !r.stderr.includes('(guard ')) continue;
    return r;
  }
  throw Error(`INCONCLUSIVE: deep-hook never got to rule on \`${command}\` in 10 tries (the machine may be loaded); rerun alone: ${last ? shown(last) : ''}`);
}
/**
 * What deep-hook's output tells Claude Code about the call: `denied` is the issue's "exits 2 with the
 * `no-unnamed-cloud-resource` denial" (exit 2, and what it printed names that entry); `allowed` is exit 0 with no
 * deny decision printed; anything else is `other`.
 */
export function decision(r: Ran): 'denied' | 'allowed' | 'other' {
  const out = parseObject(r.stdout.trim());
  const said: unknown = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 && words(r).includes(CLOUD_GUARD)) return 'denied';
  if (r.code === 0 && (said === undefined || said === 'allow') && !words(r).includes(CLOUD_GUARD)) return 'allowed';
  return 'other';
}
/** The decision for each command, in order. */
export async function decisions(h: Home, commands: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const command of commands) out[command] = decision(await hook(h, command));
  return out;
}
/**
 * Each reading in `got` that isn't what `want` says, as "`<command>`: <got>, not <want>": what a test's one `expect`
 * compares with none, so a failure names every command read wrongly.
 */
export function wrong<T>(got: Record<string, T>, want: Record<string, T>): string[] {
  return Object.keys(want).filter((key) => got[key] !== want[key]).map((key) => `\`${key}\`: ${String(got[key])}, not ${String(want[key])}`);
}
/** `commands`, each mapped to `value`: what a test expects of `decisions` or `matches`. */
export const each = <T>(commands: readonly string[], value: T): Record<string, T> => Object.fromEntries(commands.map((c) => [c, value]));

/**
 * The controls a standing-rule test stands on, in its own home: with the hub away, the one create under the covered
 * profile is allowed (the standing rule is read and covers it), and the one create under the other profile is denied
 * by `no-unnamed-cloud-resource` (the entry holds). Throws BLOCKED otherwise, so no test passes or fails for a setup
 * that doesn't hold.
 */
export async function controls(h: Home): Promise<void> {
  const covered = `aws kms create-key --profile ${DEV.profile}`;
  const other = `aws kms create-key --profile ${PROD.profile}`;
  const a = await hook(h, covered);
  if (decision(a) !== 'allowed') throw Error(`BLOCKED: control: with the standing rule for profile ${DEV.profile}'s owner and no hub, \`${covered}\` must be allowed: ${shown(a)}`);
  const b = await hook(h, other);
  if (decision(b) !== 'denied') throw Error(`BLOCKED: control: with the standing rule for profile ${DEV.profile}'s owner and no hub, \`${other}\` must exit 2 with the ${CLOUD_GUARD} denial: ${shown(b)}`);
}

// ---- The matcher, through deep-hook's check mode: an entry and a call on stdin, whether the entry matches.
/**
 * Whether a guard@1 entry whose `match` is `pattern` matches a Bash call of `command`: `deep-hook check`, as the hub
 * runs the matcher at install over each entry's planted call and twin. Throws BLOCKED when check doesn't answer
 * `{"matched": true | false}`.
 */
export async function matched(h: Home, command: string, pattern: string): Promise<boolean> {
  const input = JSON.stringify({
    entry: { match: pattern, scope: 'all_repos', mode: 'block', reason: 'A reason.', next_step: 'A next step.', fail_closed: true },
    call: { tool_name: 'Bash', tool_input: { command }, cwd: h.work },
  });
  const r = await run(DEEP_HOOK, ['check'], { cwd: h.work, env: childEnv(h.home), input, timeoutMs: 60_000 });
  if (r.timedOut) throw Error(`INCONCLUSIVE: deep-hook check for \`${command}\` was killed at 60 s (the machine may be loaded): ${shown(r)}`);
  const answer: unknown = parseObject(r.stdout.trim())?.matched;
  if (r.code !== 0 || typeof answer !== 'boolean') throw Error(`BLOCKED: deep-hook check didn't say whether ${pattern} matches \`${command}\`: ${shown(r)}`);
  return answer;
}
/** Whether `pattern` matches each command, in order. */
export async function matches(h: Home, commands: readonly string[], pattern: string): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const command of commands) out[command] = await matched(h, command, pattern);
  return out;
}
export const CLOUD = 'effect:cloud-resource';
export const DEPENDENCY = 'effect:dependency';
