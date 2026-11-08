// AC1 #1425.3d839088: all 12 panels and the guide's sample import only @deepbuild/panel, and each one's panel tree is
// byte-equal to the merge base's.
//
// The imports are read from each package's scripts (main.js and what it imports by a relative path). A panel's tree is
// the element tree the panel host sends for it (crates/deep-panel-host, `serve`, one invalidation): gpui-shell's text of
// the panel's snapshot, as the app reads it (the guide's sample from a copy of its scripts: loading writes typings beside
// a panel). The views the 338 panels register in the app's slots are app/panels.rs's (app.test.ts). The merge base's
// trees were captured from the base 9d31efdb with capture-base-trees.ts into base-trees/, one file a panel; they are
// compared byte for byte.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC1, BUILD_MS, buildHost, imports, loadable, MODULE, packageScripts, PANELS, REPO, serve, SUITE, TREES } from './helpers.ts';

test(`${AC1} all 12 panels and the guide's sample import only ${MODULE}`, () => {
  const panels = readdirSync(join(REPO, 'crates/deep-app/panels')).filter((name) => existsSync(join(REPO, 'crates/deep-app/panels', name, 'main.js')));
  expect(panels.sort(), 'the 12 panels are the ones the base has').toEqual([...PANELS].sort());
  const wrong: string[] = [];
  for (const [name, dir] of TREES) {
    const scripts = packageScripts(dir);
    if (!scripts.length) wrong.push(`${name}: no ${dir}/main.js`);
    let fromModule = 0;
    for (const file of scripts) {
      for (const { specifier, line } of imports(readFileSync(join(REPO, file), 'utf8'))) {
        if (specifier === MODULE) fromModule++;
        else if (!specifier.startsWith('.')) wrong.push(`${file}:${line} imports "${specifier}"`);
      }
    }
    if (scripts.length && !fromModule) wrong.push(`${name}: nothing is imported from ${MODULE}`);
  }
  expect(wrong, wrong.join('\n')).toEqual([]);
});

test(`${AC1} each one's panel tree is byte-equal to the merge base's`, async () => {
  const host = buildHost();
  const differ: string[] = [];
  for (const [name, dir] of TREES) {
    const base = readFileSync(join(SUITE, 'base-trees', `${name}.txt`), 'utf8');
    let tree: string;
    try {
      [tree] = (await serve(host, loadable(dir))).trees as [string];
    } catch (error) {
      differ.push(`${name}: no tree: ${(error as Error).message}`);
      continue;
    }
    if (tree === base) continue;
    const [a, b] = [base.split('\n'), tree.split('\n')];
    const at = a.findIndex((line, i) => line !== b[i]);
    const line = at < 0 ? a.length : at;
    differ.push(`${name}: differs from the merge base's at line ${line + 1}:\n  base: ${JSON.stringify(a[line])}\n  now:  ${JSON.stringify(b[line])}`);
  }
  expect(differ, differ.join('\n')).toEqual([]);
}, BUILD_MS);
