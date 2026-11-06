// #1294 AC2: `git stash drop` and `git stash clear`, with an entry holding tracked edits, stage that entry's files first
// and restore them on undo. The test stashes the edit itself, as a session earlier did (named, as the guards ask). The
// tree is then clean, so the only copy of the edit is the entry: staging must read the entry, not the tree.
import { afterEach, describe, it } from 'vitest';
import {
  AC2, begin, cleanup, edit, expectRestored, expectStaged, git, makeWorld, newSession, startHub, stopHub, verdict, type Discards,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const who = `AC2 ${AC2}`;

describe(`AC2 ${AC2} git stash drop and git stash clear, with an entry holding tracked edits, stage that entry's files first and restore them on undo`, () => {
  for (const command of ['git stash drop', 'git stash clear']) {
    it(`AC2 \`${command}\` stages the entry's src/a.ts with its digest before it runs, the entry is gone, and deep undo restores src/a.ts by digest`, async (ctx) => {
      await verdict(ctx, async () => {
        const w = makeWorld();
        const a = edit(w);
        git(w, ['stash', 'push', '-q', '-m', 'wip-1294']);
        const hub = await startHub(w);
        try {
          const s = newSession(w);
          await begin(s, 'Drop the old stash.');
          const discards: Discards = {
            edits: [a],
            copy: 'bytes',
            gone: () => (git(w, ['stash', 'list']).trim() ? 'the stash still holds its entry' : null),
          };
          const staged = await expectStaged(w, hub, s, command, discards, who);
          await expectRestored(w, staged, discards, command, who);
        } finally {
          await stopHub(hub);
        }
      });
    }, 600_000);
  }
});
