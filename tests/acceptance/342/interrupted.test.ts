// #342 AC6: a session killed with SIGKILL keeps the volume it started through `deep env up`; resumed and then ended by
// SessionEnd, the volume is gone within 30 s. A reaper that treats the kill as an end removes it and fails, naming the
// volume. No hook fires at a SIGKILL: the hub finds the process gone (`session.gone`). A second stack then comes up in
// another repo, since a new lease is when the base goes through every stack whose session is gone and takes it down. The
// volume must stand a whole reap budget past the kill, the stack still answering, so a reaper on the budget's clock is
// caught. Real Docker.
import { afterEach, describe, expect, it } from 'vitest';
import { judge, verdictOf } from '../580/helpers.ts';
import { cleanup, deep, get, jsonOut, makeRepo, READY, serverUp, sleep } from '../332/helpers.ts';
import { AC6, closeWorlds, composeVolumes, containers, dockerReady, events, failureOf, goneAfter, openWorld, REAP_MS, session, STACK_FILES, stackOf, until, volumeExists, type Up, type World } from './helpers.ts';

afterEach(async () => { await closeWorlds(); await cleanup(); }, 180_000);

async function killed(w: World): Promise<{ s: Awaited<ReturnType<typeof session>>; up: Up }> {
  const s = await session(w, 'claude');
  const up = await stackOf(w, s);
  await s.kill();
  await until(w, async () => (await events(w, 'session.gone')).some((e) => e.session === s.id), 60_000, `the hub to find ${s.handle}'s process gone (session.gone)`);
  const sibling = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 60 }).repo;
  const other = await deep(['env', 'up', '--json'], { cwd: sibling, timeoutMs: 120_000 });
  expect(jsonOut(other)?.status, `the second stack comes up (${other.stdout} ${other.stderr})`).toBe('ready');
  await sleep(REAP_MS + 1000);
  expect(volumeExists(up.volume), `the volume ${up.volume} was removed after a SIGKILL, which is no end: the session is interrupted and can be resumed`).toBe(true);
  expect(containers(up.project).length, `the stack of project ${up.project} was taken down after a SIGKILL`).toBeGreaterThan(0);
  expect((await get(up.port, '/health')).status, `the interrupted session's stack answers on ${up.port}`).toBe(200);
  return { s, up };
}

describe(`${AC6} a killed session keeps its volume until it resumes and ends`, () => {
  it('AC6 killed with SIGKILL the session keeps its volume and stack past the reap budget; resumed and ended by SessionEnd, the volume is gone within 30 s', async (ctx) => {
    dockerReady();
    const w = await openWorld({ files: STACK_FILES });
    const { s, up } = await killed(w);
    await s.resume();
    expect(volumeExists(up.volume), `the volume ${up.volume} is still there once the session resumed`).toBe(true);
    const at = await s.end();
    const ms = await goneAfter(up.volume, at, REAP_MS * 2);
    expect(ms, `the volume ${up.volume} still stands ${REAP_MS * 2} ms after the resumed session ended`).toBeDefined();
    expect(composeVolumes(up.project), `a volume of ${up.project} remains`).toEqual([]);
    verdictOf(ctx, [judge('volume reaped after the resumed session ended, ms', [ms!], REAP_MS)]);
  }, 300_000);

  it('AC6 (wrong program) a reaper that treats the kill as an end (DEEP_HUB_PLANT=reap-on-kill) removes the volume and fails, naming it', async () => {
    dockerReady();
    let volume = '';
    const failure = await failureOf(async () => {
      const w = await openWorld({ files: STACK_FILES, plant: 'reap-on-kill' });
      const s = await session(w, 'claude');
      const up = await stackOf(w, s);
      volume = up.volume;
      await s.kill();
      await until(w, async () => (await events(w, 'session.gone')).some((e) => e.session === s.id), 60_000, 'session.gone');
      await sleep(REAP_MS + 1000);
      expect(volumeExists(up.volume), `the volume ${up.volume} was removed after a SIGKILL, which is no end`).toBe(true);
    });
    expect(failure, 'the planted reaper passed').not.toBeNull();
    expect(failure, 'naming the volume').toContain(`the volume ${volume} was removed`);
  }, 300_000);
});
