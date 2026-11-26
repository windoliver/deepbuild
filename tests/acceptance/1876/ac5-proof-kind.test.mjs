// #1876 criterion 5: the design's Proof check kind names `lake comparator` and Kani, the two runners the proof plug-in's
// spec takes, and a planted copy of the bullet without Kani fails the design links lane, naming the bullet (README:
// Criteria and tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, DESIGN, clean, item, namesLine, read, replaceLine, runLane, shown, unfailed, word } from './helpers.mjs';

const PROOF = '- **Proof.**';
const RUNNERS = [['`lake comparator`', /lake comparator/], ['Kani', word('Kani')]];

test('AC5 #1876.8616fced the Proof check kind names `lake comparator` and Kani, and a planted copy of the bullet without Kani fails the design links lane, naming the bullet', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design.
  const proof = item(read(CHECKOUT, DESIGN), PROOF);
  const unnamed = RUNNERS.filter(([, named]) => !named.test(proof.line)).map(([name]) => name);
  if (unnamed.length) problems.push(`the Proof check kind (${DESIGN}:${proof.number}) doesn't name ${unnamed.join(' or ')}`);
  // The plant: the copy's bullet with every "Kani" taken out, and nothing else changed.
  const own = item(read(copy.repo, DESIGN), PROOF);
  const line = own.line.replace(/\bKani\b/gi, 'a second checker');
  assert.ok(!/kani/i.test(line) && line.startsWith(PROOF), `the planted bullet still names Kani: ${line.slice(0, 300)}`);
  replaceLine(copy.repo, DESIGN, own.number, line);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted copy of the Proof bullet without Kani (${DESIGN}:${own.number})`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesLine(run, { number: own.number, content: line.slice(own.line.length - own.content.length) }, [word('Proof')])) problems.push(`on ${planted}, the lane failed without naming the bullet: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});
