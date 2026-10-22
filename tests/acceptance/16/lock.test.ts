// #16 AC1, AC5 and AC16: one hub per root, held by a lock the OS releases when the process dies, never a
// PID file; a second start leaves the first hub's socket alone; the accept loop survives running out of
// file descriptors. Every hub here is `deep hub run` on a temp root (README, The surface under test).
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, allEvents, cleanup, control, deep, FIXTURES, fromHere, health, hookRequest, installedRoot, makeHome, newSession, NODE, own,
  ownFromFile, sendHook, settle, sleep, spawnHub, startHub, stopHub, tempDir, type HookResult,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe('AC1 #16.90def3b3 two hub starts at once leave exactly one hub running', () => {
  it('AC1 two `deep hub run` on one root, started together, leave one hub; the other exits (5 rounds)', async () => {
    for (let round = 1; round <= 5; round++) {
      const home = makeHome();
      const a = spawnHub({ home });
      const b = spawnHub({ home });
      const [ra, rb] = await Promise.all([settle(a), settle(b)]);
      const ready = [ra, rb].filter((r) => r.ready);
      expect(ready.length, `round ${round}: exactly one start reports ready: ${JSON.stringify([ra, rb])}; stderr: ${a.stderr()} | ${b.stderr()}`).toBe(1);
      const [winner, loser] = ra.ready ? [a, b] : [b, a];
      const lost = ra.ready ? rb : ra;
      expect(lost.exit, `round ${round}: the other start exits`).toBeDefined();
      expect(lost.exit!.code, `round ${round}: the other start exits non-zero`).not.toBe(0);
      await sleep(300);
      expect(alive(winner.pid), `round ${round}: the hub that reported ready still runs`).toBe(true);
      expect(alive(loser.pid), `round ${round}: the other process is gone`).toBe(false);
      const cli = await control({ socket: ready[0]!.ready!.socket, root: installedRoot(home) });
      expect((await health(cli)).pid, `round ${round}: the socket is the running hub's`).toBe(winner.pid);
      cli.close();
      await stopHub({ pid: winner.pid, proc: winner });
    }
  }, 180_000);

  it('AC1 two `deep hub start` at once, through the login service, leave one hub running', async () => {
    const home = makeHome();
    const dir = tempDir();
    const launcher = join(dir, 'launcher');
    writeFileSync(launcher, `#!/bin/sh\nexec "${NODE}" "${join(FIXTURES, 'launcher.mjs')}" "$@"\n`);
    chmodSync(launcher, 0o755);
    const log = join(dir, 'launched.pids');
    const env = { DEEP_HUB_LAUNCHER: launcher, DEEP_TEST_LAUNCHER_LOG: log };
    const [one, two] = await Promise.all([deep(home, ['hub', 'start'], { env }), deep(home, ['hub', 'start'], { env })]);
    expect(one.code, `the first deep hub start: ${one.stderr}`).toBe(0);
    expect(two.code, `the second deep hub start: ${two.stderr}`).toBe(0);
    await sleep(1000);
    const launched = ownFromFile(log);
    const running = launched.filter(alive);
    expect(running.length, `exactly one launched hub still runs: launched ${launched.join(', ')}, running ${running.join(', ')}`).toBe(1);
    const cli = await control({ socket: join(installedRoot(home), 'hub.sock'), root: installedRoot(home) });
    expect((await health(cli)).pid).toBe(running[0]);
    cli.close();
  }, 120_000);
});

describe('AC5 #16.a89956a3 kill -9 leaves no lock that blocks the next start; a stale PID file never stops the hub', () => {
  it('AC5 after kill -9 the next start is ready within 5 s, three times over, with the old socket file left behind', async () => {
    const home = makeHome();
    const s = newSession(home, 'claude-code');
    let hub = await startHub({ home });
    for (let i = 1; i <= 3; i++) {
      const h = await sendHook(hub.socket, fromHere(hookRequest(s, 'PreToolUse')));
      expect(h.ack, `round ${i}: the hub answers before the kill`).toBeDefined();
      process.kill(hub.pid, 'SIGKILL');
      await hub.proc.exit;
      expect(existsSync(hub.socket), `round ${i}: kill -9 left the socket file behind (the case the next start must handle)`).toBe(true);
      const t0 = Date.now();
      hub = await startHub({ home }, 5000);
      expect(Date.now() - t0, `round ${i}: the next start was ready within 5 s`).toBeLessThan(5000);
      const after = await sendHook(hub.socket, fromHere(hookRequest(s, 'PreToolUse')));
      expect(after.ack, `round ${i}: the restarted hub answers a hook`).toBeDefined();
    }
  }, 120_000);

  const STALE = ['hub.pid', 'hub.lock', 'deep.pid', 'deep-hub.pid', 'deepbuild.pid'];
  it.each(STALE)('AC5 a stale %s naming another live program, or a dead one, never stops the hub from starting', async (name) => {
    for (const which of ['live', 'dead'] as const) {
      const home = makeHome();
      const root = installedRoot(home);
      const other = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
      own(other.pid);
      const pid = other.pid!;
      if (which === 'dead') {
        other.kill('SIGKILL');
        await new Promise((resolve) => other.on('exit', resolve));
      }
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, name), `${pid}\n`);
      const hub = await startHub({ home }, 10_000);
      expect(hub.pid, `${which} PID in ${name}: the hub started as its own process`).not.toBe(pid);
      if (which === 'live') expect(alive(pid), `the other program named in ${name} is left running`).toBe(true);
      const cli = await control(hub);
      expect((await health(cli)).pid).toBe(hub.pid);
      cli.close();
      await stopHub(hub);
    }
  }, 60_000);
});

describe('AC16 #16.689b55b1 a second start exits on the lock; the accept loop survives EMFILE', () => {
  interface SecondStart { exit?: { code: number | null }; ready: boolean; stderr: string; hook: HookResult; recorded: boolean }
  async function secondStart(plant?: string): Promise<SecondStart> {
    const home = makeHome();
    const s = newSession(home, 'claude-code');
    const first = await startHub({ home });
    const second = spawnHub({ home, ...(plant && { plant }) });
    const r = await settle(second);
    const request = fromHere(hookRequest(s, 'PreToolUse'));
    const hook = await sendHook(first.socket, request);
    let recorded = false;
    try {
      const cli = await control(first);
      recorded = (await allEvents(cli)).some((e) => e.id === request.id);
      cli.close();
    } catch { /* the first hub can't be reached: recorded stays false */ }
    return { ...(r.exit && { exit: r.exit }), ready: !!r.ready, stderr: second.stderr(), hook, recorded };
  }
  function holds(o: SecondStart): void {
    expect(o.ready, 'the second start must not report ready').toBe(false);
    expect(o.exit?.code, `the second start exits non-zero on the lock: ${o.stderr}`).not.toBe(0);
    expect(o.exit?.code ?? null, 'the second start exits').not.toBeNull();
    expect(o.stderr, 'the second start says it stopped on the lock').toMatch(/lock|already running/i);
    expect(o.hook.ack && o.hook.reply, `the next hook must reach the first hub; it got ${o.hook.end}: ${JSON.stringify(o.hook.lines)}`).toBeTruthy();
    expect(o.recorded, 'the first hub recorded the next hook').toBe(true);
  }
  it('AC16 a second hub start exits on the lock and the next hook still reaches the first hub', async () => {
    holds(await secondStart());
  }, 60_000);
  it('AC16 (wrong program) a hub that unlinks hub.sock before taking the lock fails this test', async () => {
    const o = await secondStart('unlink-before-lock');
    expect(() => holds(o)).toThrow(/the next hook must reach the first hub/);
  }, 60_000);

  interface Burst { results: HookResult[]; after: HookResult; pid: number }
  async function burst(plant?: string): Promise<Burst> {
    const home = makeHome();
    const s = newSession(home, 'claude-code');
    // The hub takes descriptors until the OS refuses one and gives four back: its limit is its open count plus 4.
    const hub = await startHub({ home, nofile: 256, headroom: 4, ...(plant && { plant }) });
    await sleep(500);
    const results = await Promise.all(Array.from({ length: 50 }, () => sendHook(hub.socket, fromHere(hookRequest(s, 'PreToolUse')), 10_000)));
    await sleep(200);
    const after = await sendHook(hub.socket, fromHere(hookRequest(s, 'PreToolUse')), 5000);
    return { results, after, pid: hub.pid };
  }
  function survives(o: Burst): void {
    // Answered: an ack and a reply, or a refusal line. Refused: the connection was refused, reset or closed.
    const hung = o.results.map((r, i) => ({ i, r })).filter(({ r }) => r.end === 'timeout');
    expect(hung.map(({ i, r }) => `hook ${i} neither answered nor refused within 10 s (${JSON.stringify(r.lines)})`)).toEqual([]);
    expect(o.after.ack && o.after.reply, `the hook after the burst must be answered by the hub; it got ${o.after.end}`).toBeTruthy();
    expect(alive(o.pid), 'the hub still runs after the burst').toBe(true);
  }
  it('AC16 with the descriptor limit at the open count plus 4, a burst of 50 hooks is each answered or refused, and the next hook is answered', async () => {
    const o = await burst();
    survives(o);
    const answered = o.results.filter((r) => r.reply || r.error).length;
    console.log(`AC16 burst: ${answered} of 50 answered, ${50 - answered} refused`);
  }, 120_000);
  it('AC16 (wrong program) a hub whose accept loop stops at EMFILE fails this test', async () => {
    const o = await burst('accept-stops-at-emfile');
    expect(() => survives(o)).toThrow(/after the burst|neither answered nor refused/);
  }, 120_000);
});

