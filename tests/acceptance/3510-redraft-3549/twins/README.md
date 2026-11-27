# Planted twin of the redraft (#3510 under #3549)

`fixed-wait` is the first draft's twin of the same name (`tests/acceptance/3510/twins/fixed-wait/`), kept here as its
wrong lines (`lines.json`, the line form the twins lint asks for): `buildBinaries` asks `acquire('build', { wait: 0.05 })`,
a fixed wait, whether or not grants change hands. `#3510.773f906e` (`drain.test.mjs`) passes on the merge base, whose
30-minute wait outlasts its 8 s, so this twin is its wrong program: the call leaves the line at 0.05 min with
`INCONCLUSIVE no grant: no build grant came within 0.05 min for test binaries`. `#3510.9618ba88` fails on the merge base
at its criterion, and `#3510.87170af2` is regression protection.
