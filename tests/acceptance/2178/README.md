# Acceptance tests for #2178: repo rules and public text pass on main

Written first and blind, at base `96a56e88`, as a prerequisite of #2326. Inputs: the issue body and its one comment
(identical to the live issue read with `gh issue view -R` on 2026-11-12), AGENTS.md, `docs/technical-design.md` (Built
to be hard to get wrong, Dogfooding) and the base's `scripts/repo-rules.mjs`, `scripts/public-text.mjs`,
`scripts/open-issues.mjs` and `scripts/proof-change.mjs`. The implementing agent doesn't edit these files.

| Criterion | Test in `lint-lanes.test.mjs` | Proof |
|---|---|---|
| `#2178.0caa17d8` `node scripts/repo-rules.mjs` exits 0 on main | `#2178.0caa17d8 …` | exit 0, a `PASS deps:` line, no `FAIL deps:` line and no FAIL, INVALID, BLOCKED or INCONCLUSIVE line |
| `#2178.746911e1` `node scripts/public-text.mjs` finds no listed name in an open issue | `#2178.746911e1 …` | the lane read the open issues (no INCONCLUSIVE, no "not read"), printed no `#n:line` hit, and its summary is either the pass line over more than 0 issues or a FAIL with `0 in open issues` |

The second criterion covers open issues only. A hit in the change's own lines is the change's lane, not this
criterion. Unread issues fail the test and are never taken as clean. The test drops `DEEP_OPEN_ISSUES`, so it fetches
the issues live through `gh issue list`. That needs network and a `gh` that resolves the repository. A checkout whose
`origin` isn't GitHub needs `GH_REPO=<owner>/<repo>` set.

## How to run

```sh
node --test tests/acceptance/2178/lint-lanes.test.mjs
```

## At the base (drafting run, `../2178-base.log`, 2026-11-12)

- `#2178.0caa17d8` fails. repo-rules prints 22 `FAIL deps` lines. The issue named 3 and its comment named 12. Seven of
  the 22 are new since the comment: `deep-codecs`, `deep-gpu-layer` (3) and `deep-typeset` (6). There are also
  `FAIL secrets: tests/acceptance/1575-redraft-ac1/BASE-FAILURE.txt:11:14: home path` and two `FAIL cards` lines
  (`crates/deep-images` has no card; `crates/deep-canvas-physics/README.md:29` names a missing `budget`). Exit 0 needs
  all of them gone.
- `#2178.746911e1` passes already. #1720 is closed (live, updated 2026-11-11), so no open issue holds a listed name.
  This test fails on no wrong program at this base. The live issue state, not the code, decides it. It was run with
  `GH_REPO` set, because this checkout's `origin` is a local path.
