// #2173's blind redraft (#2047), the twin `hollow`: a planted wrong program laid over scripts/repo-rules.mjs. It is a
// repo-rules checker that no longer fails a dependency with no entry in scripts/repo-rules.json: its deps lane passes
// whatever the manifests name, and it exits 0. AC2's three tests fail on it at their assertion; AC1's test passes.
console.log('PASS deps: every dependency the manifests name is in scripts/repo-rules.json');
