// Shared test-side tools for issue #31's acceptance tests (README): temp folders under /tmp/dh31-*, real git repos, the
// sample repo with its seeded bug and its fix, a world (the real record, asks, lease table and supervisor), test check
// kinds and readings of a repo and of DeepBuild's store. Nothing here stands in for the service under test: every
// reading of it comes from `openCheckouts` in `@deepbuild/gate`'s public entry.
//
// Safety: every folder is under /tmp/dh31-*; HOME is a temp folder for this process and every child; no network and no
// model; processes a test starts are stopped by PID only, never by name or port.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { commandCheckKind } from '../../../packages/checks-command/src/index.ts';
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, Failure } from '../../../packages/conformance/src/index.ts';
import { leaseKinds, portKind } from '../../../packages/env-local/src/index.ts';
import { openCheckouts, type CheckoutPlant, type Checkouts } from '../../../packages/gate/src/index.ts';
import { openLeases, type LeaseTable } from '../../../packages/leases/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const DAY = 86_400_000;
/** The command every Vitest check runs: the tool's own bin in the checkout's dependencies. */
export const VITEST = 'node_modules/.bin/vitest run';
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('GIT_') || key === 'AI_AGENT') delete process.env[key];
let HOME: string | undefined;
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh31-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh31-'));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
}, 300_000);

// ---- Real git repos.
export function git(cwd: string, args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=always', ...args], {
    cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test', ...env,
    },
  }).trim();
}
export function write(dir: string, files: Record<string, string>): void {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
}
export function commit(dir: string, files: Record<string, string>, message: string): string {
  write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}
/** A git repo on `main` with one commit holding `files` (none: an empty root commit). */
export function makeRepo(files: Record<string, string> = {}): string {
  const dir = join(tempDir(), 'repo');
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'base']);
  return dir;
}
/**
 * Clones the repo's installed dependencies into `dir`, copy-on-write where the file system can: the sample's install, ignored
 * by its .gitignore, and self-contained wherever the repo's node_modules comes from. An entry that is a link, at the top or
 * in a `@scope/`, becomes real files; links inside an entry (`.bin/*`) stay as they are. The repo's own workspace packages
 * (`@deepbuild/*`) stay out: nothing the sample runs imports them.
 */
export function install(dir: string): void {
  const from = join(REPO, 'node_modules');
  if (!existsSync(join(from, 'vitest'))) throw Error('BLOCKED: the repo\'s node_modules has no vitest (run npm ci once)');
  const clone = (source: string, into: string): void => {
    mkdirSync(into, { recursive: true });
    const entries: string[] = [];
    for (const name of readdirSync(source)) {
      const path = join(source, name);
      if (name === '@deepbuild' || !existsSync(path)) continue;
      if (name.startsWith('@') && statSync(path).isDirectory()) clone(path, join(into, name));
      else entries.push(path);
    }
    if (!entries.length) return;
    // -H follows the links named here and keeps their names; -R copies every link below them as a link, so nothing loops.
    try {
      execFileSync('/bin/cp', ['-cRH', ...entries, into], { stdio: 'pipe' });
    } catch {
      execFileSync('/bin/cp', ['-RH', ...entries, into], { stdio: 'pipe' });
    }
  };
  clone(from, join(dir, 'node_modules'));
}

// ---- The sample repo: a seeded bug on main, and the fix on a branch.
export const SEEDED = {
  'package.json': `${JSON.stringify({ name: 'dh31-shop', private: true, type: 'module' }, null, 2)}\n`,
  '.gitignore': 'node_modules/\ndist/\n',
  'src/cart.ts': 'export interface Cart { items: number[]; discount: number }\nexport function total(cart: Cart): number {\n  return cart.items.reduce((a, b) => a + b, 0);\n}\n',
};
export const FIXED_CART = 'export interface Cart { items: number[]; discount: number }\nexport function total(cart: Cart): number {\n  return cart.items.reduce((a, b) => a + b, 0) - cart.discount;\n}\n';
export const REGRESSION_TEST = "import { expect, it } from 'vitest';\nimport { total } from '../src/cart.ts';\n\nit('total takes the discount off', () => {\n  expect(total({ items: [100], discount: 10 })).toBe(90);\n});\n";
/** The file only main's tip holds: a base run that sees it ran on main's tip, not on the merge base. */
export const MAIN_ONLY = 'MAIN_ONLY.txt';
/**
 * The sample repo, on a new branch `name`: main holds the seeded bug; the branch is cut there and holds `files`; main
 * then moves on with `MAIN_ONLY.txt`, so the merge base isn't main's tip. `seed` adds to what main holds; `dependencies`
 * clones the install in.
 */
export function sampleBranch(name: string, files: Record<string, string>, o: { dependencies?: boolean; seed?: Record<string, string> } = {}): { repo: string; base: string; head: string } {
  const repo = makeRepo({ ...SEEDED, ...o.seed });
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-q', '-b', name]);
  const head = Object.keys(files).length ? commit(repo, files, name) : base;
  git(repo, ['checkout', '-q', 'main']);
  commit(repo, { [MAIN_ONLY]: 'moved on\n' }, 'main moves on');
  git(repo, ['checkout', '-q', name]);
  if (o.dependencies !== false) install(repo);
  return { repo, base, head };
}
/** The sample repo's real fix: the regression test and the change that makes it pass. */
export const REAL_FIX = { 'src/cart.ts': FIXED_CART, 'test/cart.test.ts': REGRESSION_TEST };

// ---- The world: a record, the asks core, the lease table with env-local's kinds, the supervisor on them, and the service.
export interface World {
  dir: string; record: RecordStore; leases: LeaseTable; sup: Supervisor; store: string; root: string;
  /** The real command check kind on the supervisor. */
  command: CheckRunnerFill;
  /** The service over this world's store and root, with these test kinds and the clock; `plant` selects a wrong program. */
  service(o?: { plant?: CheckoutPlant; kinds?: CheckRunnerFill[]; now?: () => number }): Promise<Checkouts>;
  close(): Promise<void>;
}
export async function openWorld(): Promise<World> {
  const dir = tempDir();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now });
  const port = portKind();
  for (const kind of leaseKinds) await leases.declare('env-local', kind, kind.name === port.kind ? port.free : undefined);
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } }, resources: [port], leases });
  const store = join(dir, 'store');
  const root = join(dir, 'checkouts');
  const command = commandCheckKind(sup);
  const open: Checkouts[] = [];
  return {
    dir, record, leases, sup, store, root, command,
    async service(o = {}) {
      const s = await openCheckouts({ store, root, kinds: [command, ...(o.kinds ?? [])], host: sup, leases, now: o.now ?? Date.now, ...(o.plant ? { plant: o.plant } : {}) });
      open.push(s);
      return s;
    },
    close: async () => {
      for (const s of open) await s.close();
      await sup.close();
      await record.close();
    },
  };
}

// ---- Checks.
export const spec = (kind: string, runner: string, inputs: string[] = []): CheckSpec => ({ kind, runner, inputs, depth: 'unit', oracle: 'code', contract: null });
export const vitestSpec = (inputs: string[] = []): CheckSpec => spec('command', VITEST, inputs);

/** One call a test kind got: the folder it ran in and the files that folder held. */
export interface KindCall { checkout: string; files: string[]; result: CheckResult }
export const failed = (test: string, file: string, line: number, assertion: boolean, message: string): Failure => ({ test, file, line, assertion, message, stack: null });
const result = (outcome: CheckResult['outcome'], testsRun: number, failures: Failure[] = []): CheckResult => ({ outcome, testsRun, failures, evidence: [], read: [], mask: null });
/**
 * A test check kind that isn't the command check, registered through the service's public entry: it passes when the
 * file its spec's runner names is in its checkout, and fails on an assertion at checks/feature.check:3 when it isn't.
 * It reads the real folder it's given, and logs each call. `during` runs inside the run.
 */
export function presenceKind(kind = 'presence', during?: (ctx: CheckContext) => void): CheckRunnerFill & { calls: KindCall[] } {
  const calls: KindCall[] = [];
  return {
    slot: 'check.kind@1', revision: 1, kind, calls,
    run: (s, ctx) => {
      during?.(ctx);
      const r = existsSync(join(ctx.checkout, s.runner)) ? result('passed', 1) : result('failed', 1, [failed('feature', 'checks/feature.check', 3, true, `expected ${s.runner}`)]);
      calls.push({ checkout: ctx.checkout, files: filesIn(ctx.checkout), result: r });
      return r;
    },
  };
}
/**
 * A test journey kind: its run reads src/page.html in its checkout, and overruns at `click()` on line 9 of its journey
 * file when the page has no button named by its spec's runner; with one, the journey passes.
 */
export function journeyKind(): CheckRunnerFill & { calls: KindCall[] } {
  const calls: KindCall[] = [];
  return {
    slot: 'check.kind@1', revision: 1, kind: 'journey', calls,
    run: (s, ctx) => {
      const page = join(ctx.checkout, 'src/page.html');
      const has = existsSync(page) && readFileSync(page, 'utf8').includes(`<button>${s.runner}</button>`);
      const r = has ? result('passed', 1) : result('overran', 1, [failed('apply coupon', 'journeys/coupon.journey.ts', 9, false, `click() on the button ${s.runner} overran its 30 s`)]);
      calls.push({ checkout: ctx.checkout, files: filesIn(ctx.checkout), result: r });
      return r;
    },
  };
}

// ---- Reading a real folder.
/** Every file under a folder, relative with `/`; links left out, and node_modules and .git only when asked. */
export function filesIn(root: string, o: { all?: boolean } = {}): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (!o.all && (entry.name === 'node_modules' || entry.name === '.git')) continue;
      const path = join(d, entry.name);
      if (lstatSync(path).isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}
/** Each file under a folder with its digest, as one text: two equal readings hold equal bytes. */
export const digestOf = (root: string): string => filesIn(root, { all: true }).map((f) => `${f} ${sha256(readFileSync(join(root, f)))}`).join('\n');

// ---- The repo's own state, read without touching it (no optional locks, so `status` never refreshes the index).
export interface RepoState { index: string; status: string; refs: string; objects: string; worktrees: string; stash: string; head: string }
export function repoState(repo: string): RepoState {
  const gitDir = git(repo, ['rev-parse', '--absolute-git-dir']);
  const common = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const index = join(gitDir, 'index');
  return {
    index: existsSync(index) ? sha256(readFileSync(index)) : 'none',
    status: git(repo, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all']),
    refs: git(repo, ['for-each-ref']),
    objects: filesIn(join(common, 'objects'), { all: true }).join('\n'),
    worktrees: git(repo, ['worktree', 'list', '--porcelain']),
    stash: git(repo, ['stash', 'list']),
    head: git(repo, ['rev-parse', 'HEAD']),
  };
}
/** What changed between two readings, by the field's name: `index`, `status`, `refs`, `objects`, `worktrees`, `stash`, `head`. */
export const changed = (before: RepoState, after: RepoState): string[] => (Object.keys(before) as (keyof RepoState)[]).filter((k) => before[k] !== after[k]);

// ---- DeepBuild's store, a bare git repo at `store` (README): read with the repo's objects as alternates, as the service does.
export function inStore(store: string, repo: string, args: readonly string[]): string {
  const common = git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return git(store, [`--git-dir=${store}`, ...args], { GIT_ALTERNATE_OBJECT_DIRECTORIES: join(common, 'objects') });
}
/** Whether the store's own objects hold `object` (no alternates). */
export function storeHolds(store: string, object: string): boolean {
  try {
    git(store, [`--git-dir=${store}`, 'cat-file', '-e', object]);
    return true;
  } catch {
    return false;
  }
}
/** Whether your repo's objects hold `object`. */
export function repoHolds(repo: string, object: string): boolean {
  try {
    git(repo, ['cat-file', '-e', object]);
    return true;
  } catch {
    return false;
  }
}
/** The objects in the store's own object folder, loose and packed. */
export function storeObjects(store: string): number {
  const counts = Object.fromEntries(git(store, [`--git-dir=${store}`, 'count-objects', '-v']).split('\n').map((l) => l.split(': ') as [string, string]));
  return Number(counts.count) + Number(counts['in-pack']);
}
export const storeRefs = (store: string): string => git(store, [`--git-dir=${store}`, 'for-each-ref', '--format=%(objectname)']);

// ---- Planted wrong programs: an assertion run on one must fail.
/** The message an assertion throws, or null when it holds. */
export async function failureOf(assertion: () => unknown): Promise<string | null> {
  try {
    await assertion();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
/**
 * Asserts a wrong program's reading fails the same assertion the right program's holds; the failure names what the
 * criterion says it names. The wrong program runs before this is called, outside the catch, so a service that doesn't
 * exist can never read as a wrong program caught.
 */
export async function mustFail(what: string, assertion: () => unknown, names: string[] = []): Promise<void> {
  const message = await failureOf(assertion);
  expect(message, `${what}: the planted wrong program passed the assertion, so the assertion proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
}

// ---- The reference-Mac judge (as #28's and #29's budgets): a timing result off a reference Mac is a reading only.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine is not a reference Mac on mains power with Low Power Mode off and a nominal thermal state, or null when it is. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
