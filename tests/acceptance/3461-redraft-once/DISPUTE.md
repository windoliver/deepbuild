# Dispute: #3461's once test compares against a recording made with no canvas core built

**The first draft's test fails on the merge base's own program wherever `deep-show` is built.** `tests/acceptance/3461/once.test.ts` (`#3461.a80d1545`, "Every command given each of its flags once prints and exits as on the merge base") compares each of 42 commands with `fixtures/base-once.json`, which the blind job recorded in a checkout with no Rust builds under `target/`. Its README's open question 4 says so: the `deep export`, `deep kinds` and `deep doctor --json` rows depend on what is built there.

The proof lanes' checkout has `target/debug/deep-show`. The before lane on the work (`1e8281f8f`) reads:

```
FAIL before: tests/acceptance/3461/once.test.ts › #3461.a80d1545 ...: fails on the change (AssertionError: 3 of 42 commands given each flag once print or exit otherwise than on the merge base:)
deep export --document <tmp>/doc.json --still 0 --out <tmp>/still.png: stderr "deep export: No canvas core is built under <checkout>/target; ..." on the merge base, "deep export: the canvas core drew no still: ..." now
deep kinds --dump <tmp>/dump: code 3 on the merge base, 0 now
deep kinds --diff <tmp>/doc.json <tmp>/other.json: code 3 on the merge base, 0 now
```

With that `deep-show` copied into the work's checkout, the test fails with the same three rows on the work and on the same checkout with `packages/cli/src/main.ts` put back to the merge base's (`git show origin/main:packages/cli/src/main.ts`, the CLI rebuilt): one run each. With no `deep-show` there, it passes on the work. So the three rows read what is built, not the change.

**The redraft.** A fresh run of the blind job wrote `tests/acceptance/3461-redraft-once/` (commit `fd1cc5918`, cherry-picked as `d759bc084`). It was given #3461, the design, the base `1b4929ae7` and the frozen suite. It never saw the work, the diff or this dispute. Its test builds the merge base's program from `git archive` under `target/`, pointed at the checkout's own `target/`, and runs the same 42 commands under both programs in worlds of the same shape, so both see the same Rust builds or none (REDRAFT.md).

- On the base: 1 of 1 passes (`BASE-RESULTS.txt`), as a criterion that holds on the base does.
- On the work at `d759bc084`: one run, `Tests 1 passed (1)`.
- On the twin `once-refused` (`twins/once-refused/lines.json`, the first draft's wrong lines) laid over the work: one run fails at the deltas assertion, "22 of 42 commands given each flag once print or exit otherwise than on the merge base".

Not run: the redraft in a checkout with `deep-show` built by cargo (the blind job ran it with a stub at that path, and the lanes run it with the real one), and Linux.

## Your call, once

- **Swap in the redraft** (recommended): it runs in the first draft's place. `scripts/lanes-lists.mjs` maps `tests/acceptance/3461/once.test.ts` to the redraft and moves it to `byHand`; the signed approval tag on that commit is owed with it.
- **A third draft**: name the reading to change, and a blind job writes the criterion's test again on that ruling.

Neither draft was edited.
