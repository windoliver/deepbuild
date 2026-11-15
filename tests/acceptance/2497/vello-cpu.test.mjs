// #2497: deep-marks-render's locked-versions test (gpu::tests::the_named_versions_are_the_locked_ones) holds VELLO_CPU
// (crates/deep-marks-render/src/raster.rs) to the vello_cpu deep-marks-render itself resolves, not to Cargo.lock's
// first [[package]] of that name. The lockfile has held two since #220: 0.0.8, which deep-typeset reaches through
// typst's hayro, and 0.3.0, the one the canvas rasterizes with. One test per criterion, run in order in this one file;
// AC2's plant changes raster.rs for one build and restores it byte for byte. README: readings and how to run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const CRATE = 'deep-marks-render';
const RASTER = 'crates/deep-marks-render/src/raster.rs';
// The test the issue names, by its function name; its module path may move.
const TEST = 'the_named_versions_are_the_locked_ones';
// The issue's versions: the vello_cpu deep-marks-render resolves, and the lockfile's other one, which the base takes.
const RESOLVED = '0.3.0';
const OTHER = '0.0.8';
// A cold build of the crate's dependencies on a loaded machine.
const LIMIT = 90 * 60_000;
// VELLO_CPU's declaration in raster.rs, whose string literal AC2's plant sets.
const DECLARED = /(\bconst VELLO_CPU\s*:\s*&(?:'static\s+)?str\s*=\s*)"([^"\\]*)"/g;
const declarations = (text) => [...text.matchAll(DECLARED)];
// A run killed with SIGKILL while the plant is in leaves it, and the base's own test passes with it.
const leftover = `${RASTER} sets VELLO_CPU to "${OTHER}", as an earlier run killed before restoring it would: restore the file from git first`;

function cargo(args) {
  const run = spawnSync('cargo', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: LIMIT,
    env: { CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', ...process.env },
  });
  assert.equal(run.error, undefined, `cargo ${args.join(' ')} could not run: ${run.error?.message}`);
  return run;
}
const libTests = (...filter) => cargo(['test', '-p', CRATE, '--lib', '--locked', ...filter]);
const tail = (text, lines) => text.trimEnd().split('\n').slice(-lines).join('\n');
const shown = (run) => `exit ${run.status}${run.signal ? ` (${run.signal})` : ''}\n--- stdout\n${run.stdout.trimEnd()}\n--- stderr, last 15 lines\n${tail(run.stderr, 15)}`;
// The issue's test's line in libtest's output: `test <path>::the_named_versions_are_the_locked_ones ... <result>`.
const resultOf = (stdout) => stdout.match(new RegExp(`^test ((?:\\w+::)*${TEST}) \\.\\.\\. (\\w+)`, 'm'));
// What a failed test printed: its `---- <path> stdout ----` section, up to the next section or the failures list.
function failureOf(stdout, path) {
  const head = `---- ${path} stdout ----`;
  const at = stdout.indexOf(head);
  if (at < 0) return '';
  const rest = stdout.slice(at + head.length);
  const end = rest.search(/^(?:---- |failures:$)/m);
  return end < 0 ? rest : rest.slice(0, end);
}
// A version named as itself, not inside a longer one (0.3.0 is not in 10.3.0 or 0.3.01).
const names = (text, version) => new RegExp(`(?<![\\d.])${version.replaceAll('.', '\\.')}(?!\\.?\\d)`).test(text);

test('#2497.aa0d6f96 `cargo test -p deep-marks-render --lib` passes on main', { timeout: LIMIT }, () => {
  const path = join(repo, RASTER);
  assert.ok(!(existsSync(path) && declarations(readFileSync(path, 'utf8')).some(([, , value]) => value === OTHER)), leftover);
  const run = libTests();
  assert.equal(run.status, 0, `cargo test -p ${CRATE} --lib --locked fails:\n${shown(run)}`);
  const result = resultOf(run.stdout);
  assert.ok(result, `the lib's tests pass, but none of them is the issue's ${TEST}:\n${shown(run)}`);
  assert.equal(result[2], 'ok', `${result[1]} reads ${result[2]}, not ok:\n${shown(run)}`);
});

test("#2497.b8e58294 With `VELLO_CPU` set to a version the crate doesn't resolve, the test fails naming both versions", { timeout: LIMIT }, () => {
  // The plant's premise from cargo's own resolver, not from this file: deep-marks-render resolves vello_cpu 0.3.0 alone.
  const tree = cargo(['tree', '-p', CRATE, '--locked', '-e', 'normal,build,dev', '--prefix', 'none']);
  assert.equal(tree.status, 0, `BLOCKED: cargo tree couldn't list ${CRATE}'s dependencies:\n${shown(tree)}`);
  const resolved = [...new Set([...tree.stdout.matchAll(/^vello_cpu v(\S+)/gm)].map(([, version]) => version))];
  assert.deepEqual(resolved, [RESOLVED], `BLOCKED: ${CRATE} resolves vello_cpu ${resolved.join(', ') || 'nowhere'}, not ${RESOLVED} alone as the issue says`);

  const path = join(repo, RASTER);
  const original = readFileSync(path);
  const text = original.toString('utf8');
  const found = declarations(text);
  assert.equal(found.length, 1, `${RASTER} declares VELLO_CPU once as a string literal, which the plant sets; found ${found.length}`);
  assert.notEqual(found[0][2], OTHER, leftover);
  const status = () => spawnSync('git', ['status', '--porcelain', '--', RASTER], { cwd: repo, encoding: 'utf8' }).stdout;
  const before = status();
  // cargo runs synchronously, so a signal waits for it; the file is restored before this process exits, either way.
  const restore = () => writeFileSync(path, original);
  const signals = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  const onSignal = (signal) => {
    restore();
    process.exit(signals[signal]);
  };
  for (const signal of Object.keys(signals)) process.on(signal, onSignal);
  process.on('exit', restore);
  let run;
  try {
    writeFileSync(path, text.replace(DECLARED, `$1"${OTHER}"`));
    run = libTests(TEST);
  } finally {
    restore();
    for (const signal of Object.keys(signals)) process.off(signal, onSignal);
    process.off('exit', restore);
  }
  assert.ok(readFileSync(path).equals(original), `${RASTER} wasn't restored byte for byte: restore it from git`);
  assert.equal(status(), before, `git status of ${RASTER} changed across the plant`);

  const planted = `with VELLO_CPU = "${OTHER}", a vello_cpu ${CRATE} doesn't resolve (it resolves ${RESOLVED})`;
  const result = resultOf(run.stdout);
  assert.ok(result, `${planted}, the issue's ${TEST} didn't run:\n${shown(run)}`);
  assert.equal(result[2], 'FAILED', `${planted}, ${result[1]} reads ${result[2]}, so it accepts a version the crate doesn't resolve:\n${shown(run)}`);
  assert.notEqual(run.status, 0, `${planted}, ${result[1]} fails but cargo test exits 0:\n${shown(run)}`);
  const failure = failureOf(run.stdout, result[1]);
  const unnamed = [OTHER, RESOLVED].filter((version) => !names(failure, version));
  assert.deepEqual(unnamed, [], `${planted}, ${result[1]} fails without naming ${unnamed.join(' and ')}; it printed:\n${failure.trim() || '(nothing)'}\n${shown(run)}`);
});
