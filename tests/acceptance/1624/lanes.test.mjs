// #1624 acceptance. Every surface is reached by running it: scripts/lanes.mjs is imported by a child process, the unit
// lane's own vitest commands are run as `vitest list --filesOnly` to list the files each block would run, and the
// issue's named tests are run by node --test. No file's source is searched for strings.
// Criteria (tags from the issue's three acceptance bullets, in order): AC1 preflight test + known-failures, AC2 #1114's
// grep test, AC3 unit lane and the #1330 live file. See README.md for the proof map, commands and limits.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const env = { ...process.env, NODE_TEST_CONTEXT: undefined };
delete env.NODE_TEST_CONTEXT;

/** The unit lane's vitest commands, read from scripts/lanes.mjs by a child. */
function unitVitest() {
  const code = `const { checks } = await import('./scripts/lanes.mjs');
    const unit = checks.find(({ name }) => name === 'unit');
    console.log(JSON.stringify(unit.commands.filter((parts) => parts[1]?.endsWith('vitest.mjs'))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: CHECKOUT, encoding: 'utf8', env });
  assert.equal(result.status, 0, `scripts/lanes.mjs could not be read: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

/** The files a vitest `run` command of the unit lane would run, listed by vitest itself. */
function listed(command) {
  const [node, vitest, , ...rest] = command;
  const args = rest.filter((arg) => arg !== '--no-file-parallelism');
  const result = spawnSync(node, [vitest, 'list', '--filesOnly', ...args], { cwd: CHECKOUT, encoding: 'utf8', env, maxBuffer: 1 << 28 });
  assert.equal(result.status, 0, `vitest list failed: ${result.stderr}`);
  return new Set(result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('tests/') || line.startsWith('packages/')));
}

let lists;
const unitLists = () => lists ??= (() => {
  const [parallel, alone] = unitVitest();
  assert.ok(parallel && alone, 'the unit lane has no parallel and alone vitest blocks');
  return { parallel: listed(parallel), alone: listed(alone) };
})();

// AC3: the unit lane doesn't run #1330's live file, so its run lists no skip from it.
test('#1624 AC3 the unit lane runs no block that lists tests/acceptance/1330/start.live.test.ts', () => {
  const { parallel, alone } = unitLists();
  const file = 'tests/acceptance/1330/start.live.test.ts';
  assert.equal(parallel.has(file), false, `the parallel block lists ${file}, which skips with no note unless DEEP_1330_LIVE=1`);
  assert.equal(alone.has(file), false, `the alone block lists ${file}`);
});

// Contrast: the listing method sees real files, and leaving the live file out doesn't take its siblings with it.
test('#1624 AC3 the unit lane still runs #1330 siblings, and the listing excludes an existing by-hand live file', () => {
  const { parallel, alone } = unitLists();
  const all = new Set([...parallel, ...alone]);
  assert.ok(all.has('tests/acceptance/1330/start.test.ts'), 'tests/acceptance/1330/start.test.ts is no longer run by the unit lane');
  assert.ok(all.has('tests/acceptance/1330/facts.test.ts'), 'tests/acceptance/1330/facts.test.ts is no longer run by the unit lane');
  assert.equal(all.has('tests/acceptance/1202/session.live.test.ts'), false, 'the listing includes a file lanes.mjs already keeps by hand, so it reads the lane wrongly');
});

// AC1 (lanes side): each reference-Mac budget file the issue names runs alone, not in the parallel block.
test('#1624 AC1 tests/acceptance/308, 45 and 1017 budgets.test.ts run in the alone block and not the parallel one', () => {
  const { parallel, alone } = unitLists();
  for (const file of ['tests/acceptance/308/budgets.test.ts', 'tests/acceptance/45/budgets.test.ts', 'tests/acceptance/1017/budgets.test.ts']) {
    assert.equal(parallel.has(file), false, `${file} runs in the parallel block`);
    assert.equal(alone.has(file), true, `${file} is not run alone`);
  }
  // Contrast: a file lanes.mjs already runs alone is listed the same way.
  assert.equal(alone.has('tests/acceptance/14/budgets.test.ts'), true, 'the alone listing misses #14/budgets.test.ts, so it reads the lane wrongly');
  assert.equal(parallel.has('tests/acceptance/14/budgets.test.ts'), false);
});

// Runs a named test of an existing node test file in the checkout and reports whether TAP says it passed.
function named(file, title) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, file], { cwd: CHECKOUT, encoding: 'utf8', env, maxBuffer: 1 << 26 });
  const ok = result.stdout.split('\n').some((line) => line.startsWith('ok ') && line.includes(title)) || new RegExp(`^\\s*ok \\d+ - ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm').test(result.stdout);
  return { ok, result };
}

const TITLE = 'the unit lane runs each reference-Mac budget file alone, after the parallel block';

// AC1 (named test): runs unchanged from the checkout. Fails on the base with ENOTDIR from reading plans.ts as a folder
// (it needs the maintainer-approved correction in preflight-folders-only.patch, and then the lanes.mjs lists).
test('#1624 AC1 tests/preflight.test.mjs › the unit lane runs each reference-Mac budget file alone passes', () => {
  const { ok, result } = named('tests/preflight.test.mjs', TITLE);
  assert.ok(ok, `${TITLE} did not pass:\n${result.stdout}\n${result.stderr}`);
});

// AC1 (known failures): the entry leaves scripts/known-failures.json.
test('#1624 AC1 scripts/known-failures.json no longer lists the preflight reference-Mac budget test', () => {
  const { failures } = JSON.parse(readFileSync(join(CHECKOUT, 'scripts/known-failures.json'), 'utf8'));
  const ids = Object.keys(failures ?? {}).filter((id) => id.startsWith('tests/preflight.test.mjs') && id.includes(TITLE));
  assert.deepEqual(ids, [], `still a known failure: ${ids.join('\n')}`);
});

// AC2: #1114's grep test passes unchanged; on the base it fails naming each of the 14 files.
test('#1624 AC2 tests/acceptance/1114/timed-list.test.mjs passes', () => {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/acceptance/1114/timed-list.test.mjs'], { cwd: CHECKOUT, encoding: 'utf8', env, maxBuffer: 1 << 26 });
  assert.equal(result.status, 0, `#1114's grep test fails:\n${result.stdout}\n${result.stderr}`);
});

// AC2: the issue's 14 files, by running #1114's own check (assertTimed) against the real timed list, not by reading text.
const FOURTEEN = [
  ...['308', '45', '1017', '148', '1425', '67', '160', '167', '149', '1015'].map((n) => `tests/acceptance/${n}/budgets.test.ts`),
  'tests/acceptance/1555/budget-load.test.mjs',
  ...['queries', 'access', 'taste'].map((n) => `tests/acceptance/990/${n}.test.ts`),
];
test('#1624 AC2 lanes.mjs timed list covers each of the 14 files the issue names', () => {
  const code = `const { timed } = await import('./scripts/lanes.mjs'); console.log(JSON.stringify(timed));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: CHECKOUT, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  const timed = JSON.parse(result.stdout.trim().split('\n').at(-1));
  const covers = (file) => timed.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));
  assert.deepEqual(FOURTEEN.filter((file) => !covers(file)), [], 'files missing from timed');
});

// The proposal for the check correction is validated apart from the existing file: a copy of tests/preflight.test.mjs
// with only the folder-only read, run in a scratch tree beside this checkout's real scripts/ and tests/acceptance/.
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

test('#1624 AC1 the proposed folders-only preflight test (maintainer approval needed to adopt) passes its named test on the lanes lists', (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1624-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'tests'));
  cpSync(join(CHECKOUT, 'tests/acceptance/1624/preflight-folders-only.proposed.mjs'), join(dir, 'tests/preflight.test.mjs'));
  for (const link of ['scripts', 'node_modules', 'package.json', 'vitest.config.ts']) symlinkSync(join(CHECKOUT, link), join(dir, link));
  symlinkSync(join(CHECKOUT, 'tests/acceptance'), join(dir, 'tests/acceptance'));
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${TITLE}`, 'tests/preflight.test.mjs'], { cwd: dir, encoding: 'utf8', env, maxBuffer: 1 << 26 });
  assert.match(result.stdout, new RegExp(`^\\s*ok \\d+ - ${TITLE}`, 'm'), `${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(result.stdout, /^\s*not ok/m);
});
