// #1832 criterion 2: the before lane, `node scripts/proof.mjs before` from this checkout, run in scratch repositories
// whose tagged tests pass on the merge base, so each is proven only by the twin its criterion names, and whose twins
// are kept as lines (README: The line form). A twin whose lines match nowhere, or in two places, is never laid: the
// lane says BLOCKED, naming the twin and the file, and the run fails.
import assert from 'node:assert/strict';
import test from 'node:test';
import { beforeLane, blockedFor, criterionId, json, LONG, named, notProven, provenOn, ranToEnd, repository, sandbox, show } from './helpers.mjs';

// The planted issue the fixture changes name, and its criteria.
const ISSUE = 9832;
const dir = `tests/acceptance/${ISSUE}`;
const CRITERIA = { total: 'A total counts each item as many times as its count', discount: 'A discount comes off the price', shipping: 'Shipping is free from fifty' };
const ID = Object.fromEntries(Object.entries(CRITERIA).map(([key, text]) => [key, criterionId(ISSUE, text)]));

// The code under test of the fixtures, right on main: the tests pass on the merge base.
const PRICE = `// Prices in cents.
export function total(items) {
  let sum = 0;
  for (const item of items) sum += item.cents * item.count;
  return sum;
}

export function discounted(cents, percent) {
  const off = Math.round((cents * percent) / 100);
  return cents - off;
}

export function shipping(cents) {
  if (cents >= 5000) return 0;
  return 499;
}

export function handling(cents) {
  if (cents >= 5000) return 0;
  return 150;
}
`;
const TAX = `// Tax in cents, at a rate in percent.
export function tax(cents, rate) {
  return Math.round((cents * rate) / 100);
}
`;

const TOTAL = { path: `${dir}/total.test.mjs`, name: `${ID.total} two items at 250 total 500` };
const DISCOUNT = { path: `${dir}/discount.test.mjs`, name: `${ID.discount} ten percent off 1000 is 900` };
const SHIPPING = { path: `${dir}/shipping.test.mjs`, name: `${ID.shipping} an order of 6000 ships free` };
const source = ({ name }, body) => `import assert from 'node:assert/strict';
import test from 'node:test';
import { discounted, shipping, total } from '../../../src/price.mjs';

test(${JSON.stringify(name)}, () => {
  ${body}
});
`;
const TESTS = {
  [TOTAL.path]: source(TOTAL, 'assert.equal(total([{ cents: 250, count: 2 }]), 500);'),
  [DISCOUNT.path]: source(DISCOUNT, 'assert.equal(discounted(1000, 10), 900);'),
  [SHIPPING.path]: source(SHIPPING, 'assert.equal(shipping(6000), 0);'),
};

// A twin as lines: each file's edits, the lines to find and the wrong lines that take their place.
const twin = (name, lines) => ({ [`${dir}/twins/${name}/lines.json`]: json(lines) });
const IGNORES_COUNT = { find: ['  for (const item of items) sum += item.cents * item.count;'], wrong: ['  for (const item of items) sum += item.cents;'] };
// Its first edit fits src/price.mjs and alone would fail the total test; its second names lines src/tax.mjs no
// longer holds, as after main moved on. Laid in part it would read as a proof; it is one twin, so it applies whole or not at all.
const STALE = 'tax-floors-stale';
const stale = twin(STALE, {
  'src/price.mjs': [IGNORES_COUNT],
  'src/tax.mjs': [{ find: ['  return Math.round(cents * rate * 0.01);'], wrong: ['  return Math.floor(cents * rate * 0.01);'] }],
});
// Two lines in a row, found once: the twin that fits, so the lane is shown to lay line twins at all.
const FITS = 'discount-adds';
const fits = twin(FITS, { 'src/price.mjs': [{ find: ['  const off = Math.round((cents * percent) / 100);', '  return cents - off;'], wrong: ['  const off = Math.round((cents * percent) / 100);', '  return cents + off;'] }] });
// Its line is in shipping() and in handling(): laid at the first, or at both, it would fail the shipping test.
const TWICE = 'free-from-five-thousand-twice';
const twice = twin(TWICE, { 'src/price.mjs': [{ find: ['  if (cents >= 5000) return 0;'], wrong: ['  if (cents >= 500000) return 0;'] }] });

let first;
// One run of the lane serves the two tests that read it.
function threeTwins(t) {
  if (!first) {
    const box = sandbox(t);
    const cwd = repository(box, {
      base: { 'src/price.mjs': PRICE, 'src/tax.mjs': TAX },
      change: { ...TESTS, ...stale, ...fits, ...twice, [`${dir}/twins.json`]: json({ [ID.total]: [STALE], [ID.discount]: [FITS], [ID.shipping]: [TWICE] }) },
      message: `Test the prices\n\nPart of #${ISSUE}`,
    });
    first = beforeLane(box, cwd, ISSUE, Object.values(CRITERIA));
  }
  return first;
}

test('#1832.6c8186e3 a twin whose wrong lines match nowhere in a file reads BLOCKED in the before lane, naming the twin and the file, and is laid nowhere, while a twin whose lines fit proves its test', LONG, (t) => {
  const result = threeTwins(t);
  ranToEnd(result);
  assert.ok(blockedFor(result, STALE, 'src/tax.mjs').length, `no BLOCKED before line names the twin ${STALE} and the file src/tax.mjs, whose lines it no longer matches\n${show(result)}`);
  notProven(result, named(TOTAL.path, TOTAL.name));
  assert.equal(result.status, 1, `the run with a twin that was never laid did not fail\n${show(result)}`);
  provenOn(result, named(DISCOUNT.path, DISCOUNT.name), FITS);
  assert.deepEqual(blockedFor(result, FITS, ''), [], `the twin whose lines fit reads BLOCKED\n${show(result)}`);
});

test('#1832.6c8186e3 a twin whose wrong lines match in two places reads BLOCKED in the before lane, naming the twin and the file, and is laid at neither', LONG, (t) => {
  const result = threeTwins(t);
  ranToEnd(result);
  assert.ok(blockedFor(result, TWICE, 'src/price.mjs').length, `no BLOCKED before line names the twin ${TWICE} and the file src/price.mjs, where its lines match twice\n${show(result)}`);
  notProven(result, named(SHIPPING.path, SHIPPING.name));
});

test('#1832.6c8186e3 a lane run that would pass by skipping a twin whose lines no longer match fails: it reads BLOCKED, naming the twin and the file, though another twin of the criterion fails the test', LONG, (t) => {
  // The total criterion names two twins. The first fits and fails the test, so a lane that drops the second and goes
  // on reads PASS and exits 0.
  const KILLS = 'total-ignores-count', GONE = 'total-starts-at-one-stale';
  const box = sandbox(t);
  const cwd = repository(box, {
    base: { 'src/price.mjs': PRICE },
    change: {
      [TOTAL.path]: TESTS[TOTAL.path],
      ...twin(KILLS, { 'src/price.mjs': [IGNORES_COUNT] }),
      ...twin(GONE, { 'src/price.mjs': [{ find: ['  let sum = 0.0;'], wrong: ['  let sum = 1.0;'] }] }),
      [`${dir}/twins.json`]: json({ [ID.total]: [KILLS, GONE] }),
    },
    message: `Test the total\n\nPart of #${ISSUE}`,
  });
  const result = beforeLane(box, cwd, ISSUE, [CRITERIA.total]);
  ranToEnd(result);
  assert.ok(blockedFor(result, GONE, 'src/price.mjs').length, `no BLOCKED before line names the twin ${GONE} and the file src/price.mjs: the twin was skipped\n${show(result)}`);
  assert.equal(result.status, 1, `the run that skipped a twin did not fail\n${show(result)}`);
});
