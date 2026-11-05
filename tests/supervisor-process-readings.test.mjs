// Shared process readers must observe a real owned child, not just agree with each other's implementation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { alive, groupCpu, groupMembers } from '@deepbuild/supervisor';

test('shared process readers observe a child and its process group until it exits', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000);'], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  try {
    await once(child.stdout, 'data');
    const pid = child.pid;
    assert.equal(typeof pid, 'number');
    assert.equal(alive(pid), true);
    assert.equal(alive(-pid), true, 'the detached child leads its own process group');
    assert.ok((await groupMembers(pid)).includes(pid), 'the system process table contains the owned child');
    assert.match(await groupCpu(pid), /\d/, 'the system reports actual CPU-time fields, not missing data');
    child.kill('SIGTERM');
    await exited;
    assert.equal(alive(pid), false);
    assert.equal(alive(-pid), false);
    assert.deepEqual(await groupMembers(pid), []);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
  }
});
