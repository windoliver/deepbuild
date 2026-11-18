// #2698 AC5: "`hub-idle` reports wakeups, instructions a second, CPU a second and footprint for the hub and for each
// child, and two runs on one build agree within 10% on instructions a second after 15 s to settle."
//
// The budget's own command (benchmarks/budgets.json: hub-idle) runs twice in this checkout, and each last stdout line
// is read through surface.mjs's idleLine. While a run goes, the test reads the process table about twice a second:
// that is its own account of which process the hub was, how long it lived and which children it kept (README: AC5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocked, inconclusive, needsBuild, needsMac, runTask, show } from './support.mjs';
import { IDLE_READINGS, INCONCLUSIVE, idleLine } from './surface.mjs';

const SETTLE_MS = 15_000, AGREE = 0.1;

/** One run's last line held against the criterion and the process table. It gives the hub's instructions a second. */
function judgeIdle(run, which, unseen) {
  const told = `AC5, ${which} run`;
  assert.equal(run.status, 0, `${told}: hub-idle failed\n${show(run)}`);
  const line = idleLine(run.last);
  assert.deepEqual([line.today.bench, line.today.mode], ['hub', 'idle'], `${told}: the last line is not hub-idle's\n${show(run)}`);
  for (const name of ['idleCpuPercent', 'rssBytes']) assert.ok(Number.isFinite(line.today[name]) && line.today[name] >= 0, `${told}: the last line no longer reports ${name}, which it reports today\n${show(run)}`);
  if (line.status === INCONCLUSIVE) throw inconclusive(`${told}: hub-idle itself reads ${INCONCLUSIVE} here, so its readings prove nothing: ${line.reason}`);

  const readings = (process, whose) => {
    for (const name of IDLE_READINGS) assert.ok(process[name] !== null, `${told}: ${whose} has no ${name}, and the line does not read ${INCONCLUSIVE}\n${show(run)}`);
    assert.ok(process.footprintBytes > 0, `${told}: ${whose} holds a footprint of 0 bytes\n${show(run)}`);
  };
  readings(line.hub, 'the hub');
  assert.ok(line.hub.footprintBytes >= 1e6, `${told}: the hub's footprint, ${line.hub.footprintBytes}, is under 1 MB: not a Node process's footprint in bytes\n${show(run)}`);
  assert.ok(line.hub.instructionsPerSecond > 0 && line.hub.cpuMsPerSecond > 0, `${told}: a live hub retires instructions and uses CPU: ${JSON.stringify(line.hub)}\n${show(run)}`);

  // The test's own account of the run, from the process table.
  const looks = run.samples, mine = looks.map((look, index) => (look.children.has(line.hub.pid) ? index : -1)).filter((index) => index >= 0);
  if (!looks.length) throw blocked(`${told}: ps gave the test no look at the process table while hub-idle ran, so it has no account of the hub's own to hold the line against`);
  assert.ok(line.hub.pid, `${told}: the last line gives the hub no PID (\`hub.pid\`)\n${show(run)}`);
  assert.ok(mine.length, `${told}: hub.pid ${line.hub.pid} was never a child of the task (PID ${run.pid}) in the ${looks.length} looks the test took at the process table\n${show(run)}`);
  assert.ok(line.spanMs > 0, `${told}: the last line states no span (\`spanMs\`) for its readings a second\n${show(run)}`);
  // The hub can have lived no longer than from the look before the first that saw it to the look after the last.
  const first = mine[0], last = mine.at(-1);
  const longest = (looks[last + 1]?.at ?? run.elapsedMs) - (looks[first - 1]?.at ?? 0);
  assert.ok(longest >= SETTLE_MS + line.spanMs, `${told}: the hub lived at most ${(longest / 1000).toFixed(1)} s, less than the 15 s to settle and the ${(line.spanMs / 1000).toFixed(1)} s it says it then read over\n${show(run)}`);

  // Each child the hub kept: one the table showed under the hub in every look from before the span to its end.
  const end = looks[last].at;
  const through = looks.filter((look) => look.at >= end - line.spanMs - 5000 && look.at <= end - 2000);
  const kept = through.length < 2 ? [] : [...through[0].children.get(line.hub.pid) ?? []].filter((pid) => through.every((look) => look.children.get(line.hub.pid)?.includes(pid)));
  for (const pid of kept) {
    const child = line.children.find((entry) => entry.pid === pid);
    assert.ok(child, `${told}: the hub kept the child ${pid} through the span, and the last line reports ${line.children.length ? `only ${line.children.map((entry) => entry.pid).join(', ')}` : 'no child'}\n${show(run)}`);
    readings(child, `the hub's child ${pid}`);
  }
  for (const [index, child] of line.children.entries()) readings(child, `children[${index}]`);
  const real = line.children.filter((child) => looks.some((look) => look.children.get(line.hub.pid)?.includes(child.pid)));
  if (!real.length) unseen.push(`${told}: the process table showed no child the hub kept through its span (${through.length} looks), and the line reports none the table ever showed under the hub`);
  return line.hub.instructionsPerSecond;
}

test('#2698 AC5 hub-idle reports wakeups, instructions a second, CPU a second and footprint for the hub and for each child, and two runs on one build agree within 10% on instructions a second after 15 s to settle', { timeout: 2_400_000 }, async (t) => {
  needsMac();
  needsBuild();
  const unseen = [], rates = [];
  for (const which of ['first', 'second']) {
    const run = await runTask('hub-idle', { timeoutMs: 900_000 });
    t.diagnostic(`${which} run: ${show(run)}`);
    rates.push(judgeIdle(run, which, unseen));
  }
  const apart = (Math.max(...rates) - Math.min(...rates)) / Math.min(...rates);
  assert.ok(apart <= AGREE, `AC5: the hub's instructions a second were ${rates.join(' and ')} on two runs of one build, ${(apart * 100).toFixed(1)}% apart; expected within ${AGREE * 100}%`);
  // "For each child" is shown only by a run in which the hub kept one.
  if (unseen.length === rates.length) throw inconclusive(`${unseen.join('; ')}: "for each child" was not seen`);
});
