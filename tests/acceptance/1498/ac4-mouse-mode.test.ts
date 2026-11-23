// AC4: with a terminal program's mouse mode on, the press reaches the program and the grid selects nothing (README, AC4).
import { describe, expect, it } from 'vitest';
import { cellPoint, copyFailure, gridShows, openTerminalTab, Replica, SESSION, TAG, useDrive, wroteFailure } from './helpers.ts';

useDrive();

const SIZE: [number, number] = [40, 6];
const ROW = 'Build finished without errors';
// The program's output: two lines, then mouse reporting on, as SGR (DECSET 1000 and 1006).
const OUTPUT = `Build log for harbor app\r\n${ROW}\r\n\u001b[?1000h\u001b[?1006h`;
// Cells 2 to 12 of row 1, left to right; SGR counts columns and rows from 1.
const [FROM, TO, Y] = [2, 12, 1];
const PRESS = `\u001b[<0;${FROM + 1};${Y + 1}M`;
const RELEASE = `\u001b[<0;${TO + 1};${Y + 1}m`;

describe(`${TAG.ac4} AC4: in mouse mode the press reaches the program and the grid selects nothing`, () => {
  it('sends the press and release to the program, copies nothing, and selects once mouse mode is off', async () => {
    const r = await Replica.launch();
    await r.terminal(SESSION.build, { size: SIZE, output: OUTPUT });
    await r.openSession(SESSION.build);
    await openTerminalTab(r);
    await gridShows(r, Y, ROW);
    const failures: string[] = [];

    const from = await cellPoint(r, SIZE, FROM, Y, 'start');
    const to = await cellPoint(r, SIZE, TO, Y, 'end');
    await r.mark('dd1498-ac4-mouse');
    await r.drag(from, to, 'hid');
    const copied = await r.copy('hid', 'dd1498-ac4-mouse');
    const selected = wroteFailure('with mouse mode on, a drag over the grid, then ⌘C', 'dd1498-ac4-mouse', copied);
    if (selected) failures.push(`${selected}: the grid selected text the program's mouse mode takes`);
    const input = await r.terminal(SESSION.build, {});
    if (!input.includes(PRESS)) failures.push(`the press didn't reach the program: its input ${JSON.stringify(input)} holds no ${JSON.stringify(PRESS)}`);
    if (!input.includes(RELEASE)) failures.push(`the release didn't reach the program: its input ${JSON.stringify(input)} holds no ${JSON.stringify(RELEASE)}`);

    // The control: with mouse mode off, the same drag selects those cells.
    await r.terminal(SESSION.build, { output: '\u001b[?1006l\u001b[?1000l' });
    await r.wait(500);
    await r.mark('dd1498-ac4-control');
    await r.drag(from, to, 'hid');
    const control = copyFailure('with mouse mode off, the same drag, then ⌘C', ROW.slice(FROM, TO + 1), await r.copy('hid', 'dd1498-ac4-control'));
    if (control) failures.push(control);

    expect(failures).toEqual([]);
  });
});
