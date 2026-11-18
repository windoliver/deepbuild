// #2698 AC3: "A child the fixture starts and keeps is read beside it and summed, and one that has ended is not
// counted twice. A planted reader that reads only the parent fails, naming the child."
//
// fixtures/family.c runs once, read by the reader and by planted/parent-only.mjs over the same span, and
// criteria.mjs's judgeAc3 holds the criterion's assertions against each (README: AC3).
import { test } from 'node:test';
import { collectAc3, judgeAc3 } from './criteria.mjs';
import { failsNaming, planted } from './support.mjs';
import { reader, realReader } from './surface.mjs';

const wrong = await reader(planted('parent-only.mjs'), 'the planted reader that reads only the parent');
// One run of the fixture for both tests. A base with no reader still runs it, for the planted reader alone.
let collected;
const run = (t) => (collected ??= realReader().then((real) => [real, wrong], () => [wrong]).then((readers) => collectAc3(readers, (line) => t.diagnostic(line))));

test('#2698 AC3 a child the fixture starts and keeps is read beside it and summed, and one that has ended is not counted twice', { timeout: 900_000 }, async (t) => {
  const real = await realReader();
  judgeAc3(await run(t), real.name);
});

test('#2698 AC3 a planted reader that reads only the parent fails, naming the child', { timeout: 900_000 }, async (t) => {
  const data = await run(t);
  t.diagnostic(await failsNaming(() => judgeAc3(data, wrong.name), new RegExp(`^AC3: the kept child ${data.done.kept.pid} is not read beside its parent ${data.done.parent.pid}`), wrong.name));
});
