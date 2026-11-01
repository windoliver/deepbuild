// AC4: staged activation and owned teardown. A package that registers a handler and an action and then fails to start
// exposes neither, during its start or after; enabling and disabling one 20 times leaves no listener or callback it
// owned; and a call from a removed version that finishes after its replacement is active changes no state and
// delivers nothing through the replacement. AC9's test is the blind redraft in ac9-redraft/ (#103's dispute).
//
// "Enabling" is a load and "disabling" the host's `disable` (README, The surface under test). What a load owned is
// read from outside it: its handler (a hook reply's blocks, and for the hub package a counter in this process that
// every call of any load's handler moves), its action, its sandboxed process, and this process's sockets, pipes and
// child processes (Node's active resources).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActionResult, ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import {
  agentSees, alive, blocksOf, HEADLESS, HOOK_GRANT, installAndLoad, openHost, openWorld, pkg, releaseEntry, sleep, tasksTitled, taskEvent, tempDir, toolBefore, tracked,
} from './helpers.ts';

/** This process's handles of the kinds a load could leave behind: sockets, pipes, servers, child processes, watchers. */
function handles(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const kind of process.getActiveResourcesInfo()) if (/TCP|Pipe|Process|Signal|FSEvent|UDP|Server/.test(kind)) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}
function noMoreThan(now: Record<string, number>, baseline: Record<string, number>, what: string): void {
  for (const [kind, n] of Object.entries(now)) expect(n, `${what}: ${kind} handles, against ${baseline[kind] ?? 0} after the first cycle`).toBeLessThanOrEqual(baseline[kind] ?? 0);
}
async function gone(pids: number[], what: string): Promise<void> {
  for (let i = 0; i < 100 && pids.some(alive); i++) await sleep(50);
  expect(pids.filter(alive), `${what}: its processes still run`).toEqual([]);
}
const ping = (h: ExtensionHost, action: string, id: string, version = '1.0.0'): Promise<ActionResult> =>
  h.callAction({ action, target: { handle: `ext:${id}`, version }, input: {}, caller: HEADLESS });

describe('AC4 #350.43f82359 a package that registers a handler and an action and then fails to start exposes neither; enabling and disabling one 20 times leaves no listener or callback it owned; a call from a removed version finishing after its replacement is active changes no state and delivers nothing through it', () => {
  it('AC4 a package that registers a handler and an action and then fails to start exposes neither, while it starts or after; the same package that starts exposes both', async () => {
    const ID = 'deepbuild/starts';
    const dir = await pkg('starts');
    const release = [await releaseEntry(dir)];

    const w = await openWorld();
    const h = await openHost(w, { release });
    const p = await h.install({ from: dir, builtBy: null, grant: HOOK_GRANT });
    { const c = await h.check(p); expect(c.passed, `its conformance, in the sandbox, passes: ${c.reasons.join("; ")}`).toBe(true); }
    process.env.DH350_FAIL_START = '1';
    try {
      const loading = h.load(p);
      await sleep(300);
      const during = await h.hook(toolBefore(2_000, 10_000));
      const pinged = await ping(h, 'ext.starts.ping', ID);
      const load = await loading;
      expect(load.status, 'it failed to start').toBe('refused');
      const after = await h.hook(toolBefore(2_000, 10_000));
      const pingedAfter = await ping(h, 'ext.starts.ping', ID);
      for (const [when, reply] of [['while it started', during], ['after it failed', after]] as const) {
        expect(blocksOf(reply, ID), `${when}: its handler was exposed`).toEqual([]);
        expect(agentSees(reply), `${when}: its handler was reached`).not.toContain('starts-handler-reached');
      }
      for (const [when, result] of [['while it started', pinged], ['after it failed', pingedAfter]] as const) {
        expect(result.status, `${when}: its action was exposed: ${JSON.stringify(result)}`).not.toBe('done');
        expect(JSON.stringify(result), `${when}: its action was reached`).not.toContain('starts-action-reached');
      }
    } finally {
      delete process.env.DH350_FAIL_START;
    }

    // Control: the same bytes, starting, expose both, so the test can see an exposed handler and action.
    const wc = await openWorld();
    const hc = await openHost(wc, { release });
    await installAndLoad(hc, dir);
    expect(blocksOf(await hc.hook(toolBefore(2_000, 10_000)), ID).map((b) => b.text).join(''), 'control: its handler').toContain('starts-handler-reached');
    expect(JSON.stringify(await ping(hc, 'ext.starts.ping', ID)), 'control: its action').toContain('starts-action-reached');
  }, 120_000);

  it('AC4 a sandboxed package enabled and disabled 20 times leaves no process, handler, action or handle it owned, and enabled again answers once', async () => {
    const ID = 'test/cycle';
    const w = await openWorld();
    const h = await openHost(w);
    const p = await h.install({ from: await pkg('cycle'), builtBy: null, grant: HOOK_GRANT });
    { const c = await h.check(p); expect(c.passed, `${p.id}'s conformance: ${c.reasons.join("; ")}`).toBe(true); }
    let baseline: Record<string, number> = {};
    for (let i = 0; i <= 20; i++) {
      const load = await h.load(p);
      expect(load.status === 'loaded' && load.place, `cycle ${i}: ${JSON.stringify(load)}`).toBe('sandbox');
      const pids = load.status === 'loaded' ? await tracked(w, load.run) : [];
      expect(pids.length, `cycle ${i}: the supervisor tracked its process`).toBeGreaterThan(0);
      expect(blocksOf(await h.hook(toolBefore(5_000, 10_000)), ID).length, `cycle ${i}: enabled, its handler answers once`).toBe(1);
      await h.disable(ID);
      await gone(pids, `cycle ${i}, disabled`);
      expect(blocksOf(await h.hook(toolBefore(5_000, 10_000)), ID), `cycle ${i}: disabled, its handler still answers`).toEqual([]);
      expect((await ping(h, 'ext.cycle.ping', ID)).status, `cycle ${i}: disabled, its action still runs`).not.toBe('done');
      expect((await h.loaded()).map((l) => l.id), `cycle ${i}: disabled, it is still loaded`).not.toContain(ID);
      await sleep(100);
      if (i === 0) baseline = handles();
    }
    noMoreThan(handles(), baseline, 'after 20 more cycles');
    expect((await h.load(p)).status, "enabled once more").toBe("loaded");
    const blocks = blocksOf(await h.hook(toolBefore(5_000, 10_000)), ID);
    expect(blocks.map((b) => b.text), 'enabled once more, one handler answers, once').toHaveLength(1);
    expect((await ping(h, 'ext.cycle.ping', ID)).status).toBe('done');
  }, 300_000);

  it('AC4 a hub package enabled and disabled 20 times leaves no handler or action of an earlier load: each hook calls one handler once, each action call runs once', async () => {
    const ID = 'deepbuild/cyclehub';
    const g = globalThis as { __dh350CycleHubCalls?: number; __dh350CycleHubPings?: number };
    const dir = await pkg('cyclehub');
    const w = await openWorld();
    const h = await openHost(w, { release: [await releaseEntry(dir)] });
    const p = await h.install({ from: dir, builtBy: null, grant: HOOK_GRANT });
    { const c = await h.check(p); expect(c.passed, `${p.id}'s conformance: ${c.reasons.join("; ")}`).toBe(true); }
    let baseline: Record<string, number> = {};
    for (let i = 0; i <= 20; i++) {
      const load = await h.load(p);
      expect(load.status === 'loaded' && load.place, `cycle ${i}: ${JSON.stringify(load)}`).toBe('hub');
      await h.disable(ID);
      const calls = g.__dh350CycleHubCalls ?? 0;
      expect(blocksOf(await h.hook(toolBefore(5_000, 10_000)), ID), `cycle ${i}: disabled, its handler still answers`).toEqual([]);
      expect(g.__dh350CycleHubCalls ?? 0, `cycle ${i}: disabled, a handler of it ran`).toBe(calls);
      expect((await ping(h, 'ext.cyclehub.ping', ID)).status, `cycle ${i}: disabled, its action still runs`).not.toBe('done');
      await sleep(50);
      if (i === 0) baseline = handles();
    }
    noMoreThan(handles(), baseline, 'after 20 more cycles');
    expect((await h.load(p)).status, "enabled once more").toBe("loaded");
    const calls = g.__dh350CycleHubCalls ?? 0;
    const reply = await h.hook(toolBefore(5_000, 10_000));
    expect(blocksOf(reply, ID), 'enabled once more, one block').toHaveLength(1);
    expect((g.__dh350CycleHubCalls ?? 0) - calls, 'one hook ran its handlers this many times').toBe(1);
    const pings = g.__dh350CycleHubPings ?? 0;
    expect((await ping(h, 'ext.cyclehub.ping', ID)).status).toBe('done');
    expect((g.__dh350CycleHubPings ?? 0) - pings, 'one action call ran its functions this many times').toBe(1);
  }, 300_000);

  it('AC4 a call to a removed version that finishes after its replacement is active changes no state and delivers nothing through the replacement', async () => {
    const ID = 'deepbuild/acts';
    const handle = `ext:${ID}`;
    const v1 = await pkg('acts', { manifest: { id: ID } });
    const v2 = await pkg('acts', { manifest: { id: ID, version: '2.0.0' } });
    const w = await openWorld();
    const h = await openHost(w, { release: [await releaseEntry(v1), await releaseEntry(v2)] });
    await installAndLoad(h, v1);
    expect((await h.loaded()).find((l) => l.id === ID)?.place).toBe('hub');

    const go = join(tempDir('go'), 'go');
    const late = taskEvent(`late from the removed 1.0.0 ${Date.now()}`);
    const pending = h.callAction({ action: 'ext.acts.slow', target: { handle, version: '1.0.0' }, input: { go, event: late }, caller: HEADLESS });
    await sleep(300);
    await installAndLoad(h, v2);
    expect((await h.loaded()).find((l) => l.id === ID)?.version, 'the replacement is active').toBe('2.0.0');
    const first = await h.callAction({ action: 'ext.acts.where', target: { handle, version: '2.0.0' }, input: {}, caller: HEADLESS });
    expect(first, 'the replacement answers').toMatchObject({ status: 'done', output: { version: '2.0.0', calls: 1 } });

    writeFileSync(go, 'go');
    const result = await Promise.race([pending, sleep(15_000).then(() => ({ status: 'still waiting' }))]);
    await sleep(500);
    await w.record.sync();
    expect((result as { status: string }).status, `the removed version's late call delivered: ${JSON.stringify(result)}`).not.toBe('done');
    expect(JSON.stringify(result), 'its output reached the caller').not.toContain('"from"');
    expect(await tasksTitled(w, (late.data as { title: string }).title), 'the removed version\'s late call changed the record').toEqual([]);
    const second = await h.callAction({ action: 'ext.acts.where', target: { handle, version: '2.0.0' }, input: {}, caller: HEADLESS });
    expect(second, 'the late call went through the replacement').toMatchObject({ status: 'done', output: { version: '2.0.0', calls: 2 } });
  }, 120_000);
});
