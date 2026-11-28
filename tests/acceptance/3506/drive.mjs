// How the #3506 acceptance tests reach the program (README: The surface under test): #3031's reader (`spikes/3031/`,
// `spike-3031 frames`), which draws a document's frames offscreen through the scene renderer's public entry and lists
// what the Metal device holds after the last one; the checkout's own `deep-gpu` (`deep-gpu run [--planted <name>]`,
// `view3d`); the machine's GPU lease; the built checkout of the merge base that `DEEP_3506_BASE` names; #3031's
// every-pass fixture. Nothing here judges (judge.mjs does) and nothing stands in for the renderer, a pass or the device.
//
// A run that can't be made throws a plain Error that starts BLOCKED or INCONCLUSIVE, never a pass. Every process
// started here ends on its own or by its own timeout, which signals only that child; every temporary folder is
// removed; the lease file is removed only while it holds this process's ID.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { holder, release, take } from '../3507/lease.mjs';
import { FPS, stateOf } from './judge.mjs';

// This suite's files are node:test's, run with `node --test <file>`. A vitest run with this folder as its root would
// load them (its default include matches `*.test.mjs`) and start their builds and GPU runs inside its worker.
if (globalThis.__vitest_worker__ !== undefined) throw Error('BLOCKED: tests/acceptance/3506/ holds node:test files, run with `node --test <file>`, one at a time; vitest loaded this one, and nothing of it was run');

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

/** What a file's runs may take together: the proof lanes stop a file at 20 minutes. A longer file says so with `allow`. */
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
 * The machine a device's bytes or a pixel hash is read on. Off macOS there is no Metal device: BLOCKED. On a Mac that
 * isn't one of the design's reference models a reading is a reading: INCONCLUSIVE.
 */
export async function referenceMac(what) {
  if (process.platform !== 'darwin') throw blocked(`${what} is read on Metal, on a Mac of a reference model; this is ${process.platform}, with no GPU to draw on`);
  const { fingerprint, references } = await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href);
  const machine = fingerprint();
  const known = references.some((r) => r.model === machine.model && r.chip === machine.chip && r.memoryBytes === machine.memoryBytes);
  if (!known) throw inconclusive(`${what} is read on a Mac of a reference model (${references.map((r) => r.name).join(' or ')}); this is ${machine.model ?? 'an unknown model'} (${machine.chip ?? 'unknown chip'}), where it is a reading`);
  return machine;
}

// ---------------------------------------------------------------------------------------------------------------------
// Processes, folders, the lease

const quiet = (stderr) => String(stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Locking|Updating/.test(l)).join('\n').slice(-3000);
const executable = (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };
const buildEnv = () => ({ ...process.env, CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0' });

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
  const dir = mkdtempSync(join(tmpdir(), `deep-3506-${name}-`));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
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

/** Takes the machine's GPU lease for this process, or throws BLOCKED naming the live process that holds it. */
function gpuLease(what) {
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
// #3031's reader: `spike-3031 frames`, built from spikes/3031/ against a checkout's crates

/** #3031's every-pass fixture and its look (docs/spikes/3031/fixtures/), at 3456 × 2234. */
export const EVERY_PASS = {
  doc: join(REPO, 'docs', 'spikes', '3031', 'fixtures', 'every-pass-plus.json'),
  look: join(REPO, 'docs', 'spikes', '3031', 'fixtures', 'every-pass-plus.look.json'),
  size: [3456, 2234],
};
const READER = join(REPO, 'spikes', '3031');
/** The reader's own target folder: every build of it below shares it, so the crates the builds share compile once. */
const READER_TARGET = join(READER, 'target');
/** Where the reader's copies are written: a copy against the merge base's crates, and a copy with a planted program set. */
const COPIES = join(REPO, 'target', 'acceptance', '3506', 'readers');

/** A file written only when its bytes change, so cargo sees an unchanged copy as fresh. */
function keep(path, text) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/**
 * The reader's sources as a build takes them, and the binary that build makes. `checkout` is whose crates it draws
 * with: this one, as #3031 keeps it, or the merge base's. `planted` names a field of the renderer's `Planted` (README:
 * The planted programs) that the copy sets where the reader makes its renderer and asks for the estimate: the reader
 * as #3031 wrote it says `Planted::default()` and `held::of(scene)`, and the copy says the same with that one field set
 * and `held::of_planted`. A copy is its own package, named for what it reads, so its binary lands beside the reader's
 * own in the one target folder. `{manifest, bin, args}`; `args` is the cargo build that makes `bin`.
 */
export function readerSources(checkout = REPO, planted = null) {
  if (!existsSync(join(READER, 'src', 'main.rs'))) throw blocked('#3031\'s reader isn\'t in this checkout (spikes/3031/): the issue depends on #3031, whose reader these criteria read the device with');
  const own = resolve(checkout) === resolve(REPO);
  const target = ['--target-dir', READER_TARGET];
  if (own && !planted) {
    const manifest = join(READER, 'Cargo.toml');
    return { manifest, bin: join(READER_TARGET, 'release', 'spike-3031'), args: ['build', '--release', '--locked', '--manifest-path', manifest, ...target] };
  }
  const name = `spike-3031-${own ? 'planted' : 'base'}${planted ? `-${planted.replaceAll('_', '-')}` : ''}`;
  const dir = join(COPIES, name);
  const crates = join(resolve(checkout), 'crates');
  let toml = readFileSync(join(READER, 'Cargo.toml'), 'utf8');
  const paths = toml.match(/path = "\.\.\/\.\.\/crates\//g)?.length ?? 0;
  toml = toml.replace('name = "spike-3031"', `name = "${name}"`).replaceAll('path = "../../crates/', `path = "${crates}/`);
  let lock = readFileSync(join(READER, 'Cargo.lock'), 'utf8');
  lock = lock.replace('name = "spike-3031"', `name = "${name}"`);
  let main = readFileSync(join(READER, 'src', 'main.rs'), 'utf8');
  if (planted) {
    const set = `Planted { ${planted}: true, ..Planted::default() }`;
    const made = main.split('Renderer::new(&device, Planted::default())').length - 1;
    const asked = main.split('deep_scene3d_render::held::of(scene)').length - 1;
    if (made === 0 || asked !== 1) throw Error(`INVALID: #3031's reader no longer makes its renderer with \`Planted::default()\` (${made}) and asks \`held::of(scene)\` once (${asked}), so this suite can't set the planted program \`${planted}\` in it`);
    main = main.replaceAll('Renderer::new(&device, Planted::default())', `Renderer::new(&device, ${set})`)
      .replace('deep_scene3d_render::held::of(scene)', `deep_scene3d_render::held::of_planted(scene, &${set})`);
  }
  if (paths === 0 || !toml.includes(`name = "${name}"`) || !lock.includes(`name = "${name}"`)) throw Error('INVALID: #3031\'s reader\'s Cargo.toml or Cargo.lock isn\'t as #3031 wrote it, so this suite can\'t copy it');
  keep(join(dir, 'Cargo.toml'), toml);
  keep(join(dir, 'Cargo.lock'), lock);
  keep(join(dir, 'src', 'main.rs'), main);
  keep(join(dir, 'src', 'held.rs'), readFileSync(join(READER, 'src', 'held.rs'), 'utf8'));
  const manifest = join(dir, 'Cargo.toml');
  return { manifest, bin: join(READER_TARGET, 'release', name), args: ['build', '--release', '--locked', '--manifest-path', manifest, ...target] };
}

/** The reader built (`readerSources`); BLOCKED when it doesn't build, naming cargo's error. */
export function reader(checkout = REPO, planted = null) {
  const r = readerSources(checkout, planted);
  const run = spawnSync('cargo', r.args, { cwd: REPO, env: buildEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const what = `#3031's reader${planted ? ` with the planted \`${planted}\`` : ''} against ${resolve(checkout) === resolve(REPO) ? 'this checkout' : 'the merge base'}`;
  if (run.error || run.status !== 0) {
    const error = run.error?.message ?? quiet(run.stderr);
    if (planted && /no field named|E0560|E0609|no function or associated item named|cannot find function/.test(error)) throw blocked(`this build has no planted program \`${planted}\` to run (${what} doesn't compile: ${error.slice(-1200)}), so the planted run wasn't made; that is not the planted program failing the check`);
    throw blocked(`${what} doesn't build (cargo ${r.args.join(' ')}): ${error}`);
  }
  if (!executable(r.bin)) throw blocked(`${r.bin} is missing or not executable after its build`);
  return { bin: r.bin, what };
}

/**
 * What the device holds after the every-pass fixture's `frames` frames, 5 a second, as `spike-3031 frames` lists it:
 * `{summary, listing}`, the reader's printed summary and its `resources.json` (`allocated`, the device's own total;
 * `estimate`, the check's; `on`; `resources`, every texture and buffer alive with its label, shape and bytes). The
 * reader takes the GPU lease's file itself, waiting for it: a lease another live process holds when the run would
 * start is BLOCKED, and so is a run whose summary says it drew without the lease.
 */
export async function listing({ bin, what }, frames) {
  for (const f of [EVERY_PASS.doc, EVERY_PASS.look]) if (!existsSync(f)) throw blocked(`#3031's every-pass fixture isn't in this checkout (${f.slice(REPO.length + 1)})`);
  const by = holder();
  if (Number.isInteger(by) && by > 0 && by !== process.pid && alive(by)) throw blocked(`${what} draws under the machine's GPU lease (~/.cache/deepbuild-gpu/lease), and process ${by} holds it; nothing was drawn`);
  const out = tempDir('listing');
  try {
    const shown = `${what}: spike-3031 frames, ${frames} frames of every_pass`;
    const timeoutMs = left(shown);
    const args = ['frames', '--doc', EVERY_PASS.doc, '--look', EVERY_PASS.look, '--frames', String(frames), '--fps', String(FPS), '--out', out.dir, '--lease-wait', '600'];
    const run = await child(bin, args, '', timeoutMs, childEnv());
    if (run.signal === 'SIGKILL') throw inconclusive(`${shown} hadn't ended after ${Math.round(timeoutMs / 1000)} s, the rest of this file's time, and was stopped`);
    let summary;
    try { summary = JSON.parse(run.stdout); } catch { throw blocked(`${shown} printed no summary (exit ${run.status ?? run.signal}): ${run.stderr.slice(-1500)}`); }
    if (run.status !== 0 || summary.status !== 'RAN') throw blocked(`${shown} didn't run: ${summary.reason ?? `exit ${run.status}`}`);
    if (summary.lease !== 'file') throw blocked(`${shown} drew without the machine's GPU lease (${summary.lease}), so what it read isn't under the lease`);
    if (summary.adapter?.backend !== 'Metal') throw blocked(`${shown} drew on ${summary.adapter?.backend ?? 'no adapter'}, not Metal`);
    if (summary.raised?.length) throw blocked(`${shown}: the device raised ${summary.raised.join('; ').slice(0, 1500)}`);
    if (summary.unlisted_calls?.length) throw blocked(`${shown}: the device's calls ${summary.unlisted_calls.join(', ')} weren't listed, so the listing isn't all it holds`);
    const listed = JSON.parse(readFileSync(join(out.dir, 'resources.json'), 'utf8'));
    return { summary, listing: listed };
  } finally { out.remove(); }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// ---------------------------------------------------------------------------------------------------------------------
// `deep-gpu run [--planted <name>]`: one JSON line in, one out (#377); `view3d` (#378)

/** Where this checkout's debug builds are: `CARGO_TARGET_DIR` when the run sets one, else `target/`. */
export const ownDebug = () => join(process.env.CARGO_TARGET_DIR ? resolve(REPO, process.env.CARGO_TARGET_DIR) : join(REPO, 'target'), 'debug');

/** This checkout's `deep-gpu`: DEEP_BIN_DIR's when a proof run supplies it, else built as the acceptance helpers build it. */
export function gpuBinary() {
  if (process.env.DEEP_BIN_DIR !== undefined) return found(join(resolve(process.env.DEEP_BIN_DIR), 'deep-gpu'));
  const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-gpu'], { cwd: REPO, env: buildEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error || run.status !== 0) throw blocked(`cargo build --locked --bin deep-gpu failed: ${run.error?.message ?? quiet(run.stderr)}`);
  return found(join(ownDebug(), 'deep-gpu'));
}
/** Both binaries as this checkout's own target/debug holds them, built here whatever DEEP_BIN_DIR supplies (ac3.mjs). */
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

/** One process: the calls in order, a reply for each. A build with no such planted program is BLOCKED. */
export async function gpuRun(bin, out, calls, { planted = null, what = 'deep-gpu run' } = {}) {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const timeoutMs = left(what);
  const run = await child(bin, args, `${JSON.stringify({ out, calls })}\n`, timeoutMs, childEnv());
  if (run.signal === 'SIGKILL') throw inconclusive(`${what} hadn't ended after ${Math.round(timeoutMs / 1000)} s, the rest of this file's time, and was stopped`);
  if (planted && run.stdout.includes('"bad_input"') && run.status !== 0) throw blocked(`this build has no planted program \`${planted}\` to run (${what} answered ${run.stdout.trim().slice(0, 300)}), so the planted run wasn't made; that is not the planted program failing the check`);
  if (run.status !== 0) throw blocked(`${what} exited ${run.status ?? run.signal}; stdout: ${run.stdout.slice(0, 800)}; stderr: ${run.stderr.slice(-1500)}`);
  const lines = run.stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== 1) throw blocked(`${what} printed ${lines.length} lines, not one answer`);
  let answer;
  try { answer = JSON.parse(lines[0]); } catch (error) { throw blocked(`${what}'s answer isn't JSON: ${error.message}`); }
  if (answer.ok !== true) throw blocked(`${what} refused the scenario: ${brief(answer)}`);
  const replies = Array.isArray(answer.replies) ? answer.replies : [];
  if (replies.length !== calls.length) throw blocked(`${what} gave ${replies.length} replies to ${calls.length} calls`);
  for (const r of replies) {
    if (r?.code === 'unsupported_platform') throw blocked(`${what} reports unsupported_platform: there is no GPU to draw on`);
    if (r?.code !== undefined) throw blocked(`${what} refused a call: ${brief(r, 800)}`);
  }
  return replies;
}

/** A `view3d` call over the every-pass fixture, at its own size, 5 frames a second, under its own look. */
export const everyPassView = (extra) => ({ call: 'view3d', look: JSON.parse(readFileSync(EVERY_PASS.look, 'utf8')), doc: EVERY_PASS.doc, size: EVERY_PASS.size, fps: FPS, ...extra });

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

/** Every file under `rel` in `root`, by its path from `root`, with its git blob ID (a link's is its target's text). */
function blobs(root, rel, out = new Map()) {
  const path = join(root, rel);
  if (!existsSync(path) && !isLink(path)) return out;
  const s = lstatSync(path);
  if (s.isDirectory()) { for (const e of readdirSync(path)) blobs(root, rel ? `${rel}/${e}` : e, out); return out; }
  const bytes = s.isSymbolicLink() ? Buffer.from(readlinkSync(path)) : readFileSync(path);
  out.set(rel, createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'));
  return out;
}
const isLink = (path) => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };

/**
 * Whether a folder with no git of its own (a `git archive` export) holds the merge base's program: its files under
 * PROGRAM are exactly those `git ls-tree -r <commit>` lists there, each with the same bytes. The differences, if any.
 */
function exportDiffers(path, commit) {
  const tree = git(REPO, 'ls-tree', '-r', '--full-tree', commit, '--', ...PROGRAM);
  if (tree === null) throw blocked(`git can't list the merge base's program (${commit})`);
  const want = new Map(tree.split('\n').filter(Boolean).map((l) => { const [meta, file] = l.split('\t'); return [file, meta.split(' ')[2]]; }));
  const have = new Map();
  for (const p of PROGRAM) blobs(path, p, have);
  const differs = [];
  for (const [file, id] of want) if (have.get(file) !== id) differs.push(`${file} ${have.has(file) ? 'differs' : 'is missing'}`);
  for (const file of have.keys()) if (!want.has(file)) differs.push(`${file} isn't the merge base's`);
  return differs;
}

/**
 * The checkout of the merge base that `DEEP_3506_BASE` names: `{path, commit, debug}`. Either a git checkout at this
 * checkout's merge base with origin/main and no change to its program files, or a folder with no `.git` (a `git
 * archive` export of the merge base) whose program files are the merge base's byte for byte. BLOCKED, never a pass,
 * when it isn't given, is this checkout, is neither of those, or lacks one of `binaries` in its target/debug. The
 * variable carries a path and selects no planted program.
 */
export function mergeBase(binaries = []) {
  const given = process.env.DEEP_3506_BASE;
  if (!given) throw blocked('DEEP_3506_BASE names no checkout of the merge base, so nothing was read on the merge base');
  const path = resolve(given);
  if (!existsSync(path)) throw blocked('DEEP_3506_BASE names a folder that isn\'t there');
  if (realpathSync(path) === realpathSync(REPO)) throw blocked('DEEP_3506_BASE names the checkout under test: what it read would be the change\'s');
  const base = mergeBaseCommit();
  if (existsSync(join(path, '.git'))) {
    const commit = git(path, 'rev-parse', 'HEAD');
    if (!commit) throw blocked('git can\'t read the commit the DEEP_3506_BASE checkout is at');
    if (commit !== base) throw blocked(`the DEEP_3506_BASE checkout is at ${commit}, and this checkout's merge base with origin/main is ${base}`);
    const changed = git(path, 'status', '--porcelain', '--untracked-files=no', '--', ...PROGRAM.filter((p) => existsSync(join(path, p))));
    if (changed === null) throw blocked('git can\'t read the state of the DEEP_3506_BASE checkout');
    if (changed) throw blocked(`the DEEP_3506_BASE checkout holds changed files, so it isn't the merge base's program: ${changed.split('\n').slice(0, 5).join('; ')}`);
  } else {
    const differs = exportDiffers(path, base);
    if (differs.length) throw blocked(`DEEP_3506_BASE names a folder with no git whose program isn't the merge base's (${base.slice(0, 9)}): ${differs.length} files, ${differs.slice(0, 5).join('; ')}`);
  }
  const commit = base;
  const debug = join(path, 'target', 'debug');
  const lack = binaries.filter((b) => !executable(join(debug, b)));
  if (lack.length) throw blocked(`the DEEP_3506_BASE checkout isn't built: its target/debug lacks ${lack.join(', ')} (CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked ${lack.map((b) => `--bin ${b}`).join(' ')})`);
  return { path, commit, debug };
}
