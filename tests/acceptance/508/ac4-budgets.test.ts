// AC4: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a control change redraws
// within one frame, and a 500-part figure holds 120 fps; a projected inset over half a 1080p frame adds under 0.2 ms lit
// and under 0.3 ms unlit"
//
// "On the reference Mac" and "compared with the merge base" are the perf lane's, as #468's and #380's suites read them:
// each timing is five runs after an untimed warm-up, judged by the lane's own `judgeLimit` (scripts/benchmark.mjs) with
// each run's one-minute load at its start and end; it PASSes only on a reference Mac at rest and is INCONCLUSIVE
// anywhere else or under load, never PASS. "In the local preflight": benchmarks/budgets.json holds a task for this
// criterion that the lane's `validateBudgets` accepts against the merge base's file, and scripts/lanes.mjs lists this
// file in `timed`. That part is checked first, on any machine.
//
// The timings, from a release build of deep-gpu (`view3d` with `timings: true`; a frame's `wall_ms` is its CPU and GPU
// together, as the design's castle number is, and `gpu_ms` its GPU time):
//   - A control change: the turbofan fixture at 120 fps, frames 0 to 180, with its throttle moved to the top of its
//     range at 1 s by an input track entry (`track`), against the same run without it. The frame at 1 s (frame 120)
//     shows the change: it differs from the untracked run's frame 120, while frame 119 is the same in both. The reading:
//     that frame's `wall_ms`, under one frame at 120 Hz (1000 ÷ 120 ms).
//   - A 500-part figure (partsDoc): 500 boxes in five assemblies taken apart and back while the camera orbits, 1920 ×
//     1080, 600 frames at 120 fps. The reading: the worst `wall_ms` of frames 1 to 599, under 1000 ÷ 120 ms.
//   - A projected inset (insetDoc): a floor under an orthographic camera at 60° filling a 1080p frame, and a projected
//     inset on it whose box covers the frame's left half, lit or unlit, against the floor without it; 120 frames each.
//     The reading: the difference of the medians of `gpu_ms`, under 0.2 ms lit and 0.3 ms unlit.
// Wrong programs: the base (no fixture, no `track`, no task, no timed entry); a control change shown a frame late; a
// figure or an inset over its budget; a budget no lane compares with the merge base.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, PLAIN_LOOK, REPO, THROTTLE, TIMEOUT, ac, asSession, assetPaths, drawnOf, entry, fixture, frameAt, inconclusive, judgeLimit,
  lane, load, lookOf, median, msOf, none, requireGpu, runGpu, show, timingProblem, topOf, useBins, useDir, view3d, writeJson,
  type JsonObject, type Load,
} from './helpers.ts';

const bin = useBins();
const dir = useDir();
const HD: [number, number] = [1920, 1080];
const FRAME_MS = 1000 / 120;
const LIMITS = { lit: 0.2, unlit: 0.3 } as const;

/** 500 boxes, 100 to each of five assemblies, taken apart from 1 s to 2 s and back from 3 s to 4 s, the camera orbiting. */
function partsDoc(): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 1, 0], orbit: { azimuth: 0, elevation: 20, distance: 14 }, fov: 40, near: 0.05, far: 200 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-45, 30, 0] } },
    metal: { kind: 'material@1', params: { base_color: [0.6, 0.6, 0.65, 1], roughness: 0.5 } },
  };
  const assemblies: JsonObject = {};
  for (let a = 0; a < 5; a++) assemblies[`a${a}`] = { parent: a === 0 ? null : 'a0', at: { pos: [0, 0, 0] }, apart: a === 0 ? [0, 0, 0] : [0, 0.6 * a, 0], order: a, value: 0 };
  for (let k = 0; k < 500; k++) {
    const a = Math.floor(k / 100); const i = k % 100;
    items[`p${String(k).padStart(3, '0')}`] = { kind: 'mark.box@1', params: { size: [0.3, 0.12, 0.3] }, at: { pos: [(i % 10) * 0.4 - 1.8, a * 0.2, Math.floor(i / 10) * 0.4 - 1.8] }, material: 'metal', parent: `a${a}` };
  }
  const keys = { k0: { t: '0s', value: 0, interp: 'hold' }, k1: { t: '1s', value: 1, interp: 'hold' }, k2: { t: '3s', value: 0, interp: 'hold' } };
  return asSession({
    format: 1, id: 'parts-500', profile: 'figure', title: 'Five hundred parts', description: 'A 500-part figure taken apart while the camera orbits.',
    size: HD, camera: 'cam', seed: 508, transport: { span: '5s' }, requires: { modules: { scene3d: '^1' } }, budget: { class: 'figure' },
    assemblies, items,
    channels: {
      spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '5s', value: 180, interp: 'linear' } } },
      take: { target: 'assemblies/apart', type: 'f32', mode: 'follow', follow: { source: { keys }, model: { transition: { span: '1s', interp: 'linear' } } } },
    },
  });
}
/** A floor filling a 1080p frame (orthographic, 19.2 m across, from 60° up), with or without a projected inset over its left half. */
function insetDoc(shading: 'lit' | 'unlit' | null): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 20 * Math.sin(Math.PI / 3), 20 * Math.cos(Math.PI / 3)], target: [0, 0, 0], view_width: 19.2, near: 0.05, far: 200 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-50, 30, 0] } },
    ground: { kind: 'material@1', params: { base_color: [0.4, 0.4, 0.4, 1], roughness: 0.9 } },
    floor: { kind: 'mark.box@1', params: { size: [40, 0.1, 40] }, at: { pos: [0, -0.05, 0] }, material: 'ground' },
  };
  if (shading) {
    items['map'] = {
      kind: 'inset@1', parent: 'floor', at: { pos: [-4.8, 0, 0] },
      params: { size: [9.6, 14], px_per_unit: 20, content: { ground: { kind: 'rect@1', order: 'a0', params: { box: [0, 0, 192, 280], paint: { fill: { role: 'stone' } } } } }, project: { shading } },
    };
  }
  return asSession({
    format: 1, id: `inset-${shading ?? 'none'}`, profile: 'scene', title: 'A projected inset over half a frame', description: 'A floor with a projected inset over the left half of a 1080p frame.',
    size: HD, camera: 'cam', seed: 508, transport: { span: '2s' }, requires: { modules: { scene3d: '^1', marks2d: '^1' } }, budget: { class: 'figure' }, items,
  });
}

interface Reading { redraw: number; fps: number; lit: number; unlit: number }
function reading(warm: boolean): Reading {
  const out = dir();
  const fan = fixture('turbofan');
  const fanDoc = writeJson(out, 'turbofan', asSession(fan.document));
  const track = [entry(1, THROTTLE, topOf(fan.document, THROTTLE, fan.rel))];
  const fanCall = (withTrack: boolean): JsonObject => view3d({ doc: fanDoc, look: lookOf(fan), size: fan.size, fps: 120, frames: 181, timings: true, assets: assetPaths(fan), ...(withTrack ? { track } : {}) });
  const parts = writeJson(out, 'parts', partsDoc());
  const inset = (s: 'lit' | 'unlit' | null): JsonObject => view3d({ doc: writeJson(out, `inset-${s ?? 'none'}`, insetDoc(s)), look: PLAIN_LOOK, size: HD, fps: 60, frames: 120, timings: true });
  const replies = runGpu(bin('deep-gpu --release'), out, [
    fanCall(true), fanCall(false), view3d({ doc: parts, look: PLAIN_LOOK, size: HD, fps: 120, frames: 600, timings: true }), inset('lit'), inset('unlit'), inset(null),
  ]);
  const [tracked, untracked, figure, lit, unlit, bare] = replies.map((r, i) => drawnOf(r, ['the turbofan with its throttle moved', 'the turbofan untouched', 'the 500-part figure', 'the lit inset', 'the unlit inset', 'the floor without an inset'][i]!));
  if (warm) {
    const failures: string[] = [];
    if (frameAt(tracked!, 119, 'tracked').pixelHash !== frameAt(untracked!, 119, 'untracked').pixelHash) failures.push('the turbofan: frame 119, before the throttle moves, differs from the run without the change');
    if (frameAt(tracked!, 120, 'tracked').pixelHash === frameAt(untracked!, 120, 'untracked').pixelHash) failures.push('the turbofan: the throttle moved at 1 s, but the frame at 1 s (frame 120) is the frame without the change: it redraws later than one frame, or never');
    for (const [name, d] of [['the lit inset', lit], ['the unlit inset', unlit]] as const) if (frameAt(d!, 0, name).pixelHash === frameAt(bare!, 0, 'bare').pixelHash) failures.push(`${name}: frame 0 is the floor without it: it draws nothing`);
    none(failures, `${ac(4)}: each timed side draws what it times`);
  }
  const fan120 = frameAt(tracked!, 120, 'tracked');
  const plain = median(msOf(bare!.frames, 'gpu_ms', 'the floor without an inset'));
  return {
    redraw: msOf([fan120], 'wall_ms', 'the turbofan')[0]!,
    fps: Math.max(...msOf(figure!.frames.filter((f) => f.frame >= 1), 'wall_ms', 'the 500-part figure')),
    lit: Math.max(0, median(msOf(lit!.frames, 'gpu_ms', 'the lit inset')) - plain),
    unlit: Math.max(0, median(msOf(unlit!.frames, 'gpu_ms', 'the unlit inset')) - plain),
  };
}

describe(`${ac(4)} the explainer task's budgets on the reference Mac, beside the merge base`, () => {
  it(`${ac(4)} a control change redraws within one frame, a 500-part figure holds 120 fps, and a projected inset over half a 1080p frame adds under 0.2 ms lit and 0.3 ms unlit, five runs each by the lane's rule, in a task the lane compares with the merge base`, async () => {
    const failures: string[] = [];
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const mine = current.tasks.filter((t) => (Array.isArray(t['criteria']) && t['criteria'].includes(CRITERIA[4])) || /#508\b/.test(String(t['initialReason'] ?? '')));
    if (mine.length === 0) failures.push(`benchmarks/budgets.json has no task for ${CRITERIA[4]} (its criteria or its initialReason naming #508)`);
    for (const t of mine) if (!(Array.isArray(t['command']) && t['command'].length > 0)) failures.push(`budgets.json task ${String(t['id'])} has no command the lane runs`);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    if (mergeBase.status !== 0) failures.push(`git merge-base HEAD origin/main: ${mergeBase.stderr}`);
    else {
      const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const verdict = base.status === 0 ? lane('try { b.validateBudgets(input.current, input.base); return "valid"; } catch (e) { return String(e.message); }', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }) : base.stderr;
      if (verdict !== 'valid') failures.push(`the lane's validator refuses budgets.json against the merge base's: ${String(verdict)}`);
    }
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    if (!lanes.timed.includes('tests/acceptance/508/ac4-budgets.test.ts')) failures.push('scripts/lanes.mjs does not list tests/acceptance/508/ac4-budgets.test.ts in timed, the local preflight\'s perf step');
    none(failures, `${ac(4)}: the budgets' place in the perf lane`);

    requireGpu();
    reading(true);
    const problem = timingProblem();
    if (problem) inconclusive(`the budgets count only on a reference Mac at rest: ${problem}`);
    const runs: Reading[] = []; const loads: Load[] = [];
    for (let k = 0; k < 5; k++) { const start = load(); runs.push(reading(false)); loads.push({ start, end: load() }); }
    const judged: [string, JsonObject][] = [
      ['a control change, the redrawn frame\'s wall ms (under one frame at 120 Hz)', judgeLimit(FRAME_MS, runs.map((r) => r.redraw), loads)],
      ['a 500-part figure, its worst frame\'s wall ms at 1080p (under one frame at 120 Hz)', judgeLimit(FRAME_MS, runs.map((r) => r.fps), loads)],
      ['a lit projected inset over half a 1080p frame, added GPU ms (under 0.2)', judgeLimit(LIMITS.lit, runs.map((r) => r.lit), loads)],
      ['an unlit projected inset over half a 1080p frame, added GPU ms (under 0.3)', judgeLimit(LIMITS.unlit, runs.map((r) => r.unlit), loads)],
    ];
    for (const [name, v] of judged) console.log(`${ac(4)} ${name}: ${String(v['status'])} ${show(v['runs'] ?? null)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
    expect(judged.filter(([, v]) => v['status'] === 'FAIL').map(([n, v]) => `${n}: ${show(v)}`), 'no budget fails').toEqual([]);
    const open = judged.filter(([, v]) => v['status'] !== 'PASS');
    if (open.length) inconclusive(open.map(([n, v]) => `${n}: ${String(v['status'])} ${String(v['reason'] ?? '')}`).join('; '));
  }, TIMEOUT);
});
