// Opt-in acceptance test for issue #80: the screen recordings the decision record names, which
// stay outside the repo because they can show personal data. Run it by hand on the machine that
// holds them:
//   DEEP_SPIKE80_RECORDINGS=<folder> node --test tests/acceptance/80/spike.live.test.mjs
// The folder holds each recording as <sha256>.mp4 or <sha256>.mov. Without it, or with a
// recording missing, the test fails with BLOCKED in its message; nothing skips. It checks that
// each file is the one the record names and is whole; what each recording shows is for the
// person reviewing the spike to watch.
import assert from 'node:assert/strict';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { id, loadSpike, mediaProblems, root, sha256 } from './helpers.mjs';

const EXTENSIONS = { 'video/mp4': '.mp4', 'video/quicktime': '.mov' };

test(`${['held', 'wake', 'typed', 'verdict', 'window', 'codexHold', 'cap', 'codexApp', 'route'].map(id).join(' ')} every recording the decision names is kept outside the repo, whole, with the hash and size the record gives`, () => {
  const folder = process.env.DEEP_SPIKE80_RECORDINGS;
  if (!folder || !existsSync(folder)) assert.fail('BLOCKED: set DEEP_SPIKE80_RECORDINGS to the folder that holds the spike\'s recordings');
  const real = realpathSync(folder);
  assert.ok(!`${real}/`.startsWith(`${root}/`), 'the recordings folder is outside the repo checkout');
  const { record } = loadSpike();
  const recordings = new Map();
  for (const entry of Object.values(record.criteria ?? {})) for (const finding of entry?.findings ?? []) if (finding?.recording) recordings.set(finding.recording.sha256, finding.recording);
  assert.ok(recordings.size > 0, 'BLOCKED: the decision names no recording');
  for (const { sha256: hash, bytes, type } of recordings.values()) {
    const path = join(real, `${hash}${EXTENSIONS[type] ?? ''}`);
    if (!existsSync(path)) assert.fail(`BLOCKED: recording ${hash} (${type}) is not in ${folder}`);
    assert.equal(statSync(path).size, bytes, `${path} has the size the record gives`);
    assert.equal(sha256(path), hash, `${path} has the hash the record gives`);
    assert.deepEqual(mediaProblems(path), [], `${path} is whole`);
  }
});
