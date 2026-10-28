// AC2: with views on two displays, the question card opens on the display you're using (the one with your latest
// input). AC4: a view you pop out and drag over part of the presented card keeps it unarmed while they overlap, and
// the card arms 500 ms after the window moves off; a card that arms under the app's own window fails, naming the
// window. Both on the hub's virtual display clock, through `deep-show run` (README: The surface under test). At the
// base `deep-show` has no displays, windows or card state and answers every scenario here `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  A, B, DOC, Driver, MS, PERIOD_A, ask, cardCall, cardOf, clickPanel, inside, moveWindow, opened, overlap, popOut, useOut, useShow, view, windowsCall,
  windowsOf, type Card, type Display, type JsonObject, type Planted, type Rect,
} from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 20 * PERIOD_A;
const VIEWS = [
  { doc: DOC.x, panel: 'x', document: view('Orders by day') },
  { doc: DOC.y, panel: 'y', document: view('Refunds by hour') },
];
const ARM_AFTER = 500 * MS; // Question card: arm_after is 500 ms

// ---- AC2. x stays in the main window on A; y pops out onto B. Then you use both, in one order or the other, and an
// ask arrives: its card opens on the display of the input you made last.
type Last = 'A' | 'B';
function cardAfter(last: Last, planted?: Planted): { card: Card; windows: ReturnType<typeof windowsOf> } {
  const ASK_AT = T0 + 600 * MS;
  const d = new Driver(show(), { evidence: out(), displays: [A, B], docs: VIEWS, card: ask(ASK_AT), ...(planted ? { planted } : {}) });
  const what = `last input on ${last}${planted ? ` (planted ${planted})` : ''}`;
  const sy = clickPanel(d, T0, 'y', what);
  opened(d.one(popOut(T0 + 100 * MS, 'y', B.uuid, sy), `${what}: pop y out onto B`), `${what}: pop y out onto B`);
  // y is now on B, x on A: use one, then the other.
  const [first, second] = last === 'A' ? ['y', 'x'] : ['x', 'y'];
  clickPanel(d, T0 + 200 * MS, first!, what);
  clickPanel(d, T0 + 350 * MS, second!, what);
  const [c, w] = d.step([cardCall(ASK_AT + 300 * MS), windowsCall(ASK_AT + 300 * MS)], `${what}: the card`);
  return { card: cardOf(c, `${what}: card`), windows: windowsOf(w, `${what}: windows`) };
}
function placeFailures(r: ReturnType<typeof cardAfter>, want: Display, askAt: number): string[] {
  const f: string[] = [];
  const { card } = r;
  if (card.display !== want.uuid) f.push(`the card opened on display ${card.display}, not on ${want === A ? 'A' : 'B'} (${want.uuid}), the display of your latest input`);
  if (!inside(want.bounds, card.rect)) f.push(`the card's rect ${JSON.stringify(card.rect)} is not inside that display's bounds ${JSON.stringify(want.bounds)}`);
  const win = r.windows.find((w) => w.window === card.window);
  if (!win) f.push(`the card names window ${card.window}, which is not open`);
  else if (win.display !== want.uuid) f.push(`the card draws in window ${card.window}, which is on ${win.display}, not on the display of your latest input`);
  if (card.states[0]?.state !== 'presented' || card.states[0].at < askAt) f.push(`the card's first state is ${JSON.stringify(card.states[0])}, not presented at or after the ask (${askAt})`);
  return f;
}

// ---- AC4. y pops out onto A, the display the card will open on; you click x in the main window, so the card opens
// on A; then you drag y's window over part of the card for 1.6 s, and off it.
interface Drag { card: Card; first: Card; early: Card; window: string; overlapRect: Rect; offRect: Rect; presentedAt: number; offAt: number; mid: Rect | undefined; end: Rect | undefined }
function dragRun(planted?: Planted): Drag {
  const ASK_AT = T0 + 700 * MS;
  const d = new Driver(show(), { evidence: out(), displays: [A, B], docs: VIEWS, card: ask(ASK_AT), ...(planted ? { planted } : {}) });
  const what = `the drag over the card${planted ? ` (planted ${planted})` : ''}`;
  const sy = clickPanel(d, T0, 'y', what);
  const y = opened(d.one(popOut(T0 + 100 * MS, 'y', A.uuid, sy), `${what}: pop y out onto A`), `${what}: pop y out onto A`);
  clickPanel(d, T0 + 200 * MS, 'x', what);
  const c0 = cardOf(d.one(cardCall(ASK_AT + 2 * PERIOD_A), `${what}: the card as presented`), `${what}: the card as presented`);
  const presentedAt = c0.states[0]?.at ?? ASK_AT;
  const R = c0.rect;
  const [ww, wh] = [y.rect[2], y.rect[3]];
  // y's window takes the card's bottom-right corner: 40 × 30 points of it, then wiggles 2 points while it stays.
  const overlapRect: Rect = [R[0] + R[2] - 40, R[1] + R[3] - 30, ww, wh];
  const offRect: Rect = [R[0] + R[2] + 20, R[1] + R[3] - 30, ww, wh];
  const calls: JsonObject[] = [];
  for (let k = 0; k < 16; k++) calls.push(moveWindow(presentedAt + (100 + 100 * k) * MS, y.window, [overlapRect[0] + (k % 2) * 2, overlapRect[1], ww, wh]));
  const offAt = presentedAt + 1_700 * MS;
  calls.push(windowsCall(presentedAt + 850 * MS), moveWindow(offAt, y.window, offRect), cardCall(offAt + ARM_AFTER - MS), cardCall(offAt + ARM_AFTER + PERIOD_A + 1), windowsCall(offAt + ARM_AFTER + PERIOD_A + 1));
  const r = d.step(calls, `${what}: the drag`);
  const n = calls.length;
  const winRect = (reply: JsonObject | undefined, w: string): Rect | undefined => windowsOf(reply, w).find((x) => x.window === y.window)?.rect;
  return {
    card: cardOf(r[n - 2], `${what}: the card after`), first: c0, early: cardOf(r[n - 3], `${what}: the card 499 ms after the window left`), window: y.window,
    overlapRect, offRect, presentedAt, offAt, mid: winRect(r[16], `${what}: windows mid-drag`), end: winRect(r[n - 1], `${what}: windows after`),
  };
}
function dragFailures(r: Drag): string[] {
  const initial = r.first;
  const f: string[] = [];
  const ms = (t: number): string => `${((t - r.presentedAt) / MS).toFixed(1)} ms after it was presented`;
  for (const s of r.card.states) {
    if (s.state === 'armed' && s.at < r.offAt) f.push(`the card armed at ${s.at} (${ms(s.at)}) while window ${r.window} overlapped it`);
    else if (s.state === 'armed' && s.at < r.offAt + ARM_AFTER) f.push(`the card armed at ${s.at}, ${((s.at - r.offAt) / MS).toFixed(1)} ms after window ${r.window} moved off it, before 500 ms`);
  }
  if (r.early.state === 'armed') f.push(`499 ms after window ${r.window} moved off, the card is already armed`);
  const armed = r.card.states.filter((s) => s.state === 'armed' && s.at >= r.offAt + ARM_AFTER);
  if (r.card.state !== 'armed' || armed.length === 0) f.push(`500 ms and a frame after window ${r.window} moved off, the card is ${r.card.state}, not armed`);
  else if (armed[0]!.at > r.offAt + ARM_AFTER + PERIOD_A) f.push(`the card armed ${((armed[0]!.at - r.offAt) / MS).toFixed(1)} ms after window ${r.window} moved off, more than a frame past 500 ms`);
  if (r.card.display !== initial.display || JSON.stringify(r.card.rect) !== JSON.stringify(initial.rect)) f.push(`the presented card moved: from ${initial.display} ${JSON.stringify(initial.rect)} to ${r.card.display} ${JSON.stringify(r.card.rect)}`);
  return f;
}

describe('AC2 with views on two displays, the question card opens on the display you\'re using', () => {
  it('AC2 x on A, y popped out onto B: the card opens on B after your last input in y, and on A after your last input in x', () => {
    const askAt = T0 + 600 * MS;
    const onB = cardAfter('B');
    expect(onB.windows.map((w) => [w.view, w.display]).sort(), 'views on two displays: the main window on A, y on B').toEqual([[null, A.uuid], ['y', B.uuid]].sort());
    expect(placeFailures(onB, B, askAt), 'your last input was in y, on B').toEqual([]);
    expect(placeFailures(cardAfter('A'), A, askAt), 'your last input was in x, on A').toEqual([]);
    // Wrong program: a card that always opens on the main window's display fails, naming the display.
    const twin = placeFailures(cardAfter('B', 'card_on_main_display'), B, askAt);
    expect(twin.some((m) => m.includes(`card opened on display ${A.uuid}`)), `the planted card_on_main_display fails: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);
});

describe('AC4 a popped-out window dragged over part of the presented card keeps it unarmed while they overlap; it arms 500 ms after the window moves off', () => {
  it('AC4 the card stays unarmed through 1.6 s of overlap and arms 500 ms after the window leaves; one that arms under the app\'s own window fails, naming the window', () => {
    const r = dragRun();
    expect(r.first.display, 'the card opens on A, the display of your latest input').toBe(A.uuid);
    // The drag really overlapped part of the card, and really left it.
    expect(r.mid, 'y\'s window is open mid-drag').toBeDefined();
    const part = overlap(r.mid!, r.card.rect);
    expect(part > 0 && part < r.card.rect[2] * r.card.rect[3], `mid-drag, y's window ${JSON.stringify(r.mid)} covers part of the card ${JSON.stringify(r.card.rect)} (${part} square points)`).toBe(true);
    expect(r.end, 'y\'s window is where the drag left it').toEqual(r.offRect);
    expect(overlap(r.end!, r.card.rect), 'after the drag y\'s window is clear of the card').toBe(0);
    expect(dragFailures(r), 'unarmed while overlapped, armed 500 ms after the window moves off').toEqual([]);
    // Wrong program: a card that ignores the app's own windows arms while y's window lies over it, and fails naming it.
    const twin = dragRun('arms_under_own_window');
    const failed = dragFailures(twin);
    expect(failed.length, 'the planted arms_under_own_window fails').toBeGreaterThan(0);
    expect(failed.join('\n'), 'naming the window').toContain(twin.window);
  }, 600_000);
});
