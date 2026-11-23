// #2697: the craft guide deep_kinds serves is the one scripts/skill.mjs writes from craft.json, so a check added there,
// or a hand edit to the guide, can't leave the installed guide stale.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { generate } from '../../../scripts/skill.mjs';

it('the installed craft guide is the one scripts/skill.mjs generates from craft.json', () => {
  const installed = readFileSync(new URL('../../../crates/deep-show/gallery/craft.md', import.meta.url), 'utf8');
  expect(installed, 'run node scripts/skill.mjs after changing crates/deep-canvas/src/craft.json').toBe(generate().guide);
});
