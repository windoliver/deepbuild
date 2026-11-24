# Twins for the 3088 tests

`../twins.json` names them. Each replaces one file of `packages/conformance/src/` with the change's own, one rule
changed and marked `Planted:`. The implementing session wrote them, not the blind job.

| Twin | What it gets wrong | The tests that fail on it |
|---|---|---|
| `no-platform-packages` (`gate-play.ts`) | `makeWorld` copies a case's installs alone, none of the `os`/`cpu` optional dependencies npm installed for them, so a world from the shipped manifest (darwin entries removed) has no rolldown or lightningcss binding | the macOS arm64 tests (`#3088.301242f7`) in `plays.test.ts` and `worlds.test.ts` |
| `refuses-parents` (`gate.ts`) | `gate check` also refuses an install whose optional dependencies include a platform's own package, so the shipped manifest's `rolldown`, `lightningcss` and `vite` are refused | `check.test.ts`, "the shipped manifest names no lockfile-marked install and passes the check" (`#3088.be450fed`) |

Why these two: `../BASE-FAILURE.txt` shows the macOS play test passing on the merge base, where the manifest still
lists the darwin folders. The shipped-manifest check passes on the merge base once the proof lanes lay the change's
manifest over it. Each gets the wrong program nearest the change. The other tagged tests fail on the merge base
itself (`../BASE-FAILURE.txt`).
