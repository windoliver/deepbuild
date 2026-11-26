# Evidence for #3488

- `ready-test-before.txt`: `cargo test --locked -p deep-replica --bin deep-live`, run with `ready()` stubbed to take every window as ready (its body was `let _ = (active, key, appkit, app); Ok(())`). The test fails at its first wrong case: `GPUI says active false, AppKit says key true`.
- `ready-test-after.txt`: the same command with `ready()` as committed: 1 passed.
- On Linux the macOS module is compiled out. Only `ready()` and its test build, so the wiring in `settle` is proven only by the Mac round.
