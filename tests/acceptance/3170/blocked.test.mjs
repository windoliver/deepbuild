// AC3 (#3170.618b6b1f): on a Linux machine without a reflink folder, the copy-on-write test still reads BLOCKED and
// names the fix, as today. That machine is this one with DEEP_TEST_COW_DIR naming a folder whose file system makes no
// reflink copy (shown first with cp), set in the test's own environment, where it wins over a machine's cargo config.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CLI_TARGET, COW_TEST, elsewhere, MINUTES, noReflinkFolder, run, sandbox, tail } from './helpers.mjs';

test('#3170.618b6b1f on Linux, given a folder that can\'t make a reflink copy, the copy-on-write test reads BLOCKED and names the fix', MINUTES, async (t) => {
  if (process.platform !== 'linux') return t.skip(elsewhere('Linux'));
  const box = sandbox(t);
  const folder = await noReflinkFolder(t);
  if (!folder) return t.skip('INCONCLUSIVE (platform): /var/tmp, the temporary folder and /dev/shm all make a reflink copy here, so this machine has no folder without one; it is unrun here');
  const ran = await run([...CLI_TARGET, '--', '--exact', COW_TEST], { env: { ...box.env, DEEP_TEST_COW_DIR: folder }, box });
  const lines = ran.output.split('\n');
  assert.equal(lines.find((line) => line.startsWith(`test ${COW_TEST} ... `)), `test ${COW_TEST} ... FAILED`, `with DEEP_TEST_COW_DIR=${folder}, which can't reflink, ${COW_TEST} never passes or skips:\n${tail(ran.output)}`);
  assert.notEqual(ran.status, 0, `the cli target's run fails:\n${tail(ran.output)}`);
  const said = lines.find((line) => line.startsWith('BLOCKED: '));
  assert.ok(said, `its panic reads BLOCKED:\n${tail(ran.output)}`);
  assert.ok(said.startsWith(`BLOCKED: ${folder} `), `it names the folder that can't reflink, ${folder}: ${said}`);
  assert.match(said, /\bDEEP_TEST_COW_DIR\b/, `it names the variable to set: ${said}`);
  assert.match(said, /\b(?:btrfs|XFS)\b/i, `it names a file system with reflink: ${said}`);
});
