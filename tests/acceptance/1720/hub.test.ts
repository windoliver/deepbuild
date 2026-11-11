// AC1: "Through a running hub and `deep mcp`, `packs/examples/castle.json` is presented with no `pack_missing` issue and
// no `unknown_kind` notice. On the merge base it is refused with `pack_missing`, and the test names the pack."
//
// AC2: "`deep_kinds word BoxGeometry` through `deep mcp` answers `familiar.box@1` with the pack's conversion text,
// byte-equal to `deep-show run`'s answer with the pack installed."
//
// AC3 (its first sentence; the plant is planted.test.ts): "Every folder under `packs/` with a `pack.json` is listed by
// `deep_kinds list` on a live hub, each with its version."
//
// asserts: all three through the checkout's `deep hub run` in a temporary HOME, a Claude Code session the hub recorded
// from its hooks, and that agent's own `deep mcp`, with nothing installed by hand. AC1: deep_show of castle.json as it is
// answers outcome `presented`, and nothing in the reply is a `pack_missing` (issue code or text) or an `unknown_kind`
// notice; a pack_missing failure names the pack IDs it holds (helpers.ts, castleFailures). AC2: deep_kinds `{op: word,
// word: BoxGeometry}` is not isError, its target is `familiar.box@1`, its conversion is the familiar pack.json's own
// text for BoxGeometry, and its JSON text equals that of `deep-show run`'s answer to the same call with the familiar
// pack in its store (`packs: [{id: deepbuild/familiar, dir: packs/familiar-1.0.0}]`) (wordFailures). AC3: following
// `next` through every page of `deep_kinds list`, each folder of the checkout's packs/ with a pack.json is named with the
// version its pack.json gives, as `deepbuild/<name>@<version>` (helpers.ts, listed).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHECKOUT_DEEP, CHECKOUT_PACKS, castleFailures, checkoutCore, cleanup, firstParty, kindsOverMcp, listed, listing, openSession, showCastle, useCanvasCore, wordFailures, wordOnRun, type Live } from './helpers.ts';

const built = useCanvasCore();
let live: Live | undefined;
let opened = '';
beforeAll(async () => {
  try {
    built();
    live = await openSession(CHECKOUT_DEEP);
  } catch (error) {
    opened = String((error as Error).message ?? error);
  }
}, 900_000);
afterAll(cleanup, 60_000);
const session = (): Live => {
  expect(opened, 'the hub, the session bound by its hooks and its deep mcp').toBe('');
  return live!;
};

describe('AC1 through a running hub and deep mcp, the castle example is presented', () => {
  it('AC1 packs/examples/castle.json is presented with no pack_missing issue and no unknown_kind notice', async () => {
    const o = await showCastle(session());
    expect(castleFailures(o), 'deep_show of packs/examples/castle.json through the hub and deep mcp').toEqual([]);
  }, 900_000);
});

describe('AC2 a familiar word through deep mcp answers as deep-show run does with the familiar pack installed', () => {
  it('AC2 deep_kinds word BoxGeometry answers familiar.box@1 with the pack conversion, byte-equal to deep-show run', async () => {
    const live = session();
    const want = wordOnRun(checkoutCore(), 'BoxGeometry');
    const got = await kindsOverMcp(live.agent, { op: 'word', word: 'BoxGeometry' });
    expect(wordFailures('BoxGeometry', got, want), 'deep_kinds word BoxGeometry through the hub and deep mcp').toEqual([]);
  }, 900_000);
});

describe('AC3 every first-party pack is listed by deep_kinds list on a live hub, with its version', () => {
  it('AC3 each folder of packs/ with a pack.json is listed by deep_kinds list with its version', async () => {
    const live = session();
    const packs = firstParty(CHECKOUT_PACKS);
    expect(packs.length, `the checkout's ${CHECKOUT_PACKS} holds first-party packs`).toBeGreaterThan(0);
    const { pages, failure } = await listing(live.agent);
    expect(failure, 'deep_kinds list answers every page through the hub and deep mcp').toBeUndefined();
    const missing = packs.filter((p) => !listed(pages, p)).map((p) => `${p.folder} (${p.ref})`);
    expect(missing, `deep_kinds list on the live hub (${pages.length} page(s)) lists each first-party pack with its version`).toEqual([]);
  }, 900_000);
});
