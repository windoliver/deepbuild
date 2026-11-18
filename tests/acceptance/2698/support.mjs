// Shared by the #2698 acceptance tests: what a run needs before it can prove anything, the fixtures built and driven
// as real processes, and the budget tasks run as benchmarks/budgets.json names them. Every process started here is
// stopped by its PID, and every scratch directory removed, when the test file's process ends.
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { READER_MODULE, readerFile } from './surface.mjs';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
export const within = (value, expected, share) => Math.abs(value - expected) <= share * expected;
export const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * A run that can't prove its criterion: a reading or a precondition that can't be had. It fails the test with a
 * message that starts with its state, BLOCKED or INCONCLUSIVE, which the lanes read as that state: never a pass and
 * never a silent skip.
 */
export class Unproven extends Error {}
export const blocked = (why) => new Unproven(`BLOCKED: ${why}`);
export const inconclusive = (why) => new Unproven(`INCONCLUSIVE: ${why}`);
/** Any error that names its own state, as a planted reader that can't be built does. */
export const unproven = (error) => /^(BLOCKED|INCONCLUSIVE)\b/.test(String(error?.message));

const started = new Set(), scratches = new Set();
function stop(pid) {
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
process.on('exit', () => {
  for (const pid of started) stop(pid);
  for (const directory of scratches) rmSync(directory, { recursive: true, force: true });
});

export function scratch(prefix) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratches.add(directory);
  return directory;
}

export function needsMac() {
  if (process.platform !== 'darwin') throw blocked(`not macOS (${process.platform}): the fixtures are checked against macOS's own counts, and off macOS each reading is missing until that platform has a reader`);
}

/** The fixtures and the probe, built by cc into a scratch directory once a test file. */
let built;
export function fixtures() {
  needsMac();
  if (built) return built;
  const directory = scratch('deep-2698-fixtures-'), binaries = {};
  for (const name of ['probe', 'spin-wake', 'hold', 'family']) {
    const source = fileURLToPath(new URL(`fixtures/${name}.c`, import.meta.url));
    const result = spawnSync('cc', ['-O2', '-Wall', '-Werror', '-o', join(directory, name), source], { encoding: 'utf8' });
    if (result.error || /xcrun: error|no developer tools/i.test(result.stderr)) throw blocked(`no compiler: cc can't build fixtures/${name}.c (${result.error?.message ?? result.stderr.trim().split('\n')[0]})`);
    assert.equal(result.status, 0, `fixtures/${name}.c did not build:\n${result.stderr}`);
    binaries[name] = join(directory, name);
  }
  return (built = binaries);
}

/** The 1-minute load average against the cores, as scripts/benchmark.mjs's judgeLimit reads a loaded run. */
export const conditions = () => ({ load: loadavg()[0], cores: availableParallelism() });

/**
 * A fixture as a process: each line it prints is one JSON object, and it does its next step on a line from the test.
 * `next()` is its next line; `end()` tells it to exit and waits, stopping it by PID if it doesn't.
 */
export function fixture(binary, args) {
  const child = spawn(binary, args.map(String), { stdio: ['pipe', 'pipe', 'inherit'] });
  started.add(child.pid);
  const lines = [], waiting = [];
  let gone = null;
  createInterface({ input: child.stdout }).on('line', (text) => {
    let line;
    try { line = JSON.parse(text); } catch { line = { unparsed: text }; }
    if (waiting.length) waiting.shift().resolve(line);
    else lines.push(line);
  });
  const ended = new Promise((resolve) => child.once('exit', (code, signal) => {
    gone = `exited ${code ?? signal}`;
    started.delete(child.pid);
    // Its last lines may still be on their way.
    setTimeout(() => { for (const { reject } of waiting.splice(0)) reject(Error(`fixture ${basename(binary)} ${gone} before its next line`)); resolve(); }, 200);
  }));
  child.stdin.on('error', () => undefined);
  return {
    pid: child.pid,
    say: (word) => child.stdin.write(`${word}\n`),
    /** The first line it prints from now on: what it printed before is dropped, and one already on its way. */
    async fresh() {
      lines.length = 0;
      await this.next();
      return this.next();
    },
    next(ms = 60_000) {
      if (lines.length) return Promise.resolve(lines.shift());
      if (gone) return Promise.reject(Error(`fixture ${basename(binary)} ${gone} before its next line`));
      return new Promise((resolve, reject) => {
        const entry = { resolve: (line) => { clearTimeout(timer); resolve(line); }, reject: (error) => { clearTimeout(timer); reject(error); } };
        const timer = setTimeout(() => { waiting.splice(waiting.indexOf(entry), 1); reject(Error(`fixture ${basename(binary)} printed no line within ${ms / 1000} s`)); }, ms);
        waiting.push(entry);
      });
    },
    async end() {
      if (!gone) child.stdin.end('exit\n');
      const timer = setTimeout(() => stop(child.pid), 10_000);
      await ended;
      clearTimeout(timer);
    },
  };
}

/** Each reader's handle on a process, or the error it threw: one reader's failure never costs another its reading. */
export async function startAll(readers, pid) {
  const handles = {};
  for (const reader of readers) {
    const outer = performance.now();
    try { handles[reader.name] = { handle: await reader.start(pid), outer, inner: performance.now() }; } catch (error) { handles[reader.name] = { error }; }
  }
  return handles;
}
/** Each reader's reading, with the longest and shortest its span can be by the test's own clock. */
export async function stopAll(handles) {
  const readings = {};
  for (const [name, { handle, error, outer, inner }] of Object.entries(handles)) {
    if (error) { readings[name] = { error }; continue; }
    const before = performance.now();
    try { readings[name] = { reading: await handle.stop(), shortestMs: before - inner, longestMs: performance.now() - outer }; } catch (caught) { readings[name] = { error: caught }; }
  }
  return readings;
}

/** A reader's reading of a run, or the test's failure when it threw instead. */
export function readingOf(readings, name, when) {
  const mine = readings[name];
  assert.ok(mine, `${when}: no reading was asked of ${name}`);
  if (unproven(mine.error)) throw mine.error;
  if (mine.error) assert.fail(`${when}: ${name} threw instead of giving a reading: ${mine.error.stack ?? mine.error}`);
  return mine;
}

/** The planted readers are modules with the reader's own exports (planted/). */
export const planted = (file) => pathToFileURL(fileURLToPath(new URL(`planted/${file}`, import.meta.url))).href;

/**
 * A planted reader must fail the criterion's assertions, and for the reason the criterion gives: `naming` is what its
 * message has to say. A run that proved nothing stays unproven: it shows neither that the assertions catch the wrong
 * program nor that they don't.
 */
export async function failsNaming(run, naming, what) {
  let failure;
  try { await run(); } catch (error) { failure = error; }
  if (unproven(failure)) throw failure;
  assert.ok(failure, `${what} passed the criterion's assertions, so they prove nothing against it`);
  assert.match(failure.message, naming, `${what} failed, but not for the reason the criterion gives:\n${failure.stack}`);
  return failure.message;
}

// ---- The budget tasks, run as benchmarks/budgets.json names them.

export function needsBuild() {
  const cli = join(root, 'packages/cli/dist/main.js');
  if (!existsSync(cli)) throw blocked(`an unbuilt checkout: packages/cli/dist/main.js is missing, so no budget task can start \`deep\` (npm ci, then npm run build)`);
}

export function taskCommand(id) {
  const task = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8')).tasks.find((entry) => entry.id === id);
  assert.ok(task, `benchmarks/budgets.json has no task ${id}`);
  return task.command;
}

/** The process table now: each PID's children. */
function table() {
  return new Promise((resolve) => execFile('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
    if (error) return resolve(null);
    const children = new Map();
    for (const line of stdout.split('\n')) {
      const [pid, parent] = line.trim().split(/\s+/).map(Number);
      if (pid > 0) children.set(parent, [...(children.get(parent) ?? []), pid]);
    }
    resolve(children);
  }));
}

export const show = (run) => `${run.id} exited ${run.status ?? run.signal} after ${(run.elapsedMs / 1000).toFixed(1)} s\nlast line: ${run.lastText.slice(0, 4000)}\nstderr:\n${run.stderr.slice(-3000)}`;

/**
 * A budget task run once, in `cwd`, a checkout: its exit, its output, its last stdout line as JSON, and what the
 * process table showed while it ran, about twice a second: the task's children and each one's children.
 */
export async function runTask(id, { cwd = root, timeoutMs = 1_200_000 } = {}) {
  const [command, ...args] = taskCommand(id);
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  started.add(child.pid);
  const began = performance.now();
  let stdout = '', stderr = '', looking = false, timedOut = false;
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const samples = [];
  const look = setInterval(async () => {
    if (looking) return;
    looking = true;
    const children = await table();
    looking = false;
    if (children) samples.push({ at: performance.now() - began, children: new Map((children.get(child.pid) ?? []).map((pid) => [pid, children.get(pid) ?? []])) });
  }, 500);
  // A task stopped here can't stop what it started, its hub and that hub's children: they are found in the process
  // table while the task still holds them, and stopped by their PIDs, the deepest first.
  const timer = setTimeout(async () => {
    timedOut = true;
    const children = await table();
    const below = (pid) => (children?.get(pid) ?? []).flatMap((each) => [...below(each), each]);
    for (const pid of [...below(child.pid), child.pid]) stop(pid);
  }, timeoutMs);
  const [status, signal] = await new Promise((resolve) => child.once('close', (code, by) => resolve([code, by])));
  clearInterval(look);
  clearTimeout(timer);
  started.delete(child.pid);
  const run = { id, pid: child.pid, status, signal, stdout, stderr, samples, elapsedMs: performance.now() - began, lastText: stdout.trim().split('\n').at(-1) ?? '' };
  if (timedOut) assert.fail(`${id} did not finish within ${timeoutMs / 1000} s and was stopped:\n${show(run)}`);
  try { run.last = JSON.parse(run.lastText); } catch { run.last = null; }
  assert.ok(run.last && typeof run.last === 'object' && !Array.isArray(run.last), `${id} printed no JSON object as its last line:\n${show(run)}`);
  return run;
}

/**
 * A copy of this checkout in which the tasks get a planted function in place of the reader's own (surface.mjs: A1,
 * A2): benchmarks/ is copied file by file, everything else is linked, and the reader's module is kept beside the plant
 * under another name, so whatever else the tasks import from it is still the reader's. `plant(kept)` is the module text
 * that exports the planted function, `kept` being the specifier of the reader's own module from there.
 */
export function plantedCheckout(plant) {
  assert.ok(existsSync(readerFile()), `no reader: ${READER_MODULE} does not exist, so there is nothing to plant in its place`);
  const copy = scratch('deep-2698-checkout-');
  for (const name of readdirSync(root)) if (name !== 'benchmarks' && name !== '.git') symlinkSync(join(root, name), join(copy, name));
  mkdirSync(join(copy, 'benchmarks'));
  for (const entry of readdirSync(join(root, 'benchmarks'), { withFileTypes: true })) {
    const from = join(root, 'benchmarks', entry.name), to = join(copy, 'benchmarks', entry.name);
    if (entry.isDirectory()) symlinkSync(from, to);
    else copyFileSync(from, to);
  }
  const module = join(copy, READER_MODULE), kept = module.replace(/\.mjs$/, '.real.mjs');
  renameSync(module, kept);
  writeFileSync(module, `export * from './${basename(kept)}';\n${plant(`./${basename(kept)}`)}\n`);
  return copy;
}
