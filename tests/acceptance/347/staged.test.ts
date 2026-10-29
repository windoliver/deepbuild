// #347 AC1: a destructive command whose reach can't be known runs only after the folders it names are staged as a
// copy-on-write copy kept for a set time, and the run can be undone from it. The command is the design's other
// example beside an agent-written script (AC3's): a glob over a folder, `rm -rf cache/*`, where cache/ is ignored, so
// git can't restore what it deletes. At the moment deep-hook allows it, before it runs, its files share their blocks
// with a clone (APFS); the record holds the staging, kept for staging.keep (3 days); `deep undo` brings every file
// back with its bytes. Then, on the hub's clock past that time, the copy is let go and the run can't be undone.
import { afterEach, describe, it } from 'vitest';
import {
  AC1, KEEP, begin, cleanup, expectStaged, expectUndone, fill, makeWorld, must, newSession, noCopies, shown, startHub, stopHub, treeOf, undo,
  verdict,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const COMMAND = 'rm -rf cache/*';

describe(`AC1 ${AC1} a destructive command whose reach can't be known runs only after the folders it names are staged copy-on-write, kept for a set time, and can be undone`, () => {
  it(`AC1 ${COMMAND} over the ignored cache/ runs only once cache/ is staged as a copy-on-write copy kept for staging.keep, with no ask, and deep undo brings back every file with its bytes`, async (ctx) => {
    await verdict(ctx, async () => {
      const who = `AC1 ${AC1}`;
      const w = makeWorld();
      const cache = fill(w, 'cache', 40, { big: 4 });
      const hub = await startHub(w);
      try {
        const s = newSession(w);
        await begin(s, 'The cache is stale; clear it.');
        const staged = await expectStaged(w, hub, s, COMMAND, cache, who);
        await expectUndone(w, staged, cache, COMMAND, who);
      } finally {
        await stopHub(hub);
      }
    });
  }, 600_000);

  it(`AC1 the copy is kept for the set time only: on the hub's clock past staging.keep (${KEEP}), the copy of cache/ is let go and deep undo of the run is refused, leaving cache/ as the run left it`, async (ctx) => {
    await verdict(ctx, async () => {
      const who = `AC1 ${AC1} [kept for a set time]`;
      const w = makeWorld();
      const cache = fill(w, 'cache', 40, { big: 4 });
      let hub = await startHub(w);
      let staged;
      try {
        const s = newSession(w);
        await begin(s, 'The cache is stale; clear it.');
        staged = await expectStaged(w, hub, s, COMMAND, cache, who);
      } finally {
        await stopHub(hub);
      }
      // The hub starts again with its clock a minute past the copy's time.
      const until = Number(staged.event.data.until);
      hub = await startHub(w, { clock: until + 60_000 });
      try {
        const left = await noCopies(w, cache.names, cache.dir, 60_000);
        must(!left.length, () => `${who} past its set time (until ${new Date(until).toISOString()}), the copy of ${cache.dir} must be let go: 60 s after the hub started with its clock a minute past it, ${left.length} copies of its files are left, such as ${left.slice(0, 3).join(', ')}`);
        const r = await undo(w, staged.handle);
        must(r.code !== 0, `${who} past its set time, \`deep undo ${staged.handle}\` must be refused, since the copy is gone: ${shown(r)}`);
        must(treeOf(cache.dir).size === 0, `${who} a refused \`deep undo ${staged.handle}\` must leave ${cache.dir} as the run left it, empty: it holds ${treeOf(cache.dir).size} files`);
      } finally {
        await stopHub(hub);
      }
    });
  }, 600_000);
});
