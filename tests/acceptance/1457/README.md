# Acceptance tests for #1457: the app binary holds the product

Written blind at base `8620dccf` from the issue, `docs/technical-design.md` (How it installs; Numbers version 0 has to hold;
Dogfooding), AGENTS.md and the base code. The implementer does not edit these files; a dispute goes to a blind redraft.

## Criterion -> test

| AC | File | Proof | Wrong program (twin) |
|---|---|---|---|
| 1 | `modes.test.ts` | `git grep` of tests, lanes, scripts, crates, packages, benchmarks finds no deleted mode | `twins/caller.mjs`, `twins/caller.lane.txt` found by the same grep |
| 2 | `release.test.ts` | release `deep-app` byte search: no `DEEP_HUB_PLANT`, `DEEP_APP_NOTIFICATION_SETTING`, plant name | a file holding the strings; `twins/env-read.rs.txt` fails a `--root` lint of the lint lane naming `views.rs`; `twins/env-read-gated.rs.txt` (feature-gated) passes |
| 3 | `frame.test.ts` | `FS_CALLS_PER_FRAME` from the preflight is 0; render-lint-style plants fail naming file:line; `setup::count` has no fs call | `twins/render-exists.rs.txt`, `twins/render-read.rs.txt` |
| 4 | `budgets.test.ts` | real app tree and picture vs `BASE_BIN_DEBUG` on #1172's world | a changed name and a changed pixel are told apart |
| 5 | `budgets.test.ts` | release size and first-frame median vs `BASE_BIN_RELEASE`; both numbers printed | bigger, equal, slower fail the judge |

## Run

```sh
npx vitest run --root tests/acceptance/1457 modes release frame            # no window needed (release builds deep-app, slow)
BASE_BIN_DEBUG=<base debug deep-app> BASE_BIN_RELEASE=<base release deep-app> [BASE_FIRST_FRAME_MS=<n>] \
FS_CALLS_PER_FRAME=<count from the preflight> npx vitest run --root tests/acceptance/1457 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1457/tsconfig.json
```

A missing `BASE_BIN_*` or `FS_CALLS_PER_FRAME` fails the test as `INCONCLUSIVE`, never passes. AC4 and AC5 need a logged-in Mac
with Accessibility and Screen Recording (as #1172); without them the helpers report `BLOCKED`.

## Pinned by this suite (the issue names no surface for these)

- The lint is whichever script of `scripts/lanes.mjs`'s `lint` lane takes `--root`; a planted environment read and a planted
  file-system call in a `render` must make one of them exit 1 with `FAIL ... crates/deep-app/src/<file>[:<line>]`. A read under
  a `#[cfg(feature = ...)]` passes. The existing `render-lint.mjs` or a new guard may be extended for this.
- `setup::count` is `pub fn count()` in `setup.rs`; its body holds no `exists`, `fs::`, `is_file`, `read_to_string`.
- Not tested: `trusted_input` (the issue names only `mod trusted`); "planted caller fails the build" is held by the grep, not cargo.
- Per-frame file-system calls are counted by the preflight on the reference Mac; this suite only judges the number.
