import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// #2256: the judge must handle real look-frame readings too, not only the empty acceptance input.
// #417's report holds each look's frames; each target is the worst look's p95, not the worst frame.
test('look-frame targets take each run\'s worst look p95 independently for GPU and CPU', () => {
  const runs = Array.from({ length: 5 }, (_, run) => ({
    looks: {
      first: { frames: Array.from({ length: 300 }, (_, frame) => ({
        gpu_ms: frame < 285 ? 1 + run : 1000,
        cpu_ms: frame < 285 ? 5 + run : 1000,
      })) },
      second: { frames: Array.from({ length: 300 }, (_, frame) => ({
        gpu_ms: frame < 284 ? 2 + run : 3 + run,
        cpu_ms: frame < 284 ? 3 + run : 4 + run,
      })) },
    },
  }));
  const current = { task: 'canvas-look-frames', fingerprint: { build: { profile: 'release' } }, runs };
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../benchmarks/canvas.mjs', import.meta.url)), 'judge'], {
    encoding: 'utf8', input: JSON.stringify({ current, base: null }),
  });
  assert.equal(result.status, 0, result.stderr);
  const judged = JSON.parse(result.stdout.trim());
  assert.equal(judged.task, current.task);
  assert.deepEqual(judged.targets.frame_gpu_p95_ms.runs, [3, 4, 5, 6, 7]);
  assert.deepEqual(judged.targets.frame_cpu_p95_ms.runs, [5, 6, 7, 8, 9]);
});
