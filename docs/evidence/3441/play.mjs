import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPS, FLICKS, MS, RATES, SEEDS, TICKS, seededOffsets } from '../../../tests/acceptance/3441/judges.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const bin = join(process.env.DEEP_BIN_DIR ?? join(here, '../../../target/debug'), 'deep-show');
const LEAD = 2 * MS;
const FIRST_VSYNC = 4 * MS;
const DOC = '01JB3441D00000000000000001';
const sessions = { 'sess-alpha': { thread: 'thread-alpha', name: 'agent alpha', process: { pid: 4100, start: 1000 } } };
const processes = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1000 }];
const board = {
  format: 1, profile: 'board', title: 'Ticks, live', description: 'A board an agent writes before every latch.', size: [600, 350],
  layers: { 'alpha-main': { writer: 'agent:thread-alpha', title: 'agent alpha', order: 'a0' } },
  items: { 'alpha.box': { id: 'alpha.box', kind: 'rect@1', layer: 'alpha-main', name: 'Box alpha.box', order: 'a0', params: { box: [0, 0, 60, 40], paint: { fill: { role: 'muted' } } }, at: { pos: [40, 280, 0] } } },
};
const dot = (vsync, k) => ({
  call: 'deep_show', session: 'sess-alpha', doc: DOC, at: vsync - LEAD - MS,
  patch: { patch: `01JB3441P${String(k).padStart(17, '0')}`, doc: DOC, base: 0, reason: 'add a dot', ops: [{ op: 'create', item: { id: `alpha.d${k}`, kind: 'rect@1', name: `Dot ${k}`, order: `b${String(k).padStart(4, '0')}`, params: { box: [0, 0, 6, 6], paint: { fill: { role: 'ink' } } }, at: { pos: [10 + 8 * (k % 70), 20 + 8 * Math.floor(k / 70), 0] } } }] },
});

function run(hz, planted, calls) {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-3441-evidence-'));
  try {
    const ordered = calls.map((call, index) => ({ call, index })).sort((a, b) => a.call.at - b.call.at || a.index - b.index).map(({ call }) => call);
    const scenario = {
      evidence, sessions, processes, clock: { lead: LEAD, check: MS / 2 }, window: [1200, 700], panels: { x: { rect: [0, 0, 600, 350] } }, docs: { [DOC]: { panel: 'x', document: board } },
      displays: [{ uuid: `3441D${String(hz).padStart(3, '0')}-0000-4000-8000-000000000${String(hz).padStart(3, '0')}`, bounds: [0, 0, 1920, 1080], scale: 1, refresh_hz: hz, next_vsync: FIRST_VSYNC, color_space: 'srgb' }],
      ...(planted ? { planted } : {}), calls: ordered,
    };
    const ran = spawnSync(bin, ['run'], { input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
    const answer = JSON.parse(ran.stdout);
    if (!answer.ok) throw Error(`deep-show run answered ${ran.stdout.slice(0, 200)}`);
    return calls.map((call) => answer.replies[ordered.indexOf(call)]);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}

function play(hz, cap, seed, planted, withModel) {
  const window = run(hz, planted, [{ call: 'windows', at: 1 }])[0].windows.find(({ kind }) => kind === 'main').window;
  const vsyncs = Array.from({ length: TICKS }, (_, k) => FIRST_VSYNC + k * (FLICKS / hz));
  const offsets = seed === null ? vsyncs.map(() => 0) : seededOffsets(seed, TICKS);
  const reports = cap === 'thermal' ? [{ call: 'thermal', at: 2, state: 'serious' }] : cap === 'inactive' ? [{ call: 'activate', at: 1, window }, { call: 'activate', at: 2, window: null }] : [];
  const ticks = vsyncs.map((vsync, k) => ({ call: 'tick', window, at: vsync - LEAD + offsets[k] }));
  const model = withModel ? [...vsyncs.slice(1).map((vsync, k) => dot(vsync, k + 1)), { call: 'presented', at: vsyncs.at(-1) + 10 * MS, panel: 'x' }] : [];
  const replies = run(hz, planted, [...reports, ...ticks, ...model]);
  const presented = replies.slice(reports.length, reports.length + TICKS).map((reply) => reply.presented);
  const shown = presented.flatMap((yes, tick) => (yes ? [tick] : []));
  const gaps = shown.slice(1).map((tick, i) => ticks[tick].at - ticks[shown[i]].at);
  return { frames: shown.length, longestGapMs: Number((Math.max(...gaps) / MS).toFixed(3)), window: shown, model: withModel ? replies.at(-1).frames.map(({ vsync }) => vsyncs.indexOf(vsync)).filter((tick) => tick >= 0) : null };
}

const RULES = { after: undefined, mergeBase: 'window_cap_time_threshold' };
const counts = [];
for (const cap of CAPS) for (const hz of RATES) {
  const row = { cap, hz };
  for (const [rule, planted] of Object.entries(RULES)) {
    const exact = play(hz, cap, null, planted, false);
    const seeded = SEEDS.map((seed) => play(hz, cap, seed, planted, false));
    row[rule] = { exact: exact.frames, exactLongestGapMs: exact.longestGapMs, jittered: seeded.map(({ frames }) => frames), jitteredLongestGapMs: Math.max(...seeded.map(({ longestGapMs }) => longestGapMs)) };
  }
  counts.push(row);
}
const sideBySide = [];
for (const cap of CAPS) for (const hz of RATES) {
  const { model, window } = play(hz, cap, null, undefined, true);
  sideBySide.push({ cap, hz, same: JSON.stringify(model) === JSON.stringify(window), opened: model.length, presented: window.length, firstModelTicks: model.slice(0, 6), firstWindowTicks: window.slice(0, 6) });
}
const plantedModel = RATES.map((hz) => {
  const { model, window } = play(hz, 'thermal', null, 'model_cap_time_threshold', true);
  return { cap: 'thermal', hz, planted: 'model_cap_time_threshold', firstModelTicks: model.slice(0, 6), firstWindowTicks: window.slice(0, 6) };
});
writeFileSync(join(here, 'counts.json'), `${JSON.stringify({ ticks: TICKS, seeds: SEEDS, jitterMicrosEitherWay: 200, counts, sideBySide, plantedModel }, null, 2)}\n`);
