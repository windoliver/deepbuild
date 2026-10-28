// AC1: a view popped out to a second display reopens there; and the window rules the criteria lean on: a pop-out
// needs your serial from your input in that panel, and nothing opens or moves a window by itself. Driven through
// `deep-show run` with two displays on the virtual display clock (README: The surface under test). At the base
// `deep-show` reads no `displays`, `layout` or window calls and answers every scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  A, ALPHA, B, DOC, Driver, MS, PERIOD_A, PERIOD_B, ask, cardCall, clickPanel, inside, layoutCall, moveWindow, obj, onGrid, opened, popOut,
  presentedCall, refusedReply, framesOf, useOut, useShow, view, windowsCall, windowsOf, type Display, type JsonObject, type JsonValue, type Planted,
  type Rect, type Win,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 20 * PERIOD_A;
const VIEWS = [
  { doc: DOC.x, panel: 'x', document: view('Orders by day') },
  { doc: DOC.y, panel: 'y', document: view('Refunds by hour') },
  { doc: DOC.z, panel: 'z', document: view('Checks on the migration') },
];
/** At restore the displays are listed the other way round and B sits left of A, so a window restored by its index in the list or by its old global position lands off B. */
const B_MOVED: Display = { ...B, bounds: [-1920, -98, 1920, 1080] };

/** Run 1: y popped out windowed onto B, z popped out full screen onto B, each with your serial; returns the layout saved. */
function firstRun(): { y: Win; z: Win; windows: Win[]; layout: JsonValue } {
  const d = new Driver(show(), { evidence: out(), displays: [A, B], docs: VIEWS });
  const sy = clickPanel(d, T0, 'y', 'run 1');
  const y = opened(d.one(popOut(T0 + 100 * MS, 'y', B.uuid, sy), 'run 1: pop y out onto B'), 'run 1: pop y out onto B');
  const sz = clickPanel(d, T0 + 200 * MS, 'z', 'run 1');
  const z = opened(d.one(popOut(T0 + 300 * MS, 'z', B.uuid, sz, { full_screen: true }), 'run 1: pop z out full screen onto B'), 'run 1: pop z out full screen onto B');
  const [w, l] = d.step([windowsCall(T0 + 400 * MS), layoutCall(T0 + 500 * MS)], 'run 1: windows and layout');
  return { y, z, windows: windowsOf(w, 'run 1: windows'), layout: obj(l, 'run 1: layout')['layout'] ?? null };
}

/** Run 2: the app restarts with run 1's layout, the displays listed B first and B moved; the windows it opens, and y's presented frames. */
function restoreRun(layout: JsonValue, planted?: Planted): { windows: Win[]; yFrames: ReturnType<typeof framesOf> } {
  const d = new Driver(show(), { evidence: out(), displays: [B_MOVED, A], docs: VIEWS, layout, ...(planted ? { planted } : {}) });
  const [w, f] = d.step([windowsCall(T0), presentedCall(T0 + 200 * MS, 'y')], `run 2: restore${planted ? ` (planted ${planted})` : ''}`);
  return { windows: windowsOf(w, 'run 2: windows'), yFrames: framesOf(f, 'run 2: presented frames of y') };
}

/** What a restore got wrong: each popped view reopens on B by UUID, inside B's new bounds, as it was, opened by the restore, and y is paced by B. */
function restoreFailures(r: ReturnType<typeof restoreRun>): string[] {
  const f: string[] = [];
  const of = (view: string): Win | undefined => r.windows.find((w) => w.view === view);
  const y = of('y');
  const z = of('z');
  const main = r.windows.find((w) => w.kind === 'main');
  if (!main) f.push('no main window after the restore');
  else if (main.display !== A.uuid) f.push(`the main window reopened on ${main.display}, not on A (${A.uuid}) where it was`);
  if (!y) f.push('y did not reopen in a window of its own');
  else {
    if (y.kind !== 'popped') f.push(`y reopened as ${y.kind}, not popped`);
    if (y.display !== B.uuid) f.push(`y reopened on display ${y.display}, not on B (${B.uuid}) where it was popped out`);
    if (!inside(B_MOVED.bounds, y.rect)) f.push(`y's window ${JSON.stringify(y.rect)} is not inside B's bounds ${JSON.stringify(B_MOVED.bounds)}`);
    if (y.opened_by !== 'restore') f.push(`y's window was opened by ${String(y.opened_by)}, not restore`);
  }
  if (!z) f.push('z did not reopen in a window of its own');
  else {
    if (z.kind !== 'full_screen') f.push(`z reopened as ${z.kind}, not full_screen`);
    if (z.display !== B.uuid) f.push(`z reopened on display ${z.display}, not on B (${B.uuid}) where it was full screen`);
    if (JSON.stringify(z.rect) !== JSON.stringify(B_MOVED.bounds)) f.push(`z's full-screen window ${JSON.stringify(z.rect)} does not fill B's bounds ${JSON.stringify(B_MOVED.bounds)}`);
    if (z.opened_by !== 'restore') f.push(`z's window was opened by ${String(z.opened_by)}, not restore`);
  }
  if (r.windows.length !== 3) f.push(`the restore opened ${r.windows.length} windows, not the 3 the layout holds: ${JSON.stringify(r.windows)}`);
  // Remembered by display UUID for pacing too: y's frames are B's, at B's vsyncs.
  if (r.yFrames.length === 0) f.push('y presented no frame after the restore');
  r.yFrames.forEach((fr, i) => {
    if (fr.display !== B.uuid) f.push(`y's frame ${i} is paced by ${fr.display}, not B`);
    if (!onGrid(B_MOVED, fr.vsync)) f.push(`y's frame ${i} presents at ${fr.vsync}, not one of B's vsyncs (${B.next_vsync} + k × ${PERIOD_B})`);
    if (y && fr.window !== y.window) f.push(`y's frame ${i} names window ${fr.window}, not y's window ${y.window}`);
  });
  return f;
}

describe('AC1 a view popped out to a second display reopens there', () => {
  it('AC1 a view popped out onto B, and one full screen there, are in the layout on B and reopen on B by its UUID after a restart', () => {
    const first = firstRun();
    // The pop-outs themselves: y windowed on B, z full screen on B, each opened by your serial.
    expect(first.y.kind, 'y pops out into a window of its own').toBe('popped');
    expect(first.y.view, 'the popped window shows y').toBe('y');
    expect(first.y.display, 'y pops out onto B').toBe(B.uuid);
    expect(inside(B.bounds, first.y.rect), `y's window ${JSON.stringify(first.y.rect)} is inside B ${JSON.stringify(B.bounds)}`).toBe(true);
    expect(first.y.opened_by, 'y\'s window is opened by your serial').toBe('serial');
    expect(first.z.kind, 'z pops out full screen').toBe('full_screen');
    expect(first.z.display, 'z is full screen on B').toBe(B.uuid);
    expect(first.z.rect, 'z\'s full-screen window fills B').toEqual(B.bounds);
    expect(first.windows.map((w) => [w.kind, w.view, w.display]).sort(), 'run 1 has the main window on A and the two pop-outs on B').toEqual(
      [['full_screen', 'z', B.uuid], ['main', null, A.uuid], ['popped', 'y', B.uuid]].sort(),
    );
    // Remembered in the layout, by B's UUID.
    const rows = (obj(first.layout === null ? undefined : (first.layout as JsonObject), 'the layout')['windows'] ?? []) as JsonValue[];
    const row = (v: string): JsonObject | undefined => rows.find((w) => typeof w === 'object' && w !== null && !Array.isArray(w) && w['view'] === v) as JsonObject | undefined;
    expect(row('y')?.['display'], 'the layout remembers y on B by its UUID').toBe(B.uuid);
    expect(row('z')?.['display'], 'the layout remembers z on B by its UUID').toBe(B.uuid);
    expect(row('z')?.['kind'], 'the layout remembers z full screen').toBe('full_screen');

    expect(restoreFailures(restoreRun(first.layout)), 'after a restart with the displays reordered and B moved, each view reopens on B').toEqual([]);
    // Wrong program: a restore that puts popped views on the main display fails, naming the views.
    const twin = restoreFailures(restoreRun(first.layout, 'restores_to_main'));
    expect(twin.some((m) => m.startsWith('y reopened on display')), `the planted restores_to_main fails, naming y: ${JSON.stringify(twin.slice(0, 4))}`).toBe(true);
  }, 600_000);
});

describe('the window rules AC1 and AC2 lean on: a pop-out needs your serial, and nothing opens or moves a window by itself', () => {
  it('a pop-out without a serial, with another panel\'s serial, or asked by an agent is refused and opens nothing; with y\'s own serial it opens', () => {
    const d = new Driver(show(), { evidence: out(), displays: [A, B], docs: VIEWS });
    const sx = clickPanel(d, T0, 'x', 'refusals');
    const sy = clickPanel(d, T0 + 100 * MS, 'y', 'refusals');
    const replies = d.step([
      popOut(T0 + 200 * MS, 'y', B.uuid),
      popOut(T0 + 210 * MS, 'y', B.uuid, sx),
      popOut(T0 + 220 * MS, 'y', B.uuid, sy, { session: ALPHA.id }),
      windowsCall(T0 + 230 * MS),
    ], 'refusals');
    refusedReply(replies[0], 'a pop-out of y with no serial');
    refusedReply(replies[1], 'a pop-out of y with the serial of your input in x');
    refusedReply(replies[2], 'a pop-out of y asked by alpha\'s session');
    const after = windowsOf(replies[3], 'windows after the refusals');
    expect(after.map((w) => w.kind), 'only the main window is open').toEqual(['main']);
    // The control: the same pop-out with a serial of your input in y opens y's window on B.
    const sy2 = clickPanel(d, T0 + 300 * MS, 'y', 'refusals');
    const y = opened(d.one(popOut(T0 + 400 * MS, 'y', B.uuid, sy2), 'a pop-out of y with your serial from y'), 'a pop-out of y with your serial from y');
    expect([y.kind, y.view, y.display, y.opened_by], 'y pops out onto B, opened by your serial').toEqual(['popped', 'y', B.uuid, 'serial']);
  }, 600_000);

  it('an agent\'s patches, an ask and its card, and an agent\'s move_window never open, move or resize a window', () => {
    const d = new Driver(show(), { evidence: out(), displays: [A, B], docs: VIEWS, card: ask(T0 + 600 * MS) });
    const sy = clickPanel(d, T0, 'y', 'still');
    const y = opened(d.one(popOut(T0 + 100 * MS, 'y', B.uuid, sy), 'pop y out onto B'), 'pop y out onto B');
    const [before] = d.step([windowsCall(T0 + 200 * MS)], 'windows after the pop-out');
    const moved: Rect = [B.bounds[0] + 10, B.bounds[1] + 10, 300, 200];
    const calls: JsonObject[] = [
      // alpha re-sends y's document and x's, so both windows have something new to draw.
      { call: 'deep_show', session: ALPHA.id, doc: DOC.y, document: view('Refunds by hour, again'), include: ['issues'], at: T0 + 300 * MS },
      { call: 'deep_show', session: ALPHA.id, doc: DOC.x, document: view('Orders by day, again'), include: ['issues'], at: T0 + 400 * MS },
      moveWindow(T0 + 500 * MS, y.window, moved, { session: ALPHA.id }),
      cardCall(T0 + 1_400 * MS),
      windowsCall(T0 + 1_500 * MS),
    ];
    const r = d.step(calls, 'an agent\'s calls and an ask');
    refusedReply(r[2], 'alpha\'s move_window of y\'s window');
    const card = obj(r[3], 'the card')['card'];
    expect(card, 'the ask\'s card is presented (so the run did reach it)').not.toBeNull();
    expect(windowsOf(r[4], 'windows at the end'), 'every window is where you left it: same windows, displays and rects').toEqual(windowsOf(before, 'windows after the pop-out'));
  }, 600_000);
});
