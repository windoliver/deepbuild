import test from 'node:test';
import { AC, blocked, brief, must } from './common.mjs';
import { WRITES_AND_ENDS, firstItemNamed, itemsNotAsAlone, readItems, whyReadingCannotJudge } from './items.mjs';
import { openLogic } from './logic.mjs';

const RUNNER_THAT_SHARES_ONE_INSTANCE = 'items_share_instance';

test(`AC3 ${AC[3]} two items of the same bytes in one piece keep their own memory, globals, fuel and trap, and a planted runner that shares one instance fails, naming the item`, { timeout: 10 * 60_000 }, async (t) => {
  const logic = openLogic();
  let read;
  try {
    read = await readItems(logic);
  } finally {
    await logic.close();
  }
  const whyNot = whyReadingCannotJudge(read);
  if (whyNot) throw blocked(`this suite's piece of two items of one program doesn't run as its program says, so nothing of one item is there to show in the other: ${whyNot}`);
  const problems = itemsNotAsAlone(read);
  must(problems.length === 0, `AC3 ${AC[3]}: an item of the same bytes as another in its piece isn't what it is alone (a writes at step ${WRITES_AND_ENDS.a.wrote} and runs out of fuel at step ${WRITES_AND_ENDS.a.at}; b writes at step ${WRITES_AND_ENDS.b.wrote} and traps at step ${WRITES_AND_ENDS.b.at}):\n  ${problems.join('\n  ')}`);
  t.diagnostic(`a and b, of rewritten program ${read.pair.a.program}, are each what they are alone: a's traps ${brief(read.pair.a.traps)}, b's ${brief(read.pair.b.traps)} (step, kind)`);

  const shared = openLogic([RUNNER_THAT_SHARES_ONE_INSTANCE]);
  let wrong;
  try {
    const about = await shared.send({ call: 'about' }, 'about');
    must(about.interface === 'logic@1', `AC3 ${AC[3]}: ${shared.name} doesn't run: ${brief(about, 300)}. The criterion's wrong program, a runner that shares one instance between two items of the same bytes, is the planted runner ${RUNNER_THAT_SHARES_ONE_INSTANCE} (README: The planted runners); without it nothing shows this test fails when a write in one item shows in the other`);
    wrong = await readItems(shared);
  } finally {
    await shared.close();
  }
  const whatElseTheRunnerChanged = whyReadingCannotJudge(wrong);
  must(whatElseTheRunnerChanged === null, `AC3 ${AC[3]}: under the planted runner ${RUNNER_THAT_SHARES_ONE_INSTANCE} ${whatElseTheRunnerChanged}: it changes more than which instance two items of the same bytes run on`);
  const caught = itemsNotAsAlone(wrong);
  must(caught.length > 0, `AC3 ${AC[3]}: the judge passed the planted runner ${RUNNER_THAT_SHARES_ONE_INSTANCE}, which runs two items of the same bytes on one instance: each item beside the other reads as it does alone`);
  const item = firstItemNamed(caught);
  must(item !== null, `AC3 ${AC[3]}: the planted runner ${RUNNER_THAT_SHARES_ONE_INSTANCE} fails, but no item is named:\n  ${caught.join('\n  ')}`);
  t.diagnostic(`the judge fails the planted runner, naming item ${item}: ${caught.length} problems, the first: ${caught[0]}`);
});
