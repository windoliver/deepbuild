# Evidence for #2013: the same points on the other CPU architecture

Criterion 1's second test (`tests/acceptance/2013/ac1-prune-same-points.test.ts`) compares this machine's scatters with
a record from the other CPU architecture, named by `DEEP_2013_OTHER_RECORD`.

| File | Made by |
|---|---|
| `points-darwin-arm64.json` | the test on the arm64 Mac, the binary built for `aarch64-apple-darwin` |
| `points-darwin-x64.json` | the same test file under an x86_64 Node 24.22.0, the binary built for `x86_64-apple-darwin`, both run under Rosetta on that Mac |

Both hold the garden document and each scatter's elements as text. The two `points` are equal, and the test passes with
`DEEP_2013_OTHER_RECORD` set to the x64 record. The x64 run is emulated, not a second physical machine.
