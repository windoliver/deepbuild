// A synthetic well-formed spike for #1433, in the formats README.md gives: the record, its copy of the gates and
// every raw reading, as a right spike on the reference Air would keep them. It is the worked example of each format
// and the well-formed input validate.test.mjs alters into each planted wrong record. Nothing here is a reading of
// anything: every number is made up, and chosen so the reading a record names can be written down by hand.
// What it takes from this checkout is read at BASE, the commit the suite was written on.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { carriedAt, fileAt, GATES, GATES_SHA256, ISSUE, lockedAt, lookAt, sha256, SPIKE } from './validate.mjs';

export const BASE = 'a1ef97760cbcc9935b8fdadd4a7bef586969ef4d';
export const AIR = { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 17179869184, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '24G90' };
const HARNESS = { candidate: sha256('the candidate arm\'s harness binary'), 'gpui-fast': sha256('the gpui-fast arm\'s harness binary') };
const SWITCH = GATES.gates['retention-frames'].off_switch;
const T0 = Date.parse('2026-11-26T09:00:00.000Z');

/** n runs, each with when it started, the one-minute load at its start and end, and the window AppKit showed. */
const runs = (n, each = () => ({}), at = (i) => i * 120) => Array.from({ length: n }, (_, i) => ({
  started: new Date(T0 + at(i) * 1000).toISOString(), load: { start: 1.5, end: 1.75 }, window: { state: 'shown' }, ...each(i),
}));
/** What every raw reading says of itself, then the gate's own fields. */
const raw = (arm, gate, body) => ({
  spike: ISSUE, arm, gate, gates: GATES_SHA256, harness: HARNESS[arm], profile: 'release',
  command: `scripts/lease ./harness --arm ${arm} --gate ${gate}`, machine: { ...AIR }, surface: 'window', ...body,
});

// 200 updates whose 99th percentile by nearest rank is 2 ms while the slowest took 3.
const UPDATES = [...Array(100).fill(1.5), ...Array(99).fill(2), 3];
const MEANS = [0.75, 0.8125, 0.875, 0.78125, 0.84375];
const WAKEUPS = [0, 1, 0, 0, 1];
const TRANSCRIPT = sha256('the recorded transcript both arms stream');
const FRAME = sha256('the handoff fixture\'s frame, 1936 x 1584 BGRA premultiplied');
const WINDOW = { size: [1512, 982], scale: 2 };
const TREE = {
  role: 'window', name: null, value: null, bounds: [0, 0, 3024, 1964], children: [
    { role: 'group', name: 'Sessions', value: null, bounds: [0, 0, 518, 1964], children: [{ role: 'label', name: 'Needs you', value: '40', bounds: [16, 32, 486, 64], children: [] }] },
    { role: 'text_input', name: 'Message', value: '', bounds: [534, 1820, 2474, 128], children: [] },
  ],
};
const JOURNEY = [{ step: 1, event: 'record', kind: 'ask.created' }, { step: 2, event: 'hover', at: [240, 316] }, { step: 3, event: 'clock', ms: 60000 }].map((step) => JSON.stringify(step)).join('\n') + '\n';

/** The list and transcript, five runs an arm: the candidate runs first in pairs 1, 3 and 5, gpui-fast in 2 and 4. */
const listTranscript = (arm) => raw(arm, 'list-transcript', {
  rows: 1000, transcript: TRANSCRIPT, ...(arm === 'gpui-fast' ? { shape: 'shared', retention: 'on' } : {}),
  runs: runs(5, (i) => ({ pair: i + 1, streamed: 240, update_ms: [...UPDATES], coldStartMs: 180.5 + i, idleCpuPercent: 0.05, memoryBytes: 61_000_000 + 1000 * i, appBytes: 21_000_000 }),
    (i) => 3600 + 600 * i + ((i % 2 === 0) === (arm === 'candidate') ? 0 : 300)),
});
const LIST_READING = { update_p99_ms: [2, 2, 2, 2, 2], coldStartMs: [180.5, 181.5, 182.5, 183.5, 184.5], idleCpuPercent: [0.05, 0.05, 0.05, 0.05, 0.05], memoryBytes: [61_000_000, 61_001_000, 61_002_000, 61_003_000, 61_004_000], appBytes: Array(5).fill(21_000_000) };

/** A journey's frames: each with its step, the sha256 of its bytes, the views drawn again from the last frame, and each view's own pixels. */
const frames = (retained, spoil = () => false) => [1, 2, 3].map((step) => {
  const views = Object.fromEntries(['list', 'row-7', 'transcript'].map((view) => [view, sha256(`${view} at step ${step}${spoil(step, view) ? ', holding a glyph tile of a retired page' : ''}`)]));
  return { step, sha256: sha256(JSON.stringify(views)), reused: retained && step > 1 ? 2 : 0, views };
});
const retention = (arm, spoil) => ({
  runs: runs(2, (i) => (i === 0
    ? { retention: 'on', switch: null, journey: sha256(JOURNEY), frames: frames(true, spoil) }
    : { retention: 'off', switch: SWITCH, journey: sha256(JOURNEY), frames: frames(false) })),
});
/** One vsync: whether the window was still, what the main render and layer paths committed, and what the ledger counted. */
const vsync = (still, main, layers, counted = main + layers) => ({ still, committed: { main, layers }, ledger: { committed: counted, gpu_ns: counted * 410_000 } });
/** 30 vsyncs while something moves, then 120 of a still window. */
const vsyncs = (moving, still) => [...Array.from({ length: 30 }, () => vsync(...moving)), ...Array.from({ length: 120 }, () => vsync(...still))];

const SCALE = { shared: { on: 1, off: 1.5 }, own: { on: 0.5, off: 1.5 } };
const cpu = (rows, on) => (rows / 1000) * (on ? 0.25 : 1);
const listRun = (shape, on) => ({ kind: 'list', shape, retention: on ? 'on' : 'off', switch: on ? null : SWITCH, rows: 1000, state_entities: shape === 'shared' ? 1 : 1000, reused: on ? (shape === 'own' ? 9000 : 40) : 0, update_ms: UPDATES.map((ms) => ms * SCALE[shape][on ? 'on' : 'off']) });
const labelRun = (rows, on) => ({ kind: 'label', shape: 'shared', live_rows: rows, retention: on ? 'on' : 'off', switch: on ? null : SWITCH,
  frames: Array.from({ length: 20 }, (_, k) => ({ rendered: on ? 2 : rows + 2, elements: 4 * rows + 10, cpu_ms: cpu(rows, on) + k / 64, reused: on ? rows : 0 })) });
const labelReading = (rows, on) => ({ views_rendered: on ? 2 : rows + 2, elements_laid_out: 4 * rows + 10, cpu_ms_p50: cpu(rows, on) + 9 / 64, cpu_ms_p95: cpu(rows, on) + 18 / 64 });
const CELLS = [['shared', true], ['shared', false], ['own', true], ['own', false]].map(([shape, on]) => listRun(shape, on)).concat([[1000, true], [1000, false], [3000, true], [3000, false]].map(([rows, on]) => labelRun(rows, on)));

/** The well-formed spike: `record`, and `files` by their path in docs/spikes/1433/ (a raw reading as an object, any other file as text). */
export function wellFormed() {
  const g = GATES.gates;
  const at = (path) => fileAt(BASE, path);
  const files = {
    'gates.json': readFileSync(new URL('./gates.json', import.meta.url), 'utf8'),
    'raw/candidate-canvas-handoff.json': raw('candidate', 'canvas-handoff', {
      slot: { size_px: [1936, 1584], translucent_px: 153318, pixel_hash: FRAME }, headless: { size_px: [1936, 1584], pixel_hash: FRAME },
      swatches: Object.entries(lookAt(BASE)).map(([status, read]) => ({ status, read })),
      runs: runs(5, (i) => ({ frame_ms: Array(300).fill(MEANS[i]) })),
    }),
    'raw/candidate-idle.json': raw('candidate', 'idle', { runs: runs(5, (i) => ({ seconds: 60, frames: 0, wakeups: WAKEUPS[i] })) }),
    'raw/candidate-list-transcript.json': listTranscript('candidate'),
    'raw/candidate-text-input.json': raw('candidate', 'text-input', {
      taken_by: 'person', methods: Object.fromEntries(g['text-input'].methods.map((method) => [method, Object.fromEntries(g['text-input'].faults.map((fault) => [fault, false]))])), runs: runs(1),
    }),
    'raw/candidate-accessibility.json': raw('candidate', 'accessibility', {
      taken_by: 'person', voiceover: true, command: 'scripts/lease deep-live --pid 4100', live: { window: WINDOW, tree: TREE }, headless: { window: WINDOW, tree: structuredClone(TREE) }, runs: runs(1),
    }),
    'raw/candidate-question-card.json': raw('candidate', 'question-card', {
      taken_by: 'person', built_with: { path: g['question-card'].built_with, sha256: sha256(at(g['question-card'].built_with)) }, card: { covered_by: [] }, status_item: { shown: true },
      presses: [{ sent: 'hardware', told: 'hardware' }, { sent: 'synthetic', told: 'synthetic' }, { sent: 'synthetic', told: 'synthetic' }], runs: runs(1),
    }),
    'raw/candidate-panel.json': raw('candidate', 'panel', { panel: { path: g.panel.panel, sha256: sha256(at(g.panel.panel)) }, tree: at(g.panel.tree), runs: runs(5, () => ({ update_ms: [...UPDATES] })) }),
    'raw/gpui-fast-list-transcript.json': listTranscript('gpui-fast'),
    'raw/journey.jsonl': JOURNEY,
    'raw/gpui-fast-retention-frames.json': raw('gpui-fast', 'retention-frames', retention('gpui-fast')),
    'raw/gpui-fast-retention-frames.planted.json': { ...raw('gpui-fast', 'retention-frames', retention('gpui-fast', (step, view) => step === 2 && view === 'row-7')), harness: sha256('the harness built with the planted glyph page'), planted: 'glyph-page-retired' },
    'raw/gpui-fast-still-ledger.json': raw('gpui-fast', 'still-ledger', { runs: runs(1, () => ({ vsyncs: vsyncs([false, 1, 1], [true, 0, 0]) })) }),
    'raw/gpui-fast-still-ledger.planted.json': { ...raw('gpui-fast', 'still-ledger', { runs: runs(1, () => ({ vsyncs: vsyncs([false, 1, 1, 1], [true, 0, 1, 0]) })) }), harness: sha256('the harness built with the planted ledger'), planted: 'ledger-main-only' },
    'raw/gpui-fast-list-shapes.json': raw('gpui-fast', 'list-shapes', { subject: 'list', ships: 'shared', runs: runs(8, (i) => CELLS[i]) }),
  };
  const gate = (status, reading, file, more = {}) => ({ status, reading, machine: { ...AIR }, load: 1.75, raw: { file }, ...more });
  const record = {
    spike: ISSUE,
    base: BASE,
    gates: { file: 'gates.json' },
    arms: {
      candidate: {
        pin: { revision: 'c0ffee'.repeat(7).slice(0, 40), mirror: { sha256: sha256('the candidate\'s source at its pinned revision, as mirrored') } },
        harness: { sha256: HARNESS.candidate },
        gates: {
          'canvas-handoff': gate('pass', { frame_ms: MEANS }, 'raw/candidate-canvas-handoff.json'),
          idle: gate('pass', { frames: [0, 0, 0, 0, 0], wakeups: WAKEUPS }, 'raw/candidate-idle.json'),
          'list-transcript': gate('pass', LIST_READING, 'raw/candidate-list-transcript.json'),
          'text-input': gate('pass', { faults: [] }, 'raw/candidate-text-input.json'),
          accessibility: gate('pass', { nodes: 4, first_difference: null }, 'raw/candidate-accessibility.json'),
          'question-card': gate('pass', { covered_by: [], hardware: 1, synthetic: 2, mistold: 0 }, 'raw/candidate-question-card.json'),
          panel: gate('pass', { parity: true, update_p99_ms: [2, 2, 2, 2, 2] }, 'raw/candidate-panel.json'),
        },
      },
      'gpui-fast': {
        version: GATES.gpui_fast.version,
        copies: Object.fromEntries(GATES.gpui_fast.copies.map((crate) => [crate, lockedAt(BASE, crate, GATES.gpui_fast.version)])),
        carry: carriedAt(BASE).map((hunk) => { const [, file, line, issue] = /^(.+):(\d+)#(\d+)$/.exec(hunk); return { file, line: Number(line), issue: Number(issue) }; }),
        harness: { sha256: HARNESS['gpui-fast'] },
        gates: {
          'list-transcript': gate('pass', LIST_READING, 'raw/gpui-fast-list-transcript.json'),
          'retention-frames': gate('pass', { frames: 3, first_difference: null }, 'raw/gpui-fast-retention-frames.json', { journey: { file: 'raw/journey.jsonl' }, planted: { file: 'raw/gpui-fast-retention-frames.planted.json', view: 'row-7' } }),
          'still-ledger': gate('pass', { still_vsyncs: 120, still_command_buffers: 0, still_gpu_ns: 0, uncounted: 0 }, 'raw/gpui-fast-still-ledger.json', { planted: { file: 'raw/gpui-fast-still-ledger.planted.json' } }),
          'list-shapes': gate('pass', {
            ships: 'shared',
            list: { shared: { on: 2, off: 3 }, own: { on: 1, off: 3 } },
            label: { 1000: { on: labelReading(1000, true), off: labelReading(1000, false) }, 3000: { on: labelReading(3000, true), off: labelReading(3000, false) } },
          }, 'raw/gpui-fast-list-shapes.json'),
        },
      },
    },
    lines: { candidate: 'fallback', 'gpui-fast': 'fallback' },
  };
  return structuredClone({ record, files });
}

/**
 * Writes a spike under <dir>/docs/spikes/1433/ and pins, in the record, the sha256 of each file it cites that names
 * none yet. A file whose body is null isn't written. Returns the record as written.
 */
export function write(dir, { record, files }) {
  const texts = Object.fromEntries(Object.entries(files).filter(([, body]) => body !== null).map(([file, body]) => [file, typeof body === 'string' ? body : JSON.stringify(body)]));
  (function pin(value) {
    if (value === null || typeof value !== 'object') return;
    if (typeof value.file === 'string' && value.file in texts && !('sha256' in value)) value.sha256 = sha256(texts[value.file]);
    Object.values(value).forEach(pin);
  })(record);
  for (const [file, text] of Object.entries({ ...texts, 'record.json': `${JSON.stringify(record, null, 2)}\n` })) {
    mkdirSync(dirname(join(dir, SPIKE, file)), { recursive: true });
    writeFileSync(join(dir, SPIKE, file), text);
  }
  return record;
}
