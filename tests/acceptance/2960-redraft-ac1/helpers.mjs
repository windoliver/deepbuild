// Shared by the #2960 first-criterion tests. The code is reached only through the surfaces the issue names:
// `measureOnce` of scripts/benchmark.mjs on a budget's own command from benchmarks/budgets.json, and the
// counter's log contract count-children.c documents (its DEEP_COUNT_LOG lines), read only to name what a
// failing run left uncounted.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const DIAGNOSE = fileURLToPath(new URL('diagnose.mjs', import.meta.url));
// A captured budget run is stopped at measureOnce's own 300 s by default; a bench run under the counter on a
// loaded machine can take longer, and a timeout is no reading at all, so the tests allow more.
export const TIMEOUT_MS = 1_500_000;

export async function benchmark() {
  const module = await import(pathToFileURL(join(root, 'scripts/benchmark.mjs')).href);
  assert.equal(typeof module.measureOnce, 'function', 'scripts/benchmark.mjs exports no measureOnce()');
  return module;
}

export function budget(id) {
  const { tasks } = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8'));
  const task = tasks.find((candidate) => candidate.id === id);
  assert.ok(task, `benchmarks/budgets.json has no task ${id}`);
  return task;
}

// The criterion is macOS's, and two machine traps the issue names stop any count before it starts: a test
// that can't run is BLOCKED, never a pass.
export function macReady() {
  if (process.platform !== 'darwin') assert.fail('BLOCKED: this criterion is macOS\'s counter (count-children.c under /usr/bin/time -l)');
  const translated = spawnSync('/usr/sbin/sysctl', ['-n', 'sysctl.proc_translated'], { encoding: 'utf8' }).stdout.trim();
  if (translated === '1') assert.fail('BLOCKED: this test runs under Rosetta (sysctl.proc_translated = 1), so universal binaries start as x86_64; run it from a native arm64 shell');
  const cargo = spawnSync('/bin/sh', ['-c', 'command -v cargo'], { encoding: 'utf8' }).stdout.trim();
  if (!cargo) assert.fail('BLOCKED: no cargo on PATH; the deep-hook benches build the release deep-hook with it');
  const archs = spawnSync('/usr/bin/lipo', ['-archs', cargo], { encoding: 'utf8' }).stdout.trim().split(/\s+/);
  if (process.arch === 'arm64' && !archs.includes('arm64')) assert.fail(`BLOCKED: ${cargo} is ${archs.join(' ')} only, and the arm64 counter can't be inserted into it; put an arm64 cargo first on PATH`);
}

// The release deep-hook the deep-hook benches run, built before any run is measured, so a cold build can't
// stand in for the bench under measureOnce's timeout. The bench still runs its own (then no-op) build.
let built;
export function buildDeepHook() {
  if (built) return;
  execFileSync('cargo', ['build', '--locked', '-q', '--release', '-p', 'deep-hook'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024 });
  built = true;
}

const scratchDirectories = [];
after(() => { for (const directory of scratchDirectories) rmSync(directory, { recursive: true, force: true }); });

// Names each process the counter saw start and never saw end, from one more measureOnce run of the same
// command under diagnose.mjs, which hands back a copy of that run's counter log. Only called once a test
// has already failed, to say why.
export function diagnose(measureOnce, command) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2960-ac1-')));
  scratchDirectories.push(directory);
  const out = join(directory, 'log.json');
  let run;
  try {
    run = measureOnce([process.execPath, DIAGNOSE, out, ...command], root, false, TIMEOUT_MS);
  } catch (error) {
    return `(a second run to name them failed: ${error.message})`;
  }
  let copy;
  try {
    copy = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    return `(a second run to name them left no copy of the counter's log; it exited ${run.status})`;
  }
  if (copy.log === null) return '(the counter set no DEEP_COUNT_LOG in the command\'s environment, so its log could not be read)';
  const rows = copy.log.split('\n').filter(Boolean).map((line) => line.split(' '));
  const starts = rows.filter(([kind]) => kind === 'start').map(([, parent, child, ...path]) => ({ parent, child, path: path.join(' ') }));
  const ended = new Set([
    ...rows.filter(([kind]) => kind === 'reap' || kind === 'unread').map(([, , child]) => child),
    ...rows.filter(([kind]) => kind === 'exit').map(([, child]) => child),
  ]);
  const pathOf = (pid) => (pid === String(copy.pid) ? 'diagnose.mjs, which runs the budget\'s command' : starts.find(({ child }) => child === pid)?.path ?? `pid ${pid}, which the counter never saw start`);
  const open = starts.filter(({ child }) => !ended.has(child));
  if (!open.length) return `(in a second run every start has an end line; that run's uncounted read ${JSON.stringify(run.uncounted)})`;
  return open.map(({ parent, child, path }) => {
    const by = pathOf(parent);
    const watcher = path === '(forked)' && /(^|\/)packages\/supervisor\/dist\/helper$/.test(by) ? ': the supervisor helper\'s watcher, forked by its leash' : '';
    const state = copy.alive.includes(Number(child)) ? 'still running 5 s after the command ended' : 'gone, with no end line in the counter\'s log';
    return `"${path}" (pid ${child}), started by ${by} (pid ${parent})${watcher}, ${state}`;
  }).join('; ');
}
