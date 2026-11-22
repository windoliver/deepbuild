// Criterion 3 (#2339.b90141c9): each line names at least one check that exists: a file under scripts/, or a lane name
// in the list scripts/lanes.mjs exports. A planted line that names scripts/no-such-check.mjs fails, naming the line and
// the name. A planted line that names no check fails, naming the line. README: The surface (how a check is named).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CANVAS, CANVAS_LINK, CHECKOUT, DESIGN, failed, isFile, laneNames, makeCopy, namedChecks, namesLine, passed, plantConventionsOpening, plantSection, plantedLines, principles, readRepo, runLinksLane, sectionLine, writeRepo } from './helpers.mjs';

const ID = '#2339.b90141c9';

test(`${ID} AC3 each line of the design's Principles section names a check that exists, a file under scripts/ or a lane scripts/lanes.mjs lists in checks, and no script that doesn't`, () => {
  const section = principles(readFileSync(join(CHECKOUT, DESIGN), 'utf8'));
  assert.ok(section, `${DESIGN} has no level-2 heading "Principles"`);
  assert.ok(section.lines.length, 'the Principles section has no lines');
  const lanes = laneNames();
  const problems = section.lines.flatMap((line) => {
    const { scripts, lanes: named } = namedChecks(line.raw, lanes);
    const missing = scripts.filter((path) => !isFile(CHECKOUT, path));
    return [
      ...missing.map((path) => `${DESIGN}:${line.number} names ${path}, which is not a file`),
      !named.length && scripts.length === missing.length && `${DESIGN}:${line.number} names no check that exists: ${line.text}`,
    ].filter(Boolean);
  });
  assert.deepEqual(problems, [], `${problems.join('\n')}\n(lanes in checks: ${JSON.stringify(lanes)})`);
});

function twinThenFault(t, replace, k) {
  const { repo, env } = makeCopy(t);
  const agents = readRepo(repo, 'AGENTS.md');
  const base = readRepo(repo, DESIGN);
  writeRepo(repo, CANVAS, plantConventionsOpening(readRepo(repo, CANVAS), [CANVAS_LINK]));
  writeRepo(repo, DESIGN, plantSection(base, plantedLines(agents)));
  const twin = runLinksLane(repo, env);
  const planted = plantSection(base, plantedLines(agents, replace));
  writeRepo(repo, DESIGN, planted);
  return { twin, run: runLinksLane(repo, env), line: sectionLine(planted, k) };
}

test(`${ID} AC3 a planted line naming scripts/no-such-check.mjs fails the design links lane, one output line naming the line and scripts/no-such-check.mjs; the same line naming scripts/wait-ratchet.mjs passes`, (t) => {
  const { twin, run, line } = twinThenFault(t, { 9: 'Every wait has a budget a test holds ([Decided](#decided), `scripts/no-such-check.mjs`).' }, 9);
  assert.ok(passed(twin), `the design links lane doesn't pass the planted section naming checks that exist, so the planted fault below shows nothing:\n${twin.output}`);
  assert.ok(failed(run), `the design links lane doesn't FAIL a planted line naming scripts/no-such-check.mjs (${DESIGN}:${line.number}):\n${run.output}`);
  assert.ok(namesLine(run, line, 'no-such-check.mjs'), `no output line of the design links lane names both the line (${DESIGN}:${line.number}, "line 9" of Principles, or "${line.text.slice(0, 30)}") and scripts/no-such-check.mjs:\n${run.output}`);
});

test(`${ID} AC3 a planted line naming no check fails the design links lane, naming the line`, (t) => {
  const { twin, run, line } = twinThenFault(t, { 8: 'A test counts only if it fails on a wrong program ([How runs become one of five verdicts](#how-runs-become-one-of-five-verdicts)).' }, 8);
  assert.ok(passed(twin), `the design links lane doesn't pass the planted section naming a check on every line, so the planted fault below shows nothing:\n${twin.output}`);
  assert.ok(failed(run), `the design links lane doesn't FAIL a planted line naming no check (${DESIGN}:${line.number}):\n${run.output}`);
  assert.ok(namesLine(run, line), `the design links lane's output names no line naming no check (${DESIGN}:${line.number}, "line 8" of Principles, or "${line.text.slice(0, 30)}"):\n${run.output}`);
});
