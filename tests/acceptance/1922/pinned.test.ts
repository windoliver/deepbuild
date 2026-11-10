// AC1: "deep_job runs only pinned tools, changes no document, and refuses a paid call without an authority ask or a
// standing rule"
//
// asserts: through a real hub with test/upper-kind installed, deep_job {op: run} of test.upper on "abc" naming no tool,
// a tool with no version, a major only, a range, a tag, or a version no plug-in registered is refused, returns no
// output and starts no process, while the pinned upper-a@1.0.0 runs and returns "ABC" by hash; across all of them the
// record gains no doc.patched event and no ask, and the project folder's files keep their bytes and modified times.
// A paid tool (upper-paid@1.0.0, cost 0.02 USD a run) is held with exactly one authority ask naming it and its cost,
// starting no process while it waits, called again or not; your yes runs it once (one process, "ABC"); and after your
// standing rule for it (job.rule), a run on another input completes with no ask.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  asks, BASE_PARAMS, brief, counted, done, events, input, job, KIND, kindWorld, lastPos, must, mustInstall, outputOf, proof, refused, runJob, sha256, sleep,
  snapshot, TOOL_A, toolPlugin, yes, type Run,
} from './helpers.ts';

const PAID = 'upper-paid@1.0.0';

describe('#1922.3a2c91a2 deep_job runs only pinned tools, changes no document, and refuses a paid call without an authority ask or a standing rule', () => {
  it('a run naming no tool, a tool with no version, a range or tag, or a version no plug-in registered is refused and starts no process; the pinned tool runs; no document changes', async () => {
    const w = await kindWorld();
    const file = input(w, 'in.txt', 'abc');
    const before = snapshot(w.project);
    const pos = await lastPos(w);
    const tried: { tool: string | null; started: number; reply: unknown }[] = [];
    for (const tool of [null, 'upper-a', 'upper-a@1', 'upper-a@^1.0.0', 'upper-a@latest', 'upper-a@2.0.0']) {
      const r = await runJob(w, tool, BASE_PARAMS, file);
      tried.push({ tool, started: r.started, reply: r.outcome.value });
      expect(refused(r.outcome) && outputOf(r.outcome) === undefined, `deep_job refuses a run of ${KIND} with tool ${JSON.stringify(tool)}, which isn't a registered name@version: ${brief(r)}`).toBe(true);
      expect(r.started, `the refused run with tool ${JSON.stringify(tool)} starts no process`).toBe(0);
    }
    const pinned = await runJob(w, TOOL_A, BASE_PARAMS, file);
    proof('ac1-pinned.json', { tried, pinned: { started: pinned.started, reply: pinned.outcome.value } });
    expect(done(pinned.outcome) && outputOf(pinned.outcome) === sha256('ABC'), `the pinned ${TOOL_A} runs on "abc" and returns "ABC" by hash: ${brief(pinned)}`).toBe(true);
    expect(pinned.started, `the pinned run starts one process: ${brief(pinned)}`).toBe(1);
    const after = await events(w, pos);
    expect(after.filter((e) => e.kind === 'doc.patched'), 'no job changed a document: the record gained no doc.patched event').toEqual([]);
    expect(after.filter((e) => e.kind === 'ask.created'), 'an unpaid tool runs with no ask').toEqual([]);
    expect(snapshot(w.project), 'the project folder holds the same files, with the same bytes and modified times').toEqual(before);
  }, 900_000);

  it('a paid tool is held with one authority ask and starts no process until your yes; after your standing rule it runs with no ask', async () => {
    const w = await kindWorld();
    await mustInstall(w, toolPlugin(join(w.tmp, 'paid'), { id: 'test/upper-paid', tool: 'upper-paid', cost: { usd: 0.02 } }));
    const file = input(w, 'in.txt', 'abc');
    const pos = await lastPos(w);
    const first = await runJob(w, PAID, BASE_PARAMS, file);
    const second = await runJob(w, PAID, BASE_PARAMS, file);
    const raised = await asks(w, pos);
    proof('ac1-paid-held.json', { first: first.outcome.value, second: second.outcome.value, asks: raised });
    expect(first.outcome.value.status, `the paid run without an ask answered or a rule is held, not run: ${brief(first)}`).toBe('held');
    expect(second.outcome.value.status, `called again before your answer, it is still held: ${brief(second)}`).toBe('held');
    expect(first.started + second.started, 'no process starts while the paid run waits').toBe(0);
    expect(raised.map((a) => a.kind), 'the two calls raised exactly one ask, an authority ask').toEqual(['authority']);
    const ask = raised[0]!;
    expect(first.outcome.value.ask, 'the held reply names its ask').toBe(ask.handle);
    expect(ask.text.includes('upper-paid'), `the authority ask names the tool: ${ask.text.slice(0, 600)}`).toBe(true);
    expect(/(^|[^0-9])0\.02([^0-9]|$)/.test(ask.text), `the authority ask names the cost, 0.02 USD: ${ask.text.slice(0, 600)}`).toBe(true);

    const answered = await yes(w, ask);
    expect(answered.code, 'deep inbox answer took your yes').toBe(0);
    const runs: Run[] = [];
    const deadline = Date.now() + 300_000;
    for (;;) {
      const r = await counted(w, () => job(w, { op: 'run', kind: KIND, tool: PAID, params: BASE_PARAMS, inputs: [{ name: 'text', path: file }] }));
      runs.push(r);
      if (r.outcome.value.status !== 'held' || Date.now() > deadline) break;
      await sleep(1000);
    }
    const last = runs[runs.length - 1]!;
    proof('ac1-paid-yes.json', runs.map((r) => ({ started: r.started, reply: r.outcome.value })));
    expect(done(last.outcome) && outputOf(last.outcome) === sha256('ABC'), `after your yes the paid run is done with "ABC" by hash: ${brief(last)}`).toBe(true);
    expect(runs.reduce((n, r) => n + r.started, 0), 'your yes ran it once: one process').toBe(1);
    expect((await asks(w, pos)).length, 'no second ask was raised').toBe(1);

    // Your yes covered that call alone: another paid call is held again, until your standing rule.
    const other = input(w, 'other.txt', 'xyz');
    const unruled = await runJob(w, PAID, BASE_PARAMS, other);
    expect(unruled.outcome.value.status, `a paid run on another input, with no rule yet, is held again: ${brief(unruled)}`).toBe('held');
    expect(unruled.started, 'and starts no process').toBe(0);
    await must(w, 'job.rule', { tool: PAID, usd: 0.05 });
    const ruledFrom = await lastPos(w);
    const ruled = await runJob(w, PAID, BASE_PARAMS, other);
    proof('ac1-paid-rule.json', { started: ruled.started, reply: ruled.outcome.value });
    expect(done(ruled.outcome) && outputOf(ruled.outcome) === sha256('XYZ'), `under your standing rule the paid run on "xyz" is done with "XYZ" by hash: ${brief(ruled)}`).toBe(true);
    expect(ruled.started, 'it started one process').toBe(1);
    expect(await asks(w, ruledFrom), 'under your standing rule no ask is raised').toEqual([]);
  }, 900_000);
});
