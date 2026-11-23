# #1620: `replica_equals_live_tree`, the live trees retaken on the reference Mac

Taken on the reference Mac, a Mac17,10, at main `98347e837` (`machine.txt`).

## The retake

`deep-live` (`crates/deep-replica/src/live.rs`) took the three stored trees again, as `e08ebb167` did on Nov 10:

```sh
TZ=UTC target/debug/deep-live --view <needs-you|sidebar|session> --out docs/spikes/338/out/live/<view>.json
```

Each run opened the real window, read its accessibility tree, wrote 190, 190 and 188 nodes, and quit with exit 0.

The trees are taken in UTC. An ask's row writes when its default applies in your time zone (#1458), so a tree records the zone it was taken in:
- The Nov 10 trees were taken in US Pacific time.
- This Mac has been on New York time since Nov 22.
- A tree taken without a pin read `08:00` where Pacific read `05:00`.

So `headless.rs` now starts every replica it compares with `TZ=UTC`, and the check holds in any zone the Mac is set to.

## At the base: fails for the expected reason (`base.txt`)

Against the retaken trees, the base replica differs in all three views at node 2, the "Needs you" heading: 1 child against 2. Past that node, each live tree holds 13 nodes the replica's snapshot doesn't. All other nodes match, bounds included:

- `needs-you-pop-out`, "Pop out Needs you": drawn at opacity 0 at rest (#1592).
- On six ask rows, `ask:<id>:time`, which is 0 wide (#1808), and the `ask:<id>:applies` label inside it, which that slot clips away.

Both are in the tree by design. #1592's comment reads "named in the tree at rest", and #1808's reads "its slot kept in the tree with no width".

GPUI pushes an accessibility node at prepaint for every element with an id and a role. It doesn't check opacity, size or clip (`vendor/gpui-pre/src/element.rs`). The replica kept only what gpui-kit marks `visible` at paint: not hidden, its own opacity above 0, and some area left after clipping. So the snapshot was wrong to drop those nodes, and the trees were right to hold them.

## The fix, and after (`after.txt`)

`deep_replica::snapshot::from_observed` now keeps every observed element with a role that the frame drew, as GPUI's tree does. Whether a person can see an element stays the drive's `visible`.

- `replica_equals_live_tree` passes. So does the whole `headless` suite: 19 of 19 with the Mac on New York time, and the parity case again under `TZ=America/Los_Angeles`.
- `views.txt` takes `deep-replica --view` for every view it draws, at the reference window, 900×600 and 600×900, before and after the fix. The only nodes added are the pop-out and the ask rows' time and applies slots. No node is removed or moved.
- `crate.txt` runs every `deep-replica` test target once. Each failure the listing names fails as listed. The rest are three `acceptance_1425` cases that need plant builds, and one launch-time case: 2007.7 ms at load about 190, which passed at load 62.

## Not run

- `tests/acceptance/1459/parity.test.ts` and `tests/acceptance/1461/tree.test.ts`, which read the snapshot through `deep-drive`. Both build with `CARGO_PROFILE_DEV_DEBUG=0` and `CARGO_INCREMENTAL=0`, which means a whole second build of the workspace's dependencies on a Mac at load 150-200.
