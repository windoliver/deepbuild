# Twins for the 3510 tests

One planted wrong program, laid whole over `scripts/proof-binaries.mjs`. It is the merge base's file (`b48a47db7`) with
one rule changed and nothing else: same exports, same build, same `BLOCKED` lines. It replaces a file of the product,
never a file under `tests/`. It was run against this suite in this job's scratch folder and failed the tests named, at
their assertions (`../BASE-FAILURE.txt`).

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3510.a06361ca` | `fixed-wait` | `scripts/proof-binaries.mjs` | `buildBinaries` asks `acquire('build', { wait: 0.05 })`: a fixed deadline 0.05 minutes (3 s) after the request joins the line, whether or not build grants change hands meanwhile, and whatever `DEEP_TEST_GRANT_STALL` says. On that deadline it throws `INCONCLUSIVE no grant: no build grant came within 0.05 min for test binaries` | `moving-line.test.mjs`: behind the moving line the call throws `INCONCLUSIVE no grant` after about 3 s, where the test requires that it threw nothing |
| `#3510.a06361ca` | `leaves-line` | `scripts/proof-binaries.mjs`, by its lines (`leaves-line/lines.json`), anchored on `if (!names.length) return bin;`, a line the merge base and the change share | before the call's own request, `buildBinaries` asks `acquire('build', { wait: 0.05 })`, a fixed 0.05-minute wait whether or not grants change hands, and on its deadline throws `INCONCLUSIVE no grant: no build grant came within 0.05 min for test binaries`; a grant it does get it releases, and the change's own request follows | `moving-line.test.mjs`: behind the moving line the call throws `INCONCLUSIVE no grant` after about 3 s, where the test requires that it threw nothing. It maps `#3510.a06361ca` in place of the whole-file `fixed-wait`, which went stale as main moved |
| `#3510.773f906e` | `fixed-wait` | the same file | the same rule | `drain.test.mjs`: the holders keep every slot for 8 s after the call joined the line, so the call throws `INCONCLUSIVE no grant` after about 3 s, before any slot comes free |

The issue's words for both criteria are "a planted `proof-binaries.mjs` that waits a fixed 0.05 min", in the second
with the setting at 0.2. So the twin's wait is the literal 0.05 and reads no setting: a twin that read
`DEEP_TEST_GRANT_STALL` as its fixed wait would wait 12 s in the drain test, outlast the holders' 8 s and pass it.

`#3510.7fd1b181` and `#3510.9618ba88` have no twin: each fails on the merge base at its assertion (`wait: 30` logged,
not `stall: 720`; still waiting at the 5-minute bound). `fixed-wait` happens to fail both too. `#3510.87170af2` is
regression protection: the merge base and the twin both pass it, as the issue says.

Both tests with a twin pass on the merge base, whose 30-minute wait outlasts either line. The twin is their only proof
of failing first.
