# Twins for the 3067 tests

The merge base has no `load` command, so every test already fails there at its assertion (`../BASE-FAILURE.txt`).
The issue's criteria still name planted wrong samplers, and `../twins.json` names them. Each replaces
`scripts/throttle.mjs` with the change's own, one rule changed and marked `Planted:`. The implementing session wrote
them, not the blind job.

| Twin | What it gets wrong | The test that fails on it |
|---|---|---|
| `by-name` | A process named `node`, `rustc` or `cargo` counts as outside's, whatever grant it is under | `sample.test.mjs`, one stub grant and one ungranted process |
| `counts-twice` | A process counts under every grant above it | `sample.test.mjs`, two nested grants |
| `zeros-on-failure` | A reading that failed is written as zeros | `ps-failure.test.mjs` |
| `logs-arguments` | `ps`'s whole command line in place of the command's name | `sample.test.mjs`, the log's strings |
| `every-minute` | The report's shares are over every minute read, above the cores or not | `report.test.mjs`, the first and the last |

The cost test and the report's thirds test pass on these twins and fail on the merge base only.
