# #995 wrong programs (blind sweep)

One twin, for `#995.1c8866b5`.

- `keeps-unused-pictures/crates/deep-app/src/show.rs`: the base's `crates/deep-app/src/show.rs` with one change, in
  `CanvasPanel::show`: the retain over the panel's pictures keeps every one (`let keep = used(&h.sha) || true;`), so the
  panel keeps each picture it was ever shown, used by a shown revision or not, as the issue says the merge base did.
  It compiles; `panel.test.ts` fails on it at its exit-status `expect`, naming the canvas panel (WRONG-PROGRAM.txt).
