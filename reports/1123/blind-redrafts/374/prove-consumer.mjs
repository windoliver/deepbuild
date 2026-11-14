// Apache-2.0. Proof recipe only: no builds, installs, fake renderer, or changes to tests.
// node tests/acceptance/374-binary-redraft/prove-consumer.mjs GOOD_BIN_DIR WRONG_BIN_DIR
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const folder = 'tests/acceptance/374-binary-redraft';
const mutations = JSON.parse(readFileSync(new URL('./wrong-program.json', import.meta.url), 'utf8'));
assert.equal(process.argv.length, 4, 'supply distinct good and wrong prebuilt binary directories');
const [good, wrong] = process.argv.slice(2).map((p) => resolve(p));
assert.notEqual(good, wrong);
const executable = 'deep-canvas-render'; // This recipe targets the issue hosts: Mac and Spark.
const seal = (dir) => {
  const path = join(dir, executable);
  const stat = statSync(path, { bigint: true });
  return [createHash('sha256').update(readFileSync(path)).digest('hex'), String(stat.size), String(stat.mtimeNs)];
};
const seals = [seal(good), seal(wrong)];
assert.notEqual(seals[0][0], seals[1][0], 'wrong binary must differ from clean binary');
const vitest = join(root, 'node_modules/vitest/vitest.mjs');
statSync(vitest); // Missing prerequisites fail before any assertion can count.
const run = mkdtempSync(join(tmpdir(), 'deep-374-proof-'));
for (const name of ['path', 'home', 'tmp', 'missing']) mkdirSync(join(run, name));
symlinkSync(process.execPath, join(run, 'path/node'));
// The unchanged root setup uses ps to clean up actual descendants; cargo is absent from PATH.
statSync('/bin/ps');
symlinkSync('/bin/ps', join(run, 'path/ps'));
const env = { ...process.env, PATH: join(run, 'path'), HOME: join(run, 'home'), TMPDIR: join(run, 'tmp') };
for (const key of ['DEEP_BIN_DIR', 'CARGO_TARGET_DIR', 'NODE_OPTIONS']) delete env[key];
const scrub = (text) => [root, run, good, wrong, process.env.HOME].filter(Boolean)
  .reduce((s, path) => s.split(path).join('<private>'), text);
const unchanged = () => assert.deepEqual([seal(good), seal(wrong)], seals, 'supplied binaries must not be overwritten');
function check(label, binDir) {
  const reportPath = join(run, `${label}.json`);
  const child = spawnSync(process.execPath, [vitest, 'run', folder,
    '--fileParallelism', '--maxWorkers=3', '--reporter=json', `--outputFile=${reportPath}`], {
    cwd: root, env: { ...env, DEEP_BIN_DIR: binDir }, encoding: 'utf8', timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  unchanged();
  assert.equal(child.error, undefined, `BLOCKED: ${label} runner did not finish`);
  let report;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
  catch { throw Error(`BLOCKED: ${label} produced no Vitest JSON report`); }
  // Retain only redacted evidence; no machine/home paths in saved output.
  writeFileSync(reportPath, scrub(JSON.stringify(report, null, 2)));
  const tests = report.testResults.flatMap((file) => file.assertionResults.map((test) => ({ ...test, file: basename(file.name) })));
  assert.equal(report.testResults.length, 3, `${label}: every behavior file collected`);
  assert.equal(tests.length, 11, `${label}: all original tests collected`);
  return { status: child.status, report, tests };
}
console.log('Evidence is in a new OS-temp deep-374-proof-* directory (JSON reports are redacted).');
// Each wrong behavior must reach its intended original assertion, not a setup/import/build failure.
const red = check('wrong', wrong);
assert.notEqual(red.status, 0);
for (const mutation of mutations) {
  assert(red.tests.some((test) => test.file === mutation.testFile && test.status === 'failed'
    && test.fullName.includes(mutation.testTitle)
    && test.failureMessages.some((message) => message.includes(mutation.assertion))),
  `${mutation.testFile}: missing failure at the named behavior assertion`);
}
const green = check('good', good);
assert.equal(green.status, 0);
assert.equal(green.report.success, true);
assert(green.tests.every((test) => test.status === 'passed'), 'nothing skipped or unrun passes');
for (const [label, dir, message] of [
  ['missing', join(run, 'missing'), 'missing or not executable in DEEP_BIN_DIR'],
  ['empty', '', 'DEEP_BIN_DIR is empty'],
]) {
  const blocked = check(label, dir);
  assert.notEqual(blocked.status, 0);
  assert.equal(blocked.report.success, false);
  assert(JSON.stringify(blocked.report).includes(`BLOCKED: ${label === 'empty' ? message : `${executable} ${message}`}`));
  assert(blocked.tests.every((test) => test.status !== 'passed'), 'no behavior passes without its binary');
}
console.log('Observed: each file killed its source mutant in file-parallel Vitest; all 11 clean tests passed with no cargo on PATH; supplied binary seals unchanged; missing/empty directories blocked.');
