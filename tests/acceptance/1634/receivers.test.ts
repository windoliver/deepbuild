// AC5 #1634.59464d5c: Receivers still hold: among 2,048 fill lamps, a lamp whose receivers are its room's collection
// lights nothing outside that room, at 20 sampled pixels beyond the walls.
//
// The hall (helpers: `hallDoc`): 2,047 lanterns and `keeper`, all fill lamps, in a walled hall on open ground. The
// keeper stands 0.4 m inside the south wall with a 4 m range and `receivers: "hall"`, the collection of the hall's
// floor and walls. Fill lamps cast no shadow, so only its receivers keep its light off the ground beyond the wall.
// The 20 pixels are those of 20 ground points 0.7 to 2.2 m south of the wall's outer face (helpers: `HALL.outside`),
// each inside the keeper's range (1.1 to 40 lx from it by the CPU reference) and outside every lantern's.
// Two documents in one process, on the linear target: the hall, and the same hall with the keeper's `receivers` left
// out. In the first, each of the 20 pixels shows `ground` and reads under 1e-5 in every channel; the hall's floor by
// the keeper reads the keeper's light (0.5 E ÷ π within 2%), so the lamp is on; and the floor at the foot of 20
// lanterns across the hall (helpers: `HALL.sampled`) reads the CPU sum over every lamp in range within 2%, so the
// keeper stands among 2,048 lamps that are lit. In the second, the fixture's own check, each of the 20 pixels beyond
// the wall reads the keeper's light within 2%: the pixels can see a lamp that ignores its receivers.
// Wrong programs: the base (it reads no `fill`, so the 2,048 are key lights and it shades 32: the sampled lanterns'
// pools are dark); a fill light that skips the receiver test in the cluster loop, or tests the wrong bit past the
// 32nd light.
import { describe, expect, it } from 'vitest';
import {
  AC, HALL, PLAIN_LOOK, TIMEOUT, frameAt, framesOf, hallDoc, hallLamps, none, requireMetal, runGpu, useDir, useGpu, view3dCall, within, writeJson, type Frame,
} from './helpers.ts';
import { groundAt, illuminance, illuminanceSum, matteRadiance, project, type V3 } from './reference.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
const UP: V3 = [0, 1, 0];
const pixelOf = (p: V3): [number, number] => { const [x, y] = project(HALL.cam, p); return [Math.floor(x), Math.floor(y)]; };
const fmt = (c: readonly number[]): string => `[${c.map((v) => v.toExponential(3)).join(', ')}]`;

/** The keeper's light at the pixel of `p` on `item`, held within 2% to the CPU reference at the point the pixel's
 * centre ray meets the item's top (at height `p[1]`). */
function lit(f: Frame, item: string, p: V3, what: string): string[] {
  const [x, y] = pixelOf(p);
  if (!within(f.ids!, item, x, y, 1)) return [`${what}: pixel (${x}, ${y}) doesn't show ${item} (it shows ${String(f.ids!.at(x, y))})`];
  const want = matteRadiance(HALL.rho, illuminance(HALL.keeper, groundAt(HALL.cam, x, y, p[1])!, UP));
  const got = f.linear!.at(x, y);
  return got.every((c) => Math.abs(c / want - 1) <= 0.02) ? [] : [`${what}: pixel (${x}, ${y}) on ${item} reads ${fmt(got)} where the keeper gives ${want.toExponential(3)}`];
}

describe(`${ID} a fill lamp kept to its room's collection lights nothing outside it`, () => {
  it(`${ID} among 2,048 fill lamps, the lamp whose receivers are the hall's collection leaves 20 sampled pixels beyond the wall dark and lights the hall's floor, the lanterns lit around it; without its receivers the same pixels read its light`, () => {
    requireMetal();
    const out = dir();
    const call = (name: string, kept: boolean) => view3dCall({ doc: writeJson(out, name, hallDoc(kept)), look: PLAIN_LOOK, size: HALL.size, targets: ['linear', 'ids'] });
    const replies = runGpu(bin(), out, [call('hall-kept', true), call('hall-open', false)]);
    const [kept, open] = replies.map((r, i) => frameAt(framesOf(out, r, HALL.size, i === 0 ? 'the hall' : 'the hall with no receivers'), 0, 'the hall'));
    expect(kept!.linear && kept!.ids && open!.linear && open!.ids, 'both frames hold their linear and object-ID targets').toBeTruthy();
    expect(HALL.outside.length, '20 sampled points beyond the wall').toBe(20);
    const failures: string[] = [];
    for (const p of HALL.outside) {
      const [x, y] = pixelOf(p);
      failures.push(...lit(open!, 'ground', p, 'the fixture, with no receivers on the keeper'));
      if (kept!.ids!.at(x, y) !== 'ground') { failures.push(`pixel (${x}, ${y}) beyond the wall doesn't show the ground (it shows ${String(kept!.ids!.at(x, y))})`); continue; }
      const got = kept!.linear!.at(x, y);
      if (got.some((c) => Math.abs(c) > 1e-5)) failures.push(`pixel (${x}, ${y}), on the ground ${(p[2] - 19.8).toFixed(1)} m beyond the wall, reads ${fmt(got)}: the keeper lights it though the ground isn't in its receivers`);
    }
    failures.push(...lit(kept!, 'hall_floor', HALL.inside, 'the hall\'s floor by the keeper'));
    const lamps = hallLamps();
    for (const k of HALL.sampled) {
      const lantern = lamps[k]!;
      const [x, y] = pixelOf([lantern.pos[0], HALL.floorTop, lantern.pos[2]]);
      if (!within(kept!.ids!, 'hall_floor', x, y, 1)) { failures.push(`pixel (${x}, ${y}) at ${lantern.id}'s foot doesn't show the hall's floor`); continue; }
      const want = matteRadiance(HALL.rho, illuminanceSum(lamps, groundAt(HALL.cam, x, y, HALL.floorTop)!, UP));
      const got = kept!.linear!.at(x, y);
      if (!got.every((c) => Math.abs(c / want - 1) <= 0.02)) failures.push(`pixel (${x}, ${y}) at ${lantern.id}'s foot reads ${fmt(got)} where the lamps in range give ${want.toExponential(3)}: the lantern isn't lit among the 2,048`);
    }
    none(failures, 'the keeper\'s receivers among 2,048 fill lamps');
  }, TIMEOUT);
});
