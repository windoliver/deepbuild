# Acceptance tests for #3461: a flag given twice is a usage error in every deep command

Written blind, by a job that read only the issue, the design and the base commit; it never saw the implementing work.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## Sources

- Issue #3461 as `gh issue view 3461` printed it on 2026-11-24 (body: Scope, five criteria, Proof; no comments).
- `docs/technical-design.md`: One hub per user, a tiny hook client, and extensions in-process (the deep CLI row: "A
  listed command whose arguments fit none of its forms prints its own usage and exits 2", and the exit table: 2 is "not
  understood, nothing ran"); Socket roles and contract versions (the cli role, the control token); Dogfooding.
- `AGENTS.md`.
- The base commit `1b4929ae7977aa4bfe62b03e0ef39674be9e8a27` (origin/main, 2026-11-24): `packages/cli/src/main.ts` (the
  usage lines `deep --help` prints, the dispatch); in `packages/hub/src/`: `land-command.ts`, `start-command.ts`,
  `show.ts`, `env.ts`, `canvas.ts` (export), `remote.ts` and `people.ts` (join's invite), `client.ts` (the socket
  protocol: hello, the cli role, one call), `paths.ts` (where a command finds the hub and its token), `compat.ts`,
  `generations.ts`; `packages/reading/src/index.ts` (read and find). Suites, for conventions: `tests/acceptance/1812/`
  (its world, stand-ins and child-process runner, adapted in `helpers.ts`; its `fixtures/stub-bin.sh` is reused as it
  is), `1359`, `3433`.

## Run them

Node 24, with the workspaces built (the tests run `packages/cli/dist/main.js`):

```sh
npm ci && npm run build --workspaces     # once
npx vitest run tests/acceptance/3461/
```

Five tests in five files; on the base the suite takes about 15 s (`BASE-FAILURE.txt`). Every test runs `deep` as a
child process in a throwaway home under `/tmp/dh3461-*` (setup marked finished, the login service and service managers
stood in, the OS confirmation answered `cancelled`), so nothing reaches your home, your hub or the network. No test
holds a port or the screen, so there is no `lane.json`.

## Criteria to tests

Each test's name starts with its criterion's tag (`#3461.` and the first 8 hex digits of SHA-256 of the criterion's
text, white space collapsed; checked against the live issue body).

| Criterion | Test (file) | What it requires | Wrong program |
|---|---|---|---|
| `#3461.bffe987a` `deep land --repo A --repo B`, `deep land judge --repo A --repo B` and `deep work --repo A --issues 1 --once --repo B` each print their usage, exit 2 and send the hub nothing. On the merge base each acts on A, and this test fails, naming the command | `first-wins.test.ts` | A stand-in hub at the home's socket (with its control token). For each of the three commands: exit 2; a line of output that starts `Usage:` and names `deep land` / `deep work`; and the stand-in received no line at all from it (no hello, no call) | Twin `first-wins-land-work`. The base fails here: each exits 0 after `land.round` / `land.judge` / `work.once` on `<tmp>/A` |
| `#3461.7c168213` `deep show --doc X --doc Y --document f.json`, `deep env up --root a --root b` and `deep find x --root a --root b` each print their usage and exit 2. On the merge base each acts on the later value, and this test fails, naming the command | `last-wins.test.ts` | Stand-in hubs at the home, at `a` and at `b`. Each command exits 2 and prints a `Usage:` line naming it. A failure says which hub got which call | Twin `last-wins-show-env-find`. The base fails here: `canvas.show` with doc `Y`, `env.up` at `b`, `handle.read` at `b`, each exit 0 |
| `#3461.b4a5c8f4` A table test gives every command `deep --help` lists each flag its usage shows once, twice: with two values, and with one value repeated. Each prints that command's usage and exits 2, with nothing on stdout. A planted reader that takes the first value and one that takes the last each fail, naming the command and the flag | `table.test.ts` | The flags are read from `deep --help`'s own usage lines (below). For each form in `helpers.ts` and each flag its line shows once that takes a value: the form given once must not exit 2 (else the row is BLOCKED: its repeats would prove nothing); then the flag appended again, once with a different value and once with the same value: exit 2, stdout empty, a `Usage:` line naming the command. A flag shown once that no form gives fails the table as BLOCKED. Each failure line reads `deep <command> <flag> (two values \| one value repeated): …` | Twins `first-wins-reader`, `last-wins-reader`. The base fails 46 of 92 rows (land, work, workspace task, env, show, kinds, start, read, find) |
| `#3461.1bda0a26` `deep start approve` with two `--host` flags still asks for a run on both hosts | `host-repeats.test.ts` | One `start.approve` call reaches the stand-in hub, with `hosts` equal to `["spark-a", "spark-b"]`, the repo as given, and exit 0 | Twin `repeats-refused`. The base passes (today's behavior) |
| `#3461.a80d1545` Every command given each of its flags once prints and exits as on the merge base, and any leftover delta is listed | `once.test.ts` | Every flag each usage line shows (with or without a value, repeating or not) is given by some form, but the two `NOT_RUN` names. Each form runs in a fresh home with no hub; its exit code, stdout and stderr, normalized (temp paths, the checkout, Node's folder, ULIDs, ISO times, durations, and doctor's free-space and free-port readings written as placeholders), must equal `fixtures/base-once.json`. Every difference is listed in the failure | Twin `once-refused`. The base passes |

`twins.json` names each twin; `twins/README.md` says what each must plant and where it fails.

## The surfaces (my choice where the design leaves it open)

- **`deep`**: the built CLI, `node packages/cli/dist/main.js <args>`, run as you run it, in a process group of its own,
  stdin closed; read by its exit code, stdout and stderr.
- **"Sends the hub nothing"**: a stand-in hub on the socket the command would call (`<home>/.deepbuild/hub.sock`, or
  `<root>/hub.sock` for `--root`), with a control token beside it. It speaks the hub's side of `client.ts`'s protocol
  (hello on contract 1.0, the cli role, one answer per call) and records every line it receives. The hub is ours, but
  these tests read only what crosses its socket, and the stand-in decides nothing for the command.
- **"Prints its usage"**: some line of its stderr or stdout starts `Usage:` (after white space) and names `deep <command>`,
  as `tests/acceptance/1812/usage.test.ts` reads it. The exact text isn't pinned.
- **The table's flags**: each line of `deep --help` that starts `deep <word>` is a usage line; its synopsis (the text
  before the first run of two spaces) is read token by token, a `<…>` placeholder as one token. A flag (`--name`) takes
  the values that follow it up to the next flag, `[`, `]` or `|` (`--diff <a> <b>` takes two; `--slice [<cursor>]` one,
  optional); it repeats when `...` follows it or its bracket (`--home`, `--mode`, `--host`). `--` alone ends the flags
  and isn't one. A flag that takes no value is left out of the table (Scope: "read as today").
- **The forms** (`helpers.ts`, `forms`): one or more argument lists per usage line, named by the line's start, that fit
  the line with each of its flags once. Paths are under the world's temp folder; with no hub running, most exit 3 on
  the base, which is enough to show they were understood. The repeated flag goes last, before a `--` that ends the
  flags ("a default first and the caller's words after it"). A "different value" bumps a number, a year or a port, or
  adds `-2` to a word or a file name.
- **The merge base's output** (`fixtures/base-once.json`): recorded by this job by running the forms through
  `helpers.ts` on the base, twice, with identical normalized results both times. It is the merge base's own output, not
  a golden of any implementation.

## Open questions

1. **Exact usage text.** The issue says "prints its usage"; the tests require a `Usage:` line naming the command, not
   which lines or in which stream (the base prints usage on stderr).
2. **Flags with no value given twice** (`--json --json`): Scope says such a flag "is read as today", and the table
   leaves them out. Whether `deep explain <folder> --json --json` (refused today: explain takes only `--json` words) or
   `deep status --json --json` should differ isn't tested.
3. **The leftover delta.** Criterion 5 says "any leftover delta is listed". The test fails on any delta and lists every
   one in its message; it can't know which deltas a pull request means to keep. A delta the change means to keep (for
   example a command whose once-form now exits otherwise) needs this suite's blind redraft or an approved proposal.
4. **Environment-dependent rows of criterion 5.** `deep export` and `deep kinds` print "No canvas core is built under
   <checkout>/target" on this checkout, which has no Rust build; `deep doctor --json` reads the machine (agents on
   PATH, the canvas binaries, the app). In a checkout with the canvas core or deep-gpu built, those rows differ from
   the record for reasons that aren't this issue's. Run `once.test.ts` in a checkout without `target/` builds, as the
   record was made, or redraft.
5. **"Every deep command".** The table covers every line `deep --help` prints. Commands it doesn't list (`deep waiter`,
   `deep open`'s app socket, a command only an agent runs) aren't in the table.
6. **"Nothing runs"** in the table is read as exit 2 with nothing on stdout; the table has no hub, so it doesn't also
   check that no hub was called (criterion 1 does, for its three commands).

## Not run here

- `deep doctor --prompt` (sends each signed-in agent a test prompt, which spends plan usage) and `deep hub run --safe`
  (runs a hub in the foreground): `NOT_RUN` in `helpers.ts`; criterion 5's coverage check skips them by name.
- Linux: the suite ran on this Mac only. It has no platform gate.

## How I checked the tests

The merge base fails criteria 1 to 3 at their assertions (`BASE-FAILURE.txt`) and passes 4 and 5. In this worktree's
built hub (`packages/hub/dist`, untracked), I planted two faults one at a time, ran the passing tests, and put the
files back byte for byte: `REPEATED` emptied in `start-command.js` (repeats-refused) failed `#3461.1bda0a26` with exit
2 and no call; `deep land` refusing any `--repo` in `land-command.js` (once-refused, for one command) failed
`#3461.a80d1545`, listing `deep land` and `deep land judge` (code 3 on the merge base, 2 now). The first-wins and
last-wins readers are the merge base's own behavior on land/work and on show/env/find/read, and the table fails on
those rows, naming the command and flag. Two runs of the forms on the base gave identical normalized output.

## Files

- `helpers.ts`: the world, the runner, the stand-in hub, the usage-line reader, the forms, `NOT_RUN`, normalization.
- `first-wins.test.ts`, `last-wins.test.ts`, `table.test.ts`, `host-repeats.test.ts`, `once.test.ts`: one criterion
  each, in the order above.
- `fixtures/base-once.json`: the merge base's normalized output for each form (criterion 5).
- `twins.json`, `twins/README.md`: the planted wrong programs.
- `BASE-FAILURE.txt`: the suite's run on the merge base, home paths written as `~`, then the plant runs.

No fixture holds a secret or personal data: the control token and the invite's secret are fixed fixture words.
