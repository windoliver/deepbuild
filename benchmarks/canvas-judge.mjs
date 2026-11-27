// What `node benchmarks/canvas.mjs judge` holds a report to (issues #379, #854, #896, #1551 and #2870): each budget
// class's frame limits, where each efficiency task's targets are read from its runs, which targets are counts and which
// floors, and what a failed target names; with the runs and boards those tasks measure.
import { judgeLimit } from '../scripts/benchmark.mjs';

export const CLASS_LIMITS = {
  core_view: { gpu_ms: 1, cpu_ms: 2 },
  data_view: { gpu_ms: 2, cpu_ms: 2 },
  figure: { gpu_ms: 2, cpu_ms: 4 },
  work_product: { gpu_ms: 2, cpu_ms: 4 },
  showpiece: { gpu_ms: 10, cpu_ms: 4 },
  export: { gpu_ms: null, cpu_ms: null },
};
export const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(0.95 * xs.length) - 1)];
export const RUNS = 5;
/** Each run's load at its start and end, as `judge` gives them to judgeLimit (#2870). */
export const loadsOf = (measured) => measured.map((r) => ({ start: r.loadStart, end: r.loadEnd }));
export const BOARD_ITEMS = 10_000;
export const DIRTY_BOARDS = [1_000, BOARD_ITEMS];

// #896's two boards of a run, the 1,000-item one first; `null` for a run with any other boards.
const pair = (r) => {
  const [small, large] = r.boards ?? [];
  return r.boards?.length === 2 && small?.items === DIRTY_BOARDS[0] && large?.items === DIRTY_BOARDS[1] ? [small, large] : null;
};
export const p50 = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.5 * xs.length) - 1)];
/** The CPU per patch at the last board against the first: the difference of their p50s, over the first's. */
const cpuGrowth = (r) => {
  const [a, b] = [r.boards?.[0], r.boards?.at(-1)].map((board) => p50(board?.samples.map((s) => s.cpu_ms) ?? [0]));
  return a > 0 ? Math.abs(b - a) / a : 0;
};
/** The most bytes the view uploaded for one patch of a run, each patch changing one item. */
const uploadPerItem = (r) => Math.max(0, ...(r.boards ?? []).flatMap((b) => b.samples.map((s) => s.uploaded_bytes)).filter(Number.isInteger));
/** Why a target can't be judged on a run, if it can't. */
export const unjudged = {
  cpu_growth: (r) => (pair(r) ? null : `a run patches ${JSON.stringify((r.boards ?? []).map((b) => b.items))} items, not ${DIRTY_BOARDS.join(' then ')}`),
  upload_bytes_per_item: (r) => ((r.boards ?? []).every((b) => b.samples.every((s) => Number.isInteger(s.uploaded_bytes)))
    ? null : 'a patch doesn\'t report the bytes it uploaded'),
};

// Each task's targets: where `judge` reads each from a run, and whether it is a count, judged on any machine.
export const EFFICIENCY = {
  'canvas-patch-settled': { settled_p95_ms: (r) => r.p95_ms },
  'canvas-patch-dirty': { cpu_growth: cpuGrowth, upload_bytes_per_item: uploadPerItem },
  'canvas-scene-read': { summary_ms: (r) => r.summary.ms, summary_tokens: (r) => r.summary.tokens, page_ms: (r) => r.page.ms, page_rows: (r) => r.page.rows },
  'canvas-idle': { frames: (r) => r.frames, wakeups: (r) => r.wakeups, cpu_fraction: (r) => r.cpu_fraction },
  'canvas-look-frames': {
    frame_gpu_p95_ms: (r) => Math.max(...Object.values(r.looks).map((look) => p95(look.frames.map((f) => f.gpu_ms)))),
    frame_cpu_p95_ms: (r) => Math.max(...Object.values(r.looks).map((look) => p95(look.frames.map((f) => f.cpu_ms)))),
  },
  'replica-cold-start': { first_settled_ms: (r) => r.ms },
  'canvas-flares-mirrors': { finish_gpu_ms: (r) => r.finish_gpu_ms, flare_gpu_ms: (r) => r.flare_gpu_ms, mirror_share: (r) => r.mirror_share, indexed_target_bytes: (r) => r.indexed_target_bytes },
  'canvas-water': { lake_gpu_ms: (r) => r.lake_gpu_ms, waves_vertex_ms: (r) => r.waves_vertex_ms },
  'canvas-lens-focus': { dof_gpu_ms: (r) => r.dof_gpu_ms },
  'canvas-figure-budgets': Object.fromEntries(['redraw_wall_ms', 'parts_wall_ms', 'inset_lit_gpu_ms', 'inset_unlit_gpu_ms'].map((k) => [k, (r) => r[k]])),
  'canvas-occlusion': { gpu_fall: (r) => r.gpu_fall, pyramid_declared_error: (r) => r.pyramid_declared_error },
  'canvas-many-lamps': Object.fromEntries(['frame_gpu_p95_ms', 'cluster_pass_gpu_p95_ms', 'scoring_cpu_p95_ms', 'light_lists_bytes', 'estimate_off'].map((k) => [k, (r) => r[k]])),
  'canvas-water-shore': { shore_lake_gpu_ms: (r) => r.shore_lake_gpu_ms },
  'canvas-water-flow': { flow_sheet_gpu_ms: (r) => r.flow_sheet_gpu_ms },
  'canvas-water-rings': { rings_pond_gpu_ms: (r) => r.rings_pond_gpu_ms },
  'canvas-water-sea': { sea_gpu_ms: (r) => r.sea_gpu_ms },
  'canvas-atlas-draw': { draw_rows_frame_ms: (r) => r.draw_rows_frame_ms },
  'canvas-atlas-slice': { slice_rows_frame_ms: (r) => r.slice_rows_frame_ms },
  'canvas-fx-pack': Object.fromEntries(['pack_check_ms', 'operator_compile_ms', 'still_dispatches'].map((k) => [k, (r) => r[k]])),
  'canvas-pack-checks': { first_reply_ms: (r) => r.first_reply_ms },
  'canvas-local-tone-map': { local_1080p_gpu_ms: (r) => r.local_1080p_gpu_ms, local_2160p_gpu_ms: (r) => r.local_2160p_gpu_ms },
  'canvas-ground': {
    bevel_ms: (r) => r.bevel_ms, subdivide_ms: (r) => r.subdivide_ms, distribute_ms: (r) => r.distribute_ms, arc_length_ms: (r) => r.arc_length_ms,
    still_steps: (r) => r.still_steps, sway_gpu_ms: (r) => r.sway_gpu_ms,
  },
  'canvas-tree': { tree_build_ms: (r) => r.tree_build_ms, forest_draws_per_variant_material: (r) => r.forest_draws_per_variant_material },
  'canvas-fog-linear': { linear_over_exp: (r) => r.linear_over_exp },
  // #538: each reading by its own name (benchmarks/game-state.mjs).
  'canvas-axes3d': { axes_over_marks: (r) => r.axes_over_marks, still_maps: (r) => r.still_maps },
  'canvas-surface': { rebuild_128_ms: (r) => r.rebuild_128_ms },
  'canvas-math': { math_over_hand: (r) => r.math_over_hand, frame_expansions: (r) => r.frame_expansions },
  'canvas-game-state': Object.fromEntries(['compare_ms', 'remap_row_us', 'remap_layer_ms', 'upload_slots_ms', 'overlay_upload_ms', 'fit_check_ms', 'idle_steps'].map((k) => [k, (r) => r[k]])),
  // #548: each reading by its own name (benchmarks/logic-budgets.mjs).
  'canvas-logic-budgets': Object.fromEntries(['occurrences_64_ms', 'linear_1000_vec3_ms', 'preview_4mib_ms', 'checkpoint_3_pages_ms'].map((k) => [k, (r) => r[k]])),
  'logic-world-pages': Object.fromEntries(['moves_8_ms', 'checkpoint_50_ms', 'checkpoint_50_bytes', 'idle_work'].map((k) => [k, (r) => r[k]])),
  // #1968: each reading by its own name (benchmarks/code-film.mjs).
  'canvas-code-film': Object.fromEntries(['tokens_2000_lines_ms', 'diff_400_lines_ms', 'seek_10_min_ms', 'still_code_steps'].map((k) => [k, (r) => r[k]])),
  // #1430: each reading by its own name (benchmarks/text-reflow.mjs).
  'canvas-text-reflow': Object.fromEntries(['width_change_50kb_ms', 'typed_char_50kb_ms'].map((k) => [k, (r) => r[k]])),
  // #184: each reading by its own name (benchmarks/playtest.mjs).
  'playtest-maze': { maze_40_runs_s: (r) => r.maze_40_runs_s, idle_work: (r) => r.idle_work },
  'playtest-throughput': { fixture_realtime_x: (r) => r.fixture_realtime_x },
  // #556: each reading by its own name (benchmarks/playtest.mjs).
  'playtest-crawler': Object.fromEntries(['crawler_80_runs_s', 'legal_added_s', 'reach_200_floors_s', 'idle_work'].map((k) => [k, (r) => r[k]])),
  'catalog-budgets': Object.fromEntries(['pack_10000_rows_ms', 'reach_5000_recipes_ms', 'economy_5000_recipes_ms', 'idle_work'].map((k) => [k, (r) => r[k]])), // #194 (benchmarks/catalog.mjs)
};
export const COUNTS = new Set(['summary_tokens', 'page_rows', 'frames', 'upload_bytes_per_item', 'indexed_target_bytes', 'still_steps', 'idle_steps', 'still_maps', 'still_code_steps', 'idle_work', 'frame_expansions', 'forest_draws_per_variant_material', 'light_lists_bytes', 'checkpoint_50_bytes']);
/** Targets that are floors, each reading at or above its limit (#184's multiple of real time). */
export const FLOORS = new Set(['fixture_realtime_x']);
/**
 * A floor's verdict (#2870). judgeLimit judges a ceiling on readings of zero or more, so a floor is that limit on its
 * readings mirrored about it, 2 × limit − reading (0 past twice the floor): five at or above the floor pass, five under it
 * by more than the margin fail, the same fraction of the limit, and the verdict keeps the readings themselves.
 */
export function judgeFloor({ limit, runs, fingerprint, loads }) {
  const mirrored = runs.map((v) => (Number.isFinite(v) && v >= 0 ? Math.max(0, 2 * limit - v) : NaN));
  const verdict = { ...judgeLimit({ limit, runs: mirrored, fingerprint, loads }), limit, runs };
  const under = (what) => `${what} under ${limit} by more than the ${(verdict.margin * 100).toFixed(1)}% margin`;
  if (verdict.status === 'BLOCKED') verdict.reason = `a floor is judged on five readings taken after warm-up, got ${JSON.stringify(runs)}`;
  else if (verdict.status === 'FAIL') verdict.reason = under('all five runs are');
  else if (verdict.reason?.startsWith('the five runs')) verdict.reason = under(`the five runs are neither all at or above ${limit} nor all`);
  return verdict;
}

/** The stage that took the most of a sample's time, as a reason names it (#896); none for a sample without stages. */
const costliest = (s) => {
  const [name, ms] = Object.entries(s.stages ?? {}).reduce((a, e) => (e[1] > a[1] ? e : a), ['', -1]);
  return name ? `, most of it stage ${name} ${ms.toFixed(3)} ms` : '';
};
const grouped = (n) => n.toLocaleString('en-US');

/** What a failed target names, run by run: the frame and the nodes it ran, a reply's size, the frames drawn, the pipelines. */
export const named = {
  settled_p95_ms: (runs) => runs.map((r, i) => {
    const worst = r.samples.reduce((a, s) => (s.ms > a.ms ? s : a));
    const ran = Object.entries(worst.ran).map(([op, n]) => `${op} ${n}`).join(', ');
    return `run ${i + 1}: patch ${worst.patch} settled in frame ${worst.frame} after ${worst.ms.toFixed(3)} ms${costliest(worst)}, a frame that ran ${ran}`;
  }),
  // The operator that built the most marks for one patch on the larger board.
  cpu_growth: (runs) => runs.map((r, i) => {
    const large = pair(r)?.[1].samples ?? [];
    const [op, n] = large.flatMap((s) => Object.entries(s.marks ?? {})).reduce((a, e) => (e[1] > a[1] ? e : a), ['no operator', 0]);
    return `run ${i + 1}: ${op} built ${grouped(n)} marks for one patch at ${grouped(DIRTY_BOARDS[1])} items`;
  }),
  upload_bytes_per_item: (runs, limit) => runs.map((r, i) => {
    const worst = r.boards.flatMap((b) => b.samples).reduce((a, s) => (s.uploaded_bytes > a.uploaded_bytes ? s : a));
    return worst.uploaded_bytes > limit ? `run ${i + 1}: patch ${worst.patch} uploaded ${grouped(worst.uploaded_bytes)} B` : null;
  }).filter(Boolean),
  summary_tokens: (runs, limit) => runs.filter((r) => r.summary.tokens > limit).map((r) => `summary: ${r.summary.tokens} tokens, ${r.summary.bytes} bytes, ${r.summary.rows} rows`),
  page_rows: (runs, limit) => runs.filter((r) => r.page.rows > limit).map((r) => `page: ${r.page.rows} rows, ${r.page.tokens} tokens, ${r.page.bytes} bytes${r.page.next === null ? ', unpaged' : ''}`),
  frames: (runs, limit) => runs.map((r, i) => [r, i]).filter(([r]) => r.frames > limit)
    .map(([r, i]) => `run ${i + 1} drew ${r.frames} frames while still: ${r.drawn.slice(0, 5).map((d) => `frame ${d.frame} at ${Math.round(d.at_ms)} ms`).join(', ')}${r.frames > 5 ? ', …' : ''}`),
  first_settled_ms: (runs) => {
    const first = [...new Set(runs.flatMap((r) => r.pipelines.filter((p) => p.on_first_frame).map((p) => p.name)))];
    return [first.length ? `pipelines compiled on the first frame: ${first.join(', ')}` : 'no pipeline compiled on the first frame'];
  },
};

/** The window each canvas-idle run held (#1551): PASS only when all five runs say it was shown throughout. */
export function shownWindow(runs) {
  const states = runs.map((r) => r.window?.state ?? 'headless');
  const off = states.map((state, i) => `run ${i + 1}: ${state}`).filter((_, i) => states[i] !== 'shown');
  if (states.length !== RUNS) off.push(`${states.length} runs, not ${RUNS}`);
  return off.length ? { status: 'INCONCLUSIVE', runs: states, reason: off.join(', ') } : { status: 'PASS', runs: states };
}

/** The idle task's energy, a reading beside CPU and never a target (#1492): the counter's nanojoules a run, or BLOCKED naming it when a run reads zero. */
export function energyReading(runs) {
  const counter = runs.find((r) => r.energy?.counter)?.energy.counter ?? 'ri_energy_nj';
  const nj = runs.map((r) => r.energy?.nj);
  if (nj.length === 0 || nj.some((v) => !(Number.isFinite(v) && v > 0))) {
    return { status: 'BLOCKED', counter, reason: `the counter ${counter} read ${JSON.stringify(nj)} nJ over the runs; a reading of zero is not energy` };
  }
  return { status: 'READING', counter, runs: nj };
}
