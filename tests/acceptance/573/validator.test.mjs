// Proves the #573 tests themselves: each planted wrong spike must be rejected by the check its
// criterion names, and a right one must pass. These test the tests, so they pass on the base.
// Run: node --test tests/acceptance/573/validator.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  baseOutcome, checkEvidenceProblems, failureOnAssertion, parseJUnit, criteriaProblems, criterionId, draftingDecisionProblems, EVIDENCE_ENV, evidenceDir, fixOutcome, goalOfferProblems, goalStepsDecisionProblems,
  issueEvidenceProblems, manifestProblems, privacyProblems, publicCommitProblems, readingProblems, sha256, structureProblems, uiProblems,
} from './validate.mjs';

const DRAFTED = '#573.01642c85';
const READINGS = '#573.4b1e1e2b';
const DECISION = '#573.1e6abfca';
const GOAL_STEPS = '#573.0753f49f';

const clone = (value) => structuredClone(value);
const rejects = (problems, pattern) => assert.ok(problems.some((problem) => pattern.test(problem)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);

function scratch(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-573-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function g(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
function put(path, text) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }

// ------------------------------------------------------------------ a right record, by hand

// 20 issues (3 from this repo), 5 UI. Each counted plain draft: 3 criteria, 2 covered; 6 checks,
// 1 proven, 1 passing on the base, 2 failing elsewhere, 1 failing only on the fix, 1 running
// nothing; one more check in a discarded run. Each UI issue: plain journeys 1 of 2, goal steps 2 of 3.
function rightRecord() {
  const issues = [];
  for (let i = 0; i < 20; i++) {
    const own = i < 3, ui = i >= 15;
    const ref = own ? `windoliver/deepbuild#${100 + i}` : `pilot-${i}/app#${i}`;
    const criteria = [0, 1, 2].map((n) => sha256(`${i}.${n}`).slice(0, 8));
    const runs = [{ id: 'p0', variant: 'plain', counted: false, discarded: 'its inputs held the fix diff' }, { id: 'p1', variant: 'plain', counted: true }];
    if (ui) runs.push({ id: 'g1', variant: 'goal-steps', counted: true });
    const check = (id, run, base, fix, journey = false, goalSteps = 0) => ({ id, run, journey, goalSteps, base, fix });
    const checks = [
      check('X1', 'p0', 'assertion', 'passed'),
      check('C1', 'p1', 'assertion', 'passed', ui), check('C2', 'p1', 'passed', 'passed', ui), check('C3', 'p1', 'elsewhere', 'passed'),
      check('C4', 'p1', 'elsewhere', 'failed'), check('C5', 'p1', 'assertion', 'failed'), check('C6', 'p1', 'ran-nothing', 'passed'),
    ];
    if (ui) checks.push(check('J1', 'g1', 'assertion', 'passed', true, 1), check('J2', 'g1', 'assertion', 'passed', true, 2), check('J3', 'g1', 'elsewhere', 'passed', true, 1));
    issues.push({
      key: sha256(ref), ...(own ? { ref, base: '1'.repeat(40), fix: '2'.repeat(40) } : {}), ui, criteria, runs,
      requirements: [{ id: 'R1', run: 'p1', covers: [criteria[0], criteria[1]] }, { id: 'R2', run: 'p1', covers: [criteria[1]] }], checks,
    });
  }
  const readings = [];
  for (const issue of issues) {
    readings.push({ id: `coverage:${issue.key}`, covered: 2, criteria: 3, share: 0.667 });
    readings.push({ id: `checks:${issue.key}`, drafted: 6, proven: 1, share: 0.167, droppedPassesOnBase: 1, droppedFailsElsewhere: 2 });
    if (issue.ui) readings.push({ id: `journeys:${issue.key}:plain`, drafted: 2, proven: 1, share: 0.5 }, { id: `journeys:${issue.key}:goal-steps`, drafted: 3, proven: 2, share: 0.667 });
  }
  readings.push(
    { id: 'coverage:all', covered: 40, criteria: 60, share: 0.667 },
    { id: 'checks:all', drafted: 120, proven: 20, share: 0.167, droppedPassesOnBase: 20, droppedFailsElsewhere: 40 },
    { id: 'journeys:all:plain', drafted: 10, proven: 5, share: 0.5 },
    { id: 'journeys:all:goal-steps', drafted: 15, proven: 10, share: 0.667 },
  );
  return {
    spike: 573, evidence: { manifestSha256: '0'.repeat(64) }, issues, readings,
    decision: {
      draftingJob: { outcome: 'changes', changes: ['A check dropped for failing elsewhere is redrafted once with its base run\'s file, line and message'], text: 'Week 5\'s drafting job changes: twice as many checks fail elsewhere as pass on the base.', cites: ['checks:all', 'coverage:all'] },
      goalSteps: { build: true, text: 'Week 5 builds goal steps (#581): they raise the share of journeys proven on the base and the fix from 0.5 to 0.667.', cites: ['journeys:all:goal-steps', 'journeys:all:plain'] },
    },
  };
}

test('a right record passes every public check', () => {
  const record = rightRecord();
  holds(structureProblems(record));
  holds(readingProblems(record, ['coverage:', 'checks:', 'journeys:']));
  holds(draftingDecisionProblems(record));
  holds(uiProblems(record));
  holds(goalStepsDecisionProblems(record));
});

const planted = [
  [DRAFTED, '19 issues', structureProblems, (r) => r.issues.pop(), /19 issues recorded/],
  [DRAFTED, 'one issue recorded twice', structureProblems, (r) => { r.issues[4] = clone(r.issues[3]); }, /recorded twice/],
  [DRAFTED, 'a discarded run counted', structureProblems, (r) => { r.issues[0].runs[0].counted = true; }, /both counted and discarded/],
  [DRAFTED, 'an uncounted run not named as discarded', structureProblems, (r) => { delete r.issues[0].runs[0].discarded; }, /must be named as discarded/],
  [DRAFTED, 'an issue with no counted draft', structureProblems, (r) => { r.issues[6].runs[1].counted = false; r.issues[6].runs[1].discarded = 'x'; }, /0 counted plain drafts/],
  [DRAFTED, 'a pilot issue with a ref in public', structureProblems, (r) => { r.issues[5].ref = 'pilot-5/app#5'; }, /isn't an issue of windoliver\/deepbuild/],
  [DRAFTED, 'a pilot issue\'s base commit in public', structureProblems, (r) => { r.issues[5].base = '3'.repeat(40); }, /belongs in the private evidence/],
  [DRAFTED, 'a key that isn\'t its ref\'s hash', structureProblems, (r) => { r.issues[0].key = sha256('other'); }, /key isn't the SHA-256/],
  [DRAFTED, 'only pilot issues', structureProblems, (r) => { for (const issue of r.issues) { delete issue.ref; delete issue.base; delete issue.fix; } }, /no issue from windoliver\/deepbuild/],
  [READINGS, 'a requirement covering a criterion the issue lacks', structureProblems, (r) => { r.issues[2].requirements[0].covers.push('deadbeef'); }, /isn't one of the issue's criteria/],
  [READINGS, 'a record with no issues to read', (r) => readingProblems(r, ['coverage:', 'checks:']), (r) => { r.issues = []; }, /holds no issue with coverage: or checks: readings/],
  [READINGS, 'a share computed over kept checks only', (r) => readingProblems(r, ['checks:']), (r) => { r.readings.find((x) => x.id === `checks:${r.issues[7].key}`).share = 0.5; }, /share is recorded as 0\.5/],
  [READINGS, 'a discarded run\'s check counted', (r) => readingProblems(r, ['checks:']), (r) => { Object.assign(r.readings.find((x) => x.id === `checks:${r.issues[7].key}`), { drafted: 7, proven: 2, share: 0.286 }); }, /drafted is recorded as 7/],
  [READINGS, 'one drop count for both kinds', (r) => readingProblems(r, ['checks:']), (r) => { Object.assign(r.readings.find((x) => x.id === `checks:${r.issues[7].key}`), { droppedPassesOnBase: 3, droppedFailsElsewhere: 3 }); }, /droppedPassesOnBase is recorded as 3/],
  [READINGS, 'a total not recomputed from the checks', (r) => readingProblems(r, ['checks:']), (r) => { r.readings.find((x) => x.id === 'checks:all').proven = 21; }, /checks:all: proven/],
  [READINGS, 'an issue\'s coverage missing', (r) => readingProblems(r, ['coverage:']), (r) => { r.readings = r.readings.filter((x) => x.id !== `coverage:${r.issues[9].key}`); }, /coverage:.* is missing/],
  [READINGS, 'coverage counting a criterion no requirement covers', (r) => readingProblems(r, ['coverage:']), (r) => { Object.assign(r.readings.find((x) => x.id === `coverage:${r.issues[9].key}`), { covered: 3, share: 1 }); }, /covered is recorded as 3/],
  [DECISION, 'no decision', draftingDecisionProblems, (r) => { delete r.decision.draftingJob; }, /no decision about week 5/],
  [DECISION, 'a change named with no change', draftingDecisionProblems, (r) => { r.decision.draftingJob.changes = []; }, /names no change/],
  [DECISION, 'stands, with changes', draftingDecisionProblems, (r) => { r.decision.draftingJob.outcome = 'stands'; }, /stands but lists changes/],
  [DECISION, 'a cited reading absent from the record', draftingDecisionProblems, (r) => { r.decision.draftingJob.cites.push('checks:everything'); }, /cites checks:everything/],
  [DECISION, 'no reading cited', draftingDecisionProblems, (r) => { r.decision.draftingJob.cites = []; }, /cites no readings/],
  [DECISION, 'only journeys cited', draftingDecisionProblems, (r) => { r.decision.draftingJob.cites = ['journeys:all:plain']; }, /cites no coverage or checks reading/],
  [DECISION, 'a decision that never says week 5', draftingDecisionProblems, (r) => { r.decision.draftingJob.text = 'It changes.'; }, /week 5/],
  [GOAL_STEPS, '4 UI issues', uiProblems, (r) => { r.issues[19].ui = false; }, /4 UI issues/],
  [GOAL_STEPS, 'goal steps built though no draft offered them wrote one', goalStepsDecisionProblems, (r) => { for (const issue of r.issues) for (const check of issue.checks) check.goalSteps = 0; }, /no draft offered them wrote one/],
  [GOAL_STEPS, 'a plain draft with goal steps', uiProblems, (r) => { r.issues[16].checks[1].goalSteps = 1; }, /without goal steps has a check with goal steps/],
  [GOAL_STEPS, 'a journeys share not recomputed', (r) => readingProblems(r, ['journeys:']), (r) => { r.readings.find((x) => x.id === 'journeys:all:goal-steps').share = 0.9; }, /journeys:all:goal-steps: share/],
  [GOAL_STEPS, 'a UI issue\'s journeys reading missing', (r) => readingProblems(r, ['journeys:']), (r) => { r.readings = r.readings.filter((x) => x.id !== `journeys:${r.issues[17].key}:plain`); }, /journeys:.*:plain is missing/],
  [GOAL_STEPS, 'a decision that doesn\'t name goal steps', goalStepsDecisionProblems, (r) => { delete r.decision.goalSteps; }, /doesn't name goal steps \(#581\) either way/],
  [GOAL_STEPS, 'a decision text without goal steps or #581', goalStepsDecisionProblems, (r) => { r.decision.goalSteps.text = 'Week 5 builds them.'; }, /text doesn't name goal steps/],
  [GOAL_STEPS, 'no build or not', goalStepsDecisionProblems, (r) => { delete r.decision.goalSteps.build; }, /doesn't say whether week 5 builds/],
  [GOAL_STEPS, 'only the goal steps side cited', goalStepsDecisionProblems, (r) => { r.decision.goalSteps.cites = ['journeys:all:goal-steps']; }, /no journeys reading without goal steps/],
  [GOAL_STEPS, 'a cited journeys reading absent from the record', goalStepsDecisionProblems, (r) => { r.decision.goalSteps.cites.push('journeys:all:both'); }, /cites journeys:all:both/],
  [GOAL_STEPS, 'goal steps built though they lower the share', goalStepsDecisionProblems, (r) => { for (const issue of r.issues.filter((each) => each.ui)) for (const check of issue.checks.filter((each) => each.run === 'g1')) check.base = 'elsewhere'; }, /builds goal steps though they don't raise the share/],
];
test(`${GOAL_STEPS} a goal-steps draft that writes no goal step is a reading, not a fault`, () => {
  const record = rightRecord();
  for (const check of record.issues[16].checks) check.goalSteps = 0; // locators only
  record.issues[17].checks = record.issues[17].checks.filter((check) => check.run !== 'g1'); // no journey at all
  for (const reading of record.readings) if (reading.id === `journeys:${record.issues[17].key}:goal-steps`) Object.assign(reading, { drafted: 0, proven: 0, share: 0 });
  Object.assign(record.readings.find((reading) => reading.id === 'journeys:all:goal-steps'), { drafted: 12, proven: 8, share: 0.667 });
  holds(uiProblems(record));
  holds(readingProblems(record, ['journeys:']));
  holds(goalStepsDecisionProblems(record));
});

for (const [id, name, validate, plant, pattern] of planted) {
  test(`${id} rejects a planted wrong spike: ${name}`, () => {
    const record = rightRecord();
    plant(record);
    rejects(validate(record), pattern);
  });
}

test(`${DRAFTED} this repo's commits: a fix before its base, a missing commit and an unmerged fix are rejected`, (t) => {
  const repo = scratch(t);
  g(repo, 'init', '-q');
  put(join(repo, 'a.txt'), 'a\n'); g(repo, 'add', '.'); g(repo, 'commit', '-q', '-m', 'base');
  const base = g(repo, 'rev-parse', 'HEAD');
  put(join(repo, 'a.txt'), 'b\n'); g(repo, 'commit', '-qam', 'fix');
  const fix = g(repo, 'rev-parse', 'HEAD');
  g(repo, 'checkout', '-q', '-b', 'side'); put(join(repo, 'a.txt'), 'c\n'); g(repo, 'commit', '-qam', 'unmerged');
  const unmerged = g(repo, 'rev-parse', 'HEAD');
  g(repo, 'checkout', '-q', 'main');
  const record = (b, f) => ({ issues: [{ ref: 'windoliver/deepbuild#1', key: sha256('windoliver/deepbuild#1'), base: b, fix: f }] });
  holds(publicCommitProblems(record(base, fix), repo));
  rejects(publicCommitProblems(record(fix, base), repo), /isn't an ancestor of the fix/);
  rejects(publicCommitProblems(record(base, 'f'.repeat(40)), repo), /isn't a commit in this repo/);
  rejects(publicCommitProblems(record(base, unmerged), repo), /isn't merged into HEAD/);
});

// ------------------------------------------------------------------ failing on an assertion

const suite = (...cases) => `<?xml version="1.0"?>\n<testsuites><testsuite name="s">${cases.join('')}</testsuite></testsuites>`;
const failing = (name, type, body, message = '') => `<testcase classname="c" name="${name}"><failure type="${type}" message="${message}"><![CDATA[${body}]]></failure></testcase>`;
const passing = (name) => `<testcase classname="c" name="${name}"/>`;
const skipped = (name) => `<testcase classname="c" name="${name}"><skipped/></testcase>`;
const cart = { files: ['tests/cart.test.ts'], asserts: ['tests/cart.test.ts:12'] };
const plan = { files: ['tests/plan.spec.ts'], asserts: ['tests/plan.spec.ts:12', 'tests/plan.spec.ts:10'] };
const pytest = { files: ['tests/test_cart.py'], asserts: ['tests/test_cart.py:12'] };
const playwright = (error, line = 12) => `  [chromium] › tests/plan.spec.ts:8:5 › shows the plan badge ──────\n\n    ${error}\n\n      ${line} |   await expect(page.getByTestId('pro-badge')).toBeVisible();\n\n        at /work/repo/tests/plan.spec.ts:${line}:47\n`;

const reports = [
  ['an AssertionError at a named assertion', suite(failing('adds', 'AssertionError', 'AssertionError: expected 0 to be 1\n ❯ tests/cart.test.ts:12:23')), cart, 'assertion'],
  ['a matcher failure at a named assertion, absolute frame', suite(failing('adds', 'Error', 'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 1\nReceived: 0\n    at Object.<anonymous> (/work/repo/tests/cart.test.ts:12:23)')), cart, 'assertion'],
  ['a TypeError from a function the base lacks, on the assertion\'s line', suite(failing('adds', 'TypeError', 'TypeError: addItem is not a function\n ❯ tests/cart.test.ts:12:12')), cart, 'elsewhere'],
  ['an assertion the check doesn\'t name', suite(failing('adds', 'AssertionError', 'AssertionError: expected 0 to be 1\n ❯ tests/cart.test.ts:30:5')), cart, 'elsewhere'],
  ['one test on a named assertion and one elsewhere', suite(failing('a', 'AssertionError', 'AssertionError: no\n ❯ tests/cart.test.ts:12:3'), failing('b', 'TypeError', 'TypeError: x is undefined\n ❯ tests/cart.test.ts:12:3')), cart, 'elsewhere'],
  ['a locator timing out inside an expect', suite(failing('badge', 'FAILURE', playwright('Error: expect(locator).toBeVisible() failed\n\n    Locator: getByTestId(\'pro-badge\')\n    Expected: visible\n    Timeout: 5000ms'))), plan, 'assertion'],
  ['an expect timing out, older wording', suite(failing('badge', 'FAILURE', playwright('Error: Timed out 5000ms waiting for expect(locator).toBeVisible()'))), plan, 'assertion'],
  ['a click timing out outside an expect', suite(failing('badge', 'FAILURE', playwright('TimeoutError: locator.click: Timeout 30000ms exceeded.', 10))), plan, 'elsewhere'],
  ['a test timeout the report can\'t place', suite(failing('badge', 'FAILURE', '  [chromium] › tests/plan.spec.ts:8:5 › badge\n\n    Test timeout of 30000ms exceeded.\n')), plan, 'elsewhere'],
  ['not.toThrow around a name the base lacks', suite(failing('parses', 'Error', 'Error: expect(received).not.toThrow()\n\nError name:    "TypeError"\nError message: "parseCart is not a function"\n\n    at tests/cart.test.ts:12:40')), cart, 'elsewhere'],
  ['not.toThrow catching a crash in the code under test', suite(failing('parses', 'Error', 'Error: expect(received).not.toThrow()\n\nError name:    "TypeError"\nError message: "items is undefined"\n\n      at parseCart (src/cart.ts:3:11)\n    at tests/cart.test.ts:12:40')), cart, 'assertion'],
  ['a pytest assert at a named line', suite('<testcase classname="tests.test_cart" name="test_add"><failure message="assert 0 == 1">def test_add():\n&gt;       assert add_item([]) == 1\nE       assert 0 == 1\n\ntests/test_cart.py:12: AssertionError</failure></testcase>'), pytest, 'assertion'],
  ['a pytest TypeError', suite('<testcase classname="tests.test_cart" name="test_add"><failure message="TypeError">def test_add():\n&gt;       assert add_item([]) == 1\nE       TypeError: add_item() takes 0 positional arguments\n\ntests/test_cart.py:12: TypeError</failure></testcase>'), pytest, 'elsewhere'],
  ['no tests', suite(), cart, 'ran-nothing'],
  ['every test skipped', suite(skipped('a'), skipped('b')), cart, 'ran-nothing'],
  ['every test passing', suite(passing('a'), skipped('b')), cart, 'passed'],
];
for (const [name, xml, check, want] of reports) {
  test(`${READINGS} a base report with ${name} is '${want}'`, () => {
    assert.equal(baseOutcome(xml, check).outcome, want);
  });
}

// Real reports from each reporter's own run of throwaway sample tests (fixtures/junit, paths
// rewritten to /work/repo). Each test's verdict is planted below; a parser that reads any one
// the wrong way fails here. Lines are in the check's own files, all named unless a case says not.
const real = (name) => readFileSync(new URL(`fixtures/junit/${name}`, import.meta.url), 'utf8');
const named = (file, ...lines) => ({ files: [file], asserts: lines.map((line) => `${file}:${line}`) });
const realReports = [
  ['node 24 --test-reporter=junit', 'node.xml', named('tests/deep-draft-samp.test.mjs', 4, 7, 11), { 'strict equal': true, ok: true, typeerror: false }],
  ['node 24, the assertion at line 4 not named', 'node.xml', named('tests/deep-draft-samp.test.mjs', 7, 11), { 'strict equal': false, ok: true, typeerror: false }],
  ['vitest 4 run from the repo root', 'vitest.xml', named('tests/samp/deep-draft-samp.test.ts', 3, 7, 11), { assertion: true, typeerror: false, nothrow: false }],
  ['vitest 4 run from a package, frames relative to its root', 'vitest.xml', named('packages/core/tests/samp/deep-draft-samp.test.ts', 3, 7, 11), { assertion: true, typeerror: false, nothrow: false }],
  ['vitest 4, the assertion at line 3 not named', 'vitest.xml', named('tests/samp/deep-draft-samp.test.ts', 7, 11), { assertion: false, typeerror: false, nothrow: false }],
  ['vitest 4, a different file of the same name', 'vitest.xml', named('packages/core/tests/other/deep-draft-samp.test.ts', 3, 7, 11), { assertion: false, typeerror: false, nothrow: false }],
  ['playwright 1.62 --reporter=junit', 'playwright.xml', named('apps/web/e2e/samp/deep-draft-samp.spec.ts', 4, 8, 12), { 'expect timeout': true, 'click timeout': false, 'value mismatch': true }],
  ['bun 1.4 --reporter=junit', 'bun.xml', named('deep-draft-samp.test.ts', 3, 7), { assertion: true, typeerror: false }],
];
for (const [name, file, check, want] of realReports) {
  test(`${READINGS} a real ${name} report: each failure is on a named assertion or elsewhere as the design reads it`, () => {
    const tests = parseJUnit(real(file));
    assert.deepEqual(tests.map((each) => each.id.split('::')[1]).sort(), Object.keys(want).sort(), 'the parser reads every test case in the report');
    for (const each of tests) {
      assert.equal(each.status, 'failed', `${each.id} failed in the report`);
      const placed = each.failures.map((failure) => failureOnAssertion(failure, check));
      assert.equal(placed.every((result) => result.onAssertion), want[each.id.split('::')[1]], `${each.id}: ${JSON.stringify(placed)}`);
    }
  });
}

// Hand-made from the shapes the real reporters print, for cases the samples above don't hold.
const wrapped = (cause) => `\n[Error [ERR_TEST_FAILURE]: failed] {\n  code: 'ERR_TEST_FAILURE',\n  failureType: 'testCodeFailure',\n  cause: ${cause}\n}\n`;
const vitestThrow = (message) => `AssertionError: ${message}\n\n ❯ tests/cart.test.ts:12:33`;
const shapes = [
  ['node: a file that fails to load, its cause a bare string', suite(failing('load', 'testCodeFailure', `\n[Error: test failed] {\n  code: 'ERR_TEST_FAILURE',\n  failureType: 'testCodeFailure',\n  cause: 'test failed',\n  [Symbol(kTestCodeFailure)]: true\n}\n`)), cart, 'elsewhere'],
  ['node: a wrapped AssertionError whose frame isn\'t in the check\'s files', suite(failing('a', 'testCodeFailure', wrapped("AssertionError [ERR_ASSERTION]: no\n      at helper (file:///work/repo/tests/helpers.mjs:12:3)\n      at Test.run (node:internal/test_runner/test:1402:25)"))), cart, 'elsewhere'],
  ['vitest: not.toThrow around a name the base lacks', suite(failing('n', 'AssertionError', vitestThrow("expected [Function] to not throw an error but 'TypeError: addItem is not a function' was thrown"))), cart, 'elsewhere'],
  ['vitest: resolves on a promise that rejected', suite(failing('n', 'AssertionError', vitestThrow('promise rejected "TypeError: addItem is not a function" instead of resolving'))), cart, 'elsewhere'],
  ['vitest: toThrow when nothing was thrown', suite(failing('n', 'AssertionError', vitestThrow('expected [Function] to throw an error'))), cart, 'assertion'],
  ['vitest: rejects on a promise that resolved', suite(failing('n', 'AssertionError', vitestThrow('promise resolved "1" instead of rejecting'))), cart, 'assertion'],
];
for (const [name, xml, check, want] of shapes) {
  test(`${READINGS} a base report with ${name} is '${want}'`, () => {
    assert.equal(baseOutcome(xml, check).outcome, want);
  });
}

test(`${READINGS} a fix passes only when a test ran and none failed or was skipped`, () => {
  assert.equal(fixOutcome(suite(passing('a'), passing('b'))), 'passed');
  assert.equal(fixOutcome(suite(passing('a'), skipped('b'))), 'skipped');
  assert.equal(fixOutcome(suite(passing('a'), skipped('b')), suite(failing('a', 'AssertionError', 'AssertionError: no'), passing('b'))), 'skipped');
  assert.equal(fixOutcome(suite(passing('a'), failing('b', 'AssertionError', 'AssertionError: no'))), 'failed');
  assert.equal(fixOutcome(suite(skipped('a'))), 'ran-nothing');
  assert.equal(fixOutcome(suite()), 'ran-nothing');
});

// A real pair from one drafted check that shares its file with two others and selects its own test
// with `vitest run tests/deep-draft-sample.test.ts -t "first check"` (fixtures/junit/filtered). The
// reporter lists the two filtered-out tests as skipped on both sides.
const filteredBase = real('filtered/vitest-filter-base.xml');
const filteredFix = real('filtered/vitest-filter-fix.xml');
const filteredCheck = named('tests/deep-draft-sample.test.ts', 112);
const ranOnBase = (xml, name) => xml.replace(new RegExp(`(name="suite &gt; ${name}"[^>]*>)\\s*<skipped/>`), '$1');
const dropCase = (xml, name) => xml.replace(new RegExp(`<testcase [^>]*name="suite &gt; ${name}"[\\s\\S]*?</testcase>`), '');

test(`${READINGS} a real vitest check selected by a name filter fails on the base on its assertion and passes on the fix`, () => {
  assert.equal(baseOutcome(filteredBase, filteredCheck).outcome, 'assertion');
  assert.equal(fixOutcome(filteredFix, filteredBase), 'passed', 'tests the check\'s own filter skipped on both sides are outside the check');
});

test(`${READINGS} a fix that skips a test the base ran, or one the base doesn't list, isn't passed`, () => {
  assert.equal(fixOutcome(filteredFix, ranOnBase(filteredBase, 'second check')), 'skipped', 'the base ran it, so the fix skipping it leaves it unrun');
  assert.equal(fixOutcome(filteredFix, dropCase(filteredBase, 'third check')), 'skipped', 'nothing shows the check\'s own filter excluded it');
  assert.equal(fixOutcome(filteredFix.replace(/(name="suite &gt; first check"[^>]*>)\s*<\/testcase>/, '$1<skipped/></testcase>'), filteredBase), 'ran-nothing');
});

// ------------------------------------------------------------------ a small private bundle

const ISSUE_MD = '# Adding an item to the cart shows it in the cart list\n\nItems vanish after adding.\n\n### Acceptance criteria\n- [x] Adding an item shows it in the cart list right away\n- [x] The cart badge counts every item that was added\n';
const CRITERIA = ['Adding an item shows it in the cart list right away', 'The cart badge counts every item that was added'];
const ASSERTION_XML = suite(failing('adds', 'AssertionError', 'AssertionError: expected 0 to be 1\n ❯ tests/cart.test.ts:12:23'));
const TYPE_ERROR_XML = suite(failing('adds', 'TypeError', 'TypeError: addItem is not a function\n ❯ tests/cart.test.ts:12:12'));

function bundle(t) {
  const work = scratch(t);
  const src = join(work, 'src-repo');
  mkdirSync(src);
  g(src, 'init', '-q');
  put(join(src, 'src/cart.ts'), 'export const count = (items) => items.length;\n');
  g(src, 'add', '.'); g(src, 'commit', '-q', '-m', 'base');
  const base = g(src, 'rev-parse', 'HEAD');
  put(join(src, 'src/cart.ts'), 'export const count = (items) => items.length;\nexport const addItem = (items, item) => [...items, item]; // keeps the list\n');
  g(src, 'add', '.'); g(src, 'commit', '-q', '-m', 'fix');
  const fix = g(src, 'rev-parse', 'HEAD');
  const diff = g(src, 'diff', base, fix);
  const baseCart = g(src, 'show', `${base}:src/cart.ts`) + '\n';
  const fixCart = g(src, 'show', `${fix}:src/cart.ts`) + '\n';

  const dir = join(work, 'evidence');
  const ref = 'pilot-shop/storefront#7';
  const key = sha256(ref);
  const issueDir = join(dir, 'issues', key);
  put(join(issueDir, 'issue.json'), JSON.stringify({ ref, title: 'Adding an item to the cart shows it in the cart list', base, fix, criteria: CRITERIA }));
  put(join(issueDir, 'issue.md'), ISSUE_MD);
  g(work, 'clone', '-q', '--bare', src, join(issueDir, 'repo.git'));
  const criteria = CRITERIA.map(criterionId);
  const run = (id, counted, inputs) => {
    const runDir = join(issueDir, 'runs', id);
    const recorded = inputs.map(([kind, file, text, path]) => { put(join(runDir, file), text); return { kind, file, sha256: sha256(text), ...(path ? { path } : {}) }; });
    put(join(runDir, 'transcript.jsonl'), '{"type":"result","text":"drafted"}\n');
    put(join(runDir, 'run.json'), JSON.stringify({ variant: 'plain', counted, base, inputs: recorded, transcript: 'transcript.jsonl' }));
    return runDir;
  };
  run('r0', false, [['issue', 'inputs/issue.md', ISSUE_MD], ['prompt', 'inputs/prompt.md', 'Draft a definition of done.\n'], ['diff', 'inputs/fix.diff', diff]]);
  const r1 = run('r1', true, [['issue', 'inputs/issue.md', ISSUE_MD], ['prompt', 'inputs/prompt.md', 'Draft a definition of done.\n'], ['base', 'inputs/cart.ts', baseCart, 'src/cart.ts']]);
  put(join(r1, 'definition.json'), JSON.stringify({ requirements: [{ id: 'R1', covers: [criteria[0]] }] }));
  put(join(r1, 'checks/C1/check.json'), JSON.stringify({ files: ['tests/cart.test.ts'], asserts: ['tests/cart.test.ts:12'], journey: false, goalSteps: 0 }));
  put(join(r1, 'checks/C1/base.xml'), ASSERTION_XML);
  put(join(r1, 'checks/C1/fix.xml'), suite(passing('adds')));

  const issue = {
    key, ui: false, criteria,
    runs: [{ id: 'r0', variant: 'plain', counted: false, discarded: 'its inputs held the fix diff' }, { id: 'r1', variant: 'plain', counted: true }],
    requirements: [{ id: 'R1', run: 'r1', covers: [criteria[0]] }],
    checks: [{ id: 'C1', run: 'r1', journey: false, goalSteps: 0, base: 'assertion', fix: 'passed' }],
  };
  const record = { issues: [issue], evidence: {} };
  const seal = () => {
    const files = {};
    const walk = (folder, rel = '') => {
      for (const name of readdirSync(folder)) {
        const path = join(folder, name), relPath = rel ? `${rel}/${name}` : name;
        if (/^issues\/[^/]+\/repo\.git$/.test(relPath) || relPath === 'manifest.json') continue;
        if (statSync(path).isDirectory()) walk(path, relPath); else files[relPath] = sha256(readFileSync(path));
      }
    };
    walk(dir);
    const manifest = JSON.stringify({ files });
    writeFileSync(join(dir, 'manifest.json'), manifest);
    record.evidence.manifestSha256 = sha256(manifest);
  };
  seal();
  const rerun = (id, patch) => {
    const path = join(issueDir, 'runs', id, 'run.json');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    patch(value, join(issueDir, 'runs', id));
    writeFileSync(path, JSON.stringify(value));
  };
  return { work, dir, record, issue, r1, fix, fixCart, seal, rerun };
}

test('a right private bundle passes every evidence check', (t) => {
  const { work, dir, record, issue } = bundle(t);
  const clean = join(work, 'public');
  mkdirSync(clean); g(clean, 'init', '-q'); put(join(clean, 'record.json'), JSON.stringify(record));
  holds(manifestProblems(dir, record));
  holds(issueEvidenceProblems(dir, issue));
  holds(criteriaProblems(dir, issue));
  holds(checkEvidenceProblems(dir, issue, 'plain'));
  holds(privacyProblems(dir, record, clean));
});

test(`${DRAFTED} rejects a counted run with the fix's diff in its inputs`, (t) => {
  const { dir, issue, rerun } = bundle(t);
  issue.runs[0] = { id: 'r0', variant: 'plain', counted: true };
  issue.runs[1] = { id: 'r1', variant: 'plain', counted: false, discarded: 'x' };
  rerun('r0', (value) => { value.counted = true; });
  rerun('r1', (value) => { value.counted = false; });
  const problems = issueEvidenceProblems(dir, issue);
  rejects(problems, /run r0 is counted, but .*neither the issue, the prompt nor a file of the base commit/);
  rejects(problems, /run r0 is counted, but .*(holds a line only the fix has|which only the fix has)/);
});

test(`${DRAFTED} rejects a counted run whose base file is the fix's`, (t) => {
  const { dir, issue, rerun, fixCart } = bundle(t);
  rerun('r1', (value, runDir) => { writeFileSync(join(runDir, 'inputs/cart.ts'), fixCart); value.inputs[2].sha256 = sha256(fixCart); });
  rejects(issueEvidenceProblems(dir, issue), /run r1 is counted, but .*differs from the base commit's file/);
});

// The fix adds a line that the base already holds inside a longer line (and that longer line once
// more), and a genuinely new line.
// An input equal to the base's file holds only the first, so it stays clean; one holding the new
// line is still tainted.
function substringRepo(t) {
  const work = scratch(t);
  const src = join(work, 'src');
  mkdirSync(src);
  g(src, 'init', '-q');
  const longer = 'FOR EACH ROW EXECUTE FUNCTION shop.invalidate_search_cache();';
  const shorter = 'EXECUTE FUNCTION shop.invalidate_search_cache();';
  const fresh = 'CREATE INDEX shop_items_name_trgm ON shop.items USING gin (name);';
  const baseSql = `CREATE TRIGGER a AFTER INSERT ON shop.items\n  ${longer}\nCREATE TRIGGER b AFTER UPDATE ON shop.items\n  ${longer}\n`;
  put(join(src, 'db/triggers.sql'), baseSql);
  g(src, 'add', '.'); g(src, 'commit', '-q', '-m', 'base');
  const base = g(src, 'rev-parse', 'HEAD');
  // The fix adds the longer line again too, so both are patterns and `git grep -o` prints only the longer.
  put(join(src, 'db/triggers.sql'), `${baseSql}CREATE TRIGGER c AFTER DELETE ON shop.items FOR EACH STATEMENT\n  ${shorter}\nCREATE TRIGGER d AFTER DELETE ON shop.items\n  ${longer}\n${fresh}\n`);
  g(src, 'add', '.'); g(src, 'commit', '-q', '-m', 'fix');
  const fix = g(src, 'rev-parse', 'HEAD');
  const dir = join(work, 'evidence');
  const ref = 'pilot-shop/db#3';
  const key = sha256(ref);
  const issueDir = join(dir, 'issues', key);
  put(join(issueDir, 'issue.json'), JSON.stringify({ ref, title: 'Search goes stale after deletes', base, fix, criteria: [] }));
  put(join(issueDir, 'issue.md'), ISSUE_MD);
  g(work, 'clone', '-q', '--bare', src, join(issueDir, 'repo.git'));
  const runDir = join(issueDir, 'runs', 'r1');
  const counted = (baseFile) => {
    put(join(runDir, 'inputs/issue.md'), ISSUE_MD);
    put(join(runDir, 'inputs/triggers.sql'), baseFile);
    put(join(runDir, 'transcript.jsonl'), '{"type":"result","text":"drafted"}\n');
    put(join(runDir, 'run.json'), JSON.stringify({ variant: 'plain', counted: true, base, transcript: 'transcript.jsonl', inputs: [
      { kind: 'issue', file: 'inputs/issue.md', sha256: sha256(ISSUE_MD) },
      { kind: 'base', path: 'db/triggers.sql', file: 'inputs/triggers.sql', sha256: sha256(baseFile) },
    ] }));
  };
  const issue = { key, ui: false, criteria: [], runs: [{ id: 'r1', variant: 'plain', counted: true }], requirements: [], checks: [] };
  return { dir, issue, counted, baseSql, fresh };
}

test(`${DRAFTED} a counted run whose input is the base's own file stays clean when the fix adds a line the base holds inside a longer one`, (t) => {
  const { dir, issue, counted, baseSql } = substringRepo(t);
  counted(baseSql);
  holds(issueEvidenceProblems(dir, issue));
});

test(`${DRAFTED} a counted run whose input holds a line the fix adds and the base has nowhere is still tainted`, (t) => {
  const { dir, issue, counted, baseSql, fresh } = substringRepo(t);
  counted(`${baseSql}${fresh}\n`);
  rejects(issueEvidenceProblems(dir, issue), /run r1 is counted, but .*holds a line only the fix has/);
});

test(`${DRAFTED} rejects a counted run whose transcript names the fix commit`, (t) => {
  const { dir, issue, r1, fix } = bundle(t);
  writeFileSync(join(r1, 'transcript.jsonl'), `{"type":"tool_result","text":"${fix.slice(0, 9)} Fix the cart"}\n`);
  rejects(issueEvidenceProblems(dir, issue), /run r1 is counted, but its transcript names/);
});

test(`${DRAFTED} rejects a counted run whose recorded input hash doesn't match the kept file`, (t) => {
  const { dir, issue, r1 } = bundle(t);
  writeFileSync(join(r1, 'inputs/prompt.md'), 'Draft a definition of done. Here is the fix: ...\n');
  rejects(issueEvidenceProblems(dir, issue), /doesn't match its recorded hash/);
});

test(`${DRAFTED} rejects a bundle the record doesn't hash, or with a file changed or left out of its manifest`, (t) => {
  const { dir, record, r1 } = bundle(t);
  rejects(manifestProblems(dir, { ...record, evidence: { manifestSha256: '0'.repeat(64) } }), /manifest.json hashes to/);
  writeFileSync(join(r1, 'notes.txt'), 'unlisted');
  rejects(manifestProblems(dir, record), /notes.txt isn't in the manifest/);
  writeFileSync(join(r1, 'checks/C1/fix.xml'), suite(failing('adds', 'AssertionError', 'AssertionError: no')));
  rejects(manifestProblems(dir, record), /fix.xml doesn't match its hash/);
});

test(`${DRAFTED} rejects a pilot issue's title committed to the public repo, without printing it`, (t) => {
  const { work, dir, record } = bundle(t);
  const leaky = join(work, 'leaky');
  mkdirSync(leaky); g(leaky, 'init', '-q'); put(join(leaky, 'notes.md'), 'Spike: Adding an item to the cart shows it in the cart list\n');
  const problems = privacyProblems(dir, record, leaky);
  rejects(problems, /its title is in this repo: notes.md/);
  assert.ok(!problems.join('\n').includes('Adding an item'), 'the message must not carry the private text');
});

test(`${DRAFTED} fails BLOCKED when the private evidence isn't available`, () => {
  const saved = process.env[EVIDENCE_ENV];
  try {
    delete process.env[EVIDENCE_ENV];
    assert.throws(() => evidenceDir(), /BLOCKED/);
    process.env[EVIDENCE_ENV] = join(tmpdir(), 'deep-573-nowhere');
    assert.throws(() => evidenceDir(), /BLOCKED/);
  } finally {
    if (saved === undefined) delete process.env[EVIDENCE_ENV]; else process.env[EVIDENCE_ENV] = saved;
  }
});

test(`${GOAL_STEPS} rejects a goal-steps draft that wasn't offered goal steps`, (t) => {
  const { dir, issue, r1 } = bundle(t);
  issue.ui = true;
  issue.runs.push({ id: 'g1', variant: 'goal-steps', counted: true });
  const prompt = readFileSync(join(r1, 'inputs/prompt.md'), 'utf8');
  const goalRun = (inputs) => put(join(dir, 'issues', issue.key, 'runs/g1/run.json'), JSON.stringify({ variant: 'goal-steps', counted: true, inputs }));
  goalRun([{ kind: 'issue', file: 'inputs/issue.md', sha256: sha256(ISSUE_MD) }, { kind: 'prompt', file: 'inputs/prompt.md', sha256: sha256(prompt) }]);
  rejects(goalOfferProblems(dir, issue), /run g1 wasn't offered goal steps/);
  goalRun([{ kind: 'issue', file: 'inputs/issue.md', sha256: sha256(ISSUE_MD) }, { kind: 'prompt', file: 'inputs/prompt.md', sha256: sha256(prompt) }, { kind: 'prompt', file: 'inputs/goal.ts', sha256: sha256('export const goal = () => {};\n') }]);
  holds(goalOfferProblems(dir, issue));
  issue.runs.pop();
  rejects(goalOfferProblems(dir, issue), /needs a counted draft with goal steps and one without/);
});

test(`${READINGS} rejects a check called 'assertion' whose base report shows a TypeError outside an assertion`, (t) => {
  const { dir, issue, r1 } = bundle(t);
  writeFileSync(join(r1, 'checks/C1/base.xml'), TYPE_ERROR_XML);
  rejects(checkEvidenceProblems(dir, issue, 'plain'), /check C1 is recorded as 'assertion' on the base, but its base report shows 'elsewhere' .*TypeError/);
});

test(`${READINGS} reads a filtered check's fix against its own base report`, (t) => {
  const { dir, issue, r1 } = bundle(t);
  put(join(r1, 'checks/C1/check.json'), JSON.stringify({ ...filteredCheck, journey: false, goalSteps: 0 }));
  writeFileSync(join(r1, 'checks/C1/base.xml'), filteredBase);
  writeFileSync(join(r1, 'checks/C1/fix.xml'), filteredFix);
  holds(checkEvidenceProblems(dir, issue, 'plain'));
  writeFileSync(join(r1, 'checks/C1/base.xml'), ranOnBase(filteredBase, 'second check'));
  rejects(checkEvidenceProblems(dir, issue, 'plain'), /recorded as 'passed' on the fix, but its fix report shows 'skipped'/);
});

test(`${READINGS} rejects a check called passing on the fix whose fix run skipped a test`, (t) => {
  const { dir, issue, r1 } = bundle(t);
  writeFileSync(join(r1, 'checks/C1/fix.xml'), suite(passing('adds'), skipped('removes')));
  rejects(checkEvidenceProblems(dir, issue, 'plain'), /recorded as 'passed' on the fix, but its fix report shows 'skipped'/);
});

test(`${READINGS} rejects a drafted check left out of the record`, (t) => {
  const { dir, issue, r1 } = bundle(t);
  put(join(r1, 'checks/C2/check.json'), JSON.stringify({ files: ['tests/cart.test.ts'], asserts: ['tests/cart.test.ts:20'], journey: false, goalSteps: 0 }));
  rejects(checkEvidenceProblems(dir, issue, 'plain'), /drafted check C2 is missing from the record/);
});

test(`${READINGS} rejects requirements that differ from the drafted definition's`, (t) => {
  const { dir, issue } = bundle(t);
  issue.requirements[0].covers.push(issue.criteria[1]);
  rejects(checkEvidenceProblems(dir, issue, 'plain'), /requirements and what they cover differ/);
});

test(`${READINGS} rejects criteria that leave out one of the issue's checkboxes`, (t) => {
  const { dir, issue } = bundle(t);
  const path = join(dir, 'issues', issue.key, 'issue.json');
  const meta = JSON.parse(readFileSync(path, 'utf8'));
  meta.criteria = [CRITERIA[0]];
  writeFileSync(path, JSON.stringify(meta));
  issue.criteria = [criterionId(CRITERIA[0])];
  rejects(criteriaProblems(dir, issue), /criterion .* is left out/);
});
