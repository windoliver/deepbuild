// #1294 AC5: spellings are matched by effect (#316): `git -c core.pager=cat reset --hard`, `sh -c 'git checkout -- .'`
// and a heredoc running `git restore .` are each staged. The heredoc test first runs the same words in a heredoc written
// to a file, which discards nothing: matched by effect, it is neither staged nor asked about.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC5, begin, cleanup, edit, expectFree, expectRestored, expectStaged, makeWorld, newSession, startHub, stopHub, treeEdits, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const who = `AC5 ${AC5}`;
const HEREDOC = "bash <<'EOF'\ngit restore .\nEOF";
const WRITTEN = "cat > notes.txt <<'EOF'\ngit restore .\nEOF";

describe(`AC5 ${AC5} spellings are matched by effect: git -c core.pager=cat reset --hard, sh -c 'git checkout -- .' and a heredoc running git restore . are each staged`, () => {
  for (const command of ['git -c core.pager=cat reset --hard', "sh -c 'git checkout -- .'"]) {
    it(`AC5 \`${command}\` is staged before it runs, and deep undo restores src/a.ts by digest`, async (ctx) => {
      await verdict(ctx, async () => {
        const w = makeWorld();
        const discards = treeEdits([edit(w)]);
        const hub = await startHub(w);
        try {
          const s = newSession(w);
          await begin(s, 'Start clean.');
          const staged = await expectStaged(w, hub, s, command, discards, who);
          await expectRestored(w, staged, discards, command, who);
        } finally {
          await stopHub(hub);
        }
      });
    }, 600_000);
  }

  it('AC5 a heredoc running `git restore .` is staged before it runs, and deep undo restores src/a.ts by digest, while the same words in a heredoc written to a file run free', async (ctx) => {
    await verdict(ctx, async () => {
      const w = makeWorld();
      const a = edit(w);
      const hub = await startHub(w);
      try {
        const s = newSession(w);
        await begin(s, 'Start clean.');
        await expectFree(w, hub, s, WRITTEN, a, 'as a heredoc written to a file', who);
        rmSync(join(w.repo, 'notes.txt'));
        const discards = treeEdits([a]);
        const staged = await expectStaged(w, hub, s, HEREDOC, discards, who);
        await expectRestored(w, staged, discards, HEREDOC, who);
      } finally {
        await stopHub(hub);
      }
    });
  }, 600_000);
});
