# @deepbuild/github

## What it is for

The github extension, the first part of it (#46, #1325): a first-party extension that ships on by default and writes nothing to GitHub until a repo's delivery rule is on. Each verdict goes to the commit it covers as a `deepbuild/verdict` status. GitHub's record of each push becomes `push.record@1` readings for the gate's head-trust rule, and a ref change no guarded call named is recorded as `ref.unguarded`. An open pull request that stops merging wakes its idle session with the files in conflict. Statuses post from the gate's own app, each session a run starts gets a token of the agents' app that can't post one, and `deep gate rules` prints the rulesets that make only the gate's status count.

## Where new code goes

- `src/pushes.ts`: reading GitHub's record of pushes, and nothing else. A commit's author and committer are never its pusher.
- `src/apps.ts`: the gate's app and the agents' app (#1325): a JWT from the key the hub reads, tokens minted per repo, and revoking one. Nothing here keeps a token anywhere but in memory.
- `src/rules.ts`: the rulesets `deep gate rules` prints. They're printed, never applied.
- `src/delivery.ts`: what the hub does with it. It reads the record, posts, and hands the hub a record or a session's words through `GitHubOptions`; it decides no verdict.
- What must outlive a restart goes in `github.json`: the log position read to, the verdicts waiting on a pushed commit, and the last ref change read per repo.
- The PR comment and `deep report` follow here in R2.
- Tests: `test/` for regressions beyond the acceptance suite in `tests/acceptance/46/`.

## What it may import

- `@deepbuild/gate`, for head trust and the reading's types. Everything else of the hub comes in through `GitHubOptions`.

## Deviations

- None.
