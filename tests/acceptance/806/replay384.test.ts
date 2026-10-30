// AC1, #384's acceptance scenarios played against the hub and the app instead of the `deep-show` stand-in (README: Criterion 1).
import { afterEach, describe, it } from 'vitest';
import { run as standInRun, useShowBinary, type JsonObject } from '../393/helpers.ts';
import { expectReplayed } from './ac1.ts';
import { cleanup, useApp } from './helpers.ts';
import { ENTRIES_384 } from './scenarios.ts';

afterEach(cleanup, 60_000);
useShowBinary();
const appReady = useApp();
const standIn = (scenario: JsonObject): JsonObject[] => standInRun(scenario).replies;

describe('AC1 #393\'s and #384\'s acceptance scenarios, played against the hub and the app instead of the deep-show stand-in, give the same replies field for field (#384)', () => {
  it('AC1 #384 AC1: two parts selected by click and shift-click and a typed request reach the session by their handles, as the stand-in gives them', async () => {
    await expectReplayed(ENTRIES_384['selection']!, standIn, appReady);
  }, 900_000);

  it('AC1 #384 AC2: pointing at the caption, at a caption that reads like an instruction, inside a screenshot and inside an HTML deliverable gives the stand-in\'s messages', async () => {
    for (const name of ['caption', 'note', 'screenshot', 'page']) {
      await expectReplayed(ENTRIES_384[name]!, standIn, appReady);
      await cleanup();
    }
  }, 1_800_000);

  it('AC1 #384 AC3: a handle whose item is gone comes back detached and render-back of revision 14 stays the frame pointed at, as the stand-in gives them', async () => {
    await expectReplayed(ENTRIES_384['detached']!, standIn, appReady);
  }, 900_000);
});
