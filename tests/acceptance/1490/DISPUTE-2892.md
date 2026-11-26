# Dispute under #2892: criterion 2 (`picks.test.ts`, through `setFailures` in `helpers.ts`)

#2892 stores the player's WebAssembly as gzip, named by the SHA-256 of its stored bytes, and #172's helpers (which stay)
hold the receipt's `player.hash` to be one of the receipt's files, by the SHA-256 of the file on disk. `setFailures`
holds `player.hash` to be the set's raw WebAssembly (`sets.json`) and looks for that SHA-256 among the bundle's files as
stored, so it fails on the right program. Run on #2892's change (`57c499110`):

    the 2D slider fixture: the receipt's player e135b9214d7907ac5b2041422ffd5289fb807fce461fd833a768b1dbe98c50f8 is not the set figure's e361ec7148ba6675dc758a6aaad2ae74d3634c716f5a6cec249b996c431ec464
    the 2D slider fixture: the bundle doesn't hold the set figure's player e361ec7148ba6675dc758a6aaad2ae74d3634c716f5a6cec249b996c431ec464

The test went to a blind redraft, `tests/acceptance/1490-redraft-2892/`, which finds the set's player in the bundle in
any stored form and runs in this file's place (`scripts/lanes.mjs`). `picks.test.ts` moves to the by-hand list; the
suite's other files stand.
