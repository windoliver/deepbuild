// AC11: with a session's `npm test` script running `git push origin HEAD:feature` from a child process, the
// push.record@1 reading of that push, which no guarded call named, is recorded as unguarded, naming the session and the
// `npm test` call that was running, while the reading of the session's own `git push` call, which the guard saw, is not;
// a recorder that marks every push it reads, or none, fails this test, naming the push.
//
// Both pushes are real, into the bare repo behind the forge, which records them. `npm test` runs under the session's
// Bash call, as a child of it, so no hook sees the push inside. The record is `ref.unguarded@1` (README: The surface).
// The wrong programs are the hub's plants `unguarded-marks-every-push` and `unguarded-marks-none`.
import { afterEach, describe, expect, it } from 'vitest';
import { AC11, cleanup, type Ev, failureOf, must, READ_WAIT, SCRIPT_PUSHES, sleep, waitFor, World, YOU } from './helpers.ts';

afterEach(cleanup, 60_000);
const HUB = 420_000;
const REF = `refs/heads/${SCRIPT_PUSHES}`;

interface Pushes { own?: string; child?: string }
async function scenario(seen: Pushes, plant?: string): Promise<void> {
  const w = await World.start({ ...(plant ? { plant } : {}) });
  const s = await w.session({ branch: 'work' });
  const own = seen.own = await s.commitFile('notes/own.md');
  await s.push('own');
  const child = seen.child = await s.commitFile('notes/child.md');
  const { call } = await s.bash('npm test');
  if (w.tip('own') !== own || w.tip(SCRIPT_PUSHES) !== child) throw Error(`BLOCKED: both pushes must reach the forge: own ${w.tip('own')}, ${SCRIPT_PUSHES} ${w.tip(SCRIPT_PUSHES)}`);
  const unguarded = async (): Promise<Ev[]> => (await w.events()).filter((e) => e.kind === 'ref.unguarded');
  const found = await waitFor(async () => (await unguarded()).find((e) => e.data.commit === child), READ_WAIT, 'ref.unguarded', 500)
    .catch(() => { throw Error(`the push of ${child} to ${REF}, which no guarded call named, was not recorded as unguarded`); });
  await sleep(1500);
  const all = await unguarded();
  must(!all.some((e) => e.data.commit === own), `the push of ${own} to refs/heads/own, which the guard saw, is recorded as unguarded: ${JSON.stringify(all.map((e) => e.data))}`);
  must(all.length === 1, `exactly one push is unguarded: ${JSON.stringify(all.map((e) => e.data))}`);
  must(found.session === s.id, `the record names the session ${s.id}: ${JSON.stringify(found)}`);
  must(found.data.call === call, `the record names the call that was running, ${call}: ${JSON.stringify(found.data)}`);
  must(found.data.command === 'npm test', `the record names the npm test call: ${JSON.stringify(found.data)}`);
  must(found.data.ref === REF, `the record names the ref: ${JSON.stringify(found.data)}`);
  must(found.data.pusher === YOU, `the record keeps the reading's pusher: ${JSON.stringify(found.data)}`);
}

describe(`${AC11} A push from a child of a session's npm test is recorded as unguarded, naming the session and the call; the session's own git push is not`, () => {
  it(`${AC11} the child's push of ${REF} is recorded, naming the session and the npm test call, and the session's own git push isn't`, async () => {
    await scenario({});
  }, HUB);

  it(`${AC11} (planted unguarded-marks-every-push) a recorder that marks every push it reads fails this test, naming the push the guard saw`, async () => {
    const seen: Pushes = {};
    const failure = await failureOf(() => scenario(seen, 'unguarded-marks-every-push'));
    expect(failure, 'the scenario must fail on the wrong program').not.toBeNull();
    expect(failure).toContain(`the push of ${seen.own} to refs/heads/own, which the guard saw, is recorded as unguarded`);
  }, HUB);

  it(`${AC11} (planted unguarded-marks-none) a recorder that marks no push fails this test, naming the push no guarded call named`, async () => {
    const seen: Pushes = {};
    const failure = await failureOf(() => scenario(seen, 'unguarded-marks-none'));
    expect(failure, 'the scenario must fail on the wrong program').not.toBeNull();
    expect(failure).toContain(`the push of ${seen.child} to ${REF}, which no guarded call named, was not recorded as unguarded`);
  }, HUB);
});
