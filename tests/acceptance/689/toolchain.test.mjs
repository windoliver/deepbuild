// Criterion 1: `rustc --version` run at the repository root reports 1.99.1.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { root } from './helpers.mjs';

test('criterion 1: rustc --version at the repository root reports 1.99.1', () => {
  const env = { ...process.env, RUSTUP_AUTO_INSTALL: '0' };
  // Only the checkout's own pin may choose the compiler, never the caller's override.
  delete env.RUSTUP_TOOLCHAIN;
  const result = spawnSync('rustc', ['--version'], { cwd: root, env, encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? result.error.message : ''}`.trim();
  assert.match(result.stdout ?? '', /^rustc 1\.99\.1[ \n]/, `rustc --version at ${root} printed: ${output}`);
});
