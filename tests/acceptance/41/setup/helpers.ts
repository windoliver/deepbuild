// Test-side tools for #41's setup criteria (AC3, AC10): temp homes with stand-ins for launchd, systemctl, claude, codex
// and your login shell; loggers for gh and git first on PATH; `deep setup` and `deep setup --undo` through the built CLI;
// snapshots of folders. Adapted from tests/acceptance/19/setup/helpers.ts (same repo, same license); this suite keeps
// its own copy so a redraft there never moves these tests. Nothing here stands in for DeepBuild: every test reaches it
// through the CLI and the files under the temporary home.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;
export const AC3 = 'AC3 #41.8ef78e02';
export const AC10 = 'AC10 #41.efef0e11';
const COVERED = (() => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
/** The git this machine has, found on the PATH the suite started with: the logger passes every call through to it. */
export const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; }
};
export const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** The login service is stood in for as launchd; elsewhere setup would reach the real service manager, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: these tests stand in for launchd, the login service on macOS; on ${process.platform} setup would reach the real service manager`);
}

// ---- Temp folders under /tmp: a Unix socket path must fit in 104 bytes on macOS. Processes stopped by PID only.
const made: string[] = [];
const owned = new Set<number>();
const own = (pid: number | undefined | null): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}

/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with `launchctl`
 * (the launchd stand-in, fixtures/launchd.mjs), `systemctl`, `claude` and `codex` (each logs to `<tmp>/bin/calls.log`
 * and exits 0), `sh-login` (your login shell, whose PATH is `<tmp>/bin` first), and:
 * - `gh`: logs each call to `<tmp>/bin/gh.log` (cwd, then each argument in brackets) and exits 0 printing nothing; it
 *   never reaches GitHub;
 * - `git`: logs each call to `<tmp>/bin/git.log` the same way, then runs the machine's git with the same arguments.
 * `<tmp>/confirm` holds `confirmed`: the OS confirmation stubbed through DEEP_HUB_TEST_CONFIRM, as #19's suite does.
 */
export interface Home { tmp: string; home: string; bin: string }
const homes: Home[] = [];
export function makeHome(): Home {
  const tmp = realpathSync(mkdtempSync('/tmp/dh41s-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  for (const name of ['systemctl', 'claude', 'codex']) {
    copyFileSync(join(FIXTURES, 'stub-bin.sh'), join(bin, name));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  script('launchctl', `#!/bin/sh\nprintf 'launchctl %s\\n' "$*" >> '${bin}/calls.log'\nexec '${NODE}' '${join(FIXTURES, 'launchd.mjs')}' '${join(bin, 'launchd')}' "$@"\n`);
  script('deep', `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  const logLine = (log: string) => `{ printf '%s\\t' "$PWD"; for a in "$@"; do printf '[%s] ' "$a"; done; printf '\\n'; } >> '${join(bin, log)}'`;
  script('gh', `#!/bin/sh\n${logLine('gh.log')}\nexit 0\n`);
  script('git', `#!/bin/sh\n${logLine('git.log')}\nexec '${REAL_GIT}' "$@"\n`);
  script('sh-login', [
    '#!/bin/sh',
    '# Your login shell, as setup reads it: the PATH a login shell sets is this one. Login and interactive flags are',
    '# dropped, so no profile of the machine running the tests is read.',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const h = { tmp, home, bin };
  homes.push(h);
  return h;
}
const rootOf = (home: string) => join(home, '.deepbuild');
export const claudeSettings = (home: string) => join(home, '.claude', 'settings.json');
export const codexHooks = (home: string) => join(home, '.codex', 'hooks.json');
export const codexConfig = (home: string) => join(home, '.codex', 'config.toml');

/** One logged call of a stand-in: the folder it ran in and its arguments. */
export interface Call { cwd: string; args: string[] }
export function calls(h: Home, log: 'gh.log' | 'git.log'): Call[] {
  const file = join(h.bin, log);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return { cwd: line.slice(0, tab), args: [...line.slice(tab + 1).matchAll(/\[([\s\S]*?)\] /g)].map((m) => m[1]!) };
  });
}

/** Stops every process this suite started, the launchd stand-in's jobs included (SIGTERM, then SIGKILL after 3 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const h of homes.splice(0)) {
    const file = join(h.bin, 'launchd', 'started.pids');
    if (existsSync(file)) for (const pid of readFileSync(file, 'utf8').split('\n').map(Number)) if (pid > 0) own(pid);
  }
  for (const pid of owned) { try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ } }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, no DEEP_, XDG_, CLAUDE*, CODEX*, GIT_, GH_, GITHUB_ or billing variable of this process's. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|GH_|GITHUB_|ANTHROPIC_|OPENAI_|AWS_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: h.home, XDG_CONFIG_HOME: join(h.home, '.config'), XDG_CACHE_HOME: join(h.home, '.cache'), SHELL: join(h.bin, 'sh-login'),
    PATH: `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: 'C', DEEP_HUB_TEST_CONFIRM: join(h.tmp, 'confirm'),
  });
  for (const [key, value] of Object.entries(extra)) { if (value === undefined) delete env[key]; else env[key] = value; }
  return env;
}

export interface Ran { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd ?? '/tmp', env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

let build: Promise<void> | undefined;
/** deep-hook built, as setup names it in the entries it writes. */
function cargoBuild(): Promise<void> {
  build ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  });
  return build;
}
/** `deep <args>` from the built CLI, HOME the test's home, in `cwd` (the temp folder by default, never this checkout). */
export async function deep(h: Home, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Ran> {
  await cargoBuild();
  return run(NODE, [CLI, ...args], { env: childEnv(h, o.env), cwd: o.cwd ?? h.tmp, timeoutMs: 180_000 });
}
/** `deep setup`, insisting on exit 0, then the hub its login service started answering (the control: setup really ran to its end). */
export async function setup(h: Home, o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Ran> {
  const r = await deep(h, ['setup'], o);
  if (r.code !== 0) expect.fail(`deep setup must exit 0 and install DeepBuild: ${shown(r)}`);
  const socket = join(rootOf(h.home), 'hub.sock');
  const deadline = Date.now() + 30_000;
  while (!(await answers(socket))) {
    if (Date.now() > deadline) expect.fail(`deep setup must start the hub through its login service: no hub answers at ${socket}`);
    await sleep(200);
  }
  return r;
}
/** `deep setup --undo`, the OS confirmation stubbed `confirmed`, insisting on exit 0. */
export async function undo(h: Home, o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Ran> {
  const r = await deep(h, ['setup', '--undo'], o);
  if (r.code !== 0) expect.fail(`deep setup --undo, confirmed, must exit 0: ${shown(r)}`);
  return r;
}
function answers(path: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(path);
    const done = (v: boolean) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { if (d.includes('\n')) done(true); });
    sock.on('error', () => done(false));
  });
}

// ---- Snapshots.
/** Every entry under `dir` that `keep` counts, as one comparable line each: its type, and a file's SHA-256 and mode, a link's target. */
export function snapshot(dir: string, keep: (rel: string) => boolean = () => true): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = relative(dir, path);
      if (!keep(rel)) continue;
      const s = lstatSync(path);
      if (s.isSymbolicLink()) out.set(rel, `link -> ${readlinkSync(path)}`);
      else if (s.isDirectory()) { out.set(rel, 'dir'); walk(path); }
      else out.set(rel, `file ${sha(readFileSync(path))} mode ${(s.mode & 0o7777).toString(8)}`);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
/** What differs between two snapshots, one line per path. */
export function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [path, was] of before) {
    const now = after.get(path);
    if (now === undefined) out.push(`${path} removed (was ${was})`);
    else if (now !== was) out.push(`${path} changed (was ${was}, now ${now})`);
  }
  for (const [path, now] of after) if (!before.has(path)) out.push(`${path} added (${now})`);
  return out;
}
/** Where two byte strings first differ, with a little of each around it. */
export function firstDifference(was: Buffer, now: Buffer): string {
  let i = 0;
  while (i < was.length && i < now.length && was[i] === now[i]) i++;
  const around = (b: Buffer) => JSON.stringify(b.subarray(Math.max(0, i - 40), i + 80).toString('utf8'));
  return `${was.length} bytes before, ${now.length} now; first difference at byte ${i}: was ${around(was)}, now ${around(now)}`;
}
