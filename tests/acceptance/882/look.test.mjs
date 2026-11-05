// #882 AC1: "The look's guard, run on the shipped look with the chrome roles, passes in light and dark; with the
// session readout's role set to #b45309 it fails, naming the role, blocked and the distance 0.044". Scope: "each
// ink tier keeps its contrast floor ... every chrome role that isn't a status binding keeps the 0.1 OKLab distance".
// The guard is the look's own (crates/deep-canvas-marks/src/look.rs), asked through `deep-canvas-render look`, the
// surface the base already has for it; README.md, The surface, pins what #882 adds to its answer.
// Run: node --test tests/acceptance/882/look.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { AC, buildBin, repoRoot } from './common.mjs';
import { judgeInkGuard, judgeLook } from './look-judge.mjs';

/** `deep-canvas-render look`, one line per input, the answers in order. */
function ask(inputs) {
  const bin = buildBin('deep-marks-render', 'deep-canvas-render');
  if (bin.error) return inputs.map(() => ({ ok: false, code: 'not_built', error: bin.error }));
  const run = spawnSync(bin.path, ['look'], {
    cwd: repoRoot, input: `${inputs.map((i) => JSON.stringify(i)).join('\n')}\n`, encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
  });
  const lines = `${run.stdout ?? ''}`.split('\n').filter(Boolean);
  return inputs.map((_, i) => {
    try {
      return JSON.parse(lines[i]);
    } catch {
      return { ok: false, code: 'no_answer', status: run.status, stderr: `${run.stderr ?? ''}`.slice(0, 400) };
    }
  });
}

test(`${AC[1]} the shipped look passes its guard with the chrome roles in light and dark; the session readout at #b45309 fails it, naming the role, blocked and 0.044`, () => {
  assert.deepEqual(judgeLook(ask), []);
});

test(`${AC[1]} (scope) the guard holds each ink tier to its contrast floor: a light tertiary ink in the ground's color is refused, naming it`, () => {
  assert.deepEqual(judgeInkGuard(ask), []);
});
