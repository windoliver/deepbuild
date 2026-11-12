// #1718 AC3: "A planted `deep-show canvas` that stamps `at` again fails the first criterion, naming the op."
//
// Blind redraft after #1720 (REDRAFT.md). #1718's test holds the installed tree's own canvas core to criterion 1's
// check for every op, against `deep-show run` holding no packs, so the plant's failure is the stamp's and nothing else's.
// Under #1720 the hub of a release installs "the first-party packs that ship in its release" into its canvas core, so
// that clean half's reference now holds them: the checkout's first-party packs (each folder of `packs/` with a
// pack.json, what a release of this checkout ships), offered as `{id: "deepbuild/<name>", dir}` to the canvas core the
// tree ships and kept when its own pack check installs them (helpers.ts, `held`). The planted half is #1718's as it is.
//
// asserts: an installed tree (#41's scripts/install-prefix.mjs), whose hub runs the canvas core shipped beside its code,
// is run twice in fresh homes, each with a Claude Code session bound by its hooks and its own `deep mcp`. With the
// installed canvas core replaced by the planted one (#1718's fixtures/stamps-at.mjs), criterion 1's check (#1718's
// helpers.ts, kindsFailures) fails for every op of criterion 1, a failure naming the op and the refusal at
// `/params/arguments/at`, and the plant's log shows it stamped a deep_kinds call of that op. The same tree with its own
// canvas core passes the same check for every op, against `deep-show run` with the shipped packs installed.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, h1718, openSession, references } from './helpers.ts';

const built = h1718.useCanvasCore();
let tree: h1718.Installed | undefined;
let laid = '';
beforeAll(() => {
  try {
    built();
    tree = h1718.install();
  } catch (error) {
    laid = String((error as Error).message ?? error);
  }
}, 1_800_000);
afterAll(cleanup, 60_000);

describe('AC3 a planted deep-show canvas that stamps at again fails the first criterion, naming the op (redraft 1720)', () => {
  it('AC3 the planted canvas core fails criterion 1 for every op, naming it; the same installed tree with its own canvas core passes against deep-show run with the shipped packs installed (redraft 1720)', async () => {
    expect(laid, 'the canvas core is built and the installed tree laid out').toBe('');
    const refs = references(tree!.core);

    // The installed tree with its own canvas core: criterion 1's check, as it runs on the checkout.
    const clean = await h1718.allFailures(await openSession(tree!.deep), refs);

    // The same tree, its canvas core planted.
    const { log } = h1718.plantStampsAt(tree!);
    const planted = await h1718.allFailures(await openSession(tree!.deep), refs);
    const stamps = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { call: string; op: string | null; at: number });
    for (const op of h1718.OPS) {
      expect(stamps.some((s) => s.call === 'deep_kinds' && s.op === op), `the planted canvas core stamped at on the hub's deep_kinds ${op} call: ${JSON.stringify(stamps).slice(0, 600)}`).toBe(true);
      const failures = planted.get(op)!;
      expect(failures.length, `criterion 1's check fails deep_kinds ${op} on the planted canvas core`).toBeGreaterThan(0);
      expect(failures.some((f) => f.startsWith(`deep_kinds ${op}:`) && f.includes('/params/arguments/at')), `a failure names ${op} and the stamped at: ${failures.join(' | ')}`).toBe(true);
    }

    expect(Object.fromEntries(clean), `criterion 1's check passes every op on the installed tree's own canvas core, against deep-show run holding ${refs.packs.map((p) => p.id).join(', ')}, so the plant's failure is the stamp's`).toEqual(Object.fromEntries(h1718.OPS.map((op) => [op, []])));
  }, 1_800_000);
});
