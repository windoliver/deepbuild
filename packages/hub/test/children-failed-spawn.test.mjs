// #1906: a synchronous spawn failure owns no child and cannot leak a permanent entry in the exit table.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { trackedChildren } from '../dist/children.js';

test('a spawn that throws E2BIG leaves no phantom child', async () => {
  const before = trackedChildren();
  assert.throws(() => spawn(process.execPath, ['-e', ' '.repeat(4 * 1024 * 1024)]), { code: 'E2BIG' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(trackedChildren(), before);
});
