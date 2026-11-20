# Review of the final diff at ae0ce9bae

A fresh agent reviewed `git diff 9550dc0f0...ae0ce9bae` (code only) and found nothing that blocks. It raised three points:

1. **The app and the core folded different asks.** The core folds every ask except the "keeps asking" exception itself into that open exception, a guard's exception among them. The app never folded any exception of the core's raised while it ran, so a panel's `needs_you()` missed such an ask under its exception until the app read the inbox again. Fixed in `crates/deep-app/src/record.rs`: only the holder never folds.
   - Test `another_exception_of_the_cores_folds_into_an_open_keeps_asking_as_in_the_core` failed first (`failing-first-fold.txt`: queued, no holder) and passes now.
2. **`answer()` could let go of the asks' lock while the decision it saves was still being written**, when the record refused the answer at once. `Promise.all` rejected early. Fixed in `packages/asks/src/index.ts`: the answer and its decision both settle before the first refusal is thrown.
   - Test "settles only once the decision it saves is written, even when the record refuses the answer itself" failed first (`failing-first-answer-lock.txt`) and passes now.
   - `saveAt`'s own decision-and-overrule writes keep `Promise.all`: no test reaches a refused overrule, so that path is unchanged and disclosed.
3. **A failed shared FULL commit refuses every FULL append made in that turn**, and marks each of their sessions lost. Already disclosed in the PR as "a failed commit rejects them together". Not changed.

After both fixes, on Linux: deep-app's lib tests 122/122. `packages/asks/test` and `packages/record/test/record.test.ts`: 168/168. `packages/hub/test/asleep.test.ts`: 3/3, after a workspace build. Clippy in deep-app's sources warns only on main's lines (`gpu_view.rs:12`, `views.rs:829`).

## Review of that delta (dbf0c11f1)

A fresh agent found nothing that blocks and one point, fixed: with `!exception` swapped for `!holder`, the count branch (a fixture's record, or a live one before its first batch) also folded the core's own exceptions. The core shows those on a card of their own, so a guard's override drew quiet as "folded". The count branch excludes them again; only the fold into an open "keeps asking" now takes them, as the core does.
- Test `an_exception_of_the_cores_never_folds_by_count` failed first (`failing-first-count.txt`: folded) and passes now. deep-app's lib tests 123/123.
