// AC5: "The tool-word conversions hold on fixtures: a spot's cone lumens become ours by × 2 ÷ (1 − cos θ_outer),
// radiant watts by × 683, centimetres and Z-up become metres and Y-up, and a word with no mapping is refused with a
// notice, never guessed"
//
// fixtures/tool-words.json's `ac5`: two Unreal spots of 1,000 lm over cones of 60° and 30° (4,000 lm and
// 14,928.2 lm of ours, so a copied 1,000 or a cone read as a full angle misses), a Blender point light of 10 W
// (6,830 lm), and an Unreal point light at (300, −400, 250) cm, which must stand 2.5 m up and 5 m from the vertical
// axis (the criterion fixes the unit and the up axis; README: readings). Each expected value is first recomputed
// here from the criterion's formula with the case's own words, so the fixture can't drift from it. Unreal's
// `SpecularScale`, which no light of ours has, must be refused at `items/ue_specular/params/SpecularScale` with
// nothing drawn.

import { describe, expect, it } from 'vitest';
import { AC, SLOW, arr, fixture, none, obj, toolSection, useDir, useShow, v3, type JsonObject } from './helpers.ts';
import { rad } from './reference.ts';

const bin = useShow();
const dir = useDir();
const AC5 = obj(fixture('tool-words.json')['ac5'], 'tool-words.json: ac5');

/** The criterion's formula for a case, from its own words. */
function formula(c: JsonObject): JsonObject {
  const p = obj(c['params'], `${String(c['id'])}.params`);
  if (c['recipe'] === 'unreal.spot_light@1') return { power: (p['Intensity'] as number) * 2 / (1 - Math.cos(rad(p['OuterConeAngle'] as number))) };
  if (c['recipe'] === 'blender.light@1') return { power: (p['energy'] as number) * 683 };
  const cm = v3(p['Location'], 'Location');
  return { power: p['Intensity'] as number, up: cm[2] / 100, horizontal: Math.hypot(cm[0], cm[1]) / 100 };
}

describe(`${AC[5]} the tool-word conversions hold on fixtures`, () => {
  it(`${AC[5]} cone lumens × 2 ÷ (1 − cos θ_outer), watts × 683, cm and Z-up to m and Y-up hold, and Unreal's SpecularScale is refused with a notice naming it`, () => {
    for (const c of arr(AC5['cases'], 'ac5.cases').map((v) => obj(v, 'ac5 case'))) {
      const want = formula(c);
      const e = obj(c['expect'], `${String(c['id'])}.expect`);
      for (const [k, v] of Object.entries(want)) expect(Math.abs((e[k] as number) - (v as number)), `${String(c['id'])}: the fixture's ${k} is the criterion's formula's`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v as number)));
    }
    none(toolSection(bin(), dir(), AC5, 'Tool-word conversions'), 'the tool-word conversions and the word with no mapping');
  }, SLOW);
});
