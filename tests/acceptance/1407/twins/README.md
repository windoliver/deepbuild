# Twins for the 1407 tests

The base has no `plant-matcher-panic` feature, so the planted tests stop at its build there, BLOCKED, before their
assertions, and the AC3 comparisons pass on the base, which they compare with itself. `../twins.json` names a wrong
program for each criterion instead. Each is a file of the base commit `2bba2a50` laid over the change; the two that
alter it alter one place, said below. The implementing agent wrote these, after the blind job's tests; the tests are
unchanged.

| Criterion | Twin | The wrong program |
|---|---|---|
| `#1407.3799f437` (AC1) and `#1407.055ae8d4` (AC2) | `no-panic-hook` | The fix reverted: the base's `main.rs`, so a panic in the planted matcher exits 101 with Rust's message |
| `#1407.14eb6bf3` (AC3, the denial) | `denial-reworded` | The base's `main.rs` with a fail_closed entry's denial worded otherwise: "held while the hub is away" |
| `#1407.14eb6bf3` (AC3, the allows) | `allow-noted` | The base's `main.rs` printing "deep-hook: allowed with the hub away" on stderr when it allows a call with the hub away |
| `#1407.14eb6bf3` (AC3, its wrong-program case) | `plant-inert` | The base's `matcher.rs`: the feature builds, but nothing panics, so the planted build denies as the plain one does |
