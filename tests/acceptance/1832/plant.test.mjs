// #1832 criterion 1: each twin #25's and #27's twins.json name, as this checkout holds it, laid by the before lane
// (`node scripts/proof.mjs before` from this checkout) over this checkout's plant module after a planted change
// elsewhere in that file. The lane runs in a scratch npm workspace holding the planted file, a module that needs the
// planted change to build, and one tagged test per twin (README: The planted change). A twin kept as a whole file
// loses the planted change and no longer builds; a twin kept as its lines still builds and fails its test at its
// assertion.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { beforeLane, CHECKOUT, criterionId, json, linesFor, LONG, named, provenOn, ranToEnd, repository, sandbox, show, twinsOf, write } from './helpers.mjs';

// The plant module's package, written in pieces: this test starts no hub and reads no hub binary, and the lane builds
// the hub's binaries for a test file whose strings name the hub's package folder.
const HUB = ['packages', 'hub'].join('/');
const PLANT = `${HUB}/src/plant.ts`;
const ISSUE = 9832;
const dir = `tests/acceptance/${ISSUE}`;

// The planted change elsewhere in the file: a first line, so every line after it moves down by one, and an export at
// its end, which the fixture's other module needs to build.
const FIRST = '// Planted by the #1832 acceptance test: a change elsewhere in this file.\n';
const LAST = "\n/** Planted by the #1832 acceptance test: a change elsewhere in this file, which uses.ts needs to build. */\nexport const plantedElsewhere1832 = (): string => 'elsewhere';\n";
const USES = "import { plantedElsewhere1832 } from './plant.js';\n\nexport const elsewhere = (): string => plantedElsewhere1832();\n";

// The repository's own compiler settings (tsconfig.json at the base), for the two files alone.
const tsconfig = json({
  compilerOptions: {
    target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
    noImplicitOverride: true, noUnusedLocals: true, noUnusedParameters: true, forceConsistentCasingInFileNames: true, verbatimModuleSyntax: true,
    types: ['node'], typeRoots: [join(CHECKOUT, 'node_modules/@types')], skipLibCheck: true, rootDir: 'src', outDir: 'dist',
  },
  files: ['src/plant.ts', 'src/uses.ts'],
});

/** The workspace on main: the planted plant module, uses.ts, and a tsc that runs this checkout's compiler, so its lock installs offline. */
function workspace(extra) {
  const plant = readFileSync(join(CHECKOUT, PLANT), 'utf8');
  return {
    '.gitignore': 'node_modules\ndist\n*.tsbuildinfo\n',
    'package.json': json({ name: 'twin-lines-fixture', version: '0.0.0', private: true, type: 'module', workspaces: ['packages/*'], devDependencies: { typescript: 'file:vendor/typescript' } }),
    'vendor/typescript/package.json': json({ name: 'typescript', version: '0.0.0', private: true, bin: { tsc: 'bin/tsc.cjs' } }),
    'vendor/typescript/bin/tsc.cjs': `#!/usr/bin/env node\nrequire(${JSON.stringify(join(CHECKOUT, 'node_modules/typescript/lib/tsc.js'))});\n`,
    ...extra,
    [`${HUB}/package.json`]: json({ name: '@fx/hub', version: '0.0.0', private: true, type: 'module', scripts: { build: 'tsc -p tsconfig.json' } }),
    [`${HUB}/tsconfig.json`]: tsconfig,
    [PLANT]: `${FIRST}${plant}${plant.endsWith('\n') ? '' : '\n'}${LAST}`,
    [`${HUB}/src/uses.ts`]: USES,
  };
}

/** The lock npm writes for the workspace, made offline in a folder of its own. */
function lockFor(box, files) {
  const scratch = join(box.dir, 'lock');
  write(scratch, files);
  execFileSync('npm', ['install', '--package-lock-only', '--offline', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: scratch, env: box.env, stdio: 'pipe' });
  return readFileSync(join(scratch, 'package-lock.json'), 'utf8');
}

/** The repo paths a twin edits or replaces: the files its lines.json names, and every other file it holds. */
function targets(twin) {
  let lines = {};
  try {
    if (twin.files.includes('lines.json')) lines = JSON.parse(readFileSync(join(CHECKOUT, twin.folder, 'lines.json'), 'utf8'));
  } catch (error) {
    assert.fail(`${twin.folder}/lines.json is not JSON: ${error.message}`);
  }
  assert.ok(lines && typeof lines === 'object' && !Array.isArray(lines), `${twin.folder}/lines.json is not an object of repo paths`);
  return [...Object.keys(lines), ...twin.files.filter((file) => file !== 'lines.json')];
}

test('#1832.28845f50 after a planted change elsewhere in the plant module, each twin of #25 and #27 laid by the before lane still builds and fails its test at its assertion', LONG, (t) => {
  const twins = [...twinsOf('25'), ...twinsOf('27')].map((twin) => {
    const text = `With no DEEP_HUB_PLANT set no planted program is selected (${twin.suite}/${twin.name})`;
    return { ...twin, as: `${twin.suite}-${twin.name}`, text, title: `${criterionId(ISSUE, text)} with no DEEP_HUB_PLANT set no planted program is selected` };
  });

  // Main holds this checkout's copy of every file a twin names, beside the planted plant module; only the plant
  // module and uses.ts are built.
  const others = {};
  for (const path of new Set(twins.flatMap(targets))) {
    assert.match(path, /^[\w.@-]+(?:\/[\w.@-]+)*$/, `a twin names ${path}, which is no repo path`);
    assert.ok(!path.split('/').includes('..'), `a twin names ${path}, which leads out of the checkout`);
    if (path !== PLANT && existsSync(join(CHECKOUT, path))) others[path] = readFileSync(join(CHECKOUT, path));
  }
  const main = workspace(others);

  // One test per twin, each under a criterion of its own, so the lane proves each on its own twin and no other.
  const file = `${dir}/plant.test.mjs`;
  const tests = `import assert from 'node:assert/strict';
import test from 'node:test';
import { activePlant, plantOf } from '../../../${HUB}/dist/plant.js';
import { elsewhere } from '../../../${HUB}/dist/uses.js';

for (const title of ${JSON.stringify(twins.map(({ title }) => title))}) {
  test(title, () => {
    delete process.env.DEEP_HUB_PLANT;
    assert.equal(elsewhere(), 'elsewhere');
    assert.equal(plantOf(undefined), undefined);
    assert.equal(activePlant(), undefined);
  });
}
`;
  const change = { [file]: tests, [`${dir}/twins.json`]: json(Object.fromEntries(twins.map(({ title, as }) => [title.split(' ')[0], [as]]))) };
  for (const twin of twins) for (const path of twin.files) change[`${dir}/twins/${twin.as}/${path}`] = readFileSync(join(CHECKOUT, twin.folder, path));

  const box = sandbox(t);
  const cwd = repository(box, {
    base: { ...main, 'package-lock.json': lockFor(box, main) },
    change,
    message: `Test the plant module\n\nPart of #${ISSUE}`,
    executable: ['vendor/typescript/bin/tsc.cjs'],
  });
  const result = beforeLane(box, cwd, ISSUE, twins.map(({ text }) => text));
  ranToEnd(result);

  // Every twin is judged before any fails the test, so the message names each that is not proven.
  const unproven = twins.filter((twin) => {
    const lines = linesFor(result, named(file, twin.title));
    return !lines.length || lines.some((line) => !line.startsWith('PASS before: ')) || !lines.some((line) => line.endsWith(`: failed on ${twin.as} at its assertion`));
  });
  assert.deepEqual(unproven.map(({ folder }) => folder), [], `${unproven.length} of the ${twins.length} twins of #25 and #27 did not build and fail their test at its assertion after the planted change\n${show(result)}`);
  for (const twin of twins) provenOn(result, named(file, twin.title), twin.as);
  assert.equal(result.status, 0, `the before lane failed\n${show(result)}`);
});
