// AC1 #1722.0e7d621b: A 3D document presented at rev 1, then rendered back at rev 1 and the same `t` and size, gives a
// snapshot whose pixel hash equals the presenting reply's. On the merge base it answers `module_missing` and the test
// fails, naming the kind.
//
// The fixture (README: The fixture): the agent's whole document, presented by `deep_show` at t = 0 and 320 × 240 px with
// its pixels, so it is rev 1: `box`, a 2 m `mark.box@1` at the origin, makes its layer a 3D writer layer, and `badge`, a
// `rect@1` over the box's top-left corner, is a 2D item that layer draws over its 3D frame. The presenting snapshot is
// first held to the fixture: the box and the badge both drawn, the badge over the box.
//
// One render-back of rev 1 at the same t and size, in the same run (`deep_show` with no document and no patch, as
// `deep-show run` takes it: `{call: render_back, session, doc, t, rev, size}`). Its first snapshot, read from the
// evidence store, must have the presenting snapshot's pixel hash. A reply that refuses fails naming its code and path,
// which for a missing module names the item's kind (`items/box/kind: mark.box@1`); a snapshot of other pixels fails
// naming both hashes and how many pixels differ.
//
// Wrong programs this fails on: the merge base (README: The base); a render-back that draws only the 2D marks (AC3's
// plant), or only the 3D frame without the badge over it, or at another t or size, or through another path than the
// one presenting uses wherever that changes a pixel.
import { describe, expect, it } from 'vitest';
import { AC1, fixtureChecks, judge, present, presented, proof, renderBack, requireMetal, runShow, scenario, useDir, useShow } from './helpers.ts';

const bin = useShow();
const dir = useDir();

describe(`${AC1} render-back of the presented revision`, () => {
  it(`${AC1} a 3D document presented at rev 1, then rendered back at rev 1 and the same t and size, gives a snapshot whose pixel hash equals the presenting reply's`, () => {
    requireMetal();
    const replies = runShow(bin(), scenario(dir(), [present(), renderBack(1)]), 'present rev 1, render back rev 1');
    const shown = presented(dir(), replies[0]!, 'presenting rev 1');
    fixtureChecks(shown, 'presenting rev 1');
    const failure = judge(dir(), replies[1]!, shown, 'render-back of rev 1 at the same t and size', 'the presenting reply');
    proof('AC1 presenting rev 1 and its render-back', {
      presented: { sha256: shown.sha256, pixel_hash: shown.pixelHash },
      render_back: failure === null ? { pixel_hash: shown.pixelHash, equal: true } : failure.kind === 'pixel_hash' ? { sha256: failure.back.sha256, pixel_hash: failure.back.pixelHash, equal: false } : replies[1]!,
    });
    expect(failure?.text ?? null, 'render-back of rev 1 draws the snapshot presenting rev 1 drew, by pixel hash').toBeNull();
  }, 1_800_000);
});
