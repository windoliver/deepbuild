# #1117 bays on the Mac (2026-11-04)

Run by a Remote Control session on the owner's Mac at the PR's head `4c5afe91`, with the owner approving the steps that write to the real HOME.

- **Machine:** Mac15,12 (MacBook Air, 8 cores), macOS 14.7.7, Node v24.22.0.
- **Worktree:** `~/private/deepbuild-core/.claude/worktrees/issue-1117-mac`, a worktree of the Mac's repository (`~/private/deepbuild-core`, not `~/deepbuild`), after `npm ci`.
- **Disk:** 53 GB free of 460 GB, so the real bay used a small build, `cargo build -p deep-hook -p deep-contracts --all-targets --locked`, rather than the whole workspace.

Timings below are readings, not budgets: the load was 3.1 at the suites and 8.5 at the real bay.

## Suites

`node --test tests/acceptance/1117/*.test.mjs tests/bays.test.mjs`: 18 tests, 18 pass, 0 fail, 0 skipped. That is all ten acceptance tests, for all eight criteria, and all eight tooling tests.

Twins: each `twins/<name>/scripts/bays.mjs` was copied over `scripts/bays.mjs` and the fast acceptance files were run. The original was then restored, and `git status` was clean.

| Twin | Fails |
|---|---|
| blob-id-compare | `#1117.af1d4c7e`, `#1117.b2c7cfc4` |
| relocated-target | `#1117.029c15e6`, `#1117.4ebbfb21` (both tests), `#1117.e77894d3`, `#1117.f25af808` |
| trusted-seal | `#1117.4ebbfb21` (both tests) |

## The real bay, `~/deepbuild-bays/1/change`, under the Mac's real throttle

Every run had `CARGO_TARGET_DIR=/tmp/bay-elsewhere` set in the parent.

| Build | What came first | Claim record | cargo |
|---|---|---|---|
| 1 | nothing: first use | `seal:none cold:true stopped:false installed:true written:6082` | 2 `Compiling` lines, 16 s, exit 0 |
| 2 | nothing: the same tree | `seal:intact cold:false` | **0 `Compiling` lines**, 4 s (AC1) |
| 3 | one byte of `libdeep_contracts-*.rlib` flipped at offset 4096 with `dd conv=notrunc`, mtime put back with `touch -r` | **`seal:broken cold:true`** (AC4) | 2 `Compiling` lines, 17 s |
| 4 | `bays.mjs change -- sleep 600` started and its bays.mjs killed with `kill -9` by PID; the `sleep` was still alive | **`seal:none cold:true stopped:true written:0`** (AC2, AC5) | 2 `Compiling` lines, 16 s; the orphaned `sleep` was gone after the claim |

- **AC7:** `/tmp/bay-elsewhere` held 0 entries after every build.
- **AC8:** the release records' `targetBytes` read 631902333 after builds 1 and 2, and 631902363 after build 3.
- **Disk afterwards:** `~/deepbuild-bays` 1.0 GB, 52 GB free.

No commits, pushes or test edits were made on the Mac. `~/deepbuild-bays` and the worktree were left for the owner.
