// #2330: start/stop reports reuse the sealed real-socket scenarios, never --check.
// The budget runner takes 20 external samples/side and keeps its base/counter evidence.
// Each report retains one warm-up and five readings per timed scenario; no retries.
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { judgeLimit } from '../scripts/benchmark.mjs';
import { builder, qualifiedMachine, measureScenario, judgeScenario } from '../tests/acceptance/2330-redraft/run.mjs';

const tasks = { 'hub-lifecycle-start': ['start'], 'hub-lifecycle-stop': ['stop', 'early-close', 'stubborn'] };
const limits = { start: 60, stop: 30, 'early-close': 30 };
const finite = value => Number.isFinite(value) && value >= 0;
const quiet = values => values.every(value => finite(value) && value < availableParallelism());
function judge(current) {
  const targets = {};
  for (const kind of tasks[current?.task] ?? []) {
    const reading = current.scenarios?.[kind], rows = reading?.rows, limit = limits[kind];
    const invalid = !reading || reading.kind !== kind || !Array.isArray(rows) || rows.length !== (kind === 'stubborn' ? 1 : 5)
      || rows.some(row => !row || row.kind !== kind || !Array.isArray(row.loads) || row.loads.length !== 2
        || (kind === 'stubborn' ? row.semantic !== true : row.limit !== limit || !finite(row.lower) || !finite(row.upper) || row.lower > row.upper
          || (kind === 'start' && (!finite(row.readyAfterSpawn) || !finite(row.answerAfterSpawn)
            || row.readyAfterSpawn < 30 || row.answerAfterSpawn < row.readyAfterSpawn || row.answerAfterSpawn > 35))));
    if (invalid) {
      targets[kind] = { status: 'BLOCKED', limit, reason: `missing or invalid ${kind} scenario readings` };
      continue;
    }
    // The standalone runner checks the initial environment before launching. Recheck it
    // on stdin too (including the semantic-only stubborn case); never trust a stored verdict.
    const before = judgeLimit({ limit: 1, runs: [1, 1, 1, 1, 1], fingerprint: reading.machine,
      loads: Array.from({ length: 5 }, (_, i) => ({ start: rows[i % rows.length].loads[0], end: rows[i % rows.length].loads[1] })) });
    const environmentLoads = reading.environmentLoads;
    const qualified = before.status === 'PASS' && rows.every(row => quiet(row.loads))
      && Array.isArray(environmentLoads) && environmentLoads.length === 5
      && environmentLoads.every(load => quiet([load?.start, load?.end]));
    const status = qualified ? judgeScenario(reading) : 'INCONCLUSIVE';
    targets[kind] = { ...reading, limit, status, reason: qualified
      ? `${kind}: ${status}; all five upper bounds must meet ${limit ?? 'the semantic check'}, only failing lower bounds fail`
      : before.reason ?? 'missing, invalid or non-quiet environment loads' };
  }
  const statuses = Object.values(targets).map(target => target.status);
  const status = !statuses.length || statuses.includes('BLOCKED') ? 'BLOCKED'
    : statuses.includes('INCONCLUSIVE') ? 'INCONCLUSIVE' : statuses.includes('FAIL') ? 'FAIL' : 'PASS';
  return { status, targets, reason: statuses.length
    ? Object.values(targets).map(target => target.reason).join('; ')
    : 'missing or unknown current lifecycle task; base is not current evidence' };
}

const mode = process.argv[2];
if (mode === 'judge' && process.argv.length === 3) {
  try { console.log(JSON.stringify(judge(JSON.parse(readFileSync(0, 'utf8'))?.current))); }
  catch (error) { console.log(JSON.stringify({ status: 'BLOCKED', targets: {}, reason: `invalid judge input: ${error.message}` })); }
} else if (tasks[`hub-lifecycle-${mode}`] && process.argv.length === 3) {
  let fixture;
  try {
    const machine = qualifiedMachine();
    fixture = builder();
    const task = `hub-lifecycle-${mode}`, scenarios = {};
    for (const kind of tasks[task]) scenarios[kind] = await measureScenario(fixture.sample, kind, machine);
    console.log(JSON.stringify({ task, scenarios }));
  } catch (error) { console.error(error.message); process.exitCode = 3; }
  finally { fixture?.close(); }
} else {
  console.error('BLOCKED: use start, stop (authorized budget measurements only), or judge (JSON on stdin)');
  process.exitCode = 3;
}
