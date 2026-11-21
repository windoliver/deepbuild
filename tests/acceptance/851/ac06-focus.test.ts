// AC6 #851.2badf2f3: "After the first key or pad entry on a screen, exactly one enabled control holds focus at every
// step at both reference sizes; a focused control disabled at step k hands focus to the next enabled one at step k; a
// planted screen that leaves focus on a disabled control fails, naming the control and the step"
//
// The fixture shell's focus journey with keys and with a pad, at 1512 × 982 and at 2400 × 1080, passes. In each run's
// rows, on each stretch of rows on one screen, from the first row that holds a focus on, every row holds one focus and
// it is among that row's enabled controls. The settings screen's Reduce motion toggle is enabled only while reduced
// motion is off, so activating it disables it while it holds focus: each run holds at least one row k whose focus the
// row before held and row k's enabled controls leave out, and at row k focus is on the next enabled control in the
// screen's focus order (rows by the evaluated boxes the replica returned, top to bottom, two controls on one row when
// their spans overlap by half the shorter's height, then left to right, wrapping): the settings screen's Back.
// On a replica planted with DEEP_DRIVE_PLANT=focus-stays-on-disabled, a row holds focus on a control its enabled
// controls leave out; the journey fails shell.focus, naming that control and the first such row's step.
// The wrong programs: the base, a shell that drops focus when its control turns disabled, one that moves it a step
// late or to the first control, and a journey that checks focus only after a screen opens.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, PHONE, REFERENCE, TIMEOUT, devicePlays, failuresOf, hubOnce, journeysInput, macOnly, none, passed, putShell, rest, runJourneys, shown, stepped,
  word, type ControlBox, type Device, type Row, type ShellReply,
} from './helpers.ts';
import { allPrograms, programs, shellDocument } from './shell.ts';

const clean = hubOnce();
const planted = hubOnce({ plant: 'focus-stays-on-disabled' });
const DEVICES_WITH_FOCUS: Device[] = ['keys', 'pad'];

/** A screen's focus order from its controls' evaluated boxes (Recipe: shell@1 game shell, Semantics). */
function focusOrder(controls: Record<string, ControlBox>): string[] {
  const list = Object.entries(controls).map(([id, c]) => ({ id, b: c.box })).sort((a, b) => a.b[1]! - b.b[1]! || a.b[0]! - b.b[0]!);
  const rows: { id: string; b: number[] }[][] = [];
  const share = (a: number[], b: number[]): boolean => Math.min(a[1]! + a[3]!, b[1]! + b[3]!) - Math.max(a[1]!, b[1]!) >= Math.min(a[3]!, b[3]!) / 2;
  for (const c of list) {
    const row = rows.find((r) => r.some((o) => share(o.b, c.b)));
    if (row) row.push(c);
    else rows.push([c]);
  }
  return rows.sort((a, b) => Math.min(...a.map((c) => c.b[1]!)) - Math.min(...b.map((c) => c.b[1]!))).flatMap((r) => r.sort((a, b) => a.b[0]! - b.b[0]!).map((c) => c.id));
}
/** The next enabled control after `c` in `order`, wrapping, or null. */
function nextEnabled(order: string[], c: string, enabled: string[]): string | null {
  const i = order.indexOf(c);
  for (let j = 1; j <= order.length; j++) {
    const n = order[(i + j) % order.length]!;
    if (enabled.includes(n)) return n;
  }
  return null;
}
/** Each row whose focus the row before held on the same screen and this row's enabled controls leave out. */
const disabledWhileFocused = (rows: Row[]): number[] =>
  rows.flatMap((x, i) => (i > 0 && x.screen !== null && rows[i - 1]!.screen === x.screen && rows[i - 1]!.focus !== null
    && rows[i - 1]!.enabled.includes(rows[i - 1]!.focus!) && !x.enabled.includes(rows[i - 1]!.focus!) ? [i] : []));

function judge(r: ShellReply, what: string): string[] {
  const rows = stepped(r, what);
  const gaps: string[] = [];
  let focused = false;
  rows.forEach((x, i) => {
    if (i > 0 && rows[i - 1]!.screen !== x.screen) focused = false;
    if (x.screen === null) return;
    if (x.focus !== null) focused = true;
    if (focused && (x.focus === null || !x.enabled.includes(x.focus))) gaps.push(`${what}: at step ${x.step} on ${x.screen} focus is ${String(x.focus)}, not one of the enabled controls ${x.enabled.join(', ')}`);
  });
  const events = disabledWhileFocused(rows);
  if (!events.length) gaps.push(`${what}: no focused control turns disabled in the run, so the hand-over is never seen`);
  for (const i of events) {
    const x = rows[i]!;
    const c = rows[i - 1]!.focus!;
    const controls = r.screens[x.screen!]?.controls;
    if (!controls) { gaps.push(`${what}: the reply gives no boxes for ${x.screen}`); continue; }
    const want = nextEnabled(focusOrder(controls), c, x.enabled);
    if (x.focus !== want) gaps.push(`${what}: ${c} turns disabled at step ${x.step} on ${x.screen}, and focus there is ${String(x.focus)}, not ${String(want)}, the next enabled control`);
  }
  return gaps;
}

describe(`${AC[6]} one enabled control holds focus at every step, and a disabled one hands focus on at its step`, () => {
  it(`${AC[6]} with keys and with a pad, at both sizes, exactly one enabled control holds focus after the first entry, and a focused control disabled at step k hands focus to the next enabled one at step k`, async () => {
    macOnly();
    const h = await clean();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['focus'], devices: DEVICES_WITH_FOCUS, sizes: [REFERENCE, PHONE] }));
    passed(result, 'the fixture shell\'s focus journey with keys and a pad at both sizes');
    const gaps: string[] = [];
    for (const size of [REFERENCE, PHONE]) {
      for (const [d, replies] of devicePlays(h.pool, piece, 'focus', DEVICES_WITH_FOCUS, size)) {
        replies.forEach((r, n) => gaps.push(...judge(r, `focus with ${d} at ${size.join(' × ')} (play ${n})`)));
      }
    }
    none(gaps, 'the replica\'s rows of the focus journey');
  }, TIMEOUT);

  it(`${AC[6]} a planted screen that leaves focus on a disabled control fails shell.focus, naming the control and the step`, async () => {
    macOnly();
    const h = await planted();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['focus'], devices: ['keys'], sizes: [REFERENCE] }));
    const rows = devicePlays(h.pool, piece, 'focus', ['keys'], REFERENCE).get('keys')!.flatMap((r) => stepped(r, 'the planted focus run'));
    const stuck = rows.find((x) => x.screen !== null && x.focus !== null && !x.enabled.includes(x.focus));
    expect(stuck, 'on the planted replica, a row holds focus on a control its enabled controls leave out').toBeDefined();
    expect(result.outcome, `the planted focus journey fails: ${shown(result)}`).toBe('failed');
    const f = failuresOf(result, 'shell.focus').map((x) => rest(x.message, 'shell.focus'));
    expect(f.some((m) => word(stuck!.focus!).test(m) && word(`step ${stuck!.step}`).test(m)), `a shell.focus failure names ${stuck!.focus} and step ${stuck!.step}: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
