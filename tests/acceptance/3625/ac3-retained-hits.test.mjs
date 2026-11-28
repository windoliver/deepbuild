import assert from 'node:assert/strict';
import test from 'node:test';
import { AC, plantReplayDroppingElement, retainedHitsCrate, runRetainedHits } from './support.mjs';

const HIT = 'the hit at (10px, 30px) on a frame replayed from retention';

const verdict = (label, hits) => {
  console.log(`# ${label}: test result ${hits.result ?? 'none'}; ${hits.panic ? `panic: ${hits.panic.split('\n')[0]}` : 'no panic'}`);
  if (hits.compile.length) return `${label}: the retained-hits test doesn't compile against vendor/gpui-fast with test-support:\n${hits.compile.slice(0, 8).join('\n')}`;
  if (!hits.result) return `INCONCLUSIVE: ${label}: cargo ran no test and named no compiler error\n${hits.tail}`;
  return null;
};

test(`AC3 ${AC[3]} with view retention on, Window::hits_at on a replayed view names the same Hitbox::element as a refreshed frame, and a planted replay that drops it fails naming the hit`, { timeout: 120 * 60_000 }, () => {
  const crate = retainedHitsCrate();

  const kept = runRetainedHits(crate);
  const keptProblem = verdict('vendor/gpui-fast', kept);
  assert.equal(keptProblem, null, keptProblem ?? '');
  assert.ok(kept.result === 'ok' && kept.passed === 1, `vendor/gpui-fast: ${kept.panic || kept.tail}`);

  const planted = plantReplayDroppingElement(crate);
  console.log(`# plant: a replay of last frame's hitboxes with Hitbox::element dropped, in ${planted.join(', ') || 'no file'}`);
  assert.ok(planted.length > 0, 'the plant found no replay of last frame\'s hitboxes (`rendered_frame.hitboxes[..].iter().cloned()`) to change');
  const dropped = runRetainedHits(crate);
  const droppedProblem = verdict('the planted replay', dropped);
  assert.equal(droppedProblem, null, droppedProblem ?? '');
  assert.equal(dropped.result, 'FAILED', `the planted replay that drops Hitbox::element passes the test:\n${dropped.tail}`);
  assert.ok(dropped.panic.includes(HIT) && /`[^`]*(?:inner|target)`/.test(dropped.panic), `the planted replay fails without naming the hit and its element:\n${dropped.panic || dropped.tail}`);
});
