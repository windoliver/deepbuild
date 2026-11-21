// #2694.de4fbd51: "After one `deep_show`, 14,400 `cells` reads and a second `deep_show`, the side holds two calls, and
// the second show's reply and presented revision equal the merge base's for the same calls. On the merge base it holds
// 14,402, and the test fails, naming the count"
//
// One side, as the hub keeps it: the hub's world, the agent's deep_show, an hour of the app's Terminal tab (a `cells`
// read every 250 ms), and the agent's second deep_show. The count is the side's own (README: held). The merge base's
// reply for the same calls is what its side computes: the same calls as one scenario, each at its place on the clock,
// through a new hub (`deep-show run`, README: The merge base's replies). The merge base's presented revision for the
// same calls is the one a side shows for the two shows alone: a presented revision names no time (README).
import { describe, test } from 'vitest';
import { AC, CELLS, FIRST, READS_MS, SECOND, TIMEOUT, baseReplies, brief, difference, heldOf, must, nth, openSide, prebuild, replyOf, show, tempDir, world, type JsonObject } from './helpers.ts';

prebuild();

const READS = 14_400;

describe(`${AC[1]} the side keeps only the calls that change something`, () => {
  test(`${AC[1]} after one deep_show, ${READS.toLocaleString('en-US')} cells reads and a second deep_show the side holds two calls, and the second show's reply and presented revision are the merge base's`, async () => {
    const side = await openSide(world(tempDir('ac1')));
    const first = await side.call(show(FIRST));
    replyOf(first, 'the first deep_show');
    heldOf(first, 'the first deep_show');
    const until = Date.now() + READS_MS;
    for (let n = 1; n <= READS; n++) {
      const read = await side.call(CELLS);
      replyOf(read, `the ${nth(n)} cells read`);
      const held = heldOf(read, `the ${nth(n)} cells read`);
      if (Date.now() > until) throw Error(`INCONCLUSIVE: the side answered ${n.toLocaleString('en-US')} of ${READS.toLocaleString('en-US')} cells reads in ${READS_MS / 60_000} minutes, holding ${held.toLocaleString('en-US')} calls after the last`);
    }
    const second = await side.call(show(SECOND));
    const reply = replyOf(second, 'the second deep_show');
    const held = heldOf(second, 'the second deep_show');
    must(held === 2, `after one deep_show, ${READS.toLocaleString('en-US')} cells reads and a second deep_show the side holds ${held.toLocaleString('en-US')} calls, not 2`);
    side.close();

    const calls: JsonObject[] = [show(FIRST), ...Array.from({ length: READS }, () => CELLS), show(SECOND)];
    const base = baseReplies(world(tempDir('ac1-base')), calls).at(-1)!;
    const replyDiff = difference(reply, base);
    must(replyDiff === '', `the second deep_show's reply isn't the merge base's for the same calls:\n${replyDiff}`);

    const two = await openSide(world(tempDir('ac1-two')));
    replyOf(await two.call(show(FIRST)), 'the first deep_show, alone');
    const alone = await two.call(show(SECOND));
    replyOf(alone, 'the second deep_show, after the first alone');
    two.close();
    must(second['presented'] !== null && second['presented'] !== undefined, `the second deep_show presents no revision: ${brief(second, 600)}`);
    const presentedDiff = difference(second['presented'], alone['presented']);
    must(presentedDiff === '', `the second deep_show's presented revision isn't the merge base's for the same calls:\n${presentedDiff}`);
  }, TIMEOUT);
});
