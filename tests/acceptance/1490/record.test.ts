// AC1 #1490.4cd26262: "A record gives each set's compressed size. If `figure` isn't at least 25% under `full`, the issue
// closes with that number"
//
// asserts, on the checkout alone (no build, no browser):
//   - the size record (`crates/deep-player/web/dist/sets.json`, README: The size record) says its sizes are Brotli 11 and
//     gives each set it lists its compressed size, `figure` and `full` among them;
//   - each set's player (its WebAssembly) and page glue are the checkout's files by the record's SHA-256, and each
//     set's recorded size is what those two files measure here, Brotli at quality 11 of each, summed, within 1%;
//   - `figure` holds fewer modules than `full` and none `full` lacks, and no two sets ship one player;
//   - a copy of the record that gives `figure` half its measured size fails that check, naming `figure` (a twin made
//     in test code: a record that isn't the bytes' can't pass);
//   - measured here, `figure` is at least 25% under `full`: figure ≤ 0.75 × full. Short of that the test fails with
//     both numbers and the share: that number is what the issue closes with, and no set ships (README: Readings).
// Wrong programs it fails: the merge base (no record: one player); a record whose sizes are a guess or stale, or whose
// files aren't the committed ones (names the set); sets whose saving is under a quarter (names the number).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, failsNaming, none, type JsonValue } from '../172/helpers.ts';
import { AC, FIGURE, FULL_SET, measureSets, readRecord, recordFailures, recordOf } from './helpers.ts';

describe(`${AC[1]} the size record gives each set's compressed size, and figure is at least a quarter under full`, () => {
  it(`${AC[1]} the record gives each set's compressed size as its committed player measures, and ${FIGURE} is at least 25% under ${FULL_SET}`, () => {
    const record = readRecord();
    const measured = measureSets(record);
    for (const [name, m] of measured) console.log(`${AC[1]} the set ${name}: ${m.compressed} bytes compressed (Brotli 11, measured here), ${record.sets.get(name)!.compressed} recorded; ${record.sets.get(name)!.modules.join(', ')}`);
    none(recordFailures(record, measured), 'the size record gives each set\'s compressed size, as its committed player measures');

    const copy = JSON.parse(JSON.stringify(record.raw)) as { sets: Record<string, { compressed: number }> };
    copy.sets[FIGURE]!.compressed = Math.floor(measured.get(FIGURE)!.compressed / 2);
    failsNaming(recordFailures(recordOf(copy as unknown as JsonValue), measured), FIGURE, `a copy of the record that halves ${FIGURE}'s size`);

    const figure = measured.get(FIGURE)!.compressed;
    const full = measured.get(FULL_SET)!.compressed;
    const reading = `${FIGURE}'s player is ${figure} bytes compressed, ${FULL_SET}'s ${full}: ${FIGURE} is ${((1 - figure / full) * 100).toFixed(1)}% under ${FULL_SET}`;
    console.log(`${AC[1]} ${reading}`);
    expect(figure <= 0.75 * full, `${reading}; the issue asks at least 25%, and short of it the issue closes with this number`).toBe(true);
  }, TIMEOUT);
});
