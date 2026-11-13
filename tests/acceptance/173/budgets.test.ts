// AC9 #173.f5914d9c: Budgets, on the reference Mac in the local preflight, compared with the merge base: the resolve over
// an 8-frame window adds under 1 ms of GPU at 1080p, a jump renders the castle's window of 8 frames at scale 0.67 in
// under 50 ms, the window holds under 100 MB at a 1080p display, and a still scene draws nothing.
//
// - Compared with the merge base: the perf lane's task `canvas-frame-history` in benchmarks/budgets.json, running `node
//   benchmarks/canvas.mjs history`, a first measurement naming #173, valid by scripts/benchmark.mjs's validateBudgets
//   against the merge base's budgets (as #386's `canvas-upscale` is), and exiting 0 on this reference Mac.
// - A still scene draws nothing: #379's `live` with #421's fences, the orbiting scene held still (helpers: `orbitDoc`,
//   no channel) with frame history on (antialias, window 8), 120 frames at 60 fps: it settles within 40 frames of
//   opening (history drops at rest and the frame settles), and from then no frame draws it and no GPU work is submitted
//   for it. The same scene orbiting draws every frame after its first two (the control).
// - The window holds under 100 MB at a 1080p display: `live` of the orbiting scene in a 1920 × 1080 view with
//   `history: {mode: upscale, window: 8}` at the look's `scale: 0.67` (the design's cost line: about 90 MB), with the
//   memory report: every frame's view row holds a window of 8 at internal scale 0.67 through the temporal upscale, and
//   the writer's `frame_history` target, as the device reports it, stays under 100 × 10^6 B and above 4 B a pixel for
//   each of its 8 frames at 0.67 (the measure sees the window).
// - The resolve over an 8-frame window at 1080p: the castle by `view3d` at 1920 × 1080 with history on (antialias,
//   window 8) and `timings`, frames 0–359 at 30 fps: each frame times the resolve's pass `look.history`; a run's reading
//   is the median over frames 60–359 (the limit names no percentile, so not the p95 gate, as #386's upscale).
// - A jump renders the castle's window of 8 at scale 0.67: the castle at its own size with `history: {mode: upscale,
//   window: 8}` at `scale: 0.67` and `timings`, opened and then sought 10 times across its span: every jump's frame
//   rendered its 8 window frames before it showed, at internal scale 0.67; a run's reading is the median of the 10
//   sought frames' `wall_ms` (#252's: from the frame's start, before the seek's restore, until it is drawn).
// - Timings: a warm-up run, then five, each a fresh process, judged by scripts/benchmark.mjs's judgeLimit (PASS all
//   five within, FAIL all five over by more than the margin, else INCONCLUSIVE; off a reference Mac in its conditions
//   or loaded, INCONCLUSIVE). Any INCONCLUSIVE leaves this test INCONCLUSIVE, never PASS.
// Wrong programs: the base (no task, no history in view3d, no `frame_history` target, no temporal upscale); a resolve
// or a jump over its limit; a window kept at full resolution; a still view that keeps drawing.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AGENT, CASTLE_FPS, HISTORY_ON, HISTORY_UPSCALE, REPO, arr, castle, castleLook, framesOf, inconclusive, isObject, judge, load, look, num, obj,
  orbitDoc, payload, requireMetal, requireReferenceMac, runGpu, shown, str, useDir, useGpu, validateBudgets, view3dCall, writeJson, median,
  type JsonObject, type Judged, type Run,
} from './helpers.ts';

const ID = AC[9];
const bin = useGpu();
const dir = useDir();
const TASK = 'canvas-frame-history';
const HD: [number, number] = [1920, 1080];
const SCALE = 0.67;
const LIMITS = { resolve_ms: 1, jump_ms: 50, window_bytes: 100_000_000 };
const RESOLVE = 'look.history';
const JUMPS: [number, number][] = [[0, 300], [300, 75], [75, 450], [450, 150], [150, 600], [600, 225], [225, 500], [500, 30], [30, 400], [400, 120]];

interface LiveView { frame: number; session: string; drawn: boolean; history_frames: number | null; internal_scale: number | null; upscale: string | null }
interface LiveRun { views: LiveView[]; submits: number[]; windowBytes: (number | null)[] }
function live(spec: { doc: JsonObject; size: [number, number]; frames: number; fps: number; history: JsonObject; scale?: number; report: string[] }): LiveRun {
  const out = dir();
  const docPath = writeJson(out, 'scene', payload(spec.doc));
  const [reply] = runGpu(bin(), out, [{
    call: 'live', look: look({ history: spec.history, ...(spec.scale !== undefined ? { scale: spec.scale } : {}) }), frames: spec.frames, fps: spec.fps, report: spec.report,
    sessions: [{ session: 's', writer: AGENT, doc: docPath, size: spec.size }],
  }]);
  expect(reply!['code'], `live was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const views: LiveView[] = []; const windowBytes: (number | null)[] = [];
  for (const [i, v] of arr(reply!['frames'], 'live: frames').entries()) {
    const f = obj(v, `live: frames[${i}]`); const frame = num(f['frame'], `live: frames[${i}].frame`);
    for (const w of arr(f['views'], `live: frame ${frame}: views`)) {
      const o = obj(w, `live: frame ${frame}: a view`);
      views.push({
        frame, session: str(o['session'], 'a view: session'), drawn: o['drawn'] === true,
        history_frames: typeof o['history_frames'] === 'number' ? o['history_frames'] : null,
        internal_scale: typeof o['internal_scale'] === 'number' ? o['internal_scale'] : null, upscale: typeof o['upscale'] === 'string' ? o['upscale'] : null,
      });
    }
    if (spec.report.includes('memory')) {
      const rows = arr(f['writers'] ?? [], `live: frame ${frame}: writers`).flatMap((wr) => arr(obj(wr, 'a writer')['targets'] ?? [], 'a writer: targets'));
      const row = rows.map((r) => obj(r, 'a target row')).find((r) => r['target'] === 'frame_history');
      windowBytes.push(row && typeof row['device_bytes'] === 'number' ? row['device_bytes'] : null);
    }
  }
  const submits = spec.report.includes('fences')
    ? arr(reply!['fences'], 'live: fences').map((x) => obj(x, 'a fence')).filter((x) => x['event'] === 'submit' && x['session'] === 's' && typeof x['frame'] === 'number').map((x) => x['frame'] as number)
    : [];
  return { views, submits, windowBytes };
}

/** One fresh process drawing the castle; its reading, with the load at its start and end. */
function timed(read: () => number): Run {
  const start = load();
  const value = read();
  return { value, start, end: load() };
}
function resolveRun(): number {
  const c = castle();
  const [reply] = runGpu(bin(), dir(), [view3dCall({ doc: c.doc, look: castleLook(c, HISTORY_ON), size: HD, packs: c.packs, fps: CASTLE_FPS, frames: 360, timings: true })]);
  const ms = framesOf(reply!, 'the castle at 1080p').filter((f) => f.frame >= 60).map((f) => {
    expect(f.history?.mode, `frame ${f.frame} at 1080p drew with history`).toBe('antialias');
    expect(f.history?.window.length, `frame ${f.frame} at 1080p resolved a window of 8`).toBe(8);
    const p = f.passesMs?.get(RESOLVE);
    expect(p, `frame ${f.frame} at 1080p times the resolve's pass ${RESOLVE}`).toBeDefined();
    return p!;
  });
  return median(ms);
}
function jumpRun(): number {
  const c = castle();
  const [reply] = runGpu(bin(), dir(), [view3dCall({
    doc: c.doc, look: castleLook(c, HISTORY_UPSCALE, { scale: SCALE }), size: c.size, packs: c.packs, fps: CASTLE_FPS, frames: JUMPS.length + 1, timings: true,
    seeks: JUMPS.map(([after, to]) => ({ after, to })),
  })]);
  const s = isObject(reply!['surface']) ? reply!['surface'] : {};
  expect([s['internal_scale'], s['upscale']], `the castle drew at internal scale ${SCALE} through the temporal upscale: ${shown(s)}`).toEqual([SCALE, 'temporal']);
  const frames = framesOf(reply!, 'the castle sought');
  expect(frames.map((f) => f.frame), 'the castle opened at 0, then sought 10 times').toEqual([0, ...JUMPS.map(([, to]) => to)]);
  return median(frames.slice(1).map((f) => {
    expect(f.history?.rendered.length, `the jump to frame ${f.frame} rendered the window of 8 before it showed`).toBe(8);
    expect(f.wallMs, `the jump to frame ${f.frame} reports its wall time (timings)`).not.toBeNull();
    return f.wallMs!;
  }));
}

describe(`${ID} frame history's budgets`, () => {
  it(`${ID} the perf lane compares ${TASK} with the merge base; a still scene draws nothing; the 1080p window holds under 100 MB; the resolve adds under 1 ms at 1080p; a jump renders the castle's window in under 50 ms`, async () => {
    // Compared with the merge base: the perf lane's task.
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `budgets.json has a task ${TASK}`).toBeDefined();
    expect(task!.command, `${TASK} runs frame history's bench`).toEqual(['node', 'benchmarks/canvas.mjs', 'history']);
    expect(String(task!.initialReason), `${TASK} says why, naming issue #173`).toMatch(/#173/);
    const git = (...args: string[]): string => {
      const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
      return r.stdout;
    };
    const base = git('merge-base', 'HEAD', 'origin/main').trim();
    await validateBudgets(current, JSON.parse(git('show', `${base}:benchmarks/budgets.json`)));

    // A still scene draws nothing (a count, judged on any Mac's Metal device).
    requireMetal();
    const still = live({ doc: orbitDoc([480, 320], false), size: [480, 320], frames: 120, fps: 60, history: HISTORY_ON, report: ['fences'] });
    const first = Math.min(...still.views.map((v) => v.frame));
    const quiet = (f: number): boolean => f >= first + 40;
    console.log(`${ID}: the still scene draws at frames ${still.views.filter((v) => v.drawn).map((v) => v.frame).join(', ')}; submits at ${[...new Set(still.submits)].join(', ')}`);
    expect(still.views.filter((v) => v.drawn).length, 'the still scene draws its first frame').toBeGreaterThan(0);
    expect(still.views.filter((v) => v.drawn && quiet(v.frame)).map((v) => v.frame), 'with frame history on, the still scene settles within 40 frames and then draws nothing').toEqual([]);
    expect([...new Set(still.submits.filter(quiet))], 'and submits no GPU work for it').toEqual([]);
    const moving = live({ doc: orbitDoc([480, 320], true), size: [480, 320], frames: 60, fps: 60, history: HISTORY_ON, report: ['fences'] });
    const mFirst = Math.min(...moving.views.map((v) => v.frame));
    expect(moving.views.filter((v) => !v.drawn && v.frame >= mFirst + 2).map((v) => v.frame), 'the control: the same scene orbiting draws every frame after its first two').toEqual([]);

    // On the reference Mac: the window's memory, the resolve and the jump.
    await requireReferenceMac('frame history\'s budgets');
    const mem = live({ doc: orbitDoc(HD, true), size: HD, frames: 30, fps: 30, history: HISTORY_UPSCALE, scale: SCALE, report: ['memory'] });
    for (const v of mem.views.filter((x) => x.frame >= 2)) {
      expect([v.history_frames, v.internal_scale, v.upscale], `frame ${v.frame}: the 1080p view holds a window of 8 at internal scale ${SCALE} through the temporal upscale`).toEqual([8, SCALE, 'temporal']);
    }
    const bytes = mem.windowBytes.filter((b): b is number => b !== null);
    expect(bytes.length, 'the memory report counts the window (a frame_history target, as the device reports it) in every frame').toBe(mem.windowBytes.length);
    const peak = Math.max(...bytes);
    const floor = 4 * 8 * Math.floor(HD[0] * SCALE) * Math.floor(HD[1] * SCALE);
    console.log(`${ID}: the 1080p window peaks at ${(peak / 1e6).toFixed(1)} MB on the device`);
    expect(peak, 'the measure sees the window: at least 4 B a pixel for each of its 8 frames at 0.67').toBeGreaterThanOrEqual(floor);
    expect(peak, 'the window holds under 100 MB at a 1080p display').toBeLessThan(LIMITS.window_bytes);

    const judged: Judged[] = [];
    resolveRun();
    judged.push(await judge(`${ID} the resolve over an 8-frame window at 1080p, median of frames 60–359 (ms)`, LIMITS.resolve_ms, Array.from({ length: 5 }, () => timed(resolveRun))));
    jumpRun();
    judged.push(await judge(`${ID} a jump rendering the castle's window of 8 at scale 0.67, median of 10 jumps (ms)`, LIMITS.jump_ms, Array.from({ length: 5 }, () => timed(jumpRun))));

    // The perf lane's task runs here and exits 0.
    const r = spawnSync(process.execPath, [join(REPO, 'benchmarks', 'canvas.mjs'), 'history'], { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, maxBuffer: 256 * 1024 * 1024 });
    expect(r.status, `node benchmarks/canvas.mjs history exits 0: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);

    const failed = judged.filter((j) => j.status === 'FAIL');
    expect(failed.map((j) => j.line), 'no budget fails').toEqual([]);
    const open = judged.filter((j) => j.status !== 'PASS');
    if (open.length) inconclusive(open.map((j) => j.line).join('; '));
  }, 7_200_000);
});
