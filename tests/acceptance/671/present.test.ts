// AC1: the scene is presented with no issues and its snapshot equals by pixel hash on a second run on one machine;
// the blank guard runs before the comparison, so two blank frames never count as equal.
// The first test (the scene and its label presented, each in its own writer layer) lives in present-redraft.test.ts
// (A1-REDRAFT.md).
// The scene (fixtures/scene.json: 200 one-metre boxes on a ground plane under a camera that orbits once in 5 s)
// and its 2D label (fixtures/label.json, an overlay anchored 1.5 m above box-02-01) are sent with `deep show` by
// two test processes, each inside its own test agent's process tree, to the document the hub minted (#96's
// shared document). The snapshot is the scene's render-back at 0 s. Its comparison goes through #377's blank
// guard (`deep-gpu run`'s `compare` call) before the hashes are compared; the guard's twin, the snapshot doctored
// to black, must be BLOCKED. At the base the hub refuses the scene: its orbit channel's target
// `items/cam/params/orbit/azimuth` "reaches nothing".
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, SHOW_BIN, SIZE, arr, checkpointCalls, colorShares, decodePng, encodePng, expectPresentedClean, keepPng, keepProof,
  numbersIn, pixelHash, readEvidence, requireGpu, runGpu, scenario, sha256, showLines, snapshots, useBins, useOut,
  type Image, type JsonObject,
} from './helpers.ts';

const bins = useBins([SHOW_BIN, GPU_BIN]);
const out = useOut();

describe('AC1 the scene is presented with no issues and its snapshot equals by pixel hash on a second run on one machine; the blank guard runs before the comparison, so two blank frames never count as equal', () => {
  it('AC1 the scene\'s snapshot at 0 s has the same pixel hash on a second run in the same process and in a fresh process, compared only after the blank guard passes both; a blank twin is BLOCKED', async () => {
    requireGpu();
    const evidence = join(out(), 'evidence');
    mkdirSync(evidence, { recursive: true });
    const line = scenario(evidence, checkpointCalls(true));
    const [first, second] = showLines(bins.bin(SHOW_BIN), [line, line]) as [JsonObject[], JsonObject[]];
    const [fresh] = showLines(bins.bin(SHOW_BIN), [line]) as [JsonObject[]];
    const runs = { first, second, fresh };
    const images: Record<string, { image: Image; png: Buffer; file: string; hash: string }> = {};
    const cmp = join(out(), 'compare');
    mkdirSync(cmp, { recursive: true });
    for (const [name, replies] of Object.entries(runs)) {
      expectPresentedClean(replies[0]!, `the ${name} run's scene`);
      expectPresentedClean(replies[1]!, `the ${name} run's label`);
      const snaps = snapshots(replies[0]!, `the ${name} run's scene`);
      expect(snaps.map((s) => [s.w, s.h]), `the ${name} run's render-back returns one ${SIZE.join(' × ')} snapshot`).toEqual([SIZE]);
      const png = await readEvidence(evidence, snaps[0]!.sha256);
      expect(sha256(png), `the ${name} run's snapshot reads back from the evidence store by its hash`).toBe(snaps[0]!.sha256);
      const image = decodePng(png);
      expect([image.width, image.height], `the ${name} run's snapshot is ${SIZE.join(' × ')} px`).toEqual(SIZE);
      const file = join(cmp, `${name}.png`);
      writeFileSync(file, png);
      images[name] = { image, png, file, hash: pixelHash(image) };
      keepPng(`ac1-snapshot-${name}`, png);
    }
    keepProof('ac1-hashes', Object.fromEntries(Object.entries(images).map(([k, v]) => [k, { snapshot_sha256: sha256(v.png), pixel_hash: v.hash }])));
    // The snapshot draws the scene: a render-back that draws nothing in 3D (one flat ground, as the base's 2D
    // path draws a shared document) isn't dark, so the guard's measure alone wouldn't stop it.
    const shares = colorShares(images['first']!.image);
    expect(shares[0]!, 'the snapshot isn\'t one flat color: no color covers more than 95% of it').toBeLessThanOrEqual(0.95);
    expect(shares.filter((s) => s >= 0.01).length, 'at least two colors each cover 1% of it (the ground and the boxes)').toBeGreaterThanOrEqual(2);
    // The blank guard runs first: the comparison of the runs' snapshots goes through #377's guard, which must
    // pass both sides (not BLOCKED), and only then are the pixel hashes compared.
    const black: Image = { width: SIZE[0], height: SIZE[1], rgba: new Uint8Array(SIZE[0] * SIZE[1] * 4).map((_, i) => (i % 4 === 3 ? 255 : 0)) };
    const blackFile = join(cmp, 'black.png');
    writeFileSync(blackFile, encodePng(black));
    const compare = (a: string, b: string): JsonObject => ({ call: 'compare', fixture: 'checkpoint-671', a, b });
    const [vsSecond, vsFresh, blank, blankVsScene] = runGpu(bins.bin(GPU_BIN), out(), [
      compare(images['first']!.file, images['second']!.file), compare(images['first']!.file, images['fresh']!.file), compare(blackFile, blackFile), compare(blackFile, images['first']!.file),
    ]) as [JsonObject, JsonObject, JsonObject, JsonObject];
    keepProof('ac1-compare', { vsSecond, vsFresh, blankTwin: blank, blankVsScene });
    for (const [name, reply] of [['second', vsSecond], ['fresh', vsFresh]] as const) {
      expect(reply['result'], `the blank guard passes the first and ${name} runs' snapshots and they compare equal (a blank snapshot is BLOCKED here): ${JSON.stringify(reply)}`).toBe('PASS');
    }
    expect(images['second']!.hash, 'the snapshot\'s pixel hash on a second run in the same process is the first run\'s').toBe(images['first']!.hash);
    expect(images['fresh']!.hash, 'the snapshot\'s pixel hash in a fresh process is the first run\'s').toBe(images['first']!.hash);
    // The guard's twin on this same comparison path: two blank frames, and a blank one against the scene, are
    // BLOCKED with no number in the reply, never PASS. A comparison without the guard fails here.
    for (const [name, reply, sides] of [['two black frames', blank, ['a', 'b']], ['a black frame against the scene', blankVsScene, ['a']]] as const) {
      expect(reply['result'], `${name} are BLOCKED by the blank guard: ${JSON.stringify(reply)}`).toBe('BLOCKED');
      expect(arr(reply['blank'] ?? null, `${name}: blank`).slice().sort(), `${name}: the reply names the blank sides`).toEqual([...sides]);
      expect(numbersIn(reply), `${name}: no number beside BLOCKED`).toEqual([]);
    }
  }, 900_000);
});
