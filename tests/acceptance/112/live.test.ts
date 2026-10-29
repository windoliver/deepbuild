// The live eval: real agents on your plan, judged by a real model of another family, on 20 real past tasks you
// exported from your transcript archive. It spends plan usage for up to two hours, so it runs only by hand:
//   DEEP_EVAL_LIVE=1 DEEP_EVAL_INPUT=<input.json> node node_modules/vitest/vitest.mjs run --root tests/acceptance/112 live.test.ts
// Without DEEP_EVAL_LIVE=1, or without an input file, both tests skip with the reason; neither ever passes by
// skipping. Off a reference Mac (Mac15,7 or Mac15,12, on mains power, Low Power Mode off, thermal state nominal),
// or with no plan-window reading, the budget test skips as INCONCLUSIVE with what it read (README: The live run).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AC6, agentMarks, evalModule, HOUR, removeRoots, tempDir, type EvalReport, type ReplayPlan, type ReplayTask } from './helpers.ts';

afterAll(removeRoots);
const LIVE = process.env.DEEP_EVAL_LIVE === '1';
const INPUT = process.env.DEEP_EVAL_INPUT;
const skipped = !LIVE
  ? 'skipped: it spends plan usage for up to two hours; run it by hand with DEEP_EVAL_LIVE=1 and DEEP_EVAL_INPUT=<input.json>'
  : !INPUT || !existsSync(INPUT) ? `skipped: DEEP_EVAL_INPUT names no input file (${INPUT ?? 'unset'}); README: The live run says what it holds` : undefined;

const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this Mac's numbers are a reading only, or null on a reference Mac on mains, Low Power Mode off, nominal. */
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  try {
    const model = sh('sysctl', '-n', 'hw.model'), chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    const gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
    const batt = sh('pmset', '-g', 'batt');
    if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
    const lpm = /^\s*lowpowermode\s+(\d)/m.exec(sh('pmset', '-g'));
    if (!lpm || lpm[1] !== '0') return `Low Power Mode is ${lpm ? 'on' : 'unknown'}`;
    const therm = sh('pmset', '-g', 'therm');
    if (!/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  return null;
}

interface Input { plan: ReplayPlan; tasks: ReplayTask[] }
let input: Input | undefined;
let report: EvalReport | undefined;
let elapsed = 0;
let failure: unknown;
const machine = environmentProblem();

beforeAll(async () => {
  if (skipped) return;
  try {
    input = JSON.parse(readFileSync(INPUT!, 'utf8')) as Input;
    const ev = await evalModule();
    const root = tempDir('dh112-live-');
    // The eval's environment is yours, less the opt-in that starts this test: nothing in it may mark an eval.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEEP_EVAL_')));
    const t0 = performance.now();
    report = await ev.runEval({ plan: input.plan, tasks: input.tasks, root, env });
    elapsed = performance.now() - t0;
    const out = process.env.DEEP_EVAL_OUT ?? join(root, 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'report.json'), `${JSON.stringify({ elapsed_ms: elapsed, machine: machine ?? 'reference Mac', report }, null, 2)}\n`);
    console.log(`live eval report: ${join(out, 'report.json')}`);
  } catch (e) {
    failure = e;
  }
}, 3 * HOUR);

describe(`AC6 ${AC6} an eval of 20 tasks finishes in under 2 hours, within its stated plan share`, () => {
  it(`AC6 ${AC6} on the reference Mac, 20 real tasks replayed end to end in under 2 hours and within the plan's stated share of the 5-hour window`, (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(failure, 'the live eval ran').toBeUndefined();
    const plan = input!.plan;
    expect(plan.tasks.length, 'an eval of 20 tasks').toBe(20);
    expect(plan.budget.ms, "the plan's stated time is within 2 hours").toBeLessThanOrEqual(2 * HOUR);
    const r = report!;
    expect(r.after.outcome, `the eval ran (${r.after.reason})`).not.toBe('refused');
    console.log(`AC6 elapsed ${(elapsed / 60_000).toFixed(1)} min against ${(plan.budget.ms / 60_000).toFixed(0)} min; plan share ${r.usage.plan_share ?? 'not read'} against ${plan.budget.plan_share}; ${machine ?? 'reference Mac'}`);
    if (machine) ctx.skip(`INCONCLUSIVE (reading only): ${machine}`);
    expect(elapsed, 'it finished within the plan\'s stated time, under 2 hours').toBeLessThan(plan.budget.ms);
    if (r.usage.plan_share === null) ctx.skip('INCONCLUSIVE: no plan-window reading before and after the eval, so its share is unknown');
    expect(r.usage.plan_share!, "it used no more than the plan's stated share of the 5-hour window").toBeLessThanOrEqual(plan.budget.plan_share);
  });
});

describe('Proof an instruction-file change replayed on 20 real tasks, with its graded results', () => {
  it('Proof the change to an instruction file, replayed on 20 real tasks after its cutoff, every repeat of each side graded by a judge of another family', (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(failure, 'the live eval ran').toBeUndefined();
    const { plan, tasks } = input!;
    const r = report!;
    const files = new Set([...Object.keys(plan.variants.base.files), ...Object.keys(plan.variants.change.files)]);
    const instruction = [...files].filter((f) => /(^|\/)(CLAUDE|AGENTS)\.md$/.test(f) && plan.variants.base.files[f] !== plan.variants.change.files[f]);
    expect(instruction.length, 'the change edits an instruction file (CLAUDE.md or AGENTS.md)').toBeGreaterThan(0);
    expect(plan.tasks.length, '20 tasks').toBe(20);
    for (const id of plan.tasks) expect(tasks.find((t) => t.id === id)!.at, `${id} is after the cutoff`).toBeGreaterThan(plan.cutoff);
    expect(typeof r.hash === 'string' && r.hash.length > 0, 'the report carries the hash of the plan frozen before either side ran').toBe(true);
    expect(r.runs.filter((x) => x.plan !== r.hash).length, 'every run ran under that plan').toBe(0);
    expect(r.after.n, 'the deciding comparison counts all 20 tasks').toBe(20);
    expect(['adopt', 'regresses', 'INCONCLUSIVE'], `an outcome of the rule (${r.after.reason})`).toContain(r.after.outcome);
    for (const id of plan.tasks) {
      for (const side of ['base', 'change'] as const) {
        const runs = r.runs.filter((x) => x.task === id && x.side === side);
        expect(runs.map((x) => x.repeat).sort((a, b) => a - b), `${id} ${side}: each repeat once`).toEqual(Array.from({ length: plan.repeats }, (_, i) => i + 1));
        for (const run of runs.filter((x) => x.ok)) {
          const g = run.metrics.grade;
          expect(g === null || (typeof g === 'number' && g >= 0 && g <= 1), `${id} ${side} repeat ${run.repeat}: graded 0 to 1, or missing`).toBe(true);
        }
      }
    }
    const graded = r.runs.filter((x) => x.ok && typeof x.metrics.grade === 'number').length;
    expect(graded, 'most runs carry a grade').toBeGreaterThan(r.runs.length / 2);
    expect(agentMarks(r.hash).test(JSON.stringify(tasks.map((t) => t.prompt))), "the tasks' own words don't mention an eval").toBe(false);
    console.log(`Proof: ${r.after.outcome}, ${graded} of ${r.runs.length} runs graded; grade ${JSON.stringify(r.after.measures)}; broke ${JSON.stringify(r.after.broke)}`);
  });
});
