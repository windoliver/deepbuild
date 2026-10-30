// Blind redraft of terminal.test.ts's 60 Hz test (AC1: a terminal keeps up at 60 updates a second), from the criterion and
// the README's declared surface. 600 updates, one every 1/60 s from a recorded feed; the panel is popped out onto B, the
// 60 Hz display, with the serial of your click in it (the reply of the `input` press, not of `terminal_open`), and every
// update must be presented in a frame of B of its own, one frame late at most. A terminal that applies 30 updates a second
// fails, naming an update. At the base `deep-show run` has no `terminal_open` or `install` call and answers `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  B, Driver, MS, PERIOD_B, SEC, SLOTS, at, centre, down, gridOf, keepUpProblems, lineText, num, obj, openCall, openedOf, terminalPlugin, updatesOf, upAt,
  useOut, useShow, type JsonObject, type World,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 3 * SEC;
const STEP = SEC / 60; // 60 updates a second
const N = 600;
const ROWS = 36;
const arrivals = Array.from({ length: N }, (_, k) => T0 + k * STEP);
const FEED = arrivals.map((t, k) => ({ at: t, text: `${lineText(k + 1)}\r\n` }));
const B_FRAMES = { period: PERIOD_B, phase: B.next_vsync % PERIOD_B };
const world = (planted?: string): World => ({ evidence: out(), panels: { screen: SLOTS[0]! }, plugins: { terminals: terminalPlugin({ screen: 'T1' }) }, ...(planted ? { planted } : {}) });

/** The last 35 lines and the empty row the cursor is on, after N lines each ended by a newline. */
const expectedScreen = (): string[] => [...Array.from({ length: ROWS - 1 }, (_, i) => lineText(N - (ROWS - 2) + i)), ''];

function playOnB(bin: string, planted?: string): { updates: ReturnType<typeof updatesOf>; grid: ReturnType<typeof gridOf> } {
  const d = new Driver(bin, world(planted));
  const [opened, press] = d.step([
    openCall(SEC, 'T1', { panel: 'screen', cols: 120, rows: ROWS, feed: FEED }),
    down(SEC + 100 * MS, 'screen', centre(SLOTS[0]!)),
    upAt(SEC + 160 * MS, 'screen', centre(SLOTS[0]!)),
  ], 'the terminal opens and you click its panel');
  openedOf(opened!, 'terminal_open');
  const serial = num(obj(press, 'your press in the panel')['serial'], 'your press\'s reply: serial');
  const end = T0 + N * STEP + SEC;
  const popOut: JsonObject = { call: 'pop_out', at: 2 * SEC, panel: 'screen', display: B.uuid, serial };
  const [popped, updates, cells] = d.step([popOut, at('updates', end, { terminal: 'T1' }), at('cells', end, { terminal: 'T1' })], `600 updates on B${planted ? ` (planted ${planted})` : ''}`);
  expect(popped!['code'], `the pop-out onto B with your click's serial opens: ${JSON.stringify(popped).slice(0, 300)}`).toBeUndefined();
  expect(popped!['window'], 'the pop-out answers the window it opened').toBeDefined();
  return { updates: updatesOf(updates, 'updates'), grid: gridOf(cells, 'the grid') };
}

describe('AC1 a terminal keeps up at 60 updates a second', () => {
  it('AC1 the same on the 60 Hz display, where each update has one frame to itself: popped out onto B, every update is in its own B frame, one frame late at most', () => {
    const run = playOnB(show());
    expect(run.updates.length, 'one update for each of the 600 lines sent').toBe(N);
    expect(keepUpProblems(run.updates, arrivals, B_FRAMES, 'terminal on B'), 'every update presented in a frame of B, none dropped, merged or late').toEqual([]);
    expect(run.grid.text, 'after 600 lines the grid is the last 35 lines and the empty row under them').toEqual(expectedScreen());
    expect(run.grid.revision, 'the grid is at the revision of the 600th update').toBe(run.updates[N - 1]!.revision);
    const twin = keepUpProblems(playOnB(show(), 'terminal_30_per_second').updates, arrivals, B_FRAMES, 'terminal on B');
    expect(twin.some((m) => /update \d+ .*(was dropped|never presented|shares its frame|more than one frame)/.test(m)), `the planted terminal_30_per_second fails on B, naming an update: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 900_000);
});
