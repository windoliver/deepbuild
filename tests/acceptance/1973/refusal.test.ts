// AC2: "`slab@1` with `size: [20, 20]` is refused with one issue at `items/<id>/params/size` whose fix names the
// 3-number form; on the merge base the two issues name no form and fail."
//
// asserts: the agent's deep_show (on `deep-show run`, as the hub's deep_show tool has the canvas core play it) of a
// one-slab scene, a camera, a sun and the slab `box` with size [20, 20], is refused with exactly one issue at
// items/box/params/size, an error, and no error anywhere else; that issue's fix (its `fix` text, `fix_ops`, `forms`
// and any field it carries beyond what it is, where and what it refused) names the 3-number form: "3 numbers" or
// "three numbers", or a list of three elements such as [x, y, z] (helpers.ts, refusalFailures). The same scene with
// size [1, 1, 1] passes the document check, so the one error is the size's. The merge base's two issues (from
// scene3d.build and scene3d.lights, which runs on a scene with a light) fail, each by path and fix (BASE-FAILURE.txt).

import { describe, expect, it } from 'vitest';
import { ISSUE_PATH, REFUSED_SIZE, checkFailures, docId, refusalFailures, run, showCall, showWorld, slabScene, useFullBuild } from './helpers.ts';

const build = useFullBuild();

describe('AC2 a refused structured value names the form it expected', () => {
  it('AC2 slab@1 with size [20, 20] is refused with one issue at items/<id>/params/size whose fix names the 3-number form', () => {
    const bin = build();
    const [refused, clean] = [docId(1), docId(2)];
    const [r, c] = run(bin, [showCall(refused, slabScene(REFUSED_SIZE)), showCall(clean, slabScene([1, 1, 1]))], undefined, showWorld([refused, clean]));
    expect.soft(refusalFailures(r!), `slab@1 with size [20, 20], at ${ISSUE_PATH}`).toEqual([]);
    expect.soft(checkFailures(c!, 'the same scene with size [1, 1, 1]'), 'the control passes the document check').toEqual([]);
  }, 3_600_000);
});
