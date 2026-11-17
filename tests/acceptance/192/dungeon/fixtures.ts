// This suite's packs and documents (README: Packs and documents), built from programs.ts's programs. Every name a
// test reads is here once.

import { assemble, sha256, writePack, type JsonObject, type PackDir, type Program } from './helpers.ts';
import { brain, dungeonLibrary, dungeonProvider, maker, reader, snapLibrary, snapProvider, tilesTwin, tilesValidator, voxelizer } from './programs.ts';

/** Two document seeds (the provider's seed is the document's), and the dungeon params of a 40 × 40 floor. */
export const SEED_A = 1_920_040;
export const SEED_B = 1_920_041;
export const FLOOR_1 = { floor: 1, height: 40, width: 40 };
export const FLOOR_40 = { floor: 40, height: 40, width: 40 };

export const program = {
  dungeon: (): Program => assemble('dungeon', dungeonProvider()),
  /** The library form as the pack carries it (a relocatable object), and the same text as a module for Node. */
  library: (): Program => assemble('dungeon_library', dungeonLibrary(false), 'library'),
  libraryModule: (): Program => assemble('dungeon_library', dungeonLibrary(false)),
  planted: (): Program => assemble('dungeon_planted', dungeonLibrary(true), 'library'),
  plantedModule: (): Program => assemble('dungeon_planted', dungeonLibrary(true)),
  validator: (): Program => assemble('tiles_validator', tilesValidator()),
  reader: (): Program => assemble('reader', reader()),
  maker: (library: string, seed: number, params: typeof FLOOR_40): Program => assemble('maker', maker(library, BigInt(seed), params), 'program'),
  brain: (): Program => assemble('brain', brain()),
  voxelizer: (): Program => assemble('voxelizer', voxelizer()),
  snap: (): Program => assemble('snap', snapLibrary(), 'library'),
  snapProvider: (): Program => assemble('snap_provider', snapProvider(), 'program'),
};

/** The dungeon provider's params schema: integers, in name order floor, height, width. */
export const DUNGEON_PARAMS: JsonObject = {
  floor: { type: 'u32', default: 1, range: [1, 99] },
  height: { type: 'u32', default: 40, range: [16, 64] },
  width: { type: 'u32', default: 40, range: [16, 64] },
};
/** The tile graph's layout as pack `name` declares it, and the provider's output in it. */
export const tilesLayout = (pack: string): string => `${pack}.tiles@1`;
export const dungeonOut = (pack: string): JsonObject => ({ data: { layout: tilesLayout(pack), max_bytes: 4096 } });
const TILES_DOC = 'A dungeon floor as a tile graph, little-endian: u32 width, u32 height, u32 node count n, then n rooms '
  + '{u16 x, u16 y, u16 w, u16 h} inside the floor, then n links {u16 a, u16 b} between rooms: 12 + 12n bytes.';

export interface LibraryForm { asset: Program; fixture: { seed: number; params: typeof FLOOR_40; expect: string } }
/**
 * `test/<name>@1.0.0`: the provider `<name>.floor` (the dungeon generator) writing a tile graph in the layout
 * `<name>.tiles@1`, which the pack declares with its validator and malformed twin; with `library`, the provider's
 * library form and its equality fixture.
 */
export function dungeonPack(root: string, name: string, library?: LibraryForm): PackDir {
  const assets: Record<string, Buffer> = {
    'dungeon.wasm': program.dungeon().bytes, 'tiles_validator.wasm': program.validator().bytes, 'tiles_twin.bin': tilesTwin(),
    ...(library ? { 'dungeon_library.wasm': library.asset.bytes } : {}),
  };
  return writePack(root, 'test', {
    name, version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #192 dungeon acceptance suite: a dungeon generator that writes a floor as a tile graph.',
    requires: { core: '>=0.0.0', modules: library ? { sandbox: '>=0.0.0', logic: '>=0.0.0' } : { sandbox: '>=0.0.0' } },
    providers: {
      floor: {
        program: program.dungeon().sha, params: DUNGEON_PARAMS, out: dungeonOut(name),
        ...(library ? { library: { asset: library.asset.sha, fixture: { seed: library.fixture.seed, params: library.fixture.params, expect: library.fixture.expect } } } : {}),
      },
    },
    layouts: { [tilesLayout(name)]: { validator: program.validator().sha, max_bytes: 4096, twins: [sha256(tilesTwin())], doc: TILES_DOC } },
  }, assets);
}

/** The voxelizer's params: `cell` (f64, m), then its mesh_in param `source`. */
export const VOX_PARAMS: JsonObject = { cell: { type: 'f64', unit: 'm', default: 0.25, range: [0.01, 10] }, source: { type: 'mesh' } };
/** `test/vox@1.0.0`: the provider `vox.voxelize`, whose mesh_in param `source` takes another item's built mesh. */
export function voxPack(root: string): PackDir {
  return writePack(root, 'test', {
    name: 'vox', version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #192 dungeon acceptance suite: a provider that voxelizes another item\'s built mesh.',
    requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0' } },
    providers: { voxelize: { program: program.voxelizer().sha, params: VOX_PARAMS, out: { mesh: { max_vertices: 24 } } } },
  }, { 'voxelizer.wasm': program.voxelizer().bytes });
}
/** `test/voxlink@1.0.0`: the library snap@1 with no fixture, and the provider `voxlink.voxelize` that links it. */
export function voxlinkPack(root: string): PackDir {
  const snap = program.snap();
  return writePack(root, 'test', {
    name: 'voxlink', version: '1.0.0', license: 'MIT',
    description: 'A test pack of the #192 dungeon acceptance suite: a provider linking a library that ships no fixture.',
    requires: { core: '>=0.0.0', modules: { sandbox: '>=0.0.0', logic: '>=0.0.0' } },
    libs: { 'snap@1': { asset: snap.sha, exports: ['snap'], fixtures: [] } },
    providers: {
      voxelize: {
        program: program.snapProvider().sha, params: { cell: VOX_PARAMS['cell']! }, out: { mesh: { max_vertices: 3 } },
        links: [{ name: 'snap@1', asset: snap.sha }],
      },
    },
  }, { 'snap.wasm': snap.bytes, 'snap_provider.wasm': program.snapProvider().bytes });
}

// ---------------------------------------------------------------------------------------------------
// Documents in the agent's form (#393: no `id`, no `layers`): each item given its ID, name and order key.

function itemsOf(items: Record<string, JsonObject>): JsonObject {
  return Object.fromEntries(Object.entries(items).map(([id, item], k) => [id, { id, name: id, order: `a${String(k).padStart(4, '0')}`, ...item }]));
}
export function board(title: string, seed: number, packs: PackDir[], items: Record<string, JsonObject>, modules: string[]): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}: a #192 dungeon acceptance fixture.`, size: [640, 360], seed,
    packs: packs.map((p) => `${p.id}@${p.version}`), requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) }, items: itemsOf(items),
  };
}
export function scene(title: string, seed: number, packs: PackDir[], items: Record<string, JsonObject>, modules: string[]): JsonObject {
  return { ...board(title, seed, packs, items, modules), profile: 'scene', size: [640, 480] };
}
/** A logic item at 60 Hz writing one array. */
export const logicItem = (prog: Program, writes: JsonObject, more: JsonObject = {}): JsonObject =>
  ({ kind: 'logic@1', params: { program: prog.sha, step_rate: 60, writes, ...more } });
/** The reader naming the dungeon provider's floor among its data assets (criteria 5 and 8). */
export const readerItem = (pack: string, params: typeof FLOOR_1): JsonObject =>
  logicItem(program.reader(), { head: { type: 'i32', count: 4 } }, { assets: [{ gen: `${pack}.floor`, params }] });
