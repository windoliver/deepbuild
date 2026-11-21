// #3016.102eb480 (criterion 8): "`deep_query`'s cost for the third scene names each asset's bytes once, and they are
// the bytes the device holds for it, within 10%. On the merge base the device holds a copy per renderer and the reply
// names one"
//
// The third scene (README: Fixtures) with its four 100,000-triangle meshes as GLB files and its four 2,048 px base color
// maps as PNG files, put into the evidence store by their hashes, shown by alpha through `deep-show run` and asked for
// its cost through deep_query, as #1801's suite asks (its helpers, imported, not copied). The device's side is the Rust
// reading `ac8_device_bytes_reading` (noop.rs) prints: what the meshes' and the maps' caches hold on the device once
// the same scene's first frame is drawn on the noop lane, by the four of each kind, which are one size each.
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC, FULL, REPO, brief, costOf, png, presented, rows, run, scenario, show, stored, useBuilds, useEvidence, type JsonObject } from '../1801/helpers.ts';

const AC8 = 'AC8 #3016.102eb480';
const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** The heavy meshes' grid (fixture.rs: GRID): 250 × 200 quads, two triangles each. */
const GRID = [250, 200] as const;

/** A GLB of one node whose mesh is the grid: positions, normals, uv0 and u32 indices; `k` ripples it, so each is its own. */
function glb(k: number): Buffer {
  const [cols, rows_] = GRID; const nx = cols + 1; const ny = rows_ + 1; const n = nx * ny;
  const pos = new Float32Array(n * 3); const nor = new Float32Array(n * 3); const uv = new Float32Array(n * 2);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = j * nx + i; const a = i / cols; const b = j / rows_;
    pos.set([a - 0.5, 0.02 * Math.sin(a * 7 + k) * Math.cos(b * 5 + 0.3 * k), b - 0.5], v * 3);
    nor.set([0, 1, 0], v * 3); uv.set([a, b], v * 2);
  }
  const idx = new Uint32Array(cols * rows_ * 6);
  let at = 0;
  for (let j = 0; j < rows_; j++) for (let i = 0; i < cols; i++) { const a = j * nx + i; idx.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], at); at += 6; }
  const parts = [pos, nor, uv, idx].map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength));
  let offset = 0;
  const views = parts.map((p) => { const v = { buffer: 0, byteOffset: offset, byteLength: p.length }; offset += p.length; return v; });
  const bin = Buffer.concat(parts);
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: [-0.5, -0.02, -0.5], max: [0.5, 0.02, 0.5] },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 }] }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
  }));
  const pad = (b: Buffer, fill: number): Buffer => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const j = pad(json, 0x20); const bn = pad(bin, 0);
  const head = Buffer.alloc(12); head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bn.length, 8);
  const chunk = (type: string, body: Buffer): Buffer => { const h = Buffer.alloc(8); h.writeUInt32LE(body.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  return Buffer.concat([head, chunk('JSON', j), chunk('BIN\0', bn)]);
}

/** The third scene as fixture.rs builds it, its assets named by the hashes the store holds them under. */
function thirdScene(meshes: string[], maps: string[]): JsonObject {
  const items: JsonObject[] = [];
  const cam = (position: number[], target: number[]): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 45, near: 0.1, far: 500 } });
  const add = (id: string, item: JsonObject): void => { items.push({ id, name: id, order: `a${String(items.length).padStart(4, '0')}`, ...item }); };
  add('cam', cam([0, 4, 9], [0, 0.4, 0]));
  add('sun', { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: true }, at: { rot: [-45, 30, 0] } });
  add('sky', { kind: 'sky@1', params: { top: [0.15, 0.3, 0.75, 1], low: [0.45, 0.6, 0.85, 1], ambient_top: [0.25, 0.25, 0.25], ambient_low: [0.1, 0.1, 0.1], environment: { from: 'sky', size: 256 } } });
  add('floor_mat', { kind: 'material@1', params: { base_color: [0.05, 0.05, 0.06, 1], metallic: 1, roughness: 0.1, mirror: { strength: 1, blur: 0, plane: 'floor' } } });
  add('floor', { kind: 'plate@1', params: { grid: [1, 1], size: [40, 40] }, at: { pos: [0, 0, 0] }, material: 'floor_mat' });
  add('screen_mat', { kind: 'material@1', params: { base_color: [0.2, 0.2, 0.2, 1], roughness: 0.6 } });
  ['pip_a', 'pip_b'].forEach((id, n) => {
    add(`${id}_cam`, cam([n === 0 ? -8 : 8, 3, 4], [0, 0.4, 0]));
    add(`${id}_display`, { kind: 'display@1', params: { size: [0.8, 0.5], bezel: 0.02 }, at: { pos: [n === 0 ? -2.5 : 2.5, 1.6, -3] }, material: 'screen_mat' });
    add(id, { kind: 'inset@1', params: { face: `${id}_display#screen`, size: [0.76, 0.46], px_per_unit: 400, view: { camera: `${id}_cam` } } });
  });
  for (let k = 0; k < 4; k++) {
    add(`mat${k}`, { kind: 'material@1', params: { base_color: [1, 1, 1, 1], roughness: 0.5, maps: { base_color: maps[k]! } } });
    add(`mesh${k}`, { kind: 'mesh.asset@1', params: { sha256: meshes[k]!, node: 0 }, at: { pos: [-3 + 2 * k, 0.4, 0], scale: [1.6, 1.6, 1.6] }, material: `mat${k}` });
  }
  return {
    format: 1, profile: 'scene', title: 'Third scene', description: 'Four heavy meshes with their maps, a mirror floor and two view insets.',
    size: [320, 240], camera: 'cam', requires: { modules: { scene3d: '^1' } }, budget: { class: 'export' },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
  };
}

/** What the device holds for each mesh and each map, from noop.rs's reading. */
function deviceReading(): { perMesh: number; perMap: number; line: JsonObject } {
  const home = userInfo().homedir;
  const env = { ...process.env, HOME: home, CARGO_HOME: process.env['CARGO_HOME'] ?? join(home, '.cargo'), RUSTUP_HOME: process.env['RUSTUP_HOME'] ?? join(home, '.rustup'), CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
  const args = ['test', '--locked', '-p', 'deep-scene3d-render', '--test', 'acceptance_3016_noop', '--', '--ignored', '--exact', 'ac8_device_bytes_reading', '--nocapture'];
  const r = spawnSync('cargo', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 3_000_000 });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('ACCEPTANCE_3016_AC8 '));
  expect(line, `cargo ${args.join(' ')} prints the reading (exit ${r.status}): ${(r.stderr ?? '').slice(-3000)}`).toBeDefined();
  const reading = JSON.parse(line!.slice('ACCEPTANCE_3016_AC8 '.length)) as JsonObject;
  return { perMesh: Number(reading['per_mesh']), perMap: Number(reading['per_map']), line: reading };
}

describe(`${AC8} deep_query's cost names each asset's bytes once, the bytes the device holds for it`, () => {
  it(`${AC8} each mesh's and map's row is the one copy the device holds, within 10%`, () => {
    const bin = builds.bin(FULL);
    const root = evidence();
    const meshes = [0, 1, 2, 3].map((k) => stored(root, glb(k)));
    const maps = [0, 1, 2, 3].map((k) => stored(root, png(2048, 2048, [40 + 50 * k, 120, 200 - 40 * k, 255])));
    const [shown, cost] = run(bin, scenario(root, { [DOC.cost]: null }, [show(DOC.cost, thirdScene(meshes, maps)), costOf(DOC.cost, 'gpu_mb')]));
    presented(shown, 'the third scene');
    const got = rows(cost, 'cost by gpu_mb');
    const device = deviceReading();
    // Guard: the reading read the scene: every mesh and map is on the device.
    expect(device.perMap, `the device holds the maps: ${brief(device.line)}`).toBeGreaterThan(2048 * 2048 * 4);
    const failures: string[] = [];
    for (const [kind, list, held] of [['mesh', meshes, device.perMesh], ['map', maps, device.perMap]] as const) {
      for (const sha of list) {
        const named = got.filter((r) => r['asset'] === sha);
        if (named.length !== 1) { failures.push(`${kind} ${sha}: the reply names it in ${named.length} rows, not once`); continue; }
        const bytes = Number(named[0]!['gpu_mb']) * 1e6;
        if (!(Math.abs(bytes - held) <= 0.1 * held)) failures.push(`${kind} ${sha}: the reply names ${bytes.toFixed(0)} B (${(bytes / 2 ** 20).toFixed(1)} MiB), the device holds ${held.toFixed(0)} B (${(held / 2 ** 20).toFixed(1)} MiB) for it: ${(held / bytes).toFixed(2)} ×`);
      }
    }
    expect(failures, `${AC8}: device reading ${brief(device.line)}:\n  ${failures.join('\n  ')}`).toEqual([]);
  });
});
