import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { loadavg, availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { SLOW_SLOT, type Lease, type LeaseTable, type Resource } from '@deepbuild/leases';
import type { Result, RunOutcome } from '@deepbuild/verdicts';
import { gitEnv } from './env.js';
import { matches } from './glob.js';

const SLOT: Resource = { host: 'local', kind: 'cpu.slot', key: 'slot' };
const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> => new Promise((resolve, reject) => {
  execFile('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...gitEnv(), ...env } }, (error, stdout, stderr) => {
    if (error) reject(Error(`git ${args[0]}: ${stderr.trim() || error.message}`));
    else resolve(stdout.trim());
  });
});
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let runs = 0;
const runId = (): string => `run:${Date.now().toString(36).toUpperCase()}${(++runs).toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}`.replace(/[^0-9A-Za-z:]/g, '');

/** Where snapshot objects go: DeepBuild's own object store, reading the repo's objects as alternates. */
const DEFAULT_STORE = join(tmpdir(), 'deep-objects');
async function storeEnv(repo: string, store: string): Promise<NodeJS.ProcessEnv> {
  mkdirSync(store, { recursive: true });
  const common = await git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return { GIT_OBJECT_DIRECTORY: store, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(common, 'objects') };
}
async function snapshotOf(repo: string, store = DEFAULT_STORE): Promise<string> {
  const head = await git(repo, ['rev-parse', 'HEAD']);
  if (!(await git(repo, ['status', '--porcelain', '--untracked-files=all']))) return head;
  const dir = mkdtempSync(join(tmpdir(), 'deep-index-'));
  try {
    const index = join(dir, 'index');
    const gitDir = await git(repo, ['rev-parse', '--absolute-git-dir']);
    const env = { ...(await storeEnv(repo, store)), GIT_INDEX_FILE: index };
    if (existsSync(join(gitDir, 'index'))) copyFileSync(join(gitDir, 'index'), index);
    else await git(repo, ['read-tree', 'HEAD'], env);
    await git(repo, ['update-index', '-q', '--really-refresh', '--no-assume-unchanged', '--no-skip-worktree', '--', '.'], env).catch(() => undefined);
    await git(repo, ['add', '-A'], env);
    const tree = await git(repo, ['write-tree'], env);
    const fixed = { GIT_AUTHOR_NAME: 'DeepBuild', GIT_AUTHOR_EMAIL: 'snapshot@deepbuild.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_NAME: 'DeepBuild', GIT_COMMITTER_EMAIL: 'snapshot@deepbuild.invalid', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' };
    return await git(repo, ['commit-tree', tree, '-p', head, '-m', 'deep snapshot'], { ...env, ...fixed });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A temporary checkout of `commit`, outside every worktree: git's own worktree list, refs and stash stay as they were. */
async function checkoutOf(repo: string, commit: string, store = DEFAULT_STORE): Promise<string> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-checkout-')));
  const gitDir = await git(repo, ['rev-parse', '--absolute-git-dir']);
  const env = await storeEnv(repo, store);
  await git(repo, [`--work-tree=${dir}`, `--git-dir=${gitDir}`, 'read-tree', '--index-output', join(dir, '.deep-index'), commit], env);
  await git(repo, [`--work-tree=${dir}`, `--git-dir=${gitDir}`, 'checkout-index', '-a', '-f'], { ...env, GIT_INDEX_FILE: join(dir, '.deep-index') });
  rmSync(join(dir, '.deep-index'), { force: true });
  return dir;
}

/** The fast-lane leases each table has waiting: a slow run or heavy command asks for no slot while one waits (#907). */
const fastWaiting = new WeakMap<LeaseTable, number>();
/**
 * Waits for a `cpu.slot` lease from the table, as `holder` for `run`; never a queue of the runner's own. A held stop's
 * fast-lane check may take the slot the pool keeps for it, and takes the next free slot ahead of every slow run.
 */
export async function slot(table: LeaseTable, holder: string, run: string, lane: 'fast' | 'slow' = 'slow'): Promise<Lease> {
  return (await admit(table, holder, run, lane))[0]!;
}

/** The host's memory pool (#3218): a run takes its expected peak as its units (#3220). */
const MEM: Resource = { host: 'local', kind: 'mem', key: 'mem' };
/** Why a run waits for memory: DeepBuild's runs hold the pool, or the kernel reads less available than it expects. */
export type MemoryWait = { on: 'pool'; holders: Lease[]; free: number } | { on: 'outside'; available: number };
interface MemoryAsk {
  /** Its expected peak, in MB: the units of `mem` it takes beside its slot. */
  mb: number;
  /** The memory the kernel reads available, in MB: the run starts only while it is at least `mb`. Undefined holds nothing back. */
  available?: () => Promise<number | undefined>;
  /** Told why it waits whenever that changes. */
  waiting?: (why: MemoryWait) => void;
}
/**
 * `slot`, with the run's expected peak as units of `mem` in the same ask (#3220): both granted or neither. Since the pool
 * counts only what DeepBuild started, the run also waits while the kernel reads less memory available than it expects.
 */
export async function admit(table: LeaseTable, holder: string, run: string, lane: 'fast' | 'slow' = 'slow', memory?: MemoryAsk): Promise<Lease[]> {
  const fast = lane === 'fast';
  if (fast) fastWaiting.set(table, (fastWaiting.get(table) ?? 0) + 1);
  let told = '';
  const tell = (why: MemoryWait): void => {
    const said = why.on === 'pool' ? `pool ${why.holders.map((l) => l.id).join(',')}` : 'outside';
    if (said !== told) memory?.waiting?.(why);
    told = said;
  };
  try {
    for (let wait = 5; ; wait = fast ? 5 : Math.min(wait * 2, 50)) {
      if (fast || !fastWaiting.get(table)) {
        const asks = [{ resource: fast ? SLOT : { ...SLOT, key: SLOW_SLOT }, mode: 'exclusive' as const }, ...(memory ? [{ resource: MEM, mode: 'exclusive' as const, units: memory.mb }] : [])];
        const available = memory?.available && (await memFree(table)) >= memory.mb ? await memory.available() : undefined;
        if (available !== undefined && available < memory!.mb) tell({ on: 'outside', available });
        else {
          const got = await table.ask({ holder, run }, asks);
          if (got.status === 'granted') return got.leases;
          if (got.status === 'BLOCKED') throw Error(got.message);
          if (got.resource.kind === MEM.kind) tell({ on: 'pool', holders: got.holders, free: got.free ?? 0 });
        }
      }
      await sleep(wait);
    }
  } finally {
    if (fast) fastWaiting.set(table, fastWaiting.get(table)! - 1);
  }
}
/** The units of `mem` free on this host now: its n less what its leases take (#3220). */
export async function memFree(table: LeaseTable): Promise<number> {
  const kind = (await table.kinds()).find((k) => k.name === MEM.kind);
  const n = Number(/^pool\((\d+)\)$/.exec(kind?.match ?? '')?.[1] ?? 0);
  const held = (await table.leases()).filter((v) => v.lease.resource.kind === MEM.kind && v.lease.resource.host === MEM.host).reduce((sum, v) => sum + (v.lease.units ?? 1), 0);
  return n - held;
}
interface Spawned { exit: number | null; output: string; started_at: number; ended_at: number }
function spawnRun(argv: string[], cwd: string): Promise<Spawned> {
  return new Promise((resolve) => {
    const started_at = Date.now();
    let output = '';
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8').on('data', (d: string) => { output += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { output += d; });
    child.on('error', (error) => resolve({ exit: null, output: output + error.message, started_at, ended_at: Date.now() }));
    child.on('close', (code) => resolve({ exit: code, output, started_at, ended_at: Date.now() }));
  });
}

export interface ExecCheck { id: string; argv: string[] }
interface ExecuteOptions { repo: string; session: string; table: LeaseTable; checks: ExecCheck[]; plant?: 'ignores-limit' | 'own-slot-queue' | 'runs-in-worktree' }
interface ExecutedCheck { id: string; lease: string | null; queued_at: number; started_at: number; ended_at: number; wall_ms: number; exit: number | null; output: string; cwd: string }
export interface Executed { snapshot: string; checkout: string; snapshot_ms: number; checkout_ms: number; checkout_ready_at: number; checks: ExecutedCheck[] }

export async function executeClaim(o: ExecuteOptions): Promise<Executed> {
  const t0 = Date.now();
  const snapshot = await snapshotOf(o.repo);
  const t1 = Date.now();
  const checkout = o.plant === 'runs-in-worktree' ? o.repo : await checkoutOf(o.repo, snapshot);
  const ready = Date.now();
  const checks: ExecutedCheck[] = [];
  try {
    const one = async (c: ExecCheck): Promise<ExecutedCheck> => {
      const queued_at = Date.now();
      const run = runId();
      const lease = o.plant === 'ignores-limit' || o.plant === 'own-slot-queue' ? null : await slot(o.table, o.session, run);
      try {
        const r = await spawnRun(c.argv, checkout);
        return { id: c.id, lease: lease?.id ?? null, queued_at, started_at: r.started_at, ended_at: r.ended_at, wall_ms: r.ended_at - queued_at, exit: r.exit, output: r.output, cwd: checkout };
      } finally {
        if (lease) await o.table.release(lease.id, []);
      }
    };
    if (o.plant === 'ignores-limit') checks.push(...(await Promise.all(o.checks.map(one))));
    else for (const c of o.checks) checks.push(await one(c));
  } finally {
    if (checkout !== o.repo) rmSync(checkout, { recursive: true, force: true });
  }
  return { snapshot, checkout, snapshot_ms: t1 - t0, checkout_ms: ready - t1, checkout_ready_at: ready, checks };
}

interface Load { avg1: number; cores: number }
interface Memory { last: Map<string, { key: string; outcome: 'passed' | 'failed'; exit: number | null }>; kept: boolean }
interface VerdictMemory { dropEvidence(): void }
const memories = new WeakMap<VerdictMemory, Memory>();
export function verdictMemory(): VerdictMemory {
  const m: Memory = { last: new Map(), kept: true };
  const handle: VerdictMemory = { dropEvidence: () => { m.kept = false; } };
  memories.set(handle, m);
  return handle;
}
interface HeavyOptions {
  repo: string; session: string; table: LeaseTable; argv: string[]; inputs: string[]; memory: VerdictMemory;
  timing?: boolean; load?: () => Load; plant?: 'own-slot-queue' | 'ignores-lease-script' | 'no-reuse' | 'no-load-reading';
}
interface HeavyResult { reused: boolean; exit: number | null; outcome: 'passed' | 'failed'; lease: Lease | null; load: Load | null }

/** The digest of the files the declared inputs match, as the worktree holds them now. */
async function inputsKey(repo: string, inputs: string[], argv: string[]): Promise<string> {
  const files = (await git(repo, ['ls-files', '-co', '--exclude-standard'])).split('\n').filter((f) => f && inputs.some((g) => matches(g, f))).sort();
  const h = createHash('sha256').update(JSON.stringify(argv));
  for (const f of files) {
    h.update(`\0${f}\0`);
    try { h.update(readFileSync(join(repo, f))); } catch { h.update('\0missing'); }
  }
  return h.digest('hex');
}
const machineLoad = (): Load => ({ avg1: loadavg()[0]!, cores: availableParallelism() });

export async function runHeavy(o: HeavyOptions): Promise<HeavyResult> {
  const memory = memories.get(o.memory)!;
  const key = await inputsKey(o.repo, o.inputs, o.argv);
  const id = JSON.stringify([o.repo, o.argv]);
  const last = memory.last.get(id);
  if (o.plant !== 'no-reuse' && memory.kept && last?.key === key) return { reused: true, exit: last.exit, outcome: last.outcome, lease: null, load: null };
  const run = runId();
  const lease = o.plant === 'own-slot-queue' ? null : await slot(o.table, o.session, run);
  try {
    const script = join(o.repo, 'scripts/lease');
    const viaScript = o.plant !== 'ignores-lease-script' && existsSync(script) && (() => { try { accessSync(script, constants.X_OK); return true; } catch { return false; } })();
    const r = await spawnRun(viaScript ? [script, ...o.argv] : o.argv, o.repo);
    const outcome = r.exit === 0 ? 'passed' : 'failed';
    const load = o.timing && outcome === 'failed' && o.plant !== 'no-load-reading' ? (o.load ?? machineLoad)() : null;
    memory.last.set(id, { key, outcome, exit: r.exit });
    memory.kept = true;
    return { reused: false, exit: r.exit, outcome, lease, load };
  } finally {
    if (lease) await o.table.release(lease.id, []);
  }
}

interface TimedRun { outcome: RunOutcome; under_load: boolean; load: number | null; cores: number; output: string }
export function runTiming(check: { run(): { passed: boolean; output: string } }, machine: { load(): number; cores: number }): { outcome: Result; runs: TimedRun[] } {
  const runs: TimedRun[] = [];
  const counted = (): RunOutcome[] => runs.filter((r) => r.outcome !== 'uncounted').map((r) => r.outcome);
  while (!counted().includes('passed') && counted().length < 3) {
    const r = check.run();
    if (r.passed) { runs.push({ outcome: 'passed', under_load: false, load: null, cores: machine.cores, output: r.output }); continue; }
    const load = machine.load();
    const under = load > machine.cores && !runs.some((x) => x.under_load);
    runs.push({ outcome: under ? 'uncounted' : 'failed', under_load: under, load: under ? load : null, cores: machine.cores, output: r.output });
  }
  const outs = counted();
  const passes = outs.filter((o) => o === 'passed').length;
  const fails = outs.length - passes;
  return { outcome: passes && fails ? 'INCONCLUSIVE' : fails ? 'FAIL' : 'PASS', runs };
}
