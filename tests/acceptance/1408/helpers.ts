// Test-side tools for #1408 (README). Cargo builds of deep-hook, deep-app and deep-replica into target folders of
// this suite's own under target/acceptance-1408, the byte search of their binaries, the judge of a refused build, and
// deep-hook run as an agent's PreToolUse hook entry runs it with no hub, read back from its spool. Nothing here stands
// in for a build or a binary: every reading comes from cargo or the real program.
//
// Safety: HOME is a temp folder under /tmp for every deep-hook it starts; a process is stopped only by the PID it was
// started with; nothing touches the real ~/.deepbuild or ~/.claude; no network beyond cargo's (--locked), no model.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** Each criterion's ID: `#1408.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
export const AC1 = '#1408.fc1e2a9c';
export const AC2 = '#1408.028b0245';
export const AC3 = '#1408.894e1c69';
/** The plant feature, invented here (README, The feature): the implementer adds it, one name in all three crates. */
export const FEATURE = 'env-plants';
export const STRINGS = ['DEEP_HUB_PLANT', 'DEEP_DRIVE_PLANT'] as const;
/** The merge base this suite was written on, pinned, so its wrong program stays the pre-fix code after #1408 merges. */
export const BASE = '2bba2a505170a0dfeec9e5f35b9bccbd39d1667d';
export type Crate = 'deep-hook' | 'deep-app' | 'deep-replica';
/** Every bin target each crate has at the base (its Cargo.toml and src/main.rs), all built on this platform. */
export const BINS: Record<Crate, string[]> = {
  'deep-hook': ['deep-hook'],
  'deep-app': ['deep-app'],
  'deep-replica': ['deep-replica', 'deep-replica-canvas', 'deep-drive', 'deep-live'],
};
/** A gpui release build under load takes tens of minutes; this is what one cargo call is allowed. */
export const BUILD_MS = 3 * 60 * 60_000;
const OWN = join(REPO, 'target', 'acceptance-1408');
const CARGO = [join(homedir(), '.cargo/bin/cargo')].find(existsSync) ?? 'cargo';
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };

export interface Ran { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export function run(cmd: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: o.cwd ?? REPO, env: o.env ?? CARGO_ENV, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? BUILD_MS);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${e.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
/** Home paths out of what a failure message carries (AGENTS.md: no personal data in evidence). */
export const redact = (text: string): string => text.replaceAll(homedir(), '~');
const tail = (r: Ran): string => redact(r.stderr.slice(-1500));

/** The message a judgement throws, or null when it holds: a wrong program's test expects it to throw. */
export async function failureOf(judge: () => unknown): Promise<string | null> {
  try { await judge(); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}

// ---- Builds, each cargo call made once per test file.
const once = new Map<string, Promise<Ran>>();
export function cargo(args: string[], cwd = REPO): Promise<Ran> {
  const key = `${cwd} ${args.join(' ')}`;
  if (!once.has(key)) once.set(key, run(CARGO, ['build', ...args], { cwd }));
  return once.get(key)!;
}
/** `cargo build --locked --release -p <crate>` (every bin) into target/acceptance-1408/release; returns that folder. */
export async function releaseBuild(crate: Crate): Promise<string> {
  const dir = join(OWN, 'release');
  const r = await cargo(['--locked', '--release', '-p', crate, '--target-dir', dir]);
  if (r.timedOut) throw Error(`INCONCLUSIVE: the release build of ${crate} didn't finish in ${BUILD_MS / 60_000} minutes; this is not a pass`);
  if (r.code !== 0) throw Error(`BLOCKED: the release build of ${crate} failed (exit ${r.code}): ${tail(r)}`);
  return join(dir, 'release');
}
/** The release build with the plant feature on, into target/acceptance-1408/refused (or the merge base's), as cargo ran it. */
export function refusedBuild(crate: Crate, base = false): Promise<Ran> {
  const src = base ? baseWorkspace() : REPO;
  const dir = base ? join(src, 'target') : join(OWN, 'refused');
  return cargo([base ? '--offline' : '--locked', '--release', '--features', FEATURE, '-p', crate, '--target-dir', dir], src);
}
/** deep-hook built for tests (debug) with the plant feature, into target/acceptance-1408/env-plants. */
export async function plantedHook(): Promise<string> {
  const dir = join(OWN, FEATURE);
  const r = await cargo(['--locked', '-q', '-p', 'deep-hook', '--features', FEATURE, '--target-dir', dir]);
  if (r.code !== 0) throw Error(`BLOCKED: deep-hook with --features ${FEATURE} did not build (exit ${r.code}${r.timedOut ? ', timed out' : ''}): ${tail(r)}`);
  return join(dir, 'debug', 'deep-hook');
}
/**
 * The pinned merge base's deep-hook (the wrong program of AC1 and AC2): crates/deep-hook and crates/deep-contracts
 * (its only dependency; neither has a crate from outside the repo) taken from BASE with `git archive` into a
 * workspace of their own under target/acceptance-1408/base. Returns that workspace.
 */
export function baseWorkspace(): string {
  const src = join(OWN, 'base', BASE.slice(0, 12));
  if (existsSync(join(src, 'Cargo.toml'))) return src;
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const tar = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', BASE, 'crates/deep-hook', 'crates/deep-contracts'], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', src], { input: tar });
  writeFileSync(join(src, 'Cargo.toml'), '[workspace]\nmembers = ["crates/deep-contracts", "crates/deep-hook"]\nresolver = "2"\n');
  return src;
}
export async function baseReleaseHook(): Promise<string> {
  const src = baseWorkspace();
  const r = await cargo(['--offline', '--release', '-q', '-p', 'deep-hook', '--target-dir', join(src, 'target')], src);
  if (r.code !== 0) throw Error(`BLOCKED: the merge base's deep-hook did not build (exit ${r.code}): ${tail(r)}`);
  return join(src, 'target', 'release', 'deep-hook');
}

// ---- Judges: each throws naming what fails the criterion, and holds otherwise.
/** AC1: the binary exists and holds neither string, by a byte search of the whole file. */
export function judgeBytes(binary: string, name: string): void {
  if (!existsSync(binary)) throw Error(`BLOCKED: no release binary ${name} at ${redact(binary)} after its crate's build`);
  const bytes = readFileSync(binary);
  const held = STRINGS.filter((s) => bytes.includes(Buffer.from(s)));
  if (held.length) throw Error(`the release binary ${name} holds ${held.join(' and ')} (byte search of ${redact(binary)}, ${bytes.length} bytes)`);
}
/** Cargo refusing the feature itself: the crate has no such feature, so nothing was refused at compile time. */
const NO_FEATURE = /does not (contain|have) (this|the) feature|none of the selected packages contains? (this|these) features?|unknown feature/i;
/** AC2: the build exits non-zero on a compile error whose message names the feature, not on cargo's feature check. */
export function judgeRefused(r: Ran, crate: Crate): void {
  if (r.timedOut) throw Error(`INCONCLUSIVE: the release build of ${crate} with --features ${FEATURE} timed out; this is not a pass`);
  if (r.code === 0) throw Error(`the release build of ${crate} with --features ${FEATURE} compiled (exit 0); it must fail to compile, naming ${FEATURE}`);
  if (NO_FEATURE.test(r.stderr)) throw Error(`the release build of ${crate} with --features ${FEATURE} failed only because cargo found no such feature, not on a compile error naming it: ${tail(r)}`);
  const named = r.stderr.split('\n').some((l) => /^error(\[E\d+\])?:/.test(l) && l.includes(FEATURE));
  if (!named || !/could not compile `/.test(r.stderr)) throw Error(`the release build of ${crate} with --features ${FEATURE} failed (exit ${r.code}), but on no compile error naming ${FEATURE}: ${tail(r)}`);
}

// ---- deep-hook as a PreToolUse entry runs it, with no hub: the line it spools is what it decided to send.
/** The heavy field deep-hook spools for a Claude Code Bash call of `command`, with DEEP_HUB_PLANT `plant` or none. */
export async function spooledHeavy(binary: string, command: string, plant?: string): Promise<{ heavy: unknown; line: string }> {
  const home = realpathSync(mkdtempSync('/tmp/dh1408-'));
  try {
    const cwd = join(home, 'w');
    mkdirSync(cwd);
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: home, LC_ALL: 'C', ...(plant ? { DEEP_HUB_PLANT: plant } : {}) };
    const session = `s1408-${process.pid}`;
    const payload = { hook_event_name: 'PreToolUse', session_id: session, tool_name: 'Bash', tool_input: { command }, cwd };
    const r = await run(binary, ['claude', 'PreToolUse'], { env, input: JSON.stringify(payload), timeoutMs: 60_000 });
    const spool = join(home, '.deepbuild', 'spool', 'spool.jsonl');
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const line = existsSync(spool) ? readFileSync(spool, 'utf8').split('\n').find((l) => l.includes(session)) : undefined;
      if (line) return { heavy: (JSON.parse(line) as { heavy?: unknown }).heavy, line: redact(line.replaceAll(home, '<home>')) };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error(`BLOCKED: deep-hook spooled no line for the call (exit ${r.code}, stderr ${JSON.stringify(redact(r.stderr.slice(0, 400)))})`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
export const FOCUSED = 'cargo test -p x';
/** AC3's judge: with DEEP_HUB_PLANT=leases-every-cargo, the focused call is spooled leased as `cargo`; without, not. */
export async function judgePlanted(binary: string, name: string): Promise<void> {
  const planted = await spooledHeavy(binary, FOCUSED, 'leases-every-cargo');
  const h = planted.heavy as { name?: unknown; form?: unknown } | undefined;
  if (h?.name !== 'cargo' || !String(h.form).startsWith('deep lease')) {
    throw Error(`${name} with DEEP_HUB_PLANT=leases-every-cargo didn't spool \`${FOCUSED}\` as heavy cargo to run under deep lease, so the plant isn't selectable: ${planted.line}`);
  }
  const plain = await spooledHeavy(binary, FOCUSED);
  if (plain.heavy !== undefined) throw Error(`${name} spools \`${FOCUSED}\` as heavy with no plant set, so the plant isn't what made it heavy: ${plain.line}`);
}
