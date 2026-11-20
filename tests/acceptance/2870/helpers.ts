// Shared by #2870's acceptance tests. They reach the change only through what the README names: `node
// benchmarks/canvas.mjs judge`, which reads `{ current, base }` on stdin and prints its verdict as its last stdout line,
// and `node scripts/loads-lint.mjs --root <checkout>`, which prints one `FAIL loads: <path>:<line>: ...` line per finding
// or one `PASS loads` line.
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { onTestFinished } from 'vitest';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const suite = join(root, 'tests/acceptance/2870');
const twins = join(suite, 'twins');

/** Each criterion's tag: `#2870.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #2870.635d9a6f';
export const AC2 = 'AC2 #2870.348a454d';

const show = (result: SpawnSyncReturns<string>): string =>
  `exit ${result.status}${result.signal ? ` (${result.signal})` : ''}${result.error ? ` (${result.error.message})` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

/** A scratch folder, removed when the test ends. */
function scratch(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2870-')));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A scratch checkout: copies of this checkout's scripts/ and benchmarks/, an empty tests/acceptance/ and its node_modules linked. */
export function checkout(): string {
  const at = scratch();
  for (const folder of ['scripts', 'benchmarks']) cpSync(join(root, folder), join(at, folder), { recursive: true });
  mkdirSync(join(at, 'tests/acceptance'), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(at, 'node_modules'), 'dir');
  return at;
}

// ---------------------------------------------------------------------------------------------------
// AC1: the judge (README: The reports, How the plants work).

type Run = Record<string, number>;
interface Report { task: string; fingerprint: unknown; runs: Run[] }
interface Verdict { targets?: Record<string, { status?: string; reason?: string } | undefined> }

/** The two kinds of time target, each with the report a reference Mac at rest recorded for its task, in reports/. */
export const TARGETS = [
  { task: 'canvas-surface', target: 'rebuild_128_ms', floor: false },
  { task: 'playtest-throughput', target: 'fixture_realtime_x', floor: true },
] as const;
type Target = (typeof TARGETS)[number];

const recorded = ({ task }: Target): Report => JSON.parse(readFileSync(join(suite, 'reports', `${task}.json`), 'utf8')) as Report;

/** A one-minute load above the cores of any machine that judges a report: judgeLimit reads the cores where it runs. */
const LOADED = 4096;

/** The report with its third run changed. */
const third = (report: Report, change: (run: Run) => Run): Report => ({ ...report, runs: report.runs.map((run, i) => (i === 2 ? change(run) : run)) });

/** Each case: what it makes of a recorded report, and what its target must read. */
export const CASES: ReadonlyArray<{ name: string; want: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; report: (report: Report, target: Target) => Report }> = [
  { name: 'at rest, every run meets it', want: 'PASS', report: (report) => report },
  // A plain target's readings times 2.8, over its limit by far more than the margin; a floor's times 0.3, far under it.
  { name: 'at rest, every run misses it by far more than the margin', want: 'FAIL', report: (report, { target, floor }) =>
    ({ ...report, runs: report.runs.map((run) => ({ ...run, [target]: Number(((run[target] ?? NaN) * (floor ? 0.3 : 2.8)).toFixed(3)) })) }) },
  { name: `run 3's load at its start is ${LOADED}, above the cores`, want: 'INCONCLUSIVE', report: (report) => third(report, (run) => ({ ...run, loadStart: LOADED })) },
  { name: `run 3's load at its end is ${LOADED}, above the cores`, want: 'INCONCLUSIVE', report: (report) => third(report, (run) => ({ ...run, loadEnd: LOADED })) },
  { name: 'run 3 carries no load', want: 'INCONCLUSIVE', report: (report) => third(report, ({ loadStart: _start, loadEnd: _end, ...run }) => run) },
];

/** `node <at>/benchmarks/canvas.mjs judge` on `{ current: report, base: null }`, as the budget window's judgeTargets runs it. */
function judge(at: string, report: Report): { verdict: Verdict | null; output: string } {
  const result = spawnSync(process.execPath, [join(at, 'benchmarks/canvas.mjs'), 'judge'], { cwd: at, input: JSON.stringify({ current: report, base: null }), encoding: 'utf8', timeout: 120_000 });
  const output = show(result);
  try {
    return { verdict: JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '') as Verdict, output };
  } catch {
    return { verdict: null, output };
  }
}

export interface Misreading { target: string; name: string; read: string; line: string }

/** Each case of each target that the judge in the checkout `at` reads otherwise than the issue says; its line starts with the target. */
export function misreadings(at: string): Misreading[] {
  const found: Misreading[] = [];
  for (const target of TARGETS) {
    for (const { name, want, report } of CASES) {
      const { verdict, output } = judge(at, report(recorded(target), target));
      const got = verdict?.targets?.[target.target];
      if (got?.status === want) continue;
      const read = got?.status ?? 'no verdict';
      found.push({ target: target.target, name, read, line: `${target.target} (${target.task}, ${name}): reads ${read}, not ${want}${got ? `: ${got.reason ?? JSON.stringify(got)}` : `\n${output}`}` });
    }
  }
  return found;
}

/**
 * A scratch checkout whose scripts/benchmark.mjs is twins/drops-loads.mjs.txt: this checkout's own benchmarks/canvas.mjs
 * judge, copied there, gives judgeLimit everything but the loads.
 */
export function droppingLoads(): string {
  const at = checkout();
  const real = JSON.stringify(pathToFileURL(join(root, 'scripts/benchmark.mjs')).href);
  writeFileSync(join(at, 'scripts/benchmark.mjs'), readFileSync(join(twins, 'drops-loads.mjs.txt'), 'utf8').replaceAll("'BENCHMARK_URL'", real));
  return at;
}

// ---------------------------------------------------------------------------------------------------
// AC2: the lint (README: How the plants work).

/** Lays twins/<set>/ into the scratch checkout `at` under `to`, each file without its .txt; `<to>/<file>:<line>` for each line marked `// finding`. */
export function plant(at: string, set: string, to: string): string[] {
  const marked: string[] = [];
  mkdirSync(join(at, to), { recursive: true });
  for (const name of readdirSync(join(twins, set))) {
    const path = `${to}/${name.replace(/\.txt$/, '')}`;
    const text = readFileSync(join(twins, set, name), 'utf8');
    writeFileSync(join(at, path), text);
    text.split('\n').forEach((line, index) => {
      if (line.trimEnd().endsWith('// finding')) marked.push(`${path}:${index + 1}`);
    });
  }
  return marked;
}

/** `node scripts/loads-lint.mjs --root <at>`: each FAIL line as `<path>:<line>` (whole, in any other form), and how many PASS lines. */
export function lint(at: string): { status: number | null; fails: string[]; passes: number; output: string } {
  const result = spawnSync(process.execPath, [join(root, 'scripts/loads-lint.mjs'), '--root', at], { cwd: root, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const lines = result.stdout.split('\n').map((line) => line.trimEnd());
  const fails = lines.filter((line) => line.startsWith('FAIL')).map((line) => /^FAIL loads: (.+:\d+): judgeLimit gives no loads$/.exec(line)?.[1] ?? line);
  return { status: result.status, fails, passes: lines.filter((line) => line === 'PASS loads').length, output: show(result) };
}
