// #2173's blind redraft (#2047), the twin `unnamed`: a planted wrong program laid over scripts/repo-rules.mjs. Its deps
// lane still fails, and the run exits 1, but the line names neither the manifest nor the dependency. AC2's three tests
// fail on it at their assertion.
console.log('FAIL deps: a dependency has no entry in scripts/repo-rules.json\n  Fix: Remove it, or add it to scripts/repo-rules.json with why the task needs it.');
process.exitCode = 1;
