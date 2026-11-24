# #1907 evidence: a journey check gives the same result after the trim

checks-journey has no production importer (reports/package-deep-audit.md), so no `deep` command or hub route reaches
it. The closest real surface is `journeyCheckKind(host)`, the `check.kind@1` fill a hub would load. `journey-e2e.mjs`
runs it with a real record, supervisor and evidence store, a real env-local stack (a small Node page) and Playwright's
Chromium, on two journeys: `cart`, which passes, and `cart-wrong`, whose end state expects `$19.00` where the page
shows `$18.00`. It prints each `CheckResult`, with temp paths, ports and evidence hashes swapped for placeholders.

`e2e.sh` runs it on base `ee05e7257` (a fresh GitHub clone, built) and on the change, diffs the two outputs, then runs
each build again as a noise check. `e2e-terminal.png` is that run in Terminal.app on 2026-11-20 (macOS arm64, Node
24.22.0, Playwright 1.64.1). `base.txt` and `change.txt` are its two outputs: identical.

| Journey | Base | Change |
|---|---|---|
| `cart` | passed, 4 tests run, 0 failures, 6 evidence | the same |
| `cart-wrong` | failed, 4 tests run, 1 failure (`cart-wrong › total-shown`: `toContainText('$19.00') failed: found '$18.00'`), 5 evidence | the same |

Noise seen: in an earlier run from Claude's terminal panel, the evidence list of `cart-wrong` differed between base and
change in which hashes it shares with `cart`. The base, run twice, differed from itself the same way: whether a
step's screenshot is byte-identical across the two journeys varies from run to run. The diff is of the placeholders'
order only. Counts, outcomes, failures and messages matched in every run.
