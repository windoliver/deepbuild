// #1115: a skip in affected.mjs is unrun, never PASS. Reached by running the real `node scripts/affected.mjs` in a
// scratch tree. A --timed run runs under a build grant, so its timed request is nested and needs no idle machine
// (README: The scratch trees).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, affectedNested, dump, entry, idOf, lists, LONG, nodeFile, sandbox, summary, timedPath, tree, vitestFile } from './helpers.mjs';

const NOTE = 'INCONCLUSIVE: at load 40 this budget is unmeasured; this is not a pass';

test('#1115.0eeb3f9a with --timed, a run in which a vitest budget skips INCONCLUSIVE summarises INCONCLUSIVE, never PASS', LONG, async (t) => {
  const box = sandbox(t);
  const file = timedPath('ts');
  const fixture = tree(box, {
    [file]: vitestFile(`test('the budget that measured', () => { expect(1).toBe(1); });
test('the budget that skipped', (ctx) => { ctx.skip('${NOTE}'); });`),
  });
  const run = await affectedNested(box, fixture, ['--timed', file]);
  const all = dump(run);
  assert.match(summary(run.stdout), /\b1 passed\b/, `the timed file's measured budget did not run\n${all}`);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: /, `a budget skipped INCONCLUSIVE and the summary reads otherwise\n${all}`);
  assert.equal(run.status, 2, all);
  assert.ok(lists(run.stdout, idOf(file, 'the budget that skipped'), NOTE), `no line lists the skipped budget with its note\n${all}`);
});

test('#1115.0eeb3f9a with --timed, a run in which a node --test budget skips INCONCLUSIVE summarises INCONCLUSIVE, never PASS', LONG, async (t) => {
  const box = sandbox(t);
  const file = timedPath('mjs');
  const fixture = tree(box, {
    [file]: nodeFile(`test('the budget that measured', () => { assert.equal(1, 1); });
test('the budget that skipped', (t) => { t.skip('${NOTE}'); });`),
  });
  const run = await affectedNested(box, fixture, ['--timed', file]);
  const all = dump(run);
  assert.match(summary(run.stdout), /\b1 passed\b/, `the timed file's measured budget did not run\n${all}`);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: /, `a budget skipped INCONCLUSIVE and the summary reads otherwise\n${all}`);
  assert.equal(run.status, 2, all);
  assert.ok(lists(run.stdout, idOf(file, 'the budget that skipped'), NOTE), `no line lists the skipped budget with its note\n${all}`);
});

test('#1115.0eeb3f9a with no flag too, an unlisted skip in an untimed file summarises INCONCLUSIVE and is listed', LONG, async (t) => {
  const box = sandbox(t);
  const file = 'tests/fixture-1115/plain.test.ts';
  const fixture = tree(box, { [file]: vitestFile(`test('the plain test', () => { expect(1).toBe(1); });
test('the plain skip', (ctx) => { ctx.skip('INCONCLUSIVE: not read here'); });`) });
  const run = await affected(box, fixture, [file]);
  const all = dump(run);
  assert.match(summary(run.stdout), /^INCONCLUSIVE affected: /, `an unlisted skip and the summary reads otherwise\n${all}`);
  assert.ok(lists(run.stdout, idOf(file, 'the plain skip'), 'INCONCLUSIVE: not read here'), `no line lists the skip with its note\n${all}`);
});

test('#1115.67b0561c in affected.mjs a listed skip leaves the summary PASS and is printed; under a different note it summarises INCONCLUSIVE', LONG, async (t) => {
  const box = sandbox(t);
  const file = 'tests/fixture-1115/gated.test.ts';
  const body = vitestFile("test('the gated test', (ctx) => { ctx.skip('opt-in: a person sets DEEP_1115_FIXTURE=1'); });");
  const id = idOf(file, 'the gated test');
  const listed = await affected(box, tree(box, { [file]: body }, { skips: [entry(id, 'opt-in: a person sets DEEP_1115_FIXTURE=1')], name: 'listed' }), [file]);
  const one = dump(listed);
  assert.match(summary(listed.stdout), /^PASS affected: /, `a listed skip changed the summary\n${one}`);
  assert.equal(listed.status, 0, one);
  assert.ok(lists(listed.stdout, id, 'opt-in: a person sets DEEP_1115_FIXTURE=1'), `the summary does not print the listed skip with its note\n${one}`);
  const other = await affected(box, tree(box, { [file]: body }, { skips: [entry(id, 'opt-in: a person sets DEEP_1115_OTHER=1')], name: 'other' }), [file]);
  const two = dump(other);
  assert.match(summary(other.stdout), /^INCONCLUSIVE affected: /, `an entry with another note covered the skip\n${two}`);
});
