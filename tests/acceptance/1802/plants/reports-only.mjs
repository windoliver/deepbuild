#!/usr/bin/env node
// A planted wrong program, in test code (design: Wrong programs): a preflight that only reports. It runs the repo's
// contract step, scripts/contract-diff.mjs, with the arguments it was given, prints what the step printed with each
// `FAIL contracts:` head turned into `WARN contracts:`, and exits 0 where the step exited 1. Every other status (0 a
// pass, 2 a usage error, 3 BLOCKED) is the step's own, so a step that couldn't run is never read as a pass.
// #1802's criterion 2 names it as "a planted preflight that only warns", criterion 8 as "a planted step that only
// prints the line". It is selected by running this file in the step's place, never by an environment variable.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const step = fileURLToPath(new URL('../../../../scripts/contract-diff.mjs', import.meta.url));
const run = spawnSync(process.execPath, [step, ...process.argv.slice(2)], { encoding: 'utf8', maxBuffer: 1 << 28 });
if (run.error) {
  process.stdout.write(`BLOCKED contracts: the planted step could not start the contract step: ${run.error.message}\n`);
  process.exit(3);
}
process.stdout.write((run.stdout ?? '').replace(/^FAIL contracts:/gm, 'WARN contracts:'));
process.stderr.write(run.stderr ?? '');
process.exit(run.status === 1 ? 0 : run.status ?? 3);
