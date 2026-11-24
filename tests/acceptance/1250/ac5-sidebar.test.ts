// AC5 #1250.d8e39d5f: "The clip contains no pixel from outside the piece's frame: a fixture with a bright app sidebar
// beside the panel gives a clip whose frames hold only the palette's colors"
//
// Through `deep-show run` (full). The scenario's world adds panel `side`, 256 × 384 right beside the game's panel
// `main` (512 × 384 at the origin), showing the bright sidebar (README: Fixtures: magenta and lime, in no palette of the
// game), as the app's own sidebar would sit beside a panel. The indexed game plays 12 s of the scripted play and ⌘⇧C
// saves the last 10 s. Every pixel of every frame, as this suite's decoder composites it, must be one of the palette's
// 16 colours, the GIF the piece's frame size (512 × 384) and its colour table the palette: a clip captured from the
// screen around the panel would hold the sidebar's colours or its size. No wrong program is named.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, SIDE_PANEL, SIZE, TIMEOUT, clipsCall, fl, gameDoc, none, offPalette, oneClip, presented, runApp, saveClipKey, scriptedPlay, showAt,
  sidebarDoc, useShow, useTemp, writtenFile,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const KEY = fl(12);

describe(`${AC[5]} a clip holds no pixel from outside the piece's frame`, () => {
  it(`${AC[5]} with a bright sidebar beside the game's panel, the clip is 512 × 384 and every pixel of every frame is a palette colour`, () => {
    const evidence = temp(); const state = temp();
    const calls = [showAt(DOC.game, gameDoc(evidence)), showAt(DOC.side, sidebarDoc(evidence)), ...scriptedPlay(KEY), saveClipKey(KEY), clipsCall(KEY)];
    const replies = runApp(shows.bin(FULL), { evidence, state, doc: DOC.game, sidebar: true }, calls, `the game beside a bright sidebar on panel ${SIDE_PANEL}`);
    presented(replies[0]!, 'the game');
    presented(replies[1]!, 'the sidebar');
    const bytes = writtenFile(oneClip(replies[calls.length - 1]!, 'save_clip', 'the clip'), state, DOC.game, 'gif', 'the clip');
    const { gif, failures } = offPalette(bytes);
    console.log(`${AC[5]}: ${gif.width} × ${gif.height}, ${gif.frames.length} frames; ${failures.length ? failures.slice(0, 3).join(' | ') : 'every pixel a palette colour'}`);
    expect([gif.width, gif.height], 'the clip is the piece\'s frame, 512 × 384, and nothing around it').toEqual(SIZE);
    expect(gif.frames.length, 'the clip holds 10 s at 30 a second').toBe(300);
    none(failures, 'the clip\'s pixels against the palette');
  }, TIMEOUT);
});
