// AC7: a terminal row wrapped across two grid rows copies as one line with no trailing blanks (README, AC7).
import { describe, expect, it } from 'vitest';
import { cellPoint, copyFailure, gridShows, openTerminalTab, Replica, SESSION, TAG, useDrive } from './helpers.ts';

useDrive();

const SIZE: [number, number] = [24, 6];
// One line of 39 characters on a 24-column grid: the emulator wraps it after its 24th, a space, so grid row 0 is
// "rsync: wrote harbor app " and row 1 "files to backup" with 9 blank cells after it.
const LINE = 'rsync: wrote harbor app files to backup';

describe(`${TAG.ac7} AC7: a soft-wrapped terminal row copies as one line with no trailing blanks`, () => {
  it('a drag over both grid rows of the wrapped line, to the last column, copies the line the program wrote', async () => {
    expect(LINE.length, 'the fixture\'s line wraps once').toBeGreaterThan(SIZE[0]);
    expect(LINE[SIZE[0] - 1], 'the fixture\'s line has a space in the last cell of its first row').toBe(' ');
    const r = await Replica.launch();
    await r.terminal(SESSION.build, { size: SIZE, output: `${LINE}\r\ndone\r\n` });
    await r.openSession(SESSION.build);
    await openTerminalTab(r);
    await gridShows(r, 1, LINE.slice(SIZE[0]));
    const from = await cellPoint(r, SIZE, 0, 0, 'start');
    const to = await cellPoint(r, SIZE, SIZE[0] - 1, 1, 'end');
    await r.mark('dd1498-ac7');
    await r.drag(from, to, 'hid');
    const failure = copyFailure('a drag from the first cell of grid row 0 to the last of row 1, then ⌘C', LINE, await r.copy('hid', 'dd1498-ac7'));
    expect(failure).toBeNull();
  });
});
