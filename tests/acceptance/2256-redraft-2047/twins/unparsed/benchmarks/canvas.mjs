// The planted wrong program `unparsed` for #2256 AC1 (tests/acceptance/2256-redraft-2047/README.md, The wrong programs):
// a canvas bench whose merge lost the two lines that end a workload, `  }` and `};`, so every line after it, the closing
// dispatch included, sits inside that workload's arrow function, and the dispatch's top-level `await` lands inside a
// function that isn't async. Node can't parse the file: `node --check` exits 1, and every task, `judge` among them,
// stops on "SyntaxError: Unexpected reserved word" before it starts. With the two lines put back where marked, it
// parses and its judge prints a judged line.
import { readFileSync } from 'node:fs';

const workloads = {};
workloads['many-lamps'] = () => {
  try {
    console.log(JSON.stringify({ task: 'canvas-many-lamps', runs: [] }));
  } finally {
    console.log('done');
// Lost here: the two lines that end the workload above.
// #501: 32 looping voices, the comment the lost lines stood before.
workloads['media-soak'] = () => {
  console.log(JSON.stringify({ task: 'media-soak', stats: {} }));
};
workloads.judge = () => {
  const { current } = JSON.parse(readFileSync(0, 'utf8'));
  console.log(JSON.stringify({ task: current.task, status: 'BLOCKED', reason: 'no runs to judge' }));
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
await workloads[task]();
