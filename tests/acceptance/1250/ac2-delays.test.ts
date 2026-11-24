// AC2 #1250.fb20b3cc: "A planted clip that writes every frame at 60 a second with delays of 1 and 2 fails, naming the
// first delay under 2"
//
// Through `deep-show run` (full) with the scenario's `planted: "clip_gif_every_frame"`: the clip's GIF writer takes
// every frame of the 60 fps play, with delays in hundredths carried as the rule carries them. The indexed game plays
// 12 s of the scripted play and ⌘⇧C saves the last 10 s. This suite's GIF check (helpers.ts `checkGif`, the one AC1
// judges the shipped clip with) must fail on it, and one failure must name the first frame whose delay is under 2 and
// that delay, as this suite's own decoder reads them. The test first holds that the plant is what the criterion says:
// 600 frames, every delay 1 or 2, some 1.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, TIMEOUT, carriedDelays, checkGif, clipsCall, decodeGif, fl, gameDoc, oneClip, presented, runApp, saveClipKey, scriptedPlay,
  showAt, useShow, useTemp, writtenFile,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const KEY = fl(12);

describe(`${AC[2]} a clip written at 60 a second with delays of 1 and 2 fails, naming the first delay under 2`, () => {
  it(`${AC[2]} the planted clip_gif_every_frame: 600 frames with delays of 1 and 2, and the GIF check fails naming the first frame whose delay is under 2`, () => {
    const evidence = temp(); const state = temp();
    const calls = [showAt(DOC.game, gameDoc(evidence)), ...scriptedPlay(KEY), saveClipKey(KEY), clipsCall(KEY)];
    const replies = runApp(shows.bin(FULL), { evidence, state, doc: DOC.game, planted: 'clip_gif_every_frame' }, calls, 'the 12 s play and its clip');
    presented(replies[0]!, 'the game');
    const bytes = writtenFile(oneClip(replies[calls.length - 1]!, 'save_clip', 'the planted clip'), state, DOC.game, 'gif', 'the planted clip');
    const delays = decodeGif(bytes).frames.map((f) => f.delay);
    expect(delays.length, 'the planted clip writes every frame of 10 s at 60 a second').toBe(600);
    expect([...new Set(delays)].sort(), 'its delays are 1 and 2 hundredths').toEqual([1, 2]);
    const first = delays.findIndex((d) => d < 2);
    const { failures } = checkGif(bytes, { frames: 300, delays: carriedDelays(300, 30), live: null });
    console.log(`${AC[2]}: the planted clip's first delays ${delays.slice(0, 9).join(', ')}; the check: ${failures.slice(0, 4).join(' | ')}`);
    expect(failures.length, 'the GIF check fails the planted clip').toBeGreaterThan(0);
    expect(failures.some((f) => f.startsWith(`frame ${first}: delay ${delays[first]} hundredths, under 2`)), `a failure names the first delay under 2, frame ${first}'s ${delays[first]}: ${failures.join(' | ')}`).toBe(true);
  }, TIMEOUT);
});
