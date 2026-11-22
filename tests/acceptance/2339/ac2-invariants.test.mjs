// Criterion 2 (#2339.a190c5fb): the four invariants' sentences in the section match AGENTS.md word for word, held by a
// text check that fails when either file is edited alone, naming the invariant. The text check is the design links
// lane's (README: The surface). The edits are made in a scratch copy only; the checkout's AGENTS.md is never touched.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CANVAS, CANVAS_LINK, CHECKOUT, DESIGN, failed, invariants, makeCopy, namesInvariant, passed, plantConventionsOpening, plantSection, plantedLines, principles, readRepo, render, runLinksLane, writeRepo } from './helpers.mjs';

const ID = '#2339.a190c5fb';
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

test(`${ID} AC2 the Principles section opens with AGENTS.md's four invariants, in order, word for word`, () => {
  const four = invariants(readFileSync(join(CHECKOUT, 'AGENTS.md'), 'utf8'));
  assert.equal(four.length, 4, `AGENTS.md doesn't hold four numbered invariants under "The four invariants": ${JSON.stringify(four)}`);
  const section = principles(readFileSync(join(CHECKOUT, DESIGN), 'utf8'));
  assert.ok(section, `${DESIGN} has no level-2 heading "Principles"`);
  const problems = four.flatMap((inv, i) => {
    const line = section.lines[i];
    return !line ? [`the section has no line ${i + 1} for invariant ${i + 1}`]
      : !collapse(line.text).startsWith(collapse(inv.text)) ? [`${DESIGN}:${line.number} doesn't open with invariant ${i + 1} as AGENTS.md:${inv.number} has it:\n  section: ${line.text}\n  AGENTS:  ${inv.text}`] : [];
  });
  assert.deepEqual(problems, [], problems.join('\n'));
});

// A copy with the planted section (its four invariants copied from the copy's AGENTS.md) and the canvas link.
function plantedCopy(t) {
  const copy = makeCopy(t);
  writeRepo(copy.repo, CANVAS, plantConventionsOpening(readRepo(copy.repo, CANVAS), [CANVAS_LINK]));
  copy.base = readRepo(copy.repo, DESIGN);
  copy.agents = readRepo(copy.repo, 'AGENTS.md');
  writeRepo(copy.repo, DESIGN, plantSection(copy.base, plantedLines(copy.agents)));
  return copy;
}

test(`${ID} AC2 an edit to invariant 3 in AGENTS.md alone fails the design links lane, naming invariant 3; the same edit to both files passes`, (t) => {
  const { repo, env, base, agents } = plantedCopy(t);
  const twin = runLinksLane(repo, env);
  assert.ok(passed(twin), `the design links lane doesn't pass the planted section whose invariants match AGENTS.md, so the edit below shows nothing:\n${twin.output}`);

  const before = invariants(agents)[2];
  const edited = agents.replace("Agents can't change checks or decisions.", "Agents can't change checks or verdicts.");
  assert.notEqual(edited, agents, 'the copy\'s AGENTS.md has no "Agents can\'t change checks or decisions." to edit');
  writeRepo(repo, 'AGENTS.md', edited);
  const run = runLinksLane(repo, env);
  assert.ok(failed(run), `the design links lane doesn't FAIL when AGENTS.md's invariant 3 is edited alone:\n${run.output}`);
  assert.ok(namesInvariant(run, { n: 3, line: before.number, text: render(before.raw) }), `the design links lane's output doesn't name invariant 3 ("invariant 3", AGENTS.md:${before.number} or "${before.text.slice(0, 30)}"):\n${run.output}`);

  writeRepo(repo, DESIGN, plantSection(base, plantedLines(edited)));
  const both = runLinksLane(repo, env);
  assert.ok(passed(both), `the design links lane doesn't pass once the section's invariant 3 is edited to match AGENTS.md's, so it doesn't compare the two files:\n${both.output}`);
});

test(`${ID} AC2 an edit to invariant 2 in the design's section alone fails the design links lane, naming invariant 2`, (t) => {
  const { repo, env, base, agents } = plantedCopy(t);
  const twin = runLinksLane(repo, env);
  assert.ok(passed(twin), `the design links lane doesn't pass the planted section whose invariants match AGENTS.md, so the edit below shows nothing:\n${twin.output}`);

  const inv = invariants(agents)[1];
  const lines = plantedLines(agents);
  const changed = lines[1].replace('never `PASS`', 'never a `PASS`');
  assert.notEqual(changed, lines[1], `the copy's invariant 2 has no "never \`PASS\`" to edit: ${lines[1]}`);
  writeRepo(repo, DESIGN, plantSection(base, [lines[0], changed, ...lines.slice(2)]));
  const run = runLinksLane(repo, env);
  assert.ok(failed(run), `the design links lane doesn't FAIL when the section's invariant 2 is edited alone:\n${run.output}`);
  assert.ok(namesInvariant(run, { n: 2, line: inv.number, text: inv.text }), `the design links lane's output doesn't name invariant 2 ("invariant 2", AGENTS.md:${inv.number} or "${inv.text.slice(0, 30)}"):\n${run.output}`);
});
