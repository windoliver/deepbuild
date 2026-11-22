// Criterion 1 (#2339.2ae5a05d): the section sits before "What version 0 builds, and what waits" and holds between 8
// and 12 lines, each one sentence of at most 160 characters with at least one link into the design, and the design
// links lane passes on it. A planted section whose fifth line has no link fails, naming the line. A planted line of two
// sentences fails, naming it. README: The surface, and Criteria to tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CANVAS, CANVAS_LINK, CHECKOUT, DESIGN, NEXT_HEADING, designLinks, failed, invariants, length, makeCopy, namesLine, passed, plantConventionsOpening, plantSection, plantedLines, principles, readRepo, runLinksLane, sectionLine, sentenceEnds, writeRepo } from './helpers.mjs';

const ID = '#2339.2ae5a05d';

test(`${ID} AC1 the design's Principles section sits after the opening and before "${NEXT_HEADING}", holds 8 to 12 lines, each one sentence of at most 160 characters with a link into the design, and the design links lane passes on the real docs`, (t) => {
  const design = readFileSync(join(CHECKOUT, DESIGN), 'utf8');
  const section = principles(design);
  assert.ok(section, `${DESIGN} has no level-2 heading "Principles"`);
  assert.deepEqual(section.before.map((h) => h.level), [1], `the Principles section isn't right after the opening: headings before it are ${JSON.stringify(section.before.map((h) => h.title))}`);
  assert.equal(section.after?.title, NEXT_HEADING, `the heading after the Principles section is "${section.after?.title}", not "${NEXT_HEADING}"`);
  assert.ok(section.lines.length >= 8 && section.lines.length <= 12, `the section holds ${section.lines.length} lines, not 8 to 12:\n${section.lines.map((l) => l.raw).join('\n')}`);
  const four = invariants(readFileSync(join(CHECKOUT, 'AGENTS.md'), 'utf8'));
  const problems = section.lines.flatMap((line, i) => [
    length(line.raw) > 160 && `${DESIGN}:${line.number} is ${length(line.raw)} characters, over 160`,
    // The four invariants are held word for word instead (criterion 2); two of them are two sentences in AGENTS.md.
    i >= four.length && sentenceEnds(line.raw) > 1 && `${DESIGN}:${line.number} is ${sentenceEnds(line.raw)} sentences, not one`,
    !designLinks(line.raw).length && `${DESIGN}:${line.number} has no link into the design`,
  ].filter(Boolean));
  assert.deepEqual(problems, [], `the section's lines break the criterion:\n${problems.join('\n')}`);

  const { repo, env } = makeCopy(t);
  const run = runLinksLane(repo, env);
  t.diagnostic(`the design links lane on the real docs:\n${run.output}`);
  assert.ok(passed(run), `the design links lane doesn't pass on the real docs:\n${run.output}`);
});

// A copy with the planted section (and the canvas reference linking it) passes; then the planted fault fails it.
function twinThenFault(t, replace, k) {
  const { repo, env } = makeCopy(t);
  const agents = readRepo(repo, 'AGENTS.md');
  const base = readRepo(repo, DESIGN);
  writeRepo(repo, CANVAS, plantConventionsOpening(readRepo(repo, CANVAS), [CANVAS_LINK]));
  writeRepo(repo, DESIGN, plantSection(base, plantedLines(agents)));
  const twin = runLinksLane(repo, env);
  const planted = plantSection(base, plantedLines(agents, replace));
  writeRepo(repo, DESIGN, planted);
  const run = runLinksLane(repo, env);
  return { twin, run, line: sectionLine(planted, k) };
}

test(`${ID} AC1 a planted section whose fifth line has no link into the design fails the design links lane, naming that line; the same section with the link passes`, (t) => {
  const { twin, run, line } = twinThenFault(t, { 5: 'Agents and plug-ins write data, not code, as `scripts/canvas-lint.mjs` holds.' }, 5);
  assert.ok(passed(twin), `the design links lane doesn't pass the planted section with every line linked, so the planted fault below shows nothing:\n${twin.output}`);
  assert.ok(failed(run), `the design links lane doesn't FAIL a planted section whose fifth line (${DESIGN}:${line.number}) has no link:\n${run.output}`);
  assert.ok(namesLine(run, line), `the design links lane's output names no fifth line (${DESIGN}:${line.number}, "line 5" of Principles, or "${line.text.slice(0, 30)}"):\n${run.output}`);
});

test(`${ID} AC1 a planted line of two sentences fails the design links lane, naming it; the same line as one sentence passes`, (t) => {
  const { twin, run, line } = twinThenFault(t, { 7: 'The same input gives the same bytes. A rerun matches the first run byte for byte ([Decided](#decided), `unit`).' }, 7);
  assert.ok(passed(twin), `the design links lane doesn't pass the planted section of one-sentence lines, so the planted fault below shows nothing:\n${twin.output}`);
  assert.ok(failed(run), `the design links lane doesn't FAIL a planted line of two sentences (${DESIGN}:${line.number}):\n${run.output}`);
  assert.ok(namesLine(run, line), `the design links lane's output names no two-sentence line (${DESIGN}:${line.number}, "line 7" of Principles, or "${line.text.slice(0, 30)}"):\n${run.output}`);
});
