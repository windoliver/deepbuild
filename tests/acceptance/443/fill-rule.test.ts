// AC1 #443.359bd359: "An extruded "OB" in the look's body font, 0.1 m deep, builds two closed shells, the O's with
// V − E + F = 0 and the B's with −2, each counter a hole by the nonzero rule; a vector@1 ring, a circle with a smaller
// one cut out by evenodd, extrudes with V − E + F = 0, and an SVG element with a stroke and no fill is refused, naming
// it. A planted outline reader that ignores the fill rule fills the counters, gives 2 for each shell and fails,
// naming the glyph"
//
// asserts: `extrude@1 {outline: {text: "OB", font: body, size: 1}, depth: 0.1}` is presented and its `geometry`
// row has exactly two closed parts, glyph0 (the O) and glyph1 (the B), each closed on welded positions with
// V − E + F = 0 and −2, the mesh 0.1 m deep (`shellFailures`); the ring (fixtures/ring.svg: two circles wound the
// same way, so only evenodd cuts the hole) extrudes to one closed part with V − E + F = 0; a vector item whose only
// element, `hairline`, has a stroke and no fill is refused, an error naming `hairline`. With scenario `planted:
// "outline_ignores_fill_rule"`, the same "OB" fails `shellFailures`, naming glyph O and glyph B.
// Wrong programs: counters filled (by a reader that ignores the fill rule, or evenodd read as nonzero for the ring);
// glyphs merged into one shell; a stroke taken as an outline.

import { describe, it } from 'vitest';
import {
  AC, DOC, FULL, HAIRLINE_SVG, RING_SVG, SLOW, admitted, extrude, failsNaming, geometryCall, geometryOf, mentions, none, putBytes, refusedWith,
  runShow, scenario, sceneDoc, shellFailures, show, textOutline, useBuilds, useDir, vectorItem, type ShowPlanted,
} from './helpers.ts';

const bin = useBuilds([FULL]);
const dir = useDir();

const OB = sceneDoc('OB in depth', { title: extrude(textOutline('OB')) });
const OB_SHELLS = { glyph0: { label: 'glyph O', chi: 0 }, glyph1: { label: 'glyph B', chi: -2 } };

/** The extruded "OB" built in one run (with `planted`, the wrong program's), its shells' failures. */
function obFailures(planted?: ShowPlanted): string[] {
  const [presented, geometry] = runShow(bin(FULL), scenario(dir(), [DOC.a], [show(DOC.a, OB), geometryCall(DOC.a, ['title'])], planted));
  admitted(presented!, 'the extruded "OB"');
  return shellFailures(geometryOf(geometry!, 'title', 'the extruded "OB"'), OB_SHELLS);
}

describe(`${AC[1]} counters are holes by the fill rule, strokes are refused`, () => {
  it(`${AC[1]} an extruded "OB" in the body font, 0.1 m deep, builds two closed shells, the O's with V − E + F = 0 and the B's with −2`, () => {
    none(obFailures(), 'the extruded "OB"');
  }, SLOW);

  it(`${AC[1]} a vector@1 ring cut out by evenodd extrudes with V − E + F = 0, and an SVG element with a stroke and no fill is refused, naming it`, () => {
    const ring = putBytes(dir(), RING_SVG());
    const hairline = putBytes(dir(), HAIRLINE_SVG());
    const ringDoc = sceneDoc('A ring in depth', { logo: vectorItem(ring, 'A ring'), ring3d: extrude({ vector: 'logo', size: 1 }) }, ['vector']);
    const strokeDoc = sceneDoc('A stroke in depth', { mark: vectorItem(hairline, 'A triangle drawn as a line'), mark3d: extrude({ vector: 'mark', size: 1 }) }, ['vector']);
    const [presented, geometry, stroked] = runShow(bin(FULL), scenario(dir(), [DOC.a, DOC.b], [show(DOC.a, ringDoc), geometryCall(DOC.a, ['ring3d']), show(DOC.b, strokeDoc)]));
    admitted(presented!, 'the extruded ring');
    // One closed shell, whatever its part's name (README: a vector's parts are named by the implementer).
    const g = geometryOf(geometry!, 'ring3d', 'the extruded ring');
    none(shellFailures(g, { [g.closed[0]?.name ?? '(none)']: { label: 'the ring', chi: 0 } }), 'the extruded ring');
    const errs = refusedWith(stroked!, 'the extruded stroke-only element');
    none(errs.some((e) => mentions(e.raw, 'hairline')) ? [] : [`no error names the stroke-only element hairline: ${errs.map((e) => JSON.stringify(e.raw)).join('; ')}`], 'the stroke-only element\'s refusal');
  }, SLOW);

  it(`${AC[1]} a planted outline reader that ignores the fill rule fills the counters, gives 2 for each shell and fails, naming the glyph`, () => {
    failsNaming(obFailures('outline_ignores_fill_rule'), ['glyph O', 'glyph B'], 'the outline reader that ignores the fill rule');
  }, SLOW);
});
