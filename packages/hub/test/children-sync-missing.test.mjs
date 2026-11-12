// A refused synchronous start is an attempted call, not process 0 (the caller's group).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { trackedSyncChildren } from '../dist/children.js';

test('a missing synchronous executable is never registered as PID zero', () => {
  const result = spawnSync('/no-such-program-1906');
  assert.equal(result.error.code, 'ENOENT');
  assert.ok(trackedSyncChildren().every(child => child.pid === undefined || child.pid > 0));
});
