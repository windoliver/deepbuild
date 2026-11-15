// AC5 #468.43d77df2: Budgets, on the reference Mac in the local preflight, compared with the merge base: a composed
// transition stays within its declared cost and the class budget, dof with 64 taps costs under 0.8 ms at 1080p, a drop
// adds one fill, and a glow, a bevel or satin adds under 0.15 ms per item at 1080p.
//
// "On the reference Mac" and "compared with the merge base" are the perf lane's (technical design: Every task carries
// its own budgets; The reference Macs), as #1637's and #465's suites read them: each timing is five runs after an
// untimed warm-up, judged by the lane's own `judgeLimit` (scripts/benchmark.mjs, in a child process) with each run's
// one-minute load at its start and end; it PASSes only on a reference Mac (the lane's list: Mac15,7, Mac15,12 or
// Mac17,10) on mains power, Low Power Mode off, thermal state nominal and unloaded, with all five within the limit, and
// is INCONCLUSIVE anywhere else or under load, never PASS. Nothing waits for the machine to quieten. "In the local
// preflight": scripts/lanes.mjs lists this file in `timed`, the preflight's perf step; and benchmarks/budgets.json holds a
// task for this criterion, which the lane runs beside the merge base, passing the lane's validator against the merge
// base's file.
//
// The timings (test 1), all at 1920 × 1080, 60 frames a second, `timings: true`:
//   - dof: a stage (a floor, twelve boxes, a sun, a sky) seen through a 50 mm lens at f/2.8 orbiting at 30°/s, with and
//     without an `effect@1` of kind dof (64 taps, focus 6 m), 120 frames each in one process; the cost is the
//     difference of the two sides' median `gpu_ms`, under 0.8 ms.
//   - glow, bevel, satin: a 1080p film (`film2d`) of eight 72 px texts each sliding 120 px over 2 s, with each paint on
//     all eight against none, 120 frames each; the cost is the difference of medians ÷ 8, under 0.15 ms an item.
//   - the composed transition: #466's mosaic dissolve (its test pack `test/mosaic`, tests/acceptance/466/fixtures/packs,
//     declared at 0.015 ns a pixel) between two shots of a wall in a figure-class document at 1080p, frames 60 to 180.
//     Over the frames its pass runs, the median of its measured time over the median of its declared time is at most 1,
//     both read from the frame's `passes_ms` and `declared_ms` under `transition/mz` (Assumed surface 7); and the worst
//     frame's `gpu_ms` is within the figure class's 2 ms.
// The warm-up run checks that each side draws what it times: the two sides of each pair have different pixel hashes at
// frame 0, and the transition's frames name its pass.
//
// "A drop adds one fill" (test 2) is a count, the same on any Mac: a frame's `fills` (Assumed surface 6: the fills and
// glyph runs its 2D marks encode) with a drop on a text, and on a rect, is the same frame's without it plus exactly one.
//
// Wrong programs: the base (no dof effect, no `fills`, no transition pass on the GPU, no task, no timed entry); a dof
// over 0.8 ms; a paint recomputed at more than 0.15 ms an item; a transition over its declaration or the class; a drop
// drawn as more than one fill; a budget no lane compares with the merge base.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backdrop, card, doc as doc2d, film2dCall, item } from '../467/helpers.ts';
import {
  AC, PLAIN_LOOK, REPO, box, dof, framesOf, gpuMs, inconclusive, isObject, judgeLimit, lane, linear, load, material, median, none, obj,
  requireMetal, runGpu, sceneDoc, shown, sun, timingProblem, useGpu, useOut, view3d, writeJson, type Frame, type JsonObject, type JsonValue, type Load,
} from './helpers.ts';

const ID = AC[5];
const bin = useGpu();
const out = useOut();
const HD: [number, number] = [1920, 1080];
const FRAMES = 120;
const ITEMS = 8;
const TRANSITION = 'transition/mz';
const PACK = { id: 'test/mosaic', dir: join(REPO, 'tests', 'acceptance', '466', 'fixtures', 'packs', 'test-mosaic-1.0.0'), op: 'mosaic.dissolve@1' };
const LIMITS = { dof: 0.8, paint: 0.15, declared: 1, figure: 2 } as const;
const PAINTS: Record<'glow' | 'bevel' | 'satin', JsonObject> = {
  glow: { glow: { where: 'outer', role: 'glow', size: 10, opacity: 0.75 } },
  bevel: { bevel: { shape: 'inner', size: 5, light: { angle: 135, altitude: 30 }, highlight: { role: 'light', opacity: 0.75 }, shadow: { role: 'dark', opacity: 0.75 } } },
  satin: { satin: { role: 'satin', offset: 6, size: 8, angle: 19, opacity: 0.5 } },
};

/** The dof stage at 1080p, with or without the effect. */
function stage(withDof: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.6, 0], orbit: { azimuth: 0, elevation: 10, distance: 8 }, lens: { focal_length: 50, sensor: [36, 24], fit: 'wider' }, aperture: { f_stop: 2.8, blades: 0 }, near: 0.05, far: 500 } },
    sky: { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: sun(3, [-45, 30, 0]), floor_mat: material({ base_color: [0.4, 0.4, 0.4, 1], roughness: 0.9 }), box_mat: material({ base_color: [0.7, 0.45, 0.3, 1], roughness: 0.6 }),
    floor: box([30, 0.1, 30], [0, -0.05, 0], 'floor_mat'),
  };
  for (let k = 0; k < 12; k++) items[`box${k}`] = box([0.7, 0.7 + 0.15 * (k % 4), 0.7], [3 * Math.cos((k * Math.PI) / 6), 0.35 + 0.075 * (k % 4), 3 * Math.sin((k * Math.PI) / 6)], 'box_mat');
  if (withDof) items['fx'] = dof({ focus: 6, taps: 64, max_coc: 24 });
  return sceneDoc(`dof-stage-${withDof ? 'dof' : 'plain'}`, HD, items, { transport: { span: '4s' }, budget: { class: 'showpiece' }, channels: { spin: linear('items/cam/params/orbit/azimuth', [[0, 0], [4, 120]]) } });
}
/** Eight 72 px texts sliding 120 px over 2 s on a 1080p film, each with `paint` beside its fill. */
function paintFilm(name: string, paint: JsonObject): JsonObject {
  const texts = Array.from({ length: ITEMS }, (_, k) => {
    const x = 80 + 440 * (k % 4); const y = 240 + 400 * Math.floor(k / 4);
    return { node: item(`t${k}`, 'text@1', `a${k + 1}`, { text: 'Paint', font: 'body', size: 72, box: { w: 280, h: 100 }, paint: { fill: { role: 'title' }, ...paint } }, { at: { pos: [x, y, 0] } }), x };
  });
  const channels: JsonObject = Object.fromEntries(texts.map((t, k) => [`slide${k}`, linear(`items/t${k}/at/pos/0`, [[0, t.x], [2, t.x + 120]])]));
  return doc2d(name, HD, [backdrop(HD), ...texts.map((t) => t.node)], { transport: { span: '2s' }, channels });
}
/** #466's mosaic dissolve between two shots of one wall in looks a and b, at 1080p, a figure-class document. */
function mosaicLook(id: string, body: string): JsonObject {
  return { ...PLAIN_LOOK, id, palette: { ...obj(PLAIN_LOOK['palette'], 'palette'), body }, roles: { ...obj(PLAIN_LOOK['roles'], 'roles'), body: 'body' } };
}
function transitionCall(dir: string): JsonObject {
  const pose = { move: 'hold', target: [0, 0.5, 0], orbit: { azimuth: 0, elevation: 0, distance: 7 } };
  const film = sceneDoc('mosaic-1080p', HD, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.5, 0], orbit: { azimuth: 0, elevation: 0, distance: 7 }, fov: 40, near: 0.1 } },
    sun: { kind: 'light.sun@1', params: { illuminance: Math.PI, shadow: false, angle: 0.53 }, at: { rot: [0, 0, 0] } },
    wall: { kind: 'mark.box@1', params: { size: [12, 8, 0.2], paint: { fill: { role: 'body' } } }, at: { pos: [0, 0.5, 0] } },
  }, {
    budget: { class: 'figure' }, packs: [`${PACK.id}@1.0.0`],
    shots: { a: { start: '0s', end: '2s', camera: 'cam', ...pose, look: 'a' }, b: { start: '2s', end: '4s', camera: 'cam', ...pose, look: 'b' } },
    transitions: { mz: { from: 'a', to: 'b', kind: 'operator', operator: { op: PACK.op, reads: ['outgoing', 'incoming', 'progress'] }, span: '1s', align: 'reveal', progress: 'linear' } },
  });
  const looks = { a: mosaicLook('mosaic-a', '#f0d282'), b: mosaicLook('mosaic-b', '#3c6ec8') };
  return view3d({ doc: writeJson(dir, 'mosaic', film), look: looks.a, looks, size: HD, fps: 60, from: 60, frames: 121, timings: true, packs: [{ id: PACK.id, dir: PACK.dir }] });
}
const keyed = (f: Frame, field: 'passes_ms' | 'declared_ms'): number | null => {
  const m = f.raw[field];
  if (!isObject(m)) return null;
  const v = m[TRANSITION];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

interface Reading { dof: number; glow: number; bevel: number; satin: number; declared: number; figure: number }
/** One run: every measure, each pair in one process. The warm-up run also checks each side draws what it times. */
function reading(warm: boolean): Reading {
  const dir = out();
  const [d1, d0] = runGpu(bin(), dir, [true, false].map((w) => view3d({ doc: writeJson(dir, `stage-${w}`, stage(w)), size: HD, fps: 60, frames: FRAMES, timings: true })));
  const dofSide = framesOf(d1!, 'the stage with dof'); const plainSide = framesOf(d0!, 'the stage without');
  const names = ['plain', 'glow', 'bevel', 'satin'] as const;
  const films = runGpu(bin(), dir, names.map((n) => film2dCall(paintFilm(`paint-${n}`, n === 'plain' ? {} : PAINTS[n]), { fps: 60, frames: FRAMES })));
  const filmFrames = films.map((r, k) => framesOf(r, `the ${names[k]} film`));
  const [tr] = runGpu(bin(), dir, [transitionCall(dir)]);
  const window = framesOf(tr!, 'the mosaic transition').filter((f) => keyed(f, 'passes_ms') !== null);
  if (warm) {
    const failures: string[] = [];
    if (dofSide[0]?.pixel_hash === plainSide[0]?.pixel_hash) failures.push(`dof: frame 0 with the effect has the pixel hash of frame 0 without it (${dofSide[0]?.pixel_hash}): the effect draws nothing`);
    names.slice(1).forEach((n, k) => { if (filmFrames[k + 1]![0]?.pixel_hash === filmFrames[0]![0]?.pixel_hash) failures.push(`${n}: frame 0 with it has the plain film's pixel hash: it draws nothing`); });
    if (window.length === 0) failures.push(`the mosaic transition: no frame of 60 to 180 times its pass under passes_ms.${TRANSITION}`);
    for (const f of window) if (keyed(f, 'declared_ms') === null) failures.push(`the mosaic transition: frame ${f.frame} times its pass but declares no cost under declared_ms.${TRANSITION}`);
    none(failures, `${ID}: each timed side draws what it times`);
  }
  const plain = median(gpuMs(filmFrames[0]!, 'the plain film'));
  const per = (k: number): number => Math.max(0, (median(gpuMs(filmFrames[k]!, `the ${names[k]} film`)) - plain) / ITEMS);
  return {
    dof: Math.max(0, median(gpuMs(dofSide, 'with dof')) - median(gpuMs(plainSide, 'without dof'))),
    glow: per(1), bevel: per(2), satin: per(3),
    declared: median(window.map((f) => keyed(f, 'passes_ms')!)) / median(window.map((f) => keyed(f, 'declared_ms')!)),
    figure: Math.max(...gpuMs(window, 'the mosaic transition')),
  };
}

describe(`${ID} the lens and focus task's budgets on the reference Mac, beside the merge base`, () => {
  it(`${ID} a composed transition within its declared cost and the figure class's 2 ms, dof with 64 taps under 0.8 ms at 1080p, and a glow, a bevel or satin under 0.15 ms an item at 1080p, five runs each by the lane's rule`, () => {
    requireMetal();
    reading(true);
    const problem = timingProblem();
    if (problem) inconclusive(`the budgets count only on a reference Mac at rest: ${problem}`);
    const runs: Reading[] = []; const loads: Load[] = [];
    for (let k = 0; k < 5; k++) { const start = load(); runs.push(reading(false)); loads.push({ start, end: load() }); }
    const judged: [string, JsonObject][] = [
      ['dof with 64 taps, added GPU ms a frame at 1080p (under 0.8)', judgeLimit(LIMITS.dof, runs.map((r) => r.dof), loads)],
      ['glow, added GPU ms an item at 1080p (under 0.15)', judgeLimit(LIMITS.paint, runs.map((r) => r.glow), loads)],
      ['bevel, added GPU ms an item at 1080p (under 0.15)', judgeLimit(LIMITS.paint, runs.map((r) => r.bevel), loads)],
      ['satin, added GPU ms an item at 1080p (under 0.15)', judgeLimit(LIMITS.paint, runs.map((r) => r.satin), loads)],
      ['the composed transition, measured ÷ declared (at most 1)', judgeLimit(LIMITS.declared, runs.map((r) => r.declared), loads)],
      ['the composed transition, worst frame GPU ms (the figure class: 2)', judgeLimit(LIMITS.figure, runs.map((r) => r.figure), loads)],
    ];
    for (const [name, v] of judged) console.log(`${ID} ${name}: ${String(v['status'])} ${shown(v['runs'] ?? null)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
    const failed = judged.filter(([, v]) => v['status'] === 'FAIL');
    expect(failed.map(([n, v]) => `${n}: ${shown(v)}`), 'no budget fails').toEqual([]);
    const open = judged.filter(([, v]) => v['status'] !== 'PASS');
    if (open.length) inconclusive(open.map(([n, v]) => `${n}: ${String(v['status'])} ${String(v['reason'] ?? '')}`).join('; '));
  });

  it(`${ID} a drop adds one fill, on a text and on a rect; and the perf lane carries these budgets beside the merge base: a budgets.json task for ${AC[5].split(' ')[1]} passing the lane's validator, and this file timed in the local preflight`, async () => {
    const failures: string[] = [];
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as { tasks: JsonObject[] };
    const mine = current.tasks.filter((t) => (Array.isArray(t['criteria']) && t['criteria'].includes('#468.43d77df2')) || /#468\b/.test(String(t['initialReason'] ?? '')));
    if (mine.length === 0) failures.push('benchmarks/budgets.json has no task for #468.43d77df2 (its criteria or its initialReason naming #468)');
    for (const t of mine) if (!(Array.isArray(t['command']) && t['command'].length > 0)) failures.push(`budgets.json task ${String(t['id'])} has no command the lane runs`);
    const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
    if (mergeBase.status !== 0) failures.push(`git merge-base HEAD origin/main: ${mergeBase.stderr}`);
    else {
      const base = spawnSync('git', ['show', `${mergeBase.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const verdict = base.status === 0 ? lane('try { b.validateBudgets(input.current, input.base); return "valid"; } catch (e) { return String(e.message); }', { current: current as unknown as JsonObject, base: JSON.parse(base.stdout) as JsonObject }) : base.stderr;
      if (verdict !== 'valid') failures.push(`the lane's validator refuses budgets.json against the merge base's: ${String(verdict)}`);
    }
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    if (!lanes.timed.includes('tests/acceptance/468/ac5-budgets.test.ts')) failures.push('scripts/lanes.mjs does not list tests/acceptance/468/ac5-budgets.test.ts in timed, the local preflight\'s perf step');

    requireMetal();
    const dir = out();
    const slab = (name: string, paint: JsonObject): JsonObject => doc2d(name, [360, 160], [backdrop([360, 160]), item('slab', 'rect@1', 'a1', { box: [60, 40, 200, 80], paint: { fill: { role: 'title' }, ...paint } })]);
    const pairs: [string, JsonObject, JsonObject][] = [
      ['a text', card('drop-text-plain'), card('drop-text', { drop: { offset: [7, 5], role: 'drop' } })],
      ['a rect', slab('drop-rect-plain', {}), slab('drop-rect', { drop: { offset: [7, 5], role: 'drop' } })],
    ];
    const replies = runGpu(bin(), dir, pairs.flatMap(([, a, b]) => [a, b].map((d) => film2dCall(d, { fps: 30, frames: 1 }))));
    pairs.forEach(([name], k) => {
      const fills = (s: 0 | 1): JsonValue | undefined => framesOf(replies[2 * k + s]!, `${name}${s ? ' with a drop' : ''}`)[0]?.raw['fills'];
      const plain = fills(0); const dropped = fills(1);
      console.log(`${ID} ${name}: ${shown(plain)} fills without a drop, ${shown(dropped)} with one`);
      if (typeof plain !== 'number' || typeof dropped !== 'number') failures.push(`${name}: frame 0 reports no count of fills (fills ${shown(plain)} without a drop, ${shown(dropped)} with one)`);
      else if (dropped - plain !== 1) failures.push(`${name}: a drop adds ${dropped - plain} fills, not one (${plain} without, ${dropped} with)`);
    });
    none(failures, `${ID}: the drop's one fill and the budgets' place in the perf lane`);
  });
});
