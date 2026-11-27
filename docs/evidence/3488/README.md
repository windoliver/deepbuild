# Evidence for #3488

- `ready-test-before.txt`: `cargo test --locked -p deep-replica --bin deep-live`, run with `ready()` stubbed to take every window as ready (its body was `let _ = (active, key, appkit, app); Ok(())`). The test fails at its first wrong case: `GPUI says active false, AppKit says key true`.
- `ready-test-after.txt`: the same command with `ready()` as committed: 1 passed.
- On Linux the macOS module is compiled out. Only `ready()` and its test build, so the wiring in `settle` is proven only by the Mac round.

## How deep-live waits (moved here from comments, under live.rs's comment ceiling, #3454)

- `ready()`: deep-live captures only when GPUI says the window is active, AppKit says it is key, and AppKit's focused element is the one the app focused. AppKit reports no focused element for a window that isn't key, and GPUI learns that a window left key a task later than AppKit does. A capture taken on either's word alone could record no focus where the window has one: #2690's retake under load, and #3488's review. Its `Err` says what it waits for.
- Past the 8 settling frames, deep-live asks to be activated again every `REACTIVATE` frames until `ready()` holds.
- A watch on the clock, not on frames, ends the run after `WAIT`: a window that is covered, or on a locked screen, gets no frames at all.
  - `WAITING` holds what the last frame waited for, for the watch to say.
  - `CAPTURING` is set once a capture starts, so the watch never ends a run that is writing its tree.
- A window not yet at the reference size, as after a display change, is waited for too.
- The tree is written whole or not at all: to a `.partial` file beside it, then renamed over it.
