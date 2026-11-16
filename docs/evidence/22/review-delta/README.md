# #22 review delta: which exception holds a session's folded asks

The final review of 18fffd08e found that rows from the hub's `inbox.read` carried no `holder` field, so the app took
every exception in a session for its "keeps asking": an unrelated exception waiting for its batch kept a folded ask
from a panel, folded the session's next ask, and on closing released the folded ones.

- `failing-first-holder.txt`: the asks test (`timing.test.ts`, "an inbox row says whether it is its session's
  \"keeps asking\" exception…") before the fix: no row is marked the holder.
- `mutant-holder-panel.txt`: the app test `only_the_keeps_asking_exception_the_hub_reads_holds_folded_asks` against
  `holds()` taking any exception for a holder: it fails, the folded ask kept from the panel.
- `passing-holder-app.txt`, `passing-holder-asks.txt`: after the fix, deep-app's lib tests (116) and the asks
  package's tests (82) pass.

The fix: each `InboxRow` carries `holder` (the core's `Ask.fold`), and the app's `holds()` reads only that.
