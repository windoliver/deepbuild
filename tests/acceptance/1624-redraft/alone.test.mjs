// #1624 (blind redraft): the proposed replacement for the check named
// `tests/preflight.test.mjs › the unit lane runs each reference-Mac budget file alone, after the parallel block`.
// It reads only the folders under tests/acceptance/ (plans.ts and any other plain file there is skipped, so no ENOTDIR),
// finds each test file in them that calls environmentProblem() at its own call site, and asserts about the unit lane's
// own vitest commands, as scripts/lanes.mjs declares them, that the parallel block runs first and leaves the file out,
// and that the --no-file-parallelism block names it. See README.md for the mapping.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const ROOT = new URL('../../../', import.meta.url);
const ACCEPTANCE = new URL('tests/acceptance/', ROOT);

// A call whose callee is environmentProblem or a property of that name, found in the file's parsed code: a name in a
// comment or a string (a fixture the test writes out) is not a call site of its own.
const NAME = 'environment' + 'Problem';
function callsEnvironmentProblem(path, text) {
  if (!text.includes(NAME)) return false;
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
      if (name === NAME) { found = true; return; }
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));
  return found;
}

/** Every `tests/acceptance/<folder>/<file>.test.ts` that calls environmentProblem(), reading only folders. */
function gatedFiles() {
  const folders = readdirSync(ACCEPTANCE, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  return folders.flatMap((folder) => readdirSync(new URL(`${folder}/`, ACCEPTANCE), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map((entry) => `tests/acceptance/${folder}/${entry.name}`))
    .filter((file) => callsEnvironmentProblem(file, readFileSync(new URL(file, ROOT), 'utf8')))
    .sort();
}

test('#1624.alone the unit lane runs each reference-Mac budget file alone, after the parallel block', async () => {
  const gated = gatedFiles();
  // The issue names these: the enumeration must find the one that always passed and the three it says were missing.
  for (const file of ['14', '308', '45', '1017'].map((folder) => `tests/acceptance/${folder}/budgets.test.ts`)) {
    assert.ok(gated.includes(file), `the folder scan did not find ${file} calling environmentProblem():\n${gated.join('\n')}`);
  }

  const { checks } = await import(new URL('scripts/lanes.mjs', ROOT).href);
  const vitest = checks.find(({ name }) => name === 'unit').commands.filter((parts) => parts[1]?.endsWith('vitest.mjs'));
  assert.equal(vitest.length, 2, 'the unit lane runs a parallel block and then a --no-file-parallelism block of vitest');
  const [parallel, alone] = vitest;
  assert.ok(!parallel.includes('--no-file-parallelism') && alone.includes('--no-file-parallelism'), 'the parallel block runs first, the alone block after it');

  // The lane turns a folder entry into `--exclude <folder>**` and a file entry into `--exclude <file>`; the alone block's
  // positional arguments are vitest's path filters, which match a file whose path contains them.
  const excludes = parallel.flatMap((part, i) => (parallel[i - 1] === '--exclude' ? [part] : []));
  const excludedFromParallel = (file) => excludes.some((pattern) => (pattern.endsWith('**') ? file.startsWith(pattern.slice(0, -2)) : file === pattern));
  const filters = alone.slice(alone.indexOf('--no-file-parallelism') + 1);
  const runAlone = (file) => filters.some((filter) => file.includes(filter));

  assert.deepEqual(gated.filter((file) => !excludedFromParallel(file)), [], 'these budget files still run in the parallel block, beside their siblings');
  assert.deepEqual(gated.filter((file) => !runAlone(file)), [], 'these budget files are not run alone, so no block runs them with nothing beside them');
});
