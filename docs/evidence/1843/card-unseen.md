# The question card while nobody can see its window (Mac17,10, macOS 27.2, November 24, 2026)

Part of #1843, the `occluded` trigger. The base is main at `ce6866e65`, which holds windoliver/deepbuild#3338.

## The real app

`deep-app` on a real hub, in a temporary home with one open ask, read from outside its process through the Accessibility
API, the screen unlocked and the display awake before and after. Its window is hidden for 3 s once the card reads
`armed`, then shown. One run each.

| The window | When | The card, base | With the fix |
|---|---|---|---|
| minimized | while it is | `armed` | `presented` |
| minimized | restored | `armed` from the first read on | `presented` at the first read, 593 ms after the call to restore it, and `armed` at 1,090 ms |
| covered by an opaque panel | while it is | `armed` | `presented` |
| covered by an opaque panel | the panel gone | `armed` at 25 ms and on | `presented` at 26 ms and `armed` at 590 ms |

So on the base the 500 ms that stop an accidental press protect nobody whose window was hidden. Not read here: a locked
screen and a sleeping display, which the tests below force.

## The tests

`crates/deep-app/tests/card_unseen.rs`: the ask's own page in a window drawn as macOS draws it, at a frame a display
asks for, and none is asked of a hidden window. Time passes by the app's tick.

| | Base | With the fix |
|---|---|---|
| hidden 400 ms into its interval, for 2.5 s | armed 250 ms later, hidden | not armed hidden; armed 500 ms after it's shown |
| opened in a hidden window, 2 s later | armed, and takes an assistive client's press as far as the OS prompt | not armed; the press is refused and told "Show the window first"; armed 500 ms after it's shown |
| armed, hidden and shown between two ticks, pressed at once | answered | refused, and refused 499 ms after it's shown |
| pressed down on an option and on Send, hidden and shown, released 500 ms later | answered | answers nothing, and neither does a Send the OS confirms after |
| armed, behind a lock or on a display asleep for 2.25 s | armed throughout | not armed; armed 500 ms after the tick that finds it shown |
| a picture drawn whole for 300 ms, hidden for 2.25 s, shown for 500 ms | counted as shown while hidden; 3,050 ms recorded | counted 500 ms after it's shown; 800 ms recorded |
| a picture drawn behind a lock for 2.25 s | counted as shown | not counted until 500 ms after the lock is gone |

All seven fail on the base and pass with the fix, unchanged. Planted versions of the fix, each failing the tests named:

| The wrong version | Fails |
|---|---|
| the window's own event isn't heard | 4 |
| the tick doesn't tell the card | 2 |
| Send's down outlives a hidden window | 1 |
| Send's OS prompt outlives a hidden window | 1 |
| a frame nobody sees counts | 1 |
| a picture's time runs on while hidden | 1 |

## What counts as seen

`Window::is_visible` and `Seen::shown` (#262), both. `is_visible` comes as an event, so a window hidden and shown between
two ticks restarts the interval at once; GPUI's contract for it names covering, minimizing, Spaces and display sleep, and
no lock. `Seen::shown` names the lock and the display, and is read by the tick the app has already; off macOS it always
says shown. AppKit calls a window visible while any of it shows, so a card covered by a window that leaves some of its own
window in view stays armed: that is #1843's `activation`, which isn't part of this.
