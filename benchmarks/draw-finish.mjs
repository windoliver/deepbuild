// #3617's budget, the `draw-finish` mode of benchmarks/canvas.mjs (task `canvas-gpu-draw-finish`):
// the draw-and-finish time of a 1936 x 1584 one-pass GPU surface slot on the zero-copy path, from
// the start of View::render to the slot being ready, split into encode, submit, gpu and wait.
// One warm-up run and five timed runs of 300 frames each, each a fresh release deep-gpu process.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { p95 } from './canvas-judge.mjs';

const FRAMES = 300;
const PARTS = ['encode', 'submit', 'gpu', 'wait'];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function runRelease(root, line) {
  const target = process.env.CARGO_TARGET_DIR || join(root, 'target');
  const bin = join(target, 'release', process.platform === 'win32' ? 'deep-gpu.exe' : 'deep-gpu');
  const out = spawnSync(bin, ['run'], { input: `${JSON.stringify(line)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (out.status !== 0) throw Error(`deep-gpu run exited ${out.status}: ${out.stderr.slice(-2000)}`);
  return JSON.parse(out.stdout.trim().split('\n').at(-1));
}

export function drawFinish({ root, release, runs }) {
  const fingerprint = release('deep-gpu-layer', 'deep-gpu');
  const scene = join(root, 'tests', 'acceptance', '3617', 'fixtures', 'parity', 'gpu', 'one-pass.scene');
  const dir = mkdtempSync(join(tmpdir(), 'deep-draw-finish-bench-'));
  try {
    const measured = runs(() => {
      const answer = runRelease(root, {
        out: dir,
        calls: [{ call: 'frames', scene, count: FRAMES, path: 'zero_copy', timings: true, hash: false }],
      });
      const frames = answer.replies?.[0]?.frames;
      if (answer.ok !== true || !Array.isArray(frames) || frames.length !== FRAMES) {
        throw Error(`deep-gpu frames answered ${JSON.stringify(answer).slice(0, 1500)}`);
      }
      const draw = frames.map((f) => f.draw_ms);
      const parts_mean_ms = Object.fromEntries(PARTS.map((p) => [p, mean(frames.map((f) => f.draw_parts_ms[p]))]));
      return { draw_finish_p95_ms: p95(draw), parts_mean_ms };
    });
    console.log(JSON.stringify({ task: 'canvas-gpu-draw-finish', fingerprint, runs: measured }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
