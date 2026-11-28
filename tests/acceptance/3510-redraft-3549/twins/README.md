# Planted twin of the redraft (#3510 under #3549)

`fixed-wait` is the first draft's twin of the same name (`tests/acceptance/3510/twins/fixed-wait/`), kept here as its
wrong lines (`lines.json`, the line form the twins lint asks for): `buildBinaries` asks `acquire('build', { wait: 0.05 })`,
a fixed wait, whether or not grants change hands. `#3510.773f906e` (`drain.test.mjs`) passes on the merge base, whose
30-minute wait outlasts its 8 s, so this twin is its wrong program: the call leaves the line at 0.05 min with
`INCONCLUSIVE no grant: no build grant came within 0.05 min for test binaries`. `#3510.9618ba88` fails on the merge base
at its criterion, and `#3510.87170af2` is regression protection.

| Criterion | Twin | Edits | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3510.87170af2` | `own-request` | `scripts/proof-binaries.mjs`, by its lines (`own-request/lines.json`), anchored on `if (!names.length) return bin;`, a line the merge base and the change share | `buildBinaries` drops its caller's grant (`delete process.env.DEEP_THROTTLE`) before it asks, so a call made under a build grant does not reuse it and makes a second, top-level request, which waits behind the full class | `under-grant.test.mjs`: the call is still waiting when the test's 10-minute bound runs out, where the test requires that it returned without waiting |
