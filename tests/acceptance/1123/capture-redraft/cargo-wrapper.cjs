#!/usr/bin/env node
// Test-only tool boundary: forward real Cargo's arguments, output and status unchanged.
// Delay returning a successful build/test until another real Cargo has rewritten the
// fixture's shared binary. No owned JS module is replaced, and no process is signalled.
const { spawnSync } = require('node:child_process');
const { appendFileSync, existsSync, readFileSync, realpathSync } = require('node:fs');
const { dirname, join, sep } = require('node:path');
const args = process.argv.slice(2);
const real = process.env.CAPTURE_CARGO;
function run(argv, options = {}) {
  const result = spawnSync(real, argv, { stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) {
    console.error('BLOCKED capture: real Cargo did not complete', result.error?.code ?? result.signal ?? result.status);
    process.exit(result.status || 1);
  }
  return result;
}
run(args);
if (!args.some((arg) => arg === 'build' || arg === 'test')) process.exit(0);
const at = args.indexOf('--manifest-path');
const manifest = at >= 0 ? args[at + 1] : args.find((arg) => arg.startsWith('--manifest-path='))?.split('=').slice(1).join('=');
const located = run(['locate-project', '--workspace', '--message-format', 'plain',
  ...(manifest ? ['--manifest-path', manifest] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const cwd = realpathSync(dirname(located.stdout.trim()));
const sandbox = realpathSync(process.env.CAPTURE_SANDBOX);
if (!cwd.startsWith(sandbox + sep) || !existsSync(join(cwd, 'capture-fixture.json'))) {
  console.error('BLOCKED capture: refusing to race outside this test-owned workspace');
  process.exit(1);
}
const shared = join(cwd, 'target', 'debug', 'deep-hook');
const version = () => {
  const result = spawnSync(shared, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) throw Error('BLOCKED capture: competing executable did not run');
  return result.stdout.trim();
};
// Two distinct versions guarantee an observed rewrite even if the run used a
// private target and never published anything in the shared target at all.
for (const [opponent, expected] of [['opponent-a', '8.8.1123'], ['opponent-b', '9.9.1123']]) {
  run(['build', '--offline', '--locked', '--manifest-path', join(sandbox, opponent, 'Cargo.toml'),
    '--target-dir', join(cwd, 'target'), '-p', 'deep-hook']);
  const observed = version();
  if (observed !== expected) throw Error('INCONCLUSIVE capture: competing Cargo did not publish its own version');
}
const sourceVersion = readFileSync(join(cwd, 'crates/deep-hook/Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)[1];
appendFileSync(join(sandbox, 'races.jsonl'), JSON.stringify({ cwd, sourceVersion,
  first: '8.8.1123', last: version(), ownCargoSucceeded: true }) + '\n');
