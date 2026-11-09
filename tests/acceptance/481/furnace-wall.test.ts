// AC2 #481.350e172c: A white furnace with subsurface at full weight stays at or under 1 at every angle, and a skin
// sphere before a white wall puts no red on the wall's pixels, where a pass that blurs across parts does.
//
// 1. The white furnace (#422's: helpers.ts FURNACE_SKY, radiance 1 in every direction, no lights), with white
//    materials at subsurface weight 1, each alone, seen from 0.3 m on 320 × 320 px: a 5 cm ball at skin's mean free
//    paths (the default radius) and one at wax's [20, 12, 8] mm, whose pixels hold every angle between the view and
//    the surface from 0° to 90°; and AC1's 1 cm slab, 10 cm square, turned 0°, 45° and 75° from the view. The fixture
//    holds only if its background reads 1 within 1%; then no pixel of the part reads above 1.01 in any channel (pbrt-v4's
//    pass rule as #422 ported it), and the part's mean is at least 0.5, so the bound can't pass on a part left dark.
//    `--planted subsurface_adds_to_diffuse` (a mutant: the spread light added to the full diffuse instead of taking its
//    share) fails the same check, naming `ball_skin`. The criterion names no wrong program here, and the furnace bound
//    alone holds on the base, where the field is unread.
// 2. The skin sphere (helpers.ts: wallDoc; base [0.8, 0.45, 0.35], `subsurface: {weight: 1}`, every other field its
//    default) 1 cm before a white wall, both lit by one π lx sun along the view, drawn with the lobe and without it.
//    On every wall pixel at least 2 px from any other part in both ID targets (where MSAA blends parts), the red the
//    lobe adds, Δ(R − G) between the two linear targets, is at most 0.2% of the wall's mean luminance: the wall is
//    white under white light, so R − G there is the red the skin put on it. At least 2,000 wall pixels within 40 px of
//    the ball are judged. `--planted subsurface_across_parts` (the issue's pass that blurs across parts) draws both
//    frames again and must put red on at least 100 of those pixels.
import { describe, expect, it } from 'vitest';
import {
  AC, FURNACE_SKY, ball, box, camera, draw, failsNaming, insideAt, lum, material, none, requireMetal, sessionDoc, useDir, useGpu, wallDoc,
  furnaceBackground, furnaceOver, type Drawn, type GpuPlanted, type JsonObject, type V3,
} from './helpers.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [320, 320];
const WHITE = { base_color: [1, 1, 1, 1], metallic: 0, roughness: 0.5 };

function furnaceDocs(): { name: string; doc: JsonObject; item: string }[] {
  const one = (name: string, radius: V3 | null, part: (mat: string) => JsonObject): { name: string; doc: JsonObject; item: string } => ({
    name, item: 'part',
    doc: sessionDoc(`furnace-${name}`, SIZE, {
      cam: camera([0, 0, 0.3], [0, 0, 0], 30), sky: FURNACE_SKY,
      [name]: material({ ...WHITE, subsurface: radius ? { weight: 1, radius } : { weight: 1 } }),
      part: part(name),
    }),
  });
  return [
    one('ball_skin', null, (m) => ball(0.05, [0, 0, 0], m)),
    one('ball_wax', [0.02, 0.012, 0.008], (m) => ball(0.05, [0, 0, 0], m)),
    ...[0, 45, 75].map((t) => one(`slab_${String(t).padStart(2, '0')}`, null, (m) => box([0.1, 0.1, 0.01], [0, 0, 0], m, [0, t, 0]))),
  ];
}
function furnace(planted?: GpuPlanted): string[] {
  const docs = furnaceDocs();
  const drawn = draw(bin(), dir(), docs, planted);
  return drawn.flatMap((d, i) => [...furnaceBackground(d), ...furnaceOver(d, docs[i]!.item)]);
}

/** The skin sphere drawn with the lobe and without it; on the wall's pixels away from every other part in both
 * frames, those where the lobe's frame holds more red than the plain one, and how many were judged within 40 px of
 * the ball's disk. */
function wall(planted?: GpuPlanted): { failures: string[]; judged: number; red: number } {
  const [withLobe, without] = draw(bin(), dir(), [{ name: 'skin-before-wall', doc: wallDoc('lobe', true) }, { name: 'plain-before-wall', doc: wallDoc('plain', false) }], planted) as [Drawn, Drawn];
  const { width, height } = withLobe.ids;
  let sum = 0; let n = 0; let bx = 0; let by = 0; let bn = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (without.ids.at(x, y) === 'wall') { sum += lum(without.linear.at(x, y)); n++; }
    if (withLobe.ids.at(x, y) === 'ball') { bx += x; by += y; bn++; }
  }
  expect(bn, 'the ball is drawn').toBeGreaterThan(1000);
  const tol = 0.002 * (sum / Math.max(n, 1));
  const reach = Math.sqrt(bn / Math.PI) + 40;
  let judged = 0; let red = 0; let worst = 0; let at = '';
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!insideAt(withLobe.ids, 'wall', x, y, 2) || !insideAt(without.ids, 'wall', x, y, 2)) continue;
    if (Math.hypot(x - bx / bn, y - by / bn) <= reach) judged++;
    const a = withLobe.linear.at(x, y); const b = without.linear.at(x, y);
    const added = (a[0] - a[1]) - (b[0] - b[1]);
    if (added > tol) { red++; if (added > worst) { worst = added; at = `(${x}, ${y})`; } }
  }
  const failures = red ? [`${withLobe.name}: ${red} wall pixels gain red from the skin, worst ${worst.toFixed(5)} at ${at} (tolerance ${tol.toFixed(5)})`] : [];
  return { failures, judged, red };
}

describe(`${ID} subsurface never reflects more than it receives, and never spreads onto another part`, () => {
  it(`${ID} in the white furnace, white parts at subsurface weight 1 read at or under 1 at every angle; the planted lobe that adds to the diffuse goes over, naming its material`, () => {
    requireMetal();
    const shipped = furnace();
    none(shipped, 'the furnace at subsurface weight 1');
    failsNaming(furnace('subsurface_adds_to_diffuse'), ['ball_skin'], '--planted subsurface_adds_to_diffuse');
  }, 3_600_000);

  it(`${ID} a skin sphere before a white wall puts no red on the wall's pixels; the planted pass that blurs across parts does`, () => {
    requireMetal();
    const shipped = wall();
    console.log(`${ID}: judged ${shipped.judged} wall pixels within 40 px of the ball`);
    expect(shipped.judged, 'wall pixels judged near the ball').toBeGreaterThanOrEqual(2000);
    none(shipped.failures, 'the wall beside the skin sphere');
    const planted = wall('subsurface_across_parts');
    console.log(`${ID}: --planted subsurface_across_parts puts red on ${planted.red} wall pixels`);
    expect(planted.red, '--planted subsurface_across_parts puts red on at least 100 wall pixels').toBeGreaterThanOrEqual(100);
  }, 3_600_000);
});
