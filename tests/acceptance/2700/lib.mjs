// #2700 acceptance: what the test files share. The code under test is the canvas core of the checkout these files are
// in, reached only through its public entry: the probe (probe/, a small Rust program outside the workspace) calls
// `deep_canvas::document::{apply_ops, check_in, recheck, recheck_with, Referrers}` and prints what it saw as one JSON
// line; the tests here judge that line. The probe is built by cargo into this checkout's own target/acceptance-2700,
// so the change, the merge base's copy and a planted twin's copy each run their own canvas core.
// A probe that can't be built or run, or that prints no report, fails its test as BLOCKED: nothing unrun passes.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const CHANGE = resolve(HERE, '../../..');

/** The issue's criteria, by `#<issue>.<first 8 hex of SHA-256 of the trimmed, space-collapsed text>`. */
export const AC = {
  heap: '#2700.9725b660',
  equal: '#2700.ce79405c',
  dataRow: '#2700.65df5186',
  budgets: '#2700.db66efb8',
  asGiven: '#2700.934bb9b3',
};

const PROBE = join(HERE, 'probe');
const TARGET = 'target/acceptance-2700';
// The package cargo builds: a copy of probe/ under the target folder, its one path dependency pointed at this
// checkout's canvas core from there. Cargo records the checkout's `[patch]` entries (.cargo/config.toml) in a
// lockfile even when the package uses none of them, so a build of probe/ itself would rewrite probe/Cargo.lock, or
// fail under --locked, whenever main changes a patch. The copy's lockfile starts as probe/Cargo.lock, which pins
// every crate the probe builds, and only the copy is ever rewritten.
const COPY = `${TARGET}/probe`;
const MANIFEST = `${COPY}/Cargo.toml`;
const BINARY = join(CHANGE, TARGET, 'release', process.platform === 'win32' ? 'acceptance-2700-probe.exe' : 'acceptance-2700-probe');
const tail = (text, n = 3000) => String(text ?? '').slice(-n);

/** Lays probe/ under the target folder; a file is written only when its text differs, so a second build is a no-op. */
function layProbe() {
  const put = (path, text) => {
    const to = join(CHANGE, COPY, path);
    mkdirSync(dirname(to), { recursive: true });
    if (!existsSync(to) || readFileSync(to, 'utf8') !== text) writeFileSync(to, text);
  };
  const manifest = readFileSync(join(PROBE, 'Cargo.toml'), 'utf8');
  const there = 'path = "../../../../crates/deep-canvas"';
  if (!manifest.includes(there)) return `BLOCKED: probe/Cargo.toml no longer names the canvas core as ${there}`;
  put('Cargo.toml', manifest.replace(there, 'path = "../../../crates/deep-canvas"'));
  put('src/main.rs', readFileSync(join(PROBE, 'src/main.rs'), 'utf8'));
  // The pins: laid once per copy, then cargo's to keep (it changes only the unused-patch entries).
  if (!existsSync(join(CHANGE, COPY, 'Cargo.lock'))) put('Cargo.lock', readFileSync(join(PROBE, 'Cargo.lock'), 'utf8'));
  return null;
}

let built = null;
/** Builds the probe against this checkout's canvas core, once per process; `{ blocked }` says why it couldn't. */
function build() {
  if (built) return built;
  let laid;
  try {
    laid = layProbe();
  } catch (error) {
    laid = `BLOCKED: the probe could not be laid under ${COPY}: ${error.message}`;
  }
  if (laid) return (built = { blocked: laid });
  const args = ['build', '--release', '--quiet', '--manifest-path', MANIFEST, '--target-dir', TARGET];
  // A build that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync('cargo', args, { cwd: CHANGE, encoding: 'utf8', timeout: 2_400_000, maxBuffer: 1 << 26 });
  if (r.error) return (built = { blocked: `BLOCKED: cargo ${args.join(' ')} did not run: ${r.error.message}` });
  if (r.status !== 0) return (built = { blocked: `BLOCKED: the probe does not build against this checkout's canvas core (cargo ${args.join(' ')} exited ${r.status}):\n${tail(r.stderr)}` });
  if (!existsSync(BINARY)) return (built = { blocked: `BLOCKED: the build left no ${TARGET}/release/acceptance-2700-probe` });
  return (built = { binary: BINARY });
}

/**
 * Runs the probe's `mode` and gives its report. A probe that can't be built, exits non-zero or prints no JSON line
 * fails the calling test here, as BLOCKED.
 */
export function probe(mode, ...args) {
  const made = build();
  if (made.blocked) assert.fail(made.blocked);
  const shown = `acceptance-2700-probe ${[mode, ...args].join(' ')}`;
  const r = spawnSync(made.binary, [mode, ...args.map(String)], { cwd: CHANGE, encoding: 'utf8', timeout: 1_200_000, maxBuffer: 1 << 28 });
  if (r.error) assert.fail(`BLOCKED: ${shown} did not run: ${r.error.message}`);
  if (r.status !== 0) assert.fail(`BLOCKED: ${shown} exited ${r.status ?? r.signal}: ${tail(r.stderr) || tail(r.stdout)}`);
  let report = null;
  try {
    report = JSON.parse(r.stdout.trim().split('\n').at(-1));
  } catch {
    report = null;
  }
  if (!report || typeof report !== 'object') assert.fail(`BLOCKED: ${shown} printed no report: ${tail(r.stdout, 500)}`);
  if (report.blocked) assert.fail(`BLOCKED: ${report.blocked}`);
  return report;
}

/** The two rechecks a caller reaches: by passes over the items, and by the referrers the last revision left (#896). */
export const RECHECKS = ['recheck', 'recheck_with'];

export const grouped = (n) => Number(n).toLocaleString('en-US');
export const shown = (value, n = 1500) => JSON.stringify(value).slice(0, n);

/** Machine state for each reading: load and thermal state, a record and never a gate. */
export function machine() {
  const read = (cmd, ...args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '?';
    }
  };
  return `load ${read('sysctl', '-n', 'vm.loadavg')}; ${read('pmset', '-g', 'therm').split('\n').filter((l) => l.trim()).join(' ').replace(/\s+/g, ' ')}`;
}
