// The check.kind kit remembers its runs so the planted fills need not spawn the suite the reference already ran.
// A remembered run is evidence only of the checkout it ran on: the same folder with other contents is another
// run. (The first invariant: a result stands in for nothing it did not see.)
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanFills, slotKits } from '../index.js';
import type { CheckRunnerFill, CheckSpec } from '../slot-types.js';

const FIXTURES = fileURLToPath(new URL('../../fixtures/check-kind/', import.meta.url));
const spec: CheckSpec = { kind: 'command', runner: 'node --test --test-isolation=none spec/*.test.mjs', inputs: ['src/cart.mjs', 'spec/cart.test.mjs'], depth: 'unit', oracle: 'code', contract: null };
const temps: string[] = [];
afterEach(() => { for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true }); });

describe('the reference runner on a checkout that changes between runs', () => {
  it('runs the suite again and reports the changed outcome, instead of answering from the earlier run', async () => {
    const checkout = mkdtempSync(join(tmpdir(), 'check-kind-'));
    temps.push(checkout);
    cpSync(join(FIXTURES, 'known-pass'), checkout, { recursive: true });
    const kit = slotKits().find((k) => k.slot === 'check.kind@1')!;
    const [fill] = cleanFills(kit) as CheckRunnerFill[];
    const ctx = { checkout, deadline: 60_000, now: () => Date.now() };
    const first = await fill!.run(spec, ctx);
    // The temp folder is reached through a link on macOS; the read set is still relative to the checkout.
    expect(first).toMatchObject({ outcome: 'passed', testsRun: 2, read: ['data/expected.json', 'spec/cart.test.mjs', 'src/cart.mjs'] });
    // The cart now drops its last price, as the known-fail suite's does; both of this suite's tests fail.
    writeFileSync(join(checkout, 'src/cart.mjs'), 'export const total = (prices) => prices.slice(0, -1).reduce((sum, price) => sum + price, 0);\n');
    const second = await fill!.run(spec, ctx);
    expect(second).toMatchObject({ outcome: 'failed', testsRun: 2 });
    expect(second.failures.map((f) => [f.file, f.assertion])).toEqual([['spec/cart.test.mjs', true], ['spec/cart.test.mjs', true]]);
  });
});
