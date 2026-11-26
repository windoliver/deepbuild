# #3282: an open taste call's time in the list, before and after

Pictures from the replica (`deep-drive`, plain build) on #3282's acceptance world: five open taste calls in shop and a
session in docs, opened at 960×640, where the list is 260 wide. Taken headless at scale 2 on macOS arm64.

- `before-*.png`: main 8c984adb9's `rows.rs` and `views.rs`. Each call row draws its time 0 wide; only the state word shows.
- `after-*.png`: this change. Each call row draws when its recommended answer applies (Thu 16:32 to 16:36; the top row's matches
  the card's "Default: Blue header · at Thu 16:32"), and its question is cut to a few characters with a whole ellipsis. The session row in docs keeps
  "Reconciliation…" beside "finished", as before.

The card's time differs between the two windows because each world was made at the time of its run.
