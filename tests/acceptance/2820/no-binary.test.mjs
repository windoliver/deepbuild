// #2820 AC4: a run whose selected tests build no Rust binary, and read none through DEEP_BIN_DIR, takes no build grant.
// Written blind from issue #2820 at base f17fa347c (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, evidence, fixture, plain, prints, record, sandbox, TEST, throttleLog, workspace } from './helpers.mjs';

const FILE = 'tests/fixture-2820/plain.test.mjs';

test('#2820.AC4 a run whose selected tests build no Rust binary and read none through DEEP_BIN_DIR takes no build grant', TEST, async (t) => {
  const box = sandbox(t);
  // The repository has a Cargo workspace, but the selected test neither builds nor reads a binary.
  const fx = fixture(box, {
    ...workspace(box, { 'fixture-a': prints('fixture-a') }),
    [FILE]: plain(FILE),
  });
  const run = await affected(box, fx, [FILE]);
  const all = evidence(run, box, fx);
  const log = throttleLog(box);
  assert.ok(record(fx).some((e) => e.event === 'start'), `the planted test never ran, so the run proves nothing\n${all}`);
  assert.ok(log.some((e) => e.event === 'granted' && e.class === 'test' && e.grant === 'top-level'), `the run took no test grant in its table, so its log proves nothing\n${all}`);
  assert.deepEqual(log.filter((e) => e.class === 'build' && (e.event === 'granted' || e.event === 'timeout')), [], `the run asked its table for a build grant\n${all}`);
});
