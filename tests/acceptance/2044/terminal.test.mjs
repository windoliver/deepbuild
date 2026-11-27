// #2044 criterion 6: a cursor saved before the grid shrank comes back inside the grid, whether the program saved and
// restored it itself or entered and left the alternate screen.
// Run: node --test --test-concurrency=1 tests/acceptance/2044/terminal.test.mjs   (README.md beside this file)
//
// The reader feeds a terminal (`deep_canvas_cells::emulator::Terminal`) the program's bytes, resizes it between
// them and prints the grid it leaves, in a process of its own under a deadline; the test reads where the `x` is.
// Rows and columns are counted from 1, as the criterion and the cursor-position sequence count them.
import { after, test } from 'node:test';
import { answer, run, TEST_MS, tidy, xAt } from './helpers.mjs';

// The criterion's tag: `#2044.<first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed>`.
const AC6 = 'AC6 #2044.19a0d966';

after(tidy);

const ESC = '\x1b';
const hex = (text) => Buffer.from(text, 'latin1').toString('hex');
/**
 * The run the criterion describes, as the reader's steps: on a 200 by 50 grid the program moves the cursor to row
 * 50, column 200 (`ESC [ 50 ; 200 H`) and sends `before`; the grid is resized to 80 by 24; the program sends `after`
 * and prints `x`.
 */
const steps = (before, after) => ['terminal', '200x50', `feed=${hex(`${ESC}[50;200H${before}`)}`, 'resize=80x24', `feed=${hex(`${after}x`)}`];
const WANT = { cols: 80, rows: 24, row: 24, column: 80 };

test(`${AC6} a cursor moved to row 50, column 200 of a 200 by 50 grid and saved, then restored after the grid is resized to 80 by 24, prints x at row 24, column 80`, { timeout: TEST_MS }, () => {
  // Save is `ESC 7` and restore `ESC 8`.
  const got = answer(run(steps(`${ESC}7`, `${ESC}8`)), 'the emulator, restoring a cursor saved at row 50, column 200 after the grid was resized from 200 by 50 to 80 by 24,');
  xAt(got, WANT, 'after the program saved the cursor, the grid was resized and the program restored it');
});

test(`${AC6} the same holds when the program enters the alternate screen instead of saving and leaves it instead of restoring`, { timeout: TEST_MS }, () => {
  // Private mode 1049, the alternate screen a full-screen program enters and leaves: `ESC [ ? 1049 h` and `l`.
  const got = answer(run(steps(`${ESC}[?1049h`, `${ESC}[?1049l`)), 'the emulator, leaving the alternate screen it entered at row 50, column 200 after the grid was resized from 200 by 50 to 80 by 24,');
  xAt(got, WANT, 'after the program entered the alternate screen, the grid was resized and the program left it');
});
