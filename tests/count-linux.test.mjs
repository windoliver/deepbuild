// scripts/count-linux.c, through measureOnce, on a Linux host that lets a process count its own instructions (#2960):
// a setuid program the command runs is counted, and a run the counter didn't see all of gives no count.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { measureOnce } from '../scripts/benchmark.mjs';

const level = process.platform === 'linux' ? Number(readFileSync('/proc/sys/kernel/perf_event_paranoid', 'utf8')) : NaN;
const skip = process.platform !== 'linux' ? 'Linux only' : level > 2 ? `kernel.perf_event_paranoid is ${level}: counting is forbidden here` : false;
const SETUID = '/usr/bin/passwd';
// Setuid root, and no SELinux in force: under no new privileges SELinux refuses passwd's domain change outright.
const setuid = () => {
  if (!existsSync(SETUID)) return `no ${SETUID}`;
  const { mode, uid } = statSync(SETUID);
  if (!(mode & 0o4000) || uid !== 0) return `${SETUID} isn't setuid root here`;
  if (existsSync('/sys/fs/selinux/enforce') && readFileSync('/sys/fs/selinux/enforce', 'utf8').trim() === '1') return 'SELinux is enforcing';
  return false;
};
const fixture = (name, directory) => {
  const program = join(directory, name);
  execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', program, new URL(`fixtures/count-linux-${name}.c`, import.meta.url).pathname]);
  return program;
};
const inTemp = (body) => {
  const directory = mkdtempSync(join(tmpdir(), 'count-linux-'));
  try {
    body(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('a setuid program the command runs is counted as a plain copy of it is', { skip: skip || setuid() }, () => inTemp((directory) => {
  const copy = join(directory, 'passwd');
  copyFileSync(SETUID, copy);
  const raised = measureOnce(['sh', '-c', `${SETUID} --help >/dev/null`], directory);
  const plain = measureOnce(['sh', '-c', `${copy} --help >/dev/null`], directory);
  assert.equal(raised.status, 0, `${SETUID} --help failed: ${JSON.stringify(raised)}`);
  assert.equal(plain.status, 0, `a plain copy of ${SETUID} failed: ${JSON.stringify(plain)}`);
  assert.ok(plain.instructions > 0, `the plain copy's run gives no count: ${JSON.stringify(plain)}`);
  assert.ok(raised.instructions !== null && Math.abs(raised.instructions - plain.instructions) < plain.instructions * 0.05,
    `${SETUID} --help counts ${raised.instructions} (${JSON.stringify(raised.uncounted)}) and a plain copy of it ${plain.instructions}: the setuid program's work must be in the count`);
}));

test('a counter that pinned events keep off the command gives no count', { skip }, () => inTemp((directory) => {
  const run = measureOnce([fixture('pin', directory)], directory);
  assert.equal(run.status, 0, `the pinning program failed: ${JSON.stringify(run)}`);
  assert.equal(run.instructions, null, `a counter kept off the command for its run counts ${run.instructions}: it must give no count`);
  assert.match(run.uncounted.join(' '), /wasn't on the command/);
}));

test('a program the command may run but not read, which the kernel stops counting, gives no count', { skip }, () => inTemp((directory) => {
  const busy = fixture('busy', directory);
  chmodSync(busy, 0o111);
  const run = measureOnce(['sh', '-c', busy], directory);
  assert.equal(run.status, 0, `the unreadable program failed: ${JSON.stringify(run)}`);
  assert.equal(run.instructions, null, `a run whose program the kernel stopped counting counts ${run.instructions}: it must give no count`);
  assert.match(run.uncounted.join(' '), /wasn't on the command/);
}));
