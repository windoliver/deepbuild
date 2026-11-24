# Dispute: #3236 criterion 8, the first draft's count of announcements

This redraft exists because of this dispute. The first draft is `tests/acceptance/3236/ac8-appkit.test.ts` with its client
`appkit.swift`, from the blind suite's commit `7983870d2` (written blind on base `f8c6cff82`).

**What fails.** The client adds `AXAnnouncementRequested` to its observer once for the application element and once for
each window (`for element in [app(pid)] + found`). AccessKit posts an announcement on the window, so both registrations
call back, and the client lists every announcement twice. A window that announces each landing once, as the criterion
asks, fails:

```
the live window's announcements through AppKit are ["x 0 seconds, y 40 metres","x 0 seconds, y 40 metres","x 1 seconds,
y 37 metres","x 1 seconds, y 37 metres", … (22)]; the replica's are ["x 0 seconds, y 40 metres","x 1 seconds, y 37 metres", … (11)]
```

Counted over one `deep-show live` window with the same walk, by registration: the application alone, 11 callbacks; the
window alone, 11; both, 22, each text twice. So no window that announces each landing once passes.

The draft's other reading, BLOCKED with every element an `AXApplication`, was the machine's: each of those runs (04:21 to
05:00 EST, Nov 23) was behind a locked screen (`com.apple.screenIsLocked` at 04:11:40, its grace over at 04:16:40, the display
off until 08:28:18). Read the same way behind the next lock (21:15Z), Finder's and Ghostty's windows answered as
`AXApplication` too; unlocked, all three answered as `AXWindow`.

**How the redraft was made.** One job, given only the issue, the design and a checkout of the base, never the work, the
first draft, the diff or this dispute, wrote this folder from criterion 8 alone. Its client registers once, on the
application, and its own stand-in windows show it hears each announcement as many times as it is posted.

**Both on the work** (`f665b4c27`, Mac17,10, unlocked, Nov 23):

| Draft | Verdict |
|---|---|
| `3236/ac8-appkit.test.ts` | FAIL, as above; its element `scatter` holds the replica's value |
| `3236-redraft-ac8/live.test.ts` | PASS |
| `3236-redraft-ac8/client.test.ts` (its client and judge over stand-in windows) | 10 of 10 |

**What runs.** `scripts/lanes-lists.mjs` runs this folder alone and keeps the first draft's file by hand until the owner
swaps them. No test was edited.
