// scripts/count-linux.c, through measureOnce, on a Linux host that lets a process count its own instructions (#2960):
// a setuid program the command runs is counted, and a counter kept off the command gives no count.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { measureOnce } from '../scripts/benchmark.mjs';

const level = process.platform === 'linux' ? Number(readFileSync('/proc/sys/kernel/perf_event_paranoid', 'utf8')) : NaN;
const skip = process.platform !== 'linux' ? 'Linux only' : level > 2 ? `kernel.perf_event_paranoid is ${level}: counting is forbidden here` : false;
const SETUID = '/usr/bin/passwd';

test('a setuid program the command runs is counted as a plain copy of it is', { skip: skip || (!existsSync(SETUID) && `no ${SETUID}`) }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'count-linux-'));
  try {
    const copy = join(directory, 'passwd');
    copyFileSync(SETUID, copy);
    const setuid = measureOnce(['sh', '-c', `${SETUID} --help >/dev/null`], directory);
    const plain = measureOnce(['sh', '-c', `${copy} --help >/dev/null`], directory);
    assert.ok(plain.instructions > 0, `the plain copy's run gives no count: ${JSON.stringify(plain)}`);
    assert.ok(setuid.instructions !== null && Math.abs(setuid.instructions - plain.instructions) < plain.instructions * 0.05,
      `${SETUID} --help counts ${setuid.instructions} (${JSON.stringify(setuid.uncounted)}) and a plain copy of it ${plain.instructions}: the setuid program's work must be in the count`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a counter that pinned events keep off the command gives no count', { skip }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'count-linux-'));
  try {
    const pin = join(directory, 'pin');
    execFileSync('cc', ['-O2', '-Wall', '-Werror', '-o', pin, new URL('fixtures/count-linux-pin.c', import.meta.url).pathname]);
    const run = measureOnce([pin], directory);
    assert.equal(run.status, 0, `the pinning program failed: ${JSON.stringify(run)}`);
    assert.equal(run.instructions, null, `a counter kept off the command for its run counts ${run.instructions}: it must give no count`);
    assert.match(run.uncounted.join(' '), /wasn't on the command/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
