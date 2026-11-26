# The twin for #3461's criterion a80d1545 (redraft)

No implementation of #3461 existed for this job to read, so no twin folder is here. The twin is the change with exactly
one rule broken as below and nothing else: same usage lines, same exits for repeats, same calls. It is kept as its wrong
lines in `twins/once-refused/lines.json` (`scripts/twins-lint.mjs`), applied to the change's file when the before lane
runs; it never touches a file under `tests/`.

| Criterion | Twin | Would change | The one rule it breaks | Where `once.test.ts` fails |
|---|---|---|---|---|
| `#3461.a80d1545` | `once-refused` | The change's flag reader: the shared one if the change reads flags in one place, else `packages/hub/src/land-command.ts` (the reader of `deep land`, `deep land judge` and `deep work`, as the issue names it at the base) | A flag given once is read as given twice (for example, the reader counts a flag's uses in the arguments and compares with `>= 1` where `> 1` is meant, or looks for a second use from the flag's own place, finding the first), so a command given one of its value flags once prints its usage and exits 2 | The second `expect`: "N of 42 commands given each flag once print or exit otherwise than on the merge base", one line per form, e.g. `deep land --repo <tmp>/repo --json (deep land): code 3 on the merge base, 2 in this checkout; stderr "…" on the merge base, "Usage: deep land …" in this checkout`. The merge base passes, since it is the reference |

## Checked here

A plant was run on this job's worktree at the base: in the built `packages/hub/dist/land-command.js`, the `flag` reader
was changed to `i >= 0 && args.indexOf(name, i) < 0 ? args[i + 1] : undefined` (it looks for a second use from the
flag's own place and finds the first), standing in for `once-refused` on the land and work rows. The merge base's
program, built from `git archive` of the pinned commit under `target/acceptance-3461-base/`, was untouched. The test
failed at the deltas assertion: "3 of 42 commands …", listing `deep land`, `deep land judge` and `deep work --once`
(code 3 on the merge base, 2 and their usage in this checkout). The file was put back byte for byte (`cmp` against a
saved copy). The run's output is in `../BASE-RESULTS.txt`.
