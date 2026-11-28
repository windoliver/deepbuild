// #3502, third criterion: the replica's pictures of every shipped page at the head and at the merge base are equal,
// in light and dark at both windows, or each differing picture is listed with its cause (README: The pictures).
//
// The head's pictures come from this checkout's `deep-drive`; the merge base's from the `deep-drive` built at the
// merge base, as it is there, which DEEP_3502_BASE_DRIVE names by its path. Without it the comparison is BLOCKED,
// never a pass. The second test shows the comparison isn't empty: the same build's picture taken twice is equal, a
// picture shows something, and a planted change of one pixel is listed by name.
// Run: node --test tests/acceptance/3502/pictures.test.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { blocked, debugBinary, givenBinary, tempDir } from './common.mjs';
import { difference, drawn, judgePictures, keyOf, LIST, listed, readPng, shippedPages, takePictures, THEMES, windows, writePng } from './pictures.mjs';

const macOnly = () => { if (process.platform !== 'darwin') blocked(`the replica draws on macOS only; this is ${process.platform}`); };

test('AC3 #3502.83b16d90 the replica\'s pictures of every shipped page at the head and at the merge base are equal, in light and dark at both windows, or each differing picture is listed with its cause', { timeout: 3_600_000 }, () => {
  macOnly();
  const base = givenBinary('DEEP_3502_BASE_DRIVE', "the merge base's own deep-drive, built there with no change");
  const head = debugBinary('deep-drive');
  const [pages, sizes] = [shippedPages(head), windows()];
  const [ours, theirs] = [takePictures(head, pages, sizes), takePictures(base, pages, sizes)];
  assert.equal(ours.size, pages.length * sizes.length * THEMES.length, 'one picture of each shipped page in each window and theme');
  assert.deepEqual([...ours].filter(([, picture]) => !drawn(picture)).map(([key, picture]) => `${key}: ${picture.error ?? 'one color'}`), [], 'the head drew every picture');
  const { failures, differing } = judgePictures(ours, theirs, listed());
  console.log(`${ours.size} pictures a side over ${pages.join(', ')}; ${differing.length} differ${differing.map(({ key, how }) => `\n  ${key}: ${how}`).join('')}`);
  assert.deepEqual(failures, [], `every differing picture is in ${LIST} with its cause, and nothing there is equal`);
});

test('AC3 #3502.83b16d90 the comparison is no empty one: a picture taken twice is equal, it shows the page, and a planted change of one pixel is listed, naming the picture', { timeout: 1_800_000 }, () => {
  macOnly();
  const head = debugBinary('deep-drive');
  const [page] = shippedPages(head);
  const reference = windows().filter(({ name }) => name === 'reference');
  const [once, twice] = [takePictures(head, [page], reference), takePictures(head, [page], reference)];
  const key = keyOf(page, 'reference', 'light');
  assert.ok(drawn(once.get(key)), `the picture ${key} shows more than one color: ${once.get(key).error ?? ''}`);
  assert.deepEqual(judgePictures(once, twice, []), { failures: [], differing: [] }, 'one build, taken twice, differs nowhere');

  const pixels = readPng(once.get(key).path);
  const at = (Math.floor(pixels.height / 2) * pixels.width + Math.floor(pixels.width / 2)) * pixels.channels;
  pixels.data[at] ^= 0x80;
  const path = join(tempDir('planted'), 'planted.png');
  writePng(path, pixels);
  const planted = new Map([...once].map(([each, picture]) => [each, each === key ? { path, sha256: 'planted' } : picture]));
  assert.match(difference(once.get(key), planted.get(key)), /^1 of \d+ pixels differ, the first at \d+, \d+$/);
  const unlisted = judgePictures(once, planted, []);
  assert.deepEqual(unlisted.differing.map((each) => each.key), [key]);
  assert.equal(unlisted.failures.length, 1);
  assert.ok(unlisted.failures[0].startsWith(`the picture ${key} differs between the head and the merge base (1 of `) && unlisted.failures[0].endsWith(`and ${LIST} doesn't list it with its cause`), unlisted.failures[0]);
  const entry = { page, window: 'reference', theme: 'light' };
  assert.deepEqual(judgePictures(once, planted, [{ ...entry, cause: 'a planted pixel at the center' }]).failures, [], 'listed with its cause, it passes');
  assert.match(judgePictures(once, planted, [{ ...entry, cause: '' }]).failures.join('\n'), /with no cause/);
  assert.match(judgePictures(once, twice, [{ ...entry, cause: 'a planted pixel at the center' }]).failures.join('\n'), /lists .* as differing, and the head's picture equals the merge base's/);
  assert.match(judgePictures(once, new Map(), []).failures.join('\n'), /one side has no picture \(the merge base took none\)/);
});
