// AC5 #851.938e41a6: "From every screen, `back` pressed again and again reaches the title within 3 presses, and from a
// level it shows pause before it leaves; a planted credits screen with no way back fails, naming it"
//
// The fixture shell's back journey with keys, a pad and touches at the reference window passes. Each run's rows show
// every one of the six screens (the journey leaves each by back), and a level left by back shows pause first: some row
// holding a level is followed by a row on the pause screen. Game over is reached by waiting out a level: a level not
// completed by its step 3,900 is lost (shell.ts). The twin whose credits screen has no Back control and `back: none`
// fails shell.back with keys, naming credits.
// The wrong programs: the base, a shell whose back from a level leaves it at once, one whose back from credits does
// nothing, and a journey that presses back only on the title.
import { describe, expect, it } from 'vitest';
import {
  AC, DEVICES, DOC, REFERENCE, SCREENS, TIMEOUT, devicePlays, failuresOf, hubOnce, journeysInput, macOnly, none, passed, putShell, rest, runJourneys, shown,
  stepped, word,
} from './helpers.ts';
import { allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce();

describe(`${AC[5]} back reaches the title from every screen within 3 presses, through pause from a level`, () => {
  it(`${AC[5]} from every screen back reaches the title within 3 presses, and from a level shows pause first, with keys, a pad and touches`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['back'], devices: [...DEVICES], sizes: [REFERENCE] }));
    passed(result, 'the fixture shell\'s back journey with each device');
    const gaps: string[] = [];
    for (const [d, replies] of devicePlays(h.pool, piece, 'back', DEVICES, REFERENCE)) {
      const rows = replies.flatMap((r) => stepped(r, `back with ${d}`));
      const seen = new Set(rows.map((x) => x.screen));
      const unseen = SCREENS.filter((s) => !seen.has(s));
      if (unseen.length) gaps.push(`back with ${d} never shows ${unseen.join(', ')}`);
      let inLevel = false;
      let throughPause = false;
      for (const x of rows) {
        if (x.screen === null) inLevel = x.level >= 0;
        else { throughPause ||= inLevel && x.screen === 'pause'; inLevel = false; }
      }
      if (!throughPause) gaps.push(`back with ${d}: no level is followed by the pause screen`);
    }
    none(gaps, 'the replica\'s rows of the back journey');
  }, TIMEOUT);

  it(`${AC[5]} a planted credits screen with no way back fails shell.back, naming credits`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.noBack, shellDocument(p, { noBack: true }), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['back'], devices: ['keys'], sizes: [REFERENCE] }));
    expect(result.outcome, `the twin's back journey fails: ${shown(result)}`).toBe('failed');
    const f = failuresOf(result, 'shell.back');
    expect(f.some((x) => word('credits').test(rest(x.message, 'shell.back'))), `a shell.back failure names credits: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
