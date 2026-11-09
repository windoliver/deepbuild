// AC6 #70.6c040d74: budgets, on the reference Mac in the local preflight, compared with the merge base: the same hook,
// hub and CLI budgets as macOS, measured on the Linux reference machine.
//
// No Linux reference machine is named anywhere: not in the design, which lists two reference Macs, nor in
// scripts/benchmark.mjs, whose judge reads every other machine as INCONCLUSIVE. A VM on a laptop is no reference, so
// anything measured there is a reading and not a budget result. This test can't pass until someone names the machine;
// then a blind redraft writes the measurement (README: AC6). It fails on every program, so it never reads PASS.

import { describe, it } from 'vitest';
import { AC6 } from './helpers.ts';

/** The tasks in benchmarks/budgets.json the criterion's "hook, hub and CLI budgets" reads as. */
const TASKS = ['hook-startup', 'deep-hook-overhead', 'deep-hook-fail-open', 'deep-hook-guards', 'hub-cold-start', 'hub-round-trip', 'hub-idle', 'deep-inbox-30d', 'deep-status-30', 'deep-doctor'];

describe(`${AC6} The same hook, hub and CLI budgets as macOS, measured on the Linux reference machine`, () => {
  it(`${AC6} is BLOCKED until a Linux reference machine is named: nothing here can read PASS`, () => {
    throw Error(`${AC6} BLOCKED: no Linux reference machine is configured, so ${TASKS.join(', ')} have no machine to count on; name one in the design and in scripts/benchmark.mjs, then redraft this test blind`);
  });
});
