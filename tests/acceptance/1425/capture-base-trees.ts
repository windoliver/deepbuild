// Captures AC1's merge-base trees into base-trees/: each panel's element tree from the panel host, one invalidation, as
// imports.test.ts reads it now. Run once, on the base 9d31efdb, before any of #1425 existed:
//     node tests/acceptance/1425/capture-base-trees.ts
// The slot views' trees (base-trees/<panel>.<slot>.txt) were captured the same day by app/panels.rs's AC1 test, which
// writes each tree it draws under $DEEP_1425_OUT/trees/ (README, Run them).
// The files are the merge base's; a run on a later commit would capture that commit instead, so it is never rerun.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHost, loadable, serve, SUITE, TREES } from './helpers.ts';

const host = buildHost();
for (const [name, dir] of TREES) {
  const [first, again] = [(await serve(host, loadable(dir))).trees[0]!, (await serve(host, loadable(dir))).trees[0]!];
  if (first !== again) throw Error(`${name}: two runs gave two trees`);
  writeFileSync(join(SUITE, 'base-trees', `${name}.txt`), first);
  console.log(`${name}: ${first.split('\n').length - 1} lines`);
}
