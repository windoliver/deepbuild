// #458, criterion 10: rendering relations hold on one machine on linear targets, each with a planted twin that breaks
// it. Six relations, each held by the full lane's `relation` call on a fixture generated in helpers.ts and read again
// here from the targets the call returns (README: The surface under test; The fixtures):
//
//   exposure-doubles          exposure +1 EV doubles every pixel before tone mapping (`exposed`)
//   lights-add                a frame lit by lights A and B equals A's plus B's, bloom off (`linear`)
//   ortho-shift               an orthographic camera moved k = (7, −3) whole pixels in its plane shifts an unlit,
//                             unshadowed frame by k pixels (`linear`)
//   sphere-turn               an isotropic sphere turned 45° about its axis under a light on that axis keeps its
//                             pixels (`linear`)
//   occluder-never-brightens  adding an opaque item never raises any receiver's direct light in the lighting-only
//                             mode (`lighting`)
//   instances-keep-hash       a mesh split into instances of its parts keeps its pixel hash, in every target a pass
//                             can read: color, normal, depth and velocity byte for byte, and the same item at every
//                             pixel of the ID target
//
// Float pixels are held within 2⁻⁹ relative, two steps of a 16-bit float (README: Readings). Wrong programs: the base (no `relation` call), and
// one planted twin per relation, the issue's `light_sum_clamped` among them; each must make the lane's own verdict
// FAIL, naming the relation, and break this file's own reading of the returned targets.

import { describe, expect, it } from 'vitest';
import {
  AC, TIMEOUT, at, brighterThan, callsFor, differing, drew, exposureFixture, f32Of, failsNaming, hashOf, heldOf, instancesFixture,
  laneFailsNaming, lanePasses, lightsFixture, linearProblems, none, obj, occluderFixture, orthoFixture, pngOf, readNamed, requireMetal, runGpu,
  sphereFixture, str, useBuilds, useDir, STEP16,
  type Fixture, type Held, type Planted, type Relation,
} from './helpers.ts';

const bin = useBuilds(['default']);
const dir = useDir();

/** The targets `instances-keep-hash` compares byte for byte and by pixel hash; the ID target is compared by item. */
const INSTANCE_TARGETS = ['color', 'normal', 'depth', 'velocity'] as const;
/** The item each pixel of a side's ID target shows (#378: pick ID r + 2^8 g + 2^16 b + 2^24 a, 0 where nothing draws),
 * through the side's pick table, an instance's `#n` dropped: a mesh and the instances of its parts are one item. */
function itemsOf(out: string, h: Held, side: string, what: string): { width: number; items: string[] } {
  const png = pngOf(out, h, side, 'ids', what);
  const table = obj(obj(h.reply['picks'], `${what}: picks (each side's pick table)`)[side], `${what}: picks.${side}`);
  const items: string[] = [];
  for (let o = 0; o < png.rgba.length; o += 4) {
    const pick = (png.rgba[o]! + png.rgba[o + 1]! * 256 + png.rgba[o + 2]! * 65_536 + png.rgba[o + 3]! * 16_777_216) >>> 0;
    items.push(pick === 0 ? '' : str(table[String(pick)], `${what}: picks.${side}[${pick}]`).replace(/#.*$/, ''));
  }
  return { width: png.width, items };
}

/** Fixture checks on what the lane drew: the frame holds enough of what the relation is about to judge it. */
function fixtureChecks(f: Fixture, h: Held, out: string): void {
  const what = `${f.relation} (fixture)`;
  switch (f.relation) {
    case 'exposure-doubles':
      expect(brighterThan(f32Of(out, h, f, 'base', 'exposed', what), 0.01), `${what}: the base frame is lit over at least 5,000 pixels`).toBeGreaterThanOrEqual(5000);
      break;
    case 'lights-add': {
      const a = f32Of(out, h, f, 'a', 'linear', what); const b = f32Of(out, h, f, 'b', 'linear', what);
      let overlap = 0;
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) if (at(a, x, y, 0) + at(b, x, y, 0) > 1.05 && at(a, x, y, 0) > 0.2 && at(b, x, y, 0) > 0.2) overlap++;
      expect(overlap, `${what}: A and B overlap, their sum past 1.05, on at least 200 pixels`).toBeGreaterThanOrEqual(200);
      break;
    }
    case 'ortho-shift': {
      const base = f32Of(out, h, f, 'base', 'linear', what);
      const share = brighterThan(base, 0.05) / (base.width * base.height);
      expect(share > 0.05 && share < 0.6, `${what}: the shapes cover between 5% and 60% of the frame (${(share * 100).toFixed(1)}%)`).toBe(true);
      expect(differing(base, f32Of(out, h, f, 'moved', 'linear', what)), `${what}: the moved camera's frame differs from the base's on at least 100 pixels`).toBeGreaterThanOrEqual(100);
      break;
    }
    case 'sphere-turn':
      expect(brighterThan(f32Of(out, h, f, 'base', 'linear', what), 0.01), `${what}: the lit sphere covers at least 3,000 pixels`).toBeGreaterThanOrEqual(3000);
      break;
    case 'occluder-never-brightens': {
      const without = f32Of(out, h, f, 'without', 'lighting', what); const withSlab = f32Of(out, h, f, 'with', 'lighting', what);
      let shaded = 0;
      for (let y = 0; y < without.height; y++) for (let x = 0; x < without.width; x++) if (at(without, x, y, 0) > 0.01 && at(withSlab, x, y, 0) < 0.5 * at(without, x, y, 0)) shaded++;
      expect(shaded, `${what}: the slab's shadow halves the direct light on at least 200 pixels`).toBeGreaterThanOrEqual(200);
      break;
    }
    case 'instances-keep-hash':
      expect(brighterThan(f32Of(out, h, f, 'mesh', 'color', what), 0.01), `${what}: the mesh covers at least 1,000 pixels`).toBeGreaterThanOrEqual(1000);
      expect(itemsOf(out, h, 'mesh', what).items.filter((i) => i === 'thing').length, `${what}: the ID target shows the mesh on at least 1,000 pixels`).toBeGreaterThanOrEqual(1000);
      break;
    default:
      throw Error(`${f.relation} isn't one of criterion 10's relations`);
  }
}

/** This file's own reading of a relation from the targets the lane returned; each failure names the relation. */
function problems(f: Fixture, h: Held, out: string): string[] {
  const r = f.relation; const what = `${r} (read here)`;
  switch (r) {
    case 'exposure-doubles': {
      const base = f32Of(out, h, f, 'base', 'exposed', what);
      return linearProblems(r, f32Of(out, h, f, 'up', 'exposed', what), (x, y, c) => 2 * at(base, x, y, c), STEP16);
    }
    case 'lights-add': {
      const a = f32Of(out, h, f, 'a', 'linear', what); const b = f32Of(out, h, f, 'b', 'linear', what);
      return linearProblems(r, f32Of(out, h, f, 'ab', 'linear', what), (x, y, c) => at(a, x, y, c) + at(b, x, y, c), STEP16);
    }
    case 'ortho-shift': {
      // The camera moved k pixels (x right, y down), so what stood at (x + kx, y + ky) now stands at (x, y).
      const base = f32Of(out, h, f, 'base', 'linear', what); const [kx, ky] = f.k!;
      return linearProblems(r, f32Of(out, h, f, 'moved', 'linear', what), (x, y, c) => {
        const sx = x + kx; const sy = y + ky;
        return sx < 0 || sy < 0 || sx >= base.width || sy >= base.height ? null : at(base, sx, sy, c);
      }, STEP16);
    }
    case 'sphere-turn': {
      const base = f32Of(out, h, f, 'base', 'linear', what);
      return linearProblems(r, f32Of(out, h, f, 'turned', 'linear', what), (x, y, c) => at(base, x, y, c), STEP16);
    }
    case 'occluder-never-brightens': {
      // The slab is outside the view, so every pixel shows the same receiver in both frames.
      const without = f32Of(out, h, f, 'without', 'lighting', what); const withSlab = f32Of(out, h, f, 'with', 'lighting', what);
      const p: string[] = [];
      for (let y = 0; y < without.height; y++) for (let x = 0; x < without.width; x++) for (let c = 0; c < 3; c++) {
        const w = at(without, x, y, c); const g = at(withSlab, x, y, c);
        if (!(g <= w + STEP16 * Math.abs(w))) { p.push(`${r}: pixel (${x}, ${y}) channel ${c} reads ${g} with the slab, ${w} without`); break; }
      }
      return p;
    }
    case 'instances-keep-hash': {
      const p: string[] = [];
      const hashes = obj(h.reply['hashes'], `${what}: hashes (each side's pixel hash per target)`);
      for (const t of INSTANCE_TARGETS) {
        const mesh = hashOf(h, 'mesh', t, what); const split = hashOf(h, 'instances', t, what);
        readNamed(out, mesh, 'f32', `${what}: the mesh's ${t} target`); readNamed(out, split, 'f32', `${what}: the instances' ${t} target`);
        const hm = str(obj(hashes['mesh'], `${what}: hashes.mesh`)[t], `${what}: hashes.mesh.${t}`); const hi = str(obj(hashes['instances'], `${what}: hashes.instances`)[t], `${what}: hashes.instances.${t}`);
        expect(hm, `${what}: hashes.mesh.${t} is a 128-bit pixel hash`).toMatch(/^[0-9a-f]{32}$/);
        expect(hm === hi, `${what}: the ${t} target's pixel hashes agree exactly when its bytes do`).toBe(mesh === split);
        if (mesh !== split) p.push(`${r}: the ${t} target differs between the mesh and the instances of its parts`);
      }
      const whole = itemsOf(out, h, 'mesh', what); const split = itemsOf(out, h, 'instances', what);
      const at = whole.items.findIndex((item, i) => item !== split.items[i]);
      if (at >= 0) p.push(`${r}: the ids target shows ${whole.items[at] || 'nothing'} at pixel (${at % whole.width}, ${Math.floor(at / whole.width)}) of the mesh and ${split.items[at] || 'nothing'} there in the instances of its parts`);
      return p;
    }
    default:
      throw Error(`${r} isn't one of criterion 10's relations`);
  }
}

const FIXTURES: Record<string, () => Fixture> = {
  'exposure-doubles': exposureFixture, 'lights-add': lightsFixture, 'ortho-shift': orthoFixture, 'sphere-turn': sphereFixture,
  'occluder-never-brightens': occluderFixture, 'instances-keep-hash': instancesFixture,
};
/** Each relation's planted twin (README: Planted programs); the issue names the second. */
const TWINS: [Relation, Planted][] = [
  ['lights-add', 'light_sum_clamped'],
  ['exposure-doubles', 'exposure_after_tone_map'],
  ['ortho-shift', 'ortho_camera_snaps_to_grid'],
  ['sphere-turn', 'shades_by_local_tangent'],
  ['occluder-never-brightens', 'shadow_brightens'],
  ['instances-keep-hash', 'instances_skip_normal_target'],
];

describe('#458 criterion 10: rendering relations on linear targets', () => {
  it(`${AC[10]}: the six relations hold: exposure +1 EV doubles, A and B add, an orthographic move shifts by k pixels, a turned sphere keeps its pixels, an occluder never brightens, and a mesh split into instances keeps its pixel hash in every target`, () => {
    requireMetal();
    const out = dir();
    const fixtures = Object.values(FIXTURES).map((make) => make());
    const made = fixtures.map((f) => callsFor(out, f));
    const replies = runGpu(bin('default'), out, made.flatMap((m) => [...m.draws, m.relation]));
    let i = 0;
    for (const [n, f] of fixtures.entries()) {
      // Fixture check: the base's view3d draws every side's document.
      for (const side of made[n]!.sides) drew(replies[i++]!, `${f.relation}: view3d of side ${side}`);
      const h = heldOf(replies[i++]!, f, `relation ${f.relation}`);
      fixtureChecks(f, h, out);
      none(problems(f, h, out), `${f.relation} holds on the targets the lane returned`);
      lanePasses(h, `relation ${f.relation}`);
    }
  }, TIMEOUT);

  it(`${AC[10]}: each relation's planted twin breaks it and fails, naming the relation; the planted light loop that clamps the summed light to 1.0 breaks the sum where A and B overlap`, () => {
    requireMetal();
    const out = dir();
    for (const [relation, planted] of TWINS) {
      const f = FIXTURES[relation]!();
      const h = heldOf(runGpu(bin('default'), out, [callsFor(out, f).relation], { planted })[0]!, f, `relation ${relation} under --planted ${planted}`);
      failsNaming(problems(f, h, out), [relation], `--planted ${planted}`);
      laneFailsNaming(h, `--planted ${planted}`);
      if (planted === 'light_sum_clamped') {
        // The sum breaks where A and B overlap: there the planted frame stops at 1.0 while A's plus B's goes past it.
        const a = f32Of(out, h, f, 'a', 'linear', planted); const b = f32Of(out, h, f, 'b', 'linear', planted); const ab = f32Of(out, h, f, 'ab', 'linear', planted);
        let clamped = 0;
        for (let y = 0; y < ab.height; y++) for (let x = 0; x < ab.width; x++) if (at(a, x, y, 0) + at(b, x, y, 0) > 1.05 && at(ab, x, y, 0) <= 1.0 + STEP16) clamped++;
        expect(clamped, `--planted ${planted}: pixels where A's plus B's is past 1.05 and the frame lit by both stops at 1.0`).toBeGreaterThanOrEqual(200);
      }
      if (planted === 'instances_skip_normal_target') {
        expect(hashOf(h, 'mesh', 'color', planted), `--planted ${planted}: the color target keeps its bytes, so only a target beside the frame shows the fault`).toBe(hashOf(h, 'instances', 'color', planted));
        expect(obj(h.first ?? undefined, `--planted ${planted}: first`)['target'], `--planted ${planted}: the lane names the target that differs`).toBe('normal');
      }
    }
  }, TIMEOUT);
});
