# 0014: The kit ledger lint, a vendored file with no row, and a taste criterion's file

Status: accepted (#3715). The comments these came from were taken out to bring their scripts back under the comment ratchet's ceilings; `vendor/gpui-pre-apple/upstream/README.md` states #3622's rules for the carried patches, and `docs/parallel-proof.md` and the suites' own `DISPUTE-3694.md` and `lane.json` files state the lanes' lists. The decisions below are the ones written nowhere else.

## The kit ledger lint

- **The lint lane holds the committed kit ledger to the tree's own seal.** `scripts/kit-ledger.mjs`. A release build seals only the canvas modules its embedded ledger holds as PASS at their digests (`crates/deep-show/src/kit/ledger.rs`), while every lane starts debug builds, which seal nothing. So the script reads each module's digest from a debug deep-show's `kinds --dump` and holds `crates/deep-show/kit-ledger.json` to it (#3532).
- **A module with no record, a record of another digest, or a record at the tree's digest whose verdict isn't PASS fails.** `scripts/kit-ledger.mjs`. Each is named with the ledger's digest and the tree's, or with the verdict.
- **It builds the debug deep-show first, never a release.** `scripts/kit-ledger.mjs`. The build is cargo's no-op on a built tree.
- **It prints one line a finding and exits 0, 1 or 3.** `scripts/kit-ledger.mjs`, `blocked`. `node scripts/kit-ledger.mjs [--root <tree>]` prints `PASS kit ledger: ...`, one `FAIL kit ledger: <module>: ...` line a finding, or `BLOCKED kit ledger: ...`, and exits 3 when it can't build or dump.

## The carried patches

- **A changed file with no row is named at its first hunk's line.** `scripts/vendor-rebase.mjs`, the `no row in the carried-patch table` finding. The line is the one a plant names (#3622).

## The lanes' lists

- **#3605's criterion 9 file runs by hand.** `scripts/lanes.mjs`, `byHand` (`tests/acceptance/3605/ac09-shown.test.ts`). The criterion ends INCONCLUSIVE until the owner's taste call on its frames.
