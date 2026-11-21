// AC6 #1250.5ed3407b: "Save still on an indexed fixture writes an indexed PNG with the palette in order, and its pixels
// equal the frame on screen"
//
// Through `deep-show run` (full). The indexed game plays 7 s of the scripted play; half a frame later (7 s + 1/120 s, so
// the frame on screen is unambiguously the one presented at 7 s) Save still runs as the app's player-control action
// (`input` with `{type: "action", action: "save_still"}`; it has no default key). `clips` reads the card and
// `presented` with `indices` the frames the live play presented from 6 s. The PNG is read by this suite's own reader
// (helpers.ts `decodeIndexedPng`): colour type 3 (indexed), its PLTE's first 16 entries the palette's colours in index
// order, 512 × 384 (`save_still.scale` 2), and every pixel's index the on-screen frame's at its target pixel (X ÷ 2,
// Y ÷ 2). No wrong program is named.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FLICKS, FULL, PALETTE, PALETTE_HEX, SIZE, TARGET, TIMEOUT, clipsCall, decodeIndexedPng, exportsDir, filesIn, fl, gameDoc, hexOf, liveFrames,
  none, oneClip, presented, presentedCall, runApp, saveStill, scriptedPlay, showAt, shownAt, useShow, useTemp, writtenFile,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const AT = fl(7) + FLICKS / 120;

describe(`${AC[6]} Save still writes the frame on screen as an indexed PNG with the palette`, () => {
  it(`${AC[6]} half a frame after 7 s, Save still writes a 512 × 384 indexed PNG whose palette is the look's in order and whose pixels are the frame presented at 7 s`, () => {
    const evidence = temp(); const state = temp();
    const calls = [showAt(DOC.game, gameDoc(evidence)), ...scriptedPlay(AT), saveStill(AT), clipsCall(AT), presentedCall(AT, fl(6))];
    const replies = runApp(shows.bin(FULL), { evidence, state, doc: DOC.game }, calls, 'the 7 s play and its still');
    presented(replies[0]!, 'the game');
    const card = oneClip(replies[calls.length - 2]!, 'save_still', 'the still');
    const png = decodeIndexedPng(writtenFile(card, state, DOC.game, 'png', 'the still'));
    expect(filesIn(exportsDir(state, DOC.game)), 'the exports folder holds the still and nothing else').toEqual([card.file!.split('/').pop()]);
    const screen = shownAt(liveFrames(evidence, replies[calls.length - 1]!, fl(6), 'the live play'), AT);
    expect(screen?.t, 'the frame on screen half a frame after 7 s is the one presented at 7 s').toBe(fl(7));
    console.log(`${AC[6]}: ${png.width} × ${png.height}, colour type ${png.colourType}, depth ${png.depth}, ${png.palette.length} palette entries`);
    expect(png.colourType, 'the still is an indexed PNG (colour type 3)').toBe(3);
    expect(png.interlace, 'not interlaced').toBe(0);
    expect(png.palette.slice(0, PALETTE_HEX.length).map(hexOf), `its palette is the look's, in index order (PLTE: ${png.palette.length} entries)`).toEqual([...PALETTE_HEX]);
    expect([png.width, png.height], 'the still is the target at scale 2').toEqual(SIZE);
    const failures: string[] = [];
    for (let Y = 0; Y < png.height && failures.length < 12; Y++) for (let X = 0; X < png.width && failures.length < 12; X++) {
      const got = png.indices![Y * png.width + X]!; const want = screen!.indices[(Y >> 1) * TARGET[0] + (X >> 1)]!;
      if (got !== want) failures.push(`pixel (${X}, ${Y}): index ${got} (${PALETTE[got] ? hexOf(PALETTE[got]) : 'off the palette'}), where the frame on screen shows ${want}`);
    }
    none(failures, 'the still\'s pixels against the frame on screen');
  }, TIMEOUT);
});
