# Acceptance test for #3170's third criterion, redrafted blind: without a reflink folder, the cli test still reads BLOCKED

This folder redrafts one criterion of #3170. I drafted it blind from these sources:

- issue #3170's body, as `gh api repos/windoliver/deepbuild/issues/3170` gives it
- AGENTS.md, `docs/technical-design.md` and `docs/parallel-proof.md`
- the base commit `61aa8eb06`

At the base I also read `crates/deep-hook/tests/cli.rs` (the copy-on-write test and its `clone_tree` and `tree`
helpers), `.cargo/config.toml`, `scripts/proof-runs.mjs` (the before lane's twin rules and `atAssertion`),
`scripts/proof-change.mjs` and `scripts/lanes.mjs` (`underTestPaths`, `testPaths`), and `tests/acceptance/1121/` for the
suite's shape. The helpers are written here, never imported from another suite. I didn't read `tests/acceptance/3170/`,
the branch's other changes, its diff, any PR or any session's notes. Per AGENTS.md the implementing agent doesn't edit
this test; a dispute goes to another blind redraft.

## The criterion and its test

| Criterion | Test | File |
|---|---|---|
| `#3170.618b6b1f` On a Linux machine without such a folder the test still reads BLOCKED and names the fix, as today | `#3170.618b6b1f on a Linux machine without a reflink folder, the copy-on-write cli test still reads BLOCKED and names the fix` | `blocked.test.mjs` |

"Such a folder" is a folder on a file system with reflink, named by `DEEP_TEST_COW_DIR`; "the test" is deep-hook's
`a_folder_is_cloned_copy_on_write_where_the_file_system_can_and_exits_3_where_it_cannot` in
`crates/deep-hook/tests/cli.rs`.

The test runs the issue's own command, `cargo test -p deep-hook --test cli --locked`, narrowed to that one test with
`-- --exact`, as a real cargo run on the real crate. `DEEP_TEST_COW_DIR` is removed from its environment and then set
to a folder the test makes on tmpfs (`/dev/shm`), which has no reflink; the test first checks with
`cp --reflink=always` that the folder really can't make one. It asserts:

1. the copy-on-write test reads `FAILED`: it neither passes nor goes unrun (invariant 2), and cargo exits nonzero;
2. its panic message starts `BLOCKED: `, not another failure such as an I/O error;
3. the message names the fix: `DEEP_TEST_COW_DIR`, and a folder with reflink;
4. the message names the folder this machine offered, as today's does.

Cargo not reaching the cli target (a build failure) throws a plain error: setup, never an assertion, so a broken build
can't read as proof.

### Why a tmpfs folder stands for the machine

The criterion's machine is one without a reflink folder. The Spark already has one: its `~/.cargo/config.toml` names
one to cargo, so with the variable unset the cli test passes there at the base (`BASE-FAILURE.txt`), and the folder
can't be taken away for a run. A machine without one has only folders that can't make a reflink copy; a folder on tmpfs is
such a folder on any Linux machine, the Spark included, and the person on that machine is the one who names it. So
the test holds on the Spark after the fix as well as before it.

What this can't show: a run with `DEEP_TEST_COW_DIR` unset on a machine whose repo config names a folder only the
Spark has, in an unforced `[env]` entry. The test sets the variable, and an unforced entry leaves a set variable alone,
so that program passes here. What it does catch is config that overrides the machine's own folder, as the twin's
runner does. Showing it needs a Linux machine other than the Spark, or the Spark's folder hidden from a
run, and neither is here. That case stays open for the review.

## Running it

```sh
# The Spark (Linux aarch64), or any Linux: minutes cold, seconds once deep-hook's tests are built.
node --test tests/acceptance/3170-redraft-ac3/blocked.test.mjs

# The Mac: skips with INCONCLUSIVE (platform), since the cli test is compiled on Linux only.
node --test tests/acceptance/3170-redraft-ac3/blocked.test.mjs
```

The criterion's words "as today" mean the test passes on the base; it needs a planted wrong program to fail on
(`twins.json`, `twins/README.md`). `BASE-FAILURE.txt` holds both runs on the Spark.
