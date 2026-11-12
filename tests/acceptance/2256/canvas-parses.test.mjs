// #2256 acceptance: benchmarks/canvas.mjs parses, so `node --check` exits 0 and `canvas.mjs judge` prints a
// judged line instead of a SyntaxError. Both run the real file as a child process, nothing mocked.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const canvas = join(root, 'benchmarks', 'canvas.mjs');
const show = (r) => `exit ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;

test('node --check benchmarks/canvas.mjs exits 0 (the file parses)', () => {
  const r = spawnSync(process.execPath, ['--check', canvas], { encoding: 'utf8', cwd: root });
  assert.equal(r.status, 0, `benchmarks/canvas.mjs does not parse:\n${show(r)}`);
});

test('canvas.mjs judge on an empty release reading prints a judged line, not a SyntaxError', () => {
  const input = '{"current":{"task":"canvas-look-frames","fingerprint":{"build":{"profile":"release"}},"runs":[]},"base":null}';
  const r = spawnSync(process.execPath, [canvas, 'judge'], { encoding: 'utf8', cwd: root, input });
  assert.doesNotMatch(r.stderr, /SyntaxError/, `canvas.mjs failed to parse:\n${show(r)}`);
  assert.equal(r.status, 0, show(r));
  const line = r.stdout.trim().split('\n').pop();
  let judged;
  try { judged = JSON.parse(line); } catch { assert.fail(`judge printed no JSON judged line:\n${show(r)}`); }
  assert.equal(judged.task, 'canvas-look-frames', show(r));
  assert.ok(['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'].includes(judged.status), `no status in the judged line:\n${show(r)}`);
});
