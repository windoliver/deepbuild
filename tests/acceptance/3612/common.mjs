// What every file of the #3612 acceptance suite shares (README: The surface under test): the checkout, the
// criteria's IDs and the issue's two counts, the failed check, where a binary is taken from, and how a program that
// reads JSON lines and writes one reply a line is driven. Nothing here stands in for the logic module or the canvas
// core: every count, record, hash and refusal a test reads is the program's own.
//
// A failed check is node:assert's AssertionError, thrown from `must`. What can't run throws a plain Error starting
// `BLOCKED:` or `INCONCLUSIVE:`, naming it; nothing missing or unrun passes. Every process started here is stopped by
// its PID.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout under test: this suite is three levels down. */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's ID (scripts/proof-change.mjs `criterionId`: the first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = { 1: '#3612.77719146', 2: '#3612.0873686d', 3: '#3612.5bdaac1f' };

/** The issue's own numbers: the shipped packs' checks make 57 pieces, and the merge base checks 109. */
export const PIECES = 57;
export const BASE_CHECKS = 109;

/** The failed check: an AssertionError thrown from this suite's own files. */
export function must(ok, message) {
  assert.ok(ok, message);
}
export const blocked = (text) => Error(`BLOCKED: ${text}`);
export const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
export const brief = (v, n = 600) => (JSON.stringify(v) ?? String(v)).slice(0, n);
/** Whether two JSON values are the same, key order aside. */
export function same(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------
// Binaries: from DEEP_BIN_DIR when the proof run supplies it, else this checkout's debug build.

const supplied = process.env.DEEP_BIN_DIR;
const binDir = supplied === undefined ? join(REPO, 'target', 'debug') : resolve(supplied);
/** rustup's cargo on a Mac whose Homebrew keeps it off the default PATH, as #531's suite finds it. */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';

const built = new Set();
/**
 * The binary `name`. Unless the proof run supplied it, it is built first, once a process, into this checkout's
 * target/ with the profile the lanes build with (CARGO_INCREMENTAL and CARGO_PROFILE_DEV_DEBUG are 0 unless the
 * caller set them), so a build made that way is found fresh and compiles nothing. BLOCKED when there is no binary.
 */
export function binary(name) {
  const path = join(binDir, name);
  if (supplied === undefined && !built.has(name)) {
    /** @type {Record<string, string | undefined>} */
    const env = {
      ...process.env,
      CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
      CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0',
      ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env.PATH ?? ''}` } : {}),
    };
    // The binary is read from this checkout's target/, so it is built there.
    delete env.CARGO_TARGET_DIR;
    const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw blocked(`cargo build --locked --bin ${name} failed: ${run.error?.message ?? run.stderr.slice(-3000)}`);
    built.add(name);
  }
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw blocked(`${name} is missing or not executable (${supplied === undefined ? 'target/debug' : 'DEEP_BIN_DIR'})`);
  }
  return path;
}

// ---------------------------------------------------------------------------------------------------
// A program driven by lines: one JSON line in, one reply line out, one at a time.

/** How long one reply may take. A fresh debug core's first reply with the 21 packs took 6 s on the Mac this was written on, at a load of 56 on 18 cores. */
export const ANSWER_MS = 5 * 60_000;

/** Resolves with `promise`, or rejects INCONCLUSIVE once `ms` have passed, after `stop` has stopped what was waited for. */
export function within(promise, what, ms, stop) {
  let timer;
  // deadline: only turns a program that never answers into a result that names it.
  const late = new Promise((_, reject) => { timer = setTimeout(() => { stop(); reject(Error(`INCONCLUSIVE: no ${what} within ${Math.round(ms / 1000)} s`)); }, ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const running = new Set();
const stopChild = (child) => {
  try {
    if (child.exitCode === null && child.signalCode === null && child.pid) process.kill(child.pid, 'SIGKILL');
  } catch { /* it has just ended */ }
};
// Whatever a test left running when its file ends is stopped, by PID.
process.on('exit', () => { for (const child of running) stopChild(child); });

/**
 * Starts `bin args` in the checkout. `send(line, what)` writes one line and resolves with the reply line, as an
 * object; a program that has ended, or ends before it answers, answers `{ok: false, code: 'exited', status, said}`,
 * and a line that isn't a JSON object `{ok: false, code: 'bad_output', line}`. `close()` stops it by PID and waits.
 */
export function open(bin, args, name) {
  const child = spawn(bin, args, { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  let said = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { said = (said + d).slice(-2000); });
  child.stdin.on('error', () => undefined);
  const waiting = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value;
    try { value = JSON.parse(line); } catch { value = undefined; }
    waiting.shift()?.(isObject(value) ? value : { ok: false, code: 'bad_output', line: line.slice(0, 600) });
  });
  // `close`, not `exit`: every line it printed has been read by then.
  const ended = new Promise((done) => {
    child.once('close', (code, signal) => done(code ?? signal));
    child.once('error', (error) => done(error.message));
  });
  const gone = (status) => ({ ok: false, code: 'exited', status, said: said.trim() });
  let status;
  void ended.then((how) => {
    status = how ?? 'ended';
    running.delete(child);
    for (const wake of waiting.splice(0)) wake(gone(status));
  });
  return {
    name,
    send(line, what, ms = ANSWER_MS) {
      const answer = new Promise((done) => {
        if (status !== undefined) return done(gone(status));
        waiting.push(done);
        child.stdin.write(`${JSON.stringify(line)}\n`);
      });
      return within(answer, `answer of ${name} to ${what}`, ms, () => stopChild(child));
    },
    async close() {
      stopChild(child);
      await ended;
    },
  };
}
