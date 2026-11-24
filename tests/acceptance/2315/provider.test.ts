// #2315 through `deep env up` and `deep env down` against a dev hub (`deep hub run --root`) whose home has a kitted
// replacement environment@1 provider installed (fixtures/swap, environment@1's reference fill registered as `swap`,
// logging every call) and DeepBuild's release listing it, so it loads in the hub. The worktree's done.yaml is
// env-local's shape, and the stack env-local would start leaves a marker: a test sees which provider ran.
// AC1: up and down go to the replacement. AC2: the provider unloaded in a running hub (its files changed and
// `extension.restart` refusing to load it again) has its active handle stopped, once, and the next `deep env up` is
// refused naming it; and a hub whose release no longer lists it (its trust to run in the hub gone) refuses
// `deep env up` naming it. Neither falls back to env-local. (README: How each criterion is read.)
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  alive, blocked, cleanup, Client, envDown, envLocalRan, envUp, NAMES_SWAP, readLog, releaseFile, removeHome, said, scene, sleep, startHub, stopHub,
  SWAP_ID, waitFor, type Line,
} from './helpers.ts';

afterEach(async () => { await cleanup(); }, 60_000);
afterAll(() => removeHome());

const AC1 = '#2315.9f5b8ef0';
const AC2 = '#2315.7023c897';
const ups = (log: string): Line[] => readLog(log).filter((l) => l.op === 'up');
const readies = (log: string): Line[] => readLog(log).filter((l) => l.op === 'ready');
const downs = (log: string): Line[] => readLog(log).filter((l) => l.op === 'down');

/** `deep env up` in the worktree must have asked the replacement, not env-local; returns its handle. */
async function upThroughSwap(log: string, wt: string, ran: Awaited<ReturnType<typeof envUp>>): Promise<Line> {
  expect(ups(log).map((l) => l.checkout), `deep env up in ${wt} asks the replacement environment@1 provider's up with the worktree (${said(ran)}; env-local's stack ran there: ${JSON.stringify(envLocalRan(wt))})`).toContain(wt);
  expect(envLocalRan(wt), `env-local's stack never ran in ${wt}`).toEqual([]);
  expect(ran.code, `deep env up exits 0 on the replacement's stack (${said(ran)})`).toBe(0);
  expect(ran.out?.status, `deep env up reports ready: ${JSON.stringify(ran.out)}`).toBe('ready');
  const ready = readies(log).at(-1);
  expect(ready?.handle?.id, `the replacement's up returned a handle: ${JSON.stringify(readLog(log))}`).toBeTypeOf('string');
  return ready!.handle as Line;
}

describe(`AC1 ${AC1} a kitted replacement environment@1 provider, installed and loaded, gets deep env up and down instead of env-local`, () => {
  it('AC1 `deep env up` and `deep env down` in a worktree invoke the loaded replacement provider\'s up and down, and env-local never runs', async () => {
    const s = await scene();
    const wt = s.repo.worktree('wt-a');
    const hub = await startHub(s.root, s.release);
    try {
      const up = await envUp(hub, wt);
      const handle = await upThroughSwap(s.log, wt, up);
      const down = await envDown(hub, wt);
      expect(downs(s.log).map((l) => l.handle?.id), `deep env down asks the replacement's down with the handle its up returned (${said(down)})`).toEqual([handle.id]);
      expect(down.code, `deep env down exits 0 (${said(down)})`).toBe(0);
      expect(envLocalRan(wt), `env-local's stack never ran in ${wt}`).toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 900_000);
});

describe(`AC2 ${AC2} the loaded environment@1 provider disabled or no longer trusted: its active handle stops, and deep env up is refused naming it, never falling back to env-local`, () => {
  it('AC2 disabled in the running hub (its files changed, `extension.restart` refusing to load it again): its active handle is stopped once, and the next `deep env up` is refused naming the provider, env-local never running', async () => {
    const s = await scene();
    const a = s.repo.worktree('wt-a');
    const b = s.repo.worktree('wt-b');
    const hub = await startHub(s.root, s.release);
    const client = await Client.open(hub);
    try {
      const handle = await upThroughSwap(s.log, a, await envUp(hub, a));
      expect(alive(handle.pid as number), `the replacement's stack runs (pid ${handle.pid})`).toBe(true);
      // Disabled: the installed bytes no longer match what its conformance ran on, so its restart unloads it and
      // refuses to load it again (the host's own unload, the one its disable takes; README).
      writeFileSync(join(s.installed.folder, 'disabled.txt'), 'changed after its check\n');
      const restart = await client.call('extension.restart', { id: SWAP_ID });
      if (restart.status !== 'refused') blocked(`the changed package must stay unloaded: extension.restart answered ${JSON.stringify(restart)}`);
      const stopped = await waitFor(() => downs(s.log).length > 0 && !alive(handle.pid as number), 15_000, 'the active handle stopped')
        .then(() => true, () => false);
      expect(downs(s.log).map((l) => l.handle?.id), `unloading the provider stops its active handle through its down (${JSON.stringify(readLog(s.log))})`).toEqual([handle.id]);
      expect(stopped && !alive(handle.pid as number), `the handle's process ${handle.pid} is gone within 15 s`).toBe(true);
      const before = ups(s.log).length;
      const again = await envUp(hub, b);
      expect(envLocalRan(b), `after the provider is disabled, deep env up never falls back to env-local (${said(again)})`).toEqual([]);
      expect(again.code === 0 || again.out?.status === 'ready', `deep env up is refused once the provider is disabled (${said(again)})`).toBe(false);
      expect(`${again.stdout}\n${again.stderr}`, `the refusal names the missing provider (${SWAP_ID} / swap)`).toMatch(NAMES_SWAP);
      expect(ups(s.log).length, 'the disabled provider is never asked again').toBe(before);
      await sleep(500);
      expect(downs(s.log).length, 'its handle is stopped once').toBe(1);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 900_000);

  it('AC2 trust revoked: a hub whose release no longer lists the provider it loaded refuses `deep env up` naming the provider, env-local never running', async () => {
    const s = await scene();
    const wt = s.repo.worktree('wt-a');
    const first = await startHub(s.root, s.release);
    try {
      const client = await Client.open(first);
      try {
        const loaded = await client.call('extension.restart', { id: SWAP_ID });
        if (loaded.status !== 'restarted') blocked(`the hub whose release lists it must load the replacement: extension.restart answered ${JSON.stringify(loaded)}; the hub said ${first.stderr().slice(-800)}`);
      } finally {
        client.close();
      }
    } finally {
      await stopHub(first);
    }
    // The same home, the package still installed, DeepBuild's release no longer listing it.
    const hub = await startHub(s.root, releaseFile([]));
    try {
      const up = await envUp(hub, wt);
      expect(envLocalRan(wt), `with the provider no longer trusted, deep env up never falls back to env-local (${said(up)})`).toEqual([]);
      expect(up.code === 0 || up.out?.status === 'ready', `deep env up is refused (${said(up)})`).toBe(false);
      expect(`${up.stdout}\n${up.stderr}`, `the refusal names the missing provider (${SWAP_ID} / swap)`).toMatch(NAMES_SWAP);
      expect(ups(s.log), 'the untrusted provider is never asked').toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 900_000);
});
