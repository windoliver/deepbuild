# Blind redraft of #1115's two no-grant tests of an affected.mjs run, which #3478's stall contradicts

`tests/acceptance/1115-redraft-2833/no-grant.test.mjs` fills the test class with another session's holders and expects an `affected.mjs` run to end with no grant within seconds. Its run's wait is short because `tests/acceptance/1115/helpers.mjs`'s throttle shim rewrites the `--wait` argument of a `throttle.mjs test` call to 0.02 minutes. #3478 has the run ask `throttle.mjs test --stall 720`: there is no `--wait` argument for the shim to rewrite, the run keeps its place until the holders leave (280 s), then gets a grant and reads `PASS`, and the two `#1115.1f2f1fa0` tests of an `affected.mjs` run fail. This folder redrafts those two from #1115's criterion (as `tests/acceptance/1115/README.md` quotes it), #3478's text, the design (Dogfooding; `docs/parallel-proof.md` section 6) and the base `1b4929ae7`, drafted by a blind job.

The original file is deleted, as #2833 retired its originals (the owner's approval, 2026-11-25, on PR #3483, recorded in #3478's Scope); git history keeps it. Run with:

```
node --test tests/acceptance/1115-redraft-3478/no-grant.test.mjs
```

`no-grant.test.mjs` imports `tests/acceptance/1115/helpers.mjs` and `tests/acceptance/1115-redraft-2833/helpers.mjs` (`testLimit()`, #2833's surface), both unchanged. There is no helper file here.

## What each redraft replaces

One change serves both: the run under test gets `DEEP_TEST_GRANT_STALL=0.02` in its environment, the means #3478 names for setting the stall's bound in tests, and `expectFilesInconclusive` also requires the run's line `INCONCLUSIVE no grant: no test grant changed hands within 0.02 min`, #3478's line for a stalled test grant. Test names, criterion IDs, fixtures and every other assertion are the originals' (`diff ../1115-redraft-2833/no-grant.test.mjs no-grant.test.mjs`).

| Original (path › test) | Criterion | Why the old expectation no longer holds | Replaced by |
|---|---|---|---|
| `1115-redraft-2833/no-grant.test.mjs` › #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE, not FAIL: its files read so in affected.mjs, and a later run with a grant passes | #1115.1f2f1fa0 | The shim shortens a `--wait` the run no longer passes; the run waits out the 280 s holders and reads `PASS affected: …` (exit 0) | `no-grant.test.mjs` › same name, the run's stall bound set to 0.02 min by `DEEP_TEST_GRANT_STALL` |
| `1115-redraft-2833/no-grant.test.mjs` › #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE when a line of output came before the throttle's | #1115.1f2f1fa0 | The same | `no-grant.test.mjs` › same name, the same way |

The added line is what makes the redraft fail on the merge base. Without it the redraft would pass there as the original does: the base ignores `DEEP_TEST_GRANT_STALL`, asks `--wait 30`, and the shim, still in the tree for the preamble line and the unit lane, shortens that to 0.02 minutes. With it, the test shows that the wait which ended with no grant was the run's stall at the bound the test set, not a wait the shim shortened.

The shim stays in the fixture tree (`shimThrottle: true`) because the second test needs its line of output before the throttle's (`T1115_PREAMBLE`). On the change it changes nothing of the run's request.

## Kept as they are

- `no-grant.test.mjs` › #1115.1f2f1fa0 a unit lane whose vitest job ended with no grant reads INCONCLUSIVE, not FAIL: carried with its name, criterion ID and assertions unchanged. A lane's vitest job still asks `throttle.mjs test --wait 30` (lane commands are out of #3478's scope), which the shim shortens as before.
- `tests/acceptance/1115/helpers.mjs`, shim included, and `tests/acceptance/1115-redraft-2833/helpers.mjs`.
- `tests/acceptance/1115/twins.json`: the redrafts keep the criterion ID, so it maps them too.
- Not kept: `tests/acceptance/1115-redraft-2833/no-grant.test.mjs`, the original here, is deleted. Its own original, `tests/acceptance/1115/no-grant.test.mjs`, was already gone from the base: the #2833 proposal (`7280d78f8`) retired it in favour of that redraft.

## On the base and on the change

Run on the Spark (Linux, 20 cores, 1-minute load about 20 to 40), the file once per program, each in a memory-capped transient unit (`systemd-run --user -p AppArmorProfile=claude-desktop -p MemoryMax=24G -p MemorySwapMax=2G`, `CARGO_BUILD_JOBS=2`), one at a time. The tests point `HOME` at a sandbox, so the machine's own throttle table wasn't touched.

On the base `1b4929ae7` the two redrafted tests fail for the expected reason, the base's run waiting on a fixed wait and not a stall:

```
$ node --test tests/acceptance/1115-redraft-3478/no-grant.test.mjs
✖ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE, not FAIL: its files read so in affected.mjs, and a later run with a grant passes (5692.849692ms)
    no "INCONCLUSIVE no grant: no test grant changed hands within 0.02 min" line: the run's wait was not its stall of 0.02 min
    stdout:
    INCONCLUSIVE no grant: no test grant came within 0.02 min
✖ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE when a line of output came before the throttle's (5365.754821ms)
    no "INCONCLUSIVE no grant: no test grant changed hands within 0.02 min" line: the run's wait was not its stall of 0.02 min
    stdout:
    INCONCLUSIVE no grant: no test grant came within 0.02 min
✔ #1115.1f2f1fa0 a unit lane whose vitest job ended with no grant reads INCONCLUSIVE, not FAIL (18690.878036ms)
ℹ pass 1
ℹ fail 2
```

On the change (`bb9a70a22`) all three pass:

```
$ node --test tests/acceptance/1115-redraft-3478/no-grant.test.mjs
✔ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE, not FAIL: its files read so in affected.mjs, and a later run with a grant passes (16128.04976ms)
✔ #1115.1f2f1fa0 a vitest job ended with no grant reads INCONCLUSIVE when a line of output came before the throttle's (5096.735183ms)
✔ #1115.1f2f1fa0 a unit lane whose vitest job ended with no grant reads INCONCLUSIVE, not FAIL (15297.100071ms)
ℹ pass 3
ℹ fail 0
```

The originals on the change, from the coordinator's run of `tests/acceptance/1115-redraft-2833/no-grant.test.mjs`: the two tests of an `affected.mjs` run fail after 289 s each on `the summary of a run with no grant reads otherwise` (the run exited 0), the unit lane's passes.

The wrong programs for #1115's criterion itself (a job with no grant read as `FAIL` "reported no test") are #1115's twins, unchanged; the redrafts' original assertions still catch them. The darwin branch of `testLimit()` is unrun here (no Mac run).
