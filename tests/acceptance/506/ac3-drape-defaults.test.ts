// AC3: "A projected inset given only its content and size drapes onto its parent, lit when its content holds no data
// and unlit when it does, and a document that shows 9 projected insets in one view is refused, naming them"
//
// The fixture (helpers.ts: lidDoc): a ball 0.8 m in radius (the lid) resting on a floor, a 3 lx sun 50° up and a day
// sky, seen from 4.5 m at 45°. Its child `drape` is an inset with only `size: [4, 4]`, `content` (one rect in the role
// `tint`, far larger than any texture) and `project: {}`: every projection field at its default. With `data` the rect
// carries role `data`. Twins: the lid painted `tint` itself (`painted`) and the lid with no inset (`bare`).
//
// The reference: rays through each pixel's centre and corners against the lid's sphere. A lid pixel is judged where
// all five meet the sphere and its surface there turns at most 50° from up (inside the default fade angle of 75°,
// within the box's unfaded middle). A floor pixel inside the box is one whose five rays miss the sphere and land on the
// floor inside the box, 0.1 m in from its sides, and that the object-ID target shows as floor with its 8 neighbours.
//
// asserts, through `view3d`:
//   - content without data: every judged lid pixel equals the painted lid within 1 code value (lit: the content takes
//     the base color's place in shading); with data: every judged lid pixel reads the `tint` swatch within 1 code value
//     (unlit, after tone mapping); in both, every floor pixel inside the box equals the bare frame within 1 code value
//     (it drapes onto its parent, not onto everything in its box);
//   - a document with 9 projected insets in one view is refused at check, its refusal naming all nine; the same
//     document with 8 draws.
//   - guards: at least 400 judged lid pixels and 400 floor pixels; the painted lid differs from the swatch by more than
//     3 codes on at least 30% of them, so lit and unlit can't be told apart by accident.
// Wrong programs: the base (no projected inset); one that's always lit or always unlit; one that drapes everything in
// its box; one that counts nothing.
import { describe, expect, it } from 'vitest';
import {
  LID, LID_CAM, PATCHES, ROLES, TIMEOUT, ac, codeOff, crowdDoc, drawn, finalOf, frameAt, framesOf, hexRgb, hitSphere, idAround, idsOf, lidDoc, look, none,
  px, rayOf, refusedNaming, requireGpu, rgbText, runGpu, sub, unit, useBins, useDir, view3d, writeJson,
} from './helpers.ts';

const bin = useBins(['deep-gpu']);
const dir = useDir();
const [W, H] = LID_CAM.size;
const offsets: [number, number][] = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]];

describe(`${ac(3)} a projected inset with only content and size, and the count of projected insets in a view`, () => {
  it(`${ac(3)} given only its content and size it drapes onto its parent: lit without data, unlit with data, the floor in its box untouched`, () => {
    requireGpu();
    const out = dir();
    const call = (name: string, ids = false) => view3d({ doc: writeJson(out, name, lidDoc(name as 'lit' | 'data' | 'bare' | 'painted')), look: look(), size: LID_CAM.size, targets: ids ? ['final', 'ids'] : ['final'] });
    const names = ['lit', 'data', 'painted', 'bare'] as const;
    const replies = runGpu(bin('deep-gpu'), out, names.map((n) => call(n, n === 'bare')));
    const frames = names.map((n, i) => frameAt(framesOf(replies[i]!, `the ${n} lid`), 0, `the ${n} lid`));
    const [lit, data, painted, bare] = frames.map((f, i) => finalOf(out, f, `the ${names[i]} lid`));
    const ids = idsOf(out, frames[3]!, 'the bare lid');
    const swatch = hexRgb(ROLES['tint']!);

    const lid: [number, number][] = []; const floor: [number, number][] = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const hits = offsets.map(([dx, dy]) => { const r = rayOf(LID_CAM, x + dx, y + dy); return { r, p: hitSphere(r.o, r.d, LID.centre, LID.radius) }; });
      if (hits.every((h) => h.p)) {
        const n = unit(sub(hits[0]!.p!, LID.centre));
        if (n[1] >= Math.cos((50 * Math.PI) / 180)) lid.push([x, y]);
        continue;
      }
      if (hits.some((h) => h.p)) continue;
      const onFloor = hits.every(({ r }) => {
        if (r.d[1] >= 0) return false;
        const s = -r.o[1] / r.d[1];
        const fx = r.o[0] + s * r.d[0]; const fz = r.o[2] + s * r.d[2];
        return Math.abs(fx) <= 1.9 && Math.abs(fz) <= 1.9;
      });
      if (onFloor && idAround(ids, x, y, 'floor')) floor.push([x, y]);
    }
    expect(lid.length, 'the fixture: at least 400 judged lid pixels').toBeGreaterThanOrEqual(400);
    expect(floor.length, 'the fixture: at least 400 floor pixels inside the box').toBeGreaterThanOrEqual(400);
    const apart = lid.filter(([x, y]) => codeOff(px(painted!, x, y), swatch) > 3).length;
    expect(apart, 'the guard: the painted (lit) lid differs from the unlit swatch by over 3 codes on at least 30% of judged pixels').toBeGreaterThanOrEqual(0.3 * lid.length);

    const failures: string[] = [];
    const compare = (what: string, pixels: [number, number][], got: typeof lit, want: (x: number, y: number) => [number, number, number], against: string): void => {
      const bad = pixels.filter(([x, y]) => codeOff(px(got!, x, y), want(x, y)) > 1);
      if (bad.length) {
        const [x, y] = bad[0]!;
        failures.push(`${what}: ${bad.length} of ${pixels.length} pixels are off ${against} by more than 1 code value; first (${x}, ${y}) reads ${rgbText(px(got!, x, y))}, ${against} ${rgbText(want(x, y))}`);
      }
    };
    compare('content with no data (lit) on the lid', lid, lit, (x, y) => px(painted!, x, y), 'the lid painted in tint');
    compare('content with data (unlit) on the lid', lid, data, () => swatch, 'the tint swatch');
    compare('content with no data: the floor inside the box', floor, lit, (x, y) => px(bare!, x, y), 'the frame with no inset');
    compare('content with data: the floor inside the box', floor, data, (x, y) => px(bare!, x, y), 'the frame with no inset');
    none(failures, 'a projected inset given only its content and size');
  }, TIMEOUT);

  it(`${ac(3)} a document that shows 9 projected insets in one view is refused at check, naming all nine; with 8 it draws`, () => {
    requireGpu();
    const out = dir();
    const [nine, eight] = runGpu(bin('deep-gpu'), out, [9, 8].map((n) => view3d({ doc: writeJson(out, `crowd-${n}`, crowdDoc(n)), look: look(), size: LID_CAM.size })));
    refusedNaming(nine!, PATCHES(9), 'nine projected insets in one view');
    drawn(eight!, 'eight projected insets in one view');
  }, TIMEOUT);
});
