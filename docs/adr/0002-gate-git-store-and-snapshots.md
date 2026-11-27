# 0002: The gate's git, its object store and a claim's snapshot

Status: accepted. Moved from comments in `packages/gate` by #3454's first pass ([0001](0001-code-carries-no-comments.md)). The design states the rule these serve under Pinned to a commit and Fail before, pass after; the decisions below are the ones written nowhere else.

## The environment git runs in

- **The gate's git never inherits the hub's git variables.** `packages/gate/src/env.ts`, `gitEnv`; `packages/gate/src/checkouts.ts`, `runGit`. The hub may itself be started with git's location and config variables set (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_PARAMETERS` and the rest of `GIT_LOCATION`), which would point every git it runs for a claim at another repository, or apply settings the claim's repository never had. Each is cleared first, and a call then sets only the ones it means (#31).
- **A write to a stopped git's input must not end the hub.** `packages/gate/src/checkouts.ts`, `runGit`. A git the budget stopped before it read its input fails the write with EPIPE. The `execFile` callback already settles the call, so the pipe's error is swallowed (#2126).

## The object store

- **The store is made by the first git work, not when the service opens.** `packages/gate/src/checkouts.ts`, `openCheckouts` (`store`). A machine without git still runs the hub, and only a check run says git is missing (#41). A failed attempt is tried again by the next call.
- **What a crash left goes at the next open, an index holder included.** `packages/gate/src/checkouts.ts`, `openCheckouts`. Only a call under way has an `index-` holder in the store, so any found at open is a crash's.
- **The store's own reads reach the repo's objects as alternates too.** `packages/gate/src/checkouts.ts`, `repoEnv`. A snapshot's tree and a carried result are read from the store.
- **A prune reads loose objects only and stops at each snapshot.** `packages/gate/src/checkouts.ts`, `pruneNow`. Nothing repacks the store. What no kept snapshot's own tree holds goes, and the walk stops at each snapshot because its parent is the repo's commit, which may be gone.

## A claim's snapshot

- **Each repo's snapshots run one at a time, and never behind another repo's.** `packages/gate/src/checkouts.ts`, `serial`. A prune waits for every snapshot in flight and holds the next, so it never takes what a snapshot is still writing (#31). The `snapshots-one-at-a-time` plant takes no turn in `snapshot`: under its one queue the budgeted stage is already serial.
- **The tree is read into temporary objects first.** `packages/gate/src/checkouts.ts`, `snapshotOf`. `git add` and `git write-tree` freshen even the objects that exist, so writing straight into the store would change it on an unchanged claim (#2078). Complete objects are published only for a new snapshot, each by a link: a link is atomic and never rewrites an existing object. The temporary objects sit on the store's file system and lose their temporary names when the snapshot ends, however it ends.
- **The index copy keeps the index's time.** `packages/gate/src/checkouts.ts`, `snapshotOf`. Git tells a file edited in the index's own second from an unchanged one only by comparing the two times, and then reads its bytes.
- **The marks that hide a change are cleared in the copy, each by its own option.** `packages/gate/src/checkouts.ts`, `snapshotOf`. Assume-unchanged and skip-worktree hide a change from `git add`, and one `update-index` call applies only its first option. A marked file missing from disk keeps its mark, or `add` would read a sparse checkout's absent files as deleted.
- **The snapshot is written from a copy of the session's index.** `packages/gate/src/exec.ts`, `snapshotOf`. The copy keeps the index's stat cache, so only changed files are hashed again.

## The budget

- **A claim's snapshot and its checkout share one budget.** `packages/gate/src/checkouts.ts`, `openCheckouts` (`runClaim`, `budget`). Past the git work's 8 s, every process the budget started is stopped by its PID, and a process started after the budget ran out never starts (`runGit`). The claim is then INCONCLUSIVE, naming the reason and the count of untracked files; its checks never run, and what the snapshot left is removed (#31).
