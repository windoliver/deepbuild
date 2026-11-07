// #1115: the mechanics that exist only under the owner's answers (a) and (a) to section 10a, unconfirmed when this was
// drafted. Each test says which answer it depends on, by name, and under answer (b) it is dropped (README: The owner's
// two answers). What holds under either answer is tested in skips.test.mjs and notes.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, entry, idOf, laneState, lists, LONG, sandbox, timedPath, tree, unit, vitestFile } from './helpers.mjs';

const FILE = 'tests/fixture-1115/decisions.test.ts';

test('#1115.dbbdd753 [owner answer 1(a)] a skips entry listing an approved BLOCKED-by-design test leaves the lane the state its other tests give, and the summary prints the listed BLOCKED test', LONG, async (t) => {
  const box = sandbox(t);
  const NOTE = 'BLOCKED: no record from the fixture machine';
  const id = idOf(FILE, 'blocked by design');
  const run = await unit(box, tree(box, {
    [FILE]: vitestFile(`test('blocked by design', (ctx) => { ctx.skip('${NOTE} (unblock: make one)'); });`),
  }, { skips: [entry(id, NOTE)] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'PASS', `a listed BLOCKED test changed the lane's state to ${laneState(run.stdout)}\n${all}`);
  assert.ok(lists(run.stdout, id, NOTE), `the summary does not print the listed BLOCKED test\n${all}`);
});

const READING = 'INCONCLUSIVE (reading only): 40 samples on a fixture machine';

test('#1115.67b0561c [owner answer 2(a)] a reading-only skip is listable, keyed on its test id and its full note', LONG, async (t) => {
  const box = sandbox(t);
  const id = idOf(FILE, 'a reading');
  const run = await unit(box, tree(box, { [FILE]: vitestFile(`test('a reading', (ctx) => { ctx.skip('${READING}'); });`) }, { skips: [entry(id, READING)] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'PASS', `a listed reading-only skip changed the lane's state to ${laneState(run.stdout)}\n${all}`);
  assert.ok(lists(run.stdout, id, READING), `the summary does not print the listed reading\n${all}`);
});

test('#1115.67b0561c [owner answer 2(a)] a reading-only entry holding only a prefix of the note does not cover it: the key is the full note', LONG, async (t) => {
  const box = sandbox(t);
  const id = idOf(FILE, 'a reading');
  const run = await unit(box, tree(box, { [FILE]: vitestFile(`test('a reading', (ctx) => { ctx.skip('${READING}'); });`) }, { skips: [entry(id, 'INCONCLUSIVE (reading only)')] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `a prefix covered a reading-only note, leaving the lane's state at ${laneState(run.stdout)}\n${all}`);
});

test('#1115.67b0561c [owner answer 2(a)] a reading-only entry is refused for a file in the timed list', LONG, async (t) => {
  const box = sandbox(t);
  const file = timedPath('ts');
  const id = idOf(file, 'a timed reading');
  const run = await unit(box, tree(box, { [file]: vitestFile(`test('a timed reading', (ctx) => { ctx.skip('${READING}'); });`) }, { skips: [entry(id, READING)] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `an entry covered a reading-only skip of a timed file, leaving the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.ok(lists(run.stdout, id, READING), `no line lists the skip\n${all}`);
});

test('#1115.67b0561c [owner answer 2(a)] a reading-only entry is refused for a test carrying a criterion tag', LONG, async (t) => {
  const box = sandbox(t);
  // Worked out here, so no file carries the tag of an issue.
  const name = `${['#9115', 'abcdef01'].join('.')} a tagged reading`;
  const id = idOf(FILE, name);
  const run = await unit(box, tree(box, { [FILE]: vitestFile(`test('${name}', (ctx) => { ctx.skip('${READING}'); });`) }, { skips: [entry(id, READING)] }));
  const all = dump(run);
  assert.equal(laneState(run.stdout), 'INCONCLUSIVE', `an entry covered a reading-only skip of a tagged test, leaving the lane's state at ${laneState(run.stdout)}\n${all}`);
  assert.ok(lists(run.stdout, id, READING), `no line lists the skip\n${all}`);
});
