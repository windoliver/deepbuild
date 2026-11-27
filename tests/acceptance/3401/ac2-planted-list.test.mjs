// Criterion 2 (#3401.e49d42a4): a planted field list with a row of 300 bytes is added to a scratch copy's fill, and
// `canvas-closures.mjs table` is run there. doc-ceilings.mjs still passes, and the text under exactly one generated
// heading differs. A planted `table` that writes one table under one heading fails the ceilings on that copy, naming
// the heading: planted on the output, by taking the heading lines between the generated tables out of the copy's
// reference, under the first generated heading and under the section's own.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CEILINGS, CEILINGS_SCRIPT, CLOSURES_SCRIPT, CP, PLANT, SECTION_KEY, failProblems, generatedOf, headingChanges, passProblems, plantInFill, readIn, runIn, scratch, withoutHeadingLines, writeIn, writeListing } from './helpers.mjs';

const named = (headings) => headings.map((heading) => `#${heading.id}`).join(', ') || 'none';

test('#3401.e49d42a4 AC2: with a planted field list of a 300-byte row in a scratch copy\'s fill, `table` run there leaves doc-ceilings.mjs passing and the text under exactly one generated heading different; one table under one heading fails the ceilings, naming the heading', (t) => {
  const copy = scratch(t);
  const clean = runIn(copy, CEILINGS_SCRIPT);
  const cleanProblems = passProblems(clean);
  assert.deepEqual(cleanProblems, [], `${CEILINGS_SCRIPT} doesn't pass in a scratch copy of this checkout before anything is planted:\n${cleanProblems.join('\n')}\n\n${clean.output}`);

  // The tables as `table` writes them from the copy's own lists, then with the planted list.
  const unplanted = runIn(copy, CLOSURES_SCRIPT, ['table', '--listing', writeListing(copy)]);
  assert.equal(unplanted.status, 0, `\`table\` doesn't write the copy's own field lists:\n${unplanted.output}`);
  const before = generatedOf(readIn(copy, CP));
  assert.ok(before.headings.length >= 2, `\`table\` wrote the field lists under ${before.headings.length} generated headings (${named(before.headings)}), not several`);

  assert.equal(Buffer.byteLength(PLANT.row), 300, 'the planted row is 300 bytes');
  plantInFill(copy);
  const planted = runIn(copy, CLOSURES_SCRIPT, ['table', '--listing', writeListing(copy, [PLANT])]);
  assert.equal(planted.status, 0, `\`table\` doesn't write the field lists with the planted ${PLANT.list}:\n${planted.output}`);
  const doc = readIn(copy, CP);
  const after = generatedOf(doc);

  const ceilings = runIn(copy, CEILINGS_SCRIPT);
  const problems = passProblems(ceilings);
  assert.deepEqual(problems, [], `${CEILINGS_SCRIPT} doesn't still pass once \`table\` has written the planted ${PLANT.list}:\n${problems.join('\n')}\n\n${ceilings.output}`);

  const { differ, gone } = headingChanges(before.headings, after.headings);
  assert.equal(differ.length, 1, `the text under ${differ.length} generated headings differs with the planted list (${named(differ)}), not under exactly one`);
  assert.ok(gone.length <= 1, `${gone.length} generated headings lost their text to the planted list (${named(gone)}): one list changes one heading`);
  assert.deepEqual(differ[0].rows.filter((row) => row.list === PLANT.list).map((row) => row.line), [PLANT.row], `#${differ[0].id} doesn't hold the planted list's 300-byte row as \`table\` writes a closed list's`);
  assert.equal(after.section.text, before.section.text, 'the section\'s own text changed with the planted list');

  // A `table` that writes one table under one heading, a generated one: every heading line after the first is gone.
  writeIn(copy, CP, withoutHeadingLines(doc, after.headings.slice(1)));
  const [single, ...others] = generatedOf(readIn(copy, CP)).headings;
  assert.deepEqual(others, [], 'the planted one-table reference holds its rows under one generated heading');
  const underOne = runIn(copy, CEILINGS_SCRIPT);
  const underOneProblems = failProblems(underOne, single.key, [single.size]);
  assert.deepEqual(underOneProblems, [], `${CEILINGS_SCRIPT} doesn't fail one table of ${single.rows.length} rows under ${single.key}, ${single.size} bytes:\n${underOneProblems.join('\n')}\n\n${underOne.output}`);
  t.diagnostic(`one table under one generated heading fails: ${underOne.lines.find((line) => line.startsWith('FAIL'))}`);

  // The same under the section's own heading, as the merge base writes it.
  writeIn(copy, CP, withoutHeadingLines(doc, after.headings));
  const whole = generatedOf(readIn(copy, CP)).section;
  const ceiling = JSON.parse(readIn(copy, CEILINGS).toString('utf8'))[SECTION_KEY];
  const underSection = runIn(copy, CEILINGS_SCRIPT);
  const underSectionProblems = failProblems(underSection, SECTION_KEY, [whole.size, ceiling]);
  assert.deepEqual(underSectionProblems, [], `${CEILINGS_SCRIPT} doesn't fail one table under the section's own heading, ${whole.size} bytes over its ceiling of ${ceiling}:\n${underSectionProblems.join('\n')}\n\n${underSection.output}`);
  t.diagnostic(`one table under the section's heading fails: ${underSection.lines.find((line) => line.startsWith('FAIL'))}`);
});
