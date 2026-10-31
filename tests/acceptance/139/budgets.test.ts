// AC7 (#139): budgets, on the reference Mac in the local preflight, compared with the merge base: the contract step adds
// under 30 s to the local preflight, and an adapter adds under 50 µs at p95 to a call it serves.
// Both readings are made on this checkout and set against the merge base: the base has no contract step, so its cost
// is nothing and the lane's whole time is the addition (the test shows the base's lane list to say so); the adapter's
// addition is the p95 of (a deprecated call served through the adapter minus the same call to what replaced it).
// The adapter is `contractAdapter(table).serve(method, params, call)` from @deepbuild/hub's entry (README). Readings count
// only on a reference Mac, not loaded past its core count; elsewhere the test reports `INCONCLUSIVE:` and skips, never
// passes. The surfaces are checked first, so a base without them fails.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { environmentProblem, judge, load, percentile } from '../120/helpers.ts';
import { childEnv, REPO, run, STEP } from './helpers.ts';
import { existsSync } from 'node:fs';

interface Lane { name: string; commands: string[][] }
const lanes = async (): Promise<Lane[]> => ((await import(new URL('../../../scripts/lanes.mjs', import.meta.url).href)) as { checks: Lane[] }).checks;
const contractLane = async (): Promise<Lane | undefined> => (await lanes()).find((l) => l.commands.some((c) => c.some((a) => a.endsWith('contract-diff.mjs')) && c.includes('check')));

describe('#139.88ade6c5 budgets on the reference Mac, compared with the merge base: the contract step adds under 30 s, an adapter under 50 µs at p95', () => {
  it('AC7 the contract step adds under 30 s to the local preflight', async (ctx) => {
    const lane = await contractLane();
    expect(lane, 'the local preflight has a lane that runs "contract-diff.mjs check"').toBeDefined();
    expect(existsSync(STEP), 'scripts/contract-diff.mjs exists').toBe(true);
    const baseLanes = spawnSync('git', ['show', 'origin/main:scripts/lanes.mjs'], { cwd: REPO, encoding: 'utf8' });
    const baseHas = baseLanes.status === 0 && baseLanes.stdout.includes('contract-diff.mjs');
    const problem = environmentProblem([load()]);
    if (problem) { console.log(`INCONCLUSIVE: ${problem}: the contract step's time was not measured`); ctx.skip(`INCONCLUSIVE: ${problem}`); return; }
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      for (const [command, ...args] of lane!.commands) {
        const r = run(command === process.execPath ? command : command!, args, { env: childEnv(), timeoutMs: 120_000 });
        expect(r.code, `the lane's command ran: ${command} ${args.join(' ')}: ${r.out.slice(-800)}`).toBe(0);
      }
      runs.push((performance.now() - started) / 1000);
    }
    const j = judge('the contract lane', runs, 30, 's');
    const text = `${j.text}; the merge base ${baseHas ? 'already has a contract lane' : 'has no contract lane, so the whole time is the addition'}`;
    if (j.verdict === 'INCONCLUSIVE') { console.log(`INCONCLUSIVE: ${text}`); ctx.skip(`INCONCLUSIVE: ${text}`); return; }
    expect(j.verdict, text).toBe('PASS');
  }, 900_000);

  it('AC7 an adapter adds under 50 µs at p95 to a call it serves', async (ctx) => {
    const hub = (await import('../../../packages/hub/src/index.ts')) as unknown as { contractAdapter?: (table: unknown[]) => { serve(method: string, params: unknown, call: (m: string, p: unknown) => unknown): { result: unknown; deprecated?: unknown } } };
    expect(typeof hub.contractAdapter, '@deepbuild/hub exports contractAdapter(table).serve(method, params, call)').toBe('function');
    const adapter = hub.contractAdapter!([
      { method: 'hub.health', since: 'R1', stability: 'stable' },
      { method: 'hub.ping', since: 'R1', stability: 'stable', deprecated_since: 'R2', replaced_by: 'hub.health', stops_serving: 'R3' },
    ]);
    const call = (_m: string, p: unknown): unknown => ({ ok: true, echo: p });
    const probe = adapter.serve('hub.ping', { n: 1 }, call);
    expect(probe.deprecated, 'a call of the deprecated method is served through the adapter, with its notice').toMatchObject({ entry: 'hub.ping', replaced_by: 'hub.health', stops_serving: 'R3' });
    expect(probe.result, 'and its result is the replacement\'s').toEqual({ ok: true, echo: { n: 1 } });
    const problem = environmentProblem([load()]);
    if (problem) { console.log(`INCONCLUSIVE: ${problem}: the adapter's cost was not measured`); ctx.skip(`INCONCLUSIVE: ${problem}`); return; }
    const p95s: number[] = [];
    for (let run5 = 0; run5 < 5; run5++) {
      const deltas: number[] = [];
      for (let i = 0; i < 30_000; i++) {
        const t0 = process.hrtime.bigint();
        adapter.serve('hub.ping', { n: i }, call);
        const t1 = process.hrtime.bigint();
        call('hub.health', { n: i });
        const t2 = process.hrtime.bigint();
        if (i >= 2_000) deltas.push((Number(t1 - t0) - Number(t2 - t1)) / 1000);
      }
      p95s.push(percentile(deltas, 95));
    }
    const j = judge('the adapter\'s p95 over a direct call', p95s, 50, 'µs');
    if (j.verdict === 'INCONCLUSIVE') { console.log(`INCONCLUSIVE: ${j.text}`); ctx.skip(`INCONCLUSIVE: ${j.text}`); return; }
    expect(j.verdict, j.text).toBe('PASS');
  }, 300_000);
});
