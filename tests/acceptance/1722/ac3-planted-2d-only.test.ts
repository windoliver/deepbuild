// AC3 #1722.ca41cae8: A planted render-back that drops the 3D layers and draws only the 2D marks fails the first
// criterion on pixel hash, and gives no `module_missing`.
//
// The plant (README: Planted program): `planted: "render_back_2d_only"` in the scenario, the only way to reach it.
// AC1's scenario runs under it: the agent's document presented at rev 1 (presenting is not planted, so its snapshot is
// held to the fixture as in AC1), then a render-back of rev 1 at the same t and size. The first criterion's own judge
// must then fail, and on pixel hash: the render-back gives a snapshot, its pixel hash not the presenting reply's.
// Nothing in its reply may say `module_missing`. And the plant must be the one the criterion names: where the badge
// covers the box its snapshot draws the badge as presenting drew it (within 2 codes), and where the box shows alone it
// doesn't draw the box presenting drew there (more than 2 codes off).
//
// Wrong programs this fails on: the merge base, whose run refuses the unknown planted name with `bad_input`; a plant that
// draws the real frame (the hashes equal); one that refuses or answers `module_missing`; one that draws no badge, or
// still draws the box.
import { describe, expect, it } from 'vitest';
import { AC3, AT, PLANTED, codes, fixtureChecks, judge, pixel, present, presented, proof, renderBack, requireMetal, runShow, scenario, shown, useDir, useShow } from './helpers.ts';

const bin = useShow();
const dir = useDir();

describe(`${AC3} a planted render-back that draws only the 2D marks`, () => {
  it(`${AC3} a planted render-back that drops the 3D layers and draws only the 2D marks fails the first criterion on pixel hash, and gives no module_missing`, () => {
    requireMetal();
    const replies = runShow(bin(), scenario(dir(), [present(), renderBack(1)], PLANTED), `AC1's scenario under planted ${PLANTED}`);
    const first = presented(dir(), replies[0]!, 'presenting rev 1 under the plant');
    fixtureChecks(first, 'presenting rev 1 under the plant');
    const back = replies[1]!;
    expect(JSON.stringify(back).includes('module_missing'), `the planted render-back gives no module_missing: ${shown(back)}`).toBe(false);

    const failure = judge(dir(), back, first, 'the planted render-back of rev 1', 'the presenting reply');
    proof('AC3 planted render-back against presenting rev 1', { planted: PLANTED, presented: first.pixelHash, failure: failure?.text ?? null });
    if (failure === null) return expect.fail(`the first criterion's judge fails on the plant (${PLANTED}), but its render-back has the presenting reply's pixel hash ${first.pixelHash}`);
    if (failure.kind !== 'pixel_hash') return expect.fail(`the plant fails the first criterion on pixel hash, not this way: ${failure.text}`);

    // The plant is the one the criterion names: the 2D marks drawn, the 3D layers dropped.
    const planted = failure.back.image;
    const badge = [pixel(first.image, AT.badgeOverBox), pixel(planted, AT.badgeOverBox)] as const;
    const box = [pixel(first.image, AT.boxAlone), pixel(planted, AT.boxAlone)] as const;
    expect(codes(badge[0], badge[1]), `the plant draws the 2D badge: at (${AT.badgeOverBox}) presenting drew ${badge[0]}, the plant ${badge[1]}`).toBeLessThanOrEqual(2);
    expect(codes(box[0], box[1]), `the plant drops the 3D box: at (${AT.boxAlone}) presenting drew the box's ${box[0]}, the plant ${box[1]}`).toBeGreaterThan(2);
  }, 1_800_000);
});
