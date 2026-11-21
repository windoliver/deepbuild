// #2694.00d72883: "The 10,000th read retires within 5% of the instructions of the 10th (drafted). On the merge base it
// retires about a thousand times as many"
//
// One side after the agent's deep_show, read as the app's Terminal tab reads it (`cells`), one read at a time. The
// instructions are the side's own, read from the kernel around each read (benchmarks/process-reader.mjs, #2698): the
// side waits on its next line before and after, so the span holds that read alone. One read's count moves with the
// schedule a little, so each named read is the median of it and the eight after it (README: Instructions). The
// 100th and the 1,000th are judged on the way to the 10,000th by the same 5%, so a side whose reads grow fails where
// it first shows, not an hour later (README).
import { describe, test } from 'vitest';
import { AC, CELLS, FIRST, READS_MS, TIMEOUT, instructionsOf, median, must, nth, openSide, prebuild, replyOf, show, tempDir, world } from './helpers.ts';

prebuild();

/** Each named read with the eight after it. */
const RUN = 9;
const NAMED = [10, 100, 1_000, 10_000];
const WITHIN = 0.05;

describe(`${AC[2]} a read costs the same however many reads came before it`, () => {
  test(`${AC[2]} the 10,000th cells read retires within 5% of the instructions of the 10th`, async () => {
    const side = await openSide(world(tempDir('ac2')));
    replyOf(await side.call(show(FIRST)), 'the deep_show');
    const counts = new Map<number, number[]>();
    const last = NAMED.at(-1)! + RUN - 1;
    const until = Date.now() + READS_MS;
    for (let n = 1; n <= last; n++) {
      if (Date.now() > until) throw Error(`INCONCLUSIVE: the side answered ${(n - 1).toLocaleString('en-US')} of ${last.toLocaleString('en-US')} cells reads in ${READS_MS / 60_000} minutes`);
      const named = NAMED.find((k) => n >= k && n < k + RUN);
      if (named === undefined) {
        replyOf(await side.call(CELLS), `the ${nth(n)} cells read`);
        continue;
      }
      const { answer, instructions } = await instructionsOf(side, CELLS, `the ${nth(n)} cells read`);
      replyOf(answer, `the ${nth(n)} cells read`);
      counts.set(named, [...(counts.get(named) ?? []), instructions]);
      if (n !== named + RUN - 1 || named === NAMED[0]) continue;
      const tenth = median(counts.get(NAMED[0]!)!);
      const now = median(counts.get(named)!);
      const ratio = now / tenth;
      must(Math.abs(ratio - 1) <= WITHIN, `the ${nth(named)} cells read retires ${Math.round(now).toLocaleString('en-US')} instructions, ${ratio.toFixed(3)}× the ${Math.round(tenth).toLocaleString('en-US')} of the 10th (each the median of ${RUN} reads from it: ${counts.get(named)!.join(', ')} against ${counts.get(NAMED[0]!)!.join(', ')}); within 5% is 0.950× to 1.050×`);
    }
    side.close();
  }, TIMEOUT);
});
