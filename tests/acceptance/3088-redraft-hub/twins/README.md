# Twins for the 3088-redraft-hub tests

`../twins.json` names them. The implementing session wrote them, not the blind job.

| Twin | What it gets wrong | The test that fails on it |
|---|---|---|
| `no-platform-packages` (`packages/conformance/src/gate-play.ts`, the same as `../../3088/twins/no-platform-packages`) | `makeWorld` copies a case's installs alone, marked `Planted:`, so a world from the shipped manifest (darwin entries removed) has no rolldown or lightningcss binding and the plays can't be judged PASS | `play.test.ts`, the macOS arm64 test (`#3088.301242f7`) |

The Linux test (`#3088.bb512932`) fails on the merge base itself (`../BASE-FAILURE.txt`): `cp: cannot stat
…/binding-darwin-arm64`. The macOS test passes there, where the manifest still names the darwin folders; this twin is
its wrong program.
