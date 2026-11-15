# Acceptance tests for #1888: one reader for a command's script

Written first, blind, from issue #1888 ("The gate reads a Makefile rule with several targets: one reader for a
command's script": its report, Scope, three acceptance criteria and Proof) as the brief quoted it, the design and base
commit `72fe11a11` ("Merge pull request #2523 …"), by a job that never saw an implementation; none existed, and no
other branch, worktree or pull request was read, nor the live issue. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test for AC1, two for
AC2 (the floor; `checkSource`), one for AC3 with its plants inside it.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#1888.2a9bc364` | `reads.test.ts` (1): the floor and the validity gate on a checkout whose Makefile rule `test lint:` runs `eslint . \|\| true`, the claim citing `make lint` |
| AC2 | `#1888.d330ac62` | `reads.test.ts` (2): eight floor readings recorded at the base (Makefile rule of one target, package script, justfile recipe; masked and clean); four `checkSource` readings of a Makefile rule's target |
| AC3 | `#1888.b67d81e0` | `one-reader.test.ts` (1), with `readers.ts`: the functions under `packages/gate/src` that read a Makefile rule, counted from the sources, and the same count on temp copies with a second reader planted |

IDs are `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, first 8 hex) over each criterion's text as the
brief gave it, after `- [ ] `; the live issue body wasn't read, so they aren't checked against it. Each test's name
starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: How runs become one of five verdicts (Check health: a mask "in the command
  itself or in a package script, Makefile or justfile target it runs"; Whose checks count), Before each command, and
  How we know version 0 works (Dogfooding).
- At the base: `packages/gate/src/floor.ts` (`scriptOf`, `maskOf`, `validityGate`, `floor`, `Finding`), `own.ts`
  (`targetBody`, `checkSource`), `mask.ts` (`maskIn`), `index.ts` (the public entry) and `package.json`;
  `tests/acceptance/29/own.test.ts` and `helpers.ts` (AC21's `checkSource` cases; `makeRepo`, `commitFiles`);
  `packages/checks-command/src/shell.ts` (its `scriptOf`, a shell-script reader, to see what the detector must not
  count); `scripts/proof-change.mjs` (`criterionId`); `scripts/lanes.mjs` (`testGlobs`); `vitest.config.ts`. Suites
  `2497/`, `2067/` and `907/` for the house format.

## Readings where the issue leaves a choice

- **"reads `exit_masked`"**: `exit_masked` is the contracts' check code; the floor has no such value. What the floor
  gives a cited run whose exit was masked is a send-back with one finding of kind `masked_exit` naming the mask, and
  AC2 holds that reading as the base has it. So AC1 expects, from `floor` and from `validityGate`, exactly what the
  base gives the one-target rule `lint:` with the same recipe: `{ ok: false, action: 'send_back', claim, findings:
  [{ kind: 'masked_exit', ref: 'make lint', mask: '|| true', why: 'the run `make lint` it cites proves nothing: exit
  status masked by `|| true`' }] }`. A fix that renames the kind to `exit_masked` fails AC1 and AC2 alike.
- **"a claim that cites `make lint`"**: the claim's final message holds `` `make lint` `` in backticks, and the
  session's log holds one run of `make lint` that exited 0. The definition names no deliverable and its hash is the
  locked one, so the floor's answer is the validity gate's.
- **AC1's two extra assertions.** `make test`, the rule's other target, reads the same (the base's reader finds
  neither target of `test lint:`); and the same rule with no mask reads clean, so a floor that sent back every
  several-target rule would fail. The second holds at the base.
- **"each read as on the merge base"**: the plain cases only, each recorded at the base and pinned whole (the
  floor's result and the validity gate's findings): a Makefile rule of one target, masked and clean, and clean beside a
  masked rule of two other targets (`test lint-all:`: a target is a whole word); a package script by `npm run lint`,
  masked and clean, and by `npm test`; a justfile recipe by `just lint`, masked and clean. Where the base's two
  readers differ from each other no reading is pinned, since one reader can't keep both: a blank line inside a
  recipe, `name := value` lines, a header's prerequisites, a Makefile and a justfile in one checkout.
- **The one reader's other caller.** The Scope gives the reader to `own.ts` too, so AC2 also holds `checkSource` on
  a Makefile at the base: a check running target `lint` is `own` when the rule `test lint:` changed and `approved`
  when only `build:` did, and the reverse for a check running `build`. The several-target half isn't "a rule with one
  target"; it is there because the base's `own.ts` already reads such a rule, and a fix that settled on the floor's
  weaker reader would lose it. `checkSource`'s one-target readings for a package script, a Makefile target and a
  justfile target are already held by #29 AC21 (`tests/acceptance/29/own.test.ts`, "AC21 a changed package script
  target, Makefile target or justfile target the check runs makes it own"), so they aren't repeated here.
- **"one function that reads a Makefile rule"**, read from the sources with no function or file name (`readers.ts`).
  TypeScript's parser (the repo's own devDependency) cuts each `.ts` file under `packages/gate/src` into units: a
  top-level function, a top-level `const` whose value holds a function, a class member; nested functions belong to
  their unit. A unit reads a Makefile rule when its code, never its comments, holds both
  - a rule-header test: a regular expression with a literal colon (a `(?:` group's isn't one), written as a literal or
    as the text given to `new RegExp`, or the string `':'`; and
  - a recipe-line test: a regular expression that begins by asking whether a line starts with white space or doesn't
    (`^\s`, `^\t`, `^[ \t]`, `^\S`, `^[^\s…]`; never `^\s*`, `^\s?` or `^\s{0,`), the tab string `'\t'`, or
    `startsWith` of a string of blanks.

  At the base this finds `scriptOf` and `targetBody` and nothing else in the package. **Its limits:** it reads shape,
  not behaviour. It doesn't see a reader whose two halves sit in different top-level units (a header finder and a
  recipe collector as two functions), one whose patterns are top-level constants or imports rather than written in
  the function, or one that walks characters with no pattern at all: the count is then 0 and the test fails saying so,
  which is a dispute for the redraft, never a pass. It would count a function that isn't a Makefile reader but holds
  both a colon pattern and an indent test (elsewhere in the repo, `packages/hub/src/hosts.ts`'s `Hosts.facts` reads so);
  none exists in `packages/gate/src` at the base. A justfile recipe is read by the same function, so it adds none.
- **"a planted second reader fails a test that reads the sources"**: the test copies `packages/gate/src` to a temp
  folder and appends a second reader to the first source file that holds none, twice: one written with regular
  expressions, one with strings only, neither in the shape of the base's two. Each copy must read as the real sources
  plus exactly the planted function, and, once the real sources hold one, as no longer holding one. A third copy gets
  two functions that read lines and colons but no rule (`key: value` headers; an outdent), which must not be counted.
  No tracked file is written; the test checks one source's bytes after.

## Run them

```sh
npm ci && npm run build --workspaces      # once: vitest.config.ts loads built @deepbuild packages
node node_modules/vitest/vitest.mjs run tests/acceptance/1888/
node node_modules/typescript/bin/tsc -p tests/acceptance/1888/tsconfig.json    # types; clean at the base
```

Vitest, as the repo's other TypeScript suites; the gate is imported at its public entry's source
(`packages/gate/src/index.ts`, what `@deepbuild/gate` resolves to in development). `makeRepo` and `commitFiles` come
from `tests/acceptance/29/helpers.ts`. Node built-ins, the repo's packages and its `typescript` and `vitest` only.
Checkouts and source copies are temp folders, removed at the end; no process is started but git.

## Base results

`BASE-FAILURE.txt` is the one run at the base (4 tests: 2 fail, 2 pass, nothing BLOCKED), whole, with the checkout's
path replaced.

- **AC1 fails**, as it must, for the issue's reason: for `make lint` and for `make test` the floor answers
  `{ ok: true }` and the validity gate finds nothing, where the masked-exit finding naming `|| true` is expected. The
  clean twin held.
- **AC2 passes**, both tests: the eight floor readings and the four `checkSource` readings are the base's.
- **AC3 fails**, as it must, for the issue's reason: "packages/gate/src holds 2 functions that read a Makefile rule,
  not one: scriptOf (floor.ts:87 …); targetBody (own.ts:55 …)". Both plants were found, the non-readers weren't
  counted and the sources were untouched (those assertions held in the same run).

#29 AC21's test, run once on the same base, passes (the file's last lines).

## Not tested, because no criterion reaches it here

Which reader survives, its name, file or signature; whether `packages/checks-command`'s own readers join it (the
criterion names `packages/gate/src`); readings where the base's two readers disagree (above); masks other than
`|| true`; a command rewritten by deep-hook's lease (`deep lease -- make lint`), which the floor unwraps before any
script is read; `pnpm`, `yarn` and `bun`; a script that runs another script.
