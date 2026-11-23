# The live window through AppKit: what stopped it being read, and the fix (Mac17,10, macOS 27.2, November 23, 2026)

Three separate things, each read from outside the process.

**1. A locked screen.** Every BLOCKED reading (04:14 to 05:00 EST) was behind a lock: `loginwindow` logs
`startScreenLock … kLWLockFromDisplayDim` at 04:11:40, and the display came back on at 08:28:18. A control, taken when the
screen next locked by itself (21:15:25Z), read the roles of three processes' windows the same way:

| Window | Unlocked (20:06:57Z) | Locked, display asleep (21:15:25Z) |
|---|---|---|
| `deep-show live` | `AXWindow` over 2 groups, 2 texts, 3 buttons | `AXApplication` only |
| Finder | `AXWindow`, `AXWindow`, `AXScrollArea` | `AXApplication`, `AXApplication`, `AXScrollArea` |
| Ghostty | `AXWindow` | `AXApplication` |

Nothing in `deep-show` can answer then. The #3236 binary and the first draft's own client, unchanged, read the tree as
soon as the screen was unlocked.

**2. A window nobody can see.** Unlocked, the first draft's run at 21:07Z got past its BLOCKED line and held the value but
heard nothing. GPUI gives AccessKit a frame's tree, and has it announce, when it draws the frame, and the display asks for
no frame of a covered or minimized window:

| `deep-show live`, the walk of 11 landings | Before | After `f665b4c27` |
|---|---|---|
| shown | 11 announcements | 11 |
| an opaque panel over it | 0 | not run |
| minimized as soon as it lists | 0, and no identified element | 11, and the value (`tests/live-window-hidden.test.ts`) |

`live.rs` now draws the window at open, once AccessKit's adapter is active, and at each step. Without the draw at open
that test fails on the value alone; without the draw at each step, on the announcements alone.

**3. The first draft's client.** It registers for announcements on the application and on each window, so each is heard
twice: see `tests/acceptance/3236-redraft-ac8/DISPUTE.md`.
