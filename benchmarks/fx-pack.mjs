// #161's budgets, the `fx-pack` mode of benchmarks/canvas.mjs (task `canvas-fx-pack`): the fx@1 pack's own check, each
// operator's compile, and what a still canvas dispatches. A run starts two fresh processes, so nothing either holds
// from an earlier run is reused: a release deep-show installs packs/fx-1.0.0 as `deepbuild/fx` and answers the pack
// check's wall time (`check_ms`); a release deep-gpu puts each of the pack's graphs through `check_operator`, whose
// `timing.compile_ms` is that operator's compile off the UI thread, and shows a figure whose group's passes name three
// of them as a live session for 60 frames, counting the passes from frame 4 on that name an operator. One warm-up run
// and five. The stage is tests/acceptance/161/ac6-budgets.test.ts's.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = [256, 144];
const STILL = ['fx.levels@1', 'fx.radial_blur@1', 'fx.turbulent_displace@1'];

function figure() {
  const rect = (box, role) => ({ kind: 'rect@1', parent: 'graded', params: { box, paint: { fill: { role } } } });
  const items = {
    graded: { kind: 'group@1', params: { passes: STILL.map((op) => ({ op, params: {} })), isolate: true } },
    card: rect([48, 32, 96, 64], 'accent'),
    bar: rect([80, 48, 32, 32], 'muted'),
  };
  let order = 0;
  for (const [id, item] of Object.entries(items)) Object.assign(item, { id, name: id, order: `a${order++}` });
  return { format: 1, profile: 'figure', title: 'Still', description: 'The #161 still canvas.', size: SIZE, transport: { span: '4s' }, seed: 161,
    requires: { modules: { effects: '^1' } }, budget: { class: 'figure' }, packs: ['deepbuild/fx@1.0.0'], items };
}

export function fxPack({ root, release, once, runs }) {
  release('deep-show', 'deep-show');
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const pack = join(root, 'packs', 'fx-1.0.0');
  const operators = Object.values(JSON.parse(readFileSync(join(pack, 'pack.json'), 'utf8')).operators);
  const look = JSON.parse(readFileSync(join(root, 'tests', 'acceptance', '465', 'fixtures', 'look.json'), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'deep-canvas-bench-'));
  try {
    const doc = join(dir, 'still.json');
    writeFileSync(doc, JSON.stringify(figure()));
    const live = { call: 'live', look, fps: 60, packs: [pack], frames: 60, report: ['passes'], sessions: [{ session: 's', writer: 'agent:bench', doc, size: SIZE }] };
    const measured = runs(() => {
      const installed = once('deep-show', ['run'], { evidence: mkdtempSync(join(dir, 'e-')), packs: [], calls: [{ call: 'install_pack', id: 'deepbuild/fx', dir: pack }] });
      const reply = installed.replies?.[0];
      if (installed.ok !== true || reply?.outcome !== 'installed') throw Error(`deep-show answered ${JSON.stringify(installed).slice(0, 1500)}`);
      const answer = once('deep-gpu', ['run'], { out: dir, calls: [...operators.map((operator) => ({ call: 'check_operator', operator })), live] });
      if (answer.ok !== true || answer.replies.some((r) => r.code)) throw Error(`deep-gpu answered ${JSON.stringify(answer).slice(0, 1500)}`);
      const checks = answer.replies.slice(0, operators.length);
      const refused = checks.findIndex((r) => r.outcome !== 'accepted' || r.timing.thread === r.timing.ui_thread);
      if (refused >= 0) throw Error(`${operators[refused].id} was refused or compiled on the UI thread: ${JSON.stringify(checks[refused]).slice(0, 800)}`);
      const frames = answer.replies.at(-1).frames.filter((f) => f.frame > 3);
      return {
        pack_check_ms: reply.check_ms,
        operator_compile_ms: Math.max(...checks.map((r) => r.timing.compile_ms)),
        still_dispatches: frames.reduce((n, f) => n + f.passes.filter((p) => STILL.includes(p.operator)).length, 0),
      };
    });
    console.log(JSON.stringify({ task: 'canvas-fx-pack', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
