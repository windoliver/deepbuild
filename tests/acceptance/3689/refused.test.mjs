import test from 'node:test';
import { beforeLane, DIR, ids, json, LONG, named, ranToEnd, refusedNaming, repository, sandbox } from './helpers.mjs';

const CRITERIA = {
  testFile: 'The unit check of counting passes',
  imported: 'Half of ten is five',
  throughImport: 'Twice four is eight',
  data: 'The fixture maker prints its fixture',
  acceptance: 'The acceptance tool prints its name',
  nonCode: 'The shell sum adds its two numbers',
  nodeModules: 'The sum tool adds two and three',
  mixed: 'The sum tool adds three and four',
};
const ID = ids(CRITERIA);

const TEST_PATH = `${DIR}/refused.test.mjs`;
const NAMES = {
  testFile: `${ID.testFile} the counting check exits 0`,
  imported: `${ID.imported} half of ten`,
  throughImport: `${ID.throughImport} twice four`,
  data: `${ID.data} the fixture maker prints fixture`,
  acceptance: `${ID.acceptance} the acceptance tool prints tool`,
  nonCode: `${ID.nonCode} the shell sum of two and three`,
  nodeModules: `${ID.nodeModules} two and three sum to five`,
  mixed: `${ID.mixed} three and four sum to seven`,
};
const BODIES = {
  testFile: "assert.equal(spawnSync(process.execPath, [at('../../unit/count.test.mjs')], { encoding: 'utf8' }).status, 0);",
  imported: 'assert.equal(half(10), 5);',
  throughImport: 'assert.equal(twice(4), 8);',
  data: "assert.equal(node(at('../../__fixtures__/make.mjs')), 'fixture\\n');",
  acceptance: "assert.equal(node(at('./tool.mjs')), 'tool\\n');",
  nonCode: "assert.equal(spawnSync('sh', [at('../../tools/sum.sh'), '2', '3'], { encoding: 'utf8' }).stdout, '5\\n');",
  nodeModules: "assert.equal(node(at('../../tools/sum.mjs'), '2', '3'), '5\\n');",
  mixed: "assert.equal(node(at('../../tools/sum.mjs'), '3', '4'), '7\\n');",
};
const TEST_SOURCE = [
  "import assert from 'node:assert/strict';",
  "import { spawnSync } from 'node:child_process';",
  "import test from 'node:test';",
  "import { fileURLToPath } from 'node:url';",
  "import { twice } from '../../tools/chain.mjs';",
  "import { half } from '../../tools/lib.mjs';",
  '',
  'const at = (path) => fileURLToPath(new URL(path, import.meta.url));',
  "const node = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8' }).stdout;",
  '',
  ...Object.keys(CRITERIA).flatMap((key) => [`test(${JSON.stringify(NAMES[key])}, () => {`, `  ${BODIES[key]}`, '});', '']),
].join('\n');

const sum = (line) => ['const [a, b] = process.argv.slice(2).map(Number);', line, 'process.stdout.write(`${value}\\n`);', ''].join('\n');
const print = (text) => `process.stdout.write(${JSON.stringify(`${text}\n`)});\n`;
const FILES = {
  testFile: 'tests/unit/count.test.mjs',
  imported: 'tests/tools/lib.mjs',
  throughImport: 'tests/tools/deep.mjs',
  data: 'tests/__fixtures__/make.mjs',
  acceptance: `${DIR}/tool.mjs`,
  nonCode: 'tests/tools/sum.sh',
  nodeModules: 'node_modules/sumlib/index.mjs',
  sum: 'tests/tools/sum.mjs',
};
const RIGHT = {
  [FILES.testFile]: "import assert from 'node:assert/strict';\n\nassert.equal(1 + 1, 2);\n",
  [FILES.imported]: 'export const half = (n) => n / 2;\n',
  'tests/tools/chain.mjs': "export { twice } from './deep.mjs';\n",
  [FILES.throughImport]: 'export const twice = (n) => n * 2;\n',
  [FILES.data]: print('fixture'),
  [FILES.acceptance]: print('tool'),
  [FILES.nonCode]: 'echo $(($1 + $2))\n',
  [FILES.sum]: sum('const value = a + b;'),
};
const WRONG = {
  [FILES.testFile]: "import assert from 'node:assert/strict';\n\nassert.equal(1 + 1, 3);\n",
  [FILES.imported]: 'export const half = (n) => n / 3;\n',
  [FILES.throughImport]: 'export const twice = (n) => n * 3;\n',
  [FILES.data]: print('wrong'),
  [FILES.acceptance]: print('wrong'),
  [FILES.nonCode]: 'echo $(($1 + $2 + 1))\n',
  [FILES.nodeModules]: 'export const sum = (a, b) => a + b + 1;\n',
  [FILES.sum]: sum('const value = a + b + 1;'),
};
const TWINS = {
  testFile: { name: 'replaces-test-file', files: [FILES.testFile] },
  imported: { name: 'imported-helper', files: [FILES.imported] },
  throughImport: { name: 'imported-twice-removed', files: [FILES.throughImport] },
  data: { name: 'fixture-data', files: [FILES.data] },
  acceptance: { name: 'acceptance-tool', files: [FILES.acceptance] },
  nonCode: { name: 'shell-adds-one', files: [FILES.nonCode] },
  nodeModules: { name: 'installed-package', files: [FILES.nodeModules] },
  mixed: { name: 'sum-and-helper', files: [FILES.sum, FILES.imported] },
};
const REFUSED = { ...Object.fromEntries(Object.entries(TWINS).map(([key, { files }]) => [key, files])), mixed: [FILES.imported] };

let shared;
function lane(t) {
  if (!shared) {
    const box = sandbox(t);
    const twinFiles = Object.fromEntries(Object.values(TWINS).flatMap(({ name, files }) => files.map((file) => [`${DIR}/twins/${name}/${file}`, WRONG[file]])));
    const cwd = repository(box, {
      base: { [FILES.sum]: WRONG[FILES.sum] },
      change: {
        ...RIGHT,
        [TEST_PATH]: TEST_SOURCE,
        ...twinFiles,
        [`${DIR}/twins.json`]: json(Object.fromEntries(Object.entries(TWINS).map(([key, { name }]) => [ID[key], [name]]))),
      },
      message: `Fix the test tools\n\nPart of #9689`,
    });
    shared = beforeLane(box, cwd, Object.values(CRITERIA));
  }
  return shared;
}

const refusedCase = (key) => (t) => {
  const result = lane(t);
  ranToEnd(result);
  refusedNaming(result, named(TEST_PATH, NAMES[key]), TWINS[key].name, REFUSED[key]);
};

test('#3689.13ba22c1 a twin that replaces a test file, one its tagged test spawns but does not import, is refused and its FAIL before line names the file', LONG, refusedCase('testFile'));

test('#3689.13ba22c1 a twin that replaces a helper the tagged test imports directly is refused and its FAIL before line names the helper', LONG, refusedCase('imported'));

test('#3689.13ba22c1 a twin that replaces a helper the tagged test imports through another helper is refused and its FAIL before line names the helper', LONG, refusedCase('throughImport'));

test('#3689.13ba22c1 a twin that replaces a code file under a __fixtures__ folder, test data the tagged test spawns, is refused and its FAIL before line names the file', LONG, refusedCase('data'));

test('#3689.13ba22c1 a twin that replaces a code file under tests/acceptance/ that the tagged test spawns is refused and its FAIL before line names the file', LONG, refusedCase('acceptance'));

test('#3689.13ba22c1 a twin that replaces a non-code file under the test paths, a shell script the tagged test runs, is refused and its FAIL before line names the file', LONG, refusedCase('nonCode'));

test('#3689.13ba22c1 a twin that replaces a file under node_modules is refused and its FAIL before line names the file', LONG, refusedCase('nodeModules'));

test('#3689.13ba22c1 a twin that replaces both an admissible spawned tool and an imported helper is refused whole, its FAIL before line naming the helper', LONG, refusedCase('mixed'));
