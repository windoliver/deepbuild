// Shared test-side tools for issue #668's checkpoint (README): a temporary home whose Claude Code user settings hold one
// hook of the person's own, with stand-ins for launchd, systemctl, `claude` (or a link to the real one, live) and the
// login shell; the checkout-web fixture repo; `deep setup`, `deep status`, `deep doctor`, `deep off`, `deep on` and
// `deep setup --undo` through the built CLI; the hub's socket; the Claude Code stand-in (fixtures/claude-code.mjs, #18's
// and #19's); the agent test harness as a process; the check each criterion runs; and the proof files. Parts are
// adapted from tests/acceptance/19/setup/helpers.ts, tests/acceptance/19/authority/helpers.ts and
// tests/acceptance/666/helpers.ts (same repo, same license); this suite keeps its own copy so a redraft of theirs
// never moves these tests. Nothing here stands in for DeepBuild: every test reaches it through the CLI, deep-hook as
// the settings run it, the hub's socket and the files under the temporary home.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { cpus, loadavg, tmpdir, totalmem } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const HARNESS = join(REPO, 'scripts/agent-harness.mjs');
export const NODE = process.execPath;
export const PROOF_DIR = join(tmpdir(), 'deep-668-proof');

/** Each criterion's ID: #668.<first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed, "- [ ] " dropped>. */
export const AC1 = '#668.f5be25d4';
export const AC2 = '#668.c478c854';
export const AC3 = '#668.96a6fd85';
export const AC4 = '#668.3ee80c65';
export const AC5 = '#668.e1e1081d';
export const AC6 = '#668.882ded0d';

/** The harness scenario the live session runs (README: Additions), and the prompt it types, word for word. */
export const SCENARIO = 'fix-checkout-test';
export const COMMIT_MESSAGE = 'Fix the cart total';
export const PROMPT = `Run the checkout tests once with \`node --test\`; they fail. Fix the bug in src/cart.js, run \`node --test\` again to see them pass, then commit the fix with \`git commit -am "${COMMIT_MESSAGE}"\`.`;
/** The planted status the issue's Proof names (README: Additions). */
export const STATUS_PLANT = 'status-omits-commit';
/** Your own gate (README, AC5): a block entry, not fail_closed, so only the hub enforces it and `deep off` makes it watch-only. */
export const YOUR_GATE = 'yours-no-make-release';
export const YOUR_GATE_COMMAND = 'make release';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
/** The newest Claude Code version the facts cover: the version the fast session's transcript and the `claude` stand-in carry. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
/** A lazily made value, shared by the tests that need it; a failure fails each of them with the same reason. */
export function shared<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}

// ---- Temp folders. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh668-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started. Stopped by PID only, never by name or port.
const owned = new Set<number>();
export function own(pid: number | undefined | null): void {
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
const homes: Home[] = [];
/** Every PID the launchd stand-in started for a home: the hubs setup's login service started. */
export function launchedPids(h: Home): number[] {
  const file = join(h.bin, 'launchd', 'started.pids');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').map(Number).filter((n) => n > 0) : [];
}
/** Stops every process this suite started, the launchd stand-in's jobs included (SIGTERM, then SIGKILL after 5 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const h of homes.splice(0)) for (const pid of launchedPids(h)) own(pid);
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) {
    if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The temporary home (README: The temporary home).
export interface Home {
  tmp: string; home: string; bin: string; root: string;
  /** Claude Code's user settings, `<home>/.claude/settings.json`, and Claude Code's own state, `<home>/.claude.json`. */
  settings: string; claudeJson: string;
  /** Your own hook's script and the log it appends each payload it gets to. */
  myHook: string; myLog: string;
  /** The OS confirmation's seam file (#24), the Keychain stand-in (#19) and, in the fast tests, the managed settings path (#19). */
  confirm: string; keychain: string;
  /** Set on every process the test starts. */
  env: Record<string, string>;
  /** The `claude` the session and the doctor run: the stand-in, or a link to the real one. */
  claude: string;
}
/**
 * Your Claude Code user settings before DeepBuild, as a person writes them by hand: tabs, a space before a colon, a \u
 * escape, your keys in your order and no newline at the end, so only the original bytes put back read the same. It
 * holds one hook of your own: every tool call that ran is appended to your log.
 */
export const mySettings = (hook: string): string => `{
\t"$schema": "https://json.schemastore.org/claude-code-settings.json",
\t"env" : {"MY_FLAG": "1", "GREETING": "caf\\u00e9"},
\t"hooks": {
\t\t"PostToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": ${JSON.stringify(`'${hook}'`)}, "timeout": 10 } ] } ]
\t}
}`;
/**
 * A fresh home. `<tmp>/h` is HOME for every process a test starts; `<tmp>/bin` comes first on PATH with `launchctl`
 * (the launchd stand-in, fixtures/launchd.mjs), `systemctl` (logs, exits 0), `claude` (the stand-in, or a link to the
 * real binary with `claude` given), `sh-login` (your login shell, SHELL, whose PATH is this one) and `deep` (the
 * built CLI). Your settings, your hook's script and Claude Code's own state (first-run screens done) are written now.
 */
export function makeHome(o: { claude?: string; fast?: boolean } = {}): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  script('launchctl', `#!/bin/sh\nprintf 'launchctl %s\\n' "$*" >> '${bin}/calls.log'\nexec '${NODE}' '${join(FIXTURES, 'launchd.mjs')}' '${join(bin, 'launchd')}' "$@"\n`);
  script('systemctl', `#!/bin/sh\nprintf 'systemctl %s\\n' "$*" >> '${bin}/calls.log'\nexit 0\n`);
  script('deep', `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`);
  script('sh-login', [
    '#!/bin/sh',
    '# Your login shell, as setup reads it: the PATH a login shell sets is this one. Login and interactive flags are',
    '# dropped, so no profile of the machine running the tests is read.',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  if (o.claude) symlinkSync(o.claude, join(bin, 'claude'));
  else {
    copyFileSync(join(FIXTURES, 'claude.sh'), join(bin, 'claude'));
    chmodSync(join(bin, 'claude'), 0o755);
    writeFileSync(join(bin, 'claude.version'), `${COVERED}\n`);
  }
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  // The Keychain stood in for (#19's seam): a sign-in whose token outlives any run, with no secret in it.
  const keychain = join(tmp, 'keychain.json');
  writeFileSync(keychain, JSON.stringify({ 'Claude Code-credentials': JSON.stringify({ claudeAiOauth: { expiresAt: Date.UTC(2099, 0, 1) } }) }));
  const myHook = join(home, '.local', 'bin', 'my-hook');
  const myLog = join(home, 'my-hook.log');
  mkdirSync(dirname(myHook), { recursive: true });
  writeFileSync(myHook, `#!/bin/sh\n# My own hook: a line for every tool call that ran.\ncat >> '${myLog}'\necho >> '${myLog}'\n`);
  chmodSync(myHook, 0o755);
  const settings = join(home, '.claude', 'settings.json');
  writeFileSync(settings, mySettings(myHook));
  // Claude Code's own state in this home: its first-run screens are done (the person has used it before).
  const claudeJson = join(home, '.claude.json');
  writeFileSync(claudeJson, `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', numStartups: 3 }, null, 2)}\n`);
  const env: Record<string, string> = { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_KEYCHAIN: keychain };
  if (o.fast) env.DEEP_HUB_TEST_MANAGED_SETTINGS = join(tmp, 'no-managed-settings.json');
  const h: Home = { tmp, home, bin, root: join(home, '.deepbuild'), settings, claudeJson, myHook, myLog, confirm, keychain, env, claude: join(bin, 'claude') };
  homes.push(h);
  return h;
}

/** Variables that make an agent bill an API account or sign it in; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, the home's seams; no DEEP_, CLAUDE*, CODEX*, GIT_, OTEL_ or billing variable of this process's. */
export function childEnv(h: Home, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|OTEL_|npm_)/.test(key) || key === 'NODE_OPTIONS' || key === 'AI_AGENT' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = h.home;
  env.XDG_CONFIG_HOME = join(h.home, '.config');
  env.XDG_CACHE_HOME = join(h.home, '.cache');
  env.SHELL = join(h.bin, 'sh-login');
  env.PATH = `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  for (const [key, value] of Object.entries({ ...h.env, ...extra })) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface Ran { command: string; code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; startedMs: number; endedMs: number; timedOut: boolean }
/** Runs a command to its end without blocking this process's event loop. */
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; input?: string; timeoutMs?: number; shownAs?: string } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const startedMs = Date.now();
    const child = spawn(command, args, { cwd: o.cwd ?? '/tmp', env: o.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ command: o.shownAs ?? [command, ...args].join(' '), code, signal, stdout, stderr, startedMs, endedMs: Date.now(), timedOut }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(o.input ?? '');
  });
}
export const shown = (r: Ran) => `\`${r.command}\` exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 2500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
/** A command's terminal output as the proof keeps it. */
export const terminal = (r: Ran) => `$ ${r.command}\n${r.stdout}${r.stderr ? `${r.stderr}` : ''}(exit ${r.code}${r.signal ? `, ${r.signal}` : ''}${r.timedOut ? ', killed at the timeout' : ''})\n`;
/** `deep <args>` from the built CLI, HOME the test's home, in `cwd` (the temp folder by default, never this checkout). */
export function deep(h: Home, args: readonly string[], o: { env?: Record<string, string | undefined>; cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(h, o.env), cwd: o.cwd ?? h.tmp, timeoutMs: o.timeoutMs ?? 180_000, shownAs: `deep ${args.join(' ')}` });
}

// ---- deep-hook: setup's entries run the newest of target/{release,debug}/deep-hook (#18).
let build: Promise<void> | undefined;
export function cargoBuild(): Promise<void> {
  build ??= run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, timeoutMs: 1_200_000 }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  });
  return build;
}

// ---- The fixture repo (README: The fixture repo).
export interface Repo { dir: string; base: string; tripwire: string; repoSettings: string[] }
export function git(h: Home, dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, env: childEnv(h, { GIT_CONFIG_NOSYSTEM: '1' }), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
/**
 * A fresh git checkout of checkout-web at `<tmp>/checkout-web`: two commits, the second adding the failing checkout
 * test; git's user and no signing set in the repo's own config, since the home has none. The repo's own
 * `.claude/settings.json` and `.claude/settings.local.json` each hold a hook that writes a tripwire file outside the
 * repo (written here, at run time: this repo keeps no hooks in any settings file), so a session that loads the
 * repo's own settings is seen, and a setup that writes into them changes their bytes. Git leaves `.claude/` alone.
 */
export function checkout(h: Home): Repo {
  const dir = join(h.tmp, 'checkout-web');
  cpSync(join(FIXTURES, 'checkout-web'), dir, { recursive: true });
  const g = (...args: string[]) => git(h, dir, ...args);
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Checkout Dev');
  g('config', 'user.email', 'checkout@example.invalid');
  g('config', 'commit.gpgsign', 'false');
  g('add', 'README.md', 'index.html', 'package.json', 'src');
  g('commit', '-q', '-m', 'Start the checkout page');
  g('add', 'test');
  g('commit', '-q', '-m', 'Add the checkout test');
  const tripwire = join(h.tmp, 'repo-settings-ran');
  const trip = { hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'].map((event) => [event, [{ hooks: [{ type: 'command', command: `echo ${event} >> '${tripwire}'` }] }]])) };
  mkdirSync(join(dir, '.claude'));
  const repoSettings = [join(dir, '.claude', 'settings.json'), join(dir, '.claude', 'settings.local.json')];
  for (const file of repoSettings) writeFileSync(file, `${JSON.stringify(trip, null, 2)}\n`);
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.claude/\n', { flag: 'a' });
  return { dir, base: g('rev-parse', 'HEAD'), tripwire, repoSettings };
}
/** The commits reachable from `to` and not from `from`, newest first, each with its subject. */
export function commitsBetween(h: Home, repo: Repo, from: string, to = 'HEAD'): { sha: string; subject: string }[] {
  const out = git(h, repo.dir, 'log', '--format=%H %s', `${from}..${to}`);
  return out ? out.split('\n').map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) })) : [];
}
/** Every commit in the repo, each with its subject. */
export const allCommits = (h: Home, repo: Repo) => {
  const out = git(h, repo.dir, 'log', '--all', '--format=%H %s');
  return out.split('\n').map((l) => ({ sha: l.slice(0, 40), subject: l.slice(41) }));
};
/** A commit you make by hand in the checkout after the session has ended, with no hook running: not the session's. */
export function handCommit(h: Home, repo: Repo): { sha: string; subject: string } {
  writeFileSync(join(repo.dir, 'README.md'), `${readFileSync(join(repo.dir, 'README.md'), 'utf8')}\nPayments go through the pay button only.\n`);
  git(h, repo.dir, 'commit', '-q', '-am', 'Note the pay button');
  return { sha: git(h, repo.dir, 'rev-parse', 'HEAD'), subject: 'Note the pay button' };
}
/**
 * Every entry under `dir` (git's own folder left out) as one comparable line each: its type, and a file's SHA-256 and
 * mode, a link's target. `keep` decides which paths (relative to `dir`) count.
 */
export function snapshot(dir: string, keep: (rel: string) => boolean = () => true): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = relative(dir, path);
      if (rel === '.git') continue;
      const s = lstatSync(path);
      if (keep(rel)) out.set(rel, s.isSymbolicLink() ? `link -> ${readlinkSync(path)}` : s.isDirectory() ? 'dir' : `file ${sha256(readFileSync(path))} mode ${(s.mode & 0o7777).toString(8)}`);
      if (s.isDirectory() && !s.isSymbolicLink()) walk(path);
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
    if (now === undefined) out.push(`${path} removed`);
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
  return `${was.length} bytes before setup, ${now.length} now; first difference at byte ${i}: was ${around(was)}, now ${around(now)}`;
}

// ---- The hub that setup's login service started, and its socket (#16's line protocol, a cli connection with the token).
export const socketOf = (h: Home) => join(h.root, 'hub.sock');
export function answers(path: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(path);
    const done = (v: boolean) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { if (d.includes('\n')) done(true); });
    sock.on('error', () => done(false));
  });
}
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, timeoutMs: number): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) return undefined;
    await sleep(200);
  }
}
/** Waits for a hub to answer at the installed socket; BLOCKED, naming what setup left, when none does. */
export async function hubUp(h: Home, timeoutMs = 30_000): Promise<void> {
  if (await waitFor(() => answers(socketOf(h)), timeoutMs)) return;
  throw Error(`BLOCKED: no hub answers at ${socketOf(h)} after deep setup; launchctl calls: ${existsSync(join(h.bin, 'calls.log')) ? readFileSync(join(h.bin, 'calls.log'), 'utf8').slice(-1500) : 'none'}`);
}
/** Stops the hub the login service started, by the PIDs the launchd stand-in recorded, and waits for its socket to go quiet. */
export async function stopHubByPid(h: Home): Promise<void> {
  for (const pid of launchedPids(h)) if (alive(pid)) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  if (!(await waitFor(async () => !(await answers(socketOf(h), 500)), 15_000))) throw Error(`BLOCKED: the hub at ${socketOf(h)} still answers after SIGTERM to the PIDs the login service started`);
}
export class Conn {
  private buffer = '';
  private readonly lines: Line[] = [];
  private wakers = new Set<() => void>();
  private ids = 0;
  ended = false;
  private constructor(readonly sock: net.Socket) {
    sock.setEncoding('utf8');
    sock.on('data', (chunk: string) => {
      this.buffer += chunk;
      let i: number;
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        this.lines.push(parseObject(this.buffer.slice(0, i)) ?? { unparsed: this.buffer.slice(0, i) });
        this.buffer = this.buffer.slice(i + 1);
      }
      for (const w of [...this.wakers]) w();
    });
    sock.on('error', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
    sock.on('close', () => { this.ended = true; for (const w of [...this.wakers]) w(); });
  }
  static open(path: string, timeoutMs = 5000): Promise<Conn> {
    return new Promise((resolve, reject) => {
      const conn = new Conn(net.connect(path));
      const timer = setTimeout(() => { conn.sock.destroy(); reject(Error(`no hello from the hub at ${path}`)); }, timeoutMs);
      const check = () => {
        if (conn.lines.length > 0) { clearTimeout(timer); conn.wakers.delete(check); resolve(conn); }
        else if (conn.ended) { clearTimeout(timer); conn.wakers.delete(check); reject(Error(`can't reach the hub at ${path}`)); }
      };
      conn.wakers.add(check);
    });
  }
  private wait(match: (line: Line) => boolean, from: number, timeoutMs: number): Promise<Line | undefined> {
    return new Promise((resolve) => {
      const done = (v: Line | undefined) => { clearTimeout(timer); this.wakers.delete(check); resolve(v); };
      const check = () => { const found = this.lines.slice(from).find(match); if (found) done(found); else if (this.ended) done(undefined); };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      this.wakers.add(check);
      check();
    });
  }
  async hello(token: string): Promise<void> {
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
    const reply = await this.wait((l) => 'role' in l || 'error' in l, from, 10_000);
    if (!reply || reply.role !== 'cli') throw Error(`BLOCKED: the hub refused the cli hello: ${JSON.stringify(reply)}`);
  }
  async call(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<Line> {
    const id = `${method}#${++this.ids}`;
    const from = this.lines.length;
    this.sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
    const reply = await this.wait((l) => l.id === id && ('result' in l || 'error' in l), from, timeoutMs);
    if (!reply) throw Error(`no reply to ${method} within ${timeoutMs} ms`);
    if ('error' in reply) throw Error(`${method} refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Line;
  }
  close(): void { this.sock.destroy(); }
}
async function control<T>(h: Home, use: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await Conn.open(socketOf(h));
  try {
    await conn.hello(readFileSync(join(h.root, 'control.token'), 'utf8').trim());
    return await use(conn);
  } finally {
    conn.close();
  }
}
/** An event as `events.read` serves it. */
export interface Ev { id: string; kind: string; ts: number; log_pos: number; session?: string; project?: string; data: Line; verified?: boolean }
/** Every event in the record, read from the hub through `events.read`, paged by `log_pos`. */
export function allEvents(h: Home): Promise<Ev[]> {
  return control(h, async (conn) => {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  });
}
/** The record's rows of the session: its sessions row, and its tool call and commit events (the proof's record.json). */
export async function recordRows(h: Home, session: string): Promise<Line> {
  const events = (await allEvents(h)).filter((e) => e.session === session);
  const sessions = await control(h, async (conn) => (await conn.call('sessions.read', {})).sessions as Line[]).catch((error: Error) => [{ unread: error.message }]);
  return {
    session: sessions.filter((s) => s.id === session || 'unread' in s),
    toolCalls: events.filter((e) => e.kind.startsWith('tool.')),
    commits: events.filter((e) => e.kind.startsWith('commit.')),
    events,
  };
}
/** The commits the record holds for a session: every `commit.*` event of it with a SHA (#18). */
export const recordedCommits = (events: readonly Ev[], session: string): string[] =>
  [...new Set(events.filter((e) => e.session === session && e.kind.startsWith('commit.') && typeof e.data?.sha === 'string').map((e) => String(e.data.sha)))];

// ---- The Claude Code stand-in (fixtures/claude-code.mjs, #18's): one process per session; it runs every entry of the
// user settings file for a hook, as Claude Code does, and runs Bash commands as its children.
export interface HookRun { command: string; async: boolean; code: number | null; signal: string | null; stdout: string; stderr: string; timedOut: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; settingsError?: string }
export class Claude {
  private n = 0;
  private readonly pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess, readonly h: Home) {
    child.on('exit', () => { for (const [n, done] of [...this.pending]) done({ n, failed: 'the Claude Code stand-in exited' }); });
    createInterface({ input: child.stdout! }).on('line', (raw) => {
      const line = parseObject(raw);
      if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
    });
  }
  static start(h: Home): Claude {
    const child = spawn(NODE, [join(FIXTURES, 'claude-code.mjs'), CLI, FACTS], { cwd: h.tmp, env: childEnv(h), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    return new Claude(child, h);
  }
  private send(command: Line, timeoutMs = 300_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the Claude Code stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the Claude Code stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  /** Fires one hook: every entry of the user settings file for it, as Claude Code runs them. */
  async hook(event: string, body: Line): Promise<Fired> {
    return (await this.send({ op: 'hook', event, payload: body, settings: this.h.settings })) as unknown as Fired;
  }
  /** A command as the Bash tool runs it: `/bin/sh -c`, a child of the session's process. */
  async exec(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return (await this.send({ op: 'exec', command, cwd })) as unknown as { code: number; stdout: string; stderr: string };
  }
  exit(): void {
    try { this.child.stdin!.end(); } catch { /* gone */ }
  }
}
/** Whether a command is DeepBuild's: it runs deep-hook or the deep CLI. */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string' && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command));
const ours = (f: Fired): HookRun[] => [...f.ran, ...f.background].filter((r) => isDeepBuild(r.command));
const firedShown = (f: Fired) => JSON.stringify(f.ran.map((r) => ({ command: r.command.slice(0, 120), code: r.code, stdout: r.stdout.slice(0, 300), stderr: r.stderr.slice(0, 300) })));
/** Whether DeepBuild's PreToolUse entry denied the call: exit 2, or a deny in its JSON (Claude Code reads either). */
const denied = (f: Fired): boolean => ours(f).filter((r) => !r.async).some((r) => r.code === 2 || /"permissionDecision"\s*:\s*"deny"/.test(r.stdout) || /"decision"\s*:\s*"block"/.test(r.stdout));

// ---- A made-up session's hook payloads and transcript, shaped like the corpus's Claude Code 2.1.308 `tools` session.
export interface Session { id: string; cwd: string; transcript: string; prompt?: string }
export interface Call { id: string; name: string; input: Line; failed: boolean }
export function newSession(h: Home, cwd: string): Session {
  const id = randomUUID();
  const transcript = join(h.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  return { id, cwd, transcript };
}
export const callId = () => `toolu_${randomBytes(12).toString('hex')}`;
export function payload(s: Session, event: string, extra: Line = {}): Line {
  const base: Line = { session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, hook_event_name: event, permission_mode: 'default' };
  if (s.prompt && event !== 'SessionStart') base.prompt_id = s.prompt;
  if (event === 'SessionStart') Object.assign(base, { source: 'startup', model: 'claude-haiku-5-5' });
  return { ...base, ...extra };
}
function appendTranscript(s: Session, entry: Line): void {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: s.id, cwd: s.cwd, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
  writeFileSync(s.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
}
export function typedPrompt(s: Session, text: string): void {
  s.prompt = randomUUID();
  appendTranscript(s, { type: 'user', promptId: s.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
}

/**
 * The fast tests' made-up session in the checkout, its hooks fired through your user settings by the Claude Code
 * stand-in and its commands run for real: the failing test run, a Read and an Edit of src/cart.js that fixes it, the
 * test run again, and the commit; then its Stop and its end. `whileRunning` runs right after the failing test run's
 * hooks, with the session at work.
 */
export async function fastSession(h: Home, repo: Repo, whileRunning: (s: Session, first: Call) => Promise<void>): Promise<{ s: Session; calls: Call[]; first: Call }> {
  const claude = Claude.start(h);
  try {
    const s = newSession(h, repo.dir);
    const fire = async (event: string, extra: Line = {}) => {
      const fired = await claude.hook(event, payload(s, event, extra));
      if (fired.settingsError) throw Error(`BLOCKED: the Claude Code stand-in couldn't read ${h.settings}: ${fired.settingsError}`);
      return fired;
    };
    await fire('SessionStart');
    typedPrompt(s, PROMPT);
    await fire('UserPromptSubmit', { prompt: PROMPT });
    const calls: Call[] = [];
    const call = async (name: string, input: Line, act: () => Promise<{ failed: boolean; response: Line; error: string }>) => {
      const id = callId();
      appendTranscript(s, { type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id, name, input }] } });
      await fire('PreToolUse', { tool_name: name, tool_input: input, tool_use_id: id });
      const done = await act();
      appendTranscript(s, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: done.failed ? done.error : JSON.stringify(done.response), ...(done.failed ? { is_error: true } : {}) }] } });
      if (done.failed) await fire('PostToolUseFailure', { tool_name: name, tool_input: input, tool_use_id: id, error: done.error, is_interrupt: false, duration_ms: 80 });
      else await fire('PostToolUse', { tool_name: name, tool_input: input, tool_response: done.response, tool_use_id: id, duration_ms: 40 });
      const c = { id, name, input, failed: done.failed };
      calls.push(c);
      return c;
    };
    const bash = (command: string, description: string) => call('Bash', { command, description }, async () => {
      const r = await claude.exec(command, repo.dir);
      return { failed: r.code !== 0, response: { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false, noOutputExpected: false }, error: `Exit code ${r.code}\n${`${r.stdout}${r.stderr}`.trim()}`.slice(0, 4000) };
    });
    const cart = join(repo.dir, 'src', 'cart.js');
    const first = await bash('node --test', 'Run the checkout tests');
    if (!first.failed) throw Error('BLOCKED: the fixture\'s checkout test passed before the fix, so there is no failing first run to read');
    await whileRunning(s, first);
    await call('Read', { file_path: cart }, async () => ({ failed: false, response: { type: 'text', file: { filePath: cart, content: readFileSync(cart, 'utf8'), numLines: 4, startLine: 1, totalLines: 4 } }, error: '' }));
    const edit = { file_path: cart, old_string: 'sum + line.priceCents,', new_string: 'sum + line.priceCents * line.quantity,', replace_all: false };
    await call('Edit', edit, async () => {
      writeFileSync(cart, readFileSync(cart, 'utf8').replace(edit.old_string, edit.new_string));
      return { failed: false, response: { filePath: cart, oldString: edit.old_string, newString: edit.new_string, replaceAll: false }, error: '' };
    });
    const again = await bash('node --test', 'Run the checkout tests again');
    if (again.failed) throw Error('BLOCKED: the fixture\'s checkout test still fails after the fix');
    await bash(`git commit -am "${COMMIT_MESSAGE}"`, 'Commit the fix');
    appendTranscript(s, { type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'The cart total now counts quantities; the test passes and the fix is committed.' }] } });
    await fire('Stop', { stop_hook_active: false, last_assistant_message: 'The cart total now counts quantities; the test passes and the fix is committed.' });
    await fire('SessionEnd', { reason: 'prompt_input_exit' });
    return { s, calls, first };
  } finally {
    claude.exit();
  }
}

/** The tool calls a transcript shows (the session's own, not a subagent's), in order, with whether each result was an error. */
export function transcriptCalls(transcript: string): Call[] {
  if (!existsSync(transcript)) return [];
  const calls = new Map<string, Call>();
  for (const e of jsonLines(readFileSync(transcript, 'utf8')).filter((x) => x.isSidechain !== true)) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Line[]) {
      if (e.type === 'assistant' && block.type === 'tool_use' && typeof block.id === 'string' && !calls.has(block.id)) calls.set(block.id, { id: block.id, name: String(block.name), input: (block.input ?? {}) as Line, failed: false });
      if (e.type === 'user' && block.type === 'tool_result' && block.is_error === true && calls.has(block.tool_use_id)) calls.get(block.tool_use_id)!.failed = true;
    }
  }
  return [...calls.values()];
}
/** A test run: a Bash call that runs the checkout tests. */
export const isTestRun = (c: Call) => c.name === 'Bash' && /\bnode\s+--test\b|\bnpm\s+(run\s+)?test\b/.test(String(c.input.command ?? ''));

// ---- What each criterion reads off the run (README: Readings).
const id8 = (id: string) => id.slice(0, 8).toLowerCase();
const word = (text: string) => new RegExp(`(^|[^A-Za-z0-9_-])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_-]|$)`, 'i');
export const REPO_NAME = 'checkout-web';
/** The session's lines in a status listing: from the first line naming it to the next line naming another session of the record. */
export function sessionBlock(output: string, session: string, sessions: readonly string[]): { lines: string[]; at: number; all: string[] } | undefined {
  const all = output.split('\n');
  const at = all.findIndex((l) => l.toLowerCase().includes(id8(session)));
  if (at < 0) return undefined;
  const others = sessions.filter((o) => o !== session).map(id8);
  let end = at + 1;
  while (end < all.length && !others.some((o) => all[end]!.toLowerCase().includes(o))) end++;
  return { lines: all.slice(at, end), at, all };
}
/** Whether the session's line is under checkout-web: it, or the nearest line above it naming a repo, names checkout-web. */
function underRepo(all: readonly string[], at: number): boolean {
  for (let i = at; i >= 0; i--) {
    if (word(REPO_NAME).test(all[i]!)) return true;
    if (i < at && /\bno repo\b/i.test(all[i]!)) return false;
  }
  return false;
}
/** How a status line can name a call: its ID, its command's first 24 characters, or its file's name. */
const callName = (c: Call): string => (c.name === 'Bash' ? collapse(String(c.input.command ?? '')).slice(0, 24) : typeof c.input.file_path === 'string' ? basename(c.input.file_path) : c.name);
const shownCall = (c: Call) => `${c.name} ${c.name === 'Bash' ? `\`${String(c.input.command)}\`` : String(c.input.file_path ?? '')} (${c.id})`;
const occurrences = (text: string, part: string) => (part ? text.split(part).length - 1 : 0);
/** The calls a session's lines don't name: by ID, or each call's name as often as calls share it. */
export function unlisted(lines: readonly string[], calls: readonly Call[]): Call[] {
  const text = collapse(lines.join('\n'));
  const rest = calls.filter((c) => !text.includes(c.id));
  const groups = new Map<string, Call[]>();
  for (const c of rest) groups.set(callName(c), [...(groups.get(callName(c)) ?? []), c]);
  return [...groups].flatMap(([name, group]) => group.slice(occurrences(text, collapse(name))));
}
const hexTokens = (lines: readonly string[]) => [...lines.join('\n').matchAll(/(?<![0-9A-Za-z])[0-9a-f]{7,40}(?![0-9A-Za-z])/gi)].map((m) => m[0].toLowerCase());

/** AC2, while the session runs: `deep status` exits 0 and lists it under checkout-web as working. */
export function whileRunningProblems(status: Ran, session: string, sessions: readonly string[]): string[] {
  const out: string[] = [];
  if (status.code !== 0) out.push(`${AC2} while the session runs, deep status must read the hub and exit 0: ${shown(status)}`);
  const block = sessionBlock(status.stdout, session, sessions);
  if (!block) return [...out, `${AC2} while the session runs, deep status must list session ${session} (a line holding ${id8(session)}): ${shown(status)}`];
  if (!/\bworking\b/i.test(block.all[block.at]!)) out.push(`${AC2} while the session runs, deep status must list session ${id8(session)} as working: its line is ${JSON.stringify(block.all[block.at])}`);
  if (!underRepo(block.all, block.at)) out.push(`${AC2} while the session runs, deep status must list session ${id8(session)} under ${REPO_NAME}: neither its line nor the nearest repo line above it names ${REPO_NAME}: ${JSON.stringify(status.stdout.slice(0, 2000))}`);
  return out;
}
/**
 * AC2, after the session's stop: the record holds exactly the commits the session made, and `deep status` lists the
 * session with each of its tool calls and each of its commits by SHA, and no other commit of the repo under it.
 */
export function afterStopProblems(o: { status: Ran; session: string; sessions: readonly string[]; calls: readonly Call[]; made: readonly { sha: string; subject: string }[]; others: readonly { sha: string; subject: string }[]; events: readonly Ev[] }): string[] {
  const out: string[] = [];
  const recorded = recordedCommits(o.events, o.session);
  for (const c of o.made) if (!recorded.includes(c.sha)) out.push(`${AC2} the record must hold the session's commit ${c.sha} ("${c.subject}") under session ${o.session}: it holds ${JSON.stringify(recorded)}`);
  for (const sha of recorded) if (!o.made.some((c) => c.sha === sha)) out.push(`${AC2} the record holds commit ${sha} under session ${o.session}, which the session didn't make (${o.others.find((c) => c.sha === sha)?.subject ?? 'not in the repo'})`);
  if (o.status.code !== 0) out.push(`${AC2} after the stop, deep status must read the hub and exit 0: ${shown(o.status)}`);
  const block = sessionBlock(o.status.stdout, o.session, o.sessions);
  if (!block) return [...out, `${AC2} after its stop, deep status must still list session ${o.session} (a line holding ${id8(o.session)}), with its tool calls and its commit ${o.made.map((c) => c.sha).join(', ')}: ${shown(o.status)}`];
  for (const c of unlisted(block.lines, o.calls)) out.push(`${AC2} after its stop, deep status must list each tool call of session ${id8(o.session)}: ${shownCall(c)} isn't in its lines ${JSON.stringify(block.lines.join('\n').slice(0, 1500))}`);
  const tokens = hexTokens(block.lines);
  for (const c of o.made) if (!tokens.some((t) => c.sha.startsWith(t))) out.push(`${AC2} after its stop, deep status must list session ${id8(o.session)}'s commit ${c.sha} ("${c.subject}") by its SHA: its lines name no prefix of it: ${JSON.stringify(block.lines.join('\n').slice(0, 1500))}`);
  for (const c of o.others) if (tokens.some((t) => c.sha.startsWith(t) && !o.made.some((m) => m.sha.startsWith(t)))) out.push(`${AC2} deep status lists commit ${c.sha} ("${c.subject}") under session ${id8(o.session)}, which the session didn't make`);
  return out;
}
/** AC3: the first test run is in the record as a failed tool call of the session with its error signature, and the session's lines in `deep status` show it failed. */
export function failedRunProblems(o: { status: Ran; session: string; sessions: readonly string[]; first: Call; events: readonly Ev[] }): string[] {
  const out: string[] = [];
  const command = String(o.first.input.command);
  const after = o.events.filter((e) => e.kind === 'tool.after' && e.session === o.session);
  const ev = after.find((e) => e.data?.call === o.first.id) ?? after.find((e) => typeof e.data?.command === 'string' && collapse(e.data.command) === collapse(command));
  if (!ev) out.push(`${AC3} the first test run, ${shownCall(o.first)}, must be in the record as a tool call of session ${o.session}: no tool.after names it (the session's: ${JSON.stringify(after.map((e) => e.data))})`);
  else {
    if (ev.data.outcome !== 'failed') out.push(`${AC3} the first test run, ${shownCall(o.first)}, failed and must be recorded as a failed tool call: its tool.after reads ${JSON.stringify(ev.data)}`);
    if (typeof ev.data.signature !== 'string' || !ev.data.signature.trim()) out.push(`${AC3} the first test run, ${shownCall(o.first)}, must be recorded with its error signature: its tool.after has none: ${JSON.stringify(ev.data)}`);
  }
  const block = sessionBlock(o.status.stdout, o.session, o.sessions);
  if (!block) return [...out, `${AC3} the failed first test run must show on session ${o.session} in deep status, which doesn't list the session: ${shown(o.status)}`];
  const failedWord = (l: string) => /fail|\bexit(ed)?( code)? 1\b|✗|✖/i.test(l) || (typeof ev?.data?.signature === 'string' && ev.data.signature !== '' && l.includes(ev.data.signature));
  const byId = block.lines.find((l) => l.includes(o.first.id));
  const naming = byId ? [byId] : block.lines.filter((l) => collapse(l).includes(collapse(command).slice(0, 24)));
  if (!naming.some(failedWord)) out.push(`${AC3} the failed first test run, ${shownCall(o.first)}, must show on session ${id8(o.session)} in deep status as failed: no line of the session's names it as failed: ${JSON.stringify(block.lines.join('\n').slice(0, 1500))}`);
  return out;
}
/** The checkout as it was before setup, right after it, and its own `.claude/` folder (the repo's settings) once everything ran. */
export interface RepoSnapshots { before: Map<string, string>; afterSetup: Map<string, string>; claudeAtEnd: Map<string, string> }
/** The entries of a repo snapshot under its `.claude/` folder: the repo's own Claude Code settings. */
export const claudeFolder = (snap: Map<string, string>) => new Map([...snap].filter(([rel]) => rel === '.claude' || rel.startsWith('.claude/')));
/** AC1: your hook ran for every tool call of the session that ran, and DeepBuild's entries sit beside it in your user settings, never in the repo's. */
export function besideProblems(o: { h: Home; before: string; repo: RepoSnapshots; settingsAfterSetup: string; session: string; calls: readonly Call[] }): string[] {
  const out: string[] = [];
  const mine = parseObject(o.before)!;
  const after = parseObject(o.settingsAfterSetup);
  if (!after) return [`${AC1} after deep setup, ${o.h.settings} must still be your settings as JSON: ${o.settingsAfterSetup.slice(0, 500)}`];
  for (const key of Object.keys(mine).filter((k) => k !== 'hooks')) if (JSON.stringify(after[key]) !== JSON.stringify(mine[key])) out.push(`${AC1} after deep setup your setting ${key} must be as you wrote it in ${o.h.settings}: was ${JSON.stringify(mine[key])}, now ${JSON.stringify(after[key])}`);
  const yours = JSON.stringify(mine.hooks.PostToolUse[0]);
  const groups = (event: string): Line[] => (Array.isArray(after.hooks?.[event]) ? after.hooks[event] : []);
  if (!groups('PostToolUse').some((g) => JSON.stringify(g) === yours)) out.push(`${AC1} after deep setup your own PostToolUse hook must be in ${o.h.settings} as you wrote it (${yours}): PostToolUse holds ${JSON.stringify(groups('PostToolUse'))}`);
  for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']) {
    if (!groups(event).some((g) => Array.isArray(g?.hooks) && g.hooks.some((x: Line) => isDeepBuild(x?.command)))) out.push(`${AC1} after deep setup, DeepBuild's ${event} hook entry must sit in your user settings ${o.h.settings}${event === 'PostToolUse' ? ', beside your own hook' : ''}: ${event} holds ${JSON.stringify(groups(event))}`);
  }
  for (const change of changes(o.repo.before, o.repo.afterSetup)) out.push(`${AC1} DeepBuild's hook entries must never go into the repo's settings: deep setup, run in ${o.h.tmp}/checkout-web, changed ${change}`);
  for (const change of changes(claudeFolder(o.repo.before), o.repo.claudeAtEnd)) out.push(`${AC1} DeepBuild's hook entries must never go into the repo's settings: by the end of the session and its commands, the repo's ${change}`);
  const ran = existsSync(o.h.myLog) ? jsonLines(readFileSync(o.h.myLog, 'utf8')).filter((l) => l.session_id === o.session && l.hook_event_name === 'PostToolUse') : [];
  for (const c of o.calls.filter((x) => !x.failed)) if (!ran.some((l) => l.tool_use_id === c.id)) out.push(`${AC1} after deep setup your own PostToolUse hook must still run: it got no payload for ${shownCall(c)} of session ${o.session} (your log holds ${ran.length} of the session's)`);
  if (!o.calls.some((c) => !c.failed)) out.push(`${AC1} the session must have made a tool call that ran, for your own hook to be seen running: ${JSON.stringify(o.calls)}`);
  return out;
}

// ---- deep doctor (README: AC4).
export interface Item { item: string; agent: string; code: string; level: string; evidence: string; fix: string }
export const itemsOf = (r: Ran): Item[] => jsonLines(r.stdout).filter((l) => typeof l.item === 'string' && typeof l.level === 'string') as Item[];
const itemShown = (i: Item) => `${i.item} ${i.level} (${i.code}): ${i.evidence}`;
/** The environment `deep doctor --prompt` reads in this checkpoint: Claude Code's telemetry to the receiver, in the shell you start sessions from. */
export const TELEMETRY = { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' };
/** AC4, installed: every item OK or "not checked", and exit 0. */
export function doctorOkProblems(r: Ran): string[] {
  const items = itemsOf(r);
  if (!items.length) return [`${AC4} deep doctor --json must list its items: ${shown(r)}`];
  const out = items.filter((i) => !(i.level === 'ok' || i.code === 'not_checked')).map((i) => `${AC4} after deep setup every item of deep doctor must be OK or "not checked": ${itemShown(i)}; fix: ${i.fix}`);
  if (r.code !== 0) out.push(`${AC4} deep doctor must exit 0 with every item OK or "not checked": ${shown(r)}`);
  return out;
}
/** The items that name a missing installation of DeepBuild's `event` entry in the settings file: failed, naming the hook and the file. */
export const missingItems = (r: Ran, h: Home, event: string): Item[] => itemsOf(r).filter((i) => i.level === 'fail' && word(event).test(`${i.item} ${i.evidence}`) && (`${i.evidence} ${i.fix}`.includes(h.settings) || `${i.evidence} ${i.fix}`.includes('~/.claude/settings.json')));
/** AC4, DeepBuild's `event` entry removed by hand: a failed item names it with the exact fix, `deep setup`, and the doctor exits non-zero. */
export function doctorMissingProblems(r: Ran, h: Home, event: string): string[] {
  const out: string[] = [];
  if (r.code === 0) out.push(`${AC4} with DeepBuild's ${event} hook entry removed by hand from ${h.settings}, deep doctor must exit non-zero: ${shown(r)}`);
  const named = missingItems(r, h, event);
  if (!named.length) return [...out, `${AC4} with DeepBuild's ${event} hook entry removed by hand, deep doctor must name the missing installation: a failed item naming ${event} and ${h.settings}; it listed ${JSON.stringify(itemsOf(r).map(itemShown))}`];
  if (!named.some((i) => /(^|[^\w-])deep setup(?!\s*--undo)([^\w-]|$)/.test(i.fix) && !/--undo/.test(i.fix))) out.push(`${AC4} the item naming the missing ${event} entry must give its exact fix, the command \`deep setup\`: ${named.map((i) => i.fix).join(' | ')}`);
  return out;
}
/** Takes DeepBuild's entries for `event` out of the user settings by hand, keeping everything else as it is. */
export function removeByHand(h: Home, event: string): void {
  const settings = parseObject(readFileSync(h.settings, 'utf8'))!;
  const groups = (settings.hooks?.[event] ?? []) as Line[];
  settings.hooks[event] = groups.flatMap((g) => {
    const kept = (Array.isArray(g.hooks) ? g.hooks : []).filter((x: Line) => !isDeepBuild(x?.command));
    return kept.length ? [{ ...g, hooks: kept }] : [];
  });
  if (!settings.hooks[event].length) delete settings.hooks[event];
  writeFileSync(h.settings, `${JSON.stringify(settings, null, 2)}\n`);
}
export const hasDeepEntry = (h: Home, event: string): boolean => {
  const settings = parseObject(readFileSync(h.settings, 'utf8'));
  return ((settings?.hooks?.[event] ?? []) as Line[]).some((g) => Array.isArray(g?.hooks) && g.hooks.some((x: Line) => isDeepBuild(x?.command)));
};

// ---- deep off and deep on (README: AC5): your gate read off the hook replies your settings' entries get.
/** Your gate added to ~/.deepbuild/rules.json beside whatever setup wrote there. */
export function addYourGate(h: Home): void {
  const file = join(h.root, 'rules.json');
  const rules = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? { v: 1, entries: {} }) : { v: 1, entries: {} };
  rules.entries = { ...(rules.entries ?? {}), [YOUR_GATE]: { match: `run:${YOUR_GATE_COMMAND}`, scope: 'all_repos', mode: 'block', reason: 'You release by hand from the release checklist.', next_step: 'Ask the person to run the release.', fail_closed: false } };
  writeFileSync(file, `${JSON.stringify(rules, null, 2)}\n`);
}
/** A forwarded socket at the address setting that keeps every byte both ways, so a reply the hub acknowledged is told apart from one deep-hook gave alone. */
export interface Forwarder { path: string; upText(): string; downText(): string; close(): Promise<void> }
export function forwarder(dir: string, target: string): Promise<Forwarder> {
  const path = join(dir, `fwd-${randomBytes(3).toString('hex')}.sock`);
  const up: Buffer[] = [];
  const down: Buffer[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(target);
    sockets.add(client); sockets.add(upstream);
    client.on('data', (d: Buffer) => up.push(d));
    upstream.on('data', (d: Buffer) => down.push(d));
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.end());
    upstream.on('close', () => client.end());
  });
  const f: Forwarder = {
    path,
    upText: () => Buffer.concat(up).toString('utf8'),
    downText: () => Buffer.concat(down).toString('utf8'),
    close: () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => resolve(f)); });
}
/** Sets (or, with no path, takes out) the address setting `hub.address` in ~/.deepbuild/config.json (#16), its other keys kept. */
export function setAddress(h: Home, path?: string): void {
  const file = join(h.root, 'config.json');
  const config = existsSync(file) ? (parseObject(readFileSync(file, 'utf8')) ?? {}) : {};
  const hub = { ...(config.hub as Line | undefined) };
  if (path) hub.address = `unix:${path}`;
  else delete hub.address;
  config.hub = hub;
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
export interface Probe { reading: 'gated' | 'watch-only'; started: number; text: string }
/**
 * The next PreToolUse of `make release` through your user settings' entries: gated when DeepBuild's entry denies it,
 * watch-only when the hub acknowledged it and nothing denied it. A reply with no acknowledgement is no reading.
 */
export async function gateProbe(claude: Claude, s: Session, fwd: Forwarder, tries = 8): Promise<Probe> {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const id = callId();
    const started = Date.now();
    const fired = await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: YOUR_GATE_COMMAND, description: 'Release' }, tool_use_id: id }));
    if (!ours(fired).length) throw Error(`BLOCKED: no entry of DeepBuild's ran for the PreToolUse: ${firedShown(fired)}`);
    const request = jsonLines(fwd.upText()).find((l) => l.payload?.tool_use_id === id);
    const ack = request ? jsonLines(fwd.downText()).find((l) => l.ack === request.id) : undefined;
    last = `${id}: ${firedShown(fired)}; hub ack ${JSON.stringify(ack)}`;
    if (denied(fired)) return { reading: 'gated', started, text: last };
    if (ack) return { reading: 'watch-only', started, text: last };
  }
  throw Error(`INCONCLUSIVE: in ${tries} tries no PreToolUse reached the hub in time (the machine is too loaded to read a gate): ${last}`);
}
/** Gate probes back to back until one reads `want` or one started after `deadline` (ms since the epoch) has read. */
export async function gateBy(claude: Claude, s: Session, fwd: Forwarder, want: Probe['reading'], deadline: number): Promise<Probe> {
  let probe = await gateProbe(claude, s, fwd);
  while (probe.reading !== want && probe.started <= deadline) probe = await gateProbe(claude, s, fwd);
  return probe;
}
/**
 * AC5: before, your gate denies `make release` (else BLOCKED); `deep off`, the OS confirming you, exits 0 and a hook
 * started within a second of its exit reads watch-only, acknowledged by the hub; `deep on` exits 0 and the gate holds
 * again within 5 s. Returns the problems and the terminal output of both commands and every reading.
 */
export async function offOnProblems(h: Home, repo: Repo): Promise<{ problems: string[]; proof: string }> {
  addYourGate(h);
  const fwd = await forwarder(h.tmp, socketOf(h));
  setAddress(h, fwd.path);
  const claude = Claude.start(h);
  const log: string[] = [];
  try {
    const s = newSession(h, repo.dir);
    typedPrompt(s, 'Release it.');
    await claude.hook('SessionStart', payload(s, 'SessionStart'));
    await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Release it.' }));
    const before = await gateProbe(claude, s, fwd);
    log.push(`before deep off: ${before.reading} ${before.text}`);
    if (before.reading !== 'gated') throw Error(`${AC5} BLOCKED: before deep off your gate ${YOUR_GATE} must deny \`${YOUR_GATE_COMMAND}\` through the hub, or nothing is read: ${before.text}`);
    const problems: string[] = [];
    const off = await deep(h, ['off'], { cwd: repo.dir });
    log.push(terminal(off));
    if (off.code !== 0) problems.push(`${AC5} deep off, run by you with the OS confirming you, must exit 0: ${shown(off)}`);
    const watch = await gateBy(claude, s, fwd, 'watch-only', off.endedMs + 1000);
    log.push(`after deep off (+${watch.started - off.endedMs} ms): ${watch.reading} ${watch.text}`);
    if (watch.reading !== 'watch-only' || watch.started - off.endedMs > 1000) problems.push(`${AC5} deep off must make the next hook reply watch-only within a second: the first reply that let \`${YOUR_GATE_COMMAND}\` through, acknowledged by the hub, came from a hook started ${watch.started - off.endedMs} ms after deep off exited (${watch.reading}): ${watch.text}`);
    const on = await deep(h, ['on'], { cwd: repo.dir });
    log.push(terminal(on));
    if (on.code !== 0) problems.push(`${AC5} deep on, run by you with the OS confirming you, must exit 0: ${shown(on)}`);
    const back = await gateBy(claude, s, fwd, 'gated', on.endedMs + 5000);
    log.push(`after deep on (+${back.started - on.endedMs} ms): ${back.reading} ${back.text}`);
    if (back.reading !== 'gated') problems.push(`${AC5} deep on must bring the gates back: your gate let \`${YOUR_GATE_COMMAND}\` through from a hook started ${back.started - on.endedMs} ms after deep on exited: ${back.text}`);
    return { problems, proof: log.join('\n') };
  } finally {
    claude.exit();
    setAddress(h);
    await fwd.close();
  }
}

/** AC6: `deep setup --undo` exits 0 and leaves your user settings byte for byte as they were before setup. */
export function undoProblems(h: Home, before: Buffer, undo: Ran): string[] {
  const out: string[] = [];
  if (undo.code !== 0) out.push(`${AC6} deep setup --undo, the OS confirming you, must exit 0: ${shown(undo)}`);
  if (!existsSync(h.settings)) return [...out, `${AC6} deep setup --undo must leave ${h.settings} byte for byte as it was before setup: the file is gone`];
  const now = readFileSync(h.settings);
  if (!now.equals(before)) out.push(`${AC6} deep setup --undo must leave ${h.settings} byte for byte as it was before setup: ${firstDifference(before, now)}`);
  return out;
}

// ---- The live session through the agent test harness (README: Additions, the fix-checkout-test scenario).
/** The `claude` a live run uses: the first on this process's PATH, BLOCKED when there is none. */
export function realClaude(): string {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const file = join(dir, 'claude');
    if (dir && existsSync(file)) return realpathSync(file);
  }
  throw Error('BLOCKED: no claude on PATH');
}
/** The harness's run of the scenario in the checkout, signed in under the temporary HOME with CLAUDE_CODE_OAUTH_TOKEN; resolves with its run line. */
export async function harnessRun(h: Home, repo: Repo, token: string): Promise<{ ran: Ran; line: Line | undefined }> {
  const ran = await run(NODE, [HARNESS, 'run', '--scenario', SCENARIO, '--workdir', repo.dir, '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--claude', h.claude, '--timeout-ms', '600000', '--out', join(h.tmp, 'out')], {
    // Claude Code's Bash tool runs your shell; the login shell stand-in is setup's, not a shell Claude Code knows.
    env: childEnv(h, { SHELL: '/bin/zsh', CLAUDE_CODE_OAUTH_TOKEN: token }), cwd: REPO, timeoutMs: 900_000,
    shownAs: `node scripts/agent-harness.mjs run --scenario ${SCENARIO} --workdir ${repo.dir} --pass-env CLAUDE_CODE_OAUTH_TOKEN --claude ${h.claude} --timeout-ms 600000 --out ${join(h.tmp, 'out')}`,
  });
  return { ran, line: jsonLines(ran.stdout).find((l) => typeof l.run === 'string' && 'verdict' in l) };
}
/** Status snapshots taken back to back while something runs, each with when it started and ended. */
export function statusPoller(h: Home): { stop(): Promise<Ran[]> } {
  const snaps: Ran[] = [];
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      snaps.push(await deep(h, ['status'], { timeoutMs: 30_000 }));
      await sleep(300);
    }
  })();
  return { stop: async () => { stopped = true; await loop; return snaps; } };
}

// ---- The checkpoint, in the issue's order (README: The checkpoint), shared by the fast and the live file.
/** What a session left: its ID, its tool calls in order, its first test run, its transcript and the status snapshots taken while it ran. */
export interface SessionRun { id: string; calls: Call[]; first: Call; transcript: string; whileRunning: Ran[]; terminal: string[] }
export interface World {
  h: Home; repo: Repo; folder: string;
  settingsBefore: Buffer; settingsAfterSetup: string; settingsAfterUndo: Buffer | undefined;
  setup: Ran; session: SessionRun; repoSnaps: RepoSnapshots;
  /** The commits the session made, the one you made by hand after it, and every other commit of the repo. */
  made: { sha: string; subject: string }[]; hand: { sha: string; subject: string }; others: { sha: string; subject: string }[];
  events: Ev[]; sessions: string[];
  statusStopped: Ran; statusPlanted: Ran; doctor: Ran;
  /** AC4's second half: the doctor with DeepBuild's PreToolUse entry removed by hand, the fix it named, and the doctor again. */
  removal: { missing: Ran; fix: Ran; back: boolean; fixed: Ran } | { error: Error };
  offOn: { problems: string[]; proof: string } | { error: Error };
  undo: Ran;
}
/** The status snapshots taken while the session was at work: started after its prompt was recorded and ended before its stop was. */
export function duringSession(w: World): Ran[] {
  const of = w.events.filter((e) => e.session === w.session.id);
  const asked = of.find((e) => e.kind === 'user.ask')?.ts;
  const stopped = of.find((e) => e.kind === 'agent.stop')?.ts;
  if (asked === undefined || stopped === undefined) return [];
  return w.session.whileRunning.filter((r) => r.startedMs >= asked && r.endedMs <= stopped);
}
/**
 * The checkpoint: your settings and the repo kept as they are; `deep setup` in the checkout (the hub starts through
 * its login service); the session; a commit of yours by hand; the record settled; `deep status` and the planted
 * status; `deep doctor --prompt --json`; `deep off` and `deep on`; the repo's settings again; `deep setup --undo`.
 * Each command's terminal output, the transcript, the record's rows and the settings before setup and after undo go
 * to the proof folder.
 */
export async function checkpoint(folder: string, h: Home, repo: Repo, session: (h: Home, repo: Repo) => Promise<SessionRun>, doctorEnv: Record<string, string>): Promise<World> {
  const terminals: string[] = [];
  const settingsBefore = readFileSync(h.settings);
  proof(folder, 'settings-before.json', settingsBefore);
  const before = snapshot(repo.dir);
  await cargoBuild();
  const setup = await deep(h, ['setup'], { cwd: repo.dir });
  terminals.push(terminal(setup));
  proof(folder, 'terminal.txt', terminals.join('\n'));
  if (setup.code !== 0) throw Error(`${AC1} deep setup must exit 0 and install DeepBuild beside your settings: ${shown(setup)}`);
  await hubUp(h);
  const settingsAfterSetup = readFileSync(h.settings, 'utf8');
  proof(folder, 'settings-after-setup.json', settingsAfterSetup);
  const afterSetup = snapshot(repo.dir);
  const run = await session(h, repo);
  terminals.push(...run.terminal, ...run.whileRunning.map(terminal));
  proof(folder, 'terminal.txt', terminals.join('\n'));
  if (existsSync(run.transcript)) proof(folder, 'transcript.jsonl', readFileSync(run.transcript));
  const made = commitsBetween(h, repo, repo.base);
  const hand = handCommit(h, repo);
  const others = allCommits(h, repo).filter((c) => !made.some((m) => m.sha === c.sha));
  // The record settles: the session's stop and its commits in it, or 60 s.
  await waitFor(async () => {
    const events = await allEvents(h);
    return events.some((e) => e.session === run.id && e.kind === 'agent.stop') && made.every((c) => recordedCommits(events, run.id).includes(c.sha));
  }, 60_000);
  const events = await allEvents(h);
  const sessions = [...new Set(events.map((e) => e.session).filter((s): s is string => typeof s === 'string'))];
  proof(folder, 'record.json', await recordRows(h, run.id));
  if (existsSync(h.myLog)) proof(folder, 'my-hook.log', readFileSync(h.myLog));
  const statusStopped = await deep(h, ['status'], { cwd: repo.dir });
  const statusPlanted = await deep(h, ['status'], { cwd: repo.dir, env: { DEEP_HUB_PLANT: STATUS_PLANT } });
  terminals.push(terminal(statusStopped), `DEEP_HUB_PLANT=${STATUS_PLANT} ${terminal(statusPlanted)}`);
  const doctor = await deep(h, ['doctor', '--prompt', '--json'], { cwd: repo.dir, env: doctorEnv });
  terminals.push(terminal(doctor));
  let removal: World['removal'];
  try {
    if (!hasDeepEntry(h, 'PreToolUse')) throw Error(`${AC4} BLOCKED: deep setup wrote no PreToolUse entry of DeepBuild's to remove by hand: ${readFileSync(h.settings, 'utf8').slice(0, 1500)}`);
    // The hub puts back an entry of DeepBuild's removed while it runs (#18), so you take it out with the hub stopped.
    await stopHubByPid(h);
    removeByHand(h, 'PreToolUse');
    const missing = await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: doctorEnv });
    terminals.push(`(DeepBuild's PreToolUse entry removed by hand from ${h.settings}, the hub stopped)\n${terminal(missing)}`);
    const fix = await deep(h, ['setup'], { cwd: repo.dir });
    await waitFor(() => answers(socketOf(h)), 30_000);
    const back = hasDeepEntry(h, 'PreToolUse');
    const fixed = await deep(h, ['doctor', '--json'], { cwd: repo.dir, env: doctorEnv });
    terminals.push(terminal(fix), terminal(fixed));
    removal = { missing, fix, back, fixed };
  } catch (error) {
    removal = { error: error as Error };
  }
  proof(folder, 'terminal.txt', terminals.join('\n'));
  let offOn: World['offOn'];
  try { offOn = await offOnProblems(h, repo); } catch (error) { offOn = { error: error as Error }; }
  terminals.push('error' in offOn ? `deep off and deep on: ${offOn.error.message}` : offOn.proof);
  const claudeAtEnd = claudeFolder(snapshot(repo.dir));
  const undo = await deep(h, ['setup', '--undo'], { cwd: repo.dir });
  terminals.push(terminal(undo));
  proof(folder, 'terminal.txt', terminals.join('\n'));
  const settingsAfterUndo = existsSync(h.settings) ? readFileSync(h.settings) : undefined;
  proof(folder, 'settings-after-undo.json', settingsAfterUndo ?? '(no file)');
  proof(folder, 'machine.txt', `${machine()}\n`);
  return {
    h, repo, folder, settingsBefore, settingsAfterSetup, settingsAfterUndo, setup, session: run,
    repoSnaps: { before, afterSetup, claudeAtEnd }, made, hand, others, events, sessions, statusStopped, statusPlanted, doctor, removal, offOn, undo,
  };
}
/** AC4 whole: the doctor after setup, every item OK or "not checked" and exit 0; then the entry removed by hand, named with its exact fix, non-zero; the fix puts it back. */
export function doctorProblems(w: World): string[] {
  const out = doctorOkProblems(w.doctor);
  if ('error' in w.removal) throw w.removal.error;
  const { missing, fix, back, fixed } = w.removal;
  out.push(...doctorMissingProblems(missing, w.h, 'PreToolUse'));
  if (fix.code !== 0 || !back) out.push(`${AC4} the fix the doctor names, \`deep setup\`, must put DeepBuild's PreToolUse entry back in ${w.h.settings}: ${shown(fix)}`);
  if (missingItems(fixed, w.h, 'PreToolUse').length) out.push(`${AC4} after the fix, deep doctor must no longer name DeepBuild's PreToolUse entry missing: ${shown(fixed)}`);
  return out;
}

// ---- The proof (README: The proof), rewritten on each run and never read back.
export function proof(folder: string, name: string, content: unknown): void {
  const dir = join(PROOF_DIR, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), typeof content === 'string' || Buffer.isBuffer(content) ? content : `${JSON.stringify(content, null, 2)}\n`);
}
export function machine(): string {
  const model = (() => { try { return execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim(); } catch { return 'unknown model'; } })();
  return `${model}; ${cpus()[0]?.model ?? 'unknown chip'}; ${Math.round(totalmem() / 2 ** 30)} GiB; load average ${loadavg().map((l) => l.toFixed(1)).join(' ')}; node ${process.version}`;
}
