# Dispute under #2892: criterion 3's shared-memory test (`hashes.test.ts`, second test) and criterion 4's size test (`budgets.test.ts`, second test)

#2892 stores the player's WebAssembly as gzip, named by the SHA-256 of its stored bytes, and the page inflates it after
checking those bytes (the decision on the issue: gzip). Both tests below find the player by WebAssembly's first bytes
(`isWasm`), so on a bundle stored as #2892 says they no longer see it.

- `hashes.test.ts`, "the player's WebAssembly declares no shared memory, …": it finds no WebAssembly file and fails on
  the right program. Run on #2892's change (`57c499110`): `the bundle holds WebAssembly: the player: expected 0 to be
  greater than 0`. The file's first test (a logic program one byte off its hash) passes there and isn't disputed.
- `budgets.test.ts`, "the lab's player is under 12 MB compressed …": it counts the scripts alone and passes on a player
  of any size. Run on the change: `the player: 35849 bytes compressed (Brotli 11) in 3 files`. #2892's criterion 3 asks
  for this redraft by name.

Each went to a blind redraft, which runs in its place (`scripts/lanes.mjs`): the shared-memory test in
`tests/acceptance/172-redraft-2892/` (with criterion 2's secrets search, which a gzip-stored file would hide from the
first draft's `refusals.test.ts`), and the size test in `tests/acceptance/172-redraft-ac4/`. `hashes.test.ts` moves to
the by-hand list. `budgets.test.ts` stays in the timed lane for its other two tests.

Seen in the same run, and not #2892's: `budgets.test.ts`'s timed test reads `probe()` as if it were synchronous
(`JSON.parse(JSON.stringify(p.probe()))`), but `probe()` is `async` at the merge base `5f5791e2d` too, so on a reference
Mac in a fit state it fails at `probe().checkpoint_hashes is an object, got undefined` whatever the change.
