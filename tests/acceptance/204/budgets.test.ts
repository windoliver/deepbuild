// AC8 #204.0458a4e3: "Budgets, on the reference Mac in the local preflight, compared with the merge base: 32 voices of
// an 8-node preset render under 10% of one core at 48 kHz, a restore and render forward to a seek's time take under
// 50 ms, and a document with no synth gains no work per block"
//
// AC14 #204.fe8c5ca9: "Budgets, on the reference Mac in the local preflight: the sweep of a pack of 50 presets with 4
// params each finishes in under 10 s"
//
// Split as #154's and #157's budget suites are: the merge-base comparison is the perf lane's (benchmarks/budgets.json
// has a task whose reason names #204.0458a4e3, valid against the merge base's budgets, so the preflight compares this
// change's timing with the merge base's on the same work, a document with no synth among it); the issue's limits are
// judged here by the repo's `judgeLimit`, five runs after a warm-up, counted only on a reference Mac on mains power with
// Low Power Mode off and the thermal state nominal, and INCONCLUSIVE anywhere else, never a pass.
//
// - 32 voices: one strip playing `drones.drone@1` (eight nodes, every one running for the whole span: a saw, a square
//   and pink noise mixed, a lowpass, a shaper, a delay, a gain) with `voices: 32`, rendered for 10 s by `media_mix`;
//   its report's `render_ms` *(chosen)*, the time its voices took, must be under 10% of the 10 s: 1,000 ms.
// - A seek: the same preset at one voice played to 10 s, then seeked back to 9.99 s, 0.99 s past its last checkpoint;
//   the segment's `seek_ms` *(chosen)*, the restore and the render forward to 9.99 s, must be under 50 ms.
// - The sweep: one `install_pack` of a pack of 50 presets, each with 4 params (a saw at `hz` through a lowpass at
//   `cutoff`, a shaper at `drive` and a gain at `level`), timed as the whole `deep-show run` around it from outside,
//   start to exit, so the process's own start counts against the sweep, never for it; it must be under 10 s. Each run is
//   a fresh process, so no run reuses another's check.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, TIMEOUT, biquad, delay, gain, inconclusive, installCall, installOf, int, mediaDoc, mix, mixes, noise, num, osc, presetOf, runTimed, secs, show,
  synthOf, synthStrip, useShow, useTemp, writePack, type PackFixture, type Preset,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();

/** Eight nodes; cost: 4 + 4 + 8 + 3 + 5 + 10 + 3 + 1. */
const DRONE: Preset = {
  nodes: {
    saw: osc('saw', 110), sub: osc('square', 55), hiss: noise('pink'), blend: mix(),
    filter: biquad('lowpass', 1800, 0.707), warm: { kind: 'shaper', curve: 'tanh', drive: 6, mix: 1 }, echo: delay(0.25, 0.3, 0.3), level: gain(0.03),
  },
  edges: [['saw', 'blend', 'in'], ['sub', 'blend', 'in'], ['hiss', 'blend', 'in'], ['blend', 'filter', 'in'], ['filter', 'warm', 'in'], ['warm', 'echo', 'in'], ['echo', 'level', 'in']],
  out: 'level', params: {}, cost: 38,
};
/** A sweep preset with four params; cost: 4 + 5 + 10 + 1. */
const swept = (k: number): Preset => ({
  nodes: { tone: osc('saw', 'hz'), filter: biquad('lowpass', 'cutoff', 0.707), warm: { kind: 'shaper', curve: 'tanh', drive: 'drive', mix: 1 }, level: gain('level') },
  edges: [['tone', 'filter', 'in'], ['filter', 'warm', 'in'], ['warm', 'level', 'in']],
  out: 'level',
  params: {
    hz: { unit: 'Hz', range: [40, 2000], default: 100 + 10 * k },
    cutoff: { unit: 'Hz', range: [200, 12000], default: 2000 + 100 * k },
    drive: { unit: 'dB', range: [0, 12], default: 6 },
    level: { unit: 'amplitude', range: [0, 1], default: 0.5 },
  },
  cost: 20,
});

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts', 'benchmark.mjs')) as Promise<Benchmark>;
/** One limit judged on five runs: FAIL and BLOCKED fail the test, INCONCLUSIVE fails it as INCONCLUSIVE, never a pass. */
async function judged(id: string, what: string, limit: number, runs: number[], loads: { start: number; end: number }[]): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const reading = `${what}: ${runs.map((r) => r.toFixed(1)).join(', ')} ms against ${limit} ms on ${String(machine['model'])} macOS ${String(machine['macosBuild'])}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`${id} ${reading}`);
  expect(result.status, reading).not.toBe('BLOCKED');
  expect(result.status, reading).not.toBe('FAIL');
  if (result.status === 'INCONCLUSIVE') inconclusive(reading);
}
/** Six readings: a warm-up and five, each with the load at its start and end. */
function sixRuns(once: () => number): { runs: number[]; loads: { start: number; end: number }[] } {
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let r = 0; r < 6; r++) {
    const start = loadavg()[0]!;
    const ms = once();
    if (r > 0) { runs.push(ms); loads.push({ start, end: loadavg()[0]! }); }
  }
  return { runs, loads };
}

function dronePack(): PackFixture { return writePack(temp(), 'drones', { drone: DRONE }); }

describe(`${AC[8]} budgets: 32 voices of an 8-node preset under 10% of a core, a seek's restore under 50 ms, no work for a document with no synth`, () => {
  it(`${AC[8]} the perf lane has a task whose reason names #204.0458a4e3, and the budgets are valid against the merge base's`, async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; initialReason?: string; changeReason?: string }[] };
    expect(current.tasks.some((t) => /#204\.0458a4e3\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`)), 'benchmarks/budgets.json has a task whose reason names #204.0458a4e3 (the merge-base comparison, a document with no synth among its work)').toBe(true);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  }, TIMEOUT);

  it(`${AC[8]} on the reference Mac 32 voices of an 8-node preset render 10 s at 48 kHz in under 1,000 ms, 10% of one core (five runs after a warm-up)`, async () => {
    const pack = dronePack();
    const doc = mediaDoc({ span: secs(10), packs: [pack], strips: { drone: synthStrip(0, { preset: presetOf(pack, 'drone'), voices: 32 }, 0, secs(10)) } });
    const { runs, loads } = sixRuns(() => {
      const [m] = mixes(bin(), temp(), [pack], [{ doc, segments: [{ from: 0, to: secs(10) }] }], '32 voices of the drone for 10 s');
      const report = synthOf(m!, 'drone', '32 voices of the drone');
      expect(int(report['voices'], 'mix.synths.drone.voices'), 'the drone strip plays 32 voices').toBe(32);
      return num(report['render_ms'], 'mix.synths.drone.render_ms (the time its voices took to render)');
    });
    await judged(AC[8], '32 voices of an 8-node preset, 10 s at 48 kHz, rendered', 1_000, runs, loads);
  }, TIMEOUT);

  it(`${AC[8]} on the reference Mac a seek's restore and render forward to its time take under 50 ms (five runs after a warm-up)`, async () => {
    const pack = dronePack();
    const doc = mediaDoc({ span: secs(10), packs: [pack], strips: { drone: synthStrip(0, { preset: presetOf(pack, 'drone') }, 0, secs(10)) } });
    const { runs, loads } = sixRuns(() => {
      const [m] = mixes(bin(), temp(), [pack], [{ doc, segments: [{ from: 0, to: secs(10) }, { from: secs(9.99), to: secs(10) }] }], 'the drone played to 10 s, then seeked to 9.99 s');
      const s = m!.segments[1]!;
      const e = s.seek?.['drone'];
      expect(e !== undefined && e.restored !== null && secs(9.99) - e.rendered_from <= secs(1), `the seek to 9.99 s restores a checkpoint and renders at most 1 s forward: ${show(s.seek)}`).toBe(true);
      return num(s.raw['seek_ms'], 'mix.segments[1].seek_ms (the restore and the render forward)');
    });
    await judged(AC[8], 'a seek to 9.99 s, restored and rendered forward', 50, runs, loads);
  }, TIMEOUT);
});

describe(`${AC[14]} budgets: the sweep of a pack of 50 presets with 4 params each in under 10 s`, () => {
  it(`${AC[14]} on the reference Mac installing a pack of 50 presets with 4 params each, its sweep included, finishes in under 10 s (five runs after a warm-up, each a fresh process)`, async () => {
    const presets: Record<string, Preset> = {};
    for (let k = 0; k < 50; k++) presets[`sweep${k}`] = swept(k);
    const pack = writePack(temp(), 'sweeps', presets);
    const { runs, loads } = sixRuns(() => {
      const { replies, ms } = runTimed(bin(), { evidence: temp(), calls: [installCall(pack)] }, 'the pack of 50 presets installed');
      const r = installOf(replies[0], 'the pack of 50 presets');
      expect([r.outcome, r.issues.length], `the pack of 50 presets passes its check and its sweep: ${show(replies[0], 1500)}`).toEqual(['installed', 0]);
      return ms;
    });
    await judged(AC[14], 'the sweep of 50 presets with 4 params each, in its install', 10_000, runs, loads);
  }, TIMEOUT);
});
