// #1906: children.ts owns the table for direct and indirect core-thread starts until exit notification completes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as children from '../dist/children.js';

test('the core child table registers a direct spawn and keeps its actual object through the exit event', async () => {
  assert.equal(typeof children.trackedChildren, 'function', 'children.ts must expose the table the core audits at exit');
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready");setTimeout(() => process.exit(7), 20)'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    child.once('spawn', () => {
      try { assert.ok(children.trackedChildren().includes(child)); } catch (error) { reject(error); }
    });
    child.once('error', reject);
    child.once('exit', code => {
      try {
        assert.equal(code, 7);
        assert.ok(children.trackedChildren().includes(child), 'exit listeners still see this process in its owner table');
        resolve();
      } catch (error) { reject(error); }
    });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!children.trackedChildren().includes(child), 'an exited child is removed after the notification turn');
});
