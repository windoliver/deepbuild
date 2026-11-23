// AC1 #1250.a789fb24: "After 40 s of a scripted play of a 256 × 192 indexed fixture game at 60 fps, Save clip writes a
// 10 s GIF of 300 frames at 30 a second, 512 × 384, whose color table is the look's palette in order, whose every frame,
// decoded and divided by 2, equals the index frame the live play showed at that step, and whose delays are 3, 3, 4
// repeated and sum to 1,000 hundredths; a planted clip that re-quantizes colors through a median cut changes at least
// one pixel of a 16-color frame with a dithered gradient and fails, naming the frame and the pixel"
//
// Through `deep-show run` (full). The indexed game (README: Fixtures) plays live in panel `main` on the scenario's
// 60 Hz clock with the scripted play's `move` inputs; at 40 s ⌘⇧C, Save clip's default key; `clips` reads the card;
// `presented` with `indices` reads the index target of every frame the live play presented from 30 s. The GIF is read
// by this suite's own decoder (helpers.ts `decodeGif`), never by the writer's report. GIF frame j is the frame of the
// clip at 30 s + j/30 s, so it must show the live frame on screen then. Planted: `clip_requantizes_median_cut`.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, GIF_FRAME, TIMEOUT, carriedDelays, checkGif, clipsCall, exportsDir, filesIn, fl, gameDoc, liveFrames, none, oneClip, presented,
  presentedCall, runApp, saveClipKey, scriptedPlay, show, showAt, shownAt, useShow, useTemp, writtenFile, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const KEY = fl(40);
const FROM = fl(30);

/** 40 s of the scripted play, Save clip at 40 s: the clip's card, its file, and the live frames from 30 s. */
function playAndClip(planted?: Planted): { state: string; card: ReturnType<typeof oneClip>; bytes: Buffer; live: (j: number) => Uint8Array | null } {
  const evidence = temp(); const state = temp();
  const calls = [showAt(DOC.game, gameDoc(evidence)), ...scriptedPlay(KEY), saveClipKey(KEY), clipsCall(KEY), presentedCall(KEY, FROM)];
  const w = { evidence, state, doc: DOC.game, ...(planted ? { planted } : {}) };
  const replies = runApp(shows.bin(FULL), w, calls, 'the 40 s play and its clip');
  presented(replies[0]!, 'the game');
  const card = oneClip(replies[calls.length - 2]!, 'save_clip', 'the clip');
  const bytes = writtenFile(card, state, DOC.game, 'gif', 'the clip');
  expect(filesIn(exportsDir(state, DOC.game)), 'the exports folder holds the clip and nothing else, no file left at a temporary name').toEqual([card.file!.split('/').pop()]);
  const frames = liveFrames(evidence, replies[calls.length - 1]!, FROM, 'the live play');
  return { state, card, bytes, live: (j) => shownAt(frames, FROM + j * GIF_FRAME)?.indices ?? null };
}

describe(`${AC[1]} Save clip after 40 s writes the GIF the live play showed, exact to its palette`, () => {
  it(`${AC[1]} after 40 s of the scripted play, ⌘⇧C writes a 512 × 384 GIF of 300 frames over [30 s, 40 s) whose colour table is the palette in order, whose frames halved are the live index frames, with delays 3, 3, 4 summing to 1,000, looping forever`, () => {
    const { card, bytes, live } = playAndClip();
    expect(card.range, `the card's range is the last 10 s, [30 s, 40 s): ${show(card.raw)}`).toEqual([FROM, KEY]);
    const { gif, failures } = checkGif(bytes, { frames: 300, delays: carriedDelays(300, 30), live });
    console.log(`${AC[1]}: ${gif.width} × ${gif.height}, ${gif.frames.length} frames, delays ${gif.frames.slice(0, 6).map((f) => f.delay).join(', ')}…, loop ${String(gif.loop)}`);
    expect(carriedDelays(300, 30).slice(0, 6), 'the rule gives 3, 3, 4 at 30 a second').toEqual([3, 3, 4, 3, 3, 4]);
    expect(carriedDelays(300, 30).reduce((a, d) => a + d, 0), 'and 1,000 hundredths over 300 frames').toBe(1000);
    none(failures, 'the clip GIF against the palette, the rule and the live play');
  }, TIMEOUT);

  it(`${AC[1]} a planted clip that re-quantizes through a median cut fails, naming the frame and the pixel, on a frame of 16 colours with the dithered gradient`, () => {
    const { bytes, live } = playAndClip('clip_requantizes_median_cut');
    const { failures } = checkGif(bytes, { frames: 300, delays: carriedDelays(300, 30), live });
    const pixel = failures.map((f) => /^frame (\d+) pixel \((\d+), (\d+)\)/.exec(f)).find((m) => m !== null);
    expect(pixel, `the check fails the re-quantized clip naming a frame and a pixel; its failures: ${failures.slice(0, 6).join(' | ')}`).toBeDefined();
    const j = Number(pixel![1]);
    const shown = live(j);
    expect(shown, `the live play showed a frame for GIF frame ${j}`).not.toBeNull();
    expect(new Set(shown!).size, `frame ${j}, which the median cut changed, holds all 16 colours (the dithered gradient)`).toBe(16);
  }, TIMEOUT);
});
