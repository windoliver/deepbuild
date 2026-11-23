// #1832 criterion 3: the lint, `node scripts/twins-lint.mjs [--root <checkout>]` from this checkout, on scratch
// checkouts and on this one (README: The lint). A whole-file twin is a twin a suite's twins.json names whose folder
// holds any file other than its lines.json.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, criterionId, json, lint, listed, repository, sandbox, show, twinsOf } from './helpers.mjs';

const LINES = json({ 'src/a.mjs': [{ find: ['export const a = 1;'], wrong: ['export const a = 2;'] }] });
const suite = (number, twins, files) => ({
  [`tests/acceptance/${number}/twins.json`]: json(Object.fromEntries(Object.entries(twins).map(([text, names]) => [criterionId(number, text), names]))),
  ...Object.fromEntries(Object.entries(files).map(([path, content]) => [`tests/acceptance/${number}/twins/${path}`, content])),
});
const SOURCE = { 'src/a.mjs': 'export const a = 1;\n', 'tests/acceptance/9003/plain.test.mjs': "import test from 'node:test';\n\ntest('nothing planted', () => {});\n" };
// A twins folder no twins.json names holds a suite's own fixtures, as #1830's does: the lane lays none of it.
const FIXTURES_ONLY = { 'tests/acceptance/9004/twins/plants/case.mjs.txt': 'export const planted = true;\n' };

test('#1832.49f466eb the lint lists every whole-file twin the suites name, each once, and no twin kept as its lines alone', (t) => {
  const box = sandbox(t);
  const root = repository(box, {
    base: {
      ...SOURCE, ...FIXTURES_ONLY,
      // whole-a is named under two criteria; mixed-c keeps lines and a whole file beside them.
      ...suite(9001, { one: ['whole-a', 'lines-b'], two: ['mixed-c', 'whole-a', 'lines-b'] }, {
        'whole-a/src/a.mjs': 'export const a = 2;\n',
        'lines-b/lines.json': LINES,
        'mixed-c/lines.json': LINES,
        'mixed-c/src/c.mjs': 'export const c = 3;\n',
      }),
      ...suite(9002, { one: ['whole-d'] }, { 'whole-d/src/a.mjs': 'export const a = 4;\n', 'whole-d/lib/deep/e.mjs': 'export const e = 5;\n' }),
    },
  });
  const result = lint(box, ['--root', root]);
  assert.deepEqual(listed(result).sort(), ['tests/acceptance/9001/twins/mixed-c', 'tests/acceptance/9001/twins/whole-a', 'tests/acceptance/9002/twins/whole-d'], `the lint's FAIL twins lines do not list the three whole-file twins, each once\n${show(result)}`);
  assert.equal(result.status, 1, `the lint listed whole-file twins and did not exit 1\n${show(result)}`);
  assert.doesNotMatch(result.stdout, /^PASS twins$/m, show(result));
});

test('#1832.49f466eb the lint lists nothing and reads PASS once every twin the suites name is kept as its lines', (t) => {
  const box = sandbox(t);
  const root = repository(box, {
    base: {
      ...SOURCE, ...FIXTURES_ONLY,
      ...suite(9001, { one: ['lines-a', 'lines-b'], two: ['lines-b'] }, { 'lines-a/lines.json': LINES, 'lines-b/lines.json': LINES }),
      ...suite(9002, { one: ['lines-d'] }, { 'lines-d/lines.json': LINES }),
    },
  });
  const result = lint(box, ['--root', root]);
  assert.match(result.stdout, /^PASS twins$/m, `the lint gave no PASS twins line for a checkout with no whole-file twin\n${show(result)}`);
  assert.deepEqual(listed(result), [], show(result));
  assert.doesNotMatch(result.stdout, /^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE) /m, show(result));
  assert.equal(result.status, 0, show(result));
});

test("#1832.49f466eb on this checkout the lint lists none of #25's and #27's twins, and each is there, kept as its lines", (t) => {
  const box = sandbox(t);
  const result = lint(box);
  // The lint ran and judged: its one PASS line and exit 0, or its FAIL lines and exit 1. Other suites' whole-file
  // twins are left for later changes, so either may be true here (README: What this suite does not prove).
  const found = listed(result);
  assert.ok(found.length ? result.status === 1 : result.status === 0 && /^PASS twins$/m.test(result.stdout), `the lint did not run to a verdict on this checkout\n${show(result)}`);
  const converted = [...twinsOf('25'), ...twinsOf('27')];
  assert.deepEqual(found.filter((folder) => converted.some((twin) => twin.folder === folder)), [], `the lint lists twins of #25 or #27 as whole files\n${show(result)}`);
  // A twin taken away would be listed by no lint either: each is still there, with its lines.
  for (const twin of converted) assert.ok(existsSync(join(CHECKOUT, twin.folder, 'lines.json')), `${twin.folder} holds no lines.json`);
});
