# Blind redraft of #19 AC16's contract test (`#19.26a372c6`) for #2200's lease rule

AC16, its last clause: "a command whose outcome the exit-code enum doesn't map fails the contract test, naming the
command". This folder redrafts `../contract.test.ts`, the contract half, and nothing else of AC16 (`../exits.test.ts`
stands). Written from the issues, the design and base `72fe11a11`; it never saw an implementation of #2200, and looked at
no other branch, worktree, pull request, stash or session.

## The amended rule

#2200's Scope: "`deep lease` passes on its command's exit status, and the contract test reads its 127 as unmapped.
Which one gives is the owner's call." The owner's decision, 2026-11-14: **`deep lease` keeps passing on its command's
exit status; the contract test gives.** The first draft ran `deep lease -- <tmp>/missing` and held its exit, 127, to
`exit.code@1` (0, 1, 2, 3), so it named `deep lease` on any tree where lease does what the owner kept.

Every other command keeps exactly the first draft's contract. For `deep lease [kind...] -- <command>`:

| | Held to |
|---|---|
| `deep lease --dh19-no-such-flag` (the first draft's usage error, unchanged) | exit 2, no stand-in called, nothing written |
| `deep lease --dh19-no-such-flag -- <a command>` | exit 2, nothing written or called, and the command after `--` never ran |
| `deep lease -- <a command that exits n>`, n = 0, 1, 2, 3, 7, 42 | the command ran, and `deep lease` exits n: within 60 s, by no signal, no uncaught JavaScript error |
| `deep lease`, `deep lease --`, `deep lease browser` (no command to run) | lease's own outcome: a code `exit.code@1` lists, within 60 s, by no signal, no crash |
| `deep lease -- <tmp>/missing` (the first draft's listed form) | ends within 60 s, by no signal, with no crash; **its code is not judged** |

## Old test → new test

| Old (`../contract.test.ts`) | New (`contract.test.ts`) | What changed |
|---|---|---|
| AC16 `#19.26a372c6` every command `deep --help` lists, and every command the issue names, exits through `exit.code@1`: 2 for an unknown flag with nothing run, and a listed code for its outcome | the same title, ending "; deep lease exits with the status of the command it ran" | For the form `lease` only, the listed-form check is replaced by the table above. `forms`, `FILL`, `NAMED`, `SERVERS`, `crashed`, the usage-error check, the 60 s limit, the four at a time and every message are the first draft's, copied unchanged. It also requires that `deep --help` lists `lease`. |
| AC16 `#19.26a372c6` (wrong program) a `deep status` that exits 4 with the hub down (`status-exit-unmapped`) fails the contract test, naming the command | the same title, the same plant, the same expected line | nothing |
| none | AC16 `#19.26a372c6` (wrong program) a `deep lease` that folds its command's status into the table (7 and 42 become 1) fails the contract test, naming the command, and the built `deep lease`, run the same way, does not | new: the wrong-program proof of the lease rule |

## Choices, and why

1. **Statuses on and off the table.** 7 and 42 show the status is passed on where the table can't hold it, which is the
   decision. 0, 1, 2 and 3 show it is the command's status and not lease's reading of it: a lease that answered 0 for
   any command that ran, or 1 for any that failed, fails on 3 or 2.
2. **The command must have run.** Each leased command writes a file first, so an exit that happens to equal the status
   with nothing run doesn't pass, and the usage error's "nothing run" covers the command itself.
3. **A command that doesn't exist is not judged by code.** No status is the command's to pass on. Neither issue nor the
   design says what `deep lease` exits then; the base gives 127, the shell's convention, through `nice`. The first
   draft's 127 line is the one the owner's decision removes, so the redraft neither requires 127 nor forbids it. A
   crash, a signal or a hang is still named.
4. **Lease's own outcomes are held to the table only where it runs no command.** With no command, no `--`, or an unknown
   flag where a kind goes. The redraft asks exit 2 only for the unknown flag, as the first draft does for every command;
   for `deep lease` with nothing to run it asks a listed code, not which one.
5. **The hub is down in every run,** as for every other command in this test, so the command runs with no hub to lease
   it. A command leased by a running hub, a hub's refusal (lease's own exit 3 at the base) and a command ended by a
   signal are not run here: a granted lease waits on the machine's `cpu.slot`, which a contract test on a loaded
   machine can't bound, and the design gives no code for a signal.

## The wrong program for the lease rule

The base has no plant for it: no `DEEP_HUB_PLANT` name reaches `deep lease`'s exit status (the lease plants in
`packages/hub/src/heavy.ts` are the hub's, for #1015 and #1016), and a twin under `../../twins/` with its entry in
`../../twins.json` is outside this folder, which is all this job writes. So the wrong program is a stand-in on the test
side, as `tests/acceptance/1003/redraft-1458` wraps a guard: a script that runs the built CLI with the same arguments
and folds every exit status over 3 into 1, the `deep lease` the owner decided against. The same checks run first on the
built CLI as the control and must find nothing; on the stand-in they must name `deep lease` for 7 and for 42, and only
those. It proves the checks tell the two apart; it is not a wrong build of the product. A proof lane that wants a twin
of `heavy.ts` for this criterion needs one added to `../../twins/` by whoever owns that file.

## How to run

Node 24.22 first on `PATH`, workspaces built, deep-hook built, from the repo root:

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/19/doctor/redraft-ac16 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/19/doctor/redraft-ac16/tsconfig.json
```

About five minutes: each full contract run takes two to three, the lease test seconds. It uses `../helpers.ts` and its
fixtures (temp homes under `/tmp/dh19d-*`, stand-ins, no real home, network or model), and stops only processes it
started, by PID. With `--root`, Vitest writes `node_modules/.vite/` in this folder; delete it before committing.

`npx vitest run --root tests/acceptance/19/doctor` now also finds this folder's test, beside the first draft, which
this job did not edit or remove; which of the two the lane runs for `#19.26a372c6` is not this job's to set.

## What it read

- `AGENTS.md`; `docs/technical-design.md`: Dogfooding, Contracts that can't drift (the one exit-code table and its
  enum), Leases (`deep lease` and the job pool).
- Issue #19 and issue #2200, bodies only, on 2026-11-14.
- `../README.md`, `../contract.test.ts`, `../helpers.ts`, `../BASE-FAILURE.txt`, `../../twins.json` and the twins' layout.
- At the base, for the surface only: `packages/cli/src/main.ts` (the help line and the `lease` branch),
  `packages/hub/src/heavy.ts` (`leaseCommand`, `runGroup`: the usage line, the kind pattern, the unleased run),
  `packages/hub/src/plant.ts` (the plant names).
- For the shape: `tests/acceptance/1018/redraft-ac6/`, `tests/acceptance/1003/redraft-1458/README.md`,
  `tests/acceptance/111/redraft/README.md`.

## At the base

`BASE-FAILURE.txt`: one run, 1 failed and 2 passed. The first test fails with 25 lines, none naming `deep lease`: 16
for setup run before a usage error, 3 more for `deep memory keep | remove | overrule` exiting 3, 5 for a flag read as
an argument (`deep open`, `deep session rules`, `deep backup`, `deep run follow`, and `deep host run`, which #2200 does
not list), and `deep kinds`' crash. Both wrong-program tests pass. Not run: any tree with #2200's change; a reference
Mac; the suite a second time.

## Files

`contract.test.ts`, `tsconfig.json` (the parent's options, for this folder and `../helpers.ts`), `README.md`,
`BASE-FAILURE.txt`.
