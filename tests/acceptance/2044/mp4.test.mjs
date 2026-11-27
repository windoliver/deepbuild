// #2044 criteria 1 and 2: an MP4 whose sample tables state counts the file's bytes can't back is refused, naming
// the box (and, for `stsz`, the count).
// Run: node --test --test-concurrency=1 tests/acceptance/2044/mp4.test.mjs   (README.md beside this file)
//
// Each fixture is a whole MP4 of one video track with four one-byte samples, under 1 KiB, in which one number is
// the criterion's (make-fixtures.mjs). The reader probes it as the decode worker does (`deep_codecs::run`, the job
// `{"op": "probe", "path": <file>}`) in a process of its own, under a deadline and a heap cap, and the test reads
// the reply: a refusal, `{"refused": {"code": ...}}`, whose JSON names the box.
import { after, test } from 'node:test';
import { answer, fixture, holds, mp4Box, refusedNamingBox, run, TEST_MS, tidy } from './helpers.mjs';

// Each criterion's tag: `#2044.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
const AC1 = 'AC1 #2044.186e93e0';
const AC2 = 'AC2 #2044.039601da';

after(tidy);

test(`${AC1} an MP4 under 1 KiB whose stsz box states a fixed sample size of 1 and 50,000,000 samples is refused, naming stsz and the count`, { timeout: TEST_MS }, () => {
  const { file, shown, bytes } = fixture('stsz.mp4');
  // A `stsz` box's body: version and flags, the fixed sample size, the sample count.
  const stsz = mp4Box(bytes, 'stsz');
  const [size, count] = [stsz.readUInt32BE(4), stsz.readUInt32BE(8)];
  holds(bytes.length < 1024, `${shown} is ${bytes.length} bytes, not under 1 KiB`);
  holds(size === 1 && count === 50_000_000, `${shown}'s stsz states a fixed sample size of ${size} and ${count} samples, not 1 and 50,000,000`);
  const reply = answer(run(['mp4', file]), `the decode worker's probe of ${shown}`);
  refusedNamingBox(reply, { box: 'stsz', count: 50_000_000, who: shown, states: `its stsz box states 50,000,000 samples of 1 byte and the file is ${bytes.length} bytes` });
});

test(`${AC2} an MP4 under 1 KiB whose stts box holds 2 runs of 4,000,000,000 samples each is refused, naming stts`, { timeout: TEST_MS }, () => {
  const { file, shown, bytes } = fixture('stts.mp4');
  // A `stts` box's body: version and flags, the count of runs, then each run's sample count and its delta.
  const stts = mp4Box(bytes, 'stts');
  const runs = Array.from({ length: Math.min(stts.readUInt32BE(4), 8) }, (_, k) => stts.readUInt32BE(8 + 8 * k));
  holds(bytes.length < 1024, `${shown} is ${bytes.length} bytes, not under 1 KiB`);
  holds(stts.readUInt32BE(4) === 2 && runs.every((samples) => samples === 4_000_000_000), `${shown}'s stts holds ${stts.readUInt32BE(4)} runs, of ${runs.join(' and ')} samples, not 2 of 4,000,000,000 each`);
  const reply = answer(run(['mp4', file]), `the decode worker's probe of ${shown}`);
  refusedNamingBox(reply, { box: 'stts', who: shown, states: `its stts box holds 2 runs of 4,000,000,000 samples each and the file is ${bytes.length} bytes` });
});
