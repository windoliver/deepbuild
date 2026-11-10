// AC4 #501.20b3a55a: "Budgets, on the reference Mac in the local preflight, compared with the merge base: no audio
// underruns over 10 minutes with 32 voices; the media worker stays under 200 MB"
//
// Two parts. The merge-base comparison is the perf lane's: benchmarks/budgets.json has a task whose reason names #501,
// valid against the merge base's budgets (scripts/benchmark.mjs `validateBudgets`, as #66's suite checks it). The
// issue's limits: `deep-show run`'s `soak` plays a media document of 32 looping voices live through the device gate on
// this machine's default output for 600 s of real time and answers the gate's `stats` (Device gate: `stats: {underruns,
// underrun_time, latency}`); while it runs, this suite reads the resident memory of every media worker the run starts
// with `ps` once a second (helpers.ts `watchRun`). Both limits count only on a reference Mac on mains power with Low
// Power Mode off and the thermal state nominal; anywhere else the 10-minute run isn't made and the test is
// INCONCLUSIVE. With no output device the test is BLOCKED.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, REPO, TIMEOUT, blocked, fl, inconclusive, int, n, obj, putEvidence, referenceMacProblem, show, tone, useShow, useTemp, watchRun, wav16,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const SECONDS = 600;
const VOICES = 32;
const LIMIT_BYTES = 200_000_000;

interface Task { id: string; initialReason?: string; changeReason?: string }

describe(`${AC[4]} budgets: no underruns over 10 minutes with 32 voices, the media worker under 200 MB`, () => {
  it(`${AC[4]} the perf lane has a task naming #501 valid against the merge base's budgets, and on a reference Mac 32 voices play 600 s with no underrun while the media worker stays under 200 MB`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    expect(current.tasks.some((t) => /#501\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), 'benchmarks/budgets.json has a task whose reason names #501').toBe(true);

    const bin = shows.bin(FULL);
    const problem = await referenceMacProblem(true);
    if (problem) inconclusive(`the 600 s soak counts only on a reference Mac in a fit state, so it isn't run here: ${problem}`);

    const evidence = temp();
    const strips: JsonObject = {};
    for (let v = 0; v < VOICES; v++) {
      const sha = putEvidence(evidence, wav16([tone(220 + 17 * v, 96_000, 0.02), tone(230 + 17 * v, 96_000, 0.02)]));
      strips[`v${v}`] = { track: v + 1, src: { asset: sha }, start: 0, in: 0, out: fl(2), loop: true, span: fl(SECONDS) };
    }
    const media: JsonObject = { transport: { sample_rate: 48_000, span: fl(SECONDS) }, strips };
    const run = await watchRun(bin, { evidence, calls: [{ call: 'soak', media, seconds: SECONDS }] }, (SECONDS + 300) * 1000);
    expect(run.status, `deep-show run exits 0; stderr: ${run.stderr.slice(-1500)}`).toBe(0);
    const reply = obj((obj(JSON.parse(run.stdout.trim().split('\n')[0]!) as JsonValue, 'the answer')['replies'] as JsonValue[])[0], 'soak');
    if (reply['outcome'] === 'refused' && reply['code'] === 'no_output') blocked(`this Mac has no sound output to play the soak on: ${show(reply)}`);
    expect(reply['outcome'], `the soak played: ${show(reply)}`).toBe('played');
    expect(int(reply['seconds'], 'soak.seconds'), 'it played the whole 600 s').toBe(SECONDS);
    const underruns = int(obj(reply['stats'], 'soak.stats')['underruns'], 'soak.stats.underruns');
    expect(run.workerPeakBytes, `a media worker ran during the soak (seen: ${run.workers.join('; ') || 'none'})`).not.toBeNull();
    const reading = `${n(underruns)} underruns over ${SECONDS} s with ${VOICES} voices; media worker peak ${(run.workerPeakBytes! / 1e6).toFixed(1)} MB`;
    console.log(`${AC[4]}: ${reading}`);
    expect(underruns, `no audio underruns: ${reading}`).toBe(0);
    expect(run.workerPeakBytes!, `the media worker stays under 200 MB: ${reading}`).toBeLessThan(LIMIT_BYTES);
  }, TIMEOUT);
});
