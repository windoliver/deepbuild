// The planted wrong program `judge-throws` for #2256 AC1 (tests/acceptance/2256-redraft-2047/README.md, The wrong
// programs): a canvas bench that parses, so `node --check` exits 0, but whose judge prints no judged line for the
// issue's report. Like the base's judge, it holds to targets only the tasks EFFICIENCY names and reads any other report
// as a budget class's. EFFICIENCY names no canvas-look-frames and the report names no class, so the judge throws
// "Unknown class undefined": it exits 1 with nothing on stdout.
import { readFileSync } from 'node:fs';

const CLASS_LIMITS = { figure: { gpu_ms: 2, cpu_ms: 4 } };
const EFFICIENCY = { 'canvas-patch-settled': { settled_p95_ms: (r) => r.p95_ms } };
const workloads = {};
workloads.judge = () => {
  const { current } = JSON.parse(readFileSync(0, 'utf8'));
  if (EFFICIENCY[current.task]) {
    console.log(JSON.stringify({ task: current.task, status: 'BLOCKED', reason: 'no runs to judge' }));
    return;
  }
  const limits = CLASS_LIMITS[current.class];
  if (!limits) throw Error(`Unknown class ${current.class}`);
  console.log(JSON.stringify({ class: current.class, status: 'BLOCKED', reason: 'no runs to judge' }));
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
await workloads[task]();
