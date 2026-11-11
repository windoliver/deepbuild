# @deepbuild/routing-replay

## What it is for

The ask router's routing replay (#1980): the recorded nixpkgs Hydra failures, fetched once from public build history into a snapshot kept by its SHA-256, replayed on the virtual clock through the asks core, one ask per cause. It runs on the reference Mac in the local preflight, never in CI, starts no agent session and sends nothing anywhere: asks go to the replay's own record and their placeholder owners.

- **The snapshot** (`snapshot/<SNAPSHOT>.json.gz`, the JSON whose SHA-256 is `SNAPSHOT`): the 107 evaluations of the trunk jobset `nixpkgs:unstable` from 3 September to 11 October 2026 (`window: true`), then the 39 evaluations of the 15 days after (`window: false`), which carry only the jobs that build again. Each window evaluation holds its failures as their build records give them:
  - **Newly failing**: a job whose build succeeded in the evaluation before and whose own build failed or timed out in this one (`status` `failed` or `timed out`). It names the merge it came in with (`merge: {commit, owner}`). A build the builder stopped (aborted, cancelled, past its log or output limit) is no failure of the job's own.
  - **Inherited**: a newly failing job whose build Hydra marks "Dependency failed". It names the build its failure was propagated from (`inherited_from`).
  - **The merge a job came in with**, read from the evaluation's input change (the nixpkgs revisions before and after) and the public git history between them, never from a log: a change that brings a `staging-next` merge (a mass rebuild) brought every job newly failing with it; otherwise the merge in the change that touched the job's package (its attribute's last name or its package name as a path segment), the smallest such merge when several did; otherwise the change's own revision, its newest merge.
  - **No person**: every maintainer handle (Hydra gives them as email addresses) and every merge's author is replaced by a stable placeholder `maintainer-<n>`, numbered in the order they first appear, before the snapshot is kept.
- **The replay** (`replay`): keeps the snapshot's bytes in the evidence store by their hash, then feeds each evaluation in recorded order with the clock at its time. The newly failing jobs of one merge raise one ask (`ask.sources@1` row `replay.routing`, a choice: fix, revert or leave) to that merge's owner, pinned to its commit, with a 14-day deadline, the jobset's queue as its fallback and "leave them failing" as its default. Each build whose failure others inherit makes one `task.created`, subject `ev:<SNAPSHOT>#<build>`. An ask whose jobs all build again is withdrawn (`ask.cancelled`); one still open at its deadline takes its default there, as the asks core rules for one person, its fallback kept in the asks table.
- **The report**: asks per week (UTC Mondays) across the 107 window evaluations against what routing per job would send (one ask per newly failing job), and the newly failing jobs whose merge's ask reached its fallback or default, beside the 18 failures with an owner the issue cites as still open after 14 days. Each is a count over a named sample, never a pass or a fail.

## Where new code goes

- `src/index.ts`: the replay, its router and its report.
- `make-snapshot.mjs`: the one-time fetch and build of the snapshot. It writes the raw pages to a cache folder you name, outside the repo, and only the placeholder snapshot into `snapshot/`. Run it again only to remake the snapshot, then update `SNAPSHOT`.
- Tests: the acceptance suite in `tests/acceptance/1980` is never edited.

## What it may import

An extension on the core: `@deepbuild/asks`, `@deepbuild/evidence` and `@deepbuild/record` through their public entries, and `node:` built-ins. It never imports the hub, the CLI or the app, and the core never imports it.

## Deviations

- The `18` in the report is the issue's figure from the recorded history, carried with its sample named, not a count this replay makes.
- The snapshot is kept gzipped in the repo: it lists thousands of package names, which the public text lane would otherwise read as prose.
