// #2698 AC1: "For a fixture process that spins for 100 ms, sleeps, and wakes 10 times a second for 10 s, the reader
// gives 100 wakeups within 10%, its CPU time within 10%, and instructions equal within 2% over five runs at a load
// above the core count. A planted reader backed by `ps` fails, naming the wakeups."
//
// fixtures/spin-wake.c runs five times, each read by the reader and by planted/ps-backed.mjs over the same span, and
// criteria.mjs's judgeAc1 holds the criterion's assertions against each (README: AC1).
import { test } from 'node:test';
import { collectAc1, judgeAc1 } from './criteria.mjs';
import { failsNaming, planted } from './support.mjs';
import { reader, realReader } from './surface.mjs';

const wrong = await reader(planted('ps-backed.mjs'), 'the planted reader backed by ps');
// One set of five runs for both tests. A base with no reader still runs them, for the planted reader alone.
let collected;
const runs = (t) => (collected ??= realReader().then((real) => [real, wrong], () => [wrong]).then((readers) => collectAc1(readers, (line) => t.diagnostic(line))));

test('#2698 AC1 the reader gives the fixture\'s 100 wakeups within 10%, its CPU time within 10%, and instructions equal within 2% over five runs at a load above the core count', { timeout: 1_800_000 }, async (t) => {
  const real = await realReader();
  judgeAc1(await runs(t), real.name);
});

test('#2698 AC1 a planted reader backed by ps fails, naming the wakeups', { timeout: 1_800_000 }, async (t) => {
  const data = await runs(t);
  t.diagnostic(await failsNaming(() => judgeAc1(data, wrong.name), /^AC1 run \d of 5: wakeups: the planted reader backed by ps gives none \(missing\)/, wrong.name));
});
