// #2339 criterion 3: each line names a check that exists, a file under scripts/ or a lane scripts/lanes.mjs exports;
// a planted line naming scripts/no-such-check.mjs, and one naming no check, fail the design links lane, naming the
// line (README: How a check is named).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, checksNamed, designLinks, escape, laneNames, namesLine, ownLines, principles, read, render, replaceLine, runLane, shown, clean, marker } from './helpers.mjs';

const NO_SUCH = 'scripts/no-such-check.mjs';

test('#2339.b90141c9 criterion 3: each line of the section names at least one check that exists, a file under scripts/ or a lane in scripts/lanes.mjs, and none that does not', () => {
  const section = principles(read(CHECKOUT, DESIGN));
  assert.ok(section, `${DESIGN} has no heading "Principles"`);
  const lanes = laneNames(CHECKOUT);
  const problems = section.lines.flatMap((line) => {
    const { existing, missing } = checksNamed(line.content, CHECKOUT, lanes);
    return [
      ...(existing.length ? [] : [`${DESIGN}:${line.number} names no check: ${line.raw}`]),
      ...missing.map((name) => `${DESIGN}:${line.number} names ${name}, which does not exist`),
    ];
  });
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('#2339.b90141c9 criterion 3: a planted line naming scripts/no-such-check.mjs fails the design links lane, naming the line and the name', (t) => {
  const { repo, issues, section, standIn } = clean(t);
  const lanes = laneNames(repo);
  const line = [...ownLines(section)].sort((a, b) => render(a.content).length - render(b.content).length)[0];
  assert.ok(line, 'the section has no line after the four invariants');
  // The line's own checks swapped for the missing script: each scripts/ path, each code span or link label naming a
  // lane or a scripts file, and each "<lane> lane" in its text. A line whose checks don't swap cleanly is replaced by
  // a planted line of the same marker and design link.
  let content = line.content
    .replace(/(?<![\w-])(?:\.{1,2}\/)*scripts\/[\w./-]*\w/g, NO_SUCH)
    .replace(/(`+)(.+?)\1/g, (whole, tick, code) => {
      const name = code.trim().replace(/\s+lane$/i, '');
      return lanes.some((l) => l.toLowerCase() === name.toLowerCase()) || /^[\w.-]+\.(?:mjs|js|cjs|ts|sh|py)$/.test(name) ? `\`${NO_SUCH}\`` : whole;
    });
  for (const lane of lanes) content = content.replace(new RegExp(`(?<![\\w-])${escape(lane)}(?=["”’]?\\s+lanes?\\b)`, 'gi'), `\`${NO_SUCH}\``);
  const after = checksNamed(content, repo, lanes);
  if (after.existing.length || !after.missing.includes(NO_SUCH) || render(content).length > 160) {
    content = `A planted line held by \`${NO_SUCH}\` links [the rule](${designLinks(line.content)[0].target}).`;
  }
  assert.deepEqual(checksNamed(content, repo, lanes), { existing: [], missing: [NO_SUCH] }, `the planted line names more than the missing script: ${content}`);
  replaceLine(repo, DESIGN, line.number, marker(line) + content);
  const run = runLane(repo, issues);
  assert.notEqual(run.status, 0, `the lane passed a line naming ${NO_SUCH} (${DESIGN}:${line.number}${standIn ? ', stand-in section' : ''}): ${shown(run)}`);
  assert.ok(namesLine(run, { ...line, content }), `the lane failed without naming the line (${DESIGN}:${line.number}): ${shown(run)}`);
  assert.ok(run.lines.some((l) => l.includes('no-such-check.mjs')), `the lane failed without naming ${NO_SUCH}: ${shown(run)}`);
});

test('#2339.b90141c9 criterion 3: a planted line naming no check fails the design links lane, naming the line', (t) => {
  const { repo, issues, section, standIn } = clean(t);
  const lanes = laneNames(repo);
  const line = ownLines(section).at(-1);
  assert.ok(line, 'the section has no line after the four invariants');
  const content = `A planted line that holds nothing links [the rule](${designLinks(line.content)[0].target}).`;
  assert.deepEqual(checksNamed(content, repo, lanes), { existing: [], missing: [] }, `the planted line names a check: ${content}`);
  const word = lanes.find((l) => new RegExp(`(?<![\\w-])${escape(l)}(?![\\w-])`, 'i').test(render(content)));
  assert.equal(word, undefined, `the planted line holds the lane name "${word}" as a word`);
  replaceLine(repo, DESIGN, line.number, marker(line) + content);
  const run = runLane(repo, issues);
  assert.notEqual(run.status, 0, `the lane passed a line naming no check (${DESIGN}:${line.number}${standIn ? ', stand-in section' : ''}): ${shown(run)}`);
  assert.ok(namesLine(run, { ...line, content }), `the lane failed without naming the line (${DESIGN}:${line.number}): ${shown(run)}`);
});
