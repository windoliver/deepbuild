import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const CRITERION = 'The sum tool adds its two numbers';
const TAG = `#9690.${createHash('sha256').update(CRITERION).digest('hex').slice(0, 8)}`;
const TEST = 'tests/acceptance/9690/sum.test.mjs';
const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
const tool = (line) => `const [a, b] = process.argv.slice(2).map(Number);\n${line}\nprocess.stdout.write(\`\${value}\\n\`);\n`;
const RIGHT = tool('const value = a + b;');
const WRONG = tool('const value = a + b + 1;');
const SPAWNS = (path) => `import assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\nimport test from 'node:test';\nimport { fileURLToPath } from 'node:url';\n\ntest(${JSON.stringify(`${TAG} two and three sum to five`)}, () => {\n  assert.equal(spawnSync(process.execPath, [fileURLToPath(new URL('../../../${path}', import.meta.url)), '2', '3'], { encoding: 'utf8' }).stdout, '5\\n');\n});\n`;

const write = (root, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};

function before(t, { base, change, twin }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-twin-test-path-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const git = (...args) => execFileSync('git', [...GIT, ...args], { cwd: repo, stdio: 'ignore' });
  write(repo, base);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  write(repo, { ...change, ...Object.fromEntries(Object.entries(twin).map(([path, text]) => [`tests/acceptance/9690/twins/planted/${path}`, text])), 'tests/acceptance/9690/twins.json': `${JSON.stringify({ [TAG]: ['planted'] })}\n` });
  git('add', '-A');
  git('commit', '-qm', 'Fix the sum tool\n\nPart of #9690');
  write(dir, { 'issues/9690.md': `Planted.\n\n### Acceptance criteria\n- [ ] ${CRITERION}\n` });
  const env = { ...process.env, HOME: join(dir, 'home'), DEEP_PROOF_ISSUES: join(dir, 'issues') };
  for (const name of ['NODE_TEST_CONTEXT', 'NODE_V8_COVERAGE', 'DEEP_OPEN_ISSUES', 'DEEP_APPROVERS', 'DEEP_THROTTLE', 'DEEP_PREFLIGHT']) delete env[name];
  const result = spawnSync(process.execPath, [join(CHECKOUT, 'scripts/proof.mjs'), 'before'], { cwd: repo, env, encoding: 'utf8', timeout: 540_000 });
  const lines = result.stdout.split('\n').filter((line) => line.includes(` before: ${TEST} › ${TAG} `));
  const said = `exit ${result.status}\n${result.stdout}\n${result.stderr.slice(-3000)}`;
  assert.deepEqual(lines.filter((line) => line.startsWith('PASS ')), [], said);
  assert.notEqual(result.status, 0, said);
  return { lines, said };
}

const refused = (t, fixture, ...named) => {
  const { lines, said } = before(t, fixture);
  assert.ok(lines.some((line) => line.startsWith('FAIL before: ') && line.includes('planted replaces files under the test paths') && named.every((part) => line.includes(part))), said);
};

test('a twin of spawned test-path code that is the change itself is run and fails the test, never proves it', { timeout: 600_000 }, (t) => {
  const { lines, said } = before(t, { base: { 'tests/tools/sum.mjs': WRONG }, change: { 'tests/tools/sum.mjs': RIGHT, [TEST]: SPAWNS('tests/tools/sum.mjs') }, twin: { 'tests/tools/sum.mjs': RIGHT } });
  assert.ok(lines.some((line) => line.startsWith('FAIL before: ') && line.endsWith(`${TAG}: fails on neither the merge base nor its planted wrong program`)), said);
});

test('a twin under the test paths that throws its own assertion, in a module the test loads by a URL the lane does not read, proves nothing', { timeout: 600_000 }, (t) => {
  const loads = `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\ntest(${JSON.stringify(`${TAG} two and three sum to five`)}, async () => {\n  const url = new URL('../../tools/plug.mjs', import.meta.url);\n  await import(url.href);\n  assert.ok(true);\n});\n`;
  const { lines, said } = before(t, { base: { 'tests/tools/plug.mjs': 'export {};\n' }, change: { 'tests/tools/plug.mjs': 'export const ok = true;\n', [TEST]: loads }, twin: { 'tests/tools/plug.mjs': "import assert from 'node:assert/strict';\nassert.fail('planted');\n" } });
  assert.ok(lines.some((line) => line.startsWith('FAIL before: ') && line.endsWith(`${TAG}: fails on neither the merge base nor its planted wrong program`)), said);
});

test('a twin of a setup file a runner config names is refused', { timeout: 600_000 }, (t) => {
  const config = "export default { test: { setupFiles: ['./tests/setup.mjs'] } };\n";
  refused(t, { base: { 'tests/tools/sum.mjs': WRONG, 'vitest.config.mjs': config, 'tests/setup.mjs': 'export {};\n' }, change: { 'tests/tools/sum.mjs': RIGHT, 'tests/setup.mjs': 'export const set = 1;\n', [TEST]: SPAWNS('tests/tools/sum.mjs') }, twin: { 'tests/setup.mjs': "throw new Error('planted');\n" } }, 'tests/setup.mjs');
});

test('a twin of a script under a fixtures folder is refused as test data', { timeout: 600_000 }, (t) => {
  refused(t, { base: { 'tests/fixtures/sum.mjs': WRONG }, change: { 'tests/fixtures/sum.mjs': RIGHT, [TEST]: SPAWNS('tests/fixtures/sum.mjs') }, twin: { 'tests/fixtures/sum.mjs': WRONG } }, 'tests/fixtures/sum.mjs');
});

test('a twin is refused while an import of its tests under the test paths does not resolve, naming it', { timeout: 600_000 }, (t) => {
  const imports = SPAWNS('tests/tools/sum.mjs').replace("import test from 'node:test';", "import test from 'node:test';\nif (process.env.NEVER_SET_9690) await import('../../tools/gone.mjs');");
  refused(t, { base: { 'tests/tools/sum.mjs': WRONG }, change: { 'tests/tools/sum.mjs': RIGHT, [TEST]: imports }, twin: { 'tests/tools/sum.mjs': WRONG } }, 'tests/tools/sum.mjs', "don't resolve");
});

test('a twin of a helper its test imports under another case is refused', { timeout: 600_000 }, (t) => {
  const imports = SPAWNS('tests/tools/sum.mjs').replace("import test from 'node:test';", "import test from 'node:test';\nimport { sum } from '../../tools/sum.mjs';\nvoid sum;");
  refused(t, { base: { 'tests/tools/sum.mjs': `${WRONG}export const sum = 0;\n` }, change: { 'tests/tools/sum.mjs': `${RIGHT}export const sum = 0;\n`, [TEST]: imports }, twin: { 'tests/Tools/sum.mjs': `${WRONG}export const sum = 0;\n` } }, 'tests/Tools/sum.mjs');
});
