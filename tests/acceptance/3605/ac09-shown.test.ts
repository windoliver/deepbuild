// AC9 #3605.14ffdae4: "Shown to you: screenshots of a level select with marks and chapter counts, and of a settings
// screen with a custom choice, taken by the check run from the canvas's own frames, are attached to the PR and shown to
// you in the session. Whether they look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never
// PASS, and no criterion above reads a picture to judge it"
//
// The fixture shell's `moves` journey with keys at the reference window: the level select, then level 4 completed, so
// the level select ends with a mark on row 4 and the counts 0 of 3 and 1 of 3, and the settings screen holds the
// mains choice. The reply's `screens.levels.frame` and `screens.settings.frame` are sha256s among the check result's
// evidence, each the hash of a PNG the replica wrote at the reference window (or twice it), the two different. They
// are copied to $SHELL3605_SHOWN (or a temp folder this suite keeps) and listed. That proves only that the evidence
// exists by hash; attaching it to the PR and showing it to you are the implementing agent's, and whether it looks right
// is your taste call, which no test makes, so this test ends INCONCLUSIVE, never PASS.
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, DOC, REFERENCE, TIMEOUT, fileByHash, hubOnce, inconclusive, journeysInput, macOnly, none, onePlay, pngSize, putShell, runJourneys, shownDir } from './helpers.ts';
import { allPrograms, completeFromTitle, programs, shellDocument } from './shell.ts';

const hub = hubOnce();

describe(`${AC[9]} shown to you: a level select with marks and counts, and a settings screen with the custom choice, from the canvas's own frames`, () => {
  it(`${AC[9]} the check run keeps the level select's and the settings screen's frames as evidence by hash; whether they look right is your taste call, so this stays INCONCLUSIVE`, async () => {
    macOnly();
    const p = programs();
    const h = await hub();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['moves'], moves: completeFromTitle(4) }));
    const reply = onePlay(h.pool, piece, 'moves', 'keys', 'level 4 completed');
    const wanted = (['levels', 'settings'] as const).map((s) => [s, reply.screens[s]?.frame ?? null] as const);
    const gaps: string[] = [];
    const files = h.pool.files();
    const found: [string, string][] = [];
    for (const [s, sha] of wanted) {
      if (!sha) { gaps.push(`the play gives no frame of the ${s} screen`); continue; }
      if (!result.evidence.includes(sha)) gaps.push(`the check result's evidence lacks the ${s} frame ${sha}`);
      const file = fileByHash(files, sha);
      if (!file) { gaps.push(`no file the replica wrote hashes to ${sha} (${s})`); continue; }
      const size = pngSize(readFileSync(file));
      if (!size || ![1, 2].some((k) => size[0] === REFERENCE[0] * k && size[1] === REFERENCE[1] * k)) gaps.push(`${s}.png is ${size ? size.join(' × ') : 'not a PNG'}, not a frame at the reference window`);
      found.push([`${s}.png`, file]);
    }
    const [levelsFrame, settingsFrame] = wanted.map(([, sha]) => sha);
    if (levelsFrame && levelsFrame === settingsFrame) gaps.push('the level select and the settings screen give one frame');
    none(gaps, 'the evidence the check run kept');
    const out = shownDir();
    for (const [name, file] of found) copyFileSync(file, join(out, name));
    console.log(`AC9: the frames, by hash, copied to ${out}:\n${wanted.map(([s, sha]) => `  ${s}.png  ${String(sha)}`).join('\n')}`);
    expect(found.length).toBe(wanted.length);
    inconclusive('AC9: the evidence exists by hash; attaching it to the PR and showing it to you are the implementing agent\'s, and whether it looks right is your taste call, recorded by you, which no test makes');
  }, TIMEOUT);
});
