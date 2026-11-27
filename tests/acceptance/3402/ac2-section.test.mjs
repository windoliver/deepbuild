// Criterion 2 of #3402: the redrafted section test passes on a planted design that holds three more headings with the
// words `hub` and `hosted`, and fails on one whose section lost one of the eight decisions, naming the decision. A
// planted finder that takes the one heading holding those words fails on main's design, naming both headings.
// "Main's design" is the design as the base commit holds it, read through git; the redrafted section test is its whole
// check, sectionCheck, which its test asserts gives no problem on this checkout's design. Planted designs are held in
// memory (README.md, AC2).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DECISIONS, findSection, headings, readDesign, sectionCheck } from '../1352-redraft-3402/helpers.mjs';
import { DESIGN, baseBytes, baseMissing, findByWords, holdsTheWords } from './helpers.mjs';

const SECTION = 'A hub of your own in the cloud, for someone with no computer';
const PLANTED = ['A hosted hub, planted before the section', 'The hub when hosted, planted inside the section', 'Every hosted hub, planted after the section'];
const wordHeadings = (text) => headings(text).found.filter((h) => holdsTheWords(h.text)).map((h) => h.text);

test('#3402.efa6066b a planted finder that takes the one heading holding the words hub and cloud or hosted fails on main\'s design, naming both headings, and the redrafted section test passes on this checkout\'s design planted with three more headings that hold the words hub and hosted', (t) => {
  const missing = baseMissing();
  if (missing) return t.skip(missing);
  // Main's design, as the base commit holds it: the planted finder, through the redraft's own check.
  const onMain = sectionCheck(baseBytes(DESIGN).toString('utf8'), findByWords);
  assert.deepEqual(onMain.problems, [`more than one heading holds "hub" and "cloud" or "hosted": "${SECTION}", "Decided for a hosted hub"`]);
  assert.equal(onMain.heading, null, 'the planted finder found a section though it gave a problem');

  // This checkout's design, with one heading planted before the section (above its anchor lines), one inside it and
  // one after it, at the design's end.
  const design = readDesign(), asIs = sectionCheck(design);
  assert.deepEqual(asIs.problems, []);
  const { lines, found } = headings(design), { section } = findSection(design);
  const heading = found.find((h) => h.slug === section.slug).index;
  let above = heading;
  while (above > 0 && (!lines[above - 1].trim() || /^<a\s[^>]*>\s*(?:<\/a>)?\s*$/i.test(lines[above - 1].trim()))) above -= 1;
  const planted = [
    ...lines.slice(0, above), `### ${PLANTED[0]}`, '', 'Planted.', '',
    ...lines.slice(above, heading + 1), '', `#### ${PLANTED[1]}`,
    ...lines.slice(heading + 1), '', `## ${PLANTED[2]}`, '', 'Planted.', '',
  ].join('\n');
  assert.deepEqual(wordHeadings(planted).filter((h) => PLANTED.includes(h)), PLANTED, 'the planted design does not hold the three planted headings with the words');
  const check = sectionCheck(planted);
  assert.deepEqual(check.problems, []);
  assert.deepEqual({ heading: check.heading, answered: check.answered }, { heading: asIs.heading, answered: DECISIONS.length }, 'on the planted design the section found is not the one anchored, with its eight decisions');
  const byWords = sectionCheck(planted, findByWords).problems;
  assert.ok(byWords.length === 1 && PLANTED.every((h) => byWords[0].includes(`"${h}"`)), `on the planted design the planted finder does not fail naming the planted headings: ${byWords.join('; ')}`);
});

// Each decision's bullet in main's section, by its bold label, with the start of the name the redraft gives it.
// The word floor names seven of the eight when their bullet goes; "The same hub." shares its words with other bullets,
// so dropping it fails the test by the "Not taken" count alone (README.md, AC2).
const BULLETS = [
  ['A hub of your own, not a shared service.', 'a hub of your own, not a shared service'],
  ['Who runs it.', 'who runs it'],
  ['Whose agents and plan.', 'whose agents and plan'],
  ['What leaves your machine.', 'what leaves your machine'],
  ['The browser.', 'the browser'],
  ['Who pays for hosting.', 'who pays for hosting'],
  ['Moving.', 'moving'],
];
const without = (design, label) => design.split('\n').filter((line) => !line.startsWith(`- **${label}**`)).join('\n');
const UNANSWERED = /doesn't answer this decision: ([^(]+?) \(/;

test('#3402.efa6066b the redrafted section test passes on this checkout\'s design, and fails on main\'s design planted without one of the eight decisions, naming the decision', (t) => {
  const missing = baseMissing();
  if (missing) return t.skip(missing);
  assert.deepEqual(sectionCheck(readDesign()).problems, []);
  const main = baseBytes(DESIGN).toString('utf8');
  assert.deepEqual(sectionCheck(main).problems, []);
  for (const [label, decision] of BULLETS) {
    const planted = without(main, label);
    assert.equal(main.split('\n').length - planted.split('\n').length, 1, `main's section has not exactly one bullet "- **${label}**" to drop`);
    const named = sectionCheck(planted).problems.map((problem) => problem.match(UNANSWERED)?.[1]).filter(Boolean);
    assert.deepEqual(named, [decision], `with the bullet "${label}" dropped, the section test does not fail naming that decision alone`);
  }
  const same = sectionCheck(without(main, 'The same hub.'));
  assert.ok(same.problems.length > 0 && same.notTaken === DECISIONS.length - 1, `with the bullet "The same hub." dropped, the section test still passes (${same.notTaken} "Not taken")`);
});
