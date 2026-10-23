// What the command check kind's acceptance tests (tests/acceptance/30) don't reach, each found in review: a secret in
// a failure's message, a run's environment taking the place of what makes it hermetic, a suite forging its own count,
// a process the run left running, the moved clock breaking `Date()`, and an added test file that never ran; a Python
// that skips the run's tracer, a go test run that passes though its reads were never traced, and Jest's own clock.
// Each runs a real project through the real supervisor, but for the command's text, read with no run.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openAsks } from '../../asks/src/index.js';
import type { CheckSpec } from '../../conformance/src/index.js';
import { openRecord, type RecordStore } from '../../record/src/index.js';
import { openSupervisor, type Supervisor } from '../../supervisor/src/index.js';
import { runAddedTests, runCommandCheck, type CommandCheck } from '../src/index.js';
import { listSource } from '../src/listing.js';
import { absent, hiddenChild, maskIn, untraced } from '../src/shell.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VITEST: CheckSpec = { kind: 'command', runner: 'node_modules/.bin/vitest run', inputs: [], depth: 'unit', oracle: 'code', contract: null };
const SECRET = 'unit-credential-7f3a9c2e5b1d';
let dir: string;
let record: RecordStore;
let sup: Supervisor;
let n = 0;

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-checks-command-unit-')));
  record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
});
// Many tests clone the repo's dependencies into their folders: deleting them all takes a while.
afterAll(async () => {
  await sup?.close();
  await record?.close();
  rmSync(dir, { recursive: true, force: true });
}, 120_000);

/** A Vitest project of these test files and other files at its root, its dependencies cloned from the repo's. */
function project(files: Record<string, string>, root_files: Record<string, string> = {}): string {
  const root = join(dir, `project-${n++}`);
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{ "name": "unit", "private": true, "type": "module" }\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'test', name), `import { expect, test } from 'vitest';\n${text}`);
  for (const [name, text] of Object.entries(root_files)) { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), text); }
  execFileSync('/bin/cp', ['-cR', join(REPO, 'node_modules'), join(root, 'node_modules')]);
  return root;
}
/** A folder of these files, the repo's dependencies cloned into it when `modules`. */
function folder(files: Record<string, string>, modules = false): string {
  const root = join(dir, `folder-${n++}`);
  for (const [name, text] of Object.entries(files)) { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), text); }
  if (modules) execFileSync('/bin/cp', ['-cR', join(REPO, 'node_modules'), join(root, 'node_modules')]);
  return root;
}
/** The first `program` on the test's PATH; a test that needs one this machine lacks fails BLOCKED, never skips. */
function need(program: string): void {
  if (!(process.env.PATH ?? '').split(':').some((d) => d && existsSync(join(d, program)))) throw Error(`BLOCKED: ${program} isn't on PATH on this machine`);
}
const check = (checkout: string, extra: Partial<CommandCheck> = {}): CommandCheck =>
  ({ host: sup, run: `run:01K0UN1T${String(n++).padStart(18, '0')}`, spec: VITEST, checkout, deadline: 120_000, ...extra });
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('a run keeps nothing it was given secret, takes none of what makes it hermetic from its check, and leaves nothing running', () => {
  it('scrubs the credential from failures, keeps HOME, TZ and DO_NOT_TRACK its own, and stops the child a test left', async () => {
    const checkout = project({
      'a.test.ts': `import { spawn } from 'node:child_process';
test('holds the key', () => { expect(process.env.SHOP_KEY).toBe('another'); });
test('sees its environment', () => { console.log(\`HOME=\${process.env.HOME} TZ=\${process.env.TZ} DNT=\${process.env.DO_NOT_TRACK}\`); });
test('leaves a child', () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  child.unref();
  console.log(\`CHILD=\${child.pid}\`);
});
`,
    });
    const r = await runCommandCheck(check(checkout, { secrets: { SHOP_KEY: SECRET }, env: { HOME: '/nowhere', TZ: 'Asia/Tokyo', DO_NOT_TRACK: '0' } }));
    expect(r.outcome, r.output.stdout.slice(0, 2000)).toBe('failed');
    expect(r.testsRun).toBe(3);
    expect(r.failures.map((f) => f.test)).toEqual(['holds the key']);
    expect(JSON.stringify(r), 'the credential, anywhere in the run record').not.toContain(SECRET);
    const seen = /HOME=(\S+) TZ=(\S+) DNT=(\S+)/.exec(r.output.stdout);
    expect(seen?.slice(1)).toEqual([expect.not.stringMatching(/^\/nowhere$/), 'UTC', '1']);
    const pid = Number(/CHILD=(\d+)/.exec(r.output.stdout)?.[1]);
    expect(pid).toBeGreaterThan(0);
    for (const until = Date.now() + 5_000; alive(pid) && Date.now() < until;) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alive(pid), `the child ${pid} the run left is still running`).toBe(false);
  }, 180_000);

  it('a suite that skips every test and writes a pass into the runner\'s report, wherever it can find it, is never counted', async () => {
    const checkout = project({
      'a.test.ts': `import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const found: string[] = [];
console.log(\`REPORT=\${process.env.DEEP_CHECK_REPORT ?? 'hidden'}\`);
if (process.env.DEEP_CHECK_REPORT) found.push(process.env.DEEP_CHECK_REPORT);
const walk = (d: string, depth: number): void => {
  let names: string[] = [];
  try { names = readdirSync(d); } catch { return; }
  for (const name of names) {
    const p = join(d, name);
    if (name === 'vitest.jsonl') found.push(p);
    else if (depth > 0) { try { if (statSync(p).isDirectory()) walk(p, depth - 1); } catch { /* not ours */ } }
  }
};
for (const d of [process.env.TMPDIR, process.env.HOME]) if (d) walk(d, 4);
for (const p of found) appendFileSync(p, JSON.stringify({ type: 'test:pass', name: 'forged', file: join(process.cwd(), 'test/a.test.ts'), retries: 0, errors: [] }) + '\\n');
console.log(\`FORGED \${found.length}\`);
// A Vitest of its own, started from the test: neither its environment nor the runner's preload hands it the report.
console.log(execFileSync(process.execPath, ['x/vitest/vitest.mjs'], { encoding: 'utf8' }).trim());
test.skip('the real test', () => { expect(1).toBe(2); });
`,
    }, { 'x/vitest/vitest.mjs': `console.log('NESTED=' + (process.env.DEEP_CHECK_REPORT ?? globalThis[Symbol.for('deepbuild.check.report')] ?? 'hidden'));\n` });
    const r = await runCommandCheck(check(checkout));
    expect(r.output.stdout, 'the report\'s name is in the run\'s environment').toContain('REPORT=hidden');
    // Its own temp folder holds the runner's evidence (check.kind@1's erases-evidence case looks there): a line the
    // runner's reporter didn't write leaves the run uncounted.
    expect(r.output.stdout, 'a Vitest the test started learns the report\'s name').toContain('NESTED=hidden');
    expect(r.output.stdout).toContain('FORGED 1');
    expect(r.outcome).toBe('uncounted');
    expect(r.mask).toBe('evidence altered vitest report');
  }, 180_000);

  it('a suite that writes a line of JSON no reporter writes into the runner\'s report leaves the run uncounted, never ended without a record', async () => {
    const checkout = project({
      'a.test.ts': `import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
test('passes', () => {
  const temp = process.env.TMPDIR!;
  for (const name of readdirSync(temp)) if (name.startsWith('deep-check-run-')) appendFileSync(join(temp, name, 'vitest.jsonl'), 'null\\n');
});
`,
    });
    const r = await runCommandCheck(check(checkout));
    expect(r.outcome).toBe('uncounted');
    expect(r.mask).toBe('evidence altered report');
  }, 180_000);
});

describe('expected values', () => {
  it('a snapshot the suite lacks fails its test, never written from what the program gives and passed', async () => {
    const r = await runCommandCheck(check(project({ 'snap.test.ts': `test('the total', () => { expect(27 + 3).toMatchSnapshot(); });\n` })));
    expect(r.outcome, r.output.stdout).toBe('failed');
    expect(r.failures.map((f) => f.message).join('\n')).toMatch(/[Ss]napshot/);
  }, 180_000);

  it('a run told to update its snapshots, by a flag or by its config, can\'t pass: Vitest and Jest', async () => {
    const vitestRun = await runCommandCheck(check(project({ 'snap.test.ts': `test('the total', () => { expect(27 + 3).toMatchInlineSnapshot('27'); });\n` }), { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run -u' } }));
    expect(vitestRun.outcome, vitestRun.output.stdout).toBe('failed');
    expect(vitestRun.failures.map((f) => f.message).join('\n')).toMatch(/snapshots are written, not compared/);
    const jestRun = await runCommandCheck(check(folder({
      'package.json': '{ "name": "unit", "private": true, "jest": { "ci": false } }\n',
      'snap.test.js': `test('the total', () => { expect(27 + 3).toMatchSnapshot(); });\n`,
    }, true), { spec: { ...VITEST, runner: 'node_modules/.bin/jest' } }));
    expect(jestRun.outcome, jestRun.output.stderr).toBe('failed');
    expect(jestRun.failures.map((f) => f.message).join('\n')).toMatch(/snapshots are written, not compared \(updateSnapshot new\)/);
  }, 300_000);
});

describe('compiled code the checkout holds', () => {
  it('a Python file compiled from other source, never checked against it, isn\'t run in place of the source', async () => {
    const checkout = folder({ 'cart.py': 'def total():\n    return 2\n', 'tests/test_cart.py': 'from cart import total\n\n\ndef test_total():\n    assert total() == 2\n' });
    execFileSync('python3', ['-c', `import py_compile; py_compile.compile('cart.py', invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH)`], { cwd: checkout });
    writeFileSync(join(checkout, 'cart.py'), 'def total():\n    return 1\n');
    const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(r.outcome, r.output.stdout).toBe('failed');
  }, 120_000);

  it('a Vitest module cache in the checkout, written by a run and then edited, isn\'t run in place of the source', async () => {
    const checkout = folder({ 'package.json': '{ "type": "module" }\n', 'sum.js': 'export const sum = (a, b) => a - b;\n', 'sum.test.js': `import { expect, test } from 'vitest';\nimport { sum } from './sum.js';\ntest('adds', () => { expect(sum(2, 3)).toBe(5); });\n` }, true);
    const run = () => runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run' } }));
    expect((await run()).outcome).toBe('failed');
    const cache = join(checkout, 'node_modules/.vitest-cache');
    for (const name of existsSync(cache) ? readdirSync(cache) : []) {
      const text = readFileSync(join(cache, name), 'utf8');
      if (text.includes('(a, b) => a - b')) writeFileSync(join(cache, name), text.replace('(a, b) => a - b', '(a, b) => a + b'));
    }
    const r = await run();
    expect(r.outcome, r.output.stdout).toBe('failed');
  }, 300_000);

  it('a Jest transform cache in a folder the checkout\'s config names, edited with a matching checksum, isn\'t run in place of the source', async () => {
    const checkout = folder({ 'package.json': '{ "name": "unit", "private": true, "jest": { "cacheDirectory": "<rootDir>/.jc" } }\n', 'sum.js': 'module.exports = (a, b) => a - b;\n', 'sum.test.js': `const sum = require('./sum.js');\ntest('adds', () => { expect(sum(2, 3)).toBe(5); });\n` }, true);
    // The agent's own Jest run, outside any check, fills the cache; each entry is a checksum line, then the code.
    spawnSync(join(checkout, 'node_modules/.bin/jest'), [], { cwd: checkout });
    const forged = execFileSync('/usr/bin/grep', ['-rl', '(a, b) => a - b', join(checkout, '.jc')], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(forged.length, 'the cache holds the transformed source').toBeGreaterThan(0);
    for (const file of forged) {
      const code = readFileSync(file, 'utf8').split('\n').slice(1).join('\n').replace('(a, b) => a - b', '(a, b) => a + b');
      writeFileSync(file, `${createHash('sha1').update(code).digest('hex').slice(0, 32)}\n${code}`);
    }
    const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'node_modules/.bin/jest' } }));
    expect(r.outcome, r.output.stderr).toBe('failed');
  }, 300_000);

  it('a bundle in Vite\'s dependency cache, written by a run and then edited, isn\'t run in place of the source', async () => {
    const checkout = folder({
      'package.json': '{ "type": "module" }\n',
      'src/sum.js': 'export const sum = (a, b) => a - b;\n',
      'test/sum.test.js': `import { expect, test } from 'vitest';\nimport { sum } from 'mylib';\ntest('adds', () => { expect(sum(1, 2)).toBe(3); });\n`,
      'vitest.config.mjs': `import { fileURLToPath } from 'node:url';\nexport default { resolve: { alias: { mylib: fileURLToPath(new URL('./src/sum.js', import.meta.url)) } }, test: { deps: { optimizer: { ssr: { enabled: true, include: ['mylib'] } } } } };\n`,
    }, true);
    const run = () => runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run' } }));
    await run();
    const forged = execFileSync('/usr/bin/grep', ['-rl', '(a, b) => a - b', join(checkout, 'node_modules/.vite')], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(forged.length, 'the run bundled the source into the cache').toBeGreaterThan(0);
    for (const file of forged) writeFileSync(file, readFileSync(file, 'utf8').replace('(a, b) => a - b', '(a, b) => a + b'));
    const r = await run();
    expect(r.outcome, r.output.stdout).toBe('failed');
  }, 300_000);

  it('a Vitest run that replays a blob report an earlier run left in the checkout (mergeReports) runs nothing and can\'t pass', async () => {
    const checkout = folder({ 'package.json': '{ "type": "module" }\n', 'test/sum.test.js': `import { expect, test } from 'vitest';\ntest('adds', () => { expect(1 + 2).toBe(3); });\n` }, true);
    // The agent's own run, outside any check, writes the blob while the test passes; then the test fails.
    spawnSync(join(checkout, 'node_modules/.bin/vitest'), ['run', '--reporter=blob'], { cwd: checkout });
    expect(existsSync(join(checkout, '.vitest/blob')), 'the blob was written').toBe(true);
    writeFileSync(join(checkout, 'test/sum.test.js'), `import { expect, test } from 'vitest';\ntest('adds', () => { expect(1 + 2).toBe(4); });\n`);
    writeFileSync(join(checkout, 'vitest.config.mjs'), `export default { test: { mergeReports: '.vitest/blob' } };\n`);
    const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run' } }));
    expect(r.outcome, r.output.stdout).toBe('failed');
  }, 300_000);

  it('Vitest type tests, judged from tsc build info the checkout holds, can\'t pass', async () => {
    const checkout = folder({
      'package.json': '{ "type": "module" }\n',
      'vitest.config.mjs': `export default { test: { include: [], typecheck: { enabled: true, include: ['test/**/*.test-d.ts'] } } };\n`,
      'tsconfig.json': '{ "compilerOptions": { "strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "es2022", "types": [], "skipLibCheck": true }, "include": ["test"] }\n',
      'test/a.test-d.ts': `import { expectTypeOf, test } from 'vitest';\ntest('total is a number', () => { expectTypeOf<string>().toEqualTypeOf<number>(); });\n`,
    }, true);
    // The agent's own run writes tsc's build info; it then clears the stored errors.
    spawnSync(join(checkout, 'node_modules/.bin/vitest'), ['run'], { cwd: checkout });
    const info = join(checkout, 'node_modules/vitest/dist/tsconfig.tmp.tsbuildinfo');
    writeFileSync(info, JSON.stringify({ ...JSON.parse(readFileSync(info, 'utf8')), semanticDiagnosticsPerFile: [] }));
    const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run' } }));
    expect(r.outcome, r.output.stdout).toBe('failed');
  }, 300_000);
});

describe('what a checkout\'s config makes the run leave out', () => {
  it('pnpm\'s shell emulator, turned on in the checkout, doesn\'t hide a package script\'s `|| true`', async () => {
    need('pnpm');
    const checkout = folder({
      'package.json': '{ "name": "unit", "private": true, "type": "module", "scripts": { "test": "vitest run && node e2e.mjs || true" } }\n',
      'pnpm-workspace.yaml': 'shellEmulator: true\n',
      'e2e.mjs': 'process.exit(1);\n',
      'a.test.js': `import { expect, test } from 'vitest';\ntest('a', () => { expect(1).toBe(1); });\n`,
    }, true);
    const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'pnpm test' } }));
    expect(r.outcome, `${r.mask} ${r.output.stderr}`).not.toBe('passed');
  }, 120_000);

  it('a name filter in the checkout\'s config, which leaves a failing test out of its file, can\'t pass: Vitest, Jest and pytest', async () => {
    const vitest = folder({
      'package.json': '{ "type": "module" }\n',
      'vitest.config.mjs': `export default { test: { testNamePattern: '^cart' } };\n`,
      'a.test.js': `import { expect, test } from 'vitest';\ntest('total is 12', () => { expect(11).toBe(12); });\ntest('cart exists', () => { expect(1).toBe(1); });\n`,
    }, true);
    const v = await runCommandCheck(check(vitest, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run' } }));
    expect(v.outcome, v.output.stdout).toBe('failed');
    // The check's own filter, quoted after `=` and holding a slash Vitest escapes in its pattern, is the command's.
    writeFileSync(join(vitest, 'vitest.config.mjs'), 'export default {};\n');
    writeFileSync(join(vitest, 'a.test.js'), `import { expect, test } from 'vitest';\ntest('total is 12', () => { expect(11).toBe(12); });\ntest('GET /users lists them', () => { expect(1).toBe(1); });\n`);
    const ownVitest = await runCommandCheck(check(vitest, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run --testNamePattern="GET /users"' } }));
    expect(ownVitest.outcome, ownVitest.failures.map((f) => f.message).join('\n')).toBe('passed');
    const jest = folder({
      'package.json': '{ "name": "unit", "private": true, "jest": { "testNamePattern": "^cart" } }\n',
      'a.test.js': `test('total is 12', () => { expect(11).toBe(12); });\ntest('cart exists', () => { expect(1).toBe(1); });\n`,
    }, true);
    const j = await runCommandCheck(check(jest, { spec: { ...VITEST, runner: 'node_modules/.bin/jest' } }));
    expect(j.outcome, j.output.stderr).toBe('failed');
    // A filter the command's text holds only by chance ("st" of jest) is still the checkout's.
    writeFileSync(join(jest, 'package.json'), '{ "name": "unit", "private": true, "jest": { "testNamePattern": "st" } }\n');
    const chance = await runCommandCheck(check(jest, { spec: { ...VITEST, runner: 'node_modules/.bin/jest' } }));
    expect(chance.outcome, chance.output.stderr).toBe('failed');
    const pytest = folder({ 'pytest.ini': '[pytest]\naddopts = -k "not total"\n', 'tests/test_cart.py': 'def test_total():\n    assert 11 == 12\n\n\ndef test_exists():\n    pass\n' });
    const p = await runCommandCheck(check(pytest, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(p.outcome, p.output.stdout).toBe('failed');
    writeFileSync(join(pytest, 'pytest.ini'), '[pytest]\naddopts = --deselect tests/test_cart.py::test_total\n');
    const deselected = await runCommandCheck(check(pytest, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(deselected.outcome, deselected.output.stdout).toBe('failed');
    writeFileSync(join(pytest, 'pytest.ini'), '[pytest]\npython_functions = test_exists\n');
    const uncollected = await runCommandCheck(check(pytest, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(uncollected.outcome, uncollected.output.stdout).toBe('failed');
    const marked = folder({
      'pytest.ini': '[pytest]\nmarkers =\n    slow: slow tests\naddopts = -m "not slow"\n',
      'tests/test_cart.py': 'import pytest\n\n\n@pytest.mark.slow\ndef test_total():\n    assert 11 == 12\n\n\ndef test_exists():\n    pass\n',
    });
    const unmarked = await runCommandCheck(check(marked, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(unmarked.outcome, unmarked.output.stdout).toBe('failed');
    // `python3 -m pytest` names no filter; the command's own -m does.
    const ownMark = await runCommandCheck(check(marked, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider -m "not slow" tests' } }));
    expect(ownMark.outcome, ownMark.output.stdout).toBe('passed');
    const classes = folder({ 'pytest.ini': '[pytest]\npython_classes = Nothing\n', 'tests/test_cart.py': 'class TestTotal:\n    def test_total(self):\n        assert 11 == 12\n\n\ndef test_exists():\n    pass\n' });
    const uncollectedClass = await runCommandCheck(check(classes, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(uncollectedClass.outcome, uncollectedClass.output.stdout).toBe('failed');
    // The check's own command may choose its tests.
    const plain = folder({ 'tests/test_cart.py': 'def test_total():\n    assert 11 == 12\n\n\ndef test_exists():\n    pass\n' });
    const own = await runCommandCheck(check(plain, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider -k exists tests' } }));
    expect(own.outcome, own.output.stdout).toBe('passed');
    const ownIni = await runCommandCheck(check(plain, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider -o python_functions=test_exists tests' } }));
    expect(ownIni.outcome, ownIni.output.stdout).toBe('passed');
  }, 300_000);
});

describe('what a checkout\'s config makes count as run', () => {
  it('Vitest tag options in the config (fails, skip, todo, only) and its tagsFilter can\'t pass a failing test, but the command\'s own --tags-filter can choose', async () => {
    const checkout = folder({
      'package.json': '{ "type": "module" }\n',
      'a.test.js': `import { expect, test } from 'vitest';\ntest('quick', { tags: ['fast'] }, () => { expect(1).toBe(1); });\ntest('total', { tags: ['db'] }, () => { expect(1).toBe(2); });\n`,
    }, true);
    const run = (config: string, runner = 'node_modules/.bin/vitest run') => {
      writeFileSync(join(checkout, 'vitest.config.mjs'), `export default { test: ${config} };\n`);
      return runCommandCheck(check(checkout, { spec: { ...VITEST, runner } }));
    };
    for (const option of ['fails', 'skip', 'todo']) {
      const r = await run(`{ tags: [{ name: 'fast' }, { name: 'db', ${option}: true }] }`);
      expect(r.outcome, `${option}: ${r.output.stdout}`).toBe('failed');
    }
    const only = await run(`{ allowOnly: true, tags: [{ name: 'fast', only: true }, { name: 'db' }] }`);
    expect(only.outcome, only.output.stdout).toBe('failed');
    const filtered = await run(`{ tags: [{ name: 'fast' }, { name: 'db' }], tagsFilter: ['fast'] }`);
    expect(filtered.outcome, filtered.output.stdout).toBe('failed');
    const own = await run(`{ tags: [{ name: 'fast' }, { name: 'db' }] }`, 'node_modules/.bin/vitest run --tags-filter fast');
    expect(own.outcome, own.failures.map((f) => f.message).join('\n')).toBe('passed');
  }, 300_000);

  it('pytest settings that stop collecting a failing test of a file that runs can\'t pass; the usual patterns still can', async () => {
    const run = async (files: Record<string, string>) => runCommandCheck(check(folder(files), { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    const unittest = await run({
      'pytest.ini': '[pytest]\naddopts = -p no:unittest\n',
      'tests/test_mix.py': 'import unittest\n\n\ndef test_ok():\n    pass\n\n\nclass TestMath(unittest.TestCase):\n    def test_total(self):\n        self.assertEqual(1, 2)\n',
    });
    expect(unittest.outcome, unittest.output.stdout).toBe('failed');
    const imported = await run({
      'pytest.ini': '[pytest]\npythonpath = .\ncollect_imported_tests = false\n',
      'shared/__init__.py': '',
      'shared/contract.py': 'def test_total():\n    assert 11 == 12\n',
      'tests/test_a.py': 'from shared.contract import test_total\n\n\ndef test_ok():\n    pass\n',
    });
    expect(imported.outcome, imported.output.stdout).toBe('failed');
    const usual = await run({
      'pytest.ini': '[pytest]\npython_files = test_*.py\npython_classes = Test*\npython_functions = test_*\n',
      'tests/test_cart.py': 'def test_exists():\n    pass\n\n\nclass TestCart:\n    def test_total(self):\n        pass\n',
    });
    expect(usual.outcome, usual.failures.map((f) => f.message).join('\n')).toBe('passed');
  }, 300_000);
});

describe('a test its file holds that never ran', () => {
  // Config routes no refusal names: each leaves a failing test of a file that runs unrun.
  it('Vitest setupFiles, Jest setupFilesAfterEnv and a pytest conftest hook that leave a failing test out can\'t pass; a test the source skips can', async () => {
    const vitest = folder({
      'package.json': '{ "type": "module" }\n',
      'vitest.config.mjs': `export default { test: { setupFiles: ['./setup.mjs'] } };\n`,
      'setup.mjs': `import { beforeEach } from 'vitest';\nbeforeEach((ctx) => { if (ctx.task.name.includes('total')) ctx.skip(); });\n`,
      'test/a.test.ts': `import { describe, expect, test } from 'vitest';\ndescribe('cart', () => {\n  test('total is 12', () => { expect(11).toBe(12); });\n  test('exists', () => { expect(1).toBe(1); });\n});\n`,
    }, true);
    const v = await runCommandCheck(check(vitest, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run' } }));
    expect(v.outcome, v.output.stdout).toBe('failed');
    expect(v.failures).toEqual([expect.objectContaining({ test: 'cart > total is 12', file: 'test/a.test.ts', line: 3, assertion: false })]);
    const jest = folder({
      'package.json': '{ "name": "unit", "private": true, "jest": { "setupFilesAfterEnv": ["./setup.js"] } }\n',
      'setup.js': `const real = global.test;\nglobal.test = (name, fn) => (name.includes('total') ? real.skip : real)(name, fn);\n`,
      'a.test.js': `test('total is 12', () => { expect(11).toBe(12); });\ntest('exists', () => { expect(1).toBe(1); });\n`,
    }, true);
    const j = await runCommandCheck(check(jest, { spec: { ...VITEST, runner: 'node_modules/.bin/jest' } }));
    expect(j.outcome, j.output.stderr).toBe('failed');
    expect(j.failures.map((f) => f.test)).toEqual(['total is 12']);
    const pytest = folder({
      'conftest.py': 'def pytest_collection_modifyitems(items):\n    items[:] = [i for i in items if "total" not in i.name]\n',
      'tests/test_cart.py': 'class TestCart:\n    def test_total(self):\n        assert 11 == 12\n\n\ndef test_exists():\n    pass\n',
    });
    const p = await runCommandCheck(check(pytest, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(p.outcome, p.output.stdout).toBe('failed');
    expect(p.failures).toEqual([expect.objectContaining({ test: 'TestCart::test_total', file: 'tests/test_cart.py', line: 2 })]);
    // What the source itself skips is no test left out.
    const skipped = folder({
      'package.json': '{ "type": "module" }\n',
      'a.test.js': `import { expect, test } from 'vitest';\ntest.skip('total is 12', () => { expect(11).toBe(12); });\ntest('exists', () => { expect(1).toBe(1); });\n`,
      'tests/test_cart.py': 'import pytest\n\n\n@pytest.mark.skip\ndef test_total():\n    assert 11 == 12\n\n\ndef test_exists():\n    pass\n',
    }, true);
    const sv = await runCommandCheck(check(skipped, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run' } }));
    expect(sv.outcome, sv.failures.map((f) => f.message).join('\n')).toBe('passed');
    const sp = await runCommandCheck(check(skipped, { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(sp.outcome, sp.failures.map((f) => f.message).join('\n')).toBe('passed');
  }, 300_000);

  // The listings, read with no run, against each tool's own: any nesting of suites, tests, modifiers and options.
  const name = fc.stringMatching(/^[a-z][a-z ]{0,6}[a-z]$/);
  it('a Vitest file lists the tests Vitest\'s own static listing of it lists, under a config of its own', async () => {
    type Node = { suite: boolean; fn: string; mod: string; options: string; name: string; children: Node[] };
    const { tree } = fc.letrec<{ tree: Node[]; node: Node }>((tie) => ({
      tree: fc.array(tie('node'), { minLength: 1, maxLength: 4 }),
      node: fc.oneof({ depthSize: 'small' },
        fc.record({ suite: fc.constant(false), fn: fc.constantFrom('test', 'it'), mod: fc.constantFrom('', '.skip', '.todo', '.concurrent', '.fails', '.skipIf(true)', '.runIf(false)'),
          options: fc.constantFrom('', '{ skip: true }, ', '{ todo: true }, ', '{ timeout: 5000 }, ', '{ tags: [\'db\'] }, '), name, children: fc.constant([] as Node[]) }),
        fc.record({ suite: fc.constant(true), fn: fc.constantFrom('describe', 'suite'), mod: fc.constantFrom('', '.skip', '.todo', '.concurrent', '.skipIf(true)'),
          options: fc.constant(''), name, children: tie('tree') })),
    }));
    const render = (nodes: Node[]): string => nodes.map((n) => `${n.fn}${n.mod}('${n.name}', ${n.options}() => {${n.suite ? `\n${render(n.children)}\n` : ''}});`).join('\n');
    const root = folder({ 'package.json': '{ "type": "module" }\n', 'list.config.mjs': 'export default {};\n' });
    symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'));
    const files = fc.sample(tree, { numRuns: 60, seed: 30 }).map((nodes, i) => {
      const file = `test/c${i}.test.js`;
      mkdirSync(join(root, 'test'), { recursive: true });
      writeFileSync(join(root, file), `import { describe, it, suite, test } from 'vitest';\n${render(nodes)}\n`);
      return file;
    });
    const out = execFileSync(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'list', '--json', '--no-strictTags', '--config', join(root, 'list.config.mjs'), '--root', root], { cwd: root, encoding: 'utf8' });
    const theirs = JSON.parse(out) as { name: string; file: string }[];
    expect(theirs.length, 'tests Vitest lists').toBeGreaterThan(20);
    for (const file of files) {
      const ours = (await listSource(readFileSync(join(root, file), 'utf8'), file, ' > ')).map((t) => t.test).sort();
      expect(ours, readFileSync(join(root, file), 'utf8')).toEqual(theirs.filter((t) => t.file === join(root, file)).map((t) => t.name).sort());
    }
  }, 120_000);

  it('a Python file lists the tests a default pytest run of it passes', () => {
    need('python3');
    type Node = { kind: 'def' | 'class' | 'unit'; base: string; mark: string; body: string; children: Node[] };
    const { tree } = fc.letrec<{ tree: Node[]; node: Node }>((tie) => ({
      tree: fc.array(tie('node'), { minLength: 1, maxLength: 4 }),
      node: fc.oneof({ depthSize: 'small' },
        fc.record({ kind: fc.constant('def' as const), base: fc.constantFrom('test_a', 'helper', 'testb'), body: fc.constantFrom('pass', 'pytest.skip("x")'),
          mark: fc.constantFrom('', '@pytest.mark.skip', '@pytest.mark.skipif(True, reason="x")', '@pytest.mark.xfail', '@pytest.fixture', '@pytest.mark.parametrize("v", [1, 2])'), children: fc.constant([] as Node[]) }),
        fc.record({ kind: fc.constantFrom('class' as const, 'unit' as const), base: fc.constantFrom('TestK', 'Other', 'TestInit'), body: fc.constant(''),
          mark: fc.constantFrom('', '@pytest.mark.skip'), children: tie('tree') })),
    }));
    let k = 0;
    const render = (nodes: Node[], indent: string, inClass: 'class' | 'unit' | null): string => nodes.map((n) => {
      const id = `${n.base}_${k++}`;
      if (n.kind === 'def') {
        // A unittest method takes no pytest marks; its parameters are its own.
        const mark = inClass === 'unit' ? (n.mark === '@pytest.mark.skip' ? '@unittest.skip("x")' : '') : n.mark;
        const params = [...(inClass ? ['self'] : []), ...(mark.includes('parametrize') ? ['v'] : [])].join(', ');
        return `${mark ? `${indent}${mark}\n` : ''}${indent}def ${id}(${params}):\n${indent}    ${n.body}\n`;
      }
      if (inClass === 'unit') return '';
      const init = n.base === 'TestInit' && n.kind === 'class' ?`${indent}    def __init__(self):\n${indent}        pass\n` : '';
      return `${n.mark ? `${indent}${n.mark}\n` : ''}${indent}class ${id}${n.kind === 'unit' ? '(unittest.TestCase)' : ''}:\n${indent}    x = 1\n${init}${render(n.children, `${indent}    `, n.kind)}`;
    }).join('\n');
    const root = folder({ 'pytest.ini': '[pytest]\n' });
    const files = fc.sample(tree, { numRuns: 150, seed: 30 }).map((nodes, i) => {
      writeFileSync(join(root, `test_c${i}.py`), `import unittest\n\nimport pytest\n\n\n${render(nodes, '', null)}`);
      return `test_c${i}.py`;
    });
    const run = spawnSync('python3', ['-m', 'pytest', '-q', '-rA', '-p', 'no:cacheprovider', '-W', 'ignore'], { cwd: root, encoding: 'utf8', env: { ...process.env, PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1', PYTEST_PLUGINS: '' } });
    const passed = [...run.stdout.matchAll(/^PASSED (\S+)/gm)].map((m) => m[1]!.replace(/\[.*\]$/, ''));
    expect(passed.length, run.stdout.slice(-2000)).toBeGreaterThan(20);
    const listing = JSON.parse(execFileSync('python3', ['-c', 'import json, sys; sys.path.insert(0, sys.argv[1]); import deep_check_pytest as d; print(json.dumps({f: [n for n, _ in d._listing(f)] for f in sys.argv[2:]}))', join(REPO, 'packages/checks-command/runtime/python'), ...files], { cwd: root, encoding: 'utf8' })) as Record<string, string[]>;
    for (const file of files) {
      const theirs = [...new Set(passed.filter((p) => p.startsWith(`${file}::`)).map((p) => p.slice(file.length + 2)))].sort();
      expect(listing[file]!.sort(), readFileSync(join(root, file), 'utf8')).toEqual(theirs);
    }
  }, 120_000);
});

describe('a tool that isn\'t installed', () => {
  it('a command whose program isn\'t on the run\'s PATH can\'t start: the run is missing, naming the program, never uncounted', async () => {
    const r = await runCommandCheck(check(folder({ 'x.txt': '' }), { spec: { ...VITEST, runner: 'no-such-tool run' } }));
    expect(r.outcome, r.mask ?? '').toBe('missing');
    expect(r.failures.map((f) => f.message).join('\n')).toMatch(/no-such-tool/);
  }, 60_000);
});

describe('ordinary projects, however they start their tool', () => {
  const FILES = {
    'package.json': '{ "name": "unit", "private": true, "type": "module", "scripts": { "test": "vitest run" } }\n',
    'a.test.js': `import { expect, test } from 'vitest';\ntest('passes', () => { expect(1).toBe(1); });\ntest('fails', () => { expect(2).toBe(3); });\n`,
  };

  it('Vitest started through npx, which quotes the program it hands its shell, counts its tests', async () => {
    const r = await runCommandCheck(check(folder(FILES, true), { spec: { ...VITEST, runner: 'npx vitest run' } }));
    expect(r.outcome, r.mask ?? r.output.stderr).toBe('failed');
    expect(r.testsRun).toBe(2);
  }, 180_000);

  it('Vitest started through the sh shim pnpm installs counts its tests; a shim with a line pnpm never writes doesn\'t', async () => {
    need('pnpm');
    const checkout = folder(FILES, true);
    // pnpm writes the shim in a folder of its own, linked to the checkout's Vitest; the checkout takes it in place of npm's link.
    const maker = folder({ 'package.json': JSON.stringify({ name: 'maker', private: true, devDependencies: { vitest: `link:${join(checkout, 'node_modules/vitest')}` } }) });
    execFileSync('pnpm', ['install', '--offline'], { cwd: maker, stdio: 'ignore' });
    rmSync(join(checkout, 'node_modules/.bin/vitest'));
    copyFileSync(join(maker, 'node_modules/.bin/vitest'), join(checkout, 'node_modules/.bin/vitest'));
    chmodSync(join(checkout, 'node_modules/.bin/vitest'), 0o755);
    for (const runner of ['pnpm test', 'node_modules/.bin/vitest run']) {
      const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner } }));
      expect(r.outcome, `${runner}: ${r.mask ?? r.output.stderr}`).toBe('failed');
      expect(r.testsRun).toBe(2);
    }
    const shim = join(checkout, 'node_modules/.bin/vitest');
    const text = readFileSync(shim, 'utf8');
    writeFileSync(shim, text.replace('\nif [ -x', '\ncat /etc/hosts > /dev/null\nif [ -x'));
    expect((await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'pnpm test' } }))).outcome).toBe('uncounted');
    // The shim runs a `node` beside it in place of the one on PATH, which (started directly) doesn't hold its folder.
    writeFileSync(shim, text);
    writeFileSync(join(checkout, 'node_modules/.bin/node'), `#!/bin/sh\nexec ${process.execPath} "$@"\n`);
    chmodSync(join(checkout, 'node_modules/.bin/node'), 0o755);
    expect((await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'node_modules/.bin/vitest run' } }))).outcome).toBe('uncounted');
  }, 300_000);

  it('a Vitest older than 5, whose command line has no module cache option, runs and counts its tests', async () => {
    const checkout = folder({
      'package.json': '{ "type": "module" }\n',
      'vitest.config.mjs': 'export default { test: { globals: true } };\n',
      'a.test.js': `test('passes', () => { expect(1).toBe(1); });\ntest('fails', () => { expect(2).toBe(3); });\n`,
      // Vitest 4's entry refuses an option its command line doesn't know; otherwise this one is the repo's Vitest.
      'old/vitest/package.json': '{ "name": "vitest", "version": "4.1.11", "type": "module" }\n',
      'old/vitest/vitest.mjs': `if (process.argv.includes('--no-fsModuleCache')) { console.error('CACError: Unknown option'); process.exit(1); }\nawait import('../../node_modules/vitest/vitest.mjs');\n`,
    }, true);
    const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'node old/vitest/vitest.mjs run' } }));
    expect(r.outcome, r.output.stderr).toBe('failed');
    expect(r.testsRun).toBe(2);
  }, 180_000);

  it('an abstract pytest base class, which pytest never collects, leaves no test out', async () => {
    const r = await runCommandCheck(check(folder({
      'tests/test_shapes.py': 'import abc\n\n\nclass TestBase(abc.ABC):\n    @abc.abstractmethod\n    def make(self):\n        ...\n\n    def test_made(self):\n        assert self.make() == 1\n\n\nclass TestOne(TestBase):\n    def make(self):\n        return 1\n',
    }), { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider tests' } }));
    expect(r.outcome, r.failures.map((f) => f.message).join('\n')).toBe('passed');
    expect(r.testsRun).toBe(1);
  }, 120_000);

  it('a | or ; inside quotes is part of a word, not a pipe or another command; shell syntax is no missing program', () => {
    const cwd = folder({ 'x.txt': '' });
    const path = `${join(REPO, 'node_modules/.bin')}:${join(process.execPath, '..')}:/usr/bin:/bin`;
    for (const command of [`go test -run 'TestA|TestB' ./...`, 'vitest run -t "adds|subtracts"', 'vitest run -t "a; b"', 'vitest run --exit 0']) {
      expect(maskIn(command), command).toBeNull();
    }
    expect(untraced(`vitest run -t 'a|b'`, cwd, path)).toBeNull();
    expect(hiddenChild({ file: '/bin/sh', args: ['-c', `'vitest' run`], shell: false }, cwd, path, process.execPath)).toBeNull();
    // Outside quotes they still are.
    expect(maskIn('go test ./... | tee out')).toBe('| tee');
    expect(maskIn('vitest run; echo done')).toBe('; echo');
    expect(maskIn('vitest run; exit 0')).toBe('exit 0');
    expect(untraced(`vitest run | 'cat'`, cwd, path)).toBe('program cat');
    for (const command of ['(cd sub && npm test)', 'exec npm test']) expect(absent(command, cwd, path), command).toBeNull();
    expect(absent('no-such-tool run', cwd, path)).toBe('no-such-tool');
  });
});

describe('added tests', () => {
  it('Date() without new still gives text on the moved clock, and a run in which one of the added files ran no test ran nothing, naming it', async () => {
    const checkout = project({
      'clock.test.ts': `test('the clock', () => { expect(typeof Date()).toBe('string'); });\n`,
      'idle.test.ts': `test.skip('never runs', () => { expect(1).toBe(1); });\n`,
    });
    const runs = await runAddedTests(check(checkout), ['test/clock.test.ts', 'test/idle.test.ts']);
    expect(runs.map((r) => r.clock)).toEqual([0, 0, 0, 0, 0, expect.any(Number)]);
    expect(runs.map((r) => r.outcome)).toEqual(Array(6).fill('ran_nothing'));
    for (const r of runs) expect(r.evidence).toContain('no test ran in test/idle.test.ts');
    expect(runs.map((r) => r.attempts.filter((a) => a.test.includes('the clock')).map((a) => a.outcome))).toEqual(Array(6).fill(['passed']));
  }, 600_000);

  it('under a vm pool, whose tests keep a clock of their own, the month-ahead run can\'t pass', async () => {
    const checkout = project({ 'clock.test.ts': `test('the clock', () => { expect(typeof Date()).toBe('string'); });\n` }, { 'vitest.config.mjs': `export default { test: { pool: 'vmThreads' } };\n` });
    const runs = await runAddedTests(check(checkout), ['test/clock.test.ts']);
    expect(runs.slice(0, 5).map((r) => r.outcome)).toEqual(Array(5).fill('passed'));
    expect(runs[5]!.outcome).toBe('failed');
    expect(runs[5]!.failures.map((f) => f.message).join('\n')).toMatch(/clock wasn't moved ahead: the vmThreads pool/);
  }, 600_000);
});

describe('programs the tracers can\'t see into', () => {
  it('a Python told to skip its site setup never loads the read tracer, in the command or started by a test', () => {
    const cwd = folder({ 'x.txt': '' });
    const path = '/usr/bin:/bin';
    expect(untraced('python3 -m pytest', cwd, path)).toBeNull();
    for (const command of ['python3 -I -m pytest', 'python3 -Es -m pytest', 'python3 -W error -S x.py']) expect(untraced(command, cwd, path), command).toBe('program python3');
    expect(hiddenChild({ file: '/usr/bin/python3', args: ['-c', 'print(1)'], shell: false, traced: true }, cwd, path, process.execPath)).toBeNull();
    expect(hiddenChild({ file: '/usr/bin/python3', args: ['-I', '-c', 'print(1)'], shell: false, traced: true }, cwd, path, process.execPath)).toBe('untraced program python3');
    expect(untraced('python3 --check-hash-based-pycs default -I x.py', cwd, path)).toBe('program python3');
    expect(untraced('PYTHONPATH= python3 -m pytest', cwd, path)).toBe('python setup PYTHONPATH');
    const fake = folder({ 'tools/python3': '#!/bin/sh\ncat secrets.txt\n' });
    expect(untraced('./tools/python3 -m pytest', fake, path)).toBe('program ./tools/python3');
    // A text file by Python's name, without a `#!` line, is run by the shell, not by Python.
    const text = folder({ 'tools/python3': 'cat secrets.txt\n' });
    expect(hiddenChild({ file: join(text, 'tools/python3'), args: [], shell: false, traced: true }, text, path, process.execPath)).toBe('untraced program python3');
    // Nor is a file the run could have written: one with a Mach-O header the shell runs as a script, or a script named node.
    const fake2 = folder({ 'tools/node': 'cat secrets.txt\n' });
    writeFileSync(join(fake2, 'tools/python3'), Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from('\n/bin/cat secrets.txt\n')]));
    expect(hiddenChild({ file: join(fake2, 'tools/python3'), args: [], shell: false, traced: true }, fake2, path, process.execPath)).toBe('untraced program python3');
    expect(hiddenChild({ file: './tools/node', args: [], shell: false }, fake2, path, process.execPath)).toBe('untraced program node');
    // Nor a link by Node's or Python's name to a program that's neither.
    mkdirSync(join(fake2, 'links'));
    symlinkSync('/bin/sh', join(fake2, 'links/node'));
    symlinkSync('/bin/sh', join(fake2, 'links/python3'));
    expect(hiddenChild({ file: './links/node', args: ['-c', 'cat x'], shell: false }, fake2, path, process.execPath)).toBe('untraced program node');
    expect(hiddenChild({ file: './links/python3', args: ['-c', 'cat x'], shell: false, traced: true }, fake2, path, process.execPath)).toBe('untraced program python3');
    // go test is the check's own command's to judge; started by a child (a package script), it's untraced.
    expect(hiddenChild({ file: '/bin/sh', args: ['-c', 'go test ./...'], shell: false, traced: true }, cwd, path, process.execPath)).toBe('untraced program go');
  });

  it('a program the command names is judged as the run\'s shell finds it, never by a file in node_modules/.bin, which isn\'t on the run\'s PATH', async () => {
    const r = await runCommandCheck(check(folder({
      'data.txt': 'secret-input',
      'node_modules/.bin/cat': '#!/usr/bin/env node\n',
      'test/a.test.mjs': `import test from 'node:test';\ntest('passes', () => {});\n`,
    }), { spec: { ...VITEST, runner: 'cat data.txt && node --test' } }));
    expect(r.outcome).toBe('uncounted');
    expect(r.mask).toBe('untraced program cat');
  }, 120_000);

  it('a venv in the checkout, named by its path, runs with its interpreter\'s install; a venv\'s python the hub finds on its PATH isn\'t swapped for its real file', async () => {
    const checkout = folder({ 'test_ok.py': 'def test_ok():\n    assert 1 + 1 == 2\n' });
    execFileSync('python3', ['-m', 'venv', '--system-site-packages', join(checkout, '.venv')]);
    const inCheckout = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: '.venv/bin/python -m pytest -q -p no:cacheprovider' } }));
    expect(inCheckout.outcome, `${inCheckout.mask} ${inCheckout.output.stderr}`).toBe('passed');
    expect(inCheckout.testsRun).toBe(1);
    const venv = join(dir, `venv-${n++}`);
    execFileSync('python3', ['-m', 'venv', venv]);
    const saved = process.env.PATH;
    process.env.PATH = `${join(venv, 'bin')}:${saved}`;
    try {
      const onPath = await runCommandCheck(check(folder({ 'test_ok.py': 'def test_ok():\n    pass\n' }), { spec: { ...VITEST, runner: 'python3 -m pytest -q' } }));
      expect(onPath.outcome).toBe('uncounted');
      expect(onPath.mask).toBe('venv python3: name the venv\'s program by its path');
    } finally {
      process.env.PATH = saved;
    }
  }, 300_000);

  it('a link in the checkout to another project\'s script grants the run nothing of that project', async () => {
    const other = folder({ 'package.json': '{}\n', 'secret.env': 'TOKEN=other-project', 'scripts/ok.mjs': '#!/usr/bin/env node\n' });
    const checkout = folder({
      'a.test.mjs': `import { readFileSync } from 'node:fs';\nimport test from 'node:test';\ntest('reads', () => { let seen = 'DENIED'; try { seen = readFileSync('${join(other, 'secret.env')}', 'utf8'); } catch {} console.log('LEAK:' + seen); });\n`,
    });
    chmodSync(join(other, 'scripts/ok.mjs'), 0o755);
    symlinkSync(join(other, 'scripts/ok.mjs'), join(checkout, 'setup.mjs'));
    const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: './setup.mjs && node --test a.test.mjs' } }));
    expect(`${r.output.stdout}${r.output.stderr}`).not.toContain('other-project');
    expect(r.outcome).not.toBe('passed');
  }, 120_000);

  it('a pytest or Jest run whose tests its cache chooses (--lf, --sw-skip, onlyFailures) can\'t pass: a test the cache leaves out never ran', async () => {
    const checkout = folder({
      'tests/test_x.py': 'def test_a():\n    pass\n\n\ndef test_b():\n    assert 0\n',
      '.pytest_cache/v/cache/lastfailed': '{"tests/test_x.py::test_a": true}\n',
    });
    const r = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'python3 -m pytest --lf tests' } }));
    expect(r.outcome, r.output.stdout).toBe('failed');
    expect(r.failures.map((f) => f.message).join('\n')).toMatch(/tests chosen from pytest's cache \(--lf\)/);
    const skip = await runCommandCheck(check(checkout, { spec: { ...VITEST, runner: 'python3 -m pytest --sw-skip tests' } }));
    expect(skip.failures.map((f) => f.message).join('\n')).toMatch(/tests chosen from pytest's cache \(--sw-skip\)/);
    // Jest's record of the last run, in a cache folder the checkout's config names: a.test.js failed then, and passes now.
    const jestCheckout = folder({
      'package.json': '{ "name": "unit", "private": true, "jest": { "cacheDirectory": "<rootDir>/.jestcache" } }\n',
      'a.test.js': `test('a', () => { expect(1).toBe(2); });\n`,
      'b.test.js': `test('b', () => { expect(1).toBe(2); });\n`,
    }, true);
    spawnSync(join(jestCheckout, 'node_modules/.bin/jest'), ['a.test.js'], { cwd: jestCheckout });
    writeFileSync(join(jestCheckout, 'a.test.js'), `test('a', () => {});\n`);
    const jest = await runCommandCheck(check(jestCheckout, { spec: { ...VITEST, runner: 'node_modules/.bin/jest --onlyFailures' } }));
    // The runner's --no-cache leaves Jest no record of the last run to choose from: no test runs, and Jest fails.
    expect(jest.testsRun).toBe(0);
    expect(jest.outcome, jest.output.stderr).toBe('failed');
  }, 300_000);

  it('a Python a test starts the usual way, with the run\'s environment, is traced: the run counts and the child\'s read is in its read set', async () => {
    const r = await runCommandCheck(check(folder({
      'data.txt': 'x',
      'test_child.py': 'import subprocess, sys\n\n\ndef test_child():\n    subprocess.run([sys.executable, "-c", "open(\'data.txt\').read()"], check=True)\n',
    }), { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider' } }));
    expect(r.outcome, `${r.mask} ${r.output.stdout}`).toBe('passed');
    expect(r.read).toContain('data.txt');
  }, 120_000);

  it('a Python a test starts with an environment that drops the tracer is never taken as traced, from Python or from Node', async () => {
    const leak = 'import subprocess, sys\nsubprocess.run([sys.executable, "-c", "open(\'data.txt\').read()"], env={"PATH": "/usr/bin:/bin"}, check=True)\n';
    const fromPython = await runCommandCheck(check(folder({ 'data.txt': 'x', 'test_leak.py': `def test_leak():\n    ${leak.trimEnd().split('\n').join('\n    ')}\n` }), { spec: { ...VITEST, runner: 'python3 -m pytest -q' } }));
    expect(fromPython.outcome, fromPython.output.stdout).toBe('uncounted');
    expect(fromPython.mask).toMatch(/^untraced program .*python/);
    const nodeFromPython = await runCommandCheck(check(folder({
      'data.txt': 'x',
      'test_node.py': 'import subprocess\n\n\ndef test_node():\n    subprocess.run(["node", "-e", "require(\'fs\').readFileSync(\'data.txt\')"], env={k: v for k, v in __import__("os").environ.items() if k != "NODE_OPTIONS"}, check=True)\n',
    }), { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider' } }));
    expect(nodeFromPython.outcome, nodeFromPython.output.stdout).toBe('uncounted');
    expect(nodeFromPython.mask).toBe('untraced program node');
    const fromNode = await runCommandCheck(check(folder({
      'data.txt': 'x',
      'test/a.test.mjs': `import { execFileSync, spawnSync } from 'node:child_process';\nimport test from 'node:test';\ntest('reads through python', () => { execFileSync('python3', ['-c', "open('data.txt').read()"], { env: { PATH: process.env.PATH } }); });\n`,
    }), { spec: { ...VITEST, runner: 'python3 --version && node --test' } }));
    expect(fromNode.outcome, fromNode.output.stdout + fromNode.output.stderr).toBe('uncounted');
    expect(fromNode.mask).toBe('untraced program python3');
  }, 300_000);

  it('a pytest session a test runs inside the run (pytester) neither writes into nor closes the run\'s report', async () => {
    const r = await runCommandCheck(check(folder({
      'conftest.py': 'pytest_plugins = ["pytester"]\n',
      'test_inner.py': 'def test_inner(pytester):\n    pytester.makepyfile(test_sample="def test_bad():\\n    assert 0\\n\\ndef test_ok():\\n    pass\\n")\n    pytester.runpytest().assert_outcomes(failed=1, passed=1)\n\n\ndef test_after():\n    pass\n',
    }), { spec: { ...VITEST, runner: 'python3 -m pytest -q -p no:cacheprovider' } }));
    expect(r.outcome, r.output.stdout).toBe('passed');
    expect(r.attempts.map((a) => a.test).sort()).toEqual(['test_after', 'test_inner']);
  }, 300_000);

  it('a program the command names that lies in a shared bin folder grants the run that program, never the folder above it', async () => {
    const home = realpathSync(mkdtempSync(join(dir, 'home-')));
    const peek = (where: string, secret: string): void => {
      mkdirSync(join(where, 'bin'), { recursive: true });
      writeFileSync(secret, 'a secret');
      writeFileSync(join(where, 'bin', `peek-${n++}`), `#!${process.execPath}\nlet seen = 'denied';\ntry { seen = require('node:fs').readFileSync('${secret}', 'utf8'); } catch {}\nconsole.log('PEEK ' + seen);\n`, { mode: 0o755 });
    };
    // The home folder's own bin, and one below it (~/.local/bin, whose ~/.local/share holds the account's data).
    peek(home, join(home, 'secret.txt'));
    mkdirSync(join(home, '.local/share'), { recursive: true });
    peek(join(home, '.local'), join(home, '.local/share/secret.txt'));
    const saved = { HOME: process.env.HOME, PATH: process.env.PATH };
    process.env.HOME = home;
    process.env.PATH = `${join(home, 'bin')}:${join(home, '.local/bin')}:${saved.PATH}`;
    try {
      for (const bin of [join(home, 'bin'), join(home, '.local/bin')]) {
        const program = readdirSync(bin)[0]!;
        const r = await runCommandCheck(check(folder({ 'x.txt': '' }), { spec: { ...VITEST, runner: program } }));
        expect(r.output.stdout, program).toContain('PEEK denied');
      }
    } finally {
      process.env.HOME = saved.HOME;
      process.env.PATH = saved.PATH;
    }
  }, 120_000);

  it('a go test run is placed from its report and fails, but its pass is never counted: no tracer saw what it read', async () => {
    need('go');
    const failing = await runCommandCheck(check(folder({
      'go.mod': 'module example.com/shop\n\ngo 1.21\n',
      'cart/cart_test.go': 'package cart\n\nimport "testing"\n\nfunc TestTotal(t *testing.T) {\n\tt.Errorf("total %d, want 12", 11)\n}\n\nfunc TestNil(t *testing.T) {}\n',
    }), { spec: { ...VITEST, runner: 'go test ./...' } }));
    expect(failing.outcome, failing.output.stderr).toBe('failed');
    expect(failing.testsRun).toBe(2);
    expect(failing.failures).toEqual([expect.objectContaining({ test: 'TestTotal', file: 'cart/cart_test.go', line: 6, assertion: true })]);
    const passing = await runCommandCheck(check(folder({ 'go.mod': 'module example.com/p\n\ngo 1.21\n', 'p_test.go': 'package p\n\nimport "testing"\n\nfunc TestOK(t *testing.T) {}\n' }), { spec: { ...VITEST, runner: 'go test ./...' } }));
    expect(passing.testsRun).toBe(1);
    expect(passing.outcome).toBe('uncounted');
    expect(passing.mask).toBe('untraced program go');
  }, 300_000);
});

describe('Jest', () => {
  it('runs each test file with a clock of its own, so the month-ahead run can\'t pass', async () => {
    const checkout = folder({ 'package.json': '{ "name": "unit", "private": true }\n', 'clock.test.js': 'test(\'the clock\', () => { expect(typeof Date()).toBe(\'string\'); });\n' }, true);
    const runs = await runAddedTests(check(checkout, { spec: { ...VITEST, runner: 'node_modules/.bin/jest' } }), ['clock.test.js']);
    expect(runs.slice(0, 5).map((r) => r.outcome)).toEqual(Array(5).fill('passed'));
    expect(runs[5]!.outcome).toBe('failed');
    expect(runs[5]!.failures.map((f) => f.message).join('\n')).toMatch(/clock wasn't moved ahead: Jest/);
  }, 600_000);
});
