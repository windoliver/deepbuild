// #2339 criterion 1's planted cases, through the design links lane's own commands on a scratch copy: a section whose
// fifth line has no link, and a line of two sentences, each fail the lane naming the line (README: Planted cases).
import assert from 'node:assert/strict';
import test from 'node:test';
import { DESIGN, clean, designLinks, marker, namesLine, ownLines, render, replaceLine, runLane, sentences, shown, unlink } from './helpers.mjs';

test('#2339.2ae5a05d criterion 1: a planted section whose fifth line has no link into the design fails the design links lane, naming the line', (t) => {
  const { repo, issues, section, standIn } = clean(t);
  const fifth = section.lines[4];
  assert.ok(fifth, 'the section has no fifth line');
  const content = unlink(fifth.content);
  assert.equal(designLinks(content).length, 0, `the planted fifth line still links the design: ${content}`);
  replaceLine(repo, DESIGN, fifth.number, marker(fifth) + content);
  const run = runLane(repo, issues);
  const planted = { ...fifth, content };
  assert.notEqual(run.status, 0, `the lane passed a section whose fifth line (${DESIGN}:${fifth.number}${standIn ? ', stand-in section' : ''}) has no link: ${shown(run)}`);
  assert.ok(namesLine(run, planted), `the lane failed without naming the fifth line (${DESIGN}:${fifth.number}, "${render(content).slice(0, 40)}…"): ${shown(run)}`);
});

test('#2339.2ae5a05d criterion 1: a planted line of two sentences fails the design links lane, naming it', (t) => {
  const { repo, issues, section, standIn } = clean(t);
  // The shortest of the section's own lines, so the second sentence keeps it within 160 characters and only the
  // sentence rule can fail it.
  const line = [...ownLines(section)].sort((a, b) => render(a.content).length - render(b.content).length)[0];
  assert.ok(line, 'the section has no line after the four invariants');
  const trimmed = line.content.replace(/\s+$/, '');
  const content = `${trimmed}${trimmed.endsWith('.') ? '' : '.'} This is a second sentence.`;
  assert.equal(sentences(content).length, 2, `the planted line does not read as two sentences: ${content}`);
  assert.ok(render(content).length <= 160, `the planted line is over 160 characters, so it would not test the sentence rule alone: ${content}`);
  replaceLine(repo, DESIGN, line.number, marker(line) + content);
  const run = runLane(repo, issues);
  assert.notEqual(run.status, 0, `the lane passed a line of two sentences (${DESIGN}:${line.number}${standIn ? ', stand-in section' : ''}): ${shown(run)}`);
  assert.ok(namesLine(run, { ...line, content }), `the lane failed without naming the two-sentence line (${DESIGN}:${line.number}): ${shown(run)}`);
});
