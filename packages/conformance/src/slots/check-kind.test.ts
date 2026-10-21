// The check.kind kit remembers its runs so the planted fills need not spawn the suite the reference already ran.
// A remembered run is evidence only of the checkout it ran on: the same folder with other contents, other modes
// or other bytes behind a link is another run. (The first invariant: a result stands in for nothing it did not see.)
import { chmodSync, cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanFills, slotKits } from '../index.js';
import type { CheckRunnerFill, CheckSpec } from '../slot-types.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/check-kind/', import.meta.url));
const spec: CheckSpec = { kind: 'command', runner: 'node --test --test-isolation=none spec/*.test.mjs', inputs: ['src/cart.mjs', 'spec/cart.test.mjs'], depth: 'unit', oracle: 'code', contract: null };
const PASSED = { outcome: 'passed', testsRun: 2, read: ['data/expected.json', 'spec/cart.test.mjs', 'src/cart.mjs'] };
const temps: string[] = [];
afterEach(() => { for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true }); });

/** A fresh copy of the known-pass suite in a temp folder (reached through a link on macOS) and the kit's reference fill. */
function knownPass(): { checkout: string; run: (checkout: string) => Promise<import('../slot-types.js').CheckResult> } {
  const checkout = mkdtempSync(join(tmpdir(), 'check-kind-'));
  temps.push(checkout);
  cpSync(join(FIXTURES, 'known-pass'), checkout, { recursive: true });
  const kit = slotKits().find((k) => k.slot === 'check.kind@1')!;
  const [fill] = cleanFills(kit) as CheckRunnerFill[];
  return { checkout, run: async (c) => fill!.run(spec, { checkout: c, deadline: 60_000, now: () => Date.now() }) };
}

describe('the reference runner on a checkout that changes between runs', () => {
  it('runs the suite again when a file\'s bytes changed, and reports the changed outcome', async () => {
    const { checkout, run } = knownPass();
    expect(await run(checkout)).toMatchObject(PASSED);
    // The cart now drops its last price, as the known-fail suite's does; both of this suite's tests fail.
    writeFileSync(join(checkout, 'src/cart.mjs'), 'export const total = (prices) => prices.slice(0, -1).reduce((sum, price) => sum + price, 0);\n');
    const second = await run(checkout);
    expect(second).toMatchObject({ outcome: 'failed', testsRun: 2 });
    expect(second.failures.map((f) => [f.file, f.assertion])).toEqual([['spec/cart.test.mjs', true], ['spec/cart.test.mjs', true]]);
  });

  it('runs the suite again when only a file\'s mode changed', async () => {
    const { checkout, run } = knownPass();
    expect(await run(checkout)).toMatchObject(PASSED);
    // The same bytes, unreadable: the suite can't load its module and crashes before any test.
    chmodSync(join(checkout, 'src/cart.mjs'), 0o000);
    const second = await run(checkout);
    chmodSync(join(checkout, 'src/cart.mjs'), 0o644);
    expect(second.outcome).toBe('failed');
    expect(second.testsRun).toBe(0);
  });

  it('runs the suite again when the bytes behind a link out of the checkout changed', async () => {
    const { checkout, run } = knownPass();
    const outside = mkdtempSync(join(tmpdir(), 'check-kind-outside-'));
    temps.push(outside);
    const record = join(outside, 'expected.json');
    writeFileSync(record, JSON.stringify({ prices: [20, 22], total: 42 }));
    rmSync(join(checkout, 'data/expected.json'));
    symlinkSync(record, join(checkout, 'data/expected.json'));
    expect(await run(checkout)).toMatchObject({ outcome: 'passed', testsRun: 2 });
    writeFileSync(record, JSON.stringify({ prices: [20, 22], total: 43 }));
    const second = await run(checkout);
    expect(second).toMatchObject({ outcome: 'failed', testsRun: 2 });
    expect(second.failures.map((f) => f.test)).toEqual(['matches the expected total on record']);
  });

  it('reports a checkout that is not there as missing', async () => {
    const { checkout, run } = knownPass();
    expect(await run(join(checkout, 'not-here'))).toMatchObject({ outcome: 'missing' });
  });
});
