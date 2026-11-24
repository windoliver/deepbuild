# The app's window read while nobody can see it (Mac17,10, macOS 27.2, November 23, 2026)

#3232's announcements rest on this. `deep-app` on a real hub, in a temporary home with two open asks, read from outside
its process through the Accessibility API. The screen was unlocked and the display awake before and after each reading:
behind a lock every element of every app answers as its application. Announcements are heard on the application element
alone, which calls back each one once.

## The two readings

The base is main at `a531a9bef`. "Hidden before the first ask" means nothing had asked for the tree when the window was
minimized, or covered by an opaque panel.

| The window | What the client gets | Base | With the fix |
|---|---|---|---|
| shown (the control) | the tree | 42 nodes, 31 identified | 42, 31 |
| shown, an ask answered | announced | once, "1 ask needs you" | once, the same |
| minimized before the first ask | the tree | 6 nodes, 0 identified, for 12 s | 42, 31 at the first read, 19 ms |
| covered before the first ask | the tree | 7 nodes, 0 identified, for 6 s | 42, 31 at the first read, 19 ms |
| minimized before the first ask, an ask answered | announced | not read yet | once, "1 ask needs you" |
| covered before the first ask, an ask answered | announced | 0 | once, "1 ask needs you" |
| read while shown, then minimized, the other ask answered | the count's line | still "1 ask needs you" after 10 s | "Nothing needs you" |
| the same | announced | 0, and no title or value change | once, "Nothing needs you" |

Minimized and then shown again, the window's pixels hold the ask that was answered meanwhile, and the next change after
it.

`deep-app` on main has no live region (#3232 adds the first one), so the announcement rows are a measuring build of each:
the list's count, `sidebar-count`, given its label as its value and made a polite live region. Nothing of it is committed:

```rust
.a11y_synthetic_children(|tree| {
    let node = tree.parent_node();
    let said = node.label().unwrap_or_default().to_owned();
    node.set_value(said);
    node.set_live(gpui_kit::accesskit::Live::Polite);
})
```

## Nothing is drawn or woken that wasn't (#1551)

The real app with nothing changing, its wakeups and CPU time read from `proc_pid_rusage`, one run each. A display link left
running would add 60 wakeups a second or more.

| The window, still | Base | With the fix |
|---|---|---|
| shown, no client, 15 s | 17.0 wakeups/s, 6.5 ms/s | 15.0, 5.7 |
| minimized, no client, 20 s | 11.9, 4.2 | 11.6, 3.6 |
| minimized, a client connected, 20 s | 11.7, 4.4 | 11.9, 4.5 |

`crates/deep-app/tests/unseen.rs` holds the same on a simulated clock: 20 changes to a hidden window with no client draw
nothing, a client's hidden window with nothing new is drawn in none of 60 s, and 1,000 changes in a second are drawn at
most 11 times, the last one included. #1551's own suite builds `deep-show` in release and wasn't run; no file of
`vendor/gpui-pre-macos` changes.

## What a draw nobody sees must not count as

The question card arms a taste call's accepting option once each picture was drawn whole for the arming interval (#3234),
so a hidden draw would have counted a picture nobody saw. The card now counts a draw only while `Window::is_visible`, and
GPUI draws the window anew as it is shown, so the first frame a person sees is the first that counts. What else the app
derives from a draw was read, not run: unread marks and views reported shown read the window's state from the OS, and
no view asks for a frame in a loop (a next-frame callback waits for the next change).

## The tests

| | Without it | With it |
|---|---|---|
| `crates/deep-app/tests/unseen.rs`, on the fix's call taken out | 3 of 5 fail: the client's tree is `None`, not `Some("opened")`; 0 draws, not 1; 0 draws of 1,000 changes | 5 pass |
| the same, on the fresh draw at being shown taken out | 1 of 5 fails: no draw for the first frame seen | 5 pass |
| `card::tests`, on the guard taken out | 1 of 2 fails: 0 of 1 pictures left, not 1 | 2 pass |
| `tests/unseen-window.test.mjs`, the real app minimized before a client asks, on the fix's call taken out | fails: 6 nodes, no ask named, 30 s later the same | passes |
| the same, behind a lock | | skipped, `BLOCKED: the screen is locked` |

The real-app row was run before its waits moved from the test into its client and before the fresh draw and the guard;
its final form is not run yet: the screen locked at 22:26 EST.
