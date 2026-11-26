# #3461 criterion a80d1545, blind redraft (once): the merge base is run beside the checkout, not recalled from a record

#3461's fifth criterion, `#3461.a80d1545`: "Every command given each of its flags once prints and exits as on the merge
base, and any leftover delta is listed". The first draft's `tests/acceptance/3461/once.test.ts` compares the checkout's
output with `fixtures/base-once.json`, which that job recorded once, in a checkout with no Rust builds under `target/`.
The proof lanes run the suite in a checkout of the base and in a checkout of the change, either of which may or may not
have those builds; `deep export`, `deep kinds` and `deep doctor --json` print what they find there (the first draft's
own open question 4). A record made under one set of conditions is not "as on the merge base" under another. This
redraft keeps the criterion, the forms and the comparison, and makes the merge base a program the test runs under the
very conditions the tested program meets.

Written by a fresh run of the blind acceptance job, from the issue, the design, `AGENTS.md`, the base commit and the
frozen first draft. I never read an implementation of #3461, a pull request, a branch, another worktree or any commit
after the base.

## What was read

- Base: `1b4929ae7977aa4bfe62b03e0ef39674be9e8a27` (origin/main), read 2026-11-25.
- Issue #3461, `gh issue view 3461 --repo windoliver/deepbuild` (JSON with comments): body, Scope, the five criteria,
  Proof; no comments. The tag was computed from the criterion's text after `- [ ] `, trimmed, white space collapsed:
  `sha256` begins `a80d1545`.
- `AGENTS.md`; `docs/technical-design.md`'s Dogfooding part ("A disputed test goes to a fresh run of that job, with the
  same inputs and the criterion") and, through the frozen README, the deep CLI row and exit table of "One hub per user,
  a tiny hook client, and extensions in-process" (exit 2 "not understood, nothing ran").
- The frozen first draft, read only: `README.md`, `helpers.ts`, `once.test.ts`, `tsconfig.json`, `twins.json`,
  `twins/README.md`, and `fixtures/base-once.json`'s shape.
- For form: `tests/acceptance/1359-redraft-1812/REDRAFT.md`, `tests/acceptance/1097-redraft-defaults/REDRAFT.md`, and
  the merge-base builds of `tests/acceptance/1097/helpers.ts`, `1958`, `550` and `3257` (`git archive` of a pinned
  commit into `target/`).
- At the base, for how a checkout finds things: `scripts/proof-runs.mjs` (`checkout`, `copyChange`, `prepare`,
  `changeCopy`: lane checkouts have a `.git` reaching the repository's objects, and a `node_modules` of links);
  `packages/*/package.json` build scripts; and in `packages/hub/src` every `new URL('../../../', import.meta.url)` use
  (`canvas.ts`, `canvas-doctor.ts`, `paths.ts`, `setup.ts`, `panels.ts`, `drive.ts`, `guards.ts`, `packs.ts`,
  `setup-steps.ts`), `doctor.ts`'s repo check, and `land-command.ts` (for the plant).

## The criterion, and how the test reads it

`once.test.ts`, one test: `#3461.a80d1545 every command given each of its flags once prints and exits as on the merge
base, and any leftover delta is listed`.

- **"Every command … each of its flags"**: the commands and flags are the usage lines of the merge base's own
  `deep --help` (the frozen draft's reading: a line starting `deep <word>`, its synopsis up to the first run of two
  spaces; every `--name` token is a flag, with or without a value, repeating or not). Each flag of each line must be
  given by some form, or the test fails BLOCKED, but the two `NOT_RUN` flags (`deep doctor --prompt`, `deep hub run
  --safe`). Each form must find its line, or BLOCKED.
- **"Given … once"**: the frozen draft's 42 forms, unchanged, each giving every flag of its line once.
- **"Prints and exits as on the merge base"**: each form is run twice, under the merge base's `deep` and under this
  checkout's, each in a fresh world of the same shape (throwaway HOME with setup finished, stand-ins for the login
  service, service managers, `curl` and `wget`, no hub). Exit code, stdout and stderr, normalized, must be equal.
- **"Any leftover delta is listed"**: the failure message lists every form that differs, with both programs' exit,
  stdout and stderr; nothing is dropped from the list.

## How the merge base is run under the same conditions

`helpers.ts`, `baseProgram()`:

1. `git archive` of the pinned `BASE` in this checkout (no `GIT_*` variable; no `.git` copied) into
   `target/acceptance-3461-base/<sha12>/`, git-ignored, as #1097, #1958, #550 and #3257's suites build their bases.
   The lanes' checkouts have a `.git` reaching the repository's objects (`prepare`), so the commit is there in both.
2. `node_modules` laid as the lanes lay a copy's (`copyChange`): entries link to this checkout's installed packages, and
   the workspace links (`@deepbuild/*`, relative) are made anew so they reach the base's own packages.
3. `target` in the base tree is a link to this checkout's `target`. Every Rust build the CLI looks for is found from the
   tree's root (`canvas.ts`, `canvas-doctor.ts`, `paths.ts`, `setup.ts`, `panels.ts`, `drive.ts`), so both programs see
   the same builds, or none.
4. `npm run build --workspaces` there (a second pass if the first fails on declaration order, as in a fresh checkout),
   as the lane builds the checkout's. A `.built` marker lets a later run in the same checkout reuse it. Anything that
   fails here is BLOCKED, never a pass.

Then both programs run under the same Node, the same environment and the same world shape; the order alternates form
by form. Output is normalized against each program's own root (the base's goes first, since it lies inside the
checkout) and the world's temp folder, then the frozen draft's placeholders (Node's folder, ULIDs, ISO times,
durations, doctor's free-space and free-port readings). The fixture repo's commit has a fixed date here, so both
worlds hold the same commit.

In the base lane the two programs are the same code in two places, so the test also proves the copy introduces no
delta of its own; on this worktree at the base it passed (BASE-RESULTS.txt).

## How it differs from the first draft's `once.test.ts`, and why

| First draft | Here | Why |
|---|---|---|
| Compares with `fixtures/base-once.json`, recorded once in a checkout without `target/` builds | Runs the merge base's `deep`, built from the pinned commit beside the checkout and seeing the checkout's `target/` | The lanes' checkouts may hold Rust builds; "as on the merge base" must mean under the same conditions. Checked: with a `target/debug/deep-show` placed in the checkout, the test still passes on the base (both programs run it), where the record's "No canvas core is built" line would no longer match |
| Lines and flags from the tested checkout's `deep --help` | From the merge base's `deep --help` | "Its flags" are the command's flags as the merge base has them; Scope adds no flag |
| Flag reader with value counts (`flagsOf` returning `Flag`) | Names only | This criterion needs only which flags each line shows |
| Fixture repo commit dated now | Fixed date | Two worlds, one commit |
| Temp folders `/tmp/dh3461-*` | `/tmp/dh3461o-*` | Kept apart from the frozen suite's, which may run beside it |

The forms, `NOT_RUN`, the world, the child environment and the placeholders are the frozen draft's.

## Open questions

1. **"Any leftover delta is listed."** Read as: the test fails on any delta and its message lists all of them. A delta
   the change means to keep (for example, a once-form whose usage text the change rewrites) still fails this test; it
   needs this suite's blind redraft or an approved proposal, as the first draft said.
2. **The base sees the checkout's Rust builds.** In the change's checkout those builds are the change's. If the change
   also changed a Rust binary a form reaches (`deep-show` via `deep kinds`/`deep export`), the base would run the
   change's binary. The issue is about the CLI's flag reading, so this is read as a condition, not a program, part.
3. **Cost.** The first run in a checkout builds the base's workspaces: 3 to 4 minutes on this Mac at load ~20 (the
   whole test took 4 to 5.3 min from a checkout with no `target/`; later runs, with the base built, about 30 s). `target/acceptance-3461-base/` holds about
   850 MB; remove it by hand when done (`rm -rf target/acceptance-3461-base`).
4. **The base's `node_modules`** are this checkout's installed packages. If the change moves a dependency's version,
   the base runs on the change's version, as the lanes' base copies use their own lock. Not expected for this issue.
5. **Nondeterministic readings.** As in the first draft, only the listed readings are written as placeholders. A
   reading of the machine that changes between two runs a moment apart (none seen here) would show as a delta.
6. **Commands `deep --help` doesn't list** and the two `NOT_RUN` flags are not run, as in the first draft.

## Twin

`twins.json`: `{ "#3461.a80d1545": ["once-refused"] }`; `twins/README.md` says what it breaks and where it fails. A plant
in this worktree's built `packages/hub/dist/land-command.js` (the `flag` reader looks for a second use from the flag's
own place, finding the first) failed the test at the deltas assertion, listing `deep land`, `deep land judge` and
`deep work --once` (code 3 on the merge base, 2 and usage in this checkout); the file was restored and `cmp`'d. The
merge base's program, built from the archive, was untouched by the plant.

## Run it

macOS or Linux, Node 24, the workspaces built (`npm ci`, `npm run build --workspaces`), git in PATH:

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/3461-redraft-once --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/3461-redraft-once/tsconfig.json
rm -rf tests/acceptance/3461-redraft-once/node_modules   # vitest's cache, from --root
```

No port, no screen, no hub, no network (the update URL is an address nothing answers on). Ran on macOS darwin-arm64
only; not run on Linux.

## At merge

This folder's test carries the same tag as `tests/acceptance/3461/once.test.ts` and replaces it once the owner approves
the swap; until then the frozen file stands unchanged.

## Files

`REDRAFT.md`, `once.test.ts`, `helpers.ts`, `tsconfig.json` (the frozen suite's), `twins.json`, `twins/README.md`,
`BASE-RESULTS.txt`.
