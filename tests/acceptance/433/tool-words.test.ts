// AC2: "Each tool-word recipe expands with its stated conversion, and a word with no mapping is refused with a
// notice"
//
// Every tool-word recipe this suite names (README: The surface under test: godot@1's mesh instance, omni and spot
// lights; unreal@1's point and spot lights; blender@1's light) is written once in its tool's own words
// (fixtures/tool-words.json, `ac2`), and what it expands to must hold the values its stated conversion gives:
// Godot's YXZ radians through the rotation matrix (the item's world matrix against basis.cpp's ymat · xmat · zmat,
// within 1e-9 per coefficient), lumens kept for Godot's lights, Unreal's candela × 4π, Blender's watts × 683 and
// its spot_size halved into degrees, Z-up to Y-up. Godot's `light_negative`, a word no light of ours can draw, must
// be refused at `items/gd_negative/params/light_negative` with nothing drawn. AC5 holds the conversions the issue
// spells out with its own numbers.

import { describe, it } from 'vitest';
import { AC, SLOW, fixture, none, obj, toolSection, useDir, useShow } from './helpers.ts';

const bin = useShow();
const dir = useDir();
const AC2 = obj(fixture('tool-words.json')['ac2'], 'tool-words.json: ac2');

describe(`${AC[2]} tool-word recipes expand with their stated conversions`, () => {
  it(`${AC[2]} each godot@1, unreal@1 and blender@1 recipe expands with its stated conversion, and Godot's light_negative is refused with a notice naming it`, () => {
    none(toolSection(bin(), dir(), AC2, 'Tool-word recipes'), 'the tool-word recipes and the word with no mapping');
  }, SLOW);
});
