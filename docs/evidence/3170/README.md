# Evidence for #3170: the Spark's copy-on-write folder for deep-hook's cli test

The Spark is Linux aarch64 with ext4 disks. On 2026-11-22 it gained `~/deepbuild-cow`: the mount of a 4 GB sparse XFS
image with reflink (`~/deepbuild-cow.img`, its root folder the user's), listed in `/etc/fstab` with `loop,nofail`. Its
`~/.cargo/config.toml` gained `[env] DEEP_TEST_COW_DIR = "<home>/deepbuild-cow"`. Paths are cut to `<home>`. cargo ran
with `-j 4`, `RUSTC_WRAPPER=` and no debug info.

| File | Commit | What ran |
|---|---|---|
| `spark-reflink.txt` | `a7db2f5b` | `findmnt` of the folder (XFS on a loop device), the `[env]` entry, and `cp --reflink=always` in the folder: exit 0 |
| `spark-cli-before.txt` | `a7db2f5b` | `DEEP_TEST_COW_DIR=/var/tmp cargo test -p deep-hook --test cli --locked`, the base's default folder: the copy-on-write test reads `BLOCKED: /var/tmp can't make a reflink copy …`, 29 passed, 1 failed |
| `spark-cli-after.txt` | `a7db2f5b` | `cargo test -p deep-hook --test cli --locked` with nothing set by hand: 30 passed, 0 failed, the copy-on-write test `ok` |
| `spark-suite.txt` | `a7db2f5b` | `tests/acceptance/3170/` on the Spark: 3 of 3 pass |
| `spark-lanes-74c12b43.txt` | `74c12b43` | The proof lanes on the Spark: round 5 (`before trace`) first, then round 3 (`guard before trace`) |

## Verdict lines, Spark, `74c12b43`

- Round 3: `PASS guard: 4 commits checked`.
- Round 5, before:
  - `PASS` AC1 `#3170.f6002c7f` (twin `lane-names-var-tmp`).
  - `PASS` AC2 `#3170.4db366cf` (twin `clone-drops-mode`).
  - `PASS` AC3 `#3170.618b6b1f` in `3170-redraft-ac3` (twin `forced-cow-folder`).
  - `FAIL` for the first draft's AC3 test: the lane refuses its twin `blocked-reads-pass`, which replaces `crates/deep-hook/tests/cli.rs`, a file under the test paths. The redraft holds that criterion.
- Round 5, trace: `PASS trace: … each of its 3 criteria has a tagged test that ran, passed and failed on a wrong program`.
- Round 3's before read AC2 `FAIL` on the change: another test of the cli target failed in the bay. The failing test isn't recorded, because the lane keeps only the first line. The file passed 3 of 3 times in the clone at load 56–77, and in round 5.
- Rounds 2 and 4 got no bay pair within 30 minutes (`INCONCLUSIVE`).
