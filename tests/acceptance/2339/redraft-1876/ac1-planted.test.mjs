// #2339 criterion 1's planted cases, redrafted blind (README.md, beside this file). On one scratch copy of the
// checkout's whole tree, through the design links lane's own commands: a section whose fifth line has no link, and a
// line of two sentences, each fail the lane, which names the line.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { DESIGN, HELD, checksNamed, failed, fifthLine, keptLink, namesLine, scratch, shown } from './helpers.mjs';

const copy = scratch();
after(() => copy.remove());

test('#2339.2ae5a05d criterion 1: a planted section whose fifth line has no link into the design fails the design links lane, naming the line', (t) => {
  const { repo, names } = copy.unplanted(t);
  const line = fifthLine(copy.read(DESIGN));
  // One sentence of 73 characters that names a check that exists, as every line does, and links nothing.
  const content = `A planted sentence is held by \`${HELD}\` and points at no section.`;
  assert.deepEqual(checksNamed(content, repo, names), { existing: [HELD], missing: [] }, `the planted line doesn't name ${HELD} alone, a file the copy holds, so more than its missing link could fail it: ${content}`);
  copy.replaceLine(DESIGN, line.number, line.marker + content);
  const run = copy.lane();
  failed(run, `a section whose fifth line has no link (${DESIGN}:${line.number}: ${content})`);
  assert.ok(namesLine(run, { ...line, content }), `the lane failed without naming the fifth line (${DESIGN}:${line.number}): ${shown(run)}`);
});

test('#2339.2ae5a05d criterion 1: a planted line of two sentences fails the design links lane, naming it', (t) => {
  const { repo, names } = copy.unplanted(t);
  const line = fifthLine(copy.read(DESIGN));
  // A sentence with a link into the design and a check that exists, as every line has, then a sentence more: 103
  // characters as it reads, so only the second sentence can fail it.
  const content = `A planted sentence points at [its section](${keptLink(line)}) and is held by \`${HELD}\`. This is its second sentence.`;
  assert.deepEqual(checksNamed(content, repo, names), { existing: [HELD], missing: [] }, `the planted line doesn't name ${HELD} alone, a file the copy holds, so more than its second sentence could fail it: ${content}`);
  copy.replaceLine(DESIGN, line.number, line.marker + content);
  const run = copy.lane();
  failed(run, `a line of two sentences (${DESIGN}:${line.number}: ${content})`);
  assert.ok(namesLine(run, { ...line, content }), `the lane failed without naming the line of two sentences (${DESIGN}:${line.number}, line ${line.ordinal} of the section): ${shown(run)}`);
});
