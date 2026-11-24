# The live window through AppKit: what stopped it being read, and the fix (Mac17,10, macOS 27.2, November 23, 2026)

Three separate things, each read from outside the process.

**1. A locked screen.** Every BLOCKED reading (04:21 to 05:00 EST) was behind a lock: the display went off and
`loginwindow` sent `com.apple.screenIsLocked` at 04:11:40, its password grace ended at 04:16:40, and the display stayed off
until 08:28:18. A control, taken when the screen next locked by itself (21:15:25Z), read the roles of three processes'
windows the same way:

| Window | Unlocked (20:06:57Z) | Locked, display asleep (21:15:25Z) |
|---|---|---|
| `deep-show live` | `AXWindow` over 2 groups, 2 texts, 3 buttons | `AXApplication` only |
| Finder | `AXWindow`, `AXWindow`, `AXScrollArea` | `AXApplication`, `AXApplication`, `AXScrollArea` |
| Ghostty | `AXWindow` | `AXApplication` |

Nothing in `deep-show` can answer then. The #3236 binary and the first draft's own client, unchanged, read the tree as
soon as the screen was unlocked.

**2. A window nobody can see.** Unlocked, the first draft's run at 21:07Z got past its BLOCKED line and held the value but
heard nothing. Whether its window was covered then wasn't recorded; covering or minimizing one gives exactly that. GPUI gives
AccessKit a frame's tree, and has it announce, when it draws the frame, and the display asks for no frame of a covered or
minimized window:

| `deep-show live`, the walk of 11 landings | Before (#3236's 05:12 build; `ee08d262a` where named) | After (`f665b4c27`) |
|---|---|---|
| left as it opened | 11 announcements (3 runs); 0 (the 21:07Z run, `ee08d262a`) | 11 (the redraft's run) |
| an opaque panel over it | 0 | 11 (02:43Z, load 236) |
| minimized as soon as it lists | 0, and no identified element (`ee08d262a` too) | 11, and the value (`tests/live-window-hidden.test.ts`) |

`live.rs` now draws the window at open, once AccessKit's adapter is active, and at each step. Without the draw at open
that test fails on the value alone; without the draw at each step, on the announcements alone.

**3. The first draft's client.** It registers for announcements on the application and on each window, so each is heard
twice: see `tests/acceptance/3236-redraft-ac8/DISPUTE.md`.
