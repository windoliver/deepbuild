// AC7 #155.3c3c0a49: "Budgets, on the reference Mac in the local preflight, compared with the merge base: rendering
// every preset's variants takes under 30 s on the reference Mac, and 32 spawned voices play with no underrun over 10
// minutes"
//
// Split as #154's, #204's and #501's budget suites are: the merge-base comparison is the perf lane's
// (benchmarks/budgets.json has a task whose reason names #155.3c3c0a49, valid against the merge base's budgets,
// scripts/benchmark.mjs `validateBudgets`); the issue's limits are judged here, counted only on a reference Mac in a
// fit state, and INCONCLUSIVE anywhere else, never a pass.
//   - Every preset's variants: a media document pinning deepbuild/foley@1.0.0 with one generator strip per preset
//     (90, each on its variant l1r1) is planned with foley_plan: 90 foley.render jobs. In a fresh hub (an empty cache,
//     so every job is a miss) the 90 deep_job calls are made at once and timed from the first call to the last reply.
//     One warm-up world, then, only where the perf lane's `judgeLimit` says this machine can judge a timing, five more
//     fresh worlds; `judgeLimit` over the five against 30 s must PASS.
//   - 32 voices: foley.metal.hit rendered; a media document whose baked list `burst.occurrences` holds, every 0.25 s
//     for 600 s, 32 hits of 32 pairs at once, and a spawn with `max_voices: 32` playing the variant at level 3.
//     `media_mix` over its first second shows 32 voices starting at 0; then, on a reference Mac in a fit state only,
//     `deep-show run`'s `soak` (#501, #525) plays it live on the default output for 600 s and its gate stats must
//     show no underrun. No output device: BLOCKED.
// The merge base fails each leg before any timing: no budget task names the criterion, and no foley renderer installs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { referenceMacProblem } from '../501/helpers.ts';
import {
  AC, ACTIONS, MATERIALS, PACK_REF, REPO, TIMEOUT, blocked, cacheOf, deepJob, done, foleyPlanCall, foleyPlanOf, generator, inconclusive, installFoley, installedOk,
  int, jobArgs, jobId, mixCall, mixOf, obj, openWorld, proof, runShow, scenario, secs, show, useShow, variantsOf, type JsonObject, type Line, type PlanJob,
  type World,
} from './helpers.ts';

const bin = useShow();
const LIMIT_MS = 30_000;
const SOAK_S = 600;
const VOICES = 32;

interface Task { id: string; initialReason?: string; changeReason?: string }
interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: string; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;

/** A document that reaches every preset: one generator strip per (material, action). */
function everyPreset(): JsonObject {
  const strips: JsonObject = {};
  let track = 0;
  for (const m of MATERIALS) for (const a of ACTIONS) strips[`${m}_${a}`] = { track: track++, src: generator(jobId(m, a), 'l1r1'), start: 0, in: 0 };
  return { transport: { sample_rate: 48_000, span: secs(2) }, packs: [PACK_REF], strips };
}
async function planAll(w: World): Promise<Record<string, PlanJob>> {
  const [installed, planned] = runShow(bin(), scenario(w.evidence, [installFoley(), foleyPlanCall(everyPreset())]), 'every preset planned');
  installedOk(installed, 'install_pack of deepbuild/foley');
  const plan = foleyPlanOf(planned, 'foley_plan of every preset');
  const want = MATERIALS.flatMap((m) => ACTIONS.map((a) => jobId(m, a))).sort();
  expect(Object.keys(plan).sort(), 'foley_plan answers one job per preset').toEqual(want);
  return plan;
}
/** The 90 jobs at once in a fresh world: the time from the first call to the last reply, each a done miss. */
async function renderAll(): Promise<number> {
  const w = await openWorld({ foley: true });
  const plan = await planAll(w);
  const ids = Object.keys(plan).sort();
  const t0 = performance.now();
  const outcomes = await Promise.all(ids.map((id) => deepJob(w, jobArgs(plan[id]!))));
  const ms = performance.now() - t0;
  const bad = ids.filter((_, i) => !(done(outcomes[i]!) && cacheOf(outcomes[i]!) === 'miss'));
  expect(bad, `every preset's twelve variants render fresh: ${bad.slice(0, 5).map((id) => `${id}: ${outcomes[ids.indexOf(id)]!.text.slice(0, 300)}`).join(' | ')}`).toEqual([]);
  ids.forEach((id, i) => variantsOf(outcomes[i]!, `the run of ${id}`));
  return ms;
}

describe(`${AC[7]} budgets: every preset's variants under 30 s, 32 spawned voices with no underrun over 10 minutes`, () => {
  it(`${AC[7]} the perf lane has a task whose reason names #155.3c3c0a49, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: Task[] };
    expect(current.tasks.some((t) => /#155\.3c3c0a49\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), 'benchmarks/budgets.json has a task whose reason names #155.3c3c0a49 (the merge-base comparison)').toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  }, TIMEOUT);

  it(`${AC[7]} on the reference Mac rendering every preset's variants (90 jobs at once, each fresh) takes under 30 s, judged by the perf lane's rule over five runs after a warm-up`, async () => {
    const warm = await renderAll();
    const bench = await benchmark();
    const now = () => Array.from({ length: 5 }, () => ({ start: loadavg()[0]!, end: loadavg()[0]! }));
    const here = bench.judgeLimit({ limit: LIMIT_MS, runs: [0, 0, 0, 0, 0], fingerprint: bench.fingerprint(), loads: now() });
    if (here.status !== 'PASS') inconclusive(`the 30 s limit is judged only on a reference Mac in a fit state, so the five timed renders aren't made here: ${String(here.reason)} (the warm-up took ${(warm / 1000).toFixed(1)} s)`);
    const runs: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < 5; k++) {
      const start = loadavg()[0]!;
      runs.push(await renderAll());
      loads.push({ start, end: loadavg()[0]! });
    }
    const verdict = bench.judgeLimit({ limit: LIMIT_MS, runs, fingerprint: bench.fingerprint(), loads });
    proof('ac7-render.json', { warm, runs, loads, verdict });
    expect(verdict.status, `every preset's variants against 30 s: ${JSON.stringify(verdict)}`).not.toBe('FAIL');
    expect(verdict.status, `every preset's variants against 30 s: ${JSON.stringify(verdict)}`).not.toBe('BLOCKED');
    if (verdict.status !== 'PASS') inconclusive(`the timing: ${JSON.stringify(verdict)}`);
  }, 8 * TIMEOUT);

  it(`${AC[7]} on the reference Mac 32 spawned voices of foley.metal.hit play live for 600 s with no underrun`, async () => {
    const w = await openWorld({ foley: true });
    const rows: JsonObject[] = [];
    for (let b = 0; b < SOAK_S * 4; b++) for (let j = 0; j < VOICES; j++) rows.push({ t: b * secs(0.25), kind: 'hit', a: j + 1, b: 1000 + j });
    const media: JsonObject = {
      transport: { sample_rate: 48_000, span: secs(SOAK_S) }, packs: [PACK_REF], strips: {}, buses: { master: { gain: -20 } },
      occurrences: { 'burst.occurrences': rows },
      spawns: { burst: { on: { list: 'burst.occurrences' }, play: { src: generator('foley.metal.hit', 'variant') }, pick: 'by_variant', variant: '3', round_robin: 'hash', cooldown: 0, max_voices: VOICES, steal: 'oldest', seed: 155 } },
    };
    const [installed, planned] = runShow(bin(), scenario(w.evidence, [installFoley(), foleyPlanCall(media)]), 'the 32-voice soak planned');
    installedOk(installed, 'install_pack of deepbuild/foley');
    const plan = foleyPlanOf(planned, 'foley_plan of the soak');
    const o = await deepJob(w, jobArgs(plan['foley.metal.hit']!));
    variantsOf(o, 'the run of foley.metal.hit');
    const jobs: Line[] = [o.value];
    const asks = [{ from: 0, to: secs(1) }];
    const [, first] = runShow(bin(), scenario(w.evidence, [installFoley(), mixCall(media, asks)], { jobs }), 'the soak\'s first second');
    const m = mixOf(first, asks, 'the soak\'s first second');
    expect(m.voices.filter((v) => v.start === 0).length, 'the first burst starts 32 voices at once').toBe(VOICES);

    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the 600 s soak counts only on a reference Mac in a fit state, so it isn't run here: ${problem}`);
    const [soak] = runShow(bin(), scenario(w.evidence, [installFoley(), { call: 'soak', media, seconds: SOAK_S }], { jobs }), 'the 32-voice soak', (SOAK_S + 600) * 1000).slice(1);
    const r = obj(soak, 'soak');
    if (r['outcome'] === 'refused' && r['code'] === 'no_output') blocked(`this Mac has no sound output to play the soak on: ${show(r)}`);
    expect(r['outcome'], `the soak played: ${show(r)}`).toBe('played');
    expect(int(r['seconds'], 'soak.seconds'), 'it played the whole 600 s').toBe(SOAK_S);
    const underruns = int(obj(r['stats'], 'soak.stats')['underruns'], 'soak.stats.underruns');
    proof('ac7-soak.json', r);
    expect(underruns, `no underrun over ${SOAK_S} s with ${VOICES} spawned voices: ${show(r['stats'])}`).toBe(0);
  }, 2 * TIMEOUT);
});
