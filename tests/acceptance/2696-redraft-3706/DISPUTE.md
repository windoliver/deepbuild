# Dispute: `tests/acceptance/2696/base.test.mjs` (#3706)

## What the first draft compares

Each of its five tests builds `git merge-base HEAD origin/main` in a scratch folder (`helpers.mjs`, `trees`) and
compares this checkout's build with that build:

- `#2696.5a61170b`: BLOCKED unless 53 or more of the merge base's built files hold a character above U+00FF, then
  asserts none of this build's do.
- `#2696.6fbf771a`: every message with such a character, and each package's exports and printing, equal the merge
  base's.
- `#2696.534150b4` (two tests): each built file has the merge base's number of lines; an error thrown from
  `packages/hub/dist/core.js` names the merge base's line, BLOCKED unless that line comes after the merge base's first
  character above U+00FF in the core.
- `#2696.be4d3304`: the core thread's heap is at least 1.2 MB under the merge base's.

That was right for #2696's own change, whose merge base lacked the escape step.

## Why it fails or BLOCKs every later PR

Since #3197 landed, every merge base already builds with the escape step. The merge base is then no build without the
fix, so each comparison either cannot run or measures the PR's own edits. #3706, from #3468's owed cut (a Mac fresh
clone, scratch merge a8e316e70 = 73b020c29 + main 894a293f2, run alone with `node --test`):

- `#2696.5a61170b`: BLOCKED. The merge base has a character above U+00FF in 0 built files, where the issue says 53 or
  more.
- `#2696.534150b4` (same number of lines per built file): fails for any PR that adds or removes a line in a built
  package source. #3468 adds one line to `packages/hub/src/core.ts` and eight to `answer-delivery.ts`, so it fails:
  `packages/hub/dist/answer-delivery.js: 1387 lines in this build, 1379 on the merge base` and
  `packages/hub/dist/core.js: 2916 lines in this build, 2915 on the merge base`.
- `#2696.534150b4` (an error thrown from core.js names the same line): BLOCKED. The merge base's errors are not after a
  character above U+00FF.
- `#2696.be4d3304` (heap at least 1.2 MB under the merge base's): fails. The heap reads 22.653 MB in the build against
  22.661 MB on the merge base, which is equal within noise, because the saving is already on main.

The message test (`#2696.6fbf771a`) still runs but can no longer fail for the step: both builds escape, so it compares
the step with itself and fails only when a PR edits a message.

## What this redraft checks instead

The escape step's effect is judged against the one tree that differs from this build by the step alone: this same
checkout, copied, with its built output removed, `scripts/built-escapes.mjs` replaced by a program that does nothing,
and built again with `npm run build --workspaces`. A PR's own source edits are in both builds, so they never show; a
wrong escape step shows whatever the merge base holds.

- `#2696.5a61170b`: checked directly. No built file of this checkout holds a character above U+00FF; BLOCKED only when
  no source of a built package holds one, since the build would then have nothing to escape.
- `#2696.534150b4`: each built text file has as many lines as the same file built without the step, and the two errors
  the core throws name the lines they name without the step (BLOCKED unless those lines come after the unescaped
  core's first character above U+00FF).
- `#2696.6fbf771a`: every message with such a character, every exported string and what the packages and
  `deep --help` print equal those of the build without the step.
- `#2696.be4d3304`: the core thread's heap, median of five readings a side, is at least 1.2 MB under that of the build
  without the step.

Each has a planted wrong escape step (`twins/`) that it fails at its assertion; see the README.
