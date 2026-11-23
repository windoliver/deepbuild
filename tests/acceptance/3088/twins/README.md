# Twins for the 3088 tests

`../twins.json` names them. Each replaces one file of `packages/conformance/src/` with the change's own, one rule
changed and marked `Planted:`. The implementing session wrote them, not the blind job.

| Twin | What it gets wrong | The test that fails on it |
|---|---|---|
| `no-platform-packages` (`gate-play.ts`) | `makeWorld` copies a case's installs alone, none of the `os`/`cpu` optional dependencies npm installed for them, so a world from the shipped manifest (darwin entries removed) has no rolldown or lightningcss binding | `play.test.ts` and `world.test.ts`, the macOS arm64 tests (`#3088.301242f7`) |
| `refuses-parents` (`gate.ts`) | `gate check` also refuses an install whose optional dependencies include a platform's own package, so the shipped manifest's `rolldown`, `lightningcss` and `vite` are refused | `check.test.ts`, "with no such entry, the shipped manifest passes gate check" (`#3088.be450fed`) |

The other tests fail on the merge base itself (`../BASE-FAILURE.txt`): `#3088.fa98a351` on both platforms (no binding
folder is copied), the two `#3088.be450fed` refusals on both (the check refuses nothing), and `#3088.bb512932` on
Linux (`cp: cannot stat …/binding-darwin-arm64`). The macOS play test and the shipped-manifest check pass on the merge
base once the proof lanes lay the change's manifest over it, so each has a twin here.
