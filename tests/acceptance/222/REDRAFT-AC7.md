# Criterion 7's per-frame half: disputed, redrafted blind

`budgets.test.ts` (criterion 7, `#222.21cc8a35`) presents the 512-cue film first and the same motion written as
channels second, evaluates each at 1.03 s and 1.07 s, and requires every node whose `run` reads `ran` in the cue
film's second reply to have a match among the hand film's. That comparison fails for any expander, right or wrong:

- An `eval` reply lists the check phases' nodes "as the revision's check had them, then the frame phases' for the
  last frame" (`Session::nodes`, `crates/deep-canvas/src/schedule/mod.rs`). Frames never run check phases
  (`run_frame` skips `is_check_phase`), so `core.lower | <item>` and `motion.compile` read `ran` in every reply after
  the revision that ran them, whatever the frame did.
- The two films hold byte-identical squares. The one presented first runs `core.lower` for them (`ran`); the one
  presented second finds the same content keys in the shared cache (`hit`). So the first film's reply carries
  `core.lower | s0…s7: ran` and the second's doesn't.

Seen on this branch: with the cue film first, the eight extra nodes sit on the cue film's side; with the hand film
first, the same eight sit on the hand film's side; with the second film's square renamed, both sides carry it. The
cue list's own item has no node in any frame: the drawn form replaces it with what it expanded to.

The dispute went to a blind redraft, `tests/acceptance/222-redraft-ac7/` (b35d94df2), written from the issue, the
design, base `f6d811c7`, this suite and the dispute alone. It keeps the criterion's numbers and films, runs each film
in its own process, and counts only frame-phase work. The original file stays as it is; the lanes run the redraft in
its place once the owner approves the swap.

The owner approved the swap on Nov 14, 2026, in the building session ("Yes, swap it"); the lanes commit that makes it is ffd5aa9bc.
