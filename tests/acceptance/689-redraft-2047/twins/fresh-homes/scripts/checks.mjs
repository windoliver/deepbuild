import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checks, runLanes } from './lanes.mjs';

// Planted wrong program for #689's blind redraft (tests/acceptance/689-redraft-2047/README.md): the check workload
// gives its lanes a rustup and a Cargo home of this run's own, empty, so a lane's cargo finds no toolchain and would
// download one on every run.
process.env.RUSTUP_HOME = mkdtempSync(join(tmpdir(), 'deep-rustup-'));
process.env.CARGO_HOME = mkdtempSync(join(tmpdir(), 'deep-cargo-'));
process.exitCode = runLanes(checks);
