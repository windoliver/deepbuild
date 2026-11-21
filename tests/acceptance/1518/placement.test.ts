// #1518.d365703e: "Each cut point lies in a local energy minimum within `search`, on a zero crossing, and inside no kept
// word by the fixture's true times; a planted recipe that skips the move fails, naming the first cut"
//
// The 60 s take of criterion 1 (README: Fixtures), its twelve marked cuts, presented twice in one run: as document a with
// its words record at the true times and as document b with the record shifted 150 ms. Each expansion row's `cuts` are
// judged against the take's own samples (placementFailures, README: The judgments): each cut's `raw` is the record's edge
// of the word it bounds and `at` its sample in flicks; the sample lies within `search` (200 ms) of the raw point and
// between the middles of the words either side by the record; its 40 ms window's energy is the least there; the
// channels' mean is 0 there or changes sign from the sample before; and it lies strictly inside no kept word by the
// true times. The clean recipe passes on both records. The planted cut_on_raw_times, which skips the move and cuts at
// each raw point, fails on the shifted record, and the first failure names the first cut in the source's order.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, PLANTED, SHIFT, TIMEOUT, cutKeys, cutRow, expectedCuts, keptOf, placementFailures, present, presented, proof, runShow, scenario,
  soundFilm, speechTake, stageWav, stated, useShow, useTemp, type CutRow,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

/** The take cut on its true record (document a) and on its record shifted 150 ms (document b), in one run. */
function rows(planted?: string): { exact: CutRow; shifted: CutRow } {
  const take = speechTake();
  const evidence = temp();
  const exact = stageWav(evidence, take);
  const shifted = stageWav(evidence, take, SHIFT);
  const what = planted ? `the take under the planted ${planted}` : 'the take';
  const [a, b] = runShow(shows.bin(FULL), scenario(evidence, [
    present(DOC.a, soundFilm(exact.sha, [exact.record], take.keep, 60)), present(DOC.b, soundFilm(shifted.sha, [shifted.record], take.keep, 60)),
  ], planted ? { planted } : {}), what);
  return { exact: cutRow(presented(a, `${what} on its true record`), `${what} on its true record`), shifted: cutRow(presented(b, `${what} on its shifted record`), `${what} on its shifted record`) };
}

describe(`${AC[2]} each cut point lies in quiet, on a zero crossing, inside no kept word; skipping the move fails naming the first cut`, () => {
  it(`${AC[2]} on the true record and on the record shifted 150 ms, every cut point lies in a local energy minimum within search, on a zero crossing, and inside no kept word by the true times`, () => {
    const take = speechTake();
    const kept = keptOf(take.keep);
    const { exact, shifted } = rows();
    const judged = { exact: placementFailures(take, stated(take.words), kept, exact.cuts), shifted: placementFailures(take, stated(take.words, SHIFT), kept, shifted.cuts) };
    proof('ac2-placement.json', { words: take.words, exact: exact.cuts.map((c) => c.entry), shifted: shifted.cuts.map((c) => c.entry), judged });
    for (const [name, row] of [['the true record', exact], ['the shifted record', shifted]] as const) {
      expect(cutKeys(row.cuts), `${name}: the cuts are an out after the word before each marked word and an in before the word after it`).toEqual(expectedCuts(take.removed));
    }
    expect(judged.exact, `on the true record: ${judged.exact.slice(0, 6).join(' | ')}`).toEqual([]);
    expect(judged.shifted, `on the record shifted 150 ms: ${judged.shifted.slice(0, 6).join(' | ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} the planted cut_on_raw_times, which skips the move, fails the same judgment on the shifted record, naming the first cut`, () => {
    const take = speechTake();
    const { shifted } = rows(PLANTED.raw);
    const failures = placementFailures(take, stated(take.words, SHIFT), keptOf(take.keep), shifted.cuts);
    proof('ac2-planted.json', { cuts: shifted.cuts.map((c) => c.entry), failures });
    expect(cutKeys(shifted.cuts), 'the planted recipe still lists its cuts').toEqual(expectedCuts(take.removed));
    expect(failures.length, 'the judgment fails the recipe that cuts at the raw points').toBeGreaterThan(0);
    expect(failures[0], `the first failure names the first cut: ${failures.slice(0, 4).join(' | ')}`).toMatch(/^cut 1 \(/);
  }, TIMEOUT);
});
