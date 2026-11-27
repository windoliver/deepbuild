import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, '..', '..', '..');

export const AC = { 1: '#3529.1f362433', 2: '#3529.cc8f3bb2', 3: '#3529.be72c1ed', 4: '#3529.50c3d51b' };

export const ISSUE_PROGRAMS = 48;
export const ISSUE_COMPILES = 109;

export function must(ok, message) {
  assert.ok(ok, message);
}
export const blocked = (text) => Error(`BLOCKED: ${text}`);
export const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
export const list = (v) => (Array.isArray(v) ? v : []);
export const brief = (v, n = 600) => (JSON.stringify(v) ?? String(v)).slice(0, n);
export function same(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

const suppliedByProofRun = process.env.DEEP_BIN_DIR;
const binDir = suppliedByProofRun === undefined ? join(REPO, 'target', 'debug') : resolve(suppliedByProofRun);
const HOMEBREW_RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';

const builtInThisProcess = new Set();
export function suppliedOrBuiltBinary(name) {
  const path = join(binDir, name);
  if (suppliedByProofRun === undefined && !builtInThisProcess.has(name)) {
    const lanesProfile = {
      ...process.env,
      CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
      CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0',
      ...(existsSync(HOMEBREW_RUSTUP_BIN) ? { PATH: `${HOMEBREW_RUSTUP_BIN}:${process.env.PATH ?? ''}` } : {}),
    };
    delete lanesProfile.CARGO_TARGET_DIR;
    const run = spawnSync('cargo', ['build', '--locked', '--bin', name], { cwd: REPO, env: lanesProfile, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error || run.status !== 0) throw blocked(`cargo build --locked --bin ${name} failed: ${run.error?.message ?? run.stderr.slice(-3000)}`);
    builtInThisProcess.add(name);
  }
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw blocked(`${name} is missing or not executable (${suppliedByProofRun === undefined ? 'target/debug' : 'DEEP_BIN_DIR'})`);
  }
  return path;
}

export const ANSWER_MS = 8 * 60_000;

export function answerWithin(promise, what, ms, stop) {
  let timer;
  // deadline: only turns a program that never answers into a result that names it.
  const late = new Promise((_, reject) => { timer = setTimeout(() => { stop(); reject(Error(`INCONCLUSIVE: no ${what} within ${Math.round(ms / 1000)} s`)); }, ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const running = new Set();
const stopByPid = (child) => {
  try {
    if (child.exitCode === null && child.signalCode === null && child.pid) process.kill(child.pid, 'SIGKILL');
  } catch {}
};
process.on('exit', () => { for (const child of running) stopByPid(child); });

export function openLineProgram(bin, args, name) {
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
  const closedWithEveryLineRead = new Promise((done) => {
    child.once('close', (code, signal) => done(code ?? signal));
    child.once('error', (error) => done(error.message));
  });
  const answerOfEndedProgram = (status) => ({ ok: false, code: 'exited', status, said: said.trim() });
  let status;
  void closedWithEveryLineRead.then((how) => {
    status = how ?? 'ended';
    running.delete(child);
    for (const wake of waiting.splice(0)) wake(answerOfEndedProgram(status));
  });
  return {
    name,
    send(line, what, ms = ANSWER_MS) {
      const answer = new Promise((done) => {
        if (status !== undefined) return done(answerOfEndedProgram(status));
        waiting.push(done);
        child.stdin.write(`${JSON.stringify(line)}\n`);
      });
      return answerWithin(answer, `answer of ${name} to ${what}`, ms, () => stopByPid(child));
    },
    async close() {
      stopByPid(child);
      await closedWithEveryLineRead;
    },
  };
}
