// #331's lease criteria through `deep env up` / `deep env down` against a dev hub: AC5, a long build holding its
// port past its lease's expiry keeps it, a sibling gets another port, and the stale lease shows as a reading
// (lease.stale@1, the lease still held); AC10, a helper that escaped before it was recorded (a double fork whose
// middle exits at once, then setsid and an empty environment) and still listens on leased port 3000 is reported
// with its PID and the port, never stopped; the lease ends once every recorded process is gone, and the next
// up leases another port. AC10's three wrong programs are the hub's plants (README, Wrong programs).
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, blocked, cleanup, Client, connects, envDown, envUp, escapeBin, freeEverywhere, hasRunToken, health, listeners, makeRepo, pidOf, portEvents, proc,
  READY, serverUp, sh, sleep, startHub, stopHub, sub, tempDir, upReady, waitFor, type Hub, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe('AC5 #331.ba119c50 a port held past its lease\'s expiry is kept, a sibling gets another, the stale lease is a reading', () => {
  it('AC5 a stack whose build runs past its lease\'s term comes up on its port and keeps it; the lease is marked stale, not ended; a sibling worktree gets a different port while the first still answers', async () => {
    const TERM = 1500;
    const t = makeRepo({ up: serverUp('--build-ms', '4000'), ports: ['web'], ready: READY, within: 30 });
    const a = t.worktree('wt-a');
    const b = t.worktree('wt-b');
    const hub = await startHub(sub(tempDir(), 'root'), { DEEP_HUB_TEST_LEASE_MS: String(TERM) });
    const client = await Client.open(hub);
    try {
      const upA = await upReady(hub, a);
      const port = upA.ports.web as number;
      const lease = portEvents(await client.events('lease.acquired'), 'lease.acquired', port)[0];
      expect(lease, `a lease.acquired for port ${port}`).toBeDefined();
      expect(lease!.data.expires - lease!.ts, `the lease's term is the test's ${TERM} ms (DEEP_HUB_TEST_LEASE_MS)`).toBeLessThanOrEqual(TERM + 1000);
      expect(Date.now(), 'the build ran past the lease\'s expiry (scenario)').toBeGreaterThan(lease!.data.expires);
      await sleep(Math.max(0, lease!.data.expires + 1000 - Date.now()));
      const stale = await waitFor(async () => portEvents(await client.events('lease.stale'), 'lease.stale', port)[0], 10_000, `lease.stale for port ${port}`);
      expect(stale.data.holder, 'the stale lease is still its holder\'s').toBe(lease!.data.holder);
      expect(portEvents(await client.events('lease.released'), 'lease.released', port).map((e) => e.data), `the lease on ${port} ended at its expiry`).toEqual([]);
      const h = await health(port);
      expect(h.status, `the long build's stack kept ${port} and answers there`).toBe(200);
      expect(h.body?.cwd).toBe(a);
      const upB = await upReady(hub, b);
      expect(upB.ports.web, `the sibling got the stale lease's port ${port}`).not.toBe(port);
      expect((await health(port)).status, 'the first stack still answers after the sibling came up').toBe(200);
      expect((await health(upB.ports.web)).body?.cwd).toBe(b);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 180_000);
});

// ---- AC10: the escaped helper on leased port 3000.

const PORT = 3000;
type Plant = 'env-kills-by-port' | 'env-leases-port-again' | 'env-holds-lease-for-helper';
interface Seen {
  helper: number;
  server: number;
  run: string;
  down: Line | undefined;
  helperAlive: boolean;
  serverGone: boolean;
  events: Line[];
  next: { code: number | null; out: Line | undefined };
}

/** The scenario, on the hub or a plant: up on 3000, the helper escapes, down, then up again. BLOCKED when it doesn't form. */
async function scenario(plant?: Plant): Promise<Seen> {
  if (!(await freeEverywhere(PORT))) blocked(`port ${PORT} is already in use on this machine (${listeners(PORT).join(', ') || 'unknown listener'}), so the criterion's lease on ${PORT} can't be made`);
  const bin = escapeBin();
  const t = makeRepo({ up: `${sh(bin)} "$web" .pids`, ports: ['web'], ready: READY, within: 20 });
  const wt = t.worktree('wt-a');
  const hub: Hub = await startHub(sub(tempDir(), 'root'), plant ? { DEEP_HUB_PLANT: plant } : {});
  const client = await Client.open(hub);
  try {
    const up = await upReady(hub, wt);
    if (up.ports.web !== PORT) blocked(`the first lease was ${up.ports.web}, not ${PORT}, so the criterion's scenario didn't form (README: ports are leased from 3000 up)`);
    const pids = join(wt, '.pids');
    const server = await pidOf(pids, 'server');
    const helper = await pidOf(pids, 'helper');
    const p = proc(helper);
    if (!p || p.ppid !== 1 || p.pgid !== helper || hasRunToken(helper)) blocked(`the helper ${helper} didn't escape as the criterion says (ppid ${p?.ppid}, pgid ${p?.pgid}, run token ${hasRunToken(helper)})`);
    if (!listeners(PORT).includes(helper)) blocked(`the helper ${helper} doesn't listen on ${PORT} (listeners: ${listeners(PORT).join(', ')})`);
    if ((await client.events('process.tracked')).some((e) => e.data?.pid === helper)) blocked(`the supervisor recorded the helper ${helper} before down, so it didn't escape before it was recorded`);
    const down = await envDown(hub, wt);
    await waitFor(() => !alive(server), 5000, `the stack's server ${server} to be stopped`).catch(() => undefined);
    // The lease's end is waited for, up to 10 s; a lease that never ends is what a check below names.
    await waitFor(async () => portEvents(await client.events('lease.released'), 'lease.released', PORT).length > 0, 10_000, 'the lease to end').catch(() => undefined);
    const helperAlive = alive(helper);
    const next = await envUp(hub, wt);
    return { helper, server, run: up.run as string, down: down.out, helperAlive, serverGone: !alive(server), events: await client.events(), next: { code: next.ran.code, out: next.out } };
  } finally {
    client.close();
    await stopHub(hub);
  }
}

/** The criterion, read off what the scenario saw. Each failure names the port. */
function criterion(s: Seen): void {
  expect(s.serverGone, `the stack's server ${s.server} on port ${PORT} is gone after deep env down`).toBe(true);
  expect(s.helperAlive, `the escaped helper ${s.helper} listening on port ${PORT} was stopped; it can't be proven the run's, so it must only be reported`).toBe(true);
  const left = ((s.down?.left ?? []) as Line[]);
  expect(left.some((l) => l.pid === s.helper && l.port === PORT), `deep env down reports the helper with its PID ${s.helper} and port ${PORT} (left: ${JSON.stringify(left)})`).toBe(true);
  const released = portEvents(s.events, 'lease.released', PORT);
  expect(released.length, `the lease on port ${PORT} never ended once every recorded process was gone; the helper holds it open`).toBeGreaterThan(0);
  const tracked = s.events.filter((e) => e.kind === 'process.tracked' && e.data.run === s.run);
  for (const t of tracked) {
    const ended = s.events.find((e) => e.kind === 'process.ended' && e.data.run === s.run && e.data.pid === t.data.pid);
    expect(ended, `process.ended for recorded pid ${t.data.pid} before the lease on port ${PORT} ended`).toBeDefined();
    expect(ended!.log_pos, `the lease on port ${PORT} ended before recorded pid ${t.data.pid} was proven gone`).toBeLessThan(released[0]!.log_pos);
  }
  const again = portEvents(s.events, 'lease.acquired', PORT).filter((e) => e.log_pos > released[0]!.log_pos);
  expect(again.map((e) => e.data), `the next deep env up leased port ${PORT} again, where the helper still listens`).toEqual([]);
  expect(s.next.out?.status, `the next deep env up comes up on another port than ${PORT} (${JSON.stringify(s.next.out)})`).toBe('ready');
  expect(s.next.out?.ports?.web, `the next deep env up leased port ${PORT} again`).not.toBe(PORT);
}

describe('AC10 #331.43266bc3 an escaped helper on leased port 3000 is reported, never stopped; the lease ends; the next up leases another port', () => {
  it('AC10 after deep env down, the helper is reported with its PID and port 3000 and left running; the lease on 3000 ends after every recorded process is gone; the next up gets another port', async () => {
    criterion(await scenario());
    expect(await connects(PORT), 'the helper still listens on 3000 (scenario)').toBe(true);
  }, 180_000);

  it.each([
    ['env-kills-by-port', /helper .* port 3000 was stopped/],
    ['env-leases-port-again', /port 3000 again/],
    ['env-holds-lease-for-helper', /lease on port 3000 never ended/],
  ] as const)('AC10 (wrong program) a supervisor planted as %s fails this criterion, naming the port', async (plant, names) => {
    const seen = await scenario(plant);
    expect(() => criterion(seen), `the plant ${plant} passed the criterion`).toThrow(names);
  }, 180_000);
});
