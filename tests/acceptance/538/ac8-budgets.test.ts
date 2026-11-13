// AC8 #538.ed6f8052: Budgets, on the reference Mac in the local preflight, compared with the merge base: comparing 1 MiB
// of arrays after a step takes under 0.2 ms; remapping one changed row of a 9,216-row layer under 20 µs and the whole
// layer under 1 ms; uploading 1,000 changed slots of a 100,000-slot instancer under 0.5 ms; a 256 × 256 overlay upload
// under 0.1 ms; the fit check over a 5,000-key table in three locales under 2 s at check; and a document with no logic
// columns gains no work per frame
//
// A timed file (README: Run them; The budgets). In order:
//   1. No work per frame, by counters, not time: `frames` of a still document with no logic columns (a text, 30 labels
//      from data columns, a group of two rects) against the bare one (a rect alone) in the same process: no frame after
//      the first runs more operators (`ran`) than the bare one's same frame.
//   2. The timing surfaces answer on the debug build, over the fixtures the clauses name: `frames` with `timings` gives
//      each logic step's comparison of the 1,048,576 bytes `heap` writes (`compares`), and each remap's time (`remaps[].ms`)
//      of the 9,216-row `layer`, one row a step and every row on a new reader or a seek; `view3d` with `timings` gives
//      each frame's upload time (`upload_ms`) of `swarm`'s 1,000 changed slots of 100,000 and of `field`'s 256 × 256
//      overlay; `deep_show` with `timing` gives the fit check's time over `goods`, 5,000 keys in en, fr and de.
//   3. The record the perf lane and the budget window read, "compared with the merge base": benchmarks/budgets.json holds
//      the task `canvas-game-state` with the issue's numbers, this criterion's ID and a reason naming #538, and is valid
//      by the lane's validator; scripts/lanes.mjs times this file.
//   4. Only where the lane can judge a timing (a reference Mac at rest, else INCONCLUSIVE before anything is timed):
//      release builds, one warm-up run and five, each number judged by scripts/benchmark.mjs's judgeLimit; a FAIL fails,
//      anything but PASS is INCONCLUSIVE.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLOCK, CROWD_WRITES, FIELD, FOG_WRITES, HEAP, LAYER_CELLS, crowdProgram, foggerProgram, heapProgram, layerProgram, shopProgram,
} from './programs.ts';
import { FIT_KEYS, FIT_LOCALES, fitDoc, heapDoc, layerAtlas, layerDoc, stillDoc } from './fixtures.ts';
import {
  AC, DOC, REPO, TIMEOUT, arr, binOf, framesCall, framesOf, inconclusive, isObject, judgeLimit, load, median, none, num, obj, prebuild, presented,
  putEvidence, runShow, scenario, show, showCall, useTemp, validateBudgets, type JsonObject,
} from './helpers.ts';
import {
  DARK_SKY, column, countsEntry, framesOf as gpuFramesOf, logicItem as logic3d, material, putAsset, requireMetal, runGpu, sessionDoc, sun, topDown,
  view3dCall, writeJson,
} from '../537/helpers.ts';

prebuild(['full', 'gpu']);
const temp = useTemp();
const ID = '#538.ed6f8052';
const FILE = 'tests/acceptance/538/ac8-budgets.test.ts';
/** The task the perf lane and the budget window run (README: The budgets). */
const TASK = {
  id: 'canvas-game-state', command: ['node', 'benchmarks/canvas.mjs', 'game-state'],
  targets: { compare_ms: 0.2, remap_row_us: 20, remap_layer_ms: 1, upload_slots_ms: 0.5, overlay_upload_ms: 0.1, fit_check_ms: 2000, idle_steps: 0 },
};
const RUNS = 5;
const STILL_FRAMES = 6;
const HEAP_FRAMES = 20;
const LAYER_FRAMES = 40;
/** Seeks back, each earlier than the frame before: every row remaps. */
const SEEKS = [30, 25, 20, 15, 10];
const GPU_FRAMES = 30;
const SHORT: JsonObject = { span: '0.5s', frame_rate: [60, 1] };

const D = { still: DOC(1), bare: DOC(2), heap: DOC(3), layer: DOC(4), fit: DOC(5) };
interface Reading { compare: number; remapRow: number; remapLayer: number; uploadSlots: number; overlay: number; fit: number }

/** One measuring run on `show` (deep-show) and `gpu` (deep-gpu), each number read from the surfaces README names. */
function measure(show_: string, gpu: string, what: string): Reading {
  const ev = temp();
  const [heap, layer, shop] = [heapProgram(), layerProgram(), shopProgram()];
  for (const p of [heap, layer, shop]) putEvidence(ev, p.bytes);
  const atlas = putEvidence(ev, layerAtlas());
  const calls: JsonObject[] = [
    showCall(D.heap, heapDoc(heap)), framesCall(D.heap, HEAP_FRAMES, { timings: true }),
    showCall(D.layer, layerDoc(layer, atlas)), framesCall(D.layer, LAYER_FRAMES, { timings: true }),
    ...SEEKS.map((k) => framesCall(D.layer, 1, { from: `${k}f`, timings: true })),
    showCall(D.fit, fitDoc(shop), { timing: true }),
  ];
  const r = runShow(show_, scenario(ev, [D.heap, D.layer, D.fit], calls), `${what}: deep-show`);
  presented(r[0]!, 'heap, writing 1 MiB a step');
  presented(r[2]!, 'the 9,216-row layer');
  presented(r[4 + SEEKS.length]!, `goods, ${FIT_KEYS} keys in ${FIT_LOCALES.join(', ')}`);

  const compares = framesOf(r[1]!, HEAP_FRAMES, 'heap').slice(1).flatMap((f, k) => {
    const list = arr(f['compares'], `heap frame ${k + 1}: compares (README: The budgets)`).filter((c) => isObject(c) && c['logic'] === 'heap') as JsonObject[];
    expect(list.length, `heap frame ${k + 1} compares the arrays of the one step it applies: ${show(f['compares'])}`).toBe(1);
    expect(list[0]!['bytes'], `heap frame ${k + 1}: the step compares the 1 MiB it wrote`).toBe(4 * HEAP);
    return [num(list[0]!['ms'], `heap frame ${k + 1}: compares[].ms`)];
  });
  const remapsOf = (f: JsonObject, at: string): JsonObject[] => arr(f['remaps'], `${at}: remaps`).filter((m) => isObject(m) && m['set'] === 'layer') as JsonObject[];
  const timed = (m: JsonObject, at: string): number => num(m['ms'], `${at}: remaps[].ms (README: The budgets)`);
  const layerFrames = framesOf(r[3]!, LAYER_FRAMES, 'the layer');
  const full: number[] = [];
  const first = remapsOf(layerFrames[0]!, 'the layer\'s frame 0');
  expect(first.map((m) => m['rows']), 'the layer\'s first frame, a new reader, remaps every row').toEqual([LAYER_CELLS]);
  full.push(timed(first[0]!, 'the layer\'s frame 0'));
  const one = layerFrames.slice(1).map((f, k) => {
    const list = remapsOf(f, `the layer's frame ${k + 1}`);
    expect(list.map((m) => m['rows']), `the layer's frame ${k + 1} remaps the one row its step changed`).toEqual([1]);
    return timed(list[0]!, `the layer's frame ${k + 1}`);
  });
  SEEKS.forEach((k, i) => {
    const list = remapsOf(framesOf(r[4 + i]!, 1, `the layer seeked to frame ${k}`)[0]!, `the layer seeked to frame ${k}`);
    expect(list.map((m) => m['rows']), `the layer seeked back to frame ${k} remaps every row`).toEqual([LAYER_CELLS]);
    full.push(timed(list[0]!, `the layer seeked to frame ${k}`));
  });
  const fit = num(obj(r[4 + SEEKS.length]!['timing'], 'goods: deep_show\'s timing')['copy_fit_ms'], 'goods: timing.copy_fit_ms (README: The budgets)');

  requireMetal();
  const out = temp();
  const [crowd, fogger] = [crowdProgram(), foggerProgram()];
  const assets = { ...putAsset(out, crowd.bytes, 'wasm'), ...putAsset(out, fogger.bytes, 'wasm') };
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
  const [s, f] = runGpu(gpu, out, [
    view3dCall({ doc: writeJson(out, 'swarm', swarm), size: [640, 400], frames: GPU_FRAMES, counts: true, timings: true, assets }),
    view3dCall({ doc: writeJson(out, 'field', field), size: [512, 512], frames: GPU_FRAMES, counts: true, timings: true, assets }),
  ], `${what}: deep-gpu`);
  const uploadOf = (frame: JsonObject, item: string, at: string): number => num(obj(frame['upload_ms'], `${at}: upload_ms (README: The budgets)`)[item], `${at}: upload_ms.${item}`);
  const slots = gpuFramesOf(s!, 'the swarm').filter((x) => x.frame >= 1).map((x) => {
    const at = `the swarm's frame ${x.frame}`;
    expect(arr(countsEntry(x, 'element_uploads', 'swarm', at) ?? null, `${at}: element_uploads.swarm`).length, `${at} uploads the 1,000 slots its step moved`).toBe(BLOCK);
    return uploadOf(x.raw, 'swarm', at);
  });
  const overlay = gpuFramesOf(f!, 'the field').filter((x) => x.frame >= 1).map((x) => uploadOf(x.raw, 'field', `the field's frame ${x.frame}`));
  expect([slots.length, overlay.length], 'each scene draws its frames').toEqual([GPU_FRAMES - 1, GPU_FRAMES - 1]);
  return {
    compare: median(compares.slice(4)), remapRow: 1000 * median(one.slice(4)), remapLayer: median(full), uploadSlots: median(slots.slice(4)),
    overlay: median(overlay.slice(4)), fit,
  };
}

describe(`AC8 ${ID} the budgets`, () => {
  it(`AC8 ${ID} no work per frame without logic columns, by counters; the timing surfaces; the record against the merge base; and on the reference Mac at rest compare 0.2 ms, remap a row 20 µs and the layer 1 ms, 1,000 slots 0.5 ms, a 256 × 256 overlay 0.1 ms, the fit check 2 s`, async () => {
    // 1. No work per frame without logic columns.
    const ev = temp();
    const replies = runShow(binOf(), scenario(ev, [D.still, D.bare], [
      showCall(D.still, stillDoc(false)), framesCall(D.still, STILL_FRAMES), showCall(D.bare, stillDoc(true)), framesCall(D.bare, STILL_FRAMES),
    ]), 'AC8 the still document');
    presented(replies[0]!, 'the still document with no logic columns');
    presented(replies[2]!, 'the bare document');
    const ran = (reply: JsonObject, what: string): number[] => framesOf(reply, STILL_FRAMES, what).map((f, k) => num(f['ran'], `${what}: frame ${k}: ran`));
    const [still, bare] = [ran(replies[1]!, 'the still document'), ran(replies[3]!, 'the bare document')];
    none(still.slice(1).map((n, k) => [k + 1, n, bare[k + 1]!] as const).filter(([, n, b]) => n > b)
      .map(([k, n, b]) => `frame ${k} of the document with no logic columns runs ${n} operators while nothing changes; the bare document's ${b}`), 'no work per frame without logic columns');

    // 2. The timing surfaces answer, on the debug build, over the fixtures the clauses name.
    const debug = measure(binOf(), binOf('gpu'), 'AC8 the debug build');
    console.log(`${AC[8]}: the debug build's readings (not budget results): ${JSON.stringify(debug)}`);

    // 3. The record.
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
    const entry = arr(current['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === TASK.id);
    expect(entry, `benchmarks/budgets.json has the task ${TASK.id}`).toBeDefined();
    expect(entry!['command'], `${TASK.id} runs its mode of the canvas bench`).toEqual(TASK.command);
    expect(entry!['targets'], `${TASK.id} holds the issue's numbers`).toEqual(TASK.targets);
    expect(entry!['margin'], `${TASK.id} compares with the merge base at the lane's margin`).toBe(0.5);
    expect(entry!['criteria'], `${TASK.id} names this criterion, so the budget window measures it`).toContain(ID);
    expect(String(entry!['initialReason']), `${TASK.id} says why, naming #538`).toMatch(/#538\b/);
    await expect(validateBudgets(current, { tasks: [] }), 'the lane\'s validator accepts budgets.json').resolves.toBeUndefined();
    const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
    expect(lanes.timed, `scripts/lanes.mjs runs ${FILE} as a timed file`).toContain(FILE);

    // 4. The timings, only where the lane can judge them.
    const gate = await judgeLimit(1, Array.from({ length: RUNS }, () => 0), Array.from({ length: RUNS }, () => ({ start: load(), end: load() })));
    if (gate['status'] !== 'PASS') inconclusive(`the budgets are judged only on a reference Mac at rest: ${String(gate['reason'])}`);
    const [show_, gpu] = [binOf('full', true), binOf('gpu', true)];
    measure(show_, gpu, 'AC8 the warm-up');
    const runs: Reading[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < RUNS; k++) { const start = load(); runs.push(measure(show_, gpu, `AC8 run ${k + 1}`)); loads.push({ start, end: load() }); }
    const open: string[] = [];
    const judge = async (what: string, limit: number, values: number[]): Promise<void> => {
      const v = await judgeLimit(limit, values, loads);
      console.log(`${AC[8]} ${what}: ${values.map((x) => x.toFixed(4)).join(', ')} against ${limit} → ${String(v['status'])}`);
      expect(v['status'], `${what} against ${limit}: ${JSON.stringify(v)}`).not.toBe('FAIL');
      if (v['status'] !== 'PASS') open.push(`${what}: ${JSON.stringify(v)}`);
    };
    await judge('comparing 1 MiB of arrays after a step (ms)', TASK.targets.compare_ms, runs.map((x) => x.compare));
    await judge('remapping one changed row of a 9,216-row layer (µs)', TASK.targets.remap_row_us, runs.map((x) => x.remapRow));
    await judge('remapping the whole layer (ms)', TASK.targets.remap_layer_ms, runs.map((x) => x.remapLayer));
    await judge('uploading 1,000 changed slots of a 100,000-slot instancer (ms)', TASK.targets.upload_slots_ms, runs.map((x) => x.uploadSlots));
    await judge('a 256 × 256 overlay upload (ms)', TASK.targets.overlay_upload_ms, runs.map((x) => x.overlay));
    await judge(`the fit check over ${FIT_KEYS} keys in three locales at check (ms)`, TASK.targets.fit_check_ms, runs.map((x) => x.fit));
    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
