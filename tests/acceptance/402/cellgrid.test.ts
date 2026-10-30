// AC4: a cell grid fed by a busy terminal's changes keeps up at 60 updates a second. A busy terminal repaints its whole
// screen 60 times a second (every update a patch of 36 rows); the grid (`cells@1`, one glyph batch) draws each patch in
// the frame that is the first after its latch, on the 120 Hz display and, popped out, on the 60 Hz one, none dropped or
// late, and ends on the screen the output makes. A grid that draws every patch a frame late fails, naming the update.
// The SCOPE tests read the fields the issue lists (the cell's fields, the cursor, scroll, links, modes, title, cwd,
// progress, bell, the patch re-uploading only its rows) and the "It can never" list where an observable exists; they
// aren't claimed as criteria. At the base `deep-show run` has no `terminal_open` call (or `install`).
import { describe, expect, it } from 'vitest';
import {
  A, B, Driver, MS, PERIOD_B, SEC, SLOTS, at, cellOf, centre, down, gridOf, keepUpProblems, lineText, num, obj, openCall, terminalPlugin, updatesOf, upAt,
  useOut, useShow, type JsonObject, type World,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 3 * SEC;
const STEP = SEC / 60;
const N = 600;
const ROWS = 36;
const world = (terminals: Record<string, string>, planted?: string): World => ({
  evidence: out(), panels: Object.fromEntries(Object.keys(terminals).map((p, i) => [p, SLOTS[i]!])), plugins: { terminals: terminalPlugin(terminals) }, ...(planted ? { planted } : {}),
});

/** Row r of frame k of a busy screen: 56 characters that change with k and r. */
const busyRow = (k: number, r: number): string => `F${String(k).padStart(5, '0')} R${String(r).padStart(2, '0')} ${lineText(k * 100 + r).slice(1, 41)}`;
/** One update: home, then every row rewritten (the cursor ends on the last row). */
const busyUpdate = (k: number): string => `\u001b[H${Array.from({ length: ROWS }, (_, r) => `${busyRow(k, r)}\u001b[K`).join('\r\n')}`;
const arrivals = Array.from({ length: N }, (_, k) => T0 + k * STEP);
const BUSY = arrivals.map((t, k) => ({ at: t, text: busyUpdate(k) }));

function play(bin: string, popped: boolean, planted?: string): { updates: ReturnType<typeof updatesOf>; grid: ReturnType<typeof gridOf> } {
  const d = new Driver(bin, world({ screen: 'T1' }, planted));
  const centreOf = centre(SLOTS[0]!);
  const [press] = d.step([openCall(SEC, 'T1', { panel: 'screen', cols: 120, rows: ROWS, feed: BUSY }), down(SEC + 100 * MS, 'screen', centreOf), upAt(SEC + 160 * MS, 'screen', centreOf)], 'a busy terminal opens and you click it');
  const pop: JsonObject[] = popped ? [{ call: 'pop_out', at: 2 * SEC, panel: 'screen', display: B.uuid, serial: num(obj(press, 'the press')['serial'], 'serial') }] : [];
  const end = T0 + N * STEP + SEC;
  const r = d.step([...pop, at('updates', end, { terminal: 'T1' }), at('cells', end, { terminal: 'T1' })], `a busy terminal, 600 updates${popped ? ' on B' : ' on A'}${planted ? ` (planted ${planted})` : ''}`);
  return { updates: updatesOf(r[r.length - 2], 'updates'), grid: gridOf(r[r.length - 1], 'the grid') };
}

describe('AC4 a cell grid fed by a busy terminal\'s changes keeps up at 60 updates a second', () => {
  it('AC4 600 full-screen repaints at 60 a second: each patch is drawn in its frame on the 120 Hz display, none dropped or late, and the grid ends on the last repaint; a grid a frame late fails, naming the update', () => {
    const run = play(show(), false);
    expect(keepUpProblems(run.updates, arrivals, A, 'grid on A'), 'every patch drawn in its frame').toEqual([]);
    expect(run.grid.text, 'the grid shows the last repaint').toEqual(Array.from({ length: ROWS }, (_, r) => busyRow(N - 1, r)));
    expect(run.grid.drawnBy, 'drawn by the cells module').toBe('cells@1');
    expect(run.updates.every((u) => u.rows === ROWS), 'a repaint is a patch of all 36 rows').toBe(true);
    const twin = keepUpProblems(play(show(), false, 'cells_a_frame_late').updates, arrivals, A, 'grid on A');
    expect(twin.some((m) => /update \d+ .*(more than one frame|late)/.test(m)), `the planted cells_a_frame_late fails, naming an update: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 900_000);

  it('AC4 the same on the 60 Hz display, popped out onto B: one B frame for each patch', () => {
    const phase = B.next_vsync % PERIOD_B;
    const run = play(show(), true);
    expect(keepUpProblems(run.updates, arrivals, { period: PERIOD_B, phase }, 'grid on B'), 'every patch drawn in its own B frame').toEqual([]);
    expect(run.grid.text, 'the same last repaint').toEqual(Array.from({ length: ROWS }, (_, r) => busyRow(N - 1, r)));
    const twin = keepUpProblems(play(show(), true, 'cells_a_frame_late').updates, arrivals, { period: PERIOD_B, phase }, 'grid on B');
    expect(twin.some((m) => /update \d+ /.test(m)), `the planted cells_a_frame_late fails on B too: ${JSON.stringify(twin.slice(0, 3))}`).toBe(true);
  }, 900_000);
});

// ---------------------------------------------------------------------------------------------------
// SCOPE: the cell grid's fields (Cell grid `cells@1`), read from a terminal's escapes

describe('SCOPE the cell grid carries its cells, cursor, scroll, links, modes and the terminal\'s title, cwd, progress and bell', () => {
  const FEED = [{
    at: T0,
    text: [
      '\u001b]2;build: billing\u0007', '\u001b]7;file://localhost/Users/me/billing\u001b\\', '\u001b]9;4;1;42\u001b\\', '\u0007',
      'éx\r\n',
      '\u001b[1;38;2;18;52;86mB\u001b[0m\r\n',
      '\u001b]8;;https://example.com/a\u001b\\link\u001b]8;;\u001b\\ plain\r\n',
      '\u001b[6 q\u001b[?25l', '\u001b[?2004h\u001b[?1h\u001b[?1004h\u001b[?1000h\u001b[?1006h',
    ].join(''),
  }];

  it('SCOPE the escapes fill title, cwd, progress and bell; the grid keeps the cell\'s grapheme, colors, attributes and link, the cursor\'s place and shape, and the modes', () => {
    const d = new Driver(show(), world({ screen: 'T1' }));
    const t = T0 + SEC;
    const r = d.step([openCall(SEC, 'T1', { panel: 'screen', cols: 80, rows: 24, feed: FEED }), at('cells', t, { terminal: 'T1' }),
      at('cell', t, { terminal: 'T1', x: 0, y: 0 }), at('cell', t, { terminal: 'T1', x: 1, y: 0 }), at('cell', t, { terminal: 'T1', x: 0, y: 1 }),
      at('cell', t, { terminal: 'T1', x: 0, y: 2 }), at('cell', t, { terminal: 'T1', x: 5, y: 2 })], 'the escapes');
    const g = gridOf(r[1], 'the grid');
    expect([g.cols, g.rows], 'the size').toEqual([80, 24]);
    expect(g.title, 'OSC 2').toBe('build: billing');
    expect(g.cwd ?? '', 'OSC 7').toContain('/Users/me/billing');
    expect(g.progress, 'OSC 9;4 at 42%').toBeCloseTo(0.42, 5);
    expect(g.bell, 'one BEL').toBe(1);
    expect(g.text.slice(0, 3), 'the rows').toEqual(['éx', 'B', 'link plain']);
    expect(g.cursor, 'a steady bar, hidden, on the row after the last line').toMatchObject({ x: 0, y: 3, shape: 'bar', visible: false, blink: false });
    expect(g.modes, 'the modes the program asked for').toMatchObject({ alt_screen: false, bracketed_paste: true, app_cursor: true, focus_events: true, mouse: 'sgr' });
    expect(cellOf(r[2], 'cell 0,0').g, 'a grapheme of two code points is one cell\'s').toBe('é');
    expect(cellOf(r[3], 'cell 1,0').g, 'the next cell is the next character').toBe('x');
    const bold = cellOf(r[4], 'cell 0,1');
    expect(bold.g).toBe('B');
    expect(bold.attrs, 'the attribute names the frame lists').toContain('bold');
    expect(bold.fg.toLowerCase(), 'a truecolor foreground').toBe('#123456');
    const link = cellOf(r[5], 'cell 0,2');
    expect(link.link, 'a hyperlinked cell has a link ID').not.toBeNull();
    expect(g.links[link.link!], 'and the frame maps the ID to its URL').toBe('https://example.com/a');
    expect(cellOf(r[6], 'cell 5,2').link, 'a cell after the link has none').toBeNull();
  });

  it('SCOPE the alternate screen is a mode: while on, the grid shows it and mode alt_screen is true; leaving it shows the main screen as it was', () => {
    const feed = [{ at: T0, text: 'main\r\n' }, { at: T0 + SEC, text: '\u001b[?1049hALT' }, { at: T0 + 3 * SEC, text: '\u001b[?1049l' }];
    const d = new Driver(show(), world({ screen: 'T1' }));
    const r = d.step([openCall(SEC, 'T1', { panel: 'screen', cols: 40, rows: 10, feed }), at('cells', T0 + 2 * SEC, { terminal: 'T1' }), at('cells', T0 + 4 * SEC, { terminal: 'T1' })], 'the alternate screen');
    const on = gridOf(r[1], 'on'), off = gridOf(r[2], 'off');
    expect(on.modes['alt_screen'], 'on the alternate screen').toBe(true);
    expect(on.text[0], 'it shows what the program drew there').toBe('ALT');
    expect(off.modes['alt_screen'], 'off again').toBe(false);
    expect(off.text[0], 'the main screen is back').toBe('main');
  });

  it('SCOPE a patch re-uploads only its rows: an update that changes one row is a patch of one row', () => {
    const feed = [{ at: T0, text: 'one\r\ntwo\r\nthree\r\n' }, { at: T0 + SEC, text: '\u001b[2;1HTWO' }];
    const d = new Driver(show(), world({ screen: 'T1' }));
    const r = d.step([openCall(SEC, 'T1', { panel: 'screen', cols: 40, rows: 10, feed }), at('updates', T0 + 2 * SEC, { terminal: 'T1' })], 'a one-row patch');
    const u = updatesOf(r[1], 'updates');
    expect(u.map((x) => x.rows), 'the first update changes three rows, the second one').toEqual([3, 1]);
  });

  it('SCOPE a long output scrolls: the rows that leave the top are history, and the offset is 0 at the bottom', () => {
    const feed = [{ at: T0, text: Array.from({ length: 30 }, (_, i) => `row ${i + 1}\r\n`).join('') }];
    const d = new Driver(show(), world({ screen: 'T1' }));
    const g = gridOf(d.step([openCall(SEC, 'T1', { panel: 'screen', cols: 40, rows: 10, feed }), at('cells', T0 + SEC, { terminal: 'T1' })], 'a long output')[1], 'the grid');
    expect([g.history, g.offset], '21 rows of 30 lines went off a 10-row screen, with the cursor row empty').toEqual([21, 0]);
    expect(g.text[0], 'the screen starts at line 22').toBe('row 22');
  });
});

// ---------------------------------------------------------------------------------------------------
// SCOPE: "It can never: Hold a selection" (selection and copy belong to the app, as session state)

describe('SCOPE the cell grid holds no selection', () => {
  it('SCOPE dragging across the grid with the pointer leaves no selection in the grid\'s state', () => {
    const feed = [{ at: T0, text: 'select me please\r\n' }];
    const d = new Driver(show(), world({ screen: 'T1' }));
    const s = SLOTS[0]!;
    const start: [number, number] = [s[0] + 10, s[1] + 10], end: [number, number] = [s[0] + 200, s[1] + 10];
    const r = d.step([openCall(SEC, 'T1', { panel: 'screen', cols: 80, rows: 24, feed }), down(T0 + SEC, 'screen', start),
      { call: 'input', at: T0 + SEC + 20 * MS, panel: 'screen', event: { type: 'move', pos: end } }, upAt(T0 + SEC + 40 * MS, 'screen', end), at('cells', T0 + 2 * SEC, { terminal: 'T1' })], 'a drag');
    const g = gridOf(r[4], 'the grid');
    expect(Object.keys(g.raw).filter((k) => /select/i.test(k)), 'the grid state has no selection field').toEqual([]);
  });
});
