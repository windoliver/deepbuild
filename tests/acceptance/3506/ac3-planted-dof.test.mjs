// Criterion 3 of #3506 (#3506.55c33ada), its last sentence: "A planted depth of field that reads the shared image
// before it writes it draws motion blur's and fails, naming the frame"
//
// The four suites' frames are the criterion's own run (ac3-hashes-<n>.test.mjs); this file shows that the same check,
// #3507's `hashProblems` over two builds' hashes of the same frames, fails a depth of field that reads the image it
// shares with motion blur before it writes it. Where the two share an image is #3031's every-pass fixture, which has
// both on: its first five frames (0 to 0.8 s, 5 a second, at 3456 × 2234 under its own look) are drawn by `deep-gpu
// run`'s `view3d` three ways: this checkout's build under the planted `dof_reads_shared_before_write` (README: The
// planted programs), this checkout's build as shipped, and the merge base's (`DEEP_3506_BASE`). The shipped frames
// must hash as the merge base's, or the plant's frames can't be told from the change's (INCONCLUSIVE); the planted
// frames must fail the check, naming a frame.
// Run: DEEP_3506_BASE=<built merge base> node --test tests/acceptance/3506/ac3-planted-dof.test.mjs
import { join } from 'node:path';
import test from 'node:test';
import { hashProblems } from '../3507/judge.mjs';
import { allow, blocked, everyPassView, gpuBinary, gpuRun, inconclusive, mergeBase, referenceMac, settle, tempDir, underLease } from './drive.mjs';
import { AC } from './judge.mjs';

/** The planted depth of field criterion 3 names (README: The planted programs). */
const READS_FIRST = 'dof_reads_shared_before_write';
const FIVE = 5;
allow(55);

/** The fixture's first five frames by `bin`, each frame's pixel hash. */
async function hashes(bin, planted, what) {
  const out = tempDir('dof');
  try {
    const [reply] = await gpuRun(bin, out.dir, [everyPassView({ frames: FIVE, capture: 'every' })], { planted, what });
    const found = (reply.frames ?? []).map((f) => f.pixel_hash);
    if (found.length !== FIVE || found.some((h) => typeof h !== 'string')) throw blocked(`${what} drew ${found.length} frames of the every-pass fixture, not ${FIVE} with a pixel hash each`);
    return found;
  } finally { out.remove(); }
}
const row = (own, base, args) => ({ file: 'every_pass', child: 0, command: 'deep-gpu', args, kind: 'paired', own, base, note: '' });

test(`AC3 ${AC[3]} a planted depth of field that reads the shared image before it writes it draws otherwise than the merge base and fails the check, naming the frame`, { timeout: 60 * 60_000 }, async (t) => {
  await referenceMac('a pixel hash');
  const gpu = gpuBinary();
  const planted = await underLease('the planted frames', () => hashes(gpu, READS_FIRST, `deep-gpu run --planted ${READS_FIRST} (this checkout, every_pass)`));
  const base = mergeBase(['deep-gpu']);
  const [shipped, theirs] = await underLease('the frames', async () => [
    await hashes(gpu, null, 'deep-gpu run (this checkout, every_pass)'),
    await hashes(join(base.debug, 'deep-gpu'), null, 'deep-gpu run (the merge base, every_pass)'),
  ]);
  const control = hashProblems('3506', [row(shipped, theirs, ['run'])]).problems;
  if (control.length) throw inconclusive(`the change as shipped draws the every-pass fixture otherwise than the merge base (${control.join('; ').slice(0, 1200)}), so what the planted depth of field draws can't be told from the change`);
  const found = hashProblems('3506', [row(planted, theirs, ['run', '--planted', READS_FIRST])]).problems;
  t.diagnostic(`planted ${READS_FIRST}: ${found.join('; ') || 'every frame hashes as on the merge base'}`);
  settle(`AC3 ${AC[3]} (planted ${READS_FIRST})`, found.some((p) => p.startsWith('FAIL:') && / frame \d+: hashes /.test(p)) ? [] : [`FAIL: the check passes a depth of field that reads the shared image before it writes it: its ${FIVE} frames of the every-pass fixture hash as the merge base's (${found.join('; ') || 'no finding'})`]);
});
