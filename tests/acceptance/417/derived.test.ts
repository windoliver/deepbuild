// AC7: a role `{mix: [blue, yellow, 0.5]}` resolves to the two roles' OKLab midpoint within 0.001 ΔEOK, and
// `{lighter: blue, by: 0.2}` equals its recorded fixture value within 0.001 ΔEOK.
//
// The clean look with fixtures/derived.json's palette entries and roles added goes to `deep-canvas-render
// look`, which answers (new) `oklab`: each theme's color roles in OKLab as the check resolved them, before any
// 8-bit encoding (an 8-bit color is up to about 0.003 ΔEOK off, too coarse for 0.001). The midpoint is
// computed here from the two palette colors; `lighter` is held to the value recorded in the fixture, which
// this file recomputes from the README's definition (L' = L + by × (1 − L), a and b kept). Wrong programs: a
// mix in sRGB and a lighter that mixes toward white are each more than 0.001 from the right answer, so either
// fails. At the base `roles` takes palette names only and `look` answers no `oklab`.
import { describe, expect, it } from 'vitest';
import {
  RENDER_BIN, arr, deltaE, fixture, hexColor, linearToOklab, num, obj, one, oklabOf, readLook, shippedLook, shown, toLinear, useBinaries,
  type JsonObject, type Lab,
} from './helpers.ts';

useBinaries('deep-canvas-render');
const F = fixture('derived.json');
const PALETTE = obj(F['palette'], 'derived.palette');
const BLUE = hexColor(PALETTE['fixture_blue'], 'fixture_blue');
const YELLOW = hexColor(PALETTE['fixture_yellow'], 'fixture_yellow');
const recorded = (role: string): Lab => arr(obj(F['recorded'], 'recorded')[role], `recorded.${role}`).map((v, i) => num(v, `recorded.${role}[${i}]`)) as Lab;
const fmt = (l: Lab): string => `[${l.map((v) => v.toFixed(6)).join(', ')}]`;

/** The clean look with the fixture's palette entries and roles added. */
function derivedLook(): JsonObject {
  const def = shippedLook('clean').def;
  def['id'] = 'clean-derived';
  Object.assign(obj(def['palette'], 'palette'), PALETTE);
  Object.assign(obj(def['roles'], 'roles'), obj(F['roles'], 'derived.roles'));
  return def;
}

function oklabRoles(answer: JsonObject, theme: string): Record<string, Lab> {
  const map = obj(obj(answer['oklab'], 'look: oklab (each theme\'s color roles in OKLab)')[theme], `oklab.${theme}`);
  return Object.fromEntries(Object.entries(map).map(([role, v]) => [role, arr(v, `oklab.${theme}.${role}`).map((x, i) => num(x, `oklab.${theme}.${role}[${i}]`)) as Lab]));
}

describe('#417 AC7 derived roles resolve at check in OKLab: a mix to the midpoint, lighter to its recorded value, each within 0.001 ΔEOK', () => {
  it('AC7 the fixture records what the README defines: OKLab of the palette colors, their midpoint, and blue lighter by 0.2 as L + 0.2 × (1 − L)', () => {
    const blue = oklabOf(BLUE); const yellow = oklabOf(YELLOW);
    expect(deltaE(blue, recorded('blue')), 'blue').toBeLessThan(1e-9);
    expect(deltaE(yellow, recorded('yellow')), 'yellow').toBeLessThan(1e-9);
    expect(deltaE(blue.map((v, i) => (v + yellow[i]!) / 2) as Lab, recorded('green')), 'the midpoint').toBeLessThan(1e-9);
    expect(deltaE([blue[0] + 0.2 * (1 - blue[0]), blue[1], blue[2]], recorded('sky')), 'lighter by 0.2').toBeLessThan(1e-9);
  });

  it('AC7 the wrong programs miss by more than 0.001: a mix of the sRGB codes, and lighter as a mix toward white', () => {
    const srgbMix = linearToOklab([0, 1, 2].map((i) => toLinear((BLUE[i]! + YELLOW[i]!) / 2 / 255)) as [number, number, number]);
    expect(deltaE(srgbMix, recorded('green')), 'an sRGB mix is off the OKLab midpoint').toBeGreaterThan(0.001);
    const blue = oklabOf(BLUE);
    const towardWhite: Lab = [blue[0] * 0.8 + 0.2, blue[1] * 0.8, blue[2] * 0.8];
    expect(deltaE(towardWhite, recorded('sky')), 'a mix toward white is off the recorded lighter').toBeGreaterThan(0.001);
  });

  it('AC7 look resolves {mix: [blue, yellow, 0.5]} to the OKLab midpoint and {lighter: blue, by: 0.2} to the recorded value, within 0.001 ΔEOK, in both themes', () => {
    const answer = one(RENDER_BIN, ['look'], { look: derivedLook() });
    const look = readLook(answer, 'look with derived roles');
    for (const theme of ['light', 'dark'] as const) {
      const lab = oklabRoles(answer, theme);
      for (const role of ['blue', 'yellow', 'green', 'sky']) expect(lab[role], `${theme}: oklab.${role} is reported: ${shown(answer['oklab'])}`).toBeDefined();
      expect(deltaE(lab['blue']!, oklabOf(BLUE)), `${theme}: blue resolves to its palette color ${fmt(lab['blue']!)}`).toBeLessThan(0.001);
      expect(deltaE(lab['yellow']!, oklabOf(YELLOW)), `${theme}: yellow resolves to its palette color ${fmt(lab['yellow']!)}`).toBeLessThan(0.001);
      const mid = lab['blue']!.map((v, i) => (v + lab['yellow']![i]!) / 2) as Lab;
      expect(deltaE(lab['green']!, mid), `${theme}: green ${fmt(lab['green']!)} is the two roles' OKLab midpoint ${fmt(mid)}`).toBeLessThanOrEqual(0.001);
      expect(deltaE(lab['green']!, recorded('green')), `${theme}: green ${fmt(lab['green']!)} is the recorded midpoint ${fmt(recorded('green'))}`).toBeLessThanOrEqual(0.001);
      expect(deltaE(lab['sky']!, recorded('sky')), `${theme}: sky ${fmt(lab['sky']!)} equals its recorded value ${fmt(recorded('sky'))}`).toBeLessThanOrEqual(0.001);
      // The 8-bit roles agree with the OKLab ones to their own precision.
      for (const role of ['green', 'sky']) expect(deltaE(oklabOf(look.roles[theme][role]!), lab[role]!), `${theme}: the #rrggbb ${role} encodes its OKLab`).toBeLessThan(0.004);
    }
  });
});
