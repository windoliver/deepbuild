// AC3: "A planted `deep-show canvas` that stamps `at` again fails the first criterion, naming the op."
//
// asserts: an installed tree (#41's scripts/install-prefix.mjs), whose hub runs the canvas core shipped beside its code,
// is run twice in fresh homes, each with a Claude Code session bound by its hooks and its own `deep mcp`. With the
// installed canvas core replaced by the planted one (fixtures/stamps-at.mjs: the same binary, every call but deep_query,
// geometry and fn stamped with `at` on its way in, as the merge base's CanvasSide::scenario does), criterion 1's check
// (helpers.ts, kindsFailures) fails for every op of criterion 1, a failure naming the op and the refusal at
// `/params/arguments/at`, and the plant's log shows it stamped a deep_kinds call of that op. The same tree with its own
// canvas core passes the same check for every op, so the failure is the stamp's and nothing else's.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OPS, allFailures, cleanup, install, openSession, plantStampsAt, references, useCanvasCore, type Installed } from './helpers.ts';

const built = useCanvasCore();
let tree: Installed | undefined;
let laid = '';
beforeAll(() => {
  try {
    built();
    tree = install();
  } catch (error) {
    laid = String((error as Error).message ?? error);
  }
}, 1_800_000);
afterAll(cleanup, 60_000);

describe('AC3 a planted deep-show canvas that stamps at again fails the first criterion, naming the op', () => {
  it('AC3 the planted canvas core fails criterion 1 for every op, naming it; the same installed tree with its own canvas core passes', async () => {
    expect(laid, 'the canvas core is built and the installed tree laid out').toBe('');
    const refs = references(tree!.core);

    // The installed tree with its own canvas core: criterion 1's check, as it runs on the checkout.
    const clean = await allFailures(await openSession(tree!.deep), refs);

    // The same tree, its canvas core planted.
    const { log } = plantStampsAt(tree!);
    const planted = await allFailures(await openSession(tree!.deep), refs);
    const stamps = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { call: string; op: string | null; at: number });
    for (const op of OPS) {
      expect(stamps.some((s) => s.call === 'deep_kinds' && s.op === op), `the planted canvas core stamped at on the hub's deep_kinds ${op} call: ${JSON.stringify(stamps).slice(0, 600)}`).toBe(true);
      const failures = planted.get(op)!;
      expect(failures.length, `criterion 1's check fails deep_kinds ${op} on the planted canvas core`).toBeGreaterThan(0);
      expect(failures.some((f) => f.startsWith(`deep_kinds ${op}:`) && f.includes('/params/arguments/at')), `a failure names ${op} and the stamped at: ${failures.join(' | ')}`).toBe(true);
    }

    expect(Object.fromEntries(clean), "criterion 1's check passes every op on the installed tree's own canvas core, so the plant's failure is the stamp's").toEqual(Object.fromEntries(OPS.map((op) => [op, []])));
  }, 1_800_000);
});
