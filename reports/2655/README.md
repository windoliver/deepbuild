# #2655: saved proof

The issue's Proof line asks for the load lists, the heap and the copy count on the merge base and on the change, and the planted server failing. They are the outputs of `tests/acceptance/2655/`, run unchanged on both trees. Merge base: main at `9ae04c6cd`.

- [blind-brief.md](blind-brief.md): what the job that wrote the suite was given. It saw the issue, the design and the base checkout, and no work.
- [acceptance.sha256](acceptance.sha256): the suite's nine files as that job delivered them. `shasum -a 256 -c reports/2655/acceptance.sha256` from `tests/acceptance/2655/` shows they are unchanged.
- [base/](base/): each file's run on the base, before any change. `waits-unit.txt` is the one new case of `packages/hub/test/waits.test.ts`, failing there.
- [change/](change/): the same runs on the change. `history-rerun.txt` and `start-60-rounds.txt` are second runs of two files, taken after the lane run read them otherwise under load.
- [affected.txt](affected.txt): `node scripts/affected.mjs` on the change: its summary lines, its lines for this suite, and a count of the rest.
- [recheck.txt](recheck.txt): the 35 files of that run whose failures named no timeout, start or build, run once on each tree.

| File | Criterion | On the base | On the change |
|---|---|---|---|
| `loads.txt` | AC1 | fails, naming 7 contracts modules on the main thread; no evidence module | passes: `json.js` alone |
| `tls.txt` | AC2 | fails: thread 0 loads `node:tls` with no member | passes; a joined client is served as on the base |
| `start.txt` | AC3 | fails: 0.00 MB under; instructions INCONCLUSIVE, base against itself | passes: 0.60 MB under, instructions −5.18% over 20 pairs |
| `line-copies.txt` | AC4 | fails: 2 copies; the planted server is BLOCKED, the base has none | passes: 1 copy, the event is the base's, the planted server fails naming lines 2 and 3 |
| `history.txt` | AC5 | fails: 190.87 MB | passes: 15.79 MB, "about 3 s" on both |

The change's five files ran once, in one test grant of `scripts/throttle.mjs`, on a Mac17,10 on mains power at a load average of 45 to 64, with `DEEP_2655_BASE` naming the built base. Neither the heap after two full collections nor the instruction count is a timing. Paths under the scratch folder read `<scratch>`.

AC1's sentence about the merge base does not hold as written: #2332 (`c332f7fb0`) moved the adapter registry out of `hookmap.ts` after the issue was read at `ccbdefd1f`, so today's base loads no evidence module on the main thread. It still loaded the validator, which is what the test names.
