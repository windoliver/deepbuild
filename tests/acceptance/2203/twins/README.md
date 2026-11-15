# Twins for the 2203 tests

Criteria 3 and 4 already hold on the base, so their tests can't fail there. Each has a planted wrong program here, and
`../twins.json` names it. The `before` lane lays a twin's files over a copy of the change, builds the copy and runs the
tests in it.

Each twin is the base's `packages/hub/src/service.ts` (`1c4d1f0e2`) with lines added and none changed, each marked
`Planted`. It keeps every export the base has. The plant sits in `launch`, which `deep hub start`, setup and the first
`deep` command all reach, so the twin is wrong for every way in, #1359's and #1002's suites included.

| Criterion | Twin | What it plants | Why it is the criterion's wrong program |
|---|---|---|---|
| `#2203.e7d67ec1` (a real home loads as before) | `every-home` | On macOS, with no launcher named, every home counts as a temp home and is refused before any `launchctl` call | It is the rule about temp homes without its condition. A home outside every temp folder gets no bootstrap, so the third test fails at its `expect`. A home that names a launcher still reaches it, so the fourth test passes |
| `#2203.c433bc9f` (a test that names a launcher is unchanged) | `launcher-ignored` | On macOS, a home under `/tmp`, `/private/tmp`, `/var/folders` or `/private/var/folders` is refused before `DEEP_HUB_LAUNCHER` is read | It is the rule without its exception. A temp home that names a launcher never hands it the definition, so the fourth test fails at its first `expect`, and #1359's and #1002's suites would fail with it. A real home loads as on the base, so the third test passes |

A twin replaces the whole file, so the fix's own lines in `service.ts` are gone under it, and both plants refuse a temp
home wherever its `launchctl` sits. So the second test, whose control needs a temp home with a `launchctl` under a temp
folder to load, reads BLOCKED on both twins. Neither twin is named for the first two criteria: the merge base is their
wrong program.

A fix that adds an export to `service.ts` which another module imports stops a twin from building. The lane then says
BLOCKED for that twin, naming the build, and the twin goes back to a blind redraft; no one edits it in place.
