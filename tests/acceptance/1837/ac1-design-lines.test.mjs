// #1837.78b8f3bb, first part: each item of the issue's Scope has its line in docs/technical-design.md. A planted
// design with one item's lines taken out fails the same check, naming the item (README: How "has its line" is checked).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ITEMS, factLines, missingItems, readDesign, withoutItem } from './helpers.mjs';

for (const { item, facts } of ITEMS) {
  test(`#1837.78b8f3bb each item has its line in docs/technical-design.md: ${item} (${facts.map((f) => f.what).join('; ')})`, () => {
    const design = readDesign();
    const missing = facts.filter((fact) => factLines(design, fact).length === 0).map((f) => f.what);
    assert.deepEqual(missing, [], `docs/technical-design.md has no line for ${item}: ${missing.join('; ')}`);
  });
}

for (const { item } of ITEMS) {
  test(`#1837.78b8f3bb a planted design missing ${item}'s line fails the design-line check, naming ${item}`, () => {
    const design = readDesign();
    const planted = withoutItem(design, item);
    // The plant takes something out, or the check could pass the planted design for a wrong reason.
    assert.ok(planted.split('\n').length < design.split('\n').length, `the planted design for ${item} removed no line`);
    const missing = missingItems(planted);
    assert.ok(missing.some((m) => m.item === item), `the design-line check passed a design with ${item}'s lines taken out; it named ${JSON.stringify(missing)}`);
  });
}
