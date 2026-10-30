// AC1, #393's acceptance scenarios played against the hub and the app instead of the `deep-show` stand-in (README: Criterion 1).
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { run as standInRun, useShowBinary, cardFailures, decodePng, pixel, CARD, CARD_RECT, DOC, SESSIONS, PANELS, WINDOW, board, ALPHA } from '../393/helpers.ts';
import { expectReplayed } from './ac1.ts';
import { cleanup, requireMacos, tempDir, useApp, type JsonObject } from './helpers.ts';
import { openWorld, play } from './replay.ts';
import { ENTRIES_393, HOLDS, settle } from './scenarios.ts';

afterEach(cleanup, 60_000);
useShowBinary();
const appReady = useApp();
const standIn = (scenario: JsonObject): JsonObject[] => standInRun(scenario).replies;

describe('AC1 #393\'s and #384\'s acceptance scenarios, played against the hub and the app instead of the deep-show stand-in, give the same replies field for field (#393)', () => {
  it('AC1 #393 AC4, AC6: writer layers from the connection, the peer check inside each agent\'s tree, a call bound to no session, and payloads that name a layer or a writer give the stand-in\'s replies', async () => {
    await expectReplayed(ENTRIES_393['writer']!, standIn, appReady);
  }, 600_000);

  it('AC1 #393 AC5: bindings to the session\'s own handles and to another session\'s give the stand-in\'s replies, ref_unresolved naming the handle and no snapshot', async () => {
    await expectReplayed(ENTRIES_393['refs']!, standIn, appReady);
  }, 600_000);

  it('AC1 #393 AC7: whole revisions, removes and the diff give the stand-in\'s replies, the revisions by hash', async () => {
    await expectReplayed(ENTRIES_393['revisions']!, standIn, appReady);
  }, 600_000);

  it('AC1 #393 AC9: 5,000 unnamed marks refused give the stand-in\'s replies, the full list by its evidence hash compared by content', async () => {
    await expectReplayed(ENTRIES_393['issues']!, standIn, appReady);
  }, 900_000);

  it('AC1 #393 AC3: a settled snapshot never proves a claim that names another deliverable: the same results as the stand-in', async () => {
    await expectReplayed(ENTRIES_393['proof']!, standIn, appReady);
  }, 600_000);

  it('AC1 #393 AC2: deep_show on a hidden panel is not presented within 2 s, as the stand-in answers', async () => {
    await expectReplayed(ENTRIES_393['hidden']!, standIn, appReady);
  }, 600_000);

  for (const hold of HOLDS) {
    it(`AC1 #393 AC1: a frame held by ${hold} is waited for 1.5 s, and when it can't settle deep_show is not presented within 2 s and the check is BLOCKED, as the stand-in answers`, async () => {
      for (const [ms, via] of [[1_500, 'deep_show'], [10_000, 'deep_show'], [10_000, 'deep show --check']] as const) {
        await expectReplayed(settle(hold, ms, via), standIn, appReady);
        await cleanup();
      }
    }, 900_000);
  }

  it('AC1 #393 AC8: an agent document with the highest order key and bounds 100 times the window leaves the question card\'s interior equal to its isolated render in the app\'s window', async () => {
    requireMacos();
    appReady();
    const INSET = 16;
    const [W, H] = WINDOW;
    const flood = board('Flood', [W, H], [{ id: 'flood', kind: 'rect@1', name: 'Flood', order: 'zzzzzzzz', params: { box: [-50 * W, -50 * H, 100 * W, 100 * H], paint: { fill: { role: 'ink' } } } }]);
    const scenario = (calls: JsonObject[]): JsonObject => ({
      evidence: tempDir(), sessions: SESSIONS, panels: PANELS, docs: { [DOC.a]: { panel: 'main' } }, window: WINDOW, card: CARD,
      calls,
    });
    const windowOf = async (calls: JsonObject[], name: string) => {
      const s = scenario(calls);
      const opened = await openWorld({ scenario: s, app: true });
      const played = await play(s, opened);
      await opened.app!.sync();
      const out = join(opened.tmp, `${name}.png`);
      const answer = await opened.app!.call({ call: 'screen', out });
      const items = (answer['items'] as JsonObject[]).map((i) => ({ id: String(i['id']), layer: i['layer'] ?? null, box: i['box'] as [number, number, number, number] }));
      return { image: decodePng(readFileSync(out)), replies: played.replies, items };
    };
    const isolated = await windowOf([], 'isolated');
    const full = await windowOf([{ call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: flood, include: ['issues'] }], 'full');
    expect(full.replies[0]!['outcome'], 'the agent\'s document is presented').toBe('presented');
    const [x, y] = [CARD_RECT[0] - 40, CARD_RECT[1] + 40];
    expect(pixel(full.image, x, y), 'beside the card the agent\'s document draws').not.toEqual(pixel(isolated.image, x, y));
    expect(cardFailures(full, isolated, CARD_RECT, INSET), 'every interior pixel of the card is its isolated render\'s').toEqual([]);
  }, 600_000);
});
