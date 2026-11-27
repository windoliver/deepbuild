// AC3 #3519.0b8cfc3f: "The line in the canvas skill and the line in the skill are byte-identical, generated from one
// place. A planted generator that words one of them differently fails, naming both"
//
// asserts: skills/deepbuild/SKILL.md and skills/deepbuild-canvas/SKILL.md each hold one craft line (README: Readings
// 1) and the two are the same bytes, both as the checkout holds them and as scripts/skill.mjs's generate() and
// scripts/canvas-skill.mjs's canvasSkill() write them now (the latter from deep-show's own kinds dump). A planted
// generator is either real generator with its craft line worded differently (README: Readings 3): each fails the
// same check, naming both skills.
// Wrong programs: the merge base (the canvas skill has no craft line), two generators that each hold their own copy of
// the words once one drifts (the implementer's twin), and the two plants.
import { describe, it } from 'vitest';
import { useShow } from '../2697/helpers.ts';
import { AC, CANVAS, SKILL, TIMEOUT, failsNaming, generated, lineFailures, none, read, reworded } from './helpers.ts';

const bin = useShow();

describe(`${AC.line} the craft line is the same bytes in both skills`, () => {
  it(`${AC.line} the line in the canvas skill and the line in the skill are byte-identical, on disk and as both generators write them`, async () => {
    none(lineFailures(read(SKILL), read(CANVAS), 'on disk'), 'the two skills on disk');
    const g = await generated(bin());
    none(lineFailures(g.skill, g.canvas, 'as generated'), 'the two generators\' skills');
  }, TIMEOUT);

  it(`${AC.line} a planted generator that words one of the lines differently fails, naming both`, async () => {
    const g = await generated(bin());
    none(lineFailures(g.skill, g.canvas, 'as generated'), 'the two generators\' skills, before the plant');
    failsNaming(lineFailures(g.skill, reworded(g.canvas), 'planted canvas-skill.mjs'), [SKILL, CANVAS], 'a canvas-skill.mjs that words its line differently');
    failsNaming(lineFailures(reworded(g.skill), g.canvas, 'planted skill.mjs'), [SKILL, CANVAS], 'a skill.mjs that words its line differently');
  }, TIMEOUT);
});
