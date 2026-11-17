// #2444 acceptance suite. Run: node --test tests/acceptance/2444/   (README.md beside this file).
//
// AC1 #2444.3bfdfb07: the unit lane of the local preflight prints a listed failure as LISTED with its issue and does not
//   fail on it; an unlisted failure still fails it. Proof: the real `runLanes` of scripts/lanes.mjs (the runner the
//   preflight runs its lanes through) on a lane named `unit` over real `node --test` files, in a scratch directory with its own
//   scripts/known-failures.json (`failures` key) and a sandboxed HOME. Nothing is mocked.
// AC2 #2444.1bff92b0: a full reference-Mac run. NOT provable by a fixture: that test runs only against real, dated output of a
//   full run (DEEP_2444_FULL_RUN names it) and otherwise is skipped INCONCLUSIVE (unmeasured).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKOUT = fileURLToPath(new URL('../../../', import.meta.url));
const RUNNER = pathToFileURL(join(CHECKOUT, 'scripts/lanes.mjs')).href;

const LISTED_ID = 'listed.test.mjs › listed on main';
const UNLISTED_ID = 'unlisted.test.mjs › fresh break';
const LISTED_ISSUE = '#90441';
const LISTED_MESSAGE = `fails on main 0000000: a stand-in bug (${LISTED_ISSUE}, added 2026-11-01)`;

const failing = (name) => `import { test } from 'node:test';\ntest(${JSON.stringify(name)}, () => { throw new Error('planted failure'); });\n`;
const passing = (name) => `import { test } from 'node:test';\ntest(${JSON.stringify(name)}, () => {});\n`;

/** Runs the real runLanes on a lane named `unit` over the given test files in a scratch tree; removes only that tree. */
function unitLane(t, { files, failures }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2444-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const all = { 'scripts/known-failures.json': `${JSON.stringify({ failures, lint: {}, timing: [], skips: [] })}\n`, ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const commands = [[process.execPath, '--test', ...Object.keys(files)]];
  const code = `import { runLanes } from ${JSON.stringify(RUNNER)};
    process.exitCode = runLanes([{ name: 'unit', commands: ${JSON.stringify(commands)}, fix: 'none' }], { cwd: process.cwd() });`;
  const { DEEP_THROTTLE, DEEP_PROOF_VITEST_REPORT, NODE_TEST_CONTEXT, DEEP_PREFLIGHT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', env: { ...env, HOME: join(root, 'home') }, timeout: 120_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, signal: result.signal };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const line = (id) => new RegExp(`^LISTED ${escape(id)}.*${escape(LISTED_ISSUE)}`, 'm');
const anyLineFor = (kind, id) => new RegExp(`^${kind}\\b.*${escape(id)}`, 'm');

// The assertions, each named by what it says of a unit lane's outcome; a wrong runner has to fail one of them.
const judge = {
  listedOnly({ status, output }) {
    assert.match(output, line(LISTED_ID), 'the listed failure is not printed as LISTED with the issue its entry names');
    assert.doesNotMatch(output, /^(FAIL|BLOCKED|INVALID|INCONCLUSIVE) unit/m, 'the lane fails on a listed test');
    assert.match(output, /^PASS unit\b/m, 'the lane does not PASS with only a listed failure');
    assert.equal(status, 0, 'the lane exits non-zero on a listed failure');
  },
  both({ status, output }) {
    assert.match(output, line(LISTED_ID), 'the listed failure is not printed as LISTED with its issue beside an unlisted one');
    assert.doesNotMatch(output, anyLineFor('LISTED', UNLISTED_ID), 'an unlisted failure is printed LISTED');
    assert.match(output, /^FAIL unit\b/m, 'an unlisted failure does not fail the lane');
    assert.notEqual(status, 0, 'an unlisted failure leaves the exit code 0');
  },
  unlistedOnly({ status, output }) {
    assert.doesNotMatch(output, /^LISTED /m, 'a test no entry lists is printed LISTED');
    assert.match(output, /^FAIL unit\b/m, 'an unlisted failure does not fail the lane');
    assert.notEqual(status, 0, 'an unlisted failure leaves the exit code 0');
  },
};

const FILES = { 'listed.test.mjs': failing('listed on main'), 'unlisted.test.mjs': failing('fresh break'), 'ok.test.mjs': passing('fine') };
const LIST = { [LISTED_ID]: LISTED_MESSAGE };

test('AC1 #2444.3bfdfb07 control: the fixture runs for real, a lane with only passing tests PASSes and an unlisted failure fails it', (t) => {
  const clean = unitLane(t, { files: { 'ok.test.mjs': passing('fine') }, failures: {} });
  assert.equal(clean.status, 0, `setup: ${clean.output}`);
  assert.match(clean.output, /^PASS unit\b/m, `setup: ${clean.output}`);
  const broken = unitLane(t, { files: { 'unlisted.test.mjs': failing('fresh break') }, failures: LIST });
  assert.match(broken.output, /^FAIL unit\b/m, `setup: ${broken.output}`);
  assert.equal(broken.status, 1);
});

test('AC1 #2444.3bfdfb07 a unit lane failing only on a listed test prints it LISTED with the issue its entry names and PASSes, exit 0', (t) => {
  judge.listedOnly(unitLane(t, { files: { 'listed.test.mjs': FILES['listed.test.mjs'], 'ok.test.mjs': FILES['ok.test.mjs'] }, failures: LIST }));
});

test('AC1 #2444.3bfdfb07 beside a listed failure, an unlisted one still fails the lane and is not LISTED', (t) => {
  judge.both(unitLane(t, { files: FILES, failures: LIST }));
});

test('AC1 #2444.3bfdfb07 with no entry for a failing test, the lane fails and prints no LISTED line', (t) => {
  judge.unlistedOnly(unitLane(t, { files: FILES, failures: {} }));
});

test('AC1 #2444.3bfdfb07 wrong runners fail these assertions (AssertionError, not an import or setup error)', () => {
  const listedFailsLane = { status: 1, output: `RUN unit\nFAIL unit: planted failure\n  Fix: none\n` }; // the base: reads only `skips`
  const swallowsAll = { status: 0, output: `RUN unit\nLISTED ${LISTED_ID}: ${LISTED_MESSAGE} (x)\nLISTED ${UNLISTED_ID} (x)\nPASS unit (1 s)\n` };
  const listedSilently = { status: 0, output: `RUN unit\nPASS unit (1 s)\n` };
  const noIssue = { status: 0, output: `RUN unit\nLISTED ${LISTED_ID}\nPASS unit (1 s)\n` };
  const unlistedPasses = { status: 0, output: `RUN unit\nLISTED ${LISTED_ID}: ${LISTED_MESSAGE}\nPASS unit (1 s)\n` };
  for (const [name, outcome, judgement] of [
    ['a runner that fails the lane on a listed test', listedFailsLane, judge.listedOnly],
    ['a runner that lists the unlisted failure too', swallowsAll, judge.both],
    ['a runner that hides the listed test', listedSilently, judge.listedOnly],
    ['a runner that prints LISTED without the entry\'s issue', noIssue, judge.listedOnly],
    ['a runner that passes an unlisted failure', unlistedPasses, judge.both],
    ['a runner that lists a test no entry names', swallowsAll, judge.unlistedOnly],
  ]) assert.throws(() => judgement(outcome), assert.AssertionError, name);
  // And the right reading passes them.
  judge.listedOnly({ status: 0, output: `RUN unit\nLISTED ${LISTED_ID}: ${LISTED_MESSAGE}\nPASS unit (1 s)\n` });
  judge.both({ status: 1, output: `RUN unit\nLISTED ${LISTED_ID}: ${LISTED_MESSAGE}\nFAIL unit: planted failure\n` });
});

// ---- AC2: the full run's evidence. ----

const BUDGETS = JSON.parse(readFileSync(join(CHECKOUT, 'benchmarks/budgets.json'), 'utf8'));
const MUST_PASS = ['typecheck', 'lint', 'unit', 'parity quick'];

/** What is wrong with a recorded full run (README, "Recording the full run"); [] when it shows the criterion met. */
function problemsWith(evidence, budgetSeconds = BUDGETS.preflight.limits.elapsedMs / 1000) {
  const problems = [], field = (name) => evidence.match(new RegExp(`^${name}: (.+)$`, 'm'))?.[1]?.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(field('date') ?? '')) problems.push('no date');
  if (!field('machine')) problems.push('no machine');
  if (!/^\d+(\.\d+)?/.test(field('load') ?? '')) problems.push('no load');
  if (!/^[0-9a-f]{40}$/.test(field('commit') ?? '')) problems.push('no commit');
  if (field('worktree') !== 'clean') problems.push('not a clean checkout');
  if (field('exit') !== '0') problems.push(`exit ${field('exit') ?? 'unrecorded'}, not 0`);
  const elapsed = evidence.match(/^Checks elapsed: ([\d.]+) s \(budget: <([\d.]+) s\)/m);
  if (!elapsed) problems.push('no elapsed time');
  else {
    if (Number(elapsed[2]) !== budgetSeconds) problems.push(`budget ${elapsed[2]} s is not benchmarks/budgets.json's ${budgetSeconds} s`);
    if (!(Number(elapsed[1]) < budgetSeconds)) problems.push(`checks took ${elapsed[1]} s, not under ${budgetSeconds} s`);
  }
  if (/^(FAIL|BLOCKED|INVALID|INCONCLUSIVE) /m.test(evidence)) problems.push('a lane is not PASS');
  for (const lane of MUST_PASS) if (!new RegExp(`^PASS ${escape(lane)}\\b`, 'm').test(evidence)) problems.push(`no PASS ${lane}`);
  return problems;
}

const GOOD = `date: 2026-11-20T09:00:00Z
machine: Example Mac (10 cores, 32 GB)
load: 0.4
commit: ${'a'.repeat(40)}
worktree: clean
RUN unit
PASS typecheck (100.00 s)
PASS lint (60.00 s)
PASS unit (400.00 s)
PASS parity quick (20.00 s)
Checks elapsed: 700.00 s (budget: <900 s); preflight elapsed: 710.00 s
exit: 0
`;

test('evidence reader (fixture only; does not prove AC2): accepts a complete in-budget record and rejects each way a run can fall short', () => {
  assert.deepEqual(problemsWith(GOOD), []);
  const bad = (from, to) => GOOD.replace(from, to);
  assert.deepEqual(problemsWith(bad('700.00 s', '950.00 s')), ['checks took 950.00 s, not under 900 s']);
  assert.ok(problemsWith(bad('PASS unit (400.00 s)', 'FAIL unit: x')).includes('a lane is not PASS'));
  assert.ok(problemsWith(bad('exit: 0', 'exit: 1')).includes('exit 1, not 0'));
  assert.ok(problemsWith(bad('load: 0.4\n', '')).includes('no load'));
  assert.ok(problemsWith(bad('worktree: clean', 'worktree: dirty')).includes('not a clean checkout'));
  assert.ok(problemsWith(bad('budget: <900 s', 'budget: <9000 s')).some((p) => p.startsWith('budget 9000')));
});

test('AC2 #2444.1bff92b0 a full scripts/preflight on a clean checkout of main on a reference Mac exits 0, every lane PASS, checks within the preflight budget', (t) => {
  const file = process.env.DEEP_2444_FULL_RUN;
  if (!file || !existsSync(file)) return t.skip('INCONCLUSIVE: unmeasured: no dated full-run output; record one on a reference Mac (README) and set DEEP_2444_FULL_RUN to its file');
  assert.deepEqual(problemsWith(readFileSync(file, 'utf8')), []);
});
