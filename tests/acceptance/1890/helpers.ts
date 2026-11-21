// What #1890's two tests share (README): the hub's background-job test run as its own vitest run, its report read as
// the proof lanes read it; the machine's load; and a copy of the checkout whose hub is the planted one.
import { type ChildProcess, spawn } from 'node:child_process';
import { copyFileSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export interface Failure { id: string; state: string; message: string }
export interface Baseline { failures: Record<string, string>; lint: Record<string, number>; timing: string[] }
// The proof lanes' own readers, which have no types of their own: a vitest report as the lanes read it, the
// environment their runs get, and affected.mjs's sorting of failures against known-failures.json.
const script = async <T>(path: string): Promise<T> => (await import(join(ROOT, path))) as T;
const { reportResults } = await script<{ reportResults(cwd: string, text: string, label: string): { failures: Failure[]; passed: string[]; skips?: { id: string; note: string }[] } }>('scripts/lanes.mjs');
const { childEnv } = await script<{ childEnv(): NodeJS.ProcessEnv }>('scripts/proof-runs.mjs');
export const { classify } = await script<{ classify(failures: Failure[], findings: never[], baseline: Baseline): Record<'known' | 'fresh' | 'unsure', Failure[]> }>('scripts/affected.mjs');

/** The test the issue names, as the repository holds it. */
export const FILE = 'packages/hub/test/background.test.ts';
/** The criteria's IDs: `criterionId` (scripts/proof-change.mjs) over each criterion's text as this job received it. */
export const AC = { 1: '#1890.e77cd011', 2: '#1890.75952fb4' } as const;
/** The planted hub's name (README, Surface choices). */
export const PLANT = 'drops-job-failure';
export const CORES = availableParallelism();
/** The one-minute load average. */
const load = (): number => loadavg()[0]!;

const REPORTER = join(ROOT, 'scripts/proof-vitest-reporter.mjs');
/** One run of the file may take: the hub's start, the test's own 60 s, and its teardown. */
const RUN_MS = 300_000;

export interface Run { status: number | null; failures: Failure[]; passed: string[]; skips: { id: string; note: string }[]; output: string; seconds: number; load: [number, number] }

/**
 * FILE run by itself with vitest in `cwd`, as `npx vitest run <file>` runs it, with the proof lanes' reporter: its
 * results by test ID (`<file> › <test name>`, as scripts/affected.mjs and known-failures.json name a test), the load
 * average as it started and ended, and what vitest printed. Its process group is stopped by its PID at RUN_MS.
 */
export async function runFile(cwd: string): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1890-run-'));
  const report = join(dir, 'report.jsonl');
  writeFileSync(report, '');
  const started = performance.now(), before = load();
  const child = spawn(process.execPath, [join(cwd, 'node_modules/vitest/vitest.mjs'), 'run', FILE, '--reporter=default', `--reporter=${REPORTER}`], {
    cwd, env: { ...childEnv(), DEEP_PROOF_VITEST_REPORT: report }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let output = '';
  child.stdout!.on('data', (d) => { output += d; });
  child.stderr!.on('data', (d) => { output += d; });
  const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }, RUN_MS);
  const status = await new Promise<number | null>((done) => child.once('close', done));
  clearTimeout(timer);
  const results = reportResults(cwd, readFileSync(report, 'utf8'), 'vitest');
  rmSync(dir, { recursive: true, force: true });
  return { status, failures: results.failures, passed: results.passed, skips: results.skips ?? [], output, seconds: (performance.now() - started) / 1000, load: [before, load()] };
}

/** Whether every test of FILE that ran passed: one at least, none failed or skipped, the report whole, exit 0. */
export const passes = (run: Run): boolean => run.status === 0 && run.failures.length === 0 && run.skips.length === 0 && run.passed.some((id) => id.startsWith(`${FILE} › `));
/** A run in a few lines: how it ended, the load average as it started and ended, and each test's result. */
export const summary = (run: Run): string => [
  `${passes(run) ? 'passed' : 'failed'}, exit ${run.status} in ${run.seconds.toFixed(1)} s at load ${run.load[0].toFixed(1)} → ${run.load[1].toFixed(1)} (${CORES} cores)`,
  ...run.passed.map((id) => `  passed: ${id}`), ...run.failures.map((f) => `  ${f.state}: ${f.id}: ${f.message}`), ...run.skips.map((s) => `  skipped: ${s.id} ${s.note}`),
].join('\n');
/** The summary and the end of what vitest printed. */
export const told = (run: Run): string => `${summary(run)}\n${run.output.trim().split('\n').slice(-25).join('\n')}`;

// ---- The load: "loaded" is a one-minute load average above the core count, where scripts/affected.mjs sets a
// timing failure apart as loaded.
const busy: ChildProcess[] = [];
/** How long the load may take to rise above the core count once this suite adds its own. */
const LOAD_WAIT_MS = 240_000;
/**
 * Waits until the machine is loaded, and returns the load average. At or below the core count it first starts two busy
 * processes a core, which stay until `unload`: an idle machine is loaded by this suite, never skipped.
 */
export async function loaded(): Promise<number> {
  const end = Date.now() + LOAD_WAIT_MS;
  while (load() <= CORES) {
    if (!busy.length) for (let i = 0; i < 2 * CORES; i++) busy.push(spawn(process.execPath, ['-e', 'for (;;);'], { stdio: 'ignore' }));
    if (Date.now() > end) throw Error(`INCONCLUSIVE: the load average stayed at ${load().toFixed(1)}, not above the ${CORES} cores, ${LOAD_WAIT_MS / 1000} s after ${busy.length} busy processes started`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  return load();
}
/** Stops the busy processes `loaded` started, each by its PID; returns how many there were. */
export function unload(): number {
  const n = busy.length;
  for (const p of busy.splice(0)) p.kill('SIGKILL');
  return n;
}

// ---- The planted hub's checkout.
/**
 * A copy of the checkout to run FILE in: packages/hub and packages/cli copied, built output and the test file
 * included; every other path a link to the checkout's, node_modules laid out as the proof lanes lay a copy's, so
 * `@deepbuild/hub` and `@deepbuild/cli` reach the copies. With `plant`, the hub's built plant module is the checkout's
 * own behind one that answers `plant` from plantOf and activePlant whatever DEEP_HUB_PLANT says, so every hub the test
 * starts from there is that planted hub.
 */
export function copyOfCheckout(plant?: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1890-checkout-')));
  for (const name of readdirSync(ROOT)) {
    if (['.git', 'node_modules', 'packages', 'vitest.config.ts'].includes(name)) continue;
    symlinkSync(join(ROOT, name), join(dir, name));
  }
  // vitest's root is the copy's, with the checkout's config.
  copyFileSync(join(ROOT, 'vitest.config.ts'), join(dir, 'vitest.config.ts'));
  mkdirSync(join(dir, 'packages'));
  for (const name of readdirSync(join(ROOT, 'packages'))) {
    if (name === 'hub' || name === 'cli') cpSync(join(ROOT, 'packages', name), join(dir, 'packages', name), { recursive: true });
    else symlinkSync(join(ROOT, 'packages', name), join(dir, 'packages', name));
  }
  const link = (folder: string): void => {
    mkdirSync(join(dir, folder));
    for (const name of readdirSync(join(ROOT, folder))) {
      const from = join(ROOT, folder, name), to = join(dir, folder, name), stat = lstatSync(from);
      if (stat.isSymbolicLink() && !isAbsolute(readlinkSync(from))) symlinkSync(readlinkSync(from), to);
      else if (stat.isDirectory() && name.startsWith('@')) link(join(folder, name));
      // A tool's cache, such as vite's, is the copy's own.
      else if (stat.isDirectory() && name.startsWith('.') && name !== '.bin') mkdirSync(to);
      else symlinkSync(from, to);
    }
  };
  link('node_modules');
  if (plant) {
    const dist = join(dir, 'packages/hub/dist');
    renameSync(join(dist, 'plant.js'), join(dist, 'plant.checkout.js'));
    writeFileSync(join(dist, 'plant.js'), [
      `// #1890's planted hub (tests/acceptance/1890/README.md): the checkout's plant module, answering ${plant} whatever DEEP_HUB_PLANT says.`,
      `export * from './plant.checkout.js';`,
      `export function plantOf() { return ${JSON.stringify(plant)}; }`,
      `export const activePlant = () => ${JSON.stringify(plant)};`,
      '',
    ].join('\n'));
  }
  return dir;
}
