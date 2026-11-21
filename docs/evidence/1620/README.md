# Evidence for #1620: `replica_equals_live_tree` (#1459 AC6)

`mac-fb6a79d23/` (MacBook Pro Mac18,1, 2026-11-21, screen unlocked throughout; `exits.txt` has each step's load and exit code, and the two attempts a full disk cut short):

- **Base, main 7a256fd4b** (`base-1459-ac6.txt`): fails. In all three views "Needs you" has 1 child in the replica and 2 in the live tree: the replica's snapshot has no `needs-you-pop-out`.
- **Head fb6a79d23, stored captures** (`fix-1459-ac6-before.txt`): that line is gone. The test still fails, now on the first place the stored captures are older than main: `40 asks need you` at x 388 against the stored 310.
- **Head, captures retaken on this Mac** (`fix-1459-ac6-after.txt`, `live-diff.txt`: 121 lines per side over the three files): fails on six ask rows per view that have 3 children in the replica and 4 in the live tree. Since #1808 a row whose time gives way to its title keeps a zero-wide `<id>:time` slot; the live tree holds it and the replica's snapshot, which keeps what's visible, doesn't. All six are ask rows. PR #2883 (#1345 AC8, an ask row keeps its time) removes the case.
- **`parity.test.ts`** (`fix-1459-parity.txt`): 2 of 3 fail: the cargo test above, and node for node, where 24 of its 25 findings are the 11 open asks below the window's last whole row, which neither tree draws.
- **`1461/tree.test.ts`** passes 4 of 4, the test that names `Pop out Needs you` included. **`1172/popout.test.ts`** fails in its setup, `no reply to canvas.user within 10000 ms`, as #1172's `rows.test.ts` does on main.

The retaken captures aren't committed: they would be stale again once #2883 and #2880 land, and a commit of them needs the owner's signed tag.
