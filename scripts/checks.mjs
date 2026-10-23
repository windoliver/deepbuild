import { checks, releaseChecks, runLanes } from './lanes.mjs';

process.exitCode = runLanes(process.argv.includes('--release') ? releaseChecks : checks);
