# #22: a folded ask waits for its exception, whichever session of its thread holds it

Found by the independent review of the merges of main 0f34aacbe and d4cef00fb (head 3f2f86464). It was a gap in this
PR's own code, not something either merge introduced. The asks core folds a thread's further asks into that thread's
"keeps asking" exception (`threadOf`), and a session started in another's place has the same thread. The app matched a
folded ask to its exception by session, so:

- an ask raised live in the second session wasn't folded at all (queued);
- a folded ask the hub read for the second session reached a panel before its exception was in sight (M1's rule).

The fix: each inbox row names the exception that holds it (`folded`, from the core's own `Ask.folded`; null on every
other row). The app keeps a folded ask from a panel until that exception is in sight. It folds a live ask by its thread
and names the exception it folds into, and releases asks by the exception that closed.

| File | What it shows |
| --- | --- |
| failing-first-folded-asks.txt | the new asks test fails before the fix: the core folds S2's ask (status folded) but the row names no exception |
| failing-first-folded-app.txt | the new app test fails before the fix: the app takes S4's ask for queued, not folded |
| passing-folded-asks.txt | asks timing tests with the fix: 39/39 |
| passing-folded-app.txt | deep-app lib tests with the fix: 117/117; clippy warnings are all outside deep-app's sources |
| mutant-session-only-held-out.txt | the fix with `held_out` back to the session-only match: the new app test fails on "nothing held by x1 before x1 is in sight" |

The app test was renamed after its failing run, to `a_panel_waits_for_the_exception_of_another_session_on_the_thread`,
so it formats under main's rustfmt; its body is unchanged.
