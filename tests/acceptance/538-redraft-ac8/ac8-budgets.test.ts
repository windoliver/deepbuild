// AC8 #538.ed6f8052: Budgets, on the reference Mac in the local preflight, compared with the merge base: comparing 1 MiB
// of arrays after a step takes under 0.2 ms; remapping one changed row of a 9,216-row layer under 20 µs and the whole
// layer under 1 ms; uploading 1,000 changed slots of a 100,000-slot instancer under 0.5 ms; a 256 × 256 overlay upload
// under 0.1 ms; the fit check over a 5,000-key table in three locales under 2 s at check; and a document with no logic
// columns gains no work per frame
//
// The blind redraft of this criterion (README). One timed test, in four parts:
//   1. No work per frame, by counters, on every machine. In deep-show, `frames` with `timings` of a still 2D document
//      with no logic columns (a text, a localized caption, 30 labels from data columns, a group of two rects) against
//      the bare one (a rect) in the same process: no frame after the first runs more operators than the bare one's same
//      frame, compares an array or remaps a row. In deep-gpu, `view3d` with `counts` and `timings` of a still 3D scene
//      with no logic columns (a terrain plate with no overlay, 200 instances from data columns): no frame after the first
//      writes an instance record, builds a mesh, uploads an element or spends upload time on any item.
//   2. The timing surfaces, on the debug build, over the fixtures the clauses name, each guarded so what it times is the
//      clause's work. The logic programs are this file's own (README: Programs), each running every step within the
//      logic item's default budget: `heap` stores all 1,048,576 bytes of its array at every step and changes one element
//      (a reader of it remaps one row a frame), and each frame's comparison covers those bytes; the 9,216-row `layer`
//      remaps one row a step and every row on its first frame and on five seeks back; `swarm` uploads the 1,000 slots of
//      100,000 its step spawned; `field`'s 256 × 256 overlay flips every cell at every step and draws another picture each
//      frame; `goods` holds 5,000 keys in en, fr and de in a box one line high, all fitting, and the same table with de's
//      last key too long is refused at check naming that key and locale, so the fit check timed reads every key.
//   3. The record the perf lane and the budget window compare with the merge base: benchmarks/budgets.json's task
//      `canvas-game-state`, valid by the lane's validator, and scripts/lanes.mjs runs this file as a timed one.
//   4. Only where the lane can judge a timing (a reference Mac at rest, else INCONCLUSIVE before anything is timed):
//      release builds, a warm-up run and five, each run's medians judged by scripts/benchmark.mjs's judgeLimit (imported
//      through ../538/helpers.ts, never copied). A FAIL fails; anything but PASS is INCONCLUSIVE, never a pass.
// Parts 1 to 3 gather what is missing or wrong into one list, asserted here before any timing, so a run names all of it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLOCK, CROWD_WRITES, FIELD, FOG_WRITES, HEAP, HEAP_WRITES, LAYER_CELLS, SLOTS, WRITES_AT, layerProgram, offsets, pagesFor, shopProgram,
} from '../538/programs.ts';
import { FIT_KEYS, FIT_LOCALES, LONG_DE, film, fitDoc, layerAtlas, layerDoc, logicItem, stillDoc } from '../538/fixtures.ts';
import {
  DOC, REPO, TIMEOUT, assemble, binOf, errorsOf, framesCall, inconclusive, isObject, judgeLimit, load, median, namedIn, names, prebuild,
  putEvidence, runShow, scenario, show, showCall, useTemp, validateBudgets, type JsonObject, type JsonValue, type Program,
} from '../538/helpers.ts';
import {
  DARK_SKY, column, logicItem as logic3d, material, putAsset, requireMetal, runGpu, sessionDoc, sun, topDown, view3dCall, writeJson,
} from '../537/helpers.ts';

prebuild(['full', 'gpu']);
const temp = useTemp();
const ID = '#538.ed6f8052';
const FILE = 'tests/acceptance/538-redraft-ac8/ac8-budgets.test.ts';
/** The task the perf lane and the budget window run, as the first suite's README names it (README: The record). */
const TASK = {
  id: 'canvas-game-state', command: ['node', 'benchmarks/canvas.mjs', 'game-state'],
  targets: { compare_ms: 0.2, remap_row_us: 20, remap_layer_ms: 1, upload_slots_ms: 0.5, overlay_upload_ms: 0.1, fit_check_ms: 2000, idle_steps: 0 },
};
const RUNS = 5;
const STILL_FRAMES = 6;
const HEAP_FRAMES = 20;
const LAYER_FRAMES = 40;
/** Seeks back, each to a frame earlier than the one drawn before it: every row remaps. */
const SEEKS = [30, 25, 20, 15, 10];
const GPU_FRAMES = 30;
const SHORT: JsonObject = { span: '0.5s', frame_rate: [60, 1] };
const D = { still: DOC(21), bare: DOC(22), heap: DOC(23), layer: DOC(24), fit: DOC(25), tight: DOC(26) };

// ---------------------------------------------------------------------------------------------------
// Programs (README: Programs): WebAssembly text in the first suite's layout (../538/programs.ts: `memory`, `init`,
// `step`, `reads_at` 0, `writes_at` 4096, arrays in declaration order on 8-byte boundaries), assembled by #544's
// assembler. Each keeps every step within the logic item's default budget (1,000,000 fuel, 4 MiB, 64 KiB of stack).

const head = (pages: number): string => `
  (memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64))`;
/** Sixteen i64 stores of `$v` at `$p` + 0, 8, … 120: 128 bytes. */
const SIXTEEN = Array.from({ length: 16 }, (_, j) => `(i64.store offset=${8 * j} (local.get $p) (local.get $v))`).join('\n      ');

/** `heap` (`a`: i32 × 262,144, 1 MiB): element i is 1 once step i has run, else 0. Every step stores all 1 MiB, 32
 * elements a loop pass, so step k changes element k alone. */
const heapProgram = (): Program => assemble('heap1mib', `
(module${head(pagesFor(HEAP_WRITES))}
  (func (export "step") (param $k i64) (local $p i32) (local $v i64) (local $e i32) (local $kk i32)
    (local.set $kk (i32.wrap_i64 (local.get $k)))
    (local.set $p (i32.const ${WRITES_AT}))
    (loop $each
      (local.set $v (select (i64.const 4294967297) (i64.const 0)
        (i32.le_s (i32.add (i32.shr_u (i32.sub (local.get $p) (i32.const ${WRITES_AT})) (i32.const 2)) (i32.const 31)) (local.get $kk))))
      ${SIXTEEN}
      (local.set $p (i32.add (local.get $p) (i32.const 128)))
      (br_if $each (i32.lt_u (local.get $p) (i32.const ${WRITES_AT + 4 * HEAP}))))
    (local.set $e (i32.and (local.get $kk) (i32.const -32)))
    (block $done
      (loop $fix
        (br_if $done (i32.gt_s (local.get $e) (local.get $kk)))
        (br_if $done (i32.ge_u (local.get $e) (i32.const ${HEAP})))
        (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $e) (i32.const 2))) (i32.const 1))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $fix)))))`);

/** `crowd` (100,000 slots: `live` bool, `gen` i32, `pos` vec3): step k, for k under 100, spawns the 1,000 slots of block
 * k (slots 1,000 k to 1,000 k + 999): live, gen 1, at ((s mod 400) − 200, 0, ⌊s ÷ 400⌋ − 125) m. */
function crowdProgram(): Program {
  const o = offsets(CROWD_WRITES);
  return assemble('spawn', `
(module${head(pagesFor(CROWD_WRITES))}
  (func (export "step") (param $k i64) (local $s i32) (local $end i32) (local $q i32)
    (br_if 0 (i64.ge_s (local.get $k) (i64.const ${SLOTS / BLOCK})))
    (local.set $s (i32.mul (i32.wrap_i64 (local.get $k)) (i32.const ${BLOCK})))
    (local.set $end (i32.add (local.get $s) (i32.const ${BLOCK})))
    (loop $each
      (i32.store (i32.add (i32.const ${o['live']}) (i32.shl (local.get $s) (i32.const 2))) (i32.const 1))
      (i32.store (i32.add (i32.const ${o['gen']}) (i32.shl (local.get $s) (i32.const 2))) (i32.const 1))
      (local.set $q (i32.add (i32.const ${o['pos']}) (i32.mul (local.get $s) (i32.const 24))))
      (f64.store offset=0 (local.get $q) (f64.convert_i32_s (i32.sub (i32.rem_u (local.get $s) (i32.const 400)) (i32.const 200))))
      (f64.store offset=16 (local.get $q) (f64.convert_i32_s (i32.sub (i32.div_u (local.get $s) (i32.const 400)) (i32.const 125))))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $s) (local.get $end))))))`);
}

/** `fogger` (`fog`: i32 × 65,536 on 256 × 256, index 256 cz + cx): (cx + cz + k) mod 2, so every cell flips at every
 * step between the overlay's roles 0 (fog) and 1 (dim). */
const foggerProgram = (): Program => assemble('flipfog', `
(module${head(pagesFor(FOG_WRITES))}
  (func (export "step") (param $k i64) (local $p i32) (local $v i64) (local $kk i32)
    (local.set $kk (i32.wrap_i64 (local.get $k)))
    (local.set $p (i32.const ${WRITES_AT}))
    (loop $each
      (local.set $v (select (i64.const 1) (i64.const 4294967296)
        (i32.and (i32.add (local.get $kk) (i32.shr_u (i32.sub (local.get $p) (i32.const ${WRITES_AT})) (i32.const 10))) (i32.const 1))))
      ${SIXTEEN}
      (local.set $p (i32.add (local.get $p) (i32.const 128)))
      (br_if $each (i32.lt_u (local.get $p) (i32.const ${WRITES_AT + 4 * FIELD * FIELD}))))))`);

// ---------------------------------------------------------------------------------------------------
// Documents (README: Fixtures).

/** `heap` and `reader`, an atlas tile set of 512 × 512 cells reading `heap.a` as its tile, over 0.5 s (30 steps). */
function heapDoc(program: Program, atlas: string): JsonObject {
  return film('heap', [520, 520], [logicItem('heap', program, HEAP_WRITES), {
    id: 'reader', kind: 'marks@1', name: 'Reader', order: 'a1', at: { pos: [4, 4, 0] },
    params: { mark: 'image', atlas: { asset: atlas, cell: [4, 4], padding: 1 }, grid: { shape: 'square', cell: [1, 1], size: [512, 512] }, columns: { tile: { array: 'heap.a', as: 'u16' } } },
  }], { [`${program.name}_program`]: program.sha, heap_atlas: atlas }, { transport: SHORT });
}

/** `goods` (../538/fixtures.ts `fitDoc`: 5,000 keys in en, fr and de, its argument at '999'), its text in a box 300 u
 * wide and one line high, so the fit check measures every string against a bound; with `tooLong`, de's last key is the
 * first suite's long German sentence, which shapes far wider than 300 u. */
function goodsDoc(shop: Program, tooLong = false): JsonObject {
  const doc = fitDoc(shop);
  const ware = (doc['items'] as JsonObject)['ware'] as JsonObject;
  ware['params'] = { ...(ware['params'] as JsonObject), box: { w: 300, h: 20 }, max_lines: 1 };
  if (tooLong) ((((doc['data'] as JsonObject)['copy'] as JsonObject)['de'] as JsonObject)['goods'] as JsonObject)[String(FIT_KEYS - 1)] = LONG_DE;
  return doc;
}

/** The still 2D document with no logic columns (../538/fixtures.ts `stillDoc`) with a localized caption beside it
 * (#407's `copy: key`, the copy path keyed copy joins), and the bare one. */
function stillDocs(): { still: JsonObject; bare: JsonObject } {
  const still = stillDoc(false);
  (still['items'] as JsonObject)['note'] = { id: 'note', kind: 'text@1', name: 'Note', order: 'a4', at: { pos: [8, 360, 0] }, params: { copy: 'note', size: 13 } };
  still['locale'] = 'en';
  still['data'] = { copy: { en: { note: 'A quiet board' }, fr: { note: 'Un plateau calme' } } };
  return { still, bare: stillDoc(true) };
}

/** The still 3D scene with no logic columns: a 64 m terrain plate with no overlay and 200 boxes from data columns. */
function quietScene(): JsonObject {
  const rocks = Array.from({ length: 200 }, (_, i) => i);
  return sessionDoc('quiet', [320, 200], {
    cam: topDown([0, 0, 0], 64), sky: DARK_SKY, sun: sun(3, [-60, 20, 0]), soil: material({ base_color: [0.16, 0.3, 0.1, 1], metallic: 0, roughness: 1 }),
    paint: material({ base_color: [0.9, 0.9, 0.2, 1], unlit: true }),
    ground: { kind: 'plate@1', material: 'soil', params: { terrain: { height: '0', size: [64, 64], spacing: 1, tile: 64, lod_levels: 1 } } },
    pebble: { kind: 'mark.box@1', params: { size: [0.6, 0.6, 0.6] }, material: 'paint', visible: false },
    rocks: { kind: 'instance@1', params: { of: ['pebble'], ids: rocks.map((i) => i + 1), pos: rocks.map((i) => [(i % 20) * 3 - 30, 0.3, Math.floor(i / 20) * 3 - 15]) } },
  }, { transport: SHORT, requires: { modules: { scene3d: '^1' } } });
}

/** `swarm` (100,000 slots of a 0.6 m box from `crowd`, 420 m across 640 × 400 px) and `field` (a 256 × 256 m terrain
 * plate at 1 m spacing with one overlay from `fogger.fog`), as the first suite draws them, fed by this file's programs. */
function gpuScenes(crowd: Program, fogger: Program): { swarm: JsonObject; field: JsonObject } {
  const swarm = sessionDoc('swarm', [640, 400], {
    cam: topDown([0, 0, 0], 420), sky: DARK_SKY, paint: material({ base_color: [0.9, 0.9, 0.2, 1], unlit: true }),
    pebble: { kind: 'mark.box@1', params: { size: [0.6, 0.6, 0.6] }, material: 'paint', visible: false },
    crowd: logic3d(crowd, CROWD_WRITES),
    swarm: { kind: 'instance@1', params: { of: ['pebble'], live: column('crowd.live', 'bool'), gen: column('crowd.gen', 'u32'), pos: column('crowd.pos', 'f32') } },
  }, { transport: SHORT });
  const field = sessionDoc('field', [512, 512], {
    cam: topDown([0, 0, 0], FIELD), sky: DARK_SKY, sun: sun(3, [-60, 20, 0]), soil: material({ base_color: [0.16, 0.3, 0.1, 1], metallic: 0, roughness: 1 }),
    fogger: logic3d(fogger, FOG_WRITES),
    field: {
      kind: 'plate@1', material: 'soil',
      params: { terrain: { height: '0', size: [FIELD, FIELD], spacing: 1, tile: 64, lod_levels: 1 }, overlays: [{ grid: 'fogger.fog', size: [FIELD, FIELD], roles: ['fog', 'dim', 'none'], opacity: 1 }] },
    },
  }, { transport: SHORT });
  return { swarm, field };
}

// ---------------------------------------------------------------------------------------------------
// Readings

/** One run's numbers: each the median over the frames (or remaps) the clause names, in its own unit. */
interface Reading { compare: number; remapRow: number; remapLayer: number; uploadSlots: number; overlay: number; fit: number }

/** What a run found missing or wrong: one line per kind of gap (the first frame that shows it), so the list stays short. */
class Gaps {
  readonly list: string[] = [];
  private readonly seen = new Set<string>();
  add(kind: string, line: string): void {
    if (this.seen.has(kind)) return;
    this.seen.add(kind);
    this.list.push(line);
  }
  /** A non-negative finite number, else a gap of `kind` and NaN. */
  num(v: JsonValue | undefined, kind: string, what: string): number {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    this.add(kind, `${what} is not a number of ms: ${show(v, 200)}`);
    return Number.NaN;
  }
  /** A reply's list field as objects, else a gap and none. */
  objects(v: JsonValue | undefined, kind: string, what: string): JsonObject[] | null {
    if (Array.isArray(v)) return v.filter(isObject);
    this.add(kind, `${what} is not a list: ${show(v, 200)}`);
    return null;
  }
}
const med = (xs: number[]): number => (xs.length && xs.every(Number.isFinite) ? median(xs) : Number.NaN);

/** A deep_show reply that presented its document, else a gap naming its errors. */
function shown(reply: JsonObject, what: string, gaps: Gaps): boolean {
  if (reply['outcome'] === 'presented' && errorsOf(reply).length === 0) return true;
  gaps.add(`refused ${what}`, `${what} is not presented: ${String(reply['outcome'])}, ${show(errorsOf(reply).map((e) => ({ code: e['code'], path: e['path'], ids: e['ids'] })), 600)}`);
  return false;
}
/** A `frames` reply's frames, `count` of them, else a gap and none. */
function framesIn(reply: JsonObject, count: number, what: string, gaps: Gaps): JsonObject[] {
  const list = Array.isArray(reply['frames']) ? reply['frames'].filter(isObject) : [];
  if (list.length === count) return list;
  gaps.add(`frames ${what}`, `${what}: ${count} frames asked, ${list.length} drawn: ${show(reply, 400)}`);
  return [];
}
/** A `view3d` reply's frames, `count` of them, else a gap; INCONCLUSIVE where the platform can't draw. */
function viewFrames(reply: JsonObject, count: number, what: string, gaps: Gaps): JsonObject[] {
  if (reply['code'] === 'unsupported_platform' || reply['code'] === 'gpu_unavailable') inconclusive(`${what}: view3d reports ${String(reply['code'])}`);
  const frames = gaps.objects(reply['frames'], `${what} frames`, `${what}: view3d's frames (${show(reply, 300)})`) ?? [];
  if (frames.length !== count) gaps.add(`${what} count`, `${what}: ${count} frames asked, ${frames.length} drawn`);
  return frames;
}

/** Part 1: a document with no logic columns gains no work per frame. */
function stillWork(gaps: Gaps): void {
  const ev = temp();
  const { still, bare } = stillDocs();
  const r = runShow(binOf(), scenario(ev, [D.still, D.bare], [
    showCall(D.still, still), framesCall(D.still, STILL_FRAMES, { timings: true }), showCall(D.bare, bare), framesCall(D.bare, STILL_FRAMES, { timings: true }),
  ]), 'AC8 the still documents');
  if (shown(r[0]!, 'the still document with no logic columns', gaps) && shown(r[2]!, 'the bare document', gaps)) {
    const [fs, fb] = [framesIn(r[1]!, STILL_FRAMES, 'the still document', gaps), framesIn(r[3]!, STILL_FRAMES, 'the bare document', gaps)];
    fs.slice(1).forEach((f, i) => {
      const at = `the still document's frame ${i + 1}`;
      const [n, m] = [f['ran'], fb[i + 1]?.['ran']];
      if (typeof n !== 'number' || typeof m !== 'number') gaps.add('ran', `${at}: ran is ${show(n)}, the bare one's ${show(m)}`);
      else if (n > m) gaps.add('work', `${at} runs ${n} operators while nothing changes, the bare document's ${m}: work per frame without logic columns`);
      const compares = gaps.objects(f['compares'], 'still compares', `${at}: compares (frames with timings, README: Surfaces)`);
      if (compares?.length) gaps.add('compared', `${at} compares arrays with no logic in the document: ${show(compares, 300)}`);
      const remaps = gaps.objects(f['remaps'], 'still remaps', `${at}: remaps`);
      if (remaps?.length) gaps.add('remapped', `${at} remaps rows with no logic columns: ${show(remaps, 300)}`);
    });
  }

  requireMetal();
  const out = temp();
  const [reply] = runGpu(binOf('gpu'), out, [view3dCall({ doc: writeJson(out, 'quiet', quietScene()), size: [320, 200], frames: STILL_FRAMES, counts: true, timings: true })], 'AC8 the still 3D scene');
  viewFrames(reply!, STILL_FRAMES, 'the still 3D scene', gaps).slice(1).forEach((f) => {
    const at = `the still 3D scene's frame ${String(f['frame'])}`;
    for (const key of ['instances_written', 'meshes_built']) {
      if (typeof f[key] !== 'number') gaps.add(`quiet ${key}`, `${at}: ${key} (counts) is ${show(f[key])}`);
      else if (f[key] !== 0) gaps.add(`quiet ${key} work`, `${at}: ${key} ${String(f[key])} while nothing changes`);
    }
    const uploads = isObject(f['element_uploads']) ? Object.entries(f['element_uploads']).filter(([, ids]) => !Array.isArray(ids) || ids.length > 0) : null;
    if (uploads === null) gaps.add('quiet element_uploads', `${at}: element_uploads (counts) is ${show(f['element_uploads'])}`);
    else if (uploads.length) gaps.add('quiet uploads work', `${at} uploads elements of ${uploads.map(([k]) => k).join(', ')} while nothing changes`);
    if (!isObject(f['upload_ms'])) gaps.add('quiet upload_ms', `${at}: upload_ms (view3d with timings, README: Surfaces) is ${show(f['upload_ms'])}`);
    else {
      const spent = Object.entries(f['upload_ms']).filter(([, ms]) => ms !== 0);
      if (spent.length) gaps.add('quiet upload work', `${at} spends upload time with no logic columns: ${show(Object.fromEntries(spent))}`);
    }
  });
}

/** Parts 2 and 4: one measuring run on `showBin` (deep-show) and `gpuBin` (deep-gpu), each number read from its surface. */
function measure(showBin: string, gpuBin: string, what: string): { reading: Reading; gaps: Gaps } {
  const gaps = new Gaps();
  const ev = temp();
  const [heap, layer, shop] = [heapProgram(), layerProgram(), shopProgram()];
  for (const p of [heap, layer, shop]) putEvidence(ev, p.bytes);
  const atlas = putEvidence(ev, layerAtlas());
  const r = runShow(showBin, scenario(ev, [D.heap, D.layer, D.fit, D.tight], [
    showCall(D.heap, heapDoc(heap, atlas)), framesCall(D.heap, HEAP_FRAMES, { timings: true }),
    showCall(D.layer, layerDoc(layer, atlas)), framesCall(D.layer, LAYER_FRAMES, { timings: true }),
    ...SEEKS.map((k) => framesCall(D.layer, 1, { from: `${k}f`, timings: true })),
    showCall(D.fit, goodsDoc(shop), { timing: true }), showCall(D.tight, goodsDoc(shop, true)),
  ]), `${what}: deep-show`);

  // Comparing 1 MiB after a step: each of heap's frames after the first applies one step, which stored 1,048,576 bytes
  // and changed one element, so its reader remaps one row.
  const compare: number[] = [];
  if (shown(r[0]!, 'heap, storing 1 MiB a step', gaps)) {
    framesIn(r[1]!, HEAP_FRAMES, 'heap', gaps).slice(1).forEach((f, i) => {
      const at = `heap's frame ${i + 1}`;
      const read = gaps.objects(f['remaps'], 'heap remaps', `${at}: remaps`)?.filter((m) => m['set'] === 'reader');
      if (read && (read.length !== 1 || read[0]!['rows'] !== 1)) gaps.add('heap stepped', `${at}: heap's reader remaps the one element the step changed, got ${show(f['remaps'], 300)}`);
      const list = gaps.objects(f['compares'], 'compares', `${at}: compares (frames with timings, README: Surfaces)`)?.filter((c) => c['logic'] === 'heap');
      if (!list) return;
      if (list.length !== 1) { gaps.add('compares one', `${at}: one comparison for the one step it applies, got ${show(f['compares'], 300)}`); return; }
      if (list[0]!['bytes'] !== 4 * HEAP) gaps.add('compares bytes', `${at}: the step's comparison covers ${show(list[0]!['bytes'])} bytes, not the 1,048,576 it stored`);
      compare.push(gaps.num(list[0]!['ms'], 'compares ms', `${at}: compares[].ms`));
    });
  }

  // Remapping the 9,216-row layer: one row a step, every row on its first frame and on each seek back.
  const row: number[] = [];
  const whole: number[] = [];
  const remapOf = (f: JsonObject | undefined, rows: number, at: string, into: number[]): void => {
    const list = gaps.objects(f?.['remaps'], 'remaps', `${at}: remaps`)?.filter((m) => m['set'] === 'layer');
    if (!list) return;
    if (list.length !== 1 || list[0]!['rows'] !== rows) { gaps.add(`remaps ${rows}`, `${at} remaps ${rows} rows of the layer in one entry, got ${show(f?.['remaps'], 300)}`); return; }
    into.push(gaps.num(list[0]!['ms'], 'remaps ms', `${at}: remaps[].ms (frames with timings, README: Surfaces)`));
  };
  if (shown(r[2]!, 'the 9,216-row layer', gaps)) {
    const frames = framesIn(r[3]!, LAYER_FRAMES, 'the layer', gaps);
    if (frames.length) remapOf(frames[0], LAYER_CELLS, 'the layer\'s frame 0, a new reader,', whole);
    frames.slice(1).forEach((f, i) => remapOf(f, 1, `the layer's frame ${i + 1}`, row));
    SEEKS.forEach((k, i) => remapOf(framesIn(r[4 + i]!, 1, `the layer seeked back to frame ${k}`, gaps)[0], LAYER_CELLS, `the layer seeked back to frame ${k}`, whole));
  }

  // The fit check over 5,000 keys in three locales, at check; the too-long twin shows it reads de's last key.
  const fitAt = 4 + SEEKS.length;
  let fit = Number.NaN;
  if (shown(r[fitAt]!, `goods, ${FIT_KEYS} keys in ${FIT_LOCALES.join(', ')}, every one fitting`, gaps)) {
    const timing = r[fitAt]!['timing'];
    fit = gaps.num(isObject(timing) ? timing['copy_fit_ms'] : undefined, 'fit ms', 'goods: deep_show\'s timing.copy_fit_ms (README: Surfaces)');
  }
  const tight = r[fitAt + 1]!;
  const key = String(FIT_KEYS - 1);
  if (!errorsOf(tight).some((e) => names(namedIn(e), key) && names(namedIn(e), 'de'))) {
    gaps.add('fit twin', `goods with de key ${key} too long for its box is not refused at check naming ${key} and de, so the fit check isn't shown to read every key of every locale: ${String(tight['outcome'])}, ${show(errorsOf(tight).map((e) => ({ code: e['code'], path: e['path'] })), 400)}`);
  }

  // The uploads, drawn on the GPU: 1,000 changed slots of 100,000, and a 256 × 256 overlay whose every cell changes.
  requireMetal();
  const out = temp();
  const [crowd, fogger] = [crowdProgram(), foggerProgram()];
  const assets = { ...putAsset(out, crowd.bytes, 'wasm'), ...putAsset(out, fogger.bytes, 'wasm') };
  const { swarm, field } = gpuScenes(crowd, fogger);
  const [s, f] = runGpu(gpuBin, out, [
    view3dCall({ doc: writeJson(out, 'swarm', swarm), size: [640, 400], frames: GPU_FRAMES, counts: true, timings: true, assets }),
    view3dCall({ doc: writeJson(out, 'field', field), size: [512, 512], frames: GPU_FRAMES, counts: true, timings: true, assets }),
  ], `${what}: deep-gpu`);
  const uploadOf = (x: JsonObject, item: string, at: string): number => {
    const ms = gaps.num(isObject(x['upload_ms']) ? x['upload_ms'][item] : undefined, `${item} upload_ms`, `${at}: upload_ms.${item} (view3d with timings, README: Surfaces)`);
    if (ms === 0) gaps.add(`${item} upload zero`, `${at}: upload_ms.${item} is 0 on a frame whose step changed what it uploads`);
    return ms;
  };
  const slots = viewFrames(s!, GPU_FRAMES, 'the swarm', gaps).slice(1).map((x) => {
    const at = `the swarm's frame ${String(x['frame'])}`;
    const ids = isObject(x['element_uploads']) ? x['element_uploads']['swarm'] : undefined;
    if (!Array.isArray(ids) || ids.length !== BLOCK) gaps.add('swarm slots', `${at} uploads the 1,000 slots its step spawned, got ${Array.isArray(ids) ? ids.length : show(ids, 100)}`);
    return uploadOf(x, 'swarm', at);
  });
  const fieldFrames = viewFrames(f!, GPU_FRAMES, 'the field', gaps);
  const overlay = fieldFrames.slice(1).map((x, i) => {
    const at = `the field's frame ${String(x['frame'])}`;
    if (typeof x['pixel_hash'] !== 'string' || x['pixel_hash'] === fieldFrames[i]!['pixel_hash']) gaps.add('field drawn', `${at} draws the same picture as the frame before, though its step flipped every cell of the overlay: ${show(x['pixel_hash'])}`);
    return uploadOf(x, 'field', at);
  });
  return {
    reading: { compare: med(compare), remapRow: 1000 * med(row), remapLayer: med(whole), uploadSlots: med(slots), overlay: med(overlay), fit },
    gaps,
  };
}

/** Part 3: the record the perf lane and the budget window compare with the merge base. */
async function record(gaps: Gaps): Promise<void> {
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
  const entry = (Array.isArray(current['tasks']) ? current['tasks'].filter(isObject) : []).find((t) => t['id'] === TASK.id);
  if (!entry) gaps.add('task', `benchmarks/budgets.json has no task ${TASK.id} for the perf lane and the budget window to compare with the merge base`);
  else {
    const want: [string, JsonValue | undefined, JsonValue][] = [['command', entry['command'], TASK.command], ['targets', entry['targets'], TASK.targets], ['margin', entry['margin'], 0.5]];
    for (const [k, got, w] of want) if (JSON.stringify(got) !== JSON.stringify(w)) gaps.add(`task ${k}`, `${TASK.id}.${k} is ${show(got, 300)}, not ${show(w, 300)}`);
    if (!Array.isArray(entry['criteria']) || !entry['criteria'].includes(ID)) gaps.add('task criteria', `${TASK.id}.criteria doesn't name ${ID}: ${show(entry['criteria'])}`);
    if (!/#538\b/.test(String(entry['initialReason']))) gaps.add('task reason', `${TASK.id}.initialReason doesn't name #538: ${show(entry['initialReason'])}`);
    try { await validateBudgets(current, { tasks: [] }); } catch (e) { gaps.add('task valid', `the lane's validator refuses benchmarks/budgets.json: ${(e as Error).message}`); }
  }
  const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
  if (!lanes.timed.includes(FILE)) gaps.add('timed', `scripts/lanes.mjs doesn't run ${FILE} as a timed file`);
}

describe(`AC8 ${ID} the budgets (blind redraft)`, () => {
  it(`AC8 ${ID} a document with no logic columns gains no work per frame; the timing surfaces over the clauses' fixtures; the record compared with the merge base; and on the reference Mac at rest compare 1 MiB 0.2 ms, remap a row 20 µs and the layer 1 ms, 1,000 slots 0.5 ms, a 256 × 256 overlay 0.1 ms, the fit check over 5,000 keys in three locales 2 s`, async () => {
    const gaps = new Gaps();
    stillWork(gaps);
    const debug = measure(binOf(), binOf('gpu'), 'AC8 the debug build');
    gaps.list.push(...debug.gaps.list);
    await record(gaps);
    console.log(`AC8 ${ID}: the debug build's readings (not budget results): ${JSON.stringify(debug.reading)}`);
    expect(gaps.list, `AC8 ${ID}: no work per frame without logic columns, the timing surfaces and the record:\n  ${gaps.list.join('\n  ')}\n`).toEqual([]);

    // Part 4: the timings, only where the lane can judge them.
    const gate = await judgeLimit(1, Array.from({ length: RUNS }, () => 0), Array.from({ length: RUNS }, () => ({ start: load(), end: load() })));
    if (gate['status'] !== 'PASS') inconclusive(`the budgets are judged only on a reference Mac at rest: ${String(gate['reason'])}`);
    const [showRel, gpuRel] = [binOf('full', true), binOf('gpu', true)];
    const run = (what: string): Reading => {
      const { reading, gaps: g } = measure(showRel, gpuRel, what);
      expect(g.list, `${what}: the release build's surfaces answer:\n  ${g.list.join('\n  ')}\n`).toEqual([]);
      return reading;
    };
    run('AC8 the warm-up');
    const runs: Reading[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < RUNS; k++) { const start = load(); runs.push(run(`AC8 run ${k + 1}`)); loads.push({ start, end: load() }); }
    const open: string[] = [];
    const judge = async (what: string, limit: number, values: number[]): Promise<void> => {
      const v = await judgeLimit(limit, values, loads);
      console.log(`AC8 ${ID} ${what}: ${values.map((x) => x.toFixed(4)).join(', ')} against ${limit} → ${String(v['status'])}`);
      expect(v['status'], `${what} against ${limit}: ${JSON.stringify(v)}`).not.toBe('FAIL');
      if (v['status'] !== 'PASS') open.push(`${what}: ${JSON.stringify(v)}`);
    };
    await judge('comparing 1 MiB of arrays after a step (ms)', TASK.targets.compare_ms, runs.map((x) => x.compare));
    await judge('remapping one changed row of a 9,216-row layer (µs)', TASK.targets.remap_row_us, runs.map((x) => x.remapRow));
    await judge('remapping the whole 9,216-row layer (ms)', TASK.targets.remap_layer_ms, runs.map((x) => x.remapLayer));
    await judge('uploading 1,000 changed slots of a 100,000-slot instancer (ms)', TASK.targets.upload_slots_ms, runs.map((x) => x.uploadSlots));
    await judge('a 256 × 256 overlay upload (ms)', TASK.targets.overlay_upload_ms, runs.map((x) => x.overlay));
    await judge(`the fit check over ${FIT_KEYS} keys in three locales at check (ms)`, TASK.targets.fit_check_ms, runs.map((x) => x.fit));
    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
