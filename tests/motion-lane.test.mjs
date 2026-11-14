// The motion lane's script (scripts/motion.mjs) when it can't run: its line names the BLOCKED state first, as the
// lanes read a state, and the script ends without a crash.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/motion.mjs', import.meta.url));

test('with no deep-drive built, the motion lane says BLOCKED on one line and exits non-zero', () => {
  // Failed on a script that left the spawn error unhandled: Node printed a stack and no BLOCKED line.
  const cwd = mkdtempSync(join(tmpdir(), 'motion-lane-test-'));
  try {
    const run = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    const lines = run.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `stdout: ${run.stdout}\nstderr: ${run.stderr}`);
    assert.match(lines[0], /^BLOCKED motion: .*; pacing not measured$/);
    assert.doesNotMatch(run.stderr, /Unhandled 'error' event/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
