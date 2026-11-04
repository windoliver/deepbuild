// Shared test-side tools for #669's checkpoint (README): a temporary home with stand-ins for what this repo doesn't own
// (launchd, systemctl, the `claude` binary, Claude Code running its user settings' hooks), the checkout-web fixture repo
// with Vitest and an approved `npm test` check, `deep setup` and `deep status` through the built CLI, the hub's socket,
// a session driven through the stand-in (fast) or the agent test harness (live), every criterion's check, and the
// proof. Parts are adapted from tests/acceptance/668/helpers.ts and tests/acceptance/875/helpers.ts (same repo, same
// license); this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for
// DeepBuild: every reading comes through the CLI, deep-hook as the settings run it, the hub's socket and the record.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { cpus, loadavg, tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const HARNESS = join(REPO, 'scripts/agent-harness.mjs');
export const NODE = process.execPath;
export const PROOF_DIR = join(tmpdir(), 'deep-669-proof');

// Criterion IDs: `#669.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed (scripts/proof-change.mjs).
export const AC1 = '#669.2302adfc';
export const AC2 = '#669.b95b4d96';
export const AC3 = '#669.db713958';
export const AC4 = '#669.059078dc';
export const AC5 = '#669.b5400502';
export const AC6 = '#669.f2c64a9c';

// ---- The task, its approved check and the fixture's facts (README: The fixture repo, The approved check).
export const COMMIT_MESSAGE = 'Fix the coupon discount';
/** The prompt the session gets: a change request, so it opens a task, whose definition is handed for these exact words. */
export const PROMPT = `Fix the coupon test: run \`npm test\`, fix the bug in src/coupon.js, run \`npm test\` again to see it pass, then commit the fix with \`git commit -am "${COMMIT_MESSAGE}"\`.`;
/** The approved check: a drafted check file under .deepbuild/, one line, the repo's own test entry. */
export const CHECK = '.deepbuild/checks/npm-test.sh';
export const CHECK_BYTES = 'npm test\n';
/** Where the coupon test fails until the fix: its named assertion. */
export const FAILING_AT = 'test/coupon.test.js:5';
/** How many tests `npm test` runs in checkout-web: two cart tests and the coupon test. */
export const TESTS = 3;
export const STATUS_QUESTION = 'all done?';
export const SCENARIO = 'fix-coupon-test';
/** The live scenario's instruction that makes its first stop say "done" before the fix (README: Additions). */
export const FIRST_STOP = 'This is a scripted test. After your first `npm test` run, end your turn at once by saying only "done", before you change any file. When you are sent back, fix the bug, run `npm test` again, commit, and end your turn.';
const FIX_FROM = 'return totalCents - coupon.percent;';
const FIX_TO = 'return totalCents - Math.round((totalCents * coupon.percent) / 100);';

export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const parseObject = (raw: string): Line | undefined => {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Line) : undefined;
  } catch {
    return undefined;
  }
};
export const jsonLines = (text: string): Line[] => text.split('\n').flatMap((raw) => { const l = parseObject(raw); return l ? [l] : []; });
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
/** The newest Claude Code version the facts cover: the version the fast session's transcript and the `claude` stand-in carry. */
export const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();
/** A lazily made value, shared by the tests that need it; a failure fails each of them with the same reason. */
export function shared<T>(make: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => (made ??= make());
}

// ---- Temp folders under /tmp/dh669-*: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh669-'));
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
/** Every PID the launchd stand-in started for a home: the hubs setup's login service started, and a restart's. */
export function launchedPids(h: Home): number[] {
  const file = join(h.bin, 'launchd', 'started.pids');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').map(Number).filter((n) => n > 0) : [];
}
/** Stops every process this suite started, the launchd stand-in's jobs included (SIGTERM, then SIGKILL after 5 s), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  for (const h of homes.splice(0)) for (const pid of launchedPids(h)) own(pid);
  for (const pid of owned) {
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
  /** Claude Code's user settings, `<home>/.claude/settings.json`. */
  settings: string;
  /** Set on every process the test starts: the OS confirmation, the Keychain stand-in, the handed definition. */
  env: Record<string, string>;
  /** The `claude` the session runs: the stand-in, or a link to the real one. */
  claude: string;
}
/**
 * The definition handed for PROMPT (DEEP_HUB_TEST_DRAFTS, #303's seam for the drafting job's output): one requirement,
 * the coupon test passes, checked by CHECK, a fix check (`on_base: fails`) whose named assertion is FAILING_AT.
 */
export const DRAFT = {
  ask: PROMPT,
  requirements: [{
    id: 'R1', text: 'A percent coupon takes that share off the checkout total', source_line: 'ask#L1',
    refuted_by: 'a run where a percent coupon does not take that share off the total', check: CHECK, on_base: 'fails',
    asserts: [FAILING_AT], depth: 'unit', oracle: 'code', near_misses: [],
  }],
  deliverables: ['src/coupon.js'],
  budget: null,
};
/**
 * A fresh home. `<tmp>/h` is HOME for every process a test starts; `<tmp>/bin` comes first on PATH with `launchctl`
 * (the launchd stand-in), `systemctl` (logs, exits 0), `claude` (the stand-in, or a link to the real binary), `sh-login`
 * (your login shell) and `deep` (the built CLI). Your user settings hold nothing of DeepBuild's yet.
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
  const keychain = join(tmp, 'keychain.json');
  writeFileSync(keychain, JSON.stringify({ 'Claude Code-credentials': JSON.stringify({ claudeAiOauth: { expiresAt: Date.UTC(2099, 0, 1) } }) }));
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [DRAFT] }, null, 2)}\n`);
  const settings = join(home, '.claude', 'settings.json');
  writeFileSync(settings, '{}\n');
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', numStartups: 3 }, null, 2)}\n`);
  const env: Record<string, string> = { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_KEYCHAIN: keychain, DEEP_HUB_TEST_DRAFTS: drafts };
  if (o.fast) env.DEEP_HUB_TEST_MANAGED_SETTINGS = join(tmp, 'no-managed-settings.json');
  const h: Home = { tmp, home, bin, root: join(home, '.deepbuild'), settings, env, claude: join(bin, 'claude') };
  homes.push(h);
  return h;
}

/** Variables that make an agent bill an API account or sign it in; a child never inherits this process's. */
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** The environment a child gets: HOME the test's home, the stand-ins first on PATH, the home's seams; no DEEP_, CLAUDE*, CODEX*, GIT_, OTEL_, npm_ or billing variable of this process's. */
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
export function run(command: string, args: readonly string[], o: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number; shownAs?: string } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const startedMs = Date.now();
    const child = spawn(command, args, { cwd: o.cwd ?? '/tmp', env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs ?? 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ command: o.shownAs ?? [command, ...args].join(' '), code, signal, stdout, stderr, startedMs, endedMs: Date.now(), timedOut }); });
  });
}
export const shown = (r: Ran) => `\`${r.command}\` exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 2500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;
export const terminal = (r: Ran) => `$ ${r.command}\n${r.stdout}${r.stderr}(exit ${r.code}${r.signal ? `, ${r.signal}` : ''}${r.timedOut ? ', killed at the timeout' : ''})\n`;
/** `deep <args>` from the built CLI, HOME the test's home. */
export function deep(h: Home, args: readonly string[], o: { cwd?: string; timeoutMs?: number } = {}): Promise<Ran> {
  return run(NODE, [CLI, ...args], { env: childEnv(h), cwd: o.cwd ?? h.tmp, timeoutMs: o.timeoutMs ?? 180_000, shownAs: `deep ${args.join(' ')}` });
}

// ---- Built tools: the CLI the hub runs from, and deep-hook, which setup's entries run.
let build: Promise<void> | undefined;
export function built(): Promise<void> {
  build ??= (async () => {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI is not built at ${CLI} (npm run build --workspaces)`);
    const r = await run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, timeoutMs: 1_200_000 });
    if (r.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${r.stderr.slice(-3000)}`);
  })();
  return build;
}

// ---- The fixture repo (README: The fixture repo).
export interface Repo { dir: string; base: string }
export function git(h: Home, dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, env: childEnv(h, { GIT_CONFIG_NOSYSTEM: '1' }), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
/** A variant of checkout-web a world needs, laid over the fixture before its last commit (README: The worlds). */
export type Variant = 'main' | 'zero-tests' | 'masked' | 'slow';
const VARIANTS: Record<Variant, Record<string, string>> = {
  main: {},
  // Every test skipped: `npm test` runs zero tests and exits 0.
  'zero-tests': Object.fromEntries(['test/cart.test.js', 'test/coupon.test.js'].map((f) => [f, readFileSync(join(FIXTURES, 'checkout-web', f), 'utf8').replace(/^it\(/gm, 'it.skip(')])),
  // The package script masks Vitest's exit status: `npm test` exits 0 whatever the tests do.
  masked: { 'package.json': readFileSync(join(FIXTURES, 'checkout-web', 'package.json'), 'utf8').replace('"vitest run"', '"vitest run || true"') },
  // A test that takes 20 s, so a hub restart can cut the check's run short.
  slow: { 'test/slow.test.js': "import { expect, it } from 'vitest';\n\nit('the receipt waits for the payment service', async () => {\n  await new Promise((resolve) => setTimeout(resolve, 20_000));\n  expect(true).toBe(true);\n}, 120_000);\n" },
};
/**
 * Clones Vitest and what it needs into `dir`'s node_modules (copy-on-write where the file system can): the packages
 * the repo's package-lock.json reaches from `node_modules/vitest`, each from this checkout's install, with
 * `.bin/vitest` linked as npm links it (#875's `installVitest`).
 */
function installVitest(dir: string): void {
  type Entry = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
  const lock = (JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')) as { packages: Record<string, Entry> }).packages;
  if (!existsSync(join(REPO, 'node_modules/vitest'))) throw Error("BLOCKED: this checkout's node_modules has no vitest (run npm ci once)");
  const resolve = (from: string, name: string): string | null => {
    for (let at = from; ;) {
      if (lock[`${at}/node_modules/${name}`]) return `${at}/node_modules/${name}`;
      const i = at.lastIndexOf('/node_modules/');
      if (i < 0) break;
      at = at.slice(0, i);
    }
    return lock[`node_modules/${name}`] ? `node_modules/${name}` : null;
  };
  const need = new Set<string>();
  for (const queue = ['node_modules/vitest']; queue.length;) {
    const at = queue.pop()!;
    if (need.has(at)) continue;
    need.add(at);
    const e = lock[at] ?? {};
    for (const name of Object.keys({ ...e.dependencies, ...e.optionalDependencies, ...e.peerDependencies })) {
      const found = resolve(at, name);
      if (found) queue.push(found);
    }
  }
  for (const path of [...need].filter((p) => p.split('/node_modules/').length === 1 && existsSync(join(REPO, p)))) {
    const into = join(dir, path, '..');
    mkdirSync(into, { recursive: true });
    try {
      execFileSync('/bin/cp', ['-cRH', join(REPO, path), into], { stdio: 'pipe' });
    } catch {
      execFileSync('/bin/cp', ['-RH', join(REPO, path), into], { stdio: 'pipe' });
    }
  }
  mkdirSync(join(dir, 'node_modules/.bin'), { recursive: true });
  symlinkSync('../vitest/vitest.mjs', join(dir, 'node_modules/.bin/vitest'));
}
/**
 * A fresh git checkout of checkout-web at `<tmp>/<world>/checkout-web`: "Start the checkout page" (the cart, its tests,
 * the package), then "Add the coupon code and its check" (the coupon with its bug, the coupon test, the approved check
 * file, and the world's variant). Vitest is installed in it, ignored by git.
 */
export function checkout(h: Home, variant: Variant = 'main'): Repo {
  const dir = join(h.tmp, variant, 'checkout-web');
  mkdirSync(dirname(dir), { recursive: true });
  cpSync(join(FIXTURES, 'checkout-web'), dir, { recursive: true });
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  mkdirSync(join(dir, dirname(CHECK)), { recursive: true });
  writeFileSync(join(dir, CHECK), CHECK_BYTES);
  for (const [file, bytes] of Object.entries(VARIANTS[variant])) writeFileSync(join(dir, file), bytes);
  const g = (...args: string[]) => git(h, dir, ...args);
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Checkout Dev');
  g('config', 'user.email', 'checkout@example.invalid');
  g('config', 'commit.gpgsign', 'false');
  g('add', '.gitignore', 'README.md', 'package.json', 'src/cart.js', 'test/cart.test.js');
  g('commit', '-q', '-m', 'Start the checkout page');
  g('add', '-A');
  g('commit', '-q', '-m', 'Add the coupon code and its check');
  installVitest(dir);
  return { dir, base: g('rev-parse', 'HEAD') };
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
/** `deep setup` in the checkout, and the hub its login service started answering; BLOCKED when either doesn't. */
export async function setUp(h: Home, repo: Repo): Promise<Ran> {
  await built();
  const setup = await deep(h, ['setup'], { cwd: repo.dir });
  if (setup.code !== 0) throw Error(`BLOCKED: deep setup must exit 0: ${shown(setup)}`);
  await hubUp(h);
  return setup;
}
export async function hubUp(h: Home, timeoutMs = 30_000): Promise<void> {
  if (await waitFor(() => answers(socketOf(h)), timeoutMs)) return;
  throw Error(`BLOCKED: no hub answers at ${socketOf(h)}; launchctl calls: ${existsSync(join(h.bin, 'calls.log')) ? readFileSync(join(h.bin, 'calls.log'), 'utf8').slice(-1500) : 'none'}`);
}
/**
 * A hub restart: the hub the login service started is stopped by its PIDs (SIGTERM, as a logout or an update stops
 * it), then its login service starts it again (`launchctl kickstart gui/<uid>/<label>`, the stand-in's).
 */
export async function restartHub(h: Home): Promise<string> {
  for (const pid of launchedPids(h)) if (alive(pid)) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  if (!(await waitFor(async () => !(await answers(socketOf(h), 500)) && !launchedPids(h).some(alive), 30_000))) throw Error(`BLOCKED: the hub at ${socketOf(h)} hasn't exited 30 s after SIGTERM to the PIDs its login service started`);
  const state = await run(join(h.bin, 'launchctl'), ['__state'], { env: childEnv(h) });
  const jobs = parseJson(state.stdout) as { label: string }[] | undefined;
  const label = jobs?.[0]?.label;
  if (!label) throw Error(`BLOCKED: the login service stand-in has no job to start again: ${shown(state)}`);
  const kick = await run(join(h.bin, 'launchctl'), ['kickstart', `gui/${process.getuid?.() ?? 501}/${label}`], { env: childEnv(h) });
  await hubUp(h).catch((error: Error) => { throw Error(`${error.message}; ${shown(kick)}; the hub's log ${JSON.stringify(hubLog(h))}`); });
  return `${terminal(state)}${terminal(kick)}`;
}
/** The last of the hub's log (the login service's StandardOutPath), for a BLOCKED message. */
export const hubLog = (h: Home): string => { try { return readFileSync(join(h.root, 'logs', 'hub.log'), 'utf8').slice(-2000); } catch { return '(none)'; } };
/** Why a lost hook may be the machine's doing: its load past its core count, or empty. */
export const loaded = (): string => (loadavg()[0]! > cpus().length ? `the machine is loaded past its ${cpus().length} cores, load average ${loadavg()[0]!.toFixed(1)}` : '');
const parseJson = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
class Conn {
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
/** An event as `events.read` serves it. */
export interface Ev { id: string; kind: string; ts: number; log_pos: number; session?: string; subject?: string; data: Line }
/** Every event in the record, read from the hub through `events.read`, paged by `log_pos`. */
export async function allEvents(h: Home): Promise<Ev[]> {
  const conn = await Conn.open(socketOf(h));
  try {
    await conn.hello(readFileSync(join(h.root, 'control.token'), 'utf8').trim());
    const out: Ev[] = [];
    for (let after = 0; ;) {
      const events = (await conn.call('events.read', { after, limit: 1000 })).events as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  } finally {
    conn.close();
  }
}
/** The record, or none while the hub doesn't answer (a restart). */
const eventsNow = (h: Home): Promise<Ev[]> => allEvents(h).catch(() => []);

// ---- The record's rows a criterion reads (README: Readings).
export const claimRef = (claim: Ev) => `claim:${claim.id}`;
export const claimsOf = (events: readonly Ev[], session: string): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.session === session);
export const verdictsOf = (events: readonly Ev[], claim: Ev): Ev[] => events.filter((e) => e.kind === 'verdict.made' && (e.subject === claimRef(claim) || e.data?.claim === claimRef(claim)));
/** The commit a verdict names as the one it judged. */
export const judged = (v: Ev): string => String(v.data?.commit ?? v.data?.key?.commit ?? '');
export interface RunRead { run: string; check: string; commit: string; started: number; outcome: string | null; tests_run: number | null; finishedAt: number | null; finished: Line | null }
export function runsOf(events: readonly Ev[], claim: Ev): RunRead[] {
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  return events.filter((e) => e.kind === 'run.started' && e.data.claim === claimRef(claim)).map((e) => {
    const f = finished.get(String(e.data.run));
    return {
      run: String(e.data.run), check: String(e.data.check), commit: String(e.data.commit), started: e.ts,
      outcome: f ? String(f.data.outcome) : null, tests_run: f && typeof f.data.tests_run === 'number' ? f.data.tests_run : null, finishedAt: f ? f.ts : null, finished: f ? f.data : null,
    };
  });
}

// ---- The Claude Code stand-in (fixtures/claude-code.mjs, #18's): one process per session; it runs every entry of the
// user settings file for a hook, as Claude Code does, and runs Bash commands as its children.
export interface HookRun { command: string; async: boolean; code: number | null; signal: string | null; stdout: string; stderr: string; started: number; ended: number | null; timedOut: boolean }
export interface Fired { ran: HookRun[]; background: HookRun[]; settingsError?: string }
class Claude {
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
  private send(command: Line, timeoutMs = 900_000): Promise<Line> {
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
  async hook(event: string, body: Line): Promise<Fired> {
    return (await this.send({ op: 'hook', event, payload: body, settings: this.h.settings })) as unknown as Fired;
  }
  async exec(command: string, cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return (await this.send({ op: 'exec', command, cwd })) as unknown as { code: number; stdout: string; stderr: string };
  }
  exit(): void {
    try { this.child.stdin!.end(); } catch { /* gone */ }
  }
}
/** Whether a command is DeepBuild's: it runs deep-hook or the deep CLI. */
export const isDeepBuild = (command: unknown): boolean => typeof command === 'string' && (/deep-hook/.test(command) || /packages\/cli\/dist\/main\.js/.test(command));

// ---- What the chat shows (README: Readings, 1).
/** A verdict line: a line naming a verdict, a send-back or checks still going (#83's words). */
const VERDICT_WORDS = /\b(PASS|FAIL|INVALID|INCONCLUSIVE|BLOCKED)\b|\bsent back\b|\bsays done\b|\bchecks? (running|queued)\b/;
/** The verdict lines a hook reply shows in the chat: the lines of its `systemMessage`, and the first line of a block's reason, that name a verdict. */
export function chatLines(reply: Line | undefined): string[] {
  if (!reply) return [];
  const lines = typeof reply.systemMessage === 'string' ? reply.systemMessage.split('\n') : [];
  if (reply.decision === 'block' && typeof reply.reason === 'string') lines.push(reply.reason.split('\n')[0]!);
  return [...new Set(lines.map((l) => l.trim()).filter((l) => VERDICT_WORDS.test(l)))];
}
/** The outcome a line reads: FAIL for a send-back (#83 spells a FAIL "sent back n/3"), then by the verdicts' precedence. */
export function outcomeOf(line: string): 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE' | 'PASS' | undefined {
  if (/\bFAIL\b|\bsent back\b/i.test(line)) return 'FAIL';
  for (const o of ['INVALID', 'BLOCKED', 'INCONCLUSIVE', 'PASS'] as const) if (new RegExp(`\\b${o}\\b`).test(line)) return o;
  return undefined;
}
/** A line that names `n` tests: "3 tests", "3 tests run", "ran 3 tests". */
export const countsTests = (line: string, n: number): boolean => new RegExp(`(^|[^0-9/])${n} tests?\\b`, 'i').test(line);
/** Whether a line names the failing test's file and line: `coupon.test.js:5`, with or without its folder. */
export const namesPlace = (line: string): boolean => line.includes(FAILING_AT.slice(FAILING_AT.indexOf('/') + 1));

// ---- A session driven through the stand-in (README: The fast session).
export interface Reply { event: string; started: number; ended: number; json: Line | undefined; stdout: string; lines: string[] }
export interface Call { id: string; name: string; input: Line; failed: boolean }
export interface StopRead {
  reply: Reply | undefined; fired: Fired;
  /** The claim the stop made, the commit HEAD was at, and the record after its verdict landed (or 120 s). */
  claim: Ev | undefined; head: string; events: Ev[];
  /** `deep status` in the checkout once the stop's verdict is in the record. */
  status: Ran;
  /** The machine's load past its cores when the stop's reply came, or empty. */
  loaded: string;
}
export class Drive {
  readonly id = randomUUID();
  readonly transcript: string;
  readonly replies: Reply[] = [];
  readonly calls: Call[] = [];
  private prompt: string | undefined;
  private readonly claude: Claude;
  task: string | undefined;
  private constructor(readonly h: Home, readonly repo: Repo) {
    this.claude = Claude.start(h);
    this.transcript = join(h.home, '.claude/projects', repo.dir.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
  }
  /** The session starts, you type PROMPT, and its task's definition locks (BLOCKED when it doesn't within 120 s). */
  static async open(h: Home, repo: Repo): Promise<Drive> {
    const d = new Drive(h, repo);
    await d.fire('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    await d.typed(PROMPT);
    const locked = await waitFor(async () => {
      const events = await eventsNow(h);
      const ask = events.find((e) => e.kind === 'user.ask' && e.session === d.id && e.data?.text === PROMPT);
      const task = Array.isArray(ask?.data?.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
      return task && events.some((e) => e.kind === 'definition.locked' && e.data?.task_ref === task) ? task : undefined;
    }, 120_000);
    if (!locked) {
      const events = await allEvents(h).catch((error: Error) => { throw Error(`BLOCKED: the record can't be read after the prompt: ${error.message}; the hub's log ${JSON.stringify(hubLog(h))}`); });
      throw Error(`${loaded() ? `INCONCLUSIVE (${loaded()}; deep-hook acts alone on a hub that answers late, #315): ` : ''}BLOCKED: the prompt opened no task whose definition locked with the approved check (${events.length} events in the record; the hub's log ${JSON.stringify(hubLog(h))}): ${events.filter((e) => e.session === d.id || e.kind.startsWith('definition.')).map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 300)}`).join('; ')}`);
    }
    d.task = locked;
    return d;
  }
  private append(entry: Line): void {
    const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: this.id, cwd: this.repo.dir, version: COVERED, userType: 'external', entrypoint: 'cli', ...entry };
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  async fire(event: string, extra: Line = {}): Promise<Fired> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.repo.dir, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...extra };
    const fired = await this.claude.hook(event, body);
    if (fired.settingsError) throw Error(`BLOCKED: the Claude Code stand-in couldn't read ${this.h.settings}: ${fired.settingsError}`);
    for (const r of fired.ran.filter((x) => isDeepBuild(x.command))) {
      const json = r.stdout.trim() ? parseObject(r.stdout.trim()) : undefined;
      this.replies.push({ event, started: r.started, ended: r.ended ?? Date.now(), json, stdout: r.stdout, lines: chatLines(json) });
    }
    return fired;
  }
  /** A prompt you type: in the transcript with a person's origin, then UserPromptSubmit; DeepBuild's reply to it. */
  async typed(text: string): Promise<Reply | undefined> {
    this.prompt = randomUUID();
    this.append({ type: 'user', promptId: this.prompt, message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const before = this.replies.length;
    await this.fire('UserPromptSubmit', { prompt: text });
    return this.replies.slice(before).find((r) => r.event === 'UserPromptSubmit');
  }
  private async call(name: string, input: Line, act: () => Promise<{ failed: boolean; response: Line; error: string }>): Promise<Call> {
    const id = `toolu_${randomBytes(12).toString('hex')}`;
    this.append({ type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id, name, input }] } });
    await this.fire('PreToolUse', { tool_name: name, tool_input: input, tool_use_id: id });
    const done = await act();
    this.append({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: done.failed ? done.error : JSON.stringify(done.response), ...(done.failed ? { is_error: true } : {}) }] } });
    if (done.failed) await this.fire('PostToolUseFailure', { tool_name: name, tool_input: input, tool_use_id: id, error: done.error, is_interrupt: false, duration_ms: 80 });
    else await this.fire('PostToolUse', { tool_name: name, tool_input: input, tool_response: done.response, tool_use_id: id, duration_ms: 40 });
    const c = { id, name, input, failed: done.failed };
    this.calls.push(c);
    return c;
  }
  bash(command: string): Promise<Call> {
    return this.call('Bash', { command, description: command }, async () => {
      const r = await this.claude.exec(command, this.repo.dir);
      return { failed: r.code !== 0, response: { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false, noOutputExpected: false }, error: `Exit code ${r.code}\n${`${r.stdout}${r.stderr}`.trim()}`.slice(0, 4000) };
    });
  }
  /** The fix: a Read and an Edit of src/coupon.js. */
  async fix(): Promise<void> {
    const file = join(this.repo.dir, 'src', 'coupon.js');
    await this.call('Read', { file_path: file }, async () => ({ failed: false, response: { type: 'text', file: { filePath: file, content: readFileSync(file, 'utf8'), numLines: 4, startLine: 1, totalLines: 4 } }, error: '' }));
    await this.call('Edit', { file_path: file, old_string: FIX_FROM, new_string: FIX_TO, replace_all: false }, async () => {
      writeFileSync(file, readFileSync(file, 'utf8').replace(FIX_FROM, FIX_TO));
      return { failed: false, response: { filePath: file, oldString: FIX_FROM, newString: FIX_TO, replaceAll: false }, error: '' };
    });
  }
  /** The stop: its last message in the transcript, then Stop. Resolves with DeepBuild's reply to it. */
  async stopOnly(message: string, active: boolean): Promise<{ reply: Reply | undefined; fired: Fired }> {
    this.append({ type: 'assistant', message: { role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: message }] } });
    const before = this.replies.length;
    const fired = await this.fire('Stop', { stop_hook_active: active, last_assistant_message: message });
    return { reply: this.replies.slice(before).find((r) => r.event === 'Stop'), fired };
  }
  /** A stop, read back: the claim it made, its verdict in the record (or 120 s), and `deep status` then. */
  async stop(message: string, active: boolean): Promise<StopRead> {
    const known = new Set(claimsOf(await eventsNow(this.h), this.id).map((c) => c.id));
    const head = git(this.h, this.repo.dir, 'rev-parse', 'HEAD');
    const { reply, fired } = await this.stopOnly(message, active);
    const load = loaded();
    const claim = await this.claimAfter(known);
    let events = await eventsNow(this.h);
    if (claim) events = (await waitFor(async () => { const e = await eventsNow(this.h); return verdictsOf(e, claim).length ? e : undefined; }, 120_000)) ?? await eventsNow(this.h);
    const status = await deep(this.h, ['status'], { cwd: this.repo.dir });
    return { reply, fired, claim, head, events, status, loaded: load };
  }
  async claimAfter(known: ReadonlySet<string>, timeoutMs = 30_000): Promise<Ev | undefined> {
    return waitFor(async () => claimsOf(await eventsNow(this.h), this.id).find((c) => !known.has(c.id)), timeoutMs);
  }
  async end(): Promise<void> {
    try { await this.fire('SessionEnd', { reason: 'prompt_input_exit' }); } finally { this.claude.exit(); }
  }
}

// ---- The worlds (README: The worlds).
/** The issue's checkpoint: the false done held and sent back, the fix, its PASS, and "all done?". */
export interface MainWorld { h: Home; repo: Repo; d: Drive; firstRun: Call; first: StopRead; fixSha: string; second: StopRead; allDone: Reply | undefined; events: Ev[]; sessions: string[] }
export async function mainWorld(folder: string): Promise<MainWorld> {
  const h = makeHome({ fast: true });
  const repo = checkout(h, 'main');
  const setup = await setUp(h, repo);
  const terminals = [terminal(setup)];
  const d = await Drive.open(h, repo);
  try {
    const firstRun = await d.bash('npm test');
    if (!firstRun.failed) throw Error('BLOCKED: `npm test` passed before the fix, so there is no failing coupon test to hold the stop on');
    const first = await d.stop('Done: the coupon test is fixed.', false);
    terminals.push(`(stop 1) ${JSON.stringify(first.reply?.json ?? null)}`, terminal(first.status));
    await d.fix();
    const again = await d.bash('npm test');
    if (again.failed) throw Error('BLOCKED: `npm test` still fails after the fix');
    await d.bash(`git commit -am "${COMMIT_MESSAGE}"`);
    const fixSha = git(h, repo.dir, 'rev-parse', 'HEAD');
    if (fixSha === repo.base) throw Error('BLOCKED: the session made no commit');
    const second = await d.stop('The coupon test passes now and the fix is committed.', true);
    terminals.push(`(stop 2) ${JSON.stringify(second.reply?.json ?? null)}`, terminal(second.status));
    const allDone = await d.typed(STATUS_QUESTION);
    terminals.push(`(${STATUS_QUESTION}) ${JSON.stringify(allDone?.json ?? null)}`);
    await d.end();
    const events = await allEvents(h);
    const sessions = [...new Set(events.map((e) => e.session).filter((s): s is string => typeof s === 'string'))];
    writeProof(folder, 'main', { d, events, terminals });
    return { h, repo, d, firstRun, first, fixSha, second, allDone, events, sessions };
  } catch (error) {
    writeProof(folder, 'main', { d, events: await eventsNow(h), terminals });
    throw error;
  }
}
/** One of AC3's and AC6's sessions: one stop on a world's variant, and "all done?" after its verdict landed. */
export interface SideRun { variant: Variant; d: Drive; stop: { reply: Reply | undefined }; claim: Ev | undefined; allDone: Reply | undefined; events: Ev[]; restart?: string }
export interface SideWorld { zero: SideRun | { error: Error }; masked: SideRun | { error: Error }; cut: SideRun | { error: Error } }
async function sideRun(h: Home, variant: Variant, folder: string): Promise<SideRun> {
  const repo = checkout(h, variant);
  const d = await Drive.open(h, repo);
  const terminals: string[] = [];
  try {
    const known = new Set(claimsOf(await eventsNow(h), d.id).map((c) => c.id));
    let restart: string | undefined;
    let cutClaim: Ev | undefined;
    let stop: { reply: Reply | undefined };
    if (variant === 'slow') {
      // The fix (the slow test passes), then the stop; once a run of its claim's check has started, a hub restart cuts it short.
      await d.fix();
      const stopping = d.stopOnly('Done: the coupon discount is fixed.', false);
      const started = await waitFor(async () => {
        const events = await eventsNow(h);
        const claim = claimsOf(events, d.id).find((c) => !known.has(c.id));
        return claim && runsOf(events, claim).some((r) => r.outcome === null) ? claim : undefined;
      }, 120_000);
      if (!started) throw Error(`BLOCKED: no run of the claim's check started within 120 s of the stop, so there was nothing for a hub restart to cut short: ${(await eventsNow(h)).filter((e) => e.session === d.id).map((e) => e.kind).join(', ')}`);
      cutClaim = started;
      restart = await restartHub(h);
      stop = await stopping;
      // A hub that doesn't answer after its restart never shows the cut check's line: the criterion reads that, below.
      if (!(await waitFor(() => allEvents(h).then(() => true, () => false), 180_000))) {
        const status = await deep(h, ['status'], { cwd: repo.dir, timeoutMs: 60_000 });
        restart += `(the record can't be read 3 min after the restart; ${loaded() || 'the machine not loaded past its cores'}; deep status then: ${shown(status)}; the hub's log ${JSON.stringify(hubLog(h))})\n`;
      }
    } else {
      await d.bash('npm test');
      stop = await d.stopOnly('Done: the coupon test is fixed.', false);
    }
    const claim = cutClaim ?? await d.claimAfter(known, 60_000);
    if (!claim) throw Error(`BLOCKED: the ${variant} world's stop made no claim: ${(await allEvents(h)).filter((e) => e.session === d.id).map((e) => e.kind).join(', ')}`);
    await waitFor(async () => verdictsOf(await eventsNow(h), claim).length > 0, 180_000);
    const allDone = await d.typed(STATUS_QUESTION);
    await d.end();
    const events = variant === 'slow' ? await eventsNow(h) : await allEvents(h);
    terminals.push(`(stop) ${JSON.stringify(stop.reply?.json ?? null)}`, ...(restart ? [`(hub restarted)\n${restart}`] : []), `(${STATUS_QUESTION}) ${JSON.stringify(allDone?.json ?? null)}`);
    writeProof(folder, variant, { d, events, terminals });
    return { variant, d, stop, claim, allDone, events, ...(restart ? { restart } : {}) };
  } catch (error) {
    writeProof(folder, variant, { d, events: await eventsNow(h), terminals });
    throw error;
  }
}
/** AC3's and AC6's worlds, one home and hub: zero tests, a masked exit, and a check cut short by a hub restart (last). */
export async function sideWorld(folder: string): Promise<SideWorld> {
  const h = makeHome({ fast: true });
  await setUp(h, checkout(h, 'main'));
  const tryRun = async (variant: Variant) => { try { return await sideRun(h, variant, folder); } catch (error) { return { error: error as Error }; } };
  const zero = await tryRun('zero-tests');
  const masked = await tryRun('masked');
  const cut = await tryRun('slow');
  return { zero, masked, cut };
}

// ---- Each criterion's check: a list of problems, each starting with its ID; none is a pass.
const shownLines = (r: Reply | undefined) => (r ? `${JSON.stringify(r.lines)} (reply ${r.stdout.trim().slice(0, 1200) || 'empty'})` : 'no reply from DeepBuild\'s entry');
const shownRuns = (events: readonly Ev[], claim: Ev | undefined) => (claim ? JSON.stringify(runsOf(events, claim).map((r) => ({ check: r.check, commit: r.commit.slice(0, 12), outcome: r.outcome, tests_run: r.tests_run }))) : 'no claim');
const shownVerdicts = (events: readonly Ev[], claim: Ev | undefined) => (claim ? JSON.stringify(verdictsOf(events, claim).map((v) => ({ outcome: v.data.outcome, commit: judged(v), reasons: v.data.reasons }))) : 'no claim');

/**
 * A stop whose check hadn't ended when the hold replied, on a machine loaded past its cores: the hold may end before a
 * starved check does, so it reads nothing either way (INCONCLUSIVE, thrown, never a pass).
 */
function unrunUnderLoad(id: string, stop: StopRead): void {
  const ran = stop.claim && stop.reply ? runsOf(stop.events, stop.claim).some((r) => r.finishedAt !== null && r.finishedAt <= stop.reply!.ended) : false;
  if (!ran && stop.loaded) throw Error(`${id} INCONCLUSIVE: no run of the stop's check ended before its hold replied, with ${stop.loaded}: ${JSON.stringify(stop.reply?.lines ?? [])}`);
}
/** AC1: the first stop held while the check ran; one line, FAIL, the failing test's file and line, the count of tests run; sent back. */
export function heldFailProblems(w: MainWorld): string[] {
  const { reply, claim, events } = w.first;
  const out: string[] = [];
  if (!reply) return [`${AC1} the first stop must get a reply from DeepBuild's Stop entry: ${JSON.stringify(w.first.fired.ran.map((r) => r.command))}`];
  if (!claim) out.push(`${AC1} the first stop (a turn that ran \`npm test\`) must make a claim on ${w.d.task}`);
  const runs = claim ? runsOf(events, claim).filter((r) => r.finishedAt !== null) : [];
  unrunUnderLoad(AC1, w.first);
  if (!runs.some((r) => r.check === CHECK || r.check.includes('npm-test'))) out.push(`${AC1} the approved check ${CHECK} must run on the first stop's claim: its runs ${shownRuns(events, claim)}`);
  if (!runs.some((r) => r.finishedAt! <= reply.ended)) out.push(`${AC1} the first stop must be held until its check ran: the Stop entry replied at ${reply.ended}, its claim's runs finished at ${JSON.stringify(runs.map((r) => r.finishedAt))}`);
  if (reply.lines.length !== 1) out.push(`${AC1} the chat must show one verdict line at the first stop: ${shownLines(reply)}`);
  const line = reply.lines[0] ?? '';
  if (outcomeOf(line) !== 'FAIL' || /\bPASS\b/.test(line)) out.push(`${AC1} the first stop's line must read FAIL (a send-back), never PASS: ${JSON.stringify(line)}`);
  if (!namesPlace(line)) out.push(`${AC1} the first stop's line must name the failing test's file and line, ${FAILING_AT}: ${JSON.stringify(line)}`);
  if (!countsTests(line, TESTS)) out.push(`${AC1} the first stop's line must give the count of tests run, ${TESTS} tests: ${JSON.stringify(line)}`);
  if (reply.json?.decision !== 'block' || typeof reply.json.reason !== 'string' || !reply.json.reason.trim()) out.push(`${AC1} the first stop must be sent back so the session goes on (a block with its reason): ${shownLines(reply)}`);
  return out;
}
/** AC2: the stop after the fix reads PASS with its test count, and its verdict names the commit it judged. */
export function passProblems(w: MainWorld): string[] {
  const { reply, claim, events } = w.second;
  const out: string[] = [];
  if (!reply) return [`${AC2} the stop after the fix must get a reply from DeepBuild's Stop entry`];
  unrunUnderLoad(AC2, w.second);
  if (reply.lines.length !== 1 || outcomeOf(reply.lines[0]!) !== 'PASS') out.push(`${AC2} the stop after the fix must show one line reading PASS: ${shownLines(reply)}`);
  else if (!countsTests(reply.lines[0]!, TESTS)) out.push(`${AC2} the PASS line must give its test count, ${TESTS} tests: ${JSON.stringify(reply.lines[0])}`);
  if (reply.json?.decision === 'block') out.push(`${AC2} a PASS lets the stop end, never sends it back: ${shownLines(reply)}`);
  if (!claim) return [...out, `${AC2} the stop after the fix must make a claim`];
  const pass = verdictsOf(events, claim).filter((v) => v.data.outcome === 'PASS');
  if (!pass.length) out.push(`${AC2} the record must hold a PASS verdict on the claim after the fix: ${shownVerdicts(events, claim)}; runs ${shownRuns(events, claim)}`);
  else if (!pass.every((v) => judged(v) === w.fixSha)) out.push(`${AC2} the PASS verdict must name the commit it judged, the fix ${w.fixSha}: ${shownVerdicts(events, claim)}`);
  return out;
}
/** AC4: every verdict line the chat showed is a row in the record with the commit it judged, and `deep status` shows the same outcome. */
export function recordProblems(w: MainWorld): string[] {
  unrunUnderLoad(AC4, w.first);
  unrunUnderLoad(AC4, w.second);
  const out: string[] = [];
  for (const [n, stop] of [[1, w.first], [2, w.second]] as const) {
    const line = stop.reply?.lines[0];
    const outcome = line ? outcomeOf(line) : undefined;
    if (!line || !outcome) { out.push(`${AC4} stop ${n}'s chat must show a verdict line to hold the record to: ${shownLines(stop.reply)}`); continue; }
    const rows = stop.claim ? verdictsOf(stop.events, stop.claim) : [];
    const row = rows.find((v) => v.data.outcome === outcome);
    if (!row) out.push(`${AC4} stop ${n}'s line reads ${outcome} (${JSON.stringify(line)}), but the record holds no ${outcome} verdict on its claim ${stop.claim ? claimRef(stop.claim) : '(none)'}: ${shownVerdicts(stop.events, stop.claim)}`);
    else if (judged(row) !== stop.head) out.push(`${AC4} stop ${n}'s ${outcome} verdict must name the commit it judged, ${stop.head}: it names ${JSON.stringify(judged(row))}`);
    const block = sessionBlock(stop.status.stdout, w.d.id, w.sessions);
    const said = outcome === 'FAIL' ? /\bFAIL\b|\bsent back\b/i : new RegExp(`\\b${outcome}\\b`);
    if (stop.status.code !== 0 || !block || !said.test(block.join('\n'))) out.push(`${AC4} after stop ${n}, deep status must show the session with the chat's outcome, ${outcome}: ${shown(stop.status)}`);
  }
  for (const claim of claimsOf(w.events, w.d.id)) {
    for (const v of verdictsOf(w.events, claim)) {
      if (!/^[0-9a-f]{40}$/.test(judged(v)) || judged(v) !== String(claim.data.commit)) out.push(`${AC4} verdict ${v.id} (${v.data.outcome}) on ${claimRef(claim)} must name the commit it judged, its claim's ${claim.data.commit}: it names ${JSON.stringify(judged(v))}`);
    }
  }
  return out;
}
/** AC5: "all done?" is answered from the record: blocked from the model, its answer the record's newest verdict. */
export function allDoneProblems(w: MainWorld): string[] {
  unrunUnderLoad(AC5, w.second);
  const r = w.allDone;
  const claims = claimsOf(w.events, w.d.id);
  const newest = claims.length ? verdictsOf(w.events, claims[claims.length - 1]!).at(-1) : undefined;
  const out: string[] = [];
  if (!newest) out.push(`${AC5} the record must hold a verdict on the session's newest claim to answer from: ${shownVerdicts(w.events, claims.at(-1))}`);
  if (r?.json?.decision !== 'block' || typeof r.json.reason !== 'string') return [...out, `${AC5} "${STATUS_QUESTION}" must be answered by DeepBuild's prompt entry, blocking the prompt so no model call is made: ${shownLines(r)}`];
  if (newest && !new RegExp(`\\b${newest.data.outcome}\\b`).test(r.json.reason)) out.push(`${AC5} the answer to "${STATUS_QUESTION}" must read the record's newest verdict, ${newest.data.outcome}: ${JSON.stringify(r.json.reason)}`);
  return out;
}
const sideOf = (r: SideRun | { error: Error }): SideRun => { if ('error' in r) throw r.error; return r; };
/** Every verdict line DeepBuild's entries showed in a session's chat. */
const allLines = (d: Drive) => d.replies.flatMap((r) => [...r.lines, ...(r.event === 'UserPromptSubmit' && typeof r.json?.reason === 'string' ? [r.json.reason.split('\n')[0]!] : [])]);
/** AC3: zero tests reads INVALID; a check cut short by a hub restart reads INCONCLUSIVE; neither line ever says PASS. */
export function cutAndZeroProblems(w: SideWorld): string[] {
  const out: string[] = [];
  const zero = sideOf(w.zero);
  const zeroLine = zero.stop.reply?.lines[0];
  if (!zeroLine || outcomeOf(zeroLine) !== 'INVALID') out.push(`${AC3} a check that ran zero tests must read INVALID at its stop: ${shownLines(zero.stop.reply)}; runs ${shownRuns(zero.events, zero.claim)}; verdicts ${shownVerdicts(zero.events, zero.claim)}`);
  const cut = sideOf(w.cut);
  const answer = typeof cut.allDone?.json?.reason === 'string' ? cut.allDone.json.reason.split('\n')[0]! : '';
  if (outcomeOf(answer) !== 'INCONCLUSIVE') out.push(`${AC3} a check cut short by a hub restart must read INCONCLUSIVE (the line "${STATUS_QUESTION}" gets after the restart): ${shownLines(cut.allDone)}; the restart ${JSON.stringify(cut.restart ?? '')}; runs ${shownRuns(cut.events, cut.claim)}; verdicts ${shownVerdicts(cut.events, cut.claim)}`);
  if (cut.claim && !verdictsOf(cut.events, cut.claim).some((v) => v.data.outcome === 'INCONCLUSIVE')) out.push(`${AC3} the cut-short check's claim must have an INCONCLUSIVE verdict in the record: ${shownVerdicts(cut.events, cut.claim)}`);
  for (const run of [zero, cut]) {
    const passing = allLines(run.d).filter((l) => /\bPASS\b/.test(l));
    if (passing.length) out.push(`${AC3} no line of the ${run.variant} world's session may say PASS: ${JSON.stringify(passing)}`);
    if (run.claim && verdictsOf(run.events, run.claim).some((v) => v.data.outcome === 'PASS')) out.push(`${AC3} the ${run.variant} world's claim must never be judged PASS: ${shownVerdicts(run.events, run.claim)}`);
  }
  return out;
}
/** AC6: a check whose command masks its exit status is never PASS: its verdict is INVALID (or FAIL), and no line says PASS. */
export function maskedProblems(w: SideWorld): string[] {
  const m = sideOf(w.masked);
  const named = `${CHECK} (\`npm test\`, whose package script is \`vitest run || true\`)`;
  const out: string[] = [];
  const verdicts = m.claim ? verdictsOf(m.events, m.claim) : [];
  if (!verdicts.length) out.push(`${AC6} the check ${named} must be judged: no verdict on ${m.claim ? claimRef(m.claim) : 'its claim'}; runs ${shownRuns(m.events, m.claim)}`);
  const wrong = verdicts.filter((v) => !['INVALID', 'FAIL'].includes(String(v.data.outcome)));
  if (wrong.length) out.push(`${AC6} the check ${named} masks its exit status, so its claim is INVALID (or FAIL on its failing test), never ${wrong.map((v) => v.data.outcome).join(', ')}: ${shownVerdicts(m.events, m.claim)}; runs ${shownRuns(m.events, m.claim)}`);
  const passing = allLines(m.d).filter((l) => /\bPASS\b/.test(l));
  if (passing.length) out.push(`${AC6} no line may say PASS on the check ${named}: ${JSON.stringify(passing)}`);
  return out;
}

// ---- deep status (#19): a session is shown by a line holding the first 8 characters of its ID.
const id8 = (id: string) => id.slice(0, 8).toLowerCase();
/** The session's lines in a status listing: from the first line naming it to the next line naming another session of the record. */
export function sessionBlock(output: string, session: string, sessions: readonly string[]): string[] | undefined {
  const all = output.split('\n');
  const at = all.findIndex((l) => l.toLowerCase().includes(id8(session)));
  if (at < 0) return undefined;
  const others = sessions.filter((o) => o !== session).map(id8);
  let end = at + 1;
  while (end < all.length && !others.some((o) => all[end]!.toLowerCase().includes(o))) end++;
  return all.slice(at, end);
}

// ---- The live session through the agent test harness (README: Additions, the fix-coupon-test scenario).
export function realClaude(): string {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const file = join(dir, 'claude');
    if (dir && existsSync(file)) return realpathSync(file);
  }
  throw Error('BLOCKED: no claude on PATH');
}
export async function harnessRun(h: Home, repo: Repo, token: string): Promise<{ ran: Ran; line: Line | undefined }> {
  const args = [HARNESS, 'run', '--scenario', SCENARIO, '--workdir', repo.dir, '--pass-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--claude', h.claude, '--timeout-ms', '1200000', '--out', join(h.tmp, 'out')];
  const ran = await run(NODE, args, { env: childEnv(h, { SHELL: '/bin/zsh', CLAUDE_CODE_OAUTH_TOKEN: token }), cwd: REPO, timeoutMs: 1_500_000, shownAs: `node ${args.slice(0, 7).join(' ')} …` });
  return { ran, line: jsonLines(ran.stdout).find((l) => typeof l.run === 'string' && 'verdict' in l) };
}
/** The strings an entry of a transcript holds, depth first. */
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
/**
 * What a real session's chat showed, from its transcript (README: Readings, 7): each hook message Claude Code saved
 * (`hook_system_message`, a Stop hook's feedback, a blocked prompt's `hook_blocked_prompt`) in order, with its verdict
 * lines; and the tool calls, with whether each failed.
 */
export function transcriptReading(transcript: string): { shown: { at: number; kind: 'message' | 'feedback' | 'blocked'; text: string; lines: string[] }[]; entries: Line[] } {
  const entries = existsSync(transcript) ? jsonLines(readFileSync(transcript, 'utf8')).filter((e) => e.isSidechain !== true) : [];
  const shown: { at: number; kind: 'message' | 'feedback' | 'blocked'; text: string; lines: string[] }[] = [];
  entries.forEach((e, at) => {
    const raw = JSON.stringify(e);
    const kind = raw.includes('hook_blocked_prompt') ? 'blocked' : raw.includes('hook_system_message') ? 'message' : /Stop hook feedback/i.test(raw) ? 'feedback' : undefined;
    if (!kind) return;
    const text = strings(e.attachment ?? e.message ?? e.content ?? e).filter((s) => VERDICT_WORDS.test(s)).join('\n');
    const lines = [...new Set(text.split('\n').map((l) => l.trim()).filter((l) => VERDICT_WORDS.test(l)))];
    shown.push({ at, kind, text, lines });
  });
  return { shown, entries };
}

// ---- The proof (README: The proof), rewritten on each run and never read back.
function writeProof(folder: string, world: string, o: { d: Drive; events: Ev[]; terminals: string[] }): void {
  const of = o.events.filter((e) => e.session === o.d.id);
  const claims = claimsOf(o.events, o.d.id);
  proof(folder, `${world}-transcript.jsonl`, existsSync(o.d.transcript) ? readFileSync(o.d.transcript) : '');
  proof(folder, `${world}-chat.json`, o.d.replies.map((r) => ({ event: r.event, lines: r.lines, reply: r.json ?? r.stdout })));
  proof(folder, `${world}-record.json`, {
    claims: claims.map((c) => ({ id: claimRef(c), commit: c.data.commit, task: c.data.task_ref })),
    verdicts: claims.flatMap((c) => verdictsOf(o.events, c).map((v) => ({ id: v.id, claim: claimRef(c), outcome: v.data.outcome, commit: judged(v), reasons: v.data.reasons }))),
    runs: claims.flatMap((c) => runsOf(o.events, c)),
    events: of,
  });
  proof(folder, `${world}-terminal.txt`, `${o.terminals.join('\n')}\n`);
  proof(folder, 'machine.txt', `${machine()}\n`);
}
export function proof(folder: string, name: string, content: unknown): void {
  const dir = join(PROOF_DIR, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), typeof content === 'string' || Buffer.isBuffer(content) ? content : `${JSON.stringify(content, null, 2)}\n`);
}
export function machine(): string {
  const model = (() => { try { return execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim(); } catch { return 'unknown model'; } })();
  return `${model}; ${cpus()[0]?.model ?? 'unknown chip'}; ${Math.round(totalmem() / 2 ** 30)} GiB; load average ${loadavg().map((l) => l.toFixed(1)).join(' ')}; node ${process.version}`;
}
