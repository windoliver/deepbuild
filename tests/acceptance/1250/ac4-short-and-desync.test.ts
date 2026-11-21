// AC4 #1250.60cb9b00: "Save clip 5 s into a play writes 5 s, not 10, and a clip whose replica ends at a different
// full-state hash from the live play's (a planted piece that reads the wall clock) isn't written, its card naming the
// first step, module and field that differ"
//
// Through `deep-show run` (full). Short: the indexed game plays 5 s of the scripted play and ⌘⇧C saves the clip; it
// covers [0, 5 s), 150 frames at 30 a second whose delays sum to 500, each the live frame on screen at its time, the
// first the play's first frame. Refused: the same game under the scenario's `planted: "logic_reads_wall_clock"`, the planted
// piece that reads the wall clock (README: Planted programs: after every step the logic module adds the wall clock to
// element 0 of `game.x`, in the live play and in the replica alike), plays 20 s and ⌘⇧C asks for [10 s, 20 s). The
// replica restores the nearest checkpoint at or before 10 s (step 600) and replays from it, so the first step that
// differs is one it replays, at or before step 600; the card is `clip.desync`, its `desync` names that step, module
// `logic` and field `game.x`, its words name all three, and no file is in the piece's exports folder.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, GIF_FRAME, TIMEOUT, carriedDelays, checkGif, clipsCall, exportsDir, filesIn, fl, gameDoc, liveFrames, none, oneClip, presented,
  presentedCall, runApp, saveClipKey, scriptedPlay, show, showAt, shownAt, stepAt, useShow, useTemp, writtenFile,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

describe(`${AC[4]} a clip never reaches before the play's start, and a replica that ends elsewhere than the live play writes nothing`, () => {
  it(`${AC[4]} Save clip 5 s into the play writes [0, 5 s): 150 frames whose delays sum to 500 hundredths, the first the play's first frame`, () => {
    const evidence = temp(); const state = temp(); const KEY = fl(5);
    const calls = [showAt(DOC.game, gameDoc(evidence)), ...scriptedPlay(KEY), saveClipKey(KEY), clipsCall(KEY), presentedCall(KEY, 0)];
    const replies = runApp(shows.bin(FULL), { evidence, state, doc: DOC.game }, calls, 'the 5 s play and its clip');
    presented(replies[0]!, 'the game');
    const card = oneClip(replies[calls.length - 2]!, 'save_clip', 'the clip');
    expect(card.range, `the card's range is the play so far, [0, 5 s), not 10 s: ${show(card.raw)}`).toEqual([0, KEY]);
    const bytes = writtenFile(card, state, DOC.game, 'gif', 'the clip');
    const frames = liveFrames(evidence, replies[calls.length - 1]!, 0, 'the live play');
    const { gif, failures } = checkGif(bytes, { frames: 150, delays: carriedDelays(150, 30), live: (j) => shownAt(frames, j * GIF_FRAME)?.indices ?? null });
    console.log(`${AC[4]}: the 5 s clip holds ${gif.frames.length} frames, ${gif.frames.reduce((a, f) => a + f.delay, 0)} hundredths`);
    none(failures, 'the 5 s clip against the rule and the live play from its start');
  }, TIMEOUT);

  it(`${AC[4]} under the planted piece that reads the wall clock, Save clip at 20 s writes nothing, and its card names clip.desync, the first step that differs (at or before step 600), module logic and field game.x`, () => {
    const evidence = temp(); const state = temp(); const KEY = fl(20);
    const calls = [showAt(DOC.game, gameDoc(evidence)), ...scriptedPlay(KEY), saveClipKey(KEY), clipsCall(KEY)];
    const replies = runApp(shows.bin(FULL), { evidence, state, doc: DOC.game, planted: 'logic_reads_wall_clock' }, calls, 'the 20 s play under the wall-clock piece');
    presented(replies[0]!, 'the game');
    const card = oneClip(replies[calls.length - 1]!, 'save_clip', 'the refused clip');
    console.log(`${AC[4]}: the card: ${show(card.raw)}`);
    expect([card.outcome, card.code], 'the clip is refused as clip.desync').toEqual(['refused', 'clip.desync']);
    expect(card.file, 'the card names no file').toBeNull();
    expect(filesIn(exportsDir(state, DOC.game)), 'nothing is written to the piece\'s exports folder, under any name').toEqual([]);
    expect(card.desync, `the card names the first difference: ${show(card.raw)}`).not.toBeNull();
    const d = card.desync!;
    expect([d.module, d.field], 'the module and field that differ: the logic item\'s array the wall clock reaches').toEqual(['logic', 'game.x']);
    expect(d.first_step >= 0 && d.first_step <= stepAt(fl(10)), `the first step that differs, ${d.first_step}, is one the replica replays: at or before the clip's start, step ${stepAt(fl(10))}`).toBe(true);
    for (const word of [String(d.first_step), 'logic', 'game.x']) expect(card.text.includes(word), `the card's words name ${word}: ${JSON.stringify(card.text)}`).toBe(true);
  }, TIMEOUT);
});
