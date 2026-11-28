// AC8 #3605.47c041ca: "The custom choice is set with keys alone, with a pad alone and with touches alone, and the three
// runs end on the same full-state hash, as #851's journeys do."
//
// The fixture shell's `moves` journey with each device alone at the reference window: from the title, the settings
// screen, 120 chosen on mains_choice, and back to the title. The check passes. In each run's rows the shell's custom
// mains reads 230 at the start and 120 at the end, every row whose `device` is set names the run's own device and at
// least one does, and the three runs' last rows hold one full-state hash.
// The wrong programs: the base, a choice a pad or touches can't set (a journey that skips it), touches that set
// another value than keys do, and a full-state hash that holds the device.
import { describe, expect, it } from 'vitest';
import { AC, DEVICES, DOC, TIMEOUT, hubOnce, journeysInput, macOnly, none, onePlay, passed, putShell, runJourneys, stepped, type Move } from './helpers.ts';
import { allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce();
const MOVES: Move[] = [{ activate: 'settings_button' }, { set: 'mains_choice', value: 120 }, { back: true }];

describe(`${AC[8]} the custom choice is set with keys, a pad or touches alone, and the three runs end on one full-state hash`, () => {
  it(`${AC[8]} mains_choice set to 120 with each device alone ends on the same full-state hash`, async () => {
    macOnly();
    const p = programs();
    const h = await hub();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    passed(await runJourneys(h, journeysInput(piece, { journeys: ['moves'], moves: MOVES, devices: [...DEVICES] })), 'mains set to 120 with keys, a pad and touches alone');
    const gaps: string[] = [];
    const ends: string[] = [];
    for (const d of DEVICES) {
      const rows = stepped(onePlay(h.pool, piece, 'moves', d, `mains set with ${d}`), `mains set with ${d}`);
      if (rows[0]!.custom[0] !== 230) gaps.push(`with ${d}, custom mains starts at ${String(rows[0]!.custom[0])}, not 230`);
      if (rows.at(-1)!.custom[0] !== 120) gaps.push(`with ${d}, custom mains ends at ${String(rows.at(-1)!.custom[0])}, not 120`);
      if (rows.at(-1)!.screen !== 'title') gaps.push(`with ${d}, the run ends on ${String(rows.at(-1)!.screen)}, not the title`);
      const other = rows.find((r) => r.device !== null && r.device !== d);
      if (other) gaps.push(`with ${d}, step ${other.step} holds an entry from ${other.device}`);
      if (!rows.some((r) => r.device === d)) gaps.push(`with ${d}, no row holds an entry from ${d}`);
      ends.push(rows.at(-1)!.hash);
    }
    none(gaps, 'the three runs\' rows');
    expect(new Set(ends).size, `keys, a pad and touches end on one full-state hash: ${ends.join(', ')}`).toBe(1);
  }, TIMEOUT);
});
