// #1718 AC1: "Through a running hub and `deep mcp`, with a session bound by its hooks: `deep_kinds` with each of
// `sheet`, `list`, `search` (query `box`), `word` (`BoxGeometry`), `gallery` and `read` (the gallery's first hash)
// answers without `isError`. Each reply equals, apart from `core` and `set_digest`, the reply `deep-show run` gives the
// same call. On the merge base every op fails with `unlisted_field` at `/params/arguments/at`, and the test names that
// op."
//
// Blind redraft after #1720 (REDRAFT.md), of the four ops whose reply the canvas core computes from the packs it holds:
// sheet, list, search and word. #1720: "The hub installs the first-party packs that ship in its release into its canvas
// core when the core starts, through the pack check". So `deep-show run`'s reference now holds the shipped first-party
// packs as the hub's canvas core holds them: each folder of `packs/` with a pack.json, offered as
// `{id: "deepbuild/<name>", dir}`, and kept when the canvas core's own pack check installs it (helpers.ts, `held`).
// gallery, read and #1718's AC2 are kept as they are, in tests/acceptance/1718/hub.test.ts.
//
// asserts: one test per op, through the checkout's `deep hub run` in a temporary HOME, a Claude Code session the hub
// recorded from its hooks, and that agent's own `deep mcp`: the tool result is not isError, and every field of its value
// but `core` and `set_digest` equals the reply of `deep-show run` (the binary the hub runs as its canvas core) to the
// same call with the shipped packs installed; every failure names the op (#1718's helpers.ts, kindsFailures).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, h1718, openSession, references } from './helpers.ts';

/** The ops of #1718's criterion 1 whose reply reads the packs the canvas core holds, in the criterion's order. */
const CHANGED = ['sheet', 'list', 'search', 'word'] as const;

const built = h1718.useCanvasCore();
let live: h1718.Live | undefined;
let refs: ReturnType<typeof references> | undefined;
let opened = '';
beforeAll(async () => {
  try {
    built();
    refs = references(h1718.checkoutCore());
    live = await openSession(h1718.CHECKOUT_DEEP);
  } catch (error) {
    opened = String((error as Error).message ?? error);
  }
}, 900_000);
afterAll(cleanup, 60_000);
const world = (): { live: h1718.Live; refs: NonNullable<typeof refs> } => {
  expect(opened, 'the hub, the session bound by its hooks, its deep mcp and the reference replies of deep-show run with the shipped packs installed').toBe('');
  return { live: live!, refs: refs! };
};

describe('AC1 through a running hub and deep mcp, with a session bound by its hooks, deep_kinds answers each op as deep-show run does with the shipped packs installed (redraft 1720)', () => {
  for (const op of CHANGED) {
    it(`AC1 deep_kinds ${op} answers without isError, its reply equal to deep-show run's with the shipped first-party packs installed, apart from core and set_digest (redraft 1720)`, async () => {
      const { live, refs } = world();
      const got = await h1718.kindsOverMcp(live.agent, h1718.argsOf(op, refs.firstHash));
      expect(h1718.kindsFailures(op, got, refs.replies.get(op)!), `deep_kinds ${op} through the hub and deep mcp, against deep-show run holding ${refs.packs.map((p) => p.id).join(', ')}`).toEqual([]);
    }, 600_000);
  }
});
