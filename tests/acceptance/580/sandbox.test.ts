// #580 AC10: with worktree A's warm stack on its leased ports and a journey running in worktree C, a test in C that
// connects to A's database port is refused and the refusal names A's lease; A's orders table is unchanged. A planted
// sandbox that admits any loopback port lets C's test insert a row into A's database and fails, naming the port. The
// journey reads the port from its app's /target, tries its insert with the real Postgres client, and reports what
// happened; A's table is read with psql in A's db.
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Bench, containers, failureOf, lines, nameOf, passed, portLease, psql, type Report } from './helpers.ts';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 300_000);

async function scenario(plant?: string): Promise<void> {
  const b = bench = await Bench.open({ worktrees: ['wt-a', 'wt-c'], ...(plant ? { plant } : {}) });
  const a = await b.session('wt-a');
  const c = await b.session('wt-c');
  const onA = await b.whole(a);
  passed(onA);
  const port = onA.served.ports.db!;
  const db = containers(onA.served.project, 'db')[0]!;
  const seed = b.stepLog().find((l) => l.step === 'seed' && l.name === 'wt-a');
  expect(seed?.database, 'A\'s seed step logged its database').toBeTruthy();
  const template = nameOf(seed!.database!);
  const count = (): string => psql(db, template, 'SELECT count(*) FROM orders');
  const before = count();
  const lease = portLease(await b.events(), 'lease.acquired', port).pop();
  expect(lease, `the record holds A's lease on ${port}`).toBeDefined();

  b.target('wt-c', { port, database: template });
  const onC = await b.claim(c);
  const finished = await b.finished(onC);
  const tried = lines<Report>(join(b.w.obs, 'journey.jsonl')).find((r) => r.name === 'wt-c' && r.step === 'target');
  expect(tried, `C's test tried A's port (its run ended ${String(finished.outcome)}: ${JSON.stringify(finished.findings).slice(0, 400)})`).toBeDefined();
  expect(count(), `C's test wrote to A's database on port ${port}`).toBe(before);
  expect(tried!.reached, `the connect to port ${port} was admitted`).toMatch(/^refused/);
  expect(finished.outcome, `C's own journey goes on (${JSON.stringify(finished.findings).slice(0, 400)})`).toBe('passed');
  const denied = await b.until(async () => (await b.events()).find((e) => e.kind === 'sandbox.denied' && e.data.run === onC.run && JSON.stringify(e.data).includes(String(port))), 30_000, `the refusal of port ${port} on C's run (sandbox.denied)`);
  expect(denied.data.holder, 'and names A\'s lease').toBe(lease!.data.holder);
}

describe('AC10 #580 a run\'s sandboxed processes reach only their own stack\'s leased ports on loopback', () => {
  it('AC10 a test in C that connects to A\'s database port is refused, the refusal recorded on its run naming A\'s lease, and A\'s orders table is unchanged', async () => {
    await scenario();
  }, 1_500_000);

  it('AC10 (wrong program) a sandbox that admits any loopback port (DEEP_HUB_PLANT=sandbox-any-loopback) lets C\'s test insert a row into A\'s database and fails, naming the port', async () => {
    const failure = await failureOf(() => scenario('sandbox-any-loopback'));
    expect(failure, 'the planted sandbox passed').not.toBeNull();
    expect(failure, 'naming the port').toMatch(/port \d+/);
    expect(failure, 'by its write to A\'s database').toContain('wrote to A\'s database');
  }, 1_500_000);
});
