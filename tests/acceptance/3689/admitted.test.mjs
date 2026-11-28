import assert from 'node:assert/strict';
import test from 'node:test';
import { beforeLane, DIR, ids, json, LONG, named, provenOn, ranToEnd, repository, sandbox, show } from './helpers.mjs';

const CRITERIA = { sum: 'The sum tool adds its two numbers', product: 'The product tool multiplies its two numbers' };
const ID = ids(CRITERIA);

const tool = (line) => ['const [a, b] = process.argv.slice(2).map(Number);', line, 'process.stdout.write(`${value}\\n`);', ''].join('\n');
const SUM_RIGHT = tool('const value = a + b;');
const SUM_WRONG = tool('const value = a + b + 1;');
const PRODUCT_RIGHT = tool('const value = a * b;');
const PRODUCT_WRONG = tool('const value = a + b;');

const TEST_PATH = `${DIR}/tools.test.mjs`;
const SUM = { path: TEST_PATH, name: `${ID.sum} two and three sum to five` };
const PRODUCT = { path: TEST_PATH, name: `${ID.product} four times five is twenty` };
const TEST_SOURCE = [
  "import assert from 'node:assert/strict';",
  "import { spawnSync } from 'node:child_process';",
  "import test from 'node:test';",
  "import { fileURLToPath } from 'node:url';",
  '',
  'const tool = (name, ...args) => spawnSync(process.execPath, [fileURLToPath(new URL(`../../tools/${name}`, import.meta.url)), ...args], { encoding: \'utf8\' }).stdout;',
  '',
  `test(${JSON.stringify(SUM.name)}, () => {`,
  "  assert.equal(tool('sum.mjs', '2', '3'), '5\\n');",
  '});',
  '',
  `test(${JSON.stringify(PRODUCT.name)}, () => {`,
  "  assert.equal(tool('product.mjs', '4', '5'), '20\\n');",
  '});',
  '',
].join('\n');

const WHOLE = 'sum-adds-one';
const LINES = 'product-adds';

let shared;
function lane(t) {
  if (!shared) {
    const box = sandbox(t);
    const cwd = repository(box, {
      base: { 'tests/tools/sum.mjs': SUM_WRONG, 'tests/tools/product.mjs': PRODUCT_WRONG },
      change: {
        'tests/tools/sum.mjs': SUM_RIGHT,
        'tests/tools/product.mjs': PRODUCT_RIGHT,
        [TEST_PATH]: TEST_SOURCE,
        [`${DIR}/twins/${WHOLE}/tests/tools/sum.mjs`]: SUM_WRONG,
        [`${DIR}/twins/${LINES}/lines.json`]: json({ 'tests/tools/product.mjs': [{ find: ['const value = a * b;'], wrong: ['const value = a + b;'] }] }),
        [`${DIR}/twins.json`]: json({ [ID.sum]: [WHOLE], [ID.product]: [LINES] }),
      },
      message: `Fix the sum and product tools\n\nPart of #9689`,
    });
    shared = beforeLane(box, cwd, Object.values(CRITERIA));
  }
  return shared;
}

test('#3689.4455e965 a whole-file twin of a code file under the test paths that the tagged test spawns but does not import is laid, and the before lane proves the test on it', LONG, (t) => {
  const result = lane(t);
  ranToEnd(result);
  provenOn(result, named(SUM.path, SUM.name), WHOLE);
});

test('#3689.4455e965 a lines.json twin of a code file under the test paths that the tagged test spawns but does not import is laid, and the before lane proves the test on it', LONG, (t) => {
  const result = lane(t);
  ranToEnd(result);
  provenOn(result, named(PRODUCT.path, PRODUCT.name), LINES);
});

test('#3689.4455e965 a before run whose only twins replace spawned test-path code passes as a whole', LONG, (t) => {
  const result = lane(t);
  ranToEnd(result);
  assert.equal(result.status, 0, `the before lane failed a run whose every tagged test failed on its admissible twin\n${show(result)}`);
});
