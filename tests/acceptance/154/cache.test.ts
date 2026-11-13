// AC3 #154.6e31be7c: "Editing one part re-renders one stem, and the other stems are cache hits"
//
// asserts: the song (README: Fixtures) planned and rendered stem by stem, each a miss; then g3, a guitar note on
// `strings`, made louder (vel 0.6 to 0.9) and the song planned again: `keys` and `pads` keep their params and inputs
// exactly (a stem's params hold only that stem), and deep_job answers each of them as a cache hit with its old stem
// by hash and no process started, while `strings` is a miss that starts its tool and gives another stem. Exactly one
// of the three is rendered again.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, cacheOf, canonical, done, keysLibrary, outputsOf, packDirs, planOf, planReply, proof, renderPlan, renderStem, scoreWorld, song, useShow } from './helpers.ts';

const showBin = useShow();
const LIB = keysLibrary();

describe(`${AC[3]} one part edited, one stem rendered again`, () => {
  it(`${AC[3]} editing one guitar note re-renders strings alone, and keys and pads are cache hits with no process`, async () => {
    const w = await scoreWorld([LIB]);
    const before = planOf(planReply(showBin(), w.evidence, song(LIB), 'song', packDirs(w), 'the song'), 'the song');
    const first = await renderPlan(w, before, 'the song');
    for (const [name, r] of Object.entries(first)) expect(cacheOf(r.outcome), `the first render of ${name} is a miss`).toBe('miss');

    const after = planOf(planReply(showBin(), w.evidence, song(LIB, 'louder_g3'), 'song', packDirs(w), 'the song with g3 louder'), 'the song with g3 louder');
    expect(Object.keys(after.stems).sort(), 'the edited song plans the same three stems').toEqual(Object.keys(before.stems).sort());
    for (const name of ['keys', 'pads']) {
      expect(canonical(after.stems[name]!.params), `${name}'s params are unchanged by an edit to strings`).toBe(canonical(before.stems[name]!.params));
      expect(after.stems[name]!.inputs, `${name}'s inputs are unchanged by an edit to strings`).toEqual(before.stems[name]!.inputs);
    }
    expect(canonical(after.stems['strings']!.params), 'strings\' params change with g3').not.toBe(canonical(before.stems['strings']!.params));

    const second: Record<string, { cache: unknown; started: number; stem: string | undefined; reply: string }> = {};
    for (const name of ['keys', 'pads', 'strings']) {
      const r = await renderStem(w, after.stems[name]!);
      second[name] = { cache: cacheOf(r.outcome), started: r.started, stem: done(r.outcome) ? outputsOf(r, name).stem : undefined, reply: r.outcome.text.slice(0, 600) };
    }
    proof('ac3-cache.json', { first: Object.fromEntries(Object.entries(first).map(([n, r]) => [n, { stem: r.stem, started: r.started }])), second });
    for (const name of ['keys', 'pads']) {
      expect([second[name]!.cache, second[name]!.started], `${name} is a cache hit that starts no process: ${second[name]!.reply}`).toEqual(['hit', 0]);
      expect(second[name]!.stem, `${name}'s hit serves its first stem by hash`).toBe(first[name]!.stem);
    }
    expect(second['strings']!.cache, `strings is rendered again: ${second['strings']!.reply}`).toBe('miss');
    expect(second['strings']!.started, 'rendering strings again starts its tool').toBeGreaterThan(0);
    expect(second['strings']!.stem, 'the louder g3 gives another strings stem').not.toBe(first['strings']!.stem);
    expect(Object.values(second).filter((s) => s.cache === 'miss').length, 'exactly one stem is rendered again').toBe(1);
  }, TIMEOUT);
});
