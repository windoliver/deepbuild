import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'command must finish');
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}
for (const argument of ['--help', '--version', '--unsupported']) {
  const source = run(process.execPath, ['--disable-warning=ExperimentalWarning', 'packages/cli/src/main.ts', argument]);
  const built = run(process.execPath, ['packages/cli/dist/main.js', argument]);
  assert.deepEqual(built, source, `built/source CLI parity for ${argument}`);
}
const cli = run(process.execPath, ['packages/cli/dist/main.js', '--version']);
const hook = run('target/debug/deep-hook', ['--version']);
assert.deepEqual(cli, { status: 0, stdout: version, stderr: '' });
assert.deepEqual(hook, cli, 'CLI and hook must report the same package version');
console.log('PASS built/source CLI parity and cross-binary version agreement');
