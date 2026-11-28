// Criterion 2 of #3611 (#3611.8b256396): "A pack whose bytes changed under the same folder, a version it requires at
// another digest, a build of other sources, and a planted build each run the check again and replace the row. A planted
// core that takes a row of another digest or another build fails, naming the pack and what differed"
//
// Four test packs in one store, seven fresh cores in turn, all on one launch key (`sequence`, judged by judge.mjs
// `judgeChanged`):
//   1. the first core checks all four and keeps a row for each; each file is as the design step says, its `build` this
//      build's source digest (the `fingerprint` call's), the requiring pack's `requires` naming the required version at
//      the digest that version's own row holds;
//   2. then `changed`'s folder is written again with bytes its check refuses, `required`'s with other bytes that pass,
//      and `built`'s row is rewritten as a build of other sources would have left it under this launch: the same row,
//      its `build` another digest, marked with the launch key. `requiring` is untouched: only the version it requires
//      is at another digest;
//   3. the next core runs all four checks again (`checks` 1): `changed` now reads refused, the others installed, and
//      the files are replaced (`changed`'s row another digest, `built`'s this build's, marked);
//   4. the core after it takes all four from the replaced rows (`checks` 0), with the states the checks just gave;
//   5. a core started with a wrong program planted (`esc_to_root`, one the base already has, which changes nothing a
//      pack's check reads) runs all four checks again;
//   6. a core without it runs all four again on that planted build's rows, and 7. the core after it takes all four.
// The same sequence runs with every core but the fifth started as each planted core; each must fail the same judge,
// naming the pack and what differed (README: The planted cores).
// Wrong programs it fails on: the merge base (no row kept); the two planted cores; a core that binds a row to its own
// digest and not to the digests of the versions it requires (`requiring` taken).
// Run: node --test tests/acceptance/3611/ac2-changed.test.mjs
import test from 'node:test';
import { blocked, buildOf, failsNaming, must, none, openCore, packsOf, packsOnce, removeRoot, showBinary, tempRoot, worldOf } from './core.mjs';
import { judgeChanged, rowOf } from './judge.mjs';
import { testPack } from './packs.mjs';
import { fileAt, marked, ofAnotherBuild, rowProblems } from './store.mjs';

/** A wrong program the base already has, far from packs: it stands for "a planted build". */
const WRONG = 'esc_to_root';

/** The criterion's sequence, every core but the fifth started with `planted` (none for the shipped core): what `judgeChanged` reads. */
async function sequence(planted) {
  const at = tempRoot();
  try {
    const own = planted === undefined ? {} : { planted };
    const changed = testPack(at, 'kept3611changed');
    const required = testPack(at, 'kept3611required');
    const requiring = testPack(at, 'kept3611requiring', { requires: [required.ref] });
    const built = testPack(at, 'kept3611built');
    const all = [changed, required, requiring, built];
    const world = (extra) => worldOf(at, all.map((pack) => pack.offer), extra);
    const what = planted === undefined ? 'core' : `core with ${planted} planted`;

    // 1. The first core fills the store.
    const core = await openCore(world(own), `the first ${what}`);
    let fill, build;
    try {
      fill = await packsOf(core, `the first ${what}`);
      build = await buildOf(core, `the first ${what}`);
    } finally { await core.close(); }
    const unchecked = all.filter((pack) => rowOf(fill.rows, pack.ref)?.state !== 'installed');
    if (unchecked.length) throw blocked(`the test packs don't pass their check on the first ${what}: ${JSON.stringify(unchecked.map((pack) => rowOf(fill.rows, pack.ref) ?? pack.ref)).slice(0, 800)}`);
    const rows = Object.fromEntries(all.map((pack) => [pack.name, fileAt(at.checked, pack.ref)]));
    none(all.flatMap((pack) => rowProblems(rows[pack.name], { key: at.key, pack: pack.id, version: pack.version, outcome: 'installed', build })), `AC2 #3611.8b256396: the first ${what} checked ${all.length} test packs and keeps each result as the design step says, under <root>/packs/checked/`);
    must(rows[requiring.name].row.requires[required.ref] === rows[required.name].row.digest, `AC2 #3611.8b256396: ${requiring.ref}: its row's \`requires\` names ${required.ref} at ${JSON.stringify(rows[requiring.name].row.requires[required.ref])}, not at the digest ${required.ref}'s own row holds, ${rows[required.name].row.digest}`);

    // 2. A pack's bytes, a required version's bytes, and a row's build change.
    changed.rewrite({ fallback: 0 });
    required.rewrite({ width: 18 });
    const other = ofAnotherBuild(rows[built.name], at.key);
    if (other === null) throw blocked(`${built.ref}: its row's first line holds no top-level \`build\` to rewrite`);

    // 3 to 7. The cores that follow.
    const after = await packsOnce(world(own), `the ${what} started after the changes`);
    const replaced = { changed: fileAt(at.checked, changed.ref), built: fileAt(at.checked, built.ref) };
    const again = await packsOnce(world(own), `the ${what} after it`);
    const wrong = await packsOnce(world({ planted: WRONG }), `a core with ${WRONG} planted`);
    const back = await packsOnce(world(own), `the ${what} started on that planted build's rows`);
    const settled = await packsOnce(world(own), `the last ${what}`);
    return {
      packs: { changed: changed.ref, required: required.ref, requiring: requiring.ref, built: built.ref },
      after: after.rows, again: again.rows, planted: wrong.rows, back: back.rows, settled: settled.rows, wrong: WRONG,
      digests: { before: rows[changed.name].row.digest, after: replaced.changed.row?.digest },
      builds: { own: build, other, after: replaced.built.row?.build, marked: marked(at.key, replaced.built) },
    };
  } finally {
    removeRoot(at);
  }
}

test('AC2 #3611.8b256396 a pack whose bytes changed under the same folder, a version it requires at another digest, a build of other sources and a planted build each run the check again and replace the row', { timeout: 15 * 60_000 }, async () => {
  showBinary();
  const seen = await sequence(undefined);
  none(judgeChanged(seen), 'AC2 #3611.8b256396: a changed pack, a required version at another digest, a row of another build and a planted build each run the check again and replace the row');
});

test('AC2 #3611.8b256396 a planted core that takes a row of another digest fails, naming the pack and that its digest differed', { timeout: 15 * 60_000 }, async () => {
  showBinary();
  const seen = await sequence('takes_row_of_another_digest');
  failsNaming(judgeChanged(seen), [seen.packs.changed, 'digest'], 'AC2 #3611.8b256396: the planted core takes_row_of_another_digest');
});

test('AC2 #3611.8b256396 a planted core that takes a row of another build fails, naming the pack and that its build differed', { timeout: 15 * 60_000 }, async () => {
  showBinary();
  const seen = await sequence('takes_row_of_another_build');
  failsNaming(judgeChanged(seen), [seen.packs.built, 'another build'], 'AC2 #3611.8b256396: the planted core takes_row_of_another_build');
});
