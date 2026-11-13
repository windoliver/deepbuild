// AC1: a test reads the ask outcome, stop cause and verdict reason sets from @deepbuild/contracts and fails, naming each
// code a view has no words for; a planted outcome added with no words fails, naming it.
//
// The sets are read from the contracts' published schemas (helpers.ts `codeSets`, README, The sets). What each of the
// app's views draws for a code comes from the real app code through `deep-replica --words` (README, Pinned 1), asked
// with the core's text for that code, so a view that doesn't know a code shows that text and is caught. The planted
// outcome is the contracts' ask outcome set with one more member, `planted_outcome`, judged the same way.
import { afterAll, describe, expect, it } from 'vitest';
import { asking, cleanup, codeSets, ID, MINUTE, PLANTED_OUTCOME, viewWords, wordFailures, type CodeSet } from './helpers.ts';

afterAll(cleanup, 5 * MINUTE);

/** The sets as the contracts publish them, judged against the views once for the file. */
let clean: Promise<{ sets: CodeSet[]; failures: string[] }> | undefined;
const cleanRun = (): NonNullable<typeof clean> => (clean ??= (async () => {
  const { sets, failures } = codeSets();
  return { sets, failures: [...failures, ...wordFailures(sets, await viewWords(asking(sets)))] };
})());

describe(`#2029 AC1 ${ID.words}`, () => {
  it(`${ID.words} every ask outcome, stop cause and verdict reason the contracts close has words in each view that shows it`, async () => {
    const { sets, failures } = await cleanRun();
    // What was read, so a failure says which sets it judged.
    const read = sets.map((s) => `${s.set} from ${s.from}: ${s.codes.join(', ')}`).join('\n');
    expect(failures, `${failures.join('\n')}\n(read: ${read})`).toEqual([]);
  }, 180 * MINUTE);

  it(`${ID.words} a planted outcome added to the ask outcome set with no words fails, naming it`, async () => {
    const { sets, failures } = await cleanRun();
    expect(failures, `the contracts' own sets already fail, so the planted outcome can't be told from them: ${failures.join('\n')}`).toEqual([]);
    const planted = sets.map((s) => (s.set === 'ask.outcome' ? { ...s, codes: [...s.codes, PLANTED_OUTCOME], from: `${s.from} with ${PLANTED_OUTCOME} planted` } : s));
    expect(planted.some((s) => s.codes.includes(PLANTED_OUTCOME)), 'the contracts publish an ask outcome set to plant into').toBe(true);
    const caught = wordFailures(planted, await viewWords(asking(planted)));
    expect(caught.filter((f) => f.includes(PLANTED_OUTCOME)), `the planted outcome ${PLANTED_OUTCOME}, which no view has words for, wasn't caught, naming it: ${JSON.stringify(caught)}`).not.toEqual([]);
    expect(caught.filter((f) => !f.includes(PLANTED_OUTCOME)), 'only the planted outcome fails').toEqual([]);
  }, 180 * MINUTE);
});
