// #2339 criterion 3, redrafted blind (README.md, beside this file): each line of the section names a check that
// exists, a file under scripts/ or a lane scripts/lanes.mjs lists, and none that doesn't; and on a scratch copy of the
// checkout's whole tree the design links lane fails a planted line that names scripts/no-such-check.mjs, naming the
// line and the name, and one that names no check, naming the line.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { CHECKOUT, DESIGN, NO_SUCH, checksNamed, failed, fifthLine, finding, keptLink, laneWord, lanesOf, namesLine, principles, read, scratch, shown } from './helpers.mjs';

const copy = scratch();
after(() => copy.remove());

test('#2339.b90141c9 criterion 3: each line of the section names at least one check that exists and none that doesn\'t', () => {
  const { lines } = principles(read(CHECKOUT, DESIGN));
  const { names } = lanesOf(CHECKOUT);
  const problems = lines.flatMap((line) => {
    const { existing, missing } = checksNamed(line.content, CHECKOUT, names);
    return [
      ...(existing.length ? [] : [`${DESIGN}:${line.number} names no check that exists, a file under scripts/ or a lane scripts/lanes.mjs lists: ${line.raw}`]),
      ...missing.map((name) => `${DESIGN}:${line.number} names ${name}, which is not a file under scripts/`),
    ];
  });
  assert.ok(!problems.length, problems.join('\n'));
});

test('#2339.b90141c9 criterion 3: a planted line naming scripts/no-such-check.mjs fails the design links lane, naming the line and the name', (t) => {
  const { repo, names } = copy.unplanted(t);
  const line = fifthLine(copy.read(DESIGN));
  // One sentence with a link into the design, as every line has, whose only check is the script that isn't there.
  const content = `A planted sentence points at [its section](${keptLink(line)}) and is held by \`${NO_SUCH}\`.`;
  assert.deepEqual(checksNamed(content, repo, names), { existing: [], missing: [NO_SUCH] }, `the planted line doesn't name ${NO_SUCH} alone, as a script the copy lacks: ${content}`);
  copy.replaceLine(DESIGN, line.number, line.marker + content);
  const run = copy.lane();
  failed(run, `a line naming ${NO_SUCH} (${DESIGN}:${line.number}: ${content})`);
  assert.ok(namesLine(run, { ...line, content }), `the lane failed without naming the line (${DESIGN}:${line.number}, line ${line.ordinal} of the section): ${shown(run)}`);
  assert.ok(finding(run, (l) => l.includes('no-such-check.mjs')), `the lane failed without naming ${NO_SUCH}: ${shown(run)}`);
});

test('#2339.b90141c9 criterion 3: a planted line naming no check fails the design links lane, naming the line', (t) => {
  const { repo, names } = copy.unplanted(t);
  const line = fifthLine(copy.read(DESIGN));
  // One sentence with a link into the design and nothing else: no code, no path, no lane's name among its words.
  const content = `A planted sentence points at [its section](${keptLink(line)}) and is held by nothing.`;
  assert.deepEqual(checksNamed(content, repo, names), { existing: [], missing: [] }, `the planted line names a check: ${content}`);
  assert.equal(laneWord(content, names), undefined, `the planted line holds a lane's name among its words: ${content}`);
  copy.replaceLine(DESIGN, line.number, line.marker + content);
  const run = copy.lane();
  failed(run, `a line naming no check (${DESIGN}:${line.number}: ${content})`);
  assert.ok(namesLine(run, { ...line, content }), `the lane failed without naming the line (${DESIGN}:${line.number}, line ${line.ordinal} of the section): ${shown(run)}`);
});
