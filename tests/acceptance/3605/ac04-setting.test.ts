// AC4 #3605.fd7b096d: "A shell declares `custom: {mains: {kind: choice, options: [100, 120, 220, 230, 240], default:
// 230}}`, and a level's logic lists `settings: {mains: 230}` and writes what it read to `seen`. Entered untouched, `seen`
// reads 230 from step 0. With 120 chosen on the settings screen, another level reads 120 from its step 0. Paused at step
// 600, with 240 chosen and the level resumed, `seen` reads 120 through step 600 and 240 from step 601."
//
// The fixture shell's `moves` journey with keys at the reference window (SETTING_MOVES, below): level 0 (sockets)
// entered untouched and played to its step 60, left from pause; on the title's settings screen 120 chosen on
// mains_choice; level 1 (fuses) entered and played until its step 600 has run, paused, the pause screen's Settings
// opened, 240 chosen, back to pause, resumed, and played until it is completed at its step 900. The check passes. In the
// rows, a level's step k is the first row holding it at level step k + 1 (it has run k + 1 steps), and `values` its
// arrays then: l0.seen reads 230 at every step 0 to 60; l1.seen reads 120 at every step 0 to 600 and 240 at every step
// 601 to 899; the shell's `custom` reads 230 at the start, 120 at level 1's step 0 and 240 at the end. Level 1's own
// track (its `level_tracks` entry) holds two entries beyond its finish action: 120 at t 0 and 240 at step 601's time,
// as the issue's Scope enters them.
// The wrong programs: the base (no `custom`, no `settings` on a level), a level that reads the default or the shell's
// array instead of the entry, a value that reaches the level at once on the settings screen or only at its next load,
// and an entry at step 600 or 602.
import { describe, it } from 'vitest';
import { AC, DOC, STEP_FLICKS, TIMEOUT, atLevelStep, hubOnce, journeysInput, loads, macOnly, none, onePlay, passed, putShell, runJourneys, show, stepped } from './helpers.ts';
import { SETTING_MOVES, allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce();

describe(`${AC[4]} a level reads the piece's own setting as an input entry: 230 untouched, 120 chosen before it starts, 240 from the step after it resumes`, () => {
  it(`${AC[4]} seen reads 230 untouched from step 0; 120 from another level's step 0; 120 through step 600 and 240 from step 601 after a change in pause`, async () => {
    macOnly();
    const p = programs();
    const h = await hub();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    passed(await runJourneys(h, journeysInput(piece, { journeys: ['moves'], moves: SETTING_MOVES })), 'the settings moves with keys');
    const reply = onePlay(h.pool, piece, 'moves', 'keys', 'the settings moves');
    const rows = stepped(reply, 'the settings moves');
    const gaps: string[] = [];
    const seenAt = (level: number, k: number): number | undefined => atLevelStep(rows, level, k)?.values[`l${level}.seen`]?.[0];
    for (let k = 0; k <= 60; k++) if (seenAt(0, k) !== 230) { gaps.push(`level 0 untouched reads seen ${String(seenAt(0, k))} at its step ${k}, not 230`); break; }
    for (let k = 0; k <= 600; k++) if (seenAt(1, k) !== 120) { gaps.push(`level 1, with 120 chosen before it, reads seen ${String(seenAt(1, k))} at its step ${k}, not 120`); break; }
    for (let k = 601; k < 900; k++) if (seenAt(1, k) !== 240) { gaps.push(`level 1, with 240 chosen while paused after its step 600, reads seen ${String(seenAt(1, k))} at its step ${k}, not 240`); break; }
    const held = loads(rows, 1).flat().filter((r) => r.paused);
    if (!held.length || held.some((r) => r.level_step !== 601)) gaps.push(`level 1 is paused at level steps ${[...new Set(held.map((r) => r.level_step))].join(', ') || 'none'}, not after its step 600 ran (level step 601)`);
    const customs = [rows[0]!.custom[0], atLevelStep(rows, 1, 0)?.custom[0], rows.at(-1)!.custom[0]];
    if (customs.join() !== '230,120,240') gaps.push(`the shell's custom mains reads ${customs.join(', ')} at the start, at level 1's step 0 and at the end, not 230, 120, 240`);
    const track = reply.level_tracks.filter((t) => t.level === 1);
    if (track.length !== 1) gaps.push(`the play gives ${track.length} tracks of level 1, not one`);
    else {
      const setting = track[0]!.entries.filter((e) => !['finish_key', 'finish_zone'].includes(String(e['control'])));
      const got = setting.map((e) => `${Number(e['value'])} at t ${Number(e['t'])}`);
      const want = [`120 at t 0`, `240 at t ${601 * STEP_FLICKS}`];
      if (got.join() !== want.join()) gaps.push(`level 1's track holds the setting's entries ${show(setting, 600)}, not ${want.join(' and ')}`);
    }
    none(gaps, 'the levels\' seen and tracks');
  }, TIMEOUT);
});
