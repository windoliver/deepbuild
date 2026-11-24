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

## The review of 57c07567c

Nothing blocking; two more places where the app's live fold differed from the core's, both older than these commits:

1. The core never folds a block someone else owns (`isTheirs`: an unblock whose owner isn't its actor), nor counts it;
   the app folded it. Now it neither counts nor folds.
2. The core folds a live ask only into an exception it already raised; its count runs in `raise()`, before the ask,
   at the settings' threshold. The app folded by its own count of five in any record. The count now applies only in
   a record with no list and no showing of the core's, a fixture's (#338).

| File | What it shows |
| --- | --- |
| failing-first-owner-count.txt | before the change: someone else's block folds into x1, and a hub with a list folds a sixth ask by count |
| passing-owner-count.txt | deep-app lib tests with the change: 119/119; clippy warnings all outside deep-app's sources |
| mutant-no-owner.txt | without the owner check, someone else's block folds and the test fails |
| mutant-count-always.txt | with the count on in any record, the listed hub's sixth ask folds and the test fails |
| mutant-no-scope.txt | without the scope check, another scope's ask folds and the test fails |

## The final review of 9f2f36c99

A fresh agent's review of the whole final diff found nothing that blocks, one thing to fix, and two notes.

The fix: when an exception closed with "leave them to their defaults", the app kept every ask it held folded. The core
(`index.ts`, the close case: `a.folded === ask.handle && !a.shown`) gives an ask the exception hadn't shown its own card
on any close, so a panel could name that ask before its batch. The app now releases, on any close, the asks the
exception hadn't shown; under "defaults" the shown ones stay inside it. This PR's own unit test
`asks_an_answered_exception_held_get_their_own_rows` asserted the old result for the unshown ask ("folded"); its
assertion is corrected to the core's ("queued"), which is the failing-first run below.

| File | What it shows |
| --- | --- |
| failing-first-defaults.txt | the corrected test fails before the fix: the unshown ask stays folded after "defaults" |
| passing-defaults.txt | deep-app lib tests with the fix: 119/119; clippy warnings all outside deep-app's sources |
| mutant-defaults-keep-all.txt | with "defaults" keeping every held ask folded, the test fails |
| mutant-defaults-release-all.txt | with "defaults" releasing the shown asks too, the test fails |

Notes, not fixed here: a brand-new hub whose first row list takes longer than the notifier's second can notify an
ask once by count and again when it is listed; and answer()'s pre-check covers today's refusals of ask.answered, so a
new schema limit on it would need the same check.
