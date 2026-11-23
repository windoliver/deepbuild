import { homedir } from 'node:os';
import { join } from 'node:path';
import { checks, runLanes } from './lanes.mjs';

// Planted wrong program for #689's blind redraft (tests/acceptance/689-redraft-2047/README.md): the check workload
// always gives its lanes the user's ~/.rustup and ~/.cargo, over the homes the caller set.
process.env.RUSTUP_HOME = join(homedir(), '.rustup');
process.env.CARGO_HOME = join(homedir(), '.cargo');
process.exitCode = runLanes(checks);
