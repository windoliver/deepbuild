# Mac round 2: the heads after the drive/mod.rs size fix (2026-11-24)

MacBook Pro (`machine.txt`). This was one fresh GitHub clone, on AC power, with the screen unlocked at every step. `exits.txt` has each step's load and exit code. The account name is redacted as `<user>`.

The heads tested:
- **PR #3012** at 5bd0f9548. This holds the size fix (b1f5a894a and 5bd0f9548) and main 4e69dd681, merged in.
- **PR #3028** at b11b599ee, stacked on 5bd0f9548.

The size fix gives `drive/mod.rs` 2,290 lines, equal to its ceiling. The move event's fields come from `..Default::default()`, with the same values as before. The event becomes its platform input before the defer. No behavior changes.

| Check | #3012 5bd0f9548 | #3028 b11b599ee |
|---|---|---|
| `tests/acceptance/1546/ac1-journey.test.ts` | 4 of 6 pass, no panic | 4 of 6 pass, no panic |
| `tests/acceptance/1427/ac7-shipped.test.ts` | 4 of 4 fail on assertions, no panic (fixed by #3028) | 4 of 4 pass (and again in the e2e below) |
| `node scripts/motion.mjs` | not run | exit 0; the same three hashes as every earlier round |
| clippy `-p deep-replica -p deep-app --all-targets --no-deps -D warnings` | one error, `crates/deep-app/src/find.rs:397` | the same one error |

The two #1546 failures are the tests that want a `needs-you` view. They are unchanged from earlier rounds and wait on a blind redraft.

The clippy error comes from main. `clippy-keepgoing-head.txt` (b11b599ee) and `clippy-keepgoing-base.txt` (main 4e69dd681) were run with `--keep-going`, so every target is checked. Each reports exactly that one error: `single_range_in_vec_init` in a test of `find.rs` (#1815), a file neither PR touches. Neither PR adds a lint.

## End-to-end run

`e2e-terminal.png` and `e2e-terminal.txt` record one run in a real Terminal window, in the clone at b11b599ee. The drive is `../mac-df5bd5bf5/e2e-panics.mjs`. In one deep-drive process it does these steps:
1. Launch 1 hovers and then resizes.
2. Launches 2 and 3 follow in the same process.
3. `motion_check` runs.

Every reply is ok and nothing panics (exit 0). After that, `scripts/motion.mjs` exits 0 and the AC7 suite passes 4 of 4. `e2e-launch1-after-resize.png` and `e2e-launch2-after-3s.png` are the replica's own window screenshots from that run. A fresh agent checked all three screenshots against the log and found no error, no panic and no personal data.
