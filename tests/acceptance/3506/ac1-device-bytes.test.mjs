// Criterion 1 of #3506 (#3506.86abd572): "On Metal, #3031's every-pass fixture at 3456 × 2234
// (`docs/spikes/3031/fixtures/`) holds at least 215 MB less than on the merge base (drafted), read from the device as
// #3031's listing reads it. On the merge base it holds 1,794 MB"
//
// #3031's reader (`spike-3031 frames`, README: The surface under test) draws the fixture's 300 frames, 5 a second, on
// Metal, and lists what the device holds after the last: `allocated` is the device's own total, read in the same
// moment. It is built twice from the same sources: against this checkout's crates, and against the merge base's
// (`DEEP_3506_BASE`). The change's total must be at least 215,000,000 B under the merge base's (`bytesProblems`). The
// merge base's total is printed beside the issue's 1,794 MB; it is a reading of one Mac and decides nothing.
// Run: DEEP_3506_BASE=<checkout of the merge base> node --test tests/acceptance/3506/ac1-device-bytes.test.mjs
import test from 'node:test';
import { EVERY_PASS, allow, listing, mergeBase, reader, referenceMac, settle } from './drive.mjs';
import { AC, BASE_SAID, FRAMES, bytesProblems, listingProblems } from './judge.mjs';

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

test(`AC1 ${AC[1]} on Metal the every-pass fixture at 3456 × 2234 holds at least 215 MB less on the device than on the merge base, read as #3031's listing reads it`, { timeout: 120 * 60_000 }, async (t) => {
  allow(110);
  await referenceMac('the device\'s bytes');
  const base = mergeBase();
  const theirs = reader(base.path);
  const ours = reader();
  const before = (await listing(theirs, FRAMES)).listing;
  const after = (await listing(ours, FRAMES)).listing;
  settle(`AC1 ${AC[1]}`, [...listingProblems('the merge base', before, EVERY_PASS.size, FRAMES), ...listingProblems('the change', after, EVERY_PASS.size, FRAMES)]);
  t.diagnostic(`the merge base (${base.commit.slice(0, 9)}) holds ${before.allocated} B (${mb(before.allocated)}; the issue says ${mb(BASE_SAID)}); the change holds ${after.allocated} B (${mb(after.allocated)}), ${mb(before.allocated - after.allocated)} less`);
  settle(`AC1 ${AC[1]}`, bytesProblems(before, after));
});
