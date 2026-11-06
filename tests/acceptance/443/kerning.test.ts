// AC3 #443.33177d47: "An extruded "AV" in a body font that kerns the pair puts its V at the same offset from its A as
// the shaped run of the flat text "AV" in the same font and size, within 1e-6 m; a planted extrude that adds each
// glyph's own advance instead fails, naming the pair. A 3D title "2025" with no source fails honest numbers, naming
// the item, and passes once marked a name"
//
// asserts: the body font (Inter) kerns A-V: `deep-text shape` at size 1 gives width("AV") ≠ width("A") +
// width("V"). The flat run puts V at width("AV") − width("V") from A. In one `deep-show` run, `extrude@1` of "AV",
// "A" and "V" (align start, size 1 m) are built; the V's offset from the A in the extruded "AV" is read from the
// meshes alone: (left of glyph1 in "AV" − left of the lone "V") − (left of glyph0 in "AV" − left of the lone "A"),
// so each glyph's own side bearing cancels. It equals the flat run's within 1e-6 m (`pairFailures`, naming the pair
// AV); scenario `planted: "extrude_own_advance"` fails it, naming AV. A scene whose `extrude@1` shows "2025" is
// refused with `number_unsourced` naming the item, and presented once the document's honest_numbers input lists
// "2025" among its names.
// Wrong programs: glyphs placed by their own advances (no kerning), a second shaper or an unkerned font; a title's
// string left out of honest numbers, or a mark that doesn't clear it.

import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, KERN_TOLERANCE, SLOW, TEXT, admitted, errors, extrude, failsNaming, flatWidth, geometryCall, geometryOf, inkLeft, issues, namesItem,
  none, refusedWith, runShow, scenario, sceneDoc, show, textOutline, useBuilds, useDir, type ShowPlanted,
} from './helpers.ts';

const bin = useBuilds([FULL, TEXT]);
const dir = useDir();

const start = { align: 'start' };
const PAIR = sceneDoc('AV in depth', {
  av: extrude(textOutline('AV', start)), a: extrude(textOutline('A', start)), v: extrude(textOutline('V', start)),
});

/** The V's offset from the A in the extruded "AV", against the flat run's. The failure names the pair. */
function pairFailures(planted?: ShowPlanted): string[] {
  const flatAV = flatWidth(bin(TEXT), 'AV', 1);
  const flatA = flatWidth(bin(TEXT), 'A', 1);
  const flatV = flatWidth(bin(TEXT), 'V', 1);
  expect(Math.abs(flatAV - (flatA + flatV)), 'the body font kerns A-V: the flat run "AV" is narrower or wider than "A" and "V" apart (README: Readings)').toBeGreaterThan(1e-3);
  const flat = flatAV - flatV;
  const [presented, geometry] = runShow(bin(FULL), scenario(dir(), [DOC.a], [show(DOC.a, PAIR), geometryCall(DOC.a, ['av', 'a', 'v'])], planted));
  admitted(presented!, 'the extruded "AV", "A" and "V"');
  const [av, a, v] = (['av', 'a', 'v'] as const).map((id) => geometryOf(geometry!, id, `the extruded ${id.toUpperCase()}`));
  const offset = (inkLeft(av!, 'glyph1', 'AV') - inkLeft(v!, 'glyph0', 'V')) - (inkLeft(av!, 'glyph0', 'AV') - inkLeft(a!, 'glyph0', 'A'));
  return Math.abs(offset - flat) <= KERN_TOLERANCE ? [] : [`the pair AV: the extruded V sits ${offset} m from its A; the flat run of "AV" at the same font and size puts it ${flat} m (off by ${offset - flat} m)`];
}

describe(`${AC[3]} a title is the shaper's text: kerned, and honest about its numbers`, () => {
  it(`${AC[3]} an extruded "AV" puts its V at the flat run's offset from its A, within 1e-6 m`, () => {
    none(pairFailures(), 'the extruded "AV"');
  }, SLOW);

  it(`${AC[3]} a planted extrude that adds each glyph's own advance instead fails, naming the pair`, () => {
    failsNaming(pairFailures('extrude_own_advance'), ['AV'], 'the extrude that adds each glyph\'s own advance');
  }, SLOW);

  it(`${AC[3]} a 3D title "2025" with no source fails honest numbers, naming the item, and passes once marked a name`, () => {
    const year = sceneDoc('The year in depth', { year: extrude(textOutline('2025')) });
    const named = { ...year, checks: [{ kind: 'honest_numbers', names: ['2025'] }] };
    const [unsourced, marked] = runShow(bin(FULL), scenario(dir(), [DOC.a, DOC.b], [show(DOC.a, year), show(DOC.b, named)]));
    const errs = refusedWith(unsourced!, 'the title "2025" with no source');
    expect(errs.filter((e) => e.code === 'number_unsourced' && namesItem(e, 'year')).length, `honest numbers fails, naming year: ${JSON.stringify(errors(issues(unsourced!, 'the title')).map((e) => e.raw))}`).toBeGreaterThan(0);
    admitted(marked!, 'the title "2025" marked a name');
  }, SLOW);
});
