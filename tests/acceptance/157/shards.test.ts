// AC22 #157.71f39245: "A 700-frame film at 30000/1001 fps with 44.1 kHz stereo (1,030,029 sample frames per channel)
// exports with 1 and 3 shards to identical frame and PCM hashes; a planted splitter that rounds a shard's first sample
// instead of flooring it fails at a seam, naming it"
//
// Through `deep-show run`'s `export` with `shards` (#501's). The film: the fixture film (helpers.ts `filmDoc`), 160 × 90,
// 700 frames at 30000/1001 with a 44.1 kHz stereo tone over its whole span. The receipt's `frame_hashes` and
// `pcm_hashes` (one SHA-256 per frame's span of f32le PCM) are compared frame by frame; a 3-shard receipt lists its
// `seams`, the first frame of each shard after the first. Frame 233's first sample is 342,852.51, floored 342,852 and
// rounded 342,853, so a splitter that rounds moves the shard that starts there by one sample. Planted:
// `shard_rounds_first_sample`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, H264_AAC, TIMEOUT, arr, exportCall, failsNaming, fidelityOf, filmDoc, filmRun, int, none, receiptOf, samplesOf, useShow, useTemp,
  type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const RATE: [number, number] = [30000, 1001];

/** The judge: 1 and 3 shards give the same frame and PCM hashes, frame by frame, and 1,030,029 sample frames. A PCM
 * difference is named by the first frame it starts at, as a seam when a shard starts there. */
function shardFailures(planted?: Planted): string[] {
  const evidence = temp(); const dir = temp();
  const [one, three] = filmRun(shows.bin(FULL), evidence, filmDoc(evidence, { frames: 700, rate: RATE, sampleRate: 44_100 }),
    [1, 3].map((shards) => exportCall({ out: join(dir, `shards-${shards}.mp4`), ...H264_AAC, shards })), 'the 700-frame film with 1 and 3 shards', planted);
  const a = receiptOf(one!, '1 shard'); const b = receiptOf(three!, '3 shards');
  const seams = arr(b.raw['seams'], '3 shards: receipt.seams').map((s, i) => int(s, `receipt.seams[${i}]`));
  expect(seams.length, 'three shards have two seams').toBe(2);
  const f: string[] = [];
  for (const [r, what] of [[a, '1 shard'], [b, '3 shards']] as const) {
    if (r.frame_hashes.length !== 700 || r.pcm_hashes.length !== 700) f.push(`${what}: ${r.frame_hashes.length} frame hashes and ${r.pcm_hashes.length} PCM hashes, not 700 each`);
    const samples = fidelityOf(r.raw, what).samples;
    if (samples !== 1_030_029) f.push(`samples: ${what} delivers ${String(samples)} sample frames per channel, not 1,030,029`);
  }
  const frame = a.frame_hashes.findIndex((h, k) => h !== b.frame_hashes[k]);
  if (frame >= 0) f.push(`frame ${frame}: 3 shards draw it otherwise than 1 shard`);
  const pcm = a.pcm_hashes.findIndex((h, k) => h !== b.pcm_hashes[k]);
  if (pcm >= 0) f.push(`${seams.includes(pcm) ? 'seam at ' : ''}frame ${pcm}: 3 shards give its PCM span other samples than 1 shard`);
  return f;
}

describe(`${AC[22]} shards change no frame and no sample`, () => {
  it(`${AC[22]} the 700-frame film at 30000/1001 with 44.1 kHz stereo exports with 1 and 3 shards to identical frame and PCM hashes, 1,030,029 sample frames each`, () => {
    expect(samplesOf(700, RATE, 44_100), 'the film spans 1,030,029 sample frames').toBe(1_030_029);
    none(shardFailures(), 'shards against one shard');
  }, TIMEOUT);

  it(`${AC[22]} a planted splitter that rounds a shard's first sample instead of flooring it fails at a seam, naming it`, () => {
    failsNaming(shardFailures('shard_rounds_first_sample'), /^seam at frame \d+:/, 'the planted splitter (shard_rounds_first_sample)');
  }, TIMEOUT);
});
