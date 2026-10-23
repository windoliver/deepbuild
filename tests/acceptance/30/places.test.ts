// AC16: where each failed test failed, read from the report file the runner requested, never from output. A Vitest
// test whose expect(total).toBe(12) at src/cart.test.ts:30 gets 11 is an assertion failure at that line; one that
// calls applyCoupon, which the checkout lacks, at src/cart.test.ts:41 is a TypeError there and no assertion
// failure, though it prints "AssertionError" itself first. A pytest test likewise: an AssertionError at its assert
// line apart from an AttributeError raised before one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { command, needPytest, openWorld, outputOf, project, VITEST, type World } from './helpers.ts';
import { everyTestFileFailureAnAssertion } from './wrong.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });

/** The criterion's assertion on the Vitest cart run: each failure's place and kind. */
function placesHold(r: CommandRun): void {
  const at30 = r.failures.find((f) => /totals the prices/.test(f.test));
  const at41 = r.failures.find((f) => /applies the coupon/.test(f.test));
  expect(at30, 'the failure of "totals the prices"').toMatchObject({ file: 'src/cart.test.ts', line: 30 });
  expect(at30!.assertion, 'src/cart.test.ts:30 is the framework\'s assertion failure').toBe(true);
  expect(at41, 'the failure of "applies the coupon"').toMatchObject({ file: 'src/cart.test.ts', line: 41 });
  expect(at41!.assertion, 'src/cart.test.ts:41, a TypeError thrown before any assertion, is no assertion failure').toBe(false);
  expect(`${at41!.message}\n${at41!.stack ?? ''}`, 'the error at line 41').toMatch(/TypeError/);
}

describe('AC16 #30.160d61f9 an assertion failure at its expect line apart from a TypeError at a missing call, read from the report file, never from output', () => {
  it('AC16 the Vitest cart suite records an assertion failure at src/cart.test.ts:30 and a TypeError, no assertion failure, at src/cart.test.ts:41, though that test printed "AssertionError" itself', async () => {
    const r = await runCommandCheck(command(world.sup, project('cart'), VITEST));
    expect(r.outcome).toBe('failed');
    expect(outputOf(r), 'the line-41 test printed the word itself').toMatch(/AssertionError: expected 11 to be 12/);
    expect(r.failures).toHaveLength(2);
    placesHold(r);
  }, 180_000);

  it('AC16 (wrong program) a runner that marks every failure inside a test file an assertion failure fails this test on line 41', async () => {
    const r = await runCommandCheck(command(world.sup, project('cart'), VITEST));
    expect(() => placesHold(everyTestFileFailureAnAssertion(r))).toThrow(/src\/cart\.test\.ts:41/);
  }, 180_000);

  it('AC16 a pytest suite records an AssertionError at its assert line, test_cart.py:10, apart from an AttributeError raised at test_cart.py:16 before its assert', async () => {
    needPytest();
    const r = await runCommandCheck(command(world.sup, project('pytest-cart'), 'python3 -m pytest'));
    const total = r.failures.find((f) => /test_total/.test(f.test));
    const coupon = r.failures.find((f) => /test_coupon/.test(f.test));
    expect(total).toMatchObject({ file: 'test_cart.py', line: 10, assertion: true });
    expect(coupon).toMatchObject({ file: 'test_cart.py', line: 16, assertion: false });
    expect(`${coupon!.message}\n${coupon!.stack ?? ''}`).toMatch(/AttributeError/);
  }, 180_000);
});
