# Dispute (#1876): the first draft's scratch copy lacks the files the lane now reads

This redraft exists because of this dispute. This file is the work's, not the blind job's: the job wrote every other
file of this folder from issue #2339, the design and base `9e77c2ad6`, and never saw #1876's change, its diff, this
note or the reason a redraft was asked for.

## What fails

On #1876's change, seven tests of the first draft fail before they plant anything:

| File | Tests |
|---|---|
| `tests/acceptance/2339/ac1-planted.test.mjs` | the fifth line with no link; the line of two sentences |
| `tests/acceptance/2339/ac2-invariants.test.mjs` | `AGENTS.md` edited alone; the design edited alone |
| `tests/acceptance/2339/ac3-checks.test.mjs` | the line naming `scripts/no-such-check.mjs`; the line naming no check |
| `tests/acceptance/2339/ac4-canvas.test.mjs` | the canvas reference without the link |

Each stops at its control, the lane run on the unplanted copy:

```
the unplanted scratch copy already fails the lane, so a planted failure would prove nothing: exit 1, output:
FAIL 0 links into docs/*.md land on no heading, 0 names are not in the design, 0 planned names are stale, 0 principles findings, 7 places where the design is behind main
  docs/technical-design.md the CLI row can't be compared with main: ENOENT: no such file or directory, open 'packages/cli/src/main.ts'
  docs/technical-design.md the Extension API block can't be compared with main: ENOENT: no such file or directory, open 'packages/contracts/extension-api.json'
  …
```

The three tests of the tree in those files (the section opens with the four invariants; each line names a check that
exists; the canvas reference opens with the link) pass on the change, and all eleven offline tests of the first draft
pass at `9e77c2ad6`.

## Why the test, not the lane

The first draft's scratch copy holds the checkout's top-level files, `scripts/` and `docs/*.md`, and its README says
what to do when that stops being enough: "A lane that reads more than that isn't seen by these tests; say so in a
dispute." #1876's Scope has the design links lane gain nine checks, "each reading docs/technical-design.md and the file
on main it is compared with": `packages/cli/src/main.ts`, `packages/contracts/extension-api.json`,
`packages/contracts/hub-slots.json`, `packages/contracts/schemas/`, `adapters/codex.facts.json`,
`packages/proof/src/types.ts` and `packages/record/src/index.ts`. The copy holds none of them. A lane that passed such
a tree would pass with nine checks unrun, against invariant 2, so a file it can't read is a finding. No criterion of
#2339 says which files the lane reads.

The owner ruled on November 25: the dispute and a redraft, not a lane that makes no comparison in a tree without those
files.

## The redraft

It stands in for the four files whole, ten tests under the same criterion IDs, and copies the checkout's whole tree as
#1329's and #2405's helpers do. On #1876's change all ten pass; at the base all ten pass and each fails on a wrong
program (`BASE-RESULTS.txt`). The four files of the first draft are kept as written and run by hand
(`scripts/lanes.mjs`, beside #3178's); `ac1-section.test.mjs` and `lane.live.test.mjs` run as before.

Two things about how it was drafted, for whoever weighs it:

- Its brief said one thing the first draft's inputs didn't: that a closed issue's suite runs on every later main, where
  the lane may read files it doesn't read today, so a scratch copy holds the whole tree and never a selection of
  folders. It didn't say what the lane reads now, name #1876's checks or say what failed.
- The job reports one slip against its read limits: it ran `git rev-parse origin/main` once, read nothing of that
  commit, and rests no test on it (its README, What was read).
