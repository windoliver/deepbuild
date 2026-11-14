// #226's budgets, the `axes3d` mode of benchmarks/canvas.mjs (task `canvas-axes3d`): criterion 7's 3D axes (three
// linear scales on [−4, 4] over 8 m, the xy grid plane, labels facing the camera) against the same lines, ticks, labels
// and plane written as mark.line@1 and mark.text@1, each orbiting at 1080p for 300 frames with GPU timings in one
// deep-gpu process, in alternating order (`axes_over_marks`, the ratio of their p95 GPU frames); and the axes with a
// point carrying mod.axes@1 under a still camera for four frames, counting the items frames 1 to 3 map (`still_maps`).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(0.95 * xs.length) - 1)];
const TICKS = [-4, -2, 0, 2, 4];
const INK = { stroke: { role: 'ink' } };
/** Math value `v` on axis `a` (0 x, 1 y, 2 z) with `up: z`, `off` m below it (beside the z axis): the axes' own layout. */
const at = (a, v, off = 0) => [a === 0 ? v : a === 2 ? off : 0, a === 2 ? v : -off, a === 1 ? -v : 0];

const CAMERA = { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 25, distance: 24 }, fov: 45, near: 0.1, far: 200 } };
const SPIN = { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '5s', value: 360, interp: 'linear' } } };
const SCALES = Object.fromEntries(['x', 'y', 'z'].map((r) => [`${r}s`, { kind: 'scale@1', params: { type: 'linear', domain: [-4, 4], range: r, nice: false } }]));
const AXES = { ...SCALES, axes: { kind: 'axes3d@1', params: { x: 'xs', y: 'ys', z: 'zs', lengths: [8, 8, 8], up: 'z', planes: ['xy'] } } };
const POINT = { kind: 'mark.point@1', parent: 'axes', at: { pos: [2, 3, 1] }, params: { size: 10, paint: { fill: { role: 'ink' } } }, modifiers: [{ kind: 'mod.axes@1', params: { axes: 'axes' } }] };

/** The axes' lines, ticks, labels and grid written as marks in 3D. */
function twin() {
  const out = {};
  for (const a of [0, 1, 2]) {
    out[`line${a}`] = { kind: 'mark.line@1', params: { points: [at(a, -4), at(a, 4)], width: 1.5, paint: INK } };
    out[`ticks${a}`] = { kind: 'mark.line@1', params: { mode: 'segments', width: 1, paint: INK, points: TICKS.flatMap((v) => [at(a, v), at(a, v, 0.05)]) } };
    for (const v of TICKS) {
      out[`label${a}${v}`] = { kind: 'mark.text@1', at: { pos: at(a, v, 0.15) }, params: { text: String(v), font: 'body', size: 0.25, size_space: 'world', paint: { fill: { role: 'ink' } } } };
    }
  }
  const grid = TICKS.flatMap((v) => [[v, 0, 4], [v, 0, -4], [-4, 0, -v], [4, 0, -v]]);
  out.grid = { kind: 'mark.line@1', params: { mode: 'segments', width: 1, paint: { stroke: { role: 'muted' } }, points: grid } };
  return out;
}

/** A scene document of `items` under the camera, orbiting unless `still`, written into `dir`: its path. */
function doc(dir, name, items, still) {
  const all = Object.entries({ cam: CAMERA, ...items })
    .map(([id, item], k) => [id, { id, name: id, layer: 'main', order: `a${String(k).padStart(3, '0')}`, ...item }]);
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify({
    format: 1, id: name, profile: 'scene', title: name, description: 'The #226 budgets fixture.', size: [1920, 1080], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, budget: { class: 'figure' }, layers: { main: { writer: 'agent:bench', title: 'Main', order: 'a0' } },
    transport: { span: '5s' }, ...(still ? {} : { channels: { spin: SPIN } }), items: Object.fromEntries(all),
  }));
  return file;
}

export function axes3d({ root, release, once, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const look = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '379', 'fixtures', 'look.json'), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const [axesDoc, twinDoc, stillDoc] = [doc(dir, 'axes', AXES), doc(dir, 'twin', twin()), doc(dir, 'still', { ...AXES, pt: POINT }, true)];
    const view = (file, extra = {}) => ({ call: 'view3d', doc: file, look, size: [1920, 1080], frames: 300, fps: 60, capture: [], timings: true, ...extra });
    let k = 0;
    const measured = runs(() => {
      const twinFirst = k++ % 2 === 1;
      const answer = once('deep-gpu', ['run'], { out: dir, calls: twinFirst ? [view(twinDoc), view(axesDoc)] : [view(axesDoc), view(twinDoc)] });
      const still = once('deep-gpu', ['run'], { out: dir, calls: [view(stillDoc, { frames: 4, counts: true, timings: false })] }).replies?.[0];
      if (answer.ok !== true || answer.replies.some((r) => r.code) || !still || still.code) {
        throw Error(`deep-gpu answered ${JSON.stringify([answer, still]).slice(0, 1500)}`);
      }
      const [axes, marks] = (twinFirst ? [...answer.replies].reverse() : answer.replies).map((r) => p95(r.frames.map((f) => f.gpu_ms)));
      const stillMaps = still.frames.slice(1).reduce((n, f) => n + f.axes_mapped.length, 0);
      return { axes_p95_ms: axes, twin_p95_ms: marks, axes_over_marks: axes / marks, still_maps: stillMaps };
    });
    console.log(JSON.stringify({ task: 'canvas-axes3d', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
