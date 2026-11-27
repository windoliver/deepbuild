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

const write = (root, files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};

test('a twin of spawned test-path code that is the change itself is run and fails the test, never proves it', { timeout: 600_000 }, (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-twin-test-path-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const git = (...args) => execFileSync('git', [...GIT, ...args], { cwd: repo, stdio: 'ignore' });
  write(repo, { 'tests/tools/sum.mjs': tool('const value = a + b + 1;') });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'change');
  write(repo, {
    'tests/tools/sum.mjs': RIGHT,
    [TEST]: `import assert from 'node:assert/strict';\nimport { spawnSync } from 'node:child_process';\nimport test from 'node:test';\nimport { fileURLToPath } from 'node:url';\n\ntest(${JSON.stringify(`${TAG} two and three sum to five`)}, () => {\n  assert.equal(spawnSync(process.execPath, [fileURLToPath(new URL('../../tools/sum.mjs', import.meta.url)), '2', '3'], { encoding: 'utf8' }).stdout, '5\\n');\n});\n`,
    'tests/acceptance/9690/twins/same-as-change/tests/tools/sum.mjs': RIGHT,
    'tests/acceptance/9690/twins.json': `${JSON.stringify({ [TAG]: ['same-as-change'] })}\n`,
  });
  git('add', '-A');
  git('commit', '-qm', 'Fix the sum tool\n\nPart of #9690');
  write(dir, { 'issues/9690.md': `Planted.\n\n### Acceptance criteria\n- [ ] ${CRITERION}\n` });
  const env = { ...process.env, HOME: join(dir, 'home'), DEEP_PROOF_ISSUES: join(dir, 'issues') };
  for (const name of ['NODE_TEST_CONTEXT', 'NODE_V8_COVERAGE', 'DEEP_OPEN_ISSUES', 'DEEP_APPROVERS', 'DEEP_THROTTLE', 'DEEP_PREFLIGHT']) delete env[name];
  const result = spawnSync(process.execPath, [join(CHECKOUT, 'scripts/proof.mjs'), 'before'], { cwd: repo, env, encoding: 'utf8', timeout: 540_000 });
  const lines = result.stdout.split('\n').filter((line) => line.includes(` before: ${TEST} › ${TAG} `));
  const said = `exit ${result.status}\n${result.stdout}\n${result.stderr.slice(-3000)}`;
  assert.deepEqual(lines.filter((line) => line.startsWith('PASS ')), [], said);
  assert.ok(lines.some((line) => line.startsWith('FAIL before: ') && line.endsWith(`${TAG}: fails on neither the merge base nor its planted wrong program`)), said);
  assert.notEqual(result.status, 0, said);
});
