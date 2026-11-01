// `#85.0fa0b6d4` on the real hub: Claude Code's StopFailure lines, ~/.claude/settings.json and real TCP. See README.
import { afterEach, describe, expect, it } from 'vitest';
import { begin, continuedOf, endAgents, events, freePort, hook, inbox, listen, MINUTE, networkStop, newSession, SECOND, sessionRows, sleep, stopOf, stoppedSession, stripHandle, tasks, typedTurn, until, waiter, withHub, writeClaudeEnv, type Hub, type Listener, type Session } from './helpers.ts';

const TAG = '#85.0fa0b6d4';
/** A task raised, or closing on its check: the issue's budget of 10 s, and a margin for a loaded Mac. */
const RAISED = 15 * SECOND;
/** The hub tries every 5 s, so the first try on a listening port comes within that, with 2 s for delivery. */
const TRY_EVERY = 5 * SECOND;
const NEXT_TRY = TRY_EVERY + 2 * SECOND;
const RESUME = 30 * SECOND;
/** Past any try of the stop (1.5 s) and any 5 s check: what hasn't happened by then isn't coming. */
const SETTLE = 7 * SECOND;
const hostOf = (port: number) => `127.0.0.1:${port}`;
const baseUrl = (port: number) => `http://${hostOf(port)}`;
const moots = (hub: Hub, handle: string) => events(hub, 'ask.moot').filter((e) => stripHandle(e.subject) === stripHandle(handle));

/** Each stop is yours, and the one task they share is in Needs you. */
async function theOneTask(hub: Hub, sessions: Session[]): Promise<string> {
  for (const s of sessions) {
    const owner = await until(async () => { const stop = await stopOf(hub, s); return stop?.data.owner === 'you' ? 'you' : undefined; }, RAISED);
    expect(owner ?? (await stopOf(hub, s))?.data.owner, 'a failed try makes the stop yours').toBe('you');
  }
  const open = await until(async () => { const now = await inbox(hub); return now.length ? now : undefined; }, RAISED);
  expect(open?.length, 'the stopped sessions share one task in Needs you').toBe(1);
  return String(open![0]!.ask);
}
/** Every session got its continue because the task closed, within 30 s of `from`. */
async function allResumed(hub: Hub, sessions: Session[], handle: string, from: number): Promise<void> {
  for (const s of sessions) {
    const continued = await until(() => continuedOf(hub, s)[0], Math.max(1, from + RESUME - Date.now()));
    expect(continued?.data.because, 'the session resumes because its task closed').toBe('task_closed');
    expect(stripHandle(continued?.data.task), 'and the task is the shared one').toBe(stripHandle(handle));
    expect(continued!.ts - from, 'within 30 s of its check passing').toBeLessThanOrEqual(RESUME);
  }
}

afterEach(() => endAgents());

describe('a network you must reconnect, on the real hub', () => {
  it(`${TAG} shares one task across sessions in different folders, and a real connection closes it and resumes each without you typing`, async () => {
    const port = await freePort();
    let listener: Listener | undefined;
    try {
      await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: baseUrl(port) }), async (hub) => {
        // One session has ended an earlier turn, so its waiter is running when its next turn ends in the stop.
        const a = newSession(hub, 'folder-a');
        const first = await begin(hub, a);
        await hook(hub, a, 'Stop', { prompt_id: first, stop_hook_active: false, last_assistant_message: 'Done.' });
        await sleep(300);
        const wait = waiter(hub, a.id);
        await sleep(300);
        let wake: unknown;
        void wait.woken.then((v) => { wake = v; });
        await networkStop(hub, a, await typedTurn(hub, a, 'run them again'));
        const sessions = [a, await stoppedSession(hub, 'folder-b'), await stoppedSession(hub, 'elsewhere/folder-c')];
        try {
          const handle = await theOneTask(hub, sessions);
          const stops = await Promise.all(sessions.map((s) => stopOf(hub, s)));
          expect(stops.map((s) => s?.data.cause), 'the cause is timed_out').toEqual(['timed_out', 'timed_out', 'timed_out']);
          expect(stops[0]?.data.signature, 'a signature').toBeTruthy();
          expect(new Set(stops.map((s) => s?.data.signature)).size, 'the same in every session and folder').toBe(1);

          // Nothing resumes while the port stays closed.
          await sleep(SETTLE);
          for (const s of sessions) expect(continuedOf(hub, s), 'no continue while the network is down').toEqual([]);
          expect(wake, 'and the waiter still waits').toBeUndefined();

          listener = await listen(port);
          const opened = listener;
          const tried = await until(() => opened.connections[0], NEXT_TRY);
          expect(tried, 'the hub tries the same host every 5 s').toBeDefined();
          const closed = await until(() => moots(hub, handle)[0], RAISED);
          expect(closed?.data.because, 'the first success closes the task').toBe('network_reached');
          expect(JSON.stringify(closed?.data), 'naming the host').toContain(hostOf(port));
          await allResumed(hub, sessions, handle, tried!);
          const woken = (await Promise.race([wait.woken, sleep(10 * SECOND)])) as { session?: string; text?: string } | undefined;
          expect(woken?.session, 'the waiter wakes its session with nothing typed').toBe(a.id);
          expect(woken?.text, 'with the continue').toEqual(expect.any(String));

          const count = opened.connections.length;
          await sleep(SETTLE);
          expect(opened.connections.length, 'a closed task is not tried again').toBe(count);
          expect(opened.bytes(), 'the try carries nothing').toBe(0);
          for (const s of sessions) expect(continuedOf(hub, s).length, 'each session continues once').toBe(1);
          expect(events(hub, 'ask.answered'), 'nothing typed').toEqual([]);
          expect(await inbox(hub), 'Needs you is empty').toEqual([]);
        } finally {
          wait.end();
        }
      });
    } finally {
      await listener?.close();
    }
  }, 120_000);

  it(`${TAG} with the port listening at the stop leaves it to the service: one automatic continue and no task`, async () => {
    const listener = await listen();
    try {
      await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: baseUrl(listener.port) }), async (hub) => {
        const s = await stoppedSession(hub, 'folder-a');
        expect(await until(() => listener.connections[0], RAISED), 'the hub tried the host').toBeDefined();
        expect((await stopOf(hub, s))?.data.owner, "a connection that succeeds leaves it the service's").toBe('service');
        const continued = await until(() => continuedOf(hub, s)[0], RAISED);
        expect(continued?.data.because, 'its one automatic continue').toBe('transient');
        await sleep(SETTLE);
        expect(continuedOf(hub, s).length, 'exactly one').toBe(1);
        expect(tasks(hub), 'no task').toEqual([]);
        expect(await inbox(hub), 'nothing in Needs you').toEqual([]);
        expect(listener.connections.length, 'one try, for the one stop').toBe(1);
        expect(listener.bytes(), 'the try carries nothing').toBe(0);
      });
    } finally {
      await listener.close();
    }
  }, 120_000);

  it(`${TAG} raises no task for a stop stamped over 10 minutes old on a closed port, while a fresh stop on it does`, async () => {
    const port = await freePort();
    await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: baseUrl(port) }), async (hub) => {
      const old = await stoppedSession(hub, 'folder-old', Date.now() - 11 * MINUTE);
      await sleep(SETTLE);
      expect((await stopOf(hub, old))?.data.owner, "a stop past the 10 minutes isn't made yours").not.toBe('you');
      expect(tasks(hub), 'it raises no task').toEqual([]);
      expect(continuedOf(hub, old), 'and starts no continue').toEqual([]);
      const row = (await sessionRows(hub)).find((r) => JSON.stringify(r).includes(old.id));
      expect(row?.cause, 'it stays stopped with its cause on its row').toBe('timed_out');
      const fresh = await stoppedSession(hub, 'folder-fresh');
      expect(await theOneTask(hub, [fresh]), 'the same stop under 10 minutes old, on the same closed port, raises the task').toBeTruthy();
      expect(continuedOf(hub, old), 'and the old stop never joins it').toEqual([]);
    });
  }, 120_000);

  it(`${TAG} doesn't try the host for a stop stamped over 10 minutes old, while a fresh stop does`, async () => {
    const listener = await listen();
    try {
      await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: baseUrl(listener.port) }), async (hub) => {
        await stoppedSession(hub, 'folder-old', Date.now() - 11 * MINUTE);
        await sleep(SETTLE);
        expect(listener.connections, 'no try for the old stop').toEqual([]);
        await stoppedSession(hub, 'folder-fresh');
        expect(await until(() => listener.connections[0], RAISED), 'a fresh stop on the same hub is tried').toBeDefined();
      });
    } finally {
      await listener.close();
    }
  }, 120_000);

  it(`${TAG} shows what's missing on the card while the port stays closed, and stays open`, async () => {
    const port = await freePort();
    await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: baseUrl(port) }), async (hub) => {
      const s = await stoppedSession(hub, 'folder-a');
      const handle = await theOneTask(hub, [s]);
      const card = await until(async () => { const row = (await inbox(hub)).find((r) => r.ask === handle); return row?.missing ? row : undefined; }, RAISED);
      expect(card?.missing?.reasons?.join(' ').length, "a failed try shows on its card as what's missing").toBeGreaterThan(0);
      await sleep(2 * TRY_EVERY + 1000);
      const later = (await inbox(hub)).find((r) => r.ask === handle);
      expect(later?.missing?.reasons?.length, 'it still does after more tries').toBeGreaterThan(0);
      expect(moots(hub, handle), 'the task stays open').toEqual([]);
      expect(continuedOf(hub, s), 'no continue').toEqual([]);
    });
  }, 120_000);

  it(`${TAG} still closes an open task and resumes its sessions after a hub restart`, async () => {
    const port = await freePort();
    let listener: Listener | undefined;
    try {
      await withHub((home) => writeClaudeEnv(home, { ANTHROPIC_BASE_URL: baseUrl(port) }), async (hub) => {
        const sessions = [await stoppedSession(hub, 'folder-a'), await stoppedSession(hub, 'folder-b')];
        const handle = await theOneTask(hub, sessions);
        await hub.restart();
        expect((await inbox(hub)).map((r) => r.ask), 'the task is open after the restart').toEqual([handle]);
        await sleep(TRY_EVERY + 1000);
        expect(moots(hub, handle), "a closed port doesn't close it").toEqual([]);
        listener = await listen(port);
        const opened = listener;
        const tried = await until(() => opened.connections[0], NEXT_TRY);
        expect(tried, 'the hub rebuilt its tries from the record').toBeDefined();
        const closed = await until(() => moots(hub, handle)[0], RAISED);
        expect(closed?.data.because).toBe('network_reached');
        await allResumed(hub, sessions, handle, tried!);
        await sleep(SETTLE);
        for (const s of sessions) expect(continuedOf(hub, s).length, 'each continues once').toBe(1);
      });
    } finally {
      await listener?.close();
    }
  }, 120_000);

  it(`${TAG} tries HTTPS_PROXY over ANTHROPIC_BASE_URL`, async () => {
    const proxyPort = await freePort();
    const base = await listen();
    let proxy: Listener | undefined;
    try {
      await withHub((home) => writeClaudeEnv(home, { HTTPS_PROXY: baseUrl(proxyPort), ANTHROPIC_BASE_URL: baseUrl(base.port) }), async (hub) => {
        const s = await stoppedSession(hub, 'folder-a');
        // The base URL listens and the proxy doesn't: only trying the proxy makes this a task.
        const handle = await theOneTask(hub, [s]);
        await sleep(SETTLE);
        expect(base.connections, 'the base URL is never tried').toEqual([]);
        proxy = await listen(proxyPort);
        const opened = proxy;
        const tried = await until(() => opened.connections[0], NEXT_TRY);
        expect(tried, 'the check tries the proxy').toBeDefined();
        const closed = await until(() => moots(hub, handle)[0], RAISED);
        expect(closed?.data.because).toBe('network_reached');
        expect(JSON.stringify(closed?.data), 'naming the proxy').toContain(hostOf(proxyPort));
        await allResumed(hub, [s], handle, tried!);
        expect(base.connections, 'the base URL is still never tried').toEqual([]);
      });
    } finally {
      await base.close();
      await proxy?.close();
    }
  }, 120_000);
});
