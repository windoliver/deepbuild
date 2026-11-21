// #2694.5ca7dce2: "A scripted terminal whose rows arrive at 2 s on the side's clock shows them once enough reads have
// moved the clock there, and not before. A planted side whose reads do not move the clock never shows them and fails,
// naming the row"
//
// The session's hosted terminal, opened with a recorded feed (crates/deep-show/src/terminal.rs `terminal_open`) whose
// one chunk arrives at 2 s, then read as the app's Terminal tab reads it (`cells`). The side's clock moves one spacing
// a call, a read included, as the merge base's does (helpers.ts CLOCK): the open plays at one spacing and the n-th
// read at n + 1, so the 23rd read is the first at 2 s (24 × 1/12 s). The planted side is twins/reads_hold_the_clock.
import { describe, test } from 'vitest';
import { AC, CELLS, FLICKS, SESSION, SPACING, TIMEOUT, brief, must, nth, openSide, prebuild, replyOf, tempDir, world } from './helpers.ts';

prebuild();

const ROW = 'ROWS AT TWO SECONDS';
const ARRIVES = 2 * FLICKS;
const OPEN = { call: 'terminal_open', terminal: 'tty-2694', session: SESSION, cols: 40, rows: 3, feed: [{ at: ARRIVES, text: ROW }] };
/** Reads to 3 s on the side's clock. */
const READS = 35;
/** The first read at 2 s: the n-th read plays at n + 1 spacings. */
const FIRST_AT = ARRIVES / SPACING - 1;
const seconds = (flicks: number): string => `${(flicks / FLICKS).toFixed(3)} s`;

describe(`${AC[3]} what arrives by time still arrives while only reads come`, () => {
  test(`${AC[3]} a scripted terminal's row that arrives at 2 s shows from the first read at 2 s on the side's clock (the ${nth(FIRST_AT)}), and in no read before`, async () => {
    const side = await openSide(world(tempDir('ac3')));
    const opened = replyOf(await side.call(OPEN), 'terminal_open');
    must(opened['opened'] === true, `the side opens the session's terminal: ${brief(opened, 600)}`);
    const shown: number[] = [];
    for (let n = 1; n <= READS; n++) {
      const reply = replyOf(await side.call(CELLS), `the ${nth(n)} cells read`);
      must(Array.isArray(reply['text']), `the ${nth(n)} cells read gives the terminal's rows as text: ${brief(reply, 600)}`);
      if ((reply['text'] as unknown[]).some((row) => typeof row === 'string' && row.includes(ROW))) shown.push(n);
    }
    side.close();
    must(shown.length > 0, `no read of ${READS} shows the row "${ROW}", which arrives at ${seconds(ARRIVES)}: the ${nth(FIRST_AT)} to the ${nth(READS)} read are at ${seconds((FIRST_AT + 1) * SPACING)} to ${seconds((READS + 1) * SPACING)} on the side's clock when each call moves it`);
    const early = shown.filter((n) => n < FIRST_AT);
    must(early.length === 0, `the row "${ROW}", which arrives at ${seconds(ARRIVES)}, shows before the side's clock is there: in ${early.map((n) => `the ${nth(n)} read, at ${seconds((n + 1) * SPACING)}`).join('; ')}`);
    const missing = Array.from({ length: READS - FIRST_AT + 1 }, (_, i) => FIRST_AT + i).filter((n) => !shown.includes(n));
    must(missing.length === 0, `the row "${ROW}" doesn't show in ${missing.map((n) => `the ${nth(n)} read, at ${seconds((n + 1) * SPACING)}`).join('; ')}, though it arrives at ${seconds(ARRIVES)}`);
  }, TIMEOUT);
});
