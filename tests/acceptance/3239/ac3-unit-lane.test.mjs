// #3239 AC3: the FAIL IDs of the unit lane on main are the same before and after. "Before" is main's own record of the
// unit lane's failures, scripts/known-failures.json as the merge base holds it. "After" is a run, on this checkout, of
// the unit lane's own tests of the four scripts: its node --test files named for them, less those lanes.mjs runs only
// under the machine's timed grant, by hand or as slow (README: AC3). They run and are read as the unit lane runs and
// reads them, through lanes.mjs's reporting and testsOf.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, ended, launch } from './helpers.mjs';

const ID = '#3239.cb760c49';
const NAMED = /^(?:perf|budget-window|benchmark|preflight)(?:[.-][\w.-]*)?\.test\.mjs$/;
const UNIT_GLOB = 'tests/!(*.live).test.mjs';

const clean = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|DEEP_|NODE_TEST_CONTEXT$|NODE_OPTIONS$)/.test(key)));
const git = (...args) => execFileSync('git', args, { cwd: CHECKOUT, env: clean(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).trim();

test(`${ID} AC3 the unit lane's own tests of the four scripts fail on this checkout exactly where main's known failures say they do`, { timeout: 3_600_000 }, async (t) => {
  const { checks, listed, reporting, testsOf, timed, slow, byHand } = await import(pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href);
  const unit = checks.find(({ name }) => name === 'unit');
  const block = unit?.commands.find(([command, flag]) => command === process.execPath && flag === '--test');
  assert.ok(block?.includes(UNIT_GLOB), `the unit lane no longer runs ${UNIT_GLOB} with node --test, which this reading of AC3 selects from: ${JSON.stringify(block)}`);
  const files = readdirSync(join(CHECKOUT, 'tests')).filter((name) => NAMED.test(name) && !name.endsWith('.live.test.mjs')).map((name) => `tests/${name}`)
    .filter((file) => ![timed, slow, byHand].some((list) => listed(list, file))).sort();
  assert.ok(files.length, 'no node --test file of the unit lane is named for perf.mjs, budget-window.mjs, benchmark.mjs or preflight.mjs outside the timed, slow and by-hand lists');

  // Before: main's FAIL IDs for these files, as the merge base records them.
  let base;
  try {
    base = git('merge-base', 'HEAD', 'origin/main');
  } catch (error) {
    assert.fail(`BLOCKED: no merge base with origin/main to read main's known failures from: ${error.message.split('\n')[0]}`);
  }
  const known = Object.keys(JSON.parse(git('show', `${base}:scripts/known-failures.json`)).failures ?? {});
  const before = known.filter((id) => files.some((file) => id.startsWith(`${file} › `))).sort();

  // After: the files run as the unit lane runs them, in this checkout. Each node process reads a pinned load, as on a
  // quiet machine: perf.test.mjs's timed grant, in its own table, waits for a load under the cores, which a shared Mac
  // rarely has. HOME is a folder of the run's own, so nothing reaches the machine's throttle table.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3239-unit-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  mkdirSync(home);
  writeFileSync(join(dir, 'load.mjs'), "import os from 'node:os';\nimport { syncBuiltinESMExports } from 'node:module';\nos.loadavg = () => [2, 2, 2];\nsyncBuiltinESMExports();\n");
  const report = join(dir, 'report.jsonl');
  const { command, env: extra = {} } = reporting([process.execPath, '--test', ...files], report);
  const box = { env: { ...clean(), HOME: home, NODE_OPTIONS: `--import=${pathToFileURL(join(dir, 'load.mjs')).href}`, ...extra }, children: [] };
  t.after(() => { for (const child of box.children) if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  const run = await ended(launch(box, command, { cwd: CHECKOUT }), 3_000_000);
  const results = testsOf(command, CHECKOUT, { report, output: run.stdout + run.stderr, status: run.status });
  assert.ok(results, `the run left no report the unit lane can read (exit ${run.status})\n${run.stdout.slice(-3000)}\n${run.stderr.slice(-2000)}`);
  const after = results.failures.filter(({ state }) => state === 'FAIL').map(({ id }) => id).sort();
  const unsure = results.failures.filter(({ state }) => state !== 'FAIL');
  const silent = files.filter((file) => ![...results.passed, ...results.failures.map(({ id }) => id)].some((id) => id.startsWith(`${file} › `)));
  const added = after.filter((id) => !before.includes(id)), gone = before.filter((id) => !after.includes(id));
  const count = (ids, file) => ids.filter((id) => id.startsWith(`${file} › `)).length;
  for (const file of files) t.diagnostic(`${file}: ${count(results.passed, file)} passed, ${count(after, file)} FAIL (${count(before, file)} listed on main), ${count(unsure.map(({ id }) => id), file)} proved nothing`);
  const failed = results.failures.map(({ id, state, message }) => `  ${state} ${id}: ${message}`).join('\n');
  assert.deepEqual({ added, gone, unsure: unsure.map(({ id, state }) => `${state} ${id}`), silent }, { added: [], gone: [], unsure: [], silent: [] },
    `the unit lane's FAIL IDs for ${files.join(', ')} differ from main's (merge base ${base.slice(0, 12)}): new FAIL IDs ${JSON.stringify(added)}, listed FAIL IDs that no longer fail ${JSON.stringify(gone)}, tests that proved nothing ${JSON.stringify(unsure.map(({ id }) => id))}, files with no test reported ${JSON.stringify(silent)}\n${failed}\n${run.stdout.slice(-3000)}`);
});
