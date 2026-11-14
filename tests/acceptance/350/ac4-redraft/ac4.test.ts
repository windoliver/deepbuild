// #350 AC4, a blind redraft (README.md beside this file): written from the issue and the design only, through the
// extension host's public entry and the suite's helpers. Each test says which wrong program it would catch.
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ActionResult, ExtensionHost, HookReply, Installed, Load } from '../../../../packages/extension-host/src/index.ts';
import {
  agentSees, alive, blocksOf, HEADLESS, HOOK_GRANT, host, installAndLoad, openHost, openWorld, releaseEntry, sleep, taskEvent, tasksTitled,
  tempDir, toolBefore, tracked, type World,
} from '../helpers.ts';

const OWN = fileURLToPath(new URL('./fixtures/', import.meta.url));
const BOUND = 10_000;

// ---- This folder's own test packages, prepared as helpers.ts's `pkg` prepares the shared ones.
async function ownPkg(name: string, options: { manifest?: Record<string, unknown>; probe?: Record<string, unknown> } = {}): Promise<string> {
  const dir = tempDir(`ac4-${name}`);
  cpSync(join(OWN, name), dir, { recursive: true });
  for (const entry of readdirSync(dir)) if (entry.endsWith('.fixture')) renameSync(join(dir, entry), join(dir, entry.slice(0, -'.fixture'.length)));
  if (options.probe) writeFileSync(join(dir, 'probe.json'), JSON.stringify(options.probe));
  const manifestPath = join(dir, 'deepbuild.json');
  const manifest = { ...(JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>), ...(options.manifest ?? {}) };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await host();
  manifest.digest = packageDigest(dir);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---- What a promise came to, without ever waiting on it for good.
type Came<T> = { state: 'value'; value: T } | { state: 'threw'; error: string } | { state: 'pending' };
const settle = <T>(p: Promise<T>): Promise<Came<T>> =>
  p.then((value): Came<T> => ({ state: 'value', value }), (e: unknown): Came<T> => ({ state: 'threw', error: String((e as Error)?.message ?? e) }));
const within = <T>(p: Promise<Came<T>>, ms: number): Promise<Came<T>> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<Came<T>>((resolve) => { timer = setTimeout(() => resolve({ state: 'pending' }), ms); })]).finally(() => clearTimeout(timer));
};
async function until(test: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  for (const end = Date.now() + ms; ;) {
    if (await test()) return true;
    if (Date.now() >= end) return false;
    await sleep(25);
  }
}
/** A hook that must answer: the reply, or a failure saying it didn't. */
async function hookNow(h: ExtensionHost, what: string): Promise<HookReply> {
  const came = await within(settle(h.hook(toolBefore(5000, BOUND))), 30_000);
  if (came.state !== 'value') throw Error(`${what}: the hook didn't answer: ${JSON.stringify(came)}`);
  return came.value;
}
const call = (h: ExtensionHost, action: string, id: string, version: string, input: unknown = {}): Promise<Came<ActionResult>> =>
  settle(h.callAction({ action, target: { handle: `ext:${id}`, version }, input, caller: HEADLESS }));
/** Whether a call delivered its action's output. A refusal, a rejection and a call still waiting deliver nothing. */
const done = (came: Came<ActionResult>): boolean => came.state === 'value' && came.value.status === 'done';
const output = (came: Came<ActionResult>): Record<string, unknown> | undefined =>
  came.state === 'value' && came.value.status === 'done' ? came.value.output as Record<string, unknown> : undefined;

/** The log a hub package writes outside its folder: every run of its code the test could not otherwise see. */
function logIn(out: string): { lines(): string[]; since(mark: number): string[]; mark(): number } {
  const lines = (): string[] => (existsSync(join(out, 'log')) ? readFileSync(join(out, 'log'), 'utf8').split('\n').filter(Boolean) : []);
  return { lines, since: (mark) => lines().slice(mark), mark: () => lines().length };
}

/** The long-lived things this process holds: sockets, pipes, servers, child processes, watchers. Timers aren't counted. */
const held = (): number => process.getActiveResourcesInfo().filter((type) => /Socket|Pipe|Server|Process|Watcher|FSEvent|UDP|Worker|MessagePort/.test(type)).length;

describe('AC4 #350.43f82359 An extension that registers a handler and an action and then fails to start exposes neither; enabling and disabling one 20 times leaves no listener or callback it owned; and a call from a removed version that finishes after its replacement is active changes no state and delivers nothing through the replacement', () => {
  // ================= Clause 1: registers a handler and an action, then fails to start.
  const HALF = 'deepbuild/halfstart';
  const HALF_PING = 'ext.halfstart.ping';
  async function halfstart(): Promise<{ w: World; h: ExtensionHost; p: Installed; out: string }> {
    const w = await openWorld();
    const out = tempDir('ac4-out');
    const dir = await ownPkg('halfstart', { probe: { out } });
    const h = await openHost(w, { release: [await releaseEntry(dir)] });
    const p = await h.install({ from: dir, builtBy: null, grant: HOOK_GRANT });
    const checked = await h.check(p);
    expect(checked.passed, `${HALF}'s conformance: ${checked.reasons.join('; ')}`).toBe(true);
    return { w, h, p, out };
  }

  // Wrong program caught: none; this is the control. It shows the package below is one whose handler and action a
  // host does expose once it starts, so the next test's "neither" isn't a host that exposes nothing at all, and that
  // the test's log sees the package's code run in the hub.
  it('AC4 control: the same package, when it starts, exposes its handler and its action', async () => {
    const { h, p, out } = await halfstart();
    const log = logIn(out);
    const mark = log.mark();
    const load = await h.load(p);
    expect(load.status, `the package that doesn't fail to start loads: ${JSON.stringify(load)}`).toBe('loaded');
    expect(log.since(mark), 'its code ran where the test can see it').toContain('registered');
    const reply = await hookNow(h, 'the control');
    expect(blocksOf(reply, HALF).map((b) => b.text), `its handler's block: ${JSON.stringify(reply)}`).toEqual(['halfstart-handler-reached']);
    const ping = await within(call(h, HALF_PING, HALF, '1.0.0'), 30_000);
    expect(output(ping), `its action's output: ${JSON.stringify(ping)}`).toEqual({ pong: 'halfstart-action-reached' });
    expect(log.since(mark).filter((l) => l === 'handler' || l === 'action').sort()).toEqual(['action', 'handler']);
  }, 120_000);

  // Wrong programs caught: a host that publishes a handler or an action the moment it is registered (a hook or a call
  // made while the package is still starting reaches it), and a host that keeps what a failed start registered (a
  // hook or a call made after the failure reaches it), and a host that reports the failed start as loaded.
  it('AC4 a package that registers a handler and an action and then fails to start exposes neither, while it starts or after it failed', async () => {
    const { h, p, out } = await halfstart();
    const log = logIn(out);
    writeFileSync(join(out, 'fail-start'), '');
    const mark = log.mark();
    const loading = settle(h.load(p));
    let loadCame: Came<Load> = { state: 'pending' };
    void loading.then((c) => { loadCame = c; });
    await until(() => log.since(mark).includes('registered') || loadCame.state !== 'pending', 60_000);
    expect(log.since(mark), `the package's code ran at its load and registered both (the load: ${JSON.stringify(loadCame)})`).toContain('registered');

    // While it starts: it has registered both and hasn't failed yet.
    const hookDuring = settle(h.hook(toolBefore(1000, BOUND)));
    const pingDuring = call(h, HALF_PING, HALF, '1.0.0');
    await within(Promise.all([hookDuring, pingDuring]).then((): Came<null> => ({ state: 'value', value: null })), 1500);
    const failedYet = log.since(mark).includes('failing');
    writeFileSync(join(out, 'release'), '');

    loadCame = await within(loading, 60_000);
    expect(loadCame.state, 'the load that fails to start ends').not.toBe('pending');
    expect(loadCame.state === 'value' && loadCame.value.status === 'loaded', `a package whose start threw isn't loaded: ${JSON.stringify(loadCame)}`).toBe(false);
    expect(log.since(mark), 'the package did fail to start').toContain('failing');
    expect(failedYet, 'the hook and the call were made before the package failed').toBe(false);

    const duringHook = await within(hookDuring, 30_000);
    const duringPing = await within(pingDuring, 30_000);
    if (duringHook.state === 'value') {
      expect(blocksOf(duringHook.value, HALF), `no block from a package still starting: ${JSON.stringify(duringHook.value)}`).toEqual([]);
      expect(agentSees(duringHook.value)).not.toContain('halfstart-handler-reached');
    }
    expect(done(duringPing), `a call made while the package starts doesn't run its action: ${JSON.stringify(duringPing)}`).toBe(false);

    // After it failed.
    const after = await hookNow(h, 'after the failed start');
    expect(blocksOf(after, HALF), `no block from a package that failed to start: ${JSON.stringify(after)}`).toEqual([]);
    expect(agentSees(after)).not.toContain('halfstart-handler-reached');
    const pingAfter = await within(call(h, HALF_PING, HALF, '1.0.0'), 30_000);
    expect(done(pingAfter), `a call after the failed start doesn't run its action: ${JSON.stringify(pingAfter)}`).toBe(false);
    expect((await h.loaded()).map((l) => l.id), 'it isn\'t among the loaded').not.toContain(HALF);

    // And neither ran at all, whatever the replies said: the handler and the action write a line each time they run.
    expect(log.since(mark).filter((l) => l === 'handler' || l === 'action'), 'the handler and the action never ran').toEqual([]);
  }, 240_000);

  // ================= Clause 2: enabled and disabled 20 times.
  const CYCLES = 20;

  // Wrong programs caught: a host whose disable leaves the handler listening (a hook after it still gets the block, or
  // names the package as failed because it asked a stopped process), leaves the action callable, leaves the load's
  // process running, or adds a listener at each enable without removing the last one (a second block, or an earlier
  // load's number, on a later enable); and a host that leaks a socket, pipe or child process per cycle.
  it('AC4 a sandboxed package enabled and disabled 20 times: after each disable its handler answers no hook, its action no call and its process is gone; each enable is one fresh handler', async () => {
    const ID = 'test/pulse';
    const w = await openWorld();
    const h = await openHost(w);
    const p = await installAndLoad(h, await ownPkg('pulse'));
    await h.disable(ID);
    const seen = new Set<number>();
    let baseline = -1;
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const at = `cycle ${cycle}`;
      const load = await h.load(p);
      expect(load.status, `${at}: enabling it again loads it: ${JSON.stringify(load)}`).toBe('loaded');
      const run = (load as { run: string | null }).run;
      const first = await hookNow(h, at);
      const blocks = blocksOf(first, ID);
      expect(blocks.length, `${at}: one block from the one enabled load: ${JSON.stringify(first)}`).toBe(1);
      const m = /^pulse load (\d+) beat (\d+)$/.exec(blocks[0]!.text);
      expect(m, `${at}: the block is the package's template: ${blocks[0]!.text}`).not.toBeNull();
      const loadNumber = Number(m![1]);
      expect(Number(m![2]), `${at}: this load's handler ran once for one hook`).toBe(1);
      expect(seen.has(loadNumber), `${at}: the handler that answered is this enable's, not an earlier load's (${loadNumber})`).toBe(false);
      seen.add(loadNumber);
      const second = await hookNow(h, at);
      expect(blocksOf(second, ID).map((b) => b.text), `${at}: a second hook, the same load asked once more`).toEqual([`pulse load ${loadNumber} beat 2`]);
      const ping = await within(call(h, 'ext.pulse.ping', ID, '1.0.0'), 30_000);
      expect(output(ping), `${at}: its action runs in this load: ${JSON.stringify(ping)}`).toEqual({ load: loadNumber, beat: 2 });
      const pids = await tracked(w, run);
      expect(pids.length, `${at}: the load's processes are the supervisor's (run ${run})`).toBeGreaterThan(0);

      await h.disable(ID);
      const off = await hookNow(h, `${at}, disabled`);
      expect(blocksOf(off, ID), `${at}: disabled, its handler answers no hook: ${JSON.stringify(off)}`).toEqual([]);
      expect(off.failed.filter((f) => f.extension === ID), `${at}: disabled, no listener of its is still asked`).toEqual([]);
      const pingOff = await within(call(h, 'ext.pulse.ping', ID, '1.0.0'), 30_000);
      expect(done(pingOff), `${at}: disabled, its action answers no call: ${JSON.stringify(pingOff)}`).toBe(false);
      expect((await h.loaded()).map((l) => l.id), `${at}: disabled, it isn't among the loaded`).not.toContain(ID);
      await until(() => pids.every((pid) => !alive(pid)), 5000);
      expect(pids.filter(alive), `${at}: disabled, its processes are gone`).toEqual([]);
      if (cycle === 2) baseline = held();
    }
    expect(seen.size).toBe(CYCLES);
    await until(() => held() <= baseline, 5000);
    expect(held(), `after ${CYCLES} cycles this process holds no more sockets, pipes, servers or child processes than after 2 (${baseline})`).toBeLessThanOrEqual(baseline);
  }, 600_000);

  // Wrong programs caught: in the hub a disabled load's code stays in the process, so only the host's own lists stand
  // between a hook and an old handler. A host that keeps a disabled load's handler or action in its lists runs it
  // (a line in the log after a disable, or a second line, with an earlier load's ID, after a later enable).
  it('AC4 a package in the hub enabled and disabled 20 times: no disabled load\'s handler or action ever runs again', async () => {
    const ID = 'deepbuild/pulsehub';
    const w = await openWorld();
    const out = tempDir('ac4-out');
    const dir = await ownPkg('pulsehub', { probe: { out } });
    const h = await openHost(w, { release: [await releaseEntry(dir)] });
    const p = await installAndLoad(h, dir);
    await h.disable(ID);
    const log = logIn(out);
    const seen = new Set<string>();
    let baseline = -1;
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const at = `cycle ${cycle}`;
      let mark = log.mark();
      const load = await h.load(p);
      expect(load.status, `${at}: enabling it again loads it: ${JSON.stringify(load)}`).toBe('loaded');
      const on = await hookNow(h, at);
      const blocks = blocksOf(on, ID);
      expect(blocks.length, `${at}: one block from the one enabled load: ${JSON.stringify(on)}`).toBe(1);
      const me = /^pulsehub load (\S+)$/.exec(blocks[0]!.text)?.[1] ?? '';
      expect(me, `${at}: the block is the package's: ${blocks[0]!.text}`).not.toBe('');
      expect(seen.has(me), `${at}: the handler that answered is this enable's, not an earlier load's`).toBe(false);
      seen.add(me);
      const ping = await within(call(h, 'ext.pulsehub.ping', ID, '1.0.0'), 30_000);
      expect(output(ping), `${at}: its action runs in this load: ${JSON.stringify(ping)}`).toEqual({ me });
      expect(log.since(mark).filter((l) => /^(handler|action) /.test(l)), `${at}: one hook and one call ran this load's handler and action once each, and no other load's`)
        .toEqual([`handler ${me}`, `action ${me}`]);

      await h.disable(ID);
      mark = log.mark();
      const off = await hookNow(h, `${at}, disabled`);
      expect(blocksOf(off, ID), `${at}: disabled, its handler answers no hook: ${JSON.stringify(off)}`).toEqual([]);
      const pingOff = await within(call(h, 'ext.pulsehub.ping', ID, '1.0.0'), 30_000);
      expect(done(pingOff), `${at}: disabled, its action answers no call: ${JSON.stringify(pingOff)}`).toBe(false);
      expect((await h.loaded()).map((l) => l.id), `${at}: disabled, it isn't among the loaded`).not.toContain(ID);
      expect(log.since(mark).filter((l) => /^(handler|action) /.test(l)), `${at}: disabled, no load's handler or action ran`).toEqual([]);
      if (cycle === 2) baseline = held();
    }
    expect(seen.size).toBe(CYCLES);
    await until(() => held() <= baseline, 5000);
    expect(held(), `after ${CYCLES} cycles this process holds no more sockets, pipes, servers or child processes than after 2 (${baseline})`).toBeLessThanOrEqual(baseline);
  }, 600_000);

  // ================= Clause 3: a removed version's call that finishes after its replacement is active.
  const SWAP = 'deepbuild/swap';
  async function swapWorld(): Promise<{ w: World; h: ExtensionHost; out: string; v1: string; v2: string; log: ReturnType<typeof logIn> }> {
    const w = await openWorld();
    const out = tempDir('ac4-out');
    const v1 = await ownPkg('swap', { manifest: { version: '1.0.0' }, probe: { out } });
    const v2 = await ownPkg('swap', { manifest: { version: '2.0.0' }, probe: { out } });
    const h = await openHost(w, { release: [await releaseEntry(v1), await releaseEntry(v2)] });
    await installAndLoad(h, v1);
    const ping = await within(call(h, 'ext.swap.ping', SWAP, '1.0.0'), 30_000);
    expect(output(ping), `1.0.0 is the active version: ${JSON.stringify(ping)}`).toEqual({ from: '1.0.0' });
    return { w, h, out, v1, v2, log: logIn(out) };
  }
  /** Installs and loads 2.0.0 over 1.0.0, which removes 1.0.0, and shows 2.0.0 is the active one. */
  async function replace(h: ExtensionHost, v2: string, inFlight: string): Promise<void> {
    const replaced = await within(settle(installAndLoad(h, v2)), 90_000);
    if (replaced.state === 'threw') throw Error(`2.0.0 didn't replace 1.0.0 while ${inFlight}: ${replaced.error}`);
    expect(replaced.state, `2.0.0 becomes active while ${inFlight}; the criterion's call finishes after that, so the replacement can't wait for it`).toBe('value');
    expect((await h.loaded()).filter((l) => l.id === SWAP).map((l) => l.version), 'the one loaded version is the replacement').toEqual(['2.0.0']);
    const ping = await within(call(h, 'ext.swap.ping', SWAP, '2.0.0'), 30_000);
    expect(output(ping), `2.0.0 is the active version: ${JSON.stringify(ping)}`).toEqual({ from: '2.0.0' });
  }

  // Wrong program caught: none; this is the control for the two tests below. The same call, finishing while its
  // version is still the active one, does change state (its event lands) and does deliver (its output comes back),
  // so those tests' "no event" and "no output" aren't a call that could never have done either.
  it('AC4 control: the same call finishing while its version is still active appends its event and returns its output', async () => {
    const { w, h, out, log } = await swapWorld();
    const title = 'ac4-redraft-control-append';
    const held = call(h, 'ext.swap.hold', SWAP, '1.0.0', { event: taskEvent(title) });
    expect(await until(() => log.lines().includes('hold-entered 1.0.0'), 30_000), '1.0.0 took the call').toBe(true);
    writeFileSync(join(out, 'go'), '');
    const came = await within(held, 30_000);
    expect(output(came), `the call's output: ${JSON.stringify(came)}; the log: ${JSON.stringify(log.lines())}`).toEqual({ from: '1.0.0' });
    expect((await tasksTitled(w, title)).length, `its event is in the record; the log: ${JSON.stringify(log.lines())}`).toBe(1);
  }, 180_000);

  // Wrong program caught: a host that leaves a removed version's `deep` object working. 1.0.0's code is still in
  // the hub's process after 2.0.0 took over; when its held call goes on and appends, the event lands in the record
  // (as the replacement's writer, `ext:deepbuild/swap`), or the handler it registers then answers the next hook.
  it('AC4 a removed version\'s call that finishes after its replacement is active changes no state: its append isn\'t in the record and what it registers then is never asked', async () => {
    const { w, h, out, v2, log } = await swapWorld();
    const title = 'ac4-redraft-late-append';
    const late = call(h, 'ext.swap.hold', SWAP, '1.0.0', { event: taskEvent(title) });
    expect(await until(() => log.lines().includes('hold-entered 1.0.0'), 30_000), '1.0.0 took the call before it was removed').toBe(true);
    await replace(h, v2, "1.0.0's call is in flight");
    const before = (await w.events()).length;
    const mark = log.mark();

    writeFileSync(join(out, 'go'), '');   // 1.0.0's call goes on only now, with 2.0.0 active
    // It finishes once it has tried both; a call the host never lets finish has changed nothing either.
    await until(() => log.since(mark).includes('hold-finished 1.0.0'), 15_000);
    await within(late, 2000);
    await sleep(500);

    const said = JSON.stringify(log.since(mark));
    expect((await tasksTitled(w, title)).length, `the removed version's append isn't in the record (the package's log: ${said})`).toBe(0);
    const added = (await w.events()).slice(before).filter((e) => e.writer === `ext:${SWAP}`);
    expect(added.map((e) => e.kind), `the removed version's late call wrote nothing as ext:${SWAP} (the package's log: ${said})`).toEqual([]);
    expect(log.since(mark), 'the append didn\'t return as written').not.toContain('append-returned 1.0.0');

    // What it registered late is no listener of the replacement's: the next hook asks 2.0.0's handler, once, and no other.
    const hookMark = log.mark();
    const reply = await hookNow(h, 'after the late call');
    expect(blocksOf(reply, SWAP).map((b) => b.text), `the next hook has the replacement's block alone: ${JSON.stringify(reply)}`).toEqual(['swap 2.0.0 handler']);
    expect(log.since(hookMark).filter((l) => /handler/.test(l)), 'and ran the replacement\'s handler alone').toEqual(['handler-entered 2.0.0']);
  }, 240_000);

  // Wrong programs caught: a host that hands a removed version's late output on as a finished call of the piece now
  // active (the caller gets `done` from 1.0.0 with 2.0.0 active), one that reroutes it so 2.0.0's action runs for it
  // (a ping or hold the test didn't make), and one that joins a removed version's late hook reply into a reply under
  // the extension's name, which is the replacement's now.
  it('AC4 a removed version\'s call that finishes after its replacement is active delivers nothing: no output from its action, no block from its handler, and nothing run on the replacement', async () => {
    const { h, out, v2, log } = await swapWorld();
    writeFileSync(join(out, 'hold-hook-1.0.0'), '');
    const lateHook = settle(h.hook(toolBefore(60_000, BOUND)));
    expect(await until(() => log.lines().includes('handler-entered 1.0.0'), 30_000), '1.0.0\'s handler took the hook before it was removed').toBe(true);
    const lateCall = call(h, 'ext.swap.hold', SWAP, '1.0.0', { event: taskEvent('ac4-redraft-late-deliver') });
    expect(await until(() => log.lines().includes('hold-entered 1.0.0'), 30_000), '1.0.0 took the call before it was removed').toBe(true);
    await replace(h, v2, "1.0.0's hook reply and call are in flight");
    const mark = log.mark();

    writeFileSync(join(out, 'go'), '');   // both go on only now, with 2.0.0 active
    await until(() => ['hold-finished 1.0.0', 'handler-released 1.0.0'].every((l) => log.since(mark).includes(l)), 15_000);
    const cameCall = await within(lateCall, 15_000);
    const cameHook = await within(lateHook, 15_000);

    expect(done(cameCall), `the removed version's late call delivers no output: ${JSON.stringify(cameCall)}`).toBe(false);
    if (cameHook.state === 'value') {
      expect(agentSees(cameHook.value), `the removed version's late reply reaches no agent: ${JSON.stringify(cameHook.value)}`).not.toContain('late handler reply');
      expect(blocksOf(cameHook.value, SWAP).filter((b) => b.text.includes('1.0.0')), 'no block of the removed version under the extension\'s name').toEqual([]);
    }
    // The replacement ran nothing for the late call: since `go`, no ping or hold of 2.0.0's but the test's own below.
    expect(log.since(mark).filter((l) => / 2\.0\.0$/.test(l) && !l.startsWith('handler-entered')), 'nothing ran on the replacement for the late call').toEqual([]);
    const ping = await within(call(h, 'ext.swap.ping', SWAP, '2.0.0'), 30_000);
    expect(output(ping), `the replacement still answers as itself: ${JSON.stringify(ping)}`).toEqual({ from: '2.0.0' });
    const next = await hookNow(h, 'after the late reply');
    expect(blocksOf(next, SWAP).map((b) => b.text), `a later hook has the replacement's block alone: ${JSON.stringify(next)}`).toEqual(['swap 2.0.0 handler']);
    expect(log.since(mark).filter((l) => l === 'ping 2.0.0' || l.startsWith('hold-entered 2.0.0')), 'the replacement ran the test\'s one ping and nothing else').toEqual(['ping 2.0.0']);
  }, 240_000);
});
