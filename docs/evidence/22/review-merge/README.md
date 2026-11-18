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

## The review of 902fe7224

An independent review of the fix found nothing that blocks and three things to fix, all done here:

1. The app took a session's thread only from starts after its read, so a session started in another's place before the
   read wasn't folded live. The events folded in before the read now give their sessions' threads too (`View::before`,
   pulled out of `fold_before` first with no change in behavior so a test can reach it).
2. The live fold matched by thread alone; the core's fold is one person's (thread, actor and scope) and never takes an
   agent's sign-in task. Inbox rows now say who raised them (`actor`, `scope`), the app records the same on rows it
   adds, and folds a live ask only as the core would. A row from an older hub, with neither, matches as before.
3. Nothing tested the release when the exception closes. The panel test now closes x1 and both asks it held come back.

| File | What it shows |
| --- | --- |
| failing-first-who-asks.txt | the asks test extended to `actor`/`scope` fails before the change: rows carry neither |
| failing-first-who-app.txt | the new app test fails before the change (refactor only): a session started before the read isn't folded live |
| passing-who-asks.txt | all asks tests with the change: 84/84 |
| passing-who-app.txt | deep-app lib tests with the change: 118/118; clippy warnings all outside deep-app's sources |
| mutant-no-actor.txt | without the actor and scope check, another actor's ask is folded and the test fails |
| mutant-no-sign-in.txt | with sign-in tasks allowed to fold, the test fails on the sign-in task |
| mutant-release-by-session.txt | with release back to a session match, the asks held in s2 and s4 stay folded and the panel test fails |
