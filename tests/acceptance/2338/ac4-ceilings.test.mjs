// Criterion 4 (#2338.1a6db6b6): scripts/doc-ceilings.json holds exactly the headings of the two design docs whose own
// text (the bytes from the heading to the next heading of any level) is over 16,384 bytes, each with its size, and the
// lint lane's check passes, printing one line. Planted docs and ceilings, in a scratch repository whose origin/main is
// the planted base: a listed heading grown by 1 KB fails naming its anchor, size and ceiling; a heading new over the
// limit fails naming it; a ceiling raised above the merge base's fails naming it; a heading shrunk with its ceiling
// lowered in the same change passes. The planted program is planted/no-merge-base.mjs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { BASE_CEILINGS, CEILINGS, CEILINGS_SCRIPT, CHECKOUT, TD, ceilingDocs, ceilingsRepo, checkoutDocs, failProblems, lintCommand, oracle, passProblems, runIn, runInCheckout } from './helpers.mjs';

const BIG = `${TD}#big-section`;

test('#2338.1a6db6b6 AC4 on the commit under test the ceilings file holds exactly the headings whose own text is over 16,384 bytes, with their sizes, and the lint lane\'s check passes with one line: the headings read, how many are over, and the largest with its anchor', async () => {
  assert.ok(existsSync(join(CHECKOUT, CEILINGS_SCRIPT)), `${CEILINGS_SCRIPT} does not exist: the check #2338 asks for isn't in this checkout`);
  const command = await lintCommand(CEILINGS_SCRIPT);
  assert.ok(existsSync(join(CHECKOUT, CEILINGS)), `${CEILINGS} does not exist`);
  const listed = JSON.parse(readFileSync(join(CHECKOUT, CEILINGS), 'utf8'));
  const docs = checkoutDocs();
  const want = oracle(docs);
  const wrong = [];
  for (const [key, size] of Object.entries(want.over)) if (listed[key] !== size) wrong.push(`${key}: own text ${size} bytes, ceiling ${listed[key] ?? 'none'}`);
  for (const [key, ceiling] of Object.entries(listed)) if (!(key in want.over)) wrong.push(`${key}: ceiling ${ceiling}, but no heading of the docs with that anchor has own text over 16,384 bytes`);
  assert.deepEqual(wrong, [], `${CEILINGS} doesn't hold exactly the ${Object.keys(want.over).length} headings over the limit with their sizes`);

  const run = runInCheckout(command);
  const problems = passProblems(run, docs);
  assert.deepEqual(problems, [], `the lint lane's ${CEILINGS_SCRIPT} doesn't pass on this checkout with its one line:\n${problems.join('\n')}\n\n${run.output}`);
});

test('#2338.1a6db6b6 AC4 a planted doc adding 1 KB to a listed heading\'s own text fails, naming the anchor, its size and its ceiling; at the merge base the planted docs pass', (t) => {
  const base = ceilingsRepo(t, { docs: ceilingDocs(), ceilings: BASE_CEILINGS });
  const clean = runIn(base, CEILINGS_SCRIPT, []);
  const cleanProblems = passProblems(clean, ceilingDocs());
  assert.deepEqual(cleanProblems, [], `${CEILINGS_SCRIPT} doesn't pass the planted base docs at their ceilings:\n${cleanProblems.join('\n')}\n\n${clean.output}`);

  const grown = ceilingsRepo(t, { docs: ceilingDocs({ bigExtra: 1024 }), ceilings: BASE_CEILINGS });
  const run = runIn(grown, CEILINGS_SCRIPT, []);
  const problems = failProblems(run, BIG, [18_024, 17_000]);
  assert.deepEqual(problems, [], `${CEILINGS_SCRIPT} doesn't fail ${BIG} grown by 1 KB past its ceiling:\n${problems.join('\n')}\n\n${run.output}`);
});

test('#2338.1a6db6b6 AC4 a planted heading new over the limit fails, naming it', (t) => {
  const copy = ceilingsRepo(t, { docs: ceilingDocs({ newBig: true }), ceilings: BASE_CEILINGS });
  const run = runIn(copy, CEILINGS_SCRIPT, []);
  const problems = failProblems(run, `${TD}#new-big-section`, [17_000]);
  assert.deepEqual(problems, [], `${CEILINGS_SCRIPT} doesn't fail a heading new over 16,384 bytes:\n${problems.join('\n')}\n\n${run.output}`);
});

test('#2338.1a6db6b6 AC4 a planted ceiling raised above the merge base\'s fails, naming it; a planted check that never reads the merge base passes it and fails this test', (t) => {
  // The doc grows by 1 KB and the change raises the ceiling to match, so only the merge base's ceiling can catch it.
  const change = { docs: ceilingDocs({ bigExtra: 1024 }), ceilings: { ...BASE_CEILINGS, [BIG]: 18_024 } };
  const copy = ceilingsRepo(t, change);
  const run = runIn(copy, CEILINGS_SCRIPT, []);
  const problems = failProblems(run, BIG, [18_024, 17_000]);
  assert.deepEqual(problems, [], `${CEILINGS_SCRIPT} doesn't fail ${BIG}'s ceiling raised from the merge base's 17,000 to 18,024:\n${problems.join('\n')}\n\n${run.output}`);

  const planted = runIn(copy, CEILINGS_SCRIPT, [], { planted: 'no-merge-base' });
  assert.equal(planted.status, 0, `the planted check that never reads the merge base doesn't pass the raised ceiling, so it shows nothing here:\n${planted.output}`);
  const caught = failProblems(planted, BIG, [18_024, 17_000]);
  assert.ok(caught.length, `this test passes the planted check that never reads the merge base:\n${planted.output}`);
  t.diagnostic(`planted no-merge-base.mjs fails: ${caught.join('; ')}`);
});

test('#2338.1a6db6b6 AC4 a heading whose own text shrank, with its ceiling lowered in the same change, passes', (t) => {
  const docs = ceilingDocs({ shrinkBy: 1024 });
  const copy = ceilingsRepo(t, { docs, ceilings: { ...BASE_CEILINGS, [`${TD}#shrinking-section`]: 16_976 } });
  const run = runIn(copy, CEILINGS_SCRIPT, []);
  const problems = passProblems(run, docs);
  assert.deepEqual(problems, [], `${CEILINGS_SCRIPT} doesn't pass a heading shrunk to 16,976 bytes with its ceiling lowered to match:\n${problems.join('\n')}\n\n${run.output}`);
});
