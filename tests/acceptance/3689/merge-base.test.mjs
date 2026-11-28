import assert from 'node:assert/strict';
import test from 'node:test';
import { beforeLane, DIR, ids, LONG, linesFor, named, ranToEnd, repository, sandbox, show } from './helpers.mjs';

const CRITERIA = { sum: 'The sum tool adds its two numbers', render: 'The render tool prints the total as its golden holds it' };
const ID = ids(CRITERIA);

const TEST_PATH = `${DIR}/tools.test.mjs`;
const SUM = { path: TEST_PATH, name: `${ID.sum} two and three sum to five` };
const RENDER = { path: TEST_PATH, name: `${ID.render} the rendered total matches its golden` };
const TEST_SOURCE = [
  "import assert from 'node:assert/strict';",
  "import { spawnSync } from 'node:child_process';",
  "import { readFileSync } from 'node:fs';",
  "import test from 'node:test';",
  "import { fileURLToPath } from 'node:url';",
  '',
  'const at = (path) => fileURLToPath(new URL(path, import.meta.url));',
  "const node = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8' }).stdout;",
  '',
  `test(${JSON.stringify(SUM.name)}, () => {`,
  "  assert.equal(node(at('../../tools/sum.mjs'), '2', '3'), '5\\n');",
  '});',
  '',
  `test(${JSON.stringify(RENDER.name)}, () => {`,
  "  assert.equal(node(at('../../tools/render.mjs'), '2', '3'), readFileSync(at('../../goldens/render.txt'), 'utf8'));",
  '});',
  '',
].join('\n');

const tool = (line) => ['const [a, b] = process.argv.slice(2).map(Number);', line, ''].join('\n');

let shared;
function lane(t) {
  if (!shared) {
    const box = sandbox(t);
    const cwd = repository(box, {
      base: {
        'tests/tools/sum.mjs': tool('process.stdout.write(`${a + b + 1}\\n`);'),
        'tests/tools/render.mjs': tool('process.stdout.write(`sum=${a + b}\\n`);'),
        'tests/goldens/render.txt': 'sum=5\n',
      },
      change: {
        'tests/tools/sum.mjs': tool('process.stdout.write(`${a + b}\\n`);'),
        'tests/tools/render.mjs': tool('process.stdout.write(`total: ${a + b}\\n`);'),
        'tests/goldens/render.txt': 'total: 5\n',
        [TEST_PATH]: TEST_SOURCE,
      },
      message: `Fix the sum tool and the render format\n\nPart of #9689`,
    });
    shared = beforeLane(box, cwd, Object.values(CRITERIA));
  }
  return shared;
}

const passedOnBase = (result, key) => {
  const lines = linesFor(result, key);
  assert.ok(lines.length, `the before lane names no ${key}\n${show(result)}`);
  assert.deepEqual(lines, [`FAIL before: ${key}: passed on the merge base`], `${key}, whose fix lives in a spawned file under the test paths and which has no twin, did not read passed on the merge base\n${show(result)}`);
};

test('#3689.273a215f a tagged test whose fix lives in a spawned code file under the test paths, with no twin, still reads passed on the merge base', LONG, (t) => {
  const result = lane(t);
  ranToEnd(result);
  passedOnBase(result, named(SUM.path, SUM.name));
});

test('#3689.273a215f a change that updates a spawned tool and the golden beside it, with no twin, has both laid on the merge base and reads passed on the merge base', LONG, (t) => {
  const result = lane(t);
  ranToEnd(result);
  passedOnBase(result, named(RENDER.path, RENDER.name));
  assert.equal(result.status, 1, `the before lane passed a run whose tagged tests failed on no wrong program\n${show(result)}`);
});
