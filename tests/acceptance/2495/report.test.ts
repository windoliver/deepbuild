// A configuration eval's report reaches the evidence store, by hash through the hub, and a learned change widening to
// its repo cites it (issue #2495). Each world runs the real `scripts/config-eval.mjs run` against a real hub, with fake
// agent executables on PATH, then reads the hub's store and puts the learned layer's check to the stored report.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCAL_FIRST, handleOf, layerRow, learn, openWorld as openRecordWorld, removeRoots, said, sliceText, startSession, utf8 } from '../112/helpers.ts';
import { HANDLE, PLAN_ID, openWorld, runEvalScript, sha256, storeOf, type Ran, type World } from './helpers.ts';

let hub: World;
let adopts: Ran;
let regresses: Ran;
beforeAll(async () => {
  hub = await openWorld();
  adopts = runEvalScript(hub, PLAN_ID, true);
  regresses = runEvalScript(hub, `${PLAN_ID}-worse`, false);
}, 600_000);
afterAll(async () => { await hub?.stop(); removeRoots(); });

/** The handle a run printed, after checking the fixture's eval finished as it says. */
function handleOfRun(r: Ran, outcome: 'adopt' | 'regresses'): string {
  expect(r.kept, `the run kept its report under ~/.deepbuild/evals/ (output: ${r.out})`).toBeDefined();
  expect(r.kept.after.outcome, `the fixture's eval reads ${outcome} (output: ${r.out})`).toBe(outcome);
  const sha = HANDLE.exec(r.out)?.[1];
  expect(sha, `the run prints the report's ev:<sha256> handle (output: ${r.out})`).toBeDefined();
  return `ev:${sha}`;
}

describe('#2495 AC1 the evidence store holds the report, and the handle the run prints resolves to it', () => {
  it('stores the frozen plan and every run by hash, and keeps the file the preflight reads', async () => {
    const handle = handleOfRun(adopts, 'adopt');
    const store = await storeOf(adopts.hubRoot);
    const sha = handle.slice(3);
    expect(await store.get(sha), `the hub's evidence store holds ${handle}`).toBeDefined();
    const bytes = await store.read(sha);
    expect(sha256(bytes), 'the handle is the hash of the bytes it resolves to').toBe(sha);
    const stored = JSON.parse(Buffer.from(bytes).toString('utf8')) as Ran['kept'];
    expect(stored.plan, 'the stored report holds the frozen plan').toEqual(adopts.input.plan);
    expect(stored.runs, 'and every run: three tasks, two repeats, two sides').toHaveLength(12);
    expect(stored, 'it is the report the file under ~/.deepbuild/evals/ holds').toEqual(adopts.kept);
  }, 60_000);
});

describe('#2495 AC2 a learn.widened change by the local-first rule that cites the handle', () => {
  /** The report's bytes, read back from the hub's store, as a record over its own evidence store holds them. */
  async function widening(r: Ran, handle: string, target: string, line: string) {
    const bytes = await (await storeOf(r.hubRoot)).read(handle.slice(3));
    const w = await openRecordWorld();
    const put = await w.store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes: utf8(Buffer.from(bytes).toString('utf8')), kind: 'replay', source: 'deepbuild', redaction: 'complete', license: { name: 'own', allows: [] } });
    expect(put.status).toBe('stored');
    expect((put as { evidence: { sha256: string } }).evidence.sha256, 'the same bytes have the same handle').toBe(handle.slice(3));
    const first = await startSession(w, 'shop', [{ id: 'm1', text: `${line} That's how it works here.` }]);
    const applied = await learn(w, 'learn.applied', { target, diff: `+ ${line}`, evidence: [{ at: said(first, 'm1'), quote: line }], scope: `session:${first}` }, LOCAL_FIRST);
    expect((await layerRow(w, applied)).state, 'the change applies to the session it came from').toBe('applied');
    const widened = await learn(w, 'learn.widened', {
      target, diff: `+ ${line}`, evidence: [{ at: handle, quote: r.input.plan.id }], scope: 'repo:shop',
      replay: { tasks: 3, regressions: 0 }, supersedes: await handleOf(w, applied),
    }, LOCAL_FIRST);
    return { w, row: await layerRow(w, widened) };
  }

  it('passes the check when the report adopts: the repo reads it', async () => {
    const line = 'Run npm run seed before the e2e tests.';
    const { w, row } = await widening(adopts, handleOfRun(adopts, 'adopt'), 'slice:seed-first', line);
    expect(row.state, `the widening on the stored report is in force (reason: ${String(row.reason)})`).toBe('applied');
    const later = await startSession(w, 'shop', [{ id: 'm1', text: 'Start on the checkout page.' }]);
    expect(await sliceText(w, later), 'a later session in the repo reads it').toContain(line);
    await w.record.close();
  }, 120_000);

  it('is refused naming the outcome when the report does not adopt: the repo does not read it', async () => {
    const line = 'Run npm run seed before the e2e tests.';
    const { w, row } = await widening(regresses, handleOfRun(regresses, 'regresses'), 'slice:seed-first', line);
    expect(row.state, 'the widening on a regressing report is not in force').not.toBe('applied');
    expect(String(row.reason), 'its reason names the outcome').toMatch(/regresses/);
    const later = await startSession(w, 'shop', [{ id: 'm1', text: 'Start on the checkout page.' }]);
    expect(await sliceText(w, later), 'a later session in the repo does not read it').not.toContain(line);
    await w.record.close();
  }, 120_000);
});
