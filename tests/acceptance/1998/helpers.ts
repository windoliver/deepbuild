// Test-side tools for #1998's acceptance tests (README): a temp home set up by the real `deep setup` (stand-ins for
// launchd, systemctl, claude and codex first on PATH, as #41's setup suite has them), the hub's socket as the CLI and
// the app reach it, the box's one method, `deep inbox answer`, git repos holding a spec, and byte snapshots. Adapted
// from tests/acceptance/41/setup/helpers.ts and tests/acceptance/148/helpers.ts (same repo, same license); this suite
// keeps its own copy so a redraft there never moves these tests. Nothing here stands in for DeepBuild: every test
// reaches it through the CLI, the hub's socket and the files under the temporary home.
//
// Safety: every folder is under /tmp/dh1998-*; HOME is a temp folder for every process started, so no real ~/.claude,
// ~/.codex, ~/.deepbuild or ~/Library is read or written; no child inherits this process's DEEP_*, CLAUDE*, CODEX*,
// XDG_*, GIT_*, GH_* or billing keys; every process is stopped by its PID, never by name or port. No agent runs: the
// claude and codex on PATH are stubs that log their arguments and exit 0, so nothing can call a model.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const NODE = process.execPath;

/** The criteria's IDs, as scripts/proof-change.mjs computes them from the issue's text (README, Criterion to tests). */
export const ID = {
  ac1: 'AC1 #1998.97e49eef',
  ac2: 'AC2 #1998.c62f2117',
  ac3: 'AC3 #1998.376621f1',
  ac4: 'AC4 #1998.f21e951e',
} as const;

const COVERED = (() => { const v = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
/** The git this machine has, found on the PATH the suite started with. */
export const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export const parseObject = (raw: string): Line | undefined => {
  try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; }
};
export async function waitFor<T>(probe: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms: number, every = 200): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const v = await probe();
      if (v !== undefined && v !== null && v !== false) return v as T;
    } catch { /* not yet */ }
    if (Date.now() > deadline) return undefined;
    await sleep(every);
  }
}

/** The login service is stood in for as launchd; elsewhere setup would reach the real service manager, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: these tests stand in for launchd, the login service on macOS; on ${process.platform} setup would reach the real service manager`);
}

// ---- Temp folders under /tmp: a Unix socket path must fit in 104 bytes on macOS. Processes stopped by PID only.
const made: string[] = [];
const owned = new Set<number>();
export const own = (pid: number | undefined | null): void => { if (pid) owned.add(pid); };
function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  try { return !/Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh1998${tag}-`));
  made.push(dir);
  return dir;
}

/**
 * A fresh home: `<tmp>/h` is HOME for every process a test starts. `<tmp>/bin` comes first on PATH with `launchctl`
 * (the launchd stand-in, fixtures/launchd.mjs), `systemctl`, `claude` and `codex` (each logs to `<tmp>/bin/calls.log`
 * and exits 0), `sh-login` (your login shell), `gh` (logs, exits 0, never reaches GitHub) and `git` (logs, then runs
 * the machine's git). `<tmp>/confirm` holds `confirmed`: the OS confirmation stubbed through DEEP_HUB_TEST_CONFIRM, as
 * #19's and #41's suites do. `<tmp>/work` holds the repos a test makes.
 */
export interface Home { tmp: string; home: string; bin: string; work: string }
const homes: Home[] = [];
export function makeHome(): Home {
  const tmp = tempDir('');
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const work = join(tmp, 'work');
  for (const d of [home, bin, work]) mkdirSync(d, { recursive: true });
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
  const h = { tmp, home, bin, work };
  homes.push(h);
  return h;
}
export const rootOf = (h: Home) => join(h.home, '.deepbuild');
export const claudeSettings = (h: Home) => join(h.home, '.claude', 'settings.json');
export const codexDir = (h: Home) => join(h.home, '.codex');
export const codexHooks = (h: Home) => join(codexDir(h), 'hooks.json');
export const codexConfig = (h: Home) => join(codexDir(h), 'config.toml');
/** Codex as you have it before install: setup adds DeepBuild to Codex only where ~/.codex exists. */
export function withCodex(h: Home): void {
  mkdirSync(codexDir(h), { recursive: true });
  writeFileSync(codexConfig(h), '# my codex settings\nmodel = "gpt-5.5"\n');
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

/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, none of this process's DEEP_, XDG_, CLAUDE*, CODEX*, GIT_, GH_ or billing variables. */
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
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${e.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

let build: Promise<void> | undefined;
/** deep-hook built, as setup names it in the entries it writes; cargo must be on PATH (README, How to run). */
function cargoBuild(): Promise<void> {
  build ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, timeoutMs: 1_200_000, env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' } }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  });
  return build;
}
/** `deep <args>` from the built CLI, HOME the test's home, in `cwd` (the temp folder by default, never this checkout). */
export async function deep(h: Home, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<Ran> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI isn't built at ${CLI} (npm run build --workspaces)`);
  await cargoBuild();
  return run(NODE, [CLI, ...args], { env: childEnv(h, o.env), cwd: o.cwd ?? h.tmp, timeoutMs: 180_000 });
}
/**
 * `deep setup`, insisting on exit 0, then the hub its login service started answering (the control: setup really ran
 * to its end). `plant` reaches the hub through setup's environment, which the launchd stand-in passes on.
 */
export async function setup(h: Home, plant?: string): Promise<Ran> {
  onMac();
  const r = await deep(h, ['setup'], { env: { DEEP_HUB_PLANT: plant } });
  if (r.code !== 0) expect.fail(`${plant ? `BLOCKED: with DEEP_HUB_PLANT=${plant}, ` : ''}deep setup must exit 0 and install DeepBuild: ${shown(r)}`);
  const socket = join(rootOf(h), 'hub.sock');
  const answered = await waitFor(() => answers(socket), 30_000);
  if (!answered) expect.fail(`deep setup must start the hub through its login service: no hub answers at ${socket}`);
  return r;
}
/** `deep setup --undo`, the OS confirmation stubbed `confirmed`, insisting on exit 0. */
export async function undo(h: Home): Promise<Ran> {
  const r = await deep(h, ['setup', '--undo']);
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

// ---- The hub, as the CLI and the app reach it: its socket, the control token, one call per connection.
export type Reply = { result: Line } | { error: Line };
export function call(h: Home, method: string, params: Line = {}, timeoutMs = 60_000): Promise<Reply> {
  const socket = join(rootOf(h), 'hub.sock');
  const token = readFileSync(join(rootOf(h), 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          resolve(line.error ? { error: line.error as Line } : { result: (line.result ?? {}) as Line });
        }
      }
    });
  });
}

/**
 * The box (README, Pinned 1): your words, and the checkout they're about when they name a repo, given to `box.say`.
 * Its `ask` is the proposed change's handle. A refusal, or a reply with no ask, fails the test naming the words.
 */
export async function say(h: Home, words: string, repo?: string): Promise<string> {
  const reply = await call(h, 'box.say', repo === undefined ? { words } : { words, repo });
  if ('error' in reply) expect.fail(`box.say ${JSON.stringify(words)}${repo ? ` (repo ${repo})` : ''} must come back as a proposed change you approve; it was refused: ${JSON.stringify(reply.error).slice(0, 800)}`);
  const ask = reply.result.ask;
  if (typeof ask !== 'string' || !/^ask:[0-9A-Za-z]+$/.test(ask)) expect.fail(`box.say ${JSON.stringify(words)} must return the proposed change's ask as ask:<id>; it returned ${JSON.stringify(reply.result).slice(0, 800)}`);
  return ask;
}
export interface Row { ask: string; kind: string; status: string; outcome: string; question: string; options: string[] }
/** Every ask the hub holds, as `deep inbox` reads them. */
export async function inbox(h: Home): Promise<Row[]> {
  const reply = await call(h, 'inbox.read', {});
  if ('error' in reply) expect.fail(`inbox.read refused: ${JSON.stringify(reply.error)}`);
  return (reply.result.asks ?? []) as Row[];
}
export const isOpen = (r: Row | undefined): boolean => r !== undefined && r.status !== 'closed';
/** `deep inbox answer <ask> <option>` in your terminal, the OS confirming you; its exit and output are returned, not judged. */
export function answer(h: Home, ask: string, option = 'apply'): Promise<Ran> {
  return deep(h, ['inbox', 'answer', ask, option]);
}

// ---- Repos with a spec, in the home's work folder.
const git = (dir: string, args: string[]): string => execFileSync(REAL_GIT, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dirname(dir), LC_ALL: 'C' } }).trim();
export interface Repo { dir: string; spec: string; head(): string; commit(text: string, message: string): string; status(): string }
/** A repo named `name` on branch main, its `.deepbuild/done.yaml` holding `spec`, committed. */
export function makeRepo(h: Home, name: string, spec: string): Repo {
  const dir = join(h.work, name);
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, private: true, scripts: { lint: 'true', typecheck: 'true', test: 'true', e2e: 'true' } }, null, 2)}\n`);
  const file = join(dir, '.deepbuild', 'done.yaml');
  const repo: Repo = {
    dir,
    spec: file,
    head: () => git(dir, ['rev-parse', 'HEAD']),
    commit(text: string, message: string) {
      writeFileSync(file, text);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', message]);
      return repo.head();
    },
    status: () => git(dir, ['status', '--porcelain']),
  };
  repo.commit(spec, 'The spec');
  return repo;
}

// ---- Snapshots.
/** Every entry under `dir`, as one comparable line each: its type, and a file's SHA-256, a link's target. */
export function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = relative(dir, path);
      const s = lstatSync(path);
      if (s.isSymbolicLink()) out.set(rel, `link -> ${readlinkSync(path)}`);
      else if (s.isDirectory()) { out.set(rel, 'dir'); walk(path); }
      else out.set(rel, `file ${sha(readFileSync(path))}`);
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
    else if (now !== was) out.push(`${path} changed`);
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
export const bytesOf = (file: string): Buffer | null => (existsSync(file) ? readFileSync(file) : null);
