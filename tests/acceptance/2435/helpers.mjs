// Shared by the #2435 acceptance tests. The probe is reached only through what it leaves in the repo and
// what it prints: its crate at spikes/2435 (built once with cargo), its committed report at
// spikes/2435/record.json, and one JSON report on stdout per run. README.md has the shapes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SPIKE = 'spikes/2435';
export const RECORD = `${SPIKE}/record.json`;
export const BIN = `${SPIKE}/target/release/spike-2435`;
export const PARTS = ['candidates', 'build_order', 'ties', 'rebuilds'];
// Design, Budgets: "The reference Macs".
export const REFERENCE_MACS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];
// The wgpu 30.0.1 feature (wgpu-types `Features::EXPERIMENTAL_RAY_QUERY`) a GPU without ray queries lacks.
export const RAY_QUERY = 'EXPERIMENTAL_RAY_QUERY';
// Invariant 2: what missing or unrun reads. Never PASS.
export const NOT_PASS = ['BLOCKED', 'INVALID', 'INCONCLUSIVE'];

export const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const count = (x) => Number.isInteger(x) && x >= 0;
export const finite = (x) => typeof x === 'number' && Number.isFinite(x);

// The committed report, made on a reference Mac.
export function loadRecord() {
  const path = join(root, RECORD);
  if (!existsSync(path)) throw new Error(`BLOCKED: the probe left no report at ${RECORD}`);
  let r;
  try {
    r = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`INVALID: ${RECORD} is not JSON: ${e.message}`);
  }
  if (!obj(r) || r.issue !== 2435) throw new Error(`INVALID: ${RECORD} is not #2435's report (issue: ${JSON.stringify(r?.issue)})`);
  const h = r.host;
  if (!obj(h) || !REFERENCE_MACS.includes(h.model) || h.os !== 'macOS' || typeof h.os_build !== 'string' || !h.os_build.trim()) {
    throw new Error(`INVALID: ${RECORD} wasn't made on a reference Mac (${REFERENCE_MACS.join(', ')}) with its macOS build named: host ${JSON.stringify(h)}`);
  }
  return r;
}

export function recordPart(r, name) {
  assert.ok(obj(r.parts) && obj(r.parts[name]), `${RECORD} has no parts.${name}`);
  return r.parts[name];
}

// A plant shown failing in the committed report (the issue's Proof): the probe's stdout report from that run.
export function recordPlant(r, name) {
  assert.ok(obj(r.plants) && obj(r.plants[name]), `${RECORD} doesn't show the plant: no plants.${name}`);
  return r.plants[name];
}

// A part that had to read PASS or FAIL. A part the probe couldn't run fails the test in its own state, so a
// machine without ray queries reads BLOCKED here, never a pass (#1115).
export function reading(out, name, shown) {
  const p = out?.parts?.[name];
  assert.ok(obj(p), `${shown}: the report has no parts.${name}`);
  if (NOT_PASS.includes(p.status)) throw new Error(`${p.status}: ${shown} read ${p.status} for ${name}, so it couldn't be judged: ${p.reason}`);
  return p;
}

// True when `text` names the integer n, as 12345 or 12,345, and not as part of another number.
export function names(text, n) {
  if (typeof text !== 'string') return false;
  return [String(n), n.toLocaleString('en-US')].some((s) => new RegExp(`(^|[^\\d,.])${s}($|[^\\d,])`).test(text));
}

function findCargo(cwd) {
  const works = (c) => spawnSync(c, ['--version'], { cwd, encoding: 'utf8' }).status === 0;
  for (const c of [process.env.CARGO, 'cargo', join(homedir(), '.cargo', 'bin', 'cargo')]) if (c && works(c)) return c;
  for (const r of ['rustup', join(homedir(), '.cargo', 'bin', 'rustup'), '/opt/homebrew/bin/rustup']) {
    const w = spawnSync(r, ['which', 'cargo'], { cwd, encoding: 'utf8' });
    const c = w.status === 0 ? w.stdout.trim() : '';
    if (c && works(c)) return c;
  }
  return null;
}

// Builds the probe once per process; cargo makes every later build in the suite a no-op.
let built = null;
export function buildProbe() {
  if (built) return built;
  const dir = join(root, SPIKE);
  if (!existsSync(join(dir, 'Cargo.toml'))) throw new Error(`BLOCKED: no probe crate at ${SPIKE}/Cargo.toml`);
  const lock = join(dir, 'Cargo.lock');
  if (!existsSync(lock)) throw new Error(`INVALID: the probe has no Cargo.lock of its own at ${SPIKE}/Cargo.lock`);
  const text = readFileSync(lock, 'utf8');
  for (const name of ['wgpu', 'wgpu-core']) {
    if (!new RegExp(`name = "${name}"\\r?\\nversion = "30\\.0\\.1"`).test(text)) {
      throw new Error(`INVALID: ${SPIKE}/Cargo.lock doesn't pin ${name} 30.0.1, the pinned wgpu the issue asks about`);
    }
  }
  const cargo = findCargo(dir);
  if (!cargo) throw new Error('BLOCKED: no cargo (on PATH, in ~/.cargo/bin or through rustup) to build the probe');
  const env = { ...process.env };
  if (isAbsolute(cargo)) env.PATH = `${dirname(cargo)}${delimiter}${env.PATH ?? ''}`;
  const b = spawnSync(cargo, ['build', '--release', '--locked', '--quiet'], { cwd: dir, env, encoding: 'utf8', timeout: 30 * 60_000 });
  assert.equal(b.status, 0, `the probe doesn't build (cargo build --release --locked in ${SPIKE}: exit ${b.status}, ${b.signal ?? 'no signal'}):\n${(b.stderr ?? '').slice(-4000)}`);
  const bin = join(root, BIN);
  if (!existsSync(bin)) throw new Error(`INVALID: the probe built but left no binary at ${BIN}`);
  return (built = bin);
}

// One live run of the probe on this Mac's GPU. Its stdout is one JSON report; it exits 0 only on PASS.
export function runProbe(args, { env = {} } = {}) {
  const bin = buildProbe();
  const shown = `${BIN} ${args.join(' ')}`;
  const r = spawnSync(bin, args, { cwd: root, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 1 << 28, env: { ...process.env, ...env } });
  assert.ok(!r.error, `${shown} didn't finish within 10 minutes: ${r.error?.message}`);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    assert.fail(`${shown} printed no JSON report on stdout (exit ${r.status}, ${r.signal ?? 'no signal'}):\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(-3000)}`);
  }
  assert.ok(obj(out) && obj(out.parts), `${shown}: the report has no parts: ${r.stdout.slice(0, 2000)}`);
  return { exit: r.status, out, shown };
}

// A run that didn't read PASS exits with a non-zero code, not by a signal.
export function exitedNotPass({ exit, out, shown }) {
  assert.ok(exit !== null && exit !== 0, `${shown} read ${out.status} but exited ${exit}; only PASS exits 0`);
}
