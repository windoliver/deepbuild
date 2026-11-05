// #1294 AC1: in a worktree with an uncommitted edit to tracked src/a.ts, each of the four commands is staged before it
// runs, and `deep undo staged:<id>` restores src/a.ts by digest. The plant stages-untracked-only is a stager whose class
// covers only untracked and ignored files: it runs the reset with no copy and fails this test, naming the file.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, begin, cleanup, edit, expectRestored, expectStaged, failureOf, git, makeWorld, must, newSession, startHub, stopHub, treeEdits, verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const who = `AC1 ${AC1}`;
const COMMANDS = ['git reset --hard', 'git checkout -- .', 'git restore --staged --worktree .', 'git switch -f main'];

/** The criterion's scenario in one world: the edit, the command staged and run for real, the undo. `added` puts the edit in the index first. */
async function scenario(command: string, o: { plant?: string; added?: boolean } = {}): Promise<void> {
  const w = makeWorld();
  const a = edit(w);
  if (o.added) git(w, ['add', a.path]);
  const hub = await startHub(w, o.plant);
  try {
    const s = newSession(w);
    await begin(s, 'Start clean.');
    const discards = treeEdits([a]);
    const staged = await expectStaged(w, hub, s, command, discards, who);
    await expectRestored(w, staged, discards, command, who);
  } finally {
    await stopHub(hub);
  }
}

describe(`AC1 ${AC1} with an uncommitted edit to tracked src/a.ts, each discarding command is staged before it runs and deep undo restores src/a.ts by digest; a stager covering only untracked and ignored files fails, naming the file`, () => {
  for (const command of COMMANDS) {
    it(`AC1 \`${command}\` is staged before it runs, its record holds src/a.ts with its digest, it discards the edit, and deep undo restores src/a.ts by digest`, async (ctx) => {
      await verdict(ctx, () => scenario(command));
    }, 600_000);
  }

  it('AC1 an uncommitted edit already added to the index is staged the same: `git reset --hard` discards it, and deep undo restores src/a.ts by digest', async (ctx) => {
    await verdict(ctx, () => scenario('git reset --hard', { added: true }));
  }, 600_000);

  it('AC1 (wrong program) a stager whose class covers only untracked and ignored files (DEEP_HUB_PLANT=stages-untracked-only) runs the reset with no copy and fails, naming src/a.ts', async (ctx) => {
    await verdict(ctx, async () => {
      const why = await failureOf(() => scenario('git reset --hard', { plant: 'stages-untracked-only' }));
      must(why !== null, `${who} the planted stager stages-untracked-only must fail this test; it passed`);
      must(why.includes('`git reset --hard` ran with no copy of src/a.ts'), `${who} the planted stager stages-untracked-only must fail by running \`git reset --hard\` with no copy of src/a.ts; it failed with: ${why}`);
    });
  }, 600_000);
});
