# Twins for the 1121 tests

The issue's second paragraph says most of its Scope lines are already done on main, and at the base they are: `image`
is a shared dependency of deep-app, lsof is chosen per platform, deep-hook's `O_NOFOLLOW` has its arm64 value, and the
spool test makes its folder 0700. So the tests of four criteria can't fail on the base. These are the planted wrong
programs the design's Issue shaping asks each to show failing, and each is the fault the issue itself names. Each is
the base's file with only the fault planted, and replaces the one file its path names, and no test or helper. A copy
goes stale as that file changes, and still holds its fault. `../twins.json` names them by criterion.

The third criterion has no twin: its three tests fail on the base, which writes no list and compares nothing
(`../BASE-FAILURE.txt`).

| Criterion | Twin | Replaces | The planted fault | Fails on |
|---|---|---|---|---|
| `#1121.73d8f179` (AC1) | `mac-only-dependency` | `crates/deep-app/src/show.rs` | `picture()` names a crate deep-app has only among its macOS dependencies (`objc2`), unguarded, as it once named `image` there, so deep-app and every crate that needs it stop building on Linux | The Spark |
| `#1121.b915783e` (AC2) | `umask-spool-folder` | `crates/deep-hook/src/tests.rs` | `a_line_written_to_a_spool_moved_aside…` makes its folder under the umask again, 0775 on the Spark, which deep-hook rightly refuses, so that test FAILs | The Spark (umask 002) |
| `#1121.23cb368c` (AC4) | `x86-nofollow` | `crates/deep-hook/src/spool_file.rs` | `O_NOFOLLOW` is Linux x86_64's number, 0o400000, on every platform, as it was before the per-platform constants. On Linux aarch64 that bit is `O_LARGEFILE` and on macOS `O_NOCTTY`, so the open follows a symlinked spool file and the line lands in the file it leads to | The Spark, and the Mac |
| `#1121.301969cb` (AC5) | `sbin-lsof` | `packages/supervisor/src/procs.ts` | lsof is `/usr/sbin/lsof` on every platform, at both of the file's calls. Linux keeps it at `/usr/bin/lsof`, so no port ever reads free there | Linux |

At the base the code isn't where the issue's Scope names it: the constant moved from `crates/deep-hook/src/main.rs:956`
to `crates/deep-hook/src/spool_file.rs`, and `packages/env-local/src/index.ts` and `packages/hub/src/core.ts` hold no
lsof call: env-local's port check goes through `listening()` in `packages/supervisor/src/procs.ts`.

AC1's twin is the issue's fault with another crate. The issue's own, `image` back among deep-app's macOS-only
dependencies, is a change to `crates/deep-app/Cargo.toml`, and a twin can't be a file of that name: `repo-rules.mjs`
reads every `Cargo.toml` in the tree as a manifest and reports INVALID for one outside the workspace.
The twin is unrun on both machines (`../BASE-FAILURE.txt`): whoever first builds the workspace on the Spark shows it
failing there.

`x86-nofollow` holds the base file's one fixed wait, so `scripts/wait-ratchet.mjs` fails until
`scripts/wait-ceilings.json` lists `tests/acceptance/1121/twins/x86-nofollow/crates/deep-hook/src/spool_file.rs` at 1,
as it lists other suites' twins. That file is outside this folder, so the entry is the implementing job's to add.

`x86-nofollow` is no wrong program for AC2 on the Spark. deep-hook's own test of a spool path that leads elsewhere
(`a_spool_path_that_leads_elsewhere_is_never_written` in `crates/deep-hook/tests/cli.rs`) makes its spool folder under
the umask, so under 002 deep-hook refuses the folder as group-writable before it opens the linked file, and that test
passes with the wrong constant (`../BASE-FAILURE.txt`). That is a finding about that test, outside this suite.

To run one: in a throwaway copy of the base with this suite in it, copy the twin's file over the file it replaces and
run the criterion's test file. `../BASE-FAILURE.txt` holds each run.
