import { checks, runLanes } from './lanes.mjs';

// Planted wrong program for #689's blind redraft (tests/acceptance/689-redraft-2047/README.md): the check workload
// drops rustup's and Cargo's homes, so each lane's tools look for them under whatever HOME the lane runs with.
delete process.env.RUSTUP_HOME;
delete process.env.CARGO_HOME;
process.exitCode = runLanes(checks);
