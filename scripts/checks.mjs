import { checks, runLanes } from './lanes.mjs';

process.exitCode = runLanes(checks);
