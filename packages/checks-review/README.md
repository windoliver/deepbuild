# @deepbuild/checks-review

## What it is for

The review check plug-in (#87): check kind `review`, where a second model reads the diff alone against the wiki's rubric and its valid findings come back as one send-back of structured items (file, line, rule and the quoted text), with its prose folded away. Code filters every finding: one without its four fields, quoting text not at its cited line or citing a rule the rubric lacks is dropped and counted; one on a context line is pre-existing; one already sent back on the claim stays open. It also decides whether a review counts (the answering model against the change's, by canonical ID and family), records how each sent-back item ended, runs the review passes that found bugs after a close before "Closes", and replays its cases for the preflight's replay lane. `tests/acceptance/87/review`, `models` and `gate` drive it. The hub holds the kind in its kind table (`packages/hub/src/kinds.ts`, #1537) and runs it, through a runner job, on every claim that opens or updates a pull request.

## Where new code goes

- `src/index.ts`: the entry and the fill; `src/review.ts`: one run and how an answer is judged; `src/diff.ts`: reading `git diff`.
- `src/models.ts`: whether a review counts, and a review job's run; `src/outcomes.ts`: fixed or left; `src/post-close.ts`: the post-close passes; `src/replay.ts`: the replay over `replay/`.
- `src/kit.ts`: the `check.kind@1` kit; `src/types.ts`: the shapes.
- `replay/`: the replay's cases, each a diff with the second model's recorded answer, made from `tests/acceptance/87/review/fixtures`.
- Regression tests go in `test/`; the acceptance suite is `tests/acceptance/87/review` (never edited).

## What it may import

A plug-in on the core: `@deepbuild/conformance`, `@deepbuild/adapters` (facts and routes), `@deepbuild/runner` and `@deepbuild/verdicts` (types), and `node:` built-ins, through their public entries. It never imports the record, the hub, CLI or app.

## Deviations

None.
