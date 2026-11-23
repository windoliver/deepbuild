# Twins for #2693

Each twin is the change's `crates/deep-canvas/src/schedule/steps.rs` with one wrong program in place of the right
one, for the tests that pass on the merge base (which keeps every checkpoint, so its seeks already equal playing).
Written by the implementer, not the blind job; the tests are unchanged.

- `drops-start`: the ring lets go of the checkpoint at the start each time it thins, and a seek before its
  earliest checkpoint restores that one, as the planted `ring_drops_start` does. The 100 seeded seeks after the
  hour (`seek-hash.test.ts`, first test) differ from playing on the seeks into the first spacing.
