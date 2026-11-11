// AC4: "A `sound` result's 12 variants each sit within ±1 LU of their level's target, with true peak at or under −1 dBTP
// and duration within ±20% of the median, and no two are equal by hash or within a log-spectral distance of 0.5 dB of
// each other. A planted result that repeats one file 12 times fails, naming the pairs. A variant at +0.4 dBTP fails,
// naming it"
//
// The clean result is a coin pickup in 3 levels (−28, −22 and −16 LUFS) of 4 round robins (fixtures/synth.ts takes):
// each take its own pitch, 0.2775 to 0.3225 s long, set to its level's target by the BS.1770 meter the fixtures use,
// with a true peak of −10 dBTP or less. The planted results: every take replaced by one file (take 1/0, the medium
// level's first), so all 66 pairs are equal by hash; and take 2/1 replaced by itself with a 4 ms bump of peak
// +0.4 dBFS in front (a true peak of +0.4 dBTP), its level kept on target.
import { describe, expect, it } from 'vitest';
import { LEVELS, overPeak, takes, wavF32 } from './fixtures/synth.ts';
import { AC, TIMEOUT, forProof, gens, mediaDoc, ofCode, proof, putAsset, show, sound, takesNamed, useEvidence, useShow } from './helpers.ts';

const deepShow = useShow();
const evidenceDir = useEvidence();

describe('AC4 a sound\'s takes stay one class and differ from each other', () => {
  it(`${AC[4]} 12 takes in 3 levels on target, under −1 dBTP, within ±20% of the median and distinct pass; one file repeated 12 times fails naming the 66 pairs; a take at +0.4 dBTP fails naming it`, () => {
    const clean = takes();
    const hot = overPeak(clean, 2, 1);
    const evidence = evidenceDir();
    const a = clean.map((level) => level.map((x) => putAsset(evidence, wavF32(x))));
    const hotAsset = putAsset(evidence, wavF32(hot));
    const one = a[1]![0]!;
    const doc = mediaDoc({
      coin: sound(LEVELS, a),
      one_file: sound(LEVELS, a.map((level) => level.map(() => one))),
      hot_take: sound(LEVELS, a.map((level, i) => level.map((h, j) => (i === 2 && j === 1 ? hotAsset : h)))),
    });
    const g = gens(deepShow(), evidence, doc, ['coin', 'one_file', 'hot_take'], 'the coin pickup\'s takes');
    proof('ac4-gen.json', { takes: a, hot_take: hotAsset, coin: forProof(g['coin']!), one_file: forProof(g['one_file']!), hot_take_gen: forProof(g['hot_take']!) });

    const coin = g['coin']!;
    expect([coin.state, coin.issues.map((i) => i.raw)], `the clean takes pass audio.gen with no issue: ${show(coin.raw)}`).toEqual(['PASS', []]);

    // One file 12 times: one audio.gen.same issue per pair, each naming exactly its two takes, every pair named.
    const oneFile = g['one_file']!;
    const same = ofCode(oneFile, 'audio.gen.same');
    expect(oneFile.state, `one file repeated 12 times fails: ${show(oneFile.raw)}`).toBe('FAIL');
    const places = LEVELS.flatMap((_, i) => [0, 1, 2, 3].map((j) => `${i}/${j}`));
    const pairs = places.flatMap((p, k) => places.slice(k + 1).map((q) => [p, q] as const));
    const named = same.map((i) => [...takesNamed(i)].sort());
    const notTwo = same.filter((_, k) => named[k]!.length !== 2);
    expect(notTwo.map((i) => i.raw), 'each audio.gen.same issue names exactly two takes, by their places variants/<i>/takes/<j>').toEqual([]);
    const missing = pairs.filter(([p, q]) => !named.some((n) => n[0] === p && n[1] === q)).map(([p, q]) => `${p} with ${q}`);
    expect(missing, `one file repeated 12 times fails audio.gen.same, naming every one of the 66 pairs (${same.length} issues)`).toEqual([]);

    // The take at +0.4 dBTP.
    const hotGen = g['hot_take']!;
    const peak = ofCode(hotGen, 'audio.gen.peak');
    expect(hotGen.state, `the result with a take at +0.4 dBTP fails: ${show(hotGen.raw)}`).toBe('FAIL');
    expect(peak.some((i) => takesNamed(i).has('2/1') || JSON.stringify(i.raw).includes(hotAsset)), `the take at +0.4 dBTP fails audio.gen.peak, naming it (variants/2/takes/1, ${hotAsset}): ${show(peak.map((i) => i.raw))}`).toBe(true);
  }, TIMEOUT);
});
