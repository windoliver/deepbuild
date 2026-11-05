// #1294 Scope's second bullet: past staging's ceiling, the command becomes an authority ask. No checkbox covers it. Three
// tracked files are modified and `staging.files` is 2, so what `git reset --hard` would discard can't be staged.
import { afterEach, describe, it } from 'vitest';
import { SCOPE, begin, cleanup, edit, expectAsked, makeWorld, newSession, startHub, stopHub, verdict } from './helpers.ts';

afterEach(cleanup, 60_000);

const COMMAND = 'git reset --hard';

describe(`${SCOPE} past its ceiling, the command becomes an authority ask (no checkbox; Scope's second bullet)`, () => {
  it(`Scope with staging.files 2 and 3 modified tracked files, \`${COMMAND}\` becomes an authority ask naming it, before the hook timeout; every edit stays, nothing is staged and no partial copy is left`, async (ctx) => {
    await verdict(ctx, async () => {
      const w = makeWorld({ files: 2, seconds: 20, keep: '3d' });
      const edits = [edit(w, 'src/a.ts'), edit(w, 'src/b.ts'), edit(w, 'src/keep.ts')];
      const hub = await startHub(w);
      try {
        const s = newSession(w);
        await begin(s, 'Start clean.');
        await expectAsked(w, hub, s, COMMAND, edits, SCOPE);
      } finally {
        await stopHub(hub);
      }
    });
  }, 600_000);
});
