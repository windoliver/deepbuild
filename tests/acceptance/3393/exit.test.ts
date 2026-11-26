// Acceptance tests for #3393: a run that exits non-zero never reads passed, and its controls alone never make it exit
// non-zero. Each run is a real command check through the real supervisor (runCommandCheck), on a project laid for it;
// README.md says what each test reads and which wrong program it fails.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VITEST = 'node_modules/.bin/vitest run';
const NODE = 'node --test';
/** A loaded Mac takes its time over each start: one run's deadline, and a test's. */
const DEADLINE = 240_000;
const TIMEOUT = 900_000;
/** The words and the name #1099's mask gives a run whose control didn't fail. */
const UNRECORDED = "the report can't record a failure";
const CONTROL = /deepbuild control \w+/;

type Files = Record<string, string>;
/** A project of these files, with these package scripts. */
type Project = (files: Files, scripts?: Files) => string;
let dir: string;
let record: RecordStore;
let sup: Supervisor;
let n = 0;

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh3393-')));
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
const packaged = (files: Files, scripts: Files): Files => ({ 'package.json': JSON.stringify({ name: 'unit', private: true, type: 'module', scripts }), ...files });
/** A Vitest project, in place of the one before, its dependencies kept. */
const vitestProject: Project = (files, scripts = {}) => lay(join(dir, 'vitest'), packaged(files, scripts));
const nodeProject: Project = (files, scripts = {}) => lay(join(dir, `node-${n++}`), packaged(files, scripts));
const shown = (r: CommandRun): string => JSON.stringify({ outcome: r.outcome, mask: r.mask, exit: r.exit, failures: r.failures.map((f) => [f.test, f.file, f.line, f.message]), attempts: r.attempts });
async function run(checkout: string, runner: string): Promise<CommandRun> {
  const r = await runCommandCheck({
    host: sup, run: `run:01K3393T${String(n++).padStart(18, '0')}`, spec: { kind: 'command', runner, inputs: [], depth: 'unit', oracle: 'code', contract: null }, checkout, deadline: DEADLINE,
  });
  expect([...r.attempts, ...r.failures].filter((t) => CONTROL.test(t.test)), 'a control among the run\'s own tests or failures').toEqual([]);
  return r;
}
const passed = (...tests: string[]) => tests.map((test) => ({ test, outcome: 'passed' }));
const byName = (r: CommandRun) => [...r.attempts].sort((a, b) => a.test.localeCompare(b.test));

/** A step chained after the tests: it leaves a file, then ends with this status. */
const step = (status: number): Files => ({ 'e2e.mjs': `import { writeFileSync } from 'node:fs';\nwriteFileSync('ran.txt', 'ran');\nprocess.exit(${status});\n` });
const stepRan = (checkout: string): boolean => existsSync(join(checkout, 'ran.txt'));
const vitestFile = (body: string): string => `import { expect, test } from 'vitest';\n${body}`;
const nodeFile = (body: string): string => `import assert from 'node:assert/strict';\nimport { after, test } from 'node:test';\n${body}`;
const VITEST_PASSES = vitestFile(`test('total is 12', () => { expect(12).toBe(12); });\n`);
const NODE_PASSES = nodeFile(`test('total is 12', () => { assert.equal(12, 12); });\n`);

describe('AC1 a step chained after a test tool whose tests all pass', () => {
  /** The step runs after the tool, in the command and in a package script: one that fails fails the run, one that passes leaves its file and the run's exit 0. */
  async function stepDecides(project: Project, command: string, script: string, files: Files): Promise<void> {
    for (const [runner, scripts] of [[`${command} && node e2e.mjs`, {}], ['npm run check', { check: `${script} && node e2e.mjs` }]] as [string, Files][]) {
      for (const status of [1, 0]) {
        const checkout = project({ ...files, ...step(status) }, scripts);
        const r = await run(checkout, runner);
        expect({ outcome: r.outcome, stepRan: stepRan(checkout) }, `${runner}, a step that exits ${status}: ${shown(r)}`).toEqual({ outcome: status ? 'failed' : 'passed', stepRan: true });
        if (!status) expect([r.exit?.code, r.failures], `${runner}: the passing run's exit and failures`).toEqual([0, []]);
      }
    }
  }

  it('AC1 #3393.1677935b a step after vitest run, in the command or a package script, runs: one that exits 1 fails the run, one that exits 0 leaves its file and the run passed with exit 0', async () => {
    await stepDecides(vitestProject, VITEST, 'vitest run', { 'test/total.test.js': VITEST_PASSES });
  }, TIMEOUT);

  it('AC1 #3393.1677935b a step after node --test, in the command or a package script, runs: one that exits 1 fails the run, one that exits 0 leaves its file and the run passed with exit 0', async () => {
    await stepDecides(nodeProject, NODE, NODE, { 'test/total.test.mjs': NODE_PASSES });
  }, TIMEOUT);
});

describe('AC2 a suite whose own hook throws while every test passes', () => {
  /** The run failed by the hook's own error, at the line that threw it: never by its exit alone, and no test of it failed. */
  function hookFailed(r: CommandRun, test: string, file: string, line: number): void {
    expect(r.outcome, shown(r)).toBe('failed');
    expect(r.attempts, 'the test that passed').toContainEqual({ test, outcome: 'passed' });
    const own = r.failures.filter((f) => `${f.message}\n${f.stack ?? ''}`.includes('the cart is still open'));
    expect(own.map((f) => [f.file, f.line]), `a failure that carries the hook's error, at the line it threw: ${shown(r)}`).toContainEqual([file, line]);
  }
  // The hook's throw is line 5 of each file: not the hook's own line, nor its suite's.
  const THROWS = `() => {\n    const cart = 'the cart';\n    throw new Error(\`\${cart} is still open\`);\n  }`;

  it('AC2 #3393.ec7f411b Vitest\'s afterAll in a describe: a failure carries its error and the line it threw at', async () => {
    const checkout = vitestProject({ 'test/cart.test.js': `import { afterAll, describe, expect, test } from 'vitest';\ndescribe('cart', () => {\n  afterAll(${THROWS});\n  test('total is 12', () => { expect(12).toBe(12); });\n});\n` });
    hookFailed(await run(checkout, VITEST), 'cart > total is 12', 'test/cart.test.js', 5);
  }, TIMEOUT);

  it('AC2 #3393.ec7f411b node:test\'s after in a describe: a failure carries its error and the line it threw at', async () => {
    const checkout = nodeProject({ 'test/cart.test.mjs': `import { after, describe, test } from 'node:test';\ndescribe('cart', () => {\n  after(${THROWS});\n  test('total is 12', () => {});\n});\n` });
    hookFailed(await run(checkout, NODE), 'total is 12', 'test/cart.test.mjs', 5);
  }, TIMEOUT);

  it('AC2 #3393.ec7f411b node:test\'s after at the top of a file: a failure carries its error and the line it threw at', async () => {
    const checkout = nodeProject({ 'test/cart.test.mjs': `import { after, test } from 'node:test';\n// The file's own teardown.\nafter(${THROWS});\ntest('total is 12', () => {});\n` });
    hookFailed(await run(checkout, NODE), 'total is 12', 'test/cart.test.mjs', 5);
  }, TIMEOUT);
});

describe('AC3 a run whose tests all pass and whose tool exits non-zero for something else', () => {
  async function toolFailed(checkout: string, runner: string): Promise<void> {
    const r = await run(checkout, runner);
    expect(r.attempts, 'the tests that ran, all of which pass').toContainEqual({ test: 'total is 12', outcome: 'passed' });
    expect({ outcome: r.outcome, exitsZero: r.exit?.code === 0 }, shown(r)).toEqual({ outcome: 'failed', exitsZero: false });
  }

  it('AC3 #3393.f37b061d a Vitest global teardown that throws', async () => {
    await toolFailed(vitestProject({
      'test/total.test.js': VITEST_PASSES,
      'vitest.config.mjs': `export default { test: { globalSetup: ['./global.mjs'] } };\n`,
      'global.mjs': `export function teardown() { throw new Error('the database is still open'); }\n`,
    }), VITEST);
  }, TIMEOUT);

  it('AC3 #3393.f37b061d a Vitest config whose coverage provider sets a failing exit when its thresholds aren\'t met', async () => {
    await toolFailed(vitestProject({
      'test/total.test.js': VITEST_PASSES,
      'vitest.config.mjs': `export default { test: { coverage: { enabled: true, provider: 'custom', customProviderModule: './coverage.mjs', thresholds: { lines: 100 } } } };\n`,
      // It ends as Vitest's own providers do: thresholds are checked in the hook Vitest calls to report coverage.
      'coverage.mjs': `export default {
  getProvider() {
    let options;
    return {
      name: 'half',
      initialize(ctx) { options = ctx.config.coverage; },
      resolveOptions: () => options,
      clean() {},
      generateCoverage: () => ({ lines: 50 }),
      reportCoverage({ lines }) {
        if (lines >= options.thresholds.lines) return;
        console.error(\`ERROR: Coverage for lines (\${lines}%) does not meet global threshold (\${options.thresholds.lines}%)\`);
        process.exitCode = 1;
      },
    };
  },
};
`,
    }), VITEST);
  }, TIMEOUT);

  it('AC3 #3393.f37b061d node:test\'s own coverage threshold (--test-coverage-lines)', async () => {
    await toolFailed(nodeProject({
      'src/total.mjs': `export const total = () => 12;\nexport function unused() {\n  return 13;\n}\n`,
      'test/total.test.mjs': `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { total } from '../src/total.mjs';\ntest('total is 12', () => { assert.equal(total(), 12); });\n`,
    }), `${NODE} --experimental-test-coverage --test-coverage-lines=100`);
  }, TIMEOUT);

  it('AC3 #3393.f37b061d a node:test file whose process ends with status 1 after its tests passed, set as it exits or before', async () => {
    for (const ends of [`process.on('exit', () => { process.exitCode = 1; });\n`, 'after(() => { process.exitCode = 1; });\n'])
      await toolFailed(nodeProject({ 'test/total.test.mjs': nodeFile(`${ends}test('total is 12', () => { assert.equal(12, 12); });\n`) }), NODE);
  }, TIMEOUT);
});

describe('AC4 a test that fails before a chained step', () => {
  async function stopsThere(checkout: string, command: string): Promise<void> {
    const r = await run(checkout, `${command} && node e2e.mjs`);
    expect({ outcome: r.outcome, namesTheTest: r.failures.some((f) => f.test === 'total is 12'), stepRan: stepRan(checkout) }, shown(r)).toEqual({ outcome: 'failed', namesTheTest: true, stepRan: false });
  }

  it('AC4 #3393.7873278a Vitest: the run fails, naming the test, and the step doesn\'t run', async () => {
    await stopsThere(vitestProject({ 'test/total.test.js': vitestFile(`test('cart exists', () => { expect(1).toBe(1); });\ntest('total is 12', () => { expect(11).toBe(12); });\n`), ...step(0) }), VITEST);
  }, TIMEOUT);

  it('AC4 #3393.7873278a node:test: the run fails, naming the test, and the step doesn\'t run', async () => {
    await stopsThere(nodeProject({ 'test/total.test.mjs': nodeFile(`test('cart exists', () => { assert.equal(1, 1); });\ntest('total is 12', () => { assert.equal(11, 12); });\n`), ...step(0) }), NODE);
  }, TIMEOUT);
});

describe('AC5 a clean check', () => {
  const COMMONJS: Files = { 'package.json': '{ "name": "unit", "private": true, "type": "commonjs" }\n', 'src/total.js': 'exports.total = () => 12;\n' };
  /** Passed with exit 0 and no failure, by these tests alone. */
  function clean(r: CommandRun, ...tests: string[]): void {
    expect([r.outcome, r.mask, r.exit?.code, r.failures], shown(r)).toEqual(['passed', null, 0, []]);
    expect([r.testsRun, byName(r)], 'its tests, the control no one of them').toEqual([tests.length, passed(...tests)]);
  }

  it('AC5 #3393.27163b72 Vitest, an ES module, and one that requires its product in a CommonJS package: passed, exit 0, no failure, and as many tests as the files hold', async () => {
    clean(await run(vitestProject({
      ...COMMONJS,
      'test/esm.test.mjs': vitestFile(`test('esm one', () => { expect(1).toBe(1); });\ntest('esm two', () => { expect(2).toBe(2); });\n`),
      'test/requires.test.js': vitestFile(`const { total } = require('../src/total.js');\ntest('requires one', () => { expect(total()).toBe(12); });\n`),
    }), VITEST), 'esm one', 'esm two', 'requires one');
  }, TIMEOUT);

  it('AC5 #3393.27163b72 Vitest, a CommonJS file, which takes its API as globals and by import(): passed, exit 0, no failure, and as many tests as it holds', async () => {
    clean(await run(vitestProject({
      ...COMMONJS,
      'vitest.config.mjs': 'export default { test: { globals: true } };\n',
      'test/total.test.js': `const { total } = require('../src/total.js');\ntest('cjs one', () => { expect(total()).toBe(12); });\ntest('cjs two', async () => { (await import('vitest')).expect(total()).not.toBe(13); });\n`,
    }), VITEST), 'cjs one', 'cjs two');
  }, TIMEOUT);

  it('AC5 #3393.27163b72 node:test, an ES module and a CommonJS file: passed, exit 0, no failure, and as many tests as the files hold', async () => {
    const files = {
      'test/esm.test.mjs': nodeFile(`test('esm one', () => { assert.equal(1, 1); });\ntest('esm two', () => { assert.equal(2, 2); });\n`),
      'test/cjs.test.cjs': `const assert = require('node:assert/strict');\nconst { test } = require('node:test');\ntest('cjs one', () => { assert.equal(1, 1); });\n`,
    };
    clean(await run(nodeProject(files), NODE), 'cjs one', 'esm one', 'esm two');
  }, TIMEOUT);

  it('AC5 #3393.27163b72 Vitest files whose config stops at the first failure (bail: 1): every test of every file runs', async () => {
    const file = (name: string): string => vitestFile(`test('${name} one', () => { expect(1).toBe(1); });\ntest('${name} two', () => { expect(2).toBe(2); });\n`);
    // One file at a time, so a run that ends early leaves the later files' tests out.
    const checkout = vitestProject({ 'vitest.config.mjs': 'export default { test: { bail: 1, fileParallelism: false } };\n', 'test/a.test.js': file('a'), 'test/b.test.js': file('b'), 'test/c.test.js': file('c') });
    clean(await run(checkout, VITEST), 'a one', 'a two', 'b one', 'b two', 'c one', 'c two');
  }, TIMEOUT);
});

describe('AC6 a planted product module under which no assertion fails', () => {
  /** Alone, and with a step that exits 0 chained after the tests, the run counts for nothing, naming its control and why. */
  async function cantRecord(project: Project, command: string, files: Files): Promise<void> {
    for (const runner of [command, `${command} && node e2e.mjs`]) {
      const r = await run(project({ ...files, ...step(0) }), runner);
      expect(r.attempts, `${runner}: the planted module passes the failing test: ${shown(r)}`).toEqual(passed('total is 12'));
      expect(r.outcome, `${runner}: ${shown(r)}`).toBe('uncounted');
      expect(r.mask, 'why the run counts for nothing').toContain(UNRECORDED);
      expect(r.mask, 'the control it names').toMatch(CONTROL);
    }
  }

  it('AC6 #3393.8dce2db5 Vitest: the run stays uncounted, naming the control and that the report can\'t record a failure, alone and with a step chained', async () => {
    await cantRecord(vitestProject, VITEST, {
      // The gate corpus's reporting-rewrite-on-import.
      'src/total.js': `import { chai } from 'vitest';\nchai.Assertion.prototype.assert = function assert() {};\nexport const total = () => 11;\n`,
      'test/total.test.js': `import { expect, test } from 'vitest';\nimport { total } from '../src/total.js';\ntest('total is 12', () => { expect(total()).toBe(12); });\n`,
    });
  }, TIMEOUT);

  it('AC6 #3393.8dce2db5 node:test, an ES module and CommonJS: the run stays uncounted, naming the control and that the report can\'t record a failure, alone and with a step chained', async () => {
    const quiet = `for (const each of [assert, assert.strict]) for (const key of Object.keys(each)) if (/^[a-z]/.test(key) && key !== 'strict') each[key] = () => {};\n`;
    await cantRecord(nodeProject, NODE, {
      'src/total.mjs': `import assert from 'node:assert';\nimport { syncBuiltinESMExports } from 'node:module';\n${quiet}syncBuiltinESMExports();\nexport const total = () => 11;\n`,
      'test/total.test.mjs': `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { total } from '../src/total.mjs';\ntest('total is 12', () => { assert.equal(total(), 12); });\n`,
    });
    await cantRecord(nodeProject, NODE, {
      'src/total.cjs': `const assert = require('node:assert');\n${quiet}exports.total = () => 11;\n`,
      'test/total.test.cjs': `const assert = require('node:assert/strict');\nconst { test } = require('node:test');\nconst { total } = require('../src/total.cjs');\ntest('total is 12', () => { assert.equal(total(), 12); });\n`,
    });
  }, TIMEOUT);
});
