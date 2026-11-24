# #27's twins as their wrong lines (#1832's line form)

A blind redraft job converted each twin `twins.json` names from whole copied files into the one file `lines.json`
that `tests/acceptance/1832/README.md` ("The line form") defines. Each twin is the same wrong program it was.

## What it read

- `AGENTS.md`; `docs/technical-design.md`, "Wrong programs" and "Failing on an assertion";
- `tests/acceptance/1832/README.md` and its tests;
- this suite's `README.md`, `twins.json` and the twins' whole files, and the commit that added them (eed2f6b68),
  with `packages/hub/src/plant.ts` and `setup.ts` at its parent, to find what each copy plants;
- `packages/hub/src/plant.ts`, `setup.ts` and `claude-settings.ts` (`claudeCommand`) at the base `11eb8c6fd`, and where
  the hub reads the plant (`plantOf` in `server.ts`, `activePlant` elsewhere).

## Each twin's planted change

Every whole-file `plant.ts` twin made `plantOf` and `activePlant` return the twin's name whatever `DEEP_HUB_PLANT`
says (unset, another plant or an unknown name). Each `lines.json` now plants exactly that over today's `plant.ts`, in
two edits: `plantOf`'s first line, `if (!value) return undefined;`, becomes `value = '<twin>';` (so the existing check
and return yield the twin, which every one of these names passes), and `activePlant` returns `'<twin>'`.

- `waiter-never-wakes`: the hub acts as waiter-never-wakes (AC1).
- `repeat-reaches-you`: the hub acts as repeat-reaches-you (AC2).
- `wake-assumed`: the hub acts as wake-assumed (AC3).
- `skip-default-at-deadline`: the hub acts as skip-default-at-deadline (AC4).
- `answer-skips-held-stop`: the hub acts as answer-skips-held-stop (AC4).
- `waiter-checks-every-5s`: the hub acts as waiter-checks-every-5s (AC5).
- `waiter-outlives-session`: the hub acts as waiter-outlives-session (AC4), and a third edit, in `setup.ts`, puts
  `DEEP_HUB_PLANT=waiter-outlives-session ` before the waiter entry's command (today `claudeCommand(hook, 'waiter')`),
  so deep-hook's waiter reads the plant from its own environment. That one line was the whole copy's only change
  against `setup.ts` of its time.

## How it was checked

- A throwaway script applied each `lines.json` by the line form's rules to copies of the base's files: every `find`
  matched exactly once, no edits overlapped, the last line end was kept, and the diff was only the lines above.
- The edited `plant.ts` (and for `waiter-outlives-session` also `setup.ts`, with the hub sources it imports) passed
  `tsc --noEmit` with the root `tsconfig.json`'s settings.
- Loaded with Node 24, each edited `plant.ts` gave the twin's name from `plantOf` and `activePlant` with
  `DEEP_HUB_PLANT` unset, set to another plant, and set to an unknown name; the base's gave `undefined` unset.
- `find tests/acceptance/27/twins -type f`: each named twin folder holds only `lines.json`.
- `node --test tests/acceptance/1832/plant.test.mjs` at this base (old lane) fails, as expected: #27's seven twins
  read `FAIL before: ... fails on neither the merge base nor its planted wrong program` (the old lane lays
  `lines.json` as a stray file), #25's four whole-file twins read BLOCKED on the build; nothing said a `lines.json`
  was malformed or missing.

Not run: #27's own tests against each twin (they need a workspace build), and the line-form lane, which doesn't exist
at this base.
