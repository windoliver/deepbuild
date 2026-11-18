# #1812's proof: the table on the merge base beside the change, and the exit table read from the code

The issue's Proof asks for two things. This folder holds the change's side of both. The merge base's side is the blind suite's own record.

## The table test, on the merge base

`tests/acceptance/1812/BASE-FAILURE.txt` is the blind suite run at the merge base `16dc5eab0`, with nothing of #1812 in it. 11 of 12 tests fail. AC1 fails on all 56 commands that call the hub, in a home set up with its hub stopped. 54 of them print the socket's error with its path twice and `ENOENT`, 42 of those under BLOCKED, and 7 exit 1. `deep inbox` and `deep status` print the database's list with no fix. AC2 fails on all 40 commands outside the first-run list, each in a home nobody set up. 35 of them print the raw `ENOENT … control.token`.

## The table test, on the change

The blind suite passes 12 of 12 on the change merged with main (`9063f49f2`): `Test Files 8 passed (8); Tests 12 passed (12)`.

Beside it, every `deep` command form (140, the Nov 13 audit's set) was run on the same commit by `forms.mjs` and summed by `sum.mjs`. The run uses #1812's blind world, in which the installer, `curl`, `wget`, `claude` and the service managers are stand-ins. Each table has one line per form: the command, its exit, any flag (`errno`, `path2x`, `BLOCKED`, `unsupported`, `SILENT`, `json`, `wrote(n)`), and its first line.

| Measure | Hub stopped, home set up (`hub-stopped.table.txt`) | Home nobody set up (`never-set-up.table.txt`) |
|---|---|---|
| Forms that name the hub | 64 | 67 |
| Print an errno | 0 | 0 |
| Print a path twice | 0 | 0 |
| Open with BLOCKED | 0 | 0 |
| Name the one fix | 64 | 67, each `deep setup` outside the first-run list |
| Exit 3 | 60; the other 4 are `deep doctor`'s two forms (1: its hub item failed) and `deep lease`'s two (its command's own code, 0 and 127) | 63; the same other 4 |
| A listed command answering "Unsupported command" | 0 | 0 |
| JSON without `--json` | 0 | 0 |
| Node stack traces | 0 | 0 |

The audit measured the same forms at main `9b77cd2cd` (reports/uiux-agentic-audit-2026-11-13.md) with the hub stopped. 64 forms named the hub, with 24 different first lines. 59 printed an errno and the socket's path twice, 46 opened with BLOCKED, 10 named a fix, 52 exited 3 and 10 exited 1.

The first-run commands in a home nobody set up (`wrote(1)` in the second table) set the home up first. That is #2200's.

## The exit table, read from the code

`exit-table.txt` is `node scripts/exit-lint.mjs` on the same commit, the lint lane's command. It prints one `exit <n> <path>:<line>` line per place a command's exit is set, read through the checker. The table has 189 places, each 0, 1, 2 or 3. `deep lease` and `deep mcp-exec` are left out by name. At the merge base the same lint fails on `packages/hub/src/setup.ts:231` and `:237`, where a setup whose wiki wasn't read exited 4.

## Rerun

From the checkout, with the workspaces built and deep-hook built under `target/debug`:

```sh
node docs/evidence/1812/forms.mjs "$PWD" down down.jsonl && node docs/evidence/1812/sum.mjs down.jsonl hub-stopped.table.txt
node docs/evidence/1812/forms.mjs "$PWD" fresh fresh.jsonl && node docs/evidence/1812/sum.mjs fresh.jsonl never-set-up.table.txt
node scripts/exit-lint.mjs > exit-table.txt
```
