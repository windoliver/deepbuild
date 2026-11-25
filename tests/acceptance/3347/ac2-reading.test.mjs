// #3347 AC2, the detector's half: on the reference Mac #1186's backend finds one hand with 21 points in at least 0.95 of
// the drawn clip's frames, and a planted drawn clip with no hand in its frames fails, naming the share. At this suite's
// base #1186 is open: there is no hands@1 backend and no camera.clip. Until they and the command that has them read a
// clip are in the checkout, both tests throw `BLOCKED:`, naming what is missing. They never pass without a reading.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FOLDER, assertDetector, assertReferenceMac, clipOf1186, json, put, reading, root, statementOf, temporary } from './helpers.mjs';

const LEAST = 0.95;

test("#3347.e7d2e863 AC2: on the reference Mac #1186's backend finds one hand with 21 points in at least 0.95 of the drawn clip's frames", (t) => {
  assertDetector();
  const { path, stated } = clipOf1186();
  if (stated.statement === 'agreed') return t.diagnostic(`${path} states agreed: the reading is asked of a drawn clip`);
  assertReferenceMac();
  const read = reading(join(root, path));
  t.diagnostic(read.line);
  assert.ok(read.share >= LEAST, `#1186's backend finds one hand with 21 points in ${read.share} of the ${read.frames} frames of ${path}, under ${LEAST}`);
  assert.deepEqual([read.state, read.status], ['PASS', 0], `the reading of ${path} is ${read.state} at a share of ${read.share}`);
});

test('#3347.e7d2e863 AC2: a planted drawn clip with no hand in its frames fails the reading, naming the share of frames', (t) => {
  assertDetector();
  const dir = join(temporary(t), FOLDER), script = 'no-hand.swift';
  mkdirSync(dir, { recursive: true });
  copyFileSync(fileURLToPath(new URL(`./plants/${script}`, import.meta.url)), join(dir, script));
  put(dir, statementOf('no-hand.mov'), json({ statement: 'drawn', script }));
  // deadline: turns a hung compiler into a failure of this test; nothing waits on it to pass
  const made = spawnSync('swift', [join(dir, script), join(dir, 'no-hand.mov')], { encoding: 'utf8', timeout: 1_800_000 });
  if (made.error || made.status !== 0 || !existsSync(join(dir, 'no-hand.mov'))) throw new Error(`BLOCKED: swift didn't make the planted clip (${made.error?.code ?? `exit ${made.status}: ${made.stderr.slice(0, 500)}`})`);
  const read = reading(join(dir, 'no-hand.mov'));
  assert.equal(read.state, 'FAIL', `a drawn clip with no hand in its frames reads ${read.state}: ${read.line}`);
  assert.ok(read.frames > 0 && read.share < 0.05, `the reading names a share of ${read.share} of ${read.frames} frames for a clip with no hand in any: ${read.line}`);
  assert.notEqual(read.status, 0, 'the reading exits 0 on a clip with no hand in its frames');
});
