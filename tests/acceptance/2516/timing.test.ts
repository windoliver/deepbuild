// AC6 "The prepass, the occlusion pass and the blur are timed on the castle fixture (`packs/examples/castle.json`) with ao
// on at 1080p, at 8 and 16 samples and at half and full resolution, as p50 and p95 over five runs after warm-up from GPU
// timestamps read after the frame (#1657), and the design's Cost line carries those readings in place of its estimate. A
// run timed while another GPU job holds a lease reads INCONCLUSIVE, never a number"
//
// The castle is drawn as packs/examples/castle.json with its pack (packs/composites-1.0.0) and castle.look.json plus
// `ao` at its defaults but for `samples` and `resolution`, at 1920 × 1080, 40 frames at 30 fps per setting with
// `timings`, nothing captured; the first 10 frames of each setting are dropped. A run is one `deep-gpu run` process over
// the four settings, their order turned by one each run; one warm-up run, then five. Each frame's `passes_ms` must time
// each pass on its own, from wgpu-profiler's timestamps (the reply's `profiler`), resolved after the frame:
//   scene3d.ao_prepass (the depth and normal prepass), scene3d.ao (the occlusion), scene3d.ao_blur (the blur).
// The base records all three under scene3d.ao, so no reading of the prepass or the blur exists there (README: Missing
// instrumentation). p50 and p95 (nearest rank) are over the 150 kept frames of the five runs, per setting and pass.
//
// The machine: the perf lane's own judge (scripts/benchmark.mjs `judgeLimit`, as #1637 reads it): a reference Mac on
// mains power, Low Power Mode off, thermal state nominal, and each run's load at its start and end at most the core
// count; anything else reads INCONCLUSIVE. The lease: before drawing, the run takes the machine's GPU lease
// ($HOME/.cache/deepbuild-gpu/lease, the protocol crates/deep-show/src/kit/goldens.rs `GpuLease` uses for kits and exports)
// and holds it to the end; held by another live process, or lost meanwhile, the run reads INCONCLUSIVE and reports no
// number. Off macOS the GPU layer can't draw, which reads INCONCLUSIVE as well. Judged readings are written to
// docs/evidence/2516/timings-<sha256 prefix>.json; the Cost line test reads them.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AO_DEFAULTS, BASE_SHA, GPU_LEASE, REPO, SETTINGS, draw, git, inconclusive, judgeLimit, load, median, p95, requireGpu, settingName,
  sha256, takeGpuLease, useGpuBin, useOut, type JsonObject, type JsonValue, type Setting,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();
const PASSES = ['scene3d.ao_prepass', 'scene3d.ao', 'scene3d.ao_blur'] as const;
const HD: [number, number] = [1920, 1080];
const FRAMES = 40;
const WARM_FRAMES = 10;
const RUNS = 5;
const EVIDENCE = join(REPO, 'docs', 'evidence', '2516');

type Run = Map<string, Map<string, number[]>>; // setting → pass → ms per kept frame
type Outcome = { status: 'INCONCLUSIVE'; reason: string } | { status: 'READ'; runs: Run[]; loads: { start: number; end: number }[] };

/** Takes the GPU lease, draws one warm-up run and five, and releases it; INCONCLUSIVE, with no number, if another job holds or takes the lease. */
function collect(leaseFile: string, drawRun: (k: number) => Run): Outcome {
  const lease = takeGpuLease(leaseFile);
  if (!lease.ok) return { status: 'INCONCLUSIVE', reason: lease.reason };
  try {
    drawRun(0);
    const runs: Run[] = []; const loads: { start: number; end: number }[] = [];
    for (let k = 1; k <= RUNS; k++) {
      const start = load(); runs.push(drawRun(k)); loads.push({ start, end: load() });
      if (!lease.ours()) return { status: 'INCONCLUSIVE', reason: `the machine's GPU lease (${leaseFile}) was taken by another job during run ${k}` };
    }
    return { status: 'READ', runs, loads };
  } finally { lease.release(); }
}

function castleRun(bin: string, dir: string, k: number): Run {
  const doc = join(REPO, 'packs', 'examples', 'castle.json');
  const baseLook = JSON.parse(readFileSync(join(REPO, 'packs', 'examples', 'castle.look.json'), 'utf8')) as JsonObject;
  const order = SETTINGS.map((_, i) => SETTINGS[(i + k) % SETTINGS.length]!);
  const calls = order.map((s): JsonObject => ({
    call: 'view3d', doc, look: { ...baseLook, ao: { ...AO_DEFAULTS, samples: s.samples, resolution: s.resolution } }, size: HD,
    packs: [join(REPO, 'packs', 'composites-1.0.0')], frames: FRAMES, fps: 30, timings: true, capture: [],
  }));
  const replies = draw(bin, dir, calls);
  const run: Run = new Map();
  order.forEach((s, i) => {
    const what = `run ${k}, ${settingName(s)}`;
    const reply = replies[i]!;
    expect((reply['profiler'] as JsonObject | undefined)?.['name'], `${what}: the passes are timed by wgpu-profiler's GPU timestamps, read after the frame`).toBe('wgpu-profiler');
    const frames = reply['frames'] as JsonValue[];
    expect(Array.isArray(frames) && frames.length === FRAMES, `${what}: every frame is reported`).toBe(true);
    const byPass = new Map<string, number[]>(PASSES.map((p) => [p, []]));
    frames.slice(WARM_FRAMES).forEach((f, j) => {
      const ms = (f as JsonObject)['passes_ms'] as JsonObject | undefined;
      for (const p of PASSES) {
        const v = ms?.[p];
        expect(typeof v === 'number' && Number.isFinite(v) && v > 0, `${what}, frame ${j + WARM_FRAMES}: passes_ms times ${p} on its own (got ${JSON.stringify(v)}; passes_ms ${JSON.stringify(ms)?.slice(0, 600)})`).toBe(true);
        byPass.get(p)!.push(v as number);
      }
    });
    run.set(settingName(s), byPass);
  });
  return run;
}

describe('AC6 the three passes\' GPU time on the reference Mac', () => {
  it('AC6 the prepass, the occlusion and the blur are timed on the castle at 1080p, at 8 and 16 samples and half and full resolution, as p50 and p95 over five runs after warm-up, under the GPU lease', async () => {
    requireGpu();
    const zero = Array.from({ length: RUNS }, () => ({ start: 0, end: 0 }));
    const here = await judgeLimit(1, [0, 0, 0, 0, 0], zero);
    if (here['status'] !== 'PASS') inconclusive(`this machine can't judge a timing: ${String(here['reason'])}`);
    const got = collect(GPU_LEASE, (k) => castleRun(gpu.bin(), out(), k));
    if (got.status !== 'READ') inconclusive(got.reason);
    const machine = await judgeLimit(1, [0, 0, 0, 0, 0], got.loads);
    if (machine['status'] !== 'PASS') inconclusive(`the runs can't be judged: ${String(machine['reason'])}`);
    const settings = SETTINGS.map((s: Setting) => ({
      samples: s.samples, resolution: s.resolution,
      passes: Object.fromEntries(PASSES.map((p) => {
        const all = got.runs.flatMap((r) => r.get(settingName(s))!.get(p)!);
        return [p, { p50: median(all), p95: p95(all), frames: all.length, run_medians: got.runs.map((r) => median(r.get(settingName(s))!.get(p)!)) }];
      })),
    }));
    for (const s of settings) for (const p of PASSES) {
      const v = (s.passes as Record<string, { p50: number; p95: number }>)[p]!;
      console.log(`#2516 castle 1920 × 1080, ${s.samples} samples, ${s.resolution}: ${p} p50 ${v.p50.toFixed(3)} ms, p95 ${v.p95.toFixed(3)} ms`);
    }
    const head = git(['rev-parse', 'HEAD']).stdout.trim();
    const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject };
    const body = JSON.stringify({ issue: 2516, base: BASE_SHA, head, fingerprint: bench.fingerprint(), loads: got.loads, size: HD, frames_per_setting: FRAMES - WARM_FRAMES, runs: RUNS, lease: GPU_LEASE, settings }, null, 2);
    mkdirSync(EVIDENCE, { recursive: true });
    const file = join(EVIDENCE, `timings-${sha256(body).slice(0, 12)}.json`);
    writeFileSync(file, `${body}\n`);
    console.log(`#2516 timings written to ${file}`);
  }, 7_200_000);

  it('AC6 a run timed while another GPU job holds the lease reads INCONCLUSIVE, never a number', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deep-2516-lease-'));
    // Another GPU job: a process this test starts, holding the lease file as GpuLease does; stopped by its own PID.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' });
    try {
      expect(holder.pid, 'the holder started').toBeDefined();
      const file = join(dir, 'lease');
      writeFileSync(file, String(holder.pid));
      let drew = 0;
      const got = collect(file, () => { drew++; return new Map([['8 samples, half resolution', new Map([['scene3d.ao', [1.5]]])]]); });
      expect(got.status, 'the run reads INCONCLUSIVE').toBe('INCONCLUSIVE');
      expect(drew, 'nothing is drawn or timed while the lease is held').toBe(0);
      expect(JSON.stringify(got), 'it reports no reading').not.toMatch(/runs|\d+\.\d+/);
      expect((got as { reason: string }).reason, 'it names the holder').toContain(String(holder.pid));
      expect(readFileSync(file, 'utf8'), 'the holder\'s lease is left as it was').toBe(String(holder.pid));
    } finally {
      holder.kill('SIGTERM');
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC6 the design\'s Cost line for the look\'s ao carries a judged run\'s readings in place of its estimate', () => {
    const doc = readFileSync(join(REPO, 'docs', 'canvas-primitives.md'), 'utf8');
    const section = doc.split('#### Look `look@1`: ao')[1]?.split('\n#### ')[0];
    expect(section, 'docs/canvas-primitives.md has the section Look `look@1`: ao').toBeDefined();
    const cost = section!.split('\n').find((l) => l.startsWith('**Cost:**'));
    expect(cost, 'the ao section has its Cost line').toBeDefined();
    expect(cost!, 'the Cost line no longer gives an estimate').not.toMatch(/estimat/i);
    expect(cost!, 'the estimate "0.4 to 0.8 ms" is gone').not.toContain('0.4 to 0.8 ms');
    for (const word of ['prepass', 'occlusion', 'blur', 'p50', 'p95', '16', 'half', 'full']) expect(cost!.toLowerCase(), `the Cost line names ${word}`).toContain(word);
    const files = existsSync(EVIDENCE) ? readdirSync(EVIDENCE).filter((f) => /^timings-[0-9a-f]{12}\.json$/.test(f)) : [];
    if (files.length === 0) expect.fail(`BLOCKED: no judged timing run is recorded in docs/evidence/2516/ (the timing test writes one on a reference Mac under the GPU lease); the Cost line's numbers have no run behind them`);
    const carried = files.filter((f) => {
      const e = JSON.parse(readFileSync(join(EVIDENCE, f), 'utf8')) as { settings: { passes: Record<string, { p50: number; p95: number }> }[] };
      return e.settings.length === 4 && e.settings.every((s) => PASSES.every((p) => [s.passes[p]!.p50, s.passes[p]!.p95].every((v) => cost!.includes(v.toFixed(2)))));
    });
    expect(carried, `the Cost line carries every p50 and p95 (ms, two decimals) of one recorded run (${files.join(', ')}): ${cost}`).not.toEqual([]);
  });
});
