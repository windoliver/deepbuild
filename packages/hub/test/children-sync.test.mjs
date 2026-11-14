// #1906: synchronous children keep the original API while their invocation is owned through its completion turn.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import * as children from '../dist/children.js';

test('every synchronous process API records the real child and preserves output or error', async () => {
  assert.equal(typeof children.trackedSyncChildren, 'function', 'children.ts needs the synchronous side of its exit table');
  assert.equal(execFileSync(process.execPath, ['-e', 'process.stdout.write("file")'], { encoding: 'utf8' }), 'file');
  assert.equal(spawnSync(process.execPath, ['-e', 'process.exit(7)']).status, 7);
  assert.equal(execSync('printf shell', { encoding: 'utf8' }), 'shell');
  assert.throws(() => execFileSync(process.execPath, ['-e', 'process.exit(9)']), { status: 9 });
  const held = children.trackedSyncChildren();
  assert.equal(held.length, 4);
  assert.ok(held.every(child => Number.isSafeInteger(child.pid) && child.pid > 0));
  assert.equal(new Set(held.map(child => child)).size, 4);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(children.trackedSyncChildren(), []);
});
