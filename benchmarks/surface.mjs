// #224's budget, the `surface` mode of benchmarks/canvas.mjs (task `canvas-surface`): criterion 2's rebuild of the
// helicoid-to-catenoid family, a surface@1 of x = cos θ sinh v sin u + sin θ cosh v cos u, y = −cos θ sinh v cos u +
// sin θ cosh v sin u, z = u cos θ + v sin θ over u ∈ [−π/2, π/2], v ∈ [−1, 1] on a 128 × 128 grid, θ on a document
// slider. A release deep-show presents it and asks `geometry` with `timings` at each of four slider entries (θ moved by
// one entry each), so each row is the family built afresh at that θ on the host's threads; a run's reading is the
// median of the four `build_ms` (`rebuild_128_ms`).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FLICKS = 705_600_000;
const DOC = '01JB224B000000000000000001';
const FAMILY = {
  x: 'cos(theta) * sinh(v) * sin(u) + sin(theta) * cosh(v) * cos(u)',
  y: '-cos(theta) * sinh(v) * cos(u) + sin(theta) * cosh(v) * sin(u)',
  z: 'u * cos(theta) + v * sin(theta)',
};
const ENTRIES = [0.25, 0.5, 0.75, 1];
const TRACK = ENTRIES.map((s, i) => ({ t: Math.round(s * FLICKS), seq: i + 1, control: 'theta', value: (Math.PI / 8) * (i + 1), writer: 'you', player: 1 }));
const DOCUMENT = {
  format: 1, profile: 'scene', title: 'The family', description: 'The #224 budget fixture: the helicoid-to-catenoid family on a slider.',
  size: [480, 360], camera: 'cam', requires: { modules: { scene3d: '^1' } }, budget: { class: 'figure' },
  controls: { theta: { kind: 'slider', class: 'document', label: 'θ', role: 'slider', range: [0, Math.PI / 2], default: 0 } },
  items: {
    cam: { id: 'cam', name: 'cam', order: 'a000', kind: 'camera@1', params: { projection: 'perspective', position: [3, 2.5, 4], target: [0, 0, 0], fov: 40 } },
    family: { id: 'family', name: 'family', order: 'a001', kind: 'surface@1',
      params: { fn: FAMILY, u: [-Math.PI / 2, Math.PI / 2], v: [-1, 1], vars: { theta: 'controls/theta/value' }, tolerance: 1e-5, max: [128, 128] } },
  },
};
const SESSIONS = { s1: { thread: 'thread-alpha', name: 'Claude Code: surfaces', process: { pid: 4100, start: 1_000 } } };
const PROCESSES = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export function surface({ release, once, runs }) {
  const fingerprint = release('deep-show', 'deep-show');
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const measured = runs(() => {
      const calls = [{ call: 'deep_show', session: 's1', doc: DOC, document: DOCUMENT },
        ...TRACK.map((e) => ({ call: 'geometry', doc: DOC, items: ['family'], t: e.t, track: TRACK, timings: true }))];
      const answer = once('deep-show', ['run'], { evidence: dir, sessions: SESSIONS, processes: PROCESSES, panels: { main: { rect: [0, 0, 800, 600] } },
        docs: { [DOC]: { panel: 'main' } }, calls });
      const rows = answer.replies?.slice(1).map((r) => r.items?.[0]);
      if (answer.ok !== true || answer.replies[0]?.outcome !== 'presented' || !rows.every((r) => Number.isFinite(r?.build_ms) && r.positions?.length === 128 * 128)) {
        throw Error(`deep-show answered ${JSON.stringify(answer).slice(0, 1500)}`);
      }
      return { rebuild_128_ms: median(rows.map((r) => r.build_ms)), builds_ms: rows.map((r) => r.build_ms) };
    });
    console.log(JSON.stringify({ task: 'canvas-surface', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
