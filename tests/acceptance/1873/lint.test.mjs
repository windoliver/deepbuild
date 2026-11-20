// #1873's lint lane criteria: AC2 (lint and timing entries name an open issue and a date within 14 days), AC3 (a lint
// key naming a missing file), AC5 (a skips entry naming a deleted test), AC7 (a reason naming an opt-in variable the
// test's file never reads) and AC8 (main's skips entries). Each runs the real lint lane's known-failures command
// through this checkout's runLanes, on a fixture repository holding this checkout's scripts/ (README: The surface).
import { test } from 'node:test';
import {
  LONG, OPT_IN, assert, checkOnMain, dated, failed, fileIssue, known, lintLane, lintRepo, passed, sandbox, show, verdicts,
} from './helpers.mjs';

// Lint keys in the form the real ones take: the lint, the file it found in, and what it found.
const KEPT_KEY = 'canvas-lint: crates/deep-text/src/cache.rs a static item, state a check could carry between runs';
const GONE_KEY = 'canvas-lint: crates/deep-text/src/worker.rs a static item, state a check could carry between runs';
const NO_FILE_KEY = 'canvas-lint: embedded-io is resolved at 0.4.0 for postcard and 0.6.1 for postcard, but the listing audits one version';
const KEPT_SOURCE = { 'crates/deep-text/src/cache.rs': 'pub static CACHE: u8 = 0;\n' };

const TIMED = (name) => `tests/timed.test.mjs › ${name}`;
const TIMED_FILE = {
  'tests/timed.test.mjs': `import test from 'node:test';\nfor (const name of ['keeps its budget', 'names no issue', 'sits too long']) test(name, () => {});\n`,
};

// A test gated on the opt-in variable, and one whose file never reads it.
const GATED_ID = 'tests/gated.test.mjs › runs only when opted in';
const GATED_FILE = {
  'tests/gated.test.mjs': `import test from 'node:test';\ntest('runs only when opted in', { skip: !process.env.${OPT_IN} && 'INCONCLUSIVE: set ${OPT_IN}=1 to run it' }, () => {});\n`,
};
const NEVER_FILE = {
  'tests/gated.test.mjs': `import test from 'node:test';\ntest('runs only when opted in', { skip: 'INCONCLUSIVE: set the variable to run it' }, () => {});\n`,
};
const gatedSkip = (note = `INCONCLUSIVE: set ${OPT_IN}=1 to run it`) => ({
  id: GATED_ID, note, reason: `gated on the opt-in variable ${OPT_IN}: the fixture's test needs a person`, approval: '#9801, a fixture approval',
});
const GONE_ID = 'tests/gone.test.mjs › was here once';
const GONE_FILE = { 'tests/gone.test.mjs': `import test from 'node:test';\ntest('was here once', { skip: 'retired' }, () => {});\n` };
const goneSkip = { id: GONE_ID, note: 'retired', reason: "retired with the owner's approval: the fixture's redraft is its test", approval: '#9801, a fixture approval' };

// The checkout's own file, run once for every test of this file that reads main.
let main;
const onMain = async (t) => {
  if (!main) {
    const box = await sandbox(t);
    main = await checkOnMain(box);
  }
  return main;
};

test(`#1873.b9b52cba a lint or timing entry with no open issue, or added more than 14 days ago, fails the lint lane, naming it; on main every lint and timing entry passes the check`, LONG, async (t) => {
  const box = await sandbox(t);
  fileIssue(box, 9801);
  fileIssue(box, 9802, 'CLOSED');
  const lintKeys = {
    good: KEPT_KEY,
    bare: 'canvas-lint: crates/deep-text/src/cache.rs the pointer width (size_of), 32 on wasm32 and 64 on the reference Macs',
    closed: 'canvas-lint: crates/deep-text/src/cache.rs use of a disallowed type `std::collections::HashMap` (clippy::disallowed_types)',
    old: 'canvas-lint: crates/deep-text/src/cache.rs use of a disallowed method `std::collections::HashMap::iter` (clippy::disallowed_methods)',
  };
  const bad = lintRepo(box, 'bad', known({
    lint: { [lintKeys.good]: 1, [lintKeys.bare]: 1, [lintKeys.closed]: 2, [lintKeys.old]: 1 },
    lintIssues: {
      [lintKeys.good]: dated('a read-only table in a static', 9801, 2),
      [lintKeys.closed]: dated('a HashMap the lint is right about', 9802, 2),
      [lintKeys.old]: dated('a HashMap the lint is right about', 9801, 20),
    },
    timing: [TIMED('keeps its budget'), TIMED('names no issue'), TIMED('sits too long')],
    timingIssues: {
      [TIMED('keeps its budget')]: dated('a budget unmeasured at load', 9801, 2),
      [TIMED('sits too long')]: dated('a budget unmeasured at load', 9801, 20),
    },
  }), { ...KEPT_SOURCE, ...TIMED_FILE });
  const run = await lintLane(box, bad);
  assert.notEqual(run.status, 9, `the lint lane in scripts/lanes.mjs doesn't run scripts/known-failures-check.mjs\n${show(run)}`);
  assert.ok(failed(run), `the lint lane didn't fail on lint and timing entries with no open issue or added 20 days ago\n${show(run)}`);
  const named = verdicts(run.stdout);
  for (const id of [lintKeys.bare, lintKeys.closed, lintKeys.old, TIMED('names no issue'), TIMED('sits too long')]) {
    assert.ok(named.some((line) => line.includes(id)), `the lint lane's failure doesn't name the entry ${id}\n${show(run)}`);
  }
  for (const id of [lintKeys.good, TIMED('keeps its budget')]) {
    assert.ok(!named.some((line) => line.includes(id)), `the lint lane fails ${id}, which names an open issue, added two days ago\n${show(run)}`);
  }
  const good = lintRepo(box, 'good', known({
    lint: { [lintKeys.good]: 1 }, lintIssues: { [lintKeys.good]: dated('a read-only table in a static', 9801, 2) },
    timing: [TIMED('keeps its budget')], timingIssues: { [TIMED('keeps its budget')]: dated('a budget unmeasured at load', 9801, 2) },
  }), { ...KEPT_SOURCE, ...TIMED_FILE });
  const fine = await lintLane(box, good);
  assert.ok(passed(fine), `the lint lane fails lint and timing entries that name an open issue, added two days ago\n${show(fine)}`);
  // Main: this checkout's own file and tree.
  const { run: check, file } = await onMain(t);
  const named2 = verdicts(check.stdout);
  for (const id of [...Object.keys(file.lint ?? {}), ...(file.timing ?? [])]) {
    assert.ok(!named2.some((line) => line.includes(id)), `on main the check fails the entry ${id}\n${show(check)}`);
  }
});

test(`#1873.125cf93b a lint key naming a file that no longer exists fails the lint lane, naming the key; on main the lint keys pass`, LONG, async (t) => {
  const box = await sandbox(t);
  fileIssue(box, 9801);
  const lint = { [KEPT_KEY]: 1, [GONE_KEY]: 1, [NO_FILE_KEY]: 1 };
  const lintIssues = Object.fromEntries(Object.keys(lint).map((key) => [key, dated('a fixture finding', 9801, 2)]));
  const bad = lintRepo(box, 'bad', known({ lint, lintIssues }), KEPT_SOURCE);
  const run = await lintLane(box, bad);
  assert.notEqual(run.status, 9, `the lint lane in scripts/lanes.mjs doesn't run scripts/known-failures-check.mjs\n${show(run)}`);
  assert.ok(failed(run), `the lint lane didn't fail a lint key naming crates/deep-text/src/worker.rs, which the repository doesn't hold\n${show(run)}`);
  const named = verdicts(run.stdout);
  assert.ok(named.some((line) => line.includes(GONE_KEY)), `the lint lane's failure doesn't name the key ${GONE_KEY}\n${show(run)}`);
  for (const key of [KEPT_KEY, NO_FILE_KEY]) assert.ok(!named.some((line) => line.includes(key)), `the lint lane fails ${key}, whose file exists or which names none\n${show(run)}`);
  const { [GONE_KEY]: gone, ...kept } = lint;
  const good = lintRepo(box, 'good', known({ lint: kept, lintIssues }), KEPT_SOURCE);
  const fine = await lintLane(box, good);
  assert.ok(passed(fine), `the lint lane fails lint keys whose files exist\n${show(fine)}`);
  const { run: check, file } = await onMain(t);
  const named2 = verdicts(check.stdout);
  for (const key of Object.keys(file.lint ?? {})) assert.ok(!named2.some((line) => line.includes(key)), `on main the check fails the lint key ${key}\n${show(check)}`);
});

test(`#1873.48498355 in a fixture repository, a skips entry whose id names a deleted test fails the lint lane, naming the entry`, LONG, async (t) => {
  const box = await sandbox(t);
  fileIssue(box, 9801);
  const bad = lintRepo(box, 'bad', known({ skips: [gatedSkip(), goneSkip] }), GATED_FILE, GONE_FILE);
  const run = await lintLane(box, bad);
  assert.notEqual(run.status, 9, `the lint lane in scripts/lanes.mjs doesn't run scripts/known-failures-check.mjs\n${show(run)}`);
  assert.ok(failed(run), `the lint lane didn't fail a skips entry naming ${GONE_ID}, a test deleted on main: the check reads no skips\n${show(run)}`);
  const named = verdicts(run.stdout);
  assert.ok(named.some((line) => line.includes(GONE_ID)), `the lint lane's failure doesn't name the entry ${GONE_ID}\n${show(run)}`);
  assert.ok(!named.some((line) => line.includes(GATED_ID)), `the lint lane fails ${GATED_ID}, whose test is in the tree and whose file reads ${OPT_IN}\n${show(run)}`);
  const good = lintRepo(box, 'good', known({ skips: [gatedSkip()] }), GATED_FILE);
  const fine = await lintLane(box, good);
  assert.ok(passed(fine), `the lint lane fails a skips entry whose test is in the tree\n${show(fine)}`);
});

test(`#1873.e084d5c1 a fixture entry whose reason names ${OPT_IN}, on a test file that never reads it, fails the lint lane, naming the entry and the variable; on a file that reads it, it passes`, LONG, async (t) => {
  const box = await sandbox(t);
  fileIssue(box, 9801);
  const bad = lintRepo(box, 'bad', known({ skips: [gatedSkip('INCONCLUSIVE: set the variable to run it')] }), NEVER_FILE);
  const run = await lintLane(box, bad);
  assert.notEqual(run.status, 9, `the lint lane in scripts/lanes.mjs doesn't run scripts/known-failures-check.mjs\n${show(run)}`);
  assert.ok(failed(run), `the lint lane accepted a reason naming ${OPT_IN} on a test file that never reads it\n${show(run)}`);
  assert.ok(verdicts(run.stdout).some((line) => line.includes(GATED_ID) && line.includes(OPT_IN)), `no failing line names both the entry ${GATED_ID} and the variable ${OPT_IN}\n${show(run)}`);
  const good = lintRepo(box, 'good', known({ skips: [gatedSkip()] }), GATED_FILE);
  const fine = await lintLane(box, good);
  assert.ok(passed(fine), `the lint lane fails the same entry on a test file that reads ${OPT_IN}\n${show(fine)}`);
});

test(`#1873.f9faca98 on main, every skips entry passes the rules: it names a test in the tree, and a variable its reason names is read by the test's file`, LONG, async (t) => {
  // Not judged on nothing: the check must read skips at all, so a fixture entry naming a deleted test fails it.
  const box = await sandbox(t);
  fileIssue(box, 9801);
  const planted = await lintLane(box, lintRepo(box, 'planted', known({ skips: [goneSkip] }), {}, GONE_FILE));
  assert.ok(failed(planted) && verdicts(planted.stdout).some((line) => line.includes(GONE_ID)),
    `the check doesn't read skips (a fixture entry naming a deleted test passes it), so its pass on main proves nothing\n${show(planted)}`);
  const { run: check, file } = await onMain(t);
  const named = verdicts(check.stdout);
  const breaking = (file.skips ?? []).filter(({ id }) => named.some((line) => line.includes(id)));
  assert.deepEqual(breaking.map(({ id }) => id), [], `on main the check fails these skips entries\n${show(check)}`);
});
