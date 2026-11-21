// Criterion 1 (#2338.c7574234): from a fixture doc with three levels of headings, an explicit <a id> before one heading,
// a heading that repeats and a fenced block holding a line that starts with `#`, the script prints the section for a
// heading's anchor (alpha), for the explicit anchor (the-plan) and for the repeated heading's -1 anchor (notes-1), each
// byte-equal to its expected file in fixture/. The planted programs are planted/stops-at-any-heading.mjs and
// planted/fenced-hash-as-heading.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXPECTED, SECTION, SECTION_DOCS, TD, runIn, scratch, sectionProblems } from './helpers.mjs';

const ANCHORS = Object.keys(EXPECTED);
const print = (copy, anchor, planted) => runIn(copy, SECTION, [`${TD}#${anchor}`], { planted });

test('#2338.c7574234 AC1 the script prints the sections for a heading anchor, an explicit <a id> anchor and a repeated heading\'s -1 anchor, each byte-equal to its expected file; planted scripts that stop at a heading of any level or read a fenced # line as a heading fail, naming the anchor', (t) => {
  const copy = scratch(t, SECTION_DOCS);
  const runs = ANCHORS.map((anchor) => print(copy, anchor));
  const problems = runs.flatMap((run, i) => sectionProblems(run, ANCHORS[i]));
  assert.deepEqual(problems, [], `${SECTION} doesn't print each section byte-equal to its expected file:\n${problems.join('\n')}\n\n${runs.map((run) => run.output).join('\n\n')}`);

  // Stops at the next heading of any level: alpha prints without its subsections.
  const anyLevel = print(copy, 'alpha', 'stops-at-any-heading');
  assert.ok(!anyLevel.text.includes('### Alpha one') && anyLevel.text.startsWith('## Alpha'), `the planted script that stops at a heading of any level doesn't print alpha without its subsections, so it shows nothing here:\n${anyLevel.output}`);
  const anyLevelCaught = sectionProblems(anyLevel, 'alpha');
  assert.ok(anyLevelCaught.some((problem) => problem.includes(`${TD}#alpha`)), `this test passes the planted script that stops at a heading of any level, or fails it without naming ${TD}#alpha:\n${anyLevelCaught.join('\n') || 'no problem found'}\n\n${anyLevel.output}`);
  t.diagnostic(`planted stops-at-any-heading.mjs fails: ${anyLevelCaught.join('; ')}`);

  // Reads the fenced `# a shell comment` line as a heading: alpha is cut short inside its fence.
  const fenced = print(copy, 'alpha', 'fenced-hash-as-heading');
  assert.ok(fenced.text.includes('echo alpha') && !fenced.text.includes('# a shell comment'), `the planted script that reads a fenced # line as a heading doesn't cut alpha short at that line, so it shows nothing here:\n${fenced.output}`);
  const fencedCaught = sectionProblems(fenced, 'alpha');
  assert.ok(fencedCaught.some((problem) => problem.includes(`${TD}#alpha`)), `this test passes the planted script that reads a fenced # line as a heading, or fails it without naming ${TD}#alpha:\n${fencedCaught.join('\n') || 'no problem found'}\n\n${fenced.output}`);
  t.diagnostic(`planted fenced-hash-as-heading.mjs fails: ${fencedCaught.join('; ')}`);
});
