// What issue #430's fields ask of a group that no acceptance criterion reaches (tests/acceptance/430/README.md: Not
// asserted): the status guard over the pixels a pass wrote, a backdrop group with no children, passes in order with
// their grows summed, the eleven in a 3D writer layer's linear light, the shipped blur, a third-party pack's pass, the
// limits a group is refused at, and each writer layer composing alone on every path. Each runs the real `deep-gpu`.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GATE, LOOK, REPO, fx, floatsOf, layerOf, layersCall, px, readLayers, requireMetal, runGpu, useDir, useGpu, windowCall, decodePng, hasFile, type JsonObject, type JsonValue,
} from './acceptance/430/helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE = [120, 80] as const;
const LAYERS = { main: { writer: 'agent-a', title: 'Main', order: 'a1' } };
const item = (id: string, kind: string, order: string, params: JsonObject, extra: JsonObject = {}): JsonObject => ({ id, kind, layer: 'main', name: id, order, params, ...extra });
const rect = (id: string, order: string, box: number[], role: string, extra: JsonObject = {}): JsonObject => item(id, 'rect@1', order, { box, paint: { fill: { role } } }, extra);
const doc = (id: string, items: JsonObject, extra: JsonObject = {}): JsonObject => ({
  format: 1, id, profile: 'figure', title: id, description: `${id}: #430.`, size: [...SIZE], transport: { span: '4s' }, requires: { modules: { effects: '^1' } }, budget: { class: 'figure' }, layers: LAYERS, ...extra, items,
});
const pass = (id: string, steps: JsonObject): JsonObject => item(id, 'gpu.pass@1', 'z0', {
  origin: 'composed', about: `The fixture ${id}.`, inputs: { src: { type: 'texture', from: { texture: { target: { op: 'core', output: 'color' } } } } }, steps,
  outputs: { color: 'out', blend: 'replace' }, resolution: 'full', cost: { ns_per_px: 1 }, fallback: 'look',
});
const scaled = (id: string, by: number[]): JsonObject => pass(id, { uv: { op: 'screen_uv@1' }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } }, out: { op: 'mul@1', args: { a: 'c', b: by } } });
const added = (id: string, by: number[]): JsonObject => pass(id, { uv: { op: 'screen_uv@1' }, c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } }, out: { op: 'add@1', args: { a: 'c', b: by } } });

function main(d: JsonObject, extra: JsonObject = {}): ReturnType<typeof layerOf> {
  const out = dir();
  const [r] = runGpu(bin(), out, [layersCall(d, LOOK, extra)]);
  return layerOf(readLayers(out, r!, SIZE, d['id'] as string), 'main', d['id'] as string);
}

describe('#430 a group beyond the acceptance criteria', () => {
  it('a backdrop group with no children covers the frame it sits in, and only that', () => {
    requireMetal();
    const l = main(doc('childless-430', {
      back: rect('back', 'a0', [0, 0, 120, 80], 'fill200'),
      box: item('box', 'frame@1', 'a1', { box: [20, 10, 60, 40], overflow: 'show' }),
      adj: item('adj', 'group@1', 'a2', { backdrop: 'below', passes: [{ op: 'half' }] }, { parent: 'box' }),
      half: scaled('half', [0.5, 0.5, 0.5, 1]),
    }));
    expect(px(l.image, 40, 30), 'inside the frame: the pass ran').toEqual([100, 100, 100, 255]);
    expect(px(l.image, 100, 70), 'outside it: nothing changed').toEqual([200, 200, 200, 255]);
  }, 1_800_000);

  it('passes run in order, each on the last one\'s result', () => {
    requireMetal();
    const d = (first: string, second: string): JsonObject => doc(`order-${first}-430`, {
      g: item('g', 'group@1', 'a0', { passes: [{ op: first }, { op: second }] }),
      fill: rect('fill', 'a1', [20, 20, 60, 40], 'fill200', { parent: 'g' }),
      half: scaled('half', [0.5, 0.5, 0.5, 1]),
      plus: added('plus', [0.25, 0.25, 0.25, 0]),
    });
    // 200/255 halved, then 0.25 added, is 164; the other order is 132.
    expect(px(main(d('half', 'plus')).image, 50, 40)).toEqual([164, 164, 164, 255]);
    expect(px(main(d('plus', 'half')).image, 50, 40)).toEqual([132, 132, 132, 255]);
  }, 1_800_000);

  it('in a 3D writer layer one of the eleven modes blends in linear light', () => {
    requireMetal();
    const d = doc('subtract-3d-430', {
      cam: item('cam', 'camera@1', 'a0', { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 25, distance: 6 }, fov: 40, near: 0.1 }),
      cube: item('cube', 'mark.box@1', 'a9', { size: [0.1, 0.1, 0.1], paint: { fill: { role: 'accent' } } }, { at: { pos: [3, -3, 0] } }),
      back: rect('back', 'a1', [0, 0, 120, 80], 'fill200'),
      g: item('g', 'group@1', 'a2', { blend: 'subtract' }),
      over: rect('over', 'a3', [20, 20, 60, 40], 'magenta', { parent: 'g' }),
    }, { profile: 'scene', camera: 'cam', requires: { modules: { scene3d: '^1', effects: '^1' } } });
    const l = main(d, { float: true });
    expect(l.dim).toBe('3d');
    // Magenta (1, 0, 1) subtracted from linear 0.578 leaves its green alone.
    const [r, g, b] = fx(floatsOf(l, 'the layer'), 50, 40);
    expect([r, b]).toEqual([0, 0]);
    expect(g).toBeCloseTo(0.5776, 3);
  }, 1_800_000);

  it('the shipped blur is a Gaussian of its radius, and it stops at its own reach', () => {
    requireMetal();
    const l = main(doc('shipped-blur-430', {
      back: rect('back', 'a0', [0, 0, 120, 80], 'ground'),
      g: item('g', 'group@1', 'a1', { passes: [{ op: 'blur@1', params: { radius: 6 } }] }),
      fill: rect('fill', 'a2', [40, 20, 40, 40], 'ink', { parent: 'g' }),
    }));
    const [ink, ground] = [24, 255];
    expect(px(l.image, 60, 40)[0], 'the middle keeps the fill').toBe(ink);
    // On an edge a symmetric kernel gives each side half.
    expect(Math.abs(px(l.image, 40, 40)[0] - (ink + ground) / 2), 'the edge is half of each').toBeLessThan(20);
    expect(px(l.image, 37, 40)[0], 'the blur reaches past the edge').toBeLessThan(ground - 8);
    expect(px(l.image, 33, 40)[0], 'nothing past its radius').toBe(ground);
  }, 1_800_000);

  it('a third-party pack\'s pass runs by name, from the pack the call installs', () => {
    requireMetal();
    const dir2 = mkdtempSync(join(tmpdir(), 'deep-430-pack-'));
    const half = scaled('half', [0.5, 0.5, 0.5, 1])['params'] as JsonObject;
    writeFileSync(join(dir2, 'pack.json'), JSON.stringify({ operators: { 'acme.half@1': { ...half, id: 'acme.half@1', kind: 'pass', origin: 'pack' } } }));
    const l = main(doc('pack-pass-430', {
      g: item('g', 'group@1', 'a0', { passes: [{ op: 'acme.half@1' }] }),
      fill: rect('fill', 'a1', [20, 20, 60, 40], 'fill200', { parent: 'g' }),
    }), { packs: [dir2] });
    expect(px(l.image, 50, 40)).toEqual([100, 100, 100, 255]);
  }, 1_800_000);

  it('a group with a 3D child, or a 33rd isolated group in a frame, is refused, not drawn wrong', () => {
    requireMetal();
    const out = dir();
    const depth = doc('depth-child-430', {
      cam: item('cam', 'camera@1', 'a0', { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 25, distance: 6 }, fov: 40, near: 0.1 }),
      g: item('g', 'group@1', 'a1', { blend: 'subtract' }),
      cube: item('cube', 'mark.box@1', 'a2', { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, { parent: 'g' }),
    }, { profile: 'scene', camera: 'cam', requires: { modules: { scene3d: '^1', effects: '^1' } } });
    const many: JsonObject = {};
    for (let i = 0; i < 33; i++) {
      many[`g${i}`] = item(`g${i}`, 'group@1', `a${i}`, { isolate: true, blend: i === 0 ? 'subtract' : 'normal' });
      many[`r${i}`] = rect(`r${i}`, `b${i}`, [i, 0, 1, 1], 'ink', { parent: `g${i}` });
    }
    const [a, b] = runGpu(bin(), out, [layersCall(depth, LOOK), layersCall(doc('many-groups-430', many), LOOK)]);
    expect([a!['code'], a!['reason']]).toEqual(['operator_kind_rule', 'items/cube/parent']);
    const side = ((b!['layers'] as JsonObject[])[0]!['drawn'] as JsonObject)['gpu_layer'] as JsonObject;
    expect(side['code']).toBe('operator_limit');
  }, 1_800_000);

  it('on a film, a backdrop reads only its own writer layer', () => {
    requireMetal();
    const two = { under: { writer: 'agent-b', title: 'Under', order: 'a0' }, ...LAYERS };
    // Over a part of its own layer that drew nothing, a blur of nothing changes nothing, whatever lies beneath.
    const figure = (id: string, group: boolean): JsonObject => doc(id, {
      u: rect('u', 'a0', [0, 0, 120, 80], 'ink', { layer: 'under' }),
      s: rect('s', 'a1', [50, 0, 6, 80], 'raised', { layer: 'under' }),
      m: rect('m', 'a2', [0, 0, 10, 10], 'accent'),
      ...(group ? {
        adj: item('adj', 'group@1', 'a3', { backdrop: 'below', passes: [{ op: 'blur@1', params: { radius: 6 } }] }),
        cover: rect('cover', 'a4', [30, 20, 60, 40], 'accent', { parent: 'adj' }),
      } : {}),
    }, { layers: two });
    const film = (d: JsonObject): JsonObject => ({ call: 'film2d', doc: d, look: 'clean', fps: 60, frames: 1, hash: true });
    const out = dir();
    const [withGroup, without] = runGpu(bin(), out, [film(figure('film-backdrop-430', true)), film(figure('film-plain-430', false))]);
    const hash = (r: JsonObject): string => (r['frames'] as JsonObject[])[0]!['pixel_hash'] as string;
    expect(hash(withGroup!), 'the film: the other writer\'s stripe stays sharp').toBe(hash(without!));
  }, 1_800_000);

  it('a live 2D session runs a group\'s passes: an identity pass draws the plain frame, a halving pass doesn\'t', () => {
    requireMetal();
    const out = dir();
    const look = JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;
    const live = (id: string, passes: JsonObject[]): JsonObject => {
      const d = doc(id, {
        back: rect('back', 'a0', [0, 0, 120, 80], 'raised'),
        g: item('g', 'group@1', 'a1', { passes, isolate: true }),
        fill: rect('fill', 'a2', [20, 20, 60, 40], 'accent', { parent: 'g' }),
        same: scaled('same', [1, 1, 1, 1]), half: scaled('half', [0.5, 0.5, 0.5, 1]),
      });
      // A session's layer and writer come from its connection.
      delete d['layers'];
      for (const v of Object.values(d['items'] as JsonObject)) delete (v as JsonObject)['layer'];
      const path = join(out, `${id}.json`);
      writeFileSync(path, JSON.stringify(d));
      return { call: 'live', look, frames: 3, fps: 60, report: ['hashes'], sessions: [{ session: 's', writer: 'agent:a', doc: path, size: [...SIZE] }] };
    };
    const [plain, same, half] = runGpu(bin(), out, [live('live-plain-430', []), live('live-same-430', [{ op: 'same' }]), live('live-half-430', [{ op: 'half' }])]);
    const seen = (r: JsonObject): string => JSON.stringify(r).match(/"pixel_hash":"([0-9a-f]+)"/)?.[1] ?? `no hash: ${JSON.stringify(r).slice(0, 900)}`;
    expect(seen(plain!), 'the live view hashes its frames').toMatch(/^[0-9a-f]{64}$/);
    expect(seen(same!), 'an identity pass changes nothing').toBe(seen(plain!));
    expect(seen(half!), 'a halving pass changes the frame').not.toBe(seen(plain!));
  }, 1_800_000);

  it('where status can show, a pass that lands on a status color moves off it', () => {
    requireMetal();
    // The clean look's fail color.
    const FAIL = [0xbf, 0x23, 0x2b];
    const out = dir();
    const items = (near: number[]): JsonObject => ({
      g: item('g', 'group@1', 'a0', { passes: [{ op: 'land' }] }),
      fill: rect('fill', 'a1', [20, 20, 60, 40], 'accent', { parent: 'g' }),
      land: pass('land', { out: { op: 'const@1', args: { value: near, type: 'vec4<f32>' } } }),
      gate: item('gate', 'rect@1', 'a2', { box: [90, 60, 24, 16] }),
    });
    const shown = doc('guarded-430', items([...FAIL.map((v) => v / 255), 1]), { status_bindings: { 'gate-state': { target: 'items/gate/params/paint/fill', source: GATE } } });
    const [w] = runGpu(bin(), out, [windowCall(shown, 'fail')]);
    const image = decodePng(hasFile(out, w!['window'], 'png', 'the window'));
    expect(px(image, 50, 40).slice(0, 3), 'the guard moved the pass\'s pixels off the status color').not.toEqual(FAIL);
    // A part-transparent pixel is judged by its own color, not its premultiplied one.
    const see = (alpha: number, bound: boolean): number[] => {
      const d = doc(`seen-${bound}-430`, items([...FAIL.map((v) => (v / 255) * alpha), alpha]), bound ? { status_bindings: { 'gate-state': { target: 'items/gate/params/paint/fill', source: GATE } } } : {});
      const o = dir();
      const [r] = runGpu(bin(), o, [windowCall(d, 'fail')]);
      return px(decodePng(hasFile(o, r!['window'], 'png', 'the window')), 50, 40);
    };
    expect(see(0.5, true), 'half-covered status color moves too').not.toEqual(see(0.5, false));
  }, 1_800_000);
});
