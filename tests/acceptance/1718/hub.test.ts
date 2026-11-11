// AC1: "Through a running hub and `deep mcp`, with a session bound by its hooks: `deep_kinds` with each of `sheet`,
// `list`, `search` (query `box`), `word` (`BoxGeometry`), `gallery` and `read` (the gallery's first hash) answers without
// `isError`. Each reply equals, apart from `core` and `set_digest`, the reply `deep-show run` gives the same call. On the
// merge base every op fails with `unlisted_field` at `/params/arguments/at`, and the test names that op."
//
// AC2: "An argument the agent really sends that its op doesn't take, such as `cursor` on `word`, is still refused with
// `unlisted_field` at its own path."
//
// asserts: AC1: one test per op, through the checkout's `deep hub run` in a temporary HOME, a Claude Code session the hub
// recorded from its hooks, and that agent's own `deep mcp`: the tool result is not isError, and every field of its value
// but `core` and `set_digest` equals the reply of `deep-show run` (the same binary the hub runs as its canvas core) to the
// same call; every failure names the op (helpers.ts, kindsFailures). AC2: `deep_kinds {op: word, word: BoxGeometry,
// cursor}` through the same `deep mcp` is a tool error, error@2, code `unlisted_field`, path `/params/arguments/cursor`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKOUT_DEEP, OPS, argsOf, checkoutCore, cleanup, kindsFailures, kindsOverMcp, openSession, references, t26, useCanvasCore, type Live } from './helpers.ts';

const built = useCanvasCore();
let live: Live | undefined;
let refs: ReturnType<typeof references> | undefined;
let opened = '';
beforeAll(async () => {
  try {
    built();
    refs = references(checkoutCore());
    live = await openSession(CHECKOUT_DEEP);
  } catch (error) {
    opened = String((error as Error).message ?? error);
  }
}, 900_000);
afterAll(cleanup, 60_000);
const world = (): { live: Live; refs: NonNullable<typeof refs> } => {
  expect(opened, 'the hub, the session bound by its hooks, its deep mcp and the reference replies of deep-show run').toBe('');
  return { live: live!, refs: refs! };
};

describe('AC1 through a running hub and deep mcp, with a session bound by its hooks, deep_kinds answers each op as deep-show run does', () => {
  // sheet, list, search and word are replaced by tests/acceptance/1718-redraft-1720/ (#1720 installs the shipped packs).
  for (const op of OPS.filter((op) => op === 'gallery' || op === 'read')) {
    it(`AC1 deep_kinds ${op} answers without isError, its reply equal to deep-show run's apart from core and set_digest`, async () => {
      const { live, refs } = world();
      const got = await kindsOverMcp(live.agent, argsOf(op, refs.firstHash));
      expect(kindsFailures(op, got, refs.replies.get(op)!), `deep_kinds ${op} through the hub and deep mcp`).toEqual([]);
    }, 600_000);
  }
});

describe('AC2 an argument the agent really sends that its op does not take is still refused at its own path', () => {
  it('AC2 cursor on word is refused with unlisted_field at /params/arguments/cursor', async () => {
    const { live } = world();
    const o = await kindsOverMcp(live.agent, { op: 'word', word: 'BoxGeometry', cursor: 'abc' });
    const e = t26.errorOf(o, 'deep_kinds word with a cursor');
    expect([e.code, e.path], `deep_kinds word with a cursor is refused at the cursor, its own path: ${JSON.stringify(e).slice(0, 400)}`).toEqual(['unlisted_field', '/params/arguments/cursor']);
  }, 600_000);
});
