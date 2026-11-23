# Twins for the 3088 tests

`../twins.json` names them. Each replaces `packages/conformance/src/gate-play.ts` with the change's own, one rule
changed and marked `Planted:`. The implementing session wrote them, not the blind job.

| Twin | What it gets wrong | The test that fails on it |
|---|---|---|
| `no-platform-packages` | `makeWorld` copies a case's installs alone, none of the `os`/`cpu` optional dependencies npm installed for them, so a world from the shipped manifest (darwin entries removed) has no rolldown or lightningcss binding | `play.test.ts` and `world.test.ts`, the macOS arm64 tests (`#3088.301242f7`) |

The other tags fail on the merge base itself (`../BASE-FAILURE.txt`): `#3088.fa98a351` on both platforms (no binding
folder is copied), `#3088.be450fed` on both (the check refuses nothing), and `#3088.bb512932` on Linux (`cp: cannot
stat …/binding-darwin-arm64`). The macOS play test passes on the merge base, where the manifest still names the darwin
folders; this twin is its wrong program.
