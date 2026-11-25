// Test-side tools for #3220's acceptance tests (README): the criterion tags and seams; a world under /tmp/dh3220-* (a home
// with the shipped default guards, a bin folder with `deep`, a `claude` that lists no plugins and the stand-in heavy
// command, the test's readings of available memory and memory pressure, and a sample repo with linked worktrees); the hub
// as a process (`deep hub run`) told its cores and its `mem` pool; the record read back through the hub's socket; Claude
// Code sessions driven through the real deep-hook, each from a process of its own (fixtures/agent.mjs); `deep lease`; and
// the readings the criteria judge. Adapted from tests/acceptance/322/helpers.ts and 1015's, 1016's and 1018's (same repo,
// same license); this suite keeps its own copy so a redraft of theirs never moves these tests. Nothing here stands in for
// DeepBuild: every reading comes from the real hub, deep-hook, `deep lease`, the supervisor and the record.
//
// Safety: every folder is under /tmp/dh3220-* and removed after its file; HOME is a temp folder for the hub and every
// child; this process's CLAUDE*, DEEP_*, GIT_* and XDG_* settings are taken out of every child's environment. Every
// process a test starts is stopped by its PID or its process group's ID, never by name or port. No network, no model.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { cpus, homedir, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
export const DEEP_HOOK = join(REPO, 'target/debug/deep-hook');
const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const FACTS = join(REPO, 'adapters/claude-code.facts.json');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const AGENT = join(FIXTURES, 'agent.mjs');

// ---- Criterion tags: `#3220.` and the first 8 hex of the SHA-256 of the criterion's text, trimmed, white space
// collapsed (scripts/budget-window.mjs's criterionId), then the criterion's place in the issue.
export const AC1 = '#3220.023c3e9b AC1';
export const AC2 = '#3220.ade7d70e AC2';
export const AC3 = '#3220.4f86303d AC3';
export const AC4 = '#3220.ea9feb2e AC4';
export const AC5 = '#3220.33b787b4 AC5';
export const AC6 = '#3220.d549cdd6 AC6';
export const AC7 = '#3220.24f80034 AC7';
export const AC8 = '#3220.783a59e5 AC8';
export const AC9 = '#3220.c2610cec AC9';

// ---- The seams (README, Seams and plants): what the hub is told, and the planted wrong programs (DEEP_HUB_PLANT).
/** The `mem` pool's size on this host, in MB (its units), as the hub is told it, as DEEP_HUB_TEST_CORES tells it its cores. */
export const MEM_POOL_VAR = 'DEEP_HUB_TEST_MEM_MB';
/** A file holding the host's available memory in MB, which the hub reads in place of the kernel's reading (#2980's). */
export const AVAILABLE_VAR = 'DEEP_TEST_MEMORY_AVAILABLE_FILE';
export const PLANTS = {
  /** AC1: the supervisor's scan keeps its first sample of a run as its peak. */
  firstSample: 'scan-keeps-first-sample',
  /** AC2: a run whose tree the scan couldn't read records a peak of 0. */
  unreadZero: 'unread-peak-recorded-zero',
  /** AC3: a check's run on a key is admitted on its class's constant of 1 GB, whatever its key's runs used. */
  classConstant: 'admits-on-class-constant',
  /** AC3: a run is admitted reading no number: it takes no memory. */
  readsNothing: 'admits-on-nothing',
  /** AC4: a run is admitted on the pool alone, whatever the host's available memory. */
  poolOnly: 'admits-on-pool-only',
  /** AC5: a check's run on a key with fewer than three clean runs is admitted on one run's peak. */
  onePeak: 'admits-on-one-peak',
  /** AC7: an agent's heavy command is admitted on its last run's peak. */
  lastPeak: 'admits-heavy-on-last-peak',
} as const;
/** What every world's hub reads as the host's available memory unless a test sets it: far more than any run here needs. */
export const PLENTY_MB = 1_000_000;

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
/** Polls until `ok` holds or `ms` passes; returns whether it held. */
export async function until(ok: () => boolean | Promise<boolean>, ms: number, every = 250): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok()) return true;
    if (Date.now() > deadline) return false;
    await sleep(every);
  }
}
/** The newest Claude Code version the facts cover: every transcript entry carries it, so no session is watch-only. */
const COVERED = (() => { const v = (JSON.parse(readFileSync(FACTS, 'utf8')) as { versions: string[] }).versions; return v[v.length - 1]!; })();

// ---- Verdicts. A judgement fails at a vitest `expect`; a scenario that never reached its criterion throws an Error
// starting BLOCKED, and a reading under load past the machine's cores is INCONCLUSIVE (a skip), never a pass.
export class Inconclusive extends Error {}
/** The machine's load is past its cores: a time bound read now is a reading, not a verdict. */
export function loaded(): string | null {
  const load = loadavg()[0]!;
  return load >= cpus().length ? `1-minute load ${load.toFixed(1)} is past the ${cpus().length} cores` : null;
}
export async function verdict(ctx: TestContext, judge: () => void | Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
    throw error;
  }
}
/** The message a judgement throws, or null when it holds; BLOCKED and INCONCLUSIVE are thrown on, never read as a failure. */
export async function failureOf(judge: () => unknown): Promise<string | null> {
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
/**
 * A judgement that holds on the right program fails on the planted one, and its failure names each of `names`. The
 * judgement passing on the plant fails here, at an `expect`.
 */
export async function mustFail(what: string, judge: () => unknown, names: string[] = []): Promise<void> {
  const message = await failureOf(judge);
  expect(message, `${what}: the planted wrong program passed the judgement, so it proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
}

// ---- Temp folders, under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh3220-'));
  made.push(dir);
  return dir;
}

// ---- Processes this suite started: stopped by PID or process group, never by name or port.
const owned = new Set<number>();
const groups = new Set<number>();
export function own(pid: number | undefined, group = false): void {
  if (pid) (group ? groups : owned).add(pid);
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
/** Stops every process and process group this suite started (SIGTERM, then SIGKILL after 3 s) and removes its folders. */
export async function cleanup(): Promise<void> {
  await stopOwned();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
/** Stops every process and process group this suite started: SIGTERM, then SIGKILL after 3 s. */
async function stopOwned(): Promise<void> {
  for (const pgid of groups) try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
  for (const pid of owned) {
    try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ }
    try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  for (const pgid of groups) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  groups.clear();
  agents.clear();
}
afterAll(cleanup, 120_000);

/** Variables that make an agent bill an API account, or a build use another's jobs or caches; a child never inherits these. */
const DROPPED = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GH_TOKEN', 'GITHUB_TOKEN', 'AI_AGENT', 'NODE_OPTIONS',
  'MAKEFLAGS', 'MFLAGS', 'CARGO_MAKEFLAGS', 'CARGO_TARGET_DIR', 'RUSTC_WRAPPER', 'CARGO_BUILD_RUSTC_WRAPPER', 'TMPDIR'];
/** The environment a child gets: HOME the world's, none of this process's DEEP_/GIT_/XDG_/CLAUDE settings, and `extra` on top. */
export function childEnv(home: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('DEEP_') || key.startsWith('XDG_') || key.startsWith('GIT_') || key.startsWith('CLAUDE') || key.startsWith('VITEST') || DROPPED.includes(key)) continue;
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
export function git(home: string, cwd: string, args: string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  }).trim();
}

// ---- The definitions the kernel is handed (DEEP_HUB_TEST_DRAFTS), in #322's shape.
export interface Requirement { id: string; text: string; source_line: string; refuted_by: string; check: string | null; on_base: 'fails' | 'passes'; asserts: string[]; depth: string; oracle: 'code' | 'model' | 'person'; near_misses: string[] }
export interface Draft { ask: string; requirements: Requirement[]; deliverables: string[]; budget: null }
/** The prompt every session types: a change to NOTES.md, which no check reads. */
export const PROMPT = 'add a line to the notes';
/**
 * The definition handed for PROMPT: one requirement with no drafted check of its own, so a claim's only check runs are
 * the repo's spec checks (README, The fixture repo).
 */
export const DRAFT: Draft = {
  ask: PROMPT,
  requirements: [{ id: 'R1', text: 'The notes keep their lines', source_line: 'ask#L1', refuted_by: 'a run where the notes lose a line', check: null, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [] }],
  deliverables: ['NOTES.md'],
  budget: null,
};
/** Your ask settings (#319's shape): setup's drafts with no `batch`. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};

// ---- The world.
export interface WorldOptions {
  /** The sample repo's files at its one commit on `main`, path to bytes; none: no repo. */
  files?: Record<string, string>;
  /** Linked worktrees of the repo, `w1` … `wN`, each on a branch of its own. */
  worktrees?: number;
  /** The `mem` pool's size, in MB (MEM_POOL_VAR). */
  memMb: number;
  /** The host's available memory, in MB, as the hub reads it (AVAILABLE_VAR); PLENTY_MB unless given. */
  availableMb?: number;
  /** DEEP_HUB_PLANT. */
  plant?: string;
  /** DEEP_HUB_TEST_CORES: 16, so the `cpu.slot` pool (half the cores, less the slot kept for quick checks) is 7. */
  cores?: number;
}
/** One `deep lease` this suite started: its process, its output so far, and its end. */
export interface Leased { pid: number; output(): string; done: Promise<{ code: number | null; signal: string | null; at: number }>; finished(): boolean }
export interface Hub { pid: number; socket: string; child: ChildProcess; exit: Promise<void>; stderr(): string }

/**
 * A home with the shipped default guards and your settings, a bin folder, the readings the hub is told, and the sample
 * repo with its worktrees. The repo and every worktree are trusted, as Claude Code's workspace trust records it in
 * `~/.claude.json` (#322: the hub reads it for a repo's spec checks).
 */
export class World {
  readonly tmp = tempDir();
  readonly home = join(this.tmp, 'h');
  readonly root = join(this.home, '.deepbuild');
  readonly bin = join(this.tmp, 'bin');
  readonly temp = join(this.tmp, 'tmp');
  readonly availableFile = join(this.tmp, 'available');
  readonly pressureFile = join(this.tmp, 'pressure');
  readonly draftsFile = join(this.tmp, 'drafts.json');
  readonly confirm = join(this.tmp, 'confirm');
  readonly work = join(this.tmp, 'work.json');
  readonly repo: string;
  readonly worktrees: string[] = [];
  hub: Hub | undefined;
  constructor(readonly o: WorldOptions) {
    mkdirSync(join(this.home, '.claude'), { recursive: true });
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    mkdirSync(this.bin);
    mkdirSync(this.temp);
    writeFileSync(join(this.root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
    writeFileSync(join(this.root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
    writeFileSync(this.confirm, 'confirmed\n');
    writeFileSync(this.draftsFile, `${JSON.stringify({ drafts: [DRAFT] }, null, 2)}\n`);
    writeFileSync(this.work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
    writeFileSync(this.pressureFile, 'normal\n');
    this.setAvailable(o.availableMb ?? PLENTY_MB);
    writeFileSync(join(this.bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`, { mode: 0o755 });
    writeFileSync(join(this.bin, 'claude'), `#!/bin/sh\n[ "$1 $2" = "plugin list" ] && echo '[]'\nexit 0\n`, { mode: 0o755 });
    writeFileSync(join(this.bin, 'memjob'), `#!/bin/sh\nexec '${NODE}' '${join(FIXTURES, 'memjob.mjs')}' "$@"\n`, { mode: 0o755 });
    this.repo = join(this.tmp, 'repo');
    const trusted: Line = {};
    if (o.files) {
      for (const [path, bytes] of Object.entries(o.files)) {
        mkdirSync(dirname(join(this.repo, path)), { recursive: true });
        writeFileSync(join(this.repo, path), bytes);
      }
      git(this.home, this.repo, ['init', '-q', '-b', 'main']);
      git(this.home, this.repo, ['add', '-A']);
      git(this.home, this.repo, ['commit', '-q', '-m', 'the sample repo']);
      this.repo = realpathSync(this.repo);
      for (let i = 1; i <= (o.worktrees ?? 0); i++) {
        const tree = join(this.tmp, `w${i}`);
        git(this.home, this.repo, ['worktree', 'add', '-q', '-b', `session-${i}`, tree, 'main']);
        this.worktrees.push(realpathSync(tree));
      }
      for (const path of [this.repo, ...this.worktrees]) trusted[path] = { allowedTools: [], hasTrustDialogAccepted: true };
    }
    writeFileSync(join(this.home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: 'acct-dh3220-0001', emailAddress: 'you@example.test' }, numStartups: 3, projects: trusted }, null, 2)}\n`);
  }
  /** The host's available memory as the hub reads it, in MB: written whole, a new file renamed over the old. */
  setAvailable(mb: number): void {
    writeFileSync(`${this.availableFile}.new`, `${mb}\n`);
    renameSync(`${this.availableFile}.new`, this.availableFile);
  }
  /** The environment of the hub, of `deep lease` and of every command it runs, with `extra` on top. */
  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
    return childEnv(this.home, {
      PATH: `${this.bin}:${dirname(NODE)}:/opt/homebrew/opt/rustup/bin:${process.env.PATH ?? '/usr/bin:/bin'}`,
      SHELL: '/bin/sh',
      TMPDIR: this.temp,
      // A temporary HOME would leave rustup and Cargo homeless: theirs stay put, and the pinned toolchain is used.
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
      CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
      RUSTUP_TOOLCHAIN: channel,
      CARGO_NET_OFFLINE: 'true',
      DEEP_HUB_TEST_CONFIRM: this.confirm,
      DEEP_HUB_TEST_DRAFTS: this.draftsFile,
      DEEP_HUB_TEST_WORK: this.work,
      DEEP_HUB_TEST_CORES: String(this.o.cores ?? 16),
      [MEM_POOL_VAR]: String(this.o.memMb),
      [AVAILABLE_VAR]: this.availableFile,
      DEEP_TEST_MEMORY_PRESSURE_FILE: this.pressureFile,
      DEEP_HUB_PLANT: this.o.plant,
      ...extra,
    });
  }
  /** `deep hub run` for this home. A hub that doesn't start (a plant the base doesn't list) is BLOCKED. */
  async startHub(): Promise<Hub> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI is not built at ${CLI} (npm run build --workspaces)`);
    if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: deep-hook is not built at ${DEEP_HOOK} (cargo build -p deep-hook)`);
    const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    own(child.pid);
    let out = '';
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = `${err}${d}`.slice(-400_000); });
    const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
    const ready = await Promise.race([
      new Promise<Line | undefined>((resolve) => {
        child.stdout!.setEncoding('utf8').on('data', (d: string) => {
          out += d;
          if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
        });
      }),
      exit.then(() => undefined),
      sleep(300_000).then(() => undefined),
    ]);
    if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${this.o.plant ? ` with DEEP_HUB_PLANT=${this.o.plant}` : ''} did not start: ${err.slice(-1500)}`);
    this.hub = { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), child, exit, stderr: () => err };
    return this.hub;
  }
  /** Stops the hub by its PID, then every session's process and `deep lease` this suite started, by theirs. */
  async stopHub(): Promise<void> {
    const hub = this.hub;
    if (hub) {
      try { process.kill(hub.pid, 'SIGTERM'); } catch { /* gone */ }
      const deadline = Date.now() + 30_000;
      while (alive(hub.pid) && Date.now() < deadline) await sleep(50);
      if (alive(hub.pid)) try { process.kill(hub.pid, 'SIGKILL'); } catch { /* gone */ }
      await hub.exit;
      this.hub = undefined;
    }
    await stopOwned();
  }
  /** One call on the hub's socket as the CLI makes it (the cli role, with the control token). */
  control(method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
    const hub = this.hub;
    if (!hub) throw Error('BLOCKED: no hub is running');
    const token = readFileSync(join(this.root, 'control.token'), 'utf8').trim();
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
  /** Every event of the record, in log order, through `events.read`. */
  async events(): Promise<Ev[]> {
    const out: Ev[] = [];
    let after = 0;
    for (;;) {
      const read = await this.control('events.read', { after, limit: 1000 });
      const events = (typeof read.events === 'string' ? JSON.parse(read.events) : read.events) as Ev[];
      if (!events.length) return out;
      out.push(...events);
      after = events[events.length - 1]!.log_pos;
    }
  }
  /** A run's stdout as the hub kept it (`run.output`, from its evidence once it has ended). */
  async output(run: string): Promise<string> {
    const read = await this.control('run.output', { run, from: 0 });
    return Buffer.from(String(read.text ?? ''), 'base64').toString('utf8');
  }
  /** `deep lease <args>` in `cwd`, in a process group of its own, with this world's environment and `extra`. */
  lease(args: readonly string[], cwd: string, extra: Record<string, string> = {}): Leased {
    const child = spawn(NODE, [CLI, 'lease', ...args], { cwd, env: this.env(extra), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    own(child.pid);
    own(child.pid, true);
    let output = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (output += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (output += d));
    let over = false;
    const done = new Promise<{ code: number | null; signal: string | null; at: number }>((resolve) => child.on('exit', (code, signal) => { over = true; resolve({ code, signal, at: Date.now() }); }));
    return { pid: child.pid!, output: () => output, done, finished: () => over };
  }
}

// ---- The record.
/** One event as `events.read` returns it. */
export interface Ev { v?: number; id: string; kind: string; log_pos: number; ts: number; writer?: string; subject?: string; session?: string; data: Line; [key: string]: unknown }
export const said = (e: Ev | undefined): string => (e ? `${e.kind}@${e.v ?? '?'} at log_pos ${e.log_pos} ${JSON.stringify(e.data).slice(0, 600)}` : 'no event');

/** What a run's end records of what it used (README, Seams): `used` on its run.finished. */
export interface Used { memory_peak_mb?: unknown; cpu_s?: unknown }
/** One run as the record keeps it: its start and end, its key (#1018), what it was admitted on and what it used. */
export interface RunRead {
  run: string; check: string; claim: string; started: Ev; finished: Ev | undefined; outcome: string | null;
  /** run.started's needs.memory_mb: the number it was admitted on. */
  needs: number | undefined;
  /** run.finished's key.id. */
  key: string | undefined;
  /** run.finished's used, when it carries one. */
  used: Used | undefined;
  /** The units of the `mem` lease the run held (#3218's lease.acquired with units). */
  units: number | undefined;
}
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** The `mem` leases granted for each run: lease.acquired on kind `mem`, by the run it names, with its units. */
export function memLeases(events: readonly Ev[]): Map<string, { units: number | undefined; acquired: Ev; released: Ev | undefined }> {
  const byRun = new Map<string, { units: number | undefined; acquired: Ev; released: Ev | undefined }>();
  for (const e of events) {
    if (e.kind !== 'lease.acquired' || e.data.resource?.kind !== 'mem' || typeof e.data.run !== 'string') continue;
    const released = events.find((r) => r.kind === 'lease.released' && r.subject === e.subject && r.log_pos > e.log_pos);
    byRun.set(e.data.run, { units: num(e.data.units), acquired: e, released });
  }
  return byRun;
}
export function runsIn(events: readonly Ev[]): RunRead[] {
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  const mem = memLeases(events);
  return events.filter((e) => e.kind === 'run.started').map((started) => {
    const run = String(started.data.run);
    const f = finished.get(run);
    const used = f && typeof f.data.used === 'object' && f.data.used !== null ? (f.data.used as Used) : undefined;
    return {
      run, check: String(started.data.check), claim: String(started.data.claim), started, finished: f, outcome: f ? String(f.data.outcome) : null,
      needs: num(started.data.needs?.memory_mb), key: typeof f?.data.key?.id === 'string' ? String(f.data.key.id) : undefined, used, units: mem.get(run)?.units,
    };
  });
}
/** A run's peak as its end recorded it, or undefined. */
export const peakOf = (r: RunRead): number | undefined => num(r.used?.memory_peak_mb);
export const shownRun = (r: RunRead): string => `${r.run} (${r.check}, ${r.outcome ?? 'running'}, key ${r.key?.slice(0, 12) ?? 'none'}, needs.memory_mb ${r.needs ?? 'none'}, mem units ${r.units ?? 'none'}, used ${JSON.stringify(r.used ?? null)})`;

/** When a check's run held its memory, from the fixture's own `S <ms>` and `E <ms>` lines in its stdout. */
export interface Held { run: string; s: number; e: number }
export async function heldSpan(w: World, run: string): Promise<Held> {
  const text = await w.output(run);
  const s = /^S (\d+)/m.exec(text);
  const e = /^E (\d+)/m.exec(text);
  if (!s || !e) throw Error(`BLOCKED: ${run}'s stdout as the hub kept it holds no S and E lines of the fixture's: ${JSON.stringify(text.slice(0, 800))}`);
  return { run, s: Number(s[1]), e: Number(e[1]) };
}
/** The most spans that overlap at one instant. */
export function maxOverlap(spans: readonly { s: number; e: number }[]): number {
  const edges = spans.flatMap(({ s, e }) => [[s, 1], [e, -1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let best = 0;
  for (const [, d] of edges) { cur += d; best = Math.max(best, cur); }
  return best;
}

// ---- The sample repo's spec checks (README, The fixture repo).
/** A spec check `name`: `node --test test/<name>.mjs`, the fixture allocating `mib` and holding it `holdMs`, with `memory_mb` declared when given. */
export interface SpecCheck { name: string; mib: number; holdMs: number; memoryMb?: number }
/** The repo's files: NOTES.md, each check's test and its numbers under test/, and `.deepbuild/done.yaml` naming them. */
export function sampleFiles(checks: SpecCheck[]): Record<string, string> {
  const files: Record<string, string> = { 'NOTES.md': '# notes\n\n- first\n' };
  const entries: string[] = [];
  for (const c of checks) {
    files[`test/${c.name}.mjs`] = readFileSync(join(FIXTURES, 'check-alloc.mjs'), 'utf8');
    files[`test/${c.name}.json`] = `${JSON.stringify({ mib: c.mib, hold_ms: c.holdMs })}\n`;
    entries.push(`  ${c.name}: { type: command, run: "node --test test/${c.name}.mjs"${c.memoryMb === undefined ? '' : `, memory_mb: ${c.memoryMb}`} }`);
  }
  files['.deepbuild/done.yaml'] = `claims:\n  done:\n    checks: [${checks.map((c) => c.name).join(', ')}]\nchecks:\n${entries.join('\n')}\n`;
  return files;
}

// ---- Each session's Claude Code (fixtures/agent.mjs): one long-lived process per session, the parent of every
// deep-hook run of that session, as Claude Code is of its hook commands.
export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; ms: number; timedOut: boolean; ended: number }
const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 600))}, stderr ${JSON.stringify(r.stderr.slice(0, 600))}`;
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
  static start(w: World, cwd: string): Agent {
    const child = spawn(NODE, [AGENT, DEEP_HOOK], { cwd: w.tmp, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }), stdio: ['pipe', 'pipe', 'ignore'] });
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

/** What deep-hook's output tells Claude Code: exit 2 or a deny/block decision stops the call; exit 0 lets it go. */
function allowed(r: Ran): boolean {
  const out = parseObject(r.stdout.trim());
  const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  return r.code === 0 && (d === undefined || d === 'allow');
}
const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });

/** A Claude Code session in one worktree: its transcript, its own Claude Code process, and its hooks through deep-hook. */
export class Session {
  readonly id = randomUUID();
  readonly transcript: string;
  private prompt: string | undefined;
  private parent: string | null = null;
  private turn = 0;
  constructor(readonly w: World, readonly cwd: string) {
    this.transcript = join(w.home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, '');
    agents.set(this.id, Agent.start(w, cwd));
  }
  private entry(value: Line): void {
    const uuid = randomUUID();
    const line = { parentUuid: this.parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: this.cwd, sessionId: this.id, version: COVERED, gitBranch: 'main' };
    this.parent = uuid;
    writeFileSync(this.transcript, `${JSON.stringify(line)}\n`, { flag: 'a' });
  }
  async hook(event: string, fields: Line = {}, timeoutMs = 240_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    return agents.get(this.id)!.run(['claude-code', event], this.cwd, JSON.stringify(body), timeoutMs);
  }
  async start(): Promise<void> {
    const r = await this.hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
    if (r.code !== 0) throw Error(`BLOCKED: the SessionStart hook must end with exit 0: ${shown(r)}`);
  }
  async typed(text: string): Promise<void> {
    this.prompt = randomUUID();
    this.turn += 1;
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: this.turn }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
    const r = await this.hook('UserPromptSubmit', { prompt: text });
    if (r.code !== 0 && r.code !== 2) throw Error(`BLOCKED: the UserPromptSubmit hook must end with exit 0: ${shown(r)}`);
  }
  private async call(tool_name: string, tool_input: Line, response: Line, effect?: () => void): Promise<void> {
    const id = `toolu_${randomBytes(10).toString('hex')}`;
    this.entry(assistant([{ type: 'tool_use', id, name: tool_name, input: tool_input }], 'tool_use'));
    const before = await this.hook('PreToolUse', { tool_name, tool_input, tool_use_id: id });
    if (!allowed(before)) throw Error(`BLOCKED: the ${tool_name} call must be allowed: ${shown(before)}`);
    effect?.();
    this.entry({ promptId: this.prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await this.hook('PostToolUse', { tool_name, tool_input, tool_use_id: id, tool_response: response, duration_ms: 40 });
  }
  /** The agent reads a file of its worktree (Read). */
  async read(file: string): Promise<void> {
    const path = join(this.cwd, file);
    const content = readFileSync(path, 'utf8');
    await this.call('Read', { file_path: path }, { type: 'text', file: { filePath: path, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } });
  }
  /** The agent replaces a file of its worktree whole (Edit), and the edit is made. */
  async edit(file: string, to: string): Promise<void> {
    const path = join(this.cwd, file);
    const from = readFileSync(path, 'utf8');
    await this.call('Edit', { file_path: path, old_string: from, new_string: to, replace_all: false }, { filePath: path, oldString: from, newString: to, replaceAll: false, structuredPatch: [], userModified: false }, () => writeFileSync(path, to));
  }
  /** The agent's last words of the turn, then Stop: the stop makes the claim. */
  async stop(): Promise<Ran> {
    this.entry(assistant([{ type: 'text', text: 'Done.' }], 'end_turn'));
    return this.hook('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
  }
}

/** The task a session's prompt opened, once its definition has locked; BLOCKED when none locks within 180 s. */
async function opened(w: World, s: Session): Promise<string> {
  let ref: string | undefined;
  let events: Ev[] = [];
  await until(async () => {
    events = await w.events();
    const ask = events.find((e) => e.kind === 'user.ask' && e.session === s.id && e.data.text === PROMPT);
    ref = Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
    return ref !== undefined && events.some((e) => e.kind === 'definition.locked' && e.data.task_ref === ref);
  }, 180_000, 500);
  if (!ref || !events.some((e) => e.kind === 'definition.locked' && e.data.task_ref === ref)) {
    throw Error(`BLOCKED: the prompt in ${s.cwd} opened no task with a locked definition: ${events.filter((e) => e.kind === 'user.ask' || e.kind.startsWith('definition.')).map(said).join('; ').slice(0, 2000)}`);
  }
  return ref;
}
/** A session ready to claim: started in `tree`, its prompt typed, its definition locked, NOTES.md read and changed to `notes`. */
export interface Claimer { s: Session; tree: string; ref: string }
export async function ready(w: World, tree: string, notes: string): Promise<Claimer> {
  const s = new Session(w, tree);
  await s.start();
  await s.typed(PROMPT);
  const ref = await opened(w, s);
  await s.read('NOTES.md');
  await s.edit('NOTES.md', notes);
  return { s, tree, ref };
}
/** The claim a session's stop made, by its task: `claim:<id>`; BLOCKED when it made none. */
export function claimOf(events: readonly Ev[], k: Claimer): string {
  const made = events.find((e) => e.kind === 'claim.made' && e.data.task_ref === k.ref);
  if (!made) throw Error(`BLOCKED: the stop in ${k.tree} made no claim: the record holds ${[...new Set(events.map((e) => e.kind))].join(', ')}`);
  return `claim:${made.id}`;
}
/**
 * Waits until each claimer's claim is made and has a finished run of every check in `checks`, and no run of those claims
 * is still going; at most `ms`. Returns the record then. A claim that never ran a check is BLOCKED by the caller.
 */
export async function claimed(w: World, ks: Claimer[], checks: string[], ms = 900_000): Promise<Ev[]> {
  let events: Ev[] = [];
  await until(async () => {
    events = await w.events();
    const claims = ks.map((k) => events.find((e) => e.kind === 'claim.made' && e.data.task_ref === k.ref));
    if (claims.some((c) => !c)) return false;
    const runs = runsIn(events).filter((r) => claims.some((c) => r.claim === `claim:${c!.id}`));
    return runs.every((r) => r.finished) && claims.every((c) => checks.every((check) => runs.some((r) => r.claim === `claim:${c!.id}` && r.check === check && r.finished)));
  }, ms, 1000);
  return events;
}
/** One claim in `tree`: a session that changes NOTES.md to `notes` and stops; resolves once its runs of `checks` have ended. */
export async function claimOnce(w: World, tree: string, notes: string, checks: string[]): Promise<{ k: Claimer; claim: string; events: Ev[] }> {
  const k = await ready(w, tree, notes);
  await k.s.stop();
  const events = await claimed(w, [k], checks);
  return { k, claim: claimOf(events, k), events };
}

/** The `cc` build of fixtures/alloc.c, once per test process. */
let built: string | undefined;
export function allocBinary(): string {
  if (built) return built;
  const out = join(tempDir(), 'alloc');
  try {
    execFileSync('cc', ['-O1', '-o', out, join(FIXTURES, 'alloc.c')], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    throw Error(`BLOCKED: cc couldn't build fixtures/alloc.c: ${String((error as { stderr?: Buffer }).stderr ?? error)}`);
  }
  return (built = out);
}
/** A copy of a fixture in `dir`. */
export function fixtureIn(dir: string, name: string): string {
  copyFileSync(join(FIXTURES, name), join(dir, name));
  return join(dir, name);
}
/** A commit and claim handle for runs started with `run.start` that belong to no claim of a session's. */
export const NO_COMMIT = 'a'.repeat(40);
export const claimHandle = (): string => `claim:DH3220${randomBytes(6).toString('hex').toUpperCase()}`;
/** Waits until the run's run.finished is in the record; BLOCKED when it never comes. */
export async function finishedRun(w: World, run: string, ms = 300_000): Promise<RunRead> {
  let found: RunRead | undefined;
  await until(async () => { found = runsIn(await w.events()).find((r) => r.run === run); return Boolean(found?.finished); }, ms, 500);
  if (!found?.finished) throw Error(`BLOCKED: ${run} never finished within ${ms / 1000} s: ${found ? shownRun(found) : 'no run.started for it'}`);
  return found;
}
