# #25's twins as their wrong lines (#1832)

A blind redraft job converted the four twins `twins.json` names from whole copied files into the line form of
`tests/acceptance/1832/README.md` ("The line form"). Each twin is the same wrong program it was.

## What I read

`AGENTS.md`; `docs/technical-design.md` ("Wrong programs", "Failing on an assertion"); `tests/acceptance/1832/README.md`
and its `plant.test.mjs`; this suite's `twins.json`, its README files (the plant table in `routes/README.md`) and the
twins' whole files; today's `packages/hub/src/plant.ts` and `setup.ts`; and, from history, the `plant.ts` and `setup.ts`
of `68eafeaad`, the commit that last wrote the twins, to find what each copy changed.

## Each twin's planted change

The plant copies differed from the right `plant.ts` of their time in one line, `plantOf`'s answer when
`DEEP_HUB_PLANT` is unset; the rest of each copy was the module as it stood. `activePlant` was the right one in every
copy, and stays so. Each `plant.ts` edit finds two lines in a row, `plantOf`'s first line and the `if (!value)` line
below it, and repeats the first in `wrong`, so it can apply only inside `plantOf`. The `setup.ts` edit finds the one
line that builds the waiter's command, which no other line of `setup.ts` holds.

- `waiter-never-wakes`: `plantOf(undefined)` returns `'waiter-never-wakes'`, so the hub acts as that plant.
- `waiter-outlives-session`: `plantOf(undefined)` returns `'waiter-outlives-session'`; and setup writes the waiter's
  entry as `DEEP_HUB_PLANT=waiter-outlives-session` before the waiter's command, so the waiter acts as it too.
- `routes-from-settings`: `plantOf(undefined)` returns `'routes-from-settings'`.
- `routes-kept-across-sessions`: `plantOf(undefined)` returns `'routes-kept-across-sessions'`.

## How I checked it

- A throwaway script outside the repo applied each `lines.json` to copies of today's files: every `find` matched at
  exactly one place, and a diff of each result against today's file showed only the lines above.
- With each twin's files laid, `tsc --noEmit -p packages/hub` (the root tsconfig's settings) exited 0.
- Each edited `plant.ts`, built alone and imported with `DEEP_HUB_PLANT` unset, gave `plantOf(undefined)` = the twin's
  plant and `activePlant()` = `undefined`, as the whole copies did.
- Each twin's folder holds only `lines.json`.
- `node --test tests/acceptance/1832/plant.test.mjs` on this base (the old lane): each of the four #25 tests read
  `FAIL ... fails on neither the merge base nor its planted wrong program`, the result that README states for converted
  twins under the base's lane, with no word of a malformed `lines.json`; #27's twins, still whole files, read BLOCKED.
