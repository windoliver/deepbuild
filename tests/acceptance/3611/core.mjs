// How the #3611 acceptance tests drive a canvas core (README: The surface under test). The core is `deep-show canvas`,
// the hub's long-lived canvas core: one JSON line in (`{"world": …}` or `{"call": …}`), one answer line out, as
// packages/hub/src/canvas.ts sends them. Here the test stands where the hub stands: it makes the launch key, keeps it
// in memory, and gives it to each core it starts in the world's `pack_checks`, on the core's input pipe. Nothing here
// stands in for the core: every row, count and listing a test reads is the program's own.
//
// A failed check is node:assert's AssertionError from `must`. What can't run throws a plain Error starting `BLOCKED:`
// or `INCONCLUSIVE:`; nothing unrun passes. Every process started here is stopped by its PID and every folder removed.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout under test: this suite is three levels down. */
export const REPO = join(HERE, '..', '..', '..');

const supplied = process.env.DEEP_BIN_DIR;
/** `deep-show`: from DEEP_BIN_DIR when the proof run supplies it, else this checkout's debug build. */
export const SHOW_BIN = join(supplied === undefined ? join(REPO, 'target', 'debug') : resolve(supplied), 'deep-show');

/** The three planted cores the criteria name, as a world's `planted` spells them (README: The planted cores). */
export const PLANTED = ['takes_row_of_another_digest', 'takes_row_of_another_build', 'admits_on_unreadable_row'];

export const blocked = (text) => Error(`BLOCKED: ${text}`);
export const inconclusive = (text) => Error(`INCONCLUSIVE: ${text}`);
export const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v, n = 400) => (JSON.stringify(v) ?? String(v)).slice(0, n);

/** The failed check: an AssertionError thrown from this suite's own files. */
export function must(ok, message) {
  assert.ok(ok, message);
}

/** No failure of a judge; the message lists each, and each names what failed. */
export function none(failures, what) {
  must(failures.length === 0, `${what}:\n  ${failures.join('\n  ')}`);
}

/** At least one failure, and one that holds every one of `names`: what a planted core must give. */
export function failsNaming(failures, names, what) {
  must(failures.length > 0, `${what} must fail this check, and the check found nothing wrong`);
  must(failures.some((f) => names.every((name) => f.includes(name))), `${what}: one failure names ${names.join(' and ')}; the failures were:\n  ${failures.join('\n  ')}`);
}

/**
 * Builds deep-show unless the proof run supplied it, as #2694's and #3262's suites do (the environment as given, so a
 * fresh build compiles nothing); BLOCKED when there is no binary.
 */
export function showBinary() {
  if (supplied === undefined) {
    const run = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw blocked(`cargo build --locked --bin deep-show failed: ${run.error?.message ?? run.stderr.slice(-3000)}`);
  }
  try { accessSync(SHOW_BIN, constants.X_OK); } catch { throw blocked(`${SHOW_BIN} is missing or not executable`); }
  return SHOW_BIN;
}

// ---------------------------------------------------------------------------------------------------
// Time: a bound on each answer and on the file, never a wait.

/** The proof lanes stop a file at 20 minutes: what a file's cores may take together, with room to stop them. */
const FILE_MS = 18 * 60_000;
const started = Date.now();
/** How long one answer of a core may take: a debug core checks the 21 shipped packs in minutes on a loaded machine. */
export const ANSWER_MS = 12 * 60_000;

/**
 * Resolves with `promise`, or rejects INCONCLUSIVE, after `stop` has stopped what was waited for, once `most` or what
 * is left of the file's time has passed.
 */
export function within(promise, what, stop, most = ANSWER_MS) {
  const left = Math.max(1000, Math.min(most, FILE_MS - (Date.now() - started)));
  let timer;
  // deadline: only turns a core that never answers, or a file past its time, into a result that names it.
  const late = new Promise((_, reject) => { timer = setTimeout(() => { stop(); reject(inconclusive(`no ${what} within ${Math.round(left / 1000)} s (one answer's ${Math.round(most / 60_000)} minutes, or what was left of the ${FILE_MS / 60_000} a file may take)`)); }, left); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------------------------------
// Folders: each test's own under /tmp/dh3611-*, laid out as a hub's root, removed after the test.

const made = new Set();
const running = new Set();
process.on('exit', () => {
  // What a test that threw left behind: only this file's own children, by PID, and its own folders.
  for (const child of running) try { if (child.pid) process.kill(child.pid, 'SIGKILL'); } catch { /* it has ended */ }
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/**
 * A hub's root as the design step lays it out, in a folder of the test's own: `evidence/` and `packs/checked/` under
 * `root`, and beside the root a folder for the test's pack folders. `key` is a launch key, 32 random bytes made now,
 * in hex as `pack_checks` carries it; it is in this process's memory and nowhere else.
 */
export function tempRoot() {
  let tmp;
  try { tmp = realpathSync(mkdtempSync('/tmp/dh3611-')); } catch (error) { throw blocked(`no temporary folder: ${error.message}`); }
  made.add(tmp);
  const root = join(tmp, 'root');
  const at = { tmp, root, evidence: join(root, 'evidence'), checked: join(root, 'packs', 'checked'), folders: join(tmp, 'folders'), key: randomBytes(32).toString('hex') };
  for (const dir of [at.evidence, at.checked, at.folders]) mkdirSync(dir, { recursive: true });
  return at;
}
/** Another evidence store under the same root's folder, empty. */
export function emptyEvidence(at, name) {
  const dir = join(at.tmp, name);
  mkdirSync(dir);
  return dir;
}
export function removeRoot(at) {
  rmSync(at.tmp, { recursive: true, force: true });
  made.delete(at.tmp);
}

// ---------------------------------------------------------------------------------------------------
// The core: `deep-show canvas`, one line at a time.

const stopChild = (child) => { try { if (child.exitCode === null && child.signalCode === null && child.pid) process.kill(child.pid, 'SIGKILL'); } catch { /* it has just ended */ } };

/** Starts `bin canvas`: `send(line, what)` gives its answer line, whole; `close()` stops it by PID and waits for its end. */
export function startCore(bin = SHOW_BIN) {
  const at = performance.now();
  const child = spawn(bin, ['canvas'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  let said = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-2000); });
  child.stdin.on('error', () => undefined);
  const waiting = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value;
    try { value = JSON.parse(line); } catch { value = { ok: false, code: 'bad_output', line: line.slice(0, 600) }; }
    waiting.shift()?.({ value: isObject(value) ? value : { ok: false, code: 'not_an_object', line: line.slice(0, 600) }, at: performance.now() });
  });
  let failed = '';
  const ended = new Promise((done) => { child.once('exit', done); child.once('error', (error) => { failed = error.message; done(); }); });
  const gone = () => ({ value: { ok: false, code: 'canvas_core_exited', said: (failed || said).trim() }, at: performance.now() });
  void ended.then(() => { running.delete(child); for (const wake of waiting.splice(0)) wake(gone()); });
  /** One line written now; resolves with its answer line and when it was read. */
  const timed = (line, what, most) => {
    const answer = new Promise((done) => {
      if (child.exitCode !== null || child.signalCode !== null || failed) return done(gone());
      waiting.push(done);
      child.stdin.write(`${JSON.stringify(line)}\n`);
    });
    return within(answer, `answer of the core to ${what}`, () => stopChild(child), most);
  };
  return {
    pid: child.pid,
    at,
    timed,
    send: (line, what, most) => timed(line, what, most).then(({ value }) => value),
    async close() { stopChild(child); await ended; },
  };
}

/**
 * Starts a core and gives it its world. A world that plants one of this suite's wrong programs must be taken: a
 * refusal of it is a failed check, naming the planted core. Any other world refused is BLOCKED.
 */
export async function openCore(world, what = 'a core', bin = SHOW_BIN) {
  const core = startCore(bin);
  const set = await core.send({ world }, `the world of ${what}`);
  if (set.ok !== true) {
    await core.close();
    must(!PLANTED.includes(world.planted), `${what}: the core doesn't take a world whose \`planted\` is \`${world.planted}\` (README: The planted cores): it answered ${brief(set, 600)}`);
    throw blocked(`${what}: deep-show canvas doesn't take the world: ${brief(set, 800)}`);
  }
  return core;
}

const PANELS = { main: { rect: [0, 0, 800, 600] } };
/**
 * The world the hub gives a core it starts, as packages/hub/src/canvas.ts `shape` builds it with no session and no
 * document: the evidence store, the packs, each `{id, dir}`, and the design step's `pack_checks: {dir, key}`.
 */
export function worldOf(at, packs, extra = {}) {
  return { evidence: at.evidence, sessions: {}, record: {}, panels: PANELS, docs: {}, packs, pack_checks: { dir: at.checked, key: at.key }, ...extra };
}

/** One call's reply; BLOCKED when the core gives none. */
export async function ask(core, call, what, most) {
  const answer = await core.send({ call }, `${call.call} of ${what}`, most);
  if (answer.ok !== true || !isObject(answer.reply)) throw blocked(`${what}: the core gave no reply to ${call.call}: ${brief(answer, 800)}`);
  return answer.reply;
}

/** The `packs` call: its rows, and the `counts` the design step puts beside them (undefined where the reply has none). */
export async function packsOf(core, what, most) {
  const reply = await ask(core, { call: 'packs' }, what, most);
  if (!Array.isArray(reply.packs) || !reply.packs.every(isObject)) throw blocked(`${what}: the packs call gave no rows: ${brief(reply, 600)}`);
  return { rows: reply.packs, counts: reply.counts };
}

/** The build's source digest, as the `fingerprint` call names it. */
export async function buildOf(core, what) {
  const reply = await ask(core, { call: 'fingerprint' }, what);
  const build = isObject(reply.fingerprint) ? reply.fingerprint.build : undefined;
  if (typeof build !== 'string' || !/^[0-9a-f]{64}$/.test(build)) throw blocked(`${what}: the fingerprint call names no build digest: ${brief(reply, 600)}`);
  return build;
}

/** Every page of `deep_kinds list`, from the first, following each page's `next`, as the hub's call asks them. */
export async function listingOf(core, what) {
  const pages = [];
  let cursor;
  for (let page = 1; page <= 2000; page++) {
    const reply = await ask(core, cursor === undefined ? { call: 'deep_kinds', op: 'list' } : { call: 'deep_kinds', op: 'list', cursor }, `${what} (page ${page} of its listing)`);
    if (isObject(reply.error) || reply.code === 'bad_input') throw blocked(`${what}: deep_kinds list refused page ${page}: ${brief(reply, 600)}`);
    pages.push(reply);
    if (typeof reply.next !== 'string' || reply.next === '') return pages;
    cursor = reply.next;
  }
  throw blocked(`${what}: deep_kinds list still has a next page after 2,000`);
}

/**
 * Runs forger.mjs, the process that is not the hub (criterion 4), as a process of its own: its arguments are the hub's
 * root and the rows to write, its environment holds PATH alone, and its input is closed, so it is given nothing a hub
 * or a core holds in memory. Gives its report; BLOCKED when it gives none.
 */
export async function notTheHub(root, jobs = []) {
  const child = spawn(process.execPath, [join(HERE, 'forger.mjs'), root, JSON.stringify(jobs)], { cwd: root, env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  running.add(child);
  let out = '', said = '';
  child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-2000); });
  // `close`, not `exit`: every line it printed has been read by then.
  const ended = new Promise((done) => { child.once('close', (code, signal) => done(code ?? signal)); child.once('error', (error) => done(error.message)); });
  const status = await within(ended, 'end of the process that is not the hub', () => stopChild(child), 10 * 60_000).finally(() => running.delete(child));
  let report = null;
  try { report = JSON.parse(out.trim().split('\n').at(-1) ?? 'null'); } catch { /* below */ }
  if (status !== 0 || !isObject(report)) throw blocked(`forger.mjs gave no report (exit ${String(status)}): ${out.slice(0, 400)} ${said.slice(-800)}`);
  return report;
}

/** A fresh core given `world`, asked `packs` as its first call, and stopped: its rows and counts. */
export async function packsOnce(world, what) {
  const core = await openCore(world, what);
  try { return await packsOf(core, what); } finally { await core.close(); }
}
