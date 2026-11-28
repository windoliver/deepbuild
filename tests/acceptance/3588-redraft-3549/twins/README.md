# Planted twin of the redraft (#3588 under #3549)

`skips-the-rebuild` is the first draft's twin of the same name (`tests/acceptance/3588/twins/skips-the-rebuild/`), its
`lines.json` copied as it is: the timed jobs' loop no longer checks the run's binaries before a timed job, so a binary a
cleanup removed stays removed. `#3588.704a8c75` (`granted.test.mjs`) passes on the merge base, so this twin is its wrong
program: the redrafted test fails on it with "no build grant was granted to the run once the holders let go: nothing was
built again of what the cleanup removed". `#3588.7a8aaa71` fails on the merge base at its criterion.
