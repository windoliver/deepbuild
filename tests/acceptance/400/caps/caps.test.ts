// #400.AC5: a window you switch away from presents at most 30 Hz, every window at most 60 Hz while the Mac is hot,
// and a window you hide presents nothing and evaluates none of its sessions; a window that presents over its cap
// fails, naming the window and the cap. On the hub's virtual display clock (the #400 suite's: A at 120 Hz, B at
// 60 Hz 3 ms out of phase, each latch 2 ms before its vsync), x in the main window on A and y popped out onto B, as
// in AC3. Alpha patches both boards every 4 ms, so every latch of either display has something new and an uncapped
// window presents at every vsync of its own display; each signal (README: The surface under test) is made at the
// start of a 300 ms phase, and each phase's rate is read over 200 ms from 50 ms in. At the base `deep-show` reads no
// `displays` and answers the scenario `bad_input`.
import { describe, expect, it } from 'vitest';
import {
  HIDDEN_CAP, INACTIVE, PHASE, THERMAL, activate, capLabel, capRun, hideWindow, names, phaseSpan, rateFailures, thermal, unapplied,
  type CapPlanted, type CapRun, type Signal,
} from './helpers.ts';
import { A, B, PERIOD_B, useOut, useShow, type Frame } from '../helpers.ts';

const show = useShow();
const out = useOut();

describe('#400.AC5 a window presents under its cap when you switch away from it, the Mac is hot or you hide it, and returns to its display\'s rate after', () => {
  it('#400.AC5 inactive: a window you switch away from presents at most 30 Hz, on A (120 Hz) and on B (60 Hz), and at its display\'s rate again when you switch back', () => {
    // Phase 1: you activate the main window. 2: you switch to y. 3: you switch to another app. 4: back to the main window.
    const signals: Signal[] = [({ main }) => activate(0, main), ({ popped }) => activate(0, popped), () => activate(0, null), ({ main }) => activate(0, main)];
    const failures = (r: CapRun): string[] => [
      ...unapplied(r, r.s0, r.s0 + 5 * PHASE),
      ...rateFailures(r.x, 'x', r.main, A, phaseSpan(r, 1), null, 'while it is the key window'),
      ...rateFailures(r.x, 'x', r.main, A, phaseSpan(r, 2), INACTIVE, 'after you switched from it to y'),
      ...rateFailures(r.y, 'y', r.popped, B, phaseSpan(r, 2), null, 'while it is the key window'),
      ...rateFailures(r.x, 'x', r.main, A, phaseSpan(r, 3), INACTIVE, 'after you switched to another app'),
      ...rateFailures(r.y, 'y', r.popped, B, phaseSpan(r, 3), INACTIVE, 'after you switched from it to another app'),
      ...rateFailures(r.x, 'x', r.main, A, phaseSpan(r, 4), null, 'after you switched back to it'),
    ];
    const r = capRun(show(), out(), 5, signals);
    expect(failures(r), 'a window you switch away from presents at most 30 Hz, and at its display\'s rate while it is the key window').toEqual([]);
    // Wrong program: a window you switch away from keeps presenting at its display's rate.
    const twin = capRun(show(), out(), 5, signals, 'ignores_inactive_cap');
    const failed = failures(twin);
    expect(names(failed, twin.main, capLabel(INACTIVE)), `the planted ignores_inactive_cap fails, naming the main window ${twin.main} and the cap ${capLabel(INACTIVE)}: ${JSON.stringify(failed.slice(0, 3))}`).toBe(true);
  }, 900_000);

  it('#400.AC5 thermal: while the Mac is hot every window presents at most 60 Hz, x on A (120 Hz) and y on B (60 Hz), and x at 120 Hz again once it cools', () => {
    // Phase 1: the thermal state turns serious. 2: nominal again.
    const signals: Signal[] = [() => thermal(0, 'serious'), () => thermal(0, 'nominal')];
    const failures = (r: CapRun): string[] => [
      ...unapplied(r, r.s0, r.s0 + 3 * PHASE),
      ...rateFailures(r.x, 'x', r.main, A, phaseSpan(r, 0), null, 'before the Mac is hot'),
      ...rateFailures(r.y, 'y', r.popped, B, phaseSpan(r, 0), null, 'before the Mac is hot'),
      ...rateFailures(r.x, 'x', r.main, A, phaseSpan(r, 1), THERMAL, 'while the Mac is hot'),
      ...rateFailures(r.y, 'y', r.popped, B, phaseSpan(r, 1), THERMAL, 'while the Mac is hot'),
      ...rateFailures(r.x, 'x', r.main, A, phaseSpan(r, 2), null, 'after the Mac cooled'),
      ...rateFailures(r.y, 'y', r.popped, B, phaseSpan(r, 2), null, 'after the Mac cooled'),
    ];
    const r = capRun(show(), out(), 3, signals);
    expect(failures(r), 'every window presents at most 60 Hz while the Mac is hot, and at its display\'s rate otherwise').toEqual([]);
    // Wrong program: the thermal state changes nothing, so x on A keeps presenting at 120 Hz while hot.
    const twin = capRun(show(), out(), 3, signals, 'ignores_thermal_cap');
    const failed = failures(twin);
    expect(names(failed, twin.main, capLabel(THERMAL)), `the planted ignores_thermal_cap fails, naming the main window ${twin.main} and the cap ${capLabel(THERMAL)}: ${JSON.stringify(failed.slice(0, 3))}`).toBe(true);
  }, 900_000);

  it('#400.AC5 hidden: a window you hide presents nothing and evaluates none of its sessions while the other keeps its rate, and it presents at B\'s rate again once shown', () => {
    // Phase 1: you hide y's window. 2: you show it again.
    const signals: Signal[] = [({ popped }) => hideWindow(0, popped, true), ({ popped }) => hideWindow(0, popped, false)];
    const failures = (r: CapRun): string[] => {
      const f: string[] = [];
      const hideAt = r.s0 + PHASE;
      const showAt = r.s0 + 2 * PHASE;
      f.push(...unapplied(r, r.s0, hideAt), ...unapplied(r, showAt, r.s0 + 3 * PHASE));
      f.push(...unapplied(r, hideAt, showAt).filter((m) => m.includes(' on x:')));
      f.push(...rateFailures(r.y, 'y', r.popped, B, phaseSpan(r, 0), null, 'before you hid it'));
      f.push(...rateFailures(r.x, 'x', r.main, A, phaseSpan(r, 1), null, 'while y is hidden'));
      f.push(...rateFailures(r.y, 'y', r.popped, B, phaseSpan(r, 2), null, 'after you showed it again'));
      // A visible window's frames are each evaluated (Frame clock: "At the latch it evaluates every session at the
      // predicted presentation time"), so the evaluations read below are real.
      const visible = (fr: Frame): boolean => [phaseSpan(r, 0), phaseSpan(r, 2)].some(([from, to]) => fr.vsync >= from && fr.vsync < to);
      for (const fr of r.y.filter(visible)) {
        if (!r.yEvaluations.some((e) => e.at === fr.vsync && e.window === r.popped)) f.push(`window ${r.popped} (y)'s frame at ${fr.vsync} has no evaluation of its sessions for that presentation time`);
      }
      // Hidden: from a frame of B after the hide (a frame latched before it may still present) until it is shown.
      const hidden = (t: number): boolean => t > hideAt + PERIOD_B && t < showAt;
      const frames = r.y.filter((fr) => hidden(fr.vsync));
      if (frames.length > 0) f.push(`window ${r.popped} (y) presented ${frames.length} frame(s) while hidden, over its cap ${HIDDEN_CAP} (first at ${frames[0]!.vsync})`);
      const evaluated = r.yEvaluations.filter((e) => e.window === r.popped && hidden(e.at));
      if (evaluated.length > 0) f.push(`window ${r.popped} (y) is hidden, its cap ${HIDDEN_CAP}, yet its sessions were evaluated ${evaluated.length} time(s) (first for ${evaluated[0]!.at})`);
      return f;
    };
    const r = capRun(show(), out(), 3, signals);
    expect(failures(r), 'a hidden window presents nothing and evaluates none of its sessions, and presents at its display\'s rate once shown').toEqual([]);
    // Wrong programs: a hidden window that still presents, and one that presents nothing but still evaluates its sessions.
    for (const planted of ['presents_hidden', 'evaluates_hidden'] as CapPlanted[]) {
      const twin = capRun(show(), out(), 3, signals, planted);
      const failed = failures(twin);
      const what = planted === 'presents_hidden' ? 'presented' : 'evaluated';
      expect(names(failed.filter((m) => m.includes(what)), twin.popped, HIDDEN_CAP), `the planted ${planted} fails, naming y's window ${twin.popped} and the cap ${HIDDEN_CAP}: ${JSON.stringify(failed.slice(0, 3))}`).toBe(true);
    }
  }, 900_000);
});
