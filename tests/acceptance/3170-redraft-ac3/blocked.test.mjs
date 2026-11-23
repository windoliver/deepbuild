// AC3 (#3170.618b6b1f): on a Linux machine without a reflink folder, deep-hook's copy-on-write cli test still reads
// BLOCKED and names the fix, as today. The issue's command, `cargo test -p deep-hook --test cli --locked`, runs here
// on that one test, with DEEP_TEST_COW_DIR naming a folder this test makes on tmpfs, which makes no reflink copy:
// the folder such a machine has. The test must not pass, and its failure must be the BLOCKED that names the fix.
import assert from 'node:assert/strict';
import test from 'node:test';
import { COW_TEST, elsewhere, folderWithoutReflink, MINUTES, panicOf, PLATFORM, reflinks, run } from './helpers.mjs';

test('#3170.618b6b1f on a Linux machine without a reflink folder, the copy-on-write cli test still reads BLOCKED and names the fix', MINUTES, async (t) => {
  if (process.platform !== 'linux') return t.skip(elsewhere('Linux, the only platform deep-hook\'s copy-on-write cli test is compiled for'));
  const folder = folderWithoutReflink(t);
  if (!folder) return t.skip(elsewhere('a tmpfs at /dev/shm, a folder that makes no reflink copy'));
  if (reflinks(folder)) return t.skip(`INCONCLUSIVE (platform): ${folder} on this machine (${PLATFORM}) makes a reflink copy, so it can't stand for a machine without one; it is unrun here`);

  // A machine without a reflink folder: the only folder named is one that can't make one.
  const env = { ...process.env };
  delete env.DEEP_TEST_COW_DIR;
  env.DEEP_TEST_COW_DIR = folder;
  const { status, signal, output } = await run(t, ['cargo', 'test', '-p', 'deep-hook', '--test', 'cli', '--locked', '--', '--exact', COW_TEST], { env });

  // Reaching the test is setup, not proof: a build that fails or a target that's gone throws, never asserts.
  if (signal !== null || !/Running tests\/cli\.rs/.test(output)) throw new Error(`cargo never ran deep-hook's cli target (status ${status}, signal ${signal}):\n${output.slice(-3000)}`);

  const verdict = output.match(new RegExp(`^test ${COW_TEST} \\.\\.\\. (\\S+)`, 'm'))?.[1];
  assert.equal(verdict, 'FAILED', `the copy-on-write test must not pass, or go unrun, where ${folder} can't make a reflink copy; it read ${verdict ?? 'nothing'}:\n${output.slice(-3000)}`);
  assert.notEqual(status, 0, 'the cli target exits nonzero: nothing unrun passes');

  const message = panicOf(output, COW_TEST);
  assert.ok(message, `the copy-on-write test panicked with a message:\n${output.slice(-3000)}`);
  assert.match(message, /^BLOCKED: /, `the copy-on-write test reads BLOCKED, not another failure: ${message}`);
  assert.match(message, /DEEP_TEST_COW_DIR/, `BLOCKED names the fix, the variable to set: ${message}`);
  assert.match(message, /reflink/, `BLOCKED names the fix, a folder with reflink: ${message}`);
  assert.ok(message.includes(folder), `BLOCKED names the folder this machine offered, ${folder}, as today: ${message}`);
});
