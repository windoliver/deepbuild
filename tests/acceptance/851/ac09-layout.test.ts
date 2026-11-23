// AC9 #851.27357504: "On every shell screen at the reference window and at a 2400 × 1080 phone size: no two controls
// overlap past 1 px, no text runs outside its control, every control lies inside the frame, and none is under 24 × 24
// px, read from evaluated boxes. A planted settings screen whose Back button covers half of the volume slider fails,
// naming both items."
//
// The fixture shell's layout journey at 1512 × 982 and at 2400 × 1080 (keys) passes. Its replies give, for each of the
// six screens at each size, every control the screen lists, each with its box and its text's box in the view's pixels:
// the screen's 1280 × 720 board letterboxed into the view, scaled by min(w ÷ 1280, h ÷ 720) and centred, so each box is
// the control's rect so placed, within 1 px, and its text lies inside its label's text box so placed. The twin whose settings Back button is the left half of the
// volume slider's rect gives boxes that overlap past 1 px both ways at each size, and fails ui.layout, naming
// settings_back and volume_slider.
// The wrong programs: the base, a layout check that reads the document's own units instead of the evaluated boxes, one
// that skips a screen or a size, and one that reads a control's label box as its own.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, OVERLAP_PX, PHONE, REFERENCE, SCREENS, TIMEOUT, devicePlays, failuresOf, hubOnce, journeysInput, letterboxed, macOnly, none, overlap, passed,
  putShell, rest, runJourneys, shown, word,
} from './helpers.ts';
import { DOC_SIZE, allPrograms, labelBox, programs, screenSpecs, shellDocument } from './shell.ts';

const hub = hubOnce();
const SIZES: [number, number][] = [REFERENCE, PHONE];
const near = (a: number[] | null, b: number[]): boolean => a !== null && a.length === 4 && a.every((v, i) => Math.abs(v - b[i]!) <= 1);
/** `a` lies inside `b`, within 1 px: a label's text, read as its item's box or as its glyphs' bounds, lies inside its box. */
const within = (a: number[] | null, b: number[]): boolean => a !== null && a.length === 4 && a[2]! > 0 && a[3]! > 0
  && a[0]! >= b[0]! - 1 && a[1]! >= b[1]! - 1 && a[0]! + a[2]! <= b[0]! + b[2]! + 1 && a[1]! + a[3]! <= b[1]! + b[3]! + 1;

describe(`${AC[9]} every shell screen fits at the reference window and at 2400 × 1080, from evaluated boxes`, () => {
  it(`${AC[9]} the layout journey passes on every screen at both sizes, from the boxes evaluated in the view's pixels`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['layout'], devices: ['keys'], sizes: SIZES }));
    passed(result, 'the fixture shell\'s layout journey at both sizes');
    const gaps: string[] = [];
    const specs = screenSpecs();
    for (const size of SIZES) {
      const replies = devicePlays(h.pool, piece, 'layout', ['keys'], size).get('keys')!;
      for (const s of SCREENS) {
        const controls = replies.map((r) => r.screens[s]?.controls).find((c) => c !== undefined);
        if (!controls) { gaps.push(`at ${size.join(' × ')} the layout journey gives no boxes for ${s}`); continue; }
        for (const b of specs[s].buttons) {
          const c = controls[b.id];
          const box = letterboxed(b.box, size, DOC_SIZE);
          const text = letterboxed(labelBox(b.box), size, DOC_SIZE);
          if (!c) gaps.push(`at ${size.join(' × ')} ${s} gives no box for ${b.id}`);
          else {
            if (!near(c.box, box)) gaps.push(`at ${size.join(' × ')} ${s}.${b.id}'s box is [${c.box.join(', ')}], not its rect letterboxed, [${box.map((v) => v.toFixed(1)).join(', ')}]`);
            if (!within(c.text, text)) gaps.push(`at ${size.join(' × ')} ${s}.${b.id}'s text box is [${String(c.text)}], not inside its label's box letterboxed, [${text.map((v) => v.toFixed(1)).join(', ')}]`);
          }
        }
      }
    }
    none(gaps, 'the evaluated boxes the layout journey read');
  }, TIMEOUT);

  it(`${AC[9]} a planted settings screen whose Back button covers half of the volume slider fails ui.layout, naming settings_back and volume_slider`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.backCovers, shellDocument(p, { backCovers: true }), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['layout'], devices: ['keys'], sizes: SIZES }));
    for (const size of SIZES) {
      const controls = devicePlays(h.pool, piece, 'layout', ['keys'], size).get('keys')!.map((r) => r.screens.settings?.controls).find((c) => c !== undefined);
      expect(controls?.['settings_back'] && controls['volume_slider'], `at ${size.join(' × ')} the twin's settings screen gives boxes for both`).toBeTruthy();
      const [x, y] = overlap(controls!['settings_back']!.box, controls!['volume_slider']!.box);
      expect(Math.min(x, y), `at ${size.join(' × ')} Back and the volume slider overlap past 1 px`).toBeGreaterThan(OVERLAP_PX);
    }
    expect(result.outcome, `the twin's layout journey fails: ${shown(result)}`).toBe('failed');
    const f = failuresOf(result, 'ui.layout').map((m) => rest(m.message, 'ui.layout'));
    expect(f.some((m) => word('settings_back').test(m) && word('volume_slider').test(m)), `a ui.layout failure names settings_back and volume_slider: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
