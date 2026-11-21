// #1873 AC1 and AC6 on one scene: main's head holds a test listed in `failures` that passes, one listed in `timing`
// that passes, and two listed skips whose tests run, one to a PASS and one to a FAIL, because the tick's environment
// opts them in. One scheduled tick of the main watch runs there (README: The scenes).
import { after, before, test } from 'node:test';
import { LOAD_VAR, LONG, OPT_IN, assert, dated, fileIssue, known, lineWith, sandbox, show, status, tick, watched } from './helpers.mjs';

const FIXED = 'tests/fixed.test.mjs › passes again';
const TIMED = 'tests/budget.test.mjs › stays within its budget';
const SKIP_PASS = 'tests/gated.test.mjs › runs to a pass when opted in';
const SKIP_FAIL = 'tests/gated.test.mjs › runs to a fail when opted in';

const FILES = {
  'tests/fixed.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('passes again', () => assert.equal(2 + 3, 5));\n`,
  'tests/budget.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('stays within its budget', () => {\n  const start = performance.now();\n  for (let i = 0; i < 1000; i++);\n  assert.ok(performance.now() - start < 5000);\n});\n`,
  'tests/gated.test.mjs': `import test from 'node:test';\nimport assert from 'node:assert/strict';\nconst skip = !process.env.${OPT_IN} && 'INCONCLUSIVE: set ${OPT_IN}=1 to run it';\ntest('runs to a pass when opted in', { skip }, () => assert.ok(true));\ntest('runs to a fail when opted in', { skip }, () => assert.fail('the gated fixture test fails when it runs'));\n`,
};
const skip = (id) => ({ id, note: `INCONCLUSIVE: set ${OPT_IN}=1 to run it`, reason: `gated on the opt-in variable ${OPT_IN}: the fixture's test needs a person`, approval: '#9801, a fixture approval' });
const FILE = known({
  failures: { [FIXED]: dated('fails on main 1a2b3c4: a fixture failure', 9801, 2) },
  timing: [TIMED],
  timingIssues: { [TIMED]: dated('a fixture budget, unmeasured at load', 9801, 2) },
  skips: [skip(SKIP_PASS), skip(SKIP_FAIL)],
});

let scene;
const cleanups = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
before(async () => {
  const box = await sandbox({ after: (cleanup) => cleanups.push(cleanup) });
  fileIssue(box, 9801);
  const fx = watched(box, FILE, FILES);
  // The load is passed in below the core count, so a timing test's result is measured either way.
  const run = await tick(box, fx, { env: { [OPT_IN]: '1', [LOAD_VAR]: '0' } });
  scene = { box, fx, run, after: await status(box, fx) };
});

const all = () => `${show(scene.run)}\nstatus after: ${scene.after.line}`;

test(`#1873.d1984163 a known-failures.json entry whose test passes on main fails the lane, naming the entry; a lane that keeps reading it as known fails this test`, LONG, () => {
  const { run } = scene;
  assert.ok(lineWith(run.stdout, 'FAIL', FIXED), `the tick read the failures entry ${FIXED} as known, though its test passed in the run: no FAIL line names it\n${all()}`);
  assert.ok(lineWith(run.stdout, 'FAIL', TIMED), `the tick read the timing entry ${TIMED} as known, though its test passed in the run: no FAIL line names it\n${all()}`);
});

test(`#1873.a54dd0d9 a listed skip whose test ran in the main watch's run fails the tick, naming the entry and the state it ran to`, LONG, () => {
  const { run } = scene;
  assert.ok(lineWith(run.stdout, 'FAIL', SKIP_PASS, 'PASS'), `no FAIL line names the skips entry ${SKIP_PASS} and the PASS its test ran to\n${all()}`);
  const ranToFail = run.stdout.split('\n').find((line) => line.trimStart().startsWith('FAIL') && line.includes(SKIP_FAIL) && line.trimStart().slice(4).includes('FAIL'));
  assert.ok(ranToFail, `no FAIL line names the skips entry ${SKIP_FAIL} and the FAIL its test ran to\n${all()}`);
});
