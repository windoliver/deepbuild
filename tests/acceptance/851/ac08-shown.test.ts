// AC8 #851.651a914b: "Shown to you: screenshots of the title, settings, level select, pause, game over and credits
// screens, taken by the check run from the canvas's own frames, with a recording of a scene change from level 1 to
// level 2, are attached to the PR and shown to you in the session. Whether they look right is one taste call, recorded;
// without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// The fixture shell's back journey (which shows every screen) and carry journey (which goes from level 1 to level 2)
// with keys at the reference window. Their replies give a frame by sha256 for each of the six screens and a recording
// for the run whose rows load level 1 and then level 2; each of those hashes is among the check result's evidence and
// is the sha256 of a file the replica wrote, each frame a PNG at the reference window (1512 × 982, or twice that at the
// replica's scale 2), the six frames all different. They are copied to $SHELL851_SHOWN (or a temp folder this suite
// keeps) and listed. That proves only that the evidence exists by hash; attaching it to the PR and showing it to you are
// the implementing agent's, and whether it looks right is your taste call, which no test can make, so this test ends
// INCONCLUSIVE, never PASS.
import { copyFileSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, REFERENCE, SCREENS, TIMEOUT, devicePlays, fileByHash, hubOnce, inconclusive, journeysInput, macOnly, none, pngSize, putShell, runJourneys, shownDir,
  stepped, type Screen,
} from './helpers.ts';
import { allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce();

describe(`${AC[8]} shown to you: the six screens and a scene change from level 1 to level 2, from the canvas's own frames`, () => {
  it(`${AC[8]} the check run keeps a frame of each of the six screens and a recording of level 1 to level 2 as evidence by hash; whether they look right is your taste call, so this stays INCONCLUSIVE`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['back', 'carry'], devices: ['keys'], sizes: [REFERENCE] }));
    const replies = [...devicePlays(h.pool, piece, 'back', ['keys'], REFERENCE).get('keys')!, ...devicePlays(h.pool, piece, 'carry', ['keys'], REFERENCE).get('keys')!];
    const frames = new Map<Screen, string>();
    for (const r of replies) for (const s of SCREENS) { const f = r.screens[s]?.frame; if (f && !frames.has(s)) frames.set(s, f); }
    const sceneChange = replies.find((r) => {
      const rows = stepped(r, 'a play');
      const one = rows.findIndex((x) => x.level === 0);
      return one >= 0 && rows.slice(one).some((x) => x.level === 1);
    });
    const gaps: string[] = [];
    for (const s of SCREENS) if (!frames.has(s)) gaps.push(`no play gives a frame of the ${s} screen`);
    if (!sceneChange) gaps.push('no play loads level 1 and then level 2');
    else if (!sceneChange.recording) gaps.push('the play that goes from level 1 to level 2 gives no recording');
    const wanted = [...[...frames].map(([s, f]) => [`${s}.png`, f] as const), ...(sceneChange?.recording ? [['level1-to-level2', sceneChange.recording] as const] : [])];
    for (const [, sha] of wanted) if (!result.evidence.includes(sha)) gaps.push(`the check result's evidence lacks ${sha}`);
    if (new Set(frames.values()).size !== frames.size) gaps.push('two screens give one frame');
    const files = h.pool.files();
    const found: [string, string][] = [];
    for (const [name, sha] of wanted) {
      const file = fileByHash(files, sha);
      if (!file) { gaps.push(`no file the replica wrote hashes to ${sha} (${name})`); continue; }
      found.push([name, file]);
      if (name.endsWith('.png')) {
        const size = pngSize(readFileSync(file));
        if (!size || ![1, 2].some((k) => size[0] === REFERENCE[0] * k && size[1] === REFERENCE[1] * k)) gaps.push(`${name} is ${size ? size.join(' × ') : 'not a PNG'}, not a frame at the reference window`);
      }
    }
    none(gaps, 'the evidence the check run kept');
    const out = shownDir();
    for (const [name, file] of found) copyFileSync(file, join(out, name.endsWith('.png') ? name : `${name}-${basename(file)}`));
    console.log(`AC8: the frames and the recording, by hash, copied to ${out}:\n${wanted.map(([n, s]) => `  ${n}  ${s}`).join('\n')}`);
    expect(found.length).toBe(wanted.length);
    inconclusive('AC8: the evidence exists by hash; attaching it to the PR and showing it to you are the implementing agent\'s, and whether it looks right is your taste call, recorded by you, which no test makes');
  }, TIMEOUT);
});
