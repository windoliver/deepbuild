import { checks, runLanes } from './lanes.mjs';

// scripts/preflight alone names the kept results this run may read and keep (#3296; scripts/proof-kept.mjs).
const kept = process.argv.find((arg) => arg.startsWith('--kept=')), tree = process.argv.find((arg) => arg.startsWith('--tree='));
process.exitCode = runLanes(checks, kept && { kept: JSON.parse(kept.slice(7)), tree: tree?.slice(7) });
