// #2339 criterion 2, redrafted blind (README.md, beside this file): the section opens with AGENTS.md's four
// invariants word for word, and on a scratch copy of the checkout's whole tree the design links lane fails when
// either file is edited alone, naming the invariant.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { AGENTS, CHECKOUT, DESIGN, failed, invariants, namesInvariant, principles, read, render, scratch, shown, withoutSecondWord } from './helpers.mjs';

const copy = scratch();
after(() => copy.remove());

test('#2339.a190c5fb criterion 2: the section opens with the four invariants, each word for word as AGENTS.md has it', () => {
  const { lines } = principles(read(CHECKOUT, DESIGN));
  const problems = invariants(read(CHECKOUT, AGENTS)).flatMap((invariant) => {
    const line = lines[invariant.number - 1];
    if (line && render(line.content).includes(render(invariant.text))) return [];
    return [`line ${invariant.number} of the section (${line ? `${DESIGN}:${line.number}` : 'there is none'}) doesn't hold invariant ${invariant.number} word for word: ${AGENTS}:${invariant.line} words it ${JSON.stringify(invariant.text)}, the section's line reads ${JSON.stringify(line?.content ?? null)}`];
  });
  assert.ok(!problems.length, problems.join('\n'));
});

test('#2339.a190c5fb criterion 2: AGENTS.md edited alone fails the design links lane, naming the invariant', (t) => {
  copy.unplanted(t);
  const agents = copy.read(AGENTS);
  const invariant = invariants(agents)[1];
  const line = principles(copy.read(DESIGN)).lines[1];
  assert.ok(line, `the Principles section of ${DESIGN} has no second line for invariant 2`);
  // One word of invariant 2 goes from AGENTS.md; the design keeps every word.
  const { edited, word } = withoutSecondWord(agents.split('\n')[invariant.line - 1], invariant.text);
  copy.replaceLine(AGENTS, invariant.line, edited);
  const reworded = invariants(copy.read(AGENTS))[1];
  assert.notEqual(render(reworded.text), render(invariant.text), `the edit left invariant 2 of ${AGENTS} as it was: ${reworded.text}`);
  const run = copy.lane();
  failed(run, `${AGENTS} with one word ("${word}") taken out of invariant 2 (${AGENTS}:${invariant.line}) and the design left as it was`);
  const named = namesInvariant(run, { number: 2, texts: [invariant.text, reworded.text], places: [{ file: AGENTS, line: invariant.line }, { file: DESIGN, line: line.number }] });
  assert.ok(named, `the lane failed without naming invariant 2 (${AGENTS}:${invariant.line}, ${DESIGN}:${line.number}): ${shown(run)}`);
});

test('#2339.a190c5fb criterion 2: the design edited alone fails the design links lane, naming the invariant', (t) => {
  copy.unplanted(t);
  const invariant = invariants(copy.read(AGENTS))[3];
  const line = principles(copy.read(DESIGN)).lines[3];
  assert.ok(line, `the Principles section of ${DESIGN} has no fourth line for invariant 4`);
  // One word of invariant 4 goes from the section's fourth line, which so gets shorter and keeps its sentences, its
  // link and its check; AGENTS.md keeps every word.
  const { edited, word } = withoutSecondWord(line.content, invariant.text);
  copy.replaceLine(DESIGN, line.number, line.marker + edited);
  const run = copy.lane();
  failed(run, `the section with one word ("${word}") taken out of invariant 4 (${DESIGN}:${line.number}) and ${AGENTS} left as it was`);
  const named = namesInvariant(run, { number: 4, texts: [invariant.text, withoutSecondWord(invariant.text, invariant.text).edited], places: [{ file: AGENTS, line: invariant.line }, { file: DESIGN, line: line.number }] });
  assert.ok(named, `the lane failed without naming invariant 4 (${AGENTS}:${invariant.line}, ${DESIGN}:${line.number}): ${shown(run)}`);
});
