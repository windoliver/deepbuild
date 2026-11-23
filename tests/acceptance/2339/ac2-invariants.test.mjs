// #2339 criterion 2: the section's four invariants are AGENTS.md's word for word, and the design links lane fails when
// either file is edited alone, naming the invariant (README: The invariants).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, invariants, namesInvariant, principles, read, render, replaceLine, runLane, shown, write, clean } from './helpers.mjs';

test('#2339.a190c5fb criterion 2: the section opens with the four invariants, each word for word as AGENTS.md has it', () => {
  const section = principles(read(CHECKOUT, DESIGN));
  assert.ok(section, `${DESIGN} has no heading "Principles"`);
  const inv = invariants(read(CHECKOUT, 'AGENTS.md'));
  assert.equal(inv.length, 4, `AGENTS.md lists ${inv.length} invariants, not four`);
  const problems = inv.filter((i) => !section.lines[i.number - 1] || !render(section.lines[i.number - 1].content).includes(render(i.text)))
    .map((i) => `line ${i.number} of the section does not hold invariant ${i.number} word for word: "${i.text}" vs ${JSON.stringify(section.lines[i.number - 1]?.raw)}`);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('#2339.a190c5fb criterion 2: AGENTS.md edited alone (invariant 2 reworded) fails the design links lane, naming the invariant', (t) => {
  const { repo, issues, section, standIn } = clean(t);
  const agents = read(repo, 'AGENTS.md');
  const before = invariants(agents).find((i) => i.number === 2);
  const edited = agents.replace('Nothing missing or unrun passes.', 'Nothing missing or unrun ever passes.');
  assert.notEqual(edited, agents, 'AGENTS.md has no "Nothing missing or unrun passes." to reword');
  write(repo, 'AGENTS.md', edited);
  const run = runLane(repo, issues);
  assert.notEqual(run.status, 0, `the lane passed with AGENTS.md's invariant 2 reworded and the design${standIn ? ' (stand-in section)' : ''} left as it was: ${shown(run)}`);
  const named = namesInvariant(run, { number: 2, texts: [before.text, invariants(edited).find((i) => i.number === 2).text], lines: [{ doc: 'AGENTS.md', line: before.line }, { doc: DESIGN, line: section.lines[1].number }] });
  assert.ok(named, `the lane failed without naming invariant 2: ${shown(run)}`);
});

test('#2339.a190c5fb criterion 2: the design edited alone (invariant 4 reworded in the section) fails the design links lane, naming the invariant', (t) => {
  const { repo, issues, section, standIn } = clean(t);
  const line = section.lines[3];
  assert.ok(line && line.raw.includes('twice'), `the section's fourth line has no "twice" to reword: ${JSON.stringify(line?.raw)}`);
  replaceLine(repo, DESIGN, line.number, line.raw.replace('twice', 'again'));
  const before = invariants(read(repo, 'AGENTS.md')).find((i) => i.number === 4);
  const run = runLane(repo, issues);
  assert.notEqual(run.status, 0, `the lane passed with the section's invariant 4 reworded (${DESIGN}:${line.number}${standIn ? ', stand-in section' : ''}) and AGENTS.md left as it was: ${shown(run)}`);
  const named = namesInvariant(run, { number: 4, texts: [before.text, line.content, line.content.replace('twice', 'again')], lines: [{ doc: 'AGENTS.md', line: before.line }, { doc: DESIGN, line: line.number }] });
  assert.ok(named, `the lane failed without naming invariant 4: ${shown(run)}`);
});
