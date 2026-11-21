// AC8 #280.60cc3f22: Budgets, on the reference Mac in the local preflight, compared with the merge base: net.feel's
// 3,600-step run of eight copies and net.budget's report are recorded as readings in minutes, and a piece without the
// net module gains no work
//
// "In the local preflight, compared with the merge base" is the budget window's (docs/parallel-proof.md §12a: it
// measures each task of `benchmarks/budgets.json` against each commit's merge base, and a criterion that says "in the
// local preflight" is met by its record once a task names it). So the first test reads `benchmarks/budgets.json`: the
// lane accepts it against the merge base's copy, and its tasks naming this criterion run a node benchmark, record
// net.feel's run and net.budget's report as readings (no limit), and name a piece without the net module. The second
// takes the readings here, on a reference Mac at rest (INCONCLUSIVE, never a pass, elsewhere): net.feel's 3,600-step
// run of eight copies on the eight-seat fixture and net.budget's report on it, each timed on this test's clock and
// printed in minutes; and the eight-seat fixture without its net item (no net module named) shown at 60 s in this build
// and in the merge base's (built apart, as #550's suite builds it), five runs each, interleaved: by the five-run rule,
// this build's runs over the merge base's slowest by more than the margin (the larger of 5% and the runs' spread) in all
// five fail, within it in all five pass, anything else is INCONCLUSIVE. Wrong programs it fails: the merge base (no
// net.feel, no task names the criterion); a net module whose work reaches a piece that doesn't use it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEEL_STEPS, QUIET, SEATS, eightDoc, feel, seededMoves, type JsonObject } from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, baseBuild, budgetRun, inconclusive, isObject, none, playFeel, presented, putProgram, runShow, scenario, show, timingProblem, useBuilds, useChildren, useTemp, windowOf,
} from './helpers.ts';
import { REPO } from '../549/helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const ID = AC[8].split(' ')[1]!;
const RUNS = 5;

const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
/** The merge base's `benchmarks/budgets.json`, as the lane compares it. */
function baseBudgets(): JsonObject {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', env: gitEnv(), maxBuffer: 64 * 1024 * 1024 }).trim();
  const base = git('merge-base', 'HEAD', 'origin/main');
  return JSON.parse(git('show', `${base}:benchmarks/budgets.json`)) as JsonObject;
}
interface Bench { validateBudgets: (current: unknown, base: unknown) => unknown }
const minutes = (ms: number): number => Math.round((ms / 60_000) * 1000) / 1000;
/** One `deep-show run` that shows the piece without its net item at 60 s; its wall time in ms. */
async function shownAt60(bin: string, evidence: string, what: string): Promise<number> {
  const document = eightDoc({ net: false });
  const doc = String(document['id']);
  const s = new Script();
  const k = s.add({ call: 'deep show', peer: { pid: 3002, start: 3_000 }, doc, document, t: '60s', include: ['issues'] }, 0.001);
  const t0 = performance.now();
  const r = await runShow(bin, scenario(evidence, [doc], s.calls), what);
  const ms = performance.now() - t0;
  presented(r[k], `${what}: the piece without the net module`);
  return ms;
}

describe(`${AC[8]} net.feel's and net.budget's readings, and no work for a piece without the net module`, () => {
  it(`${AC[8]} benchmarks/budgets.json records net.feel's run and net.budget's report as readings and a piece without the net module, in tasks naming this criterion, so the budget window measures them against the merge base`, async () => {
    const b = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
    const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
    expect(() => b.validateBudgets(budgets, baseBudgets()), 'the lane accepts benchmarks/budgets.json against the merge base\'s').not.toThrow();
    const tasks = (Array.isArray(budgets['tasks']) ? budgets['tasks'] : []).filter(isObject).filter((t) => Array.isArray(t['criteria']) && t['criteria'].includes(ID));
    const f: string[] = [];
    if (!tasks.length) f.push(`AC8: no task of benchmarks/budgets.json names ${ID} in its criteria`);
    for (const t of tasks) {
      const cmd = Array.isArray(t['command']) ? t['command'].map(String) : [];
      if (cmd[0] !== 'node' || !cmd[1] || !existsSync(join(REPO, cmd[1]))) f.push(`AC8: task ${String(t['id'])} doesn't run a node benchmark in this checkout: ${show(cmd)}`);
    }
    const text = (t: JsonObject): string => `${String(t['id'])} ${JSON.stringify(t['command'])} ${String(t['initialReason'] ?? '')}`;
    for (const [what, word] of [['net.feel\'s 3,600-step run of eight copies', /net\.feel/], ['net.budget\'s report', /net\.budget/]] as const) {
      const named = tasks.filter((t) => word.test(text(t)));
      if (!named.length) f.push(`AC8: no task naming ${ID} records ${what}`);
      for (const t of named) if (isObject(t['limits']) && Object.keys(t['limits']).length) f.push(`AC8: task ${String(t['id'])} holds ${what} to limits ${show(t['limits'])}, where the criterion records it as a reading`);
    }
    if (!tasks.some((t) => /without the net module|no net module|without net/i.test(text(t)))) f.push(`AC8: no task naming ${ID} measures a piece without the net module`);
    none(f, 'the budget window records the criterion\'s readings against the merge base');
  }, TIMEOUT);

  it(`${AC[8]} on the reference Mac: net.feel's 3,600-step run of eight copies and net.budget's report recorded as readings in minutes, and a piece without the net module gaining no work against the merge base`, async () => {
    const plays = seededMoves(FEEL_STEPS);
    let t0 = performance.now();
    const felt = await playFeel(builds.show(), temp(), 'AC8 net.feel\'s run', { document: eightDoc(), steps: FEEL_STEPS, plays, feel: feel(QUIET) });
    const feelMs = performance.now() - t0;
    expect(felt.copies.every((c) => c.ran === FEEL_STEPS), `net.feel's run plays all ${FEEL_STEPS} steps on each of the ${SEATS} copies: ${show(felt.copies.map((c) => c.ran))}`).toBe(true);
    t0 = performance.now();
    const budget = await budgetRun(builds.show(), temp(), 'AC8 net.budget\'s report', { document: eightDoc(), steps: 600, plays: seededMoves(600), on: ['app'] });
    const budgetMs = performance.now() - t0;
    windowOf(budget, 'app', 'AC8');
    const readings = { net_feel_run_minutes: minutes(feelMs), net_budget_report_minutes: minutes(budgetMs) };
    console.log(`AC8 readings: ${JSON.stringify(readings)}`);
    const problem = timingProblem();
    if (problem) inconclusive(`AC8: readings ${JSON.stringify(readings)} taken, but a budget counts only on a reference Mac at rest (${problem})`);
    // A piece without the net module, here and at the merge base, five runs each, interleaved.
    const base = baseBuild();
    const evidence = temp();
    putProgram(evidence);
    const [here, there]: [number[], number[]] = [[], []];
    for (let i = 0; i < RUNS; i++) {
      here.push(await shownAt60(builds.show(), evidence, `AC8 this build, run ${i + 1}`));
      there.push(await shownAt60(base.bin, evidence, `AC8 the merge base ${base.sha.slice(0, 12)}, run ${i + 1}`));
    }
    const slowest = Math.max(...there);
    const spread = Math.max(Math.max(...here) - Math.min(...here), slowest - Math.min(...there));
    const margin = Math.max(0.05 * slowest, spread);
    const said = `this build ${JSON.stringify(here.map(Math.round))} ms, the merge base ${JSON.stringify(there.map(Math.round))} ms, margin ${Math.round(margin)} ms`;
    console.log(`AC8 a piece without the net module at 60 s: ${said}`);
    if (here.every((x) => x > slowest + margin)) none([`AC8: a piece without the net module takes more work in this build than at the merge base: ${said}`], 'no work gained');
    if (!here.every((x) => x <= slowest + margin)) inconclusive(`AC8: the five runs don't decide: ${said}`);
  }, TIMEOUT);
});
