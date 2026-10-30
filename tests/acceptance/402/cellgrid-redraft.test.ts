// Blind redraft of cellgrid.test.ts's 60 Hz test (AC4: a cell grid fed by a busy terminal's changes keeps up at 60 updates
// a second), from the criterion and the README's declared surface. A busy terminal repaints its 36 rows 60 times a second;
// the panel is popped out onto B (the 60 Hz display) with the serial of your click in it (the `input` press's reply, not
// `terminal_open`'s), and each patch must be drawn in a B frame of its own, one frame late at most. A grid that draws each
// patch a frame late fails, naming an update. At the base `deep-show run` has no `terminal_open` or `install` call.
import { describe, expect, it } from 'vitest';
import {
  B, Driver, MS, PERIOD_B, SEC, SLOTS, at, centre, down, gridOf, keepUpProblems, lineText, num, obj, openCall, openedOf, terminalPlugin, updatesOf, upAt,
  useOut, useShow, type JsonObject, type World,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 3 * SEC;
const STEP = SEC / 60;
const N = 600;
const ROWS = 36;
const arrivals = Array.from({ length: N }, (_, k) => T0 + k * STEP);
const B_FRAMES = { period: PERIOD_B, phase: B.next_vsync % PERIOD_B };
const world = (planted?: string): World => ({ evidence: out(), panels: { screen: SLOTS[0]! }, plugins: { terminals: terminalPlugin({ screen: 'T1' }) }, ...(planted ? { planted } : {}) });

/** Row r of repaint k: 46 characters that change with k and r (so every repaint changes every row). */
const busyRow = (k: number, r: number): string => `F${String(k).padStart(5, '0')} R${String(r).padStart(2, '0')} ${lineText(k * 100 + r).slice(1, 36)}`;
/** One update: home, then every row rewritten and cleared to its end; the cursor ends on the last row. */
const busyUpdate = (k: number): string => `\u001b[H${Array.from({ length: ROWS }, (_, r) => `${busyRow(k, r)}\u001b[K`).join('\r\n')}`;
const BUSY = arrivals.map((t, k) => ({ at: t, text: busyUpdate(k) }));

function playOnB(bin: string, planted?: string): { updates: ReturnType<typeof updatesOf>; grid: ReturnType<typeof gridOf> } {
  const d = new Driver(bin, world(planted));
  const [opened, press] = d.step([
    openCall(SEC, 'T1', { panel: 'screen', cols: 120, rows: ROWS, feed: BUSY }),
    down(SEC + 100 * MS, 'screen', centre(SLOTS[0]!)),
    upAt(SEC + 160 * MS, 'screen', centre(SLOTS[0]!)),
  ], 'a busy terminal opens and you click its panel');
  openedOf(opened!, 'terminal_open');
  const serial = num(obj(press, 'your press in the panel')['serial'], 'your press\'s reply: serial');
  const end = T0 + N * STEP + SEC;
  const popOut: JsonObject = { call: 'pop_out', at: 2 * SEC, panel: 'screen', display: B.uuid, serial };
  const [popped, updates, cells] = d.step([popOut, at('updates', end, { terminal: 'T1' }), at('cells', end, { terminal: 'T1' })], `a busy terminal, 600 patches on B${planted ? ` (planted ${planted})` : ''}`);
  expect(popped!['code'], `the pop-out onto B with your click's serial opens: ${JSON.stringify(popped).slice(0, 300)}`).toBeUndefined();
  expect(popped!['window'], 'the pop-out answers the window it opened').toBeDefined();
  return { updates: updatesOf(updates, 'updates'), grid: gridOf(cells, 'the grid') };
}

describe('AC4 a cell grid fed by a busy terminal\'s changes keeps up at 60 updates a second', () => {
  it('AC4 the same on the 60 Hz display, popped out onto B: one B frame for each patch', () => {
    const run = playOnB(show());
    expect(run.updates.length, 'one patch for each of the 600 repaints sent').toBe(N);
    expect(keepUpProblems(run.updates, arrivals, B_FRAMES, 'grid on B'), 'every patch drawn in a B frame of its own, none dropped, merged or late').toEqual([]);
    expect(run.updates.map((u) => u.rows).filter((n) => n !== ROWS).length, 'a repaint is a patch of all 36 rows').toBe(0);
    expect(run.grid.text, 'the grid shows the last repaint').toEqual(Array.from({ length: ROWS }, (_, r) => busyRow(N - 1, r)));
    expect(run.grid.revision, 'the grid is at the revision of the 600th patch').toBe(run.updates[N - 1]!.revision);
    expect(run.grid.drawnBy, 'the grid is drawn by the cells module').toBe('cells@1');
    const twin = keepUpProblems(playOnB(show(), 'cells_a_frame_late').updates, arrivals, B_FRAMES, 'grid on B');
    expect(twin.some((m) => /update \d+ .*more than one frame/.test(m)), `the planted cells_a_frame_late fails on B, naming an update: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 900_000);
});
