// #2960 acceptance: what the test files share. Every reading goes through the perf lane's own surface,
// scripts/benchmark.mjs's exported measureOnce (the judge's code, under the test guard), as the issue names it, on
// commands the issue names: the four budget tasks' commands from benchmarks/budgets.json, the supervisor helper's
// `leash`, an x86_64 `cargo`, and a run from a translated shell. Fixture programs are built here with cc into a temp
// folder under /tmp/dh2960-*, removed afterwards. Nothing is killed by name or port.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CHANGE = resolve(HERE, '../../..');
/** Where the four tasks run: the merge base's built checkout when DEEP_2960_BASE names one, else this checkout. */
export const TASKS_AT = process.env.DEEP_2960_BASE ? resolve(process.env.DEEP_2960_BASE) : CHANGE;
export const TASKS = ['deep-hook-guards', 'deep-hook-overhead', 'hub-round-trip', 'extension-host'];
export const HELPER = join(CHANGE, 'packages/supervisor/dist/helper');
// A captured run is stopped after this. The lane's default is 5 minutes; a loaded Mac can take longer to count
// 1,000 hook calls, and a run stopped early would read BLOCKED, never a verdict.
export const TIMEOUT_MS = 1_200_000;

/** The perf lane's measureOnce, from this checkout's scripts/benchmark.mjs. */
export async function measureOnce(...args) {
  const bench = await import(pathToFileURL(join(CHANGE, 'scripts/benchmark.mjs')).href);
  return bench.measureOnce(...args);
}

/** One reading: the result measureOnce returns, or the message it throws. */
export async function reading(command, cwd = CHANGE) {
  try {
    return { result: await measureOnce(command, cwd, false, TIMEOUT_MS) };
  } catch (error) {
    return { threw: String(error?.message ?? error) };
  }
}

/** A reading as one line for a failure message, without the command's own output. */
export function shown(read) {
  if ('threw' in read) return `measureOnce threw: ${read.threw.slice(0, 1500)}`;
  const { output, stdout, ...rest } = read.result;
  return `measureOnce returned ${JSON.stringify({ status: rest.status, instructions: rest.instructions, uncounted: rest.uncounted, ...Object.fromEntries(Object.entries(rest).filter(([key]) => !['status', 'instructions', 'uncounted', 'elapsedMs', 'loadStart', 'loadEnd', 'cpuMs', 'peakBytes', 'qos'].includes(key))) })}${output ? `; the command's output ends: ${JSON.stringify(output.slice(-700))}` : ''}`;
}

const count = (value) => Number.isSafeInteger(value) && value > 0;

/**
 * Whether a reading is BLOCKED and names one of `names`: measureOnce throws a message that says BLOCKED, as it already
 * does for a host with no peak RSS, or returns a result whose own fields (not the command's output) say BLOCKED, with
 * no count. A count beside a BLOCKED would still be a count, so it doesn't read BLOCKED.
 */
export function blockedNaming(read, names) {
  const text = 'threw' in read ? read.threw : (() => {
    const { output, stdout, ...rest } = read.result;
    return count(rest.instructions) ? '' : JSON.stringify(rest);
  })();
  return /BLOCKED/.test(text) && names.some((name) => text.includes(name));
}

export const tempDir = () => realpathSync(mkdtempSync('/tmp/dh2960-'));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });

/** Builds a fixture C program from fixtures/<name>.c for `archs` into `dir`; returns its path. */
export function build(dir, name, archs, out = name) {
  const path = join(dir, out);
  execFileSync('cc', ['-O1', ...archs.flatMap((arch) => ['-arch', arch]), '-o', path, join(HERE, 'fixtures', `${name}.c`)], { stdio: ['ignore', 'ignore', 'pipe'] });
  return path;
}

/** A task's command as `checkout`'s benchmarks/budgets.json names it, or null. */
export function taskCommand(checkout, id) {
  const file = join(checkout, 'benchmarks/budgets.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')).tasks.find((task) => task.id === id)?.command ?? null;
}

/** Why the four tasks can't run in `checkout`, or null. */
export function tasksUnrunnable(checkout) {
  if (!existsSync(checkout)) return `BLOCKED: there is no checkout at ${checkout}`;
  const missing = ['packages/cli/dist/main.js', 'packages/hub/dist/index.js', 'packages/supervisor/dist/helper'].filter((file) => !existsSync(join(checkout, file)));
  if (missing.length) return `BLOCKED: ${checkout} is not built (${missing.join(', ')} missing); run npm ci && npm run build --workspaces there`;
  return null;
}

/** Whether this Mac can run an x86_64 program (Rosetta), and the archs `path` holds, by lipo. */
export const rosetta = () => spawnSync('arch', ['-x86_64', '/usr/bin/true']).status === 0;
export const archsOf = (path) => spawnSync('lipo', ['-archs', path], { encoding: 'utf8' }).stdout?.trim().split(/\s+/).filter(Boolean) ?? [];

/** A small file in `dir`; returns its path. */
export function write(dir, name, text) {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}
