// AC7 #427.f8669ef0: Motion paths: a selected item's evaluated positions over a span draw as a polyline sampled at the
// frame rate, each sample equal to the evaluated position within 1e-6 m, with ticks at keys. Pick hierarchy: the
// hierarchy built for surface hits draws its boxes to a chosen depth, and the leaf box count equals the hierarchy's.
// None of the new modes draws a status color, changes the revision or the live view's frame count, or can be cited as
// evidence.
//
// The quiet rule for the new modes (the second test of this file) was swapped for its blind redraft,
// paths-picks-redraft.test.ts (PATHS-PICKS-REDRAFT.md): its scene played, so the live view drew its animation.
//
// Motion paths: a box whose x runs 0 → 1 → 0 m over keys at 0, 0.5 and 2 s and whose z runs 0 → 1 m over 0 to 2 s,
// linearly, at the transport's default 60 frames a second; selected over 0–2 s it gives 121 samples at k ÷ 60 s (k ×
// 11,760,000 flicks), each at the position the test computes from the keys, and ticks at 0, 0.5 and 2 s. Pick
// hierarchy: 24 boxes of 0.4 m on a 6 × 4 grid 1.5 m apart, drawn to depth 64 (past any hierarchy over 24 items) and to
// depth 2; every box lies inside a drawn leaf box. The quiet rule is helpers.ts `quietProblems` over deviation, normals,
// tangents, probes, sound sources, motion paths and the pick hierarchy, on one scene that has what each draws.
import { describe, it } from 'vitest';
import {
  AC, type JsonObject, type V3, box, camera, channel, drew, far, fmt, mode, none, num, obj, objs,
  requireMetal, rowsOf, runShow, scenario, scene, show, sun, useBuilds, useDir, vec3,
} from './helpers.ts';

const ID = AC[7];
const bin = useBuilds(['deep-show']);
const dir = useDir();
const FRAME = 11_760_000;
const lerp = (keys: [number, number][], t: number): number => {
  for (let i = 1; i < keys.length; i++) if (t <= keys[i]![0]) { const [t0, v0] = keys[i - 1]!; const [t1, v1] = keys[i]!; return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0); }
  return keys.at(-1)![1];
};
const X: [number, number][] = [[0, 0], [0.5, 1], [2, 0]];
const Z: [number, number][] = [[0, 0], [2, 1]];
const at = (t: number): V3 => [lerp(X, t), 0, lerp(Z, t)];
const moving = (): JsonObject => scene('Moving box', { cam: camera([0.5, 0, 0.5], 6), mover: box([0, 0, 0], [0.3, 0.3, 0.3]), key: sun() },
  { transport: { span: '2s' }, channels: { x: channel('items/mover/at/pos/0', X), z: channel('items/mover/at/pos/2', Z) } });
const CUBES: V3[] = Array.from({ length: 24 }, (_, k) => [(k % 6) * 1.5 - 3.75, 0, Math.floor(k / 6) * 1.5 - 2.25]);

describe(`${ID} motion paths and the pick hierarchy, and every new mode is display only`, () => {
  it(`${ID} the selected box's path is sampled at the frame rate on its evaluated positions with ticks at keys, and the pick hierarchy's leaf boxes are the hierarchy's`, () => {
    requireMetal();
    const p: string[] = [];
    const [, path] = runShow(bin('deep-show'), scenario(dir(), [show(moving()), mode('motion_paths', { select: ['mover'], span: ['0s', '2s'] })]));
    const row = rowsOf(drew(path!, 'the motion paths mode').rows, 'mover', 'path');
    if (row.length !== 1) p.push(`mover: ${row.length} paths drawn, not 1`);
    else {
      const samples = objs(row[0]!['samples'], 'mover: samples');
      if (samples.length !== 121) p.push(`mover: ${samples.length} samples over 0–2 s, not 121 at 60 per second`);
      const bad = samples.findIndex((s, k) => s['t'] !== k * FRAME || far(vec3(s['pos']), at(k / 60)));
      if (bad >= 0) p.push(`mover: sample ${bad} is ${JSON.stringify(samples[bad]!['t'])} flicks at ${fmt(vec3(samples[bad]!['pos']))}, not ${bad * FRAME} at ${fmt(at(bad / 60))}`);
      const ticks = objs(row[0]!['ticks'], 'mover: ticks');
      const want = [0, 0.5, 2];
      if (ticks.length !== 3 || ticks.some((k, i) => k['t'] !== want[i]! * 705_600_000 || far(vec3(k['pos']), at(want[i]!)))) p.push(`mover: ticks ${JSON.stringify(ticks).slice(0, 400)}, not at the keys 0, 0.5 and 2 s on the path`);
    }

    const grid = scene('Box grid', Object.fromEntries([['cam', camera([0, 0, 0], 12)], ['key', sun()], ...CUBES.map((c, k): [string, JsonObject] => [`cube.${String(k).padStart(2, '0')}`, box(c, [0.4, 0.4, 0.4])])]));
    const [, deep, shallow] = runShow(bin('deep-show'), scenario(dir(), [show(grid), mode('pick_hierarchy', { depth: 64 }), mode('pick_hierarchy', { depth: 2 })]));
    const hierarchy = obj(deep!['hierarchy'], 'the pick hierarchy\'s own counts');
    const leavesWanted = num(hierarchy['leaves'], 'hierarchy.leaves');
    const boxes = drew(deep!, 'the pick hierarchy to depth 64').rows.filter((r) => r['what'] === 'pick_box');
    const leaves = boxes.filter((r) => r['leaf'] === true);
    if (leavesWanted < 1 || leaves.length !== leavesWanted) p.push(`the pick hierarchy draws ${leaves.length} leaf boxes; the hierarchy has ${leavesWanted}`);
    CUBES.forEach((c, k) => {
      const inside = leaves.some((l) => { const lo = vec3(l['min']); const hi = vec3(l['max']); return !!lo && !!hi && [0, 1, 2].every((a) => lo[a]! <= c[a]! - 0.2 + 1e-6 && hi[a]! >= c[a]! + 0.2 - 1e-6); });
      if (!inside) p.push(`cube.${String(k).padStart(2, '0')} at ${fmt(c)} lies in no drawn leaf box`);
    });
    const two = drew(shallow!, 'the pick hierarchy to depth 2').rows.filter((r) => r['what'] === 'pick_box');
    if (two.length === 0 || two.some((r) => typeof r['depth'] !== 'number' || r['depth'] > 2)) p.push(`to depth 2 the pick hierarchy draws boxes at depths ${JSON.stringify(two.map((r) => r['depth']))}`);
    none(p, 'motion paths and the pick hierarchy');
  }, 1_800_000);
});
