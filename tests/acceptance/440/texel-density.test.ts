// AC3: "uv0 in metres keeps one texel density across parts of different sizes, within 1% on a fixture"
//
// The parity fixture (parity/geometry/uv0-metres.scene) holds six parts from 0.1 m to 4 m: box-projected slabs
// and an extrusion, a lathe cylinder projected around its axis, and a slab with uv_scale 0.5. On every triangle
// of every part, both singular values of the map from the surface (in metres) to uv0 (reference.ts: uvStretch)
// must equal the part's expected density, 1 ÷ uv_scale UV units per metre, within 1%: one texel density in every
// direction, whatever the part's size.

import { describe, it } from 'vitest';
import { AC, DOC, SLOW, admitted, fixture, geometryCall, meshRow, none, num, obj, runShow, scenario, sceneDoc, show, useDir, useShow, uvOf, type JsonObject } from './helpers.ts';
import { fmt, triAt, uvStretch, type V2, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();
const SCENE = fixture('parity', 'geometry', 'uv0-metres.scene');
const ITEMS = obj(SCENE['items'], 'the fixture\'s items') as Record<string, JsonObject>;
const DENSITY = obj(SCENE['density'], 'the fixture\'s densities');
const REL = num(SCENE['density_rel'], 'density_rel');
const IDS = Object.keys(ITEMS);

describe(`${AC[3]} uv0 in metres across parts of different sizes`, () => {
  it(`${AC[3]} every triangle of every part maps one metre to 1 ÷ uv_scale UV units in every direction, within 1%`, () => {
    const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, sceneDoc('Texel density', ITEMS)), geometryCall(DOC.a, IDS)]));
    admitted(shown!, 'the texel density fixture');
    const problems: string[] = [];
    for (const id of IDS) {
      const g = meshRow(reply!, id, 'the fixture\'s geometry');
      const uv = uvOf(g, 'uv0', 'the fixture');
      const want = num(DENSITY[id], `density.${id}`);
      let off = 0; let worst = 0; let first = '';
      for (let t = 0; 3 * t < g.indices.length; t++) {
        const tri = triAt(g.indices, t);
        const [lo, hi] = uvStretch(tri.map((i) => g.positions[i]!) as [V3, V3, V3], tri.map((i) => uv[i]!) as [V2, V2, V2]);
        const e = Math.max(Math.abs(lo - want), Math.abs(hi - want)) / want;
        if (!(e <= REL)) {
          off++;
          if (e > worst || Number.isNaN(e)) { worst = e; first = `triangle ${t} maps a metre to ${fmt(lo)}–${fmt(hi)} UV units`; }
        }
      }
      if (off) problems.push(`${id}: ${off} of ${g.indices.length / 3} triangles are off its density of ${want} UV units per metre by more than ${REL * 100}% (worst: ${first})`);
    }
    none(problems, 'uv0 in metres');
  }, SLOW);
});
