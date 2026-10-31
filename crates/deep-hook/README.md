# deep-hook

## What it is for

The binary every agent hook runs as `deep-hook <agent> <event>`: it stamps the call with its seq and ID, matches it against the guard entries in `~/.deepbuild/rules.json`, forwards it to the hub and prints the reply; with the hub away it applies the fail-closed entries, allows the rest and spools the request for replay. It is also Claude Code's status line command and background Stop waiter. It only appends events and reads `rules.json`; it never holds the control token (technical design: deep-hook).

## Where new code goes

- `src/main.rs`: the hook, spool, status line and waiter paths.
- `src/matcher.rs`: each `match` predicate of a guard@1 entry. `src/shell.rs`: the shell reader those predicates read a command through.
- `default-rules.json`: the shipped guard entries, which packages/hub/src/setup.ts installs into `rules.json`.
- Tests: unit tests in each file's `#[cfg(test)]` module; the binary's behavior in `tests/cli.rs`; acceptance suites under tests/acceptance drive the built binary.
- A public item in `src/matcher.rs` or `src/shell.rs` is an interface: the interfaces lane (scripts/api-surface.mjs) diffs it.

## What it may import

Core, beside the hub: deep-contracts (through its crate root) and std, nothing else today, with the few libc calls it makes declared in its own `extern "C"` blocks. It never imports a canvas, GPU or app crate.

## Deviations

- `src/lib.rs`: the matcher and shell reader are a library so the local preflight's cargo-semver-checks can diff their public items against the merge base (#139).
- `tests/busy_disk.rs`: its own test binary because it keeps the disk busy; cargo runs test binaries one at a time, so no other test's spool write runs beside it.
- `Cargo.toml`: the `plant-*` features build the planted wrong programs for #16, #304, #315 and #316's acceptance criteria; no default build has them.
