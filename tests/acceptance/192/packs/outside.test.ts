// #192.562b7ffc (criterion 6): a provider never registers a check kind, a builder, an operator or a tool entry, and
// the web player's bundle carries outputs by hash and runs no provider. An outside pack whose providers entry also
// names a check kind, a builder or an operator is refused at install, naming the entry; and the voxel piece's web
// player bundle holds the mesh by hash and no provider program.
//
// The voxel piece (README: Fixtures): test/voxpack's provider `mesher` (voxel_mesher.wat, one quad per exposed face)
// reads a 32 x 32 x 32 occupancy grid holding one solid 10 x 10 x 10 block, its asset `grid.bin`; a 3D scene draws its
// mesh through a `mesh.asset@1` item that names `{gen: "voxpack.mesher", params: {}}`. The three planted packs carry
// the same entry plus `check_kind`, `builder` or `operator` (this suite's spellings, README: The surface).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOC, SHOW, TIMEOUT, arr, deepShow, errors, hostReady, installPack, installShown, issuesAt, meshBytes, nodeRun, obj, prebuild, present, program,
  providerPack, runShow, scenario, sha256, show, str, useTemp, type JsonObject, type Program,
} from './helpers.ts';

/** Criterion 6's ID: `#192.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#192.562b7ffc';
prebuild(() => { deepShow(SHOW); });
const temp = useTemp();

/** The occupancy grid: 32 x 32 x 32 bytes, x fastest, then y, then z; 1 inside the block [11, 21) on each axis. */
function grid(): Buffer {
  const g = Buffer.alloc(32 * 32 * 32);
  for (let z = 11; z < 21; z++) for (let y = 11; y < 21; y++) for (let x = 11; x < 21; x++) g[x + 32 * y + 1024 * z] = 1;
  return g;
}
const mesher = (p: Program, gridSha: string, extra: JsonObject = {}): JsonObject =>
  ({ program: p.sha, params: {}, assets: [gridSha], out: { mesh: { max_vertices: 4096, closed: true } }, ...extra });
/** The planted entries: what each names besides the provider's own fields. */
const PLANTS = [
  { pack: 'checkkinds', key: 'check_kind', value: 'checkkinds.watertight@1' },
  { pack: 'builders', key: 'builder', value: 'builders.voxels' },
  { pack: 'operators', key: 'operator', value: 'operators.dilate' },
] as const;

/** The voxel piece: a 3D scene with a camera and the provider's mesh through mesh.asset@1. */
const voxelScene = (): JsonObject => ({
  format: 1, id: DOC.a, profile: 'scene', title: 'A voxel block', description: 'A voxel block a pack\'s provider meshes, a piece of the #192 acceptance suite.',
  size: [640, 360], camera: 'cam', seed: 192, transport: { span: '2s', frame_rate: [60, 1] },
  packs: ['test/voxpack@1.0.0'], requires: { modules: { scene3d: '^1' } },
  items: {
    cam: { id: 'cam', name: 'cam', order: 'a0000', kind: 'camera@1', params: { projection: 'perspective', position: [9, 7, 11], target: [4, 4, 4], fov: 40 } },
    block: { id: 'block', name: 'block', order: 'a0001', kind: 'mesh.asset@1', params: { sha256: { gen: 'voxpack.mesher', params: {} } } },
  },
});

describe(`${ID} a providers entry never registers a check kind, a builder or an operator, and the web bundle carries a provider's output, never its program`, () => {
  it(`${ID} an outside pack whose providers entry also names a check kind, a builder or an operator is refused at install, naming the entry; the voxel piece's web player bundle holds the mesh by hash and no provider program`, () => {
    hostReady();
    const voxels = program('voxel_mesher');
    const g = grid();
    const gridSha = sha256(g);
    // The fixture as written, in Node's engine: 600 quads, 2,400 vertices and 3,600 indices, the bytes the bundle holds.
    const ran = nodeRun(voxels, { assets: [g] });
    const mesh = meshBytes(ran);
    expect([ran.trap, mesh.n, mesh.indices], 'voxel_mesher.wat meshes the 10 x 10 x 10 block into 600 quads').toEqual([null, 2400, 3600]);
    const meshSha = sha256(mesh.bytes);

    const dir = temp();
    const assets = { 'voxel_mesher.wasm': voxels.bytes, 'grid.bin': g };
    const plants = PLANTS.map((p) => ({ ...p, dir: providerPack(dir, p.pack, { mesher: mesher(voxels, gridSha, { [p.key]: p.value }) }, assets).pack }));
    const clean = providerPack(dir, 'voxpack', { mesher: mesher(voxels, gridSha) }, assets).pack;
    const out = join(dir, 'bundle');
    const replies = runShow(deepShow(SHOW), scenario(dir, [
      ...plants.map((p) => installPack(p.dir)), installPack(clean), present(DOC.a, voxelScene()), { call: 'export', doc: DOC.a, out, video: { codec: 'web' } },
    ]));
    const [cleanInstall, shown, exported] = replies.slice(plants.length);

    // Each planted entry is refused at install, naming the entry and what it names.
    const missed = plants.flatMap((p, i) => {
      const r = replies[i];
      return r?.['outcome'] === 'refused' && issuesAt(r, `providers/mesher/${p.key}`).length > 0 ? [] : [`test/${p.pack}@1.0.0 (providers.mesher.${p.key}): ${installShown(r)}`];
    });
    expect(missed, 'each pack whose providers entry names a check kind, a builder or an operator is refused at install, with an issue at providers/mesher/<key>').toEqual([]);
    expect(cleanInstall!['outcome'], `test/voxpack@1.0.0, the same entry with none of them, installs: ${installShown(cleanInstall)}`).toBe('installed');

    // The voxel piece's bundle: the mesh by its hash, and no provider program.
    expect([shown!['outcome'], errors(shown)], `the voxel piece is presented with no error: ${show(shown)}`).toEqual(['presented', []]);
    expect(exported!['outcome'], `the voxel piece exports to the web player: ${show(exported)}`).toBe('exported');
    const receipt = obj(exported!['receipt'], 'the export: receipt');
    const files = arr(receipt['files'], 'receipt.files').map((f, i) => obj(f, `receipt.files[${i}]`));
    const held = files.find((f) => f['sha256'] === meshSha);
    expect(held, `the bundle lists the provider's mesh (${meshSha}, ${mesh.bytes.length} bytes) among its files: ${show(files.map((f) => `${String(f['path'])} ${String(f['sha256'])}`))}`).toBeDefined();
    const path = str(held!['path'], 'the mesh file: path');
    expect(path.startsWith(meshSha), `the mesh is stored by its hash: ${path}`).toBe(true);
    expect(sha256(readFileSync(join(out, path))), `${path} holds the mesh's bytes`).toBe(meshSha);

    const player = str(obj(receipt['player'], 'receipt.player')['hash'], 'receipt.player.hash');
    const forms = [voxels.bytes, Buffer.from(voxels.bytes.toString('hex')), Buffer.from(voxels.bytes.toString('base64'))];
    const programs: string[] = [];
    for (const name of readdirSync(out, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))) {
      const bytes = readFileSync(name);
      if (bytes.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d])) && sha256(bytes) !== player) programs.push(`${name.slice(out.length + 1)}: a WebAssembly module that isn't the player`);
      if (forms.some((f) => bytes.includes(f))) programs.push(`${name.slice(out.length + 1)}: holds the provider program's bytes (raw, hex or base64)`);
    }
    expect(programs, 'the bundle holds no provider program, as written or rewritten: its only WebAssembly is the player').toEqual([]);
  }, TIMEOUT);
});
