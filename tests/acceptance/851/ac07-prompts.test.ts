// AC7 #851.ad15698c: "Every prompt on a shell screen shows the glyph of the device that wrote the last entry by the
// next step, as `prompt.agree` reads it; a planted shell that keeps key labels after a pad entry fails, naming the
// prompt"
//
// The fixture shell's prompts journey with keys, a pad and touches at the reference window passes. In each run's rows,
// from the row after the first one whose device is the run's own, every prompt a row shows holds that device's glyph
// for its action (the design's table: keys Enter, Esc, Esc, ← →; a pad (A), (B), (Menu), (D-pad); touches Tap, Back,
// Pause, Drag, for confirm, back, pause and adjust), and some such row shows a prompt. On a replica planted with
// DEEP_DRIVE_PLANT=prompts-keep-key-glyphs, the pad run's rows show a prompt with another glyph after the first pad
// entry; the journey fails prompt.agree, naming the first such prompt.
// The wrong programs: the base, a shell that keeps the first device's glyphs, one that changes them a step late, and a
// journey that reads only the title's prompt.
import { describe, expect, it } from 'vitest';
import {
  AC, DEVICES, DOC, GLYPHS, REFERENCE, TIMEOUT, devicePlays, failuresOf, hubOnce, journeysInput, macOnly, none, passed, putShell, rest, runJourneys, shown,
  stepped, word, type Device, type Row,
} from './helpers.ts';
import { PROMPT_ACTIONS, allPrograms, programs, shellDocument } from './shell.ts';

const clean = hubOnce();
const planted = hubOnce({ plant: 'prompts-keep-key-glyphs' });

/** Each prompt a row shows with another glyph than `d`'s for its action, from the row after the first that `d` wrote on. */
function disagreeing(rows: Row[], d: Device): { step: number; prompt: string; glyph: string }[] {
  const first = rows.findIndex((x) => x.device === d);
  if (first < 0) return [];
  return rows.slice(first + 1).flatMap((x) => Object.entries(x.prompts)
    .filter(([id, glyph]) => glyph !== GLYPHS[d][PROMPT_ACTIONS[id] ?? 'confirm'])
    .map(([prompt, glyph]) => ({ step: x.step, prompt, glyph })));
}

describe(`${AC[7]} every prompt shows the glyph of the device that wrote the last entry`, () => {
  it(`${AC[7]} with keys, a pad and touches, every prompt shows that device's glyph by the step after its first entry`, async () => {
    macOnly();
    const h = await clean();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['prompts'], devices: [...DEVICES], sizes: [REFERENCE] }));
    passed(result, 'the fixture shell\'s prompts journey with each device');
    const gaps: string[] = [];
    for (const [d, replies] of devicePlays(h.pool, piece, 'prompts', DEVICES, REFERENCE)) {
      const rows = replies.flatMap((r) => stepped(r, `prompts with ${d}`));
      const first = rows.findIndex((x) => x.device === d);
      if (first < 0) { gaps.push(`prompts with ${d}: no row holds an entry from ${d}`); continue; }
      const unknown = [...new Set(rows.flatMap((x) => Object.keys(x.prompts)).filter((id) => !(id in PROMPT_ACTIONS)))];
      if (unknown.length) gaps.push(`prompts with ${d}: rows show prompts the shell doesn't hold: ${unknown.join(', ')}`);
      if (!rows.slice(first + 1).some((x) => Object.keys(x.prompts).length > 0)) gaps.push(`prompts with ${d}: no row after its first entry shows a prompt`);
      for (const w of disagreeing(rows, d).slice(0, 5)) gaps.push(`prompts with ${d}: at step ${w.step} ${w.prompt} shows ${w.glyph}, not ${GLYPHS[d][PROMPT_ACTIONS[w.prompt]!]}`);
    }
    none(gaps, 'the replica\'s rows of the prompts journey');
  }, TIMEOUT);

  it(`${AC[7]} a planted shell that keeps key labels after a pad entry fails prompt.agree, naming the prompt`, async () => {
    macOnly();
    const h = await planted();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['prompts'], devices: ['pad'], sizes: [REFERENCE] }));
    const rows = devicePlays(h.pool, piece, 'prompts', ['pad'], REFERENCE).get('pad')!.flatMap((r) => stepped(r, 'the planted pad run'));
    const wrong = disagreeing(rows, 'pad');
    expect(wrong.length, 'on the planted replica, a prompt shows another glyph than the pad\'s after a pad entry').toBeGreaterThan(0);
    const firstStep = wrong[0]!.step;
    const named = wrong.filter((w) => w.step === firstStep).map((w) => w.prompt);
    expect(result.outcome, `the planted prompts journey fails: ${shown(result)}`).toBe('failed');
    const f = failuresOf(result, 'prompt.agree').map((x) => rest(x.message, 'prompt.agree'));
    expect(f.some((m) => named.some((id) => word(id).test(m))), `a prompt.agree failure names ${named.join(' or ')}: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});
