// An unreadable OS process table is unknown, not an empty group or a zero-work CPU reading.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { alive, groupCpu, groupMembers } from '@deepbuild/supervisor';

test('process observations preserve unknown when the OS refuses a read', async () => {
  const child = childProcess.spawn(process.execPath, ['-e', 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000);'], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  const execFile = childProcess.execFile;
  const kill = process.kill;
  try {
    await once(child.stdout, 'data');
    const pid = child.pid;
    assert.equal(alive(pid), true);
    // Inject failure only at the external OS-command boundary; the readers and their parsers are real.
    childProcess.execFile = (file, args, options, done) => {
      if (file !== '/bin/ps') return execFile(file, args, options, done);
      queueMicrotask(() => done(Object.assign(new Error('process table unavailable'), { code: 'EACCES' }), '', ''));
      return undefined;
    };
    syncBuiltinESMExports();
    assert.equal(await groupMembers(pid), null, 'a failed listing cannot prove an empty process group');
    assert.equal(await groupCpu(pid), null, 'two missing CPU readings cannot prove inactivity');
    process.kill = (id, signal) => {
      if (id !== pid || signal !== 0) return kill(id, signal);
      throw Object.assign(new Error('observation refused'), { code: 'EACCES' });
    };
    assert.equal(alive(pid), true, 'only ESRCH proves a process gone; other errors retain it');
  } finally {
    process.kill = kill;
    childProcess.execFile = execFile;
    syncBuiltinESMExports();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  }
});
