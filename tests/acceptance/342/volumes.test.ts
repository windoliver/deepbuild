// #342 AC2: volumes a session started through `deep env up` are gone after it ends, and a volume its agent made with a bare
// `docker volume create` is left in place, since the supervisor can't prove it started it. The session runs both through
// its Bash tool, so the hub sees both commands alike. A session ends by its SessionEnd, or, in Codex Desktop, by an Archive
// that fires no hook (#80). A reaper that removes every volume the session's commands created removes the bare one and
// fails this test, naming it. Real Docker; each volume is read by `docker volume inspect`.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '../332/helpers.ts';
import { AC2, bareName, closeWorlds, composeVolumes, dockerReady, events, failureOf, goneAfter, openWorld, REAP_MS, session, sleep, STACK_FILES, stackOf, until, volumeExists, type World } from './helpers.ts';

afterEach(async () => { await closeWorlds(); await cleanup(); }, 180_000);

/** Long enough for any reaper of the session's end to have finished: the budget and a margin. */
const SETTLE_MS = REAP_MS * 2;

async function scenario(w: World, bare: string): Promise<void> {
  const s = await session(w, 'claude');
  const up = await stackOf(w, s);
  const made = await s.bash(`docker volume create ${bare}`);
  expect(made.code, `docker volume create ${bare} (${made.stderr})`).toBe(0);
  expect(volumeExists(bare), `the bare volume ${bare} exists before the session ends`).toBe(true);

  const at = await s.end();
  const gone = await goneAfter(up.volume, at, SETTLE_MS);
  expect(gone, `the volume ${up.volume}, which the session started through deep env up, still stands after the session ended`).toBeDefined();
  expect(composeVolumes(up.project), `a volume of the session's project ${up.project} remains`).toEqual([]);
  // The lease ends once the stack is gone: a reaper has finished by then, and whatever it would take is taken.
  await until(w, async () => (await events(w, 'lease.released')).some((e) => e.data?.resource?.kind === 'port' && e.data.resource.key === String(up.port)), SETTLE_MS, `the lease on port ${up.port} to end`);
  await sleep(2000);
  expect(volumeExists(bare), `the volume ${bare}, made with a bare docker volume create, was removed: the supervisor can't prove it started it`).toBe(true);
}

describe(`${AC2} a session's env up volumes are gone after it ends, and a bare volume stays`, () => {
  it('AC2 after SessionEnd the stack\'s volume is gone, and the bare volume its agent made stays', async () => {
    dockerReady();
    const w = await openWorld({ files: STACK_FILES });
    await scenario(w, bareName(w));
  }, 300_000);

  it('AC2 a Codex Desktop thread\'s Archive ends its session with no hook fired, and its stack\'s volume is gone', async () => {
    dockerReady();
    const w = await openWorld({ files: STACK_FILES });
    const s = await session(w, 'codex');
    const up = await stackOf(w, s);
    const at = Date.now();
    s.archiveCodex();
    expect(await goneAfter(up.volume, at, SETTLE_MS), `the volume ${up.volume} still stands after its thread's Archive ended the session`).toBeDefined();
  }, 300_000);

  it('AC2 (wrong program) a reaper that removes every volume the session\'s commands created (DEEP_HUB_PLANT=reap-session-volumes) removes the bare volume and fails this test, naming it', async () => {
    dockerReady();
    let bare = '';
    const failure = await failureOf(async () => {
      const w = await openWorld({ files: STACK_FILES, plant: 'reap-session-volumes' });
      bare = bareName(w);
      await scenario(w, bare);
    });
    expect(failure, 'the planted reaper passed').not.toBeNull();
    expect(failure, 'naming the bare volume').toContain(`the volume ${bare}, made with a bare docker volume create`);
  }, 300_000);
});
