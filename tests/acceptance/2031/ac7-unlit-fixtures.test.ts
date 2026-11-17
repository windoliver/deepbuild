// AC7 #2031.270a96f9: "Every 2D fixture already in the repo, none of which names a `light`, draws a frame byte-identical
// to the merge base"
//
// The merge base is `git merge-base HEAD origin/main` (else `main`). Its tree is exported and its own `deep-canvas-render`
// and `deep-gpu` built from it (helpers `useMergeBase`); the checkout's are built as every file here builds them. The
// fixtures are the parity suite's 2D area as the merge base holds it: every file under a `fixtures/parity/2d/` folder
// (helpers `parityFixtures`; eleven at the base this was written on, from #160, #373 and #391), each read from the
// merge base's tree and drawn with the same inputs by both sides at 0 and 1 s. A frame is every picture the surfaces
// draw of it: `raster` (Vello CPU, as goldens draw), `window2d` (the app's window) and `layers` by GPUI, the GPU layer
// and Vello CPU, with each layer's draw path (helpers `framesOf`). Each must be byte-identical (the same SHA-256 of
// its PNG) to the merge base's, and a refusal the same refusal. A fixture the merge base draws no picture of can't be
// judged: the test then fails INCONCLUSIVE, naming it, after every other comparison holds (README: Readings).
// Wrong programs: a lit pass run on every group, a default ambient applied to a group with no `light`, a draw path
// moved for unlit layers, a change to the shared scene build that moves a pixel.
import { describe, it } from 'vitest';
import {
  AC, framesOf, inconclusive, none, parityFixtures, requireMetal, useBin, useDir, useMergeBase,
} from './helpers.ts';

const ID = AC[7];
const head = { canvas: useBin('deep-canvas-render'), gpu: useBin('deep-gpu') };
const base = useMergeBase();
const dir = useDir();

describe(`${ID} every 2D fixture already in the repo draws as at the merge base`, () => {
  it(`${ID} each parity 2D fixture's frames are byte-identical to the merge base's`, () => {
    requireMetal();
    const { rev, src, canvas, gpu } = base();
    const { fixtures, lit } = parityFixtures(src, rev, dir());
    if (lit.length) console.log(`${ID}: left out, naming a light: ${lit.join(', ')}`);
    if (!fixtures.length) inconclusive(`the merge base ${rev.slice(0, 12)} holds no 2D fixture`);
    const before = framesOf(canvas, gpu, fixtures, `${dir()}/base`);
    const after = framesOf(head.canvas(), head.gpu(), fixtures, `${dir()}/head`);
    const failures = [...new Set([...before.keys(), ...after.keys()])].flatMap((k) => (before.get(k) === after.get(k) ? [] : [`${k}: ${after.get(k) ?? 'missing'} where the merge base has ${before.get(k) ?? 'nothing'}`]));
    console.log(`${ID}: ${fixtures.length} fixtures, ${before.size} frames and paths compared with the merge base ${rev.slice(0, 12)}; ${failures.length} differ`);
    none(failures, `frames that differ from the merge base ${rev.slice(0, 12)}'s`);
    const undrawn = fixtures.filter((f) => ![...before.entries()].some(([k, v]) => k.startsWith(`${f.path} at `) && v.startsWith('png ')));
    if (undrawn.length) inconclusive(`the merge base draws no picture of ${undrawn.map((f) => f.path).join(', ')}, so its frame can't be compared`);
  });
});
