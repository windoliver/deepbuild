// AC1: a terminal keeps up at 60 updates a second. Read deterministically on the virtual display clock (#400's displays,
// #401's input and pop-out): 600 updates, one every 1/60 s from a recorded feed, each presented in the frame that is the
// first after its latch, on the 120 Hz display and, popped out, on the 60 Hz one, none dropped, merged or late, the
// revisions chained, the final grid what the output makes. The wall-time half is budgets.test.ts. A terminal that applies
// at most 30 updates a second fails, naming the first update it loses. At the base `deep-show run` has no `terminal_open`
// call (or `install`) and answers every scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  A, B, Driver, PERIOD_B, SEC, SLOTS, at, down, gridOf, keepUpProblems, lineText, num, obj, openCall, terminalPlugin, updatesOf, upAt, centre, MS,
  useOut, useShow, type World,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 3 * SEC;
const STEP = SEC / 60; // 11,760,000 flicks: 60 updates a second
const N = 600;
const ROWS = 36;
const arrivals = Array.from({ length: N }, (_, k) => T0 + k * STEP);
/** One line of numbered output a tick, as a program printing 60 lines a second writes it. */
const FEED = arrivals.map((t, k) => ({ at: t, text: `${lineText(k + 1)}\r\n` }));
const world = (planted?: string): World => ({ evidence: out(), panels: { screen: SLOTS[0]! }, plugins: { terminals: terminalPlugin({ screen: 'T1' }) }, ...(planted ? { planted } : {}) });

/** What a 36-row screen shows after N lines and the newline after the last: the last 35 lines and the empty row the cursor is on. */
const expectedScreen = (): string[] => [...Array.from({ length: ROWS - 1 }, (_, i) => lineText(N - (ROWS - 2) + i)), ''];

/** One run: the terminal opens in panel `screen`, optionally popped out onto B (with your click's serial), 600 updates, then its updates and its grid. */
function play(bin: string, popped: boolean, planted?: string): { updates: ReturnType<typeof updatesOf>; grid: ReturnType<typeof gridOf> } {
  const d = new Driver(bin, world(planted));
  const open = openCall(SEC, 'T1', { panel: 'screen', cols: 120, rows: ROWS, feed: FEED });
  const [press] = d.step([open, down(SEC + 100 * MS, 'screen', centre(SLOTS[0]!)), upAt(SEC + 160 * MS, 'screen', centre(SLOTS[0]!))], 'the terminal opens and you click it');
  const calls: ReturnType<typeof at>[] = [];
  if (popped) {
    const serial = num(obj(press, 'the press')['serial'], 'the press\'s serial');
    calls.push({ call: 'pop_out', at: 2 * SEC, panel: 'screen', display: B.uuid, serial });
  }
  const end = T0 + N * STEP + SEC;
  const replies = d.step([...calls, at('updates', end, { terminal: 'T1' }), at('cells', end, { terminal: 'T1' })], `600 updates${popped ? ' on B' : ' on A'}${planted ? ` (planted ${planted})` : ''}`);
  return { updates: updatesOf(replies[replies.length - 2], 'updates'), grid: gridOf(replies[replies.length - 1], 'the grid') };
}

describe('AC1 a terminal keeps up at 60 updates a second', () => {
  it('AC1 600 updates at 60 a second on the 120 Hz display: each is presented within one frame, none dropped, merged or late, and the grid is what the output makes; a terminal that applies 30 a second fails, naming the update', () => {
    const run = play(show(), false);
    expect(keepUpProblems(run.updates, arrivals, A, 'terminal on A'), 'every update presented in its frame').toEqual([]);
    expect(run.grid.text, 'the grid after 600 lines is the last 35 lines and the empty row under them').toEqual(expectedScreen());
    expect(run.grid.history, 'the 565 lines that scrolled off the top are kept, in order').toBe(N - (ROWS - 1));
    expect(run.grid.revision, 'the grid is at the revision of its 600th update').toBe(run.updates[N - 1]!.revision);
    expect(run.grid.drawnBy, 'the grid is drawn by the cells module').toBe('cells@1');
    // Wrong program: a terminal that applies at most 30 updates a second.
    const twin = keepUpProblems(play(show(), false, 'terminal_30_per_second').updates, arrivals, A, 'terminal on A');
    expect(twin.some((m) => /update \d+ .*(never presented|was dropped|shares its frame)/.test(m)), `the planted terminal_30_per_second fails, naming an update: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 900_000);

  it('AC1 the same on the 60 Hz display, where each update has one frame to itself: popped out onto B, every update is in its own B frame, one frame late at most', () => {
    const run = play(show(), true);
    expect(keepUpProblems(run.updates, arrivals, { period: PERIOD_B, phase: B.next_vsync % PERIOD_B }, 'terminal on B'), 'every update presented in a frame of B').toEqual([]);
    expect(run.grid.text, 'the grid is the same').toEqual(expectedScreen());
    const twin = keepUpProblems(play(show(), true, 'terminal_30_per_second').updates, arrivals, { period: PERIOD_B, phase: B.next_vsync % PERIOD_B }, 'terminal on B');
    expect(twin.some((m) => /update \d+ /.test(m)), `the planted terminal_30_per_second fails on B too: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 900_000);
});

