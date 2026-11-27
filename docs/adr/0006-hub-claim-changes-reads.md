# 0006: The hub's read of what a claim changed

Status: accepted. Moved from comments in `packages/hub` by #1869's change, which added them before [0001](0001-code-carries-no-comments.md) landed. The design states the rule these serve under Whose checks count; the decisions below are the ones written nowhere else.

## Bounds

- **A read of what a claim changed is bounded as the snapshot's own git reads are.** `packages/hub/src/claim-changes.ts`, `changesOf`. Git runs with fsmonitor off, takes up to 1 GB of output (the snapshot's untracked listing's limit), and every read of one claim ends by one deadline, by SIGKILL (#1869).
- **The deadline is half the stop hold that is left, and never under `READ_FLOOR_MS`.** `packages/hub/src/gate-runner.ts`, `READ_FLOOR_MS` and its call of `changesOf`. Half the hold leaves the claim time to get its verdict inside the hold; the 5 s floor still gives git time to answer when the hold is all but over (#1869).
- **The listings are kept as bytes and cut at each NUL.** `packages/hub/src/claim-changes.ts`, `changesOf`. Up to 1 GB is more than one string holds; with `-z` (#3114) each path ends in NUL.

## A read that fails

- **A read that fails, times out or gives more than 1 GB is recorded, and lists nothing.** `packages/hub/src/claim-changes.ts`, `Changes.unread`. Then nothing is known of what the claim changed (#1869).
- **Only a `git show` of a file the base never had is no failure.** `packages/hub/src/claim-changes.ts`, `changesOf`. It is known by git's English words, so git runs in C's locale; a `show` that was killed is a failure whatever it printed (#1869).
- **While a read is unread, every approved check on the claim counts as the agent's own.** `packages/hub/src/gate-runner.ts`, `verdictOf`. Any of them may be one the claim changed, so none may count as approved (#1869).
