// The two documents `deep-show` plays (README: The documents): criterion 4's fleet piece, whose two copies a match
// plays, and criterion 5's strategy map. Each is #391's envelope as #552's suite writes it, its logic item this suite's
// driver linked to a library by name and hash, its bytes in the scenario's evidence store. Nothing here plays or draws.

import { sha256, type JsonObject } from '../190/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import { FLEET, MAP, MAP_FIELD, Q, RADAR_CELL } from './fixtures.ts';
import { gridsOf } from './model.ts';
import { countsOf, driverText, heightsBytes, pagesOf, scriptBytes, writesOf } from './programs.ts';
import { BY_INTERFACE, FUEL_CAP, ITEM, type Fixture } from './helpers.ts';

/** The relay every piece declares; `match` plays its copies in one process, so nothing reaches it. */
const RELAY = 'https://relay.test/959';
export const NET = 'match';
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #959 acceptance tests.' };
const ulid = (k: number): string => `01JB959D${String(k).padStart(18, '0')}`;
export const DOC = { fleet: ulid(1), map: ulid(2) } as const;
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;
export type Size = [number, number];

/** What a document's logic item links: a library by its name@version and its object's hash. */
export interface Linked { name: string; asset: string; bytes: Buffer; module?: string }
/** The bytes a scenario's evidence store must hold for a document. */
export interface Made { document: JsonObject; evidence: Buffer[] }

function envelope(id: string, title: string, size: Size, span: string, modules: JsonObject, items: Record<string, JsonObject>, assets: JsonObject): JsonObject {
  const withIds: JsonObject = {};
  let k = 0;
  for (const [itemId, item] of Object.entries(items)) withIds[itemId] = { id: itemId, name: itemId, order: order(k++), ...item };
  return {
    format: 1, id, profile: 'scene', title, description: `${title}: a piece the #959 acceptance tests play.`, size, camera: 'cam', seed: 959,
    transport: { span, frame_rate: [60, 1] }, requires: { modules }, assets, items: withIds,
  };
}
/** The logic item `sense` of a document: the driver for `f`, importing `sight` from the library `lib` links. */
function senseItem(f: Fixture, lib: Linked, rate: number, drawY: number, more: JsonObject = {}): { item: JsonObject; evidence: Buffer[]; assets: JsonObject } {
  const script = scriptBytes(f.plate, f.params, f.plan, drawY);
  const heights = heightsBytes(f.plate);
  const pages = pagesOf(script.length, heights.length);
  const c = countsOf(f.plate, f.params, f.plan);
  const t = driverText(lib.module ?? BY_INTERFACE, c, pages);
  const program = assemble(t.name, t.text, 'program');
  const named = (bytes: Buffer): JsonObject => ({ sha256: sha256(bytes), license: LICENSE });
  return {
    item: {
      kind: 'logic@1',
      params: {
        program: program.sha, step_rate: rate, reads: [], writes: writesOf(c) as unknown as JsonObject, assets: [sha256(script), sha256(heights)],
        links: [{ name: lib.name, asset: lib.asset }], budget: { fuel: FUEL_CAP, memory: pages / 16 }, ...more,
      },
    },
    evidence: [program.bytes, script, heights, lib.bytes],
    assets: { sense_program: named(program.bytes), sense_script: named(script), sense_heights: named(heights), sense_library: named(lib.bytes) },
  };
}
const netItem = (rate: number, hashEvery: number): JsonObject => ({ kind: 'net@1', params: { relay: RELAY, players: 2, step_rate: rate, delay: 4, window: 0, hash_every: hashEvery } });

/** Criterion 4's piece: a camera and a table, the logic item `sense` at 30 Hz, and the net item (two players, lockstep, a hash every 10 match steps). */
export function fleetDoc(f: Fixture, lib: Linked): Made {
  const s = senseItem(f, lib, FLEET.rate, 1);
  const document = envelope(DOC.fleet, 'A fleet under sight', [640, 360], '2s', { scene3d: '^1', logic: '^1', net: '^1' }, {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 3, 30], target: [0, 0, 0], fov: 50 } },
    table: { kind: 'mark.box@1', params: { size: [40, 0.2, 20] }, at: { pos: [0, -0.1, 0] } },
    [ITEM]: s.item,
    [NET]: netItem(FLEET.rate, FLEET.hashEvery),
  }, s.assets);
  return { document, evidence: s.evidence };
}

/** The map's frame: 768 × 768 px over the 256 m plate, 3 px a metre, seen from straight above (+X right, +Z down). */
export const MAP_SIZE: Size = [768, 768];
const column = (name: string, as: string): JsonObject => ({ array: `${ITEM}.${name}`, as });
const paint = (rgb: [number, number, number]): JsonObject => ({ kind: 'material@1', params: { base_color: [...rgb, 1], unlit: true } });
const mark = (size: [number, number, number], material: string): JsonObject => ({ kind: 'mark.box@1', params: { size }, material, visible: false });
/** The height the driver draws rows at: a unit's box is 4 m high and stands on flat ground. */
export const MAP_DRAW_Y = 2;
/**
 * Criterion 5's piece (README: The strategy map): the terrain plate with its ridge, lit by one sun, its overlay
 * reading `sense.fog` through `match.me` in the shipped look's roles (`ink` unseen, `muted` radar, `none` seen); the
 * logic item `sense` (30 Hz) declaring the fog grid; four instancers fed by its arrays, each hidden by a seen column:
 * side 0's units, side 1's units, the radar blips and the last-seen ghosts; the net item.
 */
export function mapDoc(f: Fixture, lib: Linked, size: Size = MAP_SIZE): Made {
  const g = gridsOf(f.plate, f.params);
  const cell = RADAR_CELL * f.plate.spacing;
  const grid = `${ITEM}.fog`;
  const s = senseItem(f, lib, FLEET.rate, MAP_DRAW_Y, { fog: { grid, size: [g.fc, g.fr], origin: [f.plate.x0, f.plate.z0], cell } });
  const fed = (of: string, live: string, gen: string, pos: string, seen: string): JsonObject =>
    ({ kind: 'instance@1', params: { of: [of], live: column(live, 'bool'), gen: column(gen, 'u32'), pos: column(pos, 'f32'), seen: column(seen, 'i32') } });
  const document = envelope(DOC.map, 'A strategy map', size, '4s', { scene3d: '^1', logic: '^1', net: '^1' }, {
    cam: { kind: 'camera@1', params: { projection: 'orthographic', position: [0, 50, 0], target: [0, 0, 0], view_width: MAP.metres, near: 1, far: 200 } },
    sky: { kind: 'sky@1', params: { top: [0, 0, 0, 1], low: [0, 0, 0, 1], ambient_top: [0, 0, 0], ambient_low: [0, 0, 0] } },
    sun: { kind: 'light.sun@1', params: { illuminance: 3, color: [1, 1, 1], shadow: false }, at: { rot: [-60, 20, 0] } },
    soil: { kind: 'material@1', params: { base_color: [0.4, 0.6, 0.25, 1], metallic: 0, roughness: 1 } },
    ground: {
      kind: 'plate@1',
      params: {
        terrain: { height: MAP_FIELD, size: [MAP.metres, MAP.metres], spacing: f.plate.spacing, tile: 64, lod_levels: 1 },
        overlays: [{ grid, size: [g.fc, g.fr], cell, roles: ['ink', 'muted', 'none'], opacity: 1, player: 'match.me' }],
      },
      material: 'soil',
    },
    blue: paint([0.1, 0.35, 0.9]), orange: paint([0.9, 0.35, 0.1]), grey: paint([0.75, 0.75, 0.75]), pale: paint([0.55, 0.3, 0.2]),
    friend: mark([6, 4, 6], 'blue'), foe: mark([6, 4, 6], 'orange'), blip: mark([3, 1, 3], 'grey'), ghost: mark([8, 2, 8], 'pale'),
    [ITEM]: s.item,
    friends: fed('friend', 'live_a', 'gen', 'unit_pos', 'seen'),
    foes: fed('foe', 'live_b', 'gen', 'unit_pos', 'seen'),
    blips: fed('blip', 'unit_live', 'gen', 'blip_at', 'blip'),
    ghosts: fed('ghost', 'ghost_live', 'ghost_gen', 'ghost_at', 'ghost'),
    [NET]: netItem(FLEET.rate, FLEET.hashEvery),
  }, s.assets);
  return { document, evidence: s.evidence };
}
/** Fog cells a sight cell's side, for the tests' cell arithmetic. */
export { Q };
