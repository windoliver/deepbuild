// #3585: the proof lanes read a criterion tag through the modules a test imports (tagsWithImports in
// scripts/proof-change.mjs, which the before and trace lanes call). A TypeScript test names a sibling
// `helpers.ts` as `./helpers.js`, as TypeScript and vite resolve it; the lanes must read that module's tags,
// and a specifier naming a `.js` file that exists must still read that file.
//
// Each test builds a scratch git repository and calls tagsWithImports on it, both on the worktree (rev null)
// and on a commit. The planted issue is #9001; its tags are built at runtime, so no file here holds a tag a
// real issue's trace lane could read as its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import { tagsWithImports } from '../../../scripts/proof-change.mjs';
import { criterionId, git, scratch, write } from '../569/helpers.mjs';

const N = 9001;
const NEAR = criterionId(N, 'The helper the test imports holds this tag');
const FAR = criterionId(N, 'A module the helper imports holds this tag');
const WRONG = criterionId(N, 'Only the TypeScript module beside the named JavaScript file holds this tag');
const DIR = `tests/acceptance/${N}`;

/** A repository with `files` committed on main; returns its folder and the commit. */
function repo(t, files) {
  const cwd = scratch(t, 'deep-proof-3585-');
  git(cwd, 'init', '-q', '-b', 'main');
  write(cwd, files);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');
  return { cwd, head: git(cwd, 'rev-parse', 'HEAD').trim() };
}

/** A test file that names its test with a tag it imports from `specifier`. */
const testFile = (specifier) =>
  `import { it } from 'vitest';\nimport { AC } from '${specifier}';\n\nit(\`\${AC} holds\`, () => {});\n`;

/** Reads the tags as the lanes do, on the worktree and on the commit; both must agree. */
function tags(scene, path) {
  const worktree = tagsWithImports(scene.cwd, null, path);
  const committed = tagsWithImports(scene.cwd, scene.head, path);
  assert.deepEqual([...committed].sort(), [...worktree].sort(), 'the commit and the worktree read different tags');
  return worktree;
}

// TypeScript's mapping of a JavaScript extension to the TypeScript sources it names.
const CASES = [
  { specifier: './helpers.js', file: 'helpers.ts' },
  { specifier: './helpers.js', file: 'helpers.tsx' },
  { specifier: './helpers.mjs', file: 'helpers.mts' },
  { specifier: './helpers.cjs', file: 'helpers.cts' },
  { specifier: './helpers.jsx', file: 'helpers.tsx' },
];

for (const { specifier, file } of CASES) {
  test(`#3585.53dc07b0 a test importing ${file} by the name ${specifier} reads its tags`, (t) => {
    const scene = repo(t, {
      [`${DIR}/a.test.ts`]: testFile(specifier),
      [`${DIR}/${file}`]: `export const AC = '${NEAR}';\n`,
    });
    const found = tags(scene, `${DIR}/a.test.ts`);
    assert.ok(found.includes(NEAR), `tagsWithImports read no tag of ${file}, imported as ${specifier}: got ${JSON.stringify(found)}`);
  });
}

test('#3585.53dc07b0 tags reach through a chain of .js specifiers naming .ts modules', (t) => {
  const scene = repo(t, {
    [`${DIR}/a.test.ts`]: `import { it } from 'vitest';\nimport { AC, FAR } from './helpers.js';\n\nit(\`\${AC} and \${FAR} hold\`, () => {});\n`,
    [`${DIR}/helpers.ts`]: `export { FAR } from './ids.js';\nexport const AC = '${NEAR}';\n`,
    [`${DIR}/ids.ts`]: `export const FAR = '${FAR}';\n`,
  });
  const found = tags(scene, `${DIR}/a.test.ts`);
  assert.ok(found.includes(NEAR), `the near helper's tag is missing: got ${JSON.stringify(found)}`);
  assert.ok(found.includes(FAR), `the far module's tag is missing: got ${JSON.stringify(found)}`);
});

// Where the named JavaScript file exists, it is the module, as node, vite and TypeScript take it; the
// TypeScript file beside it is not imported and its tags are not the test's.
const KEPT = [
  { specifier: './helpers.js', file: 'helpers.js', beside: 'helpers.ts' },
  { specifier: './helpers.mjs', file: 'helpers.mjs', beside: 'helpers.mts' },
  { specifier: './helpers.cjs', file: 'helpers.cjs', beside: 'helpers.cts' },
  { specifier: './helpers.jsx', file: 'helpers.jsx', beside: 'helpers.tsx' },
];

for (const { specifier, file, beside } of KEPT) {
  test(`#3585.f42fa3e6 ${specifier} naming an existing ${file} reads ${file}, not ${beside}`, (t) => {
    const scene = repo(t, {
      [`${DIR}/a.test.ts`]: testFile(specifier),
      [`${DIR}/${file}`]: `export const AC = '${NEAR}';\n`,
      [`${DIR}/${beside}`]: `export const AC = '${WRONG}';\n`,
    });
    const found = tags(scene, `${DIR}/a.test.ts`);
    assert.ok(found.includes(NEAR), `the existing ${file}'s tag is missing: got ${JSON.stringify(found)}`);
    assert.ok(!found.includes(WRONG), `${beside}, which the test doesn't import, was read in place of ${file}: got ${JSON.stringify(found)}`);
  });
}
