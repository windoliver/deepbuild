// #2694.b3f057c6: "`tests/acceptance/806/` and `tests/acceptance/393/` pass unchanged, and the side's resident memory
// after the 14,400 reads is within 4 MB of its value after the first show"
//
// This file holds the memory clause: one side after the agent's deep_show, then an hour of the app's Terminal tab (a
// `cells` read every 250 ms). The side's resident memory is its physical footprint, what macOS counts as a process's
// memory (README: Memory, for why not its resident set), read once the first show is answered and once the 14,400th
// read is. It is also read every 1,000 reads, and a side already more than 4 MB over its first value fails there,
// since what a side keeps of its reads only grows. ac5-393.test.ts and ac5-806.test.ts hold the other.
import { describe, test } from 'vitest';
import { AC, CELLS, FIRST, READS_MS, TIMEOUT, mib, must, nth, openSide, prebuild, replyOf, residentBytes, show, tempDir, world } from './helpers.ts';

prebuild();

const READS = 14_400;
const EVERY = 1_000;
/** 4 MB: 4 × 1,024 × 1,024 bytes. */
const MARGIN = 4 * 1024 * 1024;

describe(`${AC[5]} the side's memory stays put while the app reads its terminal tab`, () => {
  test(`${AC[5]} the side's resident memory after ${READS.toLocaleString('en-US')} cells reads is within 4 MB of its value after the first show`, async () => {
    const side = await openSide(world(tempDir('ac5')));
    replyOf(await side.call(show(FIRST)), 'the deep_show');
    const first = await residentBytes(side.pid);
    const seen: string[] = [];
    const until = Date.now() + READS_MS;
    for (let n = 1; n <= READS; n++) {
      replyOf(await side.call(CELLS), `the ${nth(n)} cells read`);
      const over = Date.now() > until;
      if (n % EVERY !== 0 && n !== READS && !over) continue;
      const now = await residentBytes(side.pid);
      seen.push(`${nth(n)}: ${mib(now)}`);
      must(now - first <= MARGIN, `the side's resident memory after the ${nth(n)} cells read is ${mib(now)}, ${mib(now - first)} over the ${mib(first)} after the first show; within 4 MB is at most ${mib(first + MARGIN)} (read every ${EVERY.toLocaleString('en-US')}: ${seen.join(', ')})`);
      if (over && n < READS) throw Error(`INCONCLUSIVE: the side answered ${n.toLocaleString('en-US')} of ${READS.toLocaleString('en-US')} cells reads in ${READS_MS / 60_000} minutes; its resident memory went from ${mib(first)} after the first show to ${seen.join(', ')}`);
    }
    side.close();
  }, TIMEOUT);
});
