// Criterion 1 of #3611 (#3611.d8311031): "A second fresh canvas core with the shipped packs, started on a store the
// first filled, answers its first call having run no pack check: its own count of kits, field checks, rewrites, runs
// and compiles since start is 0, and its `deep_kinds` listing and `packs` rows equal the first core's but for the count
// of checks run"
//
// Two cores, one after the other, each a fresh process given the same world: every pack the release ships, one evidence
// store, and `pack_checks` naming one store folder and one launch key. The first starts on an empty store. Each is
// asked `packs` as its first call, then every page of `deep_kinds list`, then `packs` again (judge.mjs
// `judgeFirstCore`, `judgeSecondCore`):
//   - the first core's count of each of the five is 1 or more, it ran each version's check once, and it left a row for
//     each version in the store; a first core that fails any of these is judged at once, with no second core started;
//   - the second core's count of each of the five is 0 at its first reply and still 0 after its listing, each row's
//     `checks` is 0, its rows equal the first core's but for `checks`, every page of its listing equals the first
//     core's, and it wrote no file of the store again.
// Wrong programs it fails on: the merge base (no `counts`, no store); a core that keeps rows and takes none; a core
// that takes a row without admitting what its check left, whose listing or rows then differ.
// Run: node --test tests/acceptance/3611/ac1-second-core.test.mjs
import test from 'node:test';
import { ANSWER_MS, listingOf, none, openCore, packsOf, removeRoot, showBinary, tempRoot, worldOf } from './core.mjs';
import { judgeFirstCore, judgeSecondCore } from './judge.mjs';
import { shippedPacks } from './packs.mjs';
import { fileAt } from './store.mjs';

/** One fresh core through the criterion's calls; `gate` judges its first reply before the listing is asked for. */
async function play(world, what, gate) {
  const core = await openCore(world, what);
  try {
    const packs = await packsOf(core, what, ANSWER_MS);
    const ms = performance.now() - core.at;
    gate?.(packs);
    const listing = await listingOf(core, what);
    const last = await packsOf(core, what);
    return { packs, listing, last, ms };
  } finally {
    await core.close();
  }
}

test('AC1 #3611.d8311031 a second fresh canvas core with the shipped packs, started on the store the first filled, runs no pack check: its counts are 0, and its deep_kinds listing and packs rows equal the first core\'s but for the count of checks run', { timeout: 19 * 60_000 }, async (t) => {
  showBinary();
  const refs = shippedPacks();
  const at = tempRoot();
  try {
    const world = worldOf(at, refs.map((pack) => pack.offer));
    const files = () => new Map(refs.map(({ ref }) => [ref, fileAt(at.checked, ref)]));

    const first = await play(world, 'the first core', (packs) => none(judgeFirstCore({ refs, packs, files: files(), store: '<root>/packs/checked/' }), `AC1 #3611.d8311031: the first core, started on an empty store with the ${refs.length} shipped packs`));
    const before = files();
    const second = await play(world, 'the second core');
    t.diagnostic(`${refs.length} shipped packs; the first core's first reply took ${first.ms.toFixed(0)} ms with counts ${JSON.stringify(first.packs.counts)}, the second's ${second.ms.toFixed(0)} ms with counts ${JSON.stringify(second.packs.counts)}; ${first.listing.length} pages of listing`);
    none(judgeSecondCore({ refs, first, second, before, after: files() }), `AC1 #3611.d8311031: the second core, started on the store the first filled`);
  } finally {
    removeRoot(at);
  }
});
