// AC4 #851.4125ce58: "On the fixture shell, the title-to-level, unlock, pause and credits journeys each pass with
// entries from keys only, from a pad only and from touches only, and the three runs of a journey end on the same
// full-state hash; a planted settings screen whose volume slider takes only a pointer drag fails the pad run, naming
// the screen and the control"
//
// The fixture shell's four play journeys with each device at the reference window pass. In the replica's rows of each
// run, every row whose `device` is set names the run's own device, and at least one does; the three runs of a journey
// end on the same full-state hash (its last row's), and the pause journey's plays all hold one hash at level step 3,600.
// The twin whose volume slider is a `drag_along` (it takes only a pointer or touch drag) is checked with every journey
// and a pad alone at the reference window, so whichever journey works the slider meets it: it fails shell.device,
// naming the pad, the settings screen and volume_slider.
// The wrong programs: the base, a replica that turns a pad's run into keys, a shell whose touches write other entries
// than keys do, and a journey that skips a control a device can't reach.
import { describe, expect, it } from 'vitest';
import {
  AC, DEVICES, DOC, PAUSE, REFERENCE, TIMEOUT, devicePlays, failuresOf, hashAtLevelStep, hubOnce, journeysInput, macOnly, none, passed, putShell, rest,
  runJourneys, shown, stepped, word, type Journey,
} from './helpers.ts';
import { allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce({ replicas: 2 });
const PLAY_JOURNEYS: Journey[] = ['title_to_level', 'unlock', 'pause', 'credits'];

describe(`${AC[4]} the play journeys pass with keys, a pad or touches alone and end on one hash, and a slider a pad can't move fails the pad run`, () => {
  it(`${AC[4]} title_to_level, unlock, pause and credits each pass with keys only, a pad only and touches only, and a journey's three runs end on the same full-state hash`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: PLAY_JOURNEYS, devices: [...DEVICES], sizes: [REFERENCE] }));
    passed(result, 'the fixture shell\'s four play journeys with each device alone');
    const gaps: string[] = [];
    for (const j of PLAY_JOURNEYS) {
      const ends: string[] = [];
      for (const [d, replies] of devicePlays(h.pool, piece, j, DEVICES, REFERENCE)) {
        for (const r of replies) {
          const rows = stepped(r, `${j} with ${d}`);
          const other = rows.find((x) => x.device !== null && x.device !== d);
          if (other) gaps.push(`${j} with ${d}: step ${other.step} holds an entry from ${other.device}`);
          if (!rows.some((x) => x.device === d)) gaps.push(`${j} with ${d}: no row holds an entry from ${d}`);
          ends.push(`${d}: ${j === 'pause' ? String(hashAtLevelStep(rows, 0, PAUSE.to)) : rows.at(-1)!.hash}`);
        }
      }
      if (new Set(ends.map((e) => e.slice(e.indexOf(':') + 2))).size !== 1) gaps.push(`${j}'s runs end on different full-state hashes${j === 'pause' ? ' at level step 3,600' : ''}: ${ends.join('; ')}`);
    }
    none(gaps, 'the replica\'s rows of the four play journeys');
  }, TIMEOUT);

  it(`${AC[4]} a planted settings screen whose volume slider takes only a pointer drag fails the pad run with shell.device, naming settings and volume_slider`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.dragOnly, shellDocument(p, { dragOnly: true }), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { devices: ['pad'], sizes: [REFERENCE] }));
    expect(result.outcome, `the twin's journeys with a pad fail: ${shown(result)}`).toBe('failed');
    const f = failuresOf(result, 'shell.device').map((x) => rest(x.message, 'shell.device'));
    expect(f.some((m) => word('pad').test(m) && word('settings').test(m) && word('volume_slider').test(m)),
      `a shell.device failure names the pad, the settings screen and volume_slider: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
