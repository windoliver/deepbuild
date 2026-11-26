# Twins for the 3430 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is the merged
implementation with exactly one rule broken as below, and nothing else changed. A twin replaces product files only,
never a file under `tests/`, at `twins/<name>/<path of the file it replaces>`. #55's plugin reads its planted wrong
program in `packages/paseo/server/plant.ts` alone (#55 README, Plants), so a plugin twin may be that file with the
plant's name fixed, once the implementer adds the plant to `plugin.ts`; a hub or facts twin replaces whichever of
`adapters/paseo.facts.json` or `packages/hub/src/*.ts` holds the rule.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where | Planted here? |
|---|---|---|---|---|---|
| `#3430.98bfee96` | `canceled-as-failed` | `packages/paseo/server/plant.ts` (the plugin) | paseo's `canceled` outcome is sent as `failed`, as the merge base does | `a Copilot turn canceled …`: "an interrupted turn has no stop, but the record holds agent.stop … outcome failed" | Yes: it is the merge base's behavior (`../BASE-FAILURE.txt`) |
| `#3430.77661745` | `failed-as-canceled` | `packages/paseo/server/plant.ts` | every outcome but `completed` is sent as `canceled`, so a failed turn reads as interrupted | `a turn that failed with the error "rate limit" …`: "the failed turn is a stop" (no stop), or the outcome/cause check | No: the base fails this test already (cause `unknown`), so a plant on it proves nothing |
| `#3430.77661745` | `completed-as-failed` | `packages/paseo/server/plant.ts` | a `completed` outcome is sent as `failed` | `a completed turn is still a finished stop`: "one finished stop … expected ['failed'] to deeply equal ['finished']" | Yes: planted for one run in this job's worktree by editing the plugin's outcome line, then restored with `git checkout`; failed there as named |
| `#3430.920b7e03` | `prompt-keeps-interrupt` | the file that clears the reading (hub `status.ts`/`session-state.ts`, the facts, or the plugin if it is the plugin's line that ends it) | a canceled turn's interrupted reading survives the session's next `agent.turn.before`: the next prompt doesn't clear it | `your next prompt in the session clears …`: "your next prompt clears the interrupted reading" (the row still reads `its turn was interrupted`) | No: the base fails the test's first assertion, so no plant on it reaches the second |
| `#3430.5c4cf6e4` | `unlisted-as-failed` | `packages/paseo/server/plant.ts` | an outcome kind other than `completed`, `failed` and `canceled` is sent as `failed`, the wrong program the criterion names | `an outcome the facts don't list …`: "the record names the outcome paseo gave (timed_out)" | Yes: it is the merge base's behavior (`../BASE-FAILURE.txt`) |
