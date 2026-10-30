// AC10: a pop-out's serial must be fresh (under 30 s, the token's life) and from your input in this panel. x and y are
// two panels of one plug-in, so both serials sit in that writer's ring. Through #400's `pop_out` and `windows` calls
// (README: The surface under test). At the base `deep-show` has no `install` call and answers every scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import { B, Driver, SEC, SLOTS, click, obj, plainTree, popOut, serialOf, at, useOut, useShow, windowsOf, type Planted } from './helpers.ts';

const show = useShow();
const out = useOut();
const T0 = 2 * SEC;
const PANELS = { x: SLOTS[0]!, y: SLOTS[1]! };

type Case = 'y, 31 s old' | 'x\'s, from your input in another panel' | 'y, 29 s old';
/** One pop-out of y onto B: the serial it carries, and whether it opened y's window (from the reply and `windows`). */
function popY(c: Case, planted?: Planted): { serial: number; opened: boolean } {
  const d = new Driver(show(), { evidence: out(), panels: PANELS, plugins: { home: { panels: { x: { tree: plainTree('Orders') }, y: { tree: plainTree('Refunds') } } } }, ...(planted ? { planted } : {}) });
  const panel = c.startsWith('x') ? 'x' : 'y';
  const serial = serialOf(d.step(click(T0, panel, PANELS[panel]), `${c}: your click in ${panel}`)[0], `${c}: the press in ${panel}`);
  const age = c === 'y, 31 s old' ? 31 * SEC : c === 'y, 29 s old' ? 29 * SEC : SEC;
  // A click in y right before a pop-out with x's serial: y's own fresh serial is in the ring too.
  if (panel === 'x') d.step(click(T0 + age / 2, 'y', PANELS.y), `${c}: your click in y`);
  const [reply, windows] = d.step([popOut(T0 + age, 'y', B.uuid, serial), at('windows', T0 + age + SEC)], `${c}${planted ? ` (planted ${planted})` : ''}`);
  const opened = typeof obj(reply, `pop-out (${c})`)['code'] !== 'string' || windowsOf(windows, 'windows').some((w) => w.view === 'y');
  return { serial, opened };
}

describe('AC10 a pop-out carrying a serial 31 s old, or one from your input in another panel, is refused; one 29 s old from this panel opens', () => {
  it('AC10 y\'s pop-out with y\'s serial 31 s old and with x\'s serial opens nothing; with y\'s serial 29 s old it opens; a router that takes any serial in the writer\'s ring fails, naming the serial', () => {
    const f = (planted?: Planted): string[] => {
      const out: string[] = [];
      for (const c of ['y, 31 s old', 'x\'s, from your input in another panel'] as const) {
        const r = popY(c, planted);
        if (r.opened) out.push(`serial ${r.serial} (${c}) opened y's pop-out`);
      }
      const ok = popY('y, 29 s old', planted);
      if (!ok.opened) out.push(`serial ${ok.serial} (y, 29 s old) did not open y's pop-out`);
      return out;
    };
    expect(f(), 'only the fresh serial from y opens').toEqual([]);
    // Wrong program: a router that accepts any serial in the writer's ring, however old and from whichever panel.
    const twin = f('accepts_any_ring_serial');
    expect(twin.some((m) => /^serial \d+ \(y, 31 s old\) opened/.test(m)), `the planted accepts_any_ring_serial fails, naming the 31 s old serial: ${JSON.stringify(twin)}`).toBe(true);
    expect(twin.some((m) => /^serial \d+ \(x's/.test(m)), `the planted accepts_any_ring_serial fails, naming x's serial: ${JSON.stringify(twin)}`).toBe(true);
  }, 600_000);
});
