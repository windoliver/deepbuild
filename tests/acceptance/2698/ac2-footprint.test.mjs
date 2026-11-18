// #2698 AC2: "For a fixture that holds 200 MB it has touched, the reader gives a footprint within 5% of 200 MB above
// its start, with half of it compressed by the machine. A planted reader that gives resident memory fails, naming the
// bytes."
//
// fixtures/hold.c runs once, read at its start and again while it holds by the reader and by
// planted/resident-memory.mjs, and criteria.mjs's judgeAc2 holds the criterion's assertions against each. Only the
// machine compresses: a run in which it did not compress half proves nothing and reads INCONCLUSIVE (README: AC2).
import { test } from 'node:test';
import { collectAc2, judgeAc2 } from './criteria.mjs';
import { failsNaming, planted } from './support.mjs';
import { reader, realReader } from './surface.mjs';

const wrong = await reader(planted('resident-memory.mjs'), 'the planted reader that gives resident memory');
// One run of the fixture for both tests. A base with no reader still runs it, for the planted reader alone.
let collected;
const run = (t) => (collected ??= realReader().then((real) => [real, wrong], () => [wrong]).then((readers) => collectAc2(readers, (line) => t.diagnostic(line))));

test('#2698 AC2 the reader gives a footprint within 5% of 200 MB above its start, with half of it compressed by the machine', { timeout: 900_000 }, async (t) => {
  const real = await realReader();
  judgeAc2(await run(t), real.name);
});

test('#2698 AC2 a planted reader that gives resident memory fails, naming the bytes', { timeout: 900_000 }, async (t) => {
  const data = await run(t);
  t.diagnostic(await failsNaming(() => judgeAc2(data, wrong.name), /^AC2: footprint: the planted reader that gives resident memory gives -?\d+ bytes above its start/, wrong.name));
});
