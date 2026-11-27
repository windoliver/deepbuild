// Criterion 1 (#3401.a5f27d7f): on the change `node scripts/doc-ceilings.mjs` prints its one PASS line, and
// scripts/doc-ceilings.json holds Registries and closed lists at its own text's size, under 20,000 bytes. On the merge
// base the script fails, naming docs/canvas-primitives.md#registries-and-closed-lists, its size and its ceiling: the
// merge base's docs and ceilings, in a scratch repository, under the change's own script, so a rule loosened for
// generated text would pass them and fail here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CEILINGS, CEILINGS_SCRIPT, CP, LIMIT, SECTION_KEY, SECTION_UNDER, TD, beforeCommit, failProblems, generatedOf, passProblems, read, runIn, runInCheckout, scratch, show } from './helpers.mjs';

test('#3401.a5f27d7f AC1: on the change doc-ceilings.mjs prints its one PASS line; the merge base\'s docs and ceilings fail under the same script, naming the section, its size and its ceiling', (t) => {
  const run = runInCheckout(CEILINGS_SCRIPT);
  const problems = passProblems(run);
  assert.deepEqual(problems, [], `${CEILINGS_SCRIPT} doesn't pass on this checkout with its one PASS line:\n${problems.join('\n')}\n\n${run.output}`);

  const before = beforeCommit();
  const doc = show(before, CP);
  const ceilings = show(before, CEILINGS);
  const size = generatedOf(doc).section.size;
  const ceiling = JSON.parse(ceilings.toString('utf8'))[SECTION_KEY];
  const base = scratch(t, { [TD]: show(before, TD), [CP]: doc, [CEILINGS]: ceilings });
  const failed = runIn(base, CEILINGS_SCRIPT);
  const missed = failProblems(failed, SECTION_KEY, [size, ceiling]);
  assert.deepEqual(missed, [], `${CEILINGS_SCRIPT} doesn't fail the docs and ceilings of the merge base (${before.slice(0, 9)}), where ${SECTION_KEY} holds ${size} bytes of its own text over its ceiling of ${ceiling}:\n${missed.join('\n')}\n\n${failed.output}`);
});

test('#3401.a5f27d7f AC1: doc-ceilings.json holds Registries and closed lists at its own text\'s size, under 20,000 bytes', () => {
  const { section } = generatedOf(read(CP));
  assert.ok(section, `${CP} has no heading with the anchor #registries-and-closed-lists`);
  const ceiling = JSON.parse(read(CEILINGS).toString('utf8'))[SECTION_KEY];
  assert.equal(ceiling, section.size, `${CEILINGS} holds ${SECTION_KEY} at ${ceiling ?? 'no ceiling'}, and its own text is ${section.size} bytes`);
  assert.ok(section.size < SECTION_UNDER, `${SECTION_KEY} holds ${section.size} bytes of its own text, not under ${SECTION_UNDER}`);
  assert.ok(section.size > LIMIT, `${SECTION_KEY} holds ${section.size} bytes of its own text, at most ${LIMIT}, so the ceilings file can hold no entry for it`);
});
