// This suite's logic programs, as a game's agent would write them, in WebAssembly text assembled by #544's assembler
// (tests/acceptance/544/wat, read only, through #538's helpers), and the documents that name them (README: Programs and documents). Each
// program names one catalog among its data assets: the logic module copies it into memory at `assets_at` after a u32 of
// its length (Logic `logic@1`), and the program reads it by table.layout@1's documented bytes alone: it finds a table by
// its name's FNV-1a hash in the directory, a column by its name's hash, and a row by a binary search on the table's ID
// column for the ID's hash (Asset: tables: catalogs, As built). Every program keeps to one write entry, so its write
// region's one entry lies at `writes_at`.
import { assemble, type Program } from '../538/helpers.ts';
import { CAPTION_SIZE, caption, film } from '../538/fixtures.ts';
import { HERO, characterWorld, heroBody, slab, standing } from '../182/helpers.ts';
import { fnv32a, i32, type Obj } from './helpers.ts';
import { copy } from './fixtures.ts';

export type { Program };
/** Where every program's data assets start: the second page. The catalog's first byte lies 4 past it. */
export const ASSETS_AT = 65_536;
const BASE = ASSETS_AT + 4;
const WRITES_AT = 4096;
/** The tuner's fire region (Check input: logic kinds, As built: `fires_at`): its input's i32 count, then its f64 height. */
export const FIRES_AT = 4352;
/** The step the tuner fires its jump at: 0.5 s at 120 Hz. */
export const FIRE_STEP = 60;

/** `$cell(table hash, column hash, ID hash)`: the address of that row's value in that column, or −1. */
const CELL = `
  (func $cell (param $tab i32) (param $col i32) (param $row i32) (result i32)
    (local $tc i32) (local $p i32) (local $i i32) (local $rows i32) (local $cc i32) (local $j i32) (local $q i32)
    (local $idat i32) (local $colat i32) (local $ty i32) (local $lo i32) (local $hi i32) (local $mid i32) (local $v i32)
    (local.set $tc (i32.load (i32.const ${BASE + 8})))
    (local.set $p (i32.const ${BASE + 20}))
    (block $found
      (loop $tables
        (if (i32.ge_u (local.get $i) (local.get $tc)) (then (return (i32.const -1))))
        (local.set $rows (i32.load offset=4 (local.get $p)))
        (local.set $cc (i32.load offset=8 (local.get $p)))
        (br_if $found (i32.eq (i32.load (local.get $p)) (local.get $tab)))
        (local.set $p (i32.add (local.get $p) (i32.add (i32.const 12) (i32.shl (local.get $cc) (i32.const 4)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $tables)))
    (local.set $idat (i32.const -1))
    (local.set $colat (i32.const -1))
    (local.set $q (i32.add (local.get $p) (i32.const 12)))
    (block $done
      (loop $cols
        (br_if $done (i32.ge_u (local.get $j) (local.get $cc)))
        (if (i32.eq (i32.load (local.get $q)) (i32.const ${i32(fnv32a('id'))}))
          (then (local.set $idat (i32.load offset=8 (local.get $q)))))
        (if (i32.eq (i32.load (local.get $q)) (local.get $col))
          (then
            (local.set $colat (i32.load offset=8 (local.get $q)))
            (local.set $ty (i32.load offset=4 (local.get $q)))))
        (local.set $q (i32.add (local.get $q) (i32.const 16)))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br $cols)))
    (if (i32.or (i32.eq (local.get $idat) (i32.const -1)) (i32.eq (local.get $colat) (i32.const -1)))
      (then (return (i32.const -1))))
    (local.set $hi (local.get $rows))
    (block $miss
      (loop $search
        (br_if $miss (i32.ge_u (local.get $lo) (local.get $hi)))
        (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
        (local.set $v (i32.load (i32.add (i32.const ${BASE}) (i32.add (local.get $idat) (i32.shl (local.get $mid) (i32.const 2))))))
        (if (i32.eq (local.get $v) (local.get $row))
          (then (return (i32.add (i32.const ${BASE}) (i32.add (local.get $colat)
            (i32.mul (local.get $mid)
              (select (i32.const 8) (select (i32.const 1) (i32.const 4) (i32.eq (local.get $ty) (i32.const 2)))
                (i32.or (i32.eq (local.get $ty) (i32.const 1)) (i32.eq (local.get $ty) (i32.const 4))))))))))
        (if (i32.lt_u (local.get $v) (local.get $row))
          (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
          (else (local.set $hi (local.get $mid))))
        (br $search)))
    (i32.const -1))`;
const HEAD = (extra = ''): string => `
  (memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))${extra}`;
const at = (table: string, column: string, id: string): string => `(call $cell (i32.const ${i32(fnv32a(table))}) (i32.const ${i32(fnv32a(column))}) (i32.const ${i32(fnv32a(id))}))`;

/**
 * Criterion 1: reads `table`.`column` (an f64) of row `id` in its init and writes it as `value` every step; −1 when
 * the table, the column or the row isn't found. Item: assets [the catalog], writes {value: f64}.
 */
export const f64Reader = (table: string, column: string, id: string): Program => assemble(`read_${table}_${column}_${id}`, `
(module${HEAD()}${CELL}
  (func $init (export "init") (param $seed i64) (local $a i32)
    (local.set $a ${at(table, column, id)})
    (if (i32.eq (local.get $a) (i32.const -1))
      (then (f64.store (i32.const 8192) (f64.const -1)))
      (else (f64.store (i32.const 8192) (f64.load (local.get $a))))))
  (func $step (export "step") (param $k i64)
    (f64.store (i32.const ${WRITES_AT}) (f64.load (i32.const 8192)))))`);

/**
 * Criterion 10: the logic reading a copy column's key into an array: reads `table`.`column` (a copy key, i32) of row
 * `id` in its init and writes it as `key` every step; −1 when not found. Item: assets [the catalog], writes {key: i32}.
 */
export const keyReader = (table: string, column: string, id: string): Program => assemble(`key_${table}_${column}_${id}`, `
(module${HEAD()}${CELL}
  (func $init (export "init") (param $seed i64) (local $a i32)
    (local.set $a ${at(table, column, id)})
    (if (i32.eq (local.get $a) (i32.const -1))
      (then (i32.store (i32.const 8192) (i32.const -1)))
      (else (i32.store (i32.const 8192) (i32.load (local.get $a))))))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${WRITES_AT}) (i32.load (i32.const 8192)))))`);

/**
 * Criterion 12: the platformer's logic. In its init it reads `tuning.jump_height`'s value (f64) into the global $h;
 * every step it writes $h as `height`, and at FIRE_STEP it fires its one input, the hero's jump, with $h as its height:
 * the count 1 at `fires_at` and the f64 after it (0 at every other step). `planted`: the jump height compiled in (1.0),
 * the catalog still named and never read. Item: assets [the catalog], writes {height: f64}, fires {platform: [hop]}.
 */
export const tuner = (planted: boolean): Program => assemble(planted ? 'tuner_compiled_in' : 'tuner', `
(module${HEAD(`
  (global (export "fires_at") i32 (i32.const ${FIRES_AT}))
  (global $h (mut f64) (f64.const 0))`)}${CELL}
  (func $init (export "init") (param $seed i64) (local $a i32)
    ${planted ? '(global.set $h (f64.const 1.0))' : `(local.set $a ${at('tuning', 'value', 'jump_height')})
    (if (i32.eq (local.get $a) (i32.const -1))
      (then (global.set $h (f64.const -1)))
      (else (global.set $h (f64.load (local.get $a)))))`})
  (func $step (export "step") (param $k i64)
    (f64.store (i32.const ${WRITES_AT}) (global.get $h))
    (if (i64.eq (local.get $k) (i64.const ${FIRE_STEP}))
      (then
        (i32.store (i32.const ${FIRES_AT}) (i32.const 1))
        (f64.store (i32.const ${FIRES_AT + 4}) (global.get $h)))
      (else (i32.store (i32.const ${FIRES_AT}) (i32.const 0))))))`);

/** Criterion 11: a step that writes k and never reads its assets. Item: writes {k: i32}, with or without the catalog. */
export const idle = (): Program => assemble('idle_194', `
(module${HEAD()}
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${WRITES_AT}) (i32.wrap_i64 (local.get $k)))))`);

// ---------------------------------------------------------------------------------------------------
// Documents (the agent's form, as #538's and #182's suites write them).

const LICENSE: Obj = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #194 acceptance tests.' };
/** A catalog's asset entry (Asset: tables: catalogs, As built), so the document's check runs table.layout@1's validator on it. */
export const catalogAsset = (sha: string): Obj => ({ sha256: sha, kind: 'catalog', layout: 'table.layout@1', license: LICENSE });
/** A logic item at `rate` Hz naming `assets` (by SHA-256) and, with `fires`, the world inputs it fires. */
export function logicItem(id: string, program: Program, writes: Record<string, string>, o: { assets?: string[]; fires?: Obj; rate?: number } = {}): Obj {
  return {
    id, kind: 'logic@1', name: `Logic ${id}`, order: 'a9',
    params: {
      program: program.sha, step_rate: o.rate ?? 60, writes: Object.fromEntries(Object.entries(writes).map(([n, type]) => [n, { type }])),
      ...(o.assets ? { assets: o.assets } : {}), ...(o.fires ? { fires: o.fires } : {}),
    },
  };
}
/** A film (#538's envelope) with one logic item `id` naming `catalog`, and the catalog listed as an asset. */
export function readerDoc(id: string, program: Program, writes: Record<string, string>, catalog: string | null, extra: Obj = {}, items: Obj[] = []): Obj {
  const doc = film(id, CAPTION_SIZE, [logicItem(id, program, writes, catalog ? { assets: [catalog] } : {}), ...items], { [`${id}_program`]: program.sha }, extra) as Obj;
  if (catalog) doc['assets']['catalog'] = catalogAsset(catalog);
  return doc;
}
/** Criterion 10: `shop` reads cudgel's name key; the caption shows it through keyed copy, `items[shop.key]`, over data.copy's items. */
export function shopDoc(program: Program, catalog: string): Obj {
  const c = copy();
  return readerDoc('shop', program, { key: 'i32' }, catalog, { locale: 'en', data: { copy: { en: { items: c['en']!['items']! }, fr: { items: c['fr']!['items']! } } } }, [caption({ copy: 'items[shop.key]' })]);
}

/** Criterion 12's world: a flat floor (top at y 0) and #182's capsule standing on it, its jump taken from the tuner's fires. */
export const PLATFORM = 'platform';
export const TUNER = 'tuner';
export function platformer(program: Program, catalog: string): Obj {
  const world = characterWorld({
    statics: { floor: slab(-10, 30, -1, 0, 4) },
    movers: { [HERO]: heroBody([0, standing(0), 0]) },
    inputs: { hop: { kind: 'jump', targets: [HERO], on: { logic: TUNER } } },
  });
  const item = (id: string, order: string, rest: Obj): Obj => ({ id, name: id, order, ...rest });
  return {
    format: 1, profile: 'scene', title: 'Platformer', description: 'A hero whose jump height is a tuning row: a #194 acceptance fixture.',
    size: [640, 360], camera: 'cam', seed: 194, transport: { span: '5s', frame_rate: [60, 1] },
    requires: { modules: { scene3d: '^1', logic: '^1', physics: '^1' } },
    worlds: { [PLATFORM]: world },
    items: {
      cam: item('cam', 'a000', { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 8], target: [0, 1, 0], fov: 40 } }),
      [TUNER]: { ...logicItem(TUNER, program, { height: 'f64' }, { assets: [catalog], fires: { [PLATFORM]: ['hop'] }, rate: 120 }), order: 'a001' },
    },
    assets: { tuner_program: { sha256: program.sha, license: LICENSE }, tuning: catalogAsset(catalog) },
  };
}
