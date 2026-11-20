// AC2 #2500.eb02ef3c: A puppet reaching for `cfg#tok:2` ends its hand on that token's box within 0.5 u while the code
// moves
//
// One test, through `deep-motion eval` and `deep-canvas-render geometry` (README: The surfaces under test). The code
// scrolls up 120 u over 2 s (its `at.pos` y keyed linearly) beside a puppet's arm: a chain of three parts whose reach2
// aims at `cfg#tok:2` (README: Choices). At eight times while the code moves, three of them off the key grid, the box
// `geometry` gives for `cfg#tok:2` is token 2's ("with", from the glyphs `raster` sets, moved by the scroll), and the
// hand, the chain's end (`items.hand.at.pos`), lies within 0.5 u of that box. The judge is first shown rejecting the
// planted wrong programs (README: Wrong programs): hands at the centre of a wrong box `geometry` gives.
import { describe, it } from 'vitest';
import {
  AC, AT, CODE, HAND, TIMEOUT, TOK, boxes, centreOf, evaluated, failsNaming, fl, handFailures, layout, none, page, posOf,
  reachFilm, scrollY, tokenBoxFailures, useBin, useDir, useMotion, type Box,
} from './helpers.ts';

const ID = AC[2];
const render = useBin('deep-canvas-render');
const motion = useMotion();
const dir = useDir();

const SECONDS = [0, 0.37, 0.5, 1, 1.13, 1.5, 1.71, 2];
const TIMES = SECONDS.map(fl);
const ANCHOR = `${CODE}#tok:${TOK}`;

describe(`${ID} a puppet's reach for a code token`, () => {
  it(`${ID} a puppet reaching for ${ANCHOR} ends its hand on that token's box within 0.5 u at every time while the code moves`, () => {
    const code = layout(render(), dir());
    // The boxes `geometry` gives at each time: token 2's, its neighbours' (tokens 1 and 3) and the whole item's.
    const names = [ANCHOR, `${CODE}#tok:${TOK - 1}`, `${CODE}#tok:${TOK + 1}`, CODE];
    const got = boxes(render(), page('code-scroll-2500', true), TIMES.flatMap((t) => names.map((n): [string, number] => [n, t])));
    const of = (k: number): Box[] => SECONDS.map((_, i) => got[i * names.length + k]!);
    const [tok, before, after, whole] = [of(0), of(1), of(2), of(3)];
    // Each box of cfg#tok:2 is token 2's where the scroll has put it, so a wrong anchor can't agree with itself.
    none(SECONDS.flatMap((s, i) => tokenBoxFailures(`at ${s} s`, tok[i]!, code, TOK, scrollY(s) - AT[1])), `the boxes geometry gives for ${ANCHOR} while the code moves are token ${TOK}'s`);

    const named = `from ${ANCHOR}'s box`;
    failsNaming(handFailures(SECONDS, tok, whole.map(centreOf)), named, 'a reach aiming at the whole item (the anchor dropped)');
    failsNaming(handFailures(SECONDS, tok, before.map(centreOf)), named, `a reach aiming at ${CODE}#tok:${TOK - 1} (#tok:${TOK} counted from 1)`);
    failsNaming(handFailures(SECONDS, tok, after.map(centreOf)), named, `a reach aiming at ${CODE}#tok:${TOK + 1}`);
    failsNaming(handFailures(SECONDS, tok, SECONDS.map(() => centreOf(tok[0]!))), named, 'a hand left at its first-frame target while the code moves');

    const [reach] = evaluated(motion.bin(), [[`the arm reaching for ${ANCHOR}`, { doc: reachFilm('reach-tok2-2500', ANCHOR), times: TIMES }]]);
    // The code moves in the arm's film as on the page.
    none(reach!.frames.flatMap((f, i) => {
      const [x, y] = posOf(f, CODE);
      return Math.abs(x - AT[0]) <= 1e-6 && Math.abs(y - scrollY(SECONDS[i]!)) <= 1e-6 ? [] : [`at ${SECONDS[i]} s the code is at (${x}, ${y}), not where the scroll puts it`];
    }), 'the code in the arm\'s film');
    none(handFailures(SECONDS, tok, reach!.frames.map((f) => posOf(f, HAND))), `the hand reaching for ${ANCHOR} while the code moves`);
  }, TIMEOUT);
});
