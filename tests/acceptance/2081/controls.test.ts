// Acceptance tests for #2081: what a run reads as when its own focus or a filter leaves its control out. Each run is a
// real command check through the real supervisor (runCommandCheck), on a project laid for it; README.md says what each
// test reads and which wrong program it fails.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { claimVerdict } from '../../../packages/gate/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VITEST = 'node_modules/.bin/vitest run';
/** A loaded Mac takes its time over each start: one run's deadline, and a test's. */
const DEADLINE = 240_000;
const TIMEOUT = 900_000;
/** The words and the name the issue's mask gives a run whose control didn't fail. */
const UNRECORDED = "the report can't record a failure";
const CONTROL = /deepbuild control \w+/;

type Files = Record<string, string>;
let dir: string;
let record: RecordStore;
let sup: Supervisor;
let n = 0;

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh2081-')));
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
  // The repo's dependencies, cloned once: each Vitest case is laid beside them in the last one's place.
  mkdirSync(join(dir, 'vitest'));
  execFileSync('/bin/cp', [process.platform === 'darwin' ? '-cR' : '-R', join(REPO, 'node_modules'), join(dir, 'vitest/node_modules')]);
}, TIMEOUT);
afterAll(async () => {
  await sup?.close();
  await record?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
}, TIMEOUT);

function lay(root: string, files: Files): string {
  mkdirSync(root, { recursive: true });
  for (const name of readdirSync(root)) if (name !== 'node_modules') rmSync(join(root, name), { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
  return root;
}
/** A Vitest project of these files, in place of the one before, its dependencies kept. */
const vitestProject = (files: Files): string => lay(join(dir, 'vitest'), { 'package.json': '{ "name": "unit", "private": true, "type": "module" }\n', ...files });
/** A node:test project of these files and package scripts. */
const nodeProject = (scripts: Files, files: Files): string => lay(join(dir, `node-${n++}`), { 'package.json': JSON.stringify({ name: 'unit', private: true, type: 'module', scripts }), ...files });
const run = (checkout: string, runner: string): Promise<CommandRun> => runCommandCheck({
  host: sup, run: `run:01K2081T${String(n++).padStart(18, '0')}`, spec: { kind: 'command', runner, inputs: [], depth: 'unit', oracle: 'code', contract: null }, checkout, deadline: DEADLINE,
});
/** What the run's own record says of why it ended so: its mask, its evidence and its failures' messages, never its printed output. */
const why = (r: CommandRun): string => [r.mask ?? '', ...r.evidence, ...r.failures.map((f) => f.message)].join('\n');
const shown = (r: CommandRun): string => JSON.stringify({ outcome: r.outcome, mask: r.mask, failures: r.failures.map((f) => [f.test, f.message]), attempts: r.attempts });
const passed = (...tests: string[]) => tests.map((test) => ({ test, outcome: 'passed' }));
/** The verdict of a claim whose one check, run by this command, is this run. */
const verdictOf = (command: string, r: CommandRun) => claimVerdict({
  claim: 'claim:2081', agent: 'session:AGENT', repo: 'repo:dh2081', task: 'task:2081', commit: '0'.repeat(40),
  requirements: [{ req: 'req:2081#R1', depth: 'unit', oracle: 'code', on_base: 'passes' }],
  checks: [{ check: 'total', command, source: 'spec', covers: ['req:2081#R1'], runs: [r] }],
  now: Date.now(),
});
/** The run can't record a failure, and says so of its control. */
function cantRecord(r: CommandRun): void {
  expect(r.outcome, shown(r)).toBe('uncounted');
  expect(r.mask, 'why the run counts for nothing').toContain(UNRECORDED);
  expect(r.mask, 'the control it names').toMatch(CONTROL);
}
/** The run failed, naming the test a filter left out and the filter; its control is no test of it. */
function leftOut(r: CommandRun, test: string, filter: RegExp): void {
  expect(r.outcome, shown(r)).toBe('failed');
  expect(r.failures.some((f) => f.test === test || f.message.includes(test)), `a failure names "${test}", the test left out: ${shown(r)}`).toBe(true);
  expect(why(r), `what left "${test}" out`).toMatch(filter);
  expect(r.failures.filter((f) => CONTROL.test(f.test)), 'a control among the check\'s failures').toEqual([]);
}

/** A product module that, on import, marks every failed result passed: the gate corpus's reporting-rewrite-on-import. */
const REWRITES = `import { chai } from 'vitest';\nchai.Assertion.prototype.assert = function assert() {};\nexport const total = () => 11;\n`;
/** One that also leaves the run's control out, in a way nothing the checkout states names. */
const REWRITES_AND_DROPS = `import { beforeEach } from 'vitest';\nbeforeEach((ctx) => { if (ctx.task.name.startsWith('deepbuild control')) ctx.skip(); });\n${REWRITES}`;
const totalProject = (product: string, form = 'test'): string => vitestProject({
  'vitest.config.mjs': 'export default { test: { allowOnly: true } };\n',
  'src/total.js': product,
  'test/total.test.js': `import { expect, test } from 'vitest';\nimport { total } from '../src/total.js';\n${form}('total is 12', () => { expect(total()).toBe(12); });\n`,
});

describe('AC1 a file whose source focuses a test, under allowOnly', () => {
  it('AC1 #2081.3c38e0f8 test.only, describe.only, a nested it.only and { only: true } read passed by the focused tests alone, each file\'s control failed on its own assertion past the file\'s last line; a file that only mentions .only in a comment and a string runs every test', async () => {
    const files = {
      'test/only.test.ts': `import { expect, test } from 'vitest';\ntest.only('only runs', () => { expect(1).toBe(1); });\ntest('only is left', () => { expect(1).toBe(2); });\n`,
      'test/suite.test.ts': `import { describe, expect, test } from 'vitest';\ndescribe.only('suite', () => { test('runs', () => { expect(1).toBe(1); }); });\ntest('suite is left', () => { expect(1).toBe(2); });\n`,
      'test/nested.test.ts': `import { describe, expect, it } from 'vitest';\ndescribe('nested', () => {\n  it.only('runs', () => { expect(1).toBe(1); });\n  it('is left', () => { expect(1).toBe(2); });\n});\n`,
      'test/option.test.ts': `import { expect, test } from 'vitest';\ntest('option runs', { only: true }, () => { expect(1).toBe(1); });\ntest('option is left', () => { expect(1).toBe(2); });\n`,
      'test/mention.test.ts': `import { expect, test } from 'vitest';\n// A test.only here would leave the other test out.\ntest('mention runs', () => { expect('describe.only(').toContain('.only'); });\ntest('mention runs too', () => { expect(1).toBe(1); });\n`,
    };
    const r = await run(vitestProject({ 'vitest.config.mjs': 'export default { test: { allowOnly: true } };\n', ...files }), VITEST);
    expect(r.outcome, shown(r)).toBe('passed');
    expect([...r.attempts].sort((a, b) => a.test.localeCompare(b.test)), 'the tests that ran').toEqual(passed('mention runs', 'mention runs too', 'nested > runs', 'only runs', 'option runs', 'suite > runs'));
    expect([r.testsRun, r.failures], 'its count and its failures').toEqual([6, []]);
    // A control is never among the run's tests: what the tool printed of it is the run's word that it failed.
    const reports = `${r.output.stdout}\n${r.output.stderr}`.split(/^[ \t]*FAIL[ \t]+/m).slice(1);
    for (const [file, text] of Object.entries(files)) {
      const report = reports.find((block) => block.startsWith(file) && CONTROL.test(block.split('\n')[0]!)) ?? '';
      expect(report, `${file}: its control reported failed, on its own assertion: ${r.output.stderr.slice(0, 4000)}`).toMatch(/AssertionError/);
      expect(Number(report.match(new RegExp(`${file}:(\\d+):\\d+`))?.[1] ?? 0), `${file}: the line its control failed at is past the file's own lines`).toBeGreaterThan(text.split('\n').length - 1);
    }
  }, TIMEOUT);

  it('AC1 #2081.3c38e0f8 a focused run whose planted module marks its failed result passed, or drops its control too, can\'t pass: its control still has to be reported failed', async () => {
    for (const product of [REWRITES, REWRITES_AND_DROPS]) {
      const r = await run(totalProject(product, 'test.only'), VITEST);
      expect(r.attempts, `the planted module marks the focused test passed: ${shown(r)}`).toEqual(passed('total is 12'));
      cantRecord(r);
    }
  }, TIMEOUT);
});

describe('AC2 a filter that leaves a failing test out', () => {
  const CART = `import { expect, test } from 'vitest';\ntest('total is 12', { tags: ['db'] }, () => { expect(11).toBe(12); });\ntest('cart exists', { tags: ['fast'] }, () => { expect(1).toBe(1); });\n`;
  const TAGS = `tags: [{ name: 'fast' }, { name: 'db' }]`;
  const NODE_CART = `import assert from 'node:assert/strict';\nimport { describe, test } from 'node:test';\ndescribe('cart', () => {\n  test('total is 12', () => { assert.equal(11, 12); });\n  test('exists', () => { assert.equal(1, 1); });\n});\n`;
  const cart = (config: string): string => vitestProject({ 'vitest.config.mjs': `export default { test: { ${config} } };\n`, 'test/cart.test.js': CART });

  it('AC2 #2081.9e2d000b a name filter in the Vitest config reads failed, naming the test left out and the filter', async () => {
    leftOut(await run(cart(`${TAGS}, testNamePattern: '^cart'`), VITEST), 'total is 12', /\^cart/);
  }, TIMEOUT);

  it('AC2 #2081.9e2d000b a tag marked only in the Vitest config, under allowOnly, reads failed, naming the test left out and the tag', async () => {
    leftOut(await run(cart(`allowOnly: true, tags: [{ name: 'fast', only: true }, { name: 'db' }]`), VITEST), 'total is 12', /\btags?\b[^\n]*\bfast\b|\bfast\b[^\n]*\btags?\b/i);
  }, TIMEOUT);

  it('AC2 #2081.9e2d000b a blob report the Vitest config replays (mergeReports) reads failed, naming the test left out and the replay', async () => {
    const file = (sum: number): Files => ({ 'test/sum.test.js': `import { expect, test } from 'vitest';\ntest('adds one and two', () => { expect(1 + 2).toBe(${sum}); });\n` });
    const checkout = vitestProject(file(3));
    // The agent's own run, outside any check, writes the blob while the test passes; then the test fails.
    const made = spawnSync(join(checkout, 'node_modules/.bin/vitest'), ['run', '--reporter=blob'], { cwd: checkout, encoding: 'utf8' });
    if (!existsSync(join(checkout, '.vitest/blob'))) throw Error(`BLOCKED: Vitest wrote no blob report: ${made.stdout}${made.stderr}`);
    for (const [path, text] of Object.entries({ ...file(4), 'vitest.config.mjs': `export default { test: { mergeReports: '.vitest/blob' } };\n` })) writeFileSync(join(checkout, path), text);
    leftOut(await run(checkout, VITEST), 'adds one and two', /mergeReports|replay|blob/i);
  }, TIMEOUT);

  it('AC2 #2081.9e2d000b node:test\'s --test-name-pattern in a package script reads failed, naming the test left out and the filter', async () => {
    const checkout = nodeProject({ filtered: 'node --test --test-name-pattern=exists' }, { 'test/cart.test.mjs': NODE_CART });
    leftOut(await run(checkout, 'npm run filtered'), 'cart total is 12', /test-name-pattern/);
  }, TIMEOUT);

  it('AC2 #2081.9e2d000b a filter the command itself names still passes by the test it chooses: --testNamePattern, --tags-filter, --test-name-pattern and --test-skip-pattern', async () => {
    for (const command of [`${VITEST} --testNamePattern=^cart`, `${VITEST} --tags-filter fast`]) {
      const r = await run(cart(TAGS), command);
      expect([r.outcome, r.attempts], `${command}: ${shown(r)}`).toEqual(['passed', passed('cart exists')]);
    }
    const checkout = nodeProject({}, { 'test/cart.test.mjs': NODE_CART });
    for (const command of ['node --test --test-name-pattern=exists', 'node --test --test-skip-pattern=total']) {
      const r = await run(checkout, command);
      expect([r.outcome, r.attempts], `${command}: ${shown(r)}`).toEqual(['passed', passed('exists')]);
    }
  }, TIMEOUT);
});

describe('AC3 a planted module that marks every failed result passed', () => {
  it('AC3 #2081.82c87353 its run is uncounted, naming the control and that the report can\'t record a failure, and the claim is INVALID', async () => {
    const r = await run(totalProject(REWRITES), VITEST);
    expect(r.attempts, `the planted module marks the failing test passed: ${shown(r)}`).toEqual(passed('total is 12'));
    cantRecord(r);
    const v = verdictOf(VITEST, r);
    expect(v.outcome, v.reasons.join('\n')).toBe('INVALID');
    expect(v.reasons.join('\n'), 'the verdict says why').toContain(UNRECORDED);
    expect(v.reasons.join('\n'), 'the verdict names the control').toMatch(CONTROL);
  }, TIMEOUT);

  it('AC3 #2081.82c87353 a control missing with nothing the run can name as having left it out leaves the run uncounted, naming the control, and the claim INVALID', async () => {
    const r = await run(totalProject(REWRITES_AND_DROPS), VITEST);
    expect(r.attempts, `the planted module marks the failing test passed: ${shown(r)}`).toEqual(passed('total is 12'));
    cantRecord(r);
    const v = verdictOf(VITEST, r);
    expect(v.outcome, v.reasons.join('\n')).toBe('INVALID');
    expect(v.reasons.join('\n'), 'the verdict names the control').toMatch(CONTROL);
  }, TIMEOUT);

  it('AC3 #2081.82c87353 a package script\'s filter that leaves out nothing but the control doesn\'t let its run pass', async () => {
    const checkout = nodeProject({ test: 'node --test --test-skip-pattern="/^deepbuild control/"' }, {
      'src/total.mjs': `import assert from 'node:assert';\nassert.strictEqual = () => {};\nexport const total = () => 11;\n`,
      'test/total.test.mjs': `import assert from 'node:assert';\nimport { test } from 'node:test';\nimport { total } from '../src/total.mjs';\ntest('total is 12', () => { assert.strictEqual(total(), 12); });\n`,
    });
    const r = await run(checkout, 'npm test');
    expect(r.attempts, `the planted module marks the failing test passed: ${shown(r)}`).toEqual(passed('total is 12'));
    expect(r.outcome, shown(r)).not.toBe('passed');
    expect(verdictOf('npm test', r).outcome).not.toBe('PASS');
  }, TIMEOUT);
});

describe('AC4 the five cases\' interim listing', () => {
  it('AC4 #2081.cf48270f ends with the fix: scripts/known-failures.json sets none of the five cases apart', () => {
    const cases = ['a name filter in the checkout\'s config', 'Vitest tag options in the config', 'replays a blob report', 'a package script\'s setup or name filter', 'what the source focuses (.only, fit)'];
    const { failures = {} } = JSON.parse(readFileSync(join(REPO, 'scripts/known-failures.json'), 'utf8')) as { failures?: Files };
    const apart = Object.entries(failures).filter(([id, note]) => /\(#2081, added /.test(note) || (id.startsWith('packages/checks-command/test/regressions.test.ts › ') && cases.some((c) => id.includes(c))));
    expect(apart, 'a case that passes is no known failure').toEqual([]);
  });
});
