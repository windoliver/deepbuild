// AC2: revoking the project's trust in the app, then making one tool call, unloads the extension before that call and
// refuses it naming the project, with no restart; a cache that keeps the old answer until the hub restarts fails.
//
// The revoke is your one answer on the trusted path (`answer` with the app's connection, #348), given to the reader
// the host holds, as the hub's core opens one and hands it to the host. Then exactly one tool call goes to the same
// host, never reopened. The extension notes each call its handler takes in the record, so "before that call" is read
// from outside: the note count doesn't move. The criterion's wrong program is the planted twin keeps-old-answer
// (twins.json), which the proof lane lays over the code under test.
import { beforeAll, describe, expect, it } from 'vitest';
import { asked, denier, hookCall, installAndLoad, openHost, openWorld, tempDir, YOU, type World } from './helpers.ts';
import { judgeRevoke, type RevokeSeen } from './judges.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });

let scenarios = 0;
/** A trusted project with its extension loaded and one call denied, then the revoke, then one call, on one host. */
async function revokeThenOneCall(): Promise<RevokeSeen> {
  const { trust } = world;
  const id = `acme/denier-${++scenarios}`;
  const project = tempDir('repo');
  await trust.answer(YOU, project, true);
  const h = await openHost(world);
  await installAndLoad(h, denier(id, { note: true }), project);
  const before = await hookCall(h);
  const askedBefore = await asked(world, id);
  await trust.answer(YOU, project, false);
  const after = await hookCall(h);
  const loaded = (await h.loaded()).map((l) => l.id);
  return { id, project, before, after, askedBefore, askedAfter: await asked(world, id), loaded };
}

describe('AC2 #881.622513f5 Revoking the project\'s trust in the app, then making one tool call, unloads the extension before that call and refuses it naming the project, with no restart; a cache that keeps the old answer until the hub restarts fails this test', () => {
  it('AC2 after the revoke, the first tool call finds the extension unloaded (its handler not asked, its deny gone, not listed loaded) and is refused naming the project, on the same host', async () => {
    const seen = await revokeThenOneCall();
    expect(judgeRevoke(seen)).toEqual([]);
  }, 120_000);
});
