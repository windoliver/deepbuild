# PR #2546 conflict resolution

Merged main `291d63af6` into the PR at `b7dac06bf`. The only conflict was in `packages/hub/src/server.ts`: keep this PR's extracted reply formatters and main's `fileKey` including `ctimeMs`, with all rule-file recovery changes. No acceptance test, expected value, timeout or check changed. The shared dirty checkout was not used or staged.

## Requirement → resolution → proof

- Preserve #2084's held lease rewrite and same-call notice: `node scripts/proof.mjs guard trace` exits 0, all three criteria pass, including unchanged #1015 files and the Codex wrong-program twin (`proof.log`).
- Preserve main's unreadable/removed rule-file recovery: all six `packages/hub/test/rules-rewrite.test.ts` cases pass, including mode-only changes and restore-before-hello.
- Preserve reply formatting: its regression test passes. With the original and tagged #2084 cases, `affected.mjs` reports **13 passed** across five files (`tests.log`).
- Conflict resolution guard: **5 commits checked**, PASS. Conflict-file diff check passes. Tests from both parents remain byte-for-byte unchanged.

The first workspace build hit an environment failure in pi: a temporary Node executable lacked its Homebrew shared library (`build.log`). The failed package build, deep-hook build and acceptance typecheck then exited 0 with installed Node 24.22.0 (`build-corrected-env.log`). No code or checks were changed for that correction.

The affected run remains **FAIL overall**: 166 unlisted lint findings, 42 known, 13 tests passed, no WIDE or INCONCLUSIVE lines. The merged `server.ts` is 1,525 lines; main's copy is already 1,599, so this is not a new size increase relative to main. Existing lint findings and saved logs were not rewritten or exempted. Full source-based selection, timing checks and release preflight were not rerun for this conflict.

Main advanced to `abf74b4ee` while the checks ran; `git merge-tree` with the resolved branch exits 0. That newer head was checked for conflicts, not fully tested.
