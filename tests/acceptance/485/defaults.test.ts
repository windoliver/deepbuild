// AC1 #485.6dd30866: The defaults are today's shading: the castle and house fixtures with core.light@1 and
// core.ambient@1 set on every material give the same pixel hash on one machine as with no response; and a planted
// core.light@1 that drops the Fresnel term changes it and fails, naming the fixture and its first differing pixel.
//
// The fixtures (helpers: `castle`, `houseDoc`): the castle as committed (`packs/examples/castle.json`, in its own look
// with its recipes, at its own 1280 × 800) and #446's house at night (800 × 500, filmic at EV 1.5), its materials plain
// dielectrics. "With core.light@1 and core.ambient@1 set on every material" (`withDefaults`): every `material@1` item
// names the operator `responses`, a `gpu.material@1` that writes nothing else and answers with `light: core.light@1`
// and `ambient: core.ambient@1`. "With no response" is the same fixture without that operator, drawn by this checkout
// and by the merge base (`git merge-base HEAD origin/main`, built apart), which is today's shading. Each frame 0 by
// `view3d` on this Mac; each frame's `pixel_hash` against the others'.
// 1. With the defaults set, each fixture's pixel hash equals its hash with no response, here and at the merge base.
// 2. `--planted light_drops_fresnel` (core.light@1 without its Fresnel term, wherever a part shades by it): the same
//    check fails, a failure naming the fixture and its first differing pixel (row order, from the final targets).
// Wrong programs: the base (no responses: the operator is refused); a default that isn't today's shading, through a
// named response or by default; a Fresnel term dropped.
import { describe, it } from 'vitest';
import {
  AC, HOUSE, REPO, TIMEOUT, baseGpu, castle, drawFirst, failsNaming, hashFailures, houseDoc, none, requireMetal, useDir, useGpu, withDefaults,
  type Frame, type Planted,
} from './helpers.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();

/** Today's castle and house, with no response, drawn once by the merge base. */
let today: { sha: string; castle: Frame; house: Frame } | null = null;
function todays(out: string): NonNullable<typeof today> {
  if (today) return today;
  const b = baseGpu();
  const [c, h] = drawFirst(b.bin, out, [
    castle(b.root, out, false),
    { name: 'the house at the merge base', doc: houseDoc(), look: HOUSE.look, size: HOUSE.size },
  ], ['final']);
  today = { sha: b.sha, castle: c!, house: h! };
  return today;
}

/** The castle and the house with the defaults set, each against itself with no response here and at the merge base. */
function defaultsFailures(out: string, planted?: Planted): string[] {
  const house = houseDoc();
  const [castleNone, castleSet, houseNone, houseSet] = drawFirst(bin(), out, [
    castle(REPO, out, false), castle(REPO, out, true),
    { name: 'the house', doc: house, look: HOUSE.look, size: HOUSE.size },
    { name: 'the house with the default responses', doc: withDefaults(house), look: HOUSE.look, size: HOUSE.size },
  ], ['final'], planted) as [Frame, Frame, Frame, Frame];
  const t = todays(out);
  const set = 'with core.light@1 and core.ambient@1 on every material';
  return [
    ...hashFailures('the castle', castleSet, castleNone, `${set}, against no response`),
    ...hashFailures('the castle', castleSet, t.castle, `${set}, against no response at the merge base ${t.sha.slice(0, 12)}`),
    ...hashFailures('the house', houseSet, houseNone, `${set}, against no response`),
    ...hashFailures('the house', houseSet, t.house, `${set}, against no response at the merge base ${t.sha.slice(0, 12)}`),
  ];
}

describe(`${ID} the default responses are today's shading`, () => {
  it(`${ID} the castle and the house with core.light@1 and core.ambient@1 set on every material give the same pixel hash on this Mac as with no response, here and at the merge base`, () => {
    requireMetal();
    none(defaultsFailures(dir()), 'the castle and the house under the default responses');
  }, TIMEOUT);

  it(`${ID} a planted core.light@1 that drops the Fresnel term (--planted light_drops_fresnel) changes the pixel hash and fails, naming the fixture and its first differing pixel`, () => {
    requireMetal();
    const failures = defaultsFailures(dir(), 'light_drops_fresnel');
    failsNaming(failures, ['first differing pixel is pixel ('], '--planted light_drops_fresnel');
    console.log(`${ID}: --planted light_drops_fresnel fails:\n  ${failures.slice(0, 4).join('\n  ')}`);
  }, TIMEOUT);
});
