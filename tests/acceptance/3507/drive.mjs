// How the #3507 acceptance tests reach the program (README: The surface under test): the checkout's own `deep-show`
// (the hub's scenario, `deep-show run`, whose render-back serves the overdraw mode) and `deep-gpu` (`deep-gpu run`,
// `view3d`), each driven by one JSON line; the machine's GPU lease; the built checkout of the merge base that
// `DEEP_3507_BASE` names; the fixtures. Nothing here judges (judge.mjs does) and nothing stands in for the view, the
// renderer or a pass.
//
// A run that can't be made throws a plain Error that starts BLOCKED or INCONCLUSIVE, never a pass. Every process
// started here ends on its own or by its own timeout, which signals only that child; every temporary folder is
// removed; the lease file is removed only while it holds this process's ID.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FPS, FRAMES, WALL, readingOf, stateOf, timeOf } from './judge.mjs';
import { holder, release, take } from './lease.mjs';

// This suite's files are node:test's, run with `node --test <file>`. Vitest's default include matches `*.test.mjs`
// too, so a vitest run with this folder as its root (as a suite that runs another suite whole starts one) would load
// them, and each would start its tests inside vitest's worker, its cargo build and its GPU runs with them, with
// vitest reporting none. Loaded that way, nothing here runs.
if (globalThis.__vitest_worker__ !== undefined) throw Error('BLOCKED: tests/acceptance/3507/ holds node:test files, run with `node --test <file>`, one at a time; vitest loaded this one, and nothing of it was run');

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout under test: this suite is three levels down. */
export const REPO = join(HERE, '..', '..', '..');

export const blocked = (text) => Error(`BLOCKED: ${text}`);
export const inconclusive = (text) => Error(`INCONCLUSIVE: ${text}; this is not a pass`);

/**
 * Ends a test on a judge's findings. None: it goes on. A FAIL among them fails the test's assertion, with every
 * finding listed. Findings that are all BLOCKED, INCONCLUSIVE or INVALID end it with a plain error that starts with
 * the first one's state: the test did not pass, and the program was not shown wrong either.
 */
export function settle(tag, problems, show = 24) {
  if (problems.length === 0) return;
  const text = `${tag}: ${problems.length} finding${problems.length === 1 ? '' : 's'}:\n  ${problems.slice(0, show).join('\n  ')}`;
  if (!problems.some((p) => stateOf(p) === 'FAIL')) throw Error(`${stateOf(problems[0])}: ${text}`);
  assert.fail(text);
}
const brief = (v, n = 1500) => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The proof lanes stop a file at 20 minutes: what a file's runs may take together, with room to stop them. A file
 * that runs for longer by its nature (the timing's rounds, a whole suite drawn twice) says so with `allow`.
 */
let fileMs = 18 * 60_000;
const started = Date.now();
export const allow = (minutes) => { fileMs = minutes * 60_000; };
/** What is left of this file's time for a run named `what`; INCONCLUSIVE when under a minute is. */
export function left(what) {
  const ms = fileMs - (Date.now() - started);
  if (ms < 60_000) throw inconclusive(`${what} wasn't started: this file's earlier runs left it ${Math.round(ms / 1000)} s of the ${fileMs / 60_000} minutes it may take`);
  return ms;
}

// ---------------------------------------------------------------------------------------------------------------------
// The machine (the issue's `Runs on:` line)

/**
 * The machine a count or a pixel hash is read on: `{model, chip, …}`, the perf lane's fingerprint. Off macOS there is
 * no Metal device: BLOCKED. On a Mac that isn't one of the design's reference models a count or a hash is a reading:
 * INCONCLUSIVE.
 */
export async function referenceMac(what) {
  if (process.platform !== 'darwin') throw blocked(`${what} is read on Metal, on a Mac of a reference model; this is ${process.platform}, with no GPU to draw on`);
  const { fingerprint, references } = await import(join(REPO, 'scripts', 'benchmark.mjs'));
  const machine = fingerprint();
  const known = references.some((r) => r.model === machine.model && r.chip === machine.chip && r.memoryBytes === machine.memoryBytes);
  if (!known) throw inconclusive(`${what} is read on a Mac of a reference model (${references.map((r) => r.name).join(' or ')}); this is ${machine.model ?? 'an unknown model'} (${machine.chip ?? 'unknown chip'}), where it is a reading`);
  return machine;
}

/** The one-minute load average. */
export const load = () => loadavg()[0];

// ---------------------------------------------------------------------------------------------------------------------
// The binaries

const supplied = process.env.DEEP_BIN_DIR;
const quiet = (stderr) => String(stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(-3000);
const executable = (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };
const buildEnv = () => ({ ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' });
/** Where this checkout's debug builds are: `CARGO_TARGET_DIR` when the run sets one, else `target/`. */
export const ownDebug = () => join(process.env.CARGO_TARGET_DIR ? resolve(REPO, process.env.CARGO_TARGET_DIR) : join(REPO, 'target'), 'debug');

/**
 * This checkout's `deep-show`: from DEEP_BIN_DIR when the proof run supplies it, else built as the acceptance helpers
 * build it (the build compiles nothing when it is fresh). BLOCKED when there is no binary.
 */
export function showBinary() {
  if (supplied !== undefined) return found(join(resolve(supplied), 'deep-show'));
  const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, env: buildEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw blocked(`cargo build --locked --bin deep-show failed: ${run.error?.message ?? quiet(run.stderr)}`);
  return found(join(ownDebug(), 'deep-show'));
}
/** This checkout's `deep-gpu`, the same way. */
export function gpuBinary() {
  if (supplied !== undefined) return found(join(resolve(supplied), 'deep-gpu'));
  const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu'], { cwd: REPO, env: buildEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw blocked(`cargo build --locked --bin deep-gpu failed: ${run.error?.message ?? quiet(run.stderr)}`);
  return found(join(ownDebug(), 'deep-gpu'));
}
/**
 * Both binaries as this checkout's own target/debug holds them, built here whatever DEEP_BIN_DIR supplies: where
 * another suite's helpers build theirs and copy them from, so the bytes a recorder can know them by (ac4.mjs).
 */
export function builtHere() {
  for (const args of [['build', '--locked', '--bin', 'deep-gpu'], ['build', '--locked', '--bin', 'deep-show']]) {
    const run = spawnSync('cargo', args, { cwd: REPO, env: buildEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw blocked(`cargo ${args.join(' ')} failed: ${run.error?.message ?? quiet(run.stderr)}`);
  }
  return { 'deep-gpu': found(join(ownDebug(), 'deep-gpu')), 'deep-show': found(join(ownDebug(), 'deep-show')) };
}
function found(path) {
  if (!executable(path)) throw blocked(`${path} is missing or not executable`);
  return path;
}

/** A child's environment: this one without the agents' and the hub's settings, as the acceptance helpers drop them. */
export function childEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('CLAUDE') || k.startsWith('CODEX') || k.startsWith('DEEP_') || k === 'AI_AGENT' || k === 'NODE_TEST_CONTEXT') continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

/** A temporary folder and what removes it. */
export function tempDir(name) {
  const dir = mkdtempSync(join(tmpdir(), `deep-3507-${name}-`));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The machine's GPU lease (lease.mjs): the file ~/.cache/deepbuild-gpu/lease, taken for what a test has drawn.

/**
 * Takes the lease for this process, or throws BLOCKED naming the live process that holds it: a run with no lease
 * held draws nothing. Returns what lets it go.
 */
export function gpuLease(what) {
  const got = take(process.pid);
  if (!got.held) throw blocked(`${what} draws under the machine's GPU lease (~/.cache/deepbuild-gpu/lease), and ${got.why}; nothing was drawn`);
  return { held: () => holder() === process.pid, release: () => { release(process.pid); } };
}

/** Runs `body` under the lease and lets it go after; BLOCKED when the lease was lost while it drew. */
export async function underLease(what, body) {
  const lease = gpuLease(what);
  try {
    const result = await body();
    if (!lease.held()) throw blocked(`${what}: the machine's GPU lease was taken from this run while it drew, so what it read isn't under the lease`);
    return result;
  } finally { lease.release(); }
}

// ---------------------------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out (#393); the overdraw mode through deep_show (#427)

const SESSION = 'sess-3507';
const DOC = '01JB3507D00000000000000001';
/** One frame of the scenario's 60 Hz clock in flicks (705,600,000 a second), as #427's scenarios space their calls. */
const TICK = 705_600_000 / 60;
/** The planted count criterion 1 names, and the planted pass criterion 3's changed branch reads (README). */
export const NO_DEPTH_TEST = 'shaded_count_skips_depth_test';
export const MERGE_BASE_PASS = 'geometry_pass_at_merge_base';

/** Puts `bytes` in an evidence store by its layout, `<first 2 hex>/<other 62 hex>`; returns their SHA-256. */
function seed(root, bytes) {
  const h = sha256(bytes);
  mkdirSync(join(root, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(root, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}

/**
 * The scenario that shows `document` once and then asks for the overdraw mode at each of `frames`: one test agent's
 * session, the main panel showing the document, an evidence store that holds `look` (a `look@1` file's bytes) when
 * the fixture has one, which the document then names by asset, as a document names its look.
 */
function scenario(evidence, document, look, size, frames, planted) {
  let doc = document;
  if (look) {
    const id = JSON.parse(look.toString('utf8')).id;
    const license = { id: 'Apache-2.0', terms: 'https://www.apache.org/licenses/LICENSE-2.0', shareable: true, credit: 'DeepBuild' };
    doc = { ...document, look: { asset: `${id}@1` }, assets: { ...(document.assets ?? {}), [id]: { sha256: seed(evidence, look), license } } };
  }
  const calls = [
    { call: 'deep_show', session: SESSION, doc: DOC, document: doc, t: '0s', size, include: ['issues'] },
    ...frames.map((k) => ({ call: 'deep_show', session: SESSION, doc: DOC, mode: 'overdraw', t: timeOf(k), size, include: ['issues'] })),
  ];
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-3507', name: 'Test agent: what the geometry pass shades', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    panels: { main: { rect: [0, 0, size[0], size[1]] } },
    docs: { [DOC]: { panel: 'main' } },
    window: [size[0], size[1] + 40],
    clock: { refresh_hz: 60, lead: 0, check: 0 },
    record: {},
    ...(planted ? { planted } : {}),
    calls: calls.map((c, i) => ({ at: i * 10 * TICK, ...c })),
  };
}

/** One child: `input` on its stdin, its stdout once it ends. It is stopped by its own timeout, which signals it alone. */
function child(bin, args, input, timeoutMs, env) {
  return new Promise((done) => {
    const proc = spawn(bin, args, { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' });
    const out = []; let err = '';
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.setEncoding('utf8').on('data', (d) => { err = (err + d).slice(-3000); });
    proc.stdin.on('error', () => undefined);
    proc.once('error', (error) => done({ status: null, signal: error.message, stdout: '', stderr: err }));
    proc.once('close', (status, signal) => done({ status, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: err }));
    proc.stdin.end(input);
  });
}

/** One answer line of a binary driven by one JSON line: `{ok, replies}`; BLOCKED when the run didn't end with one. */
function answerOf(run, shown, timeoutMs) {
  if (run.signal === 'SIGKILL') throw inconclusive(`${shown} hadn't ended after ${Math.round(timeoutMs / 1000)} s, the rest of this file's time, and was stopped`);
  if (run.status !== 0) throw blocked(`${shown} exited ${run.status ?? run.signal}; stdout: ${run.stdout.slice(0, 800)}; stderr: ${run.stderr.slice(-1500)}`);
  const lines = run.stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== 1) throw blocked(`${shown} printed ${lines.length} lines, not one answer`);
  try { return JSON.parse(lines[0]); } catch (error) { throw blocked(`${shown}'s answer isn't JSON: ${error.message}`); }
}

/**
 * Each of `frames` of a fixture counted by the overdraw mode of `bin`'s render-back, at `size`: a Map from the frame's
 * number to its reading (judge.mjs `readingOf`). `document` is the fixture as its file holds it; `look`, its look
 * file's bytes or null; `planted`, a planted program's name. The frames are split over `processes` runs of
 * `deep-show run`, side by side. BLOCKED when the build has no such planted program, or doesn't present the fixture.
 */
export async function counted(bin, { name, document, look = null, size, frames, planted = null, processes = 1 }) {
  const n = Math.max(1, Math.min(processes, frames.length));
  const parts = Array.from({ length: n }, (_, p) => frames.filter((_, i) => i % n === p));
  const readings = new Map();
  // Every run ends before a failure of one is thrown, so none is left running.
  const ended = await Promise.allSettled(parts.map(async (part) => {
    const store = tempDir('evidence');
    try {
      const shown = `deep-show run (${name}, ${part.length} frames${planted ? `, planted ${planted}` : ''})`;
      const timeoutMs = left(shown);
      const answer = answerOf(await child(bin, ['run'], `${JSON.stringify(scenario(store.dir, document, look, size, part, planted))}\n`, timeoutMs, childEnv()), shown, timeoutMs);
      if (answer.ok !== true) {
        if (planted) throw blocked(`this build has no planted program \`${planted}\` to run (${shown} answered ${brief(answer, 600)}), so the planted run wasn't made; that is not the planted program failing the check`);
        throw blocked(`${shown} refused the scenario: ${brief(answer)}`);
      }
      const replies = Array.isArray(answer.replies) ? answer.replies : [];
      if (replies.length !== part.length + 1) throw blocked(`${shown} gave ${replies.length} replies to ${part.length + 1} calls`);
      if (replies[0]?.outcome !== 'presented') throw blocked(`deep_show didn't present ${name}, so the mode has no revision to draw: ${brief(replies[0])}`);
      part.forEach((k, i) => readings.set(k, readingOf(replies[i + 1], size)));
    } finally { store.remove(); }
  }));
  const failed = ended.find((e) => e.status === 'rejected');
  if (failed) throw failed.reason;
  return readings;
}

/** The readings of frames 0 to n − 1 as a list, for the judges. */
export const listed = (readings, n = FRAMES) => Array.from({ length: n }, (_, k) => readings.get(k));
/** Frames 0 to 299. */
export const ALL_FRAMES = Array.from({ length: FRAMES }, (_, k) => k);

// ---------------------------------------------------------------------------------------------------------------------
// The fixtures

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
/** Criterion 1's two documents (fixtures/), by the order a failure names. */
export const walls = () => ({
  'the nearer drawn first': { name: 'two walls, the nearer drawn first', document: json(join(HERE, 'fixtures', 'two-walls.nearer-first.json')), size: WALL.size },
  'the farther drawn first': { name: 'two walls, the farther drawn first', document: json(join(HERE, 'fixtures', 'two-walls.farther-first.json')), size: WALL.size },
});
/** A budget class's perf-lane fixture as it stands, at its own size, under the perf lane's look, as #3031 counted it. */
export function classFixture(name) {
  const document = json(join(REPO, 'benchmarks', 'canvas', `${name}.json`));
  return { name, document, look: readFileSync(join(REPO, 'tests', 'acceptance', '379', 'fixtures', 'look.json')), size: document.size };
}
/** #3031's every-pass fixture and its look (docs/spikes/3031/fixtures/), at 3456 × 2234. */
export const EVERY_PASS = { doc: join(REPO, 'docs', 'spikes', '3031', 'fixtures', 'every-pass-plus.json'), look: join(REPO, 'docs', 'spikes', '3031', 'fixtures', 'every-pass-plus.look.json'), size: [3456, 2234] };
export function everyPass() {
  for (const f of [EVERY_PASS.doc, EVERY_PASS.look]) if (!existsSync(f)) throw blocked(`#3031's every-pass fixture isn't in this checkout (${f.slice(REPO.length + 1)}): the issue depends on #3031, whose fixture and frames these criteria count over`);
  const document = json(EVERY_PASS.doc);
  if (document.size?.[0] !== EVERY_PASS.size[0] || document.size?.[1] !== EVERY_PASS.size[1]) throw blocked(`#3031's every-pass fixture is ${brief(document.size)} px, not 3456 × 2234`);
  return { name: 'every_pass', document, look: readFileSync(EVERY_PASS.look), size: EVERY_PASS.size };
}

/** The report (README: The report), or null where there is none. */
export const REPORT = 'docs/evidence/3507/README.md';
export const report = () => (existsSync(join(REPO, REPORT)) ? readFileSync(join(REPO, REPORT), 'utf8') : null);

// ---------------------------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one out (#377); `view3d` (#378)

/** One process: the calls in order, a reply for each. */
export async function gpuRun(bin, out, calls, { planted = null, what = 'deep-gpu run' } = {}) {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const timeoutMs = left(what);
  const answer = answerOf(await child(bin, args, `${JSON.stringify({ out, calls })}\n`, timeoutMs, childEnv()), what, timeoutMs);
  if (answer.ok !== true) throw blocked(`${what} refused the scenario: ${brief(answer)}`);
  const replies = Array.isArray(answer.replies) ? answer.replies : [];
  if (replies.length !== calls.length) throw blocked(`${what} gave ${replies.length} replies to ${calls.length} calls`);
  for (const r of replies) {
    if (r?.code === 'unsupported_platform') throw blocked(`${what} reports unsupported_platform: there is no GPU to draw on`);
    if (r?.code !== undefined) throw blocked(`${what} refused a call: ${brief(r, 800)}`);
  }
  return replies;
}

/** A `view3d` call over #3031's every-pass fixture, at its own size, 5 frames a second, under its own look. */
export const everyPassView = (extra) => ({ call: 'view3d', look: json(EVERY_PASS.look), doc: EVERY_PASS.doc, size: EVERY_PASS.size, fps: FPS, capture: [], ...extra });

// ---------------------------------------------------------------------------------------------------------------------
// The merge base's built checkout

function git(checkout, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const run = spawnSync('git', ['-C', checkout, ...args], { env, encoding: 'utf8', maxBuffer: 1 << 26 });
  return run.status === 0 ? run.stdout.trim() : null;
}
/** This checkout's merge base with origin/main, as scripts/proof-change.mjs reads it; BLOCKED when git can't say. */
export function mergeBaseCommit() {
  const base = git(REPO, 'merge-base', 'HEAD', 'origin/main');
  if (!base) throw blocked('git can\'t read this checkout\'s merge base with origin/main (git merge-base HEAD origin/main)');
  return base;
}
/** `git diff --name-status --no-renames <commit> -- <path>` in this checkout, the working tree included. */
export function changedSince(commit, path) {
  const out = git(REPO, 'diff', '--name-status', '--no-renames', commit, '--', path);
  if (out === null) throw blocked(`git can't compare ${path} with ${commit}`);
  return out;
}

/** The program's sources: a merge base's checkout with any of these changed isn't the merge base's program. */
const PROGRAM = ['crates', 'vendor', 'Cargo.toml', 'Cargo.lock'];
/**
 * The built checkout of the merge base, which `DEEP_3507_BASE` names: `{path, commit, debug}`, `debug` its
 * `target/debug`. BLOCKED, never a pass, when it isn't given, isn't another checkout, isn't at this checkout's merge
 * base with origin/main, holds changed program files, or lacks one of `binaries`: what it drew would not be the merge
 * base's. The variable carries a path to run and selects no planted program.
 */
export function mergeBase(binaries) {
  const given = process.env.DEEP_3507_BASE;
  if (!given) throw blocked('DEEP_3507_BASE names no built checkout of the merge base, so nothing was drawn on the merge base');
  const path = resolve(given);
  if (!existsSync(path)) throw blocked('DEEP_3507_BASE names a folder that isn\'t there');
  if (realpathSync(path) === realpathSync(REPO)) throw blocked('DEEP_3507_BASE names the checkout under test: what it drew would be a copy of the change\'s');
  const commit = git(path, 'rev-parse', 'HEAD');
  if (!commit) throw blocked('git can\'t read the commit the DEEP_3507_BASE checkout is at');
  const base = mergeBaseCommit();
  if (commit !== base) throw blocked(`the DEEP_3507_BASE checkout is at ${commit}, and this checkout's merge base with origin/main is ${base}`);
  const changed = git(path, 'status', '--porcelain', '--untracked-files=no', '--', ...PROGRAM.filter((p) => existsSync(join(path, p))));
  if (changed === null) throw blocked('git can\'t read the state of the DEEP_3507_BASE checkout');
  if (changed) throw blocked(`the DEEP_3507_BASE checkout holds changed files, so it isn't the merge base's program: ${changed.split('\n').slice(0, 5).join('; ')}`);
  const debug = join(path, 'target', 'debug');
  const lack = binaries.filter((b) => !executable(join(debug, b)));
  if (lack.length) throw blocked(`the DEEP_3507_BASE checkout isn't built: its target/debug lacks ${lack.join(', ')} (CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked ${lack.map((b) => `--bin ${b}`).join(' ')})`);
  return { path, commit, debug };
}
