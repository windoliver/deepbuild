// #1294 AC3: the same `git reset --hard` on a clean tree runs with no staging and no ask. The plant stages-clean-tree is
// a stager that copies anyway: it fails, naming the call. So that the test can't pass on a hub that never stages, the
// same session then edits src/a.ts and the same command is staged (the word "same" in the criterion).
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC3, begin, cleanup, digestOf, edit, expectFree, expectRestored, expectStaged, failureOf, makeWorld, must, newSession, startHub, stopHub, treeEdits,
  verdict, type Edit,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const who = `AC3 ${AC3}`;
const COMMAND = 'git reset --hard';

/** The clean tree's src/a.ts, whose copy anywhere in the world is what a stager copying anyway leaves. */
function committed(repo: string): Edit {
  const file = join(repo, 'src/a.ts');
  return { path: 'src/a.ts', file, digest: digestOf(file) };
}

describe(`AC3 ${AC3} the same git reset --hard on a clean tree runs with no staging and no ask; a stager that copies anyway fails, naming the call`, () => {
  it(`AC3 \`${COMMAND}\` on a clean tree runs with no staging and no ask, while the same command in the same session, once src/a.ts is edited, is staged and can be undone`, async (ctx) => {
    await verdict(ctx, async () => {
      const w = makeWorld();
      const hub = await startHub(w);
      try {
        const s = newSession(w);
        await begin(s, 'Start clean.');
        await expectFree(w, hub, s, COMMAND, committed(w.repo), 'on a clean tree', who);
        const discards = treeEdits([edit(w)]);
        const staged = await expectStaged(w, hub, s, COMMAND, discards, who);
        await expectRestored(w, staged, discards, COMMAND, who);
      } finally {
        await stopHub(hub);
      }
    });
  }, 600_000);

  it(`AC3 (wrong program) a stager that copies on a clean tree (DEEP_HUB_PLANT=stages-clean-tree) fails, naming the call`, async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(async () => {
        const w = makeWorld();
        const hub = await startHub(w, 'stages-clean-tree');
        try {
          const s = newSession(w);
          await begin(s, 'Start clean.');
          await expectFree(w, hub, s, COMMAND, committed(w.repo), 'on a clean tree', who);
        } finally {
          await stopHub(hub);
        }
      });
      must(why !== null, `${who} the planted stager stages-clean-tree must fail this test; it passed`);
      must(/`git reset --hard` \(call toolu_[0-9a-f]+\) was staged on a clean tree/.test(why), `${who} the planted stager stages-clean-tree must fail naming the call \`${COMMAND}\`, as staged on a clean tree; it failed with: ${why}`);
    });
  }, 600_000);
});
