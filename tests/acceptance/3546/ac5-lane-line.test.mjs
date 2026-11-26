// Criterion 5 (#3546.b80552ec): the design links lane prints one line: the issues read, the median, the 90th
// percentile, the largest with its issue, and how many pass the limit; it is a reading and fails nothing. Offline, the
// lane's own commands run in a copy that holds the checkout's docs and folders with a fixture doc beside them, over
// thirteen fixture issues: eleven print a section, four of them past the limit, and #9555 links one section twice. The
// line on main, with the count on the day, is a reading for the pull request (README: Readings). The planted lane is
// planted/lane-per-link.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cachedIssues, fixtureDoc, fixtureHolds, LANE_DOC, LANE_ISSUES, laneCommands, laneProblems, laneReads, LARGEST, n, none, readingLines, runCommands, runIn, scratch, TWICE } from './helpers.mjs';

test('#3546.b80552ec AC5 the design links lane prints one line giving the issues read, the median, the 90th percentile, the largest with its issue and how many pass the limit, and still passes; a planted lane that counts a section linked twice by one issue twice fails, naming the issue', (t) => {
  const copy = scratch(t, { real: true, docs: { [LANE_DOC]: fixtureDoc() } });
  fixtureHolds(copy, LANE_DOC);
  const env = cachedIssues(copy, LANE_ISSUES);
  const want = laneReads(copy, LANE_ISSUES);
  const { links } = laneCommands();
  assert.equal(links.length, 1, `scripts/lanes.mjs lists ${links.length} lanes named for links (not catalogue drift) in \`checks\`, not the one design links lane: ${links.map(({ name }) => name).join(', ') || 'none'}`);
  const [lane] = links;
  const run = runCommands(copy, `the lane "${lane.name}"`, lane.commands, env);
  assert.equal(run.status, 0, `the lane "${lane.name}" doesn't pass ${LANE_ISSUES.length} open issues whose links all land, ${want.over} of them past the limit: the reading fails nothing\n\n${run.output}`);
  const problems = laneProblems(run, want);
  none(problems, `the lane "${lane.name}" doesn't print its one line: ${n(want.read)} issues read, the median ${n(want.median)}, the 90th percentile ${n(want.p90)}, the largest ${n(want.largest)} with #${LARGEST}, and ${n(want.over)} past the limit:\n${problems.join('\n')}\n\n${run.output}`);

  const planted = runIn(copy, null, [], { planted: 'lane-per-link', env });
  const twice = want.rows.find((row) => row.number === TWICE);
  assert.ok(planted.status === 0 && readingLines(planted).some((line) => line.includes(n(twice.perLink)) && line.includes(`#${TWICE}`)), `the planted lane doesn't count #${TWICE}'s section twice, ${n(twice.perLink)} tokens, so it shows nothing here:\n${planted.output}`);
  const caught = laneProblems(planted, want);
  assert.ok(caught.some((problem) => problem.includes(`the line names #${TWICE},`)), `this test passes the planted lane that counts a section once for each link, or fails it without naming the issue, #${TWICE}:\n${caught.join('\n') || 'no problem found'}\n\n${planted.output}`);
  t.diagnostic(`planted lane-per-link.mjs fails: ${caught.join('; ')}`);
});
