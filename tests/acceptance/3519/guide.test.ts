// AC2 #3519.a0dcc475: "The canvas skill's line names the guide, and `deep_kinds` with `op: read` and that name returns
// every craft check, as #2697's second criterion has it. A planted canvas skill with no line naming the guide fails,
// naming the skill"
//
// asserts: of the names the canvas skill's craft line gives (its code spans, then its words), the first that
// `deep_kinds {op: read, guide: <name>}` on `deep-show run` serves text for is the guide; that guide, every page
// joined, states each of the sixteen craft checks with its description, threshold and fix as #2697's AC2 checks it
// (#2697's helpers and its fixture of the skill before #2697). The planted canvas skill is the checkout's with every
// line where that guide's name stands as a word removed: the same check fails it, naming skills/deepbuild-canvas/SKILL.md.
// Wrong programs: the merge base (its canvas skill has no body line that says "craft"), a line naming no served
// guide, a guide missing a check, and the plant.
import { describe, expect, it } from 'vitest';
import { useCleanup, useShow } from '../2697/helpers.ts';
import { AC, CANVAS, TIMEOUT, failsNaming, guideOf, none, read, withoutGuide } from './helpers.ts';

const bin = useShow();
useCleanup();

describe(`${AC.guide} the canvas skill's craft line names the guide deep_kinds serves`, () => {
  it(`${AC.guide} the canvas skill's line names the guide, and deep_kinds op: read with that name returns every craft check as #2697's AC2 has it`, () => {
    const g = guideOf(bin(), read(CANVAS), CANVAS);
    console.log(`the guide ${CANVAS} names: ${g.name ?? '(none)'}`);
    none(g.failures, `${CANVAS}'s craft line and its guide`);
  }, TIMEOUT);

  it(`${AC.guide} a planted canvas skill with no line naming the guide fails, naming the skill`, () => {
    const real = guideOf(bin(), read(CANVAS), CANVAS);
    expect(real.name, `${CANVAS} names a guide deep_kinds serves, so a plant can drop it: ${real.failures.join('; ')}`).toBeDefined();
    const planted = withoutGuide(read(CANVAS), real.name!);
    failsNaming(guideOf(bin(), planted, CANVAS).failures, [CANVAS], `${CANVAS} with every line naming ${real.name} removed`);
  }, TIMEOUT);
});
