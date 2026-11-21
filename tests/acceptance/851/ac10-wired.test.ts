// AC10 #851.5b5156e7: "Every control a screen lists as enabled changes the full-state hash or the screen within its
// step budget once activated. A planted Credits button bound to nothing fails, naming it, where a journey that checks
// only its visibility passes it."
//
// The fixture shell's wired journey (budget 30 steps) with keys, a pad and touches at the reference window passes, and
// each run's rows show all six screens, so every screen's controls were reached. The twin whose title Credits button
// has no `does` is checked with the layout and wired journeys (keys): the replica gives credits_button on the title as
// an enabled control whose box lies inside the 1512 × 982 frame and is at least 24 × 24 px, no ui.layout failure names
// it (a journey that reads only that it shows passes it), and wired fails, naming credits_button and no other title
// control that is bound.
// The wrong programs: the base, a wired check that counts a control's showing or its focus as its effect, one that
// reads only the screen and not the full-state hash, and one that skips a screen's controls.
import { describe, expect, it } from 'vitest';
import {
  AC, DEVICES, DOC, MIN_SIDE_PX, REFERENCE, SCREENS, TIMEOUT, devicePlays, failuresOf, hubOnce, journeysInput, macOnly, none, passed, putShell, rest,
  runJourneys, shown, stepped, word,
} from './helpers.ts';
import { allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce();

describe(`${AC[10]} every enabled control does something once activated, and a button bound to nothing fails wired`, () => {
  it(`${AC[10]} with keys, a pad and touches, every enabled control changes the full-state hash or the screen within 30 steps once activated`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['wired'], devices: [...DEVICES], sizes: [REFERENCE] }));
    passed(result, 'the fixture shell\'s wired journey with each device');
    const gaps: string[] = [];
    for (const [d, replies] of devicePlays(h.pool, piece, 'wired', DEVICES, REFERENCE)) {
      const seen = new Set(replies.flatMap((r) => stepped(r, `wired with ${d}`).map((x) => x.screen)));
      const unseen = SCREENS.filter((s) => !seen.has(s));
      if (unseen.length) gaps.push(`wired with ${d} never shows ${unseen.join(', ')}, so its controls were never activated`);
    }
    none(gaps, 'the replica\'s rows of the wired journey');
  }, TIMEOUT);

  it(`${AC[10]} a planted Credits button bound to nothing fails wired, naming credits_button, though a check of only its visibility passes it`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.unbound, shellDocument(p, { unbound: true }), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['layout', 'wired'], devices: ['keys'], sizes: [REFERENCE] }));
    const title = [...devicePlays(h.pool, piece, 'layout', ['keys'], REFERENCE).get('keys')!, ...devicePlays(h.pool, piece, 'wired', ['keys'], REFERENCE).get('keys')!]
      .map((r) => r.screens.title?.controls['credits_button']).find((c) => c !== undefined);
    expect(title, 'the replica gives the title\'s credits_button').toBeDefined();
    const [x, y, w, hgt] = title!.box as [number, number, number, number];
    expect({ enabled: title!.enabled, inside: x >= 0 && y >= 0 && x + w <= REFERENCE[0] && y + hgt <= REFERENCE[1], big: w >= MIN_SIDE_PX && hgt >= MIN_SIDE_PX },
      'credits_button shows: enabled, inside the frame and at least 24 × 24 px').toEqual({ enabled: true, inside: true, big: true });
    expect(failuresOf(result, 'ui.layout').filter((f) => word('credits_button').test(f.message)).map((f) => f.message), 'no ui.layout failure names credits_button').toEqual([]);
    expect(result.outcome, `the twin's wired journey fails: ${shown(result)}`).toBe('failed');
    const wired = failuresOf(result, 'wired').map((f) => rest(f.message, 'wired'));
    expect(wired.some((m) => word('credits_button').test(m)), `a wired failure names credits_button: ${shown(result)}`).toBe(true);
    expect(wired.filter((m) => ['start_button', 'levels_button', 'settings_button'].some((id) => word(id).test(m))), 'no wired failure names a title control that is bound').toEqual([]);
  }, TIMEOUT);
});
