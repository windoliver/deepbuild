import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CODE, atBase, base, changedFiles, checkoutFiles, exportsOf, importsOf, moduleKey, packageDirs, readNow, target, testSources } from './helpers.mjs';

const ID = '#1688.49c6e110';

test(`${ID} AC3: no acceptance test or twin imports a name that lost its export, and the change drops exports`, () => {
  const lost = [];
  for (const file of changedFiles().filter((f) => CODE.test(f) && !f.startsWith('tests/acceptance/'))) {
    const was = atBase(file);
    if (was === undefined) continue;
    const now = exportsOf(readNow(file));
    for (const name of exportsOf(was)) if (!now.has(name)) lost.push({ file, name });
  }
  const files = checkoutFiles();
  const exportedNow = new Map();
  const stillExported = (pkg, name) => {
    if (!exportedNow.has(pkg)) {
      const names = new Set();
      for (const f of files.filter((p) => p.startsWith(`packages/${pkg}/src/`) && CODE.test(p))) for (const n of exportsOf(readNow(f))) names.add(n);
      exportedNow.set(pkg, names);
    }
    return exportedNow.get(pkg).has(name);
  };
  const packages = packageDirs();
  const offending = [];
  for (const path of files.filter((p) => p.startsWith('tests/acceptance/') && (CODE.test(p) || /\/twins\/[^/]+\/lines\.json$/.test(p)))) {
    for (const { from, text } of testSources(path)) {
      for (const { name, spec } of importsOf(text)) {
        const to = target(spec, from, packages);
        if (!to) continue;
        const hit = to.key
          ? lost.find((l) => l.name === name && moduleKey(l.file) === to.key)
          : lost.find((l) => l.name === name && l.file.startsWith(`packages/${to.pkg}/src/`) && !stillExported(to.pkg, name));
        if (hit) offending.push(`${path} imports ${name} from '${spec}', which ${hit.file} no longer exports`);
      }
    }
  }
  assert.deepEqual(offending, [], 'acceptance tests or twins import names that lost their export');
  assert.ok(lost.length > 0, `the change drops no export against the merge base ${base()}: no name lost its export, so nothing was cleaned`);
});
