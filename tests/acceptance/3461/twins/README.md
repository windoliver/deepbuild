# Twins for the 3461 tests

No implementation existed when these tests were drafted, so no twin folder is here yet. Each twin is the merged
implementation with exactly one rule broken as below, and nothing else changed: same usage lines, same exits, same
calls. A twin replaces product files only, never a file under `tests/`: it goes at `twins/<name>/<path>` for each file
it replaces (for example `twins/first-wins-reader/packages/hub/src/<file>.ts`). Where the merged change reads flags in
one shared reader, a twin breaks the rule there; where each command keeps its own reader, the twin replaces the files
the rule needs and says so.

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails, and where |
|---|---|---|---|---|
| `#3461.bffe987a` | `first-wins-land-work` | the file(s) that read `deep land`'s and `deep work`'s flags (today `packages/hub/src/land-command.ts`) | `deep land`, `deep land judge` and `deep work --once` read a repeated `--repo` as the merge base does: the first value wins and the command calls the hub on it | `first-wins.test.ts`: "3 of 3 commands acted on a repeated --repo", each line naming the command, its exit (0), and `land.round`/`land.judge`/`work.once` on `<tmp>/A`. The merge base fails here the same way |
| `#3461.7c168213` | `last-wins-show-env-find` | the file(s) that read `deep show`'s, `deep env`'s and `deep find`'s flags (today `packages/hub/src/show.ts`, `packages/hub/src/env.ts`, `packages/reading/src/index.ts`) | A repeated `--doc` or `--root` is read as the merge base does: the last value wins and the command acts on it | `last-wins.test.ts`: "3 of 3 commands acted on a repeated flag", each line naming the command and the hub that got the call (`canvas.show` with doc `Y`; `env.up` and `handle.read` at `b`). The merge base fails here the same way |
| `#3461.b4a5c8f4` | `first-wins-reader` | the shared flag reader (or every command's) | A flag shown once and given twice takes its first value; the command runs on it | `table.test.ts`: the failures list names each row `deep <command> <flag> (two values \| one value repeated)` whose command acted (exit other than 2, or output on stdout) |
| `#3461.b4a5c8f4` | `last-wins-reader` | the shared flag reader (or every command's) | A flag shown once and given twice takes its last value; the command runs on it | `table.test.ts`, as above. On the merge base the table fails on the rows of the commands that read first-wins or last-wins today |
| `#3461.1bda0a26` | `repeats-refused` | the shared flag reader (or `packages/hub/src/start-command.ts`) | A flag the usage shows repeating (`--home`, `--mode`, `--host` on `deep start approve`) is refused when given twice, like a flag shown once: usage, exit 2 | `host-repeats.test.ts`: "deep start approve with two --host flags asks the hub for one run" (0 calls). A twin that keeps only the last `--host` fails at "the run it asks for names both hosts, in order" instead |
| `#3461.a80d1545` | `once-refused` | the shared flag reader | A flag given once is counted as given twice (the reader sees each flag's first use as a repeat, for example by checking the flag against the arguments with the flag itself still in them), so every command given one of its value flags prints its usage and exits 2 | `once.test.ts`: "N of M commands given each flag once print or exit otherwise than on the merge base", each line naming the command, the merge base's exit and output and the twin's (`code 3 on the merge base, 2 now` and the usage on stderr) |

`#3461.bffe987a`, `#3461.7c168213` and `#3461.b4a5c8f4` fail on the merge base at their assertions (`../BASE-FAILURE.txt`):
the merge base is `first-wins-land-work`'s and `last-wins-show-env-find`'s behavior, and both readers' on the table's
rows for those commands. The issue asks for the planted readers by name, so they keep their twins. `#3461.1bda0a26` and
`#3461.a80d1545` pass on the merge base, which is today's behavior; their twins are their only proof of failing first.
