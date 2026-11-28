// AC6 #3605.840dc1ba: "The same level played alone reads 230. Under a shell that declares no `mains` it reads 230 too."
//
// Level 0 (sockets), whose logic lists `settings: {mains: 230}`, played alone: the replica's play mode with the level's
// document and no shell, 120 steps, l0.seen asked at each step: it reads 230 at every step. Then the planted document
// `noCustom` (the fixture shell with no `settings.custom` and no mains choice) through the `moves` journey with keys:
// the level select, level 0 entered and played to its step 60. The check passes, and l0.seen reads 230 at every step
// 0 to 60.
// The wrong programs: the base, a level that reads zeros or nothing with no shell, and one that reads its default only
// under a shell that declares the name.
import { describe, expect, it } from 'vitest';
import { AC, DOC, SEED, TIMEOUT, atLevelStep, hubOnce, journeysInput, macOnly, onePlay, passed, putShell, runJourneys, show, stepped } from './helpers.ts';
import { allPrograms, levelOf, programs, shellDocument } from './shell.ts';

const hub = hubOnce();

describe(`${AC[6]} with no shell, or a shell that declares no mains, a level reads its listed default 230`, () => {
  it(`${AC[6]} level 0 played alone reads 230, and under a shell that declares no mains it reads 230 too`, async () => {
    macOnly();
    const p = programs();
    const h = await hub();
    const program = p.lessons[0]!;
    const alone = await h.pool.direct({ call: 'play', document: levelOf(shellDocument(p), 0), assets: { [program.sha]: program.b64 }, seed: SEED, span: { steps: 120 }, values: ['l0.seen'] });
    expect(alone['ok'], `level 0 plays alone: ${show(alone, 800)}`).toBe(true);
    const seen = ((alone['values']?.['l0.seen'] ?? []) as unknown[]).map((v) => Number(Array.isArray(v) ? v[0] : v));
    expect(seen.length, 'played alone, level 0 gives seen at each of its 120 steps').toBe(120);
    expect([...new Set(seen)], 'played alone, level 0 reads 230 from step 0').toEqual([230]);

    const piece = putShell(DOC.noCustom, shellDocument(p, { noCustom: true }), allPrograms(p));
    passed(await runJourneys(h, journeysInput(piece, { journeys: ['moves'], moves: [{ activate: 'levels_button' }, { activate: 'row_0' }, { play: 60 }] })), 'the shell with no mains, level 0 entered, with keys');
    const rows = stepped(onePlay(h.pool, piece, 'moves', 'keys', 'the shell with no mains'), 'the shell with no mains');
    const under = Array.from({ length: 61 }, (_, k) => atLevelStep(rows, 0, k)?.values['l0.seen']?.[0]);
    expect([...new Set(under)], 'under a shell that declares no mains, level 0 reads 230 at every step 0 to 60').toEqual([230]);
  }, TIMEOUT);
});
