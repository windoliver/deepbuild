# Acceptance test for #2869: a throttle waiter on ENOSPC

`enospc.test.mjs` runs `scripts/throttle.mjs build --wait <min> -- <command>` on a table of its own under a temp folder
(`DEEP_THROTTLE_TABLE`, read inside a test run; docs/parallel-proof.md section 6). It never touches the machine's table.
Each case first fills both Linux build slots with holders of its own. It then makes one waiter's table write fail by
replacing that waiter's temp table file, `table.json.<pid>` (the file `locked()` writes and renames into place), with a
symlink to `/dev/full`. Writes through it fail with ENOSPC, and every other process's writes go through. A helper process
plants the symlink again whenever it is gone, for as long as the disk counts as full.

| Case | Expected |
|---|---|
| ENOSPC while waiting, then a slot and space come back | The waiter keeps waiting and keeps its place. Neither it nor a later waiter runs while its write can't land. Once space is back, it is granted first, exits 0 and runs its command exactly once (`A` before `B`). |
| ENOSPC until `--wait 0.1` runs out | Exit 3, `INCONCLUSIVE no grant: no build grant came within 0.1 min`, not before the 6 s wait ran out, and the command never runs. |
| One failed ENOSPC write | Its temp file is gone and the waiter is still waiting. Once granted, it leaves no `*.<pid>` file of its own in the table folder. |
| Another error (the temp file path is a directory, so EISDIR) | Exit 2, `BLOCKED throttle: ...`, and the command never runs. |

On a platform without `/dev/full` (macOS), or where a write to it does not fail with ENOSPC, every case is skipped with an
`INCONCLUSIVE:` reason and never passes.

Run, from the repository root:

    node --test 'tests/acceptance/2869/*.test.mjs'

(Node 24 does not take a bare folder: `node --test tests/acceptance/2869/` fails with MODULE_NOT_FOUND.) It takes about
20 to 40 s. `BASE-FAILURE.txt` is its output at base commit b4c099e2e. There, the first two cases fail with
`BLOCKED throttle: ENOSPC: no space left on device, write` (exit 2), the third fails with the temp file left behind, and
the EISDIR case passes, as it should before and after the fix.
