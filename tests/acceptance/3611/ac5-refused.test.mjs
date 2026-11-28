// Criterion 5 of #3611 (#3611.55062395): "A refused version stays refused from the store, with its issues, and is
// checked again only when its digest or the build changes"
//
// Three test packs, each refused by its own check (an input whose default is outside its range), in one store under one
// launch key, and four fresh cores in turn (judge.mjs `judgeRefused`):
//   1. the first core checks all three: each reads refused, with issues;
//   2. the second takes all three from the store (`checks` 0): each reads refused with the same issues;
//   3. then `fixed`'s folder is written again with bytes that pass, so its row is of another digest, and `built`'s row
//      is rewritten as a build of other sources would have left it under this launch (the same row, its `build` another
//      digest, marked with the launch key); `stays` is untouched. The third core checks `fixed` again, which now reads
//      installed, and `built` again, which reads refused with the same issues; `stays` is not checked (`checks` 0);
//   4. the fourth takes all three (`checks` 0): `stays` and `built` refused with their issues, `fixed` installed.
// So a refusal is checked again when its digest changed and when the build changed, and at no other start here.
// Wrong programs it fails on: the merge base (every core checks every version); a core that keeps no row for a refusal;
// a core that takes a refusal without its issues; a core that takes a refusal's row of another build.
// Run: node --test tests/acceptance/3611/ac5-refused.test.mjs
import test from 'node:test';
import { blocked, brief, buildOf, none, openCore, packsOf, packsOnce, removeRoot, showBinary, tempRoot, worldOf } from './core.mjs';
import { judgeRefused, rowOf } from './judge.mjs';
import { testPack } from './packs.mjs';
import { fileAt, ofAnotherBuild } from './store.mjs';

test('AC5 #3611.55062395 a refused version stays refused from the store, with its issues, and is checked again only when its digest or the build changes', { timeout: 15 * 60_000 }, async () => {
  showBinary();
  const at = tempRoot();
  try {
    const stays = testPack(at, 'kept3611stays', { fallback: 0 });
    const fixed = testPack(at, 'kept3611fixed', { fallback: 0 });
    const built = testPack(at, 'kept3611rebuilt', { fallback: 0 });
    const all = [stays, fixed, built];
    const world = worldOf(at, all.map((pack) => pack.offer));

    const core = await openCore(world, 'the first core');
    let fill, build;
    try {
      fill = await packsOf(core, 'the first core');
      build = await buildOf(core, 'the first core');
    } finally { await core.close(); }
    const admitted = all.filter((pack) => { const row = rowOf(fill.rows, pack.ref); return row?.state !== 'refused' || !Array.isArray(row.issues) || !row.issues.length; });
    if (admitted.length) throw blocked(`the test packs aren't refused with issues by their own check on the first core: ${brief(admitted.map((pack) => rowOf(fill.rows, pack.ref) ?? pack.ref), 800)}`);

    const second = await packsOnce(world, 'the second core');
    // Judged here too, so a core that keeps no refusal fails before a row of it is looked for.
    const early = judgeRefused({ packs: { stays: stays.ref, fixed: fixed.ref, built: built.ref }, fill: fill.rows, second: second.rows, after: [], settled: [], builds: {} }).filter((line) => line.includes('by the second core'));
    none(early, 'AC5 #3611.55062395: a refused version stays refused from the store, with its issues');

    fixed.rewrite({ fallback: 3 });
    const row = fileAt(at.checked, built.ref);
    if (!row.two || !row.row) throw blocked(`${built.ref}: taken as refused by the second core, it has no row at ${row.file} to rewrite as another build's`);
    const other = ofAnotherBuild(row, at.key);
    if (other === null) throw blocked(`${built.ref}: its row's first line holds no top-level \`build\` to rewrite`);

    const after = await packsOnce(world, 'the third core');
    const settled = await packsOnce(world, 'the fourth core');
    none(judgeRefused({ packs: { stays: stays.ref, fixed: fixed.ref, built: built.ref }, fill: fill.rows, second: second.rows, after: after.rows, settled: settled.rows, builds: { own: build, other } }), 'AC5 #3611.55062395: a refused version stays refused from the store, with its issues, and is checked again only when its digest or the build changes');
  } finally {
    removeRoot(at);
  }
});
