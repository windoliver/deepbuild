// #689 AC2 #689.aa1fa756: on 1.99.1, `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets --locked --
// -D warnings` and `cargo test --workspace --locked` pass.
// Run: node --test tests/acceptance/689-redraft-2047/ac2-checks.test.mjs   (README.md beside this file; it builds and
// tests the whole workspace, so it takes from tens of minutes to hours).
//
// The three commands at the repository root on 1.99.1, in the issue's order, each under the checkout's lease script at a
// lower priority; the first that fails ends the test. 1.99.1 is asked for by name (RUSTUP_TOOLCHAIN), so this judges the
// code on that release whatever the checkout pins (AC1 judges the pin). cargo test runs with --no-fail-fast, as the unit
// lane runs it, so every failing test is named; a failure scripts/known-failures.json lists for main, under the ID the
// unit lane gives it, is set apart as the lane sets it apart, and any other fails the test. Nothing is installed: a
// missing toolchain, rustfmt or clippy, a run the machine stopped, or crates that can't be fetched read INCONCLUSIVE.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { AC2, MINUTE, PIN, ROOT, childEnv, inconclusive, leased, makeBox, pinnedInstalled, run, rustupBin, shown, tail, userCargoHome, userRustupHome, withPath } from './helpers.mjs';

const HOUR = 60 * MINUTE;
const WORLD = /toolchain '[^']+' is not installed|is not installed for the toolchain|failed to download|failed to get `[^`]+` as a dependency|Couldn't resolve host|spurious network error|failed to query replaced source|No space left on device|\(signal: 9, SIGKILL: kill\)/;

/** A run the machine, not the code, ended or kept from starting. */
function world(name, ran) {
  if (ran.error && !ran.timedOut) inconclusive(`${name} could not start: ${ran.error.message}`);
  if (ran.timedOut) inconclusive(`${name} was stopped after ${(ran.ms / HOUR).toFixed(1)} h, its time limit: ${tail(ran.out, 1500)}`);
  if (ran.signal) inconclusive(`${name} was stopped by ${ran.signal}, not by its own end: ${tail(ran.out, 1500)}`);
  const found = ran.status !== 0 && ran.out.match(WORLD)?.[0];
  if (found) inconclusive(`${name} couldn't run here (${found}): ${tail(ran.out, 1500)}`);
}

/** The failing tests in cargo test's output, by the IDs the unit lane gives them (scripts/lanes.mjs, cargoResults). */
async function failingTests(out, env) {
  const { cargoResults, crates } = await import(pathToFileURL(join(ROOT, 'scripts/lanes.mjs')).href);
  // crates() asks cargo metadata, which it finds on PATH, in this process's environment: the run's, for the call.
  const keys = ['PATH', 'RUSTUP_HOME', 'CARGO_HOME', 'RUSTUP_TOOLCHAIN', 'RUSTUP_AUTO_INSTALL', 'RUSTUP_DIST_SERVER', 'RUSTUP_UPDATE_ROOT'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) process.env[key] = env[key];
  try {
    return cargoResults(out, 1, crates(ROOT)).failures;
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test(`${AC2} on 1.99.1, cargo fmt --all -- --check, cargo clippy --workspace --all-targets --locked -- -D warnings and cargo test --workspace --locked pass`, { timeout: 12 * HOUR }, async (t) => {
  const bin = rustupBin();
  pinnedInstalled();
  const box = makeBox(t, 'ac2');
  const env = childEnv({ PATH: withPath(bin), RUSTUP_HOME: userRustupHome(), CARGO_HOME: userCargoHome(), RUSTUP_TOOLCHAIN: PIN });

  // The release and its tools: what cargo will run is 1.99.1's rustc, rustfmt and clippy.
  for (const [args, shape] of [[['rustc', '--version'], new RegExp(`^rustc ${PIN.replaceAll('.', '\\.')} `)], [['cargo', 'fmt', '--version'], /^rustfmt /], [['cargo', 'clippy', '--version'], /^clippy /]]) {
    const ran = run(args[0], args.slice(1), { cwd: ROOT, env, log: join(box, `${args.join('-')}.log`), timeout: 2 * MINUTE });
    if (ran.status !== 0 || !shape.test(ran.out)) inconclusive(`${args.join(' ')} on ${PIN} doesn't answer as ${shape} (is ${PIN} installed with rustfmt and clippy?): ${shown(ran)}`);
  }

  const fmt = leased(['cargo', 'fmt', '--all', '--', '--check'], { cwd: ROOT, env, log: join(box, 'fmt.log'), timeout: 30 * MINUTE });
  world('cargo fmt --all -- --check', fmt);
  const unformatted = [...new Set([...fmt.out.matchAll(/^Diff in (.+?):\d+:?$/gm)].map(([, file]) => file.replace(`${ROOT}/`, '')))];
  assert.equal(fmt.status, 0, `cargo fmt --all -- --check fails on ${PIN}${unformatted.length ? `, ${unformatted.length} files unformatted: ${unformatted.slice(0, 20).join(', ')}` : ''}. ${shown(fmt)}`);

  const clippy = leased(['cargo', 'clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'], { cwd: ROOT, env, log: join(box, 'clippy.log'), timeout: 6 * HOUR });
  world('cargo clippy', clippy);
  const errors = clippy.out.split('\n').filter((line) => /^error(\[\w+\])?:/.test(line)).slice(0, 20);
  assert.equal(clippy.status, 0, `cargo clippy --workspace --all-targets --locked -- -D warnings fails on ${PIN}: ${errors.join(' | ')}. ${shown(clippy)}`);

  const tests = leased(['cargo', 'test', '--workspace', '--locked', '--no-fail-fast'], { cwd: ROOT, env, log: join(box, 'test.log'), timeout: 6 * HOUR });
  world('cargo test', tests);
  if (tests.status === 0) return;
  const known = JSON.parse(readFileSync(join(ROOT, 'scripts/known-failures.json'), 'utf8')).failures ?? {};
  const failures = await failingTests(tests.out, env);
  assert.ok(failures.length, `cargo test --workspace --locked exits ${tests.status} on ${PIN} and names no failing test. ${shown(tests)}`);
  const unlisted = failures.filter(({ id, state }) => state === 'FAIL' && !Object.hasOwn(known, id)).map(({ id }) => id);
  assert.deepEqual(unlisted, [], `cargo test --workspace --locked fails on ${PIN} beyond main's listed failures. ${shown(tests)}`);
  for (const { id } of failures.filter(({ id }) => Object.hasOwn(known, id))) t.diagnostic(`LISTED ${id}: ${known[id]}`);
  // A harness's own BLOCKED, INVALID or INCONCLUSIVE case proved nothing, so the run can't pass.
  const unsure = failures.filter(({ state }) => state !== 'FAIL').map(({ id, state, message }) => `${state} ${id}${message ? `: ${message}` : ''}`);
  if (unsure.length) inconclusive(`cargo test --workspace --locked left ${unsure.length} unproven on ${PIN}: ${unsure.slice(0, 10).join(' | ')}`);
});
