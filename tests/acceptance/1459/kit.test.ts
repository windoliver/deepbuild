// AC4: a replacement view that draws no handle passes `needs-you@1`, and a planted one that hides the oldest ask still
// fails, naming the ask. The kit runs as `deep install` runs a view's kit, in the replica, on the kit's own fixture record
// (#338's): `deep-replica --view-kit needs-you@1 <dir>` (README, Pinned 5). The views are fixtures/views.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../16/helpers.ts';
import { FIXTURES, ID, openAsks, RECORD_338, requireMacos, viewKit } from './helpers.ts';

afterAll(() => cleanup(), 60_000);
const MIN = 60_000;
const GOOD = join(FIXTURES, 'views', 'needs-you-by-id');
const HIDES_OLDEST = join(FIXTURES, 'views', 'hides-oldest');

describe(`AC4 ${ID.kit} A replacement view that draws no handle passes \`needs-you@1\`, and a planted one that hides the oldest ask still fails, naming the ask`, () => {
  it('AC4 a view keying each row by its ask and drawing its question, never its handle, passes needs-you@1', async () => {
    requireMacos();
    // The view as written draws each ask's question and no handle: its only drawn text per row is `ask.question`.
    expect(readFileSync(join(GOOD, 'main.js'), 'utf8')).toMatch(/\.child\(ask\.question\)/);
    const kit = await viewKit(GOOD);
    expect(kit.verdict, `deep-replica --view-kit needs-you@1 gives a verdict (README, Pinned 5): ${kit.said}`).not.toBeNull();
    expect(kit.verdict).toEqual({ result: 'pass' });
    expect(kit.code, 'a passing kit exits 0').toBe(0);
  }, 30 * MIN);

  it('AC4 wrong program: the same view hiding the oldest open ask fails needs-you@1, naming that ask', async () => {
    requireMacos();
    const oldest = openAsks(RECORD_338)[0]!;
    const kit = await viewKit(HIDES_OLDEST);
    expect(kit.verdict, `deep-replica --view-kit needs-you@1 gives a verdict (README, Pinned 5): ${kit.said}`).not.toBeNull();
    expect(kit.verdict?.result).toBe('fail');
    expect(kit.verdict?.names, 'the kit names the oldest open ask, the one hidden').toBe(oldest.handle);
    expect(kit.code, 'a failing kit exits 1').toBe(1);
  }, 30 * MIN);
});
