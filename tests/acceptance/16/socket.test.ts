// #16 AC4 and AC10: the socket only you can open, and no network port of the hub's own. The permission
// check is the issue's Proof; another user can't be made here, so the test reads the socket's mode and owner
// from the moment it appears, with the hub started under umask 000, where a hub that leaves the mode to the
// umask makes a socket anyone can open.
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup, control, fromHere, hookRequest, installedRoot, makeHome, NODE, newSession, png, result, sendHook, settle, sleep, spawnHub,
  startHub, stopHub, tempDir, waitFor,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const octal = (mode: number) => `0${(mode & 0o777).toString(8)}`;

describe('AC4 #16.e6b88436 the socket is not readable by another user', () => {
  for (const kind of ['installed', 'dev'] as const) {
    it(`AC4 the ${kind} hub's socket, started under umask 000, appears with mode 0600, owned by you, and keeps it`, async () => {
      const home = makeHome();
      const root = kind === 'installed' ? installedRoot(home) : join(tempDir(), 'dev');
      const socket = join(root, 'hub.sock');
      const proc = spawnHub({ home, umask: '000', ...(kind === 'dev' && { root }) });
      // Every stat that finds the socket, from the spawn until it is ready, must show no group or other bits.
      const seen = new Set<string>();
      let watching = true;
      const watch = (async () => {
        while (watching) {
          try {
            const st = statSync(socket);
            if (st.isSocket()) seen.add(octal(st.mode));
          } catch { /* not there yet */ }
          await new Promise((resolve) => setImmediate(resolve));
        }
      })();
      const r = await settle(proc);
      watching = false;
      await watch;
      if (!r.ready) throw Error(`BLOCKED: the hub didn't start: ${JSON.stringify(r)} ${proc.stderr()}`);
      expect(r.ready.socket).toBe(socket);
      const st = statSync(socket);
      expect(st.isSocket(), `${socket} is a socket`).toBe(true);
      expect(octal(st.mode), `${socket} has mode 0600`).toBe('0600');
      expect(st.uid, 'the socket belongs to you').toBe(process.getuid!());
      expect([...seen].filter((m) => (Number.parseInt(m, 8) & 0o077) !== 0), `no moment showed the socket open to group or others: seen ${[...seen].join(', ')}`).toEqual([]);
      // Still 0600 after it has served hooks, and on the next start.
      const s = newSession(home, 'claude-code');
      for (let i = 0; i < 20; i++) await sendHook(socket, fromHere(hookRequest(s, 'PreToolUse')));
      expect(octal(statSync(socket).mode)).toBe('0600');
      await stopHub({ pid: proc.pid, proc });
      const again = spawnHub({ home, umask: '000', ...(kind === 'dev' && { root }) });
      const r2 = await settle(again);
      if (!r2.ready) throw Error(`BLOCKED: the hub didn't start again: ${again.stderr()}`);
      expect(octal(statSync(socket).mode), 'mode 0600 on the next start').toBe('0600');
    }, 60_000);
  }
});

/** The network sockets a process holds, as lsof lists them (lsof exits 1 with nothing when there are none). */
function networkSockets(pid: number): string[] {
  try {
    return execFileSync('lsof', ['-a', '-p', String(pid), '-i', '-n', '-P'], { encoding: 'utf8' }).split('\n').slice(1).filter(Boolean);
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    if (e.status === 1 && !e.stdout?.trim()) return [];
    throw error;
  }
}

describe('AC10 #16.03f71eb5 the hub listens on no network port of its own', () => {
  it('AC10 with no plug-in turned on, the hub holds no TCP or UDP socket: idle, and after hooks, a paste and a run', async () => {
    const home = makeHome();
    const hub = await startHub({ home });
    await sleep(500);
    expect(networkSockets(hub.pid), 'network sockets of the idle hub').toEqual([]);
    const s = newSession(home, 'claude-code');
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) await sendHook(hub.socket, fromHere(hookRequest(s, event)));
    const app = await control(hub, 'app');
    result(await app.call('evidence.paste', { bytes: Buffer.from(png(8, 8, 10)).toString('base64'), type: 'png' }));
    const cli = await control(hub);
    const run = result(await cli.call('run.start', { check: 'check:noop', claim: 'claim:ac10', commit: '0'.repeat(40), argv: [NODE, '-e', 'setTimeout(() => {}, 300)'] }));
    expect(networkSockets(hub.pid), 'network sockets while a run is in flight').toEqual([]);
    await waitFor(async () => {
      const page = result(await cli.call('events.read', { after: 0, limit: 1000 }));
      return (page.events as { kind: string; data: { run?: string } }[]).some((e) => e.kind === 'run.finished' && e.data.run === run.run) || undefined;
    }, 15_000, 'the run to finish');
    expect(networkSockets(hub.pid), 'network sockets after hooks, a paste and a run').toEqual([]);
    app.close();
    cli.close();
    await stopHub(hub);
  }, 60_000);
});
