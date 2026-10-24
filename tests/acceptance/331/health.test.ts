// #331 AC3: a stack that fails its health check makes the checks that depend on it BLOCKED, naming the cause.
// Two surfaces: `deep env up` itself (BLOCKED, exit 3, the cause naming the route), and a check run that needs the
// app running, started through the hub's `run.start` with `environment: true` (README, The hub), whose stack comes
// up from the run's own folder, a check's temporary checkout. A stack that never answers 200 makes that run
// `missing` (the verdict table's BLOCKED) with the cause in its findings, and the check's own process never runs.
// The control: the same check on a healthy stack runs, given its leased port.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, CHECK, cleanup, Client, COMMIT, envUp, makeCheckout, makeRepo, NODE, pidOf, portEvents, READY, serverUp, startHub, stopHub, sub, tempDir, ulid,
  waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const claim = () => `claim:${ulid()}`;
async function finished(client: Client, run: string, timeoutMs = 60_000): Promise<Line> {
  return waitFor(async () => (await client.events('run.finished')).find((e) => e.data?.run === run), timeoutMs, `run.finished for ${run}`);
}

describe('AC3 #331.5001b4d0 a stack that fails its health check makes dependent checks BLOCKED with the cause', () => {
  it('AC3 `deep env up` on a stack whose health route answers 503 exits 3 as BLOCKED, the cause naming the route and its answer, and leaves none of the stack running and no lease held', async () => {
    const t = makeRepo({ up: serverUp('--unhealthy'), ports: ['web'], ready: READY, within: 3 });
    const wt = t.worktree('wt-a');
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      const { ran, out } = await envUp(hub, wt);
      expect(out?.status, `deep env up reports BLOCKED (${ran.stdout} ${ran.stderr})`).toBe('BLOCKED');
      expect(ran.code, 'BLOCKED exits 3 (exit.code@1)').toBe(3);
      expect(String(out?.cause), 'the cause names the health route').toMatch(/\/health/);
      expect(String(out?.cause), 'the cause says what the route answered').toMatch(/503/);
      const server = await pidOf(join(wt, '.pids'), 'server');
      await waitFor(() => !alive(server), 5000, `the unhealthy stack's server ${server} to be stopped`);
      const events = await client.events();
      for (const e of portEvents(events, 'lease.acquired')) {
        expect(portEvents(events, 'lease.released', Number(e.data.resource.key)).length, `the lease on port ${e.data.resource.key} ended`).toBeGreaterThan(0);
      }
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 120_000);

  it('AC3 a check that needs the app, run in its checkout whose stack fails its health check, finishes missing (BLOCKED) with the cause, and its own process never runs', async () => {
    const checkout = makeCheckout({ up: serverUp('--unhealthy'), ports: ['web'], ready: READY, within: 3 });
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      const { run } = await client.call('run.start', { check: 'journey:home', claim: claim(), commit: COMMIT, cwd: checkout, argv: [NODE, CHECK], environment: true }, 60_000);
      const done = await finished(client, run as string);
      expect(done.data.outcome, `the run is missing, which the verdict table makes BLOCKED (${JSON.stringify(done.data)})`).toBe('missing');
      expect((done.data.findings as string[]).join(' | '), 'its findings name the stack\'s failed health route').toMatch(/\/health/);
      expect(existsSync(join(checkout, 'check.json')), 'the check\'s own process ran against a stack that never came up').toBe(false);
      const server = await pidOf(join(checkout, '.pids'), 'server');
      await waitFor(() => !alive(server), 5000, `the unhealthy stack's server ${server} to be gone after the run finished`);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 120_000);

  it('AC3 (control) the same check on a healthy stack started from its checkout runs, given the leased port in `web`, and reaches the stack', async () => {
    const checkout = makeCheckout({ up: serverUp(), ports: ['web'], ready: READY, within: 20 });
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      const { run } = await client.call('run.start', { check: 'journey:home', claim: claim(), commit: COMMIT, cwd: checkout, argv: [NODE, CHECK], environment: true }, 60_000);
      const done = await finished(client, run as string);
      expect(existsSync(join(checkout, 'check.json')), `the check ran (${JSON.stringify(done.data)})`).toBe(true);
      const seen = JSON.parse(readFileSync(join(checkout, 'check.json'), 'utf8')) as Line;
      expect(Number(seen.web), 'the check got a leased port in `web`').toBeGreaterThan(0);
      expect(seen.status, `the check reached its stack on 127.0.0.1:${seen.web} (${seen.error})`).toBe(200);
      expect(done.data.outcome).toBe('passed');
      const server = await pidOf(join(checkout, '.pids'), 'server');
      await waitFor(() => !alive(server), 5000, `the run's stack (server ${server}) to be taken down after the run`);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 120_000);
});
