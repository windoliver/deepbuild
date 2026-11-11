// #405.17969a94: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the geometry audit
// of a 1,000-part figure takes under 500 ms, and determinism hashing adds under 5% to render time"
//
// The figure (helpers.ts `figure`): a still `figure` document of 1,000 scene3d solids in the `part` role, a plate and
// 999 boxes, cylinders and spheres standing on it on a 37 × 27 grid, two planted pairs (part-0000 and part-0998, the
// first and last in order; part-0499 and part-0500, in the middle) passing 0.1 m into each other, a perspective camera
// and one sun, 1920 × 1080, every solid with a fill role of the shipped clean look. In every process the working agent
// shows it through `deep_show` and its claim's verdict runs one requirement on it, in a fresh `deep-show run`.
//
// The audit: the requirement `{kind: "geometry.audit"}`. Its row must FAIL with an error naming each planted pair, so
// an audit that looked at part of the figure, or stopped at its first fault, can't be the one timed; its own time is
// the row's `timing.check_ms`.
// Hashing: the requirement `{kind: "document.determinism", at_times: 0, 0.5, 1, 1.5 and 2 s}`, the agent's show having
// asked for pixels so the GPU is open before the check. Its row must PASS on `machines: same` (the still figure seeks
// as it plays, by hash); its share is the row's `timing.hash_ms` ÷ `timing.render_ms`.
//
// Each test first runs the figure once on the debug build, on any machine: the row decided as above, with its times.
// Then the perf lane's own judgeLimit (scripts/benchmark.mjs) says whether this machine can judge a timing now (a
// reference Mac on mains power, Low Power Mode off, thermal state nominal, the load under the core count); if not,
// INCONCLUSIVE. If so, `full` is built in release, and the figure is judged in one warm-up process and then five more,
// each run held to the same row as the debug run; judgeLimit over the five readings, with each run's load at its start
// and end, against 500 ms and 0.05: FAIL fails, anything but PASS is INCONCLUSIVE, never a pass.
import { describe, expect, it } from 'vitest';
import {
  AC4, PLANTED, TIMEOUT, brief, canJudge, figure, inconclusive, isObject, judgeLimit, load, names, none, partsIn, presentedFailures, rowOf, run,
  scenarioOf, timingOf, useBuilds, useFolders, type JsonObject, type Load,
} from './helpers.ts';

const builds = useBuilds();
const folder = useFolders();
const RUNS = 5;
const AUDIT_MS = 500;
const HASH_SHARE = 0.05;
const AUDIT: JsonObject = { kind: 'geometry.audit' };
const DETERMINISM: JsonObject = { kind: 'document.determinism', at_times: ['0s', '0.5s', '1s', '1.5s', '2s'] };

interface Reading { value: number; failures: string[] }

/** One fresh process: the agent shows the figure and the verdict runs the geometry audit on it. The reading is check_ms. */
function auditRun(bin: string): Reading {
  const { replies, wallMs } = run(bin, scenarioOf(folder(), figure(), AUDIT, ['issues']));
  const failures = presentedFailures(replies[0]!);
  const row = rowOf(replies[1]!);
  if (!row) return { value: NaN, failures: [...failures, `the verdict has no row for the geometry audit's requirement: ${brief(replies[1])}`] };
  if (row['result'] !== 'FAIL') failures.push(`the geometry audit of the figure is ${brief(row['result'])}, not FAIL, though two pairs of its parts pass 0.1 m into each other: ${brief(row)}`);
  const issues = Array.isArray(row['issues']) ? row['issues'].filter(isObject) : [];
  for (const [a, b] of PLANTED) {
    if (!issues.some((i) => i['severity'] === 'error' && names(i, a) && names(i, b))) failures.push(`no error of the geometry audit names both ${a} and ${b}, which pass 0.1 m into each other: ${brief(issues)}`);
  }
  const ms = timingOf(row, 'check_ms');
  if (ms === null) failures.push(`the geometry audit's row reports no timing.check_ms, its own time in ms: ${brief(row['timing'])}`);
  else if (ms > wallMs) failures.push(`the geometry audit's timing.check_ms, ${ms} ms, is longer than its whole process, ${wallMs.toFixed(1)} ms`);
  return { value: ms ?? NaN, failures };
}

/** One fresh process: the agent shows the figure with its pixels and the verdict runs document.determinism on it. The reading is hash_ms ÷ render_ms. */
function hashRun(bin: string): Reading {
  const { replies, wallMs } = run(bin, scenarioOf(folder(), figure(), DETERMINISM, ['issues', 'pixels']));
  const failures = presentedFailures(replies[0]!);
  const row = rowOf(replies[1]!);
  if (!row) return { value: NaN, failures: [...failures, `the verdict has no row for the determinism requirement: ${brief(replies[1])}`] };
  const blocked = Array.isArray(row['blocked']) ? row['blocked'].filter(isObject) : [];
  if (row['result'] === 'BLOCKED' && blocked.some((b) => /gpu/.test(String(b['code'])))) inconclusive(`there is no GPU here to render and hash the figure on: ${brief(row)}`);
  if (row['result'] !== 'PASS') failures.push(`document.determinism on the still figure is ${brief(row['result'])}, not PASS: seeking to each time draws what playing to it draws: ${brief(row)}`);
  if (row['machines'] !== 'same') failures.push(`document.determinism compares GPU pixel hashes, so its row holds on machines: same, not ${brief(row['machines'])}`);
  const render = timingOf(row, 'render_ms');
  const hash = timingOf(row, 'hash_ms');
  if (render === null || render === 0) failures.push(`the determinism row reports no render time, timing.render_ms in ms: ${brief(row['timing'])}`);
  if (hash === null) failures.push(`the determinism row reports no hashing time, timing.hash_ms in ms: ${brief(row['timing'])}`);
  if (render !== null && hash !== null && render + hash > wallMs) failures.push(`the determinism row's render_ms + hash_ms, ${render + hash} ms, is longer than its whole process, ${wallMs.toFixed(1)} ms`);
  return { value: render && hash !== null ? hash / render : NaN, failures };
}

/** The budget: the debug run decided, then, where this machine can judge, a warm-up and five release runs judged by the lane. */
async function budget(what: string, limit: number, once: (bin: string) => Reading, shown: (v: number) => string): Promise<void> {
  none(once(builds.debug()).failures, `${what}, on the debug build`);
  const here = await canJudge(limit);
  if (here['status'] !== 'PASS') inconclusive(`${what}: the row is decided and reports its times, but this machine can't judge a timing now: ${String(here['reason'])}`);
  const bin = builds.release();
  none(once(bin).failures, `${what}, the release build's warm-up run`);
  const runs: number[] = [];
  const loads: Load[] = [];
  for (let k = 1; k <= RUNS; k++) {
    const start = load();
    const r = once(bin);
    loads.push({ start, end: load() });
    none(r.failures, `${what}, release run ${k}`);
    runs.push(r.value);
  }
  const verdict = await judgeLimit(limit, runs, loads);
  console.log(`#405 criterion 4, ${what}, per run: ${runs.map(shown).join(', ')} → ${String(verdict['status'])}`);
  expect(verdict['status'], `${what} against ${shown(limit)}: ${JSON.stringify(verdict)}`).not.toBe('FAIL');
  if (verdict['status'] !== 'PASS') inconclusive(`${what}: ${JSON.stringify(verdict)}`);
}

describe(`${AC4} budgets: the geometry audit of a 1,000-part figure and determinism hashing, on the reference Mac`, () => {
  it(`${AC4} the geometry audit of a 1,000-part figure takes under ${AUDIT_MS} ms on the reference Mac (timing.check_ms, five runs after warm-up)`, async () => {
    expect(partsIn(figure()), 'the figure holds 1,000 parts').toBe(1000);
    await budget('the geometry audit of the 1,000-part figure', AUDIT_MS, auditRun, (ms) => `${ms.toFixed(2)} ms`);
  }, TIMEOUT);

  it(`${AC4} determinism hashing adds under 5% to render time on the reference Mac (timing.hash_ms ÷ timing.render_ms, five runs after warm-up)`, async () => {
    await budget('determinism hashing over render time on the 1,000-part figure', HASH_SHARE, hashRun, (share) => `${(share * 100).toFixed(2)}%`);
  }, TIMEOUT);
});
