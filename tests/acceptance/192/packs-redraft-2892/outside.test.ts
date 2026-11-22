// #192.562b7ffc (criterion 6): a provider never registers a check kind, a builder, an operator or a tool entry, and
// the web player's bundle carries outputs by hash and runs no provider. An outside pack whose providers entry also
// names a check kind, a builder or an operator is refused at install, naming the entry; and the voxel piece's web
// player bundle holds the mesh by hash and no provider program.
//
// The blind redraft after #2892 (README) of ../packs/outside.test.ts. Its install half is the first draft's, unchanged;
// its web-bundle half reads each bundle file as the page reads it (inflated where its stored bytes are gzip,
// ../../172-redraft-2892/helpers.ts), since #2892 stores the mesh and every other file with no compression of its own
// gzip, named from the SHA-256 of its stored bytes. The voxel piece and the planted packs are the first draft's
// (../packs/README.md: Fixtures); the four fixture definitions below are copied from its test file, which exports
// nothing, and everything else is imported from its helpers.
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  DOC, SHOW, TIMEOUT, arr, deepShow, errors, hostReady, installPack, installShown, issuesAt, meshBytes, nodeRun, obj, prebuild, present, program,
  providerPack, runShow, scenario, sha256, show, str, useTemp, type JsonObject, type Program,
} from '../packs/helpers.ts';
import { bundleAsRead, copyOf } from '../../172-redraft-2892/helpers.ts';

/** Criterion 6's ID: `#192.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#192.562b7ffc';
prebuild(() => { deepShow(SHOW); });
const temp = useTemp();

// Copied from ../packs/outside.test.ts: the grid, the provider entry, the planted entries and the voxel piece.
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

const isWasm = (b: Buffer): boolean => b.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]));

/** The voxel piece's bundle at `out` against its receipt, each file read as the page reads it. The mesh: a file whose
 * bytes as read hash to the mesh's SHA-256, named from the SHA-256 of its stored bytes and listed so by the receipt,
 * with the mesh's SHA-256 on the index page, where the page finds what the document names by hash. No provider
 * program: the only WebAssembly as read is the receipt's player, and no file holds the program's bytes raw, in hex or
 * in base64, stored or inflated. Each failure names the file, or the mesh's hash. */
function bundleFailures(out: string, receipt: JsonObject, meshSha: string, provider: Program): string[] {
  const f: string[] = [];
  const files = bundleAsRead(out);
  const listed = new Map(arr(receipt['files'], 'receipt.files').map((v, i) => {
    const x = obj(v, `receipt.files[${i}]`);
    return [str(x['path'], `receipt.files[${i}].path`), str(x['sha256'], `receipt.files[${i}].sha256`)] as const;
  }));
  const meshes = [...files.values()].filter((x) => sha256(x.read) === meshSha);
  if (!meshes.length) f.push(`the bundle holds no file that is the provider's mesh ${meshSha}, stored or inflated: ${show([...listed].map(([p, s]) => `${p} ${s}`))}`);
  for (const m of meshes) {
    const stored = sha256(m.stored);
    if (!m.path.startsWith(stored)) f.push(`the mesh ${meshSha}'s file ${m.path} isn't named from the SHA-256 of its stored bytes, ${stored}`);
    if (listed.get(m.path) !== stored) f.push(`the receipt lists the mesh ${meshSha}'s file ${m.path} as ${listed.get(m.path) ?? 'nothing'}, its stored bytes hash to ${stored}`);
  }
  if (!files.get('index.html')?.read.includes(Buffer.from(meshSha))) f.push(`the index page doesn't name the mesh by its hash ${meshSha}`);

  const playerHash = str(obj(receipt['player'], 'receipt.player')['hash'], 'receipt.player.hash');
  const playerPath = [...listed].find(([, sha]) => sha === playerHash)?.[0];
  if (!playerPath || !files.has(playerPath)) f.push(`the receipt's player ${playerHash} is no file of the bundle`);
  const forms = [provider.bytes, Buffer.from(provider.bytes.toString('hex')), Buffer.from(provider.bytes.toString('base64'))];
  for (const x of files.values()) {
    const how = x.gzip ? ' (stored gzip)' : '';
    if (x.problem) f.push(`${x.problem}, so it can't be searched as the page reads it`);
    if (isWasm(x.read) && x.path !== playerPath) f.push(`${x.path}${how}: a WebAssembly module that isn't the player`);
    if (forms.some((form) => x.stored.includes(form) || x.read.includes(form))) f.push(`${x.path}${how}: holds the provider program's bytes (raw, hex or base64)`);
  }
  return f;
}

describe(`${ID} a providers entry never registers a check kind, a builder or an operator, and the web bundle carries a provider's output, never its program`, () => {
  it(`${ID} an outside pack whose providers entry also names a check kind, a builder or an operator is refused at install, naming the entry; the voxel piece's web player bundle, read as the page reads it, holds the mesh by hash and no provider program`, () => {
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

    // The voxel piece's bundle, read as the page reads it: the mesh by its hash, and no provider program.
    expect([shown!['outcome'], errors(shown)], `the voxel piece is presented with no error: ${show(shown)}`).toEqual(['presented', []]);
    expect(exported!['outcome'], `the voxel piece exports to the web player: ${show(exported)}`).toBe('exported');
    const receipt = obj(exported!['receipt'], 'the export: receipt');
    expect(bundleFailures(out, receipt, meshSha, voxels), 'the bundle, read as the page reads it, holds the mesh by its hash and no provider program').toEqual([]);

    // The twins, made in test code from that bundle: the provider's program shipped as a file stored gzip, named from
    // its stored bytes as #2892 names files; and the mesh in no form.
    const shipped = copyOf(out, join(dir, 'twin-program'));
    const stored = gzipSync(voxels.bytes, { level: 9 });
    const programPath = `${sha256(stored)}.wasm`;
    writeFileSync(join(shipped, programPath), stored);
    const withProgram = bundleFailures(shipped, receipt, meshSha, voxels);
    expect(withProgram.filter((x) => x.startsWith(programPath)), `the bundle with the provider's program stored gzip as ${programPath} fails, naming it as WebAssembly that isn't the player and as the program's bytes`).toHaveLength(2);
    const meshless = copyOf(out, join(dir, 'twin-meshless'));
    const meshFiles = [...bundleAsRead(meshless).values()].filter((x) => sha256(x.read) === meshSha);
    for (const m of meshFiles) rmSync(join(meshless, m.path));
    expect(bundleFailures(meshless, receipt, meshSha, voxels).some((x) => x.includes(`holds no file that is the provider's mesh ${meshSha}`)), 'the bundle with the mesh in no form fails, naming the mesh').toBe(true);
  }, TIMEOUT);
});
